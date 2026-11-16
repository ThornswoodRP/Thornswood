// test-mod-settings.js
//
// Mod settings menus keep what somebody chose, per character, across a
// server restart. Issue #488.
//
// WHY. A classic SkyUI menu keeps its choices in the save, and there is no save
// here, so Apocalypse, AHZmoreHUD, atlas map markers, Skyrim Unbound and
// chfshVariousActions started from their defaults every session. The front
// plugin now reads the GLOB records wired to those menus (78 since Atlas Map
// Markers' were dropped for revision 6, #3649) and sends what
// moved as /modset lines; the gamemode keeps them in private\mod-settings.json
// and puts them back through an owner-visible property when the character
// comes in.
//
// This cuts the mod settings block out of gamemode.js and runs it against a
// stand-in mp and a temp folder, twice: the second load is the restart, and
// what the first one was told has to still be there. It also runs the
// property's script against a stand-in Skyrim Platform, lifts the front
// plugin's half and drives it with a stand-in journal, and checks the two
// tables are the same.
//
// Read only, apart from its own temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const SRC = process.env.GAMEMODE || path.join(ROOT, 'game', 'gamemode.js');
const FRONT = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const START = '// ==== thornswood mod settings ====';
const END = '// ==== end thornswood mod settings ====';
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;
yes('gamemode.js has its mod settings block', block !== null);
if (!block) done();

const box = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-mod-settings-'));
const dataDir = path.join(box, 'data');
const privDir = path.join(box, 'private');
fs.mkdirSync(dataDir);
fs.writeFileSync(path.join(box, 'server-settings.json'),
  JSON.stringify({ port: 7787, dataDir: dataDir, privDir: privDir }));

/*
  One server process: a stand-in mp, the block loaded into it, and the tick it
  starts. room is who is on, as actor id -> profile id.
*/
function boot(room) {
  const made = {};
  const sets = [];
  const mp = {
    makeProperty: function (name, opts) { made[name] = opts; },
    get: function (id, what) {
      if (id === 0 && what === 'onlinePlayers') { return Object.keys(room).map(Number); }
      if (what === 'profileId') { return room[id]; }
      return undefined;
    },
    set: function (id, name, value) { sets.push({ id: id, name: name, value: JSON.parse(JSON.stringify(value)) }); },
    // The engine's whole-file write (#2740), as far as the gamemode can tell.
    writeFileWhole: function (p, text) { fs.writeFileSync(p, text); }
  };
  let tick = null;
  const logged = [];
  const sandbox = {
    mp: mp,
    require: require,
    console: { log: function (s) { logged.push(String(s)); } },
    setInterval: function (fn) { tick = fn; return 1; },
    clearInterval: function () { },
    guard: function (name, fn) { return fn; },
    Date: Date, JSON: JSON, String: String, Number: Number, Object: Object, Math: Math
  };
  sandbox.globalThis = sandbox;
  const was = process.cwd();
  process.chdir(box);
  try {
    vm.runInNewContext(block, sandbox, { filename: 'gamemode.js mod settings block' });
  } finally {
    process.chdir(was);
  }
  return { api: sandbox.__thornswoodModSettings, made: made, sets: sets, tick: tick, logged: logged, room: room };
}

function line(text) { return String(text).trim().split(/\s+/); }
const FILE = path.join(privDir, 'mod-settings.json');
function onDisk() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { return null; }
}

// ------------------------------------------------------------ first server
const one = boot({});
yes('the block publishes its interface', !!(one.api && one.api.command && one.api.tick));
if (!one.api) done();
const M = one.api;
const TABLE = M.MOD_GLOBALS;

// ---- the table
const files = Object.keys(TABLE);
const counts = {};
let total = 0;
files.forEach(function (f) { counts[f] = Object.keys(TABLE[f]).length; total += counts[f]; });
yes('78 settings are kept (got ' + total + ')', total === 78);
yes('across the four menus left of the five Patrick named, with the audit\'s counts (got ' + JSON.stringify(counts) + ')',
    counts['Apocalypse - Magic of Skyrim.esp'] === 31 && counts['AHZmoreHUD.esp'] === 40 &&
    counts['Skyrim Unbound.esp'] === 6 && counts['chfshVariousActions.esp'] === 1 && files.length === 4);
