'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {createQuestEligibility} = require('../game/quest-eligibility');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(__dirname, '../game/gamemode.js'), 'utf8'));
const begin = gm.indexOf('// ==== thornswood progression ====');
const end = gm.indexOf('// ==== end thornswood progression ====');
assert.ok(begin >= 0 && end > begin);
const ctx = {};
vm.createContext(ctx);
vm.runInContext(gm.slice(begin, end), ctx);
const P = ctx.__thornswoodProgression;
const table = JSON.parse(JSON.stringify(P.TABLE));
const spellIds = JSON.parse(JSON.stringify(P.SPELL_IDS));
const gates = createQuestEligibility({table, spellIds});
let checks = 0;
function allows(gate, state, expected, why) {
  const before = JSON.stringify({gate, state});
  assert.equal(gates.allows(gate, state), expected, why);
  assert.equal(JSON.stringify({gate, state}), before, 'evaluation changes no input');
  checks++;
}
function saved(patch) {return Object.assign({v: 1, cls: null, prof: null, ranks: {}}, patch);}

for (const cls of Object.keys(table.classes)) {
  for (const required of table.ranks) for (const have of table.ranks) {
    allows({classKey: cls, rank: required}, saved({cls, ranks: {[cls]: have}}),
      table.ranks.indexOf(have) >= table.ranks.indexOf(required), cls + ' rank ladder');
  }
  allows({classKey: cls, rank: 'master'}, saved({cls: 'other', ranks: {[cls]: 'master'}}), false, 'chosen class required');
}
for (const [prof, def] of Object.entries(table.professions)) {
  if (!def.halves) continue;
  const halves = Object.keys(def.halves);
  for (const half of halves) {
    const sister = halves.find(h => h !== half);
    allows({profession: prof, half, rank: 'master'}, saved({prof, half: sister, ranks: {[half]: 'master'}}), true,
      'earned sister-half mastery counts: ' + half);
    allows({profession: prof, half, rank: 'master'}, saved({prof, half, ranks: {[half]: 'expert'}}), false, 'Master needs Master');
    allows({profession: prof, rank: 'expert'}, saved({prof, half, ranks: {[sister]: 'expert'}}), true, 'either own half counts');
    allows({profession: prof, rank: 'novice'}, saved({prof: prof === 'smith' ? 'cook' : 'smith', ranks: {[half]: 'master'}}), false,
      'outside learned trade is not chosen profession');
  }
}
for (const school of table.schools) {
  const gate = {profession: 'mage', school, rank: 'master'};
  const book = table.spells[school];
  const master = book.master.find(name => Object.hasOwn(spellIds, name));
  const lower = book.novice.find(name => Object.hasOwn(spellIds, name));
  const other = table.schools.find(s => s !== school);
  const wrong = table.spells[other].master.find(name => Object.hasOwn(spellIds, name));
  assert.ok(master && lower && wrong, school + ' has mapped real test spells');
  const state = saved({prof: 'mage', schools: [school, other], ranks: {[school]: 'master'}, spells: {known: [master]}});
  allows(gate, state, true, 'learned mapped Master spell: ' + school);
  for (const known of [[], [lower], [wrong], ['Unknown spell'], [master.toLowerCase()], [spellIds[master]], [null]]) {
    allows(gate, {...state, spells: {known}}, false, 'only canonical learned Master names prove mastery');
  }
  allows(gate, {...state, spells: null, staffSpells: [spellIds[master]], inventory: [master]}, false, 'staffs/tomes do not prove learning');
  allows(gate, {...state, ranks: {[school]: 'expert'}}, false, 'learned spell does not replace standing');
  allows(gate, {...state, schools: [other]}, false, 'school selection required');
  allows(gate, {...state, prof: 'smith'}, false, 'Mage profession required');
  const missing = {...spellIds}; delete missing[master];
  assert.equal(createQuestEligibility({table, spellIds: missing}).allows(gate, state), false, 'unmapped spell cannot prove mastery');
  checks++;
  allows({profession: 'mage', rank: 'novice'}, {...state, spells: null}, true, 'lower Mage gate needs standing, not Master spell');
}

