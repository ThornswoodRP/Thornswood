// test-1894-door-sentence.js
//
//     node .\game\tests\test-1894-door-sentence.js
//
// The allow list door tells the person why before it ends their session
// (#1894). With "enforce": true in allowed.json it kicked a profile that was
// not on the list (or dropped off it while in the world) at once, with no
// sentence and no { end } line. skymp5-client connects again after every
// disconnect and logs in as the same character (#1157), so the same session
// came straight back, was judged again once it was seen, and was kicked
// again, and the person was never told why.
//
// Now the door does what every other place that ends a session on purpose
// does since #1157: the sentence in their chat, the same sentence as
// { end: <it> } on the line their character choice reads (their game closes
// its own connection and goes back to the choice with it), and the kick after
// the same few seconds as the join pass refusal, for a game that does not
// close itself.
//
// The door block is lifted out of gamemode.js between its markers and run in
// a vm with a stand-in mp, file system, site and clock, the way test-door.js
// runs it, with the two lines it says through (__thornswoodToProfile,
// __thornswoodSayLine) recorded in order with the kicks. Then every mp.kick in
// gamemode.js is counted against the places that end a session on purpose,
// so a new one that skips the end line is noticed (test-1157-session-ends.js
// runs the others).
//
// GAMEMODE=<path> runs it against another copy, which is how it was shown to
// fail on the door before this change.
//
// Read only. Nothing touches the disk or the network.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..', '..');
const GM = process.env.GAMEMODE || path.join(ROOT, 'game', 'gamemode.js');
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function block(name) {
  const a = src.indexOf('// ==== thornswood ' + name + ' ====');
  const b = a < 0 ? -1 : src.indexOf('// ==== end thornswood ' + name + ' ====', a);
  return (a >= 0 && b > a) ? src.slice(a, b) : null;
}

const DOOR = block('door');
const JP = block('join pass');
yes('the door block is in gamemode.js between its markers', !!DOOR);
yes('the join pass block is in gamemode.js between its markers', !!JP);
if (!DOOR || !JP) { done(); }

// The few seconds the join pass refusal waits between its sentence and its kick.
const jpWait = /function refuseLater\([^)]*\) \{[\s\S]*?\}, (\d+)\);\n  \}/.exec(JP);
const JP_MS = jpWait ? Number(jpWait[1]) : -1;
yes('the join pass refusal waits a few seconds before its kick (' + JP_MS + ' ms)', JP_MS >= 2000 && JP_MS <= 15000);

const ALLOWED = path.join('private', 'allowed.json');
const DOORCONF = path.join('private', 'door.json');

