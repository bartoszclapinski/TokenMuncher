import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { pickMiniLimits, pickHeadline, shortName } from '../shared/mini';
import { burning, secondsToFull, runoutBeforeReset } from '../shared/forecast';
import { critterRows, W } from '../shared/critter';
import { THEMES, THEME_IDS, GROUPS, MASCOT_CHOICES, themeOf, mascotOf } from '../shared/themes';
import { pad, hhmm, when, duration } from '../shared/clock';
import { downloadText } from '../shared/download';
import { fmtTok, change } from '../shared/numbers';
import { defaults as defaultLayout, normalize as normalizeLayout } from '../shared/layout';
import { LayoutView } from './layout-view.jsx';

const VERSION = 'v' + __APP_VERSION__; // from package.json, injected by build.mjs
// Colours of the current skin (src/shared/themes.js). These objects are
// filled in place by applyTheme, so every component reads the current skin
// when it renders; the CSS gets the same values as variables.
const C = {};
const PROV = {};
const provColor = p => PROV[p] || C.muted;
const FAM = {};
const famColor = f => FAM[f] || FAM.other;
const MOOD_COLOR = {};
let MASCOT = 'critter';
let appliedTheme = null;
function applyTheme(id, mascot) {
  const t = themeOf(id);
  MASCOT = mascotOf(t.name, mascot);
  if (appliedTheme === t.name) return;
  appliedTheme = t.name;
  Object.assign(C, t.c);
  Object.assign(PROV, t.prov);
  Object.assign(FAM, { opus: C.clay, sonnet: C.teal, ...t.fam, ...PROV, other: C.muted });
  Object.assign(MOOD_COLOR, { sleep: C.muted, calm: C.ok, eat: C.clay, panic: C.danger });
  const root = document.documentElement;
  for (const [k, v] of Object.entries(t.c)) root.style.setProperty('--' + k, v);
  root.dataset.theme = t.name;
  root.style.colorScheme = t.light ? 'light' : 'dark';
}
// The window loads with ?theme=<skin> (main), so the first paint already has
// the saved skin; later changes come with the settings.
const query = new URLSearchParams(location.search);
applyTheme(query.get('theme'), query.get('mascot'));
// a shade between the accent and the background (heat map, zoom bars)
const accentMix = pct => `color-mix(in oklch, ${C.clay} ${pct}%, ${C.bg})`;

