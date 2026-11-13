'use strict';
/*
  test-4380-gallery-report-limits.js

      node tests\test-4380-gallery-report-limits.js

  Issue #4380. gallery-reports.json kept its newest 500 rows and nothing
  limited how many one account sent, so one account could send enough
  reports to push every other report off the end. A report is what decides
  whether a taken-down picture's file is held (#2352), so a report pushed
  out is a file deleted that should have been kept.

  A real copy of the site runs in a scratch folder (tests\site-files.js),
  with Discord stood in for in the process as
  site\tests\test-hub-staff-gallery.js does it. Three accounts may play:
  Ama, Bjorn and Cato. This holds:
    A  Bjorn reports a picture, and it is kept.
    B  Ama reports another picture twice: the second updates the first
       (the newer words, one row) rather than adding a row.
    C  Ama then sends 505 more reports through the launcher's door. Past the
       limit every other report on the site has (five an hour from one
       account), she is answered 429 with a Retry-After and words saying
       when to try again, and Bjorn's report is still there.
    D  The limit is hers, not everybody's: Cato's report is still taken.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).trim().split('\n').join('\n      ') : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4380-'));
const DATA = path.join(dir, 'data');
const UP = path.join(dir, 'uploads');
const SECRET = crypto.randomBytes(32).toString('hex');
const GUILD = '900000000000000000';
const AMA = '511111111111111111';
const BJORN = '522222222222222222';
const CATO = '533333333333333333';
const REPORTS = path.join(DATA, 'gallery-reports.json');

siteFiles.copy(dir);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(UP, { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: GUILD, invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));
const SHOTS = ['a-shot.png', 'b-shot.png', 'c-shot.png'];
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
for (const n of SHOTS) fs.writeFileSync(path.join(UP, n), PNG);
fs.writeFileSync(path.join(DATA, 'gallery.json'), JSON.stringify(SHOTS.map((n) => ({ name: n, url: '/shot/' + n, by: 'Djinn' }))));

// Discord in the site's process: the guild, its roles and its members, for
// standing(). Anything else is refused.
function stub() {
  const https = require('https');
  const { EventEmitter } = require('events');
  const GUILD = process.env.TS_STUB_GUILD;
  const ROLES = [{ id: 'r3', name: 'Playtester' }];
  const member = (id, name) =>
    ({ nick: name, roles: ['r3'], user: { id: id, username: name.toLowerCase(), global_name: name } });
  const MEMBERS = [member(process.env.TS_AMA, 'Ama'), member(process.env.TS_BJORN, 'Bjorn'), member(process.env.TS_CATO, 'Cato')];
  function answer(where) {
    if (where === '/api/v10/guilds/' + GUILD) return { id: GUILD, name: 'Thornswood (harness)' };
    if (where === '/api/v10/guilds/' + GUILD + '/roles') return ROLES;
    if (where === '/api/v10/guilds/' + GUILD + '/members?limit=1000') return MEMBERS;
    return null;
  }
  function fake(a, b, c) {
    const cb = typeof b === 'function' ? b : c;
    let host = '', where = '';
    if (typeof a === 'string' || a instanceof URL) {
      const u = new URL(String(a)); host = u.hostname; where = u.pathname + (u.search || '');
    } else {
      host = String(a.hostname || a.host || ''); where = String(a.path || '');
    }
    const req = new EventEmitter();
    let ended = false;
    req.setTimeout = () => req;
    req.destroy = () => { };
    req.write = () => true;
    req.end = () => {
      if (ended) return;
      ended = true;
      const body = host === 'discord.com' ? answer(where) : null;
      setImmediate(() => {
        if (!body) { req.emit('error', new Error('the harness lets no request leave this machine')); return; }
        const res = new EventEmitter();
        res.statusCode = 200; res.headers = {};
        res.setEncoding = () => { }; res.resume = () => { };
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
fs.writeFileSync(path.join(dir, 'stub.js'), '(' + stub.toString() + ')();\n');

const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
// The ticket the launcher keeps, the shape makeTicket writes.
function ticket(id, name) {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: String(name), x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + b + '.' + sign('ticket:' + b);
}
const as = (id, name) => '/api/gallery/report?ticket=' + encodeURIComponent(ticket(id, name));

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

let PORT = 0;
let lane = 0;
// Each from its own address, so a limit by connection could not be what
// stops Ama: only one by account can.
function ask(where, doc) {
  return new Promise((done) => {
    const data = Buffer.from(JSON.stringify(doc));
    const h = { 'content-type': 'application/json', 'content-length': data.length,
                'x-forwarded-for': '10.' + ((lane >> 16) & 255) + '.' + ((lane >> 8) & 255) + '.' + (lane++ & 255) };
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'POST', path: where, headers: h, agent: false },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d) => { text += d; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(text); } catch (e) { json = null; }
          done({ status: res.statusCode, text: text, json: json, headers: res.headers });
        });
      });
    req.on('error', (e) => done({ status: 0, text: String(e), json: null, headers: {} }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.write(data);
    req.end();
  });
}
const rows = () => { try { return JSON.parse(fs.readFileSync(REPORTS, 'utf8')); } catch (e) { return []; } };
const said = (r) => r.status + ' ' + r.text.slice(0, 300);

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['-r', path.join(dir, 'stub.js'), 'server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT),
      THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1',
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
      TS_STUB_GUILD: GUILD, TS_AMA: AMA, TS_BJORN: BJORN, TS_CATO: CATO
    })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });

  try {
    let up = false;
    for (let i = 0; i < 200 && !up; i++) {
      if (out.indexOf('listening on ') >= 0) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    // ---- A ------------------------------------------------------------------
    let r = await ask(as(BJORN, 'Bjorn'), { name: 'a-shot.png', why: 'not from the game' });
    yes('A1 Bjorn\'s report is taken (' + said(r) + ')', r.status === 200 && r.json && r.json.ok === true);
    const bjorns = () => rows().filter((x) => x.discordId === BJORN && x.name === 'a-shot.png');
    yes('A2 and kept, against his account', bjorns().length === 1);

    // ---- B ------------------------------------------------------------------
    r = await ask(as(AMA, 'Ama'), { name: 'b-shot.png', why: 'first words' });
    yes('B1 Ama\'s first report on b-shot is taken (' + said(r) + ')', r.status === 200);
    const firstId = r.json && r.json.id;
    r = await ask(as(AMA, 'Ama'), { name: 'b-shot.png', why: 'second words' });
    yes('B2 her second on the same picture is taken (' + said(r) + ')', r.status === 200);
    const hers = rows().filter((x) => x.discordId === AMA && x.name === 'b-shot.png');
    yes('B3 and updates the first rather than adding a row (' + hers.length + ' row(s))', hers.length === 1, JSON.stringify(hers));
    yes('B4 the row has her newer words and keeps the first one\'s id',
      hers.length === 1 && hers[0].why === 'second words' && hers[0].id === firstId, JSON.stringify(hers));

    // ---- C ------------------------------------------------------------------
    let refused = null, taken = 0;
    for (let i = 0; i < 505; i++) {
      r = await ask(as(AMA, 'Ama'), { name: SHOTS[i % SHOTS.length], why: 'flood ' + i });
      if (r.status === 200) taken++;
      else if (r.status === 429 && !refused) refused = r;
      else if (r.status !== 429) { yes('C0 each flood report is taken or refused with 429 (' + said(r) + ')', false); break; }
    }
    yes('C1 Ama is refused with 429 once past the limit (' + taken + ' more taken)', !!refused && taken <= 3);
    yes('C2 the refusal says when to try again, with a Retry-After',
      !!refused && Number(refused.headers['retry-after']) > 0 && refused.json && /Try again in/.test(String(refused.json.error)),
      refused ? said(refused) : 'never refused');
    yes('C3 Bjorn\'s report is still there', bjorns().length === 1, rows().length + ' rows');
    yes('C4 and Ama holds no more than one row a picture',
      SHOTS.every((n) => rows().filter((x) => x.discordId === AMA && x.name === n).length <= 1));

    // ---- D ------------------------------------------------------------------
    r = await ask(as(CATO, 'Cato'), { name: 'c-shot.png', why: 'mine' });
    yes('D1 Cato\'s report is still taken (' + said(r) + ')', r.status === 200 && rows().some((x) => x.discordId === CATO));

    yes('nothing the site did ended in an uncaught exception or unhandled rejection',
      !/uncaught exception|unhandled rejection/i.test(out), out.slice(-2000));
  } catch (err) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (err && err.stack ? err.stack : err) + '\n' + out.slice(-2000));
  }
  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
