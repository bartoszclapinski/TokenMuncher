const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../src/main/store');
const { GeminiSource, usageOf, toolText, linesOf } = require('../src/main/sources/gemini');
const { costGemini } = require('../src/main/pricing');

// A fabricated session file: Gemini CLI's structure, placeholder content.
const FIXTURE = path.join(__dirname, 'fixtures', 'gemini-cli', 'session.json');
const FIXTURE_JSONL = path.join(__dirname, 'fixtures', 'gemini-cli', 'session.jsonl');
const HASH ='a'.repeat(64);
const SID = 'gemini:00000000-0000-4000-8000-000000000001';

// A fake ~/.gemini with the fixture in tmp/<project>/chats/.
function home(project = HASH, extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gemini-'));
  const chats = path.join(dir, 'tmp', project, 'chats');
  fs.mkdirSync(chats, { recursive: true });
  const file = path.join(chats, 'session-2026-11-20T10-00-00000000.json');
  fs.copyFileSync(FIXTURE, file);
  for (const [name, text] of Object.entries(extra)) fs.writeFileSync(path.join(dir, 'tmp', project, name), text);
  return { dir, chats, file };
}
// A store that keeps the fixture's dates, whenever the tests run.
const store = () => { const s = new Store(); s.cutoff = 0; return s; };

test('gemini: off and harmless when Gemini CLI has no data folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-gemini-none-'));
  const S = store();
  const g = new GeminiSource(S, { home: path.join(dir, '.gemini') });
  assert.equal(g.enabled, false);
  await g.init();
  await g.tick();
  assert.equal(S.records.length, 0);
  assert.deepEqual(g.limits(), []);
  assert.equal(g.status().note, 'usage only');
  assert.equal(g.diagnostics().dataFolder.exists, false);
});

test('gemini: token split from a TokensSummary', () => {
  // input includes cached; tool-use prompt is input, thinking is output
  assert.deepEqual(usageOf({ input: 1000, output: 200, cached: 400, thoughts: 50, tool: 10, total: 1260 }), { in: 610, cr: 400, out: 250, total: 1260 });
  assert.deepEqual(usageOf({ input: 3000, output: 100, cached: 0, total: 3100 }), { in: 3000, cr: 0, out: 100, total: 3100 });
  assert.deepEqual(usageOf({ input: 5, cached: 9, output: -1, thoughts: 'x' }), { in: 0, cr: 5, out: 0, total: 5 }, 'odd values stay sane');
  assert.deepEqual(usageOf({}), { in: 0, cr: 0, out: 0, total: 0 });
});

test('gemini: tool call lines', () => {
  assert.equal(toolText({ name: 'run_shell_command', args: { command: 'npm test\nmore' } }, ''), 'run_shell_command: npm test');
  assert.equal(toolText({ name: 'read_file', args: { absolute_path: '/w/p/src/a.js' } }, '/w/p'), 'read_file src/a.js');
  assert.equal(toolText({ name: 'write_file', args: { file_path: 'C:\\w\\p\\b.js' } }, 'C:\\w\\p'), 'write_file b.js');
  assert.equal(toolText({ name: 'web_fetch', args: { prompt: 'x' } }, ''), 'web_fetch');
  assert.equal(toolText({ args: {} }, ''), null);
  assert.equal(toolText(null, ''), null);
});

