// Cache efficiency: pure functions over token counts { in, cr, cw } and a model.
const { priceOf } = require('./pricing');

// A session "rebuilds its cache often" when it wrote at least this many cache
// tokens and read back fewer than CACHE_REBUILD_READS_PER_WRITE tokens per written one.
const CACHE_REBUILD_MIN_WRITE_TOKENS = 20000;
const CACHE_REBUILD_READS_PER_WRITE = 1;

const num = v => (Number.isFinite(v) && v > 0 ? v : 0);

// cache reads / (cache reads + fresh input); null when neither exists (no cache use, no input).
function cacheHitRate({ in: fresh, cr } = {}) {
  const r = num(cr), total = r + num(fresh);
  return total > 0 ? r / total : null;
}

// API-price equivalent of cache writes in USD (5-minute rate: the logs don't split 5 min / 1 h).
function cacheWriteCost(model, cw) {
  const w = num(cw);
  return w > 0 ? w * priceOf(model).in * 1.25 / 1e6 : 0;
}

function rebuildsCache({ cr, cw } = {}) {
  const w = num(cw);
  return w >= CACHE_REBUILD_MIN_WRITE_TOKENS && num(cr) < w * CACHE_REBUILD_READS_PER_WRITE;
}

const emptyCache = () => ({ in: 0, cr: 0, cw: 0, cwCost: 0 });

// Adds a record's cache numbers to an accumulator { in, cr, cw, cwCost }.
function addCache(acc, r) {
  acc.in += num(r.in); acc.cr += num(r.cr); acc.cw += num(r.cw);
  acc.cwCost += cacheWriteCost(r.model, r.cw);
  return acc;
}

// { hitRate, cwCost, rebuilds } for an accumulator.
function cacheSummary(acc) {
  return { hitRate: cacheHitRate(acc), cwCost: acc.cwCost, rebuilds: rebuildsCache(acc) };
}

module.exports = { CACHE_REBUILD_MIN_WRITE_TOKENS, CACHE_REBUILD_READS_PER_WRITE, cacheHitRate, cacheWriteCost, rebuildsCache, addCache, cacheSummary, emptyCache };
