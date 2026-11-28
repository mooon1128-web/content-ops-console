import PromotionData from '../public/content-ops/promotion-data.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import RecordOps from '../public/content-ops/ops-core.cjs';
import {createXhsStore,publicXhs,xhsShape as shape} from '../content-ops/xhs-store.js';
const app=await readFile(new URL('../public/xhs-media/app.js',import.meta.url),'utf8');
const syncSource=await readFile(new URL('../public/content-ops/cloud-sync.js',import.meta.url),'utf8');
const user={id:'test-pr',name:'Test PR',username:'testpr'};
const seed={creators:[
 {id:'creator-Test',name:'Test!',placementIds:['p1'],cooperationCount:1,customFutureField:{keep:7}},
 {id:'imported-unique-id',name:'Test_',placementIds:['p2'],cooperationCount:1,outreachEmailSentCount:3},
 {id:'untouched',name:'Other colleague',notes:'Do not modify',placementIds:[]}
],placements:[{id:'p1',creator:'Test!',product:'Product A'},{id:'p2',creator:'Test_',product:'Product B'}],customCreatorTypes:[],monthlyBudgets:{},updatedAt:'2026-11-01T00:00:00.000Z'};
const plain=v=>JSON.parse(JSON.stringify(v));
async function fixture(initial=seed){
 const dir=await mkdtemp(join(tmpdir(),'pr-save-flow-')),file=join(dir,'state.json');await writeFile(file,JSON.stringify(initial));const store=createXhsStore({file});
 const nodes=new Map(),events=new Map(),reports=[];const memory={};let renders=0;
 function node(s){if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',innerHTML:'',dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},elements:{creatorTier:{value:''}},open:false,close(){this.open=false},addEventListener:(type,fn)=>events.set(s+':'+type,fn),querySelector:node,querySelectorAll:()=>[]});return nodes.get(s)}
 class FD{constructor(f){this.values=f.values}entries(){return this.values[Symbol.iterator]()}getAll(k){return this.values.filter(x=>x[0]===k).map(x=>x[1])}}
 const ctx=vm.createContext({PromotionData,structuredClone,RecordOps,crypto:{randomUUID},AbortSignal,FormData:FD,console,setTimeout:()=>1,clearTimeout(){},document:{body:node('body'),querySelector:node,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){}}});
 vm.runInContext(syncSource,ctx);
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+`globalThis.subject={syncCreatorsFromPlacements,allowSyncInteraction,creatorId,saveConversionCheck,needsConversionCheck,conversionCheckComplete,conversionSavePending,conversionTasks,conversionReviewDisplay,renderFollowups,renderTable,prReview,isDay7ReviewDue,buildFollowupReport,
 setup:(c,u)=>{cloud=c;currentUser=u;selectedWholesaleProductsFromForm=()=>[];renderAll=()=>{};bindEvents()},
 read:()=>({creators,placements,customCreatorTypes,monthlyBudgets}),write:s=>{creators=s.creators;placements=s.placements;customCreatorTypes=s.customCreatorTypes;monthlyBudgets=s.monthlyBudgets}};})();`,ctx);
 const s=ctx.subject,cloud=new ctx.SharedSync({url:'/state',shape,journal:{read:async()=>memory.pending,write:async v=>memory.pending=structuredClone(v),clear:async()=>{delete memory.pending}},read:s.read,write:s.write,render:()=>renders++,busy:()=>false,status:r=>reports.push(r)});
 cloud.request=async(path,o={})=>o.method==='PATCH'?{state:publicXhs(await store.commit(JSON.parse(o.body),user))}:await store.read();
 s.setup(cloud,user);await cloud.start();
 const submit=async data=>{const form=node('#placement-form');form.values=Object.entries({creator:'Test_',product:'Product B',sampleQuantity:'1',status:'待建联',...data});node('#placement-dialog').open=true;await events.get('#placement-form:submit')({preventDefault(){},currentTarget:form});return cloud.flush()};
 return{s,cloud,store,memory,node,reports,submit,events,close:()=>rm(dir,{recursive:true,force:true}),renders:()=>renders};
}
test('saving a new placement then editing it repeatedly remains interactive without touching unrelated records',async()=>{
 const f=await fixture();try{
 const before=await f.store.read();
 assert.equal(await f.submit({}),true);
 const id=f.s.read().placements.find(x=>!['p1','p2'].includes(x.id)).id;
 for(const detail of ['first edit','second edit']){
  assert.equal(await f.submit({id,cooperationDetails:detail}),true);
  assert.equal(f.cloud.conflict,false);assert.equal(f.cloud.pending,false);assert.equal(f.node('#placement-dialog').open,false);
  assert.equal(f.s.allowSyncInteraction({target:{closest:()=>null}}),true);
 }
 const after=await f.store.read();assert.equal(after.placements.length,3);assert.equal(after.placements.find(x=>x.id===id).cooperationDetails,'second edit');
 assert.deepEqual(after.creators.filter(x=>x.id!=='imported-unique-id'),before.creators.filter(x=>x.id!=='imported-unique-id'));
 assert.equal(after.creators.find(x=>x.id==='imported-unique-id').outreachEmailSentCount,3);assert.equal(f.memory.pending,undefined);
 }finally{await f.close()}
});
test('full association rebuild keeps existing IDs and unknown creator fields even for punctuation-colliding nicknames',async()=>{
 const f=await fixture();try{
 f.s.syncCreatorsFromPlacements();assert.equal(await f.cloud.flush(),true);
 const after=await f.store.read();assert.equal(after.creators.length,3);assert.deepEqual(after.creators.map(x=>x.id),seed.creators.map(x=>x.id));
 assert.equal(after.creators[0].customFutureField.keep,7);assert.equal(after.creators[1].outreachEmailSentCount,3);
 }finally{await f.close()}
});
test('new creators with similar punctuation names receive distinct IDs and retain both placements',async()=>{
 const f=await fixture();try{
 for(const creator of ['New!','New_'])assert.equal(await f.submit({creator}),true);
 const after=await f.store.read(),rows=after.creators.filter(x=>x.name.startsWith('New'));
 assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.equal(after.placements.length,4);
 }finally{await f.close()}
});
test('saving one cooperation preserves concurrent unrelated edits; real same-field conflicts still block overwrites',async()=>{
 const f=await fixture();try{
 const before=await f.store.read(),next=structuredClone(before);next.creators[2].notes='Colleague latest';
 await f.store.commit({requestId:randomUUID(),operations:RecordOps.diff(before,next,shape)},{id:'other',name:'Other',username:'other'});
 assert.equal(await f.submit({id:'p2',cooperationDetails:'My edit'}),true);assert.equal((await f.store.read()).creators[2].notes,'Colleague latest');
 const base=await f.store.read(),newer=structuredClone(base);newer.placements.find(x=>x.id==='p2').cooperationDetails='New colleague edit';
 await f.store.commit({requestId:randomUUID(),operations:RecordOps.diff(base,newer,shape)},{id:'other',name:'Other',username:'other'});
 assert.equal(await f.submit({id:'p2',cooperationDetails:'Conflicting edit'}),false);assert.equal(f.cloud.conflict,true);
 assert.equal((await f.store.read()).placements.find(x=>x.id==='p2').cooperationDetails,'New colleague edit');
 assert.ok(f.memory.pending.operations.length);assert.equal(f.s.allowSyncInteraction({target:{closest:()=>null}}),false);
 assert.equal(f.s.allowSyncInteraction({target:{closest:()=>true}}),true);
 }finally{await f.close()}
});

