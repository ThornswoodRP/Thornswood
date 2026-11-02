/*
  test-2723-plugin-reports.js

      node .\voice\tests\test-2723-plugin-reports.js

  The front plugin's own reports stay out of the chat log (#2723).

  WHY THIS EXISTS. The dev chat log for 17 Oct had 444 lines, every one a
  command line, and most of them were the front plugin telling the game
  server what only the client can see: /place 130, /joinpass 102,
  /loadorder and /loadorderlight 42 each, /afk 33, /pick 33, /party 24.
  Nobody typed or pressed any of them. The chat log is for what somebody
  said, typed or pressed, so staff reading it for a report read the client
  instead. The voice service now leaves a line out when it comes with press
  (the chat page's mark on the plugin's own lines and a key's) and its whole
  text is one of the report shapes in voice-server.js PLUGIN_REPORTS. Every
  line is still queued for the game server.

  A. Every line the front plugin sends with press (each tellServer call, and
     each thornswoodNet.say it puts in the page, every one a press since
     #2732) is in the table
     below as a report, as a line the log keeps, or as the wait in line
     (#1131), with the lines it builds. A send site added to the plugin and
     not here fails, and so does a row here the plugin no longer has, so the
     voice service's list cannot drift from the plugin unnoticed.
  B. On the real voice-server.js over real WebSockets, with its own chat
     folder: every report is queued and none is written; every kept line is
     queued and written once, as a key press; the same report shapes typed
     into the chat box (no press) are written as typed, the pass masked; and
     press on a line that is not a report shape (a forged frame) is written.

  Spawns the service in a temp folder on a spare port with its own chat
  folder, as voice\tests\test-1131-line-log.js does. Read only apart from that
  folder.
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

/* ------------------------------------------------------------------ table ---
   Each send site in thornswood-front.js, by the source of what it sends
   (whitespace folded), with how many times that source appears, what the
   chat log does with it, and lines it builds, taken from the code beside it.

   report  the plugin's own report: queued, never written
   kept    a key, E, a panel's pick or a button: queued and written as a key press
   line    the wait in line, which #1131 decides (voice\tests\test-1131-line-log.js)
   none    sends nothing (the flush), or is tellServer itself */
