// Demo data (TM_DEMO=1): made-up projects, sessions, tokens and limits for
// Claude Code, Cursor and Copilot, so screenshots and demos never show
// anyone's real projects, commands or costs. Nothing here touches the network
// or the real tools' files. Deterministic: the same seed gives the same data.
const { costOf, family } = require('../pricing');

const MIN = 60e3, HOUR = 3600e3, DAY = 86400e3;

// Small seeded PRNG (mulberry32).
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PROJECTS = [['web-shop', 5], ['api-gateway', 4], ['mobile-app', 3], ['data-pipeline', 2], ['docs-site', 1]];
const MODELS = [['claude-opus-5-5', 7], ['claude-sonnet-5-5', 2], ['claude-fable-5-1', 1]];
const ACTIONS = [
  'Edit src/cart/checkout.ts', 'Read src/api/routes.ts', 'Bash: npm test', 'Grep "useSession"', 'Write tests/cart.test.ts',
  'Edit src/components/Header.tsx', 'Bash: git status', 'Read package.json', 'Edit src/db/migrations/012_orders.sql',
  'Bash: npm run lint', 'Read docs/architecture.md', 'Edit src/auth/token.ts', 'Bash: docker compose up -d'
];
const pick = (r, list) => { const total = list.reduce((s, x) => s + x[1], 0); let v = r() * total; for (const [x, w] of list) if ((v -= w) < 0) return x; return list[0][0]; };

// Adds one Claude response (and sometimes a tool action) to the store.
function claudeResponse(S, r, sid, ts, project, model, ctx) {
  const tk = { in: 20 + Math.floor(r() * 300), out: 300 + Math.floor(r() * 2500), cr: ctx, cw5: 1000 + Math.floor(r() * 8000), cw1: 0 };
  const total = tk.in + tk.out + tk.cr + tk.cw5;
  const s = S.session(sid, { provider: 'claude', project, app: 'Claude Code', model });
  if (ts >= s.lastTs) { s.lastTs = ts; s.ctx = tk.in + tk.cr + tk.cw5; s.ctxMax = 1e6; s.ctxTs = ts; s.model = model; }
  S.addRecord(`demo:${sid}:${ts}`, { ts, provider: 'claude', sid, project, app: 'Claude Code', model, fam: family(model), in: tk.in, out: tk.out, cr: tk.cr, cw: tk.cw5, cw1: 0, total, cost: costOf(model, tk) });
  if (r() < 0.6) {
    const text = ACTIONS[Math.floor(r() * ACTIONS.length)];
    S.addEvent(`demo:e:${sid}:${ts}`, { ts, provider: 'claude', project, text, tok: total, cr: tk.cr, kind: 'tool' }, sid);
    if (ts >= s.lastTs - 1) s.lastAction = text;
  }
}

// One Claude session: a response every ~30–90 s, the context growing as it goes.
function claudeSession(S, r, { sid, project, model, start, end }) {
  let ctx = 20e3 + Math.floor(r() * 30e3);
  for (let ts = start; ts < end; ts += 30e3 + Math.floor(r() * 60e3)) {
    claudeResponse(S, r, sid, ts, project, model, ctx);
    ctx = Math.min(700e3, ctx + 2e3 + Math.floor(r() * 6e3));
  }
  return ctx;
}

// Fills the store with 12 days of history and two sessions running now.
// Returns the live sessions, which keep going in DemoSource.tick().
function seed(S, now) {
  const r = rng(42);
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  let n = 0;
  for (let d = 12; d >= 0; d--) {
    const day = today.getTime() - d * DAY;
    const weekend = [0, 6].includes(new Date(day).getDay());
    const count = weekend ? Math.floor(r() * 2) : 2 + Math.floor(r() * 3);
    for (let i = 0; i < count; i++) {
      const start = day + (9 + Math.floor(r() * 10)) * HOUR + Math.floor(r() * 60) * MIN;
      const end = Math.min(start + (30 + Math.floor(r() * 120)) * MIN, now - 3 * HOUR);
      if (end <= start) continue;
      claudeSession(S, r, { sid: `claude:demo-${n++}`, project: pick(r, PROJECTS), model: pick(r, MODELS), start, end });
    }
    // Cursor: a handful of requests on weekdays
    if (!weekend) {
      for (let i = 0; i < 6; i++) {
        const ts = day + (10 + Math.floor(r() * 8)) * HOUR + Math.floor(r() * 3600) * 1000;
        if (ts > now) continue;
        const t = { in: 2000 + Math.floor(r() * 8000), out: 500 + Math.floor(r() * 3000), cr: 20e3 + Math.floor(r() * 60e3), cw: 0 };
        const total = t.in + t.out + t.cr;
        const project = pick(r, PROJECTS);
        const cs = S.session('cursor:demo', { provider: 'cursor', project, app: 'Cursor', model: 'auto' });
        cs.lastTs = Math.max(cs.lastTs, ts);
        S.addRecord(`demo:cursor:${ts}`, { ts, provider: 'cursor', sid: 'cursor:demo', project, app: 'Cursor', model: 'auto', fam: 'cursor', bucket: 'auto', ...t, total, cost: 0.02 + r() * 0.08 });
      }
    }
  }
  // Two sessions running now, started 2–3 h ago.
  const live = [
    { sid: 'claude:demo-live-1', project: 'web-shop', model: 'claude-opus-5-5', start: now - 160 * MIN },
    { sid: 'claude:demo-live-2', project: 'api-gateway', model: 'claude-sonnet-5-5', start: now - 95 * MIN }
  ];
  for (const s of live) {
    s.ctx = claudeSession(S, r, { ...s, end: now - 5e3 });
    claudeResponse(S, r, s.sid, now - 2e3, s.project, s.model, s.ctx); // both answered just now
  }
  return { live, r };
}

