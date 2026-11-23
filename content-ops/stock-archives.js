import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';

// Only these immutable evidence fields are externalized. Mutable business rows stay
// in the compare-and-swap state document. Missing archives always fail closed.
export function createStockArchives({file,remote,stateId}) {
  const cache=new Map();let cachedBytes=0;
  function remember(key,value){
    const text=JSON.stringify(value),bytes=Buffer.byteLength(text);
    if(cache.has(key)){cachedBytes-=cache.get(key).bytes;cache.delete(key);}
    while(cache.size&&cachedBytes+bytes>64*1024*1024){const first=cache.keys().next().value;cachedBytes-=cache.get(first).bytes;cache.delete(first);}
    if(bytes<=64*1024*1024){cache.set(key,{text,bytes});cachedBytes+=bytes;}
  }
  async function save(value,updatedAt){
    if(value===undefined||value===null||value._stockArchiveKey)return value;
    const text=JSON.stringify(value);if(Buffer.byteLength(text)<65536)return value;
    const key=`${stateId}-evidence-${createHash('sha256').update(text).digest('hex')}`;
    if(!cache.has(key)){
      if(remote)await remote('/content_ops_state?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates,return=minimal'},body:JSON.stringify({id:key,state:{value},updated_at:updatedAt})});
      else{const dir=join(dirname(file),'stock-evidence-archives');await mkdir(dir,{recursive:true});await writeFile(join(dir,key+'.json'),text,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});}
      remember(key,value);
    }
    return {_stockArchiveKey:key};
  }
  async function expand(value){
    const key=value?._stockArchiveKey;if(!key)return value;
    if(!key.startsWith(`${stateId}-evidence-`)||!/^[a-zA-Z0-9_-]+$/.test(key))throw Error('历史资料索引无效');
    if(cache.has(key))return JSON.parse(cache.get(key).text);
    let restored;
    if(remote){const rows=await remote(`/content_ops_state?id=eq.${encodeURIComponent(key)}&select=state`);restored=rows?.[0]?.state?.value;}
    else restored=JSON.parse(await readFile(join(dirname(file),'stock-evidence-archives',key+'.json'),'utf8'));
    if(restored===undefined)throw Error('历史资料读取失败，未使用空白替代');
    remember(key,restored);return restored;
  }
  async function pack(state){
    const out={...state,audit:[]};if(state.collections!==undefined)out.collections=[];
    // Limit concurrency; immutable blobs are uploaded once, never on every save.
    for(const row of state.audit||[])out.audit.push({...row,result:await save(row.result,state.updatedAt)});
    for(const job of state.collections||[]){
      const j={...job};for(const key of ['results','calculation','monthlyBaseline','resultVersions','previousMonthly'])if(j[key]!==undefined)j[key]=await save(j[key],state.updatedAt);
      out.collections.push(j);
    }
    return out;
  }
  async function unpack(state,mode='full'){
    const out={...state,audit:[]};if(state.collections!==undefined)out.collections=[];
    for(const row of state.audit||[])out.audit.push({...row,result:mode==='full'?await expand(row.result):row.result});
    for(const job of state.collections||[]){
      const j={...job};for(const key of ['results','calculation','monthlyBaseline','resultVersions','previousMonthly'])if(j[key]!==undefined&&(mode!=='workspace'||['results','calculation'].includes(key)))j[key]=await expand(j[key]);
      out.collections.push(j);
    }
    return out;
  }
  return {pack,unpack};
}

export function workspaceView(view){
  const {costWorkbook,...out}=view;
  if(view.role==='admin')out.costWorkbookDeferred=Boolean(costWorkbook);
  out.audit=(view.audit||[]).map(({result,...a})=>({...a,result:{detailDeferred:true}}));
  out.collections=(view.collections||[]).map(({resultVersions,previousMonthly,monthlyBaseline,...j})=>{
    if(!j.calculation)return j;
    const {rulesSnapshot,excludedOrders,excludedRefunds,...calculation}=j.calculation;
    // The monthly view only counts observed component contributions, not the
    // unobserved matrix placeholders. Full staging rows remain in the full API.
    const observed=new Set((calculation.contributions||[]).map(r=>JSON.stringify([r.skuId,r.month,r.channel])));
    return {...j,calculation,results:(j.results||[]).filter(r=>observed.has(JSON.stringify([r.skuId,r.month,r.channel]))),detailDeferred:true};
  });
  return out;
}
