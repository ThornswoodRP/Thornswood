'use strict';
/*
  test-hub-staff-gallery.js

      node .\site\tests\test-hub-staff-gallery.js
      node .\site\tests\test-hub-staff-gallery.js <an older server.js>

  The two halves of staff and the gallery, against a real copy of site\server.js
  in a scratch folder on a spare port, with a stub standing in for Discord so a
  Loremaster exists without anybody being in a real server.

  #742. LEVEL.uploads was 'admin' while every gallery door behind that page
  asked for w.dev, so a Gamemaster, Moderator or Loremaster could approve and
  delete by API and could not open the page that does it: the hub sent them to
  its home. The launcher's Manage on the site button opens that same address,
  /uploads, so for those roles it opened a page they were bounced off. The page
  is 'staff' now and matches the doors.

  #743. Those doors read the twa cookie only. The launcher never has one: the
  Discord callback mints the cookie on the browser and hands the launcher a
  signed ticket. So they take a ticket too now, checked the way
  /api/gallery/report checks its own, with st.dev asked of it rather than
  st.play.

  What it proves, live:
    - a Loremaster cookie opens /api/all, is told the Gallery page is 'staff',
      and gets none of the member or admin material with it;
    - a Playtester cookie is still 401 sign in first, so the hub did not open
      to everybody allowed into the game;
    - an Owner cookie still gets everything it got before;
    - the member and admin doors below the hub gate still refuse that
      Loremaster: the uploads door, the test marks and the sign-in log;
    - every staff gallery door takes the Loremaster cookie, takes a Loremaster
      ticket with no cookie at all, and refuses a Playtester ticket and a
      ticket for somebody who is not in the Discord.

  And, by reading the files, that the hub page draws the three tiers and that
  the launcher's Manage on the site button still points at /uploads.

  Nothing leaves the machine: a stub loaded ahead of the site answers the two
  Discord addresses standing() needs and makes any other request fail. Every
  copy is under the temp folder and removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'site');
const SITE_SRC = process.argv[2] || path.join(APP, 'server.js');
// The hub as it reaches the browser: index.html and hub.js, where its script
// moved in #1479 (no inline script under the content security policy).
const HUB = fs.readFileSync(path.join(APP, 'public', 'index.html'), 'utf8') + '\n' +
            fs.readFileSync(path.join(APP, 'public', 'hub.js'), 'utf8');
const SERVER = siteFiles.source(SITE_SRC);
const GALLERY_CS = fs.readFileSync(path.join(ROOT, 'launcher', 'app', 'Gallery.cs'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- what the files say ----------------------------------------------------
// Linked accounts became a staff page with #1010: every staff role bans and
// PKs there. Sessions and the inbox stay admin.
yes('the hub Gallery and Linked accounts pages are staff pages and the other two stay admin',
    /uploads: 'staff', linked: 'staff', sessions: 'admin', inbox: 'admin'/.test(SERVER));
yes('the page gate reads admin as the admin pair and staff as w.dev',
    /LEVEL\[key\] === 'admin' \? !!w\.admin/.test(SERVER) &&
    /LEVEL\[key\] === 'staff' \? !!w\.dev/.test(SERVER));
yes('the hub api gate lets staff in as well as a member',
    /if \(!w\.member && !w\.dev\) return sendJson\(res, 401, \{ error: 'sign in first' \}\);/.test(SERVER));
yes('the test marks stay a member door under it',
    /if \(!w\.member\) return sendJson\(res, 403, \{ error: 'hub members only' \}\);/.test(SERVER));
yes('the member lists in /api/all are held back from staff who are not members',
    /results: w\.member \?/.test(SERVER) && /files: w\.member \?/.test(SERVER) &&
    /uploads: w\.member \?/.test(SERVER));

yes('the uploads door sends a waiting shot through the one staff gate, not a second check of its own',
    /const gs = waiting \? await galleryStaff\(url, w\) : null;/.test(SERVER) &&
    (SERVER.match(/await galleryStaff\(url, w\)/g) || []).length === 6);

yes('the hub page knows a staff page from an admin one',
    /if \(S\.level\[k\] === 'staff'\) return !!\(S\.me\.dev \|\| S\.me\.admin\);/.test(HUB));
yes('and has one answer for who the hub opens for at all',
    /function inHub\(\) \{ return !!\(S\.me\.admin \|\| S\.me\.dev\); \}/.test(HUB));
yes('the home cards are drawn for staff, not for admins alone',
    /if \(inHub\(\)\) \{\s*\n\s*out \+= '<div class="cards">'/.test(HUB));
yes('the corner says signed in for staff rather than offering them a sign in',
    /el\('whoami'\)\.innerHTML = inHub\(\)/.test(HUB));
yes('a tab, a card and a page heading say which level they are',
    (HUB.match(/levelTag\(/g) || []).length >= 4);
yes('nothing in the hub page says admin where the server said staff',
    !/S\.level\[k\] === 'admin' \? '<span/.test(HUB) &&
    !/S\.level\[S\.at\] === 'admin' \?/.test(HUB));
yes('Manage on the site in the launcher still opens /uploads',
    /public static string StaffPage \{ get \{ return Discord\.Site \+ "\/uploads"; \} \}/.test(GALLERY_CS));
yes('no em dash in the site the hub page is written with',
    !/[\u2014]/.test(HUB) && !/[\u2014]/.test(SERVER));

// ---- the scratch site ------------------------------------------------------
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-hub-staff-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '111111111111111111';
const LORE_ID = '222222222222222222';
const TESTER_ID = '333333333333333333';
const STRANGER_ID = '444444444444444444';
const OUTBOUND = path.join(dir, 'outbound.txt');

siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
// A client id and secret, so Discord sign in is on and the password door is
// off, the way the live site runs. A bot token and a guild, so standing()
// asks the stub for the roles and decides from them. Nobody on the hand
// written admin list, so no account is short circuited into being staff.
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: GUILD, invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));
// Two files in uploads, so "the member list came back" and "it came back empty"
// are two different answers, and so the shot waiting on a decision and a file
// that is nobody's business but a member's are two different names (#755).
fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
fs.writeFileSync(path.join(dir, 'uploads', 'a-shot.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
fs.writeFileSync(path.join(dir, 'uploads', 'a-log.txt'), 'a launcher log, not a gallery shot\n');
fs.writeFileSync(path.join(dir, 'uploads', 'uploads.json'), JSON.stringify({
  'a-shot.png': { orig: 'a-shot.png', by: 'Djinn', note: '', at: Date.now() },
  'a-log.txt': { orig: 'launcher.log', by: 'Djinn', note: '', at: Date.now() }
}));
fs.writeFileSync(path.join(dir, 'data', 'gallery-pending.json'), JSON.stringify([
  { name: 'a-shot.png', by: 'Djinn', note: '', at: Date.now(), from: 'web' }
]));

/* Loaded into the site with -r, ahead of server.js, the way
   test-site-auth.js does it. Written out from this function's own text so it
   is plain code here rather than a string. It answers the two addresses
   standing() needs and nothing else, and writes down anything else that was
   tried so the last check can prove nothing left the machine. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const say = (line) => { try { require('fs').appendFileSync(process.env.TS_STUB_LOG, line + '\n'); } catch (e) { } };
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r1', name: 'Owner' }, { id: 'r2', name: 'Loremaster' },
                 { id: 'r3', name: 'Playtester' }];
  const member = (id, name, roles) =>
    ({ nick: name, roles: roles, user: { id: id, username: name.toLowerCase(), global_name: name } });
  const MEMBERS = [
    member(process.env.TS_STUB_OWNER, 'Owner', ['r1']),
    member(process.env.TS_STUB_LORE, 'Lore', ['r2']),
    member(process.env.TS_STUB_TESTER, 'Tester', ['r3'])
  ];
  function answer(where) {
    // The startup check, the roles and the whole member list: the three the
    // site asks for with a bot token set.
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
      // The Release list too: the site looks there for the installer when a
      // page lists the downloads (newestSetup, #4824), and is told there is
      // no Release yet.
      const body = host === 'discord.com' ? answer(where)
        : host === 'api.github.com' && /^\/repos\/ThornswoodRP\/Thornswood\/releases\?/.test(where) ? []
        : null;
      say((body ? 'STUBBED ' : 'OUTBOUND ') + host + where);
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
fs.writeFileSync(path.join(dir, 'stub.js'), '(' + stub.toString() + ')();\n');

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
// The twa cookie the Discord callback would set, built with this copy's secret.
const cookieFor = (id, name) => {
  const at = Date.now();
  const raw = id + '|' + name + '|' + at + '|' + sign(id + '|' + name + '|' + at);
  return 'twa=' + encodeURIComponent(raw);
};
// The ticket the launcher keeps, the same shape makeTicket writes.
function ticket(id, name) {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: String(name || 'x'), x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + b + '.' + sign('ticket:' + b);
}
const q = (id, name) => '?ticket=' + encodeURIComponent(ticket(id, name));

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function wait(ms) { return new Promise((ok) => setTimeout(ok, ms)); }

let PORT = 0;
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : Buffer.from(body);
    const h = Object.assign({}, headers || {});
    if (data && h['content-length'] === undefined) h['content-length'] = data.length;
    // A browser names the page that sent a signed in write, and the site
    // refuses one that names no page (#1367). These come from its own pages.
    if (method !== 'GET' && h.origin === undefined &&
        Object.keys(h).some((k) => k.toLowerCase() === 'cookie')) h.origin = 'http://127.0.0.1:' + PORT;
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
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), 'server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT),
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
      TS_STUB_LOG: OUTBOUND,
      TS_STUB_GUILD: GUILD,
      TS_STUB_OWNER: OWNER_ID,
      TS_STUB_LORE: LORE_ID,
      TS_STUB_TESTER: TESTER_ID
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

    // The stub is answering and the roles are being read, or nothing below
    // means anything.
    let r = await ask('GET', '/api/hello', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('the stub stands in for Discord: a Loremaster cookie reads as staff and not as an admin',
        r.json && r.json.dev === true && r.json.admin === false && r.json.play === true);

    // ---- the hub gate (#742) -------------------------------------------------
    r = await ask('GET', '/api/all', { cookie: cookieFor(LORE_ID, 'Lore') });
    const lore = r.json || {};
    yes('a Loremaster opens the hub api (' + r.status + ')', r.status === 200);
    yes('and is told the Gallery page is a staff page',
        lore.level && lore.level.uploads === 'staff');
    yes('and that Linked accounts is a staff page too (#1010), and the other two are admin',
        lore.level && lore.level.linked === 'staff' && lore.level.sessions === 'admin' &&
        lore.level.inbox === 'admin');
    yes('and is handed who the server says they are, staff and not admin',
        lore.me && lore.me.dev === true && lore.me.admin === false);
    yes('and none of the member material comes with it',
        JSON.stringify(lore.results) === '{}' &&
        Array.isArray(lore.files) && lore.files.length === 0 &&
        Array.isArray(lore.uploads) && lore.uploads.length === 0);
    yes('and none of the admin material either',
        Array.isArray(lore.sessions) && lore.sessions.length === 0 &&
        Array.isArray(lore.inbox) && lore.inbox.length === 0);
    yes('but the linked accounts and the staff records, bans, PKs and notes, do come to a Loremaster (#1010)',
        Array.isArray(lore.linked) && lore.records && typeof lore.records.bans === 'object' &&
        typeof lore.records.pk === 'object' && typeof lore.records.notes === 'object');
    r = await ask('GET', '/api/staff/records', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('and a Loremaster reads the records directly (' + r.status + ')', r.status === 200 && r.json && !!r.json.notes);
    r = await ask('GET', '/api/staff/records', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('a Playtester cannot read the records, notes included (' + r.status + ')', r.status === 401 || r.status === 403);
    yes('and no document or board is sent to them',
        JSON.stringify(lore.docs) === '{}' && JSON.stringify(lore.boards) === '{}');

    r = await ask('GET', '/api/all', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('a Playtester is still turned away from the hub api (' + r.status + ')',
        r.status === 401 && r.json && r.json.error === 'sign in first');
    r = await ask('GET', '/api/all');
    yes('and so is nobody at all (' + r.status + ')',
        r.status === 401 && r.json && r.json.error === 'sign in first');

    r = await ask('GET', '/api/all', { cookie: cookieFor(OWNER_ID, 'Owner') });
    const owner = r.json || {};
    yes('an Owner still gets the whole hub (' + r.status + ')',
        r.status === 200 && owner.me && owner.me.admin === true);
    yes('the uploads list among it, the two this copy has on disk',
        Array.isArray(owner.uploads) && owner.uploads.length === 2 &&
        owner.uploads.some((u) => u.name === 'a-shot.png') &&
        owner.uploads.some((u) => u.name === 'a-log.txt'));

    // The doors under the hub gate that are not staff doors stay where they were.
    r = await ask('PUT', '/api/results', { cookie: cookieFor(LORE_ID, 'Lore'), 'content-type': 'application/json' },
                  JSON.stringify({ 'test 1': { status: 'pass' } }));
    yes('a Loremaster cannot write the test marks (' + r.status + ')',
        r.status === 403 && r.json && r.json.error === 'hub members only');
    r = await ask('PUT', '/api/results', { cookie: cookieFor(OWNER_ID, 'Owner'), 'content-type': 'application/json' },
                  JSON.stringify({ 'test 1': { status: 'pass' } }));
    yes('an Owner still can (' + r.status + ')', r.status === 200);
    r = await ask('POST', '/api/upload?name=x.log', { cookie: cookieFor(LORE_ID, 'Lore') }, 'hello');
    yes('the uploads door is still a member door (' + r.status + ')',
        r.status === 401 && r.json && r.json.error === 'sign in first');
    r = await ask('GET', '/api/signins', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('the sign-in log is still admins only (' + r.status + ')',
        r.status === 403 && r.json && r.json.error === 'admins only');

    // ---- the staff doors, cookie and ticket (#743) ---------------------------
    r = await ask('GET', '/api/gallery/pending', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('a Loremaster cookie reads the gallery queue (' + r.status + ')',
        r.status === 200 && r.json && r.json.pending.length === 1);
    r = await ask('GET', '/api/gallery/pending', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('a Playtester cookie does not (' + r.status + ')',
        r.status === 403 && r.json && r.json.error === 'staff only');

    r = await ask('GET', '/api/gallery/pending' + q(LORE_ID, 'Lore'));
    yes('a Loremaster ticket with no cookie at all reads it (' + r.status + ')',
        r.status === 200 && r.json && r.json.pending.length === 1);
    r = await ask('GET', '/api/gallery/reports' + q(LORE_ID, 'Lore'));
    yes('and lists the reports (' + r.status + ')',
        r.status === 200 && r.json && Array.isArray(r.json.reports));
    r = await ask('GET', '/api/gallery/pending' + q(TESTER_ID, 'Tester'));
    yes('a Playtester ticket is refused, and told it is the role (' + r.status + ')',
        r.status === 403 && r.json && r.json.why === 'role');
    r = await ask('GET', '/api/gallery/pending' + q(STRANGER_ID, 'Stranger'));
    yes('a ticket for somebody the Discord has never heard of is refused (' + r.status + ')',
        r.status === 403 && r.json && r.json.why === 'guild');

    // ---- the picture itself, /up (#755) --------------------------------------
    // The queue page draws every waiting shot as /up/<name>, and the launcher
    // asks for the same address with its ticket. Both were refused while this
    // door asked w.member alone.
    r = await ask('GET', '/up/a-shot.png', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('a Loremaster cookie loads the shot that is waiting (' + r.status + ')',
        r.status === 200 && r.body.indexOf('PNG') >= 0);
    r = await ask('GET', '/up/a-shot.png' + q(LORE_ID, 'Lore'));
    yes('a Loremaster ticket with no cookie at all loads it too (' + r.status + ')',
        r.status === 200 && r.body.indexOf('PNG') >= 0);
    r = await ask('GET', '/up/a-shot.png' + q(TESTER_ID, 'Tester'));
    yes('a Playtester ticket does not, and is told it is the role (' + r.status + ')',
        r.status === 403 && /staff role/.test(r.body));
    r = await ask('GET', '/up/a-shot.png' + q(STRANGER_ID, 'Stranger'));
    yes('nor a ticket for somebody the Discord has never heard of (' + r.status + ')',
        r.status === 403 && /not in the Thornswood Discord/.test(r.body));
    r = await ask('GET', '/up/a-shot.png');
    yes('nor nobody at all (' + r.status + ')',
        r.status === 401 && r.body === 'sign in first');
    r = await ask('GET', '/up/a-shot.png', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('nor a Playtester cookie (' + r.status + ')',
        r.status === 401 && r.body === 'sign in first');

    // Only the queue opens. The rest of uploads is the member cookie it always
    // was, and a name nobody is waiting on tells a stranger nothing either.
    r = await ask('GET', '/up/a-log.txt', { cookie: cookieFor(LORE_ID, 'Lore') });
    yes('a Loremaster still cannot read a file that is not a waiting shot (' + r.status + ')',
        r.status === 401 && r.body === 'sign in first');
    r = await ask('GET', '/up/a-log.txt' + q(LORE_ID, 'Lore'));
    yes('and neither can that Loremaster ticket (' + r.status + ')',
        r.status === 401 && r.body === 'sign in first');
    r = await ask('GET', '/up/a-log.txt', { cookie: cookieFor(OWNER_ID, 'Owner') });
    yes('an Owner reads it the way it always did (' + r.status + ')',
        r.status === 200 && /launcher log/.test(r.body));
    r = await ask('GET', '/up/a-shot.png', { cookie: cookieFor(OWNER_ID, 'Owner') });
    yes('and the shot with it (' + r.status + ')', r.status === 200);

    r = await ask('POST', '/api/gallery/approve' + q(LORE_ID, 'Lore'), asJson,
                  JSON.stringify({ name: 'a-shot.png' }));
    yes('a Loremaster ticket approves what is waiting (' + r.status + ')',
        r.status === 200 && r.json && r.json.approved === true);
    let gal = [];
    try { gal = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'gallery.json'), 'utf8')); } catch (e) { }
    yes('and the shot is on the public gallery', gal.some((g) => g.name === 'a-shot.png'));
    // Off the queue, so /up closes behind it again and /shot is where it lives.
    r = await ask('GET', '/up/a-shot.png' + q(LORE_ID, 'Lore'));
    yes('once approved it is no longer a waiting shot, so /up closes again (' + r.status + ')',
        r.status === 401 && r.body === 'sign in first');
    r = await ask('GET', '/shot/a-shot.png');
    yes('and anybody at all reads it at /shot (' + r.status + ')', r.status === 200);
    r = await ask('DELETE', '/api/gallery/approved' + q(TESTER_ID, 'Tester'), asJson,
                  JSON.stringify({ name: 'a-shot.png' }));
    yes('a Playtester ticket cannot take it back down (' + r.status + ')', r.status === 403);
    r = await ask('DELETE', '/api/gallery/approved' + q(LORE_ID, 'Lore'), asJson,
                  JSON.stringify({ name: 'a-shot.png' }));
    yes('a Loremaster ticket can (' + r.status + ')', r.status === 200 && r.json && r.json.removed === 1);

    // ---- nothing left the machine -------------------------------------------
    let log = '';
    try { log = fs.readFileSync(OUTBOUND, 'utf8'); } catch (e) { }
    yes('every Discord call went to the stub and nothing else was tried',
        log.indexOf('STUBBED ') >= 0 && log.indexOf('OUTBOUND ') < 0);
    if (log.indexOf('OUTBOUND ') >= 0) console.log('what was tried:\n' + log);

  } catch (e) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (e && e.stack ? e.stack : e));
  }

  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
