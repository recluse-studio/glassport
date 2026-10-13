import {createHash} from 'node:crypto';

export class GlassportError extends Error {
  code: string; httpStatus: number;
  constructor(code: string, message: string, httpStatus = 400) {
    super(message); this.code = code; this.httpStatus = httpStatus;
  }
}
export type Rect = {x: number; y: number; width: number; height: number};
export type Observation = {observation_id: string; generation: number; captured_at: string; app_ref: string | null; orientation: string; logical_bounds: Rect; frame_pixel_size: {width: number; height: number}; freshness: string};
export type Action = {command_id: string; observation_id: string; generation: number; kind: string; parameters: Record<string, unknown>};
export function finite(value: unknown, name: string, min = 0, max = 100000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new GlassportError('INVALID_ARGUMENT', `${name} must be a number from ${min} to ${max}.`);
  return value;
}
export function boundedText(value: unknown, name: string, max = 8192): string {
  if (typeof value !== 'string' || !value.length || value.length > max) throw new GlassportError('INVALID_ARGUMENT', `${name} must contain 1 to ${max} characters.`);
  return value;
}
export function mapPoint(client: {x:number;y:number}, content: Rect, logical: Rect): {x:number;y:number} {
  finite(client.x,'Pointer X',-100000);finite(client.y,'Pointer Y',-100000);
  if (content.width <= 0 || content.height <= 0 || client.x < content.x || client.y < content.y || client.x >= content.x + content.width || client.y >= content.y + content.height) throw new GlassportError('OUT_OF_BOUNDS','The pointer is outside the iPad picture.');
  return {x: logical.x + (client.x-content.x)/content.width*logical.width, y: logical.y + (client.y-content.y)/content.height*logical.height};
}
export function validateAction(action: Action, observation: Observation): void {
  if(!action||typeof action!=='object'||!action.parameters||typeof action.parameters!=='object'||Array.isArray(action.parameters))throw new GlassportError('INVALID_ARGUMENT','The input action must have a parameter object.');
  boundedText(action.command_id,'Command ID',80);
  if (action.generation !== observation.generation) throw new GlassportError('STALE_OBSERVATION','The iPad context changed. Refresh the picture before acting.',409);
  const age = Date.now()-Date.parse(observation.captured_at);
  if (!Number.isFinite(age) || age < -1000 || age > 2500) throw new GlassportError('STALE_OBSERVATION','The iPad picture is stale. Refresh it before acting.',409);
  const p = action.parameters; const rect=observation.logical_bounds;
  function point(x: unknown,y: unknown) {
    const a=finite(x,'X'),b=finite(y,'Y');
    if(a<rect.x||b<rect.y||a>=rect.x+rect.width||b>=rect.y+rect.height) throw new GlassportError('OUT_OF_BOUNDS','The action is outside the current device viewport.');
  }
  switch(action.kind){
    case 'tap': case 'double_tap': case 'hold': point(p.x,p.y);if(action.kind==='hold') finite(p.duration??0.6,'Hold duration',0.1,3);break;
    case 'swipe': point(p.fromX,p.fromY);point(p.toX,p.toY);finite(p.duration??0.35,'Swipe duration',0.1,3);break;
    case 'type_text': case 'type_keys': boundedText(p.text,'Text');break;
    case 'key': if(!['Enter','Backspace','Escape','Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Copy','SelectAll'].includes(String(p.key))) throw new GlassportError('INVALID_ARGUMENT','Unsupported key.');break;
    case 'home':break;
    case 'open_app': boundedText(p.bundleId,'App identifier',180);if(!/^[A-Za-z0-9._-]+$/.test(String(p.bundleId)))throw new GlassportError('INVALID_ARGUMENT','Invalid app identifier.');break;
    default: throw new GlassportError('INVALID_ARGUMENT','Unsupported input action.');
  }
}
export function fingerprint(value: unknown): string {return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
export type Result = {command_id:string;status:string;accepted_at:string;finished_at?:string;device_acknowledgement?:string;visual_outcome?:string;error?:{code:string;message:string};observation?:Observation};
export class CommandJournal {
  private entries = new Map<string,{fingerprint:string;result:Promise<Result>}>();
  private pending=0;
  private tail: Promise<unknown> = Promise.resolve();
  async run(action: Action, execute: ()=>Promise<Result>): Promise<Result> {
    const key=fingerprint(action);const known=this.entries.get(action.command_id);
    if(known){if(known.fingerprint!==key)throw new GlassportError('COMMAND_CONFLICT','Command ID was already used for different input.',409);return known.result;}
    if(this.pending>=16)throw new GlassportError('QUEUE_FULL','The input queue is full. Wait for current actions.',429);
    this.pending++;
    const result=this.tail.then(execute).finally(()=>{this.pending--;});
    this.tail=result.catch(()=>{});this.entries.set(action.command_id,{fingerprint:key,result});
    if(this.entries.size>128){const first=this.entries.keys().next().value;if(first)this.entries.delete(first);}
    return result;
  }
  get size(){return this.entries.size;}
}
export function formatError(error: unknown): {code:string;message:string} {
  if(error instanceof GlassportError)return {code:error.code,message:error.message};
  return {code:'INTERNAL_ERROR',message:'The operation failed. Check the local diagnostics.'};
}
