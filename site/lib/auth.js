/*
  Who is asking: the member and admin cookies, the launcher ticket, a
  person's standing and the time it may take, and what the gallery lets
  them do.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { cookies, discordUnasked, gallerySender, galleryStaff,
  personReportRefusal, sameSecret, sign, standingCached, standingLate,
  standingsForDoor, who, within };

const crypto = require('crypto');
const { cfg } = require('./config');
const { LEVEL } = require('./pages');
const { banActive, bansNow } = require('./staff');
// ------------------------------------------------------------------ auth --
const COOKIE = 'tw';
const ADMIN  = 'twa';

const memberToken = () => crypto.createHash('sha256')
  .update('thornswood:' + String(cfg.password || '')).digest('hex');

function sign(v) {
  return crypto.createHmac('sha256', cfg.secret).update(String(v)).digest('hex').slice(0, 32);
}

function sameSecret(a, b) {
  const x = Buffer.from(String(a).padEnd(96).slice(0, 96));
  const y = Buffer.from(String(b).padEnd(96).slice(0, 96));
  return crypto.timingSafeEqual(x, y);
}

function cookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

const discordReady = () =>
  !!(cfg.discord.clientId && cfg.discord.clientSecret);

/* The password is a bootstrap, not a door. It exists so the one person who can
   configure Discord can get in to do it, and it stops existing the moment they
   have. Old cookies die with it, which is the point: a password that was
   passed around before is still passed around now. */
const isMember = (req) =>
  !discordReady() && sameSecret(cookies(req)[COOKIE] || '', memberToken());

/* The Discord cookie carries the id and a signature of it, and proves only who
   somebody is. What they may do is asked of Discord, so that removing a role
   or removing a person takes effect here without anybody editing a list.

   It carries when it was made as well, inside the signature, and anything
   older than ADMIN_DAYS reads as signed out. Max-Age is the browser promising
   to throw the cookie away; nothing held the site to it, so a value copied out
   of a browser was good forever, because all this checked was that the site
   had signed it. Entry 248. A cookie made before that has three parts rather
   than four and reads as signed out once. That only costs staff a sign in,
   because only staff may use the hub; the launcher's ticket is not this. */
const ADMIN_DAYS = 30;
function identity(req) {
  const raw = cookies(req)[ADMIN] || '';
  const [id, name, at, sig] = decodeURIComponent(raw).split('|');
  if (!id || !at || !sig) return null;
  if (!sameSecret(sig, sign(id + '|' + (name || '') + '|' + at))) return null;
  // A minute of slack the other way, for a clock that stepped back.
  const age = Date.now() - Number(at);
  if (!(age > -60000 && age < ADMIN_DAYS * 86400000)) return null;
  return { id: String(id), name: name || '' };
}

/* A minute of memory, so clicking around the site is not forty calls to
   Discord, and a ban still lands within a minute. */
const standCache = new Map();
async function standingCached(id) {
  const hit = standCache.get(id);
  // A staff ban (#412) is this site's own file, so a remembered one is asked
  // again: one that ran out or was lifted lets them in now, not in a minute.
  const nowBans = bansNow();
  const stale = hit && hit.v && (nowBans.broken ? !hit.v.bansBroken
    : (hit.v.byFile && !banActive(nowBans.table[String(id)] || null, Date.now())));
  if (hit && !stale && Date.now() - hit.at < 60000) return hit.v;
  const v = await standing(id);
  standCache.set(id, { at: Date.now(), v });
  if (!v.lookupFailed) standGood.set(id, { at: Date.now(), v });
  return v;
}
/* The last answer Discord actually gave for each account, kept past the
   minute above for STAND_STALE_MS so a page load can use it while Discord is
   slow (#1096). Only page loads read it (who() with staleOk); a failed lookup
   never lands here. */
const standGood = new Map();
const STAND_STALE_MS = 10 * 60000;

/* Every linked account's standing, for /api/allowed, inside the door's time.

   The route asked one account at a time. The door gives up after ten
   seconds (req.setTimeout in the gamemode's refresh), and when the bulk
   member list is refused each account is its own request to Discord: at
   100ms a call, a hundred linked accounts is ten seconds and the door never
   hears an answer at all (issue #415).

   So four at a time, and all of it inside DOOR_BUDGET_MS. An account not
   answered by then, or not asked because Discord said to wait longer than
   the time left, comes back as a failed lookup, which the route names in
   failedProfiles and the door keeps exactly as it was. A wait that ends
   inside the time left is waited out once, not once per account. */
