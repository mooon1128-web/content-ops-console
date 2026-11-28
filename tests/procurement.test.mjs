import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyStock,transact,balance} from '../content-ops/stock-model.js';
import {purchaseSummary,forecastSupply} from '../public/stock-ops/purchasing-math.js';
const admin={id:'admin',role:'admin',name:'测试负责人'},warehouse={id:'wh',role:'employee',stockRole:'warehouse'},pr={id:'pr',role:'employee',stockRole:'pr'};
const now='2026-11-22T08:00:00.000Z';
const run=(s,action,data,user=admin)=>transact(s,{action,data,revision:s.revision,requestId:randomUUID()},user,{now}).state;
const seed=()=>run(run(emptyStock(),'sku',{id:'test',code:'TEST',name:'测试商品',warehouse:'主仓'}),'snapshot',{skuId:'test',warehouse:'主仓',at:'2026-11-20T00:00:00Z',good:30,reserved:10,hold:0,source:'测试基准'});
const order={skuId:'test',reference:'TEST-PO1',quantity:500,status:'已下单',orderDate:'2026-11-20',expectedAt:'2026-11-21',warehouse:'主仓',note:'测试工厂订单'};
const receive={reference:'TEST-R1',at:'2026-11-21T01:00:00Z',good:450,defect:30,pending:20,returnDecision:'需寄回',note:'测试验收'};
test('order, receipt, inspection and factory return keep saleable and defective quantities separate',()=>{
 let s=run(seed(),'purchase',order);const id=s.purchases[0].id;assert.equal(balance(s,'test','主仓').available,20);assert.equal(s.events.length,0);
 s=run(s,'purchaseReceive',{...receive,purchaseId:id},warehouse);const receiptId=s.purchaseReceipts[0].id;
 assert.equal(balance(s,'test','主仓').available,470);assert.equal(balance(s,'test','主仓').hold,50);
 s=run(s,'purchaseInspect',{purchaseId:id,receiptId,reference:'INSPECT1',at:'2026-11-21T02:00:00Z',good:15,defect:5,note:'验收'},warehouse);
 assert.equal(balance(s,'test','主仓').available,485);assert.equal(balance(s,'test','主仓').hold,35);
 s=run(s,'purchaseReturn',{purchaseId:id,receiptId,reference:'RETURN1',at:'2026-11-21T03:00:00Z',quantity:35,note:'寄回'},warehouse);
 assert.equal(balance(s,'test','主仓').available,485);assert.equal(balance(s,'test','主仓').hold,0);
 assert.deepEqual(purchaseSummary(s.purchases[0],s.purchaseReceipts,s.purchaseInspections,s.purchaseReturns),{received:500,good:465,defect:35,pending:0,returned:35,defectInWarehouse:0,shortfall:0,over:0});
 assert.throws(()=>run(s,'purchaseReturn',{purchaseId:id,receiptId,reference:'RETURN2',at:now,quantity:1,note:'超量'},warehouse),/超过/);
});
test('partial arrivals, duplicates, unknown quality, over-receipt and role checks prevent stock errors',()=>{
 let s=run(seed(),'purchase',order),id=s.purchases[0].id;
 const data={...receive,purchaseId:id,good:200,defect:0,pending:0};s=run(s,'purchaseReceive',data,warehouse);
 assert.equal(purchaseSummary(s.purchases[0],s.purchaseReceipts).shortfall,300);
 assert.throws(()=>run(s,'purchaseReceive',data,warehouse),/已经登记/);
 assert.throws(()=>run(s,'purchaseReceive',{...data,reference:'R2',good:301},warehouse),/超收原因/);
 assert.throws(()=>run(s,'purchaseReceive',{...data,reference:'R2',pending:''},warehouse),/未知不能填0/);
 assert.throws(()=>run(s,'purchaseReceive',{...data,reference:'R2'},pr),/权限/);
 assert.throws(()=>run(s,'purchase',order,warehouse),/权限/);
 assert.equal(s.events.length,1);assert.equal(s.purchaseReceipts.length,1);
 s=run(s,'purchaseReceive',{...data,reference:'R2',good:301,overReceiptReason:'工厂多发1件'},warehouse);
 assert.equal(purchaseSummary(s.purchases[0],s.purchaseReceipts).over,1);
});
test('plans cannot become inventory; historical receipt failure is atomic',()=>{
 let s=run(seed(),'purchase',{...order,status:'计划',orderDate:'2026-12-01',expectedAt:'2027-01-10'}),id=s.purchases[0].id;
 assert.throws(()=>run(s,'purchaseConfirm',{purchaseId:id,note:'确认'}),/未来计划/);
 assert.throws(()=>run(s,'purchaseReceive',{...receive,purchaseId:id}),/先确认/);
 s=run(seed(),'purchase',order);id=s.purchases[0].id;
 assert.throws(()=>run(s,'purchaseReceive',{...receive,purchaseId:id,at:'2026-11-20T00:00:00Z'}),/早于最新盘点/);
 assert.equal(s.events.length,0);assert.equal(s.purchaseReceipts.length,0);
});
const inputs={asOf:'2026-11-22',orderDate:'2026-11-22',target:'2027-02-28',available:63,daily:3,leadDays:45,transportDays:0,pauseDays:0,bufferDays:0,safetyDays:0,moq:500,packSize:1,otherDemand:0,inTransit:[]};
test('forecast keeps demand during presale and MOQ extends coverage from the inventory date',()=>{
 const r=forecastSupply(inputs);assert.equal(r.quantity,500);assert.equal(r.arrival,'2027-01-06');assert.equal(r.gapBeforeArrival,72);assert.equal(r.firstShortage,'2026-12-13');assert.equal(r.targetBalance,266);assert.equal(r.coverageThrough,'2027-05-27');
 const later=forecastSupply({...inputs,orderDate:'2026-12-22'});assert.equal(later.arrival,'2027-02-05');assert.equal(later.gapBeforeArrival,162);assert.equal(later.coverageThrough,r.coverageThrough);
});
test('known inbound, pack multiples, unknown inputs and late arrival are handled explicitly',()=>{
 assert.equal(forecastSupply({...inputs,available:400}).quantity,0);
 assert.equal(forecastSupply({...inputs,available:0,daily:7,moq:500,packSize:50}).quantity,700);
 assert.equal(forecastSupply({...inputs,inTransit:[{at:'2026-12-01',quantity:300}]}).quantity,0);
 assert.throws(()=>forecastSupply({...inputs,transportDays:''}),/未知不能填0/);
 assert.throws(()=>forecastSupply({...inputs,inTransit:[{at:'2026-11-01',quantity:500}]}),/逾期/);
 const late=forecastSupply({...inputs,pauseDays:90});assert.equal(late.canArriveByTarget,false);assert.equal(late.targetBalance,-234);
});
test('forecast saves its assumptions without placing orders or changing past suggestions',()=>{
 let s=run(seed(),'forecast',{skuId:'test',inputs,basis:'测试情景，不是实际采购'});const original=structuredClone(s.forecasts[0]);
 s=run(s,'forecast',{skuId:'test',inputs:{...inputs,daily:4},basis:'新情景'});
 assert.deepEqual(s.forecasts[0],original);assert.equal(s.forecasts.length,2);assert.equal(s.purchases.length,0);assert.equal(s.events.length,0);
});

