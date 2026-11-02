'use strict';
/*
  test-3167-staff-crafting.js

  #3167, staff crafting tools (Patrick, 22 Oct: in game, on the K panel's
  Office page, not commands). What it holds to:
    - The card is staff's: /craftstaff is a staff word, so somebody who is not
      staff is told "That one is not yours to run." and staff need the proven
      chat, and the Office page carries the card for staff and nobody else.
    - Ranks: the card lists every class, half and school the person picked
      has standing in, with the work toward the next rank. Raise is one step
      through the rulebook's own rankUp, so its ceilings hold (a sister half
      past novice needs its Master), it hands the skill point a rank always
      hands, the count starts again at 0, the person is told the way work
      tells them, and it is in the staff log.
    - A recipe: the card says what the craft gate says for that person,
      whether their game was handed the row as hidden, when that list is
      older than the gate's answer, and when the game's own recipe asks for
      something first. Hand their game the list asks the one writer of the
      list, which writes only when the answer changed, and that write is in
      the staff log as a finding.
    - Give back: an item by name, a count and a reason, all three asked for,
      into the person's pack, with the reason in the staff log.
    - Nobody raises their own rank or gives themselves anything.
    - A hot reload keeps who each staff member picked.
    - The K panel draws the card and every button sends the line the server
      reads, Raise and Give back asking twice.

  The real chat command block, staff block, rulebook (the progression block)
  and staff crafting block run over a pretend world, as in
  test-staff-commands.js; the character block's state is a stand-in over that
  world, and its names and raise lines are the real block's, run whole
  beside the recipe table, so a raise says what the new rank opened (#3149). The real recipe list writer
  (handRecipesHidden) runs over a stand-in craft gate. The real K panel runs
  in a stand-in document, as in test-1638-office.js. Read only.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const src = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(ROOT, 'game', 'gamemode.js')));
const ui = read(path.join(ROOT, 'game', 'ui', 'thornswood-skills.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a);
  return (a < 0 || b < 0) ? null : src.slice(a, b + to.length);
}
function between(from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a);
  return (a < 0 || b < 0) ? null : src.slice(a, b);
}

const COMMANDS = slice('const WORDS = [', '// ==== end thornswood chat commands ====');
const STAFF = slice('// ==== thornswood staff ====', '// ==== end thornswood staff ====');
const CRAFT = slice('// ==== thornswood staff crafting ====', '// ==== end thornswood staff crafting ====');
const RULES = slice('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const PLACE_ACTORS = slice('\nfunction serverRunId(', '\n  return { made: made, why: why };\n}');
const HIDDEN = between('\nfunction recipesRefused(actorId) {', '\n/*\n  A NEVER-COPIED');
// The character block whole, for its own nameOf and raiseLines: since #4028
// a raise line also says what the new rank opened, from the recipe book's
// count, so lifting raiseLine and its neighbours alone left raiseLines
// calling a recipeIndex that was not there.
const CHARACTER = slice('// ==== thornswood character ====', '// ==== end thornswood character ====');
const tableAt = src.indexOf('  var RECIPES_BY_ID = {');
const tableEnd = tableAt < 0 ? -1 : src.indexOf('\n  };\n', tableAt);
let TABLE = null;
try { TABLE = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID'); } catch (e) { TABLE = null; }
const OFFICE_VIEW = between('  function officeView(actorId, profileId) {', '\n  /*\n    THE JAIL RULE');
[['the chat command block', COMMANDS], ['the staff block', STAFF], ['the staff crafting block', CRAFT],
 ['the progression block', RULES], ['placeActors', PLACE_ACTORS], ['the recipe list writer', HIDDEN],
 ['the character block', CHARACTER], ['the recipe table', TABLE], ['the Office page\'s view', OFFICE_VIEW]]
  .forEach(function (x) { yes(x[0] + ' is in gamemode.js', !!x[1]); });
if (!COMMANDS || !STAFF || !CRAFT || !RULES || !PLACE_ACTORS || !HIDDEN || !CHARACTER || !TABLE || !OFFICE_VIEW) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

/* ------------------------------------------------------------- the wiring */
const arrayOf = function (name) {
  const m = new RegExp('const ' + name + ' = \\[([\\s\\S]*?)\\];').exec(COMMANDS);
  return m ? (m[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').match(/'[^']+'/g) || []).map(function (q) { return q.slice(1, -1); }) : null;
};
const WORDS = arrayOf('WORDS'), PLAYER = arrayOf('PLAYER_WORDS');
yes('W1 /craftstaff is a word the server answers, and no help names it',
    !!WORDS && WORDS.indexOf('/craftstaff') !== -1 && !!PLAYER && PLAYER.indexOf('/craftstaff') === -1);
yes('W2 it is in the staff block\'s WORDS_STAFF, so the staff gate is asked first',
    /var WORDS_STAFF = \[[^\]]*'\/craftstaff'[^\]]*\]/.test(STAFF));
