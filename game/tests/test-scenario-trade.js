'use strict';
/*
  test-scenario-trade.js

  Scenario: systems/trade.md

  #5198. Two people swapping what they hold, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them. H on somebody
  and the prompt's Accept are lines through the voice queue (/trade, /yes),
  as the key and the prompt send them, and so are the trade window's
  buttons (/trade add #<line>, gold, remove, ok, cancel), which name a line
  by the number the window was sent. What the window draws is the trade
  property the server writes. A login is the launcher's pass and
  onThornswoodLogin. Time is the stand-in's clock running the trade's own
  two-second check.

  Brenna carries an iron sword at 90%, a plain iron sword and 40 gold.
  Corvin carries iron ore and 40 gold. Dagny is across Windhelm.

    A  Dagny is too far: the trade does not open.
    B  Brenna asks Corvin, he accepts, and both windows open.
    C  The window shows each piece on its own line: the sword at 90% and the
       plain one are two. Brenna puts up the 90% one and Corvin sees it under
       the same name; more gold than she holds is refused; she puts up 10.
    D  She agrees; Corvin putting up two ore takes both agreements back.
    E  Both agree: it is traded, each is told what went each way, the piece
       put up crosses as it was (still 90%), the plain sword stays, and the
       gold and the ore move.
    F  One trade at a time: asking somebody else mid-trade brings this
       window back instead.
    G  Take back takes a line off. Walking away ends it with nothing moved,
       and so does three minutes untouched.
    H  A restart does not remember the piles: coming back sends the window
       shut.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  A sale out of Skyrim is the trading company's scenario.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-trade.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'trade' });
const WINDHELM = '3c:Skyrim.esm';
const SWORD = '12eb7:Skyrim.esm', ORE = '71cf3:Skyrim.esm';
w.record(SWORD, 'WEAP', { editorId: 'IronSword', fields: [{ type: 'DNAM', data: [1, 0, 0, 0] }] });
w.record(ORE, 'MISC', { editorId: 'OreIron' });   // no readable name, so the window spaces the editor id: Ore Iron
const id = w.idOf;
const STREET = [130000, -9000, 9000];
function at(dx, dy) { return [STREET[0] + dx, STREET[1] + dy, STREET[2]]; }

const BRENNA = w.person(0xff001800, { profileId: 1000, name: 'Brenna', prof: 'smith', cell: WINDHELM, pos: at(0, 0),
  inventory: { entries: [{ baseId: id(SWORD), count: 1, name: 'Iron Sword (90%)' }, { baseId: id(SWORD), count: 1 }, { baseId: 0xf, count: 40 }] } });
const CORVIN = w.person(0xff001801, { profileId: 1002, name: 'Corvin', prof: 'tailor', cell: WINDHELM, pos: at(200, 0),
  inventory: { entries: [{ baseId: id(ORE), count: 5 }, { baseId: 0xf, count: 40 }] } });
const DAGNY = w.person(0xff001802, { profileId: 1004, name: 'Dagny', prof: 'cook', cell: WINDHELM, pos: at(5000, 0),
  inventory: { entries: [{ baseId: 0xf, count: 40 }] } });
const EVERYONE = [BRENNA, CORVIN, DAGNY];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
EVERYONE.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function say(a, text) { w.say(a, text); w.run(300); return last(a); }
function hex(a) { return a.toString(16); }
function win(a) { return w.prop(a, 'thornswoodTrade') || {}; }
/* The number the window names a line by, as the window was sent it. */
function line(a, name) { const l = (win(a).pack || []).find(function (x) { return x.n === name; }); return l ? '#' + l.p : ''; }
function named(a, name) {
  return (w.row(a).inventory.entries || []).filter(function (e) { return e.baseId === id(SWORD) && (e.name || '') === name; })
    .reduce(function (n, e) { return n + e.count; }, 0);
}
function gold(a) { return w.count(a, 0xf); }
function show(a) {
  return JSON.stringify((w.row(a).inventory.entries || []).filter(function (e) { return e.count > 0; })
    .map(function (e) { return (e.name || e.baseId.toString(16)) + ' x' + e.count; }).sort());
}
let heardAt = 0;

