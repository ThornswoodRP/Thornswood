'use strict';
/*
  test-scenario-chat.js

  Scenario: systems/chat.md

  #5198. The lines the game server says for people, end to end: the WHOLE
  of game/gamemode.js over the stand-in server (tests/stand-in-server.js),
  every step a message the engine sends in the order it sends them. A typed
  /ooc or /roll reaches the gamemode through the voice queue, and what each
  person is told comes back from it, as on the live server. A plain line,
  /me, /do, /w and /s never reach the game server: the voice service says
  them (voice/voice-server.js, game/tests/test-voice-range.js and the rest), and
  the line above the head is the game's.

  Brenna and Aldis stand 15 metres apart in Whiterun's square. Corvin is 70
  metres off across it. Dagny is in the house beside them, at the same
  spot, in another cell. Sam is staff.

    A  /ooc: Brenna's line, in brackets with her name, reaches her and Aldis,
       and not Corvin, out of reach, nor Dagny, in another cell. /o is the
       same. /ooc alone says how it is used.
    B  A line over 300 characters is cut to 300.
    C  Corvin, with nobody near enough, is told so.
    D  /roll: the server rolls it, and the same people /ooc reaches see it.
       /roll alone is a twenty; d6x3 is three six sided dice, each shown,
       with the total; past 12 dice only the total. 1001 sides is refused.
    E  Staff silence Brenna: her /ooc and her /roll reach nobody, and she is
       told how long is left. After the minutes run out she is heard again.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-chat.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'chat', settings: { thornswoodDevs: [1006] } });
const CITY = '1a26f:Skyrim.esm';         // Whiterun
const HOUSE = '165a7:Skyrim.esm';        // a house off the square
const BRENNA = w.person(0xff001100, { profileId: 1000, name: 'Brenna', cell: CITY, pos: [20000, -8000, -3500] });
const ALDIS = w.person(0xff001101, { profileId: 1001, name: 'Aldis', cell: CITY, pos: [21000, -8000, -3500] });
const CORVIN = w.person(0xff001102, { profileId: 1002, name: 'Corvin', cell: CITY, pos: [26000, -8000, -3500] });
const DAGNY = w.person(0xff001103, { profileId: 1003, name: 'Dagny', cell: HOUSE, pos: [20000, -8000, -3500] });
const SAM = w.person(0xff001104, { profileId: 1006, name: 'Sam', cell: '3c:Skyrim.esm', pos: [0, 0, 0] });
const ALL = [BRENNA, ALDIS, CORVIN, DAGNY, SAM];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
ALL.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
/* Who heard exactly this line since the marks were taken. */
function marks() { const m = {}; ALL.forEach(function (a) { m[a] = w.heard(a).length; }); return m; }
function heardBy(m, line) {
  return ALL.filter(function (a) { return w.heardSince(a, m[a]).indexOf(line) >= 0; })
    .map(function (a) { return w.row(a).appearance.name; }).join(',');
}

// -------------------------------------------------------------- A. ooc --
let m = marks();
w.say(BRENNA, '/ooc brb, door');
yes('A1 /ooc: in brackets with her name, to her and Aldis, not Corvin far off, not Dagny in the house (' + heardBy(m, '(( Brenna: brb, door ))') + ')',
    heardBy(m, '(( Brenna: brb, door ))') === 'Brenna,Aldis');
m = marks();
w.say(ALDIS, '/o fine');
yes('A2 /o is the same (' + heardBy(m, '(( Aldis: fine ))') + ')', heardBy(m, '(( Aldis: fine ))') === 'Brenna,Aldis');
w.say(BRENNA, '/ooc');
yes('A3 /ooc alone says how it is used (' + last(BRENNA) + ')', last(BRENNA) === 'Say /ooc and then whatever you meant to say.');

// ------------------------------------------------------------ B. the cut --
m = marks();
w.say(BRENNA, '/ooc ' + 'a'.repeat(400));
yes('B1 a line over 300 characters is cut to 300', heardBy(m, '(( Brenna: ' + 'a'.repeat(300) + ' ))') === 'Brenna,Aldis');

// ------------------------------------------------------- C. nobody near --
m = marks();
w.say(CORVIN, '/ooc anyone?');
yes('C1 Corvin, with nobody near enough, is told so (' + w.heardSince(CORVIN, m[CORVIN]).join(' | ') + ')',
    heardBy(m, '(( Corvin: anyone? ))') === 'Corvin' && last(CORVIN) === 'Nobody near enough to hear that.');

// ------------------------------------------------------------ D. the dice --
w.dice(0.5);
m = marks();
w.say(BRENNA, '/roll');
yes('D1 /roll alone is a twenty, rolled by the server, to the same people /ooc reaches (' + heardBy(m, 'Brenna rolls 20: 11') + ')',
    heardBy(m, 'Brenna rolls 20: 11') === 'Brenna,Aldis');
m = marks();
w.say(BRENNA, '/r d6x3');
yes('D2 d6x3 is three six sided dice, each shown, with the total (' + last(BRENNA) + ')',
    heardBy(m, 'Brenna rolls 3x6: 4 + 4 + 4 = 12') === 'Brenna,Aldis');
m = marks();
w.say(BRENNA, '/roll 10x13');
yes('D3 past 12 dice only the total (' + last(BRENNA) + ')', heardBy(m, 'Brenna rolls 13x10: 78') === 'Brenna,Aldis');
m = marks();
w.say(BRENNA, '/roll 1001');
yes('D4 1001 sides is refused, and nobody sees a roll (' + last(BRENNA) + ')',
    /^The number is the sides/.test(last(BRENNA)) && w.heardSince(ALDIS, m[ALDIS]).length === 0);
w.dice(null);

// --------------------------------------------------------- E. silence --
w.say(SAM, '/silence Brenna 5 shouting over a scene');
yes('E1 Sam silences Brenna for 5 minutes, and she is told (' + last(BRENNA) + ')',
    /^Staff have silenced you for 5 minutes: shouting over a scene\./.test(last(BRENNA)));
m = marks();
w.say(BRENNA, '/ooc can you hear me');
yes('E2 her /ooc reaches nobody, and she is told how long is left (' + last(BRENNA) + ')',
    w.heardSince(ALDIS, m[ALDIS]).length === 0 && /^Staff have silenced you for another [45] minutes, so that did not reach anybody\.$/.test(last(BRENNA)));
w.say(BRENNA, '/roll');
yes('E3 nor her /roll', w.heardSince(ALDIS, m[ALDIS]).length === 0 && /did not reach anybody/.test(last(BRENNA)));
w.run(5 * 60 * 1000);
m = marks();
w.say(BRENNA, '/ooc back');
yes('E4 once the minutes run out she is heard again (' + heardBy(m, '(( Brenna: back ))') + ')', heardBy(m, '(( Brenna: back ))') === 'Brenna,Aldis');

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
