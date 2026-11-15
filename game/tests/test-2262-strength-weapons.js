// test-2262-strength-weapons.js
//
// #2262. Strength-based weapons. Patrick, 16 Oct 2026: Might (the skill tree
// sub-skill, 0 to 5) is strength; a weapon weighing 30 to 44 needs Might 3,
// and the Giant's Club or anything weighing 45 or more needs Might 5. Keyed
// off the weapon's weight, never a record id.
//
// The gate is the gamemode's handler for onEquipItemAttempt(actorId, baseId),
// the opt-in skymp event Codex adds on the fork (fires before the equip is
// saved; false drops that item and it stays in the pack). Until the pin
// carries the event, this harness stands in for it: a small engine below
// raises the event for each item newly worn and drops what is refused, the
// way the fork's OnUpdateEquipment will.
//
// The strength block is run as it stands, over a stand-in mp.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read() {
  return fs.readFileSync(path.join.apply(path, [ROOT].concat([].slice.call(arguments))), 'utf8').split(CR).join('');
}
const gm = read('game', 'gamemode.js');
const ui = read('game', 'ui', 'thornswood-skills.js');
const doc = read('docs', 'systems', 'skill-tree.md');

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
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const block = slice(gm, '// ==== thornswood strength weapons ====', '// ==== end thornswood strength weapons ====');
yes('the strength weapons block is in the gamemode', !!block);
if (!block) { done(); }

// ------------------------------------------------------------ the world --

function weap(weight) {
  const b = new Uint8Array(10);
  new DataView(b.buffer).setFloat32(4, weight, true);
  return { record: { type: 'WEAP', fields: [{ type: 'DNAM', data: [6] }, { type: 'DATA', data: Array.from(b) }] } };
}
const RECORDS = {
  0x00012eb7: weap(9),       // Iron Sword
  0x00013982: weap(29.9),    // just under the first row
  0x00100001: weap(30),      // a playable maul
  0x00100002: weap(44),
  0x00100003: weap(45),      // a playable Giant's Club, as a collection mod would add it
  0x00100004: weap(60),
  0x00100005: { record: { type: 'WEAP', fields: [{ type: 'DATA', data: [1, 2] }] } },  // unreadable DATA
  0x00012e49: { record: { type: 'ARMO', fields: [{ type: 'DATA', data: Array.from(weap(90).record.fields[1].data) }] } }
};
const CHAR = 'thornswoodCharacter';
const props = {};
const said = [], notes = [];
const mp = {
  lookupEspmRecordById(id) { return RECORDS[id] || { record: null }; },
  get(id, key) { return (props[id] || {})[key]; }
};
const players = {};
function person(id, might) { players[id] = { v: 1, tree: { might: might } }; props[id] = { [CHAR]: players[id], profileId: id & 0xffff }; }
person(0xff000001, 0);
person(0xff000002, 3);
person(0xff000003, 4);
person(0xff000004, 5);
const npc = 0x0001a6ba;

const sandbox = {
  mp, console: { log() {}, error() {} }, DataView, ArrayBuffer, Math, Number, String, Object, isFinite,
  guard: (name, fn) => function () { return fn.apply(null, arguments); },
  notify: (a, t) => notes.push([a, t]),
  say: (a, t) => said.push([a, t])
};
sandbox.globalThis = sandbox;
let stateOfCalls = 0;
const heldPids = new Set();
sandbox.__thornswoodPassHeld = pid => heldPids.has(pid);
// stateOf would migrate (write) a character; the gate must never call it.
sandbox.__thornswoodCharacter = { PROPERTY: CHAR, stateOf: id => { stateOfCalls++; return players[id]; } };
vm.createContext(sandbox);
vm.runInContext(block, sandbox, { filename: 'strength-block.js' });
const S = sandbox.__thornswoodStrength;

yes('the block chains: it wraps the handler already on mp, never assigns over it bare',
    /var before = mp\.onEquipItemAttempt;/.test(block) && /if \(before && before\(actorId, baseId\) === false\) \{ return false; \}/.test(block));

