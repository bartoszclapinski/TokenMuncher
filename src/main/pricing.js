// API list prices in USD per million tokens. Used only for the "API equivalent"
// panel and as a weight for estimating how fast plan limits are consumed.
// cacheRead defaults to 10% of input; cache writes cost 1.25x (5 min) or 2x (1 h) input.
const TABLE = [
  // [id prefix, input, output, cacheRead override]
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-mythos-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50],
  ['claude-mythos-5', 10, 50],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-5', 5, 25],
  ['claude-opus-4-8', 5, 25],
  ['claude-opus-4-7', 5, 25],
  ['claude-opus-4-6', 5, 25],
  ['claude-opus-4-5', 5, 25],
  ['claude-opus-4-1', 15, 75],
  ['claude-opus-4', 15, 75],
  ['claude-sonnet-5-5', 2, 10, 0.2],
  ['claude-sonnet-5', 2, 10],
  ['claude-sonnet-4', 3, 15],
  ['claude-3-7-sonnet', 3, 15],
  ['claude-haiku-5-5', 0.1, 0.5],
  ['claude-haiku-4-5', 1, 5],
  ['claude-3-5-haiku', 0.8, 4],
];

const FAMILY_FALLBACK = { fable: [10, 50], mythos: [10, 50], opus: [5, 25], sonnet: [3, 15], haiku: [1, 5] };

function family(model) {
  const m = /(fable|mythos|opus|sonnet|haiku)/.exec(model || '');
  return m ? m[1] : 'other';
}

// "claude-opus-5-5" -> "opus 5.5", "claude-haiku-4-5-20251001" -> "haiku 4.5"
function displayName(model) {
  if (!model) return 'unknown';
  let m = /claude-(\w+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[.*\])?$/.exec(model);
  if (m && isNaN(+m[1])) return m[1] + ' ' + m[2] + (m[3] ? '.' + m[3] : '');
  m = /claude-(\d+)-(\d+)-(\w+)/.exec(model); // claude-3-5-haiku
  if (m) return m[3] + ' ' + m[1] + '.' + m[2];
  return model.replace(/^claude-/, '');
}

const cache = new Map();
function priceOf(model) {
  if (cache.has(model)) return cache.get(model);
  const row = TABLE.find(r => (model || '').startsWith(r[0]));
  let p;
  if (row) p = { in: row[1], out: row[2], cr: row[3] ?? row[1] * 0.1 };
  else {
    const f = FAMILY_FALLBACK[family(model)] || [3, 15];
    p = { in: f[0], out: f[1], cr: f[0] * 0.1 };
  }
  cache.set(model, p);
  return p;
}

// u: { in, out, cr, cw5, cw1 } token counts
function costOf(model, u) {
  const p = priceOf(model);
  return (u.in * p.in + u.out * p.out + u.cr * p.cr + u.cw5 * p.in * 1.25 + u.cw1 * p.in * 2) / 1e6;
}

// OpenAI list prices (Codex). [prefix, input, cached input, output] per MTok.
// Approximate: unknown newer GPT models fall back to GPT-5 prices.
const OPENAI = [
  ['gpt-5-pro', 15, 15, 120],
  ['gpt-5.1-codex-mini', 0.25, 0.025, 2],
  ['gpt-5-codex-mini', 0.25, 0.025, 2],
  ['gpt-5-mini', 0.25, 0.025, 2],
  ['gpt-5-nano', 0.05, 0.005, 0.4],
  ['gpt-5', 1.25, 0.125, 10],
  ['gpt-4.1-mini', 0.4, 0.1, 1.6],
  ['gpt-4.1', 2, 0.5, 8],
  ['o4-mini', 1.1, 0.275, 4.4],
  ['o3', 2, 0.5, 8],
];
function costOpenAI(model, u) {
  const row = OPENAI.find(r => (model || '').startsWith(r[0])) || OPENAI.find(r => r[0] === 'gpt-5');
  return (u.in * row[1] + u.cr * row[2] + u.out * row[3]) / 1e6;
}

module.exports = { priceOf, costOf,costOpenAI, family, displayName };
