/*
  test-turn-key.js

  The TURN relay's key can sit in a file beside the voice service, and with no
  file nothing changes at all.

  From the To Do List, "Voice is a full peer-to-peer mesh with no relay and no
  cap, and the code already admits a pair that cannot connect is simply lost".
  Step one there is a relay, with its credentials minted by the service and
  the secret kept on the VPS, named by location only. The service could
  already make those credentials from THORNSWOOD_TURN_SECRET, but
  Install-Voice.ps1 puts the service's whole environment on the command line
  of the shell that starts it, so the only way in for the key was a place it
  could be read back out of. Now it can be turn-key.txt in the service's
  folder, the way token-key.txt already is.

  Nobody has stood up a relay, so what matters first is that this changes
  nothing while the file is not there. That is held here byte for byte: the
  /ice answer every client reads and its headers, the fields of /health, and
  the log, as the service wrote them before the file existed. The clients (the
  game's page, and the launcher's voice, C# in VoiceSession.cs since #4823)
  each start from a list of their own and swap it for whatever the service
  hands them, so the same answer means the same clients.

  Then the file itself: made into credentials the way coturn's REST scheme
  expects, read correctly whatever encoding a Windows box wrote it in, never
  logged, and beaten by the variable when both are set.

  Runs the real voice/voice-server.js in scratch folders on a spare
  port. Never connects to anything off this machine.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const vm = require('vm');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..', '..');

// What /ice answered, to the byte, before any of this. The STUN server the
// pages had always had typed into them, and nothing else.
const STUN_ONLY = '{"iceServers":[{"urls":"stun:stun.l.google.com:19302"}]}';
// And /health's fields, in the order it wrote them. chatRange came in with
// local chat (voice/tests/test-local-chat.js), and the five from backed on
// with the backpressure work (voice/tests/test-backpressure.js), and closedSilent
// with the keepalive's other half (voice/tests/test-keepalive.js), each separately
// from the relay key. chatRetention came with the chat prune's own report
// (voice/tests/test-chat-retention.js, #2191), and captions with voice shown as
// words (voice/tests/test-2475-voice-captions.js, #2475), and rostersAhead with the
// relay to a backed socket measured where it happens (tests/test-1869-voice-negotiation.js).
// deploy is the artifact record Install-Voice.ps1 leaves beside the service (#459).
const HEALTH_FIELDS = ['ok', 'build', 'deploy', 'auth', 'uptimeSeconds', 'startedAt', 'bind', 'turn',
                       'chatRange', 'peers', 'tracked', 'most', 'people', 'refusedFull', 'queuedCommands',
                       'backed', 'largestQueueBytes', 'droppedPositions', 'skippedRosters',
                       'closedBacklogged', 'closedSilent', 'chatRetention', 'captions', 'rostersAhead'];
// The two lines every start wrote, with nothing configured, on the port that
// start was given. Loopback with nothing configured since #1304.
const startLog = (port) => '[voice] listening on 127.0.0.1:' + port + ' (loopback only, so something must be proxying to it)\n' +
                           '[voice] positions accepted from loopback at POST /positions\n';

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

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
/*
  The real service in a scratch folder, with the files given beside it. A file
  given as null is made as a folder of that name, which is a file that is there
  and cannot be read. Nothing from this machine's own THORNSWOOD_ settings is
  passed through, so a developer's environment cannot change the answer.
  Each start is on a port of its own; it was a fixed 7921 (#1703).
*/
async function run(env, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'turnkey-'));
  fs.copyFileSync(path.join(__dirname, '..', 'voice-server.js'), path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
  fs.writeFileSync(path.join(dir, 'token-key.txt'), 'a join token key for this test only');
  for (const name of Object.keys(files || {})) {
    if (files[name] === null) fs.mkdirSync(path.join(dir, name));
    else fs.writeFileSync(path.join(dir, name), files[name]);
  }
  const clean = {};
  for (const k of Object.keys(process.env)) { if (!/^THORNSWOOD_/i.test(k)) clean[k] = process.env[k]; }
  const port = await freePort('0.0.0.0');
  const BASE = 'http://127.0.0.1:' + port;
  const srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign(clean, { THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_SITE: '' }, env)
  });
  const exited = new Promise((r) => srv.once('exit', r));
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });

  const out = { up: false, port: port, ice: null, iceText: '', iceHeaders: {}, health: null, healthText: '', log: '', dir: dir };
  try {
    await listening(srv, port);
    out.up = (await fetch(BASE + '/health')).ok;
  } catch (e) { console.log('      ' + e.message); }
  if (out.up) {
    const r = await fetch(BASE + '/ice', { headers: { Origin: 'null' } });
    r.headers.forEach((v, k) => { if (k !== 'date') out.iceHeaders[k] = v; });
    out.iceText = await r.text();
    try { out.ice = JSON.parse(out.iceText).iceServers; } catch (e) { out.ice = null; }
    out.healthText = await (await fetch(BASE + '/health')).text();
    try { out.health = JSON.parse(out.healthText); } catch (e) { out.health = null; }
  }
  srv.kill();
  await exited;
  out.log = log.split(dir).join('<dir>');
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  return out;
}

