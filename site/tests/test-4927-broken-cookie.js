'use strict';
/*
  test-4927-broken-cookie.js

      node .\site\tests\test-4927-broken-cookie.js
      node .\site\tests\test-4927-broken-cookie.js <an older server.js>

  Issue #4927. identity() ran decodeURIComponent on the raw twa cookie with
  no guard, and who() reads it for every request, so a twa value with a
  percent sign that does not decode threw URIError, which the handler answers
  as a malformed request: every page and API answered 400 "bad request" until
  the visitor cleared the site's cookies.

  Against a copy of the site in a scratch folder on a spare port, for twa
  values with a lone percent sign, a cut sequence and hex that is not UTF-8:
    A  /, /news and /api/public answer as they do with no cookie at all;
    B  /api/hello answers 401, signed out, as it does with no cookie;
    C  and the site logs no URIError.

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

const BROKEN = ['%', '%E0%A4%A', '%E0%A4', 'a%zz|b|1|c'];
const PATHS = ['/', '/news', '/api/public'];

function get(port, where, cookie) {
  return new Promise((done) => {
    const headers = { host: '127.0.0.1:' + port };
    if (cookie !== undefined) headers.cookie = 'twa=' + cookie;
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: where, agent: false, headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => done({ status: res.statusCode, text }));
    });
    req.on('error', (e) => done({ status: 0, text: String(e) }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4927-'));
  let srv = null, said = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.cpSync(path.join(path.dirname(SITE_SRC), 'public'), path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { said += d; });
    srv.stderr.on('data', (d) => { said += d; });
    const port = (await siteFiles.listening(srv)).port;

    const plain = {};
    for (const p of PATHS) plain[p] = (await get(port, p)).status;
    yes('with no cookie the pages answer (' + PATHS.map((p) => p + ' ' + plain[p]).join(', ') + ')',
        PATHS.every((p) => plain[p] === 200));

    console.log('A. pages with a twa cookie that will not decode:');
    for (const c of BROKEN) {
      for (const p of PATHS) {
        const r = await get(port, p, c);
        yes(p + ' with twa=' + c + ' answers as with none (' + r.status + ')', r.status === plain[p], r.text);
      }
    }

    console.log('\nB. /api/hello:');
    const none = await get(port, '/api/hello');
    yes('with no cookie it answers 401, signed out (' + none.status + ')', none.status === 401, none.text);
    for (const c of BROKEN) {
      const r = await get(port, '/api/hello', c);
      let j = null; try { j = JSON.parse(r.text); } catch (e) { j = null; }
      yes('with twa=' + c + ' it answers 401, signed out (' + r.status + ')',
          r.status === 401 && !!j && j.ok === false && !j.admin, r.text);
    }

    console.log('\nC. the log:');
    yes('the site logs no URIError', !/URIError/.test(said), said.split('\n').filter((l) => /URIError/.test(l)).slice(0, 2).join('\n'));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, said);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
