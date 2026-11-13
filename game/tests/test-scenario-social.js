'use strict';
/*
  test-scenario-social.js

  Scenario: systems/friends.md
  Scenario: systems/party.md
  Scenario: systems/journal.md

  #5198. Friends, a party and a journal, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), on a
  dev server with every placed person the catalogue keeps, so the bandits of
  Halted Stream Camp are there for a warrior's party to fight. Every line is
  the one the key, the prompt or the panel sends: an ask carries the form id
  the look prompt hands over, a button beside a friend carries their profile
  id, and the J panel sends /journal.

  Brenna is a warrior (bulwark), Corvin a tailor, Dagny and five more are
  townsfolk of Whiterun.

    A  Friends. Brenna asks Corvin by his form id; he has 45 seconds and
       accepts on the prompt, and both lists hold the other. Dagny lets an
       ask run out, then turns one down. A friend who is away is listed
       under the name kept. Brenna's list is full at 120: Dagny's accept is
       refused, and neither list is written (#5428).
    B  Journals. A journal, its title, a page with a line break in it; a
       page too long is refused whole, and one of 4000, two spaces and a
       tab are kept as typed (#5429). A page is shared with a friend only,
       an offline friend included, and shows for them only while Brenna is
       online. Twelve journals at most.
    C  Party. Brenna asks Corvin with P; he joins, and is not asked again.
       Only the leader kicks. Four bandits with Corvin elsewhere are 8
       pieces of Brenna's bulwark work; four with him in the camp are 9
       (15%, paid as a whole piece). A seventh accept is refused. Lead
       passes to Corvin; when he leaves the lead passes on, and a party of
       one ends. Disband ends it for everyone.
    D  Remove beside a friend takes him off her list and not her off his.
    E  The server restarts: the party is gone; friends and journals are not.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-social.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const CATALOGUE = standIn.npcCatalogue();
const P = CATALOGUE.population;
const LEDGER = require('../../scripts/ops/New-AlphaMerchantLedger.js')
  .createAlphaMerchantLedger(require('../../game/data/merchant-roster.json'), require('../../game/data/npc-population.json'));
const RACES = { imperial: '13744:Skyrim.esm', breton: '13741:Skyrim.esm' };
const CAMP = ['50533:Skyrim.esm', '50549:Skyrim.esm', '5054a:Skyrim.esm', '5054e:Skyrim.esm'];
const AT_CAMP = { cell: '3c:Skyrim.esm', pos: [15600, 20000, -4300] };
const MARKET = { cell: '1a26f:Skyrim.esm', pos: [-800, 400, -1200] };   // Whiterun's market

const w = standIn.world({
  name: 'social',
  settings: { loadOrder: P.plugins, thornswoodServer: 'dev' },
  loadOrder: P.plugins,
  files: { 'private/merchant-ledger.json': LEDGER, 'private/merchant-ledger.initialized': '1' }
});
w.cast(CATALOGUE, RACES);

function at(place, n) { return [place.pos[0] + 40 * n, place.pos[1], place.pos[2]]; }
const BRENNA = w.person(0xff000c00, { profileId: 1000, name: 'Brenna', prof: 'warrior', half: 'bulwark', cell: MARKET.cell, pos: at(MARKET, 0) });
const CORVIN = w.person(0xff000c01, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: MARKET.cell, pos: at(MARKET, 1) });
const DAGNY = w.person(0xff000c02, { profileId: 1004, name: 'Dagny', cell: MARKET.cell, pos: at(MARKET, 2) });
const FIVE = ['Eirik', 'Frida', 'Gunnar', 'Hilde', 'Ivar'].map(function (n, i) {
  return w.person(0xff000c03 + i, { profileId: 1006 + 2 * i, name: n, cell: MARKET.cell, pos: at(MARKET, 3 + i) });
});
const EVERYONE = [BRENNA, CORVIN, DAGNY].concat(FIVE);

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);
const BANDITS = CAMP.map(function (d) { return w.idOf(d); });
yes('P1 the four bandits of the camp are loaded and server-controlled',
  BANDITS.every(function (b) { return w.row(b) && w.row(b).serverControlled === true && !w.row(b).isDead; }));

function hex(a) { return a.toString(16); }
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function view(a) { return w.prop(a, 'thornswoodSocialView') || {}; }
function stored(a) { return w.prop(a, 'thornswoodSocial') || {}; }
function friendPids(a) { return Object.keys(stored(a).friends || {}).map(Number).sort(); }
function friendRow(a, pid) { return (view(a).friends || []).find(function (f) { return f.p === pid; }) || {}; }
function partyNames(a) { return (view(a).party || []).map(function (m) { return m.name + (m.leader ? '*' : ''); }).sort(); }
function work(a) { return ((w.prop(a, 'thornswoodCharacter') || {}).work || {}).bulwark || 0; }
function refresh(a) { say(a, '/party refresh'); }
let answer = '';

// ------------------------------------------------------------- A. friends --
answer = say(BRENNA, '/friend ' + hex(CORVIN));
yes('A1 Brenna asks Corvin by the form id the look prompt gives (' + answer + ')', answer === 'Asked Corvin. They have 45 seconds.');
yes('A2 Corvin gets the prompt (' + last(CORVIN) + ', ' + JSON.stringify(view(CORVIN).offer) + ')',
  last(CORVIN) === 'Brenna wants to be friends. Accept or refuse on the prompt.' &&
  view(CORVIN).offer && view(CORVIN).offer.kind === 'friend' && view(CORVIN).offer.from === 1000);
answer = say(CORVIN, '/yes');
yes('A3 he accepts on the prompt, and both lists hold the other (' + answer + ', ' + last(BRENNA) + ')',
  answer === 'You and Brenna are friends.' && last(BRENNA) === 'Corvin accepted. You are friends.' &&
  friendPids(BRENNA).join() === '1002' && friendPids(CORVIN).join() === '1000');
answer = say(BRENNA, '/friend ' + hex(DAGNY));
w.run(46000);
answer = say(DAGNY, '/yes');
yes('A4 an ask Dagny leaves for 45 seconds runs out (' + answer + ')', answer === 'Nobody has asked you anything.' && friendPids(DAGNY).length === 0);
say(BRENNA, '/friend ' + hex(DAGNY));
answer = say(DAGNY, '/no');
yes('A5 she turns the next one down, and Brenna is told (' + answer + ', ' + last(BRENNA) + ')',
  answer === 'You turned Brenna down.' && last(BRENNA) === 'Dagny said no.' && friendPids(BRENNA).join() === '1002');
w.leave(CORVIN);
w.run(3000);
refresh(BRENNA);
yes('A6 a friend who is away is listed, by the name kept (' + JSON.stringify(friendRow(BRENNA, 1002)) + ')',
  friendRow(BRENNA, 1002).name === 'Corvin' && friendRow(BRENNA, 1002).on === false);
w.arrive(CORVIN);
w.run(3000);
// The list is full at 120. Brenna has kept 119 friends from earlier evenings (the record a full list is).
const full = stored(BRENNA);
for (let i = 0; i < 119; i++) { full.friends[2000 + 2 * i] = { name: 'Friend ' + i, since: 1 }; }
w.row(BRENNA).thornswoodSocial = full;
say(DAGNY, '/friend ' + hex(BRENNA));
answer = say(BRENNA, '/yes');
yes('A7 Brenna\'s list is full at 120: Dagny\'s accept is refused (' + answer + ')', answer === 'Your friends list is full.');
yes('A8 and neither list is written (' + friendPids(BRENNA).length + ', ' + friendPids(DAGNY).join() + ')',
  friendPids(BRENNA).length === 120 && friendPids(DAGNY).length === 0);
const lean = stored(BRENNA);
for (let i = 0; i < 119; i++) { delete lean.friends[2000 + 2 * i]; }
w.row(BRENNA).thornswoodSocial = lean;

// ------------------------------------------------------------- B. journals --
answer = say(BRENNA, '/journal new');
const J = ((stored(BRENNA).journals || [])[0] || {}).id;
yes('B1 New journal starts one (' + answer + ')', answer === 'Started Journal.' && !!J);
say(BRENNA, '/journal title ' + J + ' Field notes');
say(BRENNA, '/journal page ' + J + ' - The camp :: Four of them.\\nOne by the fire.');
const book = (stored(BRENNA).journals || [])[0] || {};
const page = (book.pages || [])[0] || {};
yes('B2 its title, and a page with its line break (' + JSON.stringify([book.title, page.title, page.text]) + ')',
  book.title === 'Field notes' && page.title === 'The camp' && page.text === 'Four of them.\nOne by the fire.');
answer = say(BRENNA, '/journal page ' + J + ' - Long :: ' + 'x'.repeat(4001));
yes('B3 a page past 4000 characters is refused whole (' + answer + ')',
  answer === 'That page is too long: 4001 characters, and a page holds 4000. Nothing was saved.' &&
  (stored(BRENNA).journals[0].pages || []).length === 1);
say(BRENNA, '/journal page ' + J + ' - Full :: ' + 'x'.repeat(4000));
say(BRENNA, '/journal page ' + J + ' - Spaced :: Two  spaces,\ta tab.');
const pages = stored(BRENNA).journals[0].pages || [];
yes('B4 a page of 4000, what the panel lets through, is kept; spaces and a tab are kept as typed (' +
  pages.map(function (p) { return (p.text || '').length; }).join(', ') + ')',
  pages.length === 3 && pages[1].text === 'x'.repeat(4000) && pages[2].text === 'Two  spaces,\ta tab.');
answer = say(BRENNA, '/journal share ' + J + ' ' + page.id + ' 1004');
yes('B5 a page is not shared with Dagny, who is not a friend (' + answer + ')',
  /friend/.test(answer) && !(view(DAGNY).shared || []).length);
answer = say(BRENNA, '/journal share ' + J + ' ' + page.id + ' 1002');
refresh(CORVIN);
const seen = (view(CORVIN).shared || [])[0] || {};
yes('B6 it is shared with Corvin, who is told and sees that page (' + answer + ', ' + last(CORVIN) + ')',
  answer === 'Shared with Corvin.' && last(CORVIN) === 'Brenna shared a page with you. Press J.' &&
  seen.from === 'Brenna' && seen.whole === false && (seen.pages || []).length === 1 && seen.pages[0].text === page.text);
w.leave(BRENNA);
w.run(3000);
refresh(CORVIN);
yes('B7 while Brenna is away it does not show for him', (view(CORVIN).shared || []).length === 0);
w.arrive(BRENNA);
w.run(3000);
refresh(CORVIN);
yes('B8 and it is back when she is', (view(CORVIN).shared || []).length === 1);
say(BRENNA, '/journal page ' + J + ' - Second :: For later.');
const second = (stored(BRENNA).journals[0].pages || [])[3] || {};
w.leave(CORVIN);
w.run(3000);
answer = say(BRENNA, '/journal share ' + J + ' ' + second.id + ' 1002');
yes('B9 a page can be shared with a friend who is offline (' + answer + ')',
  answer === 'Shared with Corvin.' && second.id && stored(BRENNA).journals[0].pages[3].shared[1002] === true);
w.arrive(CORVIN);
w.run(3000);
for (let i = 0; i < 11; i++) { say(BRENNA, '/journal new'); }
answer = say(BRENNA, '/journal new');
yes('B10 twelve journals at most (' + stored(BRENNA).journals.length + ', ' + answer + ')',
  stored(BRENNA).journals.length === 12 && answer === 'You are carrying as many journals as you can.');

// ---------------------------------------------------------------- C. party --
answer = say(BRENNA, '/party ' + hex(CORVIN));
yes('C1 P on Corvin asks him (' + answer + ', ' + last(CORVIN) + ')',
  answer === 'Asked Corvin. They have 45 seconds.' && last(CORVIN) === 'Brenna is asking you to join their party. Accept or refuse on the prompt.');
answer = say(CORVIN, '/yes');
refresh(BRENNA);
yes('C2 he joins, and she leads (' + answer + ', ' + partyNames(BRENNA).join() + ')',
  answer === 'You joined Brenna\'s party.' && partyNames(BRENNA).join() === 'Brenna*,Corvin');
answer = say(BRENNA, '/party ' + hex(CORVIN));
yes('C3 he is not asked again (' + answer + ')', answer === 'Corvin is already in your party.');
answer = say(CORVIN, '/party kick 1000');
yes('C4 only the leader kicks (' + answer + ')', answer === 'Only the leader can do that.');

function fourBandits() {
  BANDITS.forEach(function (b) { w.die(b, BRENNA, null); w.run(500); w.respawn(b); w.run(500); });
}
w.moveTo(BRENNA, AT_CAMP.cell, AT_CAMP.pos);
w.run(2000);
let before = work(BRENNA);
fourBandits();
yes('C5 four bandits with Corvin in another place are 8 pieces of her work (' + (work(BRENNA) - before) + ')', work(BRENNA) - before === 8);
w.moveTo(CORVIN, AT_CAMP.cell, at(AT_CAMP, 1));
w.run(2000);
refresh(BRENNA);
yes('C6 the panel counts him with her (' + view(BRENNA).together + ' here, ' + view(BRENNA).bonus + '%)',
  view(BRENNA).together === 1 && view(BRENNA).bonus === 15);
before = work(BRENNA);
fourBandits();
yes('C7 four with him in the camp are 9: 15%, paid as a whole piece (' + (work(BRENNA) - before) + ')', work(BRENNA) - before === 9);
w.moveTo(BRENNA, MARKET.cell, at(MARKET, 0));
w.moveTo(CORVIN, MARKET.cell, at(MARKET, 1));
w.run(2000);

[DAGNY].concat(FIVE).forEach(function (a) { say(BRENNA, '/party ' + hex(a)); answer = say(a, '/yes'); });
refresh(BRENNA);
yes('C8 six in the party, and the seventh accept is refused (' + answer + ', ' + partyNames(BRENNA).length + ')',
  answer === 'That party is full.' && partyNames(BRENNA).length === 6);
answer = say(BRENNA, '/party lead 1002');
refresh(CORVIN);
yes('C9 Lead hands it to Corvin (' + answer + ', ' + partyNames(CORVIN).join() + ')',
  answer === 'They lead the party now.' && partyNames(CORVIN).indexOf('Corvin*') !== -1);
answer = say(CORVIN, '/party leave');
refresh(BRENNA);
const lead = (view(BRENNA).party || []).find(function (m) { return m.leader; }) || {};
yes('C10 he leaves without handing it on, and the lead passes to the next on the list (' + answer + ', ' + lead.name + ')',
  answer === 'You left the party.' && lead.name === 'Brenna' && partyNames(BRENNA).length === 5);
['Dagny', 'Eirik', 'Frida'].forEach(function (n) { say(BRENNA, '/party kick ' + n); });
answer = say(BRENNA, '/party kick Gunnar');
refresh(BRENNA); refresh(FIVE[2]);
yes('C11 a party of one ends (' + answer + ', ' + partyNames(BRENNA).join() + ')',
  answer === 'They left the party.' && partyNames(BRENNA).length === 0 && partyNames(FIVE[2]).length === 0);
[FIVE[3], FIVE[4]].forEach(function (a) { say(BRENNA, '/party ' + hex(a)); say(a, '/yes'); });
answer = say(BRENNA, '/party disband');
refresh(BRENNA); refresh(FIVE[3]); refresh(FIVE[4]);
yes('C12 Disband ends it for everyone (' + answer + ')',
  answer === 'The party is ended.' && partyNames(BRENNA).length === 0 && partyNames(FIVE[3]).length === 0 && partyNames(FIVE[4]).length === 0);
say(BRENNA, '/party ' + hex(CORVIN));
say(CORVIN, '/yes');

// --------------------------------------------------------------- D. remove --
answer = say(BRENNA, '/friend remove 1002');
yes('D1 Remove beside Corvin takes him off her list, and not her off his (' + answer + ')',
  answer === 'Corvin is no longer on your list.' && friendPids(BRENNA).length === 0 && friendPids(CORVIN).join() === '1000');

// -------------------------------------------------------------- E. restart --
const r = w.restart();
yes('E1 the server comes back up', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
refresh(BRENNA); refresh(CORVIN);
yes('E2 the party is gone (' + partyNames(BRENNA).join() + ')', partyNames(BRENNA).length === 0 && partyNames(CORVIN).length === 0);
yes('E3 his friend and her journals are not (' + friendPids(CORVIN).join() + ', ' + stored(BRENNA).journals.length + ')',
  friendPids(CORVIN).join() === '1000' && stored(BRENNA).journals.length === 12 &&
  stored(BRENNA).journals[0].pages[0].text === 'Four of them.\nOne by the fire.');

t.done(w);
