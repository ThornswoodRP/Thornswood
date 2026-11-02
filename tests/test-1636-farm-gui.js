// test-1636-farm-gui.js
//
// Farming at the plot, with nothing typed (#1636).
//
// Patrick, 4 October: "no more commands for things [people] do, only for dev
// and staff commands; everything else takes buttons and GUI". Sowing has been
// the press on an empty plot since 21 September. Seeing what is in the ground
// and whose farm it is, and claiming the farm, were typed: /plot and /claim.
// Now a crop under the crosshair draws a line that says both, names E when
// pressing it would sow it, and names the lock key, X unless LockKey moved
// it, when that key would claim the farm. The server keeps every rule it had.
//
// THE SERVER. The real crop table and farming block run over a pretend
// engine: the line written for a look, for a press and for a claim, each
// thing it offers only when its rule would let it through, and nothing for a
// crop out of reach or a reference that is not one. The real property block
// hands a claim at a crop to farming even a minute after a door.
//
// THE CLIENT. The lock key's section of thornswood-front.js runs over a
// pretend game and page: a crop looked at twice asks, a crop swept past does
// not, the answer is drawn only for its own crop and while it is new, the
// key sends the claim with the crop's id, and nothing is drawn or sent over
// a menu or the chat. The plugin's crops are the gamemode's crops.
//
// THE HELP. No list, help topic, page or launcher row names /plot, /plant or
// /claim at a plot, and no line the farming block says does.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };

const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
/*
  One topic of the help panel (#1633), as a fresh install reads it: /help's
  topics moved out of the gamemode into game/ui/thornswood-help.js, each a
  list of paragraphs made from the key names.
*/
function helpTopic(id) {
  const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-help.js'), 'utf8')
    .split(String.fromCharCode(13)).join('');
  const a = page.indexOf('  var TOPICS = [');
  const b = a < 0 ? -1 : page.indexOf('\n  ];\n', a);
  const k = /var keys = (\{[\s\S]*?\});/.exec(page);
  if (a < 0 || b < 0 || !k) { return ''; }
  try {
    const topics = new Function('return ' + page.slice(page.indexOf('[', a), b + 4))();
    const t = topics.filter(function (x) { return x.id === id; })[0];
    return t ? t.text(new Function('return ' + k[1])()).join(' ') : '';
  } catch (e) { return ''; }
}
const front = read(process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'));
// The rows on Settings in the game (#3126), where the Controls page's were.
const settingsPage = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-settings.js'));
const farmerMd = read(path.join(REPO_DIR, 'docs', 'systems', 'classes', 'farmer.md'));

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
function slice(src, start, end, includeEnd) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, includeEnd === false ? b : b + end.length);
}
function liftFrom(src, first, indent) {
  const from = '\n' + indent + first;
  const a = src.indexOf(from);
  if (a < 0 || src.indexOf(from, a + 1) >= 0) { return null; }
  const end = '\n' + indent + '}\n';
  const b = src.indexOf(end, a + 1);
  return b < 0 ? null : src.slice(a + 1, b + end.length);
}
function liftSpan(src, first, lastOpen) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const c = src.indexOf(lastOpen, a);
  if (c < 0) { return null; }
  const SHUT = '\n  }));\n';
  const b = src.indexOf(SHUT, c);
  return b < 0 ? null : src.slice(a, b + SHUT.length);
}

const cropCode = slice(gm, 'var CROPS_BY_BASE = ', 'var CROPS = mergeCrops();');
const farmBlock = slice(gm, '// ==== thornswood farming ====', '// ==== end thornswood farming ====');
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const tstart = gm.indexOf('    farming: {');
const tend = gm.indexOf('\n    }', tstart);
let tuning = null;
try { tuning = eval('({' + gm.slice(tstart, tend + 6) + '})').farming; } catch (e) { tuning = null; }
yes('the crop table, the farming and property blocks and the farming tuning are in the gamemode',
    !!cropCode && !!farmBlock && !!propBlock && !!tuning);
