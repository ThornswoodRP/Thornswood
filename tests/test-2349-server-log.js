'use strict';
/*
  test-2349-server-log.js

      node tests\test-2349-server-log.js

  The game server's log keeps nothing for longer than 30 days (#2349, decided
  by Patrick on 12 Oct 2026, B and C). The engine writes every connecting
  address into it, and until then it was one file appended for as long as the
  server ran, rolled only by size at a start (Roll-Log.ps1), never by age.

  What it proves, all in a scratch folder:
    - scripts\vps\Server-Log.js is there, and the installer's task runs the
      server under it, through start /high, handing the server's exit code
      back, with no >> redirect left holding server.log
    - the installer copies it into the server's folder (beside itself, then
      scripts\vps), rolls with it at an install, and Publish-Server sends it
    - a rolled file whose lines are all past 30 days is deleted, one with a
      mix is cut to the lines inside the window (a stack trace goes with the
      stamped line above it), one inside is left byte for byte, and the old
      numbered files Roll-Log.ps1 left are cut the same way
    - a run: the server's stdout and stderr land in server.log, its exit code
      is the writer's, a server.log from another day is rolled at the start
      and today's is appended to, and the sweep's lines are in the log
    - the site reads the server's lines back across the dated rolled files
      (serverLogSlice; tests\test-session-logs.js reads a crash back across
      the writer's own rolls)
    - the server ends when the writer is killed, as StopServer and a stopped
      task rely on: node puts its child in a job that closes with it
    - the privacy page says the game server's log holds the address for 30
      days, and the nightly backup takes no server.log
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const siteFiles = require('./site-files');

const REPO = path.resolve(__dirname, '..');
const WRITER = path.join(REPO, 'scripts', 'vps', 'Server-Log.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const DAY = 24 * 60 * 60 * 1000;
function pad(n, w) { return String(n).padStart(w || 2, '0'); }
function stamp(t) {
  const d = new Date(t);
  return '[' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' +
    pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + '.000] ';
}
function rd(f) { try { return fs.readFileSync(f, 'utf8'); } catch (e) { return null; } }

yes('scripts\\vps\\Server-Log.js is there', fs.existsSync(WRITER));

// ---- the installer and Publish-Server -----------------------------------------
const inst = rd(path.join(REPO, 'scripts', 'deploy', 'Install-ThornswoodServer.ps1')) || '';
const m = /\$cmd = \('(\/c [^\r\n]*?)' -f ([^\r\n]+)\)/.exec(inst);
yes('the installer builds the server task line', !!m);
const line = m ? m[1] : '';
yes('  it starts node through start /high on server-log.js, which runs the server',
  /start "" \/b \/wait \/high "\{0\}" "\{1\}" --log "\{2\}" --also thornswood\.log dist_back\/skymp5-server\.js/.test(line));
yes('  and hands the exit code back as the task\'s', line.indexOf('& call exit %^errorlevel%"') >= 0);
yes('  and no >> redirect holds server.log any more', line.indexOf('>>') < 0);
yes('the installer copies the writer in, beside itself first, then scripts\\vps',
  inst.indexOf("Join-Path $here 'Server-Log.js'") >= 0 && inst.indexOf("Join-Path $here '..\\vps\\Server-Log.js'") > inst.indexOf("Join-Path $here 'Server-Log.js'") &&
  inst.indexOf("Join-Path $Root 'server-log.js'") >= 0);
yes('  and rolls server.log with it at an install, never deleting it',
  /& \$node\.Source \$writer --log \$log --also \$gm --roll/.test(inst) && !/Remove-Item -LiteralPath \$log\b/.test(inst));
yes('  and no longer runs Roll-Log.ps1 for the server', !/& \$roller\b/.test(inst) && inst.indexOf("Join-Path $here 'Roll-Log.ps1'") < 0);
const pub = rd(path.join(REPO, 'scripts', 'release', 'Publish-Server.ps1')) || '';
yes('Publish-Server sends the writer beside the installer', /scp (@ssh )?\$serverLog "\$\{target\}:C:\/Server-Log\.js"/.test(pub));
yes('  and refuses it uncommitted', pub.indexOf("'scripts/vps/Server-Log.js'") >= 0);

if (!fs.existsSync(WRITER)) done();
const W = require(WRITER);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2349-'));
try {
  // ---- the 30 days ------------------------------------------------------------
  const now = Date.now();
  const dir = path.join(tmp, 'sweep');
  fs.mkdirSync(dir);
  const log = path.join(dir, 'server.log');
  const allOld = stamp(now - 31 * DAY) + 'Connecting a user 1 with ip 203.0.113.9\n' + stamp(now - 31 * DAY + 1000) + 'Server Login: 1\n';
  fs.writeFileSync(log + '.20260901000000000', allOld);
  const mixed = stamp(now - 35 * DAY) + 'Connecting a user 2 with ip 203.0.113.10\n' + 'Error: a stack\n    at old (x.js:1)\n' +
    stamp(now - 29 * DAY) + 'Connecting a user 3 with ip 203.0.113.11\n' + '    at new (x.js:2)\n' + stamp(now - 2 * DAY) + 'listening\n';
  fs.writeFileSync(log + '.3', mixed);
  const inside = stamp(now - 29 * DAY) + 'inside the window\n';
  fs.writeFileSync(log + '.20261001000000000', inside);
  fs.writeFileSync(log + '.4', 'no stamp at all\n');
  fs.utimesSync(log + '.4', new Date(now - 40 * DAY), new Date(now - 40 * DAY));
  fs.writeFileSync(log + '.5', 'no stamp, written lately\n');
  fs.writeFileSync(log + '.bak', allOld);
  fs.writeFileSync(log, stamp(now) + 'today\n');

  const said = W.sweep(log, now);
  yes('a rolled file with every line past 30 days is deleted', !fs.existsSync(log + '.20260901000000000'));
  const cut = rd(log + '.3') || '';
  yes('a rolled file with old and new lines keeps only the new ones',
    cut.indexOf('203.0.113.10') < 0 && cut.indexOf('203.0.113.11') >= 0 && cut.indexOf('listening') >= 0);
  yes('  and the stack under an old line goes with it, the one under a new line stays',
    cut.indexOf('at old') < 0 && cut.indexOf('at new') >= 0);
  yes('  and the cut file starts with its first line inside the window', cut.indexOf(stamp(now - 29 * DAY)) === 0);
  yes('a rolled file inside the window is left byte for byte', rd(log + '.20261001000000000') === inside);
  yes('a file with no stamp goes by its last write: 40 days ago deleted', !fs.existsSync(log + '.4'));
  yes('  and written lately kept', rd(log + '.5') === 'no stamp, written lately\n');
  yes('a file that is not a rolled log is not touched (server.log.bak)', rd(log + '.bak') === allOld);
  yes('the live server.log is not touched by the sweep', rd(log) === stamp(now) + 'today\n');
  yes('the sweep says what it deleted and cut', said.length === 1 && /2 rolled logs deleted, 1 cut/.test(said[0]));
  yes('no address older than 30 days is left in any rolled log',
    W.rolledFiles(log).every((f) => (rd(f) || '').indexOf('203.0.113.9') < 0 && (rd(f) || '').indexOf('203.0.113.10') < 0));

  // A file the sweep cannot change is said, not passed over.
  if (process.platform === 'win32') {
    const held = log + '.20250101000000000';
    fs.writeFileSync(held, allOld);
    const hold = cp.spawn('powershell.exe', ['-NoProfile', '-Command',
      "$f = [IO.File]::Open('" + held.replace(/'/g, "''") + "', 'Open', 'Read', 'Read'); 'held'; Start-Sleep -Seconds 20"], { stdio: ['ignore', 'pipe', 'ignore'] });
    // The sweep runs once Windows PowerShell says it holds the file, never on
    // a clock: on a busy runner its start alone took over 15 seconds, and a
    // sweep before the hold deleted the file (gate run 41502686958).
    let saidHeld = '';
    const waitHeld = new Promise((res) => {
      hold.stdout.on('data', (d) => { saidHeld += d; if (/held/.test(saidHeld)) res(true); });
      hold.on('exit', () => res(false));
    });
    waitHeld.then((isHeld) => {
      if (!isHeld) {
        yes('a rolled file another program holds is named with the error, and left for the next pass (Windows PowerShell ended without holding it)', false);
        fs.rmSync(held, { force: true });
        runPart();
        return;
      }
      const s2 = W.sweep(log, now);
      yes('a rolled file another program holds is named with the error, and left for the next pass',
        fs.existsSync(held) && s2.some((l) => l.indexOf(path.basename(held)) >= 0 && /could not/.test(l)));
      hold.kill();
      hold.on('exit', () => { setTimeout(() => { fs.rmSync(held, { force: true }); runPart(); }, 300); });
    });
  } else {
    // Linux deletes a file another program has open, so the sweep cannot be
    // stopped this way here; the box, where it runs, is Windows (#3005).
    console.log('SKIP  a rolled file another program holds: only Windows refuses to delete a file that is open elsewhere');
    runPart();
  }
} catch (e) {
  fail++; console.log('FAIL  the harness stopped: ' + (e.stack || e.message));
  fs.rmSync(tmp, { recursive: true, force: true });
  done();
}

function runPart() {
  try {
    // ---- a run ------------------------------------------------------------------
    const now = Date.now();
    const srv = path.join(tmp, 'server');
    fs.mkdirSync(path.join(srv, 'dist_back'), { recursive: true });
    fs.writeFileSync(path.join(srv, 'dist_back', 'skymp5-server.js'),
      "console.log('" + stamp(now).trim() + " stand-in server up');\nconsole.error('stand-in on stderr');\nprocess.exit(3);\n");
    const log = path.join(srv, 'server.log');
    const yesterday = stamp(now - DAY) + 'yesterday\n';
    fs.writeFileSync(log, yesterday);
    fs.writeFileSync(log + '.1', stamp(now - 40 * DAY) + 'Connecting a user 9 with ip 203.0.113.99\n');
    const r = cp.spawnSync(process.execPath, [WRITER, '--log', log, 'dist_back/skymp5-server.js'], { cwd: srv, encoding: 'utf8' });
    yes('the writer hands the server\'s exit code back (3)', r.status === 3);
    const text = rd(log) || '';
    yes('the server\'s stdout lands in server.log', text.indexOf('stand-in server up') >= 0);
    yes('  and its stderr', text.indexOf('stand-in on stderr') >= 0);
    yes('  and the end is said', /\[server-log\] the server ended, exit code 3/.test(text));
    yes('a server.log from yesterday was rolled at the start, not appended to',
      text.indexOf('yesterday') < 0 && W.rolledFiles(log).some((f) => rd(f) === yesterday));
    yes('the numbered file Roll-Log.ps1 left, 40 days old, is gone', !fs.existsSync(log + '.1'));
    yes('  and the run said so in server.log', /\[server-log\] older than 30 days: 1 rolled log deleted/.test(text));
    const r2 = cp.spawnSync(process.execPath, [WRITER, '--log', log, 'dist_back/skymp5-server.js'], { cwd: srv, encoding: 'utf8' });
    yes('today\'s server.log is appended to at the next start', r2.status === 3 && ((rd(log) || '').match(/stand-in server up/g) || []).length === 2);

    // ---- --roll, the install's roll -------------------------------------------
    const before = W.rolledFiles(log).length;
    const r3 = cp.spawnSync(process.execPath, [WRITER, '--log', log, '--roll'], { cwd: srv, encoding: 'utf8' });
    yes('--roll moves today\'s server.log aside whatever its size, and exits 0',
      r3.status === 0 && !fs.existsSync(log) && W.rolledFiles(log).length === before + 1 && /rolled server\.log to server\.log\.\d+/.test(r3.stdout));

    // ---- the site reads across the dated files -------------------------------
    process.env.THORNSWOOD_HARNESS = '1';
    const site = siteFiles.source() || '';
    const at = site.indexOf('function serverLogSlice(');
    yes('the site still reads the server log for a session (serverLogSlice)', at >= 0);
    yes('  and lists the rolled files rather than counting .1 to .5', site.indexOf('const keep = 5;') < 0 && /serverLogGenerations/.test(site));
    // ---- the privacy page and the backup -------------------------------------
    const privacy = rd(path.join(REPO, 'site', 'data', 'site', 'privacy.md')) || '';
    yes('the privacy page says the game server\'s log holds the address, and for 30 days',
      /\*\*The game server's log\*\* records the address/.test(privacy) && /older than 30 days/.test(privacy) &&
      /Sign-in records\*\*, the only thing on the site holding your address/.test(privacy));
    yes('  and that the backups do not hold it', /The game server's log is not in them\./.test(privacy));
    const nightly = rd(path.join(REPO, 'scripts', 'vps', 'vps-nightly-backup.ps1')) || '';
    yes('the nightly backup takes no server.log from either game server',
      nightly.indexOf('Grab (Join-Path $sv.Root') >= 0 && !/Grab[^\n]*server\.log/i.test(nightly) && !/Grab \(Join-Path \$sv\.Root\s*\)/.test(nightly));
  } catch (e) {
    fail++; console.log('FAIL  the harness stopped: ' + (e.stack || e.message));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  jobPart();
}

// The server goes when the writer goes. Install-ThornswoodServer's
// StopServer ends both by id, but a writer ended any other way (the task
// stopped, a crash) must not leave a server running with nothing writing
// its log and nothing the task can see.
function jobPart() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2349-job-'));
  const finish = () => { setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); done(); }, 300); };
  try {
    fs.mkdirSync(path.join(dir, 'dist_back'));
    fs.writeFileSync(path.join(dir, 'dist_back', 'skymp5-server.js'),
      "console.log('[' + new Date().toISOString().slice(0, 10) + ' 00:00:00.000] server pid ' + process.pid);\nsetTimeout(function () { }, 60000);\n");
    const log = path.join(dir, 'server.log');
    const w = cp.spawn(process.execPath, [WRITER, '--log', log, 'dist_back/skymp5-server.js'], { cwd: dir, stdio: 'ignore' });
    let tries = 0, pid = 0;
    const look = setInterval(() => {
      tries++;
      const m = /server pid (\d+)/.exec(rd(log) || '');
      if (m) pid = Number(m[1]);
      if (!pid && tries < 100) return;
      clearInterval(look);
      yes('the writer started the server and wrote its first line', pid > 0);
      if (!pid) { try { w.kill(); } catch (e) { } finish(); return; }
      // What ends the server is the job Windows puts every child of node in
      // (libuv makes it kill on close). Measured 21 Oct on Linux (#3005): the
      // server outlived a writer ended by SIGTERM, adopted by init, because
      // Linux has no such job. The writer runs only on the box, which is Windows.
      if (process.platform !== 'win32') {
        console.log('SKIP  killing the writer ends the server too: what ends it is the job Windows puts a child of node in, and the writer runs only on the box, which is Windows');
        try { w.kill(); } catch (e) { }
        try { process.kill(pid); } catch (e) { }
        finish();
        return;
      }
      w.kill();
      let left = 0;
      const gone = setInterval(() => {
        left++;
        let alive = true;
        try { process.kill(pid, 0); } catch (e) { alive = false; }
        if (alive && left < 50) return;
        clearInterval(gone);
        yes('killing the writer ends the server too', !alive);
        if (alive) { try { process.kill(pid); } catch (e) { } }
        finish();
      }, 100);
    }, 100);
  } catch (e) {
    fail++; console.log('FAIL  the job part stopped: ' + (e.stack || e.message));
    finish();
  }
}
