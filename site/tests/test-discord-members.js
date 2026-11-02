/*
  test-discord-members.js

      node .\site\tests\test-discord-members.js

  /api/allowed walks every linked account and asked Discord about each one
  separately. standingCached holds an answer for sixty seconds and both doors
  ask every five minutes, so the cache was always cold by the time they came
  back: about forty lookups per door, two doors, every five minutes, in a
  burst. The live server's log read "the site could not reach Discord, keeping
  the list as it was: rate limited by Discord" at 16:44, 16:49, 16:54, 16:59,
  17:04 and 17:09 on 22 September, once per refresh.

  guildMembers asks once for everybody. memberOf reads that list and only
  troubles Discord for one person when it has to. What this file checks is
  HOW MANY REQUESTS GO OUT, because that is the whole point of the change and
  it is the one thing that cannot be seen by reading the answer.

  It reads the real functions out of site\server.js rather than a copy, so
  it cannot pass against a version of them that is no longer what ships.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const SRC = path.join(REPO_DIR, 'site', 'server.js');
const src = siteFiles.source(SRC);

function grab(name) {
  const at = src.indexOf('async function ' + name);
  if (at < 0) throw new Error('site/server.js has no async function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

// ---- the stubs the two functions close over --------------------------------
let cfg = { discord: { botToken: 'x', guildId: 'g' } };
let membersCache = { at: 0, byId: null };
let now = 1000000;
const realNow = Date.now;
Date.now = () => now;

let calls = [];          // every path asked of Discord, in order
let guild = null;        // what the bulk call returns, or null to refuse it
let bulkStatus = 403;    // what a refused bulk call answers with

async function discordGet(p) {
  calls.push(p);
  if (p.indexOf('/members?limit=') >= 0) {
    if (guild === null) return { ok: false, status: bulkStatus, body: null, why: 'refused' };
    return { ok: true, status: 200, body: guild };
  }
  const id = p.slice(p.lastIndexOf('/') + 1);
  const hit = (guild || []).filter((m) => m.user.id === id)[0];
  if (hit) return { ok: true, status: 200, body: hit };
  return { ok: false, status: 404, body: null, why: 'not found' };
}

eval(grab('guildMembers') + '\n' + grab('memberOf'));

const member = (id) => ({ user: { id: String(id), username: 'p' + id }, roles: [], nick: null });

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};
const reset = (g) => { calls = []; guild = g; membersCache = { at: 0, byId: null }; };

(async () => {
  // ---- the fault this exists for -----------------------------------------
  reset([member(1), member(2), member(3)]);
  await memberOf('1'); await memberOf('2'); await memberOf('3');
  yes('three people cost ONE request, not three', calls.length === 1);
  yes('and that request is the bulk one', calls[0].indexOf('/members?limit=1000') >= 0);

  // Forty people is the real shape of it, twice for the two doors.
  reset(Array.from({ length: 40 }, (_, i) => member(i + 1)));
  for (let d = 0; d < 2; d++) for (let i = 1; i <= 40; i++) await memberOf(String(i));
  yes('eighty lookups across two doors still cost ONE request', calls.length === 1);

  // ---- the cache ----------------------------------------------------------
  reset([member(1)]);
  await memberOf('1');
  now += 59000;
  await memberOf('1');
  yes('a second ask inside sixty seconds asks Discord nothing', calls.length === 1);
  now += 2000;
  await memberOf('1');
  yes('past sixty seconds it asks again', calls.length === 2);

  // ---- who is missing -----------------------------------------------------
  reset([member(1), member(2)]);
  const gone = await memberOf('99');
  yes('somebody absent from a complete list is a 404', gone.status === 404 && !gone.ok);
  yes('and that costs no extra request', calls.length === 1);

  const there = await memberOf('2');
  yes('somebody present comes back ok with their own record', there.ok && there.body.user.id === '2');

  // A full page is the page limit, not the whole guild, so a miss proves
  // nothing and has to be asked about directly.
  reset(Array.from({ length: 1000 }, (_, i) => member(i + 1)));
  await memberOf('4000');
  yes('with exactly 1000 back, a miss still asks Discord directly', calls.length === 2);
  yes('and that second request is the single lookup', calls[1].indexOf('/members/4000') >= 0);

  // ---- when the intent is switched off ------------------------------------
  reset(null);
  const fb = await memberOf('7');
  yes('a refused bulk call falls back to the single lookup', calls.length === 2);
  yes('and the fallback answer is passed through', fb.status === 404);

  // The trap: remembering the failure. Without it, a guild with the intent
  // off asks for the whole list once per person and doubles the burst this
  // change exists to remove.
  reset(null);
  for (let i = 1; i <= 10; i++) await memberOf(String(i));
  const bulks = calls.filter((p) => p.indexOf('limit=') >= 0).length;
  yes('ten people with the intent off ask for the whole list ONCE, not ten times', bulks === 1);
  yes('and still make their ten single lookups', calls.length === 11);

  // ---- not configured -----------------------------------------------------
  reset([member(1)]);
  cfg = { discord: { botToken: '', guildId: '' } };
  await memberOf('1');
  yes('with no bot token it does not ask for the list', calls.filter((p) => p.indexOf('limit=') >= 0).length === 0);
  cfg = { discord: { botToken: 'x', guildId: 'g' } };

  Date.now = realNow;
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
