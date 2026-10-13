import {randomUUID} from 'node:crypto';
import type {Observation,Rect} from '../contracts/core.ts';
export type Region={text:string;role:string;bounds:Rect|null;order:number;visible:boolean|null};
export function extractTree(tree:unknown,observation:Observation){
  const regions:Region[]=[];let truncated=false;const max=2000;
  function visit(value:any){
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){for(const child of value)visit(child);return;}
    const flag=value.isVisible??value.visible;const visible=flag===undefined?null:flag===true||flag===1||flag==='1'||flag==='true';
    if(visible===false)return;
    const role=String(value.type??value.role??'Unknown');
    const label=typeof value.label==='string'?value.label:'';
    const textValue=typeof value.value==='string'?value.value:'';
    const text=textValue||label;
    const raw=value.rect??value.bounds;let bounds:Rect|null=null;
    if(raw){const x=raw.x??raw.origin?.x,y=raw.y??raw.origin?.y,width=raw.width??raw.size?.width,height=raw.height??raw.size?.height;if([x,y,width,height].every(n=>typeof n==='number'&&Number.isFinite(n)))bounds={x,y,width,height};}
    const b=observation.logical_bounds;
    const within=!bounds||(bounds.x+Math.max(0,bounds.width)>b.x&&bounds.y+Math.max(0,bounds.height)>b.y&&bounds.x<b.x+b.width&&bounds.y<b.y+b.height);
    const children=value.children??[];
    if(text&&within&&!/Application|Window|^Other$/i.test(role)){
      if(regions.length>=max){truncated=true;return;}
      regions.push({text,role,bounds,order:regions.length,visible});
    }
    for(const child of children)visit(child);
  }
  visit(tree);
  // Preserve distinct repeated regions; the same phrase can appear twice legitimately.
  return {extraction_id:randomUUID(),observation_id:observation.observation_id,app_ref:observation.app_ref,captured_at:new Date().toISOString(),method:'accessible_text',text:regions.map(r=>r.text).join('\n'),regions,coverage:'Returned current app accessibility regions intersecting the observed viewport; unknown visibility is labelled.',truncated,warnings:['App structure and picture are sampled separately; this does not claim the entire document.'],confidence:null};
}
