/*
  test-1367-cross-site.js

      node .\site\tests\test-1367-cross-site.js

  #1367. Nothing on the site is changed by a page on another site.

  The sign in cookies are SameSite=Lax, and that was all that stood between
  another site and the hub's writes. A browser too old to know the attribute
  sends the cookies on a form another page submits, and every route reads its
  body as JSON whatever the Content-Type says, so a form with
  enctype="text/plain" could send a signed in admin to /api/staff/pk. The
  site now asks where every request that is not a GET came from (crossSite in
  site\server.js): Origin, or Referer when Origin is left off, has to be this
  site, and a request with a sign in cookie that names no page at all is
  refused too. The launcher, the game servers, the bot and the voice service
  send no cookie and no Origin, and go on exactly as before.

  THREE PARTS.

  1. The source. crossSite is asked in handle() before Discord is asked and
     before every route that is not a GET, so a route added later below it is
     covered, and nothing above it writes.

  2. A scratch site with Discord set up, an admin signed in. Every kind of
     write the hub makes (a ban, a PK, the inbox, a page, a board, the test
     marks, an upload and its delete, a gallery decision, a report about a
     person, sign out) is refused 403 from another origin, from Origin null,
     from another site's Referer, and with the cookie and no page named, and
     nothing is written by any of them. From the site's own origin, or its own
     page in Referer, the same writes land. The game server's keyed report,
     the launcher's ticket door and an anonymous report with no Origin still
     answer as they did. A GET changes nothing, whatever it names.

  3. A scratch site with no Discord, the member password the door. A sign in
     from another site is refused and sets no cookie; from the site's own page
     it signs in.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP when it
  is set. Each site takes a free port (#1756).
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
const SITE = path.join(ROOT, 'site', 'server.js');
const CR = String.fromCharCode(13);
const SERVER = siteFiles.source(SITE).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
const fair = (s) => typeof s === 'string' && s.length > 0 && s.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(s);

// ------------------------------------------------------------- 1. the source --
console.log('the source:');
const hStart = SERVER.indexOf('async function handle(req, res) {');
const hEnd = SERVER.indexOf('\nhttp.createServer(', hStart);
const HANDLE = hStart >= 0 && hEnd > hStart ? SERVER.slice(hStart, hEnd) : '';
yes('handle() is in site\\server.js', HANDLE.length > 0);
const asked = HANDLE.indexOf('const foreign = crossSite(req);');
yes('handle() asks crossSite', asked > 0);
yes('before Discord is asked who the visitor is', asked > 0 && asked < HANDLE.indexOf('await who(req'));
const writes = [];
const re = /req\.method\s*(?:===|!==)\s*'(POST|PUT|DELETE|PATCH)'|req\.method\s*!==\s*'GET'/g;
let m;
while ((m = re.exec(HANDLE))) writes.push(m.index);
yes('handle() has write routes to hold (' + writes.length + ' found)', writes.length >= 25);
yes('every one of them is below the question, so none is answered first',
    writes.length > 0 && writes.every((i) => i > asked));
const above = HANDLE.slice(0, Math.max(0, asked));
yes('nothing above the question writes a file',
    !/putJson|writeFileSync|appendFileSync|unlinkSync|renameSync|putSessions|writeDoc|writeBoard|receiveUpload/.test(above));
yes('the routes above it are GET only',
    (above.match(/req\.method === '(\w+)'/g) || []).every((s) => /'(GET|HEAD)'/.test(s)));
const fn = (() => {
  const a = SERVER.indexOf('function crossSite(req) {');
  const b = a < 0 ? -1 : SERVER.indexOf('\n}\n', a);
  return a >= 0 && b > a ? SERVER.slice(a, b + 2) : '';
})();
yes('crossSite is one function in site\\server.js', fn.length > 0);
yes('it compares with the origin the request was sent to, the one the Discord callback uses',
    /origin\(req\)\.toLowerCase\(\)/.test(fn) && /redirect_uri=' \+ encodeURIComponent\(origin\(req\)/.test(SERVER));
yes('the cookies it looks for are the two sign in cookies', /c\[COOKIE\] \|\| c\[ADMIN\]/.test(fn) &&
    /const COOKIE = 'tw';/.test(SERVER) && /const ADMIN  = 'twa';/.test(SERVER));

// ------------------------------------------------------------ the scratch sites --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const ADMIN_D = '222222222', BJORN_D = '333333333', SELF_D = '444444444';
const KEY = crypto.randomBytes(24).toString('hex');

function scratch(name, discord) {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-1367-' + name + '-'));
  const secret = crypto.randomBytes(32).toString('hex');
  const password = crypto.randomBytes(12).toString('hex');
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data', 'for-bot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password,
    discord: discord
      ? { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' }
      : { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
    botKey: KEY, admins: [ADMIN_D], secret,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
    [ADMIN_D]: { id: ADMIN_D, name: 'Aela', profiles: [1001] },
    [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002] }
  }));
  return { dir, secret, password };
}
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
/* Waits for this run's site to say it is listening on its port (#1727). */
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const mm = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (mm && Number(mm[1]) === port) end(null);
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
      if (err) bad(err); else ok();
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}
async function start(s) {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(s.dir, 'server.js')], {
    cwd: s.dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  await listening(srv, port);
  return { port, srv };
}
/* Exactly the headers given, and nothing a browser would add on its own. */
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers: h, agent: false }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { }
        ok({ status: res.statusCode, j: j || {}, text: buf, headers: res.headers });
      });
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', () => ok({ status: 0, j: {}, text: '', headers: {} }));
    if (data) r.write(data);
    r.end();
  });
}
function cookieFor(secret, id, name) {
  const at = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
}
const read = (dir, f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return d; } };
const text = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return null; } };
const refused = (r) => r.status === 403 && r.j.why === 'cross-site' && fair(r.j.error);

