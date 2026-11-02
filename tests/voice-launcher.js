'use strict';
// voice-launcher.js
//
// The launcher's voice for the JavaScript harnesses. Since #4823 voice is C#
// in the launcher (launcher\app\VoiceSession.cs and the Voice*.cs beside it),
// not a page, so a harness that ran voice-host.html's script in node's vm runs
// this instead: tests\voice-launcher\VoiceDriver.csproj, which compiles the
// launcher's own voice files with a stand-in for the Windows audio, built here
// with the .NET 10 SDK on any machine and started once per launcher.
//
//   const VL = require('./voice-launcher');
//   const a = await VL.start({ clock: 'manual', wire: 'fake', jitter: 0.5 });
//   await a.send({ do: 'configure', profileId: 7, name: 'Aela', token: 't',
//                  base: 'https://example.invalid/voice' });
//   a.events            every line the driver wrote, in order
//   a.dials()           the sockets the session opened ({ n, url, protocols })
//   a.sent(n)           what it wrote to socket n
//   a.host(kind)        what it told the launcher, by kind (log, status, ...)
//   await a.until(fn, ms, what)   real clock: waits for fn(a) to hold
//   a.listeners.push(fn)          fn(event) as each line comes
//   await a.quit()
//
// With clock 'manual' every send resolves once the session has nothing left
// to do, so what it did is all in events; with 'real' it resolves once the
// call is made, and until() waits for the effect. The build goes to the
// machine's temp folder, one folder per set of sources, so a second harness
// starts at once and nothing is written into the repository.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');
const readline = require('readline');

const REPO = path.join(__dirname, '..');
const PROJ = path.join(__dirname, 'voice-launcher', 'VoiceDriver.csproj');

// What the driver is built from: its own files, the launcher's voice files it
// links, and the launcher's project, whose package versions it takes.
function sources() {
  const own = path.join(__dirname, 'voice-launcher');
  const list = [PROJ, path.join(REPO, 'launcher', 'app', 'Thornswood.csproj')]
    .concat(fs.readdirSync(own).filter((f) => /\.cs$/.test(f)).sort().map((f) => path.join(own, f)));
  const proj = fs.readFileSync(PROJ, 'utf8');
  const re = /<Compile Include="\.\.\/\.\.\/launcher\/app\/([^"]+)"/g;
  let m;
  while ((m = re.exec(proj))) { list.push(path.join(REPO, 'launcher', 'app', m[1])); }
  const res = /<EmbeddedResource Include="\.\.\/\.\.\/launcher\/([^"]+)"/g;
  while ((m = res.exec(proj))) { list.push(path.join(REPO, 'launcher', m[1])); }
  return list;
}

