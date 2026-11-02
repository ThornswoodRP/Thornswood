/*
  test-join-outage.js

      node .\tests\test-join-outage.js

  The launcher's door, /api/play/join, when Discord does not answer the site.

  standing() leaves inGuild false on every failed lookup and sets lookupFailed
  to say why, because a 404 is the only failure that means "not in the
  server". /api/play/join tested inGuild and nothing else, so a rate limit
  came back as 403 why 'guild': "That Discord account is not in the
  Thornswood Discord", with an invite. The launcher writes a 'guild' down as a
  remembered no, so the same answer also erased the 72 hour grace Door.cs
  keeps for the day the site cannot vouch for anybody. The restart wave after
  a release is when Discord rate limits the site, so that is exactly when it
  fired, and a stranger told they are not in a Discord they joined ten
  minutes ago assumes the thing is broken and leaves.

  This runs the real standing(), memberOf(), guildMembers(), roleNames() and
  the real /api/play/join block out of site\server.js, with only
  discordGet, the ticket, the files and the reply stubbed, so it cannot pass
  against a copy that is no longer what ships. The launcher half is
  test-door-outage.ps1, which compiles the real Door.cs.

  Read only. Nothing touches the disk or the network. Two optional arguments
  name a different server.js and Door.cs, so it can be pointed at the
  versions from before the fix to watch it fail.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');

const SRC = process.argv[2] || path.join(REPO_DIR, 'site', 'server.js');
const src = siteFiles.source(SRC);
const DOOR = fs.readFileSync(process.argv[3] || path.join(REPO_DIR, 'launcher', 'app', 'Door.cs'), 'utf8');

function braced(at, what) {
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + what);
}
function grab(name) {
  const at = src.indexOf('async function ' + name + '(');
  if (at < 0) throw new Error('site/server.js has no async function ' + name);
  return braced(at, name);
}
function route(head) {
  const at = src.indexOf(head);
  if (at < 0) throw new Error('site/server.js has no ' + head);
  return braced(at, head);
}

const JOIN = route("if (p === '/api/play/join' && req.method === 'POST') {");
const OWNS = route("if (p === '/api/play/owns' && req.method === 'POST') {");

// ---- what the real code closes over -----------------------------------------
const LINKED = 'linked.json';
const BANS = 'bans.json';
let cfg, files, membersCache, roleCache, standCache;
let answer = null;        // what every call to Discord gets back, or null for the guild below
let guild = [];           // the members Discord knows about when it does answer
let asked = [];

async function discordGet(p) {
  asked.push(p);
  if (answer) return answer;
  if (p.endsWith('/roles')) {
    return { ok: true, status: 200, body: [
      { id: 'r1', name: 'Tester' }, { id: 'r2', name: 'Banned' }, { id: 'r3', name: 'Owner' }] };
  }
  if (p.indexOf('/members?limit=') >= 0) return { ok: true, status: 200, body: guild };
  const id = p.slice(p.lastIndexOf('/') + 1);
  const hit = guild.filter((m) => m.user.id === id)[0];
  return hit ? { ok: true, status: 200, body: hit } : { ok: false, status: 404, body: null, why: 'not found' };
}
const jsonFile = (f, def) => (f in files ? JSON.parse(JSON.stringify(files[f])) : def);
// The real putJson answers whether the write landed; the check in refuses one that did not (#2180).
const putJson = (f, v) => { files[f] = v; return true; };
// standing() reads bans through bansNow() since #2186; this stand-in never
// reports a broken file (site/tests/test-bans-broken.js runs that on the real site).
const bansNow = () => ({ table: jsonFile(BANS, {}) || {}, broken: '' });
const BANS_BROKEN_WHY = '';
const readTicket = (t) => (String(t || '').startsWith('tk:') ? { d: String(t).slice(3), n: 'From the ticket' } : null);
const body = async (req) => req.body;
const sendJson = (res, code, obj) => { res.code = code; res.obj = obj; return res; };
const slotsFor = () => 2;
// The world is never full here (#481); test-seats.js runs that refusal.
const gameStatus = { up: false, online: 0, max: 0 };
const seatsFull = () => false;
const worldFull = () => '';
const mostOnlineFallback = () => 0;
// No crash snapshots asked about here (#2319); test-2319-crash-looked-at.js runs that answer.
const sessionRows = () => [];
const lookedAtFor = () => [];

// standingCached, hasLeft and departed because the join route asks whether an
// account holding the id has left the Discord before it reads the file it
// writes back (entry 142).
eval(grab('guildMembers') + '\n' + grab('memberOf') + '\n' + grab('roleNames') + '\n' + grab('standing') +
     '\n' + route('function holdsStaffRole(') +
     // The Business Owner and Dev roles standing reads by name (#1417, #1420),
     // and the faction Leader roles by their shape (#3317).
     '\n' + route('function holdsNamedRole(') + '\n' + route('function leaderRoles(') +
     '\n' + grab('standingCached') + '\n' + grab('hasLeft') + '\n' + grab('departed') +
     '\n' + route('function notAcceptedYet(') +
     // What a banned account is told at Play (#1010).
     '\n' + route('function banUntilText(') + '\n' + route('function accountBanned(') +
     // Play's doors answer inside PLAY_ANSWER_MS (#1094).
     '\n' + src.slice(src.indexOf('const PLAY_ANSWER_MS'), src.indexOf('\n', src.indexOf('const PLAY_ANSWER_MS'))) +
     '\n' + src.slice(src.indexOf('const PLAY_BODY_MS'), src.indexOf('\n', src.indexOf('const PLAY_BODY_MS'))) +
     '\n' + route('class BodyFailed') + '\n' + route('function passBodyFailure(') +
     '\n' + route('function within(') + '\n' + route('function standingLate(') +
     // The one 503 body every launcher door sends when Discord did not answer (#1164).
     '\n' + route('function discordUnasked(') +
     '\nasync function join(p, req, res) {\n' + JOIN + '\n}');

function reset() {
  cfg = { admins: ['900'],
          discord: { botToken: 'x', guildId: 'g', invite: 'https://discord.gg/thornswood' },
          access: { banned: ['Banned'], admin: ['Owner'], play: ['Tester'], dev: ['Owner'], slots3: [] } };
  files = {};
  membersCache = { at: 0, byId: null };
  roleCache = { at: 0, byId: {} };
  standCache = new Map();
  answer = null;
  guild = [];
  asked = [];
}
const member = (id, roles) => ({ user: { id: String(id), username: 'p' + id }, roles: roles || [], nick: null });
async function ask(id, extra) {
  const res = {};
  await join('/api/play/join', { method: 'POST', body: JSON.stringify(Object.assign({ ticket: 'tk:' + id }, extra || {})) }, res);
  return res;
}

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

(async () => {
  // ---- the fault this exists for ---------------------------------------------
  reset();
  answer = { ok: false, status: 429, body: null, why: 'rate limited by Discord' };
  let r = await ask('111', { profileId: 42 });
  yes('a rate limit from Discord answers 503, not 403', r.code === 503);
  yes('and its why is not guild', r.obj && r.obj.why !== 'guild');
  yes('its why is "could not ask Discord"', r.obj && r.obj.why === 'could not ask Discord');
  yes('its message does not say they are not in the Discord',
      r.obj && typeof r.obj.message === 'string' && r.obj.message.length > 0 &&
      r.obj.message.indexOf('not in the Thornswood Discord') < 0);
  yes('it carries no invite, because they may well be in already', r.obj && !r.obj.invite);
  yes('it is not ok', r.obj && r.obj.ok === false);
  yes('Discord was really asked, so the rate limit came through the real lookup', asked.length > 0);
  yes('nothing is written against the account on an answer nobody got',
      !(LINKED in files));

  reset();
  answer = { ok: false, status: 0, body: null, why: 'could not reach Discord: ETIMEDOUT' };
  r = await ask('111');
  yes('Discord not reachable at all is the same 503', r.code === 503 && r.obj.why === 'could not ask Discord');

  reset();
  answer = { ok: false, status: 401, body: null, why: 'the bot token is wrong or has been reset' };
  r = await ask('111');
  yes('a bot token that stopped working is the site failing to ask, not a no', r.code === 503);

  reset();
  answer = { ok: false, status: 500, body: null, why: 'Discord answered 500' };
  r = await ask('111');
  yes('Discord falling over is a 503 too', r.code === 503);

  // ---- the answers that ARE a no stay a no -------------------------------------
  reset();
  guild = [member(222, ['r1'])];
  r = await ask('111');
  yes('somebody really not in the server still gets 403 guild', r.code === 403 && r.obj.why === 'guild');
  yes('with the invite, so they can join', r.obj.invite === 'https://discord.gg/thornswood');

  reset();
  answer = { ok: false, status: 404, body: null, why: 'not found' };
  r = await ask('111');
  yes('a 404 from the single lookup is still guild', r.code === 403 && r.obj.why === 'guild');

  reset();
  guild = [member(111, [])];
  r = await ask('111');
  yes('in the server with no role is still 403 role', r.code === 403 && r.obj.why === 'role');

  reset();
  guild = [member(111, ['r1', 'r2'])];
  r = await ask('111');
  yes('the Banned role is still 403 banned', r.code === 403 && r.obj.why === 'banned');

  // The outage answer is one the launcher lets a recent yes through on, so a
  // ban must never come out as one. bans.json is read before Discord is asked
  // and standing() returns before any lookup can fail. What it does come out
  // as is 403 'guild', because the door tests inGuild before banned and a
  // file ban leaves inGuild false. That is a wrong message but still a no,
  // and it is a separate fix from this one, so it is not asserted either way.
  reset();
  files[BANS] = { '111': { at: 1, by: 'test', why: 'test' } };
  answer = { ok: false, status: 429, body: null, why: 'rate limited by Discord' };
  r = await ask('111');
  yes('somebody in bans.json is still refused while Discord is rate limiting, never sent the outage answer',
      r.code === 403 && r.obj.ok === false && r.obj.why !== 'could not ask Discord');

  // ---- the answers that are a yes stay a yes -----------------------------------
  reset();
  guild = [member(111, ['r1'])];
  r = await ask('111', { profileId: 42 });
  yes('a member with the role is let in', r.code === 200 && r.obj.ok === true);
  yes('and their profile id is written against them',
      files[LINKED] && files[LINKED]['111'] && files[LINKED]['111'].profiles.indexOf(42) >= 0);

  // The trap the entry did not name: the hand written admin list is the way
  // back in on a bad Discord morning, and standing() sets lookupFailed for
  // them too.
  reset();
  answer = { ok: false, status: 429, body: null, why: 'rate limited by Discord' };
  r = await ask('900');
  yes('somebody on the admin list is still let in while Discord is rate limiting',
      r.code === 200 && r.obj.ok === true && r.obj.admin === true);

  // ---- one spelling, on both sides ---------------------------------------------
  const owns = /why:\s*'([^']+)'\s*\}\);\s*\}\s*if \(!st\.play/.exec(OWNS);
  yes('/api/play/owns still answers its outage with a why', !!owns);
  yes('and /api/play/join uses the same why, so the launcher learns one spelling',
      !!owns && owns[1] === 'could not ask Discord');
  yes('Door.cs knows that why by the same spelling', DOOR.indexOf('"could not ask Discord"') >= 0);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness threw: ' + (e && e.stack || e)); process.exit(1); });
