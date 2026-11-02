/*
  The game server's own log, the deploy records (#459) and the chat a
  session's window covers.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { chatSlice, readDeploys, serverLogSlice, sessionRow };

const fs     = require('fs');
const path   = require('path');
const { jsonFile } = require('./store');
const { LINKED } = require('./discord');

/*
  The game server's log between two moments.

  Its lines start "[2026-09-22 10:02:10.155]", which is local time on this box
  and the same clock the session's start and end were stamped with, so they
  compare directly. A line with no stamp belongs to the line above it, which is
  what a stack trace is, so it is kept whenever the last stamped line was.

  dev and main are different servers with different logs; the session says
  which it was on.

  ROLLED LOGS ARE READ TOO, entry 220. Since #2349 the server runs under
  server-log.js, which rolls server.log at midnight, at 4 MB and at a start
  from another day into server.log.<when>, and keeps no line in any of them
  past 30 days (an install rolls it whatever the size). Reading server.log
  alone, a restart after a crash would leave every session before it with no
  server lines at all, the crash session included, which is the one this
  page is opened for. So when server.log is shorter than the window, the rest
  of the window is taken off the end of the rolled ones, newest first
  (serverLogGenerations), and the read is never more than the 4 MB it always
  was. A session older than 30 days has no server lines left, which is the
  privacy page's promise rather than a fault.
*/
const SERVER_LOGS = {
  main: 'C:\\Thornswood-Server\\server.log',
  dev:  'C:\\Thornswood-Server-Dev\\server.log'
};

// ==== thornswood deploy records ====
/* What each part on this box runs, for /api/deploys (#459). Every deploy
   (scripts\deploy\Artifact.ps1) leaves one record per folder a part runs
   from in DEPLOYS_DIR: which zip, which commit, whether it carried edits,
   when. Only those fields go out; where it runs and which machine sent it
   stay on the box. A record that will not read is named and skipped, so one
   bad file does not hide the rest. Deploy-Docs grants the site's account
   read on this folder. The door is staff only since #1359. */
const DEPLOYS_DIR = process.env.THORNSWOOD_DEPLOYS_DIR || 'C:\\Thornswood-Deploys\\current';
function readDeploys(dir) {
  const parts = {};
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { return parts; }
  for (const n of names.sort()) {
    if (!/^[a-z0-9][a-z0-9._-]*\.json$/.test(n)) continue;
    const part = n.slice(0, -5);
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8').replace(/^\uFEFF/, ''));
      parts[part] = {
        component: String(r.component || ''),
        name: String(r.name || ''),
        commit: String(r.commit || ''),
        edited: r.edited === true,
        sha256: String(r.sha256 || ''),
        deployedUtc: String(r.deployedUtc || '')
      };
    } catch (e) {
      parts[part] = { unreadable: true };
    }
  }
  return parts;
}
// ==== end thornswood deploy records ====

/* Where the voice service writes what people said. Its folder, not this one:
   it owns the file and this only reads it, so there is one writer and no
   question about which copy is the real one.

   dev and main are different voice services with different folders, the same
   way they are different game servers with different logs, and the session
   says which it was on. This used to be one folder, the live one, for every
   session. So a dev session showed nothing, or worse, showed what the same
   profile number said on the live server in that window, which is somebody
   else's words in a report about behaviour.

   The dev folder is where the dev service actually writes. voice-server.js
   puts chat in its own folder unless THORNSWOOD_CHAT_DIR is set. Neither
   Install-Voice.ps1 nor vps-dev-instance.ps1 sets it, and the dev service's
   folder is C:\Thornswood-Voice-Dev (voice\README.md, vps-dev-instance.ps1).
   Measured 23 September: Get-Logs -Dev read that folder's voice.log and it
   says "listening on 127.0.0.1:7789", which is the dev port.
   tools\test-session-chat.js checks both defaults against those scripts. */
const CHAT_DIRS = {
  main: process.env.THORNSWOOD_CHAT_DIR || 'C:\\Thornswood-Voice\\chat',
  dev:  process.env.THORNSWOOD_DEV_CHAT_DIR || 'C:\\Thornswood-Voice-Dev\\chat'
};

/* What this person said during THIS session, and nothing else.

   There used to be a page of its own for the chat log, a day at a time for
   everybody at once. Answering "what did this person do" meant reading a
   session on one page, working out when it ran, then going to another page,
   picking the day and filtering by name, and holding the two together in your
   head. Patrick, 22 September: put it under each person on /sessions, split
   per session. So the page is gone and this is where it lives.

   The split is the profile number and the session's own window. A chat line
   carries profileId and at; a session carries profile, start and end. The
   caller passes the same window it already widened by a minute either side
   for the server log, because the launcher stamps the session and the voice
   service stamps the line, and those moments are not the same moment.

   A session that runs over midnight is in two files, so both days are read.
   A line that will not parse is skipped rather than thrown: an append-only
   log killed mid-write has a truncated last line by design, and one bad line
   must not cost the rest.

   channel picks the voice service by the same rule serverLogSlice picks the
   game server's log, so the chat and the server log under one session always
   come from the same server. */