/** The real door block over a pretend server, site and clock. */
function rig(opts) {
  const files = {};
  files['server-settings.json'] = JSON.stringify({ privDir: 'private', thornswoodServer: opts.server || 'main' });
  files[ALLOWED] = JSON.stringify({ enforce: opts.enforce, profiles: opts.profiles });
  // Not a real site or key: the stand-in https below answers everything.
  files[DOORCONF] = JSON.stringify({ site: 'https://door.test', key: 'not-a-real-key' });
  const fakeFs = {
    readFileSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; throw e;
      }
      return files[p];
    },
    writeFileSync: function (p, s) { files[p] = String(s); },
    appendFileSync: function (p, s) { files[p] = (files[p] || '') + s; },
    existsSync: function () { return true; },
    mkdirSync: function () { }
  };
  const asked = [];
  const fakeHttps = {
    get: function (url, o, cb) {
      if (typeof o === 'function') { cb = o; o = {}; }
      const req = { cb: cb, handlers: {}, setTimeout: function () { },
                    on: function (ev, fn) { this.handlers[ev] = fn; }, destroy: function () { } };
      asked.push(req);
      return req;
    }
  };
  let clock = 1000000;
  function FakeDate(x) { return new Date(arguments.length ? x : clock); }
  FakeDate.now = function () { return clock; };

  const r = { told: [], lines: [], kicked: [], notes: [], order: [], timeouts: [],
              online: [], pid: {}, user: {}, intervals: {} };
  const box = {
    require: function (name) {
      if (name === 'fs') return fakeFs;
      if (name === 'path') return path;
      if (name === 'https') return fakeHttps;
      throw new Error('no module ' + name);
    },
    console: { log: function (s) { r.notes.push(String(s)); } },
    Date: FakeDate,
    setInterval: function (fn, ms) { r.intervals[ms] = fn; return ms; },
    clearInterval: function () { },
    setTimeout: function (fn, ms) { r.timeouts.push({ fn: fn, ms: ms }); r.order.push('timer ' + ms); return r.timeouts.length; },
    mp: {
      get: function (id, prop) {
        if (id === 0 && prop === 'onlinePlayers') return r.online.slice();
        if (prop === 'profileId') return r.pid[id];
        return undefined;
      },
      getUserByActor: function (id) {
        return (r.online.indexOf(id) >= 0 && r.user[id] !== undefined) ? r.user[id] : -1;
      },
      kick: function (u) { r.kicked.push(u); r.order.push('kick ' + u); },
      // The engine's whole-file write (#2740), onto the fake disk.
      writeFileWhole: function (p, s) { fakeFs.writeFileSync(p, s); }
    },
    __thornswoodToProfile: function (p, text) { r.told.push({ p: p, text: String(text) }); r.order.push('told ' + p); },
    __thornswoodSayLine: function (p, what) {
      r.lines.push({ p: p, what: JSON.parse(JSON.stringify(what)) });
      r.order.push('line ' + p);
    }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(DOOR, box);

  r.advance = function (ms) { clock += ms; };
  r.tick = function () { clock += 2000; r.intervals[2000](); };
  r.refresh = function () { r.intervals[300000](); };
  /** Answer the oldest question the door has put to the site. */
  r.answer = function (body) {
    const req = asked.shift();
    if (!req) return false;
    const h = {};
    req.cb({ statusCode: 200, on: function (ev, fn) { h[ev] = fn; } });
    h.data(JSON.stringify(body));
    h.end();
    return true;
  };
  /** The timers the door set, fired the way the clock would after their wait. */
  r.later = function () {
    const due = r.timeouts.splice(0);
    due.forEach(function (t) { clock += t.ms; t.fn(); });
    return due;
  };
  r.arrive = function (actor, pid, user) { r.online.push(actor); r.pid[actor] = pid; r.user[actor] = user; };
  r.leave = function (actor) { r.online = r.online.filter(function (x) { return x !== actor; }); };
  r.toldTo = function (p) { return r.told.filter(function (t) { return t.p === p; }).map(function (t) { return t.text; }); };
  r.endsTo = function (p) { return r.lines.filter(function (l) { return l.p === p && l.what.end; }).map(function (l) { return l.what.end; }); };
  r.logged = function (re) { return r.notes.filter(function (n) { return re.test(n); }).length; };
  return r;
}

const A = 0xff000101, B = 0xff000202, C = 0xff000303, D = 0xff000404;

// ---- somebody not on the list arrives at a door that enforces
let MAIN = '';
(function () {
  const r = rig({ enforce: true, profiles: [101] });
  r.answer({ profiles: [101] });
  r.advance(1000);
  r.arrive(A, 101, 1);
  r.arrive(B, 202, 2);
  r.tick();
  yes('a profile the list does not have yet makes the door ask the site again, and nobody is told anything while it waits',
      asked(r) && r.told.length === 0 && r.lines.length === 0 && r.timeouts.length === 0);
  r.answer({ profiles: [101] });
  r.tick();
  const told = r.toldTo(202);
  MAIN = told[0] || '';
  yes('the door tells them why, once', told.length === 1);
  yes('in a plain sentence: not on the list of people who may play, so the session is being ended',
      /^You are not on the list of people who may play on Thornswood, so the session is being ended\./.test(MAIN));
  yes('and what to do: the site\'s join page, then Play in the launcher',
      /thornswood\.net\/join/.test(MAIN) && /press Play in the launcher/.test(MAIN));
  yes('and says { end: <that sentence> } on their line, so their game closes its side',
      r.endsTo(202).length === 1 && r.endsTo(202)[0] === MAIN);
  yes('the sentence first, then the end line (' + r.order.join(' | ') + ')',
      r.order.indexOf('told 202') >= 0 && r.order.indexOf('told 202') < r.order.indexOf('line 202'));
  yes('and nothing is kicked yet', r.kicked.length === 0);
  yes('the kick waits the same few seconds as the join pass refusal',
      r.timeouts.length === 1 && r.timeouts[0].ms === JP_MS);
  r.tick(); r.tick();
  yes('the ticks while it waits say nothing again and set no second kick',
      r.toldTo(202).length === 1 && r.endsTo(202).length === 1 && r.timeouts.length === 1 && r.kicked.length === 0);
  r.later();
  yes('then the kick, after the end line, for a game that does not close itself',
      r.kicked.length === 1 && r.kicked[0] === 2 && r.order.indexOf('line 202') < r.order.indexOf('kick 2'));
  yes('the one on the list is let in and told nothing',
      r.toldTo(101).length === 0 && r.endsTo(101).length === 0 && r.kicked.indexOf(1) < 0);
  yes('the door log says it turned them away, told why, and then kicked',
      r.logged(/turning away profile 202 .*told why/) === 1 && r.logged(/turned away profile 202/) === 1);

  // A game that does not close itself (a plugin older than #1157) connects
  // again on its own: judged again once per visit, not on every tick.
  r.leave(B);
  r.tick();
  r.arrive(B, 202, 3);
  r.tick();
  r.advance(30000);
  r.tick(); r.tick(); r.tick();
  yes('a game that comes back anyway is told again, once for that visit',
      r.toldTo(202).length === 2 && r.endsTo(202).length === 2 && r.timeouts.length === 1);
})();

