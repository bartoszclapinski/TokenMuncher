const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHotkey, setHotkey, normalize, applyChange } = require('../src/main/settings');
const { accelFromEvent, recordKey, recorderProps, hotkeyField } = require('../src/shared/hotkey');

test('global shortcuts are off by default', () => {
  const s = normalize({});
  assert.equal(s.hotkeyWindow, '');
  assert.equal(s.hotkeyMini, '');
});

test('parseHotkey accepts modifier + key and canonicalizes', () => {
  assert.equal(parseHotkey('Ctrl+Shift+T'), 'Ctrl+Shift+T');
  assert.equal(parseHotkey('shift+ctrl+t'), 'Ctrl+Shift+T');
  assert.equal(parseHotkey('Alt+F12'), 'Alt+F12');
  assert.equal(parseHotkey('CommandOrControl+Alt+Space'), 'CommandOrControl+Alt+Space');
  assert.equal(parseHotkey('Ctrl++'), 'Ctrl++');
});

test('parseHotkey refuses invalid combinations', () => {
  for (const bad of ['', 'T', 'F5', 'Ctrl', 'Ctrl+', 'Ctrl+Shift', 'Ctrl+Ctrl+T', 'Foo+T', 'Ctrl+TT', 'Ctrl+F25', 'Ctrl+T+Y', null, 5, {}, 'Ctrl+' + 'a'.repeat(50)]) {
    assert.equal(parseHotkey(bad), null, String(bad));
  }
});

test('parseHotkey refuses CommandOrControl next to Ctrl or Super (same modifier twice)', () => {
  for (const bad of ['CommandOrControl+Ctrl+T', 'Ctrl+CmdOrCtrl+T', 'CommandOrControl+Super+T', 'CmdOrCtrl+Cmd+T']) {
    assert.equal(parseHotkey(bad), null, bad);
  }
  assert.equal(parseHotkey('CmdOrCtrl+Shift+T'), 'CommandOrControl+Shift+T');
});

test('hotkeys: normalize drops bad stored values', () => {
  assert.equal(normalize({ hotkeyWindow: 'nonsense' }).hotkeyWindow, '');
  assert.equal(normalize({ hotkeyMini: 'ctrl+alt+m' }).hotkeyMini, 'Ctrl+Alt+M');
});

test('hotkeys cannot be saved through the generic applyChange (only setHotkey, after registering)', () => {
  const s = normalize({});
  assert.equal(applyChange(s, 'hotkeyWindow', 'Ctrl+Alt+W'), false);
  assert.equal(s.hotkeyWindow, '');
});

// A fake globalShortcut: `taken` combinations fail to register.
function fakeReg(taken = []) {
  const active = new Set();
  return {
    active,
    register: a => (taken.includes(a) || active.has(a) ? false : (active.add(a), true)),
    unregister: a => { active.delete(a); },
  };
}

test('setHotkey registers and saves a valid, free combination', () => {
  const s = normalize({}), errors = {}, reg = fakeReg();
  assert.deepEqual(setHotkey(s, errors, 'hotkeyWindow', 'ctrl+shift+1', reg), { ok: true, changed: true });
  assert.equal(s.hotkeyWindow, 'Ctrl+Shift+1');
  assert.ok(reg.active.has('Ctrl+Shift+1'));
  // a new one replaces it
  assert.equal(setHotkey(s, errors, 'hotkeyWindow', 'Ctrl+Alt+W', reg).ok, true);
  assert.deepEqual([...reg.active], ['Ctrl+Alt+W']);
  // clearing unregisters
  assert.deepEqual(setHotkey(s, errors, 'hotkeyWindow', '', reg), { ok: true, changed: true });
  assert.equal(s.hotkeyWindow, '');
  assert.equal(reg.active.size, 0);
});

test('setHotkey refuses invalid, duplicate and taken combinations without saving', () => {
  const s = normalize({ hotkeyMini: 'Ctrl+Alt+M' }), errors = {}, reg = fakeReg(['Ctrl+Alt+T']);
  reg.register('Ctrl+Alt+M', 'hotkeyMini');
  for (const [v, re] of [['W', /Not a valid/], ['Ctrl+Alt+M', /already the shortcut for the mini widget/], ['Ctrl+Alt+T', /could not be registered/]]) {
    const r = setHotkey(s, errors, 'hotkeyWindow', v, reg);
    assert.equal(r.ok, false, v);
    assert.match(r.error, re);
    assert.equal(s.hotkeyWindow, '');
  }
  assert.equal(setHotkey(s, errors, 'nope', 'Ctrl+T', reg).ok, false);
});