function findDotnet() {
  const tries = [];
  if (process.env.DOTNET) { tries.push(process.env.DOTNET); }
  if (process.env.DOTNET_ROOT) { tries.push(path.join(process.env.DOTNET_ROOT, os.platform() === 'win32' ? 'dotnet.exe' : 'dotnet')); }
  tries.push(path.join(os.homedir(), '.dotnet', os.platform() === 'win32' ? 'dotnet.exe' : 'dotnet'));
  if (os.platform() === 'win32') { tries.push(path.join(process.env.ProgramFiles || 'C:\\Program Files', 'dotnet', 'dotnet.exe')); }
  for (const t of tries) { if (fs.existsSync(t)) { return t; } }
  // On PATH.
  const r = cp.spawnSync(os.platform() === 'win32' ? 'where' : 'which', ['dotnet'], { encoding: 'utf8' });
  const hit = (r.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
  return hit || null;
}

let built = null;
/* Builds the driver once per set of sources; returns { dotnet, dll }. Throws,
   with the build's own words, when there is no SDK or the build fails: the
   launcher needs the same SDK, so a harness never passes without it. */
function build() {
  if (built) { return built; }
  const dotnet = findDotnet();
  if (!dotnet) { throw new Error('no .NET SDK (dotnet) on this machine: the launcher\'s voice is C# and needs it to run here (DOTNET names one)'); }
  const h = crypto.createHash('sha256');
  for (const f of sources()) { h.update(f.slice(REPO.length) + '\0'); h.update(fs.readFileSync(f)); }
  const key = h.digest('hex').slice(0, 16);
  const root = path.join(os.tmpdir(), 'thornswood-voice-driver', key);
  const dll = path.join(root, 'out', 'VoiceDriver.dll');
  if (!fs.existsSync(dll)) {
    // The gate runs several voice harnesses at once, and two builds into one
    // folder trip over each other's restore ("Cannot create a file when that
    // file already exists"). So each builds in a folder of its own and only a
    // finished build is renamed into place; when another harness's finished
    // build got there first, that one is used and this one is dropped.
    fs.mkdirSync(path.dirname(root), { recursive: true });
    const work = root + '.building-' + process.pid + '-' + crypto.randomBytes(4).toString('hex');
    const r = cp.spawnSync(dotnet, ['build', PROJ, '-c', 'Release', '-nologo', '-v', 'q', '--disable-build-servers',
      '-o', path.join(work, 'out'), '-p:VoiceDriverObj=' + path.join(work, 'obj') + path.sep],
    { encoding: 'utf8', env: Object.assign({}, process.env, { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }) });
    if (r.status !== 0 || !fs.existsSync(path.join(work, 'out', 'VoiceDriver.dll'))) {
      fs.rmSync(work, { recursive: true, force: true });
      throw new Error('the voice driver did not build:\n' + (r.stdout || '') + (r.stderr || '') + (r.error ? String(r.error) : ''));
    }
    try { fs.renameSync(work, root); }
    catch (e) { if (!fs.existsSync(dll)) { throw e; } }
    fs.rmSync(work, { recursive: true, force: true });
  }
  built = { dotnet: dotnet, dll: dll, root: root };
  return built;
}

/* One launcher's voice. opts: clock ('real' | 'manual'), wire ('ws' | 'fake'),
   jitter (0 to 1), tone (Hz), name (for messages). */
function start(opts) {
  opts = opts || {};
  const b = build();
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-voice-run-')), 'swallowed.log');
  const args = [b.dll, '--clock', opts.clock || 'real', '--wire', opts.wire || 'ws', '--log', log];
  if (opts.jitter !== undefined) { args.push('--jitter', String(opts.jitter)); }
  if (opts.tone !== undefined) { args.push('--tone', String(opts.tone)); }
  const child = cp.spawn(b.dotnet, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const me = {
    name: opts.name || 'launcher',
    events: [],
    child: child,
    seq: 0,
    waiters: [],
    listeners: [],
    exited: null,
    swallowed: function () { try { return fs.readFileSync(log, 'utf8'); } catch (e) { return ''; } },
    stderr: function () { return err; }
  };
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', (l) => {
    let e;
    try { e = JSON.parse(l); } catch (x) { e = { ev: 'unreadable', line: l }; }
    me.events.push(e);
    for (const f of me.listeners) { f(e); }
    for (const w of me.waiters.slice()) { w(); }
  });
  child.on('exit', (code) => { me.exited = code; for (const w of me.waiters.slice()) { w(); } });

  /* Waits for fn() to hold, checked on every event; real-clock harnesses
     also call it on a timer, since a mixer's level is no event. */
  me.until = function (fn, ms, what) {
    return new Promise((ok, bad) => {
      let tick = null;
      const timer = setTimeout(() => { done(); bad(new Error(me.name + ': no ' + (what || 'answer') + ' within ' + ms + ' ms' + (err ? '\n' + err : ''))); }, ms);
      function check() {
        let v = false;
        try { v = fn(me); } catch (e) { v = false; }
        if (v) { done(); ok(v); } else if (me.exited !== null) { done(); bad(new Error(me.name + ': the driver stopped (' + me.exited + ')\n' + err)); }
      }
      function done() { clearTimeout(timer); if (tick) { clearInterval(tick); } const i = me.waiters.indexOf(check); if (i >= 0) { me.waiters.splice(i, 1); } }
      me.waiters.push(check);
      if (opts.poll !== false) { tick = setInterval(check, 50); }
      check();
    });
  };
  me.send = function (cmd) {
    const seq = ++me.seq;
    const from = me.events.length;
    child.stdin.write(JSON.stringify(Object.assign({ seq: seq }, cmd)) + '\n');
    return me.until(() => me.events.slice(from).some((e) => e.ev === 'done' && e.seq === seq), 60000, 'answer to ' + cmd.do)
      .then(() => me.events.slice(from));
  };
  me.dials = function () { return me.events.filter((e) => e.ev === 'dial'); };
  me.sent = function (n) { return me.events.filter((e) => e.ev === 'sent' && (n === undefined || e.n === n)).map((e) => e.msg); };
  me.closed = function (n) { return me.events.some((e) => e.ev === 'closed' && e.n === n); };
  me.host = function (kind) { return me.events.filter((e) => e.ev === 'host' && (!kind || e.kind === kind)).map((e) => e.text); };
  me.says = function (re) { return me.host('log').some((t) => re.test(t)); };
  me.hear = async function (tones) {
    const ev = await me.send({ do: 'hear', tones: tones });
    const h = ev.filter((e) => e.ev === 'heard')[0];
    return h ? h.levels : {};
  };
  me.quit = async function () {
    if (me.exited !== null) { return; }
    try { await me.send({ do: 'quit' }); } catch (e) { /* it stopped on its own, which exit below sees */ }
    await me.until(() => me.exited !== null, 5000, 'exit').catch(() => child.kill());
  };
  return me.until(() => me.events.some((e) => e.ev === 'ready'), 60000, 'start').then(() => me);
}

