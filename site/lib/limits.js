/*
  The cache for the two public lists, and the limits on public reads, on
  the report form and on sign ins.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { galleryPage, loginBackoffBump, loginKey, loginNote,
  loginWait, publicApiWait, publicJson, reportFrom, reportRefusal,
  reportTaken, requestAddr, trimInbox, turnstileOn, turnstilePasses };

const net    = require('net');
const fs     = require('fs');
const crypto = require('crypto');
const { cfg } = require('./config');
const { jsonFile } = require('./store');
const { NEWS } = require('./news');

// Cache only immutable public reads, invalidated by file changes. Never reuse
// authorization, bans, account records, or a staff board through this cache.
const publicJsonCache = new Map();
function publicJson(file, fallback) {
  if (file !== NEWS && file !== GALLERY) throw new Error('not a public cache file');
  let st;
  try { st = fs.statSync(file); } catch (e) { publicJsonCache.delete(file); return fallback; }
  const key = st.size + ':' + st.mtimeMs + ':' + st.ctimeMs;
  const old = publicJsonCache.get(file);
  if (old && old.key === key) return old.value;
  const value = jsonFile(file, fallback);
  publicJsonCache.set(file, {key, value});
  return value;
}
function galleryPage(offset, limit) {
  const raw = publicJson(GALLERY, []), shots = Array.isArray(raw) ? raw : [];
  return {gallery:shots.slice(offset, offset + limit), total:shots.length,
    next:offset + limit < shots.length ? offset + limit : null};
}

// In-memory, salted connection keys expire after a minute and are never logged.
// This is a single-process service; multiple replicas would need a shared cap.
const publicApiReads = new Map();
const PUBLIC_API_WINDOW = 60000, PUBLIC_API_CAP = 120;
function publicApiWait(req, now) {
  for (const [key, row] of publicApiReads) if (now - row.start >= PUBLIC_API_WINDOW) publicApiReads.delete(key);
  const key = reportFrom(req);
  let row = publicApiReads.get(key);
  if (!row) {
    if (publicApiReads.size >= 4096) return 1;
    row = {start:now, count:0}; publicApiReads.set(key, row);
  }
  if (row.count >= PUBLIC_API_CAP) return Math.max(1, Math.ceil((row.start + PUBLIC_API_WINDOW - now) / 1000));
  row.count++; return 0;
}

// ==== thornswood report limits ====
//
// THE PUBLIC REPORT FORM TOOK ANYTHING FROM ANYBODY, AS OFTEN AS THEY LIKED.
// No limit, nothing to tell a person from a script, and one list shared with
// the bot's tickets and trimmed to its newest 2000 rows. So 2000 posts from
// anywhere pushed every ticket and every real report off the end of
// inbox.json, on a page that tells the person "Somebody will read it".
//
// FIVE AN HOUR AND TWENTY A DAY FROM ONE PLACE. Somebody with a real problem
// sends one or two. Past that the answer is a 429 with a sentence saying when
// to try again, never a quiet drop: a limiter that swallows a report and says
// Sent breaks that promise worse than the flood did. Only reports that were
// taken count, so a script hammering on a refusal does not keep somebody on
// the same connection locked out for ever.
//
// WHERE A REQUEST COMES FROM. Caddy holds 443 and hands everything on from
// 127.0.0.1, so behind it every request looks like it came from here, and
// keyed on that the form would lock for everybody after five reports. The
// forwarded header is believed only when the socket really is loopback, which
// is Caddy, and only its LAST hop, which is the one Caddy wrote; anything
// before it is whatever the sender typed. A request that reached 3001 straight
// (THORNSWOOD_DOCS_LOCAL not set) is keyed by its own socket and its header is
// ignored. An IPv6 address counts as its /64, because one home connection is
// handed a whole /64 and would otherwise be millions of senders.
//
// NO ADDRESS IS KEPT. privacy.md says the sign-in log is the only thing on
// the site holding one. This table holds a hash of it under a key made fresh at every
// start and never written anywhere, and forgets it after a day. That is also
// why the cap per sender lives here at the door rather than in inbox.json:
// capping the file per sender would mean writing who sent each report into it.
//
// TICKETS AND REPORTS ARE TRIMMED APART. Each kind keeps the newest 2000 the
// shared list used to keep, so nothing posted to the public page can push a
// ticket out, and a pile of tickets cannot push a report out either.
//
// AND KEPT FOR INBOX_DAYS, THEN DROPPED (#2353). The count was the only rule,
// so on a quiet server a report, a call for help or an application lived for
// as long as fewer than 2000 came after it, which could be years, and the
// privacy page gave no time at all. Decided by Patrick on 12 October: a
// keeping time for each store, enforced in code. 365 days, the same as
// session records and chat, so a report has the session and the chat it is
// about behind it for exactly as long as they exist. A row's time is its at;
// a row with no usable time is kept, as the sign-in log keeps one, because
// a guess that deletes a report is the wrong way to be wrong. The ageing runs
// on every write, on the hub's read (so nothing past the window is shown),
// and in the hourly retention sweep (sweepInbox), with nothing sent needed.
const REPORT_HOUR = 5;
const REPORT_DAY = 20;
const INBOX_KEEP = 2000;
const INBOX_DAYS = 365;
const reportSalt = crypto.randomBytes(32);
const reportSeen = new Map();

// THE ONE TRUSTED-PROXY BOUNDARY (#2187). requestAddr is the address a request
// came from, and both the report limit below and the sign-in log use it, so
// there is one rule rather than two. The socket is the truth. X-Forwarded-For
// is believed only when the socket is a proxy we run: loopback, which is
// Caddy, or an address listed in THORNSWOOD_TRUSTED_PROXIES (comma separated,
// for a proxy on another box; empty by default). Even then only the LAST hop
// is taken, the one that proxy wrote: anything before it is whatever the
// sender typed. A direct caller's header is ignored entirely. Until 11
// October the sign-in log took the FIRST hop from anybody, so any caller could
// write any address into signins.json.
const TRUSTED_PROXIES = new Set(String(process.env.THORNSWOOD_TRUSTED_PROXIES || '')
  .split(',').map((s) => s.trim().toLowerCase().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, ''))
  .filter(Boolean));

function requestAddr(req) {
  const plain = (a) => String(a || '').trim().toLowerCase()
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, '');
  const sock = plain(req.socket && req.socket.remoteAddress);
  let addr = sock;
  if (/^(127\.|::1$)/.test(sock) || TRUSTED_PROXIES.has(sock)) {
    const hops = String((req.headers && req.headers['x-forwarded-for']) || '').split(',')
      .map((s) => s.trim()).filter(Boolean);
    const last = hops.length ? plain(hops[hops.length - 1]) : '';
    if (last && net.isIP(last)) addr = last;
  }
  return addr;
}

function clientAddr(req) {
  let addr = requestAddr(req);
  if (net.isIPv6(addr)) {
    const halves = addr.split('%')[0].split('::');
    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length > 1 && halves[1] ? halves[1].split(':') : [];
    const gap = halves.length > 1 ? Math.max(0, 8 - head.length - tail.length) : 0;
    addr = head.concat(new Array(gap).fill('0'), tail).slice(0, 4)
      .map((g) => (parseInt(g, 16) || 0).toString(16)).join(':') + '::/64';
  }
  return addr;
}

function reportFrom(req) {
  return crypto.createHmac('sha256', reportSalt).update(clientAddr(req)).digest('hex').slice(0, 32);
}

/* CLOUDFLARE TURNSTILE ON THE REPORT FORM (#3216). The report form is the one
   form anybody can send without signing in, on purpose, so it is the one a
   script can fill from anywhere. The gallery's forms and the hub need a
   Discord sign in with a role, which a script does not have, and the member
   password's form is off once Discord sign in is set up. Patrick's answer on
   22 Oct 2026 was to put Turnstile on the site's forms; this is the form that
   needs it.

   The page draws the widget with the site key (/api/report/form), and the
   widget gives it a one-time pass that goes with the report. The site asks
   Cloudflare whether that pass is good, with the secret and the sender's
   address, before it keeps anything. Both keys empty, as on a copy on your
   machine, is no widget and no check, never one without the other: a page
   that drew no widget would otherwise have every report refused. */
