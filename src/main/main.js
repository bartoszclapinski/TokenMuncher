const { app, BrowserWindow, ipcMain, screen, Notification, shell, dialog, clipboard, nativeTheme } = require('electron');
const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Store } = require('./store');
const { Aggregator } = require('./aggregate');
const { ClaudeSource } = require('./sources/claude');
const { CodexSource } = require('./sources/codex');
const { CursorSource } = require('./sources/cursor');
const { CopilotSource } = require('./sources/copilot');
const { GeminiSource } = require('./sources/gemini');
const { TrayIcon } = require('./tray');
const { MiniWidget } = require('./mini');
const { critterLarge } = require('./icon');
const { evaluate, markReached } = require('./notify');
const { UsageCache } = require('./usage-cache');
const { usageRows, formatUsage } = require('./usage-export');
const { LimitHistory } = require('./limit-history');
const { WeekSummaries, weeksDue, summarize, weekNews, weeklyLimit, NEWS_MS, SAME_MS } = require('./week-summary');
const install = require('./install');
const { normalize, applyChange, THRESHOLD_CHOICES, activeTheme } = require('./settings');
const { Updater } = require('./update');
const { themeOf, lookOf } = require('../shared/themes');
const { buildReport } = require('./diagnostics');

const APP_ID = require('./app-id');
const START_HIDDEN = process.argv.includes('--hidden');
const SHOT = !!process.env.TM_SHOT;
// TM_DEMO=1: made-up data (sources/demo.js) for screenshots and demos. Always
// in its own fresh temp folder per run (TM_PROFILE is ignored, so made-up
// history never lands in a real profile), removed on quit; folders left by
// earlier runs are cleared when no demo is using them. No requests, no
// autostart, shortcut, update check or notifications.
const DEMO = !!process.env.TM_DEMO;
const DEMO_DIR = DEMO ? path.join(app.getPath('temp'), `tokenmuncher-demo-${process.pid}`) : null;
if (DEMO) {
  const tmp = app.getPath('temp');
  for (const d of fs.readdirSync(tmp)) {
    if (/^tokenmuncher-demo(-\d+)?$/.test(d)) { try { fs.rmSync(path.join(tmp, d), { recursive: true, force: true }); } catch { /* a running demo's folder */ } }
  }
  delete process.env.TM_PROFILE;
  app.setPath('userData', DEMO_DIR);
}

// TM_PROFILE=<dir>: separate settings and single-instance lock, so test runs
// don't collide with a running copy of the app.
if (process.env.TM_PROFILE) app.setPath('userData', process.env.TM_PROFILE);
// Screenshots: Chromium stops painting windows hidden behind others, and
// capturePage would return a stale frame.
if (process.env.TM_SHOT) app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// Without the lock: install.handleLockTaken() once ready. With it: a marker
// tells later starts which copy is running.
const gotLock = app.requestSingleInstanceLock(install.lockData());
if (gotLock) install.markInstance();
app.setAppUserModelId(APP_ID); // Windows toasts are attributed by this id

