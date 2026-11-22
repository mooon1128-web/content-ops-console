import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyStock,transact} from '../content-ops/stock-model.js';
import {addSalesRecipe,activeRecipes,calculateComponentSales} from '../content-ops/sales-components.js';
import {collectionInstructions} from '../public/stock-ops/sales-recipes-ui.js';
const admin={id:'test-admin',role:'admin',name:'测试'},now='2026-11-22T08:00:00Z';
const base={channel:'淘宝',shop:'BlueMoon研究所'};
const job={id:'j',start:'2026-10-01',end:'2026-10-31',refundAsOf:'2026-11-22',channels:['淘宝'],skuIds:['A','B']};
const rule=(itemId,components,extra={})=>({...base,itemId,platformSkuId:'s-'+itemId,validFrom:'2026-01-01',components,source:'已核规格组成',...extra});
const state=()=>({...emptyStock(),skus:[{id:'A',code:'A',name:'实物A',warehouse:'主仓'},{id:'B',code:'B',name:'实物B',warehouse:'主仓'}]});
const setup=()=>{const s=state();addSalesRecipe(s,rule('single',[{skuId:'A',units:1}]),admin,now);addSalesRecipe(s,rule('bundle',[{skuId:'A',units:1},{skuId:'B',units:1}]),admin,now);return s;};
const order=(itemId,id,quantity=1,extra={})=>({...base,itemId,platformSkuId:'s-'+itemId,orderId:'order-'+id,lineId:id,paidAt:'2026-10-10T14:00:00+08:00',quantity,lineKind:'platform',...extra});
const refund=(order,id,extra={})=>({...base,orderId:order.orderId,lineId:order.lineId,refundId:id,refundLineId:'line-'+id,status:'success',completedAt:'2026-11-10',kind:'whole',quantity:1,...extra});
const data=(orders,refunds=[])=>({format:'component-orders-v1',orders,refunds,coverage:[{...base,start:job.start,end:job.end,refundAsOf:job.refundAsOf,ordersComplete:true,refundsComplete:true,linksComplete:true,orderLineCount:new Set(orders.map(o=>o.orderId+'|'+o.lineId)).size,paidUnits:[...new Map(orders.map(o=>[o.orderId+'|'+o.lineId,o])).values()].reduce((n,o)=>n+o.quantity,0),source:'原平台全店已付款报表控制合计'}],evidence:[{name:'orders.csv',source:'测试脱敏明细'}]});
const calc=(s,d,j=job)=>calculateComponentSales(s,j,d);
const values=r=>r.rows.map(x=>[x.skuId,x.paid,x.refund,x.net]);
const run=(s,action,data)=>transact(s,{action,data,revision:s.revision,requestId:randomUUID()},admin,{now}).state;