const cmdAt = STAFF.indexOf("if (word === '/craftstaff') {");
yes('W3 and the staff block hands it on only after the staff and proof checks',
    cmdAt > STAFF.indexOf('tell(pid, REFUSED);') && cmdAt > STAFF.indexOf('var why = unproven(cmd, pid);'));
yes('W4 the Office page carries the card for staff only, from the staff crafting block',
    /view\.craft = \(staff && craftApi && craftApi\.staffView\) \? craftApi\.staffView\(pid\) : null;/.test(OFFICE_VIEW));

/* -------------------------------------------------------- a pretend world */
const KNOWN = { '71cf3:Skyrim.esm': 0x71cf3, 'f:Skyrim.esm': 0xf };
const STAFFER = 1001, BJORN = 2002, SERA = 4004, OTHER = 5005, NOBODY = 3003;
const A_STAFF = 0xff000001, A_BJORN = 0xff000002, A_SERA = 0xff000004, A_OTHER = 0xff000005, A_NOBODY = 0xff000003;
const HIDE = 'thornswoodRecipesHidden';

function world() {
  const w = {
    online: [A_STAFF, A_BJORN, A_SERA, A_OTHER, A_NOBODY],
    pid: { [A_STAFF]: STAFFER, [A_BJORN]: BJORN, [A_SERA]: SERA, [A_OTHER]: OTHER, [A_NOBODY]: NOBODY },
    name: { [A_STAFF]: 'Aela', [A_BJORN]: 'Bjorn Iron-Hand', [A_SERA]: 'Sera', [A_OTHER]: 'Ulfric', [A_NOBODY]: 'Nobody Special' },
    staff: { [STAFFER]: true, [OTHER]: true },
    props: {}, inv: {}, states: {}, writes: [], said: [], logged: [], records: [], queue: [], timers: [], given: []
  };
  return w;
}

