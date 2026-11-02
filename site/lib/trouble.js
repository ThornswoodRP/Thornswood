/*
  The trouble list: what a session's logs say went wrong, and the rules
  that find it.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { applyTrouble, noteTrouble, readTrouble, rereadTrouble,
  sweepTrouble };

const fs     = require('fs');
const path   = require('path');
const { FOR_BOT } = require('./base');
const { jsonFile, putJson } = require('./store');
const { putSessions, retentionSay, sessionKey, sessionRows, SESSIONS_DAYS,
  slogFile } = require('./sessions');

/*
  Did this session go wrong, and how badly?

  Decided by reading the logs it sent, once, as they arrive, rather than by
  asking somebody to go and look.

  TWO LEVELS, because they want two different things done about them.

  BAD is a crash or a throw: the session broke under the person and there was
  nothing they could have done. That colours the session red and the bot says
  so in the staff channel, because somebody should go and look now.

  WARN is the session failing for a reason that is already understood and has
  a known fix: an update that did not install, a load order that does not
  match, a mod missing or in the wrong place. That colours the session yellow
  and says NOTHING in Discord. These are common, they are self-inflicted by a
  machine rather than by the code, and a message for each one would make the
  staff channel unreadable, which is the same as having no channel.

  THE MARKERS ARE DELIBERATELY FEW. A test that matches "error" anywhere turns
  every session red, and a page where everything is red says exactly as much
  as a page where nothing is.

  Red is looked for first, so a session that both crashed AND had a load order
  complaint is red. First match wins and the line is kept with it, because
  "which session went wrong" is only half the question and "what did it say"
  is the other half.
*/
const TROUBLE_BAD = [
  ['Unhandled exception', 'something threw and nothing caught it'],
  ['Unhandled Exception', 'something threw and nothing caught it'],
  ['Uncaught ',           'a script threw and nothing caught it'],
  ['TypeError:',          'a script hit a TypeError'],
  ['ReferenceError:',     'a script hit a ReferenceError'],
  ['has crashed',         'the game crashed'],
  ['crashed with',        'the game crashed'],
  ['FATAL',               'something fatal']
];

/* The load order lines are the game's own check, as it writes them to Skyrim
   Platform's log (loadOrderVerificationService in the client), not the words
   LOAD ORDER ERROR. Those words are only ever painted on the game's screen,
   never logged by the game; the one log that carries them is the launcher's,
   inside its own Scan sentences ("The game shows that as LOAD ORDER ERROR"),
   which say what WOULD happen and stop Play until Fix. Matching them labelled
   42 of the 53 sessions from 25 to 28 Sep "refused over the load order" when
   the game's check had passed in every one it could be read for (#945). */
const TROUBLE_WARN = [
  ['Update failed',                 'an update did not install'],
  ['being used by another process', 'an update could not write a file something else had open'],
  ['Load order check failed',       'the game showed LOAD ORDER ERROR: its plugins are not the server\'s'],
  ['Missing some server mods',      'the game showed LOAD ORDER ERROR: it has fewer plugins than the server'],
  ['load order is not the server',  'their load order did not match the server'],
  ['does not match the server',     'their load order did not match the server'],
  ['is missing, install it in Vortex', 'a mod is not installed'],
  ['skymp5-client.js is missing',   'the client is not in place'],
  ['plugins.txt is missing',        'their plugin list was missing'],
  ['did not answer, so it is not known whether this build is current',
                                    'the update feed did not answer, so Play stayed shut']
];

function lineAround(text, at) {
  const from = text.lastIndexOf('\n', at) + 1;
  let to = text.indexOf('\n', at);
  if (to < 0) to = text.length;
  return text.slice(from, to).trim().slice(0, 300);
}

function scanFor(logs, marks, level) {
  for (const name of Object.keys(logs || {})) {
    const text = String(logs[name] || '');
    for (const [mark, why] of marks) {
      const at = text.indexOf(mark);
      if (at < 0) continue;
      return { level, why, file: name, line: lineAround(text, at) };
    }
  }
  return null;
}

