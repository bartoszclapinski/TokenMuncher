const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULTS, normalize, applyChange } = require('../src/main/settings');
const { evaluate, markReached } = require('../src/main/notify');

test('normalize fills defaults and keeps unknown keys', () => {
  const s = normalize({ bounds: { x: 1 }, mini: { on: true } });
  assert.deepEqual(s.thresholds, DEFAULTS.thresholds);
  assert.equal(s.notifications, true);
  assert.equal(s.forecastNotify, true);
  assert.equal(s.startHidden, false);
  assert.deepEqual(s.sources, { claude: true, cursor: true, codex: true, copilot: true, gemini: true });
  assert.deepEqual(s.bounds, { x: 1 });
  assert.deepEqual(s.mini, { on: true });
  assert.notEqual(s.thresholds, DEFAULTS.thresholds, 'a copy, not the shared default array');
});

test('normalize rejects bad values from a hand-edited file', () => {
  const s = normalize({ notifications: 'yes', thresholds: [90, 'x', 12, 80, 90], sources: { claude: false, cursor: 0, other: false } });
  assert.equal(s.notifications, true);
  assert.deepEqual(s.thresholds, [80, 90]);
  assert.deepEqual(s.sources, { claude: false, cursor: true, codex: true, copilot: true, gemini: true });
  assert.deepEqual(normalize(null).thresholds, [80, 90, 100]);
  assert.deepEqual(normalize([1, 2]).sources.claude, true);
});

test('applyChange: toggles, thresholds, sources; ignores the rest', () => {
  const s = normalize({});
  assert.equal(applyChange(s, 'notifications', false), true);
  assert.equal(s.notifications, false);
  assert.equal(applyChange(s, 'notifications', false), false, 'no change');
  assert.equal(applyChange(s, 'threshold:70', true), true);
  assert.deepEqual(s.thresholds, [70, 80, 90, 100]);
  assert.equal(applyChange(s, 'threshold:90', false), true);
  assert.deepEqual(s.thresholds, [70, 80, 100]);
  assert.equal(applyChange(s, 'threshold:65', true), false, 'not a choice');
  assert.equal(applyChange(s, 'source:cursor', false), true);
  assert.equal(s.sources.cursor, false);
  assert.equal(applyChange(s, 'source:nope', false), false);
  assert.equal(applyChange(s, 'startHidden', 'yes'), false, 'wrong type');
  assert.equal(applyChange(s, 'bounds', {}), false, 'not editable from the panel');
});

const limit = (p, extra = {}) => ({ key: 'claude:session', provider: 'claude', kind: 'session', name: '5h', percent: p, est: p, v: 0, resetsAt: 10e6, ...extra });

test('notification thresholds come from settings', () => {
  assert.equal(evaluate({}, [limit(75)], 0).notifications.length, 0, 'default: nothing below 80');
  const n = evaluate({}, [limit(75)], 0, { thresholds: [50, 70] }).notifications;
  assert.equal(n.length, 1);
  assert.equal(n[0].level, 70, 'only the highest crossed one');
  assert.equal(evaluate({}, [limit(95)], 0, { thresholds: [] }).notifications.length, 0, 'all off');
});

test('the 5h run-out warning can be switched off', () => {
  const burning = limit(80, { v: 0.05 }); // 20 % left at 0.05 %/s: ~7 min, long before the reset
  const on = evaluate({}, [burning], 0, { thresholds: [] }).notifications;
  assert.deepEqual(on.map(x => x.kind), ['forecast']);
  assert.equal(evaluate({}, [burning], 0, { thresholds: [], forecast: false }).notifications.length, 0);
});

test('with every threshold off there is no reset notification either', () => {
  const state = { 'claude:session': { resetsAt: 10e6, sent: [80, 90], forecast: false, peak: 95 } };
  const after = evaluate(state, [limit(3, { resetsAt: 28e6 })], 10e6 + 120e3, { thresholds: [] });
  assert.equal(after.notifications.length, 0);
  assert.equal(evaluate(state, [limit(3, { resetsAt: 28e6 })], 10e6 + 120e3).notifications[0].kind, 'reset', 'default still announces it');
});

test('markReached: a threshold switched on below the current level is not announced late', () => {
  const state = { 'claude:session': { resetsAt: 10e6, sent: [80], forecast: false, peak: 85 }, 'claude:weekly': { resetsAt: 10e6, sent: [], forecast: false, peak: 20 } };
  const marked = markReached(state, 50);
  assert.deepEqual(marked['claude:session'].sent, [80, 50]);
  assert.deepEqual(marked['claude:weekly'].sent, [], 'not reached yet: will notify when crossed');
  assert.deepEqual(state['claude:session'].sent, [80], 'input untouched');
  assert.equal(evaluate(marked, [limit(85)], 0, { thresholds: [50, 80, 90, 100] }).notifications.length, 0);
  assert.deepEqual(markReached(undefined, 50), {});
});

test('layouts: defaults, saved ones validated, changes per view', () => {
  const { defaults } = require('../src/shared/layout');
  const s = normalize({});
  assert.deepEqual(s.layout, {}, 'defaults are not stored');
  assert.deepEqual(normalize({ layout: { live: defaults('live') } }).layout, {}, 'a saved default is dropped too');
  const moved = { rows: [[{ id: 'log', w: 2 }]], hidden: ['heat'] };
  assert.equal(applyChange(s, 'layout:live', moved), true);
  assert.deepEqual(s.layout.live.rows[0], [{ id: 'log', w: 2 }]);
  assert.deepEqual(s.layout.live.hidden, ['heat']);
  assert.equal(s.layout.hist, undefined, 'the other view untouched');
  assert.equal(applyChange(s, 'layout:mini', moved), false, 'unknown view');
  assert.equal(applyChange(s, 'layout:toString', moved), false, 'not an own key');
  assert.equal(applyChange(s, 'layout:live', 'garbage'), true, 'garbage resets to the defaults');
  assert.equal(s.layout.live, undefined, 'back on the default: nothing stored');
});
