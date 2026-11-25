// test-door.js
//
// A ban reaches somebody who is already in the world.
//
// From the To Do List, entry 143: "A ban is refused at the session layer
// before the world loads, and an active session is severed when the ban is
// written." The door judged each person once per visit and forgot about them
// until they left, so a ban that took a profile off the list at the next five
// minute refresh reached nobody already standing in Skyrim.
//
// And the other half, which matters more: a refresh that FAILED, was rate
// limited, or came back empty must never throw anybody out. The entry's own
// trap: "enforcing before that is fixed risks a Discord hiccup locking
// everyone out at once, which is exactly the outage the watch-only comment
// was written to avoid."
//
// This lifts the whole door block out of gamemode.js and runs it against a
// pretend server: a fake mp, a fake file system, a fake site that answers
// when the test says so, and a clock the test moves by hand. Nothing here
// touches the network or the disk.
//
// GAMEMODE=<path> runs it against another copy, which is how it was shown to
// fail on the door before this change.
//
// The door tells the person why and kicks five seconds later (#1894), on a
// timer the test fires by hand (later), so each turning away below fires it
// before it counts the kicks. test-1894-door-sentence.js holds the sentence
// and its order.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const GM = process.env.GAMEMODE || path.join(REPO_DIR, 'game', 'gamemode.js');
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const a = src.indexOf('// ==== thornswood door ====');
const b = src.indexOf('// ==== end thornswood door ====');
const block = (a >= 0 && b > a) ? src.slice(a, b) : null;
yes('the door is in the gamemode', block !== null);

const ALLOWED = path.join('private', 'allowed.json');
const DOORCONF = path.join('private', 'door.json');
const rigs = [];

/** The real door, over a pretend server. */
function rig(enforce, profiles) {
  const files = {};
  files[ALLOWED] = JSON.stringify({ enforce: enforce, profiles: profiles });
  // Not a real site or key: the fake https below answers everything.
  files[DOORCONF] = JSON.stringify({ site: 'https://door.test', key: 'not-a-real-key' });
  let refuseWrite = false;
  const fakeFs = {
    readFileSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) {
        const e = new Error('ENOENT ' + p); e.code = 'ENOENT'; throw e;
      }
      return files[p];
    },
    writeFileSync: function (p, s) {
      if (refuseWrite) throw new Error('EACCES ' + p);
      files[p] = String(s);
    },
    appendFileSync: function (p, s) { files[p] = (files[p] || '') + s; },
    existsSync: function () { return true; },
    mkdirSync: function () { }
  };

  const pending = [];
  const fakeHttps = {
    // The door sends its key in a header since pull request 272, so it calls
    // get(url, options, cb). The two argument form is still taken, the way
    // Node's own https.get takes both.
    get: function (url, opts, cb) {
      if (typeof opts === 'function') { cb = opts; opts = {}; }
      const req = {
        cb: cb, opts: opts || {}, handlers: {},
        setTimeout: function () { },
        on: function (ev, fn) { this.handlers[ev] = fn; },
        destroy: function () { }
      };
      pending.push(req);
      return req;
    }
  };

  let clock = 1000000;
  function FakeDate(x) { return new Date(arguments.length ? x : clock); }
  FakeDate.now = function () { return clock; };

  const world = { online: [], pid: {}, user: {} };
  const kicked = [];
  const mp = {
    get: function (id, prop) {
      if (id === 0 && prop === 'onlinePlayers') return world.online.slice();
      if (prop === 'profileId') return world.pid[id];
      return undefined;
    },
    getUserByActor: function (id) {
      return Object.prototype.hasOwnProperty.call(world.user, id) ? world.user[id] : -1;
    },
    kick: function (u) { kicked.push(u); },
    // The engine's whole-file write (#2740), onto the fake disk.
    writeFileWhole: function (p, s) { fakeFs.writeFileSync(p, s); }
  };

  const timers = {};
  const pendingKicks = [];
  const said = [];
  const run = new Function(
    'require', 'mp', 'setInterval', 'clearInterval', 'setTimeout', 'Date', 'console', 'globalThis',
    block);
  run(function (name) {
        if (name === 'fs') return fakeFs;
        if (name === 'path') return path;
        if (name === 'https') return fakeHttps;
        throw new Error('no module ' + name);
      },
      mp,
      function (fn, ms) { timers[ms] = fn; return ms; },
      function () { },
      function (fn, ms) { pendingKicks.push({ fn: fn, ms: ms }); return pendingKicks.length; },
      FakeDate,
      { log: function (s) { said.push(String(s)); } },
      {});

  const r = {
    files: files, said: said, kicked: kicked, world: world, pending: pending,
    advance: function (ms) { clock += ms; },
    tick: function () { clock += 2000; timers[2000](); },
    /** The kicks the door put off until its sentence could be read (#1894). */
    later: function () { clock += 5000; pendingKicks.splice(0).forEach(function (t) { t.fn(); }); },
    refresh: function () { timers[300000](); },
    refuseWrites: function (on) { refuseWrite = !!on; },
    /** Answer the oldest question the door has put to the site. */
    answer: function (status, body) {
      const req = pending.shift();
      if (!req) return false;
      const h = {};
      req.cb({ statusCode: status, on: function (ev, fn) { h[ev] = fn; } });
      if (h.data) h.data(typeof body === 'string' ? body : JSON.stringify(body));
      if (h.end) h.end();
      return true;
    },
    /** The request never got an answer at all. */
    drop: function (why) {
      const req = pending.shift();
      if (req && req.handlers.error) req.handlers.error(new Error(why));
    },
    /** Somebody connects, on this profile, as this connection. */
    arrive: function (actor, pid, user) {
      world.online.push(actor); world.pid[actor] = pid; world.user[actor] = user;
    },
    leave: function (actor) {
      world.online = world.online.filter(function (x) { return x !== actor; });
    },
    since: function (mark, re) {
      return said.slice(mark).filter(function (s) { return re.test(s); }).length;
    }
  };
  rigs.push(r);
  return r;
}

