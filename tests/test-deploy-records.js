// test-deploy-records.js
//
//     node tests\test-deploy-records.js
//
// Issue #459: the box says over HTTP which commit each part runs. The deploy
// scripts leave a record per part (scripts\deploy\Artifact.ps1); this proves
// the two readers hand them back:
//
//   site  /api/deploys lists every record in the store's current folder.
//         readDeploys is lifted out of site\server.js by its markers and run
//         against a temp folder, and the route is checked to be inside the
//         sign in gate and to ask for staff.
//   voice /health carries the record left beside voice-server.js. The real
//         service is started from a temp copy, once without a record and
//         once with one, and asked.
//
// Issue #1359: that site door was open to anybody, so a commit and the hour
// each part last went out were there for the asking. It is staff's now, by
// the same w.dev the other staff doors use, and a real copy of the site is
// started in a temp folder and asked as three callers: nobody, a hub member
// who is not staff, and an admin. The first two must get a refusal with no
// commit, hash or stamp anywhere in it; the third must still get the record.
//
// Read only. Writes to temp folders and nowhere else.
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const REPO = path.resolve(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function lift(src, from, to) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a);
  return (a >= 0 && b > a) ? src.slice(a, b) : '';
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const n = s.address().port; s.close(() => ok(n)); });
  });
}
/*
  Waits for the voice service's own "listening on ...:port" line, so nothing
  is asked of the port before this run's service holds it (#1703). If it
  stops first, something took the port in between or it could not start,
  and the error says which, with what it printed.
*/
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[voice\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('exit', gone);
  });
}
/*
  Ends a service and waits until it has gone and its streams have ended
  ('close', which comes after 'exit'), rather than for a guessed time, so
  each service is let go before the next part starts (#1960). Node frees
  the process and pipe handles a moment after even that, which is why the
  harness ends by setting process.exitCode and not by process.exit().
*/
function stopped(srv) {
  return new Promise((ok) => {
    const ended = srv.exitCode !== null || srv.signalCode !== null;
    if (ended && [srv.stdin, srv.stdout, srv.stderr].every((s) => !s || s.destroyed)) { ok(); return; }
    srv.once('close', () => ok());
    if (!ended) { srv.kill(); }
  });
}
// One GET against the scratch site, with whatever cookie the caller offers.
function ask(port, where, cookie) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port: port, method: 'GET', path: where,
                               headers: cookie ? { cookie: cookie } : {}, agent: false }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        done({ status: res.statusCode, body: text, json: json });
      });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

const record = {
  part: 'thornswood-server-dev', component: 'gamemode',
  name: 'gamemode-0123456789ab-fedcba9876543210.zip',
  commit: '0123456789abcdef0123456789abcdef01234567', edited: false, edits: [],
  sha256: 'fedcba9876543210'.repeat(4), size: 1234, files: 1,
  root: 'C:/Thornswood-Server-Dev', deployedUtc: '2026-09-29T10:00:00Z', from: 'ONE'
};