if (!cropCode || !farmBlock || !propBlock || !tuning) { done(); }

// ================================================================ the server
const clock = { t: Date.UTC(2026, 9, 4, 20, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }

const CELL = '3c:Skyrim.esm';
const CABBAGE = 'bcf48:Skyrim.esm';
const ids = {};
let nextId = 0x05000000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}

const refs = {};
function person(a, pid, name, cls, pos) {
  refs[a] = { profileId: pid, appearance: { name: name }, cls: cls, worldOrCellDesc: CELL,
              pos: pos, inventory: { entries: [] } };
}
function plot(id, base, pos) { refs[id] = { baseDesc: base, worldOrCellDesc: CELL, pos: pos }; }
const BRYNJA = 0xff000011, KJELD = 0xff000022, HULDA = 0xff000033;
person(BRYNJA, 11, 'Brynja', 'farmer', [4000, 0, 0]);
person(KJELD, 22, 'Kjeld', 'farmer', [4100, 0, 0]);
person(HULDA, 33, 'Hulda', 'cook', [4000, 100, 0]);
const P1 = 0x00a00101, P2 = 0x00a00102, FAR_PLOT = 0x00a00103, NEAR_PLOT = 0x00a00104, ROCK = 0x00a00105;
plot(P1, CABBAGE, [4050, 0, 0]);
plot(P2, CABBAGE, [4120, 0, 0]);
plot(FAR_PLOT, CABBAGE, [40000, 0, 0]);
plot(NEAR_PLOT, CABBAGE, [6000, 0, 0]);   // outside Brynja's 1200, inside two of them
refs[ROCK] = { baseDesc: '1f00:Skyrim.esm', worldOrCellDesc: CELL, pos: [4060, 0, 0] };
const hexOf = function (id) { return (id >>> 0).toString(16); };

const mp = {
  makeProperty: function () { },
  get: function (id, key) {
    if (!refs[id]) { throw new Error('no reference ' + id); }
    const v = refs[id][key];
    return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : (v === undefined ? null : v);
  },
  set: function (id, key, v) {
    if (!refs[id]) { refs[id] = {}; }
    refs[id][key] = JSON.parse(JSON.stringify(v));
  },
  getNeighborsByPosition: function (cell) {
    return Object.keys(refs).map(Number).filter(function (id) { return refs[id].worldOrCellDesc === cell; });
  },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function () { return null; }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1636-farm-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}
const box = {
  console: { log: function () { } }, require: require, mp: mp, Date: FakeDate, idOf: idOf,
  log: function () { },
  classGate: function (actorId) { return refs[actorId].cls === 'farmer' ? null : 'Only a farmer works a plot.'; },
  toolGate: function () { return null; },
  rankStep: function () { return 0; },
  creditWork: function () { return null; },
  economyGathered: function () { },
  wearTool: function () { return null; },
  addItem: function (actorId, desc, n) {
    const id = idOf(desc);
    const es = refs[actorId].inventory.entries;
    const e = es.filter(function (x) { return x.baseId === id; })[0];
    if (e) { e.count += n; } else { es.push({ baseId: id, count: n }); }
    return true;
  },
  takeItem: function (actorId, desc, n) {
    const id = idOf(desc);
    const es = refs[actorId].inventory.entries;
    const e = es.filter(function (x) { return x.baseId === id; })[0];
    if (!e || e.count < n) { return false; }
    e.count -= n;
    if (!e.count) { es.splice(es.indexOf(e), 1); }
    return true;
  }
};
box.globalThis = box;
box.__thornswoodProgression = { has: function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); },
                                TABLE: { tuning: { farming: tuning } } };
inDir(function () { vm.runInNewContext(cropCode + '\n' + farmBlock, box, { filename: 'gamemode.js farming' }); });
const F = box.__thornswoodFarming;
yes('the farming block runs and publishes itself', !!F && typeof F.command === 'function');
if (!F) { done(); }
const CROPS = box.CROPS;

