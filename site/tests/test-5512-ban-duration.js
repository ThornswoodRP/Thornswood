'use strict';
// #5512: real authenticated HTTP/storage routes and the hub's actual submit
// handler. Malformed lengths must never become permanent bans. No network
// outside this private loopback site, and no real account or Discord action.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const crypto = require('node:crypto'), vm = require('node:vm');
const { spawn } = require('node:child_process');
const siteFiles = require('../../tests/site-files');
const parent = fs.realpathSync(os.tmpdir()), dir = fs.mkdtempSync(path.join(parent, 'tw5512-'));
const secret = crypto.randomBytes(32).toString('hex'), key = crypto.randomBytes(24).toString('hex');
const staff = '222222222222222222', target = '333333333333333333';
let child, port, pass = 0, fail = 0;
function yes(name, ok) { console.log((ok ? 'PASS ' : 'FAIL ') + name); ok ? pass++ : fail++; }
function cookie() {
  const value = staff + '|Aela|' + Date.now();
  return 'twa=' + encodeURIComponent(value + '|' + crypto.createHmac('sha256', secret).update(value).digest('hex').slice(0, 32));
}
const bansFile = path.join(dir, 'data/bans.json'), logFile = path.join(dir, 'data/for-bot/moderation.log');
function bytes(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
const routes = [
  { name: 'hub character', url: '/api/staff/ban', body: { id: target, profileId: 2002 }, hub: true },
  { name: 'hub account', url: '/api/staff/ban', body: { id: target }, hub: true },
  { name: 'game character', url: '/api/staff/game/ban', body: { profileId: 2002, byProfileId: 1001 } },
  { name: 'game account', url: '/api/staff/game/banaccount', body: { profileId: 2002, byProfileId: 1001 } },
  { name: 'dev game character', url: '/dev/api/staff/game/ban', body: { profileId: 2002, byProfileId: 1001 } }
];
async function request(route, minutes, authorized = true) {
  const body = { ...route.body, name: 'Bjorn', why: 'fixture reason' };
  if (minutes !== undefined) body.minutes = minutes;
  const response = await fetch('http://127.0.0.1:' + port + route.url, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + port,
      ...(authorized ? route.hub ? { cookie: cookie() } : { 'x-thornswood-key': key } : {}) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  return { status: response.status, body: await response.json() };
}
function hubSubmit(value, missing) {
  const source = fs.readFileSync(path.join(__dirname, '../public/hub.js'), 'utf8');
  const from = source.indexOf('function wireLinked()'), to = source.indexOf('function linkedFocus(', from);
  const attrs = { 'data-act': 'ban', 'data-id': target, 'data-pid': '2002' };
  const button = { getAttribute: name => attrs[name] || '' };
  const field = v => ({ value: v, getAttribute: name => name === 'data-id' ? target + ':2002' : null });
  const calls = [], alerts = [];
  const page = { querySelectorAll: selector => selector === 'button[data-act]' ? [button] :
    selector === '.banlen' ? missing ? [] : [field(value)] : selector === '.banwhy' ? [field('fixture reason')] : [] };
  const context = { el: () => page, S: { linked: [], records: {} }, charName: () => 'Bjorn', alert: text => alerts.push(text),
    api: (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return Promise.resolve({ ok: false, json: async () => ({ error: 'fixture refusal' }) }); },
    siteSaid: answer => answer.error, refresh: async () => {}, drawLinked() {}, linkedFocus() {}, announce() {} };
  vm.runInNewContext(source.slice(from, to), context);
  context.wireLinked(); button.onclick();
  return { calls, alerts };
}
(async () => {
  try {
    siteFiles.copy(dir); fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ password: crypto.randomBytes(16).toString('hex'), secret,
      admins: [staff], botKey: key, discord: { clientId: 'fixture', clientSecret: 'fixture', botToken: '', guildId: '', invite: '' },
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json') }));
    fs.writeFileSync(path.join(dir, 'data/linked.json'), JSON.stringify({
      [staff]: { id: staff, name: 'Aela', profiles: [1001] }, [target]: { id: target, name: 'Bjorn', profiles: [2002, 2003] }
    }));
    child = spawn(process.execPath, [path.join(dir, 'server.js')], { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'], env: {
      ...process.env, THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1'
    } });
    port = (await siteFiles.listening(child)).port;
    const seed = JSON.stringify({ 'p:2002': { at: 1, until: Date.now() + 3600000, why: 'existing character ban', by: 'Earlier staff', profiles: [2002], scope: 'character', account: target },
      [target]: { at: 1, until: Date.now() + 3600000, why: 'existing account ban', by: 'Earlier staff', profiles: [2002, 2003], scope: 'account', account: target } });
    const log = JSON.stringify({ did: 'note', byName: 'Earlier staff', text: 'kept audit event' }) + '\n';
    for (const route of routes) {
      for (const invalid of [-60, '2h', '', null, ' ', false, true, {}, [], [60], '60', 0.5, 1.5, undefined]) {
        fs.writeFileSync(bansFile, seed); fs.writeFileSync(logFile, log);
        const result = await request(route, invalid);
        const message = String(result.body.message || result.body.error || '');
        const label = route.name + ' refuses ' + String(JSON.stringify(invalid));
        yes(label + ' and names accepted forms', result.status === 400 && /whole|number/i.test(message) && /minute/i.test(message) && /0/.test(message));
        yes(label + ' without changing saved bans or the moderation log', bytes(bansFile) === seed && bytes(logFile) === log);
      }
      for (const minutes of [60, 0, 99999999]) {
        fs.writeFileSync(bansFile, '{}'); fs.writeFileSync(logFile, log);
        const started = Date.now(), result = await request(route, minutes);
        const rows = JSON.parse(bytes(bansFile)), row = rows[route.body.profileId && route.name !== 'game account' ? 'p:2002' : target];
        const wanted = minutes === 0 ? 0 : started + Math.min(minutes, 10 * 365 * 24 * 60) * 60000;
        yes(route.name + ' preserves timed/permanent/capped duration ' + minutes, result.status === 200 && row &&
          (wanted === 0 ? row.until === 0 : Math.abs(row.until - wanted) < 5000));
      }
      fs.writeFileSync(bansFile, seed); fs.writeFileSync(logFile, log);
      const unauthorized = await request(route, 0, false);
      yes(route.name + ' still requires its authenticated caller', (unauthorized.status === 401 || unauthorized.status === 403) && bytes(bansFile) === seed && bytes(logFile) === log);
    }
    for (const value of ['', ' ', '2h', '-60', '0x0', '0.5']) {
      const result = hubSubmit(value);
      yes('actual hub submit refuses malformed selection ' + JSON.stringify(value), result.calls.length === 0 && result.alerts.some(text => /length|minute|choose/i.test(text)));
    }
    yes('actual hub submit refuses a missing length picker', hubSubmit('', true).calls.length === 0);
    for (const value of ['60', '0']) {
      const result = hubSubmit(value);
      yes('actual hub submit sends explicit numeric duration ' + value, result.calls.length === 1 && result.calls[0].body.minutes === Number(value));
    }
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) await new Promise(resolve => { child.once('close', resolve); child.kill(); });
    const resolved = fs.realpathSync(dir);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('tw5512-')) throw Error('fixture cleanup escaped its private parent');
    fs.rmSync(resolved, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed'); process.exitCode = fail ? 1 : 0;
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