test('editing a purchase preserves receipts, contracts, settlements and the old public values',()=>{
 let s=run(seed(),'purchase',order),o=s.purchases[0];
 s.purchasePrivate={[o.id]:{balanceDue:123.45,contracts:[{id:'keep'}],settlement:{status:'已结清'}}};
 const privateBefore=structuredClone(s.purchasePrivate),events=structuredClone(s.events),original=structuredClone(o);
 s=run(s,'purchaseUpdate',{...o,purchaseId:o.id,expectedUpdatedAt:o.updatedAt,reference:'TEST-PO1-new',quantity:600,expectedShipAt:'2026-11-22',expectedAt:'2026-11-23'});
 assert.equal(s.purchases.length,1);assert.equal(s.purchases[0].id,original.id);assert.equal(s.purchases[0].quantity,600);
 assert.equal(s.purchases[0].editHistory[0].previous.quantity,500);assert.equal(s.purchases[0].editHistory[0].previous.reference,original.reference);
 assert.deepEqual(s.purchasePrivate,privateBefore);assert.deepEqual(s.events,events);assert.deepEqual(s.purchaseReceipts,[]);
});
test('purchase edits reject stale forms, duplicate batches, invalid quantities and unauthorized roles atomically',()=>{
 let s=run(seed(),'purchase',order),o=s.purchases[0],d={...o,purchaseId:o.id,expectedUpdatedAt:o.updatedAt},before=structuredClone(s);
 for(const role of [warehouse,pr])assert.throws(()=>run(s,'purchaseUpdate',d,role),/权限/);
 assert.throws(()=>run(s,'purchaseUpdate',{...d,expectedUpdatedAt:'old'}),/已被修改/);
 for(const quantity of [0,-1,'',1.2])assert.throws(()=>run(s,'purchaseUpdate',{...d,quantity}));
 assert.throws(()=>run(s,'purchaseUpdate',{...d,orderDate:'2026-12-01',expectedShipAt:'2026-12-10',expectedAt:''}),/未来计划/);
 assert.deepEqual(s,before);
 s=run(s,'purchase',{...order,reference:'TEST-PO2'});
 assert.throws(()=>run(s,'purchaseUpdate',{...d,reference:'TEST-PO2'}),/已经登记/);
 s=transact(s,{action:'purchaseUpdate',data:{...d,quantity:600},revision:s.revision,requestId:randomUUID()},admin,{now:'2026-11-22T08:01:00.000Z'}).state;
 assert.throws(()=>run(s,'purchaseUpdate',{...d,quantity:700}),/已被修改/);
});
test('received and shipped batches keep their inventory identity while allowing safe corrections',()=>{
 let s=run(seed(),'purchase',order),o=s.purchases[0];
 s=run(s,'purchaseShip',{purchaseId:o.id,reference:'SHIP1',at:'2026-11-21',quantity:300,note:'已出货'});
 s=run(s,'purchaseReceive',{...receive,purchaseId:o.id,good:200,defect:0,pending:0},warehouse);
 o=s.purchases[0];const d={...o,purchaseId:o.id,expectedUpdatedAt:o.updatedAt};
 assert.throws(()=>run(s,'purchaseUpdate',{...d,quantity:299}),/不能少于/);
 assert.throws(()=>run(s,'purchaseUpdate',{...d,warehouse:'副仓'}),/已有出货或收货/);
 assert.throws(()=>run(s,'purchaseUpdate',{...d,status:'计划'}),/已有出货或收货/);
 assert.throws(()=>run(s,'purchaseUpdate',{...d,orderDate:'2026-11-22',expectedShipAt:'2026-11-23',expectedAt:''}),/不能晚于/);
 const snapshot=structuredClone({receipts:s.purchaseReceipts,events:s.events,shipments:o.shipments});
 s=run(s,'purchaseUpdate',{...d,quantity:600,note:'工厂增补100件'});
 assert.deepEqual({receipts:s.purchaseReceipts,events:s.events,shipments:s.purchases[0].shipments},snapshot);
});
test('before shipment, correcting the selected SKU preserves record ID and does not move inventory',()=>{
 let s=run(seed(),'sku',{id:'second',code:'SECOND',name:'另一个款',warehouse:'主仓'});
 s=run(s,'purchase',order);const o=s.purchases[0];
 s=run(s,'purchaseUpdate',{...o,purchaseId:o.id,expectedUpdatedAt:o.updatedAt,skuId:'second',warehouse:'副仓'});
 assert.equal(s.purchases[0].id,o.id);assert.equal(s.purchases[0].skuId,'second');assert.equal(s.purchases[0].editHistory[0].previous.skuId,'test');assert.equal(s.events.length,0);
});

