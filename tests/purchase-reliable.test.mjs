import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createStockStore} from '../content-ops/stock-store.js';
import {createStockArchives,workspaceView} from '../content-ops/stock-archives.js';
import {createPurchaseFiles} from '../content-ops/purchase-files.js';
import {emptyStock,stockView} from '../content-ops/stock-model.js';
import {monthlyReadModel} from '../public/stock-ops/sales-ui.js';
import {createCommandClient,acceptNewerState,uploadContract} from '../public/stock-ops/reliable-save.js';
const admin={id:'a',role:'admin'},employee={id:'w',role:'employee',stockRole:'warehouse'};
const purchase={skuId:'s',reference:'PO-1',quantity:500,status:'计划',orderDate:'2026-11-21',expectedShipAt:'2026-12-21',warehouse:'主仓',note:'synthetic'};
const seed=()=>({...emptyStock(),skus:[{id:'s',name:'synthetic',code:'S',warehouse:'主仓'}]});
test('late commit response is confirmed without creating a second purchase',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-late-'));try{
  const file=join(dir,'state.json');await writeFile(file,JSON.stringify(seed()));const store=createStockStore({file});let state=await store.read(),posts=0;
  const client=createCommandClient({userId:()=>admin.id,getState:()=>state,refresh:async()=>state=await store.read(),request:async(path,options)=>{
   if(path.includes('command-status'))return store.receipt(new URL(path,'http://local').searchParams.get('requestId'),admin);
   posts++;await store.commit(JSON.parse(options.body),admin);throw Error('response lost');
  }});
  assert.equal((await client.send('purchase',purchase)).committed,true);assert.equal(posts,1);assert.equal((await store.read()).purchases.length,1);assert.equal(client.pending.size,0);
  assert.equal((await store.receipt('unknown',admin)).committed,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('lost responses across a reopened form reuse the same request; changed data uses a new ID',async()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};const ids=[];let online=false;
 const request=async(path,o)=>{if(path.includes('status'))return {committed:false};ids.push(JSON.parse(o.body).requestId);if(!online)throw Error('offline');return {ok:true};};
 const options={storage,userId:()=>admin.id,getState:()=>({revision:1}),refresh:async()=>{},request};
 await assert.rejects(()=>createCommandClient(options).send('purchase',purchase),/暂未确认/);online=true;
 await createCommandClient(options).send('purchase',purchase);assert.equal(new Set(ids).size,1);
 await createCommandClient(options).send('purchase',{...purchase,reference:'PO-2'});assert.notEqual(ids.at(-1),ids[0]);assert.equal(map.size,0);
});
test('stale append refreshes once; existing-row conflict never overwrites; old refresh cannot roll back',async()=>{
 let revision=1;const attempts=[];const request=async(path,o)=>{if(path.includes('status'))return {committed:false};const c=JSON.parse(o.body);attempts.push(c);if(c.revision===1)throw Object.assign(Error('conflict'),{status:409,code:'REVISION_CONFLICT'});return {ok:true};};
 const make=()=>createCommandClient({request,userId:()=>admin.id,getState:()=>({revision}),refresh:async()=>revision=2});
 await make().send('purchase',purchase);assert.deepEqual(attempts.map(c=>c.revision),[1,2]);assert.equal(attempts[0].requestId,attempts[1].requestId);
 revision=1;await assert.rejects(()=>make().send('purchasePrivate',{purchaseId:'p',privateDetails:{balanceDue:3}}),/conflict/);assert.equal(attempts.length,3);
 assert.equal(acceptNewerState({revision:8},{revision:7}).revision,8);
});
test('large evidence is losslessly externalized and reused after restart, with no empty fallback',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-archive-'));try{
  const file=join(dir,'stock.json'),big='x'.repeat(90000),state={...seed(),audit:[{id:'a',result:{big}}],collections:[{id:'j',results:[{big}],calculation:{big},monthlyBaseline:[{big}],resultVersions:[{big}]}]};
  const archive=createStockArchives({file,stateId:'test'}),packed=await archive.pack(state);
  assert.ok(JSON.stringify(packed).length<3000);assert.deepEqual(await createStockArchives({file,stateId:'test'}).unpack(packed),state);
  const remoteRows=new Map();let writes=0;
  const remote=async(path,o)=>{if(o?.method==='POST'){writes++;const row=JSON.parse(o.body);remoteRows.set(row.id,row);return [];}const id=new URL(path,'http://local').searchParams.get('id').slice(3);return remoteRows.has(id)?[remoteRows.get(id)]:[];};
  const r=createStockArchives({file,remote,stateId:'r'});const p=await r.pack(state);const n=writes;await r.pack(state);assert.equal(writes,n);
  const fresh=createStockArchives({file,remote,stateId:'r'});assert.deepEqual(await fresh.unpack(p),state);await fresh.pack(state);assert.equal(writes,n);
  remoteRows.clear();await assert.rejects(()=>createStockArchives({file,remote,stateId:'r'}).unpack(p),/未使用空白替代/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('workspace projection preserves net sales and privacy; full records and old versions stay intact',()=>{
 const state=seed();state.costWorkbook={sheets:[{secret:2}]};state.purchasePrivate={p:{balanceDue:100,contracts:[]}};
 state.collections=[{id:'j',calculation:{computedAt:'2026-11-23',complete:false,contributions:[{skuId:'s',month:'2026-08',channel:'淘宝'}],coverage:[{channel:'淘宝',start:'2026-08-01',end:'2026-08-31'}],rulesSnapshot:[{secret:3}]},results:[{skuId:'s',month:'2026-08',channel:'淘宝',paid:10,refund:2,net:8,through:'2026-08-31',updatedAt:'2026-11-23'}],resultVersions:[{old:true}],monthlyBaseline:[{old:true}]}];
 const original=JSON.stringify(state),full=stockView(state,admin),small=workspaceView(full);
 assert.deepEqual(monthlyReadModel(small),monthlyReadModel(full));assert.equal(small.costWorkbook,undefined);assert.equal(small.costWorkbookDeferred,true);assert.equal(small.collections[0].resultVersions,undefined);
 assert.equal(workspaceView(stockView(state,employee)).purchasePrivate,undefined);assert.equal(JSON.stringify(state),original);
});
test('same contract bytes are idempotent including concurrent retries, while access remains admin-only',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-file-'));try{
  const files=createPurchaseFiles({dir,readState:async()=>({})}),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVmQAAAAASUVORK5CYII=','base64');
  const upload=async user=>{let result;await files.handle(Object.assign(Readable.from([png]),{method:'POST'}),{},new URL('http://local/?name=synthetic.png'),user,(_,status,data)=>result=data);return result;};
  const results=await Promise.all([upload(admin),upload(admin)]);assert.equal(results[0].id,results[1].id);assert.deepEqual(await readFile(join(dir,results[0].id)),png);await files.validate(admin,results);
  await assert.rejects(()=>upload(employee),e=>e.status===403);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('upload shows bytes sent separately from completion and reports timeout',async()=>{
 let xhr;const progress=[];const xhrFactory=()=>xhr={upload:{},open(){},setRequestHeader(){},send(){}};
 const promise=uploadContract({name:'test.png',type:'image/png'},n=>progress.push(n),{xhrFactory});xhr.upload.onprogress({lengthComputable:true,loaded:5,total:10});assert.deepEqual(progress,[50]);xhr.ontimeout();await assert.rejects(()=>promise,/60秒/);
});
test('storage optimization preserves revisions and all history, and later saves remain readable after restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-optimize-'));try{
  const file=join(dir,'state.json'),state={...seed(),revision:4,updatedAt:'2026-11-20T00:00:00.000Z',audit:[{id:'old',result:{big:'y'.repeat(90000)}}]};
  await writeFile(file,JSON.stringify(state));const store=createStockStore({file});assert.equal((await store.optimize()).status,'complete');assert.deepEqual(await store.read(),state);
  const saved=await store.commit({action:'purchase',data:purchase,revision:4,requestId:'after-optimize'},admin);assert.equal(saved.state.revision,5);
  const restored=await createStockStore({file}).read();assert.deepEqual(restored.audit[0],state.audit[0]);assert.equal(restored.purchases.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
