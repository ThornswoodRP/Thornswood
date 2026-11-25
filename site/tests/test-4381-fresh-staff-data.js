'use strict';
// Real HTTP gates with signed sessions and an owned, local-only Discord fixture.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { once } = require('node:events'), siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4381-'));
const secret = crypto.randomBytes(32).toString('hex'), marker = 'PRIVATE-4381-FIXTURE';
const manual = '200000000000000001', session = 'a'.repeat(32), target = '300000000000000001';
let child, port, offset = 0, serial = 0, pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function write(name, value) { fs.writeFileSync(path.join(dir, name), JSON.stringify(value)); }
function cookie(id) {
  const value = id + '|Fixture|' + Date.now();
  const mac = crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(value + '|' + mac);
}
function preload() {
  const fs = require('node:fs'), path = require('node:path'), https = require('node:https');
  const { EventEmitter } = require('node:events'), realNow = Date.now;
  const read = fs.readFileSync.bind(fs), append = fs.appendFileSync.bind(fs), exists = fs.existsSync.bind(fs), list = fs.readdirSync.bind(fs);
  Date.now = () => realNow() + Number(read(path.join(__dirname, 'clock.txt'), 'utf8'));
  // Never inspect the host's real game logs. Client/chat evidence is owned below.
  fs.existsSync = file => /^C:\\Thornswood-Server(?:-Dev)?(?:\\|$)/i.test(String(file)) ? false : exists(file);
  fs.readdirSync = (file, ...args) => /^C:\\Thornswood-Server(?:-Dev)?(?:\\|$)/i.test(String(file)) ? [] : list(file, ...args);
  fs.readFileSync = (file, ...args) => {
    if (/signins\.json$|results\.json$|notes\.json$|sessions\.json$|gallery-(?:pending|reports)\.json$|session-logs[\\/]|deploys[\\/]/.test(String(file))) {
      append(path.join(__dirname, 'reads.jsonl'), JSON.stringify(String(file)) + '\n');
    }
    return read(file, ...args);
  };
  function request(options, second, third) {
    const callback = typeof second === 'function' ? second : third;
    const parsed = typeof options === 'string' || options instanceof URL ? new URL(String(options)) : options;
    const host = String(parsed.hostname || parsed.host || ''), route = String(parsed.path || parsed.pathname || '') + (parsed.search || '');
    const mode = JSON.parse(read(path.join(__dirname, 'mode.json'), 'utf8'));
    let answer;
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture') answer = { id: 'fixture', name: 'Fixture' };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/roles') answer = [
      { id: 'admin', name: 'Owner' }, { id: 'staff', name: 'Gamemaster' }, { id: 'play', name: 'Playtester' }
    ];
    const member = id => ({ user: { id, username: 'Fixture' }, roles: mode.roles });
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/members?limit=1000') answer = [member(mode.id)];
    if (host === 'discord.com' && (route === '/api/v10/guilds/fixture/members/' + mode.id || route === '/api/v10/guilds/fixture/members/200000000000000001')) answer = member(mode.id);
    const known = answer !== undefined, bootstrap = route === '/api/v10/guilds/fixture';
    append(path.join(__dirname, 'provider.jsonl'), JSON.stringify({ route, unexpected: !known }) + '\n');
    const req = new EventEmitter(); let ended = false;
    req.setTimeout = () => req; req.destroy = () => {}; req.write = () => true;
    req.end = () => {
      if (ended) return; ended = true;
      setImmediate(() => {
        if (!known) return req.emit('error', Error('fixture blocked external request: ' + host + route));
        if (!bootstrap && mode.fault === 'slow') return;
        const res = new EventEmitter(); res.statusCode = !bootstrap && mode.fault === 'fail' ? 503 : 200;
        res.headers = {}; res.complete = true; res.setEncoding = () => {}; res.resume = () => {};
        callback(res); res.emit('data', Buffer.from(JSON.stringify(answer))); res.emit('end');
      });
    };
    return req;
  }
  https.request = request;
  https.get = (...args) => { const req = request(...args); req.end(); return req; };
}
function mode(roles, fault = '') {
  const id = String(100000000000000000n + BigInt(++serial));
  offset += 61000; fs.writeFileSync(path.join(dir, 'clock.txt'), String(offset));
  write('mode.json', { id, roles, fault }); return id;
}
function expire(id, roles, fault) {
  offset += 61000; fs.writeFileSync(path.join(dir, 'clock.txt'), String(offset));
  write('mode.json', { id, roles, fault });
}
function waitForRoleBootstrap(site) {
  return new Promise((resolve, reject) => {
    let output = '';
    const finish = error => {
      clearTimeout(timer);
      site.stdout.off('data', onData);
      site.off('exit', onExit);
      site.off('error', finish);
      if (error) reject(error);
      else resolve();
    };
    const onData = chunk => {
      output += chunk;
      if (/\[thornswood-docs\] 3 roles visible to the bot\r?\n/.test(output)) finish();
    };
    const onExit = code => finish(new Error('Fixture site exited before loading Discord roles (exit ' + code + ').\n' + output));
    const timer = setTimeout(() => finish(new Error('Fixture site did not load Discord roles within 30 seconds.\n' + output)), 30000);
    site.stdout.on('data', onData);
    site.once('exit', onExit);
    site.once('error', finish);
  });
}
async function get(route, id, method = 'GET') {
  fs.writeFileSync(path.join(dir, 'reads.jsonl'), '');
  const start = performance.now();
  const response = await fetch('http://127.0.0.1:' + port + route, { method, redirect: 'manual',
    headers: id ? { cookie: cookie(id) } : {}, signal: AbortSignal.timeout(6000) });
  const text = await response.text();
  return { status: response.status, text, elapsed: performance.now() - start,
    reads: fs.readFileSync(path.join(dir, 'reads.jsonl'), 'utf8'), headers: response.headers };
}
const routes = ['/api/signins', '/api/all', '/api/staff/records', '/api/deploys',
  '/api/session-logs?session=' + session + '&who=' + target, '/api/gallery/pending', '/api/gallery/reports'];
