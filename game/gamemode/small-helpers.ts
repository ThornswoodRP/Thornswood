// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/*
  Thornswood's own lines, in a file of their own.

  Of 6,617 lines in one day's server.log, 951 were "Script not found in the
  script storage", 785 were "GetBaseActorValues Negative Magicka/Health/
  Stamina" for eight NPC base forms, and 3,412 were "Skipping non-Sweet
  scripts". That is 78 percent of the log, none of it ours and none of it
  actionable, and every real finding had to be dug out from under it.

  So every line this file writes goes to the console as before, and also to
  thornswood.log, which holds nothing else. Nothing is filtered out of
  server.log: the engine's noise is still there for anybody who wants it, it
  is just no longer the only place our own lines live.

  Beside server.log in the server's own folder, deliberately NOT under data.
  The resources server hands out anything under data over plain HTTP to
  anybody who asks, which is right for online.json and the plugin files and
  wrong for a log of who was standing where.

  Opened lazily and given up on for good the first time a write fails, because
  a log that throws once a tick is worse than no log.

  ROLLED AT 4 MB, FIVE KEPT, entry 220, the same rule as the site's site.log.
  Nothing rolled this file, so it grew until reading last night's crash meant
  opening a file nothing could open. appendFileSync opens, writes and closes
  on every line, so between lines this process holds nothing and a rename
  works. server.log is different: server-log.js beside the server writes it
  and rolls it at midnight and at 4 MB, keeping nothing past 30 days (#2349).
  The size is
  read once per load and counted after that, so a busy tick does not ask the
  disk about the file for every line.
*/
let logFile = null;
let logBroken = false;
const LOG_MAX_BYTES = 4 * 1024 * 1024;
const LOG_KEEP = 5;
let logBytes = -1;
let logStateSaid = false;

// Oldest first, so nothing is overwritten on the way: .5 goes, .4 becomes .5,
// and the live file becomes .1. Rolled, never deleted: deleting a log is how
// the evidence for the last crash disappeared in the first place.
function rollLog(where) {
  const fs = require('fs');
  try {
    const oldest = where + '.' + LOG_KEEP;
    if (fs.existsSync(oldest)) { fs.unlinkSync(oldest); }
    for (let i = LOG_KEEP - 1; i >= 1; i--) {
      if (fs.existsSync(where + '.' + i)) { fs.renameSync(where + '.' + i, where + '.' + (i + 1)); }
    }
    if (fs.existsSync(where)) { fs.renameSync(where, where + '.1'); }
    return true;
  } catch (e) { return false; }
}

/*
  WHETHER THIS LOG IS WORKING, where it can be read from outside.

  The give-up below used to be one line on the console, which lands in
  server.log among four fifths engine noise, and nothing else, so a server
  that had stopped writing thornswood.log looked exactly like a quiet one. The
  entry asks for the give-up to "set a state the health or manifest route
  reports, so a server logging nothing is visible from outside".

  So it goes in thornswood-log.json in the data folder, which the resources
  server hands out over plain HTTP: /thornswood-log.json on 3000 for live and
  7788 for dev, readable with no ssh. It says whether the log works and, when
  it does not, why, and nothing about anybody. Written when the first line of
  a load lands, so a restart that fixed it says so, and once when it breaks.

  Written whole with the engine's mp.writeFileWhole (#2740), never in place:
  the port may be handing the file out at that moment. A write that fails
  goes to the console, the one place left when this log is the thing broken.
*/
function sayLogState(state) {
  let where = 'thornswood-log.json';
  try {
    const fs = require('fs');
    const path = require('path');
    let dataDir = 'data';
    try {
      const cfg = JSON.parse(fs.readFileSync('server-settings.json', 'utf8'));
      if (cfg && cfg.dataDir) { dataDir = String(cfg.dataDir); }
    } catch (e) { }
    state.at = Date.now();
    where = path.join(dataDir, 'thornswood-log.json');
    mp.writeFileWhole(where, JSON.stringify(state));
  } catch (e) {
    console.log('[thornswood] could not write ' + where + ': ' + (e && e.message ? e.message : e));
  }
}

function logPath() {
  if (logFile !== null || logBroken) { return logFile; }
  // The working directory is the server's own folder: it is where
  // server-settings.json is read from and where server.log is written.
  logFile = 'thornswood.log';
  return logFile;
}

function stamp() {
  const d = new Date();
  const two = (n) => (n < 10 ? '0' + n : String(n));
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
         ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
}

function log() {
  const args = Array.prototype.slice.call(arguments);
  const line = '[thornswood] ' + args.join(' ');
  console.log(line);
  if (logBroken) { return; }
  const where = logPath();
  if (!where) { return; }
  try {
    const fs = require('fs');
    const text = stamp() + ' ' + line + '\n';
    if (logBytes < 0) {
      try { logBytes = fs.statSync(where).size; } catch (e) { logBytes = 0; }
    }
    if (logBytes >= LOG_MAX_BYTES) {
      // A roll refused because something is reading the file right then is
      // tried again a little later, not on every line until it lets go.
      logBytes = rollLog(where) ? 0 : LOG_MAX_BYTES - 256 * 1024;
    }
    fs.appendFileSync(where, text);
    logBytes += Buffer.byteLength(text);
    if (!logStateSaid) {
      logStateSaid = true;
      sayLogState({ ok: true });
    }
  } catch (e) {
    // Once. A log that throws every tick is worse than no log.
    logBroken = true;
    console.log('[thornswood] could not write thornswood.log, carrying on ' +
                'with the console only, and saying so at /thornswood-log.json: ' + e);
    sayLogState({ ok: false, why: String((e && (e.code || e.message)) || e) });
  }
}

/*
  Which gamemode.js this is.

  From the To Do List, entry 254: "A version and commit logged at load." Until
  this, nothing the server wrote said which gamemode.js it was running.
  Check-LiveGamemode.ps1 can say over ssh whether the file up there matches
  the repo right now, but a line in last night's thornswood.log could not be
  tied to any commit, and 28 commits changed this file on 23 September alone.

  So at load the file names itself the way git names it: SHA-1 over
  "blob <length>", a NUL, and the bytes. That is the id
      git hash-object tools\gamemode.js
  prints on the machine that shipped it, and
      git log --all --oneline --find-object=<id>
  names the commit that made gamemode.js exactly this file. Nothing is stamped
  into the file at deploy time instead: Check-LiveGamemode.ps1 compares the two
  copies byte for byte and a stamp would make them differ, and a file cannot
  hold the id of the commit it is in.

  The bytes are read from __filename. requireTemp() in skymp5-server copies
  gamemode.js to a temp file, requires that, and deletes it afterwards, so this
  hashes the text that is actually loading, even if gamemode.js on disk is
  replaced a moment later. The copy goes through a string, and gives back the
  same bytes because the file is valid UTF-8.

  A carriage return before a line feed is dropped before hashing, which is what
  git does to this file on the way in when core.autocrlf is on, as it is on the
  machine that ships. Measured on 24 September, before this block went in: the
  checkout had 22,774 CRLF line ends in 2,147,089 bytes, and those bytes hashed
  as they are give an id no git command knows. Without the carriage returns it
  is 2,124,315 bytes and the id git hash-object printed. The size logged is the
  one on disk, the number Check-LiveGamemode.ps1 prints for both ends.

  Once per load, so a hot reload logs the new id. Anything that goes wrong is
  logged and the load carries on: the server runs the same without this line.
*/
function gamemodeId(bytes) {
  const lf = Buffer.alloc(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 13 && bytes[i + 1] === 10) { continue; }
    lf[n++] = bytes[i];
  }
  const sha = require('crypto').createHash('sha1');
  sha.update('blob ' + n + '\0');
  sha.update(lf.subarray(0, n));
  return { blob: sha.digest('hex'), size: bytes.length };
}

