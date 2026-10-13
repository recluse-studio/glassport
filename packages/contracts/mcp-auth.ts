import {randomBytes,timingSafeEqual} from 'node:crypto';
import {writeFile,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {GlassportError} from './core.ts';
export class McpAccess {
  private secret=randomBytes(32).toString('hex');
  private expires=Date.now()+12*60*60*1000;
  async publish(root:string,origin:string){const file=join(root,'runtime/mcp-access.json');await writeFile(file,JSON.stringify({origin,credential:this.secret,expires_at:new Date(this.expires).toISOString()})+'\n',{mode:0o600});await chmod(file,0o600);}
  controller(credential:unknown,path:string,method:string,owner:string|null){
    const supplied=typeof credential==='string'?Buffer.from(credential):Buffer.alloc(0),expected=Buffer.from(this.secret);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected)||Date.now()>=this.expires)throw new GlassportError('UNAUTHORIZED','The local MCP credential is invalid or expired.',401);
    const reads=new Set(['/api/state','/api/frame','/api/devices','/api/apps','/api/artifacts','/api/diagnostics']);
    const writes=new Set(['/api/observe','/api/action','/api/text','/api/files','/api/import-file','/api/capture','/api/collect','/api/save-collection','/api/clear','/api/disconnect']);
    if(!(method==='GET'&&(reads.has(path)||/^\/api\/artifacts\/[a-f0-9-]{36}$/.test(path)))&&!(method==='POST'&&writes.has(path)))throw new GlassportError('MCP_ENDPOINT_FORBIDDEN','The MCP bridge does not permit this endpoint.',403);
    if(!owner&&((method==='POST')||['/api/apps','/api/frame'].includes(path)))throw new GlassportError('BROWSER_SESSION_REQUIRED','Open Glassport in the browser and connect the iPad before using device tools.',409);
    return {id:owner??'disconnected-mcp',csrf:this.secret};
  }
}
