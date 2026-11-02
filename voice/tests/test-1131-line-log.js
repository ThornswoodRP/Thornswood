/*
  test-1131-line-log.js

      node .\voice\tests\test-1131-line-log.js

  Waiting in line writes one line to the chat log, not one every ten seconds
  (#1131).

  WHY THIS EXISTS. The menu's front plugin says "/line" over the chat relay
  every ten seconds while somebody waits for a seat (every two for the first
  twenty), so the gamemode keeps the place and a menu can ask again after the
  relay restarts. The voice service wrote every slash line to the chat log,
  so each person waiting added about six lines a minute that nobody needs,
  and staff reading the log for a report scrolled past them. The service now
  writes the "/line" that starts a wait (the connection's waiting mark, the
  one that tells the game server "/line gone" when it closes, was not set),
  and leaves out the repeats. "/line leave", "/line hand" and every other
  command are written as before, and every "/line" still reaches the game
  server.

  What it proves, on the real voice-server.js over real WebSockets:
    - twenty "/line"s from one waiting connection write one line, and all
      twenty are queued for the game server
    - "/line leave" is written, and the next "/line" starts a new wait and is
      written again
    - another person's first "/line" is written; a game moved out for being
      idle waits from its "/afk out", which is written, so its "/line"s are not
    - "/line hand" is written
    - a new connection after a close starts a new wait, and the relay's own
      "/line gone" reaches the game server and never the chat log
    - a key or panel line keeps via: press; a typed /joinpass is still
      masked and the plugin's own is not written (#2723); any other command
      is written exactly as typed

  Spawns the service in a temp folder on a spare port with its own chat
  folder, as voice\tests\test-line-close.js does. Read only apart from that folder.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const os = require('os');

const REPO_DIR = path.join(__dirname, '..', '..');
let PORT = 0;
const BOUND_MS = 15000;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-1131-'));
const CHAT_DIR = path.join(dir, 'chat');
fs.copyFileSync(path.join(REPO_DIR, 'voice', 'voice-server.js'), path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(REPO_DIR, 'voice', 'headlines.js'), path.join(dir, 'headlines.js'));

/* The site, as far as the service asks it anything: every ticket owns its profile. */
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
    site.listen(0, '127.0.0.1', () => { site.unref(); ok('http://127.0.0.1:' + site.address().port); });
  });
}

/* A join token minted by the service itself, as the launcher gets one. */
function joinToken(pid) {
  return new Promise((ok, bad) => {
    const body = JSON.stringify({ profileId: pid, ticket: 'a ticket the stand-in site takes' });
    const req = http.request({ host: '127.0.0.1', port: PORT, path: '/token', method: 'POST', agent: false,
                               headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let b = '';
      res.on('data', (d) => { b += d; });
      res.on('end', () => {
        let doc = null;
        try { doc = JSON.parse(b); } catch (e) { doc = null; }
        if (res.statusCode === 200 && doc && typeof doc.token === 'string') { ok(doc.token); return; }
        bad(new Error('the service minted no token for profile ' + pid + ': ' + res.statusCode + ' ' + b.slice(0, 200)));
      });
    });
    req.on('error', bad);
    req.end(body);
  });
}

function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}

let srv = null;
let log = '';
/* Waits for srv's own "listening on ...:port" line, the same wait as
   voice\tests\test-line-close.js; tests\test-1703-test-ports.js lifts it and holds
   it to saying when something else took the port. */
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

async function start() {
  const SITE = await siteThatSaysYes();
  PORT = await freePort('0.0.0.0');
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_SITE: SITE,
      THORNSWOOD_CHAT_DIR: CHAT_DIR,
    }),
  });
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, PORT);
}

function done(code) {
  process.exitCode = code;
  if (srv) srv.kill();
  setTimeout(() => { fs.rmSync(dir, { recursive: true, force: true }); }, 300).unref();
}

async function person(profileId, name) {
  const token = await joinToken(profileId);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', token]);
    const me = { ws: ws, name: name, pongs: [], closed: null };
    me.closed = new Promise((ok) => { ws.addEventListener('close', ok); });
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { resolve(me); }
      if (m.t === 'pong') { const p = me.pongs.shift(); if (p) { p(); } }
    };
    ws.onerror = () => reject(new Error('socket error joining as ' + name));
    setTimeout(() => reject(new Error('no welcome for ' + name + ' in four seconds')), 4000);
  });
}
/* As the front plugin says it: auto, so press: true (#2251). */
const said = (p, text) => p.ws.send(JSON.stringify({ t: 'chat', text: text, press: true }));
/* As somebody typing it. */
const typed = (p, text) => p.ws.send(JSON.stringify({ t: 'chat', text: text }));

/* Answered once the service has handled everything this socket sent before it (#519). */
function settle(p) {
  return new Promise((ok, bad) => {
    const late = setTimeout(() => bad(new Error('no pong to a ping from ' + p.name + ' within ' + BOUND_MS / 1000 + ' s')), BOUND_MS);
    p.pongs.push(() => { clearTimeout(late); ok(); });
    p.ws.send(JSON.stringify({ t: 'ping' }));
  });
}
function shut(p) {
  return new Promise((ok, bad) => {
    const late = setTimeout(() => bad(new Error('the socket of ' + p.name + ' was not closed within ' + BOUND_MS / 1000 + ' s')), BOUND_MS);
    p.closed.then(() => { clearTimeout(late); ok(); });
    p.ws.close();
  });
}
/* Takes what is queued for the game server, as the gamemode does without ack. */
async function commands() {
  return (await (await fetch('http://127.0.0.1:' + PORT + '/commands')).json()).commands;
}
/* Every line in the chat log so far, from every day's file. */
function chatLog() {
  if (!fs.existsSync(CHAT_DIR)) return [];
  const out = [];
  for (const f of fs.readdirSync(CHAT_DIR).filter((n) => /\.jsonl$/.test(n)).sort()) {
    for (const l of fs.readFileSync(path.join(CHAT_DIR, f), 'utf8').split('\n')) {
      if (l.trim()) out.push(JSON.parse(l));
    }
  }
  return out;
}
const linesOf = (pid, text) => chatLog().filter((e) => e.profileId === pid && e.text === text);
const queuedOf = (q, pid, text) => q.filter((c) => c.profileId === pid && c.text === text).length;