let idsOk = true;
files.forEach(function (f) {
  Object.keys(TABLE[f]).forEach(function (n) {
    const id = TABLE[f][n];
    if (typeof id !== 'number' || id <= 0 || id > 0xffffff) { idsOk = false; }
  });
});
yes('every id is the id inside its plugin, never a load order index', idsOk);
// A menu whose mod left the collection leaves this table in the same change
// (#3649: Atlas Map Markers and its 98 globals, with revision 6).
const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'collection-plugins.json'), 'utf8')).plugins
  .map(function (p) { return p.name.toLowerCase(); });
const gone = files.filter(function (f) { return shipped.indexOf(f.toLowerCase()) < 0; });
yes('every menu kept is a plugin of the collection (not: ' + gone.join(', ') + ')', gone.length === 0);

// ---- the property
const prop = one.made[M.MOD_SETTINGS_PROPERTY];
yes('the property is made', !!prop);
yes('its owner sees it and nobody else does', prop && prop.isVisibleByOwner === true && prop.isVisibleByNeighbors === false);
yes('it carries the put back script', prop && prop.updateOwner === M.putBackScript() && prop.updateOwner.length > 100);

// ---- a line is taken
const P = 1964204031;
let r = M.command(P, 0, line('/modset AHZShowBookSkill=0 DelayDragonMin=1 WB_General_Global_XP=1.5 chfshVAMenuHotkey=62'));
yes('four known names with numbers are all taken (took ' + r.took + ', refused ' + r.refused.join('; ') + ')',
    r.took === 4 && r.refused.length === 0);
let disk = onDisk();
yes('they are in private\\mod-settings.json at once',
    !!disk && disk.who && disk.who[String(P)] &&
    disk.who[String(P)].AHZShowBookSkill === 0 && disk.who[String(P)].DelayDragonMin === 1 &&
    disk.who[String(P)].WB_General_Global_XP === 1.5 && disk.who[String(P)].chfshVAMenuHotkey === 62);
yes('and nothing lands in the served data folder', fs.readdirSync(dataDir).length === 0);
yes('no temp copy is left beside it', !fs.existsSync(FILE + '.tmp'));

// ---- what is refused
r = M.command(P, 0, line('/modset Bogus=1 __proto__=1 constructor=2 hasOwnProperty=3 toString=4'));
yes('unknown names are refused, the prototype ones included (refused ' + r.refused.length + ')',
    r.took === 0 && r.refused.length === 5);
r = M.command(P, 0, line('/modset AHZHotKey=abc AHZHotKey=0x10 AHZHotKey=Infinity AHZHotKey=NaN AHZHotKey=1e400 ' +
                         'AHZHotKey= AHZHotKey=2e9 AHZHotKey=1,5 AHZHotKey=12345678901234567890123456789012345'));
yes('non-numbers, hex, infinities, empties and huge numbers are refused (took ' + r.took + ', refused ' + r.refused.length + ')',
    r.took === 0 && r.refused.length === 9);
r = M.command(P, 0, line('/modset AHZHotKey AHZHotKey=1=2 =5'));
yes('a pair with no = or two of them is refused', r.took === 0 && r.refused.length === 3);
disk = onDisk();
yes('none of that reached the file',
    !('AHZHotKey' in disk.who[String(P)]) && !('Bogus' in disk.who[String(P)]) &&
    Object.keys(disk.who[String(P)]).length === 4);
yes('the refusals are logged', one.logged.some(function (l) { return /refused from profile 1964204031/.test(l); }));

// Too many pairs on one line: the first MOD.pairs are taken, the rest refused.
// Names the checks below do not read back, so filling a line with them moves
// nothing those checks look at.
const READ_BACK = ['AHZShowBookSkill', 'WB_General_Global_XP', 'chfshVAMenuHotkey', 'DelayDragonMin', 'AHZHotKey', 'AHZIconSize'];
const names = [].concat.apply([], files.map(function (f) { return Object.keys(TABLE[f]); }))
  .filter(function (n) { return READ_BACK.indexOf(n) < 0; });
