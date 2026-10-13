"""Check native control readiness on the explicitly selected physical iPad."""
import asyncio
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import pymobiledevice3.common as common
from pymobiledevice3.remote.native_tunnel import NativeRemotedTunnel
from pymobiledevice3.remote.core_device.display_service import DisplayService

ROOT = Path(__file__).resolve().parents[1]
os.umask(0o077)
common._HOMEFOLDER = ROOT / 'runtime/apple-device'
tempfile.tempdir = str(ROOT / 'runtime/ios-tmp')


async def probe(serial):
    result = {'tested_at': datetime.now(timezone.utc).isoformat(),
              'physical_device': True, 'control_ready': False}
    tunnel = NativeRemotedTunnel(serial=serial)
    try:
        rsd = await asyncio.wait_for(tunnel.aopen(), 20)
        if rsd.udid != serial:
            raise ValueError('Native discovery returned a different iPad.')
        properties = rsd.peer_info.get('Properties', {})
        result['os_version'] = properties.get('OSVersion')
        result['model'] = properties.get('ProductType')
        result['name'] = properties.get('Name') or properties.get('DeviceName')
        result['developer_mode'] = await rsd.get_developer_mode_status()
        services = rsd.peer_info.get('Services', {})
        result['display_service'] = DisplayService.SERVICE_NAME in services
        result['hid_service'] = 'com.apple.coredevice.hid.universalhidservice' in services
        result['pasteboard_service'] = 'com.apple.coredevice.pasteboardservice' in services
        async with DisplayService(rsd) as display:
            support = await asyncio.wait_for(display.get_media_support_info(), 15)
        result['media_support'] = support
        major = int(str(result['os_version']).split('.')[0])
        if major < 27:
            result['code'] = 'IPADOS_UPGRADE_REQUIRED'
            result['message'] = (f"The selected iPad runs iPadOS {result['os_version']}. "
                                 'Native screen control requires iPadOS 27 or later. '
                                 'Check Settings → General → Software Update on the iPad.')
        elif not result['developer_mode']:
            result['code'] = 'DEVELOPER_MODE_REQUIRED'
            result['message'] = 'Developer Mode is disabled on the selected iPad.'
        elif not support.get('supportedFeatures'):
            result['code'] = 'NATIVE_MEDIA_UNAVAILABLE'
            result['message'] = 'The selected iPad reports no native media features.'
        else:
            result['code'] = 'NATIVE_SERVICES_AVAILABLE'
            result['message'] = 'Native services answer; live display and control still require verification.'
        return result
    finally:
        await tunnel.aclose()


if __name__ == '__main__':
    try:
        print(json.dumps(asyncio.run(probe(sys.argv[1]))))
    except Exception as error:
        print(json.dumps({'tested_at': datetime.now(timezone.utc).isoformat(),
                          'control_ready': False, 'code': 'NATIVE_DEVICE_UNAVAILABLE',
                          'message': 'The selected iPad native service is unavailable.',
                          'error_type': type(error).__name__}))
        sys.exit(1)
