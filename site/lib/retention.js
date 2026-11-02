/*
  A keeping time for every store the privacy page names (#2353), and the
  hourly sweep that holds them, with kept chat and the copies a restore sets
  aside.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { copyKeptChat, dropKeptChat, freshBans,
  freshGalleryReports, freshNotes, freshPk, isObjectLike, retentionSweep,
  sessionWindow, stalePending };

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { ROOT } = require('./base');
const { INBOX, jsonFile, putFile, putJson } = require('./store');
const { trimInbox } = require('./limits');
const { GPENDING, GREPORTS, pruneRemovedUploads, UPMETA } = require('./uploads');
const { BANS, bansNow, MODLOG, NOTES, PK } = require('./staff');
const { sweepSignIns } = require('./signins');
const { pruneSessionLogs, retentionSay, sessionKey, sessionRows, slogFile,
  SLOGS, sweepSessions } = require('./sessions');

// ==== thornswood keeping times ====
//
// A KEEPING TIME FOR EVERY STORE THE PRIVACY PAGE NAMES (#2353). The page
// said what the site keeps and gave a time only for the stores that had a
// rule: reports, staff records, the moderation log and the gallery queue had
// none, and nothing in the code ever aged them. Decided by Patrick on 12
// October: "write a keeping time for each store and enforce it in code;
// Claude picks sensible times". The times, each on the page in the same
// words:
//
//   STAFF_DAYS, 365. A ban is kept for as long as it holds; one that ran out
//   is kept STAFF_DAYS past its end, then dropped, and lifting one already
//   deletes it. A PK that holds is kept, because the character stays dead
//   for good; one an admin undid is kept STAFF_DAYS past the undoing, and
//   each earlier PK in a row's history by the same rule. A staff note is
//   kept STAFF_DAYS from when it was written. A ban has to outlive any
//   window while it holds; once it does not, a year is the history staff
//   read a person by, the same year as their sessions and chat.
//   MODLOG_DAYS, 365. One line of moderation.log (every staff action on the
//   hub, for the bot's staff channel), the same as the game servers' own.
//   GREPORTS_DAYS, 365. A report against a gallery picture, like every
//   other report (INBOX_DAYS in the report limits).
//   PENDING_DAYS, 90. A gallery submission staff have neither accepted nor
//   deleted in 90 days is taken off the queue and its file deleted, the
//   same way a removed one is (pruneRemovedUploads), so the queue cannot
//   become a store of pictures nobody looked at.
//
// A time that cannot be read is kept rather than guessed at, as the sign-in
// log keeps one: a row or a line with no usable time is a corrupt one, and
// deleting a ban because its date would not parse is the wrong way to be
// wrong. These are pure functions over what was read, so the harness drives
// them on their own (site\tests\test-2353-keeping-times.js); the sweeps after the
// block do the reading and writing, at start and every hour, and the writes
// and the hub's reads go through the same functions.
const STAFF_DAYS = 365;
const MODLOG_DAYS = 365;
const GREPORTS_DAYS = 365;
const PENDING_DAYS = 90;
function keptCut(days, now) { return (Number(now) || Date.now()) - days * 86400000; }
// A usable time that is before the cut. Numbers are milliseconds; the logs
// write an ISO string.
function pastCut(at, cut) {
  const t = typeof at === 'string' ? Date.parse(at) : Number(at);
  return isFinite(t) && t > 0 && t < cut;
}
function isRecord(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function freshBans(table, now) {
  const cut = keptCut(STAFF_DAYS, now);
  const out = {};
  for (const k of Object.keys(isRecord(table) ? table : {})) {
    const b = table[k];
    if (isRecord(b) && Number(b.until) > 0 && pastCut(b.until, cut)) continue;
    out[k] = b;
  }
  return out;
}
// An earlier PK in a row's history ages from its undoing, or, replaced by a
// new PK without one, from when it was made.
function freshPk(table, now) {
  const cut = keptCut(STAFF_DAYS, now);
  const out = {};
  for (const k of Object.keys(isRecord(table) ? table : {})) {
    const row = table[k];
    if (!isRecord(row)) { out[k] = row; continue; }
    if (isRecord(row.undone) && pastCut(row.undone.at, cut)) continue;
    if (!Array.isArray(row.history)) { out[k] = row; continue; }
    const history = row.history.filter((h) => !(isRecord(h) &&
      pastCut(isRecord(h.undone) ? h.undone.at : h.at, cut)));
    out[k] = history.length === row.history.length ? row : Object.assign({}, row, { history });
  }
  return out;
}
function freshNotes(notes, now) {
  const cut = keptCut(STAFF_DAYS, now);
  const out = {};
  for (const k of Object.keys(isRecord(notes) ? notes : {})) {
    const list = notes[k];
    if (!Array.isArray(list)) { out[k] = list; continue; }
    const kept = list.filter((n) => !(isRecord(n) && pastCut(n.at, cut)));
    if (kept.length) out[k] = kept;
  }
  return out;
}
// moderation.log as text: every line inside MODLOG_DAYS, and every line whose
// time cannot be read, in the order they were written.
function freshModLog(text, now) {
  const cut = keptCut(MODLOG_DAYS, now);
  const lines = String(text || '').split('\n');
  const last = lines.pop();
  let dropped = 0;
  const kept = lines.filter((l) => {
    let row = null;
    try { row = JSON.parse(l); } catch (e) { return true; }
    if (isRecord(row) && pastCut(row.at, cut)) { dropped++; return false; }
    return true;
  });
  return { text: kept.map((l) => l + '\n').join('') + last, dropped };
}
function freshGalleryReports(list, now) {
  const cut = keptCut(GREPORTS_DAYS, now);
  return (Array.isArray(list) ? list : []).filter((r) => !(isRecord(r) && pastCut(r.at, cut)));
}
// The gallery queue split into what stays and what has waited too long.
function stalePending(list, now) {
  const cut = keptCut(PENDING_DAYS, now);
  const left = [], expired = [];
  for (const e of (Array.isArray(list) ? list : [])) {
    (isRecord(e) && pastCut(e.at, cut) ? expired : left).push(e);
  }
  return { left, expired };
}
// ==== end thornswood keeping times ====

/* The timer's half for each store above, and for the inbox. Each writes only
   when something aged out, never writes over a file that is there and will
   not read (jsonFile answers its empty fallback for one, and an empty table
   changes nothing), and says a write that fails: the store and the counts,
   never what the rows hold (#2354). */