try {
  const me = gamemodeId(require('fs').readFileSync(__filename));
  log('gamemode.js is git blob ' + me.blob + ', ' + me.size + ' bytes');
} catch (e) {
  log('could not name this gamemode.js: ' + e);
}
try {
  const t = tableFolder();
  log('gamemode tables are git tree ' + t.tree + ', ' + t.count + ' files, in ' + t.dir);
} catch (e) {
  log('could not name the gamemode tables: ' + e);
}

/*
  Which voice service this server talks to.

  It used to be the number 7778 written out in five places, which was fine
  while there was one server and became wrong the day there were two: the dev
  server shipped the same file, so it pushed its positions over the live ones
  and its GET /commands and GET /choices drained the live queues. A live
  person's slash command could be collected and run by the dev server, and
  their character creation choice could be eaten before the live server asked
  for it.

  It stays out of the client's reach. The comment on the voice feed below says
  nobody can move their own voice by editing a file and that is still true:
  this is server-settings.json in the server's own folder on the VPS, which
  only whoever runs the server can write, not anything a person has on their
  machine.

  Read once and kept. The file does not change under a running server, and a
  readFileSync five times a second for a number that cannot move is a waste.
*/
let voicePortCached = 0;
function voicePort() {
  if (voicePortCached) { return voicePortCached; }
  let n = 0;
  let fallback = 7778;
  try {
    const cfg = JSON.parse(require('fs').readFileSync('server-settings.json', 'utf8'));
    if (cfg.thornswoodServer === 'dev') { fallback = 7789; }
    n = Number(cfg.thornswoodVoicePort) || 0;
  } catch (e) {
    n = 0;
  }
  // Keep Dev traffic on Dev even when its configured port is invalid. Without
  // an explicit Dev identity, retain the existing live-port default.
  voicePortCached = (Number.isInteger(n) && n > 0 && n < 65536) ? n : fallback;
  if (voicePortCached !== 7778) {
    log('voice service port is ' + voicePortCached + ', from server-settings.json');
  }
  return voicePortCached;
}