/*
  ONLY THIS SESSION'S PART OF launcher.log (#945).

  The launcher sends the last 256 KB of its own log, which is days of it:
  every Scan, Fix, update and game it has run. The game's logs start afresh
  each run, so they are this session's; launcher.log is not. Read whole, a
  line from two days earlier coloured every session after it. Measured on
  28 Sep: all 42 sessions labelled "refused over the load order" since 25 Sep
  took the label from a Scan line written half an hour to 65 hours BEFORE the
  session started, which Fix had since put right, and the Scan just before
  each Play said 0 issues. An "Update failed" from 19 Sep did the same.

  So launcher.log is read from the last "Starting the game on launcher" line,
  which Shell writes as it starts the game for this session, to its end. A
  log with no such line has nothing that can be placed in this session, and
  none of it is read.
*/
const SESSION_START_MARK = 'Starting the game on launcher ';

function thisSessionOf(name, text) {
  const s = String(text || '');
  if (name !== 'launcher.log') return s;
  const at = s.lastIndexOf(SESSION_START_MARK);
  if (at < 0) return '';
  return s.slice(s.lastIndexOf('\n', at) + 1);
}

/*
  What the game server said about this person's load order in this session,
  from its own log (the load order refusal block in gamemode.js, #402 and
  #873). serverLines is the server log sliced to the session; the profile is
  the character's, which the lines name. A refusal outranks anything the
  client logs say about the load order, because it is the one that ended the
  session.
*/
function serverRefusal(serverLines, profile) {
  const p = Number(profile) || 0;
  if (!p || !Array.isArray(serverLines)) return null;
  const refused = 'refusing profile ' + p + ':';
  const would = 'WOULD REFUSE profile ' + p + ':';
  let watched = null;
  for (const raw of serverLines) {
    const line = String(raw);
    if (line.indexOf(refused) >= 0) {
      return {
        level: 'warn', file: 'server', line: line.trim().slice(0, 300),
        why: line.indexOf('no load order report') >= 0
          ? 'the server ended the session: their game never said which plugins it loaded'
          : 'the server ended the session: their load order is not the server\'s'
      };
    }
    if (!watched && line.indexOf(would) >= 0) {
      watched = {
        level: 'warn', file: 'server', line: line.trim().slice(0, 300),
        why: 'the server found their load order is not its own and let them stay'
      };
    }
  }
  return watched;
}

/*
  A CRASH LOG IN THE SET IS A CRASH (#2319). The launcher sends crash.log only
  when Crash Logger wrote one during this session (CrashLogSince picks it by
  the session's start), so its being there is the crash, whatever it holds.
  Until #2319 a session was marked only when a line in some log matched
  TROUBLE_BAD, and a crash that hung inside the crash handler left an empty
  log, which the launcher did not send at all: three dev crashes from 29 Sep
  to 6 Oct reached the site with no crash.log, no colour and no staff alert.
  The launcher now sends a first line of its own on crash.log naming the
  log, its size and the snapshot beside it, so an empty one arrives too.

  The line kept with it is the crash's own (the first TROUBLE_BAD line, which
  for Crash Logger is "Unhandled exception ..."), or the launcher's line when
  the log has none, which says the log is empty.
*/
const CRASH_EMPTY_MARK = 'and it is empty: 0 bytes';
function crashOf(logs) {
  const text = String((logs || {})['crash.log'] || '');
  if (!text.trim()) return null;
  const empty = text.indexOf(CRASH_EMPTY_MARK) >= 0;
  const why = empty ? 'the game crashed, and its crash log is empty' : 'the game crashed';
  const own = scanFor({ 'crash.log': text }, TROUBLE_BAD, 'bad');
  if (own) return { level: 'bad', why, file: 'crash.log', line: own.line };
  const first = text.split('\n').map(l => l.trim()).filter(Boolean)[0] || '';
  return { level: 'bad', why, file: 'crash.log', line: first.slice(0, 300) };
}

