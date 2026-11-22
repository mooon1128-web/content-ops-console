(function(root){
  'use strict';
  function journal(key){
    let dbPromise;
    const db=()=>dbPromise??=new Promise((resolve,reject)=>{try{const r=indexedDB.open('pupuhome-shared-outbox-v3',1);r.onupgradeneeded=()=>r.result.createObjectStore('outbox');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}catch(e){reject(e);}});
    const op=async(method,value)=>{const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('outbox',method==='get'?'readonly':'readwrite'),store=t.objectStore('outbox');const r=method==='put'?store.put(value,key):store[method](key);t.oncomplete=()=>resolve(r.result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error);});};
    return {read:()=>op('get'),write:value=>op('put',value),clear:()=>op('delete')};
  }
  class SharedSync{
    constructor(o){Object.assign(this,o);this.base=null;this.pending=false;this.conflict=false;this.online=false;this.ready=false;this.storageOK=true;this.writer=Promise.resolve();this.journal=o.journal||journal(o.key);this.version=0;this.stopped=false;}
    async request(path,options={}){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(20000),...options});if(r.status===401){this.stopped=true;this.authExpired?.();}let result;try{result=await r.json()}catch{throw Error('服务返回异常，请稍后重试')}if(!r.ok)throw Object.assign(Error(result.error||'同步失败'),{status:r.status});return result;}
    report(message){this.status({message,online:this.online,pending:this.pending,conflict:this.conflict,ready:this.ready,storageOK:this.storageOK,updatedAt:this.base?.updatedAt});}
    ops(){return this.base?RecordOps.diff(this.base,this.read(),this.shape):[];}
    persist(){
      if(this.conflict)return this.writer;
      let operations;try{operations=this.ops()}catch(e){this.conflict=true;this.report(e.message);return this.writer;}
      const record={operations,at:new Date().toISOString()};
      this.writer=this.writer.catch(()=>{}).then(()=>operations.length?this.journal.write(record):this.journal.clear()).then(()=>{this.storageOK=true},()=>{this.storageOK=false;this.report()});return this.writer;
    }
    async start(){
      try{
        const remote=await this.request(this.url);this.base=structuredClone(remote);this.online=true;
        let saved;try{saved=await this.journal.read()}catch{this.storageOK=false;}
        if(saved?.operations?.length){
          try{const restored=RecordOps.apply(remote,saved.operations,this.shape);this.write(restored);this.pending=this.ops().length>0;}
          catch(e){this.recovery=saved;this.conflict=true;this.write(remote);this.report(e.message);}
        }else this.write(remote);
        this.ready=true;this.render();this.report();if(this.pending&&!this.conflict)this.schedule(0);
      }catch(e){this.online=false;this.report(e.message);}
      if(!this.stopped)this.timer=setTimeout(()=>this.refresh(),12000);
      return this.ready;
    }
    changed(){
      if(!this.ready||this.conflict||this.stopped){this.report('当前无法提交，请先完成登录或处理同步冲突');return false;}
      this.version++;this.pending=true;this.persist();this.report();this.schedule(300);return true;
    }
    schedule(delay=300){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>{this.saveTimer=null;this.flush()},delay);}
    async flush(){
      clearTimeout(this.saveTimer);this.saveTimer=null;
      if(this.saving)return this.saving;
      if(!this.ready||this.conflict||this.stopped)return false;
      if(!this.pending)return true;
      let snapshot,operations;try{snapshot=structuredClone(this.read());operations=RecordOps.diff(this.base,snapshot,this.shape);}catch(e){this.conflict=true;this.report(e.message);return false;}
      if(!operations.length){this.pending=false;await this.persist();this.report();return true;}
      this.saving=(async()=>{
        let retry=false;
        const command=this.retryCommand||{requestId:crypto.randomUUID(),operations};
        const sentSnapshot=this.retrySnapshot||snapshot;
        this.retryCommand=command;this.retrySnapshot=sentSnapshot;
        try{
          await this.writer;
          const result=await this.request(this.url,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(command)});
          const remote=result.state;
          // Preserve edits made while the server was saving, then rebase only those edits.
          const later=RecordOps.diff(sentSnapshot,this.read(),this.shape);
          let merged;try{merged=RecordOps.apply(remote,later,this.shape)}catch(e){this.base=structuredClone(remote);this.retryCommand=null;this.retrySnapshot=null;this.recovery={operations:later};this.conflict=true;try{await this.journal.write(this.recovery)}catch{this.storageOK=false}this.report(e.message);return false;}
          this.base=structuredClone(remote);this.write(merged);this.retryCommand=null;this.retrySnapshot=null;
          this.pending=this.ops().length>0;this.online=true;await this.persist();
          if(!this.busy?.())this.render();retry=this.pending;this.report();return !this.pending;
        }catch(e){
          if([403,409,422,428].includes(e.status)){this.conflict=true;this.recovery={operations:this.ops()};try{await this.journal.write(this.recovery)}catch{this.storageOK=false}this.report(e.message);}
          else{this.online=false;retry=!this.stopped;this.report(e.message);}return false;
        }finally{this.saving=null;if(retry&&!this.conflict)this.schedule(this.online?300:5000);}
      })();
      return this.saving;
    }
    async refresh(){
      clearTimeout(this.timer);
      if(this.stopped)return false;
      if(!this.ready){await this.start();return this.ready;}
      try{
        if(this.pending){if(!this.conflict)await this.flush();return !this.pending;}
        if(this.saving||this.conflict||this.busy?.())return false;
        const version=await this.request(this.versionUrl);
        if(version.updatedAt!==this.base?.updatedAt){
          const remote=await this.request(this.url);
          // A user may start an edit while either network read is in flight.
          if(this.pending||this.saving||this.busy?.())return false;
          this.base=structuredClone(remote);this.write(remote);this.render();
        }
        this.online=true;this.report();return true;
      }catch(e){this.online=false;this.report(e.message);return false;}
      finally{if(!this.stopped)this.timer=setTimeout(()=>this.refresh(),document.hidden?30000:10000);}
    }
    exportPending(){return {source:this.url,baseVersion:this.base?.updatedAt,operations:this.recovery?.operations||this.ops(),at:new Date().toISOString()};}
    async discardAfterExport(){await this.journal.clear();this.pending=false;this.conflict=false;this.retryCommand=null;this.retrySnapshot=null;this.recovery=null;this.ready=false;clearTimeout(this.timer);return this.start();}
    stop(){this.stopped=true;clearTimeout(this.timer);clearTimeout(this.saveTimer);}
  }
  root.SharedSync=SharedSync;
})(globalThis);
