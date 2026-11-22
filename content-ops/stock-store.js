import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { randomUUID,createHash } from 'node:crypto';
import { emptyStock,transact,fail } from './stock-model.js';

export function createStockStore({file,remote=null,stateId='stock-ops'}) {
  let queue=Promise.resolve();
  // Immutable cost archives are stored once, not copied into every inventory revision.
  async function pack(state){
    if(!state.costWorkbook||state.costWorkbook._archiveKey)return state;
    const body=JSON.stringify(state.costWorkbook),key=`${stateId}-cost-${createHash('sha256').update(body).digest('hex')}`;
    if(remote)await remote('/content_ops_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:key,state:{workbook:state.costWorkbook},updated_at:state.updatedAt})});
    else{const dir=join(dirname(file),'stock-cost-archives');await mkdir(dir,{recursive:true});await writeFile(join(dir,key+'.json'),body,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}
    return {...state,costWorkbook:{_archiveKey:key}};
  }
  async function unpack(state){
    const key=state.costWorkbook?._archiveKey;if(!key)return state;
    if(!key.startsWith(`${stateId}-cost-`)||!/^[a-zA-Z0-9_-]+$/.test(key))throw fail(500,'成本资料索引无效');
    let workbook;
    if(remote){const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(key)}&select=state`);workbook=rows?.[0]?.state?.workbook;}
    else workbook=JSON.parse(await readFile(join(dirname(file),'stock-cost-archives',key+'.json'),'utf8'));
    if(!workbook)throw fail(503,'成本资料读取失败，请稍后重试；不会用空白覆盖');
    return {...state,costWorkbook:workbook};
  }
  async function load() {
    if(remote){const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(stateId)}&select=state,updated_at`);return {state:await unpack(rows?.[0]?.state||emptyStock()),version:rows?.[0]?.updated_at,exists:Boolean(rows?.length)};}
    try{return {state:await unpack(JSON.parse(await readFile(file,'utf8'))),exists:true};}catch(e){if(e.code==='ENOENT'&&e.path===file)return {state:emptyStock(),exists:false};throw e;}
  }
  async function localWrite(state,current) {
    await mkdir(dirname(file),{recursive:true});
    if(current?.revision){const dir=join(dirname(file),'stock-ops-backups');await mkdir(dir,{recursive:true});const name=remote?`daily-${new Date().toISOString().slice(0,10)}.json`:`${current.revision}-${randomUUID()}.json`;await writeFile(join(dir,name),JSON.stringify(current),{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}
    const temp=`${file}.${randomUUID()}.tmp`;await writeFile(temp,JSON.stringify(state,null,2));await rename(temp,file);
  }
  function commit(command,user,context) {
    const operation=queue.then(async()=>{
      const loaded=await load();
      const now=new Date(Math.max(Date.now(),(Date.parse(loaded.state.updatedAt)||0)+1)).toISOString();
      const changed=transact(loaded.state,command,user,{...context,now});if(changed.replayed)return changed;
      const persisted=await pack(changed.state),previous=await pack(loaded.state);
      if(remote){
        if(loaded.exists){
          await remote('/content_ops_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:`${stateId}-history-${loaded.state.revision}`,state:previous,updated_at:loaded.version})});
          const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(stateId)}&updated_at=eq.${encodeURIComponent(loaded.version)}`,{method:'PATCH',headers:{Prefer:'return=representation'},body:JSON.stringify({state:persisted,updated_at:changed.state.updatedAt})});
          if(!rows?.length)throw fail(409,'共享数据刚被更新，请刷新后重新提交');
        }else{
          const rows=await remote('/content_ops_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=representation'},body:JSON.stringify({id:stateId,state:persisted,updated_at:changed.state.updatedAt})});
          if(!rows?.length)throw fail(409,'共享数据已被初始化，请刷新后重试');
        }
        await localWrite(persisted,previous).catch(()=>console.warn('Stock local mirror unavailable; shared database saved'));
      }else await localWrite(persisted,previous);
      return changed;
    });queue=operation.catch(()=>{});return operation;
  }
  return {read:async()=>(await load()).state,commit,version:async()=>{if(!remote)return (await load()).state.updatedAt;const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(stateId)}&select=updated_at`);return rows?.[0]?.updated_at?new Date(rows[0].updated_at).toISOString():null;}};
}
