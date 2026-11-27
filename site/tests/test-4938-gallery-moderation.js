'use strict';
// Real local gallery HTTP, canonical staff authentication and persisted audit.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { once } = require('node:events'), siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4938-'));
const secret = crypto.randomBytes(32).toString('hex');
const first = '111111111111111111', second = '222222222222222222', plain = '333333333333333333';
let child, port, pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function write(name, value) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); }
function read(name) { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
function signed(value) { return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32); }
function cookie(id) { const value = id + '|Forged cookie display|' + Date.now(); return 'twa=' + encodeURIComponent(value + '|' + signed(value)); }
function ticket(id) {
  const value = Buffer.from(JSON.stringify({ d: id, n: 'Old ticket name', x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + value + '.' + signed('ticket:' + value);
}
function preload() {
  const https = require('node:https'), fs = require('node:fs'), path = require('node:path');
  const { EventEmitter } = require('node:events');
  const rename = fs.renameSync.bind(fs), copy = fs.copyFileSync.bind(fs);
  const prototype = Object.getOwnPropertyDescriptor(Object.prototype, '__proto__');
  Object.defineProperty(Object.prototype, '__proto__', { ...prototype, set(value) {
    fs.appendFileSync(path.join(__dirname, 'prototype-writes.txt'), 'prototype setter used\n');
    prototype.set.call(this, value);
  } });
  function refuse(file) {
    const name = String(fs.readFileSync(path.join(__dirname, 'refuse.txt'), 'utf8'));
    if (name && path.basename(String(file)) === name) throw Object.assign(Error('fixture refused save'), { code: 'EACCES' });
  }
  fs.renameSync = (from, to) => { refuse(to); return rename(from, to); };
  fs.copyFileSync = (from, to) => { refuse(to); return copy(from, to); };
  function request(options, callback) {
    const host = String(options.hostname || options.host || ''), route = String(options.path || '');
    const members = [
      { user: { id: '111111111111111111', username: 'Current Aela' }, roles: ['staff'] },
      { user: { id: '222222222222222222', username: 'Current Brynjolf' }, roles: ['staff'] },
      { user: { id: '333333333333333333', username: 'Plain' }, roles: ['play'] }
    ];
    let body;
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture') body = { id: 'fixture', name: 'Fixture' };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/roles') body = [{ id: 'staff', name: 'Gamemaster' }, { id: 'play', name: 'Playtester' }];
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
function audit() {
  const file = path.join(dir, 'data/for-bot/moderation.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
}
function seed(name, reports = []) {
  write('data/gallery.json', []); write('data/gallery-pending.json', [{ name, by: 'Photographer', at: Date.now() }]);
  write('data/gallery-reports.json', reports); fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
}
// Accept takes only a picture whose file is on the site (#4401).
function shotFile(name) {
  fs.mkdirSync(path.join(dir, 'uploads'), { recursive: true }); fs.writeFileSync(path.join(dir, 'uploads', name), 'picture');
}
async function act(method, route, body, id = first, launcher = false) {
  const response = await fetch('http://127.0.0.1:' + port + route + (launcher ? '?ticket=' + encodeURIComponent(ticket(id)) : ''), {
    method, redirect: 'manual', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + port,
      ...(launcher ? {} : { cookie: cookie(id) }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  return { status: response.status, body: await response.json() };
}
function recorded(before, did, name, actor) {
  const added = audit().slice(before);
  return added.length === 1 && added[0].did === did && added[0].whoName === name && added[0].byName === actor
    && added[0].byId === (actor === 'Current Aela' ? first : second)
    && added[0].server === 'site' && Number.isFinite(Date.parse(added[0].at));
}
(async () => {
  try {
    siteFiles.copy(dir, process.argv[2]); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    write('config.json', { secret, password: crypto.randomBytes(16).toString('hex'), admins: [],
      discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: 'fixture', guildId: 'fixture' },
      access: { admin: ['Owner'], dev: ['Gamemaster'], play: ['Playtester'], banned: ['Banned'] }, gameCheckPort: 1 });
    fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
    fs.writeFileSync(path.join(dir, 'network.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'network.js'), path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1' }
    });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; }); port = (await siteFiles.listening(child)).port;
    const image = '20261125-' + 'a'.repeat(40) + '.png';
    seed(image); shotFile(image); let before = audit().length;
    let result = await act('POST', '/api/gallery/approve', { name: image, by: 'Forged actor', byName: 'Forged actor', byId: second });
    yes('approval really commits public entry and removes pending', result.status === 200 && read('data/gallery.json')[0].name === image && read('data/gallery-pending.json').length === 0);
    yes('approval audit uses current authenticated staff name and exact picture', recorded(before, 'galleryapprove', image, 'Current Aela'));
    yes('the audit binds the display name to the verified account ID', audit().at(-1).byId === first);
    before = audit().length; await act('POST', '/api/gallery/approve', { name: image, by: 'Forged actor' });
    yes('unchanged approval retry has no duplicate action', audit().length === before);
    result = await act('POST', '/api/gallery/approve', { name: image, by: 'Corrected credit' });
    yes('changing credit on an existing approved picture is recorded as an update',
      result.status === 200 && recorded(before, 'galleryapprove', image, 'Current Aela') && audit().at(-1).phase === 'updated');
    before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: image, byName: 'Forged actor' }, second, true);
    yes('launcher removal actually removes public entry', result.status === 200 && read('data/gallery.json').length === 0);
    yes('launcher removal names current verified ticket actor, not old ticket/body name', recorded(before, 'galleryremove', image, 'Current Brynjolf'));
    before = audit().length; await act('DELETE', '/api/gallery/approved', { name: image }, second, true);
    yes('already absent removal is not recorded again', audit().length === before);
    seed(image, [{ id: 'report-one', name: image, why: 'Private report text', at: Date.now() }]); before = audit().length;
    result = await act('POST', '/api/gallery/report/dismiss', { id: 'report-one', name: 'Forged picture', byName: 'Forged actor' });
    yes('dismissal removes actual report', result.status === 200 && read('data/gallery-reports.json').length === 0);
    yes('dismissal audit takes picture from stored report and omits private report text', recorded(before, 'gallerydismiss', image, 'Current Aela') && !JSON.stringify(audit().slice(before)).includes('Private report text'));
    before = audit().length; await act('POST', '/api/gallery/report/dismiss', { id: 'report-one' });
    yes('absent report dismissal is not recorded', audit().length === before);
    for (const [method, route, body] of [['POST', '/api/gallery/approve', { name: image }], ['DELETE', '/api/gallery/approved', { name: image }], ['POST', '/api/gallery/report/dismiss', { id: 'refused' }]]) {
      seed(image, [{ id: 'refused', name: image }]); before = audit().length;
      result = await act(method, route, body, plain, true);
      yes('unauthorized action cannot mutate or audit ' + route, result.status === 403 && audit().length === before && read('data/gallery-pending.json').length === 1 && read('data/gallery-reports.json').length === 1);
    }
    seed(image); shotFile(image); before = audit().length; fs.writeFileSync(path.join(dir, 'refuse.txt'), 'gallery.json');
    result = await act('POST', '/api/gallery/approve', { name: image });
    yes('refused first approval save has no success audit', result.status === 500 && audit().length === before && read('data/gallery.json').length === 0);
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'gallery-pending.json');
    result = await act('POST', '/api/gallery/approve', { name: image });
    yes('committed approval still audited if later queue cleanup fails', result.status === 500 && result.body.approved === true && recorded(before, 'galleryapprove', image, 'Current Aela'));
    before = audit().length; fs.writeFileSync(path.join(dir, 'refuse.txt'), ''); await act('POST', '/api/gallery/approve', { name: image });
    yes('finishing pending cleanup does not repeat committed approval audit', audit().length === before && read('data/gallery-pending.json').length === 0);
    fs.rmSync(path.join(dir, 'uploads', image));
    seed(image, [{ id: 'held', name: image, why: 'Evidence' }]); write('data/gallery.json', [{ name: image }]); before = audit().length;
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'gallery-pending.json');
    result = await act('DELETE', '/api/gallery/approved', { name: image });
    yes('committed removal is audited before later pending save refusal', result.status === 500 && read('data/gallery.json').length === 0 && recorded(before, 'galleryremove', image, 'Current Aela'));
    fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
    const beforeCleanup = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: image }, second, true);
    yes('a removal retry preserves which moderator changed the visible gallery and which finished a later step',
      result.status === 200 && audit().at(beforeCleanup - 1).phase === 'approved' &&
      audit().at(beforeCleanup).phase === 'pending' && audit().at(beforeCleanup).byId === second);
    seed(image, [{ id: 'save-refused', name: image }]); before = audit().length; fs.writeFileSync(path.join(dir, 'refuse.txt'), 'gallery-reports.json');
    result = await act('POST', '/api/gallery/report/dismiss', { id: 'save-refused' });
    yes('failed dismissal preserves report without success audit', result.status === 500 && audit().length === before && read('data/gallery-reports.json').length === 1);
    seed(image); write('data/gallery.json', [{ name: image }]); before = audit().length;
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'gallery.json');
    result = await act('DELETE', '/api/gallery/approved', { name: image });
    yes('refused first removal save has no success audit or list loss', result.status === 500 && audit().length === before && read('data/gallery.json').length === 1 && read('data/gallery-pending.json').length === 1);
    seed(image); before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: image });
    yes('pending-only rejection records its committed removal', result.status === 200 && recorded(before, 'galleryremove', image, 'Current Aela') && read('data/gallery-pending.json').length === 0);
    seed(image, [{ id: 'launcher-dismiss', name: image }]); before = audit().length;
    result = await act('POST', '/api/gallery/report/dismiss', { id: 'launcher-dismiss' }, second, true);
    yes('launcher dismissal retains canonical current actor and stored picture', result.status === 200 && recorded(before, 'gallerydismiss', image, 'Current Brynjolf'));
    seed(image, [{ id: 'hold-evidence', name: image, why: 'Private held evidence' }]);
    write('data/gallery.json', [{ name: image }]); fs.writeFileSync(path.join(dir, 'uploads', image), 'owned image fixture'); before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: image });
    const held = read('uploads/uploads.json')[image];
    yes('reported-file retention remains canonical and records one action across all writes', result.status === 200 && result.body.heldForReport === true
      && fs.existsSync(path.join(dir, 'uploads', image)) && held.heldUntil > Date.now() && held.heldReports[0].why === 'Private held evidence'
      && read('data/gallery.json').length === 0 && read('data/gallery-pending.json').length === 0 && read('data/gallery-reports.json').length === 0
      && recorded(before, 'galleryremove', image, 'Current Aela') && !JSON.stringify(audit().slice(before)).includes('Private held evidence'));
    before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: image }, second, true);
    yes('repeating removal during a report hold preserves the file and writes no second action',
      result.status === 200 && fs.existsSync(path.join(dir, 'uploads', image)) &&
      read('uploads/uploads.json')[image]?.heldUntil === held.heldUntil && audit().length === before);
    const retryImage = '20261125-' + 'b'.repeat(40) + '.png';
    seed(retryImage, [{ id: 'save-held-note', name: retryImage, why: 'Report stays intact' }]);
    write('data/gallery.json', [{ name: retryImage }]);
    fs.writeFileSync(path.join(dir, 'uploads', retryImage), 'owned retry image');
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'uploads.json');
    before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: retryImage });
    yes('refused evidence metadata write preserves the file and source report',
      result.status === 500 && result.body.fileKept === true &&
      fs.existsSync(path.join(dir, 'uploads', retryImage)) && read('data/gallery-reports.json').length === 1 &&
      recorded(before, 'galleryremove', retryImage, 'Current Aela') && audit().at(-1).phase === 'approved');
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'gallery-reports.json');
    before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: retryImage }, second, true);
    const retryHeld = read('uploads/uploads.json')[retryImage];
    yes('failed clearing of an open report keeps both durable retained evidence and the original report',
      result.status === 500 && fs.existsSync(path.join(dir, 'uploads', retryImage)) &&
      retryHeld.heldReports[0].why === 'Report stays intact' && read('data/gallery-reports.json').length === 1);
    yes('the retry audit identifies the moderator who placed the hold',
      recorded(before, 'galleryremove', retryImage, 'Current Brynjolf') && audit().at(-1).phase === 'hidden');
    fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
    before = audit().length;
    result = await act('DELETE', '/api/gallery/approved', { name: retryImage }, second, true);
    yes('the next retry clears the open queue after the hold without resetting its deadline',
      result.status === 200 && result.body.heldUntil === retryHeld.heldUntil &&
      read('data/gallery-reports.json').length === 0 && fs.existsSync(path.join(dir, 'uploads', retryImage)) &&
      recorded(before, 'galleryremove', retryImage, 'Current Brynjolf') && audit().at(-1).phase === 'reports');
    before = audit().length;
    fs.writeFileSync(path.join(dir, 'uploads/uploads.json'), '{');
    result = await act('DELETE', '/api/gallery/approved', { name: retryImage });
    yes('unreadable evidence state cannot authorize deleting the stored upload',
      result.status === 500 && fs.existsSync(path.join(dir, 'uploads', retryImage)) && audit().length === before);
    write('uploads/uploads.json', { unrelated: { marker: 'keep unrelated metadata' } });
    fs.writeFileSync(path.join(dir, 'prototype-writes.txt'), '');
    for (const special of ['__proto__', 'constructor', 'prototype']) {
      fs.writeFileSync(path.join(dir, 'prototype-writes.txt'), '');
      seed(special, [{ id: 'special-' + special, name: special, why: 'Reserved-key evidence' }]);
      fs.writeFileSync(path.join(dir, 'uploads', special), 'owned special-key file');
      result = await act('DELETE', '/api/gallery/approved', { name: special });
      const metadata = read('uploads/uploads.json');
      yes(special + ' is an own retained metadata key without an inherited lookup', result.status === 200 && result.body.heldForReport === true
        && Object.prototype.hasOwnProperty.call(metadata, special) && metadata[special].heldUntil > Date.now()
        && metadata[special].heldReports[0].why === 'Reserved-key evidence'
        && metadata.unrelated.marker === 'keep unrelated metadata' && Object.getPrototypeOf(metadata) === Object.prototype
        && fs.existsSync(path.join(dir, 'uploads', special)));
      yes(special + ' does not invoke the prototype setter', fs.readFileSync(path.join(dir, 'prototype-writes.txt'), 'utf8') === '');
    }
    const outside = path.join(dir, 'outside-gallery.txt'); fs.writeFileSync(outside, 'owned outside sentinel');
    fs.writeFileSync(path.join(dir, 'prototype-writes.txt'), '');
    const metadataBeforePath = fs.readFileSync(path.join(dir, 'uploads/uploads.json'), 'utf8');
    seed('../outside-gallery.txt');
    result = await act('DELETE', '/api/gallery/approved', { name: '../outside-gallery.txt' });
    yes('a traversal name cannot affect a file or metadata outside the canonical upload boundary', result.body.fileDeleted === false
      && fs.readFileSync(outside, 'utf8') === 'owned outside sentinel'
      && fs.readFileSync(path.join(dir, 'uploads/uploads.json'), 'utf8') === metadataBeforePath
      && fs.readFileSync(path.join(dir, 'prototype-writes.txt'), 'utf8') === '');
    yes('owned site remains running and blocks every unrecognized provider route', child.exitCode === null && !stderr.includes('fixture blocks external request'));
  } catch (e) { fail++; console.error(e.stack || e); }
  finally {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    if (!path.resolve(dir).startsWith(parent + path.sep)) throw Error('refusing cleanup outside owned temp folder');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
