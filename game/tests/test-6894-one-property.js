'use strict';
/*
  test-6894-one-property.js

  Scenario: systems/property.md, "A claim" and "Stewards and rent".

  #6894 (Patrick, 26 Nov): one character claimed two Whiterun farm plots
  and a tavern. A character claims one property of their own, and a
  steward of the hold grants any more. The WHOLE of game/gamemode.js over
  the stand-in server (tests/stand-in-server.js).

  Ysolda is Steward of Windhelm. Brenna and Aldis hold nothing.
  Jorn's Home, Broder's Home, Delmon's Shack and Hjerim are Windhelm's.

    A  Brenna claims Jorn's Home. At Broder's Home her claim is refused,
       naming the one she holds and the steward, and nothing is written.
    B  Ysolda, at Broder's Home, sees Grant beside Brenna and Aldis on the
       Office page, and not beside herself. She grants it to Brenna: the
       register has it as Brenna's, granted by Ysolda, with its own deed
       number, and the deed is in Brenna's pack. Both are told.
    C  The grant is not Brenna's own claim: she still cannot claim a third.
       Aldis, holding nothing, claims Delmon's Shack.
    D  Nobody but a steward of the hold grants: Aldis's grant is refused,
       and a steward cannot grant a building somebody holds or grant to
       herself.
    F  The farm is the ground outside a house's door, and plots are not
       claims of their own: Brenna, a farmer, holds every plot by Jorn's Home
       and by the Broder's Home she was granted, and claiming one adds no
       claim. Aldis's plot is refused to her, and hers to Aldis.
    E  A restart keeps the grant, and the limit: Brenna cannot claim Hjerim.
    Z  No handler threw, no engine call the engine does not have was made,
       and no timer threw.

  Read only, apart from its temp folders, which it removes.

      node game\tests\test-6894-one-property.js
*/
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks();
const yes = t.yes;

const w = standIn.world({
  name: 'one-property',
  files: {
    'private/allowed.json': {
      profiles: [1000, 1001, 3000],
      accounts: { 1000: 'acct-brenna', 1001: 'acct-aldis', 3000: 'acct-ysolda' },
      offices: { 3000: { steward: ['windhelm'] } }
    }
  }
});

const WINDHELM = '3c:Skyrim.esm';
const DOOR_BASE = '1a6f4:Skyrim.esm';
w.record(DOOR_BASE, 'DOOR');
w.record('15493:Thornswood-Content.esp', 'BOOK');
w.record('15494:Thornswood-Content.esp', 'KEYM');
w.record('15495:Thornswood-Content.esp', 'MISC');
const DEED = w.idOf('15493:Thornswood-Content.esp');
// Three Windhelm buildings, each by one of its doors (BUILDING_BY_DOOR).
const JORN = { door: w.idOf('11aeda:WindhelmSSE.esp'), building: '115c21:WindhelmSSE.esp' };
const BRODER = { door: w.idOf('11aedd:WindhelmSSE.esp'), building: '115c8e:WindhelmSSE.esp' };
const DELMON = { door: w.idOf('d8416:WindhelmSSE.esp'), building: '10665b:WindhelmSSE.esp' };
const HJERIM = { door: w.idOf('1028ed:Skyrim.esm'), building: '16778:Skyrim.esm' };
const STREET = [130000, -9000, 9000];
// The doors stand further apart than a farm reaches (claimRadius, 1200), so
// each house has ground of its own.
const APART = 5000;
function at(dx, dy) { return [STREET[0] + dx, STREET[1] + dy, STREET[2]]; }
[JORN, BRODER, DELMON, HJERIM].forEach(function (b, i) { w.ref(b.door, { base: DOOR_BASE, cell: WINDHELM, pos: at(i * APART, 0) }); });

const BRENNA = w.person(0xff000800, { profileId: 1000, name: 'Brenna', town: 'windhelm', cell: WINDHELM, pos: at(40, 0) });
const ALDIS = w.person(0xff000801, { profileId: 1001, name: 'Aldis', town: 'windhelm', cell: WINDHELM, pos: at(2 * APART, 40) });
const YSOLDA = w.person(0xff000802, { profileId: 3000, name: 'Ysolda', town: 'windhelm', cell: WINDHELM, pos: at(APART, 40) });