const DOOR_BUDGET_MS = 7000;
const DOOR_LANES = 4;
async function standingsForDoor(ids) {
  const got = new Map();
  const started = Date.now();
  let timer = null;
  const late = new Promise((r) => { timer = setTimeout(() => r(null), DOOR_BUDGET_MS); });
  let next = 0;
  async function lane() {
    while (next < ids.length) {
      const id = ids[next++];
      const left = DOOR_BUDGET_MS - (Date.now() - started);
      const quiet = discordQuietMs();
      if (left <= 0) { got.set(id, { lookupFailed: 'ran out of time asking Discord' }); continue; }
      if (quiet >= left) { got.set(id, { lookupFailed: 'rate limited by Discord' }); continue; }
      if (quiet > 0) await new Promise((r) => setTimeout(r, quiet));
      let st;
      try { st = await Promise.race([standingCached(String(id)), late]); }
      catch (e) { st = { lookupFailed: String(e) }; }
      got.set(id, st || { lookupFailed: 'ran out of time asking Discord' });
    }
  }
  const lanes = [];
  for (let i = 0; i < Math.min(DOOR_LANES, ids.length); i++) lanes.push(lane());
  await Promise.all(lanes);
  clearTimeout(timer);
  return got;
}

/*
  How long a Submit waits on Discord before answering anyway (#467).

  who() asks Discord who a signed in visitor is before any route looks at what
  they sent, and discordGet gives Discord ten seconds a question, two
  questions when the guild list is refused. So with Discord slow or not
  answering, a signed in visitor pressing Send it on the report page watched
  the button for ten to twenty seconds, and a report about a person was then
  told to sign in, which they had.

  On the doors below, who() now waits this long and no longer. The question
  keeps going, one at a time per account (standAsking), and lands in
  standCache as before, so the next press has the answer. Until then the
  visitor counts as signed in with the lookup failed, which each door turns
  into words: a problem or an idea goes anyway, and anything that needs
  their roles says Discord could not be asked. A ban in the site's own file
  and the hand written admin list need no Discord, so they still count.
*/
const SUBMIT_WAIT_MS = 700;
/* Play's two doors, /api/play/join and /api/play/pass, answer inside
   PLAY_ANSWER_MS of the question, well inside the launcher's fifteen seconds
   (Discord.cs PostJson), with 503 "could not ask Discord" when Discord has
   not answered by then, which the launcher treats as a site that could not
   vouch (#1094). What the launcher sends is small and sent at once, so it
   gets PLAY_BODY_MS of that. */
const PLAY_ANSWER_MS = 10000;
const PLAY_BODY_MS = 5000;
const SUBMIT_DOORS = new Set(['/api/report', '/api/gallery/submit', '/api/gallery/report']);
// Shared for at most STAND_ASKING_MS: three questions of ten seconds is the
// longest a lookup should take, and one that never settles must not hold
// every later request for that account behind it.
const STAND_ASKING_MS = 35000;
const standAsking = new Map();
/* What an account counts as when Discord has not answered in time: the hand
   written admin list, which needs no Discord, and otherwise signed in with
   no roles and the lookup failed, which each door turns into words. */
function standingLate(id) {
  const listed = cfg.admins.indexOf(String(id)) >= 0;
  return { id: String(id), inGuild: listed, banned: false, admin: listed, play: listed, dev: listed,
           roles: [], name: '', lookupFailed: 'Discord did not answer in time' };
}
/* The 503 /api/play/join sends when Discord did not answer (#1094). Every
   other launcher door sends this same object (#1164). error is what the
   gallery launcher reads; message is what Play reads. */