const many = ['/modset'].concat(names.slice(0, M.MOD.pairs + 5).map(function (n) { return n + '=0'; }));
r = M.command(P, 0, many);
yes('at most ' + M.MOD.pairs + ' pairs are taken from one line (took ' + r.took + ')',
    r.took === M.MOD.pairs && r.refused.length === 5);
r = M.command(0, 0, line('/modset AHZHotKey=1'));
yes('a line with no profile keeps nothing', r.took === 0 && r.refused.length === 1);
r = M.command(P, 0, line('/modset AHZHotKey=-3.25 AHZIconSize=.5'));
yes('negatives and a bare decimal are numbers', r.took === 2);

// ---- the gamemode's router
const wm = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(src);
const WORDS = wm ? new Function('return ' + wm[1])() : [];
yes('/modset is in the words the server answers', WORDS.indexOf('/modset') !== -1);
const pm = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
const PW = pm ? new Function('return ' + pm[1])() : ['/modset'];
yes('and not in the words /help names, because nobody types it', PW.indexOf('/modset') === -1);
const ra = src.indexOf('  function runsNow(word, parts) {');
const rb = ra < 0 ? -1 : src.indexOf('\n  }\n', ra);
if (ra >= 0 && rb > ra) {
  const runsNow = new Function('WORDS', 'return ' + src.slice(ra + 2, rb + 4) + ';')(WORDS);
  yes('it runs at once, never held for a character', runsNow('/modset', ['/modset']) === true);
} else {
  yes('runsNow is in the gamemode', false);
}
const hs = src.indexOf('  function handle(cmd) {');
const route = hs < 0 ? -1 : src.indexOf("if (word === '/modset') {", hs);
yes('handle() hands /modset to the block with the profile, the actor and the words',
    route > hs && /__thornswoodModSettings;[\s\S]{0,120}mods\.command\(profileId, actorId, parts\)/.test(src.slice(route, route + 400)));

// ------------------------------------------------------------- the restart
const A = 0xff000007;
const two = boot({});
yes('the second load reads the file back (' + (two.api ? Object.keys(two.api.book).length : 0) + ' character)',
    !!two.api && !!two.api.book[String(P)]);
const kept = two.api.book[String(P)] || {};
yes('the value written before the restart is still there after it',
    kept.AHZShowBookSkill === 0 && kept.WB_General_Global_XP === 1.5 && kept.chfshVAMenuHotkey === 62 &&
    kept.AHZHotKey === -3.25);

two.room[A] = P;
two.tick();
const pushed = two.sets.filter(function (s) { return s.id === A && s.name === two.api.MOD_SETTINGS_PROPERTY; });
yes('when the character comes in, the property is set on them once', pushed.length === 1);
const val = pushed.length ? pushed[0].value : {};
const ahz = (val.set && val.set['AHZmoreHUD.esp']) || [];
function has(rows, id, v) { return rows.some(function (row) { return row[0] === id && row[1] === v; }); }
yes('it carries a stamp and the values by plugin and id inside the plugin',
    typeof val.at === 'number' && has(ahz, TABLE['AHZmoreHUD.esp'].AHZShowBookSkill, 0) &&
    has(val.set['Apocalypse - Magic of Skyrim.esp'] || [], TABLE['Apocalypse - Magic of Skyrim.esp'].WB_General_Global_XP, 1.5) &&
    has(val.set['chfshVariousActions.esp'] || [], 0x539c, 62));
two.tick();
yes('a second tick with them still on sets nothing more',
    two.sets.filter(function (s) { return s.id === A; }).length === 1);

two.api.command(P, A, line('/modset AHZShowBookSkill=1'));
const after = two.sets.filter(function (s) { return s.id === A; });
yes('a change while they are on keeps the property current under the same stamp, so it is not applied twice',
    after.length === 2 && after[1].value.at === val.at &&
    has(after[1].value.set['AHZmoreHUD.esp'], TABLE['AHZmoreHUD.esp'].AHZShowBookSkill, 1));

delete two.room[A];
two.tick();
two.room[A] = P;
two.tick();
const again = two.sets.filter(function (s) { return s.id === A; });
yes('leaving and coming back sends them again with a new stamp',
    again.length === 3 && again[2].value.at !== undefined);

