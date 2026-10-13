import {mkdtemp,cp,symlink,mkdir,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawn} from 'node:child_process';
import net from 'node:net';

export const sourceRoot=resolve(import.meta.dirname,'..');
export async function isolatedService(){
  const root=await mkdtemp(join(tmpdir(),'glassport-verification-'));
  let child;
  try{
    for(const folder of ['apps/server','apps/web','packages'])await cp(join(sourceRoot,folder),join(root,folder),{recursive:true});
    await cp(join(sourceRoot,'package.json'),join(root,'package.json'));
    await symlink(join(sourceRoot,'node_modules'),join(root,'node_modules'),'dir');
    await mkdir(join(root,'runtime'),{mode:0o700});
    const port=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
    const origin=`http://127.0.0.1:${port}`;
    child=spawn(process.execPath,['--experimental-strip-types',join(root,'apps/server/server.ts')],{cwd:root,env:{...process.env,GLASSPORT_PORT:String(port)},stdio:['ignore','ignore','pipe']});
    let stderr='';child.stderr.on('data',data=>{stderr=(stderr+data).slice(-8192);});
    let ready=false;
    for(let attempt=0;attempt<600;attempt++){
      if(child.exitCode!==null)throw new Error(`The isolated service stopped: ${stderr}`);
      try{const r=await fetch(origin+'/health');if(r.ok&&(await r.json()).application==='Glassport'){await readFile(join(root,'runtime/mcp-access.json'));ready=true;break;}}catch{}
      await new Promise(r=>setTimeout(r,50));
    }
    if(!ready)throw new Error(`The isolated loopback service did not become ready: ${stderr}`);
    return {root,origin,async close(){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));await rm(root,{recursive:true,force:true});}};
  }catch(error){if(child&&child.exitCode===null)child.kill('SIGTERM');await rm(root,{recursive:true,force:true});throw error;}
}