test('setHotkey keeps the working shortcut when the new one is taken', () => {
  const s = normalize({}), errors = {}, reg = fakeReg(['Ctrl+Alt+T']);
  setHotkey(s, errors, 'hotkeyWindow', 'Ctrl+Alt+W', reg);
  assert.equal(setHotkey(s, errors, 'hotkeyWindow', 'Ctrl+Alt+T', reg).ok, false);
  assert.equal(s.hotkeyWindow, 'Ctrl+Alt+W');
  assert.deepEqual([...reg.active], ['Ctrl+Alt+W']);
});

test('setHotkey retries a stored shortcut that failed at startup instead of reporting success', () => {
  const s = normalize({ hotkeyWindow: 'Ctrl+Alt+T' });
  const errors = { hotkeyWindow: 'Ctrl+Alt+T is already used by another app' };
  // still taken: refused, error kept
  const r = setHotkey(s, errors, 'hotkeyWindow', 'Ctrl+Alt+T', fakeReg(['Ctrl+Alt+T']));
  assert.equal(r.ok, false);
  assert.match(r.error, /could not be registered/);
  assert.ok(errors.hotkeyWindow);
  // freed meanwhile: registered now, error cleared, nothing to save
  const reg = fakeReg();
  assert.deepEqual(setHotkey(s, errors, 'hotkeyWindow', 'Ctrl+Alt+T', reg), { ok: true, changed: false });
  assert.ok(reg.active.has('Ctrl+Alt+T'));
  assert.equal(errors.hotkeyWindow, undefined);
  // the same working one again: no re-registration needed
  assert.deepEqual(setHotkey(s, errors, 'hotkeyWindow', 'Ctrl+Alt+T', reg), { ok: true, changed: false });
});

test('accelFromEvent uses the physical key, so Shift and AltGr layouts work', () => {
  const ev = (code, key, mods = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });
  assert.deepEqual(accelFromEvent(ev('Digit1', '!', { ctrlKey: true, shiftKey: true })), { accel: 'Ctrl+Shift+1' });
  assert.deepEqual(accelFromEvent(ev('KeyA', 'ą', { ctrlKey: true, altKey: true })), { accel: 'Ctrl+Alt+A' });
  assert.deepEqual(accelFromEvent(ev('Semicolon', ':', { ctrlKey: true, shiftKey: true })), { accel: 'Ctrl+Shift+;' });
  assert.deepEqual(accelFromEvent(ev('ArrowUp', 'ArrowUp', { altKey: true })), { accel: 'Alt+Up' });
  assert.deepEqual(accelFromEvent(ev('F5', 'F5', { ctrlKey: true })), { accel: 'Ctrl+F5' });
  assert.deepEqual(accelFromEvent(ev('ShiftLeft', 'Shift', { shiftKey: true })), { modifierOnly: true });
  assert.deepEqual(accelFromEvent(ev('AltRight', 'AltGraph', { ctrlKey: true, altKey: true })), { modifierOnly: true });
  assert.deepEqual(accelFromEvent(ev('MediaPlayPause', 'MediaPlayPause', { ctrlKey: true })), { unknown: true });
  // every recorded combination with a modifier is one parseHotkey accepts
  for (const code of ['KeyZ', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Backquote', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash', 'Space', 'Enter', 'Tab', 'Home', 'PageDown', 'F24']) {
    const { accel } = accelFromEvent(ev(code, '?', { ctrlKey: true, shiftKey: true }));
    assert.equal(parseHotkey(accel), accel, code);
  }
});

