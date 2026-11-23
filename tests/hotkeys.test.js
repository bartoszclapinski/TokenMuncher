const test = require('node:test');
const assert = require('node:assert/strict');
const { parseHotkey, normalize, applyChange } = require('../src/main/settings');

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

test('hotkeys: normalize drops bad stored values, applyChange validates', () => {
  assert.equal(normalize({ hotkeyWindow: 'nonsense' }).hotkeyWindow, '');
  assert.equal(normalize({ hotkeyMini: 'ctrl+alt+m' }).hotkeyMini, 'Ctrl+Alt+M');
  const s = normalize({});
  assert.equal(applyChange(s, 'hotkeyWindow', 'Ctrl+Alt+W'), true);
  assert.equal(s.hotkeyWindow, 'Ctrl+Alt+W');
  assert.equal(applyChange(s, 'hotkeyWindow', 'W'), false);
  assert.equal(s.hotkeyWindow, 'Ctrl+Alt+W');
  assert.equal(applyChange(s, 'hotkeyWindow', ''), true);
  assert.equal(s.hotkeyWindow, '');
});
