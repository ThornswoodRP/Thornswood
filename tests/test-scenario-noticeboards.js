'use strict';
/*
  test-scenario-noticeboards.js

  Scenario: systems/noticeboards.md
  Scenario: systems/property.md

  #5198. Windhelm's notice board and its drop box, end to end: the WHOLE of
  game/gamemode.js over the stand-in server (tests/stand-in-server.js), every
  step a message the engine sends in the order it sends them.

  Brenna holds Jorn's Home, on 50 gold of rent a week that her hold's
  steward set eight days ago, so 50 is owed. Aldis is new in town. Hroki
  is the Steward of Windhelm by the Discord role the site lists.

    A  At start the server stands the board and its drop box: two
       references of the board's and the box's records, at Windhelm's spot
       beside its anchor, the box on the board's post.
    B  E on the board: onActivate refuses the engine's own handling and the
       board's panel is written for her instead; E on the box writes the
       box's panel and not the board's.
    C  A notice, posted at the board with its title and body: 20 gold leave
       her pack, the notice is on the board, and the hold's ledger has the
       20. Away from the board the same line takes nothing.
    D  A job with a 15 gold reward: 45 gold leave her pack. Aldis takes it;
       Brenna cannot take her own. She says it is done and the 15 is his.
    E  Rent through the box: the door's rent line says 50 owed. She puts
       60 gold in the box: 50 of it pays the rent, the rent is 0 owed, and
       the box shows her 60 and no more. Taking her gold back out owes the
       rent again. Aldis, who is no steward, cannot set the rent. Hroki's
       account holds the Steward role, but he sets nothing until this
       character takes the office on the Office page; then he sets the rent
       to 30 at the door, and what was owed stays owed.
    F  A restart: the notice, the job's state, the rent and the box are as
       they were.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node tests\test-scenario-noticeboards.js
*/
const standIn = require('./stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 9, 26, 18, 0, 0);
const HOUSE = '115c21:WindhelmSSE.esp';          // Jorn's Home
const w = standIn.world({
  name: 'noticeboards', start: START,
  files: {
    'private/allowed.json': {
      profiles: [1000, 1001, 2000],
      accounts: { 1000: 'acct-brenna', 1001: 'acct-aldis', 2000: 'acct-hroki' },
      offices: { 2000: { steward: ['windhelm'] } }
    },
    'private/property.json': {
      claims: { [HOUSE]: { by: 1000, name: 'Brenna', at: START - 20 * DAY, touched: START - DAY, locked: false,
                           rent: { amount: 50, everyDays: 7, owed: 0, since: START - 8 * DAY } } }
    }
  }
});

// ---------------------------------------------------------- the square --
const CITY = '1691d:Skyrim.esm';                  // Windhelm
const SPOT = [134265.1, 35842.3, -12397.5];       // Windhelm's board, BOARD_SITES
function by(dx, dy) { return [SPOT[0] + dx, SPOT[1] + dy, SPOT[2]]; }
const BOARD_BASE = '593b:Thornswood-Content.esp', BOX_BASE = '154d0:Thornswood-Content.esp';
w.record(BOARD_BASE, 'ACTI');
w.record(BOX_BASE, 'CONT');
w.record('1a6f4:Skyrim.esm', 'DOOR');
w.ref(w.idOf('23592:Skyrim.esm'), { base: '1a2b3:Skyrim.esm', cell: CITY, pos: by(876, 0) }); // the woodpile it stands by
const FRONT = w.ref(w.idOf('11aeda:WindhelmSSE.esp'), { base: '1a6f4:Skyrim.esm', cell: CITY, pos: by(2000, 0) });
const GOLD = 0xf;

const BRENNA = w.person(0xff000800, { profileId: 1000, name: 'Brenna', town: 'windhelm', cell: CITY, pos: by(100, 0),
  inventory: { entries: [{ baseId: GOLD, count: 200 }] } });
const ALDIS = w.person(0xff000801, { profileId: 1001, name: 'Aldis', town: 'windhelm', cell: CITY, pos: by(-100, 50) });
const HROKI = w.person(0xff000802, { profileId: 2000, name: 'Hroki', town: 'windhelm', cell: CITY, pos: by(2050, 0) });

yes('P0 the whole gamemode loads over the stand-in', w.boot() || !console.log(w.loadError()));
if (!w.loaded()) { t.done(w); }
[BRENNA, ALDIS, HROKI].forEach(w.arrive);
w.run(30000);
const P = () => w.box().__thornswoodProperty;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function gold(a) { return w.count(a, GOLD); }
function noticesOnDisk() { const r = w.readPrivate('property.json'); return (r && r.notices && r.notices.windhelm) || []; }
function claimOnDisk() { const r = w.readPrivate('property.json'); return r && r.claims ? r.claims[HOUSE] : null; }

// ------------------------------------------------------- A. standing --
const b = P().boards().windhelm;
yes('A1 the server stands Windhelm\'s board at its spot (' + JSON.stringify(b && { ref: b.ref, box: b.boxRef }) + ')',
    !!b && !!w.row(b.ref) && w.row(b.ref).baseDesc === BOARD_BASE && w.row(b.ref).worldOrCellDesc === CITY &&
    Math.abs(w.row(b.ref).pos[0] - SPOT[0]) < 1 && Math.abs(w.row(b.ref).pos[1] - SPOT[1]) < 1);
yes('A1 and its drop box on the board\'s post, within reach of the spot', !!b && !!w.row(b.boxRef) &&
    w.row(b.boxRef).baseDesc === BOX_BASE && w.row(b.boxRef).worldOrCellDesc === CITY &&
    Math.hypot(w.row(b.boxRef).pos[0] - SPOT[0], w.row(b.boxRef).pos[1] - SPOT[1]) < 400);

// ---------------------------------------------------------- B. presses --
const b1 = w.activate(b.ref, BRENNA);
yes('B1 E on the board: onActivate refuses the engine\'s own handling', !b1.allowed && !b1.opened);
yes('B1 and the board\'s panel is written for her', !!w.prop(BRENNA, 'thornswoodBoardOpen'));
const boxBefore = w.prop(BRENNA, 'thornswoodBoxView');
const boardBefore = JSON.stringify(w.prop(BRENNA, 'thornswoodBoardOpen'));
const b2 = w.activate(b.boxRef, BRENNA);
yes('B2 E on the box: the engine opens no container', !b2.allowed && !b2.opened && !w.prop(b.boxRef, 'isOpen'));
yes('B2 the box\'s panel is written, and the board\'s is not written again',
    !!w.prop(BRENNA, 'thornswoodBoxView') && JSON.stringify(w.prop(BRENNA, 'thornswoodBoxView')) !== JSON.stringify(boxBefore) &&
    JSON.stringify(w.prop(BRENNA, 'thornswoodBoardOpen')) === boardBefore);

// ----------------------------------------------------------- C. notice --
let g0 = gold(BRENNA);
const fund0 = Number(P().funds().windhelm) || 0;
w.say(BRENNA, '/notice Lost cat::Grey, answers to Whiskers');
const n0 = noticesOnDisk();
yes('C1 a notice: 20 gold leave her pack (' + g0 + ' to ' + gold(BRENNA) + ')', gold(BRENNA) === g0 - 20);
yes('C1 the notice is on the board, title and body', n0.length === 1 && n0[0].title === 'Lost cat' && n0[0].text === 'Grey, answers to Whiskers' && !n0[0].job);
yes('C1 and the hold\'s ledger has the 20', (Number(P().funds().windhelm) || 0) === fund0 + 20);
w.moveTo(ALDIS, CITY, by(3000, 0));
g0 = gold(ALDIS);
w.say(ALDIS, '/notice Away::from the board');
yes('C2 away from the board the same line takes nothing and posts nothing (' + last(ALDIS) + ')',
    gold(ALDIS) === g0 && noticesOnDisk().length === 1 && /notice board/.test(last(ALDIS)));
w.moveTo(ALDIS, CITY, by(-100, 50));

// -------------------------------------------------------------- D. job --
g0 = gold(BRENNA);
w.say(BRENNA, '/job 15 Firewood::Ten logs to the Palace of the Kings');
const job = noticesOnDisk()[1];
yes('D1 a job with a 15 gold reward: 45 gold leave her pack', gold(BRENNA) === g0 - 45 && !!job && job.job && job.pay === 15);
w.say(BRENNA, '/take 2');
yes('D2 she cannot take her own job (' + last(BRENNA) + ')', last(BRENNA) === 'That is your own job.' && !noticesOnDisk()[1].taken);
w.say(ALDIS, '/take 2');
yes('D2 Aldis takes it', noticesOnDisk()[1].taken === 1001);
const a0 = gold(ALDIS);
w.say(BRENNA, '/job done 2');
yes('D3 she says it is done and the 15 gold reward is his (' + last(BRENNA) + ')', gold(ALDIS) === a0 + 15);

// -------------------------------------------------------- E. rent, box --
w.activate(FRONT, BRENNA);
w.say(BRENNA, '/rent');
yes('E1 at her door the rent line says 50 owed (' + last(BRENNA) + ')', /50 gold every 7 days, 50 owed/.test(last(BRENNA)));
w.moveTo(BRENNA, CITY, by(100, 0));
g0 = gold(BRENNA);
w.say(BRENNA, '/dropbox gold 60');
yes('E2 60 gold into the box leave her pack, and 50 of it pays the rent (' + last(BRENNA) + ')',
    gold(BRENNA) === g0 - 60 && claimOnDisk().rent.owed === 0);
const view = w.prop(BRENNA, 'thornswoodBoxView');
const mine = view && JSON.stringify(view);
yes('E2 the box shows her own 60', !!mine && mine.indexOf('60') >= 0);
const item = (P().dropbox().windhelm.items || []).filter(function (x) { return x.by === 1000 && x.kind === 'gold'; })[0];
yes('E2 the box holds it as hers, with the rent it paid', !!item && item.count === 60 && item.rent && item.rent[0].amount === 50);
w.say(BRENNA, '/dropbox take ' + item.n + ' 60');
yes('E3 taking her gold back out returns it and owes the rent again (' + last(BRENNA) + ')',
    gold(BRENNA) === g0 && claimOnDisk().rent.owed === 50);
w.activate(FRONT, ALDIS);
w.say(ALDIS, '/rent 30');
yes('E4 Aldis, no steward, cannot set the rent (' + last(ALDIS) + ')', last(ALDIS) === 'Only a steward sets rent.' && claimOnDisk().rent.amount === 50);
w.activate(FRONT, HROKI);
w.say(HROKI, '/rent 30');
yes('E4 Hroki\'s account holds the role, but until this character takes the office it sets nothing (' + last(HROKI) + ')',
    claimOnDisk().rent.amount === 50);
w.say(HROKI, '/office hold steward windhelm');
yes('E4 on the Office page he chooses this character for Steward of Windhelm (' + last(HROKI) + ')', /holds Steward of Windhelm now/.test(last(HROKI)));
w.activate(FRONT, HROKI);
w.say(HROKI, '/rent 30');
yes('E4 Hroki, Steward of Windhelm, sets it to 30 at the door, and what is owed stays owed (' + last(HROKI) + ')',
    claimOnDisk().rent.amount === 30 && claimOnDisk().rent.owed === 50);

// ---------------------------------------------------------- F. restart --
const keep = JSON.stringify(w.readPrivate('property.json'));
function placedCount() { return w.did.filter(function (d) { return d[2] === 'placed'; }).length; }
const placedBefore = placedCount();
const r = w.restart();
yes('F1 the server restarts and the gamemode loads again', r.loaded);
[BRENNA, ALDIS, HROKI].forEach(w.arrive);
w.run(30000);
const after = w.readPrivate('property.json');
yes('F1 the notice and the job are as they were', JSON.stringify(after.notices) === JSON.stringify(JSON.parse(keep).notices));
yes('F1 the rent is as it was', JSON.stringify(after.claims[HOUSE].rent) === JSON.stringify(JSON.parse(keep).claims[HOUSE].rent));
yes('F1 Hroki is still the steward', w.box().__thornswoodProperty.isStewardOf(2000, 'windhelm'));
yes('F1 the board and the box still stand, and nothing was put down again (' + (placedCount() - placedBefore) + ' placed)',
    P().boards().windhelm.ref === b.ref && P().boards().windhelm.boxRef === b.boxRef && placedCount() === placedBefore);

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
