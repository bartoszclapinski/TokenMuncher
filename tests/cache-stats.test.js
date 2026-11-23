const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/main/cache-stats');
const { Store, startOfDay } = require('../src/main/store');
const { Aggregator } = require('../src/main/aggregate');

test('hit rate = reads / (reads + fresh input)', () => {
  assert.equal(C.cacheHitRate({ in: 100, cr: 900 }), 0.9);
  assert.equal(C.cacheHitRate({ in: 100, cr: 0 }), 0);
});

test('no cache use and no input gives null, never NaN or Infinity', () => {
  assert.equal(C.cacheHitRate({ in: 0, cr: 0 }), null);
  assert.equal(C.cacheHitRate({}), null);
  assert.equal(C.cacheHitRate(undefined), null);
  assert.equal(C.cacheHitRate({ in: NaN, cr: Infinity }), null);
  assert.equal(C.cacheWriteCost('claude-opus-4-5', 0), 0);
  assert.equal(C.cacheWriteCost('claude-opus-4-5', undefined), 0);
  const s = C.cacheSummary(C.emptyCache());
  assert.deepEqual(s, { hitRate: null, cwCost: 0, cwUnpriced: 0, rebuilds: false, rebuildCount: 0, responses: 0 });
});

test('cache write cost: 1.25x input for 5-minute writes, 2x for 1-hour writes', () => {
  // opus 4.5: $5 / MTok input -> 1M 5-minute tokens = $6.25, 1M 1-hour tokens = $10
  assert.ok(Math.abs(C.cacheWriteCost('claude-opus-4-5', 1e6) - 6.25) < 1e-9);
  assert.ok(Math.abs(C.cacheWriteCost('claude-opus-4-5', 1e6, 1e6) - 10) < 1e-9);
  assert.ok(Math.abs(C.cacheWriteCost('claude-opus-4-5', 2e6, 1e6) - 16.25) < 1e-9);
  // cw1 larger than cw is clamped
  assert.ok(Math.abs(C.cacheWriteCost('claude-opus-4-5', 1e6, 5e6) - 10) < 1e-9);
});

test('cache write cost matches the cache-write share of costOf', () => {
  const { costOf } = require('../src/main/pricing');
  const m = 'claude-sonnet-4-5';
  const withW = costOf(m, { in: 0, out: 0, cr: 0, cw5: 3000, cw1: 7000 });
  assert.ok(Math.abs(C.cacheWriteCost(m, 10000, 7000) - withW) < 1e-9);
});

test('models without a real Claude price get no guessed write cost', () => {
  assert.equal(C.cacheWriteCost('gpt-5', 1e6), null);
  assert.equal(C.cacheWriteCost('gpt-5', 0), 0);
  const acc = C.emptyCache();
  C.addCache(acc, { model: 'gpt-5', in: 10, cr: 90, cw: 500 });
  C.addCache(acc, { model: 'claude-opus-4-5', in: 0, cr: 0, cw: 1e6 });
  const s = C.cacheSummary(acc);
  assert.equal(s.cwUnpriced, 500);
  assert.ok(Math.abs(s.cwCost - 6.25) < 1e-9);
});

test('one response is a rebuild when it writes a lot and reads little', () => {
  const min = C.CACHE_REBUILD_MIN_WRITE_TOKENS;
  assert.equal(C.isCacheRebuild({ cw: min, cr: 0 }), true);
  assert.equal(C.isCacheRebuild({ cw: min, cr: min * 10 }), false);
  assert.equal(C.isCacheRebuild({ cw: min - 1, cr: 0 }), false);
  assert.equal(C.isCacheRebuild({ cw: 0, cr: 0 }), false);
  assert.equal(C.isCacheRebuild(undefined), false);
});

