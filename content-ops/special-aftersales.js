// Customer-owned goods are held on this ledger, outside company stock.
export const specialTypes = {repair:'维修原件寄回',exchange:'换货',reship:'缺件／补发',unknown:'来件待认领'};
const outbound = ['ship_repair','replacement','return_good','return_hold'];
export function specialSummary(c) {
  const sum = stage => (c.history || []).filter(h=>h.stage===stage).reduce((n,h)=>n+(h.quantity||0),0);
  const received=sum('receive'),repairSent=sum('ship_repair'),replaced=sum('replacement');
  const stocked=sum('return_good')+sum('return_hold'),held=received-repairSent-stocked;
  const ready=c.type!=='unknown' && received===c.returnQty && held===0 && replaced===c.replacementQty;
  const status=c.closedAt?'已完成':c.type==='unknown'?'待认领':ready?'待客服结案':
    c.progress==='待到货'&&replaced<c.replacementQty?'待到货':
    held>0?(c.progress||'待检测'):received<c.returnQty?'待收件':'待补发';
  return {received,repairSent,replaced,stocked,held,ready,status};
}

export function applySpecial(s,action,p,user,now,helpers) {
  const {fail,text,required,number,date,instant,skuExists,stamp,appendEvent,balance}=helpers;
  const role=user.role==='admin'?'admin':user.stockRole;
  const service=()=>{if(!['admin','customer_service','pr_service','operations'].includes(role))throw fail(403,'请客服或管理员核对处理方案');};
  const warehouse=()=>{if(!['admin','warehouse'].includes(role))throw fail(403,'实物交接仅仓管或管理员可确认');};
  const plan = input => {
    const type=required(input.type,'处理类型');if(!specialTypes[type])throw fail(400,'特殊件类型不正确');
    const unknown=type==='unknown';
    const row={reference:required(input.reference,'工单／售后编号'),type,
      channel:unknown?text(input.channel)||'待认领':required(input.channel,'原订单平台'),
      order:unknown?text(input.order):required(input.order,'原订单号'),
      skuId:unknown&&!input.skuId?null:skuExists(s,input.skuId),
      replacementSkuId:input.replacementSkuId?skuExists(s,input.replacementSkuId):null,
      returnQty:number(input.returnQty,'预计退回数量'),replacementQty:number(input.replacementQty,'需补发新品数量'),
      owner:required(input.owner,'内部负责人'),dueDate:input.dueDate?date(input.dueDate):null,
      nextAction:required(input.nextAction,'下一步处理事项',2000),reason:required(input.reason,'处理要求',2000)};
    if(!unknown&&row.channel==='待认领')throw fail(400,'认领后请填写实际平台');
    if(['repair','unknown'].includes(type)&&(row.returnQty<1||row.replacementQty!==0))throw fail(400,'维修或待认领件需有退回数量，不能同时安排新品补发');
    if(type==='exchange'&&(row.returnQty<1||row.replacementQty<1))throw fail(400,'换货需分别填写退回数量和新品补发数量');
    if(type==='reship'&&(row.returnQty!==0||row.replacementQty<1))throw fail(400,'纯补发不要求退回；有旧件退回请选择换货');
    if(row.replacementQty&&!row.replacementSkuId)throw fail(400,'请选择实际补发新品SKU');
    return row;
  };
  const collision = (row,id) => {
    if((s.specialCases||[]).some(c=>c.id!==id&&c.reference===row.reference&&c.channel===row.channel)||s.cases.some(c=>c.reference===row.reference&&c.channel===row.channel))throw fail(409,'该售后单已有记录，请继续原工单，不能重复登记');
  };
  if(action==='specialCase') {
    const row={...stamp({},user,now),...plan(p),createdAt:now,location:'',progress:'',closedAt:null,history:[]};
    if(role==='warehouse'&&row.type!=='unknown')throw fail(403,'仓管可登记待认领来件，处理方案由客服登记');
    collision(row);
    row.history.push({...stamp({},user,now),stage:'create',at:now,note:row.reason});
    (s.specialCases??=[]).push(row);return row;
  }
  const c=s.specialCases?.find(c=>c.id===p.caseId);if(!c)throw fail(404,'特殊售后工单不存在');
  if(c.closedAt)throw fail(409,'工单已结案，不能继续出入库；新一轮售后需另建工单');
  const before=specialSummary(c);
  if(action==='specialPlan') {
    service();const updated=plan(p);collision(updated,c.id);
    if(c.history.some(h=>outbound.includes(h.stage))&&['type','skuId','replacementSkuId','channel','order','reference'].some(k=>c[k]!==updated[k]))throw fail(409,'已有实物寄出或转库，不能更换订单、SKU或处理类型，请先登记待核事项');
    if(c.type!=='unknown'&&updated.type==='unknown')throw fail(400,'已认领工单不能改回未知件');
    if(updated.returnQty<before.received||updated.replacementQty<before.replaced)throw fail(400,'计划数量不能小于已经实际处理的数量');
    const oldPlan=Object.fromEntries(Object.keys(updated).map(k=>[k,c[k]]));
    if(c.type!==updated.type)c.progress=before.held?'待检测':'';
    Object.assign(c,updated,{updatedAt:now});
    const h={...stamp({},user,now),stage:'plan',at:now,note:required(p.note,'更改依据',2000),before:oldPlan,after:updated};c.history.push(h);return {caseId:c.id,...h};
  }
  if(action==='specialClose') {
    service();if(!before.ready)throw fail(422,'仍有未收到、未寄回、未转库或未补发的数量，不能结案');
    const h={...stamp({},user,now),stage:'close',at:now,note:required(p.note,'结案核对依据',2000)};
    c.closedAt=now;c.updatedAt=now;c.nextAction='已完成';c.history.push(h);return {caseId:c.id,...h};
  }
  warehouse();
  const stage=required(p.stage,'处理动作');
  if(!['receive','progress',...outbound].includes(stage))throw fail(400,'特殊件动作不正确');
  const at=instant(p.at);if(at>now)throw fail(400,'尚未发生的实物操作不能提前登记');
  const lastAt=c.history.filter(h=>h.stage!=='create'&&h.stage!=='plan').at(-1)?.at;
  if(lastAt&&at<lastAt)throw fail(409,'处理时间不能早于上一笔实物交接');
  const h={...stamp({},user,now),stage,at,note:required(p.note,'处理依据',2000),nextAction:required(p.nextAction,'下一步事项',2000)};
  if(stage==='progress') {
    if(!['待检测','维修中','待到货','待寄回','待发货'].includes(p.progress))throw fail(400,'请选择有效处理阶段');
    if(['维修中','待寄回'].includes(p.progress)&&(c.type!=='repair'||before.held<1))throw fail(400,'只有实际收到的维修原件才能登记维修或待寄回');
    if(p.progress==='待到货'&&before.replaced>=c.replacementQty)throw fail(400,'没有待补发新品，无需登记等货');
    c.progress=p.progress;h.progress=p.progress;
    c.location=before.held>0?required(p.location,'特殊件存放位置'):text(p.location)||c.location;h.location=c.location;
  } else {
    const q=number(p.quantity,'本次实际件数');if(q<1)throw fail(400,'实际件数必须大于0');
    h.quantity=q;h.ref=required(p.ref,stage==='receive'?'来件交接单号／退回运单号':'出入库单号／寄回运单号');
    if(c.history.some(x=>x.stage===stage&&x.ref===h.ref))throw fail(409,'该单据动作已登记，不可重复处理');
    if(stage==='receive') {
      if(before.received+q>c.returnQty)throw fail(422,'收件数量超过预计退回数量，请客服先核对');
      h.location=required(p.location,'特殊件存放位置');
      if(before.held>0&&h.location!==c.location)throw fail(422,'同一工单的在手件请存放在同一位置；移位先登记进度和新位置');
      c.location=h.location;c.progress='待检测';
    } else {
      if(c.type==='unknown'||!c.order||!c.skuId)throw fail(422,'请客服先认领原订单与SKU，不能凭未知来件发货或入库');
      if(stage==='ship_repair') {
        if(c.type!=='repair'||c.progress!=='待寄回')throw fail(422,'维修件需先确认维修完成并标为待寄回');
        if(q>before.held)throw fail(422,'寄回数量超过在手维修原件');
      } else if(stage==='replacement') {
        if(!['exchange','reship'].includes(c.type)||q+before.replaced>c.replacementQty)throw fail(422,'新品补发数量超过剩余计划');
      } else {
        if(c.type!=='exchange'||q>before.held)throw fail(422,'仅已收到的换货旧件可验收转入公司库存；维修原件不可转入');
      }
      if(stage!=='ship_repair') {
        const skuId=stage==='replacement'?c.replacementSkuId:c.skuId;
        if(stage==='replacement'&&!balance(s,skuId,p.warehouse,at))throw fail(422,'补发仓库尚无实盘基准，请先核对库存再出库');
        const event=appendEvent(s,{...p,type:stage,skuId,ref:`special:${c.id}:${h.ref}`,source:{kind:'special',specialCaseId:c.id,reference:c.reference},note:h.note},user,now,true);
        h.eventId=event.id;h.warehouse=event.warehouse;
      }
    }
  }
  c.history.push(h);c.nextAction=h.nextAction;c.updatedAt=now;
  if(specialSummary(c).held===0)c.location='';
  return {caseId:c.id,...h};
}
