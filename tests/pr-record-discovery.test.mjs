import PromotionData from '../public/content-ops/promotion-data.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const app=await readFile(new URL('../public/xhs-media/app.js',import.meta.url),'utf8');
function setup(rows){
 const nodes=new Map();
 const node=k=>{if(!nodes.has(k))nodes.set(k,{value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},scrollIntoView(){}});return nodes.get(k)};
 let now='2026-11-23T09:00:00Z';const RealDate=Date;class FixedDate extends RealDate{constructor(...a){super(...(a.length?a:[now]))}static now(){return new RealDate(now).getTime()}}
 const ctx=vm.createContext({PromotionData,document:{querySelector:node,querySelectorAll:()=>[],activeElement:null},Date:FixedDate,console,structuredClone,setTimeout:()=>1,clearTimeout(){},URL});
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+`globalThis.s={followupTask,placementInformationIssue,renderFollowups,renderTable,renderProductBoard,filteredPlacements,openCooperationRecords,prDate,prCycle,prCycleLabel,prReview,prDay7Data,isDay7ReviewDue,isPublishedWaitingForDay7,savePerformanceReview,feedbackType,renderPrSummary,scopedPlacements,
 prepareSave:()=>{savePlacements=()=>{};syncCreatorsFromPlacements=()=>{};flushServerSave=async()=>true;renderAll=()=>{};},
 setup:rows=>{placements=rows;creators=[];currentUser={role:'admin'};rebuildPromotionCatalog();},rows:()=>placements,
 period:p=>ledgerPeriod=p,overview:p=>overviewPeriod=p,product:p=>selectedProduct=p,
 filtered:()=>filteredPlacements().map(x=>x.id),renderStub:()=>{switchView=n=>globalThis.opened=n}};})();`,ctx);
 ctx.s.setup(structuredClone(rows));return{ctx,s:ctx.s,node,clock:value=>now=value};
}
const row=(id,extra={})=>({id,creator:`Creator ${id}`,product:'Product A',createdAt:'2026-11-23',status:'待建联',sampleStatus:'待寄样',deliverableProgress:'0/1',...extra});
const cases=[row('contact'),row('sample',{status:'待寄样'}),row('waiting',{status:'已寄样',sampleStatus:'已寄样',agreedPublishAt:'2026-12-05'}),row('overdue',{status:'等待发布',agreedPublishAt:'2026-11-20'}),row('published',{status:'已发布',publishedAt:'2026-11-22'}),row('review',{status:'已发布',publishedAt:'2026-11-01'}),row('complete',{status:'已发布',publishedAt:'2026-11-01',likes:20,saves:0,comments:0,performanceReviewedAt:'2026-11-08'}),row('future',{status:'已发布',publishedAt:'2026-12-10'}),row('no-date',{status:'已发布'}),row('unknown',{status:'历史状态'})];
test('a newly registered contact appears immediately, and shipment progression changes its bucket',()=>{
 const f=setup(cases);assert.equal(f.s.followupTask(cases[0]).kind,'pending-contact');assert.equal(f.s.followupTask(cases[1]).kind,'sample-shipping');assert.equal(f.s.followupTask(cases[2]).kind,'waiting-publish');
 f.s.renderFollowups();const html=f.node('#followup-list').innerHTML;assert.match(html,/followup-pending-contact/);assert.match(html,/Creator contact/);assert.match(f.node('#followup-summary').innerHTML,/待建联/);
});
test('future or missing actual publication dates remain visible for review without mutating records',()=>{
 const f=setup(cases),before=JSON.stringify(f.s.rows());assert.equal(f.s.followupTask(cases[7]).kind,'information-check');assert.equal(f.s.followupTask(cases[8]).kind,'information-check');assert.match(f.s.placementInformationIssue(cases[7]),/2026-12-10.*晚于今天/);
 f.s.renderFollowups();assert.match(f.node('#followup-list').innerHTML,/Creator future/);assert.match(f.node('#followup-list').innerHTML,/Creator no-date/);assert.equal(JSON.stringify(f.s.rows()),before);
});
test('ledger shows only published records, preserving every original row',()=>{
 const f=setup(cases),before=JSON.stringify(f.s.rows());f.s.renderTable();const html=f.node('#placement-table').innerHTML;
 for(const r of cases)assert.equal((html.match(new RegExp(`data-edit="${r.id}"`,'g'))||[]).length,r.status==='已发布'?1:0,r.id);
 assert.doesNotMatch(html,/待建联 \/ 未启动|合作进行中/);assert.equal(JSON.stringify(f.s.rows()),before);
});
test('PR periods include the 16th and start on the 17th, including cross-year rollover',()=>{
 const rows=['2026-11-16','2026-11-17','2026-12-16','2026-12-17'].map((date,i)=>row(String(i),{status:'已发布',publishedAt:date,likes:200,performanceReviewedAt:date}));
 const f=setup([...rows,row('unknown',{status:'已发布'})]);f.clock('2026-12-20T09:00:00Z');f.s.period('2026-11');assert.deepEqual(Array.from(f.s.filtered()),['1','2']);
 assert.equal(f.s.prCycle('2027-01-16'),'2026-12');assert.equal(f.s.prCycle('2027-01-17'),'2027-01');
 assert.equal(f.s.prCycleLabel('2026-12'),'2026-12-17 至 2027-01-16');
 assert.equal(f.s.prCycle('2028-02-29'),'2028-02');assert.equal(f.s.prCycle('2026-02-29'),'');
 f.s.period('undated');assert.ok(f.s.filtered().includes('unknown'));
});
test('cooperation links retain exact ranked records in followups, including finished records',()=>{
 const f=setup([...cases,row('other-product',{product:'Product B'}),row('older',{createdAt:'2026-10-01'})]);f.s.overview('2026-11');f.node('#search-input').value='not matching';f.node('#data-entry-filter').value='qualified';f.s.renderStub();f.s.openCooperationRecords('Product A');
 assert.equal(f.ctx.opened,'followups');assert.equal(f.node('#search-input').value,'');assert.equal(f.node('#data-entry-filter').value,'all');assert.deepEqual(Array.from(f.s.scopedPlacements()).map(x=>x.id),cases.filter(x=>PromotionData.publicationStage(x)).map(x=>x.id));
 f.s.renderFollowups();for(const r of cases.filter(x=>PromotionData.publicationStage(x)))assert.ok(f.node('#followup-list').innerHTML.includes(`Creator ${r.id}`),r.id);
 f.s.renderProductBoard();assert.match(f.node('#product-board').innerHTML,/查看这 7 条记录/);
});
test('published search and review filters remain usable',()=>{
 const f=setup(cases);f.node('#search-input').value='Creator future';f.s.renderTable();assert.match(f.node('#placement-table').innerHTML,/data-edit="future"/);assert.doesNotMatch(f.node('#placement-table').innerHTML,/data-edit="contact"/);
 f.node('#search-input').value='';f.node('#data-entry-filter').value='check';assert.deepEqual(Array.from(f.s.filtered()),['future','no-date']);
 f.node('#data-entry-filter').value='below';assert.deepEqual(Array.from(f.s.filtered()),['complete']);
});
test('200-like threshold is inclusive; unknown counts and future dates are excluded',()=>{
 const f=setup([]),published={status:'已发布',publishedAt:'2026-11-20'};
 assert.equal(f.s.prReview({...published,likes:199}).qualifies,false);
 assert.equal(f.s.prReview({...published,likes:200}).qualifies,true);
 assert.equal(f.s.prReview({...published,likes:'200'}).qualifies,true);
 assert.equal(f.s.prReview({...published,likes:0}).key,'watching');
 assert.equal(f.s.prReview({...published,likes:0,performanceReviewedAt:'2026-11-21'}).key,'watching');
 for(const likes of [null,undefined,'',-1,'NaN',false])assert.equal(f.s.prReview({...published,likes,performanceReviewedAt:'2026-11-21'}).key,'watching');
 assert.equal(f.s.prReview({...published,likes:200,publishedAt:'2026-12-01'}).key,'check');
});
test('summary counts each cooperation once across products and recomputes after data updates',()=>{
 const rows=[row('one',{status:'已发布',publishedAt:'2026-11-20',likes:200,product:'A、B',owner:'PR A'}),row('two',{status:'已发布',publishedAt:'2026-11-21',likes:199,owner:'PR A'})];
 const f=setup([...rows,rows[0]]);f.s.renderTable();assert.equal(f.s.filtered().length,2);assert.match(f.node('#pr-summary').innerHTML,/PR A：1 条达标 \/ 2 条已发布/);
 f.s.rows()[1].likes=200;f.s.renderTable();assert.match(f.node('#pr-summary').innerHTML,/PR A：2 条达标 \/ 2 条已发布/);
});

