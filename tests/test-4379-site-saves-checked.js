'use strict';
/*
  test-4379-site-saves-checked.js

      node tests\test-4379-site-saves-checked.js

  Issue #4379. Eleven saves in site\lib\serve.js wrote a file and answered
  ok without looking at what putJson said, so a save that failed was told
  to the caller as done. The worst was the gallery Accept: it wrote the
  gallery and took the picture off the waiting list without reading either
  result, so a gallery that would not write lost the picture from both lists
  while staff were told it was accepted.

  A real copy of the site runs in a scratch folder (tests\site-files.js),
  with Discord stood in for in the process the way
  site\tests\test-hub-staff-gallery.js does it. A second preload makes the
  site's writes to the files the harness names fail, as a folder the site
  cannot write does: fs.writeFileSync throws EACCES for that file and its
  same-folder temp copy, which is where putJson writes first. It is a
  preload rather than a read only folder because a read only folder stops
  nothing for root, and Windows does not apply it to a folder at all.

  For each save, with its file refused, the answer is not ok, and what was
  on disk is still there:
    A  Accept, with the gallery refused: an error, the picture still
       waiting and not on the gallery. With the waiting list refused: an
       error, and the picture is on the gallery and still waiting, so a
       second Accept finishes it. With nothing refused it is accepted.
    B  Delete from the gallery, with the gallery, the waiting list or the
       reports refused: an error each time, and the picture, its file and
       its reports where they were.
    C  Report a picture, and dismiss a report, with the reports refused.
    D  Send a file to /api/upload, and delete one, with uploads.json
       refused.
    E  The roster a game server sends, with roster.json refused.
    F  The Discord sign-in, with linked.json refused: no sign-in cookie and
       an error page, where with nothing refused it signs in.
  Then each route once more with nothing refused, so an error above is the
  save and not a door that was shut anyway.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ') : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4379-'));
const DATA = path.join(dir, 'data');
const UP = path.join(dir, 'uploads');
const SECRET = crypto.randomBytes(32).toString('hex');
const BOT_KEY = crypto.randomBytes(16).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '111111111111111111';
const TESTER_ID = '333333333333333333';
const REFUSE = path.join(dir, 'refuse.json');

siteFiles.copy(dir);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UP, { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: GUILD, invite: '' },
  botKey: BOT_KEY,
  admins: [],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const NOW = Date.now();
const SHOTS = ['a-shot.png', 'b-shot.png', 'c-shot.png', 'd-shot.png'];
for (const n of SHOTS) fs.writeFileSync(path.join(UP, n), PNG);
fs.writeFileSync(path.join(UP, 'a-log.txt'), 'a launcher log\n');
const meta = { 'a-log.txt': { orig: 'launcher.log', by: 'Djinn', note: '', at: NOW } };
for (const n of SHOTS) meta[n] = { orig: n, by: 'Djinn', note: '', at: NOW };
fs.writeFileSync(path.join(UP, 'uploads.json'), JSON.stringify(meta));
const shown = (n) => ({ name: n, url: '/shot/' + n, by: 'Djinn' });
fs.writeFileSync(path.join(DATA, 'gallery.json'), JSON.stringify([shown('b-shot.png'), shown('d-shot.png')]));
const waiting = (n) => ({ name: n, by: 'Djinn', note: '', at: NOW, from: 'web' });
fs.writeFileSync(path.join(DATA, 'gallery-pending.json'), JSON.stringify([waiting('a-shot.png'), waiting('c-shot.png')]));
fs.writeFileSync(path.join(DATA, 'gallery-reports.json'), JSON.stringify([
  { id: 'r1', name: 'b-shot.png', why: 'harness', at: NOW, from: 'web' },
  { id: 'r2', name: 'd-shot.png', why: 'harness', at: NOW, from: 'web' }
]));
fs.writeFileSync(REFUSE, '[]');

/* Discord, in the site's process, as test-hub-staff-gallery.js has it: the
   guild, its roles and its members for standing(), and the sign-in's code
   exchange and who-am-I for the callback. Anything else is refused. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r1', name: 'Owner' }, { id: 'r3', name: 'Playtester' }];
  const member = (id, name, roles) =>
    ({ nick: name, roles: roles, user: { id: id, username: name.toLowerCase(), global_name: name } });
  const MEMBERS = [member(process.env.TS_STUB_OWNER, 'Owner', ['r1']),
                   member(process.env.TS_STUB_TESTER, 'Tester', ['r3'])];
  function answer(where) {
    if (where === '/api/v10/guilds/' + GUILD) return { id: GUILD, name: 'Thornswood (harness)' };
    if (where === '/api/v10/guilds/' + GUILD + '/roles') return ROLES;
    if (where === '/api/v10/guilds/' + GUILD + '/members?limit=1000') return MEMBERS;
    if (where === '/api/oauth2/token') return { access_token: 'harness-token', token_type: 'Bearer' };
    if (where === '/api/users/@me') return { id: process.env.TS_STUB_TESTER, username: 'tester', global_name: 'Tester' };
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
fs.writeFileSync(path.join(dir, 'stub.js'), '(' + stub.toString() + ')();\n');

/* The refused saves. The file names in TS_REFUSE are read on every write,
   so the harness changes them between requests. putJson writes a temp copy
   beside the file (.<name>.<pid>.tmp) and renames it, so that copy is
   refused too: the write fails where it starts, as in a folder the site
   cannot write. */
