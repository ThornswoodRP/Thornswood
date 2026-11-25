'use strict';
// Real local admin HTTP, canonical staff authentication and persisted audit.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { once } = require('node:events'), siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4939-'));
const secret = crypto.randomBytes(32).toString('hex');
const first = '111111111111111111', second = '222222222222222222', plain = '333333333333333333';
let child, port, pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function write(name, value) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); }
function read(name) { return JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')); }
function signed(value) { return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32); }
function cookie(id) { const value = id + '|Forged cookie display|' + Date.now(); return 'twa=' + encodeURIComponent(value + '|' + signed(value)); }
function preload() {
  const https = require('node:https'), fs = require('node:fs'), path = require('node:path');
  const { EventEmitter } = require('node:events');
  const rename = fs.renameSync.bind(fs), copy = fs.copyFileSync.bind(fs), save = fs.writeFileSync.bind(fs);
  function refuse(file) {
    const name = String(fs.readFileSync(path.join(__dirname, 'refuse.txt'), 'utf8'));
    if (name && path.basename(String(file)) === name) throw Object.assign(Error('fixture refused save'), { code: 'EACCES' });
  }
  fs.writeFileSync = (file, ...args) => { refuse(file); return save(file, ...args); };
  fs.renameSync = (from, to) => { refuse(to); return rename(from, to); };
  fs.copyFileSync = (from, to) => { refuse(to); return copy(from, to); };
  function request(options, callback) {
    const host = String(options.hostname || options.host || ''), route = String(options.path || '');
    const members = [
      { user: { id: '111111111111111111', username: 'Current Aela' }, roles: ['owner'] },
      { user: { id: '222222222222222222', username: 'Current Brynjolf' }, roles: ['owner'] },
      { user: { id: '333333333333333333', username: 'Plain' }, roles: ['staff'] }
    ];
    let body;
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture') body = { id: 'fixture', name: 'Fixture' };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/roles') body = [{ id: 'owner', name: 'Owner' }, { id: 'staff', name: 'Gamemaster' }];
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
function version(text) { return crypto.createHash('sha256').update(text, 'utf8').digest('hex'); }
async function act(method, route, body, id = first, headers = {}) {
  const response = await fetch('http://127.0.0.1:' + port + route, {
    method, redirect: 'manual', headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json',
      origin: 'http://127.0.0.1:' + port, cookie: cookie(id), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  return { status: response.status, body: await response.json() };
}
function recorded(before, did, subject, actor) {
  const rows = audit().slice(before);
  return rows.length === 1 && rows[0].did === did && rows[0].whoName === subject && rows[0].byName === actor
    && rows[0].server === 'site' && Number.isFinite(Date.parse(rows[0].at));
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
    const old = 'Original private page body', next = 'Changed private page body';
    fs.writeFileSync(path.join(dir, 'data/help.md'), old); let before = audit().length;
    let result = await act('PUT', '/api/doc/help', next, first, { 'x-thornswood-doc-was': version(old), 'x-by-name': 'Forged' });
    yes('page save actually commits with its existing version fence', result.status === 200 && fs.readFileSync(path.join(dir, 'data/help.md'), 'utf8') === next);
    yes('page save records current actor and page key without page contents', recorded(before, 'docsave', 'help', 'Current Aela') && !JSON.stringify(audit()).includes('private page body'));
    before = audit().length; result = await act('PUT', '/api/doc/help', 'Stale overwrite', second, { 'x-thornswood-doc-was': version(old) });
    yes('stale page overwrite has no success audit', result.status === 409 && audit().length === before && fs.readFileSync(path.join(dir, 'data/help.md'), 'utf8') === next);
    await act('PUT', '/api/doc/help', next, first, { 'x-thornswood-doc-was': version(next) });
    yes('unchanged page save adds no action', audit().length === before);
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'help.md');
    result = await act('PUT', '/api/doc/help', 'Refused', first, { 'x-thornswood-doc-was': version(next) });
    yes('failed page write preserves body and no success audit', result.status === 500 && audit().length === before && fs.readFileSync(path.join(dir, 'data/help.md'), 'utf8') === next);
    fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
    const inbox = 'data/for-bot/inbox.json', id = 'opaque-report-fixture';
    write(inbox, [{ id, at: Date.now(), state: 'new', text: 'Private report body' }, { id: 'unrelated', at: Date.now(), state: 'new' }]);
    for (const [actName, state] of [['dismiss', 'not doing this'], ['reopen', 'new'], ['delete', null]]) {
      before = audit().length; result = await act('PUT', '/api/inbox', { id, act: actName, by: 'Forged actor', title: 'Forged subject' }, second);
      const saved = read(inbox), row = saved.find(item => item.id === id);
      yes('inbox ' + actName + ' commits only requested row', result.status === 200 && (state === null ? !row : row && row.state === state) && saved.some(item => item.id === 'unrelated'));
      yes('inbox ' + actName + ' records actor and opaque subject only', recorded(before, 'inbox' + actName, id, 'Current Brynjolf') && !JSON.stringify(audit()).includes('Private report body'));
      before = audit().length; result = await act('PUT', '/api/inbox', { id, act: actName }, second);
      yes('inbox ' + actName + ' repeat adds no success audit', audit().length === before && result.status === (actName === 'delete' ? 404 : 200));
    }
    write(inbox, [{ id, at: Date.now(), state: 'new' }]); before = audit().length;
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'inbox.json'); result = await act('PUT', '/api/inbox', { id, act: 'dismiss' });
    yes('refused inbox save keeps old state without audit', result.status === 500 && audit().length === before && read(inbox)[0].state === 'new');
    fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
    const name = '20261125-' + 'a'.repeat(40) + '.log', file = path.join(dir, 'uploads', name);
    fs.writeFileSync(file, 'Private upload contents'); write('uploads/uploads.json', { [name]: { at: Date.now(), orig: 'private.log' } }); before = audit().length;
    result = await act('DELETE', '/api/upload/' + name, undefined);
    yes('upload delete actually removes file and note', result.status === 200 && !fs.existsSync(file) && !read('uploads/uploads.json')[name]);
    yes('upload delete records actor and exact filename without contents', recorded(before, 'uploaddelete', name, 'Current Aela') && !JSON.stringify(audit()).includes('Private upload contents'));
    before = audit().length; await act('DELETE', '/api/upload/' + name, undefined);
    yes('missing file and note retry adds no action', audit().length === before);
    fs.writeFileSync(file, 'owned'); write('uploads/uploads.json', { [name]: { at: Date.now() } }); before = audit().length;
    fs.writeFileSync(path.join(dir, 'refuse.txt'), 'uploads.json'); result = await act('DELETE', '/api/upload/' + name, undefined);
    yes('file removal is audited even if later metadata save fails', result.status === 500 && result.body.fileDeleted === true && !fs.existsSync(file) && recorded(before, 'uploaddelete', name, 'Current Aela'));
    fs.writeFileSync(path.join(dir, 'refuse.txt'), '');
    before = audit().length; result = await act('DELETE', '/api/upload/' + name, undefined, second);
    yes('later metadata cleanup records its actual second actor without restoring file', result.status === 200 && !read('uploads/uploads.json')[name]
      && !fs.existsSync(file) && recorded(before, 'uploaddelete', name, 'Current Brynjolf'));
    before = audit().length; await act('DELETE', '/api/upload/' + name, undefined, second);
    yes('completed cleanup retry remains quiet', audit().length === before);
    const stuck = path.join(dir, 'uploads/stuck.log'); fs.mkdirSync(stuck); fs.writeFileSync(path.join(stuck, 'keep'), 'owned'); before = audit().length;
    result = await act('DELETE', '/api/upload/stuck.log', undefined);
    yes('failed actual file deletion has no success audit', result.status === 500 && fs.existsSync(stuck) && audit().length === before);
    for (const [method, route, body] of [['PUT', '/api/doc/help', 'Denied'], ['PUT', '/api/inbox', { id, act: 'delete' }], ['DELETE', '/api/upload/stuck.log', undefined]]) {
      before = audit().length; result = await act(method, route, body, plain);
      yes('nonadmin cannot mutate or audit ' + route, result.status === 403 && audit().length === before);
    }
    yes('owned site stays running with only known local provider calls', child.exitCode === null && !stderr.includes('fixture blocks external request'));
  } catch (e) { fail++; console.error(e.stack || e); }
  finally {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    if (!path.resolve(dir).startsWith(parent + path.sep)) throw Error('refusing cleanup outside owned temp folder');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
