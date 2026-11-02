// test-1390-embassy.js
//
// #1390. The embassy building is held by the Ambassador's office: /claim is
// refused, a steward of Haafingar cannot evict it, and a deed presented at its
// door is paper. The embassy roll is 20, of whom 6 may be marked armed; the
// 21st and the 7th armed are refused. The remnant roll is an application an
// admin writes. /embassy and /remnant are staff commands only, and the person
// a change is about is told in their own chat. Only those two rolls make the
// embassy and remnant rows; a public forge makes none of them. A character in
// Thalmor gear reads Thalmor. The patrols are their own block (tests/test-1390-thalmor-patrols.js), so this block
// stands up no actor.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_DIR = path.join(__dirname, '..');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const block = slice(gm, '// ==== thornswood embassy and remnant ====', '// ==== end thornswood embassy and remnant ====');
yes('the embassy and remnant block is in the gamemode', block !== null);

const recSrc = slice(gm, 'var RECIPES_BY_ID = {', ';\n');
let RECIPES = null;
try { RECIPES = new Function('return ' + recSrc.slice('var RECIPES_BY_ID = '.length).replace(/;$/, ''))(); } catch (e) { RECIPES = null; }
yes('the recipe table reads', !!RECIPES && Object.keys(RECIPES).length > 1500);
// How many rows each roll holds is the cut file's to say (#1622): a
// collection revision that adds Empire or Thalmor gear adds rows to them
// (#4087, Cheddar's Mashups in revision 5).
const CUT_COUNTS = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'cut-items.json'), 'utf8')).counts || {};
const adminSrc = slice(gm, 'var ADMIN_ITEMS = {', ';\n');
let ADMIN_ITEMS = null;
try { ADMIN_ITEMS = new Function('return ' + adminSrc.slice('var ADMIN_ITEMS = '.length).replace(/;$/, ''))(); } catch (e) { ADMIN_ITEMS = null; }
yes('the /give table reads', !!ADMIN_ITEMS && !!ADMIN_ITEMS['thalmor robes']);

// ------------------------------------------------------------- the world --

const ADMIN = 1, STEWARD = 2, NOBODY = 3;
const EMBASSY = 'e48e:The Great City of Solitude.esp';   // the Abandoned Warehouse, suggested on #1390
const HOUSE = '1b262:The Great City of Solitude.esp';

// A stable number for a descriptor, the way mp.getIdFromDesc would give one.
const ids = {};
let nextId = 0x100;
function idOf(desc) {
  if (!desc) { return 0; }
  if (!ids[desc]) { ids[desc] = nextId++; }
  return ids[desc];
}

function memoryFs(files) {
  return {
    readFileSync: function (p) {
      const k = String(p);
      if (!Object.prototype.hasOwnProperty.call(files, k)) { const e = new Error('ENOENT ' + k); e.code = 'ENOENT'; throw e; }
      return files[k];
    },
    writeFileSync: function (p, text) {
      if (files.__refuse) { throw new Error('disk full'); }
      files[String(p)] = String(text);
    },
    mkdirSync: function () { },
    renameSync: function (a, b) { files[String(b)] = files[String(a)]; delete files[String(a)]; }
  };
}

/*
  One load of the block. people: name -> { actor, pid }. Everything the block reads off globalThis is a stub
  that does what the real one does for these questions and no more.
*/
function load(opts) {
  opts = opts || {};
  const files = opts.files || {};
  const people = opts.people || {};
  const said = [];
  const box = {
    console: { log: function () { } },
    JSON: JSON, Math: Math, Date: Date, Number: Number, String: String, Object: Object, Array: Array,
    require: function (name) { return name === 'fs' ? memoryFs(files) : require(name); },
    setTimeout: function () { return 1; }, setInterval: function () { return 2; },
    clearTimeout: function () { }, clearInterval: function () { },
    RECIPES_BY_ID: RECIPES, ADMIN_ITEMS: ADMIN_ITEMS, idOf: idOf,
    wornNow: function (actor) { return (opts.worn && opts.worn[actor]) || []; },
    say: function (actor, line) { said.push([actor, line]); }
  };
  box.globalThis = box;
  box.__thornswoodIsAdmin = function (pid) { return pid === ADMIN; };
  box.__thornswoodSocial = {
    findPerson: function (words) {
      const w = String(words).toLowerCase();
      for (const n in people) { if (n.toLowerCase() === w) { return { actorId: people[n].actor, why: '' }; } }
      return { actorId: 0, why: 'Nobody here by that name.' };
    },
    nameOfPerson: function (actor) {
      for (const n in people) { if (people[n].actor === actor) { return n; } }
      return '';
    },
    profileOf: function (actor) {
      for (const n in people) { if (people[n].actor === actor) { return people[n].pid; } }
      return 0;
    }
  };
  const claims = opts.claims || {};
  box.__thornswoodProperty = {
    here: function (actor) { return (opts.door && opts.door[actor]) || null; },
    nameOf: function (b) { return b === EMBASSY ? 'Abandoned Warehouse' : b; },
    holderOf: function (b) { return claims[b] || null; },
    pushAll: function () { }
  };
  vm.runInNewContext(block, box);
  return { box: box, files: files, said: said,
           E: box.__thornswoodEmbassy, R: box.__thornswoodRolls, T: box.__thornswoodThalmor };
}

