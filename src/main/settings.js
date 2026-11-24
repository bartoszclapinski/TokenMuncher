// User settings (settings.json): defaults, validation and the fields the
// settings panel may change. No Electron here, so it is unit-tested.
const layout = require('../shared/layout');
const { THEMES, THEME_IDS, DEFAULT_THEME, MASCOT_CHOICES } = require('../shared/themes');

const SOURCE_IDS = ['claude', 'cursor', 'codex', 'copilot'];
const THRESHOLD_CHOICES = [50, 70, 80, 90, 100];

const DEFAULTS = {
  notifications: true,
  thresholds: [80, 90, 100],   // percent of a limit that triggers a notification
  forecastNotify: true,        // "runs out in ~N min" warning for the 5h window
  weeklySummary: true,         // one notification summing up the week when the weekly limit resets
  startHidden: false,          // a manual start goes to the tray like an autostart
  countCacheReads: true,       // token counts include cache reads
  checkUpdates: true,          // look for a newer release on GitHub every 6 h
  downloadUpdates: true,       // download a found update in the background
  theme: DEFAULT_THEME,        // skin (shared/themes.js) in the fixed mode
  themeMode: 'fixed',          // 'fixed' (theme) or 'auto' (follow Windows: themeDark / themeLight)
  themeDark: DEFAULT_THEME,    // auto mode, Windows dark: a dark skin
  themeLight: 'paper',         // auto mode, Windows light: a light skin
  hotkeyWindow: '',            // global shortcut that shows / hides the window ('' = off)
  hotkeyMini: '',              // global shortcut that shows / hides the mini widget ('' = off)
  mascot: 'auto',              // the mascot (shared/critter.js), or 'auto' = the skin's own
  sources: Object.fromEntries(SOURCE_IDS.map(id => [id, true]))
};

// The on/off settings the panel can switch (each a key of DEFAULTS).
const BOOL_KEYS = ['notifications', 'forecastNotify', 'weeklySummary', 'startHidden', 'countCacheReads', 'checkUpdates', 'downloadUpdates'];

