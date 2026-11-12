// test-server-down.js
//
// When the server goes away, the person is told on screen, with a countdown,
// before they are put back at the main menu.
//
// WHAT WAS WRONG. Entry 159 on the To Do List: "When the server restarts you
// are thrown to the main menu with no message at all." It asks for
// "Connection to the server was lost, returning to the main menu, on screen,
// with the countdown. Every online game does this." The sentence existed, but
// it went through say(), which is log only, and the five seconds before the
// quit were a bare delay with nothing drawn.
//
// THE TRAP IN THE OBVIOUS FIX. The outage is noticed in onStrike, and onStrike
// runs inside the probe's HttpClient callback. SkyrimPlatform delivers those
// from its tick (TickImpl in SkyrimPlatform.cpp in the fork), and there is no
// Papyrus VM on tick, so CallNativeApi.cpp throws "can't be called in this
// context" for Debug.notification. note() swallows that throw. So turning the
// say() in onStrike into a note() would have looked right, passed a parse, and
// still put nothing on anybody's screen.
//
// A probe that never answers is the other way the outage is noticed: once it
// is past PROBE_DEADLINE_MS, checkServer counts it from the update tick. S7
// holds that path to the same message and countdown.
//
// So this runs the real code, lifted out of thornswood-front.js, against a
// SkyrimPlatform that refuses game calls outside update exactly the way the
// fork does, and looks at what reached the corner of the screen.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/** The text from one marker up to, but not including, the next. */
function between(start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}

/** One whole two-space-indented function, by its first line. */
function lift(first) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }\n', a);
  return b < 0 ? null : src.slice(a, b + 4);
}

const sayFn = lift('  function say(text) {');
const noteFn = lift('  function note(text) {');
const consts = between('  const PROBE_MS = ', '  let probe = null;');
const server = between('  let strikes = 0;', "  sp.on('browserMessage'");
// The tick's own order: the probe is asked, then the quit is considered.
const tick = between('    checkServer(now);', '\n    // The name is a guess');

yes('say() is in the plugin', sayFn !== null);
yes('note() is in the plugin', noteFn !== null);
yes('the probe settings are in the plugin', consts !== null);
yes('checkServer and onStrike are in the plugin', server !== null);
yes('the quit in the update tick is in the plugin', tick !== null);

const ready = sayFn && noteFn && consts && server && tick;

/**
 * The real code, with a clock, a probe and a game you control.
 *
 * Game calls work in update and throw anywhere else, the same as
 * CallNativeApi.cpp. The probe's answer is delivered on tick, the same as
 * SkyrimPlatform.cpp. Nothing that decides anything is stubbed.
 */
function harness(opts) {
  opts = opts || {};
  const clock = { t: 1000000 };
  const ctx = { where: 'update' };
  const screen = [];
  const refused = [];
  const logs = [];
  const quits = [];
  const closed = [];
  const world = { __thornswoodInWorld: true };
  let pending = null;

  function refuse(name) {
    refused.push(name);
    throw new Error("'" + name + "' can't be called in this context");
  }
  const sp = {
    Debug: {
      notification: function (t) {
        if (ctx.where !== 'update') { refuse('Debug.notification'); }
        screen.push({ at: clock.t, text: String(t) });
      }
    },
    Game: {
      quitToMainMenu: function () {
        if (ctx.where !== 'update') { refuse('Game.quitToMainMenu'); }
        quits.push(clock.t);
        if (opts.quitThrows) { throw new Error('the menu would not open'); }
      }
    },
    mpClientPlugin: {
      destroyClient: function () {
        if (ctx.where !== 'update') { refuse('mpClientPlugin.destroyClient'); }
        closed.push(clock.t);
      }
    }
  };
  const probe = { get: function (p, o, cb) { pending = cb; } };
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const guard = function (name, fn) { return fn; };
  const clockDate = { now: function () { return clock.t; } };
  const fn = new Function('sp', 'log', 'guard', 'probe', 'globalThis', 'Date',
    'askServerBases',
    sayFn + '\n' + noteFn + '\n' + consts + '\n' + server +
    '\nfunction frame(now) {\n' + tick + '\n}\n' +
    'return { frame: frame, strikesToLeave: PROBE_STRIKES, every: PROBE_MS,' +
    '  grace: RESTART_GRACE_MS,' +
    // typeof, so FRONT can point at a plugin from before the deadline and S7
    // fails there rather than the whole file throwing.
    '  deadline: typeof PROBE_DEADLINE_MS === "undefined" ? 15000 : PROBE_DEADLINE_MS };');
  const api = fn(sp, log, guard, probe, world, clockDate, function () { });

  const h = {
    clock: clock, screen: screen, refused: refused, logs: logs, quits: quits,
    closed: closed,
    world: world, strikesToLeave: api.strikesToLeave, every: api.every,
    grace: api.grace, deadline: api.deadline,
    /* How the server answers the next probe. Up until a scenario says not. */
    answer: function () { return { status: 200, body: '{"online":3}' }; },
    /* True: every probe is lost and its callback never comes. */
    silent: false,
    /* How many probes went out, answered or not. */
    asked: 0,
    /* Extra time before the first update after the outage is called. */
    stall: 0,
    left: function () { return logs.join('\n').indexOf('server unreachable') !== -1; },
    /* Frames of `step` ms for `ms` ms, delivering any answer on tick. */
    run: function (ms, step) {
      step = step || 16;
      const until = clock.t + ms;
      while (clock.t < until) {
        clock.t += step;
        ctx.where = 'update';
        api.frame(clock.t);
        if (pending) {
          const cb = pending;
          pending = null;
          h.asked++;
          if (h.silent) { continue; }
          const wasLeaving = h.left();
          ctx.where = 'tick';
          try { cb(h.answer()); } finally { ctx.where = 'update'; }
          if (!wasLeaving && h.left() && h.stall) { clock.t += h.stall; }
        }
      }
    }
  };
  return h;
}

