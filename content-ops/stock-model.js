import { randomUUID, createHash } from 'node:crypto';
import { applySpecial, specialSummary } from './special-aftersales.js';
import { importCatalog } from './catalog-import.js';
import { applyProcurement } from './procurement.js';
import {addSalesRecipe,calculateComponentSales,digest,recipesDigest,SALES_COMPONENT_BASIS} from './sales-components.js';

export const fail = (status, message) => Object.assign(new Error(message), {status});
export const roles = ['none','viewer','warehouse','operations','marketing','customer_service','pr','content','pr_service'];
export const roleOf = user => user.role === 'admin' ? 'admin' : roles.includes(user.stockRole) ? user.stockRole : 'none';
export const hasStockRole=(user,...wanted)=>wanted.includes(roleOf(user))||(roleOf(user)==='pr_service'&&wanted.some(r=>['pr','customer_service'].includes(r)));
const permissions = {
  sku: ['admin','operations'], monthly: ['admin','operations'], snapshot: ['admin','warehouse'],
  observation: ['admin','operations'], event: ['admin','warehouse'], sample: ['admin','warehouse'], week: ['admin','warehouse'],
  case: ['admin','operations','warehouse','customer_service'], caseAction: ['admin','warehouse'], issue: ['admin','operations','warehouse','customer_service'],
  specialCase: ['admin','operations','customer_service','warehouse'], specialPlan: ['admin','operations','customer_service'],
  specialAction: ['admin','warehouse'], specialClose: ['admin','operations','customer_service'],
  reverse: ['admin'], import: ['admin'], costArchive: ['admin'], purchasePrivate:['admin'], purchaseSettle:['admin'], purchaseReopen:['admin'],
  collection: ['admin','operations'], collectionStatus: ['admin','operations'], collectionResult: ['admin','operations'], collectionAccept: ['admin','operations'],
  catalogImport: ['admin'],
  salesRecipe: ['admin','operations'],
  purchase:['admin','operations'],purchaseSchedule:['admin','operations'],purchaseShip:['admin','operations','warehouse'],purchaseConfirm:['admin','operations'],purchaseReceive:['admin','warehouse'],purchaseInspect:['admin','warehouse'],purchaseDecision:['admin','warehouse'],purchaseReturn:['admin','warehouse'],forecast:['admin','operations'],
};
export function authorize(user, action) {
  if (!hasStockRole(user,...(permissions[action] || []))) throw fail(403,'当前账号没有此操作权限');
}
const text = (v, max=500) => String(v ?? '').trim().slice(0,max);
const required = (v,label,max=100) => {const s=text(v,max); if(!s)throw fail(400,`请填写${label}`);return s;};
function number(v,label,{optional=false,signed=false,decimal=false}={}) {
  if (v === '' || v === null || v === undefined) {if(optional)return null;throw fail(400,`请填写${label}，未知不能填0`);}
  const n=Number(v);if(!Number.isFinite(n)||(!signed&&n<0)||(!decimal&&!Number.isSafeInteger(n))||Math.abs(n)>1e9)throw fail(400,`${label}不是有效数字`);return n;
}
function date(v) {const s=required(v,'日期');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw fail(400,'日期不正确');return s;}
function instant(v) {if(!v||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v)))throw fail(400,'请填写带时区的截止时间');return new Date(v).toISOString();}
export function chinaDate(now=new Date()) {return new Date(new Date(now).getTime()+8*3600000).toISOString().slice(0,10);}
export function saturday(now=new Date()) {const d=new Date(chinaDate(now)+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+1)%7));return d.toISOString().slice(0,10);}
export function emptyStock() {return {schema:1,revision:0,updatedAt:null,skus:[],monthly:[],snapshots:[],observations:[],events:[],cases:[],issues:[],audit:[],requests:[]};}
function monthsBetween(start,end) {const list=[];for(let y=Number(start.slice(0,4)),m=Number(start.slice(5,7));`${y}-${String(m).padStart(2,'0')}`<=end.slice(0,7);){list.push(`${y}-${String(m).padStart(2,'0')}`);if(++m===13){y++;m=1}if(list.length>24)throw fail(400,'一次最多采集24个月');}return list;}
export const eventTypes = {
  purchase_hold:'采购瑕疵／待检入库', receipt: '合格采购入库', sale: '销售出库', offline: '线下出库', sample: '博主寄样出库', replacement: '换货／补发出库',
  reserve: '预留库存', release: '释放预留', return_hold: '退回待检入库', return_good: '退回验收合格',
  inspect_good: '待检转合格', damage: '合格转坏品', factory_return: '坏品退厂', adjust: '盘点调整',
};
export function eventDelta(type,q,released=0) {
  if(['sale','offline','sample','replacement'].includes(type))return {good:-q,reserved:-released,hold:0};
  return ({purchase_hold:{good:0,reserved:0,hold:q},receipt:{good:q,reserved:0,hold:0},reserve:{good:0,reserved:q,hold:0},release:{good:0,reserved:-q,hold:0},return_hold:{good:0,reserved:0,hold:q},return_good:{good:q,reserved:0,hold:0},inspect_good:{good:q,reserved:0,hold:-q},damage:{good:-q,reserved:0,hold:q},factory_return:{good:0,reserved:0,hold:-q},adjust:{good:q,reserved:0,hold:0}})[type];
}
export function balance(state,skuId,warehouse,at='9999-12-31T23:59:59.999Z',excludeSnapshot=null) {
  const base=state.snapshots.filter(s=>s.skuId===skuId&&s.warehouse===warehouse&&s.at<=at&&s.id!==excludeSnapshot).sort((a,b)=>b.at.localeCompare(a.at))[0];
  if(!base)return null;
  const sums={good:base.good,reserved:base.reserved,hold:base.hold};
  for(const e of state.events.filter(e=>e.skuId===skuId&&e.warehouse===warehouse&&e.at>base.at&&e.at<=at))for(const k of Object.keys(sums))sums[k]+=e.delta[k];
  return {...sums,available:sums.good-sums.reserved,baseAt:base.at};
}
function skuExists(s,id) {if(!s.skus.some(k=>k.id===id))throw fail(400,'SKU不存在，请先建档');return id;}
function stamp(p,user,now) {return {id:p.id||randomUUID(),updatedAt:now,actor:{id:user.id,name:user.name,username:user.username}};}
function uniqueUpsert(rows,row,key) {const index=rows.findIndex(r=>r.id===row.id);if(rows.some(r=>r.id!==row.id&&key(r)===key(row)))throw fail(409,'同一口径已有记录，请编辑原记录');if(index<0)rows.push(row);else rows[index]=row;}

