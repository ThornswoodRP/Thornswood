'use strict';
/*
  test-chat-retention.js

  Issue #2191: a chat day past THORNSWOOD_CHAT_DAYS that will not delete used
  to be dropped without a word. This spawns the real voice-server.js in a
  scratch folder with one old day that can go and one that cannot (a folder
  under a day's name, which no unlink removes), and checks the failure is a
  structured line naming the file and the code and never what it holds, that
  /health counts it, and that the day that could go went.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const os = require('os');

let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-chatretain-'));
fs.copyFileSync(path.join(__dirname, '..', 'voice-server.js'), path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
const CHAT_DIR = path.join(dir, 'chat');
fs.mkdirSync(CHAT_DIR);
const SECRET = 'a line nobody may see in the log';
fs.writeFileSync(path.join(CHAT_DIR, '2020-01-01.jsonl'), JSON.stringify({ text: SECRET }) + '\n');
fs.mkdirSync(path.join(CHAT_DIR, '2020-01-02.jsonl'));
fs.writeFileSync(path.join(CHAT_DIR, '2020-01-02.jsonl', 'inside.txt'), SECRET);
const today = new Date();
const todayName = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0') + '.jsonl';
fs.writeFileSync(path.join(CHAT_DIR, todayName), JSON.stringify({ text: 'today' }) + '\n');

function freePort() {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

/* Waits for this run's own "[voice] listening on ...:port" line (#1703), so
   nothing is asked of a port something else may have taken in between. */
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[voice\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') + 'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
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

(async () => {
  const port = await freePort();
  const srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(port),
      THORNSWOOD_SITE: 'http://127.0.0.1:9',
      THORNSWOOD_CHAT_DIR: CHAT_DIR,
      THORNSWOOD_CHAT_DAYS: '30',
    }),
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  let up = false;
  try { await listening(srv, port); up = true; } catch (e) { log += '\n' + e.message; }
  yes('the voice service started', up);
  let health = null;
  if (up) {
    try { health = await (await fetch('http://127.0.0.1:' + port + '/health')).json(); } catch (e) { }
  }
  srv.kill();
  await new Promise((ok) => { if (srv.exitCode !== null) ok(); else srv.once('close', ok); });

  const lines = log.split(/\r?\n/).filter((l) => l.indexOf('[voice] chat-retention ') === 0);
  let failed = null;
  for (const l of lines) {
    try { const o = JSON.parse(l.slice('[voice] chat-retention '.length)); if (o.file === '2020-01-02.jsonl') failed = o; } catch (e) { }
  }
  yes('the old day that can go is gone', !fs.existsSync(path.join(CHAT_DIR, '2020-01-01.jsonl')));
  yes('today is kept', fs.existsSync(path.join(CHAT_DIR, todayName)));
  yes('the day that would not go is said, as a structured line', !!failed);
  yes('  naming the event, the file and an error code', !!failed && failed.event === 'delete-failed' && typeof failed.code === 'string' && failed.code.length > 0);
  yes('  with how far past retention it is and how many passes have failed', !!failed && failed.daysPastRetention > 0 && failed.failures === 1);
  yes('no line of the log holds what a chat day holds', log.indexOf(SECRET) === -1);
  yes('/health counts the day past its time', !!health && !!health.chatRetention && health.chatRetention.overdueDays === 1);
  if (fail) { console.log('log:\n' + log); }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();