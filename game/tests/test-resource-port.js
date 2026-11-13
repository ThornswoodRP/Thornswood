// test-resource-port.js
//
//     node .\game\tests\test-resource-port.js
//
// A game on the dev server watches the dev server, not the live one (#1264).
//
// WHAT WAS WRONG. 29 Sep, evening: the dev server went down three times
// (19:24, 19:37, 19:38) with people in the world. Nobody was taken back to
// the menu. They stood in a world with no server behind it until they closed
// the game. The way out was there (test-server-down.js holds it: twelve
// strikes, a countdown, the main menu), but the probe that counts the strikes
// asked http://<server>:3000/online.json whatever server the game was on, and
// 3000 is the LIVE server's resource port. The dev server's is 7788
// (SkyMp.ResourcePortFor: 3000 for 7777, the game port plus one for any
// other). Live answered every probe, so the strikes never came. The server
// handled bases were asked of live too: Djinn's front log that evening says
// "the server answers for 732 more bases", live's number, while the dev
// server had published 728.
//
// So this runs the real code, lifted out of thornswood-front.js: the client
// settings read, the probe, the bases ask, the line's client and the quit in
// the update tick, against a stand-in HttpClient that answers by address.
// Live is up and dev is down, the way it was that evening.
//
// FRONT=<file> runs it against another copy of the plugin, which is how the
// copy from before the fix is shown to fail.
//
// Read only. Nothing connects to anything.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const SRC = process.env.FRONT || path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

function between(start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}
function lift(first) {
  const a = src.indexOf(first);
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }\n', a);
  return b < 0 ? null : src.slice(a, b + 4);
}

// The settings read and whatever the plugin makes of them, up to the next block.
const settings = between('  const client = (function () {', '\n  /*\n    The token that says which profile');
const sayFn = lift('  function say(text) {');
const noteFn = lift('  function note(text) {');
const consts = between('  const PROBE_MS = ', '  let probe = null;');
const probeAndBases = between('  let probe = null;', '  let strikes = 0;');
const server = between('  let strikes = 0;', "  sp.on('browserMessage'");
const tick = between('    checkServer(now);', '\n    // The name is a guess');
const lineClient = between('  let lineHttp = null;', '  let lineAsk = null;');

yes('the client settings read is in the plugin', settings !== null);
yes('say() and note() are in the plugin', sayFn !== null && noteFn !== null);
yes('the probe, its settings and the bases ask are in the plugin', consts !== null && probeAndBases !== null);
yes('checkServer and onStrike are in the plugin', server !== null);
yes('the quit in the update tick is in the plugin', tick !== null);
yes("the line's client is in the plugin", lineClient !== null);
if (!(settings && sayFn && noteFn && consts && probeAndBases && server && tick && lineClient)) { done(); }

const LIVE = 'http://server.invalid:3000';
const DEV = 'http://server.invalid:7788';

/*
  The real code with a clock, a game that refuses calls outside update the
  way the fork does, and an HttpClient whose answer depends on its address.
  up[base] says whether that server answers.
*/
function harness(port, up) {
  const clock = { t: 1000000 };
  const ctx = { where: 'update' };
  const screen = [], logs = [], quits = [], asked = [];
  const world = { __thornswoodInWorld: true };
  const made = [];
  let pending = [];
  function refuse(name) { throw new Error("'" + name + "' can't be called in this context"); }
  function HttpClient(base) {
    made.push(String(base));
    this.base = String(base);
  }
  HttpClient.prototype.get = function (p, o, cb) {
    asked.push(this.base + p);
    pending.push({ base: this.base, cb: cb });
  };
  const sp = {
    HttpClient: HttpClient,
    Debug: { notification: function (t) { if (ctx.where !== 'update') { refuse('Debug.notification'); } screen.push({ at: clock.t, text: String(t) }); } },
    Game: { quitToMainMenu: function () { if (ctx.where !== 'update') { refuse('Game.quitToMainMenu'); } quits.push(clock.t); } }
  };
  const settingsText = port === null ? '{}' :
    JSON.stringify({ 'server-ip': 'server.invalid', 'server-port': port, profileId: 4242 });
  const readText = function () { return settingsText; };
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const guard = function (name, fn) { return fn; };
  const clockDate = { now: function () { return clock.t; } };
  const fn = new Function('sp', 'log', 'guard', 'globalThis', 'Date', 'readText', 'CLIENT_SETTINGS',
    'let serverBasesAsked = 0; const serverBases = {};\n' +
    settings + '\n' + sayFn + '\n' + noteFn + '\n' + consts + '\n' + probeAndBases + '\n' + server + '\n' + lineClient +
    '\nfunction frame(now) {\n' + tick + '\n}\n' +
    'return { frame: frame, strikes: PROBE_STRIKES, every: PROBE_MS, bases: askServerBases, line: lineClient,' +
    ' url: typeof RESOURCE_URL === "undefined" ? null : RESOURCE_URL };');
  const api = fn(sp, log, guard, world, clockDate, readText, 'settings');
  return {
    api: api, made: made, asked: asked, quits: quits, screen: screen, logs: logs, world: world, clock: clock,
    run: function (ms) {
      const until = clock.t + ms;
      while (clock.t < until) {
        clock.t += 50;
        ctx.where = 'update';
        api.frame(clock.t);
        const now = pending;
        pending = [];
        for (const q of now) {
          ctx.where = 'tick';
          try { q.cb(up[q.base] ? { status: 200, body: '{"online":1}' } : { status: 0, body: '' }); }
          finally { ctx.where = 'update'; }
        }
      }
    }
  };
}

