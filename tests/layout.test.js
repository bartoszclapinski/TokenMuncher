const test = require('node:test');
const assert = require('node:assert/strict');
const { PANELS, defaults, normalize, move, resize, hide, show } = require('../src/shared/layout');

const ids = l => l.rows.map(r => r.map(p => p.id).join(','));

test('defaults list every panel once, as today', () => {
  for (const view of ['live', 'hist']) {
    const l = defaults(view);
    assert.deepEqual(l.rows.flat().map(p => p.id).sort(), PANELS[view].slice().sort());
    assert.deepEqual(l.hidden, []);
  }
  assert.deepEqual(ids(defaults('live')), ['critter,limits', 'budget', 'timeline,api', 'sessions', 'context,types,models', 'heat,log']);
});

test('normalize: bad input gives the defaults; unknown, duplicate and empty entries go; new panels are added', () => {
  assert.deepEqual(normalize(null, 'live'), defaults('live'));
  assert.deepEqual(normalize({ rows: 'x' }, 'hist'), defaults('hist'));
  const l = normalize({ rows: [[{ id: 'limits', w: 99 }, { id: 'nope' }, { id: 'limits' }], [], 'x', [{ id: 'critter', w: 'big' }]], hidden: ['log', 'log', 'zzz', 'limits'] }, 'live');
  assert.deepEqual(l.rows[0], [{ id: 'limits', w: 10 }]);
  assert.deepEqual(l.rows[1], [{ id: 'critter', w: 1 }]);
  assert.deepEqual(l.hidden, ['log'], 'once, known, not shown elsewhere');
  const placed = l.rows.flat().map(p => p.id).concat(l.hidden);
  assert.deepEqual(placed.slice().sort(), PANELS.live.slice().sort(), 'panels missing from the save come back');
  assert.throws(() => normalize({}, 'mini'), /unknown view/);
});

test('move beside another panel, above / below a row, to the end', () => {
  const l = defaults('live');
  assert.deepEqual(ids(move(l, 'api', { beside: 'critter', side: 'left' })).slice(0, 3), ['api,critter,limits', 'budget', 'timeline']);
  assert.deepEqual(ids(move(l, 'critter', { beside: 'limits', side: 'right' }))[0], 'limits,critter');
  assert.deepEqual(ids(move(l, 'log', { row: 'critter', where: 'above' })).slice(0, 2), ['log', 'critter,limits']);
  assert.deepEqual(ids(move(l, 'budget', { row: 'heat', where: 'below' })).slice(-2), ['heat,log', 'budget']);
  assert.deepEqual(ids(move(l, 'sessions', { end: true })).slice(-1), ['sessions']);
  assert.equal(move(l, 'limits', { beside: 'limits', side: 'left' }), l, 'onto itself: unchanged');
  assert.equal(move(l, 'limits', { beside: 'nope', side: 'left' }), l, 'unknown target: unchanged');
  // the moved panel keeps its weight; its old row closes up
  const m = move(l, 'limits', { row: 'budget', where: 'below' });
  assert.deepEqual(m.rows[0], [{ id: 'critter', w: 1 }]);
  assert.deepEqual(m.rows[2], [{ id: 'limits', w: 3 }]);
  assert.deepEqual(ids(l)[0], 'critter,limits', 'input untouched');
});

test('resize sets two neighbours, clamped', () => {
  const r = resize(defaults('live'), 'critter', 2.5, 'limits', 0.01);
  assert.deepEqual(r.rows[0], [{ id: 'critter', w: 2.5 }, { id: 'limits', w: 0.2 }]);
});

test('hide and show: a hidden panel comes back at the end', () => {
  const h = hide(defaults('live'), 'heat');
  assert.deepEqual(h.hidden, ['heat']);
  assert.ok(!h.rows.flat().some(p => p.id === 'heat'));
  assert.deepEqual(ids(h).slice(-1), ['log']);
  const s = show(h, 'heat');
  assert.deepEqual(s.hidden, []);
  assert.deepEqual(ids(s).slice(-1), ['heat']);
  assert.equal(hide(h, 'heat'), h, 'already hidden');
  assert.equal(show(defaults('live'), 'heat').hidden.length, 0);
  // a hidden panel can also be dragged straight back into place
  assert.deepEqual(ids(move(h, 'heat', { beside: 'log', side: 'left' })).slice(-1), ['heat,log']);
  assert.deepEqual(move(h, 'heat', { beside: 'log', side: 'left' }).hidden, []);
});

test('usage export is movable and hideable and is added to older History layouts', () => {
  const original = { rows: [[{ id: 'daily', w: 1 }]], hidden: ['weekly'] };
  const updated = normalize(original, 'hist');
  assert.ok(ids(updated).includes('usageExport'));
  assert.equal(ids(move(updated, 'usageExport', { row: 'daily', where: 'above' }))[0], 'usageExport');
  const hidden = hide(updated, 'usageExport');
  assert.ok(!ids(hidden).includes('usageExport'));
  assert.ok(normalize(hidden, 'hist').hidden.includes('usageExport'));
});

test('usage export comes last in the default History layout', () => {
  const rows = normalize(null, 'hist').rows;
  assert.deepEqual(rows.at(-1).map(p => p.id), ['usageExport']);
  assert.ok(!rows.slice(0, -1).flat().some(p => p.id === 'usageExport'));
});
