// test-whose-game-gate.js
//
// The whose-game gate is one copy, in thornswood-front.js, and every other
// plugin in game/plugins reads that copy and stays idle without it.
//
// WHY THIS EXISTS. Issue #485, "The same thirty-four lines are copied
// verbatim into five plugins" (To Do List entry 293). The gate is what keeps
// the plugins idle unless the client points at this server and the launcher
// left a fresh session note, a settled design line in Developer-Guide.md. Four
// copies were four places for one to drift, and a drifted copy is invisible:
// it parses, it loads, and it only shows when somebody plays another server
// from the same Skyrim and one of our plugins wakes up on top of it.
//
// HOW IT IS ONE COPY WITHOUT FAILING OPEN. The plan written on the issue
// (others call front's copy, and carry on when it is not there) fails open:
// Skyrim Platform builds its load list with std::filesystem::directory_iterator
// (GetPathsToLoad in the fork's skyrim-platform/src/platform_se/skyrim_platform/
// SkyrimPlatform.cpp), NTFS hands names back in name order, so
// thornswood-emotes.js loads before thornswood-front.js and would find nothing.
// What was done instead: front publishes its check as
// globalThis.Thornswood.whoseGame, only once it has said ours, and each other
// plugin runs nothing at load. It asks skyrimPlatform.once('tick') and decides
// there. TickImpl in the same file runs every plugin file in one pass and only
// then sends "tick", so on that tick front has published or did not load,
// whatever the order. Nothing published, or the check saying not ours, is
// idle. EventsApi::SendEvent calls a once callback a single time, and its own
// try per callback keeps one plugin's throw from the others.
//
// What it checks, for every .js in game/plugins (Ship.ps1 sends every one of
// them to Data/Platform/Plugins, so a fifth plugin is checked too):
//   - front.js has thornswoodGame() as the first thing its wrapper runs, and
//     publishes it on globalThis.Thornswood only after it said ours, before
//     the line that stops a second load;
//   - no other plugin has a copy: no thornswoodGame, no session note read, no
//     server address;
//   - every other plugin is the same reader, character for character, with
//     nothing before it, and its whole body is the function handed to it;
//   - run for real, each one: runs nothing and reads nothing at load; on the
//     first tick asks front's check exactly once and runs only when it says
//     ours; stays idle when front published nothing (front did not load),
//     when the check says not ours, and when Thornswood is there without the
//     check; and front's real check against fake files decides it end to end;
//   - front's check gives the right answer in 15 cases against a fake file
//     system (no settings, another server, ours with a fresh, stale or missing
//     note, a Thornswood.ini address, a byte order mark);
//   - the one fixed address in `ours` is the ServerAddress default in
//     launcher/app/Config.cs, which is where Set-Vps.ps1 reads the old address
//     from, and Set-Vps.ps1's walk reaches front.js. Then Set-Vps's replacement
//     is applied and the check is run again against the new address.
// And that it has teeth: a copy of the check planted back in a plugin, a
// reader that carries on without the check, and a reader that runs at load
// are each caught.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pluginPass = require('./fixtures/plugin-pass');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const REPO = REPO_DIR;
const PLUGINS = path.join(REPO, 'game', 'plugins');
const OWNER = 'thornswood-front.js';
const GUARD = 'if (!thornswoodGame()) { return; }';
const PUBLISH = 'T.whoseGame = thornswoodGame;';
const SECOND_LOAD = 'if (T.front) return;';

const INI = 'Data/SKSE/Plugins/Thornswood.ini';
const SETTINGS = 'Data/Platform/Plugins/skymp5-client-settings.txt';
const NOTE = 'Data/Platform/thornswood-session.txt';

