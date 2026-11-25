'use strict';
/*
  Scenario: systems/playtest-and-admin-commands.md
  Actual queued role help, implemented-tool discovery, execution permissions,
  connection proof and launcher-pass refusal over the whole gamemode.
*/
// Exercise role-specific help through the actual queued command path.
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const w = standIn.world({ name: '6731-command-help', settings: {
  thornswoodAdmins: [101], thornswoodDevs: [102], thornswoodPlaytesters: [103]
} });
const actors = [101, 102, 103].map((profileId, i) => w.person(0xff006731 + i, {
  profileId, name: ['Admin', 'Staff', 'Tester'][i], cell: '3c:Skyrim.esm', pos: [1000 + i * 100, 0, 0]
}));
const [ADMIN, STAFF, TESTER] = actors;
yes('the whole gamemode loads', w.boot());
if (!w.loaded()) t.done(w);
actors.forEach(w.arrive);
w.run(30000);

function ask(actor, command) {
  const before = w.heard(actor).length;
  w.say(actor, command);
  return w.heardSince(actor, before).join('\n');
}
yes('playtest help names the existing self-only tools and examples',
  /\/give.*\/spawn.*\/tp.*\/where/s.test(ask(TESTER, '/testhelp')));
yes('playtest help does not expose moderation or admin actions',
  !/\/ban\b|\/kick\b|\/unpk\b/.test(ask(TESTER, '/testhelp')));
yes('a playtester cannot read staff or admin help',
  /not yours/.test(ask(TESTER, '/staffhelp')) && /not yours/.test(ask(TESTER, '/adminhelp')));
yes('staff help contains moderation syntax', /\/silence.*\/freeze/s.test(ask(STAFF, '/staffhelp')));
yes('staff without the admin role cannot read admin help', /not yours/.test(ask(STAFF, '/adminhelp')));
yes('an admin gets the lower tiers and admin-only actions',
  /\/give.*\/silence.*\/unpk/s.test(ask(ADMIN, '/adminhelp')));
yes('extra help arguments get usage rather than a command list', /Usage: \/testhelp/.test(ask(TESTER, '/testhelp anything')));

const catalog = w.box().__thornswoodCommandTools;
yes('implemented tools have a server-owned catalog', !!catalog);
if (catalog) {
  let calls = 0;
  catalog.register('help-regression', {
    command(cmd, word, parts, pid) {
      calls++;
      const refusal = w.box().__thornswoodStaff.authorizeTool(cmd, pid, TESTER, 'playtester');
      w.box().__thornswoodStaff.tell(pid, refusal || 'The test tool ran.');
      return true;
    },
    help: [{ word: '/testexample', role: 'playtester', syntax: '/testexample', text: 'A test-only example.' },
           { word: '/adminexample', role: 'admin', syntax: '/adminexample', text: 'An admin-only example.' }]
  });
  yes('playtest help discovers an implemented test tool', /\/testexample/.test(ask(TESTER, '/testhelp')));
  yes('admin-only metadata stays out of playtest help', !/\/adminexample/.test(ask(TESTER, '/testhelp')));
  yes('admin help includes implemented admin-only metadata', /\/adminexample/.test(ask(ADMIN, '/adminhelp')));
  yes('the catalog routes the real queued command once', /The test tool ran/.test(ask(TESTER, '/testexample')) && calls === 1);
  yes('the minimum role also protects execution, not only the help list',
    /not yours/.test(ask(TESTER, '/adminexample')) && calls === 1);
  let rejected = 0;
  for (const bad of [
    { word: '/bad role', role: 'playtester', syntax: '/bad role', text: 'Bad word.' },
    { word: '/badrole', role: 'owner', syntax: '/badrole', text: 'Bad tier.' },
    { word: '/prototype', role: 'constructor', syntax: '/prototype', text: 'A prototype is not a role.' }
  ]) {
    try { catalog.register('bad-' + rejected, { command() { throw Error('must never run'); }, help: [bad] }); }
    catch (_) { rejected++; }
  }
  yes('invalid command metadata cannot register a handler', rejected === 3);
  let duplicate = false;
  try { catalog.register('collision', { command() {}, help: [{ word: '/testexample', role: 'admin', syntax: '/testexample', text: 'Collision.' }] }); }
  catch (_) { duplicate = true; }
  yes('one module cannot replace another module\'s command', duplicate);
  const before = calls;
  catalog.command({ proven: false }, '/testexample', ['/testexample'], 103, TESTER);
  yes('the catalog refuses unproven commands before invoking a module', calls === before);
  let variants = false;
  try {
    catalog.register('scoped-help-regression', {
      command(cmd, word, parts, pid) { w.box().__thornswoodStaff.tell(pid, 'The scoped test tool ran.'); return true; },
      help: [
        { word: '/testvariant', role: 'admin', syntax: '/testvariant for <person>', text: 'Admin targeting syntax.' },
        { word: '/testvariant', role: 'playtester', syntax: '/testvariant', text: 'Self-only syntax.' }
      ]
    });
    variants = true;
  } catch (_) { }
  yes('one implemented tool may document a separate admin targeting form', variants);
  if (variants) {
    yes('playtest help excludes the admin-only usage of a shared command',
      /\/testvariant: Self-only/.test(ask(TESTER, '/testhelp')) && !/\/testvariant for/.test(ask(TESTER, '/testhelp')));
    yes('admin help includes the admin-only targeting usage', /\/testvariant for/.test(ask(ADMIN, '/adminhelp')));
    yes('metadata order cannot elevate the minimum route above its self-only tier', /scoped test tool ran/.test(ask(TESTER, '/testvariant')));
  }
}

const seen = w.box().__thornswoodPassSeen;
const pass = seen.passes[103];
delete seen.passes[103];
yes('a role without a current launcher pass gets no help list', !/\/give/.test(ask(TESTER, '/testhelp')));
seen.passes[103] = pass;
yes('none of the read-only help calls moved or changed a character',
  actors.every((actor, i) => w.row(actor).profileId === 101 + i && w.row(actor).pos[0] === 1000 + i * 100));
t.done(w);
