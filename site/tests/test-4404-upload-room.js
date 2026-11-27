'use strict';
/*
  test-4404-upload-room.js

      node .\site\tests\test-4404-upload-room.js
      node .\site\tests\test-4404-upload-room.js <an older server.js>

  Issue #4404. Nothing limited how much uploads/ held: the only limit was
  per address per hour, the gallery's queue had no length while pictures
  wait up to 90 days, and no upload looked at the room left on the disk the
  site, its stores and its logs share.

  Against a copy of the site in a scratch folder on a spare port, with the
  disk's free space stood in for by a preload:
    A  with less free than UPLOAD_FREE_FLOOR plus the file, a gallery
       submission and a hub upload are refused 507 with words to show, and
       leave no file and no queue entry; with room, the same are taken;
    B  a file that declares no size counts at the door's cap;
    C  free space that cannot be read is said, answered 500, and no file is
       taken;
    D  one account may have GALLERY_WAITING_EACH pictures waiting and no
       more: the next is refused 429 with words to show, and another
       account's waiting pictures do not count against it.

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
const LIB = path.join(path.dirname(SITE_SRC), 'lib');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

const src = fs.readFileSync(path.join(LIB, 'uploads.js'), 'utf8');
const num = (name, fallback) => {
  const m = new RegExp('const ' + name + ' = ([0-9 *]+);').exec(src);
  return m ? m[1].split('*').reduce((a, b) => a * Number(b.trim()), 1) : fallback;
};
const FLOOR = num('UPLOAD_FREE_FLOOR', 2 * 1024 * 1024 * 1024);
const EACH = num('GALLERY_WAITING_EACH', 20);
const CAP = num('GALLERY_CAP', 100 * 1024 * 1024);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4404-'));
const PASSWORD = crypto.randomBytes(12).toString('hex');
const UPDIR = path.join(dir, 'uploads');
const PENDING = path.join(dir, 'data', 'gallery-pending.json');
const FREE = path.join(dir, 'free.json');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f0e0000000049454e44ae426082', 'hex');
const memberCookie = () => 'tw=' + crypto.createHash('sha256').update('thornswood:' + PASSWORD).digest('hex');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const files = () => (fs.existsSync(UPDIR) ? fs.readdirSync(UPDIR) : []).filter((n) => n !== 'uploads.json' && !n.startsWith('.') && n !== 'small');
const queued = () => readJson(PENDING) || [];

/* The disk's free space, read from free.json on every call: a number of
   bytes, "fail" for a read that fails, or null for the real disk. */
function disk() {
  const fs = require('fs');
  const real = fs.statfsSync;
  fs.statfsSync = function () {
    let v = null;
    try { v = JSON.parse(fs.readFileSync(process.env.TS_FREE, 'utf8')); } catch (e) { v = null; }
    if (v === null) return real.apply(this, arguments);
    if (v === 'fail') { const e = new Error('EIO: i/o error, statfs'); e.code = 'EIO'; throw e; }
    return { type: 0, bsize: 1, blocks: v, bfree: v, bavail: v, files: 0, ffree: 0 };
  };
}
const free = (v) => fs.writeFileSync(FREE, JSON.stringify(v));

let PORT = 0;
function send(where, type, body, chunked) {
  return new Promise((done) => {
    const headers = { 'content-type': type, cookie: memberCookie(), origin: 'http://127.0.0.1:' + PORT };
    if (chunked) headers['transfer-encoding'] = 'chunked';
    else headers['content-length'] = body.length;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', agent: false, path: where, headers: headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { } done({ status: res.statusCode, body: text, json: json }); });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    req.end(body);
  });
}
const submit = (chunked) => send('/api/gallery/submit?name=a.png&by=Ada', 'image/png', PNG, chunked);
const hubUpload = () => send('/api/upload?name=log.txt&by=Ada', 'text/plain', Buffer.from('a log line\n'));

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
    fs.writeFileSync(path.join(dir, 'disk.js'), '(' + disk.toString() + ')();\n');
    free(null);
    srv = spawn(process.execPath, ['-r', path.join(dir, 'disk.js'), 'server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), TS_FREE: FREE })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    PORT = (await siteFiles.listening(srv)).port;

    console.log('A. below the floor:');
    free(FLOOR);
    let r = await submit();
    yes('a gallery submission is refused 507 (' + r.status + ')', r.status === 507 && r.json && /disk space/.test(r.json.error), r.body);
    r = await hubUpload();
    yes('and so is a hub upload (' + r.status + ')', r.status === 507 && r.json && /disk space/.test(r.json.error), r.body);
    yes('no file was kept, and nothing is queued (' + files().join(', ') + ')', files().length === 0 && queued().length === 0);
    yes('the site\'s log says it, with the room and the floor', /"event":"disk-low"/.test(out));
    free(FLOOR + 1024 * 1024);
    r = await submit();
    yes('with room, the submission is taken (' + r.status + ')', r.status === 200 && queued().length === 1, r.body);
    r = await hubUpload();
    yes('and so is the hub upload (' + r.status + ')', r.status === 200, r.body);

    console.log('\nB. a file that declares no size:');
    free(FLOOR + CAP - 1);
    const before = files().length;
    r = await submit(true);
    yes('counts at the cap, and is refused 507 (' + r.status + ')', r.status === 507 && files().length === before, r.body);
    free(FLOOR + CAP);
    r = await submit(true);
    yes('and is taken with room for the cap (' + r.status + ')', r.status === 200, r.body);

    console.log('\nC. free space that cannot be read:');
    free('fail');
    const n = files().length;
    r = await hubUpload();
    yes('is answered 500 with words to show (' + r.status + ')', r.status === 500 && r.json && /how much room/.test(r.json.error), r.body);
    yes('no file was taken, and the log says why', files().length === n && /could not read the free space for uploads \(EIO\)/.test(out));
    free(null);

    console.log('\nD. one account\'s waiting pictures:');
    // Another account's twenty, which do not count against this sender.
    const others = [];
    for (let i = 0; i < EACH; i++) others.push({ name: 'other-' + i + '.png', by: 'Bea', at: Date.now(), from: 'launcher', discordId: '999' });
    fs.writeFileSync(PENDING, JSON.stringify(others.concat(queued())));
    let took = 0;
    for (let i = 0; i < EACH; i++) {
      r = await submit();
      if (r.status === 200) took++;
      else { yes('submission ' + (i + 1) + ' was taken (' + r.status + ')', false, r.body); break; }
      if (queued().filter((x) => !x.discordId).length >= EACH) break;
    }
    const mine = queued().filter((x) => !x.discordId).length;
    yes('the sender reaches ' + EACH + ' waiting, with another account\'s ' + EACH + ' on the queue (' + mine + ')', mine === EACH);
    const files0 = files().length;
    r = await submit();
    yes('the next is refused 429 with words to show (' + r.status + ')', r.status === 429 && r.json && r.json.why === 'waiting' &&
        /waiting for staff/.test(r.json.error), r.body);
    yes('and leaves no file and no queue entry', files().length === files0 && queued().filter((x) => !x.discordId).length === EACH);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
