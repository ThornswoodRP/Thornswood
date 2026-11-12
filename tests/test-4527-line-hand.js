// test-4527-line-hand.js
//
//     node tests/test-4527-line-hand.js
//
// "/line hand <profile>" gives a place in line or a held seat to another
// character of the same game after it was moved out for being idle (#1142).
// Nothing checked who took it (#4527): any profile named took the place on
// its next "/line", before the join pass check, and a held staff seat kept its
// staff mark. So the front of the line could go to a friend past everybody
// waiting, and a staff seat to somebody who is not staff.
//
// Now a hand-over goes only to a character of the same Discord account (read
// off both join passes), the one taking it needs its own pass on hand, and a
// held staff seat goes only to a staff role. One case per rule.
//
// The seats block is lifted out of game/gamemode.js between its markers and
// run in a vm with a stand-in mp and its own clock, as test-seats.js runs it.
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const a = src.indexOf('// ==== thornswood seats ====');
const b = src.indexOf('// ==== end thornswood seats ====');
yes('the seats block is in gamemode.js between its markers', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }
const block = src.slice(a, b);

const ACTOR = 0xff000000;
const SEATS = { thornswoodMostOnline: 25, maxPlayers: 30 };
function rig() {
  const r = { lines: [], logged: [], online: [], staff: {}, now: 1000000 };
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    Date: { now: function () { return r.now; } },
    Math: Math, Number: Number, String: String, Object: Object, Array: Array,
    setTimeout: function () { return 1; },
    setInterval: function (fn) { r.interval = fn; return 1; },
    clearInterval: function () { },
    mp: {
      getServerSettings: function () { return SEATS; },
      getUserByActor: function () { return -1; },
      get: function (id, what) {
        if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
        for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === id) { return r.online[i].profileId; } }
        throw new Error('no such actor');
      },
      kick: function () { }
    },
    __thornswoodToProfile: function () { },
    __thornswoodSayLine: function (p, what) { r.lines.push({ p: p, what: JSON.parse(JSON.stringify(what)) }); },
    __thornswoodHoldsStaffRole: function (p) { return !!r.staff[p]; },
    __thornswoodCommandPoll: { okAt: 0, failAt: 0 },
    __thornswoodPassSeen: { passes: {}, online: {}, said: {} }
  };
  vm.createContext(box);
  vm.runInContext(block, box);
  const api = function () { return box.__thornswoodSeats; };
  r.tick = function (ms) { r.now += (ms || 2000); r.interval(); };
  r.pass = function (pid, account) { box.__thornswoodPassSeen.passes[pid] = { at: r.now, x: r.now + 600000, v: '1.1.102', d: account }; };
  r.want = function (pid) { return api().want(pid, r.now, api().liveHow()); };
  r.hand = function (pid, to) { return api().hand(pid, to, r.now, api().liveHow()); };
  r.lastLine = function (pid) {
    const l = r.lines.filter(function (t) { return t.p === pid; });
    return l.length ? l[l.length - 1].what : null;
  };
  r.log = function () { return r.logged.join('\n'); };
  r.status = function () { return api().status(); };
  r.tick();
  for (let p = 0; p < 25; p++) { r.online.push({ actorId: ACTOR + 100 + p, profileId: 100 + p }); }
  r.tick();
  return r;
}
// Three waiting: 201 (account A), 202 (account B), 203 (account C).
function line() {
  const r = rig();
  r.pass(201, 'A'); r.pass(202, 'B'); r.pass(203, 'C');
  r.want(201); r.tick(1000); r.want(202); r.tick(1000); r.want(203); r.tick();
  return r;
}

// ---- 1. another character of the same account, with its pass, takes the place
{
  const r = line();
  r.pass(299, 'A');
  yes('1a the holder hands its place to another of its characters', r.hand(201, 299) === 'handing');
  r.tick(1000);
  yes('1b that character, same account and its own pass, takes the place, still 1st',
      r.want(299) === 'handed' && /line: profile 299 takes the place profile 201 handed it, 1 of 3/.test(r.log()));
}

