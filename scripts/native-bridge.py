# SPDX-License-Identifier: GPL-3.0-or-later
# Modified worker based on pymobiledevice3 11.28.2 VideoToolbox transcoder.
# Upstream authors: doronz88, matan and pymobiledevice3 contributors.
# Glassport changes: native AVCC input, bounded queues and rate-limited pixel copies.
"""Own one physical iPad session; exchange bounded commands over private stdio."""
import asyncio
import base64
import contextlib
import hashlib
import io
import ipaddress
import json
import logging
import queue
import os
import secrets
import signal
import sys
import tempfile
import threading
import time
from pathlib import Path, PurePosixPath

from PIL import Image
import pymobiledevice3.common as common
from pymobiledevice3.exceptions import CoreDeviceError
from pymobiledevice3.remote.userspace_tunnel import UserspaceRsdTunnel
from pymobiledevice3.remote.core_device.app_service import AppServiceService
from pymobiledevice3.remote.core_device.device_info import DeviceInfoService
from pymobiledevice3.remote.core_device.hid_service import ASCII_TO_HID
from pymobiledevice3.remote.core_device.display_service import DisplayService
from pymobiledevice3.services.house_arrest import HouseArrestService
from pymobiledevice3.remote.core_device.pasteboard_service import (
    PasteboardService, POLICY_PROMISE_SECONDARY, POLICY_ALL_RESOLVED, snapshot_text, _change_id,
)
from pymobiledevice3.remote.core_device.screen_stream import ScreenStreamServer, _SubState
from pymobiledevice3.remote.core_device import vt_jpeg as video_toolbox
from pymobiledevice3.remote.core_device.vt_jpeg import HevcToBgraTranscoder
from pymobiledevice3.services.mobile_image_mounter import auto_mount

ROOT = Path(__file__).resolve().parents[1]
os.umask(0o077)
common._HOMEFOLDER = ROOT / 'runtime/apple-device'
tempfile.tempdir = str(ROOT / 'runtime/ios-tmp')
logging.basicConfig(level=logging.WARNING, stream=sys.stderr)
MAX_FILE = 32 * 1024 * 1024


class BridgeError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def reply(identifier, result=None, error=None):
    print(json.dumps({'id': identifier, 'result': result, 'error': error},
                     ensure_ascii=True, separators=(',', ':'), default=lambda value: str(value)), flush=True)


def clipboard_text(snapshot):
    text = snapshot_text(snapshot)
    if text is not None:
        return text, 'UTF-8'
    for item in snapshot.get('pasteboard', snapshot).get('items', []) or []:
        for uti, encoding in [('public.utf16-external-plain-text', 'utf-16'),
                              ('public.utf16-plain-text', 'utf-16-le')]:
            raw = (item.get('data', {}).get(uti) or {}).get('data')
            if isinstance(raw, bytes):
                try:
                    return raw.decode(encoding), 'UTF-16'
                except UnicodeError:
                    continue
    return None, None


class NativeFrameDecoder(video_toolbox.HEVCDecoder):
    """Pass the device's native length-prefixed HEVC chunks directly to VideoToolbox."""
    def feed_avcc(self, avcc):
        vt = video_toolbox
        block = vt.c_void_p(0)
        status = vt.cm.CMBlockBufferCreateWithMemoryBlock(None, None, len(avcc), None, None, 0, len(avcc), 0, vt.byref(block))
        if status:
            raise RuntimeError('VideoToolbox could not allocate the HEVC block.')
        sample = vt.c_void_p(0)
        try:
            scratch = vt.ctypes.create_string_buffer(avcc, len(avcc))
            status = vt.cm.CMBlockBufferReplaceDataBytes(scratch, block, 0, len(avcc))
            if status:
                raise RuntimeError('VideoToolbox could not fill the HEVC block.')
            size = (vt.c_size_t * 1)(len(avcc))
            status = vt.cm.CMSampleBufferCreateReady(None, block, self._fmt, 1, 0, None, 1, size, vt.byref(sample))
            if status:
                raise RuntimeError('VideoToolbox could not create the HEVC sample.')
            flags = vt.kVTDecodeFrame_EnableAsynchronousDecompression | vt.kVTDecodeFrame_1xRealTimePlayback
            info = vt.c_uint32(0)
            status = vt.vt.VTDecompressionSessionDecodeFrame(self._session, sample, flags, None, vt.byref(info))
            if status:
                self._outputs.put((status, None))
        finally:
            if sample.value:
                vt.cf.CFRelease(sample)
            vt.cf.CFRelease(block)