// The reader every other plugin opens with. Held here as text on purpose:
// a reader that drifts is the failure this file exists for.
const READER = [
  '// ------------------------------------------------------------ whose game ----',
  '// thornswood-front.js owns the whose-game check (issue #485): the client',
  '// settings must point at this server and the launcher\'s session note must be',
  '// fresh, or every Thornswood plugin stays idle. Front publishes the check as',
  '// globalThis.Thornswood.whoseGame, and only when it says ours. This plugin',
  '// runs nothing until the first tick: Skyrim Platform runs every file in',
  '// Data/Platform/Plugins in one pass and sends that tick after the pass',
  '// (TickImpl in the fork\'s skyrim-platform SkyrimPlatform.cpp), so by then',
  '// front has published the check or did not load, whichever order the files',
  '// came in. Nothing published means idle; so does the check saying not ours.',
  '(function (start) {',
  '  skyrimPlatform.once(\'tick\', function () {',
  '    const T = globalThis.Thornswood;',
  '    if (!T || typeof T.whoseGame !== \'function\' || !T.whoseGame()) { return; }',
  '    start();',
  '  });',
  '})(function () {',
  '\'use strict\';'
].join('\n');
const CLOSE = '});';

function lf(text) { return text.split('\r\n').join('\n'); }

/* front's check, braces balanced. */
const lift = function (src) { return pluginPass.frontCheck(src); };

/* The first line of code inside front's wrapper, or why there is none. */
function firstStatement(src) {
  const lines = src.split(/\r?\n/);
  let i = 0;
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '(function () {') { break; }
    if (t && t.indexOf('//') !== 0) { return 'code outside the wrapper: ' + t; }
  }
  if (i >= lines.length) { return 'no (function () { wrapper'; }
  for (i = i + 1; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t || t === "'use strict';" || t.indexOf('//') === 0) { continue; }
    return t;
  }
  return 'nothing inside the wrapper';
}

/*
  A reader plugin: whatever comments open the file, then READER, then the body,
  then CLOSE as the last line. Returns why not, or ''.
*/
function readerShape(src) {
  const text = lf(src);
  const at = text.indexOf(READER);
  if (at < 0) { return 'the reader is not there, character for character'; }
  const before = text.slice(0, at).split('\n').filter(function (l) {
    const t = l.trim(); return t && t.indexOf('//') !== 0;
  });
  if (before.length) { return 'code before the reader: ' + before[0].trim(); }
  if (text.indexOf(READER, at + 1) >= 0) { return 'the reader is there twice'; }
  const tail = text.replace(/\s+$/, '');
  if (tail.slice(-CLOSE.length) !== CLOSE || tail.slice(-'})();'.length) === '})();') {
    return 'the file does not end with ' + CLOSE + ', closing the body handed to the reader';
  }
  return '';
}

// A fixed clock, so a stale note is stale by the same amount every run.
const NOW = Date.UTC(2026, 8, 24, 20, 0, 0);
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

function settings(ip, bom) {
  return (bom ? String.fromCharCode(0xFEFF) : '') + JSON.stringify({ 'server-ip': ip, 'server-port': 7777 }, null, 2);
}
// As Keep.LeaveNote writes it: unix milliseconds, a space, the build name.
function note(ms) { return ms + ' Thornswood Dev'; }

/* Run front's lifted check against a fake game folder. */
function run(fnText, files) {
  const said = [], read = [];
  const fakeFs = {
    readFileSync: function (p) {
      read.push(p);
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const e = new Error('ENOENT: no such file, open \'' + p + '\'');
        e.code = 'ENOENT';
        throw e;
      }
      return files[p];
    }
  };
  const fakeRequire = function (name) {
    if (name === 'fs') { return fakeFs; }
    throw new Error('the gate asked for ' + name);
  };
  const fakeSp = { printConsole: function (m) { said.push(String(m)); } };
  const fakeDate = { now: function () { return NOW; }, parse: Date.parse };
  let answer;
  try {
    const make = new Function('require', 'skyrimPlatform', 'Date',
      "'use strict';\n" + fnText + '\nreturn thornswoodGame;');
    answer = make(fakeRequire, fakeSp, fakeDate)();
  } catch (e) {
    answer = 'threw: ' + e.message;
  }
  return { answer: answer, said: said, read: read };
}

// ------------------------------------------------ the address Set-Vps moves
const configCs = fs.readFileSync(path.join(REPO, 'launcher', 'app', 'Config.cs'), 'utf8');
const setVps = fs.readFileSync(path.join(REPO, 'scripts', 'vps', 'Set-Vps.ps1'), 'utf8');
const OLD_RX = 'public\\s+string\\s+ServerAddress\\s*=\\s*"([^"]+)"';

