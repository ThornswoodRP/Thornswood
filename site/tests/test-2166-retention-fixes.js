'use strict';
/*
  test-2166-retention-fixes.js

      node .\site\tests\test-2166-retention-fixes.js

  Issue #2166 (Herald's matrix, 17 Oct): three places where the code kept less
  than site/data/site/privacy.md already promises, fixed without changing a
  word of the page or any window.

    G3  trouble.json (the failed-session alerts for the bot) copies a session
        record and a launcher log line, and was kept by count only. It now
        ages by the same 365 days in the hourly retention sweep, and an alert
        for a session staff marked kept stays.
    G2  the voice service's chat prune ran every six hours, hourly only while
        a day was overdue; the page says the check is hourly. It now runs
        every hour (held by voice\tests\test-chat-log.js, which lifts chatPrune).
    G4  a Discord sign-in set the member cookie tw for a year, which the page
        describes as the fallback for a site with no Discord. It is now
        cleared there instead (site\tests\test-site-oauth-gaps.js checks the
        answer itself).

  G3 runs against a real copy of site\server.js in a scratch folder on a spare
  port, with no session ending. Nothing leaves the machine and the scratch
  folders are removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE_SRC = path.join(ROOT, 'site', 'server.js');
const site = siteFiles.source(SITE_SRC);

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
function grab(src, name) {
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
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

const DAY = 86400000;
const NOW = Date.now();

async function trouble() {
  console.log('G3  TROUBLE.JSON AGES WITH THE SESSION IT IS ABOUT');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2166-'));
  siteFiles.copy(dir, SITE_SRC);
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'for-bot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
    botKey: crypto.randomBytes(16).toString('hex'),
    admins: ['111111111111111111'],
    secret: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1,
    onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  // Synthetic only: made-up ids and names.
  fs.writeFileSync(path.join(dir, 'data', 'sessions.json'), JSON.stringify([
    { session: 'kepttrouble00002', who: '502', start: NOW - 400 * DAY - 3600000, end: NOW - 400 * DAY,
      channel: 'main', keep: true, keptBy: 'Staff', keptAt: NOW - 390 * DAY },
    { session: 'newtrouble000003', who: '503', start: NOW - DAY - 3600000, end: NOW - DAY, channel: 'main' }
  ], null, 2));
  const row = (session, who, start, end, at) => ({ session, who, name: 'Stand-in ' + who, channel: 'main',
    profile: 900000 + Number(who), version: '0.0.0', start, end, at, why: 'a script threw',
    file: 'launcher.log', line: 'stand-in line' });
  const TROUBLE = path.join(dir, 'data', 'for-bot', 'trouble.json');
  fs.writeFileSync(TROUBLE, JSON.stringify([
    row('oldtrouble000001', '501', NOW - 400 * DAY - 3600000, NOW - 400 * DAY, NOW - 400 * DAY),
    row('kepttrouble00002', '502', NOW - 400 * DAY - 3600000, NOW - 400 * DAY, NOW - 400 * DAY),
    row('newtrouble000003', '503', NOW - DAY - 3600000, NOW - DAY, NOW - DAY),
    row('latelogs00000004', '504', NOW - 370 * DAY, NOW - 369 * DAY, NOW - 10 * DAY),
    { session: 'notime0000000005', who: '505', why: 'a script threw' },
    row('gonesess00000006', '506', NOW - 366 * DAY, NOW - 366 * DAY, NOW - 366 * DAY)
  ], null, 2));

  // Sign-ins hold an address and keep 30 days; nobody signs in here, so only
  // the sweep the site runs as it comes up can take the old one out.
  const SIGNINS = path.join(dir, 'data', 'signins.json');
  fs.writeFileSync(SIGNINS, JSON.stringify([
    { at: NOW - DAY, id: '601', handle: 'standin601', outcome: 'allowed', ip: '192.0.2.1' },
    { at: NOW - 31 * DAY, id: '602', handle: 'standin602', outcome: 'allowed', ip: '192.0.2.2' }
  ], null, 2));

  const port = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
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
    let left = [];
    try { left = JSON.parse(fs.readFileSync(TROUBLE, 'utf8')).map((t) => t && t.session); } catch (e) { }
    yes('with no session ending, an alert 400 days old is gone', left.indexOf('oldtrouble000001') < 0, JSON.stringify(left));
    yes('an alert 366 days old is gone too', left.indexOf('gonesess00000006') < 0);
    yes('an alert for a session staff marked kept stays, however old', left.indexOf('kepttrouble00002') >= 0);
    yes('an alert from yesterday stays', left.indexOf('newtrouble000003') >= 0);
    yes('an alert whose logs arrived 10 days ago stays, aged like its log set', left.indexOf('latelogs00000004') >= 0);
    yes('an alert with no time at all is kept rather than guessed at', left.indexOf('notime0000000005') >= 0);
    yes('no retention failure was said', out.indexOf('trouble-retention') < 0, out);
    let ins = [];
    try { ins = JSON.parse(fs.readFileSync(SIGNINS, 'utf8')).map((r) => r && r.id); } catch (e) { }
    yes('with nobody signing in, a sign-in 31 days old is gone and yesterday\'s stays',
        ins.join(',') === '601', JSON.stringify(ins));
    yes('no sign-in retention failure was said', out.indexOf('signin-retention') < 0, out);
  } catch (err) {
    fail++;
    console.log('FAIL  the trouble harness threw: ' + (err && err.stack ? err.stack : err));
  }
  await new Promise((ok) => {
    srv.on('exit', ok);
    try { srv.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }

  const sweep = grab(site, 'retentionSweep');
  yes('the hourly retention sweep runs sweepTrouble', /sweepTrouble\(now\)/.test(sweep));
  yes('and sweepSignIns, which ages by freshSignIns', /sweepSignIns\(now\)/.test(sweep) && /freshSignIns\(rows, now\)/.test(grab(site, 'sweepSignIns')));
  yes('noteTrouble ages the file on the way in as well', /freshTrouble\(all, Date\.now\(\)\)/.test(grab(site, 'noteTrouble')));
  yes('trouble rows use the session window, SESSIONS_DAYS', /SESSIONS_DAYS \* 86400000/.test(grab(site, 'freshTrouble')));

  // The rule on its own, lifted out of the same file.
  const fresh = grab(site, 'freshTrouble');
  if (fresh) {
    const SESSIONS_DAYS = 365;
    let freshTrouble;
    eval(fresh.replace(/^function freshTrouble/, 'freshTrouble = function'));
    const held = new Set(['k1']);
    const got = freshTrouble([
      { session: 'a', start: NOW - 364 * DAY, end: NOW - 364 * DAY, at: NOW - 364 * DAY },
      { session: 'b', start: NOW - 366 * DAY, end: NOW - 366 * DAY, at: NOW - 366 * DAY },
      { session: 'k1', start: NOW - 900 * DAY, end: NOW - 900 * DAY, at: NOW - 900 * DAY },
      null, 'junk'
    ], NOW, held).map((t) => t.session);
    yes('freshTrouble: inside 365 days stays, past it goes, a kept session stays, junk goes',
        got.join(',') === 'a,k1', got.join(','));
  } else yes('server.js has freshTrouble', false);
}

function cookie() {
  console.log('\nG4  A DISCORD SIGN-IN DOES NOT SET THE MEMBER COOKIE');
  const at = site.indexOf('const cookies2 = [');
  const block = at >= 0 ? site.slice(at, site.indexOf('];', at) + 2) : '';
  yes('the Discord callback still sets twa', /setCookie\(req, ADMIN, value, ADMIN_DAYS\)/.test(block));
  yes('it no longer sets tw with the member token', block && !/setCookie\(req, COOKIE/.test(block));
  yes('it clears tw the way sign-out does', /COOKIE \+ '=; Path=\/; Max-Age=0; HttpOnly; SameSite=Lax'/.test(block));
  const sets = site.match(/setCookie\(req, COOKIE, memberToken\(\), 365\)/g) || [];
  yes('the password door is now the only place tw is set', sets.length === 1, 'found ' + sets.length);
}

(async () => {
  await trouble();
  cookie();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
