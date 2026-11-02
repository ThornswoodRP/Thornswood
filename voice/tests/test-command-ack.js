/*
  test-command-ack.js

  Entry 290: the command channel between the plugins and the server had no
  acknowledgement, and dropped the oldest on overflow.

  Every slash line and every plugin report (/face, a swing of the axe, a
  broken lockpick) goes from the chat socket into the voice service's queue,
  and the gamemode collects it over loopback every second and a half. Two
  ways that lost commands with nobody told:

    GET /commands emptied the queue in one splice before the gamemode had
    read the answer, and poll() parsed it inside a catch that returned. A
    batch that failed to parse, or an answer lost to the timeout, was gone.

    A full queue shifted the OLDEST off the front, without a word, to make
    room: a command already taken vanished.

  So this proves, against the real service spawned in a temp folder and the
  real poll() lifted out of gamemode.js by text:

    a command asked for with ?ack=1 is still there on a second GET, until an
    acknowledgement takes it away;
    a plain GET still empties the queue, so a gamemode from before this
    change is never handed the same command twice;
    the retry is bounded, and giving up is logged;
    a full queue refuses the newest, keeps the oldest, and tells the sender;
    poll() acknowledges only what it ran, never after a parse failure, runs
    an id offered twice only once, and against a service from before this
    change (no ids) runs everything once and acknowledges nothing;
    and end to end, a typed command runs once and leaves the queue empty.

  GM and VOICE point it at other copies of the two files, which is how it was
  shown to fail on the code before the change. Read only apart from its own
  temp folder and two loopback ports the system hands out.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in voice\tests\, the repository is two folders up
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const http = require('http');
const net = require('net');
const { spawn } = require('child_process');

const CR = String.fromCharCode(13);
const GM = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');
const gm = fs.readFileSync(GM, 'utf8').split(CR).join('');
const voiceSrc = fs.readFileSync(VOICE, 'utf8').split(CR).join('');

// Both were fixed (7911 and 7912), so a build beside this one on the VPS could
// answer it (#1703). They are set when the two start, below.
let PORT = 0;             // the real service
let FAKE = 0;             // a stand-in service whose answers the test chooses

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) {
    if (await cond()) { return true; }
    await wait(25);
  }
  return false;
}

// ------------------------------------------------------- the real service ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-command-ack-'));
fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
// Every connection proves itself since #1303, so this harness signs its own
// join tokens with a key it puts beside its copy of the service. One token
// opens one connection and goes with the handshake since #1337 and #1322.
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
function tokenFor(pid) {
  const body = 'v2.' + pid + '.' + Date.now() + '.' + crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
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
let srv = null;
let srvLog = '';
let base = '';
async function startVoice() {
  PORT = await freePort('0.0.0.0');
  base = 'http://127.0.0.1:' + PORT;
  srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_VOICE_PORT: String(PORT),
      THORNSWOOD_SITE: '',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
    }),
  });
  srv.stdout.on('data', (d) => { srvLog += d; });
  srv.stderr.on('data', (d) => { srvLog += d; });
  await listening(srv, PORT);
}
async function health() {
  try { const r = await fetch(base + '/health'); if (r.ok) { return await r.json(); } } catch (e) { }
  return null;
}
async function queued() { const h = await health(); return h ? h.queuedCommands : -1; }
async function getCommands(query) {
  const r = await fetch(base + '/commands' + (query || ''));
  try { return (await r.json()).commands || []; } catch (e) { return null; }
}
async function ack(ids) {
  const r = await fetch(base + '/commands/ack', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ids: ids }),
  });
  try { return await r.json(); } catch (e) { return { status: r.status }; }
}

const sockets = [];
/* Join the room as somebody, and keep every chat line the service sends. */
function join(profileId, name) {
  return new Promise((done, fail2) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(profileId)]);
    const heard = [];
    sockets.push(ws);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.t === 'welcome') { done({ ws: ws, heard: heard, say: (text) => ws.send(JSON.stringify({ t: 'chat', text: text })) }); }
      if (m.t === 'chat') { heard.push(m); }
    };
    ws.onerror = () => fail2(new Error('could not join'));
    setTimeout(() => fail2(new Error('no welcome')), 4000);
  });
}

