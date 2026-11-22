import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { emptyStock,transact,balance,stockView,saturday } from '../content-ops/stock-model.js';
import { createStockStore } from '../content-ops/stock-store.js';
import { initialAccess } from '../content-ops/access.js';
const admin={id:'admin',name:'负责人',username:'admin',role:'admin'};
const warehouse={id:'warehouse',name:'仓库',username:'warehouse',role:'employee',stockRole:'warehouse'};
const operations={id:'ops',name:'运营',role:'employee',stockRole:'operations'};
const now='2026-11-21T10:00:00.000Z';
const cmd=(s,action,data,key=randomUUID())=>({revision:s.revision,action,data,requestId:key});
const run=(s,action,data,user=admin,context={})=>transact(s,cmd(s,action,data),user,{now,...context}).state;
const seed=()=>run(emptyStock(),'sku',{id:'fish',code:'SKU-FISH',name:'测试款A',warehouse:'主仓'});
const snapshot={skuId:'fish',warehouse:'主仓',at:'2026-11-21T01:00:00Z',good:100,reserved:20,hold:3,source:'实物盘点'};
const ev={skuId:'fish',warehouse:'主仓',at:'2026-11-21T02:00:00Z',quantity:10,released:0,ref:'W001',note:'出库单'};

test('known available observation is never invented as physical stock or zero reservations',()=>{
 let s=seed();s=run(s,'observation',{skuId:'fish',date:'2026-11-21',available:125,source:'用户已扣待发'});
 assert.equal(balance(s,'fish','主仓'),null);assert.equal(s.snapshots.length,0);assert.equal(s.skus[0].moq,null);
 assert.throws(()=>run(s,'snapshot',{...snapshot,hold:''}),/未知不能填0/);
});
test('monthly cohort is separate from inventory and unknown refunds remain unknown',()=>{
 let s=run(seed(),'snapshot',snapshot);const data={skuId:'fish',month:'2026-10',channel:'淘宝',through:'2026-10-31',paid:10,refund:'',refundAsOf:'2026-11-21',source:'订单明细'};
 s=run(s,'monthly',data,operations);assert.equal(s.monthly[0].net,null);assert.equal(balance(s,'fish','主仓').available,80);
 assert.throws(()=>run(s,'monthly',data),/已有记录/);
 s=run(s,'monthly',{...data,id:s.monthly[0].id,refund:2},operations);assert.equal(s.monthly[0].net,8);assert.equal(s.events.length,0);
 assert.equal(s.audit.at(-2).result.refund,null);
});
test('warehouse permissions are enforced and platform SKU mapping cannot collide',()=>{
 let s=seed();assert.throws(()=>run(s,'sku',{code:'NEW',name:'new'},warehouse),/权限/);
 assert.throws(()=>run(s,'event',{...ev,type:'sale'},operations),/权限/);
 assert.throws(()=>stockView(s,{role:'employee'}),/分配/);
 s=run(s,'sku',{...s.skus[0],taobaoSkuId:'123'});assert.throws(()=>run(s,'sku',{code:'2',name:'2',taobaoSkuId:'123'}),/绑定/);
});
test('same sample request and same shipment cannot deduct twice; missing quantity cannot default to one',()=>{
 let s=run(seed(),'snapshot',snapshot),context={now,placements:[{id:'p1',creator:'博主',product:'商品'}]};
 const data={...ev,placementId:'p1',shipment:'sample001'},c=cmd(s,'sample',data);
 const result=transact(s,c,warehouse,context);s=result.state;assert.equal(balance(s,'fish','主仓').good,90);
 assert.equal(transact(s,c,warehouse,context).replayed,true);
 assert.throws(()=>transact(s,cmd(s,'sample',data),warehouse,context),/重复/);
 assert.throws(()=>transact(s,cmd(s,'sample',{...data,shipment:'sample002',quantity:null}),warehouse,context),/未知/);
 assert.throws(()=>transact(s,{...c,data:{...data,quantity:9}},warehouse,context),/其他操作/);
});
test('exchange shipment and returned item inspection affect distinct inventory buckets',()=>{
 let s=run(seed(),'snapshot',snapshot);
 s=run(s,'case',{reference:'AS1',order:'ORDER1',channel:'淘宝',skuId:'fish',replacementQty:1,returnQty:1,reason:'换货'},operations);
 const caseId=s.cases[0].id;assert.equal(balance(s,'fish','主仓').good,100);
 s=run(s,'caseAction',{...ev,caseId,stage:'replacement',quantity:1},warehouse);assert.equal(balance(s,'fish','主仓').good,99);
 s=run(s,'caseAction',{...ev,ref:'RETURN1',caseId,stage:'return_hold',quantity:1},warehouse);assert.equal(balance(s,'fish','主仓').good,99);assert.equal(balance(s,'fish','主仓').hold,4);
 assert.throws(()=>run(s,'caseAction',{...ev,ref:'RETURN2',caseId,stage:'return_good',quantity:1},warehouse),/超过/);
 s=run(s,'event',{...ev,ref:'QC1',type:'inspect_good',quantity:1},warehouse);assert.equal(balance(s,'fish','主仓').good,100);assert.equal(balance(s,'fish','主仓').hold,3);
});
test('reserved stock is released exactly once when goods leave; negative balances are rejected',()=>{
 let s=run(seed(),'snapshot',snapshot);
 s=run(s,'event',{...ev,type:'sale',released:10},warehouse);assert.deepEqual({...balance(s,'fish','主仓'),baseAt:null},{good:90,reserved:10,hold:3,available:80,baseAt:null});
 assert.throws(()=>run(s,'event',{...ev,ref:'NEG',type:'release',quantity:11},warehouse),/负库存/);
 assert.throws(()=>run(s,'event',{...ev,ref:'OLD',type:'sale',at:'2026-11-20T00:00:00Z'},warehouse),/早于/);
});
test('Saturday is based on Shanghai time; snapshots retain unexplained gaps',()=>{
 assert.equal(saturday('2026-11-20T16:00:00Z'),'2026-11-21');assert.equal(saturday('2026-11-20T15:59:59Z'),'2026-11-14');
 let s=run(seed(),'snapshot',snapshot);s=run(s,'event',{...ev,type:'sale',released:10},warehouse);
 s=run(s,'snapshot',{...snapshot,at:'2026-11-21T03:00:00Z',good:87,reserved:10},warehouse);
 assert.equal(s.snapshots.at(-1).gap,-3);assert.equal(s.snapshots.at(-1).expected.good,90);assert.equal(s.events.length,1);
 assert.equal(stockView(s,warehouse,new Date(now)).balances[0].reported,true);
});
test('weekly submission validates all rows atomically and stale revisions never overwrite teammates',()=>{
 let s=seed(),before=structuredClone(s);
 assert.throws(()=>run(s,'week',{rows:[snapshot,{...snapshot,good:''} ]},warehouse));assert.deepEqual(s,before);
 const c=cmd(s,'observation',{skuId:'fish',date:'2026-11-21',available:125,source:'用户'});s=run(s,'snapshot',snapshot);
 assert.throws(()=>transact(s,c,admin,{now}),/同事已更新/);
});
test('persisted concurrent commits serialize, maintain backups and survive restart',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-test-')),file=join(dir,'state.json');
 try{const store=createStockStore({file});const s=emptyStock();const results=await Promise.allSettled([store.commit(cmd(s,'sku',{code:'A',name:'A'}),admin,{now}),store.commit(cmd(s,'sku',{code:'B',name:'B'}),admin,{now})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
 const reopened=createStockStore({file});assert.equal((await reopened.read()).skus.length,1);assert.equal((await reopened.read()).audit[0].actor.id,'admin');
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('cost source remains complete, missing prices stay null, and staff cannot read it through audit/import',()=>{
 let s=seed();const cost={source:{name:'cost.xlsx',sha256:'a'.repeat(64)},sheets:[{name:'成本',rows:[{row:4,values:['SKU','成本']},{row:5,values:['A',null],formulas:{1:'=source!A1'},original:['A','=source!A1']}]}]};
 s=run(s,'import',{operations:[{action:'costArchive',data:cost}]});assert.equal(s.costWorkbook.sheets[0].rows[1].values[1],null);
 assert.ok(stockView(s,admin).costWorkbook);assert.equal(stockView(s,warehouse).costWorkbook,undefined);assert.ok(!JSON.stringify(stockView(s,warehouse)).includes('cost.xlsx'));
 assert.throws(()=>run(s,'costArchive',cost,operations),/权限/);
});
test('collection jobs stage complete cohort results, reject incomplete/unknown data, and accept once',()=>{
 let s=seed();s=run(s,'collection',{title:'月销核对',start:'2026-10-01',end:'2026-10-31',refundAsOf:'2026-11-21',skuIds:['fish'],channels:['淘宝']},operations);
 const id=s.collections[0].id,row={skuId:'fish',month:'2026-10',channel:'淘宝',through:'2026-10-31',refundAsOf:'2026-11-21',paid:20,refund:3,source:'子订单去重和完成退款'},evidence=[{name:'orders.csv',source:'千牛订单导出，已脱敏'}];
 assert.throws(()=>run(s,'collectionResult',{jobId:id,rows:[],evidence},operations),/还缺/);
 assert.throws(()=>run(s,'collectionResult',{jobId:id,rows:[{...row,refund:null}],evidence},operations),/未知不能按0/);
 s=run(s,'collectionResult',{jobId:id,rows:[row],evidence},operations);assert.equal(s.monthly.length,0);assert.equal(s.collections[0].status,'待核对');
 s=run(s,'collectionAccept',{jobId:id,note:'逐单核验完毕'},operations);assert.equal(s.monthly[0].net,17);assert.equal(s.events.length,0);assert.equal(s.collections[0].status,'已入账');
 assert.throws(()=>run(s,'collectionAccept',{jobId:id,note:'again'},operations),/已经入账/);
});
test('server API requires login, enforces stock roles and sanitizes influencer data',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'stock-api-')),probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const file=join(dir,'content.json'),xhs=join(dir,'xhs.json');
 await writeFile(file,JSON.stringify({accounts:[],titles:[],posts:[],products:[],updatedAt:now,_access:await initialAccess([{username:'admin',password:'TestOnly123',name:'管理员',role:'admin'},{username:'warehouse',password:'TestOnly123',name:'仓库',role:'employee',stockRole:'warehouse'},{username:'content',password:'TestOnly123',name:'内容',role:'employee'}])}));
 await writeFile(xhs,JSON.stringify({creators:[],placements:[{id:'p1',creator:'博主A',product:'鱼',address:'NEVER-EXPOSE',phone:'NEVER-EXPOSE'}],customCreatorTypes:[],monthlyBudgets:{}}));
 const child=spawn(process.execPath,['content-ops/server.js','--host','127.0.0.1','--port',String(port)],{cwd:new URL('..',import.meta.url),env:{...process.env,CONTENT_OPS_DATA:file,XHS_MEDIA_DATA:xhs,STOCK_OPS_DATA:join(dir,'stock.json'),SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'pipe'});
 const base=`http://127.0.0.1:${port}`;
 try{let ready=false;for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,30))}assert.ok(ready);
 assert.equal((await fetch(base+'/api/stock-ops/state')).status,401);
 const login=async username=>{const r=await fetch(base+'/api/content-ops/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'TestOnly123'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]};
 const adminCookie=await login('admin'),whCookie=await login('warehouse'),contentCookie=await login('content');
 const post=(cookie,c)=>fetch(base+'/api/stock-ops/command',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(c)});
 assert.equal((await fetch(base+'/api/stock-ops/state',{headers:{Cookie:contentCookie}})).status,403);
 assert.equal((await post(whCookie,cmd(emptyStock(),'sku',{code:'A',name:'A'}))).status,403);
 assert.equal((await post(adminCookie,cmd(emptyStock(),'sku',{code:'A',name:'A'}))).status,200);
 const wh=await (await fetch(base+'/api/stock-ops/state',{headers:{Cookie:whCookie}})).json();assert.equal(wh.skus.length,1);assert.equal(wh.requests,undefined);
 const sample=await (await fetch(base+'/api/stock-ops/samples',{headers:{Cookie:whCookie}})).json();assert.equal(sample.placements[0].sampleQuantity,null);assert.ok(!JSON.stringify(sample).includes('NEVER-EXPOSE'));
 assert.equal((await fetch(base+'/api/stock-ops/state',{headers:{Cookie:whCookie,Origin:'https://evil.invalid'}})).status,403);
 assert.equal((await fetch(base+'/stock-ops/')).status,200);
 }finally{child.kill();await new Promise(r=>child.on('exit',r));await rm(dir,{recursive:true,force:true})}
});
