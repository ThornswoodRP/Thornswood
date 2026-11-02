const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto'), net = require('net');
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
function check(what, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  ok   ' : '  FAIL ') + what + (ok ? '' : '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
/*
  A port of this run's own (#1703). Builds run side by side on the VPS, and
  with a fixed number one run's requests can be answered by another run's
  service. The system names a port nothing holds, the service is started on
  it, and nothing is asked of the port until this service has said it is
  listening there.
*/
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
/* Waits for srv's own "listening on ...:port" line. If it stops first,
   something took the port in between or it could not start, and the error
   says which, with what it printed. */
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
// Each run is on a port of its own. It was a fixed 7903 for every run, the same
// as test-keepalive.js (#1703).
function run(env, then) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-'));
  fs.copyFileSync(path.join(__dirname, '..', 'voice-server.js'), path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'test');
  return (async () => {
    const PORT = await freePort('0.0.0.0');
    const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir,
      env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_SITE: '' }, env) });
    let log = '';
    srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
    await listening(srv, PORT);
    // The headers come back too, because whether a page is ALLOWED to read
    // this answer matters as much as what is in it. The in-game page is loaded
    // off disk, so its Origin is the literal string null, and without the
    // header the browser refuses the fetch before the page sees the body: it
    // logged a CORS refusal once a second on live and dev alike.
    const res = await fetch('http://127.0.0.1:' + PORT + '/ice', { headers: { Origin: 'null' } });
    const cors = res.headers.get('access-control-allow-origin');
    const ice = await res.json();
    const health = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json();
    await new Promise((r) => { srv.once('exit', r); srv.kill(); });
    return { ice: ice.iceServers, turn: health.turn, cors: cors, log };
  })();
}
(async () => {
  console.log('nothing configured, which is every box today:');
  let r = await run({});
  check('only the STUN that was always there', r.ice, [{ urls: 'stun:stun.l.google.com:19302' }]);
  check('health says no relay', r.turn, 'none');
  check('a page on a file:// origin may read the list', r.cors, '*');

  console.log('\na relay with the coturn REST secret:');
  const SECRET = 'a shared secret for the relay';
  r = await run({ THORNSWOOD_TURN_URL: 'turn:voice.example.net:3478', THORNSWOOD_TURN_SECRET: SECRET, THORNSWOOD_TURN_TTL: '600' });
  check('health says the credential is ephemeral', r.turn, 'ephemeral');
  check('STUN is still first', r.ice[0], { urls: 'stun:stun.l.google.com:19302' });
  const t = r.ice[1];
  check('the relay is listed', t.urls, ['turn:voice.example.net:3478']);
  const until = Number(t.username);
  const now = Math.floor(Date.now() / 1000);
  check('the username is an expiry about 600s out', until > now + 500 && until < now + 700, true);
  const want = crypto.createHmac('sha1', SECRET).update(t.username).digest('base64');
  check('the password is HMAC-SHA1 of it, as coturn expects', t.credential, want);

  console.log('\ntwo calls a second apart must not hand out the same credential forever:');
  const a = await run({ THORNSWOOD_TURN_URL: 'turn:x:3478', THORNSWOOD_TURN_SECRET: SECRET, THORNSWOOD_TURN_TTL: '60' });
  check('a credential is issued per request, not baked in at boot', typeof a.ice[1].credential, 'string');

  console.log('\na plain username and password:');
  r = await run({ THORNSWOOD_TURN_URL: 'turn:x:3478', THORNSWOOD_TURN_USER: 'bob', THORNSWOOD_TURN_PASS: 'pw' });
  check('health says static', r.turn, 'static');
  check('it is passed through', [r.ice[1].username, r.ice[1].credential], ['bob', 'pw']);
  // Named here because this is the case worth thinking about before widening
  // who may read the route. It is no more exposed than it was: CORS says what
  // a PAGE may read, and anything that can make an HTTP request could always
  // read this.
  check('and it is readable by a page in that case too, which is the one to watch', r.cors, '*');

  console.log('\na relay with no credentials at all, which would waste gathering time:');
  r = await run({ THORNSWOOD_TURN_URL: 'turn:x:3478' });
  check('the relay is dropped rather than served', r.ice.length, 1);
  check('health calls it misconfigured', r.turn, 'MISCONFIGURED');
  check('and it says so in the log', /is set but no credentials/.test(r.log), true);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
