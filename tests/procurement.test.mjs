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