const SITES = {
  // tellServer(...)
  "'/afk here'": { n: 1, kind: 'kept', lines: ['/afk here'] },
  "'/afk out'": { n: 1, kind: 'line', lines: ['/afk out'] },
  "'/afk active'": { n: 1, kind: 'report', lines: ['/afk active'] },
  "bed ? '/rest bed' : '/rest sit'": { n: 1, kind: 'report', lines: ['/rest bed', '/rest sit'] },
  "'/rest up'": { n: 1, kind: 'report', lines: ['/rest up'] },
  "'/chopped'": { n: 1, kind: 'report', lines: ['/chopped'] },
  "'/tspicks ' + n": { n: 1, kind: 'report', lines: ['/tspicks 1', '/tspicks 20'] },
  "'/tspicked ' + id.toString(16)": { n: 1, kind: 'report', lines: ['/tspicked 1a2b3'] },
  "'/racemenu'": { n: 1, kind: 'report', lines: ['/racemenu'] },
  "'/racedown'": { n: 1, kind: 'report', lines: ['/racedown'] },
  "'/face done'": { n: 1, kind: 'report', lines: ['/face done'] },
  // /place: kind, the weather's id or -, night, roof, height to 500, fire to 25 or -
  "line": { n: 1, kind: 'report', lines: ['/place snow 10e1f2 1 0 1500 75', '/place outdoors - 0 0 -500 -',
                                          '/place indoors 81a 0 1 0 0', '/place water 10a241 0 0 -1000 -',
                                          '/place shallow - 1 0 500 25', '/place rain 10a23c 0 0 2000 -'] },
  "'/burn 1'": { n: 1, kind: 'report', lines: ['/burn 1'] },
  "'/burn 0'": { n: 1, kind: 'report', lines: ['/burn 0'] },
  "'/moldhere ' + hex": { n: 1, kind: 'kept', lines: ['/moldhere ff00a1b2'] },
  "'/plot ' + hex": { n: 1, kind: 'kept', lines: ['/plot ff00c3d4'] },
  // the lock key and the mold key at a forge
  "'/' + sig": { n: 2, kind: 'kept', lines: ['/lock ff001234', '/unlock ff001234', '/claim ff001234', '/key ff001234 master'] },
  "'/repair'": { n: 1, kind: 'kept', lines: ['/repair'] },
  "'/treat'": { n: 1, kind: 'kept', lines: ['/treat'] },
  // the preserving panel, from the friend key in the inventory (#3163)
  "'/preserve'": { n: 1, kind: 'kept', lines: ['/preserve'] },
  // furniture in a held building (#2679): the line asked for, the panel, a piece's keys
  "'/furniture look'": { n: 1, kind: 'report', lines: ['/furniture look'] },
  "'/furniture'": { n: 1, kind: 'kept', lines: ['/furniture'] },
  "'/furniture ' + line": { n: 1, kind: 'kept', lines: ['/furniture down', '/furniture turn', '/furniture move ff00a1b2', '/furniture pick ff00a1b2'] },
  // the mod settings menu's values that changed
  "lines[i]": { n: 1, kind: 'report', lines: ['/modset chfshVAMenuHotkey=50', '/modset ATLAS_USKPDetected=1 DelayDragonMin=-2.5'] },
  "'/ride e ' + hex": { n: 1, kind: 'kept', lines: ['/ride e ff00beef'] },
  "'/merchant e ' + hex": { n: 1, kind: 'kept', lines: ['/merchant e ff00cafe'] },
  "''": { n: 1, kind: 'none', lines: [] },
  "'/party refresh'": { n: 1, kind: 'report', lines: ['/party refresh'] },
  "what === 'trade:ready' ? '/trade refresh' : '/party refresh'": { n: 1, kind: 'report', lines: ['/trade refresh', '/party refresh'] },
  "'/pick refresh'": { n: 1, kind: 'report', lines: ['/pick refresh'] },
  "'/pick ' + rest": { n: 1, kind: 'kept', lines: ['/pick spell Ice Spike', '/pick perk 12'] },
  "word + ' ' + total + ' ' + from + ' ' + marks.slice(from, from + LOAD_ORDER_CHUNK).join('')":
    { n: 1, kind: 'report', lines: ['/loadorder 3 0 0a1b23c4d5e6f7a', '/loadorder 130 64 ' + 'abc12'.repeat(64),
                                    '/loadorderlight 2 0 9f8e7d6c5b'] },
  "'/joinpass ' + raw": { n: 1, kind: 'report', lines: ['/joinpass jp1.eyJwIjo3MDF9.Zm9vYmFy_-x'] },
  // Send under Report a problem on the help panel (#3155), written like a typed /report
  "'/problem ' + text": { n: 1, kind: 'kept', lines: ['/problem The door to the inn will not open'] },
  // thornswoodNet.say written into the page (a press, quiet or not, since #2732)
  "' + JSON.stringify('/line hand ' + id) + '": { n: 1, kind: 'line', lines: ['/line hand 777'] },
  "' + JSON.stringify('/joinpass ' + pass) + '": { n: 1, kind: 'report', lines: ['/joinpass jp1.eyJwIjo3MDF9.YmFyYmF6'] },
  "\"/line\"": { n: 1, kind: 'line', lines: ['/line'] },
  "\"/line leave\"": { n: 1, kind: 'line', lines: ['/line leave'] },
  "' + JSON.stringify(toServer[0]) + '": { n: 1, kind: 'none', lines: [] },
  // the look keys (lookVerb), on the form id under the crosshair
  "' + JSON.stringify(line) + '": { n: 1, kind: 'kept', lines: ['/party ff00a001', '/trade ff00a001', '/friend ff00a001',
                                                       '/mute ff00a001', '/deliver ff00a001', '/sleephere ff00a001',
                                                       '/treat ff00a001'] }
};

/* ------------------------------------------------------------- A: source --- */
const fold = (s) => s.replace(/\s+/g, ' ').trim();
const FRONT = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8');

function argAt(src, open) {
  // From just after "(", to its matching ")", skipping quoted strings.
  let d = 1, q = '';
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '\\') { i++; } else if (ch === q) { q = ''; } continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { q = ch; continue; }
    if (ch === '(') d++;
    else if (ch === ')') { d--; if (d === 0) return src.slice(open, i); }
  }
  return null;
}
const found = {};
for (let at = FRONT.indexOf('tellServer('); at >= 0; at = FRONT.indexOf('tellServer(', at + 1)) {
  if (FRONT.slice(Math.max(0, at - 9), at) === 'function ') continue;
  const a = argAt(FRONT, at + 'tellServer('.length);
  if (a === null) continue;
  const k = fold(a);
  found[k] = (found[k] || 0) + 1;
}
const SAY = /thornswoodNet\.say\(([^;]*?)(,\{quiet:true\})?\);/g;
for (let m; (m = SAY.exec(FRONT));) {
  const k = fold(m[1]);
  found[k] = (found[k] || 0) + 1;
}
const unknown = Object.keys(found).filter((k) => !SITES[k] || SITES[k].n !== found[k]);
yes('A1 every line the front plugin sends with press is in this table (' + Object.keys(found).length + ' send sites)' +
    (unknown.length ? '; not here, or a different count: ' + unknown.map((k) => k + ' x' + found[k]).join(' | ') : ''),
    unknown.length === 0);
const gone = Object.keys(SITES).filter((k) => !found[k]);
yes('A2 and every row here is still a send site in the plugin' + (gone.length ? '; gone: ' + gone.join(' | ') : ''),
    gone.length === 0);
yes('A3 tellServer still sends through say, so its lines come with press (#2732)',
    /thornswoodNet\.say\(' \+\s*JSON\.stringify\(toServer\[0\]\) \+ ',\{quiet:true\}\);/.test(FRONT));

