// Cache efficiency: pure functions over token counts { in, cr, cw, cw1 } and a model.
const { priceOf, costOf, hasClaudePrice } = require('./pricing');

// One response is a cache rebuild when it wrote at least
// CACHE_REBUILD_MIN_WRITE_TOKENS cache tokens and read back fewer than
// CACHE_REBUILD_READS_PER_WRITE tokens per written one: the context was written
// again instead of being read from the cache. A session's first response is
// never counted: starting cold is not a rebuild (see rebuildCount).
const CACHE_REBUILD_MIN_WRITE_TOKENS = 10000;
const CACHE_REBUILD_READS_PER_WRITE = 1;
// A session or project "rebuilds its cache often" when at least
// CACHE_REBUILD_MIN_EVENTS of its responses were rebuilds and they make up at
// least CACHE_REBUILD_MIN_SHARE of all its responses.
const CACHE_REBUILD_MIN_EVENTS = 3;
const CACHE_REBUILD_MIN_SHARE = 0.2;

// Cache write multipliers on the input price (same as costOf in pricing.js).
const CACHE_WRITE_5M = 1.25;
const CACHE_WRITE_1H = 2;

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);

// cache reads / (cache reads + fresh input); null when neither exists (no cache use, no input).
function cacheHitRate({ in: fresh, cr } = {}) {
  const r = num(cr), total = r + num(fresh);
  return total > 0 ? r / total : null;
}

// API-price equivalent of cache writes in USD. cw is all written tokens, cw1 the
// part written with a 1-hour TTL (2x input); the rest is 5-minute (1.25x input).
// Returns null for models without a real Claude price (e.g. gpt-* via Cursor):
// guessing would show a made-up number.
function cacheWriteCost(model, cw, cw1 = 0) {
  const w = num(cw);
  if (w === 0) return 0;
  if (!hasClaudePrice(model)) return null;
  const h = Math.min(num(cw1), w);
  return ((w - h) * CACHE_WRITE_5M + h * CACHE_WRITE_1H) * priceOf(model).in / 1e6;
}

// Is this single response a cache rebuild (many tokens written, few read)?
function isCacheRebuild({ cr, cw } = {}) {
  const w = num(cw);
  return w >= CACHE_REBUILD_MIN_WRITE_TOKENS && num(cr) < w * CACHE_REBUILD_READS_PER_WRITE;
}

// rebuilds: responses that were cache rebuilds, responses: all responses.
function rebuildsCache({ rebuilds, responses } = {}) {
  const n = num(rebuilds), all = num(responses);
  return n >= CACHE_REBUILD_MIN_EVENTS && all > 0 && n / all >= CACHE_REBUILD_MIN_SHARE;
}

// Cache write cost of one record, on the same basis as the record's own cost:
// r.cost × the cache writes' share of the record at list prices. For Claude
// Code records (cost = list price) that is the list price of the writes; for
// Cursor on a Claude model (cost = what Cursor charged) it is the matching part
// of that charge, so it can never exceed the cost shown next to it. Records
// without a cost get the list price; null when the model has no known price.
function recordCacheWriteCost(r = {}) {
  const list = cacheWriteCost(r.model, r.cw, r.cw1);
  if (!list || !Number.isFinite(r.cost)) return list;
  const w = num(r.cw), h = Math.min(num(r.cw1), w);
  const full = costOf(r.model, { in: num(r.in), out: num(r.out), cr: num(r.cr), cw5: w - h, cw1: h }); // >= list > 0
  return Math.max(0, r.cost) * Math.min(1, list / full);
}

// cwUnpriced: written tokens whose cost is unknown (left out of cwCost).
// rebuilds: every response that was a rebuild, cold starts included.
// first: sid -> { ts, rebuild } of the session's earliest record added so far.
// warm: sessions known to have responses older than anything added here.
const emptyCache = () => ({ in: 0, cr: 0, cw: 0, cwCost: 0, cwUnpriced: 0, responses: 0, rebuilds: 0, first: new Map(), warm: new Set() });

// Adds a record's cache numbers to an accumulator, in any order: the cold
// start of a session is its record with the lowest ts (the one added first
// among equal or missing ts). warm = true says the session had responses
// before the ones added here, so none of these is its cold start.
function addCache(acc, r, warm = false) {
  acc.in += num(r.in); acc.cr += num(r.cr); acc.cw += num(r.cw);
  acc.responses++;
  const rebuild = isCacheRebuild(r);
  if (rebuild) acc.rebuilds++;
  if (warm) acc.warm.add(r.sid);
  const ts = Number.isFinite(r.ts) ? r.ts : 0, f = acc.first.get(r.sid);
  if (!f || ts < f.ts) acc.first.set(r.sid, { ts, rebuild });
  const c = recordCacheWriteCost(r);
  if (c == null) acc.cwUnpriced += num(r.cw);
  else acc.cwCost += c;
  return acc;
}

// Rebuilds of an accumulator without the cold starts: a session's first
// response writes its cache with nothing to read, which is not a rebuild.
function rebuildCount(acc) {
  let cold = 0;
  for (const [sid, f] of acc.first) if (f.rebuild && !acc.warm.has(sid)) cold++;
  return acc.rebuilds - cold;
}

// { hitRate, cwCost, cwUnpriced, rebuilds, rebuildCount, responses } for an
// accumulator. rebuilds is the "rebuilds its cache often" flag, rebuildCount
// the number of responses behind it.
function cacheSummary(acc) {
  const n = rebuildCount(acc);
  return {
    hitRate: cacheHitRate(acc), cwCost: acc.cwCost, cwUnpriced: acc.cwUnpriced,
    rebuilds: rebuildsCache({ rebuilds: n, responses: acc.responses }), rebuildCount: n, responses: acc.responses
  };
}

module.exports = {
  CACHE_REBUILD_MIN_WRITE_TOKENS, CACHE_REBUILD_READS_PER_WRITE, CACHE_REBUILD_MIN_EVENTS, CACHE_REBUILD_MIN_SHARE,
  CACHE_WRITE_5M, CACHE_WRITE_1H,
  cacheHitRate, cacheWriteCost, recordCacheWriteCost, isCacheRebuild, rebuildsCache, rebuildCount, addCache, cacheSummary, emptyCache
};
