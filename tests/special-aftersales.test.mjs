import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyStock,transact,balance,stockView} from '../content-ops/stock-model.js';
import {specialSummary} from '../content-ops/special-aftersales.js';
import {initialAccess,publicUser} from '../content-ops/access.js';

const admin={id:'a',name:'管理员',role:'admin'},cs={id:'cs',name:'客服甲',role:'employee',stockRole:'customer_service'},wh={id:'wh',name:'仓管甲',role:'employee',stockRole:'warehouse'};
const now='2026-11-22T12:00:00.000Z';
const command=(s,action,data,id=randomUUID())=>({action,data,requestId:id,revision:s.revision});
const run=(s,a,p,u=admin)=>transact(s,command(s,a,p),u,{now}).state;
const setup=(good=10)=>{
  let s=run(emptyStock(),'sku',{id:'sku1',code:'DEMO-1',name:'测试维修款',warehouse:'主仓'});
  return run(s,'snapshot',{skuId:'sku1',warehouse:'主仓',at:'2026-11-22T00:00:00Z',good,reserved:0,hold:0,source:'测试盘点'});
};
const plan={reference:'SP-TEST-1',type:'repair',channel:'淘宝',order:'TEST-ORDER',skuId:'sku1',returnQty:2,replacementQty:0,owner:'客服甲',nextAction:'等待寄回',reason:'修好原件后寄回',dueDate:'2026-11-23'};
const action={at:'2026-11-22T01:00:00Z',quantity:1,ref:'TEST-DOC',location:'售后区 A1',note:'测试交接依据',nextAction:'检测并跟进'};
const act=(s,stage,p={})=>run(s,'specialAction',{...action,caseId:s.specialCases[0].id,stage,...p},wh);

test('repair round trip stays outside company stock and cannot ship before ready or exceed receipts',()=>{
  let s=run(setup(),'specialCase',plan,cs),initial=balance(s,'sku1','主仓');
  assert.equal(s.events.length,0);
  s=act(s,'receive',{quantity:2});
  assert.equal(specialSummary(s.specialCases[0]).held,2);
  assert.throws(()=>act(s,'ship_repair'),/待寄回/);
  assert.throws(()=>act(s,'return_good',{warehouse:'主仓'}),/维修原件不可/);
  s=act(s,'progress',{progress:'维修中'});
  s=act(s,'progress',{progress:'待寄回',note:'缝补已验收'});
  s=act(s,'ship_repair');
  assert.throws(()=>run(s,'specialClose',{caseId:s.specialCases[0].id,note:'完成'},cs),/仍有/);
  assert.throws(()=>act(s,'ship_repair',{ref:'TEST-OVER',quantity:2}),/超过/);
  assert.throws(()=>act(s,'ship_repair'),/已登记/);
  s=act(s,'ship_repair',{ref:'TEST-DOC-2'});
  assert.equal(specialSummary(s.specialCases[0]).ready,true);
  s=run(s,'specialClose',{caseId:s.specialCases[0].id,note:'核对两件寄回单据'},cs);
  assert.equal(specialSummary(s.specialCases[0]).status,'已完成');
  assert.equal(s.events.length,0);assert.deepEqual(balance(s,'sku1','主仓'),initial);
  assert.throws(()=>act(s,'receive'),/已结案/);
});

test('unidentified returns can be received but require service identification before handling',()=>{
  const p={...plan,type:'unknown',channel:'待认领',order:'',skuId:null};
  let s=run(setup(),'specialCase',p,wh);s=act(s,'receive');
  assert.equal(specialSummary(s.specialCases[0]).status,'待认领');
  assert.throws(()=>act(s,'ship_repair'),/先认领/);
  assert.throws(()=>act(s,'return_hold',{warehouse:'主仓'}),/先认领/);
  const update={...plan,caseId:s.specialCases[0].id,note:'通过退回运单对应原订单'};
  assert.throws(()=>run(s,'specialPlan',update,wh),/权限/);
  s=run(s,'specialPlan',update,cs);
  assert.equal(s.specialCases[0].history.at(-1).before.order,'');
  assert.equal(s.specialCases[0].order,'TEST-ORDER');
  assert.equal(specialSummary(s.specialCases[0]).held,1);
  assert.equal(s.events.length,0);
});

