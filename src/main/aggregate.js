// Builds the UI snapshot from the shared store and every source's limits.
const { startOfDay, startOfWeek, startOfMonth, DAY } = require('./store');
const { displayName, family } = require('./pricing');
const { addCache, cacheSummary, emptyCache } = require('./cache-stats');
const { sessionWindows, windowSeries, fixedWindows, monthlyCycles } = require('./history');
const { hourProfile, habitForecast, MIN_DAYS } = require('../shared/habits');
const { MONTHLY_KEEP_MS } = require('./limit-history');
const HABIT_REFRESH_MS = 30e3; // the forecast walks every hour to the reset: not every second

const HOUR = 3600e3;
const RATE_WINDOW = 60e3;                 // tok/s = average over the last minute
const SPARK_BUCKETS = 34, SPARK_STEP = 5e3, SPARK_SMOOTH = 6;
const VELOCITY_WINDOW = 15 * 60e3;        // limit burn speed = average over 15 minutes
const HISTORY_EVERY_MS = 30e3;
const SESSION_COLS = 60;                  // columns of the session details chart
const famOf = (provider, model) => (provider === 'claude' ? family(model) : provider);
// An event's token count without its cache reads (events keep `cr` since 0.9.2;
// older cached ones and notes like "40k→" pass through).
const eventTokens = withCR => e => (withCR || typeof e.tok !== 'number' || !e.cr ? e : { ...e, tok: e.tok - e.cr });

class Aggregator {
  // opts.history: LimitHistory with recorded readings (optional)
  // opts.countCacheReads: () => bool; false leaves cache reads out of every
  //   token count (tok/s, sessions, daily tokens, top burners). Costs and
  //   limits don't change: they come from cost, not from token counts.
  constructor(store, sources, opts = {}) {
    this.history = opts.history || null;
    this.countCacheReads = opts.countCacheReads || (() => true);
    this.weeks = opts.weeks || (() => []); // finished weeks' summaries, newest first (week-summary.js)
    this.histCache = null;
    this.store = store;
    this.sources = sources;
    this.anchors = new Map(); // limit key -> { fetchedAt, resetsAt, pct, est }
    this.lastK = new Map();   // limit key -> last known percent per dollar
    this.stableK = new Map(); // same, but only from readings of 10 %+ (early-window rates are noisy)
    this.habits = new Map();  // weekly / monthly limit key -> hourProfile (rebuilt with the history)
    this.habitCache = new Map(); // limit key -> { t, est, resetsAt, value }
  }

