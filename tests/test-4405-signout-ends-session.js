'use strict';
/*
  test-4405-signout-ends-session.js

      node tests\test-4405-signout-ends-session.js

  #4405. Signing out of the site only told the browser to drop its twa
  cookie. The cookie is the account's id, name and the time it was made,
  signed by the site, and identity() in site\lib\auth.js took any copy whose
  signature checked out and that was under thirty days old. So a copy taken
  from a shared machine or a browser backup kept working for the rest of the
  thirty days after its owner signed out, and for staff it carries bans,
  deletions and gallery approval.

  Against a real copy of the site in a scratch folder on a spare port:
    1. a staff sign in reaches the hub;
    2. a copy of that cookie is taken, and the owner signs out;
    3. the copy is refused afterwards;
    4. a fresh sign in by the same account still works;
    5. another account's sign in, made before, is untouched;
    6. after the site restarts, the copy is still refused and the fresh
       sign in still works, so the end of the sign in is kept, not held in
       memory only;
    7. what the site keeps of the sign out names no Discord id.

  Nothing leaves the machine and the scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const SITE_SRC = path.join(siteFiles.APP, 'server.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4405-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const AELA = '111111111111111111';
const BJORN = '222222222222222222';
siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [AELA, BJORN],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
// The cookie the site's Discord sign in sets: id|name|made|signature.
function signIn(id, name) {
  const at = String(Date.now());
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sign(id + '|' + name + '|' + at));
}

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
let PORT = 0;
function ask(method, where, cookie) {
  return new Promise((done) => {
    const headers = { cookie: cookie };
    // A sign out is a write, and the site refuses a write that names no page
    // of its own (#1367).
    if (method !== 'GET') headers.origin = 'http://127.0.0.1:' + PORT;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        done({ status: res.statusCode, json: json, headers: res.headers });
      });
    });
    req.setTimeout(15000, () => req.destroy());
    req.on('error', (e) => done({ status: 0, json: null, headers: {}, error: String(e) }));
    req.end();
  });
}
// Signed in as staff: the hub's whole answer comes back.
const reachesHub = async (cookie) => {
  const r = await ask('GET', '/api/all', cookie);
  return r.status === 200 && !!r.json;
};

async function start() {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
                                          THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 1200; i++) {
    if (/\[thornswood-docs\] (ready|NOT READY): /.test(out)) return { srv, out: () => out };
    if (srv.exitCode !== null) break;
    await wait(50);
  }
  throw new Error('the scratch site never came up:\n' + out);
}
function stop(s) {
  return new Promise((ok) => {
    if (!s || s.srv.exitCode !== null) return ok();
    s.srv.on('exit', ok);
    s.srv.kill();
    setTimeout(ok, 3000);
  });
}

(async () => {
  let site = null;
  try {
    site = await start();

    // 1 and 2
    const aela = signIn(AELA, 'Aela');
    const copy = aela;
    const bjorn = signIn(BJORN, 'Bjorn');
    yes('1 a staff sign in reaches the hub', await reachesHub(aela));
    yes('  and so does another account\'s', await reachesHub(bjorn));
    const out = await ask('POST', '/api/logout', aela);
    const cleared = [].concat(out.headers['set-cookie'] || []).some((c) => /^twa=;.*Max-Age=0/.test(c));
    yes('2 signing out answers ok and clears the cookie in that browser (' + out.status + ')',
        out.status === 200 && !!out.json && out.json.ok === true && cleared);

    // 3, 4 and 5
    yes('3 a copy of the cookie made before the sign out is refused after it', !(await reachesHub(copy)));
    await wait(5);
    const fresh = signIn(AELA, 'Aela');
    yes('4 a fresh sign in by the same account still works', await reachesHub(fresh));
    yes('5 another account\'s sign in, made before the sign out, is untouched', await reachesHub(bjorn));

    // 6
    await stop(site);
    site = await start();
    yes('6 after the site restarts the copy is still refused', !(await reachesHub(copy)));
    yes('  and the fresh sign in still works', await reachesHub(fresh));

    // 7
    const named = [];
    for (const f of fs.readdirSync(path.join(dir, 'data'))) {
      const p = path.join(dir, 'data', f);
      if (!/^signouts/i.test(f) || !fs.statSync(p).isFile()) continue;
      if (fs.readFileSync(p, 'utf8').indexOf(AELA) >= 0) named.push(f);
    }
    yes('7 what the site keeps of the sign out names no Discord id' + (named.length ? ' (' + named.join(', ') + ' does)' : ''),
        named.length === 0);
  } catch (err) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (err && err.stack ? err.stack : err));
  }
  await stop(site);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
