'use strict';
/*
  test-2551-building-holds.js

      node tests/test-2551-building-holds.js

  #2551, Patrick, 16 October, answer C: a Steward evicts and sets rent only
  in their own hold, with a table giving every claimable building the hold
  its door opens onto. scripts/dev/Build-BuildingHolds.py measures it out of
  the plugins into game/data/building-holds.json and the BUILDING_HOLD table
  of the gamemode. This holds all of it together:

    T  the table: every building the server claims is in it with one of the
       ten holds, or refused with the reason, never both; each answer
       follows the rule it says it followed
    G  the gamemode's BUILDING_HOLD table is the builder's, building for building
    X  DATA.cellToHold agrees with the table on every building it names, or
       the table says which is right and why
    B  the table was built against the collection's own bytes and the
       repository's own plugins (Thornswood-Last.esp as its manifest names
       it, #2791), so a new revision or a content change
       without a rebuild turns this red
    S  the real eviction and rent over every building in the table: whoever
       keeps its hold (its Steward or its Jarl, isStewardOf, which
       test-offices.js and test-1638-office.js hold) ends a claim and sets
       rent there; whoever keeps any of the nine other holds is refused,
       told whose it is, and nothing changes; a building refused a hold is
       nobody's to settle; somebody who is neither staff nor a steward is
       refused everywhere. Staff (Patrick, 17 Oct, decision 1, B) set rent,
       take it off and end the claim at every building, the ones with no
       hold included, each press one row in the staff log; a press the chat
       did not prove, or with no staff log to write to, is refused; staff
       who keep the building's hold act as its steward
    L  the staff log is the staff commands' own: the staff block's record,
       run for real, writes the row to for-bot/moderation.log with the
       building and its hold; the staff test is the chat block's isStaff;
       the line a press arrives on reaches evict and rentCmd; the bot has a
       sentence for each

  On a machine with the game (C:\Thornswood\Game\Data, or THORNSWOOD_DATA)
  holding the collection's bytes it also runs the builder with --check: the
  plugins give the committed table and block.
*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('').replace(/^\uFEFF/, '');
const TABLE = path.join(ROOT, 'game', 'data', 'building-holds.json');
const DATA = path.join(ROOT, 'game', 'data', 'data.json');
const DOORS = path.join(ROOT, 'game', 'data', 'doors.json');
const COLLECTION = path.join(ROOT, 'records', 'collection-plugins.json');
const LAST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const TOOL = path.join(ROOT, 'scripts', 'dev', 'Build-BuildingHolds.py');
const gm = require('./gamemode-tables.js').joined(read(path.join(ROOT, 'game', 'gamemode.js')));
const OURS = ['Thornswood-Content.esp', 'Thornswood-Last.esp'];
const AFTER = ['Thornswood-Last.esp'];
const HOLDS = ['whiterun', 'solitude', 'riften', 'markarth', 'windhelm',
               'falkreath', 'morthal', 'dawnstar', 'winterhold', 'ravenrock'];
const TOWN_OF_HOLD = {
  WhiterunHoldLocation: 'whiterun', HaafingarHoldLocation: 'solitude', RiftHoldLocation: 'riften',
  ReachHoldLocation: 'markarth', EastmarchHoldLocation: 'windhelm', FalkreathHoldLocation: 'falkreath',
  HjaalmarchHoldLocation: 'morthal', PaleHoldLocation: 'dawnstar', WinterholdHoldLocation: 'winterhold',
  DLC2SolstheimLocation: 'ravenrock'
};

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
/* One function out of src (the property block) by name, once, to the brace that closes it. */
function fnSrc(src, name) {
  if (!src) { return null; }
  const head = '\n  function ' + name + '(';
  const a = src.indexOf(head);
  if (a < 0 || src.indexOf(head, a + 1) >= 0) { return null; }
  const b = src.indexOf('{', a);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') { d++; }
    else if (src[i] === '}') { d--; if (d === 0) { return src.slice(a + 1, i + 1); } }
  }
  return null;
}
function constObject(re) {
  const m = re.exec(gm);
  return m ? JSON.parse(m[1]) : null;
}

const table = JSON.parse(read(TABLE));
const rows = table.buildings || {};
const refused = table.refused || {};
const NAME = constObject(/\nconst BUILDING_NAME = (\{[^\n]*\});/);
const served = NAME ? Object.keys(NAME) : [];

