/*
  test-1321-socket-origin.js

      node voice\tests\test-1321-socket-origin.js

  #1321. The voice service never read a socket's Origin, so any website
  could open sockets to it from its visitors' browsers: on 5 Oct, against
  main, a handshake with Origin https://evil.example was answered 101 and
  its join welcomed.

  This starts the real service in a temp folder and makes raw handshakes
  with the Origin and Host a browser would send, proving:

    a page on another website is refused with 403, before any 101, and the
    socket is closed;
    so is a page on this host at another port, a look-alike host, and an
    Origin that is not an address at all;
    so is a page on this very host, asked straight (Host 127.0.0.1:port) and
    through Caddy (Host thornswood.net, Origin https://thornswood.net,
    X-Forwarded-For set): the service's own page was let in that way until it
    went (#1822), and nothing else of ours is served from there;
    the game's pages and the launcher's voice page, loaded off disk, say
    null or file:// and are let in, and join;
    a client that sends no Origin, which is not a browser, is let in and
    joins, as every harness does;
    a refused page that hangs up as it is answered does not stop the
    service;
    and the refusal is in the log once, not once per socket.

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
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

/*
  How long any one answer is waited for before the wait gives up and says
  what did not come. Each check waits for the thing it reads (#1926), so this
  only ends a wait on a service that is stuck, as listening() does.
*/
const BOUND_MS = 15000;

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
  Every join proves itself with a token (#1303); one token opens one
  connection and goes with the handshake, after 'thornswood' (#1337, #1322).
  The site, as far as the service asks it anything: every ticket owns its
  profile. So the service mints each join token itself (joinToken).
*/
function siteThatSaysYes() {
  return new Promise((ok) => {
    const site = http.createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/api/play/owns') {
          res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
        } else {
          res.writeHead(404).end();
        }
      });
    });
    // Once it is up it holds nothing open, so a harness that ends by letting
    // its loop drain still ends; before that the listen itself keeps it alive.
    site.listen(0, '127.0.0.1', () => { site.unref(); ok('http://127.0.0.1:' + site.address().port); });
  });
}
let SITE = '';

/*
  A join token as the launcher gets one: asked of the service, which mints
  it on its own clock once the site says the ticket owns the profile. It was
  signed here with this process's Date.now(), and the service refuses a
  token minted before it started by its own clock; on Windows two node
  processes can read the wall clock a few ms apart, so the first token could
  read as older than the service (#1867, #1963).
*/
function joinToken(port, pid) {
  return new Promise((ok, bad) => {
    const body = JSON.stringify({ profileId: pid, ticket: 'a ticket the stand-in site takes' });
    const req = http.request({ host: '127.0.0.1', port: port, path: '/token', method: 'POST', agent: false,
                               headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let doc = null;
        try { doc = JSON.parse(b); } catch (e) { }
        if (res.statusCode === 200 && doc && typeof doc.token === 'string') { ok(doc.token); return; }
        bad(new Error('the service minted no token for profile ' + pid + ': ' + res.statusCode + ' ' + b.slice(0, 200)));
      });
    });
    req.on('error', bad);
    req.end(body);
  });
}

/* A masked text frame, the way a browser sends one. */
function textFrame(obj) {
  const data = Buffer.from(JSON.stringify(obj), 'utf8');
  const head = data.length < 126 ? Buffer.from([0x81, 0x80 | data.length])
                                 : Buffer.from([0x81, 0x80 | 126, data.length >> 8, data.length & 255]);
  const key = crypto.randomBytes(4);
  const body = Buffer.from(data);
  for (let i = 0; i < body.length; i++) { body[i] ^= key[i & 3]; }
  return Buffer.concat([head, key, body]);
}

