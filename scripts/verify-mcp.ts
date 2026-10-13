import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const client=new Client({name:'glassport-protocol-verification',version:'0.2.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[process.env.GLASSPORT_MCP_BUNDLE??join(root,'apps/mcp/glassport.mjs')],cwd:root,env:{...process.env as Record<string,string>,GLASSPORT_WORKSPACE:root},stderr:'pipe'});
let stderr='';transport.stderr?.on('data',chunk=>{stderr+=String(chunk);if(stderr.length>8192)stderr=stderr.slice(-8192);});
function value(result:any){assert.equal(result.isError??false,false,JSON.stringify(result));return JSON.parse(result.content.find((item:any)=>item.type==='text').text);}
try{
 await client.connect(transport);
 const listed=await client.listTools();assert.ok(listed.tools.length>=19);assert.ok(listed.tools.some(tool=>tool.name==='glassport_type'));
 const opened=value(await client.callTool({name:'glassport_open',arguments:{}}));assert.equal(opened.browser_url,'http://127.0.0.1:43180');
 const state=value(await client.callTool({name:'glassport_status',arguments:{}}));
 const inventory=value(await client.callTool({name:'glassport_artifacts',arguments:{}}));
 const file=inventory.artifacts.find((item:any)=>item.sha256==='fb866eacda942f2a843d06cb8ad7e6a59353c0f3004a62eee01908e85e5ddf5b');assert.ok(file,'The physical iPad file proof must exist.');
 const returned=await client.callTool({name:'glassport_read_artifact',arguments:{artifact_id:file.artifact_id}}) as any;assert.equal(returned.isError??false,false);const metadata=JSON.parse(returned.content[0].text);assert.equal(metadata.sha256,file.sha256);assert.equal(metadata.bytes,166);assert.equal(returned.content[1].text,await readFile(join(root,'private-evidence/physical-file-browser-download.txt'),'utf8'));
 const access=JSON.parse(await readFile(join(root,'runtime/mcp-access.json'),'utf8'));assert.equal((await stat(join(root,'runtime/mcp-access.json'))).mode&0o777,0o600);
 const forbidden=await fetch(opened.browser_url+'/api/connect',{method:'POST',headers:{Origin:opened.browser_url,'X-Glassport-MCP':access.credential,'X-Glassport-CSRF':access.credential},body:'{}'});assert.equal(forbidden.status,403);assert.equal((await forbidden.json() as any).error.code,'MCP_ENDPOINT_FORBIDDEN');
 const unauth=await fetch(opened.browser_url+'/api/state',{headers:{'X-Glassport-MCP':'0'.repeat(64)}});assert.equal(unauth.status,401);
 const crossOrigin=await fetch(opened.browser_url+'/api/state',{headers:{Origin:'https://example.invalid','X-Glassport-MCP':access.credential}});assert.equal(crossOrigin.status,403);
 const after=value(await client.callTool({name:'glassport_status',arguments:{}}));assert.equal(after.generation,state.generation);
 const receipt={checked_at:new Date().toISOString(),status:'REAL_MCP_PROTOCOL_AND_SAVED_DEVICE_FILE_PASS',protocol:'Official MCP SDK stdio client/server',server_version:client.getServerVersion(),tools:listed.tools.map(tool=>tool.name),application:'Actual Glassport service; native device adapter, no mock connection',current_device_state:state.state,current_device_input_verified:false,physical_export_retrieved:{bytes:166,sha256:file.sha256,exact_text_match:true,source:'Previously verified actual iPad-created export; saved-artifact coverage, not current live device content'},authentication:{private_credential_mode:'0600',bad_credential:401,foreign_origin:403,forbidden_connect:403,device_generation_unchanged:true},stdout:'MCP JSON-RPC only; launcher output isolated',stderr_present:stderr.length>0};
 await writeFile(join(root,'records/mcp-protocol-proof.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt,null,2));
}finally{await client.close();}