test('gemini: reads answers with tokens, sessions and tool calls from a session file', async () => {
  const { dir } = home();
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  assert.equal(g.enabled, true);
  await g.init();

  assert.equal(S.records.length, 2, 'two answers with tokens; the one with tokens: null adds nothing');
  const [a, b] = S.records;
  assert.equal(a.ts, Date.parse('2026-11-20T10:00:05.000Z'));
  assert.deepEqual(
    { provider: a.provider, sid: a.sid, project: a.project, app: a.app, model: a.model, fam: a.fam, in: a.in, out: a.out, cr: a.cr, cw: a.cw, total: a.total },
    { provider: 'gemini', sid: SID, project: 'gemini-aaaaaaaa', app: 'Gemini CLI', model: 'gemini-2.5-pro', fam: 'gemini', in: 610, out: 250, cr: 400, cw: 0, total: 1260 }
  );
  assert.ok(Math.abs(a.cost - costGemini('gemini-2.5-pro', { in: 610, cr: 400, out: 250 })) < 1e-12);
  assert.ok(a.cost > 0);
  assert.deepEqual([b.model, b.in, b.out, b.cr, b.total], ['gemini-2.5-flash', 3000, 100, 0, 3100]);

  const s = S.sessions.get(SID);
  assert.equal(s.provider, 'gemini');
  assert.equal(s.model, 'gemini-2.5-flash', 'the latest answer’s model');
  assert.equal(s.ctx, 3000);
  assert.equal(s.ctxMax, 1048576);
  assert.equal(s.lastTs, b.ts);
  assert.equal(s.lastAction, 'read_file …/src/a.js');

  assert.deepEqual(S.events.map(e => [e.provider, e.text, e.kind]), [['gemini', 'run_shell_command: <command>', 'tool'], ['gemini', 'read_file …/src/a.js', 'tool']]);

  const d = g.diagnostics();
  assert.equal(d.filesTracked, 1);
  assert.equal(d.parser.sessionFiles, 1);
  assert.equal(d.parser.answers, 3);
  assert.equal(d.parser.withTokens, 2);
  assert.equal(d.parser.toolCalls, 2);
  assert.deepEqual({ ...d.parser.messageTypes }, { user: 1, gemini: 3, info: 1 });
  assert.doesNotMatch(JSON.stringify(d), /<prompt>|<answer>|<command>|a\.js/, 'no content in diagnostics');
});

test('gemini: a rewritten file adds only its new answers', async () => {
  const { dir, file } = home();
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  assert.equal(S.records.length, 2);
  await g.scan(true);
  assert.equal(g.filesRead, 1, 'an unchanged file is not read again');

  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.messages.push({ id: 'msg-6', timestamp: '2026-11-20T10:03:00.000Z', type: 'gemini', content: '<answer>', model: 'gemini-2.5-pro', tokens: { input: 4000, output: 10, cached: 3000, total: 4010 } });
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
  await g.scan(true);
  assert.equal(S.records.length, 3);
  assert.deepEqual([S.records[2].in, S.records[2].cr, S.records[2].out], [1000, 3000, 10]);
  assert.equal(S.sessions.get(SID).ctx, 4000);
  assert.equal(S.events.length, 2, 'tool calls are not repeated');
});

test('gemini: a tool call written before its answer has tokens stays on the session', async () => {
  const { dir, file } = home();
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const answer = j.messages.find(m => m.id === 'msg-4');
  const tokens = answer.tokens;
  answer.tokens = null;
  fs.writeFileSync(file, JSON.stringify(j));
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  assert.equal(S.records.length, 1);
  assert.deepEqual(S.sessions.get(SID).actions.map(e => e.text), ['run_shell_command: <command>', 'read_file …/src/a.js']);
  assert.equal(S.sessions.get(SID).lastAction, 'read_file …/src/a.js');

  answer.tokens = tokens;
  fs.writeFileSync(file, JSON.stringify(j));
  await g.scan(true);
  assert.equal(S.records.length, 2, 'the tokens are counted once they arrive');
  assert.equal(S.events.length, 2);
  assert.equal(S.sessions.get(SID).lastAction, 'read_file …/src/a.js');
});

test('gemini: a session seen only through an answer without tokens still exists', async () => {
  const { dir, file } = home();
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const m of j.messages) if (m.type === 'gemini') m.tokens = null;
  fs.writeFileSync(file, JSON.stringify(j));
  const S = store();
  await new GeminiSource(S, { home: dir }).init();
  assert.equal(S.records.length, 0);
  const s = S.sessions.get(SID);
  assert.equal(s.lastTs, Date.parse('2026-11-20T10:00:05.000Z'));
  assert.equal(s.actions.length, 2);
});

