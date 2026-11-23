// Request metadata only; contract bytes and private form values never go into web storage.
export function createCommandClient({request,getState,refresh,userId,storage,progress=()=>{}}){
  const pending=new Map();
  async function send(action,data){
    const bytes=new TextEncoder().encode(JSON.stringify({user:userId(),action,data}));
    const identity=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    const storageKey='stock-pending-v2-'+identity;
    let saved;try{saved=JSON.parse(storage?.getItem(storageKey)||'null');}catch{}
    const record=pending.get(identity)||saved||{requestId:crypto.randomUUID(),revision:getState().revision};
    pending.set(identity,record);try{storage?.setItem(storageKey,JSON.stringify(record));}catch{}
    const clear=()=>{pending.delete(identity);try{storage?.removeItem(storageKey);}catch{}};
    const receipt=()=>request('/api/stock-ops/command-status?requestId='+encodeURIComponent(record.requestId));
    for(let attempt=0;attempt<2;attempt++){
      progress(attempt?'正在核对并重试同一次保存…':'正在保存补货与业务记录…');
      try{
        const result=await request('/api/stock-ops/command?receipt=1',{method:'POST',body:JSON.stringify({action,data,...record}),signal:AbortSignal.timeout(120000)});
        clear();return result;
      }catch(error){
        if(error.status&&error.status<500&&error.status!==409){clear();throw error;}
        progress('正在向服务器确认是否已保存，请勿重复登记…');
        let status;try{status=await receipt();}catch{}
        if(status?.committed){clear();return {ok:true,replayed:true,...status};}
        if(error.status===409){
          await refresh(false);
          // New batch creation is append-only and has a SKU + reference uniqueness
          // guard. Existing-row updates must never silently overwrite another edit.
          if(error.code==='REVISION_CONFLICT'&&action==='purchase'&&!attempt){
            record.revision=getState().revision;try{storage?.setItem(storageKey,JSON.stringify(record));}catch{}
            continue;
          }
          clear();throw error;
        }
        if(attempt)throw Error('暂未确认保存结果，填写内容已保留。请再次点保存继续核对同一请求，不要新建重复批次。');
      }
    }
  }
  return {send,pending};
}

export function acceptNewerState(current,incoming){
  return current&&Number(incoming.revision)<Number(current.revision)?current:incoming;
}

export function uploadContract(file,onProgress,{xhrFactory=()=>new XMLHttpRequest()}={}){
  return new Promise((resolve,reject)=>{
    const xhr=xhrFactory();xhr.open('POST','/api/stock-ops/purchase-contract?name='+encodeURIComponent(file.name));
    xhr.setRequestHeader('Content-Type',file.type||'application/octet-stream');xhr.timeout=60000;
    xhr.upload.onprogress=e=>onProgress(e.lengthComputable?Math.round(e.loaded/e.total*100):null);
    xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{return reject(Error('合同上传响应异常，原表单已保留，请重试'));}
      if(xhr.status<200||xhr.status>=300)return reject(Error(result.error||'合同上传失败，原表单已保留'));
      onProgress(100);resolve(result);
    };
    xhr.onerror=()=>reject(Error('合同上传连接中断，原表单已保留，请重试'));
    xhr.ontimeout=()=>reject(Error('合同上传超过60秒，原表单已保留；再次保存会核对同一图片，避免重复上传'));
    xhr.onabort=()=>reject(Error('合同上传已中断，原表单已保留'));
    xhr.send(file);
  });
}
