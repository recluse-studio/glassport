import type {Action,Observation,Rect} from '../contracts/core.ts';
import type {Device} from './discovery.ts';
export interface DeviceAdapter {
  mediaUrl?:string;
  mediaHeaders?:Record<string,string>;
  connect(device:Device):Promise<unknown>;
  disconnect():Promise<void>;
  geometry():Promise<{bounds:Rect;orientation:string;app:string|null}>;
  screenshot():Promise<Buffer>;
  source():Promise<unknown>;
  apps():Promise<any>;
  action(action:Action):Promise<unknown>;
  request(path:string,method?:string,body?:unknown,timeout?:number):Promise<any>;
  readText?(observation:Observation,requireFreshCopy?:boolean):Promise<any>;
  file?(bundleId:string,path:string):Promise<{name:string;data:Buffer;source_sha256:string;source_bytes:number}>;
  listFiles?(bundleId:string,path:string):Promise<{path:string;entries:Array<{name:string;path:string;directory:boolean;bytes:number|null}>;truncated:boolean}>;
}
