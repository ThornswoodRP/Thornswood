// test-3126-settings.js
//
// The settings that belong to the game are set in the game, and take effect
// at once (#3126).
//
// Patrick's ask on #3126: every setting in the launcher that is really an
// in-game setting goes into the game's own settings, every key binding
// included. His answer on #3146: the launcher keeps Play, news, update,
// diagnostics, account and the display settings that need a restart, and
// everything else moves into the game. Until this, the field of view, how
// long the chat stays up, the needs bars and every Thornswood key were set on
// the launcher's Settings and Controls pages with Skyrim closed, and took
// effect at the next start.
//
// What is held here, each half run where it can be:
//
//   A. THE PAGE (game/ui/thornswood-settings.js), run in a stand-in
//      document: it opens and closes like every panel, Change listens for
//      the next key or thumb button and sends its scan code, Escape gives up,
//      the screen tab sends the field of view, the chat fade and the needs
//      bars, and what it draws is the state the front hands it.
//   B. THE FRONT'S WRITER (thornswood-front.js, SETTINGS_KEYS to setSetting),
//      run against a stand-in Thornswood.ini: what it refuses and why, what
//      it writes, that it writes nothing but Thornswood.ini, and that every
//      change is applied from the file as written.
//   C. LIVE: readKeys takes every key out of the new text with the template's
//      defaults, the menu key blocks move with the Journal and Quick Stats
//      keys, the panels are handed the new names, and the emote and voice
//      plugins read their keys again.
//   D. WHERE IT OPENS: Settings on the help panel and the K, P and J panels.
//   E. THE LAUNCHER: no Controls page, no field of view, chat or needs bars,
//      and nothing in it writes a key.
//
// Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join(''); }

const page = read('game', 'ui', 'thornswood-settings.js');
const front = read('game', 'plugins', 'thornswood-front.js');
const emotes = read('game', 'plugins', 'thornswood-emotes.js');
const voice = read('game', 'plugins', 'thornswood-voice.js');
const helpPage = read('game', 'ui', 'thornswood-help.js');
const party = read('game', 'ui', 'thornswood-party.js');
const journal = read('game', 'ui', 'thornswood-journal.js');
const skills = read('game', 'ui', 'thornswood-skills.js');
const template = read('launcher', 'Thornswood.ini');
const xaml = read('launcher', 'app', 'MainWindow.axaml');
const shellCs = read('launcher', 'app', 'Shell.cs');
const pagesCs = read('launcher', 'app', 'Pages.cs');
const displayCs = read('launcher', 'app', 'Display.cs');
const keysCs = read('launcher', 'app', 'Keys.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, fn) {
  try { fn(); } catch (e) { yes(what + ' ran without throwing (' + e.message + ')', false); }
}

/* One function by its whole first line, only if that line is there once. */
function liftFrom(src, first, indent) {
  const from = '\n' + indent + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const end = '\n' + indent + '}\n';
  const b = src.indexOf(end, a + 1);
  return b < 0 ? null : src.slice(a + 1, b + end.length);
}
function between(src, a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i + a.length);
  return (i >= 0 && j >= 0) ? src.slice(i, j) : null;
}

// The template's keys, by name.
const TEMPLATE = {};
template.replace(/^\s*(\w+)\s*=\s*(\d+)\s*$/gm, function (all, k, v) { TEMPLATE[k] = Number(v); return all; });

