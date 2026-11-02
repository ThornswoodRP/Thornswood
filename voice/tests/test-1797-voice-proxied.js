// test-1797-voice-proxied.js
//
//     node voice\tests\test-1797-voice-proxied.js
//
// #1797. The voice service keeps six routes to the gamemode by asking whether
// a request's socket came from loopback: POST /positions, GET /commands,
// POST /commands/ack, POST /silenced, POST /textmute and POST /say. Caddy
// carries https://thornswood.net/voice/ and /voice-dev/ to the service from
// 127.0.0.1, so everything it forwarded passed that test, and on 5 Oct a POST
// from outside to /voice-dev/positions got "bad json" rather than "no".
//
// This starts the real voice-server.js, puts a proxy in front of it on this
// machine that forwards the way Caddy does (from 127.0.0.1, adding
// X-Forwarded-For, X-Forwarded-Proto and X-Forwarded-Host), and checks:
//   1. through the proxy, every one of the six answers 403 and changes nothing;
//   2. straight from loopback, with none of those headers, each still does its
//      job, which is how the gamemode calls them;
//   3. one forwarding header on its own is enough to be refused, each of the
//      four Caddy or another proxy might set;
//   4. the routes anybody may use (/health, /ice) still answer through the
//      proxy.
//
// Writes only to temp folders.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const VOICE = path.join(__dirname, '..', '..', 'voice', 'voice-server.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1797-'));
fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));

/* A port of this run's own (#1703), and nothing asked of it until the
   service has said it is listening there. */
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
    const said = (d) => {
      out += d;
      const m = /\[voice\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
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

let PORT = 0;
let srv = null;
let srvLog = '';

/* What Caddy's reverse_proxy does, near enough: a new request from this
   machine to the service, the client's headers passed through, and the three
   X-Forwarded headers set. */
const proxy = http.createServer((req, res) => {
  const headers = Object.assign({}, req.headers, {
    'x-forwarded-for': '203.0.113.9',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'thornswood.net'
  });
  const up = http.request({ host: '127.0.0.1', port: PORT, method: req.method, path: req.url, headers: headers, agent: false },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
  up.on('error', () => { res.writeHead(502).end('proxy could not reach the service'); });
  req.pipe(up);
});

function ask(port, method, where, body, headers) {
  return new Promise((ok) => {
    const data = body == null ? null : JSON.stringify(body);
    const h = Object.assign({}, headers || {});
    if (data != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
    const req = http.request({ host: '127.0.0.1', port: port, method: method, path: where, headers: h, agent: false }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b }));
    });
    req.on('error', () => ok({ status: 0, body: '' }));
    if (data != null) { req.write(data); }
    req.end();
  });
}

// The six, each with a body that would change something if it were taken.
const ROUTES = [
  { name: 'POST /positions', method: 'POST', where: '/positions',
    body: { who: [{ profileId: 42, pos: [0, 0, 0], angleZ: 0, cell: 'c', name: 'Somebody' }] }, ok: 204 },
  { name: 'GET /commands', method: 'GET', where: '/commands', body: null, ok: 200 },
  { name: 'POST /commands/ack', method: 'POST', where: '/commands/ack', body: { ids: ['x'] }, ok: 200 },
  { name: 'POST /silenced', method: 'POST', where: '/silenced', body: { profiles: { 42: Date.now() + 600000 } }, ok: 200 },
  { name: 'POST /textmute', method: 'POST', where: '/textmute', body: { by: { 42: [43] } }, ok: 200 },
  { name: 'POST /say', method: 'POST', where: '/say', body: { profileId: 42, text: 'from the server' }, ok: 204 }
];

(async () => {
  PORT = await freePort('127.0.0.1');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1', THORNSWOOD_SITE: '',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
    })
  });
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  await listening(srv, PORT);
  await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
  const PROXY = proxy.address().port;

  console.log('through a proxy on this machine, the way Caddy forwards:');
  for (const r of ROUTES) {
    const got = await ask(PROXY, r.method, r.where, r.body);
    yes(r.name + ' is refused (403)', got.status === 403);
  }
  const h1 = JSON.parse((await ask(PORT, 'GET', '/health')).body || '{}');
  yes('and none of them changed anything: nobody tracked, nothing queued', h1.tracked === 0 && h1.queuedCommands === 0);

  console.log('\nstraight from loopback with no forwarding headers, as the gamemode calls them:');
  for (const r of ROUTES) {
    const got = await ask(PORT, r.method, r.where, r.body);
    yes(r.name + ' does its job (' + r.ok + ')', got.status === r.ok);
  }
  const h2 = JSON.parse((await ask(PORT, 'GET', '/health')).body || '{}');
  yes('and the position it was sent is tracked', h2.tracked === 1);

  console.log('\none forwarding header is enough:');
  for (const name of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded']) {
    const got = await ask(PORT, 'POST', '/positions', { who: [] }, { [name]: name === 'forwarded' ? 'for=203.0.113.9;proto=https' : 'x' });
    yes('POST /positions with only ' + name + ' is refused', got.status === 403);
  }

  console.log('\nwhat anybody may ask still answers through the proxy:');
  const health = await ask(PROXY, 'GET', '/health');
  yes('/health', health.status === 200 && /"ok":true/.test(health.body));
  yes('/ice', (await ask(PROXY, 'GET', '/ice')).status === 200);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
  proxy.close();
  srv.kill();
  setTimeout(() => {}, 150);
})().catch((e) => { console.log('FAIL  ' + (e && e.message)); process.exitCode = 1; try { proxy.close(); } catch (x) { } if (srv) srv.kill(); });