class ScreenDecoder(HevcToBgraTranscoder):
    """Decode accepted HEVC frames; bound backlog and copy at most 15 pictures/sec."""
    def __init__(self, vps, sps, pps, *, on_frame, on_decode_error=None):
        self._dec = NativeFrameDecoder(vps, sps, pps, bgra_output=True)
        self._on_frame = on_frame
        self._on_decode_error = on_decode_error
        self.width, self.height = self._dec.width, self._dec.height
        self._inq = queue.Queue(maxsize=8)
        self._stop = threading.Event()
        self.last_pixel_copy = 0
        self._thread = threading.Thread(target=self._run, name='glassport-native-hevc', daemon=True)
        self._thread.start()

    def feed(self, frame):
        if self._stop.is_set():
            return
        try:
            if len(frame) > 4 * 1024 * 1024:
                raise queue.Full
            self._inq.put_nowait(frame)
        except queue.Full:
            if self._on_decode_error:
                self._on_decode_error()

    def close(self):
        self._stop.set()
        with contextlib.suppress(queue.Full):
            self._inq.put_nowait(None)
        self._thread.join(timeout=2)
        self._dec.close()

    def _emit(self, image_buf):
        now = time.monotonic()
        if now - self.last_pixel_copy < 1 / 15:
            return
        self.last_pixel_copy = now
        super()._emit(image_buf)

    def _run(self):
        while not self._stop.is_set():
            try:
                frame = self._inq.get(timeout=.05)
            except queue.Empty:
                continue
            if frame is None:
                break
            try:
                self._dec.feed_avcc(frame)
            except Exception:
                if self._on_decode_error:
                    self._on_decode_error()
                continue
            for status, image_buf in self._dec.drain():
                if status or not image_buf:
                    if self._on_decode_error:
                        self._on_decode_error()
                    continue
                try:
                    self._emit(image_buf)
                finally:
                    video_toolbox.cf.CFRelease(image_buf)


