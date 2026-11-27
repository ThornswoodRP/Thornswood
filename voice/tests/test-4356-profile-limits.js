'use strict';
/*
  test-4356-profile-limits.js

      node voice\tests\test-4356-profile-limits.js

  Issue #4356. The chat limit and the caption limit (chatAllow, captionAllow)
  kept their token buckets on each socket's peer record, and onJoin gave every
  socket a full one. So a second socket for the same profile, or the same one
  reconnecting, had a fresh allowance: five more lines, three more captions,
  as often as it liked to open a socket.

  Against the real service spawned in a temp folder on a loopback port of its
  own, with nothing refilled while it runs (five lines and three captions at
  once, one more only after ten minutes):

    A  two sockets for one profile, three lines from each: five reach the
       room, and the sixth sender is told to slow down;
    B  a profile says five lines, closes its socket and opens another inside
       the window: its next line does not reach the room;
    C  captions from two sockets of one profile, two from each: three go out.

  VOICE points it at another copy of voice-server.js (and the headlines.js
  beside it), which is how it was shown to fail on main. Read only apart from
  its own temp folder.
*/
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const REPO_DIR = path.join(__dirname, '..', '..');
const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 1500).split('\n').join('\n      ') : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { if (await cond()) return true; await wait(25); }
  return false;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4356-'));
fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
function tokenFor(pid) {
  const body = 'v2.' + pid + '.' + Date.now() + '.' + crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[voice\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', more); srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said); srv.stderr.on('data', more); srv.on('exit', gone);
  });
}

let PORT = 0, srv = null, srvLog = '';
const sockets = [];
function join(profileId, name) {
  return new Promise((done, bad) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(profileId)]);
    const got = [];
    sockets.push(ws);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      got.push(m);
      if (m.t === 'welcome') {
        clearTimeout(late);
        done({ got: got, send: (o) => ws.send(JSON.stringify(o)),
               close: () => new Promise((r) => { ws.onclose = () => r(); ws.close(); }) });
      }
    };
    ws.onerror = () => bad(new Error('could not join'));
    const late = setTimeout(() => bad(new Error('no welcome')), 4000);
  });
}
const linesFrom = (s, pid) => s.got.filter((m) => m.t === 'chat' && m.profileId === pid).map((m) => m.text);
const slowed = (s) => s.got.some((m) => m.t === 'chat' && m.from === 0 && /^Slow down/.test(String(m.text)));

(async function main() {
  try {
    PORT = await freePort('127.0.0.1');
    srv = spawn(process.execPath, ['voice-server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, {
        THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
        THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
        THORNSWOOD_CHAT_BURST: '5', THORNSWOOD_CHAT_REFILL_MS: '600000',
        THORNSWOOD_CAPTIONS: 'on', THORNSWOOD_CAPTION_BURST: '3', THORNSWOOD_CAPTION_REFILL_MS: '600000'
      })
    });
    srv.stdout.on('data', (d) => { srvLog += d; });
    srv.stderr.on('data', (d) => { srvLog += d; });
    await listening(srv, PORT);
    const room = await join(4500, 'Listener');

    // ------------------------------------------------------------------ A --
    console.log('A. two sockets for one profile share one chat limit:');
    const a1 = await join(4560, 'Aela');
    const a2 = await join(4560, 'Aela');
    for (let i = 0; i < 3; i++) a1.send({ t: 'chat', text: 'first socket ' + i });
    for (let i = 0; i < 3; i++) a2.send({ t: 'chat', text: 'second socket ' + i });
    await until(() => linesFrom(room, 4560).length >= 6 || slowed(a1) || slowed(a2), 3000);
    await wait(400);
    yes('six lines from two sockets of one profile: five reach the room (' + linesFrom(room, 4560).length + ')',
        linesFrom(room, 4560).length === 5, JSON.stringify(linesFrom(room, 4560)));
    // The two sockets' lines can reach the service in either order, so the
    // one held is whichever sent last.
    yes('and the socket whose line was held is told to slow down', slowed(a1) || slowed(a2));

    // ------------------------------------------------------------------ B --
    console.log('\nB. a reconnect inside the window does not refill it:');
    const b1 = await join(4562, 'Brand');
    for (let i = 0; i < 5; i++) b1.send({ t: 'chat', text: 'before ' + i });
    await until(() => linesFrom(room, 4562).length >= 5, 3000);
    yes('five lines go out (' + linesFrom(room, 4562).length + ')', linesFrom(room, 4562).length === 5);
    await b1.close();
    await wait(200);
    const b2 = await join(4562, 'Brand');
    b2.send({ t: 'chat', text: 'after the reconnect' });
    await until(() => slowed(b2) || linesFrom(room, 4562).indexOf('after the reconnect') >= 0, 3000);
    await wait(300);
    yes('a line from the new socket, inside the window, does not reach the room',
        linesFrom(room, 4562).indexOf('after the reconnect') < 0, JSON.stringify(linesFrom(room, 4562)));
    yes('and the new socket is told to slow down', slowed(b2));

    // ------------------------------------------------------------------ C --
    console.log('\nC. two sockets for one profile share one caption limit:');
    const c1 = await join(4563, 'Cass');
    const c2 = await join(4563, 'Cass');
    c1.send({ t: 'captions', share: true });
    c1.send({ t: 'talk', on: true });
    await wait(200);
    for (let i = 0; i < 2; i++) c1.send({ t: 'caption', text: 'one ' + i });
    for (let i = 0; i < 2; i++) c2.send({ t: 'caption', text: 'two ' + i });
    const caps = () => c1.got.filter((m) => m.t === 'caption' && m.profileId === 4563).map((m) => m.text);
    await until(() => caps().length >= 4, 2000);
    await wait(300);
    yes('four captions from two sockets of one profile: three go out (' + caps().length + ')',
        caps().length === 3, JSON.stringify(caps()));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, srvLog);
  } finally {
    for (const s of sockets) { try { s.close(); } catch (e) { } }
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
