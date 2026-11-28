import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {emptyStock,transact} from '../content-ops/stock-model.js';
import {createStockStore} from '../content-ops/stock-store.js';
import {reconciliation,reconciliationKey,handoffInbox,handoffCurrent} from '../public/stock-ops/purchase-reconciliation.js';
import {reconciliationCard,renderReconciliationCanvases} from '../public/stock-ops/record-image.js';
const admin={id:'admin',username:'owner',name:'管理员',role:'admin'},bonnie={id:'bonnie',username:'bonnie',name:'bonnie',role:'admin'},wh={id:'wh',username:'wh',role:'employee',stockRole:'warehouse'};
const users=[admin,bonnie,wh,{id:'off',username:'off',role:'admin',disabled:true}],now='2026-11-28T04:00:00.000Z';
const command=(s,action,data)=>({action,data,revision:s.revision,requestId:randomUUID()});
const run=(s,action,data,user=wh,context={})=>transact(s,command(s,action,data),user,{now,users,...context}).state;
const seed=()=>run(run(emptyStock(),'sku',{id:'sku',code:'K',name:'测试商品',warehouse:'主仓'},admin),'purchase',{skuId:'sku',reference:'PO-500',quantity:500,status:'已下单',orderDate:'2026-11-20',expectedShipAt:'2026-11-22',warehouse:'主仓',note:'工厂订单'},admin);
const receive=(s,reference,good,defect,pending=0)=>run(s,'purchaseReceive',{purchaseId:s.purchases[0].id,reference,good,defect,pending,at:now,returnDecision:'需寄回',note:'验收依据'});
const finishData=s=>({purchaseId:s.purchases[0].id,confirmed:true,reviewKey:reconciliationKey(s,s.purchases[0].id)});
function ready(){let s=receive(receive(seed(),'R1',190,5,5),'R2',290,10);const id=s.purchases[0].id;for(const r of s.purchaseReceipts){if(r.pending)s=run(s,'purchaseInspect',{purchaseId:id,receiptId:r.id,reference:'QC1',at:now,good:3,defect:2,note:'验收完成'});s=run(s,'purchaseReturn',{purchaseId:id,receiptId:r.id,reference:'OUT-'+r.reference,quantity:r.defect+(r.pending?2:0),at:now,note:'已退回工厂',trackingNumber:'TRACK-'+r.reference});}return s;}
test('two physical deliveries reconcile inspections and returns; completion delivers immutable identical snapshots to both recipients',()=>{
 let s=ready(),before=structuredClone(s),id=s.purchases[0].id;
 assert.deepEqual(reconciliation(s,id).totals,{received:500,good:483,defect:17,pending:0,returned:17,defectInWarehouse:0,shortfall:0,over:0});
 s=run(s,'purchaseComplete',{...finishData(s),recipients:[{id:'intruder'}]});
 const a=handoffInbox(s,admin.id),b=handoffInbox(s,bonnie.id);assert.equal(a.length,1);assert.deepEqual(a,b);assert.equal(handoffInbox(s,wh.id).length,0);assert.equal(handoffInbox(s,'off').length,0);
 assert.deepEqual(s.events,before.events);assert.deepEqual(s.purchaseReceipts,before.purchaseReceipts);assert.deepEqual(s.purchasePrivate,before.purchasePrivate);
 assert.equal(a[0].snapshot.rows.length,2);assert.equal(a[0].snapshot.totals.returned,17);
 const snapshot=structuredClone(a[0].snapshot);
 s=run(s,'purchaseHandoffRead',{reportId:a[0].id},bonnie);assert.equal(handoffInbox(s,bonnie.id)[0].recipients.find(u=>u.id===bonnie.id).readAt,now);assert.equal(handoffInbox(s,admin.id)[0].recipients.find(u=>u.id===admin.id).readAt,null);assert.ok(handoffCurrent(s,s.purchaseHandoffs[0]));
 s=run(s,'purchaseComplete',finishData(s));assert.equal(s.purchaseHandoffs.length,1);
 s=run(s,'purchaseDecision',{purchaseId:id,receiptId:s.purchaseReceipts[0].id,returnDecision:'需寄回',note:'补充售后交接依据'});
 assert.equal(handoffCurrent(s,s.purchaseHandoffs[0]),false);assert.deepEqual(s.purchaseHandoffs[0].snapshot,snapshot);
 s=run(s,'purchaseComplete',finishData(s));assert.equal(s.purchaseHandoffs.length,2);assert.equal(s.purchaseHandoffs[1].version,2);assert.equal(s.purchaseHandoffs[1].previousReportId,s.purchaseHandoffs[0].id);assert.deepEqual(s.purchaseHandoffs[0].snapshot,snapshot);
});
test('unfinished, stale, missing-recipient and unauthorized completions fail atomically',()=>{
 let s=seed();assert.throws(()=>run(s,'purchaseComplete',finishData(s)),/尚未登记/);
 s=receive(s,'R1',480,10,10);const before=structuredClone(s);assert.throws(()=>run(s,'purchaseComplete',finishData(s)),/待检/);assert.deepEqual(s,before);
 const data=finishData(s);s=run(s,'purchaseInspect',{purchaseId:s.purchases[0].id,receiptId:s.purchaseReceipts[0].id,reference:'QC',at:now,good:10,defect:0,note:'完成'});
 assert.throws(()=>run(s,'purchaseComplete',data),/数据已变化/);assert.throws(()=>run(s,'purchaseComplete',finishData(s)),/瑕疵/);
 s=ready();for(const user of [{id:'f',role:'employee',stockRole:'finance'},{id:'o',role:'employee',stockRole:'operations'}])assert.throws(()=>run(s,'purchaseComplete',finishData(s),user),/权限/);
 assert.throws(()=>run(s,'purchaseComplete',{...finishData(s),confirmed:false}),/请确认/);
 assert.throws(()=>run(s,'purchaseComplete',finishData(s),wh,{users:[admin]}),/bonnie/);
 assert.throws(()=>run(s,'purchaseComplete',finishData(s),wh,{users:[admin,{...bonnie,disabled:true}]}),/bonnie/);
 s=run(s,'purchaseComplete',finishData(s));assert.throws(()=>run(s,'purchaseHandoffRead',{reportId:s.purchaseHandoffs[0].id},{id:'stranger',role:'admin'}),/自己的/);
});
test('short delivery and retained defects require explicit handling evidence, not invented returns',()=>{
 let s=receive(seed(),'R1',190,10);const id=s.purchases[0].id,rid=s.purchaseReceipts[0].id;
 s=run(s,'purchaseDecision',{purchaseId:id,receiptId:rid,returnDecision:'留仓处理',note:'工厂确认扣除瑕疵费用，留仓隔离'});
 assert.throws(()=>run(s,'purchaseComplete',finishData(s)),/差额/);
 const bad=structuredClone(s);bad.purchaseReceipts[0].decisionNote='';assert.throws(()=>run(bad,'purchaseComplete',finishData(bad)),/依据/);
 s=run(s,'purchaseComplete',{...finishData(s),discrepancyNote:'工厂确认余下300件取消，不再到货'});
 assert.equal(s.purchaseHandoffs[0].snapshot.totals.returned,0);assert.equal(s.purchaseHandoffs[0].snapshot.totals.defectInWarehouse,10);assert.equal(s.purchaseHandoffs[0].snapshot.totals.shortfall,300);
});
test('completion and inbox read receipts persist across store restart; concurrent retry cannot duplicate report',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'handoff-'));try{const store=createStockStore({file:join(dir,'state.json')});let s=await store.read();
 for(const c of [{action:'sku',data:{id:'k',code:'K',name:'测试',warehouse:'主仓'}},{action:'purchase',data:{skuId:'k',reference:'P',quantity:2,status:'已下单',orderDate:'2026-11-20',expectedShipAt:'2026-11-22',warehouse:'主仓',note:'测试'}}])s=(await store.commit(command(s,c.action,c.data),admin,{now,users})).state;
 s=(await store.commit(command(s,'purchaseReceive',{purchaseId:s.purchases[0].id,reference:'R',good:2,defect:0,pending:0,at:now,note:'到货'}),wh,{now,users})).state;
 const c=command(s,'purchaseComplete',finishData(s));const results=await Promise.all([store.commit(c,wh,{now,users}),store.commit(c,wh,{now,users})]);assert.ok(results.some(r=>r.replayed));
 const reopened=createStockStore({file:join(dir,'state.json')});s=await reopened.read('workspace');assert.equal(handoffInbox(s,bonnie.id).length,1);assert.equal(handoffInbox(s,admin.id).length,1);
 await reopened.commit(command(s,'purchaseHandoffRead',{reportId:s.purchaseHandoffs[0].id}),bonnie,{now,users});const saved=await createStockStore({file:join(dir,'state.json')}).read();assert.ok(Date.parse(saved.purchaseHandoffs[0].recipients.find(r=>r.id===bonnie.id).readAt)>=Date.parse(now));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('factory table exports quantities without financial data and long notes paginate without clipping',()=>{
 const s=ready(),report={...reconciliation(s,s.purchases[0].id),product:{name:'产品全名／颜色规格'},balanceDue:98765,contracts:['private']},card=reconciliationCard(report);
 assert.deepEqual(card.rows.at(-1),['合计','全部到货',500,483,17,17]);assert.doesNotMatch(JSON.stringify(card),/98765|private|尾款/);
 card.notes.push('很长的工厂处理依据'.repeat(500));const all=[];
 const createCanvas=()=>{const c={width:0,height:0,drawn:[],getContext:()=>({measureText:t=>({width:t.length*26}),fillRect(){},strokeRect(){},fillText(t,x,y){c.drawn.push({t,x,y});}})};all.push(c);return c;};
 const pages=renderReconciliationCanvases(card,createCanvas);assert.ok(pages.length>1);for(const page of pages){assert.ok(page.height<=2400);assert.ok(page.drawn.every(d=>d.y<page.height));assert.ok(page.drawn.some(d=>d.t==='最终寄回'));}
 assert.equal(pages.flatMap(p=>p.drawn).filter(d=>d.t==='合计').length,1);
});
