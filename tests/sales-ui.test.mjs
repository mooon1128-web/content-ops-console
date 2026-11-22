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
