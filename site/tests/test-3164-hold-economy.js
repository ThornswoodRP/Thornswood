'use strict';
/*
  test-3164-hold-economy.js

      node site/tests/test-3164-hold-economy.js

  #3164, staff's view of what each hold gathers, crafts and trades. Patrick,
  22 Oct 2026, on his report page: it is a staff page on the hub. Items have
  no gold price here, so it counts pieces.

  Three halves, each the real code:
    - the hold economy block in game\gamemode.js, run over a pretend engine:
      which hold a yield, a craft, a trade and a haul is counted in, the item
      named off the generated name tables, the file it keeps (30 days, the
      shape held on the way in), a reload that keeps the counts, and the push
      to the site the roster's way, the dev server's to /dev;
    - by reading the files, that every yield beside a creditWork counts
      itself, that a craft the bench allowed is counted after mp.onCraft, that
      a confirmed haul and a guild trade are counted, and that the merchant
      bundle in gamemode.js carries the trade hook;
    - a copy of site\server.js on a spare port, with a stub standing in for
      Discord: the game server's push is taken only with the door key, kept
      per server, aged and held to its shape, and read back only by staff;
      and the hub page draws the Hold economy page for staff.

  Nothing leaves the machine and every copy is under the temp folder.
*/
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');
const GM = read(path.join(ROOT, 'game', 'gamemode.js'));
const MERCHANT = read(path.join(ROOT, 'game', 'merchant-trading.js'));
const SERVER = siteFiles.source();
const HUB = read(path.join(ROOT, 'site', 'public', 'hub.js'));
const CSS = read(path.join(ROOT, 'site', 'public', 'hub.css'));
const README = read(path.join(ROOT, 'site', 'README.md'));
const DATA = JSON.parse(read(path.join(ROOT, 'game', 'data', 'data.json')));

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
function dayOf(t) {
  const d = new Date(t);
  const two = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate());
}
const TODAY = dayOf(Date.now());

// ---- the block, over a pretend engine ---------------------------------------
const BLOCK = slice(GM, '// ==== thornswood hold economy ====', '// ==== end thornswood hold economy ====');
yes('the hold economy block is in gamemode.js between its markers', !!BLOCK);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-economy-'));
const priv = path.join(dir, 'private');
fs.mkdirSync(priv, { recursive: true });

// The places the pretend people stand, and what holdAt and the came-in record
// answer for them (the real holdAt is the respawn's; its own harnesses hold it).
const ACTORS = {
  1: { desc: '580a2:Skyrim.esm', pos: [0, 0, 0] },          // a Whiterun room
  2: { desc: '800:Dragonborn.esm', pos: [10, 10, 0] },      // Solstheim
  3: { desc: 'blackreach:Skyrim.esm', pos: [0, 0, 0] },     // own world, came in from the Reach
  4: { desc: 'nowhere:Skyrim.esm', pos: [0, 0, 0] },        // nothing known
  5: { desc: 'aroom:Skyrim.esm', pos: [0, 0, 0] }           // a room no hold names, walked in from the Rift
};
const HOLD_AT = { '580a2:skyrim.esm': 'WhiterunHoldLocation' };
const CAME_IN = {
  3: { world: 'blackreach:Skyrim.esm', hold: 'ReachHoldLocation', lastHold: 'PaleHoldLocation' },
  5: { world: '', hold: null, lastHold: 'RiftHoldLocation' }
};
const FORMS = { 0x5ace4: '5ace4:Skyrim.esm', 0x71cf3: '71cf3:Skyrim.esm' };

