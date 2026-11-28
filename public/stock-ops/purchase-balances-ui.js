import {purchaseBalanceSummary} from './purchase-balances.js?v=20261123-balances-v1';
import {productCell,bindImageFallback} from './sales-ui.js';
let view='pending';
export function renderPurchaseBalances(a){
  const {state,$,heading,button,table,escape,num,pill,bind,bindAll,showEditor,field,command,today,sku,render,onBack}=a;
  if(!['admin','finance'].includes(state.role))return;
  const info=purchaseBalanceSummary(state.purchases,state.purchasePrivate,today()),history=view==='settled',rows=history?info.settled:info.pending;
  const money=cents=>cents===null?'<span class="missing">待填写</span>':'¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
  $('#content').innerHTML=heading('尾款情况','结款日期 = 预计出货时间 + 15 天 · 管理员及财务可见',button('balance-back','返回补货与到货'))+
    `<div class="sales-totals"><div><span>全部未结清尾款${info.unknownCount?'（已填金额）':''}</span><strong>${money(info.totalCents)}</strong></div><div><span>未结清批次</span><strong>${num(info.pending.length)}</strong></div>${info.unknownCount?`<div><span>金额待填写</span><strong>${num(info.unknownCount)}</strong></div>`:''}<p>汇总全部批次，不受下单月份影响。${info.unknownCount?'<br>未填金额不计入总额。':''}${info.missingDateCount?`<br>${num(info.missingDateCount)} 个批次待补预计出货时间。`:''}</p></div>`+
    `<div class="sales-toolbar"><div class="actions">${button('balance-pending',`未结清（${info.pending.length}）`,!history)}${button('balance-history',`已结清历史（${info.settled.length}）`,history)}</div></div><div class="card">${table(['商品／批次','下单状态','预计出货时间','预计结款日期',history?'已结清金额':'尾款金额',...(history?['实际结清日期']:[]),''],rows.map(r=>[productCell(sku(r.order.skuId),r.order.reference),pill(r.order.status==='计划'?'计划未下单':r.order.status),escape(r.expectedShipAt||'待补时间'),r.dueAt?`<strong>${escape(r.dueAt)}</strong>${r.overdueDays?`<small><span class="shipping-overdue">已超期 ${r.overdueDays} 天</span></small>`:!history&&r.dueAt===today()?'<small>今天结款</small>':''}`:'<span class="missing">待补预计出货时间</span>',money(r.amountCents),...(history?[escape(r.settlement.settledAt)]:[]),state.role!=='admin'?'仅查阅':history?`<button type="button" data-reopen-balance="${escape(r.order.id)}">恢复未结清</button>`:`<button type="button" data-settle-balance="${escape(r.order.id)}" ${r.amountCents===null?'disabled title="请先补充尾款金额"':''}>已结清</button>`]),history?'暂无已结清记录。':'全部已结清，暂无待结尾款。')}</div><p class="muted">标记已结清后移入历史，原补货、合同与金额保留。未结清日期随预计出货时间更新；已结清历史保留当时日期。</p>`;
  bind('balance-back',onBack);bind('balance-pending',()=>{view='pending';render();});bind('balance-history',()=>{view='settled';render();});
  bindAll('[data-settle-balance]',el=>{
    const row=info.pending.find(r=>r.order.id===el.dataset.settleBalance);if(!row||row.amountCents===null)return;
    showEditor('标记已结清',`<div class="wide">${productCell(sku(row.order.skuId),row.order.reference)}<p>尾款 <strong>${money(row.amountCents)}</strong></p><p>预计结款日期：${escape(row.dueAt||'待补预计出货时间')}</p></div>`+field('settledAt','实际结清日期',today(),'date'),d=>command('purchaseSettle',{purchaseId:row.order.id,settledAt:d.settledAt}),'仅登记已经结清的事实，保存后移入已结清历史。');
    $('#save-editor').textContent='确认已结清';bindImageFallback();
  });
  bindAll('[data-reopen-balance]',el=>{
    const row=info.settled.find(r=>r.order.id===el.dataset.reopenBalance);if(!row)return;
    showEditor('恢复未结清',`<div class="wide">${productCell(sku(row.order.skuId),row.order.reference)}<p>将尾款 ${money(row.amountCents)} 恢复到未结清列表，并重新计入总额。</p></div>`,()=>command('purchaseReopen',{purchaseId:row.order.id}),'原结清记录继续保留。');
    $('#save-editor').textContent='恢复未结清';bindImageFallback();
  });
  bindImageFallback();
}