(async function main() {
  const A = scratch('discord', true);
  const B = scratch('password', false);
  let a = null, b = null;
  try {
    a = await start(A);
    yes('the scratch site with Discord set up starts', true);
    const port = a.port;
    const OWN = 'http://127.0.0.1:' + port;
    const admin = cookieFor(A.secret, ADMIN_D, 'Aela');
    const json = { 'content-type': 'application/json' };

    // A note in the inbox, the board and the doc, so a refused write has
    // something to leave alone.
    fs.writeFileSync(path.join(A.dir, 'data', 'for-bot', 'inbox.json'), JSON.stringify([{ id: 'i1', title: 'kept', state: 'new' }]));
    fs.writeFileSync(path.join(A.dir, 'data', 'tests.md'), 'kept\n');
    fs.mkdirSync(path.join(A.dir, 'uploads'), { recursive: true });
    fs.writeFileSync(path.join(A.dir, 'uploads', 'kept.txt'), 'kept');
    const snap = () => JSON.stringify({
      bans: read(A.dir, 'data/bans.json', {}), pk: read(A.dir, 'data/pk.json', {}), notes: read(A.dir, 'data/notes.json', {}),
      inbox: read(A.dir, 'data/for-bot/inbox.json', []), results: read(A.dir, 'data/results.json', null),
      board: read(A.dir, 'data/board.json', null), doc: text(A.dir, 'data/tests.md'),
      uploads: fs.readdirSync(path.join(A.dir, 'uploads')).sort(),
      pending: read(A.dir, 'data/gallery-pending.json', null), gallery: read(A.dir, 'data/gallery.json', null)
    });
    const before = snap();

    // ---------------------------------------- 2. every write, from elsewhere --
    console.log('\nfrom another site, with an admin signed in:');
    const WRITES = [
      ['POST', '/api/staff/ban', { id: BJORN_D, why: 'a page elsewhere', minutes: 60 }],
      ['POST', '/api/staff/pk', { id: BJORN_D, profileId: 2002, why: 'a page elsewhere' }],
      ['POST', '/api/staff/note', { id: BJORN_D, text: 'a page elsewhere' }],
      ['PUT', '/api/inbox', []],
      ['PUT', '/api/results', { forged: true }],
      ['PUT', '/api/doc/tests', 'forged'],
      ['PUT', '/api/board/todo', { intro: 'forged', sections: [] }],
      ['PUT', '/api/session-note', { session: 's1', who: BJORN_D, note: 'forged' }],
      ['POST', '/api/upload?name=forged.txt', 'forged'],
      ['DELETE', '/api/upload/kept.txt', undefined],
      ['POST', '/api/gallery/submit?name=forged.png', 'forged'],
      ['POST', '/api/gallery/approve', { name: 'kept.txt' }],
      ['DELETE', '/api/gallery/approved', { name: 'kept.txt' }],
      ['POST', '/api/report', { kind: 'report', title: 'forged', about: 'Bjorn' }],
      ['POST', '/api/logout', undefined]
    ];
    const FROM = [
      ['another origin', { origin: 'https://evil.example' }],
      ['Origin null, a sandboxed frame or a no-referrer page', { origin: 'null' }],
      ['this host on another port', { origin: 'http://127.0.0.1:' + (port === 65535 ? 1 : port + 1) }],
      ['this host over https when the request came in plain', { origin: 'https://127.0.0.1:' + port }],
      ['no Origin and another site\'s page in Referer', { referer: 'https://evil.example/page' }],
      ['no Origin and a Referer that is not an address', { referer: 'not an address' }],
      ['the cookie and no page named at all', {}]
    ];
    for (const [label, from] of FROM) {
      const out = [];
      for (const [method, where, body] of WRITES) {
        out.push([method + ' ' + where, await request(port, method, where, Object.assign({ cookie: admin }, json, from), body)]);
      }
      const bad = out.filter(([, r]) => !refused(r)).map(([w, r]) => w + ' ' + r.status);
      yes('from ' + label + ': all ' + out.length + ' writes refused 403 cross-site' + (bad.length ? ' (not: ' + bad.join(', ') + ')' : ''),
          bad.length === 0);
      yes('  and sign out from there set no cookie', !out.some(([w, r]) => /logout/.test(w) && r.headers['set-cookie']));
    }
    yes('nothing was written by any of them: bans, PKs, notes, inbox, marks, board, page, uploads, gallery', snap() === before);
    let r = await request(port, 'POST', '/api/staff/ban', Object.assign({ cookie: 'tw=' + 'a'.repeat(64) }, json), { id: BJORN_D, why: 'x' });
    yes('the member cookie with no page named is refused the same way', refused(r));
    yes('  in words that say the browser named no page', /did not say which page/.test(r.j.error));
    r = await request(port, 'POST', '/api/staff/ban', Object.assign({ cookie: admin, origin: 'https://evil.example' }, json), { id: BJORN_D, why: 'x' });
    yes('from another origin the words say another site', /another site/.test(r.j.error));

    // The shape of the attack: a form, text/plain, whose one field makes a body that parses.
    const formBody = '{"id":"' + BJORN_D + '","profileId":2002,"why":"a form elsewhere","x":"' + '=' + '"}';
    r = await request(port, 'POST', '/api/staff/pk', { cookie: admin, 'content-type': 'text/plain', origin: 'https://evil.example' }, formBody);
    yes('a text/plain form from another site that would parse as JSON is refused', refused(r));
    yes('  and the character is not PK\'d', !read(A.dir, 'data/pk.json', {})['2002']);
    // The site writes site.log before it answers the 403 (#3060).
    const log = text(A.dir, 'site.log') || '';
    yes('site.log says what was refused and where it came from',
        /refused a POST to \/api\/staff\/pk from another site \(origin: https:\/\/evil\.example\)/.test(log) &&
        /from another site \(neither: no page named\)/.test(log));

    // --------------------------------------------- the same writes, from here --
    console.log('\nfrom the site\'s own pages:');
    r = await request(port, 'POST', '/api/staff/ban', Object.assign({ cookie: admin, origin: OWN }, json), { id: BJORN_D, why: 'from the hub', minutes: 60 });
    yes('a ban from the hub, Origin this site, lands', r.status === 200 && r.j.ok === true && !!read(A.dir, 'data/bans.json', {})[BJORN_D]);
    r = await request(port, 'POST', '/api/staff/pk', Object.assign({ cookie: admin, origin: OWN.toUpperCase().replace('HTTP', 'http') }, json), { id: BJORN_D, profileId: 2002, why: 'from the hub' });
    yes('a PK from the hub lands, the host in any case', r.status === 200 && r.j.ok === true && !!read(A.dir, 'data/pk.json', {})['2002']);
    r = await request(port, 'PUT', '/api/doc/tests', { cookie: admin, origin: OWN }, 'written from the hub');
    yes('a page written from the hub lands', r.status === 200 && text(A.dir, 'data/tests.md') === 'written from the hub');
    r = await request(port, 'PUT', '/api/results', Object.assign({ cookie: admin, referer: OWN + '/hub' }, json), { marked: true });
    yes('an old browser that sends only Referer, this site\'s page, still writes', r.status === 200 && read(A.dir, 'data/results.json', {}).marked === true);
    r = await request(port, 'DELETE', '/api/upload/kept.txt', { cookie: admin, origin: OWN });
    yes('a delete from the hub lands', r.status === 200 && !fs.existsSync(path.join(A.dir, 'uploads', 'kept.txt')));
    r = await request(port, 'POST', '/api/staff/note', Object.assign({ cookie: admin, origin: 'https://127.0.0.1:' + port,
      'x-forwarded-proto': 'https' }, json), { id: BJORN_D, text: 'through the certificate' });
    yes('behind Caddy (x-forwarded-proto https), Origin https and this host writes', r.status === 200 && r.j.ok === true);
    r = await request(port, 'POST', '/api/staff/note', Object.assign({ cookie: admin, origin: OWN, 'x-forwarded-proto': 'https' }, json),
                      { id: BJORN_D, text: 'plain behind the certificate' });
    yes('behind Caddy, a plain http Origin is another origin and is refused', refused(r));
    r = await request(port, 'POST', '/api/logout', { cookie: admin, origin: OWN });
    yes('sign out from the hub clears both cookies', r.status === 200 &&
        (r.headers['set-cookie'] || []).filter((c) => /^(tw|twa)=; /.test(c)).length === 2);

    // ------------------------------------------ what is not a browser goes on --
    console.log('\nwhat is not a browser, no cookie and no Origin:');
    r = await request(port, 'POST', '/api/report/game', Object.assign({ 'x-thornswood-key': KEY }, json),
                      { kind: 'help', title: 'stuck in a wall', profileId: 1001, name: 'Aela' });
    yes('the game server\'s keyed /helpme still lands (' + r.status + ')', r.status === 200 && r.j.ok === true);
    r = await request(port, 'POST', '/api/play/who', json, {});
    yes('the launcher\'s ticket door still answers its own 401 link, not cross-site', r.status === 401 && r.j.why === 'link');
    r = await request(port, 'POST', '/api/ticket', json, { key: KEY, title: 'a ticket from the bot', by: 'Bjorn' });
    yes('the bot\'s ticket still lands', r.status === 200 && r.j.ok === true);
    r = await request(port, 'POST', '/api/report', Object.assign({ 'x-forwarded-for': '10.13.67.1' }, json), { kind: 'bug', title: 'from a script' });
    yes('a problem sent with no cookie and no page named still lands', r.status === 200 && r.j.ok === true);
    r = await request(port, 'POST', '/api/report', Object.assign({ 'x-forwarded-for': '10.13.67.2', origin: OWN }, json), { kind: 'bug', title: 'from the page' });
    yes('a problem sent from the site\'s own report page lands', r.status === 200 && r.j.ok === true);

    // ----------------------------------------------------- a GET changes nothing --
    console.log('\na GET, whatever it names:');
    const mid = snap();
    const GETS = ['/api/staff/ban', '/api/staff/pk', '/api/inbox', '/api/results', '/api/doc/tests', '/api/board/todo',
      '/api/upload', '/api/gallery/approve', '/api/gallery/approved', '/api/report', '/api/logout', '/api/login'];
    let changed = [];
    for (const g of GETS) {
      const rr = await request(port, 'GET', g + '?id=' + BJORN_D + '&why=x', { cookie: admin, origin: 'https://evil.example' });
      if ((rr.status === 200 && rr.j.ok) || rr.headers['set-cookie']) changed.push(g + ' ' + rr.status);
    }
    yes('a GET to any write route, signed in, from another site, does nothing' + (changed.length ? ' (' + changed.join(', ') + ')' : ''),
        changed.length === 0 && snap() === mid);
    r = await request(port, 'GET', '/api/all', { cookie: admin, origin: 'https://evil.example' });
    yes('a GET is not held to where it came from (reads are the browser\'s same origin rule to guard)', r.status === 200 && !!r.j.me);
    r = await request(port, 'HEAD', '/api/hello', { cookie: admin, origin: 'https://evil.example' });
    yes('a HEAD is a GET (' + r.status + ')', r.status === 200);
    a.srv.kill(); a = null;

    // -------------------------------------------- 3. the password, bootstrap --
    console.log('\nthe member password, before Discord is set up:');
    b = await start(B);
    const BOWN = 'http://127.0.0.1:' + b.port;
    r = await request(b.port, 'POST', '/api/login', { 'content-type': 'application/json', origin: 'https://evil.example' }, { password: B.password });
    yes('a sign in from another site, with the right password, is refused 403 cross-site', refused(r));
    yes('  and sets no cookie', !r.headers['set-cookie']);
    r = await request(b.port, 'POST', '/api/login', { 'content-type': 'application/json', origin: BOWN }, { password: B.password });
    yes('from the site\'s own page it signs in', r.status === 200 && /^tw=/.test(String((r.headers['set-cookie'] || [])[0] || '')));
    const member = String(r.headers['set-cookie'][0]).split(';')[0];
    r = await request(b.port, 'PUT', '/api/results', { 'content-type': 'application/json', cookie: member, origin: 'https://evil.example' }, { forged: 1 });
    yes('the member cookie from another site cannot write the test marks', refused(r) && read(B.dir, 'data/results.json', null) === null);
    r = await request(b.port, 'PUT', '/api/results', { 'content-type': 'application/json', cookie: member, origin: BOWN }, { marked: 1 });
    yes('from the hub it can', r.status === 200 && read(B.dir, 'data/results.json', {}).marked === 1);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  } finally {
    // Each site has let go of its folder when it has closed, not after a guess.
    await Promise.all([a, b].filter(Boolean).map((s) => new Promise((ok) => {
      if (s.srv.exitCode !== null || s.srv.signalCode !== null) { ok(); return; }
      s.srv.once('close', ok);
      s.srv.kill();
    })));
    for (const d of [A.dir, B.dir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
