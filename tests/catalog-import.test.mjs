import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {emptyStock,transact,balance} from '../content-ops/stock-model.js';
const now='2026-11-22T08:00:00.000Z',admin={id:'a',name:'管理员',role:'admin'},warehouse={id:'w',role:'employee',stockRole:'warehouse'};
const commit=(s,action,data,user=admin)=>transact(s,{action,data,revision:s.revision,requestId:randomUUID()},user,{now});
const original=()=>({...emptyStock(),skus:[{id:'old',code:'OLD',name:'保留名称',status:'在售',warehouse:'主仓',moq:0,leadDays:40,barcode:'original',costSkuId:'C-OLD',costLinkStatus:'原依据'}],monthly:[{id:'month',paid:3,refund:null}],observations:[{id:'obs',skuId:'old',available:17}],costWorkbook:{sheets:[{name:'原始成本',rows:[{values:['C-OLD',null]}]}]}});
const payload=()=>({id:'test-batch',title:'测试ERP导入',catalogAsOf:'2026-11-22T01:00:00Z',sources:[{name:'erp.xlsx',sha256:'a'.repeat(64)}],
 skus:[{id:'old',code:'OLD',name:'ERP名称',barcode:'different',moq:500,erpSkuId:'1234567890123456789',erpSpec:'规格A',erpBarcode:'erp-original'}, {id:'new',code:'NEW',name:'新增档案',erpSkuId:'2234567890123456789'}],
 inventory:[{id:'i1',skuId:'new',warehouse:'默认仓库',scope:'全量',at:'2026-11-21T08:00:00Z',book:-2,occupied:3,available:-5,warehouseBook:-2,source:'erp.xlsx'}],
 mappings:[{id:'m1',skuId:'old',platform:'淘宝',itemId:'100',platformSkuId:'200',status:'历史唯一',source:'订单核对',evidenceCount:1,evidence:[{method:'订单唯一',source:'orders.csv',order:'ORDER'}]}],
 issues:[{id:'r1',skuId:'new',title:'资料待核',detail:'成本未知；当前库存刷新待补',source:'erp.xlsx'}]});

test('catalog import fills blank identifiers without overwriting values, zero or business history',()=>{
 const before=original(),p=payload(),{state:s,result}=commit(before,'catalogImport',p);
 assert.equal(result.addedSkus,1);assert.equal(result.preservedConflicts,3);
 for(const [k,v]of Object.entries(before.skus[0]))assert.deepEqual(s.skus[0][k],v,k);
 for(const k of ['monthly','observations','events','snapshots','costWorkbook'])assert.deepEqual(s[k],before[k],k);
 assert.equal(s.skus[0].erpSkuId,'1234567890123456789');assert.equal(s.skus[1].status,'待核');
 assert.equal(s.skus[1].moq,null);assert.equal(s.erpInventory[0].available,-5);assert.equal(balance(s,'new','默认仓库'),null);
 assert.equal(before.skus.length,1);assert.equal(before.erpInventory,undefined);
});
test('batch retries never duplicate stock, mappings, reviews or SKU records',()=>{
 const p=payload(),first=commit(original(),'catalogImport',p).state,second=commit(first,'catalogImport',p);
 assert.equal(second.result.alreadyImported,true);
 for(const k of ['skus','erpInventory','platformMappings','catalogReviews','catalogImports','issues'])assert.deepEqual(second.state[k],first[k],k);
 assert.throws(()=>commit(first,'catalogImport',{...p,note:'different'}),/同一导入批次/);
});
test('duplicate identities, malformed inventory and late validation failures are atomic',()=>{
 for(const mutate of [
  p=>p.skus[1].erpSkuId=p.skus[0].erpSkuId,
  p=>p.skus[1].code='OLD',
  p=>p.inventory[0].available=4,
  p=>p.inventory.push({...p.inventory[0],id:'repeat'}),
  p=>p.issues[0].detail='',
  p=>p.catalogAsOf='2026-11-23T00:00:00Z',
 ]){const before=original(),copy=structuredClone(before),p=payload();mutate(p);assert.throws(()=>commit(before,'catalogImport',p));assert.deepEqual(before,copy);}
});
test('unknown quantities remain null and are never inferred as zero',()=>{
 const p=payload();p.inventory[0].book=null;p.inventory[0].occupied='';p.inventory[0].available=null;
 const s=commit(original(),'catalogImport',p).state;assert.equal(s.erpInventory[0].book,null);assert.equal(s.erpInventory[0].occupied,null);assert.equal(s.erpInventory[0].available,null);
});
test('a second source cannot move an existing platform mapping or stock snapshot',()=>{
 const p=payload(),s=commit(original(),'catalogImport',p).state,q=structuredClone(p);q.id='second';q.mappings[0].skuId='new';q.inventory[0].book=-1;q.inventory[0].available=-4;
 const out=commit(s,'catalogImport',q);assert.equal(out.result.preservedConflicts,5);
 assert.deepEqual(out.state.erpInventory,s.erpInventory);assert.deepEqual(out.state.platformMappings,s.platformMappings);
 assert.throws(()=>commit(s,'sku',{...s.skus[1],taobaoSkuId:'200'}),/已绑定/);
});
test('permissions and revision checks apply; manual SKU edits retain ERP source identifiers',()=>{
 const p=payload(),base=original();assert.throws(()=>commit(base,'catalogImport',p,warehouse),/权限/);
 const s=commit(base,'catalogImport',p).state;
 assert.throws(()=>transact(s,{action:'catalogImport',data:p,revision:0,requestId:randomUUID()},admin,{now}),e=>e.status===409&&e.code==='REVISION_CONFLICT');
 const updated=commit(s,'sku',{...s.skus[0],name:'管理员修改'}).state;
 assert.equal(updated.skus[0].erpSkuId,s.skus[0].erpSkuId);assert.equal(updated.skus[0].erpBarcode,'erp-original');assert.equal(updated.skus[0].name,'管理员修改');
});

const recipe=()=>({channel:'淘宝',shop:'BlueMoon研究所',itemId:'100',platformSkuId:'200',validFrom:'2026-11-01',validTo:'2026-11-22',components:[{skuId:'old',units:1}],source:'官方规格核对'});
test('bulk recipes append idempotently and preserve overlapping rules and monthly history',()=>{
 const p=payload();p.salesRecipes=[recipe()];const first=commit(original(),'catalogImport',p);assert.equal(first.result.addedRecipes,1);
 const q={...p,id:'more'};const second=commit(first.state,'catalogImport',q);assert.equal(second.result.skippedRecipes,1);assert.deepEqual(second.state.salesRecipes,first.state.salesRecipes);
 q.id='conflict';q.salesRecipes=[{...recipe(),components:[{skuId:'new',units:2}]}];const third=commit(second.state,'catalogImport',q);assert.equal(third.result.addedRecipes,0);assert.deepEqual(third.state.salesRecipes,first.state.salesRecipes);assert.deepEqual(third.state.monthly,original().monthly);assert.ok(third.state.issues.some(x=>x.detail.includes('商品组成')));
});
test('invalid bulk recipe or replacement aborts the whole catalog import',()=>{
 for(const bad of [{...recipe(),components:[{skuId:'missing',units:1}]},{...recipe(),replaces:'existing'}, {...recipe(),components:[{skuId:'old',units:0}]}]){const s=original(),copy=structuredClone(s),p=payload();p.salesRecipes=[recipe(),bad];assert.throws(()=>commit(s,'catalogImport',p));assert.deepEqual(s,copy);}
});
