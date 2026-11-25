'use strict';
// #6737: class replacement through the real queued command and progression
// record. Only the class changes; repeated choices cannot stack bonuses.
const standIn = require('../../tests/stand-in-server.js');
const fs = require('fs'), path = require('path');
const t = standIn.checks(), yes = t.yes;

for (const server of ['dev', 'main']) {
  const w = standIn.world({ name: 'setclass-' + server, settings: {
    thornswoodServer: server, thornswoodPlaytesters: [1000],
    thornswoodDevs: [1002], thornswoodAdmins: [1004]
  } });
  const tester = w.person(0xff006740, { profileId: 1000, name: 'Brenna' });
  const staff = w.person(0xff006741, { profileId: 1002, name: 'Sera' });
  const admin = w.person(0xff006742, { profileId: 1004, name: 'Alva' });
  const other = w.person(0xff006743, { profileId: 1006, name: 'Dagny Iron Hand' });
  yes(server + ': the whole gamemode loads', w.boot());
  if (!w.loaded()) { w.done(); break; }
  [tester, staff, admin, other].forEach(w.arrive);
  w.run(30000);
  const box = w.box(), P = box.__thornswoodProgression, C = box.__thornswoodCharacter;
  function seed(actor) {
    let s = P.pickClass(P.fresh(), 'miner').state;
    s = P.pickProfession(s, 'warrior', 'berserker').state;
    s.ranks.miner = 'expert'; s.work.miner = 13;
    s.ranks.berserker = 'advanced'; s.work.berserker = 17;
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
  function command(actor, text) { w.say(actor, text); }
  function denied(actor, text, target) {
    const before = rules(target), n = records().length;
    command(actor, text);
    return before === rules(target) && records().length === n;
  }
  const inventory = JSON.stringify(w.row(tester).inventory);
  const original = state(tester);
  command(tester, '/setclass hunter');
  yes(server + ': queued self class change selects the new class at novice',
    state(tester).cls === 'hunter' && state(tester).ranks.hunter === 'novice');
  if (state(tester).cls !== 'hunter') { w.done(); break; }
  yes(server + ': old class standing and work leave the saved record',
    !Object.hasOwn(state(tester).ranks, 'miner') && !Object.hasOwn(state(tester).work, 'miner'));
  yes(server + ': spent points and profession progress are preserved',
    state(tester).tree.might - state(tester).placed.might === 2 && state(tester).points === 7 &&
    state(tester).ranks.berserker === 'advanced' && state(tester).work.berserker === 17);
  yes(server + ': old class effects leave and the new class effect appears in the panel',
    state(tester).tree.might === 4 && state(tester).placed.might === 2 &&
    state(tester).tree.precision === 1 && state(tester).panel.class === 'hunter');
  yes(server + ': inventory is unchanged, with no repeat starter kit', JSON.stringify(w.row(tester).inventory) === inventory);
  yes(server + ': gathering permissions follow the new class immediately',
    P.canDo(state(tester), 'loot') && !P.canDo(state(tester), 'mine'));
  const roleHelp = box.__thornswoodCommandTools;
  yes(server + ': playtest help lists self setclass, and admin help adds targeting',
    roleHelp.help('playtester').filter(h => h.word === '/setclass').every(h => !h.syntax.includes('for <person>')) &&
    roleHelp.help('admin').some(h => h.word === '/setclass' && h.syntax.includes('for <person>')));
  command(tester, '/setclass miner');
  command(tester, '/setclass hunter');
  command(tester, '/setclass miner');
  yes(server + ': repeated A to B to A does not stack points or placement bonuses',
    state(tester).points === original.points && JSON.stringify(state(tester).tree) === JSON.stringify(original.tree) &&
    JSON.stringify(state(tester).placed) === JSON.stringify(original.placed) &&
    state(tester).ranks.miner === 'novice' && JSON.stringify(w.row(tester).inventory) === inventory);
  yes(server + ': the successful change is recorded with old and new classes',
    records().some(r => r.did === 'setclass' && r.by === 1000 && r.who === 1000 && r.from === 'miner' && r.to === 'hunter'));
  for (const actor of [tester, staff]) {
    yes(server + ': a non-admin cannot change another character\'s class', denied(actor, '/setclass hunter for Dagny Iron Hand', other));
  }
  yes(server + ': an ordinary account cannot change its own class', denied(other, '/setclass hunter', other));
  command(admin, '/setclass farmer for Dagny Iron Hand');
  yes(server + ': an admin can change another named character\'s class', state(other).cls === 'farmer');
  for (const text of ['/setclass', '/setclass constructor', '/setclass __proto__', '/setclass thief',
    '/setclass hunter extra', '/setclass hunter for', '/setclass hunter for Nobody']) {
    yes(server + ': invalid input changes nothing: ' + text, denied(tester, text, tester));
  }
  yes(server + ': selecting the current class does not grant anything', denied(tester, '/setclass miner', tester));

  const module = box.__thornswoodStaffProgression;
  const saved = rules(tester), count = records().length;
  module.command({ proven: false }, '/setclass', ['/setclass', 'hunter'], 1000, tester);
  yes(server + ': a missing connection proof cannot change class', rules(tester) === saved && records().length === count);
  const pass = box.__thornswoodPassSeen.passes[1000];
  delete box.__thornswoodPassSeen.passes[1000];
  module.command({ proven: true }, '/setclass', ['/setclass', 'hunter'], 1000, tester);
  yes(server + ': a missing launcher pass cannot change class', rules(tester) === saved && records().length === count);
  box.__thornswoodPassSeen.passes[1000] = pass;

  const set = box.mp.set;
  box.mp.set = function (id, key, value) {
    if (id === tester && key === 'thornswoodCharacter') throw new Error('fixture: character write refused');
    return set(id, key, value);
  };
  try { yes(server + ': a failed saved-property write leaves the class and audit unchanged', denied(tester, '/setclass hunter', tester)); }
  finally { box.mp.set = set; }
  const write = C.writeState;
  C.writeState = function () { throw new Error('fixture: atomic history save refused'); };
  try {
    const heard = w.heard(tester).length;
    yes(server + ': a thrown history save is refused before class feedback or audit',
      denied(tester, '/setclass hunter', tester) &&
      w.heardSince(tester, heard).some(line => /could not be saved/.test(line)));
  } finally { C.writeState = write; }

  let mage = P.pickClass(P.fresh(), 'miner').state;
  mage = P.pickProfession(mage, 'mage', ['destruction', 'restoration']).state;
  mage = P.creditWork(mage, 'destruction', null, 100).state;
  C.writeState(tester, mage, true);
  const spells = JSON.stringify(state(tester).spells), schools = JSON.stringify(state(tester).schools);
  command(tester, '/setclass gatherer');
  yes(server + ': class replacement preserves mage school ranks and spell points',
    state(tester).cls === 'gatherer' && state(tester).ranks.destruction === 'advanced' &&
    state(tester).ranks.restoration === 'novice' && JSON.stringify(state(tester).spells) === spells &&
    JSON.stringify(state(tester).schools) === schools);
  const persisted = rules(tester);
  yes(server + ': the saved class and effects survive restart', w.restart().loaded && rules(tester) === persisted);
  yes(server + ': no command, timer or missing engine method failed',
    w.faults.length === 0 && w.threw.length === 0 && Object.keys(w.missing).length === 0);
  w.done();
}
t.done();