const valid = {classKey: 'miner', rank: 'novice'};
const validState = saved({cls: 'miner', ranks: {miner: 'master'}});
for (const state of [null, undefined, [], {}, {...validState, v: 2}, {...validState, ranks: []},
  {...validState, ranks: {miner: 'invalid'}}, {...validState, ranks: {miner: true}},
  Object.assign(Object.create({v: 1}), {cls: 'miner', ranks: {miner: 'master'}}),
  {...validState, ranks: Object.create({miner: 'master'})}]) {
  allows(valid, state, false, 'malformed/missing saved standing refuses');
}
for (const gate of [null, [], {}, {open: false}, {open: true, rank: 'novice'},
  {classKey: 'miner', rank: ''}, {classKey: 'miner', rank: 'MASTER'}, {classKey: 'bard', rank: 'novice'},
  {classKey: 'miner', rank: 'novice', profession: 'smith'}, {classKey: 'miner', rank: 'master', half: 'platewright'},
  {profession: 'smith', rank: 'master'}, {profession: 'smith', rank: 'master', half: 'hearthcook'},
  {profession: 'smith', rank: 'novice', school: 'destruction'}, {profession: 'mage', rank: 'master'},
  {profession: 'mage', rank: 'master', school: 'destruction', half: 'platewright'},
  {profession: '__proto__', rank: 'novice'}, {profession: 'mage', rank: 'master', school: 'constructor'},
  Object.create({classKey: 'miner', rank: 'novice'}), {...valid, unknown: true},
  Object.assign(Object.create({unknown: true}), valid),
  Object.assign(Object.create({half: 'platewright'}), {profession: 'smith', rank: 'novice'}),
  Object.defineProperty({...valid}, 'unknown', {value: true}), {...valid, [Symbol('unknown')]: true}]) {
  assert.throws(() => gates.validate(gate), /quest gate/i, 'invalid definition refuses setup');
  assert.equal(gates.allows(gate, validState), false, 'invalid definition never becomes an open quest');
  checks++;
}
let getterCalls = 0;
const accessorGate = {classKey: 'miner', get rank() {getterCalls++; return 'novice';}};
assert.throws(() => gates.validate(accessorGate), /quest gate/i);
assert.equal(gates.allows(accessorGate, validState), false);
assert.equal(getterCalls, 0, 'definitions contain data fields only');
const mastery = {profession: 'mage', school: 'destruction', rank: 'master'};
const learned = table.spells.destruction.master.find(name => Object.hasOwn(spellIds, name));
for (const field of ['schools', 'known']) for (const mode of ['inherited', 'accessor']) {
  let reads = 0;
  const items = new Array(1), item = field === 'schools' ? 'destruction' : learned;
  if (mode === 'inherited') Object.setPrototypeOf(items, Object.assign(Object.create(Array.prototype), {0: item}));
  else Object.defineProperty(items, 0, {get() {reads++; return item;}, enumerable: true});
  const state = saved({prof: 'mage', ranks: {destruction: 'master'},
    schools: field === 'schools' ? items : ['destruction'], spells: {known: field === 'known' ? items : [learned]}});
  assert.equal(gates.allows(mastery, state), false, field + ' must contain own data entries: ' + mode);
  assert.equal(reads, 0, 'eligibility never executes array getters');
  checks++;
}
const accessorBook = [learned];
Object.defineProperty(accessorBook, 0, {get() {throw Error('must not read learned-spell getter');}, enumerable: true});
Object.defineProperty(Object.prototype, 'value', {value: learned, configurable: true});
try {
  assert.equal(gates.allows(mastery, saved({prof: 'mage', schools: ['destruction'],
    ranks: {destruction: 'master'}, spells: {known: accessorBook}})), false,
  'an accessor descriptor cannot inherit a learned spell from Object.prototype.value');
} finally {delete Object.prototype.value;}
checks++;
let methodCalls = 0, coercions = 0;
for (const known of [Object.assign([], {some() {methodCalls++; return true;}}),
  [{toString() {coercions++; return learned;}}]]) {
  assert.equal(gates.allows(mastery, saved({prof: 'mage', schools: ['destruction'],
    ranks: {destruction: 'master'}, spells: {known}})), false, 'untrusted array methods and coercion do not grant mastery');
  checks++;
}
assert.equal(methodCalls, 0, 'snapshot methods are never called');
assert.equal(coercions, 0, 'non-string spell entries are never coerced');
Object.defineProperty(Object.prototype, 'open', {value: true, configurable: true});
try {
  assert.equal(gates.allows({classKey: 'miner', rank: 'master'}, null), false,
    'inherited open flag cannot grant a gated quest');
} finally {delete Object.prototype.open;}
for (const gate of [{classKey: {toString: () => 'miner'}, rank: 'novice'},
  {profession: 'smith', half: {toString: () => 'platewright'}, rank: 'master'}]) {
  assert.throws(() => gates.validate(gate), /quest gate/i, 'gate keys are canonical strings, never coerced');
  checks++;
}
const copied = gates.validate(valid);
valid.rank = 'master';
assert.equal(copied.rank, 'novice', 'definition copied');
assert.ok(Object.isFrozen(copied), 'validated definition immutable');
const masterGate = {profession: 'mage', school: 'destruction', rank: 'master'};
const spell = table.spells.destruction.master.find(name => Object.hasOwn(spellIds, name));
const mage = saved({prof: 'mage', schools: ['destruction'], ranks: {destruction: 'master'}, spells: {known: [spell]}});
table.spells.destruction.master.length = 0;
table.ranks.length = 0;
delete spellIds[spell];
allows(masterGate, mage, true, 'source metadata captured, not coupled to later mutations');
allows({open: true}, null, true, 'explicit ungated legacy work remains open');
assert.throws(() => createQuestEligibility({}), /quest.*metadata/i);
console.log('PASS ' + checks + ' quest eligibility cases from the canonical rulebook');
