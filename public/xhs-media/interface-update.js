(function(root){
  'use strict';
  function createWatcher(o) {
    let latest=o.current, checking=false, checked=false, error='', stopped=false, timer;
    const state=()=>({current:o.current,latest,outdated:latest!==o.current,checking,checked,error,blocked:o.getBlockReason()});
    const report=()=>o.report(state());
    async function check(){
      if(checking||stopped)return false;
      checking=true;error='';report();
      try {
        const response=await o.fetch(o.url,{cache:'no-store',signal:AbortSignal.timeout(15000)});
        if(!response.ok)throw Error('暂时无法检查界面版本');
        const data=await response.json();
        if(typeof data.uiVersion!=='string'||!data.uiVersion)throw Error('暂时无法确认界面版本');
        latest=data.uiVersion;checked=true;return true;
      }catch(e){error='版本检查暂未完成，请稍后重试';return false;}
      finally{checking=false;if(!stopped)report();}
    }
    function update(){
      // Always recheck at the click: an edit or cloud save may have started since the last poll.
      if(stopped||latest===o.current)return false;
      if(o.getBlockReason()){report();return false;}
      o.reload(latest);return true;
    }
    const onFocus=()=>check();
    const onVisibility=()=>{if(!o.document.hidden)check();};
    return {check,update,state,start(){
      report();check();timer=o.window.setInterval(check,60000);
      o.window.addEventListener('focus',onFocus);o.window.addEventListener('pageshow',onFocus);
      o.document.addEventListener('visibilitychange',onVisibility);
    },stop(){stopped=true;o.window.clearInterval(timer);o.window.removeEventListener('focus',onFocus);o.window.removeEventListener('pageshow',onFocus);o.document.removeEventListener('visibilitychange',onVisibility);}};
  }
  function mount(o) {
    const doc=o.document||document, win=o.window||window;
    const panels=[o.host,...doc.querySelectorAll('dialog')].map((host,index)=>{
      const panel=doc.createElement('div');panel.dataset.appUpdate='';panel.setAttribute('role','status');
      panel.style.cssText=index?'position:sticky;top:0;z-index:10;padding:12px;background:#fff4ce;color:#49370b;border:1px solid #d9ad36;border-radius:10px;margin-bottom:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap':'display:flex;gap:8px;align-items:center;flex-wrap:wrap';
      const label=doc.createElement('span'),button=doc.createElement('button');button.type='button';button.className='secondary-button small';
      panel.append(label,button);host.prepend(panel);return {panel,label,button,dialog:index>0};
    });
    const watcher=createWatcher({...o,document:doc,window:win,fetch:o.fetch||win.fetch.bind(win),reload:latest=>{
      const next=new URL(win.location.href);next.searchParams.set('ui',latest);win.location.replace(next.href);
    },report:s=>{
      for(const p of panels){
        p.panel.hidden=p.dialog&&!s.outdated;
        if(p.panel.hidden)p.panel.style.display='none';else p.panel.style.display='flex';
        p.label.textContent=s.outdated?'发现新版合作登记界面。'+(s.blocked||'可更新界面，云端记录会保留。'):
          s.error|| (s.checking?'正在检查界面版本…':s.checked?'合作登记界面已是最新版':'合作登记界面 · 支持版本检查');
        p.button.textContent=s.outdated?'更新界面':'检查界面更新';p.button.disabled=s.checking;
        p.button.onclick=()=>s.outdated?watcher.update():watcher.check();
      }
    }});
    watcher.start();return watcher;
  }
  root.InterfaceUpdate={createWatcher,mount};
})(globalThis);
