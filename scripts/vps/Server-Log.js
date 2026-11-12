'use strict';
/*
  Server-Log.js

  Writes the game server's log, server.log, and keeps nothing in it, or in any
  rolled copy of it, for longer than 30 days. It goes up beside the server as
  server-log.js, and the server's scheduled task runs the server under it:

      cmd /c "start "" /b /wait /high node server-log.js --log <root>\server.log --also thornswood.log dist_back/skymp5-server.js & call exit %^errorlevel%"

      node server-log.js --log <root>\server.log --roll     rolls it now and applies the 30 days, then exits (an install)

  And since #2166 two other logs that name people, which used to roll by
  size only, with nothing aging them:

      --also thornswood.log      the gamemode's own log, beside server.log, kept
                                 to 90 days (--also-days). The gamemode writes
                                 and rolls it by size (game/gamemode.js); this
                                 moves it aside once its first line is from an
                                 earlier day, and cuts every rolled copy of it
                                 (its .1 to .5 and the dated ones) to 90 days,
                                 at a start, at a roll and once an hour, the same
                                 way as server.log's own. Nothing in game\ changes.
      --days 90 --stamp          the voice service runs under this too
                                 (Install-Voice.ps1, vps-dev-instance.ps1), so
                                 voice.log is rolled at midnight and at 4 MB and
                                 kept to 90 days rather than held open by cmd's
                                 >> and rolled only at a start. Voice's lines carry
                                 no time of their own, so --stamp puts this
                                 process's in front of each one, which is what
                                 lets a line be aged at all.

  WHY (#2349). The engine writes the address of every connection into its
  console ("Connecting a user N with ip ...", skymp5-server ts/systems/login.ts),
  beside the line that names the slot's Discord id. Until 12 Oct 2026 that
  console went to server.log through cmd's >> server.log 2>&1, and cmd holds
  that file open for as long as the server runs, so the only roll it could
  have was Roll-Log.ps1 in front of each start, by size, five kept. Nothing
  aged it: a server that was not restarted kept one file growing, and the
  five rolled ones held whatever they held, however old. Measured 12 Oct: the
  oldest connecting address on disk was from 21 Sep on live and 4 Oct on dev,
  while the privacy page said the 30-day sign-in log was the only thing
  holding an address. Decided by Patrick on 12 Oct (#2349, B and C): the
  server log is deleted after 30 days, and the privacy page says it holds the
  address for that long.

  HOW. This process starts the server as its child with both streams piped to
  it, and is the only thing that holds server.log. So it can roll the file
  whenever it needs to, which cmd's redirect never allowed:

    - at local midnight, so server.log only ever holds today's lines,
    - at 4 MB, the size Roll-Log.ps1 rolled at,
    - at a start, when the server.log there is from another day or full.

  A rolled file is server.log.<when it was rolled>, digits only, local time to
  the millisecond (server.log.20261012235959123). Nothing is renumbered, so a
  roll is one rename and no reader holding an older file can stop it.

  THE 30 DAYS. Every line the engine writes starts with its local time,
  "[2026-10-12 21:40:03.155]" (the site's serverLogSlice reads the same
  stamp); a line without one belongs to the line above it, which is what a
  stack trace is. At a start, at every roll and once an hour, each rolled file
  loses every line from before 30 days ago, with the unstamped lines that
  belong to them, and a file with nothing left is deleted. So no line older
  than 30 days and an hour is ever on disk, and the files Roll-Log.ps1 left
  (server.log.1 to .5, weeks in each) are cut the same way on the first start.
  A file with no stamped line at all goes by its last write, or by when it
  was made if that is earlier (a copy Roll-Log.ps1 rolled holds weeks, from
  when it was made to its last write). A line stamped without the brackets,
  "2026-10-12 21:40:03 [thornswood] ...", the gamemode's, counts too.

  WHAT IS SAID. Each roll that deletes or cuts anything, and every failure, is
  a line in server.log itself, "[<time>] [server-log] ...", stamped like the
  engine's. A file that could not be cut or deleted is named with the error,
  and the next hourly pass is the next try (another program holding a file is
  the one failure here outside our control). A write that fails is said on
  stderr at once and in server.log as soon as a write works again, with how
  much was lost; the server is never stopped or slowed over its log.

  THE SERVER IS STILL WHAT THE TASK RUNS. Its exit code is this process's
  exit code, so call exit %^errorlevel% still hands it to the task. Started
  by start /high, this runs High, and the server is set to this process's own
  priority the moment it starts, because Windows starts a child of a High
  process at Normal (Install-ThornswoodServer.ps1, #2491). Node puts the child
  in a job that ends it when this process ends, so stopping either stops both
  (measured 12 Oct: the child was gone a second after its parent was killed).
  Measured the same day: 20,000 lines written by a child that then called
  process.exit all reached the parent, so the pipe loses nothing of a crash
  that cmd's file did not.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const KEEP_DAYS = 30;
const ALSO_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 4 * 1024 * 1024;
const SWEEP_MS = 60 * 60 * 1000;
const HEAD_BYTES = 64 * 1024;
const STAMP = /^\[?(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/;

function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function stampOf(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
    pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.' + pad(d.getMilliseconds(), 3);
}
function dayKey(t) { const d = new Date(t); return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(); }
function lineTime(text) {
  const m = STAMP.exec(text);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
}

// Every rolled copy beside the log: server.log.<digits>, the numbered ones
// Roll-Log.ps1 made as well as the dated ones made here.
function rolledFiles(log) {
  const dir = path.dirname(log), base = path.basename(log);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return []; }
  return names.filter((n) => n.length > base.length + 1 && n.slice(0, base.length + 1).toLowerCase() === (base + '.').toLowerCase() &&
    /^\d+$/.test(n.slice(base.length + 1))).map((n) => path.join(dir, n));
}

function rolledName(log, at) {
  const d = new Date(at);
  const s = '' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) +
    pad(d.getSeconds()) + pad(d.getMilliseconds(), 3);
  let name = log + '.' + s, n = 0;
  while (fs.existsSync(name)) { n++; name = log + '.' + s + n; }
  return name;
}

// The time of the first stamped line in a buffer, or null.
function firstStamp(buf) {
  let at = 0;
  while (at < buf.length) {
    const t = lineTime(buf.toString('latin1', at, Math.min(buf.length, at + 24)));
    if (t !== null) return t;
    const nl = buf.indexOf(10, at);
    if (nl < 0) break;
    at = nl + 1;
  }
  return null;
}

function readHead(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(HEAD_BYTES);
    const n = fs.readSync(fd, buf, 0, HEAD_BYTES, 0);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

/*
  One rolled file brought inside the window. Returns what happened:
  'kept', 'cut' or 'deleted'. Throws on a file it could not change, and the
  caller says so.
*/
function trimFile(file, cutoff) {
  const st = fs.statSync(file);
  const head = readHead(file);
  const first = firstStamp(head);
  if (first !== null && first >= cutoff) return 'kept';
  const buf = (head.length < HEAD_BYTES) ? head : fs.readFileSync(file);
  let at = 0, cut = -1, stamped = false;
  while (at < buf.length) {
    const t = lineTime(buf.toString('latin1', at, Math.min(buf.length, at + 24)));
    if (t !== null) {
      stamped = true;
      if (t >= cutoff) { cut = at; break; }
    }
    const nl = buf.indexOf(10, at);
    if (nl < 0) break;
    at = nl + 1;
  }
  if (!stamped) {
    const made = st.birthtimeMs > 0 ? Math.min(st.birthtimeMs, st.mtimeMs) : st.mtimeMs;
    if (made >= cutoff) return 'kept';
    fs.unlinkSync(file);
    return 'deleted';
  }
  if (cut < 0) { fs.unlinkSync(file); return 'deleted'; }
  if (cut === 0) return 'kept';
  const tmp = file + '.cut-' + process.pid;
  try {
    fs.writeFileSync(tmp, buf.subarray(cut));
    fs.utimesSync(tmp, st.atime, st.mtime);
    fs.renameSync(tmp, file);
  } catch (e) {
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); } catch (e2) { e.message += '; and its part copy ' + path.basename(tmp) + ' is left: ' + e2.code; }
    }
    throw e;
  }
  return 'cut';
}