test('gemini: an answer whose tokens change in a later rewrite is updated, not counted twice', async () => {
  const { dir, file } = home();
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  const before = S.changes;
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.messages.find(m => m.id === 'msg-4').tokens = { input: 5000, output: 300, cached: 1000, total: 5300 };
  j.lastUpdated = '2026-11-20T10:02:45.000Z';
  fs.writeFileSync(file, JSON.stringify(j));
  await g.scan(true);
  assert.equal(S.records.length, 2);
  const r = S.records[1];
  assert.deepEqual([r.in, r.cr, r.out, r.total], [4000, 1000, 300, 5300]);
  assert.ok(Math.abs(r.cost - costGemini('gemini-2.5-flash', { in: 4000, cr: 1000, out: 300 })) < 1e-12);
  assert.ok(S.changes > before, 'the on-disk cache is saved again');
  assert.equal(g.diagnostics().answersUpdated, 1);

  // after a restart the record comes from the cache, not from this run
  const S2 = store();
  S2.records = JSON.parse(JSON.stringify(S.records));
  S2.seen = new Map(S.seen);
  S2.sessions = new Map([...S.sessions].map(([k, v]) => [k, { ...v }]));
  const again = new GeminiSource(S2, { home: dir });
  j.messages.find(m => m.id === 'msg-4').tokens = { input: 6000, output: 400, cached: 1000, total: 6400 };
  fs.writeFileSync(file, JSON.stringify(j));
  await again.init();
  assert.equal(S2.records.length, 2);
  assert.deepEqual([S2.records[1].in, S2.records[1].out], [5000, 400]);
});

test('gemini: a session-*.jsonl file, one record per line', async () => {
  const { dir, chats, file } = home();
  fs.rmSync(file);
  const jsonl = path.join(chats, 'session-2026-11-20T11-00-00000002.jsonl');
  fs.copyFileSync(FIXTURE_JSONL, jsonl);
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();

  const sid = 'gemini:00000000-0000-4000-8000-000000000002';
  // msg-2 is written twice (first without tokens): counted once, with the later line's numbers.
  // msg-3 was rewound away, but its tokens were spent, so it stays.
  assert.deepEqual(S.records.map(r => [r.sid, r.mid, r.model, r.in, r.cr, r.out, r.total]), [
    [sid, 'msg-2', 'gemini-2.5-pro', 1500, 500, 320, 2320],
    [sid, 'msg-3', 'gemini-2.5-flash', 1500, 0, 50, 1550],
    [sid, 'msg-4', 'gemini-2.5-flash', 600, 1000, 60, 1660]
  ]);
  assert.equal(S.sessions.get(sid).ctx, 1600);
  assert.deepEqual(S.events.map(e => e.text), ['run_shell_command: <command>']);

  const d = g.diagnostics();
  assert.deepEqual([d.parser.jsonFiles, d.parser.jsonlFiles, d.parser.sessionFiles], [0, 1, 1]);
  assert.equal(d.parser.answers, 3, 'a message written twice is one answer');
  assert.equal(d.parser.withTokens, 3);
  assert.equal(d.parser.otherLines, 2, 'the $set and $rewindTo lines');
  assert.equal(d.parser.badLines, 0);
  assert.deepEqual({ ...d.parser.messageTypes }, { user: 1, gemini: 3 });
  assert.equal(d.answersUpdated, 0);

  // appended lines: a new answer, a later copy of an old one with other tokens, and a line caught mid-write
  fs.appendFileSync(jsonl, [
    '{"id":"msg-5","timestamp":"2026-11-20T11:03:00.000Z","type":"gemini","model":"gemini-2.5-pro","tokens":{"input":100,"output":10,"cached":0,"total":110}}',
    '{"id":"msg-4","timestamp":"2026-11-20T11:02:00.000Z","type":"gemini","model":"gemini-2.5-flash","tokens":{"input":1600,"output":90,"cached":1000,"total":1690}}',
    '{"id":"msg-6","timestamp":"2026-11-20T11:04:00.000Z","type":"gem'
  ].join('\n'));
  await g.scan(true);
  assert.equal(S.records.length, 4);
  assert.equal(S.records.find(r => r.mid === 'msg-4').out, 90);
  assert.equal(S.events.length, 1, 'tool calls are not repeated');
  assert.equal(g.diagnostics().parser.badLines, 1);
  assert.equal(g.diagnostics().answersUpdated, 1);
});

