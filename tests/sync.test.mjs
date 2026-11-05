import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { initialAccess } from '../content-ops/access.js';
const rawFetch = globalThis.fetch, sessions = new Map();
const fetch = (url,options={}) => { const cookie=sessions.get(new URL(url).origin); return rawFetch(url,{...options,headers:{...(cookie?{Cookie:cookie}:{}),...options.headers}}); }; 

const syncSource = await readFile(new URL('../public/content-ops/sync-core.js', import.meta.url), 'utf8');
const context = vm.createContext({});
vm.runInContext(syncSource, context);
const merge = (b,l,r) => JSON.parse(JSON.stringify(context.ContentOpsSync.mergeStates(b,l,r)));
const seed = { titles: [], accounts: [{id:'account-2',name:'Studio'}], posts: [{ id: 'p1', accountId:'account-2', headline: 'original', likes: 1 }], products: [], updatedAt: '2026-11-01T00:00:00.000Z' };

test('merges independent fields and new records without reviving intentional deletions', () => {
 const b = structuredClone(seed), l = structuredClone(b), r = structuredClone(b);
 l.posts[0].likes = 0; r.posts[0].headline = '';
 l.posts.push({id:'local',headline:'local'}); r.posts.push({id:'remote',headline:'remote'});
 const result = merge(b,l,r); assert.equal(result.conflicts.length,0);
 assert.equal(result.state.posts[0].likes,0); assert.equal(result.state.posts[0].headline,'');
 assert.equal(result.state.posts.length,3);
 const deleted = structuredClone(b); deleted.posts=[];
 assert.equal(merge(b,deleted,b).state.posts.length,0);
});
test('same-field and delete/edit conflicts preserve local work for explicit resolution', () => {
 const l=structuredClone(seed),r=structuredClone(seed);l.posts[0].headline='mine';r.posts[0].headline='theirs';
 assert.deepEqual(merge(seed,l,r).conflicts,['/posts/p1/headline']);
 l.posts=[];assert.deepEqual(merge(seed,l,r).conflicts,['/posts/p1']);
});

const app = await readFile(new URL('../public/content-ops/app.js',import.meta.url),'utf8');
function client(initial, baseline, network, storageFails = false) {
 const store=new Map(),timers=new Map();let nextTimer=0;
 const c=vm.createContext({structuredClone,DOMException,ContentOpsSync:context.ContentOpsSync,
  localStorage:{setItem:(k,v)=>{if(storageFails)throw new DOMException("Storage full","QuotaExceededError");store.set(k,v)},getItem:k=>store.get(k),removeItem:k=>store.delete(k)},
  setTimeout:(fn,delay)=>{timers.set(++nextTimer,{fn,delay});return nextTimer},clearTimeout:id=>timers.delete(id),
  fetch:network,normalizeState:s=>s,hydrateControls(){},renderAll(){},toast(){},$:()=>null,
 });
 vm.runInContext(`const STORAGE_KEY='state';const PENDING_KEY='pending';const API_URL='/state';const isFileMode=false;const deviceId='test-device';let sessionUser={id:'tester'};let sessionEpoch=0;
 let state=${JSON.stringify(initial)}, syncedState=${JSON.stringify(baseline)}, lastSyncedStateAt=${JSON.stringify(baseline.updatedAt)};
 let localCacheUnavailable=false,pendingBackupUnavailable=false;
 let saveTimer=null,saveInFlight=false,hasPendingChanges=false,syncConflict=false,editVersion=0,apiOnline=true,hasLoadedRemoteState=true,syncFailureCount=0;
 function updateStorageStatus(){}
 ${app.slice(app.indexOf('  function keepPendingChanges()'),app.indexOf('  let refreshTimer'))}
 ${app.slice(app.indexOf('  function queueSave('),app.indexOf('  async function resolveSyncConflict()'))}
 globalThis.inspect=()=>({state,syncedState,hasPendingChanges,syncConflict,saveTimer,saveInFlight,localCacheUnavailable,pendingBackupUnavailable});
 globalThis.edit=fn=>{fn(state);scheduleSave()};globalThis.flush=saveState;globalThis.refresh=refreshRemoteState;`,c);
 return {c,store,timers,runTimer:async()=>{const [id,t]=timers.entries().next().value;timers.delete(id);await t.fn()}};
}
const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>structuredClone(data)});

