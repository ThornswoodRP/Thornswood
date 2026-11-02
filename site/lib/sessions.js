/*
  Play sessions and the launcher logs sent with them: looked at, kept and
  aged.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { crashedRow, findSession, lookedAtFor, markLooked,
  openSessionOf, pruneSessionLogs, putSessionLogs, putSessions, retentionSay,
  sessionKey, sessionRows, slogFile, sweepSessions };

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { DATA } = require('./base');
const { jsonFile, putJson } = require('./store');

/* Who played, when they started, when they stopped, and on which build.
 *
 * linked.json holds a last played stamp, which answers "has this person ever
 * pressed Play" and nothing else: not how long they were in, not whether they
 * are still in now, not which build it was. Djinn asked on 20 September for a
 * sheet testers are logged in and out of, and this is the record behind it.
 *
 * One row a session. Newest LAST, the way a log is written.
 *
 * KEPT FOR SESSIONS_DAYS, THEN DROPPED (#2350). The privacy page says session
 * records are kept for 365 days. Until 12 October the rows were only capped
 * by count, the newest 2000, so on a quiet server a row lived as long as
 * fewer than 2000 sessions came after it, which could be years. Decided by
 * Patrick on 12 October: age the rows by time, keep a row marked kept, and
 * run the ageing on a timer as well as when a session ends.
 *
 * A row's time is the later of its start and its end. A row with neither is
 * a corrupt row and is kept rather than guessed at, the way the sign-in log
 * keeps one. A row marked kept is evidence somebody chose to hold, and it is
 * never aged and never pushed out by the count either: before this, 2000
 * newer sessions pushed a kept row off the front and its logs lost their hold
 * with it.
 *
 * The count stays as a bound on the file's size: past 2000 rows the oldest
 * unkept ones go first, which is only ever sooner than the page says.
 *
 * The ageing runs on the way in (putSessions), on the way out (sessionRows,
 * so the hub never shows a row past the window), at start and every hour
 * (retentionSweep), with no session ending needed. */
const SESSIONS = path.join(DATA, 'sessions.json');
const SESSIONS_KEEP = 2000;
const SESSIONS_DAYS = 365;

function freshSessions(rows, now) {
  const cut = (Number(now) || Date.now()) - SESSIONS_DAYS * 86400000;
  const kept = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r || typeof r !== 'object') return false;
    if (r.keep) return true;
    const at = Math.max(Number(r.end) || 0, Number(r.start) || 0);
    return !(at > 0 && at < cut);
  });
  let over = kept.length - SESSIONS_KEEP;
  if (over <= 0) return kept;
  return kept.filter((r) => {
    if (over > 0 && !r.keep) { over--; return false; }
    return true;
  });
}
function sessionRows() {
  const list = jsonFile(SESSIONS, []);
  return freshSessions(list, Date.now());
}
function putSessions(rows) {
  return putJson(SESSIONS, freshSessions(rows, Date.now()));
}
/* The timer's half for the rows. Writes only when something aged out, and a
   write that fails is said, the count and never what the rows hold (#2354).
   A file that is there and cannot be read is left alone: jsonFile answers []
   for it, and an empty list never writes over anything. */
function sweepSessions(now) {
  const raw = jsonFile(SESSIONS, []);
  const rows = Array.isArray(raw) ? raw : [];
  const kept = freshSessions(rows, now);
  const out = { rows: rows.length, kept: kept.length, written: false };
  if (kept.length === rows.length) return out;
  out.written = putJson(SESSIONS, kept);
  if (!out.written) retentionSay('session', { event: 'write-failed', rows: rows.length, kept: kept.length });
  return out;
}

/* The id the launcher made for one session: its characters only, so nothing
   sent from outside can carry a path or punctuation into the file, and long
   enough to be a real id rather than a stub somebody typed. */
function sessionKey(v) {
  const s = String(v == null ? '' : v).replace(/[^A-Za-z0-9-]/g, '').slice(0, 64);
  return s.length >= 8 ? s : '';
}

/* The row this session id made FOR THIS ACCOUNT. Both halves matter: a ticket
   is only ever allowed to write its own rows, so an id that somebody else
   started is not this account's to start, end or annotate. Newest first,
   because a re-used id should find the row still open. */