// ---------------------------------------------------------------- T
yes('T1 the table is the builder\'s, for #2551', table.builtBy === 'scripts/dev/Build-BuildingHolds.py' && table.issue === 2551);
const doors = JSON.parse(read(DOORS));
yes('T2 the gamemode serves the buildings doors.json has (' + served.length + ')', served.length > 800 &&
    served.length === Object.keys(doors.buildings).length && served.every((b) => !!doors.buildings[b]));
const both = served.filter((b) => rows[b] && refused[b]);
const neither = served.filter((b) => !rows[b] && !refused[b]);
const extra = Object.keys(rows).concat(Object.keys(refused)).filter((b) => !NAME || !NAME[b]);
yes('T3 every one is in the table with a hold or refused, never both, and nothing else is' +
    (both.length + neither.length + extra.length ? ' (both ' + both.length + ', neither ' + neither.length + ', extra ' + extra.length + ')' : ''),
    served.length > 0 && both.length === 0 && neither.length === 0 && extra.length === 0);
const c = table.counts || {};
yes('T4 the counts are the rows: ' + Object.keys(rows).length + ' measured, ' + Object.keys(refused).length + ' refused',
    c.buildings === served.length && c.measured === Object.keys(rows).length && c.refused === Object.keys(refused).length &&
    c.byDoors + c.byDoorsOwnLocationPicks + c.byOwnLocation === c.measured);
yes('T5 every hold is one of the ten', Object.keys(rows).every((b) => HOLDS.indexOf(rows[b].hold) !== -1));
const holdLocs = table.holdLocations || {};
yes('T6 the ten hold locations are the records the rule reads, each to its hold',
    Object.keys(TOWN_OF_HOLD).every((e) => holdLocs[e] && holdLocs[e].hold === TOWN_OF_HOLD[e]) &&
    Object.keys(holdLocs).length === 10);
const placeHolds = (r) => Array.from(new Set((r.opensOnto || []).map((p) => p.hold).filter(Boolean))).sort();
const badRule = Object.keys(rows).filter((b) => {
  const r = rows[b];
  const hs = placeHolds(r);
  if (r.how === 'doors') { return !(hs.length === 1 && hs[0] === r.hold); }
  if (r.how === 'own location') { return !(hs.length === 0 && !!r.ownLocation); }
  return !(hs.length > 1 && hs.indexOf(r.hold) !== -1 && r.how === 'doors open onto ' + hs.join(' and ') + '; its own location picks');
});
yes('T7 each answer follows the rule it names: one hold where the doors open, or the building\'s own location ' +
    'between two, or its own location when the doors give none' + (badRule.length ? ' (not: ' + badRule.slice(0, 4).join(', ') + ')' : ''),
    badRule.length === 0);
const overOwn = Object.keys(rows).filter((b) => rows[b].ownLocationHold);
yes('T8 where the doors and the building\'s own location name two holds, the doors decide and the table says so (' +
    overOwn.length + ')', overOwn.every((b) => rows[b].how === 'doors' && rows[b].ownLocationHold !== rows[b].hold) &&
    c.doorsOverOwnLocation === overOwn.length);
yes('T9 every building refused says why, and names no hold', Object.keys(refused).every((b) =>
  typeof refused[b].why === 'string' && refused[b].why.length > 20 && !refused[b].hold));

