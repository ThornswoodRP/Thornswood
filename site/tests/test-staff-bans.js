/*
  test-staff-bans.js

      node .\site\tests\test-staff-bans.js

  #412, the second half. Patrick, 28 September: "put the bans and notes on the
  site", and "on the linked accounts page it should have a notes line and in
  there any notes or if they are banned should show there as well".

  FOUR PARTS.

  1. The site. The real site\server.js runs from a scratch copy on a spare
     loopback port with a key made here. The game's keyed routes
     (/api/staff/game/ban, unban, note) refuse no key, a wrong key, a staff
     profile no account holds, an account with no staff role, and a ban with
     no reason. A ban lands in bans.json against the account, so every one of
     its characters is covered. /api/allowed leaves every banned profile out
     of every list and sends the bans with why and until; a ban that has run
     out lets them back in. The hub's own routes need a staff sign in, and
     what they do goes to moderation.log for the staff channel.

  2. The gamemode's staff block, loaded on its own against a pretend world,
     with the real door.json pointing at the scratch site: /ban, /unban and
     /note reach the site, answer through the chat, and write moderation.log;
     a banned person online is told why and until when and their session is
     ended; the sweep ends anybody the door's list says is banned, and not
     somebody whose ban has run out. Someone who is not staff is refused.

  3. The Linked accounts page: the Notes line under an account shows the ban
     (why, who, until when or for good) and every note with its author and
     time, all escaped. Real functions out of site\public\index.html.

  4. The door in the gamemode keeps the bans when it writes allowed.json.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP when it
  is set.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const SITE = path.join(ROOT, 'site', 'server.js');
// The hub's script moved out of index.html into hub.js in #1479 (no inline
// script under the content security policy), so its functions are read there.
const PAGE = path.join(ROOT, 'site', 'public', 'hub.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');

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
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-staff-bans-'));
const KEY = crypto.randomBytes(24).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const STAFF_D = '222222222', BJORN_D = '333333333', NOBODY_D = '444444444';
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: KEY, admins: [STAFF_D], secret: SECRET,
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
const DATA = path.join(dir, 'data');
fs.writeFileSync(path.join(DATA, 'linked.json'), JSON.stringify({
  [STAFF_D]: { id: STAFF_D, name: 'Aela', profiles: [1001] },
  [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002, 2003] },
  [NOBODY_D]: { id: NOBODY_D, name: 'Nobody', profiles: [3003] }
}));
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
    const r = http.request({ host: '127.0.0.1', port, method, path: where,
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
/* The hub's sign in cookie, made the way the site's Discord callback makes it. */
function cookieFor(id, name) {
  const at = String(Date.now());
  const sig = crypto.createHmac('sha256', SECRET).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
}

// ------------------------------------------------------------ the staff block --
const sA = src.indexOf('// ==== thornswood staff ====');
const sB = sA < 0 ? -1 : src.indexOf('// ==== end thornswood staff ====', sA);
const STAFF_SRC = (sA >= 0 && sB > sA) ? src.slice(sA, sB) : null;
yes('the staff block is in the gamemode', !!STAFF_SRC);

