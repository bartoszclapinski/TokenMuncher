const assert = require('node:assert/strict');
const test = require('node:test');
const { usageRows, formatUsage } = require('../src/main/usage-export');

const now = new Date(2026, 10, 18, 12).getTime();
const at = (day, month = 10, hour = 10) => new Date(2026, month, day, hour).getTime();
const record = (ts, fields = {}) => ({
  ts, project: 'App, "web"', provider: 'claude', model: 'model-1', sid: 'session-1',
  in: 10, out: 5, cr: 2, cw: 1, cost: 0.125, ...fields
});

test('sums token types and costs and counts unique sessions per day, project, tool and model', () => {
  const rows = usageRows([
    record(at(16)), record(at(16)), record(at(16), { sid: 'session-2' }),
    record(at(17)), record(at(16), { model: 'model-2' }), record(at(16), { project: 'Docs' }),
    record(at(16), { provider: 'codex' })
  ], 'week', now);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], {
    day: '2026-11-16', project: 'App, "web"', tool: 'claude', model: 'model-1', input_tokens: 30,
    output_tokens: 15, cache_read_tokens: 6, cache_write_tokens: 3,
    api_equivalent_cost_usd: 0.375, sessions: 2
  });
  assert.equal(rows.find(row => row.tool === 'codex').sessions, 1);
  assert.equal(rows.at(-1).day, '2026-11-17');
});

test('omits records from disabled sources before aggregating rows', () => {
  const rows = usageRows([
    record(at(16)), record(at(16), { provider: 'cursor', in: 100 }),
    record(at(17), { provider: 'cursor' }), record(at(16), { provider: 'codex' })
  ], 'all', now, new Set(['cursor']));
  assert.deepEqual(rows.map(row => [row.tool, row.input_tokens]), [['claude', 10], ['codex', 10]]);
});

test('rounds cost to six decimal places after adding all costs for a row', () => {
  const rows = usageRows([
    record(at(16), { cost: 0.1 }), record(at(16), { cost: 0.2 }),
    record(at(17), { cost: 0.0000004 }), record(at(17), { cost: 0.0000004 })
  ], 'week', now);
  assert.deepEqual(rows.map(row => row.api_equivalent_cost_usd), [0.3, 0.000001]);
});

test('uses local week and month boundaries and only includes recorded dates through now', () => {
  const records = [record(at(31, 9)), record(at(1)), record(at(15)), record(at(16)), record(at(18, 10, 13))];
  const days = range => usageRows(records, range, now).map(row => row.day);
  assert.deepEqual(days('week'), ['2026-11-16']);
  assert.deepEqual(days('month'), ['2026-11-01', '2026-11-15', '2026-11-16']);
  assert.deepEqual(days('all'), ['2026-10-31', '2026-11-01', '2026-11-15', '2026-11-16']);
});

test('escapes CSV punctuation, preserves JSON strings, and exports empty ranges', () => {
  const rows = usageRows([record(at(16))], 'week', now);
  assert.match(formatUsage(rows, 'csv'), /\r\n"2026-11-16","App, ""web""","claude","model-1",10,5,2,1,0.125,1\r\n$/);
  assert.deepEqual(JSON.parse(formatUsage(rows, 'json')), rows);
  assert.deepEqual(formatUsage([], 'csv').trim().split('\r\n'), [
    'day,project,tool,model,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,api_equivalent_cost_usd,sessions'
  ]);
  assert.deepEqual(JSON.parse(formatUsage([], 'json')), []);
});
