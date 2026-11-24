// Shared in-memory store that every source (Claude Code, Codex, Cursor) writes into.
// A record is one model response:
//   { ts, provider, sid, project, app, model, fam, in, out, cr, cw, cw1?, total, cost, bucket? }
// cw is all cache-write tokens, cw1 the part of them written with a 1-hour TTL
// (missing = 0). cost is the API-list-price equivalent in USD.
// A session with `cut: true` had earlier responses that the store does not
// keep (older than the cutoff): its first kept record is not its first response.
const DAY = 86400e3;
const ACTIONS_PER_SESSION = 12; // last actions kept on each session, for its details panel

const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Monday midnight of the week t is in.
const startOfWeek = t => { const d = new Date(startOfDay(t)); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
const startOfMonth = t => { const d = new Date(t); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime(); };

class Store {
  constructor() {
    this.records = [];
    this.unsorted = false;
    this.seen = new Map();      // record key -> ts (dedupe; pruned with the records)
    this.sessions = new Map();  // sid -> { sid, provider, project, app, model, lastTs, ctx, ctxMax, ctxTs, lastAction, actions }
    this.events = [];           // { ts, provider, project, text, tok, kind }
    this.seenEvt = new Map();   // event key -> ts
    this.floors = {};           // source id -> earliest timestamp it needs (e.g. Cursor billing cycle start)
    this.cutoff = Store.cutoffFor(Date.now());
    this.changes = 0;           // bumped on every new record or event (for the on-disk cache)
  }

  setFloor(id, ts) {
    this.floors[id] = ts;
    this.cutoff = Math.min(this.cutoff, ts);
  }

  // Keep this month plus at least the last 8 days.
  static cutoffFor(now) {
    return Math.min(startOfMonth(now), startOfDay(now - 8 * DAY));
  }

  addRecord(key, r) {
    if (r.ts < this.cutoff) return this.markCut(r.sid);
    if (this.seen.has(key)) return false;
    this.seen.set(key, r.ts);
    const last = this.records[this.records.length - 1];
    if (last && r.ts < last.ts) this.unsorted = true;
    this.records.push(r);
    this.changes++;
    return true;
  }

  // Notes that a record of this session was left out as too old. Returns false.
  markCut(sid) {
    const s = this.sessions.get(sid);
    if (s) s.cut = true;
    return false;
  }

  // Returns true when the event is new. With a sid, it is also kept on that
  // session (its last ACTIONS_PER_SESSION actions, oldest first).
  addEvent(key, e, sid) {
    if (e.ts < this.cutoff || this.seenEvt.has(key)) return false;
    this.seenEvt.set(key, e.ts);
    this.events.push(e);
    this.changes++;
    if (this.events.length > 300) this.trimEvents();
    const s = sid && this.sessions.get(sid);
    if (s) {
      const list = s.actions || (s.actions = []);
      list.push(e);
      if (list.length > 1 && e.ts < list[list.length - 2].ts) list.sort((a, b) => a.ts - b.ts);
      if (list.length > ACTIONS_PER_SESSION) list.splice(0, list.length - ACTIONS_PER_SESSION);
    }
    return true;
  }

  session(sid, init) {
    let s = this.sessions.get(sid);
    if (!s) {
      s = { sid, lastTs: 0, ctx: 0, ctxMax: 0, ctxTs: 0, lastAction: '', ...init };
      this.sessions.set(sid, s);
    }
    return s;
  }

  trimEvents() {
    this.events.sort((a, b) => b.ts - a.ts);
    this.events.length = Math.min(this.events.length, 60);
  }

  prepare(now) {
    const c = Math.min(Store.cutoffFor(now), ...Object.values(this.floors));
    if (c > this.cutoff) {
      this.cutoff = c;
      this.records = this.records.filter(r => r.ts >= c || this.markCut(r.sid));
      for (const m of [this.seen, this.seenEvt]) for (const [k, ts] of m) if (ts < c) m.delete(k);
      for (const [sid, s] of this.sessions) if (s.lastTs < c) this.sessions.delete(sid);
    }
    if (this.unsorted) { this.records.sort((a, b) => a.ts - b.ts); this.unsorted = false; }
    if (this.events.length > 60) this.trimEvents();
  }

  // ── on-disk cache ──
  toJSON() {
    this.prepare(Date.now());
    return {
      records: this.records,
      seen: [...this.seen],
      sessions: [...this.sessions.values()],
      events: this.events,
      seenEvt: [...this.seenEvt],
      floors: this.floors
    };
  }

  // Replaces the contents with a saved state; entries older than the cutoff are
  // dropped. Saved floors (e.g. the Cursor billing cycle start) count, because
  // the cache loads before Cursor's first poll sets its floor again.
  fromJSON(j) {
    for (const [id, ts] of Object.entries(j.floors || {})) if (typeof ts === 'number') this.setFloor(id, ts);
    const c = this.cutoff;
    this.sessions = new Map((j.sessions || []).filter(s => s.lastTs >= c).map(s => [s.sid, s]));
    this.records = (j.records || []).filter(r => r.ts >= c || this.markCut(r.sid)).sort((a, b) => a.ts - b.ts);
    this.unsorted = false;
    this.seen = new Map((j.seen || []).filter(([, ts]) => ts >= c));
    this.events = (j.events || []).filter(e => e.ts >= c);
    this.seenEvt = new Map((j.seenEvt || []).filter(([, ts]) => ts >= c));
  }
}

module.exports = { Store, startOfDay, startOfWeek, startOfMonth, DAY };