// ── global shortcuts: Electron accelerators such as "Ctrl+Shift+T" ──
const HOTKEY_KEYS = ['hotkeyWindow', 'hotkeyMini'];
const HOTKEY_MODS = { ctrl: 'Ctrl', control: 'Ctrl', commandorcontrol: 'CommandOrControl', cmdorctrl: 'CommandOrControl', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Super', cmd: 'Super', command: 'Super', win: 'Super' };
const HOTKEY_NAMED = ['Space', 'Tab', 'Enter', 'Return', 'Backspace', 'Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right', 'Plus', 'Escape'];
// numeric keypad keys, as Electron names them (written in lower case)
const HOTKEY_NUMPAD = ['num0', 'num1', 'num2', 'num3', 'num4', 'num5', 'num6', 'num7', 'num8', 'num9', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv'];
const isHotkeyKey = k => /^[A-Za-z0-9]$/.test(k) || /^F([1-9]|1\d|2[0-4])$/i.test(k) || HOTKEY_NAMED.some(n => n.toLowerCase() === k.toLowerCase()) || HOTKEY_NUMPAD.includes(k.toLowerCase()) || /^[-=;,./`'[\]\\]$/.test(k);
// An accelerator checked and written canonically (modifiers, then one key),
// or null when it is not usable. A global shortcut needs Ctrl, Alt or Win:
// a bare key, or one with Shift alone (Shift+T is a capital T, Shift+Space a
// space), would swallow ordinary typing in every app.
function parseHotkey(v) {
  if (typeof v !== 'string' || !v || v.length > 40) return null;
  const parts = v.split('+').map(p => p.trim());
  if (parts.length > 2 && parts[parts.length - 1] === '' && parts[parts.length - 2] === '') { parts.pop(); parts[parts.length - 1] = '+'; }
  const key = parts.pop();
  if (!key || !(isHotkeyKey(key) || key === '+')) return null;
  const mods = [];
  for (const p of parts) {
    const m = HOTKEY_MODS[p.toLowerCase()];
    if (!m || mods.includes(m)) return null;
    mods.push(m);
  }
  if (!mods.some(m => m !== 'Shift')) return null;
  // CommandOrControl is Ctrl on Windows / Linux and Cmd (Super) on macOS, so
  // next to either of those it names the same modifier twice
  if (mods.includes('CommandOrControl') && (mods.includes('Ctrl') || mods.includes('Super'))) return null;
  const order = ['CommandOrControl', 'Ctrl', 'Alt', 'Shift', 'Super'];
  mods.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const lower = key.toLowerCase();
  // the plus key is written "Plus": Electron splits an accelerator on '+', so "Ctrl++" is not one
  const k = key === '+' ? 'Plus' : key.length === 1 ? key.toUpperCase() :HOTKEY_NAMED.find(n => n.toLowerCase() === lower) || (HOTKEY_NUMPAD.includes(lower) ? lower : key.toUpperCase());
  return [...mods, k].join('+');
}
const hotkey = v => parseHotkey(v) || '';
const HOTKEY_LABEL = { hotkeyWindow: 'the window', hotkeyMini: 'the mini widget' };

// Why registering `accel` failed, as the user is told: 'taken' (register()
// returned false: Electron does that when another app holds the combination,
// though it cannot say so for sure) or 'refused' (register() threw: Electron
// did not accept the accelerator at all).
function hotkeyFailure(accel, why) {
  return why === 'refused'
    ? `${accel} could not be registered: Electron does not accept this combination`
    : `${accel} could not be registered: another app is probably using it`;
}
// reg.register(accel, name) -> null when it worked, else 'taken' / 'refused'.
function tryRegister(reg, accel, name) {
  try { return reg.register(accel, name) ? null : 'taken'; } catch { return 'refused'; }
}

// One shortcut from the settings panel: validated and registered first, put
// in settings `s` only when both work. `errors` holds name -> why a stored
// shortcut is not registered (e.g. it failed at startup); `reg` is
// { register(accel, name) -> bool (may throw, as Electron's does), unregister(accel) }.
// Returns { ok, error, changed } (changed: s was modified and needs saving).
function setHotkey(s, errors, name, value, reg) {
  if (!HOTKEY_KEYS.includes(name) || typeof value !== 'string') return { ok: false, error: 'Unknown shortcut' };
  const accel = value === '' ? '' : parseHotkey(value);
  if (accel === null) return { ok: false, error: 'Not a valid shortcut: use Ctrl, Alt or Win (Shift alone is not enough) and one key' };
  const other = HOTKEY_KEYS.find(k => k !== name);
  if (accel && s[other] === accel) return { ok: false, error: `${accel} is already the shortcut for ${HOTKEY_LABEL[other]}` };
  const old = s[name];
  const oldActive = !!old && !errors[name]; // stored and actually registered
  let changed = false;
  // the same combination that already works: nothing to do. The same one that
  // failed (e.g. at startup) is tried again, and still refused if taken.
  if (!(accel === old && (!accel || oldActive))) {
    if (oldActive) reg.unregister(old);
    const failed = accel && tryRegister(reg, accel, name);
    if (failed) {
      // keep the working one; when even that fails (another app took it in
      // between), `errors` says so: the field must not show a shortcut that
      // silently stopped working
      const lost = oldActive && tryRegister(reg, old, name);
      if (lost) errors[name] = hotkeyFailure(old, lost);
      return { ok: false, error: hotkeyFailure(accel, failed) + (lost ? `. The shortcut set before, ${old}, could not be registered again either and is not active` : '') };
    }
    if (accel !== old) { s[name] = accel; changed = true; }
  }
  delete errors[name];
  return { ok: true, changed };
}

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const THEME_MODES = ['fixed', 'auto'];
// a known skin that is light (or dark)
const isSkin = (id, light) => THEME_IDS.includes(id) && THEMES[id].light === light;

// The skin shown: the fixed one, or in auto mode the dark or the light pick,
// by the system's mode.
const activeTheme = (s, systemDark) => (s.themeMode === 'auto' ? (systemDark ? s.themeDark : s.themeLight) : s.theme);
function thresholds(v, d) {
  if (!Array.isArray(v)) return d.slice();
  return [...new Set(v.filter(t => THRESHOLD_CHOICES.includes(t)))].sort((a, b) => a - b);
}

// Settings from disk (any shape) -> defaults filled in, known fields checked.
// Unknown keys (window bounds, mini widget, notification state) are kept.
function normalize(raw) {
  const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...raw } : {};
  for (const k of BOOL_KEYS) s[k] = bool(s[k], DEFAULTS[k]);
  s.thresholds = thresholds(s.thresholds, DEFAULTS.thresholds);
  for (const k of HOTKEY_KEYS) s[k] = hotkey(s[k]);
  // one combination cannot do both (a hand-edited file): the window keeps it
  if (s.hotkeyMini && s.hotkeyMini === s.hotkeyWindow) s.hotkeyMini = '';
  if (!THEME_IDS.includes(s.theme)) s.theme = DEFAULTS.theme;
  if (!MASCOT_CHOICES.includes(s.mascot)) s.mascot = DEFAULTS.mascot;
  if (!THEME_MODES.includes(s.themeMode)) s.themeMode = DEFAULTS.themeMode;
  if (!isSkin(s.themeDark, false)) s.themeDark = DEFAULTS.themeDark;
  if (!isSkin(s.themeLight, true)) s.themeLight = DEFAULTS.themeLight;
  const src = s.sources && typeof s.sources === 'object' ? s.sources : {};
  s.sources = Object.fromEntries(SOURCE_IDS.map(id => [id, bool(src[id], true)]));
  // panel layout per view (see shared/layout.js): only views the user changed
  // are stored, so a view on the default follows future defaults
  const lay = s.layout && typeof s.layout === 'object' ? s.layout : {};
  s.layout = {};
  for (const view of Object.keys(layout.PANELS)) if (lay[view]) setLayout(s, view, lay[view]);
  return s;
}

// One change from the settings panel. Names: one of BOOL_KEYS, thresholds
// (array), threshold:<n> (toggle one), source:<id>, layout:<view> (a whole
// layout, validated), theme (a skin id), mascot (a mascot id or 'auto'),
// themeMode ('fixed' / 'auto'), themeDark (a dark skin), themeLight (a light skin).
// Global shortcuts (HOTKEY_KEYS) are not changed here: they are saved only by
// main.js setHotkey, after they registered.
// Returns true when something changed; anything else is ignored.
// A view's layout, validated; one equal to the default is not stored.
function setLayout(s, view, value) {
  const l = layout.normalize(value, view);
  if (JSON.stringify(l) === JSON.stringify(layout.defaults(view))) delete s.layout[view];
  else s.layout[view] = l;
}

const editable = s => JSON.stringify([BOOL_KEYS.map(k => s[k]), s.thresholds, s.sources, s.layout, s.theme, s.mascot, HOTKEY_KEYS.map(k => s[k]), s.themeMode, s.themeDark, s.themeLight]);
function applyChange(s, name, value) {
  const before = editable(s);
  if (BOOL_KEYS.includes(name) && typeof value === 'boolean') s[name] = value;
  else if (name === 'thresholds') s.thresholds = thresholds(value, s.thresholds);
  else if (name === 'theme') { if (THEME_IDS.includes(value)) s.theme = value; }
  else if (name === 'mascot') { if (MASCOT_CHOICES.includes(value)) s.mascot = value; }
  else if (name === 'themeMode') { if (THEME_MODES.includes(value)) s.themeMode = value; }
  else if (name === 'themeDark') { if (isSkin(value, false)) s.themeDark = value; }
  else if (name === 'themeLight') { if (isSkin(value, true)) s.themeLight = value; }
  else if (name.startsWith('threshold:') && typeof value === 'boolean') {
    const t = Number(name.slice(10));
    if (THRESHOLD_CHOICES.includes(t)) s.thresholds = thresholds(value ? s.thresholds.concat(t) : s.thresholds.filter(x => x !== t), s.thresholds);
  } else if (name.startsWith('source:') && typeof value === 'boolean') {
    const id = name.slice(7);
    if (SOURCE_IDS.includes(id)) s.sources = { ...s.sources, [id]: value };
  } else if (name.startsWith('layout:')) {
    const view = name.slice(7);
    if (Object.hasOwn(layout.PANELS, view)) { s.layout = { ...s.layout }; setLayout(s, view, value); }
  }
  return editable(s) !== before;
}

module.exports = { DEFAULTS, BOOL_KEYS, SOURCE_IDS, THRESHOLD_CHOICES, HOTKEY_KEYS, parseHotkey, setHotkey, tryRegister, hotkeyFailure, normalize, applyChange, activeTheme };
