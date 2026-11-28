import {handoffInbox,handoffCurrent,latestHandoff} from './purchase-reconciliation.js';
import {reconciliationCard,downloadRecordImage} from './record-image.js';
const date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'—';
export function reconciliationHtml(report,a){
  const {escape:e,num,table}=a,t=report.totals;
  const rows=report.rows.map(r=>[e(r.reference)+'<small>'+e(date(r.at))+'</small>',num(r.received),num(r.good),num(r.defect),num(r.returned),num(r.pending),...(a.receiptAction?[a.receiptAction(r)]:[])]);
  if(rows.length)rows.push(['<strong>合计</strong>',num(t.received),num(t.good),num(t.defect),num(t.returned),num(t.pending),...(a.receiptAction?['']:[])]);
  const defects=report.rows.filter(r=>r.defect).map(r=>[e(r.reference),num(r.defect),num(r.returned),num(r.remainingDefect),e(r.remainingDefect?r.returnDecision:'已全部寄回'),'<span class="reconciliation-note">'+e(r.decisionNote||r.note)+'</span>']);
  const returns=report.rows.flatMap(r=>r.returns.map(x=>[e(r.reference),e(x.reference)+'<small>'+e(date(x.at))+'</small>',num(x.quantity),e(x.trackingNumber||'未填写'),'<span class="reconciliation-note">'+e(x.note)+'</span>']));
  return `<section class="reconciliation"><h3>到货与验收汇总</h3>${table(['到货单／时间','寄来数量','验收入库','瑕疵数量','最终寄回','待检',...(a.receiptAction?['操作']:[])],rows,'尚未登记到货')}<p>下单 ${num(report.ordered)} 件 · 少到 ${num(t.shortfall)} 件 · 超收 ${num(t.over)} 件</p><h3>瑕疵处理汇总</h3>${table(['到货单','累计瑕疵','实际寄回','留仓瑕疵','处理状态','处理依据'],defects,'无已确认瑕疵')}<p class="muted">累计瑕疵 ${num(t.defect)} 件 = 实际寄回 ${num(t.returned)} 件 + 留仓瑕疵 ${num(t.defectInWarehouse)} 件。瑕疵不计入合格入库。</p>${returns.length?'<h3>寄回明细</h3>'+table(['关联到货单','寄回单／时间','寄回数量','物流单号','说明'],returns):''}${report.discrepancyNote?'<p class="hint">差额处理：'+e(report.discrepancyNote)+'</p>':''}</section>`;
}
export function showHandoffInbox(a){
  const {$,showEditor,table,escape:e,button,bind,bindAll}=a;
  const reports=handoffInbox(a.state,a.userId);
  showEditor('仓库对账资料',`<div class="wide"><p>仓管确认处理完毕后，资料会同时发给管理员和 bonnie。每次发送保留当时的数据。</p>${table(['商品／批次','发送时间','版本与状态','阅读状态',''],reports.map(r=>[e(r.snapshot.product.name)+'<small>'+e(r.snapshot.reference)+'</small>',e(date(r.sentAt)),e('第 '+r.version+' 版 · '+status(a.state,r)),r.recipients.find(u=>u.id===a.userId)?.readAt?'已阅':'<strong class="unread-label">未读</strong>',`<button type="button" data-handoff="${e(r.id)}">查看明细</button>`]),'暂未收到仓库处理完毕的对账资料。')}</div>`,async()=>{});
  $('#save-editor').textContent='关闭';$('#editor')?.classList?.add('purchase-dialog');
  bindAll('[data-handoff]',el=>showHandoffDetail(a,reports.find(r=>r.id===el.dataset.handoff)));
}
const status=(state,r)=>latestHandoff(state,r.purchaseId)?.id!==r.id?'历史版本':handoffCurrent(state,r)?'当前有效':'数据已变更，待仓管重新发送';
export function showHandoffDetail(a,report){
  if(!report)return;
  const {$,showEditor,escape:e,button,bind,command}=a,s=report.snapshot;
  const recipient=report.recipients.find(u=>u.id===a.userId),current=handoffCurrent(a.state,report)&&latestHandoff(a.state,report.purchaseId)?.id===report.id;
  showEditor('仓库对账明细 · '+s.reference,`<div class="wide"><h3>${e(s.product.name)}</h3><p>批次 ${e(s.reference)} · ${e(s.warehouse)} · 第 ${report.version} 版</p><p>处理人 ${e(s.processedBy?.name||s.processedBy?.username||'仓管')} · 发送于 ${e(date(report.sentAt))}</p><p class="${current?'hint':'handoff-warning'}">${e(status(a.state,report))}${current?' · 可用于核对结款':' · 请以仓管重新确认的最新资料核对结款'}</p>${reconciliationHtml(s,a)}<p>送达：${report.recipients.map(u=>e(u.name)+(u.readAt?'（已阅）':'（未读）')).join('、')}</p><div class="actions">${button('download-handoff','下载工厂对账表')}${button('back-handoffs','返回收件箱')}</div></div>`,recipient&&!recipient.readAt?()=>command('purchaseHandoffRead',{reportId:report.id}):async()=>{});
  $('#save-editor').textContent=recipient&&!recipient.readAt?'确认已阅':'关闭';$('#editor')?.classList?.add('purchase-dialog');
  bind('back-handoffs',()=>showHandoffInbox(a));
  bind('download-handoff',()=>downloadRecordImage(reconciliationCard({...s,version:report.version,sentAt:report.sentAt,status:status(a.state,report)})));
}
