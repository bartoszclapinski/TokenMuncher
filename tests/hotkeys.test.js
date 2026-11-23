const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHotkey, setHotkey, normalize, applyChange } = require('../src/main/settings');
const { accelFromEvent } = require('../src/shared/hotkey');

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
  for (const code of ['KeyZ', 'Digit0', 'Numpad7', 'Minus', 'Equal', 'Comma', 'Period', 'Slash', 'Backquote', 'Quote', 'BracketLeft', 'BracketRight', 'Backslash', 'Space', 'Enter', 'Tab', 'Home', 'PageDown', 'F24']) {
    const { accel } = accelFromEvent(ev(code, '?', { ctrlKey: true, shiftKey: true }));
    assert.equal(parseHotkey(accel), accel, code);
  }
});