function load(w) {
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return w.online.slice(); }
      if (key === 'profileId') { return w.pid[id]; }
      if (key === 'appearance') { return { name: w.name[id] }; }
      if (key === 'inventory') { return { entries: (w.inv[id] || []).map(function (e) { return Object.assign({}, e); }) }; }
      return (w.props[id] || {})[key];
    },
    set: function (id, key, v) { (w.props[id] = w.props[id] || {})[key] = JSON.parse(JSON.stringify(v)); },
    getServerSettings: function () { return { privDir: 'private' }; },
    getUserByActor: function (a) { return w.online.indexOf(a) >= 0 ? 70 + w.online.indexOf(a) : -1; },
    makeProperty: function () { },
    callPapyrusFunction: function () { },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; }
  };
  const http = {
    request: function (opts, cb) {
      const req = {
        on: function () { return req; }, destroy: function () { },
        end: function (body) {
          if (opts.method === 'GET' && String(opts.path).indexOf('/commands') === 0) {
            const out = JSON.stringify({ commands: w.queue.splice(0, w.queue.length) });
            const h = {};
            const res = { on: function (ev, fn) { h[ev] = fn; return res; }, resume: function () { } };
            cb(res);
            if (h.data) { h.data(out); }
            if (h.end) { h.end(); }
            return;
          }
          let doc = null;
          try { doc = JSON.parse(body); } catch (e) { doc = body; }
          if (opts.path === '/say') { w.said.push({ to: doc.profileId, text: doc.text }); }
          if (cb) { cb({ resume: function () { }, on: function () { } }); }
        }
      };
      return req;
    }
  };
  const fakeFs = {
    readFileSync: function () { throw new Error('not here'); },
    existsSync: function () { return false; },
    appendFileSync: function (p, text) { w.records.push(JSON.parse(text)); },
    mkdirSync: function () { }, writeFileSync: function () { }, unlinkSync: function () { }
  };
  const box = {
    mp: mp, console: { log: function () { }, error: function () { } }, Buffer: Buffer,
    require: function (n) { return n === 'http' ? http : n === 'fs' ? fakeFs : n === 'path' ? path : require(n); },
    log: function () { w.logged.push(Array.prototype.join.call(arguments, ' ')); },
    voicePort: function () { return 7778; },
    guard: function (name, fn) { return fn; },
    setInterval: function (fn, ms) { w.timers.push({ fn: fn, ms: ms }); return w.timers.length; },
    clearInterval: function () { }, setTimeout: function () { return 0; }, clearTimeout: function () { },
    idOf: function (desc) { return KNOWN[desc] || 0; },
    mintedEntry: function () { return false; },
    addItem: function (actorId, desc, count) {
      if (!KNOWN[desc]) { return false; }
      w.given.push({ actorId: actorId, desc: desc, count: count });
      const list = (w.inv[actorId] = w.inv[actorId] || []);
      const e = list.filter(function (x) { return x.baseId === KNOWN[desc]; })[0];
      if (e) { e.count += count; } else { list.push({ baseId: KNOWN[desc], count: count }); }
      return true;
    },
    ORES_BY_BASE: {}, HARVESTS_BY_BASE: {}, CROPS_BY_BASE: {}, FISH_BY_BASE: {},
    HUNTS_BY_BASE: {}, GAME_BY_BASE: {}, ITEM_NAMES: {}, ITEMS: {},
    ADMIN_ITEMS: { 'iron ore': ['Iron Ore', '71cf3:Skyrim.esm'], 'gold': ['Gold', 'f:Skyrim.esm'] },
    ADMIN_ACTORS: {},
    HALL: { desc: 'Hall:0', pos: [0, 0, 0], rot: [0, 0, 0] },
    PASSAGES: {}, BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, DATA: { cellToHold: {}, capitals: {} },
    // Four recipe rows: novice and advanced plate, a row whose own record asks for a perk, and a cook's.
    RECIPES_BY_ID: {
      'a1:Skyrim.esm': { name: 'Iron Plate Armor', owner: 'Smith', half: 'Platewright', rank: 'novice', open: true },
      'a2:Skyrim.esm': { name: 'Steel Plate Armor', owner: 'Smith', half: 'Platewright', rank: 'advanced', open: true },
      'a3:Dawnguard.esm': { name: 'Dawnguard Heavy Armor', owner: 'Smith', half: 'Platewright', rank: 'novice', open: false },
      'b1:Skyrim.esm': { name: 'Apple Pie', owner: 'Cook', half: 'Confectioner', rank: 'novice', open: true }
    },
    KEPT_SMELT: {},
    RECIPES_HIDDEN_PROPERTY: HIDE
  };
  vm.createContext(box);
  box.__thornswoodIsDev = function (p) { return !!w.staff[p]; };
  box.__thornswoodIsAdmin = function () { return false; };
  box.__thornswoodIsAllowed = function () { return true; };
  box.__thornswoodPassSeen = { passes: {}, online: {}, said: {} };
  box.__thornswoodSocial = { findPerson: function () { return { actorId: 0, why: 'Nobody here by that name.' }; } };
  vm.runInContext(RULES, box, { filename: 'gamemode.js (progression)' });
  const P = box.__thornswoodProgression;
  // The character block's state, as a stand-in over the world, with the
  // real block's names and raise lines: the block runs whole in a world of
  // its own, as in test-3149-rank-unlock-line.js, beside the recipe table.
  const charStore = {};
  const charBox = {
    mp: {
      makeProperty: function () { },
      get: function (id, key) {
        if (key === 'profileId') { return 1000 + (id & 0xff); }
        const p = charStore[id] || {};
        return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
      },
      set: function (id, key, value) { (charStore[id] = charStore[id] || {})[key] = JSON.stringify(value); },
      getDescFromId: function (n) { return 'unknown' + n + ':Nowhere.esp'; }
    },
    JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    notify: function () { }, say: function () { }, log: function () { },
    raceOf: function () { return ''; },
    RECIPES_BY_ID: TABLE
  };
  charBox.globalThis = charBox;
  vm.createContext(charBox);
  vm.runInContext(RULES, charBox, { filename: 'gamemode.js (progression, for the character block)' });
  vm.runInContext(CHARACTER, charBox, { filename: 'gamemode.js (character)' });
  box.__charNames = charBox.__thornswoodCharacter;
  box.__thornswoodCharacter = {
    stateOf: function (a) { return JSON.parse(JSON.stringify(w.states[a] || P.fresh())); },
    writeState: function (a, s, redraw) {
      w.states[a] = JSON.parse(JSON.stringify(s));
      w.writes.push({ actor: a, redraw: !!redraw });
      box.handRecipesHidden(a);
      return s;
    },
    masterFor: function () { return null; },
    nameOf: box.__charNames.nameOf,
    raiseLines: box.__charNames.raiseLines
  };
  // A stand-in craft gate: the rulebook's canWork, with the reason a bench gives.
  box.craftAnswer = function (actorId, row) {
    const s = box.__thornswoodCharacter.stateOf(actorId);
    const half = String(row.half || '').toLowerCase();
    if (P.canWork(s, half, row.rank || 'novice')) { return { refusal: null }; }
    return { refusal: row.name + ' is ' + row.half + ' work at ' + row.rank + '.' };
  };
  vm.runInContext(HIDDEN, box, { filename: 'gamemode.js (recipe list)' });
  vm.runInContext(PLACE_ACTORS + '\n' +
                  COMMANDS.split('const WORDS').join('var WORDS').split('const PLAYER_WORDS').join('var PLAYER_WORDS') +
                  '\n' + STAFF + '\n' + CRAFT, box, { filename: 'gamemode.js (commands, staff, staff crafting)' });
  w.box = box;
  w.P = P;
  w.tick = w.timers.filter(function (t) { return t.ms === 1500; })[0];
  return w;
}

