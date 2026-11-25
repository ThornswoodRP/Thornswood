/*
  voice-mesh.js

      node docs/studies/in-game-ui/measure/voice-mesh.js [room sizes...]

  #3208. What today's voice costs the person who talks, measured with today's
  code. The launcher's voice page (launcher/voice-host.html) builds a WebRTC
  connection to everybody on the voice service's roster, which is the whole
  room, and its one microphone track rides every one of them (open() adds it
  to each connection; applyMicTrack only turns the track on and off). So the
  question is how upload and processor time grow with the room.

  This runs the real voice-server.js on loopback with a join token key of its
  own, a small TLS front for it (the page only opens wss), and the real voice
  page, unchanged, in Chromium off disk, the way WebView2 loads it. The
  launcher's side of chrome.webview is stood in for: it hands each page its
  config and a token, and later push to talk. Chromium's fake microphone
  plays a tone.

  One page talks, in a Chromium of its own, so its processes are the only
  ones counted. Everybody else in the room is a page in a second Chromium.
  For each room size it reads, over a fixed window each:

    idle    the talker's microphone shut (push to talk up)
    talking the talker's microphone open (push to talk down)

  the bytes the talker's connections sent (getStats, outbound-rtp audio and
  the transport totals), and the processor time of the talker's Chromium,
  every process of it, from /proc. Linux only, for /proc; no game, no
  launcher, nothing outside a temp folder and loopback ports.

  When some connections never come up (#3430), it measures the ones that
  did and prints, for every page, each pair's signalling and ICE state and
  the candidates it sent to and got from each peer id.

  Chromium here is Playwright's, not Edge's WebView2. Both are Chromium with
  the same WebRTC and Opus, so bytes should match; processor time is this
  machine's and is for comparing room sizes with each other, not a number for
  somebody's PC.
*/
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const tls = require('tls');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const SERVER = path.join(ROOT, 'voice', 'voice-server.js');
const PAGE = path.join(ROOT, 'launcher', 'voice-host.html');
const SIZES = process.argv.slice(2).map(Number).filter((n) => n >= 2);
const ROOMS = SIZES.length ? SIZES : [2, 5, 10, 20];
const WINDOW_MS = Number(process.env.WINDOW_MS || 15000);
const SETTLE_MS = Number(process.env.SETTLE_MS || 8000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

// ------------------------------------------------------------ the service --
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3208-'));
fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(SERVER), 'headlines.js'), path.join(dir, 'headlines.js'));
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
function tokenFor(pid) {
  const b64 = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = 'v2.' + pid + '.' + Date.now() + '.' + b64(crypto.randomBytes(16));
  return body + '.' + b64(crypto.createHmac('sha256', KEY).update(body).digest());
}

async function startService() {
  const port = await freePort();
  const srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_VOICE_BIND: '127.0.0.1',
      THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_CHAT_RANGE: '',
    }),
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  const from = Date.now();
  while (!new RegExp('listening on \\S+:' + port).test(out)) {
    if (Date.now() - from > 15000) throw new Error('the voice service did not start:\n' + out);
    await sleep(50);
  }
  return { srv, port };
}

/* A TLS front, because the page opens nothing but wss. It is a byte pipe to
   the service, so the service sees what Caddy would hand it, minus headers. */
async function startTls(target) {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
    '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem')], { stdio: 'ignore' });
  const port = await freePort();
  const s = tls.createServer({ key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) }, (c) => {
    const u = net.connect(target, '127.0.0.1');
    c.pipe(u).pipe(c);
    c.on('error', () => u.destroy());
    u.on('error', () => c.destroy());
  });
  await new Promise((ok) => s.listen(port, '127.0.0.1', ok));
  return { s, port };
}

// --------------------------------------------------------------- the pages --
const ARGS = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
  '--ignore-certificate-errors', '--autoplay-policy=no-user-gesture-required',
  // What the launcher passes WebView2 (BrowserArgs.NoMdns): host candidates as
  // addresses, not mDNS names, which nothing here would answer.
  '--disable-features=WebRtcHideLocalIpsWithMdns'];

/* The launcher's half of chrome.webview: messages from the page are kept,
   and the harness posts the launcher's messages into the page. */