yes('Set-Vps.ps1 still takes the address it moves from the ServerAddress default in app\\Config.cs',
    setVps.indexOf("Join-Path $Here '..\\..\\launcher\\app\\Config.cs'") >= 0 && setVps.indexOf("'" + OLD_RX + "'") >= 0);
const cfgMatch = new RegExp(OLD_RX).exec(configCs);
yes('app\\Config.cs has a ServerAddress default', !!cfgMatch);
const OURS = cfgMatch ? cfgMatch[1] : '';
console.log('      the address Set-Vps.ps1 moves: ' + OURS);

function quoted(list) {
  const out = [];
  const rx = /'([^']*)'/g;
  let m;
  while ((m = rx.exec(list))) { out.push(m[1]); }
  return out;
}
const skipMatch = /\$skipDirs\s*=\s*@\(([^)]*)\)/.exec(setVps);
const extMatch = /\$f\.Extension\s+-notin\s+@\(([^)]*)\)/.exec(setVps);
yes('Set-Vps.ps1 still has a list of folders it skips and of extensions it reads', !!skipMatch && !!extMatch);
const SKIP = skipMatch ? quoted(skipMatch[1]) : [];
const EXTS = extMatch ? quoted(extMatch[1]) : [];
const sizeMatch = /\$f\.Length\s+-gt\s+(\d+)MB/.exec(setVps);
const MAX = sizeMatch ? Number(sizeMatch[1]) * 1024 * 1024 : 0;

// ------------------------------------------------------------- the plugins
const names = fs.readdirSync(PLUGINS).filter(function (n) { return /\.js$/i.test(n); }).sort();
yes('game/plugins has front and the three that read its check, ' + names.length + ' .js in all',
    ['thornswood-emotes.js', 'thornswood-front.js', 'thornswood-mark.js', 'thornswood-voice.js']
      .every(function (n) { return names.indexOf(n) >= 0; }));
const SRC = {};
names.forEach(function (n) { SRC[n] = fs.readFileSync(path.join(PLUGINS, n), 'utf8'); });
const readers = names.filter(function (n) { return n !== OWNER; });

// ------------------------------------------------------------ the one copy
const front = SRC[OWNER] || '';
const FN = lift(front);
yes('front.js has thornswoodGame(), ' + (FN ? FN.split(/\r?\n/).length : 0) + ' lines', !!FN);
{
  const first = firstStatement(front);
  yes('front.js: the gate is the first thing its wrapper runs', first === GUARD);
  if (first !== GUARD) { console.log('      found instead: ' + first); }
  const g = front.indexOf(GUARD);
  const make = front.indexOf('globalThis.Thornswood = globalThis.Thornswood || {}');
  const pub = front.indexOf(PUBLISH);
  const stop = front.indexOf(SECOND_LOAD);
  yes('front.js publishes the check as globalThis.Thornswood.whoseGame, once',
      pub >= 0 && front.indexOf(PUBLISH, pub + 1) < 0);
  yes('and only after it said ours: Thornswood is made after the gate and the check put on it after that',
      g >= 0 && make > g && pub > make);
  yes('and before the line that stops a second load, so a reload hands over a current copy',
      stop > pub);
  const ours = FN ? /const ours = \[([^\]]*)\];/.exec(FN) : null;
  const list = ours ? quoted(ours[1]) : [];
  yes('front.js: the one fixed address it calls ours is ' + OURS + ', the one Set-Vps.ps1 moves',
      !!OURS && list.length === 1 && list[0] === OURS);
  if (list.length !== 1 || list[0] !== OURS) { console.log('      ours is [' + list.join(', ') + ']'); }
  const rel = ['game', 'plugins', OWNER];
  const size = fs.statSync(path.join(PLUGINS, OWNER)).size;
  yes('front.js: Set-Vps.ps1 reads it on a server move (extension, folder, size)',
      EXTS.indexOf('.js') >= 0 && rel.every(function (p) { return SKIP.indexOf(p) < 0; }) && MAX > 0 && size <= MAX);
}

