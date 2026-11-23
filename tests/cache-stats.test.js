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
  assert.deepEqual(s, { hitRate: null, cwCost: 0, rebuilds: false });
});

test('cache write cost uses 1.25x the input price', () => {
  // opus 4.5: $5 / MTok input -> 1M written tokens = $6.25
  assert.ok(Math.abs(C.cacheWriteCost('claude-opus-4-5', 1e6) - 6.25) < 1e-9);
});

test('rebuild flag: many writes, few reads', () => {
  const big = C.CACHE_REBUILD_MIN_WRITE_TOKENS;
  assert.equal(C.rebuildsCache({ cw: big, cr: 0 }), true);
  assert.equal(C.rebuildsCache({ cw: big, cr: big * 10 }), false);
  assert.equal(C.rebuildsCache({ cw: big - 1, cr: 0 }), false);
  assert.equal(C.rebuildsCache({ cw: 0, cr: 0 }), false);
});

test('aggregator reports cache per session details and per project', () => {
  const S = new Store();
  const now = Date.now(), ts = Math.max(now - 10e3, startOfDay(now) + 1);
  S.session('claude:a', { provider: 'claude', project: 'p', app: 'Claude Code', model: 'claude-opus-4-5' }).lastTs = ts;
  S.addRecord('a', { ts, provider: 'claude', sid: 'claude:a', project: 'p', app: 'Claude Code', model: 'claude-opus-4-5', fam: 'opus', in: 100, out: 10, cr: 0, cw: 50000, total: 50110, cost: 1 });
  const src = { id: 'claude', enabled: true, status: () => ({ id: 'claude', label: 'claude' }), limits: () => [] };
  const agg = new Aggregator(S, [src]);
  const d = agg.sessionDetails('claude:a');
  assert.equal(d.cache.hitRate, 0);
  assert.equal(d.cache.rebuilds, true);
  assert.ok(d.cache.cwCost > 0);
  const top = agg.snapshot(true).topWeek[0];
  assert.equal(top.cache.hitRate, 0);
  assert.equal(top.cache.rebuilds, true);
});
