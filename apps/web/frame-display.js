const MAX_FRAME=4*1024*1024,MAX_BUFFER=8*1024*1024,MAX_HEADER=8192;

export class FrameParser {
 constructor(onFrame){this.onFrame=onFrame;this.buffer=new Uint8Array();this.expected=null;}
 push(chunk){
  if(this.buffer.length+chunk.length>MAX_BUFFER)throw new Error('The display stream exceeded its 8 MiB buffer limit.');
  const merged=new Uint8Array(this.buffer.length+chunk.length);merged.set(this.buffer);merged.set(chunk,this.buffer.length);this.buffer=merged;
  while(true){
   if(this.expected===null){
    let end=-1;for(let i=0;i<Math.min(this.buffer.length-3,MAX_HEADER);i++)if(this.buffer[i]===13&&this.buffer[i+1]===10&&this.buffer[i+2]===13&&this.buffer[i+3]===10){end=i;break;}
    if(end<0){if(this.buffer.length>MAX_HEADER)throw new Error('The display frame header exceeds 8 KiB.');return;}
    const header=new TextDecoder().decode(this.buffer.subarray(0,end));const length=/\r\nContent-Length:\s*(\d+)\r?$/im.exec(header);
    if(!header.startsWith('--GlassportFrame\r\n')||!length)throw new Error('The display stream has an invalid frame header.');
    this.expected=Number(length[1]);if(this.expected<1||this.expected>MAX_FRAME)throw new Error('The display frame exceeds its 4 MiB limit.');
    this.buffer=this.buffer.subarray(end+4);
   }
   if(this.buffer.length<this.expected+2)return;
   if(this.buffer[this.expected]!==13||this.buffer[this.expected+1]!==10)throw new Error('The display frame terminator is invalid.');
   const frame=this.buffer.slice(0,this.expected);this.buffer=this.buffer.subarray(this.expected+2);this.expected=null;this.onFrame(frame);
  }
 }
}

export class FrameDisplay {
 constructor(canvas,onFrame,onError){
  this.canvas=canvas;this.onFrame=onFrame;this.onError=onError;this.context=canvas.getContext('2d',{alpha:false});
  this.probe=document.createElement('canvas');this.probe.width=32;this.probe.height=32;this.probeContext=this.probe.getContext('2d',{willReadFrequently:true});
  this.epoch=0;this.latest=null;this.decoding=false;this.controller=null;this.frames=0;this.distinct=0;this.dropped=0;this.errors=0;this.restarts=0;this.lastPaint=0;this.lastHash=null;this.history=[];this.lastError=null;
 }
 stop(clear=false){this.epoch++;this.controller?.abort();this.controller=null;this.latest=null;this.lastPaint=0;if(clear){this.canvas.width=0;this.canvas.height=0;this.lastHash=null;}}
 current(){return this.lastPaint>0&&Date.now()-this.lastPaint<2000;}
 stats(){return {frames_rendered:this.frames,distinct_frames_rendered:this.distinct,frames_coalesced:this.dropped,render_errors:this.errors,stream_restarts:this.restarts,last_error:this.lastError,frame_age_ms:this.lastPaint?Date.now()-this.lastPaint:null,frame_pixel_size:{width:this.canvas.width,height:this.canvas.height},history:this.history};}
 async start(url,headers){
  this.stop();const epoch=this.epoch;this.controller=new AbortController();this.restarts++;const openedAt=Date.now();
  try{
   const response=await fetch(url,{headers,signal:this.controller.signal});if(!response.ok)throw new Error(`The display stream returned HTTP ${response.status}.`);
   if(!response.headers.get('content-type')?.startsWith('multipart/x-mixed-replace'))throw new Error('The display response is not a device frame stream.');
   const reader=response.body.getReader();const parser=new FrameParser(frame=>this.queue(frame,epoch));
   while(epoch===this.epoch){const next=await reader.read();if(next.done)throw new Error('The browser display stream ended.');parser.push(next.value);}
  }catch(error){if(epoch===this.epoch&&error.name!=='AbortError'){this.errors++;this.lastPaint=0;this.lastError={stage:'stream',message:error.message,at:new Date().toISOString(),stream_age_ms:Date.now()-openedAt};this.onError(error);}}
 }
 async snapshot(url,headers){
  this.stop();const epoch=this.epoch;this.controller=new AbortController();
  try{const response=await fetch(url,{headers,signal:this.controller.signal});if(!response.ok)throw new Error(`The device picture returned HTTP ${response.status}.`);const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>MAX_FRAME)throw new Error('The device picture exceeds 4 MiB.');this.queue(bytes,epoch);}catch(error){if(epoch===this.epoch&&error.name!=='AbortError'){this.errors++;this.lastPaint=0;this.onError(error);}}
 }
 queue(frame,epoch){if(epoch!==this.epoch)return;if(this.latest)this.dropped++;this.latest={frame,epoch};void this.paintLatest();}
 async paintLatest(){
  if(this.decoding)return;this.decoding=true;let activeEpoch=this.epoch;
  try{
   while(this.latest){
    const {frame,epoch}=this.latest;activeEpoch=epoch;this.latest=null;let bitmap;
    try{
     bitmap=await createImageBitmap(new Blob([frame]));if(epoch!==this.epoch)continue;
     if(bitmap.width*bitmap.height>24000000)throw new Error('The decoded device picture exceeds 24 million pixels.');
     if(this.canvas.width!==bitmap.width||this.canvas.height!==bitmap.height){this.canvas.width=bitmap.width;this.canvas.height=bitmap.height;}
     this.context.drawImage(bitmap,0,0);this.probeContext.drawImage(bitmap,0,0,32,32);
     const pixels=this.probeContext.getImageData(0,0,32,32).data;let hash=2166136261;for(const byte of pixels)hash=Math.imul(hash^byte,16777619)>>>0;
     await new Promise(resolve=>requestAnimationFrame(resolve));if(epoch!==this.epoch)continue;
     this.frames++;if(hash!==this.lastHash){this.distinct++;this.lastHash=hash;}this.lastPaint=Date.now();
     const second=Math.floor(this.lastPaint/1000);if(this.history.at(-1)?.second===second)this.history[this.history.length-1]={second,frames:this.frames,distinct:this.distinct};else this.history.push({second,frames:this.frames,distinct:this.distinct});if(this.history.length>120)this.history.shift();
     this.onFrame(this.stats());
    }finally{bitmap?.close();}
   }
  }catch(error){if(activeEpoch===this.epoch){this.errors++;this.lastPaint=0;this.lastError={stage:'decode',message:error.message,at:new Date().toISOString()};this.onError(error);}}finally{this.decoding=false;}
 }
}
