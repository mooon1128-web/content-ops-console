import {mkdir,writeFile,readFile,stat,statfs,rename,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const fail=(status,message)=>Object.assign(Error(message),{status});
const validId=id=>/^[a-f0-9-]{36}$/.test(id||'');
export function imageMime(data){
  if(data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&data.toString('ascii',12,16)==='IHDR')return 'image/png';
  if(data.length>=12&&data[0]===255&&data[1]===216&&data[2]===255)return 'image/jpeg';
  if(data.length>=20&&data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return 'image/webp';
  throw fail(415,'请上传 JPG、PNG 或 WebP 合同图片');
}
export function createPurchaseFiles({dir,readState}){
  const admin=user=>{if(user?.role!=='admin')throw fail(403,'合同图片仅管理员可查看和上传');};
  async function validate(user,files=[]){
    admin(user);if(!Array.isArray(files)||files.length>20)throw fail(400,'合同图片数量无效');
    for(const f of files){
      if(!validId(f.id))throw fail(400,'合同图片编号无效');
      let meta;try{meta=JSON.parse(await readFile(join(dir,f.id+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail(400,'合同图片尚未上传完成，请重新选择');throw e;}
      if(meta.bytes!==f.bytes||meta.mime!==f.mime)throw fail(400,'合同图片资料不一致');
      const info=await stat(join(dir,f.id));if(info.size!==meta.bytes)throw fail(500,'合同图片存储不完整');
    }
  }
  async function handle(request,response,url,user,send){
    if(request.method==='GET'){if(user?.role!=='admin'&&user?.stockRole!=='finance')throw fail(403,'合同图片仅管理员及财务可查看');}else admin(user);
    if(request.method==='POST'){
      await mkdir(dir,{recursive:true});const capacity=await statfs(dir);
      if(capacity.bavail*capacity.bsize<30*1024*1024)throw fail(507,'合同附件空间不足，请扩容后上传');
      let size=0;const chunks=[];
      for await(const chunk of request){size+=chunk.length;if(size>10*1024*1024)throw fail(413,'每张合同图片不能超过10MB');chunks.push(chunk);}
      const data=Buffer.concat(chunks),mime=imageMime(data);
      // A late upload response or a reselected file must not create another copy.
      const hash=createHash('sha256').update(String(user.id)).update('\0').update(data).digest('hex');
      const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
      const name=String(url.searchParams.get('name')||'合同图片').replace(/[\x00-\x1f]/g,'').slice(0,200);
      const meta={id,name,mime,bytes:size};
      async function atomic(target,body){const temp=target+'.'+randomUUID()+'.tmp';try{await writeFile(temp,body,{flag:'wx',mode:0o600});await rename(temp,target);}finally{await unlink(temp).catch(()=>{});}}
      // Atomic replacement contains identical bytes for this content-derived ID.
      // Interrupted or simultaneous retries cannot expose a half-written file.
      await atomic(join(dir,id),data);await atomic(join(dir,id+'.json'),JSON.stringify(meta));
      const saved=JSON.parse(await readFile(join(dir,id+'.json'),'utf8'));await validate(user,[saved]);
      send(response,200,saved);return;
    }
    if(request.method==='GET'){
      const id=url.searchParams.get('id');if(!validId(id))throw fail(400,'合同图片编号无效');
      const state=await readState();const file=Object.values(state.purchasePrivate||{}).flatMap(p=>p.contracts||[]).find(f=>f.id===id);
      if(!file)throw fail(404,'合同图片未关联到补货批次');
      const data=await readFile(join(dir,id));const mime=imageMime(data);
      response.writeHead(200,{'Content-Type':mime,'Content-Length':data.length,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox",'Content-Disposition':`${url.searchParams.get('download')==='1'?'attachment':'inline'}; filename="contract.${mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg'}"`});response.end(data);return;
    }
    throw fail(405,'Method not allowed');
  }
  return {handle,validate};
}
