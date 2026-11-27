'use strict';
/*
  test-6278-shared-pc.js

      node tests/test-6278-shared-pc.js

  #6278, which accounts play from the same PC. Patrick chose A on 16 Nov
  2026: the launcher sends a one-way hash of the PC's Windows machine id
  with each join pass; the site hashes it again with its own secret and
  keeps it beside the Discord account for 30 days, like sign-in addresses;
  staff see on the Linked page which accounts share one; a deletion request
  takes the rows; and the privacy page says all of it.

  A copy of the site on a port of the system's choosing, and the launcher,
  hub, retention, deletion and privacy files read as they are. Nothing
  leaves the machine and every copy is under the temp folder.
*/
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');
const DISCORD = read(path.join(ROOT, 'launcher', 'app', 'Discord.cs'));
const HUB = read(path.join(ROOT, 'site', 'public', 'hub.js'));
const PRIVACY = read(path.join(ROOT, 'site', 'data', 'site', 'privacy.md'));
const RETENTION = read(path.join(ROOT, 'site', 'lib', 'retention.js'));
const DELETION = read(path.join(ROOT, 'site', 'lib', 'deletion.js'));
const SERVE = read(path.join(ROOT, 'site', 'lib', 'serve.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// ---- the launcher ----------------------------------------------------------------
yes('the launcher hashes the PC\'s Windows machine id one way and sends only the hash with each join pass',
    /OpenSubKey\(@"SOFTWARE\\Microsoft\\Cryptography"\)/.test(DISCORD) && /GetValue\("MachineGuid"\)/.test(DISCORD) &&
    /SHA256\.HashData\(Encoding\.UTF8\.GetBytes\("thornswood-pc:" \+ guid\)\)/.test(DISCORD) &&
    /",\\"pc\\":\\"" \+ PcId\(\) \+ "\\"}"/.test(DISCORD));
yes('  and sends none, saying why, when the id cannot be read', /Swallow\.Note\("Discord\.PcId/.test(DISCORD) && /if \(!OperatingSystem\.IsWindows\(\)\) return "";/.test(DISCORD));
yes('the site records the PC before any refusal, so a banned account\'s PC is known too',
    SERVE.indexOf('notePc(t.d, o.pc, Date.now());') > SERVE.indexOf("if (p === '/api/play/pass'") &&
    SERVE.indexOf('notePc(t.d, o.pc, Date.now());') < SERVE.indexOf("why: 'banned', message: accountBanned(st)", SERVE.indexOf("if (p === '/api/play/pass'")));

// ---- a copy of the site -------------------------------------------------------
const sdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-pcs-site-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const BOTKEY = crypto.randomBytes(16).toString('hex');
const GUILD = '900000000000000000';
const OWNER_ID = '411111111111111111';
const LORE_ID = '422222222222222222';
const TESTER_ID = '433333333333333333';
siteFiles.copy(sdir);
fs.mkdirSync(path.join(sdir, 'public'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'site', 'public', 'index.html'), path.join(sdir, 'public', 'index.html'));
fs.mkdirSync(path.join(sdir, 'data'), { recursive: true });
fs.writeFileSync(path.join(sdir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: 'harness-bot', guildId: GUILD, invite: '' },
  botKey: BOTKEY, admins: [], secret: SECRET, gameCheckPort: 1, onlineFile: path.join(sdir, 'online.json')
}, null, 2));
/* The stub test-3164-hold-economy.js loads ahead of the site. */
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r1', name: 'Owner' }, { id: 'r2', name: 'Loremaster' }, { id: 'r3', name: 'Playtester' }];
  const member = (id, name, roles) => ({ nick: name, roles: roles, user: { id: id, username: name.toLowerCase(), global_name: name } });
  const MEMBERS = [member(process.env.TS_STUB_OWNER, 'Owner', ['r1']), member(process.env.TS_STUB_LORE, 'Lore', ['r2']),
                   member(process.env.TS_STUB_TESTER, 'Tester', ['r3'])];
  function answer(where) {
    if (where === '/api/v10/guilds/' + GUILD) return { id: GUILD, name: 'Thornswood (harness)' };
    if (where === '/api/v10/guilds/' + GUILD + '/roles') return ROLES;
    if (where === '/api/v10/guilds/' + GUILD + '/members?limit=1000') return MEMBERS;
    return null;
  }
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); host = u.hostname; where = u.pathname + (u.search || ''); }
    else { host = String(a.hostname || a.host || ''); where = String(a.path || ''); }
    const req = new EventEmitter();
    let ended = false;
    req.setTimeout = () => req; req.destroy = () => { }; req.write = () => true;
    req.end = () => {
      if (ended) return;
      ended = true;
      const body = host === 'discord.com' ? answer(where) : null;
      setImmediate(() => {
        if (!body) { req.emit('error', new Error('the harness lets no request leave this machine')); return; }
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {}; res.setEncoding = () => { }; res.resume = () => { };
        if (cb) cb(res);
        res.emit('data', Buffer.from(JSON.stringify(body)));
        res.emit('end');
      });
    };
    return req;
  }
  https.request = fake;
  https.get = function (a, b, c) { const r = fake(a, b, c); r.end(); return r; };
}
fs.writeFileSync(path.join(sdir, 'stub.js'), '(' + stub.toString() + ')();\n');

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const cookieFor = (id, name) => {
  const at = Date.now();
  const raw = id + '|' + name + '|' + at + '|' + sign(id + '|' + name + '|' + at);
  return 'twa=' + encodeURIComponent(raw);
};
let PORT = 0;
function ask(method, where, headers, bodyText) {
  return new Promise((done) => {
    const data = bodyText === undefined ? null : Buffer.from(bodyText);
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: where, headers: h, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => { let json = null; try { json = JSON.parse(text); } catch (e) { json = null; } done({ status: res.statusCode, body: text, json: json }); });
    });
    req.on('error', (e) => done({ status: 0, body: String(e), json: null }));
    req.setTimeout(10000, () => req.destroy(new Error('timed out')));
    if (data) req.write(data);
    req.end();
  });
}
const asJson = { 'content-type': 'application/json' };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));