/** Run fn, swallow and report anything it throws. Handlers must never escape. */
function guard(name, fn) {
  /*
    WHO DOES WHAT IN EACH ENGINE EVENT, for the join pass (#410). With
    thornswoodRequirePass on, a session that has not shown its launcher's pass
    is in the world under a profile number it picked itself, so nothing it
    does may count yet: every event below raised by it is refused (false
    blocks the engine's own handling, the same as every refusal in this file)
    until the pass arrives, and the join pass block ends the session if it
    never does. The number is the argument that is the person acting; the
    others are the thing acted on. onDeath and onRespawn are not a person
    acting and are left. Inside guard() so it goes wherever guard() does.
  */
  const ACTS_AS = { onActivate: 1, onCraft: 0, onCraftWork: 0, onReadBook: 0, onPutItem: 1, onTakeItem: 1,
                    onDropItem: 0, onUpdateAppearanceAttempt: 0 };
  const acts = Object.prototype.hasOwnProperty.call(ACTS_AS, name) ? ACTS_AS[name] : -1;
  return function () {
    if (acts >= 0) {
      const held = globalThis.__thornswoodPassHeld;
      const actorId = arguments[acts];
      if (typeof held === 'function' && actorId) {
        let pid = 0;
        try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { pid = 0; }
        if (pid > 0 && held(pid)) { return false; }
      }
    }
    let began = null;
    try { began = process.hrtime(); } catch (e) { began = null; }
    try {
      return fn.apply(null, arguments);
    } catch (e) {
      console.error('[thornswood] ' + name + ' threw: ' + (e && e.stack ? e.stack : e));
      return undefined;
    } finally {
      countSpent(name, began);
    }
  };
}

