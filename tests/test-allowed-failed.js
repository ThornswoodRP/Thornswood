/*
  test-allowed-failed.js

      node .\tests\test-allowed-failed.js

  From the To Do List: "one rate-limited lookup throws the whole list away".

  /api/allowed on the site asks Discord about every linked account. When any
  one of those lookups failed, the whole answer was marked failed, and the
  game server's door kept its old list for EVERYBODY: a ban, a new tester or
  a removed role all waited on the one person Discord would not answer for.

  The site now names the profiles it could not check (failedProfiles), and
  the door keeps just those as they were and takes everybody else's fresh
  answer. A failed lookup can neither let somebody in nor turn somebody away.

  Two halves, and this drives both of the real ones: the route is lifted out
  of site\server.js and run against pretend Discord answers, and what it
  sends is handed to the door's refresh(), lifted out of gamemode.js and run
  against a pretend site and a pretend disk. Nothing leaves this machine.

  The two deploy on different paths and can be live at different times, so
  both mixed pairs are checked: an old door reading the new site still sees
  lookupFailed and keeps the whole list, and a new door reading an old site
  (no failedProfiles) keeps the whole list the way it always did.

  Read only.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');
const CR = String.fromCharCode(13);

const SITE = process.env.SITE || path.join(REPO_DIR, 'site', 'server.js');
const GAME = process.env.GAMEMODE || path.join(REPO_DIR, 'game', 'gamemode.js');
const site = siteFiles.source(SITE).split(CR).join('');
const game = fs.readFileSync(GAME, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sorted = (a) => (Array.isArray(a) ? a.slice().sort((x, y) => x - y) : a);

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

// ---- the site's route ------------------------------------------------------
const routeAt = site.indexOf("if ((route === '/api/allowed' || devDoor) && req.method === 'GET') {");
const routeEnd = routeAt < 0 ? -1 : toClose(site, routeAt);
const route = (routeAt >= 0 && routeEnd > routeAt) ? site.slice(routeAt, routeEnd) : '';
yes('the /api/allowed route is in server.js', route.indexOf('return sendJson(res, 200, out);') >= 0);

/*
  The real route over a pretend linked.json and pretend standings. standings
  maps a Discord id to what standingCached would return, or to an Error for
  one that throws. Resolves to the JSON the route would send.
*/
// Since issue #415 the route asks standingsForDoor for everybody at once
// (four at a time, inside the door's time); lifted out of server.js the same
// way and run over the same pretend standingCached. A server.js from before
// that (SITE=...) has no such function and its route never names it.
const forDoorAt = site.indexOf('const DOOR_BUDGET_MS');
const forDoorFn = forDoorAt < 0 ? -1 : site.indexOf('async function standingsForDoor(', forDoorAt);
const forDoorEnd = forDoorFn < 0 ? -1 : toClose(site, forDoorFn);
const forDoor = (forDoorFn >= 0 && forDoorEnd > forDoorFn) ? site.slice(forDoorAt, forDoorEnd) : '';

async function ask(linked, standings, devDoor) {
  let sent = null;
  const standingCached = async function (id) {
    const s = standings[id];
    if (s instanceof Error) throw s;
    return s;
  };
  const standingsForDoor = forDoor
    ? new Function('standingCached', 'discordQuietMs', forDoor + '\nreturn standingsForDoor;')(
        standingCached, function () { return 0; })
    : undefined;
  // The key comes in the X-Thornswood-Key header since entry 248, the way the
  // door sends it. keyInAddress is the route's note of doors that still put
  // it in the address; test-site-auth.js checks that side.
  const run = new Function(
    'route', 'devDoor', 'req', 'res', 'cfg', 'url', 'sameSecret', 'sendJson',
    'jsonFile', 'LINKED', 'standingCached', 'keyInAddress', 'standingsForDoor', 'activeBans', 'pkProfiles',
    'officesForDoor',
    'return (async function () {\n' + route + '\n})();');
  await run(
    devDoor ? '/dev/api/allowed' : '/api/allowed', !!devDoor,
    { method: 'GET', headers: { 'x-thornswood-key': 'k' } }, {}, { botKey: 'k' },
    { searchParams: { get: function () { return 'k'; } } },
    function (a, b) { return a === b; },
    function (res, code, body) { sent = { code: code, body: JSON.parse(JSON.stringify(body)) }; },
    function () { return linked; }, 'linked.json',
    // No staff bans here (#412); test-staff-bans.js runs them.
    standingCached, new Set(), standingsForDoor, function () { return []; },
    // Nobody killed for good here (#1010); test-bans-pk.js runs that.
    function () { return []; },
    // No hold offices here (#2551); test-2551-hold-offices.js runs them.
    async function () { return []; });
  return sent;
}

