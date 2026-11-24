// Skins: a palette and a mascot each. Pure data shared by the renderer (CSS
// variables and the colour object) and main (window background, tray icon).
//
// Colour keys (c): bg, bar (title bar), fg, hi (strong text), muted, dim,
// border, rule (dashed separators), empty (empty bar cells), track (bar tracks,
// zoom), clay (the accent), danger, ok, warn, teal (second accent), sweat,
// hover, pick (selected row). prov / fam: provider and model-family colours.
// tray: RGB of the mascot in the tray (idle = accent, and ok / warn / danger
// readable on this skin's tile) and of the tile behind it.
// group: where Settings lists it (GROUPS below).
// Colours drawn side by side stay apart: the model families (opus = clay,
// sonnet = teal, haiku, fable) and the providers (other tools' models are
// coloured by provider in the same charts), and bg / bar / hover / pick.
//
// The editor / IDE / system skins take only the colours of those themes (the
// open palettes of Dracula, One, Tokyo Night, Nord, Gruvbox, Solarized and
// Catppuccin; the default look of the IDEs and systems), never their logos or
// mascots: every mascot is our own pixel art.

const { MASCOT_IDS } = require('./critter');

const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// A skin with an all-hex palette; the tray uses its accent, ok, warn and
// danger on its background.
function skin(name, group, mascot, light, c, prov, [haiku, fable]) {
  return {
    name, group, mascot, light, c, prov, fam: { haiku, fable, mythos: fable },
    tray: { body: rgb(c.clay), tile: rgb(c.bg), ok: rgb(c.ok), warn: rgb(c.warn), danger: rgb(c.danger) }
  };
}

