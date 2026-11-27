'use strict';
/*
  test-6270-gold-ledger.js

      node tests/test-6270-gold-ledger.js

  #6270, the gold and trade log. Sura the Mad and Patrick, 15 Nov 2026:
  every trade and every move of gold between people, kept by Discord
  account, searchable by staff, with big moves flagged, so gold gained by
  cheating can be taken back instead of wiping.

  Three parts, each the real code:
    - the ledger block in game\gamemode.js over a pretend engine: a trade,
      a sale, gold taken, put and dropped become rows with each person's
      profile, name and account; 1000 gold or more handed to somebody is
      flagged and one line goes to moderation.log for the bot; a person's
      own stash back out of a chest is not flagged; nothing but gold is
      logged from the engine's events; the rows go to the site in one push
      with the door key, the dev server's to /dev, and stay when the site
      refuses them; and what it costs a move, timed;
    - by reading the files, that the trading block and the three engine
      handlers call it;
    - a copy of the site on a port of the system's choosing: a push is
      taken only with the door key, kept per server and day and held to its
      shape; staff search it by account, profile or name and by flag; a
      Playtester and nobody cannot; the hub page is a staff page; and the
      hourly sweep drops a day past 90.

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
const HUB = read(path.join(ROOT, 'site', 'public', 'hub.js'));
const PRIVACY = read(path.join(ROOT, 'site', 'data', 'site', 'privacy.md'));

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
const BLOCK = slice(GM, '// ==== thornswood ledger ====', '// ==== end thornswood ledger ====');
yes('the ledger block is in gamemode.js between its markers', !!BLOCK);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ledger-'));
const priv = path.join(dir, 'private');
const forBot = path.join(dir, 'for-bot');
fs.mkdirSync(priv, { recursive: true });

// Actors 1 to 3 are people (profiles 101 to 103); 50 is a chest, 60 a body
// of person 3 (a person's actor is its own body).
const ACTORS = {
  1: { pid: 101, name: 'Aela', cell: 'whiterun:Skyrim.esm' },
  2: { pid: 102, name: 'Bjorn', cell: 'whiterun:Skyrim.esm' },
  3: { pid: 103, name: 'Cato', cell: 'riften:Skyrim.esm' },
  50: { pid: 0, base: '10d:Skyrim.esm' }
};
const ACCOUNTS = { 101: '111111111111111111', 102: '222222222222222222' };
const pushes = [];
let answer = 200;
function makeContext(server) {
  const settings = { privDir: priv, forBotDir: forBot, thornswoodServer: server };
  fs.writeFileSync(path.join(priv, 'door.json'),
    JSON.stringify({ site: server === 'dev' ? 'https://thornswood.net/dev' : 'https://thornswood.net', key: 'door-key' }));
  const ctx = {
    console: { log: (...a) => { ctx.said.push(a.join(' ')); } },
    Buffer, URL, JSON, Math, Number, String, Object, Array, Date,
    require: (name) => {
      if (name === 'https') {
        return {
          request: (opts, cb) => {
            const rec = { opts: opts, body: '' };
            pushes.push(rec);
            return { on: () => { }, end: (b) => { rec.body = String(b || ''); cb({ statusCode: answer, resume: () => { } }); }, destroy: () => { } };
          }
        };
      }
      return require(name);
    },
    setInterval: (fn, ms) => { ctx.intervals.push({ fn, ms }); return ctx.intervals.length; },
    clearInterval: () => { },
    __thornswoodAccountOf: (pid) => ACCOUNTS[pid] || '',
    mp: {
      getServerSettings: () => settings,
      get: (id, prop) => {
        const a = ACTORS[id];
        if (!a) throw new Error('no form ' + id);
        if (prop === 'profileId') return a.pid;
        if (prop === 'appearance') return a.name ? { name: a.name } : null;
        if (prop === 'worldOrCellDesc') return a.cell || '';
        if (prop === 'baseDesc') return a.base || '';
        return null;
      },
      getDescFromId: (id) => ({ 0x12eb7: '12eb7:Skyrim.esm', 0xf: 'f:Skyrim.esm' })[id] || ''
    },
    said: [], intervals: []
  };
  ctx.globalThis = ctx;
  return ctx;
}

let ctx = makeContext('main');
vm.runInNewContext(BLOCK, ctx);
let L = ctx.__thornswoodLedger;
yes('the block puts its calls on globalThis and pushes every 15 seconds',
    !!L && typeof L.trade === 'function' && typeof L.gold === 'function' &&
    ctx.intervals.length === 1 && ctx.intervals[0].ms === 15000);
const modlog = () => { try { return read(path.join(forBot, 'moderation.log')).split('\n').filter(Boolean).map(JSON.parse); } catch (e) { return []; } };

// A trade.
let r = L.trade('trade', 1, 2, { gold: 50, items: [{ id: 0x12eb7, c: 1, n: 'Iron Sword' }] }, { gold: 0, items: [] });
yes('a trade is a row: both people by profile, name and account, what each gave, and where',
    r.kind === 'trade' && r.from.pid === 101 && r.from.name === 'Aela' && r.from.account === ACCOUNTS[101] &&
    r.to.pid === 102 && r.to.account === ACCOUNTS[102] && r.gold === 50 &&
    r.things.length === 1 && r.things[0].desc === '12eb7:Skyrim.esm' && r.things[0].n === 'Iron Sword' &&
    r.backGold === 0 && r.where === 'whiterun:Skyrim.esm' && r.server === 'main' && r.flagged === false);
yes('a small trade is not flagged and tells the staff channel nothing', modlog().length === 0);
r = L.trade('trade', 1, 2, { gold: 0, items: [] }, { gold: 1000, items: [] });
const ml = modlog();
yes('1000 gold handed over in a trade is flagged', r.flagged === true);
yes('and one line in moderation.log says who handed how much to whom, with the accounts, as did gold',
    ml.length === 1 && ml[0].did === 'gold' && ml[0].server === 'main' &&
    /Bjorn \(profile 102, account 222222222222222222\) handed 1000 gold to Aela \(profile 101, account 111111111111111111\) in a trade/.test(ml[0].why));
r = L.trade('halftrade', 1, 2, { gold: 5, items: [] }, { gold: 0, items: [] });
yes('a trade that went only half through is always flagged', r.flagged === true && modlog().length === 2 &&
    /only half through/.test(modlog()[1].why));
r = L.trade('sale', 1, 3, { gold: 0, items: [{ id: 0x12eb7, c: 2, n: 'Iron Sword' }] }, { gold: 30, items: [] });
yes('a sale to the company is a row with the gold that came back', r.kind === 'sale' && r.backGold === 30 && r.to.account === '');
yes('a kind it does not take is refused', L.trade('gift', 1, 2, { gold: 5 }, {}) === null);

// Gold through the engine's events.
yes('nothing but gold is logged from the engine\'s events', L.gold('take', 1, 0x12eb7, 1, 50) === null);
yes('and no count is no row', L.gold('take', 1, 0xf, 0, 50) === null);
r = L.gold('put', 2, 0xf, 5000, 50);
yes('gold put in a chest is a row from the person to nobody, naming the chest', r.kind === 'put' && r.from.pid === 102 &&
    r.to === null && r.gold === 5000 && /10d:Skyrim\.esm/.test(r.source) && r.flagged === false);
r = L.gold('take', 2, 0xf, 5000, 50);
yes('the same person taking it back out is not flagged: it was their own stash', r.flagged === false && r.to.pid === 102);
r = L.gold('take', 1, 0xf, 2000, 50);
yes('somebody else taking 2000 out of it is flagged', r.flagged === true && r.to.pid === 101 && r.from === null);
r = L.gold('take', 1, 0xf, 1500, 3);
yes('gold off a person\'s body names that person as where it came from, and is flagged',
    r.from && r.from.pid === 103 && r.source === 'the body of Cato' && r.flagged === true);
r = L.gold('drop', 3, 0xf, 1200, 0);
yes('1000 gold or more dropped on the ground is flagged at the drop, because the pickup has no count (#6272)',
    r.kind === 'drop' && r.source === 'the ground' && r.flagged === true &&
    /dropped 1200 gold on the ground/.test(modlog()[modlog().length - 1].why));
yes('nothing in a flag line pings anybody or uses an em dash', modlog().every((l) => !/@everyone|<@/.test(l.why) && l.why.indexOf('—') < 0));

// The push.
const held = L.pending();
answer = 500;
L.push();
yes('a refused push keeps every row for the next', pushes.length === 1 && L.pending() === held &&
    ctx.said.some((s) => /did not take \d+ rows; they are kept/.test(s)));
answer = 200;
L.push();
const sent = JSON.parse(pushes[1].body);
yes('a taken push goes to /api/ledger with the door key, the server and the rows, and they leave memory',
    pushes[1].opts.path === '/api/ledger' && sent.key === 'door-key' && sent.server === 'main' &&
    sent.rows.length === held && L.pending() === 0);
L.push();
yes('and nothing is sent when there is nothing to send', pushes.length === 2);

// The dev server's goes to /dev.
ctx = makeContext('dev');
vm.runInNewContext(BLOCK, ctx);
ctx.__thornswoodLedger.trade('trade', 1, 2, { gold: 1 }, { gold: 2 });
ctx.__thornswoodLedger.push();
yes('the dev server\'s rows go to /dev/api/ledger as dev\'s',
    pushes[2].opts.path === '/dev/api/ledger' && JSON.parse(pushes[2].body).server === 'dev');

// The load test's copy of dev has no site (#4623): it builds the push, says
// its size in its log, and keeps nothing.
ctx = makeContext('dev');
fs.writeFileSync(path.join(priv, 'door.json'), JSON.stringify({ passKey: 'p' }));
vm.runInNewContext(BLOCK, ctx);
for (let i = 0; i < 7; i++) ctx.__thornswoodLedger.trade('trade', 1, 2, { gold: 3 }, { gold: 4 });
ctx.__thornswoodLedger.push();
const sizeLine = ctx.said.find((s) => /no site in door\.json to send to: a push would be 7 rows, \d+ bytes, built in \d+ ms; they are not kept/.test(s));
yes('a server with no site says the push it would send, rows and bytes, and keeps nothing',
    !!sizeLine && pushes.length === 3 && ctx.__thornswoodLedger.pending() === 0);
ctx.__thornswoodLedger.trade('trade', 1, 2, { gold: 'x\nfake line' }, { gold: 4 });
yes('a log line never breaks into two', ctx.said.every((s) => s.indexOf('\n') < 0));

// What a move costs the game server's loop.
ctx = makeContext('main');
vm.runInNewContext(BLOCK, ctx);
L = ctx.__thornswoodLedger;
const N = 20000;
const t0 = process.hrtime.bigint();
for (let i = 0; i < N; i++) L.gold('take', 1, 0xf, 10, 50);
const perMoveUs = Number(process.hrtime.bigint() - t0) / 1000 / N;
console.log('      one gold move costs ' + perMoveUs.toFixed(2) + ' microseconds on this machine (' + N + ' timed)');
yes('a gold move costs the server well under a tenth of a millisecond (' + perMoveUs.toFixed(2) + ' us)', perMoveUs < 100);

// ---- the callers --------------------------------------------------------------
const TRADE = read(path.join(ROOT, 'game', 'gamemode', 'trade.ts'));
const CUFFS = read(path.join(ROOT, 'game', 'gamemode', 'cuffs.ts'));
yes('the trading block logs a trade, a half trade, a sale and a half sale',
    /ledger\('trade', t\.a, t\.b/.test(TRADE) && (TRADE.match(/ledger\('halftrade'/g) || []).length === 2 &&
    /ledger\('sale', seller, worker/.test(TRADE));
yes('onTakeItem, onPutItem and onDropItem log gold', /ledgerTake\.gold\('take'/.test(CUFFS) &&
    /ledgerPut\.gold\('put'/.test(CUFFS) && /ledgerDrop\.gold\('drop'/.test(CUFFS));
yes('the privacy page says what the log keeps, who sees it and its 90 days',
    /\*\*Gold and trades\.\*\*/.test(PRIVACY) && /\*\*Gold and trades\*\*, each one above, are kept for 90 days/.test(PRIVACY) &&
    /the gold and trade log and the\s+gallery queue/.test(PRIVACY));