test('first save clears the timer and subsequent remote refresh works',async()=>{
 let shared=structuredClone(seed),gets=0;
 const {c,runTimer}=client(seed,seed,async(url,opts={})=>{
  if(opts.method==='PUT'){shared={...JSON.parse(opts.body),updatedAt:'2026-11-02T00:00:00.000Z'};return response(200,{updatedAt:shared.updatedAt})}
  if(url==='/api/content-ops/version')return response(200,{updatedAt:shared.updatedAt});
  gets++;return response(200,shared);
 });
 c.edit(s=>s.posts[0].likes=4);await runTimer();
 // The timer callback starts an async save; await microtasks before refreshing.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(c.inspect().saveTimer,null);assert.equal(c.inspect().hasPendingChanges,false);
 shared.posts.push({id:'other'});shared.updatedAt='2026-11-03T00:00:00.000Z';await c.refresh();
 assert.equal(gets,1);assert.equal(c.inspect().state.posts.length,2);
});
test('edits made during an in-flight save are retained and queued',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);let calls=0;
 const {c}=client(seed,seed,async()=>{calls++;if(calls===1)await pending;return response(200,{updatedAt:'2026-11-02T00:00:00.000Z'})});
 c.edit(s=>s.posts[0].likes=2);const saving=c.flush();c.edit(s=>s.posts[0].likes=3);release();await saving;
 assert.equal(c.inspect().state.posts[0].likes,3);assert.equal(c.inspect().hasPendingChanges,true);
 await c.flush();assert.equal(c.inspect().hasPendingChanges,false);assert.equal(calls,2);
});
test('network failures retain pending changes and retry after reconnection',async()=>{
 let online=false;
 const {c,store}=client(seed,seed,async()=>{if(!online)throw Error('offline');return response(200,{updatedAt:'2026-11-02T00:00:00.000Z'})});
 c.edit(s=>s.posts[0].likes=8);await c.flush();assert.ok(store.has('pending'));assert.equal(c.inspect().hasPendingChanges,true);
 online=true;await c.flush();assert.equal(c.inspect().hasPendingChanges,false);assert.ok(!store.has('pending'));
});
test('409 merges independent edits and blocks conflicting edits without discarding pending work',async()=>{
 let remote=structuredClone(seed);remote.posts[0].headline='theirs';remote.updatedAt='2026-11-02T00:00:00.000Z';
 const {c,store}=client(seed,seed,async(url,o={})=>response(o.method==='PUT'?409:200,remote));
 c.edit(s=>s.posts[0].likes=5);await c.flush();assert.equal(c.inspect().syncConflict,false);assert.equal(c.inspect().state.posts[0].headline,'theirs');
 c.edit(s=>s.posts[0].headline='mine');remote.posts[0].headline='new theirs';await c.flush();
 assert.equal(c.inspect().syncConflict,true);assert.equal(c.inspect().state.posts[0].headline,'mine');assert.ok(store.has('pending'));
});

