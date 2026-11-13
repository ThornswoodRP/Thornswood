/*
  test-4206-voice-page-shapes.js

      node voice\tests\test-4206-voice-page-shapes.js

  Issue #4206. A joined socket that sent { t: 'chat', text: { toString: 0 } }
  stopped the whole voice service: String() on an object with no callable
  toString throws, and the socket's data handler runs onmessage with nothing
  around it, so the throw left the process and every socket went with it.
  The join's name and mode, a voice mode change, a caption, and the to of an
  offer or a candidate were read the same way (String or Number on whatever
  the page sent).

  Against the real service spawned in a temp folder on a loopback port of its
  own, one shape at a time, with a fresh service whenever the last one
  stopped, so each shape shows on its own:

    A  a chat line whose text is an object: the service stays up, the line
       goes nowhere, and the same socket's next plain line still comes back;
    B  a join whose name, mode and profileId are objects: the service stays
       up and the socket is still welcomed, under the profile its token
       proved;
    C  a voice mode change, a caption, and an offer and a candidate whose to
       is an object: the service stays up, and the sender is still answered;
    D  after every shape, somebody else can still join and still hears;
    E  where a message is handed to onmessage, a fault in handling it closes
       that one socket and says so in the log, and does not leave the
       process.

  VOICE points it at another copy of voice-server.js, which is how it was
  shown to fail on main. Read only apart from its own temp folder.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4206-'));
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
    const gone = (code) => end(new Error('the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', more); srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said); srv.stderr.on('data', more); srv.on('exit', gone);
  });
}

// The service under test. up() starts one when there is none running, so a
// shape that stopped the last one does not hide the shapes after it.
let PORT = 0, srv = null, srvLog = '', exited = null;
const sockets = [];
async function up() {
  if (srv && exited === null) return;
  PORT = await freePort('0.0.0.0');
  exited = null;
  srvLog = '';
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_SITE: '',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_CAPTIONS: 'on'
    })
  });
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  srv.on('exit', (code) => { exited = code; });
  await listening(srv, PORT);
}
// Still running, and still answering a new socket on its port.
async function stillUp() {
  await wait(300);
  if (exited !== null) return 'the service stopped (exit ' + exited + '). It printed:\n' + srvLog;
  try { await join(4209, 'Lydia'); } catch (e) { return 'a new socket was not welcomed: ' + e.message + '\n' + srvLog; }
  return '';
}

/* Open a socket as somebody and send the join this page sends (raw, so a
   join can carry any shape), keeping everything the service sends back. */
function join(profileId, name, raw) {
  return new Promise((done, bad) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(profileId)]);
    const got = [];
    let closed = false;
    sockets.push(ws);
    ws.onopen = () => ws.send(raw || JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      got.push(m);
      if (m.t === 'welcome') {
        done({ got: got, welcome: m, closed: () => closed, send: (o) => ws.send(typeof o === 'string' ? o : JSON.stringify(o)) });
      }
    };
    ws.onclose = () => { closed = true; };
    ws.onerror = () => bad(new Error('could not join'));
    setTimeout(() => bad(new Error('no welcome')), 4000);
  });
}

// What the page's own JSON can hold and String or Number cannot read.
const OBJ = '{"toString":0,"valueOf":0}';

async function plainComesBack(me, words) {
  me.send({ t: 'chat', text: words });
  return until(() => me.got.some((m) => m.t === 'chat' && m.text === words), 3000);
}

(async function main() {
  try {
    // ------------------------------------------------------------------ A --
    console.log('A. a chat line whose text is an object:');
    await up();
    const a = await join(4201, 'Aela');
    a.send('{"t":"chat","text":' + OBJ + '}');
    let down = await stillUp();
    yes('the service stays up', !down, down);
    yes('and the line goes nowhere', !a.got.some((m) => m.t === 'chat' && m.from !== 0 && typeof m.text !== 'string'));
    yes('and the same socket\'s next plain line still comes back', !down && !a.closed() && await plainComesBack(a, 'after the object'));

    // ------------------------------------------------------------------ B --
    console.log('\nB. a join whose name, mode and profileId are objects:');
    await up();
    let b = null, bWhy = '';
    try {
      b = await join(4202, '', '{"t":"join","profileId":' + OBJ + ',"name":' + OBJ + ',"mode":' + OBJ + '}');
    } catch (e) { bWhy = e.message; }
    down = await stillUp();
    yes('the service stays up', !down, down);
    yes('and the socket is welcomed', !!b, bWhy);
    yes('under the profile its token proved', !!b && b.welcome.profileId === 4202, b && JSON.stringify(b.welcome));

    // ------------------------------------------------------------------ C --
    console.log('\nC. a mode change, a caption, an offer and a candidate:');
    const SHAPES = [
      ['a voice mode change whose mode is an object', '{"t":"vmode","mode":' + OBJ + '}'],
      ['a caption whose text is an object', '{"t":"caption","text":' + OBJ + '}'],
      ['an offer whose to is an object', '{"t":"sdp","to":' + OBJ + ',"sdp":{"type":"offer","sdp":"v=0"}}'],
      ['a candidate whose to is an object', '{"t":"ice","to":' + OBJ + ',"candidate":{"candidate":"candidate:1"}}']
    ];
    for (const [what, raw] of SHAPES) {
      await up();
      const c = await join(4203, 'Cicero');
      // A caption goes out only while the talk key is down.
      c.send({ t: 'captions', share: true, see: true });
      c.send({ t: 'talk', on: true });
      c.send(raw);
      down = await stillUp();
      yes(what + ': the service stays up', !down, down);
      yes('  and the sender is still answered', !down && !c.closed() && await plainComesBack(c, 'after ' + what));
    }

    // ------------------------------------------------------------------ D --
    console.log('\nD. after every shape, the room still works:');
    await up();
    const d1 = await join(4204, 'Dagny');
    for (const raw of ['{"t":"chat","text":' + OBJ + '}', '{"t":"vmode","mode":' + OBJ + '}',
                       '{"t":"caption","text":' + OBJ + '}', '{"t":"sdp","to":' + OBJ + '}', '{"t":"ice","to":' + OBJ + '}']) {
      d1.send(raw);
    }
    down = await stillUp();
    yes('one socket sending all of them leaves the service up', !down, down);
    let d2 = null;
    if (!down) { try { d2 = await join(4205, 'Erik'); } catch (e) { } }
    yes('somebody else can still join', !!d2);
    yes('and a socket that was already in still hears', !down && !d1.closed() && await plainComesBack(d1, 'still in the room'));

    // ------------------------------------------------------------------ E --
    console.log('\nE. a fault in handling one message costs one socket:');
    const src = fs.readFileSync(VOICE, 'utf8');
    const feed = (/\n  feed\(chunk\) \{[\s\S]*?\n  \}\n/.exec(src) || [''])[0];
    const hand = (/try \{\s*this\.onmessage\(msg\);?\s*\} catch \((\w+)\) \{([\s\S]*?)\n\s*\}/.exec(feed)) || null;
    yes('Sock.feed hands each message to onmessage inside a try', !!hand, feed.slice(-600));
    yes('whose catch closes this socket', !!hand && /this\.close\(\)/.test(hand[2]), hand && hand[2]);
    yes('and says in the log what it was', !!hand && /console\.(log|error)\(/.test(hand[2]) && new RegExp('\\b' + hand[1] + '\\b').test(hand[2]),
        hand && hand[2]);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, srvLog);
  } finally {
    for (const s of sockets) { try { s.close(); } catch (e) { } }
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