// ------------------------------------------------------------ the service
/*
  The real voice service for a launcher to join: voice\voice-server.js copied
  into a temp folder and started on a port of this run's own (#1703), with a
  stand-in for the site that says every ticket owns its profile, so the
  service mints each join token itself, on its own clock (#1867, #1963).
  Nothing is asked of the port until the service has said it listens there.

    const svc = await VL.service({ env: { THORNSWOOD_TURN_URL: ... } });
    svc.base            the https address a launcher is configured with; the
                        driver dials its wss as ws on loopback, which the
                        service takes as this machine, as from Caddy
    await svc.token(pid)
    await svc.feed([{ profileId, pos, angleZ, cell, name }])
    svc.log()           what it printed
    await svc.stop()
*/
function freePort() {
  return new Promise((ok, bad) => {
    const s = require('net').createServer();
    s.on('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

function siteThatSaysYes() {
  return new Promise((ok) => {
    const site = require('http').createServer((req, res) => {
      req.resume();
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/api/play/owns') { res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'); }
        else { res.writeHead(404).end(); }
      });
    });
    site.listen(0, '127.0.0.1', () => { site.unref(); ok({ url: 'http://127.0.0.1:' + site.address().port, server: site }); });
  });
}

async function service(opts) {
  opts = opts || {};
  const server = opts.server || process.env.VOICE || path.join(REPO, 'voice', 'voice-server.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-voice-svc-'));
  fs.copyFileSync(server, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(REPO, 'voice', 'headlines.js'), path.join(dir, 'headlines.js'));
  const site = await siteThatSaysYes();
  const port = await freePort();
  let out = '';
  const srv = cp.spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(port),
      THORNSWOOD_VOICE_BIND: '127.0.0.1',
      THORNSWOOD_SITE: site.url,
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
    }, opts.env || {})
  });
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  await new Promise((ok, bad) => {
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    const look = () => { const m = /\[voice\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    function end(err) { clearTimeout(late); srv.stdout.removeListener('data', look); srv.removeListener('exit', gone); if (err) { bad(err); } else { ok(); } }
    srv.stdout.on('data', look);
    srv.on('exit', gone);
    look();
  });
  const http = require('http');
  function post(where, body) {
    return new Promise((ok, bad) => {
      const text = JSON.stringify(body);
      const req = http.request({ host: '127.0.0.1', port: port, path: where, method: 'POST', agent: false,
                                 headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) } }, (res) => {
        let b = '';
        res.on('data', (d) => { b += d; });
        res.on('end', () => ok({ status: res.statusCode, body: b }));
      });
      req.on('error', bad);
      req.end(text);
    });
  }
  return {
    port: port,
    dir: dir,
    base: 'https://127.0.0.1:' + port,
    log: function () { return out; },
    post: post,
    token: async function (pid) {
      const r = await post('/token', { profileId: pid, ticket: 'a ticket the stand-in site takes' });
      let doc = null;
      try { doc = JSON.parse(r.body); } catch (e) { doc = null; }
      if (r.status !== 200 || !doc || typeof doc.token !== 'string') { throw new Error('the service minted no token for profile ' + pid + ': ' + r.status + ' ' + r.body.slice(0, 200)); }
      return doc.token;
    },
    feed: async function (who) {
      const r = await post('/positions', { who: who });
      if (r.status !== 204) { throw new Error('the service did not take the positions: ' + r.status + ' ' + r.body.slice(0, 200)); }
    },
    stop: function () {
      return new Promise((ok) => {
        site.server.close();
        const rm = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* a file the service still held; the temp folder keeps it */ } ok(); };
        if (srv.exitCode !== null) { rm(); return; }
        srv.once('exit', rm);
        srv.kill();
      });
    }
  };
}