(async () => {
  await start();
  const h = await (await fetch('http://127.0.0.1:' + PORT + '/health')).json();
  yes('the build says it has the line log (' + h.build.split('-').slice(-3).join('-') + ')', /line-log-1/.test(h.build));

  // ---- one person waiting ----------------------------------------------------
  let a = await person(601, 'Waiter');
  for (let i = 0; i < 20; i++) said(a, '/line');
  await settle(a);
  let q = await commands();
  yes('twenty "/line"s from one waiting connection: all twenty are queued for the game server', queuedOf(q, 601, '/line') === 20);
  let got = linesOf(601, '/line');
  yes('and the chat log has one line for them, not twenty (it has ' + got.length + ')', got.length === 1);
  yes('that line is a command, marked as the menu\'s press and not typed', got.length === 1 && got[0].kind === 'command' && got[0].via === 'press');

  said(a, '/line leave');
  await settle(a);
  q = await commands();
  yes('"/line leave" is queued', queuedOf(q, 601, '/line leave') === 1);
  yes('and written to the chat log once', linesOf(601, '/line leave').length === 1);

  for (let i = 0; i < 3; i++) said(a, '/line');
  await settle(a);
  q = await commands();
  yes('after leaving, the next "/line"s are queued (all three)', queuedOf(q, 601, '/line') === 3);
  yes('and the one that starts the new wait is written: two "/line" lines in all for this person', linesOf(601, '/line').length === 2);

  // ---- somebody else, and a game moved out for being idle ----------------------
  const b = await person(602, 'Second');
  for (let i = 0; i < 5; i++) said(b, '/line');
  await settle(b);
  q = await commands();
  yes('another person\'s five "/line"s are all queued', queuedOf(q, 602, '/line') === 5);
  yes('and their own first one is written, once', linesOf(602, '/line').length === 1);

  const c = await person(603, 'Idle');
  said(c, '/afk out');
  for (let i = 0; i < 3; i++) said(c, '/line');
  await settle(c);
  q = await commands();
  yes('a game moved out for being idle: "/afk out" and three "/line"s are all queued',
      queuedOf(q, 603, '/afk out') === 1 && queuedOf(q, 603, '/line') === 3);
  yes('its "/afk out" is written, which is where its wait starts', linesOf(603, '/afk out').length === 1);
  yes('so its "/line"s are not written', linesOf(603, '/line').length === 0);

  const d = await person(604, 'Hander');
  said(d, '/line');
  said(d, '/line hand 777');
  await settle(d);
  q = await commands();
  yes('"/line hand" is queued and written', queuedOf(q, 604, '/line hand 777') === 1 && linesOf(604, '/line hand 777').length === 1);

  // ---- a new connection --------------------------------------------------------
  await shut(a);
  a = await person(601, 'Waiter');
  for (let i = 0; i < 4; i++) said(a, '/line');
  await settle(a);
  q = await commands();
  yes('the relay\'s own "/line gone" for the closed connection reached the game server', queuedOf(q, 601, '/line gone') === 1);
  yes('and is not in the chat log', chatLog().filter((e) => /^\/line gone/.test(e.text)).length === 0);
  yes('a new connection\'s first "/line" starts a new wait and is written: three in all for this person', linesOf(601, '/line').length === 3);
  yes('and its four "/line"s are all queued', queuedOf(q, 601, '/line') === 4);

  // ---- every other command, as before ------------------------------------------
  const e = await person(605, 'Typist');
  said(e, '/joinpass jp1.aaaa.bbbb');
  typed(e, '/joinpass jp1.aaaa.bbbb');
  typed(e, '/tp riverwood');
  typed(e, '/tp riverwood');
  await settle(e);
  q = await commands();
  yes('both /joinpass lines are queued with the pass for the game server', queuedOf(q, 605, '/joinpass jp1.aaaa.bbbb') === 2);
  // The plugin's own pass is one of its reports and is not written at all
  // (#2723, voice\tests\test-2723-plugin-reports.js); a typed one is, masked.
  yes('and the typed one is written masked, as "/joinpass [pass]", the plugin\'s not at all',
      linesOf(605, '/joinpass [pass]').length === 1 && !('via' in linesOf(605, '/joinpass [pass]')[0]));
  yes('the pass itself is nowhere in the chat log', !fs.readdirSync(CHAT_DIR).some((f) =>
      fs.readFileSync(path.join(CHAT_DIR, f), 'utf8').indexOf('jp1.aaaa') >= 0));
  got = linesOf(605, '/tp riverwood');
  yes('a typed command is written every time, as typed, with no via', got.length === 2 && got.every((x) => !('via' in x)));

  const all = chatLog().filter((x) => x.text === '/line').length;
  yes('in all, 36 "/line"s from five connections wrote ' + all + ' lines: one for each wait that started', all === 5);

  for (const p of [a, b, c, d, e]) await shut(p);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  done(fail ? 1 : 0);
})().catch((err) => {
  console.error('FAILED: ' + err.message);
  console.error(log);
  console.log('');
  console.log(pass + ' passed, ' + (fail + 1) + ' failed');
  done(1);
});
