// test-watchdog.js
//
// The check that tells somebody the server is gone must not be able to switch
// itself off.
//
// WHAT WAS WRONG. thornswood-front.js asks the server for online.json every ten
// seconds and quits to the main menu after twelve unanswered asks in a row. A
// flag says an ask is out, and checkServer does nothing while it is set. That
// flag was cleared only by the ask's own answer, so one request that never came
// back left the watchdog off for the rest of the session.
//
// MEASURED IN THE FORK. skyrim-platform/src/platform_lib/HttpClient.cpp builds
// an httplib::Client with no timeouts, on one pool of three threads shared by
// every plugin, and the vendored cpp-httplib 0.40.0 defaults the connect and
// read timeouts to 300 seconds. So a server that accepts the connection and
// never answers held each ask for five minutes: twelve strikes in about an hour
// instead of two minutes. And a request that throws on its worker thread never
// calls back at all, because BS_thread_pool keeps the error in a future that
// HttpClient.cpp drops, so the flag stayed set for good.
//
// This cuts the real watchdog out of the plugin and runs it against a server
// that never answers, one that answers late, and one that refuses at once, on a
// clock the test controls.
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

// From the first probe constant through the end of onStrike: the constants,
// the HttpClient, askServerBases, the state, checkServer and onStrike.
const START = '  const PROBE_MS = ';
const END = '\n  }\n';
const a = src.indexOf(START);
const s = a < 0 ? -1 : src.indexOf('  function onStrike() {', a);
const b = s < 0 ? -1 : src.indexOf(END, s);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;

yes('the plugin still has its server watchdog', block !== null);

/**
 * The real block, with a clock and a server you control.
 *
 * Only what touches the game is replaced: the HttpClient, log, say and the
 * clock. guard is the same shape as the plugin's, a try around the callback.
 */
function harness(server) {
  const clock = { t: 0 };
  const sent = [];
  const logs = [];
  const said = [];
  const probe = {
    get: function (p, opts, cb) {
      const req = { path: p, cb: cb, at: clock.t };
      sent.push(req);
      if (server) { server(req); }
    }
  };
  const sp = { HttpClient: function () { return probe; } };
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const say = function (t) { said.push(t); };
  const guard = function (name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { logs.push(name + ' threw: ' + (e && e.stack ? e.stack : e)); return undefined; }
    };
  };
  const FakeDate = { now: function () { return clock.t; } };
  // RESOURCE_URL is the address the plugin makes from its settings (#1264);
  // HOST is kept for a copy of the plugin from before that.
  const fn = new Function('sp', 'HOST', 'RESOURCE_URL', 'guard', 'log', 'say', 'Date',
    'let serverBasesAsked = 0; const serverBases = {};\n' + block +
    '\nreturn {' +
    '  check: checkServer,' +
    '  strikes: function () { return strikes; },' +
    '  probing: function () { return probing; },' +
    '  leaving: function () { return leaving; },' +
    '  every: PROBE_MS, max: PROBE_STRIKES, grace: RESTART_GRACE_MS,' +
    '  deadline: typeof PROBE_DEADLINE_MS === "number" ? PROBE_DEADLINE_MS : 0' +
    '};');
  const api = fn(sp, 'test.invalid', 'http://test.invalid:3000', guard, log, say, FakeDate);
  api.clock = clock; api.sent = sent; api.logs = logs; api.said = said;
  // One call of the plugin's update handler at time t.
  api.at = function (t) { clock.t = t; api.check(t); };
  // Every frame from now until t, a quarter second apart.
  api.run = function (from, to, onEach) {
    for (let t = from; t <= to; t += 250) {
      api.at(t);
      if (onEach && onEach(t)) { return t; }
    }
    return 0;
  };
  return api;
}

// A request that was never sent has nothing to answer. Before the fix that is
// most of them, and the run should say so in FAIL lines rather than crash.
function answer(req, status, body) {
  if (!req) { return; }
  req.cb({ status: status, body: body || '{}', error: '' });
}