// ── settings ──
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
const settings = normalize({});
// The skin and the mascot shown (resolved from 'auto'): one place for every window, the tray and toasts.
// The skin shown: the fixed pick, or in auto mode the one for Windows' current mode.
const shownTheme = () => activeTheme(settings, nativeTheme.shouldUseDarkColors);
const look = () => lookOf(shownTheme(), settings.mascot);
function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { /* first run */ }
  Object.assign(settings, normalize(raw));
  applySources();
}
function saveSettings() {
  try { fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}

// ── data ──
const store = new Store();
const sources = DEMO ? require('./sources/demo').demoSources(store) : [
  new ClaudeSource(store, {
    cacheFile: path.join(app.getPath('userData'), 'claude-limits.json'),
    estimate: key => { const a = aggregator.anchors.get(key); return a ? a.est : null; },
    rate: key => aggregator.lastK.get(key) || null
  }),
  new CursorSource(store), new CodexSource(store), new CopilotSource(), new GeminiSource(store)
];
const limitHistory = new LimitHistory(path.join(app.getPath('userData'), 'limit-history.jsonl'));
// Finished weeks, summed up once each (demo mode: made up, in memory).
const weekSummaries = new WeekSummaries(DEMO ? null : path.join(app.getPath('userData'), 'week-summaries.json')).load();
let weekEmpty = []; // weeks with nothing to sum up: not scanned again until the sources change
const aggregator = new Aggregator(store, sources, { history: limitHistory, countCacheReads: () => settings.countCacheReads, weeks: () => weekSummaries.view() }); // the Claude source reads it later, from its poll
// Sources switched off in settings stop polling their servers and drop out of
// every view (their local logs are still read, so nothing is missing later).
// Before the polls start (startup) this only sets the flags.
let pollsStarted = false;
function applySources() {
  let changed = false;
  for (const src of sources) {
    const off = settings.sources[src.id] === false;
    if (off === !!src.off) continue;
    src.off = off;
    changed = true;
    weekEmpty = []; // a week that was empty without this source may not be with it
    if (!pollsStarted || !src.start) continue;
    clearTimeout(src.timer);
    // Starting again keeps a source's own state: Claude's first delay still
    // honours a rate-limit backoff and a fresh reading.
    if (!off) src.start(tick);
  }
  if (changed) aggregator.histCache = null; // history panels follow at once
}
const usageCache = new UsageCache(path.join(app.getPath('userData'), 'usage-cache.json'), store, sources, { app: app.getVersion() });
const CACHE_SAVE_MS = 5 * 60e3;
let ready = false;

const PRELOAD = path.join(__dirname, 'preload.js');
const INDEX = path.join(__dirname, '..', '..', 'dist', 'index.html');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.ico'); // generated by scripts/make-icon.mjs

let win = null;
let tray = null;
let mini = null;
let updater = null;
let historySent = 0; // builtAt of the history last sent to the dashboard
let quitting = false;


// ── window ──
function boundsVisible(b) {
  return b && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return b.x < a.x + a.width - 50 && b.x + b.width > a.x + 50 && b.y >= a.y - 10 && b.y < a.y + a.height - 50;
  });
}

function rememberBounds() {
  if (!win) return;
  settings.maximized = win.isMaximized();
  if (!settings.maximized && !win.isMinimized()) settings.bounds = win.getBounds();
  settings.onTop = win.isAlwaysOnTop();
  saveSettings();
}

function sendWinState() {
  if (win) win.webContents.send('winstate', { onTop: win.isAlwaysOnTop(), maximized: win.isMaximized() });
}

function showWindow() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible() && !win.isMinimized()) { rememberBounds(); win.hide(); } else showWindow();
}

function setOnTop(on) {
  if (win) win.setAlwaysOnTop(!!on);
  settings.onTop = !!on;
  saveSettings();
  sendWinState();
  optionsChanged();
}

