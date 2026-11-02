/*
  Bans, kills that stick, staff notes and the moderation log, and whether
  the files play rests on can be read (#2180, #2186).
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { accountBanned, accountOf, activeBans, banActive,
  banMinutes, bansNow, banUntilText, characterBar, dropBan, findDead,
  heldBroken, heldNow, heldShape, modLog, pkActive, pkProfiles, putBan,
  putNote, putPk, recordKey, staffRecords, undoPk };

const fs     = require('fs');
const path   = require('path');
const { DATA, FOR_BOT } = require('./base');
const { cfg } = require('./config');
const { jsonFile, putJson } = require('./store');
/*
  Who is banned, by Discord id, beside the people who are linked.

  THE ROLE WAS THE ONLY THING A BAN RESTED ON and the role did not exist: the
  builder makes eighteen roles and Banned was not among them until 23
  September, so every ban depended on somebody making it by hand and spelling
  it the way cfg.access.banned spells it. A capital letter in the wrong place
  was the difference between a ban and nothing at all, silently.

  This is the other half. A file of ids is not spelled, cannot be renamed by
  somebody tidying the Discord, and works when the bot is not in the guild,
  when the guild lookup fails and when the bot has not been configured at all,
  which is the branch that used to hand play to everybody.

  Shape: {"<discord id>": {"at": <unix ms>, "by": "<id or name>", "why": "..."}}
  It is read on every standing() and a missing file means nobody is banned,
  which is what an empty server looks like.

  WRITTEN BY STAFF SINCE #412 (Patrick, 28 September: "put the bans and notes
  on the site"), from the game's /ban and from the hub. A ban now also carries
  until (unix ms, 0 or missing for good), byId, name and profiles, and one
  made in the game against a profile no Discord account holds is kept under
  "p:<profile>" instead of an id. An old row with no until is a ban for good,
  as it always was.

  ONE CHARACTER OR THE WHOLE ACCOUNT (#1010, Patrick, 28 September: "staff
  can ban either one character or a whole account"). The key says which: a
  Discord id is the account (every character on it, and any new one, because
  standing() reads it and /api/play/join and /api/play/pass refuse the
  account), and "p:<profile>" is that one character and nothing else. scope
  on the row says the same in words. The game's /ban is a character now and
  /banaccount the account; the hub offers both.
*/
const BANS = path.join(DATA, 'bans.json');
/* THE BAN LIST FAILS CLOSED (#2186), AND SO DOES EVERY FILE PLAY AND
   IDENTITY REST ON (#2180). jsonFile() hands back its fallback for a file
   that is there but will not parse. So a bans.json cut short by a crash read
   as no bans at all and let every banned account in; a pk.json read as
   nobody dead for good; and a pk.json, linked.json, sessions.json or
   signins.json read as empty was written straight back as empty plus one
   row at the next PK, Play, session or sign-in, and every row it held was
   gone. These five are read through readHeld(): a missing file is the
   normal empty one, and a file that is there but will not read in its shape
   is BROKEN. While one is broken:
     - putFile writes nothing over it, so it is still there to repair;
     - bans.json, pk.json or linked.json broken lets nobody in to play
       (standing says banned for bans.json, characterBar bars every
       character, /api/allowed lists nobody), because who is banned, who is
       dead for good and who holds which character are not known;
     - the site says so on its log once each time it breaks and mends, and
       /api/ready answers 503 naming it, asked once at start too.
   The pages stay up. A broken file is repaired by hand on the box, from the
   backup, and the next request reads it again. */