if (block !== null) {
  // The generosity is deliberate, see the comment on PROBE_STRIKES. The fix
  // must not buy speed by shortening it.
  {
    const h = harness(null);
    yes('the probe still goes every ten seconds', h.every === 10000);
    yes('twelve strikes, not fewer', h.max === 12);
    yes('the restart grace is still ten minutes', h.grace === 600000);
    yes('there is a deadline on an ask that is out', h.deadline > 0);
    yes('the deadline is not shorter than one probe interval', h.deadline >= h.every);
  }

  // S1: THE BUG. A probe that never calls back.
  {
    const h = harness(null);
    const t0 = 1000000;
    h.at(t0);
    yes('S1 the first ask goes out', h.sent.length === 1);
    yes('S1 and it is to online.json', h.sent[0].path === '/online.json');
    h.at(t0 + 10001);
    yes('S1 one probe interval later nothing more goes out while it is out',
        h.sent.length === 1);
    h.at(t0 + 14999);
    yes('S1 nor just before the deadline', h.sent.length === 1);
    h.at(t0 + 30001);
    yes('THE BUG: once the clock passes thirty seconds a second ask has gone out',
        h.sent.length === 2);
    yes('S1 and the ask that never answered counts as a strike', h.strikes() === 1);
    yes('S1 and the log says the server did not answer in time',
        h.logs.join('\n').indexOf('has not answered in') !== -1);
    h.at(t0 + 30001 + h.deadline + 1);
    yes('S1 and a third after the second one also goes quiet', h.sent.length === 3);
    yes('S1 two strikes by then', h.strikes() === 2);
  }

  // S2: a server that takes the connection and never answers is noticed in
  //     minutes, not an hour, and the person is told and sent to the menu.
  {
    const h = harness(null);
    const t0 = 2000000;
    const left = h.run(t0, t0 + 3600000, function () { return h.leaving() > 0; });
    yes('S2 a server that never answers is left in the end', left > 0);
    yes('S2 not before twelve probe intervals, so it is no quicker than a refusal',
        left - t0 >= h.max * h.every);
    // A frame of slack for each deadline, because a deadline is only seen on
    // the next frame after it passes.
    yes('S2 but within twelve deadlines and a frame each, not an hour',
        left > 0 && left - t0 <= h.max * (h.deadline + 250));
    yes('S2 after twelve strikes', h.strikes() === h.max);
    yes('S2 and the person is told the server has gone down',
        h.said.join('\n').indexOf('the server has gone down') !== -1);
    const n = h.sent.length;
    yes('S2 one ask per strike and no more', n === h.max);
    h.run(left + 250, left + 120000);
    yes('S2 nothing more goes out once it is leaving', h.sent.length === n);
  }

  // S3: an answer that comes late, but says the server is up, still counts.
  //     A slow reply is not an outage.
  {
    const h = harness(null);
    const t0 = 3000000;
    h.at(t0);
    h.at(t0 + h.deadline + 1);
    h.at(t0 + 2 * h.deadline + 2);
    yes('S3 two asks went unanswered past their deadlines', h.strikes() === 2);
    yes('S3 and a third is out', h.sent.length === 3 && h.probing());
    answer(h.sent[0], 200);
    yes('S3 the first answer turning up late resets the strikes', h.strikes() === 0);
    yes('S3 and the log says the server is answering again',
        h.logs.join('\n').indexOf('answering again') !== -1);
    yes('S3 but it does not clear the flag for the ask that is out now',
        h.probing() === true);
    h.at(t0 + 2 * h.deadline + 2 + h.every + 1);
    yes('S3 so no second ask is stacked on the one still out', h.sent.length === 3);
    answer(h.sent[2], 200);
    yes('S3 the current ask answering clears the flag', h.probing() === false);
  }

  // S4: a late failure is not counted twice. The deadline already counted it.
  {
    const h = harness(null);
    const t0 = 4000000;
    h.at(t0);
    h.at(t0 + h.deadline + 1);
    yes('S4 one strike from the deadline', h.strikes() === 1);
    answer(h.sent[0], 0);
    yes('S4 the same ask failing later adds nothing', h.strikes() === 1);
    yes('S4 and leaves the flag with the ask that is out now', h.probing() === true);
    answer(h.sent[1], 0);
    yes('S4 the current ask failing is a strike as before', h.strikes() === 2);
    yes('S4 and clears its flag', h.probing() === false);
  }

  // S5: a late failure after the deadline with no newer ask out yet, which is
  //     what happens when that strike was the one that set leaving.
  {
    const h = harness(null);
    const t0 = 5000000;
    const left = h.run(t0, t0 + 3600000, function () { return h.leaving() > 0; });
    const k = h.strikes();
    for (const req of h.sent) { answer(req, 0); }
    yes('S5 late failures after leaving add no strikes', left > 0 && h.strikes() === k);
    yes('S5 and nothing threw', h.logs.join('\n').indexOf('threw') === -1);
  }

  // S6: nothing changed for a server that answers, or for one that refuses.
  {
    const h = harness(function (req) { answer(req, 200); });
    const t0 = 6000000;
    h.run(t0, t0 + 600000);
    yes('S6 a server that answers is never left', h.leaving() === 0);
    yes('S6 and is asked once every ten seconds',
        h.sent.length >= 60 && h.sent.length <= 61);
    yes('S6 with no strikes', h.strikes() === 0);
  }
  {
    const h = harness(function (req) { answer(req, 0); });
    const t0 = 7000000;
    const left = h.run(t0, t0 + 3600000, function () { return h.leaving() > 0; });
    yes('S6 a server that refuses is left after twelve asks',
        left > 0 && h.sent.length === h.max);
    yes('S6 about two minutes after the first, as before',
        left - t0 >= (h.max - 1) * h.every && left - t0 <= h.max * h.every);
    yes('S6 and no deadline line, because every ask was answered',
        h.logs.join('\n').indexOf('has not answered in') === -1);
  }

  // S7: a server that said it was restarting and then goes quiet is waited
  //     for, deadline or not, for as long as the grace lasts.
  {
    let first = true;
    const h = harness(function (req) {
      if (first) { first = false; answer(req, 200, '{"restarting":true}'); }
    });
    const t0 = 8000000;
    h.run(t0, t0 + 300000);
    yes('S7 five minutes of silence after a restart notice is not left',
        h.leaving() === 0);
    yes('S7 though the silence is counted', h.strikes() > h.max);
    const left = h.run(t0 + 300250, t0 + 3600000, function () { return h.leaving() > 0; });
    yes('S7 and once the grace is over it is left', left > 0 && left - t0 >= h.grace);
  }
}

// ---------------------------------------------------------------- structure
//
// Everything in this file runs inside guard(), so a throw in a callback is a
// log line rather than a dead handler. The probe's callback has to stay so.
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the probe callback is still wrapped in guard',
      /probe\.get\('\/online\.json', undefined, guard\('probe',/.test(code));
  const setAt = code.indexOf('probeStartedAt = now');
  const setFlag = code.indexOf('probing = true', setAt);
  yes('probeStartedAt is set where the flag is set',
      setAt > 0 && setFlag > setAt && setFlag - setAt < 60);
  const test = code.indexOf('now - probeStartedAt > PROBE_DEADLINE_MS');
  const ret = code.indexOf('if (probing || leaving) return;');
  yes('and tested before the check that returns while an ask is out',
      test > 0 && ret > test);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
