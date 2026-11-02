// #2753, #2891: ssh to the box goes inside a WebSocket.
//
// A cloud Claude thread's proxy carries HTTPS only, and port 22 takes no
// outside address once everybody comes this way, so ssh goes through
// scripts/vps/bridge: connect.js (ssh's ProxyCommand) opens a WebSocket,
// through the proxy when there is one, to bridge.js (on the box behind
// Caddy), which joins it to sshd. This runs both for real on loopback:
//   1. ws.js frames: every length form, masked and not, fragments, pieces of
//      one byte, and the frames a peer must never send;
//   2. bridge.js, spawned with a folder of two holders' token digests and an
//      echo server in sshd's place: a plain request is a 404, an upgrade with
//      no token, a wrong one, a token written raw instead of as its digest,
//      or one whose holder was taken off is a 401 while the other holder
//      still gets in, a ninth session is a 503, the log names the holder and
//      never the token, and bytes go there and back intact, 3 MB included;
//   3. connect.js, spawned the way ssh spawns it, through a stand-in for the
//      cloud proxy that answers CONNECT: what goes in on standard input comes
//      back on standard output, with the token from the environment or from
//      the file THORNSWOOD_BOX_TOKEN_FILE names, and a wrong token, a named
//      file that is not there or a proxy that refuses the tunnel exits 1
//      saying which;
//   4. connect.js against a front that takes the upgrade and never answers,
//      as something between One and the bridge did on 22 Oct 2026 (#3297):
//      once the opening is slow it says which stage it is waiting at before
//      anything can end it, ended by SIGHUP it says the stage, its own
//      deadline says the stage, and an answer that is not the WebSocket
//      carries its cf-ray.
//      The bridge's open line says how long sshd took.
//   5. one WebSocket is not the session (#3214): through a front that cuts
//      every connection at once, as Cloudflare's restarts do, 4 MB there and
//      back arrives byte for byte across three cuts with nothing said on
//      standard error; a front that goes deaf both ways is taken for gone and
//      the bridge hands the session to the new WebSocket; somebody else's
//      token, a name never given, a bad count and a session let go after its
//      hold are refused; and a bridge from before then still ends a session
//      with its WebSocket.
//
// Read only. Nothing outside the temp folder is touched, and nothing leaves
// loopback.
'use strict';
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const DIR = path.join(REPO, 'scripts', 'vps', 'bridge');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }

const ws = require(path.join(DIR, 'ws.js'));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-bridge-'));
// The box holds each token's SHA-256 in hex, in a file named for its holder,
// as Grant-BoxAccess.ps1 writes it.
const tokens = path.join(tmp, 'tokens');
fs.mkdirSync(tokens);
const digest = (t) => crypto.createHash('sha256').update(t).digest('hex');
const TOKEN = crypto.randomBytes(32).toString('base64url');
const OTHER = crypto.randomBytes(32).toString('base64url');
const RAW = crypto.randomBytes(32).toString('base64url');
fs.writeFileSync(path.join(tokens, 'cloud'), digest(TOKEN) + '\n');
fs.writeFileSync(path.join(tokens, 'djinn'), digest(OTHER) + '\n');
// A token written as it is, not as its digest, and a good digest under a
// name the bridge does not take: neither lets anybody in.
fs.writeFileSync(path.join(tokens, 'raw'), RAW + '\n');
const STRAY = crypto.randomBytes(32).toString('base64url');
fs.writeFileSync(path.join(tokens, 'Not A Name.txt'), digest(STRAY) + '\n');
const tokenFile = path.join(tmp, 'thornswood-box-token');
fs.writeFileSync(tokenFile, OTHER + '\r\n');