test('old-page recovery reads only the signed-in account outbox and never starts sync or writes it',async()=>{
 const record={operations:[{group:'placements',kind:'add',id:'saved-draft',after:{id:'saved-draft',creator:'Synthetic'}}]},calls=[];
 const ctx=vm.createContext({PromotionData,indexedDB:{open:name=>{calls.push(['open',name]);const request={};queueMicrotask(()=>{request.result={objectStoreNames:{contains:()=>true},close:()=>calls.push(['close']),transaction:(store,mode)=>{calls.push([store,mode]);const tx={objectStore:()=>({get:key=>{calls.push(['get',key]);queueMicrotask(()=>tx.oncomplete());return{result:record}}})};return tx}};request.onsuccess()});return request}},document:{querySelector(){},querySelectorAll:()=>[]},crypto:{randomUUID},console,setTimeout(){},clearTimeout(){}});
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+'globalThis.readDraft=readStoredPending;})();',ctx);
 assert.deepEqual(plain(await ctx.readDraft('xhs-v3:test-pr')),record);
 assert.deepEqual(calls,[['open','pupuhome-shared-outbox-v3'],['outbox','readonly'],['get','xhs-v3:test-pr'],['close']]);
 const recovery=app.slice(app.indexOf('  async function showDraftRecovery('),app.indexOf('  async function startSharedApp('));
 assert.doesNotMatch(recovery,/\.start\(|\.clear\(|\.delete\(|method:\s*['"](?:PATCH|POST|PUT)/);
});

const conversionSeed=()=>({...structuredClone(seed),placements:[
 {id:'p1',creator:'Test!',product:'A、B',status:'已发布',publishedAt:'2026-11-15',url:'https://www.xiaohongshu.com/explore/example',owner:'Test PR',ownerId:user.id,conversionMethods:['直接带链接','评论回复'],likes:200,saves:10,comments:2,prQualifiedReview:{publishedAt:'2026-11-15',recordedAt:'2026-11-16',likes:200},customFutureField:{keep:1}},
 {id:'p2',creator:'Test_',product:'Product B',status:'待寄样',conversionMethods:['直接带链接']}
]});
const conversionPanel=(id,methods)=>({dataset:{conversionCheck:id},querySelectorAll:selector=>(selector.includes(':checked')?methods:['直接带链接','评论回复']).map(value=>({value,disabled:false}))});
const conversionRow=f=>f.s.read().placements.find(row=>row.id==='p1');
const fireConversion=(f,panel,scope='#followup-list')=>f.events.get(scope+':change')({target:{matches:selector=>selector==='[data-conversion-method]',closest:selector=>selector==='[data-conversion-check]'?panel:null}});

test('published conversion checks remain independent of qualification/day7 and do not infer completion from agreed methods',async()=>{
 const f=await fixture(conversionSeed());try{
 const before=plain(f.s.read()),row=conversionRow(f);
 assert.equal(f.s.needsConversionCheck(row),true);assert.equal(f.s.needsConversionCheck(f.s.read().placements[1]),false);
 assert.equal(f.s.prReview(row).qualifies,true);assert.equal(f.s.isDay7ReviewDue(row),true);
 f.s.renderFollowups();const html=f.node('#followup-list').innerHTML;
 assert.match(html,/id="followup-conversion-check"/);assert.match(html,/待你核查/);assert.match(html,/打开笔记/);
 assert.match(html,/id="followup-day7-review"/);assert.match(f.node('#followup-summary').innerHTML,/转化待核查，1条/);
 assert.match(f.s.buildFollowupReport(),/负责 PR：Test PR/);assert.deepEqual(plain(f.s.read()),before);
 }finally{await f.close()}
});
test('checking required items saves once, removes only conversion todo and retains source record, owner, PR milestones and audit history',async()=>{
 const f=await fixture(conversionSeed());let saved;try{
 const before=await f.store.read(),milestone=f.s.prReview(conversionRow(f));
 await fireConversion(f,conversionPanel('p1',['直接带链接']));
 assert.equal(f.s.needsConversionCheck(conversionRow(f)),true);assert.equal(conversionRow(f).conversionReview.history.length,1);
 await fireConversion(f,conversionPanel('p1',['直接带链接','评论回复']));
 assert.equal(f.s.needsConversionCheck(conversionRow(f)),false);assert.equal(f.s.isDay7ReviewDue(conversionRow(f)),true);
 assert.deepEqual(plain(f.s.prReview(conversionRow(f))),plain(milestone));
 saved=await f.store.read();assert.deepEqual(saved.placements.map(x=>x.id),before.placements.map(x=>x.id));
 assert.deepEqual(saved.creators,before.creators);assert.deepEqual(saved.placements[1],before.placements[1]);
 const original={...saved.placements[0]};delete original.conversionReview;delete original.updatedAt;assert.deepEqual(original,before.placements[0]);
 const review=saved.placements[0].conversionReview;assert.equal(review.checkedBy.id,user.id);assert.ok(review.completedAt);assert.equal(review.history.length,2);
 f.s.renderFollowups();assert.match(f.node('#followup-summary').innerHTML,/转化待核查，0条/);
 f.s.renderTable();assert.match(f.node('#placement-table').innerHTML,/转化已核查/);assert.match(f.node('#placement-table').innerHTML,/核查记录（2）/);
 await fireConversion(f,conversionPanel('p1',['直接带链接','评论回复']));assert.equal((await f.store.read()).placements[0].conversionReview.history.length,2);
 }finally{await f.close()}
 const otherDevice=await fixture(saved);try{assert.equal(otherDevice.s.needsConversionCheck(conversionRow(otherDevice)),false);assert.equal(conversionRow(otherDevice).conversionReview.history.length,2);}finally{await otherDevice.close()}
});
test('ledger uncheck reopens conversion todo and retains history; different note or new required method requires recheck',async()=>{
 const f=await fixture(conversionSeed());try{
 await f.s.saveConversionCheck(conversionPanel('p1',['直接带链接','评论回复']));
 await fireConversion(f,conversionPanel('p1',['直接带链接']),'#placement-table');
 assert.equal(f.s.needsConversionCheck(conversionRow(f)),true);assert.equal(conversionRow(f).conversionReview.history.length,2);
 await f.s.saveConversionCheck(conversionPanel('p1',['直接带链接','评论回复']));
 const saved=plain(conversionRow(f));assert.equal(f.s.conversionCheckComplete({...saved,url:'https://www.xiaohongshu.com/explore/new'}),false);
 assert.equal(f.s.conversionCheckComplete({...saved,publishedAt:'2026-11-20'}),false);
 const optional={...saved,conversionMethods:[],conversionReview:{...saved.conversionReview,methods:['评论回复']}};
 assert.equal(f.s.conversionCheckComplete(optional),true);assert.equal(f.s.conversionCheckComplete({...optional,conversionMethods:['直接带链接']}),false);
 }finally{await f.close()}
});
test('offline or in-flight completion stays in todo until server confirmation and preserves retry payload',async()=>{
 const f=await fixture(conversionSeed());try{
 const request=f.cloud.request;let release;const gate=new Promise(resolve=>release=resolve);
 f.cloud.request=async()=>{await gate;throw Error('offline')};
 const pending=f.s.saveConversionCheck(conversionPanel('p1',['直接带链接','评论回复']));
 await Promise.resolve();assert.equal(f.s.needsConversionCheck(conversionRow(f)),true);
 release();await pending;
 assert.equal(f.cloud.pending,true);assert.equal(f.s.conversionSavePending(conversionRow(f)),true);assert.equal(f.s.needsConversionCheck(conversionRow(f)),true);
 assert.match(f.s.conversionReviewDisplay(conversionRow(f),true),/尚未获服务器确认/);assert.ok(f.memory.pending.operations.length);
 assert.equal((await f.store.read()).placements[0].conversionReview,undefined);
 f.cloud.request=request;assert.equal(await f.cloud.flush(),true);assert.equal(f.s.needsConversionCheck(conversionRow(f)),false);
 assert.equal((await f.store.read()).placements[0].conversionReview.history.length,1);
 }finally{await f.close()}
});
test('conversion updates merge concurrent unrelated edits and refuse overwriting another PR verification',async()=>{
 const f=await fixture(conversionSeed());try{
 const before=await f.store.read(),other=structuredClone(before);other.placements[0].notes='Other PR latest note';
 await f.store.commit({requestId:randomUUID(),operations:RecordOps.diff(before,other,shape)},{id:'colleague',name:'Other PR'});
 await f.s.saveConversionCheck(conversionPanel('p1',['直接带链接']));assert.equal(conversionRow(f).notes,'Other PR latest note');
 const base=await f.store.read(),conflicting=structuredClone(base);conflicting.placements[0].conversionReview.checkedBy={id:'colleague',name:'Other PR'};
 await f.store.commit({requestId:randomUUID(),operations:RecordOps.diff(base,conflicting,shape)},{id:'colleague',name:'Other PR'});
 await f.s.saveConversionCheck(conversionPanel('p1',['直接带链接','评论回复']));
 assert.equal(f.cloud.conflict,true);assert.equal(f.s.needsConversionCheck(conversionRow(f)),true);
 assert.equal((await f.store.read()).placements[0].conversionReview.checkedBy.id,'colleague');assert.ok(f.memory.pending.operations.length);
 }finally{await f.close()}
});
