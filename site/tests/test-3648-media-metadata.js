'use strict';
/*
  test-3648-media-metadata.js

      node .\site\tests\test-3648-media-metadata.js

  #3648: gallery pictures went out with their Exif, GPS position included,
  because the site kept the file byte for byte and /shot/<name> served it to
  anyone. Against a real copy of site\server.js in a scratch folder on a
  spare port, with the pictures and recordings in
  tests\fixtures\media-3648.js (a phone's Exif with a GPS block, XMP, IPTC,
  comments, a second picture after the end, a recording's position and
  times), it proves:

    - each, sent as a launcher from before this would send it, is kept as
      exactly the bytes the fixture says: the describing blocks gone, every
      block of the picture or recording itself unchanged, the orientation and
      the colour profile kept;
    - once accepted, /shot/<name> with no ?w= serves those bytes, and none of
      them holds a GPS block, an Exif block with more than the orientation,
      XMP, a comment or a recording's position;
    - a picture that is already clean is kept byte for byte;
    - a file whose blocks cannot be walked is refused 415 and not kept;
    - node server.js --strip-metadata <folder>, the one-off for files sent
      before this (scripts\vps\Strip-Uploads.ps1), cleans a folder and the
      folders in it the same way, names what it could not clean, exits 1 for
      it, starts no site, and finds nothing to do a second time;
    - the privacy page says what is taken out.

  Nothing leaves the machine: no bot token, so standing() asks Discord
  nothing and the admin list decides who is staff.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const siteFiles = require('../../tests/site-files');
const { cases } = require('../../tests/fixtures/media-3648.js');

const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'site');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3648-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_ID = '111111111111111111';
const MEMBER_ID = '222222222222222222';

siteFiles.copy(dir);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.copyFileSync(path.join(APP, 'public', 'home.html'), path.join(dir, 'public', 'home.html'));
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [ADMIN_ID],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));

function ticket(id) {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: 'x', x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + b + '.' + crypto.createHmac('sha256', SECRET).update('ticket:' + b).digest('hex').slice(0, 32);
}
const T = (id) => 'ticket=' + encodeURIComponent(ticket(id));
const TYPE = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let PORT = 0;
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks), text = raw.toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        done({ status: res.statusCode, body: text, raw: raw, json: json });
      });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), raw: Buffer.alloc(0), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const submit = (file, bytes, type) => ask('POST', '/api/gallery/submit?' + T(MEMBER_ID) + '&name=' + encodeURIComponent(file) + '&by=Djinn',
  { 'content-type': type }, bytes);
const approve = (name) => ask('POST', '/api/gallery/approve?' + T(ADMIN_ID), { 'content-type': 'application/json' }, JSON.stringify({ name: name }));

// What a served file must not hold, whatever its kind: read off the bytes,
// not off the fixture, so a fixture that was wrong could not hide one.
function leaks(b) {
  const text = b.toString('latin1');
  const found = [];
  for (const word of ['GPS', 'xmpmeta', 'taken at home', 'LOCATION', 'ISO6709', '+40.7123', 'Photoshop', 'Cam\0', 'after the end', 'maker notes']) {
    if (text.indexOf(word) >= 0) found.push(JSON.stringify(word));
  }
  // Every Exif TIFF in the file: its first IFD may hold the orientation and
  // nothing else, so no GPS block (0x8825) and no camera (0x010f).
  for (let at = text.indexOf('MM\0*'); at >= 0; at = text.indexOf('MM\0*', at + 1)) {
    const ifd = at + b.readUInt32BE(at + 4);
    if (ifd + 2 > b.length) continue;
    const n = b.readUInt16BE(ifd);
    for (let k = 0; k < n && ifd + 2 + k * 12 + 2 <= b.length; k++) {
      const tag = b.readUInt16BE(ifd + 2 + k * 12);
      if (tag !== 0x0112) found.push('Exif tag 0x' + tag.toString(16));
    }
  }
  return found;
}

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  // The site writes its log line before it answers, but the line comes back
  // on the child's stderr pipe and the answer on its socket, and this process
  // can read the answer first: on the merge queue's Linux share of 2 Nov 2026
  // (run 41382651846) the 415 was read while the line was still in the pipe.
  // So a check of the log waits for the pipe to deliver it, and fails, saying
  // so, when it never comes.
  const logged = (re, ms) => new Promise((resolve) => {
    if (re.test(out)) return resolve(true);
    const look = () => { if (re.test(out)) { done(true); } };
    const timer = setTimeout(() => done(false), ms);
    function done(v) { clearTimeout(timer); srv.stderr.off('data', look); srv.stdout.off('data', look); resolve(v); }
    srv.stderr.on('data', look);
    srv.stdout.on('data', look);
  });
  try {
    for (let i = 0; i < 100 && out.indexOf('listening on ') < 0 && srv.exitCode === null; i++) await wait(50);
    if (out.indexOf('listening on ') < 0) throw new Error('the scratch site never came up:\n' + out);

    for (const c of cases) {
      const file = c.name + c.ext;
      yes('the ' + file + ' fixture itself holds what a phone writes, or is the clean one',
          c.clean === null || c.dirty.equals(c.clean) || leaks(c.dirty).length > 0);
      const before = fs.readdirSync(path.join(dir, 'uploads')).length;
      const r = await submit(file, c.dirty, TYPE[c.ext]);
      if (c.clean === null) {
        yes(file + ', whose blocks cannot be walked, is refused 415 (' + r.status + ')', r.status === 415);
        yes('and nothing of it is kept', fs.readdirSync(path.join(dir, 'uploads')).length === before);
        yes('and the site says which upload in its log', await logged(/could not clean the upload \S+broken\.jpg: its blocks could not be walked/, 10000));
        continue;
      }
      const name = r.json && r.json.name;
      yes(file + ' goes in (' + r.status + ')', r.status === 200 && !!name);
      if (!name) continue;
      const kept = fs.readFileSync(path.join(dir, 'uploads', name));
      yes(file + ' is kept as exactly the clean bytes (' + kept.length + ' of ' + c.dirty.length + ')', kept.equals(c.clean));
      yes('and nothing is left beside it', !fs.readdirSync(path.join(dir, 'uploads')).some((n) => /\.strip$/.test(n)));
      const a = await approve(name);
      yes(file + ' is accepted (' + a.status + ')', a.status === 200);
      const s = await ask('GET', '/shot/' + encodeURIComponent(name));
      yes('/shot/ serves ' + file + ' at full size as the clean bytes (' + s.status + ')', s.status === 200 && s.raw.equals(c.clean));
      const found = leaks(s.raw);
      yes('and it holds no position, camera, time, XMP or comment' + (found.length ? ' (' + found.join(', ') + ')' : ''), found.length === 0);
    }

    // A camera picture turned a quarter is still measured turned, so its
    // copies are still asked for at its shown shape.
    const turned = cases.find((c) => c.name === 'camera');
    yes('the kept JPEG still says it is turned (orientation 6)', turned.clean.indexOf(Buffer.from('0112000300000001000600', 'hex')) > 0);
  } finally {
    srv.kill();
  }

  // ---- the one-off for files already on the box -----------------------------
  const folder = path.join(dir, 'old-uploads');
  fs.mkdirSync(path.join(folder, 'small'), { recursive: true });
  for (const c of cases) fs.writeFileSync(path.join(folder, c.name === 'turned' ? 'small' : '', c.name + c.ext), c.dirty);
  fs.writeFileSync(path.join(folder, 'uploads.json'), '{}');
  let run = spawnSync(process.execPath, ['server.js', '--strip-metadata', folder], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  yes('--strip-metadata exits 1 when a file could not be cleaned (' + run.status + ')', run.status === 1);
  yes('and names it', /NOT CLEANED {2}broken\.jpg: its blocks could not be walked/.test(run.stdout));
  yes('and names each file it cleaned, with what went and that it held a position',
      cases.filter((c) => c.clean && !c.dirty.equals(c.clean)).every((c) => new RegExp('cleaned  (small[\\\\/])?' + c.name + '\\' + c.ext + ': .*\\(it held a position\\)').test(run.stdout)));
  yes('and says the counts', /9 files looked at, 6 had blocks taken out, 6 held a position, 1 could not be cleaned/.test(run.stdout));
  yes('and starts no site', run.stdout.indexOf('listening on') < 0 && run.stderr.indexOf('listening on') < 0);
  yes('each cleaned file is the clean bytes, in the folder inside too',
      cases.filter((c) => c.clean).every((c) => fs.readFileSync(path.join(folder, c.name === 'turned' ? 'small' : '', c.name + c.ext)).equals(c.clean)));
  yes('the one it could not clean is left as it was', fs.readFileSync(path.join(folder, 'broken.jpg')).equals(cases.find((c) => c.name === 'broken').dirty));
  fs.unlinkSync(path.join(folder, 'broken.jpg'));
  run = spawnSync(process.execPath, ['server.js', '--strip-metadata', folder], { cwd: dir, encoding: 'utf8', timeout: 60000 });
  yes('a second run finds nothing to do and exits 0 (' + run.status + ')',
      run.status === 0 && /8 files looked at, 0 had blocks taken out, 0 held a position, 0 could not be cleaned/.test(run.stdout));

  // ---- the privacy page ----------------------------------------------------
  const privacy = fs.readFileSync(path.join(APP, 'data', 'site', 'privacy.md'), 'utf8').replace(/\s+/g, ' ');
  yes('the privacy page says the GPS position, the time and the camera are taken out as the file arrives',
      /where it was taken \(a phone or camera often writes the GPS position\), when, and with which camera or program\. The site takes all of that out as the file arrives, so none of it is kept or shown\./.test(privacy));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(1);
});
