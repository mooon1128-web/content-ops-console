let query='',page=0,onlyMissing=false;
export function renderCatalog(api){
  const {state,can,$,escape,num,textDate,heading,button,table,pill,showEditor,command,bind,bindAll,csv,render,skuLabel}=api;
  const latest=new Map();
  for(const r of state.erpInventory||[]){const key=r.skuId+'|'+r.warehouse;const old=latest.get(key);if(!old||r.at>old.at)latest.set(key,r);}
  const all=[...latest.values()];
  const reviews=state.catalogReviews||[],links=state.platformMappings||[];
  const filtered=state.skus.filter(k=>!query||[k.code,k.name,k.spec,k.erpSkuId,k.erpProductCode,k.erpName,k.erpSpec,k.barcode,k.erpBarcode].join(' ').toLowerCase().includes(query.toLowerCase())).filter(k=>!onlyMissing||reviews.some(r=>r.skuId===k.id&&r.status==='待核'));
  const size=40;page=Math.max(0,Math.min(page,Math.ceil(filtered.length/size)-1));
  const visible=filtered.slice(page*size,(page+1)*size),lastBatch=(state.catalogImports||[]).at(-1);
  $('#content').innerHTML=heading('ERP库存与平台对应','保留来源时点的账面库存，与仓库实盘和你登记的可售参考分别记录。',`${button('erp-export','导出当前查询 CSV')}${can()?button('catalog-upload','导入补充资料',true):''}`)+
    `<p class="hint">库存来源：${all.length?textDate(all.reduce((a,b)=>a.at>b.at?a:b).at):'尚未导入'}。这里不是实时ERP连接，也不代表实物盘点；负数保留原值供核查。导入不会修改原月销售、实盘、库存流水或可售参考。</p>`+
    `<div class="metrics"><div class="metric"><span>统一SKU档案</span><strong>${state.skus.length}</strong></div><div class="metric"><span>ERP库存记录</span><strong>${all.filter(r=>r.book!==null).length}</strong><small>另有 ${all.filter(r=>r.book===null).length} 条数量待补</small></div><div class="metric"><span>平台规格对应</span><strong>${links.length}</strong><small>历史证据匹配，需关注新链接和规格变化</small></div><div class="metric"><span>档案资料待补</span><strong>${new Set(reviews.filter(r=>r.status==='待核').map(r=>r.skuId)).size}</strong></div></div>`+
    `<div class="filterbar"><label>名称、规格、条码或编码<input id="erp-search" value="${escape(query)}" placeholder="例如：笔袋"></label><button id="erp-find">查询</button><label class="check-label"><input type="checkbox" id="erp-missing" ${onlyMissing?'checked':''}>只看资料待补</label></div>`+
    `<div class="card">${table(['款式 / 规格','ERP编码 / 条码','来源仓库 / 时点','账面库存','占用','预估可销售','淘宝 / 小红书对应','资料状态',''],visible.map(k=>{
      const rows=all.filter(r=>r.skuId===k.id),r=rows.length===1?rows[0]:null,m=links.filter(l=>l.skuId===k.id),rv=reviews.filter(x=>x.skuId===k.id);
      return [`<b>${escape(k.name)}</b><small class="special-wrap">${escape(k.erpSpec||k.spec||'规格待补')}</small>`,`${escape(k.erpProductCode||'待补')}<small>${escape(k.erpSkuId||'SKUID待补')}</small><small>${escape(k.erpBarcode||k.barcode||'条码待补')}</small>`,r?`${escape(r.warehouse)}<small>${textDate(r.at)}</small>`:rows.length?`${rows.length}个仓库，查看详情`:'待补',num(r?.book),num(r?.occupied),num(r?.available),`${m.filter(x=>x.platform==='淘宝').length} / ${m.filter(x=>x.platform==='小红书').length}`,rv.length?pill('有待补资料','warn'):pill('未列待核'),`<button data-catalog="${k.id}">查看来源与对应</button>`];
    }))}<div class="actions"><button id="erp-prev" ${page===0?'disabled':''}>上一页</button><span>${filtered.length?`${page*size+1}—${Math.min((page+1)*size,filtered.length)}`:'0'} / ${filtered.length}条</span><button id="erp-next" ${(page+1)*size>=filtered.length?'disabled':''}>下一页</button></div></div>`+
    `<div class="card"><h2>导入批次</h2>${table(['批次 / 来源','导入时间','新增 / 补空白字段','库存 / 对应','保留冲突'],(state.catalogImports||[]).slice().reverse().map(b=>[`${escape(b.title)}<small>${escape(b.note)}</small><details><summary>原始文件与校验码</summary><pre>${escape(JSON.stringify(b.sources,null,2))}</pre></details>`,textDate(b.at),`${b.summary.addedSkus} / ${b.summary.filledFields}`,`${b.summary.inventoryRows} / ${b.summary.addedMappings}`,num(b.summary.preservedConflicts)]))}</div>`;
  bind('erp-find',()=>{query=$('#erp-search').value;page=0;render()});
  $('#erp-search').onkeydown=e=>{if(e.key==='Enter'){$('#erp-find').click();}};
  $('#erp-missing').onchange=e=>{onlyMissing=e.target.checked;page=0;render()};
  bind('erp-prev',()=>{page--;render()});bind('erp-next',()=>{page++;render()});
  bindAll('[data-catalog]',el=>{
    const k=state.skus.find(x=>x.id===el.dataset.catalog),rr=all.filter(r=>r.skuId===k.id),mm=links.filter(m=>m.skuId===k.id),rv=reviews.filter(r=>r.skuId===k.id),obs=state.observations.filter(o=>o.skuId===k.id);
    showEditor(`${k.name} · 档案与来源`,`<div class="wide special-detail"><p>统一编码 ${escape(k.code)}；ERP ${escape(k.erpProductCode||'待补')} / ${escape(k.erpSkuId||'SKUID待补')}</p><p>ERP原名 ${escape(k.erpName||'待补')}；原规格 ${escape(k.erpSpec||'待补')}；原条码 ${escape(k.erpBarcode||'待补')}；启停用状态 ${escape(k.erpStatus||'待核')}</p>${table(['仓库','数据时间','账面','占用','预估可销售','来源'],rr.map(r=>[escape(r.warehouse),textDate(r.at),num(r.book),num(r.occupied),num(r.available),`<div class="special-wrap">${escape(r.source)}<small>${escape(r.note)}</small></div>`]))}<h3>原有可售参考（保留原记录）</h3>${table(['日期','数量','来源'],obs.map(o=>[escape(o.date),num(o.available),`<div class="special-wrap">${escape(o.source)}</div>`]))}<h3>平台规格对应</h3>${table(['平台 / 商品ID','规格ID / 规格','匹配依据'],mm.map(m=>[`${escape(m.platform)}<small>${escape(m.itemId)}</small>`,`${escape(m.platformSkuId)}<small class="special-wrap">${escape(m.spec)}</small>`,`<div class="special-wrap">${escape(m.status)}，${num(m.evidenceCount)}条证据<details><summary>查看证据</summary><pre>${escape(JSON.stringify(m.evidence,null,2))}</pre></details></div>`]))}${can()?`<h3>成本档案</h3><p>${escape(k.costSkuId||'待匹配')}<br>${escape(k.costLinkStatus||'没有确认关联；未知成本不是0元。')}</p>`:''}<h3>缺失与冲突</h3>${rv.map(r=>`<p>${escape(r.detail)}</p><small>${escape(r.source)}</small>`).join('')||'<p>尚无待核说明。</p>'}</div>`,async()=>{});
    $('#save-editor').textContent='关闭';
  });
  bind('erp-export',()=>csv('ERP库存与SKU对应',['统一编码','名称','ERP商品编号','ERP_SKUID','ERP规格','ERP条码','来源仓库','库存时点','账面库存','占用','预估可销售','淘宝对应数','小红书对应数','待补说明'],filtered.flatMap(k=>{
    const rr=all.filter(r=>r.skuId===k.id),m=links.filter(x=>x.skuId===k.id),details=reviews.filter(x=>x.skuId===k.id).map(x=>x.detail).join('；');
    return (rr.length?rr:[{}]).map(r=>[k.code,k.name,k.erpProductCode,k.erpSkuId,k.erpSpec,k.erpBarcode,r.warehouse,r.at,r.book,r.occupied,r.available,m.filter(x=>x.platform==='淘宝').length,m.filter(x=>x.platform==='小红书').length,details]);
  })));
  bind('catalog-upload',()=>{
    let payload=null,requestId=crypto.randomUUID();
    showEditor('补充ERP档案与库存资料','<label class="wide">选择整理后的补充资料 JSON<input id="catalog-file" type="file" accept=".json,application/json"></label><div class="wide" id="catalog-preview"><p>先选择资料，查看范围后提交。只补空白字段，已有非空字段冲突时保留原值并记待核。</p></div>',async()=>{if(!payload)throw Error('请先选择并检查导入文件');await command('catalogImport',payload,requestId);},'库存按来源时间追加，不作为实盘，也不覆盖原有可售参考。');
    $('#catalog-file').onchange=async e=>{payload=null;try{const candidate=JSON.parse(await e.target.files[0].text());if(!candidate.id||!Array.isArray(candidate.skus)||!Array.isArray(candidate.inventory)||!Array.isArray(candidate.mappings)||!Array.isArray(candidate.issues)||!candidate.sources?.length)throw Error('请选择ERP补充资料包');payload=candidate;$('#catalog-preview').innerHTML=`<p>${escape(candidate.title)}</p><p>档案 ${candidate.skus.length} 条；库存来源记录 ${candidate.inventory.length} 条；平台对应 ${candidate.mappings.length} 条；待核说明 ${candidate.issues.length} 条。</p><p>${escape(candidate.note)}</p><details><summary>查看来源文件</summary><pre>${escape(JSON.stringify(candidate.sources,null,2))}</pre></details>`;}catch(err){$('#catalog-preview').textContent=err.message;}};
  });
}
