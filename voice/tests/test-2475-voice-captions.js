/*
  test-2475-voice-captions.js

      node voice\tests\test-2475-voice-captions.js

  #2475. Patrick, 12 Oct: what people say on voice shown above their heads,
  "so it's not only just chat but also what players say". The audio goes
  between people's machines and never reaches the voice service, so the words
  are made on the speaker's machine and only the text comes to the service,
  as { t: 'caption', text }. The service decides who sees it. This proves that
  half against the real voice-server.js:

    1. Off unless THORNSWOOD_CAPTIONS is on: every caption is dropped, the
       speaker's own included, and /health says it is off.
    2. Nobody's voice is shown until they say { t: 'captions', share: true },
       and then only while their talk key is down or has been up for less
       than two seconds.
    3. Who sees it is who could hear it: the same cell, within the reach of
       the speaker's voice mode (7, 30 or 85 metres), and never everybody
       when the speaker has no position. The speaker always sees their own.
    4. { see: false } stops a person being sent anybody's; a personal text
       mute stops that speaker's; staff silence stops all of the speaker's.
    5. Three at once, then one a second.
    6. Never written to the chat log.
    7. The choices go when the person's last connection closes.
    8. The words are one line of at most 80 characters, with nothing that
       breaks a line or turns the text round.
    9. Every number is a setting staff can change without a release: the
       tail, the burst, the refill, a reach that is never past the voice
       reach, and whether a text mute hides captions.

  VOICE_SERVER points it at another copy of voice-server.js, which is how it
  was shown to fail on the code before #2475. Writes only to a temp folder,
  on a loopback port the system hands out.
*/
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');

const REPO_DIR = path.join(__dirname, '..', '..');
const SERVER = process.env.VOICE_SERVER || path.join(REPO_DIR, 'voice', 'voice-server.js');
const HEADLINES = path.join(path.dirname(SERVER), 'headlines.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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


async function service(captions, extra) {
  const port = await freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2475-'));
  fs.copyFileSync(SERVER, path.join(dir, 'voice-server.js'));
  fs.copyFileSync(HEADLINES, path.join(dir, 'headlines.js'));
  const env = Object.assign({}, process.env, {
    THORNSWOOD_VOICE_PORT: String(port),
    THORNSWOOD_VOICE_BIND: '127.0.0.1',
    THORNSWOOD_SITE: SITE,
    THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
    THORNSWOOD_CHAT_RANGE: 'on'
  });
  delete env.THORNSWOOD_CAPTIONS;
  for (const k of Object.keys(env)) { if (k.indexOf('THORNSWOOD_CAPTION_') === 0) delete env[k]; }
  if (captions != null) { env.THORNSWOOD_CAPTIONS = captions; }
  Object.assign(env, extra || {});
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: dir, env: env });
  let log = '';
  srv.stdout.on('data', (d) => { log += d; });
  srv.stderr.on('data', (d) => { log += d; });
  await listening(srv, port);
  const base = 'http://127.0.0.1:' + port;
  const socks = [];
  return {
    port: port, dir: dir, base: base, socks: socks,
    log: () => log,
    health: async () => (await fetch(base + '/health')).json(),
    stop: async () => {
      for (const c of socks) { try { c.ws.close(); } catch (e) { } }
      srv.kill();
      await sleep(250);
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    }
  };
}

/* One connection, joined. Keeps every caption it is sent. */
async function join(svc, profileId, name) {
  const token = await joinToken(svc.port, profileId);
  return new Promise((done, failed) => {
    const ws = new WebSocket('ws://127.0.0.1:' + svc.port + '/', ['thornswood', token]);
    const c = { ws: ws, profileId: profileId, name: name, caps: [] };
    let ok = false;
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { ok = true; svc.socks.push(c); done(c); }
      if (m.t === 'caption') { c.caps.push(m); }
    };
    ws.onerror = () => { if (!ok) { failed(new Error('socket error joining ' + name)); } };
    setTimeout(() => { if (!ok) { failed(new Error('no welcome for ' + name)); } }, 4000);
  });
}
const send = (c, m) => c.ws.send(JSON.stringify(m));

async function post(svc, route, doc) {
  const r = await fetch(svc.base + route, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc)
  });
  return r.status;
}

/* The road near Whiterun. A unit is a seventieth of a metre: Dagny is at
   Aela's elbow (6 m), Brand is 21 m off, Cass 71 m up the road, Fenrig 100 m,
   and Eorlund is 1.4 m away through the wall of the inn, its own cell. */
