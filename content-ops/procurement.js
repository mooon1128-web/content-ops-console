import {purchaseSummary,forecastSupply} from '../public/stock-ops/purchasing-math.js';

export function applyProcurement(s,action,p,user,now,h){
  const {fail,required,number,date,instant,stamp,skuExists,appendEvent}=h;
  const chinaDay=v=>new Date(Date.parse(v)+8*3600000).toISOString().slice(0,10);
  s.purchases??=[];s.purchaseReceipts??=[];s.purchaseInspections??=[];s.purchaseReturns??=[];s.forecasts??=[];
  if(action==='forecast'){
    skuExists(s,p.skuId);let result;try{result=forecastSupply(p.inputs)}catch(e){throw fail(400,e.message);}
    const record={...stamp({},user,now),skuId:p.skuId,inputs:structuredClone(p.inputs),result,basis:required(p.basis,'日均与库存假设依据',3000),status:'参考建议，未下单',salesSnapshot:s.monthly.filter(r=>r.skuId===p.skuId)};
    s.forecasts.push(record);return record;
  }
  if(action==='purchase'){
    const ref=required(p.reference,'补货批次号');if(s.purchases.some(r=>r.reference===ref&&r.skuId===p.skuId))throw fail(409,'此批次的该SKU已经登记');
    const quantity=number(p.quantity,'下单数量');if(!quantity)throw fail(400,'下单数量须大于0');
    if(!['计划','已下单'].includes(p.status))throw fail(400,'请选择计划或已下单');
    const row={...stamp({},user,now),reference:ref,skuId:skuExists(s,p.skuId),quantity,status:p.status,orderDate:date(p.orderDate),expectedAt:date(p.expectedAt),warehouse:required(p.warehouse,'仓库'),note:required(p.note,'工厂确认或计划说明',2000)};
    if(row.expectedAt<row.orderDate)throw fail(400,'预计到货日不能早于下单日');
    if(row.status==='已下单'&&row.orderDate>chinaDay(now))throw fail(400,'未来计划不能标为已下单');
    s.purchases.push(row);return row;
  }
  const order=s.purchases.find(r=>r.id===p.purchaseId);if(!order)throw fail(404,'补货批次不存在');
  if(action==='purchaseConfirm'){
    if(order.status!=='计划')throw fail(409,'批次已经确认');if(order.orderDate>chinaDay(now))throw fail(400,'未来计划不能标为已下单');order.status='已下单';order.confirmedAt=now;order.confirmation=required(p.note,'工厂下单确认依据',2000);order.updatedAt=now;order.actor=stamp({},user,now).actor;return order;
  }
  if(action==='purchaseReceive'){
    if(order.status!=='已下单')throw fail(400,'请先确认该批次已经下单');
    const ref=required(p.reference,'本次收货单号');if(s.purchaseReceipts.some(r=>r.purchaseId===order.id&&r.reference===ref))throw fail(409,'这次收货已经登记');
    const row={...stamp({},user,now),purchaseId:order.id,reference:ref,at:instant(p.at),good:number(p.good,'合格品'),defect:number(p.defect,'瑕疵品'),pending:number(p.pending,'待检品'),returnDecision:['需寄回','留仓处理'].includes(p.returnDecision)?p.returnDecision:'待确认',note:required(p.note,'验收说明',2000)};
    if(row.at>now)throw fail(400,'尚未到货不能提前入库');if(chinaDay(row.at)<order.orderDate)throw fail(400,'收货日不能早于下单日');if(!row.good&&!row.defect&&!row.pending)throw fail(400,'请填写实收数量');
    const current=purchaseSummary(order,s.purchaseReceipts,s.purchaseInspections,s.purchaseReturns);
    if(current.received+row.good+row.defect+row.pending>order.quantity&&!p.overReceiptReason?.trim())throw fail(400,'实收超过下单量，请填写超收原因');row.overReceiptReason=p.overReceiptReason||'';
    const base={skuId:order.skuId,warehouse:order.warehouse,at:row.at,ref:`purchase:${order.id}:${ref}`,note:row.note,source:{kind:'purchase',purchaseId:order.id,receiptId:row.id}};
    if(row.good)appendEvent(s,{...base,type:'receipt',quantity:row.good},user,now,true);
    if(row.defect+row.pending)appendEvent(s,{...base,type:'purchase_hold',quantity:row.defect+row.pending},user,now,true);
    s.purchaseReceipts.push(row);return row;
  }
  const receipt=s.purchaseReceipts.find(r=>r.id===p.receiptId&&r.purchaseId===order.id);if(!receipt)throw fail(404,'收货记录不存在');
  const inspections=s.purchaseInspections.filter(r=>r.receiptId===receipt.id),returned=s.purchaseReturns.filter(r=>r.receiptId===receipt.id).reduce((n,r)=>n+r.quantity,0);
  if(action==='purchaseDecision'){receipt.returnDecision=['需寄回','留仓处理'].includes(p.returnDecision)?p.returnDecision:'待确认';receipt.decisionNote=required(p.note,'处理说明',2000);receipt.updatedAt=now;return receipt;}
  const ref=required(p.reference,'本次处理单号'),at=instant(p.at),note=required(p.note,'处理依据',2000);if(at<receipt.at||at>now)throw fail(400,'处理时间须在收货后且已实际发生');
  if([...inspections,...s.purchaseReturns.filter(r=>r.receiptId===receipt.id)].some(r=>r.at>at))throw fail(409,'请按该收货单的实际处理时间顺序登记，历史差异请交管理员核对');
  const source={kind:'purchase',purchaseId:order.id,receiptId:receipt.id};
  if(action==='purchaseInspect'){
    if(s.purchaseInspections.some(r=>r.receiptId===receipt.id&&r.reference===ref))throw fail(409,'此次验收已登记');
    const good=number(p.good,'本次转合格'),defect=number(p.defect,'本次转瑕疵'),pending=receipt.pending-inspections.reduce((n,r)=>n+r.good+r.defect,0);if(good+defect<=0||good+defect>pending)throw fail(400,'验收数量超过剩余待检数量');
    if(good)appendEvent(s,{skuId:order.skuId,warehouse:order.warehouse,at,type:'inspect_good',quantity:good,ref:`purchase-inspect:${receipt.id}:${ref}`,note,source},user,now,true);
    const row={...stamp({},user,now),receiptId:receipt.id,reference:ref,good,defect,at,note};s.purchaseInspections.push(row);return row;
  }
  if(action==='purchaseReturn'){
    if(receipt.returnDecision!=='需寄回')throw fail(400,'请先将瑕疵品处理方式确认成需寄回');
    if(s.purchaseReturns.some(r=>r.receiptId===receipt.id&&r.reference===ref))throw fail(409,'此次退厂已经登记');
    const quantity=number(p.quantity,'实际寄回数量'),remaining=receipt.defect+inspections.reduce((n,r)=>n+r.defect,0)-returned;if(quantity<=0||quantity>remaining)throw fail(400,'寄回数量超过尚在仓库的瑕疵品');
    appendEvent(s,{skuId:order.skuId,warehouse:order.warehouse,at,type:'factory_return',quantity,ref:`purchase-return:${receipt.id}:${ref}`,note,source},user,now,true);
    const row={...stamp({},user,now),receiptId:receipt.id,reference:ref,quantity,at,note};s.purchaseReturns.push(row);return row;
  }
  throw fail(400,'不支持的补货操作');
}
