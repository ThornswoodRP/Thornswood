// test-4623-load-test.js
//
//     node .\tests\test-4623-load-test.js
//
// #4623. The load test's own parts, without a game server:
//  - load-proxy.js passes datagrams both ways unchanged, gives each bot a
//    socket of its own towards the server on a loopback address of its own
//    (so the server sees one address a bot, as it sees one a person), and
//    counts every byte and datagram each way;
//  - load-bots.js's bot, against a stand-in for createBotClient: it logs in
//    once connected and answers the login challenge with a join pass signed
//    by the load copy's own key, sends one face when the race menu is open,
//    then a move every 130 ms, unreliable, walking; a Teleport2 moves it and its
//    teleportSeq is echoed; a refusal or a closed connection fails it with
//    the reason; it keeps no message;
//  - Load-Test.js's arithmetic: cores over the samples' own times, bytes on
//    the wire with 28 bytes of header a datagram, per person against step 0,
//    and the summary table;
//  - the chat socket against the real voice service from this checkout,
//    started the way Load-Test.js starts it: a token, a socket, a join with
//    voice off, and the join pass on the command queue the gamemode drains,
//    under the bot's own profile, a fresh pass each time;
//  - New-LoadServer.js: the start points of each shape, and its refusals of
//    a server build whose record is not the checkout's, a file that is not
//    the record's, and a master that is not the one the fork's build holds
//    it to, or is not there;
//  - what else a bot does (--play): a swing is an attack animation and an
//    unarmed hit on a person near it, both reliable; an NPC the server hands
//    it (HostStart) is sent a move on its beat until HostStop; a trade ask is
//    "/merchant <id>" for the nearest NPC, and the answers are counted;
//  - the box's copy (New-LoadServer.js --from, against a stand-in for an
//    installed server): its plugins by full path, its NPC switch and
//    gameplay switches kept, nothing else of the server's settings, its own
//    ports and pass key, and its refusals of the server's own port and a
//    plugin that is not there; and Load-Test.js stops for anybody on a
//    watched server, or one that does not answer.
//
// Read only, apart from temp folders it deletes. The proxy test binds UDP
// sockets on 127.0.0.1 to 127.0.1.2, and the voice test a copy of the voice
// service and a stand-in site on 127.0.0.1; nothing else connects anywhere.
'use strict';
const crypto = require('crypto');
const dgram = require('dgram');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const BOT = path.join(ROOT, 'scripts', 'bot');
const { makeProxy, addressFor } = require(path.join(BOT, 'load-proxy.js'));
const { LoadBot, MOVE_MS } = require(path.join(BOT, 'load-bots.js'));
const { windowOf, perPerson, markdown, startVoice, siteThatSaysYes, someoneOn, playCounts } = require(path.join(BOT, 'Load-Test.js'));
const http = require('http');
const net = require('net');
const server = require(path.join(BOT, 'New-LoadServer.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function proxyChecks() {
  // A stand-in server that answers every datagram with "re:" and it, and
  // remembers who sent it.
  const seen = new Set();
  const srv = dgram.createSocket('udp4');
  srv.on('message', (b, from) => { seen.add(from.address + ':' + from.port); srv.send(Buffer.concat([Buffer.from('re:'), b]), from.port, from.address); });
  await new Promise((r) => srv.bind(0, '127.0.0.1', r));
  let port = 0;
  const p = makeProxy('127.0.0.1', srv.address().port, (x) => { port = x; });
  for (let i = 0; i < 100 && !port; i++) { await sleep(10); }
  yes('the proxy listens', port > 0);
  const got = { a: [], b: [] };
  const a = dgram.createSocket('udp4'); const b = dgram.createSocket('udp4');
  a.on('message', (m) => got.a.push(String(m))); b.on('message', (m) => got.b.push(String(m)));
  await new Promise((r) => a.bind(0, '127.0.0.1', r)); await new Promise((r) => b.bind(0, '127.0.0.1', r));
  a.send(Buffer.from('hello'), port, '127.0.0.1');
  a.send(Buffer.from('again'), port, '127.0.0.1');
  b.send(Buffer.from('xyz'), port, '127.0.0.1');
  for (let i = 0; i < 200 && (got.a.length < 2 || got.b.length < 1); i++) { await sleep(10); }
  yes('each bot gets the server\'s answers to its own datagrams, unchanged', got.a.join(',') === 're:hello,re:again' && got.b.join(',') === 're:xyz');
  yes('the server sees one address a bot, not the proxy\'s one', seen.size === 2);
  const ips = [...seen].map((k) => k.split(':')[0]).sort();
  yes('each bot comes from a loopback address of its own, as each person from theirs (SLikeNet refuses a second connection from one address within 100 ms)',
    ips.join(',') === '127.0.1.1,127.0.1.2');
  const r = p.report();
  yes('two bots are two clients', r.clients === 2);
  yes('up counts every byte and datagram the bots sent (5+5+3, 3)', r.up === 13 && r.upDatagrams === 3);
  yes('down counts every byte and datagram the server sent (8+8+6, 3)', r.down === 22 && r.downDatagrams === 3);
  yes('no socket had a problem', r.problems.length === 0);
  p.close(); a.close(); b.close(); srv.close();
  yes('addresses go 127.0.1.1 to 127.0.1.250, then 127.0.2.1', addressFor(0) === '127.0.1.1' && addressFor(249) === '127.0.1.250' && addressFor(250) === '127.0.2.1');
}

// A stand-in for createBotClient: what tick() hands over is queued by the
// test, and every send is kept.
function fakeAddon() {
  const made = [];
  return {
    made,
    createBotClient: (host, port) => {
      const c = { host, port, queue: [], sent: [], destroyed: false };
      c.tick = () => c.queue.splice(0);
      c.send = (m, reliable) => c.sent.push({ m, reliable });
      c.destroy = () => { c.destroyed = true; };
      made.push(c);
      return c;
    }
  };
}

function botChecks() {
  const addon = fakeAddon();
  const b = new LoadBot(addon, { host: '127.0.0.1', port: 5000, password: '', name: 'x' });
  b.profileId = 1900000123; b.passKey = 'k'.repeat(64); b.server = 'dev';
  b.client = addon.createBotClient('127.0.0.1', 5000);
  b.state = 'connecting'; b.step = 'connecting'; b.deadline = Date.now() + 60000;
  const c = addon.made[0];
  let now = Date.now();
  b.pump(); b.advance(now);
  yes('nothing is sent before the connection is accepted', c.sent.length === 0);
  c.queue.push({ type: 'connectionAccepted' });
  b.pump(); b.advance(now);
  const login = c.sent[0] && c.sent[0].m;
  yes('once connected it logs in with its profile id alone, as the game\'s first packet',
    login && login.t === 1 && JSON.parse(login.contentJsonDump).customPacketType === 'loginWithSkympIo' &&
    JSON.parse(login.contentJsonDump).gameData.profileId === 1900000123 && c.sent[0].reliable === true);
  c.queue.push({ type: 'message', message: { t: 1, contentJsonDump: JSON.stringify({ customPacketType: 'thornswoodLoginChallenge', n: 'nonce-1' }) } });
  b.pump(); b.advance(now);
  const proof = c.sent[1] && JSON.parse(c.sent[1].m.contentJsonDump);
  const parts = proof ? String(proof.pass).split('.') : [];
  const body = parts.length === 3 ? JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) : {};
  const sig = crypto.createHmac('sha256', 'k'.repeat(64)).update('jp1.' + parts[1]).digest('base64url');
  yes('the login challenge is answered once, with a pass signed by the load copy\'s key for its profile and server, and a Discord id of its own',
    proof && proof.customPacketType === 'thornswoodLoginProof' && parts[0] === 'jp1' && parts[2] === sig && body.p === 1900000123 && body.s === 'dev' &&
    body.d === 'load-1900000123' && body.x > Date.now() + 3600000);
  const lk = crypto.createHmac('sha256', 'k'.repeat(64)).update('jpk1.' + parts[2]).digest('base64url');
  yes('its mac is the launcher\'s: HMAC of jlp1.<nonce> under the pass\'s login key', proof && proof.mac === crypto.createHmac('sha256', lk).update('jlp1.nonce-1').digest('base64url'));
  c.sent.splice(1, 1);
  c.queue.push({ type: 'message', message: { t: 33, isMe: true, idx: 7, transform: { pos: [100, 200, 300], worldOrCell: 0x3c }, props: { isRaceMenuOpen: true } } });
  b.pump(); b.advance(now);
  const f = c.sent[1] && c.sent[1].m;
  yes('its character with the race menu open gets one face (UpdateAppearance) for its idx', f && f.t === 4 && f.idx === 7 && c.sent.length === 2);
  yes('then it is walking', b.step === 'moving');
  b.lastMove = now;  // its beat starts somewhere in the first 130 ms; here, now
  now += MOVE_MS + 1; b.pump(); b.advance(now);
  const mv = c.sent[2];
  yes('a move is an UpdateMovement for its idx in its cell, sent unreliable, as the game sends it',
    mv && mv.m.t === 2 && mv.m.idx === 7 && mv.m.data.worldOrCell === 0x3c && mv.reliable === false && mv.m.data.runMode === 'Walking');
  const d = Math.hypot(mv.m.data.pos[0] - 100, mv.m.data.pos[1] - 200);
  yes('it walks around where it was put, at its height', d >= 200 && d <= 500 && mv.m.data.pos[2] === 300);
  b.advance(now + 10);
  yes('no second move inside 130 ms', c.sent.length === 3);
  b.advance(now + MOVE_MS + 1);
  yes('the next move comes once 130 ms have passed', c.sent.length === 4);
  b.advance(now + 3 * MOVE_MS + 5);
  yes('a bot a whole beat behind sends one move, not the missed ones', c.sent.length === 5 && b.lastMove === now + 3 * MOVE_MS + 5);
  c.queue.push({ type: 'message', message: { t: 31, pos: [5000, 6000, 7000], rot: [0, 0, 0], worldOrCell: 0x3c, teleportSeq: 4 } });
  b.pump(); b.advance(now + 4 * MOVE_MS + 10);
  const after = c.sent[c.sent.length - 1].m.data;
  yes('a Teleport2 moves it there, and its next move echoes the teleportSeq',
    Math.hypot(after.pos[0] - 5000, after.pos[1] - 6000) < 600 && after.teleportSeq === 4 && b.teleports === 1);
  for (let i = 0; i < 50; i++) { c.queue.push({ type: 'message', message: { t: 2, idx: 9, data: {} } }); }
  b.pump();
  yes('it counts what it reads by type and keeps none of it', b.counts[2] === 50 && b.inbox.length === 0);
  c.queue.push({ type: 'disconnect' });
  b.pump(); b.advance(now + 6 * MOVE_MS);
  yes('a closed connection fails it, saying at which step', b.step === 'failed' && /closed the connection at step moving/.test(b.why));

  const addon2 = fakeAddon();
  const r = new LoadBot(addon2, { host: '127.0.0.1', port: 5000, name: 'y' });
  r.profileId = 1; r.client = addon2.createBotClient('127.0.0.1', 5000); r.state = 'connecting'; r.step = 'connecting'; r.deadline = Date.now() + 60000;
  addon2.made[0].queue.push({ type: 'connectionDenied', error: 'full' });
  r.pump(); r.advance(Date.now());
  yes('a refusal fails it with what the server said', r.step === 'failed' && /refused: connectionDenied: full/.test(r.why));
  const s = new LoadBot(addon2, { host: '127.0.0.1', port: 5000, name: 'z' });
  s.profileId = 2; s.client = addon2.createBotClient('127.0.0.1', 5000); s.state = 'connecting'; s.step = 'connecting'; s.deadline = Date.now() - 1;
  s.pump(); s.advance(Date.now());
  yes('no answer in time fails it, naming the step', s.step === 'failed' && /no answer at step connecting/.test(s.why));
}