function findSession(rows, key, who) {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i] && rows[i].session === key && String(rows[i].who) === String(who)) return i;
  }
  return -1;
}

/*
  The session a launcher has open for this account on this server, newest
  start first, or null (#3155). A problem reported from the game is tied to
  it, so the issue on the board points at the logs the launcher sends for it
  when the game closes. Open is no end yet; the game is running, so its
  session has none. A session that never said its build counts for either.
*/
function openSessionOf(rows, who, channel) {
  let best = null;
  for (const r of rows) {
    if (!r || String(r.who) !== String(who) || Number(r.end) > 0) continue;
    if (r.channel && r.channel !== channel) continue;
    if (!best || (Number(r.start) || 0) > (Number(best.start) || 0)) best = r;
  }
  return best;
}

/*
  A CRASH STAFF HAVE LOOKED AT (#2319, decided by Patrick on 12 Oct).

  A crash snapshot is every byte of the game's memory, 3.7 to 9.7 GB, and it
  never leaves the PC it was written on. Until this, the launcher kept only
  the newest, so the next crash on that install deleted the one before it
  whether anybody had read it or not: none of the four written from 29 Sep to
  6 Oct was. Now staff mark a crashed session looked at on the sessions page
  (/api/session-looked), and the launcher, which remembers which session each
  snapshot it holds crashed in, asks at its next check in which of those are
  marked (/api/play/join, snapshots in and lookedAt out) and deletes only
  those, or the oldest past two.

  Only a crash can be marked: a session whose trouble came from its crash.log
  (crashOf). The mark says who and when, like keep.
*/
function crashedRow(row) {
  return !!(row && row.troubleFile === 'crash.log');
}
function markLooked(row, on, by, now) {
  if (on) { row.looked = true; row.lookedBy = String(by || ''); row.lookedAt = Number(now) || Date.now(); }
  else { delete row.looked; delete row.lookedBy; delete row.lookedAt; }
  return row;
}
/* The most snapshot sessions one check in may ask about; the launcher
   remembers eight. */
const SNAPSHOTS_ASKED = 8;
/* Of the session ids a launcher asked about, the ones that are THIS account's
   and marked looked at. Another account's session is never answered for, so
   a check in cannot learn anything about somebody else's crashes. */
function lookedAtFor(rows, who, asked) {
  const list = Array.isArray(asked) ? asked : String(asked == null ? '' : asked).split(',');
  const out = [];
  for (const one of list.slice(0, SNAPSHOTS_ASKED)) {
    const key = sessionKey(one);
    if (!key || out.indexOf(key) >= 0) continue;
    const at = findSession(rows, key, who);
    if (at >= 0 && rows[at].looked) out.push(key);
  }
  return out;
}

/* ------------------------------------------------------- session logs -- */
/*
  The logs from one session, so a report can be read without asking the person
  to find four files and paste them.

  The client half is sent by the launcher when the game closes, which is the
  only moment it can be: the game wipes its own logs at every start, so by the
  time anybody asks for them they are gone. One file per session id.

  The server half is not stored at all. It is sliced out of the game server's
  own log on demand, by the session's start and end, because that log is
  already on this box and copying lines out of it into another file would be
  two copies of the same thing going stale against each other.

  THIS IS EVIDENCE, and it is written to be usable as evidence when somebody
  is suspended or banned. Three things follow from that and none of them is
  optional.

  WRITE ONCE. A session's logs can be sent once. A second upload for the same
  id is refused and the refusal is recorded. Without that, anybody who knew the
  endpoint could play, do something worth banning for, and then post a clean
  set over the top from the same launcher; the evidence would be whatever the
  accused chose to send last, which is no evidence at all.

  PROVENANCE IN THE FILE. Each set records the Discord id off the TICKET, not
  off the body, when it arrived, and a sha256 of every log. The hash is not
  security theatre: it is so that a copy pasted into a Discord argument months
  later can be held against the one on the box and shown to be the same text.

  KEPT BY AGE, NOT BY THE ROLLING LIST. sessions.json is aged by
  SESSIONS_DAYS and also bounded at two thousand rows. Tying the logs to the
  rows would quietly delete the evidence for an old incident the moment two
  thousand newer sessions had happened, which on a public server is weeks.
  They are kept for SLOG_DAYS instead, the same 365 days, and a session whose
  row is marked kept is never pruned at all.

  CHAT is kept elsewhere: the voice service writes one JSON line per message
  under its chat folder and ages whole days past THORNSWOOD_CHAT_DAYS
  (default 365). This block is only the launcher session logs. A session
  marked kept never loses its logs to the age prune; its chat lines still
  live in the voice folder and age with that window unless copied first.

  Caps, because this accepts a body from every launcher: one log is trimmed to
  its last 256 KB (the end is the part with the fault in it) and a whole set to
  1 MB.
*/
const SLOGS = path.join(DATA, 'session-logs');
const SLOG_ONE = 256 * 1024;
const SLOG_ALL = 1024 * 1024;
const SLOG_DAYS = 365;

