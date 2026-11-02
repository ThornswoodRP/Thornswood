// test-3806-voice-health.js
//
//     node voice\tests\test-3806-voice-health.js
//
// #3806. The voice service answered /health with its build, the deploy
// record (commit, zip, sha256, time), its bind, TURN state, chat range and
// live counts to anybody, and Caddy carries https://thornswood.net/voice/health
// and /voice-dev/health, so once the code is public anybody could match the
// live and dev commits to the exact source they run. Patrick, 26 Oct
// (q-3721-voice-health, A): the public answer says only ok, and the detail
// answers only on the box itself, which Get-Logs, Install-Voice and the
// watchdog reach.
//
// Every request Caddy forwards comes from 127.0.0.1, so the socket alone says
// nothing; what tells them apart is the forwarding header Caddy writes on
// everything it carries. This starts the real voice-server.js with a deploy
// record beside it, puts a proxy in front that forwards the way Caddy does,
// and checks:
//   1. through the proxy /health is 200 and exactly {"ok":true}: no build, no
//      commit, zip or hash, no count;
//   2. one forwarding header on its own is enough to get only ok, each of the
//      four Caddy or another proxy might set;
//   3. straight from loopback with none of them, as the box's own scripts
//      ask, the whole answer comes back, deploy record included;
//   4. the Caddyfile's /voice/ and /voice-dev/ blocks still write
//      X-Forwarded-For, which is what 1 rests on.
//
// Writes only to temp folders.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const VOICE = path.join(REPO, 'voice', 'voice-server.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3806-'));
fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
// The record Install-Voice.ps1 leaves beside the service (#459), with values
// that cannot turn up in an answer by chance.
const COMMIT = 'c0ffee3806c0ffee3806c0ffee3806c0ffee3806';
const SHA = 'feedface3806'.repeat(5) + 'feed';
const ZIP = 'voice-3806-stand-in.zip';
fs.writeFileSync(path.join(dir, 'thornswood-deploy.json'), JSON.stringify({
  name: ZIP, commit: COMMIT, edited: false, sha256: SHA, deployedUtc: '2026-10-27T00:00:00Z'
}));

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

function ask(port, where, headers) {
  return new Promise((ok) => {
    const req = http.request({ host: '127.0.0.1', port: port, method: 'GET', path: where, headers: headers || {}, agent: false }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b }));
    });
    req.on('error', () => ok({ status: 0, body: '' }));
    req.end();
  });
}

// Nothing of the detail: the deploy record's values, and the names of the
// fields that carry the build and the counts.
function tellsNothing(body) {
  return [COMMIT, SHA, ZIP, '"build"', '"deploy"', '"peers"', '"bind"', '"turn"', '"uptimeSeconds"', '"captions"']
    .every((s) => body.indexOf(s) < 0);
}

(async () => {
  console.log('the Caddyfile, which the answer below rests on:');
  const caddy = fs.readFileSync(path.join(REPO, 'scripts', 'deploy', 'Caddyfile'), 'utf8').replace(/\r\n/g, '\n');
  for (const [prefix, port] of [['/voice/*', '7778'], ['/voice-dev/*', '7789']]) {
    const m = new RegExp('handle_path ' + prefix.replace(/[/*]/g, '\\$&') + ' \\{\\n([\\s\\S]*?)\\n\\t\\}').exec(caddy);
    yes('handle_path ' + prefix + ' goes to 127.0.0.1:' + port + ' and writes X-Forwarded-For',
        !!m && m[1].indexOf('reverse_proxy 127.0.0.1:' + port) >= 0 && /header_up X-Forwarded-For \{client_ip\}/.test(m[1]));
  }

  PORT = await freePort('127.0.0.1');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1', THORNSWOOD_SITE: '',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
    })
  });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
  await new Promise((ok) => proxy.listen(0, '127.0.0.1', ok));
  const PROXY = proxy.address().port;

  console.log('\nthrough a proxy on this machine, the way Caddy forwards:');
  const out = await ask(PROXY, '/health');
  yes('/health answers 200, which is all the launcher and the watchdog read', out.status === 200);
  yes('and says {"ok":true} and nothing more (' + out.body + ')', out.body === '{"ok":true}');
  yes('no build, no commit, zip or hash, no count', tellsNothing(out.body));
  const q = await ask(PROXY, '/health?full=1');
  yes('a query string changes nothing', q.status === 200 && q.body === '{"ok":true}');

  console.log('\none forwarding header is enough:');
  for (const name of ['x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'forwarded']) {
    const r = await ask(PORT, '/health', { [name]: name === 'forwarded' ? 'for=203.0.113.9;proto=https' : 'x' });
    yes('/health with only ' + name + ' says only ok', r.status === 200 && r.body === '{"ok":true}');
  }

  console.log('\nstraight from loopback with no forwarding header, as the box\'s scripts ask:');
  const here = await ask(PORT, '/health');
  let h = {};
  try { h = JSON.parse(here.body); } catch (e) { }
  yes('/health answers 200 with ok', here.status === 200 && h.ok === true);
  yes('with the build', typeof h.build === 'string' && /health-here-1/.test(h.build));
  yes('with the deploy record: commit, zip and hash', !!h.deploy && h.deploy.commit === COMMIT && h.deploy.name === ZIP && h.deploy.sha256 === SHA);
  yes('with the bind and the counts', h.bind === '127.0.0.1' && h.peers === 0 && typeof h.uptimeSeconds === 'number');

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (fail) { console.log('the service printed:\n' + log); }
  process.exitCode = fail ? 1 : 0;
  proxy.close();
  srv.kill();
  setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } }, 150);
})().catch((e) => {
  console.log('FAIL  ' + (e && e.message)); process.exitCode = 1;
  try { proxy.close(); } catch (x) { }
  if (srv) srv.kill();
});
