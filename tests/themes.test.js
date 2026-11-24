const test = require('node:test');
const assert = require('node:assert/strict');
const { THEMES, THEME_IDS, GROUPS, DEFAULT_THEME, COLOR_KEYS, MASCOT_CHOICES, themeOf, mascotOf, lookOf } = require('../src/shared/themes');
const { MASCOTS, MASCOT_IDS, critterRows, drawCritter, W, H } = require('../src/shared/critter');
const { normalize, applyChange, activeTheme } = require('../src/main/settings');
const { contrastOf, distance } = require('./contrast');

test('every skin has every colour, provider and tray colour, a group and a known mascot', () => {
  assert.equal(THEME_IDS.length, 26);
  assert.deepEqual(THEME_IDS.slice(0, 5), ['claude', 'codex', 'cursor', 'copilot', 'paper']);
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    assert.equal(t.name, id);
    assert.ok(GROUPS.some(g => g.id === t.group), `${id}: group ${t.group}`);
    assert.equal(typeof t.light, 'boolean');
    assert.deepEqual(Object.keys(t.c).sort(), COLOR_KEYS.slice().sort(), `${id}: colour keys`);
    for (const v of Object.values(t.c)) assert.match(v, /^(#[0-9a-f]{6}|oklch\([\d. ]+\))$/, `${id}: ${v}`);
    assert.deepEqual(Object.keys(t.prov).sort(), ['claude', 'codex', 'copilot', 'cursor', 'gemini']);
    assert.ok(MASCOT_IDS.includes(t.mascot), `${id}: mascot ${t.mascot}`);
    assert.deepEqual(Object.keys(t.fam).sort(), ['fable', 'haiku', 'mythos']);
    for (const rgb of Object.values(t.tray)) assert.ok(rgb.length === 3 && rgb.every(n => Number.isInteger(n) && n >= 0 && n <= 255), `${id}: tray ${rgb}`);
  }
  const own = THEME_IDS.filter(id => THEMES[id].group === 'tokenmuncher');
  assert.equal(new Set(own.map(id => THEMES[id].mascot)).size, 5, 'the five own skins: a different mascot each');
  for (const m of MASCOT_IDS) assert.ok(THEME_IDS.some(id => THEMES[id].mascot === m), `mascot ${m} is used by a skin`);
  for (const { id: g, title } of GROUPS) {
    assert.ok(title, `${g}: a heading`);
    assert.ok(THEME_IDS.some(id => THEMES[id].group === g && THEMES[id].light), `${g}: a light skin`);
    assert.ok(THEME_IDS.some(id => THEMES[id].group === g && !THEMES[id].light), `${g}: a dark skin`);
  }
  assert.equal(themeOf('nope').name, DEFAULT_THEME);
  assert.equal(themeOf('toString').name, DEFAULT_THEME);
});

test('every mascot is 12x10 in every mood and both eating frames', () => {
  for (const id of MASCOT_IDS) {
    for (const [mood, t] of [['plain', 0], ['sleep', 0], ['calm', 0], ['eat', 0], ['eat', 1 / 7], ['panic', 0]]) {
      const rows = critterRows(mood, t, id);
      assert.equal(rows.length, H, `${id} ${mood}`);
      for (const r of rows) assert.match(r, /^[Xoms.]{12}$/, `${id} ${mood}: "${r}"`);
    }
    // enough painted pixels change between the two frames to be seen (the cat
    // once changed 2). Only X and s are painted; eyes, mouth and empty cells all
    // show the background. 3 is the bot's blinking cursor, the smallest on purpose.
    const painted = t => [...critterRows('eat', t, id).join('')].map(c => c === 'X' || c === 's');
    const [f0, f1] = [painted(0), painted(1 / 7)];
    assert.ok(f0.filter((on, i) => on !== f1[i]).length >= 3, `${id}: eating animates visibly`);
    assert.notDeepEqual(critterRows('sleep', 0, id), critterRows('panic', 0, id), `${id}: moods differ`);
    assert.equal(drawCritter(32, { tile: true, mascot: id }).length, 32 * 32 * 4);
  }
  assert.deepEqual(critterRows('calm', 0, 'nope'), critterRows('calm', 0, 'critter'), 'unknown mascot: the critter');
  assert.equal(W, 12);
  assert.ok(MASCOTS.critter);
});

test('the tray tile takes the skin colour', () => {
  const px = drawCritter(32, { tile: true, mascot: 'cat', tileColor: [1, 2, 3], body: [9, 9, 9] });
  const i = (16 * 32 + 2) * 4; // left edge, middle row: tile
  assert.deepEqual([...px.subarray(i, i + 3)], [1, 2, 3]);
});

test('settings: skin is validated', () => {
  assert.equal(normalize({}).theme, 'claude');
  assert.equal(normalize({ theme: 'paper' }).theme, 'paper');
  assert.equal(normalize({ theme: 'tokyo-night' }).theme, 'tokyo-night');
  assert.equal(normalize({ theme: 'neon' }).theme, 'claude');
  const s = normalize({});
  assert.equal(applyChange(s, 'theme', 'codex'), true);
  assert.equal(s.theme, 'codex');
  assert.equal(applyChange(s, 'theme', 'neon'), false);
  assert.equal(s.theme, 'codex');
});

test('mascots: negative time and odd mood names are safe', () => {
  assert.doesNotThrow(() => critterRows('eat', -0.1, 'bot'));
  assert.deepEqual(critterRows('constructor', 0, 'cat'), critterRows('panic', 0, 'cat'));
  assert.deepEqual(critterRows('calm', 0, 'toString'), critterRows('calm', 0, 'critter'));
});

test('every skin has readable tray status colours', () => {
  for (const id of THEME_IDS) {
    const t = THEMES[id].tray;
    for (const k of ['body', 'ok', 'warn', 'danger']) assert.ok(contrastOf(t[k], t.tile) >= 3, `${id} ${k}: ${contrastOf(t[k], t.tile).toFixed(2)}`);
  }
});

test('every skin has readable text, accents and provider colours on its background', () => {
  const MIN = { fg: 7, hi: 7, muted: 4.5, dim: 3, clay: 3, ok: 3, warn: 3, danger: 3, teal: 3 };
  for (const id of THEME_IDS) {
    const t = THEMES[id];
    const check = (name, colour, min) => assert.ok(contrastOf(colour, t.c.bg) >= min, `${id} ${name}: ${contrastOf(colour, t.c.bg).toFixed(2)} < ${min}`);
    for (const [k, min] of Object.entries(MIN)) check(k, t.c[k], min);
    for (const [k, v] of Object.entries(t.prov)) check('prov.' + k, v, 3);
    for (const [k, v] of Object.entries(t.fam)) check('fam.' + k, v, 3);
  }
});

test('every skin keeps colours shown side by side apart', () => {
  // ~0.02 is barely visible in OKLab; chart colours want clearly more
  const apart = (id, set, min) => {
    const ks = Object.keys(set);
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        const d = distance(set[ks[i]], set[ks[j]]);
        assert.ok(d >= min, `${id}: ${ks[i]} and ${ks[j]} look alike (${d.toFixed(3)} < ${min})`);
      }
    }
  };
  // a and b are each other's neighbours, never one with itself
  const across = (id, a, b, min) => {
    for (const [x, v] of Object.entries(a)) {
      for (const [y, w] of Object.entries(b)) {
        const d = distance(v, w);
        assert.ok(d >= min, `${id}: ${x} and ${y} look alike (${d.toFixed(3)} < ${min})`);
      }
    }
  };
  for (const id of THEME_IDS) {
    const { c, prov, fam } = THEMES[id];
    // The charts (FAM in app.jsx): model families, other tools' models in their
    // provider's colour, and "other" (muted, also an unknown provider).
    apart(id, { opus: c.clay, sonnet: c.teal, haiku: fam.haiku, fable: fam.fable, cursor: prov.cursor, codex: prov.codex, copilot: prov.copilot, gemini: prov.gemini, other: c.muted }, 0.07);
    // Provider names side by side in the header and tables; claude's colour
    // only names the tool (its models take their family's colour).
    apart(id, { ...prov, other: c.muted }, 0.07);
    // A coloured name or bar must not read as a warning, an error (a failed
    // provider's label is danger) or plain text.
    across(id, { opus: c.clay, sonnet: c.teal, ...fam, ...prov }, { warn: c.warn, danger: c.danger, fg: c.fg, hi: c.hi }, 0.06);
    // title bar, its button hover (also the widget's buttons on bg), row hover (bar on bg) and the picked row
    apart(id, { bg: c.bg, bar: c.bar, hover: c.hover, pick: c.pick }, 0.025);
  }
});

