'use strict';
// Real hub payload, signed sessions, canonical Discord roles and real report
// persistence. All Discord/Cloudflare requests are local stand-ins. No report
// delivery, account mutation, real credentials or external network.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), vm = require('node:vm'), http = require('node:http');
const { spawn } = require('node:child_process');
const siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4347-'));
const ids = { member: '222222222222222222', dev: '333333333333333333', plain: '444444444444444444', inactive: '555555555555555555', banned: '666666666666666666' };
const secret = crypto.randomBytes(32).toString('hex');
let child, port, pass = 0, fail = 0, asked = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function cookie(id) { const value = id + '|Fixture|' + Date.now(); return 'twa=' + encodeURIComponent(value + '|' + crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32)); }
function preload() {
  const https = require('node:https'), http = require('node:http'), { EventEmitter } = require('node:events');
  const ids = JSON.parse(process.env.TS_4347_IDS);
  const roles = [{ id: 'owner', name: 'Owner' }, { id: 'dev', name: 'Gamemaster' }, { id: 'play', name: 'Playtester' }, { id: 'banned', name: 'Banned' }];
  const members = Object.entries({ member: ['owner'], dev: ['dev'], plain: ['play'], inactive: [], banned: ['dev', 'banned'] })
    .map(([name, roles]) => ({ nick: name, roles, user: { id: ids[name], username: name } }));
  function request(options, callback) {
    const parsed = typeof options === 'string' || options instanceof URL ? new URL(String(options)) : options;
    const host = String(parsed.hostname || parsed.host || ''), route = String(parsed.path || parsed.pathname || '') + (parsed.search || '');
    if (host === 'challenges.cloudflare.com') return http.request({ host: '127.0.0.1', port: Number(process.env.TS_4347_VERIFY), path: route, method: parsed.method, headers: parsed.headers }, callback);
    const answer = host === 'discord.com' && route === '/api/v10/guilds/fixture/members?limit=1000' ? members :
      host === 'discord.com' && route === '/api/v10/guilds/fixture/roles' ? roles : null;
    const req = new EventEmitter(); req.setTimeout = () => req; req.write = () => true; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      if (!answer) return req.emit('error', Error('fixture blocks external network: ' + host + route));
      const res = new EventEmitter(); res.statusCode = 200; res.headers = {}; res.setEncoding = () => {}; res.resume = () => {};
      callback(res); res.emit('data', Buffer.from(JSON.stringify(answer))); res.emit('end');
    });
    return req;
  }
  https.request = request;
  https.get = (options, callback) => { const req = request(options, callback); req.end(); return req; };
}
const verify = http.createServer((req, res) => {
  let text = ''; req.on('data', data => { text += data; }); req.on('end', () => {
    asked++; const token = new URLSearchParams(text).get('response');
    if (token === 'unavailable') return req.socket.destroy();
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ success: token === 'good' || token === 'wrong-action', action: token === 'wrong-action' ? 'login' : 'report' }));
  });
});
const inboxFile = path.join(dir, 'data/for-bot/inbox.json');
const inbox = () => fs.existsSync(inboxFile) ? JSON.parse(fs.readFileSync(inboxFile, 'utf8')) : [];
async function request(route, body, auth, origin) {
  const response = await fetch('http://127.0.0.1:' + port + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: origin || 'http://127.0.0.1:' + port, ...(auth ? { cookie: auth } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: response.status, body: await response.json() };
}
async function actualHubPayload() {
  const source = fs.readFileSync(path.join(__dirname, '../public/hub.js'), 'utf8');
  const from = source.indexOf('function drawReport()'), to = source.indexOf('\n}', from) + 2;
  const nodes = Object.fromEntries(['page', 'rt', 'rd', 'rw', 'rsend', 'rsaid'].map(id => [id, { value: '', innerHTML: '', textContent: '', disabled: false }]));
  let sent;
  const context = { el: id => nodes[id] || {}, head: () => '', esc: value => value, remember: () => '', each() {}, reportKind: 'bug', whyWords: () => 'fixture',
    api: (route, options) => { sent = { route, payload: JSON.parse(options.body) }; return Promise.resolve({ ok: true }); } };
  vm.runInNewContext(source.slice(from, to), context); context.drawReport();
  nodes.rt.value = 'The gate does not open'; nodes.rd.value = 'The lever makes a sound'; nodes.rw.value = 'Fixture'; nodes.rsend.onclick();
  await Promise.resolve(); return sent;
}
(async () => {
  try {
    await new Promise(resolve => verify.listen(0, '127.0.0.1', resolve));
    siteFiles.copy(dir); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ password: crypto.randomBytes(16).toString('hex'), secret,
      admins: [], discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: 'fixture', guildId: 'fixture', invite: '' },
      access: { admin: ['Owner'], dev: ['Owner', 'Gamemaster'], play: ['Owner', 'Gamemaster', 'Playtester'], banned: ['Banned'] },
      turnstileSiteKey: 'fixture-site-key', turnstileSecret: 'fixture-secret', gameCheckPort: 1, onlineFile: path.join(dir, 'online.json') }));
    fs.writeFileSync(path.join(dir, 'fixture-network.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'fixture-network.js'), path.join(dir, 'server.js')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1', TS_4347_IDS: JSON.stringify(ids), TS_4347_VERIFY: String(verify.address().port), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1'
    } });
    port = (await siteFiles.listening(child)).port;
    const hub = await actualHubPayload();
    yes('the actual hub payload has no CAPTCHA token', hub.route === '/api/report' && !Object.hasOwn(hub.payload, 'turnstile'));
    const cookies = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, cookie(id)]));
    const member = await request('/api/hello', undefined, cookies.member), dev = await request('/api/hello', undefined, cookies.dev);
    yes('member positive is a real authorized signed-in hub member', member.status === 200 && member.body.admin === true);
    yes('dev positive really has staff access without member access', dev.status === 401 && dev.body.dev === true && dev.body.admin === false);
    for (const name of ['member', 'dev']) {
      const before = asked, title = 'Hub ' + name;
      const result = await request(hub.route, { ...hub.payload, title }, cookies[name]);
      yes(name + ' actual hub report reaches the inbox with Turnstile configured', result.status === 200 && inbox().some(row => row.title === title));
      yes(name + ' authenticated report makes no Cloudflare request', asked === before);
    }
    for (const name of ['plain', 'inactive', 'banned']) {
      const identity = await request('/api/hello', undefined, cookies[name]), before = JSON.stringify(inbox());
      yes(name + ' negative lacks canonical hub access', identity.status === 401 && identity.body.dev === false && identity.body.admin === false);
      const result = await request('/api/report', { ...hub.payload, member: true, dev: true, id: ids.member }, cookies[name]);
      yes(name + ' cannot claim hub permission in its report body', result.status === 403 && JSON.stringify(inbox()) === before);
    }
    const beforeSignedOut = JSON.stringify(inbox());
    let result = await request('/api/report', { ...hub.payload, member: true, dev: true });
    yes('signed-out report still needs Turnstile despite claimed permissions', result.status === 403 && JSON.stringify(inbox()) === beforeSignedOut);
    result = await request('/api/logout', {}, cookies.member);
    const afterLogout = await request('/api/report', hub.payload, cookies.member);
    yes('an ended real sign-in cannot reuse its old cookie for the bypass', result.status === 200 && afterLogout.status === 403 && JSON.stringify(inbox()) === beforeSignedOut);
    for (const [token, status] of [['bad', 403], ['wrong-action', 403], ['unavailable', 503]]) {
      const before = JSON.stringify(inbox()); result = await request('/api/report', { ...hub.payload, turnstile: token });
      yes('public Turnstile retains ' + token + ' refusal', result.status === status && JSON.stringify(inbox()) === before);
    }
    result = await request('/api/report', { ...hub.payload, title: 'Public with pass', turnstile: 'good' });
    yes('public report with a verified pass still reaches the inbox', result.status === 200 && inbox().some(row => row.title === 'Public with pass') && asked === 4);
    if (result.status !== 200 || asked !== 4) console.log('Public fixture diagnostic:', JSON.stringify({ result, asked, inbox: inbox() }));
    const preserved = JSON.stringify(inbox());
    result = await request('/api/report', hub.payload, cookies.dev, 'https://other.invalid');
    yes('authenticated hub bypass keeps cross-site protection', result.status === 403 && JSON.stringify(inbox()) === preserved);
    result = await request('/api/report', { ...hub.payload, homepage: 'filled by script' }, cookies.dev);
    yes('authenticated hub bypass keeps the honeypot without storing a report', result.status === 200 && JSON.stringify(inbox()) === preserved);
    const blocker = path.join(dir, 'data/for-bot/.inbox.json.' + child.pid + '.tmp'); fs.mkdirSync(blocker);
    result = await request('/api/report', hub.payload, cookies.dev); fs.rmdirSync(blocker);
    yes('authenticated report never says sent after refused persistence', result.status === 500 && JSON.stringify(inbox()) === preserved);
    let refused = false;
    for (let i = 0; i < 6; i++) { result = await request('/api/report', { ...hub.payload, title: 'Limited ' + i }, cookies.dev); if (result.status === 429) refused = true; }
    yes('authenticated hub bypass keeps the sender rate limit', refused && result.status === 429 && inbox().length === 5);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('close', resolve); child.kill(); });
    verify.closeAllConnections(); await new Promise(resolve => verify.close(resolve));
    const resolved = fs.realpathSync(dir);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('tw4347-')) throw Error('fixture cleanup escaped its private parent');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
