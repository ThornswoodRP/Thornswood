'use strict';
/*
  test-4401-gallery-names.js

      node .\site\tests\test-4401-gallery-names.js
      node .\site\tests\test-4401-gallery-names.js <an older server.js>

  Issue #4401. POST /api/gallery/approve put any name in uploads/ on
  gallery.json, so Accept on uploads.json made /shot/uploads.json hand the
  whole notes file to anybody, Discord ids and all. DELETE
  /api/gallery/approved deleted any file in uploads/ by its name: a hub upload
  that only an admin may delete through DELETE /api/upload/<name>, or
  uploads.json itself, with every removed mark and held report in it.

  Against a copy of the site in a scratch folder on a spare port, this holds:
    A  Accept refuses a name that is not waiting for staff or on the gallery
       (uploads.json, the small folder, a hub upload, a name in other
       letters), and the gallery is left as it was, with /shot/ serving none
       of them;
    B  Delete refuses the same names and leaves their files and notes alone;
    C  uploads.json and the small folder are never accepted or deleted, even
       when gallery.json already lists them (as the old Accept left them):
       Delete takes the entry off the gallery and leaves the file and folder;
    D  a picture that was sent goes through as before: accepted, shown at
       /shot/, then deleted with its file;
    E  both doors check the name with submissionName (lib/uploads.js).

  Nothing leaves the machine: no bot token, so Discord is asked nothing. The
  scratch folder is removed at the end.
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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4401-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const PASSWORD = crypto.randomBytes(12).toString('hex');
const ADMIN_ID = '111111111111111111';
const UPDIR = path.join(dir, 'uploads');
const GALLERY = path.join(dir, 'data', 'gallery.json');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f0e0000000049454e44ae426082', 'hex');

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const adminCookie = () => {
  const at = Date.now();
  const raw = ADMIN_ID + '|Admin|' + at + '|' + sign(ADMIN_ID + '|Admin|' + at);
  return 'twa=' + encodeURIComponent(raw);
};
/* The hub's member cookie, from the site's own sign in with the password,
   as the hub gets it. */
let MEMBER = '';
const memberCookie = () => MEMBER;
function signIn(port) {
  return new Promise((done, failed) => {
    const text = JSON.stringify({ password: PASSWORD });
    const req = http.request({ host: '127.0.0.1', port: port, method: 'POST', path: '/api/login', agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), origin: 'http://127.0.0.1:' + port } }, (res) => {
      res.resume();
      const c = String((res.headers['set-cookie'] || []).find((x) => /^tw=/.test(x)) || '').split(';')[0];
      if (res.statusCode === 200 && c) done(c); else failed(new Error('the hub sign in answered ' + res.statusCode));
    });
    req.on('error', failed);
    req.end(text);
  });
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const listed = () => (readJson(GALLERY) || []).map((g) => g.name);

let PORT = 0;
function ask(method, where, headers, body) {
  return new Promise((done) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(body));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    if (method !== 'GET' && Object.keys(h).some((k) => k.toLowerCase() === 'cookie')) h.origin = 'http://127.0.0.1:' + PORT;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => { chunks.push(d); });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { json = null; }
        done({ status: res.statusCode, body: text, json: json });
      });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const staff = { 'content-type': 'application/json', cookie: '' };
const approve = (name) => ask('POST', '/api/gallery/approve', Object.assign({}, staff, { cookie: adminCookie() }), JSON.stringify({ name: name }));
const remove = (name) => ask('DELETE', '/api/gallery/approved', Object.assign({}, staff, { cookie: adminCookie() }), JSON.stringify({ name: name }));