let nextId = 1;
function run(w, pid, text, proven) {
  const before = w.said.length;
  w.queue.push({ id: 't:' + (nextId++), profileId: pid, name: '', text: text, at: Date.now(), proven: proven !== false });
  w.tick.fn();
  return w.said.slice(before);
}
function to(lines, pid) { return lines.filter(function (l) { return l.to === pid; }).map(function (l) { return l.text; }).join('\n'); }
function pass10(w, pid) { w.box.__thornswoodPassSeen.passes[pid] = { at: Date.now(), x: Date.now() + 600000, v: '1.1.102' }; }
function view(w, staffPid) { return w.box.__thornswoodStaffCraft.staffView(staffPid); }
function rankRow(v, key) { return ((v && v.them && v.them.ranks) || []).filter(function (r) { return r.key === key; })[0] || null; }

const w = load(world());
yes('L1 the blocks load, and the staff crafting block is on globalThis', !!w.tick && !!w.box.__thornswoodStaffCraft);
pass10(w, STAFFER);
pass10(w, OTHER);
pass10(w, NOBODY);
// Bjorn is a Platewright and a miner, 40 pieces into Advanced; Sera is a Confectioner.
(function () {
  let s = w.P.pickClass(w.P.fresh(), 'miner').state;
  s = w.P.pickProfession(s, 'smith', 'platewright').state;
  s.work.platewright = 40;
  w.states[A_BJORN] = s;
  w.states[A_SERA] = w.P.pickProfession(w.P.fresh(), 'cook', 'confectioner').state;
  w.box.__thornswoodCharacter.writeState(A_BJORN, w.states[A_BJORN]);
  w.box.__thornswoodCharacter.writeState(A_SERA, w.states[A_SERA]);
  w.writes.length = 0;
})();

/* ------------------------------------------------------------- the gate */
let got = run(w, NOBODY, '/craftstaff pick ' + BJORN);
yes('G1 somebody who is not staff is told the line is not theirs, and nothing is picked',
    to(got, NOBODY) === 'That one is not yours to run.' && !w.box.__thornswoodStaffCraft.state.picked[NOBODY]);