test('one standalone A plus one A+B counts 2A and 1B across differently named links',()=>{
 const result=calc(setup(),data([order('single','1',1,{name:'淘宝名称'}),order('bundle','2',1,{name:'完全不同名称'})]));
 assert.equal(result.complete,true);assert.deepEqual(values(result),[['A',2,0,2],['B',1,0,1]]);assert.equal(result.rows[0].payAmount,null);
});
test('2A+B bundles multiply purchased sets and whole refunds; partial B refund affects only B',()=>{
 const s=state();addSalesRecipe(s,rule('bundle',[{skuId:'A',units:2},{skuId:'B',units:1}]),admin,now);
 const o=order('bundle','1',3),result=calc(s,data([o],[refund(o,'r1'),refund(o,'r2',{kind:'components',quantity:null,components:[{skuId:'B',quantity:1}]})]));
 assert.equal(result.complete,true);assert.deepEqual(values(result),[['A',6,2,4],['B',3,2,1]]);
});
test('exact repeated order and refund exports deduplicate, conflicting repetitions block acceptance',()=>{
 const s=setup(),a=order('single','1'),b=order('bundle','2'),r=refund(b,'r1');
 const result=calc(s,data([a,b,a],[r,r]));assert.equal(result.complete,true);assert.deepEqual(values(result),[['A',2,1,1],['B',1,1,0]]);assert.equal(result.summary.duplicateOrders,1);assert.equal(result.summary.duplicateRefunds,1);
 assert.equal(calc(s,data([a,{...a,quantity:2}])).complete,false);
 assert.equal(calc(s,data([b],[r,{...r,kind:'amount_only',quantity:0}])).complete,false);
});
test('amount adjustments, pending, closed and later refunds do not deduct; unknown and excess refunds block',()=>{
 const s=setup(),o=order('bundle','1');
 const r=calc(s,data([o],[refund(o,'1',{kind:'amount_only',quantity:0}),refund(o,'2',{status:'pending'}),refund(o,'3',{status:'closed'}),refund(o,'4',{completedAt:'2026-11-23'})]));assert.equal(r.complete,true);assert.equal(r.rows[0].net,1);
 assert.equal(calc(s,data([o],[refund(o,'u',{kind:'unknown'})])).complete,false);
 assert.equal(calc(s,data([o],[refund(o,'x'),refund(o,'y')])).complete,false);
});
test('payment date selects historical recipe, Shanghai date boundary and cross-month refunds use payment cohort',()=>{
 const s=state();addSalesRecipe(s,rule('bundle',[{skuId:'A',units:1}],{validTo:'2026-09-30'}),admin,now);addSalesRecipe(s,rule('bundle',[{skuId:'A',units:2}],{validFrom:'2026-10-01'}),admin,now);
 const o=order('bundle','1',1,{paidAt:'2026-09-30T17:00:00Z'}),r=calc(s,data([o],[refund(o,'1')]));assert.equal(r.complete,true);assert.deepEqual(values(r),[['A',2,2,0],['B',0,0,0]]);
 assert.throws(()=>addSalesRecipe(s,rule('bundle',[{skuId:'B',units:1}]),admin,now),/重叠/);
});
test('unknown mapping, missing SKU, child ERP row and incomplete controls are blocked rather than guessed zero',()=>{
 const s=setup();assert.equal(calc(s,data([order('unknown','1',1,{name:'实物A'})])).complete,false);
 const o=order('single','1');assert.equal(calc(s,data([{...o,platformSkuId:''}])).complete,false);
 assert.equal(calc(s,data([{...o,lineKind:'erp_child'}])).complete,false);
 const d=data([o]);d.coverage[0].paidUnits=2;assert.equal(calc(s,d).complete,false);d.coverage[0].paidUnits=1;d.coverage[0].linksComplete=false;assert.equal(calc(s,d).complete,false);
 assert.throws(()=>calc(s,{rows:[],evidence:[]}),/component-orders-v1/);
});
test('same names with different SKU IDs stay separate and no customer fields are persisted',()=>{
 const s=setup();addSalesRecipe(s,rule('b',[{skuId:'B',units:1}],{name:'实物A'}),admin,now);
 const r=calc(s,data([order('single','1',1,{phone:'DO-NOT-STORE'}),order('b','2')]));assert.deepEqual(values(r),[['A',1,0,1],['B',1,0,1]]);assert.equal(JSON.stringify(r).includes('DO-NOT-STORE'),false);
});
test('different channels and shops do not collide; repeated orders within a platform remain independent',()=>{
 const s=setup();addSalesRecipe(s,rule('single',[{skuId:'B',units:1}],{channel:'小红书',shop:'馒头猫线下工作室的店'}),admin,now);
 const d=data([order('single','1'),order('single','1',1,{channel:'小红书',shop:'馒头猫线下工作室的店'})]);d.coverage[0].orderLineCount=1;d.coverage[0].paidUnits=1;d.coverage.push({...d.coverage[0],channel:'小红书',shop:'馒头猫线下工作室的店'});
 const r=calc(s,d,{...job,channels:['淘宝','小红书']});assert.equal(r.complete,true);assert.equal(r.rows.find(x=>x.skuId==='A'&&x.channel==='淘宝').net,1);assert.equal(r.rows.find(x=>x.skuId==='B'&&x.channel==='小红书').net,1);
});
test('recipe revisions are append-only and old collection snapshots survive',()=>{
 const s=setup(),old=activeRecipes(s)[0],prior=structuredClone(old);addSalesRecipe(s,{...old,replaces:old.id,components:[{skuId:'A',units:2}]},admin,now);
 assert.deepEqual(s.salesRecipes[0],prior);assert.equal(activeRecipes(s).length,2);assert.equal(calc(s,data([order('single','1')])).rows[0].paid,2);
});
test('staging leaves monthly records alone; explicit replacement archives old data and inventory stays unchanged',()=>{
 let s=setup();s=run(s,'monthly',{skuId:'A',month:'2026-10',channel:'淘宝',paid:99,refund:0,through:'2026-10-31',refundAsOf:'2026-11-22',source:'旧汇总'});const old=structuredClone(s.monthly[0]);
 s=run(s,'collection',{...job,title:'套餐复核'});const id=s.collections[0].id;s=run(s,'collectionResult',{...data([order('single','1'),order('bundle','2')]),jobId:id});assert.deepEqual(s.monthly[0],old);
 assert.throws(()=>run(s,'collectionAccept',{jobId:id,note:'已核'}),/确认差异/);
 s=run(s,'collectionAccept',{jobId:id,note:'已核',replaceExisting:true});assert.equal(s.monthly[0].net,2);assert.equal(s.monthly[0].calculationBasis,'components-v1');assert.deepEqual(s.collections[0].previousMonthly,[old]);assert.equal(s.events.length,0);
 assert.throws(()=>run(s,'collectionAccept',{jobId:id,note:'重复'}),/已经入账/);
});
test('new monthly edits or recipe changes between stage and accept block overwriting with stale results',()=>{
 let s=setup();s=run(s,'collection',{...job,title:'套餐复核'});const id=s.collections[0].id;s=run(s,'collectionResult',{...data([order('single','1')]),jobId:id});
 let changed=run(s,'monthly',{skuId:'A',month:'2026-10',channel:'淘宝',paid:33,refund:0,through:'2026-10-31',refundAsOf:'2026-11-22',source:'同事新记录'});assert.throws(()=>run(changed,'collectionAccept',{jobId:id,note:'已核',replaceExisting:true}),/已有新记录/);
 changed=run(s,'salesRecipe',{...activeRecipes(s)[0],replaces:activeRecipes(s)[0].id,components:[{skuId:'A',units:2}]});assert.throws(()=>run(changed,'collectionAccept',{jobId:id,note:'已核'}),/规则已变化/);
});
test('unresolved calculation stages review items and cannot write monthly',()=>{
 let s=setup();s=run(s,'collection',{...job,title:'套餐复核'});const id=s.collections[0].id;s=run(s,'collectionResult',{...data([order('unknown','1')]),jobId:id});assert.equal(s.collections[0].status,'待补资料');assert.equal(s.monthly.length,0);assert.throws(()=>run(s,'collectionAccept',{jobId:id,note:'忽略'}),/完整/);
});
test('warehouse cannot change product recipes; instructions include all links and component refund schema',()=>{
 const s=setup();assert.throws(()=>transact(s,{action:'salesRecipe',data:rule('x',[{skuId:'A',units:1}]),revision:0,requestId:'p'},{id:'w',role:'employee',stockRole:'warehouse'},{now}),/权限/);
 const instructions=collectionInstructions(s,{...job,title:'检查'});for(const word of ['A=2','B=1','component-orders-v1','refundLineId','linksComplete','旧平台对应只是候选'])assert.ok(instructions.includes(word));
});
