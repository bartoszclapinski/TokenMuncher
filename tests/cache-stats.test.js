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
