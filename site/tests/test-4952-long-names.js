'use strict';
/*
  test-4952-long-names.js

      node .\site\tests\test-4952-long-names.js
      node .\site\tests\test-4952-long-names.js <an older server.js>

  Issue #4952. receiveUpload cut the cleaned file name to 90 characters
  before it read the extension, so a gallery picture whose name was longer
  lost its ".png" and was refused 415 "that kind of file is not allowed
  here", and a long hub upload was saved with no extension at all.

  Against a copy of the site in a scratch folder on a spare port:
    A  a gallery picture with a 109-character name ending in .png is taken,
       queued and saved under a name that still ends in .png and keeps the
       name's start, at most 90 characters after the site's stamp;
    B  a hub upload with a long .txt name is saved ending in .txt;
    C  a short name is saved as it was sent, and a long name whose only dot
       is near its start (so its "extension" is longer than the cap) is cut
       whole and still refused by the gallery, as before.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4952-'));
const PASSWORD = crypto.randomBytes(12).toString('hex');
const UPDIR = path.join(dir, 'uploads');
const PENDING = path.join(dir, 'data', 'gallery-pending.json');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f0e0000000049454e44ae426082', 'hex');
let MEMBER = '';
let PORT = 0;
function signIn() {
  return new Promise((done, failed) => {
    const text = JSON.stringify({ password: PASSWORD });
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: '/api/login', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), origin: 'http://127.0.0.1:' + PORT } }, (res) => {
      res.resume();
      const c = String((res.headers['set-cookie'] || []).find((x) => /^tw=/.test(x)) || '').split(';')[0];
      if (res.statusCode === 200 && c) done(c); else failed(new Error('the hub sign in answered ' + res.statusCode));
    });
    req.on('error', failed);
    req.end(text);
  });
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const queued = () => (readJson(PENDING) || []).map((x) => x.name);
const files = () => (fs.existsSync(UPDIR) ? fs.readdirSync(UPDIR) : []).filter((n) => n !== 'uploads.json' && !n.startsWith('.') && n !== 'small');

function send(where, type, body) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', agent: false, path: where,
      headers: { 'content-type': type, 'content-length': body.length, cookie: MEMBER, origin: 'http://127.0.0.1:' + PORT } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { } done({ status: res.statusCode, body: text, json: json }); });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    req.end(body);
  });
}
const submit = (name) => send('/api/gallery/submit?name=' + encodeURIComponent(name) + '&by=Ada', 'image/png', PNG);
const hub = (name) => send('/api/upload?name=' + encodeURIComponent(name) + '&by=Ada', 'text/plain', Buffer.from('a log line\n'));
// What the site keeps of the name after its stamp (<date>-<time>-<12 hex>-).
const kept = (saved) => String(saved || '').replace(/^\d{8}-\d{4}-[0-9a-f]{12}-/, '');

(async () => {
  let srv = null, out = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: PASSWORD,
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    PORT = (await siteFiles.listening(srv)).port;
    MEMBER = await signIn();

    console.log('A. a gallery picture with a long name:');
    const long = 'Screenshot of the long hall in Whiterun at dusk with the whole party standing by the fire ' + '2026-11-27.png';
    yes('the name is over 90 characters (' + long.length + ')', long.length > 90);
    let r = await submit(long);
    const g = r.json && r.json.name;
    yes('it is taken (' + r.status + ')', r.status === 200 && !!g, r.body);
    yes('and queued, its file saved', !!g && queued().indexOf(g) >= 0 && fs.existsSync(path.join(UPDIR, g)));
    yes('under a name that still ends in .png (' + g + ')', /\.png$/.test(String(g)));
    yes('keeping the start of the name, at most 90 characters (' + kept(g).length + ')',
        kept(g).length <= 90 && kept(g).indexOf('Screenshot of the long hall') === 0);

    console.log('\nB. a hub upload with a long name:');
    const longText = 'server log from the evening of the twenty seventh with the crash and everything after it as well.txt';
    r = await hub(longText);
    const h = r.json && r.json.name;
    yes('it is taken (' + r.status + ')', r.status === 200 && !!h, r.body);
    yes('and saved ending in .txt (' + h + ')', /\.txt$/.test(String(h)) && kept(h).length <= 90 && kept(h).indexOf('server log from') === 0 && files().indexOf(h) >= 0);

    console.log('\nC. names the cut leaves as they were:');
    r = await submit('Screenshot 2026-10-30 214512.png');
    yes('a short name is saved as it was sent (' + (r.json && r.json.name) + ')',
        r.status === 200 && kept(r.json && r.json.name) === 'Screenshot 2026-10-30 214512.png', r.body);
    r = await submit('a.' + 'b'.repeat(120));
    yes('a long name whose only dot is near its start is still refused as the wrong kind (' + r.status + ')', r.status === 415, r.body);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