function createWindow() {
  let b = boundsVisible(settings.bounds) ? settings.bounds : { width: 1280, height: 900 };
  if (SHOT) b = { width: Number(process.env.TM_W || 1280), height: Number(process.env.TM_H || 900) };
  win = new BrowserWindow({
    ...b,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: themeOf(shownTheme()).c.bg,
    title: 'TokenMuncher',
    icon: ICON,
    alwaysOnTop: !!settings.onTop,
    show: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  if (settings.maximized && !SHOT) win.maximize();
  win.loadFile(INDEX, { query: look() }); // first paint in the saved skin and mascot
  win.once('ready-to-show', () => {
    if (!(START_HIDDEN || settings.startHidden) || SHOT) win.show();
    sendWinState();
    tick();
  });
  win.on('show', () => { historySent = 0; setImmediate(tick); }); // hidden windows get no snapshots; refresh on show
  win.on('maximize', sendWinState);
  win.on('unmaximize', sendWinState);
  // ✕ and Alt+F4 hide to the tray; only "Quit" from the tray menu exits.
  win.on('close', e => {
    rememberBounds();
    if (!quitting && !SHOT) { e.preventDefault(); win.hide(); }
  });
  // Windows shutdown and logoff skip before-quit; let the window close for real.
  win.on('query-session-end', () => { quitting = true; });
  win.on('session-end', () => { quitting = true; rememberBounds(); });
  win.on('closed', () => { win = null; });

  // TM_SHOT=<file.png>: render once with real data, save a screenshot, quit (used for testing).
  if (SHOT) {
    // Electron 37 passes one details object (level as a string); older versions pass (event, level, message).
    win.webContents.on('console-message', (e, level, msg) => {
      const lv = e && e.level !== undefined ? e.level : level, text = e && e.message !== undefined ? e.message : msg;
      if (lv === 'error' || lv === 'warning' || lv >= 2) console.error('[renderer]', text);
    });
    const shotStart = Date.now();
    // TM_LAYOUT=1 (with TM_SHOT): at several window widths and in both views,
    // list anything that scrolls sideways or sticks out of its panel, then quit.
    const layoutCheck = async () => {
      // Sideways scrolling, content sticking out of a panel, or clipped content
      // other than the intentional cases (.bar ASCII bars, .ell ellipsis cells).
      const FIND = `[...document.querySelectorAll('*')].filter(e => {
        const s = getComputedStyle(e), scrolls = s.overflowX === 'auto' || s.overflowX === 'scroll';
        const clips = s.overflowX === 'hidden' && !e.closest('.bar, .ell') && e !== document.body && e !== document.documentElement;
        return (scrolls || clips || e.classList.contains('panel') || e === document.documentElement) && e.scrollWidth > e.clientWidth + 1;
      }).map(e => (e.querySelector(':scope > .legend')?.textContent || e.getAttribute('class') || e.tagName) + ' ' + e.scrollWidth + '>' + e.clientWidth)`;
      let problems = 0;
      for (const view of ['1', '2', '3']) {
        await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${view}'}))`);
        for (const width of [720, 900, 1070, 1280]) {
          win.setContentSize(width, Number(process.env.TM_H || 900));
          await new Promise(r => setTimeout(r, 600));
          const found = await win.webContents.executeJavaScript(FIND);
          problems += found.length;
          console.log(`layout view ${view} @ ${width}px: ${found.length ? found.join(' | ') : 'ok'}`);
        }
      }
      console.log(`layout problems: ${problems}`);
      app.exit(problems ? 1 : 0);
    };
    const shot = () => takeShot().catch(e => { console.error('shot', e.message); app.exit(1); });
    const takeShot = async () => {
      // Wait for every source's first poll (at most 20 s; Claude may be backing off).
      const waiting = sources.some(src => src.st && src.enabled && ((!src.st.fetchedAt && !src.st.error) || src.st.polled === false));
      if (!ready || (waiting && Date.now() - shotStart < 20e3)) return setTimeout(shot, 500);
      tick();
      // Wait until the page shows data (not the loading line), then switch views.
      for (let i = 0; i < 40; i++) {
        if (await win.webContents.executeJavaScript('!!document.querySelector(".content .panel")')) break;
        await new Promise(r => setTimeout(r, 250));
      }
      if (process.env.TM_LAYOUT) return layoutCheck();
      if (process.env.TM_VIEW) await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:'${process.env.TM_VIEW}'}))`);
      // TM_KEYS=<chars>: press these keys first (e.g. 'e' for the layout editor)
      for (const k of process.env.TM_KEYS || '') await win.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)}}))`);
      // TM_SESSION=1: open the first (busiest) session's details and scroll to them
      if (process.env.TM_SESSION) {
        await win.webContents.executeJavaScript("document.querySelector('.sgrid.sess.pick')?.click()");
        await new Promise(r => setTimeout(r, 1500));
        await win.webContents.executeJavaScript("[...document.querySelectorAll('.panel')].find(p => p.textContent.startsWith('sessions'))?.scrollIntoView(); const c = document.querySelector('.content'); if (c) c.scrollTop -= 24");
      }
      setTimeout(async () => {
        const target = process.env.TM_MINI && mini && mini.win ? mini.win : win;
        target.webContents.invalidate();
        await new Promise(r => setTimeout(r, 300));
        const img = await target.webContents.capturePage();
        fs.writeFileSync(process.env.TM_SHOT, img.toPNG());
        app.exit(0);
      }, 2500);
    };
    win.webContents.once('did-finish-load', () => setTimeout(shot, 500));
  }
}

// ── notifications ──
let notifySavedAt = 0;
let notifySaved = '';
const liveToasts = new Set(); // Windows drops click handlers of garbage-collected toasts

function showNotification(n) {
  if (!Notification.isSupported()) return;
  const toast = new Notification({ title: n.title, body: n.body, icon: critterLarge(n.kind === 'reset' ? 'ok' : n.level >= 90 || n.kind === 'forecast' ? 'danger' : 'warn', look()), silent: false });
  liveToasts.add(toast);
  const release = () => liveToasts.delete(toast);
  toast.on('click', () => { release(); showWindow(); });
  toast.on('close', release);
  toast.on('failed', (_e, err) => { release(); console.error('notification failed', err); });
  if (liveToasts.size > 20) liveToasts.delete(liveToasts.values().next().value);
  if (process.env.TM_NOTIFY_LOG) toast.on('show', () => console.log('notification shown:', n.title));
  toast.show();
}