// ------------------------------------------------------------ A. too far --
say(BRENNA, '/trade ' + hex(DAGNY));
const farYes = say(DAGNY, '/yes');
yes('A1 Dagny is across Windhelm: the trade does not open (' + farYes + ')', !win(BRENNA).open && !win(DAGNY).open);

// ------------------------------------------------------------- B. opening --
const asked = say(BRENNA, '/trade ' + hex(CORVIN));
yes('B1 Brenna asks Corvin (' + asked + ')', /^Asked Corvin\. They have 45 seconds\./.test(asked));
heardAt = w.heard(BRENNA).length;
say(CORVIN, '/yes');
yes('B2 he accepts and both windows open (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  win(BRENNA).open === true && win(CORVIN).open === true && win(BRENNA).them === 'Corvin' && win(CORVIN).them === 'Brenna' &&
  w.heardSince(BRENNA, heardAt).indexOf('Trading with Corvin.') !== -1);

// ------------------------------------------------------------ C. the table --
const names = (win(BRENNA).pack || []).map(function (l) { return l.n + ' x' + l.c; });
yes('C1 each piece is its own line: the sword at 90% and the plain one are two (' + JSON.stringify(names) + ')',
  !!line(BRENNA, 'Iron Sword (90%)') && !!line(BRENNA, 'Iron Sword') && line(BRENNA, 'Iron Sword (90%)') !== line(BRENNA, 'Iron Sword'));
say(BRENNA, '/trade add ' + line(BRENNA, 'Iron Sword (90%)') + ' 1');
yes('C2 Brenna puts up the 90% one and Corvin sees it under the same name (' + JSON.stringify(win(CORVIN).theirs) + ')',
  (win(CORVIN).theirs || []).length === 1 && win(CORVIN).theirs[0].n === 'Iron Sword (90%)' && win(CORVIN).theirs[0].c === 1);
yes('C3 more gold than she holds is refused (' + say(BRENNA, '/trade gold 500') + ')', last(BRENNA) === 'You only have 40.' && win(CORVIN).theirGold === 0);
say(BRENNA, '/trade gold 10');
yes('C3 and 10 goes up (' + win(CORVIN).theirGold + ')', win(CORVIN).theirGold === 10);

// ----------------------------------------------------------- D. agreeing --
heardAt = w.heard(CORVIN).length;
say(BRENNA, '/trade ok');
yes('D1 she agrees, and Corvin is told (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
  win(BRENNA).iAgreed === true && win(CORVIN).theyAgreed === true &&
  w.heardSince(CORVIN, heardAt).indexOf('Brenna has agreed. Agree on the trade when you are ready.') !== -1);
say(CORVIN, '/trade add ' + line(CORVIN, 'Ore Iron') + ' 2');
yes('D2 Corvin putting up two ore takes her agreement back (' + JSON.stringify(win(BRENNA).theirs) + ')',
  win(BRENNA).iAgreed === false && (win(BRENNA).theirs || []).length === 1 && win(BRENNA).theirs[0].c === 2);

// -------------------------------------------------------------- E. traded --
say(BRENNA, '/trade ok');
heardAt = w.heard(BRENNA).length;
const corvinHeard = w.heard(CORVIN).length;
say(CORVIN, '/trade ok');
yes('E1 both agree: traded, and each is told what went each way (' + w.heardSince(BRENNA, heardAt).join(' | ') + ' || ' +
  w.heardSince(CORVIN, corvinHeard).join(' | ') + ')',
  w.heardSince(BRENNA, heardAt).some(function (l) { return /^Traded\. You gave .*Iron Sword \(90%\).* and got .*Ore Iron.*\.$/.test(l); }) &&
  w.heardSince(CORVIN, corvinHeard).some(function (l) { return /^Traded\. You gave .*Ore Iron.* and got .*Iron Sword \(90%\).*\.$/.test(l); }) &&
  !win(BRENNA).open && !win(CORVIN).open);
