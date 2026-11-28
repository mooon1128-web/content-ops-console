import PromotionData from '../public/content-ops/promotion-data.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createXhsStore,xhsShape} from '../content-ops/xhs-store.js';
import RecordOps from '../public/content-ops/ops-core.cjs';
import {currentWholesaleProducts,catalogCostInfo} from '../content-ops/wholesale-catalog.js';
const app=await readFile(new URL('../public/xhs-media/app.js',import.meta.url),'utf8');
const user={id:'pr-2',name:'小杰',username:'xiaojie',role:'operator'};
function harness() {
 const nodes=new Map();
 const node=k=>{if(!nodes.has(k))nodes.set(k,{value:'',textContent:'',innerHTML:'',disabled:false,classList:{toggle(){},add(){},remove(){}},elements:{},open:true});return nodes.get(k)};
 class FD {constructor(form){this.values=form.values}entries(){return this.values[Symbol.iterator]()}getAll(key){return this.values.filter(x=>x[0]===key).map(x=>x[1])}}
 const ctx=vm.createContext({PromotionData,document:{querySelector:node,querySelectorAll:()=>[],activeElement:null},crypto:{randomUUID},console,structuredClone,FormData:FD,AbortSignal,setTimeout:()=>1,clearTimeout(){},fetch:async()=>{throw Error('not configured')}});
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+`globalThis.subject={formToPlacement,cooperationBriefData,cooperationBriefText,loadWholesaleProducts,
 setup:(rows,products,user)=>{placements=rows;productCatalog=products;currentUser=user;selectedWholesaleProductsFromForm=()=>[];hasOpenEditorDialog=()=>true;renderProductPickerOptions=()=>{};updatePlacementProductCostDisplay=()=>{}},catalog:()=>productCatalog};})();`,ctx);
 return {ctx,s:ctx.subject,node};
}
test('new placement binds logged-in account and serializes selectable brief requirements',()=>{
 const f=harness();f.s.setup([],[],user);
 const row=f.s.formToPlacement({elements:{creatorTier:{value:'素人'}},values:Object.entries({id:'',creator:'Synthetic',product:'测试款',owner:'forged',publicationFormat:'合集',coverExposure:'yes',cooperationDetails:'外观展示\n收纳过程',requiresDraftReview:'yes',agreedPublishAt:'2026-12-03',draftDeadline:'2026-12-01',changeNoticeDeadline:'2026-11-28',sampleQuantity:'1'}).concat([['conversionMethods','直接带链接'],['conversionMethods','评论回复']])});
 assert.equal(row.ownerId,user.id);assert.equal(row.owner,'小杰');assert.equal(row.likes,undefined);
 const brief=f.s.cooperationBriefData(row);assert.equal(brief.publication,'合集');assert.equal(brief.cover,'需要封面露出');assert.equal(brief.conversion,'直接带链接、评论回复');assert.equal(brief.reviewDeadline,'2026年12月1日');assert.match(brief.changeNotice,/11月28日/);assert.match(f.s.cooperationBriefText(row),/收纳过程/);
});
test('editing a legacy placement retains metrics, ownership, unknown fields and unresolved product links',()=>{
 const prior={id:'p1',creator:'Synthetic',product:'已下架旧款',owner:'旧负责人',likes:72,gmv:0,notes:'原文',productIds:['old-id'],productId:'old-id',productCostSnapshot:30,productCostConnected:true,sampleQuantity:1,customFutureField:{x:1}};
 const f=harness();f.s.setup([prior],[],user);
 const result=f.s.formToPlacement({elements:{creatorTier:{value:''}},values:Object.entries({id:'p1',creator:'Synthetic',product:'已下架旧款',owner:'小杰',publicationFormat:'单推',coverExposure:'no',sampleQuantity:'1'})});
 assert.equal(result.owner,'旧负责人');assert.equal(result.ownerId,undefined);assert.equal(result.likes,72);assert.deepEqual(result.productIds,prior.productIds);assert.equal(result.productCostSnapshot,30);assert.equal(result.customFutureField,prior.customFutureField);
 assert.equal(f.s.cooperationBriefData(prior).cooperation,'原文');assert.equal(f.s.cooperationBriefData({...result,cooperationDetails:'',notes:'私密内部备注'}).cooperation,'请确认具体内容与拍摄要求');
});
test('catalog sync reports completion or failure in the dialog and preserves good catalog on errors',async()=>{
 const f=harness();f.s.setup([],[],user);
 f.ctx.fetch=async()=>({ok:true,json:async()=>({products:[{id:'new',name:'新产品'}],catalogConnected:true,syncedAt:'2026-11-23T04:00:00Z'})});
 assert.equal(await f.s.loadWholesaleProducts({manual:true}),true);assert.match(f.node('#catalog-sync-status').textContent,/已同步 1 款/);assert.equal(f.node('#sync-wholesale-products').disabled,false);
 f.ctx.fetch=async()=>({ok:true,json:async()=>({products:[{id:'old',name:'过时产品'}],catalogConnected:false,catalogConnectionReason:'missing-credentials'})});
 assert.equal(await f.s.loadWholesaleProducts(),false);assert.equal(f.s.catalog()[0].id,'new');assert.match(f.node('#catalog-sync-status').textContent,/尚未配置/);
 f.ctx.fetch=async()=>{throw Error('offline')};assert.equal(await f.s.loadWholesaleProducts(),false);assert.equal(f.s.catalog()[0].id,'new');assert.match(f.node('#catalog-sync-status').textContent,/保留上次/);
});
test('catalog includes custom additions and saved edits, excludes deleted products and never resolves PR costs',()=>{
 const data={customProducts:[{id:'c',name:'新款',image:'new.jpg'}],productSettings:{a:{name:'已更名',image:'saved.jpg'},b:{deleted:true}},inventory:{a:'缺货'},costSettings:{secret:123}};
 const rows=currentWholesaleProducts([{id:'a',name:'旧名',status:'有货'},{id:'b',name:'下架'}],data);
 assert.deepEqual(rows.map(x=>x.id),['a','c']);assert.equal(rows[0].name,'已更名');assert.equal(rows[0].status,'缺货');assert.equal(rows[0].image,'saved.jpg');
 assert.deepEqual(catalogCostInfo(user,rows[0],data,()=>{throw Error('PR must not read costs')}),{});
});
test('server enforces account ownership, preserves it across colleague edits, and records effective actor',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'pr-owner-'));try {
 const file=join(dir,'state.json');const seed={creators:[],placements:[],customCreatorTypes:[],monthlyBudgets:{},updatedAt:'2026-11-01T00:00:00Z'};await writeFile(file,JSON.stringify(seed));const store=createXhsStore({file});
 const cmd={requestId:randomUUID(),operations:[{group:'placements',id:'p1',kind:'add',before:null,after:{id:'p1',owner:'spoofed',ownerId:'admin',publicationFormat:'合集',likes:12}}]};
 await store.commit(cmd,user);await store.commit(cmd,user);const before=await store.read();assert.equal(before.placements.length,1);assert.equal(before.placements[0].ownerId,user.id);
 const edited=structuredClone(before);edited.placements[0].cooperationDetails='Another colleague edit';await store.commit({requestId:randomUUID(),operations:RecordOps.diff(before,edited,xhsShape)},{id:'admin',name:'管理员',username:'admin'});
 const saved=await store.read();assert.equal(saved.placements[0].owner,'小杰');assert.equal(saved.placements[0].likes,12);
 const forged=structuredClone(saved);forged.placements[0].owner='someone else';await assert.rejects(store.commit({requestId:randomUUID(),operations:RecordOps.diff(saved,forged,xhsShape)},user),{status:403});assert.deepEqual(await store.read(),saved);
 }finally{await rm(dir,{recursive:true,force:true})}
});