const said = [];
function word(a, w, args) {
  const out = [];
  inDir(function () {
    F.command(w, [w].concat(args || []), a, refs[a].profileId, function (pid, m) { out.push(m); said.push(m); });
  });
  return out.join('\n');
}
function look(a, id) { return word(a, '/plot', [hexOf(id)]); }
function lineOf(a) { return refs[a].thornswoodPlotLine || null; }
function give(a, desc, n) { box.addItem(a, desc, n); }

// L1: THE DONE-WHEN. A crop looked at: what is in the ground, whose it is,
//     and the claim, with nothing said in the chat.
{
  const out = look(BRYNJA, P1);
  const l = lineOf(BRYNJA);
  yes('L1 a look is answered on the line and not in the chat', out === '' && !!l && l.hex === hexOf(P1));
  yes('L1 the line says what is in the ground and whose farm it is: "' + (l && l.t) + '"',
      !!l && /Cabbage standing from before anybody farmed here/.test(l.t) && /Nobody holds this ground/.test(l.t));
  yes('L1 and offers the claim to a farmer on ground nobody holds', !!l && l.x === 'Claim this farm');
  yes('L1 and no sowing on a plot that still holds what the world put there', !!l && l.e === '');
}

// L2: the key's claim, at that plot: the farm is hers, and the line says so.
{
  const out = word(BRYNJA, '/claim', [hexOf(P1)]);
  const l = lineOf(BRYNJA);
  yes('L2 the claim the key sends claims the farm: "' + out.split('. ')[0] + '"', /You claim this farm/.test(out));
  yes('L2 and the line is drawn again: hers, and nothing to claim', /This ground is yours/.test(l.t) && l.x === '');
}

// L3: an empty plot worked before: E sows it, but only with the crop in the pack.
{
  inDir(function () { F.activate(BRYNJA, P1, CABBAGE); });   // brings the standing cabbage in
  look(BRYNJA, P1);
  let l = lineOf(BRYNJA);
  yes('L3 an empty plot says so', /A Cabbage plot, and nothing sown in it/.test(l.t));
  const had = (refs[BRYNJA].inventory.entries[0] || {}).count || 0;
  yes('L3 with the cabbage the press brought in, E would sow it', had > 0 && l.e === 'Sow a Cabbage');
  refs[BRYNJA].inventory.entries = [];
  look(BRYNJA, P1);
  yes('L3 with no cabbage in the pack, no E', lineOf(BRYNJA).e === '');
  give(BRYNJA, CROPS[CABBAGE].produce, 2);
  look(BRYNJA, P1);
  yes('L3 and with one again, E', lineOf(BRYNJA).e === 'Sow a Cabbage');
  const before = lineOf(BRYNJA).at;
  let told = '';
  inDir(function () { told = F.activate(BRYNJA, P1, CABBAGE); });
  l = lineOf(BRYNJA);
  yes('L4 the press sows it: "' + told + '"', /You sow the Cabbage/.test(told));
  yes('L4 and the line is drawn again straight away, growing and no E', l.at > before && /Cabbage growing/.test(l.t) && l.e === '');
}

// L5: somebody else's farm, and somebody who is not a farmer.
{
  give(KJELD, CROPS[CABBAGE].produce, 2);
  look(KJELD, P2);
  const l = lineOf(KJELD);
  yes('L5 on Brynja\'s ground Kjeld is told whose it is: "' + l.t + '"', /held by Brynja/.test(l.t));
  yes('L5 and offered neither the press nor the claim', l.e === '' && l.x === '');
  const out = word(KJELD, '/claim', [hexOf(P2)]);
  yes('L5 and the claim sent anyway is refused by name', /already held by Brynja/.test(out));
  look(HULDA, P1);
  const h = lineOf(HULDA);
  yes('L6 a cook may look, and is offered nothing', /Cabbage growing/.test(h.t) && h.e === '' && h.x === '');
}

