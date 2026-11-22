import {wholesaleProducts} from './wholesale-products.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const aliases={'PUPU-TAIYAKI':'qp-35','PUPU-TOAST-BAG':'qp-43','PUPU-DONUT-BAG':'qp-44','PUPU-PENCIL':'qp-34','PUPU-SANFEN-COIN':'qp-37'};
const normalize=v=>String(v||'').normalize('NFKC').replace(/\s|[（）()／/·—-]/g,'').toLowerCase();
export function productImage(k={}){
  const explicit=aliases[k.code]||k.influencerProductId;
  let candidates=wholesaleProducts.filter(p=>p.id===explicit);
  if(!candidates.length){const codes=new Set([k.code,k.barcode,k.erpBarcode,k.costSkuId?.replace(/^SKU-/,'' )].filter(Boolean));candidates=wholesaleProducts.filter(p=>codes.has(p.code));}
  if(!candidates.length){const names=new Set([k.name,k.erpName,[k.erpName,k.erpSpec].filter(Boolean).join('-')].map(normalize).filter(Boolean));candidates=wholesaleProducts.filter(p=>names.has(normalize(p.name)));}
  return candidates.length===1?new URL(candidates[0].image,'https://pupuhome-wholesale.onrender.com/').href:'';
}
export function productCell(k={},subtitle=''){
  const image=productImage(k);
  return `<div class="product-cell"><span class="product-photo">${image?`<img src="${esc(image)}" alt="${esc(k.name)}" loading="lazy" decoding="async" referrerpolicy="no-referrer">`:'<span>待配图</span>'}</span><span><b>${esc(k.name||'商品待匹配')}</b>${subtitle?`<small>${esc(subtitle)}</small>`:''}</span></div>`;
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

let query='',metric='quantity';
export function renderMonthly(api){
  const {state,filters,$,can,num,button,bind,bindAll,editMonthly,openCollections,csv,sku}=api;
  const records=state.monthly.filter(r=>(!filters.month||r.month===filters.month)&&(!filters.sku||r.skuId===filters.sku));
  const groups=groupSales(records).filter(g=>!query||[sku(g.skuId)?.name,sku(g.skuId)?.code,sku(g.skuId)?.spec].join(' ').toLowerCase().includes(query.toLowerCase()));
  const channels=['淘宝','小红书',...new Set(records.map(r=>r.channel).filter(c=>!['淘宝','小红书'].includes(c)))];
  const fields=metric==='quantity'?['paid','refund','net']:['payAmount','refundAmount','netAmount'];
  const labels=metric==='quantity'?['支付件数','退款件数','净销量']:['支付金额','退款金额','净金额'];
  const display=v=>v===null?'<span class="missing">待补</span>':metric==='amount'?Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2}):num(v);
  const totals=fields.map(field=>{const values=groups.flatMap(g=>channels.map(c=>salesValue(g.channels[c],field))).filter(isNumber);return values.length?values.reduce((a,b)=>a+b,0):null;});
  $('#content').innerHTML=`<div class="page-heading sales-heading"><div><h1>月度销售</h1><p class="subtitle">同款商品，一行查看各平台表现。</p></div><div class="actions">${button('open-collections','采集销售数据')}${button('monthly-export','导出表格')}${can('operations')?button('new-monthly','登记销售',true):''}</div></div><div class="sales-toolbar"><label>月份<input id="month-filter" type="month" value="${esc(filters.month)}"></label><label class="sales-search">搜索商品<input id="sales-query" value="${esc(query)}" placeholder="商品名称或编码"></label>${button('sales-find','查询')}<div class="segmented" aria-label="显示内容"><button id="show-quantity" class="${metric==='quantity'?'selected':''}" aria-pressed="${metric==='quantity'}">件数</button><button id="show-amount" class="${metric==='amount'?'selected':''}" aria-pressed="${metric==='amount'}">金额</button></div></div><div class="sales-totals">${labels.map((label,i)=>`<div><span>已录${label}</span><strong>${display(totals[i])}</strong></div>`).join('')}<p>仅统计已录数据<br>待补项不按 0 计算</p></div><div class="card sales-card"><div class="table-wrap"><table class="sales-table"><thead><tr><th rowspan="2" scope="col">商品</th><th rowspan="2" scope="col">月份</th>${channels.map(c=>`<th colspan="3" scope="colgroup" class="platform-heading">${platformLogo(c)}</th>`).join('')}<th rowspan="2">操作</th></tr><tr>${channels.map(()=>labels.map(l=>`<th scope="col" class="sales-number">${l}</th>`).join('')).join('')}</tr></thead><tbody>${groups.map(g=>`<tr>${`<td>${productCell(sku(g.skuId))}</td><td>${esc(g.month)}</td>`}${channels.map(c=>fields.map((field,i)=>`<td class="sales-number ${i===2?'net-value':''}">${display(salesValue(g.channels[c],field))}</td>`).join('')).join('')}<td><button type="button" data-sales-details="${esc(g.skuId)}" data-month="${esc(g.month)}">${can('operations')?'编辑':'查看'}</button></td></tr>`).join('')}</tbody></table>${groups.length?'':'<div class="empty">这个月份还没有销售记录，可从上方采集或登记。</div>'}</div></div>`;
  const rerender=()=>renderMonthly(api);
  $('#month-filter').onchange=e=>{filters.month=e.target.value;rerender();};
  bind('sales-find',()=>{query=$('#sales-query').value;rerender();});$('#sales-query').onkeydown=e=>{if(e.key==='Enter')$('#sales-find').click();};
  bind('show-quantity',()=>{metric='quantity';rerender();});bind('show-amount',()=>{metric='amount';rerender();});
  bind('new-monthly',()=>editMonthly());bind('open-collections',openCollections);
  bind('monthly-export',()=>csv('月度销售汇总',['商品编码','商品','月份',...channels.flatMap(c=>labels.map(l=>c+l))],groups.map(g=>[sku(g.skuId)?.code,sku(g.skuId)?.name,g.month,...channels.flatMap(c=>fields.map(f=>salesValue(g.channels[c],f)))])));
  bindAll('[data-sales-details]',el=>{
    const g=groups.find(g=>g.skuId===el.dataset.salesDetails&&g.month===el.dataset.month),k=sku(g.skuId);
    api.showEditor(`${k?.name||'商品'} · ${g.month}`,`<div class="wide">${productCell(k)}<div class="sales-channel-actions">${channels.map(c=>{const rows=g.channels[c]||[];return `<section><h3>${platformLogo(c)}</h3><p>支付 ${num(salesValue(rows,'paid'))} · 退款 ${num(salesValue(rows,'refund'))} · 净销量 ${num(salesValue(rows,'net'))}</p>${can('operations')?(rows.length>1?'<p class="error">存在重复口径，需核对后编辑原记录。</p>':`<button type="button" data-sales-edit="${esc(rows[0]?.id||'')}" data-channel="${esc(c)}">${rows.length?'编辑记录':'补充数据'}</button>`):''}</section>`;}).join('')}</div></div>`,async()=>{});
    $('#save-editor').textContent='关闭';
    bindAll('[data-sales-edit]',b=>editMonthly(state.monthly.find(r=>r.id===b.dataset.salesEdit)||{skuId:g.skuId,month:g.month,channel:b.dataset.channel}));
    bindImageFallback();
  });
  bindImageFallback();
}
