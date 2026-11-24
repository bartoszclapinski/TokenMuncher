// The global shortcuts (settings HOTKEY_KEYS) and their registration with
// Electron's globalShortcut. Validation lives in settings.js; this keeps
// what is registered in step with the settings:
// - registerAll(): from scratch (startup), remembering which failed and why
// - set(name, value): one shortcut from the settings panel (saved only when it registered)
// - pause() / resume(): while a shortcut field records, nothing is registered,
//   so pressing a combination that is set (the field's own or the other
//   field's) reaches the recorder instead of firing its action
// - enabled: false (demo / screenshot instances) never registers anything system-wide
// - stop(): the app is quitting; everything is unregistered and stays so
// - onChange(): called after resume() and set(), which may both change what
//   the settings panel shows (the stored shortcuts and `errors`)
const { HOTKEY_KEYS, setHotkey, tryRegister, hotkeyFailure } = require('./settings');

class Hotkeys {
  // shortcut: { register(accel, fn) -> bool (may throw), unregister(accel), unregisterAll() }
  // actions: name -> fn; settings: () -> the settings object; enabled: register at all;
  // onChange: () -> the settings panel needs the shortcuts and errors again
  constructor({ shortcut, actions, settings, enabled = true, onChange = () => {} }) {
    this.shortcut = shortcut;
    this.actions = actions;
    this.settings = settings;
    this.enabled = enabled;
    this.onChange = onChange;
    this.paused = false;
    this.stopped = false;
    this.errors = {}; // name -> why a stored shortcut is not active
    this.reg = { register: (accel, name) => this.shortcut.register(accel, this.actions[name]), unregister: a => this.shortcut.unregister(a) };
  }

  registerAll() {
    this.shortcut.unregisterAll();
    for (const k of Object.keys(this.errors)) delete this.errors[k];
    if (!this.enabled || this.paused || this.stopped) return;
    const s = this.settings();
    for (const name of HOTKEY_KEYS) {
      const failed = s[name] && tryRegister(this.reg, s[name], name);
      if (failed) this.errors[name] = hotkeyFailure(s[name], failed);
    }
  }

  pause() {
    if (this.paused) return;
    this.paused = true;
    this.shortcut.unregisterAll();
  }

  // Registering again rebuilds `errors` (a combination may have been freed or
  // taken meanwhile), so the panel is told.
  resume() {
    if (!this.paused) return;
    this.paused = false;
    this.registerAll();
    this.onChange();
  }

  // -> { ok, error, changed }
  set(name, value) {
    if (this.stopped) return { ok: false, error: 'TokenMuncher is closing: the shortcut was not changed' };
    if (!this.enabled) return { ok: false, error: 'Global shortcuts are not registered in demo mode' };
    // recording is over: what is stored is registered again before the change
    if (this.paused) { this.paused = false; this.registerAll(); }
    const r = setHotkey(this.settings(), this.errors, name, value, this.reg);
    this.onChange(); // also when refused: `errors` may differ from what the panel shows
    return r;
  }

  unregisterAll() {
    this.shortcut.unregisterAll();
  }

  // Quitting: nothing is registered from here on, whatever arrives late.
  stop() {
    this.stopped = true;
    this.shortcut.unregisterAll();
  }
}

module.exports = { Hotkeys };
