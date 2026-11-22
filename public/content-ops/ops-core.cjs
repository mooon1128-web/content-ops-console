(function(root){
  'use strict';
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const safe=k=>typeof k==='string'&&k.length>0&&!['__proto__','prototype','constructor'].includes(k);
  const slot=(o,k)=>own(o,k)?{exists:true,value:o[k]}:{exists:false};
  const bad=(message,status=400)=>Object.assign(new Error(message),{status});
  function index(rows){const m=new Map();for(const r of rows||[]){if(!r||!safe(r.id)||m.has(r.id))throw bad('存在缺失或重复的记录编号，请先核对数据');m.set(r.id,r);}return m;}
  // Send only the changed records/fields, including their exact baseline values.
  function diff(base,next,shape){
    const ops=[];
    for(const [group,kind] of Object.entries(shape)){
      if(kind==='rows'){
        const b=index(base[group]),n=index(next[group]);
        for(const id of new Set([...b.keys(),...n.keys()])){
          const before=b.get(id),after=n.get(id);
          if(!before||!after){ops.push({group,id,kind:before?'remove':'add',before:before||null,after:after||null});continue;}
          for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
            if(key==='id'||key==='updatedAt'||key==='clientUpdatedAt')continue;
            const a=slot(before,key),z=slot(after,key);if(!same(a,z))ops.push({group,id,key,kind:'field',before:a,after:z});
          }
        }
      }else if(kind==='map'){
        const b=base[group]||{},n=next[group]||{};
        for(const key of new Set([...Object.keys(b),...Object.keys(n)]))if(!same(slot(b,key),slot(n,key)))ops.push({group,key,kind:'map',before:slot(b,key),after:slot(n,key)});
      }else if(!same(base[group],next[group]))ops.push({group,kind:'value',before:slot(base,group),after:slot(next,group)});
    }
    return ops;
  }
  function apply(current,ops,shape,now){
    if(!Array.isArray(ops)||ops.length>10000)throw bad('单次更改过多，请分批提交');
    const next=structuredClone(current),indexes={};
    for(const [key,kind] of Object.entries(shape))if(kind==='rows')indexes[key]=index(next[key]);
    const seen=new Set();
    for(const o of ops){
      if(!o||!own(shape,o.group)||!safe(o.group)||o.key!==undefined&&!safe(o.key))throw bad('更改字段不合法');
      const tag=JSON.stringify([o.group,o.id,o.key]);if(seen.has(tag))throw bad('同一字段重复提交');seen.add(tag);
      const conflict=()=>{throw bad(`其他同事已修改同一条数据：${o.group}/${o.id||''}/${o.key||''}。本次未覆盖，请核对双方版本`,409);};
      const set=(obj,key)=>{const value=slot(obj,key);if(!same(value,o.before)&&!same(value,o.after))conflict();if(o.after?.exists)obj[key]=structuredClone(o.after.value);else delete obj[key];};
      if(shape[o.group]==='rows'){
        if(!safe(o.id))throw bad('记录编号不合法');
        const map=indexes[o.group],row=map.get(o.id);
        if(o.kind==='add'){
          if(!o.after||o.after.id!==o.id||o.before!==null)throw bad('新增记录格式不正确');
          if(row&&!same(row,o.after))conflict();if(!row){const copy=structuredClone(o.after);next[o.group].push(copy);map.set(o.id,copy);}
        }else if(o.kind==='remove'){
          if(o.after!==null)throw bad('删除格式不正确');if(row&&!same(row,o.before))conflict();
          next[o.group]=next[o.group].filter(r=>r.id!==o.id);map.delete(o.id);
        }else if(o.kind==='field'){
          if(['id','updatedAt','clientUpdatedAt'].includes(o.key)||!o.key)throw bad('不能直接修改记录编号或版本');
          if(!row)conflict();set(row,o.key);if(now)row.updatedAt=now;
        }else throw bad('更改类型不合法');
      }else if(shape[o.group]==='map'&&o.kind==='map'){
        if(!o.key)throw bad('缺少映射编号');next[o.group]??={};set(next[o.group],o.key);
      }else if(shape[o.group]==='value'&&o.kind==='value')set(next,o.group);
      else throw bad('更改类型不匹配');
    }
    return next;
  }
  const api={diff,apply,same};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.RecordOps=api;
})(typeof globalThis==='undefined'?this:globalThis);
