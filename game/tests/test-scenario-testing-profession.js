'use strict';
/*
  Scenario: systems/testing-progression.md
*/
// #6738: profession changes are saved with their permissions and placement
// effects. Relationship owners are never rewritten through this test tool.
const standIn = require('../../tests/stand-in-server.js');
const fs = require('fs'), path = require('path');
const t = standIn.checks(), yes = t.yes;

for (const server of ['dev', 'main']) {
  const w = standIn.world({ name: 'setprofession-' + server, settings: {
    thornswoodServer: server, thornswoodPlaytesters: [1000],
    thornswoodDevs: [1002], thornswoodAdmins: [1004]
  } });
  const tester = w.person(0xff006750, { profileId: 1000, name: 'Brenna' });
  const staff = w.person(0xff006751, { profileId: 1002, name: 'Sera' });
  const admin = w.person(0xff006752, { profileId: 1004, name: 'Alva' });
  const other = w.person(0xff006753, { profileId: 1006, name: 'Dagny Iron Hand' });
  yes(server + ': the whole gamemode loads', w.boot());
  if (!w.loaded()) { w.done(); break; }
  [tester, staff, admin, other].forEach(w.arrive);
  w.run(30000);
  const box = w.box(), P = box.__thornswoodProgression, C = box.__thornswoodCharacter;
  function seed(actor) {
    let s = P.pickClass(P.fresh(), 'miner').state;
    s = P.pickProfession(s, 'warrior', 'berserker').state;
    s.ranks.miner = 'expert'; s.work.miner = 13;
    s.ranks.berserker = 'master'; s.work.berserker = 17;
    s.tree.might += 2; s.points = 7;
    C.writeState(actor, s, true);
  }
  [tester, staff, admin, other].forEach(seed);
  function state(actor) { return w.prop(actor, 'thornswoodCharacter'); }
  function rules(actor) { const s = state(actor); delete s.panel; delete s.asked; return JSON.stringify(s); }
  function records() {
    const file = path.join(w.dir, 'for-bot', 'moderation.log');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  }
  function denied(actor, text, target) {
    const before = rules(target), n = records().length;
    w.say(actor, text);
    return rules(target) === before && records().length === n;
  }
  const inventory = JSON.stringify(w.row(tester).inventory);
  w.say(tester, '/setprofession cook hearthcook');
  yes(server + ': queued self profession change chooses its own half at novice',
    state(tester).prof === 'cook' && state(tester).half === 'hearthcook' && state(tester).ranks.hearthcook === 'novice');
  if (state(tester).prof !== 'cook') { w.done(); break; }
  yes(server + ': old profession ranks, work and master perk leave together',
    !Object.hasOwn(state(tester).ranks, 'berserker') && !Object.hasOwn(state(tester).ranks, 'bulwark') &&
    !Object.hasOwn(state(tester).work, 'berserker') && !state(tester).panel.perks.includes('warlord'));
  yes(server + ': class progress, spent skill points and free points stay',
    state(tester).ranks.miner === 'expert' && state(tester).work.miner === 13 &&
    state(tester).tree.might - state(tester).placed.might === 2 && state(tester).points === 7);
  yes(server + ': crafting permission and panel book follow the new half',
    !P.canWork(state(tester), 'berserker', 'novice') && P.canWork(state(tester), 'hearthcook', 'novice') &&
    !P.canWork(state(tester), 'hearthcook', 'advanced') &&
    state(tester).panel.book.halves.some(h => h.key === 'hearthcook' && h.rank === 'novice'));
  yes(server + ': gear stays and a second starter kit is not handed out', JSON.stringify(w.row(tester).inventory) === inventory);
  const firstTree = JSON.stringify(state(tester).tree), firstPlaced = JSON.stringify(state(tester).placed);
  w.say(tester, '/setprofession smith platewright');
  w.say(tester, '/setprofession cook hearthcook');
  yes(server + ': switching back does not stack allocation or free points',
    JSON.stringify(state(tester).tree) === firstTree && JSON.stringify(state(tester).placed) === firstPlaced &&
    state(tester).points === 7 && JSON.stringify(w.row(tester).inventory) === inventory);
  yes(server + ': the successful action has a saved actor and target record',
    records().some(r => r.did === 'setprofession' && r.by === 1000 && r.who === 1000 && r.from === 'warrior' && r.to === 'cook'));
  for (const actor of [tester, staff]) {
    yes(server + ': a non-admin cannot change someone else\'s profession',
      denied(actor, '/setprofession cook hearthcook for Dagny Iron Hand', other));
  }
  yes(server + ': an ordinary account cannot change its profession', denied(other, '/setprofession cook hearthcook', other));
  w.say(admin, '/setprofession cook hearthcook for Dagny Iron Hand');
  yes(server + ': an admin can change a named character\'s profession', state(other).prof === 'cook');
  for (const text of ['/setprofession', '/setprofession thief', '/setprofession constructor x',
    '/setprofession smith constructor', '/setprofession smith hearthcook', '/setprofession mage destruction,destruction',
    '/setprofession mage destruction', '/setprofession cook hearthcook for', '/setprofession cook hearthcook for Nobody']) {
    yes(server + ': invalid input changes nothing: ' + text, denied(tester, text, tester));
  }
  const clean = P.clone(state(tester));
  for (const relation of [
    { masters: { confectioner: { id: other, name: 'Dagny', at: 1 } } },
    { apprentices: [{ id: other, half: 'hearthcook', name: 'Dagny' }] },
    { taught: ['platewright'] }
  ]) {
    C.writeState(tester, Object.assign(P.clone(clean), relation), true);
    const otherBefore = rules(other);
    yes(server + ': a current teaching relationship must end through its normal path',
      denied(tester, '/setprofession smith platewright', tester) && rules(other) === otherBefore);
  }
  C.writeState(tester, clean, true);
  const commit = box.mp.compareAndSetActorPropertyAndSpells;
  box.mp.compareAndSetActorPropertyAndSpells = function (id, profile, property) {
    if (id === tester) return false;
    return commit(id, profile, property);
  };
  try { yes(server + ': a rejected atomic commit changes neither profession nor audit', denied(tester, '/setprofession smith platewright', tester)); }
  finally { box.mp.compareAndSetActorPropertyAndSpells = commit; }
  const persisted = rules(tester);
  yes(server + ': the saved profession and effects survive restart', w.restart().loaded && rules(tester) === persisted);
  yes(server + ': no command, timer or missing engine method failed',
    w.faults.length === 0 && w.threw.length === 0 && Object.keys(w.missing).length === 0);
  w.done();
}
for (const server of ['dev', 'main']) {
  const w = standIn.world({ name: 'profession-knowledge-' + server, settings: {
    thornswoodServer: server, thornswoodPlaytesters: [1000]
  } });
  const actor = w.person(0xff006760, { profileId: 1000, name: 'Brenna' });
  yes(server + ': knowledge scenario loads the whole gamemode', w.boot());
  if (!w.loaded()) { w.done(); continue; }
  w.arrive(actor); w.run(30000);
  const box = w.box(), P = box.__thornswoodProgression, C = box.__thornswoodCharacter;
  const SS = box.__thornswoodStaffSpells;
  Object.values(P.SPELL_IDS).concat(Object.keys(SS.STAFF_SPELLS)).forEach(desc => w.record(desc, 'SPEL'));
  const blessing = 'abcd:Skyrim.esm';
  const blessingBytes = new Array(36).fill(0); blessingBytes[8] = 4;
  w.record(blessing, 'SPEL', { fields: [{ type: 'SPIT', data: blessingBytes }] });
  const spellId = name => w.idOf(P.SPELL_IDS[name]);
  const state = () => w.prop(actor, 'thornswoodCharacter');
  const snapshot = () => JSON.stringify([state(), w.spellsOf(actor)]);
  function seed(prof, choice, names, staff) {
    let s = P.pickClass(P.fresh(), 'miner').state;
    s = P.pickProfession(s, prof, choice).state;
    s.spells = s.spells || { points: 0, known: [] };
    s.spells.points = 0;
    s.spells.known = names.slice(); s.staffSpells = (staff || []).slice();
    if (prof === 'mage') s.ranks.destruction = 'expert';
    if (prof === 'enchanter') { s.ranks.bladebinder = 'expert'; s.staffPoints = 0; }
    C.writeState(actor, s, true);
    w.row(actor).learnedSpells = [...new Set(names.map(spellId).concat((staff || []).map(w.idOf), w.idOf(blessing)))];
  }
  seed('mage', ['destruction', 'restoration'], ['Flames', 'Firebolt', 'Healing', 'Sparks']);
  w.say(actor, '/setprofession cook hearthcook');
  yes(server + ': changing away preserves the whole learned book as history',
    state().spellHistory.spells.length === 4 && state().spellHistory.spells.includes('Firebolt'));
  yes(server + ': unavailable book spells leave the active book and engine together',
    state().spells.known.length === 0 && JSON.stringify(w.spellsOf(actor)) === JSON.stringify([w.idOf(blessing)]));
  w.say(actor, '/setprofession mage destruction,restoration');
  yes(server + ': switching back restores only eligible novice historical spells',
    state().spells.known.includes('Flames') && state().spells.known.includes('Healing') &&
    !state().spells.known.includes('Firebolt') && !w.spellsOf(actor).includes(spellId('Firebolt')));
  yes(server + ': returning to mage preserves its spent spell-point balance', state().spells.points === 0);
  w.say(actor, '/rankup profession destruction');
  yes(server + ': canonical rank advancement restores eligible higher-rank history',
    state().ranks.destruction === 'advanced' && state().spells.known.includes('Firebolt') &&
    w.spellsOf(actor).includes(spellId('Firebolt')) && w.spellsOf(actor).includes(w.idOf(blessing)));
  const novice = Object.keys(SS.STAFF_SPELLS).find(desc => SS.rankOf(desc) === 'novice');
  const advanced = Object.keys(SS.STAFF_SPELLS).find(desc => SS.rankOf(desc) === 'advanced');
  yes(server + ': actual staff catalogue has both tested ranks', !!novice && !!advanced);
  seed('enchanter', 'bladebinder', [], [novice, advanced]);
  w.say(actor, '/setprofession cook hearthcook');
  yes(server + ': staff spell history survives while its active unlocks leave',
    state().spellHistory.staffSpells.includes(advanced) && state().staffSpells.length === 0 &&
    !w.spellsOf(actor).includes(w.idOf(advanced)));
  w.say(actor, '/setprofession enchanter bladebinder');
  yes(server + ': enchanter novice restores only novice historical staff spells',
    state().staffSpells.includes(novice) && !state().staffSpells.includes(advanced));
  yes(server + ': returning to enchanter preserves its spent staff-point balance', state().staffPoints === 0);
  w.say(actor, '/rankup profession');
  yes(server + ': advancing enchanter restores historical staff spells at their rank',
    state().staffSpells.includes(advanced) && w.spellsOf(actor).includes(w.idOf(advanced)));
  seed('mage', ['destruction', 'restoration'], ['Flames', 'Frostbite', 'Sparks']);
  const outsider = P.clone(state()); outsider.untaught = ['destruction']; C.writeState(actor, outsider, true);
  let before = snapshot();
  w.say(actor, '/setprofession cook hearthcook');
  yes(server + ': three outsider candidates require an explicit choice with no mutation', snapshot() === before);
  w.say(actor, '/setprofession cook hearthcook spells Flames,Sparks');
  yes(server + ': explicit outsider choices activate at most two and retain the third in history',
    state().prof === 'cook' && state().spells.known.join(',') === 'Flames,Sparks' &&
    state().spellHistory.spells.includes('Frostbite') && !w.spellsOf(actor).includes(spellId('Frostbite')));
  const commit = box.mp.compareAndSetActorPropertyAndSpells;
  for (const fail of [false, 'throw', 'missing']) {
    before = snapshot();
    box.mp.compareAndSetActorPropertyAndSpells = fail === 'missing' ? undefined : function () {
      if (fail === 'throw') throw new Error('injected atomic validation failure');
      return false;
    };
    try { w.say(actor, '/setprofession smith platewright'); }
    finally { box.mp.compareAndSetActorPropertyAndSpells = commit; }
    yes(server + ': atomic ' + fail + ' leaves history, active spells and profession together', snapshot() === before);
  }
  for (const field of ['expectedRuntimeIdentity', 'expectedLifeGeneration', 'expectedSpells', 'expected']) {
    before = snapshot();
    box.mp.compareAndSetActorPropertyAndSpells = function (id, profile, property) {
      if (field === 'expectedRuntimeIdentity') property[field] = '999999999999';
      if (field === 'expectedLifeGeneration') property[field]++;
      if (field === 'expectedSpells') property[field] = [];
      if (field === 'expected') property[field] = null;
      return commit(id, profile, property);
    };
    try { w.say(actor, '/setprofession smith platewright'); }
    finally { box.mp.compareAndSetActorPropertyAndSpells = commit; }
    yes(server + ': stale ' + field + ' refuses with neither half of the state changed', snapshot() === before);
  }
  const maximal = w.person(0xff006761, { profileId: 1006, name: 'Catalogue reader' });
  let all = P.pickClass(P.fresh(), 'miner').state;
  all = P.pickProfession(all, 'cook', 'hearthcook').state;
  all.spellHistory = { spells: Object.keys(P.SPELL_IDS), staffSpells: Object.keys(SS.STAFF_SPELLS), points: { mage: 0, enchanter: 0 } };
  C.writeState(maximal, all, true);
  const maxState = w.prop(maximal, 'thornswoodCharacter');
  const maxBytes = Buffer.byteLength(JSON.stringify(maxState));
  console.log(server + ': complete catalogue history and full panel bytes=' + maxBytes);
  yes(server + ': complete book and staff catalogue history fits the bounded atomic property',
    C.writeSucceeded(maximal) && maxState.spellHistory.spells.length === all.spellHistory.spells.length && maxBytes < 1048576);
  const persisted = snapshot();
  const bytes = Buffer.byteLength(JSON.stringify(state()));
  console.log(server + ': representative history-bearing character bytes=' + bytes);
  yes(server + ': representative full panel fits the bounded atomic property', bytes < 1048576);
  const activeBefore = JSON.stringify([state().spells.known, state().staffSpells, state().spellHistory, w.spellsOf(actor)]);
  yes(server + ': restart keeps the selected active set and the full history', w.restart().loaded && snapshot() === persisted);
  w.arrive(actor); w.run(30000);
  yes(server + ': actual login does not grant inactive historical spells again',
    JSON.stringify([state().spells.known, state().staffSpells, state().spellHistory, w.spellsOf(actor)]) === activeBefore);
  yes(server + ': knowledge scenario has no command or timer faults', w.faults.length === 0 && w.threw.length === 0);
  w.done();
}
t.done();