function chatSlice(profileId, from, to, channel) {
  const want = Number(profileId) || 0;
  if (!want) return { ok: true, why: '', lines: [] };
  const dev = channel === 'dev';
  const dir = CHAT_DIRS[dev ? 'dev' : 'main'];
  const days = {};
  for (const at of [from, to]) {
    const d = new Date(at);
    const p = (n) => (n < 10 ? '0' : '') + n;
    days[d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())] = 1;
  }
  const out = [];
  let read = 0;
  for (const day of Object.keys(days).sort()) {
    let raw = '';
    try { raw = fs.readFileSync(path.join(dir, day + '.jsonl'), 'utf8'); }
    catch (e) { continue; }
    read++;
    for (const l of raw.split('\n')) {
      if (!l.trim()) continue;
      let o;
      try { o = JSON.parse(l); } catch (e) { continue; }
      if (!o) continue;
      if (Number(o.profileId) !== want) continue;
      const at = Number(o.at) || 0;
      if (at < from || at > to) continue;
      out.push({ at: at, kind: String(o.kind || ''), mode: String(o.mode || ''),
                 name: String(o.name || ''), proven: !!o.proven, text: String(o.text || ''),
                 via: o.via === 'press' ? 'press' : '' });
      if (out.length > 4000) break;
    }
    if (out.length > 4000) break;
  }
  out.sort((a, b) => a.at - b.at);
  /* "Nothing was said" and "the chat log is not on this box" look identical
     once both are an empty list, and only one of them is a fault. */
  return { ok: true, why: read ? '' : 'no chat log for those days on this box' +
           (dev ? ' from the dev voice service' : ''), lines: out };
}

/* The server's log and the rolled copies behind it, newest first (#2349).
   server-log.js rolls server.log at midnight and at 4 MB into
   server.log.<when it was rolled>, and the numbered ones Roll-Log.ps1 left
   (server.log.1 to .5) are still there until their lines pass 30 days. Both
   are server.log.<digits>, ordered by their last write, which is when each
   stopped being the live file. */
function serverLogGenerations(file) {
  const dir = path.dirname(file), base = path.basename(file).toLowerCase() + '.';
  let names = [];
  try { names = fs.readdirSync(dir); } catch (e) { names = []; }
  const rolled = [];
  for (const n of names) {
    if (n.toLowerCase().indexOf(base) !== 0 || !/^\d+$/.test(n.slice(base.length))) continue;
    /* A copy deleted by the age rule between the listing and this look is
       gone, and is left out. Any other failure is said, by its name and the
       code (#2736), since the copy is then left out of what staff read. */
    try { rolled.push({ f: path.join(dir, n), t: fs.statSync(path.join(dir, n)).mtimeMs }); }
    catch (e) {
      if (e.code !== 'ENOENT') console.error('[thornswood-docs] could not look at ' + n + ' beside ' + path.basename(file) + ' (' + (e.code || e.message) + ')');
    }
  }
  rolled.sort((a, b) => b.t - a.t);
  return [file].concat(rolled.map((r) => r.f));
}

function serverLogSlice(channel, from, to) {
  const file = SERVER_LOGS[channel === 'dev' ? 'dev' : 'main'];
  /* Only the tail is read, 4 MB across the live file and the rolled ones
     behind it, newest first. These grow, and a session is minutes long. */
  let left = 4 * 1024 * 1024;
  const parts = [];
  let found = 0;
  try {
    for (const f of serverLogGenerations(file)) {
      if (left <= 0) break;
      /* server.log itself can be missing for a moment, between the roll and
         the writer opening a new one. */
      if (!fs.existsSync(f)) continue;
      found++;
      const size = fs.statSync(f).size;
      const fd = fs.openSync(f, 'r');
      try {
        const start = Math.max(0, size - left);
        const buf = Buffer.alloc(Math.min(size, left));
        fs.readSync(fd, buf, 0, buf.length, start);
        let text = buf.toString('utf8');
        if (start > 0) text = text.slice(text.indexOf('\n') + 1);
        /* A run killed mid-line leaves no newline at the end of its file, and
           the next file's first line must not be glued onto it. */
        if (text.length && !text.endsWith('\n')) text += '\n';
        parts.unshift(text);
        left -= buf.length;
      } finally { fs.closeSync(fd); }
    }
  } catch (e) { return { ok: false, why: String(e.message || e), code: e.code || e.name, lines: [] }; }
  if (!found) return { ok: false, why: 'no server log on this box', lines: [] };
  const text = parts.join('');

  const out = [];
  let keeping = false;
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\[(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (m) {
      const at = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
      keeping = at >= from && at <= to;
    }
    if (keeping && line.length) out.push(line);
    if (out.length > 4000) break;
  }
  return { ok: true, lines: out };
}

/* One row, from whatever the launcher sent and the ticket it sent it with.
   The Discord id and the name come from the ticket and the linked file, never
   from the body: the body is the launcher's, and the ticket is the only part
   of it the site signed. */
function sessionRow(t, o, key) {
  const known = jsonFile(LINKED, {})[t.d] || {};
  return {
    session: key,
    who: String(t.d),
    name: String(known.name || t.n || ''),
    profile: Number(o.profileId) || 0,
    /*
      dev, main, or "" when the launcher did not say.

      This used to read `=== 'dev' ? 'dev' : 'main'`, which turned "nothing was
      sent" into "main" and threw away the difference. That matters on the
      sessions page: a session that never reached a world is shown as Main
      Launcher or Dev Launcher when we know which build it was, and as plain
      Launcher when we genuinely do not, so the two cases can be told apart
      rather than the second quietly claiming the live server.
    */
    channel: (function (c) {
      const s = String(c == null ? '' : c).trim().toLowerCase();
      return (s === 'dev' || s === 'main') ? s : '';
    })(o.channel),
    version: String(o.version || '').slice(0, 32),
    start: 0, end: 0, minutes: 0, why: '', note: ''
  };
}

Object.assign(module.exports, { DEPLOYS_DIR });