function refuse() {
  const fs = require('fs');
  const path = require('path');
  const real = fs.writeFileSync;
  const list = process.env.TS_REFUSE;
  fs.writeFileSync = function (p) {
    let names = [];
    try { names = JSON.parse(fs.readFileSync(list, 'utf8')); } catch (e) { names = []; }
    const base = typeof p === 'string' ? path.basename(p).replace(/^\.(.+)\.\d+\.tmp$/, '$1') : '';
    if (base && names.indexOf(base) >= 0) {
      const e = new Error('EACCES: permission denied, open \'' + p + '\'');
      e.code = 'EACCES';
      throw e;
    }
    return real.apply(this, arguments);
  };
}
fs.writeFileSync(path.join(dir, 'refuse.js'), '(' + refuse.toString() + ')();\n');
const refusing = (names) => fs.writeFileSync(REFUSE, JSON.stringify(names));

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const cookieFor = (id, name) => {
  const at = Date.now();
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sign(id + '|' + name + '|' + at));
};
function ticket(id, name) {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: String(name || 'x'), x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + b + '.' + sign('ticket:' + b);
}
const OWNER = () => cookieFor(OWNER_ID, 'Owner');
const TESTER_Q = () => '?ticket=' + encodeURIComponent(ticket(TESTER_ID, 'Tester'));

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

let PORT = 0;
let lane = 0;
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ 'x-forwarded-for': '10.43.79.' + (++lane % 250) }, headers || {});
    if (data && h['content-length'] === undefined) h['content-length'] = data.length;
    if (data && body !== undefined && typeof body !== 'string') h['content-type'] = 'application/json';
    // A signed in write names the page that sent it (#1367).
    if (method !== 'GET' && h.cookie && h.origin === undefined) h.origin = 'http://127.0.0.1:' + PORT;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { text += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          done({ status: res.statusCode, text: text, json: json, headers: res.headers });
        });
      });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } };
const names = (file) => (readJson(file) || []).map((x) => String(x.name));
const ids = (file) => (readJson(file) || []).map((x) => String(x.id));
const GALLERY = path.join(DATA, 'gallery.json');
const PENDING = path.join(DATA, 'gallery-pending.json');
const REPORTS = path.join(DATA, 'gallery-reports.json');
const UPMETA = path.join(UP, 'uploads.json');
const ROSTER = path.join(DATA, 'roster.json');
const LINKED = path.join(DATA, 'linked.json');
// Not ok: an error status, and no ok: true in the answer.
const refused = (r) => r.status >= 400 && !(r.json && r.json.ok === true);
const said = (r) => r.status + ' ' + r.text.slice(0, 300);
const setCookies = (r) => { const c = r.headers['set-cookie']; return Array.isArray(c) ? c : (c ? [c] : []); };
const signedIn = (r) => setCookies(r).some((c) => /^twa=[^;]+/.test(c));

