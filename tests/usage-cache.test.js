const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { JsonlTail } = require('../src/main/jsonl');
const { UsageCache, restore, VERSION } = require('../src/main/usage-cache');

const NOW = Date.now();
const rec = (ts, o = {}) => ({ ts, provider: 'claude', sid: 'claude:s1', project: 'p', app: 'Claude Code', model: 'claude-opus-5-5', fam: 'opus', in: 1, out: 2, cr: 3, cw: 4, total: 10, cost: 0.01, ...o });
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tm-test-'));
const line = n => JSON.stringify({ n, pad: 'x'.repeat(30) });

function filled() {
  const s = new Store();
  s.addRecord('k1', rec(NOW - 2000));
  s.addRecord('k2', rec(NOW - 1000, { total: 20 }));
  s.addEvent('e1', { ts: NOW - 1500, provider: 'claude', project: 'p', text: 'Edit a.ts', tok: 10, kind: 'tool' });
  Object.assign(s.session('claude:s1', { provider: 'claude', project: 'p', app: 'Claude Code', model: 'm' }), { lastTs: NOW - 1000, ctx: 5000, ctxMax: 1e6 });
  return s;
}

test('store survives a JSON round trip, and dedupe still works after it', () => {
  const a = filled();
  const b = new Store();
  b.fromJSON(JSON.parse(JSON.stringify(a.toJSON())));
  assert.deepEqual(b.records, a.records);
  assert.deepEqual(b.events, a.events);
  assert.deepEqual(b.sessions.get('claude:s1'), a.sessions.get('claude:s1'));
  assert.equal(b.addRecord('k1', rec(NOW - 2000)), false, 'known record is not added again');
  b.addEvent('e1', { ts: NOW - 1500, text: 'again' });
  assert.equal(b.events.length, 1, 'known event is not added again');
  assert.equal(b.addRecord('k3', rec(NOW)), true);
});

test('entries older than the cutoff are dropped on load and pruned later', () => {
  const s = new Store();
  s.setFloor('test', s.cutoff - 5 * 86400e3);      // temporarily keep older data
  s.addRecord('old', rec(s.cutoff + 1000 - 5 * 86400e3));
  s.addRecord('new', rec(NOW));
  const saved = JSON.parse(JSON.stringify(s.toJSON()));
  const fresh = new Store();
  fresh.fromJSON(saved);
  assert.deepEqual(fresh.records.map(r => r.cost), [0.01]);
  assert.equal(fresh.seen.has('old'), false);
  delete s.floors.test;                           // floor gone: prepare prunes
  s.cutoff = s.cutoff - 5 * 86400e3;
  s.prepare(NOW);
  assert.equal(s.records.length, 1);
  assert.equal(s.seen.has('old'), false);
});

test('tail reads only new lines after restoring its state, including a finished partial line', async () => {
  const dir = tmpDir(), file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, line(1) + '\n' + line(2) + '\n');
  const seen1 = [];
  const t1 = new JsonlTail([dir], l => seen1.push(JSON.parse(l).n), () => 0);
  await t1.scan(true);
  assert.deepEqual(seen1, [1, 2]);
  fs.appendFileSync(file, line(3) + '\n' + line(4).slice(0, 15)); // 4 is still being written
  await t1.scan(true);
  assert.deepEqual(seen1, [1, 2, 3]);
  const state = JSON.parse(JSON.stringify(t1.exportState()));

  const seen2 = [];
  const t2 = new JsonlTail([dir], l => seen2.push(JSON.parse(l).n), () => 0);
  t2.importState(state);
  fs.appendFileSync(file, line(4).slice(15) + '\n' + line(5) + '\n');
  await t2.scan(true);
  assert.deepEqual(seen2, [4, 5], 'only lines after the saved position, the partial one re-read whole');
});

test('a file shorter than the saved position is read again from the start', async () => {
  const dir = tmpDir(), file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, line(1) + '\n' + line(2) + '\n' + line(3) + '\n');
  const t1 = new JsonlTail([dir], () => {}, () => 0);
  await t1.scan(true);
  const state = t1.exportState();
  fs.writeFileSync(file, line(9) + '\n');           // rewritten, shorter
  const seen = [];
  const t2 = new JsonlTail([dir], l => seen.push(JSON.parse(l).n), () => 0);
  t2.importState(state);
  await t2.scan(true);
  assert.deepEqual(seen, [9]);
});

test('usage cache: save, load into a fresh store, nothing dirty after save', async () => {
  const dir = tmpDir(), file = path.join(dir, 'usage-cache.json');
  const src = { id: 'fake', changes: 3, exportState: () => ({ x: 1 }), importState(s) { this.got = s; } };
  const a = filled();
  const ca = new UsageCache(file, a, [src]);
  assert.equal(ca.dirty(), true);
  assert.equal(await ca.save(), true);
  assert.equal(ca.dirty(), false);
  assert.equal(await ca.save(), false, 'nothing to write');
  assert.equal(fs.existsSync(file + '.tmp'), false, 'temp file renamed into place');

  const b = new Store();
  const src2 = { id: 'fake', changes: 0, importState(s) { this.got = s; } };
  assert.equal(new UsageCache(file, b, [src2]).load(), true);
  assert.deepEqual(b.records, a.records);
  assert.deepEqual(src2.got, { x: 1 });
});

test('usage cache: corrupt file, other version or missing file mean no cache', () => {
  const dir = tmpDir(), file = path.join(dir, 'usage-cache.json');
  const s = new Store();
  assert.equal(new UsageCache(file, s, []).load(), false, 'missing');
  fs.writeFileSync(file, '{"version":1,"store":');
  assert.equal(new UsageCache(file, s, []).load(), false, 'corrupt');
  assert.equal(restore({ version: VERSION + 1, store: {}, sources: {} }, s, []), false, 'other version');
  // version 1 records have no cw1: their 1-hour cache writes would be priced as 5-minute ones
  assert.equal(restore({ version: 1, store: {}, sources: {} }, s, []), false, 'format before cw1');
  assert.equal(s.records.length, 0, 'store untouched');
});