/* Everything that would make a plugin a second copy. */
function copyIn(src) {
  const found = [];
  if (src.indexOf('thornswoodGame') >= 0) { found.push('thornswoodGame'); }
  if (src.indexOf('thornswood-session.txt') >= 0) { found.push('a read of the session note'); }
  if (OURS && src.indexOf(OURS) >= 0) { found.push('the server address ' + OURS); }
  return found;
}
readers.forEach(function (n) {
  const found = copyIn(SRC[n]);
  yes(n + ': holds no copy of the check (no thornswoodGame, no session note, no address)', found.length === 0);
  if (found.length) { console.log('      found: ' + found.join(', ')); }
  const why = readerShape(SRC[n]);
  yes(n + ': opens with the reader, nothing before it, and its body is the function handed to it', !why);
  if (why) { console.log('      ' + why); }
});

// ------------------------------------------------------- each reader, run
/*
  A Skyrim Platform that lets the plugin do anything and writes down that it
  did. Any property of skyrimPlatform other than once, or any require, means
  the body started. once('tick') callbacks are kept for the tick.
*/
function rig(T) {
  const seen = { body: [], reads: 0, ticks: [] };
  function anything(name) {
    const f = function () { return anything(name + '()'); };
    return new Proxy(f, {
      get: function (t, k) {
        if (k === Symbol.toPrimitive) { return function () { return 0; }; }
        if (k === 'then') { return undefined; }
        return anything(name + '.' + String(k));
      },
      apply: function () { return anything(name + '()'); }
    });
  }
  const sp = new Proxy({}, {
    get: function (t, k) {
      if (k === 'once') {
        return function (name, fn) { if (name === 'tick') { seen.ticks.push(fn); } };
      }
      seen.body.push(String(k));
      return anything('sp.' + String(k));
    }
  });
  const box = {
    skyrimPlatform: sp,
    require: function (name) { seen.body.push('require ' + name); seen.reads++; return anything('require'); },
    console: { log: function () { } }, Date: Date, JSON: JSON, Math: Math, Number: Number, String: String,
    Object: Object, Array: Array, RegExp: RegExp, Error: Error, isFinite: isFinite, parseInt: parseInt,
    setTimeout: function () { }, clearTimeout: function () { }, setInterval: function () { }, clearInterval: function () { }
  };
  if (T !== undefined) { box.Thornswood = T; }
  vm.createContext(box);
  return { box: box, seen: seen };
}
function load(n, r) {
  let threw = '';
  try { vm.runInContext(SRC[n], r.box, { filename: n }); } catch (e) { threw = String(e); }
  return threw;
}
function tick(r) {
  r.seen.ticks.splice(0).forEach(function (fn) {
    try { fn(); } catch (e) { /* the body ran into the rig's limits; it started */ }
  });
}
function asked(answer) {
  const c = { n: 0 };
  c.fn = function () { c.n++; return answer; };
  return c;
}