/*
  Counted for the minute line below. Never allowed to throw: it runs in a
  finally, and a finally that throws would replace what the handler returned.
*/
function countSpent(name, began) {
  try {
    if (began) {
      const d = process.hrtime(began);
      const ms = d[0] * 1000 + d[1] / 1e6;
      const row = gmSpent[name] || (gmSpent[name] = { ms: 0, runs: 0, worst: 0 });
      row.ms += ms; row.runs++;
      if (ms > row.worst) { row.worst = ms; }
    }
  } catch (e) { }
}

/*
  fn, with its time counted on the minute line under name, for work that does
  not go through guard(). The shared NPC runtime steps every actor it keeps on
  timers of its own (#385). Unlike guard() it hands on whatever fn throws, so
  the caller sees what it saw before.
*/
function counted(name, fn) {
  return function () {
    let began = null;
    try { began = process.hrtime(); } catch (e) { began = null; }
    try {
      return fn.apply(this, arguments);
    } finally {
      countSpent(name, began);
    }
  };
}

/*
  WHERE THE SERVER'S TIME GOES, one line a minute in thornswood.log. Issue #385.

  "Dev is laggy" had two suspects, the NPCs the server keeps alive and what it
  sends about every actor, and no number from the server for either: the
  engine times its own tick, but only behind /metrics, which answers 401 on
  both servers. So the gamemode reports it, because it runs in the same
  process as the engine:

    process   the whole server's CPU as a share of one core: the engine's tick,
              its NPCs and networking, and this file, all together. On the
              Windows box this undercounts: Windows charges CPU time to
              whatever thread is running at each 15.6 ms clock tick, and the
              timers here wake on that tick and are done before the next, so
              short timer work is never charged. Measured 20 Oct on dev with
              the NPCs off: process 0.0% while the timed handlers below came
              to 1.3% (#385)
    busy      the share of the time the event loop was running something
              rather than waiting, read from the clock: the engine's tick and
              every handler and timer here, which share the one thread. This
              is the figure to trust for how loaded the server's thread is
    gamemode  the part of that spent inside guard(), which wraps every event
              handler and most of the timers here, and inside the shared NPC
              runtime's own timers, which show as "npc <task>" (#385, 20 Oct:
              until then the runtime stepping some 4,800 NPCs was the largest
              script on the server and was counted as the engine's)
    loop      how late the event loop ran, p50, p99 and worst. The engine's
              tick runs on this loop, so a slow tick shows up here as delay
    and the five costliest handlers, with their worst single call.

  READ IT AS a before and after in one place: stand in the same spot with the
  NPCs on and off, and the busy and loop figures say whether the server
  side moved. Busy high with gamemode low is the engine. Loop worst high is
  a tick that stalls, which people feel as others jumping about. Every minute
  while somebody is on, every ten when nobody is, so an idle server still
  leaves a baseline. Reads only; it changes nothing the server does.
*/
const gmSpent = {};
try { (function () {
  const EVERY_MS = 60000;
  const IDLE_EVERY = 10;
  let loop = null;
  try {
    loop = require('perf_hooks').monitorEventLoopDelay({ resolution: 5 });
    loop.enable();
  } catch (e) { loop = null; }

  const g = globalThis;
  if (g.__thornswoodServerBeat) {
    try { clearInterval(g.__thornswoodServerBeat.timer); } catch (e) { }
    try { if (g.__thornswoodServerBeat.loop) { g.__thornswoodServerBeat.loop.disable(); } } catch (e) { }
  }
  let cpuWas = process.cpuUsage();
  let perf = null;
  let busyWas = null;
  try {
    perf = require('perf_hooks').performance;
    busyWas = perf.eventLoopUtilization();
  } catch (e) { perf = null; }
  let wasAt = Date.now();
  let quiet = 0;

  function beat() {
    let on = 0;
    try { on = (mp.get(0, 'onlinePlayers') || []).length; } catch (e) { on = 0; }
    if (!on && ++quiet < IDLE_EVERY) { return; }
    quiet = 0;
    const now = Date.now();
    const secs = Math.max(1, (now - wasAt) / 1000);
    const cpu = process.cpuUsage(cpuWas);
    cpuWas = process.cpuUsage();
    wasAt = now;
    let busy = 'not measured';
    if (perf) {
      busy = (perf.eventLoopUtilization(busyWas).utilization * 100).toFixed(1) + '%';
      busyWas = perf.eventLoopUtilization();
    }

    const rows = [];
    let gm = 0;
    for (const k in gmSpent) {
      if (!Object.prototype.hasOwnProperty.call(gmSpent, k)) { continue; }
      const r = gmSpent[k];
      if (r.runs) { rows.push({ k: k, ms: r.ms, runs: r.runs, worst: r.worst }); gm += r.ms; }
      r.ms = 0; r.runs = 0; r.worst = 0;
    }
    rows.sort(function (a, b) { return b.ms - a.ms; });

    const pct = function (ms) { return (ms / secs / 10).toFixed(1) + '%'; };
    let lag = 'loop not measured';
    if (loop) {
      const q = function (p) { return (loop.percentile(p) / 1e6).toFixed(1); };
      lag = 'loop late p50 ' + q(50) + 'ms p99 ' + q(99) + 'ms worst ' +
            (loop.max / 1e6).toFixed(0) + 'ms';
      loop.reset();
    }
    let rss = 0;
    try { rss = Math.round(process.memoryUsage().rss / 1048576); } catch (e) { rss = 0; }

    log('server: ' + Math.round(secs) + 's, ' + on + ' on, process ' +
        pct((cpu.user + cpu.system) / 1000) + ' of one core, busy ' + busy + ', gamemode ' + pct(gm) +
        ', ' + lag + ', ' + rss + ' MB; costliest: ' +
        (rows.slice(0, 5).map(function (r) {
          return r.k + ' ' + r.ms.toFixed(0) + 'ms/' + r.runs + ' worst ' + r.worst.toFixed(1) + 'ms';
        }).join('; ') || 'nothing ran'));
    netLines(secs);
  }

  /*
    WHAT EACH CONNECTION DID, one "net:" line a person a minute (#5053).

    "The dev server lags, worst at the Whiterun market" was measured on 26 Nov
    2026 from every source the box holds, and none of them showed it: the
    server was 5 to 7% of one core with its loop p99 at 8 ms, and testers'
    games drew the market as fast as anywhere outdoors. Nothing on the server
    or in the games said what a connection did, so lag between the server and
    one person could be neither shown nor ruled out. The engine's transport
    knows (mp.getConnectionStats, fork PR #202), and this says it beside where
    the person stood:

      ping       the transport's last, average and lowest round trip
      sent       bytes a second to this person over the minute, on the wire,
                 resends included; resent, the part sent again
      received   bytes a second from them
      waiting    messages queued to send right now, and sent but not yet
                 acknowledged; a queue that grows is the server sending
                 faster than the link takes it
      loss       the packets lost since they connected
      and "held back by congestion control" when the transport is slowing
      itself down for this link.

    READ IT AS the same person in the market and elsewhere: a ping, a queue
    or a rate that rises only in the market is the server's traffic there,
    and one that is high everywhere is the person's link. Reads only.
  */
  const netWas = {};
  function netLines(secs) {
    let people = [];
    try { people = mp.get(0, 'onlinePlayers') || []; } catch (e) { people = []; }
    if (!people.length) { return; }
    if (typeof mp.getConnectionStats !== 'function') {
      log('net: not measured; this engine has no getConnectionStats');
      return;
    }
    const seen = {};
    const kib = function (bytes) { return (bytes / secs / 1024).toFixed(1); };
    for (let i = 0; i < people.length; i++) {
      const actor = people[i];
      let user = -1, s = null;
      try { user = mp.getUserByActor(actor); } catch (e) { user = -1; }
      if (typeof user !== 'number' || user < 0) { continue; }
      try { s = mp.getConnectionStats(user); } catch (e) { s = null; }
      if (!s || typeof s !== 'object') { continue; }
      const key = user + ':' + actor;
      seen[key] = true;
      const was = netWas[key];
      netWas[key] = { sent: s.bytesSent, resent: s.bytesResent, got: s.bytesReceived };
      let rates = 'its first minute';
      if (was && s.bytesSent >= was.sent && s.bytesReceived >= was.got) {
        rates = 'sent ' + kib(s.bytesSent - was.sent) + ' KiB/s, resent ' +
                kib(Math.max(0, s.bytesResent - was.resent)) + ' KiB/s, received ' +
                kib(s.bytesReceived - was.got) + ' KiB/s';
      }
      let cell, at = '?';
      try { cell = String(mp.get(actor, 'worldOrCellDesc') || '?'); } catch (e) { cell = '?'; }
      try {
        const pos = mp.get(actor, 'pos');
        if (pos && pos.length >= 2) { at = Math.round(pos[0]) + ',' + Math.round(pos[1]); }
      } catch (e) { at = '?'; }
      log('net: ' + (actor >>> 0).toString(16) + ' in ' + cell + ' at ' + at + ': ping ' + s.lastPingMs +
          'ms (average ' + s.averagePingMs + ', lowest ' + s.lowestPingMs + '), ' + rates + ', ' +
          s.messagesWaiting + ' waiting to send, ' + s.messagesToResend + ' unacknowledged, loss ' +
          (Number(s.packetLoss || 0) * 100).toFixed(1) + '%' +
          (s.limitedByCongestion ? ', held back by congestion control' : ''));
    }
    for (const k in netWas) {
      if (Object.prototype.hasOwnProperty.call(netWas, k) && !seen[k]) { delete netWas[k]; }
    }
  }

  g.__thornswoodServerBeat = { timer: setInterval(function () {
    try { beat(); } catch (e) { }
  }, EVERY_MS), loop: loop, beat: beat };
})(); } catch (e) { log('the minute line is off: ' + e); }

