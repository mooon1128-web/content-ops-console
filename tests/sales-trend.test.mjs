import test from 'node:test';
import assert from 'node:assert/strict';
import {combinedSales,productTrend,trendChart} from '../public/stock-ops/sales-ui.js';
test('combined net sums two platforms without replacing originals; missing/refund uncertainty is not zero',()=>{
 const g={channels:{'淘宝':[{net:23,through:'2026-08-31'}],'小红书':[{net:114,through:'2026-08-31'}]}};
 const before=JSON.stringify(g);assert.equal(combinedSales(g).value,137);assert.equal(combinedSales(g).partial,false);assert.equal(JSON.stringify(g),before);
 assert.deepEqual(combinedSales({channels:{'淘宝':[{net:23}]}}),{value:null,known:23,partial:true,pending:false});
 assert.equal(combinedSales({channels:{'淘宝':[{net:23}],'小红书':[{net:null,refundPending:true}]}}).pending,true);
 assert.equal(combinedSales({channels:{'淘宝':[{net:0}],'小红书':[{net:0}]}}).value,0);
 assert.equal(combinedSales({channels:{'淘宝':[{net:1},{net:2}],'小红书':[{net:3}]}}).value,null);
 g.channels['小红书'][0].through='2026-08-20';assert.equal(combinedSales(g).partial,true);
});
test('four-month trend preserves missing months, partial periods and input records',()=>{
 const s={monthly:[{skuId:'a',month:'2026-08',channel:'淘宝',net:23,through:'2026-08-31'},{skuId:'a',month:'2026-08',channel:'小红书',net:114,through:'2026-08-31'},{skuId:'a',month:'2026-11',channel:'淘宝',net:10,through:'2026-11-21'}]};
 const before=JSON.stringify(s),p=productTrend(s,'a','2026-11');
 assert.deepEqual(p.map(r=>r.month),['2026-08','2026-09','2026-10','2026-11']);assert.equal(p[0].total.value,137);assert.equal(p[1].total.value,null);assert.equal(p[3].incomplete,true);assert.equal(p[3].total.value,null);assert.equal(JSON.stringify(s),before);
 const html=trendChart(p);assert.match(html,/137/);assert.match(html,/未满月/);assert.match(html,/待补/);assert.equal((html.match(/<circle /g)||[]).length,4);
 assert.equal((html.match(/stroke-width="3"/g)||[]).length,0,'missing months must break the lines');
 const blank=trendChart(productTrend({monthly:[]},'a','2026-11'));assert.match(blank,/尚缺可绘制/);assert.doesNotMatch(blank,/<circle/);
});
