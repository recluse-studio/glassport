import {readFile,lstat,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {openSync,closeSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {homedir} from 'node:os';
import {GlassportError} from '../../packages/contracts/core.ts';
export class LocalGlassport {
  root:string;private configuration:string;
  constructor(root=process.env.GLASSPORT_WORKSPACE??resolve(fileURLToPath(new URL('../..',import.meta.url)))){
    this.root=resolve(root);this.configuration=join(homedir(),'.local','share','glassport','mcp-workspace.json');
  }
  async load(){try{const saved=JSON.parse(await readFile(this.configuration,'utf8'));if(typeof saved.workspace==='string')this.root=resolve(saved.workspace);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new GlassportError('CONFIG_INVALID','The MCP workspace configuration cannot be read.');}}
  async configure(workspace:string){const root=resolve(workspace),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));if(manifest.name!=='glassport')throw new GlassportError('CONFIG_INVALID','Select the Glassport installation folder.');await lstat(join(root,'apps/server/server.ts'));await mkdir(resolve(this.configuration,'..'),{recursive:true,mode:0o700});await writeFile(this.configuration,JSON.stringify({workspace:root})+'\n',{mode:0o600});this.root=root;return {workspace:root,configured:true};}
  private async access(){await this.load();const path=join(this.root,'runtime/mcp-access.json');let status;try{status=await lstat(path);}catch{throw new GlassportError('LOCAL_SERVICE_OFFLINE','Start the local Glassport service with glassport_open or scripts/start.sh.',503);}if(!status.isFile()||status.isSymbolicLink()||(status.mode&0o077)!==0)throw new GlassportError('MCP_CREDENTIAL_UNSAFE','The local MCP credential must be a private regular file.',403);const value=JSON.parse(await readFile(path,'utf8'));const origin=new URL(value.origin);if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.username||origin.password||origin.search||origin.hash||!/^\d+$/.test(origin.port)||!/^[a-f0-9]{64}$/.test(value.credential)||Date.parse(value.expires_at)<=Date.now())throw new GlassportError('MCP_CREDENTIAL_INVALID','The local MCP access record is invalid or expired.',401);return value;}
  async request(path:string,method='GET',body?:unknown,binary=false){
    if(!path.startsWith('/api/')||path.includes('?')||path.includes('#')||path.includes('..'))throw new GlassportError('INVALID_ARGUMENT','The MCP request path is invalid.');
    const access=await this.access();let response;try{response=await fetch(access.origin+path,{method,headers:{Origin:access.origin,'X-Glassport-MCP':access.credential,'X-Glassport-CSRF':access.credential,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(path==='/api/text'||path==='/api/collect'?100000:45000)});}catch{throw new GlassportError('LOCAL_TRANSPORT_LOST','The local Glassport request failed; input outcomes may be uncertain. Do not replay the command.',503);}
    if(!response.ok){let result:any;try{result=await response.json();}catch{}throw new GlassportError(result?.error?.code??'LOCAL_REQUEST_FAILED',result?.error?.message??'The local Glassport request failed.',response.status);}
    if(binary){const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>32*1024*1024)throw new GlassportError('PAYLOAD_TOO_LARGE','The saved artifact exceeds 32 MiB.');return {bytes,media_type:response.headers.get('content-type')??'application/octet-stream'};}
    return response.json();
  }
  async open(){await this.load();try{await this.request('/api/state');const access=await this.access();return {browser_url:access.origin,workspace:this.root,ready:true};}catch(error){if(error instanceof GlassportError&&!['LOCAL_SERVICE_OFFLINE','LOCAL_TRANSPORT_LOST','MCP_CREDENTIAL_INVALID'].includes(error.code))throw error;}
    await mkdir(join(this.root,'runtime'),{recursive:true,mode:0o700});const output=openSync(join(this.root,'runtime/mcp-launcher.log'),'a',0o600);let child;try{child=spawn(process.execPath,['--experimental-strip-types',join(this.root,'scripts/start.ts')],{cwd:this.root,detached:true,stdio:['ignore',output,output]});child.unref();}finally{closeSync(output);}
    const deadline=Date.now()+30000;while(Date.now()<deadline){try{await this.request('/api/state');const access=await this.access();return {browser_url:access.origin,workspace:this.root,ready:true};}catch{}await new Promise(resolve=>setTimeout(resolve,250));}throw new GlassportError('LOCAL_START_FAILED','Glassport did not start within 30 seconds. Inspect the exact port listener and runtime/server.log.',503);
  }
  async action(kind:string,parameters:Record<string,unknown>,generation:number,commandId=randomUUID()){
    const observation=await this.request('/api/observe','POST',{});if(observation.generation!==generation)throw new GlassportError('STALE_OBSERVATION','The iPad session changed. Get a new glassport_view before input.',409);
    return this.request('/api/action','POST',{command_id:commandId,observation_id:observation.observation_id,generation,kind,parameters});
  }
}