test('full browser storage cannot discard a server read or prevent saving and refreshing',async()=>{
 let shared=structuredClone(seed),writes=0;
 const {c,runTimer}=client(seed,seed,async(url,o={})=>{
  if(o.method==='PUT'){writes++;shared={...JSON.parse(o.body),updatedAt:'2026-11-03T00:00:00.000Z'};return response(200,{updatedAt:shared.updatedAt})}
  return response(200,shared);
 },true);
 // Exercise the exact initial-load path where a cache exception used to erase state.
 vm.runInContext(`${app.slice(app.indexOf('  async function loadState()'),app.indexOf('  function updateStorageStatus()'))}
 globalThis.load=loadState;`,c);
 await c.load();assert.equal(c.inspect().state.posts.length,1);assert.equal(c.inspect().localCacheUnavailable,true);
 c.edit(s=>s.posts[0].likes=7);assert.equal(c.inspect().pendingBackupUnavailable,true);
 await runTimer();await new Promise(resolve=>setImmediate(resolve));assert.equal(writes,1);assert.equal(shared.posts[0].likes,7);assert.equal(c.inspect().hasPendingChanges,false);
 shared.posts.push({id:'new-other-device'});shared.updatedAt='2026-11-04T00:00:00.000Z';await c.refresh();
 assert.equal(c.inspect().state.posts.length,2);assert.equal(c.inspect().syncConflict,false);
});

async function freePort(){const s=createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function serverFixture(env={}){
 const dir=await mkdtemp(join(tmpdir(),'content-ops-test-'));const port=await freePort();
 const child=spawn(process.execPath,['content-ops/server.js','--host','127.0.0.1','--port',String(port)],{cwd:new URL('..',import.meta.url),env:{...process.env,SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',CONTENT_OPS_DATA:join(dir,'state.json'),CONTENT_OPS_INITIAL_USERS:JSON.stringify([{username:'test-admin',name:'Admin',role:'admin',password:'Testing123'}]),...env},stdio:['ignore','pipe','pipe']});
 let errors='';child.stderr.on('data',x=>errors+=x);
 const url=`http://127.0.0.1:${port}`;
 for(let i=0;i<100;i++){try{if((await fetch(url+'/api/health')).ok){ const login=await rawFetch(url+'/api/content-ops/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test-admin',password:'Testing123'})});if(!login.ok)throw Error(await login.text());sessions.set(url,login.headers.get('set-cookie').split(';')[0]);return {url,close:async()=>{child.kill();await new Promise(r=>child.once('exit',r));await rm(dir,{recursive:true,force:true})}}} }catch{}await new Promise(r=>setTimeout(r,20));}
 child.kill();throw Error('Server failed: '+errors);
}
const put=(url,s,base)=>fetch(url+'/api/content-ops/state',{method:'PUT',headers:{'Content-Type':'application/json',...(base?{'If-Match':`"${base}"`}:{})},body:JSON.stringify(s)});
test('HTTP file store rejects legacy and stale writers, serializes racing writers, and returns complete data after writes',async()=>{
 const f=await serverFixture();try{
 const b=await (await fetch(f.url+'/api/content-ops/state')).json();
 assert.equal((await put(f.url,seed)).status,428);
 const results=await Promise.all([put(f.url,{...seed,titles:[{id:'a'}]},b.updatedAt),put(f.url,{...seed,titles:[{id:'b'}]},b.updatedAt)]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);
 const current=await (await fetch(f.url+'/api/content-ops/state')).json();assert.equal(current.titles.length,1);
 assert.equal((await put(f.url,seed,b.updatedAt)).status,409);
 assert.ok((await fetch(f.url+'/sync-core.js?v=20261104')).ok);
 }finally{await f.close()}
});

test('Supabase conditional update prevents races across two service instances and persists history',async()=>{
 let row={id:'default',state:{...structuredClone(seed),_access:await initialAccess([{username:'test-admin',name:'Admin',role:'admin',password:'Testing123'}])},updated_at:seed.updatedAt};const history=new Map();
 const mock=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET')return res.end(JSON.stringify([structuredClone(row)]));
  if(req.method==='POST'){history.set(body.id,body);return res.end('');}
  if(req.method==='PATCH'){
   if(url.searchParams.get('updated_at')!==`eq.${row.updated_at}`)return res.end('[]');
   row={...row,...body};return res.end(JSON.stringify([row]));
  }
  res.statusCode=500;res.end('{}');
 });await new Promise(r=>mock.listen(0,'127.0.0.1',r));
 const env={SUPABASE_URL:`http://127.0.0.1:${mock.address().port}`,SUPABASE_SERVICE_ROLE_KEY:'test-only'};
 const a=await serverFixture(env),b=await serverFixture(env);
 try{
 const responses=await Promise.all([put(a.url,{...seed,posts:[{id:'a',accountId:'account-2'}]},seed.updatedAt),put(b.url,{...seed,posts:[{id:'b',accountId:'account-2'}]},seed.updatedAt)]);
 assert.deepEqual(responses.map(x=>x.status).sort(),[200,409]);assert.equal(row.state.posts.length,1);
 assert.deepEqual(history.get('default-history-'+seed.updatedAt).state.posts,seed.posts);
 }finally{await a.close();await b.close();await new Promise(r=>mock.close(r))}
});

