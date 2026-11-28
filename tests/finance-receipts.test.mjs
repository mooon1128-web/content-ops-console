import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyStock,transact,stockView,balance} from '../content-ops/stock-model.js';
import {publicUser} from '../content-ops/access.js';
import {purchaseSummary} from '../public/stock-ops/purchasing-math.js';
import {purchaseRecordCard} from '../public/stock-ops/record-image.js';
import {createStockLive} from '../content-ops/stock-live.js';
import {EventEmitter} from 'node:events';
import {renderPurchases} from '../public/stock-ops/purchasing-ui.js';
import {renderPurchaseBalances} from '../public/stock-ops/purchase-balances-ui.js';
const admin={id:'a',role:'admin'},finance={id:'f',name:'测试财务',role:'employee',stockRole:'finance'},warehouse={id:'w',role:'employee',stockRole:'warehouse'};
const now='2026-11-28T03:00:00.000Z';
const run=(s,action,data,user=admin)=>transact(s,{action,data,revision:s.revision,requestId:randomUUID()},user,{now}).state;
const seed=()=>run(run(emptyStock(),'sku',{id:'k',code:'K',name:'测试商品',warehouse:'主仓'}),'purchase',{skuId:'k',reference:'PO',quantity:500,status:'已下单',orderDate:'2026-11-20',expectedShipAt:'2026-11-22',warehouse:'主仓',note:'测试订单'});
test('finance has explicit private read access, no business or settlement mutation',()=>{
 let s=seed();s.costWorkbook={source:{name:'test'}};s.purchasePrivate={[s.purchases[0].id]:{balanceDue:123,contracts:[]}};
 assert.equal(publicUser(finance).stockRole,'finance');const v=stockView(s,finance);
 assert.equal(v.role,'finance');assert.equal(v.costWorkbook.source.name,'test');assert.equal(Object.values(v.purchasePrivate)[0].balanceDue,123);
 assert.equal(stockView(s,warehouse).costWorkbook,undefined);assert.equal(stockView(s,warehouse).purchasePrivate,undefined);
 for(const action of ['purchase','purchaseUpdate','purchaseReceive','purchaseInspect','purchaseReturn','purchasePrivate','purchaseSettle','purchaseReopen','snapshot','event','import','costArchive'])assert.throws(()=>run(s,action,{},finance),/权限/);
});
test('500 purchased, received in two deliveries, then defective goods returned without reducing good stock',()=>{
 let s=seed(),id=s.purchases[0].id;
 for(const [reference,good,defect,pending] of [['R1',190,5,5],['R2',290,10,0]])s=run(s,'purchaseReceive',{purchaseId:id,reference,trackingNumber:'TEST-'+reference,at:now,good,defect,pending,returnDecision:'需寄回',note:'测试分批到货'},warehouse);
 assert.equal(s.purchaseReceipts.length,2);assert.equal(s.purchaseReceipts[0].trackingNumber,'TEST-R1');
 const receiptId=s.purchaseReceipts[0].id;
 s=run(s,'purchaseReturn',{purchaseId:id,receiptId,reference:'RETURN1',trackingNumber:'TEST-OUT',at:now,quantity:5,note:'测试退厂'},warehouse);
 assert.equal(s.purchaseReturns[0].trackingNumber,'TEST-OUT');
 assert.deepEqual(purchaseSummary(s.purchases[0],s.purchaseReceipts,s.purchaseInspections,s.purchaseReturns),{received:500,good:480,defect:15,pending:5,returned:5,defectInWarehouse:10,shortfall:0,over:0});
 assert.equal(s.events.filter(e=>e.type==='receipt').reduce((n,e)=>n+e.quantity,0),480);
 s.purchasePrivate={[id]:{balanceDue:98765}};
 const warehouseCard=JSON.stringify(purchaseRecordCard(stockView(s,warehouse),'order',id));assert.doesNotMatch(warehouseCard,/98765|尾款金额/);
 const financeCard=JSON.stringify(purchaseRecordCard(stockView(s,finance),'order',id));assert.match(financeCard,/98765/);
 const receiptCard=purchaseRecordCard(stockView(s,finance),'receipt',receiptId);assert.ok(receiptCard.fields.some(([k,v])=>k==='本次实收'&&v==='200'));
 const returnCard=purchaseRecordCard(stockView(s,finance),'return',s.purchaseReturns[0].id);assert.ok(returnCard.fields.some(([k,v])=>k==='关联收货单'&&v==='R1'));
});
class Response extends EventEmitter {body='';destroyed=false;writeHead(status,headers){this.headers=headers;}write(x){this.body+=x;return true;}end(){if(!this.destroyed){this.destroyed=true;this.emit('close');}}}
test('live revision stream sends committed versions, deduplicates, reconnects and revokes access',async()=>{
 let v='v1',allowed=true;const live=createStockLive({version:async()=>v,authorize:async()=>{if(!allowed)throw Error('revoked');},intervalMs:10});
 try{const a=new Response();live.connect({},a);await new Promise(r=>setTimeout(r,5));assert.match(a.body,/v1/);
 live.publish('v2');const before=a.body;live.publish('v2');assert.equal(a.body,before);assert.match(a.body,/v2/);
 v='v2';const b=new Response();live.connect({},b);await new Promise(r=>setTimeout(r,5));assert.match(b.body,/v2/);
 allowed=false;await new Promise(r=>setTimeout(r,30));assert.ok(a.destroyed&&b.destroyed);
 }finally{live.close();}
});
test('arrival entry appends two deliveries and finance can read receipts without write controls',async()=>{
 const before=globalThis.document;globalThis.document={querySelectorAll:()=>[]};
 try{
  let s=seed(),editor,acting=warehouse;const bindings=new Map(),els=new Map();
  const a={state:stockView(s,acting),$:key=>{if(!els.has(key))els.set(key,{});return els.get(key);},can:(...roles)=>a.state.role==='admin'||roles.includes(a.state.role),heading:t=>t,button:(id,label)=>`<button id="${id}">${label}</button>`,table:(headers,rows,empty)=>rows.length?rows.flat().join('|'):empty,escape:String,num:String,pill:String,bind:(id,fn)=>bindings.set(id,fn),bindAll:(key,fn)=>bindings.set(key,fn),showEditor:(title,html,handler)=>editor={title,html,handler},field:(name,label,value)=>`<input name="${name}" value="${value}">`,area:(name,label,value)=>`<textarea name="${name}">${value}</textarea>`,select:(name,label,options,value)=>`<select name="${name}">${value}</select>`,skuSelect:()=>'',command:async(action,data)=>{s=run(s,action,data,acting);a.state=stockView(s,acting);},localNow:()=>now,iso:x=>x,today:()=>now.slice(0,10),sku:id=>s.skus.find(k=>k.id===id),render:()=>renderPurchases(a),syncProductCatalog:async()=>{},catalogStatus:'测试'};
  const id=s.purchases[0].id;
  for(const [reference,good]of [['R1',200],['R2',300]]){
   a.render();assert.match(els.get('#content').innerHTML,/data-receive-purchase/);
   bindings.get('[data-receive-purchase]')({dataset:{receivePurchase:id}});if(reference==='R2'){assert.match(editor.html,/R1/);assert.doesNotMatch(editor.html,/下载/);bindings.get('add-arrival')();}assert.match(editor.html,/trackingNumber/);
   await editor.handler({reference,good,defect:0,pending:0,at:now,returnDecision:'待确认',note:'测试分批收货'});
  }
  assert.equal(s.purchases.length,1);assert.equal(s.purchaseReceipts.length,2);
  s.purchasePrivate={[id]:{balanceDue:100,contracts:[]}};acting=finance;a.state=stockView(s,acting);a.render();
  const html=els.get('#content').innerHTML;assert.match(html,/查看尾款情况|到货记录/);assert.doesNotMatch(html,/data-receive-purchase=|data-return-purchase=|data-edit-purchase=/);
  bindings.get('[data-purchase]')({dataset:{purchase:id}});assert.match(editor.html,/R1/);assert.match(editor.html,/R2/);assert.match(editor.html,/下载工厂对账表/);
  assert.doesNotMatch(editor.html,/decision-purchase|return-purchase|inspect-purchase/);
  renderPurchaseBalances({...a,onBack:()=>{}});assert.match(els.get('#content').innerHTML,/¥100\.00/);assert.match(els.get('#content').innerHTML,/2026-12-07/);assert.doesNotMatch(els.get('#content').innerHTML,/data-settle-balance=|data-reopen-balance=/);
 }finally{globalThis.document=before;}
});
