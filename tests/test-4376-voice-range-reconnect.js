/*
  test-4376-voice-range-reconnect.js

      node tests\test-4376-voice-range-reconnect.js

  #4376. When the game's own voice carries the audio, the overlay
  (game\ui\thornswood-voice.js) told the room its range once, the first
  time it got on the chat's socket (game\ui\thornswood-chat.js). A dropped
  connection comes back with a new join that says no range, the service
  starts the new connection at local, and nothing said the range again: the
  microphone read whisper or yell while the room heard local. The same post
  also went nowhere when the overlay got on before the socket's first
  welcome, since the socket takes nothing before it is in.

  This runs the real chat and overlay sources in node's vm against the real
  voice service on loopback, with somebody else in the same room on a raw
  socket. What that somebody holds for each peer of ours, from the rosters
  and the range messages the service sends, is what the room hears.

  1. A page in the room picks whisper, and the room hears whisper.
  2. Its connection drops and comes back as a new peer, and the room hears
     whisper from the new peer, with nothing picked again.
  3. A page whose overlay is on before its socket has joined picks yell,
     then joins, and the room hears yell.
  4. The overlay says the range on every welcome, in its own source.

  Read only, but for the service's copy in the temp folder.
*/
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const SERVER = path.join(REPO, 'voice', 'voice-server.js');
const OVERLAY = process.env.VOICE_OVERLAY || path.join(REPO, 'game', 'ui', 'thornswood-voice.js');
const CHAT = path.join(REPO, 'game', 'ui', 'thornswood-chat.js');
const read = (f) => fs.readFileSync(f, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
async function until(cond, ms) {
  const from = Date.now();
  while (Date.now() - from < (ms || 10000)) {
    if (cond()) return true;
    await sleep(50);
  }
  return !!cond();
}

// ------------------------------------------------------------ the service --
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4376-'));
fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(SERVER), 'headlines.js'), path.join(dir, 'headlines.js'));
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
function tokenFor(pid) {
  const b64 = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = 'v2.' + pid + '.' + Date.now() + '.' + b64(crypto.randomBytes(16));
  return body + '.' + b64(crypto.createHmac('sha256', KEY).update(body).digest());
}
function freePort() {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
let PORT = 0, BASE = '', srv = null, srvLog = '';
async function start() {
  PORT = await freePort();
  BASE = 'http://127.0.0.1:' + PORT;
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
      THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_CHAT_RANGE: '',
    }),
  });
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  const up = await until(() => new RegExp('\\[voice\\] listening on \\S+:' + PORT + '\\b').test(srvLog), 15000);
  if (!up) throw new Error('the voice service did not say it was listening. It printed:\n' + srvLog);
}

/*
  Everybody here stands in one room, since only somebody in the world holds
  a voice place and is on the roster (#3570), and the view goes stale after
  three seconds without the feed (#5516), so it is sent five times a second
  as the gamemode sends it.
*/
let seatFeed = null;
function seat(pids) {
  const who = pids.map((pid) => ({ profileId: pid, pos: [0, 0, 0], angleZ: 0, cell: 'a room' }));
  const post = () => fetch(BASE + '/positions', { method: 'POST', body: JSON.stringify({ who: who }) });
  seatFeed = setInterval(() => { post().catch(() => { }); }, 200);
  return post();
}