function asked(r) { return r.logged(/202 is not on the list yet, asking the site again/) === 1; }

// ---- somebody let in drops off the list while in the world
(function () {
  const r = rig({ enforce: true, profiles: [101, 202] });
  r.answer({ profiles: [101, 202] });
  r.arrive(A, 101, 1);
  r.arrive(B, 202, 2);
  r.tick();
  yes('both on the list are let in and nobody is told anything', r.told.length === 0 && r.lines.length === 0);
  r.advance(300000);
  r.refresh();
  r.answer({ profiles: [101] });
  r.tick();
  yes('the one the new list drops is told the same sentence',
      r.toldTo(202).length === 1 && r.toldTo(202)[0] === MAIN);
  yes('and { end } with it on their line, before any kick',
      r.endsTo(202).length === 1 && r.endsTo(202)[0] === MAIN && r.kicked.length === 0);
  r.later();
  yes('then the kick', r.kicked.length === 1 && r.kicked[0] === 2);
  yes('the one still on the list hears nothing and stays',
      r.toldTo(101).length === 0 && r.endsTo(101).length === 0 && r.kicked.indexOf(1) < 0);
})();

// ---- banned, or dead for good: the staff block says which and why
//
// The site leaves them off the list and sends them in the same answer; the
// staff block's ban sweep ends the session with the ban and its reason
// (test-1157-session-ends.js and test-staff-bans.js run it). The door ticks
// every two seconds and that sweep every ten, so the door would get there
// first and tell a banned person to apply.
(function () {
  const r = rig({ enforce: true, profiles: [101, 202, 303, 404] });
  r.answer({ profiles: [101, 202, 303, 404] });
  r.arrive(A, 101, 1);
  r.arrive(B, 202, 2);
  r.arrive(C, 303, 3);
  r.arrive(D, 404, 4);
  r.tick();
  r.advance(300000);
  r.refresh();
  r.answer({ profiles: [101],
             bans: [{ profiles: [202], why: 'alt accounts', until: Date.now() + 86400000, scope: 'account' },
                    { profiles: [202], why: 'an older one', until: 1, scope: 'character' },
                    { profiles: [404], why: 'spamming', until: 1, scope: 'character' }],
             pk: [303] });
  r.tick(); r.tick();
  yes('a ban that lands while they are in the world: the door says nothing and sets no kick, the staff block ends it',
      r.toldTo(202).length === 0 && r.endsTo(202).length === 0 &&
      r.logged(/profile 202 is banned or dead for good, so the staff block ends the session/) === 1);
  yes('a character dead for good: the same',
      r.toldTo(303).length === 0 && r.endsTo(303).length === 0 &&
      r.logged(/profile 303 is banned or dead for good/) === 1);
  yes('a ban that has already run out is not one: off the list, so the door turns them away itself',
      r.toldTo(404).length === 1 && r.toldTo(404)[0] === MAIN && r.endsTo(404).length === 1);
  r.later();
  yes('and only that one is kicked', r.kicked.length === 1 && r.kicked[0] === 4);
  yes('the one still on the list hears nothing', r.toldTo(101).length === 0 && r.kicked.indexOf(1) < 0);
})();

// ---- their game closed its side before the kick came, as it should
(function () {
  const r = rig({ enforce: true, profiles: [101] });
  r.answer({ profiles: [101] });
  r.advance(1000);
  r.arrive(C, 303, 3);
  r.tick();
  r.answer({ profiles: [101] });
  r.tick();
  yes('told and ended', r.toldTo(303).length === 1 && r.endsTo(303).length === 1);
  r.leave(C);
  r.later();
  yes('a connection already gone when the kick comes is not kicked, and the log says so',
      r.kicked.length === 0 && r.logged(/profile 303 had already gone when the kick came/) === 1);
})();

