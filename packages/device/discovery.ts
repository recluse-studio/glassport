import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {GlassportError} from '../contracts/core.ts';
const require=createRequire(new URL('../../node_modules/appium-xcuitest-driver/package.json',import.meta.url));
const ios=require('appium-ios-device');
export type Device={device_ref:string;name:string;os_version:string|null;model:string|null;transport:string;setup_status:string;udid:string;wdaUrl?:string;apps?:Record<string,string>;privateIngressVerified?:boolean;preinstalledWda?:boolean;nativeNetwork?:{host:string;port:number}};
export function deviceRef(udid:string){return createHash('sha256').update(udid).digest('hex').slice(0,20);}
export async function discover(root:string):Promise<Device[]> {
  const devices:Device[]=[];
  const udids:string[]=await ios.utilities.getConnectedDevices();
  for(const udid of udids){
    let info:Record<string,unknown>={};
    try{info=await ios.utilities.getDeviceInfo(udid);}catch{}
    if(info.DeviceClass && info.DeviceClass!=='iPad')continue;
    const osVersion=info.ProductVersion?String(info.ProductVersion):null;
    const nativeUpgrade=info.DeviceClass==='iPad'&&osVersion!==null&&Number(osVersion.split('.')[0])<27;
    devices.push({device_ref:deviceRef(udid),name:String(info.DeviceName??'Paired Apple device'),os_version:osVersion,model:info.ProductType?String(info.ProductType):null,transport:'paired',setup_status:info.DeviceClass==='iPad'?(nativeUpgrade?'NATIVE_ROUTE_REQUIRES_IPADOS_27':'AVAILABLE'):'TRUST_REQUIRED',udid});
  }
  let config:{devices?:Array<Partial<Device>>}={};
  try{config=JSON.parse(await readFile(`${root}/runtime/device-config.json`,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new GlassportError('CONFIG_INVALID','Private device configuration cannot be read.');}
  for(const entry of config.devices??[]){
    if(!entry.udid||!entry.name)continue;
    const old=devices.find(x=>x.udid===entry.udid);
    const data={...old,...entry,device_ref:deviceRef(entry.udid),udid:entry.udid,name:entry.name,os_version:entry.os_version??old?.os_version??null,model:entry.model??old?.model??null,transport:entry.transport??old?.transport??'configured',setup_status:entry.wdaUrl?'RUNNER_CONFIGURED':old?.setup_status??'NOT_DISCOVERED'} as Device;
    if(old)Object.assign(old,data);else devices.push(data);
  }
  return devices;
}
export function publicDevice(d:Device){return {device_ref:d.device_ref,name:d.name,os_version:d.os_version,model:d.model,transport:d.transport,setup_status:d.setup_status};}