readers.forEach(function (n) {
  // Ours: published, says true.
  {
    const check = asked(true);
    const r = rig({ whoseGame: check.fn });
    const threw = load(n, r);
    yes(n + ': loads without throwing', !threw);
    if (threw) { console.log('      ' + threw); }
    yes(n + ': runs nothing and reads nothing at load (it touched ' + (r.seen.body.slice(0, 3).join(', ') || 'nothing') + ')',
        r.seen.body.length === 0 && check.n === 0);
    yes(n + ': leaves exactly one once(\'tick\') to decide on', r.seen.ticks.length === 1);
    tick(r);
    yes(n + ': on the first tick asks front\'s check once and, told ours, runs', check.n === 1 && r.seen.body.length > 0);
  }
  // Front published, check says not ours (a reload after the session ended).
  {
    const check = asked(false);
    const r = rig({ whoseGame: check.fn });
    load(n, r); tick(r);
    yes(n + ': told not ours by the check, stays idle', check.n === 1 && r.seen.body.length === 0);
  }
  // Front did not load: nothing on globalThis at all.
  {
    const r = rig(undefined);
    load(n, r); tick(r);
    yes(n + ': front did not load, nothing published, stays idle', r.seen.body.length === 0);
  }
  // Thornswood is there (another of ours made it) but holds no check.
  {
    const r = rig({ ready: true, js: function () { return true; } });
    load(n, r); tick(r);
    yes(n + ': Thornswood there without the check, stays idle', r.seen.body.length === 0);
  }
  // The other order: the reader loads first, front publishes after it in the same pass.
  {
    const r = rig({});
    load(n, r);
    const check = asked(true);
    r.box.Thornswood.whoseGame = check.fn;
    tick(r);
    yes(n + ': loaded before front in the same pass, still runs once front published', check.n === 1 && r.seen.body.length > 0);
  }
  // End to end with front's real check over fake files, through the fixture the other harnesses use.
  [
    { what: 'ours with a fresh note', files: { [SETTINGS]: settings(OURS), [NOTE]: note(Date.now()) }, want: true },
    { what: 'another server', files: { [SETTINGS]: settings('10.1.2.3'), [NOTE]: note(Date.now()) }, want: false },
    { what: 'ours with no note', files: { [SETTINGS]: settings(OURS) }, want: false }
  ].forEach(function (k) {
    const r = rig(undefined);
    const files = k.files;
    const fakeFs = { readFileSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) { throw new Error('ENOENT ' + p); }
      return files[p];
    } };
    // front's check reads through this require; the plugin's body reads through the rig's.
    const bodyRequire = r.box.require;
    let inFront = true;
    r.box.require = function (name) { return inFront ? fakeFs : bodyRequire(name); };
    const realSp = r.box.skyrimPlatform;
    r.box.skyrimPlatform = new Proxy({}, { get: function (t, k2) {
      if (inFront && k2 === 'printConsole') { return function () { }; }
      return realSp[k2];
    } });
    let said = null;
    try {
      const out = pluginPass.load(r.box, '', {});
      said = out.ours;
    } catch (e) { said = 'threw ' + e; }
    // pluginPass ran front's check (and an empty plugin); now the real reader, then the tick.
    const checkFn = r.box.Thornswood && r.box.Thornswood.whoseGame;
    let calls = 0;
    if (checkFn) {
      r.box.Thornswood.whoseGame = function () {
        calls++; inFront = true;
        try { return checkFn(); } finally { inFront = false; }
      };
    }
    inFront = false;
    r.box.skyrimPlatform = realSp;
    load(n, r); tick(r);
    const ran = r.seen.body.length > 0;
    yes(n + ': with front\'s real check, ' + k.what + ': ' + (k.want ? 'runs' : 'idle'),
        said === k.want && ran === k.want && (k.want ? calls === 1 : true));
  });
});

// ------------------------------------------------------- what front's check says
const FRESH = note(NOW - 5 * 60 * 1000);
const CASES = [
  { what: 'no client settings to read: carry on, as before', files: {}, want: true },
  { what: 'client settings that are not JSON: carry on, as before',
    files: { [SETTINGS]: 'not json' }, want: true },
  { what: 'the client points at another server, even with a fresh note',
    files: { [SETTINGS]: settings('10.1.2.3'), [NOTE]: FRESH }, want: false },
  { what: 'ours, with the note the launcher leaves when it starts the game',
    files: { [SETTINGS]: settings(OURS), [NOTE]: FRESH }, want: true },
  { what: 'ours, the settings written with a byte order mark',
    files: { [SETTINGS]: settings(OURS, true), [NOTE]: FRESH }, want: true },
  { what: 'ours, a note written as a date rather than milliseconds',
    files: { [SETTINGS]: settings(OURS), [NOTE]: new Date(NOW - HOUR).toISOString() + ' Start-Thornswood' }, want: true },
  { what: 'ours, a note a few seconds ahead of this clock',
    files: { [SETTINGS]: settings(OURS), [NOTE]: note(NOW + 5000) }, want: true },
  { what: 'ours, a note a day and a minute old',
    files: { [SETTINGS]: settings(OURS), [NOTE]: note(NOW - DAY - 60000) }, want: false },
  { what: 'ours, a note thirty hours old',
    files: { [SETTINGS]: settings(OURS), [NOTE]: note(NOW - 30 * HOUR) }, want: false },
  { what: 'ours, and no note, as another server\'s launcher leaves it',
    files: { [SETTINGS]: settings(OURS) }, want: false },
  { what: 'ours, a note with nothing readable in it',
    files: { [SETTINGS]: settings(OURS), [NOTE]: 'soon' }, want: false },
  { what: 'no address in the settings, with a fresh note',
    files: { [SETTINGS]: settings(''), [NOTE]: FRESH }, want: true },
  { what: 'no address in the settings and no note',
    files: { [SETTINGS]: settings('') }, want: false },
  { what: 'an address Thornswood.ini names, with a fresh note',
    files: { [INI]: '[Server]\nServerAddress = 10.9.8.7 ; the test box\n', [SETTINGS]: settings('10.9.8.7'), [NOTE]: FRESH }, want: true },
  { what: 'Thornswood.ini names a box and the client points at a third',
    files: { [INI]: '[Server]\nServerAddress = 10.9.8.7\n', [SETTINGS]: settings('10.1.2.3'), [NOTE]: FRESH }, want: false }
];