const THEMES = {
  claude: {
    name: 'claude', group: 'tokenmuncher', mascot: 'critter', light: false,
    c: {
      bg: '#151311', bar: '#1e1c1a', fg: 'oklch(0.88 0.006 80)', hi: 'oklch(0.95 0.006 80)', muted: 'oklch(0.6 0.006 70)', dim: 'oklch(0.5 0.006 70)',
      border: 'oklch(0.35 0.006 60)', rule: 'oklch(0.31 0.006 60)', empty: 'oklch(0.32 0.006 60)', track: 'oklch(0.28 0.006 60)',
      clay: 'oklch(0.72 0.14 45)', danger: 'oklch(0.68 0.19 25)', ok: 'oklch(0.78 0.1 150)', warn: 'oklch(0.8 0.13 85)', teal: 'oklch(0.72 0.12 190)',
      sweat: 'oklch(0.8 0.09 230)', hover: 'oklch(0.26 0.005 60)', pick: 'oklch(0.29 0.035 45)'
    },
    prov: { claude: 'oklch(0.72 0.14 45)', cursor: 'oklch(0.78 0.08 250)', codex: 'oklch(0.8 0.12 125)', copilot: 'oklch(0.74 0.11 300)', gemini: 'oklch(0.84 0.11 215)' },
    fam: { haiku: '#f4b581', fable: 'oklch(0.74 0.13 340)', mythos: 'oklch(0.74 0.13 340)' },
    tray: { body: [0xe0, 0x78, 0x4a], tile: [0x1b, 0x1a, 0x19], ok: [0x7a, 0xc7, 0x8f], warn: [0xe2, 0xb5, 0x46], danger: [0xe5, 0x54, 0x4b] }
  },
  codex: {
    name: 'codex', group: 'tokenmuncher', mascot: 'bot', light: false,
    c: {
      bg: '#0c0d0d', bar: '#161818', fg: 'oklch(0.9 0 0)', hi: 'oklch(0.97 0 0)', muted: 'oklch(0.62 0 0)', dim: 'oklch(0.5 0 0)',
      border: 'oklch(0.33 0 0)', rule: 'oklch(0.29 0 0)', empty: 'oklch(0.3 0 0)', track: 'oklch(0.25 0 0)',
      clay: 'oklch(0.8 0.15 160)', danger: 'oklch(0.68 0.19 25)', ok: 'oklch(0.82 0.13 140)', warn: 'oklch(0.84 0.13 90)', teal: 'oklch(0.76 0.1 265)',
      sweat: 'oklch(0.8 0.09 230)', hover: 'oklch(0.24 0 0)', pick: 'oklch(0.22 0.03 160)'
    },
    prov: { claude: 'oklch(0.72 0.14 45)', cursor: '#aaeafe', codex: 'oklch(0.86 0.14 120)', copilot: 'oklch(0.72 0.15 320)', gemini: 'oklch(0.86 0.09 290)' },
    fam: { haiku: '#f3ae58', fable: 'oklch(0.74 0.15 15)', mythos: 'oklch(0.74 0.15 15)' },
    tray: { body: [0x4a, 0xd6, 0x9b], tile: [0x10, 0x11, 0x11], ok: [0x7a, 0xc7, 0x8f], warn: [0xe2, 0xb5, 0x46], danger: [0xe5, 0x54, 0x4b] }
  },
  cursor: {
    name: 'cursor', group: 'tokenmuncher', mascot: 'pointer', light: false,
    c: {
      bg: '#13161c', bar: '#1a1e26', fg: 'oklch(0.89 0.01 250)', hi: 'oklch(0.96 0.01 250)', muted: 'oklch(0.63 0.02 250)', dim: 'oklch(0.51 0.02 250)',
      border: 'oklch(0.35 0.02 250)', rule: 'oklch(0.3 0.02 250)', empty: 'oklch(0.31 0.02 250)', track: 'oklch(0.26 0.02 250)',
      clay: 'oklch(0.77 0.12 235)', danger: 'oklch(0.68 0.19 25)', ok: 'oklch(0.78 0.12 160)', warn: 'oklch(0.82 0.13 85)', teal: 'oklch(0.8 0.12 175)',
      sweat: 'oklch(0.82 0.08 200)', hover: 'oklch(0.28 0.02 250)', pick: 'oklch(0.24 0.04 240)'
    },
    prov: { claude: 'oklch(0.72 0.14 45)', cursor: '#a5defa', codex: 'oklch(0.8 0.12 125)', copilot: 'oklch(0.76 0.11 300)', gemini: 'oklch(0.84 0.1 10)' },
    fam: { haiku: '#e3d688', fable: 'oklch(0.76 0.12 340)', mythos: 'oklch(0.76 0.12 340)' },
    tray: { body: [0x4a, 0xa8, 0xf0], tile: [0x18, 0x1c, 0x24], ok: [0x7a, 0xc7, 0x8f], warn: [0xe2, 0xb5, 0x46], danger: [0xe5, 0x54, 0x4b] }
  },
  copilot: {
    name: 'copilot', group: 'tokenmuncher', mascot: 'pilot', light: false,
    c: {
      bg: '#0d1117', bar: '#161b22', fg: 'oklch(0.88 0.01 250)', hi: 'oklch(0.96 0.005 250)', muted: 'oklch(0.64 0.02 250)', dim: 'oklch(0.52 0.02 250)',
      border: 'oklch(0.33 0.02 255)', rule: 'oklch(0.29 0.02 255)', empty: 'oklch(0.3 0.02 255)', track: 'oklch(0.25 0.02 255)',
      clay: 'oklch(0.72 0.17 300)', danger: 'oklch(0.67 0.2 25)', ok: 'oklch(0.76 0.16 145)', warn: 'oklch(0.8 0.14 80)', teal: 'oklch(0.75 0.12 240)',
      sweat: 'oklch(0.8 0.09 230)', hover: 'oklch(0.27 0.015 255)', pick: 'oklch(0.25 0.05 300)'
    },
    prov: { claude: 'oklch(0.72 0.14 45)', cursor: 'oklch(0.86 0.08 300)', codex: 'oklch(0.8 0.12 125)', copilot: '#e9a8f8', gemini: 'oklch(0.84 0.11 215)' },
    fam: { haiku: '#d6c390', fable: 'oklch(0.76 0.12 340)', mythos: 'oklch(0.76 0.12 340)' },
    tray: { body: [0xa3, 0x71, 0xf7], tile: [0x0d, 0x11, 0x17], ok: [0x7a, 0xc7, 0x8f], warn: [0xe2, 0xb5, 0x46], danger: [0xe5, 0x54, 0x4b] }
  },
  paper: {
    name: 'paper', group: 'tokenmuncher', mascot: 'cat', light: true,
    c: {
      bg: '#f6f2ea', bar: '#ebe5d8', fg: 'oklch(0.3 0.01 60)', hi: 'oklch(0.18 0.01 60)', muted: 'oklch(0.5 0.01 60)', dim: 'oklch(0.6 0.01 60)',
      border: 'oklch(0.78 0.015 70)', rule: 'oklch(0.83 0.015 70)', empty: 'oklch(0.86 0.012 75)', track: 'oklch(0.9 0.01 75)',
      clay: 'oklch(0.58 0.17 35)', danger: 'oklch(0.5 0.19 18)', ok: 'oklch(0.55 0.13 150)', warn: 'oklch(0.63 0.14 75)', teal: 'oklch(0.53 0.1 220)',
      sweat: 'oklch(0.6 0.1 230)', hover: 'oklch(0.88 0.02 70)', pick: 'oklch(0.93 0.045 45)'
    },
    prov: { claude: 'oklch(0.6 0.15 45)', cursor: 'oklch(0.45 0.12 270)', codex: 'oklch(0.55 0.12 140)', copilot: 'oklch(0.52 0.14 300)', gemini: 'oklch(0.6 0.12 245)' },
    fam: { haiku: '#99732b', fable: 'oklch(0.55 0.15 340)', mythos: 'oklch(0.55 0.15 340)' },
    tray: { body: [0xc9, 0x4a, 0x2b], tile: [0xf6, 0xf2, 0xea], ok: [0x2e, 0x8b, 0x57], warn: [0xb0, 0x6e, 0x12], danger: [0xc0, 0x2f, 0x24] }
  },

  // ---- editor themes ----
  dracula: skin('dracula', 'editor', 'bat', false, {
    bg: '#282a36', bar: '#21222c', fg: '#f8f8f2', hi: '#ffffff', muted: '#a9adc9', dim: '#7c86b4',
    border: '#44475a', rule: '#3b3e50', empty: '#3a3c4e', track: '#323442',
    clay: '#bd93f9', danger: '#ff5555', ok: '#50fa7b', warn: '#f1fa8c', teal: '#8be9fd',
    sweat: '#8be9fd', hover: '#343746', pick: '#44475a'
  }, { claude: '#ffb86c', cursor: '#d0d368', codex: '#50fa7b', copilot: '#ff79c6', gemini: '#6fa8ff' }, ['#ffb86c', '#dd5d63']),

  'one-dark': skin('one-dark', 'editor', 'critter', false, {
    bg: '#282c34', bar: '#21252b', fg: '#c8ccd4', hi: '#e6e9ef', muted: '#9198a4', dim: '#717885',
    border: '#3e4451', rule: '#353b45', empty: '#3a3f4b', track: '#2f343e',
    clay: '#61afef', danger: '#e06c75', ok: '#98c379', warn: '#e5c07b', teal: '#56b6c2',
    sweat: '#56b6c2', hover: '#323842', pick: '#3a4150'
  }, { claude: '#d19a66', cursor: '#c1cf9c', codex: '#98c379', copilot: '#c678dd', gemini: '#b4b9ff' }, ['#d19a66', '#ee8486']),

  'tokyo-night': skin('tokyo-night', 'editor', 'owl', false, {
    bg: '#1a1b26', bar: '#111119', fg: '#c0caf5', hi: '#e0e6ff', muted: '#8e94b8', dim: '#6b739c',
    border: '#292e42', rule: '#24283b', empty: '#292e42', track: '#1f2335',
    clay: '#7aa2f7', danger: '#f7768e', ok: '#9ece6a', warn: '#e0af68', teal: '#bb9af7',
    sweat: '#7dcfff', hover: '#202330', pick: '#283457'
  }, { claude: '#ff9e64', cursor: '#7dcfff', codex: '#9ece6a', copilot: '#73daca', gemini: '#e6d86a' }, ['#ff9e64', '#e6666b']),

  nord: skin('nord', 'editor', 'fox', false, {
    bg: '#2e3440', bar: '#272c36', fg: '#d8dee9', hi: '#eceff4', muted: '#a8a8a2', dim: '#808a9c',
    border: '#434c5e', rule: '#3b4252', empty: '#3b4252', track: '#353b48',
    clay: '#88c0d0', danger: '#d77a82', ok: '#a3be8c', warn: '#ebcb8b', teal: '#b48ead',
    sweat: '#81a1c1', hover: '#3b4252', pick: '#434e6e'
  }, { claude: '#c8845d', cursor: '#e4caf9', codex: '#a3be8c', copilot: '#d8a0c8', gemini: '#6f9fe6' }, ['#cde094', '#bf616a']),

  monokai: skin('monokai', 'editor', 'critter', false, {
    bg: '#272822', bar: '#1e1f1c', fg: '#f8f8f2', hi: '#ffffff', muted: '#acaa9c', dim: '#8a8672',
    border: '#49483e', rule: '#3e3d32', empty: '#3e3d32', track: '#34352d',
    clay: '#fd971f', danger: '#f92672', ok: '#a6e22e', warn: '#e6db74', teal: '#66d9ef',
    sweat: '#66d9ef', hover: '#3e3d32', pick: '#49483e'
  }, { claude: '#fd971f', cursor: '#d8d8cc', codex: '#a6e22e', copilot: '#e4647e', gemini: '#5f9cf5' }, ['#ae81ff', '#b7e487']),

  gruvbox: skin('gruvbox', 'editor', 'fox', false, {
    bg: '#282828', bar: '#1d2021', fg: '#ebdbb2', hi: '#fbf1c7', muted: '#a89984', dim: '#8a7e70',
    border: '#504945', rule: '#3c3836', empty: '#3c3836', track: '#32302f',
    clay: '#fe8019', danger: '#fb4934', ok: '#b8bb26', warn: '#fabd2f', teal: '#8ec07c',
    sweat: '#83a598', hover: '#32302f', pick: '#3c3836'
  }, { claude: '#fe8019', cursor: '#eac17b', codex: '#b8bb26', copilot: '#b7aa5c', gemini: '#5fa3d6' }, ['#d3869b', '#eb6c5a']),

  'solarized-dark': skin('solarized-dark', 'editor', 'owl', false, {
    bg: '#002b36', bar: '#00212b', fg: '#b0bcbc', hi: '#eee8d5', muted: '#8a9a9c', dim: '#6c8288',
    border: '#1a4652', rule: '#0a3a46', empty: '#073642', track: '#04313c',
    clay: '#2aa1e6', danger: '#e8504d', ok: '#97ad00', warn: '#c99a14', teal: '#2aa198',
    sweat: '#2aa198', hover: '#073642', pick: '#0b3e4b'
  }, { claude: '#d26512', cursor: '#a6994b', codex: '#97ad00', copilot: '#e0569a', gemini: '#c8aef5' }, ['#8b8fdc', '#cb6758']),

  catppuccin: skin('catppuccin', 'editor', 'cat', false, {
    bg: '#1e1e2e', bar: '#181825', fg: '#cdd6f4', hi: '#eef1fc', muted: '#a6adc8', dim: '#7f849c',
    border: '#45475a', rule: '#313244', empty: '#313244', track: '#292a3c',
    clay: '#cba6f7', danger: '#f38ba8', ok: '#a6e3a1', warn: '#f9e2af', teal: '#94e2d5',
    sweat: '#89dceb', hover: '#313244', pick: '#3a3451'
  }, { claude: '#fab387', cursor: '#89b4fa', codex: '#a6e3a1', copilot: '#fbd66e', gemini: '#3fb0d8' }, ['#fab387', '#f5c2e7']),

  'one-light': skin('one-light', 'editor', 'critter', true, {
    bg: '#fafafa', bar: '#eaeaeb', fg: '#383a42', hi: '#202227', muted: '#62656f', dim: '#83858e',
    border: '#d3d3d4', rule: '#dcdcdd', empty: '#e0e0e1', track: '#ebebec',
    clay: '#4078f2', danger: '#d13c2f', ok: '#3f8a3e', warn: '#a06d00', teal: '#a626a4',
    sweat: '#0184bc', hover: '#dfdfe1', pick: '#dce4f7'
  }, { claude: '#bd6630', cursor: '#6a6e9b', codex: '#3f8a3e', copilot: '#0184bc', gemini: '#007a7a' }, ['#b06e48', '#b15042']),

  'gruvbox-light': skin('gruvbox-light', 'editor', 'fox', true, {
    bg: '#fbf1c7', bar: '#ebdbb2', fg: '#3c3836', hi: '#282828', muted: '#665c54', dim: '#7c6f64',
    border: '#d5c4a1', rule: '#e2d3ab', empty: '#ebdbb2', track: '#f2e5bc',
    clay: '#af3a03', danger: '#9d0006', ok: '#79740e', warn: '#a1640b', teal: '#076678',
    sweat: '#076678', hover: '#f2e5bc', pick: '#d5c4a1'
  }, { claude: '#af3a03', cursor: '#b57614', codex: '#79740e', copilot: '#427b58', gemini: '#3f6fbf' }, ['#8f3f71', '#8c0837']),

  'solarized-light': skin('solarized-light', 'editor', 'owl', true, {
    bg: '#fdf6e3', bar: '#eee8d5', fg: '#3f5157', hi: '#073642', muted: '#5f7379', dim: '#7b8d8f',
    border: '#d9d2bf', rule: '#e4ddc9', empty: '#e8e1cc', track: '#f3ecd7',
    clay: '#1f77b8', danger: '#c72b28', ok: '#6b7a00', warn: '#946f00', teal: '#1f8a82',
    sweat: '#1f8a82', hover: '#e4ddc8', pick: '#f7e8bf'
  }, { claude: '#b05331', cursor: '#917f4f', codex: '#6b7a00', copilot: '#c02d74', gemini: '#9a44a6' }, ['#5d62b5', '#b15042']),

  'catppuccin-latte': skin('catppuccin-latte', 'editor', 'cat', true, {
    bg: '#eff1f5', bar: '#dce0e8', fg: '#4c4f69', hi: '#303446', muted: '#5c5f77', dim: '#7c7f93',
    border: '#bcc0cc', rule: '#ccd0da', empty: '#ccd0da', track: '#dce0e8',
    clay: '#8839ef', danger: '#d20f39', ok: '#368a24', warn: '#a8670c', teal: '#167c82',
    sweat: '#0479ad', hover: '#ccd0da', pick: '#e3dcf5'
  }, { claude: '#c94d06', cursor: '#1e66f5', codex: '#368a24', copilot: '#896e42', gemini: '#2c86c8' }, ['#c94d06', '#c0399f']),

  // ---- IDEs ----
  intellij: skin('intellij', 'ide', 'bot', false, {
    bg: '#1e1f22', bar: '#2b2d30', fg: '#bcbec4', hi: '#dfe1e5', muted: '#8f939a', dim: '#73777e',
    border: '#393b40', rule: '#313438', empty: '#393b40', track: '#2b2d30',
    clay: '#548af7', danger: '#f75464', ok: '#6aab73', warn: '#e0bb65', teal: '#2aacb8',
    sweat: '#56a8f5', hover: '#393b40', pick: '#2e436e'
  }, { claude: '#cf8e6d', cursor: '#56a8f5', codex: '#6aab73', copilot: '#c77dbb', gemini: '#b189f5' }, ['#c6ab60', '#d36c6e']),

  rider: skin('rider', 'ide', 'pointer', false, {
    bg: '#262626', bar: '#1e1e1e', fg: '#c4c4c4', hi: '#ebebeb', muted: '#949494', dim: '#757575',
    border: '#3c3c3c', rule: '#333333', empty: '#383838', track: '#2e2e2e',
    clay: '#c191ff', danger: '#ff6b68', ok: '#85c46c', warn: '#e8c46a', teal: '#5ac8e0',
    sweat: '#6c95eb', hover: '#303030', pick: '#33304a'
  }, { claude: '#e0915a', cursor: '#6c95eb', codex: '#85c46c', copilot: '#ed94c0', gemini: '#6fe0c0' }, ['#f1af1a', '#e0915a']),

  'visual-studio': skin('visual-studio', 'ide', 'pointer', false, {
    bg: '#1e1e1e', bar: '#2d2d30', fg: '#dcdcdc', hi: '#ffffff', muted: '#a0a0a0', dim: '#7a7a7a',
    border: '#3f3f46', rule: '#333337', empty: '#3f3f46', track: '#2a2a2e',
    clay: '#b48ae6', danger: '#f44747', ok: '#6cb85c', warn: '#d7ba7d', teal: '#4ec9b0',
    sweat: '#9cdcfe', hover: '#3e3e42', pick: '#3a2f4a'
  }, { claude: '#ce9178', cursor: '#569cd6', codex: '#6a9955', copilot: '#9cdcfe', gemini: '#b8d86b' }, ['#dcdcaa', '#d15545']),

  'intellij-light': skin('intellij-light', 'ide', 'bot', true, {
    bg: '#ffffff', bar: '#f2f3f5', fg: '#27282c', hi: '#000000', muted: '#626672', dim: '#7e828d',
    border: '#dfe1e5', rule: '#ebecf0', empty: '#ebecf0', track: '#f2f3f5',
    clay: '#3574f0', danger: '#d42f40', ok: '#067d17', warn: '#9a6400', teal: '#00838f',
    sweat: '#4a8ff0', hover: '#e4e6ea', pick: '#d3e1fc'
  }, { claude: '#c26a1b', cursor: '#236c70', codex: '#067d17', copilot: '#871094', gemini: '#0033b3' }, ['#c26a1b', '#b73b59']),

  'visual-studio-light': skin('visual-studio-light', 'ide', 'pointer', true, {
    bg: '#ffffff', bar: '#eeeef2', fg: '#1e1e1e', hi: '#000000', muted: '#626262', dim: '#808080',
    border: '#cccedb', rule: '#e0e0e6', empty: '#e5e5ea', track: '#f0f0f4',
    clay: '#68217a', danger: '#c50f1f', ok: '#008000', warn: '#9a5c00', teal: '#2b91af',
    sweat: '#1f6fd1', hover: '#e0e0e8', pick: '#eadcf5'
  }, { claude: '#c25a00', cursor: '#1f5fd1', codex: '#008000', copilot: '#8f08c4', gemini: '#007a7a' }, ['#c25a00', '#a92e4e']),

  // ---- systems ----
  'windows-dark': skin('windows-dark', 'system', 'window', false, {
    bg: '#202020', bar: '#1a1a1a', fg: '#e0e0e0', hi: '#ffffff', muted: '#a6a6a6', dim: '#808080',
    border: '#3a3a3a', rule: '#333333', empty: '#3d3d3d', track: '#2d2d2d',
    clay: '#60cdff', danger: '#ff99a4', ok: '#6ccb5f', warn: '#fce100', teal: '#c7a1ff',
    sweat: '#99ebff', hover: '#2d2d2d', pick: '#1f3a4d'
  }, { claude: '#f7a072', cursor: '#99ebff', codex: '#6ccb5f', copilot: '#fe80ab', gemini: '#6f8cff' }, ['#d6d849', '#ffb454']),

  'macos-dark': skin('macos-dark', 'system', 'window', false, {
    bg: '#1e1e1e', bar: '#2a2a2a', fg: '#dcdcdc', hi: '#ffffff', muted: '#9e9e9e', dim: '#7a7a7a',
    border: '#3d3d3d', rule: '#333333', empty: '#3a3a3a', track: '#2c2c2c',
    clay: '#0a84ff', danger: '#ff453a', ok: '#30d158', warn: '#ffd60a', teal: '#bf5af2',
    sweat: '#64d2ff', hover: '#3a3a3a', pick: '#1d3a5e'
  }, { claude: '#ff9f0a', cursor: '#64d2ff', codex: '#30d158', copilot: '#5cb2d9', gemini: '#63dbbf' }, ['#7d7aff', '#e8676d']),

  'windows-light': skin('windows-light', 'system', 'window', true, {
    bg: '#f3f3f3', bar: '#e5e5e5', fg: '#1a1a1a', hi: '#000000', muted: '#5c5c5c', dim: '#787878',
    border: '#d1d1d1', rule: '#e0e0e0', empty: '#e1e1e1', track: '#ebebeb',
    clay: '#005fb8', danger: '#c42b1c', ok: '#0f7b0f', warn: '#9d5d00', teal: '#7a3fb5',
    sweat: '#0067c0', hover: '#dcdcdc', pick: '#cfe0f5'
  }, { claude: '#ba632c', cursor: '#007c89', codex: '#0f7b0f', copilot: '#326e5b', gemini: '#3a2fa8' }, ['#9d762f', '#b4009e']),

  'macos-light': skin('macos-light', 'system', 'window', true, {
    bg: '#f5f5f7', bar: '#e8e8ea', fg: '#1d1d1f', hi: '#000000', muted: '#636368', dim: '#7c7c82',
    border: '#d2d2d7', rule: '#e5e5ea', empty: '#e5e5ea', track: '#ececf0',
    clay: '#007aff', danger: '#d70015', ok: '#248a3d', warn: '#b25000', teal: '#8944ab',
    sweat: '#0071a4', hover: '#dcdce0', pick: '#dce9fc'
  }, { claude: '#be414a', cursor: '#2a716d', codex: '#248a3d', copilot: '#c9507d', gemini: '#1f8ab0' }, ['#5856d6', '#cd582b'])
};

