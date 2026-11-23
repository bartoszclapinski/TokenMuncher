// Cache efficiency: pure functions over token counts { in, cr, cw, cw1 } and a model.
const { priceOf, hasClaudePrice } = require('./pricing');

// A session "rebuilds its cache often" when it wrote at least this many cache
// tokens and read back fewer than CACHE_REBUILD_READS_PER_WRITE tokens per written one.
const CACHE_REBUILD_MIN_WRITE_TOKENS = 20000;
const CACHE_REBUILD_READS_PER_WRITE = 1;

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

function rebuildsCache({ cr, cw } = {}) {
  const w = num(cw);
  return w >= CACHE_REBUILD_MIN_WRITE_TOKENS && num(cr) < w * CACHE_REBUILD_READS_PER_WRITE;
}

// cwUnpriced: written tokens whose cost is unknown (left out of cwCost).
const emptyCache = () => ({ in: 0, cr: 0, cw: 0, cwCost: 0, cwUnpriced: 0 });

// Adds a record's cache numbers to an accumulator.
function addCache(acc, r) {
  acc.in += num(r.in); acc.cr += num(r.cr); acc.cw += num(r.cw);
  const c = cacheWriteCost(r.model, r.cw, r.cw1);
  if (c == null) acc.cwUnpriced += num(r.cw);
  else acc.cwCost += c;
  return acc;
}

// { hitRate, cwCost, cwUnpriced, rebuilds } for an accumulator.
function cacheSummary(acc) {
  return { hitRate: cacheHitRate(acc), cwCost: acc.cwCost, cwUnpriced: acc.cwUnpriced, rebuilds: rebuildsCache(acc) };
}

module.exports = {
  CACHE_REBUILD_MIN_WRITE_TOKENS, CACHE_REBUILD_READS_PER_WRITE, CACHE_WRITE_5M, CACHE_WRITE_1H,
  cacheHitRate, cacheWriteCost, rebuildsCache, addCache, cacheSummary, emptyCache
};
