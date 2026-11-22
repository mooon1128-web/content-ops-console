import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import RecordOps from '../public/content-ops/ops-core.cjs';
export const xhsShape={creators:'rows',placements:'rows',customCreatorTypes:'value',monthlyBudgets:'map'};
const fail=(status,message)=>Object.assign(new Error(message),{status});
export const publicXhs=s=>Object.fromEntries([...Object.keys(xhsShape),'updatedAt'].map(k=>[k,s[k]]));
export function createXhsStore({file,remote,stateId}){
  let queue=Promise.resolve();
  async function load(){
    if(remote){const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(stateId)}&select=state,updated_at`);
      if(!rows?.[0]?.state)throw fail(503,'云端博主数据尚未初始化，请管理员核对；不会自动用旧缓存覆盖');
      return {state:rows[0].state,version:rows[0].updated_at};}
    try{return {state:JSON.parse(await readFile(file,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;return {state:{creators:[],placements:[],customCreatorTypes:[],monthlyBudgets:{},updatedAt:'1970-01-01T00:00:00.000Z'}};}
  }
  async function version(){if(!remote)return (await load()).state.updatedAt;
    const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(stateId)}&select=updated_at`);
    return rows?.[0]?.updated_at?new Date(rows[0].updated_at).toISOString():null;}
  async function localWrite(next,current){
    await mkdir(dirname(file),{recursive:true});
    const history=join(dirname(file),'xhs-shared-history');await mkdir(history,{recursive:true});
    // Archive only a confirmed revision, never an uncommitted incoming payload.
    const key=String(current.updatedAt).replace(/[^0-9A-Za-z-]/g,'_');
    await writeFile(join(history,`${key}.json`),JSON.stringify({updatedAt:current.updatedAt,audit:current._audit||[]}));
    const daily=join(history,`snapshot-${new Date().toISOString().slice(0,10)}.json`);
    await writeFile(daily,JSON.stringify(current),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    const temp=`${file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(next));await rename(temp,file);
  }
  async function commitOnce(command,user){
    if(!command?.requestId||typeof command.requestId!=='string'||command.requestId.length>100)throw fail(400,'缺少有效请求编号');
    const hash=createHash('sha256').update(JSON.stringify(command.operations)).digest('hex');
    for(let attempt=0;attempt<4;attempt++){
      const loaded=await load(),current=loaded.state;
      const replay=(current._receipts||[]).find(x=>x.id===command.requestId);
      if(replay){if(replay.actor!==user.id||replay.hash!==hash)throw fail(409,'请求编号已用于其他操作');return current;}
      const now=new Date(Math.max(Date.now(),(Date.parse(current.updatedAt)||0)+1)).toISOString();
      const next=RecordOps.apply(current,command.operations,xhsShape,now);
      if(!command.operations.length)return current;
      if(next.creators.length>200000||next.placements.length>200000)throw fail(422,'记录量需要扩容，请联系管理员；本次数据未被删除');
      next.updatedAt=now;
      next._receipts=[...(current._receipts||[]),{id:command.requestId,actor:user.id,hash}].slice(-2000);
      next._audit=[...(current._audit||[]),{id:randomUUID(),at:now,actor:{id:user.id,name:user.name,username:user.username},requestId:command.requestId,operations:command.operations}].slice(-100);
      if(remote){
        // Keep the previous confirmed audit segment outside the growing live data row.
        await remote('/content_ops_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:`${stateId}-audit-${current.updatedAt}`,state:{updatedAt:current.updatedAt,audit:current._audit||[]},updated_at:current.updatedAt})});
        const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(stateId)}&updated_at=eq.${encodeURIComponent(loaded.version)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({state:next,updated_at:now})});
        if(!rows?.length)continue;
        await localWrite(next,current).catch(()=>console.warn('XHS local mirror unavailable; database commit succeeded'));
      }else await localWrite(next,current);
      return next;
    }
    throw fail(409,'其他同事正在保存，请稍后重试；本次未覆盖数据');
  }
  return {read:async()=>publicXhs((await load()).state),raw:async()=>(await load()).state,version,
    commit:(command,user)=>{const work=queue.then(()=>commitOnce(command,user));queue=work.catch(()=>{});return work;}};
}