// The groups of Settings → theme, in order, with their headings.
const GROUPS = [
  { id: 'tokenmuncher', title: 'tokenmuncher' },
  { id: 'editor', title: 'editor themes' },
  { id: 'ide', title: 'IDEs' },
  { id: 'system', title: 'Windows · macOS' }
];

const THEME_IDS = Object.keys(THEMES);
const DEFAULT_THEME = 'claude';
const COLOR_KEYS = Object.keys(THEMES.claude.c);
const themeOf = id => (Object.hasOwn(THEMES, id) ? THEMES[id] : THEMES[DEFAULT_THEME]);
// The mascot setting: 'auto' (the skin's own) or a mascot id.
const MASCOT_CHOICES = ['auto', ...MASCOT_IDS];
// The mascot shown: the one picked in Settings, or the skin's own for 'auto'
// (or anything unknown).
const mascotOf = (themeId, mascot) => (MASCOT_IDS.includes(mascot) ? mascot : themeOf(themeId).mascot);
// What main draws with (window query, widget, tray, toasts): the skin id and
// the mascot already resolved.
const lookOf = (themeId, mascot) => ({ theme: themeOf(themeId).name, mascot: mascotOf(themeId, mascot) });

module.exports = { THEMES, THEME_IDS, GROUPS, DEFAULT_THEME, COLOR_KEYS, MASCOT_CHOICES, themeOf, mascotOf, lookOf };
