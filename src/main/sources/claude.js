// Claude Code: local transcripts (~/.claude/projects/**/*.jsonl) for tokens,
// plus the plan-usage endpoint behind Claude Code's /usage screen for limits.
// That endpoint is unofficial. The OAuth token is only read from Claude Code's
// credentials file; this app never writes it or refreshes the token.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { JsonlTail } = require('../jsonl');
const { costOf, family } = require('../pricing');
const { projectOf, relPath, getJson } = require('./common');
const { parseRetryAfter, nextDelay, firstDelay, reviveCached, rollWindow, BASE_MS } = require('./claude-poll');
const { hhmm } = require('../../shared/clock');

const ROOT = path.join(os.homedir(), '.claude', 'projects');
const CRED_FILE = path.join(os.homedir(), '.claude', '.credentials.json');
const ACCOUNT_FILE = path.join(os.homedir(), '.claude.json'); // has oauthAccount.accountUuid
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';
const APPS = { cli: 'Claude Code', 'claude-vscode': 'Code · VS Code', 'claude-desktop': 'Code · desktop', 'sdk-ts': 'Agent SDK', 'sdk-py': 'Agent SDK' };

function describeTool(c, cwd) {
  const i = c.input || {};
  const name = c.name || 'tool';
  switch (name) {
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return `${name} ${relPath(i.file_path || i.notebook_path, cwd)}`;
    case 'Bash': case 'PowerShell': return `${name}: ${String(i.command || '').split('\n')[0].slice(0, 100)}`;
    case 'Grep': case 'Glob': return `${name} "${i.pattern || ''}"`;
    case 'Agent': case 'Task': return `Agent: ${i.description || ''}`;
    case 'WebFetch': return `WebFetch ${i.url || ''}`;
    case 'WebSearch': return `WebSearch "${i.query || ''}"`;
    case 'Skill': return `Skill ${i.skill || ''}`;
    default:
      if (name.startsWith('mcp__')) {
        const parts = name.split('__');
        return `${parts.slice(2).join('__')} (${parts[1].replace(/^claude_ai_/, '')})`;
      }
      return name;
  }
}

function planOf(c) {
  const tier = c.rateLimitTier || '';
  const m = /max_(\d+)x/.exec(tier);
  if (m) return { name: `Max ${m[1]}×`, price: m[1] === '20' ? 200 : 100 };
  if (/pro/.test(tier) || c.subscriptionType === 'pro') return { name: 'Pro', price: 20 };
  if (c.subscriptionType === 'max') return { name: 'Max', price: 100 };
  return { name: c.subscriptionType || '?', price: 0 };
}

function parseLimits(j) {
  const out = [];
  const precise = { session: j.five_hour && j.five_hour.utilization, weekly_all: j.seven_day && j.seven_day.utilization };
  if (Array.isArray(j.limits) && j.limits.length) {
    for (const l of j.limits) {
      if (l.percent == null) continue;
      const scope = l.scope && l.scope.model && l.scope.model.display_name;
      const windowSec = l.group === 'session' || /session/.test(l.kind) ? 5 * 3600 : 7 * 86400;
      const name = l.kind === 'session' ? '5h window' : l.kind === 'weekly_all' ? 'weekly'
        : scope ? 'weekly ' + scope.toLowerCase() : l.kind.replace(/_/g, ' ');
      out.push({
        key: 'claude:' + l.kind + (scope ? ':' + scope : ''), kind: l.kind === 'session' ? 'session' : 'weekly', name,
        percent: +(precise[l.kind] != null ? precise[l.kind] : l.percent),
        resetsAt: l.resets_at ? Date.parse(l.resets_at) : null, windowSec, family: scope ? scope.toLowerCase() : null
      });
    }
  } else {
    for (const [k, kind, name, windowSec, fam] of [
      ['five_hour', 'session', '5h window', 5 * 3600, null],
      ['seven_day', 'weekly', 'weekly', 7 * 86400, null],
      ['seven_day_opus', 'weekly', 'weekly opus', 7 * 86400, 'opus'],
      ['seven_day_sonnet', 'weekly', 'weekly sonnet', 7 * 86400, 'sonnet']
    ]) {
      const v = j[k];
      if (!v || v.utilization == null) continue;
      out.push({ key: 'claude:' + k, kind, name, percent: +v.utilization, resetsAt: v.resets_at ? Date.parse(v.resets_at) : null, windowSec, family: fam });
    }
  }
  const rows = (j.seven_day_breakdown && j.seven_day_breakdown.rows) || [];
  return { limits: out, breakdown: rows.map(r => ({ name: r.display_name, percent: r.percent })) };
}

