'use strict';
/*
  test-4403-unqueued-file.js

      node .\site\tests\test-4403-unqueued-file.js
      node .\site\tests\test-4403-unqueued-file.js <an older server.js>

  Issue #4403. POST /api/gallery/submit saves the picture and writes its note
  (with the sender's Discord id) before it puts the picture on the queue. A
  queue that would not save was answered 500 and the file and note stayed: on
  no list, so expirePending never aged them and pruneRemovedUploads, which
  takes only files marked removed, never deleted them.

  Against a copy of the site in a scratch folder on a spare port, with chosen
  saves refused the way a folder the site cannot write refuses them:
    A  with the queue refused, the sender is answered 500, and the picture's
       file and its note are gone;
    B  with the queue refused and the file itself refusing to be deleted,
       the file is marked removed on uploads.json, so the hourly sweep
       deletes it and its note once it can;
    C  with nothing refused, a picture is queued with its file and note, as
       before.

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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4403-'));
const PASSWORD = crypto.randomBytes(12).toString('hex');
const UPDIR = path.join(dir, 'uploads');
const PENDING = path.join(dir, 'data', 'gallery-pending.json');
const REFUSE = path.join(dir, 'refuse.json');
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000002000154a24f0e0000000049454e44ae426082', 'hex');
const memberCookie = () => 'tw=' + crypto.createHash('sha256').update('thornswood:' + PASSWORD).digest('hex');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
const notes = () => readJson(path.join(UPDIR, 'uploads.json')) || {};
const queued = () => (readJson(PENDING) || []).map((x) => x.name);
const files = () => (fs.existsSync(UPDIR) ? fs.readdirSync(UPDIR) : []).filter((n) => n !== 'uploads.json' && !n.startsWith('.'));

/* The refused saves and deletes, read from refuse.json on every call so the
   harness changes them between requests. A save is refused by the file's
   name (putJson's temp copy beside it too); a delete by the end of the
   name, since the site stamps each upload's name. */
function refuse() {
  const fs = require('fs');
  const path = require('path');
  const list = process.env.TS_REFUSE;
  const asked = () => { try { return JSON.parse(fs.readFileSync(list, 'utf8')); } catch (e) { return {}; } };
  const no = (p) => { const e = new Error('EACCES: permission denied, \'' + p + '\''); e.code = 'EACCES'; return e; };
  const write = fs.writeFileSync;
  fs.writeFileSync = function (p) {
    const base = typeof p === 'string' ? path.basename(p).replace(/^\.(.+)\.\d+\.tmp$/, '$1') : '';
    if (base && (asked().save || []).indexOf(base) >= 0) throw no(p);
    return write.apply(this, arguments);
  };
  const unlink = fs.unlinkSync;
  fs.unlinkSync = function (p) {
    if (typeof p === 'string' && (asked().unlink || []).some((end) => p.endsWith(end))) throw no(p);
    return unlink.apply(this, arguments);
  };
}
const refusing = (o) => fs.writeFileSync(REFUSE, JSON.stringify(o));

let PORT = 0;
function submit(name) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', agent: false,
      path: '/api/gallery/submit?name=' + encodeURIComponent(name) + '&by=Ada',
      headers: { 'content-type': 'image/png', 'content-length': PNG.length, cookie: memberCookie(), origin: 'http://127.0.0.1:' + PORT } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { } done({ status: res.statusCode, body: text, json: json }); });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    req.end(PNG);
  });
}

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
    fs.writeFileSync(path.join(dir, 'refuse.js'), '(' + refuse.toString() + ')();\n');
    refusing({});
    srv = spawn(process.execPath, ['-r', path.join(dir, 'refuse.js'), 'server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
        THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), TS_REFUSE: REFUSE })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    PORT = (await siteFiles.listening(srv)).port;

    console.log('A. the queue refused:');
    refusing({ save: ['gallery-pending.json'] });
    let r = await submit('a.png');
    yes('the sender is answered 500 (' + r.status + ')', r.status === 500 && !(r.json && r.json.ok), r.body);
    yes('the picture is not on the queue', !queued().some((n) => /-a\.png$/.test(n)));
    yes('its file is gone (' + files().join(', ') + ')', !files().some((n) => /-a\.png$/.test(n)));
    yes('and so is its note', !Object.keys(notes()).some((n) => /-a\.png$/.test(n)));

    console.log('\nB. the queue refused, and the file will not delete:');
    refusing({ save: ['gallery-pending.json'], unlink: ['-b.png'] });
    r = await submit('b.png');
    yes('the sender is answered 500 (' + r.status + ')', r.status === 500, r.body);
    const b = files().find((n) => /-b\.png$/.test(n));
    yes('the file is still there, as it would not delete', !!b);
    yes('and its note is marked removed, so the hourly sweep deletes it', !!b && !!(notes()[b] && notes()[b].removed));
    yes('and it is not on the queue', !!b && queued().indexOf(b) < 0);

    console.log('\nC. nothing refused:');
    refusing({});
    r = await submit('c.png');
    const c = r.json && r.json.name;
    yes('the picture is queued (' + r.status + ')', r.status === 200 && !!c && queued().indexOf(c) >= 0, r.body);
    yes('with its file and its note', !!c && fs.existsSync(path.join(UPDIR, c)) && !!notes()[c] && !notes()[c].removed);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
