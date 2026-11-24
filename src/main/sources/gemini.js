// Gemini CLI: recorded chat sessions in ~/.gemini/tmp/<project>/chats/ (or
// under GEMINI_CLI_HOME). Two layouts are read: session-*.json, one JSON
// object that Gemini CLI rewrites whole on every message, and session-*.jsonl,
// one JSON record per line, appended. In both, answers of type "gemini" carry
// the token counts of that request. No limits are kept on disk, so this source
// shows usage only. Nothing is sent anywhere and the Google login is never read.
// Neither layout has been checked on a real install: see "How sure this is" in
// docs/sources/gemini-cli.md. Tested on fabricated files only.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { costGemini } = require('../pricing');
const { projectOf, relPath } = require('./common');

const APP = 'Gemini CLI';
const CONTEXT = 1048576; // context window of the Gemini 2.5 and 3 models
const FULL_SCAN_MS = 10e3; // look for new session files this often
const RECENT_MS = 30 * 60e3; // between full scans, re-check only files changed this recently
const KNOWN_TYPES = ['user', 'gemini', 'info', 'error', 'warning'];

const homeDir = () => (process.env.GEMINI_CLI_HOME ? path.join(process.env.GEMINI_CLI_HOME, '.gemini') : path.join(os.homedir(), '.gemini'));
const count = v => (Number.isFinite(v) && v > 0 ? v : 0);

// TokensSummary (input includes cached; thinking bills as output; tool-use
// prompt as input) -> the store's split.
function usageOf(t) {
  const input = count(t.input);
  const cr = Math.min(count(t.cached), input);
  const fresh = input - cr + count(t.tool);
  const out = count(t.output) + count(t.thoughts);
  return { in: fresh, cr, out, total: fresh + cr + out };
}

// The activity line of one tool call: its name and the command or file it acted on.
function toolText(tc, cwd) {
  const name = tc && typeof tc.name === 'string' ? tc.name.slice(0, 60) : '';
  if (!name) return null;
  const a = tc.args && typeof tc.args === 'object' ? tc.args : {};
  if (typeof a.command === 'string' && a.command) return `${name}: ${a.command.split('\n')[0].slice(0, 100)}`;
  const p = [a.file_path, a.absolute_path, a.path].find(v => typeof v === 'string' && v);
  return p ? `${name} ${relPath(p, cwd)}` : name;
}

// session-*.json: one JSON object with the session id and all its messages.
function wholeOf(text) {
  let d;
  try { d = JSON.parse(text); } catch { return { bad: 'json' }; } // also a file caught mid-write: read again once it changes
  if (!d || typeof d !== 'object' || !Array.isArray(d.messages)) return { bad: 'shape' };
  return { sessionId: typeof d.sessionId === 'string' ? d.sessionId : '', messages: d.messages, badLines: 0, otherLines: 0 };
}

// session-*.jsonl: one JSON record per line. A record with an `id` and a
// `type` is a message, and a later record with the same id replaces the
// earlier one (how an answer gets its tokens). A record with a `sessionId`
// and no `id` is the session's header. Anything else (records that edit the
// header or rewind the conversation) is only counted: the tokens of answers
// that were rewound away were still spent, so those answers stay counted.
function linesOf(text) {
  const byId = new Map();
  let sessionId = '', badLines = 0, otherLines = 0, objects = 0;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { badLines++; continue; } // also the last line caught mid-write
    if (!o || typeof o !== 'object' || Array.isArray(o)) { badLines++; continue; }
    objects++;
    if (typeof o.id === 'string' && o.id && typeof o.type === 'string') byId.set(o.id, o);
    else if (!sessionId && typeof o.sessionId === 'string' && o.sessionId && o.id === undefined) sessionId = o.sessionId;
    else otherLines++;
  }
  if (!objects) return { bad: 'json' };
  if (!byId.size && !sessionId) return { bad: 'shape' };
  return { sessionId, messages: [...byId.values()], badLines, otherLines };
}

class GeminiSource {
  // opts.home: the .gemini folder (tests); default ~/.gemini or GEMINI_CLI_HOME/.gemini
  constructor(store, opts = {}) {
    this.id = 'gemini';
    this.store = store;
    this.home = opts.home || homeDir();
    this.root = path.join(this.home, 'tmp');
    this.files = new Map();    // session file -> { mtimeMs, size, bad?, sum? } as last read
    this.projects = new Map(); // project folder -> { name, cwd } (until the next full scan)
    this.busy = false;
    this.lastFullScan = 0;
    this.scannedAt = 0;
    this.filesRead = 0;        // since start (diagnostics)
    this.changes = 0;          // bumped when the file list changes (for the on-disk cache)
    this.updated = 0;          // answers whose tokens changed after they were first counted (diagnostics)
    this.recIdx = null;
    this.recIdxCutoff = 0;
  }

