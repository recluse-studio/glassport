import test from 'node:test';
import assert from 'node:assert/strict';
import {FrameParser} from '../apps/web/frame-display.js';

function part(bytes){return Buffer.concat([Buffer.from(`--GlassportFrame\r\nContent-Type: image/jpeg\r\nContent-Length: ${bytes.length}\r\n\r\n`),bytes,Buffer.from('\r\n')]);}

test('Browser framing preserves binary frame bytes across every-byte fragmentation and coalesced frames',()=>{
 const first=Buffer.from([255,216,13,10,13,10,255,217]),second=Buffer.from([255,216,0,1,2,255,217]);
 const received=[];const parser=new FrameParser(frame=>received.push(Buffer.from(frame)));const wire=Buffer.concat([part(first),part(second)]);
 for(const byte of wire)parser.push(Uint8Array.of(byte));assert.deepEqual(received,[first,second]);
 const together=[];new FrameParser(frame=>together.push(Buffer.from(frame))).push(wire);assert.deepEqual(together,[first,second]);
});

test('Browser framing rejects oversized frames, malformed boundaries and bad terminators before emitting them',()=>{
 for(const wire of [Buffer.from('--GlassportFrame\r\nContent-Length: 4194305\r\n\r\n'),Buffer.from('--Other\r\nContent-Length: 1\r\n\r\na\r\n'),Buffer.from('--GlassportFrame\r\nContent-Length: 1\r\n\r\naXX')]){
  const received=[];assert.throws(()=>new FrameParser(frame=>received.push(frame)).push(wire));assert.equal(received.length,0);
 }
 assert.throws(()=>new FrameParser(()=>{}).push(new Uint8Array(8193)),/header/);
 assert.throws(()=>new FrameParser(()=>{}).push(new Uint8Array(8388609)),/buffer/);
});