// Logged-in Claude account id, or null when nobody is logged in.
function accountId() {
  try {
    const cred = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')).claudeAiOauth;
    if (!cred || !cred.accessToken) return null;
  } catch { return null; }
  try {
    const a = JSON.parse(fs.readFileSync(ACCOUNT_FILE, 'utf8')).oauthAccount;
    return (a && a.accountUuid) || 'unknown';
  } catch { return 'unknown'; }
}

class ClaudeSource {
  // opts.cacheFile: where the last good limits and the backoff state are kept,
  //   so a restart (or a rate-limited poll) still shows the last known values.
  // opts.estimate(key): current local estimate of a limit's percent, if any.
  // opts.rate(key): current percent-per-dollar of a limit, saved so a window that
  //   rolls over after a restart can still be estimated.
  constructor(store, opts = {}) {
    this.id = 'claude';
    this.store = store;
    this.tail = new JsonlTail([ROOT], line => this.onLine(line), () => store.cutoff);
    this.cacheFile = opts.cacheFile || null;
    this.estimate = opts.estimate || (() => null);
    this.rate = opts.rate || (() => null);
    this.rates = {};               // limit key -> percent per dollar, from the cache
    this.st = { plan: null, error: null, fetchedAt: 0, limits: [], breakdown: [], polled: false };
    this.delay = BASE_MS;
    this.retryUntil = 0;
    this.timer = null;
    this.polling = false;
    this.lastActivity = 0;         // newest Claude Code response seen
    this.windowStarts = new Map(); // memo for firstActivityAfter
    this.account = accountId();
    this.loadCache();
  }

  loadCache() {
    if (!this.cacheFile) return;
    try {
      const c = reviveCached(JSON.parse(fs.readFileSync(this.cacheFile, 'utf8')), this.account);
      if (!c) return;
      const { retryUntil, delay, rates, ...data } = c;
      Object.assign(this.st, data);
      this.rates = rates;
      this.retryUntil = retryUntil;
      this.delay = delay;
    } catch { /* no cache yet */ }
  }

  saveCache() {
    if (!this.cacheFile || !this.account) return;
    const { plan, breakdown, fetchedAt, limits } = this.st;
    for (const l of limits) { const k = this.rate(l.key); if (k) this.rates[l.key] = k; }
    const data = { account: this.account, plan, breakdown, fetchedAt, limits, rates: this.rates, retryUntil: this.retryUntil, delay: this.delay };
    try { fs.writeFileSync(this.cacheFile, JSON.stringify(data)); } catch { /* ignore */ }
  }

  // Claude Code wrote a response in the last two minutes.
  burning(now) { return now - this.lastActivity < 120e3; }

