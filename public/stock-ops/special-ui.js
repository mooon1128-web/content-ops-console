const types={repair:'维修原件寄回',exchange:'换货',reship:'缺件／补发',unknown:'来件待认领'};
const stages={create:'建立工单',plan:'客服确认方案',receive:'收到特殊件',progress:'仓库进度／移位',ship_repair:'原件寄回',replacement:'新品补发出库',return_good:'旧件验收合格转库',return_hold:'旧件转待检库存',close:'客服结案'};
let search='',scope='open',selected='';

export function renderSpecial(ctx) {
  const {state,can,$,escape,num,textDate,today,localNow,iso,skuLabel,sku,heading,button,table,pill,field,area,select,showEditor,command,bind,bindAll,csv}=ctx;
  const service=can('operations','customer_service'),wh=can('warehouse');
  const cases=state.specialCases||[],open=cases.filter(c=>!c.closedAt);
  const rows=cases.filter(c=>(scope==='all'||scope==='open'&&!c.closedAt||scope==='unknown'&&c.type==='unknown'&&!c.closedAt||scope==='waiting'&&c.summary.status==='待到货'||scope==='ready'&&c.summary.stockReady)&&[c.reference,c.order,c.channel,c.owner,c.location,skuLabel(c.skuId),...c.history.map(h=>h.ref)].join(' ').toLowerCase().includes(search.toLowerCase())).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
  const overdue=c=>!c.closedAt&&c.dueDate&&c.dueDate<today();
  const identified=c=>c.skuId?escape(skuLabel(c.skuId)):'待认领 SKU';
  const optionalSku=(name,label,value)=>select(name,label,[['','待确认 / 不涉及'],...state.skus.map(k=>[k.id,`${k.name} · ${k.code}`])],value).replace(' required','');
  $('#content').innerHTML=heading('特殊售后件','维修、等货换货和待认领来件，共用一张工单。实物贴上工单编号，客服与仓库按同一编号交接。',`${button('special-export','导出台账 CSV')}${button('special-history','导出交接记录')}${service||wh?button('new-special','＋ 登记特殊件',true):''}`)+`
    <div class="metrics"><div class="metric"><span>未结案工单</span><strong>${open.length}</strong><small>数量与去向全部核清后结案</small></div><div class="metric"><span>来件待认领</span><strong>${open.filter(c=>c.type==='unknown').length}</strong><small>先关联原订单与 SKU</small></div><div class="metric"><span>等货补发</span><strong>${open.filter(c=>c.summary.status==='待到货').length}</strong><small>保持待办，不提前记出库</small></div><div class="metric accent"><span>库存足够待补发</span><strong>${open.filter(c=>c.summary.stockReady).length}</strong><small>按默认仓当前可售数提示，需仓管核实</small></div></div>
    <div class="hint">客服填写订单号和处理要求；仓管收件时登记位置，原件修好后按原订单安排寄回。客户寄来的维修件保存在特殊件区，不计入公司可售、待检或周六商品盘点。换货旧件经过验收转库后才进入公司库存；新品实际补发才扣库存。请勿填写客户姓名、电话或地址。</div>
    <div class="filterbar"><label>查找工单 / 原单 / 运单 / 负责人<input id="special-search" value="${escape(search)}" type="search"></label>${select('specialScope','任务范围',[['open','未结案'],['unknown','待认领'],['waiting','等货补发'],['ready','库存足够待补发'],['all','全部（含已完成）']],scope)}${button('special-find','查找')}</div>
    <div class="card">${table(['工单 / 原订单','类型 / 款式','实物交接','处理阶段','负责人 / 下次跟进','存放位置 / 下一步',''],rows.map(c=>[
      `<b>${escape(c.reference)}</b><small>${escape(c.channel)} · ${escape(c.order||'原单待认领')}</small>`,`${escape(types[c.type])}<small>${identified(c)}</small>`,
      `收件 ${c.summary.received} / ${c.returnQty}<small>在手 ${c.summary.held} · 原件寄回 ${c.summary.repairSent} · 旧件转库 ${c.summary.stocked}</small><small>新品补发 ${c.summary.replaced} / ${c.replacementQty}</small>`,
      `${pill(c.summary.status,c.type==='unknown'?'warn':'')}${c.summary.stockReady?'<small>默认仓库存足够，待核实补发</small>':''}`,
      `${escape(c.owner)}<small>${escape(c.dueDate||'未指定跟进日')}</small>${overdue(c)?pill('已过跟进日','bad'):''}`,
      `<span class="special-wrap">${escape(c.location||'无在手件')}<small>${escape(c.nextAction)}</small></span>`,
      `<button data-special-open="${escape(c.id)}">打开工单</button>`]),'此范围暂无特殊件。登记后保留全部处理记录。')}</div><div id="special-detail"></div>`;
  const again=()=>ctx.render();
  bind('special-find',()=>{search=$('#special-search').value;again()});
  $('#special-search').onkeydown=e=>{if(e.key==='Enter'){search=e.target.value;again()}};
  $('[name="specialScope"]').onchange=e=>{scope=e.target.value;again()};
  bindAll('[data-special-open]',el=>{selected=el.dataset.specialOpen;again();$('#special-detail').scrollIntoView({behavior:'smooth',block:'start'})});
  bind('new-special',()=>editPlan());
  bind('special-export',()=>csv('特殊售后件台账',['工单编号','平台','原订单号','处理类型','原SKU','补发SKU','负责人','跟进日','阶段','应收件数','已收件数','在手件数','原件寄回数','旧件转库数','需补发新品','已补发新品','存放位置','下一步','处理要求','创建时间','结案时间'],rows.map(c=>[c.reference,c.channel,c.order,types[c.type],sku(c.skuId)?.code,sku(c.replacementSkuId)?.code,c.owner,c.dueDate,c.summary.status,c.returnQty,c.summary.received,c.summary.held,c.summary.repairSent,c.summary.stocked,c.replacementQty,c.summary.replaced,c.location,c.nextAction,c.reason,c.createdAt,c.closedAt])));
  bind('special-history',()=>csv('特殊售后交接记录',['工单编号','动作','发生时间','数量','单据或运单','位置','仓库','经手人','依据','下一步','库存流水ID','方案变更前','方案变更后'],rows.flatMap(c=>c.history.map(h=>[c.reference,stages[h.stage],h.at,h.quantity,h.ref,h.location,h.warehouse,h.actor?.name,h.note,h.nextAction,h.eventId,h.before?JSON.stringify(h.before):'',h.after?JSON.stringify(h.after):'']))));

  function editPlan(c) {
    const key=crypto.randomUUID(),unknownOnly=!service;
    const type=c?.type||(unknownOnly?'unknown':'repair');
    showEditor(c?'认领 / 更新处理方案':'登记特殊售后工单',
      field('reference','工单 / 平台售后编号',c?.reference)+select('type','处理类型',Object.entries(types).filter(([k])=>!unknownOnly||k==='unknown'),type)+
      select('channel','原订单平台',['淘宝','小红书','线下','待认领'],c?.channel||(unknownOnly?'待认领':'淘宝'))+field('order','原订单号（仅待认领可留空）',c?.order,'text',false)+
      optionalSku('skuId','原件 SKU（仅待认领可留空）',c?.skuId)+optionalSku('replacementSkuId','需补发的新品 SKU',c?.replacementSkuId)+
      field('returnQty','预计退回件数（纯补发填0）',c?.returnQty??'','number')+field('replacementQty','需补发新品件数（维修填0）',c?.replacementQty??'','number')+
      field('owner','内部负责人',c?.owner)+field('dueDate','下次跟进日期',c?.dueDate,'date',false)+area('nextAction','下一步处理事项',c?.nextAction)+area('reason','客服处理要求 / 待认领件特征',c?.reason)+(c?area('note','本次认领或修改依据'):''),
      d=>command(c?'specialPlan':'specialCase',{...d,...(c?{caseId:c.id}:{})},key),
      '一张工单登记一个原件 SKU；多款按工单加不同后缀拆分。待认领件可暂缺原订单和SKU，必须先认领再寄出。维修指原件修好后寄回；涉及新品补发请登记换货或补发。未发生的数量不要填成已处理。');
  }
  const c=cases.find(c=>c.id===selected);if(!c)return;
  const s=c.summary;
  let actions='';
  if(!c.closedAt){
    if(service)actions+=button('special-plan','认领 / 更新方案');
    if(wh){
      const b=(stage,label)=>`<button data-special-stage="${stage}">${label}</button>`;
      if(s.received<c.returnQty)actions+=b('receive','确认收件');
      actions+=b('progress','更新进度 / 存放位置');
      if(c.type==='repair'&&s.held>0)actions+=b('ship_repair','原件寄回');
      if(['exchange','reship'].includes(c.type)&&s.replaced<c.replacementQty)actions+=b('replacement','新品补发出库');
      if(c.type==='exchange'&&s.held>0)actions+=b('return_good','旧件验收合格转库')+b('return_hold','旧件转待检库存');
    }
    if(service&&s.ready)actions+=button('special-close','核对结案',true);
  }
  $('#special-detail').innerHTML=`<div class="card special-detail"><div class="section-heading"><div><p class="eyebrow">工单编号 · 建议贴在实物包装上</p><h2>${escape(c.reference)}</h2></div>${pill(s.status)}</div><p>${escape(c.channel)} · 原订单 ${escape(c.order||'待认领')} · ${identified(c)}</p><p class="hint">处理要求：${escape(c.reason)}<br>当前负责人：${escape(c.owner)} · ${escape(c.location||'暂无在手件位置')}<br>下一步：${escape(c.nextAction)}</p><div class="actions">${actions}</div><h3 class="history-heading">交接记录</h3>${table(['发生时间 / 经手人','处理动作','数量 / 单据','依据与去向'],c.history.slice().reverse().map(h=>[
    `${textDate(h.at)}<small>${escape(h.actor?.name||h.actor?.username)}</small>`,`${escape(stages[h.stage])}<small>${escape(h.progress||'')}</small>`,`${h.quantity===undefined?'—':num(h.quantity)}<small>${escape(h.ref||'')}</small>`,
    `<span class="special-wrap">${escape(h.note)}<small>${escape(h.location||h.warehouse||'')}</small>${h.nextAction?`<small>下一步：${escape(h.nextAction)}</small>`:''}${h.before?`<details><summary>查看方案更改</summary><pre>${escape(JSON.stringify({原方案:h.before,新方案:h.after},null,2))}</pre></details>`:''}</span>`]))}</div>`;
  bind('special-plan',()=>editPlan(c));
  bind('special-close',()=>{const key=crypto.randomUUID();showEditor('核对结案',area('note','结案依据（单据、数量、去向核对结果）'),d=>command('specialClose',{...d,caseId:c.id},key),'只关闭本工单；不会执行平台退款或改写净销量。')});
  bindAll('[data-special-stage]',el=>{
    const stage=el.dataset.specialStage,key=crypto.randomUUID();
    const physical=stage!=='progress',stock=['replacement','return_good','return_hold'].includes(stage);
    let fields=field('at','实际发生时间',localNow(),'datetime-local');
    if(physical)fields+=field('quantity','本次实际件数','','number')+field('ref',stage==='receive'?'来件交接单 / 退回运单号':'出入库单 / 寄回运单号');
    if(stage==='receive'||stage==='progress')fields+=field('location','特殊件存放位置',c.location,'text',stage==='receive'||s.held>0);
    if(stage==='progress')fields+=select('progress','处理阶段',['待检测','维修中','待到货','待寄回','待发货'],c.progress||'待检测');
    if(stock)fields+=field('warehouse','本次仓库',sku(stage==='replacement'?c.replacementSkuId:c.skuId)?.warehouse||'主仓');
    if(stage==='replacement')fields+=field('released','同时释放已预留数量',0,'number');
    fields+=area('nextAction','完成这一步后，下一步要做什么')+area('note',stage==='return_good'?'实物检验合格依据':'处理依据 / 备注');
    const hint=stage==='ship_repair'?'需先更新为“待寄回”；此动作登记客户原件寄出，不扣新品库存。':stage==='replacement'?'实际新品寄出才记录。请从原订单系统取得地址，不在这里记录个人信息。':stage==='receive'?'这里暂存客户退回件，不增加公司库存。将工单编号贴在包装上。':stock?'旧件离开特殊件区转入公司库存后，不要在普通售后再次入库。':'维修完成后标为待寄回；等补货选待到货。只更新进度，不自动扣库存或发货。';
    showEditor(`${stages[stage]} · ${c.reference}`,fields,d=>command('specialAction',{...d,caseId:c.id,stage,at:iso(d.at)},key),hint);
  });
}