function playChecks() {
  const addon = fakeAddon();
  const b = new LoadBot(addon, { host: '127.0.0.1', port: 5000, name: 'p' });
  b.profileId = 1900000500; b.play = ['fight', 'host', 'trade'];
  b.client = addon.createBotClient('127.0.0.1', 5000);
  const c = addon.made[0];
  b.state = 'connected'; b.step = 'moving'; b.character = { idx: 7 }; b.center = [0, 0, 0]; b.cell = 0x3c; b.radius = 300; b.angle = 0;
  const now = Date.now();
  b.lastMove = now; b.nextHit = now + 100000; b.nextTrade = now + 100000;
  b.ws = { send: (t) => { b.wsSent = (b.wsSent || []).concat([t]); } }; b.welcomed = true; b.passSentAt = now;
  c.queue.push({ type: 'message', message: { t: 33, idx: 20, refrId: 0xff000123, transform: { pos: [300, 100, 0], worldOrCell: 0x3c } } });
  c.queue.push({ type: 'message', message: { t: 33, idx: 21, refrId: 0x100000000 + 0x1981e, transform: { pos: [350, 0, 0], rot: [0, 0, 90], worldOrCell: 0x3c } } });
  c.queue.push({ type: 'message', message: { t: 33, idx: 22, refrId: 0xff000999, transform: { pos: [90000, 0, 0], worldOrCell: 0x3c } } });
  b.pump();
  yes('it keeps where the actors it is sent are, by idx', b.others.size === 3 && b.others.get(21).refrId === 0x100000000 + 0x1981e);
  b.nextHit = now; b.advance(now + 1);
  const anim = c.sent.find((x) => x.m.t === 3); const hit = c.sent.find((x) => x.m.t === 17);
  yes('a swing is an attack animation for its own idx, then an unarmed hit on the person in reach, both reliable',
    anim && anim.m.idx === 7 && anim.m.data.animEventName === 'attackStart' && anim.reliable === true &&
    hit && hit.m.data.aggressor === 0x14 && hit.m.data.source === 0x1f4 && hit.m.data.target === 0xff000123 && hit.reliable === true);
  yes('it swings at people only, never at an NPC or somebody out of reach', c.sent.filter((x) => x.m.t === 17).every((x) => x.m.data.target === 0xff000123));
  c.queue.push({ type: 'message', message: { t: 26, target: 0x100000000 + 0x1981e } });
  b.pump();
  yes('a HostStart for an actor it was sent is carried out', b.hosted.has(21) && b.played.hostStarts === 1);
  c.sent.length = 0;
  b.lastMove = now; b.advance(now + MOVE_MS + 2);
  const hosted = c.sent.find((x) => x.m.t === 2 && x.m.idx === 21);
  yes('the NPC it hosts is sent a move on the same beat, unreliable, standing where the server put it',
    c.sent.some((x) => x.m.t === 2 && x.m.idx === 7) && hosted && hosted.reliable === false && hosted.m.data.pos[0] === 350 && hosted.m.data.runMode === 'Standing' && hosted.m.data.rot[2] === 90);
  c.queue.push({ type: 'message', message: { t: 27, target: 0x100000000 + 0x1981e } });
  b.pump();
  yes('HostStop ends it', !b.hosted.has(21));
  b.nextTrade = now; b.advance(now + MOVE_MS + 3);
  yes('a trade ask is "/merchant <id>" for the nearest NPC, over the chat socket', (b.wsSent || []).some((t) => JSON.parse(t).text === '/merchant 1981e'));
  b.heard(JSON.stringify({ t: 'chat', from: 0, text: 'Trading with Belethor in Whiterun. Purse 100.' }));
  b.heard(JSON.stringify({ t: 'chat', from: 0, text: 'That is not a guild trader.' }));
  yes('the answers are counted by what they say', b.played.tradeOpened === 1 && b.played.notATrader === 1 && b.played.tradeAsks === 1);
  yes('the play counts of every worker add up', JSON.stringify(playCounts([{ play: { hits: 2 } }, { play: { hits: 3, tradeAsks: 1 } }, {}])) === '{"hits":5,"tradeAsks":1}');
  const w = new LoadBot(addon, { host: '127.0.0.1', port: 5000, name: 'w' });
  w.play = [];
  w.client = addon.createBotClient('127.0.0.1', 5000);
  addon.made[1].queue.push({ type: 'message', message: { t: 33, idx: 20, refrId: 0xff000123, transform: { pos: [1, 2, 3], worldOrCell: 0x3c } } });
  w.pump();
  yes('a bot that only walks keeps nobody\'s position', w.others.size === 0);
}

