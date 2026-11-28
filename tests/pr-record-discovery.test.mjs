import PromotionData from '../public/content-ops/promotion-data.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../public/xhs-media/app.js',import.meta.url),'utf8');
function setup(rows){
 const nodes=new Map();
 const node=k=>{if(!nodes.has(k))nodes.set(k,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},scrollIntoView(){}});return nodes.get(k)};
 const RealDate=Date;class FixedDate extends RealDate{constructor(...a){super(...(a.length?a:['2026-11-23T09:00:00Z']))}static now(){return new RealDate('2026-11-23T09:00:00Z').getTime()}}
 const ctx=vm.createContext({PromotionData,document:{querySelector:node,querySelectorAll:()=>[],activeElement:null},Date:FixedDate,console,structuredClone,setTimeout:()=>1,clearTimeout(){},URL});
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+`globalThis.s={followupTask,placementInformationIssue,renderFollowups,renderTable,renderProductBoard,filteredPlacements,openCooperationRecords,
 setup:rows=>{placements=rows;creators=[];currentUser={role:'admin'};rebuildPromotionCatalog();},rows:()=>placements,
 period:p=>ledgerPeriod=p,overview:p=>overviewPeriod=p,product:p=>selectedProduct=p,
 filtered:()=>filteredPlacements().map(x=>x.id),renderStub:()=>{switchView=n=>globalThis.opened=n}};})();`,ctx);
 ctx.s.setup(structuredClone(rows));return{ctx,s:ctx.s,node};
}
const row=(id,extra={})=>({id,creator:`Creator ${id}`,product:'Product A',createdAt:'2026-11-23',status:'待建联',sampleStatus:'待寄样',deliverableProgress:'0/1',...extra});
const cases=[row('contact'),row('sample',{status:'待寄样'}),row('waiting',{status:'已寄样',sampleStatus:'已寄样',agreedPublishAt:'2026-12-05'}),row('overdue',{status:'等待发布',agreedPublishAt:'2026-11-20'}),row('published',{status:'已发布',publishedAt:'2026-11-22'}),row('review',{status:'已发布',publishedAt:'2026-11-01'}),row('complete',{status:'已发布',publishedAt:'2026-11-01',likes:20}),row('future',{status:'已发布',publishedAt:'2026-12-10'}),row('no-date',{status:'已发布'}),row('unknown',{status:'历史状态'})];
test('a newly registered contact appears immediately, and shipment progression changes its bucket',()=>{
 const f=setup(cases);assert.equal(f.s.followupTask(cases[0]).kind,'pending-contact');assert.equal(f.s.followupTask(cases[1]).kind,'sample-shipping');assert.equal(f.s.followupTask(cases[2]).kind,'waiting-publish');
 f.s.renderFollowups();const html=f.node('#followup-list').innerHTML;assert.match(html,/followup-pending-contact/);assert.match(html,/Creator contact/);assert.match(f.node('#followup-summary').innerHTML,/待建联/);
});
test('future or missing actual publication dates remain visible for review without mutating records',()=>{
 const f=setup(cases),before=JSON.stringify(f.s.rows());assert.equal(f.s.followupTask(cases[7]).kind,'information-check');assert.equal(f.s.followupTask(cases[8]).kind,'information-check');assert.match(f.s.placementInformationIssue(cases[7]),/2026-12-10.*晚于今天/);
 f.s.renderFollowups();assert.match(f.node('#followup-list').innerHTML,/Creator future/);assert.match(f.node('#followup-list').innerHTML,/Creator no-date/);assert.equal(JSON.stringify(f.s.rows()),before);
});
test('all-time ledger renders every status exactly once, including intermediate and unknown records',()=>{
 const f=setup(cases),before=JSON.stringify(f.s.rows());f.s.renderTable();const html=f.node('#placement-table').innerHTML;
 for(const r of cases)assert.equal((html.match(new RegExp(`data-edit="${r.id}"`,'g'))||[]).length,1,r.id);
 assert.match(html,/信息待核对/);assert.match(html,/合作进行中/);assert.equal(JSON.stringify(f.s.rows()),before);
});
test('monthly ledger matches registration month even if publication is absent or in another month',()=>{
 const f=setup([...cases,row('old',{createdAt:'2026-10-15',publishedAt:'2026-11-22',status:'已发布'})]);f.s.period('2026-11');assert.deepEqual(Array.from(f.s.filtered()),cases.map(x=>x.id));f.s.period('all');assert.equal(f.s.filtered().length,11);
 f.s.period('unpublished');assert.ok(f.s.filtered().includes('contact'));assert.ok(!f.s.filtered().includes('future'));
});
test('cooperation count links clear stale filters and open the exact registration-month records',()=>{
 const f=setup([...cases,row('other-product',{product:'Product B'}),row('older',{createdAt:'2026-10-01'})]);f.s.overview('2026-11');f.node('#search-input').value='not matching';f.node('#data-entry-filter').value='filled';f.s.renderStub();f.s.openCooperationRecords('Product A');
 assert.equal(f.ctx.opened,'placements');assert.equal(f.node('#search-input').value,'');assert.equal(f.node('#data-entry-filter').value,'all');assert.deepEqual(Array.from(f.s.filtered()),cases.filter(x=>PromotionData.publicationStage(x)).map(x=>x.id));
 f.s.renderProductBoard();assert.match(f.node('#product-board').innerHTML,/data-cooperation-records="all"/);assert.match(f.node('#product-board').innerHTML,/查看这 7 条记录/);
});
test('ledger search and state filters remain effective with full record visibility',()=>{
 const f=setup(cases);f.node('#search-input').value='Creator future';f.s.renderTable();assert.match(f.node('#placement-table').innerHTML,/data-edit="future"/);assert.doesNotMatch(f.node('#placement-table').innerHTML,/data-edit="contact"/);
 f.node('#search-input').value='';f.node('#data-entry-filter').value='check';assert.deepEqual(Array.from(f.s.filtered()),['future','no-date']);
 f.node('#data-entry-filter').value='all';f.node('#status-filter').value='待建联';assert.deepEqual(Array.from(f.s.filtered()),['contact']);
});