test('colour distance: same colour 0, black to white 1', () => {
  assert.ok(distance('#123456', [0x12, 0x34, 0x56]) < 1e-9);
  assert.ok(Math.abs(distance('#000000', '#ffffff') - 1) < 1e-3);
});

test('mascots sit in the middle of their 12 columns', () => {
  // the horizontal centre of the drawn cells is the grid's centre (5.5); a
  // shape one column off is 0.5 away
  for (const id of MASCOT_IDS.filter(m => m !== 'pointer')) { // the pointer leans by design
    const xs = critterRows('plain', 0, id).flatMap(r => [...r].map((ch, x) => (ch === '.' ? -1 : x)).filter(x => x >= 0));
    const centre = xs.reduce((a, b) => a + b, 0) / xs.length;
    assert.ok(Math.abs(centre - 5.5) <= 0.25, `${id}: centre at column ${centre.toFixed(2)}`);
  }
});

test('mascots: the plain face has no mouth, a calm one has exactly one mouth row', () => {
  // the owl's beak and the window's title-bar dots are drawn like a mouth, on purpose
  for (const id of MASCOT_IDS.filter(m => m !== 'owl' && m !== 'window')) {
    assert.ok(!critterRows('plain', 0, id).some(r => r.includes('m')), `${id}: plain has a mouth`);
  }
  for (const id of ['critter', 'cat', 'bat', 'fox', 'pilot', 'pointer']) {
    assert.equal(critterRows('calm', 0, id).filter(r => r.includes('m')).length, 1, `${id}: calm mouth rows`);
  }
  const mouthRows = mood => critterRows(mood, 0, 'window').filter(r => r.includes('m')).length;
  assert.equal(mouthRows('calm'), mouthRows('plain') + 1, 'window: calm adds one mouth row');
});