const A_AELA = 0xff000001, A_BJORN = 0xff000002, A_NOBODY = 0xff000003, A_SERA = 0xff000004, A_OLD = 0xff000005;
const WORLD = {
  [A_AELA]: { pid: 1001, name: 'Aela' },
  [A_BJORN]: { pid: 2002, name: 'Bjorn' },
  [A_NOBODY]: { pid: 3003, name: 'Nobody' },
  [A_SERA]: { pid: 4004, name: 'Sera' },
  [A_OLD]: { pid: 5005, name: 'Old Ban' }
};
function loadStaff() {
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
  const g = {
    __thornswoodToProfile(pid, text) { w.said.push({ pid, text: String(text) }); },
    __thornswoodPassSeen: { passes: { 1001: { at: Date.now(), x: Date.now() + 600000 } } },
    __thornswoodSocial: {
      findPerson(want) {
        const low = String(want).toLowerCase();
        const hit = Object.keys(WORLD).map(Number).filter((a) => WORLD[a].name.toLowerCase().indexOf(low) === 0);
        return hit.length === 1 ? { actorId: hit[0], why: '' } : { actorId: 0, why: 'Nobody here by that name.' };
      }
    }
  };
  const run = new Function('mp', 'require', 'globalThis', 'console', 'URL', 'Buffer', 'log', 'guard',
    'voicePort', 'setInterval', 'clearInterval', 'setTimeout', 'addItem', 'idOf', 'placeActors',
    STAFF_SRC + '\nreturn globalThis.__thornswoodStaff;');
  // No voice service here: the silence push goes to a port nothing listens on.
  w.api = run(mp, require, g, { log() { } }, URL, Buffer,
    function () { w.logs.push(Array.prototype.join.call(arguments, ' ')); },
    function (n, fn) { return fn; }, function () { return 1; },
    function () { return 0; }, function () { },
    function (fn, ms) { w.timeouts.push({ fn, ms }); return 0; },
    function () { return false; }, function () { return 0; }, function () { return { made: 0 }; });
  w.to = (pid) => w.said.filter((s) => s.pid === pid).map((s) => s.text);
  return w;
}
const isStaff = (pid) => pid === 1001;
function staffLine(w, text, pid, proven) {
  const parts = text.split(/\s+/);
  return w.api.command({ proven: proven !== false }, parts[0], parts, pid || 1001,
                       Object.keys(WORLD).map(Number).find((a) => WORLD[a].pid === (pid || 1001)), isStaff, null);
}
async function until(cond, ms) {
  const end = Date.now() + (ms || 8000);
  while (Date.now() < end) { if (cond()) return true; await wait(25); }
  return false;
}
// The game's staff log is in for-bot beside private, which the bot reads by a rule on the folder (#2321).
const modlog = () => { try { return fs.readFileSync(path.join(gameDir, 'for-bot', 'moderation.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch (e) { return []; } };

(async function main() {
  const port = await freePort();
  const site = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  try {
    yes('the scratch site starts', await listening(site, port).then(() => true));
    const K = { 'X-Thornswood-Key': KEY };
    const game = (what, body, headers) => request(port, 'POST', '/api/staff/game/' + what, headers === undefined ? K : headers, body);
    const allowed = () => request(port, 'GET', '/api/allowed', K);

    // ------------------------------------------------ 1. the site's routes --
    console.log('\nthe site, from the game:');
    // The whole account (#1010: the game's /ban is one character now, and
    // /banaccount the account; test-bans-pk.js holds the two apart).
    const ban = { profileId: 2002, name: 'Bjorn', byProfileId: 1001, byName: 'Aela', why: 'spamming the market', minutes: 90 };
    let r = await game('banaccount', ban, {});
    yes('no key is refused 401', r.status === 401);
    r = await game('ban', ban, { 'X-Thornswood-Key': 'x' + KEY.slice(1) });
    yes('a wrong key is refused 401', r.status === 401);
    r = await game('banaccount', Object.assign({}, ban, { byProfileId: 9999 }));
    yes('a staff profile no account holds is refused 403', r.status === 403);
    r = await game('banaccount', Object.assign({}, ban, { byProfileId: 3003 }));
    yes('an account with no staff role is refused 403, whatever the game server says', r.status === 403);
    r = await game('banaccount', Object.assign({}, ban, { why: '' }));
    yes('a ban with no reason is refused 400', r.status === 400);
    yes('and nothing was written by any of those', !Object.keys(readData('bans.json', {})).length);

    const before = Date.now();
    r = await game('banaccount', ban);
    yes('a ban from staff is taken', r.status === 200 && r.j && r.j.ok);
    yes('and says when it ends: ninety minutes from now',
        r.j && Math.abs(r.j.until - (before + 90 * 60000)) < 5000);
    let bans = readData('bans.json', {});
    yes('kept against the account that holds the profile, with who, why and until',
        bans[BJORN_D] && bans[BJORN_D].why === 'spamming the market' && bans[BJORN_D].by === 'Aela' &&
        bans[BJORN_D].byId === STAFF_D && bans[BJORN_D].until === r.j.until);

    r = await allowed();
    yes('the door\'s list answers', r.status === 200 && Array.isArray(r.j.profiles));
    yes('and leaves out every character on the banned account',
        r.j.profiles.indexOf(2002) < 0 && r.j.profiles.indexOf(2003) < 0 &&
        r.j.profiles.indexOf(1001) >= 0 && r.j.profiles.indexOf(3003) >= 0);
    yes('from every list and every person row',
        !r.j.people.some((p) => p.profiles.indexOf(2002) >= 0));
    const sent = (r.j.bans || []).find((b) => b.profiles.indexOf(2002) >= 0);
    yes('and sends the ban with why and until, for the game server to end the session',
        !!sent && sent.why === 'spamming the market' && sent.until === bans[BJORN_D].until &&
        sent.profiles.indexOf(2003) >= 0);

    r = await game('banaccount', { profileId: 7007, name: 'Stranger', byProfileId: 1001, byName: 'Aela', why: 'cheating', minutes: 0 });
    yes('a profile no account holds has no account to ban, and says so', r.status === 404);
    r = await game('ban', { profileId: 7007, name: 'Stranger', byProfileId: 1001, byName: 'Aela', why: 'cheating', minutes: 0 });
    yes('a profile no account holds is banned by itself, for good',
        r.status === 200 && r.j.until === 0 && readData('bans.json', {})['p:7007'].until === 0);
    r = await allowed();
    yes('and the door is sent that ban too', (r.j.bans || []).some((b) => b.profiles.indexOf(7007) >= 0 && b.until === 0));

    // A ban that has run out lets them back in, straight away.
    bans = readData('bans.json', {});
    bans[BJORN_D].until = Date.now() + 1200;
    fs.writeFileSync(path.join(DATA, 'bans.json'), JSON.stringify(bans));
    r = await allowed();
    yes('a ban with a moment left still keeps them out', r.j.profiles.indexOf(2002) < 0);
    await wait(1600);
    r = await allowed();
    yes('once it has run out they are back on the list', r.j.profiles.indexOf(2002) >= 0 && r.j.profiles.indexOf(2003) >= 0);
    yes('and it is not sent to the door any more', !(r.j.bans || []).some((b) => b.profiles.indexOf(2002) >= 0));

    r = await game('note', { profileId: 2002, name: 'Bjorn', byProfileId: 1001, byName: 'Aela', text: 'asked twice about the bridge' });
    const notes = readData('notes.json', {});
    yes('a note from the game is kept against the account, with author and time',
        r.status === 200 && notes[BJORN_D] && notes[BJORN_D][0].text === 'asked twice about the bridge' &&
        notes[BJORN_D][0].by === 'Aela' && Math.abs(notes[BJORN_D][0].at - Date.now()) < 10000);
    r = await game('note', { profileId: 2002, byProfileId: 1001, text: '' });
    yes('an empty note is refused', r.status === 400);

    console.log('\nthe site, from the hub:');
    const staffC = { Cookie: cookieFor(STAFF_D, 'Aela') };
    const plainC = { Cookie: cookieFor(NOBODY_D, 'Nobody') };
    r = await request(port, 'GET', '/api/staff/records');
    yes('the records need a sign in', r.status === 401);
    r = await request(port, 'GET', '/api/staff/records', plainC);
    yes('and somebody with no staff role cannot read them', r.status === 401 || r.status === 403);
    r = await request(port, 'POST', '/api/staff/note', plainC, { id: BJORN_D, text: 'x' });
    yes('nor write one', (r.status === 401 || r.status === 403) && readData('notes.json', {})[BJORN_D].length === 1);
    r = await request(port, 'GET', '/api/staff/records', staffC);
    yes('staff read every ban and note', r.status === 200 && r.j.notes[BJORN_D].length === 1 && r.j.bans[BJORN_D] &&
        r.j.bans[BJORN_D].active === false && r.j.bans['p:7007'].active === true);
    r = await request(port, 'POST', '/api/staff/ban', staffC, { id: NOBODY_D, minutes: 1440, why: 'harassing people at the inn' });
    yes('a ban from the hub is taken, for a day', r.status === 200 && Math.abs(r.j.until - (Date.now() + 1440 * 60000)) < 10000);
    r = await request(port, 'POST', '/api/staff/ban', staffC, { id: '999999999', minutes: 0, why: 'x' });
    yes('an id nobody linked is refused', r.status === 404);
    r = await allowed();
    yes('and the door leaves them out', r.j.profiles.indexOf(3003) < 0);
    r = await request(port, 'POST', '/api/staff/note', staffC, { id: NOBODY_D, text: 'warned in person first' });
    yes('a note from the hub is kept', r.status === 200 && readData('notes.json', {})[NOBODY_D][0].by === 'Aela');
    r = await request(port, 'GET', '/api/all', staffC);
    yes('the hub\'s page data carries the records for the Linked accounts page',
        r.status === 200 && r.j.records && r.j.records.bans[NOBODY_D].active === true &&
        r.j.records.notes[NOBODY_D][0].text === 'warned in person first');
    r = await request(port, 'POST', '/api/staff/unban', staffC, { id: NOBODY_D });
    yes('lifting it from the hub works', r.status === 200 && r.j.was === true);
    r = await allowed();
    yes('and they are back on the door\'s list', r.j.profiles.indexOf(3003) >= 0);
    const hubLog = fs.readFileSync(path.join(DATA, 'for-bot', 'moderation.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    yes('what the hub did is in moderation.log for the staff channel: account ban, note, account lift',
        hubLog.map((l) => l.did).join(',') === 'banaccount,note,unbanaccount' && hubLog[0].byName === 'Aela' &&
        hubLog[0].whoName === 'Nobody' && /until .*: harassing people at the inn/.test(hubLog[0].why));

    // ------------------------------------------------ 2. the staff block --
    console.log('\nthe game:');
    fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'http://127.0.0.1:' + port, key: KEY }));
    let w = loadStaff();
    yes('the block loads', !!(w.api && w.api.command && w.api.banSweep));
    yes('ban lengths read the way staff type them',
        w.api.banLength('30m') === 30 && w.api.banLength('2h') === 120 && w.api.banLength('3d') === 4320 &&
        w.api.banLength('1w') === 10080 && w.api.banLength('forever') === 0 && w.api.banLength('soon') === -1);

    staffLine(w, '/ban Bjorn 3d', 3003);
    yes('/ban from somebody who is not staff: "That one is not yours to run."',
        w.to(3003)[0] === 'That one is not yours to run.');
    staffLine(w, '/ban Bjorn 3d spam', 1001, false);
    yes('/ban from staff whose connection is not proven is refused', /proved who you are/.test(w.to(1001)[0] || ''));
    staffLine(w, '/ban Bjorn spam');
    yes('/ban with no length asks for one', /Say how long and why/.test(w.to(1001).slice(-1)[0] || ''));

    staffLine(w, '/ban Bjorn 3d spamming the market again');
    yes('/ban reaches the site and answers the moderator in their chat',
        await until(() => w.to(1001).some((t) => /^Banned the character Bjorn until .* UTC\. Their other characters can still play\.$/.test(t))));
    yes('the site holds it for three days, on the character', Math.abs(readData('bans.json', {})['p:2002'].until - (Date.now() + 4320 * 60000)) < 20000);
    yes('Bjorn is told why and until when, in his chat',
        w.to(2002).some((t) => /^Staff have banned this character until .* UTC: spamming the market again\. Your session is being ended\./.test(t)));
    const kick = w.timeouts.find((t) => t.ms > 1000);
    yes('and nobody is disconnected until he has had time to read it', !!kick && w.kicked.length === 0);
    if (kick) kick.fn();
    yes('then his session is ended', w.kicked.indexOf(70 + 2002) >= 0);
    let log = modlog();
    yes('the ban is in moderation.log for the staff channel, with until and why',
        log.length && log[log.length - 1].did === 'ban' && log[log.length - 1].who === 2002 &&
        /until .*: spamming the market again/.test(log[log.length - 1].why));

    staffLine(w, '/note Bjorn keeps coming back under other names');
    yes('/note is kept on the site and answered',
        await until(() => w.to(1001).some((t) => /^Noted against Bjorn\./.test(t))) &&
        readData('notes.json', {})[BJORN_D][0].text === 'keeps coming back under other names');
    staffLine(w, '/unban Bjorn');
    yes('/unban lifts it on the site and says so',
        await until(() => w.to(1001).some((t) => t === 'The ban on the character Bjorn is lifted.')) &&
        !readData('bans.json', {})['p:2002']);
    log = modlog();
    yes('both are in moderation.log', log.slice(-2).map((l) => l.did).join(',') === 'note,unban');

    // The sweep: anybody the door's list says is banned, whenever it was made.
    fs.writeFileSync(path.join(PRIV, 'allowed.json'), JSON.stringify({ profiles: [], bans: [
      { profiles: [4004], why: 'cheating', until: Date.now() + 3600000 },
      { profiles: [5005], why: 'long over', until: Date.now() - 1000 }
    ] }));
    w = loadStaff();
    w.api.banSweep();
    yes('the sweep tells somebody banned on the site why, and ends the session',
        /You are banned from Thornswood until .* UTC: cheating\./.test(w.to(4004)[0] || '') &&
        w.timeouts.length === 1);
    yes('and leaves alone somebody whose ban has run out', !w.to(5005).length);
    w.api.banSweep();
    yes('and does not tell them twice while they are on their way out', w.to(4004).length === 1);
    yes('every line said is in plain words', w.said.every((s) => fair(s.text)));

    // ------------------------------------------------ 3. the hub page --
    console.log('\nthe Linked accounts page:');
    const page = fs.readFileSync(PAGE, 'utf8');
    function grab(name) {
      const at = page.indexOf('function ' + name + '(');
      if (at < 0) return null;
      const b = page.indexOf('{', at);
      let d = 0;
      for (let i = b; i < page.length; i++) {
        if (page[i] === '{') d++;
        else if (page[i] === '}') { d--; if (d === 0) return page.slice(at, i + 1); }
      }
      return null;
    }
    const escM = /var esc = function \(s\) \{[\s\S]*?\n\};/.exec(page);
    const fns = ['banUntil', 'byLine', 'charName', 'charLine', 'linkedNotes', 'lengthPick',
                 'linkedControls', 'looseBans'].map(grab);
    yes('the page has a Notes line and its controls', !!escM && fns.every(Boolean));
    if (escM && fns.every(Boolean)) {
      const P = new Function(escM[0] + '\n' + fns.join('\n') +
        '\nreturn { linkedNotes: linkedNotes, linkedControls: linkedControls, looseBans: looseBans };')();
      const rec = {
        bans: { [BJORN_D]: { active: true, until: 0, why: 'cheating <b>hard</b>', by: 'Aela', from: 'the live server', at: Date.now() },
                [NOBODY_D]: { active: false, until: Date.now() - 1000, why: 'old', by: 'Aela' },
                'p:7007': { active: true, until: 0, why: 'stranger', by: 'Aela', name: 'Stranger' } },
        notes: { [BJORN_D]: [{ text: 'second note', by: 'Farkas', at: Date.now() }, { text: 'first <script>', by: 'Aela', at: Date.now() - 60000 }] }
      };
      const line = P.linkedNotes({ id: BJORN_D }, rec, Date.now());
      yes('a banned account\'s Notes line says banned, for good, why and by whom',
          /<b>Notes<\/b>/.test(line) &&
          /Account banned for good, every character on it: cheating &lt;b&gt;hard&lt;\/b&gt; \(by Aela, from the live server/.test(line));
      yes('and every note, newest first, with its author', line.indexOf('second note') < line.indexOf('first') &&
          /second note <span class="said">\(Farkas, /.test(line) && /\(Aela, /.test(line));
      yes('with nothing anybody typed let through as markup', line.indexOf('<script>') < 0 && line.indexOf('&lt;script&gt;') >= 0);
      const timed = P.linkedNotes({ id: BJORN_D }, { bans: { [BJORN_D]: { active: true, until: Date.now() + 86400000, why: 'x', by: 'A' } }, notes: {} }, Date.now());
      yes('a timed ban says until when', /Account banned until /.test(timed));
      yes('a ban that has ended says it has ended', /has ended: old/.test(P.linkedNotes({ id: NOBODY_D }, rec, Date.now())));
      yes('an account with neither says no notes yet', /no notes yet/.test(P.linkedNotes({ id: STAFF_D }, rec, Date.now())));
      const ctl = P.linkedControls({ id: BJORN_D }, rec, Date.now());
      yes('the controls add a note, ban for a chosen time, and lift a ban that holds',
          /data-act="note"/.test(ctl) && /data-act="ban"/.test(ctl) && /data-act="unban"/.test(ctl) &&
          /value="0">for good/.test(ctl) && /value="1440">1 day/.test(ctl));
      yes('there is no Lift ban where nothing holds', !/data-act="unban"/.test(P.linkedControls({ id: STAFF_D }, rec, Date.now())));
      yes('a ban against a profile no account holds is listed by profile', /Profile 7007 \(Stranger\): banned for good: stranger/.test(P.looseBans(rec, Date.now())));
      yes('the page\'s words are plain', fair(line) && fair(ctl) && fair(page.slice(page.indexOf('function drawLinked'), page.indexOf('function wireLinked'))));
      yes('the Linked accounts page draws the Notes line under every account',
          /linkedNotes\(u, S\.records, Date\.now\(\)\)/.test(grab('drawLinked') || ''));
    }

    // ------------------------------------------------ 4. the door keeps them --
    const doorWrite = src.slice(src.indexOf('mp.writeFileWhole(FILE, JSON.stringify({'), src.indexOf("note: 'Written by the gamemode from the site."));
    yes('the door writes the site\'s bans into allowed.json', /bans: Array\.isArray\(doc\.bans\) \? doc\.bans : \[\]/.test(doorWrite));
    const W = (() => { const m = src.match(/const WORDS = (\[[\s\S]*?\]);/); return m ? new Function('return ' + m[1])() : []; })();
    const PW = (() => { const m = src.match(/const PLAYER_WORDS = (\[[\s\S]*?\]);/); return m ? new Function('return ' + m[1])() : []; })();
    yes('the server answers /ban, /unban and /note, and does not offer them to everybody',
        ['/ban', '/unban', '/note'].every((x) => W.indexOf(x) >= 0 && PW.indexOf(x) < 0));
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