test('gemini: a .jsonl file with nothing recognisable is skipped and counted', async () => {
  assert.deepEqual(linesOf('not json\n{"id":'), { bad: 'json' });
  assert.deepEqual(linesOf('{"turns":[]}\n[1,2]\n'), { bad: 'shape' });
  assert.deepEqual(linesOf(''), { bad: 'json' });
  const one = linesOf('{"id":"a","type":"gemini"}\r\n\r\n{"sessionId":"s"}\r\n');
  assert.deepEqual([one.sessionId, one.messages.length, one.badLines, one.otherLines], ['s', 1, 0, 0]);

  const { dir, chats } = home();
  fs.writeFileSync(path.join(chats, 'session-2026-11-20T13-00-33333333.jsonl'), '{"turns":[]}\n');
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  assert.equal(S.records.length, 2);
  const d = g.diagnostics();
  assert.deepEqual([d.filesTracked, d.parser.jsonFiles, d.parser.jsonlFiles, d.parser.sessionFiles, d.parser.notSession], [2, 1, 1, 1, 1]);
});

test('gemini: two answers of one session at the same millisecond are kept apart', async () => {
  const { dir, file } = home();
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const twin = { id: 'msg-4b', timestamp: '2026-11-20T10:02:00.000Z', type: 'gemini', content: '<answer>', model: 'gemini-2.5-pro', tokens: { input: 700, output: 7, cached: 0, total: 707 } };
  j.messages.splice(4, 0, twin);
  fs.writeFileSync(file, JSON.stringify(j));
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  assert.equal(S.records.length, 3);
  const numbers = () => S.records.filter(r => r.ts === Date.parse(twin.timestamp)).map(r => [r.mid, r.model, r.in, r.out]);
  assert.deepEqual(numbers(), [['msg-4', 'gemini-2.5-flash', 3000, 100], ['msg-4b', 'gemini-2.5-pro', 700, 7]]);

  // a rewrite that changes nothing in them leaves both alone
  const before = S.changes;
  j.lastUpdated = '2026-11-20T10:05:00.000Z';
  fs.writeFileSync(file, JSON.stringify(j, null, 1));
  await g.scan(true);
  assert.equal(g.filesRead, 2);
  assert.deepEqual(numbers(), [['msg-4', 'gemini-2.5-flash', 3000, 100], ['msg-4b', 'gemini-2.5-pro', 700, 7]]);
  assert.equal(S.changes, before);
  assert.equal(g.diagnostics().answersUpdated, 0);

  // and each one is updated on its own, also from the cache after a restart
  twin.tokens = { input: 800, output: 8, cached: 0, total: 808 };
  fs.writeFileSync(file, JSON.stringify(j));
  const again = new GeminiSource(S, { home: dir });
  await again.init();
  assert.deepEqual(numbers(), [['msg-4', 'gemini-2.5-flash', 3000, 100], ['msg-4b', 'gemini-2.5-pro', 800, 8]]);
  assert.equal(again.diagnostics().answersUpdated, 1);
});

test('gemini: odd message types do not reach the diagnostics as written', async () => {
  const { dir, file } = home();
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  j.messages.push({ id: 'x1', timestamp: '2026-11-20T10:04:00.000Z', type: 'C:\\Users\\someone secret', content: '' });
  j.messages.push({ id: 'x2', timestamp: '2026-11-20T10:04:01.000Z', type: 'x'.repeat(41), content: '' });
  j.messages.push({ id: 'x3', timestamp: '2026-11-20T10:04:02.000Z', type: 'tool_group', content: '' });
  j.messages.push({ id: 'x4', timestamp: '2026-11-20T10:04:03.000Z', type: 7, content: '' });
  fs.writeFileSync(file, JSON.stringify(j));
  const g = new GeminiSource(store(), { home: dir });
  await g.init();
  assert.deepEqual({ ...g.diagnostics().parser.messageTypes }, { user: 1, gemini: 3, info: 1, '?': 3, tool_group: 1 });
});

test('tray tooltip: a tool without limits shows its note, not "loading…"', () => {
  const { tooltipText } = require('../src/shared/mini');
  const gemini = { id: 'gemini', label: 'gemini', plan: null, note: 'usage only', error: null };
  assert.equal(tooltipText({ providers: [gemini], limits: [] }), 'TokenMuncher\ngemini: usage only');
  const claude = { id: 'claude', label: 'claude', plan: 'max', note: null, error: null };
  assert.equal(tooltipText({ providers: [claude, gemini], limits: [] }), 'TokenMuncher\ngemini: usage only');
  assert.equal(tooltipText({ providers: [claude], limits: [] }), 'TokenMuncher\nloading…');
  assert.equal(tooltipText({ providers: [{ ...gemini, error: 'x' }], limits: [] }), 'TokenMuncher\ngemini: x');
});

