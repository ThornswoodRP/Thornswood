'use strict';
/*
  test-4410-chat-days.js

      node tests\test-4410-chat-days.js

  #4410. voice\voice-server.js read THORNSWOOD_CHAT_DAYS with
  Number(process.env.THORNSWOOD_CHAT_DAYS || 365) and pruned at start with
  cutoff = now - CHAT_DAYS days, deleting every day file older than the
  cutoff. Number() turns anything into a number or NaN, and nothing checked
  which:

    - not a number ("abc")  NaN cutoff, and "day >= NaN" is never true, so
                            every day was deleted, today's too;
    - blank (" ")           Number(" ") is 0, the cutoff is now, so every
                            day was deleted, today's too;
    - 0                     the same;
    - negative              the cutoff is in the future, so every day went;
    - below 365             days still inside the 365 days the privacy page
                            promises (and staff rely on to copy a kept
                            session's chat) went early.

  And nothing said which value was in use.

  This runs the real voice-server.js in a scratch folder once per value,
  with chat days at 0, 1, 100 and 360 days old (all inside the 365-day
  window) and one at 400 days (outside it), and holds:

    - no value deletes a day inside the window, and the 400-day day still
      goes, so the prune still runs;
    - /health says the days in use (chatRetention.days), 365 for any value
      that is not a whole number of 365 or more;
    - a whole number above 365 is used as it is, so a day younger than it
      stays;
    - the service says in its log, once, a value it did not use.

  Never connects to anything off this machine.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond, more) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (more ? '  (' + more + ')' : '')); }
}

const VOICE = path.join(__dirname, '..', 'voice');

/* A day's file name, the way voice-server.js names it (local time), n days
   before today. */
function dayName(n) {
  const t = new Date();
  const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() - n);
  const p = (x) => (x < 10 ? '0' : '') + x;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.jsonl';
}
const INSIDE = [0, 1, 100, 360];
const OUTSIDE = 400;

function freePort() {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

/* Waits for this run's own "[voice] listening on ...:port" line (#1703). */
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[voice\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error('the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('exit', gone);
  });
}

/* One start of the service with THORNSWOOD_CHAT_DAYS set to value (or unset
   for undefined): which day files are left, /health, and the log. */
async function run(value) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-chatdays-'));
  fs.copyFileSync(path.join(VOICE, 'voice-server.js'), path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(VOICE, 'headlines.js'), path.join(dir, 'headlines.js'));
  const chat = path.join(dir, 'chat');
  fs.mkdirSync(chat);
  for (const n of INSIDE.concat([OUTSIDE])) {
    fs.writeFileSync(path.join(chat, dayName(n)), JSON.stringify({ text: 'a line from ' + n + ' days ago' }) + '\n');
  }
  const port = await freePort();
  const env = Object.assign({}, process.env, {
    THORNSWOOD_VOICE_PORT: String(port),
    THORNSWOOD_SITE: 'http://127.0.0.1:9',
    THORNSWOOD_CHAT_DIR: chat
  });
  delete env.THORNSWOOD_CHAT_DAYS;
  if (value !== undefined) env.THORNSWOOD_CHAT_DAYS = value;
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir, env: env });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  let up = false;
  try { await listening(srv, port); up = true; } catch (e) { log += '\n' + e.message; }
  let health = null;
  if (up) {
    try { health = await (await fetch('http://127.0.0.1:' + port + '/health')).json(); } catch (e) { }
  }
  srv.kill();
  await new Promise((ok) => { if (srv.exitCode !== null) ok(); else srv.once('close', ok); });
  const left = {};
  for (const n of INSIDE.concat([OUTSIDE])) left[n] = fs.existsSync(path.join(chat, dayName(n)));
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  return { up: up, health: health, left: left, log: log };
}

function days(r) { return r.health && r.health.chatRetention ? r.health.chatRetention.days : undefined; }
function kept(r) { return INSIDE.filter((n) => r.left[n]); }

(async () => {
  /* A value that is not a whole number of 365 or more: the window holds. */
  const BAD = [
    ['not a number', 'abc'],
    ['blank', ' '],
    ['zero', '0'],
    ['negative', '-30'],
    ['below the window', '30'],
    ['not whole', '400.5'],
    ['a number with words after it', '365 days']
  ];
  for (const [what, v] of BAD) {
    console.log('\nTHORNSWOOD_CHAT_DAYS=' + JSON.stringify(v) + ' (' + what + '):');
    const r = await run(v);
    yes('the voice service started', r.up);
    yes('no day inside the 365-day window is deleted (0, 1, 100 and 360 days old)',
      kept(r).length === INSIDE.length, 'kept ' + JSON.stringify(kept(r)));
    yes('the day 400 days old still goes', r.up && !r.left[OUTSIDE]);
    yes('/health says the days in use are 365', days(r) === 365, 'chatRetention ' + JSON.stringify(r.health && r.health.chatRetention));
    const said = r.log.split(/\r?\n/).filter((l) => /THORNSWOOD_CHAT_DAYS/.test(l));
    yes('the log says, once, that the value was not used and 365 is',
      said.length === 1 && said[0].indexOf(JSON.stringify(v)) >= 0 && /365/.test(said[0]), JSON.stringify(said));
  }

  console.log('\nTHORNSWOOD_CHAT_DAYS unset:');
  let r = await run(undefined);
  yes('nothing inside the window goes, the 400-day day does', kept(r).length === INSIDE.length && !r.left[OUTSIDE]);
  yes('/health says 365', days(r) === 365);
  yes('and the log says nothing about the setting', !/THORNSWOOD_CHAT_DAYS/.test(r.log));

  console.log('\nTHORNSWOOD_CHAT_DAYS="500":');
  r = await run('500');
  yes('a whole number above 365 is used: the day 400 days old stays', kept(r).length === INSIDE.length && r.left[OUTSIDE]);
  yes('/health says 500', days(r) === 500);
  yes('and the log says nothing about the setting', !/THORNSWOOD_CHAT_DAYS/.test(r.log));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