(async () => {
  try {
    siteFiles.copy(dir, process.argv[2]); fs.mkdirSync(path.join(dir, 'data/session-logs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'deploys')); fs.mkdirSync(path.join(dir, 'chat'));
    fs.copyFileSync(path.join(siteFiles.APP, 'public/index.html'), path.join(dir, 'public/index.html'));
    fs.writeFileSync(path.join(dir, 'clock.txt'), '0'); write('mode.json', { id: manual, roles: [] });
    const now = Date.now();
    write('config.json', { password: crypto.randomBytes(16).toString('hex'), secret, admins: [manual],
      discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: 'fixture', guildId: 'fixture' },
      access: { admin: ['Owner'], dev: ['Gamemaster'], play: ['Playtester'], banned: ['Banned'] }, gameCheckPort: 1 });
    write('data/signins.json', [{ at: now, name: marker }]); write('data/results.json', { fixture: { notes: marker } });
    write('data/notes.json', { [target]: [{ at: now, text: marker }] });
    write('data/sessions.json', [{ session, who: target, profile: 7003, channel: 'dev', start: now, end: now, keep: true }]);
    write('data/session-logs/' + session + '.json', { logs: { 'launcher.log': marker }, chat: { lines: [marker] } });
    write('data/gallery-pending.json', [{ at: now, name: 'fixture.png', note: marker }]);
    write('data/gallery-reports.json', [{ at: now, name: 'fixture.png', why: marker }]);
    write('deploys/fixture.json', { component: 'fixture', name: marker });
    fs.writeFileSync(path.join(dir, 'network.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'network.js'), path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1',
        THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DEPLOYS_DIR: path.join(dir, 'deploys'),
        THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'), THORNSWOOD_DEV_CHAT_DIR: path.join(dir, 'chat') }
    });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; });
    // The socket listens before the startup reads and role discovery finish.
    // Keep startup time out of the individual requests' response deadlines.
    const [listening] = await Promise.all([siteFiles.listening(child), waitForRoleBootstrap(child)]);
    port = listening.port;
    {
      const id = mode(['admin']);
      for (const route of routes) {
        const result = await get(route, id);
        yes('current admin reads actual private fixture ' + route, result.status === 200 && result.text.includes(marker));
      }
    }
    for (const fault of ['fail', 'slow']) {
      const id = mode(['admin']);
      yes(fault + ' primes actual last-good admin', (await get('/api/hello', id)).status === 200);
      expire(id, ['admin'], fault);
      for (const method of ['GET', 'HEAD']) for (const route of routes) {
        const result = await get(route, id, method);
        yes(fault + ' ' + method + ' refuses private data before reads ' + route,
          [401, 403, 503].includes(result.status) && !result.text.includes(marker) && result.reads === '');
        yes(fault + ' ' + method + ' keeps existing short answer budget ' + route, result.elapsed < 2500);
      }
      const hello = await get('/api/hello', id), hub = await get('/hub', id);
      yes(fault + ' last-good identity may still draw shell', hello.status === 200 && JSON.parse(hello.text).admin === true
        && hello.reads === '' && hub.status === 200 && !hub.text.includes(marker) && hub.reads === '');
    }
    {
      const id = mode(['admin']); await get('/api/hello', id); expire(id, ['play'], '');
      for (const route of routes) yes('fresh removed roles deny ' + route, [401, 403].includes((await get(route, id)).status));
      for (const route of routes) yes('anonymous denies ' + route, [401, 403].includes((await get(route)).status));
    }
    {
      const id = mode(['staff']);
      yes('current staff retains staff data', (await get('/api/staff/records', id)).text.includes(marker));
      yes('staff still cannot read admin signins', (await get('/api/signins', id)).status === 403);
      expire(id, ['staff'], 'fail');
      const refused = await get('/api/staff/records', id);
      yes('last-good nonadmin staff also loses private data on failure', refused.status !== 200 && refused.reads === '');
      expire(id, ['staff'], '');
      yes('current role recovery resumes actual data', (await get('/api/staff/records', id)).text.includes(marker));
    }
    {
      mode([], 'fail');
      yes('configured manual admin remains authoritative without Discord', (await get('/api/signins', manual)).text.includes(marker));
    }
    const trace = fs.readFileSync(path.join(dir, 'provider.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
    yes('all provider requests were strictly local known fixture routes', !trace.some(row => row.unexpected) && !stderr.includes('fixture blocked external request'));
    yes('owned site remains running', child.exitCode === null);
  } catch (e) { fail++; console.error(e.stack || e); }
  finally {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    if (!path.resolve(dir).startsWith(parent + path.sep)) throw Error('refusing cleanup outside owned temp folder');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