const ROAD = 'Tamriel';
const INN = 'WhiterunBanneredMare';
const ALL = {
  Aela:    { profileId: 101, pos: [0, 0, 0], cell: ROAD, actor: 0xff000101 },
  Brand:   { profileId: 102, pos: [1500, 0, 0], cell: ROAD, actor: 0xff000102 },
  Cass:    { profileId: 103, pos: [5000, 0, 0], cell: ROAD, actor: 0xff000103 },
  Dagny:   { profileId: 104, pos: [400, 0, 0], cell: ROAD, actor: 0xff000104 },
  Eorlund: { profileId: 105, pos: [100, 0, 0], cell: INN, actor: 0xff000105 },
  Fenrig:  { profileId: 106, pos: [7000, 0, 0], cell: ROAD, actor: 0xff000106 }
};
function place(svc, names) {
  return post(svc, '/positions', { who: names.map((n) => Object.assign({ name: n, angleZ: 0 }, ALL[n])) });
}

/* One caption from c; who got one, sorted. Waits for the names expected,
   then a little longer for anybody who should not have it. */
async function caption(svc, c, text, expect) {
  for (const s of svc.socks) { s.caps.length = 0; }
  send(c, { t: 'caption', text: text });
  if (expect && expect.length) {
    const want = svc.socks.filter((s) => expect.indexOf(s.name) >= 0);
    const until = Date.now() + 3000;
    while (Date.now() < until && !want.every((s) => s.caps.length > 0)) { await sleep(20); }
  }
  await sleep(300);
  return Array.from(new Set(svc.socks.filter((s) => s.caps.length > 0).map((s) => s.name))).sort();
}
function seenBy(got, want) {
  const ok = same(got, want);
  if (!ok) { console.log('      seen by ' + (got.join(', ') || 'nobody') + ', not ' + (want.join(', ') || 'nobody')); }
  return ok;
}

// ----------------------------------------------------------- the words ----
function words() {
  console.log('');
  console.log('What a caption says, and how far it goes (headlines.js):');
  delete require.cache[require.resolve(HEADLINES)];
  const h = require(HEADLINES);
  yes('the reach is the speaking mark\'s distance for each mode, in units',
      typeof h.captionReach === 'function' &&
      h.captionReach('whisper') === 7 * 70 && h.captionReach('local') === 30 * 70 &&
      h.captionReach('yell') === 85 * 70 && h.captionReach('nonsense') === 30 * 70);
  const server = fs.readFileSync(SERVER, 'utf8');
  const hear = /const HEAR_UNITS = (\d+) \* UNITS_PER_METRE;/.exec(server);
  yes('no reach is past what the position cull tells anybody about (HEAR_UNITS)',
      !!hear && typeof h.captionReach === 'function' && h.captionReach('yell') <= Number(hear[1]) * 70);
  const head = typeof h.captionHead === 'function' ? h.captionHead('Stop\nright\u202e there\u2028 thief' + ' x'.repeat(60)) : '';
  yes('a caption is one line with nothing that breaks it or turns it round',
      head.indexOf('\n') < 0 && head.indexOf('\u202e') < 0 && head.indexOf('\u2028') < 0 &&
      head.indexOf('Stop right there thief') === 0);
  yes('and it is cut to 80 characters like a typed line', head.length <= 80 && head.length >= 77 && /\.\.\.$/.test(head));
  yes('nothing but spaces is no caption', typeof h.captionHead === 'function' && h.captionHead(' \n\t ') === '');
}

// ----------------------------------------------------------------- off ----
async function off() {
  console.log('');
  console.log('THORNSWOOD_CAPTIONS unset, which is how every service is left until #2475 is decided:');
  const svc = await service(null);
  try {
    const a = await join(svc, 101, 'Aela');
    await join(svc, 104, 'Dagny');
    await place(svc, ['Aela', 'Dagny']);
    send(a, { t: 'captions', share: true });
    send(a, { t: 'talk', on: true });
    yes('OFF a caption reaches nobody, not even the speaker', seenBy(await caption(svc, a, 'Hello there', []), []));
    const h = await svc.health();
    yes('OFF /health says captions are off and counts the one dropped',
        !!h.captions && h.captions.on === false && h.captions.dropped === 1 && h.captions.sent === 0);
  } finally { await svc.stop(); }
}