two.room[0xff000008] = 42;
two.tick();
yes('somebody with nothing kept is sent nothing', two.sets.filter(function (s) { return s.id === 0xff000008; }).length === 0);

// A hand edit with junk in it does not reach anybody.
const junk = onDisk();
// ATLASGroupInnGV is what a character kept for Atlas before revision 6 took it out.
junk.who['77'] = { AHZHotKey: 5, Bogus: 1, AHZIconSize: 'big', DelayDragonMin: 1e300, ATLASGroupInnGV: 1 };
junk.who['not a profile'] = { AHZHotKey: 1 };
fs.writeFileSync(FILE, JSON.stringify(junk));
const three = boot({});
yes('a restart drops anything in the file that is not a known name with a sane number',
    JSON.stringify(three.api.book['77']) === '{"AHZHotKey":5}' && !three.api.book['not a profile'] &&
    three.api.book[String(P)].AHZShowBookSkill === 1);

// ---------------------------------------------------- the put back script
function stubSp(present) {
  const globals = {};
  const calls = [];
  return {
    globals: globals, calls: calls,
    sp: {
      Game: {
        getFormFromFile: function (id, file) {
          calls.push(file + ':' + id.toString(16));
          return present ? { file: file, id: id } : null;
        }
      },
      GlobalVariable: {
        from: function (f) {
          if (!f) { return null; }
          return { setValue: function (v) { globals[f.file + ':' + f.id.toString(16)] = v; } };
        }
      },
      printConsole: function () { }
    }
  };
}
const script = new Function('ctx', three.api.putBackScript());
const value = three.api.payload(P, 12345);
const s1 = stubSp(true);
const ctx = { value: value, state: {}, sp: s1.sp };
script(ctx);
yes('the script sets every kept value on the right global',
    s1.globals['AHZmoreHUD.esp:' + TABLE['AHZmoreHUD.esp'].AHZShowBookSkill.toString(16)] === 1 &&
    s1.globals['chfshVariousActions.esp:539c'] === 62 &&
    Object.keys(s1.globals).length === Object.keys(three.api.book[String(P)]).length);
const n1 = s1.calls.length;
script(ctx); script(ctx);
yes('and on the frames after, with the same stamp, does nothing', s1.calls.length === n1);
ctx.value = three.api.payload(P, 12346);
script(ctx);
yes('a new stamp puts them back again', s1.calls.length === n1 * 2);

const s2 = stubSp(false);
const ctx2 = { value: value, state: {}, sp: s2.sp };
script(ctx2);
const tried = s2.calls.length;
script(ctx2);
yes('a world not up yet is not asked again inside the same second', tried > 0 && s2.calls.length === tried);