test('a write that finishes after a newer one does not replace it', () => {
  const dir = tmpDir(), file = path.join(dir, 'usage-cache.json');
  const c = new UsageCache(file, filled(), []);
  const older = c.begin(), newer = c.begin();
  assert.equal(c.commitName(newer), true);
  assert.equal(c.commitName(older), false);
});

test('save on quit wins over a background save that is still running', async () => {
  const dir = tmpDir(), file = path.join(dir, 'usage-cache.json');
  const s = filled();
  const c = new UsageCache(file, s, []);
  const background = c.save();                 // starts writing the 2-record state
  s.addRecord('k-late', rec(NOW));             // something new arrives
  c.saveSync();                                // quit
  await background;
  const b = new Store();
  assert.equal(new UsageCache(file, b, []).load(), true);
  assert.equal(b.records.length, 3, 'the file holds the newer state');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), [], 'no temp files left');
});

test('cache from another app version is not used; stale temp files are removed on load', async () => {
  const dir = tmpDir(), file = path.join(dir, 'usage-cache.json');
  await new UsageCache(file, filled(), [], { app: '0.7.0' }).save();
  fs.writeFileSync(file + '.123.9.tmp', 'half a write');
  const s = new Store();
  assert.equal(new UsageCache(file, s, [], { app: '0.8.0' }).load(), false);
  assert.equal(s.records.length, 0);
  assert.equal(fs.existsSync(file + '.123.9.tmp'), false);
  assert.equal(new UsageCache(file, new Store(), [], { app: '0.7.0' }).load(), true);
});

test('a saved floor (Cursor billing cycle) keeps older records on load', () => {
  const s = new Store();
  const early = s.cutoff - 5 * 86400e3;
  s.setFloor('cursor', early);
  s.addRecord('early', rec(early + 1000));
  const fresh = new Store();
  fresh.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  assert.equal(fresh.records.length, 1);
  assert.equal(fresh.floors.cursor, early);
});

test('deleted logs drop out of the tail state; old logs are not saved', async () => {
  const dir = tmpDir(), a = path.join(dir, 'a.jsonl'), b = path.join(dir, 'b.jsonl');
  fs.writeFileSync(a, line(1) + '\n');
  fs.writeFileSync(b, line(2) + '\n');
  let cutoff = 0;
  const t = new JsonlTail([dir], () => {}, () => cutoff);
  await t.scan(true);
  assert.equal(t.exportState().length, 2);
  fs.rmSync(b);
  await t.scan(true);
  assert.deepEqual(t.exportState().map(([p]) => p), [a]);
  cutoff = Date.now() + 60e3;                      // everything is now older than the cutoff
  assert.deepEqual(t.exportState(), []);
});

test('a log replaced by a new file of at least the same length is read again from the start', async () => {
  const dir = tmpDir(), file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, line(1) + '\n' + line(2) + '\n');
  const t1 = new JsonlTail([dir], () => {}, () => 0);
  await t1.scan(true);
  const state = JSON.parse(JSON.stringify(t1.exportState()));
  // same bytes before the old position (uniform test lines), but a new file
  const other = path.join(os.tmpdir(), `tm-new-${process.pid}.jsonl`);
  fs.writeFileSync(other, line(7) + '\n' + line(8) + '\n' + line(9) + '\n');
  fs.rmSync(file);
  fs.renameSync(other, file);
  const seen = [];
  const t2 = new JsonlTail([dir], l => seen.push(JSON.parse(l).n), () => 0);
  t2.importState(state);
  await t2.scan(true);
  assert.deepEqual(seen, [7, 8, 9]);
});

test('a log rewritten in place (same file id) is caught by the bytes before the position', async () => {
  const dir = tmpDir(), file = path.join(dir, 'a.jsonl');
  const uline = n => JSON.stringify({ pad: 'x'.repeat(30), uuid: `id-${n}-${'abcdef'.repeat(3)}` }); // unique endings, like real logs
  fs.writeFileSync(file, uline(1) + '\n' + uline(2) + '\n');
  const t1 = new JsonlTail([dir], () => {}, () => 0);
  await t1.scan(true);
  const state = JSON.parse(JSON.stringify(t1.exportState()));
  const fd = fs.openSync(file, 'r+');
  fs.ftruncateSync(fd, 0);
  fs.writeSync(fd, uline(7) + '\n' + uline(8) + '\n' + uline(9) + '\n', 0);
  fs.closeSync(fd);
  const seen = [];
  const t2 = new JsonlTail([dir], l => seen.push(JSON.parse(l).uuid.split('-')[1]), () => 0);
  t2.importState(state);
  await t2.scan(true);
  assert.deepEqual(seen, ['7', '8', '9']);
});

test('an unchanged log with appended lines keeps its position after a restart', async () => {
  const dir = tmpDir(), file = path.join(dir, 'a.jsonl');
  fs.writeFileSync(file, line(1) + '\n');
  const t1 = new JsonlTail([dir], () => {}, () => 0);
  await t1.scan(true);
  const state = JSON.parse(JSON.stringify(t1.exportState()));
  fs.appendFileSync(file, line(2) + '\n');
  const seen = [];
  const t2 = new JsonlTail([dir], l => seen.push(JSON.parse(l).n), () => 0);
  t2.importState(state);
  await t2.scan(true);
  assert.deepEqual(seen, [2]);
});
