export const addDays=(date,n)=>new Date(Date.parse(date+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
export const dayCount=(a,b)=>Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000)+1;
export function purchaseSummary(order,receipts=[],inspections=[],returns=[]){
  const rs=receipts.filter(r=>r.purchaseId===order.id),ids=new Set(rs.map(r=>r.id)),is=inspections.filter(i=>ids.has(i.receiptId)),rt=returns.filter(r=>ids.has(r.receiptId));
  const sum=(rows,key)=>rows.reduce((s,r)=>s+(r[key]||0),0);
  const received=sum(rs,'good')+sum(rs,'defect')+sum(rs,'pending'),good=sum(rs,'good')+sum(is,'good'),defect=sum(rs,'defect')+sum(is,'defect'),returned=sum(rt,'quantity');
  return {received,good,defect,pending:sum(rs,'pending')-sum(is,'good')-sum(is,'defect'),returned,defectInWarehouse:defect-returned,shortfall:Math.max(0,order.quantity-received),over:Math.max(0,received-order.quantity)};
}
export function forecastSupply(input){
  const date=(v,label)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||addDays(v,0)!==v)throw Error(label+'不正确');return v;};
  const n=(key,positive=false,integer=false)=>{if(input[key]===''||input[key]===null||input[key]===undefined)throw Error('请补齐测算条件，未知不能填0');const v=Number(input[key]);if(!Number.isFinite(v)||v<0||(positive&&v===0)||(integer&&!Number.isSafeInteger(v))||v>1e7)throw Error('测算条件含无效数量');return v;};
  const start=date(input.asOf,'库存日期'),orderDate=date(input.orderDate,'本次计划下单日'),target=date(input.target,'目标日期'),days=dayCount(start,target);if(days<1||days>730)throw Error('目标日期须在库存日期之后两年内');
  if(orderDate<start||orderDate>target)throw Error('计划下单日须在库存日期与目标日之间');
  const available=n('available',false,true),daily=n('daily',true),lead=n('leadDays',false,true),transport=n('transportDays',false,true),pause=n('pauseDays',false,true),buffer=n('bufferDays',false,true),safety=n('safetyDays'),moq=n('moq',true,true),pack=n('packSize',true,true),other=n('otherDemand',false,true);
  const wait=lead+transport+pause+buffer;if(wait>730)throw Error('到货等待期超过两年，请核对');
  if(!Array.isArray(input.inTransit||[])||(input.inTransit||[]).length>1000)throw Error('在途数据格式不正确');
  const arrival=addDays(orderDate,wait),inTransit=(input.inTransit||[]).map(r=>{const at=date(r.at,'在途到货日期'),quantity=Number(r.quantity);if(!Number.isSafeInteger(quantity)||quantity<0)throw Error('在途数量无效');if(quantity&&at<orderDate)throw Error('有逾期未收货的补货批次，请先核实预计到货日');return {at,quantity};}).filter(r=>r.at>=start&&r.at<=target);
  const inbound=inTransit.reduce((s,r)=>s+r.quantity,0),demand=daily*days+other,safe=daily*safety,shortage=Math.max(0,demand+safe-available-inbound);
  const quantity=shortage>1e-9?Math.ceil(Math.max(moq,Math.ceil(shortage))/pack)*pack:0;
  let stock=available-other,firstShortage=null,gapBeforeArrival=0;
  for(let d=0;d<days;d++){const at=addDays(start,d);stock+=inTransit.filter(r=>r.at===at).reduce((s,r)=>s+r.quantity,0);if(at===arrival){gapBeforeArrival=Math.max(gapBeforeArrival,-stock);stock+=quantity;}stock-=daily;if(stock<0&&!firstShortage)firstShortage=at;if(at<arrival)gapBeforeArrival=Math.max(gapBeforeArrival,-stock);}
  const targetBalance=available+inbound+(arrival<=target?quantity:0)-demand;
  const coveredDays=Math.floor(Math.max(0,available+inbound+quantity-other)/daily);if(coveredDays>36500)throw Error('预计覆盖期超过100年，请核对日均或数量');
  return {quantity,arrival,firstShortage,gapBeforeArrival:Math.ceil(Math.max(0,gapBeforeArrival)),targetBalance:Math.floor(targetBalance),coverageThrough:coveredDays?addDays(start,coveredDays-1):null,canArriveByTarget:arrival<=target,daily,days,knownInbound:inbound,waitDays:wait};
}
