// On-disk cache of parsed usage, so a restart reads only what the logs gained
// since the last run instead of the whole month (~1 GB).
//
// File: { version, app, savedAt, store, sources: { [id]: state } }.
// It is used only by the same app version: records carry costs and names
// computed by that version's parser and price tables, so an update starts
// with one full read. A different version, a parse error or a missing file
// mean "no cache".
//
// Every write goes to its own temp file and is renamed into place; a write
// that finishes after a newer one is dropped, so a slow 5-minute save can't
// overwrite the save made on quit.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// Bump when the shape of stored records changes, so files written in an older
// format are read again from the logs.
// 2: records carry cw1 (1-hour cache writes), needed to price cache writes.
const VERSION = 2;

function serialize(store, sources, app) {
  const out = { version: VERSION, app, savedAt: Date.now(), store: store.toJSON(), sources: {} };
  for (const s of sources) if (s.exportState) out.sources[s.id] = s.exportState();
  return out;
}

// Loads a parsed cache into the store and sources. Returns false (and touches
// nothing) when the data isn't a cache of this format and app version.
function restore(data, store, sources, app) {
  if (!data || typeof data !== 'object' || data.version !== VERSION || data.app !== app || !data.store || !data.sources) return false;
  store.fromJSON(data.store);
  for (const s of sources) if (s.importState && data.sources[s.id]) s.importState(data.sources[s.id]);
  return true;
}

class UsageCache {
  // opts.app: app version the cache belongs to
  constructor(file, store, sources, opts = {}) {
    this.file = file;
    this.store = store;
    this.sources = sources;
    this.app = opts.app || '';
    this.saved = null;     // change counters at the last save
    this.seq = 0;          // numbers every write
    this.committed = 0;    // seq of the newest write that reached the final file
    this.writing = false;
  }

  // Change counters of everything that ends up in the file.
  stamp() {
    return [this.store.changes, ...this.sources.map(s => s.changes || 0)].join(',');
  }

  // Returns true when a cache was loaded. Also removes temp files left by
  // writes that were cut off.
  load() {
    try {
      const dir = path.dirname(this.file), base = path.basename(this.file);
      for (const f of fs.readdirSync(dir)) if (f.startsWith(base + '.') && f.endsWith('.tmp')) fs.rmSync(path.join(dir, f), { force: true });
    } catch { /* no folder yet */ }
    let data;
    try { data = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return false; }
    const ok = restore(data, this.store, this.sources, this.app);
    if (ok) this.saved = this.stamp();
    return ok;
  }

  dirty() { return this.stamp() !== this.saved; }

  // One snapshot: what to write, where, and how to commit it.
  begin() {
    const seq = ++this.seq;
    return {
      seq, stamp: this.stamp(),
      tmp: `${this.file}.${process.pid}.${seq}.tmp`,
      json: JSON.stringify(serialize(this.store, this.sources, this.app))
    };
  }

  // Only a write newer than the last committed one may replace the file.
  commitName(w) {
    if (w.seq < this.committed) return false;
    this.committed = w.seq;
    this.saved = w.stamp;
    return true;
  }

  // Background save (every few minutes).
  async save() {
    if (this.writing || !this.dirty()) return false;
    this.writing = true;
    const w = this.begin();
    try {
      await fsp.writeFile(w.tmp, w.json);
      if (!this.commitName(w)) { await fsp.rm(w.tmp, { force: true }); return false; }
      await fsp.rename(w.tmp, this.file);
      return true;
    } catch (e) {
      console.error('usage cache', e.message);
      fsp.rm(w.tmp, { force: true }).catch(() => {});
      return false;
    } finally {
      this.writing = false;
    }
  }

  // On quit: finishes before the process exits, and wins over a background
  // save that is still running.
  saveSync() {
    if (!this.dirty()) return;
    const w = this.begin();
    try {
      fs.writeFileSync(w.tmp, w.json);
      if (this.commitName(w)) fs.renameSync(w.tmp, this.file);
    } catch (e) {
      console.error('usage cache', e.message);
      try { fs.rmSync(w.tmp, { force: true }); } catch { /* ignore */ }
    }
  }
}

module.exports = { UsageCache, serialize, restore, VERSION };