// ---- a connection with no profile number: nobody to tell, the kick still comes
(function () {
  const r = rig({ enforce: true, profiles: [101] });
  r.answer({ profiles: [101] });
  r.advance(1000);
  r.arrive(D, undefined, 4);
  r.tick();
  r.answer({ profiles: [101] });
  r.tick();
  yes('no profile: no sentence and no end line to anybody', r.told.length === 0 && r.lines.length === 0);
  r.later();
  yes('and the kick after the same wait', r.kicked.length === 1 && r.kicked[0] === 4 &&
      r.logged(/turning away profile unknown .*no profile to tell why/) === 1);
})();

// ---- watching only: nothing said, nothing ended
(function () {
  const r = rig({ enforce: false, profiles: [101] });
  r.answer({ profiles: [101] });
  r.advance(1000);
  r.arrive(B, 202, 2);
  r.tick();
  r.answer({ profiles: [101] });
  r.tick(); r.tick();
  r.later();
  yes('a door that only watches tells nobody, ends nothing and kicks nobody',
      r.told.length === 0 && r.lines.length === 0 && r.kicked.length === 0 &&
      r.logged(/WOULD TURN AWAY profile 202/) === 1);
})();

// ---- the dev server's list is its staff only
let DEV = '';
(function () {
  const r = rig({ enforce: true, profiles: [101], server: 'dev' });
  r.answer({ profiles: [101] });
  r.advance(1000);
  r.arrive(B, 202, 2);
  r.tick();
  r.answer({ profiles: [101] });
  r.tick();
  DEV = r.toldTo(202)[0] || '';
  yes('on the dev server the sentence says it is for staff and where to play instead',
      /^You are not on the list of people who may play on the dev server, which is for staff, so the session is being ended\./.test(DEV) &&
      /open the Thornswood launcher, not Thornswood Dev, and press Play/.test(DEV));
  yes('and does not send them to apply', !/thornswood\.net\/join/.test(DEV));
  yes('with the same end line and the same wait',
      r.endsTo(202).length === 1 && r.endsTo(202)[0] === DEV && r.timeouts.length === 1 && r.timeouts[0].ms === JP_MS);
  r.later();
  yes('then the kick', r.kicked.length === 1 && r.kicked[0] === 2);
})();

// ---- the words
[MAIN, DEV].forEach(function (s, i) {
  const which = i ? 'dev' : 'main';
  yes('the ' + which + ' sentence has no em dash and does not use the banned word',
      !!s && s.indexOf('—') < 0 && !/player/i.test(s));
});

// ---- every kick in gamemode.js, and which says the end line first
//
// Each place that ends a session on purpose says { end } before its kick;
// test-1157-session-ends.js runs the load order, join pass, seats and staff
// ones and this file runs the door's. A restart's kick does not, on purpose:
// that reconnect is wanted. A kick anywhere else is new and needs the same.
(function () {
  const found = [];
  const re = /mp\.kick\(/g;
  let m;
  while ((m = re.exec(src))) {
    const head = src.slice(0, m.index);
    const marks = head.match(/\/\/ ==== thornswood ([^=\n]+?) ====/g) || [];
    const blk = marks.length ? marks[marks.length - 1].replace(/^\/\/ ==== thornswood | ====$/g, '') : '?';
    const fns = head.slice(-20000).match(/function\s+(\w+)\s*\(/g) || [];
    const fn = fns.length ? fns[fns.length - 1].replace(/^function\s+|\s*\($/g, '') : '?';
    found.push(blk + ': ' + fn);
  }
  const want = [
    'door: turnAway',
    'load order refusal: refuseLater',
    'join pass: refuseLater',
    'seats: endLater',
    'chat commands: clearTheServer',
    'staff: endLater',
    'staff: command'
  ];
  yes('every mp.kick in gamemode.js is one of the known ends (' + found.join('; ') + ')',
      found.length === want.length && want.every(function (w, i) { return found[i] === w; }));
  const turn = /function turnAway\([^)]*\) \{[\s\S]*?\n  \}/.exec(DOOR);
  yes('the door\'s kick is inside turnAway, after the sentence and the end line',
      !!turn && /tell\(pid, TURNED_AWAY\)[\s\S]*line\(pid, \{ end: TURNED_AWAY \}\)[\s\S]*setTimeout\([\s\S]*mp\.kick\(userId\)/.test(turn[0]));
  yes('and the door has no other kick', (DOOR.match(/mp\.kick\(/g) || []).length === 1);
})();

done();