got = run(w, STAFFER, '/craftstaff pick ' + BJORN, false);
yes('G2 staff on a chat that has not proved who they are are told so, and nothing is picked',
    /proved who you are/.test(to(got, STAFFER)) && !w.box.__thornswoodStaffCraft.state.picked[STAFFER]);
let v = view(w, STAFFER);
yes('G3 before a pick the card offers everybody in the world, by name and profile',
    !!v && v.them === null && v.people.length === 5 && v.people.some(function (p) { return p.pid === BJORN && p.name === 'Bjorn Iron-Hand'; }));

/* ------------------------------------------------------------ the ranks */
got = run(w, STAFFER, '/craftstaff pick ' + BJORN);
v = view(w, STAFFER);
yes('R1 a pick makes the card Bjorn\'s, and draws the staff member\'s panel again',
    !!v.them && v.them.pid === BJORN && v.them.name === 'Bjorn Iron-Hand' && v.them.self === false &&
    w.writes.some(function (x) { return x.actor === A_STAFF && x.redraw; }));
const pl = rankRow(v, 'platewright'), ed = rankRow(v, 'edgewright'), mi = rankRow(v, 'miner');
yes('R2 every class and half he holds is on it, with its rank and the work toward the next',
    !!pl && pl.name === 'Platewright' && pl.rank === 'novice' && pl.next === 'advanced' && pl.work === 40 && pl.need === 100 &&
    !!mi && mi.next === 'advanced' && !!ed && ed.rank === 'novice');
yes('R3 the sister half past novice says the rulebook\'s reason, and offers no raise',
    !!ed && ed.next === null && /needs a Master of it to take you on/.test(ed.why));
got = run(w, STAFFER, '/craftstaff raise ' + BJORN + ' platewright');
const bj = w.states[A_BJORN];
yes('R4 Raise makes him an Advanced Platewright, with the skill point a rank gives and the count at 0',
    bj.ranks.platewright === 'advanced' && bj.points === 1 && bj.work.platewright === 0);
yes('R4 he is told the way work tells him (' + to(got, BJORN) + ')',
    to(got, BJORN).indexOf('Staff raised your rank. You are now an Advanced Platewright. 1 skill point to spend, on K. ' +
                           'Advanced Platewright work opens ') === 0 && / more recipes to you: /.test(to(got, BJORN)));
yes('R4 and the staff member is told (' + to(got, STAFFER) + ')',
    to(got, STAFFER) === 'Bjorn Iron-Hand is now Advanced in Platewright. It is in the staff log.');
let rec = w.records[w.records.length - 1] || {};
yes('R5 it is one line in the staff log: who, whom, what from and to',
    w.records.length === 1 && rec.did === 'craftrank' && rec.by === STAFFER && rec.who === BJORN &&
    rec.why === 'Platewright from Novice to Advanced' && rec.key === 'platewright' && rec.to === 'advanced');
got = run(w, STAFFER, '/craftstaff raise ' + BJORN + ' edgewright');
yes('R6 a raise the rulebook refuses changes nothing and says its reason (' + to(got, STAFFER) + ')',
    w.states[A_BJORN].ranks.edgewright === 'novice' && w.records.length === 1 &&
    /^Bjorn Iron-Hand: Past novice in your sister half needs a Master of it to take you on\. Nothing changed\.$/.test(to(got, STAFFER)));
got = run(w, STAFFER, '/craftstaff raise ' + BJORN + ' __proto__');
yes('R7 something he has no standing in changes nothing', /has no standing in that/.test(to(got, STAFFER)) && w.records.length === 1);
w.states[A_STAFF] = w.P.pickProfession(w.P.fresh(), 'smith', 'edgewright').state;
got = run(w, STAFFER, '/craftstaff raise ' + STAFFER + ' edgewright');
yes('R8 nobody raises their own rank', /^Not on yourself/.test(to(got, STAFFER)) &&
    w.states[A_STAFF].ranks.edgewright === 'novice' && w.records.length === 1);

/* ---------------------------------------------------------- the recipes */
got = run(w, STAFFER, '/craftstaff pick ' + SERA);
got = run(w, STAFFER, '/craftstaff recipe ' + SERA + ' plate');
v = view(w, STAFFER);
const rows = (v.them && v.them.check && v.them.check.rows) || [];
yes('C1 a check lists the recipes making that, for the person picked',
    rows.length === 2 && rows.map(function (r) { return r.name; }).join() === 'Iron Plate Armor,Steel Plate Armor');