// ---------------------------------------- the room, on a raw socket -------
/*
  Somebody else in the room. What it holds for each peer is what its own
  overlay would apply: the range on the newest roster that names the peer,
  then every range message from that peer since, in the order they came.
*/
const raws = [];
function listener(pid) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const s = net.connect(PORT, '127.0.0.1', () => {
      s.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
              'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Protocol: thornswood, ' + tokenFor(pid) + '\r\n' +
              'Sec-WebSocket-Version: 13\r\n\r\n');
    });
    raws.push(s);
    const room = { heard: {}, got: [], sock: s };
    let buf = Buffer.alloc(0), shook = false;
    const drain = () => {
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const body = buf.slice(off, off + len);
        buf = buf.slice(off + len);
        if (op !== 1) continue;
        let m = null;
        try { m = JSON.parse(body.toString('utf8')); } catch (e) { }
        if (!m) continue;
        room.got.push(m);
        if (m.t === 'peers') { (m.peers || []).forEach((p) => { room.heard[p.peer] = p.mode || 'local'; }); }
        if (m.t === 'vmode') { room.heard[Number(m.from)] = m.mode; }
      }
    };
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!shook) {
        const at = buf.indexOf('\r\n\r\n');
        if (at < 0) return;
        shook = true;
        buf = buf.slice(at + 4);
        clearTimeout(late);
        send(s, { t: 'join', profileId: pid, name: 'Listener ' + pid });
        resolve(room);
      }
      drain();
    });
    s.on('error', () => { });
    const late = setTimeout(() => reject(new Error('no handshake in four seconds')), 4000);
  });
}
function send(s, obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length])
                                 : (() => { const h = Buffer.alloc(4); h[0] = 0x81; h[1] = 0x80 | 126; h.writeUInt16BE(data.length, 2); return h; })();
  const mask = crypto.randomBytes(4);
  const body = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) body[i] = data[i] ^ mask[i & 3];
  s.write(Buffer.concat([head, mask, body]));
}

