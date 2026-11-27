'use strict';
/*
  test-4925-text-types.js

      node .\site\tests\test-4925-text-types.js
      node .\site\tests\test-4925-text-types.js <an older server.js>

  Issue #4925. The site's type list had no .txt or .json, so the licence
  texts the credits page links to and page-versions.json went out as a bare
  text/plain. marked-LICENSE.txt is UTF-8 with a (c) sign and curly quotes,
  nosniff is on and the file has no BOM, so a browser read it as
  Windows-1252 and showed "Copyright Â© 2004".

  Against a copy of the site in a scratch folder on a spare port:
    A  each .txt in site/public goes out as text/plain; charset=utf-8, its
       bytes as they are on disk;
    B  page-versions.json goes out as application/json; charset=utf-8;
    C  every kind of file in site/public has a type in the list, so a new
       kind cannot go out with the bare fallback unseen.

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
const PUBLIC = path.join(path.dirname(SITE_SRC), 'public');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

function get(port, where) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: where, agent: false,
      headers: { host: '127.0.0.1:' + port } }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => done({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(parts) }));
    });
    req.on('error', (e) => done({ status: 0, type: '', body: Buffer.from(String(e)) }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4925-'));
  let srv = null, said = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.cpSync(PUBLIC, path.join(dir, 'public'), { recursive: true });
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

    console.log('A. the .txt files:');
    const txts = fs.readdirSync(PUBLIC).filter((n) => /\.txt$/i.test(n)).sort();
    yes('site/public has the licence texts (' + txts.join(', ') + ')', txts.indexOf('marked-LICENSE.txt') >= 0);
    for (const n of txts) {
      const r = await get(port, '/' + n);
      yes('/' + n + ' goes out as text/plain; charset=utf-8 (' + r.status + ', ' + r.type + ')',
          r.status === 200 && /^text\/plain; charset=utf-8$/i.test(r.type));
      yes('  with its bytes as they are on disk', r.body.equals(fs.readFileSync(path.join(PUBLIC, n))));
    }
    const marked = fs.readFileSync(path.join(PUBLIC, 'marked-LICENSE.txt'), 'utf8');
    yes('marked-LICENSE.txt does hold a (c) sign, the character the bare type garbled', marked.indexOf('©') >= 0);

    console.log('\nB. page-versions.json:');
    const j = await get(port, '/page-versions.json');
    let parsed = null; try { parsed = JSON.parse(j.body.toString('utf8')); } catch (e) { parsed = null; }
    yes('goes out as application/json; charset=utf-8 (' + j.status + ', ' + j.type + ')',
        j.status === 200 && /^application\/json; charset=utf-8$/i.test(j.type) && parsed !== null);

    console.log('\nC. every kind of file in site/public:');
    const { TYPES } = require(path.join(dir, 'lib', 'http.js'));
    const kinds = Array.from(new Set(fs.readdirSync(PUBLIC).filter((n) => fs.statSync(path.join(PUBLIC, n)).isFile())
      .map((n) => path.extname(n).toLowerCase()))).sort();
    const none = kinds.filter((k) => !TYPES[k]);
    yes('has a type in the list (' + kinds.join(' ') + ')', none.length === 0, 'no type for: ' + none.join(' '));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, said);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
