'use strict';
// Actual HTTP join/Hub routes, provider JSON errors and persisted ownership.
// The only HTTPS implementation is the strict local Discord stand-in below.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), { spawn } = require('node:child_process');
const { once } = require('node:events');
const siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw4936-'));
const secret = crypto.randomBytes(32).toString('hex');
let child, port, offset = 0, serial = 0, pass = 0, fail = 0;
const modeFile = path.join(dir, 'mode.json'), traceFile = path.join(dir, 'trace.jsonl');
const linkedFile = path.join(dir, 'data/linked.json');
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function signed(value) { return crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32); }
function ticket(id) { const value = Buffer.from(JSON.stringify({ d: id, n: 'Fixture', x: Date.now() + 86400000 })).toString('base64url'); return 'tk1.' + value + '.' + signed('ticket:' + value); }
function cookie(id) { const value = id + '|Fixture|' + Date.now(); return 'twa=' + encodeURIComponent(value + '|' + signed(value)); }
function preload() {
  const https = require('node:https'), fs = require('node:fs'), path = require('node:path');
  const { EventEmitter } = require('node:events'), realNow = Date.now;
  Date.now = () => realNow() + Number(fs.readFileSync(path.join(__dirname, 'clock.txt'), 'utf8'));
  const member = (id) => ({ user: { id, username: 'Fixture' }, roles: ['play'] });
  function request(options, second, third) {
    const callback = typeof second === 'function' ? second : third;
    const parsed = typeof options === 'string' || options instanceof URL ? new URL(String(options)) : options;
    const host = String(parsed.hostname || parsed.host || ''), route = String(parsed.path || parsed.pathname || '') + (parsed.search || '');
    const mode = JSON.parse(fs.readFileSync(path.join(__dirname, 'mode.json'), 'utf8'));
    let answer;
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture') answer = { status: 200, body: { id: 'fixture', name: 'Fixture Guild' } };
    if (host === 'discord.com' && route === '/api/oauth2/token') answer = { status: 200, body: { access_token: 'fixture-oauth-token' } };
    if (host === 'discord.com' && route === '/api/users/@me') answer = { status: 200, body: { id: mode.caller, username: 'Fixture' } };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/roles') answer = { status: 200, body: [{ id: 'play', name: 'Playtester' }] };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/members?limit=1000') {
      answer = mode.bulk === 'complete' ? { status: 200, body: [member(mode.caller)] }
        : mode.bulk === 'malformed' ? { status: 200, body: [member(mode.caller), { user: {} }] }
        : mode.bulk === 'duplicate' ? { status: 200, body: [member(mode.caller), member(mode.caller)] }
        : mode.bulk === 'full' ? { status: 200, body: [member(mode.caller), ...Array.from({ length: 999 }, (_, i) => member(String(300000000000000000n + BigInt(i))))] }
        : { status: 403, body: { code: 50001, message: 'Fixture list unavailable' } };
    }
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/members/' + mode.caller) answer = mode.callerError || { status: 200, body: member(mode.caller) };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/members/' + mode.owner) answer = mode.ownerError || { status: 200, body: member(mode.owner) };
    if (host === 'discord.com' && route === '/api/v10/guilds/fixture/bans/' + mode.owner) answer = mode.banError || { status: 200, body: { reason: 'Fixture Discord ban' } };
    fs.appendFileSync(path.join(__dirname, 'trace.jsonl'), JSON.stringify({ route, unexpected: !answer }) + '\n');
    const req = new EventEmitter(); let ended = false;
    req.setTimeout = () => req; req.destroy = () => {}; req.write = () => true;
    req.end = () => {
      if (ended) return; ended = true;
      setImmediate(() => {
        if (!answer) return req.emit('error', Error('fixture blocks external request: ' + host + route));
        const res = new EventEmitter(); res.statusCode = answer.status; res.headers = {}; res.complete = true;
        res.setEncoding = () => {}; res.resume = () => {};
        callback(res); res.emit('data', Buffer.from(answer.raw === undefined ? JSON.stringify(answer.body) : answer.raw)); res.emit('end');
      });
    };
    return req;
  }
  https.request = request;
  https.get = (...args) => { const req = request(...args); req.end(); return req; };
}
function setup(extra = {}) {
  serial++; offset += 61000;
  const caller = String(100000000000000000n + BigInt(serial)), owner = String(200000000000000000n + BigInt(serial));
  fs.writeFileSync(path.join(dir, 'clock.txt'), String(offset));
  fs.writeFileSync(modeFile, JSON.stringify({ caller, owner, ...extra }));
  const linked = { [caller]: { id: caller, name: 'New account', profiles: [] }, [owner]: { id: owner, name: 'Owner account', profiles: [7001], retained: 'owner metadata' } };
  fs.writeFileSync(linkedFile, JSON.stringify(linked));
  fs.writeFileSync(path.join(dir, 'data/bans.json'), '{}');
  fs.writeFileSync(traceFile, '');
  return { caller, owner, linked };
}
async function request(route, fixture, body) {
  const response = await fetch('http://127.0.0.1:' + port + route, { method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + port, cookie: cookie(fixture.caller) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  const text = await response.text(), json = JSON.parse(text);
  return { status: response.status, json, text, headers: Object.fromEntries(response.headers) };
}
async function signInResult() {
  const base = 'http://127.0.0.1:' + port;
  const begin = await fetch(base + '/auth/discord?back=/hub', { redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const state = new URL(begin.headers.get('location')).searchParams.get('state');
  const jar = begin.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const result = await fetch(base + '/auth/discord/callback?code=fixture&state=' + encodeURIComponent(state), {
    redirect: 'manual', headers: { cookie: jar }, signal: AbortSignal.timeout(10000)
  });
  return { status: result.status, text: await result.text() };
}
const error = (code) => ({ status: 404, body: { code, message: 'Fixture Discord error' } });
const invalid = [
  ['unknown guild', error(10004)], ['unknown user', error(10013)], ['missing code', { status: 404, body: { message: 'Unknown Member' } }],
  ['string code', { status: 404, body: { code: '10007' } }], ['array body', { status: 404, body: [{ code: 10007 }] }],
  ['broken JSON', { status: 404, raw: '{' }], ['null body', { status: 404, body: null }]
];
(async () => {
  try {
    siteFiles.copy(dir, process.argv[2]); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'clock.txt'), '0'); fs.writeFileSync(modeFile, '{}');
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ password: crypto.randomBytes(16).toString('hex'), secret, admins: [],
      discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: 'fixture', guildId: 'fixture', invite: '' },
      access: { admin: ['Owner'], dev: ['Gamemaster'], play: ['Playtester'], banned: ['Banned'] }, gameCheckPort: 1, onlineFile: path.join(dir, 'online.json') }));
    fs.writeFileSync(path.join(dir, 'network.js'), '(' + preload.toString() + ')();');
    child = spawn(process.execPath, ['-r', path.join(dir, 'network.js'), path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1' }
    });
    let stderr = ''; child.stderr.on('data', data => { stderr += data; });
    port = (await siteFiles.listening(child)).port;
    for (const [label, answer] of [...invalid, ['wrong resource code', error(10026)]]) {
      const f = setup({ callerError: answer });
      const result = await request('/api/play/join', f, { ticket: ticket(f.caller), profileId: 7001 });
      yes('member ' + label + ' is unavailable rather than certain absence', result.status === 503 && result.json.why !== 'guild');
      const page = await signInResult();
      yes('member ' + label + ' gives the actual sign-in callback an unavailable-Discord explanation',
        page.status === 200 && page.text.includes('Thornswood could not ask Discord about that account')
        && !page.text.includes('That account is not in the Thornswood Discord.'));
      yes('member lookup failure preserves owner metadata and profile assignment', JSON.stringify(JSON.parse(fs.readFileSync(linkedFile, 'utf8'))[f.owner]) === JSON.stringify(f.linked[f.owner]));
    }
    {
      const f = setup({ callerError: error(10007) });
      const result = await request('/api/play/join', f, { ticket: ticket(f.caller), profileId: 7001 });
      yes('genuine numeric Unknown Member still refuses as not in guild', result.status === 403 && result.json.why === 'guild');
      const page = await signInResult();
      yes('genuine Unknown Member retains the actual not-in-Discord sign-in explanation',
        page.status === 200 && page.text.includes('That account is not in the Thornswood Discord.')
        && !page.text.includes('Thornswood could not ask Discord about that account'));
    }
    const protectedCases = [
      ...invalid.map(([label, answer]) => ['member ' + label, { ownerError: answer, banError: error(10026) }]),
      ...invalid.map(([label, answer]) => ['ban ' + label, { ownerError: error(10007), banError: answer }]),
      ['ban wrong resource code', { ownerError: error(10007), banError: error(10007) }],
      ['ban string Unknown Ban', { ownerError: error(10007), banError: { status: 404, body: { code: '10026' } } }],
      ['actual Discord ban', { ownerError: error(10007) }],
      ['still a member', { banError: error(10026) }],
      ['a malformed member page cannot prove departure', { bulk: 'malformed', banError: error(10026) }],
      ['a duplicate row cannot prove a member page complete', { bulk: 'duplicate', banError: error(10026) }],
      ['complete list but unknown ban lookup', { bulk: 'complete', banError: error(10004) }],
      ['full page is not proof of departure', { bulk: 'full', ownerError: error(10004), banError: error(10026) }]
    ];
    for (const [label, mode] of protectedCases) {
      const f = setup(mode);
      const result = await request('/api/play/join', f, { ticket: ticket(f.caller), profileId: 7001 });
      const saved = JSON.parse(fs.readFileSync(linkedFile, 'utf8'));
      yes(label + ' cannot hand the existing profile to another account', result.status === 200 && result.json.claimed === false
        && JSON.stringify(saved[f.owner]) === JSON.stringify(f.linked[f.owner]) && !saved[f.caller].profiles.includes(7001));
    }
    for (const bulk of ['deny', 'complete']) {
      const f = setup({ bulk, ownerError: error(10007), banError: error(10026) });
      const result = await request('/api/play/join', f, { ticket: ticket(f.caller), profileId: 7001 });
      const saved = JSON.parse(fs.readFileSync(linkedFile, 'utf8'));
      yes(bulk + ' proven departure and Unknown Ban still allow the canonical profile handoff', result.status === 200 && result.json.claimed === true
        && saved[f.caller].profiles.includes(7001) && !saved[f.owner].profiles.includes(7001));
      const trace = fs.readFileSync(traceFile, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      yes(bulk + ' complete-list proof preserves single-member lookup selection',
        trace.some(row => row.route.endsWith('/members/' + f.owner)) === (bulk === 'deny') && !trace.some(row => row.unexpected));
    }
    if (/fixture blocks external request/.test(stderr)) console.error(stderr.split('\n').filter(line => /fixture blocks external request/.test(line)).join('\n'));
    yes('the owned scratch site stayed running throughout the real HTTP matrix', child.exitCode === null && !/fixture blocks external request/.test(stderr));
  } catch (e) { fail++; console.error(e.stack || e); }
  finally {
    if (child && child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    if (!path.resolve(dir).startsWith(parent + path.sep)) throw Error('refusing cleanup outside owned temp folder');
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})();
