/*
  test-allowed-rate-limit.js

      node .\site\tests\test-allowed-rate-limit.js

  Issue #415: "The door's allow list stops refreshing somewhere past a
  hundred linked accounts, and one rate-limited lookup throws the whole list
  away".

  The second half (failedProfiles, the door keeping only who failed) is
  test-allowed-failed.js. This is the rest:

  - discordGet reads how long Discord says to wait (Retry-After,
    x-ratelimit-reset-after, retry_after in the body, x-ratelimit-remaining 0)
    and asks nothing more until that has passed, instead of going straight
    on to the next person and collecting another 429.
  - /api/allowed asks four at a time, inside a budget shorter than the door's
    ten second timeout. At 100ms a call a hundred linked accounts took ten
    seconds one at a time, and the door gave up before the answer came.

  The real discordGet, standingsForDoor and /api/allowed route are lifted out
  of site\server.js and run against a pretend Discord. Nothing leaves this
  machine. Read only.

  Against an older server.js (SITE=...) the timing checks fail, which is the
  point: that is the "before".

  Every time checked here is read off a clock the harness keeps (#1674), not
  the machine's, so a busy machine cannot move a number.
*/
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const CR = String.fromCharCode(13);

const SITE = process.env.SITE || path.join(__dirname, '..', '..', 'site', 'server.js');
const GAME = process.env.GAMEMODE || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const site = siteFiles.source(SITE).split(CR).join('');
const game = fs.readFileSync(GAME, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => (Array.isArray(a) ? a.slice().sort((x, y) => x - y) : a);

/*
  THE HARNESS'S CLOCK (#1674). These checks used to time node's own clock
  with 150 ms to spare: Retry-After 2 had to come out between 1850 and 2150.
  A machine busy enough to hold this process for longer than that between two
  lines (4 October, several agents building at once) failed 2 of the 32 with
  nothing wrong in server.js, and the nightly run would have gone red for it.

  So the pieces lifted out of server.js, and the pretend Discord, are handed
  this Date, setTimeout and clearTimeout in place of node's. Time moves only
  when onClock moves it: everything that can happen without time passing
  happens first, then the clock jumps to the next timer due and runs it. How
  long the machine takes between two lines no longer counts, so every number
  below is the one server.js means, exactly. It starts on a whole second, so
  a Retry-After written as a date (whole seconds) loses nothing.
*/
const clock = { now: Date.UTC(2026, 9, 5, 12, 0, 0), seq: 0, timers: [] };
class ClockDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(clock.now); }
  static now() { return clock.now; }
}
function clockSetTimeout(fn, ms) {
  const t = { at: clock.now + Math.max(0, Number(ms) || 0), seq: clock.seq++, fn: fn };
  clock.timers.push(t);
  return t;
}
function clockClearTimeout(t) {
  const i = clock.timers.indexOf(t);
  if (i >= 0) clock.timers.splice(i, 1);
}
/** What `p` settles to, run on the harness's clock. */
async function onClock(p) {
  let done = false, threw = false, value;
  p.then(function (v) { done = true; value = v; }, function (e) { done = true; threw = true; value = e; });
  for (;;) {
    // Node runs every promise that can go on before it gets here.
    await new Promise(function (r) { setImmediate(r); });
    if (done) break;
    if (!clock.timers.length) {
      const e = new Error('never answered: a lookup that never comes back held it, with nothing left on the clock to wait for');
      e.hang = true;
      throw e;
    }
    clock.timers.sort(function (a, b) { return a.at - b.at || a.seq - b.seq; });
    const t = clock.timers.shift();
    clock.now = t.at;
    t.fn();
  }
  if (threw) throw value;
  return value;
}

// A route that waits forever on a lookup leaves node with nothing to do, and
// node then exits 0 without a word. That must read as a failure.
let finished = false;
process.on('exit', function () {
  if (finished) return;
  console.log('FAIL  the route never answered: a lookup that never comes back held it');
  console.log('');
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  process.exitCode = 1;
});