// Every rolled file brought inside the window. Returns the lines to say.
function sweep(log, now, days) {
  const keepDays = days || KEEP_DAYS;
  const cutoff = now - keepDays * DAY_MS;
  const said = [];
  let deleted = 0, cut = 0;
  for (const f of rolledFiles(log)) {
    try {
      const r = trimFile(f, cutoff);
      if (r === 'deleted') deleted++;
      if (r === 'cut') cut++;
    } catch (e) {
      said.push('could not take the lines older than ' + keepDays + ' days out of ' + path.basename(f) +
        ': ' + e.message + '. The next pass, within the hour, tries it again.');
    }
  }
  if (deleted || cut) {
    said.unshift('older than ' + keepDays + ' days: ' + deleted + ' rolled log' + (deleted === 1 ? '' : 's') + ' deleted, ' +
      cut + ' cut to the last ' + keepDays + ' days');
  }
  return said;
}

// Moves the live log aside. Returns the rolled name, or null for nothing to roll.
function rollFile(log, now) {
  let st;
  try { st = fs.statSync(log); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  if (!st.size) return null;
  const to = rolledName(log, now);
  fs.renameSync(log, to);
  return to;
}

/*
  Another log kept to its days (--also, #2166): moved aside once its first
  line is from an earlier day, then every rolled copy of it cut to the
  window. The program that writes it opens it for each line, as the
  gamemode does, so a rename here is never held up by it, and its next line
  starts a new file. Returns the lines to say.
*/
function ageAlso(file, now, days) {
  const said = [];
  try {
    const st = fs.statSync(file);
    if (st.size) {
      let first = null;
      try { first = firstStamp(readHead(file)); } catch (e) { first = null; }
      if (dayKey(first === null ? st.mtimeMs : first) !== dayKey(now)) {
        const to = rollFile(file, now);
        if (to) said.push('rolled ' + path.basename(file) + ' to ' + path.basename(to) + ', its first line being from an earlier day');
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') said.push('could not roll ' + path.basename(file) + ': ' + (e.code || e.message) + '. The next pass, within the hour, tries it again.');
  }
  return said.concat(sweep(file, now, days).map((l) => path.basename(file) + ': ' + l));
}
function ageAlsos(o, now) {
  let said = [];
  for (const f of o.also) said = said.concat(ageAlso(f, now, o.alsoDays));
  return said;
}

// Whether the server.log found at a start is appended to (today's, under the
// size) or rolled first.
function rollAtStart(log, now) {
  let st;
  try { st = fs.statSync(log); } catch (e) { return false; }
  if (!st.size) return false;
  if (st.size >= MAX_BYTES) return true;
  const first = firstStamp(readHead(log));
  const t = first === null ? st.mtimeMs : first;
  return dayKey(t) !== dayKey(now);
}

function parseArgs(argv) {
  const o = { log: path.resolve('server.log'), roll: false, program: [], days: KEEP_DAYS, stamp: false, also: [], alsoDays: ALSO_DAYS };
  const days = (v, was) => { const n = Number(v); return n > 0 ? n : was; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!o.program.length && a === '--log') { o.log = path.resolve(argv[++i] || 'server.log'); continue; }
    if (!o.program.length && a === '--roll') { o.roll = true; continue; }
    if (!o.program.length && a === '--days') { o.days = days(argv[++i], o.days); continue; }
    if (!o.program.length && a === '--stamp') { o.stamp = true; continue; }
    if (!o.program.length && a === '--also') { if (argv[i + 1]) o.also.push(path.resolve(argv[++i])); continue; }
    if (!o.program.length && a === '--also-days') { o.alsoDays = days(argv[++i], o.alsoDays); continue; }
    o.program.push(a);
  }
  return o;
}

// --roll: an install's roll. Whatever the size, so the run the install starts
// has a file of its own, and the 30 days applied. Says what it did and exits 0.
function rollNow(log, now, o) {
  o = o || { days: KEEP_DAYS, also: [], alsoDays: ALSO_DAYS };
  const out = [];
  try {
    const to = rollFile(log, now);
    out.push(to ? 'rolled ' + path.basename(log) + ' to ' + path.basename(to) : path.basename(log) + ' was empty or not there, nothing to roll');
  } catch (e) {
    out.push('could not roll ' + path.basename(log) + ': ' + (e.code || e.message) + '. It is appended to, and rolled at midnight.');
  }
  return out.concat(sweep(log, now, o.days), ageAlsos(o, now));
}

/*
  DELETION REQUESTS, TAKEN BEFORE THE PROGRAM STARTS (#2758).

  Patrick, 18 Oct 2026, after the first real deletion on his own account: "it
  should not restart everytime we want to delete a person it should just fully
  apply the rest upon a server restart". So scripts\vps\Delete-Person.ps1
  stops nothing. It writes the request into the folder of each service that
  holds something of the person's, and each service takes it out of its own
  files as it next starts. For the game server and voice that is here: this
  process starts them, so between its start and the program's nothing else
  has those files open, and a file changed now is never written back over.

  The game server (a server-settings.json in the folder it runs). Its list is
  private\deleted-characters.json (the privDir server-settings.json names),
  the list the gamemode's release block reads at its start (#2351):

      { "profiles": [ 5001 ], "actors": [ 4278192641 ], "done": { ... } }

  Its actors are runtime form ids, 0xff000000 | the local hex of a change
  form's formDesc (#2870); a list with an actor outside that range is the old
  shape and is left as it is, as one that is not a list is.

  Here is its part "saves": every change form of theirs in the engine's own
  folder (<databaseName, world>\changeForms, the files the engine loads at its
  start), their card (characters.json), their mod menu choices
  (mod-settings.json), their take counts (take-limit.json) and when they last
  left (last-left.json). The gamemode's blocks let go of the registers as they
  load, after this (game\gamemode.js, the release block). A part done is marked
  with the time in the taken list, deleted-characters.taken.json, which only
  this and the gamemode write (thornswoodTakeReleaseList, #4920); the one that
  finds every part done deletes it. deleted-characters.json itself, the
  requests, is only ever taken, never written.
  RELEASE_PARTS is the gamemode's PARTS, and tests\test-2758-start-deletions.js
  holds the two to the same list.

  An unfinished save (.pending-batch in changeForms) that holds one of their
  characters waits for the next start: the engine replays it as it starts,
  before anything could take it out, and writing it again without their
  character would mean writing the engine's own journal. Everything else of
  theirs goes now and the part waits, and the line says so. A batch that is
  not theirs is the engine's to replay and changes nothing here.

  Voice (deletion-requests.json in the folder it runs):

      { "people": [ { "discordId": "...", "profiles": [ 5001 ] } ],
        "kept": [ { "profile": 5001, "from": 99000, "to": 201000 } ] }

  Every chat line their characters wrote goes out of each day's file
  (THORNSWOOD_CHAT_DIR, or chat beside it, as voice-server.js reads it),
  except a line said inside a session staff marked kept (#2166), whose
  windows Delete-Person.ps1 read off the site. Then the list is deleted.

  A file that is there and will not parse, or a change that did not take,
  leaves the request where it is, for the next start, and is said. Each line
  here says counts and never a name, a Discord id, a profile id or a form id.
*/
// -- the release list, taken (#4920), begin --
/*
  THE LIST IS TAKEN, NEVER WRITTEN OVER (#4920). private\deleted-characters.json
  is the requests: Delete-Person.ps1 and Release-List.ps1 merge a new one in
  whenever they run, while the game server runs too. A server that wrote back
  the copy it had read, or deleted the file once that copy was done, put
  back or threw away a request merged in since, and nobody was told.

  So the server never writes that file. It takes it, with a rename, the one
  step no other write can come between: deleted-characters.json becomes
  deleted-characters.taking.json, which goes into deleted-characters.taken.json,
  the server's own, and is deleted. Only the server writes .taken (server-log.js
  before the engine starts, then the gamemode as it loads, never at once), and
  its marks and its deleting are there. A request merged in after the take
  lands in a new deleted-characters.json and is taken at the next start; one
  merged in before it is in what was taken.

  Taking it in: every id of both, and a part done only where it is done on
  both, so a part that ran for the ids already taken runs again for the new
  ones (running again for an id already let go finds nothing). A .taking left
  by a stop between the rename and the merge goes in first, and a new list is
  never renamed onto it.

  Answers { list, file, left }: list is what is taken (null for none) and
  file is .taken; left, when set, is a request file that could not be taken
  and is left where it is, for a person: { bad, file } for one that is not a
  list (bad is what it held, null when it would not parse), or { error, file }.
  A .taken that is not a list answers { bad, file } or { error, file } and no
  list, so nothing is let go. Server-Log.js carries this same text, and
  tests\test-4920-taken-list.js holds the two the same.
*/
function thornswoodTakeReleaseList(fs, path, priv, valid) {
  var LIST = path.join(priv, 'deleted-characters.json');
  var TAKING = path.join(priv, 'deleted-characters.taking.json');
  var TAKEN = path.join(priv, 'deleted-characters.taken.json');
  function why(e) { return (e && (e.code || e.message)) || String(e); }
  function load(p) {
    var text;
    try { text = fs.readFileSync(p, 'utf8'); }
    catch (e) {
      if (e && e.code === 'ENOENT') { return { none: true }; }
      return { error: why(e), file: p };
    }
    var v = null;
    try { v = JSON.parse(String(text).replace(/^\uFEFF/, '')); } catch (e) { v = null; }
    return valid(v) ? { list: v } : { bad: v, file: p };
  }
  function ids(a, b) {
    var seen = {}, out = [];
    (a || []).concat(b || []).forEach(function (n) { if (!seen[n]) { seen[n] = true; out.push(n); } });
    return out.sort(function (x, y) { return x - y; });
  }
  var left = null;
  var taking = load(TAKING);
  if (taking.none) {
    var asked = load(LIST);
    if (asked.list) {
      try { fs.renameSync(LIST, TAKING); taking = load(TAKING); }
      catch (e) { if (!(e && e.code === 'ENOENT')) { left = { error: why(e), file: LIST }; } }
    } else if (!asked.none) { left = asked; }
  }
  if (!taking.none && !taking.list) { left = taking; taking = { none: true }; }
  var taken = load(TAKEN);
  if (!taken.none && !taken.list) { return taken; }
  if (!taking.list) { return { list: taken.list || null, file: TAKEN, left: left }; }
  var was = taken.list || { profiles: [], actors: [], done: taking.list.done || {} };
  var a = was.done || {}, b = taking.list.done || {}, done = {};
  Object.keys(a).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(b, k)) { done[k] = Math.max(a[k], b[k]); }
  });
  var list = { profiles: ids(was.profiles, taking.list.profiles), actors: ids(was.actors, taking.list.actors), done: done };
  try {
    fs.writeFileSync(TAKEN + '.tmp', JSON.stringify(list));
    fs.renameSync(TAKEN + '.tmp', TAKEN);
  } catch (e) {
    return { error: why(e), file: TAKEN };
  }
  try { fs.unlinkSync(TAKING); }
  catch (e) { left = { error: why(e), file: TAKING }; }
  return { list: list, file: TAKEN, left: left };
}
// -- the release list, taken (#4920), end --
const RELEASE_PARTS = ['saves', 'farms', 'property', 'embassy', 'dungeon', 'cargo', 'stalls', 'carts', 'books', 'merchants'];