// L7: out of reach, or not a crop: the line comes down.
{
  refs[KJELD].pos = [5000, 0, 0];
  look(KJELD, P2);
  yes('L7 a crop out of reach writes an empty line', lineOf(KJELD).t === '' && lineOf(KJELD).x === '');
  refs[KJELD].pos = [4100, 0, 0];
  look(KJELD, ROCK);
  yes('L7 so does a reference that is not a crop', lineOf(KJELD).t === '');
  word(KJELD, '/plot', ['zz']);
  yes('L7 and an id that is not one', lineOf(KJELD).t === '' && lineOf(KJELD).hex === 'zz');
  const out = word(KJELD, '/claim', [hexOf(ROCK)]);
  yes('L7 a claim at something that is not a crop claims nothing', /No plot within reach/.test(out));
}

// L8: one farm a person, said before the key is pressed; farms do not overlap.
{
  refs[BRYNJA].pos = [40000, 50, 0];
  look(BRYNJA, FAR_PLOT);
  yes('L8 a farmer who holds a farm is told the claim lets it go', lineOf(BRYNJA).x === 'Claim this farm and let your other one go');
  refs[KJELD].pos = [6000, 50, 0];
  look(KJELD, NEAR_PLOT);
  yes('L9 ground that would run into a farm is not offered', lineOf(KJELD).x === '' && /Nobody holds this ground/.test(lineOf(KJELD).t));
  const out = word(KJELD, '/claim', [hexOf(NEAR_PLOT)]);
  yes('L9 and the claim sent anyway says why', /run into the farm Brynja holds/.test(out));
}

