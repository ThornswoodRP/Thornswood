/*
  test-4462-null-body.js

      node voice\tests\test-4462-null-body.js

  Issue #4462. One POST with the body null to /token or /say stopped the whole
  voice service, voice and chat with it: readBody handed whatever JSON.parse
  gave back to the route, null is valid JSON, and the route's first read of a
  property off it (doc.profileId, doc.text) threw outside any catch, in the
  request's end handler. 5, true, "x" and [] only read as undefined.

  Against the real service spawned in a temp folder on a loopback port of its
  own, every route that takes a body is sent null, then 5, true, "x" and [],
  and each must be answered 400 with the service still running. Then a good
  request to /token and to /say must still be answered as before: /say with
  204, /token with 503, since no site is set here to check a ticket against.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4462-'));
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

let srv = null, srvLog = '', base = '', exited = null;
async function post(route, raw) {
  try {
    const r = await fetch(base + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw });
    return { status: r.status, text: await r.text() };
  } catch (e) { return { status: 0, text: String(e && e.cause || e) }; }
}
const alive = () => exited === null && srv.exitCode === null;

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
    srv.on('exit', (code) => { exited = code; });
    await listening(srv, port);

    console.log('A. a body that is not a JSON object is refused, and the service keeps running:');
    const ROUTES = ['/token', '/say', '/commands/ack', '/silenced', '/textmute', '/positions'];
    for (const raw of ['null', '5', 'true', '"x"', '[]']) {
      for (const route of ROUTES) {
        const r = await post(route, raw);
        yes(route + ' with the body ' + raw + ': 400 (' + r.status + '), and the service is still running',
            r.status === 400 && alive(), r.text + (alive() ? '' : '\nthe service stopped (exit ' + exited + '). It printed:\n' + srvLog));
        if (!alive()) break;
      }
      if (!alive()) break;
    }

    console.log('\nB. a good request is answered as before:');
    let r = await post('/say', JSON.stringify({ text: 'a line from the game', name: 'Thornswood' }));
    yes('/say with a line: 204 (' + r.status + ')', r.status === 204, r.text);
    r = await post('/token', JSON.stringify({ profileId: 5, ticket: 'a-ticket' }));
    yes('/token with a profile and a ticket: 503, nobody to check it with here (' + r.status + ')', r.status === 503, r.text);
    r = await post('/token', '{');
    yes('/token with JSON that will not parse: 400 bad json, as before (' + r.status + ' ' + r.text + ')', r.status === 400 && r.text === 'bad json');
    yes('and the service is still running at the end', alive(), srvLog);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, srvLog);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
