import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {z} from 'zod';
import type {RequestHandlerExtra} from '@modelcontextprotocol/sdk/shared/protocol.js';
import type {ServerRequest,ServerNotification} from '@modelcontextprotocol/sdk/types.js';
import {createHash} from 'node:crypto';
import {LocalGlassport} from './client.ts';
import {GlassportError} from '../../packages/contracts/core.ts';

export function createServer(client=new LocalGlassport()){
  const server=new McpServer({name:'glassport',version:'0.2.1'},{maxToolInputElements:128});let pending=0;
  const readonly={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false};
  const localWrite={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
  const deviceWrite={readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:false};
  const text=(value:unknown)=>({content:[{type:'text' as const,text:JSON.stringify(value,null,2)}]});
  function tool(name:string,description:string,inputSchema:any,annotations:any,handler:(args:any)=>Promise<any>){
    server.registerTool(name,{description,inputSchema,annotations},async (args:any,extra:RequestHandlerExtra<ServerRequest,ServerNotification>)=>{if(pending>=16)return {...text({code:'QUEUE_FULL',message:'Wait for the current Glassport tools to finish.'}),isError:true};pending++;const began=Date.now();const progress=extra._meta?.progressToken===undefined?null:setInterval(()=>{void extra.sendNotification({method:'notifications/progress',params:{progressToken:extra._meta!.progressToken!,progress:Math.floor((Date.now()-began)/1000),message:'Glassport is waiting for the actual local device operation.'}}).catch(()=>{});},5000);try{return await handler(args);}catch(error){return {...text({code:error instanceof GlassportError?error.code:'MCP_OPERATION_FAILED',message:error instanceof GlassportError?error.message:'The Glassport operation failed. Inspect local diagnostics.'}),isError:true};}finally{if(progress)clearInterval(progress);pending--;}});
  }
  const generation=z.number().int().nonnegative().describe('Generation from the latest glassport_view or successful device action. Changed generations are rejected.');
  const command_id=z.string().uuid().optional().describe('Optional command identity. Never repeat uncertain input automatically.');
  async function act(kind:string,parameters:Record<string,unknown>,args:any){const result=await client.action(kind,parameters,args.generation,args.command_id);return {...text(result),isError:!['DISPATCHED','SUCCEEDED'].includes(result.status)};}
  tool('glassport_configure','Select an existing persistent Glassport installation. No dependencies, trust or device settings are changed.',{workspace:z.string().min(1).max(1024)},localWrite,async args=>text(await client.configure(args.workspace)));
  tool('glassport_open','Start or reuse the local Glassport app and return its browser URL. Open it with Codex browser tools and connect the physical iPad there.',{},localWrite,async()=>text(await client.open()));
  tool('glassport_status','Read the actual local connection, owner and stream state. This does not acquire an iPad session.',{},readonly,async()=>text(await client.request('/api/state')));
  tool('glassport_devices','List discovered physical device metadata and supported connection readiness.',{},readonly,async()=>text(await client.request('/api/devices')));
  tool('glassport_view','Return a fresh actual iPad image and logical geometry from the browser-owned session. Use the geometry for pointer coordinates; no OCR.',{},readonly,async()=>{const observation=await client.request('/api/observe','POST',{});const image=await client.request('/api/frame','GET',undefined,true);return {content:[{type:'text',text:JSON.stringify({observation,coverage:'Current physical iPad picture; no text recognition.'},null,2)},{type:'image',data:image.bytes.toString('base64'),mimeType:image.media_type}]};});
  tool('glassport_capture','Explicitly save the current physical iPad picture with observation provenance. Ordinary glassport_view does not save a capture.',{},localWrite,async()=>text(await client.request('/api/capture','POST',{})));
  tool('glassport_apps','List installed iPad apps and exact configured Teams, Outlook and Copilot bundles.',{},readonly,async()=>text(await client.request('/api/apps')));
  tool('glassport_tap','Tap, double-tap or hold a logical iPad point after inspecting the live picture. Requires the existing browser-owned session. Never replay uncertain input.',{x:z.number().nonnegative(),y:z.number().nonnegative(),gesture:z.enum(['tap','double_tap','hold']).default('tap'),duration:z.number().min(.1).max(3).optional(),generation,command_id},deviceWrite,async args=>act(args.gesture,{x:args.x,y:args.y,...(args.duration===undefined?{}:{duration:args.duration})},args));
  tool('glassport_swipe','Swipe between logical iPad points in the same current browser session.',{fromX:z.number().nonnegative(),fromY:z.number().nonnegative(),toX:z.number().nonnegative(),toY:z.number().nonnegative(),duration:z.number().min(.1).max(3).default(.35),generation,command_id},deviceWrite,async args=>act('swipe',{fromX:args.fromX,fromY:args.fromY,toX:args.toX,toY:args.toY,duration:args.duration},args));
  tool('glassport_type','Paste exact text into the currently focused iPad field. This never adds Enter or authorizes a send. Inspect focus first.',{text:z.string().min(1).max(8192),generation,command_id},deviceWrite,async args=>act('type_text',{text:args.text},args));
  tool('glassport_key','Send a separate native key. Enter may submit content and requires the specific user authorization for that action.',{key:z.enum(['Enter','Backspace','Escape','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Copy','SelectAll']),generation,command_id},deviceWrite,async args=>act('key',{key:args.key},args));
  tool('glassport_open_app','Open an exact installed bundle, retaining app accounts and data.',{bundleId:z.string().min(1).max(180).regex(/^[A-Za-z0-9._-]+$/),generation,command_id},deviceWrite,async args=>act('open_app',{bundleId:args.bundleId},args));
  tool('glassport_clipboard','Read actual native public clipboard text. For a newly selected copy, set fresh_copy=true; this sends Copy and requires a changed clipboard. Existing clipboard reads may describe an earlier copy. Rich formats can take up to 90 seconds.',{fresh_copy:z.boolean().default(false),generation:generation.optional()},localWrite,async args=>{if(args.fresh_copy){if(args.generation===undefined)throw new GlassportError('INVALID_ARGUMENT','A fresh copy requires the current iPad generation.');const result=await client.action('key',{key:'Copy'},args.generation);if(!['DISPATCHED','SUCCEEDED'].includes(result.status))return {...text(result),isError:true};}return text(await client.request('/api/text','POST',{require_fresh_copy:args.fresh_copy}));});
  tool('glassport_documents','Browse a selected installed app’s supported Documents sharing area. This does not expose arbitrary private containers.',{bundleId:z.string().min(1).max(180),path:z.string().max(1024).default('Documents')},readonly,async args=>text(await client.request('/api/files','POST',args)));
  tool('glassport_import_file','Import an actual supported iPad export from its Documents sharing area. Source and received bytes and hash must match; at most 32 MiB.',{bundleId:z.string().min(1).max(180),path:z.string().min(1).max(1024)},localWrite,async args=>text(await client.request('/api/import-file','POST',args)));
  tool('glassport_artifacts','List explicitly saved captures, copied-note collections and imported files with provenance references and verified hashes.',{},readonly,async()=>text(await client.request('/api/artifacts')));
  tool('glassport_read_artifact','Return an explicitly saved artifact with exact hash and coverage. Saved material is not a current live app view. Images and plain text return directly; other formats remain available in the browser.',{artifact_id:z.string().uuid()},readonly,async args=>{const result=await client.request(`/api/artifacts/${args.artifact_id}`,'GET',undefined,true);const metadata={artifact_id:args.artifact_id,bytes:result.bytes.length,sha256:createHash('sha256').update(result.bytes).digest('hex'),media_type:result.media_type,coverage:'Explicit saved artifact; not a current device view.'};if(/^image\/(png|jpeg)(;|$)/.test(result.media_type)&&result.bytes.length<=4*1024*1024)return {content:[...text(metadata).content,{type:'image',data:result.bytes.toString('base64'),mimeType:result.media_type}]};if(/^(text\/|application\/json)/.test(result.media_type)){const value=result.bytes.toString('utf8');return {content:[...text({...metadata,truncated:value.length>262144}).content,{type:'text',text:value.slice(0,262144)}]};}return text(metadata);});
  tool('glassport_collect','Append current native copied text to an ordered collection. Repeated source lines remain present.',{collection_id:z.string().uuid().optional()},localWrite,async args=>text(await client.request('/api/collect','POST',args)));
  tool('glassport_save_collection','Explicitly save an ordered clipboard collection as local Markdown with provenance.',{collection_id:z.string().uuid()},localWrite,async args=>text(await client.request('/api/save-collection','POST',args)));
  return server;
}

if(import.meta.url===new URL(process.argv[1]??'',`file://${process.cwd()}/`).href){
  const server=createServer();const transport=new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:65536});
  await server.connect(transport);
  process.stdin.once('end',()=>{void server.close();});
  process.once('SIGTERM',()=>{void server.close().finally(()=>process.exit(0));});
  process.once('SIGINT',()=>{void server.close().finally(()=>process.exit(0));});
}