function run(env, pid, actor, text) {
  const told = [];
  const parts = text.split(/\s+/);
  env.E.command(parts[0], parts, actor, pid, function (p, line) { told.push(line); });
  return told.join(' | ');
}

function crowd(n) {
  const people = {};
  for (let i = 1; i <= n; i++) { people['Person' + i] = { actor: 0xff001000 + i, pid: 1000 + i }; }
  return people;
}

if (block && RECIPES && ADMIN_ITEMS) {
  // ------------------------------------------------- the 20 and the 6 --
  {
    const env = load({ people: crowd(22) });
    for (let i = 1; i <= 20; i++) { run(env, ADMIN, 0x14, '/embassy add Person' + i); }
    yes('R1 an admin puts 20 on the embassy roll', env.E.rolls().embassy.length === 20);
    const twentyFirst = run(env, ADMIN, 0x14, '/embassy add Person21');
    yes('R1 the 21st person is refused', env.E.rolls().embassy.length === 20 && /full/.test(twentyFirst) && /20/.test(twentyFirst));
    yes('R1 and is not on the roll', !env.R.has(0xff001000 + 21, 'embassy'));
    run(env, ADMIN, 0x14, '/embassy remove Person20');
    yes('R1 taking one off makes room', env.E.rolls().embassy.length === 19);
    run(env, ADMIN, 0x14, '/embassy add Person21');
    yes('R1 and the next one is named', env.R.has(0xff001000 + 21, 'embassy') && env.E.rolls().embassy.length === 20);
  }
  {
    const env = load({ people: crowd(9) });
    for (let i = 1; i <= 6; i++) { run(env, ADMIN, 0x14, '/embassy add Person' + i + ' armed'); }
    const armed = function () { return env.E.rolls().embassy.filter(function (r) { return r.armed; }).length; };
    yes('R2 six are marked armed', armed() === 6);
    const seventh = run(env, ADMIN, 0x14, '/embassy add Person7 armed');
    yes('R2 adding a 7th armed is refused, and nobody is added', armed() === 6 && !env.R.has(0xff001007, 'embassy') && /Nobody was added/.test(seventh));
    run(env, ADMIN, 0x14, '/embassy add Person7');
    yes('R2 the same person unarmed is on the roll', env.R.has(0xff001007, 'embassy') && armed() === 6);
    const arm7 = run(env, ADMIN, 0x14, '/embassy arm Person7');
    yes('R2 marking a 7th as armed is refused', armed() === 6 && /all the Accord allows/.test(arm7));
    run(env, ADMIN, 0x14, '/embassy disarm Person1');
    run(env, ADMIN, 0x14, '/embassy arm Person7');
    yes('R2 disarming one lets another be marked', armed() === 6 &&
        env.E.rolls().embassy.filter(function (r) { return r.name === 'Person7'; })[0].armed === true &&
        env.E.rolls().embassy.filter(function (r) { return r.name === 'Person1'; })[0].armed === false);
    const again = run(env, ADMIN, 0x14, '/embassy add Person2');
    yes('R2 nobody is on the roll twice', /already on/.test(again) && env.E.rolls().embassy.length === 7);
    yes('R2 the person named is told, in their own chat', env.said.some(function (s) { return s[0] === 0xff001001 && /embassy roll, marked armed/.test(s[1]); }));
    yes('R2 and told when they are disarmed', env.said.some(function (s) { return s[0] === 0xff001001 && /no longer marked armed/.test(s[1]); }));
    yes('R2 and when they are marked armed', env.said.some(function (s) { return s[0] === 0xff001007 && /You are marked armed on the embassy roll/.test(s[1]); }));
    yes('R2 a refusal tells the person nothing', !env.said.some(function (s) { return s[0] === 0xff001002 && /already/.test(s[1]); }) &&
        env.said.filter(function (s) { return s[0] === 0xff001007; }).length === 2);
  }
  {
    const env = load({ people: crowd(3) });
    const refused = run(env, NOBODY, 0x15, '/embassy add Person1');
    yes('R3 somebody who is not an admin cannot write the embassy roll', env.E.rolls().embassy.length === 0 && /Only an admin/.test(refused));
    const remRefused = run(env, STEWARD, 0x16, '/remnant add Person1');
    yes('R3 nor the remnant roll, which is an application', env.E.rolls().remnant.length === 0 && /application/.test(remRefused));
    run(env, ADMIN, 0x14, '/embassy add Person1 armed');
    // docs/GAME-SYSTEMS.md, "Buttons, not commands": nothing here is for people to type.
    const own = run(env, NOBODY, 0xff001001, '/embassy');
    yes('R3 /embassy is a staff command: somebody on the roll who types it is told only that an admin writes it',
        own === 'Only an admin writes the embassy roll.');
    const ownRemnant = run(env, NOBODY, 0xff001001, '/remnant');
    yes('R3 and so is /remnant', ownRemnant === 'The remnant roll is an application. Only an admin writes it.');
    const list = run(env, ADMIN, 0x14, '/embassy');
    yes('R3 an admin sees the roll, the count and the building', /1 of 20 on the roll, 1 of 6 marked armed/.test(list) &&
        /Person1 \(armed\)/.test(list) && /The embassy is Abandoned Warehouse/.test(list));
  }
  {
    // Off the roll while not in the world.
    const people = crowd(2);
    const env = load({ people: people });
    run(env, ADMIN, 0x14, '/embassy add Person2');
    delete people.Person2;
    const off = run(env, ADMIN, 0x14, '/embassy remove person2');
    yes('R4 somebody who is not in the world can still be taken off by the name on the roll', !env.R.has(0xff001002, 'embassy') && /is off the embassy roll/.test(off));
    yes('R4 and the line to them goes out the same way', env.said.some(function (s) { return s[0] === 0xff001002 && /You are off the embassy roll/.test(s[1]); }));
  }
  {
    // Kept across a restart, and a hand edit is not a way round the Accord.
    const env = load({ people: crowd(4) });
    run(env, ADMIN, 0x14, '/embassy add Person1 armed');
    run(env, ADMIN, 0x14, '/remnant add Person2');
    const again = load({ files: env.files });
    yes('R5 the rolls survive a restart', again.R.has(0xff001001, 'embassy') && again.R.has(0xff001002, 'remnant') &&
        again.E.rolls().embassy[0].armed === true);
    const file = Object.keys(env.files).filter(function (k) { return /embassy\.json$/.test(k); })[0];
    yes('R5 the roll file is in the private folder', /^private[\\/]embassy\.json$/.test(file || ''));
    const big = { embassy: [], remnant: [{ actor: 'x' }] };
    for (let i = 1; i <= 25; i++) { big.embassy.push({ actor: 0xff002000 + i, name: 'P' + i, armed: i <= 9 }); }
    big.embassy.push({ actor: 0xff002001, name: 'P1 twice', armed: false });
    const files = {}; files[file] = JSON.stringify(big);
    const edited = load({ files: files });
    const rolls = edited.E.rolls();
    yes('R5 a file with 25 on the roll loads 20', rolls.embassy.length === 20);
    yes('R5 and with 9 marked armed loads 6', rolls.embassy.filter(function (r) { return r.armed; }).length === 6);
    yes('R5 and a row that is not a person is dropped', rolls.remnant.length === 0);
    const bomFiles = {}; bomFiles[file] = String.fromCharCode(0xFEFF) + env.files[file];
    yes('R5 a roll file saved with a byte order mark still reads', load({ files: bomFiles }).R.has(0xff001001, 'embassy'));
  }
  {
    // A write that fails changes nothing.
    const files = {};
    const env = load({ people: crowd(1), files: files });
    files.__refuse = true;
    const line = run(env, ADMIN, 0x14, '/embassy add Person1');
    yes('R6 a roll that cannot be written refuses and keeps nobody', !env.R.has(0xff001001, 'embassy') && /could not be written/.test(line));
    yes('R6 and tells the person nothing', env.said.length === 0);
    delete files.__refuse;
    run(env, ADMIN, 0x14, '/embassy add Person1 armed');
    files.__refuse = true;
    const disarm = run(env, ADMIN, 0x14, '/embassy disarm Person1');
    const gone = run(env, ADMIN, 0x14, '/embassy remove Person1');
    yes('R6 a disarm or a removal that cannot be written changes nothing either',
        env.R.has(0xff001001, 'embassy') && env.E.rolls().embassy[0].armed === true &&
        /could not be written/.test(disarm) && /could not be written/.test(gone));
  }
  {
    // A roll file that is there and cannot be read is not written over.
    const files = {};
    files[require('path').join('private', 'embassy.json')] = '{"embassy": [{"actor": 4278194177, "na';
    const env = load({ people: crowd(1), files: files });
    yes('R8 an unreadable roll file loads as empty rolls', env.E.rolls().embassy.length === 0 && env.E.rolls().remnant.length === 0);
    const before = files[require('path').join('private', 'embassy.json')];
    const line = run(env, ADMIN, 0x14, '/embassy add Person1');
    yes('R8 and nothing is written over it', files[require('path').join('private', 'embassy.json')] === before &&
        !env.R.has(0xff001001, 'embassy') && /could not be read/.test(line));
    yes('R8 an admin sees why in the roll', /could not be read/.test(run(env, ADMIN, 0x14, '/embassy')));
    const fresh = load({ people: crowd(1) });
    run(fresh, ADMIN, 0x14, '/embassy add Person1');
    yes('R8 no roll file yet is two empty rolls that can be written', fresh.R.has(0xff001001, 'embassy'));
  }
  {
    const env = load({ people: crowd(2) });
    run(env, ADMIN, 0x14, '/remnant add Person1');
    yes('R7 the remnant roll holds an applicant an admin wrote', env.R.has(0xff001001, 'remnant') && !env.R.has(0xff001001, 'embassy'));
    const noArm = run(env, ADMIN, 0x14, '/remnant arm Person1');
    yes('R7 the remnant roll has no armed mark', /\/remnant add or remove/.test(noArm));
    run(env, ADMIN, 0x14, '/remnant remove Person1');
    yes('R7 and an admin takes them off', !env.R.has(0xff001001, 'remnant'));
    yes('R7 a roll that is neither is never true', !env.R.has(0xff001001, 'legion') && !env.R.has(0xff001001, 'constructor'));
  }

  // ------------------------------------------------------- the building --
  {
    const env = load({});
    const doors = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'doors.json'), 'utf8'));
    const nameM = /^const BUILDING_NAME = (\{.*\});$/m.exec(gm);
    const NAMES = nameM ? JSON.parse(nameM[1]) : {};
    yes('B1 the embassy is a building of the door table', env.E.EMBASSY_BUILDING === EMBASSY &&
        Array.isArray(doors.buildings[EMBASSY]) && doors.buildings[EMBASSY].length > 0);
    yes('B1 and it is the Abandoned Warehouse in Solitude, the answer suggested on #1390',
        NAMES[EMBASSY] === 'Abandoned Warehouse' && /^Solitude/.test(doors.cells[EMBASSY].edid));
    yes('B1 its doors start held, with no command', env.E.holds(EMBASSY) && !env.E.holds(HOUSE) && !env.E.holds(''));
    yes('B1 there is no command that moves it', !/'here'/.test(block) && !/designate/.test(block));
  }

  // The property block's own words, driven with the embassy in place.
  {
    const env = load({});
    const E = env.E;
    const claimSrc = slice(gm, '  function claim(actorId, profileId, toProfile) {\n    var building = here(actorId);', '\n  }\n');
    const evictSrc = slice(gm, '  function evict(actorId, profileId, toProfile, cmd) {', '\n  }\n');
    // A door press is touched(): openedDoor() (the deed and the renewal), then doorLine() (#1637).
    const touchedSrc = slice(gm, '  function openedDoor(actorId, doorDesc) {', '\n  }\n');
    const lineSrc = slice(gm, '  function doorLine(actorId, profileId) {', '\n  }\n');
    yes('B2 claim, evict, the door press and the line at the door are in the property block',
        !!claimSrc && !!evictSrc && !!touchedSrc && !!lineSrc);
    function claimAt(building) {
      const told = [];
      const claims = {};
      const fn = new Function('globalThis', 'here', 'holderOf', 'nameOf', 'mp', 'groundHere', 'claims', 'save', 'pushAll',
        'giveDeed', 'plog', 'lapseDays', 'mayHold', 'jailOfBuilding', 'HOLD_TOWN', 'issueMaster', 'masterHandedLine', claimSrc + '\nreturn claim;');
      const claim = fn({ __thornswoodEmbassy: E }, function () { return building; }, function () { return null; },
        function (b) { return b; }, { get: function () { return { name: 'Bjorn' }; } }, function () { return null; },
        claims, function () { }, function () { }, function () { return true; }, function () { }, function () { return 14; },
        function () { return true; }, function () { return null; }, {},
        // The master key handed with the deed (#2254) is test-2254-master-key.js's; 0 here, none cut.
        function () { return 0; }, function () { return ''; });
      claim(0x14, 50, function (p, line) { told.push(line); });
      return { told: told.join(' '), claims: claims };
    }
    const atEmbassy = claimAt(EMBASSY);
    yes('B2 /claim at the embassy answers that it is held', !atEmbassy.claims[EMBASSY] && atEmbassy.told === E.CLAIM_REFUSED &&
        /held by the Ambassador's office/.test(atEmbassy.told));
    const atHouse = claimAt(HOUSE);
    yes('B2 and any other door is claimed as before', !!atHouse.claims[HOUSE]);

    function evictAt(building, held) {
      const told = [];
      const claims = {};
      if (held) { claims[building] = held; }
      // The Office page on K (#1638) redraws after an eviction; nothing here draws.
      // The steward here keeps the building's hold: a steward settles their own
      // hold only (#2551), which test-offices.js and test-2551-building-holds.js hold.
      const fn = new Function('globalThis', 'isSteward', 'here', 'holderOf', 'nameOf', 'claims', 'save', 'pushAll', 'plog',
        'redrawPanel', 'OFFICE_AT_DOOR', 'notStewardHere', 'isStaffHere', 'settleAs',
        // What an evicted holder owed stays theirs (#3950): tests/test-3893-rent-arrears.js; no rent here.
        'keepOwed', evictSrc + '\nreturn evict;');
      // Staff at any door (settleAs, #2551) is test-2551-building-holds.js's: here the steward settles as steward.
      const evict = fn({ __thornswoodEmbassy: E }, function () { return true; }, function () { return building; },
        function () { return claims[building] || null; }, function (b) { return b; }, claims,
        function () { }, function () { }, function () { }, function () { }, 'Stand at the door.', function () { return null; },
        function () { return false; }, function () { return { as: 'steward' }; }, function () { });
      evict(0x14, STEWARD, function (p, line) { told.push(line); });
      return { told: told.join(' '), claims: claims };
    }
    const ev = evictAt(EMBASSY, null);
    yes('B3 a steward of Haafingar cannot evict the embassy', ev.told === E.EVICT_REFUSED &&
        /does not evict the Accord/.test(ev.told));
    const leftover = evictAt(EMBASSY, { by: 9, name: 'Somebody' });
    yes('B3 a claim somebody made there before the embassy held it is still theirs, and a steward still ends it',
        !leftover.claims[EMBASSY] && /You end Somebody's claim/.test(leftover.told) && E.holds(EMBASSY));
    const evHouse = evictAt(HOUSE, { by: 9, name: 'Somebody' });
    yes('B3 and still ends a claim anywhere else', !evHouse.claims[HOUSE]);

    function deedAt(building) {
      const claims = {};
      const said = [];
      const fn = new Function('globalThis', 'buildingOf', 'g', 'mp', 'DOOR_PROPERTY', 'plog', 'push', 'holderOf', 'holdsDeed',
        'groundHere', 'claims', 'save', 'pushAll', 'nameOf', 'notify', 'say', 'refrIdOfDoor',
        // Anybody may hold this building; a jail is #502's, in test-502-jail-rules.js.
        'mayHold', 'issueMaster', 'masterHandedLine', touchedSrc + '\nreturn openedDoor;');
      const touched = fn({ __thornswoodEmbassy: E }, function () { return building; }, {},
        { get: function (id, p) { return p === 'profileId' ? 50 : { name: 'Thief' }; }, set: function () { } },
        'thornswoodDoor', function () { }, function () { }, function () { return null; }, function () { return true; },
        function () { return null; }, claims, function () { }, function () { }, function (b) { return b; },
        function (a, l) { said.push(l); }, function (a, l) { said.push(l); }, function () { return 0; },
        function () { return true; },
        // No master key cut here (#2254); test-2254-master-key.js has them.
        function () { return 0; }, function () { return ''; });
      touched(0x14, 'door');
      return claims;
    }
    yes('B4 a deed presented at the embassy door takes nothing', !deedAt(EMBASSY)[EMBASSY]);
    yes('B4 and a deed at any other door is still the title', !!deedAt(HOUSE)[HOUSE]);

    // The line the lock key reads at the door just opened (#1637).
    function lineAt(building, held) {
      let line = null;
      const fn = new Function('globalThis', 'mp', 'DOOR_PROPERTY', 'DOOR_MEMORY_MS', 'buildingOf', 'holderOf', 'holdsDeed',
        'nameOf', 'doorsOf', 'idOf', 'DOOR_LINE_PROPERTY', 'plog', 'doorLineStamp',
        // No cell door at the embassy (#502).
        'jailHoldOf', 'isGuard', 'cellLocked', 'mayHold', lineSrc + '\nreturn doorLine;');
      const doorLine = fn({ __thornswoodEmbassy: E },
        { get: function () { return { door: 'door', at: Date.now() }; }, set: function (a, p, v) { line = v; } },
        'thornswoodDoor', 60000, function () { return building; }, function () { return held || null; },
        function () { return false; }, function (b) { return b; }, function () { return ['5cb0:The Great City of Solitude.esp']; },
        function () { return 0x5cb0; }, 'thornswoodDoorLine', function () { }, 0,
        function () { return null; }, function () { return false; }, function () { return false; },
        function () { return true; });
      doorLine(0x14, 50);
      return line;
    }
    yes('B5 the embassy door offers nothing to claim', lineAt(EMBASSY, null).x === '');
    yes('B5 and any other door nobody holds offers the claim as before', lineAt(HOUSE, null).x === 'claim');
    yes('B5 a claim somebody made there before is still theirs to lock', lineAt(EMBASSY, { by: 50, locked: false }).x === 'lock');
  }

  // ------------------------------------------- the bench, by the roll --
  {
    const P = (function () {
      const pb = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
      const box = { console: { log: function () { } } };
      box.globalThis = box;
      vm.runInNewContext(pb, box);
      return box.__thornswoodProgression;
    })();
    const cut = function (head) { return slice(gm, head, '\n}\n'); };
    const noProfM = /^const NO_PROFESSION_AT_A_BENCH = '([^']*)';$/m.exec(gm);
    const helpers = ['function rankWord(', 'function aWord(', 'function professionName(', 'function onCraftRoll('].map(cut);
    const craftSrc = cut('function craftAnswer(');
    yes('C0 the craft gate and its roll question are in the gamemode', !!craftSrc && helpers.every(function (h) { return !!h; }));
    function nameOf(key) {
      const T = P.TABLE;
      if (P.has(T.classes, key)) { return T.classes[key].name; }
      for (const p in T.professions) { if (P.has(T.professions[p].halves, key)) { return T.professions[p].halves[key]; } }
      if (P.has(T.professions, key)) { return T.professions[key].name; }
      return key;
    }
    const env = load({ people: { Envoy: { actor: 0xff003001, pid: 31 }, Exile: { actor: 0xff003002, pid: 32 } } });
    run(env, ADMIN, 0x14, '/embassy add Envoy');
    run(env, ADMIN, 0x14, '/remnant add Exile');
    function answer(state, actor, row) {
      const g = { __thornswoodProgression: P, __thornswoodRolls: env.R,
                  __thornswoodCharacter: { stateOf: function () { return state; }, nameOf: nameOf } };
      const fn = new Function('globalThis', 'log', 'raceGate', 'NO_PROFESSION_AT_A_BENCH',
        helpers.join('\n') + '\n' + craftSrc + '\nreturn craftAnswer;');
      return fn(g, function () { }, function () { return null; }, noProfM[1])(actor, row);
    }
    function master(prof, half) {
      const r = P.pickProfession(P.fresh(), prof, half);
      for (const h of ['platewright', 'edgewright', 'liverywright', 'haberdasher', 'woodwright']) { r.state.ranks[h] = 'master'; }
      r.state.ranks[half] = 'master';
      return r.state;
    }
    const embassyRows = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].roll === 'embassy'; });
    const remnantRows = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].roll === 'remnant'; });
    yes('C1 the cut file counts are the table: ' + CUT_COUNTS.embassy + ' embassy rows and ' + CUT_COUNTS.thalmor + ' remnant rows',
        embassyRows.length > 0 && remnantRows.length > 0 && embassyRows.length === CUT_COUNTS.embassy && remnantRows.length === CUT_COUNTS.thalmor);
    function who(row) {
      const half = String(RECIPES[row].half).toLowerCase();
      const prof = { platewright: 'smith', edgewright: 'smith', liverywright: 'tailor', haberdasher: 'tailor', woodwright: 'woodworker' }[half];
      return master(prof, half);
    }
    const publicBench = embassyRows.concat(remnantRows).filter(function (k) {
      const a = answer(who(k), 0xff009999, RECIPES[k]);
      return !(a.refusal && /not made at a public bench/.test(a.refusal));
    });
    yes('C2 a master of the right half who is on no roll makes none of the ' + (embassyRows.length + remnantRows.length) + ' at a public forge', publicBench.length === 0);
    const envoyMakes = embassyRows.filter(function (k) { return !answer(who(k), 0xff003001, RECIPES[k]).refusal; });
    yes('C3 a master on the embassy roll makes every embassy row', envoyMakes.length === embassyRows.length);
    const envoyThalmor = remnantRows.filter(function (k) { return !answer(who(k), 0xff003001, RECIPES[k]).refusal; });
    yes('C3 and none of the remnant rows', envoyThalmor.length === 0);
    const exileMakes = remnantRows.filter(function (k) { return !answer(who(k), 0xff003002, RECIPES[k]).refusal; });
    yes('C4 a master on the remnant roll makes every remnant row', exileMakes.length === remnantRows.length);
    const exileImperial = embassyRows.filter(function (k) { return !answer(who(k), 0xff003002, RECIPES[k]).refusal; });
    yes('C4 and none of the embassy rows', exileImperial.length === 0);
    const robe = remnantRows.filter(function (k) { return RECIPES[k].name === 'Thalmor Robes'; })[0];
    yes('C5 the robes are not race locked: races.md says Thalmor robes are a faction, not a people', robe && RECIPES[robe].race === '');
  }

  // --------------------------------------------------------- the marker --
  {
    const env = load({ worn: { 0xa1: [idOf('65bbf:Skyrim.esm')], 0xa2: [idOf('81f:MoreCraftableEquipment.esp')],
                               0xa3: [idOf('12e4d:Skyrim.esm')], 0xa4: [idOf('1859:Immersive Weapons.esp')] } });
    const gear = env.T.gear();
    const outs = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].roll === 'remnant'; }).map(function (k) { return idOf(RECIPES[k].out); });
    yes('M1 every piece the remnant rows make reads Thalmor', outs.every(function (id) { return !!gear[id]; }));
    yes('M1 and so do the game\'s own Thalmor Robes and Hooded Thalmor Robes', !!gear[idOf('65bbf:Skyrim.esm')] && !!gear[idOf('10c698:Skyrim.esm')]);
    yes('M1 and those two are the records the /give table names for them',
        ADMIN_ITEMS['thalmor robes'][1] === '65bbf:Skyrim.esm' && ADMIN_ITEMS['hooded thalmor robes'][1] === '10c698:Skyrim.esm');
    yes('M1 and no Imperial piece does', !gear[idOf('13ed9:Skyrim.esm')] && !gear[idOf('d3ea0:Skyrim.esm')]);
    yes('M2 a character in Thalmor Robes carries the marker', env.T.marked(0xa1) === true);
    yes('M2 and in the robes the remnant makes', env.T.marked(0xa2) === true);
    yes('M2 and carrying a Justiciar Saber', env.T.marked(0xa4) === true);
    yes('M2 and in iron armour does not', env.T.marked(0xa3) === false);
    yes('M2 and nothing worn is no marker', env.T.marked(0xa9) === false);
    yes('M3 nothing is typed to read the marker: /remnant is a staff command', !/reads Thalmor/.test(run(env, NOBODY, 0xa1, '/remnant')) &&
        !/What you have on reads Thalmor/.test(block));
  }

  // ------------------------------------------- what the block does not do --
  {
    yes('P1 the block stands up no actor: the patrols are their own block',
        !/placeActors\(|mp\.place\(|createActor|__thornswoodNpcRuntime|__thornswoodNpcPopulation/.test(block));
    yes('P1 and runs no timer of its own', !/setInterval|setTimeout/.test(block));
    yes('P1 placeActors is the /spawn commands\' own, as it was', /\n  return \{ made: made, why: why \};\n\}/.test(gm));
    yes('P2 nothing here makes a box, a board, a ledger or gold for the embassy',
        !/__thornswoodProperty\.(deposit|putIn|takeGold)|addItemsAtomic|LEDGER_HOLDS|boxes\(|boards\(/.test(block));
  }

  // ------------------------------------------------------- the open world --
  {
    const spoils = slice(gm, '// ==== thornswood spoils ====', '// ==== end thornswood spoils ====');
    const loot = slice(gm, '// ==== thornswood dungeon loot ====', '// ==== end thornswood dungeon loot ====');
    // Nothing the world placed is handed over (#3077, #3078): the floor's
    // weapons, armour and arrows are switched off in Thornswood-Last.esp.
    const builder = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'mods', 'Build-LastPlugin.py'), 'utf8');
    const types = (/FLOOR_TYPES = \(([^)]*)\)/.exec(builder) || ['', ''])[1];
    yes('S1 no weapon, armour or arrow the world placed lies on the floor',
        !!spoils && ['WEAP', 'ARMO', 'AMMO'].every(function (t) { return types.indexOf("b'" + t + "'") >= 0; }));
    const outs = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].roll; }).map(function (k) { return RECIPES[k].out; })
      .concat(['65bbf:Skyrim.esm', '10c698:Skyrim.esm']);
    yes('S2 no dungeon chest or body hands out an embassy or remnant piece',
        !!loot && outs.length === CUT_COUNTS.embassy + CUT_COUNTS.thalmor + 2 && outs.every(function (d) { return loot.indexOf("'" + d + "'") === -1; }));
  }

  // ---------------------------------------------------------- the words --
  {
    const W = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
    const PW = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
    const words = W ? new Function('return ' + W[1])() : [];
    const playerWords = PW ? new Function('return ' + PW[1])() : [];
    yes('W1 the server answers /embassy and /remnant', words.indexOf('/embassy') !== -1 && words.indexOf('/remnant') !== -1);
    yes('W1 and /help does not offer them to everybody', playerWords.indexOf('/embassy') === -1 && playerWords.indexOf('/remnant') === -1);
    yes('W1 the chat dispatcher hands both to the block', /if \(word === '\/embassy' \|\| word === '\/remnant'\) \{[\s\S]{0,300}__thornswoodEmbassy/.test(gm));
    const cmds = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'commands.md'), 'utf8');
    const staff = cmds.slice(cmds.indexOf('## Staff and dev commands'), cmds.indexOf('## Lines the game sends itself'));
    const people = cmds.slice(cmds.indexOf('## Commands for people'), cmds.indexOf('## Staff and dev commands'));
    yes('W1 the command list has both among the staff commands, and not among the commands for people',
        /`\/embassy/.test(staff) && /`\/remnant/.test(staff) && !/`\/embassy/.test(people) && !/`\/remnant/.test(people));
    // #1640: a word handle() never reaches is a word nobody can use. The
    // character block's command hands a fixed list on and answers false for
    // the rest, so handle() goes on to the embassy branch.
    const charBlock = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
    const charCommand = charBlock ? slice(charBlock, '  function command(word, parts, actorId, profileId, toProfile, cmd) {', '\n  }\n') : null;
    let passedOn = false;
    if (charCommand) {
      const cbox = { clog: function () { }, g: { __thornswoodProperty: { command: function () { return true; } } } };
      vm.runInNewContext(charCommand + '\nthis.cmd = command;', cbox);
      passedOn = ['/embassy', '/remnant'].every(function (w) { return cbox.cmd(w, [w], 0xff000101, 7, function () { }) === false; });
    }
    yes('W3 the character block does not take /embassy or /remnant, so handle() goes on to them', passedOn);
    const handleAt = gm.indexOf('  function handle(cmd) {');
    const branchAt = gm.indexOf("if (word === '/embassy' || word === '/remnant') {");
    const unknownAt = gm.indexOf("'No command called ' + word");
    yes('W3 and the embassy branch is in handle(), before the unknown command reply',
        handleAt > 0 && branchAt > handleAt && unknownAt > branchAt);
    const EM = String.fromCharCode(0x2014);
    const lines = (block.match(/'[^'\n]*'/g) || []).join(' ');
    yes('W2 nothing the block says has an em dash', lines.indexOf(EM) === -1 && block.indexOf(EM) === -1);
    yes('W2 nor the word the writing rules ban', !/\bplayers?\b/i.test(block));
  }
}