function runNotifications(snap) {
  if (!ready || SHOT || DEMO || !snap.limits.length) return;
  const { notifications, state } = evaluate(settings.notifyState || {}, snap.limits, snap.now, { thresholds: settings.thresholds, forecast: settings.forecastNotify });
  settings.notifyState = state;
  if (settings.notifications) notifications.forEach(showNotification);
  // Persist right after sending; otherwise only changes, at most once a minute.
  const json = JSON.stringify(state);
  if (json !== notifySaved && (notifications.length || Date.now() - notifySavedAt > 60e3)) {
    notifySaved = json; notifySavedAt = Date.now(); saveSettings();
  }
}

// ── week summary ──
// Once a minute: a finished week without a summary gets one (and on the first
// run the earlier weeks the records still cover, to compare with). The last
// week is announced when it ended within NEWS_MS.
//
// A summary is made once and kept, so it waits until the week's bounds and
// records are in: the sources have had WEEK_WAIT_MS since the logs were read
// (Cursor's records come from a poll), the week ended WEEK_SETTLE_MS ago, and
// with Claude shown its weekly limit comes from a fresh reading (one rolled
// forward from the last run may carry an old reset time). Calendar weeks are
// only for a setup without Claude.
const WEEK_CHECK_MS = 60e3, WEEK_WAIT_MS = 120e3, WEEK_SETTLE_MS = 10 * 60e3;
let weekCheckedAt = 0, weekFirstAt = 0;
function runWeekSummary(snap) {
  if (!ready || SHOT || DEMO || snap.now - weekCheckedAt < WEEK_CHECK_MS) return;
  weekCheckedAt = snap.now;
  weekSummaries.save(); // a write that failed earlier
  if (!weekFirstAt) weekFirstAt = snap.now;
  const hist = aggregator.histCache;
  if (!hist || snap.now - weekFirstAt < WEEK_WAIT_MS) return;
  const claude = sources.find(s => s.id === 'claude');
  const limit = weeklyLimit(snap.limits);
  if (claude && claude.enabled && !claude.off && (!limit || limit.synthetic)) return;
  const hidden = new Set(sources.filter(s => s.off).map(s => s.id));
  // The Cursor source keeps its whole billing cycle; the other sources' records
  // only reach back to the usual cutoff.
  const cutoff = Math.max(store.cutoff, Store.cutoffFor(snap.now));
  const known = w => weekSummaries.has(w) || weekEmpty.some(e => e.by === w.by && Math.abs(e.end - w.end) < SAME_MS);
  const due = weeksDue(snap.limits, snap.now, { cutoff, has: known }).filter(w => snap.now - w.end >= WEEK_SETTLE_MS);
  let added = false;
  for (const w of due.reverse()) { // oldest first, so each one's week before is there
    const s = summarize(store.records, { ...w, start: weekSummaries.startOf(w), hidden, cutoff });
    if (!s.sessions) { weekEmpty.push({ by: w.by, end: w.end }); continue; }
    const wk = w.limitKey && hist.weeks.find(x => x.key === w.limitKey);
    const row = wk && wk.rows.find(r => Math.abs(r.end - w.end) < 5 * 60e3);
    if (row && row.pct != null) s.limit = { name: `${wk.provider} ${wk.name}`, pct: row.pct, measured: row.measured };
    if (!weekSummaries.add(s)) continue;
    added = true;
    if (w.latest && settings.notifications && settings.weeklySummary && snap.now - w.end < NEWS_MS) showNotification(weekNews(s, weekSummaries.before(s), { withCR: settings.countCacheReads }));
  }
  if (added) aggregator.histCache = null; // the history view gets the new summary with the next build
}

// ── main loop ──
function tick() {
  let snap;
  try { snap = aggregator.snapshot(ready); } catch (e) { console.error(e); return; }
  // History changes every 30 s and only the dashboard shows it: send it on its own
  // channel when it was rebuilt (or the window just appeared), not with every snapshot.
  const { history, ...live } = snap;
  if (win && !win.isDestroyed() && win.isVisible()) {
    win.webContents.send('snapshot', live);
    if (history && history.builtAt !== historySent) { historySent = history.builtAt; win.webContents.send('history', history); }
  }
  if (mini) mini.send('snapshot', live);
  if (tray) tray.update(snap);
  runNotifications(snap);
  runWeekSummary(snap);
}