const TURNSTILE_VERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
function turnstileOn() {
  return typeof cfg.turnstileSiteKey === 'string' && cfg.turnstileSiteKey.length > 0 &&
         typeof cfg.turnstileSecret === 'string' && cfg.turnstileSecret.length > 0;
}
/* 'yes', 'no', or 'unasked' when Cloudflare did not answer inside the same
   ten seconds every other outside question gets (post()). The action is the
   one the page draws the widget with, so a pass made on another page of
   another site with the same key would not do. */
async function turnstilePasses(token, addr) {
  const t = String(token || '');
  if (!t || t.length > 2048) return 'no';
  let said;
  try {
    said = await post(TURNSTILE_VERIFY, { secret: cfg.turnstileSecret, response: t, remoteip: addr || '' });
  } catch (e) {
    // post() is the Discord helper and names Discord when nothing came back.
    console.error('[thornswood] turnstile: Cloudflare did not answer the check (' +
                  (e && e.discordSilent ? 'no answer in ten seconds' : (e && e.name) || 'error') + ')');
    return 'unasked';
  }
  if (said && said.success === true && said.action === 'report') return 'yes';
  // The error codes say why (timeout-or-duplicate, invalid-input-response);
  // never the pass itself or the secret.
  console.log('[thornswood] turnstile: a report was refused, Cloudflare said ' +
              JSON.stringify((said && said['error-codes']) || []) +
              (said && said.success === true ? ' with action ' + JSON.stringify(String(said.action || '')) : ''));
  return 'no';
}

