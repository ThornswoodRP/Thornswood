/*
  Deletion requests (scripts\vps\Delete-Person.ps1), applied before the
  site listens.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { applyDeletionRequests };

const fs     = require('fs');
const path   = require('path');
const { DATA, UP } = require('./base');
const { INBOX, putJson, RULES_OK } = require('./store');
const { GALLERY, GPENDING, GREPORTS, UPMETA } = require('./uploads');
const { LINKED } = require('./discord');
const { ROSTER } = require('./roster');
const { ATTEMPTS } = require('./signins');
const { SESSIONS, SLOGS } = require('./sessions');
const { TROUBLE_FILE } = require('./trouble');

// ==== thornswood deletion requests ====
/*
  A DELETION REQUEST IS TAKEN OUT OF THE SITE'S FILES AS IT STARTS (#2758).

  Patrick, 18 Oct 2026, after the first real deletion on his own account: "it
  should not restart everytime we want to delete a person it should just fully
  apply the rest upon a server restart". scripts\vps\Delete-Person.ps1 stops
  nothing: it writes the request into data\deletion-requests.json, and the
  site takes it out of its own files here, before it listens, so nothing it
  serves can write one of them back while it goes:

      { "people": [ { "discordId": "111111111111111111", "profiles": [ 5001 ] } ] }

  The profiles are the characters Delete-Person.ps1 found were theirs alone;
  the ones linked.json holds for them now, and no other account holds, are
  added, so a character made since the request goes too.

  What goes, the same as Delete-Person.ps1 removes from a copy of this folder
  that nothing runs from: their Discord link, their answer to the rules, their
  sign-in rows, their session rows with the launcher logs and failed-session
  alerts about them, their characters' roster rows, the tickets, applications
  and calls for help they sent, and their gallery pictures, waiting or
  approved, with the file. What stays: a session staff marked kept with its
  logs and alerts, reports they made or that were made about them, and a
  picture held while a report about it is looked into (#2352). Staff's own
  records (bans, notes, PKs, the staff log) are never read here. What is
  added: a mark in roster.json for each of their character numbers, with the
  time and nothing else, which /api/roster refuses a running game server's
  old rows by until every server has let go (#3677).

  Every file is read before any is written; one that is there and will not
  parse leaves the request where it is, and the start goes on. A write that
  does not take is said and the request waits for the next start; running it
  again finds what is already gone gone. When every part took, the request is
  deleted. The log says counts and never a Discord id, a profile id or a name.
*/
function applyDeletionRequests() {
  const FILE = path.join(DATA, 'deletion-requests.json');
  const say = (m) => console.log('[thornswood-docs] deletion requests: ' + m);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // { v } for a file that read, { v: fallback, missing } for one not there,
  // null (said) for one that is there and will not read or parse.
  const read = (p, fallback) => {
    let t;
    try { t = fs.readFileSync(p, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') return { v: fallback, missing: true };
      say(path.basename(p) + ' could not be read (' + e.code + ')');
      return null;
    }
    try { return { v: JSON.parse(t.replace(/^\uFEFF/, '')) }; }
    catch (e) { say(path.basename(p) + ' will not parse'); return null; }
  };
  const req = read(FILE, null);
  if (!req || req.missing) return;
  const people = req.v && Array.isArray(req.v.people) ? req.v.people : null;
  if (!people || !people.every((x) => isObj(x) && /^\d{17,20}$/.test(String(x.discordId)) && Array.isArray(x.profiles))) {
    say(path.basename(FILE) + ' is not a list of deletion requests, so nothing was removed and it is left as it is');
    return;
  }

  const SPEC = [
    ['linked', LINKED, {}], ['rules', RULES_OK, {}], ['signins', ATTEMPTS, []], ['sessions', SESSIONS, []],
    ['trouble', TROUBLE_FILE, []], ['roster', ROSTER, {}], ['inbox', INBOX, []], ['pending', GPENDING, []],
    ['gallery', GALLERY, []], ['reports', GREPORTS, []], ['umeta', UPMETA, {}]
  ];
  const f = {};
  for (const [k, p, fallback] of SPEC) {
    const r = read(p, fallback);
    if (!r) { say('nothing was removed, and the request waits for the next start'); return; }
    if (Array.isArray(fallback) !== Array.isArray(r.v) || !(Array.isArray(r.v) || isObj(r.v))) {
      say(path.basename(p) + ' is not the shape it should be, so nothing was removed, and the request waits for the next start');
      return;
    }
    f[k] = { p, v: r.v, dirty: false };
  }
  const counts = {};
  const gone = (k, n) => { if (n) counts[k] = (counts[k] || 0) + n; };
  const unlinks = new Set();
  const now = Date.now();

  for (const person of people) {
    const id = String(person.discordId);
    const L = f.linked.v;
    const P = new Set(person.profiles.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0));
    if (isObj(L[id]) && Array.isArray(L[id].profiles)) {
      for (const n of L[id].profiles) {
        const pid = Number(n);
        const other = Object.keys(L).some((o) => o !== id && isObj(L[o]) && Array.isArray(L[o].profiles) && L[o].profiles.map(Number).includes(pid));
        if (pid > 0 && !other) P.add(pid);
      }
    }
    const mine = (v) => P.has(Number(v));
    if (has(L, id)) { delete L[id]; f.linked.dirty = true; gone('Discord link', 1); }
    if (has(f.rules.v, id)) { delete f.rules.v[id]; f.rules.dirty = true; gone('answer to the rules', 1); }
    const filter = (k, keepIt, label) => {
      const keep = f[k].v.filter(keepIt);
      if (keep.length !== f[k].v.length) { gone(label, f[k].v.length - keep.length); f[k].v = keep; f[k].dirty = true; }
    };
    filter('signins', (x) => !(isObj(x) && String(x.id) === id), 'sign-in rows');
    const kept = new Set(), ended = new Set();
    filter('sessions', (x) => {
      if (!(isObj(x) && String(x.who) === id)) return true;
      if (x.keep) { kept.add(String(x.session)); return true; }
      ended.add(String(x.session));
      return false;
    }, 'session rows');
    let logs = [];
    try { logs = fs.readdirSync(SLOGS).filter((n) => /\.json$/i.test(n)); }
    catch (e) { if (e.code !== 'ENOENT') { say('the launcher logs could not be listed (' + e.code + '), so nothing was removed, and the request waits for the next start'); return; } }
    for (const n of logs) {
      const p = path.join(SLOGS, n);
      const r = read(p, null);
      if (!r || !isObj(r.v)) continue;
      if (String(r.v.who) !== id && !ended.has(String(r.v.session))) continue;
      if (!kept.has(String(r.v.session))) unlinks.add(p);
    }
    filter('trouble', (x) => {
      const theirs = isObj(x) && (String(x.who) === id || mine(x.profile) || ended.has(String(x.session)));
      return !theirs || kept.has(String(x.session));
    }, 'failed-session alerts');
    const R = f.roster.v;
    if (isObj(R.who)) for (const k of Object.keys(R.who)) if (mine(k)) { delete R.who[k]; f.roster.dirty = true; gone('roster rows', 1); }
    // A game server that has not started since still holds their rows and
    // sends them every five minutes; this mark is what /api/roster refuses
    // them by, until every server has let go (#3677).
    if (P.size) {
      if (!isObj(R.deleted)) R.deleted = {};
      for (const n of P) R.deleted[String(n)] = { at: now, clear: [] };
      f.roster.dirty = true;
    }
    if (isObj(R.servers)) {
      for (const sv of Object.values(R.servers)) {
        if (!isObj(sv)) continue;
        for (const k of ['checked', 'held']) {
          if (!Array.isArray(sv[k])) continue;
          const keep = sv[k].filter((n) => !mine(n));
          if (keep.length !== sv[k].length) { sv[k] = keep; f.roster.dirty = true; }
        }
      }
    }
    filter('inbox', (x) => {
      if (!isObj(x)) return true;
      const sent = String(x.discordId || '') === id || mine(x.profileId);
      return !sent || x.kind === 'report' || x.ticket === 'report';
    }, 'tickets, applications and calls for help');
    const ok = (name) => /^[A-Za-z0-9._ -]+$/.test(name) && name !== 'uploads.json';
    filter('pending', (x) => {
      if (!(isObj(x) && String(x.discordId || '') === id)) return true;
      const name = String(x.name || '');
      if (ok(name)) {
        unlinks.add(path.join(UP, name));
        if (has(f.umeta.v, name)) { delete f.umeta.v[name]; f.umeta.dirty = true; }
      }
      return false;
    }, 'gallery submissions waiting for staff');
    const reported = new Set(f.reports.v.filter(isObj).map((x) => String(x.name)));
    for (const name of Object.keys(f.umeta.v)) {
      const m = f.umeta.v[name];
      if (!isObj(m) || String(m.discordId || '') !== id || !ok(name)) continue;
      if (reported.has(name) || (m.removed && Number(m.heldUntil) > now)) continue;
      const before = f.gallery.v.length;
      f.gallery.v = f.gallery.v.filter((g) => !(isObj(g) && String(g.name) === name));
      if (f.gallery.v.length !== before) { f.gallery.dirty = true; gone('approved gallery pictures', 1); }
      else gone('other gallery files they sent', 1);
      unlinks.add(path.join(UP, name));
      delete f.umeta.v[name];
      f.umeta.dirty = true;
    }
  }

  let whole = true;
  for (const k of Object.keys(f)) {
    if (f[k].dirty && !putJson(f[k].p, f[k].v)) { say(path.basename(f[k].p) + ' could not be written'); whole = false; }
  }
  for (const p of unlinks) {
    try { fs.unlinkSync(p); gone(path.dirname(p) === SLOGS ? 'launcher logs' : 'gallery files', 1); }
    catch (e) { if (e.code !== 'ENOENT') { say(path.basename(p) + ' could not be deleted (' + e.code + ')'); whole = false; } }
  }
  const said = Object.keys(counts).map((k) => k + ' ' + counts[k]).join(', ') || 'nothing of theirs';
  if (!whole) { say(people.length + ' person(s): ' + said + '; the rest waits for the next start'); return; }
  try { fs.unlinkSync(FILE); say(people.length + ' person(s): ' + said + '; done, and the request is gone'); }
  catch (e) { say(people.length + ' person(s): ' + said + '; the request could not be deleted (' + e.code + '), so it runs again at the next start'); }
}
// ==== end thornswood deletion requests ====
