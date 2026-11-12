'use strict';
/*
  test-4407-plain-form-errors.js

      node tests\test-4407-plain-form-errors.js

  #4407. When a report or a gallery report went wrong, the page showed the
  site's own short code to the visitor: "bad json", "could not save",
  "no name", "not on the gallery". The report page, the gallery's Report
  button and the launcher all show the error field of the answer as it
  comes, so whatever /api/report and /api/gallery/report put there is what
  a person reads, and the gallery page put it in a browser alert.

  A real copy of the site runs in a scratch folder (tests\site-files.js),
  with Discord stood in for in the process and the site's writes to named
  files refused, the way tests\test-4379-site-saves-checked.js does both.
  Every failing case of the two routes is driven over http, and each answer
  has to be a full sentence that says what happened and what to do:

    R1 /api/report with a body that is not JSON
    R2 /api/report with nothing in the first box
    R3 /api/report about a person, signed in, with nobody named
    R4 /api/report with the inbox refused
    G1 /api/gallery/report, not signed in and no launcher ticket
    G2 /api/gallery/report with a body that is not JSON
    G3 /api/gallery/report naming no picture
    G4 /api/gallery/report naming a picture not on the gallery
    G5 /api/gallery/report with the reports refused
  Then a good report of each kind, so a refusal above is the case and not a
  door shut anyway.

  And the gallery page's Report press, run in a stand-in page with the
  site's answer chosen by the harness: the site's sentence goes in a line
  beside the button, an answer that is not JSON and no answer at all get a
  sentence of the page's own, and nothing calls alert().

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const vm = require('vm');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ') : '')); }
}

/* A sentence a person can act on: a capital first, a stop last, at least six
   words, none of the site's short codes, no em dash and no "player". */
const EMDASH = String.fromCharCode(0x2014);
const SHORT = /^(bad json|could not save|no name|no id|not on the gallery|staff only|no|not set up)$/i;
function sentence(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  return /^[A-Z]/.test(t) && /[.!?]$/.test(t) && t.split(/\s+/).length >= 6 && !SHORT.test(t) &&
    t.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(t);
}

const ROOT = path.join(__dirname, '..');
const HOME = fs.readFileSync(path.join(ROOT, 'site', 'public', 'home.js'), 'utf8').split('\r\n').join('\n');

/* ---- the scratch site ---------------------------------------------------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4407-'));
const DATA = path.join(dir, 'data');
const SECRET = crypto.randomBytes(32).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '111111111111111111';
const TESTER_ID = '333333333333333333';
const REFUSE = path.join(dir, 'refuse.json');

siteFiles.copy(dir);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
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
fs.writeFileSync(path.join(DATA, 'gallery.json'), JSON.stringify([{ name: 'b-shot.png', url: '/shot/b-shot.png', by: 'Djinn' }]));
fs.writeFileSync(REFUSE, '[]');

/* Discord, in the site's process: the guild, its roles and its members, so
   the tester's cookie and ticket read as somebody let in. Anything else is
   refused. */
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

/* The refused saves: the file names in TS_REFUSE, read on every write, and
   the temp copy putJson writes beside each. */
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
const TESTER = () => cookieFor(TESTER_ID, 'Tester');
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
// One address per request, so the five an hour limit never answers first.
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({ 'x-forwarded-for': '10.44.7.' + (++lane % 250) }, headers || {});
    if (data) { h['content-length'] = data.length; h['content-type'] = 'application/json'; }
    // The site's own page sent it (#1367).
    if (method !== 'GET') h.origin = 'http://127.0.0.1:' + PORT;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { text += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          done({ status: res.statusCode, text: text, json: json });
        });
      });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const said = (r) => r.status + ' ' + r.text.slice(0, 300);
const errorOf = (r) => (r.json && typeof r.json.error === 'string') ? r.json.error : null;
const refusedInWords = (r) => r.status >= 400 && !(r.json && r.json.ok === true) && sentence(errorOf(r));

/* ---- the gallery page's Report press, in a stand-in page ---------------- */
const a = HOME.indexOf('    function bindGalleryReports() {');
const b = a < 0 ? -1 : HOME.indexOf('\n    bindGalleryReports();', a);
const BIND = (a >= 0 && b > a) ? HOME.slice(a, b) : '';