test('gemini: "usage only" reaches the snapshot and the diagnostics report', async () => {
  const { Aggregator } = require('../src/main/aggregate');
  const { buildReport } = require('../src/main/diagnostics');
  const { dir } = home();
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  const snap = new Aggregator(S, [g]).snapshot(true);
  const p = snap.providers.find(x => x.id === 'gemini');
  assert.equal(p.note, 'usage only');
  assert.equal(p.plan, null);
  const text = buildReport({
    app: { version: '0.0.0', electron: '0', os: 'test', arch: 'x64', packaged: false },
    settings: { sources: { gemini: true }, thresholds: [] },
    sources: [{ id: 'gemini', detected: true, off: false, status: g.status(), limits: [], diagnostics: null }],
    counts: {}, update: null, home: dir, user: 'nobody'
  });
  assert.match(text, /- plan: usage only;/);
});

test('gemini: the project name comes from .project_root, then a readable folder name', async () => {
  const S = store();
  const one = home(HASH, { '.project_root': '/work/demo-project\n' });
  await new GeminiSource(S, { home: one.dir }).init();
  assert.equal(S.records[0].project, 'demo-project');
  assert.equal(S.events[1].text, 'read_file src/a.js', 'paths inside the project are shown relative to it');

  const S2 = store();
  const two = home('my-app');
  await new GeminiSource(S2, { home: two.dir }).init();
  assert.equal(S2.records[0].project, 'my-app');
});

test('gemini: broken, foreign and unrelated files are skipped', async () => {
  const { dir, chats } = home();
  fs.writeFileSync(path.join(chats, 'session-2026-11-20T11-00-11111111.json'), '{"sessionId":"x","messages":[{"id":'); // caught mid-write
  fs.writeFileSync(path.join(chats, 'session-2026-11-20T12-00-22222222.json'), '{"sessionId":"y","turns":[]}');
  fs.writeFileSync(path.join(chats, 'notes.json'), '{"messages":[]}');
  fs.writeFileSync(path.join(dir, 'tmp', HASH, 'logs.json'), '[]');
  fs.writeFileSync(path.join(dir, 'oauth_creds.json'), '{}');
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  assert.equal(S.records.length, 2);
  const d = g.diagnostics();
  assert.equal(d.filesTracked, 3, 'only chats/session-*.json and .jsonl');
  assert.equal(d.parser.badJson, 1);
  assert.equal(d.parser.notSession, 1);
  assert.equal(d.parser.sessionFiles, 1);
});

test('gemini: messages before the store cutoff add nothing', async () => {
  const { dir } = home();
  const S = new Store();
  S.cutoff = Date.parse('2026-11-20T10:01:00.000Z');
  await new GeminiSource(S, { home: dir }).init();
  assert.deepEqual(S.records.map(r => r.model), ['gemini-2.5-flash']);
  assert.deepEqual(S.events.map(e => e.text), ['read_file …/src/a.js']);
});

test('gemini: the usage cache skips files unchanged since the last run', async () => {
  const { dir } = home();
  const S = store();
  const g = new GeminiSource(S, { home: dir });
  await g.init();
  const saved = JSON.parse(JSON.stringify(g.exportState()));
  assert.equal(saved.files.length, 1);

  const again = new GeminiSource(S, { home: dir });
  again.importState(saved);
  again.importState(saved); // twice is fine
  await again.init();
  assert.equal(again.filesRead, 0);
  assert.equal(again.diagnostics().parser.withTokens, 2, 'diagnostics survive the cache');
  again.importState({ files: 'junk' });
  assert.equal(again.files.size, 0);
});

test('gemini prices: known models, fallbacks by name', () => {
  const u = { in: 1e6, cr: 0, out: 0 };
  assert.equal(costGemini('gemini-2.5-pro', u), 1.25);
  assert.equal(costGemini('gemini-2.5-flash', u), 0.3);
  assert.equal(costGemini('gemini-2.5-flash-lite', u), 0.1);
  assert.equal(costGemini('gemini-9-flash-lite-preview', u), 0.1);
  assert.equal(costGemini('gemini-9-flash', u), 0.3);
  assert.equal(costGemini('gemini', u), 1.25);
  assert.equal(costGemini(undefined, { in: 0, cr: 1e6, out: 1e6 }), 10.125);
});