/* The names the launcher may send. Anything else is dropped rather than
   written: this is a path coming from outside, and a file name is the shortest
   way into a folder nobody meant to write.

   In the order a set too big for SLOG_ALL keeps them. crash.log is the SKSE
   crash log from that session, if it crashed, and it goes second because it
   is the one that settles a crash with no message (entry 105).
   skyrim-platform.log is the tail of Skyrim Platform's own log, and it goes
   last because it is the biggest and the noisiest.

   Every name here is named on the privacy page, with what it can hold, and
   tests\test-session-logs.js fails when one is not (#3627). The retired
   dresser's log is not taken: nothing writes it, so a copy left on a PC was
   an old session's sent as this one's. */
const SLOG_NAMES = [
  'launcher.log', 'crash.log', 'thornswood-front.log', 'thornswood-voice.log',
  'thornswood-emotes.log', 'thornswood-input.log',
  'thornswood-loadorder.txt', 'thornswood-plugins-light.txt',
  'skyrim-platform.log'
];

function slogFile(key) { return path.join(SLOGS, key + '.json'); }

/* The tail of a log, never the head. A crash is at the end. */
function slogTrim(s, cap) {
  const t = String(s == null ? '' : s);
  if (t.length <= cap) return t;
  return '... the first ' + (t.length - cap) + ' characters are not kept ...\n' +
         t.slice(t.length - cap);
}

/* Written once. Returns 'saved', 'already', 'nothing' (no log in it worth
   keeping) or 'failed' (it could not be written, and that has been said). */
function putSessionLogs(key, who, logs) {
  try {
    if (!fs.existsSync(SLOGS)) fs.mkdirSync(SLOGS, { recursive: true });
    const file = slogFile(key);

    /* Write once. A second set for the same session is not written over the
       first; the attempt is recorded on the original so a replay shows up as
       what it is rather than as nothing.

       The one exception is a set that holds only a kept session's chat
       (#2166): the session was kept before the launcher had sent anything,
       so the file is there but the logs are not. Those logs are the first
       set, not a second one, and they go in beside the chat. */
    /* A first set that is there and will not read, or a replay that cannot
       be marked on it, is said in the site's log (#2736), the session key
       and the error and never what the set holds. Both used to be caught
       and dropped, so a replay of a set that had gone bad left no trace. A
       set that will not read is never written over: it is the evidence. */
    let keptChat = null;
    let first = null;
    const there = fs.existsSync(file);
    if (there) {
      try { first = JSON.parse(fs.readFileSync(file, 'utf8')) || null; }
      catch (e) {
        console.error('[thornswood-docs] session-logs ' + JSON.stringify({ event: 'set-unreadable', session: key, code: e.code || e.name }));
      }
      if (first && first.chatOnly && isObjectLike(first.chat)) keptChat = first.chat;
    }
    if (there && !keptChat) {
      if (first && typeof first === 'object') {
        first.resent = (Number(first.resent) || 0) + 1;
        first.resentAt = Date.now();
        try { fs.writeFileSync(file, JSON.stringify(first)); }
        catch (e) {
          console.error('[thornswood-docs] session-logs ' + JSON.stringify({ event: 'resend-unmarked', session: key, code: e.code || e.name }));
        }
      }
      return 'already';
    }

    const keep = {};
    const hash = {};
    let total = 0;
    for (const name of SLOG_NAMES) {
      if (!Object.prototype.hasOwnProperty.call(logs, name)) continue;
      const text = slogTrim(logs[name], SLOG_ONE);
      if (!text.trim()) continue;
      if (total + text.length > SLOG_ALL) continue;
      total += text.length;
      keep[name] = text;
      hash[name] = crypto.createHash('sha256').update(text, 'utf8').digest('hex');
    }
    if (!Object.keys(keep).length) return 'nothing';

    const set = {
      session: key,
      who: String(who),      /* off the ticket, never off the body */
      at: Date.now(),
      bytes: total,
      sha256: hash,
      logs: keep
    };
    if (keptChat) set.chat = keptChat;
    fs.writeFileSync(file, JSON.stringify(set));
    return 'saved';
  } catch (e) {
    /* 'failed', not 'nothing' (#2736). A set the folder would not take was
       answered 200 stored false, the same as a set with no logs in it, so
       the launcher dropped the logs it had kept for the site and nothing
       was said. Now it is said, and /api/play/logs answers 500, which the
       launcher keeps the logs for and sends again at its next start. */
    console.error('[thornswood-docs] session-logs ' + JSON.stringify({ event: 'write-failed', session: key, code: e.code || e.name }));
    return 'failed';
  }
}