// ---- 1. frames ---------------------------------------------------------------
function roundTrip(len, mask) {
  const data = crypto.randomBytes(len);
  const r = new ws.Reader({ masked: mask });
  const out = r.push(ws.encode(ws.OP.BINARY, data, mask));
  return out.length === 1 && out[0].op === ws.OP.BINARY && out[0].data.equals(data);
}
for (const len of [0, 1, 125, 126, 65535, 65536, 300000]) {
  yes('a ' + len + ' byte frame comes back whole, masked and not', roundTrip(len, true) && roundTrip(len, false));
}
{
  const data = crypto.randomBytes(5000);
  const f = ws.encode(ws.OP.BINARY, data, true);
  const r = new ws.Reader({ masked: true });
  let got = [];
  for (let i = 0; i < f.length; i++) got = got.concat(r.push(f.subarray(i, i + 1)));
  yes('a frame handed over one byte at a time comes out once, whole', got.length === 1 && got[0].data.equals(data));
}
{
  const a = Buffer.from('part one '), b = Buffer.from('and two');
  const f1 = ws.encode(ws.OP.BINARY, a, true); f1[0] &= 0x7f;          // not FIN
  const f2 = ws.encode(ws.OP.CONT, b, true);
  const ping = ws.encode(ws.OP.PING, Buffer.from('p'), true);
  const r = new ws.Reader({ masked: true });
  const got = r.push(Buffer.concat([f1, ping, f2]));
  yes('a fragmented message comes back as one, with a ping between its parts let through',
    got.length === 2 && got[0].op === ws.OP.PING && got[1].op === ws.OP.BINARY && got[1].data.toString() === 'part one and two');
}
function throws(what, fn) { let t = false; try { fn(); } catch (e) { t = true; } yes(what, t); }
throws('a server refuses an unmasked frame', () => new ws.Reader({ masked: true }).push(ws.encode(ws.OP.BINARY, Buffer.from('x'), false)));
throws('a client refuses a masked frame', () => new ws.Reader({ masked: false }).push(ws.encode(ws.OP.BINARY, Buffer.from('x'), true)));
throws('a frame that says it is over a megabyte is refused before it is held', () => {
  const h = Buffer.alloc(14); h[0] = 0x82; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(ws.MAX_FRAME + 1), 2);
  new ws.Reader({ masked: true }).push(h);
});
throws('a control frame over 125 bytes is refused', () => new ws.Reader({ masked: true }).push(ws.encode(ws.OP.PING, Buffer.alloc(126), true)));
throws('a continuation with nothing to continue is refused', () => new ws.Reader({ masked: true }).push(ws.encode(ws.OP.CONT, Buffer.from('x'), true)));
{
  // Carry (#3214): what was sent is kept until acked, and a new WebSocket
  // gets again exactly what is past what the far end says it has.
  const c = new ws.Carry();
  c.out(Buffer.from('abcde')); c.out(Buffer.from('fgh')); c.out(Buffer.from('ijkl'));
  c.ack(2);
  yes('Carry keeps what is not acked', c.keptBytes === 10 && c.acked === 2 && c.sent === 12);
  yes('  and sends again exactly what is past the far end\'s count', Buffer.concat(c.since(6)).toString() === 'ghijkl' && c.keptBytes === 6);
  throws('  an ack below one already given is refused', () => c.ack(5));
  throws('  an ack past what was sent is refused', () => c.ack(13));
  c.took(7);
  yes('  what came in is owed an ack until told', c.owed === 7 && ((c.told = c.got), c.owed === 0));
}
yes('the handshake answer is the one RFC 6455 gives for its own example key', ws.accept('dGhlIHNhbXBsZSBub25jZQ==') === 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');

// ---- helpers -----------------------------------------------------------------
function freePort() {
  return new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
}
function waitFor(fn, ms) {
  return new Promise((resolve) => {
    const until = Date.now() + ms;
    (function poll() { if (fn()) return resolve(true); if (Date.now() > until) return resolve(false); setTimeout(poll, 20); })();
  });
}
// A raw upgrade, so the answer is read exactly as it came.
function upgrade(port, headers) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    let got = '';
    s.on('data', (d) => { got += d.toString('latin1'); if (got.indexOf('\r\n\r\n') >= 0) { s.destroy(); resolve(got.split('\r\n')[0]); } });
    s.on('error', () => resolve(''));
    s.on('close', () => resolve(got.split('\r\n')[0]));
    const lines = ['GET / HTTP/1.1', 'Host: x'].concat(headers);
    s.write(lines.join('\r\n') + '\r\n\r\n');
  });
}
const WS_HEADERS = ['Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64')];

// Runs connect.js the way ssh does: bytes on stdin, bytes back on stdout.
function runClient(env, input, waitMs) {
  return new Promise((resolve) => {
    const e = Object.assign({}, process.env, env);
    delete e.HTTPS_PROXY; delete e.https_proxy;
    if (env.HTTPS_PROXY) e.HTTPS_PROXY = env.HTTPS_PROXY;
    const c = spawn(process.execPath, [path.join(DIR, 'connect.js')], { env: e });
    const out = []; let err = '';
    c.stdout.on('data', (d) => out.push(d));
    c.stderr.on('data', (d) => { err += d; });
    let expect = input.length;
    c.stdout.on('data', () => { if (Buffer.concat(out).length >= expect) c.stdin.end(); });
    c.on('close', (code) => resolve({ code, out: Buffer.concat(out), err }));
    c.stdin.on('error', () => {});
    c.stdin.write(input);
    if (!input.length) c.stdin.end();
    setTimeout(() => c.kill(), waitMs || 10000);
  });
}