async function press(answer) {
  const alerts = [];
  const line = { textContent: '' };
  const attrs = { 'data-galreport': 'b-shot.png', 'aria-label': 'Report picture 1, a hall' };
  let click = null;
  const btn = {
    disabled: false, textContent: 'Report',
    getAttribute: (k) => (attrs[k] === undefined ? null : attrs[k]),
    setAttribute: (k, v) => { attrs[k] = String(v); },
    addEventListener: (ev, fn) => { if (ev === 'click') click = fn; },
    parentNode: { querySelector: (sel) => (/data-galsaid/.test(sel) ? line : null) }
  };
  const sandbox = {
    document: { querySelectorAll: () => [btn] },
    window: { prompt: () => 'not theirs to post', alert: (m) => alerts.push(m) },
    alert: (m) => alerts.push(m),
    request: () => answer(),
    JSON: JSON, Promise: Promise
  };
  vm.runInNewContext(BIND + '\nbindGalleryReports();', sandbox);
  if (click) click();
  // The press is a chain of promises; one turn of the event loop lets it
  // finish whatever it does.
  await new Promise((ok) => setImmediate(ok));
  return { alerts: alerts, line: line.textContent, btn: btn, bound: !!click };
}
const answered = (ok, json) => Promise.resolve({ ok: ok, status: ok ? 200 : 404, json: () => Promise.resolve(json) });

(async () => {
  /* ---- the page ---------------------------------------------------------- */
  console.log('the gallery page:');
  yes('home.js has the gallery Report press', !!BIND);
  const cards = (HOME.match(/function galleryCards\([\s\S]*?\n    \}/) || [''])[0];
  yes('each card has a line beside its Report button, there from the start, read out when it changes',
    /data-galreport[\s\S]*?<p[^>]*data-galsaid[^>]*role="status"/.test(cards));
  const WORDS = 'That picture is not on the gallery any more, so there is nothing to report. Reload the page to see what is up now.';
  let p = await press(() => answered(false, { error: WORDS }));
  yes('P1 the site\'s sentence goes in the line beside the button (' + JSON.stringify(p.line) + ')', p.bound && p.line === WORDS);
  yes('  and nothing calls alert()', p.bound && p.alerts.length === 0, p.alerts.join(' | '));
  yes('  and the button can be pressed again', p.bound && p.btn.disabled === false);
  p = await press(() => Promise.resolve({ ok: false, status: 502, json: () => Promise.reject(new SyntaxError('not JSON')) }));
  yes('P2 an answer that is not JSON gets a sentence of the page\'s own (' + JSON.stringify(p.line) + ')',
    p.bound && sentence(p.line) && p.alerts.length === 0);
  p = await press(() => Promise.reject(new TypeError('Failed to fetch')));
  yes('P3 no answer at all gets a sentence too (' + JSON.stringify(p.line) + ')', p.bound && sentence(p.line) && p.alerts.length === 0);
  p = await press(() => answered(true, { ok: true, id: 'x' }));
  yes('P4 a report the site took says Reported, with the line empty', p.bound && p.btn.textContent === 'Reported' && p.line === '');
  yes('P5 no public page of the site calls alert()', !/\balert\(/.test(HOME));

  /* ---- the site ---------------------------------------------------------- */
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

    console.log('\n/api/report:');
    let r = await ask('POST', '/api/report', {}, 'this is not json');
    yes('R1 a body that is not JSON is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    r = await ask('POST', '/api/report', {}, { title: '   ', kind: 'bug' });
    yes('R2 nothing in the first box is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    r = await ask('POST', '/api/report', { cookie: TESTER() }, { title: 'about nobody', kind: 'report', about: '' });
    yes('R3 a report about a person that names nobody is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    refusing(['inbox.json']);
    r = await ask('POST', '/api/report', {}, { title: 'not kept', kind: 'bug' });
    refusing([]);
    yes('R4 a report the site could not save is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    r = await ask('POST', '/api/report', {}, { title: 'kept', kind: 'bug' });
    yes('R5 and a good one is taken (' + said(r) + ')', r.status === 200 && !!r.json && r.json.ok === true);

    console.log('\n/api/gallery/report:');
    r = await ask('POST', '/api/gallery/report', {}, { name: 'b-shot.png', why: 'harness' });
    yes('G1 not signed in, with no ticket, is told in a sentence to sign in with Discord (' + said(r) + ')',
      refusedInWords(r) && /Sign in with Discord/.test(errorOf(r)));
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, 'this is not json');
    yes('G2 a body that is not JSON is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, { why: 'no picture named' });
    yes('G3 naming no picture is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, { name: 'gone.png', why: 'harness' });
    yes('G4 a picture not on the gallery is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    refusing(['gallery-reports.json']);
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, { name: 'b-shot.png', why: 'harness' });
    refusing([]);
    yes('G5 a report the site could not save is answered in a sentence (' + said(r) + ')', refusedInWords(r));
    r = await ask('POST', '/api/gallery/report' + TESTER_Q(), {}, { name: 'b-shot.png', why: 'harness' });
    yes('G6 and a good one is taken (' + said(r) + ')', r.status === 200 && !!r.json && r.json.ok === true);
  } catch (err) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (err && err.stack ? err.stack : err));
  }
  await new Promise((ok) => {
    if (srv.exitCode !== null) return ok();
    srv.on('exit', ok);
    srv.kill();
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
