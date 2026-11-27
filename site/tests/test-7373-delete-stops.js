'use strict';
/*
  test-7373-delete-stops.js

      node .\site\tests\test-7373-delete-stops.js
      node .\site\tests\test-7373-delete-stops.js <an older server.js>

  Issue #7373. A gallery Delete (DELETE /api/gallery/approved) whose file
  would not delete and whose note on uploads.json then would not save left
  the file on disk, on no list and not marked removed: a second Delete was
  refused for a name on no list (#4401), and pruneRemovedUploads, the hourly
  sweep, takes only marked files, so nothing ever deleted it.

  For each place a Delete can stop (the note, the gallery, the queue, the
  reports, the file, and the note and the file together, which is the
  issue's case), with a picture on the gallery and the queue and its file on
  the site:
    1  the Delete is not answered ok;
    2  afterwards the name is marked removed or still on a list, so a second
       Delete or the sweep finds it;
    3  a second Delete, with nothing refused, finishes it: the file gone, the
       name on no list and its note gone.
  And a Delete stopped at the file is finished by the sweep alone.

  A refused save is a preload that refuses renameSync onto a named file, as
  a whole write puts it in place; a file that will not delete is a preload
  that refuses unlinkSync of it. Discord is answered by the preload; nothing
  leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn, spawnSync } = require('node:child_process');
const siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw7373-'));
const secret = crypto.randomBytes(32).toString('hex');
const staff = '111111111111111111';
let child, port, pass = 0, fail = 0;
function yes(name, ok, why) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (!ok && why ? '\n      ' + String(why).slice(0, 600) : ''));
  ok ? pass++ : fail++;
}
function write(name, value) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); }
function read(name, fallback) { try { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); } catch (e) { return fallback; } }
function signed(value) { return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32); }
function cookie(id) { const value = id + '|Staff|' + Date.now(); return 'twa=' + encodeURIComponent(value + '|' + signed(value)); }

/* refuse.json: { save: [file names a rename onto is refused],
   unlink: [file names an unlink of is refused] }. */
function preload() {
  const https = require('node:https'), fs = require('node:fs'), path = require('node:path');
  const { EventEmitter } = require('node:events');
  const rename = fs.renameSync.bind(fs), unlink = fs.unlinkSync.bind(fs);
  const asked = () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'refuse.json'), 'utf8')); } catch (e) { return {}; } };
  fs.renameSync = (from, to) => {
    if ((asked().save || []).indexOf(path.basename(String(to))) >= 0) throw Object.assign(Error('fixture refused save'), { code: 'EACCES' });
    return rename(from, to);
  };
  fs.unlinkSync = (p) => {
    if ((asked().unlink || []).indexOf(path.basename(String(p))) >= 0) throw Object.assign(Error('fixture refused delete'), { code: 'EBUSY' });
    return unlink(p);
  };
  function request(options, callback) {
    const host = String(options.hostname || options.host || ''), route = String(options.path || '');
    const members = [{ user: { id: '111111111111111111', username: 'Staff' }, roles: ['staff'] }];
    let body;
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture') body = { id: 'fixture', name: 'Fixture' };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/roles') body = [{ id: 'staff', name: 'Gamemaster' }];
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/members?limit=1000') body = members;
    if (host === 'discord.com' && route.startsWith('/api/v10/guilds/fixture/members/')) body = members.find(row => route.endsWith('/' + row.user.id));
    const req = new EventEmitter(); req.setTimeout = () => req; req.destroy = () => {}; req.write = () => true;
    req.end = () => setImmediate(() => {
      if (!body) return req.emit('error', Error('fixture blocks external request ' + host + route));
      const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.complete = true; res.setEncoding = () => {}; res.resume = () => {};
      callback(res); res.emit('data', Buffer.from(JSON.stringify(body))); res.emit('end');
    });
    return req;
  }
  https.request = request;
  https.get = (options, callback) => { const req = request(options, callback); req.end(); return req; };
}
const refuse = (r) => write('refuse.json', r || {});

async function del(name) {
  const response = await fetch('http://127.0.0.1:' + port + '/api/gallery/approved', {
    method: 'DELETE', redirect: 'manual', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + port, cookie: cookie(staff) },
    body: JSON.stringify({ name }), signal: AbortSignal.timeout(15000)
  });
  return { status: response.status, body: await response.json() };
}
const names = (file) => (read(file, []) || []).map((x) => String(x && x.name));
const marked = (name) => { const n = read('uploads/uploads.json', {}) || {}; return !!(n[name] && n[name].removed); };
const onList = (name) => names('data/gallery.json').includes(name) || names('data/gallery-pending.json').includes(name) || names('data/gallery-reports.json').includes(name);
const fileThere = (name) => fs.existsSync(path.join(dir, 'uploads', name));