// ---- 2. a character of another account does not take it
{
  const r = line();
  r.pass(298, 'B');
  r.hand(201, 298); r.tick(1000);
  const got = r.want(298);
  r.tick();
  yes('2a a profile of another account named in the hand does not take the place (got "' + got + '")', got !== 'handed');
  yes('2b it waits at the end of the line like anybody: 4th of 4', !!r.lastLine(298) && r.lastLine(298).place === 4 && r.lastLine(298).of === 4);
  yes('2c the holder keeps 1st', !!r.lastLine(201) && r.lastLine(201).place === 1);
  yes('2d and the log says why', /profile 298 may not take the place profile 201 handed it: it is not a character of the same Discord account/.test(r.log()));
}

// ---- 3. the one taking it needs its own join pass
{
  const r = line();
  r.hand(201, 297); r.tick(1000);
  const got = r.want(297);
  yes('3a with no join pass on hand it does not take the place (got "' + got + '")', got === 'no pass');
  yes('3b it is told the pass is missing, and is not put in line', !!r.lastLine(297) && r.lastLine(297).pass === true && r.status().line === 3);
  r.pass(297, 'A'); r.tick(1000);
  yes('3c once its pass is here, the same account takes the place, 1st', r.want(297) === 'handed' &&
      /line: profile 297 takes the place profile 201 handed it, 1 of 3/.test(r.log()));
}

// ---- 4. a holder with no join pass cannot say whose the place is
{
  const r = line();
  // 201's pass runs out while it waits.
  r.now += 700000; r.pass(202, 'B'); r.pass(203, 'C'); r.want(201); r.want(202); r.want(203); r.tick();
  const got = r.hand(201, 296);
  yes('4a a holder whose pass has run out cannot hand its place (got "' + got + '")', got === 'no pass');
  r.pass(296, ''); r.tick(1000);
  yes('4b and nobody takes it', r.want(296) !== 'handed' && /profile 201 asked to hand its place in line to profile 296, but has no join pass on hand/.test(r.log()));
}

// ---- 5. a held staff seat goes only to a staff role
function staffSeat() {
  const r = line();
  r.staff[250] = true; r.pass(250, 'S');
  r.want(250); r.tick();
  return r;
}
{
  const r = staffSeat();
  yes('5a a staff role is given a staff seat ahead of the line', !!r.lastLine(250) && r.lastLine(250).go === true &&
      /a seat is held for profile 250, a staff role, ahead of the line/.test(r.log()));
  r.pass(295, 'S');
  yes('5b it hands the held staff seat to another of its characters', r.hand(250, 295) === 'handing');
  r.tick(1000);
  const got = r.want(295);
  yes('5c that character holds no staff role, so it does not take the staff seat (got "' + got + '")', got !== 'held');
  yes('5d and the log says why', /profile 295 may not take the seat profile 250 handed it: it is a staff seat and profile 295 holds no staff role/.test(r.log()));
}
{
  const r = staffSeat();
  r.staff[294] = true; r.pass(294, 'S');
  r.hand(250, 294); r.tick(1000);
  yes('5e a staff role of the same account takes it', r.want(294) === 'held' && !!r.lastLine(294) && r.lastLine(294).go === true);
}

// ---- 6. a held seat that is not a staff seat follows the same account and pass rules
{
  const r = line();
  r.online.shift(); r.tick();
  yes('6a a seat frees and is held for the first in line', !!r.lastLine(201) && r.lastLine(201).go === true);
  r.pass(293, 'B');
  r.hand(201, 293); r.tick(1000);
  yes('6b another account named in the hand does not take the held seat', r.want(293) !== 'held');
  r.pass(292, 'A');
  r.hand(201, 292); r.tick(1000);
  yes('6c the same account does', r.want(292) === 'held');
}

done();