/** From the first `{` at or after `from` to the brace that closes it. */
function toClose(text, from) {
  const b = text.indexOf('{', from);
  let d = 0;
  for (let i = b; i < text.length; i++) {
    if (text[i] === '{') d++;
    else if (text[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  return -1;
}
function between(startMark, fnMark) {
  const at = site.indexOf(startMark);
  const fn = at < 0 ? -1 : site.indexOf(fnMark, at);
  const end = fn < 0 ? -1 : toClose(site, fn);
  return (fn >= 0 && end > fn) ? site.slice(at, end) : '';
}

// ---- the pieces, out of server.js ------------------------------------------
const getSrc = between('let discordQuietUntil = 0;', 'function discordGet(path) {');
yes('discordGet and its quiet-until are in server.js', getSrc.indexOf('discordQuietMs() > 0') >= 0);
const forDoorSrc = between('const DOOR_BUDGET_MS', 'async function standingsForDoor(');
yes('standingsForDoor is in server.js', forDoorSrc.length > 0);
const routeAt = site.indexOf("if ((route === '/api/allowed' || devDoor) && req.method === 'GET') {");
const routeEnd = routeAt < 0 ? -1 : toClose(site, routeAt);
const route = (routeAt >= 0 && routeEnd > routeAt) ? site.slice(routeAt, routeEnd) : '';
yes('the /api/allowed route is in server.js', route.indexOf('return sendJson(res, 200, out);') >= 0);

/*
  A pretend Discord. answer(path) says { ms, status, headers, body } for each
  request; asked lists every path that really went out. Each call makes a
  fresh discordGet with its own quiet-until, the way a fresh site starts,
  with nothing waiting on the harness's clock.
*/
function discord(answer) {
  const asked = [];
  clock.timers.length = 0;
  const https = {
    get: function (opts, cb) {
      asked.push(opts.path);
      const a = answer(opts.path) || {};
      const on = {};
      clockSetTimeout(function () {
        cb({ statusCode: a.status || 200, headers: a.headers || {}, on: function (ev, fn) { on[ev] = fn; } });
        if (on.data) on.data(a.body === undefined ? '{}' : (typeof a.body === 'string' ? a.body : JSON.stringify(a.body)));
        if (on.end) on.end();
      }, a.ms || 0);
      return { setTimeout: function () { }, on: function () { }, destroy: function () { } };
    }
  };
  const api = getSrc ? new Function('cfg', 'https', 'console', 'Date', 'setTimeout', 'clearTimeout',
    getSrc + '\nreturn { discordGet: discordGet, discordQuietMs: discordQuietMs,' +
    ' quietFor: function () { return discordQuietUntil - Date.now(); } };')(
      { discord: { botToken: 't', guildId: 'g' } }, https, { error: function () { } },
      ClockDate, clockSetTimeout, clockClearTimeout)
    // An older server.js: a plain discordGet with no quiet-until, so the old
    // route is timed on the same pretend Discord.
    : { discordGet: function (p) {
          return new Promise(function (resolve) {
            https.get({ path: '/api/v10' + p }, function (res) {
              res.on('end', function () {
                resolve(res.statusCode === 200 ? { ok: true, status: 200, body: {} }
                  : { ok: false, status: res.statusCode, why: res.statusCode === 429 ? 'rate limited by Discord' : 'Discord answered ' + res.statusCode });
              });
            });
          });
        },
        discordQuietMs: function () { return 0; }, quietFor: function () { return 0; } };
  api.asked = asked;
  // standing() reduced to the part this is about: one member lookup per
  // account, a 404 means not in the server, anything else failed is a failed
  // lookup with discordGet's reason.
  api.standingCached = async function (id) {
    const r = await api.discordGet('/guilds/g/members/' + id);
    if (!r.ok) return r.status === 404 ? { play: false } : { lookupFailed: r.why };
    return { play: true, banned: false, dev: false, admin: false, name: String(id) };
  };
  return api;
}

/** The real route over `linked`, with standingsForDoor built over `api`. */
async function ask(linked, api, budget) {
  let sent = null;
  const src = budget ? forDoorSrc.replace(/const DOOR_BUDGET_MS = \d+;/, 'const DOOR_BUDGET_MS = ' + budget + ';') : forDoorSrc;
  const standingsForDoor = src
    ? new Function('standingCached', 'discordQuietMs', 'Date', 'setTimeout', 'clearTimeout',
        src + '\nreturn standingsForDoor;')(
        api.standingCached, api.discordQuietMs, ClockDate, clockSetTimeout, clockClearTimeout)
    : undefined;
  const run = new Function(
    'route', 'devDoor', 'req', 'res', 'cfg', 'url', 'sameSecret', 'sendJson',
    'jsonFile', 'LINKED', 'standingCached', 'keyInAddress', 'standingsForDoor', 'activeBans', 'pkProfiles',
    'Date', 'setTimeout', 'clearTimeout', 'officesForDoor',
    'return (async function () {\n' + route + '\n})();');
  const t0 = clock.now;
  await onClock(run('/api/allowed', false,
    { method: 'GET', headers: { 'x-thornswood-key': 'k' } }, {}, { botKey: 'k' },
    { searchParams: { get: function () { return 'k'; } } },
    function (a, b) { return a === b; },
    function (res, code, body) { sent = { code: code, body: JSON.parse(JSON.stringify(body)) }; },
    function () { return linked; }, 'linked.json',
    // No staff bans here (#412); test-staff-bans.js runs them.
    api.standingCached, new Set(), standingsForDoor, function () { return []; },
    // Nobody killed for good here (#1010); test-bans-pk.js runs that.
    function () { return []; },
    ClockDate, clockSetTimeout, clockClearTimeout,
    // No hold offices here (#2551); test-2551-hold-offices.js runs them.
    async function () { return []; }));
  if (sent) sent.ms = clock.now - t0;
  return sent;
}

function five() {
  return {
    d1: { name: 'one', profiles: [101] }, d2: { name: 'two', profiles: [102] },
    d3: { name: 'three', profiles: [103] }, d4: { name: 'four', profiles: [104] },
    d5: { name: 'five', profiles: [105] }
  };
}

(async () => {
  // ================================================== discordGet's quiet-until
  async function once(a) {
    const api = discord(function () { return a; });
    const r = api.discordGet ? await onClock(api.discordGet('/x')) : {};
    return { r: r, quiet: api.quietFor(), api: api };
  }
  let o = await once({ status: 429, headers: { 'retry-after': '2' } });
  yes('a 429 is still reported as rate limited by Discord', o.r.status === 429 && o.r.why === 'rate limited by Discord');
  yes('and Retry-After in seconds sets the quiet time', o.quiet === 2000);
  const again = o.api.discordGet ? await onClock(o.api.discordGet('/y')) : {};
  yes('while quiet, discordGet answers rate limited without asking Discord',
      again.status === 429 && again.why === 'rate limited by Discord' && same(o.api.asked, ['/api/v10/x']));

  o = await once({ status: 429, headers: { 'x-ratelimit-reset-after': '1.5' } });
  yes('x-ratelimit-reset-after is read when Retry-After is missing', o.quiet === 1500);
  o = await once({ status: 429, body: { message: 'You are being rate limited.', retry_after: 0.8, global: false } });
  yes('retry_after in the body is read when no header says', o.quiet === 800);
  o = await once({ status: 429, headers: { 'retry-after': new Date(clock.now + 3000).toUTCString() } });
  yes('Retry-After as a date is read too', o.quiet === 3000);
  o = await once({ status: 429 });
  yes('a 429 that says nothing still backs off for a second', o.quiet === 1000);
  o = await once({ status: 429, headers: { 'retry-after': '99999' } });
  yes('a wait longer than a minute is held to a minute', o.quiet === 60000);
  o = await once({ status: 200, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset-after': '0.5' }, body: { user: { id: '1' } } });
  yes('the last call before a limit still answers', o.r.ok === true);
  yes('and x-ratelimit-remaining 0 waits out x-ratelimit-reset-after before the next', o.quiet === 500);
  o = await once({ status: 200, headers: { 'x-ratelimit-remaining': '3', 'x-ratelimit-reset-after': '0.5' }, body: {} });
  yes('with calls left there is no quiet time', o.quiet <= 0);
  o = await once({ status: 404 });
  yes('a 404 is still not found, and sets no quiet time', o.r.status === 404 && o.quiet <= 0);

  // ======================================= one rate limited in five, the route
  // d3 answers 429 first, telling the site to wait 200ms. That wait is shorter
  // than the time left, so it is waited out once and d5 is still asked.
  let api = discord(function (p) {
    if (/\/d3$/.test(p)) return { ms: 5, status: 429, headers: { 'retry-after': '0.2' } };
    return { ms: 20, status: 200, body: { user: { id: p } } };
  });
  let got = await ask(five(), api);
  let b = got ? got.body : {};
  yes('429 for one id in five: the route answers 200', got && got.code === 200);
  yes('and still lists the four good profiles', same(sorted(b.profiles), [101, 102, 104, 105]));
  yes('and names the rate limited one in failedProfiles, the door keeps it as it was', same(b.failedProfiles, [103]));
  yes('and says why', b.lookupFailed === true && b.lookupFailedWhy === 'rate limited by Discord');
  yes('d3 was asked once, not again in the same refresh', api.asked.filter((p) => /\/d3$/.test(p)).length === 1);

  // A wait longer than the time left: whoever was not asked yet is not asked,
  // the route answers at once, and they go in failedProfiles too.
  api = discord(function (p) {
    if (/\/d3$/.test(p)) return { ms: 5, status: 429, headers: { 'retry-after': '30' } };
    return { ms: 20, status: 200, body: { user: { id: p } } };
  });
  got = await ask(five(), api);
  b = got ? got.body : {};
  yes('told to wait 30 seconds, the route does not wait: it answers within a second', got && got.ms < 1000);
  yes('the ones already answered are listed', same(sorted(b.profiles), [101, 102, 104]));
  yes('d3 and the not yet asked d5 are both named in failedProfiles', same(sorted(b.failedProfiles), [103, 105]));
  yes('d5 was never asked of Discord', !api.asked.some((p) => /\/d5$/.test(p)));

  // ============================================ a hundred accounts, 100ms each
  const hundred = {};
  for (let i = 1; i <= 100; i++) hundred['h' + i] = { name: 'h' + i, profiles: [1000 + i] };
  api = discord(function (p) { return { ms: 100, status: 200, body: { user: { id: p } } }; });
  got = await ask(hundred, api);
  b = got ? got.body : {};
  const doorAt = game.indexOf('  function refresh(done) {', game.indexOf('  var doorSaid = false;'));
  const doorEnd = doorAt < 0 ? -1 : toClose(game, doorAt);
  const doorTimeout = Number(((doorAt >= 0 ? game.slice(doorAt, doorEnd) : '').match(/req\.setTimeout\((\d+)/) || [])[1] || 0);
  yes('the door gives up after ten seconds (gamemode.js refresh)', doorTimeout === 10000);
  console.log('      100 accounts at 100ms a call: ' + (got ? got.ms : '?') + 'ms (one at a time was about 10000ms)');
  yes('100 accounts at 100ms a call are answered inside the door\'s timeout', got && got.ms < doorTimeout);
  yes('with every one of the hundred on the list', b.profiles && b.profiles.length === 100 && same(b.failedProfiles, []));
  yes('in the same order as linked.json', b.profiles && same(b.profiles, sorted(b.profiles)));
  yes('the budget leaves the answer time to reach the door',
      /const DOOR_BUDGET_MS = (\d+);/.test(forDoorSrc) && Number(RegExp.$1) <= doorTimeout - 2000);

  // ========================================== a lookup that never comes back
  // Discord hangs on d2. The route still answers inside the budget (300ms
  // here) and names d2 as not checked.
  api = discord(function (p) {
    if (/\/d2$/.test(p)) return { ms: 60000, status: 200, body: {} };
    return { ms: 10, status: 200, body: { user: { id: p } } };
  });
  api.standingCached = (function (inner) {
    return function (id) { return id === 'd2' ? new Promise(function () { }) : inner(id); };
  })(api.standingCached);
  got = await ask(five(), api, 300);
  b = got ? got.body : {};
  yes('a lookup that hangs does not hold the answer past the budget', got && got.ms <= 300);
  yes('the others are listed', same(sorted(b.profiles), [101, 103, 104, 105]));
  yes('and the one that hung is in failedProfiles, with why',
      same(b.failedProfiles, [102]) && b.lookupFailedWhy === 'ran out of time asking Discord');

  finished = true;
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  finished = true;
  console.log('FAIL  ' + (e && e.hang ? 'the route ' + e.message : 'the harness threw: ' + (e && e.stack || e)));
  console.log('');
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});