const timers = { timeouts: [], intervals: [] };
// A timeout that has run is gone, as a real one is.
function fire(t) {
  const i = timers.timeouts.indexOf(t);
  if (i >= 0) timers.timeouts.splice(i, 1);
  t.fn();
}
const pushes = [];
function makeContext(server, site) {
  fs.writeFileSync(path.join(dir, 'server-settings.json'),
    JSON.stringify({ privDir: priv, thornswoodServer: server }));
  if (site) fs.writeFileSync(path.join(priv, 'door.json'), JSON.stringify({ site: site, key: 'door-key' }));
  return {
    console: { log: (...a) => { ctx.said.push(a.join(' ')); } },
    Buffer, URL, JSON, Math, Number, String, Object, Array, Date,
    require: (name) => {
      if (name === 'https') {
        return {
          request: (opts, cb) => {
            const rec = { opts: opts, body: '' };
            pushes.push(rec);
            return { on: () => { }, end: (b) => { rec.body = String(b || ''); cb({ statusCode: 200, resume: () => { } }); }, destroy: () => { } };
          }
        };
      }
      return require(name);
    },
    setTimeout: (fn, ms) => { const t = { fn: fn, ms: ms }; timers.timeouts.push(t); return t; },
    clearTimeout: (t) => { const i = timers.timeouts.indexOf(t); if (i >= 0) timers.timeouts.splice(i, 1); },
    setInterval: (fn, ms) => { const t = { fn: fn, ms: ms }; timers.intervals.push(t); return t; },
    clearInterval: (t) => { const i = timers.intervals.indexOf(t); if (i >= 0) timers.intervals.splice(i, 1); },
    holdAt: (place) => HOLD_AT[String(place.desc).toLowerCase()] || null,
    cameInOf: (id) => CAME_IN[id] || null,
    ITEM_NAMES: { 'iron ingot': ['Iron Ingot', '5ace4:Skyrim.esm'], 'wheat': ['Wheat', '4b0ba:Skyrim.esm'] },
    ADMIN_ITEMS: { 'iron ore': ['Iron Ore', '71cf3:Skyrim.esm'], 'other ingot': ['Not This Name', '5ace4:Skyrim.esm'] },
    mp: {
      get: (id, prop) => {
        const a = ACTORS[id];
        if (!a) throw new Error('no actor ' + id);
        if (prop === 'worldOrCellDesc') return a.desc;
        if (prop === 'pos') return a.pos;
        return null;
      },
      getDescFromId: (id) => FORMS[id] || '',
      writeFileWhole: (file, text) => { fs.writeFileSync(file, text); }
    },
    said: []
  };
}

const old = new Date(Date.now() - 45 * 86400000);
fs.writeFileSync(path.join(priv, 'hold-economy.json'), JSON.stringify({
  days: {
    [dayOf(old.getTime())]: { whiterun: { gathered: { 'iron ore': 9 } } },
    [TODAY]: {
      whiterun: { gathered: { wheat: 2, junk: -4, half: 1.5 }, stolen: { 'iron ore': 1 } },
      atlantis: { gathered: { wheat: 7 } }
    },
    'not a day': { whiterun: { gathered: { wheat: 1 } } }
  },
  names: { wheat: 'Wheat' }
}));

let ctx = makeContext('main', 'https://thornswood.net');
const cwd = process.cwd();
process.chdir(dir);
try {
  vm.runInNewContext(BLOCK, Object.assign(ctx, { globalThis: ctx }));
} finally { process.chdir(cwd); }
let E = ctx.__thornswoodEconomy;
yes('the block puts its calls on globalThis', !!E && typeof E.note === 'function' &&
    typeof E.traded === 'function' && typeof E.hauled === 'function' && typeof E.holdOf === 'function');

let snap = E.snapshot();
yes('the file it reads is held to its shape: a day past the 30 kept, a bad count, a kind or a hold nobody has and a day that is no date are left out',
    JSON.stringify(Object.keys(snap.days)) === JSON.stringify([TODAY]) &&
    JSON.stringify(snap.days[TODAY]) === JSON.stringify({ whiterun: { gathered: { wheat: 2 } } }));
yes('and it keeps 30 days', snap.keepDays === 30);