/* Red before yellow: a session that crashed AND complained about its load
   order is a crash, and the crash is the thing worth waking somebody for.
   A crash log first (crashOf, #2319), then the other red lines, then the
   server's word on the load order, then the rest. */
function readTrouble(logs, serverLines, profile) {
  const mine = {};
  for (const name of Object.keys(logs || {})) mine[name] = thisSessionOf(name, logs[name]);
  return crashOf(mine) ||
         scanFor(mine, TROUBLE_BAD, 'bad') ||
         serverRefusal(serverLines, profile) ||
         scanFor(mine, TROUBLE_WARN, 'warn');
}

/*
  Sets the row's trouble from what readTrouble found, or from the launcher's
  own issues when the logs said nothing, and clears it when neither says
  anything. Returns true when the row changed.
*/
function applyTrouble(row, found) {
  const before = [row.trouble, row.troubleAt, row.troubleFile, row.troubleLine].join('\u0001');
  delete row.trouble; delete row.troubleAt; delete row.troubleFile; delete row.troubleLine;
  if (found) {
    row.trouble = found.why;
    row.troubleAt = found.level;     /* 'bad' is red, 'warn' is yellow */
    row.troubleFile = found.file;
    row.troubleLine = found.line;
  } else {
    const issues = Array.isArray(row.issues) ? row.issues : [];
    const checks = Array.isArray(row.checks) ? row.checks : [];
    if (issues.length || checks.length) {
      /* No crash, but the launcher was unhappy. Yellow, and never a message
         in Discord: these are common, understood, and have a known fix. */
      const blocking = issues.filter(i => i && i.blocking).length;
      row.trouble = blocking
        ? (blocking + ' thing(s) would have stopped them connecting')
        : (issues.length + checks.length) + ' thing(s) the launcher was unhappy about';
      row.troubleAt = 'warn';
    }
  }
  return [row.trouble, row.troubleAt, row.troubleFile, row.troubleLine].join('\u0001') !== before;
}

/*
  Every row read again once under the rules above, because the rows written
  before #945 keep the label the whole launcher.log gave them, and the
  sessions page counts those. Only the stored client logs are read, not the
  server log (a session's server lines may have rolled away by now, and the
  old rule never read them either). TROUBLE_RULES moves when the rules do, so
  the next change reads them again too; a row already read under these rules
  is left alone. Nothing is said in Discord: these are old sessions.
*/
/* 3: a crash log in the set is a crash (crashOf, #2319). */
const TROUBLE_RULES = 3;
function rereadTrouble() {
  try {
    const rows = sessionRows();
    let changed = 0, read = 0;
    for (const row of rows) {
      if (!row || row.troubleRules === TROUBLE_RULES) continue;
      const key = sessionKey(row.session);
      if (!key) continue;
      let logs = null;
      try {
        const f = slogFile(key);
        if (fs.existsSync(f)) logs = (JSON.parse(fs.readFileSync(f, 'utf8')) || {}).logs || null;
      } catch (e) { logs = null; }
      row.troubleRules = TROUBLE_RULES;
      if (!logs) continue;
      read++;
      if (applyTrouble(row, readTrouble(logs))) changed++;
    }
    if (read || changed) putSessions(rows);
    console.log('[thornswood-docs] read ' + read + ' stored session log sets again under the current trouble rules; ' +
                changed + ' session(s) changed colour or reason');
  } catch (e) {
    console.log('[thornswood-docs] could not read the stored session logs again: ' + (e && e.message || e));
  }
}

/*
  The short list of sessions that went wrong, for the bot to read.

  A file rather than an endpoint, because the bot runs on this same box and a
  file needs no ticket, no port and nothing to keep in step. Newest last, the
  last 200, so it cannot grow without bound.
*/
const TROUBLE_FILE = path.join(FOR_BOT, 'trouble.json');
const TROUBLE_KEEP = 200;

