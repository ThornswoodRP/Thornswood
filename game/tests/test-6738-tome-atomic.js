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
  yes('the off-book descriptor survives restart while its native membership stays absent',
    w.restart().loaded && w.prop(seventh, C.PROPERTY).spellHistory.otherSpells.includes(offbook) &&
    !w.spellsOf(seventh).includes(w.idOf(offbook)) && w.spellsOf(seventh).includes(w.idOf(ability)));
}
w.done(); t.done();
