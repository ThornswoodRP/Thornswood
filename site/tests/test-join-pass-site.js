// test-join-pass-site.js
//
//     node .\site\tests\test-join-pass-site.js
//
// The site issues a join pass only to a linked Discord account that may play,
// for its own character, from a launcher the channel's feed still lets in, and
// refuses everything else with a plain reason (#937). Patrick, 28 Sep: "People
// should not be allowed in at all if they don't join from our launcher."
//
// The route and its helpers are lifted out of site\server.js by text and run
// with stand-ins for Discord, linked.json and the reply, the way
// test-play-join.js runs /api/play/join, because server.js opens a port when it
// is required. The feed is real write-once generations in a temp folder,
// <channel>\version\<8 digits>.json (#2727), found by the real feedFile and
// read by the real feedLaunchers. A Velopack launcher's number is checked by
// the real nativeTag and nativePublished against stand-ins for GitHub's
// Release answer and the channel's newest setup program (#4825).
//
// THE SHARED PASS. One pass is written out below in full. makePass must produce
// exactly it, and tests\test-join-pass-game.js checks the gamemode accepts
// exactly it, so the site and the game server cannot drift apart on the format.
//
// Read only: nothing here touches the real config.json or linked.json.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const siteFiles = require('../../tests/site-files');
const CR = String.fromCharCode(13);
const SRC = path.join(__dirname, '..', '..', 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function braceEnd(at) {
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  return -1;
}
function grab(head) {
  const at = src.indexOf(head);
  if (at < 0) return '';
  const end = braceEnd(at);
  return end > at ? src.slice(at, end) : '';
}

const HELPERS = [
  src.slice(src.indexOf('const PASS_MS'), src.indexOf('\n', src.indexOf('const PASS_MS'))),
  grab('function b64u('), grab('function makePass('), grab('function versionParts('),
  grab('function versionCompare('),
  // The pass's own key, for the login's challenge (#1320).
  grab('function passLoginKey('),
  // The feed's generations, from const feedNewest through feedFile (#2727).
  src.indexOf('const feedNewest = {};') < 0 || src.indexOf('function feedFile(') < 0 ? '' :
    src.slice(src.indexOf('const feedNewest = {};'), braceEnd(src.indexOf('function feedFile('))),
  src.slice(src.indexOf('const feedLaunchersSeen'), src.indexOf('\n', src.indexOf('const feedLaunchersSeen'))),
  grab('function feedLaunchers('),
  // A Velopack launcher's number, against the channel's Releases (#4825).
  src.slice(src.indexOf('const RELEASE_LOOK_MS'), src.indexOf('\n', src.indexOf('const RELEASE_LOOK_MS'))),
  src.slice(src.indexOf('const NATIVE_ASK_MS'), src.indexOf('let nativeAskedAt = 0;') + 'let nativeAskedAt = 0;'.length),
  grab('function nativeTag('), grab('async function nativePublished('),
  grab('async function hasLeft('), grab('async function departed('),
  // What a refusal for want of a role says, alpha or open (#428).
  grab('function notAcceptedYet('),
  // One character banned by itself, or killed for good by staff (#1010).
  grab('function banActive('), grab('function pkActive('), grab('function characterBar('), grab('function banUntilText('),
  grab('function accountBanned('),
  // Play's doors answer inside PLAY_ANSWER_MS (#1094).
  src.slice(src.indexOf('const PLAY_ANSWER_MS'), src.indexOf('\n', src.indexOf('const PLAY_ANSWER_MS'))),
  src.slice(src.indexOf('const PLAY_BODY_MS'), src.indexOf('\n', src.indexOf('const PLAY_BODY_MS'))),
  grab('class BodyFailed'), grab('function passBodyFailure('), grab('function within('), grab('function standingLate('),
  // The one 503 body every launcher door sends when Discord did not answer (#1164).
  grab('function discordUnasked(')
];
yes('the pass helpers are in server.js where this expects them', HELPERS.every(function (h) { return h.length > 10; }));
const ROUTE = grab("  if (p === '/api/play/pass' && req.method === 'POST') {");
yes('the /api/play/pass route is in server.js', ROUTE.length > 100);
yes('the route sits before the signed in gate for /api/', src.indexOf("if (p === '/api/play/pass'") > 0 &&
    src.indexOf("if (p === '/api/play/pass'") < src.indexOf("  if (p.startsWith('/api/')) {"));
yes('config.json is where the key lives, made by the site and never a value in the repo',
    /passKey: ''/.test(src) && /cfg\.passKey = crypto\.randomBytes\(32\)/.test(src));
if (!ROUTE || !HELPERS.every(function (h) { return h.length > 10; })) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ------------------------------------------------------------ the shared pass
const KEY = 'test-join-pass-key-not-a-real-one';
const VECTOR = {
  p: 700, s: 'dev', v: '1.1.102.3', d: '111', i: 1790000000000, x: 1790000600000
};
const VECTOR_PASS = 'jp1.eyJwIjo3MDAsInMiOiJkZXYiLCJ2IjoiMS4xLjEwMi4zIiwiZCI6IjExMSIsImkiOjE3OTAwMDAwMDAwMDAsIngiOjE3OTAwMDA2MDAwMDB9.OfS3TF2v5kDiiBwbLyy-VZHHSTv3YE4Zd0bOnAGove8';

const lib = new Function('crypto', 'fs', 'path', 'ROOT', HELPERS.slice(0, 9).join('\n') +
  '\nreturn { PASS_MS: PASS_MS, makePass: makePass, versionParts: versionParts, versionCompare: versionCompare, feedLaunchers: feedLaunchers, passLoginKey: passLoginKey };');
const FEEDROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-pass-'));
const L = lib(crypto, fs, path, FEEDROOT);

yes('makePass writes the shared pass exactly', L.makePass(KEY, VECTOR) === VECTOR_PASS);
// The shared pass's own key, written out in full. tests\test-join-pass-game.js
// holds the same value, so the site and the game server derive one key from
// one pass (#1320).
const VECTOR_LOGIN_KEY = 'Wh9OwaY7Rg7e4duCPpNl3c_DZb9RfUB0FUT9Pphs9L4';
yes('passLoginKey derives the shared pass\'s own key exactly (#1320)', L.passLoginKey(KEY, VECTOR_PASS) === VECTOR_LOGIN_KEY);
yes('another pass has another key', L.passLoginKey(KEY, VECTOR_PASS.slice(0, -1) + 'A') !== VECTOR_LOGIN_KEY);
yes('a pass lives ten minutes', L.PASS_MS === 600000);
yes('1.1.102 is below 1.1.102.1', L.versionCompare(L.versionParts('1.1.102'), L.versionParts('1.1.102.1')) < 0);
yes('1.1.102.0 is 1.1.102', L.versionCompare(L.versionParts('1.1.102.0'), L.versionParts('1.1.102')) === 0);
yes('"latest" is not a version', L.versionParts('latest') === null);
yes('a part too long for the launcher is not a version', L.versionParts('1.1.9999999999') === null);

// Each write is the next generation, as the store does it (#2727).
function feed(dir, doc) {
  const gens = path.join(FEEDROOT, dir, 'version');
  fs.mkdirSync(gens, { recursive: true });
  const n = fs.readdirSync(gens).filter(function (x) { return /^\d{8}\.json$/.test(x); }).length + 1;
  const f = path.join(gens, String(n).padStart(8, '0') + '.json');
  fs.writeFileSync(f, typeof doc === 'string' ? doc : JSON.stringify(doc));
  // A new mtime and size every write, so the cache in feedLaunchers reads it again.
  const t = new Date(Date.now() + Math.floor(Math.random() * 1e6));
  fs.utimesSync(f, t, t);
}

// ------------------------------------------------------------ the route, run
const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
function clone(o) { return JSON.parse(JSON.stringify(o)); }

async function ask(o) {
  const env = {
    p: '/api/play/pass', req: { method: 'POST' }, res: {},
    body: async function () { return JSON.stringify(o.body); },
    readTicket: function (s) { return s ? { d: String(s), n: 'name-' + s } : null; },
    standingCached: async function (d) {
      return Object.assign({ id: String(d), name: 'n', inGuild: true, banned: false, play: true,
                             dev: false, devBuild: false, admin: false, roles: ['Playtester'] },
                           (o.standing && o.standing[String(d)]) || {});
    },
    discordGet: async function () { return { ok: false, status: 404, body: null, why: 'not found' }; },
    cfg: { passKey: o.key === undefined ? KEY : o.key, access: { dev: ['Owner', 'Dev'], devBuild: ['Owner', 'Dev'] },
           discord: { botToken: 'x', guildId: 'g' } },
    andList: function (a) { return (a || []).join(' and '); },
    jsonFile: function (f, fallback) {
      if (f === 'linked.json') return clone(o.linked || {});
      if (f === 'bans.json') return clone(o.bans || {});
      if (f === 'pk.json') return clone(o.pk || {});
      return fallback;
    },
    LINKED: 'linked.json', BANS: 'bans.json', PK: 'pk.json',
    // standing() reads bans through bansNow() since #2186.
    bansNow: function () { return { table: clone(o.bans || {}), broken: '' }; }, BANS_BROKEN_WHY: '',
    // characterBar reads pk.json and linked.json through heldNow() since #2180.
    heldNow: function (f) {
      return { doc: clone(f === 'pk.json' ? (o.pk || {}) : (f === 'linked.json' ? (o.linked || {}) : {})), broken: '' };
    },
    STATE_BROKEN_WHY: '',
    crypto: crypto, fs: fs, path: path, ROOT: FEEDROOT,
    console: { log: function () { }, error: function () { } },
    releaseGitHub: async function (apiPath) {
      const asked = (o.asked = o.asked || []);
      asked.push(apiPath);
      const tag = decodeURIComponent(String(apiPath).replace(/^\/releases\/tags\//, ''));
      const r = o.releases && o.releases[tag];
      if (r === 'down') return { status: 0, why: 'could not reach GitHub' };
      if (!r) return { status: 404, why: 'GitHub answered 404' };
      return { status: 200, body: r };
    },
    newestSetup: function (ch) { return (o.setups && o.setups[ch]) || null; },
    sendJson: null
  };
  let sent = null;
  env.sendJson = function (r, c, obj) { sent = { code: c, obj: obj }; return sent; };
  const names = Object.keys(env);
  const fn = new AsyncFunction(names.join(','), HELPERS.join('\n') + '\n' + ROUTE + '\nreturn "fell through";');
  const r = await fn.apply(null, names.map(function (n) { return env[n]; }));
  return sent || { code: 0, obj: { fell: r } };
}

function runTag(ch, said) {
  return new Function(grab('function nativeTag(') + '\nreturn nativeTag;')()(ch, said);
}

function readPass(s) {
  const parts = String(s || '').split('.');
  if (parts.length !== 3 || parts[0] !== 'jp1') return null;
  const mac = crypto.createHmac('sha256', KEY).update('jp1.' + parts[1]).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  if (mac !== parts[2]) return null;
  return JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
}

const MINE = { '111': { profiles: [700, 701] }, '222': { profiles: [900] } };

async function main() {
  feed('feed', { launcherVersion: '1.1.102', minLauncher: '1.1.102' });
  feed('feed-dev', { launcherVersion: '1.1.102.3', minLauncher: '1.1.102.3' });

  let r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '1.1.102.3' }, linked: MINE,
                      standing: { '111': { dev: true, devBuild: true } } });
  yes('a current dev launcher, a dev account, its own character: 200 with a pass', r.code === 200 && !!r.obj.pass);
  const got = r.obj && readPass(r.obj.pass);
  yes('the pass is signed with the key and names the profile, the server, the launcher and the account',
      !!got && got.p === 700 && got.s === 'dev' && got.v === '1.1.102.3' && got.d === '111');
  yes('the pass runs out ten minutes after it was issued', !!got && got.x - got.i === 600000 &&
      Math.abs(got.i - Date.now()) < 5000 && r.obj.until === got.x);
  yes('the pass comes with its own key for the login\'s challenge, derived from that pass (#1320)',
      !!r.obj && r.obj.key === L.passLoginKey(KEY, r.obj.pass) && /^[A-Za-z0-9_-]{43}$/.test(r.obj.key));

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE });
  yes('no channel is the main server', r.code === 200 && readPass(r.obj.pass).s === 'main');

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.101' }, linked: MINE });
  yes('a launcher below the feed\'s minimum is refused with why update', r.code === 403 && r.obj.why === 'update' && !r.obj.pass);
  yes('and told which launcher it needs, in a sentence that says to update',
      /1\.1\.101/.test(r.obj.message) && /1\.1\.102 or newer/.test(r.obj.message) && /Update the launcher/.test(r.obj.message));

  r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '1.1.102.2' }, linked: MINE,
                  standing: { '111': { dev: true, devBuild: true } } });
  yes('the dev feed has its own minimum: 1.1.102.2 is refused there', r.code === 403 && r.obj.why === 'update');

  r = await ask({ body: { ticket: '111', profileId: 700 }, linked: MINE });
  yes('a launcher that sends no version is refused', r.code === 403 && r.obj.why === 'update');

  r = await ask({ body: { ticket: '111', profileId: 700, version: 'latest' }, linked: MINE });
  yes('a version that is not a version is refused', r.code === 403 && r.obj.why === 'update');

  r = await ask({ body: { ticket: '111', profileId: 700, version: '9.9.9' }, linked: MINE });
  yes('a launcher newer than anything published is refused as one Thornswood never published',
      r.code === 403 && r.obj.why === 'unknown launcher' && /never published/.test(r.obj.message));

  feed('feed', { launcherVersion: '1.1.103' });
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE });
  yes('with no minLauncher the floor is the current launcher', r.code === 403 && r.obj.why === 'update' && r.obj.need === '1.1.103');
  feed('feed', { launcherVersion: '1.1.103', minLauncher: '1.1.102' });
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE });
  yes('a minLauncher below the current launcher lets that launcher in', r.code === 200);
  feed('feed', { launcherVersion: '1.1.103', minLauncher: 'soon' });
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE });
  yes('a minLauncher that is not a version is read as the current launcher', r.code === 403 && r.obj.need === '1.1.103');

  feed('feed', '{ not json');
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.103' }, linked: MINE });
  yes('a feed the site cannot read refuses the pass (503), never issues one', r.code === 503 && r.obj.why === 'feed' && !r.obj.pass);
  fs.rmSync(path.join(FEEDROOT, 'feed', 'version'), { recursive: true, force: true });
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.103' }, linked: MINE });
  yes('no feed at all refuses too', r.code === 503 && r.obj.why === 'feed');
  feed('feed', { launcherVersion: '1.1.102', minLauncher: '1.1.102' });

  r = await ask({ body: { profileId: 700, version: '1.1.102' }, linked: MINE });
  yes('no Discord ticket: 401 why link', r.code === 401 && r.obj.why === 'link');

  r = await ask({ body: { ticket: '111', version: '1.1.102' }, linked: MINE });
  yes('no character: 400', r.code === 400 && r.obj.why === 'profile');

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE, key: '' });
  yes('no key on the site: 503, never an unsigned pass', r.code === 503 && r.obj.why === 'no key' && !r.obj.pass);

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE,
                  standing: { '111': { lookupFailed: 'rate limited', inGuild: false, play: false } } });
  yes('Discord not answering refuses the pass (503)', r.code === 503 && r.obj.why === 'could not ask Discord');

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE,
                  standing: { '111': { lookupFailed: 'rate limited', admin: true } } });
  yes('except for the hand written admin list, as at /api/play/join', r.code === 200);

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE,
                  standing: { '111': { banned: true } } });
  yes('a banned account is refused', r.code === 403 && r.obj.why === 'banned');

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE,
                  standing: { '111': { inGuild: false, play: false } } });
  yes('an account not in the Discord is refused', r.code === 403 && r.obj.why === 'guild');

  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE,
                  standing: { '111': { play: false } } });
  yes('an account without the play role is refused', r.code === 403 && r.obj.why === 'role');

  r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '1.1.102.3' }, linked: MINE });
  yes('a dev pass for an account without the dev roles is refused', r.code === 403 && r.obj.why === 'dev');
  // #3317: staff in the game (access.dev, a Gamemaster say) is not the dev
  // build (access.devBuild: Owner, Co-Owner, Dev and the leads).
  r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '1.1.102.3' }, linked: MINE,
                  standing: { '111': { dev: true, devBuild: false } } });
  yes('a dev pass for staff in the game who are not on the dev build list is refused',
      r.code === 403 && r.obj.why === 'dev');

  r = await ask({ body: { ticket: '111', profileId: 900, version: '1.1.102' }, linked: MINE });
  yes('somebody else\'s character is refused', r.code === 403 && r.obj.why === 'somebody else' && !r.obj.pass);

  r = await ask({ body: { ticket: '111', profileId: 555, version: '1.1.102' }, linked: MINE });
  yes('a character nobody holds yet is the caller\'s, as /api/play/owns has it', r.code === 200 && readPass(r.obj.pass).p === 555);

  r = await ask({ body: { ticket: '333', profileId: 900, version: '1.1.102' }, linked: MINE,
                  standing: { '222': { inGuild: false, play: false } } });
  yes('a character held only by an account that has left the Discord is the caller\'s', r.code === 200);

  // One character, not the account (#1010).
  const P = { body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE };
  r = await ask(Object.assign({}, P, { pk: { 700: { at: 1, by: 'Aela', why: 'died in the siege' } } }));
  yes('a character staff killed for good is refused with why pk, and no pass', r.code === 403 && r.obj.why === 'pk' && !r.obj.pass);
  yes('and told it cannot be played again and to pick or make another, without staff\'s reason',
      /died for good and cannot be played again/.test(r.obj.message) && /make a new one/.test(r.obj.message) &&
      r.obj.message.indexOf('siege') < 0);
  r = await ask(Object.assign({}, P, { body: { ticket: '111', profileId: 701, version: '1.1.102' },
                                       pk: { 700: { at: 1 } } }));
  yes('the same account\'s other character still gets a pass', r.code === 200 && readPass(r.obj.pass).p === 701);
  r = await ask(Object.assign({}, P, { body: { ticket: '111', profileId: 556, version: '1.1.102' },
                                       pk: { 700: { at: 1 } } }));
  yes('and so does a new character on that account', r.code === 200 && readPass(r.obj.pass).p === 556);
  r = await ask(Object.assign({}, P, { bans: { 'p:700': { until: Date.now() + 3600000, why: 'griefing' } } }));
  yes('a character banned by itself is refused with why banned character, until and why',
      r.code === 403 && r.obj.why === 'banned character' && !r.obj.pass &&
      /banned that character until .* UTC: griefing/.test(r.obj.message));
  r = await ask(Object.assign({}, P, { body: { ticket: '111', profileId: 701, version: '1.1.102' },
                                       bans: { 'p:700': { until: 0, why: 'x' } } }));
  yes('a character ban leaves the account\'s other characters alone', r.code === 200);
  r = await ask(Object.assign({}, P, { bans: { 'p:700': { until: Date.now() - 1000, why: 'over' } } }));
  yes('a character ban that has run out lets it back at once', r.code === 200);
  r = await ask(Object.assign({}, P, { bans: { 'p:700': { until: 0, why: 'for good' } } }));
  yes('a character ban for good holds', r.code === 403 && /for good/.test(r.obj.message));

  // ---- Velopack launchers (#4825) ----
  const DEVREL = { tag_name: 'build-20261102.3', draft: false, assets: [{ name: 'releases.dev.json', state: 'uploaded' }] };
  const MAINREL = { tag_name: 'main-build-20261102.3', draft: false, assets: [{ name: 'releases.main.json', state: 'uploaded' }] };
  const SETUP = { dev: { name: 'Thornswood-Dev-Setup.exe' }, main: { name: 'Thornswood-Setup.exe' } };
  const DEVSTAND = { '111': { dev: true, devBuild: true } };
  let q = { body: { ticket: '111', profileId: 700, channel: 'dev', version: '2026.1102.3' }, linked: MINE, standing: DEVSTAND,
            releases: { 'build-20261102.3': DEVREL }, setups: SETUP };
  r = await ask(q);
  yes('a Velopack launcher whose build Release is out with releases.dev.json gets a dev pass', r.code === 200 && readPass(r.obj.pass).v === '2026.1102.3');
  yes('  asked of GitHub by its own tag, build-20261102.3', q.asked && q.asked.length === 1 && q.asked[0] === '/releases/tags/build-20261102.3');
  q = { body: { ticket: '111', profileId: 700, version: '2026.1102.3' }, linked: MINE, releases: { 'main-build-20261102.3': MAINREL }, setups: SETUP };
  r = await ask(q);
  yes('main reads the same number from main-build-20261102.3, with releases.main.json', r.code === 200 && q.asked[0] === '/releases/tags/main-build-20261102.3');
  r = await ask({ body: { ticket: '111', profileId: 700, version: '2026.1102.3' }, linked: MINE,
                  releases: { 'main-build-20261102.3': { tag_name: 'main-build-20261102.3', draft: false, assets: [{ name: 'releases.dev.json', state: 'uploaded' }] } }, setups: SETUP });
  yes('a Release without the channel\'s own Velopack feed does not let that channel\'s launcher in', r.code === 403 && r.obj.why === 'unknown launcher' && !r.obj.pass);
  r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '2026.1102.4' }, linked: MINE, standing: DEVSTAND,
                  releases: { 'build-20261102.3': DEVREL }, setups: SETUP });
  yes('a Velopack number with no Release is one Thornswood never published', r.code === 403 && r.obj.why === 'unknown launcher' && /never published/.test(r.obj.message));
  r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '2026.1102.3' }, linked: MINE, standing: DEVSTAND,
                  releases: { 'build-20261102.3': Object.assign({}, DEVREL, { draft: true }) }, setups: SETUP });
  yes('  and neither is one on a draft', r.code === 403 && r.obj.why === 'unknown launcher');
  r = await ask({ body: { ticket: '111', profileId: 700, channel: 'dev', version: '2026.1102.3' }, linked: MINE, standing: DEVSTAND,
                  releases: { 'build-20261102.3': 'down' }, setups: SETUP });
  yes('GitHub not answering refuses the pass with a 503, never issues one', r.code === 503 && r.obj.why === 'releases' && !r.obj.pass);
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE, setups: SETUP });
  yes('once a channel has a Velopack setup program, a launcher from before it is told to install the new one', r.code === 403 &&
      r.obj.why === 'update' && /thornswood\.net\/downloads/.test(r.obj.message) && !r.obj.pass);
  r = await ask({ body: { ticket: '111', profileId: 700, version: '1.1.102' }, linked: MINE, setups: { dev: SETUP.dev } });
  yes('  while a channel with none still lets the feed\'s old launcher in', r.code === 200);
  yes('nativeTag reads only a real day: month 13 and day 0 are not Velopack numbers',
      runTag('dev', '2026.1302.1') === '' && runTag('dev', '2026.1100.1') === '' && runTag('dev', '1.1.102') === '' &&
      runTag('dev', '2026.102.7') === 'build-20260102.7' && runTag('main', '2026.1231.12') === 'main-build-20261231.12');

  try { fs.rmSync(FEEDROOT, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch(function (e) { console.log('FAIL  threw: ' + (e && e.stack ? e.stack : e)); process.exit(1); });