  snapshot(ready) {
    const now = Date.now();
    const S = this.store;
    S.prepare(now);

    // Sources switched off in settings (src.off) drop out of every view.
    const on = this.sources.filter(s => s.enabled && !s.off);
    const hidden = new Set(this.sources.filter(s => s.off).map(s => s.id));
    const providers = on.map(s => s.status());
    const L = on.flatMap(s => s.limits()).map(l => ({
      ...l, t0: l.resetsAt ? l.resetsAt - l.windowSec * 1000 : null, costNow: 0, costAtFetch: 0, costRecent: 0, costToday: 0
    }));
    // Each provider's headline limit, used for the per-session "share" column.
    const primary = {};
    for (const l of L) if (l.match && l.t0 && (!primary[l.provider] || l.kind === 'session')) primary[l.provider] = l;

    const dayStart = startOfDay(now), monthStart = startOfMonth(now), weekStart = startOfWeek(now);
    const sparkStart = now - (SPARK_BUCKETS + SPARK_SMOOTH - 1) * SPARK_STEP;
    const raw = new Array(SPARK_BUCKETS + SPARK_SMOOTH - 1).fill(0);
    const rateBySid = new Map(), sessCost = new Map(), sessTokens = new Map();
    const types = { in: 0, out: 0, cr: 0, cw: 0 };
    const modelsToday = new Map();
    const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const hist = Array.from({ length: 7 }, (_, i) => ({ start: dayStart - (6 - i) * DAY, fam: {} }));
    const topWeek = new Map();
    const api = { today: 0, month: 0, byProvider: {} };
    let rateTotal = 0;
    const win5 = now - 5 * HOUR, week = now - 7 * DAY;
    const withCR = this.countCacheReads();
    // Sessions with responses before the week of the project list: their first
    // response inside the week is not a cold start.
    const olderSids = new Set();
    for (const r of S.records) if (r.ts < week) olderSids.add(r.sid);
    const startedEarlier = sid => olderSids.has(sid) || !!(S.sessions.get(sid) || {}).cut;

    for (const r of S.records) {
      if (hidden.has(r.provider)) continue;
      const ts = r.ts;
      const tok = withCR ? r.total : r.total - (r.cr || 0);
      if (ts >= monthStart) { api.month += r.cost; api.byProvider[r.provider] = (api.byProvider[r.provider] || 0) + r.cost; }
      if (ts >= dayStart) {
        api.today += r.cost;
        types.in += r.in; types.out += r.out; types.cr += r.cr; types.cw += r.cw;
        const mm = modelsToday.get(r.model) || { model: r.model, provider: r.provider, fam: r.fam, tokens: 0 };
        mm.tokens += tok; modelsToday.set(r.model, mm);
      }
      if (ts >= weekStart) { const d = new Date(ts); heat[(d.getDay() + 6) % 7][d.getHours()] += r.cost; }
      if (ts >= hist[0].start) {
        const h = hist[Math.min(6, Math.floor((ts - hist[0].start) / DAY))];
        h.fam[r.fam] = (h.fam[r.fam] || 0) + tok;
      }
      if (ts >= week) {
        const p = topWeek.get(r.project) || { project: r.project, tokens: 0, cost: 0, byModel: {}, byApp: {}, cache: emptyCache() };
        addCache(p.cache, r, startedEarlier(r.sid));
        p.tokens += tok; p.cost += r.cost; p.byModel[r.model] = (p.byModel[r.model] || 0) + r.cost; p.byApp[r.app] = (p.byApp[r.app] || 0) + tok;
        topWeek.set(r.project, p);
      }
      if (ts >= win5) sessTokens.set(r.sid, (sessTokens.get(r.sid) || 0) + tok);
      const pl = primary[r.provider];
      if (pl && ts >= pl.t0 && pl.match(r)) sessCost.set(r.sid, (sessCost.get(r.sid) || 0) + r.cost);
      if (ts >= sparkStart) raw[Math.min(raw.length - 1, Math.floor((ts - sparkStart) / SPARK_STEP))] += tok;
      if (ts >= now - RATE_WINDOW) {
        const v = tok / (RATE_WINDOW / 1000);
        rateBySid.set(r.sid, (rateBySid.get(r.sid) || 0) + v);
        rateTotal += v;
      }
      for (const l of L) {
        if (!l.t0 || ts < l.t0 || !l.match || !l.match(r)) continue;
        l.costNow += r.cost;
        if (ts <= l.fetchedAt) l.costAtFetch += r.cost;
        if (ts >= now - VELOCITY_WINDOW) l.costRecent += r.cost;
        if (ts >= dayStart) l.costToday += r.cost;
      }
    }

    const spark = [];
    for (let i = 0; i < SPARK_BUCKETS; i++) {
      let sum = 0;
      for (let j = 0; j < SPARK_SMOOTH; j++) sum += raw[i + j];
      spark.push(sum / (SPARK_SMOOTH * SPARK_STEP / 1000));
    }

    // Interpolate limits between fetches from local spend: k = percent per dollar
    // inside the limit's window. For whole-percent sources the anchor keeps the
    // estimate from jumping back when the server repeats the same number.
    const limits = L.map(l => {
      let k = l.t0 && l.costAtFetch > 0.05 && l.percent > 0 ? l.percent / l.costAtFetch : null;
      if (k) this.lastK.set(l.key, k);
      if (k && l.percent >= 10) this.stableK.set(l.key, k);
      // A window that rolled over locally (reset passed, no fresh fetch yet) has no
      // server data: keep estimating with the last known percent per dollar.
      if (!k && l.rolled && l.t0) {
        k = this.lastK.get(l.key) || l.kHint || null; // costAtFetch is 0 here: the window started after the fetch
      }
      let a = this.anchors.get(l.key);
      const movedWindow = a && !(a.resetsAt == null ? l.resetsAt == null : l.resetsAt != null && Math.abs(a.resetsAt - l.resetsAt) < 5 * 60e3);
      if (!a || a.fetchedAt !== l.fetchedAt || movedWindow) {
        const same = a && l.integer && l.resetsAt && a.resetsAt && Math.abs(a.resetsAt - l.resetsAt) < 120e3;
        const pct = same ? Math.min(l.percent + 0.999, Math.max(l.percent, a.est)) : l.percent;
        a = { fetchedAt: l.fetchedAt, resetsAt: l.resetsAt, pct, est: pct };
        this.anchors.set(l.key, a);
      }
      // synthetic: percent made up locally (window rolled over before a fetch), not reported by the source
      const out = { key: l.key, provider: l.provider, kind: l.kind, name: l.name, percent: l.percent, resetsAt: l.resetsAt, windowSec: l.windowSec, estimated: !!(l.integer || k), synthetic: !!(l.rolled || l.synthetic) };
      if (k) {
        out.est = Math.min(100, a.pct + k * Math.max(0, l.costNow - l.costAtFetch));
        out.v = k * l.costRecent / (VELOCITY_WINDOW / 1000);
        out.today = Math.min(out.est, k * l.costToday);
      } else {
        out.est = a.pct; out.v = 0; out.today = null;
      }
      out.habit = this.habitFor(l, out.est, now);
      a.est = out.est;
      l.k = k;
      return out;
    });

    const sessions = [...S.sessions.values()]
      .filter(s => !hidden.has(s.provider) && (s.lastTs >= win5 || rateBySid.has(s.sid)))
      .map(s => {
        const pl = primary[s.provider];
        return {
          sid: s.sid, provider: s.provider, project: s.project, app: s.app, model: displayName(s.model), fam: famOf(s.provider, s.model),
          rate: rateBySid.get(s.sid) || 0, tokens: sessTokens.get(s.sid) || 0,
          share: pl && pl.k ? pl.k * (sessCost.get(s.sid) || 0) : null, shareOf: pl ? pl.name : null,
          ctx: s.ctx, ctxMax: s.ctxMax || 0, lastTs: s.lastTs, lastAction: s.lastAction
        };
      })
      .sort((a, b) => b.rate - a.rate || b.lastTs - a.lastTs)
      .slice(0, 10);

    const top = [...topWeek.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 8).map(p => {
      const main = Object.entries(p.byModel).sort((a, b) => b[1] - a[1])[0][0];
      const app = Object.entries(p.byApp).sort((a, b) => b[1] - a[1])[0][0];
      const rec = S.records.find(r => r.model === main);
      return { project: p.project, app, model: displayName(main), fam: rec ? rec.fam : 'other', tokens: p.tokens, cost: p.cost, cache: cacheSummary(p.cache) };
    });

    const histDays = hist.map((h, i) => {
      const d = new Date(h.start);
      return { label: i === 6 ? 'today' : ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][d.getDay()] + ' ' + d.getDate(), fam: h.fam };
    });