const nextMonday9 = now => { const d = new Date(now); d.setHours(9, 0, 0, 0); d.setDate(d.getDate() + ((8 - d.getDay()) % 7 || 7)); return d.getTime(); };
const firstOfNextMonthUTC = now => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };

class DemoSource {
  constructor(id, { plan, limits, breakdown = [], tick = null, fetchedAt }) {
    this.id = id;
    this.plan = plan;
    this.makeLimits = limits;
    this.breakdown = breakdown;
    this.onTick = tick;
    this.fetchedAt = fetchedAt;
  }
  get enabled() { return true; }
  init() { return Promise.resolve(); }
  tick() { if (this.onTick) this.onTick(); return Promise.resolve(); }
  start() {}
  refresh() {}
  // "synced 45 s ago", as if it had just polled
  status() { return { id: this.id, label: this.id, plan: this.plan, error: null, fetchedAt: Date.now() - 45e3, breakdown: this.breakdown }; }
  limits() { return this.makeLimits(); }
}

// The three demo sources over a store filled with demo data.
function demoSources(S, now = Date.now()) {
  const { live, r } = seed(S, now);
  const fetchedAt = now - 45e3;
  const claude = r2 => r2.provider === 'claude';
  // Reset times roll on like real windows when a demo runs for hours.
  const roll = (t, every) => { const n = Date.now(); while (t <= n) t += every; return t; };
  let sessionReset = now + 2 * HOUR + 12 * MIN, weekReset = nextMonday9(now);
  const cursorEnd = now + 13 * DAY, copilotEnd = firstOfNextMonthUTC(now);
  const copilotStart = (() => { const d = new Date(copilotEnd); d.setUTCMonth(d.getUTCMonth() - 1); return d.getTime(); })();
  return [
    new DemoSource('claude', {
      plan: { name: 'Max 5×', price: 100 }, fetchedAt,
      breakdown: [{ name: 'Claude Code', percent: 82 }, { name: 'Chats', percent: 11 }, { name: 'Cowork', percent: 2 }, { name: 'Other', percent: 5 }],
      limits: () => [
        { key: 'claude:session', provider: 'claude', kind: 'session', name: '5h window', percent: 46, resetsAt: (sessionReset = roll(sessionReset, 5 * HOUR)), windowSec: 5 * 3600, integer: true, fetchedAt, match: claude },
        { key: 'claude:weekly_all', provider: 'claude', kind: 'weekly', name: 'weekly', percent: 38, resetsAt: (weekReset = roll(weekReset, 7 * DAY)), windowSec: 7 * 86400, integer: true, fetchedAt, match: claude },
        { key: 'claude:weekly_scoped:Sonnet', provider: 'claude', kind: 'weekly', name: 'weekly sonnet', percent: 12, resetsAt: weekReset, windowSec: 7 * 86400, integer: true, fetchedAt, match: x => claude(x) && x.fam === 'sonnet' }
      ],
      // the live sessions keep answering: a response every few seconds
      tick: () => {
        const t = Date.now();
        for (const s of live) if (r() < 0.25) { claudeResponse(S, r, s.sid, t, s.project, s.model, s.ctx); s.ctx = Math.min(700e3, s.ctx + 3e3); }
      }
    }),
    new DemoSource('cursor', {
      plan: { name: 'Pro', price: 20 }, fetchedAt,
      limits: () => [
        { key: 'cursor:auto', provider: 'cursor', kind: 'monthly', name: 'auto + composer', percent: 34, resetsAt: cursorEnd, windowSec: 30 * 86400, integer: false, fetchedAt, match: x => x.provider === 'cursor' && x.bucket === 'auto' },
        { key: 'cursor:api', provider: 'cursor', kind: 'monthly', name: 'api models', percent: 6, resetsAt: cursorEnd, windowSec: 30 * 86400, integer: false, fetchedAt, match: x => x.provider === 'cursor' && x.bucket === 'api' }
      ]
    }),
    new DemoSource('copilot', {
      plan: { name: 'Pro', price: 10 }, fetchedAt,
      limits: () => [
        { key: 'copilot:premium_interactions', provider: 'copilot', kind: 'monthly', name: 'premium requests', percent: 22, resetsAt: copilotEnd, windowSec: (copilotEnd - copilotStart) / 1000, integer: false, fetchedAt, match: null },
        { key: 'copilot:chat', provider: 'copilot', kind: 'monthly', name: 'chat messages', percent: 9, resetsAt: copilotEnd, windowSec: (copilotEnd - copilotStart) / 1000, integer: false, fetchedAt, match: null }
      ]
    })
  ];
}