yes('C2 with the craft gate\'s reason for each, and that her game hides them, so nothing is stale',
    rows.every(function (r) { return !r.may && /is Platewright work at/.test(r.why) && r.hidden && !r.stale; }));
got = run(w, STAFFER, '/craftstaff recipe ' + SERA + ' dawnguard');
v = view(w, STAFFER);
yes('C3 a recipe whose own record asks for something first says so',
    v.them.check.rows.length === 1 && v.them.check.rows[0].asks === true);
got = run(w, STAFFER, '/craftstaff recipe ' + SERA + ' goat cheese');
yes('C4 nothing called that is said in the chat', /No recipe anybody owns makes anything called goat cheese/.test(to(got, STAFFER)));
// Sera's game holds an older list: Apple Pie hidden though she may make it.
w.props[A_SERA][HIDE] = { at: 1, files: { 'Skyrim.esm': 'a1,a2,b1', 'Dawnguard.esm': 'a3' } };
got = run(w, STAFFER, '/craftstaff recipe ' + SERA + ' apple');
v = view(w, STAFFER);
yes('C5 a list older than the gate shows as stale: she may make it and her game hides it',
    v.them.check.rows.length === 1 && v.them.check.rows[0].may && v.them.check.rows[0].hidden && v.them.check.rows[0].stale);
got = run(w, STAFFER, '/craftstaff recipes ' + SERA);
yes('C6 Hand their game the list writes the gate\'s answer (' + JSON.stringify(w.props[A_SERA][HIDE].files) + ')',
    w.props[A_SERA][HIDE].files['Skyrim.esm'] === 'a1,a2' && w.props[A_SERA][HIDE].at > 1);
rec = w.records[w.records.length - 1] || {};
yes('C6 and it is in the staff log and thornswood.log as a finding',
    rec.did === 'craftrecipes' && rec.who === SERA &&
    w.logged.some(function (l) { return /staff crafting: Sera \(profile 4004\) had an older recipe list/.test(l); }) &&
    /older recipe list than the craft gate gives now\. It has the new one/.test(to(got, STAFFER)));
const n = w.records.length;
got = run(w, STAFFER, '/craftstaff recipes ' + SERA);
yes('C7 a second press finds nothing old, writes nothing and logs nothing',
    w.records.length === n && /already has the list the craft gate gives now/.test(to(got, STAFFER)));

/* -------------------------------------------------------------- give back */
w.inv[A_SERA] = [{ baseId: 0x71cf3, count: 1 }];
got = run(w, STAFFER, '/craftstaff give ' + SERA + ' 2 iron ore');
yes('B1 no reason, nothing given', /Say why/.test(to(got, STAFFER)) && w.given.length === 0);
got = run(w, STAFFER, '/craftstaff give ' + SERA + ' 0 iron ore | lost');
yes('B2 a count that is not 1 to 1000, nothing given', /Give back 1 to 1000/.test(to(got, STAFFER)) && w.given.length === 0);
got = run(w, STAFFER, '/craftstaff give ' + SERA + ' 2 dragon scales | lost');
yes('B3 nothing called that, nothing given', /Nothing changed\.$/.test(to(got, STAFFER)) && w.given.length === 0);
got = run(w, STAFFER, '/craftstaff give ' + SERA + ' 2 iron ore | lost in the crash at 4 PM');
yes('B4 an item, a count and a reason give it back into her pack',
    w.given.length === 1 && w.given[0].actorId === A_SERA && w.given[0].desc === '71cf3:Skyrim.esm' && w.given[0].count === 2);
yes('B4 she is told, and the staff member is told what she carries now (' + to(got, STAFFER) + ')',
    to(got, SERA) === 'Staff gave you back 2 Iron Ore.' &&
    to(got, STAFFER) === 'Gave Sera back 2 Iron Ore. They carry 3 now. It is in the staff log.');
