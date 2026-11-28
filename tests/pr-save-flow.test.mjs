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
async function fixture(){
 const dir=await mkdtemp(join(tmpdir(),'pr-save-flow-')),file=join(dir,'state.json');await writeFile(file,JSON.stringify(seed));const store=createXhsStore({file});
 const nodes=new Map(),events=new Map(),reports=[];const memory={};let renders=0;
 function node(s){if(!nodes.has(s))nodes.set(s,{value:'',textContent:'',innerHTML:'',dataset:{},classList:{add(){},remove(){},toggle(){}},elements:{creatorTier:{value:''}},open:false,close(){this.open=false},addEventListener:(type,fn)=>events.set(s+':'+type,fn),querySelector:node,querySelectorAll:()=>[]});return nodes.get(s)}
 class FD{constructor(f){this.values=f.values}entries(){return this.values[Symbol.iterator]()}getAll(k){return this.values.filter(x=>x[0]===k).map(x=>x[1])}}
 const ctx=vm.createContext({PromotionData,structuredClone,RecordOps,crypto:{randomUUID},AbortSignal,FormData:FD,console,setTimeout:()=>1,clearTimeout(){},document:{querySelector:node,querySelectorAll:()=>[],addEventListener(){},activeElement:null},window:{addEventListener(){}}});
 vm.runInContext(syncSource,ctx);
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+`globalThis.subject={syncCreatorsFromPlacements,allowSyncInteraction,creatorId,
 setup:(c,u)=>{cloud=c;currentUser=u;selectedWholesaleProductsFromForm=()=>[];renderAll=()=>{};bindEvents()},
 read:()=>({creators,placements,customCreatorTypes,monthlyBudgets}),write:s=>{creators=s.creators;placements=s.placements;customCreatorTypes=s.customCreatorTypes;monthlyBudgets=s.monthlyBudgets}};})();`,ctx);
 const s=ctx.subject,cloud=new ctx.SharedSync({url:'/state',shape,journal:{read:async()=>memory.pending,write:async v=>memory.pending=structuredClone(v),clear:async()=>{delete memory.pending}},read:s.read,write:s.write,render:()=>renders++,busy:()=>false,status:r=>reports.push(r)});
 cloud.request=async(path,o={})=>o.method==='PATCH'?{state:publicXhs(await store.commit(JSON.parse(o.body),user))}:await store.read();
 s.setup(cloud,user);await cloud.start();
 const submit=async data=>{const form=node('#placement-form');form.values=Object.entries({creator:'Test_',product:'Product B',sampleQuantity:'1',status:'待建联',...data});node('#placement-dialog').open=true;await events.get('#placement-form:submit')({preventDefault(){},currentTarget:form});return cloud.flush()};
 return{s,cloud,store,memory,node,reports,submit,close:()=>rm(dir,{recursive:true,force:true}),renders:()=>renders};
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
