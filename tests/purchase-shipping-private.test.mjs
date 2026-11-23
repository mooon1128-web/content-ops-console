import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {emptyStock,transact,stockView} from '../content-ops/stock-model.js';
import {shippingSummary,forecastSupply} from '../public/stock-ops/purchasing-math.js';
import {createPurchaseFiles} from '../content-ops/purchase-files.js';
const admin={id:'admin',role:'admin',name:'Synthetic admin'};
const employee=stockRole=>({id:stockRole,role:'employee',stockRole,name:stockRole});
const now='2026-11-23T02:00:00.000Z';
const run=(s,action,data,user=admin)=>transact(s,{action,data,revision:s.revision,requestId:randomUUID()},user,{now}).state;
const seed=()=>run(emptyStock(),'sku',{id:'sku',code:'TEST',name:'Synthetic product',warehouse:'主仓'});
const po={skuId:'sku',reference:'PO-TEST',quantity:500,status:'已下单',orderDate:'2026-10-01',expectedShipAt:'2026-11-20',warehouse:'主仓',note:'Synthetic order'};
const shipment={reference:'SHIP-TEST',at:'2026-11-22',quantity:200,note:'Synthetic shipment'};
test('shipping overdue starts the next calendar day and crosses month/year/leap boundaries',()=>{
 const o={id:'p',quantity:500,expectedShipAt:'2026-11-20'};
 assert.equal(shippingSummary(o,[],'2026-11-19').overdueDays,0);
 assert.equal(shippingSummary(o,[],'2026-11-20').overdueDays,0);
 assert.equal(shippingSummary(o,[],'2026-11-23').overdueDays,3);
 assert.equal(shippingSummary({...o,expectedShipAt:'2026-12-31'},[],'2027-01-02').overdueDays,2);
 assert.equal(shippingSummary({...o,expectedShipAt:'2028-02-28'},[],'2028-03-01').overdueDays,2);
});
test('actual full shipment freezes lateness; partial shipment keeps remaining quantity overdue without inventory changes',()=>{
 let s=run(seed(),'purchase',po),id=s.purchases[0].id;
 s=run(s,'purchaseShip',{...shipment,purchaseId:id},employee('warehouse'));
 let info=shippingSummary(s.purchases[0],[],'2026-11-23');assert.equal(info.outstanding,300);assert.equal(info.overdueDays,3);
 s=run(s,'purchaseShip',{...shipment,reference:'SHIP-2',quantity:300,purchaseId:id},employee('operations'));
 info=shippingSummary(s.purchases[0],[],'2026-12-10');assert.equal(info.overdueDays,0);assert.equal(info.lateDays,2);assert.equal(info.completedAt,'2026-11-22');assert.equal(s.events.length,0);
 assert.throws(()=>run(s,'purchaseShip',{...shipment,reference:'SHIP-3',quantity:1,purchaseId:id}),/不能超过/);
 assert.throws(()=>run(s,'purchaseShip',{...shipment,purchaseId:id}),/已经登记/);
});
test('legacy arrival dates keep their meaning; receipt proves departure but never fabricates a shipping date',()=>{
 const o={id:'p',quantity:500,expectedAt:'2026-11-01'};
 assert.equal(shippingSummary(o,[],'2026-11-23').expected,null);assert.equal(shippingSummary(o,[],'2026-11-23').overdueDays,0);
 const receipts=[{purchaseId:'p',at:'2026-11-22T16:00:00Z',good:460,defect:40,pending:0}];
 assert.equal(shippingSummary({...o,expectedShipAt:'2026-11-20'},receipts,'2026-11-22').overdueDays,2);
 const info=shippingSummary({...o,expectedShipAt:'2026-11-20'},receipts,'2026-11-23');assert.equal(info.complete,true);assert.equal(info.completedAt,null);assert.equal(info.overdueDays,0);
});
test('schedule changes retain history and unknown arrival dates cannot become forecast arrivals',()=>{
 let s=run(seed(),'purchase',po),id=s.purchases[0].id;assert.equal(s.purchases[0].expectedAt,null);
 s=run(s,'purchaseSchedule',{purchaseId:id,expectedShipAt:'2026-11-25',expectedAt:'2026-11-28',note:'Confirmed by factory'});
 assert.equal(s.purchases[0].scheduleHistory[0].previous.expectedShipAt,'2026-11-20');
 assert.throws(()=>run(s,'purchaseSchedule',{purchaseId:id,expectedShipAt:'2026-11-25',expectedAt:'2026-11-24',note:'Invalid'}),/不能早于/);
 const i={asOf:'2026-11-23',orderDate:'2026-11-23',target:'2027-02-28',available:10,daily:2,leadDays:40,transportDays:3,pauseDays:0,bufferDays:0,safetyDays:0,moq:500,packSize:1,otherDemand:0,inTransit:[{at:null,quantity:500}]};
 assert.throws(()=>forecastSupply(i),/出货时间不能代替到货日/);
});
test('shipment requires placed order, real date, positive quantity and authorized actor',()=>{
 let s=run(seed(),'purchase',{...po,status:'计划'}),id=s.purchases[0].id;
 assert.throws(()=>run(s,'purchaseShip',{...shipment,purchaseId:id}),/先确认/);
 s=run(s,'purchaseConfirm',{purchaseId:id,note:'Order confirmed'});
 for(const at of ['2026-09-30','2026-11-24'])assert.throws(()=>run(s,'purchaseShip',{...shipment,purchaseId:id,at}),/实际出货时间/);
 assert.throws(()=>run(s,'purchaseShip',{...shipment,purchaseId:id,quantity:0}),/大于0/);
 assert.throws(()=>run(s,'purchaseShip',{...shipment,purchaseId:id},employee('pr')),/权限/);
});
const file={id:'fedcba00-0000-4000-8000-000000000000',name:'Private contract.png',mime:'image/png',bytes:100};
test('all employee views, exported snapshots and audit records exclude private money and contract metadata',()=>{
 let s=run(seed(),'purchase',{...po,privateDetails:{balanceDue:12345.67,contracts:[file]}}),id=s.purchases[0].id;
 s=run(s,'purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:23456.78,contracts:[]}});
 assert.equal(stockView(s,admin).purchasePrivate[id].contracts.length,1);
 assert.equal(stockView(s,admin).purchasePrivate[id].history[0].balanceDue,12345.67);
 for(const role of ['pr','pr_service','warehouse','customer_service','content','operations','viewer','marketing']){
  const v=stockView(s,employee(role));assert.equal(v.purchasePrivate,undefined);
  const json=JSON.stringify(v);for(const secret of ['12345.67','23456.78',file.id,file.name,'balanceDue','privateDetails'])assert.equal(json.includes(secret),false,role+' leaked '+secret);
  assert.throws(()=>run(s,'purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:9}},employee(role)),/权限/);
 }
 assert.throws(()=>run(seed(),'purchase',{...po,privateDetails:{balanceDue:3}},employee('operations')),/仅管理员/);
});
test('unentered money stays null, zero is explicit, old contracts survive further updates',()=>{
 let s=run(seed(),'purchase',{...po,privateDetails:{balanceDue:'',contracts:[]}}),id=s.purchases[0].id;
 assert.equal(s.purchasePrivate[id].balanceDue,null);
 s=run(s,'purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:0,contracts:[file]}});
 assert.equal(s.purchasePrivate[id].balanceDue,0);
 assert.throws(()=>run(s,'purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:-1}}),/有效数字/);
 assert.throws(()=>run(s,'purchasePrivate',{purchaseId:id,privateDetails:{balanceDue:1.001}}),/两位小数/);
});
// Synthetic 1x1 PNG, no real contract or production records.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aVmQAAAAASUVORK5CYII=','base64');
test('contract file endpoints enforce administrator access, content types, and a saved batch association',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'purchase-private-test-'));let state={purchasePrivate:{}};
 const files=createPurchaseFiles({dir,readState:async()=>state});
 const req=(method,data=png)=>Object.assign(Readable.from([data]),{method,headers:{}});
 const response={writeHead(status,headers){this.status=status;this.headers=headers},end(data){this.data=data}};
 let meta;const send=(r,status,data)=>{meta=data;};
 for(const role of ['warehouse','pr_service','content','operations','viewer']){
  for(const method of ['GET','POST'])await assert.rejects(()=>files.handle(req(method),response,new URL('http://local/?id='+file.id),employee(role),send),e=>e.status===403);
 }
 await assert.rejects(()=>files.handle(req('POST',Buffer.from('<svg>bad</svg>')),response,new URL('http://local/'),admin,send),e=>e.status===415);
 await files.handle(req('POST'),response,new URL('http://local/?name=Test.png'),admin,send);
 assert.equal(meta.mime,'image/png');await files.validate(admin,[meta]);
 await assert.rejects(()=>files.validate(employee('warehouse'),[meta]),e=>e.status===403);
 const url=new URL('http://local/?id='+meta.id);
 await assert.rejects(()=>files.handle(req('GET'),response,url,admin,send),e=>e.status===404);
 state.purchasePrivate.p={contracts:[meta]};await files.handle(req('GET'),response,url,admin,send);
 assert.equal(response.status,200);assert.match(response.headers['Cache-Control'],/no-store/);assert.deepEqual(response.data,png);
 assert.deepEqual(await readFile(join(dir,meta.id)),png);
 await assert.rejects(()=>files.validate(admin,[{...meta,bytes:meta.bytes+1}]),/不一致/);
});
