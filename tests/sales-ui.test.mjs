import test from 'node:test';
import assert from 'node:assert/strict';
import {groupSales,salesValue,monthOf,sampleMonthData,productImage} from '../public/stock-ops/sales-ui.js';

test('same SKU and month occupies one row; platforms and months remain distinct',()=>{
  const rows=[{skuId:'fish',month:'2026-11',channel:'淘宝',paid:101,refund:8,net:93},{skuId:'fish',month:'2026-11',channel:'小红书',paid:62,refund:11,net:51},{skuId:'fish',month:'2026-10',channel:'淘宝',net:5},{skuId:'other',month:'2026-11',channel:'淘宝',net:2}];
  const snapshot=JSON.stringify(rows),result=groupSales(rows);
  assert.equal(result.length,3);const fish=result.find(r=>r.skuId==='fish'&&r.month==='2026-11');
  assert.equal(salesValue(fish.channels['淘宝'],'net'),93);assert.equal(salesValue(fish.channels['小红书'],'net'),51);assert.equal(JSON.stringify(rows),snapshot);
});
test('unknown and duplicate records are never added as zero or double counted',()=>{
  assert.equal(salesValue(undefined,'net'),null);
  assert.equal(salesValue([{net:null}],'net'),null);
  assert.equal(salesValue([{net:0}],'net'),0);
  assert.equal(salesValue([{net:5},{net:5}],'net'),null);
  assert.equal(salesValue([{payAmount:100,refundAmount:null}],'netAmount'),null);
  assert.equal(salesValue([{payAmount:100,refundAmount:15.5}],'netAmount'),84.5);
});
test('month boundaries use China time, not the UTC month or delivery date',()=>{
  assert.equal(monthOf('2026-10-31T16:00:00.000Z'),'2026-11');assert.equal(monthOf('2026-10-31'),'2026-10');assert.equal(monthOf(''),'');
  const p=[{id:'a',createdAt:'2026-10-15',sampleDeliveredAt:'2026-11-02'},{id:'b',createdAt:'2026-11-01'},{id:'c',sampleDeliveredAt:'2026-11-02'}];
  const e=[{id:'e',type:'sample',at:'2026-10-31T16:00:00Z',quantity:3,source:{placementId:'a'}},{id:'old',type:'sample',at:'2026-10-20',quantity:7,source:{placementId:'a'}},{id:'r',type:'sale',at:'2026-11-03',quantity:99}];
  const data=sampleMonthData(p,e,'2026-11');assert.deepEqual(data.rows.map(x=>x.id),['b']);assert.equal(data.shippedQuantity,3);assert.equal(data.booked.get('a'),3);assert.equal(data.unknownCount,1);
  assert.deepEqual(sampleMonthData(p,e,'2026-11','shipped').rows.map(x=>x.id),['a']);assert.deepEqual(sampleMonthData(p,e,'2026-11','undated').rows.map(x=>x.id),['c']);
});
test('verified five products receive different wholesale images; no fuzzy assignment',()=>{
  const keys=['PUPU-TAIYAKI','PUPU-TOAST-BAG','PUPU-DONUT-BAG','PUPU-PENCIL','PUPU-SANFEN-COIN'];
  const images=keys.map(code=>productImage({code}));assert.equal(new Set(images).size,5);assert.ok(images.every(x=>x.startsWith('https://pupuhome-wholesale.onrender.com/assets/products/')));
  assert.equal(productImage({name:'不存在的测试商品'}),'');
});

import {monthlyReadModel,monthlyGroups} from '../public/stock-ops/sales-ui.js';
const viewFixture=()=>({skus:[{id:'A'},{id:'B'},{id:'C'}],monthly:[{id:'old',skuId:'A',month:'2026-11',channel:'淘宝',paid:9,refund:1,net:8,through:'2026-11-20',updatedAt:'2026-11-22T01:00:00Z'}],collections:[{id:'j',calculation:{computedAt:'2026-11-22T02:00:00Z',complete:false,coverage:[{channel:'淘宝',start:'2026-11-01',end:'2026-11-21'}],contributions:[{skuId:'A',month:'2026-11',channel:'淘宝'},{skuId:'B',month:'2026-11',channel:'淘宝'}],rowIssues:[{skuId:'B',month:'2026-11',channel:'淘宝',detail:'扣件数待核'}],exclusions:[{name:'测试排除商品'}]},results:['A','B','C'].map(skuId=>({skuId,month:'2026-11',channel:'淘宝',paid:skuId==='C'?0:10,refund:1,net:skuId==='C'?0:9,through:'2026-11-22'}))}]});
test('observed collected products show in monthly without fabricating zeros or adding original counts twice',()=>{
 const s=viewFixture(),snapshot=JSON.stringify(s),r=monthlyReadModel(s);
 assert.equal(r.length,2);assert.equal(r[0].paid,10);assert.equal(r[0].through,'2026-11-21');assert.equal(r[0].originalRows[0].net,8);
 assert.equal(r.find(x=>x.skuId==='B').refund,null);assert.equal(r.find(x=>x.skuId==='B').net,null);assert.equal(r.find(x=>x.skuId==='B').knownRefund,1);
 assert.equal(salesValue(groupSales(r)[0].channels['小红书'],'paid'),null);
 assert.equal(JSON.stringify(s),snapshot);assert.equal(monthlyGroups(s,r,'2026-11',true).length,3);
 assert.deepEqual(monthlyGroups(s,r,'2026-11',true).find(g=>g.skuId==='C').channels,{});
});
test('later manual edits, later periods and duplicate original records survive the read model',()=>{
 for(const change of [{updatedAt:'2026-11-22T03:00:00Z'},{through:'2026-11-23'}]){
  const s=viewFixture();Object.assign(s.monthly[0],change);assert.equal(monthlyReadModel(s).find(x=>x.skuId==='A').paid,9);
 }
 const s=viewFixture();s.monthly.push({...s.monthly[0],id:'duplicate'});assert.equal(monthlyReadModel(s).filter(x=>x.skuId==='A').length,2);
});
test('newest calculation wins once, old incomplete snapshots without coverage remain hidden',()=>{
 const s=viewFixture(),newer=structuredClone(s.collections[0]);newer.id='newer';newer.calculation.computedAt='2026-11-22T04:00:00Z';newer.results[0].paid=14;s.collections.push(newer);
 assert.equal(monthlyReadModel(s).find(x=>x.skuId==='A').paid,14);assert.equal(monthlyReadModel(s).length,2);
 delete s.collections[1].calculation.computedAt;delete s.collections[0].calculation.computedAt;assert.deepEqual(monthlyReadModel(s),s.monthly);
});
