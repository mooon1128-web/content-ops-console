import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import RecordOps from '../public/content-ops/ops-core.cjs';
import {createXhsStore,publicXhs,xhsShape as shape} from '../content-ops/xhs-store.js';
const seed={creators:[{id:'c1',name:'Original',fans:10,notes:'note'}],placements:[{id:'p1',creator:'Original',fee:100}],monthlyBudgets:{'2026-11':1000},customCreatorTypes:[],updatedAt:'2026-11-01T00:00:00.000Z'};
const user={id:'u1',name:'PR',username:'pr'};
const diff=(a,b)=>RecordOps.diff(a,b,shape),apply=(a,ops)=>RecordOps.apply(a,ops,shape);
const changed=(fn)=>{const s=structuredClone(seed);fn(s);return s};
const command=next=>({requestId:randomUUID(),operations:diff(seed,next)});
const plain=s=>JSON.parse(JSON.stringify(s));
const source=await readFile(new URL('../public/content-ops/cloud-sync.js',import.meta.url),'utf8');
async function fixture(){const dir=await mkdtemp(join(tmpdir(),'pr-shared-'));const file=join(dir,'pr.json');await writeFile(file,JSON.stringify(seed));return{dir,file,store:createXhsStore({file}),close:()=>rm(dir,{recursive:true,force:true})}}
function client(network,journal){
 let state,timer=0;const timers=new Map(),reports=[];
 const c=vm.createContext({structuredClone,RecordOps,crypto:{randomUUID},AbortSignal,document:{hidden:false},fetch:network,
  setTimeout:(f,ms)=>{timers.set(++timer,{f,ms});return timer},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(source,c);
 const memory={};journal??={read:async()=>memory.pending,write:async v=>{memory.pending=structuredClone(v)},clear:async()=>{delete memory.pending}};
 const sync=new c.SharedSync({url:'/state',versionUrl:'/version',shape,journal,read:()=>state,write:s=>{state=structuredClone(s)},render(){},busy:()=>false,status:s=>reports.push(s),authExpired(){}});
 return{sync,memory,timers,reports,get state(){return state},edit:fn=>{fn(state);sync.changed()}};
}
function network(store){return async(url,o={})=>{try{const data=o.method==='PATCH'?{state:publicXhs(await store.commit(JSON.parse(o.body),user))}:url==='/version'?{updatedAt:await store.version()}:await store.read();return{ok:true,status:200,json:async()=>data}}catch(e){return{ok:false,status:e.status||500,json:async()=>({error:e.message})}}}}

test('field operations merge independent edits, preserve zero/empty values and reject stale edits/deletions atomically',()=>{
 const a=changed(s=>s.creators[0].fans=0),b=changed(s=>s.creators[0].notes='');
 const merged=apply(apply(seed,diff(seed,a)),diff(seed,b));assert.equal(merged.creators[0].fans,0);assert.equal(merged.creators[0].notes,'');
 assert.throws(()=>apply(merged,diff(seed,changed(s=>s.creators[0].fans=99))),{status:409});
 assert.throws(()=>apply(merged,diff(seed,changed(s=>s.creators=[]))),{status:409});
 assert.equal(apply(seed,diff(seed,changed(s=>s.creators=[]))).creators.length,0);
 assert.throws(()=>apply(seed,[{group:'creators',id:'c1',kind:'field',key:'__proto__',after:{exists:true,value:{}}}]),{status:400});
 assert.equal(seed.creators[0].fans,10);
});
test('file store serializes two writers, remembers retries across restart, and never exposes audit/receipts',async()=>{
 const f=await fixture();try{
 const a=command(changed(s=>s.creators[0].fans=22)),b=command(changed(s=>s.placements[0].fee=0));
 await Promise.all([f.store.commit(a,user),f.store.commit(b,user)]);
 const restarted=createXhsStore({file:f.file}),before=await restarted.raw();await restarted.commit(a,user);
 assert.deepEqual(await restarted.raw(),before);assert.equal(before.creators[0].fans,22);assert.equal(before.placements[0].fee,0);
 assert.equal((await restarted.read())._audit,undefined);assert.equal((await restarted.read())._receipts,undefined);
 await assert.rejects(restarted.commit({...a,operations:b.operations},user),{status:409});
 await assert.rejects(restarted.commit(command(changed(s=>s.creators[0].fans=31)),user),{status:409});
 assert.deepEqual(await restarted.raw(),before);
 }finally{await f.close()}
});
test('database compare-and-swap retries independent cross-instance changes and refuses absent cloud row',async()=>{
 const f=await fixture();try{
 let row={state:structuredClone(seed),updated_at:seed.updatedAt};const archives=[];
 const remote=async(path,o={})=>{
  if(!o.method)return [structuredClone(row)];
  if(o.method==='POST'){archives.push(JSON.parse(o.body));return []}
  if(new URL(path,'http://db').searchParams.get('updated_at')!==`eq.${row.updated_at}`)return [];
  row={...row,...JSON.parse(o.body)};return [structuredClone(row)];
 };
 const a=createXhsStore({file:join(f.dir,'a.json'),remote,stateId:'pr'}),b=createXhsStore({file:join(f.dir,'b.json'),remote,stateId:'pr'});
 await Promise.all([a.commit(command(changed(s=>s.creators[0].fans=30)),user),b.commit(command(changed(s=>s.creators[0].notes='other')),user)]);
 assert.equal(row.state.creators[0].fans,30);assert.equal(row.state.creators[0].notes,'other');assert.ok(archives.length>=2);
 const absent=createXhsStore({file:f.file,remote:async()=>[],stateId:'missing'});await assert.rejects(absent.read(),{status:503});
 }finally{await f.close()}
});
test('two client sessions converge, and same-field conflicts preserve a recoverable journal',async()=>{
 const f=await fixture();try{
 const a=client(network(f.store)),b=client(network(f.store));await a.sync.start();await b.sync.start();
 a.edit(s=>s.creators[0].fans=20);b.edit(s=>s.creators[0].notes='b');await a.sync.flush();await b.sync.flush();await a.sync.refresh();
 assert.deepEqual(plain(a.state),plain(b.state));
 a.edit(s=>s.creators[0].fans=21);b.edit(s=>s.creators[0].fans=22);await a.sync.flush();assert.equal(await b.sync.flush(),false);
 assert.equal(b.sync.conflict,true);assert.equal(b.state.creators[0].fans,22);assert.ok(b.memory.pending.operations.length);
 assert.equal((await f.store.read()).creators[0].fans,21);
 }finally{await f.close()}
});
test('full browser storage does not block cloud writes or subsequent edits',async()=>{
 const f=await fixture();try{
 const c=client(network(f.store),{read:async()=>{throw Error('quota')},write:async()=>{throw Error('quota')},clear:async()=>{throw Error('quota')}});
 assert.equal(await c.sync.start(),true);c.edit(s=>s.creators[0].fans=2);assert.equal(await c.sync.flush(),true);
 c.edit(s=>s.creators[0].fans=3);assert.equal(await c.sync.flush(),true);assert.equal((await f.store.read()).creators[0].fans,3);assert.equal(c.sync.storageOK,false);
 }finally{await f.close()}
});
test('a lost acknowledgement retries the same request and keeps edits made in flight',async()=>{
 const f=await fixture();try{
 const requests=[];let lost=true;const net=network(f.store);
 const c=client(async(url,o={})=>{const result=await net(url,o);if(o.method==='PATCH'){requests.push(JSON.parse(o.body).requestId);if(lost){lost=false;throw Error('response lost')}}return result});
 await c.sync.start();c.edit(s=>s.creators[0].fans=6);assert.equal(await c.sync.flush(),false);
 c.edit(s=>s.creators[0].notes='during outage');await c.sync.flush();assert.equal(c.sync.pending,true);await c.sync.flush();
 assert.equal(requests[0],requests[1]);assert.notEqual(requests[1],requests[2]);assert.equal(c.sync.pending,false);
 assert.equal((await f.store.raw())._audit.length,2);assert.equal((await f.store.read()).creators[0].notes,'during outage');
 }finally{await f.close()}
});
test('offline journal survives reload and a late remote read cannot replace a new edit',async()=>{
 const f=await fixture();try{
 let offline=true;const net=network(f.store);const a=client(async(u,o)=>{if(o?.method==='PATCH'&&offline)throw Error('offline');return net(u,o)});
 await a.sync.start();a.edit(s=>s.creators[0].fans=7);await a.sync.flush();assert.ok(a.memory.pending.operations.length);
 const b=client(net,{read:async()=>a.memory.pending,write:async v=>a.memory.pending=v,clear:async()=>delete a.memory.pending});await b.sync.start();assert.equal(b.state.creators[0].fans,7);await b.sync.flush();assert.equal((await f.store.read()).creators[0].fans,7);
 let release;const wait=new Promise(r=>release=r);let delayed=false;
 const c=client(async(u,o)=>{const result=await net(u,o);if(delayed&&u==='/state'&&!o?.method)await wait;return result});await c.sync.start();
 const base=await f.store.read(),next=structuredClone(base);next.creators[0].notes='remote';await f.store.commit({requestId:randomUUID(),operations:diff(base,next)},user);
 delayed=true;const refresh=c.sync.refresh();await new Promise(r=>setImmediate(r));c.edit(s=>s.creators[0].fans=9);release();await refresh;
 assert.equal(c.state.creators[0].fans,9);assert.equal(c.sync.pending,true);await c.sync.flush();assert.equal((await f.store.read()).creators[0].fans,9);
 }finally{await f.close()}
});
test('a no-op save cannot leave the client stuck in saving state',async()=>{
 const f=await fixture();try{const c=client(network(f.store));await c.sync.start();c.edit(()=>{});assert.equal(await c.sync.flush(),true);assert.ok(!c.sync.saving);c.edit(s=>s.creators[0].fans=88);assert.equal(await c.sync.flush(),true)}finally{await f.close()}
});


test('cost archives survive restart without being duplicated in each inventory revision',async()=>{
 const {createStockStore}=await import('../content-ops/stock-store.js');const f=await fixture();
 try{
  const file=join(f.dir,'stock.json'),store=createStockStore({file}),admin={...user,role:'admin'};
  const book={source:{sha256:'a'.repeat(64),name:'synthetic.xlsx'},sheets:[{name:'costs',rows:[{row:1,values:['cost',null,12]}]}]};
  await store.commit({action:'costArchive',data:book,revision:0,requestId:'cost-1'},admin);
  const persisted=JSON.parse(await readFile(file,'utf8'));assert.ok(persisted.costWorkbook._archiveKey);assert.equal(persisted.costWorkbook.sheets,undefined);
  const restored=await createStockStore({file}).read();assert.deepEqual(restored.costWorkbook.sheets,book.sheets);
  await store.commit({action:'sku',data:{id:'s1',code:'TEST',name:'test',warehouse:'test'},revision:1,requestId:'sku-1'},admin);
  const current=JSON.parse(await readFile(file,'utf8'));assert.deepEqual(current.costWorkbook,persisted.costWorkbook);assert.equal((await store.read()).skus.length,1);
 }finally{await f.close()}
});