(async () => {
  let srv = null, out = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: PASSWORD,
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'),
      admins: [ADMIN_ID],
      secret: SECRET,
      gameCheckPort: 1,
      onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    PORT = (await siteFiles.listening(srv)).port;
    MEMBER = await signIn(PORT);

    // A picture sent to the gallery, a hub upload, and a small copy's folder.
    let r = await ask('POST', '/api/gallery/submit?name=a.png&by=Ada', { 'content-type': 'image/png', cookie: memberCookie() }, PNG);
    const shot = r.json && r.json.name;
    yes('a picture is sent to the gallery (' + r.status + ')', r.status === 200 && !!shot, r.body);
    r = await ask('POST', '/api/upload?name=notes.txt&by=Djinn', { 'content-type': 'text/plain', cookie: memberCookie() }, 'a hub upload\n');
    const hub = r.json && r.json.name;
    yes('a file is put on the hub (' + r.status + ')', r.status === 200 && !!hub, r.body);
    fs.mkdirSync(path.join(UPDIR, 'small'), { recursive: true });
    fs.writeFileSync(path.join(UPDIR, 'small', 'kept.webp'), 'a small copy');
    const notesBefore = fs.readFileSync(path.join(UPDIR, 'uploads.json'), 'utf8');
    yes('uploads.json holds the notes of both', !!readJson(path.join(UPDIR, 'uploads.json'))[shot] && !!readJson(path.join(UPDIR, 'uploads.json'))[hub]);

    const strangers = ['uploads.json', 'UPLOADS.JSON', 'small', hub, '..', 'never-sent.png'];

    console.log('\nA. Accept takes only a picture waiting or on the gallery:');
    for (const n of strangers) {
      r = await approve(n);
      yes('Accept on ' + n + ' is refused 404 (' + r.status + ')', r.status === 404, r.body);
    }
    yes('and the gallery lists none of them (' + listed().join(', ') + ')', !strangers.some((n) => listed().indexOf(n) >= 0));
    r = await ask('GET', '/shot/uploads.json');
    yes('/shot/uploads.json serves nothing (' + r.status + ')', r.status === 404 && r.body.indexOf(shot) < 0);

    console.log('\nB. Delete takes only a picture waiting, on the gallery or reported:');
    for (const n of strangers) {
      r = await remove(n);
      yes('Delete on ' + n + ' is refused 404 (' + r.status + ')', r.status === 404, r.body);
    }
    yes('the hub upload is still there', fs.existsSync(path.join(UPDIR, hub)));
    yes('uploads.json is still there, as it was', fs.existsSync(path.join(UPDIR, 'uploads.json')) &&
        fs.readFileSync(path.join(UPDIR, 'uploads.json'), 'utf8') === notesBefore);
    yes('and so is the small folder', fs.existsSync(path.join(UPDIR, 'small', 'kept.webp')));

    console.log('\nC. a gallery.json that already lists them:');
    fs.writeFileSync(GALLERY, JSON.stringify([
      { name: 'uploads.json', url: '/shot/uploads.json', by: '' },
      { name: 'small', url: '/shot/small', by: '' }
    ]));
    r = await approve('uploads.json');
    yes('Accept on uploads.json is still refused (' + r.status + ')', r.status === 404, r.body);
    r = await approve('small');
    yes('Accept on small is still refused (' + r.status + ')', r.status === 404, r.body);
    r = await remove('uploads.json');
    yes('Delete takes uploads.json off the gallery (' + r.status + ')', r.status === 200 && listed().indexOf('uploads.json') < 0, r.body);
    yes('  and leaves the notes file as it was', fs.existsSync(path.join(UPDIR, 'uploads.json')) &&
        fs.readFileSync(path.join(UPDIR, 'uploads.json'), 'utf8') === notesBefore && r.json && r.json.fileDeleted === false);
    r = await remove('small');
    yes('Delete takes small off the gallery (' + r.status + ')', r.status === 200 && listed().indexOf('small') < 0, r.body);
    yes('  and leaves the small folder', fs.existsSync(path.join(UPDIR, 'small', 'kept.webp')));

    console.log('\nD. a picture that was sent still goes through:');
    r = await approve(shot);
    yes('it is accepted (' + r.status + ')', r.status === 200 && listed().indexOf(shot) >= 0, r.body);
    r = await ask('GET', '/shot/' + shot);
    yes('and shown at /shot/ (' + r.status + ')', r.status === 200);
    r = await remove(shot);
    yes('then deleted with its file (' + r.status + ')', r.status === 200 && listed().indexOf(shot) < 0 &&
        !fs.existsSync(path.join(UPDIR, shot)) && r.json && r.json.fileDeleted === true, r.body);
    yes('and the hub upload is still there after it', fs.existsSync(path.join(UPDIR, hub)));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) srv.kill();
  }

  console.log('\nE. both doors check the name:');
  const up = fs.readFileSync(path.join(LIB, 'uploads.js'), 'utf8');
  const serve = fs.readFileSync(path.join(LIB, 'serve.js'), 'utf8');
  yes('lib/uploads.js has submissionName', /function submissionName\(name\)/.test(up));
  const door = (start) => {
    const i = serve.indexOf(start);
    const j = i < 0 ? -1 : serve.indexOf('\n  if (p === ', i + start.length);
    return i < 0 ? '' : serve.slice(i, j < 0 ? undefined : j);
  };
  const acc = door("if (p === '/api/gallery/approve' && req.method === 'POST')");
  const del = door("if (p === '/api/gallery/approved' && req.method === 'DELETE')");
  yes('Accept checks it before the gallery is written', acc.indexOf('submissionName(name)') >= 0 &&
      acc.indexOf('submissionName(name)') < acc.indexOf('putJson(GALLERY'));
  yes('Delete checks it before a file is touched', del.indexOf('submissionName(name)') >= 0 &&
      del.indexOf('submissionName(name)') < del.indexOf('deleteUpload('));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
