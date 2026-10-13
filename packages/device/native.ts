import {spawn} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {join} from 'node:path';
import {GlassportError} from '../contracts/core.ts';
import type {Action,Observation,Rect} from '../contracts/core.ts';
import type {Device} from './discovery.ts';
import type {DeviceAdapter} from './adapter.ts';

export class NativeDevice implements DeviceAdapter {
  root:string; child:ChildProcessWithoutNullStreams|null=null;mediaUrl?:string;mediaHeaders?:Record<string,string>;
  private pending=new Map<string,{resolve:(value:any)=>void;reject:(error:Error)=>void;timer:NodeJS.Timeout}>();
  private buffer=Buffer.alloc(0);private stopping=false;
  constructor(root:string){this.root=root;}
  private failPending(){for(const entry of this.pending.values()){clearTimeout(entry.timer);entry.reject(new GlassportError('TRANSPORT_LOST','The native iPad connection ended.',503));}this.pending.clear();}
  private response(chunk:Buffer){
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>48*1024*1024){this.failPending();this.child?.kill('SIGTERM');return;}
    let split:number;
    while((split=this.buffer.indexOf('\n'))>=0){
      const line=this.buffer.subarray(0,split);this.buffer=this.buffer.subarray(split+1);
      let message:any;try{message=JSON.parse(line.toString());}catch{this.failPending();this.child?.kill('SIGTERM');return;}
      const entry=this.pending.get(message.id);if(!entry)continue;this.pending.delete(message.id);clearTimeout(entry.timer);
      if(message.error)entry.reject(new GlassportError(String(message.error.code),String(message.error.message),503));else entry.resolve(message.result);
    }
  }
  private awaitResponse(id:string,timeout:number){return new Promise<any>((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new GlassportError('TRANSPORT_LOST','The native device operation timed out. Its execution may be uncertain.',503));this.child?.kill('SIGTERM');},timeout);this.pending.set(id,{resolve,reject,timer});});}
  async connect(device:Device){
    if(this.child)throw new GlassportError('CONTROLLER_BUSY','The native device adapter already owns a connection.',409);
    this.stopping=false;this.buffer=Buffer.alloc(0);
    const spawnArguments=['-u',join(this.root,'scripts/native-bridge.py'),device.udid];if(device.nativeNetwork){if(!/^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.(?:\d{1,3})\.(?:\d{1,3})$/.test(device.nativeNetwork.host)||!Number.isInteger(device.nativeNetwork.port)||device.nativeNetwork.port<1||device.nativeNetwork.port>65535)throw new GlassportError('CONFIG_INVALID','The paired Tailscale endpoint is invalid.');spawnArguments.push(device.nativeNetwork.host,String(device.nativeNetwork.port));}
    const startup=this.awaitResponse('startup',210000);
    const child=spawn(join(this.root,device.nativeNetwork?'.local/ios-network/bin/python':'.local/ios/bin/python'),spawnArguments,{cwd:this.root,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['pipe','pipe','pipe']});this.child=child;
    child.stdout.on('data',(chunk:Buffer)=>this.response(chunk));
    // Drain native diagnostic output without retaining device content or command bodies.
    child.stderr.on('data',()=>{});
    child.once('error',()=>this.failPending());
    child.once('exit',()=>{if(this.child===child)this.child=null;this.failPending();});
    try{
      const result=await startup;
      if(!Number.isInteger(result.port)||result.port<1024||result.port>65535||typeof result.password!=='string')throw new GlassportError('NATIVE_SERVICE_INVALID','The native bridge returned an invalid private media endpoint.',503);
      if(typeof result.os_version==='string')device.os_version=result.os_version;
      this.mediaUrl=`http://127.0.0.1:${result.port}/mjpeg`;this.mediaHeaders={Authorization:`Bearer ${result.password}`};
      return this.geometry();
    }catch(error){await this.disconnect();throw error;}
  }
  async rpc(method:string,parameters:unknown={},timeout=45000){
    if(!this.child||this.stopping)throw new GlassportError('SESSION_EXPIRED','The native device session is closed.',409);
    if(this.pending.size>=16)throw new GlassportError('QUEUE_FULL','The native device request queue is full.',429);
    const id=randomUUID();const line=JSON.stringify({id,method,parameters})+'\n';
    if(Buffer.byteLength(line)>65536)throw new GlassportError('PAYLOAD_TOO_LARGE','The native device command exceeds 64 KiB.',413);
    const result=this.awaitResponse(id,timeout);this.child.stdin.write(line,error=>{if(error)this.failPending();});return result;
  }
  async disconnect(){
    const child=this.child;if(!child)return;
    if(!this.stopping){try{await this.rpc('release',{},3000);}catch{}}
    this.stopping=true;this.mediaUrl=undefined;this.mediaHeaders=undefined;this.failPending();
    await new Promise<void>(resolve=>{if(child.exitCode!==null){resolve();return;}const timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},8000);child.once('exit',()=>{clearTimeout(timer);resolve();});child.kill('SIGTERM');});
    if(this.child===child)this.child=null;this.buffer=Buffer.alloc(0);
  }
  async geometry():Promise<{bounds:Rect;orientation:string;app:string|null}>{return this.rpc('geometry');}
  async screenshot(){const result=await this.rpc('screenshot');return Buffer.from(result.image,'base64');}
  async source(){throw new GlassportError('TEXT_SOURCE_UNAVAILABLE','Use copied text with the native adapter; an app accessibility tree is unavailable.',409);}
  async apps(){return this.rpc('apps');}
  async action(action:Action){return this.rpc('action',action);}
  async request(path:string){if(path==='/status'&&this.child)return {native:true,...await this.rpc('status',{},3000)};throw new GlassportError('TRANSPORT_LOST','The native device session is unavailable.',503);}
  async readText(observation:Observation,requireFreshCopy=false){
    const clipboard=await this.rpc('clipboard',{require_fresh_copy:requireFreshCopy},100000);
    return {extraction_id:randomUUID(),observation_id:observation.observation_id,app_ref:null,captured_at:new Date().toISOString(),method:clipboard.fresh_copy?'device_copy':'device_clipboard',fresh_copy:clipboard.fresh_copy===true,text:clipboard.text??'',clipboard_representations:clipboard.representations,text_encoding:clipboard.text_encoding,regions:[],coverage:clipboard.coverage,truncated:clipboard.truncated===true,source_metadata:clipboard.source_metadata,session_generation:observation.generation,warnings:[clipboard.fresh_copy?'A new device copy was observed; current foreground app identity is unavailable.':'Clipboard contents may come from an earlier copy. Copy the intended app content before reading; current foreground app identity is unavailable.',...(clipboard.truncated?['The returned copy reached the 262144-character limit.']:[])],confidence:null};
  }
  async file(bundleId:string,path:string){
    const result=await this.rpc('file',{bundleId,path});const data=Buffer.from(result.bytes_base64,'base64');
    if(data.length!==result.source_bytes||createHash('sha256').update(data).digest('hex')!==result.source_sha256)throw new GlassportError('TRANSFER_CHANGED','The device export changed across the local transfer boundary.',409);
    return {name:String(result.name),data,source_sha256:String(result.source_sha256),source_bytes:Number(result.source_bytes)};
  }
  async listFiles(bundleId:string,path:string){return this.rpc('files',{bundleId,path});}
}
