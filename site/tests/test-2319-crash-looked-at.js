'use strict';
/*
  test-2319-crash-looked-at.js

      node .\site\tests\test-2319-crash-looked-at.js

  Issue #2319, the part Patrick decided on 12 Oct: keep each crash snapshot
  until staff mark the crash looked at, at most two. The launcher half (which
  session each snapshot crashed in, and Tidy deleting only looked-at ones or
  the oldest past two) is driven for real by launcher\tests\test-crash-snapshot.ps1.
  This is the site half, against a real copy of site\server.js in a scratch
  folder on a spare port:

    - an admin marks a crashed session looked at (/api/session-looked), and
      the row says who and when; the mark comes off again the same way;
    - a session that did not crash cannot be marked;
    - nobody signed out can mark anything;
    - the launcher's check in (/api/play/join) sends the sessions of the
      snapshots it holds and is told which of those are looked at, only ever
      for its own account's sessions, at most eight asked;
    - a check in that sends none is told none;
  and in hub.js, the button, the filter and the pill on the sessions page.

  Made-up ids and names only. Nothing leaves the machine and the scratch
  folder is removed at the end.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site', 'server.js');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_D = '222222222', MINE_D = '333333333', OTHER_D = '444444444';
const id = (c) => c.repeat(32);
const CRASH_A = id('a'), CRASH_B = id('b'), QUIET = id('c'), OTHERS = id('d');

function sign(v) { return crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32); }
function ticketFor(d) {
  const body = Buffer.from(JSON.stringify({ d: d, n: 'name-' + d, x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + body + '.' + sign('ticket:' + body);
}
function adminCookie() {
  const at = Date.now();
  return 'twa=' + encodeURIComponent(ADMIN_D + '|Admin|' + at + '|' + sign(ADMIN_D + '|Admin|' + at));
}

function scratch() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-2319-'));
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'session-logs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
    botKey: crypto.randomBytes(16).toString('hex'), admins: [ADMIN_D], secret: SECRET,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
    [MINE_D]: { id: MINE_D, name: 'Mine', profiles: [2002] },
    [OTHER_D]: { id: OTHER_D, name: 'Other', profiles: [3003] }
  }));
  const now = Date.now();
  const crash = { trouble: 'the game crashed, and its crash log is empty', troubleAt: 'bad', troubleFile: 'crash.log',
                  troubleLine: 'Sent by the launcher: this session crashed.', troubleRules: 3 };
  fs.writeFileSync(path.join(dir, 'data', 'sessions.json'), JSON.stringify([
    Object.assign({ session: CRASH_A, who: MINE_D, profile: 2002, start: now - 7200000, end: now - 6000000, channel: 'dev' }, crash),
    Object.assign({ session: CRASH_B, who: MINE_D, profile: 2002, start: now - 5000000, end: now - 4000000, channel: 'dev',
                    looked: true, lookedBy: 'Staff', lookedAt: now - 3000000 }, crash),
    { session: QUIET, who: MINE_D, profile: 2002, start: now - 3000000, end: now - 2000000, channel: 'dev', troubleRules: 3 },
    Object.assign({ session: OTHERS, who: OTHER_D, profile: 3003, start: now - 3000000, end: now - 2000000, channel: 'dev',
                    looked: true, lookedBy: 'Staff', lookedAt: now - 1000000 }, crash)
  ], null, 2));
  return dir;
}

function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method, path: where, agent: false,
      headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, headers || {}) },
    (res) => { let buf = ''; res.on('data', (d) => { buf += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { } ok({ status: res.statusCode, j }); }); });
    r.on('error', () => ok({ status: 0, j: null }));
    r.end(data);
  });
}
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) end(null); };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error('the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) bad(err); else ok();
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}

(async function main() {
  const dir = scratch();
  const SESSIONS = path.join(dir, 'data', 'sessions.json');
  const rowOf = (key) => { try { return JSON.parse(fs.readFileSync(SESSIONS, 'utf8')).filter((r) => r.session === key)[0] || null; } catch (e) { return null; } };
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  let up = false;
  try { await listening(srv, port); up = true; } catch (e) { console.log(e.message); }
  try {
    yes('the scratch site starts', up);
    if (!up) return;
    const A = { cookie: adminCookie(), origin: 'http://127.0.0.1:' + port };
    const mark = (session, who, looked, headers) => request(port, 'PUT', '/api/session-looked', headers === undefined ? A : headers, { session, who, looked });
    const join = (d, snapshots) => request(port, 'POST', '/api/play/join', {},
      Object.assign({ ticket: ticketFor(d), profileId: 2002, channel: 'main' }, snapshots === undefined ? {} : { snapshots }));

    console.log('\nthe check in:');
    let r = await join(MINE_D, [CRASH_A, CRASH_B, QUIET, OTHERS].join(','));
    yes('a check in holding snapshots is let in as before', r.status === 200 && r.j && r.j.ok === true, JSON.stringify(r));
    yes('  and told which of its crashes are looked at: only the one marked', r.j && r.j.lookedAt === CRASH_B, JSON.stringify(r.j));
    yes('  never another account\'s crash, even one marked', r.j && String(r.j.lookedAt).indexOf(OTHERS) < 0);
    r = await join(MINE_D);
    yes('a check in holding none is told none', r.status === 200 && r.j && r.j.lookedAt === '', JSON.stringify(r.j));
    r = await join(MINE_D, [id('1'), id('2'), id('3'), id('4'), id('5'), id('6'), id('7'), id('8'), CRASH_B].join(','));
    yes('at most eight are asked about', r.status === 200 && r.j && r.j.lookedAt === '', JSON.stringify(r.j));
    r = await join(MINE_D, CRASH_B + ',../../x,' + CRASH_B);
    yes('an id that is not one is ignored, and one asked twice is answered once', r.j && r.j.lookedAt === CRASH_B, JSON.stringify(r.j));

    console.log('\nthe mark:');
    r = await mark(CRASH_A, MINE_D, true, {});
    yes('nobody signed in cannot mark a crash', r.status === 401 && rowOf(CRASH_A) && !rowOf(CRASH_A).looked);
    r = await mark(CRASH_A, MINE_D, true);
    const a = rowOf(CRASH_A);
    yes('an admin marks a crash looked at', r.status === 200 && r.j.ok === true && r.j.looked === true, JSON.stringify(r));
    yes('  and the row says who and when', a && a.looked === true && a.lookedBy === 'Admin' && a.lookedAt > 0 && r.j.lookedBy === 'Admin');
    yes('  and the rest of the row is left as it was', a && a.trouble === 'the game crashed, and its crash log is empty' && a.troubleFile === 'crash.log');
    r = await join(MINE_D, [CRASH_A, CRASH_B].join(','));
    yes('the next check in is told both', r.j && r.j.lookedAt === CRASH_A + ',' + CRASH_B, JSON.stringify(r.j));
    r = await mark(CRASH_B, MINE_D, false);
    const b = rowOf(CRASH_B);
    yes('the mark comes off again', r.status === 200 && r.j.looked === false && b && !b.looked && !('lookedBy' in b) && !('lookedAt' in b));
    r = await join(MINE_D, [CRASH_A, CRASH_B].join(','));
    yes('  and the next check in is told only the one still marked', r.j && r.j.lookedAt === CRASH_A, JSON.stringify(r.j));
    r = await mark(QUIET, MINE_D, true);
    yes('a session that did not crash cannot be marked', r.status === 400 && r.j && r.j.error === 'not a crash' && !rowOf(QUIET).looked);
    r = await mark(CRASH_A, OTHER_D, false);
    yes('a session is found by its id and the account it belongs to', r.status === 404 && rowOf(CRASH_A).looked === true);

    console.log('\nthe sessions page:');
    const hub = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.js'), 'utf8');
    yes('a crash has a button to mark it looked at, and to take the mark off',
        /row\.troubleFile === 'crash\.log'/.test(hub) && /Mark this crash looked at/.test(hub) && /Looked at, take the mark off/.test(hub));
    yes('  which saves through /api/session-looked', /api\('\/api\/session-looked', \{\s*method: 'PUT'/.test(hub) &&
        /JSON\.stringify\(\{ session: b\.dataset\.s, who: b\.dataset\.w, looked: on \}\)/.test(hub));
    yes('  says what the mark does to the snapshot', /keeps this ' \+\s*'crash\\'s snapshot until it is marked looked at here, two at most/.test(hub));
    yes('a filter for crashes nobody has looked at', /\['unlooked','Crashes nobody has looked at'\]/.test(hub) &&
        /show === 'unlooked' && !\(s\.troubleFile === 'crash\.log' && !s\.looked\)/.test(hub));
    yes('a looked-at crash says so in the list', /s\.troubleFile === 'crash\.log' && s\.looked \? ' <span class="pill pass">looked at<\/span>'/.test(hub));
  } finally {
    srv.kill();
    await new Promise((ok) => { if (srv.exitCode !== null) ok(); else srv.once('close', ok); });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
  }
})();
