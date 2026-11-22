import {createHash,randomUUID} from 'node:crypto';

export const SALES_COMPONENT_BASIS='components-v1';
export const defaultShops={'淘宝':'BlueMoon研究所','小红书':'馒头猫线下工作室的店'};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,label,max=300)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail(`请填写${label}`);return v.trim();};
const count=(v,label,positive=false)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<(positive?1:0)||v>1e9)throw fail(`${label}须为已核实的整数，未知不能按0`);return v;};
const day=v=>{if(typeof v!=='string')throw fail('日期不正确');if(/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v)return v;if(/T.*(Z|[+-]\d\d:\d\d)$/.test(v)&&Number.isFinite(Date.parse(v)))return new Date(Date.parse(v)+8*3600000).toISOString().slice(0,10);throw fail('日期须为有效日期或带时区时间');};
export const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const tuple=(...x)=>JSON.stringify(x);
const channel=v=>{if(!Object.hasOwn(defaultShops,v))throw fail('平台须为淘宝或小红书');return v;};
const identity=r=>({channel:channel(r.channel),shop:text(r.shop,'店铺标识'),itemId:text(r.itemId,'平台商品ID'),platformSkuId:text(r.platformSkuId,'平台规格ID')});
const recipeKey=r=>tuple(r.channel,r.shop,r.itemId,r.platformSkuId);
const orderKey=r=>tuple(r.channel,r.shop,r.orderId,r.lineId);
export function activeRecipes(state){const replaced=new Set((state.salesRecipes||[]).map(r=>r.replaces).filter(Boolean));return (state.salesRecipes||[]).filter(r=>!replaced.has(r.id));}
export const recipesDigest=state=>digest(activeRecipes(state));

// Append-only versions: a corrected recipe retains its predecessor and never rewrites monthly data.
export function addSalesRecipe(state,input,user,now){
  const base=identity(input),from=day(input.validFrom),to=input.validTo?day(input.validTo):null;
  if(to&&to<from)throw fail('生效结束不能早于开始');
  if(!Array.isArray(input.components)||!input.components.length||input.components.length>50)throw fail('请填写实际商品及每套数量');
  const seen=new Set(),components=input.components.map(c=>{const skuId=text(c.skuId,'统一SKU');if(!state.skus.some(k=>k.id===skuId)||seen.has(skuId))throw fail('实际商品不存在或重复，请合并同款数量');seen.add(skuId);return {skuId,units:count(c.units,'每套实际件数',true)};});
  const current=activeRecipes(state),previous=input.replaces?current.find(r=>r.id===input.replaces):null;
  if(input.replaces&&!previous)throw fail('规则已被修订，请刷新',409);
  if(previous&&recipeKey(previous)!==recipeKey(base))throw fail('修订不能改变平台规格标识；新链接请新增对应');
  if(current.some(r=>r.id!==previous?.id&&recipeKey(r)===recipeKey(base)&&from<=(r.validTo||'9999-12-31')&&r.validFrom<=(to||'9999-12-31')))throw fail('该平台规格的生效日期重叠，请修订原规则或设置不同期间',409);
  const row={...base,id:randomUUID(),validFrom:from,validTo:to,components,name:String(input.name||'').slice(0,500),spec:String(input.spec||'').slice(0,500),source:text(input.source,'组成核实依据',2000),replaces:previous?.id||null,createdAt:now,actor:{id:user.id,name:user.name}};
  (state.salesRecipes??=[]).push(row);return row;
}

function months(start,end){const a=[];for(let d=new Date(start+'T00:00:00Z');d.toISOString().slice(0,10)<=end;d.setUTCMonth(d.getUTCMonth()+1))a.push(d.toISOString().slice(0,7));return a;}
function cohortEnd(month,end){const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).toISOString().slice(0,10);return last<end?last:end;}