class Bridge:
    def __init__(self, rsd):
        self.rsd = rsd
        self.stream = ScreenStreamServer(rsd, audio_default_on=False, motion_idr=False, rctl_enabled=True, max_bitrate_kbps=5000)
        self.secret = secrets.token_urlsafe(32)
        self.frame = None
        self.frame_at = 0
        self.frame_count = 0
        self.frame_size = None
        self.frame_orientation = None
        self.frame_rotation = 0
        self.display_orientation = None
        self.point_scale = 1
        self.native_size = None
        self.frame_changed = asyncio.Event()
        self.pixels = asyncio.Queue(maxsize=1)
        self.access_units = asyncio.Queue(maxsize=16)
        self.subscriber = _SubState()
        self.decoder = None
        self.decoder_configuration = None
        self.decode_generation = 0
        self.tasks = []
        self.listener = None
        self.media_writers = set()
        self.closed = False
        self.pixel_lock = threading.Lock()
        self.pending_pixels = None
        self.pixel_delivery_pending = False
        self.last_touch = (0, 0)
        self.touch_active = False
        self.keys_active = False
        self.apps_cache = []
        self.copy_baseline = None
        self.last_decoder_restart = 0
        self.decoder_restarts = 0

    async def start(self):
        version = self.rsd.peer_info.get('Properties', {}).get('OSVersion', '')
        if int(version.split('.')[0]) < 27:
            raise BridgeError('IPADOS_UPGRADE_REQUIRED',
                              f'The iPad reports iPadOS {version}; native control requires iPadOS 27.')
        if not await self.rsd.get_developer_mode_status():
            raise BridgeError('DEVELOPER_MODE_REQUIRED', 'The selected iPad reports Developer Mode disabled.')
        if DisplayService.SERVICE_NAME not in self.rsd.peer_info.get('Services', {}):
            await asyncio.wait_for(auto_mount(self.rsd), 180)
            raise BridgeError('DEVICE_SUPPORT_LOADED',
                              'Device support loaded. Reconnect to refresh the native service catalogue.')
        async with DisplayService(self.rsd) as service:
            support = await asyncio.wait_for(service.get_media_support_info(), 15)
        if not support.get('supportedFeatures'):
            raise BridgeError('NATIVE_MEDIA_UNAVAILABLE', 'The iPad reports no native screen-stream features.')
        await self.read_display_info()
        await asyncio.wait_for(self.stream._ensure_fresh_stream(), 25)
        await asyncio.wait_for(self.stream._stream_ready.wait(), 15)
        if not all((self.stream._vps_nal, self.stream._sps_nal, self.stream._pps_nal)):
            raise BridgeError('CAPTURE_UNAVAILABLE', 'The actual iPad stream supplied no complete HEVC configuration.')
        loop = asyncio.get_running_loop()
        await self.configure_decoder()
        self.stream._subscribers[self.access_units] = self.subscriber
        self.access_units.put_nowait(self.stream._init_sequence)
        self.tasks = [asyncio.create_task(self.decode_frames()),
                      asyncio.create_task(self.encode_frames()),
                      asyncio.create_task(self.follow_orientation()),
                      asyncio.create_task(self.follow_decoder()),
                      asyncio.create_task(self.stream._keep_awake_loop()),
                      asyncio.create_task(self.stream._stall_watchdog()),
                      asyncio.create_task(self.stream._rctl_feedback_loop())]
        self.listener = await asyncio.start_server(self.media_request, '127.0.0.1', 0, limit=8192)
        deadline = loop.time() + 15
        while not self.frame:
            if loop.time() >= deadline:
                raise BridgeError('CAPTURE_UNAVAILABLE', 'No real iPad frame decoded within 15 seconds.')
            await asyncio.wait_for(self.frame_changed.wait(), max(.01, deadline - loop.time()))
        await self.stream._ensure_hid()
        await self.stream._ensure_keyboard()
        # No input is sent here: opening a HID channel is an admission check only.
        return {'port': self.listener.sockets[0].getsockname()[1], 'password': self.secret,
                'frame_size': self.frame_size, 'os_version': version,
                'input_dispatch_available': True, 'physical_input_verified': False}

    def request_keyframe(self):
        self.subscriber.reset_on_key = True
        self.subscriber.mark_needs_key(asyncio.get_running_loop().time())
        self.stream._request_recovery_idr(reason='glassport-decode-backpressure')

    async def configure_decoder(self, force=False):
        configuration = (self.stream._vps_nal, self.stream._sps_nal, self.stream._pps_nal)
        if self.decoder and configuration == self.decoder_configuration and not force:
            return
        if self.decoder:
            await asyncio.to_thread(self.decoder.close)
        self.decode_generation += 1
        generation = self.decode_generation
        loop = asyncio.get_running_loop()
        self.decoder = ScreenDecoder(
            *configuration,
            on_frame=lambda pixels: self.accept_pixels_from_worker(loop, pixels, generation),
            on_decode_error=lambda: loop.call_soon_threadsafe(self.request_keyframe),
        )
        if self.decoder.width * self.decoder.height * 4 > 96 * 1024 * 1024:
            raise BridgeError('CAPTURE_UNAVAILABLE', 'The decoded iPad frame exceeds the memory bound.')
        self.decoder_configuration = configuration

    def accept_pixels_from_worker(self, loop, pixels, generation):
        with self.pixel_lock:
            if self.closed:
                return
            self.pending_pixels = (pixels, generation)
            if self.pixel_delivery_pending:
                return
            self.pixel_delivery_pending = True
        loop.call_soon_threadsafe(self.deliver_pixels)

    def deliver_pixels(self):
        with self.pixel_lock:
            pending, self.pending_pixels = self.pending_pixels, None
            self.pixel_delivery_pending = False
        if pending and not self.closed:
            self.accept_pixels(*pending)

    def accept_pixels(self, pixels, generation):
        if generation != self.decode_generation:
            return
        expected = self.decoder.width * self.decoder.height * 4
        if len(pixels) != expected:
            self.request_keyframe()
            return
        if self.pixels.full():
            self.pixels.get_nowait()
        self.pixels.put_nowait((pixels, self.decoder.width, self.decoder.height, generation))

    async def decode_frames(self):
        while True:
            message = await self.access_units.get()
            if len(message) > 8 * 1024 * 1024:
                self.request_keyframe()
                continue
            if message[4] in (0, 2):
                await self.configure_decoder(force=message[4] == 2)
            if self.decoder._inq.qsize() >= 8:
                self.request_keyframe()
                continue
            if message[4] in (0, 2):
                self.subscriber.needs_key = False
            self.decoder.feed(message[5:])

    def jpeg(self, pixels, width, height, orientation):
        image = Image.frombytes('RGBA', (width, height), pixels, 'raw', 'BGRA')
        # The actual encoder pads this iPad's natural framebuffer to HEVC blocks.
        # Crop only a small, metadata-confirmed pad, never a guessed content region.
        native_width, native_height = self.native_size
        if width > height:
            native_width, native_height = native_height, native_width
        if 0 <= width - native_width <= 32 and 0 <= height - native_height <= 32:
            image = image.crop((0, 0, native_width, native_height))
        rotation = {'portrait': 0, 'portraitUpsideDown': 180,
                    'landscapeLeft': 90, 'landscapeRight': 270}.get(orientation, 0)
        if width > height and orientation in ('landscapeLeft', 'landscapeRight'):
            rotation = 0
        if rotation:
            image = image.rotate(rotation, expand=True)
        output = io.BytesIO()
        image.convert('RGB').save(output, 'JPEG', quality=80)
        return output.getvalue(), image.size, rotation

    async def encode_frames(self):
        while True:
            pixels, width, height, generation = await self.pixels.get()
            orientation = self.display_orientation
            jpeg, rendered_size, rotation = await asyncio.to_thread(self.jpeg, pixels, width, height, orientation)
            if generation != self.decode_generation or len(jpeg) > 4 * 1024 * 1024:
                continue
            self.frame = jpeg
            self.frame_size = {'width': rendered_size[0], 'height': rendered_size[1]}
            self.frame_orientation = orientation
            self.frame_rotation = rotation
            self.frame_at = time.time()
            self.frame_count += 1
            old_event, self.frame_changed = self.frame_changed, asyncio.Event()
            old_event.set()

    async def media_request(self, reader, writer):
        try:
            request = await asyncio.wait_for(reader.readline(), 5)
            headers = {}
            total = len(request)
            while True:
                line = await asyncio.wait_for(reader.readline(), 5)
                total += len(line)
                if total > 8192:
                    return
                if line in (b'\r\n', b''):
                    break
                key, _, value = line.decode('latin-1').partition(':')
                headers[key.lower()] = value.strip()
            expected = 'Bearer ' + self.secret
            host = f'127.0.0.1:{self.listener.sockets[0].getsockname()[1]}'
            if (not secrets.compare_digest(headers.get('authorization', ''), expected)
                    or headers.get('host') != host or headers.get('origin')
                    or not request.startswith(b'GET /mjpeg HTTP/1.')):
                writer.write(b'HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
                await writer.drain()
                return
            if len(self.media_writers) >= 2:
                writer.write(b'HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n')
                await writer.drain()
                return
            self.media_writers.add(writer)
            writer.write(b'HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=GlassportNative\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n')
            count = -1
            while not self.closed:
                if count == self.frame_count:
                    await self.frame_changed.wait()
                frame = self.frame
                count = self.frame_count
                writer.write(f'--GlassportNative\r\nContent-Type: image/jpeg\r\nContent-Length: {len(frame)}\r\n\r\n'.encode() + frame + b'\r\n')
                await asyncio.wait_for(writer.drain(), 3)
        except (ConnectionError, asyncio.TimeoutError, asyncio.CancelledError):
            pass
        finally:
            self.media_writers.discard(writer)
            writer.close()

    async def read_display_info(self):
        async with DeviceInfoService(self.rsd) as info:
            display_info = await info.get_display_info()
        display = next(d for d in display_info['displays'] if d.get('primary'))
        self.display_orientation = display_info['orientation']['currentDeviceNonFlatOrientation']
        self.point_scale = float(display.get('pointScale', 1))
        self.native_size = tuple(int(value) for value in display['nativeSize'])

    async def follow_orientation(self):
        while not self.closed:
            try:
                await asyncio.wait_for(self.read_display_info(), 3)
            except (asyncio.TimeoutError, CoreDeviceError):
                pass
            await asyncio.sleep(.3)

    async def follow_decoder(self):
        while not self.closed:
            await asyncio.sleep(.5)
            if time.time() - self.frame_at < 1:
                self.decoder_restarts = 0
                continue
            if not self.subscriber.needs_key:
                continue
            now = asyncio.get_running_loop().time()
            key_age = now - self.subscriber.needs_key_since
            if key_age > 1:
                self.stream._request_recovery_idr(reason='glassport-missing-key')
            if key_age > 5 and now - self.last_decoder_restart > 15 and self.decoder_restarts < 3:
                self.last_decoder_restart = now
                self.decoder_restarts += 1
                try:
                    await asyncio.wait_for(self.stream._ensure_fresh_stream(force=True), 10)
                except (asyncio.TimeoutError, CoreDeviceError):
                    pass

    async def geometry(self):
        await self.read_display_info()
        deadline = asyncio.get_running_loop().time() + 1
        while self.frame_orientation != self.display_orientation:
            remaining = deadline - asyncio.get_running_loop().time()
            if remaining <= 0:
                raise BridgeError('STALE_OBSERVATION', 'The iPad rotated; wait for a matching current frame.')
            await asyncio.wait_for(self.frame_changed.wait(), remaining)
        scale = self.point_scale
        if scale <= 0 or not self.frame_size:
            raise BridgeError('CAPTURE_UNAVAILABLE', 'The actual display has invalid geometry.')
        return {'bounds': {'x': 0, 'y': 0, 'width': self.frame_size['width'] / scale,
                           'height': self.frame_size['height'] / scale},
                'orientation': self.frame_orientation,
                'app': None, 'app_identity_method': 'unavailable',
                'frame_at': self.frame_at, 'frames': self.frame_count}

    async def touch(self, kind, x, y):
        self.last_touch = (x, y)
        if kind == 'contact':
            self.touch_active = True
        code, _ = await self.stream._handle_touch(json.dumps({'type': kind, 'x': x, 'y': y}).encode())
        if code != 200:
            raise BridgeError('INPUT_UNAVAILABLE', 'Native touch dispatch failed.')
        if kind == 'release':
            self.touch_active = False

    async def keyboard(self, usages):
        if usages:
            self.keys_active = True
        code, _ = await self.stream._handle_key(json.dumps({'usages': usages}).encode())
        if code != 200:
            raise BridgeError('INPUT_UNAVAILABLE', 'Native keyboard dispatch failed.')
        if not usages:
            self.keys_active = False

    async def chord(self, modifiers, usage):
        # Press modifiers before the character so UIKit sees the intended shortcut.
        if modifiers:
            await self.keyboard(modifiers)
            await asyncio.sleep(.04)
        await self.keyboard([*modifiers, usage])
        await asyncio.sleep(.04)
        if modifiers:
            await self.keyboard(modifiers)
        await self.keyboard([])

    async def paste_text(self, text):
        async with PasteboardService(self.rsd) as clipboard:
            await clipboard.set_text(text)
        await self.chord([0xE3], 0x19)

    async def release_inputs(self):
        if self.stream._uhs is not None:
            if self.touch_active:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self.touch('release', *self.last_touch), 2)
            if self.keys_active and self.stream._kb_service_id is not None:
                with contextlib.suppress(Exception):
                    await asyncio.wait_for(self.keyboard([]), 2)

    async def action(self, action):
        if time.time() - self.frame_at > 2:
            raise BridgeError('STALE_OBSERVATION', 'Native frames stopped; refresh before input.')
        kind, parameters = action['kind'], action['parameters']
        geometry = await self.geometry()
        bounds = geometry['bounds']
        def point(x, y):
            x, y = float(x), float(y)
            if not (0 <= x < bounds['width'] and 0 <= y < bounds['height']):
                raise BridgeError('OUT_OF_BOUNDS', 'The action is outside the actual iPad frame.')
            horizontal, vertical = x / bounds['width'], y / bounds['height']
            if self.frame_rotation == 90:
                horizontal, vertical = 1 - vertical, horizontal
            elif self.frame_rotation == 270:
                horizontal, vertical = vertical, 1 - horizontal
            elif self.frame_rotation == 180:
                horizontal, vertical = 1 - horizontal, 1 - vertical
            return round(horizontal * 65535), round(vertical * 65535)
        try:
            if kind in ('tap', 'double_tap', 'hold'):
                x, y = point(parameters['x'], parameters['y'])
                for _ in range(2 if kind == 'double_tap' else 1):
                    await self.touch('contact', x, y)
                    await asyncio.sleep(float(parameters.get('duration', .6)) if kind == 'hold' else .05)
                    await self.touch('release', x, y)
                    if kind == 'double_tap':
                        await asyncio.sleep(.08)
            elif kind == 'swipe':
                start = point(parameters['fromX'], parameters['fromY'])
                end = point(parameters['toX'], parameters['toY'])
                duration = float(parameters.get('duration', .35))
                steps = max(3, min(90, round(duration * 30)))
                for index in range(steps + 1):
                    fraction = index / steps
                    await self.touch('contact', *(round(a + (b - a) * fraction) for a, b in zip(start, end)))
                    await asyncio.sleep(duration / steps)
                await self.touch('release', *end)
            elif kind == 'type_text':
                # Device-native paste preserves Unicode and line breaks; no Return report follows.
                await self.paste_text(parameters['text'])
            elif kind == 'type_keys':
                for character in parameters['text']:
                    if character in ASCII_TO_HID:
                        usage, shift = ASCII_TO_HID[character]
                        await self.chord([0xE1] if shift else [], usage)
                    else:
                        await self.paste_text(character)
            elif kind == 'key':
                if parameters['key'] == 'Copy':
                    async with PasteboardService(self.rsd) as clipboard:
                        before = await clipboard.get(data_policy=POLICY_PROMISE_SECONDARY)
                    self.copy_baseline = (_change_id(before), snapshot_text(before))
                usage = {'Enter': 0x28, 'Backspace': 0x2A, 'Escape': 0x29, 'Tab': 0x2B,
                         'ArrowRight': 0x4F, 'ArrowLeft': 0x50, 'ArrowDown': 0x51,
                         'ArrowUp': 0x52, 'Copy': 0x06, 'SelectAll': 0x04}[parameters['key']]
                usages = [0xE3, usage] if parameters['key'] in ('Copy', 'SelectAll') else [usage]
                await self.chord(usages[:-1], usages[-1])
            elif kind == 'home':
                code, _ = await self.stream._handle_button(b'{"name":"home","state":"press"}')
                if code != 200:
                    raise BridgeError('INPUT_UNAVAILABLE', 'Native Home dispatch failed.')
            elif kind == 'open_app':
                async with AppServiceService(self.rsd) as apps:
                    await apps.launch_application(parameters['bundleId'], kill_existing=False)
            else:
                raise BridgeError('INVALID_ARGUMENT', 'Unsupported native action.')
            dispatched_at = time.time()
            with contextlib.suppress(asyncio.TimeoutError):
                deadline = asyncio.get_running_loop().time() + .75
                while self.frame_at < dispatched_at:
                    remaining = deadline - asyncio.get_running_loop().time()
                    if remaining <= 0:
                        break
                    await asyncio.wait_for(self.frame_changed.wait(), remaining)
            return {'dispatch': 'AWAITED', 'visual_result': 'REQUIRES_OBSERVATION',
                    'frame_after_dispatch': self.frame_at >= dispatched_at}
        finally:
            await self.release_inputs()

    async def request(self, method, parameters):
        if method == 'status':
            def task_state(task):
                return {'done': task.done(), 'error': type(task.exception()).__name__ if task.done() and not task.cancelled() and task.exception() else None}
            return {'frame_count': self.frame_count, 'frame_age_seconds': time.time() - self.frame_at,
                    'au_age_seconds': asyncio.get_running_loop().time() - self.stream._last_good_au_t,
                    'tasks': [task_state(task) for task in self.tasks],
                    'decoder_queue': self.decoder._inq.qsize(), 'subscriber_needs_key': self.subscriber.needs_key,
                    'rtcp': task_state(self.stream._active_rtcp_task) if self.stream._active_rtcp_task else None}
        if method == 'geometry':
            return await self.geometry()
        if method == 'screenshot':
            if not self.frame or time.time() - self.frame_at > 2:
                raise BridgeError('CAPTURE_UNAVAILABLE', 'The native iPad frame is unavailable or stale.')
            return {'image': base64.b64encode(self.frame).decode(), 'captured_at': self.frame_at}
        if method == 'apps':
            async with AppServiceService(self.rsd) as apps:
                self.apps_cache = await apps.list_apps(include_hidden_apps=False, include_internal_apps=False)
            return {app['bundleIdentifier']: {'name': app['name'], 'version': app.get('version'),
                    'isContainerAccessible': app.get('isContainerAccessible', False)} for app in self.apps_cache}
        if method == 'action':
            return await self.action(parameters)
        if method == 'clipboard':
            async with PasteboardService(self.rsd) as clipboard:
                snapshot = await clipboard.get(data_policy=POLICY_PROMISE_SECONDARY)
                if parameters.get('require_fresh_copy'):
                    if self.copy_baseline is None:
                        raise BridgeError('COPY_NOT_REQUESTED', 'Select iPad text and use Copy selected text first.')
                    deadline = asyncio.get_running_loop().time() + 3
                    while (_change_id(snapshot), snapshot_text(snapshot)) == self.copy_baseline:
                        if asyncio.get_running_loop().time() >= deadline:
                            raise BridgeError('COPY_UNCHANGED', 'The iPad clipboard did not change. Select app text before copying.')
                        await asyncio.sleep(.15)
                        snapshot = await clipboard.get(data_policy=POLICY_PROMISE_SECONDARY)
            text, text_encoding = clipboard_text(snapshot)
            public_types = {'public.plain-text', 'public.text', 'public.utf8-plain-text',
                            'public.utf16-plain-text', 'public.utf16-external-plain-text'}
            advertised = any(public_types.intersection(item.get('types', []))
                             for item in snapshot.get('pasteboard', snapshot).get('items', []) or [])
            if text is None and advertised:
                # Ask the device service to resolve its advertised public text.
                # Never decode or strip protection from managed-app private representations.
                async with PasteboardService(self.rsd) as clipboard:
                    try:
                        resolved = await asyncio.wait_for(clipboard.get(data_policy=POLICY_ALL_RESOLVED), 90)
                    except asyncio.TimeoutError:
                        raise BridgeError('CLIPBOARD_RESOLUTION_TIMEOUT', 'The iPad did not resolve its advertised public text within 90 seconds.')
                snapshot = resolved
                text, text_encoding = clipboard_text(snapshot)
            representations = []
            for item in snapshot.get('pasteboard', snapshot).get('items', []) or []:
                for uti, datum in (item.get('data') or {}).items():
                    representations.append({'type': uti, 'inline_bytes': len(datum.get('data') or b''),
                                            'promised': datum.get('isPromised', False)})
            truncated = text is not None and len(text) > 262144
            return {'text': text[:262144] if text is not None else None, 'truncated': truncated,
                    'fresh_copy': bool(parameters.get('require_fresh_copy')),
                    'representations': representations, 'text_encoding': text_encoding,
                    'source_metadata': snapshot.get('pasteboard', {}).get('sourceMetadata'),
                    'coverage': 'First supported inline plain-text item on the device clipboard. No whole-screen claim.'}
        if method == 'files':
            identifier, path = parameters['bundleId'], parameters.get('path', 'Documents')
            relative = PurePosixPath(path)
            if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0] != 'Documents':
                raise BridgeError('INVALID_ARGUMENT', 'Only an app Documents export path is allowed.')
            async with await HouseArrestService.create(self.rsd, identifier, documents_only=True) as files:
                for index in range(1, len(relative.parts) + 1):
                    parent = '/' + '/'.join(relative.parts[:index])
                    if (await files.stat(parent)).get('st_ifmt') != 'S_IFDIR':
                        raise BridgeError('INVALID_ARGUMENT', 'The document path contains a link or non-directory component.')
                names = sorted(name for name in await files.listdir('/' + str(relative))
                               if name not in {'.', '..'} and '/' not in name and '\\' not in name
                               and len(name.encode('utf-8')) <= 255 and not any(ord(c) < 32 for c in name))
                entries = []
                for name in names[:200]:
                    child = str(relative / name)
                    attributes = await files.stat('/' + child)
                    kind = attributes.get('st_ifmt')
                    if kind not in {'S_IFREG', 'S_IFDIR'}:
                        continue
                    entries.append({'name': name, 'path': child, 'directory': kind == 'S_IFDIR',
                                    'bytes': int(attributes['st_size']) if kind == 'S_IFREG' else None})
            return {'path': str(relative), 'entries': entries, 'truncated': len(names) > 200}
        if method == 'file':
            # Restrict reads to a supported app document export, never its private data root.
            identifier, path = parameters['bundleId'], parameters['path']
            relative = PurePosixPath(path)
            if relative.is_absolute() or '..' in relative.parts or not relative.parts or relative.parts[0] != 'Documents':
                raise BridgeError('INVALID_ARGUMENT', 'Only an app Documents export path is allowed.')
            async with await HouseArrestService.create(self.rsd, identifier, documents_only=True) as files:
                # Reject links in every path component rather than following them into app data.
                for index in range(1, len(relative.parts)):
                    parent = '/' + '/'.join(relative.parts[:index])
                    if (await files.stat(parent)).get('st_ifmt') != 'S_IFDIR':
                        raise BridgeError('INVALID_ARGUMENT', 'The document export path contains a link or non-directory component.')
                device_path = '/' + str(relative)
                attributes = await files.stat(device_path)
                if attributes.get('st_ifmt') != 'S_IFREG' or int(attributes.get('st_size', MAX_FILE + 1)) > MAX_FILE:
                    raise BridgeError('FILE_UNAVAILABLE', 'The export must be a regular file of at most 32 MiB.')
                descriptor = await files.fopen(device_path, mode='r')
                try:
                    chunks, size = [], 0
                    expected = int(attributes['st_size'])
                    while size < expected:
                        chunk = await files.fread(descriptor, min(512 * 1024, expected - size))
                        if not chunk:
                            raise BridgeError('FILE_CHANGED', 'The actual iPad export ended before its reported length.')
                        size += len(chunk)
                        if size > MAX_FILE:
                            raise BridgeError('PAYLOAD_TOO_LARGE', 'The actual export exceeds 32 MiB.')
                        chunks.append(chunk)
                    data = b''.join(chunks)
                finally:
                    await files.fclose(descriptor)
                after = await files.stat(device_path)
                if (int(attributes['st_size']) != len(data) or attributes.get('st_size') != after.get('st_size')
                        or attributes.get('st_mtime') != after.get('st_mtime')):
                    raise BridgeError('FILE_CHANGED', 'The iPad export changed during transfer; export it again before retrying.')
            return {'name': relative.name, 'bytes_base64': base64.b64encode(data).decode(),
                    'source_sha256': hashlib.sha256(data).hexdigest(), 'source_bytes': len(data),
                    'method': 'apple_document_sharing'}
        if method == 'release':
            await self.release_inputs()
            return {'released': True}
        raise BridgeError('INVALID_ARGUMENT', 'Unsupported native bridge request.')

    async def close(self):
        with self.pixel_lock:
            self.closed = True
            self.pending_pixels = None
        self.frame_changed.set()
        await self.release_inputs()
        if self.listener:
            self.listener.close()
            await self.listener.wait_closed()
        for writer in list(self.media_writers):
            writer.close()
        for task in self.tasks:
            task.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)
        self.stream._subscribers.pop(self.access_units, None)
        if self.decoder:
            await asyncio.to_thread(self.decoder.close)
        await self.stream._stop_hid()
        worker = self.stream._hid_worker_task
        if worker:
            worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await worker
        # Close only this bridge's channels. Never stop all device media sessions.
        await self.stream._stop_active_stream()


