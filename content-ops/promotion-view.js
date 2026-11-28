import PromotionData from '../public/content-ops/promotion-data.cjs';
import {hasStockRole} from './stock-model.js';
const fields=['id','creator','product','platform','status','sampleStatus','owner','createdAt','updatedAt','sampleDeliveredAt','agreedPublishAt','publishedAt','sampleTrackingNumber','noteUrl','noteTitle','contentType','publicationFormat','coverExposure','cooperationDetails','shootingRequirements','requiresDraftReview','draftDeadline','changeNoticeDeadline','notes'];
const metrics=['impressions','reads','likes','saves','comments','shares','leads','orders','gmv'];
export function promotionView(source,catalog,user){
  const privateCosts=hasStockRole(user,'admin','finance');
  const products=PromotionData.extendCatalog(catalog.products||[],source.promotionSkus||{},source.placements||[]);
  const placements=(source.placements||[]).filter(raw=>PromotionData.publicationStage(raw)).map(raw=>{
    const resolved=PromotionData.resolvePlacement(raw,products),row=Object.fromEntries(fields.map(k=>[k,String(raw[k]??'')]));
    row.status=PromotionData.publicationStage(raw);
    row.productIds=resolved.products.map(p=>p.id);row.sampleQuantity=PromotionData.amount(raw.sampleQuantity);
    row.conversionMethods=Array.isArray(raw.conversionMethods)?raw.conversionMethods.map(String):[];
    row.products=resolved.products.map(p=>({id:p.id,code:p.code||p.sku||'',name:p.name,image:p.image||p.imageUrl||'',promotionOnly:Boolean(p.promotionOnly),compositionPending:Boolean(p.compositionPending),categories:PromotionData.productCategories(p),...(privateCosts?{unitCost:p.costConnected?PromotionData.amount(p.unitCost??p.cost):null,costSource:p.costSource||''}:{})}));
    row.unresolved=resolved.unresolved;row.legacyLabels=resolved.legacyLabels;
    if(privateCosts){row.expense=PromotionData.costs(raw,resolved);row.metrics=Object.fromEntries(metrics.map(k=>[k,PromotionData.amount(raw[k])]));}
    return row;
  });
  return {placements,updatedAt:source.updatedAt||null,privateCosts,catalogConnected:Boolean(catalog.catalogConnected),catalogSyncedAt:catalog.syncedAt||null,catalogError:catalog.error||''};
}
