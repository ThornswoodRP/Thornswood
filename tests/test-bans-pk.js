/*
  test-bans-pk.js

      node .\tests\test-bans-pk.js

  #1010, the follow up to #412. Patrick, 28 September: staff can ban one
  character or a whole account (every character on it, and making new ones),
  for a length they choose or for good; staff can be banned too. PK (player
  kill) is its own action: the character is dead for good, can never be
  played or picked again, is kept rather than deleted so staff can use it in
  events, is quiet, and the account can make a new character. Only staff see
  notes. Enforced by the game server and by the site's join pass, from the
  hub and from the game, every action in the staff log with who did it.

  Patrick, 29 September: an admin, and only the admin role, can undo a PK
  made by mistake, from the hub and with /unpk, with a reason. The character
  comes back into a free slot or not at all, the PK keeps its history, and
  the staff log and the bot's line say it. And the rules page says staff can
  end a character for good.

  EIGHT PARTS.

  1. The site, the real site\server.js from a scratch copy on a loopback port:
     a character ban against an account ban against a PK, through the game's
     keyed routes, and what the join pass (/api/play/pass), the check in
     (/api/play/join), the door's list (/api/allowed) and the launcher's
     roster (/api/play/roster) each say about them. A new character on a PKed
     account is let in; one on a banned account is not. The PKed character is
     still in linked.json, roster.json and pk.json.
  2. Lengths and expiry: a chosen length is kept, for good is 0, and a ban
     that runs out lets the character or the account back at once.
  3. The hub's routes: a character ban and a PK name one of the account's own
     characters; staff cannot ban or PK their own account there; every action
     is a line in moderation.log with who did it. Notes and records go to
     staff only.
  4. The gamemode's staff block against a pretend world: /ban, /banaccount,
     /unban, /unbanaccount and /pk reach the site, answer in chat, end the
     right sessions, and write moderation.log. A PK tells only the staff
     member and the one playing it. Staff can be banned by staff, and a staff
     member whose account is banned can use nothing. A ban lifted in the game
     is not enforced again from the door's older list.
  5. The Linked accounts page and the character menu: each character's PK or
     ban shows under its account with who and why, the dead are listed, and
     the menu puts a dead character in no slot, so that slot offers a new
     character, and will not play a dead or banned one.
  6. The launcher: Roster reads the site's pk and banned lists (the lifted C#
     compiled with the build's compiler, tests/launcher-csc.js), and Chars
     moves a dead character out of its slot, never picks it and lets it be
     forgotten; and puts one an admin brought back into the lowest free slot
     (RaiseRevived, compiled).
  7. Undoing a PK: /unpk in the game (by the character in the world, by name,
     by profile number), refused while every slot is held, refused to staff
     who are not an admin; Undo PK on the hub; pk.json keeps every PK and
     undo; the join pass, the door and the launcher's roster follow it; both
     moderation.logs say it. The rules page and the terms.
  8. Only the admin role: a second scratch site with Discord roles, where a
     Gamemaster is refused on the hub and in the game and an Owner is not, and
     a Patreon tier's third slot counts.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP when it
  is set.
*/
const { spawn } = require('child_process');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const SITE = path.join(ROOT, 'site', 'server.js');
// The hub's script moved out of index.html into hub.js in #1479 (no inline
// script under the content security policy), so its functions are read there.
const PAGE = path.join(ROOT, 'site', 'public', 'hub.js');
const MENU = path.join(ROOT, 'game', 'ui', 'thornswood-select.js');
const CR = String.fromCharCode(13);
const read = (f) => fs.readFileSync(f, 'utf8').split(CR).join('');
const src = read(GM);
const siteSrc = siteFiles.source(SITE);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
function fair(s) { return typeof s === 'string' && s.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(s); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ the scratch site --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-bans-pk-'));
const KEY = crypto.randomBytes(24).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const PASSKEY = crypto.randomBytes(32).toString('hex');
const STAFF_D = '222222222', STAFF2_D = '555555555', BJORN_D = '333333333', CARA_D = '666666666', NOBODY_D = '444444444';
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: KEY, admins: [STAFF_D, STAFF2_D], secret: SECRET, passKey: PASSKEY,
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
// The launcher feed the join pass holds a launcher's version to, as its first
// write-once generation (#2727).
fs.mkdirSync(path.join(dir, 'feed', 'version'), { recursive: true });
fs.writeFileSync(path.join(dir, 'feed', 'version', '00000001.json'), JSON.stringify({ launcherVersion: '1.1.200', minLauncher: '1.1.200' }));
const DATA = path.join(dir, 'data');
fs.writeFileSync(path.join(DATA, 'linked.json'), JSON.stringify({
  [STAFF_D]: { id: STAFF_D, name: 'Aela', profiles: [1001] },
  [STAFF2_D]: { id: STAFF2_D, name: 'Brynja', profiles: [1002] },
  [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002, 2003] },
  [CARA_D]: { id: CARA_D, name: 'Cara', profiles: [4001, 4002] },
  [NOBODY_D]: { id: NOBODY_D, name: 'Nobody', profiles: [3003] }
}));
fs.writeFileSync(path.join(DATA, 'roster.json'), JSON.stringify({ who: {
  2002: { name: 'Bjorn Iron-Hand' }, 2003: { name: 'Hrefna the Bold', race: 'Nord' },
  4001: { name: 'Cara' }, 4002: { name: 'Dara' }
} }));
const readData = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch (e) { return d; } };

