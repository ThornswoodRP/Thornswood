'use strict';
// Actual public home.js form, signed sessions, canonical Discord roles and real report
// persistence. All Discord/Cloudflare requests are local stand-ins. No report
// delivery, account mutation, real credentials or external network.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), http = require('node:http');
const { spawn } = require('node:child_process');
const siteFiles = require('../../tests/site-files');
const makePage = require('../../tests/fixtures/panel-page');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4347-'));
const ids = { member: '222222222222222222', dev: '333333333333333333', plain: '444444444444444444', inactive: '555555555555555555', banned: '666666666666666666', stale: '777777777777777777' };
const secret = crypto.randomBytes(32).toString('hex');
let child, port, pass = 0, fail = 0, asked = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function cookie(id) { const value = id + '|Fixture|' + Date.now(); return 'twa=' + encodeURIComponent(value + '|' + crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32)); }
function preload() {
  const https = require('node:https'), http = require('node:http'), { EventEmitter } = require('node:events');
  const ids = JSON.parse(process.env.TS_4347_IDS);
  const fs = require('node:fs'), path = require('node:path'), realNow = Date.now;
  Date.now = () => realNow() + (fs.existsSync(path.join(__dirname, 'clock.txt')) ? Number(fs.readFileSync(path.join(__dirname, 'clock.txt'), 'utf8')) : 0);
  const roles = [{ id: 'owner', name: 'Owner' }, { id: 'dev', name: 'Gamemaster' }, { id: 'play', name: 'Playtester' }, { id: 'banned', name: 'Banned' }];
  const members = Object.entries({ member: ['owner'], dev: ['dev'], plain: ['play'], inactive: [], banned: ['dev', 'banned'], stale: ['dev'] })
    .map(([name, roles]) => ({ nick: name, roles, user: { id: ids[name], username: name } }));
  function request(options, callback) {
    const parsed = typeof options === 'string' || options instanceof URL ? new URL(String(options)) : options;
    const host = String(parsed.hostname || parsed.host || ''), route = String(parsed.path || parsed.pathname || '') + (parsed.search || '');
    if (host === 'challenges.cloudflare.com') return http.request({ host: '127.0.0.1', port: Number(process.env.TS_4347_VERIFY), path: route, method: parsed.method, headers: parsed.headers }, callback);
    const answer = host === 'discord.com' && route === '/api/v10/guilds/fixture/members?limit=1000' ? members :
      host === 'discord.com' && route === '/api/v10/guilds/fixture/roles' ? roles : null;
    const req = new EventEmitter(); req.setTimeout = () => req; req.write = () => true; req.destroy = () => {};
    req.end = () => setImmediate(() => {
      if (fs.existsSync(path.join(__dirname, 'discord-down'))) return req.emit('error', Error('fixture Discord unavailable'));
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
async function request(route, body, auth, origin, sender) {
  const response = await fetch('http://127.0.0.1:' + port + route, { method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', origin: origin || 'http://127.0.0.1:' + port, ...(auth ? { cookie: auth } : {}), ...(sender ? { 'x-forwarded-for': sender } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  return { status: response.status, headers: Object.fromEntries(response.headers), body: await response.json() };
}
async function actualPublicForm(auth) {
  const p = makePage(), calls = [], pending = new Set();
  p.doc.body.innerHTML = '<button id="burger"></button><nav id="nav"></nav><div id="landing"></div><main id="page"><div id="pagebody"></div></main>';
  p.doc.title = 'Thornswood';
  p.win.location = { pathname: '/report', search: '', hash: '', protocol: 'http:' };
  p.win.matchMedia = () => ({ matches: false });
  p.win.AbortController = AbortController;
  p.win.setTimeout = (fn, ms) => setTimeout(fn, ms).unref(); p.win.clearTimeout = clearTimeout;
  p.win.fetch = (route, options = {}) => {
    if (route === '/api/public?galleryLimit=24') return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    if (!['/api/report/form', '/api/gallery/who', '/api/report'].includes(route)) throw Error('Unexpected page request: ' + route);
    const call = { route, body: options.body && JSON.parse(options.body) }; calls.push(call);
    const promise = fetch('http://127.0.0.1:' + port + route, { ...options,
      headers: { ...(options.headers || {}), origin: 'http://127.0.0.1:' + port, ...(auth ? { cookie: auth } : {}) }
    }).then(async response => {
      const body = await response.json(); call.response = { status: response.status, headers: Object.fromEntries(response.headers), body };
      return { ok: response.ok, status: response.status, json: async () => body };
    });
    pending.add(promise); promise.finally(() => pending.delete(promise)); return promise;
  };
  p.flush = async () => { for (let i = 0; i < 4; i++) { await Promise.all([...pending]); await new Promise(resolve => setImmediate(resolve)); } };
  p.run('actual public home.js', fs.readFileSync(path.join(__dirname, '../public/home.js'), 'utf8'));
  await p.flush();
  p.submit = async title => {
    p.doc.getElementById('rTitle').value = title; p.doc.getElementById('rDetail').value = 'The lever makes a sound';
    p.doc.getElementById('rBy').value = 'Fixture';
    p.fire(p.doc.getElementById('rep'), 'submit', ''); await p.flush();
  };
  p.calls = calls; return p;
}
(async () => {
  try {
    await new Promise(resolve => verify.listen(0, '127.0.0.1', resolve));
    siteFiles.copy(dir); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
    fs.copyFileSync(path.join(__dirname, '../public/home.html'), path.join(dir, 'public/home.html'));
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ password: crypto.randomBytes(16).toString('hex'), secret,
      admins: [], discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: 'fixture', guildId: 'fixture', invite: '' },
      access: { admin: ['Owner'], dev: ['Owner', 'Gamemaster'], play: ['Owner', 'Gamemaster', 'Playtester'], banned: ['Banned'] },
      turnstileSiteKey: 'fixture-site-key', turnstileSecret: 'fixture-secret', gameCheckPort: 1, onlineFile: path.join(dir, 'online.json') }));
    fs.writeFileSync(path.join(dir, 'fixture-network.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'fixture-network.js'), path.join(dir, 'server.js')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1', TS_4347_IDS: JSON.stringify(ids), TS_4347_VERIFY: String(verify.address().port), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1'
    } });
    port = (await siteFiles.listening(child)).port;
    const routeAnswer = await fetch('http://127.0.0.1:' + port + '/report');
    const routeHtml = await routeAnswer.text();
    yes('the real public report route loads home.js and not retired hub.js', routeAnswer.status === 200 && /home\.js/.test(routeHtml) && !/hub\.js/.test(routeHtml));
    const pages = {};
    const cookies = Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, cookie(id)]));
    const member = await request('/api/hello', undefined, cookies.member), dev = await request('/api/hello', undefined, cookies.dev);
    yes('member positive is a real authorized signed-in hub member', member.status === 200 && member.body.admin === true);
    yes('dev positive really has staff access without member access', dev.status === 401 && dev.body.dev === true && dev.body.admin === false);
    let payload;
    for (const name of ['member', 'dev']) {
      const before = asked, title = 'Public form ' + name, page = await actualPublicForm(cookies[name]);
      pages[name] = page;
      const formAnswer = page.calls.find(call => call.route === '/api/report/form').response;
      yes(name + ' form omits the widget key using real current authority', formAnswer.status === 200 && formAnswer.body.turnstile === '');
      yes(name + ' form answer stays uncached and reveals no identity', formAnswer.headers['cache-control'] === 'no-store' && Object.keys(formAnswer.body).join(',') === 'turnstile' && !!formAnswer.headers['content-security-policy'] && formAnswer.headers['referrer-policy'] === 'strict-origin-when-cross-origin');
      yes(name + ' actual public page does not request a CAPTCHA script', !page.doc.head.querySelector('script'));
      await page.submit(title);
      const post = page.calls.find(call => call.route === '/api/report'); if (post) payload = post.body;
      yes(name + ' actual public form POST stays uncached', !!post && post.response.headers['cache-control'] === 'no-store');
      yes(name + ' actual public form POST reaches the real inbox and says Sent', !!post && post.response.status === 200 && inbox().some(row => row.title === title) && /^Sent\./.test(page.doc.getElementById('rSaid').textContent));
      yes(name + ' actual public form uses no CAPTCHA token or Cloudflare verification', !!post && post.body.turnstile === '' && asked === before);
    }
    payload = payload || { title: 'The gate does not open', detail: 'The lever makes a sound', by: 'Fixture', homepage: '', about: '', turnstile: '', kind: 'bug' };
    for (const name of ['plain', 'inactive', 'banned']) {
      const identity = await request('/api/hello', undefined, cookies[name]), before = JSON.stringify(inbox());
      const page = await actualPublicForm(cookies[name]);
      yes(name + ' actual public page retains the CAPTCHA widget', page.calls.find(call => call.route === '/api/report/form').response.body.turnstile === 'fixture-site-key' && !!page.doc.head.querySelector('script'));
      await page.submit('Must wait');
      yes(name + ' actual public page waits for a token before POST', !page.calls.some(call => call.route === '/api/report') && /Wait for the tick/.test(page.doc.getElementById('rSaid').textContent));
      yes(name + ' negative lacks canonical hub access', identity.status === 401 && identity.body.dev === false && identity.body.admin === false);
      const result = await request('/api/report', { ...payload, member: true, dev: true, id: ids.member }, cookies[name]);
      yes(name + ' cannot claim hub permission in its report body', result.status === 403 && JSON.stringify(inbox()) === before);
    }
    const anonymous = await actualPublicForm(); await anonymous.submit('Anonymous must wait');
    yes('anonymous public page retains the widget and blocks tokenless submit', !!anonymous.doc.head.querySelector('script') && !anonymous.calls.some(call => call.route === '/api/report'));
    const beforeSignedOut = JSON.stringify(inbox());
    let result = await request('/api/report', { ...payload, member: true, dev: true });
    yes('signed-out report still needs Turnstile despite claimed permissions', result.status === 403 && JSON.stringify(inbox()) === beforeSignedOut);
    result = await request('/api/logout', {}, cookies.member);
    const afterLogout = await request('/api/report', payload, cookies.member);
    yes('an ended real sign-in cannot reuse its old cookie for the bypass', result.status === 200 && afterLogout.status === 403 && JSON.stringify(inbox()) === beforeSignedOut);
    await pages.member.submit('Old page after sign-out');
    const oldPost = pages.member.calls.filter(call => call.route === '/api/report').at(-1);
    yes('a widgetless page opened before logout cannot reuse its former authority', oldPost.response.status === 403 && JSON.stringify(inbox()) === beforeSignedOut);
    const ended = await actualPublicForm(cookies.member); await ended.submit('Ended must wait');
    yes('ended real session gets the widget and cannot submit tokenless', !!ended.doc.head.querySelector('script') && !ended.calls.some(call => call.route === '/api/report'));
    for (const [token, status] of [['bad', 403], ['wrong-action', 403], ['unavailable', 503]]) {
      const before = JSON.stringify(inbox()); result = await request('/api/report', { ...payload, turnstile: token });
      yes('public Turnstile retains ' + token + ' refusal', result.status === status && JSON.stringify(inbox()) === before);
    }
    let widget; anonymous.win.turnstile = { render: (box, options) => { widget = options; return 0; }, reset() {} };
    anonymous.doc.head.querySelector('script').onload(); widget.callback('good');
    await anonymous.submit('Public with pass');
    const verifiedPost = anonymous.calls.find(call => call.route === '/api/report');
    yes('actual anonymous form widget uses the report action and site key', widget.action === 'report' && widget.sitekey === 'fixture-site-key');
    yes('actual public form with a verified pass reaches inbox and says Sent', verifiedPost.response.status === 200 && inbox().some(row => row.title === 'Public with pass') && asked === 4 && /^Sent\./.test(anonymous.doc.getElementById('rSaid').textContent));
    const preserved = JSON.stringify(inbox());
    result = await request('/api/report', payload, cookies.dev, 'https://other.invalid');
    yes('authenticated bypass keeps cross-site protection', result.status === 403 && JSON.stringify(inbox()) === preserved);
    result = await request('/api/report', { ...payload, homepage: 'filled by script' }, cookies.dev);
    yes('authenticated bypass keeps the honeypot without storing a report', result.status === 200 && JSON.stringify(inbox()) === preserved);
    const blocker = path.join(dir, 'data/for-bot/.inbox.json.' + child.pid + '.tmp'); fs.mkdirSync(blocker);
    result = await request('/api/report', payload, cookies.dev); fs.rmdirSync(blocker);
    yes('authenticated report never says sent after refused persistence', result.status === 500 && JSON.stringify(inbox()) === preserved);
    let refused = false;
    for (let i = 0; i < 6; i++) { result = await request('/api/report', { ...payload, title: 'Limited ' + i }, cookies.dev); if (result.status === 429) refused = true; }
    yes('authenticated bypass keeps the sender rate limit', refused && result.status === 429 && inbox().length === 5);
    const seeded = await request('/api/hello', undefined, cookies.stale);
    yes('stale-authority fixture starts with a real current staff answer', seeded.body.dev === true);
    fs.writeFileSync(path.join(dir, 'clock.txt'), '61000'); fs.writeFileSync(path.join(dir, 'discord-down'), '');
    const stalePage = await request('/api/hello', undefined, cookies.stale);
    yes('ordinary read-only page still uses established stale-role fallback', stalePage.body.dev === true);
    const strictForm = await request('/api/report/form', undefined, cookies.stale);
    yes('form configuration refuses stale read-only authority and keeps CAPTCHA', strictForm.status === 200 && strictForm.body.turnstile === 'fixture-site-key');
    const unchanged = JSON.stringify(inbox());
    const strictPost = await request('/api/report', payload, cookies.stale, undefined, '192.0.2.47');
    yes('matching strict POST also refuses stale authority without a CAPTCHA pass', strictPost.status === 403 && JSON.stringify(inbox()) === unchanged);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('close', resolve); child.kill(); });
    verify.closeAllConnections(); await new Promise(resolve => verify.close(resolve));
    const resolved = fs.realpathSync(dir);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('tw4347-')) throw Error('fixture cleanup escaped its private parent');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
