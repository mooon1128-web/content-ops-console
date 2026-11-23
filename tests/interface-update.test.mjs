import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/xhs-media/interface-update.js',import.meta.url),'utf8');
function harness(){
  const ctx=vm.createContext({AbortSignal,URL});vm.runInContext(source,ctx);
  let remote='v1',blocked='',fail=false,release;const requests=[],reports=[],reloads=[],events=new Map();
  const document={hidden:false,addEventListener:(k,v)=>events.set(k,v),removeEventListener:k=>events.delete(k)};
  const window={...document,setInterval:fn=>{events.set('interval',fn);return 1},clearInterval:()=>events.delete('interval')};
  const w=ctx.InterfaceUpdate.createWatcher({current:'v1',url:'/api/xhs-media/version',window,document,
    fetch:async(url,options)=>{requests.push({url,options});if(release)await release;if(fail)throw Error('offline');return {ok:true,json:async()=>({uiVersion:remote,build:'unrelated-stock-change'})}},
    getBlockReason:()=>blocked,report:s=>reports.push(s),reload:v=>reloads.push(v)});
  return {w,requests,reports,reloads,events,document,remote:v=>remote=v,block:v=>blocked=v,fail:v=>fail=v,delay:v=>release=v};
}
test('checks actual UI version independently of data revisions and never auto-refreshes',async()=>{
  const f=harness();await f.w.check();assert.equal(f.w.state().outdated,false);
  f.remote('v2');await f.w.check();assert.equal(f.w.state().outdated,true);assert.deepEqual(f.reloads,[]);
  assert.equal(f.requests[0].options.cache,'no-store');assert.equal(f.requests[0].options.method,undefined);
  assert.equal(f.w.update(),true);assert.deepEqual(f.reloads,['v2']);
});
test('an open editor, pending save, conflict or expired login blocks update at click time',async()=>{
  const f=harness();f.remote('v2');await f.w.check();
  for(const reason of ['未保存表单','同步中','冲突','登录失效']){f.block(reason);assert.equal(f.w.update(),false);assert.equal(f.reports.at(-1).blocked,reason);}
  assert.deepEqual(f.reloads,[]);f.block('');assert.equal(f.w.update(),true);
});
test('network failure never clears a known update, changes records or starts a reload',async()=>{
  const f=harness();f.remote('v2');await f.w.check();f.fail(true);assert.equal(await f.w.check(),false);
  assert.equal(f.w.state().outdated,true);assert.match(f.w.state().error,/暂未完成/);assert.deepEqual(f.reloads,[]);
});
test('check coalesces overlapping requests and checks again when returning to a long-lived tab',async()=>{
  const f=harness();let resume;f.delay(new Promise(r=>resume=r));const pending=f.w.check();
  assert.equal(await f.w.check(),false);assert.equal(f.requests.length,1);resume();await pending;f.delay(null);
  f.w.start();await new Promise(r=>setImmediate(r));const initial=f.requests.length;
  f.remote('v2');await f.events.get('focus')();assert.equal(f.requests.length,initial+1);assert.equal(f.w.state().outdated,true);
  f.document.hidden=true;f.events.get('visibilitychange')();assert.equal(f.requests.length,initial+1);
  f.w.stop();assert.equal(f.events.size,0);assert.equal(await f.w.check(),false);assert.equal(f.w.update(),false);
});
test('server and client use the same interface version, and the helper loads before app startup',async()=>{
  const [server,app,html]=await Promise.all(['../content-ops/server.js','../public/xhs-media/app.js','../public/xhs-media/index.html'].map(p=>readFile(new URL(p,import.meta.url),'utf8')));
  const version=server.match(/const XHS_UI_VERSION='([^']+)'/)[1];
  assert.ok(app.includes("current:'"+version+"'"));assert.ok(html.includes('interface-update.js?v='+version));
  assert.ok(html.indexOf('interface-update.js?v=')<html.indexOf('app.js?v='));
  assert.match(server,/uiVersion:XHS_UI_VERSION/);assert.match(app,/hasPendingLocalSync\(\)\|\|hasOpenEditorDialog\(\)/);
});
test('visible update controls protect an open form and only navigate after it is saved or cancelled',async()=>{
  const ctx=vm.createContext({AbortSignal,URL});vm.runInContext(source,ctx);
  const element=()=>({dataset:{},style:{},children:[],setAttribute(){},append(...v){this.children.push(...v)},prepend(v){this.children.unshift(v)}});
  const host=element(),dialog=element(),navigations=[];let editing=true;
  const doc={createElement:element,querySelectorAll:()=>[dialog],addEventListener(){},removeEventListener(){}};
  const win={addEventListener(){},removeEventListener(){},setInterval(){},clearInterval(){},location:{href:'https://example.invalid/xhs-media/?filter=active',replace:v=>navigations.push(v)},fetch:async()=>({ok:true,json:async()=>({uiVersion:'v2'})})};
  const watcher=ctx.InterfaceUpdate.mount({document:doc,window:win,host,current:'v1',url:'/api/xhs-media/version',getBlockReason:()=>editing?'请先保存或取消表单':''});
  await new Promise(r=>setImmediate(r));
  const [label,button]=host.children[0].children;
  assert.match(label.textContent,/发现新版/);assert.equal(dialog.children[0].hidden,false);assert.equal(button.textContent,'更新界面');
  button.onclick();assert.equal(navigations.length,0);assert.equal(dialog.children.length,1);
  editing=false;button.onclick();assert.equal(navigations[0],'https://example.invalid/xhs-media/?filter=active&ui=v2');watcher.stop();
});