test('rebuild flag needs enough rebuilds and a large enough share of responses', () => {
  const n = C.CACHE_REBUILD_MIN_EVENTS;
  assert.equal(C.rebuildsCache({ rebuilds: n, responses: n }), true);
  assert.equal(C.rebuildsCache({ rebuilds: n - 1, responses: n - 1 }), false, 'too few events');
  assert.equal(C.rebuildsCache({ rebuilds: n, responses: Math.ceil(n / C.CACHE_REBUILD_MIN_SHARE) + 1 }), false, 'share too small');
  assert.equal(C.rebuildsCache({ rebuilds: 0, responses: 0 }), false);
  assert.equal(C.rebuildsCache({}), false);
  assert.equal(C.rebuildsCache(undefined), false);
});

const big = C.CACHE_REBUILD_MIN_WRITE_TOKENS * 3;
const times = (n, r) => Array.from({ length: n }, () => r);
const feed = recs => {
  const acc = C.emptyCache();
  for (const r of recs) C.addCache(acc, { model: 'claude-opus-4-5', in: 10, ...r });
  return C.cacheSummary(acc);
};

test('a fresh session is not flagged: its cold start is not a rebuild', () => {
  // the first response writes the whole context with nothing to read
  assert.equal(feed([{ sid: 'a', cw: big, cr: 0 }]).rebuilds, false);
  // after the second one total reads are still below total writes
  const two = feed([{ sid: 'a', cw: big, cr: 0 }, { sid: 'a', cw: 500, cr: big }]);
  assert.equal(two.rebuilds, false);
  assert.equal(two.rebuildCount, 0);
  const healthy = feed([{ sid: 'a', cw: big, cr: 0 }, ...times(20, { sid: 'a', cw: 800, cr: big })]);
  assert.equal(healthy.rebuilds, false);
});

test('a session that keeps writing its cache again is flagged', () => {
  const n = C.CACHE_REBUILD_MIN_EVENTS;
  const s = feed(times(n + 1, { sid: 'a', cw: big, cr: 0 }));
  assert.equal(s.rebuildCount, n);
  assert.equal(s.responses, n + 1);
  assert.equal(s.rebuilds, true);
  // one rebuild fewer is not "often"
  assert.equal(feed(times(n, { sid: 'a', cw: big, cr: 0 })).rebuilds, false);
  // the same rebuilds spread over a long, otherwise healthy session
  const rare = feed([...times(n + 1, { sid: 'a', cw: big, cr: 0 }), ...times(n * 10, { sid: 'a', cw: 800, cr: big })]);
  assert.equal(rare.rebuildCount, n);
  assert.equal(rare.rebuilds, false);
});

test('a project of many fresh sessions is not flagged', () => {
  const s = feed(Array.from({ length: 10 }, (_, i) => ({ sid: 's' + i, cw: big, cr: 0 })));
  assert.equal(s.rebuildCount, 0);
  assert.equal(s.rebuilds, false);
});

test('aggregator reports cache per session details and per project', () => {
  const S = new Store();
  const now = Date.now(), t0 = Math.max(now - 10e3, startOfDay(now) + 10);
  const base = { provider: 'claude', project: 'p', app: 'Claude Code', model: 'claude-opus-4-5', fam: 'opus', in: 100, out: 10, cr: 0, cw: 50000, total: 50110, cost: 1 };
  S.session('claude:a', { provider: 'claude', project: 'p', app: 'Claude Code', model: 'claude-opus-4-5' }).lastTs = t0;
  S.session('claude:b', { provider: 'claude', project: 'q', app: 'Claude Code', model: 'claude-opus-4-5' }).lastTs = t0;
  // a: the cold start and three more full writes; b: one fresh response
  for (let i = 0; i < 4; i++) S.addRecord('a' + i, { ...base, ts: t0 + i, sid: 'claude:a' });
  S.addRecord('b0', { ...base, ts: t0 + 4, sid: 'claude:b', project: 'q' });
  const src = { id: 'claude', enabled: true, status: () => ({ id: 'claude', label: 'claude' }), limits: () => [] };
  const agg = new Aggregator(S, [src]);
  const d = agg.sessionDetails('claude:a');
  assert.equal(d.cache.hitRate, 0);
  assert.equal(d.cache.rebuilds, true);
  assert.equal(d.cache.rebuildCount, 3);
  assert.ok(d.cache.cwCost > 0);
  const fresh = agg.sessionDetails('claude:b');
  assert.equal(fresh.cache.rebuilds, false, 'a fresh session is not flagged');
  assert.equal(fresh.cache.hitRate, 0);
  const top = agg.snapshot(true).topWeek;
  const p = top.find(x => x.project === 'p'), q = top.find(x => x.project === 'q');
  assert.equal(p.cache.hitRate, 0);
  assert.equal(p.cache.rebuilds, true);
  assert.equal(q.cache.rebuilds, false);
});