const WEBVIEW = `
  (function () {
    var heard = [];
    window.__fromPage = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: function (s) { window.__fromPage.push(String(s)); },
      addEventListener: function (k, fn) { if (k === 'message') heard.push(fn); },
      removeEventListener: function () { }
    };
    /* Counted from outside the page, for a pair that never connects (#3430):
       candidates sent to and received from each peer id, candidates added
       and refused, and how many offers and answers were set locally. */
    var ice = window.__ice = { sent: {}, got: {}, added: 0, refused: {}, offers: 0, answers: 0 };
    function bump(o, k) { o[k] = (o[k] || 0) + 1; }
    var addIce = RTCPeerConnection.prototype.addIceCandidate;
    RTCPeerConnection.prototype.addIceCandidate = function () {
      return addIce.apply(this, arguments).then(function (v) { ice.added++; return v; },
        function (e) { bump(ice.refused, String(e && e.message || e).slice(0, 120)); throw e; });
    };
    var setLocal = RTCPeerConnection.prototype.setLocalDescription;
    RTCPeerConnection.prototype.setLocalDescription = function () {
      var pc = this;
      return setLocal.apply(this, arguments).then(function (v) {
        if (pc.localDescription && pc.localDescription.type === 'offer') ice.offers++; else ice.answers++;
        return v;
      });
    };
    // The page's own send and onIce are globals, so they are wrapped once
    // the page has declared them and before the harness configures it.
    window.addEventListener('DOMContentLoaded', function () {
      var send = window.send, onIce = window.onIce;
      window.send = function (o) { if (o && o.t === 'ice') bump(ice.sent, o.to); return send(o); };
      window.onIce = function (m) { bump(ice.got, m.from); return onIce(m); };
    });
    window.__toPage = function (obj) { var e = { data: JSON.stringify(obj) }; heard.forEach(function (fn) { fn(e); }); };
  })();`;

async function openPage(browser, pid, tlsPort) {
  const ctx = await browser.newContext({ permissions: ['microphone'] });
  await ctx.addInitScript(WEBVIEW);
  const page = await ctx.newPage();
  await page.goto('file://' + PAGE);
  await page.evaluate((c) => window.__toPage(c), {
    t: 'config', host: '127.0.0.1', port: tlsPort, profileId: pid, name: 'p' + pid,
    token: tokenFor(pid), base: 'https://127.0.0.1:' + tlsPort, socket: 'wss://127.0.0.1:' + tlsPort + '/',
  });
  // A fresh token for every try the page makes after the first.
  page.__pid = pid;
  return page;
}

async function answerTokens(page) {
  const asks = await page.evaluate(() => {
    const t = window.__fromPage.filter((s) => s.indexOf('"t":"token"') >= 0).length;
    window.__fromPage = window.__fromPage.filter((s) => s.indexOf('"t":"token"') < 0);
    return t;
  });
  for (let i = 0; i < asks; i++) await page.evaluate((m) => window.__toPage(m), { t: 'token', token: tokenFor(page.__pid) });
}

/* Everything the talker's connections have sent so far: RTP audio payload
   and headers, and the transport's own total (DTLS, STUN, SRTP). */
async function sent(page) {
  return page.evaluate(async () => {
    let rtp = 0, header = 0, packets = 0, transport = 0, connected = 0;
    for (const rec of conns.values()) {
      if (rec.pc.connectionState === 'connected') connected++;
      const st = await rec.pc.getStats();
      st.forEach((r) => {
        if (r.type === 'outbound-rtp' && r.kind === 'audio') {
          rtp += r.bytesSent || 0; header += r.headerBytesSent || 0; packets += r.packetsSent || 0;
        }
        if (r.type === 'transport') transport += r.bytesSent || 0;
      });
    }
    return { rtp, header, packets, transport, connected, conns: conns.size };
  });
}

function pidsOf(root) {
  const all = fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d));
  const parent = {};
  for (const p of all) {
    try { parent[p] = fs.readFileSync('/proc/' + p + '/stat', 'utf8').split(') ')[1].split(' ')[1]; } catch (e) { }
  }
  const out = new Set([String(root)]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p in parent) { if (!out.has(p) && out.has(parent[p])) { out.add(p); grew = true; } }
  }
  return [...out];
}
/* The talker's Chromium, found by a switch of its own that Chromium ignores:
   the oldest process whose command line carries it. */
function talkerRoot(mark) {
  const hits = [];
  for (const p of fs.readdirSync('/proc').filter((d) => /^\d+$/.test(d))) {
    try { if (fs.readFileSync('/proc/' + p + '/cmdline', 'utf8').indexOf(mark) >= 0) hits.push(Number(p)); } catch (e) { }
  }
  if (!hits.length) throw new Error('could not find the talker Chromium');
  return Math.min(...hits);
}
function cpuSeconds(root) {
  const hz = 100;
  let ticks = 0;
  for (const p of pidsOf(root)) {
    try {
      const f = fs.readFileSync('/proc/' + p + '/stat', 'utf8').split(') ')[1].split(' ');
      ticks += Number(f[11]) + Number(f[12]);
    } catch (e) { }
  }
  return ticks / hz;
}

