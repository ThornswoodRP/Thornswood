'use strict';
/*
  test-4355-chat-marks.js

      node voice\tests\test-4355-chat-marks.js

  Issue #4355. A caption above a head had every character that can break a
  line, turn the text round or hide in it taken out (headlines.captionHead),
  but the rest of what people type did not: a plain line went to the room as
  it was typed, /me, /do, /w, /s and /ooc kept direction and zero-width
  marks, and a join name (cleanName) let zero-width ones through. So a
  person could send a line break, a right-to-left override (U+202E) or a
  zero-width space (U+200B) to everybody else's chat box, the line over their
  head and the roster.

  Against the real service spawned in a temp folder on a loopback port of its
  own, with two people standing next to each other (posted to /positions as
  the gamemode would), the first sends each kind of line holding all three,
  and a third person, not in the world yet and so shown by the name they
  joined with, joins under a name holding all three and says a line:

    A  every line reaches the other person, with its words;
    B  no string in anything the other person was sent holds a line break,
       U+202E or U+200B: not the text, not the line over the head, not the
       name, not the roster;
    C  a game command (any other slash line) still goes to the game server
       exactly as it was typed, since a letter or a page carries its own
       lines.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4355-'));
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
      if (m.t === 'welcome') { clearTimeout(late); done({ got: got, send: (o) => ws.send(JSON.stringify(o)) }); }
    };
    ws.onerror = () => bad(new Error('could not join'));
    const late = setTimeout(() => bad(new Error('no welcome')), 4000);
  });
}

// Every string anywhere in a message, with where it was.
function strings(v, at, out) {
  if (typeof v === 'string') out.push([at, v]);
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, at + '[' + i + ']', out));
  else if (v && typeof v === 'object') for (const k of Object.keys(v)) strings(v[k], at + '.' + k, out);
  return out;
}
const MARKS = /[\n\r\u202e\u200b]/;
const shown = (s) => JSON.stringify(s).replace(/[\u202e\u200b]/g, (c) => '\\u' + c.charCodeAt(0).toString(16));

(async function main() {
  try {
    PORT = await freePort('127.0.0.1');
    srv = spawn(process.execPath, ['voice-server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, {
        THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
        THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
        THORNSWOOD_CHAT_BURST: '50'
      })
    });
    srv.stdout.on('data', (d) => { srvLog += d; });
    srv.stderr.on('data', (d) => { srvLog += d; });
    await listening(srv, PORT);

    const a = await join(4355, 'Aela');
    const b = await join(4356, 'Brand');
    // Not in the world yet: their lines go out under the name they joined
    // with (peerName), since there is no position to name them.
    const c = await join(4357, 'Ce\u200bss\u202e\nthe Huntress');
    const r = await fetch('http://127.0.0.1:' + PORT + '/positions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ who: [
        { name: 'Aela', profileId: 4355, pos: [0, 0, 0], cell: 'Tamriel', angleZ: 0 },
        { name: 'Brand', profileId: 4356, pos: [40, 0, 0], cell: 'Tamriel', angleZ: 0 }
      ] })
    });
    yes('both are placed next to each other (' + r.status + ')', r.status === 204);

    const BAD = 'one\ntwo \u202ethree\u200bfour';
    const LINES = [
      ['a plain line', BAD, 'say'],
      ['/me', '/me ' + BAD, 'me'],
      ['/do', '/do ' + BAD, 'do'],
      ['/w', '/w ' + BAD, 'whisper'],
      ['/s', '/s ' + BAD, 'shout'],
      ['/ooc', '/ooc ' + BAD, 'ooc']
    ];
    for (const [what, text] of LINES) {
      const before = b.got.length;
      a.send({ t: 'chat', text: text });
      await until(() => b.got.slice(before).some((m) => m.t === 'chat' && m.profileId === 4355), 3000);
      const line = b.got.slice(before).filter((m) => m.t === 'chat' && m.profileId === 4355)[0];
      yes('A ' + what + ' reaches the other person, words and all',
          !!line && /one/.test(line.text) && /four/.test(line.text), JSON.stringify(b.got.slice(before)));
    }
    a.send({ t: 'chat', text: '/roll ' + BAD });
    await wait(400);
    const q = await (await fetch('http://127.0.0.1:' + PORT + '/commands')).json();
    yes('C a game command still goes to the game server exactly as typed',
        (q.commands || []).some((c) => c.text === '/roll ' + BAD), JSON.stringify(q.commands));
    const was = b.got.length;
    c.send({ t: 'chat', text: 'Well met.' });
    await until(() => b.got.slice(was).some((m) => m.t === 'chat' && m.profileId === 4357), 3000);

    const marked = [];
    b.got.forEach((m, i) => {
      for (const [at, s] of strings(m, 'message ' + i + ' (' + m.t + ')', [])) if (MARKS.test(s)) marked.push(at + ': ' + shown(s));
    });
    yes('B no string the other person was sent holds a line break, U+202E or U+200B (' + marked.length + ' did)',
        marked.length === 0, marked.join('\n'));
    const name = b.got.filter((m) => m.t === 'chat' && m.profileId === 4357).map((m) => m.name)[0];
    yes('  and a join name still reads as the person chose it, the marks taken out (' + shown(name) + ')',
        typeof name === 'string' && /Ce\s?ss/.test(name) && /Huntress/.test(name));
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