  // Timestamp of the first Claude Code response after t (records are kept sorted).
  firstActivityAfter(t) {
    if (this.windowStarts.has(t)) return this.windowStarts.get(t);
    if (this.lastActivity <= t) return null; // none yet; not memoized, it may still come
    const recs = this.store.records;
    let lo = 0, hi = recs.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (recs[mid].ts <= t) lo = mid + 1; else hi = mid; }
    for (let k = lo; k < recs.length; k++) {
      if (recs[k].provider === 'claude') { this.windowStarts.set(t, recs[k].ts); return recs[k].ts; }
    }
    return null;
  }

  get enabled() { return fs.existsSync(ROOT) || fs.existsSync(CRED_FILE); }
  diagnostics() {
    return { logFolder: { path: ROOT, exists: fs.existsSync(ROOT) }, loggedIn: fs.existsSync(CRED_FILE), filesTracked: this.tail.files.size, linesRead: this.tail.linesRead, retryUntil: this.retryUntil || null, pollDelayMs: this.delay || null };
  }

  // ── on-disk usage cache (read positions; records live in the store) ──
  get changes() { return this.tail.changes; }
  exportState() { return { tail: this.tail.exportState() }; }
  importState(s) {
    this.tail.importState(s.tail);
    for (const r of this.store.records) if (r.provider === 'claude' && r.ts > this.lastActivity) this.lastActivity = r.ts;
  }
  init() { return this.tail.scan(true); }
  tick() { return this.tail.scan(false); }

  onLine(line) {
    const isCompact = line.includes('compact_boundary');
    if (!isCompact && !line.includes('"usage"')) return;
    let d;
    try { d = JSON.parse(line); } catch { return; }
    const ts = Date.parse(d.timestamp);
    const S = this.store;
    if (!ts || ts < S.cutoff) return;
    const cwd = d.cwd || '';
    const project = projectOf(cwd);
    const sid = 'claude:' + (d.sessionId || 'unknown');

    if (isCompact && d.type === 'system' && d.subtype === 'compact_boundary') {
      const meta = d.compactMetadata || {};
      S.addEvent(d.uuid, { ts, provider: 'claude', project, kind: 'note', tok: meta.preTokens ? Math.round(meta.preTokens / 1e3) + 'k→' : '',
        text: meta.trigger === 'manual' ? 'Context compacted (/compact)' : 'Context auto-compacted' });
      const s = S.sessions.get(sid);
      if (s) s.ctx = 0;
      return;
    }

    const m = d.message;
    if (d.type !== 'assistant' || !m || !m.usage || !m.model || m.model === '<synthetic>') return;
    const u = m.usage;
    const cw = u.cache_creation_input_tokens || 0;
    const cw1 = (u.cache_creation && u.cache_creation.ephemeral_1h_input_tokens) || 0;
    const tk = { in: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw5: Math.max(0, cw - cw1), cw1 };
    const total = tk.in + tk.out + tk.cr + cw;

    const s = S.session(sid, { provider: 'claude', project, app: APPS[d.entrypoint] || 'Claude Code', model: m.model });
    if (!d.isSidechain && ts >= s.ctxTs) {
      s.ctxTs = ts;
      s.ctx = tk.in + tk.cr + cw;
      s.ctxMax = /haiku-4|claude-3/.test(m.model) ? 200e3 : 1e6;
      s.model = m.model;
      s.project = project;
    }
    if (ts > s.lastTs) s.lastTs = ts;
    if (ts > this.lastActivity) this.lastActivity = ts;

    S.addRecord('claude:' + (m.id || d.uuid) + ':' + (d.requestId || ''), {
      ts, provider: 'claude', sid, project, app: s.app, model: m.model, fam: family(m.model),
      in: tk.in, out: tk.out, cr: tk.cr, cw, cw1, total, cost: costOf(m.model, tk)
    });

    if (Array.isArray(m.content)) {
      for (const c of m.content) {
        if (c.type !== 'tool_use' || !c.id) continue;
        const text = describeTool(c, cwd);
        S.addEvent(c.id, { ts, provider: 'claude', project, text, tok: total, cr: tk.cr, kind: 'tool' }, sid);
        if (ts >= s.lastTs - 1) s.lastAction = text;
      }
    }
  }

  // ── limits ──
  // Returns the HTTP status of the poll (0 = no request or network error).
  async fetchLimits() {
    let cred;
    try {
      cred = JSON.parse(fs.readFileSync(CRED_FILE, 'utf8')).claudeAiOauth;
      if (!cred || !cred.accessToken) throw new Error();
    } catch {
      this.st.error = 'not logged in to Claude Code';
      this.st.limits = [];
      return 0;
    }
    const account = accountId();
    if (account !== this.account) { // switched account: the old limits don't apply
      this.account = account;
      Object.assign(this.st, { limits: [], breakdown: [], fetchedAt: 0 });
    }
    this.st.plan = planOf(cred);
    if (cred.expiresAt && cred.expiresAt < Date.now()) { this.st.error = 'login expired · open Claude Code'; return 0; }
    const r = await getJson(ENDPOINT, { headers: { Authorization: 'Bearer ' + cred.accessToken, 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'tokenmuncher/0.4' } });
    this.retryAfterMs = r.status === 429 ? parseRetryAfter(r.retryAfter, Date.now()) : null;
    if (r.status === 429) { this.st.error = 'rate limited'; return 429; }
    if (r.status === 401 || r.status === 403) { this.st.error = 'login rejected · open Claude Code'; return r.status; }
    if (r.status !== 200 || !r.json) { this.st.error = r.error ? 'offline · ' + r.error : 'HTTP ' + r.status; return r.status === 200 ? 0 : r.status; }
    Object.assign(this.st, parseLimits(r.json), { fetchedAt: Date.now(), error: null });
    return 200;
  }

  // One poll, then schedule the next. Never runs twice at once.
  async poll() {
    if (this.polling) return;
    this.polling = true;
    clearTimeout(this.timer);
    let status = 0;
    try {
      status = await this.fetchLimits();
    } catch (e) {
      this.st.error = 'error · ' + e.message;
    } finally {
      const now = Date.now();
      // Speed up on the current estimate, not on the last (possibly old) server value.
      const limits = this.limits().map(l => ({ ...l, percent: Math.max(l.percent, this.estimate(l.key) || 0) }));
      this.delay = nextDelay({ status, retryAfterMs: this.retryAfterMs, prevDelay: this.delay, limits, burning: this.burning(now), now });
      this.retryUntil = status === 429 ? now + this.delay : 0;
      if (status === 429) this.st.error = `rate limited · retry at ${hhmm(this.retryUntil)}`;
      if (status === 200 || status === 429) this.saveCache();
      this.st.polled = true;
      this.polling = false;
      if (!this.off) this.timer = setTimeout(() => this.poll(), this.delay); // switched off meanwhile: main restarts it
      try { this.onUpdate(); } catch (e) { console.error('claude update', e); }
    }
  }

  start(onUpdate) {
    this.onUpdate = onUpdate;
    this.timer = setTimeout(() => this.poll(), firstDelay({ fetchedAt: this.st.fetchedAt, retryUntil: this.retryUntil }, Date.now()));
  }

  // Manual refresh ([r] / tray menu); ignored during a poll or while backing off.
  refresh() {
    if (this.polling || Date.now() < this.retryUntil) return;
    this.poll();
  }

  status() {
    return { id: 'claude', label: 'claude', plan: this.st.plan, error: this.st.error, fetchedAt: this.st.fetchedAt, breakdown: this.st.breakdown };
  }

  // Limits whose window ended since the last fetch roll over to the next window at 0 %.
  limits() {
    const now = Date.now();
    return this.st.limits.map(raw => {
      const l = rollWindow(raw, now, t => this.firstActivityAfter(t));
      return {
        ...l, provider: 'claude', integer: !l.rolled, fetchedAt: this.st.fetchedAt, kHint: this.rates[l.key] || null,
        match: r => r.provider === 'claude' && (!l.family || r.fam === l.family)
      };
    });
  }
}

module.exports = { ClaudeSource };
