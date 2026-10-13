import {randomUUID} from 'node:crypto';
import type {DeviceAdapter} from '../../packages/device/adapter.ts';
import type {Device} from '../../packages/device/discovery.ts';
import {CommandJournal,GlassportError,validateAction,formatError} from '../../packages/contracts/core.ts';
import type {Observation,Action,Result} from '../../packages/contracts/core.ts';
import {imageSize} from '../../packages/device/image-size.ts';
import {MjpegReader} from '../../packages/device/media.ts';
import {extractTree} from '../../packages/device/extraction.ts';
export class DeviceSession {
  adapter:DeviceAdapter; owner:string|null=null; state='DISCONNECTED'; generation=0; device:Device|null=null; observation:Observation|null=null;frame:Buffer|null=null;error:{code:string;message:string}|null=null;
  media=new MjpegReader();journal=new CommandJournal();private observations=new Map<string,Observation>();private epoch=0;private observing:Promise<Observation>|null=null;
  constructor(adapter:DeviceAdapter){this.adapter=adapter;}
  assertOwner(owner:string){if(this.owner!==owner)throw new GlassportError(this.owner?'CONTROLLER_BUSY':'SESSION_EXPIRED',this.owner?'Another browser session owns the iPad.':'Connect to the iPad first.',409);}
  async connect(device:Device,owner:string){if(this.owner)throw new GlassportError('CONTROLLER_BUSY','Another browser session owns the iPad.',409);if(['CONNECTING','DISCONNECTING'].includes(this.state))throw new GlassportError('CONTROLLER_BUSY','An iPad connection transition is already in progress.',409);this.owner=owner;this.device=device;this.state='CONNECTING';this.error=null;const epoch=++this.epoch;const adapter=this.adapter;
    try{await adapter.connect(device);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The connection was cancelled.',409);this.generation++;this.media.start(adapter.mediaUrl??'http://127.0.0.1:9100',adapter.mediaHeaders);await this.observe(owner);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The connection was cancelled.',409);this.state='READY';return this.public();}
    catch(e){if(epoch!==this.epoch){await adapter.disconnect();throw new GlassportError('SESSION_EXPIRED','The connection was cancelled.',409);}this.state=e instanceof GlassportError&&e.code==='DEVICE_LOCKED'?'LOCKED':'SETUP_REQUIRED';this.error=formatError(e);this.media.stop();this.frame=null;this.observation=null;this.observations.clear();await adapter.disconnect();this.owner=null;throw e;}
  }
  async disconnect(owner:string){if(this.owner)this.assertOwner(owner);this.epoch++;this.observing=null;this.state='DISCONNECTING';this.owner=null;this.generation++;this.media.stop();await this.adapter.disconnect();this.device=null;this.observation=null;this.observations.clear();this.journal=new CommandJournal();this.frame=null;this.error=null;this.state='DISCONNECTED';}
  public(){return {state:this.state,generation:this.generation,device:this.device?{device_ref:this.device.device_ref,name:this.device.name,transport:this.device.transport,os_version:this.device.os_version}:null,observation:this.observation,error:this.error,control_available:this.state==='READY'&&!!this.owner,extraction_available:this.state==='READY',command_cache_size:this.journal.size,media:{frames:this.media.frames,bytes:this.media.bytes,last_frame_at:this.media.lastFrameAt?new Date(this.media.lastFrameAt).toISOString():null,error:this.media.error}};}
  async observe(owner:string):Promise<Observation>{this.assertOwner(owner);if(this.observing)return this.observing;const epoch=this.epoch;const adapter=this.adapter;
    this.observing=(async()=>{try{
      if(this.media.error&&adapter.mediaUrl)this.media.start(adapter.mediaUrl,adapter.mediaHeaders);const geometry=await adapter.geometry();if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The device session changed.',409);const frame=this.media.frame&&Date.now()-this.media.lastFrameAt<1000?this.media.frame:await adapter.screenshot();if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The device session changed.',409);
      if(this.observation&&(geometry.app!==this.observation.app_ref||geometry.orientation!==this.observation.orientation||JSON.stringify(geometry.bounds)!==JSON.stringify(this.observation.logical_bounds)))this.generation++;
      const pixelSize=imageSize(frame);
      const observation:Observation={observation_id:randomUUID(),generation:this.generation,captured_at:new Date().toISOString(),app_ref:geometry.app,orientation:geometry.orientation,logical_bounds:geometry.bounds,frame_pixel_size:pixelSize,freshness:'CURRENT'};
      this.frame=frame;this.observation=observation;this.observations.set(observation.observation_id,observation);while(this.observations.size>8)this.observations.delete(this.observations.keys().next().value!);
      if(this.state==='DEGRADED'||this.state==='RECONNECTING'){this.state='READY';this.error=null;}return observation;
    }catch(e){if(epoch===this.epoch){this.state='DEGRADED';this.error=formatError(e);}throw e;}finally{if(epoch===this.epoch)this.observing=null;}})();return this.observing;
  }
  async act(owner:string,action:Action):Promise<Result>{this.assertOwner(owner);if(this.state!=='READY')throw new GlassportError('INPUT_UNAVAILABLE','Current device control is unavailable.',409);const epoch=this.epoch;
    return this.journal.run(action,async()=>{const accepted_at=new Date().toISOString();let dispatched=false;try{this.assertOwner(owner);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The input session changed.',409);const obs=this.observations.get(action.observation_id);if(!obs||obs.generation!==this.generation)throw new GlassportError('STALE_OBSERVATION','Refresh the iPad picture before acting.',409);validateAction(action,obs);
      // Revalidate app/orientation before dispatch; backend acceptance alone is not visual proof.
      const current=await this.adapter.geometry();if(current.app!==obs.app_ref||current.orientation!==obs.orientation||JSON.stringify(current.bounds)!==JSON.stringify(obs.logical_bounds))throw new GlassportError('STALE_OBSERVATION','The app or device geometry changed. Refresh before acting.',409);
      this.assertOwner(owner);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The input session changed before dispatch.',409);dispatched=true;await this.adapter.action(action);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The input session changed during dispatch.',409);this.generation++;this.observations.clear();const observation=await this.observe(owner);return {command_id:action.command_id,status:'DISPATCHED',device_acknowledgement:'AWAITED',visual_outcome:'REQUIRES_INSPECTION',accepted_at,finished_at:new Date().toISOString(),observation};
    }catch(e){const error=formatError(e);return {command_id:action.command_id,status:dispatched?'UNKNOWN':'FAILED',accepted_at,finished_at:new Date().toISOString(),error};}});
  }
  async readText(owner:string,requireFreshCopy=false){const adapter=this.adapter;const epoch=this.epoch;const observation=await this.observe(owner);this.assertOwner(owner);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The device session changed before text retrieval.',409);const result=adapter.readText?await adapter.readText(observation,requireFreshCopy):extractTree(await adapter.source(),observation);this.assertOwner(owner);if(epoch!==this.epoch)throw new GlassportError('SESSION_EXPIRED','The device session changed during text retrieval.',409);return {...result,session_generation:this.generation};}
}