const gameDir = path.join(dir, 'game');
const PRIV = path.join(gameDir, 'private');
fs.mkdirSync(PRIV, { recursive: true });

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  // A browser names the page that sent a signed in write, and the site
  // refuses one that names no page (#1367). These come from its own pages.
    const signed = method !== 'GET' && Object.keys(headers || {}).some((k) => k.toLowerCase() === 'cookie');
    // agent: false, a connection of its own for every request. Node keeps an
    // idle connection to reuse, and the site closes one after five seconds
    // idle; a request sent on it just as the site closes it is reset
    // (ECONNRESET, measured 15 Oct when compiling the lifted C# with the
    // Build Tools csc kept this process busy for longer than that, #498).
    // Every request here stands alone, so none may lean on a pooled socket.
    const r = http.request({ host: '127.0.0.1', port, method, path: where, agent: false,
      headers: Object.assign({ 'content-type': 'application/json',
                               'content-length': Buffer.byteLength(data) },
                             signed ? { origin: 'http://127.0.0.1:' + port } : {}, headers || {}) },
    (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { } ok({ status: res.statusCode, j }); });
    });
    r.on('error', () => ok({ status: 0, j: null }));
    r.end(data);
  });
}
/*
  Waits for the site's own "[thornswood-docs] listening on ...:port" line, so
  nothing is asked of the port before this run's site holds it (#1727). The
  port came from the system and was let go again, and builds run side by side
  on the VPS: if something takes it in between, the site stops on EADDRINUSE,
  and polling the port would have read whatever holds it as this site. The
  error says which, with what the site printed.
*/
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}
function sign(v) { return crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32); }
/* The hub's sign in cookie, made the way the site's Discord callback makes it. */
function cookieFor(id, name) {
  const at = String(Date.now());
  const sig = crypto.createHmac('sha256', SECRET).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
}
/* The launcher's Discord ticket, made the way the site makes it. */
function ticketFor(d) {
  const body = Buffer.from(JSON.stringify({ d: d, n: 'name-' + d, x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + body + '.' + sign('ticket:' + body);
}

// ------------------------------------------------------------ the staff block --
const sA = src.indexOf('// ==== thornswood staff ====');
const sB = sA < 0 ? -1 : src.indexOf('// ==== end thornswood staff ====', sA);
const STAFF_SRC = (sA >= 0 && sB > sA) ? src.slice(sA, sB) : null;
yes('the staff block is in the gamemode', !!STAFF_SRC);

const WORLD = {
  0xff000001: { pid: 1001, name: 'Aela' },
  0xff000002: { pid: 1002, name: 'Brynja' },
  0xff000003: { pid: 2002, name: 'Bjorn' },
  0xff000004: { pid: 4001, name: 'Cara' },
  0xff000005: { pid: 4002, name: 'Dara' },
  0xff000006: { pid: 2003, name: 'Hrefna' },
  0xff000007: { pid: 6006, name: 'Sigrid' },
  0xff000008: { pid: 3003, name: 'Nobody' }
};
function loadStaff(opts) {
  const w = { said: [], logs: [], kicked: [], timeouts: [] };
  const mp = {
    get(id, key) {
      if (id === 0 && key === 'onlinePlayers') return Object.keys(WORLD).map(Number);
      const a = WORLD[id];
      if (!a) throw new Error('no such actor');
      if (key === 'profileId') return a.pid;
      if (key === 'appearance') return { name: a.name };
      if (key === 'worldOrCellDesc') return 'Whiterun:1';
      if (key === 'pos' || key === 'angle') return [0, 0, 0];
      return undefined;
    },
    set() { },
    getServerSettings() { return { privDir: PRIV }; },
    getUserByActor(a) { return WORLD[a] ? 70 + WORLD[a].pid : -1; },
    kick(u) { w.kicked.push(u); }
  };
  const later = Date.now() + 600000;
  const g = {
    __thornswoodToProfile(pid, text) { w.said.push({ pid, text: String(text) }); },
    __thornswoodPassSeen: { passes: { 1001: { at: Date.now(), x: later }, 1002: { at: Date.now(), x: later } } },
    __thornswoodSocial: {
      findPerson(want) {
        const low = String(want).toLowerCase();
        const hit = Object.keys(WORLD).map(Number).filter((a) => WORLD[a].name.toLowerCase().indexOf(low) === 0);
        return hit.length === 1 ? { actorId: hit[0], why: '' } : { actorId: 0, why: 'Nobody here by that name.' };
      }
    }
  };
  // The door's admins, when a part wants a staff member who is not one.
  if (opts && opts.isAdmin) g.__thornswoodIsAdmin = opts.isAdmin;
  const run = new Function('mp', 'require', 'globalThis', 'console', 'URL', 'Buffer', 'log', 'guard',
    'voicePort', 'setInterval', 'clearInterval', 'setTimeout', 'addItem', 'idOf', 'placeActors',
    STAFF_SRC + '\nreturn globalThis.__thornswoodStaff;');
  w.api = run(mp, require, g, { log() { } }, URL, Buffer,
    function () { w.logs.push(Array.prototype.join.call(arguments, ' ')); },
    function (n, fn) { return fn; }, function () { return 1; },
    function () { return 0; }, function () { },
    function (fn, ms) { w.timeouts.push({ fn, ms }); return 0; },
    function () { return false; }, function () { return 0; }, function () { return { made: 0 }; });
  w.to = (pid) => w.said.filter((s) => s.pid === pid).map((s) => s.text);
  return w;
}
const isStaff = (pid) => pid === 1001 || pid === 1002;
function staffLine(w, text, pid) {
  const parts = text.split(/\s+/);
  const who = pid || 1001;
  return w.api.command({ proven: true }, parts[0], parts, who,
                       Object.keys(WORLD).map(Number).find((a) => WORLD[a].pid === who), isStaff, null);
}
async function until(cond, ms) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) { if (cond()) return true; await wait(25); }
  return false;
}
// The game's staff log is in for-bot beside private, which the bot reads by a rule on the folder (#2321).
const modlog = () => { try { return fs.readFileSync(path.join(gameDir, 'for-bot', 'moderation.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (e) { return []; } };
const hublog = () => { try { return fs.readFileSync(path.join(DATA, 'for-bot', 'moderation.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (e) { return []; } };

function braceGrab(text, head) {
  const at = text.indexOf(head);
  if (at < 0) return null;
  const b = text.indexOf('{', at);
  let d = 0;
  for (let i = b; i < text.length; i++) {
    if (text[i] === '{') d++;
    else if (text[i] === '}') { d--; if (d === 0) return text.slice(at, i + 1); }
  }
  return null;
}

/*
  Part 8: a second scratch site whose people have Discord roles, from a stub
  loaded ahead of server.js (the way test-hub-staff-gallery.js does it), so a
  staff member who is not an admin exists. Owner is the admin role;
  Gamemaster is staff in the game and not an admin (since #3317 a
  Moderator works in the Discord only and is not staff here). Tova (Playtester) has two slots and
  two living characters; Mira (Milk Drinker, a Patreon tier) has three.
*/
function discordStub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r1', name: 'Owner' }, { id: 'r2', name: 'Gamemaster' },
                 { id: 'r3', name: 'Playtester' }, { id: 'r4', name: 'Milk Drinker' }];
  const member = (id, name, roles) => ({ nick: name, roles, user: { id, username: name.toLowerCase(), global_name: name } });
  const ids = JSON.parse(process.env.TS_STUB_IDS);
  const MEMBERS = [member(ids.owner, 'Owner', ['r1']), member(ids.mod, 'Gamemaster', ['r2']),
                   member(ids.tova, 'Tova', ['r3']), member(ids.mira, 'Mira', ['r3', 'r4'])];
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
async function adminRoleOnly() {
  const d2 = fs.mkdtempSync(path.join(TEMP, 'ts-unpk-roles-'));
  const GUILD = '900000000000000001';
  const ids = { owner: '710000001', mod: '720000002', tova: '730000003', mira: '740000004' };
  const key2 = crypto.randomBytes(24).toString('hex');
  const secret2 = crypto.randomBytes(32).toString('hex');
  siteFiles.copy(d2, SITE);
  fs.mkdirSync(path.join(d2, 'data'), { recursive: true });
  fs.writeFileSync(path.join(d2, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: 'harness-bot', guildId: GUILD, invite: '' },
    access: { admin: ['Owner', 'Dev'] },
    botKey: key2, admins: [], secret: secret2, passKey: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1, onlineFile: path.join(d2, 'online.json')
  }, null, 2));
  const D2 = path.join(d2, 'data');
  fs.writeFileSync(path.join(D2, 'linked.json'), JSON.stringify({
    [ids.owner]: { id: ids.owner, name: 'Owner', profiles: [8001] },
    [ids.mod]: { id: ids.mod, name: 'Gamemaster', profiles: [8002] },
    [ids.tova]: { id: ids.tova, name: 'Tova', profiles: [8101, 8102, 8103] },
    [ids.mira]: { id: ids.mira, name: 'Mira', profiles: [8201, 8202, 8203] }
  }));
  fs.writeFileSync(path.join(D2, 'roster.json'), JSON.stringify({ who: {
    8101: { name: 'Tova One' }, 8102: { name: 'Tova Two' }, 8103: { name: 'Tova Dead' },
    8201: { name: 'Mira One' }, 8202: { name: 'Mira Two' }, 8203: { name: 'Mira Dead' }
  } }));
  fs.writeFileSync(path.join(D2, 'pk.json'), JSON.stringify({
    8103: { at: 1, by: 'Gamemaster', why: 'thought it was agreed', name: 'Tova Dead', account: ids.tova, from: 'the hub' },
    8203: { at: 1, by: 'Gamemaster', why: 'wrong character', name: 'Mira Dead', account: ids.mira, from: 'the hub' }
  }));
  fs.writeFileSync(path.join(d2, 'stub.js'), '(' + discordStub.toString() + ')();\n');
  const pk2 = () => JSON.parse(fs.readFileSync(path.join(D2, 'pk.json'), 'utf8'));
  const log2 = () => { try { return fs.readFileSync(path.join(D2, 'for-bot', 'moderation.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (e) { return []; } };
  const cookie2 = (id, name) => {
    const at = String(Date.now());
    const sig = crypto.createHmac('sha256', secret2).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
    return { Cookie: 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig) };
  };
  const port2 = await freePort();
  const site2 = spawn(process.execPath, ['-r', path.join(d2, 'stub.js'), path.join(d2, 'server.js')], {
    cwd: d2, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port2), THORNSWOOD_DOCS_LOCAL: '1',
                                          TS_STUB_GUILD: GUILD, TS_STUB_IDS: JSON.stringify(ids) })
  });
  try {
    yes('the second scratch site starts, with Discord roles from the stub', await listening(site2, port2).then(() => true));
    const modC = cookie2(ids.mod, 'Gamemaster'), ownC = cookie2(ids.owner, 'Owner');
    let r = await request(port2, 'GET', '/api/all', modC);
    yes('the Gamemaster is staff and not an admin', r.status === 200 && r.j.me.dev === true && r.j.me.admin === false);
    r = await request(port2, 'POST', '/api/staff/unpk', modC, { id: ids.mira, profileId: 8203, why: 'made by mistake' });
    yes('Undo PK on the hub refuses the Gamemaster with a plain line, and nothing changes',
        r.status === 403 && r.j.message === 'Only an admin can undo a PK.' && !pk2()['8203'].undone);
    r = await request(port2, 'POST', '/api/staff/game/unpk', { 'X-Thornswood-Key': key2 },
                      { profileId: 8203, why: 'made by mistake', byProfileId: 8002, byName: 'Gamemaster' });
    yes('and so does the game\'s /unpk route, asking Discord itself',
        r.status === 403 && r.j.message === 'Only an admin can undo a PK.' && !pk2()['8203'].undone);
    r = await request(port2, 'GET', '/api/all', ownC);
    yes('the Owner is an admin', r.status === 200 && r.j.me.admin === true);
    r = await request(port2, 'POST', '/api/staff/unpk', ownC, { id: ids.tova, profileId: 8103, why: 'made by mistake' });
    yes('an admin\'s undo on an account whose two slots both hold living characters is refused, and says so',
        r.status === 409 && r.j.message === 'Every character slot on that account is taken (2 of 2), so Tova Dead is still ' +
          'dead for good and nothing changed. Its owner can forget a character in the launcher to free a slot, then undo the PK again.' &&
        !pk2()['8103'].undone);
    r = await request(port2, 'POST', '/api/staff/unpk', ownC, { id: ids.mira, profileId: 8203, why: 'made by mistake' });
    yes('an account with a Patreon tier\'s third slot free gets its character back from the Owner',
        r.status === 200 && r.j.was === true && pk2()['8203'].undone.by === 'Owner' && pk2()['8203'].undone.byId === ids.owner &&
        pk2()['8203'].why === 'wrong character');
    const l = log2();
    yes('the hub\'s moderation.log names the Owner, the character and why, and nothing for the refusals',
        l.length === 1 && l[0].did === 'unpk' && l[0].byName === 'Owner' && l[0].who === 8203 &&
        l[0].whoName === 'Mira Dead (Mira)' && l[0].why === 'made by mistake');
  } finally {
    try { site2.kill(); } catch (e) { }
    setTimeout(() => { try { fs.rmSync(d2, { recursive: true, force: true }); } catch (e) { } }, 500).unref();
  }
}

(async function main() {
  const port = await freePort();
  const site = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  try {
    yes('the scratch site starts', await listening(site, port).then(() => true));
    const K = { 'X-Thornswood-Key': KEY };
    const game = (what, body) => request(port, 'POST', '/api/staff/game/' + what, K, body);
    const allowed = () => request(port, 'GET', '/api/allowed', K);
    const passFor = (d, pid) => request(port, 'POST', '/api/play/pass', {},
      { ticket: ticketFor(d), profileId: pid, channel: 'main', version: '1.1.200' });
    const join = (d, pid) => request(port, 'POST', '/api/play/join', {}, { ticket: ticketFor(d), profileId: pid });
    const roster = (d) => request(port, 'POST', '/api/play/roster', {}, { ticket: ticketFor(d), channel: 'main' });
    const by = { byProfileId: 1001, byName: 'Aela' };

    let r = await passFor(BJORN_D, 2002);
    yes('to start with, Bjorn gets a join pass for both his characters',
        r.status === 200 && !!r.j.pass && (await passFor(BJORN_D, 2003)).status === 200);

    // ------------------------------------------------ 1. one character --
    console.log('\none character:');
    r = await game('ban', Object.assign({ profileId: 2002, name: 'Bjorn Iron-Hand', why: 'griefing the mine', minutes: 90 }, by));
    let bans = readData('bans.json', {});
    yes('/ban from the game bans the one character, kept under p:2002 with scope character',
        r.status === 200 && r.j.account === false && bans['p:2002'] && bans['p:2002'].scope === 'character' &&
        bans['p:2002'].account === BJORN_D && bans['p:2002'].by === 'Aela' && bans['p:2002'].why === 'griefing the mine');
    yes('and not the account', !bans[BJORN_D]);
    r = await passFor(BJORN_D, 2002);
    yes('the join pass refuses the banned character, saying until when and why',
        r.status === 403 && r.j.why === 'banned character' && !r.j.pass &&
        /Staff have banned that character until .* UTC: griefing the mine\. Pick another character/.test(r.j.message));
    r = await passFor(BJORN_D, 2003);
    yes('and gives his other character a pass', r.status === 200 && !!r.j.pass);
    r = await join(BJORN_D, 2003);
    yes('the account still checks in at Play', r.status === 200 && r.j.ok === true);
    r = await allowed();
    yes('the door\'s list leaves the banned character out and keeps the other',
        r.j.profiles.indexOf(2002) < 0 && r.j.profiles.indexOf(2003) >= 0);
    const cb = (r.j.bans || []).find((b) => b.profiles.indexOf(2002) >= 0);
    yes('and sends the ban as scope character, covering only that character',
        !!cb && cb.scope === 'character' && cb.profiles.length === 1);
    r = await roster(BJORN_D);
    yes('the launcher\'s roster names it as banned, with no why or who',
        r.status === 200 && JSON.stringify(r.j.banned) === '[2002]' && JSON.stringify(r.j.pk) === '[]' &&
        JSON.stringify(r.j).indexOf('griefing') < 0);
    r = await game('unban', Object.assign({ profileId: 2002, name: 'Bjorn Iron-Hand' }, by));
    yes('/unban lifts the character ban', r.status === 200 && r.j.was === true && !readData('bans.json', {})['p:2002']);
    yes('and the character gets a pass again', (await passFor(BJORN_D, 2002)).status === 200);

    // ------------------------------------------------ 1. the whole account --
    console.log('\nthe whole account:');
    r = await game('banaccount', Object.assign({ profileId: 4001, name: 'Cara', why: 'alt accounts', minutes: 60 }, by));
    bans = readData('bans.json', {});
    yes('/banaccount bans the Discord account holding the character, with scope account',
        r.status === 200 && r.j.account === true && bans[CARA_D] && bans[CARA_D].scope === 'account' && !bans['p:4001']);
    yes('and answers with every character the account holds, for the game server to end',
        Array.isArray(r.j.profiles) && r.j.profiles.indexOf(4001) >= 0 && r.j.profiles.indexOf(4002) >= 0);
    r = await passFor(CARA_D, 4001);
    yes('the join pass refuses the character named', r.status === 403 && r.j.why === 'banned');
    r = await passFor(CARA_D, 4002);
    yes('and the account\'s other character', r.status === 403 && r.j.why === 'banned');
    r = await passFor(CARA_D, 4999);
    yes('and a new character on the account', r.status === 403 && r.j.why === 'banned');
    r = await join(CARA_D, 4999);
    yes('and the account cannot check a new character in at Play', r.status === 403 && r.j.why === 'banned');
    yes('so no new character is filed under it',
        JSON.stringify(readData('linked.json', {})[CARA_D].profiles) === '[4001,4002]');
    r = await allowed();
    const ab = (r.j.bans || []).find((b) => b.profiles.indexOf(4001) >= 0);
    yes('the door\'s list leaves out every character on the account, sent as scope account',
        r.j.profiles.indexOf(4001) < 0 && r.j.profiles.indexOf(4002) < 0 && !!ab && ab.scope === 'account' &&
        ab.profiles.indexOf(4002) >= 0);
    r = await game('banaccount', Object.assign({ profileId: 7007, name: 'Stranger', why: 'x', minutes: 0 }, by));
    yes('an account ban on a character no account holds is refused, and says to ban the character',
        r.status === 404 && /ban the character/.test(r.j.error));
    r = await game('unbanaccount', Object.assign({ profileId: 4002, name: 'Dara' }, by));
    yes('/unbanaccount from any of its characters lifts the account ban',
        r.status === 200 && r.j.was === true && !readData('bans.json', {})[CARA_D] &&
        r.j.profiles.indexOf(4001) >= 0);
    yes('and the account is back', (await passFor(CARA_D, 4001)).status === 200);

    // ------------------------------------------------ 1. PK --
    console.log('\nPK:');
    r = await game('pk', Object.assign({ profileId: 2003, name: 'Hrefna', why: '' }, by));
    yes('a PK says why, or is refused', r.status === 400);
    const pkAt = Date.now();
    r = await game('pk', Object.assign({ profileId: 2003, name: 'Hrefna', why: 'fell at the siege of Whiterun' }, by));
    const pk = readData('pk.json', {});
    yes('/pk is kept in pk.json with who, why, when, the account and the name',
        r.status === 200 && r.j.was === false && pk['2003'] && pk['2003'].by === 'Aela' && pk['2003'].byId === STAFF_D &&
        pk['2003'].why === 'fell at the siege of Whiterun' && pk['2003'].account === BJORN_D &&
        pk['2003'].name === 'Hrefna' && Math.abs(pk['2003'].at - pkAt) < 5000);
    yes('a PK is not a ban', !readData('bans.json', {})['p:2003'] && !readData('bans.json', {})[BJORN_D]);
    r = await passFor(BJORN_D, 2003);
    yes('the join pass refuses the dead character, and says to pick or make another',
        r.status === 403 && r.j.why === 'pk' && !r.j.pass && /make a new one/.test(r.j.message));
    yes('without staff\'s reason', r.j.message.indexOf('siege') < 0);
    yes('the account\'s other character still gets a pass', (await passFor(BJORN_D, 2002)).status === 200);
    r = await join(BJORN_D, 2005);
    yes('the account checks a new character in at Play', r.status === 200 && r.j.claimed === true);
    yes('and the new character gets a pass', (await passFor(BJORN_D, 2005)).status === 200);
    const lk = readData('linked.json', {})[BJORN_D].profiles;
    yes('the dead character is kept: still on the account', lk.indexOf(2003) >= 0 && lk.indexOf(2005) >= 0);
    yes('and still in the game server\'s roster', readData('roster.json', {}).who['2003'].name === 'Hrefna the Bold');
    r = await allowed();
    yes('the door\'s list leaves it out of every list and sends it as pk',
        r.j.profiles.indexOf(2003) < 0 && JSON.stringify(r.j.pk) === '[2003]' &&
        !r.j.people.some((p) => p.profiles.indexOf(2003) >= 0));
    yes('and it is not sent as a ban', !(r.j.bans || []).some((b) => b.profiles.indexOf(2003) >= 0));
    r = await roster(BJORN_D);
    yes('the launcher\'s roster names it as dead, keeps its row, and says no why',
        JSON.stringify(r.j.pk) === '[2003]' && r.j.rows['2003'] && r.j.rows['2003'].name === 'Hrefna the Bold' &&
        JSON.stringify(r.j).indexOf('siege') < 0 && r.j.banned.indexOf(2003) < 0);
    r = await game('pk', Object.assign({ profileId: 2003, name: 'Hrefna', why: 'again' }, by));
    yes('a second PK changes nothing and says it was already done',
        r.status === 200 && r.j.was === true && readData('pk.json', {})['2003'].why === 'fell at the siege of Whiterun');
    r = await game('unban', Object.assign({ profileId: 2003, name: 'Hrefna' }, by));
    yes('/unban does not bring a dead character back', r.j.was === false && (await passFor(BJORN_D, 2003)).status === 403);
    yes('/unban and /unbanaccount are not how a PK is undone: that is /unpk, the admin role\'s (part 7)',
        siteSrc.indexOf('staff\\/(ban|unban|note|pk|unpk)') >= 0 && /'\/unpk'/.test(src));

    // ------------------------------------------------ 2. lengths and expiry --
    console.log('\nlengths and expiry:');
    let t0 = Date.now();
    r = await game('ban', Object.assign({ profileId: 2002, name: 'Bjorn', why: 'thirty minutes', minutes: 30 }, by));
    yes('a character ban keeps the length chosen: 30 minutes', Math.abs(r.j.until - (t0 + 30 * 60000)) < 5000);
    r = await game('ban', Object.assign({ profileId: 2002, name: 'Bjorn', why: 'for good', minutes: 0 }, by));
    yes('0 is for good', r.j.until === 0 && readData('bans.json', {})['p:2002'].until === 0 &&
        /for good/.test((await passFor(BJORN_D, 2002)).j.message));
    r = await game('banaccount', Object.assign({ profileId: 4001, name: 'Cara', why: 'a week', minutes: 10080 }, by));
    yes('an account ban keeps its length: a week', Math.abs(r.j.until - (Date.now() + 10080 * 60000)) < 5000);
    r = await game('ban', Object.assign({ profileId: 2002, name: 'Bjorn', why: 'too long', minutes: 99999999 }, by));
    yes('a length past ten years is held to ten years', Math.abs(r.j.until - (Date.now() + 10 * 365 * 24 * 60 * 60000)) < 10000);
    bans = readData('bans.json', {});
    bans['p:2002'].until = Date.now() + 1200;
    bans[CARA_D].until = Date.now() + 1200;
    fs.writeFileSync(path.join(DATA, 'bans.json'), JSON.stringify(bans));
    yes('with a moment left, the character and the account are still out',
        (await passFor(BJORN_D, 2002)).status === 403 && (await join(CARA_D, 4001)).status === 403);
    await wait(1600);
    yes('once it has run out the character gets a pass at once', (await passFor(BJORN_D, 2002)).status === 200);
    yes('and the account checks in and gets a pass at once',
        (await join(CARA_D, 4001)).status === 200 && (await passFor(CARA_D, 4002)).status === 200);
    r = await allowed();
    yes('and both are back on the door\'s list', r.j.profiles.indexOf(2002) >= 0 && r.j.profiles.indexOf(4002) >= 0);

    // ------------------------------------------------ 3. the hub --
    console.log('\nthe hub:');
    const staffC = { Cookie: cookieFor(STAFF_D, 'Aela') };
    const plainC = { Cookie: cookieFor(NOBODY_D, 'Nobody') };
    const hub = (what, body, c) => request(port, 'POST', '/api/staff/' + what, c || staffC, body);
    r = await hub('ban', { id: CARA_D, profileId: 4002, minutes: 120, why: 'camping the gate' });
    bans = readData('bans.json', {});
    yes('Ban character on the hub bans that one character, for the time chosen',
        r.status === 200 && r.j.account === false && bans['p:4002'] && bans['p:4002'].scope === 'character' &&
        bans['p:4002'].account === CARA_D && Math.abs(bans['p:4002'].until - (Date.now() + 120 * 60000)) < 10000 &&
        (!bans[CARA_D] || bans[CARA_D].why !== 'camping the gate'));
    yes('which the join pass refuses, and the account\'s other character does not mind',
        (await passFor(CARA_D, 4002)).status === 403 && (await passFor(CARA_D, 4001)).status === 200);
    r = await hub('unban', { id: CARA_D, profileId: 4002 });
    yes('Lift character ban lifts only that', r.status === 200 && r.j.was === true && !readData('bans.json', {})['p:4002']);
    r = await hub('ban', { id: CARA_D, minutes: 0, why: 'ban evasion' });
    yes('Ban account on the hub bans the whole account, for good',
        r.status === 200 && r.j.account === true && readData('bans.json', {})[CARA_D].until === 0 &&
        readData('bans.json', {})[CARA_D].scope === 'account' && (await passFor(CARA_D, 4001)).status === 403);
    r = await hub('unban', { id: CARA_D });
    yes('Lift account ban lifts it', r.status === 200 && r.j.was === true && (await passFor(CARA_D, 4001)).status === 200);
    r = await hub('ban', { id: CARA_D, profileId: 2002, minutes: 0, why: 'x' });
    yes('a character that is not on that account is refused', r.status === 404);
    r = await hub('ban', { id: STAFF_D, minutes: 0, why: 'x' });
    yes('staff cannot ban their own account from the hub', r.status === 400 && !readData('bans.json', {})[STAFF_D]);
    r = await hub('pk', { id: CARA_D, profileId: 4002, why: '' });
    yes('PK on the hub says why, or is refused', r.status === 400);
    r = await hub('pk', { id: CARA_D, why: 'no character' });
    yes('PK on the hub names a character, or is refused', r.status === 400);
    r = await hub('pk', { id: CARA_D, profileId: 4002, why: 'executed by the Jarl' }, plainC);
    yes('somebody with no staff role cannot PK', (r.status === 401 || r.status === 403) && !readData('pk.json', {})['4002']);
    r = await hub('pk', { id: CARA_D, profileId: 4002, why: 'executed by the Jarl' });
    yes('PK on the hub kills that character for good, kept with who and why',
        r.status === 200 && readData('pk.json', {})['4002'].by === 'Aela' &&
        readData('pk.json', {})['4002'].why === 'executed by the Jarl' && readData('pk.json', {})['4002'].from === 'the hub');
    yes('which the join pass refuses', (await passFor(CARA_D, 4002)).j.why === 'pk');
    r = await hub('ban', { id: STAFF2_D, profileId: 1002, minutes: 30, why: 'testing on live' });
    yes('staff can ban another staff member\'s character', r.status === 200 && (await passFor(STAFF2_D, 1002)).status === 403);
    await hub('unban', { id: STAFF2_D, profileId: 1002 });
    const hl = hublog();
    const dids = hl.map((l) => l.did).join(',');
    yes('every hub action is a line in moderation.log, in order',
        dids === 'ban,unban,banaccount,unbanaccount,pk,ban,unban');
    yes('each naming who did it', hl.every((l) => l.byName === 'Aela' && l.server === 'site'));
    yes('a character\'s lines name the character and its profile; the account\'s the account',
        hl[0].who === 4002 && hl[0].whoName === 'Dara (' + readData('linked.json', {})[CARA_D].name + ')' &&
        hl[2].whoName === readData('linked.json', {})[CARA_D].name && !hl[2].who &&
        hl[4].who === 4002 && hl[4].why === 'executed by the Jarl');

    // Notes are staff's only (#412, checked again for #1010).
    r = await hub('note', { id: STAFF_D, text: 'asked for the dev build twice' }, { Cookie: cookieFor(STAFF2_D, 'Brynja') });
    yes('staff can write a note about another staff member', r.status === 200);
    r = await request(port, 'GET', '/api/staff/records', staffC);
    yes('and staff can read notes, including ones about themselves',
        r.status === 200 && r.j.notes[STAFF_D][0].text === 'asked for the dev build twice');
    yes('the records carry every PK and the character names for the page',
        r.j.pk['2003'] && r.j.pk['4002'] && r.j.names['2003'] === 'Hrefna the Bold');
    r = await request(port, 'GET', '/api/staff/records', plainC);
    yes('somebody without a staff role cannot read the records', r.status === 401 || r.status === 403);
    r = await request(port, 'GET', '/api/staff/records');
    yes('nor can anybody signed out', r.status === 401 || r.status === 403);
    r = await request(port, 'GET', '/api/all', plainC);
    yes('nor get them, or the linked accounts, from the hub\'s page data',
        r.status === 401 || r.status === 403 ||
        (r.j && !Object.keys((r.j.records || {}).notes || {}).length && !(r.j.linked || []).length));
    r = await request(port, 'GET', '/api/all', staffC);
    yes('staff get the linked accounts and every record in the hub\'s page data',
        r.status === 200 && r.j.linked.length === 5 && r.j.records.notes[STAFF_D] && r.j.records.pk['2003']);
    yes('the Linked accounts page is a staff page now, so every staff role reaches it', r.j.level.linked === 'staff');
    r = await game('note', Object.assign({ profileId: 2002, name: 'Bjorn', text: 'keeps asking about the vault' }, by));
    yes('a note from the game answers ok and hands no notes back', r.status === 200 &&
        JSON.stringify(Object.keys(r.j).sort()) === '["ok"]');
    r = await allowed();
    yes('the game server\'s list carries no notes', JSON.stringify(r.j).indexOf('keeps asking') < 0 && !('notes' in r.j));
    r = await roster(BJORN_D);
    yes('nor does anybody\'s own roster', JSON.stringify(r.j).indexOf('keeps asking') < 0);
    const noteReads = siteSrc.split('jsonFile(NOTES').length - 1;
    yes('the site reads notes in two places only: the staff records and writing one',
        noteReads === 2 && /function staffRecords[\s\S]*?jsonFile\(NOTES/.test(siteSrc) &&
        /function putNote[\s\S]*?jsonFile\(NOTES/.test(siteSrc));
    const recUses = siteSrc.split('staffRecords(Date.now())').length - 1;
    yes('and hands the records only behind a staff role',
        recUses === 2 && /records: w\.dev \? staffRecords\(Date\.now\(\)\)/.test(siteSrc) &&
        /if \(!w\.dev\) return sendJson\(res, 403, \{ error: 'staff only' \}\);\s*return sendJson\(res, 200, staffRecords/.test(siteSrc));
    yes('the game server has no word that reads a note back',
        !/notes\.json/.test(STAFF_SRC || '') && !/'\/notes'/.test(STAFF_SRC || ''));

    // ------------------------------------------------ 4. the game --
    console.log('\nthe game:');
    fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'http://127.0.0.1:' + port, key: KEY }));
    let w = loadStaff();
    yes('the block loads with the new words', !!(w.api && w.api.pkNow) &&
        ['/ban', '/banaccount', '/unban', '/unbanaccount', '/pk'].every((x) => w.api.WORDS.indexOf(x) >= 0));

    staffLine(w, '/pk Bjorn died', 3003);
    yes('/pk from somebody who is not staff: "That one is not yours to run."', w.to(3003)[0] === 'That one is not yours to run.');
    staffLine(w, '/pk Aela a test');
    yes('/pk on yourself is refused', w.to(1001).slice(-1)[0] === 'That is you.');
    staffLine(w, '/pk Sigrid');
    yes('/pk with no reason asks for one', /^Say why: \/pk Sigrid/.test(w.to(1001).slice(-1)[0] || ''));

    staffLine(w, '/ban Bjorn 2h stealing from the market');
    yes('/ban answers the moderator: the character only, until when',
        await until(() => w.to(1001).some((t) => /^Banned the character Bjorn until .* UTC\. Their other characters can still play\.$/.test(t))));
    yes('Bjorn is told this character is banned, why and until, and his session ends',
        w.to(2002).some((t) => /^Staff have banned this character until .* UTC: stealing from the market\. Your session is being ended\. You can still play your other characters\.$/.test(t)));
    let k = w.timeouts.filter((t) => t.ms > 1000);
    k.forEach((t) => t.fn());
    yes('his session is ended after he has read it', w.kicked.indexOf(70 + 2002) >= 0);
    yes('the site holds it on the character', readData('bans.json', {})['p:2002'].why === 'stealing from the market');
    let log = modlog();
    yes('moderation.log says ban, the character, who did it, until and why',
        log.length && log[log.length - 1].did === 'ban' && log[log.length - 1].who === 2002 &&
        log[log.length - 1].byName === 'Aela' && /until .* UTC: stealing from the market/.test(log[log.length - 1].why));
    yes('it is in for-bot beside private, and private holds no staff log (#2321)',
        fs.existsSync(path.join(gameDir, 'for-bot', 'moderation.log')) && !fs.existsSync(path.join(PRIV, 'moderation.log')));

    w = loadStaff();
    staffLine(w, '/banaccount Cara 1d alt accounts');
    yes('/banaccount answers the moderator: the whole account',
        await until(() => w.to(1001).some((t) => /^Banned Cara's whole account, every character on it and any new one, until .* UTC\.$/.test(t))));
    yes('every character on the account that is in the world is told and ended, not only the one named',
        w.to(4001).some((t) => /^You are banned from Thornswood until .* UTC: alt accounts\./.test(t)) &&
        w.to(4002).some((t) => /^You are banned from Thornswood until .* UTC: alt accounts\./.test(t)));
    w.timeouts.filter((t) => t.ms > 1000).forEach((t) => t.fn());
    yes('both sessions are ended', w.kicked.indexOf(70 + 4001) >= 0 && w.kicked.indexOf(70 + 4002) >= 0);
    yes('nobody else was touched', !w.to(2003).length && !w.to(6006).length && w.kicked.length === 2);
    log = modlog();
    yes('moderation.log says banaccount', log[log.length - 1].did === 'banaccount' && log[log.length - 1].who === 4001);

    // A lift in the game is not enforced again from the door's older list.
    fs.writeFileSync(path.join(PRIV, 'allowed.json'), JSON.stringify({
      at: new Date(Date.now() - 60000).toISOString(), profiles: [], pk: [],
      bans: [{ profiles: [4001, 4002], why: 'alt accounts', until: Date.now() + 86400000, scope: 'account' }]
    }));
    w = loadStaff();
    staffLine(w, '/unbanaccount Dara');
    yes('/unbanaccount lifts the account, named by any of its characters',
        await until(() => w.to(1001).some((t) => t === 'The ban on Dara\'s account is lifted.')) &&
        !readData('bans.json', {})[CARA_D]);
    w.api.banSweep();
    yes('and the door\'s older list does not end their sessions again', !w.to(4001).length && !w.to(4002).length);
    log = modlog();
    yes('moderation.log says unbanaccount', log[log.length - 1].did === 'unbanaccount');

    w = loadStaff();
    staffLine(w, '/pk Sigrid fell to the dragon at Helgen');
    yes('/pk answers the moderator and says nobody else was told',
        await until(() => w.to(1001).some((t) => /^Sigrid is dead for good\. .*Nobody else was told\.$/.test(t))));
    yes('the one playing it is told the character died for good and how to make another',
        w.to(6006).length === 1 && /^This character has died for good and cannot be played again\..*make a new one\.$/.test(w.to(6006)[0]));
    yes('and nobody else hears a word: quiet',
        w.said.every((s) => s.pid === 1001 || s.pid === 6006));
    w.timeouts.filter((t) => t.ms > 1000).forEach((t) => t.fn());
    yes('their session is ended', w.kicked.indexOf(70 + 6006) >= 0);
    yes('the site keeps it', readData('pk.json', {})['6006'] && readData('pk.json', {})['6006'].why === 'fell to the dragon at Helgen');
    log = modlog();
    yes('moderation.log says pk, who did it and why, for the staff channel',
        log[log.length - 1].did === 'pk' && log[log.length - 1].who === 6006 && log[log.length - 1].byName === 'Aela' &&
        log[log.length - 1].why === 'fell to the dragon at Helgen');

    // The sweep: whoever PKed them, wherever.
    fs.writeFileSync(path.join(PRIV, 'allowed.json'), JSON.stringify({ at: new Date().toISOString(), profiles: [], bans: [], pk: [2003] }));
    w = loadStaff();
    w.api.banSweep();
    yes('the sweep ends a dead character the door\'s list names, with the dead line, not a ban',
        w.to(2003).length === 1 && /^This character has died for good/.test(w.to(2003)[0]) && w.timeouts.length === 1);
    w.api.banSweep();
    yes('and says it once', w.to(2003).length === 1);

    // Staff can be banned too.
    w = loadStaff();
    staffLine(w, '/banaccount Aela 30m testing on live', 1002);
    yes('staff can ban another staff member\'s account',
        await until(() => w.to(1002).some((t) => /^Banned Aela's whole account/.test(t))) &&
        readData('bans.json', {})[STAFF_D].by === 'Brynja');
    staffLine(w, '/ban Nobody 1h x');
    yes('and a staff member whose account is banned can use nothing',
        await until(() => w.to(1001).some((t) => /The site did not take the ban, so nothing changed: .*403.*no staff role/.test(t))));
    yes('every line said in the game is in plain words', w.said.every((s) => fair(s.text)));

    // ------------------------------------------------ 5. the hub page and the menu --
    console.log('\nthe Linked accounts page and the menu:');
    const page = read(PAGE);
    const escM = /var esc = function \(s\) \{[\s\S]*?\n\};/.exec(page);
    const names = ['banUntil', 'byLine', 'charName', 'charLine', 'linkedNotes', 'lengthPick', 'linkedControls', 'looseBans', 'deadList'];
    const fns = names.map((n) => braceGrab(page, 'function ' + n + '('));
    yes('the page has the character lines, the controls and the dead list', !!escM && fns.every(Boolean));
    if (escM && fns.every(Boolean)) {
      const P = new Function(escM[0] + '\n' + fns.join('\n') + '\nreturn { ' + names.map((n) => n + ': ' + n).join(', ') + ' };')();
      const rec = {
        bans: { 'p:2002': { active: true, until: Date.now() + 3600000, why: 'griefing <b>', by: 'Aela', from: 'the live server', at: Date.now() },
                'p:7007': { active: true, until: 0, why: 'stranger', by: 'Aela' } },
        notes: {},
        pk: { 2003: { at: Date.now(), by: 'Brynja', why: 'fell at the siege', account: BJORN_D, from: 'the dev server' } },
        names: { 2002: 'Bjorn Iron-Hand', 2003: 'Hrefna the Bold' }
      };
      const u = { id: BJORN_D, profiles: [2002, 2003] };
      const line = P.linkedNotes(u, rec, Date.now());
      yes('under the account, the banned character says so, until when, why and by whom',
          /Bjorn Iron-Hand <span class="said">profile 2002<\/span> <span class="pill fail">Character banned until [^<]+<\/span> griefing &lt;b&gt; \(by Aela, from the live server/.test(line));
      yes('and the dead one says dead for good, why and by whom',
          /Hrefna the Bold <span class="said">profile 2003<\/span> <span class="pill fail">Dead for good \(PK\)<\/span> fell at the siege \(by Brynja, from the dev server/.test(line));
      const ctl = P.linkedControls(u, rec, Date.now());
      yes('the controls ban the account, and ban, lift or PK each living character',
          /data-act="ban" data-id="333333333">Ban account/.test(ctl) &&
          /data-act="ban" data-id="333333333" data-pid="2002">Ban character/.test(ctl) &&
          /data-act="unban" data-id="333333333" data-pid="2002">Lift character ban/.test(ctl) &&
          /data-act="pk" data-id="333333333" data-pid="2002"/.test(ctl) && /value="0">for good/.test(ctl));
      yes('and offer no ban or PK on a dead character',
          !/data-act="(ban|unban|pk)" data-id="333333333" data-pid="2003"/.test(ctl));
      yes('to staff who are not an admin, a dead character says only an admin can undo a PK, with no button',
          /Hrefna the Bold is dead for good\.<\/span> <span class="said">Only an admin can undo a PK\.<\/span>/.test(ctl) &&
          !/data-act="unpk"/.test(ctl));
      const ctlAdmin = P.linkedControls(u, rec, Date.now(), true);
      yes('to an admin it offers Undo PK, with a reason box',
          /<input class="unpkwhy" data-id="333333333:2003" placeholder="Why the PK is undone">/.test(ctlAdmin) &&
          /data-act="unpk" data-id="333333333" data-pid="2003" data-name="Hrefna the Bold">Undo PK/.test(ctlAdmin) &&
          !/data-act="unpk"[^>]*data-pid="2002"/.test(ctlAdmin));
      const undoneRec = JSON.parse(JSON.stringify(rec));
      undoneRec.pk['2003'] = { at: 1, by: 'Brynja', why: 'fell at the siege', from: 'the dev server', account: BJORN_D,
                               undone: { at: 2, by: 'Aela', why: 'made by mistake', from: 'the hub' },
                               history: [{ at: 0, by: 'Aela', why: 'an older PK', undone: { at: 0.5, by: 'Aela', why: 'also a mistake' } }] };
      const undoneLine = P.linkedNotes(u, undoneRec, Date.now());
      yes('a PK an admin undid no longer shows as dead, and its whole record stays under the character, oldest first',
          !/Dead for good \(PK\)/.test(undoneLine) &&
          /PK an older PK \(by Aela[^)]*\), undone by an admin: also a mistake \(by Aela/.test(undoneLine) &&
          /PK fell at the siege \(by Brynja, from the dev server[^)]*\), undone by an admin: made by mistake \(by Aela, from the hub/.test(undoneLine) &&
          undoneLine.indexOf('an older PK') < undoneLine.indexOf('fell at the siege'));
      const undoneCtl = P.linkedControls(u, undoneRec, Date.now(), true);
      yes('and the character it brought back can be banned or PKed again like any other',
          /data-act="pk" data-id="333333333" data-pid="2003"/.test(undoneCtl) && !/data-act="unpk"/.test(undoneCtl));
      yes('and it is not in the dead list', P.deadList(undoneRec) === '');
      yes('the Undo PK words are plain', fair(ctlAdmin) && fair(undoneLine));
      const wire = braceGrab(page, 'function wireLinked(') || '';
      yes('Undo PK asks for why and to confirm, and shows the site\'s own sentence when it says no',
          /act === 'unpk'/.test(wire) && /pick\('unpkwhy', key\)/.test(wire) && /confirm\('Undo the PK of '/.test(wire) &&
          /alert\(said \|\| 'The site did not take that\.'\)/.test(wire));
      yes('drawLinked tells linkedControls whether the one looking is an admin',
          /linkedControls\(u, S\.records, Date\.now\(\), !!S\.me\.admin\)/.test(page));
      const dead = P.deadList(rec);
      yes('the dead are listed for staff with their name, profile, account and why',
          /Hrefna the Bold <span class="said">profile 2003, Discord 333333333<\/span>: fell at the siege/.test(dead));
      yes('a ban on one of an account\'s characters is not listed again as a loose profile',
          !/Profile 2002/.test(P.looseBans(rec, Date.now(), [u])) && /Profile 7007/.test(P.looseBans(rec, Date.now(), [u])));
      yes('the page\'s words are plain', fair(line) && fair(ctl) && fair(dead) &&
          fair(page.slice(page.indexOf('function drawLinked'), page.indexOf('function wireLinked'))));
      yes('PK asks the staff member to confirm first', /confirm\('PK '/.test(braceGrab(page, 'function wireLinked(') || ''));
    }

    const menu = read(MENU);
    const slotsSrc = braceGrab(menu, 'function slots(');
    yes('the menu has its slots()', !!slotsSrc);
    if (slotsSrc) {
      const run = new Function('chars', 'SLOTS', 'spare', slotsSrc + '\nreturn slots();');
      const out = run([{ profileId: 11, slot: 1 }, { profileId: 12, slot: 0, pk: true }, { profileId: 13, slot: 2, banned: true }], 2, 99);
      yes('a banned character keeps its slot', out[1].id === 13 && out[1].n === 2);
      yes('a dead character is in no slot and drawn last', out.length === 3 && out[2].id === 12 && out[2].n === 0);
      const freed = run([{ profileId: 11, slot: 1 }, { profileId: 12, slot: 0, pk: true }], 2, 99);
      yes('so the slot it held offers a new character on the spare id', freed[1].id === 99 && !freed[1].c && freed[2].id === 12);
    }
    const playSrc = braceGrab(menu, 'function play(') || '';
    yes('the menu will not play a dead or a banned character, and says why',
        /if \(e\.c && \(e\.c\.pk \|\| e\.c\.banned\)\)/.test(playSrc) && playSrc.indexOf('sent = true') > playSrc.indexOf('e.c.pk'));
    yes('the dead card says it cannot be played and to make a new one',
        /This character has died for good and cannot be played again\. Make a new character in an empty slot\./.test(menu));

    // ------------------------------------------------ 6. the launcher --
    console.log('\nthe launcher:');
    const rosterCs = read(path.join(ROOT, 'launcher', 'app', 'Roster.cs'));
    const charsCs = read(path.join(ROOT, 'launcher', 'app', 'Chars.cs'));
    const lift = (text, head) => {
      const a = text.indexOf(head);
      if (a < 0) return null;
      const g = braceGrab(text.slice(a), head);
      return g;
    };
    const readIds = lift(rosterCs, 'public static HashSet<int> ReadIds(string text, string key)');
    yes('Roster.cs reads the site\'s pk and banned lists', !!readIds &&
        /ReadIds\(text, "pk"\)/.test(rosterCs) && /ReadIds\(text, "banned"\)/.test(rosterCs));
    // Built the way the project builds, by the .NET 10 SDK (tests/launcher-csc.js),
    // which runs here on any machine that has it (#4823).
    const lc = require('./launcher-csc');
    const buildAndRun = (prog) => {
      try { return lc.run(lc.build({ sources: [prog], exe: true }), []).stdout; }
      catch (e) { return 'ERROR ' + e.message; }
    };
    if (readIds && !lc.dotnet) {
      yes('the .NET SDK the launcher builds with is on this machine', false);
    } else if (readIds) {
      const prog = 'using System; using System.Collections.Generic; using System.Text.RegularExpressions;\n' +
        'static class T {\n ' + readIds + '\n static void Main() {\n' +
        '  string a = "{\\"ok\\":true,\\"rows\\":{\\"2003\\":{\\"name\\":\\"H\\"}},\\"gone\\":[],\\"goneAt\\":0,\\"pk\\":[2003, 4002],\\"banned\\":[2002]}";\n' +
        '  var pk = ReadIds(a, "pk"); var b = ReadIds(a, "banned"); var none = ReadIds("{\\"ok\\":true}", "pk");\n' +
        '  Console.WriteLine("pk " + pk.Count + " " + pk.Contains(2003) + " " + pk.Contains(4002));\n' +
        '  Console.WriteLine("banned " + b.Count + " " + b.Contains(2002));\n' +
        '  Console.WriteLine("none " + none.Count);\n } }\n';
      const out = buildAndRun(prog);
      yes('the lifted ReadIds compiles with the compiler the launcher builds with, and reads pk [2003, 4002], banned [2002], and nothing from an answer without them',
          /pk 2 True True/.test(out) && /banned 1 True/.test(out) && /none 0/.test(out));
      if (/ERROR/.test(out)) console.log(out);
    }
    const bury = lift(charsCs, 'static string BuryDead(List<Row> rows)') || '';
    yes('Chars moves a dead character out of its slot to DeadSlot and saves',
        /Roster\.Dead\(r\.Id\)/.test(bury) && /r\.Slot = DeadSlot;/.test(bury) && /Save\(rows\);/.test(bury) &&
        /const int DeadSlot = -1;/.test(charsCs));
    const prep = lift(charsCs, 'public static string Prepare(Config cfg)') || '';
    yes('before the id played last is chosen and the slots are tidied',
        prep.indexOf('BuryDead(rows)') > 0 && prep.indexOf('BuryDead(rows)') < prep.indexOf('LastPlayedId(rows)') &&
        prep.indexOf('Roster.Refresh(cfg)') < prep.indexOf('BuryDead(rows)'));
    const chose = lift(charsCs, 'public static void Chose(int profileId)') || '';
    yes('a dead character is never picked', /if \(r != null && r\.Slot == DeadSlot\) return;/.test(chose));
    const forget = lift(charsCs, 'public static void Forget(int profileId)') || '';
    yes('and can be forgotten with the bin', /r\.Slot != DeadSlot/.test(forget));
    const write = lift(charsCs, 'static string CharactersJson(List<Row> rows, int last, int spare, int slots)') || '';
    yes('the menu list carries the dead with "pk":true in slot 0, and a banned character with "banned":true',
        /all\.AddRange\(DeadRows\(rows\)\)/.test(write) && /,\\"pk\\":true/.test(write) &&
        /,\\"banned\\":true/.test(write) && /isDead \? 0 : r\.Slot/.test(write));

    // An admin undoing a PK (29 September): the launcher puts it back.
    yes('Roster.cs reads the site\'s revived list, and Revived is false for an id still dead',
        /ReadIds\(text, "revived"\)/.test(rosterCs) &&
        /return revived\.Contains\(profileId\) && !dead\.Contains\(profileId\);/.test(rosterCs));
    const raise = lift(charsCs, 'static string RaiseRevived(List<Row> rows)') || '';
    const nextSlot = lift(charsCs, 'static int NextSlot(List<Row> rows)') || '';
    const findSlot = lift(charsCs, 'static Row Find(List<Row> rows, int slot)') || '';
    yes('Chars has RaiseRevived, run in Prepare after BuryDead and before the slots are tidied',
        !!raise && prep.indexOf('RaiseRevived(rows)') > prep.indexOf('BuryDead(rows)') &&
        prep.indexOf('RaiseRevived(rows)') < prep.indexOf('TidySlots(rows, slots)'));
    if (raise && nextSlot && findSlot && !lc.dotnet) {
      yes('the .NET SDK the launcher builds with is on this machine', false);
    } else if (raise && nextSlot && findSlot) {
      const prog = 'using System; using System.Collections.Generic;\n' +
        'static class Roster { public static HashSet<int> back = new HashSet<int>();\n' +
        '  public static bool Revived(int id) { return back.Contains(id); } }\n' +
        'static class T {\n class Row { public int Slot; public int Id; }\n const int DeadSlot = -1;\n' +
        ' static int saved = 0;\n static void Save(List<Row> rows) { saved++; }\n' +
        ' ' + findSlot + '\n ' + nextSlot + '\n ' + raise + '\n' +
        ' static Row R(int id, int slot) { var r = new Row(); r.Id = id; r.Slot = slot; return r; }\n' +
        ' static void Main() {\n' +
        '  var rows = new List<Row> { R(99, 0), R(11, 1), R(12, DeadSlot), R(13, DeadSlot) };\n' +
        '  Console.WriteLine("none " + (RaiseRevived(rows) == null) + " " + saved + " " + rows[2].Slot);\n' +
        '  Roster.back.Add(12);\n' +
        '  string line = RaiseRevived(rows);\n' +
        '  Console.WriteLine("back " + rows[2].Slot + " " + rows[3].Slot + " " + saved);\n' +
        '  Console.WriteLine(line);\n } }\n';
      const out = buildAndRun(prog);
      yes('the lifted RaiseRevived compiles with the compiler the launcher builds with, and moves nobody when the site named nobody',
          /none True 0 -1/.test(out));
      yes('and puts the one the site names as revived into the lowest free slot, leaves the other dead, and saves',
          /back 2 -1 1/.test(out) && /An admin undid the PK of a character, so it can be played again: profile 12 to slot 2\./.test(out));
      if (/ERROR/.test(out)) console.log(out);
    }

    // ------------------------------------------------ 7. an admin undoes a PK --
    console.log('\nundoing a PK:');
    // Part 4 banned Aela's account; Brynja lifts it so Aela can act again.
    r = await game('unbanaccount', { profileId: 1001, name: 'Aela', byProfileId: 1002, byName: 'Brynja' });
    yes('Aela\'s account ban from part 4 is lifted first', r.status === 200 && !readData('bans.json', {})[STAFF_D]);
    // Both staff on this site are on its admin list, so both are admins here;
    // part 8 has a staff member who is not.
    let roster0 = readData('roster.json', { who: {} });
    roster0.who['2005'] = { name: 'Solveig' };
    fs.writeFileSync(path.join(DATA, 'roster.json'), JSON.stringify(roster0));
    fs.writeFileSync(path.join(PRIV, 'allowed.json'), JSON.stringify({ at: new Date().toISOString(), profiles: [], bans: [], pk: [2003] }));
    await wait(20);
    w = loadStaff();
    staffLine(w, '/unpk Hrefna made by mistake');
    yes('with both of the account\'s slots held by living characters, /unpk says so and changes nothing',
        await until(() => w.to(1001).some((t) => t === 'Every character slot on that account is taken (2 of 2), so Hrefna is still ' +
          'dead for good and nothing changed. Its owner can forget a character in the launcher to free a slot, then undo the PK again.')) &&
        !readData('pk.json', {})['2003'].undone && (await passFor(BJORN_D, 2003)).status === 403);
    roster0 = readData('roster.json', { who: {} });
    delete roster0.who['2005'];
    fs.writeFileSync(path.join(DATA, 'roster.json'), JSON.stringify(roster0));
    const unAt = Date.now();
    staffLine(w, '/unpk Hrefna made by mistake');
    yes('with a slot free, /unpk from an admin in the game brings the character back and says so',
        await until(() => w.to(1001).some((t) => t === 'Hrefna is no longer dead for good and can be played again from a free slot. ' +
          'The PK stays on the record with your reason beside it.')));
    let pkRow = readData('pk.json', {})['2003'];
    yes('pk.json keeps the PK as it was and adds the undo: who, which account, from where, when and why',
        pkRow.why === 'fell at the siege of Whiterun' && pkRow.by === 'Aela' && pkRow.undone &&
        pkRow.undone.by === 'Aela' && pkRow.undone.byId === STAFF_D && pkRow.undone.why === 'made by mistake' &&
        pkRow.undone.from === 'the live server' && Math.abs(pkRow.undone.at - unAt) < 5000);
    r = await passFor(BJORN_D, 2003);
    yes('the join pass lets the character in again', r.status === 200 && !!r.j.pass);
    r = await allowed();
    yes('the door\'s list has it back and no longer sends it as pk',
        r.j.profiles.indexOf(2003) >= 0 && r.j.pk.indexOf(2003) < 0);
    r = await roster(BJORN_D);
    yes('the launcher\'s roster names it as revived and not dead, so the launcher puts it back in a slot',
        JSON.stringify(r.j.revived) === '[2003]' && r.j.pk.indexOf(2003) < 0);
    log = modlog();
    yes('moderation.log says unpk, the character, who undid it and why, for the staff channel',
        log[log.length - 1].did === 'unpk' && log[log.length - 1].who === 2003 && log[log.length - 1].byName === 'Aela' &&
        log[log.length - 1].whoName === 'Hrefna' && log[log.length - 1].why === 'made by mistake');
    w.api.banSweep();
    yes('and the door\'s older list, which still names it, does not end Hrefna\'s session', !w.to(2003).length);
    staffLine(w, '/unpk Hrefna again');
    yes('a second /unpk says the account has nobody dead for good',
        await until(() => w.to(1001).some((t) => t === 'Hrefna has no character that is dead for good.')));

    await game('pk', Object.assign({ profileId: 5005, name: 'Ulfric Ghost', why: 'wrong man' }, by));
    await game('pk', Object.assign({ profileId: 5006, name: 'Ulfric Other', why: 'the other one' }, by));
    staffLine(w, '/unpk Ulfric oops');
    yes('/unpk finds a dead character nobody is playing by its name, and asks which when two start the same',
        await until(() => w.to(1001).some((t) => /^More than one character dead for good starts with "Ulfric": Ulfric Ghost \(profile 5005\), Ulfric Other \(profile 5006\)\. Name one, or its profile number\.$/.test(t))));
    staffLine(w, '/unpk Ulfric Ghost the wrong man');
    yes('and by the whole name, with the rest as the reason',
        await until(() => w.to(1001).some((t) => /^Ulfric Ghost is no longer dead for good/.test(t))) &&
        readData('pk.json', {})['5005'].undone.why === 'the wrong man' && !readData('pk.json', {})['5006'].undone);
    staffLine(w, '/unpk 5006 wrong one too');
    yes('and by profile number', await until(() => !!(readData('pk.json', {})['5006'] || {}).undone) &&
        readData('pk.json', {})['5006'].undone.why === 'wrong one too');
    staffLine(w, '/unpk 5006');
    yes('/unpk with a profile number and no reason asks for one', /^Say why: \/unpk 5006 made by mistake\./.test(w.to(1001).slice(-1)[0] || ''));

    const notAdmin = loadStaff({ isAdmin: (p) => p === 1001 });
    staffLine(notAdmin, '/unpk Dara wrong Dara', 1002);
    yes('staff who are not an admin are refused in the game with a plain line, and nothing changes',
        notAdmin.to(1002).slice(-1)[0] === 'Only an admin can undo a PK.' && !readData('pk.json', {})['4002'].undone);
    staffLine(notAdmin, '/unpk Dara wrong Dara', 3003);
    yes('and somebody with no staff role gets the usual refusal', notAdmin.to(3003).slice(-1)[0] === 'That one is not yours to run.');
    r = await game('unpk', { profileId: 4002, why: 'x', byProfileId: 2002, byName: 'Bjorn' });
    yes('the site refuses /unpk itself for anybody its Discord check does not call an admin, with the same line',
        r.status === 403 && r.j.message === 'Only an admin can undo a PK.' && !readData('pk.json', {})['4002'].undone);
    yes('every line /unpk said in the game is plain', w.said.concat(notAdmin.said).every((s) => fair(s.text)));

    // The hub.
    r = await hub('unpk', { id: CARA_D, profileId: 4002, why: 'wrong Dara' }, plainC);
    yes('Undo PK on the hub is refused to somebody with no staff role', (r.status === 401 || r.status === 403) &&
        !readData('pk.json', {})['4002'].undone);
    r = await hub('unpk', { id: CARA_D, profileId: 4002, why: '' });
    yes('Undo PK on the hub says why, or is refused', r.status === 400 && !readData('pk.json', {})['4002'].undone);
    r = await hub('unpk', { id: CARA_D, profileId: 4002, why: 'wrong Dara' });
    pkRow = readData('pk.json', {})['4002'];
    yes('an admin\'s Undo PK on the hub brings Dara back, keeping the PK with the undo beside it',
        r.status === 200 && r.j.was === true && pkRow.why === 'executed by the Jarl' &&
        pkRow.undone.why === 'wrong Dara' && pkRow.undone.by === 'Aela' && pkRow.undone.from === 'the hub');
    yes('and the join pass lets her in', (await passFor(CARA_D, 4002)).status === 200);
    let hl2 = hublog();
    yes('the hub writes unpk to moderation.log with the character, the account, who and why',
        hl2[hl2.length - 1].did === 'unpk' && hl2[hl2.length - 1].who === 4002 && hl2[hl2.length - 1].byName === 'Aela' &&
        hl2[hl2.length - 1].whoName === 'Dara (' + readData('linked.json', {})[CARA_D].name + ')' &&
        hl2[hl2.length - 1].why === 'wrong Dara');
    r = await hub('unpk', { id: CARA_D, profileId: 4002, why: 'again' });
    yes('undoing it twice changes nothing and writes no second line',
        r.status === 200 && r.j.was === false && hublog().length === hl2.length);
    r = await hub('pk', { id: CARA_D, profileId: 4002, why: 'executed again, for real' });
    pkRow = readData('pk.json', {})['4002'];
    yes('a new PK after an undo holds again, and the old PK and its undo move into its history',
        r.status === 200 && r.j.was === false && !pkRow.undone && pkRow.why === 'executed again, for real' &&
        pkRow.history.length === 1 && pkRow.history[0].why === 'executed by the Jarl' &&
        pkRow.history[0].undone.why === 'wrong Dara' && (await passFor(CARA_D, 4002)).j.why === 'pk');
    await hub('unpk', { id: CARA_D, profileId: 4002, why: 'still a mistake' });
    pkRow = readData('pk.json', {})['4002'];
    yes('and undoing that keeps all of it: nothing in pk.json is ever deleted',
        pkRow.undone.why === 'still a mistake' && pkRow.history.length === 1 && pkRow.history[0].undone.why === 'wrong Dara');
    yes('the records staff read carry the undo and the history', (await request(port, 'GET', '/api/staff/records', staffC)).j.pk['4002'].history.length === 1);

    // The rules page (Patrick, 29 September).
    const rulesMd = read(path.join(ROOT, 'site', 'data', 'site', 'rules.md'));
    const rule2 = rulesMd.slice(rulesMd.indexOf('## 2. Nobody dies without agreeing to'), rulesMd.indexOf('## 3.'));
    yes('rule 2 on the rules page says staff can end a character for good, for serious rule breaking or in an event its owner agreed to',
        /\*\*Staff can end a character for good\.\*\* They do it for serious rule breaking,\s+or in an event its owner agreed to\./.test(rule2));
    const termsMd = read(path.join(ROOT, 'site', 'data', 'site', 'terms.md'));
    yes('and the terms say the same where they sum rule 2 up',
        /nobody's character dies without that person\s+agreeing, except that staff can end a character for good for serious rule\s+breaking or in an event its owner agreed to;/.test(termsMd));
    yes('both in plain words', fair(rule2) && fair(termsMd));

    // ------------------------------------------------ 8. only the admin role --
    console.log('\nonly the admin role, with Discord roles:');
    await adminRoleOnly();
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    try { site.kill(); } catch (e) { }
    setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } }, 500).unref();
    console.log('');
    console.log(pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
    setTimeout(() => process.exit(process.exitCode), 1000).unref();
  }
})();