let saidWhy = true, quietWhenOurs = true, readOnlyThree = true;
CASES.forEach(function (k) {
  const r = FN ? run(FN, k.files) : { answer: 'no function', said: [], read: [] };
  yes('front\'s check, ' + k.what + ': ' + (k.want ? 'runs' : 'idle'), r.answer === k.want);
  if (r.answer !== k.want) { console.log('      said ' + r.answer); }
  if (k.want === false && !r.said.some(function (s) { return /Every Thornswood plugin idle\.$/.test(s); })) { saidWhy = false; }
  if (k.want === true && r.said.length) { quietWhenOurs = false; }
  if (r.read.some(function (p) { return p !== INI && p !== SETTINGS && p !== NOTE; })) { readOnlyThree = false; }
});
yes('it says in the console why every plugin went idle, every time it does', saidWhy);
yes('and says nothing when the session is ours', quietWhenOurs);
yes('and reads nothing but Thornswood.ini, the client settings and the session note', readOnlyThree);

// ---------------------------------------------------- a server move reaches it
// Set-Vps.ps1 rewrites every file it reads with $text.Replace($Old, $Address).
// Do the same to front.js and ask the check again. 203.0.113.9 is a
// documentation address, never a real box.
{
  const NEW = '203.0.113.9';
  const moved = OURS ? lift(front.split(OURS).join(NEW)) : null;
  const toNew = moved ? run(moved, { [SETTINGS]: settings(NEW), [NOTE]: FRESH }).answer : 'no function';
  const toOld = moved ? run(moved, { [SETTINGS]: settings(OURS), [NOTE]: FRESH }).answer : 'no function';
  yes('after Set-Vps.ps1\'s replacement front\'s check runs for the new box', toNew === true);
  yes('and treats the old box as somebody else\'s', toOld === false);
}

// ------------------------------------------------------ the checks have teeth
{
  const n = readers[0];
  const base = lf(SRC[n]);   // the reader is held with plain line ends
  const planted = base.replace(READER, READER + '\n' + (FN || ''));
  yes('a copy of the check planted back in ' + n + ' is caught', copyIn(planted).length > 0);

  const open = base.replace("if (!T || typeof T.whoseGame !== 'function' || !T.whoseGame()) { return; }",
                              "if (T && typeof T.whoseGame === 'function' && !T.whoseGame()) { return; }");
  yes('a reader that carries on without the check is a real edit', open !== base);
  yes('and is caught as a different reader', !!readerShape(open));
  {
    SRC['planted-open.js'] = open;
    const r = rig(undefined);
    load('planted-open.js', r); tick(r);
    yes('and run, it wakes with nothing published, where the real one stays idle', r.seen.body.length > 0);
    delete SRC['planted-open.js'];
  }

  const atLoad = base.replace(READER, READER.replace("  skyrimPlatform.once('tick', function () {", '  (function () {')
    .replace('    start();\n  });', '    start();\n  })();'));
  yes('a reader that decides at load is a real edit', atLoad !== base);
  yes('and is caught as a different reader', !!readerShape(atLoad));
  {
    SRC['planted-load.js'] = atLoad;
    const r = rig({});
    load('planted-load.js', r);
    yes('and run before front published, it decides at load and never runs: the order trap the tick is for',
        r.seen.ticks.length === 0 && r.seen.body.length === 0);
    delete SRC['planted-load.js'];
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