function discordUnasked() {
  const message = 'Thornswood could not ask Discord about your account just now. Try again in a minute.';
  return { ok: false, why: 'could not ask Discord', message: message, error: message };
}
// p's answer, or late()'s once ms has passed without one.
function within(p, ms, late) {
  let timer = null;
  const LATE = {};
  const t = new Promise((r) => { timer = setTimeout(() => r(LATE), Math.max(0, ms)); });
  return Promise.race([p, t]).then((v) => { clearTimeout(timer); return v === LATE ? late() : v; });
}
function standingSoon(id, waitMs, staleOk) {
  let ask = standAsking.get(id);
  if (!ask || Date.now() - ask.at > STAND_ASKING_MS) {
    const mine = { p: standingCached(id), at: Date.now() };
    standAsking.set(id, mine);
    const done = () => { if (standAsking.get(id) === mine) standAsking.delete(id); };
    mine.p.then(done, done);
    ask = mine;
  }
  if (!(waitMs > 0)) return ask.p;
  // A page load uses the last answer Discord gave when this one is late or
  // failed, while the question above carries on and lands in the cache for
  // the next one (#1096).
  return within(ask.p, waitMs, () => standingLate(id)).then((st) => {
    const good = staleOk && st.lookupFailed && standGood.get(id);
    if (good && Date.now() - good.at < STAND_STALE_MS) return Object.assign({}, good.v, { stale: true });
    return st;
  });
}

/*
  PAGE LOADS WAIT NO LONGER THAN A SUBMIT (#1096). A GET or HEAD from a
  signed in visitor asked Discord in full before anything was sent back, so
  with Discord slow the gallery, the report page's sign in check and the hub
  took ten to twenty seconds to show. They get SUBMIT_WAIT_MS too, and then
  the last answer Discord gave for that account (up to STAND_STALE_MS old)
  or, with none, signed in with the lookup failed. Anything else waits at
  most PLAY_ANSWER_MS (#1164), the same deadline Play uses, and then counts
  as signed in with the lookup failed. One lookup can be three Discord
  questions, and the launcher gives up at fifteen seconds.
*/
async function who(req, waitMs, staleOk) {
  const me = identity(req);
  if (!me) return { member: isMember(req), admin: false, dev: false, name: '', id: '', play: false };
  const st = await standingSoon(me.id, waitMs, staleOk);
  return {
    // "member" is now "may use the hub", and only staff may. Being allowed
    // into the GAME is st.play, and that is asked separately by the launcher.
    // "dev" is staff in the game (access.dev: Owner, Co-Owner, and the Dev,
    // Gamemaster and Loremaster ranks with their leads, #3317), used by the
    // gallery queue and reports. Not the admin pair alone.
    member: st.admin || isMember(req),
    admin: st.admin,
    dev: !!st.dev,
    play: st.play,
    banned: st.banned,
    inGuild: st.inGuild,
    lookupFailed: st.lookupFailed || '',
    id: me.id,
    name: st.name || me.name
  };
}

/*
  Why this visitor cannot report a person from the report page, or null when
  they can. /api/report answers with it, and /api/gallery/who hands it to the
  page, so the page says the same words before Send it as the site would
  after (#1097). Signed in already is never told to sign in (#467), and
  Discord not answering in time is said as that.
*/
function personReportRefusal(w) {
  if (!w.id) return { code: 401, why: 'sign in', error: 'Sign in with Discord to report somebody, ' +
    'so staff can come back to you about it.' };
  if (w.banned) return { code: 403, why: 'banned', error: 'That Discord account is banned from Thornswood.' };
  if (!w.play && w.lookupFailed) return { code: 503, why: 'could not ask Discord', error:
    'Thornswood could not ask Discord who you are just now, so a report about a person cannot go yet. ' +
    'Try again in a minute. A problem or an idea goes without it.' };
  if (!w.play) return { code: 403, why: 'role', error: 'Your Discord account is not let into Thornswood ' +
    'yet, so it cannot report somebody from here. Ask staff in the Discord instead.' };
  return null;
}

/* 'staff' is w.dev, which already folds admin in, so widening access.dev
   widens the pages marked staff with it. Anything with no level named is the
   hub member cookie, as it always was. */
const allowed = (key, w) =>
  LEVEL[key] === 'admin' ? !!w.admin
  : LEVEL[key] === 'staff' ? !!w.dev
  : !!w.member;