yes('P0 the whole gamemode loads over the stand-in', w.boot());
if (!w.loaded()) { t.done(w); }
[BRENNA, ALDIS, YSOLDA].forEach(w.arrive);
w.run(30000);
const P = () => w.box().__thornswoodProperty;
function last(a) { const h = w.heard(a); return h.length ? h[h.length - 1] : ''; }
function deeds(a) { return w.row(a).inventory.entries.filter(function (e) { return e.baseId === DEED; }); }
yes('P1 the four are Windhelm buildings nobody holds',
    [JORN, BRODER, DELMON, HJERIM].every(function (b) { return !P().holderOf(b.building); }));

// ------------------------------------------------------- A. one of her own --
w.activate(JORN.door, BRENNA);
w.say(BRENNA, '/claim');
yes('A1 Brenna claims Jorn\'s Home (' + last(BRENNA) + ')', (P().holderOf(JORN.building) || {}).by === 1000);
w.activate(BRODER.door, BRENNA);
w.say(BRENNA, '/claim');
yes('A2 at Broder\'s Home her claim is refused, naming the one she holds and the steward (' + last(BRENNA) + ')',
    /You hold Jorn's Home already, and a character claims one property of their own\. The Steward of Windhelm can grant you Broder's Home instead\./.test(last(BRENNA)) &&
    !P().holderOf(BRODER.building) && deeds(BRENNA).length === 1);

// ------------------------------------------------------------ B. a grant --
w.say(YSOLDA, '/office hold steward windhelm');
yes('B0 Ysolda holds Steward of Windhelm', P().isStewardOf(3000, 'windhelm'));
w.activate(BRODER.door, YSOLDA);
const view = P().officeView(YSOLDA, 3000) || {};
const grant = ((view.door || {}).grant || []).map(function (p) { return p.name; });
yes('B1 at Broder\'s Home the Office page offers Grant beside Brenna and Aldis, not beside her (' + grant.join(', ') + ')',
    grant.join(',') === 'Aldis,Brenna');
w.say(YSOLDA, '/office grant 1000');
const granted = P().holderOf(BRODER.building) || {};
const claim = P().claims()[BRODER.building] || {};
yes('B2 she grants it to Brenna: hers, granted by Ysolda, with its own deed number (' + last(YSOLDA) + ')',
    granted.by === 1000 && claim.granted && claim.granted.by === 3000 && claim.deed > 0 &&
    claim.deed !== (P().claims()[JORN.building] || {}).deed);