test('waiting for stock is a task; receiving supply flags readiness without auto-shipping',()=>{
  let s=run(setup(0),'specialCase',{...plan,type:'exchange',replacementSkuId:'sku1',replacementQty:2},cs);
  s=act(s,'receive',{quantity:2});
  s=act(s,'progress',{progress:'待到货'});
  assert.equal(stockView(s,cs).specialCases[0].summary.stockReady,false);
  assert.throws(()=>act(s,'replacement',{warehouse:'主仓',quantity:2}),/负库存/);
  s=run(s,'event',{skuId:'sku1',warehouse:'主仓',at:'2026-11-22T02:00:00Z',type:'receipt',quantity:5,ref:'TEST-ARRIVAL',note:'测试合格入库'},wh);
  assert.equal(stockView(s,cs).specialCases[0].summary.stockReady,true);
  assert.equal(specialSummary(s.specialCases[0]).replaced,0);
  s=act(s,'replacement',{warehouse:'主仓',quantity:2,at:'2026-11-22T03:00:00Z'});
  assert.equal(balance(s,'sku1','主仓').good,3);
  assert.equal(stockView(s,cs).specialCases[0].summary.stockReady,false);
  s=act(s,'return_hold',{warehouse:'主仓',quantity:2,ref:'TEST-QC',at:'2026-11-22T04:00:00Z'});
  assert.equal(balance(s,'sku1','主仓').hold,2);
  assert.equal(specialSummary(s.specialCases[0]).held,0);
  assert.equal(specialSummary(s.specialCases[0]).ready,true);
  assert.throws(()=>act(s,'return_good',{warehouse:'主仓',quantity:1,ref:'TEST-DOUBLE',at:'2026-11-22T05:00:00Z'}),/已收到/);
  assert.equal(s.monthly.length,0);
});

test('reship is idempotent and rejects unknown stock, excess quantity, and retroactive identity edits',()=>{
  const p={...plan,type:'reship',returnQty:0,replacementQty:2,replacementSkuId:'sku1'};
  let s=run(setup(),'specialCase',p,cs);
  const data={...action,caseId:s.specialCases[0].id,stage:'replacement',warehouse:'主仓',quantity:2};
  const cmd=command(s,'specialAction',data);
  s=transact(s,cmd,wh,{now}).state;
  assert.equal(transact(s,cmd,wh,{now}).replayed,true);
  assert.equal(balance(s,'sku1','主仓').good,8);
  assert.throws(()=>act(s,'replacement',{ref:'OTHER',warehouse:'主仓'}),/超过/);
  assert.throws(()=>run(s,'specialPlan',{...p,caseId:s.specialCases[0].id,order:'DIFFERENT',note:'更换原单'},cs),/不能更换/);
  let noBase=run(setup(),'specialCase',{...p,reference:'NO-BASE'},cs);noBase.snapshots=[];
  assert.throws(()=>act(noBase,'replacement',{warehouse:'主仓'}),/实盘基准/);
});

test('ordinary and special cases share a duplicate guard in both directions',()=>{
  let s=run(setup(),'specialCase',plan,cs);
  assert.throws(()=>run(s,'case',plan,cs),/已登记/);
  s=run(setup(),'case',plan,cs);
  assert.throws(()=>run(s,'specialCase',plan,cs),/已有记录/);
});

test('invalid or out-of-order handling leaves no partial stock or case changes',()=>{
  let s=run(setup(),'specialCase',plan,cs);s=act(s,'receive');
  const original=structuredClone(s);
  for(const p of [{quantity:0},{quantity:3},{at:'2026-11-23T01:00:00Z'},{at:'2026-11-21T01:00:00Z'},{location:'另一个位置',ref:'NEW'}])assert.throws(()=>act(s,'receive',p));
  assert.throws(()=>run(s,'specialPlan',{...plan,returnQty:0,caseId:s.specialCases[0].id,note:'修改'},cs));
  assert.deepEqual(s,original);
});

test('four staff roles are retained, service cannot move stock, warehouse cannot close, PR/content cannot read special cases or costs',async()=>{
  for(const role of ['customer_service','warehouse','pr','content']){
    const access=await initialAccess([{username:'admin',role:'admin',password:'TestOnlyRoles123'},{username:`test_${role}`,name:role,password:'TestOnlyRoles123',stockRole:role}]);
    assert.equal(publicUser(access.users[1]).stockRole,role);
  }
  let s=run(setup(),'specialCase',plan,cs);
  assert.throws(()=>run(s,'specialAction',{...action,caseId:s.specialCases[0].id,stage:'receive'},cs),/权限/);
  assert.throws(()=>run(s,'specialClose',{caseId:s.specialCases[0].id,note:'done'},wh),/权限/);
  assert.throws(()=>run(setup(),'specialCase',plan,wh),/客服登记/);
  for(const stockRole of ['pr','content','viewer','marketing']){
    const u={id:stockRole,role:'employee',stockRole};
    assert.throws(()=>run(s,'specialCase',plan,u),/权限/);
    assert.throws(()=>run(s,'event',{},u),/权限/);
    assert.deepEqual(stockView(s,u).specialCases,[]);
    assert.ok(!JSON.stringify(stockView(s,u)).includes('TEST-ORDER'));
  }
  assert.equal(stockView(s,cs).specialCases.length,1);
  const old=setup();delete old.specialCases;
  assert.deepEqual(stockView(old,wh).specialCases,[]);
});