rec = w.records[w.records.length - 1] || {};
yes('B5 it is in the staff log with the reason', rec.did === 'craftgive' && rec.who === SERA &&
    rec.why === '2 Iron Ore: lost in the crash at 4 PM' && rec.item === '71cf3:Skyrim.esm' && rec.count === 2);
got = run(w, STAFFER, '/craftstaff give ' + STAFFER + ' 2 iron ore | mine');
yes('B6 nobody gives themselves anything', /^Not on yourself/.test(to(got, STAFFER)) && w.given.length === 1);
got = run(w, STAFFER, '/craftstaff give 7777 2 iron ore | lost');
yes('B7 somebody not in the world, nothing changed', /not in the world now, so nothing changed/.test(to(got, STAFFER)) && w.given.length === 1);

/* --------------------------------------------------------- picks, reloads */
vm.runInContext(CRAFT, w.box, { filename: 'gamemode.js (staff crafting, reloaded)' });
yes('P1 a hot reload keeps who each staff member picked', view(w, STAFFER).them && view(w, STAFFER).them.pid === SERA);
got = run(w, STAFFER, '/craftstaff pick -');
yes('P2 Pick somebody else clears the card', view(w, STAFFER).them === null);
w.online = w.online.filter(function (a) { return a !== A_BJORN; });
got = run(w, OTHER, '/craftstaff pick ' + BJORN);
yes('P3 somebody who left cannot be picked', /not in the world now/.test(to(got, OTHER)) && view(w, OTHER).them === null);