async function boxChecks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-4623-box-'));
  try {
    const inst = path.join(tmp, 'Thornswood-Server-Dev');
    fs.mkdirSync(path.join(inst, 'dist_back'), { recursive: true });
    fs.mkdirSync(path.join(inst, 'data'), { recursive: true });
    fs.mkdirSync(path.join(inst, 'world'), { recursive: true });
    fs.writeFileSync(path.join(inst, 'dist_back', 'skymp5-server.js'), '// the server');
    fs.writeFileSync(path.join(inst, 'scam_native.node'), 'engine');
    fs.writeFileSync(path.join(inst, 'package.json'), '{}');
    fs.writeFileSync(path.join(inst, 'gamemode.js'), '// the gamemode');
    fs.mkdirSync(path.join(inst, 'gamemode-tables'), { recursive: true });
    fs.writeFileSync(path.join(inst, 'gamemode-tables', 'ADMIN_ITEMS.json'), '[]');
    fs.writeFileSync(path.join(inst, 'world', 'someone.json'), '{}');
    for (const f of ['Skyrim.esm', 'JKs Skyrim.esp']) { fs.writeFileSync(path.join(inst, 'data', f), f); }
    fs.mkdirSync(path.join(inst, 'data', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(inst, 'data', 'scripts', 'MarkerScript.pex'), 'pex');
    fs.mkdirSync(path.join(inst, 'private'), { recursive: true });
    fs.writeFileSync(path.join(inst, 'private', 'merchant-ledger.json'), '{"version":1}');
    fs.writeFileSync(path.join(inst, 'private', 'merchant-ledger.initialized'), '1');
    fs.writeFileSync(path.join(inst, 'private', 'door.json'), '{"passKey":"theirs"}');
    const theirs = { port: 7787, dataDir: 'data', loadOrder: ['Skyrim.esm', 'JKs Skyrim.esp'], npcEnabled: true, npcSettings: { x: 1 },
      npcAllowCrimeFaction: true, npcAllowEssential: true, thornswoodNear: 3500, thornswoodHurtCare: true, thornswoodSite: 'https://example.invalid', discordWebhook: 'https://example.invalid/hook',
      thornswoodLoadOrderRefuse: 'https://not-a-switch', password: 'theirs' };
    fs.writeFileSync(path.join(inst, 'server-settings.json'), JSON.stringify(theirs));
    const out = path.join(tmp, 'copy');
    const r = server.fromInstalled({ from: inst, out, shape: 'crowd', seats: '50', port: '7797', 'voice-port': '7799' });
    const st = JSON.parse(fs.readFileSync(path.join(out, 'server-settings.json'), 'utf8'));
    yes('the copy names the server\'s plugins by their full paths, in order, and copies none',
      st.loadOrder.length === 2 && st.loadOrder[1] === path.join(inst, 'data', 'JKs Skyrim.esp').replace(/\\/g, '/') && !fs.existsSync(path.join(out, 'data', 'Skyrim.esm')));
    yes('it has a data folder of its own, for the manifest the engine writes there at start, holding only the scripts',
      fs.statSync(path.join(out, 'data')).isDirectory() && fs.readdirSync(path.join(out, 'data')).join(',') === 'scripts' && st.dataDir === 'data');
    yes('  and a copy of the server\'s Papyrus scripts, which the engine reads from data\\scripts, not a link to them',
      fs.readFileSync(path.join(out, 'data', 'scripts', 'MarkerScript.pex'), 'utf8') === 'pex' && !fs.lstatSync(path.join(out, 'data', 'scripts')).isSymbolicLink());
    yes('  and a copy of the server\'s merchant ledger and its first-start mark, which the NPC runtime will not start without',
      fs.readFileSync(path.join(out, 'private', 'merchant-ledger.json'), 'utf8') === '{"version":1}' && fs.readFileSync(path.join(out, 'private', 'merchant-ledger.initialized'), 'utf8') === '1' &&
      !fs.lstatSync(path.join(out, 'private', 'merchant-ledger.json')).isSymbolicLink() && fs.readdirSync(path.join(out, 'private')).sort().join(',') === 'door.json,merchant-ledger.initialized,merchant-ledger.json');
    yes('its crowd stands in the Frozen Hearth, among four kept traders, not at the engine\'s start point outside Whiterun',
      st.startPoints.length === 1 && st.startPoints[0].worldOrCell === '0x13814' && st.startPoints[0].pos.join(',') === '1890,160,0');
    yes('it keeps the server\'s NPC switch and its plain gameplay switches', st.npcEnabled === true && st.npcSettings.x === 1 && st.thornswoodNear === 3500 && st.thornswoodHurtCare === true);
    yes('  and lets in the NPCs the server lets in, guards, townsfolk and named traders among them (#5563)',
      st.npcAllowCrimeFaction === true && st.npcAllowEssential === true);
    yes('and nothing else of its settings: no site, no webhook, no password, no switch that holds an address',
      st.thornswoodSite === undefined && st.discordWebhook === undefined && st.password === undefined && st.thornswoodLoadOrderRefuse === undefined);
    yes('its own ports, seats, a dev name, the pass held, and a pass key of its own', st.port === 7797 && st.thornswoodVoicePort === 7799 && st.maxPlayers === 50 &&
      st.thornswoodServer === 'dev' && st.thornswoodRequirePass === true && /^[0-9a-f]{64}$/.test(JSON.parse(fs.readFileSync(path.join(out, 'private', 'door.json'), 'utf8')).passKey));
    yes('the server\'s program and gamemode are copied, its gamemode tables too, and not its world', fs.existsSync(path.join(out, 'dist_back', 'skymp5-server.js')) && fs.existsSync(path.join(out, 'gamemode.js')) &&
      fs.existsSync(path.join(out, 'gamemode-tables', 'ADMIN_ITEMS.json')) &&
      !fs.existsSync(path.join(out, 'world')) && /^[0-9a-f]{64}$/.test(r.engine));
    let err = '';
    try { server.fromInstalled({ from: inst, out: path.join(tmp, 'c2'), port: '7787', 'voice-port': '7799' }); } catch (e) { err = e.message; }
    yes('the server\'s own port is refused', /port 7787 is one .* uses/.test(err) && !fs.existsSync(path.join(tmp, 'c2')));
    err = '';
    try { server.fromInstalled({ from: inst, out: path.join(tmp, 'c3'), port: '7797', 'voice-port': '7788' }); } catch (e) { err = e.message; }
    yes('so is its resources port, as the engine works it out, for the copy\'s voice service too', /port 7788 is one/.test(err));
    err = '';
    try { server.fromInstalled({ from: inst, out: path.join(tmp, 'c5'), port: '7786', 'voice-port': '7799' }); } catch (e) { err = e.message; }
    yes('and a port whose resources port would be the server\'s game port', /port 7787 is one/.test(err));
    fs.unlinkSync(path.join(inst, 'data', 'JKs Skyrim.esp'));
    err = '';
    try { server.fromInstalled({ from: inst, out: path.join(tmp, 'c4'), port: '7797', 'voice-port': '7799' }); } catch (e) { err = e.message; }
    yes('a plugin its loadOrder names that is not there is refused, by name', /names JKs Skyrim\.esp in its loadOrder/.test(err));
    fs.writeFileSync(path.join(inst, 'data', 'JKs Skyrim.esp'), 'JKs Skyrim.esp');
    fs.rmSync(path.join(inst, 'data', 'scripts'), { recursive: true, force: true });
    err = '';
    try { server.fromInstalled({ from: inst, out: path.join(tmp, 'c6'), port: '7797', 'voice-port': '7799' }); } catch (e) { err = e.message; }
    yes('a server with no data\\scripts is refused, saying the engine reads its scripts there', /which the engine reads the Papyrus scripts from/.test(err));
    fs.mkdirSync(path.join(inst, 'data', 'scripts'), { recursive: true });
    fs.unlinkSync(path.join(inst, 'private', 'merchant-ledger.initialized'));
    err = '';
    try { server.fromInstalled({ from: inst, out: path.join(tmp, 'c7'), port: '7797', 'voice-port': '7799' }); } catch (e) { err = e.message; }
    yes('a server whose merchant ledger has no first-start mark is refused, and nothing is laid out', /merchant-ledger\.initialized, without which the NPC runtime does not start/.test(err) && !fs.existsSync(path.join(tmp, 'c7')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const answer = (body, code) => new Promise((ok) => {
    const srv = http.createServer((q, res) => { res.writeHead(code || 200); res.end(body); });
    srv.listen(0, '127.0.0.1', () => ok(srv));
  });
  const empty = await answer('{"now":0,"max":30}');
  const busy = await answer('{"now":2}');
  const odd = await answer('nothing');
  const url = (srv) => 'http://127.0.0.1:' + srv.address().port + '/online.json';
  try {
    yes('nobody on a watched server lets the run go on', (await someoneOn([url(empty)])) === '');
    yes('somebody on one stops it, saying how many and where', /^2 people are on http:\/\/127\.0\.0\.1:\d+\/online\.json, so the run stopped$/.test(await someoneOn([url(empty), url(busy)])));
    yes('one that gives no count stops it', /answered no count of people/.test(await someoneOn([url(odd)])));
    const gone = url(odd).replace(/:\d+\//, ':1/');
    yes('one that does not answer stops it', /could not be read .*nobody can say it is empty/.test(await someoneOn([gone])));
    // Load-Box.ps1, the box's half, stops before it lays anything out.
    const ps = require('child_process').spawnSync(process.platform === 'win32' ? 'where' : 'which', ['pwsh']);
    if (ps.status !== 0) {
      console.log('SKIP  Load-Box.ps1 under pwsh: there is no pwsh here');
    } else {
      const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'test-4623-ps-'));
      try {
        const box = path.join(BOT, 'Load-Box.ps1');
        // Not spawnSync: the stand-in servers it asks are in this process.
        const runBox = (extra) => new Promise((ok) => {
          require('child_process').execFile('pwsh', ['-NoProfile', '-File', box, '-Out', path.join(t2, 'out'), '-ServersRoot', t2].concat(extra), { encoding: 'utf8' },
            (e, stdout) => ok({ status: e ? e.code : 0, stdout: String(stdout) }));
        });
        let r = await runBox(['-Watch', url(empty)]);
        yes('Load-Box.ps1 stops when the server it would copy is not installed', r.status === 1 && /LOAD TEST STOPPED: there is no server installed at/.test(r.stdout));
        fs.mkdirSync(path.join(t2, 'Thornswood-Server-Dev'), { recursive: true });
        fs.writeFileSync(path.join(t2, 'Thornswood-Server-Dev', 'server-settings.json'), '{}');
        r = await runBox(['-Watch', url(empty) + ',' + url(busy)]);
        yes('and when somebody is on a server people play on, before it lays anything out',
          r.status === 1 && /LOAD TEST STOPPED: 2 on http/.test(r.stdout) && fs.readdirSync(t2).every((f) => !/^thornswood-load-/.test(f)));
        r = await runBox(['-Watch', url(odd)]);
        yes('and when one gives no count', r.status === 1 && /LOAD TEST STOPPED: .*has no "now" count|LOAD TEST STOPPED: .*could not be read/.test(r.stdout));
      } finally {
        fs.rmSync(t2, { recursive: true, force: true });
      }
    }
  } finally {
    for (const s2 of [empty, busy, odd]) { s2.close(); }
  }
}

function mathChecks() {
  const reading = (at, cpuUs, rss, up, upD, down, downD, busy, total) => ({ at, server: { at, user: cpuUs, system: 0, rss, heap: 0 }, proxy: { up, upDatagrams: upD, down, downDatagrams: downD }, cpu: { busy, total } });
  const a = reading(0, 0, 100 * 1048576, 0, 0, 0, 0, 0, 0);
  const b = reading(10000, 5e6, 150 * 1048576, 10000, 100, 50000, 500, 4000, 10000);
  const bots = [{ cpuMs: 2000, movesReadPerBot: [70, 80] }, { cpuMs: 1000, movesReadPerBot: [90] }];
  const w = windowOf(a, b, bots, 10);
  yes('cores are the server\'s CPU time over the samples\' own times (5 s in 10 s is 0.5)', Math.abs(w.serverCores - 0.5) < 1e-9);
  yes('memory is the working set at the end, in MB', w.serverRssMB === 150);
  yes('bytes on the wire add 28 a datagram (10,000 + 100 x 28 in 10 s up)', w.upWirePerS === 1280 && w.downWirePerS === 6400);
  yes('the runner\'s busy share and the bots\' cores are read', w.machineBusy === 0.4 && w.botCores === 0.3);
  yes('moves read are a second, per walking bot, with the fewest', w.movesReadPerBotPerS === 8 && w.fewestMovesReadPerS === 7);
  const base = { serverCores: 0.1, serverRssMB: 100 };
  const p = perPerson(w, base);
  yes('per person is against step 0: (0.5 - 0.1) / 10 cores, (150 - 100) / 10 MB', Math.abs(p.cores - 0.04) < 1e-9 && p.memoryMB === 5);
  yes('per person bandwidth is the wire bytes over the people, in KB/s', p.downKBps === 0.625 && p.upKBps === 0.125);
  yes('step 0 has no per person numbers', perPerson(Object.assign({}, w, { people: 0 }), base) === null);
  const md = markdown({ shape: 'crowd', started: 'now', engine: 'abc', blob: '0123456789abcdef', cores: 4, steps: [{ people: 10, window: w, perPerson: p }, { people: 20, stopped: 'the runner was 95% busy' }], problem: '' });
  yes('the summary has a row a step and says where it stopped', /\| 10 \| 0\.500 \| 150 \|/.test(md) && /Stopped at 20: the runner was 95% busy/.test(md));
}

function freePort() {
  return new Promise((ok, bad) => { const s = net.createServer(); s.on('error', bad); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function get(port, p) {
  return new Promise((ok, bad) => { http.get({ host: '127.0.0.1', port, path: p }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok(b)); }).on('error', bad); });
}

async function voiceChecks() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-4623-voice-'));
  let voice = null; let site = null; const said = [];
  try {
    site = await siteThatSaysYes();
    const port = await freePort();
    voice = await startVoice(tmp, port, site.url, path.join(BOT, 'load-sampler.js'), path.join(tmp, 'voice-samples.jsonl'), (l) => said.push(l));
    yes('the voice service from this checkout starts and listens', !!voice);
    const addon = fakeAddon();
    const b = new LoadBot(addon, { host: '127.0.0.1', port: 5000, name: 'v' });
    b.profileId = 1900000777; b.passKey = 'p'.repeat(64); b.server = 'dev'; b.voicePort = port;
    b.client = addon.createBotClient('127.0.0.1', 5000); b.step = 'moving'; b.voiceBy = Date.now() + 60000; b.character = { idx: 1 }; b.center = [0, 0, 0]; b.lastMove = Date.now();
    b.openVoice();
    for (let i = 0; i < 300 && !b.welcomed && b.step !== 'failed'; i++) { await sleep(20); }
    yes('it gets a token and the voice service welcomes its chat socket', b.welcomed && b.step === 'moving');
    let cmds = [];
    for (let i = 0; i < 100 && !cmds.length; i++) { cmds = JSON.parse(await get(port, '/commands')).commands || []; if (!cmds.length) { await sleep(20); } }
    const c = cmds[0] || {};
    const pass = String(c.text || '').replace(/^\/joinpass /, '');
    const parts = pass.split('.');
    const body = parts.length === 3 ? JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')) : {};
    yes('the gamemode\'s command queue holds "/joinpass <pass>" under the bot\'s own profile, its pass signed for that profile and server',
      cmds.length === 1 && /^\/joinpass jp1\./.test(c.text) && Number(c.profileId) === 1900000777 &&
      parts[2] === crypto.createHmac('sha256', 'p'.repeat(64)).update('jp1.' + parts[1]).digest('base64url') && body.p === 1900000777 && body.s === 'dev');
    yes('what the socket carried is counted both ways', b.wsUp > 0 && b.wsDown > 0);
    b.advance(Date.now() + 61000);
    let again = [];
    for (let i = 0; i < 100 && !again.length; i++) { again = JSON.parse(await get(port, '/commands')).commands || []; if (!again.length) { await sleep(20); } }
    yes('a minute on, a new pass goes the same way, as the front plugin sends one every minute', again.length === 1 && again[0].text !== c.text && /^\/joinpass jp1\./.test(again[0].text));
    b.fail('done');
  } finally {
    if (voice) { voice.kill(); await new Promise((r) => voice.once('exit', r)); }
    if (site) { site.server.close(); }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function serverChecks() {
  const crowd = server.startPoints('crowd');
  const spread = server.startPoints('spread');
  yes('crowd puts everybody at the engine\'s own start point outside Whiterun', crowd.length === 1 && crowd[0].pos[0] === 133857 && crowd[0].worldOrCell === '0x3c');
  yes('spread is 36 spots in Tamriel, 60,000 units apart', spread.length === 36 && new Set(spread.map((s) => s.pos.join(','))).size === 36 &&
    spread.every((s) => s.worldOrCell === '0x3c') && spread[1].pos[1] - spread[0].pos[1] === 60000);
  yes('the masters are the five the fork\'s build holds, by sha256', Object.keys(server.MASTERS).join(',') === 'Skyrim.esm,Update.esm,Dawnguard.esm,HearthFires.esm,Dragonborn.esm' &&
    server.MASTERS['Skyrim.esm'] === '9ec6b3818bbd002487bdc4104add07f814cc067e70c79ea2d164108a6c960f04');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-4623-'));
  try {
    const record = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'server-build.json'), 'utf8'));
    const dist = path.join(tmp, 'build');
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, 'server-build.json'), JSON.stringify({ sha256: '0'.repeat(64) }));
    let err = '';
    try { await server.build({ build: dist, masters: path.join(tmp, 'm'), out: path.join(tmp, 'out1') }); } catch (e) { err = e.message; }
    yes('a server build whose record is not the checkout\'s is refused', /records scam_native\.node as sha256 0{64}, and records\\server-build\.json holds/.test(err));
    fs.writeFileSync(path.join(dist, 'server-build.json'), JSON.stringify(record));
    for (const rel of Object.keys(record.files)) {
      fs.mkdirSync(path.dirname(path.join(dist, rel)), { recursive: true });
      fs.writeFileSync(path.join(dist, rel), 'not the build');
    }
    err = '';
    try { await server.build({ build: dist, masters: path.join(tmp, 'm'), out: path.join(tmp, 'out2') }); } catch (e) { err = e.message; }
    yes('a file that is not the one the record holds is refused, by name', /in the build is sha256 [0-9a-f]{64}, not the [0-9a-f]{64} records\\server-build.json holds/.test(err));
    // #5327, 2 Nov 2026: the load server had gamemode.js and not its tables
    // (game/gamemode-tables since #5280), so the gamemode stopped as it loaded.
    const game = path.join(tmp, 'game-out');
    fs.mkdirSync(game);
    server.copyGame(game);
    const tables = fs.readdirSync(path.join(ROOT, 'game', 'gamemode-tables')).filter((n) => n.endsWith('.json'));
    yes('the load server gets gamemode.js and every table of game/gamemode-tables beside it, byte for byte',
      tables.length > 0 && fs.readFileSync(path.join(game, 'gamemode.js')).equals(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'))) &&
      tables.every((n) => fs.readFileSync(path.join(game, 'gamemode-tables', n)).equals(fs.readFileSync(path.join(ROOT, 'game', 'gamemode-tables', n)))));
    const bare = path.join(tmp, 'bare');
    fs.mkdirSync(path.join(bare, 'game'), { recursive: true });
    fs.writeFileSync(path.join(bare, 'game', 'gamemode.js'), '// the gamemode');
    err = '';
    try { server.copyGame(path.join(tmp, 'game-out2'), bare); } catch (e) { err = e.message; }
    yes('a checkout with no gamemode tables is refused, by name, before anything is laid out', /no game\\gamemode-tables/.test(err) && !fs.existsSync(path.join(tmp, 'game-out2')));
    const fake = path.join(tmp, 'Skyrim.esm');
    fs.writeFileSync(fake, 'not Skyrim.esm');
    err = '';
    try { server.checkMaster(fake, 'Skyrim.esm'); } catch (e) { err = e.message; }
    yes('a master that is not the one the fork\'s build holds is refused, with its sha256', /^Skyrim\.esm is sha256 [0-9a-f]{64}, not the 9ec6b381/.test(err));
    err = '';
    try { server.checkMaster(path.join(tmp, 'Update.esm'), 'Update.esm'); } catch (e) { err = e.message; }
    yes('a master that is not there is refused, naming how to fetch it', /there is no .*Update\.esm \(pass --download yes/.test(err));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

(async () => {
  await proxyChecks();
  botChecks();
  playChecks();
  mathChecks();
  await voiceChecks();
  await serverChecks();
  await boxChecks();
  done();
})().catch((err) => { console.log('FAIL  ' + (err && err.stack || err)); fail++; done(); });
