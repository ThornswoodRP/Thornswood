// test-thornswood-keys.js
//
// Thornswood's own keys, held together: the shipped Thornswood.ini, the
// rows on Settings in the game (game/ui/thornswood-settings.js, with the
// front's SETTINGS_KEYS beside them) and the plugins' defaults say the same
// thing, no two of them share a key, and every row can be written.
//
// FOUND 24 September by the review of pull request 287 (#529). The template
// put the emote wheel on G, which is also the friend key, while the emote
// plugin and Keys.cs defaulted the wheel to B, which is also the voice mode
// key. PartyKey, JournalKey, FriendKey, TradeWithKey and MuteThemKey were
// not in the template, and Keys.WriteIni only rewrote a line already in the
// file, so those rows failed with "Could not write Thornswood.ini" on every
// install. MoldKey had no Controls row, so the clash check did not know U
// was taken.
//
// #3126 moved the rows from the launcher's Controls page (Keys.cs) into the
// game, where they are written by the front's iniWith and setSetting. The
// launcher keeps a reader for the six keys it names (Keys.All), held to the
// template here too.
//
// Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(ROOT, ...bits), 'utf8').split(CR).join(''); }

const ini = read('launcher', 'Thornswood.ini');
const keysCs = read('launcher', 'app', 'Keys.cs');
const settingsPage = read('game', 'ui', 'thornswood-settings.js');
const front = read('game', 'plugins', 'thornswood-front.js');
const emotes = read('game', 'plugins', 'thornswood-emotes.js');
const voice = read('game', 'plugins', 'thornswood-voice.js');
const mark = read('game', 'plugins', 'thornswood-mark.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Not keys: a port, a switch, a number of seconds and a text size.
const NOT_KEYS = ['VoicePort', 'Microphone', 'ChatFade', 'NeedsBars', 'Fov', 'TextSize'];

const template = {};
{
  const rx = /^\s*(\w+)\s*=\s*(\d+)\s*$/gm;
  let m;
  while ((m = rx.exec(ini)) !== null) {
    if (NOT_KEYS.indexOf(m[1]) === -1) { template[m[1]] = Number(m[2]); }
  }
}

// The rows on Settings in the game.
const rows = {};
{
  const rx = /\{ ini: '(\w+)', def: (-?\d+),/g;
  let m;
  while ((m = rx.exec(settingsPage)) !== null) { rows[m[1]] = Number(m[2]); }
}
// The front's own list of what it may write, and the launcher's reader.
const frontRows = {};
{
  const a = front.indexOf('const SETTINGS_KEYS = {');
  const b = front.indexOf('};', a);
  const body = a >= 0 && b > a ? front.slice(a, b) : '';
  const rx = /(\w+): (\d+)/g;
  let m;
  while ((m = rx.exec(body)) !== null) { frontRows[m[1]] = Number(m[2]); }
}
const launcherRows = {};
{
  const rx = /Dx\("\w+", "(\w+)", (\d+)\)/g;
  let m;
  while ((m = rx.exec(keysCs)) !== null) { launcherRows[m[1]] = Number(m[2]); }
}

const plugins = {};
function plugin(name, code, who) { (plugins[name] = plugins[name] || []).push({ code: code, who: who }); }
{
  let m;
  const rxFront = /iniNumber\(ini, '(\w+)', (\d+)\)/g;
  while ((m = rxFront.exec(front)) !== null) {
    if (NOT_KEYS.indexOf(m[1]) === -1) { plugin(m[1], Number(m[2]), 'front'); }
  }
  const rxEm = /key\('(\w+)', (\d+)\)/g;
  while ((m = rxEm.exec(emotes)) !== null) { plugin(m[1], Number(m[2]), 'emotes'); }
  const vars = {};
  const rxVar = /^let (\w+_KEY) = (\d+);/gm;
  while ((m = rxVar.exec(voice)) !== null) { vars[m[1]] = Number(m[2]); }
  const rxGrab = /(\w+_KEY) = grab\('(\w+)', \1\)/g;
  while ((m = rxGrab.exec(voice)) !== null) { plugin(m[2], vars[m[1]], 'voice'); }
  const mk = /^let markKey = (\d+);/m.exec(mark);
  if (mk) { plugin('MarkKey', Number(mk[1]), 'mark'); }
}

yes('the template, the Settings rows and the plugins were all read (' +
    Object.keys(template).length + ' keys, ' + Object.keys(rows).length + ' rows, ' +
    Object.keys(plugins).length + ' plugin keys)',
    Object.keys(template).length >= 15 && Object.keys(rows).length >= 15 && Object.keys(plugins).length >= 15);

// Every Settings row is in the template, at the same value, and the front
// writes exactly those keys with the same defaults.
Object.keys(rows).forEach(function (k) {
  yes('Settings row ' + k + ' is in the template, at ' + rows[k],
      Object.prototype.hasOwnProperty.call(template, k) && template[k] === rows[k]);
});
yes('the front\'s SETTINGS_KEYS are the page\'s rows, at the same defaults (' +
    Object.keys(frontRows).length + ' and ' + Object.keys(rows).length + ')',
    Object.keys(frontRows).length === Object.keys(rows).length &&
    Object.keys(rows).every(function (k) { return frontRows[k] === rows[k]; }));
{
  // Every key of ours in the template has a row, so no key is left that
  // only a text editor can move. MarkKey is the exception: the mark plugin
  // is a dev's tool that only somebody the site calls a dev can use, so it
  // has no row on everybody's Settings.
  const missing = Object.keys(template).filter(function (k) { return k !== 'MarkKey' && !Object.prototype.hasOwnProperty.call(rows, k); });
  yes('every key in the template has a row on Settings' + (missing.length ? ' (not ' + missing.join(', ') + ')' : ''), missing.length === 0);
}
Object.keys(launcherRows).forEach(function (k) {
  yes('the launcher reads ' + k + ' with the template\'s value, ' + launcherRows[k],
      Object.prototype.hasOwnProperty.call(template, k) && template[k] === launcherRows[k]);
});
yes('the launcher reads the six keys it names (' + Object.keys(launcherRows).length + ')', Object.keys(launcherRows).length === 6);

// Every key a plugin reads is in the template, at the same value.
Object.keys(plugins).forEach(function (k) {
  plugins[k].forEach(function (p) {
    yes(p.who + ' reads ' + k + ' with the template\'s value, ' + p.code,
        Object.prototype.hasOwnProperty.call(template, k) && template[k] === p.code);
  });
});

// And nothing in the template is read by nobody. MenuKey was, until #831.
const UNREAD_KNOWN = [];
Object.keys(template).forEach(function (k) {
  if (UNREAD_KNOWN.indexOf(k) !== -1) { return; }
  yes('the template\'s ' + k + ' is read by a plugin',
      Object.prototype.hasOwnProperty.call(plugins, k) || new RegExp("['\"]" + k + "['\"]|\\b" + k + '\\s*=').test(front + emotes + voice + mark));
});

// No two keys on one code.
{
  const by = {};
  Object.keys(template).forEach(function (k) { (by[template[k]] = by[template[k]] || []).push(k); });
  const shared = Object.keys(by).filter(function (c) { return by[c].length > 1; })
    .map(function (c) { return c + ': ' + by[c].join(' and '); });
  yes('no two of our keys share a default' + (shared.length ? ' (' + shared.join('; ') + ')' : ''), shared.length === 0);
}

yes('the key mold has a Settings row, so the clash check knows U is taken', rows.MoldKey === 22);
yes('the lock key has a Settings row, so the clash check knows X is taken', rows.LockKey === 45);
yes('the emote wheel is G everywhere', template.WheelKey === 34 && rows.WheelKey === 34);
yes('and the friend key is not', template.FriendKey !== 34);
yes('no row writes MuteKey, which nothing reads', !Object.prototype.hasOwnProperty.call(rows, 'MuteKey'));

// A row for a key an older install's file does not have yet still writes,
// and nothing but Thornswood.ini is ever written.
{
  const a = front.indexOf('function iniWith(text, key, value) {');
  const b = front.indexOf('\n  }\n', a);
  const src = a >= 0 && b > a ? front.slice(a, b + 4) : '';
  let iniWith = null;
  try { iniWith = new Function(src + '\nreturn iniWith;')(); } catch (e) { iniWith = null; }
  const old = '; keys\r\n[Emotes]\r\nWheelKey = 34\r\n';
  const added = iniWith ? iniWith(old, 'MoldKey', '22') : '';
  yes('iniWith adds a missing key to Thornswood.ini, at the end, in the file\'s own line ends',
      added === '; keys\r\n[Emotes]\r\nWheelKey = 34\r\nMoldKey = 22\r\n');
  const moved = iniWith ? iniWith('WheelKey=34\n; WheelKey = 1\nWheelKey = 30\n', 'WheelKey', '33') : '';
  yes('and rewrites one where it is, keeping its spacing, its comments, and dropping a second copy',
      moved === 'WheelKey=33\n; WheelKey = 1\n');
  const gone = iniWith ? iniWith('Fov = 90\nChatFade = 5\n', 'Fov', null) : '';
  yes('and a setting back at its default takes its line out', gone === 'ChatFade = 5\n');
  const s0 = front.indexOf('function setSetting(name, raw) {');
  const s1 = front.indexOf('\n  }\n', s0);
  const set = s0 >= 0 && s1 > s0 ? front.slice(s0, s1) : '';
  yes('setSetting writes Thornswood.ini and no other file: another mod\'s is never touched',
      (set.match(/writeFileSync\(/g) || []).length === 1 && /writeFileSync\(INI, after\)/.test(set));
  yes('the launcher no longer writes a key anywhere', !/WriteIni|WriteAllLines|WriteAllText/.test(keysCs));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