// Where each is counted.
yes('a room is the hold holdAt names', E.holdOf(1) === 'whiterun');
yes('Solstheim\'s worldspace is Raven Rock', E.holdOf(2) === 'ravenrock');
yes('a worldspace of its own is the hold of the door they came into it by', E.holdOf(3) === 'markarth');
yes('a room no hold names is the last hold they stood in', E.holdOf(5) === 'riften');
yes('and nothing known at all is counted under elsewhere, never dropped', E.holdOf(4) === 'elsewhere');
yes('every hold record the block maps is one data.json has, and all ten are mapped',
    (() => {
      const m = /var OF_LOCATION = \{([\s\S]*?)\};/.exec(BLOCK);
      if (!m) return false;
      const keys = (m[1].match(/(\w+): '/g) || []).map((s) => s.slice(0, -3));
      return keys.length === 10 && keys.every((k) => Object.prototype.hasOwnProperty.call(DATA.holds, k)) &&
        Object.keys(DATA.holds).every((k) => keys.indexOf(k) >= 0);
    })());

// A yield.
yes('a yield is counted', E.note('gathered', 1, '71cf3:Skyrim.esm', 3) === true);
E.note('gathered', 1, '71cf3:skyrim.esm', 2);
E.note('gathered', 1, '4b0ba:Skyrim.esm', 1);
snap = E.snapshot();
yes('under its name, off the first table that names the record, whatever case the record was written in',
    snap.days[TODAY].whiterun.gathered['iron ore'] === 5 && snap.names['iron ore'] === 'Iron Ore');
yes('and added to what the file already held', snap.days[TODAY].whiterun.gathered.wheat === 3);
yes('a count that is not a whole number above nothing is refused',
    E.note('gathered', 1, '71cf3:Skyrim.esm', 0) === false && E.note('gathered', 1, '71cf3:Skyrim.esm', -2) === false &&
    E.note('gathered', 1, '71cf3:Skyrim.esm', 'x') === false);
yes('and so is a kind the note does not take', E.note('sold', 1, '71cf3:Skyrim.esm', 1) === false);
E.note('gathered', 4, 'abc:Unknown.esp', 1);
snap = E.snapshot();
yes('a record neither table names is counted under the record itself',
    snap.days[TODAY].elsewhere.gathered['abc:unknown.esp'] === 1 && snap.names['abc:unknown.esp'] === 'abc:Unknown.esp');

// A craft.
E.note('crafted', 2, 0x5ace4, 4);
E.note('crafted', 3, 0xff000123, 1);
snap = E.snapshot();
yes('a craft by form id is named from the record (ITEM_NAMES first, so Iron Ingot)',
    snap.days[TODAY].ravenrock.crafted['iron ingot'] === 4 && snap.names['iron ingot'] === 'Iron Ingot');
yes('a brew or an enchantment, a form only that run has, is counted as one',
    snap.days[TODAY].markarth.crafted['a brew or an enchanted piece'] === 1);

// Trades and hauls.
E.traded({ hold: 'riften', verb: 'sell', baseId: 0x5ace4, name: 'Iron Ingot', count: 2 });
E.traded({ hold: 'riften', verb: 'supply', baseId: 0x5ace4, name: 'Iron Ingot', count: 5 });
E.traded({ hold: 'riften', verb: 'buy', baseId: 0x12345, name: 'Free Salt', count: 1 });
yes('a verb that is not a trade is refused', E.traded({ hold: 'riften', verb: 'steal', baseId: 0x5ace4, count: 1 }) === false);
E.traded({ hold: 'no hold', verb: 'buy', baseId: 0x5ace4, name: 'Iron Ingot', count: 1 });
snap = E.snapshot();
yes('pieces sold or supplied to a trader are sold, in the trader\'s hold',
    snap.days[TODAY].riften.sold['iron ingot'] === 7);
yes('pieces bought from one are bought, named by the trader when no table names the record',
    snap.days[TODAY].riften.bought['free salt'] === 1 && snap.names['free salt'] === 'Free Salt');
yes('a trader with no hold is counted under elsewhere', snap.days[TODAY].elsewhere.bought['iron ingot'] === 1);
E.hauled('whiterun', 'Riften');
E.hauled('whiterun', 'riften');
yes('a haul to a hold that is not one of the ten is refused', E.hauled('whiterun', 'atlantis') === false);
snap = E.snapshot();
yes('a haul is counted for the hold it left, under the hold it went to', snap.days[TODAY].whiterun.hauled.riften === 2);

// Saved a minute after the first change, whole.
const save = timers.timeouts.filter((t) => t.ms === 60000);
yes('one save waits a minute after the changes, however many there were', save.length === 1);
fire(save[0]);
let onDisk = null;
try { onDisk = JSON.parse(fs.readFileSync(path.join(priv, 'hold-economy.json'), 'utf8')); } catch (e) { onDisk = null; }
yes('the save writes the counts whole into the private folder',
    onDisk && onDisk.keepDays === 30 && onDisk.days[TODAY].whiterun.gathered['iron ore'] === 5 &&
    onDisk.names['iron ore'] === 'Iron Ore');
yes('and nothing about anybody is in it: no profile, no account, no name of a person',
    !/profile|account|discord/i.test(JSON.stringify(onDisk)));

// The push, the roster's way.
const first = timers.timeouts.filter((t) => t.ms === 20000);
yes('it sends once 20 seconds after a start, and every five minutes',
    first.length === 1 && timers.intervals.filter((t) => t.ms === 300000).length === 1);
fire(first[0]);
let sent = pushes[pushes.length - 1];
let body = sent ? JSON.parse(sent.body) : {};
yes('to the site door.json names, at /api/economy, with the door key',
    sent && sent.opts.host === 'thornswood.net' && sent.opts.path === '/api/economy' && body.key === 'door-key' &&
    sent.opts.method === 'POST');
yes('saying which server it is and the server\'s today, with the whole of what is kept',
    body.server === 'main' && body.today === TODAY && body.days[TODAY].whiterun.hauled.riften === 2 &&
    body.names['iron ore'] === 'Iron Ore');

// A reload keeps every count and leaves one of each timer.
E.note('gathered', 1, '71cf3:Skyrim.esm', 1);
process.chdir(dir);
try { vm.runInNewContext(BLOCK, ctx); } finally { process.chdir(cwd); }
E = ctx.__thornswoodEconomy;
snap = E.snapshot();
yes('a gamemode reload keeps what was counted, the count since the last save included',
    snap.days[TODAY].whiterun.gathered['iron ore'] === 6);
yes('and leaves one push and one save waiting, not two',
    timers.intervals.filter((t) => t.ms === 300000).length === 1 &&
    timers.timeouts.filter((t) => t.ms === 60000).length === 1 &&
    timers.timeouts.filter((t) => t.ms === 20000).length === 1);

// The dev server's door names the site with /dev.
const devCtx = makeContext('dev', 'https://thornswood.net/dev');
process.chdir(dir);
try { vm.runInNewContext(BLOCK, Object.assign(devCtx, { globalThis: devCtx })); } finally { process.chdir(cwd); }
fire(timers.timeouts.filter((t) => t.ms === 20000).pop());
sent = pushes[pushes.length - 1];
body = sent ? JSON.parse(sent.body) : {};
yes('the dev server\'s count goes to /dev/api/economy, saying dev', sent && sent.opts.path === '/dev/api/economy' && body.server === 'dev');
fs.rmSync(dir, { recursive: true, force: true });

// ---- what calls it, by reading the files ------------------------------------
const gathered = (GM.match(/economyGathered\(actorId, /g) || []).length;
// The fifteen: salt and its rarer salt, an ore and its extra, the chopping
// block, a plant, the water, a hung and a hunted body, butter, eggs, honey,
// milk, and the two ways a crop comes in. Sixteen with the function itself.
yes('every gathering yield counts itself beside its creditWork (' + (gathered - 1) + ' places)', gathered === 16);
yes('a quest\'s own draw is left to the quest: the pearl beds and longfin waters are not counted here',
    /if \(!selected\) \{ economyGathered\(actorId, caught\.produce, got\); \}/.test(GM));
yes('a crop is counted only when the pack took it, and never a quest crop',
    (GM.match(/if\(!grant && addItem\(actorId, crop\.produce, [1n]\)\)economyGathered\(actorId, crop\.produce, [1n]\);/g) || []).length === 2);
const craftAt = GM.indexOf("mp.onCraft = guard('onCraft'");
const wrapAt = GM.indexOf('(function countCrafts() {');
yes('a craft is counted after mp.onCraft answers, never when it answers false',
    craftAt > 0 && wrapAt > craftAt &&
    /const answer = asked\.apply\(this, arguments\);\s*\n\s*if \(answer === false\) \{ return answer; \}/.test(GM));
yes('and what is counted is the craftOutput the engine is about to hand over',
    /out = mp\.get\(actorId, 'craftOutput'\)/.test(GM.slice(wrapAt, wrapAt + 2000)));
yes('a confirmed haul is counted, after the haul is taken down',
    /takedown\(from, at, profileId\);\s*\n\s*\/\/ One haul between two holds[^\n]*\n\s*var economy = g\.__thornswoodEconomy;/.test(GM) &&
    /economy\.hauled\(from, n\.dest\)/.test(GM));
// A trade finishes when the save storage acknowledges it, a later tick than
// the request (#5419): it is counted there, from recover, and only when done.
yes('a guild trade tells the block once the transfer is done, and a failing count never stops the trade',
    /function countTrade\(row\) \{[^\n]*\n[^\n]*\n\s*if \(typeof deps\.traded !== 'function'\) return;\s*\n\s*try \{ deps\.traded\(row\); \}\s*\n\s*catch \(error\)/.test(MERCHANT) &&
    /if \(how === 'done' && done\.counted\) countTrade\(done\.counted\);/.test(MERCHANT) &&
    /countTrade\(row\.counted\);\s*\n\s*return response\(tradeSaid\(/.test(MERCHANT));
yes('the installed trader hands it to the hold economy block',
    /traded: function \(row\) \{\s*\n\s*var economy = g\.__thornswoodEconomy;/.test(MERCHANT));
const bundleAt = GM.indexOf('const MERCHANT_TRADING = (function () {');
yes('and the merchant bundle in gamemode.js carries both (Build-MerchantGamemode.js was run)',
    bundleAt > 0 && GM.indexOf('try { deps.traded(row); }', bundleAt) > bundleAt &&
    GM.indexOf('countTrade(done.counted)', bundleAt) > bundleAt &&
    GM.indexOf('economy.traded(row)', bundleAt) > bundleAt);
yes('no em dash in anything this change wrote',
    !/\u2014/.test(BLOCK) && !/\u2014/.test(SERVER) && !/\u2014/.test(HUB) && !/\u2014/.test(CSS));

// ---- the hub page, by reading it ---------------------------------------------
yes('the Hold economy page has its own address and is a staff page',
    /'\/economy':\s*'economy'/.test(SERVER) && /economy: 'staff'/.test(SERVER) &&
    /'\/economy':'economy'/.test(HUB));
yes('it is in the hub\'s tabs, on its home cards and drawn by its own function',
    /keys:\['uploads','sessions','linked','inbox','economy'\]/.test(HUB) && /card\('economy'\)/.test(HUB) &&
    /if \(S\.at === 'economy'\) return drawEconomy\(\);/.test(HUB));
yes('it reads the counts when it opens, and a read that fails is said rather than shown as nothing counted',
    /api\('\/api\/economy'\)/.test(HUB) && /The counts could not be read: /.test(HUB));
yes('the README lists the game servers\' new door', /`\/api\/economy`, `\/dev\/api\/economy` \| POST/.test(README));

// ---- the site, live ---------------------------------------------------------
const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-economy-site-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const BOTKEY = crypto.randomBytes(16).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '111111111111111111';
const LORE_ID = '222222222222222222';
const TESTER_ID = '333333333333333333';
siteFiles.copy(sdir);
fs.mkdirSync(path.join(sdir, 'public'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site', 'public', 'index.html'), path.join(sdir, 'public', 'index.html'));
fs.mkdirSync(path.join(sdir, 'data'), { recursive: true });
fs.writeFileSync(path.join(sdir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: GUILD, invite: '' },
  botKey: BOTKEY, admins: [], secret: SECRET, gameCheckPort: 1,
  onlineFile: path.join(sdir, 'online.json')
}, null, 2));

/* The same stub test-hub-staff-gallery.js loads ahead of the site: it answers
   the three Discord addresses standing() asks and lets nothing else out. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r1', name: 'Owner' }, { id: 'r2', name: 'Loremaster' }, { id: 'r3', name: 'Playtester' }];
  const member = (id, name, roles) =>
    ({ nick: name, roles: roles, user: { id: id, username: name.toLowerCase(), global_name: name } });
  const MEMBERS = [
    member(process.env.TS_STUB_OWNER, 'Owner', ['r1']),
    member(process.env.TS_STUB_LORE, 'Lore', ['r2']),
    member(process.env.TS_STUB_TESTER, 'Tester', ['r3'])
  ];
  function answer(where) {
    if (where === '/api/v10/guilds/' + GUILD) return { id: GUILD, name: 'Thornswood (harness)' };
    if (where === '/api/v10/guilds/' + GUILD + '/roles') return ROLES;
    if (where === '/api/v10/guilds/' + GUILD + '/members?limit=1000') return MEMBERS;
    return null;
  }
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) {
      const u = new URL(String(a)); host = u.hostname; where = u.pathname + (u.search || '');
    } else {
      host = String(a.hostname || a.host || ''); where = String(a.path || '');
    }
    const req = new EventEmitter();
    let ended = false;
    req.setTimeout = () => req;
    req.destroy = () => { };
    req.write = () => true;
    req.end = () => {
      if (ended) return;
      ended = true;
      const body = host === 'discord.com' ? answer(where) : null;
      setImmediate(() => {
        if (!body) { req.emit('error', new Error('the harness lets no request leave this machine')); return; }
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {};
        res.setEncoding = () => { }; res.resume = () => { };
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
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let PORT = 0;
function ask(method, where, headers, bodyText) {
  return new Promise((done) => {
    const data = bodyText === undefined ? null : Buffer.from(bodyText);
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { text += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          done({ status: res.statusCode, body: text, json: json });
        });
      });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const asJson = { 'content-type': 'application/json' };

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(sdir, 'stub.js'), 'server.js'], {
    cwd: sdir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(sdir, 'chat'),
      TS_STUB_GUILD: GUILD, TS_STUB_OWNER: OWNER_ID, TS_STUB_LORE: LORE_ID, TS_STUB_TESTER: TESTER_ID
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    let up = false;
    for (let i = 0; i < 100 && !up; i++) {
      if (out.indexOf('listening on ') >= 0) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    const oldDay = dayOf(Date.now() - 40 * 86400000);
    const count = {
      key: BOTKEY, server: 'main', keepDays: 30, today: TODAY,
      days: {
        [TODAY]: { whiterun: { gathered: { 'iron ore': 5 }, hauled: { riften: 2 } },
                   riften: { sold: { 'iron ingot': 7 }, bought: { 'free salt': 1, bad: -1 } },
                   atlantis: { gathered: { wheat: 3 } } },
        [oldDay]: { whiterun: { gathered: { 'iron ore': 99 } } }
      },
      names: { 'iron ore': 'Iron Ore', 'iron ingot': 'Iron Ingot', 'free salt': 'Free Salt' }
    };
    let r = await ask('POST', '/api/economy', asJson, JSON.stringify(Object.assign({}, count, { key: 'wrong' })));
    yes('a push without the door key is refused (' + r.status + ')', r.status === 401);
    r = await ask('POST', '/api/economy', asJson, JSON.stringify(count));
    yes('a push with it is taken (' + r.status + ')', r.status === 200 && r.json && r.json.server === 'main');
    r = await ask('POST', '/dev/api/economy', asJson,
      JSON.stringify({ key: BOTKEY, today: TODAY, days: { [TODAY]: { morthal: { crafted: { 'iron ingot': 1 } } } } }));
    yes('the dev server\'s, on /dev, is taken as dev\'s (' + r.status + ')', r.status === 200 && r.json && r.json.server === 'dev');

    let kept = null;
    try { kept = JSON.parse(fs.readFileSync(path.join(sdir, 'data', 'economy.json'), 'utf8')); } catch (e) { kept = null; }
    yes('each server is kept apart, and the second push left the first as it was',
        kept && kept.servers && kept.servers.main && kept.servers.dev &&
        kept.servers.main.days[TODAY].whiterun.gathered['iron ore'] === 5 &&
        kept.servers.dev.days[TODAY].morthal.crafted['iron ingot'] === 1);
    yes('what is kept is held to its shape: a day past 30, a hold nobody has and a bad count are left out, and no key is kept',
        kept && !kept.servers.main.days[oldDay] && !kept.servers.main.days[TODAY].atlantis &&
        !Object.prototype.hasOwnProperty.call(kept.servers.main.days[TODAY].riften.bought, 'bad') &&
        !/"key"/.test(JSON.stringify(kept)) && kept.servers.main.at > 0);

    r = await ask('GET', '/api/economy', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('a Loremaster, staff, reads every server\'s count (' + r.status + ')',
        r.status === 200 && r.json && r.json.keepDays === 30 &&
        r.json.servers.main.days[TODAY].riften.sold['iron ingot'] === 7 &&
        r.json.servers.main.names['iron ore'] === 'Iron Ore' && r.json.servers.dev.today === TODAY);
    r = await ask('GET', '/api/economy', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('a Playtester cannot (' + r.status + ')', r.status === 401 || r.status === 403);
    r = await ask('GET', '/api/economy');
    yes('and nor can nobody at all (' + r.status + ')', r.status === 401);
    r = await ask('GET', '/api/all', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('the hub tells staff the Hold economy page is a staff page', r.json && r.json.level && r.json.level.economy === 'staff');
    r = await ask('GET', '/economy', {});
    yes('and /economy is the hub page, like the other hub addresses (' + r.status + ')',
        r.status === 200 && /<script src="\/hub\.js"><\/script>/.test(r.body));
  } finally {
    // Until the site has ended, Windows holds its folder open and the
    // removal is refused (EPERM, a hosted build on 31 Oct), so it waits for
    // the exit itself, not for a time.
    if (srv.exitCode === null && srv.signalCode === null) { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); }
    fs.rmSync(sdir, { recursive: true, force: true });
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.log('FAIL  the harness itself stopped: ' + (e && e.stack || e));
  process.exit(1);
});
