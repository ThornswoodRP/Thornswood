'use strict';
/*
  test-2350-session-retention.js

      node .\site\tests\test-2350-session-retention.js
      node .\site\tests\test-2350-session-retention.js <an older server.js>

  Issue #2350: site/data/site/privacy.md says session records are kept for 365
  days, then dropped, and a session marked kept is never pruned. The rows in
  sessions.json were capped by count only, the newest 2000, so a row lived
  for years on a quiet server; and the session log prune ran only when a
  session ended, so a quiet stretch left log sets past 365 days on disk.
  Decided by Patrick on 12 Oct: age the rows past 365 days (kept rows stay),
  and run both prunes on a timer too.

  Against a real copy of site\server.js in a scratch folder on a spare port,
  with no session ending at all:
    - a row 400 days old goes from sessions.json, and its log set goes too;
    - a row 400 days old marked kept stays, and so does its log set;
    - a row from yesterday stays, with its log set;
    - a row with no time at all is kept, not guessed at;
    - the hub's answer for an admin holds no row past the window.
  Then, lifting freshSessions out of the same file:
    - past the 2000-row bound the oldest unkept rows go first, and a kept row
      is never pushed out by the count;
  and in the source:
    - the sweep runs every hour, not only when a session ends.

  Nothing leaves the machine and the scratch folder is removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = process.argv[2] || path.join(APP, 'server.js');
const src = siteFiles.source(SITE_SRC);

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2350-'));
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_ID = '111111111111111111';
siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.mkdirSync(path.join(dir, 'data', 'session-logs'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(16).toString('hex'),
  admins: [ADMIN_ID],
  secret: SECRET,
  gameCheckPort: 1,
  onlineFile: path.join(dir, 'online.json')
}, null, 2));
const sign = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const adminCookie = () => {
  const at = Date.now();
  return 'twa=' + encodeURIComponent(ADMIN_ID + '|Admin|' + at + '|' + sign(ADMIN_ID + '|Admin|' + at));
};

const DAY = 86400000;
const NOW = Date.now();
const SESSIONS = path.join(dir, 'data', 'sessions.json');
const SLOGS = path.join(dir, 'data', 'session-logs');
const rows = [
  { session: 'old0000000000001', who: '501', start: NOW - 400 * DAY - 3600000, end: NOW - 400 * DAY, channel: 'main' },
  { session: 'kept000000000002', who: '502', start: NOW - 400 * DAY - 3600000, end: NOW - 400 * DAY, channel: 'main',
    keep: true, keptBy: 'Staff', keptAt: NOW - 390 * DAY },
  { session: 'endonly000000003', who: '503', start: 0, end: NOW - 380 * DAY, channel: 'main' },
  { session: 'new0000000000004', who: '504', start: NOW - DAY - 3600000, end: NOW - DAY, channel: 'main' },
  { session: 'notime0000000005', who: '505', channel: 'main' },
  { session: 'open000000000006', who: '506', start: NOW - 2 * 3600000, channel: 'main' }
];
fs.writeFileSync(SESSIONS, JSON.stringify(rows, null, 2));
function logSet(key, who, at) {
  fs.writeFileSync(path.join(SLOGS, key + '.json'), JSON.stringify({
    session: key, who: who, at: at, bytes: 5, sha256: {}, logs: { 'launcher.log': 'hello' }
  }));
}
logSet('old0000000000001', '501', NOW - 400 * DAY);
logSet('kept000000000002', '502', NOW - 400 * DAY);
logSet('new0000000000004', '504', NOW - DAY);

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
let PORT = 0;
function ask(where) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port: PORT, method: 'GET', path: where,
                               headers: { cookie: adminCookie() }, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { }
        done({ status: res.statusCode, json: json });
      });
    });
    req.on('error', () => done({ status: 0, json: null }));
    req.end();
  });
}
const keys = () => {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(SESSIONS, 'utf8')); } catch (e) { }
  return (Array.isArray(list) ? list : []).map((r) => r && r.session);
};
const hasLogs = (key) => fs.existsSync(path.join(SLOGS, key + '.json'));

function grab(name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  return '';
}

(async () => {
  PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1',
                                          THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  let out = '';
  srv.stdout.on('data', (d) => { out += d; });
  srv.stderr.on('data', (d) => { out += d; });
  try {
    let up = false;
    /* Up once the site says ready or NOT READY: it says that right after its
       first retention sweep, in the same callback, so the sweep's files are
       all written by then however busy the machine is (#4082). The minute
       only bounds a site that never comes up. */
    for (let i = 0; i < 1200 && !up; i++) {
      if (/\[thornswood-docs\] (ready|NOT READY): /.test(out)) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);

    const k = keys();
    yes('with no session ending, a row 400 days old is gone from sessions.json', k.indexOf('old0000000000001') < 0);
    yes('  and its log set is gone too', !hasLogs('old0000000000001'));
    yes('a row with only an end, 380 days ago, is gone as well', k.indexOf('endonly000000003') < 0);
    yes('a row 400 days old marked kept stays', k.indexOf('kept000000000002') >= 0);
    yes('  and so does its log set', hasLogs('kept000000000002'));
    yes('a row from yesterday stays, with its log set',
        k.indexOf('new0000000000004') >= 0 && hasLogs('new0000000000004'));
    yes('a session still open stays', k.indexOf('open000000000006') >= 0);
    yes('a row with no time at all is kept rather than guessed at', k.indexOf('notime0000000005') >= 0);

    // Put an old row back behind the sweep's back: the hub must still not show it.
    const now = JSON.parse(fs.readFileSync(SESSIONS, 'utf8'));
    now.push({ session: 'late000000000007', who: '507', start: NOW - 500 * DAY, end: NOW - 500 * DAY, channel: 'main' });
    fs.writeFileSync(SESSIONS, JSON.stringify(now, null, 2));
    const r = await ask('/api/all');
    const shown = r.json && Array.isArray(r.json.sessions) ? r.json.sessions.map((x) => x && x.session) : [];
    yes('the hub never shows a row past the window, even before the next sweep (' + r.status + ')',
        r.status === 200 && shown.indexOf('late000000000007') < 0 && shown.indexOf('new0000000000004') >= 0);
  } catch (err) {
    fail++;
    console.log('FAIL  the harness itself threw: ' + (err && err.stack ? err.stack : err));
  }
  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });

  // The count, with the function lifted out of the same server.js.
  const fresh = grab('freshSessions');
  yes('server.js has freshSessions, the one rule for which rows stay', !!fresh);
  if (fresh) {
    const SESSIONS_KEEP = 2000, SESSIONS_DAYS = 365;
    let freshSessions;
    eval(fresh.replace(/^function freshSessions/, 'freshSessions = function'));
    const many = [{ session: 'keptfirst0000000', who: '1', start: NOW - 10 * DAY, end: NOW - 10 * DAY, keep: true }];
    for (let i = 0; i < 2005; i++) many.push({ session: 'row' + i, who: '2', start: NOW - DAY + i, end: NOW - DAY + i });
    const left = freshSessions(many, NOW);
    yes('past the 2000-row bound the file holds 2000 rows', left.length === SESSIONS_KEEP, 'held ' + left.length);
    yes('  and a kept row is never pushed out by the count', left.some((x) => x.session === 'keptfirst0000000'));
    yes('  the oldest unkept rows went first', !left.some((x) => x.session === 'row0') && left.some((x) => x.session === 'row2004'));
    yes('the window is 365 days, what the privacy page says', SESSIONS_DAYS === 365 && /const SESSIONS_DAYS = 365;/.test(src));
  }

  yes('the sweep runs on an hourly timer, not only when a session ends',
      /setInterval\(retentionSweep, RETENTION_EVERY_MS\)/.test(src) && /const RETENTION_EVERY_MS = 60 \* 60 \* 1000;/.test(src));
  yes('and once as the site comes up', /\n\s*retentionSweep\(\);\s*\n/.test(src));

  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