const BLK = '▏▎▍▌▋▊▉', SPK = '▁▂▃▄▅▆▇█';
const fmtInt = n => Math.round(n).toLocaleString('en-US');
const durParts = sec => {
  sec = Math.max(0, Math.floor(sec));
  return { d: Math.floor(sec / 86400), h: Math.floor(sec % 86400 / 3600), m: Math.floor(sec % 3600 / 60), s: sec % 60 };
};
// "2d 8h 05m" / "1h 05m 09s" (dashboard) and "2d 8h" / "1h 05m" / "5m" (mini widget)
const fmtDur = sec => { const { d, h, m, s } = durParts(sec); return d > 0 ? `${d}d ${h}h ${pad(m)}m` : `${h}h ${pad(m)}m ${pad(s)}s`; };
const fmtShort = sec => { const { d, h, m } = durParts(sec); return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${pad(m)}m` : `${m}m`; };
const hhmmss = t => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
const ascii = (frac, n) => {
  frac = Math.max(0, Math.min(1, frac || 0));
  const cells = frac * n, full = Math.floor(cells), pi = Math.floor((cells - full) * 8);
  const part = full < n && pi > 0 ? BLK[pi - 1] : '';
  return { fill: '█'.repeat(full) + part, empty: '░'.repeat(Math.max(0, n - full - (part ? 1 : 0))) };
};
const STALE_MS = 10 * 60e3;
const fmtAgo = duration;
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const store = {
  get(k, d) { try { const v = localStorage.getItem('tm.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tm.' + k, JSON.stringify(v)); } catch { /* ignore */ } }
};

// ── critter ────────────────────────────────────────────────────────────────
const MOOD_LABEL = { sleep: 'asleep', calm: 'chill', eat: 'munching', panic: 'PANIC' };

// Mood from the most-used limit and the current burn rate.
function moodOf(snap) {
  const maxPct = snap.limits.length ? Math.max(...snap.limits.map(l => l.est)) : 0;
  const total = snap.burn.rate;
  return maxPct >= 90 ? 'panic' : total < 1 ? 'sleep' : total < 8000 ? 'calm' : 'eat';
}

// Animation clock, body color and CSS animation for a mood (both critters).
function useCritter(mood) {
  const [t, setT] = useState(performance.now());
  useEffect(() => {
    const iv = setInterval(() => setT(performance.now()), mood === 'eat' || mood === 'sleep' ? 70 : 1000);
    return () => clearInterval(iv);
  }, [mood]);
  const body = mood === 'panic' ? C.danger : C.clay;
  const anim = mood === 'panic' ? 'mShake 0.14s linear infinite' : mood === 'eat' ? 'mBob 0.55s ease-in-out infinite' : mood === 'calm' ? 'mBob 1.8s ease-in-out infinite' : 'mBob 3.6s ease-in-out infinite';
  return { t, rows: critterRows(mood, t / 1000, MASCOT), body, anim };
}

// Dashboard critter, drawn with block characters like the design.
function Critter({ mood }) {
  const { t, rows, body, anim } = useCritter(mood);
  return (
    <div style={{ position: 'relative', fontSize: 12, lineHeight: '12px', animation: anim }}>
      {rows.map((r, y) => (
        <div key={y} style={{ whiteSpace: 'pre', height: 12 }}>
          {r.split('').map((c, x) => <span key={x} style={{ color: c === 's' ? C.sweat : body }}>{c === 'X' || c === 's' ? '██' : '  '}</span>)}
        </div>
      ))}
      {mood === 'sleep' && <div style={{ position: 'absolute', right: -28, top: -18, color: C.muted, opacity: 0.4 + 0.6 * Math.abs(Math.sin(t / 900)) }}>z Z</div>}
    </div>
  );
}

// Mascot rows as square pixels: body cells in `color`, the sweat drop in
// `sweat`, everything else see-through.
function MascotPixels({ rows, color, sweat = 'transparent', px, style }) {
  return (
    <div style={{ flex: 'none', display: 'grid', gridTemplateColumns: `repeat(${W}, ${px}px)`, gridAutoRows: `${px}px`, ...style }}>
      {rows.flatMap((r, y) => r.split('').map((c, x) => (
        <span key={y * W + x} style={{ background: c === 'X' ? color : c === 's' ? sweat : 'transparent' }} />
      )))}
    </div>
  );
}

// Same critter drawn as square pixels; crisp at small sizes (mini widget).
function PixelCritter({ mood, px = 4 }) {
  const { rows, body, anim } = useCritter(mood);
  return <MascotPixels rows={rows} color={body} sweat={C.sweat} px={px} style={{ animation: anim }} />;
}

// Props that make a clickable element usable from the keyboard: Tab reaches
// it, Enter or Space acts like a click (once per press: a held key repeats
// nothing). Without onClick (disabled) it is skipped by Tab.
// tabIndex: -1 for the radios of a group other than the picked one (radioKeys).
function pressable(onClick, tabIndex = 0) {
  if (!onClick) return { tabIndex: -1 };
  return {
    tabIndex, onClick,
    onKeyDown: e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); // Space would scroll the page
      if (!e.repeat) onClick();
    }
  };
}

// A radiogroup's arrow keys (ARIA pattern, put on the group): move to the
// next / previous radio and pick it; Home and End go to the ends. Only the
// picked radio is in the Tab order, so Tab leaves the group in one step.
function radioKeys(e) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  const radios = [...e.currentTarget.querySelectorAll('[role=radio]:not([aria-disabled=true])')];
  const i = radios.indexOf(document.activeElement);
  if (i < 0) return;
  e.preventDefault();
  const next = radios[e.key === 'Home' ? 0 : e.key === 'End' ? radios.length - 1 : (i + step + radios.length) % radios.length];
  next.focus();
  if (e.repeat) return; // holding an arrow moves the focus; the pick waits for the last press
  next.click();
}

// ── building blocks ────────────────────────────────────────────────────────
const Panel = ({ title, style, pad: p = '18px 16px 12px', gap = 4, children }) => (
  <div className="panel" style={{ padding: p, gap, ...style }}>
    <span className="legend">{title}</span>
    {children}
  </div>
);
const M = ({ children, c = C.muted, style }) => <span style={{ color: c, ...style }}>{children}</span>;

// ── derived view models ────────────────────────────────────────────────────
function limitRow(l, now, prec) {
  const p = l.est, v = l.v, r = l.resetsAt ? Math.max(0, (l.resetsAt - now) / 1000) : null;
  const str = p.toFixed(prec);
  const seg = Math.min(99.9, Math.floor(p * 10) / 10), frac = (p - seg) / 0.1;
  const resetAt = r == null ? '' : `(${when(Math.max(now, l.resetsAt), now)})`;
  let forecast, fcColor;
  if (r == null) { forecast = '· window not started'; fcColor = C.muted; }
  else if (p >= 100) { forecast = '✗ limit exhausted'; fcColor = C.danger; }
  else if (!burning(l)) { forecast = '· nothing burning'; fcColor = C.muted; }
  else {
    const rem = runoutBeforeReset(l, now);
    if (rem != null) { forecast = `✗ runs out in ${fmtDur(rem)}`; fcColor = C.danger; }
    else { forecast = `✓ fits · ~${Math.min(100, p + v * r).toFixed(1)}% at reset`; fcColor = C.ok; }
  }
  const a = ascii(p / 100, 50), lb = ascii(frac, 50);
  return {
    key: l.key, kind: l.kind, provider: l.provider, estimated: l.estimated, tname: l.name, pctMain: str.slice(0, -1), pctTail: str.slice(-1), barColor: p >= 90 ? C.danger : C.clay,
    aFill: a.fill, aEmpty: a.empty, lFill: lb.fill, lEmpty: lb.empty, segStart: seg.toFixed(3) + '…',
    resetIn: r == null ? '—' : fmtDur(r), resetAt, forecast, fcColor, habit: habitNote(l, now)
  };
}

// Forecast from habits (weekly / monthly limits), as one short note.
function habitNote(l, now) {
  const h = l.habit;
  if (!h) return null;
  if (h.notEnough) return { text: `usual pace: needs a week of history (${Math.floor(h.days)} d so far)`, color: C.dim };
  if (h.runsOutAt != null) return { text: `usual pace: runs out ${when(h.runsOutAt, now)}`, color: C.danger };
  return { text: `usual pace: ~${h.atReset.toFixed(1)}% at reset`, color: h.atReset >= 90 ? C.warn : C.ok };
}

function budgetRow(l, now, prec) {
  const r = l.resetsAt ? Math.max(0, (l.resetsAt - now) / 1000) : 7 * 86400;
  const WEEK = l.windowSec;
  const secToday = (now - startOfDay(now)) / 1000;
  const daysLeft = Math.max(0.01, (r + secToday) / 86400);
  const used = l.est, today = l.today || 0;
  const perDay = Math.max(0.01, (100 - Math.max(0, used - today)) / daysLeft), ratio = today / perDay;
  const vph = (l.v || 0) * 3600, leftToday = perDay - today;
  const status = ratio > 1 ? '✗ over today\'s budget' : ratio > 0.8 ? '~ close to today\'s budget' : '✓ within budget';
  const statusColor = ratio > 1 ? C.danger : ratio > 0.8 ? C.warn : C.ok;
  const paceNote = vph < 1e-6 ? 'idle right now' : leftToday <= 0 ? `burning ${vph.toFixed(2)}%/h · today's budget is gone` : `burning ${vph.toFixed(2)}%/h · today's budget lasts ${fmtDur(leftToday / vph * 3600)}`;
  const ideal = (WEEK - r) / WEEK * 100, diff = used - ideal;
  return {
    key: l.key, provider: l.provider,
    name: l.provider === 'claude' ? (l.name === 'weekly' ? 'all models' : l.name.replace(/^weekly /, '')) : l.name,
    used: used.toFixed(prec) + '%', left: (100 - used).toFixed(prec) + '%', reset: fmtDur(r),
    perDay: perDay.toFixed(2) + '%', today: today.toFixed(prec) + '%', w: Math.min(100, ratio * 100) + '%',
    barColor: ratio > 1 ? C.danger : C.clay, status, statusColor, paceNote,
    lineNote: (diff <= 0 ? '▼ ' : '▲ ') + Math.abs(diff).toFixed(1) + ' pp ' + (diff <= 0 ? 'below' : 'above') + ' the even-pace line',
    lineColor: diff <= 0 ? C.ok : C.danger
  };
}

// ── app ────────────────────────────────────────────────────────────────────
function App() {
  const [snap, setSnap] = useState(null);
  const [history, setHistory] = useState(null);
  const [view, setView] = useState('live');
  const [prec, setPrec] = useState(() => store.get('prec', 3));
  const [lupa, setLupa] = useState(() => store.get('lupa', true));
  const [win, setWin] = useState({ onTop: false, maximized: false });
  const [settings, setSettings] = useState(null);
  const [selected, setSelected] = useState(null); // sid shown in the session details panel
  const [editing, setEditing] = useState(false);  // layout edit mode (live / history)
  const editingRef = useRef(false);
  editingRef.current = editing;
  const viewRef = useRef(view);
  viewRef.current = view;
  // Layouts changed here and not yet confirmed by main (settings echo), so a
  // late reply to an earlier change can't flip the view back for a moment.
  const [localLayouts, setLocalLayouts] = useState({});
  useEffect(() => { if (view === 'settings') setEditing(false); }, [view]); // also when opened from the tray
  const settingsRef = useRef(null); // latest settings for key handlers registered once
  settingsRef.current = settings;
  const toggleCacheReads = () => { const s = settingsRef.current; if (s) window.tm.setSetting('countCacheReads', !s.countCacheReads); };

  useEffect(() => {
    window.tm.onSnapshot(setSnap);
    window.tm.onHistory(setHistory);
    window.tm.onWinState(setWin);
    // the skin is applied before React renders with the new settings
    const receive = s => { if (s) applyTheme(s.theme, s.mascot); setSettings(s); };
    window.tm.onSettings(receive);
    window.tm.onGoto(setView);
    window.tm.getSettings().then(receive);
  }, []);
  useEffect(() => store.set('prec', prec), [prec]);
  useEffect(() => store.set('lupa', lupa), [lupa]);

  const cyclePrec = () => setPrec(p => (p >= 4 ? 2 : p + 1));
  const toggleLupa = () => setLupa(x => !x);
  useEffect(() => {
    const onKey = e => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'Escape') { if (editingRef.current) setEditing(false); else setSelected(null); return; }
      const k = e.key.toLowerCase();
      if (k === '1') setView('live');
      else if (k === '2') setView('hist');
      else if (k === '3' || k === 's') { setView('settings'); setEditing(false); }
      else if (k === 'e' && viewRef.current !== 'settings') setEditing(x => !x);
      else if (k === 'p') cyclePrec();
      else if (k === 'l') toggleLupa();
      else if (k === 't') window.tm.win('ontop');
      else if (k === 'r') window.tm.refresh();
      else if (k === 'm') window.tm.mini('toggle');
      else if (k === 'c') toggleCacheReads();
      else if (k === 'u' && settingsRef.current && settingsRef.current.update && updateWaiting(settingsRef.current.update)) window.tm.installUpdate();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The saved layout of a view (or the default until settings arrive); a change
  // shows at once and is saved (and validated) by main.
  const savedLayout = v => (settings && settings.layout && settings.layout[v]) || defaultLayout(v);
  const layoutOf = v => localLayouts[v] || savedLayout(v);
  const saveLayout = (v, l) => {
    setLocalLayouts(m => ({ ...m, [v]: l }));
    window.tm.setSetting('layout:' + v, l);
  };
  useEffect(() => { // main confirmed: drop the local copies it now matches
    setLocalLayouts(m => {
      const left = Object.fromEntries(Object.entries(m).filter(([v, l]) => JSON.stringify(normalizeLayout(l, v)) !== JSON.stringify(savedLayout(v))));
      return Object.keys(left).length === Object.keys(m).length ? m : left;
    });
  }, [settings]);
  const now = snap ? snap.now : Date.now();
  const total = snap ? snap.burn.rate : 0;
  const sessions = snap ? snap.sessions : [];
  const isActive = s => s.rate > 0 || now - s.lastTs < 90e3;
  const activeCount = sessions.filter(isActive).length;

  return (
    <div className="root">
      <TitleBar win={win} />
      <div className="content">
        <Header snap={snap} prec={prec} now={now} />
        {view === 'settings'
          ? <Settings s={settings} prec={prec} setPrec={setPrec} lupa={lupa} toggleLupa={toggleLupa} onEditLayout={v => { setView(v); setEditing(true); }} />
          : !snap || !snap.ready
            ? <div style={{ color: C.muted, padding: '40px 0' }}>reading ~/.claude/projects …</div>
            : <LayoutView key={view} view={view} layout={layoutOf(view)} defs={view === 'live' ? LIVE_PANELS : HIST_PANELS}
                  ctx={{ snap, prec, lupa, now, isActive, selected, onSelect: setSelected, history }} edit={editing}
                  onChange={l => saveLayout(view, l)} onDone={() => setEditing(false)} />}
      </div>
      <div className="statusbar">
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span className="key" onClick={() => setView('live')} style={{ fontWeight: view === 'live' ? 700 : 400 }}>[1] live</span>
          <span className="key" onClick={() => setView('hist')} style={{ fontWeight: view === 'hist' ? 700 : 400 }}>[2] history</span>
          <span className="key" onClick={() => { setView('settings'); setEditing(false); }} style={{ fontWeight: view === 'settings' ? 700 : 400 }}>[3] settings</span>
          {view !== 'settings' && <span className="key" onClick={() => setEditing(x => !x)} style={{ fontWeight: editing ? 700 : 400 }}>[e] {editing ? 'editing layout' : 'layout'}</span>}
          <span className="key" onClick={cyclePrec}>[p] precision</span>
          <span className="key" onClick={toggleLupa}>[l] zoom</span>
          <span className="key" onClick={() => window.tm.win('ontop')} style={{ fontWeight: win.onTop ? 700 : 400 }}>[t] on top</span>
          <span className="key" onClick={() => window.tm.refresh()}>[r] refresh</span>
          <span className="key" onClick={() => window.tm.mini('toggle')}>[m] mini</span>
          <span className="key" onClick={toggleCacheReads} style={{ fontWeight: settings && !settings.countCacheReads ? 700 : 400 }} title="count cache reads in token numbers">[c] {settings && !settings.countCacheReads ? 'no cache reads' : 'cache reads'}</span>
        </div>
        <span>
          {settings && settings.update && updateWaiting(settings.update) && <span className="key" style={{ fontWeight: 700, marginRight: 16 }} onClick={() => window.tm.installUpdate()}>[u] update to v{settings.update.latest}</span>}
          {settings && settings.update && settings.update.status === 'downloading' && <span style={{ marginRight: 16 }} title="downloading the update">↓ v{settings.update.latest} {settings.update.progress}%</span>}
          {activeCount} active · {fmtInt(total)} tok/s
        </span>
      </div>
    </div>
  );
}

const EXPORT_RANGES = [['week', 'this calendar week'], ['month', 'this calendar month'], ['all', 'all retained records']];
const EXPORT_FORMATS = [['csv', 'csv'], ['json', 'json']];

function ExportChoices({ label, options, value, onSelect, disabled }) {
  return (
    <div className="export-choices" role="radiogroup" aria-label={label} onKeyDown={radioKeys}>
      <M>{label}: </M>
      {options.map(([id, text]) => (
        <span key={id} className={'opt link' + (disabled ? ' off' : '')}
          role="radio" aria-checked={id === value} aria-disabled={disabled}
          {...pressable(disabled ? null : () => onSelect(id), id === value ? 0 : -1)}>
          [{text}]
        </span>
      ))}
    </div>
  );
}

function UsageExport() {
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState('week');
  const [format, setFormat] = useState('csv');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  const save = async () => {
    setSaving(true);
    setStatus('');
    try {
      const result = await window.tm.exportUsage(range, format);
      if (result === 'saved') setStatus('Usage exported');
      else if (result === 'error') setStatus('Could not save the usage export');
    } catch {
      setStatus('Could not save the usage export');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel title="usage export">
      <div className="usage-export" onKeyDown={event => { if (event.defaultPrevented) event.stopPropagation(); }}>
        <span className="opt link" role="button" aria-expanded={open} aria-controls="usage-export-options"
          {...pressable(() => setOpen(value => !value))}>[ export ]</span>
        <div id="usage-export-options" className="usage-export-options" hidden={!open}>
          <ExportChoices label="range" options={EXPORT_RANGES} value={range} onSelect={setRange} disabled={saving} />
          <ExportChoices label="format" options={EXPORT_FORMATS} value={format} onSelect={setFormat} disabled={saving} />
          <span className={'opt link' + (saving ? ' off' : '')} role="button" aria-disabled={saving}
            {...pressable(saving ? null : save)}>[ save ]</span>
          <span role="status">{status}</span>
        </div>
      </div>
    </Panel>
  );
}

function TitleBar({ win }) {
  return (
    <div className="titlebar">
      <div style={{ display: 'flex', gap: 2, alignItems: 'center', height: '100%', paddingTop: 6 }}>
        <span className="tab">tokenmuncher — pwsh{win.onTop ? '  ·  on top' : ''}</span>
        <span style={{ padding: '6px 10px' }}>+</span>
      </div>
      <div className="winbtns">
        <span className="wb" onClick={() => window.tm.win('min')}>—</span>
        <span className="wb" onClick={() => window.tm.win('max')}>{win.maximized ? '❐' : '▢'}</span>
        <span className="wb close" onClick={() => window.tm.win('close')}>✕</span>
      </div>
    </div>
  );
}

function Header({ snap, prec, now }) {
  const provs = snap ? snap.providers : [];
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
      <span>
        <span style={{ color: C.clay }}>▚ tokenmuncher</span>{' '}
        <M>{VERSION} · </M>
        {provs.map(p => (
          <span key={p.id} title={p.error || (p.fetchedAt ? `synced ${Math.round((now - p.fetchedAt) / 1000)} s ago` : 'loading…')}>
            <span style={{ color: p.error ? C.danger : provColor(p.id) }}>{p.label}</span>
            <M> {p.plan ? p.plan.name : '…'}{p.error ? ' ✗' : ''} · </M>
          </span>
        ))}
        <M>live 1 s · precision {'0.' + '0'.repeat(prec - 1) + '1'}% est</M>
      </span>
      <M>{hhmmss(now)}</M>
    </div>
  );
}

// ── live view: one component per panel (placed by the layout, see LIVE_PANELS) ──
function CritterPanel({ snap }) {
  const total = snap.burn.rate;
  const top = snap.limits.slice().sort((a, b) => b.est - a.est)[0];
  const maxPct = top ? top.est : 0;
  const mood = moodOf(snap);
  const busiest = snap.sessions[0];
  const speech = {
    sleep: 'zzz… nothing burning right now.',
    calm: `chill. ${busiest ? busiest.project : 'someone'} is nibbling.`,
    eat: `nom nom! ${busiest ? busiest.project : '?'} is burning ${fmtInt(busiest ? busiest.rate : 0)} tok/s on ${busiest ? busiest.model : '?'}.`,
    panic: top && total < 1
      ? `phew… ${top.name}: ${top.est.toFixed(2)}%. hold on until reset.`
      : `whoa! ${top ? top.name : ''}: ${maxPct.toFixed(2)}%. slow down.`
  }[mood];
  const maxSpark = Math.max(1000, ...snap.burn.spark);
  const sparkText = snap.burn.spark.map(v => SPK[Math.min(7, Math.floor(v / maxSpark * 8))]).join('');
  return (
    <Panel title="critter" pad="20px 16px 14px" gap={12}>
      <div style={{ height: 150, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Critter mood={mood} /></div>
      <div>
        <span style={{ color: MOOD_COLOR[mood] }}>[{MOOD_LABEL[mood]}]</span>{' '}
        <span>{speech}</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: `1px dashed ${C.rule}`, paddingTop: 10 }}>
        <span><M>burn rate </M><span style={{ fontSize: 18, color: C.hi }}>{fmtInt(total)}</span><M> tok/s</M></span>
        <span className="bar" style={{ color: C.clay }}>{sparkText}</span>
        <span style={{ color: C.dim, display: 'flex', justifyContent: 'space-between' }}><span>−{Math.round(snap.burn.sparkSpanSec / 60)} min</span><span>now</span></span>
      </div>
    </Panel>
  );
}

function LimitsPanel({ snap, prec, lupa, now }) {
  const limits = snap.limits.map(l => limitRow(l, now, prec));
  return (
    <Panel title="limits" pad="20px 16px 12px" gap={14}>
      {!snap.providers.length && <M>no supported tools found</M>}
      {snap.providers.map(p => {
        const rows = limits.filter(l => l.provider === p.id);
        return (
          <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ borderBottom: `1px dashed ${C.rule}`, paddingBottom: 2 }}>
              <span style={{ color: provColor(p.id) }}>■ {p.label}</span>
              <M> · {p.plan ? p.plan.name + ' plan' : '…'}</M>
              {p.error && <M c={C.danger}> · {p.error}</M>}
              {p.fetchedAt > 0 && now - p.fetchedAt > STALE_MS && <M c={C.warn}> · synced {fmtAgo(now - p.fetchedAt)} ago</M>}
              {!p.error && !rows.length && <M> · {p.fetchedAt ? 'no limits reported yet' : 'loading…'}</M>}
            </div>
            {rows.map(l => <LimitRow key={l.key} l={l} lupa={lupa} breakdown={l.key === 'claude:weekly_all' ? snap.breakdown : null} />)}
          </div>
        );
      })}
    </Panel>
  );
}

function ApiPanel({ snap, now }) {
  const plansTotal = snap.providers.reduce((a, p) => a + (p.plan && p.plan.price ? p.plan.price : 0), 0);
  return (
    <Panel title="API equivalent">
      <span style={{ fontSize: 24, color: C.hi }}>${snap.api.today.toFixed(4)}</span>
      <M style={{ marginBottom: 6 }}>today, if you paid per token</M>
      <div className="kv"><M>{MONTHS[new Date(now).getMonth()]}</M><span>${snap.api.month.toFixed(2)}</span></div>
      {Object.entries(snap.api.byProvider).sort((a, b) => b[1] - a[1]).map(([id, v]) => (
        <div key={id} className="kv"><span style={{ color: provColor(id), paddingLeft: 12 }}>└ {id}</span><span>${v.toFixed(2)}</span></div>
      ))}
      <div className="kv"><M>plans / month</M><span>${plansTotal.toFixed(2)}</span></div>
      <div className="kv"><M>plan payback</M><span style={{ color: C.ok }}>{plansTotal ? '×' + (snap.api.month / plansTotal).toFixed(1) : '—'}</span></div>
    </Panel>
  );
}

// The busiest 5h-type limit's timeline.
const TimelinePanel = ({ snap, now }) => <Timeline l={snap.limits.filter(l => l.kind === 'session').sort((a, b) => b.est - a.est)[0]} now={now} />;

// The session table, and the details of the selected session right under it.
const SessionsPanel = ({ snap, prec, isActive, selected, onSelect }) => (
  <>
    <Sessions snap={snap} prec={prec} isActive={isActive} selected={selected} onSelect={onSelect} />
    {selected && <SessionDetails sid={selected} prec={prec} onClose={() => onSelect(null)} />}
  </>
);

// name: shown in the layout editor; min: the width (px) a panel starts to wrap
// at; max (optional): the widest it gets.
const LIVE_PANELS = {
  critter: { name: 'critter', min: 280, max: 360, render: c => <CritterPanel {...c} /> },
  limits: { name: 'limits', min: 560, render: c => <LimitsPanel {...c} /> },
  budget: { name: 'budget', min: 560, render: c => <Budget snap={c.snap} prec={c.prec} now={c.now} /> },
  timeline: { name: '5h timeline', min: 560, render: c => <TimelinePanel {...c} /> },
  api: { name: 'API equivalent', min: 280, render: c => <ApiPanel {...c} /> },
  sessions: { name: 'sessions', min: 560, render: c => <SessionsPanel {...c} /> },
  context: { name: 'session context', min: 300, render: c => <Context snap={c.snap} /> },
  types: { name: 'tokens by type', min: 300, render: c => <Types snap={c.snap} /> },
  models: { name: 'models today', min: 300, render: c => <Models snap={c.snap} /> },
  heat: { name: 'when you burn', min: 460, render: c => <Heat snap={c.snap} now={c.now} /> },
  log: { name: 'log', min: 520, render: c => <Log snap={c.snap} /> }
};

function LimitRow({ l, lupa, breakdown }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="lgrid">
        <span>{l.tname}</span>
        <span className="bar"><span style={{ color: l.barColor }}>{l.aFill}</span><span style={{ color: C.empty }}>{l.aEmpty}</span></span>
        <span style={{ textAlign: 'right', color: C.hi }}>{l.pctMain}<span style={{ color: C.clay }}>{l.pctTail}</span>%</span>
      </div>
      {lupa && l.estimated && (
        <div className="lgrid" style={{ color: C.muted }}>
          <span>  zoom ×1000</span>
          <span className="bar"><span style={{ color: accentMix(75) }}>{l.lFill}</span><span style={{ color: C.track }}>{l.lEmpty}</span></span>
          <span style={{ textAlign: 'right' }}>{l.segStart}</span>
        </div>
      )}
      <div style={{ color: C.muted, paddingLeft: 12 }}>└ resets in <span style={{ color: C.fg }}>{l.resetIn}</span> {l.resetAt} · <span style={{ color: l.fcColor }}>{l.forecast}</span>{l.habit && <> · <span style={{ color: l.habit.color }}>{l.habit.text}</span></>}</div>
      {breakdown && breakdown.length > 0 && (
        <div style={{ color: C.muted, paddingLeft: 12 }}>  by app · {breakdown.map((b, i) => <span key={b.name}>{i ? ' · ' : ''}{b.name.toLowerCase()} <span style={{ color: C.fg }}>{b.percent}%</span></span>)}</div>
      )}
    </div>
  );
}

function Budget({ snap, prec, now }) {
  const long = snap.limits.filter(l => l.kind !== 'session' && l.today != null);
  if (!long.length) return null;
  const budget = long.map(l => budgetRow(l, now, prec));
  return (
    <Panel title="budget · how much you can burn per day" pad="20px 16px 14px" gap={16}>
      {budget.map(b => (
        <div key={b.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '6px 16px', flexWrap: 'wrap' }}>
            <span><span style={{ color: provColor(b.provider) }}>{b.provider} · </span><span style={{ color: C.hi }}>{b.name}</span><M> · used </M>{b.used}<M> · left </M>{b.left}<M> · resets in </M>{b.reset}</span>
            <span><M>budget </M><span style={{ fontSize: 18, color: C.clay }}>{b.perDay}</span><M> / day</M></span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '60px minmax(0,1fr) auto', gap: 12, alignItems: 'center' }}>
            <M>today</M>
            <div style={{ position: 'relative', height: 12, background: `repeating-linear-gradient(90deg,${C.track} 0 7px,transparent 7px 9px)` }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: b.w, background: `repeating-linear-gradient(90deg,${b.barColor} 0 7px,transparent 7px 9px)` }} />
            </div>
            <span style={{ whiteSpace: 'nowrap' }}><span style={{ color: b.barColor }}>{b.today}</span><M> / {b.perDay}</M></span>
          </div>
          <div style={{ paddingLeft: 12, display: 'flex', gap: '4px 18px', flexWrap: 'wrap', color: C.muted }}>
            <span style={{ color: b.statusColor }}>{b.status}</span>
            <span>{b.paceNote}</span>
            <span style={{ color: b.lineColor }}>{b.lineNote}</span>
          </div>
        </div>
      ))}
    </Panel>
  );
}

function Timeline({ l, now }) {
  let body;
  if (!l || !l.resetsAt) {
    body = <M>no active 5h window · it starts with your next message</M>;
  } else {
    const WIN = l.windowSec, r = Math.max(0, (l.resetsAt - now) / 1000), el = Math.max(0, WIN - r);
    const p = l.est, v = l.v || 0;
    const rem = secondsToFull(l);
    let hitText = '✓ you\'ll make it to reset', hitColor = C.ok, hit = false;
    if (p >= 100) { hitText = '✗ limit reached'; hitColor = C.danger; }
    else if (runoutBeforeReset(l, now) != null) {
      hit = true;
      hitText = `✗ limit ${when(now + rem * 1000, now)}, ${fmtDur(r - rem)} before reset`; hitColor = C.danger;
    }
    const pace = v * 3600, need = (100 - p) / Math.max(0.01, r / 3600);
    const pastW = (el / WIN * 100) + '%';
    const hitLeft = (Math.min(1, (el + Math.min(rem, r)) / WIN) * 100) + '%';
    body = (
      <>
        <div style={{ display: 'grid', gridTemplateColumns: '50px minmax(0,1fr) 50px', gap: 10, whiteSpace: 'pre' }}>
          <M>{hhmm(now - el * 1000)}</M>
          <div style={{ position: 'relative', height: 20, margin: '0 6px' }}>
            <div style={{ position: 'absolute', left: 0, top: 9, width: pastW, borderTop: `2px solid ${C.clay}` }} />
            <div style={{ position: 'absolute', right: 0, top: 10, left: pastW, borderTop: `1px dashed ${C.dim}` }} />
            <span style={{ position: 'absolute', top: 0, left: pastW, transform: 'translateX(-50%)', lineHeight: '20px', color: C.hi }}>●</span>
            {hit && <span style={{ position: 'absolute', top: 0, left: hitLeft, transform: 'translateX(-50%)', lineHeight: '20px', color: C.danger, background: C.bg, padding: '0 2px' }}>✗</span>}
          </div>
          <M style={{ textAlign: 'right' }}>{hhmm(l.resetsAt)}</M>
        </div>
        <div style={{ display: 'flex', gap: '6px 24px', flexWrap: 'wrap', color: C.muted }}>
          <span>elapsed <span style={{ color: C.fg }}>{fmtDur(el)}</span></span>
          <span>even pace <span style={{ color: C.fg }}>{(100 / (WIN / 3600)).toFixed(1)}%/h</span></span>
          <span>your pace <span style={{ color: pace > need ? C.danger : C.ok }}>{pace.toFixed(1)}%/h</span></span>
          <span style={{ color: hitColor }}>{hitText}</span>
        </div>
      </>
    );
  }
  return <Panel title={l ? `${l.provider} · ${l.name} · timeline` : '5h window · timeline'} gap={8}>{body}</Panel>;
}

function Sessions({ snap, prec, isActive, selected, onSelect }) {
  const maxRate = Math.max(1, ...snap.sessions.map(s => s.rate));
  return (
    <Panel title="sessions · last 5h · click one for details" pad="16px 16px 10px">
      <div>
        <div className="sgrid sess" style={{ color: C.dim }}>
          <span /><span>project</span><span className="c-app">app</span><span className="c-model">model</span><span>tok/s</span><span style={{ textAlign: 'right' }}>last 5h</span><span style={{ textAlign: 'right' }}>limit share</span>
        </div>
        {!snap.sessions.length && <M>no Claude Code activity in this window</M>}
        {snap.sessions.map(s => {
          const active = isActive(s), mc = famColor(s.fam);
          return (
            <div key={s.sid} className={'sgrid sess pick' + (s.sid === selected ? ' picked' : '')} style={{ opacity: active || s.sid === selected ? 1 : 0.55 }} title={s.lastAction}
              onClick={() => onSelect(s.sid === selected ? null : s.sid)}>
              <span style={{ color: active ? C.ok : C.dim }}>{active ? '●' : '○'}</span>
              <span className="ell">{s.project}</span>
              <span className="ell c-app" style={{ color: provColor(s.provider) }}>{s.app}</span>
              <span className="ell c-model" style={{ color: mc }}>{s.model}</span>
              <span className="barcell"><span className="bar" style={{ color: mc }}>{ascii(s.rate / maxRate, 16).fill}</span><span>{s.rate > 0 ? fmtInt(s.rate) : '—'}</span></span>
              <span style={{ textAlign: 'right' }}>{fmtTok(s.tokens)}</span>
              <span style={{ textAlign: 'right', color: C.clay }} title={s.shareOf ? 'share of ' + s.provider + ' ' + s.shareOf : ''}>{s.share != null ? s.share.toFixed(prec) + '%' : '—'}</span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function Context({ snap }) {
  const list = snap.sessions.filter(s => s.ctx > 0 && s.ctxMax > 0).sort((a, b) => b.ctx / b.ctxMax - a.ctx / a.ctxMax).slice(0, 5);
  return (
    <Panel title="session context">
      {!list.length && <M>—</M>}
      {list.map(s => {
        const f = s.ctx / s.ctxMax, b = ascii(f, 20);
        return (
          <div key={s.sid} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto 50px', gap: 10, whiteSpace: 'pre' }}>
            <span className="ell" style={{ color: provColor(s.provider) }}>{s.project}</span>
            <span><span style={{ color: f > 0.8 ? C.danger : f > 0.6 ? C.warn : C.ok }}>{b.fill}</span><span style={{ color: C.empty }}>{b.empty}</span></span>
            <span style={{ textAlign: 'right' }} title={'of ' + Math.round(s.ctxMax / 1e3) + 'k'}>{Math.round(s.ctx / 1e3)}k</span>
          </div>
        );
      })}
      <M c={C.dim} style={{ marginTop: 6 }}>bar = share of each session's context window</M>
    </Panel>
  );
}

function Types({ snap }) {
  const T = snap.types, tl = [['cache read', T.cr], ['input', T.in], ['cache write', T.cw], ['output', T.out]];
  const tMax = Math.max(1, ...tl.map(x => x[1]));
  const denom = T.cr + T.in + T.cw;
  return (
    <Panel title="today's tokens by type">
      {tl.map(([name, v]) => (
        <div key={name} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr) 70px', gap: 10, whiteSpace: 'pre' }}>
          <span>{name}</span><span className="bar" style={{ color: C.teal }}>{ascii(v / tMax, 18).fill}</span><span style={{ textAlign: 'right' }}>{fmtTok(v)}</span>
        </div>
      ))}
      <M style={{ marginTop: 6 }}>cache hit rate <span style={{ color: C.clay }}>{denom ? (T.cr / denom * 100).toFixed(1) + '%' : '—'}</span></M>
    </Panel>
  );
}

function Models({ snap }) {
  const ms = snap.models, tot = ms.reduce((a, m) => a + m.tokens, 0);
  let used = 0;
  const bars = ms.map((m, i) => {
    const n = i === ms.length - 1 ? 34 - used : Math.round(m.tokens / tot * 34);
    used += n;
    return { ...m, bar: '█'.repeat(Math.max(0, n)) };
  });
  return (
    <Panel title={`models today · ${fmtTok(tot)}`}>
      <span className="bar" style={{ marginBottom: 6 }}>
        {tot ? bars.map(m => <span key={m.name} style={{ color: famColor(m.fam) }}>{m.bar}</span>) : <span style={{ color: C.empty }}>{'░'.repeat(34)}</span>}
      </span>
      {bars.map(m => (
        <div key={m.name} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,1fr) 60px 80px', gap: 8 }}>
          <span style={{ color: famColor(m.fam) }}>■</span><span>{m.name}</span>
          <M style={{ textAlign: 'right' }}>{tot ? (m.tokens / tot * 100).toFixed(1) + '%' : '—'}</M><span style={{ textAlign: 'right' }}>{fmtTok(m.tokens)}</span>
        </div>
      ))}
      {!tot && <M>nothing yet today</M>}
    </Panel>
  );
}

function Heat({ snap, now }) {
  const d = new Date(now), dow = (d.getDay() + 6) % 7, hr = d.getHours();
  const HC = [C.empty, accentMix(45), accentMix(65), accentMix(82), C.clay];
  const CH = '·░▒▓█';
  const max = Math.max(0, ...snap.heat.flat());
  const lvl = v => (v <= 0 || !max ? 0 : Math.max(1, Math.min(4, Math.ceil(Math.sqrt(v / max) * 4))));
  let peak = null;
  snap.heat.forEach((row, di) => row.forEach((v, h) => { if (v > 0 && (!peak || v > peak.v)) peak = { v, di, h }; }));
  const names = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  return (
    <Panel title="when you burn · this week × 24 h" gap={0}>
      <div style={{ overflowX: 'auto', display: 'flex', flexDirection: 'column' }}>
        <div style={{ whiteSpace: 'pre', color: C.dim, paddingLeft: 40 }}>{'0'.padEnd(12) + '6'.padEnd(12) + '12'.padEnd(12) + '18'.padEnd(10) + '23'}</div>
        {names.map((label, di) => (
          <div key={label} style={{ display: 'flex', whiteSpace: 'pre' }}>
            <span style={{ width: 40, flexShrink: 0, color: di === dow ? C.clay : C.muted }}>{label}</span>
            {snap.heat[di].map((v, h) => {
              if (di > dow || (di === dow && h > hr)) return <span key={h}>{'  '}</span>;
              const lv = lvl(v);
              const cur = di === dow && h === hr;
              return <span key={h} style={{ color: HC[lv], background: cur ? C.pick : 'transparent' }}>{CH[lv] + ' '}</span>;
            })}
          </div>
        ))}
        <span style={{ color: C.dim, marginTop: 6, whiteSpace: 'pre' }}>less · ░ ▒ ▓ █ more   peak: {peak ? `${names[peak.di]} ${pad(peak.h)}:00` : '—'}</span>
      </div>
    </Panel>
  );
}

function Log({ snap }) {
  return (
    <Panel title="log" pad="18px 16px 10px" gap={0}>
      {!snap.events.length && <M>no tool calls yet</M>}
      {snap.events.map((e, i) => (
        <div key={i + e.ts} style={{ display: 'grid', gridTemplateColumns: '80px 140px minmax(0,1fr) 80px', gap: 10, opacity: 1 - i * 0.09 }}>
          <M c={C.dim}>{hhmmss(e.ts)}</M>
          <span className="ell" style={{ color: provColor(e.provider) }}>{e.project}</span>
          <span className="ell">› {e.text}</span>
          <span style={{ textAlign: 'right', color: C.clay }}>{e.kind === 'tool' ? (e.tok > 0 ? '+' + fmtTok(e.tok) : '') : e.tok}</span>
        </div>
      ))}
    </Panel>
  );
}

// ── limit history (history view) ───────────────────────────────────────────
const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dayLabel = t => { const d = new Date(t); return `${DAYS[d.getDay()]} ${d.getDate()}`; };
const dateLabel = t => { const d = new Date(t); return `${MON[d.getMonth()]} ${d.getDate()}`; };

// Shrinks a series to n columns, keeping each column's highest value (null
// where the source slice hasn't happened yet). n is at most the series length.
function resample(series, n) {
  const m = series.length;
  return Array.from({ length: n }, (_, j) => {
    const a = Math.floor(j * m / n), b = Math.max(a + 1, Math.floor((j + 1) * m / n));
    if (series[a] == null) return null;
    let best = series[a];
    for (let i = a + 1; i < b; i++) if (series[i] != null && series[i] > best) best = series[i];
    return best;
  });
}

// Columns that fit the panel: one character each next to the 44 px axis.
function useChartColumns(ref) {
  const [cols, setCols] = useState(72);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const probe = document.createElement('span');
    probe.textContent = '0'.repeat(10);
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre';
    el.appendChild(probe);
    // Measured each time: Geist Mono may still be loading on the first pass.
    const update = () => {
      const ch = probe.getBoundingClientRect().width / 10 || 7.8;
      setCols(Math.max(34, Math.min(120, Math.floor((el.clientWidth - 44) / ch))));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    document.fonts.ready.then(update);
    return () => { ro.disconnect(); probe.remove(); };
  }, [ref]);
  return cols;
}

// Usage of the current 5h window over time as a block-character column chart.
// Columns above the even pace line are red.
function WindowChart({ s, now }) {
  const ref = useRef(null);
  const ROWS = 6, cols = Math.min(useChartColumns(ref), s.series.length);
  const series = resample(s.series, cols);
  const { start, end } = s.current;
  const nowIdx = Math.min(cols - 1, Math.floor((now - start) / (end - start) * cols));
  const rows = [];
  for (let row = 0; row < ROWS; row++) {
    rows.push(series.map((v, i) => {
      if (v == null) return { ch: row === ROWS - 1 ? '·' : ' ', c: C.empty };
      const lvl = Math.round(Math.min(100, v) / 100 * ROWS * 8) - (ROWS - 1 - row) * 8;
      const ch = lvl <= 0 ? ' ' : SPK[Math.min(8, lvl) - 1];
      return { ch, c: v > (i + 1) / cols * 100 ? C.danger : C.clay };
    }));
  }
  const yLabel = row => (row === 0 ? '100%' : row === Math.floor(ROWS / 2) ? '50%' : row === ROWS - 1 ? '0%' : '');
  return (
    <div ref={ref} style={{ overflow: 'hidden', position: 'relative' }}>
      {rows.map((cells, row) => (
        <div key={row} style={{ display: 'grid', gridTemplateColumns: '44px auto', whiteSpace: 'pre', lineHeight: '15px' }}>
          <M c={C.dim} style={{ textAlign: 'right', paddingRight: 6 }}>{yLabel(row)}</M>
          <span>{cells.map((x, i) => <span key={i} style={{ color: x.c }}>{x.ch}</span>)}</span>
        </div>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: '44px auto', whiteSpace: 'pre', marginTop: 4 }}>
        <span />
        <span style={{ position: 'relative', width: `${cols}ch`, display: 'block', color: C.dim }}>
          <span>{hhmm(start)}</span>
          {/* kept clear of the start and end labels */}
          <span style={{ position: 'absolute', left: `${Math.max(7, Math.min(cols - 17, nowIdx - 5))}ch`, color: C.fg }}>now {hhmm(now)}</span>
          <span style={{ position: 'absolute', right: 0 }}>{hhmm(end)}</span>
        </span>
      </div>
    </div>
  );
}

// ── history view: one component per panel (placed by the layout, see HIST_PANELS) ──
const fmtP = (p, measured) => (p == null ? '—' : `${p.toFixed(1)}%${measured ? ' ' : '~'}`);

// The current 5h-type window over time, one panel per such limit (usually one).
function WinChartPanels({ snap, history: h }) {
  if (!h || !h.sessions.length) return null;
  return h.sessions.map(s => (
    <Panel key={s.key} title={`${s.provider} · ${s.name} · usage over time`} pad="20px 16px 12px">
      {s.current && s.series ? <WindowChart s={s} now={snap.now} /> : <M>no active window · it starts with your next message</M>}
      <M c={C.dim} style={{ marginTop: 6 }}>red = above the even pace · rebuilt from local logs and server readings</M>
    </Panel>
  ));
}

// Past 5h-type windows of the last 7 days.
function WinListPanels({ history: h }) {
  if (!h || !h.sessions.length) return null;
  return h.sessions.map(s => (
    <Panel key={s.key} title={`${s.provider} · ${s.name}s · last 7 days`} pad="20px 16px 12px">
      {!s.windows.length && <M>no windows in the last 7 days</M>}
      {s.windows.slice(0, 10).map(w => (
        <div key={w.start} style={{ display: 'grid', gridTemplateColumns: '150px minmax(0,1fr) 70px 18px', gap: 8, whiteSpace: 'pre' }}>
          <span style={{ color: w.current ? C.clay : C.muted }}>{dayLabel(w.start)} {hhmm(w.start)}–{w.current ? 'now  ' : hhmm(w.end)}</span>
          <span className="bar"><span style={{ color: (w.pct || 0) >= 90 ? C.danger : C.clay }}>{ascii((w.pct || 0) / 100, 16).fill}</span><span style={{ color: C.empty }}>{ascii((w.pct || 0) / 100, 16).empty}</span></span>
          <span style={{ textAlign: 'right', color: C.hi }}>{fmtP(w.pct, w.measured)}</span>
          <span style={{ color: C.danger }}>{(w.pct || 0) >= 100 ? '✗' : ''}</span>
        </div>
      ))}
      <M c={C.dim} style={{ marginTop: 6 }}>~ estimated from local logs · others measured by the server</M>
    </Panel>
  ));
}

function WeeklyPanel({ snap, history: h }) {
  if (!h || !h.weeks.length) return null;
  const now = snap.now;
  return (
    <Panel title="weekly limits · last weeks" pad="20px 16px 12px" gap={10}>
      {h.weeks.map(wk => {
        const maxDay = Math.max(1, ...wk.rows.flatMap(r => r.daily || []));
        return (
          <div key={wk.key} style={{ display: 'flex', flexDirection: 'column' }}>
            <span><span style={{ color: provColor(wk.provider) }}>{wk.provider}</span> <span style={{ color: C.hi }}>{wk.name}</span><M>  · per 24 h from the reset{wk.rows[0] ? ` (${DAYS[new Date(wk.rows[0].start).getDay()]} → ${DAYS[new Date(wk.rows[0].start + 6 * 86400e3).getDay()]})` : ''}</M></span>
            {wk.rows.map(r => {
              const days = (r.daily || []).map((v, i) => (r.current && r.start + i * 86400e3 > now ? ' ' : SPK[Math.min(7, Math.floor(v / maxDay * 7.99))])).join('');
              return (
                <div key={r.start} style={{ display: 'grid', gridTemplateColumns: '150px 70px minmax(0,1fr) 70px 90px', gap: 10, whiteSpace: 'pre' }}>
                  <span style={{ color: r.current ? C.clay : C.muted }}>{dateLabel(r.start)} – {dateLabel(r.end)}</span>
                  <span style={{ color: C.teal }}>{days}</span>
                  <span className="bar"><span style={{ color: (r.pct || 0) >= 90 ? C.danger : C.clay }}>{ascii((r.pct || 0) / 100, 30).fill}</span><span style={{ color: C.empty }}>{ascii((r.pct || 0) / 100, 30).empty}</span></span>
                  <span style={{ textAlign: 'right', color: C.hi }}>{fmtP(r.pct, r.measured)}</span>
                  <M>{r.current ? '← now' : r.partial ? 'partial' : ''}</M>
                </div>
              );
            })}
          </div>
        );
      })}
      <M c={C.dim}>~ estimated from local logs · partial = logs don't reach the start of that week</M>
    </Panel>
  );
}

// The last finished week summed up, against the week before it (s.before,
// picked by main: null when there is none to compare with), and the weeks
// before that. Summaries are made once, when a week ends.
function SummaryPanel({ snap, history: h }) {
  if (!h) return null;
  const list = h.summaries || [];
  if (!list.length) return <Panel title="week summary" pad="20px 16px 12px"><M>the first summary appears when the current week ends</M></Panel>;
  const withCR = snap.countsCacheReads;
  const tok = x => (withCR ? x.tokens : x.tokens - x.cr);
  const s = list[0], older = list.slice(1, 9);
  const prev = s.before;
  const delta = (a, b) => { const d = change(a, b); return d && `${d} vs the week before`; };
  const share = x => Math.round(tok(x) / Math.max(1, tok(s)) * 100);
  const stat = (label, value, d) => <span key={label}><M>{label}</M> <span style={{ color: C.hi }}>{value}</span>{d && <M c={C.dim}> {d}</M>}</span>;
  const tMax = Math.max(1, ...older.map(tok));
  return (
    <Panel title={`week summary · ${dateLabel(s.start)} – ${dateLabel(s.end)}`} pad="20px 16px 12px" gap={8}>
      <div className="wsum">
        {stat('tokens', fmtTok(tok(s)), prev && delta(tok(s), tok(prev)))}
        {stat('cost', '$' + s.cost.toFixed(2), prev && delta(s.cost, prev.cost))}
        {s.limit && stat(s.limit.name, fmtP(s.limit.pct, s.limit.measured).trim(), prev && prev.limit ? `${fmtP(prev.limit.pct, prev.limit.measured).trim()} the week before` : null)}
        {stat('sessions', s.sessions, prev ? `${prev.sessions} the week before` : null)}
        {stat('active days', `${s.activeDays} of ${Math.max(1, Math.ceil((s.end - s.start) / 86400e3))}`)}
        {s.busiest && stat('busiest 24 h', `from ${dayLabel(s.busiest.start)} ${hhmm(s.busiest.start)} · ${fmtTok(tok(s.busiest))}`)}
      </div>
      <div className="wsum">
        <M>projects</M>
        {s.projects.map(p => <span key={p.name}>{p.name} <M>{share(p)}%</M></span>)}
      </div>
      <div className="wsum">
        <M>models</M>
        {s.models.map(m => <span key={m.name}><span style={{ color: famColor(m.fam) }}>{m.name}</span> <M>{share(m)}%</M></span>)}
      </div>
      {older.length > 0 && (
        <div>
          <M>earlier weeks</M>
          {older.map(w => (
            <div key={w.end} className="wgrid">
              <span style={{ color: C.muted }}>{dateLabel(w.start)} – {dateLabel(w.end)}</span>
              <span className="bar" style={{ color: C.teal }}>{ascii(tok(w) / tMax, 30).fill}</span>
              <span style={{ textAlign: 'right' }}>{fmtTok(tok(w))}</span>
              <span style={{ textAlign: 'right', color: C.clay }}>${w.cost.toFixed(2)}</span>
              <span style={{ textAlign: 'right', color: C.hi }}>{w.limit ? fmtP(w.limit.pct, w.limit.measured) : ''}</span>
              <M>{w.partial ? 'partial' : ''}</M>
            </div>
          ))}
        </div>
      )}
      <M c={C.dim}>cost = API-price equivalent · {withCR ? 'includes cache reads' : 'without cache reads'} · [c] · days = 24 h from the week's start{s.partial || older.some(w => w.partial) ? " · partial: logs don't reach the start of that week" : ''}</M>
    </Panel>
  );
}

const MonthlyPanel = ({ history: h }) => (h && h.months && h.months.length ? <MonthlyCycles months={h.months} fmtP={fmtP} /> : null);

function DailyPanel({ snap }) {
  const fams = [...new Set(snap.hist.flatMap(h => Object.keys(h.fam)))]
    .sort((a, b) => snap.hist.reduce((s, h) => s + (h.fam[b] || 0), 0) - snap.hist.reduce((s, h) => s + (h.fam[a] || 0), 0));
  const totals = snap.hist.map(h => Object.values(h.fam).reduce((a, b) => a + b, 0));
  const hMax = Math.max(1, ...totals), W = 60;
  return (
    <Panel title={`daily tokens · ${snap.hist[0].label} – today`} pad="20px 16px 14px">
      <div style={{ display: 'flex', gap: 18, color: C.muted, marginBottom: 8 }}>
        {fams.map(f => <span key={f}><span style={{ color: famColor(f) }}>■</span> {f}</span>)}
      </div>
      {snap.hist.map((h, i) => {
        const t = totals[i], n = Math.round(t / hMax * W);
        let used = 0;
        const segs = fams.map((f, j) => {
          const c = j === fams.length - 1 ? Math.max(0, n - used) : Math.round((h.fam[f] || 0) / (t || 1) * n);
          used += c;
          return <span key={f} style={{ color: famColor(f) }}>{'█'.repeat(Math.max(0, c))}</span>;
        });
        return (
          <div key={h.label} style={{ display: 'grid', gridTemplateColumns: '60px minmax(0,1fr) 80px', gap: 12, whiteSpace: 'pre' }}>
            <span style={{ color: i === 6 ? C.clay : C.muted }}>{h.label}</span>
            <span className="bar">{segs}</span>
            <span style={{ textAlign: 'right' }}>{fmtTok(t)}</span>
          </div>
        );
      })}
      <M c={C.dim} style={{ marginTop: 6 }}>{snap.countsCacheReads ? 'includes cache reads' : 'without cache reads'} · claude.ai chat and copilot not included · [c]</M>
    </Panel>
  );
}

function BurnersPanel({ snap }) {
  const wk = snap.topWeek, wMax = Math.max(1, ...wk.map(p => p.tokens));
  return (
    <Panel title="top burners this week" pad="18px 16px 10px">
      <div>
        {wk.map((p, i) => (
          <div key={p.project} className="burn">
            <M c={C.dim}>{i + 1}.</M><span className="ell">{p.project}</span><span className="ell c-app" style={{ color: provColor(p.app.startsWith('Cursor') ? 'cursor' : p.app.startsWith('Codex') ? 'codex' : 'claude') }}>{p.app} <M>· {p.model}</M></span>
            <span className="bar c-bar" style={{ color: famColor(p.fam) }}>{ascii(p.tokens / wMax, 30).fill}</span>
            <span className="c-hit" style={{ textAlign: 'right', color: p.cache.rebuilds ? C.danger : undefined }} title={p.cache.rebuilds ? `rebuilds its cache often: ${p.cache.rebuildCount} of ${p.cache.responses} responses wrote the cache again` : 'cache hit rate'}>{p.cache.hitRate == null ? '—' : Math.round(p.cache.hitRate * 100) + '%'}{p.cache.rebuilds ? ' ⟳' : ''}</span>
            <span style={{ textAlign: 'right' }}>{fmtTok(p.tokens)}</span>
            <span style={{ textAlign: 'right', color: C.clay }}>${p.cost.toFixed(2)}</span>
          </div>
        ))}
      </div>
      <M c={C.dim} style={{ marginTop: 6 }}>cache = hit rate (⟳ rebuilds its cache often) · last column = API-price equivalent</M>
    </Panel>
  );
}

function ByAppPanel({ snap }) {
  return (
    <Panel title="claude weekly limit by app">
      {!snap.breakdown.length && <M>—</M>}
      {snap.breakdown.map(b => (
        <div key={b.name} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,1fr) 44px', gap: 10, whiteSpace: 'pre' }}>
          <span>{b.name.toLowerCase()}</span>
          <span className="bar" style={{ color: C.teal }}>{ascii(b.percent / 100, 24).fill}</span>
          <span style={{ textAlign: 'right' }}>{b.percent}%</span>
        </div>
      ))}
      <M c={C.dim} style={{ marginTop: 6 }}>share of what you used this week</M>
    </Panel>
  );
}

const HIST_PANELS = {
  usageExport: { name: 'usage export', min: 320, render: () => <UsageExport /> },
  winChart: { name: '5h window over time', min: 560, render: c => <WinChartPanels {...c} /> },
  winList: { name: '5h windows · 7 days', min: 380, render: c => <WinListPanels {...c} /> },
  weekly: { name: 'weekly limits', min: 560, render: c => <WeeklyPanel {...c} /> },
  summary: { name: 'week summary', min: 560, render: c => <SummaryPanel {...c} /> },
  monthly: { name: 'monthly limits', min: 560, render: c => <MonthlyPanel {...c} /> },
  daily: { name: 'daily tokens', min: 560, render: c => <DailyPanel {...c} /> },
  burners: { name: 'top burners', min: 560, render: c => <BurnersPanel {...c} /> },
  byApp: { name: 'weekly limit by app', min: 320, render: c => <ByAppPanel {...c} /> }
};

// Monthly limits (Cursor, Copilot): this and the previous billing cycles,
// from the server readings the app recorded.
function MonthlyCycles({ months, fmtP }) {
  return (
    <Panel title="monthly limits · billing cycles" pad="20px 16px 12px" gap={10}>
      {months.map(mo => {
        const maxDay = Math.max(0.01, ...mo.rows.flatMap(r => r.daily.filter(v => v != null)));
        return (
          <div key={mo.key} style={{ display: 'flex', flexDirection: 'column' }}>
            <span><span style={{ color: provColor(mo.provider) }}>{mo.provider}</span> <span style={{ color: C.hi }}>{mo.name}</span><M>  · added per day of the cycle</M></span>
            {mo.rows.map(r => {
              const days = r.daily.map(v => (v == null ? ' ' : SPK[Math.min(7, Math.floor(v / maxDay * 7.99))])).join('');
              return (
                <div key={r.end} className="mgrid">
                  <span style={{ color: r.current ? C.clay : C.muted }}>{dateLabel(r.start)} – {dateLabel(r.end)}</span>
                  <span className="bar c-days" style={{ color: C.teal }}>{days}</span>
                  <span className="bar"><span style={{ color: (r.pct || 0) >= 90 ? C.danger : C.clay }}>{ascii((r.pct || 0) / 100, 24).fill}</span><span style={{ color: C.empty }}>{ascii((r.pct || 0) / 100, 24).empty}</span></span>
                  <span style={{ textAlign: 'right', color: C.hi }}>{fmtP(r.pct, r.measured)}</span>
                  <M>{r.current ? '← now' : r.partial ? 'partial' : ''}</M>
                </div>
              );
            })}
          </div>
        );
      })}
      <M c={C.dim}>from the server readings the app recorded (kept {months[0].keepDays} days) · partial = readings start after the cycle began</M>
    </Panel>
  );
}

// ── session details (click a row in "sessions") ─────────────────────────────
// Asks main for the details every 2 s while open.
// Time on an axis: bare HH:MM today, with the day otherwise (shared/clock).
const axisTime = (t, now) => { const w = when(t, now); return w.startsWith('at ') ? w.slice(3) : w; };

function SessionDetails({ sid, prec, onClose }) {
  // undefined = loading, null = gone (or its source hidden), false = error
  const [d, setD] = useState(undefined);
  useEffect(() => {
    let alive = true;
    setD(undefined); // another session: don't show the previous one's numbers
    const load = () => window.tm.sessionDetails(sid).then(x => { if (alive) setD(x); }, () => { if (alive) setD(false); });
    load();
    const t = setInterval(load, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [sid]);
  const close = <span className="key" style={{ color: C.muted }} onClick={onClose} title="close (Esc)">[ ✕ ]</span>;
  if (!d) return <Panel title="session" gap={6}><div className="opt-line"><M>{d === undefined ? 'loading…' : d === null ? 'this session is no longer shown' : 'could not load the details'}</M>{close}</div></Panel>;
  const T = d.types, typeRows = [['input', T.in], ['output', T.out], ['cache read', T.cr], ['cache write', T.cw]];
  const tMax = Math.max(1, ...typeRows.map(r => r[1]));
  const sMax = Math.max(1, ...d.series);
  const spark = d.series.map(v => (v ? SPK[Math.min(7, Math.floor(v / sMax * 7.99))] : ' ')).join('');
  const dur = Math.max(0, (d.end - d.start) / 1000);
  return (
    <Panel title={`session · ${d.project}`} gap={10}>
      <div className="opt-line" style={{ justifyContent: 'space-between' }}>
        <span>
          <span style={{ color: provColor(d.provider) }}>{d.app}</span><M> · </M>{d.model}
          <M> · started </M>{when(d.start, d.now)}<M> · ran </M>{fmtDur(dur)}
          <M> · last </M>{fmtDur(Math.max(0, (d.now - d.end) / 1000))}<M> ago · </M>{fmtInt(d.responses)}<M> responses</M>
        </span>
        {close}
      </div>
      <div className="row" style={{ gap: 24 }}>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <M>tokens{d.countsCacheReads ? '' : ' (cache reads not counted in the total)'}</M>
          {typeRows.map(([name, v]) => (
            <div key={name} style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,24ch) 80px', gap: 10, whiteSpace: 'pre' }}>
              <span>{name}</span>
              <span className="bar" style={{ color: C.teal }}>{ascii(v / tMax, 24).fill}</span>
              <span style={{ textAlign: 'right' }}>{fmtTok(v)}</span>
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,24ch) 80px', gap: 10, whiteSpace: 'pre' }}>
            <span>cache hit</span>
            <M>cache write cost <span style={{ color: C.clay }} title={d.cache.cwUnpriced > 0 ? 'cache writes of models without a known API price are left out' : "cache writes' part of the API-price equivalent below"}>{d.cache.cwUnpriced > 0 && d.cache.cwCost === 0 ? 'n/a' : '$' + d.cache.cwCost.toFixed(2) + (d.cache.cwUnpriced > 0 ? '+' : '')}</span></M>
            <span style={{ textAlign: 'right', color: d.cache.rebuilds ? C.danger : undefined }}>{d.cache.hitRate == null ? '—' : Math.round(d.cache.hitRate * 100) + '%'}</span>
          </div>
          {d.cache.rebuilds && <span style={{ color: C.danger }}>⟳ rebuilds its cache often: {d.cache.rebuildCount} of {d.cache.responses} responses wrote the cache again</span>}
          <div style={{ display: 'grid', gridTemplateColumns: '100px minmax(0,24ch) 80px', gap: 10, whiteSpace: 'pre' }}>
            <span style={{ color: C.hi }}>total</span><M>API-price equivalent <span style={{ color: C.clay }}>${d.cost.toFixed(2)}</span></M><span style={{ textAlign: 'right', color: C.hi }}>{fmtTok(d.tokens)}</span>
          </div>
        </div>
        <div style={{ flex: '1 1 300px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <M>models</M>
          {d.models.map(m => (
            <div key={m.name} style={{ display: 'grid', gridTemplateColumns: '16px minmax(0,22ch) 70px 70px', gap: 8, whiteSpace: 'pre' }}>
              <span style={{ color: famColor(m.fam) }}>■</span><span className="ell">{m.name}</span>
              <span style={{ textAlign: 'right' }}>{fmtTok(m.tokens)}</span><span style={{ textAlign: 'right', color: C.clay }}>${m.cost.toFixed(2)}</span>
            </div>
          ))}
          <M style={{ marginTop: 8 }}>share of limits (current windows)</M>
          {!d.shares.length && <M c={C.dim}>— (nothing in a current window)</M>}
          {d.shares.map(x => (
            <div key={x.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,24ch) 90px', gap: 8 }}>
              <span className="ell"><span style={{ color: provColor(x.provider) }}>{x.provider}</span> {x.name}</span>
              <span style={{ textAlign: 'right', color: C.clay }}>{x.pct.toFixed(prec)}%</span>
            </div>
          ))}
          {d.ctxMax > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '70px minmax(0,20ch) 110px', gap: 8, whiteSpace: 'pre', marginTop: 8 }}>
              <M>context</M>
              <span className="bar"><span style={{ color: d.ctx / d.ctxMax > 0.8 ? C.danger : C.clay }}>{ascii(d.ctx / d.ctxMax, 20).fill}</span><span style={{ color: C.empty }}>{ascii(d.ctx / d.ctxMax, 20).empty}</span></span>
              <span style={{ textAlign: 'right' }}>{fmtTok(d.ctx)} / {fmtTok(d.ctxMax)}</span>
            </div>
          )}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <M>tokens over the session · {Math.round(d.stepMs / 60e3)} min per column</M>
        <span className="bar" style={{ color: C.teal }}>{spark}</span>
        <span style={{ display: 'flex', justifyContent: 'space-between', color: C.dim, width: `${Math.max(d.series.length, 14)}ch`, maxWidth: '100%' }}><span>{axisTime(d.start, d.now)}</span><span>{axisTime(d.end, d.now)}</span></span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <M>last actions</M>
        {!d.events.length && <M c={C.dim}>—</M>}
        {d.events.map((e, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '50px minmax(0,1fr) 70px', gap: 10, whiteSpace: 'pre' }}>
            <M>{hhmm(e.ts)}</M><span className="ell">{e.text}</span><M style={{ textAlign: 'right' }}>{typeof e.tok === 'number' ? fmtTok(e.tok) : e.tok}</M>
          </div>
        ))}
      </div>
    </Panel>
  );
}

// ── settings view ──────────────────────────────────────────────────────────
// Everything here is stored by the main process (settings.json), except
// precision and zoom, which live in this window like their [p] / [l] keys.
function Opt({ on, label, hint, onClick, disabled }) {
  return (
    <div className={'opt' + (disabled ? ' off' : '')} role="checkbox" aria-checked={!!on} aria-disabled={!!disabled} {...pressable(disabled ? null : onClick)}>
      <span style={{ color: on ? C.ok : C.dim }}>{on ? '[x]' : '[ ]'}</span>
      <span>{label}{hint && <M c={C.dim}> · {hint}</M>}</span>
    </div>
  );
}

// An update that can be installed: found, or already downloaded.
const updateWaiting = u => u.status === 'available' || u.status === 'ready';

function UpdateLine({ u }) {
  if (!u) return null;
  const checkNow = <span className="opt link" role="button" {...pressable(() => window.tm.checkUpdate())}>[ check now ]</span>;
  const checked = u.checkedAt ? <M c={C.dim}> · checked {when(u.checkedAt)}</M> : null;
  if (u.status === 'checking') return <M>checking…</M>;
  if (u.status === 'downloading') {
    const d = downloadText(u);
    const bar = ascii(u.progress / 100, 24);
    return (
      <div className="opt-line">
        <span>downloading v{u.latest}</span>
        <span className="bar"><span style={{ color: C.clay }}>{bar.fill}</span><span style={{ color: C.empty }}>{bar.empty}</span></span>
        <span style={{ color: C.clay }}>{u.progress}%</span>
        <M>{[d.mb, d.speed, d.left].filter(Boolean).join(' · ')}</M>
        <span className="opt link" role="button" {...pressable(() => window.tm.cancelUpdate())}>[ cancel ]</span>
      </div>
    );
  }
  if (updateWaiting(u)) {
    const ready = u.status === 'ready';
    return (
      <div className="opt-line">
        <span>version <span style={{ color: C.ok }}>v{u.latest}</span> is {ready ? 'downloaded' : 'available'}</span>
        <span className="opt link" role="button" {...pressable(() => window.tm.installUpdate())}>{ready ? '[ install now ]' : '[ download and install ]'}</span>
        {u.page && <span className="opt link" role="button" {...pressable(() => window.tm.openReleasePage())}>[ what's new ]</span>}
        {u.error && <span style={{ color: C.danger }}>{u.error}</span>}
      </div>
    );
  }
  if (u.status === 'error') return <div className="opt-line"><span style={{ color: C.danger }}>{u.error}</span>{checked}{checkNow}</div>;
  if (u.status === 'current') return <div className="opt-line"><span>up to date ({VERSION})</span>{checked}{checkNow}</div>;
  return <div className="opt-line"><M>not checked yet</M>{checkNow}</div>;
}

// Copies a report of what the app sees (versions, sources, limits, log
// counts; no tokens, project names or home paths) for a GitHub issue.
function DiagnosticsButton() {
  const [msg, setMsg] = useState(null);
  const copy = () => window.tm.copyDiagnostics().then(
    () => setMsg({ text: 'copied · paste it into a GitHub issue', color: C.ok }),
    e => setMsg({ text: 'could not build the report: ' + e.message, color: C.danger })
  );
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 5000); return () => clearTimeout(t); }, [msg]);
  return (
    <div className="opt-line" style={{ marginTop: 6 }}>
      <span className="opt link" role="button" {...pressable(copy)}>[ copy diagnostics ]</span>
      {msg ? <span style={{ color: msg.color }}>{msg.text}</span> : <M c={C.dim}>for reporting a problem: versions, sources and counts, no private data</M>}
    </div>
  );
}

// One mascot to pick, drawn in the current skin; 'auto' shows the skin's own.
function MascotChip({ id, skin, on, onClick }) {
  const shown = mascotOf(skin, id);
  const label = id === 'auto' ? 'auto · ' + shown : id;
  return (
    <div className={'mascot-chip' + (on ? ' on' : '')} role="radio" aria-checked={on} aria-label={'mascot ' + label} {...pressable(onClick, on ? 0 : -1)}>
      <MascotPixels rows={critterRows('calm', 0, shown)} color={on ? C.clay : C.muted} px={3} />
      <span style={{ color: on ? C.clay : C.fg }}>{label}</span>
    </div>
  );
}

// One skin to pick: the mascot it would show and its colours, drawn in that
// skin's own palette.
function ThemeCard({ id, mascot, on, onClick }) {
  const t = THEMES[id];
  return (
    <div className={'theme-card' + (on ? ' on' : '')} role="radio" aria-checked={on} aria-label={'skin ' + id} title={id} {...pressable(onClick, on ? 0 : -1)}
      style={{ background: t.c.bg, color: t.c.fg, borderColor: on ? t.c.clay : t.c.border }}>
      <MascotPixels rows={critterRows('calm', 0, mascotOf(id, mascot))} color={t.c.clay} px={3} />
      <div style={{ minWidth: 0 }}>
        <div className="ell" style={{ color: on ? t.c.clay : t.c.hi }}>{t.name}</div>
        <div>{[t.c.clay, t.c.teal, t.c.ok, t.c.warn, t.c.danger].map((c, i) => <span key={i} style={{ color: c }}>■</span>)}{on && <span style={{ color: t.c.clay }}> ✓</span>}</div>
      </div>
    </div>
  );
}

// The skins to pick from, by group, as one radiogroup; `only` filters them
// (dark ones or light ones in the auto mode).
function SkinGroups({ label, only, picked, mascot, onPick }) {
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={radioKeys} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {GROUPS.map(g => {
        const ids = THEME_IDS.filter(id => THEMES[id].group === g.id && only(THEMES[id]));
        return ids.length > 0 && (
          <div key={g.id}>
            <M c={C.muted}>{g.title}</M>
            <div className="themes">
              {ids.map(id => <ThemeCard key={id} id={id} mascot={mascot} on={picked === id} onClick={() => onPick(id)} />)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Settings({ s, prec, setPrec, lupa, toggleLupa, onEditLayout }) {
  if (!s) return <M>loading settings…</M>;
  const set = (name, value) => window.tm.setSetting(name, value);
  // role: 'checkbox' (thresholds, any number) or 'radio' (precision, one; the
  // line is a radiogroup with arrow keys)
  const choice = (role, on, label, onClick, disabled) => (
    <span key={label} className={'opt chip' + (disabled ? ' off' : '')} role={role} aria-checked={on} aria-disabled={!!disabled}
      {...pressable(disabled ? null : onClick, role === 'radio' && !on ? -1 : 0)}>
      <span style={{ color: on ? C.ok : C.dim }}>{on ? '[x]' : '[ ]'}</span><span>{label}</span>
    </span>
  );
  return (
    <>
      <div className="row">
        <Panel title="general" gap={6} style={{ flex: '1 1 380px', minWidth: 0 }}>
          <Opt on={s.autostart} label="start with Windows" hint="in the tray" onClick={() => set('autostart', !s.autostart)} />
          <Opt on={s.startHidden} label="start in the tray" hint="also when opened by hand" onClick={() => set('startHidden', !s.startHidden)} />
          <Opt on={s.onTop} label="window always on top" hint="[t]" onClick={() => set('onTop', !s.onTop)} />
          <Opt on={s.mini} label="mini widget" hint="[m]" onClick={() => set('mini', !s.mini)} />
        </Panel>
        <Panel title="notifications" gap={6} style={{ flex: '1 1 380px', minWidth: 0 }}>
          <Opt on={s.notifications} label="notifications" onClick={() => set('notifications', !s.notifications)} />
          <div className="opt-line">
            <M>notify at</M>
            {s.thresholdChoices.map(t => choice('checkbox', s.thresholds.includes(t), t + '%', () => set('threshold:' + t, !s.thresholds.includes(t)), !s.notifications))}
          </div>
          <Opt on={s.forecastNotify} disabled={!s.notifications} label="warn before the 5h window runs out" hint="~30 min ahead" onClick={() => set('forecastNotify', !s.forecastNotify)} />
          <Opt on={s.weeklySummary} disabled={!s.notifications} label="week summary" hint="when the weekly limit resets" onClick={() => set('weeklySummary', !s.weeklySummary)} />
          <div><span className="opt link" role="button" {...pressable(() => window.tm.testNotification())}>[ send test notification ]</span></div>
        </Panel>
      </div>
      <div className="row">
        <Panel title="sources" gap={6} style={{ flex: '1 1 380px', minWidth: 0 }}>
          {s.sources.map(src => (
            <Opt key={src.id} on={src.on} label={<span style={{ color: provColor(src.id) }}>{src.id}</span>}
              hint={src.detected ? (src.on ? 'shown' : 'hidden, no requests') : 'not found on this computer'}
              onClick={() => set('source:' + src.id, !src.on)} />
          ))}
          <M c={C.dim} style={{ marginTop: 4 }}>a hidden source is left out of every view and notification</M>
        </Panel>
        <Panel title="display" gap={6} style={{ flex: '1 1 380px', minWidth: 0 }}>
          <div className="opt-line" role="radiogroup" aria-label="precision" onKeyDown={radioKeys}>
            <M>precision</M>
            {[2, 3, 4].map(n => choice('radio', prec === n, '0.' + '0'.repeat(n - 1) + '1%', () => setPrec(n)))}
            <M c={C.dim}>[p]</M>
          </div>
          <Opt on={lupa} label="zoom" hint="magnified tail of each limit bar · [l]" onClick={toggleLupa} />
          <div className="opt-line">
            <M>layout</M>
            <span className="opt link" role="button" {...pressable(() => onEditLayout('live'))}>[ edit live ]</span>
            <span className="opt link" role="button" {...pressable(() => onEditLayout('hist'))}>[ edit history ]</span>
            <M c={C.dim}>drag panels, resize, hide · [e]</M>
          </div>
          <Opt on={s.countCacheReads} label="count cache reads in token numbers" hint="tok/s, sessions, daily tokens · [c]" onClick={() => set('countCacheReads', !s.countCacheReads)} />
        </Panel>
      </div>
      <Panel title="theme" gap={10}>
        <div>
          <M c={C.muted}>mascot</M>
          <div className="mascots" role="radiogroup" aria-label="mascot" onKeyDown={radioKeys}>
            {MASCOT_CHOICES.map(m => <MascotChip key={m} id={m} skin={s.theme} on={s.mascot === m} onClick={() => set('mascot', m)} />)}
          </div>
        </div>
        <div className="opt-line" role="radiogroup" aria-label="skin mode" onKeyDown={radioKeys}>
          <M>skin</M>
          {choice('radio', s.themeMode === 'fixed', 'fixed', () => set('themeMode', 'fixed'))}
          {choice('radio', s.themeMode === 'auto', 'follow Windows', () => set('themeMode', 'auto'))}
          <M c={C.dim}>{s.themeMode === 'auto' ? `a dark and a light skin · Windows is ${s.systemDark ? 'dark' : 'light'} now` : 'one skin always'}</M>
        </div>
        {s.themeMode === 'auto' ? (
          <>
            <M c={C.hi}>when Windows is dark{s.systemDark ? ' · now' : ''}</M>
            <SkinGroups label="skin for dark mode" only={t => !t.light} picked={s.themeDark} mascot={s.mascot} onPick={id => set('themeDark', id)} />
            <M c={C.hi}>when Windows is light{s.systemDark ? '' : ' · now'}</M>
            <SkinGroups label="skin for light mode" only={t => t.light} picked={s.themeLight} mascot={s.mascot} onPick={id => set('themeLight', id)} />
          </>
        ) : (
          <SkinGroups label="skin" only={() => true} picked={s.themeFixed} mascot={s.mascot} onPick={id => set('theme', id)} />
        )}
        <M c={C.dim}>colours, the mascot in the window, the mini widget and the tray icon</M>
      </Panel>
      <Panel title="updates" gap={6}>
        <Opt on={s.checkUpdates} label="check for updates" hint="GitHub releases, every 6 h" onClick={() => set('checkUpdates', !s.checkUpdates)} />
        <Opt on={s.downloadUpdates} label="download updates in the background" hint="ready to install when you are" onClick={() => set('downloadUpdates', !s.downloadUpdates)} />
        <UpdateLine u={s.update} />
      </Panel>
      <Panel title="about" gap={4}>
        <span><M>version</M> {VERSION}</span>
        <span className="ell"><M>data</M> <span className="opt link" role="button" {...pressable(() => window.tm.openDataFolder())}>{s.dataDir}</span></span>
        <span className="ell"><M>program</M> {s.exe}</span>
        <DiagnosticsButton />
      </Panel>
    </>
  );
}

// ── mini widget (?view=mini) ───────────────────────────────────────────────
function Mini() {
  const [snap, setSnap] = useState(null);
  const [theme, setTheme] = useState(null);
  const ref = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    window.tm.onSnapshot(setSnap);
    const receive = s => { applyTheme(s.theme, s.mascot); setTheme(s.theme + '/' + s.mascot); }; // re-render in the new look
    window.tm.onSettings(receive);
    window.tm.getSettings().then(receive);
  }, []);
  // The main process sizes the window to the content.
  useEffect(() => {
    const ro = new ResizeObserver(() => window.tm.mini('size', ref.current.offsetHeight));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  // Window dragging: the main process moves the window to follow the cursor.
  const onPointerDown = e => {
    if (e.button !== 0 || e.target.closest('.mbtn')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { frame: 0 };
    window.tm.mini('drag-start');
  };
  const endDrag = () => {
    if (!drag.current) return;
    cancelAnimationFrame(drag.current.frame);
    drag.current = null;
    window.tm.mini('drag-end');
  };
  const onPointerMove = e => {
    const d = drag.current;
    if (!d) return;
    if (!(e.buttons & 1)) return endDrag(); // button released where we didn't see it
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => { d.frame = 0; window.tm.mini('drag-move'); });
  };

  const now = snap ? snap.now : Date.now();
  const ready = snap && snap.ready;
  const mood = ready ? moodOf(snap) : 'sleep';
  const limits = ready ? pickMiniLimits(snap.limits) : [];
  const head = ready ? pickHeadline(snap.limits, now) : { kind: 'none' };

  return (
    <div className="mini" ref={ref} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}
      onDoubleClick={e => { if (!e.target.closest('.mbtn')) window.tm.mini('dashboard'); }}
      onContextMenu={e => { e.preventDefault(); window.tm.mini('menu'); }}>
      <div className="mini-head">
        <div style={{ width: 66, height: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <PixelCritter mood={mood} px={4} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div>
            <span style={{ color: MOOD_COLOR[mood] }}>[{MOOD_LABEL[mood]}]</span>{' '}
            <span style={{ color: C.hi }}>{ready ? fmtInt(snap.burn.rate) : '—'}</span><M> tok/s</M>
          </div>
          <M c={C.dim}>{hhmmss(now)}</M>
        </div>
        <div className="mbtns">
          <span className="mbtn" title="Open dashboard" onClick={() => window.tm.mini('dashboard')}>⤢</span>
          <span className="mbtn close" title="Hide widget" onClick={() => window.tm.mini('hide')}>✕</span>
        </div>
      </div>
      {!ready && <M>reading usage…</M>}
      {limits.map(l => {
        const p = l.est, b = ascii(p / 100, 10);
        const r = l.resetsAt ? (l.resetsAt - now) / 1000 : null;
        return (
          <div key={l.key} className="mini-row">
            <span className="ell"><span style={{ color: provColor(l.provider) }}>{l.provider}</span> {shortName(l.name)}</span>
            <span style={{ whiteSpace: 'pre' }}><span style={{ color: p >= 90 ? C.danger : C.clay }}>{b.fill}</span><span style={{ color: C.empty }}>{b.empty}</span></span>
            <span style={{ textAlign: 'right', color: C.hi }}>{p.toFixed(1)}%</span>
            <M style={{ textAlign: 'right' }}>{r == null ? '—' : fmtShort(r)}</M>
          </div>
        );
      })}
      {ready && head.kind === 'runout' && <div style={{ color: C.danger }}>✗ {head.label} runs out {when(head.at, now)}</div>}
      {ready && head.kind === 'reached' && <div style={{ color: C.danger }}>✗ {head.label} limit reached</div>}
      {ready && head.kind === 'ok' && <div style={{ color: C.ok }}>✓ all limits fit until reset</div>}
    </div>
  );
}

const view = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')).render(view === 'mini' ? <Mini /> : <App />);
