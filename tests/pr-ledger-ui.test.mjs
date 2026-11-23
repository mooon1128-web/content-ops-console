import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import RecordOps from '../public/content-ops/ops-core.cjs';
const app=await readFile(new URL('../public/xhs-media/app.js',import.meta.url),'utf8');
const syncSource=await readFile(new URL('../public/content-ops/cloud-sync.js',import.meta.url),'utf8');
const shape={creators:'rows',placements:'rows',customCreatorTypes:'value',monthlyBudgets:'map'};
const seed={creators:[{id:'c1',name:'Synthetic creator',placementIds:['p1','p2'],cooperationCount:2,email:'retained@example.invalid',outreachEmailSentCount:3}],placements:[{id:'p1',creator:'Synthetic creator',product:'Synthetic sample'},{id:'p2',creator:'Synthetic creator',product:'Keep'}],customCreatorTypes:[],monthlyBudgets:{},updatedAt:'2026-11-01T00:00:00.000Z'};
function setup(){
 const nodes=new Map();let timer=0;const timers=new Map(),calls=[];
 function node(key){if(!nodes.has(key))nodes.set(key,{value:'',innerHTML:'',textContent:'',hidden:true,disabled:false,dataset:{},style:{},classList:{add(){},remove(){},toggle(){}},elements:{id:{value:'p1'}},open:true,close(){this.open=false},scrollIntoView(){},querySelector:s=>node(s)});return nodes.get(key)}
 node('.tab.active').dataset.view='placements';
 const document={querySelector:node,querySelectorAll:s=>s==='dialog[open] [data-dialog-status]'?[node('feedback')]:[],activeElement:null};
 const ctx=vm.createContext({document,structuredClone,RecordOps,crypto:{randomUUID},AbortSignal,console,fetch:()=>{},setTimeout:(fn,ms)=>{timers.set(++timer,{fn,ms});return timer},clearTimeout:id=>timers.delete(id)});
 vm.runInContext(syncSource,ctx);
 vm.runInContext(app.slice(0,app.lastIndexOf('  startSharedApp().catch('))+`globalThis.subject={deletePlacement,updatePlacementDeletion,allowSyncInteraction,requestPlacementDeletion,
 setState:s=>{creators=s.creators;placements=s.placements;customCreatorTypes=s.customCreatorTypes;monthlyBudgets=s.monthlyBudgets},
 read:()=>({creators,placements,customCreatorTypes,monthlyBudgets}),setCloud:c=>cloud=c,pending:()=>pendingPlacementDeletion,
 renderCurrent:()=>renderAll(),renderCreators:()=>renderCreators(),page:n=>creatorPage=n,
 spyViews:fn=>{renderPeriodControls=()=>fn('period');renderProductBoard=()=>fn('products');renderCreators=()=>fn('creators');renderMetrics=()=>fn('metrics');renderBudgetPanel=()=>fn('budget');renderMonthlyStats=()=>fn('monthly');renderAnnualTrend=()=>fn('annual');renderStatusBoard=()=>fn('status');renderRanking=()=>fn('rank');renderFollowups=()=>fn('followups');renderTable=()=>fn('table');renderFeedback=()=>fn('feedback')},
 prepareCreatorTable:()=>{renderClassificationWorkbench=()=>{};filteredCreators=()=>creators;creatorTypeOptions=()=>[];renderBlacklist=()=>{}},
 stubRender:fn=>renderAll=fn};})();`,ctx);
 const s=ctx.subject;s.setState(structuredClone(seed));return{ctx,s,node,nodes,calls,timers};
}
async function synced(options={}){
 const f=setup();let remote=structuredClone(seed),online=true,patches=0;
 const cloud=new f.ctx.SharedSync({url:'/state',versionUrl:'/version',shape,journal:{read:async()=>null,write:async()=>{},clear:async()=>{}},read:f.s.read,write:f.s.setState,render(){},busy:()=>true,status:()=>f.s.updatePlacementDeletion(),authExpired(){}});
 cloud.request=async(path,o={})=>{
  if(o.method==='PATCH'){
   patches++;if(!online)throw Error('Offline');
   if(options.beforeCommit)await options.beforeCommit();
   remote=RecordOps.apply(remote,JSON.parse(o.body).operations,shape,'2026-11-23T02:00:00.000Z');remote.updatedAt='2026-11-23T02:00:00.000Z';return{state:structuredClone(remote)};
  }
  return structuredClone(remote);
 };
 f.s.setCloud(cloud);f.s.stubRender(()=>{});await cloud.start();
 return {...f,cloud,remote:()=>remote,patches:()=>patches,online:v=>online=v,editRemote:fn=>fn(remote)};
}
test('confirmed deletion removes only the selected placement and its creator association',async()=>{
 const f=await synced();f.editRemote(s=>s.creators[0].email='newer@example.invalid');
 await f.s.deletePlacement('p1');
 assert.deepEqual(f.remote().placements.map(x=>x.id),['p2']);assert.deepEqual(f.remote().creators[0].placementIds,['p2']);
 assert.equal(f.remote().creators[0].cooperationCount,1);assert.equal(f.remote().creators[0].outreachEmailSentCount,3);
 assert.equal(f.remote().creators[0].email,'newer@example.invalid');assert.equal(f.node('#placement-dialog').open,false);
 assert.equal(f.s.pending(),null);assert.match(f.node('#toast').textContent,/服务器已确认/);
});
test('slow acknowledgement gives feedback immediately and repeated clicks cannot duplicate deletion',async()=>{
 let release;const wait=new Promise(r=>release=r),f=await synced({beforeCommit:()=>wait});
 const work=f.s.deletePlacement('p1');await new Promise(r=>setImmediate(r));
 assert.equal(f.node('[data-delete]').disabled,true);assert.match(f.node('feedback').textContent,/等待服务器确认/);
 await f.s.deletePlacement('p1');assert.equal(f.patches(),1);assert.equal(f.node('#placement-dialog').open,true);
 release();await work;assert.equal(f.s.pending(),null);assert.equal(f.node('#placement-dialog').open,false);
});
test('offline deletion stays recoverable and later acknowledgement completes the still-open dialog',async()=>{
 const f=await synced();f.online(false);await f.s.deletePlacement('p1');
 assert.equal(f.remote().placements.length,2);assert.equal(f.node('#placement-dialog').open,true);assert.ok(f.cloud.exportPending().operations.some(x=>x.kind==='remove'));
 assert.match(f.node('feedback').textContent,/自动重试/);f.online(true);await f.cloud.flush();
 assert.equal(f.remote().placements.length,1);assert.equal(f.node('#placement-dialog').open,false);assert.equal(f.s.pending(),null);
});
test('concurrent edit blocks deletion without hiding the conflict behind the dialog',async()=>{
 const f=await synced();f.editRemote(s=>s.placements[0].notes='Other staff newer note');await f.s.deletePlacement('p1');
 assert.equal(f.remote().placements.length,2);assert.equal(f.remote().placements[0].notes,'Other staff newer note');assert.equal(f.cloud.conflict,true);
 assert.match(f.node('feedback').textContent,/版本冲突/);assert.equal(f.node('#placement-dialog').open,true);
});
test('close, recovery export, and Escape remain usable when sync is blocked',()=>{
 const f=setup();f.s.setCloud({ready:true,conflict:true});
 const e=(selector,key)=>({type:key?'keydown':'click',key,target:{closest:s=>s.includes(selector)}});
 for(const selector of ['[data-close]','[data-dialog-export]','[data-dialog-login]'])assert.equal(f.s.allowSyncInteraction(e(selector)),true);
 assert.equal(f.s.allowSyncInteraction(e('unmatched','Escape')),true);assert.equal(f.s.allowSyncInteraction(e('unmatched')),false);
});
test('ledger refresh does not render the hidden creator table or other hidden pages',()=>{
 const f=setup(),calls=[];f.s.spyViews(v=>calls.push(v));f.s.renderCurrent();assert.deepEqual(calls,['period','products','table']);
 f.node('.tab.active').dataset.view='creators';calls.length=0;f.s.renderCurrent();assert.deepEqual(calls,['period','products','creators']);
});
test('533 creators render 50 rows per page, and the last page remains reachable',()=>{
 const f=setup();f.s.setState({...structuredClone(seed),creators:Array.from({length:533},(_,i)=>({id:`synthetic-${i}`,name:`Synthetic ${i}`,tier:'素人',creatorTags:[]}))});
 f.s.prepareCreatorTable();f.s.renderCreators();assert.equal((f.node('#creator-table').innerHTML.match(/<tr>/g)||[]).length,50);
 assert.match(f.node('#creator-pagination').innerHTML,/共 533 位 · 第 1 \/ 11 页/);
 f.s.page(11);f.s.renderCreators();assert.equal((f.node('#creator-table').innerHTML.match(/<tr>/g)||[]).length,33);assert.match(f.node('#creator-table').innerHTML,/Synthetic 532/);
});