yes('E2 the piece put up crosses as it was, and the plain sword stays (' + show(BRENNA) + ' / ' + show(CORVIN) + ')',
  named(CORVIN, 'Iron Sword (90%)') === 1 && named(BRENNA, 'Iron Sword (90%)') === 0 && named(BRENNA, '') === 1 && named(CORVIN, '') === 0);
yes('E3 the gold and the ore move (' + gold(BRENNA) + ', ' + gold(CORVIN) + ', ' + w.count(BRENNA, id(ORE)) + ', ' + w.count(CORVIN, id(ORE)) + ')',
  gold(BRENNA) === 30 && gold(CORVIN) === 50 && w.count(BRENNA, id(ORE)) === 2 && w.count(CORVIN, id(ORE)) === 3);

// ---------------------------------------------------------- F. one at a time --
say(BRENNA, '/trade ' + hex(CORVIN));
say(CORVIN, '/yes');
yes('F1 a second trade opens', win(BRENNA).open === true && win(CORVIN).open === true);
yes('F2 asking somebody else mid-trade brings this window back instead (' + say(BRENNA, '/trade ' + hex(DAGNY)) + ')',
  last(BRENNA) === 'You are already in a trade. Its window is open again.' && win(BRENNA).them === 'Corvin');

// ------------------------------------------------------------- G. ending --
say(BRENNA, '/trade add ' + line(BRENNA, 'Iron Sword') + ' 1');
say(BRENNA, '/trade remove ' + (win(BRENNA).mine[0] ? '#' + win(BRENNA).mine[0].p : ''));
yes('G1 Take back takes the line off (' + JSON.stringify(win(CORVIN).theirs) + ')', (win(CORVIN).theirs || []).length === 0);
say(BRENNA, '/trade gold 5');
let before = show(BRENNA) + show(CORVIN);
heardAt = w.heard(BRENNA).length;
w.moveTo(CORVIN, WINDHELM, at(1200, 0));
w.run(3000);
yes('G2 walking away ends it with nothing moved (' + w.heardSince(BRENNA, heardAt).join(' | ') + ')',
  !win(BRENNA).open && !win(CORVIN).open && show(BRENNA) + show(CORVIN) === before &&
  w.heardSince(BRENNA, heardAt).indexOf('You moved too far apart, so the trade is off.') !== -1);
w.moveTo(CORVIN, WINDHELM, at(200, 0));
w.run(500);
say(BRENNA, '/trade ' + hex(CORVIN));
say(CORVIN, '/yes');
say(CORVIN, '/trade add ' + line(CORVIN, 'Ore Iron') + ' 1');
before = show(BRENNA) + show(CORVIN);
heardAt = w.heard(CORVIN).length;
w.run(3 * 60000 + 5000);
yes('G3 three minutes untouched ends it, nothing moved (' + w.heardSince(CORVIN, heardAt).join(' | ') + ')',
  !win(BRENNA).open && !win(CORVIN).open && show(BRENNA) + show(CORVIN) === before &&
  w.heardSince(CORVIN, heardAt).indexOf('The trade timed out.') !== -1);

// ------------------------------------------------------------- H. restart --
say(BRENNA, '/trade ' + hex(CORVIN));
say(CORVIN, '/yes');
say(BRENNA, '/trade gold 7');
yes('H0 a trade stands with 7 gold up', win(CORVIN).theirGold === 7);
const r = w.restart();
yes('H1 the server restarts', r.loaded);
EVERYONE.forEach(w.arrive);
w.run(30000);
yes('H1 and coming back sends both windows shut, the piles not remembered (#5464) (' + JSON.stringify([win(BRENNA).open, win(CORVIN).open]) + ')',
  win(BRENNA).open === false && win(CORVIN).open === false);
say(BRENNA, '/trade ok');
yes('H1 Agree has no trade to agree to, and nothing moved (' + last(BRENNA) + ')',
  last(BRENNA) === 'You are not trading.' && gold(BRENNA) === 30 && gold(CORVIN) === 50);

t.done(w);
