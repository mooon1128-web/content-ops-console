(function(root){
  'use strict';
  const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function open(a,productId=''){
    let dialog=document.querySelector('#promotion-catalog-dialog');
    if(!dialog){dialog=document.createElement('dialog');dialog.id='promotion-catalog-dialog';dialog.className='promotion-catalog-dialog';document.body.append(dialog);}
    const catalog=a.catalog(),base=catalog.filter(p=>!p.promotionOnly),extras=catalog.filter(p=>p.promotionOnly);
    const categories=[...new Set(base.flatMap(root.PromotionData.productCategories))].sort();
    const list=()=>{
      dialog.innerHTML=`<div class="catalog-dialog-head"><div><h2>商品与套餐 SKU</h2><p>订货商品 ${base.length} 款 · 推广专用 ${extras.length} 款。原合作记录与历史费用保留。</p></div><button type="button" data-close>关闭</button></div><div class="catalog-toolbar"><input aria-label="搜索商品目录" placeholder="检索名称、编号" id="catalog-query"><button type="button" id="catalog-add">新增推广 SKU</button></div><div id="catalog-rows" class="catalog-rows"></div>`;
      const render=()=>{const q=root.PromotionData.key(dialog.querySelector('#catalog-query').value);dialog.querySelector('#catalog-rows').innerHTML=catalog.filter(p=>!q||root.PromotionData.key([p.name,p.code,...p.aliases||[]].join(' ')).includes(q)).map(p=>`<div class="catalog-row"><div><strong>${e(p.name)}</strong><small>${e(p.code||p.sku)} · ${e(root.PromotionData.productCategories(p).join(' / ')||'类目待补')} · ${p.promotionOnly?'推广专用':'订货商品'}${p.compositionPending?' · 组成／资料待补':''}</small></div>${p.promotionOnly?`<button type="button" data-sku="${e(p.id)}">编辑／补组成</button>`:'<span>名称随订货系统更新</span>'}</div>`).join('');};
      dialog.querySelector('#catalog-query').oninput=render;dialog.querySelector('#catalog-add').onclick=()=>edit();
      dialog.querySelector('#catalog-rows').onclick=event=>{const id=event.target.closest('[data-sku]')?.dataset.sku;if(id)edit(catalog.find(p=>p.id===id));};
      dialog.querySelector('[data-close]').onclick=()=>dialog.close();render();
    };
    const edit=p=>{
      const options=base.map(b=>`<option value="${e(b.id)}">${e(b.name)} · ${e(b.code||b.sku)}</option>`).join('');
      dialog.innerHTML=`<form id="promotion-sku-form"><div class="catalog-dialog-head"><h2>${p?'编辑':'新增'}推广 SKU</h2><button type="button" data-close>关闭</button></div><label>正式名称<input name="name" required maxlength="200" value="${e(p?.name)}"></label><div class="catalog-toolbar"><label>类型<select name="kind"><option value="product">单品／待补款式</option><option value="bundle" ${p?.kind==='bundle'?'selected':''}>套餐组合</option></select></label><label>补充类目<select name="category"><option value="">随组成商品分类</option>${categories.map(c=>`<option ${c===p?.category?'selected':''}>${e(c)}</option>`).join('')}</select></label></div><label>旧称／别名（每行一个）<textarea name="aliases" rows="2">${e((p?.aliases||[]).join('\n'))}</textarea></label><label>如果其实是订货单品，直接对应到<select name="replacementId"><option value="">保留为推广专用 SKU</option>${options}</select></label><h3>套餐组成／实际商品</h3><p>选择实际商品及每组件数。成本自动取订货系统；包含多个类目的套餐会进入对应的每个类目。</p><div id="sku-components"></div><button type="button" id="sku-component-add">添加组成商品</button><label class="sku-confirm"><input type="checkbox" name="compositionConfirmed" ${p&&!p.compositionPending?'checked':''}>组成商品与每组件数已核对完整</label><p id="sku-save-status" role="status"></p><div class="catalog-dialog-actions"><button type="button" id="sku-back">返回目录</button><button type="submit" class="primary-button">保存 SKU</button></div></form>`;
      const form=dialog.querySelector('form'),components=dialog.querySelector('#sku-components');
      const add=(c={})=>{const row=document.createElement('div');row.className='sku-component';row.innerHTML=`<select aria-label="组成商品" required><option value="">选择订货商品</option>${options}</select><input aria-label="每组件数" type="number" min="0.01" step="0.01" required placeholder="每组件数"><button type="button">移除</button>`;row.querySelector('select').value=c.productId||'';row.querySelector('input').value=c.quantity??'';row.querySelector('button').onclick=()=>row.remove();components.append(row);};
      for(const c of p?.components||[])add(c);
      form.elements.replacementId.value=p?.replacementId||'';
      dialog.querySelector('#sku-component-add').onclick=()=>add();dialog.querySelector('#sku-back').onclick=list;dialog.querySelector('[data-close]').onclick=()=>dialog.close();
      form.onsubmit=async event=>{event.preventDefault();const status=dialog.querySelector('#sku-save-status'),button=form.querySelector('[type=submit]');
        const name=form.elements.name.value.trim(),replacementId=form.elements.replacementId.value;
        const value={id:p?.id||'promo-custom-'+crypto.randomUUID(),name,kind:form.elements.kind.value,category:form.elements.category.value,aliases:[...new Set([...(p?.aliases||[]),...(p&&p.name!==name?[p.name]:[]),...form.elements.aliases.value.split('\n').map(s=>s.trim()).filter(Boolean)])],replacementId,compositionConfirmed:form.elements.compositionConfirmed.checked,components:[...components.children].map(row=>({productId:row.querySelector('select').value,quantity:Number(row.querySelector('input').value)}))};
        if(!name){status.textContent='请填写名称';return;}
        if(catalog.some(q=>q.id!==value.id&&root.PromotionData.key(q.name)===root.PromotionData.key(name))&&!replacementId){status.textContent='已有同名商品，请使用已有 SKU';return;}
        if(value.compositionConfirmed&&!value.components.length&&!replacementId){status.textContent='请添加组成商品，或先取消完整核对勾选';return;}
        if(new Set(value.components.map(c=>c.productId)).size!==value.components.length){status.textContent='相同商品请合并件数';return;}
        button.disabled=true;status.textContent='正在保存到共享目录…';
        try{if(await a.save(value)){dialog.close();a.notify('商品目录已保存，合作记录会使用统一名称');}else status.textContent='尚未获得服务器确认，请查看顶部同步状态；修改已保留。';}catch(error){status.textContent=error.message;}finally{button.disabled=false;}
      };
    };
    if(productId&&extras.some(p=>p.id===productId))edit(extras.find(p=>p.id===productId));else list();
    if(!dialog.open)dialog.showModal();
  }
  root.PromotionCatalogUI={open};
})(globalThis);