function appendEvent(s,p,user,now,internal=false) {
  const type=required(p.type,'流水类型');if(!eventTypes[type]||(!internal&&['sample','replacement','return_good','return_hold','purchase_hold'].includes(type)))throw fail(400,'请从寄样或售后记录确认此类出入库');
  if(type==='adjust'&&user.role!=='admin')throw fail(403,'盘点调整需要管理员核对差额后登记');
  const quantity=number(p.quantity,'数量',{signed:type==='adjust'});if(quantity===0)throw fail(400,'流水数量不能为0');
  const released=number(p.released??0,'本次释放预留');if(released>Math.max(0,quantity))throw fail(400,'释放预留不能大于出库数量');
  const ref=required(p.ref,'单据／业务编号');
  const row={...stamp({},user,now),skuId:skuExists(s,p.skuId),warehouse:required(p.warehouse,'仓库'),at:instant(p.at),type,quantity,released,ref,note:required(p.note,'来源或原因',2000),source:p.source||null,delta:eventDelta(type,quantity,released)};
  if(row.at>now)throw fail(400,'尚未发生的出入库不能提前记为实物流水');
  if(s.events.some(e=>e.type===type&&e.skuId===row.skuId&&e.warehouse===row.warehouse&&e.ref===ref&&!s.events.some(r=>r.reverses===e.id)))throw fail(409,'此单据的该SKU已记账，不能重复扣减');
  const latest=s.snapshots.filter(x=>x.skuId===row.skuId&&x.warehouse===row.warehouse).sort((a,b)=>b.at.localeCompare(a.at))[0];
  if(latest&&row.at<=latest.at)throw fail(409,'这笔流水早于最新盘点截止。请记入待核事项，核对后由管理员处理，避免重复影响基准');
  const checkTimes=[row.at,...s.events.filter(e=>e.skuId===row.skuId&&e.warehouse===row.warehouse&&e.at>row.at).map(e=>e.at)];
  for(const at of checkTimes){const b=balance(s,row.skuId,row.warehouse,at);if(b){const after={};for(const k of ['good','reserved','hold'])after[k]=b[k]+row.delta[k];if(after.good<0||after.reserved<0||after.hold<0||after.reserved>after.good)throw fail(422,'流水会导致负库存或预留超过合格库存，请核对盘点及预留数量');}}
  s.events.push(row);return row;
}
function apply(s,action,p,user,now,context={}) {
  authorize(user,action);
  if(['purchase','purchasePrivate','purchaseSettle','purchaseReopen','purchaseSchedule','purchaseShip','purchaseConfirm','purchaseReceive','purchaseInspect','purchaseDecision','purchaseReturn','forecast'].includes(action))return applyProcurement(s,action,p,user,now,{fail,required,number,date,instant,stamp,skuExists,appendEvent});
  if(action==='catalogImport')return importCatalog(s,p,user,now,{fail});
  if(action==='salesRecipe')return addSalesRecipe(s,p,user,now);
  if(action==='sku') {
    const row={...s.skus.find(k=>k.id===p.id),...stamp(p,user,now),code:required(p.code,'统一SKU编码'),name:required(p.name,'款式名称'),spec:text(p.spec),category:text(p.category),status:['停用','待核'].includes(p.status)?p.status:'在售',warehouse:required(p.warehouse||'主仓','默认仓库'),barcode:text(p.barcode),taobaoItemId:text(p.taobaoItemId),taobaoSkuId:text(p.taobaoSkuId),xhsProductId:text(p.xhsProductId),xhsSkuId:text(p.xhsSkuId),influencerProductId:text(p.influencerProductId),leadDays:number(p.leadDays,'工期',{optional:true}),moq:number(p.moq,'起订量',{optional:true}),note:text(p.note,2000)};
    row.costSkuId=text(p.costSkuId);row.costLinkStatus=text(p.costLinkStatus);
    for(const field of ['taobaoSkuId','xhsSkuId'])if(row[field]&&(s.skus.some(k=>k.id!==row.id&&k[field]===row[field])||(s.platformMappings||[]).some(m=>m.skuId!==row.id&&m.platform===(field==='taobaoSkuId'?'淘宝':'小红书')&&m.platformSkuId===row[field])))throw fail(409,`${field}已绑定另一个SKU`);
    uniqueUpsert(s.skus,row,k=>k.code);return row;
  }
  if(action==='monthly') {
    const month=required(p.month,'月份');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw fail(400,'月份格式应为YYYY-MM');
    const paid=number(p.paid,'支付件数',{optional:true}),refund=number(p.refund,'成功整件退款件数',{optional:true});
    if(paid!==null&&refund!==null&&refund>paid)throw fail(400,'同一支付订单口径下退款件数不能超过支付件数');
    const row={...stamp(p,user,now),skuId:skuExists(s,p.skuId),month,channel:required(p.channel,'销售平台'),through:date(p.through),paid,refund,net:paid===null||refund===null?null:paid-refund,payAmount:number(p.payAmount,'支付金额',{optional:true,decimal:true}),refundAmount:number(p.refundAmount,'成功退款金额',{optional:true,decimal:true}),basis:'按支付月订单追踪成功整件退款',refundAsOf:date(p.refundAsOf),source:required(p.source,'数据来源',2000),note:text(p.note,2000)};
    if(!row.through.startsWith(month)||row.refundAsOf<row.through)throw fail(400,'销售截止须在该月份，退款核对截止不能早于销售截止');
    uniqueUpsert(s.monthly,row,k=>`${k.skuId}|${k.channel}|${k.month}`);return row;
  }
  if(action==='snapshot') {
    const row={...stamp({},user,now),skuId:skuExists(s,p.skuId),warehouse:required(p.warehouse,'仓库'),at:instant(p.at),good:number(p.good,'合格实物数量'),reserved:number(p.reserved,'其中预留数量'),hold:number(p.hold,'坏品／待检数量'),source:required(p.source,'盘点依据',2000)};
    if(row.reserved>row.good)throw fail(400,'预留数量不能超过合格实物');
    if(row.at>now)throw fail(400,'不能提交未来时点的实物盘点');
    if(s.snapshots.some(x=>x.skuId===row.skuId&&x.warehouse===row.warehouse&&x.at>=row.at))throw fail(409,'请使用晚于该SKU上次盘点的截止时间');
    if(s.events.some(x=>x.skuId===row.skuId&&x.warehouse===row.warehouse&&x.at>row.at))throw fail(409,'已有晚于此截止时间的流水，请完成当下盘点');
    row.available=row.good-row.reserved;row.expected=balance(s,row.skuId,row.warehouse,row.at);row.gap=row.expected?row.good-row.expected.good:null;row.reservedGap=row.expected?row.reserved-row.expected.reserved:null;row.holdGap=row.expected?row.hold-row.expected.hold:null;
    s.snapshots.push(row);
    if(row.expected&&[row.gap,row.reservedGap,row.holdGap].some(v=>v!==0))s.issues.push({...stamp({},user,now),skuId:row.skuId,title:'盘点差额待核',quantity:row.gap,status:'待核',detail:`${row.warehouse} ${row.at}：合格差额${row.gap}；预留差额${row.reservedGap}；坏品待检差额${row.holdGap}。本次实盘作为后续基准，差额原因尚未核实。`,source:`盘点记录 ${row.id}`});
    return row;
  }
  if(action==='week') {
    if(!Array.isArray(p.rows)||!p.rows.length||p.rows.length>1000)throw fail(400,'请至少填写一款盘点数据');
    return p.rows.map(row=>apply(s,'snapshot',row,user,now,context));
  }
  if(action==='observation') {
    const row={...stamp(p,user,now),skuId:skuExists(s,p.skuId),date:date(p.date),available:number(p.available,'已确认可售库存'),source:required(p.source,'来源及截止说明',2000)};uniqueUpsert(s.observations,row,k=>k.id);return row;
  }
  if(action==='event')return appendEvent(s,p,user,now);
  if(action==='reverse') {
    const original=s.events.find(e=>e.id===p.eventId);if(!original||original.reverses||original.source)throw fail(400,'关联寄样／售后的流水请先记待核事项；普通流水可冲正');
    if(s.events.some(e=>e.reverses===original.id))throw fail(409,'该流水已经冲正');
    const at=instant(p.at),latest=s.snapshots.filter(x=>x.skuId===original.skuId&&x.warehouse===original.warehouse).sort((a,b)=>b.at.localeCompare(a.at))[0];
    if(at<original.at||latest&&original.at<=latest.at)throw fail(409,'原流水已进入盘点基准，请先核对盘点差异');
    const row={...original,...stamp({},user,now),at,type:'reverse',ref:`冲正:${original.id}`,reverses:original.id,note:required(p.note,'冲正原因',2000),quantity:-original.quantity,delta:Object.fromEntries(Object.entries(original.delta).map(([k,v])=>[k,-v]))};
    const b=balance(s,row.skuId,row.warehouse,at);if(b){const g=b.good+row.delta.good,r=b.reserved+row.delta.reserved,h=b.hold+row.delta.hold;if(g<0||r<0||h<0||r>g)throw fail(422,'冲正后库存不合法，请核对后续流水');}s.events.push(row);return row;
  }
  if(action==='sample') {
    const placement=context.placements?.find(x=>String(x.id)===String(p.placementId));if(!placement)throw fail(400,'找不到原推广记录，请刷新寄样任务');
    const sku=s.skus.find(k=>k.id===p.skuId);if(!sku)throw fail(400,'请指定实际寄样SKU');
    const shipment=required(p.shipment,'本次寄样出库单号');
    return appendEvent(s,{...p,type:'sample',ref:`sample:${placement.id}:${shipment}`,source:{kind:'sample',placementId:String(placement.id),shipment,creator:text(placement.creator),product:text(placement.product)},note:required(p.note,'实际寄出依据',2000)},user,now,true);
  }
  if(action==='case') {
    const row={...stamp({},user,now),reference:required(p.reference,'售后单号'),order:required(p.order,'原订单号'),channel:required(p.channel,'平台'),skuId:skuExists(s,p.skuId),replacementSkuId:skuExists(s,p.replacementSkuId||p.skuId),replacementQty:number(p.replacementQty,'需补发件数'),returnQty:number(p.returnQty,'应退回件数'),reason:required(p.reason,'售后原因',2000),status:'处理中'};
    if([...s.cases,...(s.specialCases||[])].some(c=>c.reference===row.reference&&c.channel===row.channel))throw fail(409,'售后单已登记');s.cases.push(row);return row;
  }
  if(action==='caseAction') {
    const c=s.cases.find(x=>x.id===p.caseId);if(!c)throw fail(404,'售后单不存在');
    const outbound=p.stage==='replacement';if(!['replacement','return_good','return_hold'].includes(p.stage))throw fail(400,'售后动作不正确');
    const used=s.events.filter(e=>e.source?.caseId===c.id&&(outbound?e.type==='replacement':['return_good','return_hold'].includes(e.type))).reduce((a,e)=>a+e.quantity,0);
    const q=number(p.quantity,'数量');if(used+q>(outbound?c.replacementQty:c.returnQty))throw fail(400,'本次数量超过售后剩余待处理数量');
    const e=appendEvent(s,{...p,type:p.stage,skuId:outbound?c.replacementSkuId:c.skuId,ref:`case:${c.id}:${required(p.ref,'出入库单号')}`,source:{kind:'case',caseId:c.id,reference:c.reference}},user,now,true);
    const shipped=s.events.filter(e=>e.source?.caseId===c.id&&e.type==='replacement').reduce((a,e)=>a+e.quantity,0),returned=s.events.filter(e=>e.source?.caseId===c.id&&['return_good','return_hold'].includes(e.type)).reduce((a,e)=>a+e.quantity,0);c.status=shipped===c.replacementQty&&returned===c.returnQty?'出入库已登记':'处理中';return e;
  }
  if(['specialCase','specialPlan','specialAction','specialClose'].includes(action))return applySpecial(s,action,p,user,now,{fail,text,required,number,date,instant,skuExists,stamp,appendEvent,balance});
  if(action==='issue') {
    const row={...stamp(p,user,now),skuId:skuExists(s,p.skuId),title:required(p.title,'待核事项'),detail:required(p.detail,'依据与说明',4000),status:p.status==='已解决'?'已解决':'待核',quantity:number(p.quantity,'待核数量',{optional:true,signed:true}),source:text(p.source,2000)};uniqueUpsert(s.issues,row,k=>k.id);return row;
  }
  if(action==='costArchive') {
    if(!p.source||!Array.isArray(p.sheets)||p.sheets.length>100||!(/^[a-f0-9]{64}$/i).test(p.source.sha256||''))throw fail(400,'成本工作簿来源或校验码不正确');
    const names=new Set();
    for(const sheet of p.sheets){if(!sheet.name||names.has(sheet.name)||!Array.isArray(sheet.rows)||sheet.rows.length>10000)throw fail(400,'成本工作表数据不正确');names.add(sheet.name);for(const r of sheet.rows)if(!Number.isInteger(r.row)||r.row<1||!Array.isArray(r.values)||r.values.length>200||r.values.some(v=>v!==null&&!['number','string','boolean'].includes(typeof v)))throw fail(400,'成本单元格格式不正确');}
    s.costWorkbook={...structuredClone(p),importedAt:now,actor:stamp({},user,now).actor};
    return {kind:'costArchive',source:p.source,sheets:p.sheets.map(x=>({name:x.name,rows:x.rows.length}))};
  }
  if(action==='collection') {
    const start=date(p.start),end=date(p.end),refundAsOf=date(p.refundAsOf);
    if(!start.endsWith('-01')||end<start||refundAsOf<end||end>chinaDate(now)||refundAsOf>chinaDate(now))throw fail(400,'从月初开始采集；销售截止及退款核对不能晚于今天，退款核对不能早于销售截止');
    monthsBetween(start,end);
    if(!Array.isArray(p.skuIds)||!p.skuIds.length||p.skuIds.some(id=>!s.skus.some(k=>k.id===id)))throw fail(400,'请选择有效SKU');
    if(!Array.isArray(p.channels)||!p.channels.length||p.channels.some(c=>!['淘宝','小红书'].includes(c)))throw fail(400,'请选择淘宝或小红书');
    const row={...stamp({},user,now),title:required(p.title,'任务名称'),start,end,refundAsOf,skuIds:[...new Set(p.skuIds)],channels:[...new Set(p.channels)],status:'待执行',mode:'对话触发',note:text(p.note,2000),results:[],evidence:[],history:[]};(s.collections??=[]).push(row);return row;
  }
  if(['collectionStatus','collectionResult','collectionAccept'].includes(action)) {
    const job=s.collections?.find(j=>j.id===p.jobId);if(!job)throw fail(404,'采集任务不存在');
    if(job.status==='已入账')throw fail(409,'本次结果已经入账；修订请另建任务保留旧记录');
    if(action==='collectionStatus'){
      if(!['待执行','采集中','需登录验证','待补资料'].includes(p.status))throw fail(400,'任务状态不正确');
      job.status=p.status;job.note=required(p.note,'进度或缺失原因',2000);job.history.push({...stamp({},user,now),status:job.status,note:job.note});return job;
    }
    if(action==='collectionResult'){
      if(!Array.isArray(p.evidence)||!p.evidence.length)throw fail(400,'采集结果须包含来源证据');
      const calculation=calculateComponentSales(s,job,p);
      if(job.calculation)(job.resultVersions??=[]).push({calculation:job.calculation,results:job.results,evidence:job.evidence,monthlyBaseline:job.monthlyBaseline,archivedAt:now});
      job.calculation={...calculation,computedAt:now};delete job.calculation.rows;
      p={...p,rows:calculation.rows};
      const expected=new Set(monthsBetween(job.start,job.end).flatMap(m=>job.skuIds.flatMap(id=>job.channels.map(c=>`${id}|${m}|${c}`))));
      const staged=[];const scratch=structuredClone(s);
      for(const r of p.rows){const key=`${r.skuId}|${r.month}|${r.channel}`;if(!expected.delete(key))throw fail(400,'结果存在重复记录或超出任务范围');
        const monthEnd=new Date(Date.UTC(Number(r.month.slice(0,4)),Number(r.month.slice(5,7)),0)).toISOString().slice(0,10);const through=monthEnd<job.end?monthEnd:job.end;
        if(r.through!==through||r.refundAsOf!==job.refundAsOf||r.paid===null||r.paid===undefined||r.paid===''||r.refund===null||r.refund===undefined||r.refund==='')throw fail(400,'结果截止日期必须符合任务，支付和成功退款件数必须核清，未知不能按0');
        const existing=s.monthly.find(x=>x.skuId===r.skuId&&x.month===r.month&&x.channel===r.channel);
        staged.push({...apply(scratch,'monthly',{...r,id:existing?.id||randomUUID()},user,now,context),calculationBasis:SALES_COMPONENT_BASIS});
      }
      if(expected.size)throw fail(400,`还缺${expected.size}条SKU/平台/月记录，请标为待补资料，不能伪造0销量`);
      job.monthlyBaseline=staged.map(r=>({skuId:r.skuId,month:r.month,channel:r.channel,hash:digest(s.monthly.find(x=>x.skuId===r.skuId&&x.month===r.month&&x.channel===r.channel)||null)}));
      job.results=staged;job.evidence=p.evidence.map(e=>({name:required(e.name,'证据文件名'),source:required(e.source,'证据来源',2000),sha256:text(e.sha256),capturedAt:text(e.capturedAt),note:text(e.note,2000)}));job.status=calculation.complete?'待核对':'待补资料';job.history.push({...stamp({},user,now),status:job.status,note:calculation.complete?'已完成组成拆分校验，尚未写入月报':`有${calculation.issueCount}项待核，结果仅为可确认部分，不得入月报`});return {jobId:job.id,status:job.status,rows:staged.length,issueCount:calculation.issueCount};
    }
    if(job.status!=='待核对'||!job.results.length)throw fail(400,'请先上传完整且通过校验的采集结果');
    if(!job.calculation?.complete||job.calculation.calculationBasis!==SALES_COMPONENT_BASIS)throw fail(400,'旧汇总未核实跨链接与套餐，请重新上传订单拆分结果');
    if(job.calculation.rulesHash!==recipesDigest(s))throw fail(409,'商品组成规则已变化，请重新上传计算');
    for(const b of job.monthlyBaseline||[]){const current=s.monthly.find(x=>x.skuId===b.skuId&&x.month===b.month&&x.channel===b.channel);if(digest(current||null)!==b.hash)throw fail(409,'月销售已有新记录，请重新核对计算，不能用旧暂存结果覆盖');}
    if(job.results.some(r=>s.monthly.some(x=>x.skuId===r.skuId&&x.month===r.month&&x.channel===r.channel))&&p.replaceExisting!==true)throw fail(409,'本次涉及已有月销售，请确认差异后勾选更新；旧值保留在历史记录');
    job.previousMonthly=job.results.map(r=>s.monthly.find(x=>x.skuId===r.skuId&&x.month===r.month&&x.channel===r.channel)).filter(Boolean).map(r=>structuredClone(r));
    for(const row of job.results){const existing=s.monthly.find(x=>x.skuId===row.skuId&&x.month===row.month&&x.channel===row.channel);const saved=apply(s,'monthly',{...row,id:existing?.id||row.id,note:`${row.note||''}\n采集任务 ${job.id}`},user,now,context);saved.calculationBasis=SALES_COMPONENT_BASIS;saved.collectionId=job.id;}
    job.status='已入账';job.acceptedAt=now;job.history.push({...stamp({},user,now),status:'已入账',note:required(p.note,'核对说明',2000)});return {jobId:job.id,status:job.status,rows:job.results.length};
  }
  if(action==='import') {
    if(!Array.isArray(p.operations)||p.operations.length>2000)throw fail(400,'导入最多2000条');
    if(p.operations.some(o=>!['sku','monthly','observation','issue','costArchive'].includes(o.action)))throw fail(400,'导入仅允许SKU、月销、库存参考、成本原表与待核事项');
    return p.operations.map(o=>apply(s,o.action,o.data,user,now,context));
  }
  throw fail(400,'不支持的操作');
}
export function transact(current,command,user,{now=new Date().toISOString(),placements=[]}={}) {
  authorize(user,command.action);
  const requestId=required(command.requestId,'请求编号');
  const retry=current.requests.find(r=>r.id===requestId);
  const payloadHash=createHash('sha256').update(JSON.stringify({action:command.action,data:command.data})).digest('hex');
  if(retry){if(retry.actor!==user.id||retry.payloadHash!==payloadHash)throw fail(409,'请求编号已用于其他操作');return {state:current,replayed:true};}
  if(command.revision!==current.revision)throw Object.assign(fail(409,'共享数据版本已变化，可能包含前一次提交。当前填写内容已保留，请核对最新记录后重试'),{code:'REVISION_CONFLICT'});
  const next=structuredClone(current),result=apply(next,command.action,command.data||{},user,now,{placements});
  next.revision++;next.updatedAt=now;
  next.requests.push({id:requestId,actor:user.id,payloadHash,revision:next.revision});
  next.audit.push({id:randomUUID(),at:now,actor:{id:user.id,name:user.name,username:user.username},action:command.action,beforeRevision:current.revision,revision:next.revision,result});
  return {state:next,result};
}
export function stockView(state,user,now=new Date()) {
  if(roleOf(user)==='none')throw fail(403,'请管理员为你的账号分配经营协作权限');
  const {requests,costWorkbook,purchasePrivate,...visible}=state;
  const caseAccess=hasStockRole(user,'admin','warehouse','operations','customer_service');
  visible.specialCases=caseAccess?(state.specialCases||[]).map(c=>{
    const summary=specialSummary(c),k=state.skus.find(k=>k.id===c.replacementSkuId);
    const available=k?balance(state,k.id,k.warehouse)?.available??null:null;
    return {...c,summary:{...summary,available,stockReady:!c.closedAt&&c.replacementQty>summary.replaced&&available!==null&&available>=c.replacementQty-summary.replaced}};
  }):[];
  if(user.role==='admin'){visible.costWorkbook=costWorkbook;visible.purchasePrivate=purchasePrivate||{};}
  const week=saturday(now);
  const audit=state.audit.filter(a=>(caseAccess||!a.action.startsWith('special'))&&(user.role==='admin'||!['costArchive','purchasePrivate','purchaseSettle','purchaseReopen'].includes(a.action))).slice(-300).reverse().map(a=>user.role==='admin'||a.action!=='import'?a:{...a,result:Array.isArray(a.result)?a.result.filter(r=>r?.kind!=='costArchive'):null});
  return {...visible,role:roleOf(user),week,balances:state.skus.map(k=>({skuId:k.id,warehouse:k.warehouse,...(balance(state,k.id,k.warehouse)||{}),reported:state.snapshots.some(s=>s.skuId===k.id&&s.warehouse===k.warehouse&&chinaDate(s.at)>=week)})),audit};
}