export function calculateComponentSales(state,job,input){
  if(input.format!=='component-orders-v1'||!Array.isArray(input.orders)||!Array.isArray(input.refunds)||!Array.isArray(input.coverage))throw fail('请上传含原平台订单行、退款行和完整性核对的 component-orders-v1 数据；汇总件数无法校验套餐');
  if(input.orders.length>30000||input.refunds.length>30000)throw fail('单次明细过多，请按月拆分采集任务');
  const rules=activeRecipes(state),lookup=new Map();for(const r of rules){const key=recipeKey(r);if(!lookup.has(key))lookup.set(key,[]);lookup.get(key).push(r);}
  const shops=job.shops||job.channels.map(c=>({channel:c,shop:defaultShops[c]}));
  // Exclusions are scoped to this collection, exact platform IDs, and remain auditable.
  if(input.exclusions!==undefined&&(!Array.isArray(input.exclusions)||input.exclusions.length>100))throw fail('排除范围格式不正确');
  const exclusions=(input.exclusions||[]).map(e=>{
    const c=channel(e.channel),shop=text(e.shop,'排除店铺'),itemId=text(e.itemId,'排除商品ID');
    if(!shops.some(s=>s.channel===c&&s.shop===shop))throw fail('排除店铺超出任务范围');
    return {channel:c,shop,itemId,platformSkuId:e.platformSkuId?text(e.platformSkuId,'排除规格ID'):null,name:text(e.name,'排除商品名称'),reason:text(e.reason,'排除原因',1000)};
  });
  const excludedOrders=[],excludedRefunds=[],rowIssues=[];
  const excludeFor=o=>exclusions.find(e=>e.channel===o.channel&&e.shop===o.shop&&e.itemId===o.itemId&&(!e.platformSkuId||e.platformSkuId===o.platformSkuId));
  const allowed=new Set(shops.map(s=>tuple(s.channel,s.shop))),orders=new Map(),refunds=new Map(),issues=[],contributions=new Map();let issueCount=0,duplicateOrders=0,duplicateRefunds=0,ignoredRefunds=0;
  const issue=(kind,key,detail)=>{issueCount++;if(issues.length<500)issues.push({kind,key,detail});};
  const rows=new Map(months(job.start,job.end).flatMap(m=>job.skuIds.flatMap(skuId=>job.channels.map(c=>[tuple(skuId,m,c),{skuId,month:m,channel:c,paid:0,refund:0,net:0,payAmount:null,refundAmount:null,through:cohortEnd(m,job.end),refundAsOf:job.refundAsOf,source:`订单行拆分核对 · ${job.id}`,note:'件数按实际商品组成拆分；销售额未分摊，保留原订单口径。',calculationBasis:SALES_COMPONENT_BASIS}]))));
  const add=(order,skuId,field,n)=>{
    const row=rows.get(tuple(skuId,order.paidDate.slice(0,7),order.channel));if(row)row[field]+=n;
    const key=tuple(order.rule.id,order.paidDate.slice(0,7),skuId);if(!contributions.has(key))contributions.set(key,{recipeId:order.rule.id,month:order.paidDate.slice(0,7),skuId,channel:order.channel,shop:order.shop,itemId:order.itemId,platformSkuId:order.platformSkuId,paid:0,refund:0});contributions.get(key)[field]+=n;
  };
  for(const raw of input.orders){let key='订单行';try{
    const row={...identity(raw),orderId:text(raw.orderId,'订单号'),lineId:text(raw.lineId,'平台订单行号'),paidDate:day(raw.paidAt),quantity:count(raw.quantity,'购买套数／件数',true)};key=orderKey(row);
    if(raw.lineKind!=='platform')throw fail('只能使用原平台订单行；ERP拆分行不能与套餐父行混加');
    if(!allowed.has(tuple(row.channel,row.shop)))throw fail('店铺超出任务范围');
    if(row.paidDate<job.start||row.paidDate>job.end)throw fail('付款日期超出任务范围，请按实际付款时间筛选');
    const prior=orders.get(key);if(prior){if(prior.fingerprint!==digest(row))throw fail('相同订单行存在数量、日期或规格冲突');duplicateOrders++;continue;}
    const matched=(lookup.get(recipeKey(row))||[]).filter(r=>r.validFrom<=row.paidDate&&(!r.validTo||r.validTo>=row.paidDate));
    const record={...row,fingerprint:digest(row),rule:matched.length===1?matched[0]:null,refunded:{}};orders.set(key,record);
    const excluded=excludeFor(row);if(excluded){record.excluded=true;record.rule=null;excludedOrders.push({...row,reason:excluded.reason});continue;}
    if(matched.length!==1){issue('商品对应',key,matched.length?'同一规格有多套有效组成规则':`缺少已核实组成：${row.itemId} / ${row.platformSkuId}，不能按名称猜测`);continue;}
    for(const c of record.rule.components){const q=c.units*row.quantity;count(q,'拆分支付数量');add(record,c.skuId,'paid',q);}
  }catch(e){issue('订单',key,e.message);}}
  for(const raw of input.refunds){let key='退款行',affectedOrder=null;try{
    const r={channel:channel(raw.channel),shop:text(raw.shop,'店铺标识'),orderId:text(raw.orderId,'原订单号'),lineId:text(raw.lineId,'原平台订单行号'),refundId:text(raw.refundId,'退款单号'),refundLineId:text(raw.refundLineId,'退款明细行标识'),status:raw.status};
    key=tuple(r.channel,r.shop,r.refundId,r.refundLineId);
    if(!allowed.has(tuple(r.channel,r.shop)))throw fail('退款店铺超出任务范围');
    affectedOrder=orders.get(orderKey(r));
    if(!['success','pending','closed','rejected'].includes(r.status))throw fail('退款状态不明确');
    // Exact canonical fingerprints include quantity/type, not customer details or export formatting.
    // Some official exports omit completion time. Preserve that absence; an observed
    // successful status is usable only at the exact collection cutoff, never backdated.
    const completedDate=r.status==='success'&&raw.completedAt?day(raw.completedAt):null;
    const observedAsOf=r.status==='success'&&!completedDate&&raw.observedAsOf?day(raw.observedAsOf):null;
    if(r.status==='success'&&!completedDate&&observedAsOf!==job.refundAsOf)throw fail('缺少退款完成时间，须提供与任务截止日一致的成功状态观察日');
    const normalized={...r,completedDate,observedAsOf,kind:raw.kind||null,quantity:raw.quantity??null,components:Array.isArray(raw.components)?raw.components.map(c=>({skuId:c.skuId,quantity:c.quantity})):null};
    const hash=digest(normalized),prior=refunds.get(key);if(prior){if(prior!==hash)throw fail('同一退款明细重复且内容冲突');duplicateRefunds++;continue;}refunds.set(key,hash);
    if(affectedOrder?.excluded){excludedRefunds.push({...r,reason:excludeFor(affectedOrder).reason});continue;}
    if(r.status!=='success'||completedDate>job.refundAsOf){ignoredRefunds++;continue;}
    const order=orders.get(orderKey(r));if(!order)throw fail('成功退款找不到原付款订单行');
    if((completedDate||observedAsOf)<order.paidDate)throw fail('退款完成或观察日期早于付款日期');
    if(!order.rule){issue('退款对应',key,'原订单商品组成尚未核实');continue;}
    let quantities=[];
    if(raw.kind==='amount_only'){if((raw.quantity??0)!==0||(raw.components?.length||0)>0)throw fail('价差补偿不能同时申报扣减件数');continue;}
    if(raw.kind==='whole'){const q=count(raw.quantity,'退掉的完整套数',true);if(q>order.quantity)throw fail('整套退款数量超过购买套数');quantities=order.rule.components.map(c=>({skuId:c.skuId,quantity:c.units*q}));}
    else if(raw.kind==='components'){
      if(!Array.isArray(raw.components)||!raw.components.length)throw fail('部分退款须确认实际商品和件数');const seen=new Set();
      quantities=raw.components.map(c=>{if(seen.has(c.skuId)||!order.rule.components.some(x=>x.skuId===c.skuId))throw fail('部分退款商品重复或不在该套餐内');seen.add(c.skuId);return {skuId:c.skuId,quantity:count(c.quantity,'实际退款扣件数',true)};});
    }else throw fail('退款件数或套餐退项不明确，不能用退款金额推算');
    for(const q of quantities){const limit=order.rule.components.find(c=>c.skuId===q.skuId).units*order.quantity;if((order.refunded[q.skuId]||0)+q.quantity>limit)throw fail('累计退款扣件超过该商品购买数量');}
    for(const q of quantities){order.refunded[q.skuId]=(order.refunded[q.skuId]||0)+q.quantity;add(order,q.skuId,'refund',q.quantity);}
  }catch(e){issue('退款',key,e.message);for(const c of affectedOrder?.rule?.components||[])rowIssues.push({skuId:c.skuId,month:affectedOrder.paidDate.slice(0,7),channel:affectedOrder.channel,kind:'退款',key,detail:e.message});}}
  for(const store of shops){const matches=input.coverage.filter(c=>c.channel===store.channel&&c.shop===store.shop);const key=tuple(store.channel,store.shop);const own=[...orders.values()].filter(o=>o.channel===store.channel&&o.shop===store.shop);
    if(matches.length!==1){issue('完整性',key,'每家店铺需一份全链接、已付款订单和退款完整性核对');continue;}const c=matches[0];
    try{if(c.start!==job.start||c.end!==job.end||c.refundAsOf!==job.refundAsOf||c.ordersComplete!==true||c.refundsComplete!==true||c.linksComplete!==true)throw fail('尚未确认全链接及所有相关退款均已采集');text(c.source,'完整性核对来源',2000);if(count(c.orderLineCount,'原报表去重订单行数')!==own.length||count(c.paidUnits,'原报表购买套数／件数')!==own.reduce((n,o)=>n+o.quantity,0))throw fail('原报表控制合计与订单明细不一致');}catch(e){issue('完整性',key,e.message);}
  }
  for(const row of rows.values())row.net=row.paid-row.refund;
  const usedRules=new Set([...orders.values()].map(o=>o.rule?.id).filter(Boolean));
  const coverage=input.coverage.map(c=>({channel:c.channel,shop:c.shop,start:day(c.start),end:day(c.end),refundAsOf:day(c.refundAsOf),ordersComplete:c.ordersComplete===true,refundsComplete:c.refundsComplete===true,linksComplete:c.linksComplete===true}));
  return {rows:[...rows.values()],issues,rowIssues,coverage,exclusions,excludedOrders,excludedRefunds,issueCount,complete:issueCount===0,summary:{orderLines:orders.size,refundLines:refunds.size,duplicateOrders,duplicateRefunds,ignoredRefunds,excludedOrderLines:excludedOrders.length,excludedPlatformUnits:excludedOrders.reduce((n,o)=>n+o.quantity,0),excludedRefundLines:excludedRefunds.length},contributions:[...contributions.values()].filter(c=>job.skuIds.includes(c.skuId)),rulesSnapshot:rules.filter(r=>usedRules.has(r.id)),rulesHash:recipesDigest(state),inputHash:digest({orders:input.orders,refunds:input.refunds,coverage:input.coverage,...(exclusions.length?{exclusions}: {})}),calculationBasis:SALES_COMPONENT_BASIS};
}