test('contrast helper: black on white is 21, a colour on itself is 1, oklch works', () => {
  assert.equal(Math.round(contrastOf('#000000', '#ffffff')), 21);
  assert.equal(contrastOf([10, 20, 30], [10, 20, 30]), 1);
  assert.ok(Math.abs(contrastOf('oklch(1 0 0)', '#ffffff') - 1) < 0.01);
  assert.ok(Math.abs(contrastOf('oklch(0 0 0)', '#000000') - 1) < 0.01);
});

test('mascot: auto follows the skin, a picked one wins, junk falls back', () => {
  assert.equal(mascotOf('dracula', 'auto'), 'bat');
  assert.equal(mascotOf('dracula', 'cat'), 'cat');
  assert.equal(mascotOf('nope', 'auto'), 'critter');
  assert.equal(mascotOf('paper', 'toString'), 'cat');
  assert.equal(mascotOf('paper', undefined), 'cat');
});

test('settings: mascot is validated', () => {
  assert.equal(normalize({}).mascot, 'auto');
  assert.equal(normalize({ mascot: 'owl' }).mascot, 'owl');
  assert.equal(normalize({ mascot: 'dragon' }).mascot, 'auto');
  assert.equal(normalize({ mascot: 'constructor' }).mascot, 'auto');
  const s = normalize({});
  assert.equal(applyChange(s, 'mascot', 'fox'), true);
  assert.equal(s.mascot, 'fox');
  assert.equal(applyChange(s, 'mascot', 'fox'), false, 'no change');
  assert.equal(applyChange(s, 'mascot', 'dragon'), false);
  assert.equal(s.mascot, 'fox');
  assert.equal(applyChange(s, 'mascot', 'auto'), true);
  assert.equal(s.mascot, 'auto');
});

test('look: the skin id and the mascot already resolved', () => {
  assert.deepEqual(lookOf('dracula', 'auto'), { theme: 'dracula', mascot: 'bat' });
  assert.deepEqual(lookOf('dracula', 'owl'), { theme: 'dracula', mascot: 'owl' });
  assert.deepEqual(lookOf('nope', 'nope'), { theme: 'claude', mascot: 'critter' });
  assert.deepEqual(MASCOT_CHOICES, ['auto', ...MASCOT_IDS]);
});

test('auto skin: the fixed one, or the dark / light pick by the system mode', () => {
  const s = normalize({});
  assert.equal(s.themeMode, 'fixed');
  assert.equal(s.themeDark, 'claude');
  assert.equal(s.themeLight, 'paper');
  s.theme = 'nord';
  assert.equal(activeTheme(s, true), 'nord');
  assert.equal(activeTheme(s, false), 'nord');
  assert.equal(applyChange(s, 'themeMode', 'auto'), true);
  assert.equal(activeTheme(s, true), 'claude');
  assert.equal(activeTheme(s, false), 'paper');
  assert.equal(applyChange(s, 'themeDark', 'dracula'), true);
  assert.equal(applyChange(s, 'themeLight', 'macos-light'), true);
  assert.equal(activeTheme(s, true), 'dracula');
  assert.equal(activeTheme(s, false), 'macos-light');
  assert.equal(s.theme, 'nord', 'the fixed pick is kept for going back');
});

test('auto skin settings are validated: a dark slot takes only dark skins, a light slot only light ones', () => {
  const s = normalize({ themeMode: 'sometimes', themeDark: 'paper', themeLight: 'dracula' });
  assert.equal(s.themeMode, 'fixed');
  assert.equal(s.themeDark, 'claude');
  assert.equal(s.themeLight, 'paper');
  assert.equal(applyChange(s, 'themeDark', 'solarized-light'), false);
  assert.equal(applyChange(s, 'themeLight', 'nord'), false);
  assert.equal(applyChange(s, 'themeDark', 'toString'), false);
  assert.equal(applyChange(s, 'themeMode', 'night'), false);
  assert.deepEqual([s.themeMode, s.themeDark, s.themeLight], ['fixed', 'claude', 'paper']);
  const kept = normalize({ themeMode: 'auto', themeDark: 'tokyo-night', themeLight: 'one-light' });
  assert.deepEqual([kept.themeMode, kept.themeDark, kept.themeLight], ['auto', 'tokyo-night', 'one-light']);
});