test('cache write cost follows the record cost: Cursor charges are not mixed with list prices', () => {
  const m = 'claude-sonnet-4-5';
  const tok = { model: m, in: 1000, out: 2000, cr: 50000, cw: 40000, cw1: 0 };
  const { costOf } = require('../src/main/pricing');
  const list = costOf(m, { in: 1000, out: 2000, cr: 50000, cw5: 40000, cw1: 0 });
  // Claude Code: cost is the list price, so the write cost is the list price of the writes
  assert.ok(Math.abs(C.recordCacheWriteCost({ ...tok, cost: list }) - C.cacheWriteCost(m, 40000)) < 1e-12);
  // Cursor charged a tenth of the list price: the write cost shrinks with it
  const charged = C.recordCacheWriteCost({ ...tok, cost: list / 10 });
  assert.ok(Math.abs(charged - C.cacheWriteCost(m, 40000) / 10) < 1e-12);
  assert.ok(charged < list / 10, 'never above the cost of the record');
  // a response Cursor did not charge for has no cache write cost either
  assert.equal(C.recordCacheWriteCost({ ...tok, cost: 0 }), 0);
  // only cache writes in the record: the whole cost, not more
  assert.ok(Math.abs(C.recordCacheWriteCost({ model: m, cw: 40000, cost: 0.01 }) - 0.01) < 1e-12);
  assert.equal(C.recordCacheWriteCost({ model: 'gpt-5', cw: 40000, cost: 0.5 }), null);
  assert.equal(C.recordCacheWriteCost({ model: m, cw: 0, cost: 0.5 }), 0);
  assert.equal(C.recordCacheWriteCost(undefined), 0);
  const acc = C.emptyCache();
  for (let i = 0; i < 5; i++) C.addCache(acc, { ...tok, sid: 'cursor:x', ts: i, cost: 0.02 });
  assert.ok(C.cacheSummary(acc).cwCost <= 0.1 + 1e-12, 'session write cost stays within the session cost');
});

test('the cold start is the earliest record, whatever the order records arrive in', () => {
  const n = C.CACHE_REBUILD_MIN_EVENTS;
  // cold start (ts 1), then a healthy response, then n rebuilds
  const recs = [{ ts: 1, cw: big, cr: 0 }, { ts: 2, cw: 500, cr: big }, ...Array.from({ length: n }, (_, i) => ({ ts: 3 + i, cw: big, cr: 0 }))]
    .map(r => ({ ...r, sid: 'a' }));
  const sorted = feed(recs), reversed = feed(recs.slice().reverse());
  const mixed = feed([recs[2], recs[0], recs[4], recs[1], recs[3]]);
  assert.equal(sorted.rebuildCount, n);
  assert.deepEqual(reversed, sorted);
  assert.deepEqual(mixed, sorted);
  // the earliest record is healthy: every rebuild counts, in any order
  const warmFirst = [{ ts: 1, cw: 500, cr: big }, ...Array.from({ length: n }, (_, i) => ({ ts: 2 + i, cw: big, cr: 0 }))].map(r => ({ ...r, sid: 'a' }));
  assert.equal(feed(warmFirst).rebuildCount, n);
  assert.equal(feed(warmFirst.slice().reverse()).rebuildCount, n);
});

