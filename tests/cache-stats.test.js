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
  assert.deepEqual(s, { hitRate: null, cwCost: 0, cwUnpriced: 0, rebuilds: false });
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
