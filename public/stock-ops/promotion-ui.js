const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>v===null||v===undefined?'<span class="missing">待核</span>':'¥'+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const date=v=>v?escape(String(v).slice(0,10)):'待填';
const basis={snapshot:'历史已记录成本',estimate:'按订货现成本估算',none:'无需寄样',unknown:'成本待核'};
function productList(p){return `<div class="promotion-products">${p.products.map(k=>`<div><strong>${escape(k.name)}</strong><small>${escape(k.code)}${k.promotionOnly?' · 推广专用 SKU':''}</small>${k.compositionPending?'<small>组成／资料待补，可在商品与套餐目录编辑</small>':''}</div>`).join('')}${p.unresolved.map(s=>`<div class="promotion-unresolved">${escape(s)}<small>商品对应待确认</small></div>`).join('')}</div>`;}
const expenseTotal=p=>p.expense.total===null?`${money(p.expense.knownTotal)}<small class="warning">已知部分 · 尚未核齐</small>`:`${money(p.expense.total)}<small>${p.expense.basis==='estimate'?'含估算成本':p.unresolved.length?'商品对应待核':'已录花销'}</small>`;
export function renderPromotions(a){
  const {data,filters,state,$,heading,button,table,bind,bindAll,can,load,editSample}=a;
  const PD=globalThis.PromotionData,view=PD.filterRows(data.placements||[],state.events||[],filters),summary=PD.totals(view.rows);
  const privateCosts=data.privateCosts;
  $('#content').innerHTML=heading('推广花销','待建联、待寄样不计入；已寄样起归为待发布，与已发布按原记录更新。商品名称与成本来自订货系统，套餐在推广目录补充。',button('refresh-samples','同步最新数据')+(can('pr')?'<a class="pill" href="/xhs-media/" target="_blank" rel="noopener">打开博主推广系统 ↗</a><a class="pill" href="/xhs-media/?catalog=" target="_blank" rel="noopener">商品与套餐 SKU ↗</a>':'') )+
    `<p class="hint" id="promotion-sync-status">${escape(a.error||(a.loading?'正在读取推广记录…':data.updatedAt?'推广记录已同步 · '+new Date(data.updatedAt).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未读取推广记录'))}${data.catalogConnected?'<br>订货商品与成本已连接 · '+date(data.catalogSyncedAt):data.catalogError?'<br>'+escape(data.catalogError):''}</p>`+
    `<div class="sales-toolbar"><label>合作登记月份<input id="sample-month" type="month" value="${escape(filters.month)}"></label><button id="promotion-all">全部月份</button><label>搜索博主／商品／负责人<input id="promotion-search" value="${escape(filters.search||'')}" placeholder="输入名称后点击查询"></label><button id="promotion-search-go">查询</button><label>核对状态<select id="promotion-status"><option value="all">全部记录</option><option value="pending" ${filters.status==='pending'?'selected':''}>仅看待核</option></select></label><div class="segmented">${[['registered','登记合作'],['shipped','实际寄出'],['undated','月份待核 '+view.unknown]].map(([mode,label])=>`<button id="sample-${mode}" class="${filters.mode===mode?'selected':''}">${label}</button>`).join('')}</div></div>`+
    `<div class="metrics"><div class="metric"><span>当前合作记录</span><strong>${summary.count}</strong><small>${summary.pending} 条商品或成本待核</small></div>${privateCosts?`<div class="metric"><span>合作费／其他履约费</span><strong>${money(summary.fee)}</strong><small>其他履约费 ${money(summary.extra)}</small></div><div class="metric"><span>样品成本</span><strong>${money(summary.sample)}</strong><small>${summary.snapshot} 条历史成本 · ${summary.estimated} 条按现成本估算</small></div><div class="metric accent"><span>已知花销小计</span><strong>${money(summary.knownTotal)}</strong><small>合作费＋履约费＋样品成本；待核部分尚未计入</small></div>`:'<div class="metric"><span>费用查阅权限</span><strong>受限</strong><small>管理员和财务可查看完整花销</small></div>'}</div>`+
    (privateCosts?'<p class="hint">每条合作费用只计一次，多产品合作不重复计费。花销不等于已付款；历史成本保留原值，没有历史成本时才用订货现成本估算。未知款式、数量或成本保持待核。</p>':'')+
    `<div class="card">${table(['博主／负责人','合作商品','进度／时间','寄样数量',...(privateCosts?['合作费','样品成本','其他履约费','合计']:[]),'操作'],view.rows.map(p=>[
      `<b>${escape(p.creator||'未填博主')}</b><small>${escape(p.owner||'负责人待核')} · ${escape(p.platform||'小红书')}</small>`,productList(p),
      `${escape(p.status||'待核')}<small>约定 ${date(p.agreedPublishAt)}</small><small>发布 ${date(p.publishedAt)}</small>`,
      `${p.sampleQuantity===null?'待核':escape(p.sampleQuantity)}<small>每款登记数量</small><small>当前期间实际出库 ${view.booked.get(p.id)||0} 件</small>`,
      ...(privateCosts?[money(p.expense.fee),money(p.expense.sample)+`<small>${basis[p.expense.basis]}</small>`,money(p.expense.extra),expenseTotal(p)]:[]),
      `<div class="actions"><button data-promotion="${escape(p.id)}">查看明细</button>${can('warehouse')?`<button data-sample="${escape(p.id)}">确认寄出</button>`:''}</div>`
    ]),'此范围暂无记录，可切换“全部月份”或“月份待核”。')}</div>`;
  $('#sample-month').onchange=e=>{filters.month=e.target.value;filters.mode='registered';a.render();};
  $('#promotion-status').onchange=e=>{filters.status=e.target.value;a.render();};
  bind('promotion-all',()=>{filters.month='';filters.mode='registered';a.render();});
  bind('promotion-search-go',()=>{filters.search=$('#promotion-search').value;a.render();});
  $('#promotion-search').onkeydown=e=>{if(e.key==='Enter'){filters.search=e.target.value;a.render();}};
  for(const mode of ['registered','shipped','undated'])bind('sample-'+mode,()=>{filters.mode=mode;a.render();});
  bind('refresh-samples',()=>load(true));
  bindAll('[data-sample]',el=>editSample(data.placements.find(p=>p.id===el.dataset.sample)));
  bindAll('[data-promotion]',el=>showPromotion(a,data.placements.find(p=>p.id===el.dataset.promotion)));
}
export function showPromotion(a,p){
  const {table,showEditor,$}=a,expense=p.expense;
  const fields=[['博主',p.creator],['负责人',p.owner],['平台',p.platform||'小红书'],['合作状态',p.status],['寄样状态',p.sampleStatus],['登记时间',p.createdAt],['约定发布',p.agreedPublishAt],['实际发布',p.publishedAt],['发布内容',p.publicationFormat||p.contentType],['封面露出',({yes:'需要',no:'不要求'})[p.coverExposure]||'待确认'],['转化方式',p.conversionMethods.join('、')||'待确认'],['稿件审核',p.requiresDraftReview==='yes'?'需要审核':p.requiresDraftReview==='no'?'无需审核':'待确认'],['审稿截止',p.draftDeadline],['改期告知截止',p.changeNoticeDeadline],['快递单号',p.sampleTrackingNumber],['笔记标题',p.noteTitle],['笔记链接',p.noteUrl],['具体合作内容',p.cooperationDetails],['备注',p.notes]];
  const rows=fields.map(([name,value])=>[escape(name),escape(value||'待填')]);
  let cost='';
  if(expense)cost=`<h3>花销明细</h3>${table(['合作费','样品成本','其他履约费','已知小计'],[[money(expense.fee),money(expense.sample),money(expense.extra),money(expense.knownTotal)]])}<p class="hint">${basis[expense.basis]}${expense.snapshotSource?' · '+escape(expense.snapshotSource):''}。${expense.total===null?'仍有费用未核齐。':''} 当前订货成本估算：${money(expense.currentEstimate)}。不会自动覆盖历史已记录成本。</p>${table(['订货系统商品','单位成本','成本来源'],p.products.map(k=>[escape(k.name),money(k.unitCost),escape(k.costSource||'订货系统尚未连接此成本')]))}${expense.missingProducts.length?'<p class="warning">成本待核：'+expense.missingProducts.map(escape).join('、')+'</p>':''}`;
  const metrics=expense?Object.entries(p.metrics||{}).filter(([,v])=>v!==null):[];
  const labels={impressions:'曝光',reads:'阅读／点击',likes:'点赞',saves:'收藏',comments:'评论',shares:'分享',leads:'线索',orders:'成交单数',gmv:'GMV'};
  showEditor('推广明细 · '+(p.creator||'未填博主'),`<div class="wide">${productList(p)}<details><summary>原始商品名称与对应依据</summary><p>${escape(p.product)}</p><p>${p.legacyLabels.length?'保留旧名称：'+p.legacyLabels.map(escape).join('、'):'已按商品编号、编码或唯一完整名称对应。'}</p></details>${cost}<h3>合作信息</h3>${table(['项目','已登记内容'],rows)}${metrics.length?`<details><summary>已录推广效果（非实时采集）</summary>${table(['指标','已录数值'],metrics.map(([k,v])=>[labels[k]||escape(k),escape(v)]))}</details>`:''}${a.can('pr')?`<div class="actions"><a class="pill" href="/xhs-media/?placement=${encodeURIComponent(p.id)}" target="_blank" rel="noopener">到推广台编辑此记录 ↗</a></div>`:''}</div>`,async()=>{});
  $('#save-editor').hidden=true;
  $('#editor').addEventListener('close',()=>{$('#save-editor').hidden=false;},{once:true});
}
