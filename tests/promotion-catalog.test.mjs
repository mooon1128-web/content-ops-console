import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import PD from '../public/content-ops/promotion-data.cjs';
import {createCatalogReader} from '../content-ops/wholesale-catalog.js';
import {createXhsStore} from '../content-ops/xhs-store.js';
import {promotionView} from '../content-ops/promotion-view.js';
const base=[{id:'wholesale-qp-43',sku:'QP-043',name:'挎包系列-吐司包',sourceCategory:'箱包',unitCost:30,costConnected:true},{id:'wholesale-phone',sku:'PHONE',name:'手机链-猴子',sourceCategory:'饰品',unitCost:10,costConnected:true}];
const row=(id,product,status='等待发布')=>({id,product,status,createdAt:'2026-11-28',sampleQuantity:1,fee:50,extraCost:0});
test('only contact and awaiting-shipment stages are excluded; later unposted stages share one waiting label',()=>{
 for(const status of ['待建联','待寄样'])assert.equal(PD.publicationStage({status}),'');
 for(const status of ['已寄样','寄样中','已签收','脚本已确认','等待发布','待发布'])assert.equal(PD.publicationStage({status}),'待发布');
 assert.equal(PD.publicationStage({status:'已发布'}),'已发布');
});
test('ordering catalog failures retain full names and never publish the partial base catalog',async()=>{
 let time=0,broken=false,calls=0,persisted;const read=createCatalogReader({now:()=>time,load:async()=>{calls++;return broken?{rows:[],data:{connected:false}}:{rows:base,data:{connected:true}}},persist:async x=>{persisted=x;}});
 const first=await read();broken=true;time=61000;const failed=await read();assert.equal(failed.stale,true);assert.deepEqual(failed.rows,base);assert.equal(failed.syncedAt,first.syncedAt);assert.match(failed.error,/上次完整目录/);assert.equal(calls,2);
 const restored=createCatalogReader({restore:async()=>persisted,load:async()=>{throw Error('offline');}});assert.deepEqual((await restored()).rows,base);
 await assert.rejects(createCatalogReader({load:async()=>({rows:base,data:{connected:false}})})(),/完整目录/);
});
test('shared catalog includes extras and uses owner-confirmed family names without inventing variants or costs',()=>{
 const rows=[row('a','吐司包 mini挂件 拖鞋'),row('b','法棍包'),row('c','烘培系列 新品 任选5')];const before=structuredClone(rows),catalog=PD.extendCatalog(base,{},rows);
 assert.ok(catalog.length>=base.length);assert.equal(PD.findProduct('吐司包',catalog).name,base[0].name);
 const resolved=PD.resolvePlacement(rows[0],catalog);assert.equal(resolved.products.length,3);assert.deepEqual(resolved.unresolved,[]);assert.equal(PD.costs(rows[0],resolved).sample,null);
 const baguette=PD.findProduct('法棍包',catalog);assert.equal(baguette.name,'法棍痛包（颜色待补）');assert.ok(PD.productCategories(baguette).includes('箱包'));
 assert.equal(PD.findProduct('烘培系列 新品 任选5',catalog).name,'烘焙系列新品任选5');assert.deepEqual(rows,before);
});
test('catalog rename preserves authoritative linked IDs without adding a second provisional SKU',()=>{
 const old={...row('old','原吐司名称'),productIds:['wholesale-qp-43'],productCodes:['QP-043']};const catalog=PD.extendCatalog(base,{},[old]);const resolved=PD.resolvePlacement(old,catalog);
 assert.deepEqual(resolved.products.map(p=>p.id),['wholesale-qp-43']);assert.deepEqual(resolved.legacyLabels,['原吐司名称']);assert.equal(PD.costs(old,resolved).sample,30);
});
test('confirmed bundle sums ordering costs and inherits every component category; unknown costs stay unknown',()=>{
 const id=PD.promoId('红格礼盒');const saved={[id]:{id,name:'烘焙礼盒双件组',aliases:['红格礼盒'],kind:'bundle',components:[{productId:base[0].id,quantity:1},{productId:base[1].id,quantity:2}],compositionConfirmed:true}};
 const catalog=PD.extendCatalog(base,saved,[]),bundle=PD.findProduct('红格礼盒',catalog);assert.equal(bundle.unitCost,50);assert.deepEqual(new Set(bundle.categories),new Set(['箱包','饰品']));
 const lost=PD.extendCatalog([{...base[0],costConnected:false},base[1]],saved,[]);assert.equal(PD.findProduct(id,lost).unitCost,null);
 const history={...row('history','红格礼盒'),productCostConnected:true,productCostSnapshot:21};assert.equal(PD.costs(history,PD.resolvePlacement(history,catalog)).sample,21);
});
test('ranking deduplicates record IDs and canonical aliases; bag filter finds cross-category bundles',()=>{
 const id=PD.promoId('套餐');const saved={[id]:{id,name:'吐司手机链套餐',aliases:['套餐'],kind:'bundle',components:[{productId:base[0].id,quantity:1},{productId:base[1].id,quantity:1}],compositionConfirmed:true}};
 const rows=[row('1','吐司包、挎包系列-吐司包'),row('2','套餐','已发布'),row('3','吐司包','待建联'),row('4','手机链-猴子','已发布')];rows.push(rows[0]);const catalog=PD.extendCatalog(base,saved,rows);
 const ranking=PD.rankedProducts(rows,catalog,{category:'箱包'});assert.equal(ranking.length,2);assert.equal(ranking.reduce((n,g)=>n+g.count,0),2);assert.ok(ranking.some(g=>g.recordIds.includes('2')));
 const search=PD.rankedProducts(rows,catalog,{search:'吐司',stage:'待发布'});assert.equal(search.length,1);assert.equal(search[0].count,1);
 const view=promotionView({placements:rows.slice(0,4),promotionSkus:saved},{products:base,catalogConnected:true},{role:'admin'});assert.deepEqual(view.placements.map(p=>p.id),['1','2','4']);assert.equal(PD.totals(view.placements).fee,150);
});
test('extra SKU edits persist across sessions and old-client placement changes preserve the registry',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'promo-catalog-test-'));try{
 const file=join(dir,'state.json'),original={creators:[],placements:[row('p','吐司包')],customCreatorTypes:[],monthlyBudgets:{},updatedAt:'2026-11-01T00:00:00.000Z'};await writeFile(file,JSON.stringify(original));
 const store=createXhsStore({file}),user={id:'u',name:'PR'};
 const sku={id:'promo-custom-test',name:'测试套餐',aliases:['旧套餐'],kind:'bundle',category:'',components:[{productId:base[0].id,quantity:2}],compositionConfirmed:true};
 await store.commit({requestId:'sku1',operations:[{group:'promotionSkus',kind:'map',key:sku.id,before:{exists:false},after:{exists:true,value:sku}}]},user);
 await store.commit({requestId:'old-client',operations:[{group:'placements',kind:'field',id:'p',key:'status',before:{exists:true,value:'等待发布'},after:{exists:true,value:'已发布'}}]},user);
 const reloaded=await createXhsStore({file}).read();assert.deepEqual(reloaded.promotionSkus[sku.id],sku);assert.equal(reloaded.placements.length,1);assert.equal(reloaded.placements[0].status,'已发布');
 await assert.rejects(store.commit({requestId:'invalid',operations:[{group:'promotionSkus',kind:'map',key:'promo-bad',before:{exists:false},after:{exists:true,value:{...sku,id:'promo-bad',components:[]}}}]},user),/补齐组成/);
 assert.equal((await store.read()).promotionSkus['promo-bad'],undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
