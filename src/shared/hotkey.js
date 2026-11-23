// A keydown event -> an Electron accelerator such as "Ctrl+Shift+1", or null
// while only modifiers are held. The key comes from the physical key
// (e.code), not the typed character (e.key): with Shift a digit types '!',
// and on AltGr layouts (Polish and others) Ctrl+Alt+A types 'ą', neither of
// which is a usable accelerator key.
const CODE_KEYS = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Escape: 'Escape',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', Semicolon: ';', Comma: ',', Period: '.', Slash: '/', Backquote: '`', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Backslash: '\\', IntlBackslash: '\\',
};
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^AltGraph$/;

function keyFromCode(code) {
  if (typeof code !== 'string') return null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^(?:Digit|Numpad)([0-9])$/.exec(code))) return m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] || null;
}

// { code, key, ctrlKey, altKey, shiftKey, metaKey } -> { accel } | { modifierOnly } | { unknown }
function accelFromEvent(e) {
  if (MODIFIER_CODES.test(e.code || '') || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return { modifierOnly: true };
  const k = keyFromCode(e.code);
  if (!k) return { unknown: true };
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return { accel: [...mods, k].join('+') };
}

module.exports = { keyFromCode, accelFromEvent };
