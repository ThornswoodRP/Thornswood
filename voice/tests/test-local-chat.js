'use strict';
/*
  test-local-chat.js

  Entry 150 on the To Do List: "Two people robbing a traveller on the Whiterun
  road are currently read by a smith in Markarth." Every plain line went to
  every socket on the server, /ooc was the only local line, and there was no
  /me.

  The fix is behind THORNSWOOD_CHAT_RANGE. Left unset it is off, which is
  how the live voice service is left. The dev voice service is installed
  with it on. This proves both halves against the real service:

    OFF. A plain line still reaches every socket in the box. The line
    above the head is local either way. /me, /s, /w and /ooc are local
    speech, not commands for the game server.

    ON. The entry's own test: three sockets, positions posted to /positions
    with two close together in one cell and one far off, one plain line from
    the first, and exactly two sockets receive it. Then the rest of what the
    setting promises: a shout carries further, a whisper less, a different
    cell at arm's length hears nothing, /me and /do arrive as actions, /ooc
    is local too, /roll still goes to the game server, somebody with no position reaches
    nobody and is told why, and a stopped position feed falls back to
    everybody rather than silencing the server.

  It also draws each kind through the chat page's own partsFor, and checks
  that a line with no kind is drawn exactly as the page always drew it.

  Runs voice-server.js from a scratch folder on a free loopback port, with its
  chat log in that folder. Never connects to anything else.

  VOICE_SERVER and CHAT_PAGE point it at other copies of the two files, which
  is how it was run against the code before the change to see it fail.
*/
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');

const SERVER = process.env.VOICE_SERVER || path.join(__dirname, '..', 'voice-server.js');
const PAGE = process.env.CHAT_PAGE || path.join(__dirname, '..', '..', 'game', 'ui', 'thornswood-chat.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* A port nobody is on right now, from the machine. Builds run side by side on
   the VPS, so a fixed number can be another run's (#1703). Nothing is asked
   of it until this run's service has said it is listening there. */
function freePort() {
  return new Promise((done) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => done(p));
    });
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

async function service(range) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localchat-'));
  fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(path.join(__dirname, '..', 'headlines.js'), path.join(dir, 'headlines.js'));
  // Every connection proves itself since #1303 with a join token the service
  // mints (joinToken); one token opens one connection, offered with the
  // handshake (#1337, #1322).
  const env = Object.assign({}, process.env, {
    THORNSWOOD_VOICE_PORT: String(port),
    THORNSWOOD_VOICE_BIND: '127.0.0.1',
    THORNSWOOD_SITE: SITE,
    THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
  });
  delete env.THORNSWOOD_CHAT_RANGE;
  if (range != null) { env.THORNSWOOD_CHAT_RANGE = range; }

  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir, env: env });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });

  const base = 'http://127.0.0.1:' + port;
  await listening(srv, port);
  const r = await fetch(base + '/health');
  if (!r.ok) {
    srv.kill();
    throw new Error('the service answered /health with ' + r.status + '. log:\n' + log);
  }
  const health = await r.json();

  const socks = [];
  return {
    port: port, dir: dir, base: base, health: health, socks: socks,
    log: () => log,
    stop: async () => {
      for (const c of socks) { try { c.ws.close(); } catch (e) { } }
      srv.kill();
      await sleep(250);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    }
  };
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

/* One person, joined. Keeps every chat line it is sent. */
async function join(svc, profileId, name) {
  const token = await joinToken(svc.port, profileId);
  return new Promise((done, failed) => {
    const ws = new WebSocket('ws://127.0.0.1:' + svc.port + '/', ['thornswood', token]);
    const c = { ws: ws, profileId: profileId, name: name, got: [] };
    let ok = false;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { ok = true; svc.socks.push(c); done(c); }
      if (m.t === 'chat') { c.got.push(m); }
    };
    ws.onerror = () => { if (!ok) { failed(new Error('socket error joining ' + name)); } };
    setTimeout(() => { if (!ok) { failed(new Error('no welcome for ' + name)); } }, 4000);
  });
}

/* Where everybody stands, as the gamemode would post it. */
async function place(svc, rows) {
  const r = await fetch(svc.base + '/positions', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ who: rows })
  });
  return r.status;
}

