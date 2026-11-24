# TokenMuncher

A Windows desktop monitor for AI coding plans. It shows how much of your **Claude Code, Cursor, Codex and GitHub Copilot** limits you have used, how fast you are burning tokens, and whether you will make it to the next reset. Everything sits in one terminal-style window, a small always-on-top widget and the tray.

**Website:** [bartoszclapinski.github.io/TokenMuncher](https://bartoszclapinski.github.io/TokenMuncher/)

![Live view](docs/screenshots/live.png)

<sub>Screenshots are taken in demo mode with made-up projects and numbers (`npm run screenshots`).</sub>

- **Limits at a glance:** the 5h and weekly Claude windows, Cursor and Copilot monthly quotas, with decimals estimated between server updates.
- **Forecasts:** whether a limit fits until its reset at the current pace, and at your *usual* pace for that time of the week.
- **Where the tokens go:** live tok/s, sessions, models, projects, a per-day budget, and the history of past windows.
- **Stays out of the way:** tray icon colored by the busiest limit, notifications at the thresholds you pick, and a mini widget.
- **Local first:** reads the usage data your tools already keep on this computer and talks only to those tools' own servers.

> TokenMuncher is an independent project, not affiliated with or endorsed by Anthropic, OpenAI, Anysphere (Cursor) or GitHub. It uses unofficial endpoints that may change or stop working.

---

## Contents

- [Install and update](#install-and-update)
- [A tour of the app](#a-tour-of-the-app)
  - [Live view](#live-view-1)
  - [Session details](#session-details)
  - [History](#history-2)
  - [Settings](#settings-3)
  - [Your own layout](#your-own-layout-e)
  - [Skins](#skins)
  - [Mini widget](#mini-widget)
  - [Tray and notifications](#tray-and-notifications)
- [Keyboard](#keyboard)
- [Where the numbers come from](#where-the-numbers-come-from)
- [Privacy: what is read and sent where](#privacy-what-is-read-and-sent-where)
- [Files on disk](#files-on-disk)
- [Troubleshooting](#troubleshooting) (and [reporting a problem](#reporting-a-problem))
- [For developers](#for-developers)
- [Contributing](#contributing)

---

## Install and update

1. Download **`TokenMuncher-Setup-<version>.exe`** from the [latest release](https://github.com/bartoszclapinski/TokenMuncher/releases/latest). On Windows on ARM, take `TokenMuncher-Setup-<version>-arm64.exe` (its binaries are checked to be ARM64 when it is built, but it has not been run on a real ARM device yet).
2. Run it. A short wizard says what gets installed and where, and lets you pick the folder. By default it installs to `%LOCALAPPDATA%\Programs\tokenmuncher`, for your Windows user only, with no administrator rights. It adds a Start Menu shortcut and can start the app at the end.

   ![Installer](docs/screenshots/installer.png)

3. TokenMuncher lives in the tray, next to the clock. Click the critter to show or hide the window.

**Updates:** the app checks GitHub releases every 6 hours. A new version is downloaded in the background (the status bar shows `↓ vX 34%`, and *Settings → updates* the megabytes, the speed and the time left, with *cancel*). Once it is downloaded you get one notification, the status bar shows `[u] update to vX`, and the tray menu shows *Install update…*. Confirm, and the app starts the installer and closes. The installer updates the same folder and starts the new version. You can also check by hand under *Settings → updates → check now*.

- A download that was interrupted (the app was closed, the connection dropped, or you cancelled it) continues from where it stopped. A cancelled one waits until you start it again.
- The downloaded installer is checked against the SHA-256 that GitHub reports for the release file. A damaged one is removed.
- With *download updates in the background* switched off, nothing is downloaded until you confirm an update, as in earlier versions.

**Uninstall:** Windows *Settings → Apps → TokenMuncher*. Your settings and history in `%APPDATA%\tokenmuncher` are kept. Delete that folder yourself if you want them gone.

> **Coming from the old portable `.exe` (0.8.0 or older)?** Quit the old copy from its tray menu, install, and delete the old file. Autostart moves to the installed app by itself. If the old copy is still running, the new one asks to close it.

---

## A tour of the app

### Live view `[1]`

The main dashboard (screenshot at the top):

| Panel | What it shows |
|---|---|
| **critter** | Its mood follows your usage: asleep, nibbling, munching, or panicking near a limit. It also shows the burn rate (tok/s over the last minute) with a 3-minute sparkline. |
| **limits** | Every limit of every connected tool: a bar, the percent (estimated decimals in color), the time to reset and the reset time, and two forecasts. The first is `✓ fits · ~X% at reset` or `✗ runs out in …` at the pace of the last 15 minutes. The second is `usual pace: ~X% at reset`, based on how much you usually use at each hour of the week, after a week of history. *zoom* `[l]` adds a magnified bar for the decimals. The Claude weekly limit also shows its split by app (Claude Code, chats, Cowork, other). |
| **budget** | For weekly and monthly limits: how much you can use per day to last until the reset, how much of today's budget is gone, and whether you are above or below the even-pace line. |
| **5h window · timeline** | The current 5h window: elapsed time, even pace against your pace, and where it would run out. |
| **API equivalent** | What today's and this month's usage would cost at API list prices, against what your plans cost. |
| **sessions · last 5h** | Sessions active in the last 5 hours: project, app, model, tok/s, tokens and their share of the main limit. **Click a row for its details.** |
| **session context**, **today's tokens by type**, **models today** | How full each session's context window is, the cache read / input / cache write / output split, and tokens per model today. |
| **when you burn**, **log** | A week × 24 h heat map, and the latest tool calls (edits, commands, reads) across sessions. |

### Session details

Click a session row to open its details under the table. Esc, `[ ✕ ]` or a second click closes them.

![Session details](docs/screenshots/session.png)

You get the start time, how long it ran and when it last answered. There are tokens by type with the API-price cost, the models used, the session's share of each limit's current window, its context fill, tokens over time (whole-minute columns), and its last actions.

### History `[2]`

![History](docs/screenshots/history.png)

- **5h window · usage over time:** the current window column by column. Columns above the even pace are red.
- **5h windows · last 7 days:** each past window with how far it got. `✗` marks a window that hit 100%.
- **weekly limits · last weeks:** each week with its per-day usage.
- **week summary:** the last finished week (tokens, API-price cost, percent of the weekly limit, sessions, active days and the busiest one, counted as 24 h slices from the week's start, shares of projects and models) against the week before it, and a list of earlier weeks. A week runs from one reset of Claude's weekly limit to the next (without that limit: Monday to Monday). Each week is summed up once, about ten minutes after it ends (and after Claude's limits were read, so the week's bounds are right), and kept, so it stays comparable after its records are gone; sources hidden at that moment are not counted. A week whose records don't reach its start is marked *partial* and is not used as the base of a comparison.
- **monthly limits · billing cycles:** Cursor and Copilot cycles, the current one and earlier ones, with the percent added per day.
- **daily tokens**, **top burners this week** (projects by tokens and API-price cost), **Claude weekly limit by app**.

Values marked `~` are rebuilt from local logs (spend × the limit's percent per dollar). The others are server readings the app recorded. *partial* means the data doesn't reach the start of that window.

The **usage export** panel's `[ export ]` action saves a local CSV or JSON file for this calendar week, this calendar month, or all retained records. Each row groups token types, API-equivalent USD cost and distinct sessions by local day, project, tool and model. Costs are rounded to six decimal places after summing. Sources switched off in Settings are excluded. Older stored week summaries do not contain the daily breakdown. Choose the destination in the system save dialog.

### Settings `[3]`

![Settings](docs/screenshots/settings.png)

| Section | Options |
|---|---|
| **general** | start with Windows (in the tray), start in the tray also when opened by hand, window always on top, mini widget |
| **notifications** | on/off; thresholds 50 / 70 / 80 / 90 / 100%; warning ~30 min before the 5h window runs out; week summary; send a test notification |
| **sources** | show or hide Claude, Cursor, Codex, Copilot. A hidden source makes no requests and is left out of every view and notification. Its local logs are still read, so nothing is missing when you turn it back on. |
| **display** | precision of the percents (0.01 / 0.001 / 0.0001%), zoom, layout editing, count cache reads in token numbers |
| **theme** | the mascot (`auto` = the skin's own, or any of nine); the skin: one of 26 in four groups, or **follow Windows** with a dark and a light pick (see [Skins](#skins)) |
| **updates** | check for updates; download updates in the background; state and download progress, *check now*, *download and install* / *install now*, *cancel*, *what's new* |
| **about** | version, data folder (click to open), program path |

**Cache reads `[c]`:** cache reads are usually most of the tokens, but they are cheap and weigh little on limits. Switch them off to see tok/s, sessions, daily tokens and top burners without them. Costs and limits don't change.

### Your own layout `[e]`

You can arrange the live and history views the way you like. To start editing, press `e`, click `[e] layout` in the status bar, or use *Settings → display → edit live / edit history*.

![Editing the layout](docs/screenshots/layout.png)

- **Move:** drag a panel by its `⠿` grip. A line shows where it will land: next to another panel in the same row (over that panel's left or right third), or as a row of its own above or below it (over its middle).
- **Resize:** drag the gap between two panels in a row to change how they share its width.
- **Hide:** `✕` hides a panel. `[+ name]` in the bar brings it back, at the end.
- **`[reset to default]`** restores the original layout. Esc or `[done]` leaves edit mode.

Heights follow the content, and on a narrow window the rows wrap as before. Each view's layout is saved in `settings.json`. Panels added in a later version appear at the end.

### Skins

Pick a look in *Settings → theme*: 26 skins in four groups, dark and light. The switch is instant, with no restart. Every skin has its own palette and a pixel mascot. The mascot shows up in the window, the mini widget, the tray icon and notification images. The tray icon's colour still tells you how full your busiest limit is. Like a different one? Pick it in the **mascot** row above the skins: `auto` keeps each skin's own, any other mascot is used with every skin (in its colours).

**Follow Windows:** switch *skin* from `fixed` to `follow Windows` and pick one skin for dark mode (from the dark ones) and one for light mode (from the light ones), e.g. dracula and paper. The app switches as soon as Windows does (*Settings → Personalization → Colors → app mode*), with no restart; your fixed pick is kept for going back.

| group | skins |
|---|---|
| **tokenmuncher** | **claude** (default, warm clay on graphite), **codex** (terminal black, mint), **cursor** (navy, electric blue), **copilot** (GitHub-style dark, violet), **paper** (light: paper and ink) |
| **editor themes** | dark: **dracula**, **one-dark**, **tokyo-night**, **nord**, **monokai**, **gruvbox**, **solarized-dark**, **catppuccin** (Mocha) · light: **one-light**, **gruvbox-light**, **solarized-light**, **catppuccin-latte** |
| **IDEs** | dark: **intellij** (new UI), **rider**, **visual-studio** · light: **intellij-light**, **visual-studio-light** |
| **Windows · macOS** | **windows-dark**, **windows-light**, **macos-dark**, **macos-light** |

| mascot | skins |
|---|---|
| the critter (top of this page) | claude, one-dark, one-light, monokai |
| a little terminal with a `>_` face | codex, intellij, intellij-light |
| a pointer with a face | cursor, rider, visual-studio, visual-studio-light |
| a pilot in goggles | copilot |
| a cat | paper, catppuccin, catppuccin-latte |
| a bat | dracula |
| an owl | tokyo-night, solarized-dark, solarized-light |
| a fox | nord, gruvbox, gruvbox-light |
| an app window with a face | windows-dark, windows-light, macos-dark, macos-light |

| | |
|---|---|
| ![dracula skin](docs/screenshots/theme-dracula.png) | ![tokyo-night skin](docs/screenshots/theme-tokyo-night.png) |
| ![intellij skin](docs/screenshots/theme-intellij.png) | ![solarized-light skin](docs/screenshots/theme-solarized-light.png) |
| ![windows-light skin](docs/screenshots/theme-windows-light.png) | ![macos-dark skin](docs/screenshots/theme-macos-dark.png) |
| ![codex skin](docs/screenshots/theme-codex.png) | ![cursor skin](docs/screenshots/theme-cursor.png) |
| ![copilot skin](docs/screenshots/theme-copilot.png) | ![paper skin](docs/screenshots/theme-paper.png) |

![paper skin, mini widget](docs/screenshots/mini-paper.png)

The skins take only colours: the open palettes of Dracula, One, Tokyo Night, Nord, Gruvbox, Solarized and Catppuccin, the classic Monokai colours, and the default look of the IDEs and systems. Colours drawn side by side are tested to stay apart: model families, providers and "other" in the charts; those against the warning, error and text colours; and the row and button highlights. The mascots are original pixel art, never the logos or mascots of those tools or projects. The program's own icon stays the critter. Every skin is tested for readable text and tray colours (WCAG contrast).

### Mini widget

![Mini widget](docs/screenshots/mini.png)

A small always-on-top window with the critter, the burn rate, the four most-used limits (bar, percent, time to reset) and the most urgent forecast, with its day when that isn't today.

- Toggle it with `m` or *Mini widget* in the tray menu. Drag it anywhere; it remembers its place.
- Double-click or `⤢` opens the dashboard, `✕` hides the widget, and right-click sets the opacity (100 / 85 / 70%).

### Tray and notifications

- The tray icon is the critter, colored by the most-used limit: green under 70%, yellow 70–90%, red from 90%. Its tooltip lists the current percents. Click it to show or hide the window. `✕` on the window hides it to the tray; *Quit* in the tray menu exits.
- **Tray menu:** Show / hide window, Settings…, Install update… (when there is one), Mini widget, Always on top, Notifications, Start with Windows, Refresh limits now, Send test notification, Quit.
- **Notifications:**
  - each limit at your thresholds (80, 90 and 100% by default), once per limit window;
  - a 5h window that will run out within ~30 minutes;
  - a reset after a busy window;
  - the week summed up, when the weekly limit resets (e.g. *Last week: 62% of the claude weekly limit · 412.3 M tokens · $318.20 · 41 sessions · +18% vs the week before · top: web-shop*); not when the week ended more than 3 days ago;
  - a new version.

  Times in notifications always carry the weekday, because you may read them later in the Action Center.

---

## Keyboard

| Key | Action |
|---|---|
| `1` / `2` / `3` (or `s`) | live / history / settings |
| `p` | precision of the percents |
| `l` | zoom (magnified limit bars) |
| `c` | count cache reads on/off |
| `t` | window always on top |
| `e` | edit the layout (drag panels, resize, hide) |
| `m` | mini widget |
| `r` | refresh limits now |
| `u` | install the update (found or already downloaded) |
| `Esc` | leave layout editing, or close the session details |

Two optional global shortcuts work from any app: one shows / hides the window, one shows / hides the mini widget. Both are off by default; set them in Settings → general (click the field, press the combination; it needs Ctrl, Alt or Win, Shift alone is not enough; Esc cancels, Backspace clears). While a field records, the set shortcuts are paused, so pressing one of them changes the field instead of toggling the window. A combination that is invalid or already used by another app is refused with a message and not saved. A `TM_DEMO` instance registers no global shortcuts.

---

## Where the numbers come from

Each source turns itself on only when its tool is installed and logged in.

| Tool | Limits | Tokens, sessions, log | Login used (read only) |
|---|---|---|---|
| Claude Code | plan-usage endpoint behind `/usage` (unofficial), every 3 min (1 min when a limit is at 80%+ and tokens are burning); backs off on HTTP 429 | `~/.claude/projects/**/*.jsonl` | `~/.claude/.credentials.json` |
| Cursor | cursor.com dashboard endpoints (unofficial), every 2 min | the same endpoints (per-request events); titles, repos and context from Cursor's local database | `%APPDATA%\Cursor\User\globalStorage\state.vscdb` |
| Codex | `rate_limits` in local rollout logs | `~/.codex/sessions/**/rollout-*.jsonl` (or `CODEX_HOME`) | none |
| GitHub Copilot | `api.github.com/copilot_internal/user` (unofficial), every 5 min | not available | `gh auth token` or `GH_TOKEN` |

- **Decimals are estimates.** Claude returns whole percents. Between updates the app interpolates from local spend (percent per dollar of the current window). The same fills the gap between Cursor polls.
- **"API equivalent"** uses the list prices in `src/main/pricing.js` (Codex prices are approximate) and Cursor's own per-request cost.
- **No per-request data** exists for claude.ai chat, Cowork and Copilot, so they appear only in limits.
- **Forecasts:** "fits / runs out" uses the pace of the last 15 minutes. "Usual pace" uses your average usage per hour of the week since the logs begin, and needs a week of it.
- **Codex** was tested on a synthetic log only.

## Privacy: what is read and sent where

- Logins are **only read** from each tool's own files and sent **only to that tool's server** (Anthropic, Cursor, GitHub). They are never stored, logged or refreshed by TokenMuncher.
- Usage data stays on this computer. The only other request is the update check to `api.github.com` (without a login; the GitHub CLI login is used only if GitHub refuses the anonymous request or answers "not found", for example at its rate limit), and the installer download from GitHub: in the background when a new version is found, or with that switched off, when you confirm an update.
- Nothing else leaves the machine: no telemetry, no analytics.

## Files on disk

| Where | What |
|---|---|
| `%LOCALAPPDATA%\Programs\tokenmuncher\` (or the folder you picked) | the program |
| `%APPDATA%\tokenmuncher\settings.json` | settings, window position, notification state |
| `%APPDATA%\tokenmuncher\usage-cache.json` | parsed usage, so a start reads only what the logs gained (~0.3 s instead of several seconds). Safe to delete. |
| `%APPDATA%\tokenmuncher\week-summaries.json` | the summaries of the last 12 finished weeks (totals, project names and their shares) |
| `%APPDATA%\tokenmuncher\limit-history.jsonl` | recorded limit readings: when a value changes and at least every 5 min, kept 8 weeks (100 days for monthly limits) |
| `%APPDATA%\tokenmuncher\claude-limits.json` | last Claude limits, shown right away at start |
| `%TEMP%\TokenMuncher-Setup-*.exe`, `…exe.part` | a downloaded update and one still being downloaded; removed once that version (or a newer one) is installed |

## Troubleshooting

- **A tool is missing from the header:** it isn't installed, isn't logged in, or is hidden under *Settings → sources*.
- **Claude shows `rate limited · retry at …`:** the usage endpoint answered HTTP 429; the app waits as long as it asks. The decimals keep moving from local spend in the meantime.
- **`login expired · open Claude Code`:** open Claude Code once; TokenMuncher never refreshes the login itself.
- **Copilot is missing:** log in with the GitHub CLI (`gh auth login`) or set `GH_TOKEN`.
- **No notifications:** check *Settings → notifications*, Windows Focus assist, and that the Start Menu shortcut exists (the app repairs it at start).
- **Update check says "rate limit":** GitHub allows 60 anonymous requests an hour per network address. The check runs again on its own; with the GitHub CLI logged in (`gh auth login`) it does not depend on that limit.
- **Weird numbers after a big change:** delete `usage-cache.json` and restart. The logs are read again in full.

### Reporting a problem

1. Open *Settings → about* and click **`[ copy diagnostics ]`**. A report goes to the clipboard. Nothing is sent anywhere.
2. Open an [issue](https://github.com/bartoszclapinski/TokenMuncher/issues/new/choose), describe what you see, and paste the report. Add a screenshot if it helps.

The report has the app, Electron and Windows versions, your settings, and for each tool: detected or not, plan, errors, limits, and counts of records, sessions, log files and lines read. For Codex it also shows which log lines the parser recognised and which types it skipped, which catches log format changes. It has no logins or tokens, no conversation text, no project names or commands, and your home folder shows as `~`. Read it before you paste it.

---

## For developers

```sh
npm install
npm start               # run from source
npm test                # unit tests (node --test)
npm run dist            # both installers into release/, with a CPU check of every packaged binary
node scripts/dist.mjs x64     # just one installer (x64 or arm64)
npm run screenshots     # the README screenshots, in demo mode
npm run icon            # regenerate the app icon and installer sidebar from the critter pixel map
```

`npm run dist` rebuilds native modules (better-sqlite3) for each target CPU and for this machine again at the end, so `npm start` keeps working.

**GitHub Actions:**

- **`test`** runs the tests and builds the renderer on Windows for every pull request and every push to `main`.
- **`release`** runs when you push a tag `vX.Y.Z` that matches `package.json` and points at a commit on `main`. It runs the tests, builds both installers with the CPU check, and creates a **draft** release with them and `SHA256SUMS.txt`. Nothing is published automatically, and the files of a release that is already published are never replaced. The build runs with a read-only token; only the last step, which runs no project code, can write releases.
- To release a version:
  1. Merge the PR that bumps the version.
  2. `git tag vX.Y.Z <merge commit>` and `git push origin vX.Y.Z`.
  3. When the run finishes, write the notes on the draft and publish it.
- *Actions → release → Run workflow* does a dry run: it builds the installers as run artifacts and creates no release.

**Environment switches:**

| Variable | Effect |
|---|---|
| `TM_PROFILE=<dir>` | separate settings, data and single-instance lock, to run next to an installed copy without touching it (autostart and the Start Menu shortcut are left alone) |
| `TM_DEMO=1` | made-up projects, sessions and limits (`src/main/sources/demo.js`) in a fresh temp profile per run (`TM_PROFILE` is ignored, so no real profile gets demo data). No requests, no autostart, update check or notifications. |
| `TM_SHOT=<file.png>` | render once with data, save a screenshot, quit. With `TM_VIEW=1/2/3`, `TM_W` / `TM_H` (window size), `TM_MINI=1` (the widget), `TM_SESSION=1` (open the details of the first, busiest session), `TM_KEYS=<chars>` (press these keys first, e.g. `e` for the layout editor), `TM_THEME=<skin>` (with `TM_THEME_MODE=auto` it fills the dark or light slot that fits), `TM_MASCOT=<mascot>` (demo mode only), `TM_UPDATE=available` / `downloading` / `ready` (demo mode only: the updates panel and status bar in that state, without a release or a download). |
| `TM_LAYOUT=1` (with `TM_SHOT`) | check every view at several widths for sideways scrolling and clipped content |
| `TM_SYSTEM=dark` / `light`, `TM_SYSTEM_FLIP=<ms>` | with `TM_DEMO` or `TM_PROFILE` only: this instance acts as if Windows were in that mode, and switches mode once after that long (tests of *follow Windows*); the real system setting is not touched |
| `TM_NOTIFY_TEST=1`, `TM_NOTIFY_LOG=1` | show a test notification at start, and log shown notifications |
| `TM_DIAG=<file.md>` | write the diagnostics report to a file (instead of the clipboard) once the first polls are in, then quit |

**Code map:**

| Path | What |
|---|---|
| `src/main/main.js` | frameless window, tray, notifications, settings, updates, IPC |
| `src/main/settings.js` | settings defaults and validation |
| `src/main/hotkeys.js`, `src/shared/hotkey.js` | global shortcuts: registration (paused while a field records), key recording and the Settings field |
| `src/main/sources/*.js` | one file per tool (`claude-poll.js`: Claude polling policy); `demo.js`: demo data |
| `src/main/store.js`, `jsonl.js`, `usage-cache.js` | shared record store, incremental JSONL reader, on-disk cache |
| `src/main/aggregate.js` | the UI snapshot: limit estimates, forecasts, sessions, history, session details |
| `src/main/history.js`, `limit-history.js` | limit windows and billing cycles; recorded readings |
| `src/main/notify.js` | notification rules (pure) |
| `src/main/update.js` | update check and installer download |
| `src/main/diagnostics.js` | the "copy diagnostics" report (private data scrubbed) |
| `src/main/install.js`, `install-lib.js` | autostart, Start Menu shortcut, handover from older copies |
| `src/main/tray.js`, `icon.js`, `mini.js` | tray icon and menu, critter bitmaps, mini widget window |
| `src/shared/` | code shared with the renderer: mascots (`critter.js`), skins (`themes.js`), layout, forecasts, habits, clock, mini widget rules |
| `src/renderer/app.jsx`, `styles.css` | the UI (React, bundled with esbuild into `dist/`); one component per panel, listed in `LIVE_PANELS` / `HIST_PANELS` |
| `src/renderer/layout-view.jsx`, `src/shared/layout.js` | the panel layout and its editor (drag, resize, hide); the layout model is pure and tested |
| `installer/installer.nsh`, `electron-builder.config.js` | installer wizard pages and build settings |
| `scripts/` | installer builds with the CPU check, icon generator, screenshots |
| `tests/` | unit tests |

## Contributing

Bug reports, fixes and features are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) says how to report a problem, run the project and what a pull request needs. Security problems are reported privately: see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE).