/*
  A launcher in the service's room, as Voice.cs runs one: configured with the
  service's address and a join token for its profile, and every later ask for
  a token answered with a fresh one from the service, as Voice.cs fetches it.
*/
async function join(svc, opts) {
  const l = await start({ clock: 'real', wire: 'ws', tone: opts.tone, name: opts.name });
  let seen = 0;
  l.child.stdout.on('data', () => {
    const asks = l.events.filter((e) => e.ev === 'host' && e.kind === 'token' && e.text === 'need').length;
    for (; seen < asks; seen++) {
      svc.token(opts.profileId).then((t) => l.send({ do: 'token', token: t }), (e) => l.send({ do: 'token', token: '', why: String(e.message) }));
    }
  });
  await l.send({ do: 'configure', profileId: opts.profileId, name: opts.name || '', token: await svc.token(opts.profileId), base: svc.base });
  return l;
}

/*
  A room this file answers in the service's place, for what the real service
  never sends but a session must still get right (a position table without
  your own row, a message from somebody who left): launchers on fake sockets
  with the real clock and real connections between them. Each socket is
  admitted and welcomed as that launcher's peer id (1, 2, ... in the order
  given), every token ask is answered, and each sdp and ice message is passed
  to the launcher it names, from its sender, as the service passes it. The
  roster, the positions and anything else are the harness's to say.

    const r = await VL.room([{ profileId: 1, name: 'Me', tone: 440 }, ...]);
    await r.say(0, { t: 'peers', peers: r.rows() });   // to the first
    await r.all({ t: 'pos', who: ... });                // to every one
    r.at(0)             that launcher
    await r.quit()
*/
async function room(list) {
  const members = [];
  for (let i = 0; i < list.length; i++) {
    const l = await start({ clock: 'real', wire: 'fake', tone: list[i].tone, name: list[i].name });
    members.push({ l: l, peer: i + 1, n: 0, opts: list[i] });
  }
  function sayTo(m, msg) { return m.n ? m.l.send({ do: 'say', n: m.n, msg: msg }) : Promise.resolve(); }
  // Set as quit begins. Until then a command to a driver is answered before
  // anything written after it, so one sent here always settles; after it, a
  // candidate passed on to a launcher that has already quit would wait on a
  // driver that is gone, and nothing would be there to hear it fail.
  let closing = false;
  for (const m of members) {
    m.l.listeners.push((e) => {
      if (closing) { return; }
      if (e.ev === 'dial') {
        m.n = e.n;
        m.welcomed = m.l.send({ do: 'admit', n: e.n }).then(() => m.l.send({ do: 'say', n: e.n, msg: { t: 'welcome', peer: m.peer, profileId: m.opts.profileId } }));
      } else if (e.ev === 'host' && e.kind === 'token' && e.text === 'need') {
        m.l.send({ do: 'token', token: 'room-' + m.peer });
      } else if (e.ev === 'sent' && e.msg && (e.msg.t === 'sdp' || e.msg.t === 'ice')) {
        const to = members.filter((x) => x.peer === e.msg.to)[0];
        if (!to) { return; }
        const fwd = { t: e.msg.t, from: m.peer };
        if (e.msg.t === 'sdp') { fwd.sdp = e.msg.sdp; } else { fwd.candidate = e.msg.candidate; }
        sayTo(to, fwd);
      }
    });
    await m.l.send({ do: 'configure', profileId: m.opts.profileId, name: m.opts.name || '', token: 'room-' + m.peer, base: 'https://room.invalid/voice' });
  }
  await Promise.all(members.map((m) => m.l.until(() => m.l.sent(m.n).some((x) => x.t === 'join'), 15000, 'join')));
  // The service writes the welcome before anything else on a socket, so
  // nothing the harness says goes to one before its welcome has: a roster
  // ahead of it would find the session with no peer id of its own.
  await Promise.all(members.map((m) => m.welcomed));
  return {
    at: function (i) { return members[i].l; },
    peer: function (i) { return members[i].peer; },
    rows: function () { return members.map((m) => ({ peer: m.peer, profileId: m.opts.profileId, name: m.opts.name || '', mode: m.opts.mode || 'local' })); },
    say: function (i, msg) { return sayTo(members[i], msg); },
    all: function (msg) { return Promise.all(members.map((m) => sayTo(m, msg))); },
    quit: async function () { closing = true; for (const m of members) { await m.l.quit(); } }
  };
}

module.exports = { build: build, start: start, findDotnet: findDotnet, service: service, join: join, room: room };
