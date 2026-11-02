/*
  The sign in record the hub shows, aged by its keeping time.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { freshSignIns, noteSignIn, sweepSignIns };

const path   = require('path');
const { DATA } = require('./base');
const { jsonFile, putJson } = require('./store');
const { requestAddr } = require('./limits');

/* Every attempt to sign in, whether it worked or not.
 *
 * linked.json only records people who got through, which means somebody
 * refused at the door leaves no trace at all: not that they tried, not who
 * they were, not what they were reaching for. That is exactly the record
 * worth having for /hub, where the answer to "has anybody been poking at the
 * admin panel" should be a list rather than a shrug.
 *
 * Newest first, capped, so it can never grow without limit on the VPS. */
const ATTEMPTS = path.join(DATA, 'signins.json');

// ==== thornswood signin ageing ====
//
// A COUNT IS NOT A RETENTION RULE. This was capped at 500 rows and nothing
// else, so on a quiet closed playtest a row could sit here for a year: a
// Discord id, a handle, a display name and the address it was reached from.
// The reason the log exists is to answer "has anybody been poking at the
// admin panel", and that question is about the last few weeks, not about
// last spring.
//
// So it is aged by time as well as by count, and the ageing runs on the way
// OUT as well as the way in. Ageing only on write means a month with no
// sign-ins leaves everything sitting there, and the file that is meant to
// have emptied itself has not.
//
// Thirty days, and the privacy page says so, which is the point: a promise
// about what is kept is worth nothing if nothing enforces it.
//
// A row with no usable time is kept rather than dropped. It is a corrupt
// row either way, and throwing away the record of somebody being refused at
// the door because its timestamp would not parse is the wrong way to be
// wrong.
const ATTEMPTS_KEEP = 500;
const ATTEMPTS_DAYS = 30;
function freshSignIns(rows, now) {
  const list = Array.isArray(rows) ? rows : [];
  const cut = (Number(now) || Date.now()) - (ATTEMPTS_DAYS * 24 * 60 * 60 * 1000);
  const kept = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const at = Number(r.at);
    if (isFinite(at) && at > 0 && at < cut) continue;
    kept.push(r);
  }
  return kept.slice(0, ATTEMPTS_KEEP);
}
/* The hourly sweep ages the file too. Rows went only when somebody signed in
   or opened the list, so on 18 Oct 41 rows holding an address sat past the
   30 days the privacy page gives them, two days after the last sign-in. */
function sweepSignIns(now) {
  const raw = jsonFile(ATTEMPTS, []);
  const rows = Array.isArray(raw) ? raw : [];
  const kept = freshSignIns(rows, now);
  const out = { rows: rows.length, kept: kept.length, written: false };
  if (kept.length === rows.length) return out;
  out.written = putJson(ATTEMPTS, kept);
  if (!out.written) retentionSay('signin', { event: 'write-failed', rows: rows.length, kept: kept.length });
  return out;
}
// ==== end thornswood signin ageing ====

function noteSignIn(req, me, st, back) {
  /* No try around the whole (#2736). The one failure the record can have,
     the write, is said below (#2354), and nothing else in here throws on
     what the callback hands it; a bug that does is the handler's 500 and
     its stack in site.log, not a sign in that is quietly not recorded. */
  const list = jsonFile(ATTEMPTS, []);
  const rows = Array.isArray(list) ? list : [];

  let outcome = 'allowed';
  if (st.lookupFailed) outcome = 'could not check';
  else if (st.banned) outcome = 'banned';
  else if (!st.inGuild) outcome = 'not in the Discord';
  else if (!st.play) outcome = 'no role';

  rows.unshift({
    at: Date.now(),
    id: String(me.id || ''),
    handle: String(me.username || ''),
    name: String(st.name || me.global_name || me.username || ''),
    wanted: String(back || '/'),
    admin: !!st.admin,
    outcome: outcome,
    roles: Array.isArray(st.roles) ? st.roles.slice(0, 12) : [],
    ip: requestAddr(req)
  });
  // A write that fails leaves rows past thirty days in the file, so it is
  // said rather than dropped (#2354): the count, never what they hold.
  const kept = freshSignIns(rows, Date.now());
  if (!putJson(ATTEMPTS, kept)) {
    retentionSay('signin', { event: 'write-failed', rows: rows.length, kept: kept.length });
  }
}

Object.assign(module.exports, { ATTEMPTS });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { retentionSay } = require('./sessions');