  get enabled() { return fs.existsSync(this.root); }

  // ── on-disk usage cache: size and time of each file as last read, so a
  // restart reads only sessions that changed. Records and sessions are in the store. ──
  exportState() {
    const cutoff = this.store.cutoff;
    return { files: [...this.files].filter(([, f]) => f.mtimeMs >= cutoff) };
  }
  importState(s) {
    const list = s && Array.isArray(s.files) ? s.files : [];
    this.files = new Map(list.filter(e => Array.isArray(e) && typeof e[0] === 'string' && e[1] && typeof e[1].mtimeMs === 'number'));
  }
  init() { return this.enabled ? this.scan(true) : Promise.resolve(); }
  tick() { return this.enabled ? this.scan(false) : Promise.resolve(); }

  async listFiles() {
    const out = [];
    let dirs;
    try { dirs = await fsp.readdir(this.root, { withFileTypes: true }); } catch { return out; }
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const chats = path.join(this.root, d.name, 'chats');
      let names;
      try { names = await fsp.readdir(chats); } catch { continue; }
      for (const n of names) {
        if (/^session-.*\.jsonl?$/.test(n)) out.push(path.join(chats, n));
      }
    }
    return out;
  }

  // full = also look for new files; otherwise only re-check recently changed ones
  async scan(full) {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = Date.now();
      let list;
      if (full || now - this.lastFullScan > FULL_SCAN_MS) {
        list = await this.listFiles();
        this.lastFullScan = now;
        this.projects.clear();
        const present = new Set(list);
        for (const p of this.files.keys()) if (!present.has(p)) { this.files.delete(p); this.changes++; }
      } else {
        list = [...this.files].filter(([, f]) => now - f.mtimeMs < RECENT_MS).map(([p]) => p);
      }
      const cutoff = this.store.cutoff;
      for (const p of list) {
        let st;
        try { st = await fsp.stat(p); } catch { continue; }
        const known = this.files.get(p);
        if (known && known.mtimeMs === st.mtimeMs && known.size === st.size) continue;
        const entry = { mtimeMs: st.mtimeMs, size: st.size };
        if (st.mtimeMs >= cutoff) {
          let text = null;
          try { text = await fsp.readFile(p, 'utf8'); } catch { /* locked or gone: next scan */ }
          if (text == null) continue;
          this.filesRead++;
          Object.assign(entry, this.readSession(text, p));
        }
        this.files.set(p, entry);
        this.changes++;
      }
      this.scannedAt = now;
    } finally {
      this.busy = false;
    }
  }

  // The project of a <project> folder under tmp: the path in .project_root,
  // a readable folder name, or a short form of the path hash.
  projectFor(dir) {
    let p = this.projects.get(dir);
    if (p) return p;
    let cwd = '';
    try {
      const line = fs.readFileSync(path.join(dir, '.project_root'), 'utf8').trim();
      if (line && line.length < 1000 && !line.includes('\n')) cwd = line;
    } catch { /* not written by this Gemini CLI release */ }
    const base = path.basename(dir);
    const name = cwd ? projectOf(cwd) : /^[0-9a-f]{64}$/i.test(base) ? 'gemini-' + base.slice(0, 8).toLowerCase() : base;
    p = { name, cwd };
    this.projects.set(dir, p);
    return p;
  }

  // Parses one whole session file into the store. Returns what the file
  // held, for diagnostics: { bad } when it isn't a session, else { sum }.
  readSession(text, file) {
    const jsonl = file.endsWith('.jsonl');
    const d = jsonl ? linesOf(text) : wholeOf(text);
    if (d.bad) return { bad: d.bad };
    const P = this.projectFor(path.dirname(path.dirname(file)));
    const sid = 'gemini:' + (d.sessionId ? d.sessionId.slice(0, 80) : path.basename(file, jsonl ? '.jsonl' : '.json'));
    const sum = { types: Object.create(null), answers: 0, withTokens: 0, noTimestamp: 0, toolCalls: 0, badLines: d.badLines, otherLines: d.otherLines };
    for (const m of d.messages) this.onMessage(m, sid, P, sum);
    return { sum };
  }

  onMessage(m, sid, P, sum) {
    if (!m || typeof m !== 'object') return;
    // Only plain type names reach the diagnostics report, which users paste into public issues.
    const type = typeof m.type === 'string' && /^[\w.-]{1,40}$/.test(m.type) ? m.type : '?';
    if (Object.hasOwn(sum.types, type) || KNOWN_TYPES.includes(type) || Object.keys(sum.types).length < 30) sum.types[type] = (sum.types[type] || 0) + 1;
    if (type !== 'gemini') return;
    sum.answers++;
    const ts = Date.parse(m.timestamp);
    if (!ts) { sum.noTimestamp++; return; }
    const t = m.tokens && typeof m.tokens === 'object' ? m.tokens : null;
    if (t) sum.withTokens++;
    const toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    sum.toolCalls += toolCalls.length;
    const S = this.store;
    if (ts < S.cutoff) return;
    const model = typeof m.model === 'string' && m.model ? m.model.slice(0, 80) : 'gemini';
    // The session exists from its first answer, with or without tokens yet, so
    // a tool call written before the answer's tokens is kept on it.
    const fresh = !S.sessions.has(sid);
    const s = S.session(sid, { provider: 'gemini', project: P.name, app: APP, model });
    s.project = P.name;
    if (fresh) s.lastTs = ts;

    const mid = typeof m.id === 'string' && m.id ? m.id.slice(0, 80) : String(ts);
    const u = t ? usageOf(t) : null;
    if (u && u.total > 0) {
      if (ts >= s.lastTs) {
        s.lastTs = ts; s.model = model;
        s.ctx = count(t.input); s.ctxMax = CONTEXT; s.ctxTs = ts;
      }
      const rec = {
        ts, provider: 'gemini', sid, mid, project: P.name, app: APP, model, fam: 'gemini',
        in: u.in, out: u.out, cr: u.cr, cw: 0, total: u.total, cost: costGemini(model, u)
      };
      const key = sid + ':' + mid;
      if (S.addRecord(key, rec)) this.recordIndex().set(key, rec);
      else this.updateRecord(key, rec);
    }
    toolCalls.forEach((tc, i) => {
      const text = toolText(tc, P.cwd);
      if (!text) return;
      const at = Date.parse(tc.timestamp) || ts;
      if (at < S.cutoff) return;
      S.addEvent(`${sid}:${tc.id || mid + ':' + i}`, { ts: at, provider: 'gemini', project: P.name, text, tok: 0, kind: 'tool' }, sid);
      const s = S.sessions.get(sid);
      if (s && at >= s.lastTs - 1) s.lastAction = text;
    });
  }

  // The store's record key (session id and message id) -> this source's record
  // in the store; a record keeps its message id as `mid` for this. Built from the store on first
  // use (records loaded from the on-disk cache) and again when its cutoff moves.
  recordIndex() {
    const S = this.store;
    if (!this.recIdx || this.recIdxCutoff !== S.cutoff) {
      this.recIdx = new Map();
      for (const r of S.records) if (r.provider === 'gemini') this.recIdx.set(r.sid + ':' + (r.mid || r.ts), r);
      this.recIdxCutoff = S.cutoff;
    }
    return this.recIdx;
  }

  // The whole file is read again when it changes, so an answer already counted
  // comes back on every read. If its tokens changed since (an answer still being
  // written), the stored record takes the new numbers instead of a second record.
  updateRecord(key, rec) {
    const r = this.recordIndex().get(key);
    if (!r || (r.in === rec.in && r.out === rec.out && r.cr === rec.cr && r.model === rec.model)) return;
    Object.assign(r, { model: rec.model, in: rec.in, out: rec.out, cr: rec.cr, total: rec.total, cost: rec.cost, project: rec.project });
    this.store.changes++;
    this.updated++;
  }

  diagnostics() {
    const parser = { jsonFiles: 0, jsonlFiles: 0, sessionFiles: 0, badJson: 0, notSession: 0, badLines: 0, otherLines: 0, answers: 0, withTokens: 0, noTimestamp: 0, toolCalls: 0, messageTypes: Object.create(null) };
    for (const [p, f] of this.files) {
      if (p.endsWith('.jsonl')) parser.jsonlFiles++; else parser.jsonFiles++;
      if (f.bad === 'json') parser.badJson++;
      else if (f.bad === 'shape') parser.notSession++;
      if (!f.sum) continue;
      parser.sessionFiles++;
      for (const k of ['answers', 'withTokens', 'noTimestamp', 'toolCalls', 'badLines', 'otherLines']) parser[k] += f.sum[k] || 0;
      for (const [k, n] of Object.entries(f.sum.types || {})) {
        if (Object.hasOwn(parser.messageTypes, k) || Object.keys(parser.messageTypes).length < 30) parser.messageTypes[k] = (parser.messageTypes[k] || 0) + n;
      }
    }
    return {
      dataFolder: { path: this.root, exists: fs.existsSync(this.root) }, geminiHomeFromEnv: !!process.env.GEMINI_CLI_HOME,
      filesTracked: this.files.size, filesRead: this.filesRead, answersUpdated: this.updated, parser
    };
  }

  // No plan or limits on disk: "usage only" stands where a plan name would.
  status() { return { id: 'gemini', label: 'gemini', plan: null, note: 'usage only', error: null, fetchedAt: this.scannedAt }; }

  limits() { return []; }
}

module.exports = { GeminiSource, usageOf, toolText, linesOf };