const api=(url,path,method='GET',payload,cookie)=>fetch(url+'/api/content-ops/'+path,{method,headers:{...(payload?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(payload?{body:JSON.stringify(payload)}:{})});
test('employee scope is enforced by the API and every saved edit has actor, device and before/after history',async()=>{
 const f=await serverFixture();try{
 assert.equal((await rawFetch(f.url+'/api/content-ops/state')).status,401);
 const base=await (await api(f.url,'state')).json();
 const initial={...seed,accounts:[{id:'account-2',name:'Studio'},{id:'private',name:'Private channel'}],posts:[...seed.posts,{id:'hidden',accountId:'private',headline:'Admin only'}]};
 assert.equal((await put(f.url,initial,base.updatedAt)).status,200);
 const userResult=await api(f.url,'users','POST',{username:'test-staff',name:'LB',password:'Staff123',role:'employee',accountIds:['account-2']});assert.equal(userResult.status,200);
 const login=await rawFetch(f.url+'/api/content-ops/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'test-staff',password:'Staff123'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];
 assert.match(login.headers.get('set-cookie'),/HttpOnly/);assert.match(login.headers.get('set-cookie'),/SameSite=Strict/);
 const staff=await (await api(f.url,'state','GET',null,cookie)).json();assert.equal(staff.posts.length,1);assert.equal(staff.accounts.length,1);assert.equal(staff._access,undefined);assert.equal(staff._audit,undefined);
 assert.equal((await api(f.url,'users','GET',null,cookie)).status,403);
 const malicious={...structuredClone(staff),posts:[{id:'hidden',accountId:'account-2',headline:'Take over'}]};
 const staffPut=s=>fetch(f.url+'/api/content-ops/state',{method:'PUT',headers:{Cookie:cookie,'Content-Type':'application/json','If-Match':`"${staff.updatedAt}"`,'User-Agent':'iPad test','X-Client-Id':'tablet-1'},body:JSON.stringify(s)});
 assert.equal((await staffPut(malicious)).status,403);
 const protectedAccount=structuredClone(staff);protectedAccount.accounts[0].name='Not allowed';assert.equal((await staffPut(protectedAccount)).status,403);
 staff.posts[0].scheduledAt='2026-12-01T20:30';staff._access={users:[{username:'intruder',role:'admin'}]};assert.equal((await staffPut(staff)).status,200);
 const admin=await (await api(f.url,'state')).json();assert.equal(admin.posts.find(p=>p.id==='hidden').headline,'Admin only');assert.equal(admin.posts.find(p=>p.id==='p1').scheduledAt,'2026-12-01T20:30');
 const history=await (await api(f.url,'history')).json(),event=history.items.find(e=>e.actor.username==='test-staff');
 assert.ok(event);assert.equal(event.device,'iPad/平板');assert.equal(event.clientId,'tablet-1');assert.deepEqual(event.entries[0].fields.scheduledAt,{before:null,after:'2026-12-01T20:30'});
 const scopedHistory=await (await api(f.url,'history','GET',null,cookie)).json();assert.ok(scopedHistory.items.every(e=>e.entries.every(r=>r.accountId==='account-2')));
 const raw=JSON.stringify(history);assert.ok(!raw.includes('passwordHash'));assert.ok(!raw.includes('sessionSecret'));
 const users=await (await api(f.url,'users')).json();const employee=users.users.find(u=>u.username==='test-staff');
 const change=await api(f.url,'users','POST',{...employee,password:'Staff456',accountIds:['private']});assert.equal(change.status,200);
 assert.equal((await api(f.url,'state','GET',null,cookie)).status,401);
 assert.equal((await fetch(f.url+'/api/content-ops/state',{headers:{Origin:'https://attacker.invalid'}})).status,403);
 }finally{await f.close()}
});
test('last administrator cannot be disabled and stale full-page clients cannot erase history or credentials',async()=>{
 const f=await serverFixture();try{
 const users=await (await api(f.url,'users')).json();const admin=users.users[0];
 assert.equal((await api(f.url,'users','POST',{...admin,disabled:true,accountIds:[]})).status,400);
 const b=await (await api(f.url,'state')).json();assert.equal((await put(f.url,seed,b.updatedAt)).status,200);
 const before=await (await api(f.url,'history')).json();const current=await (await api(f.url,'state')).json();
 assert.equal((await put(f.url,{...current,_access:{},_audit:[]},current.updatedAt)).status,200);
 const after=await (await api(f.url,'history')).json();assert.equal(after.items.length,before.items.length);
 assert.equal((await api(f.url,'users')).status,200);
 assert.equal((await api(f.url,'logout','POST',{})).status,200);
 }finally{await f.close()}
});
test('a response started under the previous login cannot replace the next user session',async()=>{
 let release;const wait=new Promise(r=>release=r);
 const {c}=client(seed,seed,async()=>{await wait;return response(200,{updatedAt:'2026-11-02T00:00:00.000Z'})});
 vm.runInContext(`globalThis.switchSession=()=>{sessionEpoch++;state={posts:[{id:'next-user'}]};hasPendingChanges=false;saveInFlight=false}`,c);
 c.edit(s=>s.posts[0].likes=2);const saving=c.flush();c.switchSession();release();await saving;
 assert.equal(c.inspect().state.posts[0].id,'next-user');assert.equal(c.inspect().hasPendingChanges,false);
});

test('one-time production bootstrap preserves every business record and refuses to overwrite existing users',async()=>{
 let row={id:'default',state:structuredClone(seed),updated_at:seed.updatedAt};const archived=[];
 const db=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost');let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET')return res.end(JSON.stringify([row]));
  if(req.method==='POST'){archived.push(body);return res.end('');}
  if(req.method==='PATCH'){if(u.searchParams.get('updated_at')!==`eq.${row.updated_at}`)return res.end('[]');row={...row,...body};return res.end(JSON.stringify([row]));}
  res.statusCode=500;res.end('{}');
 });await new Promise(r=>db.listen(0,'127.0.0.1',r));
 const run=()=>new Promise(resolve=>{
  const child=spawn(process.execPath,['scripts/bootstrap-access.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,SUPABASE_URL:`http://127.0.0.1:${db.address().port}`,SUPABASE_SERVICE_ROLE_KEY:'test-only'},stdio:['pipe','pipe','pipe']});
  let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.stdin.end(JSON.stringify([{username:'test-admin',name:'Admin',password:'Testing123',role:'admin'}]));child.on('exit',code=>resolve({code,out,err}));
 });
 try{
  const result=await run();assert.equal(result.code,0,result.err);assert.deepEqual(row.state.posts,seed.posts);assert.deepEqual(row.state.accounts,seed.accounts);assert.equal(archived.length,1);assert.deepEqual(archived[0].state,seed);assert.equal(row.state._access.users.length,1);assert.ok(!JSON.stringify(row.state).includes('Testing123'));
  const again=await run();assert.notEqual(again.code,0);assert.equal(archived.length,1);
 }finally{await new Promise(r=>db.close(r))}
});