    if (this.history && ready) this.history.record(limits, now);
    // History panels don't need per-second updates.
    // Built only once all logs are read: a half-loaded store gives gaps and a wrong rate.
    if (!ready) this.histCache = null;
    // Also right away when the set of limits changed (a source's first answer
    // after start), so new panels don't wait for the next round.
    else {
      const keys = L.map(l => l.key).join('|');
      if (!this.histCache || now - this.histCache.builtAt > HISTORY_EVERY_MS || keys !== this.histKeys) { this.histCache = this.buildHistory(L, now); this.histKeys = keys; }
    }

    const claude = providers.find(p => p.id === 'claude');
    return {
      now, ready, countsCacheReads: withCR,
      providers: providers.map(p => ({ id: p.id, label: p.label, plan: p.plan, error: p.error, fetchedAt: p.fetchedAt })),
      breakdown: (claude && claude.breakdown) || [],
      limits,
      burn: { rate: rateTotal, spark, sparkSpanSec: SPARK_BUCKETS * SPARK_STEP / 1000 },
      sessions,
      types,
      models: [...modelsToday.values()].filter(m => m.tokens > 0).sort((a, b) => b.tokens - a.tokens).map(m => ({ name: displayName(m.model), provider: m.provider, fam: m.fam, tokens: m.tokens })),
      heat,
      events: S.events.filter(e => !hidden.has(e.provider)).slice(0, 8).map(eventTokens(withCR)),
      api,
      hist: histDays,
      topWeek: top,
      history: this.histCache
    };
  }

  // Forecast from habits for one limit: { atReset, runsOutAt }, { days,
  // notEnough } with under a week of history, or null (no profile, no reset
  // ahead, limit used up). Recomputed every HABIT_REFRESH_MS or when the
  // estimate or the reset time moved.
  habitFor(l, est, now) {
    const habit = this.habits.get(l.key);
    if (!habit || est >= 100) return null;
    if (habit.days < MIN_DAYS) return { days: habit.days, notEnough: true };
    const c = this.habitCache.get(l.key);
    if (c && now - c.t < HABIT_REFRESH_MS && Math.abs(c.est - est) < 0.1 && c.resetsAt === l.resetsAt) return c.value;
    const value = habitForecast(habit, { now, resetsAt: l.resetsAt, current: est });
    this.habitCache.set(l.key, { t: now, est, resetsAt: l.resetsAt, value });
    return value;
  }

  // Everything about one session, for the details panel. Built on request
  // (IPC session:details), not with every snapshot. null for an unknown sid.
  sessionDetails(sid, now = Date.now()) {
    const S = this.store;
    S.prepare(now); // may drop old sessions: look the session up afterwards
    const s = S.sessions.get(sid);
    const src = s && this.sources.find(x => x.id === s.provider);
    if (!s || (src && src.off)) return null; // gone, or its source is hidden in settings
    const withCR = this.countCacheReads();
    const tok = r => (withCR ? r.total : r.total - (r.cr || 0));
    const recs = S.records.filter(r => r.sid === sid);
    const types = { in: 0, out: 0, cr: 0, cw: 0 };
    const models = new Map();
    const cacheAcc = emptyCache();
    let tokens = 0, cost = 0;
    for (const r of recs) {
      addCache(cacheAcc, r, !!s.cut); // cut: its first responses are older than the store keeps
      types.in += r.in; types.out += r.out; types.cr += r.cr; types.cw += r.cw;
      tokens += tok(r); cost += r.cost;
      const name = displayName(r.model); // ids that differ only by date or [1m] share a row
      const m = models.get(name) || { name, fam: famOf(r.provider, r.model), tokens: 0, cost: 0 };
      m.tokens += tok(r); m.cost += r.cost;
      models.set(name, m);
    }
    const start = recs.length ? recs[0].ts : s.lastTs, end = recs.length ? recs[recs.length - 1].ts : s.lastTs;
    // Tokens over the session: at most SESSION_COLS columns of whole minutes.
    const stepMs = Math.max(60e3, Math.ceil((end - start + 1) / SESSION_COLS / 60e3) * 60e3);
    const series = new Array(Math.max(1, Math.ceil((end - start + 1) / stepMs))).fill(0);
    for (const r of recs) series[Math.min(series.length - 1, Math.floor((r.ts - start) / stepMs))] += tok(r);
    // Share of each limit's current window this session used: the last known
    // percent per dollar × the session's cost in that window. Read from the
    // sources now, so a window that just reset or a hidden source is current.
    const shares = this.sources.filter(x => x.enabled && !x.off).flatMap(x => x.limits()).map(l => {
      const k = this.lastK.get(l.key) || l.kHint || null;
      if (!k || !l.match || !l.resetsAt) return null;
      const t0 = l.resetsAt - l.windowSec * 1000;
      let c = 0;
      for (const r of recs) if (r.ts >= t0 && l.match(r)) c += r.cost;
      return c > 0 ? { key: l.key, provider: l.provider, name: l.name, pct: k * c } : null;
    }).filter(Boolean);
    // The session's own last actions (kept since 0.9.2); older cached sessions
    // fall back to the shared log, filtered by project and time.
    const events = (s.actions && s.actions.length ? s.actions.slice()
      : S.events.filter(e => e.provider === s.provider && e.project === s.project && e.ts >= start - 1000 && e.ts <= end + 1000))
      .sort((a, b) => b.ts - a.ts).slice(0, 12).map(eventTokens(withCR));
    return {
      sid, provider: s.provider, project: s.project, app: s.app, model: displayName(s.model), now,
      start, end, responses: recs.length, types, tokens, cost, countsCacheReads: withCR,
      cache: cacheSummary(cacheAcc),
      models: [...models.values()].sort((a, b) => b.tokens - a.tokens), series, stepMs, shares,
      ctx: s.ctx, ctxMax: s.ctxMax || 0, lastAction: s.lastAction, events
    };
  }

  // Past and current limit windows for the history view: session (5h) windows
  // of the last 7 days with a usage series for the current one, and the last
  // weekly windows with per-day usage.
  buildHistory(L, now) {
    const S = this.store;
    const samples = key => (this.history ? this.history.samples(key, now - 8 * DAY) : []);
    const sessions = [], weeks = [], months = [];
    const habits = new Map(); // rebuilt each time: a limit that lost its rate loses its profile
    for (const l of L) {
      // Monthly cycles come from server readings only (Copilot has no local logs).
      if (l.kind === 'monthly' && this.history) {
        const rows = monthlyCycles(this.history.samples(l.key, now - MONTHLY_KEEP_MS), { resetsAt: l.resetsAt, windowMs: l.windowSec * 1000, now });
        if (rows.length) months.push({ key: l.key, provider: l.provider, name: l.name, keepDays: Math.round(MONTHLY_KEEP_MS / DAY), rows });
      }
      if (!l.match) continue;
      const k = this.stableK.get(l.key) || l.kHint || l.k || this.lastK.get(l.key) || null;
      const recs = S.records.filter(l.match);
      const base = { key: l.key, provider: l.provider, name: l.name };
      const smp = samples(l.key);
      // Usual usage per hour of the week, from the logs (cost × percent per
      // dollar). History starts at the day of the first record: before it the
      // logs know nothing, and counting those hours as quiet would pull the
      // averages down.
      if ((l.kind === 'weekly' || l.kind === 'monthly') && k && recs.length) {
        habits.set(l.key, hourProfile(recs.map(r => ({ ts: r.ts, pct: k * r.cost })), { from: Math.max(S.cutoff, startOfDay(recs[0].ts)), now }));
      }
      if (l.kind === 'session') {
        const windowMs = l.windowSec * 1000;
        const anchor = l.resetsAt ? { start: l.resetsAt - windowMs, end: l.resetsAt } : null;
        const ws = sessionWindows(recs, { windowMs, k, anchor, since: now - 7 * DAY, samples: smp, now });
        const cur = ws.find(w => w.current) || null;
        sessions.push({ ...base, windows: ws.slice(0, 24), current: cur, series: cur ? windowSeries(cur, recs, { k, samples: smp, now, cols: 120 }) : null });
      } else if (l.kind === 'weekly' && l.resetsAt) {
        weeks.push({ ...base, rows: fixedWindows(recs, { resetsAt: l.resetsAt, windowMs: l.windowSec * 1000, k, count: 6, samples: smp, now, since: S.cutoff }) });
      }
    }
    this.habits = habits;
    this.habitCache.clear();
    return { builtAt: now, sessions, weeks, months, summaries: this.weeks() };
  }
}

module.exports = { Aggregator };
