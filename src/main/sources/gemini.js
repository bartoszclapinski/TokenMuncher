// Gemini CLI: recorded chat sessions in ~/.gemini/tmp/<project>/chats/session-*.json
// (or under GEMINI_CLI_HOME). Each file is one JSON object that Gemini CLI
// rewrites whole on every message; answers of type "gemini" carry the token
// counts of that request. No limits are kept on disk, so this source shows
// usage only. Nothing is sent anywhere and the Google login is never read.
// Format and its open questions: docs/sources/gemini-cli.md. Written against
// Gemini CLI's chat recording code; tested on a fabricated file only.
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
      for (const n of names) if (/^session-.*\.json$/.test(n)) out.push(path.join(chats, n));
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
    let d;
    try { d = JSON.parse(text); } catch { return { bad: 'json' }; } // also a file caught mid-write: read again once it changes
    if (!d || typeof d !== 'object' || !Array.isArray(d.messages)) return { bad: 'shape' };
    const P = this.projectFor(path.dirname(path.dirname(file)));
    const sid = 'gemini:' + (typeof d.sessionId === 'string' && d.sessionId ? d.sessionId.slice(0, 80) : path.basename(file, '.json'));
    const sum = { types: Object.create(null), answers: 0, withTokens: 0, noTimestamp: 0, toolCalls: 0 };
    for (const m of d.messages) this.onMessage(m, sid, P, sum);
    return { sum };
  }

  onMessage(m, sid, P, sum) {
    if (!m || typeof m !== 'object') return;
    const type = typeof m.type === 'string' ? m.type.slice(0, 40) : '?';
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

    if (t) {
      const u = usageOf(t);
      if (u.total > 0) {
        const s = S.session(sid, { provider: 'gemini', project: P.name, app: APP, model });
        s.project = P.name;
        if (ts >= s.lastTs) {
          s.lastTs = ts; s.model = model;
          s.ctx = count(t.input); s.ctxMax = CONTEXT; s.ctxTs = ts;
        }
        S.addRecord(sid + ':' + (m.id || ts), {
          ts, provider: 'gemini', sid, project: P.name, app: APP, model, fam: 'gemini',
          in: u.in, out: u.out, cr: u.cr, cw: 0, total: u.total, cost: costGemini(model, u)
        });
      }
    }
    toolCalls.forEach((tc, i) => {
      const text = toolText(tc, P.cwd);
      if (!text) return;
      const at = Date.parse(tc.timestamp) || ts;
      if (at < S.cutoff) return;
      S.addEvent(`${sid}:${tc.id || (m.id || ts) + ':' + i}`, { ts: at, provider: 'gemini', project: P.name, text, tok: 0, kind: 'tool' }, sid);
      const s = S.sessions.get(sid);
      if (s && at >= s.lastTs - 1) s.lastAction = text;
    });
  }

  diagnostics() {
    const parser = { sessionFiles: 0, badJson: 0, notSession: 0, answers: 0, withTokens: 0, noTimestamp: 0, toolCalls: 0, messageTypes: Object.create(null) };
    for (const f of this.files.values()) {
      if (f.bad === 'json') parser.badJson++;
      else if (f.bad === 'shape') parser.notSession++;
      if (!f.sum) continue;
      parser.sessionFiles++;
      for (const k of ['answers', 'withTokens', 'noTimestamp', 'toolCalls']) parser[k] += f.sum[k] || 0;
      for (const [k, n] of Object.entries(f.sum.types || {})) {
        if (Object.hasOwn(parser.messageTypes, k) || Object.keys(parser.messageTypes).length < 30) parser.messageTypes[k] = (parser.messageTypes[k] || 0) + n;
      }
    }
    return {
      dataFolder: { path: this.root, exists: fs.existsSync(this.root) }, geminiHomeFromEnv: !!process.env.GEMINI_CLI_HOME,
      filesTracked: this.files.size, filesRead: this.filesRead, parser
    };
  }

  // No plan or limits on disk: "usage only" stands where a plan name would.
  status() { return { id: 'gemini', label: 'gemini', plan: null, note: 'usage only', error: null, fetchedAt: this.scannedAt }; }

  limits() { return []; }
}

module.exports = { GeminiSource, usageOf, toolText };