// ------------------------------------------- the Accord says the same --
// #1697: the site's Article the Third and lore/accord.md said forty and twelve
// while the server held 20 and 6. The numbers in the words people read are
// read here against the ones the block enforces, so they cannot part again.
{
  const rollM = /var ROLL_MOST = (\d+);/.exec(block || '');
  const armedM = /var ARMED_MOST = (\d+);/.exec(block || '');
  yes('A1 the block holds ROLL_MOST and ARMED_MOST', !!rollM && !!armedM);
  if (rollM && armedM) {
    const roll = +rollM[1], armed = +armedM[1];
    const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
      'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
    const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
    const word = n => n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '');
    const read = rel => fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(String.fromCharCode(13)).join('');
    const article = text => slice(text, 'Article the Third', 'Article the Fourth') || '';
    const said = 'no more than ' + word(roll) + ' persons in service, of whom no more than ' +
                 word(armed) + ' may bear arms';
    // world.md is the Accord's only copy since #3138; lore/accord.md points at it.
    for (const rel of ['site/data/site/world.md']) {
      const text = read(rel);
      yes('A2 ' + rel + ' Article the Third says ' + word(roll) + ' in service and ' + word(armed) + ' armed',
          article(text).replace(/\s+/g, ' ').indexOf(said) >= 0);
      const flat = text.replace(/\s+/g, ' ');
      const other = [/allows (\w+) under arms/g, /The (\w+) inside them/g, /those (\w+) within its walls/g]
        .map(re => Array.from(flat.matchAll(re), m => m[1].toLowerCase()))
        .reduce((a, b) => a.concat(b), []).filter(w => w !== word(armed));
      yes('A3 ' + rel + ' names no other armed number', other.length === 0);
    }
    const page = read('docs/systems/embassy.md').replace(/\s+/g, ' ');
    yes('A4 docs/systems/embassy.md says ' + roll + ' in service and ' + armed + ' armed',
        page.indexOf(roll + ' persons in service, no more. Of those, ' + armed + ' may be marked armed') >= 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
