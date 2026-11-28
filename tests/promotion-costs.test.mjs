import test from 'node:test';
import assert from 'node:assert/strict';
import PD from '../public/content-ops/promotion-data.cjs';
import {promotionView} from '../content-ops/promotion-view.js';
import {createXhsStore} from '../content-ops/xhs-store.js';
import {renderPromotions,showPromotion} from '../public/stock-ops/promotion-ui.js';
const products=[{id:'wholesale-a',sku:'A',name:'产品系列-新名字',unitCost:20,costConnected:true},{id:'wholesale-b',sku:'B',name:'产品系列-第二款',unitCost:0,costConnected:true},{id:'wholesale-c',sku:'C',name:'产品系列-第三款',costConnected:false}];
const raw={id:'p',creator:'测试博主',productIds:['wholesale-a','wholesale-b'],productCodes:['A','B'],product:'旧名字、第二款',sampleQuantity:2,fee:100,extraCost:10,createdAt:'2026-11-28'};
test('owner-confirmed aliases resolve to ordering SKUs while mixed or unspecified bundles remain pending',()=>{
 const catalog=[{id:'pink',sku:'NEW-349559',name:'法棍包系列-蜜桃粉',unitCost:100.93,costConnected:true},{id:'bag',sku:'BG0008',name:'挎包系列-法棍手提包（可斜挎）',unitCost:20,costConnected:true}];
 for(const name of ['粉色法棍痛','法棍粉牛仔','法棍牛仔粉'])assert.equal(PD.findProduct(name,catalog).id,'pink');
 assert.equal(PD.findProduct('吱吱叫包',catalog).id,'bag');
 const row={product:'法棍粉牛仔 mini挂件自选3 吱吱叫包',sampleQuantity:1,fee:0,extraCost:0},r=PD.resolvePlacement(row,catalog);
 assert.deepEqual(r.products.map(p=>p.id),['pink','bag']);assert.equal(r.unresolved.length,1);assert.match(r.unresolved[0],/mini手机链.*待核/);assert.equal(PD.costs(row,r).sample,null);assert.equal(r.original,row.product);
 const unknown=PD.resolvePlacement({product:'拖鞋、红格礼盒'},catalog);assert.equal(unknown.products.length,0);assert.match(unknown.unresolved[0],/新品.*待建档/);assert.match(unknown.unresolved[1],/烘焙礼盒.*具体组合待核/);
 assert.equal(PD.resolvePlacement({product:'法棍粉牛仔/吱吱叫包'},catalog).products.length,2);
});
test('canonical product IDs survive renames; source rows remain unchanged; duplicate labels do not duplicate cost',()=>{
 const before=structuredClone(raw),r=PD.resolvePlacement(raw,products);
 assert.deepEqual(r.products.map(p=>p.name),['产品系列-新名字','产品系列-第二款']);assert.deepEqual(r.unresolved,[]);assert.deepEqual(r.legacyLabels,['旧名字']);assert.deepEqual(raw,before);
 const duplicate=PD.resolvePlacement({...raw,product:'产品系列-新名字、A、第二款'},products);assert.equal(duplicate.products.length,2);assert.equal(PD.costs(raw,duplicate).total,150);
});
test('unknown or ambiguous product text is retained; vague bundles never obtain a fabricated cost',()=>{
 const catalog=[...products,{id:'d',sku:'D',name:'其他系列-第二款',unitCost:30,costConnected:true}];
 assert.equal(PD.findProduct('第二款',catalog),null);assert.equal(PD.findProduct('新',catalog),null);
 const r=PD.resolvePlacement({product:'产品系列-新名字、挂件自选3个'},products);
 assert.deepEqual(r.unresolved,['挂件自选3个']);const c=PD.costs(raw,r);assert.equal(c.sample,null);assert.equal(c.total,null);assert.equal(c.knownTotal,110);
 const conflict=PD.resolvePlacement({productIds:['wholesale-a'],productCodes:['B']},products);assert.equal(conflict.products.length,0);assert.match(conflict.unresolved[0],/不一致/);
});
test('historical cost is preserved while current ordering cost is separately available; blank and zero are distinct',()=>{
 const r=PD.resolvePlacement(raw,products),old=PD.costs({...raw,productCostConnected:true,productCostSnapshot:30,productCostSource:'订货历史'},r);
 assert.equal(old.sample,30);assert.equal(old.currentEstimate,40);assert.equal(old.total,140);assert.equal(old.basis,'snapshot');
 assert.equal(PD.costs({...raw,sampleQuantity:''},r).sample,null);
 assert.equal(PD.costs({...raw,fee:''},r).total,null);
 assert.equal(PD.costs({...raw,productCostConnected:true,productCostSnapshot:0},r).sample,0);
 assert.equal(PD.costs({...raw,sampleStatus:'无需寄样'},r).sample,0);
});
test('multiple products share one cooperation fee; partial totals are marked and are never presented as complete',()=>{
 const view=promotionView({placements:[raw,{...raw,id:'p2',product:'产品系列-第三款',productIds:['wholesale-c'],productCodes:['C']}]},{products,catalogConnected:true},{role:'admin'});
 const totals=PD.totals(view.placements);assert.equal(totals.fee,200);assert.equal(totals.extra,20);assert.equal(totals.sample,40);assert.equal(totals.knownTotal,260);assert.equal(totals.pending,1);
});
test('costs and metrics are projected only for admin or finance; raw hidden fields never escape',()=>{
 const source={placements:[{...raw,notes:'合作备注',contact:'PRIVATE CONTACT',productCostSnapshot:123456,productCostConnected:true,gmv:987654,secret:'secret'}],updatedAt:'v1'};
 for(const user of [{role:'admin'},{role:'employee',stockRole:'finance'}]){const v=promotionView(source,{products},user);assert.equal(v.placements[0].expense.sample,123456);assert.equal(v.placements[0].metrics.gmv,987654);assert.doesNotMatch(JSON.stringify(v),/PRIVATE CONTACT|secret/);}
 for(const stockRole of ['pr','warehouse','viewer','content']){const v=promotionView(source,{products},{role:'employee',stockRole});assert.equal(v.privateCosts,false);assert.equal(v.placements[0].expense,undefined);assert.doesNotMatch(JSON.stringify(v),/123456|987654|unitCost|costSource|PRIVATE CONTACT|secret/);}
});
test('all-month and undated views include legacy rows; actual shipments use unreversed warehouse events only',()=>{
 const rows=promotionView({placements:[raw,{...raw,id:'legacy',createdAt:''}]},{products},{role:'admin'}).placements;
 const events=[{id:'e1',type:'sample',at:'2026-11-01',quantity:5,source:{placementId:'p'}},{id:'reverse',reverses:'e1'},{id:'e2',type:'sample',at:'2026-10-31T16:00:00Z',quantity:2,source:{placementId:'legacy'}}];
 assert.equal(PD.filterRows(rows,events,{month:'',mode:'registered'}).rows.length,2);
 assert.deepEqual(PD.filterRows(rows,events,{month:'2026-11',mode:'undated'}).rows.map(r=>r.id),['legacy']);
 const shipped=PD.filterRows(rows,events,{month:'2026-11',mode:'shipped'});assert.deepEqual(shipped.rows.map(r=>r.id),['legacy']);assert.equal(shipped.booked.get('legacy'),2);
});
test('promotion read uses latest server placements without exposing or loading creator/contact records',async()=>{
 let query;const store=createXhsStore({remote:async url=>{query=url;return [{placements:[raw],updated_at:'2026-11-28T01:00:00Z'}]},stateId:'test'});
 const state=await store.placements();assert.equal(state.placements[0].id,'p');assert.equal(state.updatedAt,'2026-11-28T01:00:00.000Z');assert.match(query,/select=placements:state->placements,updated_at/);assert.equal(state.creators,undefined);
});
test('promotion screen retains pending rows, shows unique totals, filters and opens full detail without write controls',()=>{
 const original=globalThis.PromotionData;globalThis.PromotionData=PD;
 try{
  const data=promotionView({placements:[raw,{...raw,id:'pending',productIds:[],productCodes:[],product:'自选挂件3个'}],updatedAt:'2026-11-28T01:00:00Z'},{products,catalogConnected:true},{role:'admin'});
  const nodes=new Map(),bindings=new Map();let editor,rendered=0;
  const a={data,filters:{month:'2026-11',mode:'registered',status:'all'},state:{events:[]},$:s=>{if(!nodes.has(s))nodes.set(s,{addEventListener:(event,fn)=>{nodes.get(s)[event]=fn;}});return nodes.get(s);},heading:t=>t,button:(id,label)=>`<button id="${id}">${label}</button>`,table:(heads,rows)=>rows.flat().join('|'),bind:(id,fn)=>bindings.set(id,fn),bindAll:(s,fn)=>bindings.set(s,fn),can:()=>true,render:()=>rendered++,showEditor:(title,html)=>editor={title,html},editSample:()=>{},load:()=>{}};
  renderPromotions(a);let html=a.$('#content').innerHTML;assert.match(html,/推广花销/);assert.match(html,/自选挂件3个/);assert.match(html,/已知部分/);assert.match(html,/¥260.00/);assert.match(html,/每条合作费用只计一次/);
  bindings.get('promotion-all')();assert.equal(a.filters.month,'');assert.equal(rendered,1);
  showPromotion(a,data.placements[0]);assert.match(editor.html,/旧名字/);assert.match(editor.html,/产品系列-新名字/);assert.match(editor.html,/合作信息/);assert.match(editor.html,/placement=p/);assert.equal(a.$('#save-editor').hidden,true);a.$('#editor').close();assert.equal(a.$('#save-editor').hidden,false);
  a.data=promotionView({placements:[raw]},{products},{role:'employee',stockRole:'warehouse'});a.can=r=>r==='warehouse';renderPromotions(a);html=a.$('#content').innerHTML;assert.doesNotMatch(html,/¥|其他履约费|合作费/);assert.match(html,/确认寄出/);
 }finally{globalThis.PromotionData=original;}
});