yes('B2 the deed is in Brenna\'s pack', deeds(BRENNA).length === 2 &&
    deeds(BRENNA).some(function (e) { return /Broder's Home/.test(e.name || ''); }));
yes('B2 both are told', /You grant Broder's Home to Brenna\. The deed is in their pack\./.test(last(YSOLDA)) &&
    w.heard(BRENNA).some(function (l) { return /^Ysolda grants you Broder's Home\. The deed is in your pack\./.test(l); }));
const after = P().officeView(YSOLDA, 3000) || {};
yes('B3 a held building offers no Grant', !(after.door || {}).grant);

// ---------------------------------------------- C. the grant is not hers --
w.activate(DELMON.door, BRENNA);
w.say(BRENNA, '/claim');
yes('C1 Brenna still cannot claim a third: Jorn\'s Home is her own (' + last(BRENNA) + ')',
    /You hold Jorn's Home already/.test(last(BRENNA)) && !P().holderOf(DELMON.building));
w.activate(DELMON.door, ALDIS);
w.say(ALDIS, '/claim');
yes('C2 Aldis, holding nothing, claims Delmon\'s Shack (' + last(ALDIS) + ')', (P().holderOf(DELMON.building) || {}).by === 1001);

// -------------------------------------------------------- D. who grants --
w.activate(JORN.door, ALDIS);
w.say(ALDIS, '/office grant 1000');
yes('D1 Aldis is no steward, and her grant is refused (' + last(ALDIS) + ')',
    /Only the Steward of Windhelm or its Jarl/.test(last(ALDIS)) && (P().holderOf(JORN.building) || {}).by === 1000);
w.activate(DELMON.door, YSOLDA);
w.say(YSOLDA, '/office grant 1000');
yes('D2 a building somebody holds is not granted (' + last(YSOLDA) + ')',
    /Delmon's Shack is held by Aldis\. End that claim first to grant it\./.test(last(YSOLDA)) &&
    (P().holderOf(DELMON.building) || {}).by === 1001);
w.say(YSOLDA, '/office grant 3000');
yes('D3 nor does a steward grant to herself (' + last(YSOLDA) + ')', /Pick somebody in the world/.test(last(YSOLDA)));

// ------------------------------------------------------- F. farm plots --
const CARROT = "1503ff:JK's Whiterun's Outskirts.esp";
w.record(CARROT, 'FLOR');
const PLOTS = { jorn: [0xff100001, 0xff100002], broder: [0xff100003], delmon: [0xff100004] };
[[PLOTS.jorn[0], 0], [PLOTS.jorn[1], 0], [PLOTS.broder[0], APART], [PLOTS.delmon[0], 2 * APART]].forEach(function (p, i) {
  w.ref(p[0], { base: CARROT, cell: WINDHELM, pos: at(p[1] + 200 + i * 30, 300) });
});
const PR = w.box().__thornswoodProgression, CH = w.box().__thornswoodCharacter;
[BRENNA, ALDIS].forEach(function (a) { CH.writeState(a, PR.pickClass(PR.fresh(), 'farmer').state, true); });
const farms = () => JSON.stringify([1000, 1001].map(function (pid) { return w.box().__thornswoodFarming.farmOf(pid); }));
function plotClaim(actor, ref, dx) {
  w.moveTo(actor, WINDHELM, at(dx + 200, 260));
  w.say(actor, '/claim ' + (ref >>> 0).toString(16));
  return last(actor);
}
const farmsBefore = farms();
const f1 = [plotClaim(BRENNA, PLOTS.jorn[0], 0), plotClaim(BRENNA, PLOTS.jorn[1], 0), plotClaim(BRENNA, PLOTS.broder[0], APART)];
yes('F1 Brenna holds both plots by Jorn\'s Home and the one by the Broder\'s Home she was granted (' + f1.join(' | ') + ')',
    f1.every(function (l) { return /You already hold this ground/.test(l); }));
yes('F1 and claiming them made no claim of their own', farms() === farmsBefore &&
    (P().holderOf(JORN.building) || {}).by === 1000 && (P().holderOf(BRODER.building) || {}).by === 1000);
const f2 = plotClaim(BRENNA, PLOTS.delmon[0], 2 * APART);
yes('F2 the plot by Aldis\'s house is refused to Brenna (' + f2 + ')', /This ground is already held by Aldis/.test(f2));
const f3 = plotClaim(ALDIS, PLOTS.jorn[0], 0);
yes('F3 and Brenna\'s to Aldis (' + f3 + ')', /This ground is already held by Brenna/.test(f3) && farms() === farmsBefore);
const f4 = plotClaim(ALDIS, PLOTS.delmon[0], 2 * APART);
yes('F4 Aldis holds the one by her own (' + f4 + ')', /You already hold this ground/.test(f4));

// ------------------------------------------------------------ E. restart --
const r = w.restart();
yes('E1 the server restarts and the gamemode loads again', r.loaded);
[BRENNA, ALDIS, YSOLDA].forEach(w.arrive);
w.run(30000);
yes('E1 the grant is kept', ((P().claims()[BRODER.building] || {}).granted || {}).by === 3000 &&
    (P().holderOf(BRODER.building) || {}).by === 1000);
w.activate(HJERIM.door, BRENNA);
w.say(BRENNA, '/claim');
yes('E2 and so is the limit (' + last(BRENNA) + ')', /You hold Jorn's Home already/.test(last(BRENNA)));

// ------------------------------------------------------------- Z. clean --
yes('Z no handler threw and nothing the engine would refuse was done (' + w.faults.slice(0, 3).join(' | ') + ')', w.faults.length === 0);
yes('Z no timer threw (' + w.threw.slice(0, 2).join(' | ') + ')', w.threw.length === 0);
yes('Z the gamemode logged no handler error (' + w.logged(/\] on[A-Z][A-Za-z]+ threw/).slice(0, 2).join(' | ') + ')',
    w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