// Recorded readings the history view shows as "measured": monthly cycles for
// Cursor and Copilot (the previous one complete, the current one so far) and
// the last weekly Claude windows. Goes into an in-memory LimitHistory.
function seedHistory(history, sources, now = Date.now()) {
  const r = rng(7);
  for (const l of sources.flatMap(s => s.limits())) {
    if (l.kind === 'monthly') {
      const end = l.resetsAt, start = end - l.windowSec * 1000;
      const prevEnd = start, prevStart = start - l.windowSec * 1000;
      const prevTop = l.percent * 2 + 20 * r();
      for (let t = prevStart + 8 * HOUR, p = 0; t < prevEnd; t += DAY) { p = Math.min(prevTop, p + (prevTop / 30) * (0.4 + 1.2 * r())); history.add([t, l.key, Math.round(p * 100) / 100, null, prevEnd, 'monthly']); }
      const days = Math.max(1, Math.floor((now - start) / DAY));
      for (let i = 0, t = start + 8 * HOUR; t < now; t += DAY, i++) history.add([t, l.key, Math.round(l.percent * Math.min(1, (i + 1) / days) * 100) / 100, null, end, 'monthly']);
    } else if (l.kind === 'weekly') {
      for (let w = 1; w <= 3; w++) {
        const end = l.resetsAt - w * 7 * DAY, top = l.percent * (1.1 + r() * 0.8);
        for (let t = end - 7 * DAY + 10 * HOUR, p = 0; t < end; t += DAY) { p = Math.min(top, p + top / 7 * (0.5 + r())); history.add([t, l.key, Math.round(p), null, end, 'weekly']); }
      }
    }
  }
  for (const list of history.byKey.values()) list.sort((a, b) => a.t - b.t);
}

// Made-up summaries of the last four finished weeks, for the history view.
function seedWeeks(weeks, limits, now = Date.now()) {
  const { lastWeek, WEEK } = require('../week-summary');
  const { displayName } = require('../pricing');
  const r = rng(11);
  const last = lastWeek(limits, now);
  for (let i = 3; i >= 0; i--) {
    const end = last.end - i * WEEK, start = end - WEEK;
    const tokens = Math.round((300 + r() * 250) * 1e6), cr = Math.round(tokens * 0.85), cost = 180 + r() * 220;
    const split = (list, named) => {
      const total = list.reduce((s, x) => s + x[1], 0);
      return list.map(([name, w]) => ({ ...named(name), tokens: Math.round(tokens * w / total), cr: Math.round(cr * w / total), cost: cost * w / total }));
    };
    const day = new Date(start + (1 + Math.floor(r() * 5)) * DAY); day.setHours(0, 0, 0, 0);
    weeks.add({
      start, end, by: 'limit', tokens, cr, cost, sessions: 25 + Math.floor(r() * 30), activeDays: 5 + Math.floor(r() * 3),
      busiest: { start: day.getTime(), tokens: Math.round(tokens * 0.24), cr: Math.round(cr * 0.24), cost: cost * 0.24 },
      projects: split(PROJECTS, name => ({ name })), models: split(MODELS, id => ({ name: displayName(id), fam: family(id) })),
      providers: {}, partial: false, limit: { name: 'claude weekly', pct: 35 + r() * 50, measured: true }
    });
  }
}

module.exports = { demoSources, seedHistory, seedWeeks, rng, PROJECTS };