function reportRefusal(key, now, whose) {
  const from = whose || 'your connection';
  const HOUR = 60 * 60 * 1000, DAY = 24 * HOUR;
  const at = Number(now) || Date.now();
  const day = (reportSeen.get(key) || []).filter((t) => t > at - DAY);
  const hour = day.filter((t) => t > at - HOUR);
  const wait = (ms) => Math.max(1, Math.ceil(ms / 1000));
  const said = (s) => s >= 5400 ? 'about ' + Math.round(s / 3600) + ' hours'
    : 'about ' + Math.max(1, Math.ceil(s / 60)) + (s > 60 ? ' minutes' : ' minute');
  if (hour.length >= REPORT_HOUR) {
    const s = wait(hour[0] + HOUR - at);
    return { wait: s, error: 'That is five reports from ' + from + ' in the last hour, ' +
      'which is as many as this page takes. Try again in ' + said(s) +
      ', or open a ticket in the Discord if it cannot wait.' };
  }
  if (day.length >= REPORT_DAY) {
    const s = wait(day[0] + DAY - at);
    return { wait: s, error: 'That is twenty reports from ' + from + ' today, ' +
      'which is as many as this page takes in a day. Try again in ' + said(s) +
      ', or open a ticket in the Discord if it cannot wait.' };
  }
  return null;
}

function reportTaken(key, now) {
  const list = reportSeen.get(key) || [];
  list.push(Number(now) || Date.now());
  reportSeen.set(key, list.slice(-REPORT_DAY));
}

function reportPrune(now) {
  const cut = (Number(now) || Date.now()) - 24 * 60 * 60 * 1000;
  for (const [key, list] of reportSeen) {
    const kept = list.filter((t) => t > cut);
    if (kept.length) reportSeen.set(key, kept); else reportSeen.delete(key);
  }
}

function trimInbox(rows, now) {
  const cut = (Number(now) || Date.now()) - INBOX_DAYS * 86400000;
  let tickets = 0, reports = 0;
  return (Array.isArray(rows) ? rows : []).filter((r) => {
    const at = Number(r && r.at);
    if (isFinite(at) && at > 0 && at < cut) return false;
    return (r && r.kind === 'ticket') ? ++tickets <= INBOX_KEEP : ++reports <= INBOX_KEEP;
  });
}
// ==== end thornswood report limits ====
setInterval(() => reportPrune(Date.now()), 10 * 60 * 1000).unref?.();

// ==== thornswood login limits ====
// POST /api/login only (#1305). The issue names no numbers, so this is a
// small fixed window: eight attempts from one address in ten minutes, then
// 429 until the oldest of those falls out of the window. Past that window
// a member-password guess waits longer each time (#1308). Nothing else on
// the site reads these tables. The address rules are the report form's: the
// last forwarded hop, and only when the socket is loopback (Caddy). The
// address is hashed under a key made at this start and never written.
const LOGIN_MAX = 8;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const loginSalt = crypto.randomBytes(32);
const loginSeen = new Map();

function loginKey(req) {
  return crypto.createHmac('sha256', loginSalt).update(clientAddr(req)).digest('hex').slice(0, 32);
}

function loginWait(key, now) {
  const at = Number(now) || Date.now();
  const list = (loginSeen.get(key) || []).filter((t) => t > at - LOGIN_WINDOW_MS);
  if (list.length) loginSeen.set(key, list); else loginSeen.delete(key);
  if (list.length < LOGIN_MAX) return 0;
  return Math.max(1, Math.ceil((list[0] + LOGIN_WINDOW_MS - at) / 1000));
}

function loginNote(key, now) {
  const at = Number(now) || Date.now();
  const list = (loginSeen.get(key) || []).filter((t) => t > at - LOGIN_WINDOW_MS);
  list.push(at);
  loginSeen.set(key, list);
}

// Once the window is full, each further member-password guess waits longer
// than the one before it (#1308). The extra starts at 30 seconds and doubles,
// up to an hour. It is added only when Discord OAuth is not configured, which
// is the only time this route reads a password. A correct password clears it.
// An address that has been quiet for a whole window is dropped.
const LOGIN_BACKOFF_CAP_S = 60 * 60;
const loginBackoff = new Map();

function loginBackoffBump(key, now, windowWait) {
  const at = Number(now) || Date.now();
  const prev = loginBackoff.get(key) || { n: 0 };
  const n = (prev.n || 0) + 1;
  const shift = Math.min(Math.max(n - 1, 0), 10);
  const extra = Math.min(LOGIN_BACKOFF_CAP_S, 30 * (1 << shift));
  const wait = Math.max(1, (Number(windowWait) || 0) + extra);
  loginBackoff.set(key, { n, until: at + wait * 1000 });
  return wait;
}

function loginPrune(now) {
  const at = Number(now) || Date.now();
  const cut = at - LOGIN_WINDOW_MS;
  for (const [key, list] of loginSeen) {
    const kept = list.filter((t) => t > cut);
    if (kept.length) loginSeen.set(key, kept); else loginSeen.delete(key);
  }
  for (const [key, rec] of loginBackoff) {
    if (!rec || rec.until < cut) loginBackoff.delete(key);
  }
}
setInterval(() => loginPrune(Date.now()), 10 * 60 * 1000).unref?.();
// ==== end thornswood login limits ====

Object.assign(module.exports, { loginBackoff });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { GALLERY } = require('./uploads');
const { post } = require('./discord');
