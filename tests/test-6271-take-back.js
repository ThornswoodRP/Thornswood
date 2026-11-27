'use strict';
/*
  test-6271-take-back.js

      node tests/test-6271-take-back.js

  #6271, taking gold or a thing back out of a character, online or not.
  Patrick, 16 Nov 2026: with the trade log, ill-gotten gold is taken back
  instead of wiping. An admin asks on the hub; the game server that holds
  the character does it, because it holds the world in memory and writes
  it to its store, so an edit in the store would be written over.

  Two parts, each the real code:
    - the take back block in game\gamemode.js over a pretend engine: an ask
      takes what the character holds up to the count, not worn first, keeps
      every other field of a stack, marks the ask on the character in the
      same write, answers "already done" with what it took when asked
      again, refuses a character or record the server does not have, logs
      the take in the gold and trade log, and hands its answers to the site
      on its next turn, keeping them when the site cannot be asked;
    - a copy of the site on a port of the system's choosing: only an admin
      asks or reads the asks (a Loremaster, a Playtester and nobody
      cannot), an ask is held to its shape, a game server's turn needs the
      door key in its header, gets only its own server's asks, closes them
      with what it did, and each closed ask is one line in moderation.log.

  Nothing leaves the machine and every copy is under the temp folder.
*/
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');
const GM = read(path.join(ROOT, 'game', 'gamemode.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) return null;
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

// ---- the block, over a pretend engine ---------------------------------------
const BLOCK = slice(GM, '// ==== thornswood take back ====', '// ==== end thornswood take back ====');
yes('the take back block is in gamemode.js between its markers', !!BLOCK);

const SWORD = 0x12eb7, GOLD = 0xf;
const actors = {
  // Bjorn, logged off: two stacks of gold (one with a field of its own) and a worn sword and a loose one.
  0xff000001: { pid: 102, name: 'Bjorn', props: {}, inv: { entries: [
    { baseId: GOLD, count: 3000 }, { baseId: SWORD, count: 1, worn: true }, { baseId: SWORD, count: 1, health: 0.5 },
    { baseId: GOLD, count: 500, mark: 'kept' } ] } }
};
const writes = [];
const asked = [];
let siteSays = null;            // what the pretend site answers next
const ledgerRows = [];
const ctx = {
  console: { log: (...a) => { ctx.said.push(a.join(' ')); } },
  JSON, Math, Number, String, Object, Array, Date,
  setInterval: (fn, ms) => { ctx.intervals.push({ fn, ms }); return 1; },
  clearInterval: () => { },
  __thornswoodAskSite: (route, body, done) => { asked.push({ route, body: JSON.parse(JSON.stringify(body)) }); done(siteSays.why, siteSays.doc); },
  __thornswoodLedger: { takeBack: (actorId, record, n, by) => { ledgerRows.push({ actorId, record, n, by }); } },
  mp: {
    makeProperty: (name, opts) => { ctx.made.push({ name, opts }); },
    getActorsByProfileId: (pid) => Object.keys(actors).filter((k) => actors[k].pid === pid).map(Number),
    getIdFromDesc: (d) => ({ 'f:Skyrim.esm': GOLD, '12eb7:Skyrim.esm': SWORD })[d] || 0,
    get: (id, prop) => {
      const a = actors[id];
      if (!a) throw new Error('no actor');
      if (prop === 'inventory') return JSON.parse(JSON.stringify(a.inv));
      if (prop === 'appearance') return { name: a.name };
      return a.props[prop] === undefined ? null : JSON.parse(JSON.stringify(a.props[prop]));
    },
    set: (id, prop, v) => {
      writes.push({ id, prop });
      if (prop === 'inventory') actors[id].inv = JSON.parse(JSON.stringify(v));
      else actors[id].props[prop] = JSON.parse(JSON.stringify(v));
    }
  },
  said: [], intervals: [], made: []
};
ctx.globalThis = ctx;
vm.runInNewContext(BLOCK, ctx);
const T = ctx.__thornswoodTakeBack;
yes('the block puts its calls on globalThis and takes a turn every 30 seconds',
    !!T && typeof T.doAsk === 'function' && ctx.intervals.length === 1 && ctx.intervals[0].ms === 30000);
yes('its mark is a property only the server sees', ctx.made.length === 1 && ctx.made[0].name === 'thornswoodTakenBack' &&
    ctx.made[0].opts.isVisibleByOwner === false && ctx.made[0].opts.isVisibleByNeighbors === false);

const B = 0xff000001;
const goldOf = () => actors[B].inv.entries.filter((e) => e.baseId === GOLD).reduce((n, e) => n + e.count, 0);
let a = T.doAsk({ id: 'a1', pid: 102, record: 'f:Skyrim.esm', count: 3200, why: 'duped', byName: 'Patrick' });
yes('gold is taken from a logged-off character, across stacks', a.ok === true && a.took === 3200 && goldOf() === 300);
yes('a stack partly taken keeps its other fields', actors[B].inv.entries.some((e) => e.baseId === GOLD && e.count === 300 && e.mark === 'kept'));
yes('the pack and the mark are written together, on the character',
    writes.length === 2 && writes[0].prop === 'inventory' && writes[1].prop === 'thornswoodTakenBack' &&
    actors[B].props.thornswoodTakenBack.asks[0].id === 'a1' && actors[B].props.thornswoodTakenBack.asks[0].took === 3200);
yes('the take goes in the gold and trade log, with who asked', ledgerRows.length === 1 && ledgerRows[0].n === 3200 &&
    ledgerRows[0].record === 'f:Skyrim.esm' && ledgerRows[0].by === 'Patrick');
yes('and in thornswood.log', ctx.said.some((s) => /Patrick took back 3200 of 3200 f:Skyrim\.esm from Bjorn \(profile 102\): duped/.test(s)));

a = T.doAsk({ id: 'a1', pid: 102, record: 'f:Skyrim.esm', count: 3200, why: 'duped' });
yes('the same ask again takes nothing and answers done with what it took the first time',
    a.ok === true && a.took === 3200 && a.why === 'already done' && goldOf() === 300 && writes.length === 2);

a = T.doAsk({ id: 'a2', pid: 102, record: 'f:Skyrim.esm', count: 1000, why: 'more' });
yes('more than they hold takes what they hold and says so', a.ok === true && a.took === 300 && a.why === 'they held 300' && goldOf() === 0);

a = T.doAsk({ id: 'a3', pid: 102, record: '12eb7:Skyrim.esm', count: 1, why: 'duped sword' });
yes('a thing not worn goes before a worn one', a.took === 1 &&
    actors[B].inv.entries.filter((e) => e.baseId === SWORD).length === 1 &&
    actors[B].inv.entries.find((e) => e.baseId === SWORD).worn === true);
yes('a refused character is answered, not thrown', (() => {
  const r = T.doAsk({ id: 'a4', pid: 999, record: 'f:Skyrim.esm', count: 1, why: 'x' });
  return r.ok === false && /no character with profile 999/.test(r.why);
})());
yes('and so is a record the server does not know', (() => {
  const r = T.doAsk({ id: 'a5', pid: 102, record: 'abc:Nope.esp', count: 1, why: 'x' });
  return r.ok === false && /does not know the record abc:Nope\.esp/.test(r.why);
})());

// The turn.
siteSays = { why: '', doc: { waiting: [{ id: 'b1', pid: 102, record: '12eb7:Skyrim.esm', count: 1, why: 'w', byName: 'Patrick' }] } };
T.turn();
yes('a turn asks /api/takeback, does what waits, and holds the answer', asked.length === 1 && asked[0].route === '/api/takeback' &&
    T.answers().length === 1 && T.answers()[0].id === 'b1' && T.answers()[0].took === 1);
siteSays = { why: 'the site could not be reached', doc: null };
T.turn();
yes('a turn the site misses keeps the answers for the next', asked[1].body.done.length === 1 && T.answers().length === 1);
siteSays = { why: '', doc: { waiting: [{ id: 'b1', pid: 102, record: '12eb7:Skyrim.esm', count: 1, why: 'w' }] } };
T.turn();
yes('the next hands them over, and an ask the site still lists is answered from its mark, not taken again',
    asked[2].body.done.length === 1 && asked[2].body.done[0].id === 'b1' &&
    T.answers().length === 1 && T.answers()[0].why === 'already done' &&
    actors[B].inv.entries.filter((e) => e.baseId === SWORD).length === 0);

// ---- a copy of the site -------------------------------------------------------
const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-takeback-site-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const BOTKEY = crypto.randomBytes(16).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '511111111111111111';
const LORE_ID = '522222222222222222';
const TESTER_ID = '533333333333333333';
siteFiles.copy(sdir);
fs.mkdirSync(path.join(sdir, 'public'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site', 'public', 'index.html'), path.join(sdir, 'public', 'index.html'));
fs.mkdirSync(path.join(sdir, 'data'), { recursive: true });
fs.writeFileSync(path.join(sdir, 'data', 'roster.json'), JSON.stringify({ who: { 102: { name: 'Bjorn' } } }));
fs.writeFileSync(path.join(sdir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: 'harness-bot', guildId: GUILD, invite: '' },
  botKey: BOTKEY, admins: [], secret: SECRET, gameCheckPort: 1, onlineFile: path.join(sdir, 'online.json')
}, null, 2));
/* The stub test-3164-hold-economy.js loads ahead of the site. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r1', name: 'Owner' }, { id: 'r2', name: 'Loremaster' }, { id: 'r3', name: 'Playtester' }];
  const member = (id, name, roles) => ({ nick: name, roles: roles, user: { id: id, username: name.toLowerCase(), global_name: name } });
  const MEMBERS = [member(process.env.TS_STUB_OWNER, 'Owner', ['r1']), member(process.env.TS_STUB_LORE, 'Lore', ['r2']),
                   member(process.env.TS_STUB_TESTER, 'Tester', ['r3'])];
  function answer(where) {
    if (where === '/api/v10/guilds/' + GUILD) return { id: GUILD, name: 'Thornswood (harness)' };
    if (where === '/api/v10/guilds/' + GUILD + '/roles') return ROLES;
    if (where === '/api/v10/guilds/' + GUILD + '/members?limit=1000') return MEMBERS;
    return null;
  }
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); host = u.hostname; where = u.pathname + (u.search || ''); }
    else { host = String(a.hostname || a.host || ''); where = String(a.path || ''); }
    const req = new EventEmitter();
    let ended = false;
    req.setTimeout = () => req; req.destroy = () => { }; req.write = () => true;
    req.end = () => {
      if (ended) return;
      ended = true;
      const body = host === 'discord.com' ? answer(where) : null;
      setImmediate(() => {
        if (!body) { req.emit('error', new Error('the harness lets no request leave this machine')); return; }
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {}; res.setEncoding = () => { }; res.resume = () => { };
        if (cb) cb(res);
        res.emit('data', Buffer.from(JSON.stringify(body)));
        res.emit('end');
      });
    };
    return req;
  }
  https.request = fake;
  https.get = function (a, b, c) { const r = fake(a, b, c); r.end(); return r; };
}
fs.writeFileSync(path.join(sdir, 'stub.js'), '(' + stub.toString() + ')();\n');

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const cookieFor = (id, name) => {
  const at = Date.now();
  const raw = id + '|' + name + '|' + at + '|' + sign(id + '|' + name + '|' + at);
  return 'twa=' + encodeURIComponent(raw);
};
let PORT = 0;
function ask(method, where, headers, bodyText) {
  return new Promise((done) => {
    const data = bodyText === undefined ? null : Buffer.from(bodyText);
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { json = null; } done({ status: res.statusCode, body: text, json: json }); });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

(async () => {
  const srv = spawn(process.execPath, ['-r', path.join(sdir, 'stub.js'), 'server.js'], {
    cwd: sdir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(sdir, 'chat'),
      TS_STUB_GUILD: GUILD, TS_STUB_OWNER: OWNER_ID, TS_STUB_LORE: LORE_ID, TS_STUB_TESTER: TESTER_ID
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    let up = false;
    for (let i = 0; i < 200; i++) {
      if (siteFiles.saidPort(out)) { PORT = siteFiles.saidPort(out); up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);
    const origin = 'http://127.0.0.1:' + PORT;
    const asAdmin = { cookie: cookieFor(OWNER_ID, 'Owner'), 'content-type': 'application/json', origin: origin };
    const asLore = { cookie: cookieFor(LORE_ID, 'Lore'), 'content-type': 'application/json', origin: origin };
    const good = { server: 'main', profileId: 102, record: 'gold', count: 5000, why: 'duped through the trade bug' };

    let r = await ask('POST', '/api/staff/takeback', asLore, JSON.stringify(good));
    yes('a Loremaster, staff but not an admin, cannot ask (' + r.status + ')', r.status === 403);
    r = await ask('POST', '/api/staff/takeback', { cookie: cookieFor(TESTER_ID, 'Tester'), 'content-type': 'application/json', origin: origin }, JSON.stringify(good));
    yes('nor can a Playtester (' + r.status + ')', r.status === 401 || r.status === 403);
    r = await ask('POST', '/api/staff/takeback', asAdmin, JSON.stringify(Object.assign({}, good, { why: '' })));
    yes('an ask with no why is refused in words (' + r.status + ')', r.status === 400 && /say why/.test(r.json.error));
    r = await ask('POST', '/api/staff/takeback', asAdmin, JSON.stringify(Object.assign({}, good, { record: 'iron sword' })));
    yes('and so is a thing not named by its record', r.status === 400 && /record/.test(r.json.error));
    r = await ask('POST', '/api/staff/takeback', asAdmin, JSON.stringify(Object.assign({}, good, { count: -5 })));
    yes('and a count that is not a whole number above nothing', r.status === 400);
    r = await ask('POST', '/api/staff/takeback', asAdmin, JSON.stringify(good));
    yes('an admin\'s ask is kept, with the character\'s name, waiting (' + r.status + ')',
        r.status === 200 && r.json.row.state === 'waiting' && r.json.row.record === 'f:Skyrim.esm' &&
        r.json.row.name === 'gold' && r.json.row.whoName === 'Bjorn' && r.json.row.byName === 'Owner');
    const id = r.json.row.id;
    r = await ask('POST', '/api/staff/takeback', asAdmin, JSON.stringify(Object.assign({}, good, { server: 'dev', profileId: 7, record: '12eb7:Skyrim.esm', count: 1, name: 'Iron Sword' })));
    const devId = r.json.row.id;

    r = await ask('POST', '/api/takeback', { 'content-type': 'application/json', 'x-thornswood-key': 'wrong' }, JSON.stringify({ done: [] }));
    yes('a game server\'s turn without the door key is refused (' + r.status + ')', r.status === 401);
    const key = { 'content-type': 'application/json', 'x-thornswood-key': BOTKEY };
    r = await ask('POST', '/api/takeback', key, JSON.stringify({ done: [] }));
    yes('with it, the main server gets its own ask and not dev\'s',
        r.status === 200 && r.json.waiting.length === 1 && r.json.waiting[0].id === id && r.json.waiting[0].count === 5000 &&
        r.json.waiting[0].record === 'f:Skyrim.esm');
    r = await ask('POST', '/dev/api/takeback', key, JSON.stringify({ done: [{ id: id, ok: true, took: 5000 }] }));
    yes('the dev server cannot close main\'s ask, and gets its own', r.status === 200 &&
        r.json.waiting.length === 1 && r.json.waiting[0].id === devId);
    r = await ask('POST', '/api/takeback', key, JSON.stringify({ done: [{ id: id, ok: true, took: 4200, why: 'they held 4200' }] }));
    yes('the main server closes its ask with what it took, and nothing waits after', r.status === 200 && r.json.waiting.length === 0);
    r = await ask('POST', '/dev/api/takeback', key, JSON.stringify({ done: [{ id: devId, ok: false, took: 0, why: 'this server holds no character with profile 7' }] }));
    yes('the dev server closes its ask as not done, with why, and nothing waits after', r.status === 200 && r.json.waiting.length === 0);

    r = await ask('GET', '/api/staff/takeback', { cookie: cookieFor(OWNER_ID, 'Owner') });
    const rows = (r.json && r.json.rows) || [];
    const mine = rows.find((x) => x.id === id);
    yes('the admin reads the asks back with what each server did', r.status === 200 && mine && mine.state === 'done' &&
        mine.took === 4200 && rows.find((x) => x.id === devId).state === 'failed');
    r = await ask('GET', '/api/staff/takeback', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('a Loremaster cannot read them (' + r.status + ')', r.status === 403);

    let mod = [];
    try { mod = read(path.join(sdir, 'data', 'for-bot', 'moderation.log')).split('\n').filter(Boolean).map(JSON.parse); } catch (e) { mod = []; }
    const tb = mod.filter((m) => m.did === 'takeback' || m.did === 'takebackfailed');
    yes('each closed ask is one line in moderation.log for the staff channel, saying what was taken of what was asked and why',
        tb.length === 2 && tb[0].did === 'takeback' && tb[0].byName === 'Owner' && tb[0].whoName === 'Bjorn' && tb[0].who === 102 &&
        /^4200 of the 5000 gold asked, on the main server \(they held 4200\): duped through the trade bug$/.test(tb[0].why) &&
        tb[1].did === 'takebackfailed' && /no character with profile 7/.test(tb[1].why));
  } finally {
    if (srv.exitCode === null && srv.signalCode === null) { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); }
    fs.rmSync(sdir, { recursive: true, force: true });
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log('FAIL  the harness itself stopped: ' + String(e && e.stack || e).replace(/\n/g, '\n      '));
  process.exitCode = 1;
});