test('a session that started before the counted records has no cold start among them', () => {
  const n = C.CACHE_REBUILD_MIN_EVENTS;
  const acc = C.emptyCache();
  for (let i = 0; i < n; i++) C.addCache(acc, { model: 'claude-opus-4-5', sid: 'a', ts: i, in: 10, cw: big, cr: 0 }, true);
  C.addCache(acc, { model: 'claude-opus-4-5', sid: 'b', ts: 0, in: 10, cw: big, cr: 0 }); // a fresh one beside it
  const s = C.cacheSummary(acc);
  assert.equal(s.rebuildCount, n);
  assert.equal(s.rebuilds, true);
});

test('aggregator: responses before the week or before the store cutoff are not a cold start', () => {
  const DAYMS = 86400e3, now = Date.now(), n = C.CACHE_REBUILD_MIN_EVENTS;
  const base = { provider: 'claude', app: 'Claude Code', model: 'claude-opus-4-5', fam: 'opus', in: 100, out: 10, cr: 0, cw: 50000, total: 50110, cost: 1 };
  const src = { id: 'claude', enabled: true, status: () => ({ id: 'claude', label: 'claude' }), limits: () => [] };
  const S = new Store();
  const ses = (sid, project) => { S.session(sid, { provider: 'claude', project, app: 'Claude Code', model: base.model }).lastTs = now - 1000; };
  // old: one response 7.5 days ago (outside the week, inside the store), then n full writes this week
  ses('claude:old', 'p');
  assert.equal(S.addRecord('o', { ...base, ts: now - 7.5 * DAYMS, sid: 'claude:old', project: 'p', cw: 0 }), true);
  for (let i = 0; i < n; i++) S.addRecord('o' + i, { ...base, ts: now - 5000 + i, sid: 'claude:old', project: 'p' });
  // cut: its first responses are older than the store keeps
  ses('claude:cut', 'q');
  assert.equal(S.addRecord('c', { ...base, ts: S.cutoff - 1, sid: 'claude:cut', project: 'q' }), false);
  for (let i = 0; i < n; i++) S.addRecord('c' + i, { ...base, ts: now - 4000 + i, sid: 'claude:cut', project: 'q' });
  // fresh: the same n full writes, the first of them its cold start
  ses('claude:new', 'r');
  for (let i = 0; i < n; i++) S.addRecord('n' + i, { ...base, ts: now - 3000 + i, sid: 'claude:new', project: 'r' });
  const agg = new Aggregator(S, [src]);
  const top = agg.snapshot(true).topWeek, of = name => top.find(x => x.project === name).cache;
  assert.equal(of('p').rebuildCount, n);
  assert.equal(of('p').rebuilds, true);
  assert.equal(of('q').rebuildCount, n);
  assert.equal(of('r').rebuildCount, n - 1);
  assert.equal(of('r').rebuilds, false);
  assert.equal(agg.sessionDetails('claude:cut').cache.rebuildCount, n);
  assert.equal(agg.sessionDetails('claude:new').cache.rebuildCount, n - 1);
  // the mark survives the on-disk cache
  const S2 = new Store();
  S2.fromJSON(JSON.parse(JSON.stringify(S.toJSON())));
  assert.equal(S2.sessions.get('claude:cut').cut, true);
  assert.equal(S2.sessions.get('claude:new').cut, undefined);
  // and pruning sets it: move the cutoff past the old session's first response
  assert.equal(S.sessions.get('claude:old').cut, undefined);
  S.cutoff = now - 30 * DAYMS; // as if the store had kept more
  const later = now - 7 * DAYMS;
  const keep = Store.cutoffFor;
  Store.cutoffFor = () => later;
  try { S.prepare(now); } finally { Store.cutoffFor = keep; }
  assert.equal(S.sessions.get('claude:old').cut, true);
  assert.equal(agg.sessionDetails('claude:old').cache.rebuildCount, n);
});