const ticketFor = (id, name) => {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: name, x: Date.now() + 86400000 })).toString('base64url');
  return 'tk1.' + b + '.' + sign('ticket:' + b);
};
const pcOf = (s) => crypto.createHash('sha256').update('thornswood-pc:' + s).digest('hex');
const PC_A = pcOf('aaaa-1'), PC_B = pcOf('bbbb-2');

(async () => {
  // Accounts on the Linked page, and one PC row past its 30 days.
  fs.writeFileSync(path.join(sdir, 'data', 'linked.json'), JSON.stringify({
    [OWNER_ID]: { id: OWNER_ID, name: 'Owner', profiles: [] },
    [LORE_ID]: { id: LORE_ID, name: 'Lore', profiles: [] },
    [TESTER_ID]: { id: TESTER_ID, name: 'Tester', profiles: [] }
  }));
  fs.writeFileSync(path.join(sdir, 'data', 'pcs.json'), JSON.stringify([
    { id: '499999999999999999', pc: 'f'.repeat(32), at: Date.now() - 31 * 86400000 }
  ]));
  const srv = spawn(process.execPath, ['-r', path.join(sdir, 'stub.js'), 'server.js'], {
    cwd: sdir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(sdir, 'chat'),
      TS_STUB_GUILD: GUILD, TS_STUB_OWNER: OWNER_ID, TS_STUB_LORE: LORE_ID, TS_STUB_TESTER: TESTER_ID
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    let up = false;
    for (let i = 0; i < 200; i++) {
      if (siteFiles.saidPort(out)) { PORT = siteFiles.saidPort(out); up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    const passAsk = (id, name, pc) => ask('POST', '/api/play/pass', asJson,
      JSON.stringify({ ticket: ticketFor(id, name), profileId: 7, channel: 'main', version: '1.0.0', pc: pc }));
    await passAsk(OWNER_ID, 'Owner', PC_A);
    await passAsk(LORE_ID, 'Lore', PC_A);
    await passAsk(TESTER_ID, 'Tester', PC_B);
    await passAsk(OWNER_ID, 'Owner', PC_A);
    await passAsk(TESTER_ID, 'Tester', 'not a hash');
    await passAsk(TESTER_ID, 'Tester', undefined);
    const r0 = await ask('POST', '/api/play/pass', asJson, JSON.stringify({ ticket: 'tk1.forged.x', profileId: 7, pc: pcOf('cccc-3') }));

    let rows = [];
    try { rows = JSON.parse(fs.readFileSync(path.join(sdir, 'data', 'pcs.json'), 'utf8')); } catch (e) { rows = []; }
    yes('each account and PC is one row, the newest time, whatever the pass answered', rows.length === 3 &&
        rows.filter((x) => x.id === OWNER_ID).length === 1 && rows.every((x) => Number(x.at) > Date.now() - 60000));
    const text = JSON.stringify(rows);
    yes('what is kept is the hash hashed again with the site\'s secret, never what the launcher sent',
        rows.every((x) => /^[0-9a-f]{32}$/.test(x.pc)) && text.indexOf(PC_A) < 0 && text.indexOf(PC_A.slice(0, 32)) < 0 && text.indexOf(PC_B.slice(0, 32)) < 0);
    yes('two accounts on one PC share a row key, another PC does not',
        rows.find((x) => x.id === OWNER_ID).pc === rows.find((x) => x.id === LORE_ID).pc &&
        rows.find((x) => x.id === TESTER_ID).pc !== rows.find((x) => x.id === OWNER_ID).pc);
    yes('a pass with no hash or a broken one keeps nothing, and a forged ticket keeps nothing', r0.status === 401 &&
        rows.filter((x) => x.id === TESTER_ID).length === 1);
    yes('a row past its 30 days goes when the file is written', !rows.some((x) => x.id === '499999999999999999'));

    let r = await ask('GET', '/api/all', { cookie: cookieFor(LORE_ID, 'Lore') });
    const linked = (r.json && r.json.linked) || [];
    const by = (id) => linked.find((u) => String(u.id) === id) || {};
    yes('staff see, with each account, the others that played from one of its PCs',
        r.status === 200 && JSON.stringify(by(OWNER_ID).sharesPc) === JSON.stringify([LORE_ID]) &&
        JSON.stringify(by(LORE_ID).sharesPc) === JSON.stringify([OWNER_ID]) && by(TESTER_ID).sharesPc === undefined);
    yes('  and never the PC itself', JSON.stringify(linked).indexOf(rows[0].pc) < 0);
    r = await ask('GET', '/api/all', { cookie: cookieFor(TESTER_ID, 'Tester') });
    yes('a Playtester sees no accounts at all', !(r.json && r.json.linked && r.json.linked.length));
  } finally {
    if (srv.exitCode === null && srv.signalCode === null) { await new Promise((ok) => { srv.once('exit', ok); srv.kill(); }); }
  }

  // The sweep, in this process, against the copy's data folder.
  fs.writeFileSync(path.join(sdir, 'data', 'pcs.json'), JSON.stringify([
    { id: OWNER_ID, pc: 'a'.repeat(32), at: Date.now() - 31 * 86400000 },
    { id: LORE_ID, pc: 'a'.repeat(32), at: Date.now() - 29 * 86400000 }
  ]));
  const cwd = process.cwd();
  process.chdir(sdir);
  let swept = null;
  try { swept = require(path.join(sdir, 'lib', 'pcs.js')).sweepPcs(Date.now()); }
  catch (e) { console.log('      the sweep threw: ' + e.message); }
  process.chdir(cwd);
  yes('the sweep drops a row past 30 days and keeps one inside them', swept && swept.rows === 2 && swept.kept === 1 && swept.written === true);
  yes('and the hourly sweep runs it', /pcs: sweepPcs\(now\)/.test(RETENTION));
  yes('a deletion request takes the account\'s PC rows', /\['pcs', PCS, \[\]\]/.test(DELETION) &&
      /filter\('pcs', \(x\) => !\(isObj\(x\) && String\(x\.id\) === id\), 'PC rows'\);/.test(DELETION));

  // ---- the hub and the privacy page -----------------------------------------------
  yes('the Linked page says which accounts played from the same PC, by name', /function pcLine\(u\)/.test(HUB) &&
      /out \+= pcLine\(u\);/.test(HUB) && /Played from the same PC as /.test(HUB));
  yes('the privacy page says what is sent, how it is scrambled, who sees it and why',
      /\*\*This PC\.\*\*/.test(PRIVACY) && /the id itself never leaves your PC/.test(PRIVACY) && /a key only it holds/.test(PRIVACY));
  yes('  that it is kept for 30 days', /\*\*This PC\*\*, the scrambled id above, is kept for 30 days/.test(PRIVACY));
  yes('  that a deletion request removes it', /your Discord link, which PCs your account played\s+from/.test(PRIVACY));
  yes('  and that staff in the world see it', /which accounts played from the same\s+PC/.test(PRIVACY));

  fs.rmSync(sdir, { recursive: true, force: true });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.log('FAIL  the harness itself stopped: ' + String(e && e.stack || e).replace(/\n/g, '\n      '));
  process.exitCode = 1;
});
