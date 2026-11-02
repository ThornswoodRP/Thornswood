/*
  test-1352-site-answer-limit.js

      node voice\tests\test-1352-site-answer-limit.js

  #1352. Before minting a join token the voice service asks the site whether
  the ticket owns the profile (owns() in voice/voice-server.js), and it read
  the site's answer with no bound. Measured on 5 Oct against main: a site
  answering 400 MB took the service from 47 MB to 534 MB, one answering more
  than about 512 MB stopped it (RangeError: Invalid string length), and one
  sending a byte a second held /token open for as long as it kept sending,
  because its three seconds counted only time with nothing arriving.

  This starts the real service in a temp folder with THORNSWOOD_SITE pointed
  at a stand-in site whose answer the test chooses, and proves:

    an ordinary yes and an ordinary no still decide the token;
    an answer that will not stop is cut off a little past 64 KB, the token
    is not a checked one, it is answered at once, and the service lives;
    an answer that trickles is given up on at three seconds, unchecked;
    a slow answer that is whole inside the three seconds still counts;
    and (#1339) the service's output never carries the ticket or a token it
    minted.

  What /token does with unchecked is #1315's to decide, so an unchecked
  answer here only has to be something other than a checked token.

  VOICE points it at another copy of voice-server.js, which is how it was
  shown to fail on the code before the change. Writes only to a temp folder,
  on loopback ports the system hands out.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');
const TICKET = 'TICKET-1352-never-in-a-log';

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

/*
  The stand-in site. mode says how it answers /api/play/owns; wrote counts
  the bytes of body it got out, and cut says the service hung up on it
  before it had finished.
*/
const site = { mode: 'yes', wrote: 0, cut: false, asked: [] };
const STREAM_STOP = 64 * 1024 * 1024;
const siteServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    site.asked.push(body);
    site.wrote = 0; site.cut = false;
    let finished = false;
    res.on('close', () => { if (!finished) { site.cut = true; } });
    if (site.mode === 'yes' || site.mode === 'no') {
      finished = true;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: site.mode === 'yes', why: site.mode === 'yes' ? 'theirs' : 'somebody else' }));
      return;
    }
    if (site.mode === 'slow') {
      setTimeout(() => {
        finished = true;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true,"why":"theirs"}');
      }, 1200);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (site.mode === 'endless') {
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      const pump = () => {
        while (!site.cut && site.wrote < STREAM_STOP) {
          site.wrote += chunk.length;
          if (!res.write(chunk)) { res.once('drain', pump); return; }
        }
      };
      res.write('{"ok":true,"why":"');
      pump();
      return;
    }
    // trickle: the start of a yes, then a space every half second, never done
    res.write('{"ok":true,');
    const t = setInterval(() => {
      if (site.cut) { clearInterval(t); return; }
      site.wrote += 1;
      res.write(' ');
    }, 500);
    res.on('close', () => clearInterval(t));
  });
});

async function token(port) {
  const t0 = Date.now();
  try {
    const r = await fetch('http://127.0.0.1:' + port + '/token', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profileId: 42, ticket: TICKET }),
      signal: AbortSignal.timeout(12000)
    });
    const text = await r.text();
    let doc = null;
    try { doc = JSON.parse(text); } catch (e) { }
    return { status: r.status, doc: doc, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, doc: null, ms: Date.now() - t0, err: String(e && e.message) }; }
}
// A token the site vouched for: 200 with a token that does not say checked
// false. Since #1315 an unchecked one is not minted at all, and a minted one
// no longer carries checked; before it, unchecked came back checked false.
const checked = (r) => r.status === 200 && !!r.doc && typeof r.doc.token === 'string' && r.doc.checked !== false;

(async () => {
  await new Promise((ok) => siteServer.listen(0, '127.0.0.1', ok));
  const SITE_PORT = siteServer.address().port;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1352-'));
  fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
  const PORT = await freePort('127.0.0.1');
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                                          THORNSWOOD_SITE: 'http://127.0.0.1:' + SITE_PORT,
                                          THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') }) });
  let srvLog = '';
  let exited = null;
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  await listening(srv, PORT);
  srv.on('exit', (code) => { exited = code; });
  const minted = [];

  console.log('an ordinary answer:');
  site.mode = 'yes';
  let r = await token(PORT);
  yes('a yes mints a checked token (' + r.status + ')', checked(r));
  if (r.doc && r.doc.token) { minted.push(r.doc.token); }
  yes('and the site was asked with the ticket', site.asked.length === 1 && site.asked[0].indexOf(TICKET) >= 0);
  site.mode = 'no';
  r = await token(PORT);
  yes('a no is refused with 403 (' + r.status + ')', r.status === 403);

  console.log('\nan answer that will not stop:');
  site.mode = 'endless';
  r = await token(PORT);
  if (r.doc && r.doc.token) { minted.push(r.doc.token); }
  yes('/token answers inside two seconds (' + r.ms + ' ms)', r.status !== 0 && r.ms < 2000);
  yes('and not with a checked token (' + r.status + ')', !checked(r));
  await wait(200);
  yes('the service hung up on the site', site.cut);
  yes('a little past 64 KB, not the ' + (STREAM_STOP >> 20) + ' MB it would have sent (' +
      Math.round(site.wrote / 1024) + ' KB written)',
      site.cut && site.wrote < 16 * 1024 * 1024);
  yes('and the log says the answer was too long', /passed 65536 bytes, so the rest was not read/.test(srvLog));
  let h = null;
  try { h = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json(); } catch (e) { }
  yes('the service is still running and answering', exited === null && !!h && h.ok === true);

  console.log('\nan answer that trickles:');
  site.mode = 'trickle';
  r = await token(PORT);
  if (r.doc && r.doc.token) { minted.push(r.doc.token); }
  yes('/token answers at about three seconds (' + r.ms + ' ms)', r.status !== 0 && r.ms >= 2500 && r.ms < 5000);
  yes('and not with a checked token (' + r.status + ')', !checked(r));
  await wait(200);
  yes('and the service hung up on the site', site.cut);

  console.log('\na slow answer, whole inside the three seconds:');
  site.mode = 'slow';
  r = await token(PORT);
  if (r.doc && r.doc.token) { minted.push(r.doc.token); }
  yes('still counts: a checked token after about a second (' + r.ms + ' ms)', checked(r) && r.ms >= 1000);

  console.log('\nthe service\'s output (#1339):');
  yes('it never carries the ticket', srvLog.indexOf(TICKET) < 0);
  yes('it never carries a token it minted (' + minted.length + ' minted)',
      minted.length >= 2 && minted.every((t) => srvLog.indexOf(t) < 0) && !/v1\.42\./.test(srvLog));

  siteServer.closeAllConnections && siteServer.closeAllConnections();
  siteServer.close();
  if (exited === null) { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); process.exit(1); });