// ---------------------------------------------------------------- G
// The gamemode reads BUILDING_HOLD from game/gamemode-tables (#5191), in
// the property block.
const prop = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const gmText = read(path.join(ROOT, 'game', 'gamemode.js'));
const propText = slice(gmText, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('G1 the property block reads the BUILDING_HOLD table', !!propText && propText.split("var BUILDING_HOLD = table('BUILDING_HOLD');").length === 2);
let inBlock = null;
try { inBlock = require('./gamemode-tables.js').table('BUILDING_HOLD'); } catch (e) { inBlock = null; }
yes('G2 the table is the builder\'s, building for building (' + (inBlock ? Object.keys(inBlock).length : 0) + ')', !!inBlock &&
    Object.keys(inBlock).length === Object.keys(rows).length &&
    Object.keys(rows).every((b) => inBlock[b] === rows[b].hold));

// ---------------------------------------------------------------- X
const c2h = JSON.parse(read(DATA)).cellToHold || {};
const named = served.filter((b) => Object.prototype.hasOwnProperty.call(c2h, b));
const disagree = (table.cellToHold && table.cellToHold.disagree) || {};
const wrong = named.filter((b) => TOWN_OF_HOLD[c2h[b]] !== (rows[b] ? rows[b].hold : undefined) &&
  !(disagree[b] && typeof disagree[b].right === 'string' && disagree[b].right.length > 20));
yes('X1 DATA.cellToHold names ' + named.length + ' of the buildings, and agrees with the table on each, or the table says ' +
    'which is right and why' + (wrong.length ? ' (not: ' + wrong.slice(0, 4).join(', ') + ')' : ''),
    named.length > 500 && wrong.length === 0);
yes('X2 and the table\'s own count of that is right', table.cellToHold && table.cellToHold.named === named.length &&
    table.cellToHold.agree === named.length - Object.keys(disagree).length);

// ---------------------------------------------------------------- B
const built = table.builtAgainst || [];
const record = JSON.parse(read(COLLECTION));
const rec = {};
for (const r of record.plugins) { rec[r.name.toLowerCase()] = r; }
const order = JSON.parse(read(LAST)).loadOrder.concat(AFTER);
yes('B1 the table records the bytes of every plugin of the load order it read (' + built.length + ')',
    built.length === order.length && built.every((r, i) => r.name === order[i] && /^[0-9a-f]{64}$/.test(r.sha256) && r.size > 0));
const other = built.filter((r) => OURS.indexOf(r.name) < 0 &&
  !(rec[r.name.toLowerCase()] && rec[r.name.toLowerCase()].sha256.toLowerCase() === r.sha256 && rec[r.name.toLowerCase()].size === r.size));
yes('B2 every plugin but ours is the collection\'s own bytes, revision ' + record.revision +
    (other.length ? ' (not: ' + other.slice(0, 4).map((r) => r.name).join(', ') + '; rebuild the table)' : ''), other.length === 0);
// Thornswood-Last.esp is in no repository since #2791 step 3: its bytes are
// the ones its manifest names, which its recipe makes.
const lastNamed = JSON.parse(read(LAST)).plugin;
const stale = OURS.filter((n) => {
  const row = built.find((r) => r.name === n);
  if (n === lastNamed.name) { return !row || row.sha256 !== lastNamed.sha256 || row.size !== lastNamed.size; }
  const p = path.join(ROOT, 'game', 'content', n);
  return !row || !fs.existsSync(p) || row.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
});
yes('B3 and ours are the repository\'s, Thornswood-Last.esp the one its manifest names (after a content change, run scripts/mods/Rebuild-ContentTables.ps1)' +
    (stale.length ? ' (not: ' + stale.join(', ') + ')' : ''), stale.length === 0);

// ---------------------------------------------------------------- S
/*
  The real evict and rentCmd, with the real building names and holds, over
  a door register and the office readers as a table: who keeps which hold as
  a steward (Steward of it, or its Jarl). Staff (#2551, Patrick, 17 Oct,
  decision 1, B) are the chat block's staff test as a table, and the staff
  block's proof and log as a stand-in that keeps every row it is handed.
*/
const LIFT = ['holdOfBuilding', 'notStewardHere', 'nameOf', 'evict', 'rentCmd',
              'isStaffHere', 'settleAs', 'settleWhere', 'staffRecord'];
const lifted = LIFT.map((n) => fnSrc(prop, n));
const holdTown = slice(gm, '  var HOLD_TOWN = {', '};');
const officeAtDoor = /\n  var OFFICE_AT_DOOR = '[^\n]*';/.exec(gm);
yes('S0 the eviction, the rent and the building\'s hold are in the property block, each once' +
    (lifted.some((s) => !s) ? ' (missing: ' + LIFT.filter((n, i) => !lifted[i]).join(', ') + ')' : ''),
    lifted.every((s) => !!s) && !!holdTown && !!officeAtDoor && !!inBlock && !!NAME);

const OWNER = 7, STEW = 100, NOBODY = 500, STAFF = 600;
const PROVEN = { proven: true };
const UNPROVEN_SAID = 'Staff commands need the chat to have proved who you are, and this connection has not.';
/*
  keeps: the holds STEW keeps as a steward. staff: the profiles the chat
  block's staff test says are staff. The staff block's unproven refuses a
  line the chat did not prove, as the real one does, and record keeps rows.
*/
function steward(keeps, staff) {
  staff = staff || [];
  const claims = {};
  let at = null;
  const said = [];
  const logged = [];
  const plogged = [];
  const g = {
    __thornswoodIsStaff: function (pid) { return staff.indexOf(pid) !== -1; },
    __thornswoodStaff: {
      unproven: function (cmd) { return cmd && cmd.proven === true ? '' : UNPROVEN_SAID; },
      record: function () { logged.push(Array.prototype.slice.call(arguments)); }
    }
  };
  const make = new Function('BUILDING_HOLD', 'BUILDING_NAME', 'claims', 'here', 'isSteward', 'isStewardOf',
    'holderOf', 'save', 'pushAll', 'plog', 'redrawPanel', 'rentDue', 'globalThis', 'g', 'personName',
    // What an evicted holder owed stays theirs (#3950): tests/test-3893-rent-arrears.js; no rent here.
    'keepOwed',
    holdTown + '\n' + officeAtDoor[0] + '\n' + lifted.join('\n') + '\nreturn { evict: evict, rentCmd: rentCmd };');
  const f = make(inBlock, NAME, claims, function () { return at; },
    function (pid) { return pid === STEW && keeps.length > 0; },
    function (pid, hold) { return pid === STEW && keeps.indexOf(hold) !== -1; },
    function (b) { return claims[b] || null; }, function () { }, function () { },
    function () { plogged.push(Array.prototype.join.call(arguments, ' ')); }, function () { },
    function () { }, {}, g, function (actorId) { return actorId === 1 ? 'Hadvar' : 'somebody'; },
    function () { });
  return {
    at: function (b) { at = b; claims[b] = { by: OWNER, name: 'Alice', at: 1, touched: Date.now() }; said.length = 0; },
    evict: function (pid, cmd) {
      f.evict(1, pid, function (p, m) { said.push(m); }, cmd === undefined ? PROVEN : cmd); return said.slice();
    },
    rent: function (pid, n, cmd) {
      f.rentCmd(['/rent', String(n)], 1, pid, function (p, m) { said.push(m); }, cmd === undefined ? PROVEN : cmd);
      return said.slice();
    },
    claims: claims, logged: logged, plogged: plogged
  };
}

if (lifted.every((s) => !!s) && holdTown && officeAtDoor && inBlock && NAME) {
  const keepers = {};
  HOLDS.forEach((h) => { keepers[h] = steward([h]); });
  let allowed = 0, refusedOk = 0, badIn = [], badOut = [];
  for (const b of Object.keys(rows)) {
    const h = rows[b].hold;
    // Its own hold's steward: the rent, then the eviction.
    const k = keepers[h];
    k.at(b);
    k.rent(STEW, 25);
    const rentSet = k.claims[b] && k.claims[b].rent && k.claims[b].rent.amount === 25;
    k.evict(STEW);
    if (rentSet && !k.claims[b]) { allowed++; } else { badIn.push(b); }
    // Every other hold's steward.
    for (const o of HOLDS) {
      if (o === h) { continue; }
      const s = keepers[o];
      s.at(b);
      const t1 = s.evict(STEW);
      const t2 = s.rent(STEW, 25);
      const town = { ravenrock: 'Raven Rock' }[h] || h.charAt(0).toUpperCase() + h.slice(1);
      const whose = NAME[b] + ' answers to ' + town + '. Only the Steward of ' + town + ' or its Jarl ends a claim or sets rent there.';
      if (s.claims[b] && s.claims[b].by === OWNER && !s.claims[b].rent && t1[0] === whose && t2[1] === whose) { refusedOk++; }
      else { badOut.push(b + ' by ' + o); }
    }
  }
  yes('S1 at every one of the ' + Object.keys(rows).length + ' buildings with a hold, the steward of that hold sets the rent ' +
      'and ends the claim' + (badIn.length ? ' (not: ' + badIn.slice(0, 3).join(', ') + ')' : ''), allowed === Object.keys(rows).length);
  yes('S2 and the steward of each of the nine other holds is refused both, told whose it is, and nothing changes (' +
      refusedOk + ' refusals)' + (badOut.length ? ' (not: ' + badOut.slice(0, 3).join(', ') + ')' : ''),
      refusedOk === Object.keys(rows).length * 9 && badOut.length === 0);
  let none = 0, noneBad = [];
  for (const b of Object.keys(refused)) {
    let ok = true;
    for (const h of HOLDS) {
      const s = keepers[h];
      s.at(b);
      const t = s.evict(STEW);
      s.rent(STEW, 25);
      if (!(s.claims[b] && !s.claims[b].rent &&
            t[0] === NAME[b] + ' answers to no hold the server knows, so no steward ends a claim or sets rent there.')) { ok = false; }
    }
    if (ok) { none++; } else { noneBad.push(b); }
  }
  yes('S3 at each of the ' + Object.keys(refused).length + ' buildings refused a hold, no steward of any hold ends a claim ' +
      'or sets rent, and each is told why' + (noneBad.length ? ' (not: ' + noneBad.slice(0, 3).join(', ') + ')' : ''),
      none === Object.keys(refused).length);
  const all = steward(HOLDS.slice());
  const breezehome = '165a8:Skyrim.esm';
  all.at(breezehome);
  all.evict(STEW);
  yes('S4 Breezehome is Whiterun\'s, and somebody who keeps all ten ends a claim there', rows[breezehome] &&
      rows[breezehome].hold === 'whiterun' && !all.claims[breezehome]);
  // Somebody who is neither staff nor a steward, at every building: refused, nothing changes, nothing logged.
  const nobody = steward([], [STAFF]);
  let nobodyOk = 0;
  const nobodyBad = [];
  for (const b of served) {
    nobody.at(b);
    const t = nobody.evict(NOBODY);
    const r = nobody.rent(NOBODY, 25);
    nobody.claims[b].rent = { amount: 9, everyDays: 7, owed: 0, since: 1 };
    const w = nobody.rent(NOBODY, '-');
    if (t[0] === 'Only a steward ends a claim.' && r[1] === 'Only a steward sets rent.' && w[2] === 'Only a steward sets rent.' &&
        !!nobody.claims[b] && nobody.claims[b].rent.amount === 9) { nobodyOk++; } else { nobodyBad.push(b); }
  }
  yes('S5 somebody who is neither staff nor a steward is refused Evict, Set rent and No rent at all ' + served.length +
      ' buildings, nothing changes, and nothing is logged' + (nobodyBad.length ? ' (not: ' + nobodyBad.slice(0, 3).join(', ') + ')' : ''),
      nobodyOk === served.length && nobody.logged.length === 0);

  /*
    Staff (#2551, Patrick, 17 Oct, decision 1, B): at every building, the 811
    with a hold and the 39 without, staff set the rent, take it off and end
    the claim, and each press is one row in the staff log naming who, whose
    claim, the building and its hold, and what was set.
  */
  const st = steward([], [STAFF]);
  let staffOk = 0;
  const staffBad = [];
  for (const b of served) {
    const hold = rows[b] ? rows[b].hold : null;
    const town = hold ? ({ ravenrock: 'Raven Rock' }[hold] || hold.charAt(0).toUpperCase() + hold.slice(1)) : null;
    const where = NAME[b] + (town ? ', in ' + town : ', which answers to no hold');
    const before = st.logged.length;
    st.at(b);
    const r1 = st.rent(STAFF, 25);
    const set = st.claims[b] && st.claims[b].rent && st.claims[b].rent.amount === 25;
    const r2 = st.rent(STAFF, '-');
    const off = st.claims[b] && !st.claims[b].rent;
    const r3 = st.evict(STAFF);
    const rowsNow = st.logged.slice(before);
    const extra = { building: b, buildingName: NAME[b], hold: hold, as: 'staff' };
    const want = [
      ['rent', STAFF, 'Hadvar', OWNER, 'Alice', '25 gold every 7 days on ' + where, 0, extra],
      ['norent', STAFF, 'Hadvar', OWNER, 'Alice', where, 0, extra],
      ['evict', STAFF, 'Hadvar', OWNER, 'Alice', where, 0, extra]
    ];
    if (set && off && !st.claims[b] && JSON.stringify(rowsNow) === JSON.stringify(want) &&
        r1[0] === 'As staff: ' + NAME[b] + ' pays 25 gold every 7 days now. It is in the staff log.' &&
        r2[1] === 'As staff: no rent on ' + NAME[b] + ' now. It is in the staff log.' &&
        r3[2] === 'As staff, you end Alice\'s claim on ' + NAME[b] + '. What is inside is untouched, and any key they ' +
                  'hold still works. It is in the staff log.') { staffOk++; } else { staffBad.push(b); }
  }
  yes('S6 staff set the rent, take it off and end the claim at all ' + served.length + ' buildings, the ' +
      Object.keys(refused).length + ' with no hold included, each told it is in the staff log' +
      (staffBad.length ? ' (not: ' + staffBad.slice(0, 3).join(', ') + ')' : ''), staffOk === served.length);
  yes('S7 and every press is one row in the staff log: who, whose claim, the building and its hold, what was set (' +
      st.logged.length + ' rows)', st.logged.length === served.length * 3 && st.plogged.length === 0);

  // A staff press the chat did not prove is refused with the staff block's reason, at a building of a hold and one of none.
  const un = steward([], [STAFF]);
  const vale = Object.keys(refused)[0];
  let unOk = true;
  for (const b of [breezehome, vale]) {
    un.at(b);
    const t1 = un.evict(STAFF, { proven: false });
    const t2 = un.rent(STAFF, 25, null);
    if (!(t1[0] === UNPROVEN_SAID && t2[1] === UNPROVEN_SAID && !!un.claims[b] && !un.claims[b].rent)) { unOk = false; }
  }
  yes('S8 a staff press the chat did not prove (or with no line at all) is refused with the staff block\'s own reason, ' +
      'nothing changes, and nothing is logged', unOk && un.logged.length === 0);

  // Staff who keep the building's hold act as its steward: no staff row. Anywhere else they act as staff.
  const both = steward(['whiterun'], [STEW]);
  both.at(breezehome);
  both.rent(STEW, 30);
  both.evict(STEW);
  const riftenHouse = Object.keys(rows).filter((b) => rows[b].hold === 'riften')[0];
  both.at(riftenHouse);
  both.evict(STEW);
  yes('S9 staff who are the Steward of Whiterun settle Breezehome as its steward, not logged as staff, and a Riften ' +
      'building as staff, logged', !both.claims[breezehome] && !both.claims[riftenHouse] && both.logged.length === 1 &&
      both.logged[0][0] === 'evict' && both.logged[0][7].hold === 'riften' && both.plogged.length === 2);

  // The staff log is unreachable: the press is refused, never made unlogged.
  const nolog = steward([], [STAFF]);
  nolog.at(breezehome);
  const keepRecord = null;
  const f2 = new Function('BUILDING_HOLD', 'BUILDING_NAME', 'claims', 'here', 'isSteward', 'isStewardOf',
    'holderOf', 'save', 'pushAll', 'plog', 'redrawPanel', 'rentDue', 'globalThis', 'g', 'personName',
    holdTown + '\n' + officeAtDoor[0] + '\n' + lifted.join('\n') + '\nreturn { evict: evict };')(
    inBlock, NAME, nolog.claims, function () { return breezehome; }, function () { return false; }, function () { return false; },
    function (b) { return nolog.claims[b] || null; }, function () { }, function () { }, function () { }, function () { },
    function () { }, {}, { __thornswoodIsStaff: function () { return true; }, __thornswoodStaff: { unproven: function () { return ''; }, record: keepRecord } },
    function () { return 'Hadvar'; });
  const toldNolog = [];
  f2.evict(1, STAFF, function (p, m) { toldNolog.push(m); }, PROVEN);
  yes('S10 with no staff log to write to, a staff press is refused and the claim stays (' + toldNolog[0] + ')',
      !!nolog.claims[breezehome] && /staff log is not loaded/.test(toldNolog[0] || ''));
}

// ---------------------------------------------------------------- L
/*
  The staff log is the one the staff commands write (#412): the staff
  block's record, run for real over a scratch for-bot folder, writes the
  row to moderation.log with the building and its hold; the chat block's
  staff test is the one handed to the staff commands; and the line a press
  arrives on reaches evict and rentCmd, so the staff block's proof is asked
  of it.
*/
const staffBlock = slice(gm, '// ==== thornswood staff ====', '// ==== end thornswood staff ====');
const chatBlock = slice(gm, '// ==== thornswood chat commands ====', '// ==== end thornswood chat commands ====');
const charBlock = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const recordSrc = ['settings', 'serverName', 'recordFile', 'record'].map((n) => fnSrc(staffBlock, n));
yes('L0 the staff block\'s record, and what it reads, are there once each', recordSrc.every((s) => !!s));
if (recordSrc.every((s) => !!s)) {
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2551-staff-'));
  try {
    const lines = [];
    const rec = new Function('fs', 'path', 'mp', 'log', recordSrc.join('\n') + '\nreturn record;')(
      fs, path, { getServerSettings: function () { return { forBotDir: dir, thornswoodServer: 'dev' }; } },
      function (l) { lines.push(l); });
    rec('evict', STAFF, 'Hadvar', OWNER, 'Alice', 'Breezehome, in Whiterun', 0,
        { building: '165a8:Skyrim.esm', buildingName: 'Breezehome', hold: 'whiterun', as: 'staff', did: 'kick' });
    const got = fs.readFileSync(path.join(dir, 'moderation.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const row = got[0] || {};
    yes('L1 the staff block\'s record writes one row to for-bot/moderation.log with who, whose claim, where and when',
        got.length === 1 && row.did === 'evict' && row.server === 'dev' && row.by === STAFF && row.byName === 'Hadvar' &&
        row.who === OWNER && row.whoName === 'Alice' && row.why === 'Breezehome, in Whiterun' &&
        row.building === '165a8:Skyrim.esm' && row.buildingName === 'Breezehome' && row.hold === 'whiterun' &&
        row.as === 'staff' && !isNaN(Date.parse(row.at)));
    yes('L2 and one line in thornswood.log; the building\'s fields never overwrite the row\'s own',
        lines.length === 1 && /^staff: Hadvar \(profile 600\) evict Alice \(profile 7\): Breezehome, in Whiterun$/.test(lines[0]));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
yes('L3 the staff block hands record on with its proof', !!staffBlock &&
    /g\.__thornswoodStaff = \{[^}]*unproven: unproven, record: record,/.test(staffBlock));
const isStaffSrc = chatBlock ? fnSrc(chatBlock, 'isStaff') : null;
yes('L4 the staff test is the chat block\'s isStaff, the one the staff commands are handed, published once',
    !!isStaffSrc && /return isDev\(profileId\);/.test(isStaffSrc) &&
    (chatBlock.match(/g\.__thornswoodIsStaff = isStaff;/g) || []).length === 1 &&
    (gm.match(/__thornswoodIsStaff = /g) || []).length === 1 &&
    /staffCmd\.command\(cmd, word, parts, profileId, actorId, isStaff,/.test(chatBlock));
yes('L5 the line a press arrives on reaches evict and rentCmd: handle, the character block, the property block',
    !!chatBlock && chatBlock.indexOf('charCmd.command(word, parts, actorId, profileId, toProfile, cmd)') !== -1 &&
    !!charBlock && charBlock.indexOf('prop.command(word, parts, actorId, profileId, toProfile, cmd)') !== -1 &&
    !!prop && prop.indexOf("if (word === '/evict') { return evict(actorId, profileId, toProfile, cmd); }") !== -1 &&
    prop.indexOf("if (word === '/rent') { return rentCmd(parts, actorId, profileId, toProfile, cmd); }") !== -1);
const bot = read(path.join(ROOT, 'bot', 'bot.py'));
yes('L6 the bot has a sentence for each, so the staff channel says it (bot/tests/test-moderation.py, M14)',
    ['evict', 'rent', 'norent', 'rentpaid'].every((d) => new RegExp("\\n    '" + d + "': '[^']+%s'").test(bot)));

// ---------------------------------------------------------------- rebuild
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}
const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
if (fs.existsSync(path.join(data, 'Skyrim.esm'))) {
  const run = python([TOOL, '--check', '--data', data]);
  const said = run ? run.stdout + run.stderr : '';
  if (run && run.status === 2) {
    console.log('SKIP  R1: the game at ' + data + ' is not the collection\'s load order:');
    console.log(said.split('\n').filter((l) => /STOP/.test(l)).join('\n'));
  } else {
    yes('R1 read again from the plugins at ' + data + ', every building gives the committed table and block',
        !!run && run.status === 0);
    if (!run || run.status !== 0) { console.log(said); }
  }
} else {
  console.log('SKIP  R1: no game at ' + data + ' (a machine with the game reads the plugins again)');
}
done();