// ----------------------------------------------------- the gamemode's poll ---
/*
  The real poll(), with the real post() it acknowledges through, over a
  pretend globalThis. What runs a line is the one thing supplied: it records
  what it was asked to run, and throws when told to.

  Since entry 352 poll() hands every line to dispatch(), which runs it through
  handle() or holds it until the character is back in the world, and
  test-held-commands.js drives the real dispatch(). Here the supplied function
  stands in for dispatch(), and handle() only writes down a line handed to it
  straight, since that line would skip the hold.
*/
function rig(port, g, run) {
  const pa = gm.indexOf('  function post(path, payload) {');
  const pb = gm.indexOf('  /** A line in the chat, to one person. */', pa);
  const a = gm.indexOf('  if (!g.__thornswoodCommandsRun) {');
  const b = a < 0 ? -1 : gm.indexOf('  if (g.__thornswoodCommandTimer)', a);
  if (pa < 0 || pb < 0 || a < 0 || b < 0) { return null; }
  const fn = new Function('g', 'VOICE_PORT', 'dispatch', 'handle', 'log', 'require',
    gm.slice(pa, pb) + '\n' + gm.slice(a, b) + '\nreturn { poll: poll };');
  const logged = [];
  const straight = [];
  const api = fn(g, port, run, function (cmd) { straight.push(cmd); },
                 function () { logged.push([].slice.call(arguments).join(' ')); }, require);
  api.logged = logged;
  api.straight = straight;
  return api;
}

/* A service that answers whatever the test says, and writes down every ask. */
const fake = { answer: '{"commands":[]}', asks: [], acks: [] };
const fakeServer = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    if (req.method === 'GET') {
      fake.asks.push(req.url);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(fake.answer);
      return;
    }
    if (req.method === 'POST' && req.url === '/commands/ack') {
      try { fake.acks.push(JSON.parse(body).ids); } catch (e) { fake.acks.push('unreadable'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"removed":0}');
      return;
    }
    res.writeHead(404).end('not found');
  });
});

/* One poll against the stand-in. The GET is waited on by the ask count;
   the acknowledgement is waited on by the ack count (or the until times
   out when none is posted: parse fail, or a service with no ids). A flat
   250 ms after the ask was what drifted under load. */
async function pollFake(api, answer) {
  fake.answer = answer;
  const asks = fake.asks.length;
  const acks = fake.acks.length;
  api.poll();
  await until(() => fake.asks.length > asks, 2000);
  await until(() => fake.acks.length > acks, 2000);
}

function done() {
  process.exitCode = fail ? 1 : 0;
  for (const s of sockets) { try { s.close(); } catch (e) { } }
  try { fakeServer.close(); } catch (e) { }
  try { srv.kill(); } catch (e) { }
  setTimeout(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }, 300).unref();
  // Whatever is still closing underneath, the counts are already out.
  setTimeout(() => process.exit(process.exitCode), 3000).unref();
}