import {renderPurchases} from '../public/stock-ops/purchasing-ui.js';
test('visible edit action opens existing values and saves through the real purchase command twice',async()=>{
 const documentBefore=globalThis.document;globalThis.document={querySelectorAll:()=>[]};
 try{
 let s=run(seed(),'purchase',order);s=run(s,'sku',{id:'other',code:'OTHER',name:'另款',warehouse:'主仓'});
 const bindings=new Map(),els=new Map();let editor;
 const a={state:{...s,role:'admin',balances:[]},$:key=>{if(!els.has(key))els.set(key,{});return els.get(key);},can:()=>true,heading:()=>'',button:(id,label)=>`<button id="${id}">${label}</button>`,table:(headers,rows)=>rows.flat().join(''),escape:String,num:String,pill:String,bind:(id,fn)=>bindings.set(id,fn),bindAll:(key,fn)=>bindings.set(key,fn),showEditor:(title,html,handler)=>{editor={title,html,handler};},field:(name,label,value)=>`<input name="${name}" value="${value}">`,area:(name,label,value)=>`<textarea name="${name}">${value}</textarea>`,select:(name,label,options,value)=>`<select name="${name}">${value}</select>`,skuSelect:(name,value)=>`<select name="${name}">${value}</select>`,command:async(action,data)=>{s=run(s,action,data);a.state={...s,role:'admin',balances:[]};},localNow:()=>now,iso:x=>x,today:()=>now.slice(0,10),sku:id=>s.skus.find(k=>k.id===id),render:()=>{},syncProductCatalog:async()=>{},catalogStatus:'已同步'};
 for(const quantity of [600,700]){
  renderPurchases(a);assert.match(els.get('#content').innerHTML,/data-edit-purchase/);
  bindings.get('[data-edit-purchase]')({dataset:{editPurchase:s.purchases[0].id}});
  assert.match(editor.html,new RegExp('value="'+s.purchases[0].quantity+'"'));assert.doesNotMatch(editor.html,/balanceDue|purchase-contract-files/);
  await editor.handler({...order,quantity});assert.equal(s.purchases.length,1);assert.equal(s.purchases[0].quantity,quantity);
 }
 assert.equal(s.purchases[0].editHistory.length,2);assert.equal(s.events.length,0);
 }finally{globalThis.document=documentBefore;}
});
