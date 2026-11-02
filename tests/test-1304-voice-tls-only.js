// test-1304-voice-tls-only.js
//
//     node tests\test-1304-voice-tls-only.js
//
// #1304. A join token and a Discord ticket only ever travel over TLS.
//
// Every client reaches the voice service through Caddy, https and wss, and
// the raw ports have been shut from outside since 29 September. But the
// service listened on every interface unless told otherwise and took a token
// over plain ws from anywhere, Install-Voice.ps1 opened the port by default,
// and every client still built ws://address:port when it had no https
// address. This starts the real voice-server.js and checks:
//   1. with no THORNSWOOD_VOICE_BIND it listens on loopback only;
//   2. told to answer every interface, it still refuses a handshake or a
//      /token that comes straight off the network (this machine's own
//      non-loopback address stands in for the internet), spends the token
//      that came that way, and answers /health as before;
//   3. through a proxy that says it took the request over plain http
//      (X-Forwarded-Proto), the same; over https, a connection;
//   4. the launcher's voice (C# since #4823, run by tests\voice-launcher.js
//      on sockets this harness answers), the game's chat, its voice overlay
//      and the launcher's Config build nothing but https and wss;
//   5. Install-Voice.ps1 binds loopback unless told otherwise, and opens the
//      firewall only for a service that answers every interface.
//
// Writes only to temp folders, the voice driver's build among them.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const VL = require('./voice-launcher');

const ROOT = path.join(__dirname, '..');
const VOICE = path.join(ROOT, 'voice', 'voice-server.js');
const CR = String.fromCharCode(13);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join('');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

/*
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
  processes can read the wall clock a few ms apart (#1867).
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

const started = [];
async function start(bind) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1304-'));
  fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
  const env = Object.assign({}, process.env, { THORNSWOOD_SITE: SITE, THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') });
  delete env.THORNSWOOD_VOICE_BIND;
  if (bind) { env.THORNSWOOD_VOICE_BIND = bind; }
  const port = await freePort(bind || '127.0.0.1');
  env.THORNSWOOD_VOICE_PORT = String(port);
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir, env: env });
  const me = { srv: srv, port: port, log: '' };
  srv.stdout.on('data', (d) => { me.log += d; });
  srv.stderr.on('data', (d) => { me.log += d; });
  started.push(srv);
  await listening(srv, port);
  return me;
}

/* A handshake by hand from a given address: { status, body }. */
function knock(host, port, headers) {
  return new Promise((ok) => {
    const h = Object.assign({ Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
                              'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64') }, headers || {});
    const req = http.request({ host: host, port: port, path: '/', headers: h, agent: false });
    req.on('upgrade', (res, socket) => { ok({ status: res.statusCode, body: '' }); socket.destroy(); });
    req.on('response', (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b })); });
    req.on('error', (e) => ok({ status: 0, body: String(e && e.code) }));
    req.setTimeout(3000, () => { req.destroy(); });
    req.end();
  });
}
function ask(host, port, method, where, body, headers) {
  return new Promise((ok) => {
    const data = body == null ? null : JSON.stringify(body);
    const h = Object.assign({}, headers || {});
    if (data != null) { h['content-type'] = 'application/json'; h['content-length'] = Buffer.byteLength(data); }
    const req = http.request({ host: host, port: port, method: method, path: where, headers: h, agent: false }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b }));
    });
    req.on('error', (e) => ok({ status: 0, body: String(e && e.code) }));
    req.setTimeout(3000, () => { req.destroy(); });
    if (data != null) { req.write(data); }
    req.end();
  });
}

// This machine's own address on its network, which reaches the service the
// way a request off the internet would: not from loopback.
let LAN = '';
for (const list of Object.values(os.networkInterfaces())) {
  for (const a of list || []) { if (a.family === 'IPv4' && !a.internal && !LAN) { LAN = a.address; } }
}