(async () => {
  // The stand-in is in this process, so it listens on a port the system picks
  // and is asked on the one it got.
  await new Promise((r) => fakeServer.listen(0, '127.0.0.1', r));
  FAKE = fakeServer.address().port;
  try { await startVoice(); } catch (e) { console.log('the service never came up: ' + e.message); fail++; return; }
  const h = await health();
  if (!h) { console.log('the service did not answer /health. log:\n' + srvLog); fail++; return; }

  const offersMatch = /const COMMAND_OFFERS = (\d+);/.exec(voiceSrc);
  const OFFERS = offersMatch ? Number(offersMatch[1]) : 0;
  const capMatch = /const COMMAND_CAP = (\d+);/.exec(voiceSrc);
  const CAP = capMatch ? Number(capMatch[1]) : 0;
  yes('the service says how many times a command is offered, and it is a small bound',
      OFFERS > 1 && OFFERS <= 10);
  yes('the queue is still capped at two hundred', CAP === 200);

  const djinn = await join(4242, 'Djinn');

  // ---- ?ack=1: a second GET still has it, until it is acknowledged ---------
  console.log('\na command stays until the gamemode says it ran:');
  djinn.say('/tp riverwood');
  yes('a slash line reaches the queue', await until(async () => (await queued()) === 1));
  const first = await getCommands('?ack=1');
  const c = first && first[0];
  yes('it is handed out once asked for with ?ack=1', !!c && c.text === '/tp riverwood');
  yes('it carries an id: this process\'s stamp and a counter',
      !!c && /^[0-9a-f]{8}:\d+$/.test(String(c.id)));
  yes('and who sent it, off the connection', !!c && c.profileId === 4242 && c.name === 'Djinn');
  yes('the offer count stays inside the service', !!c && !('offers' in c));
  const second = await getCommands('?ack=1');
  yes('a second GET still returns it, because nothing acknowledged it',
      !!second && second.length === 1 && !!c && second[0].id === c.id);
  const acked = await ack(c ? [c.id] : []);
  yes('an acknowledgement takes it away', acked && acked.removed === 1);
  const third = await getCommands('?ack=1');
  yes('and after that no GET returns it', !!third && third.length === 0);
  const stray = await ack(['nobody:1', 42, null]);
  yes('an id nobody has is acknowledged harmlessly', stray && stray.removed === 0);

  // ---- a plain GET is what a gamemode from before this change sends --------
  console.log('\nan older gamemode still empties the queue on its plain GET:');
  djinn.say('/help');
  await until(async () => (await queued()) === 1);
  const old1 = await getCommands('');
  yes('a plain GET returns the command with every field it always had',
      !!old1 && old1.length === 1 && old1[0].text === '/help' && old1[0].profileId === 4242 &&
      old1[0].name === 'Djinn' && typeof old1[0].at === 'number');
  const old2 = await getCommands('');
  yes('and empties the queue, so it is never handed the same command twice',
      !!old2 && old2.length === 0 && (await queued()) === 0);

  // ---- the retry is bounded -------------------------------------------------
  console.log('\na command nobody acknowledges is offered ' + OFFERS + ' times, then given up on:');
  djinn.say('/where');
  await until(async () => (await queued()) === 1);
  let offered = 0;
  for (let i = 0; i < OFFERS + 2; i++) {
    const got = await getCommands('?ack=1');
    if (got && got.length === 1 && got[0].text === '/where') { offered++; }
  }
  yes('it was offered exactly ' + OFFERS + ' times', offered === OFFERS);
  yes('and is no longer queued', (await queued()) === 0);
  // console.log is through the child's stdout pipe; under load the parent's
  // srvLog can lag the HTTP answer that already dropped the command.
  yes('and giving up on it is written in the service log, by id and not by text',
      await until(() => /gave up on command [0-9a-f]{8}:\d+ from profile 4242 after \d+ offers/.test(srvLog), 3000) &&
      srvLog.indexOf('/where') < 0);

  // ---- a full queue refuses the newest and says so -------------------------
  console.log('\na full queue refuses the newest, keeps the oldest, and tells the sender:');
  // Each slash line does a sync chat log write in the service. Under load
  // (a full harness sweep) two hundred of those can take longer than five
  // seconds to land, and the refusal checks below cascade from this one.
  for (let i = 1; i <= CAP; i++) {
    djinn.say('/n ' + i);
    if (i % 25 === 0) { await wait(0); }
  }
  yes('the queue fills to its cap', await until(async () => (await queued()) === CAP, 30000));
  const heardBefore = djinn.heard.length;
  djinn.say('/n newest');
  const told = await until(() => djinn.heard.length > heardBefore, 5000);
  const notice = djinn.heard[djinn.heard.length - 1] || {};
  yes('the sender is told', told && /not taking commands right now/.test(String(notice.text)));
  yes('by the server, as a chat line to them alone', notice.from === 0 && notice.name === 'Thornswood');
  yes('and the notice has no em dash in it', String(notice.text).indexOf(String.fromCharCode(0x2014)) < 0);
  const full = await getCommands('?ack=1');
  yes('what was already taken is all still there', !!full && full.length === CAP);
  yes('the oldest was not dropped', !!full && full.length > 0 && full[0].text === '/n 1');
  yes('the newest was refused', !!full && !full.some((x) => x.text === '/n newest'));
  djinn.say('/n again');
  // Negative: wait the same window a refusal that should arrive uses, and
  // require that no second line showed up. A flat 300 ms was both short under
  // load (missed a late duplicate) and raced nothing useful.
  const secondLine = await until(() => djinn.heard.length > heardBefore + 1, 5000);
  yes('a second refusal inside ten seconds is not a second line in the chat',
      !secondLine && djinn.heard.length === heardBefore + 1);
  const ken = await join(7, 'Ken');
  ken.say('/tp whiterun');
  yes('somebody else sending into the full queue is told too',
      await until(() => ken.heard.some((m) => /not taking commands/.test(String(m.text))), 5000));
  yes('the refusal is written in the service log',
      await until(() => /the command queue is full at 200/.test(srvLog), 3000));
  const cleared = await ack((full || []).map((x) => x.id));
  yes('and an acknowledgement of the lot empties it', cleared && cleared.removed === CAP &&
      (await queued()) === 0);

  // ---- the gamemode's poll(), against a stand-in service -------------------
  console.log('\nthe gamemode\'s poll():');
  const g = {};
  const ran = [];
  let throwOn = '';
  const handle = (cmd) => { ran.push(cmd.text); if (cmd.text === throwOn) { throw new Error('boom'); } };
  const api = rig(FAKE, g, handle);
  yes('the poll block lifts out of gamemode.js', api !== null);
  if (api) {
    await pollFake(api, 'not json{');
    yes('it asks with ?ack=1', fake.asks[fake.asks.length - 1] === '/commands?ack=1');
    yes('a body that does not parse runs nothing', ran.length === 0);
    yes('and acknowledges nothing, so the service offers the batch again', fake.acks.length === 0);

    const one = JSON.stringify({ commands: [{ id: 'b:1', profileId: 1, text: '/tp x' }] });
    await pollFake(api, one);
    yes('a command with an id runs', ran.length === 1 && ran[0] === '/tp x');
    yes('and is acknowledged by that id after it ran',
        fake.acks.length === 1 && JSON.stringify(fake.acks[0]) === '["b:1"]');

    await pollFake(api, one);
    yes('offered again because the acknowledgement went missing, it does not run twice',
        ran.length === 1);
    yes('but is acknowledged again', fake.acks.length === 2 && JSON.stringify(fake.acks[1]) === '["b:1"]');

    throwOn = '/boom';
    const bad = JSON.stringify({ commands: [{ id: 'b:2', profileId: 1, text: '/boom' },
                                            { id: 'b:3', profileId: 1, text: '/after' }] });
    await pollFake(api, bad);
    yes('a command that throws does not stop the one after it', ran.join(',') === '/tp x,/boom,/after');
    yes('the throw is logged', api.logged.some((l) => /command threw/.test(l)));
    yes('and a command that threw is still acknowledged, so it is not run again',
        JSON.stringify(fake.acks[fake.acks.length - 1]) === '["b:2","b:3"]');
    await pollFake(api, bad);
    yes('offered again, neither runs a second time', ran.length === 3);

    const acksBefore = fake.acks.length;
    await pollFake(api, JSON.stringify({ commands: [{ profileId: 1, name: 'x', text: '/old', at: 1 }] }));
    yes('from a service before ids, a command still runs', ran[ran.length - 1] === '/old');
    yes('and nothing is acknowledged, because that service already emptied its queue',
        fake.acks.length === acksBefore);

    const reloaded = rig(FAKE, g, handle);
    await pollFake(reloaded, one);
    yes('after a hot reload the ids that ran are still remembered', ran.length === 4);

    const many = [];
    for (let i = 0; i < 2001; i++) { many.push({ id: 'm:' + i, profileId: 1, text: '/m' }); }
    await pollFake(reloaded, JSON.stringify({ commands: many }));
    const run = g.__thornswoodCommandsRun;
    yes('what it remembers is capped at two thousand', !!run && run.order.length === 2000);
    yes('oldest out', !!run && run.seen['b:1'] !== true && run.seen['m:2000'] === true);
    yes('every line went to dispatch(), none straight to handle()',
        api.straight.length === 0 && reloaded.straight.length === 0);
  }

  // ---- end to end: typed in the chat, run once by the real poll ------------
  console.log('\nend to end, the real poll against the real service:');
  const g2 = {};
  const ran2 = [];
  const live = rig(PORT, g2, (cmd) => { ran2.push(cmd); });
  if (live) {
    djinn.say('/tp falkreath');
    await until(async () => (await queued()) === 1);
    live.poll();
    yes('the command runs', await until(() => ran2.length === 1, 3000) &&
        ran2[0].text === '/tp falkreath' && ran2[0].profileId === 4242);
    yes('the acknowledgement empties the queue', await until(async () => (await queued()) === 0, 3000));
    const ranBefore = ran2.length;
    live.poll();
    // The second poll's GET is async; wait until a late run would have shown,
    // then require the count stayed put. A flat 400 ms was the old settle.
    const lateRun = await until(() => ran2.length > ranBefore, 2000);
    yes('and the next poll runs nothing', !lateRun && ran2.length === 1);
    yes('and it went through dispatch(), not straight to handle()', live.straight.length === 0);
  } else {
    yes('the poll block lifts out of gamemode.js for the end to end run', false);
  }
})().catch((e) => { fail++; console.log('FAIL  the harness threw: ' + (e && e.stack ? e.stack : e)); })
  .then(() => {
    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    done();
  });
