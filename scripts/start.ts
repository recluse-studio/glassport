import {spawn,execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,open,stat,rename} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import net from 'node:net';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const runtime=join(root,'runtime');await mkdir(runtime,{recursive:true,mode:0o700});
async function available(port:number){return new Promise<void>((resolve,reject)=>{const probe=net.createServer();probe.once('error',()=>reject(new Error(`Port ${port} is occupied. Inspect its listener with lsof -nP -iTCP:${port} -sTCP:LISTEN; Glassport will leave it running.`)));probe.listen(port,'127.0.0.1',()=>probe.close(()=>resolve()));});}
let configured:{devices?:Array<{privateIngressVerified?:boolean}>}={};try{configured=JSON.parse(await readFile(join(runtime,'device-config.json'),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const useAppium=configured.devices?.some(device=>device.privateIngressVerified===true)===true;
for(const port of useAppium?[4723,43180]:[43180])await available(port);
const children:ReturnType<typeof spawn>[]=[];let stopping=false;
async function launch(name:string,args:string[],env:NodeJS.ProcessEnv){
  const path=join(runtime,`${name}.log`);const file=await open(path,'w',0o600);let size=0;
  const child=spawn(process.execPath,args,{cwd:root,env,stdio:['ignore','pipe','pipe']});children.push(child);
  await writeFile(join(runtime,`${name}.pid`),String(child.pid),{mode:0o600});
  let writing=Promise.resolve();function append(chunk:Buffer){writing=writing.then(async()=>{if(size+chunk.length>2*1024*1024){await file.truncate(0);size=0;}await file.write(chunk,0,chunk.length,size);size+=chunk.length;}).catch(()=>{});}
  child.stdout?.on('data',append);child.stderr?.on('data',append);
  child.once('error',()=>{console.error(`${name} could not launch.`);shutdown(1);});
  child.once('exit',code=>{if(!stopping){console.error(`${name} exited (${code}). See runtime/${name}.log.`);shutdown(1);}writing.finally(()=>file.close());});return child;
}
function shutdown(code=0){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>{for(const child of children)if(child.exitCode===null)child.kill('SIGKILL');process.exit(code);},6000).unref();}
process.on('SIGTERM',()=>shutdown());process.on('SIGINT',()=>shutdown());
await writeFile(join(runtime,'launcher.pid'),String(process.pid),{mode:0o600});
if(useAppium){
  await launch('appium',[join(root,'node_modules/appium/index.js'),'--address','127.0.0.1','--port','4723','--log-level','warn'],{...process.env,APPIUM_HOME:join(root,'.local/appium')});
  let ready=false;for(let attempt=0;attempt<240&&!stopping;attempt++){try{const response=await fetch('http://127.0.0.1:4723/status',{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}
  if(!ready){shutdown(1);throw new Error('Owned Appium did not become ready. See runtime/appium.log.');}
}
await launch('server',['--experimental-strip-types',join(root,'apps/server/server.ts')],{...process.env});
console.log('Glassport is starting at http://127.0.0.1:43180. Keep this command running; stop with scripts/stop.sh or Ctrl+C.');