async function main() {
  // ------------------------------------------------------------------ site
  const server = siteFiles.source();
  const block = lift(server, '// ==== thornswood deploy records ====', '// ==== end thornswood deploy records ====');
  yes('site/server.js has the deploy records block', !!block);
  yes('it reads the store the deploy scripts write, unless told otherwise',
    block.includes("process.env.THORNSWOOD_DEPLOYS_DIR || 'C:\\\\Thornswood-Deploys\\\\current'"));
  const route = server.indexOf("p === '/api/deploys'");
  yes('/api/deploys is a route', route >= 0);
  // #1359: it used to sit with /api/public, above everything that asks
  // anybody to sign in. Both halves are checked, because moving it back
  // under that gate would be the whole of the leak again.
  const gate = server.indexOf("if (p.startsWith('/api/'))");
  yes('it sits inside the sign in gate, not out with the public routes',
    route >= 0 && gate >= 0 && route > gate);
  yes('and nothing answers it above that gate', server.indexOf("route === '/api/deploys'") < 0);
  yes('it asks for staff and then answers with readDeploys of that store',
    /p === '\/api\/deploys'[^\n]*\n\s*if \(!w\.dev\) return sendJson\(res, 403, \{ error: 'staff only' \}\);\n\s*return sendJson\(res, 200, \{ parts: readDeploys\(DEPLOYS_DIR\) \}\)/.test(server));

  const readDeploys = block ? new Function('fs', 'path', 'process', block + '\nreturn readDeploys;')(fs, path, process) : null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-deploys-'));
  try {
    fs.writeFileSync(path.join(dir, 'thornswood-server-dev.json'), '\uFEFF' + JSON.stringify(record));
    fs.writeFileSync(path.join(dir, 'thornswood-docs.json'),
      JSON.stringify(Object.assign({}, record, { part: 'thornswood-docs', component: 'site', edited: true, name: 'site-0123456789ab-edited-0000000000000000.zip' })));
    fs.writeFileSync(path.join(dir, 'thornswood-bot.json'), '{ not json');
    fs.writeFileSync(path.join(dir, 'README.txt'), 'not a record');
    const got = readDeploys ? readDeploys(dir) : {};
    yes('every record in the folder is listed by its part', JSON.stringify(Object.keys(got)) === JSON.stringify(['thornswood-bot', 'thornswood-docs', 'thornswood-server-dev']));
    const dev = got['thornswood-server-dev'] || {};
    yes('with its commit, zip, hash and when, a byte order mark or not',
      dev.commit === record.commit && dev.name === record.name && dev.sha256 === record.sha256 && dev.deployedUtc === record.deployedUtc && dev.component === 'gamemode' && dev.edited === false);
    yes('and nothing about where it runs or which machine sent it', !('root' in dev) && !('from' in dev) && !('edits' in dev));
    yes('an edited one says so', (got['thornswood-docs'] || {}).edited === true);
    yes('a record that does not read is named, not dropped, and hides nothing else', (got['thornswood-bot'] || {}).unreadable === true);
    yes('no folder is an empty answer, not a failure', JSON.stringify(readDeploys ? readDeploys(path.join(dir, 'nope')) : null) === '{}');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // ------------------------------------------------- the site door (#1359)
  /*
    A real copy of site\server.js in a temp folder on a spare port, with one
    record in its store, asked by three callers. The config written here has
    no client id and no bot token, so the copy asks Discord nothing: the
    password door is on, which is the hub member cookie, and standing() gives
    the admin list its roles and everybody else an ordinary member.
  */
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-deploys-site-'));
  try {
    const store = path.join(site, 'deploys');
    fs.mkdirSync(store, { recursive: true });
    fs.writeFileSync(path.join(store, 'thornswood-docs.json'),
      JSON.stringify(Object.assign({}, record, { part: 'thornswood-docs', component: 'site' })));

    const SECRET = crypto.randomBytes(32).toString('hex');
    const PASSWORD = crypto.randomBytes(12).toString('hex');
    const ADMIN_ID = '111111111111111111';
    siteFiles.copy(site);
    fs.mkdirSync(path.join(site, 'public'), { recursive: true });
    try { fs.copyFileSync(path.join(REPO, 'site', 'public', 'home.html'), path.join(site, 'public', 'home.html')); } catch (e) { }
    fs.mkdirSync(path.join(site, 'data'), { recursive: true });
    fs.writeFileSync(path.join(site, 'config.json'), JSON.stringify({
      password: PASSWORD,
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'),
      admins: [ADMIN_ID],
      secret: SECRET,
      gameCheckPort: 1,
      onlineFile: path.join(site, 'online.json')
    }, null, 2));

    // The two cookies the site itself would mint (server.js: memberToken(),
    // identity()), built with this copy's own password and secret.
    const memberCookie = 'tw=' + crypto.createHash('sha256').update('thornswood:' + PASSWORD).digest('hex');
    const at = Date.now();
    const raw = ADMIN_ID + '|Admin|' + at + '|' +
      crypto.createHmac('sha256', SECRET).update(ADMIN_ID + '|Admin|' + at).digest('hex').slice(0, 32);
    const adminCookie = 'twa=' + encodeURIComponent(raw);

    const port = await freePort();
    const srv = spawn(process.execPath, ['server.js'], {
      cwd: site,
      env: Object.assign({}, process.env, {
        THORNSWOOD_DOCS_PORT: String(port),
        THORNSWOOD_DOCS_LOCAL: '1',
        THORNSWOOD_DEPLOYS_DIR: store,
        THORNSWOOD_CHAT_DIR: path.join(site, 'chat')
      })
    });
    let out = '';
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    try {
      let up = false;
      for (let i = 0; i < 120 && !up; i++) {
        if (out.indexOf('listening on ') >= 0) { up = true; break; }
        if (srv.exitCode !== null) break;
        await wait(50);
      }
      yes('a scratch copy of the site came up', up);
      if (!up) throw new Error('the scratch site never came up:\n' + out);

      // Nothing of the record may be in a refusal: the commit, the zip name,
      // the hash and the hour it went out are each looked for by hand.
      const leaks = (r) => [record.commit, record.name, record.sha256, record.deployedUtc]
        .some((v) => r.body.indexOf(v) >= 0);

      const anon = await ask(port, '/api/deploys', '');
      yes('nobody signed in is refused 401 (' + anon.status + ')', anon.status === 401);
      yes('and told nothing but to sign in', !leaks(anon) && !!anon.json && anon.json.error === 'sign in first');

      const mem = await ask(port, '/api/deploys', memberCookie);
      yes('a hub member who is not staff is refused 403 (' + mem.status + ')', mem.status === 403);
      yes('and told nothing but that it is staff only', !leaks(mem) && !!mem.json && mem.json.error === 'staff only');

      const staff = await ask(port, '/api/deploys', adminCookie);
      const got = (staff.json && staff.json.parts && staff.json.parts['thornswood-docs']) || null;
      yes('staff still get the records (' + staff.status + ')', staff.status === 200 && !!got);
      yes('with the commit, zip, hash and when, as before',
        !!got && got.commit === record.commit && got.name === record.name &&
        got.sha256 === record.sha256 && got.deployedUtc === record.deployedUtc);

      // The public front is untouched: the change is this door, not the site.
      const pub = await ask(port, '/api/public', '');
      yes('and /api/public still answers anybody, carrying no deploy record',
        pub.status === 200 && !leaks(pub) && !!pub.json && !('parts' in pub.json));
    } finally {
      // It was killed and left 300 ms, and was often still there when the
      // harness ended (#1960); now it is waited for until it has gone.
      await stopped(srv);
    }
  } finally {
    try { fs.rmSync(site, { recursive: true, force: true }); } catch (e) { }
  }

  // ----------------------------------------------------------------- voice
  const voice = read('voice/voice-server.js');
  yes('voice-server.js reads the record beside itself', voice.includes("path.join(dir, 'thornswood-deploy.json')"));
  yes('and /health carries it', /build: BUILD, deploy: deployRecord\(HERE\)/.test(voice));
  // Each start is on a port of its own from the system, and nothing is asked
  // of it until that service has said it is listening there. It was a fixed
  // 7931 (#1703): two builds on the VPS reached this in the same second, and
  // one run's /health was answered by the other run's service, the one with a
  // record beside it.
  async function health(withRecord) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-voice-deploy-'));
    fs.copyFileSync(path.join(REPO, 'voice', 'voice-server.js'), path.join(d, 'voice-server.js'));
    fs.copyFileSync(path.join(REPO, 'voice', 'headlines.js'), path.join(d, 'headlines.js'));
    if (withRecord) fs.writeFileSync(path.join(d, 'thornswood-deploy.json'), JSON.stringify(Object.assign({}, record, { component: 'voice' })));
    const port = await freePort();
    const srv = spawn(process.execPath, ['voice-server.js'], { cwd: d,
      env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_SITE: '', THORNSWOOD_VOICE_BIND: '127.0.0.1' }) });
    srv.stdout.on('data', () => {}); srv.stderr.on('data', () => {});
    let h = null;
    try {
      await listening(srv, port);
      const r = await fetch('http://127.0.0.1:' + port + '/health');
      if (r.ok) h = await r.json();
    } catch (e) {
      console.log('      ' + e.message);
    } finally {
      await stopped(srv);
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { }
    }
    return h;
  }
  const none = await health(false);
  yes('the voice service answers /health', !!none && none.ok === true);
  yes('with no record beside it, deploy is null', !!none && none.deploy === null);
  const some = await health(true);
  yes('with one, /health says its commit, zip and hash',
    !!some && !!some.deploy && some.deploy.commit === record.commit && some.deploy.name === record.name && some.deploy.sha256 === record.sha256 && some.deploy.edited === false);
  yes('and not where it runs or who sent it', !!some && !!some.deploy && !('root' in some.deploy) && !('from' in some.deploy));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  /*
    Ended rather than exited (#1960). Measured with process._getActiveHandles()
    at this line: the last voice service's ChildProcess (killed, SIGTERM) and
    a destroyed pipe were still listed, node still letting go of them, gone
    1 to 2 ms later. process.exit() in that moment tripped libuv's
    "!(handle->flags & UV_HANDLE_CLOSING)" (src\win\async.c:76, exit 127) on
    node 24 on Windows in 5 of 5 runs after all checks had passed, and so
    test-1703-test-ports.js, which runs three copies, failed all three. So
    the code is set and node leaves once everything is let go. The catch
    below still exits, because after a throw a service may be left running.
  */
  process.exitCode = fail ? 1 : 0;
}
main().catch((e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
