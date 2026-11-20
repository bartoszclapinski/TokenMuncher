// Panel layout of the live and history views: rows of panels, each panel with
// a width weight (panels in a row share its width by weight; heights follow
// the content). Pure, shared by the renderer (editor) and main (validation of
// what is saved in settings.json).
//
//   layout: { rows: [[{ id, w }]], hidden: [id] }
const PANELS = {
  live: ['critter', 'limits', 'budget', 'timeline', 'api', 'sessions', 'context', 'types', 'models', 'heat', 'log'],
  hist: ['winChart', 'winList', 'weekly', 'summary', 'monthly', 'daily', 'burners', 'byApp', 'usageExport']
};

const DEFAULTS = {
  live: [
    [['critter', 1], ['limits', 3]],
    [['budget', 1]],
    [['timeline', 3], ['api', 1]],
    [['sessions', 1]],
    [['context', 1], ['types', 1], ['models', 1]],
    [['heat', 2], ['log', 3]]
  ],
  hist: [
    [['winChart', 3], ['winList', 2]],
    [['weekly', 1]],
    [['summary', 1]],
    [['monthly', 1]],
    [['daily', 1]],
    [['burners', 3], ['byApp', 1]],
    [['usageExport', 1]]
  ]
};

const W_MIN = 0.2, W_MAX = 10;
const clampW = w => (typeof w === 'number' && isFinite(w) ? Math.min(W_MAX, Math.max(W_MIN, Math.round(w * 100) / 100)) : 1);

function defaults(view) {
  return { rows: DEFAULTS[view].map(row => row.map(([id, w]) => ({ id, w }))), hidden: [] };
}

// Any saved value -> a valid layout: known ids only, each once, weights in
// range, no empty rows. Panels the saved layout doesn't know (added in a newer
// version) go to the end as rows of their own, so they are never lost.
function normalize(saved, view) {
  const known = PANELS[view];
  if (!known) throw new Error('unknown view ' + view);
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.rows)) return defaults(view);
  const seen = new Set();
  const take = id => (typeof id === 'string' && known.includes(id) && !seen.has(id) ? (seen.add(id), true) : false);
  const rows = saved.rows
    .filter(Array.isArray)
    .map(row => row.filter(p => p && take(p.id)).map(p => ({ id: p.id, w: clampW(p.w) })))
    .filter(row => row.length);
  const hidden = (Array.isArray(saved.hidden) ? saved.hidden : []).filter(take);
  for (const id of known) if (!seen.has(id)) rows.push([{ id, w: 1 }]);
  return { rows, hidden };
}

const clone = l => ({ rows: l.rows.map(r => r.map(p => ({ ...p }))), hidden: l.hidden.slice() });
const rowOf = (l, id) => l.rows.findIndex(r => r.some(p => p.id === id));
function without(l, id) {
  const out = clone(l);
  out.rows = out.rows.map(r => r.filter(p => p.id !== id)).filter(r => r.length);
  out.hidden = out.hidden.filter(h => h !== id);
  return out;
}

// Moves panel `id` (shown or hidden) to a target given by another panel, so
// indices don't shift under it:
//   { beside: otherId, side: 'left' | 'right' }  same row as otherId
//   { row: otherId, where: 'above' | 'below' }   a new row of its own
//   { end: true }                                a new row at the end
// Returns the layout unchanged when the target is the panel itself.
function move(l, id, target) {
  const anchor = target.beside || target.row;
  if (anchor === id) return l;
  const cur = l.rows.flatMap(r => r).find(p => p.id === id);
  const panel = { id, w: cur ? cur.w : 1 };
  const out = without(l, id);
  if (target.end) { out.rows.push([panel]); return out; }
  const r = rowOf(out, anchor);
  if (r < 0) return l;
  if (target.beside) {
    const i = out.rows[r].findIndex(p => p.id === anchor);
    out.rows[r].splice(target.side === 'left' ? i : i + 1, 0, panel);
  } else {
    out.rows.splice(target.where === 'above' ? r : r + 1, 0, [panel]);
  }
  return out;
}

// Sets the weights of two neighbours in a row (the gap between them dragged).
function resize(l, aId, wa, bId, wb) {
  const out = clone(l);
  for (const row of out.rows) for (const p of row) {
    if (p.id === aId) p.w = clampW(wa);
    if (p.id === bId) p.w = clampW(wb);
  }
  return out;
}

function hide(l, id) {
  if (l.hidden.includes(id) || rowOf(l, id) < 0) return l;
  const out = without(l, id);
  out.hidden.push(id);
  return out;
}

// A hidden panel comes back as a row of its own at the end.
function show(l, id) {
  if (!l.hidden.includes(id)) return l;
  return move(l, id, { end: true });
}

module.exports = { PANELS, defaults, normalize, move, resize, hide, show, W_MIN, W_MAX };
