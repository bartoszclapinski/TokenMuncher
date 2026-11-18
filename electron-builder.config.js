// electron-builder settings; appId comes from the same module the app uses.
//
// Windows build: a per-user NSIS installer with a wizard (installer/installer.nsh):
// a welcome page that says what gets installed where, a folder choice, and a
// finish page with where to find the app. Always for the current user only (no
// admin rights); a Start Menu shortcut with the app id; user data kept on
// uninstall. Installed once (by default in %LOCALAPPDATA%\Programs\tokenmuncher) the app
// starts in well under a second; the old portable exe unpacked ~75 MB on every
// launch (~5 s).
//
// TM_ARCH=arm64 builds the Windows on ARM installer (scripts/dist.mjs runs both).
// The x64 installer keeps its name: the update check looks for it by name.
const arch = process.env.TM_ARCH === 'arm64' ? 'arm64' : 'x64';

module.exports = {
  appId: require('./src/main/app-id'),
  productName: 'TokenMuncher',
  // better-sqlite3 ships prebuilt binaries for every platform; the app uses the
  // one rebuilt for Electron in build/Release, so the others are left out.
  files: ['src/main/**', 'src/shared/**', 'dist/**', 'assets/icon.ico', 'package.json', '!**/node_modules/better-sqlite3/prebuilds/**'],
  win: { target: [{ target: 'nsis', arch: [arch] }], icon: 'assets/icon.ico' },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    include: 'installer/installer.nsh',
    installerSidebar: 'assets/installer-sidebar.bmp', // npm run icon
    // English only, like the app; NSIS would otherwise mix in OS-language texts.
    multiLanguageInstaller: false,
    installerLanguages: ['en_US'],
    createDesktopShortcut: false,
    // ${version} and ${ext} are electron-builder macros, filled in by the builder
    artifactName: 'TokenMuncher-Setup-${version}' + (arch === 'arm64' ? '-arm64' : '') + '.${ext}'
  },
  directories: { output: 'release' },
  compression: 'normal',
  electronLanguages: ['en-US', 'pl']
};
