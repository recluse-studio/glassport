import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {GlassportError} from './core.ts';
export type Artifact={artifact_id:string;kind:string;media_type:string;byte_length:number;sha256:string;created_at:string;provenance:unknown;download_url:string;path:string;extension?:string;filename?:string};
const extensions=new Set(['png','jpg','jpeg','md','txt','pdf','csv','json','docx','xlsx','pptx','zip','rtf']);
export class ArtifactStore {
  root:string;private items=new Map<string,Artifact>();private retainedCount=0;private inventory:Promise<void>|null=null;
  constructor(root:string){this.root=root;}
  private initialize(){
    this.inventory??=(async()=>{try{const names=await readdir(this.root);this.retainedCount=names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name)).length;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}})();
    return this.inventory;
  }
  async list(){
    let names:string[];try{names=await readdir(this.root);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
    const rows=[];
    for(const name of names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(0,200)){
      try{const id=name.slice(0,-5);const saved=JSON.parse(await readFile(join(this.root,name),'utf8'));if(saved.artifact_id!==id||!extensions.has(saved.extension)||typeof saved.sha256!=='string'||!Number.isInteger(saved.byte_length))continue;
        const item:Artifact={...saved,path:join(this.root,`${id}.${saved.extension}`),download_url:`/api/artifacts/${id}`};this.items.set(id,item);
        rows.push({artifact_id:id,kind:item.kind,filename:item.filename,extension:item.extension,media_type:item.media_type,byte_length:item.byte_length,sha256:item.sha256,created_at:item.created_at,download_url:item.download_url});
      }catch{}
    }
    return rows.sort((a,b)=>b.created_at.localeCompare(a.created_at));
  }
  async save(data:Buffer,kind:string,mediaType:string,extension:string,provenance:unknown,filename?:string):Promise<Omit<Artifact,'path'>>{
    if(!extensions.has(extension))throw new GlassportError('INVALID_ARGUMENT','Unsupported artifact extension.');
    if(filename&&(Buffer.byteLength(filename)>255||/[\x00-\x1f\x7f/]/.test(filename)||filename==='.'||filename==='..'))throw new GlassportError('INVALID_ARGUMENT','The export filename contains a path separator, control character or more than 255 UTF-8 bytes.');
    if(data.length>32*1024*1024)throw new GlassportError('PAYLOAD_TOO_LARGE','The artifact exceeds the 32 MiB limit.');
    await this.initialize();
    if(this.retainedCount>=200)throw new GlassportError('STORAGE_LIMIT','The export folder has reached its 200-artifact limit. Preserve or move saved exports before adding another.',429);
    this.retainedCount++;
    const id=randomUUID();const path=join(this.root,`${id}.${extension}`);
    try{
    await mkdir(this.root,{recursive:true,mode:0o700});await writeFile(path,data,{mode:0o600,flag:'wx'});
    const item:Artifact={artifact_id:id,kind,media_type:mediaType,byte_length:data.length,sha256:createHash('sha256').update(data).digest('hex'),created_at:new Date().toISOString(),provenance,download_url:`/api/artifacts/${id}`,path,extension,filename};
    await writeFile(join(this.root,`${id}.json`),JSON.stringify({...item,extension})+'\n',{mode:0o600,flag:'wx'});
    this.items.set(id,item);const {path:_,...publicItem}=item;return publicItem;
    }catch(error){this.retainedCount--;throw error;}
  }
  async get(id:string){if(!/^[a-f0-9-]{36}$/.test(id))throw new GlassportError('ARTIFACT_NOT_FOUND','Invalid artifact identity.',404);let item=this.items.get(id);if(!item){try{const saved=JSON.parse(await readFile(join(this.root,`${id}.json`),'utf8'));if(saved.artifact_id===id&&extensions.has(saved.extension)){item={...saved,path:join(this.root,`${id}.${saved.extension}`)};this.items.set(id,item!);}}catch{}}if(!item)throw new GlassportError('ARTIFACT_NOT_FOUND','This artifact is not registered in the current server session.',404);const data=await readFile(item.path);if(createHash('sha256').update(data).digest('hex')!==item.sha256)throw new GlassportError('ARTIFACT_CHANGED','The saved artifact content changed.',409);return {item,data};}
}