ipcMain.on('win', (_e, cmd) => {
  if (!win) return;
  if (cmd === 'min') win.minimize();
  else if (cmd === 'max') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (cmd === 'close') win.close();
  else if (cmd === 'ontop') setOnTop(!win.isAlwaysOnTop());
});
ipcMain.handle('session:details', (_e, sid) => (typeof sid === 'string' ? aggregator.sessionDetails(sid) : null));
ipcMain.handle('history:export', async (event, range, format) => {
  if (!['week', 'month', 'all'].includes(range) || !['csv', 'json'].includes(format)) return 'error';
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner) return 'error';
  try {
    const { canceled, filePath } = await dialog.showSaveDialog(owner, {
      title: 'Export usage',
      defaultPath: `tokenmuncher-usage-${range}.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }]
    });
    if (canceled || !filePath) return 'cancelled';
    const now = Date.now();
    store.prepare(now);
    const hidden = new Set(sources.filter(s => s.off).map(s => s.id));
    const rows = usageRows(store.records, range, now, hidden);
    await fs.promises.writeFile(filePath, formatUsage(rows, format), 'utf8');
    return 'saved';
  } catch {
    return 'error';
  }
});
ipcMain.on('refresh', () => sources.forEach(src => !src.off && src.refresh && src.refresh()));

// ── options: shared by the tray menu and the settings panel ──
function getOption(name) {
  if (name === 'autostart') return install.autostartEnabled();
  if (name === 'onTop') return !!settings.onTop;
  if (name === 'mini') return !!(mini && mini.isOn());
  return !!settings[name];
}
function setOption(name, value) {
  if (name === 'autostart') install.setAutostart(!!value);
  else if (name === 'mini') mini.setOn(!!value);
  else if (name === 'onTop') return setOnTop(!!value); // calls optionsChanged
  else if (applyChange(settings, name, value)) {
    saveSettings();
    if (name.startsWith('source:')) { applySources(); setImmediate(tick); }
    if (name === 'countCacheReads') setImmediate(tick); // history uses costs only: no rebuild
    restyle(); // only does something when the shown skin or mascot changed
    if (name === 'checkUpdates' && value && updater) updater.check();
    if (name === 'downloadUpdates' && updater) {
      if (value) updater.autoStart();
      else if (!installing) updater.cancel(false); // a download nobody asked for stops; one being installed goes on
    }
    // A threshold switched on below the current level counts as already sent,
    // so it doesn't announce something that happened long ago.
    if (name.startsWith('threshold:') && value === true) settings.notifyState = markReached(settings.notifyState, Number(name.slice(10)));
  }
  optionsChanged(); // also when nothing changed: a tray checkbox flips itself
}
// After any change (a setting, or Windows switching between dark and light):
// when the shown look differs from the one drawn, window backgrounds and the
// tray icon follow (the windows re-render from the settings sent next).
// Returns whether it changed.
let styledLook = null;
function restyle() {
  const key = JSON.stringify(look());
  if (key === styledLook) return false;
  styledLook = key;
  const bg = themeOf(shownTheme()).c.bg;
  if (win && !win.isDestroyed()) win.setBackgroundColor(bg);
  if (mini && mini.win && !mini.win.isDestroyed()) mini.win.setBackgroundColor(bg);
  if (tray) tray.refreshIcon();
  return true;
}
function optionsChanged() {
  if (tray) tray.rebuildMenu();
  sendSettings();
}
let miniLook = null; // the skin and mascot the mini widget was last sent
function sendSettings() {
  const view = settingsView();
  if (win && !win.isDestroyed()) win.webContents.send('settings', view);
  // the widget only uses the skin and mascot: tell it when they changed (or it was hidden)
  const key = JSON.stringify(look());
  if (mini && mini.isVisible() && miniLook !== key) { miniLook = key; mini.send('settings', view); }
}
// What the settings panel shows.
function settingsView() {
  return {
    autostart: getOption('autostart'), onTop: getOption('onTop'), mini: getOption('mini'), startHidden: settings.startHidden, countCacheReads: settings.countCacheReads, layout: settings.layout, mascot: settings.mascot,
    // theme: the skin shown (what the windows draw with); the picks behind it
    theme: shownTheme(), themeFixed: settings.theme, themeMode: settings.themeMode, themeDark: settings.themeDark, themeLight: settings.themeLight, systemDark: nativeTheme.shouldUseDarkColors,
    checkUpdates: settings.checkUpdates, downloadUpdates: settings.downloadUpdates, update: demoUpdate() || (updater ? updater.state() : null),
    notifications: settings.notifications, thresholds: settings.thresholds, thresholdChoices: THRESHOLD_CHOICES, forecastNotify: settings.forecastNotify, weeklySummary: settings.weeklySummary,
    sources: sources.map(s => ({ id: s.id, on: settings.sources[s.id] !== false, detected: !!s.enabled })),
    version: app.getVersion(),
    // demo screenshots show the usual install paths, not this machine's (user name, repo)
    dataDir: DEMO ? '%APPDATA%\\tokenmuncher' : app.getPath('userData'),
    exe: DEMO ? '%LOCALAPPDATA%\\Programs\\tokenmuncher\\TokenMuncher.exe' : process.execPath
  };
}
function testNotification() {
  const t = settings.thresholds;
  const body = t.length ? `Notifications work. You will see one like this at ${t.join(', ')}% of a limit.` : 'Notifications work, but every limit threshold is switched off in settings.';
  showNotification({ kind: 'threshold', level: 80, title: 'TokenMuncher test', body });
}
ipcMain.handle('settings:get', () => settingsView());
ipcMain.on('settings:set', (_e, name, value) => { if (typeof name === 'string') setOption(name, value); });
ipcMain.on('settings:test-notification', () => testNotification());
ipcMain.on('settings:open-data', () => shell.openPath(app.getPath('userData')));

// "copy diagnostics": the report goes to the clipboard (nothing is sent anywhere).
function diagnosticsReport() {
  const counts = {};
  for (const r of store.records) {
    const c = counts[r.provider] || (counts[r.provider] = { records: 0, sessions: 0, lastTs: 0 });
    c.records++;
    if (r.ts > c.lastTs) c.lastTs = r.ts;
  }
  for (const s of store.sessions.values()) (counts[s.provider] || (counts[s.provider] = { records: 0, sessions: 0, lastTs: 0 })).sessions++;
  return buildReport({
    app: { version: app.getVersion(), electron: process.versions.electron, os: `Windows ${os.release()}`, arch: process.arch, packaged: app.isPackaged },
    settings, counts, update: updater ? updater.state() : null,
    sources: sources.map(s => {
      let diagnostics = null;
      try { diagnostics = s.diagnostics ? s.diagnostics() : null; } catch (e) { diagnostics = { error: e.message }; }
      // limits from the source itself (also when hidden), with the current estimate where there is one
      let limits = [];
      try { limits = s.enabled ? s.limits().map(l => ({ ...l, est: aggregator.anchors.get(l.key) ? aggregator.anchors.get(l.key).est : null })) : []; } catch (e) { diagnostics = { ...diagnostics, limitsError: e.message }; }
      return { id: s.id, detected: !!s.enabled, off: !!s.off, status: s.status(), limits, diagnostics };
    }),
    home: os.homedir(), user: os.userInfo().username
  });
}
ipcMain.handle('settings:diagnostics', () => {
  const text = diagnosticsReport();
  clipboard.writeText(text);
  return text.length;
});

// ── updates ──
// One notification per version: "is available" when it waits for a click,
// "is ready to install" once a background download has finished.
function onUpdateFound(version) {
  if (settings.downloadUpdates) return; // "ready" follows, or "available" when the download fails
  notifyUpdate(version, `TokenMuncher ${version} is available`);
}
function onUpdateFailed(version) {
  if (installing) return; // the panel in front of the user shows the error
  notifyUpdate(version, `TokenMuncher ${version} is available`);
}
function onUpdateReady(version) {
  if (installing) return; // the user asked for it and is being taken to the installer
  notifyUpdate(version + ' ready', `TokenMuncher ${version} is ready to install`);
}
function notifyUpdate(key, title) {
  if (settings.updateNotified === key) return;
  settings.updateNotified = key;
  saveSettings();
  if (settings.notifications) showNotification({ kind: 'reset', title, body: 'Open TokenMuncher → settings (or the tray menu) to install it.' });
}
// TM_UPDATE=available|downloading|ready (demo mode): the updates panel and the
// status bar as they look in that state, without a release or a download.
function demoUpdate() {
  const status = DEMO && process.env.TM_UPDATE;
  if (!['available', 'downloading', 'ready'].includes(status)) return null;
  const size = 81600212, got = status === 'ready' ? size : status === 'downloading' ? 27800000 : 0;
  return { status, latest: '9.9.9', page: 'https://github.com/', checkedAt: Date.now() - 120e3, error: null, progress: Math.floor(got / size * 100), got, size, speed: status === 'downloading' ? 180000 : 0 };
}
const updateWaiting = () => !!updater && ['available', 'ready'].includes(updater.state().status);
// Asks, downloads the installer unless it is already there, starts it and
// quits; the installer replaces this copy and starts the new one.
let installing = false; // one dialog / download at a time (tray, [u] and the panel can all ask)
async function installUpdate() {
  if (installing || !updater || !updater.release || !updateWaiting()) return;
  installing = true;
  try { await runInstall(); } finally { installing = false; }
}
async function runInstall() {
  const { version, asset } = updater.release;
  const parent = win && win.isVisible() ? win : undefined;
  const ready = updater.state().status === 'ready';
  const r = await dialog.showMessageBox(parent, {
    type: 'question', title: 'TokenMuncher', buttons: [ready ? 'Install now' : 'Download and install', ready ? 'Later' : 'Cancel'], defaultId: 0, cancelId: 1,
    message: `Install TokenMuncher ${version}?`,
    detail: (ready ? 'The installer is already downloaded and is started now.' : `The installer (${Math.round(asset.size / 1e6)} MB) is downloaded from GitHub and started.`) + ' TokenMuncher closes while it runs and starts again afterwards. Settings and history stay.'
  });
  if (r.response !== 0) return;
  let file;
  // (at once when it is already downloaded; the panel shows an error)
  // The release may have changed while the dialog was open (checks go on):
  // only the version that was confirmed is installed.
  try { file = await updater.download(version); } catch (e) { console.error('update', e.message); return; }
  // --updated: same folder, no folder page. Quit only once it really started
  // (antivirus or SmartScreen may block it); otherwise keep running and say why.
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(file, ['--updated'], { detached: true, stdio: 'ignore' });
      child.once('spawn', () => { child.unref(); resolve(); });
      child.once('error', reject);
    });
  } catch (e) {
    updater.failed('could not start the installer: ' + e.message);
    return;
  }
  quitting = true;
  app.quit();
}
const isReleasePage = u => typeof u === 'string' && u.startsWith('https://github.com/');
ipcMain.on('update:check', () => updater && updater.check(true));
ipcMain.on('update:install', () => installUpdate());
ipcMain.on('update:cancel', () => updater && updater.cancel());
ipcMain.on('update:page', () => { const u = updater && updater.state().page; if (isReleasePage(u)) shell.openExternal(u); });

app.on('second-instance', (_e, _argv, _cwd, data) => install.onSecondInstance(data, showWindow));
app.on('before-quit', () => { quitting = true; rememberBounds(); if (mini) mini.destroy(); if (ready && !DEMO) usageCache.saveSync(); limitHistory.flushSync(); });
if (DEMO) app.on('quit', () => { try { fs.rmSync(DEMO_DIR, { recursive: true, force: true }); } catch { /* still in use */ } });
app.on('window-all-closed', () => { if (quitting || SHOT) app.quit(); });

app.whenReady().then(() => {
  if (!gotLock) return install.handleLockTaken();
  loadSettings();
  // TM_THEME=<skin> (demo mode): screenshots of each skin
  if (DEMO && process.env.TM_THEME) {
    const t = normalize({ theme: process.env.TM_THEME }).theme;
    settings.theme = t;
    settings[themeOf(t).light ? 'themeLight' : 'themeDark'] = t; // also with TM_THEME_MODE=auto
  }
  if (DEMO && process.env.TM_MASCOT) settings.mascot = normalize({ mascot: process.env.TM_MASCOT }).mascot;
  if (DEMO && process.env.TM_THEME_MODE) settings.themeMode = normalize({ themeMode: process.env.TM_THEME_MODE }).themeMode;
  // TM_SYSTEM=dark|light: this test instance (TM_DEMO or TM_PROFILE only) acts
  // as if Windows were in that mode; TM_SYSTEM_FLIP=<ms>: switch it once after
  // that long. The instance then stays in that mode; the system is not touched.
  const testInstance = DEMO || !!process.env.TM_PROFILE;
  if (testInstance && ['dark', 'light'].includes(process.env.TM_SYSTEM)) nativeTheme.themeSource = process.env.TM_SYSTEM;
  if (testInstance && Number(process.env.TM_SYSTEM_FLIP) > 0) {
    setTimeout(() => { nativeTheme.themeSource = nativeTheme.shouldUseDarkColors ? 'light' : 'dark'; }, Number(process.env.TM_SYSTEM_FLIP));
  }
  if (!DEMO) install.ensureStartMenuShortcut(APP_ID);
  styledLook = JSON.stringify(look()); // the windows and tray below start in it
  createWindow();
  mini = new MiniWidget({
    settings, save: saveSettings, preload: PRELOAD, indexFile: INDEX,
    openDashboard: showWindow, onChange: optionsChanged, onShow: () => { setImmediate(tick); miniLook = null; sendSettings(); }, // a hidden widget may have missed a skin change
    background: () => themeOf(shownTheme()).c.bg, look
  });
  if (SHOT) settings.mini.on = !!process.env.TM_MINI; // screenshots don't depend on saved state
  mini.init();
  if (!SHOT) {
    tray = new TrayIcon({
      toggleWindow,
      refresh: () => sources.forEach(src => !src.off && src.refresh && src.refresh()),
      testNotification,
      openSettings: () => { showWindow(); if (win) win.webContents.send('goto', 'settings'); },
      update: () => (updateWaiting() ? updater.state().latest : null),
      installUpdate,
      quit: () => { quitting = true; app.quit(); },
      getOption, setOption, look
    });
  }
  // Windows switched between dark and light: the auto mode follows at once.
  // (Electron also fires this for accent or contrast changes: those redraw nothing.)
  nativeTheme.on('updated', () => { if (restyle()) sendSettings(); });
  // Autostart from an older copy (e.g. the portable exe) moves to this installation.
  if (!DEMO) install.migrateAutostart(APP_ID).then(moved => { if (moved) optionsChanged(); });
  if (process.env.TM_NOTIFY_TEST) setTimeout(() => showNotification({ kind: 'threshold', level: 80, title: 'TokenMuncher test', body: 'test' }), 1500);
  for (const src of sources) if (src.start && !src.off) src.start(tick);
  pollsStarted = true;
  updater = new Updater({
    current: app.getVersion(), arch: process.arch, tmpDir: app.getPath('temp'),
    enabled: () => settings.checkUpdates && !DEMO, onFound: onUpdateFound,
    auto: () => settings.downloadUpdates && !DEMO, onReady: onUpdateReady, onFailed: onUpdateFailed,
    // a download the user stopped stays stopped after a restart
    cancelled: () => settings.updateCancelled || null,
    setCancelled: v => { if (v) settings.updateCancelled = v; else delete settings.updateCancelled; saveSettings(); },
    // download progress only refreshes the panel, not the tray menu
    onChange: (_st, { progressOnly } = {}) => (progressOnly ? sendSettings() : optionsChanged())
  });
  if (!SHOT && !DEMO) updater.start();
  // Parsed usage from the last run; the logs are then read only from where it stopped.
  const t0 = Date.now();
  const cached = DEMO ? false : usageCache.load();
  const historyLoaded = limitHistory.load(); // async; history panels fill in when it is read
  if (DEMO) historyLoaded.then(() => {
    const demo = require('./sources/demo');
    demo.seedHistory(limitHistory, sources);
    demo.seedWeeks(weekSummaries, sources.flatMap(s => s.limits()));
    aggregator.histCache = null;
  });
  setInterval(() => limitHistory.flush(), 60e3);
  Promise.all(sources.map(src => src.init().catch(e => console.error(src.id, e)))).then(() => {
    ready = true;
    console.log(`usage ready in ${Date.now() - t0} ms (${cached ? 'from cache' : 'full read'})`);
    // TM_DIAG=<file>: write the diagnostics report there once the first polls are in, then quit (tests)
    if (process.env.TM_DIAG) setTimeout(() => { tick(); fs.writeFileSync(process.env.TM_DIAG, diagnosticsReport()); app.exit(0); }, 8000);
    tick();
    if (!DEMO) { usageCache.save(); setInterval(() => usageCache.save(), CACHE_SAVE_MS); }
  });
  setInterval(async () => {
    if (ready) for (const src of sources) { try { await src.tick(); } catch (e) { console.error(src.id, e); } }
    tick();
  }, 1000);
});