const reviewForm=(id,date,likes,saves=0,comments=0)=>({dataset:{reviewForm:id},reportValidity:()=>true,querySelector:selector=>({value:({recordedAt:date,likes,saves,comments})[selector.match(/"(.*?)"/)[1]]})});
test('early 200 counts in its original task cycle while day-7 data is still required across cycles',async()=>{
 const f=setup([row('early',{status:'已发布',publishedAt:'2026-11-15'})]);f.s.prepareSave();f.clock('2026-11-16T09:00:00Z');
 await f.s.savePerformanceReview(reviewForm('early','2026-11-16',200));const item=f.s.rows()[0];
 assert.equal(f.s.prReview(item).qualifies,true);assert.equal(f.s.prReview(item).cycle,'2026-10');assert.equal(f.s.isPublishedWaitingForDay7(item),true);assert.equal(f.s.prDay7Data(item),null);
 f.clock('2026-11-22T09:00:00Z');assert.equal(f.s.isDay7ReviewDue(item),true);assert.equal(f.s.prReview(item).cycle,'2026-10');
 await f.s.savePerformanceReview(reviewForm('early','2026-11-22',250,20,3));
 assert.equal(f.s.isDay7ReviewDue(item),false);assert.equal(f.s.prDay7Data(item).likes,250);assert.equal(f.s.prReview(item).cycle,'2026-10');
 assert.equal(item.prQualifiedReview.recordedAt,'2026-11-16');assert.equal(item.prQualifiedReview.likes,200);
 f.s.period('2026-11');assert.equal(f.s.filtered().length,0);f.s.period('2026-10');assert.equal(f.s.filtered().length,1);
});
test('below 200 at cutoff moves to next cycle and only day-7 observation can fail the task',async()=>{
 const f=setup([row('late',{status:'已发布',publishedAt:'2026-11-15'})]);f.s.prepareSave();f.clock('2026-11-16T09:00:00Z');
 await f.s.savePerformanceReview(reviewForm('late','2026-11-16',199));const item=f.s.rows()[0];
 assert.equal(f.s.prReview(item).key,'watching');assert.equal(f.s.prReview(item).cycle,'2026-11');assert.equal(f.s.feedbackType(item),'pending-data');
 f.clock('2026-11-22T09:00:00Z');assert.equal(f.s.prReview(item).key,'missing');assert.equal(f.s.isDay7ReviewDue(item),true);
 await f.s.savePerformanceReview(reviewForm('late','2026-11-22',199,10,2));
 assert.equal(f.s.prReview(item).key,'below');assert.equal(f.s.prReview(item).cycle,'2026-11');assert.equal(f.s.feedbackType(item),'pause');
});
test('first 200 on the 17th counts in the next cycle even though published on the 15th',async()=>{
 const f=setup([row('later',{status:'已发布',publishedAt:'2026-11-15'})]);f.s.prepareSave();f.clock('2026-11-17T09:00:00Z');
 await f.s.savePerformanceReview(reviewForm('later','2026-11-17',200));assert.equal(f.s.prReview(f.s.rows()[0]).cycle,'2026-11');assert.equal(f.s.isPublishedWaitingForDay7(f.s.rows()[0]),true);
});
test('missing historical observation date stays unassigned; valid day-7 zero is not treated as missing',()=>{
 const f=setup([]),item={status:'已发布',publishedAt:'2026-11-15',likes:200};
 assert.equal(f.s.prReview(item).cycle,'');assert.equal(f.s.prReview(item).qualifies,true);
 for(const likes of [null,undefined,'',false])assert.equal(f.s.prReview({...item,likes,saves:0,comments:0,performanceReviewedAt:'2026-11-22'}).key,'missing');
 assert.equal(f.s.prReview({...item,likes:0,saves:0,comments:0,performanceReviewedAt:'2026-11-22'}).key,'below');
 const snapshot={...item,prDay7Review:{publishedAt:'2026-11-14',recordedAt:'2026-11-22',likes:200,saves:0,comments:0}};
 assert.equal(f.s.prDay7Data(snapshot),null);
});
test('invalid observation never changes saved metrics; late entry of pre-7-day data cannot clear day-7 follow-up',async()=>{
 const f=setup([row('valid',{status:'已发布',publishedAt:'2026-11-15',likes:10})]);f.s.prepareSave();const item=f.s.rows()[0],before=JSON.stringify(item);
 await f.s.savePerformanceReview(reviewForm('valid','2026-11-24',200));assert.equal(JSON.stringify(item),before);
 await f.s.savePerformanceReview(reviewForm('valid','2026-11-14',200));assert.equal(JSON.stringify(item),before);
 await f.s.savePerformanceReview(reviewForm('valid','2026-11-16',200));assert.equal(f.s.isDay7ReviewDue(item),true);assert.equal(f.s.prReview(item).cycle,'2026-10');
});