function heldShape(p) {
  if (p === BANS || p === PK || p === LINKED) return 'table';
  if (p === SESSIONS || p === ATTEMPTS) return 'list';
  return '';
}
function heldGatesPlay(p) { return p === BANS || p === PK || p === LINKED; }
function readHeld(p) {
  const shape = heldShape(p);
  const empty = shape === 'list' ? [] : {};
  let text;
  try { text = fs.readFileSync(p, 'utf8'); }
  catch (e) { return (e && e.code === 'ENOENT') ? { doc: empty, broken: '' } : { doc: empty, broken: 'cannot be read (' + ((e && e.code) || 'unknown') + ')' }; }
  let doc;
  try { doc = JSON.parse(text.replace(/^\uFEFF/, '')); } catch (e) { return { doc: empty, broken: 'will not parse' }; }
  if (shape === 'list' ? !Array.isArray(doc) : (!doc || typeof doc !== 'object' || Array.isArray(doc))) {
    return { doc: empty, broken: shape === 'list' ? 'is not a list' : 'is not a table' };
  }
  return { doc, broken: '' };
}
const heldSaid = new Map();
function heldNow(p) {
  const r = readHeld(p);
  const was = heldSaid.get(p) || '';
  if (r.broken && was !== r.broken) {
    if (p === BANS) console.error('[thornswood-docs] BANS BROKEN: ' + BANS + ' ' + r.broken + '. Nobody is let in to play until it is repaired (#2186).');
    else console.error('[thornswood-docs] STATE BROKEN: ' + p + ' ' + r.broken + '. ' +
                       (heldGatesPlay(p) ? 'Nobody is let in to play, and nothing is written over it,' : 'Nothing is written over it') +
                       ' until it is repaired (#2180).');
  } else if (!r.broken && was) {
    console.log('[thornswood-docs] ' + path.basename(p) + ' reads again' + (p === BANS ? '; play is open to those not banned.' : '.'));
  }
  heldSaid.set(p, r.broken);
  return r;
}
/* Every held file that is broken now, by name and why, for /api/ready. */
function heldBroken() {
  const out = [];
  for (const p of [BANS, PK, LINKED, SESSIONS, ATTEMPTS]) {
    const r = heldNow(p);
    if (r.broken) out.push({ file: path.basename(p), why: r.broken, play: heldGatesPlay(p) });
  }
  return out;
}
function bansNow() {
  const r = heldNow(BANS);
  return { table: r.doc, broken: r.broken };
}
const BANS_BROKEN_WHY = 'the ban list cannot be read, so nobody can be let in until staff repair it';
const STATE_BROKEN_WHY = 'the site cannot read who holds which character or who is dead for good, so nobody can be let in until staff repair it';
/*
  Characters staff have killed for good (#1010, PK). Keyed by profile id:
  {"<profile>": {"at", "by", "byId", "why", "name", "account", "from"}}.
  Patrick, 28 September: the character "can never be played or selected
  again, but it is kept, not deleted, so staff can run events with PKed
  characters", it is quiet, and the account can make a new character. So
  nothing here or in the game server deletes anything: the join pass refuses
  the character, the door's lists leave it out, the launcher's menu shows it
  as dead in no slot, and staff read the row.

  UNDONE BY AN ADMIN (Patrick, 29 September: a PK made by mistake can be
  undone, by the admin role only, from the hub and with the game's /unpk,
  with a reason). The row is never deleted: undoing it adds "undone" {"at",
  "by", "byId", "why", "from"}, and a row with "undone" is not a PK any more
  (pkActive). A later PK of the same character moves the old row into
  "history" first, so every PK and every undo stays readable. The character
  comes back only into a free slot: undoPk refuses while every slot on the
  account holds a living character, and says so.
*/
const PK = path.join(DATA, 'pk.json');
// Staff notes against a person, keyed the same way as bans. Staff read them.
const NOTES = path.join(DATA, 'notes.json');
// What staff did on the hub, one JSON line each, for the bot's staff channel.
// The game servers write their own (for-bot\moderation.log beside each, #2321).
const MODLOG = path.join(FOR_BOT, 'moderation.log');
const NOTES_KEEP = 200;
const BAN_MOST_MIN = 10 * 365 * 24 * 60;