// ---- the door's refresh ----------------------------------------------------
const doorAt = game.indexOf('  var doorSaid = false;');
const refreshAt = doorAt < 0 ? -1 : game.indexOf('  function refresh(done) {', doorAt);
const refreshEnd = refreshAt < 0 ? -1 : toClose(game, refreshAt);
const door = (doorAt >= 0 && refreshEnd > refreshAt) ? game.slice(doorAt, refreshEnd) : '';
yes('the door refresh is in gamemode.js',
    door.indexOf("'/api/allowed'") >= 0 && door.indexOf("'X-Thornswood-Key'") >= 0);

const PRIV = 'private';
const FILE = path.join(PRIV, 'allowed.json');

/*
  The real refresh() against a pretend site that answers `answer` and a
  pretend disk holding `before` as allowed.json (undefined for no file).
  Returns what is on the disk afterwards (null when nothing is) and every
  line the door said.
*/
function refreshWith(before, answer, status) {
  const disk = {};
  disk[path.join(PRIV, 'door.json')] = JSON.stringify({ site: 'https://site.invalid', key: 'k' });
  if (before !== undefined) disk[FILE] = JSON.stringify(before);
  const said = [];
  const fakeFs = {
    readFileSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(disk, p)) throw new Error('ENOENT ' + p);
      return disk[p];
    },
    writeFileSync: function (p, s) { disk[p] = String(s); }
  };
  const fakeHttps = {
    // (url, options, callback), since the key rides in the options' headers.
    get: function (url, opts, cb) {
      if (typeof opts === 'function') cb = opts;
      const on = {};
      cb({ statusCode: status || 200, on: function (ev, fn) { on[ev] = fn; } });
      on.data(JSON.stringify(answer));
      on.end();
      return { setTimeout: function () { }, on: function () { }, destroy: function () { } };
    }
  };
  const run = new Function(
    'fs', 'path', 'privDir', 'FILE', 'note', 'require', 'console', 'mp',
    'var readAt = 0, listAt = 0;\n' + door + '\nrefresh();');
  run(fakeFs, path, PRIV, FILE,
      function (line) { said.push(line); },
      function (m) { return m === 'https' ? fakeHttps : require(m); },
      { log: function (line) { said.push(line); } },
      // The engine's whole-file write (#2740), onto the fake disk.
      { writeFileWhole: function (p, s) { fakeFs.writeFileSync(p, s); } });
  const now = Object.prototype.hasOwnProperty.call(disk, FILE) ? disk[FILE] : null;
  const changed = now !== null && now !== (before === undefined ? null : JSON.stringify(before));
  return { file: changed ? JSON.parse(now) : null, said: said };
}

// ---- the people -------------------------------------------------------------
// Five linked accounts, the shape the entry's done-when asks for: one in five
// rate limited. d3 holds two characters.
const linked = {
  d1: { name: 'one', profiles: [101] },
  d2: { name: 'two', profiles: [102] },
  d3: { name: 'three', profiles: [103, 113] },
  d4: { name: 'four', profiles: [104] },
  d5: { name: 'five', profiles: [105] },
  d6: { name: 'no characters yet', profiles: [] }
};
const ok = (name, extra) => Object.assign({ play: true, banned: false, dev: false, admin: false, name: name }, extra || {});
const RATE = 'rate limited by Discord';