/*
  Staff at a gallery door, by either of the two things that can prove it (#743).

  The hub's twa cookie is one: who(req) reads it and w.dev is the access.dev
  roles. The launcher has no cookie to offer, because the Discord callback
  mints the cookie on the browser and hands the launcher a signed ticket
  instead, so every staff door answered a launcher 403 however senior the
  account behind it was.

  So a ticket in the query is the other, read and re-checked against Discord
  exactly the way /api/gallery/submit and /api/gallery/report read theirs, with
  one bar higher: st.dev rather than st.play, because these doors Accept
  and Delete rather than send something in.

  It answers { ok: true, from, discordId } or { ok: false, code, body }. With
  neither cookie nor ticket the refusal is the 403 'staff only' these doors
  have always sent, so nothing about the hub page changes.
*/
/* Who is sending something to the gallery: a picture, a report, or a
   picture's smaller copies (#3218). A signed-in Discord account that may
   play, or the hub member cookie (password bootstrap / staff). Hub "member"
   alone used to be the only web door, and with Discord live that meant only
   admins could submit from the site. Otherwise a launcher ticket verified
   the way the door verifies it: read it, ask Discord for the standing, and
   hold it to the same answers /api/play/join gives, so a banned or departed
   account cannot put a picture in the queue. signIn is what a caller with
   neither is told. dev is whether the account holds a staff role. */
async function gallerySender(url, w, signIn) {
  if (w.play || w.member) return { ok: true, from: 'web', discordId: w.id || '', dev: !!w.dev };
  const t = readTicket(url.searchParams.get('ticket'));
  // Signed in, and Discord did not answer in time (#467): say that.
  if (!t && w.id && w.lookupFailed) return { ok: false, code: 503, body: { ok: false, why: 'could not ask Discord', error:
    'Thornswood could not ask Discord about your account just now. Try again in a minute.' } };
  if (!t) return { ok: false, code: 401, body: { ok: false, why: 'link', error: signIn } };
  const st = await within(standing(t.d), PLAY_ANSWER_MS, () => standingLate(t.d));
  standCache.delete(String(t.d));
  if (st.lookupFailed && !st.admin) return { ok: false, code: 503, body: discordUnasked() };
  // Banned before the guild check (#1022). standing() leaves inGuild false
  // when bans.json already refused the account.
  if (st.banned) return { ok: false, code: 403, body: { ok: false, why: 'banned', error:
    'That Discord account is banned from Thornswood.' } };
  if (!st.inGuild) return { ok: false, code: 403, body: { ok: false, why: 'guild', error:
    'That Discord account is not in the Thornswood Discord.' } };
  if (!st.play) return { ok: false, code: 403, body: { ok: false, why: 'role', error:
    'That Discord account has no role that lets it in yet.' } };
  return { ok: true, from: 'launcher', discordId: String(t.d), dev: !!st.dev };
}

async function galleryStaff(url, w) {
  if (w.dev) return { ok: true, from: 'web', discordId: w.id || '' };
  // Signed in, and Discord did not answer in time (#1164): say that, rather
  // than 'staff only', which would tell a Gamemaster they are not staff.
  if (w.id && w.lookupFailed && !w.admin) return { ok: false, code: 503, body: discordUnasked() };
  const t = readTicket(url.searchParams.get('ticket'));
  if (!t) return { ok: false, code: 403, body: { error: 'staff only' } };
  const st = await within(standing(t.d), PLAY_ANSWER_MS, () => standingLate(t.d));
  standCache.delete(String(t.d));
  if (st.lookupFailed && !st.admin) return { ok: false, code: 503, body: discordUnasked() };
  // A bans.json hit returns before Discord is asked, with inGuild left false
  // (#1022). Banned has to be said first, or the door claims they are not in
  // the Discord.
  if (st.banned) return { ok: false, code: 403, body: { ok: false, why: 'banned', error:
    'That Discord account is banned from Thornswood.' } };
  if (!st.inGuild) return { ok: false, code: 403, body: { ok: false, why: 'guild', error:
    'That Discord account is not in the Thornswood Discord.' } };
  if (!st.dev) return { ok: false, code: 403, body: { ok: false, why: 'role', error:
    'That Discord account has no staff role, so it cannot work the gallery queue.' } };
  return { ok: true, from: 'launcher', discordId: String(t.d) };
}

Object.assign(module.exports, { ADMIN, ADMIN_DAYS, allowed, COOKIE,
  discordReady, memberToken, PLAY_ANSWER_MS, PLAY_BODY_MS, standCache,
  standGood, SUBMIT_DOORS, SUBMIT_WAIT_MS });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { discordQuietMs } = require('./discord');
const { standing } = require('./members');
const { readTicket } = require('./passes');
