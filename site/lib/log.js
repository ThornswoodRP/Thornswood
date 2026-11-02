/*
  The site's own log, site.log: rolled at 4 MB with five kept, aged by the
  privacy page's times, and fed by everything the console says.
*/

'use strict';

const fs     = require('fs');
const path   = require('path');
const { ROOT } = require('./base');

// ==== thornswood site log ====
//
// EVERYTHING THIS PROCESS WORKED OUT USED TO GO NOWHERE. The scheduled task
// ran node with no redirect at all, so stdout and stderr went into a handle
// nobody held and there was no file anywhere on the box. discordGet works out
// a plain sentence for every failure, because a dead bot token, a rate limit
// and somebody genuinely not in the Discord used to look identical and the
// site told all three of them the same wrong thing. Not one of those
// sentences had ever been readable. It cost most of an evening on 22
// September, and two wrong conclusions, to work out from outside what the
// site already knew.
//
// IN PROCESS RATHER THAN A REDIRECT ON THE TASK, and that is the whole
// design decision. The other three services are launched through cmd with
// >> log 2>&1, and a log held open that way cannot be rolled: Windows
// refuses to move or truncate a file another process has open for append,
// measured rather than assumed. A redirect would have fixed 'there is no
// log' and created 'the log grows until the disk goes', which is another
// entry on the list. Writing it here means this process owns the handle and
// can close, roll and reopen it whenever it likes.
//
// WHAT IS NOT IN IT: addresses. The privacy page says the sign-in log is the
// only thing here that holds one and that it is deleted after thirty days. A
// request log carrying addresses would quietly make that untrue, so this
// holds what the site says about itself and the method and path of anything
// that failed, and never who asked.
//
// WHEN ROLLING FAILS (#2189). Until 11 October a failed roll was swallowed
// and the line was appended anyway, so one rotated file held open (an editor,
// a tail, a backup) or a folder that lost delete rights let site.log grow
// past its four megabytes for as long as the site ran, with nothing said.
// Now: the failure is said ONCE on the console and in the log itself, naming
// the file, the error and what usually causes it. The roll is retried every
// retryMs (a minute), not on every line. And the active file has an
// EMERGENCY CEILING of twice maxBytes (8 MB for site.log): past it one line
// says so and the file stops growing, lines carry on to the console only,
// until a roll succeeds, which is said once too. Disk space for this folder
// as a whole is #2178's storage alerts, not this.
//
// BY AGE AS WELL AS BY SIZE (#2166). Until 17 Oct 2026 this rolled at 4 MB
// and kept five, and nothing aged it: a quiet site kept months in site.log,
// profile numbers and character names among them, while the privacy page
// said nothing about it. Patrick decided on 17 Oct (#2166, G5): the logs
// that name people go after 90 days. So with opts.liveDays and
// opts.copyDays, once an hour and once as the log is made, the live file is
// rolled once its first line is liveDays old, and a rolled copy is deleted
// once its last write is copyDays old. A copy's oldest line is at most
// liveDays older than its last write, so at 30 and 59 nothing in any of them
// is 90 days old (59 + 30 and the hour between passes). The count and the
// size stay the bound on disk. Each roll or delete it makes, and each one
// that fails, is one line here and on the console, naming the file and the
// error, never what the file held.
function makeLog(dir, name, maxBytes, keep, opts) {
  const file = path.join(dir, name);
  const retryMs = (opts && typeof opts.retryMs === 'number') ? opts.retryMs : 60000;
  const liveMs = (opts && opts.liveDays > 0) ? opts.liveDays * 86400000 : 0;
  const copyMs = (opts && opts.copyDays > 0) ? opts.copyDays * 86400000 : 0;
  const ceiling = maxBytes * 2;
  let broken = false;
  let rollError = null;      // the last roll's error, null when the last roll worked
  let rollFailures = 0;      // failed rolls since the last good one
  let nextRoll = 0;          // no retry before this (ms)
  let held = false;          // the ceiling line has been written
  // No try (#2736): a string written to stdout does not throw here, and a
  // pipe that has gone fails later as the stream's own error, which a catch
  // around the write never saw.
  function say(line) {
    process.stdout.write('[thornswood-docs] ' + line + '\n');
  }

  function two(n) { return n < 10 ? '0' + n : String(n); }
  function stamp() {
    const d = new Date();
    return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()) +
           ' ' + two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds());
  }

  // Oldest first, so nothing is overwritten on the way. site.log.5 goes,
  // site.log.4 becomes .5, and site.log becomes .1. Rolled, never deleted:
  // deleting a log is how the evidence for the last crash disappeared in the
  // first place.
  function roll() {
    try {
      const oldest = file + '.' + keep;
      if (fs.existsSync(oldest)) { fs.unlinkSync(oldest); }
      for (let i = keep - 1; i >= 1; i--) {
        const from = file + '.' + i;
        if (fs.existsSync(from)) { fs.renameSync(from, file + '.' + (i + 1)); }
      }
      if (fs.existsSync(file)) { fs.renameSync(file, file + '.1'); }
      rollError = null;
      return true;
    } catch (e) { rollError = e; return false; }
  }

  function write(line) {
    if (broken) { return false; }
    try {
      let size = 0;
      try { size = fs.statSync(file).size; } catch (e) { size = 0; }
      if (size >= maxBytes && Date.now() >= nextRoll) {
        if (roll()) {
          if (rollFailures) {
            const was = rollFailures;
            rollFailures = 0; held = false;
            say('rolled ' + file + ' again after ' + was + ' failed tr' + (was === 1 ? 'y' : 'ies'));
            fs.appendFileSync(file, stamp() + '  log rolled again after ' + was + ' failed tr' + (was === 1 ? 'y' : 'ies') + '\n');
          }
          size = 0;
        } else {
          rollFailures++;
          nextRoll = Date.now() + retryMs;
          if (rollFailures === 1) {
            const why = 'could not roll ' + file + ' (' + ((rollError && (rollError.code || rollError.message)) || 'unknown') +
              ': ' + ((rollError && rollError.message) || '') + '). Usually ' + name + '.1 to .' + keep +
              ' is held open by an editor, a tail or a backup, or the folder lost delete rights. ' +
              'Retrying every ' + Math.round(retryMs / 1000) + ' s; past ' + ceiling + ' bytes ' + name +
              ' stops growing and lines go to the console only.';
            say(why);
            fs.appendFileSync(file, stamp() + '  ERROR ' + why + '\n');
            size += why.length;
          }
        }
      }
      if (size >= ceiling) {
        if (!held) {
          held = true;
          const stop = name + ' reached its emergency ceiling of ' + ceiling + ' bytes with rolling still failing; ' +
            'lines go to the console only until a roll works';
          say(stop);
          fs.appendFileSync(file, stamp() + '  ERROR ' + stop + '\n');
        }
        return false;
      }
      fs.appendFileSync(file, stamp() + '  ' + line + '\n');
      return true;
    } catch (e) {
      // Once, and out loud. A log that throws on every line is worse than no
      // log, and one that goes quiet with no trace is worse than both.
      broken = true;
      say('could not write ' + file + ', carrying on with the console only: ' + e.message);
      return false;
    }
  }

  // The time of the live file's first line, from its stamp, or null.
  function firstLineAt() {
    let fd = null;
    try {
      fd = fs.openSync(file, 'r');
      const buf = Buffer.alloc(32);
      const n = fs.readSync(fd, buf, 0, 32, 0);
      const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(buf.toString('latin1', 0, n));
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
    } catch (e) { return null; }
    finally {
      if (fd !== null) {
        try { fs.closeSync(fd); }
        catch (e) { say('could not close ' + file + ' after reading its first line (' + (e.code || e.message) + ')'); }
      }
    }
  }

  function age() {
    const out = { rolled: false, deleted: 0, failed: [] };
    if (!liveMs || !copyMs || broken) { return out; }
    const now = Date.now();
    for (let i = 1; i <= keep; i++) {
      const f = file + '.' + i;
      let st;
      try { st = fs.statSync(f); } catch (e) { continue; }
      if (now - st.mtimeMs < copyMs) { continue; }
      try { fs.unlinkSync(f); out.deleted++; }
      catch (e) { out.failed.push({ file: name + '.' + i, code: (e && e.code) || 'unknown' }); }
    }
    const first = firstLineAt();
    if (first !== null && now - first >= liveMs) {
      if (roll()) { out.rolled = true; }
      else { out.failed.push({ file: name, code: (rollError && (rollError.code || rollError.message)) || 'unknown' }); }
    }
    if (out.rolled || out.deleted || out.failed.length) {
      const line = name + ' by age: ' + (out.rolled ? 'rolled, its first line ' + (opts.liveDays) + ' days old; ' : '') +
        out.deleted + ' rolled cop' + (out.deleted === 1 ? 'y' : 'ies') + ' past ' + opts.copyDays + ' days deleted' +
        (out.failed.length ? '; could not change ' + out.failed.map(function (x) { return x.file + ' (' + x.code + ')'; }).join(', ') +
          ', tried again within the hour' : '');
      say(line);
      write(line);
    }
    return out;
  }
  if (liveMs && copyMs) {
    age();
    const t = setInterval(age, (opts && opts.ageEveryMs) || 3600000);
    if (t && t.unref) { t.unref(); }
  }

  return {
    file: file, write: write, roll: roll, ceiling: ceiling, age: age,
    broken: function () { return broken; },
    rolling: function () { return { failures: rollFailures, held: held, error: rollError ? (rollError.code || rollError.message) : null }; }
  };
}

// Four megabytes is a few days of a closed playtest and opens in anything.
// Five kept, so a crash on Saturday night is still readable on Monday.
// Nothing in it, or in a rolled copy, reaches 90 days (#2166).
const siteLog = makeLog(ROOT, 'site.log', 4 * 1024 * 1024, 5, { liveDays: 30, copyDays: 59 });

// Said through the console as well, so running the site by hand is unchanged
// and so a person watching a deploy sees what they always saw. The console
// keeps its own arguments; the file gets one line.
['log', 'error', 'warn'].forEach(function (k) {
  const was = console[k].bind(console);
  console[k] = function () {
    const parts = Array.prototype.slice.call(arguments).map(function (a) {
      if (typeof a === 'string') { return a; }
      if (a instanceof Error) { return a.stack || a.message; }
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    });
    siteLog.write((k === 'log' ? '' : k.toUpperCase() + ' ') + parts.join(' '));
    was.apply(null, arguments);
  };
});
// ==== end thornswood site log ====

Object.assign(module.exports, { siteLog });