function startDeletions(dir, now) {
  const out = [];
  const say = (m) => out.push('deletions: ' + m);
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // undefined for a file that is not there, null for one that will not
  // parse or be read (said), the value otherwise, its text kept for writeJson.
  const texts = new Map();
  function readJson(p) {
    let t;
    try { t = fs.readFileSync(p, 'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return undefined; say(path.basename(p) + ' could not be read (' + e.code + ')'); return null; }
    texts.set(p, t);
    try { return JSON.parse(t.replace(/^\uFEFF/, '')); }
    catch (e) { say(path.basename(p) + ' will not parse'); return null; }
  }
  function writeFile(p, body) {
    const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.deletions.tmp');
    try { fs.writeFileSync(tmp, body, 'utf8'); fs.renameSync(tmp, p); return true; }
    catch (e) {
      say(path.basename(p) + ' could not be written (' + (e.code || e.message) + ')');
      if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch (e2) { say(path.basename(tmp) + ' is left behind (' + (e2.code || e2.message) + ')'); } }
      return false;
    }
  }
  // A JSON file back the shape it came in: indented if it was, its last line ending kept.
  function writeJson(p, v) {
    const was = texts.get(p) || '';
    const indent = /^[\[{]\s*\r?\n/.test(was) ? 2 : 0;
    return writeFile(p, JSON.stringify(v, null, indent || undefined) + (/\n$/.test(was) ? '\n' : ''));
  }
  const ids = (a) => Array.isArray(a) && a.every((n) => Number.isSafeInteger(n) && n > 0);
  // One shape for a character's form id (#2870); game\form-id.js is the
  // original and tests\test-2870-form-id-shape.js keeps this copy the same.
  function isFormId(n) {
    return Number.isSafeInteger(n) && n > 0xff000000 && n <= 0xffffffff;
  }
  const counts = {};
  const count = (k, n) => { if (n) counts[k] = (counts[k] || 0) + n; };
  const said = () => Object.keys(counts).map((k) => k + ' ' + counts[k]).join(', ') || 'nothing of theirs';

  // ---- the game server
  const settings = readJson(path.join(dir, 'server-settings.json'));
  if (isObj(settings)) {
    const priv = path.join(dir, settings.privDir ? String(settings.privDir) : 'private');
    const validList = (l) => isObj(l) && ids(l.profiles) && (l.actors === undefined || (Array.isArray(l.actors) && l.actors.every(isFormId))) &&
      (l.done === undefined || (isObj(l.done) && Object.keys(l.done).every((k) => Number.isSafeInteger(l.done[k]) && l.done[k] > 0)));
    // Taken, never written over (thornswoodTakeReleaseList, above, #4920).
    const got = thornswoodTakeReleaseList(fs, path, priv, validList);
    if (got.left) {
      say(path.basename(got.left.file) + (got.left.error
        ? ' could not be taken (' + got.left.error + '), so the requests in it wait for the next start'
        : ' is not a list of deleted characters, so ' + (got.list ? 'the requests in it were not taken,' : 'nothing was removed') + ' and it is left as it is'));
    }
    const listFile = got.file;
    const list = got.error || got.bad !== undefined ? null : (got.list || undefined);
    if (got.error) {
      say(path.basename(listFile) + ' could not be read or written (' + got.error + '), so nothing was removed');
    } else if (list === null) {
      say(path.basename(listFile) + ' is not a list of deleted characters, so nothing was removed and it is left as it is');
    } else if (list !== undefined && !(isObj(list.done) && has(list.done, 'saves'))) {
      const P = new Set(list.profiles);
      const mine = (v) => P.has(Number(v));
      let whole = true;
      if (settings.databaseDriver && settings.databaseDriver !== 'file') {
        say('the saves are in ' + settings.databaseDriver + ', not in files, so their characters were not removed and the part waits');
        whole = false;
      } else {
        const forms = path.join(dir, settings.databaseName ? String(settings.databaseName) : 'world', 'changeForms');
        const batchFile = path.join(forms, '.pending-batch');
        if (fs.existsSync(batchFile)) {
          let theirs = true;
          try {
            const j = JSON.parse(fs.readFileSync(batchFile, 'utf8'));
            theirs = !Array.isArray(j.batch) || j.batch.some((e) => {
              try { return mine(JSON.parse(e.json).profileId); } catch (e2) { return true; }
            });
          } catch (e) { theirs = true; }
          if (theirs) {
            say('an unfinished save in ' + path.relative(dir, forms) + ' holds one of their characters, or could not be read; the server replays it as it starts, so their characters go at the next start');
            whole = false;
          }
        }
        let names = [];
        try { names = fs.readdirSync(forms); }
        catch (e) { if (e.code !== 'ENOENT') { say(path.relative(dir, forms) + ' could not be listed (' + e.code + ')'); whole = false; } }
        for (const n of names) {
          if (!/\.json$/i.test(n) || n[0] === '.') continue;
          const p = path.join(forms, n);
          let o;
          try { o = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '')); }
          catch (e) { count('change forms that would not parse, so were not read', 1); continue; }
          if (!isObj(o) || !(Number(o.profileId) > 0) || !mine(o.profileId)) continue;
          try { fs.unlinkSync(p); count('characters', 1); }
          catch (e) { say('a change form could not be deleted (' + e.code + ')'); whole = false; }
        }
      }
      // Each file keyed by profile, in its own shape.
      const keyed = [
        ['characters.json', 'cards', (v) => isObj(v.who) ? [v.who, (k) => mine(k)] : null],
        ['mod-settings.json', 'mod menu choices', (v) => isObj(v.who) ? [v.who, (k) => mine(k)] : null],
        ['take-limit.json', 'take counts', (v) => isObj(v.counts) ? [v.counts, (k) => mine(k.split('|')[0])] : null],
        ['last-left.json', 'last-left times', (v) => [v, (k) => mine(k)]]
      ];
      for (const [f, label, pick] of keyed) {
        const p = path.join(priv, f);
        const v = readJson(p);
        if (v === undefined) continue;
        if (!isObj(v)) { if (v !== null) say(f + ' is not the shape it should be'); whole = false; continue; }
        const at = pick(v);
        if (!at) continue;
        let n = 0;
        for (const k of Object.keys(at[0])) if (at[1](k)) { delete at[0][k]; n++; }
        if (!n) continue;
        if (writeJson(p, v)) count(label, n);
        else whole = false;
      }
      if (whole) {
        const done = Object.assign({}, isObj(list.done) ? list.done : {}, { saves: now });
        if (RELEASE_PARTS.every((k) => has(done, k))) {
          try { fs.unlinkSync(listFile); say('saves: ' + said() + '; every part is done, and the list is gone'); }
          catch (e) { say('saves: ' + said() + '; the list could not be deleted (' + e.code + ')'); }
        } else if (writeFile(listFile, JSON.stringify({ profiles: list.profiles, actors: list.actors || [], done }))) {
          say('saves: ' + said() + '; the gamemode lets go of the registers as it loads');
        } else {
          say('saves: ' + said() + '; the list could not be marked, so this part runs again at the next start');
        }
      } else {
        say('saves: ' + said() + '; the part waits for the next start');
      }
    }
  }

  // ---- voice
  const voiceFile = path.join(dir, 'deletion-requests.json');
  const req = readJson(voiceFile);
  if (req !== undefined) {
    const okReq = isObj(req) && Array.isArray(req.people) && req.people.every((x) => isObj(x) && ids(x.profiles)) &&
      (req.kept === undefined || (Array.isArray(req.kept) && req.kept.every((w) => isObj(w) && Number.isFinite(w.profile) && Number.isFinite(w.from) && Number.isFinite(w.to))));
    if (!okReq) {
      say(path.basename(voiceFile) + ' is not a list of deletion requests, so nothing was removed and it is left as it is');
    } else {
      const P = new Set();
      for (const x of req.people) for (const n of x.profiles) P.add(n);
      const kept = req.kept || [];
      const chat = process.env.THORNSWOOD_CHAT_DIR || path.join(dir, 'chat');
      let whole = true, inKept = 0;
      let names = [];
      try { names = fs.readdirSync(chat).sort(); }
      catch (e) { if (e.code !== 'ENOENT') { say('the chat folder could not be listed (' + e.code + ')'); whole = false; } }
      for (const n of names) {
        if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)) continue;
        const p = path.join(chat, n);
        let raw;
        try { raw = fs.readFileSync(p, 'utf8'); } catch (e) { say(n + ' could not be read (' + e.code + ')'); whole = false; continue; }
        const lines = raw.split('\n');
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        const keep = lines.filter((line) => {
          let o = null;
          try { o = JSON.parse(line); } catch (e) { return true; }
          if (!isObj(o) || !P.has(Number(o.profileId))) return true;
          const at = Number(o.at) || 0;
          if (kept.some((w) => w.profile === Number(o.profileId) && at >= w.from && at <= w.to)) { inKept++; return true; }
          return false;
        });
        if (keep.length === lines.length) continue;
        if (writeFile(p, keep.length ? keep.join('\n') + '\n' : '')) { count('chat lines', lines.length - keep.length); count('days edited', 1); }
        else whole = false;
      }
      count('chat lines kept with a session staff marked kept', inKept);
      if (whole) {
        try { fs.unlinkSync(voiceFile); say('chat: ' + said() + '; the request is done, and gone'); }
        catch (e) { say('chat: ' + said() + '; the request could not be deleted (' + e.code + '), so it runs again at the next start'); }
      } else {
        say('chat: ' + said() + '; the request waits for the next start');
      }
    }
  }
  return out;
}

