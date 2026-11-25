'use strict';
/*
  Scenario: systems/testing-progression.md
*/
// #6736: real progression, character storage and role/proof checks over the
// whole gamemode. A test rank grants the same rewards as normal progression.
const standIn = require('../../tests/stand-in-server.js');
const fs = require('fs');
const path = require('path');
const t = standIn.checks();
const yes = t.yes;

for (const server of ['dev', 'main']) {
  const w = standIn.world({ name: 'rankup-' + server, settings: {
    thornswoodServer: server, thornswoodPlaytesters: [1000],
    thornswoodDevs: [1002], thornswoodAdmins: [1004]
  } });
  const tester = w.person(0xff006736, { profileId: 1000, name: 'Brenna' });
  const staff = w.person(0xff006737, { profileId: 1002, name: 'Sera' });
  const admin = w.person(0xff006738, { profileId: 1004, name: 'Alva' });
  const other = w.person(0xff006739, { profileId: 1006, name: 'Dagny Iron Hand' });
  yes(server + ': the whole gamemode loads', w.boot());
  if (!w.loaded()) { w.done(); break; }
  [tester, staff, admin, other].forEach(w.arrive);
  w.run(30000);
  const box = w.box(), P = box.__thornswoodProgression, C = box.__thornswoodCharacter;
  function seed(actor, profession, half) {
    let s = P.pickClass(P.fresh(), 'miner').state;
    if (profession) s = P.pickProfession(s, profession, half).state;
    C.writeState(actor, s, true);
    return C.stateOf(actor);
  }
  function state(actor) { return w.prop(actor, 'thornswoodCharacter'); }
  function records() {
    const file = path.join(w.dir, 'for-bot', 'moderation.log');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  }
  function audit() { return records().filter(r => r.did === 'rankup').length; }
  function command(actor, text, proof, callerActor) {
    if (proof === undefined && callerActor === undefined) { w.say(actor, text); return true; }
    const pid = w.row(actor).profileId;
    const module = box.__thornswoodStaffProgression;
    return !!module && module.command({ proven: proof !== false }, '/rankup',
      text.split(/\s+/), pid, callerActor === undefined ? actor : callerActor);
  }
  function unchanged(actor, text, target, proof, callerActor) {
    function rules() { const s = state(target); delete s.panel; delete s.asked; return JSON.stringify(s); }
    const before = rules(), count = audit();
    command(actor, text, proof, callerActor);
    return rules() === before && audit() === count;
  }
  const partial = seed(tester, 'enchanter', 'bladebinder');
  partial.work.miner = 37;
  C.writeState(tester, partial, true);
  seed(staff, 'smith', 'platewright');
  seed(admin, 'smith', 'platewright');
  seed(other, 'smith', 'platewright');

  command(tester, '/rankup class');
  yes(server + ': self class advances one step with its point and fresh panel',
    state(tester).ranks.miner === 'advanced' && state(tester).points === 1 &&
    state(tester).work.miner === 0 && state(tester).panel.ranks.miner === 'advanced');
  if (!box.__thornswoodStaffProgression) { w.done(); break; }

  command(tester, '/rankup profession');
  yes(server + ': current half advances with staff-spell points and recipe unlock view',
    state(tester).ranks.bladebinder === 'advanced' && state(tester).staffPoints === 3 &&
    state(tester).points === 2 && state(tester).panel.book.halves.some(h =>
      h.key === 'bladebinder' && h.rank === 'advanced'));
  yes(server + ': the action is recorded once per successful request', audit() === 2);
  yes(server + ': the saved record names who changed whose rank and the exact step',
    records().some(r => r.did === 'rankup' && r.by === 1000 && r.who === 1000 &&
      r.key === 'bladebinder' && r.from === 'novice' && r.to === 'advanced'));
  const helpAt = w.heard(tester).length;
  w.say(tester, '/testhelp');
  yes(server + ': implemented rankup syntax is discoverable through queued test help',
    w.heardSince(tester, helpAt).some(line => line.includes('/rankup class|profession')));
  const roleHelp = box.__thornswoodCommandTools;
  yes(server + ': playtest help lists self rankup, and admin help adds targeting',
    roleHelp.help('playtester').filter(h => h.word === '/rankup').every(h => !h.syntax.includes('for <person>')) &&
    roleHelp.help('admin').some(h => h.word === '/rankup' && h.syntax.includes('for <person>')));

  for (const actor of [tester, staff]) {
    yes(server + ': a non-admin cannot advance another character',
      unchanged(actor, '/rankup class for Dagny Iron Hand', other));
  }
  yes(server + ': an ordinary account cannot advance itself', unchanged(other, '/rankup class', other));
  yes(server + ': missing chat proof cannot advance a rank', unchanged(tester, '/rankup class', tester, false));
  const pass = box.__thornswoodPassSeen.passes[1000];
  delete box.__thornswoodPassSeen.passes[1000];
  yes(server + ': missing launcher pass cannot advance a rank', unchanged(tester, '/rankup class', tester));
  box.__thornswoodPassSeen.passes[1000] = pass;
  box.__thornswoodPassSeen.passes[1000] = Object.assign({}, pass, { x: box.Date.now() - 1 });
  yes(server + ': an expired launcher pass cannot advance a rank', unchanged(tester, '/rankup class', tester));
  box.__thornswoodPassSeen.passes[1000] = pass;
  yes(server + ': another actor cannot be supplied for the caller',
    unchanged(tester, '/rankup class', tester, true, other));

  command(admin, '/rankup class for Dagny Iron Hand');
  yes(server + ': an admin can advance a named online character', state(other).ranks.miner === 'advanced');
  command(admin, '/rankup profession for Dagny Iron Hand');
  yes(server + ': an admin can advance that character\'s current profession half',
    state(other).ranks.platewright === 'advanced');
  w.leave(other);
  yes(server + ': an offline target is refused', unchanged(admin, '/rankup class for Dagny Iron Hand', other));
  w.arrive(other);
  command(tester, '/rankup class for Brenna');
  yes(server + ': naming yourself still uses self permission', state(tester).ranks.miner === 'expert');
  command(tester, '/rankup class');
  yes(server + ': the next call reaches master, one rank at a time', state(tester).ranks.miner === 'master');
  yes(server + ': master refuses further advancement and records no action', unchanged(tester, '/rankup class', tester));
  command(tester, '/rankup profession');
  command(tester, '/rankup profession');
  yes(server + ': Master Bladebinder grants its spell points and profession perk together',
    state(tester).ranks.bladebinder === 'master' && state(tester).staffPoints === 6 &&
    state(tester).panel.perks.includes('twinsouls') && state(tester).panel.ranks.bladebinder === 'master');

  for (const text of ['/rankup', '/rankup miner', '/rankup class 3', '/rankup class for',
    '/rankup class for Nobody', '/rankup class for Brenna extra', '/rankup profession constructor']) {
    yes(server + ': malformed or unsupported request changes nothing: ' + text,
      unchanged(tester, text, tester));
  }
  seed(tester);
  yes(server + ': no profession cannot create a profession rank', unchanged(tester, '/rankup profession', tester));
  C.writeState(tester, P.fresh(), true);
  yes(server + ': no class cannot create a class rank', unchanged(tester, '/rankup class', tester));
  const legacy = seed(tester);
  delete legacy.ranks.miner;
  C.writeState(tester, legacy, true);
  command(tester, '/rankup class');
  yes(server + ': a legacy class without standing uses the canonical novice migration',
    state(tester).ranks.miner === 'advanced' && state(tester).points === 1);

  seed(tester, 'smith', 'platewright');
  const set = box.mp.set;
  box.mp.set = function (id, key, value) {
    if (id === tester && key === 'thornswoodCharacter') throw new Error('fixture: character write refused');
    return set(id, key, value);
  };
  try {
    const heard = w.heard(tester).length;
    yes(server + ': a refused character write does not advance or audit a rank',
      unchanged(tester, '/rankup class', tester) &&
      w.heardSince(tester, heard).some(line => /could not be saved/.test(line)));
  } finally { box.mp.set = set; }
  const write = C.writeState;
  C.writeState = function () { throw new Error('fixture: atomic history CAS refused'); };
  try {
    const heard = w.heard(tester).length;
    yes(server + ': a thrown history save is refused before rank feedback or audit',
      unchanged(tester, '/rankup class', tester) &&
      w.heardSince(tester, heard).some(line => /could not be saved/.test(line)));
  } finally { C.writeState = write; }

  seed(tester, 'mage', ['destruction', 'restoration']);
  yes(server + ': mage profession without a school is refused', unchanged(tester, '/rankup profession', tester));
  yes(server + ': an unchosen school is refused', unchanged(tester, '/rankup profession illusion', tester));
  command(tester, '/rankup profession destruction');
  yes(server + ': a chosen mage school advances with its spell and skill points',
    state(tester).ranks.destruction === 'advanced' && state(tester).ranks.restoration === 'novice' &&
    state(tester).spells.points === 3 && state(tester).points === 1);
  command(tester, '/rankup profession destruction');
  const beforeMaster = state(tester).spells.points;
  command(tester, '/rankup profession destruction');
  yes(server + ': mage master rewards and third-school eligibility stay canonical',
    state(tester).ranks.destruction === 'master' && state(tester).spells.points === beforeMaster + 2 &&
    P.pickThirdSchool(state(tester), 'illusion').ok);

  let s = seed(tester, 'mage', ['destruction', 'restoration']);
  s.work.destruction = 99; s.work.restoration = 99;
  C.writeState(tester, s, true);
  const expected = P.creditWork(s, 'miner', null, P.workNeeded(s, 'miner'));
  command(tester, '/rankup class');
  yes(server + ': normal cross-school rewards match the canonical progression result',
    JSON.stringify(state(tester).ranks) === JSON.stringify(expected.state.ranks) &&
    state(tester).points === expected.state.points && state(tester).spells.points === expected.state.spells.points);

  const saved = JSON.stringify({ ranks: state(tester).ranks, points: state(tester).points, spells: state(tester).spells });
  yes(server + ': restart reloads the saved ranks and unlock points', w.restart().loaded &&
    JSON.stringify({ ranks: state(tester).ranks, points: state(tester).points, spells: state(tester).spells }) === saved);
  yes(server + ': no command or timer threw', w.faults.length === 0 && w.threw.length === 0);
  yes(server + ': no missing engine method was used', Object.keys(w.missing).length === 0);
  w.done();
}
t.done();
