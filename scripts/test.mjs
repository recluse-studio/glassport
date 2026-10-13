import {spawn} from 'node:child_process';
import {mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {isolatedService,sourceRoot} from './isolated-service.mjs';
const service=await isolatedService();
try{
  await mkdir(join(sourceRoot,'tests/fixtures'),{recursive:true});
  const files=(await readdir(join(sourceRoot,'tests'))).filter(n=>/\.test\.(ts|js)$/.test(n)).map(n=>join(sourceRoot,'tests',n));
  const child=spawn(process.execPath,['--experimental-strip-types','--test',...files],{cwd:sourceRoot,env:{...process.env,GLASSPORT_TEST_ORIGIN:service.origin},stdio:'inherit'});
  process.exitCode=await new Promise((resolve,reject)=>{child.once('exit',code=>resolve(code??1));child.once('error',reject);});
}finally{await service.close();}
