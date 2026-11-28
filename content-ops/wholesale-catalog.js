// Match the ordering portal's saved product overrides, including new and deleted products.
export function currentWholesaleProducts(base, data = {}) {
  const settings = data.productSettings || {}, inventory = data.inventory || {};
  const rows = new Map();
  for (const product of [...base, ...(data.customProducts || [])]) {
    if (!product?.id) continue;
    const setting = settings[product.id] || {};
    if (setting.deleted) { rows.delete(product.id); continue; }
    rows.set(product.id, {...product, ...setting, id: product.id,
      status: inventory[product.id] ?? setting.status ?? product.status,
      image: setting.image || product.image || ''});
  }
  return [...rows.values()];
}

// Only mapped public catalog fields leave this endpoint for PR/content staff.
export function catalogCostInfo(user, product, data, resolveCost) {
  return user.role === 'admin' ? resolveCost(product, data.costSettings || {}, data.costSeeds || {}) : {};
}

// A failed private bootstrap must never replace the complete catalog with the base file.
export function createCatalogReader({load,restore=async()=>null,persist=async()=>{},now=Date.now}) {
  let latest=null,inflight=null,restored=false;
  return async function read(force=false){
    if(inflight)return inflight;
    if(!force&&latest&&now()-Date.parse(latest.syncedAt)<60000)return {...latest,stale:false};
    inflight=(async()=>{
      if(!restored){restored=true;try{const old=await restore();if(old?.data?.connected&&Array.isArray(old.rows)&&old.syncedAt)latest=old;}catch{}}
      try{
        const next=await load();if(!next.data?.connected)throw Error('订货后台完整目录暂未连接');
        latest={...next,syncedAt:new Date(now()).toISOString()};await persist(latest).catch(()=>{});return {...latest,stale:false};
      }catch(error){
        if(latest)return {...latest,stale:true,error:'订货后台暂未连接，商品沿用上次完整目录；最新成本等待同步'};
        throw error;
      }
    })();
    try{return await inflight;}finally{inflight=null;}
  };
}