// ---------------------------------------------------- the front plugin's half
const FS = '  // ---------------------------------------------- mod settings menus (#488)';
const FE = '  // ---------------------------------------------- end mod settings menus';
const fa = front.indexOf(FS);
const fb = fa < 0 ? -1 : front.indexOf(FE, fa);
yes('thornswood-front.js has its mod settings block', fa >= 0 && fb > fa);
if (fa >= 0 && fb > fa) {
  const fblock = front.slice(fa, fb);
  const told = [];
  const handlers = {};
  const world = {};   // runtime id -> value
  const byFile = {};  // file:local -> runtime id
  let next = 0x05000001;
  const fsp = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    Form: { from: function (f) { return f ? { getFormID: function () { return f.id; } } : null; } },
    Game: {
      getFormFromFile: function (local, file) {
        const k = file + ':' + local;
        if (!byFile[k]) { byFile[k] = next++; world[byFile[k]] = 0; }
        return { id: byFile[k] };
      },
      getFormEx: function (id) { return world[id] === undefined ? null : { id: id }; }
    },
    GlobalVariable: { from: function (f) { return f ? { getValue: function () { return world[f.id]; } } : null; } }
  };
  const clock = { t: 1000000 };
  const fn = new Function('sp', 'tellServer', 'guard', 'log', 'JOURNAL_MENU', 'Date',
    fblock + '\nreturn { MOD_GLOBALS: MOD_GLOBALS, modCheck: modCheck, MOD_LINES_AT_ONCE: MOD_LINES_AT_ONCE };');
  const F = fn(fsp, function (l) { told.push(l); }, function (n, f) { return f; }, function () { }, 'Journal Menu',
               { now: function () { return clock.t; } });
  function fire(name, e) { (handlers[name] || []).forEach(function (h) { h(e); }); }
  function setG(file, name, v) { world[byFile[file + ':' + F.MOD_GLOBALS[file][name]]] = v; }

  yes('the front plugin\'s table is the gamemode\'s, name for name and id for id',
      JSON.stringify(F.MOD_GLOBALS) === JSON.stringify(TABLE));
  yes('it listens for the journal opening and closing, and a slow beat',
      (handlers.menuOpen || []).length === 1 && (handlers.menuClose || []).length === 1 && (handlers.update || []).length === 1);

  // The first frame's beat is the first read.
  fire('update');
  fire('menuOpen', { name: 'Journal Menu' });
  yes('the first read is where things stand, and sends nothing', told.length === 0);
  setG('AHZmoreHUD.esp', 'AHZShowBookSkill', 1);
  fire('menuClose', { name: 'Inventory Menu' });
  yes('another menu closing reads nothing', told.length === 0);
  fire('menuClose', { name: 'Journal Menu' });
  yes('the journal closing sends what moved, and only that (got ' + JSON.stringify(told) + ')',
      told.length === 1 && told[0] === '/modset AHZShowBookSkill=1');
  fire('menuOpen', { name: 'Journal Menu' });
  fire('menuClose', { name: 'Journal Menu' });
  yes('nothing moved, nothing sent', told.length === 1);

  // Every AHZmoreHUD setting changed at once: more than one line, each short.
  Object.keys(F.MOD_GLOBALS['AHZmoreHUD.esp']).forEach(function (n) { setG('AHZmoreHUD.esp', n, 7); });
  told.length = 0;
  fire('menuClose', { name: 'Journal Menu' });
  function pairsIn(list) {
    return list.join(' ').split(' ').filter(function (w) { return w.indexOf('=') > 0; });
  }
  yes('40 changes go out in ' + told.length + ' lines, every one under the 400 the voice service keeps',
      told.length > 1 && told.length <= F.MOD_LINES_AT_ONCE &&
      told.every(function (l) { return l.length <= 380 && l.indexOf('/modset ') === 0; }));
  yes('and every changed name is in them once', pairsIn(told).length === 40);

  // Each line the plugin sends is one the gamemode takes whole.
  let allTaken = true;
  told.forEach(function (l) { const rr = three.api.take(55, line(l)); if (rr.refused.length) { allTaken = false; } });
  yes('the gamemode takes every pair the plugin sends', allTaken && Object.keys(three.api.book['55']).length === 40);

  // All 78 at once, each to a number written out long, is more than one go
  // (11 lines): the rest follows a few seconds later rather than pushing the
  // chat's own lines out of tellServer's queue.
  Object.keys(F.MOD_GLOBALS).forEach(function (file) {
    Object.keys(F.MOD_GLOBALS[file]).forEach(function (n) { setG(file, n, -0.1234567890123456); });
  });
  told.length = 0;
  fire('menuClose', { name: 'Journal Menu' });
  const first = told.length;
  const firstPairs = pairsIn(told).length;
  yes('78 changes send at most ' + F.MOD_LINES_AT_ONCE + ' lines at once (sent ' + first + ', ' + firstPairs + ' pairs)',
      first === F.MOD_LINES_AT_ONCE && firstPairs < 78);
  clock.t += 1000;
  fire('update');
  yes('nothing more in the next second', told.length === first);
  clock.t += 5000;
  fire('update');
  const all = pairsIn(told);
  const uniq = {};
  all.forEach(function (p) { uniq[p.split('=')[0]] = true; });
  yes('and the rest five seconds later, each name once (' + all.length + ' pairs in ' + told.length + ' lines)',
      all.length === 78 && Object.keys(uniq).length === 78);
  clock.t += 5000;
  fire('update');
  yes('then the beat is quiet until a minute has gone', pairsIn(told).length === 78);
}

try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) { }
done();