/** Runtime form id for a descriptor, or 0 if the plugin is not loaded. */
function idOf(descriptor) {
  try {
    return mp.getIdFromDesc(descriptor);
  } catch (e) {
    return 0;
  }
}

/**
 * The log's copy of a line said to somebody. say() below is what puts it on
 * their screen, and every caller sends both.
 *
 * This used to call Debug.Notification too. The server's native finds its
 * actor through the Papyrus stack, which is empty when the call starts here,
 * so it never reached a screen and the engine logged "Native
 * Debug.Notification errored with Invalid stackId was passed to
 * GetDefaultActor (0)" for every line (eight on the live server on 15 Nov
 * 2026). Worse, seven callers sent the line through this alone and never
 * through say(), so nobody saw them: the crafting time at a bench, the
 * profession said at login, and the answers at mammoth carcasses, quest
 * retrieval spots, quest fishing waters, geodes and crimson nirnroot.
 */
function notify(actorId, text) {
  log('say', actorId.toString(16), text);
}

/**
 * A line in somebody's chat.
 *
 * notify() above only writes the log's copy. This is the one that reaches
 * the person: the voice service is holding everybody's chat socket already,
 * so the line is posted to it over loopback and it puts it on the right
 * screen.
 */
function say(actorId, text) {
  var pid = 0;
  try { pid = Number(mp.get(actorId, 'profileId')) || 0; } catch (e) { return; }
  if (!pid) { return; }
  var http;
  try { http = require('http'); } catch (e) { return; }
  var body = JSON.stringify({ profileId: pid, text: text });
  var req = http.request({
    host: '127.0.0.1', port: voicePort(), path: '/say', method: 'POST', timeout: 2000,
    headers: { 'content-type': 'application/json',
               'content-length': Buffer.byteLength(body) }
  }, function () { });
  req.on('error', function () { });
  req.on('timeout', function () { req.destroy(); });
  req.end(body);
}

function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

