'use strict';
/*
  test-4402-file-streams.js

      node .\site\tests\test-4402-file-streams.js
      node .\site\tests\test-4402-file-streams.js <an older server.js>

  Issue #4402. The routes that send a file (/up/, /shot/, /file/, the
  feed's assets, public/ and its byte ranges) checked the name with
  existsSync, which is true for a folder, and piped a read stream that had
  no 'error' listener. A folder's name (GET /up/small, the smaller copies'
  folder) or a file that could not be opened (locked, removed since the
  stat, not readable) threw outside handle(), and the uncaught exception
  handler stopped the site.

    A  against a copy of the site in a scratch folder on a spare port: a
       folder asked for at /up/, at public/ with a Range and at the feed's
       assets, with and without a Range, is answered 404 and the site keeps
       running; a real file at each still comes, whole and in a range;
    B  lib/http.js streamFile, run here on a server of its own: a file that
       is not there when it opens is answered 404 and nothing is thrown; a
       read that fails after the headers went (a folder, which opens on
       Linux and then cannot be read) ends that one answer and nothing is
       thrown, and the next request is answered;
    C  no read stream is made anywhere in the site but in streamFile, which
       opens the file before a header is written and reads it through
       pipeline, so none is left without an error handler.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.resolve(process.argv[2] || path.join(ROOT, 'site', 'server.js'));
const LIB = path.join(path.dirname(SITE), 'lib');
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 400).split('\n').join('\n      ') : '')); }
}

let thrown = 0;
process.on('uncaughtException', (e) => { thrown++; console.log('      thrown here: ' + (e && e.message)); });

function ask(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const h = Object.assign({ host: '127.0.0.1:' + port }, headers || {});
    if (data) { h['content-type'] = 'application/json'; h['content-length'] = data.length; }
    const r = http.request({ host: '127.0.0.1', port, method, path: where, agent: false, headers: h }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('latin1'), ended: true }));
      res.on('aborted', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('latin1'), ended: false }));
      res.on('error', () => ok({ status: res.statusCode, headers: res.headers, text: Buffer.concat(parts).toString('latin1'), ended: false }));
    });
    r.setTimeout(15000, () => r.destroy(new Error('no answer in 15 seconds')));
    r.on('error', (e) => ok({ status: 0, text: String(e), ended: false }));
    r.end(data || undefined);
  });
}

(async function main() {
  // ---------------------------------------------------------------- A --
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4402-'));
  let srv = null, said = '', gone = null;
  const password = crypto.randomBytes(12).toString('hex');
  const FOLDER_ASSET = 'a'.repeat(64), FILE_ASSET = 'b'.repeat(64);
  try {
    siteFiles.copy(dir, SITE);
    for (const d of ['data', 'public/adir', 'uploads/small', 'feed/assets/' + FOLDER_ASSET]) fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, 'public', 'ok.txt'), 'hello there');
    fs.writeFileSync(path.join(dir, 'uploads', 'a.png'), 'not really a png');
    fs.writeFileSync(path.join(dir, 'feed', 'assets', FILE_ASSET), 'pack bytes');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password,
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: ['111111111111111111'],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = spawn(process.execPath, [path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { said += d; });
    srv.stderr.on('data', (d) => { said += d; });
    srv.on('exit', (c, sig) => { gone = c === null ? sig : c; });
    const port = (await siteFiles.listening(srv)).port;
    const up = () => gone === null;
    const own = 'http://127.0.0.1:' + port;

    let r = await ask(port, 'POST', '/api/login', { origin: own }, { password });
    const cookie = String(((r.headers || {})['set-cookie'] || [])[0] || '').split(';')[0];
    yes('a hub member signs in with the password (' + r.status + ')', r.status === 200 && /^tw=/.test(cookie), r.text);

    console.log('\nA. a folder\'s name is not a file, and the site keeps running:');
    const folders = [
      ['/up/small', { cookie }],
      ['/adir', { range: 'bytes=0-1' }],
      ['/feed/assets/' + FOLDER_ASSET, {}],
      ['/feed/assets/' + FOLDER_ASSET, { range: 'bytes=0-1' }]
    ];
    for (const [where, h] of folders) {
      r = await ask(port, 'GET', where, h);
      await new Promise((ok) => setTimeout(ok, 150));
      yes('GET ' + where + (h.range ? ' with a Range' : '') + ' answers 404 (' + r.status + '), and the site is still running',
          r.status === 404 && up(), r.text + (up() ? '' : '\nthe site stopped (' + gone + '): ' + said.split('\n').filter((l) => /uncaught/.test(l)).join(' ')));
      if (!up()) break;
    }
    yes('and the site logged no uncaught exception', !/uncaught exception/.test(said), said.split('\n').filter((l) => /uncaught/.test(l)).slice(0, 2).join('\n'));

    console.log('\nand a file at each still comes:');
    if (up()) {
      r = await ask(port, 'GET', '/up/a.png', { cookie });
      yes('GET /up/a.png sends it (' + r.status + ')', r.status === 200 && r.text === 'not really a png', r.text);
      r = await ask(port, 'GET', '/ok.txt', { range: 'bytes=0-4' });
      yes('GET /ok.txt with bytes=0-4 sends those five (' + r.status + ' ' + r.text + ')', r.status === 206 && r.text === 'hello' && r.headers['content-range'] === 'bytes 0-4/11');
      r = await ask(port, 'GET', '/feed/assets/' + FILE_ASSET, {});
      yes('GET a feed asset sends it whole (' + r.status + ')', r.status === 200 && r.text === 'pack bytes', r.text);
      r = await ask(port, 'GET', '/feed/assets/' + FILE_ASSET, { range: 'bytes=5-' });
      yes('and from byte 5 with a Range (' + r.status + ' ' + r.text + ')', r.status === 206 && r.text === 'bytes');
      r = await ask(port, 'HEAD', '/feed/assets/' + FILE_ASSET, {});
      yes('a HEAD gives its length and no body (' + r.status + ')', r.status === 200 && r.headers['content-length'] === '10' && r.text === '');
    } else {
      yes('the site was still running to be asked', false);
    }
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, said);
  } finally {
    if (srv) srv.kill();
  }

  // ---------------------------------------------------------------- B --
  console.log('\nB. streamFile:');
  let h = null;
  try { h = require(path.join(LIB, 'http.js')); } catch (e) { yes('lib/http.js loads: ' + e.message, false); }
  yes('lib/http.js gives streamFile and isFile', !!h && typeof h.streamFile === 'function' && typeof h.isFile === 'function');
  if (h && typeof h.streamFile === 'function') {
    const real = path.join(dir, 'public', 'ok.txt');
    yes('isFile: a file is one, a folder and a name that is not there are not',
        h.isFile(real) && !h.isFile(path.join(dir, 'public', 'adir')) && !h.isFile(path.join(dir, 'nothing-here')));
    let next = null;
    const box = http.createServer((req, res) => { const n = next; next = null; n(res); });
    await new Promise((ok) => box.listen(0, '127.0.0.1', ok));
    const port = box.address().port;
    const via = (fn) => { next = fn; return ask(port, 'GET', '/'); };

    let r = await via((res) => h.streamFile(res, path.join(dir, 'gone-since-its-stat'), 200, { 'content-type': 'text/plain', 'content-length': 11 }));
    yes('a file not there when it opens is answered 404, not 200 and nothing (' + r.status + ')', r.status === 404 && r.ended);
    r = await via((res) => h.streamFile(res, path.join(dir, 'public', 'adir'), 200, { 'content-type': 'text/plain', 'content-length': 4096 }));
    yes('a read that fails once it has started ends that answer short (' + r.status + ', ' + (r.ended ? 'whole' : 'cut') + ')',
        r.status === 0 || r.status >= 400 || !r.ended);
    await new Promise((ok) => setTimeout(ok, 100));
    r = await via((res) => h.streamFile(res, real, 200, { 'content-type': 'text/plain', 'content-length': 11 }));
    yes('and the next one is answered, whole (' + r.status + ' ' + r.text + ')', r.status === 200 && r.text === 'hello there');
    r = await via((res) => h.streamFile(res, real, 206, { 'content-type': 'text/plain', 'content-length': 5 }, { start: 6, end: 10 }));
    yes('a range sends the bytes asked for (' + r.status + ' ' + r.text + ')', r.status === 206 && r.text === 'there');
    yes('nothing was thrown outside a request (' + thrown + ')', thrown === 0);
    box.close();
  }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }

  // ---------------------------------------------------------------- C --
  console.log('\nC. every file the site streams goes through streamFile:');
  const texts = [path.join(path.dirname(SITE), 'server.js')].concat(
    fs.existsSync(LIB) ? fs.readdirSync(LIB).filter((f) => f.endsWith('.js')).map((f) => path.join(LIB, f)) : []);
  const makers = [];
  for (const f of texts) {
    const t = fs.readFileSync(f, 'utf8');
    const n = (t.match(/createReadStream\(/g) || []).length;
    for (let i = 0; i < n; i++) makers.push(path.basename(f));
  }
  yes('one read stream is made in the site, in lib/http.js (' + makers.join(', ') + ')', makers.length === 1 && makers[0] === 'http.js');
  // Windows checks the repository out with CRLF line ends.
  const httpText = fs.existsSync(path.join(LIB, 'http.js')) ? fs.readFileSync(path.join(LIB, 'http.js'), 'utf8').split('\r\n').join('\n') : '';
  const fn = /function streamFile\([\s\S]*?\n}\n/.exec(httpText);
  yes('and it is streamFile\'s, which opens the file before it writes a header and reads it through pipeline', !!fn &&
      fn[0].indexOf('fs.openSync(') >= 0 && fn[0].indexOf('fs.openSync(') < fn[0].indexOf('res.writeHead(') &&
      /pipeline\(fs\.createReadStream\(/.test(fn[0]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