test('parseHotkey refuses Shift as the only modifier (it would swallow typing in every app)', () => {
  for (const bad of ['Shift+T', 'Shift+Space', 'Shift+1', 'shift+F5', 'Shift+num7']) assert.equal(parseHotkey(bad), null, bad);
  assert.equal(parseHotkey('Alt+Shift+T'), 'Alt+Shift+T');
  assert.equal(parseHotkey('Super+Shift+Space'), 'Shift+Super+Space');
  assert.equal(normalize({ hotkeyWindow: 'Shift+T' }).hotkeyWindow, '');
  const s = normalize({});
  const r = setHotkey(s, {}, 'hotkeyWindow', 'Shift+T', fakeReg());
  assert.equal(r.ok, false);
  assert.match(r.error, /Shift alone is not enough/);
  assert.equal(s.hotkeyWindow, '');
});

const keyEvent = (code, key, mods = {}) => ({ code, key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test('numpad keys keep their own accelerator names', () => {
  // NumLock on: the keypad digit, not the top-row one
  assert.deepEqual(accelFromEvent(keyEvent('Numpad7', '7', { ctrlKey: true })), { accel: 'Ctrl+num7' });
  assert.deepEqual(accelFromEvent(keyEvent('Digit7', '7', { ctrlKey: true })), { accel: 'Ctrl+7' });
  assert.deepEqual(accelFromEvent(keyEvent('NumpadDecimal', ',', { ctrlKey: true })), { accel: 'Ctrl+numdec' });
  // NumLock off or Shift held: the key acts as (and is sent as) the navigation key
  assert.deepEqual(accelFromEvent(keyEvent('Numpad7', 'Home', { ctrlKey: true, shiftKey: true })), { accel: 'Ctrl+Shift+Home' });
  assert.deepEqual(accelFromEvent(keyEvent('Numpad0', 'Insert', { altKey: true })), { accel: 'Alt+Insert' });
  assert.deepEqual(accelFromEvent(keyEvent('Numpad5', 'Clear', { ctrlKey: true })), { unknown: true });
  assert.equal(parseHotkey('Ctrl+num7'), 'Ctrl+num7');
  assert.equal(parseHotkey('ctrl+NUM0'), 'Ctrl+num0');
  assert.equal(parseHotkey('Alt+NumAdd'), 'Alt+numadd');
  assert.equal(parseHotkey('Ctrl+num10'), null);
  for (let d = 0; d <= 9; d++) {
    const { accel } = accelFromEvent(keyEvent('Numpad' + d, String(d), { ctrlKey: true, altKey: true }));
    assert.equal(parseHotkey(accel), accel);
  }
});

// The shortcut field as the Settings view drives it: recorderProps is every
// event prop of the element, so these are the handlers React calls.
function field(rec) {
  const log = [];
  const props = recorderProps(rec, { start: () => log.push('start'), stop: () => log.push('stop'), save: a => log.push('save:' + a), fail: m => log.push('fail:' + m) });
  const press = (code, key, mods = {}) => {
    const e = keyEvent(code, key, { repeat: false, prevented: false, stopped: false, ...mods });
    e.preventDefault = () => { e.prevented = true; };
    e.stopPropagation = () => { e.stopped = true; };
    props.onKeyDown(e);
    return e;
  };
  return { props, log, press };
}

test('shortcut field, idle: click, Enter or Space starts recording; other keys pass through', () => {
  let f = field(false);
  f.props.onClick();
  assert.deepEqual(f.log, ['start']);
  for (const [code, key] of [['Enter', 'Enter'], ['Space', ' ']]) {
    f = field(false);
    const e = f.press(code, key);
    assert.deepEqual(f.log, ['start']);
    assert.ok(e.prevented);
  }
  f = field(false);
  f.press('Enter', 'Enter', { repeat: true });
  assert.deepEqual(f.log, []);
  const e = f.press('KeyM', 'm');
  assert.deepEqual(f.log, []);
  assert.equal(e.prevented, false); // the app's own [m] still works on an idle field
  assert.equal(e.stopped, false);
  assert.equal(f.props.tabIndex, 0);
});

test('shortcut field, recording: the pressed combination is saved and never reaches the page shortcuts', () => {
  let f = field(true);
  // modifiers alone: keep waiting, but already swallowed
  let e = f.press('ControlLeft', 'Control', { ctrlKey: true });
  assert.deepEqual(f.log, []);
  assert.ok(e.prevented && e.stopped);
  e = f.press('KeyM', 'm', { ctrlKey: true, altKey: true });
  assert.deepEqual(f.log, ['stop', 'save:Ctrl+Alt+M']);
  assert.ok(e.prevented && e.stopped);
  // keys the page binds (m, t, 1, 2), bare or with Shift: swallowed, sent to main (which refuses them)
  for (const [code, key, mods, accel] of [['KeyM', 'm', {}, 'M'], ['KeyT', 'T', { shiftKey: true }, 'Shift+T'], ['Digit1', '1', {}, '1'], ['Digit2', '@', { shiftKey: true }, 'Shift+2']]) {
    f = field(true);
    e = f.press(code, key, mods);
    assert.ok(e.prevented && e.stopped, accel);
    assert.deepEqual(f.log, ['stop', 'save:' + accel]);
    assert.equal(parseHotkey(accel), null);
  }
  // a held key repeating is not a second combination
  f = field(true);
  e = f.press('Enter', 'Enter', { repeat: true });
  assert.deepEqual(f.log, []);
  assert.ok(e.prevented && e.stopped);
});

test('shortcut field, recording: Esc cancels, Backspace / Delete clears, Tab leaves, unknown keys say so', () => {
  let f = field(true);
  let e = f.press('Escape', 'Escape');
  assert.deepEqual(f.log, ['stop']);
  assert.ok(e.prevented && e.stopped); // not the page's Esc
  for (const code of ['Backspace', 'Delete']) {
    f = field(true);
    f.press(code, code);
    assert.deepEqual(f.log, ['stop', 'save:']);
  }
  f = field(true);
  f.press('Delete', 'Delete', { ctrlKey: true, altKey: true });
  assert.deepEqual(f.log, ['stop', 'save:Ctrl+Alt+Delete']);
  for (const mods of [{}, { shiftKey: true }]) {
    f = field(true);
    e = f.press('Tab', 'Tab', mods);
    assert.deepEqual(f.log, ['stop']);
    assert.equal(e.prevented, false); // focus moves on
  }
  f = field(true);
  f.press('MediaPlayPause', 'MediaPlayPause', { ctrlKey: true });
  assert.equal(f.log[0], 'stop');
  assert.match(f.log[1], /^fail:That key cannot be used/);
  f = field(true);
  f.props.onBlur();
  assert.deepEqual(f.log, ['stop']);
});

test('recordKey sorts a keydown', () => {
  assert.deepEqual(recordKey(keyEvent('ShiftLeft', 'Shift', { shiftKey: true })), { wait: true });
  assert.deepEqual(recordKey(keyEvent('KeyA', 'a', { ctrlKey: true, repeat: true })), { wait: true });
  assert.deepEqual(recordKey(keyEvent('Escape', 'Escape')), { cancel: true });
  assert.deepEqual(recordKey(keyEvent('Escape', 'Escape', { ctrlKey: true, shiftKey: true })), { accel: 'Ctrl+Shift+Escape' });
  assert.deepEqual(recordKey(keyEvent('Tab', 'Tab', { ctrlKey: true })), { accel: 'Ctrl+Tab' });
  assert.deepEqual(recordKey(keyEvent('Numpad3', '3', { ctrlKey: true })), { accel: 'Ctrl+num3' });
});

// ── main-process manager + the Settings field, end to end ──
const { Hotkeys } = require('../src/main/hotkeys');

// A fake Electron globalShortcut. `taken`: held by another app (register
// returns false); `refused`: accelerators Electron rejects (register throws).
// press(accel) is the OS: a registered combination fires its action and never
// reaches the focused window.
function fakeGlobalShortcut({ taken = [], refused = [] } = {}) {
  const active = new Map();
  return {
    active,
    register(a, fn) {
      if (refused.includes(a)) throw new Error('conversion failure');
      if (taken.includes(a) || active.has(a)) return false;
      active.set(a, fn);
      return true;
    },
    unregister: a => { active.delete(a); },
    unregisterAll: () => active.clear(),
    press: a => { const fn = active.get(a); if (fn) fn(); return !!fn; },
  };
}

function setup(stored = {}, opts = {}) {
  const fired = [];
  const s = normalize(stored);
  const gs = fakeGlobalShortcut(opts);
  const hk = new Hotkeys({
    shortcut: gs,
    actions: { hotkeyWindow: () => fired.push('window'), hotkeyMini: () => fired.push('mini') },
    settings: () => s,
    enabled: opts.enabled !== false,
  });
  hk.registerAll();
  return { s, gs, hk, fired };
}

test('Hotkeys registers the stored shortcuts at startup and they fire their actions', () => {
  const { gs, fired, hk } = setup({ hotkeyWindow: 'Ctrl+Alt+W', hotkeyMini: 'Ctrl+Alt+M' });
  assert.deepEqual([...gs.active.keys()].sort(), ['Ctrl+Alt+M', 'Ctrl+Alt+W']);
  gs.press('Ctrl+Alt+W');
  gs.press('Ctrl+Alt+M');
  assert.deepEqual(fired, ['window', 'mini']);
  assert.deepEqual(hk.errors, {});
  hk.unregisterAll();
  assert.equal(gs.active.size, 0);
});

test('Hotkeys tells a taken combination from one Electron refuses', () => {
  const { hk } = setup({ hotkeyWindow: 'Ctrl+Alt+T', hotkeyMini: 'Ctrl+Alt+M' }, { taken: ['Ctrl+Alt+T'], refused: ['Ctrl+Alt+M', 'Ctrl+Alt+R'] });
  assert.match(hk.errors.hotkeyWindow, /Ctrl\+Alt\+T could not be registered: another app is probably using it/);
  assert.match(hk.errors.hotkeyMini, /Ctrl\+Alt\+M could not be registered: Electron does not accept/);
  // the same from the settings panel
  const r = hk.set('hotkeyWindow', 'Ctrl+Alt+R');
  assert.equal(r.ok, false);
  assert.match(r.error, /Electron does not accept/);
  assert.doesNotMatch(r.error, /another app/);
});

test('Hotkeys in a demo instance registers nothing, at startup or from the settings panel', () => {
  const { s, gs, hk } = setup({ hotkeyWindow: 'Ctrl+Alt+W' }, { enabled: false });
  assert.equal(gs.active.size, 0);
  const r = hk.set('hotkeyMini', 'Ctrl+Alt+M');
  assert.equal(r.ok, false);
  assert.match(r.error, /demo/);
  assert.equal(s.hotkeyMini, '');
  hk.pause(); hk.resume();
  assert.equal(gs.active.size, 0);
});

test('Hotkeys pause / resume: nothing is registered while a field records', () => {
  const { gs, hk, fired } = setup({ hotkeyWindow: 'Ctrl+Alt+W' });
  hk.pause();
  assert.equal(gs.press('Ctrl+Alt+W'), false);
  assert.deepEqual(fired, []);
  hk.resume();
  assert.equal(gs.press('Ctrl+Alt+W'), true);
  assert.deepEqual(fired, ['window']);
  // a save while paused registers again first, so the old shortcut is replaced, not leaked
  hk.pause();
  assert.equal(hk.set('hotkeyWindow', 'Ctrl+Alt+X').ok, true);
  assert.deepEqual([...gs.active.keys()], ['Ctrl+Alt+X']);
  assert.equal(hk.paused, false);
});

// The Settings field (shared/hotkey.js hotkeyField) wired to the main process
// as preload.js does, with the OS in between: what the user sees after each step.
function settingsField(main, name, label) {
  const state = { rec: false, err: '' };
  const api = {
    setHotkey: async (n, v) => { const r = main.hk.set(n, v); return r.ok ? { ok: true } : { ok: false, error: r.error }; },
    pauseHotkeys: on => (on ? main.hk.pause() : main.hk.resume()),
  };
  const view = () => hotkeyField(state, { name, label, value: main.s[name], startupError: main.hk.errors[name], api, update: p => Object.assign(state, p) });
  return {
    view,
    click: () => view().chip.onClick(),
    // a key pressed while the window has focus: the OS takes it first
    async press(code, key, mods = {}) {
      const e = keyEvent(code, key, { repeat: false, ...mods });
      e.preventDefault = () => { e.defaultPrevented = true; };
      e.stopPropagation = () => {};
      const r = accelFromEvent(e);
      if (r.accel && main.gs.press(r.accel)) return 'swallowed by a global shortcut';
      view().chip.onKeyDown(e);
      await new Promise(setImmediate); // the save round trip
      return e.defaultPrevented ? 'taken by the field' : 'passed on';
    },
  };
}

test('Settings field: records a combination, saves it, and it works from any app afterwards', async () => {
  const main = setup();
  const f = settingsField(main, 'hotkeyWindow', 'show / hide window');
  assert.equal(f.view().text, 'off');
  assert.equal(f.view().chip['aria-label'], 'show / hide window shortcut');
  f.click();
  assert.equal(f.view().text, 'press a combination…');
  assert.equal(await f.press('KeyW', 'w', { ctrlKey: true, altKey: true }), 'taken by the field');
  assert.equal(f.view().text, 'Ctrl+Alt+W');
  assert.equal(f.view().error, '');
  assert.equal(main.s.hotkeyWindow, 'Ctrl+Alt+W');
  main.gs.press('Ctrl+Alt+W');
  assert.deepEqual(main.fired, ['window']);
  // [ clear ] turns it off
  await f.view().clear();
  assert.equal(f.view().text, 'off');
  assert.equal(main.gs.active.size, 0);
});

test('Settings field: re-recording the set combinations reaches the recorder instead of firing them', async () => {
  const main = setup({ hotkeyWindow: 'Ctrl+Alt+W', hotkeyMini: 'Ctrl+Alt+M' });
  const win = settingsField(main, 'hotkeyWindow', 'show / hide window');
  // the other field's combination: refused with a message, nothing toggled, nothing saved
  win.click();
  assert.equal(await win.press('KeyM', 'm', { ctrlKey: true, altKey: true }), 'taken by the field');
  assert.deepEqual(main.fired, []);
  assert.match(win.view().error, /Ctrl\+Alt\+M is already the shortcut for the mini widget/);
  assert.equal(win.view().text, 'Ctrl+Alt+W');
  assert.equal(main.s.hotkeyWindow, 'Ctrl+Alt+W');
  // the field's own combination: accepted as is, the window is not hidden
  win.click();
  assert.equal(win.view().error, '');
  assert.equal(await win.press('KeyW', 'w', { ctrlKey: true, altKey: true }), 'taken by the field');
  assert.deepEqual(main.fired, []);
  assert.equal(win.view().text, 'Ctrl+Alt+W');
  // recording over: both work again
  main.gs.press('Ctrl+Alt+W');
  main.gs.press('Ctrl+Alt+M');
  assert.deepEqual(main.fired, ['window', 'mini']);
});

test('Settings field: invalid and taken combinations show why and are not saved', async () => {
  const main = setup({}, { taken: ['Ctrl+Alt+T'] });
  const f = settingsField(main, 'hotkeyMini', 'show / hide mini widget');
  for (const [code, key, mods, re] of [
    ['KeyT', 'T', { shiftKey: true }, /Not a valid shortcut/],
    ['KeyT', 't', { ctrlKey: true, altKey: true }, /another app is probably using it/],
    ['MediaPlayPause', 'MediaPlayPause', { ctrlKey: true }, /cannot be used in a shortcut/],
  ]) {
    f.click();
    await f.press(code, key, mods);
    assert.match(f.view().error, re);
    assert.equal(f.view().text, 'off');
    assert.equal(main.s.hotkeyMini, '');
  }
  assert.equal(main.gs.active.size, 0);
  assert.equal(main.hk.paused, false);
});

test('Settings field: an idle field lets the page keys through; leaving a recording resumes the shortcuts', async () => {
  const main = setup({ hotkeyWindow: 'Ctrl+Alt+W' });
  const f = settingsField(main, 'hotkeyWindow', 'show / hide window');
  assert.equal(await f.press('KeyM', 'm'), 'passed on'); // the app's own [m]
  f.click();
  assert.equal(main.hk.paused, true);
  assert.equal(await f.press('Escape', 'Escape'), 'taken by the field');
  assert.equal(main.hk.paused, false);
  assert.equal(f.view().text, 'Ctrl+Alt+W');
  f.click();
  f.view().chip.onBlur();
  assert.equal(main.hk.paused, false);
  assert.equal(main.gs.press('Ctrl+Alt+W'), true);
  // a startup failure is shown next to the field
  const taken = setup({ hotkeyMini: 'Ctrl+Alt+T' }, { taken: ['Ctrl+Alt+T'] });
  assert.match(settingsField(taken, 'hotkeyMini', 'mini').view().error, /another app is probably using it/);
});