async def main():
    serial = sys.argv[1]
    if len(sys.argv) == 4:
        from importlib.util import spec_from_file_location, module_from_spec
        host, port = sys.argv[2], int(sys.argv[3])
        if ipaddress.ip_address(host) not in ipaddress.ip_network('100.64.0.0/10') or not 1 <= port <= 65535:
            raise ValueError('The configured Tailscale endpoint is invalid.')
        module_spec = spec_from_file_location('glassport_network', ROOT / 'scripts/native-network.py')
        module = module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        tunnel = module.PairedNetworkTunnel(serial, host, port)
    else:
        tunnel = UserspaceRsdTunnel(serial=serial, autopair=False)
    bridge = None
    try:
        rsd = await asyncio.wait_for(tunnel.aopen(), 25)
        if rsd.udid != serial:
            raise BridgeError('DEVICE_IDENTITY_MISMATCH', 'The native tunnel returned another device.')
        bridge = Bridge(rsd)
        reply('startup', await bridge.start())
        reader = asyncio.StreamReader(limit=65536)
        await asyncio.get_running_loop().connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
        operation_lock = asyncio.Lock()
        requests = set()

        async def respond(line):
            identifier = None
            try:
                request = json.loads(line)
                identifier = request['id']
                method = request['method']
                timeout = 95 if method == 'clipboard' else 45
                if method in {'status', 'geometry', 'screenshot', 'release'}:
                    result = await asyncio.wait_for(bridge.request(method, request.get('parameters', {})), timeout)
                else:
                    async with operation_lock:
                        result = await asyncio.wait_for(bridge.request(method, request.get('parameters', {})), timeout)
                reply(identifier, result)
            except BridgeError as error:
                reply(identifier, error={'code': error.code, 'message': str(error)})
            except Exception as error:
                reply(identifier, error={'code': 'NATIVE_OPERATION_FAILED',
                                        'message': f'The selected iPad operation failed ({type(error).__name__}).',
                                        'error_type': type(error).__name__})

        try:
            while line := await reader.readline():
                if len(requests) >= 16:
                    reply(json.loads(line).get('id'), error={'code': 'QUEUE_FULL', 'message': 'The native request queue is full.'})
                    continue
                request_task = asyncio.create_task(respond(line))
                requests.add(request_task)
                request_task.add_done_callback(requests.discard)
        finally:
            for request_task in requests:
                request_task.cancel()
            await asyncio.gather(*requests, return_exceptions=True)
    except BridgeError as error:
        reply('startup', error={'code': error.code, 'message': str(error)})
    except CoreDeviceError as error:
        reply('startup', error={'code': 'NATIVE_SERVICE_REJECTED',
                                'message': 'The iPad rejected native service admission.',
                                'device_error_code': error.code})
    except Exception as error:
        reply('startup', error={'code': 'NATIVE_DEVICE_UNAVAILABLE',
                                'message': 'The selected iPad native connection is unavailable.',
                                'error_type': type(error).__name__})
    finally:
        if bridge:
            with contextlib.suppress(Exception):
                await asyncio.wait_for(bridge.close(), 6)
        await tunnel.aclose()


if __name__ == '__main__':
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    task = loop.create_task(main())
    for event in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(event, task.cancel)
    with contextlib.suppress(asyncio.CancelledError):
        loop.run_until_complete(task)
    loop.close()