(async () => {
  const echo = net.createServer((s) => { s.on('error', () => {}); s.pipe(s); });
  await new Promise((r) => echo.listen(0, '127.0.0.1', r));
  const echoPort = echo.address().port;
  const port = await freePort();
  let log = '';
  const bridge = spawn(process.execPath, [path.join(DIR, 'bridge.js')], {
    env: Object.assign({}, process.env, {
      THORNSWOOD_BRIDGE_PORT: String(port),
      THORNSWOOD_BRIDGE_TOKENS: tokens,
      THORNSWOOD_BRIDGE_TARGET: '127.0.0.1:' + echoPort,
      THORNSWOOD_BRIDGE_RESUME_MS: '2000',
    }),
  });
  bridge.stdout.on('data', (d) => { log += d; });
  bridge.stderr.on('data', (d) => { log += d; });
  // A stand-in for the cloud proxy: answers CONNECT and pipes, or refuses.
  let connects = [];
  let refuseTunnel = false;
  const proxy = net.createServer((s) => {
    s.on('error', () => {});
    s.once('data', (d) => {
      const line = d.toString('latin1').split('\r\n')[0];
      connects.push(line);
      if (refuseTunnel) { s.end('HTTP/1.1 403 Forbidden\r\n\r\n'); return; }
      const m = /^CONNECT ([^:]+):(\d+) HTTP\/1\.1$/.exec(line);
      const up = net.connect(Number(m[2]), m[1] === 'localhost' ? '127.0.0.1' : m[1], () => {
        s.write('HTTP/1.1 200 Connection established\r\n\r\n');
        s.pipe(up); up.pipe(s);
      });
      up.on('error', () => s.destroy());
    });
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const proxyUrl = 'http://127.0.0.1:' + proxy.address().port;

  try {
    yes('the bridge starts on loopback and says where it joins to', await waitFor(() => /listening on 127\.0\.0\.1:\d+, joining to 127\.0\.0\.1:\d+/.test(log), 5000));

    // ---- 2. the bridge -----------------------------------------------------
    const plain = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/' }, (res) => { let b = ''; res.setEncoding('utf8'); res.on('data', (d) => { b += d; }); res.on('end', () => resolve({ code: res.statusCode, body: b.trim() })); }).on('error', () => resolve({ code: 0, body: '' })));
    yes('a plain request is a 404', plain.code === 404);
    // #2875: the site's own 404 says "not here", so the bridge's line has to
    // be one the site never sends, or a check through Caddy takes the site
    // for the bridge.
    yes('  saying "box bridge: not here", the line Install-Bridge.ps1 looks for', plain.body === 'box bridge: not here');
    const siteSays = require('./site-files').source();
    yes('  which the site never says', siteSays.indexOf('box bridge') < 0);
    yes('an upgrade with no token is a 401', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS)));
    yes('an upgrade with a wrong token is a 401', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN + 'x']))));
    yes('the token as a bare header, without "Bearer", is a 401', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: ' + TOKEN]))));
    yes('an upgrade with the token but no WebSocket key is a 400', /^HTTP\/1\.1 400/.test(await upgrade(port, ['Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Authorization: Bearer ' + TOKEN])));
    yes('with the token it switches protocols', /^HTTP\/1\.1 101/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN]))));
    yes('  and the log names whose token opened it', await waitFor(() => /session \d+ opened for cloud \(/.test(log), 3000));
    yes('  and says how long sshd took to take it', /session \d+ opened for cloud \(\d+ open\), sshd took \d+ ms/.test(log));
    yes('  and names no address and no token', log.indexOf(TOKEN) < 0 && log.indexOf(digest(TOKEN)) < 0 && !/127\.0\.0\.1:\d+\)/.test(log.split('\n').filter((l) => /session|refused/.test(l)).join('\n')));
    yes('a second holder\'s token switches protocols too', /^HTTP\/1\.1 101/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + OTHER]))));
    yes('  and is logged as theirs', await waitFor(() => /session \d+ opened for djinn \(/.test(log), 3000));
    yes('a token the box holds raw, not as its digest, is a 401', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + RAW]))));
    yes('a token whose digest is under a name the bridge does not take is a 401', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + STRAY]))));
    yes('the digest itself sent as a token is a 401', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + digest(TOKEN)]))));

    // Nine at once: the ninth is refused while eight are open.
    const held = [];
    for (let i = 0; i < 8; i++) {
      const s = net.connect(port, '127.0.0.1');
      s.on('error', () => {});
      s.write(['GET / HTTP/1.1', 'Host: x'].concat(WS_HEADERS, ['Authorization: Bearer ' + TOKEN]).join('\r\n') + '\r\n\r\n');
      held.push(s);
    }
    yes('eight sessions open at once', await waitFor(() => /session 10 opened for cloud \(8 open\)/.test(log), 3000));
    yes('a ninth session while eight are open is a 503', /^HTTP\/1\.1 503/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN]))));
    held.forEach((s) => s.destroy());
    yes('a session whose far end goes away is let go and logged with its bytes', await waitFor(() => (log.match(/session \d+ ended: the WebSocket closed, \d+ s, \d+ bytes in, \d+ bytes out/g) || []).length >= 10, 3000));

    // ---- 3. connect.js through the stand-in proxy ----------------------------
    const url = 'ws://localhost:' + port + '/';
    const small = Buffer.from('SSH-2.0-OpenSSH_9.6 a line ssh would send\r\n');
    let r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: TOKEN, HTTPS_PROXY: proxyUrl }, small);
    yes('through the proxy, what goes in comes back out (exit ' + r.code + ')' + (r.err ? ': ' + r.err.trim() : ''), r.code === 0 && r.out.equals(small));
    yes('  and the proxy was asked to CONNECT to the bridge\'s host and port', connects.indexOf('CONNECT localhost:' + port + ' HTTP/1.1') >= 0);

    // #2961: ssh closes standard input and sends SIGHUP 2 ms later. The
    // close frame has to reach the bridge all the same, so it lets the slot
    // go at once instead of when the connection drops, which through the
    // cloud proxy and Caddy was 11 s. Windows has no SIGHUP to send.
    if (process.platform !== 'win32') {
      const closedBefore = (log.match(/ended: the far end closed it/g) || []).length;
      const hupEnv = Object.assign({}, process.env, { THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: TOKEN });
      delete hupEnv.HTTPS_PROXY; delete hupEnv.https_proxy;
      hupEnv.HTTPS_PROXY = proxyUrl;
      const hup = spawn(process.execPath, [path.join(DIR, 'connect.js')], { env: hupEnv });
      let back = Buffer.alloc(0);
      hup.stdin.on('error', () => {});
      hup.stdout.on('data', (d) => {
        back = Buffer.concat([back, d]);
        if (back.length >= small.length && !hup.stdin.writableEnded) { hup.stdin.end(); hup.kill('SIGHUP'); }
      });
      hup.stdin.write(small);
      yes('ended the way ssh ends it, standard input closed then SIGHUP, it exits', await waitFor(() => hup.exitCode !== null || hup.signalCode !== null, 5000));
      yes('  with 0, not killed by the signal (exit ' + hup.exitCode + ', signal ' + hup.signalCode + ')', hup.exitCode === 0);
      yes('  and the bridge got its close frame, so the slot went at once', await waitFor(() => (log.match(/ended: the far end closed it/g) || []).length > closedBefore, 3000));
      if (hup.exitCode === null && hup.signalCode === null) hup.kill();
    }

    const big = crypto.randomBytes(3 * 1024 * 1024);
    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: TOKEN, HTTPS_PROXY: proxyUrl }, big, 30000);
    yes('3 MB there and back arrives byte for byte (exit ' + r.code + ', ' + r.out.length + ' bytes)', r.code === 0 && r.out.equals(big));

    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: 'not-it', HTTPS_PROXY: proxyUrl }, Buffer.alloc(0));
    yes('a wrong token exits 1 and says the bridge refused it', r.code === 1 && /box bridge: the bridge refused this token \(401\)/.test(r.err));

    // A PC keeps its token in a file (Setup-SshKey.ps1), which connect.js
    // reads when the environment holds none, line end and all.
    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: '', THORNSWOOD_BOX_TOKEN_FILE: tokenFile }, small);
    yes('the token from the file THORNSWOOD_BOX_TOKEN_FILE names gets in (exit ' + r.code + ')' + (r.err ? ': ' + r.err.trim() : ''), r.code === 0 && r.out.equals(small));
    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: '', THORNSWOOD_BOX_TOKEN_FILE: path.join(tmp, 'not-there') }, Buffer.alloc(0));
    yes('a token file that is named and not there exits 1 and says so', r.code === 1 && /box bridge: THORNSWOOD_BOX_TOKEN_FILE names .*not-there, which cannot be read/.test(r.err));
    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: '', THORNSWOOD_BOX_TOKEN_FILE: '', HOME: tmp, USERPROFILE: tmp }, Buffer.alloc(0));
    yes('with no token anywhere it exits 1 and says none was sent', r.code === 1 && /box bridge: no token was sent/.test(r.err));
    fs.mkdirSync(path.join(tmp, '.ssh'));
    fs.copyFileSync(tokenFile, path.join(tmp, '.ssh', 'thornswood-box-token'));
    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: '', THORNSWOOD_BOX_TOKEN_FILE: '', HOME: tmp, USERPROFILE: tmp }, small);
    yes('with none named, .ssh/thornswood-box-token in the home folder gets in (exit ' + r.code + ')' + (r.err ? ': ' + r.err.trim() : ''), r.code === 0 && r.out.equals(small));

    refuseTunnel = true;
    r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: TOKEN, HTTPS_PROXY: proxyUrl }, Buffer.alloc(0));
    yes('a proxy that refuses the tunnel exits 1 and says so', r.code === 1 && /box bridge: the proxy refused the tunnel to localhost:\d+ \(HTTP\/1\.1 403 Forbidden\)/.test(r.err));
    refuseTunnel = false;

    r = await runClient({ THORNSWOOD_BOX_URL: 'http://localhost:' + port + '/', THORNSWOOD_BOX_TOKEN: TOKEN }, Buffer.alloc(0));
    yes('an address that is not ws:// or wss:// exits 1', r.code === 1 && /must be a ws:\/\/ or wss:\/\/ address/.test(r.err));

    // listen.js, the loopback port ssh-keyscan asks through: two clients at
    // once, each carried to the far end by a connect.js of its own.
    // Both spellings out first, as runClient does: Windows names are one
    // whatever their case, so setting both would leave either.
    const lisEnv = Object.assign({}, process.env, { THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: TOKEN });
    delete lisEnv.HTTPS_PROXY; delete lisEnv.https_proxy;
    lisEnv.HTTPS_PROXY = proxyUrl;
    const lis = spawn(process.execPath, [path.join(DIR, 'listen.js')], { env: lisEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const lport = await new Promise((resolve, reject) => {
        let got = '';
        lis.stdout.on('data', (d) => { got += d; const m = /^(\d+)\n/.exec(got); if (m) resolve(Number(m[1])); });
        lis.on('exit', () => reject(new Error('listen.js ended before it printed a port')));
      });
      yes('listen.js prints the loopback port it took', lport > 0);
      const viaListener = (payload) => new Promise((resolve) => {
        const c = net.connect(lport, '127.0.0.1');
        let back = Buffer.alloc(0);
        c.on('data', (d) => { back = Buffer.concat([back, d]); if (back.length >= payload.length) c.end(); });
        c.on('close', () => resolve(back));
        c.on('error', () => resolve(back));
        c.write(payload);
      });
      const one = crypto.randomBytes(5000);
      const two = crypto.randomBytes(7000);
      const [b1, b2] = await Promise.all([viaListener(one), viaListener(two)]);
      yes('  and two connections at once each come back byte for byte through the bridge', b1.equals(one) && b2.equals(two));
      lis.stdin.end();
      const ended = await waitFor(() => lis.exitCode !== null, 3000);
      yes('  and it stops when its standard input closes', ended);
    } finally {
      if (lis.exitCode === null) lis.kill();
    }

    // ---- 4. which hop (#3297) -----------------------------------------------
    // A front that takes the connection and the upgrade and never answers,
    // and one that answers with Cloudflare's own 502 and its ray id.
    const silent = net.createServer((s) => { s.on('error', () => {}); s.resume(); });
    await new Promise((r) => silent.listen(0, '127.0.0.1', r));
    const cf502 = net.createServer((s) => {
      s.on('error', () => {});
      s.once('data', () => s.end('HTTP/1.1 502 Bad Gateway\r\nServer: cloudflare\r\nCF-RAY: 8d1f2e3a4b5c6d7e-DFW\r\nContent-Length: 0\r\n\r\n'));
    });
    await new Promise((r) => cf502.listen(0, '127.0.0.1', r));
    try {
      const silentUrl = 'ws://localhost:' + silent.address().port + '/box/';
      // Ended the way Windows' ssh ends it, with nothing it can catch, so
      // what it said before then is all there is.
      const env = { THORNSWOOD_BOX_URL: silentUrl, THORNSWOOD_BOX_TOKEN: TOKEN, HTTPS_PROXY: proxyUrl, THORNSWOOD_BOX_SLOW_MS: '300' };
      const e = Object.assign({}, process.env, env);
      delete e.https_proxy;
      e.HTTPS_PROXY = proxyUrl;
      const c = spawn(process.execPath, [path.join(DIR, 'connect.js')], { env: e });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.stdin.on('error', () => {});
      const said = await waitFor(() => /still opening/.test(err), 3000);
      c.kill('SIGKILL');
      yes('a slow opening says so before anything ends it', said);
      yes('  naming the upgrade as the stage it waits at', /box bridge: still opening ws:\/\/localhost:\d+\/box\/ after 0\.\d s, waiting 0\.\d s for the answer to the upgrade; before that /.test(err));
      yes('  and how long the proxy\'s tunnel took before it', /the proxy's tunnel to localhost:\d+ \d+ ms/.test(err));

      if (process.platform !== 'win32') {
        const h = spawn(process.execPath, [path.join(DIR, 'connect.js')], { env: Object.assign({}, e, { THORNSWOOD_BOX_SLOW_MS: '60000' }) });
        let herr = '';
        h.stderr.on('data', (d) => { herr += d; });
        h.stdin.on('error', () => {});
        await new Promise((r) => setTimeout(r, 400));
        h.kill('SIGHUP');
        yes('ended by SIGHUP before it opened, it exits 1', await waitFor(() => h.exitCode !== null, 3000) && h.exitCode === 1);
        yes('  saying ssh ended it and at which stage', /box bridge: ssh ended this \(SIGHUP\) before the WebSocket to ws:\/\/localhost:\d+\/box\/ opened, waiting \d+\.\d s for the answer to the upgrade/.test(herr));
      }

      r = await runClient(Object.assign({}, env, { THORNSWOOD_BOX_SLOW_MS: '60000', THORNSWOOD_BOX_OPEN_MS: '500' }), Buffer.alloc(0));
      yes('its own deadline says the stage too', r.code === 1 && /box bridge: no WebSocket to ws:\/\/localhost:\d+\/box\/ after 500 ms, waiting 0\.\d s for the answer to the upgrade/.test(r.err));

      r = await runClient({ THORNSWOOD_BOX_URL: 'ws://localhost:' + cf502.address().port + '/box/', THORNSWOOD_BOX_TOKEN: TOKEN }, Buffer.alloc(0));
      yes('an answer that is not the WebSocket names its status and cf-ray', r.code === 1 && /box bridge: the bridge did not open a WebSocket \(HTTP\/1\.1 502 Bad Gateway; cf-ray 8d1f2e3a4b5c6d7e-DFW\)/.test(r.err));

      r = await runClient({ THORNSWOOD_BOX_URL: url, THORNSWOOD_BOX_TOKEN: TOKEN, HTTPS_PROXY: proxyUrl }, small);
      yes('a normal opening says nothing on standard error', r.code === 0 && r.err === '');
    } finally {
      silent.close();
      cf502.close();
    }

    // ---- 5. one WebSocket is not the session (#3214) ---------------------------
    // A front between connect.js and the bridge that Cloudflare's restarts
    // stand in for: cut() ends every connection through it at once, both
    // ways, and deaf() stops carrying bytes but leaves both ends open, as when
    // Cloudflare's side lingers toward the box.
    const pairs = [];
    const front = net.createServer((c) => {
      c.on('error', () => {});
      const b = net.connect(port, '127.0.0.1');
      b.on('error', () => {});
      const pair = { c, b, deaf: false };
      c.on('data', (d) => { if (!pair.deaf) b.write(d); });
      b.on('data', (d) => { if (!pair.deaf) c.write(d); });
      c.on('close', () => { if (!pair.deaf) b.destroy(); });
      b.on('close', () => { if (!pair.deaf) c.destroy(); });
      pairs.push(pair);
    });
    await new Promise((r) => front.listen(0, '127.0.0.1', r));
    const frontUrl = 'ws://localhost:' + front.address().port + '/box/';
    const cut = () => { for (const p of pairs.splice(0)) { p.c.destroy(); p.b.destroy(); } };
    const deaf = () => { for (const p of pairs.splice(0)) p.deaf = true; };
    // connect.js the way ssh drives it, through the front: input written in
    // pieces, and what comes back counted, with hit() run as the output
    // passes each mark in marks.
    function carried(env, input, marks, hit) {
      return new Promise((resolve) => {
        const e = Object.assign({}, process.env, env);
        delete e.HTTPS_PROXY; delete e.https_proxy;
        const c = spawn(process.execPath, [path.join(DIR, 'connect.js')], { env: e });
        const out = []; let n = 0; let err = '';
        let next = 0;
        c.stderr.on('data', (d) => { err += d; });
        c.stdout.on('data', (d) => {
          out.push(d); n += d.length;
          while (next < marks.length && n >= marks[next]) hit(next++);
          if (n >= input.length) c.stdin.end();
        });
        c.on('close', (code) => resolve({ code, out: Buffer.concat(out), err }));
        c.stdin.on('error', () => {});
        let at = 0;
        // Input waits a piece past the next mark until the output has
        // passed it, so whatever hit() does lands with input still to send.
        (function feed() {
          if (at >= input.length) return;
          if (next < marks.length && at > marks[next] + 65536) return setTimeout(feed, 5);
          c.stdin.write(input.subarray(at, at + 65536));
          at += 65536;
          setTimeout(feed, 5);
        })();
        setTimeout(() => c.kill(), 30000);
      });
    }
    const carriedBefore = (log.match(/carried over to a new WebSocket/g) || []).length;
    const lots = crypto.randomBytes(4 * 1024 * 1024);
    r = await carried({ THORNSWOOD_BOX_URL: frontUrl, THORNSWOOD_BOX_TOKEN: TOKEN }, lots, [512 * 1024, 2 * 1024 * 1024, 3 * 1024 * 1024], () => cut());
    yes('4 MB there and back with its WebSocket cut three times arrives byte for byte (exit ' + r.code + ', ' + r.out.length + ' bytes)' + (r.err ? ': ' + r.err.trim() : ''), r.code === 0 && r.out.equals(lots));
    yes('  saying nothing on standard error, where Windows PowerShell reads the far side\'s CLIXML', r.err === '');
    yes('  and the bridge logs each carry-over', await waitFor(() => (log.match(/carried over to a new WebSocket/g) || []).length >= carriedBefore + 3, 3000));
    yes('  and the session\'s lost WebSocket, held for connect.js to come back', /session \d+ lost its WebSocket: the WebSocket closed, after \d+ s; held 2 s for connect\.js to come back/.test(log));
    yes('  and its end names how many WebSockets it rode', /ended: the far end closed it, \d+ s, \d+ bytes in, \d+ bytes out, carried over to 3 new WebSockets/.test(log));

    // Deaf: nothing moves and nothing says it has gone, at either end.
    // connect.js takes it for gone after HEAR_MS, and the bridge, which has
    // not seen it go, hands the session to the new WebSocket.
    const some = crypto.randomBytes(300000);
    r = await carried({ THORNSWOOD_BOX_URL: frontUrl, THORNSWOOD_BOX_TOKEN: TOKEN, THORNSWOOD_BOX_HEAR_MS: '1500' }, some, [100000], () => deaf());
    yes('a WebSocket that goes deaf both ways is taken for gone and the session goes on (exit ' + r.code + ', ' + r.out.length + ' bytes)' + (r.err ? ': ' + r.err.trim() : ''), r.code === 0 && r.out.equals(some));
    yes('  the bridge handing it over before it saw the old one go', await waitFor(() => /carried over to a new WebSocket before the old one was seen to go/.test(log), 3000));

    // A resume by somebody else, of nothing, or of a session gone is refused.
    const nameOf = () => new Promise((resolve) => {
      const s2 = net.connect(port, '127.0.0.1');
      let got = '';
      s2.on('error', () => resolve({ s: s2, name: '' }));
      s2.on('data', (d) => {
        got += d.toString('latin1');
        if (got.indexOf('\r\n\r\n') >= 0) resolve({ s: s2, name: (/X-Thornswood-Session: ([0-9a-f]{32})/i.exec(got) || [])[1] || '' });
      });
      s2.write(['GET / HTTP/1.1', 'Host: x'].concat(WS_HEADERS, ['Authorization: Bearer ' + TOKEN, 'X-Thornswood-Resume: new']).join('\r\n') + '\r\n\r\n');
    });
    const held1 = await nameOf();
    yes('a session asked for with "X-Thornswood-Resume: new" is given a name', /^[0-9a-f]{32}$/.test(held1.name));
    yes('  and one asked for without it is given none', !/X-Thornswood-Session/i.test(await new Promise((resolve) => {
      const s3 = net.connect(port, '127.0.0.1'); let got = '';
      s3.on('data', (d) => { got += d.toString('latin1'); if (got.indexOf('\r\n\r\n') >= 0) { s3.destroy(); resolve(got); } });
      s3.on('error', () => resolve('error'));
      s3.write(['GET / HTTP/1.1', 'Host: x'].concat(WS_HEADERS, ['Authorization: Bearer ' + TOKEN]).join('\r\n') + '\r\n\r\n');
    })));
    held1.s.destroy();
    await waitFor(() => new RegExp('lost its WebSocket').test(log), 2000);
    yes('another holder\'s token cannot take the session on (410)', /^HTTP\/1\.1 410/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + OTHER, 'X-Thornswood-Resume: ' + held1.name + ' 0']))));
    yes('a name the bridge never gave is a 410', /^HTTP\/1\.1 410/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN, 'X-Thornswood-Resume: ' + crypto.randomBytes(16).toString('hex') + ' 0']))));
    yes('a resume that is not a name and a count is a 400', /^HTTP\/1\.1 400/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN, 'X-Thornswood-Resume: yes please']))));
    yes('a resume from a byte past what was sent is a 409 and ends the session', /^HTTP\/1\.1 409/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN, 'X-Thornswood-Resume: ' + held1.name + ' 99999']))));
    yes('  saying why', await waitFor(() => /ended: connect\.js asked to go on from an ack for byte 99999/.test(log), 2000));
    const notBack = () => (log.match(/ended: the WebSocket closed, and connect\.js did not come back within 2 s/g) || []).length;
    const notBackBefore = notBack();
    const held2 = await nameOf();
    held2.s.destroy();
    yes('a session whose WebSocket does not come back is let go once it has been held', await waitFor(() => notBack() > notBackBefore, 5000));
    yes('  and after that its name is a 410', /^HTTP\/1\.1 410/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN, 'X-Thornswood-Resume: ' + held2.name + ' 0']))));

    // Against a bridge from before #3214, which names no session, a cut
    // ends it as it always did.
    const oldBridge = net.createServer((c) => {
      c.on('error', () => {});
      c.once('data', (d) => {
        const key = (/Sec-WebSocket-Key: (\S+)/i.exec(d.toString('latin1')) || [])[1];
        c.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + ws.accept(key) + '\r\n\r\n');
        setTimeout(() => c.destroy(), 200);
      });
    });
    await new Promise((r2) => oldBridge.listen(0, '127.0.0.1', r2));
    r = await runClient({ THORNSWOOD_BOX_URL: 'ws://localhost:' + oldBridge.address().port + '/', THORNSWOOD_BOX_TOKEN: TOKEN }, Buffer.from('x'), 5000);
    yes('against a bridge that names no session, a dropped WebSocket ends it as before (exit ' + r.code + ')', r.code === 0 || r.code === 1);
    yes('  without trying a new one', !/carry the session on/.test(r.err));
    oldBridge.close();
    front.close();

    // Taking one holder off refuses them at once and leaves the other in.
    fs.unlinkSync(path.join(tokens, 'djinn'));
    yes('with one holder\'s file gone the bridge refuses their token', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + OTHER]))));
    yes('  and still lets the other holder in', /^HTTP\/1\.1 101/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN]))));
    fs.rmSync(tokens, { recursive: true, force: true });
    yes('with the folder gone the bridge refuses everybody', /^HTTP\/1\.1 401/.test(await upgrade(port, WS_HEADERS.concat(['Authorization: Bearer ' + TOKEN]))));
  } finally {
    bridge.kill();
    echo.close();
    proxy.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL ' + e.stack); process.exit(1); });