async function measure(talker, tpid) {
  const s0 = await sent(talker); const c0 = cpuSeconds(tpid); const t0 = Date.now();
  await sleep(WINDOW_MS);
  const s1 = await sent(talker); const c1 = cpuSeconds(tpid); const secs = (Date.now() - t0) / 1000;
  return {
    connected: s1.connected, conns: s1.conns,
    kbitRtp: Math.round(((s1.rtp + s1.header) - (s0.rtp + s0.header)) * 8 / secs / 100) / 10,
    kbitAll: Math.round((s1.transport - s0.transport) * 8 / secs / 100) / 10,
    packetsPerSec: Math.round((s1.packets - s0.packets) / secs),
    cpuPct: Math.round((c1 - c0) / secs * 1000) / 10,
  };
}

async function room(n, tlsPort) {
  const mark = '--thornswood-talker=' + crypto.randomBytes(6).toString('hex');
  // Both browsers close however the room ends, so a failed run ends too
  // (#6036).
  let tb = null, lb = null;
  try {
    tb = await chromium.launch({ args: ARGS.concat([mark]) });
    lb = await chromium.launch({ args: ARGS });
    const tpid = talkerRoot(mark);
    const talker = await openPage(tb, 1000, tlsPort);
    const others = [];
    for (let i = 1; i < n; i++) others.push(await openPage(lb, 1000 + i, tlsPort));
    const from = Date.now();
    for (;;) {
      for (const p of [talker, ...others]) await answerTokens(p);
      const s = await sent(talker);
      if (s.connected >= n - 1) break;
      if (Date.now() - from > 60000 + n * 3000) {
        console.log('  only ' + s.connected + ' of ' + (n - 1) + ' connections came up');
        // Every page's side of every pair, for #3430: a pair that stays at
        // ICE new on both sides, and who sent candidates to whom.
        for (const p of [talker, ...others]) {
          console.log('  page ' + p.__pid + ' ' + await p.evaluate(() => JSON.stringify({
            peer: myPeer,
            pairs: [...conns.entries()].map(([id, r]) => id + ' ' + r.pc.signalingState + '/' + r.pc.iceConnectionState +
              (r.haveRemote ? '' : ' no remote') + (r.pendingIce.length ? ' ' + r.pendingIce.length + ' pending' : '')),
            ice: window.__ice,
          })));
        }
        break;
      }
      await sleep(500);
    }
    await sleep(SETTLE_MS);
    const idle = await measure(talker, tpid);
    await talker.evaluate(() => window.__toPage({ t: 'ptt', on: true }));
    await sleep(2000);
    const talking = await measure(talker, tpid);
    await talker.evaluate(() => window.__toPage({ t: 'ptt', on: false }));
    return { n, idle, talking };
  } finally {
    if (tb) await tb.close();
    if (lb) await lb.close();
  }
}

const per = (kbit, n) => (n ? Math.round(kbit / n * 10) / 10 : 0);

(async () => {
  let srv = null, front = null;
  const rows = [];
  try {
    const started = await startService();
    srv = started.srv;
    front = await startTls(started.port);
    for (const n of ROOMS) {
      console.log('room of ' + n + '...');
      const r = await room(n, front.port);
      console.log(JSON.stringify(r));
      rows.push(r);
    }
  } finally {
    if (front) front.s.close();
    if (srv) srv.kill();
  }
  console.log('\n| Room | Connections up | Idle upload kbit/s (RTP / all) | Talking upload kbit/s (RTP / all) | Per connection, idle / talking, kbit/s | Talking packets/s | Talker CPU % idle / talking |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) {
    console.log('| ' + r.n + ' | ' + r.talking.connected + ' of ' + (r.n - 1) + ' | ' + r.idle.kbitRtp + ' / ' + r.idle.kbitAll +
      ' | ' + r.talking.kbitRtp + ' / ' + r.talking.kbitAll +
      ' | ' + per(r.idle.kbitAll, r.talking.connected) + ' / ' + per(r.talking.kbitAll, r.talking.connected) +
      ' | ' + r.talking.packetsPerSec + ' | ' + r.idle.cpuPct + ' / ' + r.talking.cpuPct + ' |');
  }
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error(e); process.exitCode = 1; });