// ============================================================ a stand-in page
function makeEl(tag) {
  const e = {
    tagName: String(tag).toLowerCase(), attrs: {}, kids: [], children: [], html: '', style: {},
    id: '', className: '', textContent: '', value: '', onclick: null, scrollTop: 0,
    appendChild(c) { this.children.push(c); return c; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    focus() { },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) {
          if (tests.some(function (t) { return t(k); })) { out.push(k); }
          walk(k.kids);
        });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this.html; },
    set(h) { this.html = h; this.kids = parse(h); }
  });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { throw new Error('the stand-in page cannot read the selector ' + sel); }
  return function (el) {
    if (m[1] && el.tagName !== m[1].toLowerCase()) { return false; }
    if (m[2] && el.attrs.id !== m[2]) { return false; }
    if (m[3] && !Object.prototype.hasOwnProperty.call(el.attrs, m[3])) { return false; }
    return true;
  };
}
function unesc(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'); }
function parse(html) {
  const out = [];
  const tag = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const el = makeEl(m[1]);
    const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
    let a;
    while ((a = attr.exec(m[2]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
    el.id = el.attrs.id || '';
    el.className = el.attrs['class'] || '';
    el.value = el.attrs.value || '';
    const shut = html.indexOf('</' + m[1] + '>', tag.lastIndex);
    if ((el.tagName === 'button' || el.tagName === 'p') && shut > 0) { el.textContent = unesc(html.slice(tag.lastIndex, shut)); }
    out.push(el);
  }
  return out;
}
function load(src, initial) {
  const pg = { told: [], on: {} };
  const doc = {
    head: makeEl('head'), body: makeEl('body'), activeElement: null, createElement: makeEl,
    addEventListener(type, fn) { (pg.on[type] = pg.on[type] || []).push(fn); }
  };
  const win = {
    skyrimPlatform: { sendMessage(to, what) { pg.told.push(to + ' ' + what); } },
    innerWidth: 1920, innerHeight: 1080,
    addEventListener() { }
  };
  Object.assign(win, initial || {});
  new Function('window', 'document', src)(win, doc);
  pg.win = win;
  pg.doc = doc;
  pg.root = doc.body.children[doc.body.children.length - 1];
  pg.fire = function (type, ev) {
    ev.preventDefault = ev.preventDefault || function () { };
    (pg.on[type] || []).forEach(function (fn) { fn(ev); });
  };
  return pg;
}

// ================================================================ A. the page
attempt('A', function () {
  const p = load(page);
  const s = p.win.thornswoodSettings;
  const root = p.root;
  const ID = 'ts-settings';
  function body() { return root.querySelector('#' + ID + '-body'); }
  function foot() { return root.querySelector('#' + ID + '-foot').textContent; }
  function sets() { return p.told.filter(function (t) { return t.indexOf('thornswood-front settings:set ') === 0; }).map(function (t) { return t.slice('thornswood-front settings:set '.length); }); }

  yes('A1 the page loads and says it is ready', !!s && p.told.indexOf('thornswood-front settings:ready') !== -1);
  yes('A1 and is shut until something opens it', !s.isOpen() && root.className === '');

  const keys = {};
  s.KEYS.forEach(function (r) { keys[r.ini] = r.def; });
  const frontList = between(front, 'const SETTINGS_KEYS = {', '};') || '';
  const frontKeys = {};
  frontList.replace(/(\w+): (\d+)/g, function (all, k, v) { frontKeys[k] = Number(v); return all; });
  const names = Object.keys(keys);
  yes('A2 every row is one of the front\'s keys, at the front\'s default (' + names.length + ' rows)',
      names.length >= 20 && names.length === Object.keys(frontKeys).length &&
      names.every(function (k) { return frontKeys[k] === keys[k]; }));
  yes('A2 and at the template\'s', names.every(function (k) { return TEMPLATE[k] === keys[k]; }));
  yes('A2 every row says what its key does', s.KEYS.every(function (r) { return r.label && r.what && r.what.length > 30; }));
  const modIds = [];
  (between(front, 'const MOD_KEYS = [', '];') || '').replace(/\['(\w+)', '/g, function (all, id) { modIds.push(id); return all; });
  yes('A2 the other mods\' rows are the ones the front reads (' + modIds.length + '), and the mod settings window\'s',
      modIds.length > 10 && s.MODS.map(function (m) { return m.id; }).sort().join() === modIds.concat(['menu']).sort().join());
  yes('A2 and each says where it is changed instead, since MCM Helper writes its own files back on the way out',
      s.MODS.every(function (m) { return /Changed on .*Mod Configuration|changed in that window/.test(m.what); }));

  s.open();
  yes('A3 opening shows it and tells the plugin, which takes the keyboard for it',
      s.isOpen() && root.className === 'on' && p.told.indexOf('thornswood-front settings:opened') !== -1);
  const tabs = root.querySelector('#' + ID + '-nav').querySelectorAll('button[data-tab]').map(function (b) { return b.textContent; });
  yes('A3 two tabs, Keys and Screen and chat (' + tabs.join(', ') + ')', tabs.join('|') === 'Keys|Screen and chat');

  s.setState({ keys: Object.assign({}, keys, { WheelKey: 33 }), mods: { search: 57, menu: 'F4' },
               fov: { value: 90, min: 60, max: 140, def: 65 }, chatFade: 5, chatChoices: [5, 10, 15, 20, 0],
               needsBars: false, said: 'The emote wheel is now F.' });
  const html = body().html;
  yes('A4 it draws the keys as the front says they are: the wheel on F', /<div class="key">F<\/div><div><div class="label">The emote wheel</.test(html));
  yes('A4 and the line the front said goes at the foot', foot() === 'The emote wheel is now F.');
  yes('A4 a mod whose files are here is shown, with its key, and one that is not is left off',
      /<div class="key">Space<\/div><div><div class="label">Search</.test(html) && !/Lock on/.test(html) &&
      /<div class="key">F4<\/div>/.test(html));
  yes('A4 F1 and F2 are named as the game client\'s', /F1 and F2 are the game client's/.test(html));

  const change = body().querySelectorAll('button[data-key]');
  yes('A5 one Change for every key of ours (' + change.length + ')', change.length === names.length);
  const wheel = change.filter(function (b) { return b.getAttribute('data-key') === 'WheelKey'; })[0];
  wheel.onclick.call(wheel);
  yes('A5 Change listens, and says so', /Press the key you want for the emote wheel/.test(foot()) &&
      /data-key="WheelKey" class="go">Listening/.test(body().html));
  p.fire('keydown', { key: 'h', keyCode: 72 });
  yes('A5 the next key is the answer: H, scan code 35, is sent to the front', sets().join() === 'WheelKey 35');
  yes('A5 and it stops listening', !/Listening/.test(body().html) && s.isOpen());

  function pressWith(ini, ev, type) {
    const b = body().querySelectorAll('button[data-key]').filter(function (x) { return x.getAttribute('data-key') === ini; })[0];
    b.onclick.call(b);
    p.fire(type || 'keydown', ev);
  }
  p.told.length = 0;
  pressWith('PushToTalk', { button: 3 }, 'mousedown');
  yes('A6 a thumb button is taken: Mouse 4 is 259', sets().join() === 'PushToTalk 259');
  p.told.length = 0;
  pressWith('PushToTalk', { button: 0 }, 'mousedown');
  yes('A6 the left button is never taken, and it keeps listening', sets().length === 0 && /Listening/.test(body().html));
  p.fire('keydown', { key: 'Escape', keyCode: 27 });
  yes('A6 Escape while listening leaves it as it was, and the panel up',
      sets().length === 0 && s.isOpen() && foot() === 'Left it as it was.');
  pressWith('ChatKey', { key: 'Enter', keyCode: 13 });
  yes('A7 Enter is offered, so the chat key can go back to it (28)', sets().join() === 'ChatKey 28');
  p.told.length = 0;
  pressWith('ChatKey', { key: 'Shift', keyCode: 16, location: 1 });
  yes('A7 the left Shift is not: it is Skyrim\'s, and the page says so without sending anything',
      sets().length === 0 && /cannot be used here/.test(foot()));
  p.fire('keydown', { key: 'Shift', keyCode: 16, location: 2 });
  yes('A7 the right one is (54)', sets().join() === 'ChatKey 54');
  p.told.length = 0;
  pressWith('HelpKey', { key: 'F9', keyCode: 120 });
  yes('A7 function keys come through by scan code: F9 is 67', sets().join() === 'HelpKey 67');

  const tabBtns = root.querySelector('#' + ID + '-nav').querySelectorAll('button[data-tab]');
  tabBtns[1].onclick.call(tabBtns[1]);
  const screen = body().html;
  yes('A8 the screen tab shows the field of view the front said, 90', /type="range"[^>]*value="90"/.test(screen) && /min="60" max="140"/.test(screen));
  yes('A8 and the chat fade chosen, 5', /data-fade="5" class="go"/.test(screen));
  yes('A8 and the needs bars hidden, with /needs and the Body page named', /data-bars="0" class="go"/.test(screen) &&
      /\/needs in the chat says them as a line of text/.test(screen) && /Body page on K shows/.test(screen));
  yes('A8 and says the display settings that need a restart stay on the launcher',
      /Resolution, the display mode, the frame limit and VSync[^<]*launcher/.test(screen));
  p.told.length = 0;
  const range = body().querySelector('#' + ID + '-fov');
  range.value = '100';
  range.onchange.call(range);
  const def = body().querySelector('#' + ID + '-fovdef');
  def.onclick.call(def);
  body().querySelectorAll('button[data-fade]').filter(function (b) { return b.getAttribute('data-fade') === '0'; })[0].onclick.call({ getAttribute: function () { return '0'; } });
  body().querySelectorAll('button[data-bars]').filter(function (b) { return b.getAttribute('data-bars') === '1'; })[0].onclick.call({ getAttribute: function () { return '1'; } });
  yes('A9 the field of view, Skyrim\'s own, Never and Shown are each sent to the front as asked (' + sets().join('; ') + ')',
      sets().join('; ') === 'Fov 100; Fov 65; ChatFade 0; NeedsBars 1');
  s.setState({ keys: Object.assign({}, keys, { SkillsKey: 33 }), mods: {}, needsBars: true });
  yes('A9 the needs bars line names the skills key as bound', /Body page on F shows/.test(body().html));

  p.fire('keydown', { key: 'Escape', keyCode: 27 });
  yes('A10 Escape closes it and tells the plugin', !s.isOpen() && root.className === '' &&
      p.told.indexOf('thornswood-front settings:closed') !== -1);
  yes('A10 the words: no em dash, and never the word the house rules forbid',
      page.indexOf(String.fromCharCode(0x2014)) === -1 && !/\bplayers?\b/i.test(page));
});

// ======================================================= B. the front's writer
/*
  The block from SETTINGS_KEYS to the end of setSetting, run with a stand-in
  file, a stand-in game (getMappedKey) and the front's own iniNumber and
  keyName. applySettings is replaced by one that records the text it was
  handed and reads it the way readKeys does, so the next refusal sees it.
*/
function writerRig(fileText, mapped) {
  const block = between(front, '  const SETTINGS_KEYS = {', '\n  /*\n    Thornswood.ini changed:');
  const pieces = [liftFrom(front, 'function iniNumber(text, key, fallback) {', '  '),
                  liftFrom(front, 'function keyName(code) {', '  ')];
  if (!block || pieces.some(function (x) { return !x; })) { return null; }
  const w = { file: fileText, writes: [], applied: [], said: [], log: [], js: [] };
  const fsStub = { writeFileSync(p, t) { w.writes.push(p); w.file = t; } };
  const sp = { Input: { getMappedKey(control, device) { return device === 0 && mapped[control] !== undefined ? mapped[control] : -1; } } };
  const made = new Function('sp', 'T', 'readText', 'require', 'log', 'record',
    "'use strict';\n" +
    "const INI = 'Data/SKSE/Plugins/Thornswood.ini';\n" +
    'let ini = readText(INI);\n' +
    'const FOV_MIN = 60, FOV_MAX = 140, FOV_DEFAULT = 65;\n' +
    'let wantedFov = 0;\n' +
    'const CHAT_FADE_CHOICES = [5, 10, 15, 20, 0];\n' +
    'let CHAT_FADE = 10, NEEDS_BARS = true;\n' +
    pieces.join('\n') + '\n' +
    'let SKILLS_KEY = 37;\n' +
    'function applySettings(text) { ini = text; SKILLS_KEY = iniNumber(ini, "SkillsKey", 37); record(text); }\n' +
    block + '\n' +
    'return { setSetting: setSetting, iniWith: iniWith, keyRefusal: keyRefusal, settingsState: settingsState };')(
    sp, { js(code) { w.js.push(code); } },
    function () { return w.file; },
    function (m) { if (m !== 'fs') { throw new Error('require ' + m); } return fsStub; },
    function () { w.log.push(Array.prototype.join.call(arguments, ' ')); },
    function (text) { w.applied.push(text); });
  w.api = made;
  w.set = function (name, raw) {
    w.js.length = 0;
    made.setSetting(name, String(raw));
    const last = w.js[w.js.length - 1] || '';
    const m = /setState\(([\s\S]*)\);\}catch/.exec(last);
    const state = m ? JSON.parse(m[1]) : null;
    w.said.push(state ? state.said : null);
    return state;
  };
  return w;
}

attempt('B', function () {
  const FILE = '; Thornswood\r\n\r\n[Emotes]\r\nWheelKey = 34\r\nStopKey = 49\r\n\r\n[Chat]\r\nChatKey = 28\r\n';
  // Skyrim's own controls, as a fresh controlmap has them: W and the rest.
  const MAPPED = { Forward: 17, Back: 31, 'Strafe Left': 30, 'Strafe Right': 32, Activate: 18, Jump: 57, Sneak: 29, Sprint: 56 };
  const w = writerRig(FILE, MAPPED);
  yes('B0 the writer\'s pieces are in thornswood-front.js', !!w);
  if (!w) { return; }

  w.set('WheelKey', 35);
  yes('B1 H is refused for the wheel: it is the trade key', w.said[0] === 'H is already offer a trade. Move that one first.' && w.writes.length === 0);
  const st = w.set('WheelKey', 210);
  yes('B1 a free key is written in place, keeping the file\'s CRLF and every other line',
      w.file === FILE.replace('WheelKey = 34', 'WheelKey = 210') && w.writes.join() === 'Data/SKSE/Plugins/Thornswood.ini');
  yes('B1 applied from the file as written, at once', w.applied.length === 1 && w.applied[0] === w.file);
  yes('B1 and the page is handed the new state with what happened',
      !!st && st.keys.WheelKey === 210 && st.said === 'The emote wheel is now Insert.');

  w.set('MoldKey', 37);
  yes('B2 a key another of ours has is refused, and says which',
      w.said[w.said.length - 1] === 'K is already the character panel. Move that one first.' && w.writes.length === 1);
  w.set('HelpKey', 59);
  yes('B2 F1 is refused: the game client has it', /^F1 shows and hides the names over heads, so it cannot be help as well\.$/.test(w.said[w.said.length - 1]) && w.writes.length === 1);
  w.set('HelpKey', 17);
  yes('B2 a key Skyrim moves you with is refused, and says where to move that',
      w.said[w.said.length - 1] === 'W is Skyrim\'s Forward. Move it under Settings, Controls in the pause menu first.' && w.writes.length === 1);
  w.set('HelpKey', 57);
  yes('B2 a key the page never offers is refused', /cannot be used here/.test(w.said[w.said.length - 1]) && w.writes.length === 1);
  w.set('StopKey', 49);
  yes('B2 the key it already is changes nothing', w.said[w.said.length - 1] === 'It is N already.' && w.writes.length === 1);
  w.set('MuteKey', 22);
  yes('B2 a name that is not one of the settings writes nothing', w.writes.length === 1 && w.said[w.said.length - 1] === null);

  w.set('CloseKey', 211);
  w.set('CloseKey', 1);
  yes('B3 a key can always go back to its own default, even Escape, which the page does not offer',
      /\r\nCloseKey = 1\r\n/.test(w.file) && w.said[w.said.length - 1] === 'Close the wheel is now Escape.');
  w.set('MoldKey', 209);
  yes('B3 a key the file does not have yet is added at the end', /\r\nChatKey = 28\r\nCloseKey = 1\r\nMoldKey = 209\r\n$/.test(w.file));

  w.set('Fov', 90);
  yes('B4 the field of view is written', /\r\nFov = 90\r\n/.test(w.file) && w.said[w.said.length - 1] === 'Field of view set to 90.');
  w.set('Fov', 200);
  yes('B4 one outside 60 to 140 is refused', /goes from 60 to 140/.test(w.said[w.said.length - 1]) && /Fov = 90/.test(w.file));
  w.set('Fov', 65);
  yes('B4 Skyrim\'s own takes the line out, so the game is left alone', !/Fov/.test(w.file));

  w.set('ChatFade', 5);
  yes('B5 the chat fade is written', /\r\nChatFade = 5\r\n/.test(w.file));
  w.set('ChatFade', 7);
  yes('B5 a number that is not a choice is refused', /not one of the choices/.test(w.said[w.said.length - 1]) && /ChatFade = 5/.test(w.file));
  w.set('ChatFade', 10);
  yes('B5 ten, the default, takes the line out', !/ChatFade/.test(w.file));

  w.set('NeedsBars', 0);
  yes('B6 the needs bars hidden is NeedsBars = 0, and the line says where they still are',
      /\r\nNeedsBars = 0\r\n/.test(w.file) && w.said[w.said.length - 1] === 'The needs bars are hidden. The Body page on K shows them.');
  w.set('NeedsBars', 1);
  yes('B6 shown takes the line out', !/NeedsBars/.test(w.file));

  const fresh = writerRig('', MAPPED);
  fresh.set('WheelKey', 33);
  yes('B7 an empty file gets the one line', fresh.file === 'WheelKey = 33\n');
  yes('B7 every write went to Thornswood.ini and nowhere else',
      w.writes.concat(fresh.writes).every(function (p) { return p === 'Data/SKSE/Plugins/Thornswood.ini'; }));
  const set = liftFrom(front, 'function setSetting(name, raw) {', '  ') || '';
  yes('B7 setSetting has the one writeFileSync, to INI, and reads the file again before it changes it',
      (set.match(/writeFileSync\(/g) || []).length === 1 && /const before = readText\(INI\);/.test(set));
  yes('B7 and nothing writes the other mods\' files: they are only read',
      !/writeFileSync\([^)]*MCM/.test(front) && !/writeFileSync\([^)]*SKSEMenuFramework/.test(front));
});

// ============================================================== C. live
attempt('C', function () {
  // readKeys, run with every variable it sets declared, from the template.
  const rk = liftFrom(front, 'function readKeys(text) {', '  ');
  const pieces = [liftFrom(front, 'function iniNumber(text, key, fallback) {', '  '),
                  liftFrom(front, 'function keyName(code) {', '  '),
                  liftFrom(front, 'function chatFadeOf(text) {', '  '),
                  // A one line function, so not liftFrom, which reads to the next closing brace.
                  (/function needsBarsOf\(text\) \{[^\n]*\}/.exec(front) || [''])[0]];
  const block = between(front, '  const SETTINGS_KEYS = {', '\n  const SETTINGS_LABELS') || '';
  yes('C1 readKeys is in the front', !!rk && pieces.every(Boolean) && !!block);
  if (!rk) { return; }
  const vars = [];
  rk.replace(/^\s+([A-Z_]+) = /gm, function (all, v) { if (vars.indexOf(v) < 0) { vars.push(v); } return all; });
  const run = new Function("'use strict';\nlet ini = '';\nconst CHAT_FADE_CHOICES = [5, 10, 15, 20, 0];\n" +
    'let ' + vars.join(', ') + ';\n' + pieces.join('\n') + '\n' + block + '\n' + rk +
    '\nreturn function (text) { readKeys(text); return { ' + vars.map(function (v) { return v + ': ' + v; }).join(', ') + ' }; };')();
  const blank = run('');
  yes('C1 with nothing in the file every key is the template\'s: wheel G, chat Enter, / commands, F7 help, F10 closes at creation',
      blank.WHEEL_KEY === TEMPLATE.WheelKey && blank.CHAT_KEY === TEMPLATE.ChatKey && blank.COMMAND_KEY === TEMPLATE.CommandKey &&
      blank.HELP_KEY === TEMPLATE.HelpKey && blank.CLOSE_GAME_KEY === TEMPLATE.CloseGameKey && blank.JOURNAL_KEY === 36);
  yes('C1 and the chat fades after ten seconds with the bars on', blank.CHAT_FADE === 10 && blank.NEEDS_BARS === true);
  const moved = run('MoldKey = 33\nLockKey=34\nTradeWithKey = 23\nSkillsKey = 46\nCloseGameKey = 67\nChatFade = 0\nNeedsBars = 0\n');
  yes('C2 a moved key moves what rides on it: the sleep key with the mold, tending with the lock and trade keys, the apprentice and hair dye with K',
      moved.MOLD_KEY === 33 && moved.SLEEP_KEY === 33 && moved.TREAT_KEY === 34 && moved.TREAT_SELF_KEY === 23 &&
      moved.APPRENTICE_KEY === 46 && moved.HAIR_DYE_KEY === 46);
  yes('C2 and the names the prompts show', moved.MOLD_NAME === 'F' && moved.SLEEP_NAME === 'F' && moved.LOCK_NAME === 'G' &&
      moved.TREAT_SELF_NAME === 'I' && moved.APPRENTICE_NAME === 'C' && moved.CLOSE_GAME_NAME === 'F9');
  yes('C2 and the chat and the needs bars', moved.CHAT_FADE === 0 && moved.NEEDS_BARS === false);
  const missing = Object.keys(TEMPLATE).filter(function (k) {
    return ['VoicePort', 'MarkKey', 'PushToTalk', 'VoiceModeKey', 'VoiceLockKey', 'PageKey', 'CloseKey', 'StopKey', 'MuteKey'].indexOf(k) < 0 &&
      /Key$/.test(k) && rk.indexOf("'" + k + "'") < 0;
  });
  yes('C3 readKeys reads every key the front uses' + (missing.length ? ' (not ' + missing.join(', ') + ')' : ''), missing.length === 0);

  const apply = liftFrom(front, 'function applySettings(text) {', '  ') || '';
  yes('C4 a change lets go of the old Journal and Quick Stats keys, so the next frame holds the new ones',
      /sp\.setMenuOpenKeyBlocked\('Journal', journalWas, false, KEYBOARD_MENUS\)/.test(apply) && /journalKeyKept = null;/.test(apply) &&
      /sp\.setMenuOpenKeyBlocked\('Quick Stats', commandWas, false, KEYBOARD_MENUS\)/.test(apply) && /commandKeyKept = null;/.test(apply));
  yes('C4 and hands the new keys to the field of view, the chat, the help, the maneuvers, P, J and K',
      /fovChanged\(text\);/.test(apply) && /chatSettingsToPage\(\);/.test(apply) && /helpToPage\(\);/.test(apply) &&
      /maneuversToPage\(\);/.test(apply) && /thornswoodParty\.setKey\(/.test(apply) &&
      /thornswoodJournal\.setKey\(/.test(apply) && /thornswoodSkills\.setKey\(/.test(apply));
  yes('C4 and to every plugin that reads Thornswood.ini', /const others = T\.settingsListeners \|\| \[\];/.test(apply) &&
      /T\.settingsListeners = T\.settingsListeners \|\| \[\];/.test(front));
  yes('C5 the emote plugin reads its keys again', /\(T\.settingsListeners = T\.settingsListeners \|\| \[\]\)\.push\(function \(\) \{\n  ini = readIni\(INI\);\n  OPEN_KEY  = key\('WheelKey', 34\);/.test(emotes));
  yes('C5 and the voice plugin its three', /T\.settingsListeners = T\.settingsListeners \|\| \[\]\)\.push\(function \(text\) \{/.test(voice) &&
      /PTT_KEY = grab\('PushToTalk', 47\);/.test(voice) && /MODE_KEY = grab\('VoiceModeKey', 48\);/.test(voice) && /LOCK_KEY = grab\('VoiceLockKey', 24\);/.test(voice));

  // The field of view, applied the moment it changes.
  const fv = ['function fovOf(text) {', 'function setFov(v) {', 'function applyFov() {', 'function fovChanged(text) {']
    .map(function (f) { return liftFrom(front, f, '  '); });
  yes('C6 the field of view pieces are in the front', fv.every(Boolean));
  if (fv.every(Boolean)) {
    const cam = [];
    const said = [];
    const fov = new Function('sp', 'say', 'log', "'use strict';\nconst FOV_MIN = 60, FOV_MAX = 140, FOV_DEFAULT = 65;\nlet wantedFov = 0;\n" +
      fv.join('\n') + '\nreturn { changed: fovChanged, wanted: function () { return wantedFov; } };')(
      { Game: { setCameraFOV(a, b) { cam.push(a + '/' + b); } } }, function (t) { said.push(t); }, function () { });
    fov.changed('Fov = 90\n');
    yes('C6 set on Settings, the camera has it at once', cam.join() === '90/90' && fov.wanted() === 90);
    fov.changed('');
    yes('C6 put back to Skyrim\'s own, the camera is set to 65 once and then left alone', cam.join() === '90/90,65/65' && fov.wanted() === 0);
    fov.changed('');
    yes('C6 and not again', cam.length === 2);
  }
  yes('C7 the page is one of the overlays, and the cap can close it',
      /const OVERLAYS = \[[\s\S]*?'thornswood-settings\.js'[\s\S]*?\];/.test(front) &&
      /settings: 'thornswoodSettings'/.test(between(front, 'const CAP_CLOSES = {', '};') || ''));
  yes('C7 its opened and closed move the settings claim, ready and opened hand it the state, and set goes to setSetting',
      /if \(what === 'settings:opened'\) \{ T\.claimFocus\('settings', true\); settingsToPage\(''\); return; \}/.test(front) &&
      /if \(what === 'settings:closed'\) \{ T\.claimFocus\('settings', false\); return; \}/.test(front) &&
      /if \(what === 'settings:ready'\) \{[^\n]*settingsToPage\(''\); return; \}/.test(front) &&
      /what\.indexOf\('settings:set '\) === 0[\s\S]{0,200}setSetting\(bits\[0\], bits\[1\]\)/.test(front));
});

// ============================================================ D. where it opens
attempt('D', function () {
  const opened = [];
  const fakeSettings = { open() { opened.push('open'); } };
  const h = load(helpPage, { thornswoodSettings: fakeSettings });
  h.win.thornswoodHelp.open();
  const b = h.root.querySelector('#ts-help-settings');
  yes('D1 the help panel has Settings at its foot', !!b && b.textContent === 'Settings');
  if (b) { b.onclick.call(b); }
  yes('D1 and it opens Settings and puts the help down', opened.length === 1 && !h.win.thornswoodHelp.isOpen() &&
      h.told.indexOf('thornswood-front help:closed') !== -1);

  const j = load(journal, { thornswoodSettings: fakeSettings });
  j.win.thornswoodJournal.open();
  const jb = j.root.querySelector('#ts-journal-settings');
  yes('D2 the J panel has Settings beside Help', !!jb && jb.textContent === 'Settings');
  if (jb) { jb.onclick.call(jb); }
  yes('D2 and it opens Settings and puts J down', opened.length === 2 && !j.win.thornswoodJournal.isOpen());

  yes('D3 the P panel has Settings beside Help, and it opens Settings and puts P down',
      /'<button id="' \+ ID \+ '-help">Help<\/button>' \+\n\s*'<button id="' \+ ID \+ '-settings">Settings<\/button>'/.test(party) &&
      /root\.querySelector\('#' \+ ID \+ '-settings'\)\.onclick = settings;/.test(party) &&
      /function settings\(\) \{\n\s*try \{ if \(window\.thornswoodSettings\) \{ window\.thornswoodSettings\.open\(\); \} \} catch \(e\) \{ \}\n\s*close\(\);/.test(party));
  yes('D4 the K panel has Settings beside Help, hidden while creating like Help',
      /data-act="help">Help<\/div>' \+\n\s*'<div class="tsbtn ghost" data-act="settings">Settings<\/div>'/.test(skills) &&
      /elSettings\.style\.display = cr \? 'none' : '';/.test(skills));
  yes('D4 and it opens Settings and puts K down',
      /window\.thornswoodSettings\.open\(\);[\s\S]{0,120}api\.close\(\);/.test(between(skills, 'elSettings.onclick = function () {', '};') || ''));
  yes('D5 the help panel tells people where every key is changed', /Settings, below, changes every key\./.test(helpPage));
});

// ============================================================ E. the launcher
attempt('E', function () {
  yes('E1 no Controls page and no rail button for it',
      !/x:Name="NavControls"/.test(xaml) && !/x:Name="PageControls"/.test(xaml) && !/PageControls/.test(shellCs) && !/BuildControls/.test(shellCs + pagesCs));
  yes('E1 no field of view, chat fade or needs bars on the launcher\'s Settings',
      !/x:Name="BoxFov"/.test(xaml) && !/x:Name="ChatFadeRow"/.test(xaml) && !/x:Name="ChkNeedsBars"/.test(xaml) &&
      !/static class (Fov|ChatFade|NeedsBars)\b/.test(displayCs));
  yes('E2 the launcher writes no key: Keys.cs only reads Thornswood.ini',
      !/Write(All)?(Lines|Text)|WriteIni|WriteJsonKey|static string Set\(/.test(keysCs) && /public static List<Binding> All\(\)/.test(keysCs));
  // The launcher's display settings say it, beside what stayed, and so does
  // the Play page's In game card (E4).
  yes('E2 and the launcher\'s Settings says where the keys are changed',
      /<TextBlock Theme="\{StaticResource Small\}" TextWrapping="Wrap" Margin="0,0,0,14"\s+Text="Every key, the field of view, the chat and the needs bars are set in the game, on Settings at the foot of the help panel and of the K, P and J panels\."\/>/.test(xaml));
  yes('E3 resolution, the display mode, the frame limit and VSync stay on the launcher (#3146)',
      /x:Name="BoxResolution"/.test(xaml) && /x:Name="BoxFrameLimit"/.test(xaml) && /x:Name="ChkVSync"/.test(xaml) &&
      /x:Name="DisplayModeRow"/.test(xaml));
  // #3146 took the card off with the help pages, which Patrick had not asked
  // for; it came back on 30 Oct. Each row is read out of Thornswood.ini.
  yes('E4 the Play page\'s In game card names the emote wheel, trade, party, friend and journal keys as bound',
      /<StackPanel x:Name="QuickKeysCard"[^>]*>\s*<TextBlock Text="In game"/.test(xaml) && /<StackPanel x:Name="QuickKeys"\/>/.test(xaml) &&
      /keys = Keys\.All\(\);/.test(shellCs) &&
      ['emotewheel', 'tradewith', 'party', 'friendkey', 'journal'].every(function (id) {
        return new RegExp('AddKeyFor\\(keys, "' + id + '",').test(shellCs) && new RegExp('Dx\\("' + id + '",').test(keysCs);
      }));
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