yes('the hub has a Gold and trades page that asks the site on each search',
    /'\/ledger':'ledger'/.test(HUB) && /function drawLedger/.test(HUB) && /'\/api\/ledger\?server='/.test(HUB));

// ---- a copy of the site -------------------------------------------------------
const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-ledger-site-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const BOTKEY = crypto.randomBytes(16).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '411111111111111111';
const LORE_ID = '422222222222222222';
const TESTER_ID = '433333333333333333';
siteFiles.copy(sdir);
fs.mkdirSync(path.join(sdir, 'public'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site', 'public', 'index.html'), path.join(sdir, 'public', 'index.html'));
fs.mkdirSync(path.join(sdir, 'data'), { recursive: true });
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
const asJson = { 'content-type': 'application/json' };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const dayOf = (t) => { const d = new Date(t); const two = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); };

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

    const now = Date.now();
    const rows = [
      { at: now - 2000, kind: 'trade', from: { pid: 101, name: 'Aela', account: '111111111111111111' },
        to: { pid: 102, name: 'Bjorn', account: '222222222222222222' }, gold: 5000, things: [],
        backGold: 0, backThings: [{ n: 'Iron Sword', desc: '12eb7:Skyrim.esm', c: 1 }], where: 'whiterun:Skyrim.esm', flagged: true,
        key: 'not kept', extra: 'not kept' },
      { at: now - 1000, kind: 'take', from: null, to: { pid: 103, name: 'Cato', account: '' }, gold: 20, things: [],
        source: '0x32 (10d:Skyrim.esm)', where: 'riften:Skyrim.esm', flagged: false },
      { at: now, kind: 'steal', from: { pid: 1, name: 'X' }, gold: 5 },
      { at: now, kind: 'take', from: null, to: null, gold: 5 },
      { at: now, kind: 'drop', from: { pid: 104, name: 'Dagny' }, to: null, gold: -3 }
    ];
    let r = await ask('POST', '/api/ledger', asJson, JSON.stringify({ key: 'wrong', rows: rows }));
    yes('a push without the door key is refused (' + r.status + ')', r.status === 401);
    r = await ask('POST', '/api/ledger', asJson, JSON.stringify({ key: BOTKEY, server: 'main', rows: rows }));
    yes('a push with it is taken, and only the two real rows are kept (' + r.status + ')',
        r.status === 200 && r.json && r.json.server === 'main' && r.json.kept === 2);
    r = await ask('POST', '/dev/api/ledger', asJson, JSON.stringify({ key: BOTKEY, rows: [
      { at: now, kind: 'trade', from: { pid: 901, name: 'Devin', account: '111111111111111111' }, to: { pid: 902, name: 'Tess' }, gold: 3 }] }));
    yes('the dev server\'s, on /dev, is kept as dev\'s (' + r.status + ')', r.status === 200 && r.json && r.json.server === 'dev');

    const mainFile = path.join(sdir, 'data', 'ledger', 'main-' + dayOf(now) + '.jsonl');
    const kept = fs.existsSync(mainFile) ? read(mainFile).split('\n').filter(Boolean).map(JSON.parse) : [];
    yes('kept one file a server a day, a row a line, held to its shape with no key or anything else',
        kept.length === 2 && fs.existsSync(path.join(sdir, 'data', 'ledger', 'dev-' + dayOf(now) + '.jsonl')) &&
        !/"key"|"extra"|not kept/.test(read(mainFile)) && kept[0].from.account === '111111111111111111');

    const staff = { cookie: cookieFor(LORE_ID, 'Lore') };
    r = await ask('GET', '/api/ledger?server=main&q=111111111111111111', staff);
    yes('staff find a row by the Discord account on either side (' + r.status + ')',
        r.status === 200 && r.json.rows.length === 1 && r.json.rows[0].gold === 5000 && r.json.keepDays === 90);
    r = await ask('GET', '/api/ledger?server=main&q=103', staff);
    yes('by a profile number', r.json && r.json.rows.length === 1 && r.json.rows[0].to.name === 'Cato');
    r = await ask('GET', '/api/ledger?server=main&q=bjo', staff);
    yes('by part of a character\'s name, whatever the case', r.json && r.json.rows.length === 1 && r.json.rows[0].to.name === 'Bjorn');
    r = await ask('GET', '/api/ledger?server=main', staff);
    yes('nothing typed finds everything, newest first', r.json && r.json.rows.length === 2 && r.json.rows[0].kind === 'take');
    r = await ask('GET', '/api/ledger?server=main&flagged=1', staff);
    yes('flagged only finds the flagged ones', r.json && r.json.rows.length === 1 && r.json.rows[0].flagged === true);
    r = await ask('GET', '/api/ledger?server=dev&q=111111111111111111', staff);
    yes('each server is searched apart', r.json && r.json.rows.length === 1 && r.json.rows[0].from.name === 'Devin');
    r = await ask('GET', '/api/ledger?server=main', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('a Playtester cannot read it (' + r.status + ')', r.status === 401 || r.status === 403);
    r = await ask('GET', '/api/ledger?server=main');
    yes('and nor can nobody at all (' + r.status + ')', r.status === 401);
    r = await ask('GET', '/api/all', staff);
    yes('the hub tells staff the Gold and trades page is a staff page', r.json && r.json.level && r.json.level.ledger === 'staff');
    r = await ask('GET', '/ledger', {});
    yes('and /ledger is the hub page (' + r.status + ')', r.status === 200 && /<script src="\/hub\.js"><\/script>/.test(r.body));
  } finally {
    if (srv.exitCode === null && srv.signalCode === null) { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); }
  }

  // The hourly sweep, run against the copy's files.
  const oldDay = dayOf(Date.now() - 95 * 86400000);
  const youngDay = dayOf(Date.now() - 80 * 86400000);
  fs.writeFileSync(path.join(sdir, 'data', 'ledger', 'main-' + oldDay + '.jsonl'), '{}\n');
  fs.writeFileSync(path.join(sdir, 'data', 'ledger', 'dev-' + youngDay + '.jsonl'), '{}\n');
  const cwd = process.cwd();
  process.chdir(sdir);
  let gone = -1;
  try {
    const lib = require(path.join(sdir, 'lib', 'ledger.js'));
    gone = lib.sweepLedger(Date.now());
  } catch (e) { console.log('      the sweep threw: ' + e.message); }
  process.chdir(cwd);
  yes('the sweep deletes a day file past 90 days and keeps one inside them',
      gone === 1 && !fs.existsSync(path.join(sdir, 'data', 'ledger', 'main-' + oldDay + '.jsonl')) &&
      fs.existsSync(path.join(sdir, 'data', 'ledger', 'dev-' + youngDay + '.jsonl')));
  yes('and the hourly sweep runs it', /ledger: sweepLedger\(now\)/.test(read(path.join(ROOT, 'site', 'lib', 'retention.js'))));

  fs.rmSync(sdir, { recursive: true, force: true });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log('FAIL  the harness itself stopped: ' + String(e && e.stack || e).replace(/\n/g, '\n      '));
  process.exitCode = 1;
});