/*
  Old log sets go, by age.

  NOT by whether the session is still in sessions.json. That file is also
  bounded at two thousand rows, so tying the logs to it would delete the
  evidence for an old incident the moment two thousand newer sessions had
  happened, and on a public server that is weeks. A row marked kept is never
  pruned, and never pushed out of sessions.json by the count (#2350), so
  anything an argument rests on can be held indefinitely by marking it.
*/
/*
  A LOG SET THAT WILL NOT GO IS SAID (#2354). Each delete that fails used to
  be caught and dropped, and the whole prune was wrapped twice more, so a set
  past SLOG_DAYS that would not delete stayed with nothing said, against what
  site/data/site/privacy.md promises. Now each failure is one line in the
  site's log, the file's name and the error code and never what it holds,
  the same shape the voice service's chat days use (#2191), and the answer
  says how many went and which would not, for the harness.
*/
// No try (#2736): o is a plain object of codes and counts, which stringify
// does not throw on, and console.error goes to the site log, which says its
// own failure once and never throws.
function retentionSay(what, o) {
  console.error('[thornswood-docs] ' + what + '-retention ' + JSON.stringify(o));
}
function pruneSessionLogs() {
  const out = { deleted: 0, failed: [] };
  let names;
  try {
    if (!fs.existsSync(SLOGS)) return out;
    names = fs.readdirSync(SLOGS);
  } catch (e) {
    out.error = (e && e.code) || 'unknown';
    retentionSay('session-log', { event: 'prune-failed', code: out.error });
    return out;
  }
  const cutoff = Date.now() - SLOG_DAYS * 86400000;
  const held = new Set(sessionRows().filter(r => r && r.keep).map(r => String(r.session)));
  for (const f of names) {
    if (!f.endsWith('.json')) continue;
    const key = f.slice(0, -5);
    if (held.has(key)) continue;
    const full = path.join(SLOGS, f);
    // When the set was saved: its own stamp, else the file's time. A set
    // whose time cannot be read either way is not aged, because a guess
    // that deletes evidence is the wrong way to be wrong.
    let at = 0;
    try { at = Number((JSON.parse(fs.readFileSync(full, 'utf8')) || {}).at) || 0; } catch (e) { at = 0; }
    if (!at) { try { at = fs.statSync(full).mtimeMs; } catch (e) { at = Date.now(); } }
    if (at >= cutoff) continue;
    try {
      fs.unlinkSync(full);
      out.deleted++;
    } catch (e) {
      const code = (e && e.code) || 'unknown';
      out.failed.push({ file: f, code: code });
      retentionSay('session-log', { event: 'delete-failed', file: f, code: code,
                                    daysPastRetention: Math.floor((cutoff - at) / 86400000) });
    }
  }
  return out;
}

Object.assign(module.exports, { SESSIONS, SESSIONS_DAYS, SLOG_ALL, SLOGS });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { isObjectLike } = require('./retention');