async function queued(svc) {
  const r = await fetch(svc.base + '/commands');
  const doc = await r.json();
  return doc.commands || [];
}

/* Send one line from c and return who got a line.

   With expect, the names that should hear it, it first waits until each of
   them has something, for up to three seconds, and then the same 350 ms as
   before for anybody who should not. A flat 350 ms for every line missed the
   whisper on the Windows runner on #337, on 24 and again 25 September: Dagny
   and Eorlund had joined 25 ms before it, and the next line reached Dagny
   the usual way. Nothing in the service holds a line back, so it was late,
   not lost. A line nobody else should hear has nothing to wait for and keeps
   the flat wait. */
async function say(svc, c, text, expect) {
  for (const s of svc.socks) { s.got.length = 0; }
  c.ws.send(JSON.stringify({ t: 'chat', text: text }));
  if (expect) {
    const want = svc.socks.filter((s) => expect.indexOf(s.name) >= 0);
    const until = Date.now() + 3000;
    while (Date.now() < until && !want.every((s) => s.got.length > 0)) { await sleep(20); }
  }
  await sleep(350);
  return svc.socks.filter((s) => s.got.length > 0).map((s) => s.name).sort();
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/* Whether a line reached exactly these, and who it did reach when not, so a
   red run says what happened rather than only that it did. */
function heardBy(heard, want) {
  const ok = same(heard, want);
  if (!ok) { console.log('      heard by ' + (heard.join(', ') || 'nobody') + ', not ' + want.join(', ')); }
  return ok;
}
const lineOf = (c) => c.got.filter((m) => m.from !== 0)[0] || null;
const noteOf = (c) => c.got.filter((m) => m.from === 0)[0] || null;

/* The road, near Whiterun. Aela and Brand are robbing somebody; Cass is
   eighty metres up the road; Dagny is at Aela's elbow; Eorlund is a hundred
   units away through a wall, inside the inn, which is its own cell. */
const ROAD = 'Tamriel';
const INN = 'WhiterunBanneredMare';
function rows(include) {
  const all = {
    Aela:    { profileId: 101, pos: [0, 0, 0], cell: ROAD },
    Brand:   { profileId: 102, pos: [1500, 0, 0], cell: ROAD },
    Cass:    { profileId: 103, pos: [8000, 0, 0], cell: ROAD },
    Dagny:   { profileId: 104, pos: [400, 0, 0], cell: ROAD },
    Eorlund: { profileId: 105, pos: [100, 0, 0], cell: INN }
  };
  return include.map((n) => Object.assign({ name: n, angleZ: 0 }, all[n]));
}

// ------------------------------------------------------------------ off ----
async function off() {
  console.log('');
  console.log('THORNSWOOD_CHAT_RANGE unset, which is how live is left:');
  const svc = await service(null);
  try {
    yes('OFF health says the range is off', svc.health.chatRange === 0);
    const a = await join(svc, 101, 'Aela');
    await join(svc, 102, 'Brand');
    await join(svc, 103, 'Cass');
    yes('OFF positions are taken', await place(svc, rows(['Aela', 'Brand', 'Cass'])) === 204);

    const heard = await say(svc, a, 'Hand over the purse.', ['Aela', 'Brand', 'Cass']);
    yes('OFF a plain line reaches every socket, near or far, as it always has',
        heardBy(heard, ['Aela', 'Brand', 'Cass']));
    const far = lineOf(svc.socks[2]);
    const near = lineOf(svc.socks[1]);
    yes('OFF and somebody out of reach gets the box with no line above the head',
        !!far && far.kind === 'say' && !far.head && far.text === 'Hand over the purse.');
    yes('OFF and somebody close enough gets the words above the head',
        !!near && near.head === 'Hand over the purse.');
    yes('OFF and nobody is sent a note about who heard it',
        svc.socks.every((s) => !noteOf(s)));

    await place(svc, rows(['Aela', 'Brand', 'Cass']));
    await queued(svc);
    let local = await say(svc, a, '/me draws a knife', ['Aela', 'Brand']);
    yes('OFF /me reaches the people within a plain line, not the one up the road',
        heardBy(local, ['Aela', 'Brand']));
    const mm = lineOf(svc.socks[1]);
    yes('OFF and it arrives as an action, with the same words above the head',
        !!mm && mm.kind === 'me' && mm.text === 'draws a knife' && mm.head === 'draws a knife');
    yes('OFF and /me is not queued for the game server', (await queued(svc)).length === 0);

    await place(svc, rows(['Aela', 'Brand', 'Cass']));
    local = await say(svc, a, '/s Guards!', ['Aela', 'Brand', 'Cass']);
    yes('OFF a shout still reaches the one up the road', heardBy(local, ['Aela', 'Brand', 'Cass']));
    const sm = lineOf(svc.socks[2]);
    yes('OFF and the shout is the words above the head',
        !!sm && sm.kind === 'shout' && sm.text === 'Guards!' && sm.head === 'Guards!');

    await place(svc, rows(['Aela', 'Brand', 'Cass']));
    await queued(svc);
    local = await say(svc, a, '/w run', ['Aela']);
    yes('OFF a whisper reaches only the sender when nobody is that close', heardBy(local, ['Aela']));
    yes('OFF and they are told nobody heard it',
        !!noteOf(a) && /Nobody near enough/.test(noteOf(a).text));
    yes('OFF and /w is not queued', (await queued(svc)).length === 0);

    await place(svc, rows(['Aela', 'Brand', 'Cass']));
    await queued(svc);
    local = await say(svc, a, '/ooc brb', ['Aela', 'Brand']);
    yes('OFF /ooc is local, the same reach as a plain line', heardBy(local, ['Aela', 'Brand']));
    const om = lineOf(svc.socks[1]);
    yes('OFF and the line above the head is in brackets',
        !!om && om.kind === 'ooc' && om.text === 'brb' && om.head === '(( brb ))');
    yes('OFF and /ooc is not queued', (await queued(svc)).length === 0);
  } finally { await svc.stop(); }
}

// ------------------------------------------------------------------- on ----
async function on() {
  console.log('');
  console.log('THORNSWOOD_CHAT_RANGE=on:');
  const svc = await service('on');
  try {
    yes('ON health says 4000, the range /ooc already uses', svc.health.chatRange === 4000);

    // THE ENTRY'S TEST. Three sockets, two close together in one cell and one
    // far off, one plain line from the first.
    const a = await join(svc, 101, 'Aela');
    const b = await join(svc, 102, 'Brand');
    const c = await join(svc, 103, 'Cass');
    yes('ON positions are taken', await place(svc, rows(['Aela', 'Brand', 'Cass'])) === 204);

    let heard = await say(svc, a, 'Hand over the purse.', ['Aela', 'Brand']);
    yes('ON one plain line from the first of three sockets reaches exactly two',
        heard.length === 2);
    yes('ON and they are the sender and the one standing beside them',
        heardBy(heard, ['Aela', 'Brand']));
    yes('ON and the one eighty metres up the road does not see it', c.got.length === 0);
    const m = lineOf(b);
    yes('ON the line is marked as said', !!m && m.kind === 'say' && m.text === 'Hand over the purse.');
    yes('ON and whoever sent it is not told that nobody heard', !noteOf(a));

    // A shout carries three times as far.
    await place(svc, rows(['Aela', 'Brand', 'Cass']));
    heard = await say(svc, a, '/s Guards! Over here!', ['Aela', 'Brand', 'Cass']);
    yes('ON a shout reaches the one up the road too', heardBy(heard, ['Aela', 'Brand', 'Cass']));
    const sm = lineOf(c);
    yes('ON and it arrives as a shout, without the /s',
        !!sm && sm.kind === 'shout' && sm.text === 'Guards! Over here!');

    // /me and /do are actions, local like any other line.
    await place(svc, rows(['Aela', 'Brand', 'Cass']));
    await queued(svc);
    heard = await say(svc, a, '/me draws a knife', ['Aela', 'Brand']);
    yes('ON /me reaches the same two a plain line does', heardBy(heard, ['Aela', 'Brand']));
    const mm = lineOf(b);
    yes('ON and arrives as an action, without the /me',
        !!mm && mm.kind === 'me' && mm.text === 'draws a knife');
    yes('ON and it is not also queued for the game server', (await queued(svc)).length === 0);

    heard = await say(svc, b, '/do The purse is empty.', ['Aela', 'Brand']);
    const dm = lineOf(a);
    yes('ON /do reaches the people near the one who sent it',
        heardBy(heard, ['Aela', 'Brand']) && !!dm && dm.kind === 'do' && dm.text === 'The purse is empty.');

    // Two more: one at Aela's elbow, one a hundred units away in the inn.
    const d = await join(svc, 104, 'Dagny');
    const e = await join(svc, 105, 'Eorlund');
    await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
    heard = await say(svc, a, '/w run', ['Aela', 'Dagny']);
    yes('ON a whisper reaches only the one at the elbow', heardBy(heard, ['Aela', 'Dagny']));
    const wm = lineOf(d);
    yes('ON and arrives as a whisper', !!wm && wm.kind === 'whisper' && wm.text === 'run');

    await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
    heard = await say(svc, a, 'Quiet, somebody is coming.', ['Aela', 'Brand', 'Dagny']);
    yes('ON somebody a hundred units away in another cell hears nothing',
        e.got.length === 0 && heardBy(heard, ['Aela', 'Brand', 'Dagny']));

    // Alone.
    await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
    heard = await say(svc, c, 'Hello?', ['Cass']);
    yes('ON a line nobody is near enough for goes back to the sender alone', heardBy(heard, ['Cass']));
    yes('ON and they are told nobody heard it',
        !!noteOf(c) && /Nobody near enough/.test(noteOf(c).text));

    // Somebody at the menu, while everybody else is in the world.
    const f = await join(svc, 106, 'Frea');
    await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
    heard = await say(svc, f, 'is anyone there', ['Frea']);
    yes('ON somebody with no position reaches nobody else, not the whole server',
        heardBy(heard, ['Frea']));
    yes('ON and is told their character is not in the world yet',
        !!noteOf(f) && /not in the world/.test(noteOf(f).text));

    // A verb with nothing after it.
    await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
    heard = await say(svc, a, '/me', ['Aela']);
    yes('ON /me on its own goes to nobody else', heardBy(heard, ['Aela']));
    yes('ON and says how it is used', !!noteOf(a) && /\/me draws a sword/.test(noteOf(a).text));
    yes('ON and is not queued either', (await queued(svc)).length === 0);

    // /ooc is speech now. /roll and a word that only starts like a verb
    // are still commands.
    await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
    await queued(svc);
    heard = await say(svc, a, '/ooc brb', ['Aela', 'Brand', 'Dagny']);
    yes('ON /ooc reaches the same people a plain line does', heardBy(heard, ['Aela', 'Brand', 'Dagny']));
    const oom = lineOf(b);
    yes('ON and it is in brackets above the head',
        !!oom && oom.kind === 'ooc' && oom.text === 'brb' && oom.head === '(( brb ))');
    yes('ON and /ooc is not queued', (await queued(svc)).length === 0);

    for (const line of ['/roll 20', '/meow', '/spawn cheese']) {
      await place(svc, rows(['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund']));
      await queued(svc);
      const h = await say(svc, a, line);
      const q = await queued(svc);
      yes('ON ' + line + ' is not broadcast', h.length === 0);
      yes('ON and still goes to the game server, as before',
          q.length === 1 && q[0].text === line && q[0].profileId === 101);
    }

    // The log keeps what was typed, verb and all.
    let logged = [];
    try {
      for (const f2 of fs.readdirSync(path.join(svc.dir, 'chat'))) {
        const raw = fs.readFileSync(path.join(svc.dir, 'chat', f2), 'utf8');
        for (const l of raw.split('\n')) { if (l.trim()) { logged.push(JSON.parse(l)); } }
      }
    } catch (err) { logged = []; }
    yes('ON the chat log keeps /me as it was typed, so a moderator reads what was sent',
        logged.some((l) => l.kind === 'say' && l.text === '/me draws a knife' && l.profileId === 101));
    yes('ON and keeps a line that reached nobody', logged.some((l) => l.text === 'is anyone there'));

    // The gamemode's feed stops: the position list comes back empty.
    await place(svc, []);
    heard = await say(svc, a, 'Still there?', ['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund', 'Frea']);
    yes('ON with no positions at all, a line goes to everybody rather than nobody',
        heardBy(heard, ['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund', 'Frea']));
  } finally { await svc.stop(); }
}

// ------------------------------------------------------------ the values ---
async function values() {
  console.log('');
  console.log('what the setting accepts:');
  for (const [v, want] of [['off', 0], ['0', 0], ['loud', 0], ['2500', 2500], [' ON ', 4000]]) {
    const svc = await service(v);
    try {
      yes('THORNSWOOD_CHAT_RANGE=' + JSON.stringify(v) + ' is ' + (want ? want + ' units' : 'off'),
          svc.health.chatRange === want);
    } finally { await svc.stop(); }
  }
}

// -------------------------------------------------------- the chat page ----
function page() {
  console.log('');
  console.log('the chat page draws each kind:');
  const src = fs.readFileSync(PAGE, 'utf8').split(String.fromCharCode(13)).join('');
  const at = src.indexOf('function partsFor(');
  let fn = null;
  if (at >= 0) {
    let depth = 0;
    for (let i = src.indexOf('{', at); i < src.length; i++) {
      if (src[i] === '{') { depth++; }
      else if (src[i] === '}') { depth--; if (!depth) { fn = src.slice(at, i + 1); break; } }
    }
  }
  yes('the page has partsFor', !!fn);
  if (!fn) { return; }

  const colours = (src.match(/^\s*var C_[A-Z]+\s*=\s*'#[0-9a-fA-F]{6}';/gm) || []).join('\n');
  const draw = new Function('ME', colours + '\n' + fn + '\nreturn { partsFor: partsFor, C_NAME: C_NAME, C_TEXT: C_TEXT };')(7);

  // Exactly the runs the handler built before this change, for a line with no
  // kind, which is every line while the setting is off.
  const plain = draw.partsFor({ t: 'chat', name: 'Aela', profileId: 101, text: 'Hand over the purse.' });
  yes('a line with no kind is drawn exactly as it always was',
      same(plain, [{ text: 'Aela: ', color: draw.C_NAME }, { text: 'Hand over the purse.', color: draw.C_TEXT }]));
  const mine = draw.partsFor({ name: 'Me', profileId: 7, text: 'hi' });
  yes('and your own name is still the lighter gold', mine[0].color === '#d8c79a');
  yes('a missing name is still Someone', draw.partsFor({ text: 'x' })[0].text === 'Someone: ');

  const text = (p) => p.map((r) => r.text).join('');
  yes('/me reads as an action',
      text(draw.partsFor({ kind: 'me', name: 'Aela', text: 'draws a knife' })) === '* Aela draws a knife');
  yes('/do reads as what is there, with who said so',
      text(draw.partsFor({ kind: 'do', name: 'Brand', text: 'The purse is empty.' })) === '* The purse is empty. (Brand)');
  yes('a whisper says so',
      text(draw.partsFor({ kind: 'whisper', name: 'Aela', text: 'run' })) === 'Aela whispers: run');
  yes('a shout says so',
      text(draw.partsFor({ kind: 'shout', name: 'Aela', text: 'Guards!' })) === 'Aela shouts: Guards!');
  yes('an /ooc is in brackets',
      text(draw.partsFor({ kind: 'ooc', name: 'Aela', text: 'brb' })) === '(( Aela: brb ))');
  yes('a kind the page has never heard of is drawn as a plain line, not dropped',
      text(draw.partsFor({ kind: 'sing', name: 'Aela', text: 'la' })) === 'Aela: la');
  const action = draw.partsFor({ kind: 'me', name: 'Aela', text: 'x' });
  yes('and an action is not the colour of speech', action[1].color !== draw.C_TEXT);
}

(async () => {
  try {
    SITE = await siteThatSaysYes();
    page();
    await off();
    await on();
    await values();
  } catch (e) {
    fail++;
    console.log('FAIL  the run itself threw: ' + (e && e.stack || e));
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