/* Whose Discord account holds this profile, from linked.json, or ''. */
function accountOf(pid) {
  const n = Number(pid) || 0;
  if (!(n > 0)) return '';
  const linked = jsonFile(LINKED, {});
  for (const d of Object.keys(linked)) {
    const ps = Array.isArray((linked[d] || {}).profiles) ? linked[d].profiles : [];
    if (ps.map(Number).indexOf(n) >= 0) return String(d);
  }
  return '';
}
/* Where a note about this profile is kept: the account, or the profile. */
function recordKey(pid) { return accountOf(pid) || ('p:' + (Number(pid) || 0)); }
function banActive(b, now) {
  return !!b && typeof b === 'object' && (!(Number(b.until) > 0) || Number(b.until) > now);
}
/*
  Why this one character may not be played, or null (#1010): killed for good
  by staff (pk), or under a ban on the character itself. A ban on the whole
  account is standing()'s, asked before this. Read from the files every time,
  so a ban that runs out lets the character back at once.
*/
function characterBar(pid, now) {
  const n = Number(pid) || 0;
  if (!(n > 0)) return null;
  // Who is dead for good and who holds which character, unknown while
  // pk.json or linked.json will not read (#2180): no character is let in.
  const readP = heldNow(PK), readL = heldNow(LINKED);
  if (readP.broken || readL.broken) return { pk: false, shut: true, why: STATE_BROKEN_WHY, until: 0 };
  const pk = readP.doc;
  if (pkActive(pk[String(n)])) {
    return { pk: true, at: Number((pk[String(n)] || {}).at) || 0 };
  }
  const readB = bansNow();
  if (readB.broken) return { pk: false, why: BANS_BROKEN_WHY, until: 0 };
  const byChar = readB.table;
  const b = byChar && byChar['p:' + n];
  if (banActive(b, now)) return { pk: false, why: String(b.why || ''), until: Number(b.until) || 0 };
  return null;
}
/* Whether a pk.json row is a PK that holds: there, and not undone by an admin. */
function pkActive(row) {
  return !!row && typeof row === 'object' && !row.undone;
}
/* Every profile staff have killed for good, as numbers. A pk.json that will
   not read carries broken on the list, and the door lets nobody in (#2180). */
function pkProfiles() {
  const readP = heldNow(PK);
  const table = readP.doc;
  const out = Object.keys(table).filter((k) => pkActive(table[k])).map(Number).filter((n) => n > 0);
  if (readP.broken) Object.defineProperty(out, 'broken', { value: 'pk.json ' + readP.broken });
  return out;
}
/* A ban's end in words, for the people told about it. */
function banUntilText(until) {
  return Number(until) > 0
    ? 'until ' + new Date(Number(until)).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
    : 'for good';
}
/* What a banned account is told at Play: until when and why for a staff ban
   (the file), the plain sentence for the Banned role. */
