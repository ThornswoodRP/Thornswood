/*
  test-bans-broken.js

      node .\site\tests\test-bans-broken.js

  Issue #2186: a bans.json that is there but will not parse read as no bans
  at all, so a file cut short by a crash let every banned account in. The
  real site\server.js runs from a scratch copy on a spare loopback port.
  With bans.json missing, the door lists the linked characters as before.
  With it broken, /api/allowed lets nobody through and says why, a ban from
  the hub is refused and the broken file is left exactly as it was, and the
  site says BANS BROKEN on its log. Once the file reads again the door opens
  to those not banned. Nothing leaves this machine.
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
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-bans-broken-'));
const KEY = crypto.randomBytes(24).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const STAFF_D = '222222222', BJORN_D = '333333333';
siteFiles.copy(dir, SITE);
const DATA = path.join(dir, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: KEY, admins: [STAFF_D], secret: SECRET, gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
fs.writeFileSync(path.join(DATA, 'linked.json'), JSON.stringify({
  [STAFF_D]: { id: STAFF_D, name: 'Aela', profiles: [1001] },
  [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002] }
}));
const BANS = path.join(DATA, 'bans.json');

function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? '' : JSON.stringify(body);
    const signed = method !== 'GET' && Object.keys(headers || {}).some((k) => k.toLowerCase() === 'cookie');
    const r = http.request({ host: '127.0.0.1', port, method, path: where,
      headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
                             signed ? { origin: 'http://127.0.0.1:' + port } : {}, headers || {}) },
    (res) => { let buf = ''; res.on('data', (d) => { buf += d; }); res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { } ok({ status: res.statusCode, j }); }); });
    r.on('error', () => ok({ status: 0, j: null }));
    r.end(data);
  });
}
function cookieFor(id, name) {
  const at = String(Date.now());
  const sig = crypto.createHmac('sha256', SECRET).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
}

/* Waits for this run's own "[thornswood-docs] listening on ...:port" line
   (#1727), so nothing is asked of a port something else took in between. */
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}

(async function main() {
  const port = await freePort();
  let log = '';
  const site = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  site.stdout.on('data', (d) => { log += d; });
  site.stderr.on('data', (d) => { log += d; });
  try {
    let up = false;
    try { await listening(site, port); up = true; } catch (e) { log += '\n' + e.message; }
    yes('the scratch site starts', up);
    const K = { 'X-Thornswood-Key': KEY };
    const staffC = { Cookie: cookieFor(STAFF_D, 'Aela') };

    let r = await request(port, 'GET', '/api/allowed', K);
    yes('no bans.json: the door lists the linked characters', r.status === 200 && r.j.profiles.indexOf(2002) >= 0 && !r.j.bansBroken);

    const broken = '{"333333333": {"why": "spamming", "until": 0, "prof';
    fs.writeFileSync(BANS, broken);
    r = await request(port, 'GET', '/api/allowed', K);
    yes('a bans.json cut short: the door lets nobody through', r.status === 200 && Array.isArray(r.j.profiles) && r.j.profiles.length === 0);
    yes('  and says the ban list is broken', !!r.j && r.j.bansBroken === true);
    // Read from site.log, which the site writes before it answers; the pipe
    // can bring the line in after the answer (#3060, test-2180-site-state.js).
    let said = '';
    try { said = fs.readFileSync(path.join(dir, 'site.log'), 'utf8'); } catch (e) { }
    yes('  and the site log says BANS BROKEN', /BANS BROKEN/.test(said));
    r = await request(port, 'POST', '/api/staff/ban', staffC, { id: BJORN_D, minutes: 60, why: 'testing' });
    yes('a ban from the hub is not taken over a broken file', r.status !== 200);
    yes('  and the broken file is left exactly as it was', fs.readFileSync(BANS, 'utf8') === broken);

    fs.writeFileSync(BANS, '[]');
    r = await request(port, 'GET', '/api/allowed', K);
    yes('a bans.json that is not a table also lets nobody through', r.status === 200 && r.j.profiles.length === 0 && r.j.bansBroken === true);

    fs.writeFileSync(BANS, JSON.stringify({ [BJORN_D]: { why: 'spamming', until: 0, profiles: [2002] } }));
    r = await request(port, 'GET', '/api/allowed', K);
    yes('repaired: the door opens again to those not banned', r.status === 200 && r.j.profiles.indexOf(1001) >= 0 && !r.j.bansBroken);
    yes('  and the banned character stays out', r.j.profiles.indexOf(2002) < 0);
  } finally {
    site.kill();
    await new Promise((ok) => { if (site.exitCode !== null) ok(); else site.once('close', ok); });
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  if (fail) console.log('site log:\n' + log);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();