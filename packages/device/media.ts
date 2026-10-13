import http from 'node:http';
import {EventEmitter} from 'node:events';
import type {ClientRequest,IncomingMessage} from 'node:http';
import {GlassportError} from '../contracts/core.ts';
export class MjpegReader extends EventEmitter {
  request:ClientRequest|null=null;response:IncomingMessage|null=null;frame:Buffer|null=null;lastFrameAt=0;frames=0;bytes=0;error:string|null=null;private buffer=Buffer.alloc(0);private length:number|null=null;
  start(url:string,headers:Record<string,string>={}){this.stop();const endpoint=new URL(url);if(endpoint.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(endpoint.hostname))throw new GlassportError('INVALID_TRANSPORT','The media forwarder must be a local private endpoint.');
    this.request=http.get(endpoint,{headers},res=>{if(res.statusCode!==200){this.error='The iPad media stream did not become available.';res.destroy();return;}this.response=res;res.on('data',(chunk:Buffer)=>this.push(chunk));res.on('error',()=>{this.error='The media stream disconnected.';});});this.request.on('error',()=>{this.error='The local iPad media endpoint is unavailable.';});this.request.setTimeout(10000,()=>{this.request?.destroy();this.error='The media stream timed out.';});
  }
  push(chunk:Buffer){this.buffer=Buffer.concat([this.buffer,chunk]);if(this.buffer.length>8*1024*1024){this.buffer=Buffer.alloc(0);this.length=null;this.error='An oversized media frame was rejected.';return;}
    while(true){if(this.length===null){const split=this.buffer.indexOf('\r\n\r\n');if(split<0)return;const header=this.buffer.subarray(0,split).toString('ascii');const match=/content-length:\s*(\d+)/i.exec(header);this.buffer=this.buffer.subarray(split+4);if(!match)continue;const length=Number(match[1]);if(length<=0||length>4*1024*1024){this.buffer=Buffer.alloc(0);this.error='Invalid media frame size.';return;}this.length=length;}if(this.buffer.length<this.length)return;const frame=Buffer.from(this.buffer.subarray(0,this.length));this.buffer=this.buffer.subarray(this.length);this.length=null;if(frame[0]!==0xff||frame[1]!==0xd8){this.error='The media payload is not a JPEG.';continue;}this.frame=frame;this.lastFrameAt=Date.now();this.frames++;this.bytes+=frame.length;this.error=null;this.emit('frame',frame);}
  }
  stop(){this.request?.destroy();this.response?.destroy();this.request=null;this.response=null;this.frame=null;this.buffer=Buffer.alloc(0);this.length=null;this.lastFrameAt=0;}
}
