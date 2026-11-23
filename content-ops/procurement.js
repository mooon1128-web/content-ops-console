import {purchaseSummary,forecastSupply} from '../public/stock-ops/purchasing-math.js';

export function applyProcurement(s,action,p,user,now,h){
  const {fail,required,number,date,instant,stamp,skuExists,appendEvent}=h;
  const chinaDay=v=>new Date(Date.parse(v)+8*3600000).toISOString().slice(0,10);
  s.purchases??=[];s.purchaseReceipts??=[];s.purchaseInspections??=[];s.purchaseReturns??=[];s.forecasts??=[];
  function savePrivate(purchaseId,details){
    if(user.role!=='admin')throw fail(403,'合同与尾款仅管理员可登记');
    const balanceDue=number(details.balanceDue,'尾款金额',{optional:true,decimal:true});
    if(balanceDue!==null&&Math.abs(balanceDue*100-Math.round(balanceDue*100))>0.00001)throw fail(400,'尾款金额最多保留两位小数');
    const contracts=details.contracts||[];
    if(!Array.isArray(contracts)||contracts.length>20)throw fail(400,'每批次最多20张合同图片');
    const files=contracts.map(f=>{if(!/^[a-f0-9-]{36}$/.test(f.id||'')||!['image/png','image/jpeg','image/webp'].includes(f.mime)||!Number.isSafeInteger(f.bytes)||f.bytes<=0||f.bytes>10*1024*1024)throw fail(400,'合同图片资料无效');return {id:f.id,name:required(f.name,'合同图片名称',200),mime:f.mime,bytes:f.bytes};});
    s.purchasePrivate??={};const previous=s.purchasePrivate[purchaseId];
    const all=[...(previous?.contracts||[])];for(const f of files)if(!all.some(x=>x.id===f.id))all.push(f);
    if(all.length>20)throw fail(400,'每批次最多20张合同图片');
    s.purchasePrivate[purchaseId]={...stamp({},user,now),balanceDue,contracts:all,history:[...(previous?.history||[]),...(previous?[{at:previous.updatedAt,balanceDue:previous.balanceDue,contracts:previous.contracts}]:[])]};
  }
  if(action==='forecast'){
    skuExists(s,p.skuId);let result;try{result=forecastSupply(p.inputs)}catch(e){throw fail(400,e.message);}
    const record={...stamp({},user,now),skuId:p.skuId,inputs:structuredClone(p.inputs),result,basis:required(p.basis,'日均与库存假设依据',3000),status:'参考建议，未下单',salesSnapshot:s.monthly.filter(r=>r.skuId===p.skuId)};
    s.forecasts.push(record);return record;
  }
  if(action==='purchase'){
    const ref=required(p.reference,'补货批次号');if(s.purchases.some(r=>r.reference===ref&&r.skuId===p.skuId))throw fail(409,'此批次的该SKU已经登记');
    const quantity=number(p.quantity,'下单数量');if(!quantity)throw fail(400,'下单数量须大于0');
    if(!['计划','已下单'].includes(p.status))throw fail(400,'请选择计划或已下单');
    // Accept a legacy arrival-only form without silently changing its meaning.
    const expectedShipAt=p.expectedShipAt?date(p.expectedShipAt):null,expectedAt=p.expectedAt?date(p.expectedAt):null;
    if(!expectedShipAt&&!expectedAt)throw fail(400,'请填写预计出货时间');
    const row={...stamp({},user,now),reference:ref,skuId:skuExists(s,p.skuId),quantity,status:p.status,orderDate:date(p.orderDate),expectedShipAt,expectedAt,warehouse:required(p.warehouse,'仓库'),note:required(p.note,'工厂确认或计划说明',2000)};
    if(expectedShipAt&&expectedShipAt<row.orderDate)throw fail(400,'预计出货时间不能早于下单日');
    if(expectedAt&&expectedAt<(expectedShipAt||row.orderDate))throw fail(400,'预计到货日不能早于出货或下单日');
    if(row.status==='已下单'&&row.orderDate>chinaDay(now))throw fail(400,'未来计划不能标为已下单');
    s.purchases.push(row);if(p.privateDetails!==undefined)savePrivate(row.id,p.privateDetails);return row;
  }
  const order=s.purchases.find(r=>r.id===p.purchaseId);if(!order)throw fail(404,'补货批次不存在');
  if(action==='purchasePrivate'){savePrivate(order.id,p.privateDetails||{});return {kind:'purchasePrivate',purchaseId:order.id};}
  if(action==='purchaseSchedule'){
    const expectedShipAt=date(p.expectedShipAt),expectedAt=p.expectedAt?date(p.expectedAt):null,note=required(p.note,'出货时间确认依据',2000);
    if(expectedShipAt<order.orderDate)throw fail(400,'预计出货时间不能早于下单日');
    if(expectedAt&&expectedAt<expectedShipAt)throw fail(400,'预计到货日不能早于出货时间');
    order.scheduleHistory??=[];order.scheduleHistory.push({...stamp({},user,now),previous:{expectedShipAt:order.expectedShipAt||null,expectedAt:order.expectedAt||null},expectedShipAt,expectedAt,note});
    order.expectedShipAt=expectedShipAt;order.expectedAt=expectedAt;order.updatedAt=now;return order;
  }
  if(action==='purchaseShip'){
    if(order.status!=='已下单')throw fail(400,'请先确认该批次已经下单');
    const reference=required(p.reference,'出货单号或物流单号'),at=date(p.at),quantity=number(p.quantity,'本次出货数量'),note=required(p.note,'出货依据',2000);
    if(at<order.orderDate||at>chinaDay(now))throw fail(400,'实际出货时间须在下单后且已实际发生');
    order.shipments??=[];
    if(order.shipments.some(r=>r.reference===reference))throw fail(409,'这次出货已经登记');
    if(!quantity||quantity+order.shipments.reduce((n,r)=>n+r.quantity,0)>order.quantity)throw fail(400,'出货数量须大于0且累计不能超过下单数量');
    const row={...stamp({},user,now),reference,at,quantity,note};order.shipments.push(row);order.updatedAt=now;return row;
  }
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
