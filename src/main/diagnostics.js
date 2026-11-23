// "copy diagnostics": a Markdown report of what the app sees on this machine,
// for pasting into a GitHub issue. Pure (main passes everything in), tested.
//
// Never in it: tokens or logins, conversation text, project names, commands
// or file names from the logs. Paths have the home folder replaced by "~", and
// the Windows user name is replaced wherever it still shows up.

const { duration } = require('../shared/clock');

const ago = (t, now) => (t ? `${duration(now - t)} ago` : 'never');
const inTime = (t, now) => (!t ? 'unknown' : t < now ? `${duration(now - t)} ago (passed)` : `in ${duration(t - now)}`);
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replaces the home folder (any slash style, any case, JSON-escaped) with "~"
// when a separator, quote or the end follows (so "C:\Users\Jan" doesn't eat
// "C:\Users\Janet"), and the user name with "<user>" where it is a whole
// path segment (so an account called "User" doesn't change "user_message").
function scrubber({ home, user }) {
  const pats = [];
  const END = '(?=[\\\\/"\'\\s]|$)';
  if (home) {
    const h = home.replace(/[\\/]+$/, '');
    for (const v of new Set([h, h.replace(/\\/g, '/'), h.replace(/\//g, '\\'), h.replace(/\\/g, '\\\\')])) pats.push([new RegExp(escapeRe(v) + END, 'gi'), '~']);
  }
  if (user && user.length >= 3) pats.push([new RegExp('(?<=[\\\\/])' + escapeRe(user) + END, 'gi'), '<user>']);
  return text => pats.reduce((s, [re, to]) => s.replace(re, to), String(text));
}

// app: { version, electron, os, arch, packaged }
// settings: the settings object; sources: [{ id, detected, off, status, limits, diagnostics }]
// counts: provider -> { records, sessions, lastTs }; update: Updater state or null
function buildReport({ app, settings, sources, counts, update, now = Date.now(), home, user }) {
  const scrub = scrubber({ home, user });
  const L = [];
  L.push('### TokenMuncher diagnostics', '');
  L.push(`- version **${app.version}** (${app.packaged ? 'installed' : 'from source'}), Electron ${app.electron}, ${app.os}, ${app.arch}`);
  L.push(`- generated ${new Date(now).toISOString()}`);
  const on = Object.entries(settings.sources || {}).map(([k, v]) => `${k} ${v ? 'on' : 'off'}`).join(', ');
  L.push(`- settings: sources ${on}; thresholds ${(settings.thresholds || []).join('/') || 'none'}%; notifications ${settings.notifications ? 'on' : 'off'}; 5h warning ${settings.forecastNotify ? 'on' : 'off'}; cache reads ${settings.countCacheReads ? 'counted' : 'not counted'}; update check ${settings.checkUpdates ? 'on' : 'off'}; background download ${settings.downloadUpdates ? 'on' : 'off'}`);
  if (update) L.push(`- updates: ${update.status}${update.latest ? ` (v${update.latest})` : ''}${update.error ? `, error: ${update.error}` : ''}, checked ${ago(update.checkedAt, now)}`);
  for (const s of sources) {
    const st = s.status || {};
    const c = counts[s.id] || { records: 0, sessions: 0, lastTs: 0 };
    L.push('', `#### ${s.id}: ${s.detected ? 'detected' : 'not detected'}${s.off ? ', hidden in settings' : ''}`);
    L.push(`- plan: ${st.plan ? st.plan.name : st.note || 'unknown'}; error: ${st.error || 'none'}; last reading ${ago(st.fetchedAt, now)}`);
    if (s.limits.length) {
      L.push('- limits:');
      for (const l of s.limits) L.push(`  - ${l.key} (${l.kind}): ${+(+l.percent).toFixed(2)}%${l.est != null && Math.abs(l.est - l.percent) > 0.005 ? ` (est ${l.est.toFixed(2)}%)` : ''}, resets ${inTime(l.resetsAt, now)}${l.synthetic ? ', made up locally' : ''}`);
    } else L.push('- limits: none');
    L.push(`- records ${c.records}, sessions ${c.sessions}, last activity ${ago(c.lastTs, now)}`);
    if (s.diagnostics) L.push('', '```json', JSON.stringify(s.diagnostics, null, 2), '```');
  }
  return scrub(L.join('\n')) + '\n';
}

module.exports = { buildReport, scrubber };