// D1: THE BUG. On dev, the dev server down and live up.
{
  const up = {}; up[LIVE] = true; up[DEV] = false;
  const h = harness(7787, up);
  h.run(h.api.every * (h.api.strikes + 2) + 7000);
  yes('D1 on the dev server the probe asks the dev server (' + (h.asked[0] || 'nothing') + ')',
      h.asked.length > 0 && h.asked.every(function (a) { return a.indexOf(DEV + '/') === 0; }));
  yes('D1 it never asks the live server', !h.asked.some(function (a) { return a.indexOf(LIVE) === 0; }));
  yes('D1 THE BUG: with the dev server down, the game is taken back to the main menu', h.quits.length === 1);
  yes('D1 and the person is told the connection to the server was lost',
      h.screen.some(function (s) { return s.text.indexOf('connection to the server was lost') !== -1; }));
  yes('D1 the world flag is cleared on the way out', h.world.__thornswoodInWorld === false);
}

// D2: dev up, live down. Live going away is not a reason to leave dev.
{
  const up = {}; up[LIVE] = false; up[DEV] = true;
  const h = harness(7787, up);
  h.run(h.api.every * (h.api.strikes + 2) + 7000);
  yes('D2 on dev, live being down does not take anybody out of the dev world', h.quits.length === 0);
}

// M1, M2: the main server keeps its port.
{
  const up = {}; up[LIVE] = false; up[DEV] = true;
  const h = harness(7777, up);
  h.run(h.api.every * (h.api.strikes + 2) + 7000);
  yes('M1 on the main server the probe asks port 3000', h.asked.length > 0 &&
      h.asked.every(function (a) { return a.indexOf(LIVE + '/') === 0; }));
  yes('M1 and the main server down takes the game back to the menu', h.quits.length === 1);
}
{
  const up = {}; up[LIVE] = true; up[DEV] = false;
  const h = harness(7777, up);
  h.run(h.api.every * (h.api.strikes + 2) + 7000);
  yes('M2 the main server up keeps the game in the world', h.quits.length === 0);
}
{
  const up = {}; up[LIVE] = true;
  const h = harness('7777', up);
  h.run(1000);
  yes('M3 a port written as text reads the same as a number', h.asked.length > 0 && h.asked[0].indexOf(LIVE + '/') === 0);
}
{
  const h = harness(null, {});
  h.run(1000);
  yes('M4 no server address in the settings: no probe at all, nothing asked', h.made.length === 0 && h.asked.length === 0);
}

// B1: the server handled bases come from the server the game is on.
{
  const up = {}; up[LIVE] = true; up[DEV] = true;
  const h = harness(7787, up);
  h.api.bases(5000000);
  const b = h.asked.filter(function (a) { return /server-bases\.json$/.test(a); });
  yes('B1 on dev the server handled bases are asked of the dev server (' + (b[0] || 'nothing') + ')',
      b.length === 1 && b[0] === DEV + '/server-bases.json');
}

// L1: the line's client is on the same address.
{
  const h = harness(7787, {});
  const c = h.api.line();
  yes("L1 on dev the line's client is the dev server's resource port", c && c.base === DEV);
  const h2 = harness(7777, {});
  const c2 = h2.api.line();
  yes("L1 on the main server the line's client is port 3000", c2 && c2.base === LIVE);
}

// S1: one rule, in one place.
{
  const makers = src.match(/new sp\.HttpClient\(([^)]*)\)/g) || [];
  yes('S1 every HttpClient the plugin makes is on RESOURCE_URL (' + makers.length + ' of them)',
      makers.length >= 2 && makers.every(function (m) { return m === 'new sp.HttpClient(RESOURCE_URL)'; }));
  yes("S1 no address in the plugin names port 3000 by itself", !/['"]:3000['"]/.test(src));
}

done();