(async () => {
  SITE = await siteThatSaysYes();
  console.log('1. with no THORNSWOOD_VOICE_BIND:');
  const quiet = await start('');
  const h = JSON.parse((await ask('127.0.0.1', quiet.port, 'GET', '/health')).body || '{}');
  yes('it says it is on loopback (' + h.bind + ')', h.bind === '127.0.0.1');
  if (LAN) {
    const r = await ask(LAN, quiet.port, 'GET', '/health');
    yes('and nothing answers on this machine\'s own address ' + LAN + ' (' + (r.status || r.body) + ')', r.status === 0);
  } else {
    console.log('SKIP  this machine has no address but loopback, so nothing can come off a network');
  }

  console.log('\n2. told to answer every interface, straight off the network:');
  const open = await start('0.0.0.0');
  if (LAN) {
    const tok = await joinToken(open.port, 77);
    const r = await knock(LAN, open.port, { 'Sec-WebSocket-Protocol': 'thornswood, ' + tok });
    yes('a handshake with a good token is refused over plain ws (' + r.status + ')', r.status === 403 && /only goes over wss/.test(r.body));
    const again = await knock('127.0.0.1', open.port, { 'Sec-WebSocket-Protocol': 'thornswood, ' + tok });
    yes('and that token is spent, so a copy off the wire opens nothing even from here (' + again.status + ')',
        again.status === 403 && /already used/.test(again.body));
    const t = await ask(LAN, open.port, 'POST', '/token', { profileId: 77, ticket: 'a ticket' });
    yes('/token is refused over plain http (' + t.status + ')', t.status === 403 && /only goes over https/.test(t.body));
    yes('/health still answers there, carrying nothing', (await ask(LAN, open.port, 'GET', '/health')).status === 200);
    yes('the log says why, and never the token', /REFUSED a connection that came over plain ws, and spent the token/.test(open.log) &&
        /REFUSED a token request that came over plain http/.test(open.log) && open.log.indexOf(tok) < 0);
  } else {
    console.log('SKIP  no address but loopback on this machine');
  }

  console.log('\n3. through a proxy, as it says it took the request:');
  const viaHttp = await knock('127.0.0.1', open.port, { 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'http',
                                                         'Sec-WebSocket-Protocol': 'thornswood, ' + await joinToken(open.port, 78) });
  yes('over plain http, refused (' + viaHttp.status + ')', viaHttp.status === 403);
  const tHttp = await ask('127.0.0.1', open.port, 'POST', '/token', { profileId: 78, ticket: 'x' },
                          { 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'http' });
  yes('/token over plain http through it, refused (' + tHttp.status + ')', tHttp.status === 403);
  const viaHttps = await knock('127.0.0.1', open.port, { 'X-Forwarded-For': '203.0.113.9', 'X-Forwarded-Proto': 'https',
                                                          'Sec-WebSocket-Protocol': 'thornswood, ' + await joinToken(open.port, 79) });
  yes('over https, the way Caddy carries it, a connection (' + viaHttps.status + ')', viaHttps.status === 101);
  const here = await knock('127.0.0.1', open.port, { 'Sec-WebSocket-Protocol': 'thornswood, ' + await joinToken(open.port, 80) });
  yes('and this machine itself, with nothing forwarded, a connection (' + here.status + ')', here.status === 101);

  console.log('\n4. the clients build nothing but https and wss:');
  function lift(src, name) {
    const i = src.indexOf('function ' + name + '(');
    if (i < 0) { return null; }
    let d = 0, s = false;
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') { d++; s = true; } else if (src[j] === '}') { d--; if (s && d === 0) { return src.slice(i, j + 1); } }
    }
    return null;
  }
  /* The launcher's voice, configured as Voice.cs configures it, on a socket
     this harness answers: what it dials, if anything. */
  async function dialled(vbase, vsocket) {
    const l = await VL.start({ clock: 'manual', wire: 'fake' });
    try {
      await l.send({ do: 'configure', profileId: 7, name: '', token: 'a token', base: vbase, socket: vsocket });
      return { urls: l.dials().map((d) => d.url), off: l.says(/^the launcher gave no secure voice address, so voice is off$/) };
    } finally { await l.quit(); }
  }
  const d1 = await dialled('', '');
  yes('the launcher\'s voice with no address dials nothing, not ws:// (' + JSON.stringify(d1.urls) + ')', d1.urls.length === 0 && d1.off);
  const d2 = await dialled('http://box/voice', 'ws://box/voice/');
  yes('and with an http base and a ws socket, still nothing, and it says so (' + JSON.stringify(d2.urls) + ')', d2.urls.length === 0 && d2.off);
  const d3 = await dialled('https://thornswood.net/voice', '');
  yes('with an https base, wss (' + JSON.stringify(d3.urls) + ')', d3.urls.length === 1 && d3.urls[0] === 'wss://thornswood.net/voice/');
  const d4 = await dialled('https://thornswood.net/voice', 'wss://thornswood.net/voice-dev/');
  yes('and a wss socket from the launcher is taken as it is', d4.urls.length === 1 && d4.urls[0] === 'wss://thornswood.net/voice-dev/');
  const chat = read('game/ui/thornswood-chat.js');
  const cu = (cfg) => new Function('CFG', lift(chat, 'url') + '; return url;')(cfg)();
  yes('the game\'s chat with no base has no address, not ws://', cu({}) === '');
  yes('nor with an http one', cu({ base: 'http://box/voice' }) === '');
  yes('and wss with an https one', cu({ base: 'https://thornswood.net/voice-dev' }) === 'wss://thornswood.net/voice-dev/');
  yes('and it says so rather than trying', /if \(!url\(\)\) \{ note\('No secure address for the chat from the launcher/.test(chat));
  const overlay = read('game/ui/thornswood-voice.js');
  // It asked /ice at the https address only; since #1821 it asks /ice
  // nothing, because the list comes on the roster over the wss socket.
  yes('the game\'s voice overlay asks the voice service nothing over http', !/\/ice'/.test(overlay) &&
      !/'http:\/\/' \+ cfg\.host/.test(overlay));
  const conf = read('launcher/app/Config.cs');
  const vb = lift(conf.replace(/public string VoiceBase\(\)/, 'function VoiceBase()'), 'VoiceBase') || '';
  yes('Config.VoiceBase gives an https VoiceUrl, else the built-in address, never the raw port',
      /StartsWith\("https:\/\/"/.test(vb) && /IsDev \? Voice \+ "-dev" : Voice/.test(vb) && !/"http:\/\/"/.test(vb) &&
      /public const string Voice = "https:\/\/thornswood\.net\/voice";/.test(conf));
  yes('Config.VoiceSocket is always wss', /return "wss:\/\/" \+ VoiceBase\(\)\.Substring\(8\) \+ "\/";/.test(conf) && !/"ws:\/\/"/.test(conf));
  const vcs = read('launcher/app/Voice.cs') + read('launcher/app/VoiceSession.cs');
  yes('Voice.cs and VoiceSession.cs build no http:// or ws:// address of their own', !/"http:\/\/" \+ host/.test(vcs) && !/"ws:\/\/"/.test(vcs));
  yes('and Mics.cs hands the game the resolved https address', /string vurl = cfg == null \? "" : cfg\.VoiceBase\(\);/.test(read('launcher/app/Mics.cs')));

  console.log('\n5. Install-Voice.ps1:');
  const iv = read('scripts/deploy/Install-Voice.ps1');
  yes('binds loopback unless told otherwise', /\[string\]\$Bind\s+= '127\.0\.0\.1',/.test(iv));
  yes('opens the firewall only for every interface, and takes the rule away on loopback, in the box\'s policy store (#3896)',
      /`\$fwHas = \[bool\]\(Get-NetFirewallRule -PolicyStore localhost -DisplayName '\$TaskName'[^\n]*\)\s*if \('\$Bind' -eq '127\.0\.0\.1'\) \{\s*if \(`\$fwHas\) \{ Remove-NetFirewallRule -PolicyStore localhost -DisplayName '\$TaskName'; Sync-ThornswoodFirewall \}/.test(iv) &&
      /\} elseif \(-not `\$fwHas\) \{\s*New-NetFirewallRule -PolicyStore localhost /.test(iv));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
  for (const s of started) { s.kill(); }
  setTimeout(() => {}, 150);
})().catch((e) => { console.log('FAIL  the harness itself: ' + (e && e.stack || e)); for (const s of started) { s.kill(); } process.exitCode = 1; });