yes('the block registers mp.onEquipItemAttempt', typeof mp.onEquipItemAttempt === 'function');
yes('it goes through guard() like every other engine event', /var gate = guard\('onEquipItemAttempt'/.test(block) && /mp\.onEquipItemAttempt = gate;/.test(block));
yes('the thresholds are Patrick\'s: 45 needs 5, 30 needs 3',
    JSON.stringify(S.STRENGTH.tiers) === JSON.stringify([{ weight: 45, might: 5 }, { weight: 30, might: 3 }]));
yes('no record id is named in the rule', !/0x[0-9a-f]{5,}/i.test(block) && !/\.esp/i.test(block));
yes("the block defines no passHeld function: test-join-pass-trust.js takes the first one in the file by name", block.indexOf('  function passHeld(') < 0);
yes('no slash command anywhere in the block', !/['"]\/[a-z]/.test(block));

// ------------------------------------------------------------- weights --
yes('weight is read from WEAP DATA (9)', Math.abs(S.weightOf(0x00012eb7) - 9) < 1e-6);
yes('a weight of 44 reads 44', S.weightOf(0x00100002) === 44);
yes('an unreadable DATA reads null and is never refused', S.weightOf(0x00100005) === null && S.needOf(0x00100005) === 0);
yes('armour, however heavy, is not a weapon', S.weightOf(0x00012e49) === null && S.needOf(0x00012e49) === 0);
yes('an unknown form is not refused', S.needOf(0x00999999) === 0);

const table = [
  [0x00012eb7, 0], [0x00013982, 0], [0x00100001, 3], [0x00100002, 3], [0x00100003, 5], [0x00100004, 5]
];
table.forEach(([id, need]) => yes('weight ' + S.weightOf(id) + ' needs Might ' + need, S.needOf(id) === need));

// ------------------------------------------------------- the decisions --
const cases = [
  [0xff000001, 0x00012eb7, true], [0xff000001, 0x00013982, true],
  [0xff000001, 0x00100001, false], [0xff000001, 0x00100003, false],
  [0xff000002, 0x00100001, true], [0xff000002, 0x00100002, true], [0xff000002, 0x00100003, false],
  [0xff000003, 0x00100004, false],
  [0xff000004, 0x00100003, true], [0xff000004, 0x00100004, true],
  [npc, 0x00100004, undefined]
];
cases.forEach(([a, b, want]) => {
  const m = a === npc ? 'an NPC' : 'Might ' + players[a].tree.might;
  yes(m + ', weight ' + S.weightOf(b) + ': ' + (want === undefined ? 'no decision' : want ? 'allowed' : 'refused'), mp.onEquipItemAttempt(a, b) === want);
});

// ----------------------------- no loaded character, no decision (Codex) --
// guard() does not hold this event for a session waiting on its join pass,
// so the gate itself must not refuse before the character is in.
const PRE = 0xff000010, OLD = 0xff000011, NOTREE = 0xff000012, HELD = 0xff000013;
props[PRE] = { profileId: 0x10 };                                   // no character record yet
props[OLD] = { [CHAR]: { trade: 'bard' }, profileId: 0x11 };        // not a loaded state (no v 1)
props[NOTREE] = { [CHAR]: { v: 1 }, profileId: 0x12 };              // loaded, tree not in yet
person(HELD, 0); heldPids.add(HELD & 0xffff);                       // a Might 0 character, pass still held
stateOfCalls = 0;
notes.length = 0; said.length = 0;
yes('pre-join actor (no character record) with a weight 60 weapon: no decision, allowed', mp.onEquipItemAttempt(PRE, 0x00100004) === undefined);
yes('an unmigrated record (no v 1) with the club: no decision, allowed', mp.onEquipItemAttempt(OLD, 0x00100003) === undefined);
yes('a loaded state with no tree yet is not read as Might 0: no decision', mp.onEquipItemAttempt(NOTREE, 0x00100003) === undefined);
yes('a Might 0 character whose join pass is still held: no decision, allowed', mp.onEquipItemAttempt(HELD, 0x00100003) === undefined);
yes('none of those is told anything', notes.length === 0 && said.length === 0);
yes('the gate never calls stateOf (which would migrate and write a character)', stateOfCalls === 0);
heldPids.delete(HELD & 0xffff);
yes('the same Might 0 character once the pass is through: refused', mp.onEquipItemAttempt(HELD, 0x00100003) === false);
yes('a loaded actor with Might 0 is refused the club', mp.onEquipItemAttempt(0xff000001, 0x00100003) === false);
yes('undefined from the gate is no refusal to the engine (only false is)', (function (r) { return r !== false; })(mp.onEquipItemAttempt(PRE, 0x00100004)));

notes.length = 0; said.length = 0;
mp.onEquipItemAttempt(0xff000002, 0x00100003);
yes('a refusal says "You are not strong enough to wield this."', notes.some(n => n[1] === 'You are not strong enough to wield this.'));
yes('and "Needs Might 5"', notes.some(n => n[1] === 'Needs Might 5'));
yes('and puts the same in the chat', said.length === 1 && said[0][1] === 'You are not strong enough to wield this. Needs Might 5.');
notes.length = 0; said.length = 0;
mp.onEquipItemAttempt(0xff000001, 0x00100001);
yes('a 30 weight weapon says Needs Might 3', notes.some(n => n[1] === 'Needs Might 3'));
notes.length = 0; said.length = 0;
mp.onEquipItemAttempt(0xff000004, 0x00100003);
mp.onEquipItemAttempt(0xff000001, 0x00012eb7);
yes('an allowed equip says nothing', notes.length === 0 && said.length === 0);

// --------------------------------- the engine event, stood in for here --
// What the fork's OnUpdateEquipment does once the event is in: ask for every
// item newly worn, drop the refused ones, save the rest, keep the pack.
function engineEquip(actorId, saved, update) {
  const was = new Set(saved.inventory.filter(e => e.worn).map(e => e.baseId));
  const kept = update.inventory.filter(e => {
    if (!e.worn || was.has(e.baseId) || typeof mp.onEquipItemAttempt !== 'function') { return true; }
    return mp.onEquipItemAttempt(actorId, e.baseId) !== false;
  });
  const unequip = update.inventory.filter(e => kept.indexOf(e) < 0).map(e => e.baseId);
  return { saved: { inventory: kept }, unequip: unequip, pack: update.inventory.map(e => e.baseId) };
}
const r1 = engineEquip(0xff000002, { inventory: [] },
  { inventory: [{ baseId: 0x00100003, worn: true }, { baseId: 0x00012eb7, worn: true }] });
yes('Might 3 equipping a club and a sword: the club is dropped, the sword is saved',
    r1.saved.inventory.length === 1 && r1.saved.inventory[0].baseId === 0x00012eb7);
yes('the client is told to unequip the club', r1.unequip.length === 1 && r1.unequip[0] === 0x00100003);
yes('the club stays in the pack', r1.pack.indexOf(0x00100003) >= 0);
const r2 = engineEquip(0xff000004, { inventory: [] }, { inventory: [{ baseId: 0x00100003, worn: true }] });
yes('Might 5 equips the club and it is saved', r2.saved.inventory.length === 1 && !r2.unequip.length);
// Login: the saved record already has the weapon on, so the first report
// after spawn asks about nothing that was worn when they left.
let asked3 = 0;
const realGate = mp.onEquipItemAttempt;
mp.onEquipItemAttempt = function () { asked3++; return realGate.apply(null, arguments); };
const r3 = engineEquip(0xff000001, { inventory: [{ baseId: 0x00100004, worn: true }] }, { inventory: [{ baseId: 0x00100004, worn: true }] });
mp.onEquipItemAttempt = realGate;
yes('a login with a weapon already worn in the saved record is not asked about and stays worn',
    asked3 === 0 && r3.saved.inventory.length === 1 && !r3.unequip.length);
const r4 = engineEquip(0xff000001, { inventory: [] }, { inventory: [{ baseId: 0x00100004, worn: true }] });
yes('a heavy weapon newly put on by a loaded Might 0 character is refused', r4.saved.inventory.length === 0 && r4.unequip[0] === 0x00100004);
const r5 = engineEquip(PRE, { inventory: [] }, { inventory: [{ baseId: 0x00100004, worn: true }] });
yes('the same for a pre-join actor goes through (no decision)', r5.saved.inventory.length === 1 && !r5.unequip.length);

// ------------------------------------------- sharing the event (#2618) --
// The cuffs (#2573, #2618) answer onEquipItemAttempt too, and wrap whatever
// handler is already on mp. Stand-in cuffs, written to that pattern: refuse
// anything while the wearer is cuffed, ask the handler they found otherwise.
const CUFFED = 0xff000004;   // Might 5, so only the cuffs can refuse them
function loadCuffs(m, said2) {
  const prev = m.onEquipItemAttempt;
  m.onEquipItemAttempt = function (actorId, baseId) {
    let mine = true;
    if (actorId === CUFFED) { mine = false; said2.push('cuffs'); }
    const theirs = typeof prev === 'function' ? prev(actorId, baseId) : true;
    return mine && theirs !== false;
  };
}
function loadStrength(m) {
  const sb = Object.assign({}, sandbox, { mp: m });
  sb.globalThis = sb;
  vm.createContext(sb);
  vm.runInContext(block, sb, { filename: 'strength-block.js' });
  return sb;
}
function world() { return { lookupEspmRecordById: mp.lookupEspmRecordById, get: mp.get }; }
const pairs = [[0xff000001, 0x00012eb7], [0xff000001, 0x00100003], [0xff000002, 0x00100001],
               [0xff000002, 0x00100003], [CUFFED, 0x00012eb7], [CUFFED, 0x00100003], [npc, 0x00100004]];
const answers = {};
for (const order of ['cuffs then strength', 'strength then cuffs']) {
  const m = world(); const c = [];
  if (order === 'cuffs then strength') { loadCuffs(m, c); loadStrength(m); } else { loadStrength(m); loadCuffs(m, c); }
  // Allowed or refused: only false is a refusal, so undefined (no decision) counts as allowed.
  answers[order] = pairs.map(([a, b]) => m.onEquipItemAttempt(a, b) !== false);
  yes(order + ': a cuffed person is refused even an ordinary sword', answers[order][4] === false);
  yes(order + ': a cuffed person with Might 5 is refused the club too', answers[order][5] === false);
  yes(order + ': Might 0 still refused the club', answers[order][1] === false);
  yes(order + ': Might 3 still allowed the 30 weight maul', answers[order][2] === true);
  yes(order + ': an ordinary sword for a free person goes through both', answers[order][0] === true);
  yes(order + ': an NPC is let through by both', answers[order][6] === true);
}
yes('the two load orders give the same answer for every case',
    JSON.stringify(answers['cuffs then strength']) === JSON.stringify(answers['strength then cuffs']));
{
  const m = world(); const c = [];
  loadCuffs(m, c); loadStrength(m);
  notes.length = 0; said.length = 0;
  m.onEquipItemAttempt(CUFFED, 0x00100003);
  yes('cuffs first: when the cuffs refuse, the strength line is not added on top', notes.length === 0 && said.length === 0);
}
{
  const m = world();
  m.onEquipItemAttempt = function () { return undefined; };
  loadStrength(m);
  yes('a handler before it that answers nothing is not a refusal', m.onEquipItemAttempt(0xff000004, 0x00100003) === true);
  yes('and the strength gate still refuses behind it', m.onEquipItemAttempt(0xff000001, 0x00100003) === false);
}
{
  const m = world(); const c = []; let asked = 0;
  m.onEquipItemAttempt = function (a) { asked++; return a !== CUFFED; };
  const first = m.onEquipItemAttempt;
  loadStrength(m); loadStrength(m); loadStrength(m);
  const sb = loadStrength(m);
  m.onEquipItemAttempt(0xff000001, 0x00012eb7);
  yes('a reload of the gamemode does not stack the strength gate (the gate before it is asked once)', asked === 1);
  yes('and still holds the gate that was there before the first load', sb.__thornswoodStrength.before === first);
}

// ---------------------------------------------------------- the K panel --
const might = /\{ key: 'might',[\s\S]*?gate: (\[[^\]]*\])/.exec(ui);
let gate = null;
try { gate = might ? vm.runInNewContext('(' + might[1] + ')') : null; } catch (e) { gate = null; }
yes('the K panel Might row carries the weapon thresholds', !!gate);
yes('and they are the server\'s, row for row', !!gate && JSON.stringify(gate) === JSON.stringify(S.STRENGTH.tiers));
const lineSrc = slice(ui, '  function gateLine(gate, have) {', '\n  }\n');
yes('the K panel draws the Might row\'s weapon line', !!lineSrc && /if \(s\.gate\) row\.appendChild\(el\('div', 'sd gate', gateLine\(s\.gate, have\)\)\)/.test(ui));
if (lineSrc && gate) {
  const gl = vm.runInNewContext('(' + lineSrc.trim().replace(/^function gateLine/, 'function') + ')');
  const l0 = gl(gate, 0), l3 = gl(gate, 3), l5 = gl(gate, 5);
  yes('the panel line names both rows', /weighing 30 to 44 need Might 3/.test(l0) && /weighing 45 or more need Might 5/.test(l0));
  yes('Might 0 can wield neither', /neither/.test(l0));
  yes('Might 3 can wield the first only', /first, not the second/.test(l3));
  yes('Might 5 can wield any', /any of them/.test(l5));
}

// ------------------------------------------------------------- the rest --
yes('docs/systems/skill-tree.md says what Might unlocks', /30 to 44 needs Might 3/.test(doc.replace(/\n/g, ' ')) && /45 or more/.test(doc));
yes('onUpdateEquipmentAttempt is not used to gate (it fires after the save)', !/onUpdateEquipmentAttempt\s*=/.test(block));
yes('the build runs this harness (it is not in tests/gate-excluded.txt, #3009)', !/^game\/tests\/test-2262-strength-weapons\.js\s/m.test(read('tests', 'gate-excluded.txt')));
yes('no em dash in the block or this harness', block.indexOf('\u2014') < 0 && fs.readFileSync(__filename, 'utf8').indexOf('\u2014') < 0);

done();
