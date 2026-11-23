// Cache efficiency: pure functions over token counts { in, cr, cw, cw1 } and a model.
const { priceOf, hasClaudePrice } = require('./pricing');

// One response is a cache rebuild when it wrote at least
// CACHE_REBUILD_MIN_WRITE_TOKENS cache tokens and read back fewer than
// CACHE_REBUILD_READS_PER_WRITE tokens per written one: the context was written
// again instead of being read from the cache. A session's first response is
// never counted: starting cold is not a rebuild.
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

// cwUnpriced: written tokens whose cost is unknown (left out of cwCost).
// sids: sessions seen so far, to tell each one's first response.
const emptyCache = () => ({ in: 0, cr: 0, cw: 0, cwCost: 0, cwUnpriced: 0, responses: 0, rebuilds: 0, sids: new Set() });

// Adds a record's cache numbers to an accumulator. Records must come in time
// order (the store keeps them sorted): the first one of each session is its
// cold start and is not counted as a rebuild.
function addCache(acc, r) {
  acc.in += num(r.in); acc.cr += num(r.cr); acc.cw += num(r.cw);
  acc.responses++;
  if (!acc.sids.has(r.sid)) acc.sids.add(r.sid);
  else if (isCacheRebuild(r)) acc.rebuilds++;
  const c = cacheWriteCost(r.model, r.cw, r.cw1);
  if (c == null) acc.cwUnpriced += num(r.cw);
  else acc.cwCost += c;
  return acc;
}

// { hitRate, cwCost, cwUnpriced, rebuilds, rebuildCount, responses } for an
// accumulator. rebuilds is the "rebuilds its cache often" flag, rebuildCount
// the number of responses behind it.
function cacheSummary(acc) {
  return {
    hitRate: cacheHitRate(acc), cwCost: acc.cwCost, cwUnpriced: acc.cwUnpriced,
    rebuilds: rebuildsCache(acc), rebuildCount: acc.rebuilds, responses: acc.responses
  };
}

module.exports = {
  CACHE_REBUILD_MIN_WRITE_TOKENS, CACHE_REBUILD_READS_PER_WRITE, CACHE_REBUILD_MIN_EVENTS, CACHE_REBUILD_MIN_SHARE,
  CACHE_WRITE_5M, CACHE_WRITE_1H,
  cacheHitRate, cacheWriteCost, isCacheRebuild, rebuildsCache, addCache, cacheSummary, emptyCache
};
