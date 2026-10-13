import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {ArtifactStore} from '../packages/contracts/artifacts.ts';
// @ts-ignore JavaScript helper owns and removes its temporary application workspace.
import {isolatedService,sourceRoot} from './isolated-service.mjs';
const service=await isolatedService();
const client=new Client({name:'glassport-protocol-verification',version:'0.2.1'});
const bundle=process.env.GLASSPORT_MCP_BUNDLE??join(sourceRoot,'apps/mcp/glassport.mjs');
const transport=new StdioClientTransport({command:process.execPath,args:[bundle],cwd:sourceRoot,env:{...process.env as Record<string,string>,GLASSPORT_WORKSPACE:service.root},stderr:'pipe'});
function value(result:any){assert.equal(result.isError??false,false);return JSON.parse(result.content.find((item:any)=>item.type==='text').text);}
try{
 const synthetic=Buffer.from('Glassport protocol fixture 😀\nSecond line\n');
 const saved=await new ArtifactStore(join(service.root,'exports')).save(synthetic,'device_file','text/plain','txt',{source:'Synthetic local fixture; no device connection'},'fixture.txt');
 await client.connect(transport);
 const listed=await client.listTools();assert.equal(listed.tools.length,19);assert.ok(listed.tools.some(tool=>tool.name==='glassport_type'));
 const opened=value(await client.callTool({name:'glassport_open',arguments:{}}));assert.equal(opened.browser_url,service.origin);
 const state=value(await client.callTool({name:'glassport_status',arguments:{}}));assert.equal(state.state,'DISCONNECTED');
 const inventory=value(await client.callTool({name:'glassport_artifacts',arguments:{}}));assert.ok(inventory.artifacts.some((a:any)=>a.artifact_id===saved.artifact_id));
 const returned=await client.callTool({name:'glassport_read_artifact',arguments:{artifact_id:saved.artifact_id}}) as any;
 const metadata=value(returned);assert.equal(metadata.sha256,saved.sha256);assert.equal(metadata.bytes,synthetic.length);assert.equal(returned.content[1].text,synthetic.toString('utf8'));
 const view=await client.callTool({name:'glassport_view',arguments:{}}) as any;assert.equal(view.isError,true);
 const access=JSON.parse(await readFile(join(service.root,'runtime/mcp-access.json'),'utf8'));assert.equal((await stat(join(service.root,'runtime/mcp-access.json'))).mode&0o777,0o600);
 const forbidden=await fetch(service.origin+'/api/connect',{method:'POST',headers:{Origin:service.origin,'X-Glassport-MCP':access.credential,'X-Glassport-CSRF':access.credential},body:'{}'});assert.equal(forbidden.status,403);assert.equal((await forbidden.json() as any).error.code,'MCP_ENDPOINT_FORBIDDEN');
 const unauth=await fetch(service.origin+'/api/state',{headers:{'X-Glassport-MCP':'0'.repeat(64)}});assert.equal(unauth.status,401);
 const cross=await fetch(service.origin+'/api/state',{headers:{Origin:'https://example.invalid','X-Glassport-MCP':access.credential}});assert.equal(cross.status,403);
 assert.equal(value(await client.callTool({name:'glassport_status',arguments:{}})).generation,state.generation);
 console.log(JSON.stringify({status:'PASS',tools:listed.tools.length,stdio_handshake:true,synthetic_artifact_exact:true,unsafe_access_rejected:true,workspace_override_isolated:true,device_connected:false,physical_device_claim:false}));
}finally{await client.close();await service.close();}