/* -------------------------------------------------------- the K panel's card */
{
  const lines = [];
  function node(tag) {
    const n = { tag: tag, children: [], style: {}, className: '', _text: '', id: '', onclick: null, title: '' };
    Object.defineProperty(n, 'textContent', {
      get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
      set: function (x) { n._text = String(x); n.children = []; }
    });
    n.appendChild = function (c) { n.children.push(c); return c; };
    n.querySelector = function (sel) { return (n._q && n._q[sel]) || node('div'); };
    return n;
  }
  const docu = {
    head: node('head'), body: node('body'),
    createElement: function (tag) {
      const n = node(tag);
      Object.defineProperty(n, 'innerHTML', { set: function () {
        const close = node('div'); close._q = { span: node('span'), '.key': node('span') };
        n._q = { '.title': node('div'), '.who': node('div'), '.nav': node('div'), '.body': node('div'),
                 '.status': node('div'), '[data-act="confirm"]': node('div'), '[data-act="close"]': close, '.panel': node('div') };
      } });
      return n;
    },
    createTextNode: function (t) { const n = node('#text'); n._text = String(t); return n; }
  };
  const win = { innerWidth: 1920, innerHeight: 1080, addEventListener: function () { },
                skyrimPlatform: { sendMessage: function () { } },
                thornswoodNet: { say: function (l) { lines.push(l); } } };
  const box = { window: win, document: docu, setTimeout: function () { }, Date: Date, JSON: JSON, console: console };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(ui, box, { filename: 'thornswood-skills.js' }); } catch (e) { ran = false; console.log(e); }
  const api = win.thornswoodSkills;
  yes('U0 the K panel runs in a stand-in document', ran && !!api);
  if (api) {
    const root = docu.body.children[0];
    const nav = root._q['.nav'], body = root._q['.body'], status = root._q['.status'];
    const all = function (x, out) { out = out || []; out.push(x); (x.children || []).forEach(function (c) { all(c, out); }); return out; };
    const buttons = function (re) { return all(body).filter(function (x) { return x.className === 'stop' && re.test(x.textContent); }); };
    const inputs = function () { return all(body).filter(function (x) { return x.tag === 'input'; }); };
    const goOffice = function () {
      const r = nav.children.filter(function (x) { return /navrow/.test(x.className) && x.children[0].textContent === 'Office'; })[0];
      if (r) { r.onclick(); }
      return r;
    };
    const show = function (craft) {
      api.setData(null, { panel: { 'class': 'hunter', profession: 'smith', half: 'edgewright', ranks: {}, tree: {}, points: 0,
                                   officePage: { staff: true, craft: craft } } });
    };
    api.open();
    // The card drawn from the server's own view of a fresh world.
    const w2 = load(world());
    pass10(w2, STAFFER);
    w2.states[A_BJORN] = w2.P.pickProfession(w2.P.fresh(), 'smith', 'platewright').state;
    w2.box.__thornswoodCharacter.writeState(A_BJORN, w2.states[A_BJORN]);
    show(view(w2, STAFFER));
    goOffice();
    yes('U1 staff see the crafting card with everybody to pick', /Crafting/.test(body.textContent) &&
        buttons(/^Pick$/).length === 5);
    lines.length = 0;
    const row = all(body).filter(function (x) { return /guest/.test(x.className) && /Bjorn Iron-Hand/.test(x.textContent); })[0];
    const pick = row ? row.children.filter(function (c) { return c.className === 'stop'; })[0] : null;
    if (pick) { pick.onclick({}); }
    yes('U2 Pick beside Bjorn sends his profile (' + lines.join(' | ') + ')', lines.join() === '/craftstaff pick ' + BJORN);
    run(w2, STAFFER, '/craftstaff pick ' + BJORN);
    run(w2, STAFFER, '/craftstaff recipe ' + BJORN + ' plate');
    show(view(w2, STAFFER));
    yes('U3 the card names him, his ranks, the sister half\'s reason and the recipes checked',
        /Crafting: Bjorn Iron-Hand/.test(body.textContent) && /Platewright/.test(body.textContent) &&
        /needs a Master of it/.test(body.textContent) && /Steel Plate Armor/.test(body.textContent) &&
        /is Platewright work at advanced/.test(body.textContent));
    lines.length = 0;
    const raise = buttons(/^Raise to Advanced$/);
    if (raise.length) { raise[0].onclick({}); }
    yes('U4 Raise asks first', lines.length === 0 && raise.length === 1 &&
        raise[0].textContent === 'Press again to make Bjorn Iron-Hand Advanced in Platewright');
    if (raise.length) { raise[0].onclick({}); }
    yes('U4 and the second press sends the raise (' + lines.join(' | ') + ')', lines.join() === '/craftstaff raise ' + BJORN + ' platewright');
    lines.length = 0;
    const ins = inputs();
    const check = buttons(/^Check$/)[0];
    ins[0].value = 'iron plate';
    if (check) { check.onclick({}); }
    yes('U5 Check sends what was typed (' + lines.join(' | ') + ')', lines.join() === '/craftstaff recipe ' + BJORN + ' iron plate');
    lines.length = 0;
    const give = buttons(/^Give back$/)[0];
    ins[1].value = 'iron ore'; ins[2].value = '2'; ins[3].value = '';
    if (give) { give.onclick({}); give.onclick({}); }
    yes('U6 Give back with no reason sends nothing and says why (' + status.textContent + ')',
        lines.length === 0 && /Say why/.test(status.textContent));
    ins[3].value = 'lost in the crash';
    if (give) { give.onclick({}); }
    yes('U6 with a reason it sends the item, the count and the reason (' + lines.join(' | ') + ')',
        lines.join() === '/craftstaff give ' + BJORN + ' 2 iron ore | lost in the crash');
    run(w2, STAFFER, '/craftstaff pick ' + STAFFER);
    show(view(w2, STAFFER));
    yes('U7 on yourself the card checks only: no Raise and no Give back',
        buttons(/^Raise to/).length === 0 && buttons(/^Give back$/).length === 0 && buttons(/^Check$/).length === 1);
    show(null);
    goOffice();
    yes('U8 a page with no crafting card draws none', !/Crafting/.test(body.textContent));
  }
}

/* ----------------------------------------------------------------- words */
const said = [];
CRAFT.replace(/'([^'\\]|\\.)*'/g, function (q) { said.push(q); return q; });
const card = ui.slice(ui.indexOf('function officeCraft('), ui.indexOf("/* The trade ships' staff panel"));
card.replace(/'([^'\\]|\\.)*'/g, function (q) { said.push(q); return q; });
yes('X1 nothing the card or the server says uses an em dash or the word for somebody playing (' + said.length + ' strings)',
    said.length > 50 && [CRAFT, card].every(function (t) { return t.indexOf(String.fromCharCode(0x2014)) === -1; }) &&
    said.every(function (t) { return t === "'onlinePlayers'" || !new RegExp('pla' + 'yer', 'i').test(t); }));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