let shot = 0;
function picture(withReport) {
  shot++;
  const name = '20261127-' + crypto.createHash('sha1').update('shot ' + shot).digest('hex') + '.png';
  fs.writeFileSync(path.join(dir, 'uploads', name), 'picture ' + shot);
  write('data/gallery.json', [{ name, by: 'Photographer', at: Date.now() }]);
  write('data/gallery-pending.json', [{ name, by: 'Photographer', at: Date.now() }]);
  write('data/gallery-reports.json', withReport ? [{ id: 'r' + shot, name, why: 'test' }] : []);
  return name;
}

(async () => {
  try {
    siteFiles.copy(dir, process.argv[2]);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true });
    write('config.json', { secret, password: crypto.randomBytes(16).toString('hex'), admins: [],
      discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: 'fixture', guildId: 'fixture' },
      access: { admin: ['Owner'], dev: ['Gamemaster'], play: ['Playtester'], banned: ['Banned'] }, gameCheckPort: 1 });
    write('uploads/uploads.json', {});
    write('data/gallery.json', []);
    refuse();
    fs.writeFileSync(path.join(dir, 'network.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'network.js'), path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1' }
    });
    let out = ''; child.stdout.on('data', (d) => { out += d; }); child.stderr.on('data', (d) => { out += d; });
    port = (await siteFiles.listening(child)).port;

    const stops = [
      ['the note', { save: ['uploads.json'] }],
      ['the gallery', { save: ['gallery.json'] }],
      ['the queue', { save: ['gallery-pending.json'] }],
      ['the reports', { save: ['gallery-reports.json'] }, true],
      ['the file', { unlink: [] }],
      ['the file and then the note (the issue\'s case)', { save: ['uploads.json'], unlink: [] }]
    ];
    for (const [where, how, withReport] of stops) {
      const name = picture(withReport);
      if (how.unlink) how.unlink = [name];
      console.log('\nStopped at ' + where + ':');
      refuse(how);
      const r = await del(name);
      yes('1 the Delete is not answered ok (' + r.status + ')', r.status !== 200 && r.body.ok !== true, JSON.stringify(r.body));
      yes('2 the name is marked removed or still on a list', marked(name) || onList(name),
        'marked ' + marked(name) + ', lists ' + JSON.stringify([names('data/gallery.json'), names('data/gallery-pending.json')]) + ', file ' + fileThere(name));
      refuse();
      const again = await del(name);
      if (withReport && again.body.heldForReport) {
        // A reported picture is held, its file on disk and marked, for the
        // sweep to delete once the hold is up (#2352).
        yes('3 a second Delete finishes it: held for its report, off every list', again.status === 200 && marked(name) && !onList(name), JSON.stringify(again.body));
      } else {
        yes('3 a second Delete finishes it: file gone, on no list, no note', again.status === 200 && !fileThere(name) && !onList(name) && !marked(name), JSON.stringify(again.body));
      }
    }

    console.log('\nThe sweep:');
    const name = picture(false);
    refuse({ unlink: [name] });
    const r = await del(name);
    yes('a Delete stopped at the file is not answered ok, and the name is marked (' + r.status + ')', r.status !== 200 && marked(name), JSON.stringify(r.body));
    refuse();
    const sweep = spawnSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./lib/uploads").pruneRemovedUploads(Date.now())))'],
      { cwd: dir, encoding: 'utf8', timeout: 60000, env: { ...process.env, THORNSWOOD_DOCS_LOCAL: '1' } });
    yes('and the hourly sweep deletes its file and its note (' + String(sweep.stdout).trim() + ')',
      !fileThere(name) && !marked(name), String(sweep.stdout) + String(sweep.stderr));
  } catch (e) {
    yes('the harness ran (' + (e && e.message) + ')', false, e && e.stack);
  } finally {
    try { child && child.kill(); } catch (e) { /* already gone */ }
    if (child) await new Promise((ok) => { if (child.exitCode !== null || child.signalCode) ok(); else child.once('exit', ok); });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
  }
})();
