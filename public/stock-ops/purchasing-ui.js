import {reconciliationCard,downloadRecordImage} from './record-image.js';
import {reconciliation,reconciliationKey,latestHandoff,handoffCurrent} from './purchase-reconciliation.js';
import {reconciliationHtml,showHandoffInbox} from './purchase-handoff-ui.js';
import {uploadContract} from './reliable-save.js?v=20261123-purchase-reliable-v1';
import {productCell,bindImageFallback,groupSales,salesValue,monthlyReadModel} from './sales-ui.js';
import {purchaseSummary,shippingSummary,forecastSupply,dayCount,addDays} from './purchasing-math.js';
import {renderPurchaseBalances} from './purchase-balances-ui.js?v=20261123-balances-v1';
let purchaseMonth='',forecastSku='',purchaseView='orders';
export function renderPurchases(a){
  if(['admin','finance'].includes(a.state.role)&&purchaseView==='balances')return renderPurchaseBalances({...a,onBack:()=>{purchaseView='orders';a.render();}});
  if(purchaseView==='forecast')return renderReplenishment({...a,onBack:()=>{purchaseView='orders';a.render();}});
  const {state,$,can,heading,button,table,escape,num,pill,bind,bindAll,showEditor,field,area,select,skuSelect,command,localNow,iso,today,sku,render,syncProductCatalog,catalogStatus}=a;
  const orders=state.purchases||[],receipts=state.purchaseReceipts||[],inspections=state.purchaseInspections||[],returns=state.purchaseReturns||[];
  const summary=o=>purchaseSummary(o,receipts,inspections,returns);
  const ship=o=>shippingSummary(o,receipts,today());
  const rows=orders.filter(o=>!purchaseMonth||o.orderDate.startsWith(purchaseMonth)).slice().reverse();
  const overdue=rows.filter(o=>ship(o).overdueDays>0);
  const privateRow=o=>state.purchasePrivate?.[o.id];
  const money=v=>v===null||v===undefined?'<span class="missing">待填写</span>':'¥'+Number(v).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  function shippingCell(o){
    const x=ship(o);
    return `<div class="shipping-date">${escape(x.expected||'待补出货时间')}</div>`+
      (x.overdueDays?`<strong class="shipping-overdue">已超时 ${x.overdueDays} 天</strong><small>尚未出货 ${num(x.outstanding)} 件</small>`:
      x.complete?`<small>${x.completedAt?'已全部出货 '+escape(x.completedAt):'已收齐 · 出货记录待补'}</small>${x.lateDays?`<strong class="shipping-late">出货晚了 ${x.lateDays} 天</strong>`:''}`:
      `<small>${x.shipped?'已登记出货 '+num(x.shipped)+' 件':o.status==='计划'?'计划未下单':'待出货'}${x.expected===today()?' · 今天出货':''}</small>`);
  }
  const privateFields=value=>`<section class="purchase-private wide"><h3>合同与尾款 <span>管理员及财务可见</span></h3>${field('balanceDue','尾款金额（元）',value?.balanceDue??'','number',false)}<label>上传合同图片<input id="purchase-contract-files" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><p class="muted">JPG、PNG、WebP，每张最多10MB；可上传多张。</p><p id="contract-upload-progress" role="status"></p></section>`;
  function privateReader(){
    const uploaded=new Map();
    return async d=>{
      if(state.role!=='admin')return undefined;
      const files=Array.from($('#purchase-contract-files')?.files||[]),contracts=[];
      if(files.length>20)throw Error('每批次最多20张合同图片');
      for(const [i,file]of files.entries()){
        if(file.size>10*1024*1024)throw Error('每张合同图片不能超过10MB');
        if(!uploaded.has(file)){
          const progress=$('#contract-upload-progress');progress.textContent=`正在上传合同图片 ${i+1} / ${files.length}…`;
          const result=await uploadContract(file,percent=>{progress.textContent=percent===100?'图片传输完成，正在确认文件保存…':`正在上传合同图片 ${i+1} / ${files.length} · ${percent===null?'传输中':percent+'%'}`;});uploaded.set(file,result);
        }
        contracts.push(uploaded.get(file));
      }
      const progress=$('#contract-upload-progress');if(progress)progress.textContent=files.length?'合同图片已保存，正在登记补货信息…':'正在保存补货信息…';
      return {balanceDue:d.balanceDue,contracts};
    };
  }
  $('#content').innerHTML=heading('补货与到货','一批货从下单、出货、收货到验收，放在一起核对。',button('sync-purchase-products','同步商品名称／图片')+(can('operations')?button('new-purchase','登记补货批次',true):''))+`<p id="product-catalog-status" class="muted" role="status">${escape(catalogStatus||'')}</p><div class="sales-toolbar"><label>下单月份<input id="purchase-month" type="month" value="${purchaseMonth}"></label>${button('purchase-all','全部批次')}${button('view-forecast','补货建议')}${['admin','finance'].includes(state.role)?button('view-handoffs','仓库对账资料'):''}${['admin','finance'].includes(state.role)?button('view-balances','查看尾款情况'):''}</div>${overdue.length?`<div class="shipping-alert" role="status"><strong>${overdue.length} 个批次出货超时</strong><span>最长已超时 ${Math.max(...overdue.map(o=>ship(o).overdueDays))} 天，请跟进工厂出货。</span></div>`:''}<div class="card purchase-list">${table(['商品／批次','预计出货时间','下单','实收','合格入库','当前可售','瑕疵／已退厂','待检','少到／超收','状态',...(['admin','finance'].includes(state.role)?['尾款金额']:[]),''],rows.map(o=>{const x=summary(o);return [productCell(sku(o.skuId),o.reference)+`<div class="purchase-row-actions">${can('operations')?`<button type="button" data-edit-purchase="${o.id}">编辑补货</button>`:''}<button type="button" data-purchase="${o.id}">查看明细</button>${o.status==='已下单'&&can('warehouse')?`<button type="button" data-receive-purchase="${o.id}">到货登记</button>`:''}</div>`,shippingCell(o),num(o.quantity),num(x.received),num(x.good),num(state.balances.find(b=>b.skuId===o.skuId&&b.warehouse===o.warehouse)?.available),`${num(x.defect)} / ${num(x.returned)}`,num(x.pending),x.over?pill('超收 '+x.over,'warn'):num(x.shortfall),pill(handoffCurrent(state,latestHandoff(state,o.id))?'已处理完毕':latestHandoff(state,o.id)?'已变更待复核':o.status==='计划'?'计划未下单':x.pending?'待验收':x.shortfall?'待到货':'已收齐',x.pending||x.shortfall?'warn':''),...(['admin','finance'].includes(state.role)?[money(privateRow(o)?.balanceDue)+(privateRow(o)?.settlement?.status==='已结清'?'<small>'+pill('已结清')+'</small>':'')]:[]),'']}),'尚未登记补货批次。补货建议、工厂下单和实际到货分开记录。')}</div><p class="muted">超时按北京时间计算，预计出货当天不计超时；分批出货后，未出完的部分继续提醒。合格入库与当前可售分别记录。</p>`;
  $('#purchase-month').onchange=e=>{purchaseMonth=e.target.value;render();};bind('purchase-all',()=>{purchaseMonth='';render();});
  bind('sync-purchase-products',async()=>{await syncProductCatalog(true);render();});
  bind('view-forecast',()=>{purchaseView='forecast';render();});
  bind('view-handoffs',()=>showHandoffInbox(a));
  bindAll('[data-receive-purchase]',el=>{const o=orders.find(o=>o.id===el.dataset.receivePurchase);receipts.some(r=>r.purchaseId===o.id)?arrivalList(o):receivePurchase(o);});
  bind('view-balances',()=>{purchaseView='balances';render();});
  bind('new-purchase',()=>{const key=crypto.randomUUID(),readPrivate=privateReader();showEditor('登记补货批次',skuSelect()+field('reference','工厂订单／补货批次号')+field('quantity','下单数量','','number')+select('status','下单状态',['计划','已下单'],'计划')+field('orderDate','计划／实际下单日',today(),'date')+field('expectedShipAt','预计出货时间','','date')+field('warehouse','收货仓库','主仓')+area('note','工厂确认或计划说明')+(state.role==='admin'?privateFields():''),async d=>{const privateDetails=await readPrivate(d);delete d.balanceDue;delete d['purchase-contract-files'];const result=await command('purchase',{...d,...(privateDetails?{privateDetails}:{})},key);purchaseMonth='';return result;},'登记仅记录事实，不会向工厂下单，也不会增加库存。');});
  bindAll('[data-edit-purchase]',el=>editPurchase(orders.find(o=>o.id===el.dataset.editPurchase)));
  bindAll('[data-purchase]',el=>detail(orders.find(o=>o.id===el.dataset.purchase)));bindImageFallback();
  function receivePurchase(o){const key=crypto.randomUUID();showEditor('登记到货 · '+o.reference,field('reference','本次收货单号')+field('trackingNumber','到货物流单号（选填）','','text',false)+field('at','实际收货时间',localNow(),'datetime-local')+field('good','已验收合格数量','','number')+field('defect','已确认瑕疵数量','','number')+field('pending','尚未验收数量','','number')+select('returnDecision','瑕疵品处理',['待确认','需寄回','留仓处理'])+area('note','收货验收说明')+area('overReceiptReason','超收原因（未超收可留空）','',false),d=>command('purchaseReceive',{...d,purchaseId:o.id,at:iso(d.at)},key),'三个数量相加为本次实收。未知是否合格的数量填入待检，不填入合格。');}
  const reportFor=o=>({...reconciliation(state,o.id),product:{name:a.productName?a.productName(o.skuId):sku(o.skuId)?.name,code:sku(o.skuId)?.code}});
  const wide=()=>$('#editor')?.classList?.add('purchase-dialog');
  function arrivalList(o){
    const report=reportFor(o),sent=latestHandoff(state,o.id),done=handoffCurrent(state,sent);
    showEditor('到货登记 · '+o.reference,`<div class="wide"><div class="section-heading">${productCell(sku(o.skuId))}<div class="actions">${can('warehouse')?button('add-arrival','到货登记',true):''}</div></div>${reconciliationHtml(report,{...a,receiptAction:r=>`<button type="button" data-arrival-receipt="${escape(r.id)}">${can('warehouse')?'验收／寄回登记':'查看记录'}</button>`})}<div class="actions">${button('arrival-detail','查看明细')}${can('warehouse')&&report.rows.length&&!done?button('finish-arrival','已处理完毕',true):''}</div>${done?'<p class="hint">已处理完毕，对账资料已发送到管理员和 bonnie 的站内收件箱。</p>':sent?'<p class="hint">发送后数据有变更，请重新核对并发送新版；旧版仍保留。</p>':''}</div>`,async()=>{});
    $('#save-editor').textContent='关闭';wide();bind('add-arrival',()=>receivePurchase(o));bind('arrival-detail',()=>detail(o));bind('finish-arrival',()=>complete(o));
    bindAll('[data-arrival-receipt]',el=>receiptDetail(o,receipts.find(r=>r.id===el.dataset.arrivalReceipt)));bindImageFallback();
  }
  function complete(o){
    const report=reportFor(o),reviewKey=reconciliationKey(state,o.id),mismatch=report.totals.shortfall||report.totals.over;
    showEditor('确认该批次已处理完毕',`<div class="wide"><p><strong>确认该批次已经处理完入库和售后，将自动发送数据给管理员和 bonnie。</strong></p>${reconciliationHtml(report,a)}${report.issues.length?'<div class="hint">'+report.issues.map(escape).join('<br>')+'</div>':''}<p>发送后双方将收到相同版本的站内对账资料，供核算尾款；此操作不会自动标记付款。</p></div>`+(mismatch?area('discrepancyNote','少到／超收处理依据（确认无后续到货）'):''),d=>command('purchaseComplete',{purchaseId:o.id,reviewKey,confirmed:true,discrepancyNote:d.discrepancyNote||''}));
    $('#save-editor').textContent='确认无误，发送数据';$('#save-editor').disabled=Boolean(report.issues.length);wide();
  }
  function editPurchase(o){
    const locked=(o.shipments||[]).length||receipts.some(r=>r.purchaseId===o.id);
    const identity=locked?`<div class="wide">${productCell(sku(o.skuId))}<p class="muted">已有出货或收货记录，商品、仓库和下单状态保留原值。</p></div>`:skuSelect('skuId',o.skuId)+select('status','下单状态',['计划','已下单'],o.status)+field('warehouse','收货仓库',o.warehouse);
    showEditor('编辑补货 · '+o.reference,identity+field('reference','工厂订单／补货批次号',o.reference)+field('quantity','下单数量',o.quantity,'number')+field('orderDate','计划／实际下单日',o.orderDate,'date')+field('expectedShipAt','预计出货时间',o.expectedShipAt||'','date',!o.expectedAt)+field('expectedAt','预计到货日（选填）',o.expectedAt||'','date',false)+area('note','工厂确认或计划说明',o.note),d=>command('purchaseUpdate',{...d,...(locked?{skuId:o.skuId,status:o.status,warehouse:o.warehouse}:{}),purchaseId:o.id,expectedUpdatedAt:o.updatedAt}),'保存会保留修改历史；原合同、尾款及已登记的出货、收货数量继续保留。');
    bindImageFallback();
  }
  function detail(o){
    const x=summary(o),sh=ship(o),rs=receipts.filter(r=>r.purchaseId===o.id),priv=privateRow(o);
    const contracts=(priv?.contracts||[]).map(f=>`<a href="/api/stock-ops/purchase-contract?id=${encodeURIComponent(f.id)}" target="_blank" rel="noopener"><img loading="lazy" src="/api/stock-ops/purchase-contract?id=${encodeURIComponent(f.id)}" alt="${escape(f.name)}"><span>${escape(f.name)}</span></a><a class="pill" href="/api/stock-ops/purchase-contract?id=${encodeURIComponent(f.id)}&amp;download=1">下载合同图片</a>`).join('');
    showEditor(o.reference,`<div class="wide">${productCell(sku(o.skuId))}<p>下单 ${num(o.quantity)} 件 · ${escape(o.status)}</p><div class="purchase-shipping-summary">预计出货时间 ${shippingCell(o)}</div>${o.expectedAt?`<p class="muted">预计到货日 ${escape(o.expectedAt)}</p>`:''}<p>实收 ${x.received}，合格 ${x.good}，瑕疵 ${x.defect}，待检 ${x.pending}，已退厂 ${x.returned}</p><div class="actions">${button('download-purchase','下载工厂对账表')}${can('warehouse')&&rs.length&&!handoffCurrent(state,latestHandoff(state,o.id))?button('finish-purchase','已处理完毕',true):''}${can('operations')?button('edit-purchase','编辑补货')+button('schedule-purchase','出货时间'):''}${o.status==='计划'&&can('operations')?button('confirm-purchase','确认已向工厂下单'):''}${o.status==='已下单'&&sh.shipped<o.quantity&&can('operations','warehouse')?button('ship-purchase','登记工厂出货'):''}${o.status==='已下单'&&can('warehouse')?button('receive-purchase','到货登记'):''}</div>${(o.shipments||[]).length?table(['实际出货时间','出货数量','出货／物流单号'],o.shipments.map(r=>[escape(r.at),num(r.quantity),escape(r.reference)])):''}${reconciliationHtml(reportFor(o),a)}<p class="muted">${escape(o.note)}</p>${['admin','finance'].includes(state.role)?`<section class="purchase-private"><h3>合同与尾款 <span>管理员及财务可见</span></h3><p>尾款金额 <strong>${money(priv?.balanceDue)}</strong></p>${priv?.settlement?.status==='已结清'?`<p>${pill('已结清')} · ${escape(priv.settlement.settledAt)}</p>`:''}<div class="contract-gallery">${contracts||'<p class="muted">尚未上传合同图片</p>'}</div>${state.role==='admin'?button('private-purchase','补充合同／尾款'):''}</section>`:''}${(o.editHistory||[]).length?`<details><summary>补货修改记录（${o.editHistory.length}次）</summary>${table(['修改时间','原商品／数量','现商品／数量','原批次／日期','现批次／日期'],o.editHistory.map(r=>[escape(r.updatedAt),productCell(sku(r.previous.skuId),String(r.previous.quantity)+'件'),productCell(sku(r.current.skuId),String(r.current.quantity)+'件'),escape(r.previous.reference)+'<small>'+escape(r.previous.expectedShipAt||r.previous.expectedAt)+'</small>',escape(r.current.reference)+'<small>'+escape(r.current.expectedShipAt||r.current.expectedAt)+'</small>']))}</details>`:''}${(o.scheduleHistory||[]).length?`<details><summary>出货时间变更记录</summary>${table(['登记时间','原预计出货','现预计出货','说明'],o.scheduleHistory.map(r=>[escape(r.updatedAt.slice(0,10)),escape(r.previous.expectedShipAt||'未登记'),escape(r.expectedShipAt),escape(r.note)]))}</details>`:''}</div>`,async()=>{});$('#save-editor').textContent='关闭';
    wide();
    bind('download-purchase',()=>{const sent=latestHandoff(state,o.id);return downloadRecordImage(reconciliationCard(handoffCurrent(state,sent)?{...sent.snapshot,version:sent.version,sentAt:sent.sentAt,status:'当前有效'}:reportFor(o)));});
    bind('finish-purchase',()=>complete(o));
    bind('edit-purchase',()=>editPurchase(o));
    bind('schedule-purchase',()=>showEditor('出货时间 · '+o.reference,field('expectedShipAt','预计出货时间',o.expectedShipAt||'','date')+field('expectedAt','预计到货日（选填，用于补货测算）',o.expectedAt||'','date',false)+area('note','工厂确认或变更说明'),d=>command('purchaseSchedule',{...d,purchaseId:o.id}),'旧日期及变更说明会保留。'));
    bind('ship-purchase',()=>{const key=crypto.randomUUID();showEditor('登记工厂出货 · '+o.reference,field('at','实际出货时间',today(),'date')+field('quantity','本次出货数量',o.quantity-sh.shipped,'number')+field('reference','出货单号或物流单号')+area('note','工厂出货确认依据'),d=>command('purchaseShip',{...d,purchaseId:o.id},key),'可分批登记，全部出货后停止累计超时。工厂出货不会增加仓库可售库存。');});
    bind('private-purchase',()=>{const readPrivate=privateReader();showEditor('合同与尾款 · '+o.reference,privateFields(priv),async d=>command('purchasePrivate',{purchaseId:o.id,privateDetails:await readPrivate(d)}),'管理员及财务可查看，仅管理员可维护。新增图片会保留已有合同。');});
    bind('confirm-purchase',()=>showEditor('确认已下单',area('note','工厂下单确认依据'),d=>command('purchaseConfirm',{...d,purchaseId:o.id})));
    bind('receive-purchase',()=>arrivalList(o));
    bindImageFallback();
  }
  function receiptDetail(o,r){
    const ins=inspections.filter(i=>i.receiptId===r.id),out=returns.filter(i=>i.receiptId===r.id),pending=r.pending-ins.reduce((s,i)=>s+i.good+i.defect,0),bad=r.defect+ins.reduce((s,i)=>s+i.defect,0)-out.reduce((s,i)=>s+i.quantity,0);
    showEditor('到货验收与寄回 · '+r.reference,`<div class="wide">${productCell(sku(o.skuId))}<p>本次收货单：${escape(r.reference)} · ${escape(r.at)}</p><p>剩余待检 ${pending} 件 · 仓内瑕疵 ${bad} 件 · ${escape(r.returnDecision)}</p><div class="actions">${pending&&can('warehouse')?button('inspect-purchase','登记待检结果'):''}${can('warehouse')?button('decision-purchase','确认瑕疵处理'):''}${bad&&can('warehouse')?button('return-purchase','登记实际寄回'):''}</div>${button('back-arrivals','返回到货列表')}${table(['寄回时间','已寄回数量','退厂单号／物流'],out.map(t=>[escape(t.at),num(t.quantity),escape(t.reference)+'<small>'+escape(t.trackingNumber||'')+'</small>']))}</div>`,async()=>{});$('#save-editor').textContent='关闭';
    bind('back-arrivals',()=>arrivalList(o));
    const common=()=>field('reference','本次处理单号')+field('at','实际处理时间',localNow(),'datetime-local');
    bind('inspect-purchase',()=>{const key=crypto.randomUUID();showEditor('待检验收',common()+field('good','本次转合格','','number')+field('defect','本次转瑕疵','','number')+area('note','验收说明'),d=>command('purchaseInspect',{...d,purchaseId:o.id,receiptId:r.id,at:iso(d.at)},key));});
    bind('decision-purchase',()=>showEditor('瑕疵品处理',select('returnDecision','处理方式',['待确认','需寄回','留仓处理'],r.returnDecision)+area('note','与工厂确认的处理方式'),d=>command('purchaseDecision',{...d,purchaseId:o.id,receiptId:r.id})));
    bind('return-purchase',()=>{if(r.returnDecision!=='需寄回')throw Error('请先点击“确认瑕疵处理”，选择“需寄回”，保存后再登记实际寄回。');const key=crypto.randomUUID();showEditor('瑕疵品实际寄回',common()+field('trackingNumber','寄回物流单号（选填）','','text',false)+field('quantity','本次实际寄回数量','','number')+area('note','退厂物流或交接依据'),d=>command('purchaseReturn',{...d,purchaseId:o.id,receiptId:r.id,at:iso(d.at)},key),'仅登记已经寄回的瑕疵品；不会减少合格可售库存。');});
  }
}