// ------------------------------------------------------------------ on ----
async function on() {
  console.log('');
  console.log('THORNSWOOD_CAPTIONS=on:');
  const svc = await service('on');
  try {
    const a = await join(svc, 101, 'Aela');
    const b = await join(svc, 102, 'Brand');
    await join(svc, 103, 'Cass');
    const d = await join(svc, 104, 'Dagny');
    await join(svc, 105, 'Eorlund');
    await join(svc, 106, 'Fenrig');
    const everyone = ['Aela', 'Brand', 'Cass', 'Dagny', 'Eorlund', 'Fenrig'];
    const fresh = () => place(svc, everyone);
    yes('ON /health says captions are on', (await svc.health()).captions.on === true);

    await fresh();
    send(a, { t: 'talk', on: true });
    yes('ON somebody who never said share is shown to nobody, themselves included',
        seenBy(await caption(svc, a, 'Not shared', []), []));

    send(a, { t: 'talk', on: false });
    send(a, { t: 'captions', share: true });
    await sleep(2300);
    await fresh();
    yes('ON sharing, but the talk key up for more than two seconds: nobody',
        seenBy(await caption(svc, a, 'Not talking', []), []));

    send(a, { t: 'talk', on: true });
    await fresh();
    const local = await caption(svc, a, 'Hand over the purse', ['Aela', 'Brand', 'Dagny']);
    yes('ON talking at ordinary distance: Aela, Brand at 21 m and Dagny at 6 m; not Cass at 71 m, not Fenrig, not Eorlund through the inn wall',
        seenBy(local, ['Aela', 'Brand', 'Dagny']));
    const got = b.caps[0] || {};
    yes('ON what arrives is the words, who said them, their actor and their mode, with no name and nothing else',
        same(Object.keys(got).sort(), ['actor', 'at', 'mode', 'profileId', 't', 'text']) &&
        got.text === 'Hand over the purse' && got.profileId === 101 && got.actor === 0xff000101 && got.mode === 'local');

    send(a, { t: 'vmode', mode: 'whisper' });
    await sleep(100);
    await fresh();
    yes('ON a whisper reaches 7 m: Aela and Dagny',
        seenBy(await caption(svc, a, 'Quietly now', ['Aela', 'Dagny']), ['Aela', 'Dagny']));
    await sleep(1100);

    send(a, { t: 'vmode', mode: 'yell' });
    await sleep(100);
    await fresh();
    yes('ON a yell reaches 85 m: Cass too, never Fenrig at 100 m or the inn',
        seenBy(await caption(svc, a, 'Run', ['Aela', 'Brand', 'Cass', 'Dagny']), ['Aela', 'Brand', 'Cass', 'Dagny']));
    send(a, { t: 'vmode', mode: 'local' });
    await sleep(1100);

    send(a, { t: 'talk', on: false });
    await fresh();
    yes('ON the last words still come for two seconds after the key comes up',
        seenBy(await caption(svc, a, 'And stay down', ['Aela', 'Brand', 'Dagny']), ['Aela', 'Brand', 'Dagny']));
    send(a, { t: 'talk', on: true });
    await sleep(1100);

    send(d, { t: 'captions', see: false });
    await sleep(100);
    await fresh();
    yes('ON Dagny turned captions off: Brand still sees it, Dagny does not',
        seenBy(await caption(svc, a, 'Dagny will not see this', ['Aela', 'Brand']), ['Aela', 'Brand']));
    send(d, { t: 'captions', see: true });
    await sleep(1100);

    yes('ON (Brand turns Aela\'s text off)', await post(svc, '/textmute', { by: { 102: [101] } }) === 200);
    await fresh();
    yes('ON a personal text mute hides her captions from Brand',
        seenBy(await caption(svc, a, 'Brand muted me', ['Aela', 'Dagny']), ['Aela', 'Dagny']));
    await post(svc, '/textmute', { by: {} });
    await sleep(1100);

    // A burst: three go, the rest are dropped.
    await fresh();
    for (const s of svc.socks) { s.caps.length = 0; }
    for (let i = 0; i < 6; i++) { send(a, { t: 'caption', text: 'Burst ' + i }); }
    await sleep(600);
    yes('ON six at once: three reach Brand and the rest go nowhere', b.caps.length === 3);
    await sleep(3100);
    send(a, { t: 'talk', on: true });

    yes('ON (staff silence Aela)', await post(svc, '/silenced', { profiles: { 101: Date.now() + 60000 } }) === 200);
    await fresh();
    yes('ON silenced: nobody, not even Aela',
        seenBy(await caption(svc, a, 'Silenced words', []), []));
    await post(svc, '/silenced', { profiles: {} });
    await sleep(1100);

    await place(svc, everyone.filter((n) => n !== 'Aela'));
    send(a, { t: 'talk', on: true });
    yes('ON a speaker with no position is seen only by themselves, never by everybody',
        seenBy(await caption(svc, a, 'Where am I', ['Aela']), ['Aela']));

    const chat = path.join(svc.dir, 'chat');
    const logged = fs.existsSync(chat) ? fs.readdirSync(chat).map((f) => fs.readFileSync(path.join(chat, f), 'utf8')).join('') : '';
    yes('ON not one caption is in the chat log', !/Hand over the purse|Quietly now|And stay down|Burst \d|Where am I/.test(logged));
    yes('ON nor in the service\'s own log', !/Hand over the purse|Quietly now|And stay down|Where am I/.test(svc.log()));

    // Aela's last connection closes; a new one has not said share.
    a.ws.close();
    svc.socks.splice(svc.socks.indexOf(a), 1);
    await sleep(300);
    const a2 = await join(svc, 101, 'Aela');
    await fresh();
    send(a2, { t: 'talk', on: true });
    yes('ON a new session starts unshared: the choice went with the last connection',
        seenBy(await caption(svc, a2, 'Back again', []), []));

    const h = await svc.health();
    yes('ON /health counts what went out and what did not', h.captions.sent >= 8 && h.captions.dropped >= 6);
  } finally { await svc.stop(); }
}