function sweepInbox(now) {
  const raw = jsonFile(INBOX, []);
  const rows = Array.isArray(raw) ? raw : [];
  const kept = trimInbox(rows, now);
  const out = { rows: rows.length, kept: kept.length, written: false };
  if (kept.length === rows.length) return out;
  out.written = putJson(INBOX, kept);
  if (!out.written) retentionSay('inbox', { event: 'write-failed', rows: rows.length, kept: kept.length });
  return out;
}
function sweepStaffRecords(now) {
  const out = { bans: 0, pk: 0, notes: 0 };
  // A ban list that is there and will not read is never written over (#2186).
  const readB = bansNow();
  if (!readB.broken) {
    const kept = freshBans(readB.table, now);
    const n = Object.keys(readB.table).length - Object.keys(kept).length;
    if (n && putJson(BANS, kept)) out.bans = n;
    else if (n) retentionSay('bans', { event: 'write-failed', dropped: n });
  }
  for (const [what, file, fresh] of [['pk', PK, freshPk], ['notes', NOTES, freshNotes]]) {
    const raw = jsonFile(file, {});
    if (!isRecord(raw)) continue;
    const kept = fresh(raw, now);
    if (JSON.stringify(kept) === JSON.stringify(raw)) continue;
    if (putJson(file, kept)) out[what] = 1;
    else retentionSay(what, { event: 'write-failed' });
  }
  return out;
}
function sweepModLog(now) {
  let text;
  try { text = fs.readFileSync(MODLOG, 'utf8'); }
  catch (e) {
    if (e && e.code === 'ENOENT') return { dropped: 0 };
    retentionSay('moderation-log', { event: 'read-failed', code: (e && e.code) || 'unknown' });
    return { dropped: 0, error: (e && e.code) || 'unknown' };
  }
  const kept = freshModLog(text, now);
  if (!kept.dropped) return { dropped: 0 };
  if (putFile(MODLOG, kept.text)) return { dropped: kept.dropped };
  retentionSay('moderation-log', { event: 'write-failed', dropped: kept.dropped });
  return { dropped: 0, error: 'write-failed' };
}
function sweepGalleryReports(now) {
  const raw = jsonFile(GREPORTS, []);
  const rows = Array.isArray(raw) ? raw : [];
  const kept = freshGalleryReports(rows, now);
  if (kept.length === rows.length) return { dropped: 0 };
  if (putJson(GREPORTS, kept)) return { dropped: rows.length - kept.length };
  retentionSay('gallery-reports', { event: 'write-failed', rows: rows.length, kept: kept.length });
  return { dropped: 0, error: 'write-failed' };
}
/* A submission past PENDING_DAYS is marked removed on uploads.json first, so
   pruneRemovedUploads, run after this in the same sweep, deletes its file
   and its note, and a delete that fails is said and asked again each hour
   the way a removed one is. Off the queue only once the mark is written:
   the other way round, a failed mark would leave a file nobody lists. */
