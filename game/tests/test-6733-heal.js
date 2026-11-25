'use strict';
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
for (const server of ['dev', 'main']) {
  const w = standIn.world({ name: '6733-heal-' + server, settings: {
    thornswoodServer: server, thornswoodAdmins: [301], thornswoodDevs: [302], thornswoodPlaytesters: [303]
  } });
  const actors = [301, 302, 303].map((profileId, i) => w.person(0xff006331 + i, {
    profileId, name: ['Admin', 'Staff', 'Tester'][i], cell: '3c:Skyrim.esm', pos: [1000 + i * 100, 0, 0]
  }));
  const [ADMIN, STAFF, TESTER] = actors;
  yes(server + ': whole gamemode loads', w.boot());
  if (!w.loaded()) { w.done(); continue; }
  actors.forEach(w.arrive);
  w.run(30000);
  function drain(actor) { w.row(actor).percentages = { health: 0.3, magicka: 0.2, stamina: 0.1 }; }
  function ask(actor, command) {
    const before = w.heard(actor).length;
    w.say(actor, command);
    return w.heardSince(actor, before).join('\n');
  }
  function full(actor) { const p = w.row(actor).percentages; return p.health === 1 && p.magicka === 1 && p.stamina === 1; }
  drain(TESTER);
  const character = JSON.stringify(w.row(TESTER).thornswoodCharacter);
  const inventory = JSON.stringify(w.row(TESTER).inventory);
  const injury = JSON.stringify(w.row(TESTER).thornswoodInjury);
  yes(server + ': a playtester can restore their own vitals through chat',
    /restored/i.test(ask(TESTER, '/heal')) && full(TESTER));
  yes(server + ': healing preserves character progression, equipment and injury decisions',
    JSON.stringify(w.row(TESTER).thornswoodCharacter) === character &&
    JSON.stringify(w.row(TESTER).inventory) === inventory && JSON.stringify(w.row(TESTER).thornswoodInjury) === injury);
  drain(ADMIN);
  yes(server + ': a playtester cannot heal someone else',
    /not yours/.test(ask(TESTER, '/heal for Admin')) && !full(ADMIN));
  yes(server + ': a non-admin staff member cannot heal someone else',
    /not yours/.test(ask(STAFF, '/heal for Admin')) && !full(ADMIN));
  drain(TESTER);
  yes(server + ': an admin can heal another online character',
    /restored/i.test(ask(ADMIN, '/heal for Tester')) && full(TESTER));
  drain(TESTER);
  const beforeInvalid = JSON.stringify(w.row(TESTER).percentages);
  yes(server + ': an incomplete targeted command cannot heal the caller by accident',
    /Usage:/.test(ask(TESTER, '/heal for')) && JSON.stringify(w.row(TESTER).percentages) === beforeInvalid);
  const logs = w.logged(/staff: .* heal /);
  yes(server + ': successful healing records the actor and target', logs.length === 2 && logs.some(line => /Admin.*Tester/.test(line)));
  w.row(TESTER).isDead = true;
  yes(server + ': healing cannot reverse death', /dead|wake/i.test(ask(ADMIN, '/heal for Tester')) && !full(TESTER));
  w.row(TESTER).isDead = false;
  const oldSet = w.box().mp.set;
  w.box().mp.set = function (id, key, value) { if (id === TESTER && key === 'percentages') throw new Error('rejected write'); return oldSet(id, key, value); };
  const auditBefore = w.logged(/staff: .* heal /).length;
  yes(server + ': a refused engine write cannot report a successful heal',
    /could not.*confirm/i.test(ask(ADMIN, '/heal for Tester')) && !full(TESTER) && w.logged(/staff: .* heal /).length === auditBefore);
  w.box().mp.set = oldSet;
  w.box().mp.set = function (id, key, value) { if (id === TESTER && key === 'percentages') return; return oldSet(id, key, value); };
  yes(server + ': a silently ignored native write cannot report or audit a successful heal',
    /could not.*confirm/i.test(ask(ADMIN, '/heal for Tester')) && !full(TESTER) && w.logged(/staff: .* heal /).length === auditBefore);
  w.box().mp.set = oldSet;
  {
    const heal = w.box().__thornswoodHeal;
    const before = JSON.stringify(w.row(TESTER).percentages);
    const otherBefore = JSON.stringify(w.row(ADMIN).percentages);
    const said = w.heard(TESTER).length;
    heal.command({ proven: false }, '/heal', ['/heal'], 303, TESTER);
    yes(server + ': an unproven direct call cannot bypass the handler boundary',
      JSON.stringify(w.row(TESTER).percentages) === before && /proved who you are/.test(w.heardSince(TESTER, said).join('\n')));
    heal.command({ proven: true }, '/heal', ['/heal'], 303, ADMIN);
    yes(server + ': a caller cannot substitute someone else\'s actor',
      JSON.stringify(w.row(TESTER).percentages) === before && JSON.stringify(w.row(ADMIN).percentages) === otherBefore);
    const pass = w.box().__thornswoodPassSeen.passes[303];
    delete w.box().__thornswoodPassSeen.passes[303];
    yes(server + ': a missing launcher pass cannot heal',
      /launcher.*pass/.test(ask(TESTER, '/heal')) && JSON.stringify(w.row(TESTER).percentages) === before);
    w.box().__thornswoodPassSeen.passes[303] = pass;
  }
  w.row(TESTER).percentages.health = '0.3';
  yes(server + ': an unreadable vital value is not invented or healed',
    /could not read/.test(ask(ADMIN, '/heal for Tester')) && w.row(TESTER).percentages.health === '0.3');
  drain(TESTER);
  yes(server + ': playtest help excludes targeting syntax',
    /\/heal:/.test(ask(TESTER, '/testhelp')) && !/\/heal for/.test(ask(TESTER, '/testhelp')));
  yes(server + ': admin help includes the targeting form', /\/heal for/.test(ask(ADMIN, '/adminhelp')));
  yes(server + ': no command or timer threw', !w.logged(/failed:|not a function|not defined/).length);
  w.done();
}
t.done();
