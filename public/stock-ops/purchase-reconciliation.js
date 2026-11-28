import {purchaseSummary} from './purchasing-math.js';

// One physical delivery remains one row, including every later inspection/return.
export function reconciliation(state,purchaseId){
  const order=state.purchases?.find(o=>o.id===purchaseId);
  if(!order)throw Error('补货批次不存在');
  const rows=(state.purchaseReceipts||[]).filter(r=>r.purchaseId===purchaseId).map(r=>{
    const inspections=(state.purchaseInspections||[]).filter(i=>i.receiptId===r.id);
    const returns=(state.purchaseReturns||[]).filter(i=>i.receiptId===r.id);
    const total=(rs,k)=>rs.reduce((n,i)=>n+i[k],0);
    const good=r.good+total(inspections,'good'),defect=r.defect+total(inspections,'defect');
    const returned=total(returns,'quantity'),pending=r.pending-total(inspections,'good')-total(inspections,'defect');
    return {id:r.id,reference:r.reference,at:r.at,trackingNumber:r.trackingNumber||'',received:r.good+r.defect+r.pending,good,defect,pending,returned,remainingDefect:defect-returned,returnDecision:r.returnDecision,decisionNote:r.decisionNote||'',note:r.note||'',inspections:inspections.map(i=>({reference:i.reference,at:i.at,good:i.good,defect:i.defect,note:i.note})),returns:returns.map(i=>({reference:i.reference,at:i.at,quantity:i.quantity,trackingNumber:i.trackingNumber||'',note:i.note}))};
  });
  const totals=purchaseSummary(order,state.purchaseReceipts,state.purchaseInspections,state.purchaseReturns);
  const issues=[];
  if(order.status!=='已下单')issues.push('请先确认已下单');
  if(!rows.length)issues.push('尚未登记实际到货');
  if(totals.pending)issues.push(`还有 ${totals.pending} 件待检，须完成验收`);
  for(const r of rows){
    if(r.remainingDefect>0&&r.returnDecision!=='留仓处理')issues.push(`${r.reference}：还有 ${r.remainingDefect} 件瑕疵未寄回或未确认留仓处理`);
    if(r.remainingDefect>0&&r.returnDecision==='留仓处理'&&!r.decisionNote.trim())issues.push(`${r.reference}：请补充瑕疵留仓处理依据`);
  }
  return {purchaseId,reference:order.reference,skuId:order.skuId,warehouse:order.warehouse,ordered:order.quantity,rows,totals,issues};
}

// Explicit facts only. A read receipt/payment edit cannot invalidate warehouse signoff.
export function reconciliationKey(state,purchaseId){
  const r=reconciliation(state,purchaseId),o=state.purchases.find(o=>o.id===purchaseId);
  return JSON.stringify({reference:r.reference,skuId:r.skuId,warehouse:r.warehouse,quantity:r.ordered,status:o.status,orderDate:o.orderDate,rows:r.rows});
}
export function latestHandoff(state,purchaseId){
  return (state.purchaseHandoffs||[]).filter(r=>r.purchaseId===purchaseId).at(-1)||null;
}
export function handoffCurrent(state,report){
  return Boolean(report&&report.reviewKey===reconciliationKey(state,report.purchaseId));
}
export function handoffInbox(state,userId){
  return (state.purchaseHandoffs||[]).filter(r=>r.recipients.some(u=>u.id===userId)).slice().reverse();
}