function expirePending(now) {
  const raw = jsonFile(GPENDING, []);
  if (!Array.isArray(raw)) return { expired: 0 };
  const split = stalePending(raw, now);
  if (!split.expired.length) return { expired: 0 };
  const meta = jsonFile(UPMETA, {});
  const at = Number(now) || Date.now();
  for (const e of split.expired) {
    const name = String(e.name || '');
    if (!/^[A-Za-z0-9._ -]+$/.test(name) || name === 'uploads.json') continue;
    meta[name] = Object.assign({}, isRecord(meta[name]) ? meta[name] : {}, { removed: at });
  }
  if (!putJson(UPMETA, meta)) {
    retentionSay('gallery-pending', { event: 'note-write-failed', expired: split.expired.length });
    return { expired: 0, error: 'note-write-failed' };
  }
  if (!putJson(GPENDING, split.left)) {
    retentionSay('gallery-pending', { event: 'write-failed', expired: split.expired.length });
    return { expired: 0, error: 'write-failed' };
  }
  return { expired: split.expired.length };
}

/*
  THE RETENTION TIMER (#2350). Both prunes used to run only when a session
  ended, so a quiet stretch with nobody playing left rows and log sets past
  365 days on disk, against what the privacy page says. Decided by Patrick
  on 12 October: run them on a timer too. Once as the site comes up and then
  every hour; each says its own failures (retentionSay) and neither throws.
  The rows go first, so the log prune reads which rows are still kept from
  the file as it now stands. The failed-session alerts in trouble.json age
  in the same pass by the same 365 days (#2166, sweepTrouble), and removed
  gallery files whose hold has ended go too (#2352, pruneRemovedUploads),
  and sign-in rows past their 30 days (sweepSignIns). Since #2353 so do the
  inbox, the staff records, the site's moderation.log, the gallery reports
  and the gallery queue, each by its keeping time (the keeping times block).
*/
const RETENTION_EVERY_MS = 60 * 60 * 1000;
/*
  A KEPT SESSION KEEPS ITS CHAT (#2166 G1). Keeping a session used to hold
  its row and its launcher logs and nothing else. What the person said in it
  was read live, every time, out of the voice service's day files
  (chatSlice), and the voice service deletes a whole day 365 days on
  (voice-server.js chatPrune) without knowing which sessions staff kept, so
  the words a suspension rests on went a year later while the page said the
  session was held.

  So keeping a session copies its chat, the same window /api/session-logs
  reads, into the session's own log set (session-logs/<session>.json, a
  "chat" field), which is already what a kept session holds past
  SLOG_DAYS: pruneSessionLogs skips kept sets and Delete-Person.ps1 leaves
  them alone. A session kept before the launcher sent anything gets a set
  holding only the chat (chatOnly), and putSessionLogs fills the logs in
  beside it when they come.

  The day files stay the voice service's, pruned whole by date: the copy is
  what outlives them, not an edit to them, and the site never writes in the
  voice service's folder.

  A copy is made only from day files that are there. A copy already made is
  never written over by a read that found no day files, because that read
  would be an empty list standing in for words that were said. A session
  kept while it was still open is copied again once it has ended and the
  copy is short of its end. Letting the session go drops the copy, so it
  cannot outlive the hold it was made for.
*/
function isObjectLike(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
function sessionWindow(row, now) {
  return { from: (Number(row.start) || Number(row.end) || 0) - 60000,
           to: (Number(row.end) || now || Date.now()) + 60000 };
}
function readSlogSet(key) {
  try {
    const f = slogFile(key);
    if (!fs.existsSync(f)) return { there: false, set: null };
    return { there: true, set: JSON.parse(fs.readFileSync(f, 'utf8')) };
  } catch (e) { return { there: true, set: null, code: (e && e.code) || 'unreadable' }; }
}
function keptChatCurrent(row, chat) {
  if (!isObjectLike(chat) || !Array.isArray(chat.lines)) return false;
  if (!Number(row.end)) return true;
  return (Number(chat.to) || 0) >= Number(row.end) + 60000;
}
function copyKeptChat(row, now) {
  now = now || Date.now();
  const key = sessionKey(row && row.session);
  if (!key) return 'no-session';
  /* A row with neither a start nor an end has no window to copy. */
  if (!Number(row.start) && !Number(row.end)) return 'no-window';
  const had = readSlogSet(key);
  if (had.there && !isObjectLike(had.set)) {
    retentionSay('kept-chat', { event: 'copy-failed', session: key, code: had.code || 'unreadable' });
    return 'failed';
  }
  if (had.set && keptChatCurrent(row, had.set.chat)) return 'already';
  const w = sessionWindow(row, now);
  const slice = chatSlice(row.profile, w.from, w.to, row.channel);
  if (slice.why) return had.set && had.set.chat ? 'already' : 'no-chat-log';
  const text = JSON.stringify(slice.lines);
  const chat = {
    copiedAt: now, from: w.from, to: w.to,
    channel: row.channel === 'dev' ? 'dev' : 'main',
    lines: slice.lines,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex')
  };
  const set = had.set || { session: key, who: String(row.who || ''), at: now, bytes: 0,
                           sha256: {}, logs: {}, chatOnly: true };
  set.chat = chat;
  try {
    if (!fs.existsSync(SLOGS)) fs.mkdirSync(SLOGS, { recursive: true });
    fs.writeFileSync(slogFile(key), JSON.stringify(set));
    return 'copied';
  } catch (e) {
    retentionSay('kept-chat', { event: 'copy-failed', session: key, code: (e && e.code) || 'unknown' });
    return 'failed';
  }
}
function dropKeptChat(key) {
  key = sessionKey(key);
  if (!key) return 'no-session';
  const had = readSlogSet(key);
  if (!had.set || !had.set.chat) return 'none';
  try {
    if (had.set.chatOnly) fs.unlinkSync(slogFile(key));
    else { delete had.set.chat; fs.writeFileSync(slogFile(key), JSON.stringify(had.set)); }
    return 'dropped';
  } catch (e) {
    retentionSay('kept-chat', { event: 'drop-failed', session: key, code: (e && e.code) || 'unknown' });
    return 'failed';
  }
}
/* Every kept session has its copy: the ones kept before this existed, and
   the ones kept while still open. Hourly with the rest of the retention
   sweep, so a day file is copied long before its 365 days are up. */
function copyKeptChats(now) {
  const out = { copied: 0, failed: 0, noChatLog: 0 };
  let rows;
  try { rows = sessionRows(); } catch (e) { return out; }
  for (const r of rows) {
    if (!r || !r.keep) continue;
    const got = copyKeptChat(r, now);
    if (got === 'copied') out.copied++;
    else if (got === 'failed') out.failed++;
    else if (got === 'no-chat-log') out.noChatLog++;
  }
  return out;
}

/* A restore (scripts\vps\vps-restore-services.ps1) moves the data folder,
   the uploads and config.json it replaces to <name>-before-restore-<stamp>
   beside them, <stamp> the box's local yyyyMMdd-HHmmss, with -2, -3 for a
   second restore in the same second. Nothing deleted them (#3620). Decided
   by Patrick on 26 Oct (B): a set-aside copy is kept 30 days, so a restore
   can be undone, then deleted. By the time in its name, never a file's own
   times, which a move keeps from the original. A link is left as it is and
   said. The feed's copies are not the site's to delete (it is denied writing
   there, #913) and hold no person. Delete-Person.ps1 reads a data copy for a
   deletion request while it is here. */
const RESTORE_ASIDE_DAYS = 30;
const RESTORE_ASIDE = /^(data|uploads|config\.json)-before-restore-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-\d+)?$/;
function sweepRestoreCopies(now, root) {
  root = root || ROOT;
  const out = { deleted: 0, failed: [] };
  let names;
  try { names = fs.readdirSync(root); }
  catch (e) {
    out.error = (e && e.code) || 'unknown';
    retentionSay('restore-copy', { event: 'list-failed', code: out.error });
    return out;
  }
  const cut = now - RESTORE_ASIDE_DAYS * 86400000;
  for (const n of names.sort()) {
    const m = RESTORE_ASIDE.exec(n);
    if (!m) continue;
    const at = new Date(+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7]).getTime();
    if (!(at < cut)) continue;
    const p = path.join(root, n);
    let st;
    try { st = fs.lstatSync(p); } catch (e) { continue; }
    if (st.isSymbolicLink()) { retentionSay('restore-copy', { event: 'left-link', name: n }); continue; }
    if (st.isDirectory() !== (m[1] !== 'config.json')) continue;
    try {
      fs.rmSync(p, { recursive: true });
      out.deleted++;
      retentionSay('restore-copy', { event: 'deleted', name: n, days: RESTORE_ASIDE_DAYS });
    } catch (e) {
      out.failed.push(n);
      retentionSay('restore-copy', { event: 'delete-failed', name: n, code: (e && e.code) || 'unknown' });
    }
  }
  return out;
}

function retentionSweep() {
  const now = Date.now();
  const sessions = sweepSessions(now);
  /* Copies before the prune, so a kept session's chat is in its set before
     anything goes. */
  const keptChat = copyKeptChats(now);
  /* In this order, an object literal's own: the queue's expired submissions
     are marked removed before the prune, so their files go in this same pass
     (#2353). */
  return { sessions, keptChat, sessionLogs: pruneSessionLogs(),
           trouble: sweepTrouble(now), pending: expirePending(now),
           removedUploads: pruneRemovedUploads(now),
           signIns: sweepSignIns(now), inbox: sweepInbox(now),
           staff: sweepStaffRecords(now), moderationLog: sweepModLog(now),
           galleryReports: sweepGalleryReports(now),
           restoreCopies: sweepRestoreCopies(now) };
}
setInterval(retentionSweep, RETENTION_EVERY_MS).unref?.();

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { sweepTrouble } = require('./trouble');
const { chatSlice } = require('./serverlogs');
