'use strict';
/*
  test-3893-rent-arrears.js

      node tests/test-3893-rent-arrears.js

  The rent on a building, when its deed changes hands, when it is paid, and
  when it is paid in person.

  #3893, Patrick, 27 Oct, A: rent stays and debt stays. When a deed changes
  hands the building keeps the rent its steward set. What was owed stays
  owed by the old holder and shows on the steward's Office page; the new
  holder starts at nothing owed.

  #3895, Patrick, 27 Oct, A: a Rent paid button. The steward's Office page
  gets a Rent paid button for each tenant. It lowers what is owed without
  restarting the rent clock and is logged like a drop box payment.

  #3891: paying rent through the drop box never moves the rent clock, so
  taking the gold back out cannot keep the debt from growing.

  #3950, Patrick, 27 Oct, A: whatever was owed when a claim ends, by an
  eviction or a lapse, stays owed by that person, the same way.

  The real property block runs over a pretend engine: Breezehome in
  Whiterun with 50 gold of rent every 7 days, Whiterun's board and box,
  its Steward, and Alice, who holds the house, and Bob, who is handed its
  deed. Each step is driven through the lines the door, the box's panel
  and the Office page send.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };
const gm = require('./gamemode-tables.js').joined(read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js')));
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
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
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
yes('the property block is in the gamemode', !!propBlock);
if (!propBlock) { done(); }

const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 20, 18, 0, 0);
const clock = { t: T0 };
class FakeDate extends Date { static now() { return clock.t; } }
const GOLD = 0x0000000F;
const HOUSE = '133c6:Skyrim.esm';      // a Whiterun building, by the block's own BUILDING_HOLD
const DOOR = 'a1b2:Skyrim.esm';
const DEED_DESC = (/  var DEED = '([^']+)';/.exec(propBlock) || [])[1];
yes('the deed record is read out of the property block', !!DEED_DESC);

const ALICE = { a: 0xff000303, pid: 303, name: 'Alice' };        // holds Breezehome, and owes on it
const BOB = { a: 0xff000404, pid: 404, name: 'Bob' };            // is handed the deed
const STEWARD = { a: 0xff000606, pid: 606, name: 'Proventus' };  // Steward of Whiterun
const STAFF = { a: 0xff000707, pid: 707, name: 'Hadvar' };       // staff, no office
const PEOPLE = [ALICE, BOB, STEWARD, STAFF];
const ROLES = { 606: { steward: ['whiterun'] } };
function officesOf(pid) {
  const o = ROLES[pid] || {};
  return { jarl: o.jarl || [], court: o.court || [], steward: o.steward || [], guard: o.guard || [] };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3893-rent-'));
fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ dataDir: 'data', privDir: 'private' }));
fs.mkdirSync(path.join(dir, 'private'));
fs.writeFileSync(path.join(dir, 'private', 'law.json'), JSON.stringify({ cells: {}, held: {
  'steward:whiterun': { 'p:606': { pid: 606, name: 'Proventus' } } } }));
fs.writeFileSync(path.join(dir, 'private', 'property.json'), JSON.stringify({
  claims: {
    [HOUSE]: { by: ALICE.pid, name: 'Alice', at: T0, touched: T0, locked: false,
               rent: { amount: 50, everyDays: 7, owed: 0, since: T0 } }
  },
  // Rows that are not debts are dropped as the register is read.
  arrears: { [HOUSE]: [{ by: 0, name: 'Nobody', owed: 5, at: T0 }, { by: 901, name: 'Gone', owed: 0, at: T0 }] },
  boards: { whiterun: { cell: '3c:Skyrim.esm', pos: [0, 0, 0], where: 'Whiterun', placed: true } },
  funds: {}, notices: {}, steps: { jailRule: T0 }
}));
function inDir(f) {
  const was = process.cwd();
  process.chdir(dir);
  try { return f(); } finally { process.chdir(was); }
}

const ids = {};
let nextId = 0x05000000;
function idOf(desc) {
  desc = String(desc || '');
  if (!desc) { return 0; }
  if (!ids[desc]) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/i.exec(desc);
    ids[desc] = m ? parseInt(m[1], 16) : (nextId++);
  }
  return ids[desc];
}
const refs = {};
PEOPLE.forEach(function (p) {
  refs[p.a] = { profileId: p.pid, appearance: { name: p.name }, worldOrCellDesc: '3c:Skyrim.esm',
                pos: [50, 0, 0], inventory: { entries: [{ baseId: GOLD, count: 500 }] } };
});
const shown = {};
const staffLog = [];
function makeMp() {
  return {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return PEOPLE.map(function (p) { return p.a; }); }
      if (!refs[id]) { throw new Error('no reference ' + id); }
      const v = refs[id][key];
      return (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    },
    set: function (id, key, v) {
      if (key === 'thornswoodBoxView') { shown[id] = JSON.parse(JSON.stringify(v)); return; }
      if (!refs[id]) { refs[id] = {}; }
      refs[id][key] = JSON.parse(JSON.stringify(v));
    },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    lookupEspmRecordById: function () { return null; },
    getNeighborsByPosition: function () { return []; }
  };
}
const logged = [];
function makeBlock() {
  const box = {
    console: { log: function () { logged.push(Array.prototype.join.call(arguments, ' ')); } },
    require: require, mp: makeMp(), Date: FakeDate,
    BUILDING_BY_DOOR: { [DOOR]: HOUSE }, BUILDING_NAME: { [HOUSE]: 'Breezehome' }, WAY_OUT: {}, BENCH_BY_BASE: {},
    ITEM_NAMES: {}, idOf: idOf,
    notify: function () { }, say: function () { },
    guard: function (n, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    log: function () { },
    __thornswoodOffices: officesOf,
    __thornswoodIsStaff: function (pid) { return pid === STAFF.pid; },
    __thornswoodStaff: {
      unproven: function (cmd) { return cmd && cmd.proven === true ? '' : 'Staff commands need the chat to have proved who you are.'; },
      record: function () { staffLog.push(Array.prototype.slice.call(arguments)); }
    },
    __thornswoodCharacter: { stateOf: function () { return {}; }, writeState: function () { } }
  };
  box.globalThis = box;
  inDir(function () { vm.runInNewContext(propBlock, box, { filename: 'gamemode.js property' }); });
  return box.__thornswoodProperty;
}
let W = makeBlock();
yes('the property block runs, with the rent and the arrears in it', !!W && typeof W.arrears === 'function' &&
    typeof W.officeView === 'function');
if (!W) { done(); }
yes('rows of the register\'s arrears that are not debts are dropped as it is read, and said',
    JSON.stringify(W.arrears()) === '{}' && logged.some(function (l) { return /dropped 2 row\(s\) of rent still owed/.test(l); }));

function door(p) { inDir(function () { W.touched(p.a, DOOR); }); }
function say(p, text, cmd) {
  const said = [];
  const parts = text.trim().split(/\s+/);
  inDir(function () {
    W.command(parts[0], parts, p.a, p.pid, function (pid, m) { if (pid === p.pid) { said.push(m); } },
              cmd || { proven: true, profileId: p.pid, text: text });
  });
  return said.join(' ');
}
function box(p, args) { say(p, '/dropbox ' + args.join(' ')); return shown[p.a]; }
function claim() { return W.claims()[HOUSE]; }
function owedBefore(pid) {
  const list = W.arrears()[HOUSE] || [];
  const row = list.filter(function (x) { return x.by === pid; })[0];
  return row ? row.owed : 0;
}
function giveDeed(from, to) {
  const deed = { baseId: idOf(DEED_DESC), count: 1, name: W.deedLabel(HOUSE) };
  refs[from.a].inventory.entries = refs[from.a].inventory.entries.filter(function (e) { return e.baseId !== deed.baseId; });
  refs[to.a].inventory.entries.push(deed);
}
function owing(p) {
  let v = null;
  inDir(function () { v = W.officeView(p.a, p.pid); });
  return (v && v.door && v.door.owing) || null;
}

// ------------------------------------------------- A. the deed changes hands
clock.t = T0 + 7.5 * DAY;
door(ALICE);
yes('A0 a week and a half in, Alice owes one week of rent', /50 owed\./.test(say(ALICE, '/rent')) && claim().rent.owed === 50);
giveDeed(ALICE, BOB);
door(BOB);
yes('A1 Bob presents the deed at the door and holds Breezehome', claim().by === BOB.pid && claim().name === 'Bob');
yes('A2 the building keeps the rent its steward set, at the same amount', !!claim().rent && claim().rent.amount === 50 &&
    claim().rent.everyDays === 7);
yes('A3 the new holder starts at nothing owed', claim().rent.owed === 0);
yes('A4 and the clock goes on: the period began on day 7, not when the deed moved',
    claim().rent.since === T0 + 7 * DAY);
yes('A5 what Alice owed stays owed by Alice', owedBefore(ALICE.pid) === 50 && (W.arrears()[HOUSE] || []).length === 1);
let said = say(BOB, '/rent');
yes('A6 /rent at the door says the rent is still on it, not that it has none (' + said + ')',
    said === 'Breezehome: 50 gold every 7 days, 0 owed.');
door(ALICE);
said = say(ALICE, '/rent');
yes('A7 and Alice at the door is told what she still owes there (' + said + ')',
    said === 'Breezehome: 50 gold every 7 days, 0 owed. You still owe 50 gold of rent here from when you held it.');
clock.t = T0 + 14.2 * DAY;
door(BOB);
yes('A8 on day 14 the next rent falls due on Bob, the day it would have, and Alice\'s stays as it was',
    /50 owed\./.test(say(BOB, '/rent')) && claim().rent.owed === 50 && owedBefore(ALICE.pid) === 50);
yes('A9 it is written to the register, and read back after a restart',
    (function () { W = makeBlock(); return owedBefore(ALICE.pid) === 50 && claim().rent.owed === 50 && claim().by === BOB.pid; })());

// ------------------------------------------------- B. the steward's Office page
door(STEWARD);
let o = owing(STEWARD);
yes('B1 at the door the steward sees both who owe: Bob for now, Alice from when she held it (' + JSON.stringify(o) + ')',
    !!o && o.length === 2 &&
    o.some(function (x) { return x.pid === BOB.pid && x.name === 'Bob' && x.owed === 50 && x.holds === true; }) &&
    o.some(function (x) { return x.pid === ALICE.pid && x.name === 'Alice' && x.owed === 50 && x.holds === false; }));

// ------------------------------------------------- C. the drop box pays what is owed from before
let v = box(ALICE, ['gold', '30']);
yes('C1 gold Alice puts in the box pays down what she owes from before (' + v.said + ')',
    owedBefore(ALICE.pid) === 20 && /30 of it pays your rent/.test(v.said) && claim().rent.owed === 50);
const mine = (v.rows || []).filter(function (r) { return r.mine; })[0];
v = box(ALICE, ['take', String(mine ? mine.n : 0)]);
yes('C2 taking it back makes it owed by her again, not by Bob (' + v.said + ')',
    owedBefore(ALICE.pid) === 50 && claim().rent.owed === 50 && /30 gold of rent is owed again/.test(v.said));
v = box(ALICE, ['gold', '50']);
yes('C3 paying all of it ends the debt', owedBefore(ALICE.pid) === 0 && !W.arrears()[HOUSE]);
const all50 = (v.rows || []).filter(function (r) { return r.mine; })[0];
v = box(ALICE, ['take', String(all50 ? all50.n : 0)]);
yes('C4 and taking that back owes it again, as a debt of her own', owedBefore(ALICE.pid) === 50);

// ------------------------------------------------- D. the clock and the box (#3891)
const since = claim().rent.since;
clock.t = T0 + 20.9 * DAY;
v = box(BOB, ['gold', '50']);
yes('D1 Bob pays all he owes late in the period, and the clock does not move',
    claim().rent.owed === 0 && claim().rent.since === since);
const bobs = (v.rows || []).filter(function (r) { return r.mine; })[0];
box(BOB, ['take', String(bobs ? bobs.n : 0)]);
yes('D2 taking it back makes it owed again, still on the same clock', claim().rent.owed === 50 && claim().rent.since === since);
clock.t = T0 + 21.1 * DAY;
door(BOB);
yes('D3 so the next week falls due on day 21 and the debt grows to 100 (' + say(BOB, '/rent') + ')',
    claim().rent.owed === 100);
box(BOB, ['gold', '100']);
clock.t = T0 + 27.9 * DAY;
door(BOB);
say(BOB, '/rent');
yes('D4 paid in full on day 21, nothing more falls due before day 28', claim().rent.owed === 0);
clock.t = T0 + 28.1 * DAY;
door(BOB);
say(BOB, '/rent');
yes('D5 and on day 28 the next 50 does, not a week after the payment', claim().rent.owed === 50);

// ------------------------------------------------- E. Rent paid, in person (#3895)
door(STEWARD);
const sinceE = claim().rent.since;
said = say(STEWARD, '/rent paid ' + ALICE.pid + ' 20');
yes('E1 the steward marks 20 handed over by Alice, and what she owes from before is 30 (' + said + ')',
    owedBefore(ALICE.pid) === 30 && said === 'Alice paid 20 gold of rent on Breezehome. 30 is still owed.');
yes('E2 Bob\'s rent and the clock are untouched', claim().rent.owed === 50 && claim().rent.since === sinceE);
v = box(STEWARD, ['records']);
const rec = (v.records || [])[0] || {};
yes('E3 it is in the drop box\'s record beside the box\'s own payments: who was handed it, by whom, how much (' +
    JSON.stringify(rec) + ')',
    rec.act === 'rent' && rec.who === 'Proventus' && rec.by === 'Alice' && rec.count === 20 &&
    /Breezehome, handed over in person/.test(rec.note));
door(STEWARD);
said = say(STEWARD, '/rent paid ' + ALICE.pid + ' 100');
yes('E4 more than is owed is refused, saying what is (' + said + ')',
    said === 'Alice owes 30 gold on Breezehome, not 100.' && owedBefore(ALICE.pid) === 30);
said = say(STEWARD, '/rent paid ' + ALICE.pid + ' 2.5');
yes('E5 so is gold that is not a whole number (' + said + ')',
    /whole number above 0/.test(said) && owedBefore(ALICE.pid) === 30);
said = say(STEWARD, '/rent paid 999 5');
yes('E6 and somebody who owes nothing here (' + said + ')', said === 'Nobody by that name owes rent on Breezehome.');
said = say(STEWARD, '/rent paid ' + BOB.pid + ' 50');
yes('E7 Rent paid beside the holder pays what is owed now, on the same clock (' + said + ')',
    claim().rent.owed === 0 && claim().rent.since === sinceE && said === 'Bob paid 50 gold of rent on Breezehome. Nothing is owed now.');
door(BOB);
said = say(BOB, '/rent paid ' + ALICE.pid + ' 30');
yes('E8 somebody who is not a steward cannot mark rent paid (' + said + ')',
    said === 'Only a steward sets rent.' && owedBefore(ALICE.pid) === 30);
door(STAFF);
said = say(STAFF, '/rent paid ' + ALICE.pid + ' 10');
yes('E9 staff with no office mark it as staff, and it is in the staff log (' + said + ')',
    owedBefore(ALICE.pid) === 20 && /^As staff: Alice paid 10 gold of rent on Breezehome\. 20 is still owed\. It is in the staff log\.$/.test(said) &&
    staffLog.length === 1 && staffLog[0][0] === 'rentpaid' && staffLog[0][3] === ALICE.pid && staffLog[0][4] === 'Alice' &&
    /10 gold of rent handed over in person, on Breezehome, in Whiterun/.test(staffLog[0][5]));
door(STEWARD);
said = say(STEWARD, '/rent paid ' + ALICE.pid + ' 20');
o = owing(STEWARD);
yes('E10 paying the last of it ends the debt, and the page no longer lists her (' + JSON.stringify(o) + ')',
    owedBefore(ALICE.pid) === 0 && !W.arrears()[HOUSE] && o.length === 0);

// ------------------------------------------------- F. Set rent keeps what is owed
clock.t = T0 + 35.2 * DAY;
door(STEWARD);
const sinceF = claim().rent.since;
say(STEWARD, '/rent 60');
yes('F1 a new amount keeps what was owed at the old one, and the clock (#3895)',
    claim().rent.amount === 60 && claim().rent.owed === 50 && claim().rent.since === sinceF + 7 * DAY);

// ------------------------------------------------- G. the deed back again, and nobody holding it
giveDeed(BOB, ALICE);
door(ALICE);
yes('G1 the deed back to Alice: she holds it at nothing owed, and what Bob owed stays his',
    claim().by === ALICE.pid && claim().rent.owed === 0 && claim().rent.amount === 60 && owedBefore(BOB.pid) === 50);
door(STEWARD);
say(STEWARD, '/evict');
yes('G2 an eviction ends the claim; what Bob owes from before is his still', !claim() && owedBefore(BOB.pid) === 50);
o = owing(STEWARD);
yes('G3 and with nobody holding it the steward still sees it, and marks it paid', o.length === 1 && o[0].pid === BOB.pid &&
    say(STEWARD, '/rent paid ' + BOB.pid + ' 50') === 'Bob paid 50 gold of rent on Breezehome. Nothing is owed now.' &&
    !W.arrears()[HOUSE]);

// ------------------------------------------------- L. an eviction and a lapse keep the debt (#3950)
// Patrick, 27 Oct, A: whatever was owed when the claim ends stays owed by that person.
const TL = clock.t;
W.claims()[HOUSE] = { by: ALICE.pid, name: 'Alice', at: TL, touched: TL, locked: false,
                      rent: { amount: 10, everyDays: 7, owed: 0, since: TL } };
clock.t = TL + 7.5 * DAY;
door(STEWARD);
said = say(STEWARD, '/evict');
yes('L1 a steward evicts Alice, who owes a week: the claim ends and the 10 stays hers (' + said + ')',
    !claim() && owedBefore(ALICE.pid) === 10);
o = owing(STEWARD);
yes('L2 and the steward still sees it at the door', o.length === 1 && o[0].pid === ALICE.pid && o[0].owed === 10);
const TB = clock.t;
W.claims()[HOUSE] = { by: BOB.pid, name: 'Bob', at: TB, touched: TB, locked: false,
                      rent: { amount: 10, everyDays: 7, owed: 0, since: TB } };
clock.t = TB + 30 * DAY;
inDir(function () { W.rentDue(); });
yes('L3 rent is never counted past the day a claim lapses, even before anything reads it: two weeks, not four',
    claim().rent.owed === 20);
door(STEWARD);
o = owing(STEWARD);
yes('L4 the claim lapses after 14 days with nobody going in, and what Bob owed up to then stays his (' +
    JSON.stringify(o) + ')',
    !claim() && owedBefore(BOB.pid) === 20 && owedBefore(ALICE.pid) === 10 && o.length === 2);
inDir(function () { delete W.arrears()[HOUSE]; });

// ------------------------------------------------- H. a deleted character
inDir(function () { W.claims()[HOUSE] = undefined; delete W.claims()[HOUSE]; });
W.arrears()[HOUSE] = [{ by: ALICE.pid, name: 'Alice', owed: 15, at: clock.t }, { by: BOB.pid, name: 'Bob', owed: 5, at: clock.t }];
let rel = null;
inDir(function () { rel = W.release({ profile: function (pid) { return pid === ALICE.pid; } }); });
yes('H1 what a deleted character still owed goes with them, counted; somebody else\'s stays',
    !!rel && rel.saved === true && rel.counts.arrears === 1 && owedBefore(ALICE.pid) === 0 && owedBefore(BOB.pid) === 5);

// ------------------------------------------------- S. the source
const strip = function (t) { return String(t || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' '); };
const putGold = slice(propBlock, '  function boxPutGold(', '\n  }\n') || '';
yes('S1 paying through the box never sets the rent clock (#3891)', !!putGold && !/since\s*=/.test(strip(putGold)));
const paid = slice(propBlock, '  function rentPaid(', '\n  }\n') || '';
yes('S2 nor does Rent paid', !!paid && !/since\s*=/.test(strip(paid)));
const bot = read(path.join(REPO_DIR, 'bot', 'bot.py'));
yes('S3 the bot has a sentence for a staff Rent paid, so the staff channel says it',
    /\n    'rentpaid': '[^']+%s'/.test(bot));

done();
