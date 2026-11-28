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
  if(card.headers){for(const [i,canvas] of renderReconciliationCanvases(card).entries())await saveCanvas(canvas,card,i);return;}
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

// Only factory reconciliation facts belong in this export; private prices and contracts do not.
export function reconciliationCard(report){
  const t=report.totals,name=report.product?.name||report.skuId;
  return {title:'到货与瑕疵对账表',reference:report.reference,headers:['产品名','到货单／日期','寄来数量','验收入库','瑕疵数量','最终寄回'],
    rows:[...report.rows.map(r=>[name,r.reference+'\n'+at(r.at),r.received,r.good,r.defect,r.returned]),['合计','全部到货',t.received,t.good,t.defect,t.returned]],
    notes:[`仓库：${report.warehouse}    下单：${report.ordered} 件    少到：${t.shortfall} 件    超收：${t.over} 件`,
      `瑕疵汇总：${t.defect} 件 = 寄回 ${t.returned} 件 + 留仓 ${t.defectInWarehouse} 件；待检 ${t.pending} 件。`,
      ...report.rows.filter(r=>r.defect).map(r=>`${r.reference}：瑕疵 ${r.defect} 件，寄回 ${r.returned} 件，留仓 ${r.remainingDefect} 件；${r.remainingDefect?r.returnDecision:'已全部寄回'}。处理依据：${r.decisionNote||r.note||'未填写'}`),
      ...report.rows.flatMap(r=>r.returns.map(x=>`${r.reference}／寄回单 ${x.reference}：${at(x.at)}，寄回 ${x.quantity} 件，物流 ${x.trackingNumber||'未填写'}；${x.note||''}`)),
      ...(report.discrepancyNote?['差额处理：'+report.discrepancyNote]:[]),
      report.sentAt?`第 ${report.version} 版 · ${report.status||'已处理完毕'} · 发送时间 ${at(report.sentAt)}`:'当前明细，尚未经本次处理完毕确认',
      ...(report.processedBy?['仓管确认：'+(report.processedBy.name||report.processedBy.username||'仓管')]:[])]};
}
export function renderReconciliationCanvases(card,createCanvas=()=>document.createElement('canvas')){
  const width=1600,pad=48,maxHeight=2400,line=36,font='26px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',colWidths=[400,330,180,200,180,214];
  const probe=createCanvas(),measure=probe.getContext('2d');if(!measure)throw Error('当前浏览器暂不支持图片下载');measure.font=font;
  const wrap=(value,max)=>{const lines=[];for(const p of String(value??'—').split('\n')){let text='';for(const char of p){if(text&&measure.measureText(text+char).width>max){lines.push(text);text='';}text+=char;}lines.push(text);}return lines;};
  const chunks=[];for(const row of card.rows){const cells=row.map((v,i)=>wrap(v,colWidths[i]-24)),length=Math.max(...cells.map(c=>c.length));for(let start=0;start<length;start+=40)chunks.push({cells:cells.map(c=>c.slice(start,start+40)),height:Math.min(40,length-start)*line+28});}
  for(const note of card.notes){const lines=wrap(note,width-pad*2-24);for(let start=0;start<lines.length;start+=40)chunks.push({cells:[lines.slice(start,start+40)],height:Math.min(40,lines.length-start)*line+28,note:true});}
  const pages=[];let page=[],height=230;for(const row of chunks){if(height+row.height>maxHeight-64&&page.length){pages.push(page);page=[];height=230;}page.push(row);height+=row.height;}if(page.length)pages.push(page);
  return pages.map((rows,n)=>{
    const canvas=createCanvas();canvas.width=width;canvas.height=230+rows.reduce((s,r)=>s+r.height,0)+64;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);ctx.fillStyle='#243e35';ctx.font='bold 40px -apple-system, "PingFang SC", sans-serif';ctx.fillText(card.title,pad,66);ctx.font=font;ctx.fillText('批次：'+card.reference,pad,116);ctx.fillText(`第 ${n+1} / ${pages.length} 页`,width-240,66);
    const draw=(cells,y,h,note=false,head=false)=>{let x=pad;ctx.font=font;for(let i=0;i<cells.length;i++){const w=note?width-pad*2:colWidths[i];ctx.fillStyle=head?'#e9f0e5':note?'#f8faf6':'#fff';ctx.fillRect(x,y,w,h);ctx.strokeStyle='#bbc9b6';ctx.lineWidth=1;ctx.strokeRect(x,y,w,h);ctx.fillStyle='#243e35';cells[i].forEach((s,j)=>ctx.fillText(s,x+12,y+36+j*line));x+=w;}};
    draw(card.headers.map(s=>[s]),160,70,false,true);let y=230;for(const row of rows){draw(row.cells,y,row.height,row.note);y+=row.height;}return canvas;
  });
}
async function saveCanvas(canvas,card,page){
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('图片生成失败');
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(card.title+'_'+card.reference).replace(/[\\/:*?"<>|]/g,'_')+'_'+(page+1)+'.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
