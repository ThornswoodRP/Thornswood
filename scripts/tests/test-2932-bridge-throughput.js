// #2932: how fast the box bridge's own code carries a copy.
//
// One scp from One through the bridge (wss://thornswood.net/box/) sent a
// 19,392,209-byte server build in 10,700 ms, 1.73 MB/s (21 Oct 2026). The
// same bridge, Caddy, sshd and disk took a 50 MB scp from a cloud thread at
// 12.5 MB/s the same day, so the box's side carries several times what One
// got. This runs connect.js and bridge.js for real on loopback, with a sink
// in sshd's place for a copy up and a source for a copy down, so what it
// measures is the bridge's code alone, on this machine's CPU and pipes: on
// a VPS runner that is the box's own CPU and Windows' pipes, the ones ssh's
// ProxyCommand uses on One.
//   1. 64 MB up (connect.js's standard input to the sink), the way scp sends
//      a file: every byte arrives, in order, at FLOOR MB/s or better;
//   2. 64 MB down (the source to connect.js's standard output): the same;
//   3. how big the pieces connect.js reads off its standard input are,
//      since each becomes one WebSocket frame, printed so a run on Windows
//      says what its pipes hand over.
// FLOOR is four times what One got: a bridge that cannot carry that much is
// the bridge's fault, not the line's.
//
// Read only. Nothing outside the temp folder is touched, and nothing leaves
// loopback.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const DIR = path.join(REPO, 'scripts', 'vps', 'bridge');
const MB = 64;
const TOTAL = MB * 1024 * 1024;
const FLOOR = 7;
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-bridge-speed-'));
const tokens = path.join(tmp, 'tokens');
fs.mkdirSync(tokens);
const TOKEN = crypto.randomBytes(32).toString('base64url');
fs.writeFileSync(path.join(tokens, 'speed'), crypto.createHash('sha256').update(TOKEN).digest('hex') + '\n');

// The bytes sent: a pattern each side can check without holding 64 MB twice.
function piece(at, len) {
  const b = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) b[i] = ((at + i) * 2654435761 >>> 24) & 0xff;
  return b;
}
const CHUNK = 64 * 1024;
const PATTERN = [];
for (let at = 0; at < TOTAL; at += CHUNK) PATTERN.push(piece(at, CHUNK));

function checker() {
  let got = 0, bad = -1;
  return {
    take(d) {
      if (bad < 0) {
        for (let i = 0; i < d.length; i++) {
          const at = got + i;
          if (PATTERN[Math.floor(at / CHUNK)][at % CHUNK] !== d[i]) { bad = at; break; }
        }
      }
      got += d.length;
    },
    get got() { return got; },
    get bad() { return bad; },
  };
}

function freePort() {
  return new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}

function pump(stream) {
  let i = 0;
  (function more() {
    while (i < PATTERN.length) {
      if (!stream.write(PATTERN[i++])) return stream.once('drain', more);
    }
  })();
}

async function run(dir) {
  const port = await freePort();
  let target;
  const done = new Promise((resolve) => {
    target = net.createServer((s) => {
      s.on('error', () => {});
      if (dir === 'up') {
        const c = checker();
        let t0 = 0;
        s.on('data', (d) => {
          if (!t0) t0 = Date.now();
          c.take(d);
          if (c.got >= TOTAL) resolve({ ms: Date.now() - t0, got: c.got, bad: c.bad });
        });
      } else {
        pump(s);
      }
    }).listen(0, '127.0.0.1');
  });
  await new Promise((r) => target.once('listening', r));
  const env = Object.assign({}, process.env, {
    THORNSWOOD_BRIDGE_PORT: String(port),
    THORNSWOOD_BRIDGE_TOKENS: tokens,
    THORNSWOOD_BRIDGE_TARGET: '127.0.0.1:' + target.address().port,
  });
  const bridge = spawn(process.execPath, [path.join(DIR, 'bridge.js')], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await new Promise((r) => bridge.stdout.once('data', r));
  const cenv = Object.assign({}, process.env, { THORNSWOOD_BOX_URL: 'ws://127.0.0.1:' + port + '/box/', THORNSWOOD_BOX_TOKEN: TOKEN });
  delete cenv.HTTPS_PROXY; delete cenv.https_proxy;
  const client = spawn(process.execPath, [path.join(DIR, 'connect.js')], { env: cenv, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let result;
  if (dir === 'up') {
    pump(client.stdin);
    result = await done;
  } else {
    result = await new Promise((resolve) => {
      const c = checker();
      let t0 = 0;
      client.stdout.on('data', (d) => {
        if (!t0) t0 = Date.now();
        c.take(d);
        if (c.got >= TOTAL) resolve({ ms: Date.now() - t0, got: c.got, bad: c.bad });
      });
    });
  }
  client.kill(); bridge.kill(); target.close();
  return result;
}

// How big the pieces node reads off a pipe from another process are here:
// a child writes 8 MB in 64 KB writes to its standard output, the way ssh
// writes to its ProxyCommand, and this counts what each read hands over.
function pipePieces() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e',
      'const b=Buffer.alloc(65536,7);let n=0;(function w(){while(n<128){n++;if(!process.stdout.write(b))return process.stdout.once("drain",w)}})()'],
      { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    const sizes = [];
    child.stdout.on('data', (d) => sizes.push(d.length));
    child.on('close', () => resolve(sizes));
  });
}

(async () => {
  console.log("the bridge's code on " + process.platform + ', ' + os.cpus().length + ' CPU(s), node ' + process.version);
  for (const dir of ['up', 'down']) {
    const r = await run(dir);
    const rate = MB / (r.ms / 1000);
    console.log('  ' + dir + ': ' + MB + ' MB in ' + r.ms + ' ms, ' + rate.toFixed(1) + ' MB/s');
    yes(dir + ': every byte arrived, in order', r.got === TOTAL && r.bad < 0);
    yes(dir + ': at ' + FLOOR + ' MB/s or better (' + rate.toFixed(1) + ')', rate >= FLOOR);
  }
  const sizes = await pipePieces();
  const sum = sizes.reduce((a, b) => a + b, 0);
  console.log('  a pipe here hands over ' + sizes.length + ' reads for 8 MB, ' + Math.round(sum / sizes.length) + ' bytes on average, ' + Math.min(...sizes) + ' to ' + Math.max(...sizes));
  yes('every byte came through the pipe', sum === 128 * 65536);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + e.stack); process.exit(1); });