// What coturn's use-auth-secret scheme accepts for a username.
function coturnPass(key, user) { return crypto.createHmac('sha1', key).update(user).digest('base64'); }

// A key shaped like a real static-auth-secret, made fresh every run, so a
// line that leaks it cannot pass by luck.
const KEY = crypto.randomBytes(24).toString('hex');
const URL1 = 'turn:relay.example.net:3478';
const KEY_AT = '<dir>' + path.sep + 'turn-key.txt';

function leaks(r, key) {
  return r.log.indexOf(key) >= 0 || r.healthText.indexOf(key) >= 0 || r.iceText.indexOf(key) >= 0;
}

(async () => {
  // ---------------------------------------------------------------------------
  console.log('no file and nothing set, which is every box today:');
  let r = await run({}, {});
  yes('the service came up', r.up);
  yes('/ice answers the same bytes it always did: ' + STUN_ONLY, r.iceText === STUN_ONLY);
  yes('with the same headers, including the one a page on a file:// origin needs',
      r.iceHeaders['content-type'] === 'application/json' &&
      r.iceHeaders['cache-control'] === 'no-store' &&
      r.iceHeaders['access-control-allow-origin'] === '*');
  yes('/health has the same fields in the same order', !!r.health && same(Object.keys(r.health), HEALTH_FIELDS));
  yes('and still says there is no relay', !!r.health && r.health.turn === 'none');
  yes('the log is the two lines every start writes, and nothing about a relay', r.log === startLog(r.port));

  // Each client starts from its own list and swaps in whatever /ice answers,
  // so an unchanged answer leaves every client exactly where it started.
  {
    let text = '';
    try { text = fs.readFileSync(path.join(REPO, 'game', 'ui', 'thornswood-voice.js'), 'utf8'); } catch (e) { text = ''; }
    const m = /(?:var|let) ICE = (\[[^\n]*?\]);/.exec(text);
    let start = null;
    try { start = m ? vm.runInNewContext('(' + m[1] + ')') : null; } catch (e) { start = null; }
    yes('the in-game page starts from the very list /ice hands it, so reading it changes nothing',
        !!start && !!r.ice && same(start, r.ice));
  }
  {
    // The launcher's voice is C# since #4823: VoiceSession.cs starts from
    // IceServer.From(urls, username, credential), read here as the entry
    // /ice would hand for it, and takes the roster's iceServers (TakeIce)
    // in its place for every connection it gathers with.
    let text = '';
    try { text = fs.readFileSync(path.join(REPO, 'launcher', 'app', 'VoiceSession.cs'), 'utf8'); } catch (e) { text = ''; }
    const m = /List<IceServer> ICE = IceServer\.From\(new\[\] \{ ((?:"[^"]*"(?:, )?)+) \}, "([^"]*)", "([^"]*)", null\);/.exec(text);
    let start = null;
    if (m) {
      const urls = m[1].match(/"[^"]*"/g).map((u) => u.slice(1, -1));
      const one = { urls: urls.length === 1 ? urls[0] : urls };
      if (m[2]) { one.username = m[2]; }
      if (m[3]) { one.credential = m[3]; }
      start = [one];
    }
    yes('the launcher\'s voice starts from the very list /ice hands it, so reading it changes nothing',
        !!start && !!r.ice && same(start, r.ice));
    yes('and it takes the list the service hands it in place of its own, and gathers with that',
        /if \(m\.TryGetProperty\("iceServers", out ice\)\) TakeIce\(ice\);/.test(text) && /\n\s*ICE = next;/.test(text) &&
        /pc\.Gather\(ICE\);/.test(text));
  }

  // ---------------------------------------------------------------------------
  console.log('\nno file, and a relay address with no key, which was already refused:');
  r = await run({ THORNSWOOD_TURN_URL: URL1 }, {});
  yes('/ice still answers STUN only', r.iceText === STUN_ONLY);
  yes('/health still calls it misconfigured', !!r.health && r.health.turn === 'MISCONFIGURED');
  yes('the log says what it always said and nothing about a key file',
      /is set but no credentials/.test(r.log) && r.log.indexOf('turn-key.txt') < 0);

  // ---------------------------------------------------------------------------
  console.log('\nthe key in turn-key.txt, written in Notepad, with the address set:');
  r = await run({ THORNSWOOD_TURN_URL: URL1 }, { 'turn-key.txt': KEY + '\r\n' });
  yes('/health says the credential is ephemeral', !!r.health && r.health.turn === 'ephemeral');
  const t = (r.ice || [])[1] || {};
  yes('STUN is still first and the relay is second',
      !!r.ice && same(r.ice[0], { urls: 'stun:stun.l.google.com:19302' }) && same(t.urls, [URL1]));
  const now = Math.floor(Date.now() / 1000);
  yes('the username is an expiry about an hour out', Number(t.username) > now + 3500 && Number(t.username) < now + 3700);
  yes('the credential is HMAC-SHA1 of it under the key in the file, as coturn expects',
      typeof t.username === 'string' && t.credential === coturnPass(KEY, t.username));
  yes('the log says where the key was read from', r.log.indexOf('[voice] relay key read from ' + KEY_AT + '\n') >= 0);
  yes('and the key itself is nowhere: not the log, not /health, not /ice', !leaks(r, KEY));

  // ---------------------------------------------------------------------------
  // Windows PowerShell's > and Out-File write UTF-16 with a byte order mark.
  // Read as UTF-8 that is a different key, the relay refuses every credential,
  // and nothing says why.
  console.log('\nthe key written by Windows PowerShell\'s >, which is UTF-16:');
  const utf16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(KEY + '\r\n', 'utf16le')]);
  r = await run({ THORNSWOOD_TURN_URL: URL1 }, { 'turn-key.txt': utf16 });
  let u = (r.ice || [])[1] || {};
  yes('the credential is made from the key, not from the bytes around it',
      typeof u.username === 'string' && u.credential === coturnPass(KEY, u.username));

  console.log('\nthe key written by Set-Content -Encoding UTF8, which puts a byte order mark first:');
  const bom8 = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(KEY + '\r\n', 'utf8')]);
  r = await run({ THORNSWOOD_TURN_URL: URL1 }, { 'turn-key.txt': bom8 });
  u = (r.ice || [])[1] || {};
  yes('the credential is made from the key, not from the mark',
      typeof u.username === 'string' && u.credential === coturnPass(KEY, u.username));

  // ---------------------------------------------------------------------------
  console.log('\nthe key and no address:');
  r = await run({}, { 'turn-key.txt': KEY });
  yes('no relay is offered: /ice is STUN only, to the byte', r.iceText === STUN_ONLY);
  yes('/health says none', !!r.health && r.health.turn === 'none');
  yes('the log says the key is there but the address is not',
      r.log.indexOf('[voice] relay key read from ' + KEY_AT +
                    ', but THORNSWOOD_TURN_URL is not set, so no relay is offered\n') >= 0);
  yes('and the key itself is nowhere', !leaks(r, KEY));

  // ---------------------------------------------------------------------------
  console.log('\nthe variable and the file both set:');
  const FROM_ENV = crypto.randomBytes(24).toString('hex');
  r = await run({ THORNSWOOD_TURN_URL: URL1, THORNSWOOD_TURN_SECRET: FROM_ENV }, { 'turn-key.txt': KEY });
  u = (r.ice || [])[1] || {};
  yes('the variable wins', typeof u.username === 'string' && u.credential === coturnPass(FROM_ENV, u.username));
  yes('the file is not read at all, so the log does not name it', r.log.indexOf('turn-key.txt') < 0);
  yes('and neither key is anywhere', !leaks(r, KEY) && !leaks(r, FROM_ENV));

  // ---------------------------------------------------------------------------
  console.log('\na file with nothing in it:');
  r = await run({ THORNSWOOD_TURN_URL: URL1 }, { 'turn-key.txt': '  \r\n' });
  yes('is the same as no file: STUN only and misconfigured',
      r.iceText === STUN_ONLY && !!r.health && r.health.turn === 'MISCONFIGURED');
  yes('and the log does not name it', r.log.indexOf('turn-key.txt') < 0);

  console.log('\na turn-key.txt that is there and cannot be read:');
  r = await run({ THORNSWOOD_TURN_URL: URL1 }, { 'turn-key.txt': null });
  yes('the service still comes up', r.up);
  yes('serves no relay', r.iceText === STUN_ONLY && !!r.health && r.health.turn === 'MISCONFIGURED');
  yes('and says it could not read the file, by where it is',
      r.log.indexOf('[voice] could not read ' + KEY_AT + ' (') >= 0);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
