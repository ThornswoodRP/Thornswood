'use strict';
/*
  test-4923-weak-etag.js

      node .\site\tests\test-4923-weak-etag.js
      node .\site\tests\test-4923-weak-etag.js <an older server.js>

  Issue #4923. The public-file branch and the feed's version.json answered
  304 only for an If-None-Match that was exactly the tag they sent. RFC 9110
  13.1.2 has the header be a list, "*" match any answer, and the tags be
  compared weakly. A proxy that compresses (Cloudflare) marks a strong tag
  W/, so a browser's check sent a weak tag back and downloaded the whole
  file again.

  Against a copy of the site in a scratch folder on a spare port:
    A  a public file (marked-LICENSE.txt) answers 304 to its tag, to W/ and its tag,
       to a list with its tag first or last, and to "*"; and 200 with the
       whole file to a list that does not hold it;
    B  the same for /feed/version.json;
    C  /feed/watch with the tag a proxy marked W/ waits, as it does with the
       strong tag, and with another tag answers at once.

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

/* GET where, or null when nothing has come back after quiet ms. */
function get(port, where, headers, quiet) {
  return new Promise((done) => {
    let timer = null;
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: where, agent: false,
      headers: Object.assign({ host: '127.0.0.1:' + port }, headers || {}) }, (res) => {
      if (timer) clearTimeout(timer);
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => done({ status: res.statusCode, etag: String(res.headers.etag || ''), body: Buffer.concat(parts) }));
    });
    req.on('error', (e) => { if (timer) clearTimeout(timer); done(quiet ? null : { status: 0, etag: '', body: Buffer.from(String(e)) }); });
    if (quiet) timer = setTimeout(() => { req.destroy(); done(null); }, quiet);
    else req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

async function asks(port, where, what) {
  const first = await get(port, where);
  const tag = first.etag;
  yes(what + ' answers 200 with a strong tag (' + first.status + ', ' + tag + ')',
      first.status === 200 && /^"[^"]+"$/.test(tag));
  const match = [
    ['its tag', tag],
    ['W/ and its tag, as a proxy that compresses sends it', 'W/' + tag],
    ['a list with its tag last', '"stale", ' + tag],
    ['a list with its weak tag first', 'W/' + tag + ', "stale"'],
    ['*', '*']
  ];
  for (const [name, header] of match) {
    const r = await get(port, where, { 'if-none-match': header });
    yes('  asked with ' + name + ': 304 with no body (' + r.status + ')', r.status === 304 && r.body.length === 0 && r.etag === tag);
  }
  for (const [name, header] of [['a list without it', '"stale", W/"older"'], ['its tag with a letter changed', tag.replace(/.(?=")/, (c) => (c === 'a' ? 'b' : 'a'))]]) {
    const r = await get(port, where, { 'if-none-match': header });
    yes('  asked with ' + name + ': 200 and the whole answer (' + r.status + ')', r.status === 200 && r.body.equals(first.body));
  }
  return tag;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4923-'));
  let srv = null, said = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.cpSync(PUBLIC, path.join(dir, 'public'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'feed', 'version'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'feed', 'version', '00000001.json'), JSON.stringify({ version: '1.0.0' }));
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

    console.log('A. a public file:');
    await asks(port, '/marked-LICENSE.txt', '/marked-LICENSE.txt');

    console.log('\nB. the feed:');
    const tag = await asks(port, '/feed/version.json', '/feed/version.json');

    console.log('\nC. the feed watch:');
    const strong = await get(port, '/feed/watch', { 'if-none-match': tag }, 1500);
    yes('with the strong tag it waits', strong === null, strong && strong.status);
    const weak = await get(port, '/feed/watch', { 'if-none-match': 'W/' + tag }, 1500);
    yes('with the tag marked W/ it waits too', weak === null, weak && weak.status);
    const other = await get(port, '/feed/watch', { 'if-none-match': '"stale"' }, 5000);
    yes('with another tag it answers at once with the tag (' + (other && other.status) + ')',
        !!other && other.status === 200 && other.etag === tag);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, said);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