const A = 0xff000101, B = 0xff000202, C = 0xff000303;

if (block !== null) {
  // 4484: response arrival is not snapshot freshness. A pre-ban request can
  // finish after that ban was made; its start must survive the late response.
  {
    const r = rig(true, [101]);
    r.advance(60000);
    r.answer(200, { profiles: [101], bans: [] });
    const first = JSON.parse(r.files[ALLOWED]);
    yes('4484 the door records request start separately from delayed commit',
        Date.parse(first.bansRequestedAt) === 1000000 && Date.parse(first.at) === 1060000);
    r.advance(10000);
    r.refresh();
    r.advance(30000);
    const activeBan = { profiles: [202], scope: 'character', until: 0, why: 'test ban' };
    r.answer(200, { profiles: [101], bans: [activeBan] });
    const next = JSON.parse(r.files[ALLOWED]);
    yes('4484 each refresh carries its own request start',
        Date.parse(next.bansRequestedAt) === 1070000 && Date.parse(next.at) === 1100000);
    for (const broken of [{ bansBroken: true }, { stateBroken: true }, {}]) {
      r.refresh();
      r.advance(10000);
      r.answer(200, Object.assign({ profiles: [] },
          Object.keys(broken).length ? { bans: [] } : {}, broken));
      const retained = JSON.parse(r.files[ALLOWED]);
      yes('4484 broken or missing upstream bans retain the previous list and its original freshness',
          retained.bansRequestedAt === next.bansRequestedAt && JSON.stringify(retained.bans) === JSON.stringify(next.bans));
    }
    r.refresh();
    r.advance(1);
    r.answer(200, { profiles: [101], bans: [null] });
    yes('4484 malformed ban entries cannot replace a readable ban snapshot',
        JSON.parse(r.files[ALLOWED]).bansRequestedAt === next.bansRequestedAt);
    r.refresh();
    r.advance(1);
    r.refresh();
    const olderRequest = r.pending.shift();
    r.answer(200, { profiles: [101], bans: [activeBan] });
    const newest = JSON.parse(r.files[ALLOWED]);
    r.pending.unshift(olderRequest);
    r.advance(1);
    r.answer(200, { profiles: [101], bans: [] });
    const afterOlder = JSON.parse(r.files[ALLOWED]);
    yes('4484 a late old response cannot replace newer confirmed bans',
        afterOlder.bansRequestedAt === newest.bansRequestedAt && afterOlder.bans.length === 1);

    const cold = rig(true, [101]);
    cold.answer(200, { profiles: [], bans: [], bansBroken: true });
    yes('4484 a broken initial ban read proves no freshness', !JSON.parse(cold.files[ALLOWED]).bansRequestedAt);
  }

  // S1: somebody on the list is let in and stays.
  {
    const r = rig(true, [101]);
    r.answer(200, { profiles: [101] });
    r.arrive(A, 101, 1);
    r.tick();
    yes('S1 a listed profile is let in', r.since(0, /let in profile 101/) === 1);
    r.later();
    yes('S1 and nobody is turned away', r.kicked.length === 0);
  }

  // S2: a character made a minute ago is not on a list up to five minutes
  //     old. The door asks again and waits, rather than turning them away.
  {
    const r = rig(true, [101]);
    r.answer(200, { profiles: [101] });
    r.advance(25000);
    r.arrive(B, 202, 2);
    r.tick();
    yes('S2 an unknown profile makes the door ask the site again',
        r.pending.length === 1 && r.since(0, /202 is not on the list yet/) === 1);
    r.later();
    yes('S2 and is not turned away while the answer is out', r.kicked.length === 0);
    r.answer(200, { profiles: [101, 202] });
    r.tick();
    r.later();
    yes('S2 and is let in once the answer lands with them',
        r.since(0, /let in profile 202/) === 1 && r.kicked.length === 0);
  }

  // S3: THE ENTRY. Two people in, a ban lands at the next refresh, and the
  //     one it names is turned away without waiting for them to log out.
  {
    const r = rig(true, [101, 202]);
    r.answer(200, { profiles: [101, 202] });
    r.arrive(A, 101, 1);
    r.arrive(B, 202, 2);
    r.tick();
    const mark = r.said.length;
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    r.later();
    yes('S3 a profile that drops off a list that landed is judged again',
        r.since(mark, /profile 202 dropped off the list while in the world/) === 1);
    yes('S3 and with the door enforcing they are turned away',
        r.kicked.length === 1 && r.kicked[0] === 2 &&
        r.since(mark, /turned away profile 202/) === 1);
    yes('S3 the one still on the list is left alone', r.kicked.indexOf(1) < 0);
    yes('S3 and is not let in a second time in the log',
        r.since(mark, /let in profile 101/) === 0);
    r.leave(B);
    r.tick();
    yes('S3 nothing more happens once they are gone', r.kicked.length === 1);
  }

  // S3b: THE LIST ON DISK IS OLD AFTER A RESTART. Somebody let in off the
  //      file before the first answer came back, and that answer is the one
  //      that says they were banned while the server was down.
  {
    const r = rig(true, [101, 202]);
    r.arrive(B, 202, 2);
    r.tick();
    yes('S3b let in off the list on disk before the site answered',
        r.since(0, /let in profile 202/) === 1);
    r.answer(200, { profiles: [101] });
    r.tick();
    r.later();
    yes('S3b and turned away when the first answer lands without them',
        r.kicked.length === 1 && r.kicked[0] === 2);
  }

  // S4: the same ban with the door only watching. Said once, nobody moved,
  //     and not said again every two seconds or every five minutes.
  {
    const r = rig(false, [101, 202]);
    r.answer(200, { profiles: [101, 202] });
    r.arrive(A, 101, 1);
    r.arrive(B, 202, 2);
    r.tick();
    const mark = r.said.length;
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    yes('S4 watching only, the drop is logged as WOULD TURN AWAY',
        r.since(mark, /WOULD TURN AWAY profile 202/) === 1);
    r.later();
    yes('S4 and nobody is kicked', r.kicked.length === 0);
    r.tick(); r.tick();
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    yes('S4 and it is said once, not on every tick or every refresh after',
        r.since(mark, /WOULD TURN AWAY profile 202/) === 1 &&
        r.since(mark, /dropped off the list/) === 1);
  }

  // S5: the list comes back the same. Nobody is judged again and the log
  //     does not fill with "let in" for everybody every five minutes.
  {
    const r = rig(true, [101, 202]);
    r.answer(200, { profiles: [101, 202] });
    r.arrive(A, 101, 1);
    r.arrive(B, 202, 2);
    r.tick();
    const mark = r.said.length;
    for (let i = 0; i < 3; i++) {
      r.advance(300000);
      r.refresh();
      r.answer(200, { profiles: [202, 101, 303] });
      r.tick(); r.tick();
    }
    r.later();
    yes('S5 an unchanged list turns nobody away', r.kicked.length === 0);
    yes('S5 and says nothing about the people already in',
        r.since(mark, /let in profile|dropped off|WOULD TURN AWAY|turned away/) === 0);
  }

  /*
    THE FAILURES. Each of these starts with two people let in and the door
    enforcing, then has a refresh go wrong in one of the ways it really can,
    and then checks that both of them are exactly where they were. The last
    step of each is a good list that drops 202, to prove the failure did not
    quietly break the judgement that should still come.
  */
  function failing(name, goWrong) {
    const r = rig(true, [101, 202]);
    r.answer(200, { profiles: [101, 202] });
    r.arrive(A, 101, 1);
    r.arrive(B, 202, 2);
    r.tick();
    r.advance(300000);
    r.refresh();
    goWrong(r);
    r.tick(); r.tick(); r.advance(60000); r.tick();
    r.later();
    yes(name + ': nobody already in is turned away', r.kicked.length === 0);
    yes(name + ': and nobody is judged again',
        r.since(0, /dropped off|WOULD TURN AWAY|turned away/) === 0);
    r.refuseWrites(false);
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    r.later();
    yes(name + ': and a good list after it still turns the banned one away',
        r.kicked.length === 1 && r.kicked[0] === 2);
    return r;
  }

  // S6: the site could not reach Discord. It still sends what it did get,
  //     which is a short list, and that short list is the lockout. It names
  //     nobody in failedProfiles, which is what an older site sends, so the
  //     door keeps the whole list. S16 is the answer that does name them.
  failing('S6 Discord unreachable', function (r) {
    r.answer(200, { profiles: [101], lookupFailed: true,
                    lookupFailedWhy: 'Discord is rate limiting the bot' });
    yes('S6 Discord unreachable: the list on disk still has both of them',
        JSON.parse(r.files[ALLOWED]).profiles.indexOf(202) >= 0);
  });

  // S7: the site itself rate limited the question.
  failing('S7 a 429 from the site', function (r) {
    r.answer(429, { error: 'slow down' });
  });

  // S8: THE EMPTY LIST. A 200 with nobody on it is not a ban on everybody.
  failing('S8 an empty list', function (r) {
    r.answer(200, { profiles: [], devProfiles: [], adminProfiles: [] });
  });

  // S9: the answer is not JSON, which is what a proxy error page looks like.
  failing('S9 a page that is not a list', function (r) {
    r.answer(502, '<html>Bad Gateway</html>');
  });

  // S10: the request never came back.
  failing('S10 the site unreachable', function (r) {
    r.drop('ECONNRESET');
  });

  // S11: a 200 with no profiles array in it at all.
  failing('S11 a 200 with no profiles', function (r) {
    r.answer(200, { hello: 'world' });
  });

  // S12: the list came back good and could not be written.
  failing('S12 a list that could not be saved', function (r) {
    r.refuseWrites(true);
    r.answer(200, { profiles: [101] });
  });

  // S13: somebody who was never on the list, in watch mode, is noted once and
  //      not again at every refresh that still does not have them.
  {
    const r = rig(false, [101]);
    r.answer(200, { profiles: [101] });
    r.advance(25000);
    r.arrive(C, 303, 3);
    r.tick();
    r.answer(200, { profiles: [101] });
    r.tick();
    yes('S13 an unlisted visitor is noted once', r.since(0, /WOULD TURN AWAY profile 303/) === 1);
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    r.later();
    yes('S13 and not again when the next list still lacks them',
        r.since(0, /WOULD TURN AWAY profile 303/) === 1 && r.kicked.length === 0);
  }

  // S14: somebody leaves and the list drops them afterwards. Nothing to do.
  {
    const r = rig(true, [101, 202]);
    r.answer(200, { profiles: [101, 202] });
    r.arrive(B, 202, 2);
    r.tick();
    r.leave(B);
    r.tick();
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    r.later();
    yes('S14 a person who has already gone is not chased', r.kicked.length === 0);
  }

  // S15: ONLY A LIST FROM THE SITE DOES THIS. Set-Door.ps1 rewrites
  //      allowed.json in place to flip enforce, and anything else that edits
  //      the file on disk is not a refresh that landed. Nobody already in is
  //      judged again for it; the next list from the site is what decides.
  {
    const r = rig(false, [101, 202]);
    r.answer(200, { profiles: [101, 202] });
    r.arrive(A, 101, 1);
    r.arrive(B, 202, 2);
    r.tick();
    r.files[ALLOWED] = JSON.stringify({ enforce: true, profiles: [101] });
    r.advance(31000);
    r.tick(); r.tick();
    r.later();
    yes('S15 a hand edit to the file judges nobody already in again',
        r.kicked.length === 0 && r.since(0, /dropped off|WOULD TURN AWAY|turned away/) === 0);
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101] });
    r.tick();
    r.later();
    yes('S15 and the next list from the site does, with enforce as it was left',
        r.kicked.length === 1 && r.kicked[0] === 2);
  }

  // S16: DISCORD ANSWERED FOR SOME. The site reached Discord for most people
  //      and names the one it could not check in failedProfiles. The door
  //      writes that list with the unchecked one kept as they were, so a ban
  //      in the same answer lands and the person nobody could check stays in.
  {
    const r = rig(true, [101, 202, 303]);
    r.answer(200, { profiles: [101, 202, 303] });
    r.arrive(A, 101, 1);
    r.arrive(B, 202, 2);
    r.arrive(C, 303, 3);
    r.tick();
    const mark = r.said.length;
    r.advance(300000);
    r.refresh();
    r.answer(200, { profiles: [101], lookupFailed: true, failedProfiles: [303],
                    lookupFailedWhy: 'Discord is rate limiting the bot' });
    r.tick();
    r.later();
    yes('S16 Discord answered for some: the one it could not check is still on the list on disk',
        JSON.parse(r.files[ALLOWED]).profiles.indexOf(303) >= 0);
    yes('S16 and the ban in the same answer turns that one away',
        r.kicked.length === 1 && r.kicked[0] === 2 &&
        r.since(mark, /turned away profile 202/) === 1);
    yes('S16 and the one nobody could check is not judged again',
        r.since(mark, /profile 303 dropped off|turned away profile 303|WOULD TURN AWAY profile 303/) === 0);
    const kicks = r.kicked.length;
    r.tick(); r.advance(60000); r.tick();
    r.later();
    yes('S16 and nothing more happens on the ticks after',
        r.kicked.length === kicks && r.kicked.indexOf(3) < 0);
  }

  // Every tick runs inside a try that notes "tick failed". None of the above
  // may have taken that path, or a pass above could be a crash that kicked
  // nobody by accident.
  {
    let crashed = 0;
    rigs.forEach(function (r) {
      crashed += r.said.filter(function (s) { return /tick failed|refresh threw/.test(s); }).length;
    });
    yes('no tick or refresh threw in any of the ' + rigs.length + ' runs above', crashed === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
