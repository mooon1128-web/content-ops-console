import {productPresentation} from './sales-ui.js';
import {purchaseSummary} from './purchasing-math.js';
const qty=x=>x===null||x===undefined?'待核':String(x);
const at=x=>x?new Date(x).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'待补';
export function purchaseRecordCard(state,kind,id){
  const item=(kind==='receipt'?state.purchaseReceipts:kind==='return'?state.purchaseReturns:state.purchases).find(r=>r.id===id);
  if(!item)throw Error('记录不存在，请刷新查看');
  const receipt=kind==='return'?state.purchaseReceipts.find(r=>r.id===item.receiptId):kind==='receipt'?item:null;
  const order=kind==='order'?item:state.purchases.find(o=>o.id===(receipt?.purchaseId||item.purchaseId));
  if(!order)throw Error('原补货批次待核');
  const k=state.skus.find(k=>k.id===order.skuId),x=purchaseSummary(order,state.purchaseReceipts,state.purchaseInspections,state.purchaseReturns);
  const fields=[['商品',productPresentation(k).fullName],['SKU',k?.code||order.skuId],['补货批次',order.reference],['收货仓库',order.warehouse]];
  if(kind==='order'){
    fields.push(['下单日期',order.orderDate],['预计出货',order.expectedShipAt||'待补'],['下单数量',qty(order.quantity)],['累计实收',qty(x.received)],['累计合格入库',qty(x.good)],['累计瑕疵 / 已寄回',`${x.defect} / ${x.returned}`],['剩余待检',qty(x.pending)],['尚未到货 / 超收',`${x.shortfall} / ${x.over}`]);
    if(['admin','finance'].includes(state.role)){const p=state.purchasePrivate?.[order.id];fields.push(['尾款金额（元）',qty(p?.balanceDue)],['结清状态',p?.settlement?.status||'未结清']);}
  }else if(kind==='receipt')fields.push(['本次收货单号',item.reference],['实际收货时间',at(item.at)],['本次实收',qty(item.good+item.defect+item.pending)],['登记时合格 / 瑕疵 / 待检',`${item.good} / ${item.defect} / ${item.pending}`],['瑕疵处理',item.returnDecision],['原订单累计实收 / 下单',`${x.received} / ${order.quantity}`]);
  else fields.push(['关联收货单',receipt.reference],['本次寄回单号',item.reference],['实际寄回时间',at(item.at)],['本次寄回数量',qty(item.quantity)]);
  fields.push(['物流单号',item.trackingNumber||'未填写'],['说明',item.note||'—'],['登记人',item.actor?.name||item.actor?.username||'待核'],['最近保存',at(item.updatedAt)]);
  return {title:{order:'补货批次记录',receipt:'到货登记记录',return:'寄回登记记录'}[kind],reference:item.reference,fields};
}
export async function downloadRecordImage(card){
  const width=1200,pad=64,lineHeight=42,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  if(!ctx)throw Error('当前浏览器暂不支持图片下载');
  const font='28px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif';ctx.font=font;
  const wrap=(text,max)=>{const lines=[];for(const paragraph of String(text??'—').split('\n')){let line='';for(const ch of paragraph){if(ctx.measureText(line+ch).width>max&&line){lines.push(line);line='';}line+=ch;}lines.push(line);}return lines;};
  const lines=card.fields.flatMap(([label,value])=>[...wrap(label+'：'+value,width-2*pad),'']);
  const pages=[];for(let i=0;i<lines.length;i+=110)pages.push(lines.slice(i,i+110));
  for(let n=0;n<pages.length;n++){
    canvas.width=width;canvas.height=210+pages[n].length*lineHeight;ctx.fillStyle='#fafbf7';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#244638';ctx.font='bold 44px -apple-system, "PingFang SC", sans-serif';ctx.fillText(card.title+(pages.length>1?` ${n+1}/${pages.length}`:''),pad,90);ctx.font=font;
    pages[n].forEach((line,i)=>ctx.fillText(line,pad,170+i*lineHeight));
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(card.title+'_'+card.reference).replace(/[\\/:*?"<>|]/g,'_')+(pages.length>1?`_${n+1}`:'')+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
}
