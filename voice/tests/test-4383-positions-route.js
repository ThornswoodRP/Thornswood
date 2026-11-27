/*
  test-4383-positions-route.js

      node voice\tests\test-4383-positions-route.js

  Issue #4383. POST /positions, the gamemode's feed of where everybody is, was
  matched against req.url as it came, so /positions with a query string on it
  missed the route and fell through to the file reader. Every other route is
  matched on the path with the query string cut off.

  Against the real service spawned in a temp folder on a loopback port of its
  own:
    A  POST /positions?... is taken as the feed: 204, and /health counts the
       profiles it carried;
    B  the bare /positions still is, and a later feed replaces the one before;
    C  a request carried in by a proxy (an X-Forwarded-For header) is still
       refused 403, with or without a query string;
    D  and voice-server.js compares no route against req.url itself.

  VOICE points it at another copy of voice-server.js, which is how it was
  shown to fail on main. Read only apart from its own temp folder.
*/
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const VOICE = process.env.VOICE || path.join(__dirname, '..', 'voice-server.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 1500).split('\n').join('\n      ') : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4383-'));
fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
fs.writeFileSync(path.join(dir, 'token-key.txt'), crypto.randomBytes(32).toString('hex'));

// A port of this run's own (#1703), asked of nothing until the service says
// it is listening there.
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

let srv = null, srvLog = '';
async function send(method, where, raw, headers) {
  try {
    const r = await fetch(base + where, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: raw });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { status: 0, text: String(e && e.cause || e) }; }
}
let base = '';
async function tracked() {
  const r = await send('GET', '/health');
  try { return JSON.parse(r.text).tracked; } catch (e) { return 'no answer: ' + r.status + ' ' + r.text; }
}
const feed = (...ids) => JSON.stringify({ who: ids.map((id) => ({ profileId: id, pos: [0, 0, 0], angleZ: 0, cell: 'Whiterun', name: 'N' + id })) });

(async function main() {
  try {
    const port = await freePort('0.0.0.0');
    base = 'http://127.0.0.1:' + port;
    srv = spawn(process.execPath, ['voice-server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    srv.stdout.on('data', (d) => { srvLog += d; });
    srv.stderr.on('data', (d) => { srvLog += d; });
    await listening(srv, port);

    console.log('A. /positions with a query string is the feed:');
    let r = await send('POST', '/positions?from=gamemode&tick=4', feed(7, 8));
    yes('POST /positions?from=gamemode&tick=4 answers 204 (' + r.status + ')', r.status === 204, r.text);
    let t = await tracked();
    yes('and /health counts the two profiles it carried (' + t + ')', t === 2);

    console.log('\nB. the bare path still is:');
    r = await send('POST', '/positions', feed(9));
    yes('POST /positions answers 204 (' + r.status + ')', r.status === 204, r.text);
    t = await tracked();
    yes('and its one profile replaces the two before (' + t + ')', t === 1);

    console.log('\nC. a request a proxy carried in is still refused:');
    for (const where of ['/positions', '/positions?x=1']) {
      r = await send('POST', where, feed(1, 2, 3), { 'x-forwarded-for': '203.0.113.9' });
      yes('POST ' + where + ' with X-Forwarded-For answers 403 (' + r.status + ')', r.status === 403, r.text);
    }
    t = await tracked();
    yes('and nothing it sent was taken (' + t + ')', t === 1);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, srvLog);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
  }

  console.log('\nD. no route is compared against req.url itself:');
  const code = fs.readFileSync(VOICE, 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l)).join('\n');
  const raw = code.match(/req\.url\s*===/g) || [];
  yes('voice-server.js has no req.url === (' + raw.length + ')', raw.length === 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