export function renderReplenishment(a){
  const {state,$,can,heading,button,table,escape,num,bind,showEditor,field,area,select,command,today,sku}=a;
  const sales=monthlyReadModel(state);
  const choices=state.skus.filter(k=>k.status!=='停用').sort((a,b)=>Number(sales.some(r=>r.skuId===b.id))-Number(sales.some(r=>r.skuId===a.id)));
  if(!choices.some(k=>k.id===forecastSku))forecastSku=choices[0]?.id||'';
  const k=sku(forecastSku),monthly=groupSales(sales.filter(r=>r.skuId===forecastSku)),observations=state.observations.filter(o=>o.skuId===forecastSku).sort((a,b)=>b.date.localeCompare(a.date)||b.updatedAt.localeCompare(a.updatedAt)),balance=state.balances.find(b=>b.skuId===forecastSku);
  const full=monthly.filter(g=>g.month<today().slice(0,7)&&['淘宝','小红书'].every(c=>{const r=g.channels[c];return r?.length===1&&!r[0].partial&&!r[0].refundPending&&salesValue(r,'net')!==null&&r[0].through===addDays(g.month+'-01',new Date(Date.UTC(Number(g.month.slice(0,4)),Number(g.month.slice(5,7)),0)).getUTCDate()-1);})).slice(0,2);
  const totalDays=full.reduce((n,g)=>n+new Date(Date.UTC(Number(g.month.slice(0,4)),Number(g.month.slice(5,7)),0)).getUTCDate(),0),reference=totalDays?full.reduce((n,g)=>n+salesValue(g.channels['淘宝'],'net')+salesValue(g.channels['小红书'],'net'),0)/totalDays:null;
  const old=observations[0],current=balance?.available??old?.available??null;
  const orders=(state.purchases||[]).filter(p=>p.skuId===forecastSku&&p.status==='已下单').map(p=>({at:p.expectedAt,quantity:purchaseSummary(p,state.purchaseReceipts,state.purchaseInspections,state.purchaseReturns).shortfall})).filter(p=>p.quantity>0);
  $('#content').innerHTML=heading('补货建议','先看平时与活动销量，再结合库存和工期测算。',a.onBack?button('forecast-back','返回补货与到货'):'')+`<div class="sales-toolbar">${select('forecastSku','选择产品',choices.map(k=>[k.id,k.name]),forecastSku)}</div>${k?`<div class="card">${productCell(k)}<div class="sales-reference">${table(['月份','淘宝净销量','小红书净销量','两平台日均'],monthly.map(g=>{const tb=salesValue(g.channels['淘宝'],'net'),xhs=salesValue(g.channels['小红书'],'net'),dates=['淘宝','小红书'].map(c=>g.channels[c]?.[0]?.through),days=dates[0]&&dates[0]===dates[1]?dayCount(g.month+'-01',dates[0]):null;return [escape(g.month)+(g.month.endsWith('-11')?' · 含大促':''),num(tb),num(xhs),num(tb!==null&&xhs!==null&&days?Number(((tb+xhs)/days).toFixed(2)):null)]}))}</div><p class="muted">历史日均按已录净销量÷自然天数。新品、缺货天数及最近7／14天非活动数据尚需核对，不把11月速度直接作为平时速度。</p></div><form id="forecast-form" class="card"><div class="section-heading"><h2>本次参考测算</h2><span>可调整条件后重新计算</span></div><div class="form-grid">${field('asOf','库存起算日（按日初）',balance?.baseAt?today():old?.date||today(),'date')}${field('orderDate','本次计划下单日',today(),'date')}${field('available','起算时可售库存（已扣待发）',current,'number')}${field('daily','采用日均消耗（件）',reference===null?'':reference.toFixed(3),'number')}${field('target','希望覆盖到',`${Number(today().slice(0,4))+1}-02-28`,'date')}${field('leadDays','生产工期（天）',k.leadDays,'number')}${field('moq','最低起订量',k.moq,'number')}${field('transportDays','运输与验货天数（需确认）','','number')}${field('pauseDays','工厂停工影响天数（需确认）','','number')}${field('bufferDays','交期缓冲天数（情景）',0,'number')}${field('safetyDays','期末安全库存天数（情景）',0,'number')}${field('packSize','起订后的数量倍数（情景）',1,'number')}${field('otherDemand','另需预留的寄样／补发数量（需确认）','','number')}${area('basis','日均与库存采用依据',reference===null?'尚缺完整两平台销量，需补齐后选择日均。':`最近两个已录完整月 ${full.map(g=>g.month).join('、')}，净销量÷实际自然天数约${reference.toFixed(3)}件/天。暂未校正缺货、上新与活动；库存日期和在途仍需确认。`)}</div><p class="muted">已登记待到货 ${orders.reduce((n,p)=>n+p.quantity,0)} 件。未登记的工厂订单不会计入。可预售时，到货前需求照常累计，到货先满足积单。</p><div class="dialog-actions"><button class="primary">计算参考建议</button></div></form><div id="forecast-result"></div><div class="card"><h2>历史建议</h2>${table(['记录时间','采用日均','建议数量','当时预计到货','状态'],(state.forecasts||[]).filter(f=>f.skuId===forecastSku).slice().reverse().map(f=>[escape(f.updatedAt.slice(0,10)),num(f.result.daily),num(f.result.quantity),escape(f.result.arrival),escape(f.status)]),'尚未保存建议。保存后冻结原假设，用于后续核对预测与实际。')}</div>`:'<div class="empty">先录入商品销量与库存，再开始测算。</div>'}`;
  bind('forecast-back',a.onBack);
  $('[name="forecastSku"]').onchange=e=>{forecastSku=e.target.value;renderReplenishment(a);};bindImageFallback();
  if(!k)return;
  $('#forecast-form').onsubmit=e=>{e.preventDefault();const form=Object.fromEntries(new FormData(e.target)),inputs={...form,inTransit:orders};try{const r=forecastSupply(inputs);$('#forecast-result').innerHTML=`<div class="card"><h2>参考建议：${r.quantity?'补 '+num(r.quantity)+' 件':'当前条件下暂不补货'}</h2><p>预计到货 ${escape(r.arrival)} · 到货前缺口约 ${r.gapBeforeArrival} 件</p><p>按持续接受预售推算覆盖至 ${escape(r.coverageThrough||'尚不能覆盖首日')} · 目标日预计余量 ${r.targetBalance} 件</p><p class="muted">${r.canArriveByTarget?'到货前若继续接受预售，积单已计入消耗。':'本次到货晚于目标日，数量充足也无法解决目标日前的供货。'} ${r.firstShortage?'预计首次出现缺口：'+escape(r.firstShortage)+'。':''}</p>${can('operations')?button('save-forecast','保存这次参考建议'):''}</div>`;bind('save-forecast',()=>showEditor('保存参考建议',`<div class="wide"><p>保存采用的库存、日均、工期和在途假设，后续新建议不会改写这次记录。</p></div>`+area('basis','确认本次依据与尚未核实项',form.basis),d=>command('forecast',{skuId:k.id,inputs,basis:d.basis}),'仅保存建议，不登记成工厂订单。'));}catch(err){$('#forecast-result').innerHTML=`<p class="hint">${escape(err.message)}</p>`;}};
}