/* True when the bot's row is written, or was already there. A write that
   fails is said and answers false (#2736): the whole of this sat in a try
   with an empty catch, and the putJson below was never looked at, so a crash
   whose note could not be written reached nobody in Discord and nothing said
   so. jsonFile and freshTrouble do not throw. */
function noteTrouble(row, found) {
  const list = jsonFile(TROUBLE_FILE, []);
  const all = Array.isArray(list) ? list : [];
  if (all.some(t => t && t.session === row.session)) return true;
  /* start and end are the session's own window, in the same unix ms the
     row was stamped with. at is when the logs arrived. They are kept apart
     because a backlog uploaded by a newer launcher lands long after the
     session ended: a 401 held Patrick's 23 September logs until 14:09 the
     next day, and the alert read as a fresh crash. With the session's start
     named and the arrival called out when it is later than the end, a late
     upload no longer looks like a new failure (issue #532). */
  all.push({
    session: row.session,
    who: String(row.who),
    name: String(row.name || ''),
    channel: String(row.channel || ''),
    profile: Number(row.profile) || 0,
    version: String(row.version || ''),
    start: Number(row.start) || 0,
    end: Number(row.end) || 0,
    at: Date.now(),
    why: found.why,
    file: found.file,
    line: found.line
  });
  if (putJson(TROUBLE_FILE, freshTrouble(all, Date.now()).slice(-TROUBLE_KEEP))) return true;
  console.error('[thornswood-docs] trouble ' + JSON.stringify({ event: 'write-failed', session: row.session, file: path.basename(TROUBLE_FILE) }));
  return false;
}

/*
  TROUBLE ROWS AGE LIKE THE SESSION THEY ARE ABOUT (#2166). Each row is a copy
  of a session record (who, the name, the profile, the session's window) with
  one line out of its launcher log, so the privacy page's 365 days for session
  records and launcher logs is its rule too. It was kept by count only, the
  last TROUBLE_KEEP, so on a quiet server a row outlived both the session row
  and the log set it was read from.

  A row's time is the latest of the session's start, its end and when its
  logs arrived, the same stamp the log set itself is aged by. A row with no
  usable time is kept rather than guessed at, the way the session rows keep
  one. A row whose session staff marked kept stays, because its row and its
  log set stay (pruneSessionLogs), and the alert is part of what was held.
  The count stays as the bound on the file's size.
*/
function freshTrouble(rows, now, held) {
  const cut = (Number(now) || Date.now()) - SESSIONS_DAYS * 86400000;
  const keep = held || new Set(sessionRows().filter((r) => r && r.keep).map((r) => String(r.session)));
  return (Array.isArray(rows) ? rows : []).filter((t) => {
    if (!t || typeof t !== 'object') return false;
    if (keep.has(String(t.session))) return true;
    const at = Math.max(Number(t.start) || 0, Number(t.end) || 0, Number(t.at) || 0);
    return !(at > 0 && at < cut);
  });
}
/* The timer's half. Writes only when something aged out, and a write that
   fails is said, the count and never what the rows hold (#2354). An
   unreadable file reads as [] and an empty list never writes over it. */
function sweepTrouble(now) {
  const raw = jsonFile(TROUBLE_FILE, []);
  const rows = Array.isArray(raw) ? raw : [];
  const kept = freshTrouble(rows, now);
  const out = { rows: rows.length, kept: kept.length, written: false };
  if (kept.length === rows.length) return out;
  out.written = putJson(TROUBLE_FILE, kept);
  if (!out.written) retentionSay('trouble', { event: 'write-failed', rows: rows.length, kept: kept.length });
  return out;
}

Object.assign(module.exports, { TROUBLE_FILE, TROUBLE_RULES });
