/*
  test-1323-door-limits.js

      node voice\tests\test-1323-door-limits.js

  #1323. Neither POST /token nor the socket handshake counted anything: on
  5 Oct, against main, sixty of each from one address, one after another,
  were every one answered.

  This starts the real service in a temp folder with the shipped numbers
  (twenty token requests and sixty sockets a minute from one place) and
  asks it the way Caddy carries a request, from 127.0.0.1 with the sender in
  X-Forwarded-For. It proves:

    the twentieth token request from one address is let in and the next is
    answered 429 with a Retry-After inside the minute, and so are the
    sixtieth and sixty first sockets, the refused one closed with no 101;
    a refusal is not counted: a script that keeps asking is told the same
    minute, not a longer one;
    another address is a place of its own, and two IPv6 addresses in one
    /64 are one place while another /64 is not;
    only the last forwarded hop counts, the one Caddy wrote, so a sender
    cannot pick its own place by writing hops in front of it;
    this machine itself, with nobody's address forwarded, is never counted;
    a refused handshake whose client hangs up at once does not stop the
    service;
    and the log says so once, not once per refusal.

  VOICE points it at another copy of voice-server.js, which is how it was
  shown to fail on the code before the change. Writes only to a temp folder,
  on a loopback port the system hands out.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

let PORT = 0;
/*
  A socket needs a join token of its own, offered with the handshake (#1337,
  #1322), so this signs them with a key it puts beside its copy of the
  service; then a 101 is the door letting it in and nothing else.
*/
const KEY = crypto.randomBytes(32).toString('hex');
let nextPid = 1;
function tokenFor(pid) {
  const body = 'v2.' + pid + '.' + Date.now() + '.' + crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/* POST /token, with the sender forwarded the way Caddy writes it, or none. */
function token(xff) {
  return new Promise((ok) => {
    const body = JSON.stringify({ profileId: 7, ticket: 't' });
    const headers = { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) };
    if (xff) { headers['x-forwarded-for'] = xff; }
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/token', method: 'POST', headers: headers, agent: false },
      (res) => { res.resume(); res.on('end', () => ok({ status: res.statusCode, retry: Number(res.headers['retry-after'] || 0) })); });
    req.on('error', () => ok({ status: 0, retry: 0 }));
    req.end(body);
  });
}
/* A socket handshake, forwarded or not: the status line's number, and the
   Retry-After it carried. */
function knock(xff, hangUp) {
  return new Promise((ok) => {
    const s = net.connect(PORT, '127.0.0.1');
    let buf = '';
    let done = false;
    const finish = (v) => { if (!done) { done = true; s.destroy(); ok(v); } };
    s.on('connect', () => {
      s.write('GET / HTTP/1.1\r\nHost: 127.0.0.1:' + PORT + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
              'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
              'Sec-WebSocket-Protocol: thornswood, ' + tokenFor(nextPid++) + '\r\n' +
              (xff ? 'X-Forwarded-For: ' + xff + '\r\n' : '') + '\r\n');
      if (hangUp) { s.resetAndDestroy(); finish({ status: -1, retry: 0 }); }
    });
    s.on('data', (d) => {
      buf += d;
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) { return; }
      const m = /^HTTP\/1\.1 (\d+)/.exec(buf);
      const r = /\r\nRetry-After: (\d+)/i.exec(buf.slice(0, i));
      finish({ status: m ? Number(m[1]) : 0, retry: r ? Number(r[1]) : 0 });
    });
    s.on('error', () => finish({ status: 0, retry: 0 }));
    s.on('close', () => finish({ status: 0, retry: 0 }));
  });
}
async function many(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) { out.push(await fn()); }
  return out;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1323-'));
  fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
  fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
  PORT = await freePort('127.0.0.1');
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                                          THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
                                          THORNSWOOD_TOKEN_PER_MINUTE: '', THORNSWOOD_SOCKETS_PER_MINUTE: '' }) });
  let srvLog = '';
  let exited = null;
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  await listening(srv, PORT);
  srv.on('exit', (code) => { exited = code; });

  console.log('POST /token, twenty a minute from one place:');
  let r = await many(20, () => token('203.0.113.7'));
  yes('the first twenty are let in (answered ' + Array.from(new Set(r.map((x) => x.status))).join(', ') + ')',
      r.every((x) => x.status !== 429 && x.status !== 0));
  const first = await token('203.0.113.7');
  yes('the twenty first is answered 429 (' + first.status + ')', first.status === 429);
  yes('with a Retry-After inside the minute (' + first.retry + ' s)', first.retry >= 1 && first.retry <= 60);
  r = await many(30, () => token('203.0.113.7'));
  const again = r[r.length - 1];
  yes('thirty more refusals are not counted: still 429, and the same minute (' + again.retry + ' s)',
      r.every((x) => x.status === 429) && again.retry <= first.retry);
  r = await token('203.0.113.8');
  yes('another address is a place of its own (' + r.status + ')', r.status !== 429);
  r = await token('10.0.0.1, 203.0.113.7');
  yes('hops written in front of the last one change nothing (' + r.status + ')', r.status === 429);
  r = await token('203.0.113.7, 203.0.113.9');
  yes('the last hop, the one Caddy wrote, is the place (' + r.status + ')', r.status !== 429);
  r = await many(20, () => token('2001:db8:1:2::a'));
  const v6 = await token('2001:db8:1:2:ffff::b');
  yes('two IPv6 addresses in one /64 are one place (' + v6.status + ')', r.every((x) => x.status !== 429) && v6.status === 429);
  r = await token('2001:db8:1:3::a');
  yes('and another /64 is not (' + r.status + ')', r.status !== 429);
  r = await many(40, () => token(''));
  yes('this machine itself, with nobody forwarded, is never counted (40 asked)', r.every((x) => x.status !== 429));

  console.log('\nsockets, sixty a minute from one place:');
  r = await many(60, () => knock('198.51.100.4'));
  yes('the first sixty are let in (answered ' + Array.from(new Set(r.map((x) => x.status))).join(', ') + ')',
      r.every((x) => x.status === 101));
  const s61 = await knock('198.51.100.4');
  yes('the sixty first is answered 429, with no 101 (' + s61.status + ')', s61.status === 429);
  yes('with a Retry-After inside the minute (' + s61.retry + ' s)', s61.retry >= 1 && s61.retry <= 60);
  r = await knock('198.51.100.5');
  yes('another address is let in (' + r.status + ')', r.status === 101);
  r = await many(80, () => knock(''));
  yes('this machine itself is never counted (80 opened)', r.every((x) => x.status === 101));
  await many(200, () => knock('198.51.100.4', true));
  await wait(300);
  yes('200 refused handshakes that hang up at once leave the service running', exited === null);
  let h = null;
  try { h = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json(); } catch (e) { }
  yes('and it still answers', !!h && h.ok === true);

  console.log('\nthe log:');
  const said = srvLog.split('\n').filter((l) => /answered 429 until the minute is up/.test(l));
  yes('says it once for each door, not once per refusal (' + said.length + ')', said.length === 2 &&
      said.some((l) => /20 token requests/.test(l)) && said.some((l) => /60 sockets/.test(l)));
  yes('and never names an address', !/203\.0\.113|198\.51\.100|2001:db8/.test(srvLog));

  if (exited === null) { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