// ------------------------------------------------------------ settings ----
async function settings() {
  console.log('');
  console.log('THORNSWOOD_CAPTIONS=on with every caption setting changed:');
  const svc = await service('on', {
    THORNSWOOD_CAPTION_REACH: '1000', THORNSWOOD_CAPTION_TAIL_MS: '0',
    THORNSWOOD_CAPTION_BURST: '1', THORNSWOOD_CAPTION_REFILL_MS: '60000',
    THORNSWOOD_CAPTION_TEXT_MUTE: 'off'
  });
  try {
    const h = (await svc.health()).captions || {};
    yes('SET /health says what each setting is',
        h.reach === 1000 && h.tailMs === 0 && h.burst === 1 && h.refillMs === 60000 && h.textMute === false);
    const a = await join(svc, 101, 'Aela');
    await join(svc, 102, 'Brand');
    const d = await join(svc, 104, 'Dagny');
    const all = ['Aela', 'Brand', 'Dagny'];
    await place(svc, all);
    send(a, { t: 'captions', share: true });
    send(a, { t: 'vmode', mode: 'yell' });
    send(a, { t: 'talk', on: true });
    await post(svc, '/textmute', { by: { 104: [101] } });
    await sleep(100);
    yes('SET a reach of 1000 units holds even a yell to 14 m, and a text mute is left to the voice switch: Aela and Dagny, not Brand',
        seenBy(await caption(svc, a, 'Close by', ['Aela', 'Dagny']), ['Aela', 'Dagny']));
    for (const s of svc.socks) { s.caps.length = 0; }
    send(a, { t: 'caption', text: 'Second' });
    await sleep(400);
    yes('SET a burst of one with a minute to refill: the next goes nowhere', d.caps.length === 0);
  } finally { await svc.stop(); }
  const svc2 = await service('on', { THORNSWOOD_CAPTION_TAIL_MS: '0', THORNSWOOD_CAPTION_REACH: '99999' });
  try {
    const a = await join(svc2, 101, 'Aela');
    await join(svc2, 102, 'Brand');
    await join(svc2, 103, 'Cass');
    await place(svc2, ['Aela', 'Brand', 'Cass']);
    send(a, { t: 'captions', share: true });
    send(a, { t: 'talk', on: true });
    await sleep(100);
    yes('SET a reach set past the voice reach is still the voice reach: not Cass at 71 m speaking ordinarily',
        seenBy(await caption(svc2, a, 'Ordinary', ['Aela', 'Brand']), ['Aela', 'Brand']));
    send(a, { t: 'talk', on: false });
    await sleep(50);
    yes('SET no tail: once the key is up, nothing',
        seenBy(await caption(svc2, a, 'After', []), []));
  } finally { await svc2.stop(); }
}

(async () => {
  SITE = await siteThatSaysYes();
  words();
  await off();
  await on();
  await settings();
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
