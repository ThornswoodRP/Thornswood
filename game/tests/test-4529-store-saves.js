'use strict';
/*
  test-4529-store-saves.js

      node game/tests/test-4529-store-saves.js

  #4529: a server stop during a save could wipe the property register, the
  farm claims or the season file, and Patrick's comment adds four more
  written the same way: law.json (jail cell doors and held offices),
  beds.json (inn guests and kept takings), benches.json and the furniture
  register. Each was written straight over the old file with writeFileSync,
  which empties it before it writes, and each loader read a file that would
  not parse as empty and said nothing. So a stop partway left a half written
  file, the next start read nothing from it, and the next save wrote that
  nothing over everything.

  What it holds:
    1. One read and write path, storeRead and storeWrite, the same text in
       the season, farming, property and furniture blocks (each is lifted
       and run alone by other harnesses, so each carries it).
    2. That path, lifted out of each of the four blocks and run over a temp
       folder: a half written file and a file that is not JSON are each said
       in the log with the file and never taken for a store that holds
       nothing; the first save keeps the bad file as <file>.unreadable-<time>
       with its bytes as they were and writes the new one whole; a save
       that fails partway leaves the old file whole; no .tmp is left.
    3. Each of the seven stores reads through storeRead and saves through
       storeWrite with what it read, and none writes its file in place.
    4. The real property block booted over a temp folder whose register is
       half written, law.json not JSON, beds.json half written and
       benches.json cut to nothing: each of the four is said in the log, a
       deposit then keeps the half written register aside byte for byte and
       writes a whole one, and a second boot reads that one back.

  Read only, apart from its own temp folders, which it removes.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('../../tests/gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const START = process.cwd();
const temps = [];
function temp(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4529-' + tag + '-')); temps.push(d); return d; }
function done() {
  process.chdir(START);
  temps.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { console.log('      could not remove ' + d + ': ' + e.message); } });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(text, start, end) {
  const a = text.indexOf(start);
  if (a < 0) { return null; }
  const b = text.indexOf(end, a + start.length);
  return b < 0 ? null : text.slice(a, b + end.length);
}

const BLOCKS = ['season', 'farming', 'property', 'furniture'];
const block = {};
BLOCKS.forEach(function (n) { block[n] = slice(gm, '// ==== thornswood ' + n + ' ====', '// ==== end thornswood ' + n + ' ===='); });
yes('0 the season, farming, property and furniture blocks are in the gamemode', BLOCKS.every(function (n) { return !!block[n]; }));
if (!BLOCKS.every(function (n) { return !!block[n]; })) { done(); }

// ------------------------------------------------------------ 1. one path
const BEGIN = '  // -- store: read and write (#4529), begin --';
const END = '  // -- store: read and write (#4529), end --';
const helper = {};
BLOCKS.forEach(function (n) { helper[n] = slice(block[n], BEGIN, END); });
yes('1a each of the four blocks carries the read and write path', BLOCKS.every(function (n) { return !!helper[n]; }));
yes('1b and it is the same text in all four',
    BLOCKS.every(function (n) { return !!helper[n] && helper[n] === helper.property; }));
yes('1c and once in each block', BLOCKS.every(function (n) { return block[n].split(BEGIN).length === 2; }));

// ---------------------------------------------- 2. the path, in each block
const GOOD = JSON.stringify({ claims: { a: { by: 7, at: 1 } }, funds: { whiterun: 40 } }, null, 1);
const HALF = GOOD.slice(0, Math.floor(GOOD.length / 2));
BLOCKS.forEach(function (n) {
  if (!helper[n]) { yes('2 ' + n + ': there is a path to run', false); return; }
  const said = [];
  const clock = { t: 1790000000000 };
  const box = { require: require, console: { log: function (s) { said.push(String(s)); } },
                Date: { now: function () { return clock.t; } }, JSON: JSON, String: String };
  vm.createContext(box);
  vm.runInContext(helper[n] + '\nthis.storeRead = storeRead; this.storeWrite = storeWrite;', box);
  const d = temp(n);
  const f = path.join(d, 'private', 'store.json');
  fs.mkdirSync(path.dirname(f));

  let r = box.storeRead(f, 'thing');
  yes('2 ' + n + ': no file is a new store, said nowhere', r.doc === null && !r.bad && said.length === 0);

  fs.writeFileSync(f, '\ufeff' + GOOD);
  r = box.storeRead(f, 'thing');
  yes('2 ' + n + ': a whole file reads', !!r.doc && r.doc.funds.whiterun === 40 && !r.bad);

  fs.writeFileSync(f, HALF);
  r = box.storeRead(f, 'thing');
  yes('2 ' + n + ': a half written file is not read as a store that holds nothing', r.doc === null && !!r.bad);
  yes('2 ' + n + ': and the log names the file and says it could not be read',
      said.some(function (s) { return s.indexOf(f) >= 0 && /could not be read: it does not parse/.test(s); }));
  box.storeWrite(f, JSON.stringify({ funds: { whiterun: 1 } }), r);
  const aside = f + '.unreadable-' + clock.t;
  yes('2 ' + n + ': the first save keeps it aside, byte for byte',
      fs.existsSync(aside) && fs.readFileSync(aside, 'utf8') === HALF);
  yes('2 ' + n + ': and says so', said.some(function (s) { return s.indexOf(aside) >= 0; }));
  yes('2 ' + n + ': and writes the new one whole, with no .tmp left',
      JSON.parse(fs.readFileSync(f, 'utf8')).funds.whiterun === 1 && !fs.existsSync(f + '.tmp'));
  clock.t += 1000;
  box.storeWrite(f, JSON.stringify({ funds: { whiterun: 2 } }), r);
  yes('2 ' + n + ': a later save sets nothing more aside',
      !fs.existsSync(f + '.unreadable-' + clock.t) && JSON.parse(fs.readFileSync(f, 'utf8')).funds.whiterun === 2);

  fs.writeFileSync(f, 'not json at all');
  said.length = 0;
  r = box.storeRead(f, 'thing');
  yes('2 ' + n + ': a file that is not JSON is said too, never read as empty',
      r.doc === null && !!r.bad && said.some(function (s) { return s.indexOf(f) >= 0; }));

  fs.writeFileSync(f, '');
  r = box.storeRead(f, 'thing');
  yes('2 ' + n + ': so is a file cut to nothing', r.doc === null && !!r.bad);

  // A save that fails partway (the .tmp cannot be written) leaves the old file whole.
  fs.writeFileSync(f, GOOD);
  fs.mkdirSync(f + '.tmp');
  let threw = false;
  try { box.storeWrite(f, JSON.stringify({ funds: {} }), { doc: null, bad: '' }); } catch (e) { threw = true; }
  yes('2 ' + n + ': a save that fails partway throws and leaves the old file whole', threw && fs.readFileSync(f, 'utf8') === GOOD);
});

// ---------------------------------------------- 3. each of the seven stores
function fnText(text, head) {
  const a = text.indexOf(head);
  if (a < 0) { return ''; }
  const b = text.indexOf('\n  }\n', a);
  return b < 0 ? '' : text.slice(a, b + 4);
}
const P = block.property;
const STORES = [
  ['the property register', P, "var registerRead = storeRead(registerPath(), ", 'function save() {', /storeWrite\(registerPath\(\),[\s\S]*registerRead\)/, /writeFileSync\(registerPath\(\)/],
  ['law.json, the jail cells and held offices', P, "var lawRead = storeRead(lawPath(), ", 'function saveLaw() {', /storeWrite\(lawPath\(\),[\s\S]*lawRead\)/, /writeFileSync\(lawPath\(\)/],
  ['beds.json, the inn guests and kept takings', P, "var bedRead = storeRead(bedBookPath(), ", 'function saveBedBook() {', /storeWrite\(bedBookPath\(\),[\s\S]*bedRead\)/, /writeFileSync\(file, JSON\.stringify\(\{ guests/],
  ['benches.json', P, "var benchRead = storeRead(benchBookPath(), ", 'function saveBenchRefs() {', /storeWrite\(benchBookPath\(\),[\s\S]*benchRead\)/, /writeFileSync\(benchBookPath\(\)/],
  ['season.json', block.season, "var seasonRead = storeRead(seasonPath(), ", 'function saveState() {', /storeWrite\(seasonPath\(\),[\s\S]*seasonRead\)/, /writeFileSync\(seasonPath\(\)/],
  ['the farm claims', block.farming, "var claimsRead = storeRead(claimsPath(), ", 'function saveClaims() {', /storeWrite\(claimsPath\(\),[\s\S]*claimsRead\)/, /writeFileSync\(claimsPath\(\)/],
  ['the furniture register', block.furniture, "var furnitureRead = storeRead(registerPath(), ", 'writeRegister: function (book) {', /storeWrite\(registerPath\(\),[\s\S]*furnitureRead\)/, /writeFileSync\(registerPath\(\)/]
];
STORES.forEach(function (s) {
  const text = s[1];
  const saver = s[3].indexOf('writeRegister') === 0 ? slice(text, s[3], '\n    },') || '' : fnText(text, s[3]);
  yes('3 ' + s[0] + ': read once through storeRead', text.indexOf(s[2]) >= 0);
  yes('3 ' + s[0] + ': saved through storeWrite with what was read', !!saver && s[4].test(saver));
  yes('3 ' + s[0] + ': never written in place', !s[5].test(text));
});
yes('3 the property block reads its register from disk once, not once for each part of it',
    (P.match(/readFileSync\(registerPath\(\)/g) || []).length === 0);
yes('3 the farming block reads its claims from disk once', (block.farming.match(/readFileSync\(claimsPath\(\)/g) || []).length === 0);

// ------------------------------------------- 4. the property block, booted
const HOUSE = '16778:Skyrim.esm';
const holdM = /"16778:Skyrim\.esm":"([a-z]+)"/.exec(P);
const HOLD = holdM ? holdM[1] : 'whiterun';
const dir = temp('boot');
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
const REG = path.join(dir, 'private', 'property.json');
const REG_WHOLE = JSON.stringify({ claims: { [HOUSE]: { by: 101, name: 'Hulda', at: 1790000000000, touched: 1790000000000 } },
                                   funds: { whiterun: 500 }, notices: {}, steps: {} }, null, 1);
const REG_HALF = REG_WHOLE.slice(0, Math.floor(REG_WHOLE.length / 2));
const LAW = path.join(dir, 'private', 'law.json');
const BEDS = path.join(dir, 'private', 'beds.json');
const BENCHES = path.join(dir, 'private', 'benches.json');
fs.writeFileSync(REG, REG_HALF);
fs.writeFileSync(LAW, '{"cells": {"1001:Skyrim.esm": tru');
fs.writeFileSync(BEDS, '{"guests": {}, "takin');
fs.writeFileSync(BENCHES, '');
function inDir(f) { const was = process.cwd(); process.chdir(dir); try { return f(); } finally { process.chdir(was); } }
const clock = { t: Date.UTC(2026, 10, 12, 18, 0, 0) };
class FakeDate extends Date { static now() { return clock.t; } }
function boot() {
  const logged = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return []; } throw new Error('no reference ' + id); },
    set: function () { },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    getNeighborsByPosition: function () { return []; },
    lookupEspmRecordById: function () { return null; }
  };
  const box = {
    console: { log: function () { logged.push([].slice.call(arguments).join(' ')); } },
    require: require, mp: mp, Date: FakeDate,
    BUILDING_BY_DOOR: {}, BUILDING_NAME: { [HOUSE]: 'Honeyside' }, WAY_OUT: {}, BENCH_BY_BASE: {},
    idOf: function () { return 0; }, takeItem: function () { return false; }, addItem: function () { return false; },
    unfitToMake: function () { return ''; }, notify: function () { }, say: function () { },
    guard: function (n, f) { return f; }, setInterval: function () { return 0; }, clearInterval: function () { },
    log: function () { },
    __thornswoodCharacter: { stateOf: function () { return { v: 1 }; }, writeState: function () { } },
    __thornswoodFarming: { groundOf: function () { return null; } },
    __thornswoodOffices: function () { return { jarl: [], court: [], steward: [], guard: [] }; }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(P, box, { filename: 'gamemode.js property' }); });
  return { W: box.__thornswoodProperty, logged: logged };
}
let b1 = null;
try { b1 = boot(); } catch (e) { console.log('      the boot threw: ' + (e && e.stack)); }
yes('4 the property block boots over the half written files', !!b1 && !!b1.W && typeof b1.W.deposit === 'function');
if (b1 && b1.W) {
  const saidOf = function (file) {
    const rel = path.join('private', path.basename(file));
    return b1.logged.some(function (s) { return s.indexOf(rel) >= 0 && /could not be read/.test(s); });
  };
  yes('4 the half written register is said in the log', saidOf(REG));
  yes('4 law.json that is not JSON is said in the log', saidOf(LAW));
  yes('4 the half written beds.json is said in the log', saidOf(BEDS));
  yes('4 benches.json cut to nothing is said in the log', saidOf(BENCHES));
  // A save during the boot (a one-shot step) is allowed: what matters is that
  // each bad file's bytes are still there, where it was or kept aside.
  const kept = function (file, bytes) {
    const priv = path.join(dir, 'private');
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === bytes) { return true; }
    return fs.readdirSync(priv).some(function (f) {
      return f.indexOf(path.basename(file) + '.unreadable-') === 0 && fs.readFileSync(path.join(priv, f), 'utf8') === bytes;
    });
  };
  yes('4 nothing is written over any of them at the boot: each is where it was or kept aside, byte for byte',
      kept(REG, REG_HALF) && kept(LAW, '{"cells": {"1001:Skyrim.esm": tru') &&
      kept(BEDS, '{"guests": {}, "takin') && kept(BENCHES, ''));
  clock.t += 60000;
  const ok = inDir(function () { return b1.W.deposit('whiterun', 25, 'a test fare'); });
  const aside = fs.readdirSync(path.join(dir, 'private')).filter(function (f) { return f.indexOf('property.json.unreadable-') === 0; });
  yes('4 a deposit keeps the half written register aside, byte for byte',
      ok === true && aside.length === 1 && fs.readFileSync(path.join(dir, 'private', aside[0]), 'utf8') === REG_HALF);
  let now = null;
  try { now = JSON.parse(fs.readFileSync(REG, 'utf8')); } catch (e) { now = null; }
  yes('4 and writes a whole register with the deposit in it', !!now && now.funds && now.funds.whiterun === 25);
  const b2 = boot();
  yes('4 a second boot reads that register back, with nothing said about it',
      !!b2.W && !b2.logged.some(function (s) { return s.indexOf(path.join('private', 'property.json')) >= 0 && /could not be read/.test(s); }));
}

done();
