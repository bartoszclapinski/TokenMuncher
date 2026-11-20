const { startOfWeek, startOfMonth } = require('./store');

function dateLabel(time) {
  const date = new Date(time);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map(part => String(part).padStart(2, '0')).join('-');
}

function usageRows(records, range, now, hidden = new Set()) {
  const since = range === 'week' ? startOfWeek(now) : range === 'month' ? startOfMonth(now) : -Infinity;
  const groups = new Map();
  for (const record of records) {
    if (record.ts < since || record.ts > now || hidden.has(record.provider)) continue;
    const day = dateLabel(record.ts);
    const project = record.project || '';
    const tool = record.provider || '';
    const model = record.model || '';
    const key = JSON.stringify([day, project, tool, model]);
    let group = groups.get(key);
    if (!group) {
      group = { row: { day, project, tool, model, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, api_equivalent_cost_usd: 0 }, sessions: new Set() };
      groups.set(key, group);
    }
    const { row, sessions } = group;
    row.input_tokens += record.in || 0;
    row.output_tokens += record.out || 0;
    row.cache_read_tokens += record.cr || 0;
    row.cache_write_tokens += record.cw || 0;
    row.api_equivalent_cost_usd += record.cost || 0;
    if (record.sid) sessions.add(record.sid);
  }
  return [...groups.values()]
    .map(({ row, sessions }) => ({
      ...row, api_equivalent_cost_usd: Number(row.api_equivalent_cost_usd.toFixed(6)), sessions: sessions.size
    }))
    .sort((a, b) => a.day.localeCompare(b.day) || a.project.localeCompare(b.project) ||
      a.tool.localeCompare(b.tool) || a.model.localeCompare(b.model));
}

const COLUMNS = [
  'day', 'project', 'tool', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens',
  'cache_write_tokens', 'api_equivalent_cost_usd', 'sessions'
];

function csvCell(value) {
  if (typeof value === 'number') return String(value);
  // Spreadsheet apps can treat a leading operator in a text cell as a formula.
  const text = /^[\t\r\n]|^\s*[=+@-]/.test(value) ? "'" + value : value;
  return '"' + text.replace(/"/g, '""') + '"';
}

function formatUsage(rows, format) {
  if (format === 'json') return JSON.stringify(rows, null, 2) + '\n';
  return [COLUMNS.join(','), ...rows.map(row => COLUMNS.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
}

module.exports = { usageRows, formatUsage };