async function signIn() {
  const begun = await ask('GET', '/auth/discord?back=/');
  let state = '';
  try { state = new URL(begun.headers.location).searchParams.get('state') || ''; } catch (e) { state = ''; }
  const cookie = String(setCookies(begun)[0] || '').split(';')[0];
  return ask('GET', '/auth/discord/callback?code=harness&state=' + encodeURIComponent(state), { cookie: cookie });
}
const roster = () => ({ key: BOT_KEY, server: 'main',
  who: { '5001': { name: 'Hilde', race: 'Nord', female: true, trade: '', town: 'Whiterun', where: '', at: Date.now() } } });

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), '-r', path.join(dir, 'refuse.js'), 'server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT),
      THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
      TS_STUB_GUILD: GUILD,
      TS_STUB_OWNER: OWNER_ID,
      TS_STUB_TESTER: TESTER_ID,
      TS_REFUSE: REFUSE
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });

  try {
    let up = false;
    for (let i = 0; i < 200 && !up; i++) {
      if (out.indexOf('listening on ') >= 0) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    let r = await ask('GET', '/api/hello', { cookie: OWNER() });
    yes('the stand-in Discord answers: the Owner cookie reads as staff', r.json && r.json.admin === true && r.json.dev === true, said(r));

    // ---- A: Accept ----------------------------------------------------------
    refusing(['gallery.json']);
    r = await ask('POST', '/api/gallery/approve', { cookie: OWNER() }, { name: 'a-shot.png' });
    yes('A1 Accept with the gallery refused is not answered ok (' + said(r) + ')', refused(r));
    yes('A2 and the picture is still waiting, and not on the gallery',
      names(PENDING).indexOf('a-shot.png') >= 0 && names(GALLERY).indexOf('a-shot.png') < 0,
      'waiting: ' + names(PENDING).join(', ') + '; gallery: ' + names(GALLERY).join(', '));
    refusing(['gallery-pending.json']);
    r = await ask('POST', '/api/gallery/approve', { cookie: OWNER() }, { name: 'a-shot.png' });
    yes('A3 Accept with the waiting list refused is not answered ok (' + said(r) + ')', refused(r));
    yes('A4 and the picture is on the gallery and still waiting, not lost from either',
      names(GALLERY).indexOf('a-shot.png') >= 0 && names(PENDING).indexOf('a-shot.png') >= 0,
      'waiting: ' + names(PENDING).join(', ') + '; gallery: ' + names(GALLERY).join(', '));

    // ---- B: Delete from the gallery ----------------------------------------
    refusing(['gallery.json']);
    r = await ask('DELETE', '/api/gallery/approved', { cookie: OWNER() }, { name: 'b-shot.png' });
    yes('B1 Delete with the gallery refused is not answered ok (' + said(r) + ')', refused(r));
    yes('B2 and the picture is still on the gallery, its file and its report still there',
      names(GALLERY).indexOf('b-shot.png') >= 0 && fs.existsSync(path.join(UP, 'b-shot.png')) && ids(REPORTS).indexOf('r1') >= 0);
    refusing(['gallery-pending.json']);
    r = await ask('DELETE', '/api/gallery/approved', { cookie: OWNER() }, { name: 'c-shot.png' });
    yes('B3 Delete with the waiting list refused is not answered ok (' + said(r) + ')', refused(r));
    yes('B4 and the picture is still waiting, its file still there',
      names(PENDING).indexOf('c-shot.png') >= 0 && fs.existsSync(path.join(UP, 'c-shot.png')));
    refusing(['gallery-reports.json']);
    r = await ask('DELETE', '/api/gallery/approved', { cookie: OWNER() }, { name: 'd-shot.png' });
    yes('B5 Delete with the reports refused is not answered ok (' + said(r) + ')', refused(r));
    yes('B6 and its report is still there', ids(REPORTS).indexOf('r2') >= 0);

    // ---- C: reports ---------------------------------------------------------
    refusing(['gallery-reports.json']);
    const before = ids(REPORTS).length;
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, { name: 'b-shot.png', why: 'harness' });
    yes('C1 a report with the reports refused is not answered ok (' + said(r) + ')', refused(r));
    yes('C2 and no report was added', ids(REPORTS).length === before);
    r = await ask('POST', '/api/gallery/report/dismiss', { cookie: OWNER() }, { id: 'r1' });
    yes('C3 a dismiss with the reports refused is not answered ok (' + said(r) + ')', refused(r));
    yes('C4 and the report is still there', ids(REPORTS).indexOf('r1') >= 0);

    // ---- D: uploads ---------------------------------------------------------
    refusing(['uploads.json']);
    r = await ask('POST', '/api/upload?name=notes.txt&by=Djinn', { cookie: OWNER() }, 'a file sent by the harness');
    yes('D1 an upload whose note is refused is not answered ok (' + said(r) + ')', refused(r));
    r = await ask('DELETE', '/api/upload/a-log.txt', { cookie: OWNER() });
    yes('D2 a delete whose note is refused is not answered ok (' + said(r) + ')', refused(r));
    yes('D3 and the note is still listed', !!(readJson(UPMETA) || {})['a-log.txt']);

    // ---- E: the roster ------------------------------------------------------
    refusing(['roster.json']);
    r = await ask('POST', '/api/roster', {}, roster());
    yes('E1 a roster with roster.json refused is not answered ok (' + said(r) + ')', refused(r));
    yes('E2 and nothing was written', !fs.existsSync(ROSTER));

    // ---- F: the Discord sign-in ---------------------------------------------
    refusing(['linked.json']);
    r = await signIn();
    yes('F1 a sign-in whose linked account is refused is not signed in (' + r.status + ', ' + (r.headers.location || 'no redirect') + ')',
      r.status >= 400 && !signedIn(r));
    yes('F2 and nothing was written', !fs.existsSync(LINKED));

    // ---- with nothing refused ----------------------------------------------
    refusing([]);
    r = await ask('POST', '/api/gallery/approve', { cookie: OWNER() }, { name: 'a-shot.png' });
    yes('G1 Accept with nothing refused is accepted (' + said(r) + ')',
      r.status === 200 && names(GALLERY).indexOf('a-shot.png') >= 0 && names(PENDING).indexOf('a-shot.png') < 0);
    r = await ask('DELETE', '/api/gallery/approved', { cookie: OWNER() }, { name: 'c-shot.png' });
    yes('G2 Delete with nothing refused takes the picture away (' + said(r) + ')',
      r.status === 200 && names(PENDING).indexOf('c-shot.png') < 0);
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, { name: 'b-shot.png', why: 'harness' });
    yes('G3 a report with nothing refused is kept (' + said(r) + ')', r.status === 200 && ids(REPORTS).length === before + 1);
    r = await ask('POST', '/api/gallery/report/dismiss', { cookie: OWNER() }, { id: 'r1' });
    yes('G4 a dismiss with nothing refused takes the report away (' + said(r) + ')', r.status === 200 && ids(REPORTS).indexOf('r1') < 0);
    r = await ask('POST', '/api/upload?name=notes.txt&by=Djinn', { cookie: OWNER() }, 'a file sent by the harness');
    yes('G5 an upload with nothing refused is noted (' + said(r) + ')',
      r.status === 200 && r.json && !!(readJson(UPMETA) || {})[r.json.name]);
    r = await ask('DELETE', '/api/upload/a-log.txt', { cookie: OWNER() });
    yes('G6 a delete with nothing refused takes the note away (' + said(r) + ')',
      r.status === 200 && !(readJson(UPMETA) || {})['a-log.txt']);
    r = await ask('POST', '/api/roster', {}, roster());
    yes('G7 a roster with nothing refused is kept (' + said(r) + ')', r.status === 200 && fs.existsSync(ROSTER));
    r = await signIn();
    yes('G8 a sign-in with nothing refused signs in (' + r.status + ')', r.status === 302 && signedIn(r) && fs.existsSync(LINKED));

    yes('nothing the site did ended in an uncaught exception or unhandled rejection',
      !/uncaught exception|unhandled rejection/i.test(out), out.slice(-2000));
  } catch (err) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (err && err.stack ? err.stack : err) + '\n' + out.slice(-2000));
  }
  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