/*
  A raw handshake with the headers given: { status, joined, closed, late }.
  It resolves on what the checks read: the welcome to its join, or the
  socket's end. It used to give every handshake 400 ms and read whatever had
  come by then, so on a busy machine a welcome or a close that came later
  read as a page refused or a socket left open (#1926). BOUND_MS with
  neither is a stuck service, and late then says what did not come.
*/
async function knock(port, headers, pid) {
  const token = await joinToken(port, pid);
  return new Promise((ok) => {
    const s = net.connect(port, '127.0.0.1');
    const me = { status: 0, joined: false, closed: false, late: '' };
    let buf = Buffer.alloc(0);
    let settled = false;
    const done = () => {
      if (settled) { return; }
      settled = true;
      clearTimeout(bound);
      s.destroy();
      ok(me);
    };
    const bound = setTimeout(() => {
      me.late = me.status === 101 ? 'no welcome to its join within ' + BOUND_MS / 1000 + ' s'
              : me.status ? 'answered ' + me.status + ' and the socket still open after ' + BOUND_MS / 1000 + ' s'
              : 'no answer to the handshake within ' + BOUND_MS / 1000 + ' s';
      done();
    }, BOUND_MS);
    s.on('connect', () => {
      let h = 'GET / HTTP/1.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n' +
              'Sec-WebSocket-Key: ' + crypto.randomBytes(16).toString('base64') + '\r\n' +
              'Sec-WebSocket-Protocol: thornswood, ' + token + '\r\n';
      for (const k of Object.keys(headers)) { h += k + ': ' + headers[k] + '\r\n'; }
      s.write(h + '\r\n');
    });
    s.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (!me.status) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) { return; }
        me.status = Number((/^HTTP\/1\.1 (\d+)/.exec(buf.slice(0, i).toString()) || [])[1] || 0);
        buf = buf.slice(i + 4);
        if (me.status === 101) { s.write(textFrame({ t: 'join', profileId: pid, name: 'P' + pid })); }
      }
      if (buf.indexOf('"welcome"') >= 0) { me.joined = true; done(); }
    });
    // Only a close the service made counts; the destroy in done() comes after.
    s.on('close', () => { if (!settled) { me.closed = true; done(); } });
    s.on('error', () => { });
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1321-'));
  fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
  SITE = await siteThatSaysYes();
  const PORT = await freePort('127.0.0.1');
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                                          THORNSWOOD_SITE: SITE, THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') }) });
  let srvLog = '';
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  // Once it has gone and every line it wrote has been read ('close').
  const srvClosed = new Promise((ok) => srv.once('close', ok));
  await listening(srv, PORT);
  const HOST = '127.0.0.1:' + PORT;
  let pid = 100;

  console.log('a page somewhere else:');
  for (const [what, origin, host] of [
    ['another website', 'https://evil.example', HOST],
    ['this host at another port', 'http://127.0.0.1:' + (PORT === 65535 ? 1 : PORT + 1), HOST],
    ['a look-alike of the site', 'https://thornswood.net.evil.example', 'thornswood.net'],
    ['another website through Caddy', 'https://evil.example', 'thornswood.net'],
    ['an Origin that is not an address', 'not an origin', HOST],
    ['a page on this host asked straight', 'http://' + HOST, HOST],
    ['a page on this host through Caddy', 'https://thornswood.net', 'thornswood.net'],
    ['a page on this host through Caddy, written in capitals', 'HTTPS://Thornswood.net', 'thornswood.net']
  ]) {
    const h = { Host: host, Origin: origin };
    if (host === 'thornswood.net') { h['X-Forwarded-For'] = '203.0.113.7'; }
    const r = await knock(PORT, h, ++pid);
    yes(what + ' (' + origin + ') is refused with 403 (' + r.status + '), not joined, and closed',
        r.status === 403 && !r.joined && r.closed, r.late);
  }

  /*
    A refused page that is already gone when the 403 is written. The HTTP
    server takes its own error listener off a socket it hands over for an
    upgrade, so an error there with nobody listening stopped the service:
    in the first version of this change, 300 such handshakes ended it with
    "Error: write ECONNRESET".

    Each one is made once the one before it is gone at this end. Then a page
    that may come in knocks and joins. All 200 have reached the service before
    that handshake does, and its welcome takes two answers more, so a stop
    they cause has come by then. This used to read whether the service had
    stopped 300 ms after the last of them instead (#1926).
  */
  let exited = null;
  srv.on('exit', (code) => { exited = code; });
  for (let i = 0; i < 200 && exited === null; i++) {
    await new Promise((gone) => {
      const c = net.connect(PORT, '127.0.0.1', () => {
        c.write('GET / HTTP/1.1\r\nHost: ' + HOST + '\r\nOrigin: https://evil.example\r\nUpgrade: websocket\r\n' +
                'Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ' +
                crypto.randomBytes(16).toString('base64') + '\r\n\r\n');
        c.resetAndDestroy();
      });
      c.on('error', () => { });
      c.on('close', gone);
    });
  }
  const next = await knock(PORT, { Host: HOST }, ++pid);
  yes('200 refused pages that hang up at once leave the service running, and the next page joins (' + next.status + ')',
      exited === null && next.status === 101 && next.joined,
      exited !== null ? 'the service stopped (exit ' + exited + ')' : next.late);

  console.log('\nthe game\'s pages and the launcher\'s:');
  for (const [what, origin, host] of [
    ['a page off disk that says null', 'null', HOST],
    ['a page off disk that says file://', 'file://', HOST]
  ]) {
    const h = { Host: host, Origin: origin };
    if (host === 'thornswood.net') { h['X-Forwarded-For'] = '203.0.113.7'; }
    const r = await knock(PORT, h, ++pid);
    yes(what + ' (' + origin + ') is let in and joins (' + r.status + ')', r.status === 101 && r.joined, r.late);
  }
  const bare = await knock(PORT, { Host: HOST }, ++pid);
  yes('no Origin at all, which is not a browser, is let in and joins (' + bare.status + ')',
      bare.status === 101 && bare.joined, bare.late);
  const nodePid = ++pid;
  const node = new WebSocket('ws://' + HOST + '/', ['thornswood', await joinToken(PORT, nodePid)]);
  // Its welcome, or the socket ending without one, or BOUND_MS of neither.
  // It used to read 200 ms after the join was sent (#1926).
  const nodeWhy = await new Promise((ok) => {
    const bound = setTimeout(() => ok('no welcome within ' + BOUND_MS / 1000 + ' s'), BOUND_MS);
    const end = (why) => { clearTimeout(bound); ok(why); };
    node.onopen = () => node.send(JSON.stringify({ t: 'join', profileId: nodePid, name: 'Harness' }));
    node.onmessage = (e) => { if (/"welcome"/.test(String(e.data))) { end(''); } };
    node.onclose = (e) => end('the socket closed without a welcome (' + e.code + ')');
  });
  yes('and so is node\'s own WebSocket, as every harness uses', !nodeWhy, nodeWhy);
  try { node.close(); } catch (e) { }

  /*
    The log is read once the service has gone and every line it wrote has
    come through its pipe. A line is written before the answer it goes with,
    but on another pipe, and on a busy machine the answer can come first
    (#1867).
  */
  if (exited === null) { srv.kill(); }
  await srvClosed;
  console.log('\nthe log:');
  const said = srvLog.split('\n').filter((l) => /refused a socket opened by a page on/.test(l));
  yes('the refusal is in the log once, not once per socket (' + said.length + ')', said.length === 1 &&
      /"https:\/\/evil\.example"/.test(said[0]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