(async () => {
  // ================================================================ the site
  const allGood = await ask(linked, {
    d1: ok('one', { dev: true, admin: true }), d2: ok('two'), d3: ok('three', { dev: true }),
    d4: ok('four'), d5: ok('five')
  });
  yes('nothing failing: the route answers 200', allGood && allGood.code === 200);
  const g = allGood ? allGood.body : {};
  yes('nothing failing: every profile is on the list', same(sorted(g.profiles), [101, 102, 103, 104, 105, 113]));
  yes('nothing failing: lookupFailed is false and lookupFailedWhy empty, as before',
      g.lookupFailed === false && g.lookupFailedWhy === '');
  yes('nothing failing: failedProfiles is there and empty', same(g.failedProfiles, []));

  const oneOfFive = await ask(linked, {
    d1: ok('one', { dev: true, admin: true }), d2: ok('two'), d3: { lookupFailed: RATE },
    d4: ok('four'), d5: ok('five')
  });
  const f = oneOfFive ? oneOfFive.body : {};
  yes('one rate limited in five: the four good ones are still listed', same(sorted(f.profiles), [101, 102, 104, 105]));
  yes('and lookupFailed is still exactly true, which is all an older door reads', f.lookupFailed === true);
  yes('and lookupFailedWhy still carries the reason', f.lookupFailedWhy === RATE);
  yes('and failedProfiles names both of the failed account\'s characters', same(sorted(f.failedProfiles), [103, 113]));
  yes('and the failed account is not in people', (f.people || []).every((p) => p.id !== 'd3'));
  yes('every field the old answer had is still in the new one',
      ['profiles', 'devProfiles', 'adminProfiles', 'people', 'lookupFailed', 'lookupFailedWhy', 'at']
        .every((k) => Object.prototype.hasOwnProperty.call(f, k)));

  const threw = await ask(linked, {
    d1: ok('one'), d2: new Error('socket hang up'), d3: ok('three'), d4: ok('four'), d5: ok('five')
  });
  const t = threw ? threw.body : {};
  yes('a lookup that throws is named in failedProfiles too', same(t.failedProfiles, [102]));
  yes('and says why', t.lookupFailed === true && /socket hang up/.test(t.lookupFailedWhy));

  const devSide = await ask(linked, {
    d1: ok('one', { dev: true, devBuild: true }), d2: ok('two'), d3: { lookupFailed: RATE }, d4: ok('four'), d5: ok('five')
  }, true);
  const dv = devSide ? devSide.body : {};
  yes('the dev door lists only dev people', same(dv.profiles, [101]));
  yes('and names the failed account there as well, since nobody knows if they are dev', same(sorted(dv.failedProfiles), [103, 113]));

  // ================================================================ the door
  // What the door wrote five minutes ago: d1 to d4 were all allowed, d3 was a
  // dev, d5 had not joined yet. The door is enforcing.
  const before = {
    enforce: true,
    profiles: [101, 102, 103, 113, 104],
    devProfiles: [101, 103, 113],
    adminProfiles: [101],
    people: [
      { id: 'd1', name: 'one', profiles: [101] },
      { id: 'd2', name: 'two', profiles: [102] },
      { id: 'd3', name: 'three', profiles: [103, 113] },
      { id: 'd4', name: 'four', profiles: [104] }
    ],
    at: '2026-09-24T00:00:00.000Z',
    note: 'x'
  };

  // Now: d2 picked up the Banned role, d5 joined, and d3 could not be checked.
  const now = await ask(linked, {
    d1: ok('one', { dev: true, admin: true }), d2: ok('two', { banned: true }), d3: { lookupFailed: RATE },
    d4: ok('four'), d5: ok('five')
  });
  const w = refreshWith(before, now.body);
  yes('one failed lookup no longer throws the whole list away: the door writes', w.file !== null);
  const wp = w.file ? w.file.profiles : [];
  yes('the ban lands on the same refresh', w.file !== null && wp.indexOf(102) < 0);
  yes('the new tester is let in on the same refresh', wp.indexOf(105) >= 0);
  yes('the four good answers are what was written for them', [101, 104, 105].every((n) => wp.indexOf(n) >= 0));
  yes('the account that could not be checked keeps both its characters on the list',
      wp.indexOf(103) >= 0 && wp.indexOf(113) >= 0);
  yes('and keeps its dev standing', w.file && [103, 113].every((n) => w.file.devProfiles.indexOf(n) >= 0));
  yes('and keeps its row in people', w.file && w.file.people.some((p) => p.id === 'd3'));
  yes('nobody is listed twice', w.file && wp.length === new Set(wp).size);
  yes('enforce is left exactly as it was', w.file && w.file.enforce === true);
  yes('the door says how many it could not check, and why',
      w.said.some((l) => /^2 profiles could not be checked/.test(l) && l.indexOf(RATE) >= 0));

  // A failed lookup must not let anybody in either.
  const neverIn = Object.assign({}, before, { profiles: [101, 102, 104], devProfiles: [101], people: before.people.filter((p) => p.id !== 'd3') });
  const w2 = refreshWith(neverIn, now.body);
  yes('somebody who was NOT on the list and could not be checked stays off it',
      w2.file && w2.file.profiles.indexOf(103) < 0 && w2.file.profiles.indexOf(113) < 0);
  yes('and is not made a dev by it', w2.file && w2.file.devProfiles.indexOf(103) < 0);
  yes('and gets no people row', w2.file && !w2.file.people.some((p) => p.id === 'd3'));

  // With no file at all there is no earlier standing to keep, so the failed
  // account is simply absent, and enforce starts false as it always has.
  const w3 = refreshWith(undefined, now.body);
  yes('with no earlier file the good ones are written and enforce is false',
      w3.file && w3.file.enforce === false && same(sorted(w3.file.profiles), [101, 104, 105]));

  // ---- when the whole list must still be kept -----------------------------
  const nobody = await ask(linked, {
    d1: { lookupFailed: RATE }, d2: { lookupFailed: RATE }, d3: { lookupFailed: RATE },
    d4: { lookupFailed: RATE }, d5: { lookupFailed: RATE }
  });
  const w4 = refreshWith(before, nobody.body);
  yes('when the site reached Discord for nobody the door keeps the whole list', w4.file === null);
  yes('and says so with the reason', w4.said.some((l) => l.indexOf('keeping the list as it was: ' + RATE) >= 0));

  // A new door against a site older than this: lookupFailed with no
  // failedProfiles. It cannot know who failed, so the whole list is kept.
  const oldSite = JSON.parse(JSON.stringify(now.body));
  delete oldSite.failedProfiles;
  const w5 = refreshWith(before, oldSite);
  yes('a new door reading an old site keeps the whole list, as it always did', w5.file === null);
  yes('and says why', w5.said.some((l) => l.indexOf('keeping the list as it was') >= 0));

  const oldSiteGood = JSON.parse(JSON.stringify(allGood.body));
  delete oldSiteGood.failedProfiles;
  const w6 = refreshWith(before, oldSiteGood);
  yes('a new door reading an old site with nothing failing writes the fresh list',
      w6.file && same(sorted(w6.file.profiles), [101, 102, 103, 104, 105, 113]));

  // An old door reading the new site: all it ever looked at was lookupFailed,
  // and returned early on it. That field is still exactly true on any failure
  // (checked above), so an old door still keeps its whole list, which is what
  // it did before; and it is still false when nothing failed.
  yes('an old door reading the new site still sees lookupFailed true on a failure',
      now.body.lookupFailed === true);
  yes('and false when nothing failed', allGood.body.lookupFailed === false);

  // Nothing failing on the new pair is the ordinary write, unchanged.
  const w7 = refreshWith(before, allGood.body);
  yes('nothing failing: the door writes the fresh list',
      w7.file && same(sorted(w7.file.profiles), [101, 102, 103, 104, 105, 113]));
  yes('and says nothing about failed lookups', !w7.said.some((l) => /could not be checked/.test(l)));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  the harness threw: ' + (e && e.stack || e));
  console.log('');
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  process.exit(1);
});
