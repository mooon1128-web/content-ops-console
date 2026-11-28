(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.PromotionData=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const key=v=>String(v??'').normalize('NFKC').trim().toLowerCase().replace(/\s|[·•・：:;；,，、()【】\[\]_\-—–]/g,'');
  const id=v=>String(v||'').replace(/^wholesale-/,'');
  const code=p=>String(p?.code||p?.sku||'');
  const segments=v=>String(v||'').split(/[、,，+;；\n]/).map(s=>s.trim()).filter(Boolean);
  const refs=v=>Array.isArray(v)?v.map(String):String(v||'').split(',').filter(Boolean);
  const amount=v=>v===null||v===undefined||String(v).trim()===''||typeof v==='boolean'?null:Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
  const round=v=>Math.round((v+Number.EPSILON)*100)/100;
  const unique=rows=>[...new Map(rows.map(p=>[id(p.id),p])).values()];
  // These aliases already have verified SKU links in the collaboration catalog.
  const aliases={'甜甜圈斜挎包':'QP-044','吐司斜挎包':'QP-043','鲷鱼烧零钱包':'QP-035','三分熟小松饼零钱包':'QP-037','山竹迷你挂件':'NEW-911819','迷你挂件山竹':'NEW-911819','场景贴纸甜品屋':'NEW-361615','场景贴纸巧克力屋':'NEW-466774','场景贴纸面包工坊':'NEW-512919',
    // Owner confirmed on 2026-11-28. Keep source labels on each placement for audit.
    '粉色法棍痛':'NEW-349559','法棍粉牛仔':'NEW-349559','法棍牛仔粉':'NEW-349559','吱吱叫包':'BG0008','法棍斜挎包':'BG0008'};
  function pendingLabel(text){
    if(key(text)==='拖鞋')return text+'（新品，订货系统待建档）';
    if(['红格礼盒','烘焙礼盒'].includes(key(text)))return text+'（烘焙礼盒，具体组合待核）';
    if(/mini挂件|迷你挂件/i.test(text))return text+'（mini手机链，具体款式与数量待核）';
    return text;
  }
  function splitKnownProducts(text,products){
    // Match whole labels across space-separated legacy lists, preserving unknown spans.
    // A slash is a delimiter only if both sides resolve; catalog names can contain slashes.
    const slash=text.split(/[/／]/).map(s=>s.trim());
    if(slash.length>1&&slash.every(s=>findProduct(s,products)))return slash;
    const words=text.trim().split(/\s+/),result=[];let unknown=[];
    for(let i=0;i<words.length;){let end=words.length;
      while(end>i&&!findProduct(words.slice(i,end).join(' '),products))end--;
      if(end>i){if(unknown.length){result.push(unknown.join(' '));unknown=[];}result.push(words.slice(i,end).join(' '));i=end;}
      else unknown.push(words[i++]);
    }
    if(unknown.length)result.push(unknown.join(' '));
    return result;
  }
  function findProduct(value,products=[]){
    if(!String(value||'').trim())return null;
    let matches=products.filter(p=>id(p.id)===id(value));
    if(!matches.length)matches=products.filter(p=>code(p)&&key(code(p))===key(value));
    if(!matches.length)matches=products.filter(p=>key(p.name)===key(value)||key(code(p)+' · '+p.name)===key(value));
    if(!matches.length&&aliases[key(value)])matches=products.filter(p=>key(code(p))===key(aliases[key(value)]));
    // Only a whole, unique specification name is accepted; never substring/fuzzy matching.
    if(!matches.length)matches=products.filter(p=>(p.aliases||[]).some(a=>key(a)===key(value)));
    if(!matches.length)matches=products.filter(p=>p.name.includes('-')&&key(p.name.slice(p.name.lastIndexOf('-')+1))===key(value));
    return matches.length===1?matches[0]:null;
  }
  function resolvePlacement(row,products=[]){
    const ids=refs(row.productIds?.length?row.productIds:row.productId),codes=refs(row.productCodes?.length?row.productCodes:row.productCode);
    const selected=[],unresolved=[],legacyLabels=[],raw=segments(row.product);
    const paired=[];
    for(let i=0;i<Math.max(ids.length,codes.length);i++){
      const byId=ids[i]?products.filter(p=>id(p.id)===id(ids[i])):[],byCode=codes[i]?products.filter(p=>key(code(p))===key(codes[i])):[];
      const a=byId.length===1?byId[0]:null,b=byCode.length===1?byCode[0]:null;
      if(a&&b&&id(a.id)!==id(b.id)){unresolved.push('商品编号与编码不一致：'+ids[i]+' / '+codes[i]);paired.push(null);continue;}
      const p=a||b;paired.push(p);if(p)selected.push(p);else unresolved.push('商品编号待核：'+(ids[i]||codes[i]));
    }
    raw.forEach((text,i)=>{
      const p=findProduct(text,products);
      if(p){selected.push(p);return;}
      // Stored IDs are authoritative after a catalog rename. Preserve the old label for audit.
      if(raw.length===paired.length&&paired[i]){legacyLabels.push(text);return;}
      for(const part of splitKnownProducts(text,products)){
        const matched=findProduct(part,products);
        if(matched)selected.push(matched);else unresolved.push(pendingLabel(part));
      }
    });
    if(!selected.length&&!unresolved.length)unresolved.push('未填写商品');
    return {products:unique(selected),unresolved:[...new Set(unresolved)],legacyLabels,original:String(row.product||'')};
  }
  function costs(row,resolved){
    const quantity=amount(row.sampleQuantity),fee=amount(row.fee),extra=amount(row.extraCost);
    const snapshot=row.productCostConnected===true?amount(row.productCostSnapshot):null;
    const missing=resolved.products.filter(p=>p.costConnected!==true||amount(p.unitCost??p.cost)===null);
    const estimated=quantity!==null&&resolved.products.length&&!resolved.unresolved.length&&!missing.length?round(resolved.products.reduce((n,p)=>n+amount(p.unitCost??p.cost)*quantity,0)):null;
    const noSamples=row.sampleStatus==='无需寄样';
    const sample=snapshot!==null?snapshot:noSamples?0:estimated;
    const basis=snapshot!==null?'snapshot':noSamples?'none':estimated!==null?'estimate':'unknown';
    const parts=[fee,extra,sample],known=parts.filter(v=>v!==null);
    return {fee,extra,sample,basis,quantity,currentEstimate:estimated,missingProducts:missing.map(p=>p.name),
      total:parts.every(v=>v!==null)?round(parts.reduce((a,b)=>a+b,0)):null,
      knownTotal:known.length?round(known.reduce((a,b)=>a+b,0)):null,
      snapshotSource:snapshot!==null?String(row.productCostSource||'历史成本快照'):'',
      pending:parts.some(v=>v===null)||resolved.unresolved.length>0};
  }
  function monthOf(value){
    if(!value)return '';
    if(/^\d{4}-\d{2}-\d{2}$/.test(value))return value.slice(0,7);
    const time=Date.parse(value);return Number.isFinite(time)?new Date(time+8*3600000).toISOString().slice(0,7):'';
  }
  function filterRows(rows,events,filters){
    const reversed=new Set(events.filter(e=>e.reverses).map(e=>e.reverses));
    const shipments=events.filter(e=>e.type==='sample'&&!reversed.has(e.id)&&(!filters.month||monthOf(e.at)===filters.month));
    const booked=new Map();for(const e of shipments){const ref=String(e.source?.placementId||'');booked.set(ref,(booked.get(ref)||0)+Number(e.quantity));}
    const unknown=rows.filter(p=>!monthOf(p.createdAt)).length;
    const search=key(filters.search);
    const selected=rows.filter(p=>filters.mode==='undated'?!monthOf(p.createdAt):filters.mode==='shipped'?booked.has(p.id):!filters.month||monthOf(p.createdAt)===filters.month)
      .filter(p=>!search||key([p.creator,p.owner,p.product,...p.products.map(x=>x.name)].join(' ')).includes(search))
      .filter(p=>filters.status!=='pending'||p.unresolved.length||p.expense?.pending);
    return {rows:selected,booked,unknown,shipments};
  }
  function totals(rows){
    const sum=k=>{const values=rows.map(r=>r.expense?.[k]).filter(v=>v!==null&&v!==undefined);return values.length?round(values.reduce((a,b)=>a+b,0)):null;};
    return {count:rows.length,fee:sum('fee'),extra:sum('extra'),sample:sum('sample'),knownTotal:sum('knownTotal'),
      pending:rows.filter(r=>r.expense?.pending||r.unresolved.length).length,
      estimated:rows.filter(r=>r.expense?.basis==='estimate').length,
      snapshot:rows.filter(r=>r.expense?.basis==='snapshot').length};
  }
  function publicationStage(row){
    if(row.status==='已发布')return '已发布';
    if(['待发布','等待发布','已寄样','寄样中','已签收','脚本已确认'].includes(row.status))return '待发布';
    return '';
  }
  const promoSeeds=[
    {name:'法棍痛包（颜色待补）',aliases:['法棍包'],kind:'product',category:'箱包'},
    {name:'拖鞋',aliases:['拖鞋'],kind:'product',category:'家居周边'},
    {name:'拖鞋-39码',aliases:['拖鞋 39码','拖鞋39码'],kind:'product',category:'家居周边'},
    {name:'烘焙礼盒（组合待补）',aliases:['红格礼盒','烘焙礼盒'],kind:'bundle'},
    ...[1,2,3,4].map(n=>({name:`烘焙礼盒${n}组`,aliases:[`烘焙礼盒${n}组`],kind:'bundle'})),
    {name:'mini手机链（款式与数量待补）',aliases:['mini挂件','迷你挂件','mini手机链'],kind:'bundle',category:'饰品'},
    {name:'mini手机链全套',aliases:['mini挂件全套','mini挂件全','迷你挂件 全'],kind:'bundle',category:'饰品'},
    {name:'mini手机链任选2–3个',aliases:['mini挂件2-3','mini挂件2-3个'],kind:'bundle',category:'饰品'},
    {name:'mini手机链任选3–4个',aliases:['mini挂件3-4个'],kind:'bundle',category:'饰品'},
    {name:'烘焙系列新品任选5',aliases:['烘培系列 新品任选5','烘培系列 新品 任选5'],kind:'bundle'},
  ];
  const promoId=name=>'promo-'+encodeURIComponent(key(name));
  const promoCode=name=>{let n=2166136261;for(const c of key(name))n=Math.imul(n^c.charCodeAt(0),16777619);return 'PR-'+(n>>>0).toString(16).toUpperCase().padStart(8,'0');};
  function productCategories(p){return [...new Set([...(p.categories||[]),p.sourceCategory||p.category].filter(Boolean))];}
  // Extra SKUs live only in the promotion catalog. Source placements are never rewritten.
  function extendCatalog(base=[],saved={},placements=[]){
    const entries=new Map();
    const add=entry=>{const id=entry.id||promoId(entry.aliases?.[0]||entry.name);entries.set(id,{id,code:promoCode(id),kind:'product',aliases:[],components:[],...entry});};
    for(const entry of promoSeeds)if(!findProduct(entry.name,base))add(entry);
    const aliasBase=base.map(p=>({...p,aliases:[...(p.aliases||[])]}));
    for(const [alias,target] of Object.entries({'mini小草莓':'NEW-807703','mini草莓挂件':'NEW-807703','学生娃':'NEW-007717'})){
      const p=findProduct(target,aliasBase);if(p)p.aliases.push(alias);
    }
    for(const entry of Object.values(saved))if(entry?.id&&entry.name)add(entry);
    const effective=()=>[...aliasBase,...entries.values()].filter(p=>!p.replacementId);
    for(const row of placements)for(const text of segments(row.product)){
      if(resolvePlacement(row,aliasBase).legacyLabels.includes(text))continue;
      if(findProduct(text,effective()))continue;
      const parts=splitKnownProducts(text,effective());
      // Keep conditional selection plans together instead of inventing standalone SKUs such as “自选1”.
      if(/\bor|自选1|手帐任选|手帐自选|卡包\s+护照本/i.test(text)){
        add({name:parts.map(part=>findProduct(part,effective())?.name||part.replace(/mini挂件|迷你挂件/gi,'mini手机链')).join('＋'),aliases:[text],kind:'bundle',categories:[...new Set(parts.flatMap(part=>{const p=findProduct(part,effective());return p?productCategories(p):[];}))]});
      }else for(const part of parts)if(!findProduct(part,effective()))add({name:part,aliases:[part],kind:/礼盒|任选|自选|随机|全套|mini|迷你挂件|组合/i.test(part)?'bundle':'product',category:/mini|迷你挂件/i.test(part)?'饰品':''});
    }
    // Reapply saved overrides after discovery, including aliases and replacement links.
    for(const entry of Object.values(saved))if(entry?.id&&entry.name)add(entry);
    for(const entry of entries.values())if(entry.replacementId){
      const target=findProduct(entry.replacementId,aliasBase);
      if(target)target.aliases.push(entry.name,...entry.aliases);
    }
    const catalog=[...aliasBase,...[...entries.values()].filter(p=>!p.replacementId||!findProduct(p.replacementId,aliasBase))];
    for(const p of catalog.filter(p=>String(p.id).startsWith('promo-'))){
      p.promotionOnly=true;p.unit='组';
      const components=(p.components||[]).map(c=>({product:findProduct(c.productId,aliasBase),quantity:amount(c.quantity)}));
      const complete=p.compositionConfirmed===true&&components.length>0&&components.every(c=>c.product&&c.quantity>0);
      p.compositionPending=!complete;p.costConnected=Boolean(complete&&components.every(c=>c.product.costConnected&&amount(c.product.unitCost??c.product.cost)!==null));
      p.unitCost=p.costConnected?round(components.reduce((n,c)=>n+amount(c.product.unitCost??c.product.cost)*c.quantity,0)):null;
      p.costSource=p.costConnected?'订货商品成本 × 套餐组成数量':'';
      p.categories=[...new Set([...(p.categories||[]),p.category,...components.flatMap(c=>c.product?productCategories(c.product):[])].filter(Boolean))];
      p.status=complete?'推广专用 SKU':'组成／资料待补';
    }
    return catalog;
  }
  function rankedProducts(rows,products,filters={}){
    const groups=new Map(),seen=new Set(),query=key(filters.search);
    const eligible=rows.filter(row=>{const stage=publicationStage(row);return stage&&(!filters.stage||filters.stage==='all'||stage===filters.stage);});
    for(const row of eligible){if(seen.has(row.id))continue;seen.add(row.id);
      const resolved=resolvePlacement(row,products);
      for(const p of resolved.products){
        if(filters.category&&filters.category!=='all'&&!productCategories(p).includes(filters.category))continue;
        if(query&&!key([p.name,code(p),...(p.aliases||[])].join(' ')).includes(query))continue;
        const g=groups.get(p.id)||{product:p,count:0,pending:0,published:0,recordIds:[]};
        g.count++;g[publicationStage(row)==='已发布'?'published':'pending']++;g.recordIds.push(row.id);groups.set(p.id,g);
      }
    }
    return [...groups.values()].sort((a,b)=>b.count-a.count||a.product.name.localeCompare(b.product.name,'zh-CN'));
  }
  return {key,findProduct,resolvePlacement,costs,filterRows,totals,monthOf,amount,segments,publicationStage,extendCatalog,productCategories,rankedProducts,promoId};
});