// L10: nothing the farming block said names a command.
{
  word(KJELD, '/plant', []);
  word(BRYNJA, '/plot', []);
  const named = said.filter(function (m) { return /\/(plant|plot|claim)\b/.test(m); });
  yes('L10 no line the farming block said names /plant, /plot or /claim' + (named.length ? ' (' + named[0] + ')' : '') +
      ', over ' + said.length + ' lines', named.length === 0 && said.length >= 5);
  const code = farmBlock.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const strings = [];
  const rx = /'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = rx.exec(code)) !== null) {
    // A word compared against, the line a press hands plotLine, and the
    // block's own log are not said to anybody.
    const before = code.slice(Math.max(0, m.index - 60), m.index);
    const statement = code.slice(code.lastIndexOf(';', m.index) + 1, m.index);
    if (/word === $/.test(before) || /\[$/.test(before) || /\bflog\(/.test(statement)) { continue; }
    if (/\/(plant|plot|claim)\b/.test(m[1])) { strings.push(m[1]); }
  }
  yes('L10 nor any sentence written in the block' + (strings.length ? ' (' + strings[0] + ')' : ''), strings.length === 0);
}

// L11: the line's script on the client, edge triggered on the stamp.
{
  const sm = /function plotLineScript\(\) \{[\s\S]*?\n  \}\n/.exec(farmBlock);
  let script = '';
  try { script = new Function(sm[0] + '\nreturn plotLineScript();')(); } catch (e) { script = ''; }
  const G = {};
  const run = function (v, now) {
    new Function('ctx', 'globalThis', 'Date', script)({ value: v }, G, { now: function () { return now; } });
  };
  run({ at: 5, hex: '12d', t: 'Cabbage growing.', e: '', x: 'Claim this farm' }, 1000);
  run({ at: 5, hex: '12d', t: 'Cabbage growing.', e: '', x: 'Claim this farm' }, 8000);
  yes('L11 the script puts the answer where the plugin reads it, and a repeat does not restart its clock',
      !!G.thornswoodPlotLine && G.thornswoodPlotLine.hex === '12d' && G.thornswoodPlotLine.seen === 1000 &&
      G.thornswoodPlotLine.x === 'Claim this farm');
}

// ============================================ /claim: the door's or the crop's
{
  const DOOR = '1002:Skyrim.esm', HOME = '16778:Skyrim.esm';
  const BUILDING_NAME = {}; BUILDING_NAME[HOME] = 'Honeyside';
  const BUILDING_BY_DOOR = {}; BUILDING_BY_DOOR[DOOR] = HOME;
  const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1636-door-'));
  fs.writeFileSync(path.join(pdir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
  const pbox = {
    console: { log: function () { } }, require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: BUILDING_BY_DOOR, BUILDING_NAME: BUILDING_NAME, WAY_OUT: {}, BENCH_BY_BASE: {},
    idOf: idOf, notify: function () { }, say: function () { }, guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { }, log: function () { },
    addItem: box.addItem, takeItem: box.takeItem
  };
  pbox.globalThis = pbox;
  const was = process.cwd();
  process.chdir(pdir);
  try {
    vm.runInNewContext(propBlock, pbox, { filename: 'gamemode.js property' });
    const W = pbox.__thornswoodProperty;
    refs[0] = { onlinePlayers: [BRYNJA] };
    W.touched(BRYNJA, DOOR);
    const r1 = W.command('/claim', ['/claim', hexOf(P1)], BRYNJA, 11, function () { });
    yes('D1 a minute after a door, the key\'s claim at a crop is not the property block\'s', r1 === false && !W.holderOf(HOME));
    const r2 = W.command('/claim', ['/claim', '1002'], BRYNJA, 11, function () { });
    yes('D2 and at the door it still is', r2 === true && !!W.holderOf(HOME) && W.holderOf(HOME).by === 11);
  } finally { process.chdir(was); }
}

// ================================================================ the client
const CLIENT = {
  iniNumber: liftFrom(front, 'function iniNumber(text, key, fallback) {', '  '),
  keyName: liftFrom(front, 'function keyName(code) {', '  '),
  anyClaim: liftFrom(front, 'function anyClaim() {', '  '),
  gameMenuOpen: liftFrom(front, 'function gameMenuOpen() {', '  '),
  busyMenuOpenNow: liftFrom(front, 'function busyMenuOpenNow(except) {', '  '),
  stampedMolds: liftFrom(front, 'function stampedMolds(pc, base) {', '  '),
  menus: (function () {
    const a = front.indexOf('  const KEYBOARD_MENUS = [');
    const b = a < 0 ? -1 : front.indexOf('\n  ];\n', a);
    return b < 0 ? null : front.slice(a, b + 6);
  })(),
  lock: liftSpan(front, '  const LOCK_EVERY = ', "  sp.on('menuOpen', guard('lock menu',")
};
const missing = Object.keys(CLIENT).filter(function (k) { return !CLIENT[k]; });
yes('every piece of the plugin half is in thornswood-front.js' + (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''),
    missing.length === 0);

const PLOT_HERE = { id: 0x12d, type: 39, base: 0xbcf48 };
const OTHER_PLOT = { id: 0x12e, type: 39, base: 0xbcf48 };
function client() {
  const w = { now: 1700000000000, crosshair: null, menus: {}, claims: {}, sent: [], handlers: {}, G: {} };
  const els = {};
  const doc = {
    getElementById: function (id) { return els[id] || null; },
    createElement: function () { return { id: '', style: { cssText: '', display: '' }, innerHTML: '' }; },
    body: { appendChild: function (el) { els[el.id] = el; } }
  };
  const T = { ready: true, js: function (src) { if (!T.ready) { return false; } new Function('document', src)(doc); return true; } };
  w.T = T;
  const files = { 'Skyrim.esm': 0x00000000, 'Dragonborn.esm': 0x04000000, 'JKs Skyrim.esp': 0x8b000000,
                  "JK's Whiterun's Outskirts.esp": 0x8c000000, 'North Keep.esp': 0x8a000000 };
  const sp = {
    on: function (name, fn) { (w.handlers[name] = w.handlers[name] || []).push(fn); },
    getExtraContainerChanges: function () { return []; },
    Game: {
      getPlayer: function () { return { getFormID: function () { return 0x14; }, getItemCount: function () { return 0; } }; },
      getFormFromFile: function (id, file) {
        if (!Object.prototype.hasOwnProperty.call(files, file)) { return null; }
        return { getFormID: function () { return (files[file] | id) >>> 0; } };
      },
      getFormEx: function () { return null; },
      getCurrentCrosshairRef: function () {
        const c = w.crosshair;
        if (!c) { return null; }
        return { getFormID: function () { return c.id; },
                 getBaseObject: function () { return { getType: function () { return c.type; },
                                                       getFormID: function () { return c.base; } }; } };
      }
    },
    Ui: { isMenuOpen: function (name) { return !!w.menus[name]; } },
    Utility: { isInMenuMode: function () { return false; } }
  };
  const body = [
    CLIENT.iniNumber, CLIENT.keyName, CLIENT.anyClaim, CLIENT.gameMenuOpen, CLIENT.menus,
    CLIENT.busyMenuOpenNow,
    'const LOCK_KEY = 45; const LOCK_NAME = keyName(LOCK_KEY);',
    "const MOLD_FILE = 'Thornswood-Content.esp'; const MOLD_ITEM = 0x15495; const DOOR_TYPE = 29;",
    'let moldBase = 0;',
    CLIENT.stampedMolds, CLIENT.lock,
    'return { lockPress: lockPress };'
  ].join('\n');
  w.api = new Function('sp', 'T', 'claims', 'tellServer', 'say', 'log', 'guard', 'globalThis', body)(
    sp, T, w.claims, function (line) { w.sent.push(line); }, function () { }, function () { },
    function (name, fn) { return fn; }, w.G);
  w.tick = function () { w.now += 400; (w.handlers.update || []).forEach(function (f) { f(); }); };
  w.menuOpens = function (name) { w.menus[name] = true; (w.handlers.menuOpen || []).forEach(function (f) { f({ name: name }); }); };
  w.lineText = function () {
    const d = els['ts-lock'];
    if (!d || d.style.display === 'none') { return ''; }
    return String(d.innerHTML).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  };
  w.answer = function (hex, t, e, x) { w.G.thornswoodPlotLine = { stamp: w.now, seen: w.now, hex: hex, t: t, e: e || '', x: x || '' }; };
  return w;
}
const realNow = Date.now;
let clockOf = null;
Date.now = function () { return clockOf ? clockOf.now : realNow(); };
try {
  if (missing.length === 0) {
    // C1: a crop looked at twice asks, once.
    {
      const w = client(); clockOf = w;
      w.crosshair = PLOT_HERE;
      w.tick();
      yes('C1 the first look at a crop asks nothing, so a crop swept past is never asked about', w.sent.length === 0);
      w.tick();
      yes('C1 the second look asks for the line, with the crop\'s id', w.sent.length === 1 && w.sent[0] === '/plot 12d');
      w.tick(); w.tick();
      yes('C1 and does not ask again while the answer is on its way', w.sent.length === 1 && w.lineText() === '');
      w.answer('12d', 'Cabbage growing, 20 minutes to go. Nobody holds this ground.', '', 'Claim this farm');
      w.tick();
      yes('C2 the answer is drawn, with the claim on the lock key: "' + w.lineText() + '"',
          w.lineText() === 'Cabbage growing, 20 minutes to go. Nobody holds this ground. X Claim this farm');
      yes('C2 and the key sends the claim with the crop\'s id', w.api.lockPress() === true && w.sent[w.sent.length - 1] === '/claim 12d');
      w.answer('12d', 'A Cabbage plot, and nothing sown in it. This ground is yours.', 'Sow a Cabbage', '');
      w.tick();
      yes('C3 an empty plot of yours names E to sow it: "' + w.lineText() + '"',
          w.lineText() === 'A Cabbage plot, and nothing sown in it. This ground is yours. E Sow a Cabbage');
      const n = w.sent.length;
      yes('C3 and with nothing to claim the lock key falls through', w.api.lockPress() === false && w.sent.length === n);
      for (let i = 0; i < 25; i++) { w.tick(); }
      yes('C4 it is asked again after ten seconds of looking, and not before', w.sent.length === n + 1 && w.sent[n] === '/plot 12d');
    }
    // C5: the answer is only for its own crop, and only while it is new.
    {
      const w = client(); clockOf = w;
      w.crosshair = OTHER_PLOT;
      w.answer('12d', 'Cabbage growing.', '', 'Claim this farm');
      w.tick();
      yes('C5 an answer for another crop is not drawn here', w.lineText() === '' && w.api.lockPress() === false);
      w.crosshair = PLOT_HERE;
      w.now += 31000;
      w.tick();
      yes('C5 nor one older than thirty seconds', w.lineText() === '' && w.api.lockPress() === false);
    }
    // C6: never over a menu or while the chat has the keyboard.
    {
      const w = client(); clockOf = w;
      w.crosshair = PLOT_HERE;
      w.answer('12d', 'Cabbage growing.', '', 'Claim this farm');
      w.tick();
      yes('C6 the line is up', w.lineText() !== '');
      w.menuOpens('InventoryMenu');
      yes('C6 a menu takes it down', w.lineText() === '');
      w.tick();
      yes('C6 and nothing is asked or sent under it', w.lineText() === '' && w.api.lockPress() === false &&
          w.sent.filter(function (s) { return /^\/claim/.test(s); }).length === 0);
      w.menus = {};
      w.claims.chat = true;
      w.tick();
      yes('C6 nor while the chat has the keyboard', w.lineText() === '' && w.api.lockPress() === false);
    }
    // C7: something else under the crosshair asks nothing.
    {
      const w = client(); clockOf = w;
      w.crosshair = { id: 0x200, type: 39, base: 0xbcf49 };
      w.tick(); w.tick();
      yes('C7 a flower that is not a crop asks nothing and draws nothing', w.sent.length === 0 && w.lineText() === '');
    }
  }
} finally {
  Date.now = realNow;
}

// The plugin's crops are the gamemode's crops.
{
  const server = Object.keys(CROPS).map(function (k) { return k.toLowerCase(); }).sort();
  const m = /const CROP_BASES = \[([\s\S]*?)\];/.exec(front);
  const mine = [];
  if (m) {
    const rx = /\[(['"])(.+?)\1, 0x([0-9a-f]+)\]/gi;
    let r;
    while ((r = rx.exec(m[1])) !== null) { mine.push((parseInt(r[3], 16).toString(16) + ':' + r[2]).toLowerCase()); }
  }
  mine.sort();
  yes('F1 the plugin\'s crops are every crop the gamemode answers (' + server.length + ')',
      server.length > 10 && JSON.stringify(server) === JSON.stringify(mine));
}

// ================================================= nobody is told to type them
{
  const pw = (/const PLAYER_WORDS = \[([\s\S]*?)\];/.exec(gm) || [])[1] || '';
  const named = ['/plot', '/plant', '/claim'].filter(function (x) { return pw.indexOf("'" + x + "'") !== -1; });
  yes('H1 the list of words named to everybody has none of /plot, /plant, /claim' + (named.length ? ' (' + named.join(', ') + ')' : ''),
      pw.length > 0 && named.length === 0);
  const words = (/const WORDS = \[([\s\S]*?)\];/.exec(gm) || [])[1] || '';
  yes('H2 and the server still answers the lines the line and the key send',
      ['/plot', '/claim'].every(function (x) { return words.indexOf("'" + x + "'") !== -1; }));
  // The help is a panel since #1633: its Work and Land, as a fresh install reads them.
  ['work', 'land'].forEach(function (t) {
    const said = helpTopic(t);
    yes('H3 the help panel\'s ' + t + ' topic names none of them', said.length > 100 && !/\/(plot|plant|claim)\b/.test(said));
  });
  yes('H4 farmer.md tells nobody to type them', !/`\/(plot|plant|claim)`/.test(farmerMd) && /Claim this farm/.test(farmerMd));
  const row = (/\{ ini: 'LockKey', def: 45,[^}]*\}/.exec(settingsPage) || [''])[0];
  yes('H5 the Settings row says the key claims a farm at a crop', /At a crop, it claims the farm/.test(row));
}

done();