const DOWN = function () { return { status: 0, body: '' }; };
const UP = function () { return { status: 200, body: '{"online":3}' }; };
const RESTARTING = function () {
  return { status: 200, body: '{"online":3,"restarting":true}' };
};

if (ready) {
  // S1: THE BUG. The server stops answering and stays down.
  {
    const h = harness();
    h.run(30000);
    h.answer = DOWN;
    h.run(h.every * (h.strikesToLeave + 1) + 6000);

    yes('S1 the probe did call the outage', h.left());
    yes('S1 and it went back to the main menu exactly once',
        h.quits.length === 1);
    yes('S1 the game connection is closed before the menu, so a reconnect cannot put them back',
        h.closed.length >= 1 && h.quits.length === 1 && h.closed[0] < h.quits[0]);
    const before = h.screen.filter(function (s) { return s.at < h.quits[0]; });
    yes('S1 THE BUG: something reached the screen before the quit',
        before.length > 0);
    yes('S1 the first line says the connection to the server was lost',
        before.length > 0 &&
        before[0].text.indexOf('connection to the server was lost') !== -1);
    yes('S1 and says where it is taking them',
        before.length > 0 && before[0].text.indexOf('main menu') !== -1);
    yes('S1 and it carries the prefix every note carries',
        before.length > 0 && before[0].text.indexOf('ThornsWood: ') === 0);
    // One line a second, five of them, never one a frame.
    const counts = before.map(function (s) {
      const m = s.text.match(/in (\d+)$/);
      return m ? Number(m[1]) : -1;
    });
    yes('S1 it counts down five, four, three, two, one',
        counts.join(',') === '5,4,3,2,1');
    yes('S1 and five lines in five seconds of frames, not one per frame',
        h.screen.length === 5);
    let spaced = before.length === 5;
    for (let i = 1; i < before.length; i++) {
      if (before[i].at - before[i - 1].at < 900) { spaced = false; }
    }
    yes('S1 each line lands about a second after the one before', spaced);
    yes('S1 only the first line repeats the reason',
        before.slice(1).every(function (s) {
          return s.text.indexOf('connection') === -1 &&
                 s.text.indexOf('returning to the main menu in ') !== -1;
        }));
    yes('S1 the five seconds are still five seconds',
        before.length > 0 && h.quits[0] - before[0].at >= 4900 &&
        h.quits[0] - before[0].at <= 5100);
    yes('S1 nothing was drawn while the strikes were still being counted',
        before.length > 0 && before.every(function (s) {
          return h.quits[0] - s.at <= 5100;
        }));
    yes('S1 no game call was tried from the probe, where the game refuses it',
        h.refused.length === 0);
    yes('S1 the world flag is cleared on the way out',
        h.world.__thornswoodInWorld === false);
    yes('S1 and the log still has the outage in it',
        h.logs.join('\n').indexOf('the server has gone down') !== -1);

    // Never twice: sitting at the main menu afterwards says nothing more.
    const n = h.screen.length;
    h.run(600000, 50);
    yes('S1 afterwards, nothing more is drawn', h.screen.length === n);
    yes('S1 and it does not quit again', h.quits.length === 1);
  }

  // S2: a server that misses a few probes and comes back is not an outage.
  {
    const h = harness();
    h.answer = DOWN;
    h.run(h.every * (h.strikesToLeave - 2));
    h.answer = UP;
    h.run(h.every * 3);
    h.answer = DOWN;
    h.run(h.every * (h.strikesToLeave - 2));
    yes('S2 a few missed probes draw nothing', h.screen.length === 0);
    yes('S2 and put nobody back at the menu', h.quits.length === 0);
  }

  // S3: a restart people were told about is not an outage either, however
  //     many probes it misses, until the grace runs out.
  {
    const h = harness();
    h.answer = RESTARTING;
    h.run(h.every * 2);
    h.answer = DOWN;
    h.run(h.grace - h.every * 4, 50);
    yes('S3 a restart the server announced draws nothing', h.screen.length === 0);
    yes('S3 and puts nobody back at the menu', h.quits.length === 0);
    h.run(h.every * 4 + 6000, 16);
    yes('S3 past the grace it is an outage, and it says so on screen',
        h.quits.length === 1 && h.screen.length === 5 &&
        h.screen[0].text.indexOf('connection to the server was lost') !== -1);
  }

  // S4: the quit itself fails. This is the one path where the person is left
  //     standing in a world with no server, so it has to be on screen.
  {
    const h = harness({ quitThrows: true });
    h.answer = DOWN;
    h.run(h.every * (h.strikesToLeave + 1) + 6000);
    const last = h.screen.length ? h.screen[h.screen.length - 1].text : '';
    yes('S4 the quit was tried', h.quits.length === 1);
    yes('S4 THE BUG: a failed quit tells them on screen to close the game',
        last.indexOf('Close the game and press Play again') !== -1);
    yes('S4 and says it after the countdown, not instead of it',
        h.screen.length === 6);
    yes('S4 and the failure is in the log', h.logs.join('\n')
        .indexOf('could not quit to the main menu') !== -1);
  }

  // S5: a slow first frame after the outage is called. The line that lands
  //     first still says why, rather than a bare number.
  {
    const h = harness();
    h.stall = 1500;
    h.answer = DOWN;
    h.run(h.every * (h.strikesToLeave + 1) + 6000);
    yes('S5 the first line after a stall still says the connection was lost',
        h.screen.length > 0 &&
        h.screen[0].text.indexOf('connection to the server was lost') !== -1);
    yes('S5 and picks the count up where the clock is',
        h.screen.length > 0 && /in 4$/.test(h.screen[0].text));
    yes('S5 and the quit still comes at five seconds, once',
        h.quits.length === 1);
  }

  // S6: a fast machine draws no more lines than a slow one.
  {
    const h = harness();
    h.answer = DOWN;
    h.run(h.every * (h.strikesToLeave + 1) + 6000, 4);
    yes('S6 at two hundred and fifty frames a second it is still five lines',
        h.screen.length === 5);
  }

  // S7: a server that takes the connection and never answers. No callback
  //     comes, so every strike is a deadline counted in the update tick, and
  //     the person still gets the same line and the same countdown.
  {
    const h = harness();
    h.run(30000);
    const before = h.asked;
    const quiet = h.clock.t;
    h.silent = true;
    h.run(h.deadline * (h.strikesToLeave + 1) + 6000);
    const lost = h.asked - before;
    yes('S7 a server that never answers is left', h.left());
    yes('S7 after twelve lost asks, and not one more', lost === h.strikesToLeave);
    yes('S7 each one counted by its deadline',
        h.logs.filter(function (l) {
          return l.indexOf('has not answered in') !== -1;
        }).length === h.strikesToLeave);
    yes('S7 and it went back to the main menu exactly once',
        h.quits.length === 1);
    yes('S7 within twelve deadlines of the silence, plus the five seconds',
        h.quits.length === 1 &&
        h.quits[0] - quiet <= h.every +
          h.strikesToLeave * (h.deadline + 16) + 5100);
    const counts = h.screen.map(function (s) {
      const m = s.text.match(/in (\d+)$/);
      return m ? Number(m[1]) : -1;
    });
    yes('S7 the first line says the connection to the server was lost',
        h.screen.length > 0 &&
        h.screen[0].text.indexOf('connection to the server was lost') !== -1);
    yes('S7 it counts down five, four, three, two, one',
        counts.join(',') === '5,4,3,2,1');
    yes('S7 and nothing was refused, because all of it ran in update',
        h.refused.length === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
