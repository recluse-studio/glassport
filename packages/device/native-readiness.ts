import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {GlassportError} from '../contracts/core.ts';
const execute=promisify(execFile);
export async function nativeReadiness(root:string,udid:string){
  try {
    const {stdout}=await execute(join(root,'.local/ios/bin/python'),[join(root,'scripts/native-readiness.py'),udid],{cwd:root,timeout:45000,maxBuffer:65536});
    return JSON.parse(stdout) as {tested_at:string;os_version:string;model:string;name:string;developer_mode:boolean;code:string;message:string;control_ready:boolean};
  } catch {
    throw new GlassportError('NATIVE_DEVICE_UNAVAILABLE','The selected iPad native readiness check failed. Keep it unlocked and its trusted connection available.',503);
  }
}
