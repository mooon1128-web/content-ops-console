import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyStock,transact,stockView} from '../content-ops/stock-model.js';
import {createStockStore} from '../content-ops/stock-store.js';
import {workspaceView} from '../content-ops/stock-archives.js';
import {paymentDueDate,purchaseBalanceSummary} from '../public/stock-ops/purchase-balances.js';
import {renderPurchaseBalances} from '../public/stock-ops/purchase-balances-ui.js';
const admin={id:'synthetic-admin',role:'admin',name:'Test admin'},now='2026-11-23T06:00:00.000Z';
const run=(s,action,data,user=admin)=>transact(s,{action,data,revision:s.revision,requestId:randomUUID()},user,{now}).state;
const po={skuId:'test',reference:'TEST-PO',quantity:500,status:'已下单',orderDate:'2026-11-01',expectedShipAt:'2026-12-21',warehouse:'test',note:'Synthetic only'};
const seed=(amount=123.45)=>run(run(emptyStock(),'sku',{id:'test',code:'TEST',name:'Synthetic product',warehouse:'test'}),'purchase',{...po,privateDetails:{balanceDue:amount}});
test('payment date uses shipping +15 calendar days across months, years and leap years, with no arrival fallback',()=>{
  assert.equal(paymentDueDate('2026-12-21'),'2027-01-05');
  assert.equal(paymentDueDate('2028-02-20'),'2028-03-06');
  assert.equal(paymentDueDate('2027-02-20'),'2027-03-07');
  for(const v of [null,'','2026-02-30','bad'])assert.equal(paymentDueDate(v),null);
  const x=purchaseBalanceSummary([{id:'p',reference:'old',expectedAt:'2026-11-01'}],{},'2026-11-23');assert.equal(x.pending[0].dueAt,null);
});
test('all pending batches sort by payment date, sum exact cents and preserve unknown and explicit zero',()=>{
  const orders=[{id:'late',reference:'later',expectedShipAt:'2026-12-21',orderDate:'2026-11-01'},{id:'early',reference:'earlier',expectedShipAt:'2026-11-01',orderDate:'2026-10-01'},{id:'unknown',reference:'unknown'},{id:'zero',reference:'zero',expectedShipAt:'2026-11-02'}];
  const info=purchaseBalanceSummary(orders,{late:{balanceDue:.1},early:{balanceDue:.2},zero:{balanceDue:0}},'2026-11-23');
  assert.equal(info.totalCents,30);assert.equal(info.unknownCount,1);assert.equal(info.missingDateCount,1);
  assert.deepEqual(info.pending.map(r=>r.order.id),['early','zero','late','unknown']);assert.equal(info.pending[0].overdueDays,7);assert.equal(info.pending[1].amountCents,0);
});
test('settle/reopen are durable, replay-safe, retain purchase/contract facts and freeze settled dates',async()=>{
  const file=join(await mkdtemp(join(tmpdir(),'balance-test-')),'state.json'),store=createStockStore({file});
  const commit=async(action,data,requestId=randomUUID())=>store.commit({action,data,requestId,revision:(await store.read()).revision},admin,{now});
  await commit('sku',{id:'test',code:'TEST',name:'Synthetic product',warehouse:'test'});
  await commit('purchase',{...po,privateDetails:{balanceDue:123.45}});
  const before=await store.read(),id=before.purchases[0].id,data={purchaseId:id,settledAt:'2026-11-23'},requestId=randomUUID();
  const first=await commit('purchaseSettle',data,requestId),retry=await commit('purchaseSettle',data,requestId);assert.equal(retry.replayed,true);assert.equal(first.state.revision,retry.state.revision);
  let saved=await createStockStore({file}).read();assert.deepEqual(saved.purchases,before.purchases);assert.deepEqual(saved.events,before.events);assert.equal(saved.purchasePrivate[id].balanceDue,123.45);
  assert.equal(purchaseBalanceSummary(saved.purchases,saved.purchasePrivate,'2026-11-23').totalCents,0);
  await commit('purchaseSchedule',{purchaseId:id,expectedShipAt:'2026-12-25',note:'Synthetic reschedule'});
  saved=await store.read();let info=purchaseBalanceSummary(saved.purchases,saved.purchasePrivate,'2026-11-23');assert.equal(info.settled[0].dueAt,'2027-01-05');
  await commit('purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:123.45,contracts:[]}});assert.equal((await store.read()).purchasePrivate[id].settlement.status,'已结清');
  await assert.rejects(()=>commit('purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:200}}),/先恢复/);
  await commit('purchaseReopen',{purchaseId:id});saved=await createStockStore({file}).read();info=purchaseBalanceSummary(saved.purchases,saved.purchasePrivate,'2026-11-23');
  assert.equal(info.totalCents,12345);assert.equal(info.pending[0].dueAt,'2027-01-09');assert.equal(saved.purchasePrivate[id].settlementHistory.length,2);assert.equal(saved.purchasePrivate[id].settlementHistory[0].current.amountCents,12345);
});
test('unknown amounts and invalid dates cannot be settled; explicit zero can be recorded',()=>{
  for(const amount of [null,'']){const s=seed(amount);assert.throws(()=>run(s,'purchaseSettle',{purchaseId:s.purchases[0].id,settledAt:'2026-11-23'}),/有效尾款金额/);}
  let s=seed(0),id=s.purchases[0].id;
  for(const settledAt of ['2026-11-24','2026-10-31','2026-02-30'])assert.throws(()=>run(s,'purchaseSettle',{purchaseId:id,settledAt}),/日期/);
  s=run(s,'purchaseSettle',{purchaseId:id,settledAt:'2026-11-23'});assert.equal(s.purchasePrivate[id].settlement.amountCents,0);
  assert.throws(()=>run(s,'purchaseSettle',{purchaseId:id,settledAt:'2026-11-23'}),/已标记/);
});
test('employee state, exports and audit contain no settlement details and cannot settle or reopen',()=>{
  let s=seed(123.45),id=s.purchases[0].id;s=run(s,'purchaseSettle',{purchaseId:id,settledAt:'2026-11-23'});
  for(const role of ['operations','warehouse','pr','pr_service','customer_service','content','viewer']){
    const user={id:role,role:'employee',stockRole:role,name:role};
    for(const v of [stockView(s,user),workspaceView(stockView(s,user))]){
      const json=JSON.stringify(v);for(const token of ['settlement','purchaseSettle','123.45','amountCents','balanceDue'])assert.equal(json.includes(token),false,role+' leaked '+token);
    }
    for(const action of ['purchaseSettle','purchaseReopen'])assert.throws(()=>run(s,action,{purchaseId:id,settledAt:'2026-11-23'},user),e=>e.status===403);
  }
});
test('balance screen removes a settled row from pending, updates total, and keeps a recoverable history entry',async()=>{
  let s=seed(123.45),bindings=new Map(),content={innerHTML:''},editor,save={textContent:''};const originalDocument=globalThis.document;
  globalThis.document={querySelectorAll:()=>[]};
  const a={state:stockView(s,admin),$:q=>q==='#content'?content:save,heading:t=>t,button:(id,label)=>`<button id="${id}">${label}</button>`,table:(headers,rows,empty)=>rows.length?rows.flat().join('|'):empty,escape:String,num:String,pill:String,today:()=> '2026-11-23',sku:()=>s.skus[0],field:()=>'',onBack:()=>{},bind:(id,fn)=>bindings.set(id,fn),bindAll:(selector,fn)=>bindings.set(selector,fn),showEditor:(title,html,handler)=>editor={title,html,handler},command:async(action,data)=>{s=run(s,action,data);a.state=stockView(s,admin);},render:()=>renderPurchaseBalances(a)};
  try{
    a.render();assert.match(content.innerHTML,/¥123\.45/);assert.match(content.innerHTML,/2027-01-05/);
    bindings.get('[data-settle-balance]')({dataset:{settleBalance:s.purchases[0].id}});await editor.handler({settledAt:'2026-11-23'});a.render();assert.match(content.innerHTML,/¥0\.00/);assert.doesNotMatch(content.innerHTML,/data-settle-balance=/);
    bindings.get('balance-history')();assert.match(content.innerHTML,/恢复未结清/);assert.match(content.innerHTML,/¥123\.45/);
    bindings.get('[data-reopen-balance]')({dataset:{reopenBalance:s.purchases[0].id}});await editor.handler({});bindings.get('balance-pending')();assert.match(content.innerHTML,/data-settle-balance=/);assert.equal(s.purchases.length,1);
  }finally{globalThis.document=originalDocument;}
});