/* A copy of each row's lines, by what the log does with them. */
const of = (kind) => [].concat(...Object.keys(SITES).filter((k) => SITES[k].kind === kind).map((k) => SITES[k].lines));
const REPORTS = of('report');
const KEPT = of('kept');

/* ------------------------------------------------------------ B: service --- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2723-'));
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
/* As the front plugin says it: through say, so press: true (#2251, #2732). */
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
/* What is queued for the game server, as the gamemode reads it without ack. */
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
  yes('B0 the build says it leaves the plugin\'s reports out (' + h.build.split('-').slice(-3).join('-') + ')', /own-reports-1/.test(h.build));

  // ---- the plugin's reports, as it sends them ---------------------------------
  const a = await person(711, 'Client');
  for (const t of REPORTS) said(a, t);
  await settle(a);
  let q = await commands();
  const notQueued = REPORTS.filter((t) => queuedOf(q, 711, t) < REPORTS.filter((x) => x === t).length);
  yes('B1 all ' + REPORTS.length + ' of the plugin\'s report lines are queued for the game server' +
      (notQueued.length ? '; not: ' + notQueued.join(' | ') : ''), notQueued.length === 0);
  const written = chatLog().filter((e) => e.profileId === 711);
  yes('B2 and none is written to the chat log (' + written.length + ' written' +
      (written.length ? ': ' + written.slice(0, 6).map((e) => e.text.slice(0, 40)).join(' | ') : '') + ')', written.length === 0);
  yes('B3 the pass is nowhere in the chat log', !fs.existsSync(CHAT_DIR) || !fs.readdirSync(CHAT_DIR).some((f) =>
      fs.readFileSync(path.join(CHAT_DIR, f), 'utf8').indexOf('jp1.') >= 0));

  // ---- the lines the plugin sends for a key, E, a pick or a button ------------
  const b = await person(712, 'Presser');
  for (const t of KEPT) said(b, t);
  await settle(b);
  q = await commands();
  yes('B4 all ' + KEPT.length + ' key, E, pick and button lines are queued', KEPT.every((t) => queuedOf(q, 712, t) === 1));
  const missing = KEPT.filter((t) => { const l = linesOf(712, t); return !(l.length === 1 && l[0].kind === 'command' && l[0].via === 'press'); });
  yes('B5 and each is written once, as a command with via: press' + (missing.length ? '; not: ' + missing.join(' | ') : ''),
      missing.length === 0);

  // ---- the same report shapes typed into the chat box -------------------------
  const c = await person(713, 'Typist');
  for (const t of REPORTS) typed(c, t);
  await settle(c);
  q = await commands();
  yes('B6 typed, every report shape is queued too', REPORTS.every((t) => queuedOf(q, 713, t) >= 1));
  const typedOut = REPORTS.map((t) => (/^\/joinpass\b/.test(t) ? '/joinpass [pass]' : t));
  const want = {};
  for (const t of typedOut) want[t] = (want[t] || 0) + 1;
  const wrong = Object.keys(want).filter((t) => { const l = linesOf(713, t); return l.length !== want[t] || l.some((x) => 'via' in x); });
  yes('B7 and each is written as typed, with no via, because somebody typed it' + (wrong.length ? '; not: ' + wrong.join(' | ') : ''),
      wrong.length === 0);
  yes('B8 a typed pass is written masked, never the pass', linesOf(713, '/joinpass [pass]').length === 2 &&
      !fs.readdirSync(CHAT_DIR).some((f) => fs.readFileSync(path.join(CHAT_DIR, f), 'utf8').indexOf('jp1.') >= 0));

  // ---- press on a line that is not a report shape -----------------------------
  const d = await person(714, 'Forger');
  const forged = ['/tp riverwood', '/give gold 100', '/place snow 10e1f2 1 0 1500 75 x', '/afk active now',
                  '/party refresh me', '/modset a=1; /tp x', '/joinpass jp1.abc.def ghi', '/burn 2'];
  for (const t of forged) said(d, t);
  await settle(d);
  const forgedOut = forged.map((t) => (/^\/joinpass\b/.test(t) ? '/joinpass [pass]' : t));
  const hidden = forgedOut.filter((t) => linesOf(714, t).length !== 1);
  yes('B9 press on a line that is not exactly a report shape leaves nothing out: all ' + forged.length + ' written' +
      (hidden.length ? '; not: ' + hidden.join(' | ') : ''), hidden.length === 0);

  // ---- the day, before and after ------------------------------------------------
  const all = REPORTS.length + KEPT.length;
  const wrote = chatLog().filter((e) => e.profileId === 711 || e.profileId === 712).length;
  yes('B10 of ' + all + ' lines the plugin sent with press, ' + wrote + ' are in the chat log: the ' + KEPT.length +
      ' somebody pressed', wrote === KEPT.length);

  for (const p of [a, b, c, d]) await shut(p);

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
