'use strict';
// The whole gamemode's actual onReadBook handler runs before the stand-in's
// native book action. Source contract: ReadBookEvent.cpp OnFireSuccess checks
// IsSpellLearned before AddSpell; MpActor::OnEquip consumes only SpellLearned.
// A knowledge CAS that pre-adds the spell therefore prevents native spending.
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '6738-native-owned-tome' });
yes('whole gamemode loads', w.boot());
if (w.loaded()) {
  const box = w.box(), P = box.__thornswoodProgression, C = box.__thornswoodCharacter;
  const flames = P.SPELL_IDS.Flames, book = '9cd51:Skyrim.esm';
  w.record(flames, 'SPEL');
  w.record(book, 'BOOK', { fields: [{ type: 'DATA', data: {
    bytes: [4, 0, 0, 0, 0, 0, 0, 0, 0xee, 2, 0, 0, 0, 0, 128, 63], refs: { 4: flames }
  } }] });
  function student(n) {
    const actor = w.person(0xff006770 + n, { profileId: 1000 + n, name: 'Learner ' + n });
    let s = P.pickClass(P.fresh(), 'miner').state;
    s = P.pickProfession(s, 'mage', ['destruction', 'restoration']).state;
    C.writeState(actor, P.captureKnowledge(s), true);
    w.give(actor, w.idOf(book), 1);
    return actor;
  }
  const first = student(0);
  const read = box.__thornswoodTomes.read;
  box.__thornswoodTomes.read = function () { throw new Error('injected record read failure'); };
  let refused;
  try { refused = w.readBook(first, w.idOf(book)); }
  finally { box.__thornswoodTomes.read = read; }
  yes('a thrown tome read fails closed before the native action',
    refused.allowed === false && w.count(first, w.idOf(book)) === 1 && w.spellsOf(first).length === 0);
  const second = student(1), before = JSON.stringify(w.prop(second, C.PROPERTY));
  const set = box.mp.set;
  box.mp.set = function (id, key, value) {
    if (id === second && key === C.PROPERTY) throw new Error('injected tome state save failure');
    return set(id, key, value);
  };
  try { refused = w.readBook(second, w.idOf(book)); }
  finally { box.mp.set = set; }
  yes('a failed tome state save preserves the book, points, history and engine spells',
    refused.allowed === false && w.count(second, w.idOf(book)) === 1 && w.spellsOf(second).length === 0 &&
    JSON.stringify(w.prop(second, C.PROPERTY)) === before);
  const third = student(2);
  const result = w.readBook(third, w.idOf(book));
  const saved = w.prop(third, C.PROPERTY);
  yes('native ReadBookEvent still owns learning and consuming a successful tome',
    result.allowed !== false && result.learned === true && w.count(third, w.idOf(book)) === 0 &&
    w.spellsOf(third).includes(w.idOf(flames)));
  yes('successful canonical learning saves its point and historical knowledge',
    saved.spells.points === 1 && saved.spells.known.includes('Flames') && saved.spellHistory.spells.includes('Flames'));
  w.record(P.SPELL_IDS.Firebolt, 'SPEL');
  const fourth = student(3);
  let nearRank = P.clone(C.stateOf(fourth));
  nearRank.work.destruction = P.workNeeded(nearRank, 'destruction') - 1;
  nearRank.spellHistory.spells.push('Firebolt');
  const SS = box.__thornswoodStaffSpells;
  const staffDesc = Object.keys(SS.STAFF_SPELLS).find(desc => SS.rankOf(desc) === 'novice');
  w.record(staffDesc, 'SPEL');
  nearRank.taught.push('bladebinder'); nearRank.ranks.bladebinder = 'novice'; nearRank.staffSpells = [staffDesc];
  const blessing = 'abcd:Skyrim.esm';
  const blessingBytes = new Array(36).fill(0); blessingBytes[8] = 4;
  w.record(blessing, 'SPEL', { fields: [{ type: 'SPIT', data: blessingBytes }] });
  w.row(fourth).learnedSpells.push(w.idOf(blessing));
  C.writeState(fourth, nearRank, true);
  const climbed = w.readBook(fourth, w.idOf(book));
  yes('a canonical tome may raise rank while preserved higher-rank knowledge becomes eligible',
    climbed.allowed !== false && climbed.learned && w.count(fourth, w.idOf(book)) === 0 &&
    C.stateOf(fourth).ranks.destruction === 'advanced');
  function membershipMatches(actor) {
    const s = C.stateOf(actor);
    const expected = [...new Set(s.spells.known.map(name => w.idOf(P.SPELL_IDS[name])).concat(s.staffSpells.map(w.idOf), w.idOf(blessing)))].sort((a, b) => a - b);
    return JSON.stringify(w.spellsOf(actor).sort((a, b) => a - b)) === JSON.stringify(expected);
  }
  yes('immediately after the native tome event active book, staff and engine sets agree',
    membershipMatches(fourth) && !C.stateOf(fourth).spells.known.includes('Firebolt') &&
    C.stateOf(fourth).spellHistory.spells.includes('Firebolt'));
  C.writeState(fourth, C.stateOf(fourth));
  yes('the next atomic refresh restores additionally eligible historical knowledge',
    C.stateOf(fourth).spells.known.includes('Firebolt') &&
    w.spellsOf(fourth).includes(w.idOf(P.SPELL_IDS.Firebolt)) && membershipMatches(fourth));
  const fifth = student(4);
  let outside = P.pickProfession(P.pickClass(P.fresh(), 'miner').state, 'cook', 'hearthcook').state;
  const teacher = P.pickProfession(P.fresh(), 'mage', ['destruction', 'restoration']).state;
  teacher.ranks.destruction = 'master';
  outside = P.teach(outside, teacher, 'destruction').state;
  outside.spells = { points: 1, known: [] };
  outside.spellSelections = { spells: [] }; outside = P.captureKnowledge(outside);
  C.writeState(fifth, outside, true);
  const learnedOutside = w.readBook(fifth, w.idOf(book));
  yes('normal eligible outsider learning updates its selected active place',
    learnedOutside.allowed !== false && learnedOutside.learned && C.stateOf(fifth).spells.known.includes('Flames'));
  const sixth = student(5), invalid = P.clone(C.stateOf(sixth));
  invalid.spells.known.push('Firebolt');
  let rejected = false;
  try { C.writeTomeState(sixth, invalid); } catch (_) { rejected = true; }
  yes('the native-owned save seam refuses a spell above the current rank', rejected && !C.stateOf(sixth).spells.known.includes('Firebolt'));
  const ai = box.mp.getNpcAIState;
  box.mp.getNpcAIState = function (id) { return Object.assign({}, ai(id), { runtimeLifeIdentity: '999999999999' }); };
  let currentRuntime = false;
  try { C.writeState(sixth, C.stateOf(sixth)); currentRuntime = true; } catch (_) { }
  finally { box.mp.getNpcAIState = ai; }
  yes('atomic writes use the current runtime token even when a body life token differs', currentRuntime);
  let balance = P.pickProfession(P.fresh(), 'cook', 'hearthcook').state;
  balance.spells = { points: 1, known: [] };
  balance = P.setProfessionForTesting(balance, 'mage', ['destruction', 'restoration']).state;
  yes('the first visit to Mage grants its canonical starting balance once', balance.spells.points === P.TABLE.limits.mageStartSpells);
  balance.spells.points = 0;
  balance = P.setProfessionForTesting(balance, 'cook', 'hearthcook').state;
  yes('returning to a non-mage profession preserves its earned outsider spell points', balance.spells && balance.spells.points === 1);
  balance = P.setProfessionForTesting(balance, 'mage', ['destruction', 'restoration']).state;
  yes('returning to Mage still keeps the spent balance at zero', balance.spells.points === 0);
  function typedSpell(desc, type) {
    const bytes = new Array(36).fill(0); bytes[8] = type;
    w.record(desc, 'SPEL', { fields: [{ type: 'SPIT', data: bytes }] });
  }
  const seventh = student(6), offbook = 'abc1:Skyrim.esm', ability = 'abc2:Skyrim.esm';
  typedSpell(offbook, 0); typedSpell(ability, 4);
  w.row(seventh).learnedSpells = [w.idOf(offbook), w.idOf(ability)];
  C.writeState(seventh, C.stateOf(seventh));
  yes('authoritative refresh removes off-book ordinary spells while preserving unrelated abilities',
    !w.spellsOf(seventh).includes(w.idOf(offbook)) && w.spellsOf(seventh).includes(w.idOf(ability)) &&
    C.stateOf(seventh).spellHistory.otherSpells.includes(offbook));
  const afterSwitch = P.setProfessionForTesting(C.stateOf(seventh), 'cook', 'hearthcook');
  C.writeState(seventh, afterSwitch.state);
  yes('off-book ordinary knowledge survives a profession change without becoming active',
    C.stateOf(seventh).spellHistory.otherSpells.includes(offbook) && !w.spellsOf(seventh).includes(w.idOf(offbook)));
  const eighth = student(7), unreadable = 'abc3:Skyrim.esm';
  w.record(unreadable, 'SPEL'); w.row(eighth).learnedSpells = [w.idOf(unreadable)];
  const unreadBefore = JSON.stringify([C.stateOf(eighth), w.spellsOf(eighth)]);
  let unreadRefused = false;
  try { C.writeState(eighth, C.stateOf(eighth)); } catch (_) { unreadRefused = true; }
  yes('an unreadable unrelated spell refuses before knowledge or active membership changes',
    unreadRefused && JSON.stringify([C.stateOf(eighth), w.spellsOf(eighth)]) === unreadBefore);
  const ninth = student(8), perks = P.perks;
  let publicationThrown = false;
  P.perks = function (s) {
    if (!publicationThrown && C.stateOf(ninth).spells.known.includes('Flames')) {
      publicationThrown = true;
      throw new Error('injected post-save menu publication failure');
    }
    return perks(s);
  };
  let publishThrew = false;
  let completedRead;
  try { completedRead = w.readBook(ninth, w.idOf(book)); } catch (_) { publishThrew = true; }
  finally { P.perks = perks; }
  yes('a menu publication error after the saved book does not turn committed learning into refusal',
    publicationThrown && !publishThrew && completedRead && completedRead.allowed !== false && completedRead.learned &&
    w.count(ninth, w.idOf(book)) === 0 && C.stateOf(ninth).spells.points === 1 &&
    w.spellsOf(ninth).includes(w.idOf(flames)) && C.writeSucceeded(ninth));
  const tenth = student(9), inheritedAbility = 'abc4:Skyrim.esm';
  typedSpell(inheritedAbility, 4);
  w.row(tenth).learnedSpells = [w.idOf(inheritedAbility)];
  w.row(tenth).inheritedSpells = [w.idOf(inheritedAbility)];
  const self = { type: 'form', desc: w.descOf(tenth) };
  yes('Papyrus enumeration filters explicitly stored inherited entries while the full snapshot retains them',
    box.mp.callPapyrusFunction('method', 'Actor', 'GetSpellCount', self, []) === 0 &&
    box.mp.getActorLearnedSpells(tenth).includes(w.idOf(inheritedAbility)));
  let inheritedSaved = false;
  try {
    C.writeState(tenth, P.setProfessionForTesting(C.stateOf(tenth), 'cook', 'hearthcook').state);
    inheritedSaved = true;
  } catch (_) { }
  yes('profession switching preserves explicitly stored inherited abilities using the full CAS snapshot',
    inheritedSaved && C.stateOf(tenth).prof === 'cook' && w.spellsOf(tenth).includes(w.idOf(inheritedAbility)));
  const fullList = box.mp.getActorLearnedSpells;
  const invalidLists = [null, {}, [0], [1.5], [0xff000001], [w.idOf(inheritedAbility), w.idOf(inheritedAbility)], new Array(4097).fill(w.idOf(inheritedAbility))];
  for (let i = 0; i < invalidLists.length; i++) {
    const beforeInvalid = JSON.stringify([C.stateOf(tenth), w.spellsOf(tenth)]);
    box.mp.getActorLearnedSpells = function () { return invalidLists[i]; };
    let invalidRefused = false;
    try { C.writeState(tenth, C.stateOf(tenth)); } catch (_) { invalidRefused = true; }
    finally { box.mp.getActorLearnedSpells = fullList; }
    yes('malformed full spell snapshot ' + i + ' refuses without mutating either state',
      invalidRefused && JSON.stringify([C.stateOf(tenth), w.spellsOf(tenth)]) === beforeInvalid);
  }
  box.mp.getActorLearnedSpells = undefined;
  let missingListRefused = false;
  try { C.writeState(tenth, C.stateOf(tenth)); } catch (_) { missingListRefused = true; }
  finally { box.mp.getActorLearnedSpells = fullList; }
  yes('a missing full-list binding refuses without a Papyrus fallback', missingListRefused);
  const eleventh = student(10), fireboltBook = 'a26fd:Skyrim.esm';
  w.record(fireboltBook, 'BOOK', { fields: [{ type: 'DATA', data: {
    bytes: [4, 0, 0, 0, 0, 0, 0, 0, 0xee, 2, 0, 0, 0, 0, 128, 63], refs: { 4: P.SPELL_IDS.Firebolt }
  } }] });
  let latent = P.clone(C.stateOf(eleventh));
  latent.work.destruction = P.workNeeded(latent, 'destruction') - 1;
  latent.spellHistory.spells.push('Firebolt');
  C.writeState(eleventh, latent);
  w.readBook(eleventh, w.idOf(book));
  const pointsBeforeHistoryRead = C.stateOf(eleventh).spells.points;
  w.give(eleventh, w.idOf(fireboltBook), 1);
  w.readBook(eleventh, w.idOf(fireboltBook));
  yes('reading a newly eligible historical spell does not spend its point or tome again',
    C.stateOf(eleventh).spells.points === pointsBeforeHistoryRead &&
    w.count(eleventh, w.idOf(fireboltBook)) === 1 &&
    C.stateOf(eleventh).spells.known.includes('Firebolt') && w.spellsOf(eleventh).includes(w.idOf(P.SPELL_IDS.Firebolt)));
  const twelfth = student(11);
  let stillLatent = P.clone(C.stateOf(twelfth));
  stillLatent.work.destruction = P.workNeeded(stillLatent, 'destruction') - 1;
  stillLatent.spellHistory.spells.push('Firebolt'); C.writeState(twelfth, stillLatent);
  w.readBook(twelfth, w.idOf(book)); w.give(twelfth, w.idOf(fireboltBook), 1);
  const beforeFailedRefresh = JSON.stringify([C.stateOf(twelfth), w.spellsOf(twelfth)]);
  const heardBeforeRefresh = w.heard(twelfth).length;
  const atomic = box.mp.compareAndSetActorPropertyAndSpells;
  box.mp.compareAndSetActorPropertyAndSpells = function () { return false; };
  let failedRefresh;
  try { failedRefresh = w.readBook(twelfth, w.idOf(fireboltBook)); }
  finally { box.mp.compareAndSetActorPropertyAndSpells = atomic; }
  yes('a failed retained-knowledge refresh refuses before spending the book or points',
    failedRefresh.allowed === false && w.count(twelfth, w.idOf(fireboltBook)) === 1 &&
    JSON.stringify([C.stateOf(twelfth), w.spellsOf(twelfth)]) === beforeFailedRefresh &&
    w.heardSince(twelfth, heardBeforeRefresh).some(line => /could not be learned safely/.test(line)));
  yes('the off-book descriptor survives restart while its native membership stays absent',
    w.restart().loaded && w.prop(seventh, C.PROPERTY).spellHistory.otherSpells.includes(offbook) &&
    !w.spellsOf(seventh).includes(w.idOf(offbook)) && w.spellsOf(seventh).includes(w.idOf(ability)));
}
w.done(); t.done();
