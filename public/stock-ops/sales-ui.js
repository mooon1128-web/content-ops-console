import {wholesaleProducts} from './wholesale-products.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aliases={'PUPU-TAIYAKI':'qp-35','PUPU-TOAST-BAG':'qp-43','PUPU-DONUT-BAG':'qp-44','PUPU-PENCIL':'qp-34','PUPU-SANFEN-COIN':'qp-37'};
const normalize=v=>String(v||'').normalize('NFKC').replace(/\s|[（）()／/·—-]/g,'').toLowerCase();
let catalog=wholesaleProducts;
export function setProductCatalog(rows){if(!Array.isArray(rows)||!rows.length)return false;catalog=rows.filter(p=>p?.id&&p?.name).map(p=>({id:String(p.id),code:String(p.code||''),name:String(p.name),image:String(p.image||'')}));return true;}
export function matchedProduct(k={},products=catalog){
  const catalog=products;
  const explicit=aliases[k.code]||String(k.influencerProductId||'').replace(/^wholesale-/,'');
  let candidates=catalog.filter(p=>p.id===explicit);
  if(!candidates.length){const codes=new Set([k.code,k.barcode,k.erpBarcode,k.costSkuId?.replace(/^SKU-/,'' )].filter(Boolean));candidates=catalog.filter(p=>p.code&&codes.has(p.code));}
  if(!candidates.length){const names=new Set([k.name,k.erpName,[k.erpName,k.erpSpec].filter(Boolean).join('-')].map(normalize).filter(Boolean));candidates=catalog.filter(p=>names.has(normalize(p.name)));}
  // User-confirmed family alias; exact colour only. XC remains a separate ERP SKU.
  if(!candidates.length&&[k.name,k.erpName].some(n=>normalize(n)==='痛包xc')){
    const colour=k.erpSpec||String(k.spec||'').replace(/^颜色\s*[／/]\s*/,''),wanted=normalize('肥士顿痛包系列-'+colour);
    if(colour)candidates=catalog.filter(p=>normalize(p.name)===wanted);
  }
  if(!candidates.length){
    const verified={'场景贴纸甜品屋':'NEW-361615','场景贴纸巧克力屋':'NEW-466774','场景贴纸面包工坊':'NEW-512919','山竹迷你挂件':'NEW-911819','迷你挂件山竹':'NEW-911819'};
    const codes=new Set([k.name,k.erpName,[k.erpName,k.erpSpec].filter(Boolean).join('-')].map(n=>verified[normalize(n)]).filter(Boolean));
    candidates=catalog.filter(p=>codes.has(p.code));
  }
  return candidates.length===1?candidates[0]:null;
}
export function productPresentation(k={},products=catalog){
  const p=matchedProduct(k,products),xc=[k.name,k.erpName].some(n=>normalize(n)==='痛包xc');
  const full=p?.name||(xc?'肥士顿痛包':k.name)||'商品待匹配';
  const split=full.lastIndexOf('-'),name=split>0?full.slice(0,split):full;
  const spec=split>0?full.slice(split+1):k.erpSpec||(k.spec&&!/独立款式|平台映射/.test(k.spec)?k.spec:'');
  let image='';try{if(p?.image){const u=new URL(p.image,'https://pupuhome-wholesale.onrender.com/');if(u.protocol==='https:')image=u.href;}}catch{}
  return {name,spec,image,xc,fullName:[name,spec,xc?'XC档案':''].filter(Boolean).join(' · ')};
}
export function productImage(k={}){return productPresentation(k).image;}
export function productCell(k={},subtitle=''){
  const {name,spec,image,xc,fullName}=productPresentation(k);
  return `<div class="product-cell"><span class="product-photo">${image?`<img src="${esc(image)}" alt="${esc(fullName)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span>待配图</span>'}</span><span class="product-copy"><b>${esc(name)}</b>${spec||xc?`<span class="product-spec">${esc(spec)}${xc?' · XC档案':''}</span>`:''}${subtitle?`<small>${esc(subtitle)}</small>`:''}</span></div>`;
}
export function bindImageFallback(root=document){root.querySelectorAll('.product-photo img').forEach(img=>img.onerror=()=>{img.parentElement.innerHTML='<span>图片待补</span>';});}
export function platformLogo(channel){return channel==='淘宝'?'<span class="platform-brand"><span class="platform-logo taobao" role="img" aria-label="淘宝标志">淘</span>淘宝</span>':channel==='小红书'?'<span class="platform-brand"><span class="platform-logo xiaohongshu" role="img" aria-label="小红书标志">小红书</span>小红书</span>':`<span class="platform-brand">${esc(channel)}</span>`;}
const isNumber=v=>typeof v==='number'&&Number.isFinite(v);
// Presentation grouping only: never merge or mutate the source records.
export function groupSales(records){
  const groups=new Map();
  for(const r of records){const key=JSON.stringify([r.skuId,r.month]);if(!groups.has(key))groups.set(key,{skuId:r.skuId,month:r.month,channels:{}});const channels=groups.get(key).channels;(channels[r.channel]??=[]).push(r);}
  return [...groups.values()].sort((a,b)=>b.month.localeCompare(a.month)||String(a.skuId).localeCompare(String(b.skuId)));
}
export function salesValue(rows,metric){
  if(!rows||rows.length!==1)return null;
  const r=rows[0];if(metric==='netAmount')return isNumber(r.payAmount)&&isNumber(r.refundAmount)?r.payAmount-r.refundAmount:null;
  return isNumber(r[metric])?r[metric]:null;
}
export function combinedSales(group,metric='net'){
  const rows=['淘宝','小红书'].map(c=>group.channels[c]);
  const values=rows.map(r=>salesValue(r,metric)),known=values.filter(isNumber);
  const dates=rows.map(r=>r?.[0]?.through).filter(Boolean);
  const refundDates=rows.map(r=>r?.[0]?.refundAsOf).filter(Boolean);
  const partial=new Set(refundDates).size>1||known.length!==2||rows.some(r=>r?.length!==1||r[0].partial||r[0].refundPending)||new Set(dates).size>1;
  return {value:known.length===2?known[0]+known[1]:null,known:known.length?known.reduce((a,b)=>a+b,0):null,partial,pending:rows.some(r=>r?.[0]?.refundPending)};
}
export function productTrend(state,skuId,endMonth){
  const [year,month]=endMonth.split('-').map(Number);
  const groups=groupSales(monthlyReadModel(state).filter(r=>r.skuId===skuId));
  return Array.from({length:4},(_,i)=>{
    const at=new Date(Date.UTC(year,month-4+i,1)).toISOString().slice(0,7),g=groups.find(g=>g.month===at)||{channels:{}};
    const total=combinedSales(g),end=new Date(Date.UTC(Number(at.slice(0,4)),Number(at.slice(5,7)),0)).toISOString().slice(0,10);
    const per=c=>{const r=g.channels[c]?.[0];return {value:salesValue(g.channels[c],'net'),partial:!r||r.partial||r.refundPending||g.channels[c].length!==1,review:!r?.collected,through:r?.through||null};};
    return {month:at,taobao:per('淘宝'),xhs:per('小红书'),total:{value:total.value,partial:total.partial,review:Object.values(g.channels).flat().some(r=>!r.collected)},incomplete:Object.values(g.channels).flat().some(r=>r.through&&r.through<end)};
  });
}
export function trendChart(points){
  const series=[['taobao','淘宝','#ef6c00'],['xhs','小红书','#f02c59'],['total','两平台合计','#32664e']];
  const max=Math.max(1,...points.flatMap(p=>series.map(([k])=>p[k].value)).filter(isNumber)),ceiling=Math.ceil(max/4)*4;
  const x=i=>65+i*205,y=v=>210-v/ceiling*165;
  const grid=Array.from({length:5},(_,i)=>{const value=ceiling*i/4;return `<line x1="50" y1="${y(value)}" x2="700" y2="${y(value)}" stroke="#e3e9e1"/><text x="42" y="${y(value)+4}" text-anchor="end">${value}</text>`;}).join('');
  const marks=series.map(([key,label,color])=>points.map((p,i)=>{
    const v=p[key].value,prev=points[i-1]?.[key];if(!isNumber(v))return '';
    const partial=p[key].partial||p[key].review||p.incomplete;
    const line=i&&isNumber(prev.value)?`<line x1="${x(i-1)}" y1="${y(prev.value)}" x2="${x(i)}" y2="${y(v)}" stroke="${color}" stroke-width="3" ${partial||prev.partial||prev.review||points[i-1].incomplete?'stroke-dasharray="6 5"':''}/>`:'';
    return line+`<circle cx="${x(i)}" cy="${y(v)}" r="5" fill="${partial?'#fff':color}" stroke="${color}" stroke-width="2"><title>${esc(p.month+' '+label+' '+v+'件'+(p[key].partial?'（部分数据）':p[key].review?'（原月报待复核）':'')+(p.incomplete?'（未满月）':''))}</title></circle>`;
  }).join('')).join('');
  const has=points.some(p=>series.some(([k])=>isNumber(p[k].value)));
  return `<section class="sales-trend"><h3>近四个月净销量对比</h3><div class="trend-legend">${series.map(([,label,color])=>`<span><i style="background:${color}"></i>${label}</span>`).join('')}</div>${has?`<svg viewBox="0 0 760 260" role="img" aria-label="近四个月淘宝、小红书和两平台合计净销量折线图">${grid}${marks}${points.map((p,i)=>`<text x="${x(i)}" y="238" text-anchor="middle">${esc(p.month)}${p.incomplete?'*':''}</text>`).join('')}</svg>`:'<p class="empty">尚缺可绘制的净销量数据。</p>'}<p class="muted">缺数据不连线；虚线／空心点表示部分数据、原月报待复核或未满月，* 表示未满月。</p><div class="table-wrap"><table><thead><tr><th>月份</th><th>淘宝</th><th>小红书</th><th>合计净销量</th></tr></thead><tbody>${points.map(p=>`<tr><td>${esc(p.month)}${p.incomplete?'（未满月）':''}</td>${series.map(([key])=>`<td>${isNumber(p[key].value)?p[key].value:'待补'}${p[key].partial?'<small>部分／待补</small>':p[key].review?'<small>待复核</small>':''}${p[key].through&&p.incomplete?`<small>截至 ${esc(p[key].through)}</small>`:''}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>`;
}
export function monthOf(value){
  if(!value)return '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.slice(0,7);
  const n=Date.parse(value);return Number.isFinite(n)?new Date(n+8*3600000).toISOString().slice(0,7):'';
}
export function sampleMonthData(placements,events,month,mode='registered'){
  const reversed=new Set(events.filter(e=>e.reverses).map(e=>e.reverses));
  const shipments=events.filter(e=>e.type==='sample'&&!reversed.has(e.id)&&monthOf(e.at)===month);
  const booked=new Map();for(const e of shipments){const id=String(e.source?.placementId||'');booked.set(id,(booked.get(id)||0)+e.quantity);}
  const unknown=placements.filter(p=>!monthOf(p.createdAt));
  const rows=mode==='undated'?unknown:mode==='shipped'?placements.filter(p=>booked.has(String(p.id))):placements.filter(p=>monthOf(p.createdAt)===month);
  return {rows,shipments,booked,unknownCount:unknown.length,registeredCount:placements.filter(p=>monthOf(p.createdAt)===month).length,shippedQuantity:shipments.reduce((s,e)=>s+e.quantity,0)};
}

const salesKey=r=>JSON.stringify([r.skuId,r.month,r.channel]);
// A read-only projection. Collection results never overwrite monthly or inventory records.
// Only observed component contributions are visible; the staging matrix's synthetic zeros aren't evidence.
export function monthlyReadModel(state){
  const originals=groupSales(state.monthly||[]),selected=new Map();
  for(const g of originals)for(const [channel,rows] of Object.entries(g.channels))selected.set(salesKey({...g,channel}),rows);
  const chosen=new Set();
  const jobs=(state.collections||[]).filter(j=>j.calculation?.computedAt&&Array.isArray(j.results))
    .sort((a,b)=>b.calculation.computedAt.localeCompare(a.calculation.computedAt));
  for(const j of jobs){
    const calc=j.calculation;
    const observed=new Set((calc.contributions||[]).map(salesKey));
    for(const r of j.results){
      const key=salesKey(r);if(!observed.has(key)||chosen.has(key))continue;chosen.add(key);
      const coverage=(calc.coverage||[]).filter(c=>c.channel===r.channel);
      if(!coverage.length)continue;
      const through=coverage.map(c=>c.end).sort()[0];
      if(r.month<coverage.map(c=>c.start.slice(0,7)).sort()[0]||r.month>through.slice(0,7))continue;
      const old=selected.get(key)||[];
      // A later manual edit or more recent sales window must remain visible.
      if(old.length>1||old.some(x=>!x.updatedAt||x.updatedAt>calc.computedAt||x.through>through))continue;
      const pending=(calc.rowIssues||[]).filter(x=>salesKey(x)===key);
      selected.set(key,[{...r,through:r.through<through?r.through:through,
        collectionId:j.id,collected:true,partial:!calc.complete,refundPending:pending.length>0,
        pendingReasons:[...new Set(pending.map(x=>x.detail))],
        knownRefund:r.refund,knownNet:r.net,refund:pending.length?null:r.refund,net:pending.length?null:r.net,
        originalRows:old,computedAt:calc.computedAt,exclusions:calc.exclusions||[]}]);
    }
  }
  return [...selected.values()].flat();
}
export function monthlyGroups(state,records,month,all=false){
  const groups=groupSales(records),ids=new Set(groups.map(g=>g.skuId));
  if(all&&month)for(const k of state.skus||[])if(k.status!=='停用'&&!ids.has(k.id))groups.push({skuId:k.id,month,channels:{}});
  const total=g=>Object.values(g.channels).flat().reduce((n,r)=>n+(isNumber(r.paid)?r.paid:0),0);
  return groups.sort((a,b)=>total(b)-total(a)||String(a.skuId).localeCompare(String(b.skuId)));
}

let query='',metric='quantity',allProducts=false;
export function renderMonthly(api){
  const {state,filters,$,can,num,button,bind,bindAll,editMonthly,openCollections,csv,sku}=api;
  const records=monthlyReadModel(state).filter(r=>(!filters.month||r.month===filters.month)&&(!filters.sku||r.skuId===filters.sku));
  const groups=monthlyGroups(state,records,filters.month,allProducts).filter(g=>(!filters.sku||g.skuId===filters.sku)&&(!query||[sku(g.skuId)?.name,sku(g.skuId)?.code,sku(g.skuId)?.spec,sku(g.skuId)?.erpSpec].join(' ').toLowerCase().includes(query.toLowerCase())));
  const collected=records.filter(r=>r.collected),observedCount=new Set(records.map(r=>r.skuId)).size;
  const partial=collected.some(r=>r.partial),pendingCount=new Set(collected.filter(r=>r.refundPending).map(r=>r.skuId)).size;
  const through=[...new Set(collected.map(r=>r.through))].sort();
  const excludedNames=[...new Set(collected.flatMap(r=>r.exclusions.map(x=>x.name)))];
  const channels=['淘宝','小红书',...new Set(records.map(r=>r.channel).filter(c=>!['淘宝','小红书'].includes(c)))];
  const fields=metric==='quantity'?['paid','refund','net']:['payAmount','refundAmount','netAmount'];
  const labels=metric==='quantity'?['支付件数','退款件数','净销量']:['支付金额','退款金额','净金额'];
  const display=v=>v===null?'<span class="missing">待补</span>':metric==='amount'?Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):num(v);
  const combinedCell=g=>{const v=combinedSales(g,metric==='quantity'?'net':'netAmount');return v.value!==null?`<b>${display(v.value)}</b>${v.partial?'<small>部分已知合计</small>':''}`:`<span class="missing">${v.pending?'退款待核':'待补'}</span>${v.known!==null?`<small>已知 ${display(v.known)}</small>`:''}`;};
  const cell=(rows,field)=>rows?.[0]?.refundPending&&['refund','net'].includes(field)?'<span class="missing">待核</span>':display(salesValue(rows,field));
  const displayedPending=groups.filter(g=>Object.values(g.channels).flat().some(r=>r.refundPending)).length;
  const totals=fields.map(field=>{const values=groups.flatMap(g=>channels.map(c=>salesValue(g.channels[c],field))).filter(isNumber);return values.length?values.reduce((a,b)=>a+b,0):null;});
  const status=g=>{const r=Object.values(g.channels).flat();return !r.length?'待采集':r.some(x=>x.refundPending)?'退款待核':r.some(x=>x.partial)?'已采集 · 部分销量':r.some(x=>x.collected)?'已采集':'原月报 · 待复核';};
  $('#content').innerHTML=`<div class="page-heading sales-heading"><div><h1>月度销售</h1><p class="subtitle">同款商品，一行查看各平台表现。已显示有数据商品 ${observedCount} 款。</p></div><div class="actions">${button('open-collections','采集销售数据')}${button('monthly-export','导出表格')}${can('operations')?button('new-monthly','登记销售',true):''}</div></div><div class="sales-toolbar"><label>月份<input id="month-filter" type="month" value="${esc(filters.month)}"></label><label class="sales-search">搜索商品<input id="sales-query" value="${esc(query)}" placeholder="商品名称或编码"></label>${button('sales-find','查询')}<label>商品范围<select id="sales-scope"><option value="observed" ${!allProducts?'selected':''}>有销售数据（${observedCount}款）</option><option value="all" ${allProducts?'selected':''}>全部商品（含待采集）</option></select></label><div class="segmented" aria-label="显示内容"><button id="show-quantity" class="${metric==='quantity'?'selected':''}" aria-pressed="${metric==='quantity'}">件数</button><button id="show-amount" class="${metric==='amount'?'selected':''}" aria-pressed="${metric==='amount'}">金额</button></div></div><div class="sales-totals">${labels.map((label,i)=>`<div><span>${partial?'已识别部分':'已录'}${label}</span><strong>${metric==='quantity'&&i===2&&displayedPending?`<span class="missing">${displayedPending}款待核</span>`:display(totals[i])}</strong></div>`).join('')}<p>${partial?'非全店完整月销':'仅统计已录数据'}<br>待补、待核不按 0 计算</p></div>${collected.length?`<p class="hint">销售数据已采集至 ${esc(through.join(' / '))}。${partial?'仍有商品对应待补，当前显示已识别部分；':''}${pendingCount?`${pendingCount} 款退款件数待核，净销量暂不列数。`:''}${excludedNames.length?`${esc(excludedNames.join('、'))}已按要求排除。`:''}原月报保留在商品详情。</p>`:'<p class="hint">当前为原月报数据；尚未完成跨链接与套餐复核。</p>'}<div class="card sales-card"><div class="table-wrap"><table class="sales-table"><thead><tr><th rowspan="2" scope="col">商品</th><th rowspan="2" scope="col">月份</th>${channels.map(c=>`<th colspan="3" scope="colgroup" class="platform-heading">${platformLogo(c)}</th>`).join('')}<th rowspan="2" class="combined-net">${metric==='quantity'?'合计净销量':'合计净金额'}</th><th rowspan="2">操作</th></tr><tr>${channels.map(()=>labels.map(l=>`<th scope="col" class="sales-number">${l}</th>`).join('')).join('')}</tr></thead><tbody>${groups.map(g=>`<tr><td>${productCell(sku(g.skuId),[sku(g.skuId)?.spec||sku(g.skuId)?.erpSpec,status(g)].filter(Boolean).join(' · '))}</td><td>${esc(g.month)}</td>${channels.map(c=>fields.map((field,i)=>`<td class="sales-number ${i===2?'net-value':''}">${cell(g.channels[c],field)}</td>`).join('')).join('')}<td class="sales-number net-value combined-net">${combinedCell(g)}</td><td><button type="button" data-sales-details="${esc(g.skuId)}" data-month="${esc(g.month)}">详情／走势</button></td></tr>`).join('')}</tbody></table>${groups.length?'':'<div class="empty">这个月份还没有销售记录，可从上方采集或登记。</div>'}</div></div>`;
  const rerender=()=>renderMonthly(api);
  $('#month-filter').onchange=e=>{filters.month=e.target.value;rerender();};
  $('#sales-scope').onchange=e=>{allProducts=e.target.value==='all';rerender();};
  bind('sales-find',()=>{query=$('#sales-query').value;rerender();});$('#sales-query').onkeydown=e=>{if(e.key==='Enter')$('#sales-find').click();};
  bind('show-quantity',()=>{metric='quantity';rerender();});bind('show-amount',()=>{metric='amount';rerender();});
  bind('new-monthly',()=>editMonthly());bind('open-collections',openCollections);
  bind('monthly-export',()=>csv('月度销售汇总',['商品编码','商品','规格','月份','核对状态',...channels.flatMap(c=>labels.map(l=>c+l)),metric==='quantity'?'合计净销量':'合计净金额','合计完整性'],groups.map(g=>[sku(g.skuId)?.code,sku(g.skuId)?.name,sku(g.skuId)?.spec||sku(g.skuId)?.erpSpec,g.month,status(g),...channels.flatMap(c=>fields.map(f=>salesValue(g.channels[c],f))),combinedSales(g,fields[2]).value,combinedSales(g,fields[2]).partial?'部分／待补':'两平台已录合计'])));
  bindAll('[data-sales-details]',el=>{
    const g=groups.find(g=>g.skuId===el.dataset.salesDetails&&g.month===el.dataset.month),k=sku(g.skuId);
    api.showEditor(`${k?.name||'商品'} · ${g.month}`,`<div class="wide">${productCell(k,k?.spec||k?.erpSpec)}${trendChart(productTrend(state,g.skuId,new Date(Date.now()+8*3600000).toISOString().slice(0,7)))}<div class="sales-channel-actions">${channels.map(c=>{
      const rows=g.channels[c]||[],r=rows[0],old=state.monthly.filter(x=>x.skuId===g.skuId&&x.month===g.month&&x.channel===c);
      return `<section><h3>${platformLogo(c)}</h3><p>支付 ${cell(rows,'paid')} · 退款 ${cell(rows,'refund')} · 净销量 ${cell(rows,'net')}</p>${r?.partial?'<p class="hint">已识别订单的部分销量，尚不能作为完整月销量。</p>':''}${r?.refundPending?`<p class="error">退款扣件待核。已确认扣件 ${num(r.knownRefund)}；净销量等待核实。</p>`:''}${r?.collected&&old.length?`<details><summary>查看原月报（已保留）</summary>${old.map(x=>`<p>支付 ${num(x.paid)} · 退款 ${num(x.refund)} · 净销量 ${num(x.net)}</p>`).join('')}</details>`:''}${can('operations')?(old.length>1?'<p class="error">原记录存在重复口径，需核对后编辑。</p>':`<button type="button" data-sales-edit="${esc(old[0]?.id||'')}" data-channel="${esc(c)}">${old.length?'编辑原月报':'补充人工记录'}</button>`):''}</section>`;
    }).join('')}</div></div>`,async()=>{});
    $('#save-editor').textContent='关闭';
    bindAll('[data-sales-edit]',b=>editMonthly(state.monthly.find(r=>r.id===b.dataset.salesEdit)||{skuId:g.skuId,month:g.month,channel:b.dataset.channel}));
    bindImageFallback();
  });
  bindImageFallback();
}
