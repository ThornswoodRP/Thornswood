'use strict';
/*
  test-site-route-gaps.js

      node .\site\tests\test-site-route-gaps.js
      node .\site\tests\test-site-route-gaps.js <an older server.js>

  The site\server.js routes no other harness under tests\ asked for by name
  when this was written (10 October), run live against a copy of the site in
  a scratch folder on a spare port, bound to 127.0.0.1:

    POST /api/play/logs        the launcher's session logs (a write, by ticket)
    PUT  /api/session-keep     hold one session's logs past retention (admins)
    GET  /discord              the invite redirect, set and not set
    GET  /download, /install   the old addresses, 301 to /downloads
    GET  /api/releases         the news feed, either shape of details
    GET  /.well-known/<name>   the Discord domain proof
    GET  /api/page-version/<sha256>   an unknown version
    GET  /file/<name>          a published file, files.json, and one not listed,
                               each no-store so Cloudflare keeps none (#5449)

  /file/ was added on 2 November, after every request to it answered 500 on
  the live site: lib/serve.js named SETUP_KINDS, which it never imported, and
  the harnesses that lift the route by text could not see that. The setup
  program names are not asked for here, because those go to GitHub.

  Nothing leaves the machine: no Discord bot token or guild is set, so the
  site never asks Discord anything, and every secret is random for this run.
  Both scratch folders are removed at the end, pass or fail.
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
const SITE = process.argv[2] || path.join(ROOT, 'site', 'server.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const ADMIN_D = '222222222', BJORN_D = '333333333';
const INVITE = 'https://discord.gg/harness-invite';
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

function scratch(name, invite) {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-routes-' + name + '-'));
  const secret = crypto.randomBytes(32).toString('hex');
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public', '.well-known'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: invite || '' },
    botKey: crypto.randomBytes(24).toString('hex'), admins: [ADMIN_D], secret,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
    [ADMIN_D]: { id: ADMIN_D, name: 'Aela', profiles: [1001] },
    [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002] }
  }));
  return { dir, secret };
}
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
// Waits for the site's own "[thornswood-docs] listening on ...:port" line
// rather than polling the port (#1727).
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const end = (e) => { clearTimeout(late); srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', err); srv.removeListener('close', gone); if (e) { srv.kill(); bad(e); } else { ok(); } };
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(); } };
    const err = (d) => { out += d; };
    const gone = (code) => end(new Error('site stopped (exit ' + code + ') before it was listening:\n' + out));
    const late = setTimeout(() => end(new Error('site not listening in 15 s:\n' + out)), 15000);
    srv.stdout.on('data', said);
    srv.stderr.on('data', err);
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
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
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
const signWith = (secret, v) => crypto.createHmac('sha256', secret).update(String(v)).digest('hex').slice(0, 32);
function cookieFor(secret, id, name) {
  const at = String(Date.now());
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + signWith(secret, id + '|' + name + '|' + at));
}
function ticketFor(secret, id, name, x) {
  const body = Buffer.from(JSON.stringify({ d: String(id), n: name, x: x || Date.now() + 86400000 })).toString('base64url');
  return 'tk1.' + body + '.' + signWith(secret, 'ticket:' + body);
}
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };

(async function main() {
  const A = scratch('a', INVITE);
  const B = scratch('b', '');
  let a = null, b = null;
  try {
    const now = Date.now();
    const sessions = path.join(A.dir, 'data', 'sessions.json');
    fs.writeFileSync(sessions, JSON.stringify([
      { session: 'aela-session-1', who: ADMIN_D, start: now - 600000, end: now - 60000, channel: 'main', profile: 1001 },
      { session: 'bjorn-session-1', who: BJORN_D, start: now - 600000, end: now - 60000, channel: 'main', profile: 2002 }
    ]));
    fs.writeFileSync(path.join(A.dir, 'data', 'news.json'), JSON.stringify({
      launcher: '1.2.3',
      news: [
        { date: '2026-10-01', title: 'one detail', details: 'a bare string', files: 'one.zip' },
        { date: '2026-10-02', title: 'a list', details: ['x', '', null, 'y'], files: ['a', 'b'] },
        { date: '2026-10-03', title: 'none' }
      ]
    }));
    fs.writeFileSync(path.join(A.dir, 'public', '.well-known', 'discord'), 'dh=harness');
    fs.writeFileSync(path.join(A.dir, 'secret.txt'), 'not public');
    fs.mkdirSync(path.join(A.dir, 'files'), { recursive: true });
    fs.writeFileSync(path.join(A.dir, 'files', 'files.json'), JSON.stringify({ 'guide.pdf': { title: 'The guide' } }));
    fs.writeFileSync(path.join(A.dir, 'files', 'guide.pdf'), 'the guide');
    fs.writeFileSync(path.join(A.dir, 'files', 'notes.txt'), 'not listed');

    a = await start(A);
    b = await start(B);
    const P = a.port;
    const json = { 'content-type': 'application/json' };
    const aelaT = ticketFor(A.secret, ADMIN_D, 'Aela');
    const bjornT = ticketFor(A.secret, BJORN_D, 'Bjorn');

    // ---------------------------------------------------- POST /api/play/logs
    console.log('POST /api/play/logs:');
    let r = await request(P, 'POST', '/api/play/logs', json, { session: 'aela-session-1', logs: { 'launcher.log': 'x' } });
    yes('no ticket is 401 link', r.status === 401 && r.j.why === 'link');
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: ticketFor(crypto.randomBytes(32).toString('hex'), ADMIN_D, 'Aela'), session: 'aela-session-1', logs: {} });
    yes('a ticket signed with another secret is 401', r.status === 401);
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: ticketFor(A.secret, ADMIN_D, 'Aela', now - 1000), session: 'aela-session-1', logs: {} });
    yes('an expired ticket is 401', r.status === 401);
    r = await request(P, 'POST', '/api/play/logs', json, 'not json');
    yes('a body that is not JSON is 401, not a crash', r.status === 401);
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: aelaT, session: 'short', logs: {} });
    yes('a session id under 8 characters is 400', r.status === 400 && r.j.why === 'no session id');
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: aelaT, session: 'bjorn-session-1', logs: { 'launcher.log': 'forged' } });
    yes('another account\'s session is 404', r.status === 404);
    yes('and nothing was written for it', !fs.existsSync(path.join(A.dir, 'data', 'session-logs', 'bjorn-session-1.json')));
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: aelaT, session: 'aela-session-1', logs: { 'not-a-log.exe': 'x' } });
    yes('only names off the list is 200 stored false', r.status === 200 && r.j.stored === false);
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: aelaT, session: '../aela-session-1', logs: { 'launcher.log': 'x' } });
    yes('path characters are stripped from the id, so ../ cannot leave the folder',
        !fs.existsSync(path.join(A.dir, 'data', 'aela-session-1.json')));
    const logsFile = path.join(A.dir, 'data', 'session-logs', 'aela-session-1.json');
    try { fs.unlinkSync(logsFile); } catch (e) { }
    r = await request(P, 'POST', '/api/play/logs', json, {
      ticket: aelaT, session: 'aela-session-1',
      logs: { 'launcher.log': 'started\nall fine', 'evil/../x': 'dropped' },
      issues: [{ text: 'Plugin missing', blocking: true, plugin: 'X.esp' }, { text: '' }],
      checks: [{ name: 'disk', detail: 'ok' }]
    });
    yes('its own session is 200 stored true', r.status === 200 && r.j.stored === true);
    const set = readJson(logsFile, {});
    yes('the set is on disk under the session id', !!set.logs && set.logs['launcher.log'] === 'started\nall fine');
    yes('names off the list are dropped', set.logs && !Object.keys(set.logs).some((k) => /evil/.test(k)));
    const row = readJson(sessions, []).find((x) => x.session === 'aela-session-1');
    yes('the launcher\'s issues land on the session row, empty ones dropped', row && Array.isArray(row.issues) && row.issues.length === 1 && row.issues[0].plugin === 'X.esp');
    yes('and its checks', row && Array.isArray(row.checks) && row.checks[0].name === 'disk');
    r = await request(P, 'POST', '/api/play/logs', json, { ticket: aelaT, session: 'aela-session-1', logs: { 'launcher.log': 'replay' } });
    yes('a second set is 409 already sent', r.status === 409 && r.j.why === 'already sent');
    const again = readJson(logsFile, {});
    yes('and does not overwrite the first, only counts it', again.logs['launcher.log'] === 'started\nall fine' && again.resent === 1);

    // ------------------------------------------------- PUT /api/session-keep
    console.log('\nPUT /api/session-keep:');
    // A cookie write has to come from the site's own origin (crossSite, #1367).
    const OWN = { origin: 'http://127.0.0.1:' + P };
    const admin = cookieFor(A.secret, ADMIN_D, 'Aela');
    const bjorn = cookieFor(A.secret, BJORN_D, 'Bjorn');
    r = await request(P, 'PUT', '/api/session-keep', json, { session: 'bjorn-session-1', who: BJORN_D, keep: true });
    yes('nobody signed in is refused', r.status === 401 || r.status === 403);
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: bjorn }, json), { session: 'bjorn-session-1', who: BJORN_D, keep: true });
    yes('a cookie for somebody not an admin is refused', r.status === 401 || r.status === 403);
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: 'twa=' + encodeURIComponent(ADMIN_D + '|Aela|' + Date.now() + '|' + '0'.repeat(32)) }, json), { session: 'bjorn-session-1', who: BJORN_D, keep: true });
    yes('an admin cookie with a forged signature is refused', r.status === 401 || r.status === 403);
    yes('and none of those held it', !readJson(sessions, []).find((x) => x.session === 'bjorn-session-1').keep);
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: admin }, json), '{bad');
    yes('an admin with bad JSON is 400', r.status === 400);
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: admin }, json), { session: 'bjorn-session-1', who: ADMIN_D, keep: true });
    yes('the right id with the wrong account is 404', r.status === 404);
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: admin }, json), 'null');
    yes('a JSON null body is 404, not a crash', r.status === 404);
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: admin }, json), { session: 'bjorn-session-1', who: BJORN_D, keep: true });
    let kept = readJson(sessions, []).find((x) => x.session === 'bjorn-session-1');
    yes('an admin holds it: 200 keep true', r.status === 200 && r.j.keep === true);
    yes('and the row says who and when', kept.keep === true && kept.keptBy === 'Aela' && kept.keptAt > 0);
    r = await request(P, 'GET', '/api/session-logs?session=bjorn-session-1&who=' + BJORN_D, { cookie: admin });
    yes('/api/session-logs reports it held', r.status === 200 && r.j.keep === true && r.j.keptBy === 'Aela');
    r = await request(P, 'PUT', '/api/session-keep', Object.assign({}, OWN, { cookie: admin }, json), { session: 'bjorn-session-1', who: BJORN_D, keep: false });
    kept = readJson(sessions, []).find((x) => x.session === 'bjorn-session-1');
    yes('letting it go is 200 keep false and clears who and when',
        r.status === 200 && r.j.keep === false && kept.keep === false && !('keptBy' in kept) && !('keptAt' in kept));

    // ------------------------------------------------------- public GETs
    console.log('\npublic routes:');
    r = await request(P, 'GET', '/discord');
    yes('/discord with an invite set is 302 to it', r.status === 302 && r.headers.location === INVITE);
    r = await request(b.port, 'GET', '/discord');
    yes('/discord with none set is 404 and no Location', r.status === 404 && !r.headers.location);
    for (const old of ['/download', '/install']) {
      r = await request(P, 'GET', old);
      yes(old + ' is 301 to /downloads', r.status === 301 && r.headers.location === '/downloads');
    }
    r = await request(P, 'GET', '/api/releases');
    const n = r.j.news || [];
    yes('/api/releases is 200 with the launcher version', r.status === 200 && r.j.launcher === '1.2.3');
    yes('a bare string detail comes out as a one item list', n[0] && Array.isArray(n[0].details) && n[0].details.length === 1 && n[0].details[0] === 'a bare string');
    yes('empty and null details are dropped from a list', n[1] && JSON.stringify(n[1].details) === '["x","y"]');
    yes('files is a count, either shape', n[0] && n[0].files === 1 && n[1].files === 2 && n[2].files === 0);
    yes('no details at all is an empty list', n[2] && Array.isArray(n[2].details) && n[2].details.length === 0);
    r = await request(b.port, 'GET', '/api/releases');
    yes('/api/releases with no news file is 200 and empty', r.status === 200 && Array.isArray(r.j.news) && r.j.news.length === 0);
    r = await request(P, 'GET', '/.well-known/discord');
    yes('the domain proof is served as plain text', r.status === 200 && r.text === 'dh=harness' && /text\/plain/.test(r.headers['content-type'] || ''));
    r = await request(P, 'GET', '/.well-known/missing');
    yes('a proof that is not there is 404', r.status === 404);
    r = await request(P, 'GET', '/.well-known/..%2F..%2Fsecret.txt');
    yes('an escaped ../ does not reach a file outside public', r.text.indexOf('not public') < 0);
    r = await request(P, 'GET', '/api/page-version/' + '0'.repeat(64));
    yes('an unknown page version is 404', r.status === 404);

    // ------------------------------------------------------------ GET /file/
    console.log('\nGET /file/:');
    r = await request(P, 'GET', '/file/guide.pdf');
    yes('a file files.json lists is 200 with its bytes', r.status === 200 && r.text === 'the guide');
    // Cloudflare keeps a file by its name whatever the site says unless it
    // is no-store, and then serves it after the site has replaced or
    // removed it (#5449).
    yes('  and no cache may keep it', r.headers['cache-control'] === 'no-store');
    r = await request(P, 'GET', '/file/files.json');
    yes('files.json itself is 200', r.status === 200 && r.j['guide.pdf'] && r.j['guide.pdf'].title === 'The guide');
    r = await request(P, 'GET', '/file/notes.txt');
    yes('a file in the folder that files.json does not list is 404', r.status === 404 && r.text === 'no such file');
    yes('  and no cache may keep that either', r.headers['cache-control'] === 'no-store');
    r = await request(b.port, 'GET', '/file/files.json');
    yes('with no downloads at all, files.json is 404 and not a server error', r.status === 404);
  } catch (e) {
    fail++; console.log('FAIL  ' + (e && e.stack || e));
  } finally {
    for (const s of [a, b]) if (s) { s.srv.removeAllListeners('close'); s.srv.kill(); }
    await new Promise((ok) => setTimeout(ok, 300));
    for (const d of [A.dir, B.dir]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } }
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
