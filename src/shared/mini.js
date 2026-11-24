// What the mini widget shows. Pure functions shared by the renderer, the
// tray and tests. Limits come from the snapshot, which always sets `est`.
const { runoutBeforeReset } = require('./forecast');

const SHORT = {
  '5h window': '5h', weekly: 'wk', 'auto + composer': 'auto', 'api models': 'api',
  'chat messages': 'chat', completions: 'compl.', 'premium requests': 'premium'
};
// Compact limit names: "weekly fable" -> "fable wk"; unknown names pass through.
function shortName(name) {
  if (SHORT[name]) return SHORT[name];
  const m = /^weekly (.+)$/.exec(name);
  return m ? `${m[1]} wk` : name;
}

// The n most-used limits, highest estimate first; ties keep source order.
function pickMiniLimits(limits, n = 4) {
  return (limits || [])
    .map((l, i) => ({ l, i }))
    .sort((a, b) => b.l.est - a.l.est || a.i - b.i)
    .slice(0, n)
    .map(x => x.l);
}

// The single most urgent line for the widget footer:
//   - a limit at 100 %
//   - else the limit that runs out soonest before its reset
//   - else "all fit"
// Returns { kind: 'reached' | 'runout' | 'ok' | 'none', label, at? }.
function pickHeadline(limits, now) {
  const ls = limits || [];
  if (!ls.length) return { kind: 'none' };
  const label = l => `${l.provider} ${shortName(l.name)}`;
  const full = ls.find(l => l.est >= 100);
  if (full) return { kind: 'reached', label: label(full) };
  let best = null;
  for (const l of ls) {
    const left = runoutBeforeReset(l, now);
    if (left != null && (!best || left < best.left)) best = { left, l };
  }
  if (best) return { kind: 'runout', label: label(best.l), at: now + best.left * 1000 };
  return { kind: 'ok' };
}

// The tray tooltip: one line per tool with its error, its limits, or (a tool
// without limits, e.g. Gemini CLI) its note such as "usage only".
function tooltipText(snap) {
  if (!snap) return 'TokenMuncher · loading…';
  const lines = ['TokenMuncher'];
  for (const p of snap.providers) {
    const ls = snap.limits.filter(l => l.provider === p.id);
    if (p.error) lines.push(`${p.id}: ${p.error}`);
    else if (ls.length) lines.push(`${p.id} ` + ls.map(l => `${shortName(l.name)} ${Math.round(l.est)}%`).join(' · '));
    else if (p.note) lines.push(`${p.id}: ${p.note}`);
  }
  if (lines.length === 1) lines.push(snap.providers.length ? 'loading…' : 'no supported tools found');
  const text = lines.join('\n');
  return text.length > 127 ? text.slice(0, 126) + '…' : text; // Windows tooltip limit
}

module.exports = { shortName, pickMiniLimits, pickHeadline, tooltipText };
