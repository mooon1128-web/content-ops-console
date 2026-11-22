import {createHash,randomUUID} from 'node:crypto';

// ERP quantities are documentary observations. They never establish physical stock.
export function importCatalog(state,input,user,now,{fail}) {
  const required=(v,label,max=2000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw fail(400,`${label}缺失或过长`);return v.trim();};
  const optional=(v,max=2000)=>v===null||v===undefined?'':typeof v==='string'&&v.length<=max?v.trim():(()=>{throw fail(400,'字段必须为限定长度的文本')})();
  const quantity=v=>{if(v===null||v===undefined||v==='')return null;if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e9)throw fail(400,'ERP数量格式无效');return v;};
  const timestamp=v=>{if(typeof v!=='string'||!/(Z|[+-]\d\d:\d\d)$/.test(v)||!Number.isFinite(Date.parse(v))||Date.parse(v)>Date.parse(now))throw fail(400,'ERP来源时间无效或晚于当前时间');return new Date(v).toISOString();};
  const blank=v=>v===undefined||v===null||v==='';
  const actor={id:user.id,name:user.name,username:user.username};
  const id=required(input.id,'批次编号',120),hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const prior=(state.catalogImports||[]).find(b=>b.id===id);
  if(prior){if(prior.hash!==hash)throw fail(409,'同一导入批次内容已变化，请另建批次保留历史');return {...prior.summary,alreadyImported:true};}
  for(const key of ['skus','inventory','mappings','issues'])if(!Array.isArray(input[key])||input[key].length>10000)throw fail(400,`${key}导入列表无效`);
  if(!input.skus.length||!Array.isArray(input.sources)||!input.sources.length||input.sources.length>100)throw fail(400,'缺少档案或来源');
  const sources=input.sources.map(x=>({name:required(x.name,'来源名称',300),sha256:required(x.sha256,'来源校验码',64)}));
  if(sources.some(x=>!/^[a-f0-9]{64}$/i.test(x.sha256)))throw fail(400,'来源校验码不正确');
  const summary={addedSkus:0,filledFields:0,preservedConflicts:0,addedMappings:0,inventoryRows:0,reviewRows:0};
  const conflicts=[];
  const conflict=(skuId,field,existing,incoming)=>{summary.preservedConflicts++;conflicts.push({skuId,field,existing,incoming});};
  const textFields=['code','name','spec','category','status','warehouse','barcode','taobaoItemId','taobaoSkuId','xhsProductId','xhsSkuId','influencerProductId','note','costSkuId','costLinkStatus','erpSkuId','erpProductCode','erpName','erpSpec','erpBarcode','erpStatus','source'];
  const seen=new Set();
  for(const raw of input.skus){
    const skuId=required(raw.id,'档案ID',160);if(seen.has(skuId))throw fail(400,'导入档案ID重复');seen.add(skuId);
    const incoming={id:skuId};for(const field of textFields)if(raw[field]!==undefined)incoming[field]=optional(raw[field],['note','source'].includes(field)?4000:500);
    for(const field of ['leadDays','moq'])if(raw[field]!==undefined){incoming[field]=quantity(raw[field]);if(incoming[field]!==null&&(!Number.isSafeInteger(incoming[field])||incoming[field]<0))throw fail(400,'工期和起订量格式无效');}
    if(incoming.status&&!['在售','停用','待核'].includes(incoming.status))throw fail(400,'档案状态无效');
    for(const key of ['code','erpSkuId'])if(incoming[key]&&state.skus.some(k=>k.id!==skuId&&k[key]===incoming[key]))throw fail(409,`${key}已属于其他档案，请先核对，不能重复建档`);
    let target=state.skus.find(k=>k.id===skuId);
    if(!target){required(incoming.code,'统一编码');required(incoming.name,'名称');target={id:skuId,code:incoming.code,name:incoming.name,status:incoming.status||'待核',warehouse:incoming.warehouse||'待核',leadDays:null,moq:null,updatedAt:now,actor};state.skus.push(target);summary.addedSkus++;}
    for(const [field,value]of Object.entries(incoming)){
      if(field==='id'||blank(value))continue;
      if(['taobaoSkuId','xhsSkuId'].includes(field)&&state.skus.some(k=>k.id!==skuId&&k[field]===value)){conflict(skuId,field,'已由其他SKU使用',value);continue;}
      if(blank(target[field])){target[field]=value;summary.filledFields++;}
      else if(target[field]!==value)conflict(skuId,field,target[field],value);
    }
  }
  const skuExists=id=>{if(!state.skus.some(k=>k.id===id))throw fail(400,'导入关联的SKU不存在');return id;};
  state.platformMappings??=[];
  for(const raw of input.mappings){
    const row={id:required(raw.id,'映射ID',160),skuId:skuExists(raw.skuId),platform:required(raw.platform,'平台',20),itemId:required(raw.itemId,'商品ID',100),platformSkuId:required(raw.platformSkuId,'平台规格ID',100),name:optional(raw.name,1000),spec:optional(raw.spec,1000),status:required(raw.status,'匹配状态',100),source:required(raw.source,'匹配来源',4000),evidenceCount:quantity(raw.evidenceCount),evidence:[],batchId:id};
    if(!['淘宝','小红书'].includes(row.platform))throw fail(400,'映射平台无效');
    if(!Array.isArray(raw.evidence)||raw.evidence.length>10)throw fail(400,'映射证据无效');
    row.evidence=raw.evidence.map(e=>({method:required(e.method,'对应方法',300),source:required(e.source,'证据来源',1000),order:optional(e.order,150),row:quantity(e.row)}));
    const found=state.platformMappings.find(m=>m.platform===row.platform&&m.itemId===row.itemId&&m.platformSkuId===row.platformSkuId);
    const legacy=state.skus.find(k=>k[row.platform==='淘宝'?'taobaoSkuId':'xhsSkuId']===row.platformSkuId&&k.id!==row.skuId);
    if(found){if(found.skuId!==row.skuId)conflict(row.skuId,'平台映射',found.skuId,row.platformSkuId);continue;}
    if(legacy){conflict(row.skuId,'平台映射',legacy.id,row.platformSkuId);continue;}
    if(state.platformMappings.some(m=>m.id===row.id))throw fail(409,'映射ID已用于其他平台规格');
    state.platformMappings.push(row);summary.addedMappings++;
  }
  state.erpInventory??=[];
  const inventoryKeys=new Set();
  for(const raw of input.inventory){
    const row={id:required(raw.id,'ERP库存ID',180),skuId:skuExists(raw.skuId),warehouse:required(raw.warehouse,'来源仓库',200),scope:required(raw.scope,'查询范围',500),at:timestamp(raw.at),warehouseAt:raw.warehouseAt?timestamp(raw.warehouseAt):null,source:required(raw.source,'库存来源',4000),note:optional(raw.note,4000),batchId:id,importedAt:now};
    for(const field of ['book','occupied','available','warehouseBook'])row[field]=quantity(raw[field]);
    if(['book','occupied','available'].every(f=>row[f]!==null)&&Math.abs(row.book-row.occupied-row.available)>1e-6)throw fail(400,'ERP账面、占用、预估可销售库存不平衡');
    const key=`${row.skuId}|${row.warehouse}|${row.at}`;if(inventoryKeys.has(key))throw fail(400,'同SKU仓库时点的库存重复');inventoryKeys.add(key);
    const found=state.erpInventory.find(r=>r.id===row.id||`${r.skuId}|${r.warehouse}|${r.at}`===key);
    if(found){if(['skuId','warehouse','at','book','occupied','available','warehouseBook'].some(f=>found[f]!==row[f]))conflict(row.skuId,'ERP库存快照',found.id,row.id);continue;}
    state.erpInventory.push(row);summary.inventoryRows++;
  }
  state.catalogReviews??=[];
  for(const raw of input.issues){
    const row={id:required(raw.id,'待核ID',180),skuId:skuExists(raw.skuId),title:required(raw.title,'待核标题',200),detail:required(raw.detail,'缺失说明',12000),source:required(raw.source,'待核来源',4000),status:'待核',batchId:id};
    const found=state.catalogReviews.find(x=>x.id===row.id);
    if(found){if(found.detail!==row.detail)conflict(row.skuId,'待核说明',found.detail,row.detail);continue;}
    state.catalogReviews.push(row);summary.reviewRows++;
  }
  for(const c of conflicts)state.issues.push({id:randomUUID(),skuId:c.skuId,title:'导入字段冲突：保留原值',detail:JSON.stringify(c),source:`ERP导入 ${id}`,status:'待核',quantity:null,updatedAt:now,actor});
  (state.catalogImports??=[]).push({id,hash,title:required(input.title,'导入标题',300),catalogAsOf:timestamp(input.catalogAsOf),note:optional(input.note,4000),sources,summary,conflicts,at:now,actor});
  return {kind:'catalogImport',batchId:id,...summary};
}