/*
  COPIES SET ASIDE BESIDE A GAME SERVER GO AFTER ASIDE_DAYS (#3620).

  A wipe (Wipe-Saves.ps1), a restore (Restore-Server.ps1), a character reset
  (Reset-Character.ps1) and an appearance reset (Reset-Appearance.ps1) each
  move or copy the characters they replace aside inside the server's own
  folder, so the step can be undone, and nothing ever deleted them. Those
  copies hold every character, the book chat and the registers, while the
  privacy page said a character is kept until a wipe. So this deletes each
  one ASIDE_DAYS after it was set aside, at the start and once an hour, by
  the time in its name (the step writes it, local time, yyyyMMdd-HHmmss),
  never by a file's own times, which a move keeps from the original:

      <root>\world-before-<stamp>                     a wipe's world
      <root>\world-before-restore-<stamp>             a restore's world and private
      <root>\<privDir>\<name>-before-<stamp>.json     a wipe's registers and cards
      <root>\<privDir>\<name>-before-<stamp>          a wipe's other marks
      <root>\<world>\changeForms\_discarded-<stamp>   a character reset's forms
      <root>\<world>\changeForms\<id>.json.bak-<stamp>  an appearance reset's copy

  Only a game server's folder (a server-settings.json in it), only those
  names, and only directly where each step puts them. A link is left as it is
  and said, because deleting through one can reach whatever it points at. A
  copy that will not go is named with the error, and the next hourly pass is
  the next try. Each line names the copy and when it was set aside, never
  what is in it.
*/
const ASIDE_DAYS = 30;
function asideAt(stamp) {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp);
  if (!m) return null;
  const t = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
  return Number.isFinite(t) ? t : null;
}
function ageAside(dir, now, days) {
  const out = [];
  let settings;
  try { settings = JSON.parse(fs.readFileSync(path.join(dir, 'server-settings.json'), 'utf8').replace(/^﻿/, '')); }
  catch (e) { return out; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return out;
  const world = settings.databaseName ? String(settings.databaseName) : 'world';
  const places = [
    [dir, /^world-before-(?:restore-)?(\d{8}-\d{6})$/, true],
    [path.join(dir, settings.privDir ? String(settings.privDir) : 'private'), /^.+-before-(\d{8}-\d{6})(?:\.json)?$/, false],
    [path.join(dir, world, 'changeForms'), /^_discarded-(\d{8}-\d{6})$/, true],
    [path.join(dir, world, 'changeForms'), /^.+\.json\.bak-(\d{8}-\d{6})$/, false]
  ];
  const cut = now - (days || ASIDE_DAYS) * DAY_MS;
  for (const [where, rule, folder] of places) {
    let names = [];
    try { names = fs.readdirSync(where); }
    catch (e) { if (e.code !== 'ENOENT') out.push('set-aside copies: could not list ' + path.relative(dir, where) + ': ' + (e.code || e.message)); continue; }
    for (const n of names) {
      const m = rule.exec(n);
      if (!m) continue;
      const at = asideAt(m[1]);
      if (at === null || at >= cut) continue;
      const p = path.join(where, n);
      const rel = path.relative(dir, p);
      let st;
      try { st = fs.lstatSync(p); } catch (e) { out.push('set-aside copies: could not look at ' + rel + ': ' + (e.code || e.message)); continue; }
      if (st.isSymbolicLink()) { out.push('set-aside copies: left ' + rel + ': it is a link'); continue; }
      if (st.isDirectory() !== folder) continue;
      try {
        fs.rmSync(p, { recursive: folder, force: false });
        out.push('set-aside copies: deleted ' + rel + ', set aside ' + stampOf(new Date(at)).slice(0, 10) +
          ', more than ' + (days || ASIDE_DAYS) + ' days ago');
      } catch (e) {
        out.push('set-aside copies: COULD NOT DELETE ' + rel + ', set aside ' + stampOf(new Date(at)).slice(0, 10) +
          ': ' + (e.code || e.message) + '. It is tried again in an hour.');
      }
    }
  }
  return out;
}

function run(o) {
  const log = o.log;
  const state = { fd: null, bytes: 0, day: 0, atLineStart: true, rollAfter: 0, lost: 0, lostSince: 0, lostWhy: '' };
  const pending = [];
  const sayLine = (msg) => Buffer.from('[' + stampOf(new Date()) + '] [server-log] ' + msg + '\n');

  // The day a file belongs to is the day of its first line, so one that
  // could not be rolled stays due until it is, whoever opens it again.
  function open(now) {
    state.fd = fs.openSync(log, 'a');
    const st = fs.fstatSync(state.fd);
    state.bytes = st.size;
    let first = null;
    if (st.size) { try { first = firstStamp(readHead(log)); } catch (e) { first = null; } }
    state.day = dayKey(first !== null ? first : (st.size ? st.mtimeMs : now));
    state.atLineStart = true;
  }
  function raw(buf) {
    if (state.fd === null) {
      try { open(Date.now()); } catch (e) { lose(buf, e); return; }
    }
    try {
      fs.writeSync(state.fd, buf);
      state.bytes += buf.length;
      state.atLineStart = buf.length ? buf[buf.length - 1] === 10 : state.atLineStart;
    } catch (e) { lose(buf, e); return; }
    if (state.lost) {
      const lost = state.lost, since = state.lostSince, why = state.lostWhy;
      state.lost = 0;
      raw(sayLine(lost + ' bytes of the server\'s output could not be written here from ' + stampOf(new Date(since)) +
        ' until now: ' + why));
    }
  }
  function lose(buf, e) {
    if (!state.lost) {
      state.lostSince = Date.now();
      state.lostWhy = e.code || e.message;
      process.stderr.write('[server-log] could not write ' + log + ': ' + state.lostWhy + '\n');
    }
    state.lost += buf.length;
    // The handle that failed is let go so the next write opens the file
    // afresh; a handle that will not even close has nothing more to say.
    if (state.fd !== null) { try { fs.closeSync(state.fd); } catch (e2) { state.lostWhy += ', and its handle would not close: ' + e2.code; } state.fd = null; }
  }
  function say(msg) { raw(sayLine(msg)); }

  function due(now) {
    return now >= state.rollAfter && (dayKey(now) !== state.day || state.bytes >= MAX_BYTES);
  }
  function roll(now) {
    const lines = [];
    if (state.fd !== null) {
      try { fs.closeSync(state.fd); }
      catch (e) { lines.push('could not let go of ' + path.basename(log) + ' to roll it: ' + (e.code || e.message)); }
      state.fd = null;
    }
    const wasDay = state.day;
    let rolled = true;
    try { rollFile(log, now); } catch (e) {
      // Another program holding server.log without letting it be renamed
      // (Get-Content over ssh does): outside our control, so it is said and
      // tried again a minute later, writing on in the same file meanwhile.
      rolled = false;
      state.rollAfter = now + 60 * 1000;
      lines.push('could not roll ' + path.basename(log) + ': ' + (e.code || e.message) +
        '. Something else has it open; writing on in it, and trying again in a minute.');
    }
    try { open(now); } catch (e) { lose(Buffer.alloc(0), e); }
    // Not rolled, it is still the earlier day's file, so the roll stays due
    // (the size is counted from the file itself either way).
    if (!rolled) state.day = wasDay;
    for (const l of lines.concat(sweep(log, now, o.days), ageAlsos(o, now))) say(l);
  }
  // --stamp: this process's time in front of every line, for a program whose
  // lines carry none, so each can be aged (#2166).
  function stamped(buf) {
    if (!o.stamp || !buf.length) return buf;
    const parts = [];
    let at = 0, lineStart = state.atLineStart;
    while (at < buf.length) {
      if (lineStart) parts.push(Buffer.from('[' + stampOf(new Date()) + '] '));
      const nl = buf.indexOf(10, at);
      const end = nl < 0 ? buf.length : nl + 1;
      parts.push(buf.subarray(at, end));
      lineStart = nl >= 0;
      at = end;
    }
    return Buffer.concat(parts);
  }
  function write(buf) {
    buf = stamped(buf);
    const now = Date.now();
    if (due(now)) {
      if (state.atLineStart) { roll(now); }
      else {
        const nl = buf.indexOf(10);
        if (nl >= 0) { raw(buf.subarray(0, nl + 1)); roll(now); buf = buf.subarray(nl + 1); }
      }
    }
    if (buf.length) raw(buf);
  }

  // The start: the files Roll-Log.ps1 or an earlier run left cut to the
  // window, then today's server.log appended to or a new one begun.
  const now = Date.now();
  if (rollAtStart(log, now)) {
    try { rollFile(log, now); } catch (e) {
      pending.push('could not roll ' + path.basename(log) + ' at start: ' + (e.code || e.message) +
        '. Something else has it open; writing on in it, and trying again with the next line, then once a minute.');
    }
  }
  pending.push(...sweep(log, now, o.days), ...ageAlsos(o, now));
  try { open(now); } catch (e) { lose(Buffer.alloc(0), e); }
  for (const l of pending) say(l);
  // Before the program, so nothing of theirs is open when it goes (#2758).
  for (const l of startDeletions(process.cwd(), now)) say(l);
  for (const l of ageAside(process.cwd(), now)) say(l);

  if (!o.program.length) {
    say('nothing to run: server-log.js was started with no program after its own switches');
    process.exit(2);
  }

  const child = cp.spawn(process.execPath, o.program, { cwd: process.cwd(), stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true });
  if (child.pid) {
    try { os.setPriority(child.pid, os.getPriority()); }
    catch (e) { say('could not give the server this process\'s priority: ' + (e.code || e.message)); }
  }
  child.stdout.on('data', write);
  child.stderr.on('data', write);
  const tick = setInterval(() => {
    const t = Date.now();
    if (due(t) && state.atLineStart) roll(t);
    else for (const l of sweep(log, t, o.days).concat(ageAlsos(o, t))) say(l);
    for (const l of ageAside(process.cwd(), t)) say(l);
  }, SWEEP_MS);
  child.on('error', (e) => {
    say('could not start ' + o.program.join(' ') + ': ' + (e.code || e.message));
    clearInterval(tick);
    process.exit(1);
  });
  child.on('close', (code, signal) => {
    clearInterval(tick);
    if (!state.atLineStart) raw(Buffer.from('\n'));
    say('the server ended, ' + (signal ? 'stopped by ' + signal : 'exit code ' + code));
    process.exit(code === null ? 1 : code);
  });
}

if (require.main === module) {
  const o = parseArgs(process.argv.slice(2));
  if (o.roll) {
    for (const l of rollNow(o.log, Date.now(), o)) console.log(l);
    process.exit(0);
  }
  run(o);
} else {
  module.exports = { KEEP_DAYS, ALSO_DAYS, MAX_BYTES, rolledFiles, trimFile, sweep, rollFile, rollAtStart, rollNow, lineTime, parseArgs, ageAlso, startDeletions, RELEASE_PARTS, ASIDE_DAYS, ageAside };
}
