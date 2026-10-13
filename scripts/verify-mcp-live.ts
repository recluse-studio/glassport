import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {readFile,writeFile} from 'node:fs/promises';import {join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
const root=resolve(fileURLToPath(new URL('..',import.meta.url))),client=new Client({name:'glassport-physical-mcp-proof',version:'0.2.0'});
const transport=new StdioClientTransport({command:process.execPath,args:['--experimental-strip-types',join(root,'apps/mcp/server.ts')],cwd:root,env:{...process.env as Record<string,string>,GLASSPORT_WORKSPACE:root},stderr:'pipe'});
function value(result:any){assert.equal(result.isError??false,false,JSON.stringify(result));return JSON.parse(result.content[0].text);}
async function view(name:string){const result=await client.callTool({name:'glassport_view',arguments:{}},undefined, {timeout:120000}) as any;const metadata=value(result);const image=result.content.find((item:any)=>item.type==='image');assert.ok(image);await writeFile(join(root,'private-evidence',name),Buffer.from(image.data,'base64'),{mode:0o600});return metadata.observation;}
try{
 await client.connect(transport);const state=value(await client.callTool({name:'glassport_status',arguments:{}}));assert.equal(state.state,'READY','Connect the actual iPad in the browser first.');
 const before=await view('mcp-live-before.jpg');
 const installed=value(await client.callTool({name:'glassport_apps',arguments:{}}));assert.ok(installed.apps['com.apple.mobiletimer']);const returnApp=Object.entries(installed.apps).find(([id,item])=>id.startsWith('com.openai.')&&((item as any).CFBundleDisplayName==='ChatGPT'||(item as any).CFBundleName==='ChatGPT'))?.[0];
 const opened=value(await client.callTool({name:'glassport_open_app',arguments:{bundleId:'com.apple.mobiletimer',generation:before.generation}}));assert.equal(opened.status,'DISPATCHED');
 const clock=await view('mcp-live-clock.jpg');
 const target={x:clock.logical_bounds.width*.4557,y:clock.logical_bounds.height*.0453,generation:clock.generation};
 const tapped=value(await client.callTool({name:'glassport_tap',arguments:target}));assert.equal(tapped.status,'DISPATCHED');
 const after=await view('mcp-live-after-tap.jpg');assert.ok(after.generation>before.generation);
 const clipboard=await client.callTool({name:'glassport_clipboard',arguments:{fresh_copy:false}},undefined,{timeout:120000}) as any;const copied=value(clipboard);await writeFile(join(root,'private-evidence/mcp-live-clipboard.json'),JSON.stringify(copied,null,2)+'\n',{mode:0o600});
 const receipt={checked_at:new Date().toISOString(),status:'PHYSICAL_MCP_DISPLAY_AND_CONTROL_DISPATCH_PASS',route:'MCP SDK client -> stdio server -> authenticated Glassport HTTP -> same browser-owned actual native iPad session',mock:false,screen_recognition:false,before_orientation:before.orientation,logical_bounds:before.logical_bounds,frame_pixel_size:before.frame_pixel_size,opened_app:'com.apple.mobiletimer',native_open_ack:opened.status,native_tap_ack:tapped.status,generation_before:before.generation,generation_after:after.generation,clipboard:{method:copied.method,characters:copied.text.length,coverage:copied.coverage,current_app_claim:false},visual_outcome:'Requires correlated actual Codex browser inspection; pending',return_app:returnApp??null,evidence:['private-evidence/mcp-live-before.jpg','private-evidence/mcp-live-clock.jpg','private-evidence/mcp-live-after-tap.jpg','private-evidence/mcp-live-clipboard.json']};
 await writeFile(join(root,'records/mcp-live-proof.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify({...receipt,clipboard:{method:copied.method,characters:copied.text.length}},null,2));
}finally{await client.close();}