function accountBanned(st) {
  return 'That Discord account is banned from Thornswood' +
    (st && st.byFile ? ' ' + banUntilText(st.until) + (st.reason ? ': ' + st.reason : '') : '') + '.';
}
/* Every profile an active ban covers, with why and until, for the door. */
function activeBans(now) {
  const readB = bansNow();
  const table = readB.table;
  // An account's ban covers the characters linked.json gives it, so with
  // linked.json unreadable no account ban can be applied (#2180).
  const readL = heldNow(LINKED);
  const linked = readL.doc;
  const out = [];
  for (const k of Object.keys(table || {})) {
    const b = table[k];
    if (!banActive(b, now)) continue;
    const set = new Set((Array.isArray(b.profiles) ? b.profiles : []).map(Number).filter((n) => n > 0));
    if (k.indexOf('p:') === 0) set.add(Number(k.slice(2)));
    else for (const n of ((linked[k] || {}).profiles || [])) if (Number(n) > 0) set.add(Number(n));
    set.delete(0);
    // scope tells the game server what to say to them: one character, or the
    // whole account (#1010).
    if (set.size) out.push({ profiles: Array.from(set), why: String(b.why || ''), until: Number(b.until) || 0,
                             scope: k.indexOf('p:') === 0 ? 'character' : 'account' });
  }
  // Carried on the list, not sent: the door reads it to let nobody in (#2186).
  const broken = readB.broken ? 'bans.json ' + readB.broken : (readL.broken ? 'linked.json ' + readL.broken : '');
  if (broken) Object.defineProperty(out, 'broken', { value: broken });
  return out;
}
/* A ban, made or replaced. The account's standing is asked again at once. */
function putBan(key, row) {
  const readB = bansNow();
  if (readB.broken) return false;
  // Through the keeping time on the way in (#2353), so a write never puts
  // back a ban that ran out more than STAFF_DAYS ago.
  const table = freshBans(readB.table, Date.now());
  const had = table[key] || {};
  const profiles = new Set([].concat(had.profiles || [], row.profiles || []).map(Number).filter((n) => n > 0));
  table[key] = Object.assign({}, row, { profiles: Array.from(profiles) });
  const ok = putJson(BANS, table);
  standCache.delete(key);
  return ok;
}
function dropBan(keys) {
  const readB = bansNow();
  if (readB.broken) return { was: false, ok: false };
  const table = freshBans(readB.table, Date.now());
  let was = false;
  for (const k of keys) {
    if (k && Object.prototype.hasOwnProperty.call(table, k)) { delete table[k]; was = true; standCache.delete(k); }
  }
  return { was, ok: !was || putJson(BANS, table) };
}
function putNote(key, row) {
  const notes = freshNotes(jsonFile(NOTES, {}), Date.now());
  const list = Array.isArray(notes[key]) ? notes[key] : [];
  list.unshift(row);
  notes[key] = list.slice(0, NOTES_KEEP);
  return putJson(NOTES, notes);
}
function modLog(row) {
  try { fs.appendFileSync(MODLOG, JSON.stringify(Object.assign({ at: new Date().toISOString(), server: 'site' }, row)) + '\n'); }
  catch (e) { console.log('[thornswood-docs] could not write moderation.log: ' + e.message); }
}
/* A PK, kept for good. A row an admin undid goes into the new row's history. */
function putPk(pid, row) {
  const table = freshPk(jsonFile(PK, {}), Date.now());
  const had = table[String(Number(pid))];
  if (had && typeof had === 'object') {
    const old = Object.assign({}, had);
    delete old.history;
    row = Object.assign({}, row, { history: (Array.isArray(had.history) ? had.history : []).concat([old]) });
  }
  table[String(Number(pid))] = row;
  return putJson(PK, table);
}
/*
  How many character slots a Discord account has, for bringing a character
  back (#1010): its standing's, or, when Discord cannot be asked, the roles
  linked.json kept from its last Play.
*/
async function slotsOfAccount(account) {
  let st = null;
  try { st = await standingCached(String(account)); } catch (e) { st = null; }
  if (st && !st.lookupFailed) return slotsFor(st);
  const roles = (jsonFile(LINKED, {})[String(account)] || {}).roles;
  const list = Array.isArray(roles) ? roles : [];
  const has = (names) => (names || []).some((n) => list.indexOf(n) >= 0);
  return slotsFor({ roles: list, admin: has(cfg.access.admin), dev: has(cfg.access.dev) });
}
/*
  An admin undoes a PK made by mistake (#1010, Patrick, 29 September). The
  row stays, with "undone" saying who, when and why. The character comes
  back into a free slot: every other character on the account the game
  server has a character for, that is not dead for good, holds one, and when
  they fill the account's slots nothing changes and the answer says so.
  Answers { status, body } for the route to send.
*/
async function undoPk(pid, by, byId, why, from) {
  const table = jsonFile(PK, {});
  const row = table[String(pid)];
  if (!pkActive(row)) return { status: 200, body: { ok: true, was: false } };
  const account = String(row.account || accountOf(pid) || '');
  const name = String(row.name || '') || ('profile ' + pid);
  if (account) {
    const slots = await slotsOfAccount(account);
    const who = (jsonFile(ROSTER, { who: {} }) || {}).who || {};
    const held = ((jsonFile(LINKED, {})[account] || {}).profiles || []).map(Number)
      .filter((n, i, a) => n > 0 && n !== Number(pid) && a.indexOf(n) === i && who[String(n)] && !pkActive(table[String(n)]));
    if (held.length >= slots) {
      return { status: 409, body: { ok: false, error: 'every slot is taken', slots, held: held.length,
        message: 'Every character slot on that account is taken (' + held.length + ' of ' + slots + '), so ' +
                 name + ' is still dead for good and nothing changed. Its owner can forget a character in ' +
                 'the launcher to free a slot, then undo the PK again.' } };
    }
  }
  // Read again after the wait above, so a write in between is not lost.
  const now = freshPk(jsonFile(PK, {}), Date.now());
  const cur = now[String(pid)];
  if (!pkActive(cur)) return { status: 200, body: { ok: true, was: false } };
  cur.undone = { at: Date.now(), by, byId, why, from };
  if (!putJson(PK, now)) return { status: 500, body: { error: 'could not save' } };
  return { status: 200, body: { ok: true, was: true, name: String(cur.name || ''), account } };
}
/*
  The dead character the game's /unpk names (#1010): o.profileId, exact; or
  o.personProfileId, somebody in the world, whose account's one dead
  character it is; or o.words, the start of a dead character's name, or of
  the name of the account that holds it. Answers { pid, rest } or
  { message } saying who it could not tell apart.
*/
function findDead(o) {
  const table = jsonFile(PK, {}) || {};
  const dead = Object.keys(table).filter((k) => pkActive(table[k])).map(Number).filter((n) => n > 0);
  const linked = jsonFile(LINKED, {});
  const nameOf = (n) => String((table[String(n)] || {}).name || '') || ('profile ' + n);
  const listed = (ps) => ps.map((n) => nameOf(n) + ' (profile ' + n + ')').join(', ');
  const ofAccount = (acc, label) => {
    const ps = dead.filter((n) => String((table[String(n)] || {}).account || accountOf(n)) === String(acc));
    if (ps.length === 1) return { pid: ps[0] };
    if (!ps.length) return { message: label + ' has no character that is dead for good.' };
    return { message: label + ' has ' + ps.length + ' characters dead for good: ' + listed(ps) +
                      '. Name the character, or its profile number.' };
  };
  const words = (Array.isArray(o.words) ? o.words : []).map((w) => String(w || '').trim()).filter(Boolean).slice(0, 40);
  const pid = Number(o.profileId) || 0;
  if (pid > 0) {
    if (pkActive(table[String(pid)])) return { pid, rest: words };
    const acc = accountOf(pid);
    if (!acc) return { message: 'Profile ' + pid + ' is not dead for good.' };
    const r = ofAccount(acc, 'Profile ' + pid + '\'s account');
    return r.pid ? { pid: r.pid, rest: words } : r;
  }
  const person = Number(o.personProfileId) || 0;
  if (person > 0) {
    if (pkActive(table[String(person)])) return { pid: person, rest: words };
    const acc = accountOf(person);
    if (!acc) return { message: 'Nobody\'s account holds profile ' + person + '.' };
    const r = ofAccount(acc, String(o.personName || '').slice(0, 60) || ('Profile ' + person));
    return r.pid ? { pid: r.pid, rest: words } : r;
  }
  for (let n = words.length; n >= 1; n--) {
    const want = words.slice(0, n).join(' ').toLowerCase();
    const exact = dead.filter((k) => nameOf(k).toLowerCase() === want);
    const hits = exact.length ? exact : dead.filter((k) => nameOf(k).toLowerCase().indexOf(want) === 0);
    if (hits.length === 1) return { pid: hits[0], rest: words.slice(n) };
    if (hits.length > 1) {
      return { message: 'More than one character dead for good starts with "' + words.slice(0, n).join(' ') +
                        '": ' + listed(hits) + '. Name one, or its profile number.' };
    }
    const accs = Object.keys(linked).filter((d) => {
      const u = linked[d] || {};
      return [u.name, u.handle].some((s) => s && String(s).toLowerCase().indexOf(want) === 0);
    });
    if (accs.length === 1) {
      const r = ofAccount(accs[0], String(linked[accs[0]].name || linked[accs[0]].handle || 'That account'));
      return r.pid ? { pid: r.pid, rest: words.slice(n) } : r;
    }
  }
  return { message: 'No character dead for good goes by that name. Use its name, its owner\'s name or its profile number.' };
}
/*
  Every ban (with whether it still holds), every note and every PK, for staff,
  and the character names the game server's roster has for every linked
  profile, so the Linked accounts page can say which character is which.
*/
function staffRecords(now) {
  // Nothing past its keeping time is shown (#2353), sweep or no sweep.
  const table = freshBans(jsonFile(BANS, {}), now);
  const out = {};
  for (const k of Object.keys(table || {})) {
    out[k] = Object.assign({}, table[k] || {}, { active: banActive(table[k] || {}, now) });
  }
  const roster = (jsonFile(ROSTER, { who: {} }) || {}).who || {};
  const names = {};
  const linked = jsonFile(LINKED, {});
  for (const d of Object.keys(linked || {})) {
    for (const n of ((linked[d] || {}).profiles || [])) {
      const r = roster[String(Number(n))];
      if (r && r.name) names[String(Number(n))] = String(r.name);
    }
  }
  return { bans: out, notes: freshNotes(jsonFile(NOTES, {}), now), pk: freshPk(jsonFile(PK, {}), now), names };
}
/* Minutes as a ban length: 0 is for good, anything else is capped. */
function banMinutes(v) {
  const n = Math.floor(Number(v) || 0);
  return n > 0 ? Math.min(n, BAN_MOST_MIN) : 0;
}

Object.assign(module.exports, { BANS, BANS_BROKEN_WHY, MODLOG, NOTES, PK });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { standCache, standingCached } = require('./auth');
const { LINKED } = require('./discord');
const { ROSTER, slotsFor } = require('./roster');
const { ATTEMPTS } = require('./signins');
const { SESSIONS } = require('./sessions');
const { freshBans, freshNotes, freshPk } = require('./retention');
