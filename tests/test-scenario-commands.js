'use strict';
/*
  test-scenario-commands.js

  Scenario: systems/commands.md

  #5198. The chat commands, end to end: the WHOLE of game/gamemode.js over
  the stand-in server (tests/stand-in-server.js). Every line is what the
  chat box or a plugin queues with the voice service, collected by the
  server's dispatch and answered by its handle, in the order the engine
  sends them. Who is a tester or dev is the server's written lists.

  Lydia is on no list. Tess is a playtester. Sam is a dev, and so staff.
  Hulda's lines arrive before her character is in the world.

    A  /help and /commands name the help panel and the commands that stay,
       exactly the list, and nothing a tester runs; Tess is told hers as well.
    B  A word nobody has is answered privately with where the help is, and
       nobody else hears it.
    C  The testers' tools refused: /tp, /give, /spawn and /where from Lydia
       are refused, and nothing moved, came or went.
    D  The testers' tools for Tess: /tp lists the places and moves her,
       /where says where she stands, /give hands her gold, /spawn makes two
       temporary wolves beside her, and Sam's /despawn takes one away.
    E  /restart and /shutdown are answered with a sentence, and nothing
       restarts.
    F  The commands that stay: /needs is the bars as a line and changes
       nothing; /helpme reaches Sam and not Tess; /report names who.
    G  Before the character is in: Hulda's /needs waits and runs once she
       arrives; her /help and a gated word are answered at once.
    H  The game's own lines: a broken lockpick is spent with nothing said.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  /ooc and /roll are the chat scenario's; the staff commands and what they
  do are the staff block's and tests/test-staff-commands.js's; each button
  that sends a line is its own system's scenario.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-commands.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

/*
  The NPC system runs as it does live, with the load order its catalogue was
  built for and only the guild's traders placed (the merchant ledger is
  checked against them): a spawned creature is held by it, and that is what
  /despawn chooses from.
*/
const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const LEDGER = require('../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(require('../game/data/merchant-roster.json'), require('../game/data/npc-population.json'));
const w = standIn.world({
  name: 'commands',
  settings: { thornswoodPlaytesters: [1001], thornswoodDevs: [1002], loadOrder: P.plugins, thornswoodServer: 'dev' },
  loadOrder: P.plugins,
  files: { 'private/merchant-ledger.json': LEDGER, 'private/merchant-ledger.initialized': '1' }
});
w.cast({ population: Object.assign({}, P, { keep: P.keep.filter(function (r) { return r[6] === 'trader'; }) }), types: CATALOGUE.types },
       { imperial: '13744:Skyrim.esm', nord: '13746:Skyrim.esm' });
const CITY = '1a26f:Skyrim.esm';         // Whiterun
function at(n) { return [20000 + 80 * n, -8000, -3500]; }
const LYDIA = w.person(0xff001c00, { profileId: 1000, name: 'Lydia', cell: CITY, pos: at(0) });
const TESS = w.person(0xff001c01, { profileId: 1001, name: 'Tess', cell: CITY, pos: at(1) });
const SAM = w.person(0xff001c02, { profileId: 1002, name: 'Sam', cell: CITY, pos: at(2) });
const HULDA = w.person(0xff001c03, { profileId: 1003, name: 'Hulda', cell: CITY, pos: at(3) });
const IN = [LYDIA, TESS, SAM];
[LYDIA, TESS, SAM, HULDA].forEach(function (a) { w.row(a).thornswoodNeeds = { food: 90, drink: 90, rest: 90, temp: 50, at: w.now() }; });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
IN.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function said(a, line) { const n = w.heard(a).length; w.say(a, line); return w.heardSince(a, n).join(' | '); }
const STAY = ['/stuck', '/helpme', '/report', '/me', '/do', '/w', '/s', '/y', '/ooc', '/roll', '/needs'];
const GOLD = w.idOf('f:Skyrim.esm');
const PICK = w.idOf('a:Skyrim.esm');
const WOLF = '10fe05:Skyrim.esm';    // what /spawn wolf names
w.record(WOLF, 'NPC_', { race: '1320a:Skyrim.esm' });

// ------------------------------------------------------------- A. /help --
const help = said(LYDIA, '/help');
yes('A1 /help names the help panel on F7 and on K, P and J (' + help.slice(0, 90) + ')',
    /F7 opens it/.test(help) && /K, P or J/.test(help));
yes('A1 and the commands that stay, exactly the list', help.indexOf('Typed in the chat: ' + STAY.join(', ') + '.') !== -1);
yes('A1 and nothing a tester runs', !/\/tp|\/give|\/spawn|\/where/.test(help));
yes('A2 /commands is the same line', said(LYDIA, '/commands') === help);
const tessHelp = said(TESS, '/help');
yes('A3 Tess is told hers as well (' + tessHelp.slice(-120) + ')',
    tessHelp.indexOf(help) === 0 && /You are playtester: \/tp <place> moves you/.test(tessHelp) && /\/where/.test(tessHelp));

// --------------------------------------------------- B. a word nobody has --
const others = [TESS, SAM].map(function (a) { return w.heard(a).length; });
const unknown = said(LYDIA, '/dance');
yes('B1 a word nobody has: "No command called /dance." and where the help is (' + unknown.slice(0, 60) + ')',
    unknown === 'No command called /dance. ' + help);
yes('B1 and nobody else hears it', [TESS, SAM].every(function (a, i) { return w.heardSince(a, others[i]).length === 0; }));

// --------------------------------------------------- C. refused to Lydia --
const lydiaCell = w.prop(LYDIA, 'worldOrCellDesc');
const lydiaPos = w.prop(LYDIA, 'pos').slice();
const lydiaGold = w.count(LYDIA, GOLD);
function wolves() { return w.mp().findFormsByPropertyValue('baseDesc', WOLF); }
const tp = said(LYDIA, '/tp falkreath');
yes('C1 /tp from Lydia is refused, naming the list she is not on (' + tp + ')',
    /not on the playtester or dev list, so \/tp is not yours to run\. Ask Patrick to add profile 1000\./.test(tp));
yes('C1 and she has not moved', w.prop(LYDIA, 'worldOrCellDesc') === lydiaCell && w.prop(LYDIA, 'pos').join() === lydiaPos.join());
yes('C2 /give is refused, and no gold came', said(LYDIA, '/give gold 50') === '/give is not yours to run. Ask Patrick to add profile 1000.' &&
    w.count(LYDIA, GOLD) === lydiaGold);
yes('C3 /spawn is refused, and nothing was spawned', said(LYDIA, '/spawn wolf') === '/spawn is not yours to run. Ask Patrick to add profile 1000.' &&
    wolves().length === 0);
yes('C4 /where is refused', said(LYDIA, '/where') === '/where is not yours to run. Ask Patrick to add profile 1000.');

// ------------------------------------------------------- D. Tess's tools --
const list = said(TESS, '/tp');
yes('D1 /tp alone lists the places (' + list.slice(0, 80) + ')', /^Where to: /.test(list) && /whiterun/.test(list) && /falkreath/.test(list));
const sent = said(TESS, '/tp falkreath');
w.run(2000);
yes('D2 /tp falkreath sends her there (' + sent + ', ' + w.prop(TESS, 'worldOrCellDesc') + ')',
    /^Sent to Falkreath\.$/.test(sent) && w.prop(TESS, 'worldOrCellDesc') !== CITY);
const where = said(TESS, '/where');
const tpos = w.prop(TESS, 'pos');
yes('D3 /where says the cell and where she stands (' + where + ')',
    where.indexOf(String(w.prop(TESS, 'worldOrCellDesc'))) === 0 && where.indexOf('pos ' + Math.round(tpos[0] * 10) / 10) !== -1);
const tessGold = w.count(TESS, GOLD);
const given = said(TESS, '/give gold 25');
yes('D4 /give gold 25 hands her 25 gold (' + given + ')', /^Given 25 /.test(given) && w.count(TESS, GOLD) === tessGold + 25);
const spawned = said(TESS, '/spawn wolf 2');
const made = wolves();
yes('D5 /spawn wolf 2 makes two wolves, temporary (' + spawned + ')',
    /^Spawned 2 /.test(spawned) && /Temporary/.test(spawned) && made.length === 2);
yes('D5 beside her, in her cell', made.every(function (id) {
  const p = w.row(id).pos;
  return w.row(id).worldOrCellDesc === w.prop(TESS, 'worldOrCellDesc') && Math.hypot(p[0] - tpos[0], p[1] - tpos[1]) < 1000;
}));
w.moveTo(SAM, w.prop(TESS, 'worldOrCellDesc'), [tpos[0] + 50, tpos[1], tpos[2]]);
const gone = said(SAM, '/despawn');
const left = made.filter(function (id) { const r = w.row(id); return r && !r.isDisabled; });
yes('D6 Sam\'s /despawn takes the nearest of them out of the world for good (' + gone + ')',
    /^Removed the wolf nearest you, for good\./i.test(gone) && left.length === 1);

// ---------------------------------------------------------- E. /restart --
const booted = w.box().__thornswoodBootedAt;
const r1 = said(SAM, '/restart');
yes('E1 /restart is answered with a sentence, not a tool name (' + r1 + ')',
    r1 === 'Restarts are not run from chat. Ask whoever runs the server and they will count everybody down first.');
yes('E1 /shutdown is the same', said(LYDIA, '/shutdown') === r1);
w.run(70000);
yes('E2 and nothing restarts: everybody is still on', IN.every(function (a) { return w.mp().get(0, 'onlinePlayers').indexOf(a) !== -1; }) &&
    w.box().__thornswoodBootedAt === booted);

// ------------------------------------------------- F. the commands that stay --
const needsBefore = JSON.stringify(w.prop(LYDIA, 'thornswoodNeeds'));
const needs = said(LYDIA, '/needs');
yes('F1 /needs is the four bars as a line (' + needs + ')', /Hunger/.test(needs) && /Thirst/.test(needs) && /Rest/.test(needs) && /Temp/.test(needs));
yes('F1 /need is the same', said(LYDIA, '/need') === needs);
const samN = w.heard(SAM).length, tessN = w.heard(TESS).length;
const asked = said(LYDIA, '/helpme the cart is stuck in the gate');
const samHeard = w.heardSince(SAM, samN).join(' | ');
yes('F2 /helpme reaches Sam, who is staff, with where she is (' + samHeard + ')',
    samHeard.indexOf('[staff] Lydia asks for help at ' + lydiaCell + ': the cart is stuck in the gate') !== -1);
yes('F2 and not Tess, who is not', w.heardSince(TESS, tessN).join(' ').indexOf('[staff]') === -1);
yes('F2 Lydia is told it went (' + asked + ')', /staff/i.test(asked));
const samM = w.heard(SAM).length;
w.say(LYDIA, '/report Tess spawned wolves at my door');
yes('F3 /report names who and what (' + w.heardSince(SAM, samM).join(' | ') + ')',
    w.heardSince(SAM, samM).join(' ').indexOf('[staff] Lydia reported Tess: spawned wolves at my door') !== -1);
yes('F3 and Tess is never told she was reported', w.heardSince(TESS, tessN).join(' ').indexOf('reported') === -1);

// ------------------------------------------------ G. before she is in --
const h0 = w.heard(HULDA).length;
w.say(HULDA, '/needs');
const waiting = w.heardSince(HULDA, h0).join(' | ');
yes('G1 Hulda\'s /needs, before her character is in, waits (' + waiting + ')', /as soon as you arrive/.test(waiting) && !/Hunger/.test(waiting));
const hh = said(HULDA, '/help');
yes('G2 her /help is answered at once', hh.indexOf('Help is a panel') === 0);
const ht = said(HULDA, '/give gold');
yes('G3 a gated word is refused at once, not held', ht === '/give is not yours to run. Ask Patrick to add profile 1003.');
const h1 = w.heard(HULDA).length;
w.arrive(HULDA);
w.run(15000);
const ran = w.heardSince(HULDA, h1).join(' | ');
yes('G4 once she is in, the /needs runs (' + ran.slice(0, 100) + ')', /Hunger/.test(ran));

// ------------------------------------------------- H. the game's own lines --
w.give(LYDIA, PICK, 5);
const l0 = w.heard(LYDIA).length;
w.say(LYDIA, '/tspicks 2');
yes('H1 two lockpicks that broke are spent (' + w.count(LYDIA, PICK) + ' left)', w.count(LYDIA, PICK) === 3);
yes('H1 with nothing said to her', w.heardSince(LYDIA, l0).length === 0);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
