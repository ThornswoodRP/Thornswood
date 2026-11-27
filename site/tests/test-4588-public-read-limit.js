'use strict';
/*
  test-4588-public-read-limit.js

      node .\site\tests\test-4588-public-read-limit.js
      node .\site\tests\test-4588-public-read-limit.js <an older server.js>

  Issue #4588. GET /api/public, /api/gallery, /api/releases, /api/roadmap and
  /api/page/* answer 429 once publicApiWait (lib/limits.js) says one sender
  has read PUBLIC_API_CAP times in PUBLIC_API_WINDOW. With the call replaced
  by `const retry = 0;` every site test still passed: no test read past it.

  Against a copy of the site in a scratch folder on a spare port. The copy
  sees every request come from 127.0.0.1, as behind Caddy, so each sender is
  told apart by its X-Forwarded-For, the way the door names it:
    A  one sender's first PUBLIC_API_CAP reads, across the five routes, are
       none of them refused;
    B  its next read on each of the five is 429, with a Retry-After of at
       least 1 and no more than the window, in seconds;
    C  another sender is still answered on each of the five.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = path.resolve(process.argv[2] || path.join(APP, 'server.js'));

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

// The cap and the window as the copy has them.
const src = siteFiles.source(SITE_SRC);
const limits = /const PUBLIC_API_WINDOW = (\d+), PUBLIC_API_CAP = (\d+);/.exec(src);
const WINDOW = limits ? Number(limits[1]) : 60000;
const CAP = limits ? Number(limits[2]) : 120;
yes('the copy names its window and cap (' + WINDOW + ' ms, ' + CAP + ')', !!limits);

const ROUTES = ['/api/public', '/api/gallery', '/api/releases', '/api/roadmap', '/api/page/rules'];

function get(port, where, from) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: where, agent: false,
      headers: { 'x-forwarded-for': from } }, (res) => {
      res.resume();
      res.on('end', () => done({ status: res.statusCode, retry: res.headers['retry-after'] }));
    });
    req.on('error', (e) => done({ status: 0, retry: String(e) }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4588-'));
  let srv = null, out = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.mkdirSync(path.join(dir, 'data', 'site'), { recursive: true });
    fs.copyFileSync(path.join(APP, 'data', 'site', 'rules.md'), path.join(dir, 'data', 'site', 'rules.md'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    const port = (await siteFiles.listening(srv)).port;
    const A = '203.0.113.7', B = '198.51.100.9';

    console.log('\nA. one sender\'s first ' + CAP + ' reads:');
    const refused = [];
    const seen = {};
    for (let i = 0; i < CAP; i++) {
      const where = ROUTES[i % ROUTES.length];
      const r = await get(port, where, A);
      seen[r.status] = (seen[r.status] || 0) + 1;
      if (r.status === 429 || r.status === 0) refused.push(where + ' #' + (i + 1) + ': ' + r.status);
    }
    yes('none is refused (' + Object.keys(seen).map((s) => seen[s] + ' x ' + s).join(', ') + ')', refused.length === 0, refused.slice(0, 5).join('; '));

    console.log('\nB. its next read on each route:');
    for (const where of ROUTES) {
      const r = await get(port, where, A);
      const secs = Number(r.retry);
      yes(where + ' is 429 with a Retry-After inside the window (' + r.status + ', ' + r.retry + ')',
        r.status === 429 && Number.isInteger(secs) && secs >= 1 && secs <= Math.ceil(WINDOW / 1000));
    }

    console.log('\nC. another sender:');
    for (const where of ROUTES) {
      const r = await get(port, where, B);
      yes(where + ' is still answered (' + r.status + ')', r.status !== 429 && r.status !== 0);
    }
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
