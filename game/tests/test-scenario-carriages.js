'use strict';
/*
  test-scenario-carriages.js

  Scenario: systems/carriages.md

  #5198. Carriages and ferries, end to end: the WHOLE of game/gamemode.js
  over the stand-in server (tests/stand-in-server.js), every step a message
  the engine sends in the order it sends them. E on a driver is the front
  plugin's /ride e <driver> through the voice queue, and the panel's Ride
  button is /ride <stop>, as the panel sends it; what the panel draws is the
  thornswoodRideView property the server writes for the person who pressed.
  The move is one locationalData set, as the engine takes it.

  Brenna has 100 gold at Whiterun's carriage, where Bjorlam drives. Aldis
  has 15. Corvin waits for the Northern Maiden at Windhelm's docks.

    A  E on Bjorlam from across the yard: walk up first, and no panel. From
       beside him: his panel, with every stop his carriage goes to and its
       fare: Solitude 20, Riverwood (a village of his hold) 10, and no stop
       that is not on the carriage.
    B  Aldis, with 15, asks for Solitude: refused, nothing taken, she does
       not move, and the panel stays up with the reason.
    C  Brenna rides to Solitude: 20 gold leave her pack, she is at
       Solitude's carriage in one move, the panel closes, and Whiterun's
       drop box holds the 20 as fares.
    D  At Solitude, Thaer's carriage goes to Rorikstead, a village of
       Whiterun's hold, for 20, a stop in another hold, and she rides it.
       Nobody drives from Rorikstead, so a ride from there is refused.
    E  A stop the carriage does not go to is refused and nothing is taken.
       A ride with no driver near is refused and the panel closes.
    F  Corvin takes the Northern Maiden from Windhelm to Raven Rock: the
       crossing is 40, into Windhelm's drop box. Raven Rock's ferry to Tel
       Mithryn is 10.
    G  A restart: the fares in the drop boxes are as they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  The carriage mod's own fade, which the engine's movement check refuses,
  is the fork's (MovementValidation), and the stand-in does not model it.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-scenario-carriages.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({ name: 'carriages' });
const GOLD = 0xf;
const TAMRIEL = '3c:Skyrim.esm';

// Where the scenario starts is beside Whiterun's carriage; the stops are read from the block once it loads.
const BRENNA = w.person(0xff000f00, { profileId: 1000, name: 'Brenna', cell: TAMRIEL, pos: [0, 0, 0],
  inventory: { entries: [{ baseId: GOLD, count: 100 }] } });
const ALDIS = w.person(0xff000f01, { profileId: 1001, name: 'Aldis', cell: TAMRIEL, pos: [0, 0, 0],
  inventory: { entries: [{ baseId: GOLD, count: 15 }] } });
const CORVIN = w.person(0xff000f02, { profileId: 1002, name: 'Corvin', cell: TAMRIEL, pos: [0, 0, 0],
  inventory: { entries: [{ baseId: GOLD, count: 60 }] } });
const ALL = [BRENNA, ALDIS, CORVIN];

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
const C = w.box().__thornswoodCarriages;
const P = () => w.box().__thornswoodProperty;
const stop = C.stopByKey;
const WHITERUN = stop('carriage:whiterun'), SOLITUDE = stop('carriage:solitude');
const MAIDEN = stop('maiden:windhelm'), RAVEN = stop('maiden:ravenrock'), FERRY = stop('solstheim:ravenrock');
function driverOf(s, id) { return w.ref(id, { base: s.base, type: 'NPC_', cell: s.world, pos: s.pos.slice() }); }
const BJORLAM = driverOf(WHITERUN, 0xff300001);
const THAER = driverOf(SOLITUDE, 0xff300002);
const GJALUND = driverOf(MAIDEN, 0xff300003);
const MASLYN = driverOf(FERRY, 0xff300004);
function by(s, dx) { return [s.pos[0] + dx, s.pos[1], s.pos[2]]; }
w.moveTo(BRENNA, WHITERUN.world, by(WHITERUN, 900));
w.moveTo(ALDIS, WHITERUN.world, by(WHITERUN, 60));
w.moveTo(CORVIN, MAIDEN.world, by(MAIDEN, 60));
ALL.forEach(w.arrive);
w.run(30000);

function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function view(a) { return w.prop(a, 'thornswoodRideView') || {}; }
function gold(a) { return w.count(a, GOLD); }
function fares(hold) {
  const items = ((P().dropbox()[hold] || {}).items) || [];
  return items.filter(function (it) { return it.kind === 'fare'; }).reduce(function (s, it) { return s + it.count; }, 0);
}
function press(a, driver) { w.say(a, '/ride e ' + (driver >>> 0).toString(16)); return view(a); }
function ride(a, name) { w.say(a, '/ride ' + name); return view(a); }
function fareOf(v, name) { const s = (v.stops || []).filter(function (x) { return x.name === name; })[0]; return s ? s.fare : 0; }
function atStop(a, s) {
  const r = w.row(a);
  return r.worldOrCellDesc === s.world && Math.hypot(r.pos[0] - s.pos[0], r.pos[1] - s.pos[1]) < 1;
}

// ------------------------------------------------------- A. the panel --
let v = press(BRENNA, BJORLAM);
yes('A1 E on Bjorlam from across the yard: walk up first, and no panel (' + last(BRENNA) + ')',
    last(BRENNA) === 'Walk up to Bjorlam first.' && !w.prop(BRENNA, 'thornswoodRideView'));
w.moveTo(BRENNA, WHITERUN.world, by(WHITERUN, 80));
v = press(BRENNA, BJORLAM);
yes('A2 from beside him, his panel opens (' + JSON.stringify({ driver: v.driver, from: v.from, stops: (v.stops || []).length }) + ')',
    v.open === true && v.driver === 'Bjorlam' && v.from === 'Whiterun');
yes('A2 with Solitude at 20 and Riverwood, a village of his hold, at 10 (' + fareOf(v, 'Solitude') + ', ' + fareOf(v, 'Riverwood') + ')',
    fareOf(v, 'Solitude') === 20 && fareOf(v, 'Riverwood') === 10);
yes('A2 and no stop his carriage does not go to: no ferry landing, not Whiterun itself',
    v.stops.every(function (s) { return C.STOPS.some(function (x) { return x.line === 'carriage' && x.name === s.name; }) && s.name !== 'Whiterun'; }) &&
    fareOf(v, 'Raven Rock') === 0);

// --------------------------------------------------------- B. short --
press(ALDIS, BJORLAM);
v = ride(ALDIS, 'Solitude');
yes('B1 Aldis, with 15, asks for Solitude: refused, nothing taken, and she does not move (' + last(ALDIS) + ')',
    last(ALDIS) === 'The ride to Solitude is 20 gold and you do not have it. Nothing was taken.' &&
    gold(ALDIS) === 15 && w.row(ALDIS).worldOrCellDesc === WHITERUN.world &&
    Math.hypot(w.row(ALDIS).pos[0] - by(WHITERUN, 60)[0], w.row(ALDIS).pos[1] - WHITERUN.pos[1]) < 1);
yes('B1 and the panel stays up with the reason', v.open === true && /you do not have it/.test(v.note));

// ---------------------------------------------------------- C. a ride --
const box0 = fares('whiterun');
const did0 = w.did.length;
v = ride(BRENNA, 'Solitude');
yes('C1 Brenna rides to Solitude: 20 gold leave her pack (' + last(BRENNA) + ')',
    last(BRENNA) === 'You pay the 20 gold fare and ride to Solitude.' && gold(BRENNA) === 80);
yes('C1 she is at Solitude\'s carriage, in one move', atStop(BRENNA, SOLITUDE) &&
    w.did.slice(did0).filter(function (d) { return d[1] === BRENNA && d[2] === 'set' && d[3] === 'locationalData'; }).length === 1);
yes('C1 the panel closes', v.open === false);
yes('C1 and Whiterun\'s drop box holds the 20 as fares (' + box0 + ' to ' + fares('whiterun') + ')', fares('whiterun') === box0 + 20);

// ------------------------------------------- D. another hold's village --
w.moveTo(BRENNA, SOLITUDE.world, by(SOLITUDE, 60));
v = press(BRENNA, THAER);
yes('D1 Thaer\'s panel at Solitude has Rorikstead, Whiterun\'s village, at 20 (' + fareOf(v, 'Rorikstead') + ')',
    v.driver === 'Thaer' && fareOf(v, 'Rorikstead') === 20);
ride(BRENNA, 'Rorikstead');
yes('D1 she rides there: 20 more, into Solitude\'s box (' + last(BRENNA) + ')',
    gold(BRENNA) === 60 && atStop(BRENNA, stop('carriage:rorikstead')) && fares('solitude') === 20);
ride(BRENNA, 'Whiterun');
yes('D2 nobody drives from Rorikstead, so no ride starts there (' + last(BRENNA) + ')',
    last(BRENNA) === 'Walk up to a carriage or ferry driver first.' && gold(BRENNA) === 60);

// --------------------------------------------------- E. refusals --
w.moveTo(BRENNA, WHITERUN.world, by(WHITERUN, 60));
press(BRENNA, BJORLAM);
v = ride(BRENNA, 'Icewater Jetty');
yes('E1 a stop the carriage does not go to is refused, nothing taken, the panel up (' + last(BRENNA) + ')',
    last(BRENNA) === 'No ride to Icewater Jetty from here.' && gold(BRENNA) === 60 && v.open === true);
w.moveTo(BRENNA, WHITERUN.world, by(WHITERUN, 2000));
v = ride(BRENNA, 'Solitude');
yes('E2 with no driver near, refused, and the panel closes (' + last(BRENNA) + ')',
    last(BRENNA) === 'Walk up to a carriage or ferry driver first.' && v.open === false && gold(BRENNA) === 60);

// ------------------------------------------------- F. the crossing --
v = press(CORVIN, GJALUND);
yes('F1 the Northern Maiden\'s panel has Raven Rock at 40 (' + fareOf(v, 'Raven Rock') + ')', fareOf(v, 'Raven Rock') === 40);
const wh0 = fares('windhelm');
ride(CORVIN, 'Raven Rock');
yes('F1 Corvin crosses for 40, into Windhelm\'s drop box (' + last(CORVIN) + ')',
    gold(CORVIN) === 20 && atStop(CORVIN, RAVEN) && fares('windhelm') === wh0 + 40);
w.moveTo(CORVIN, FERRY.world, by(FERRY, 60));
v = press(CORVIN, MASLYN);
yes('F2 Raven Rock\'s own ferry goes to Tel Mithryn for 10 (' + fareOf(v, 'Tel Mithryn') + ')', fareOf(v, 'Tel Mithryn') === 10);
ride(CORVIN, 'Tel Mithryn');
yes('F2 and he rides it (' + last(CORVIN) + ')', gold(CORVIN) === 10 && atStop(CORVIN, stop('solstheim:telmithryn')) && fares('ravenrock') === 10);

// ---------------------------------------------------------- G. restart --
const kept = JSON.stringify(['whiterun', 'solitude', 'windhelm', 'ravenrock'].map(fares));
const r = w.restart();
yes('G1 the server restarts', r.loaded);
ALL.forEach(w.arrive);
w.run(30000);
const after = JSON.stringify(['whiterun', 'solitude', 'windhelm', 'ravenrock'].map(fares));
yes('G1 and the fares in the drop boxes are as they were (' + after + ')', after === kept);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
