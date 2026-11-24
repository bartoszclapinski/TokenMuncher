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
  NumpadDecimal: 'numdec', NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv',
};
// What a keypad digit / decimal key acts as when it does not type its
// character (NumLock off, or Shift held): Windows then sends the navigation
// key, so that is the key a global shortcut has to name. e.key -> key.
const NUMPAD_NAV = {
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert', Delete: 'Delete',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
};
const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^AltGraph$/;

function keyFromCode(code) {
  if (typeof code !== 'string') return null;
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1];
  if ((m = /^Digit([0-9])$/.exec(code))) return m[1];
  // the numeric keypad has its own accelerator names: "1" is the top-row key only
  if ((m = /^Numpad([0-9])$/.exec(code))) return 'num' + m[1];
  if (/^F([1-9]|1\d|2[0-4])$/.test(code)) return code;
  return CODE_KEYS[code] || null;
}

// { code, key, ctrlKey, altKey, shiftKey, metaKey } -> { accel } | { modifierOnly } | { unknown }
function accelFromEvent(e) {
  if (MODIFIER_CODES.test(e.code || '') || ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return { modifierOnly: true };
  let k = keyFromCode(e.code);
  if (/^Numpad[0-9]$|^NumpadDecimal$/.test(e.code || '') && !/^[0-9.,]$/.test(e.key || '')) k = NUMPAD_NAV[e.key] || null;
  if (!k) return { unknown: true };
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return { accel: [...mods, k].join('+') };
}

// What one keydown means to a shortcut field that is recording:
// { wait } (only modifiers so far, or a held key repeating), { leave } (Tab:
// stop and let focus move on), { cancel } (Esc), { clear } (Backspace /
// Delete), { unknown } (a key no shortcut can use) or { accel }.
function recordKey(e) {
  if (e.repeat) return { wait: true };
  const r = accelFromEvent(e);
  if (r.modifierOnly) return { wait: true };
  if (e.code === 'Tab' && !(e.ctrlKey || e.altKey || e.metaKey)) return { leave: true };
  const bare = !(e.ctrlKey || e.altKey || e.metaKey || e.shiftKey);
  if (bare && e.code === 'Escape') return { cancel: true };
  if (bare && (e.code === 'Backspace' || e.code === 'Delete')) return { clear: true };
  if (r.unknown) return { unknown: true };
  return { accel: r.accel };
}

// Every event prop of the shortcut field, in one object so nothing spread
// next to it can replace the key handler. Idle, it is a button (click, Enter
// or Space starts recording). Recording, each keydown is taken here and goes
// no further: the page's own one-key shortcuts must not fire while the user
// presses a combination.
// rec: recording now; on: { start(), stop(), save(accel), fail(message) }.
function recorderProps(rec, on) {
  return {
    tabIndex: 0,
    onClick: () => { if (!rec) on.start(); },
    onBlur: () => { if (rec) on.stop(); },
    onKeyDown: e => {
      if (!rec) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); // Space would scroll the page
        e.stopPropagation();
        if (!e.repeat) on.start();
        return;
      }
      const r = recordKey(e);
      if (r.leave) { on.stop(); return; }
      e.preventDefault();
      e.stopPropagation();
      if (r.wait) return;
      on.stop();
      if (r.cancel) return;
      if (r.clear) on.save('');
      else if (r.unknown) on.fail('That key cannot be used in a shortcut');
      else on.save(r.accel);
    }
  };
}

// A shortcut field in Settings, without React: its state is { rec, err }
// (recording now, the last refusal), and this says what the element shows
// and does. While it records, the set global shortcuts are paused, so the
// combination pressed reaches the recorder even when it is already set (the
// field's own, or the other field's: then main refuses it with a message).
// opts: { name, label, value (stored accelerator or ''), startupError,
//   api: { setHotkey(name, accel) -> Promise<{ ok, error }>, pauseHotkeys(on) },
//   update(patch) — merges into the state }
// -> { chip (props of the field element), text, clear (fn or null), error }
function hotkeyField(state, { name, label, value, startupError, api, update }) {
  const on = {
    start: () => { update({ rec: true, err: '' }); api.pauseHotkeys(true); },
    stop: () => { update({ rec: false }); api.pauseHotkeys(false); },
    save: async accel => {
      const r = await api.setHotkey(name, accel);
      update({ err: r && !r.ok ? r.error : '' });
    },
    fail: err => update({ err }),
  };
  return {
    chip: { role: 'button', 'aria-label': label + ' shortcut', ...recorderProps(state.rec, on) },
    text: state.rec ? 'press a combination…' : value || 'off',
    clear: value && !state.rec ? () => on.save('') : null,
    error: state.err || startupError || '',
  };
}

module.exports = { keyFromCode, accelFromEvent, recordKey, recorderProps, hotkeyField };