// ------------------------------------------------------- the game's page --
/*
  The chat file, which holds the socket, and the voice overlay, which gets on
  it when the voice plugin configures it. No Web Audio here, so the overlay
  opens no peer connection: what is measured is what it tells the room.
*/
const CHAT_SRC = read(CHAT);
const OVERLAY_SRC = read(OVERLAY);
const pages = [];
function element() {
  return { style: {}, className: '', innerHTML: '', textContent: '', id: '', setAttribute: () => { }, appendChild: () => { } };
}
function gamePage(name, pid, withToken) {
  const page = { name: name, pid: pid, said: [], sockets: [], timers: [] };
  function Sock(url, protocols) {
    const real = new WebSocket('ws://127.0.0.1:' + PORT + '/', protocols);
    page.sockets.push(real);
    const self = this;
    self.onopen = self.onmessage = self.onclose = self.onerror = null;
    Object.defineProperty(self, 'readyState', { get: () => real.readyState });
    real.onopen = () => { if (self.onopen) self.onopen({}); };
    real.onmessage = (ev) => { if (self.onmessage) self.onmessage({ data: ev.data }); };
    real.onclose = () => { if (self.onclose) self.onclose({}); };
    real.onerror = () => { if (self.onerror) self.onerror({}); };
    self.send = (d) => real.send(d);
    self.close = () => { try { real.close(); } catch (e) { } };
  }
  const box = {
    THORNSWOOD: { host: 'thornswood.test', port: 443, profileId: pid, name: name, token: withToken ? tokenFor(pid) : '',
                  base: 'https://thornswood.test/voice' },
    skyrimPlatform: { sendMessage: (to, line) => page.said.push(to + ': ' + line) },
    document: { createElement: () => element(), body: element(), head: element() },
    navigator: {},
    location: { href: 'file:///Data/Platform/UI/index.html' },
    isSecureContext: true,
    WebSocket: Sock,
    fetch: () => Promise.reject(new Error('no launcher here')),
    console: { log: (l) => page.said.push('console: ' + l) },
    setTimeout: (f, ms) => { const h = setTimeout(f, ms); page.timers.push(h); return h; },
    clearTimeout: (h) => clearTimeout(h),
    setInterval: (f, ms) => { const h = setInterval(f, ms); page.timers.push(h); return h; },
    clearInterval: (h) => clearInterval(h),
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(CHAT_SRC, box, { filename: 'thornswood-chat.js' });
  vm.runInContext(OVERLAY_SRC, box, { filename: 'thornswood-voice.js' });
  page.box = box;
  page.peer = () => Number(box.thornswoodNet.peer()) || 0;
  page.up = () => box.thornswoodNet.isUp();
  page.configure = () => box.thornswoodVoice.configure({ host: 'thornswood.test', port: 443, profileId: pid, name: name,
                                                         pushToTalk: true, microphone: false, micName: '' });
  page.asked = () => page.said.filter((l) => l === 'thornswood-front: token? ' + pid).length;
  pages.push(page);
  return page;
}
function closePage(page) {
  for (const h of page.timers) { clearTimeout(h); clearInterval(h); }
  for (const s of page.sockets) { try { s.onclose = null; s.close(); } catch (e) { } }
}

// ----------------------------------------------------------------- checks --
async function reconnect(room) {
  console.log('\n1 and 2. a page picks whisper, and its connection drops and comes back:');
  const G = gamePage('Gerdur', 701, true);
  yes('the game\'s chat socket joins the room', await until(() => G.peer() > 0 && G.up()));
  G.configure();
  G.box.thornswoodVoice.setMode('whisper');
  const first = G.peer();
  yes('the room hears whisper from it', await until(() => room.heard[first] === 'whisper'));

  // The connection drops, as a lost network does: the socket closes under
  // the page, the chat asks the front for a fresh token and joins again.
  const n = G.asked();
  G.sockets[G.sockets.length - 1].close();
  yes('the chat sees the drop and asks for a fresh token', await until(() => G.asked() > n, 15000));
  G.box.thornswoodNet.setToken(tokenFor(701));
  yes('and joins again as a new peer', await until(() => G.up() && G.peer() > 0 && G.peer() !== first, 10000));
  const second = G.peer();
  yes('the room has the new peer on its roster', await until(() => room.heard[second] !== undefined));
  yes('the microphone on the page still reads whisper', G.box.thornswoodVoice.setMode('whisper') === 'whisper');
  yes('and the room hears whisper from the new peer, with nothing picked again',
      await until(() => room.heard[second] === 'whisper', 5000));
  if (room.heard[second] !== 'whisper') console.log('      the room hears ' + room.heard[second] + ' from peer ' + second);
  closePage(G);
}

async function lateJoin(room) {
  console.log('\n3. an overlay on before its socket has joined:');
  const H = gamePage('Hulda', 702, false);
  H.configure();
  H.box.thornswoodVoice.setMode('yell');
  yes('the chat asks for a token', await until(() => H.asked() >= 1));
  yes('and has not joined', !H.up() && H.peer() === 0);
  H.box.thornswoodNet.setToken(tokenFor(702));
  yes('once it has one it joins', await until(() => H.up() && H.peer() > 0));
  const id = H.peer();
  yes('and the room hears yell from it', await until(() => room.heard[id] === 'yell', 5000));
  if (room.heard[id] !== 'yell') console.log('      the room hears ' + room.heard[id] + ' from peer ' + id);
  closePage(H);
}

function source() {
  console.log('\n4. the overlay\'s own source:');
  yes('the range is said on every welcome',
      /if \(m\.t === 'welcome'\) \{ myPeer = Number\(m\.peer\) \|\| 0; sayMode\(\); return; \}/.test(OVERLAY_SRC));
  yes('and the chat hands every welcome to the overlay after it marks the socket in',
      /if \(msg\.t === 'welcome'\) \{[\s\S]*?joined = true;[\s\S]*?fanout\(msg\);/.test(CHAT_SRC));
}

(async () => {
  await start();
  await seat([700, 701, 702]);
  const room = await listener(700);
  yes('somebody else is in the room to listen', await until(() => room.got.some((m) => m.t === 'welcome')));
  await reconnect(room);
  await lateJoin(room);
  source();
})().catch((e) => {
  fail++;
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
}).then(() => {
  if (seatFeed) clearInterval(seatFeed);
  pages.forEach(closePage);
  for (const s of raws) { try { s.destroy(); } catch (e) { } }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } };
  process.exitCode = fail ? 1 : 0;
  if (srv && srv.exitCode === null) { srv.once('exit', rm); srv.kill(); }
  else { rm(); }
});
