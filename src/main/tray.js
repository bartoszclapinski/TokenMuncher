// System tray icon: critter colored by the most-used limit, a tooltip with
// current percents, click to show/hide the window, and a settings menu.
const { Tray, Menu } = require('electron');
const { critterIcon, statusFor } = require('./icon');
const { tooltipText } = require('../shared/mini');

class TrayIcon {
  // api: { toggleWindow, refresh, testNotification, quit, getOption(name), setOption(name, value), look() → { theme, mascot } (resolved) }
  constructor(api) {
    this.api = api;
    this.status = 'idle';
    this.tooltip = '';
    this.look = api.look();
    this.tray = new Tray(critterIcon('idle', this.look));
    this.tray.setToolTip('TokenMuncher');
    this.tray.on('click', () => api.toggleWindow());
    this.rebuildMenu();
  }

  rebuildMenu() {
    const a = this.api;
    const check = (label, name) => ({
      label, type: 'checkbox', checked: !!a.getOption(name),
      click: item => a.setOption(name, item.checked) // setOption rebuilds this menu
    });
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show / hide window', click: () => a.toggleWindow() },
      { label: 'Settings…', click: () => a.openSettings() },
      ...(a.update() ? [{ label: `Install update ${a.update()}…`, click: () => a.installUpdate() }] : []),
      check('Mini widget', 'mini'),
      { type: 'separator' },
      check('Always on top', 'onTop'),
      check('Notifications', 'notifications'),
      check('Start with Windows', 'autostart'),
      { type: 'separator' },
      { label: 'Refresh limits now', click: () => a.refresh() },
      { label: 'Send test notification', click: () => a.testNotification() },
      { type: 'separator' },
      { label: 'Quit TokenMuncher', click: () => a.quit() }
    ]));
  }

  // The skin or the mascot changed: same status, the new look.
  refreshIcon() {
    this.look = this.api.look();
    this.tray.setImage(critterIcon(this.status, this.look));
  }

  update(snap) {
    const max = snap && snap.limits.length ? Math.max(...snap.limits.map(l => l.est)) : null;
    const status = statusFor(max);
    const look = this.api.look();
    if (status !== this.status || look.theme !== this.look.theme || look.mascot !== this.look.mascot) {
      this.status = status;
      this.look = look;
      this.tray.setImage(critterIcon(status, look));
    }
    const tip = tooltipText(snap);
    if (tip !== this.tooltip) {
      this.tooltip = tip;
      this.tray.setToolTip(tip);
    }
  }

  destroy() { this.tray.destroy(); }
}

module.exports = { TrayIcon, tooltipText };
