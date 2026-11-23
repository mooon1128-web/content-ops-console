// Amounts are summed in cents; missing amounts are never treated as zero.
export function balanceCents(value){
  if(value===null||value===undefined||value==='')return null;
  const amount=Number(value),cents=Math.round(amount*100);
  return Number.isFinite(amount)&&amount>=0&&Number.isSafeInteger(cents)&&Math.abs(amount*100-cents)<0.00001?cents:null;
}
export function paymentDueDate(expectedShipAt){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(expectedShipAt||''))return null;
  const stamp=Date.parse(expectedShipAt+'T00:00:00Z');
  if(!Number.isFinite(stamp)||new Date(stamp).toISOString().slice(0,10)!==expectedShipAt)return null;
  return new Date(stamp+15*86400000).toISOString().slice(0,10);
}
export function purchaseBalanceSummary(orders=[],privateRows={},today){
  const rows=orders.map(order=>{
    const priv=privateRows[order.id]||{},settlement=priv.settlement?.status==='已结清'?priv.settlement:null;
    const amountCents=settlement?settlement.amountCents:balanceCents(priv.balanceDue);
    const expectedShipAt=settlement?settlement.expectedShipAt:order.expectedShipAt||null;
    const dueAt=settlement?settlement.dueAt:paymentDueDate(expectedShipAt);
    const overdueDays=!settlement&&dueAt&&today?Math.max(0,Math.round((Date.parse(today+'T00:00:00Z')-Date.parse(dueAt+'T00:00:00Z'))/86400000)):0;
    return {order,settlement,amountCents,expectedShipAt,dueAt,overdueDays};
  });
  const pending=rows.filter(r=>!r.settlement).sort((a,b)=>(a.dueAt||'9999').localeCompare(b.dueAt||'9999')||a.order.reference.localeCompare(b.order.reference));
  const settled=rows.filter(r=>r.settlement).sort((a,b)=>b.settlement.settledAt.localeCompare(a.settlement.settledAt));
  return {pending,settled,totalCents:pending.reduce((sum,r)=>sum+(r.amountCents??0),0),unknownCount:pending.filter(r=>r.amountCents===null).length,missingDateCount:pending.filter(r=>!r.dueAt).length};
}
