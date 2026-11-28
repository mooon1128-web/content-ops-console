import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import PromotionData from '../public/content-ops/promotion-data.cjs';

const app = await readFile(new URL('../public/xhs-media/app.js', import.meta.url), 'utf8');
function setup(rows = []) {
  let now = '2026-11-28T13:42:00Z';
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return new RealDate(now).getTime(); }
  }
  class FormData { constructor(form) { this.values = form.values; } entries() { return this.values[Symbol.iterator](); } }
  const nodes = new Map();
  const node = key => {
    if (!nodes.has(key)) nodes.set(key, {value:'', innerHTML:'', textContent:'', dataset:{}, classList:{add(){}, remove(){}, toggle(){}}});
    return nodes.get(key);
  };
  const ctx = vm.createContext({PromotionData, Date:FixedDate, FormData, crypto:{randomUUID}, structuredClone, console,
    document:{querySelector:node, querySelectorAll:()=>[]}, setTimeout:()=>1, clearTimeout(){}});
  vm.runInContext(app.slice(0, app.lastIndexOf('  startSharedApp().catch(')) + `globalThis.s={creatorCreatedDate,matchesCreatorAddedFilter,filteredCreators,formToCreator,renderCreators,
    setup:rows=>{creators=rows;placements=[];renderClassificationWorkbench=()=>{};renderBlacklist=()=>{}},rows:()=>creators};})();`, ctx);
  ctx.s.setup(structuredClone(rows));
  return {s:ctx.s, node, clock:value=>now=value};
}
const creator = (id, createdAt, more={}) => ({id, name:id, createdAt, fanCount:1, creatorType:'未分类', placementIds:[], ...more});
test('today and yesterday use Shanghai calendar days, with exactly seven dates including today', () => {
  const f = setup();
  for (const timezone of ['Asia/Shanghai', 'UTC', 'America/Los_Angeles']) {
    const prior = process.env.TZ;
    try {
      process.env.TZ = timezone;
      assert.equal(f.s.matchesCreatorAddedFilter(creator('today','2026-11-28'),'today'), true, timezone);
      assert.equal(f.s.matchesCreatorAddedFilter(creator('yesterday','2026-11-27'),'yesterday'), true, timezone);
      const included = Array.from({length:9}, (_,n)=>`2026-11-${String(29-n).padStart(2,'0')}`)
        .filter(date=>f.s.matchesCreatorAddedFilter(creator(date,date),'7days'));
      assert.deepEqual(included, ['2026-11-28','2026-11-27','2026-11-26','2026-11-25','2026-11-24','2026-11-23','2026-11-22']);
    } finally { if(prior===undefined)delete process.env.TZ;else process.env.TZ=prior; }
  }
});
test('UTC timestamps and Shanghai midnight are assigned to the actual local date', () => {
  const f=setup();
  assert.equal(f.s.creatorCreatedDate(creator('late','2026-11-27T16:01:00Z')), '2026-11-28');
  f.clock('2026-11-27T15:59:59Z');
  assert.equal(f.s.matchesCreatorAddedFilter(creator('new','2026-11-28'),'today'),false);
  f.clock('2026-11-27T16:00:00Z');
  assert.equal(f.s.matchesCreatorAddedFilter(creator('new','2026-11-28'),'today'),true);
});
test('unknown or invalid dates stay unknown; edits and cooperation history do not imply a new creator', () => {
  const rows=[creator('old','2026-07-20',{updatedAt:'2026-11-28',cooperationCount:5}),creator('new','2026-11-28'),creator('missing',''),creator('invalid','2026-02-30')];
  const f=setup(rows),before=JSON.stringify(f.s.rows());f.node('#creator-added-filter').value='today';
  assert.deepEqual(Array.from(f.s.filteredCreators(),r=>r.id),['new']);
  f.node('#creator-added-filter').value='no-date';assert.deepEqual(Array.from(f.s.filteredCreators(),r=>r.id),['missing','invalid']);
  assert.equal(f.s.creatorCreatedDate({addedAt:'2026-11-28'}),'2026-11-28');
  assert.equal(JSON.stringify(f.s.rows()),before);
});
test('newest-first order and displayed dates remain independent of follower counts',()=>{
  const f=setup([creator('yesterday','2026-11-27',{fanCount:100000}),creator('morning','2026-11-28T01:00:00Z'),creator('evening','2026-11-28T12:00:00Z')]);
  f.node('#creator-added-filter').value='7days';f.node('#creator-sort').value='created';
  assert.deepEqual(Array.from(f.s.filteredCreators(),r=>r.id),['evening','morning','yesterday']);
  f.s.renderCreators();const html=f.node('#creator-table').innerHTML;
  assert.match(html,/新增：2026-11-28/);assert.match(html,/新增：2026-11-27/);
});
test('new creator saves carry a timestamp; editing old records preserves their first date',()=>{
  const f=setup([creator('old','2026-07-20'),creator('unknown','')]);
  f.clock('2026-11-27T16:01:00Z');
  const form=id=>({values:Object.entries({id,name:'Creator'}),elements:{isBlacklisted:{checked:false}}});
  const fresh=f.s.formToCreator(form(''));
  assert.equal(fresh.createdAt,'2026-11-27T16:01:00.000Z');assert.equal(f.s.creatorCreatedDate(fresh),'2026-11-28');
  assert.equal(f.s.formToCreator(form('old')).createdAt,'2026-07-20');
  assert.equal(f.s.formToCreator(form('unknown')).createdAt,'');
});
