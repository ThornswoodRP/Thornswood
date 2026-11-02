/*
  test-2180-site-state.js

      node .\site\tests\test-2180-site-state.js

  Issue #2180, the site slice. jsonFile() hands back its fallback for a file
  that is there and will not parse. pk.json read that way said nobody was
  dead for good, and pk.json, linked.json, sessions.json and signins.json
  were each written straight back as the empty fallback plus one row at the
  next PK, Play, session or sign-in, so every row the broken file held was
  gone. The real site\server.js runs from a scratch copy on a spare loopback
  port, as test-bans-broken.js runs it for bans.json:

    1. All five read: the start log says ready, /api/ready answers 200, the
       door lists the linked characters and the join pass gives a pass.
    2. pk.json cut short: /api/ready answers 503 naming it, the door lets
       nobody through and says why, the join pass and the check in refuse, a
       PK from the game is refused, and the file is left byte for byte.
    3. linked.json cut short: the same, and the check in, which used to
       write the caller's row over everybody's, writes nothing.
    4. sessions.json and signins.json that are not lists: /api/ready names
       them without shutting play, and a session that ends writes nothing
       over sessions.json.
    5. Repaired: everything reads again, the log says so, the door opens.
    6. A site started with a broken file says NOT READY on its log.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP when it
  is set.
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
fs.mkdirSync(TEMP, { recursive: true });
const KEY = crypto.randomBytes(24).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const PASSKEY = crypto.randomBytes(32).toString('hex');
const STAFF_D = '222222222', BJORN_D = '333333333';
const LINKED_OK = JSON.stringify({
  [STAFF_D]: { id: STAFF_D, name: 'Aela', profiles: [1001] },
  [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002] }
});

function scratch() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-2180-state-'));
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
    botKey: KEY, admins: [STAFF_D], secret: SECRET, passKey: PASSKEY,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  // The launcher feed the join pass holds a launcher's version to, as the
  // feed's first generation (#2727).
  fs.mkdirSync(path.join(dir, 'feed', 'version'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'feed', 'version', '00000001.json'), JSON.stringify({ launcherVersion: '1.1.200', minLauncher: '1.1.200' }));
  fs.writeFileSync(path.join(dir, 'data', 'linked.json'), LINKED_OK);
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
function sign(v) { return crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32); }
/* The launcher's Discord ticket, made the way the site makes it. */
function ticketFor(d) {
  const body = Buffer.from(JSON.stringify({ d: d, n: 'name-' + d, x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + body + '.' + sign('ticket:' + body);
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
async function start(dir) {
  const port = await freePort();
  const run = { port, log: '', site: null, up: false };
  const srv = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  run.site = srv;
  srv.stdout.on('data', (d) => { run.log += d; });
  srv.stderr.on('data', (d) => { run.log += d; });
  try { await listening(srv, port); run.up = true; } catch (e) { run.log += '\n' + e.message; }
  return run;
}
async function stop(run, dir) {
  run.site.kill();
  await new Promise((ok) => { if (run.site.exitCode !== null) ok(); else run.site.once('close', ok); });
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}
/* What the site has written to its own site.log (#3060). Every console line
   goes there with appendFileSync before the site goes on, so a line said
   while answering a request is in the file before the answer leaves, and
   the start log, said in the listen callback, is in it before any request
   is answered. The pipe is not: measured 21 Oct, the answer to /api/ready
   came in before the pipe's "reads again" line 1 time in 500 alone and 223
   in 2,000 with four at once (0.2 to 5 ms behind), while site.log held the
   line every time. So a check of what the site said reads this, after an
   answer, and run.log is only printed when something fails. */
function siteSaid(dir) {
  try { return fs.readFileSync(path.join(dir, 'site.log'), 'utf8'); } catch (e) { return ''; }
}

(async function main() {
  const dir = scratch();
  const DATA = path.join(dir, 'data');
  const PK = path.join(DATA, 'pk.json'), LINKED = path.join(DATA, 'linked.json');
  const SESSIONS = path.join(DATA, 'sessions.json'), SIGNINS = path.join(DATA, 'signins.json');
  const run = await start(dir);
  const port = run.port;
  try {
    yes('the scratch site starts', run.up);
    const K = { 'X-Thornswood-Key': KEY };
    const allowed = () => request(port, 'GET', '/api/allowed', K);
    const ready = () => request(port, 'GET', '/api/ready');
    const passFor = (d, pid) => request(port, 'POST', '/api/play/pass', {},
      { ticket: ticketFor(d), profileId: pid, channel: 'main', version: '1.1.200' });
    const join = (d, pid) => request(port, 'POST', '/api/play/join', {}, { ticket: ticketFor(d), profileId: pid });
    const pk = (body) => request(port, 'POST', '/api/staff/game/pk', K, Object.assign({ byProfileId: 1001, byName: 'Aela' }, body));

    // ------------------------------------------------------- 1. all read --
    console.log('\nall five read:');
    let r = await ready();
    yes('/api/ready answers 200 with nothing broken', r.status === 200 && r.j && r.j.ok === true && r.j.broken.length === 0);
    yes('the start log says the state is ready', /\[thornswood-docs\] ready: bans, pk, linked, sessions and signins read/.test(siteSaid(dir)));
    r = await allowed();
    yes('the door lists the linked characters', r.status === 200 && r.j.profiles.indexOf(2002) >= 0 && !r.j.stateBroken);
    r = await passFor(BJORN_D, 2002);
    yes('and the join pass gives Bjorn a pass', r.status === 200 && !!r.j.pass);

    // --------------------------------------------------- 2. pk.json broken --
    console.log('\npk.json cut short:');
    const pkBroken = '{"2002": {"why": "fell at the siege", "na';
    fs.writeFileSync(PK, pkBroken);
    r = await ready();
    yes('/api/ready answers 503 naming pk.json, and that it shuts play',
        r.status === 503 && r.j && r.j.ok === false && r.j.broken.length === 1 &&
        r.j.broken[0].file === 'pk.json' && r.j.broken[0].why === 'will not parse' && r.j.broken[0].play === true);
    yes('  and nothing of what the file holds', JSON.stringify(r.j).indexOf('siege') < 0);
    yes('  and the site log says STATE BROKEN for it', /STATE BROKEN: \S*pk\.json will not parse\. Nobody is let in to play/.test(siteSaid(dir)));
    r = await allowed();
    yes('the door lets nobody through', r.status === 200 && r.j.profiles.length === 0 && r.j.people.length === 0);
    yes('  and says why, by file', r.j.stateBroken === 'pk.json will not parse' && !r.j.bansBroken);
    r = await passFor(BJORN_D, 2002);
    yes('the join pass refuses, saying the site cannot read its list of characters',
        r.status === 503 && r.j.why === 'state broken' && !r.j.pass && /cannot read its list of characters/.test(r.j.message));
    r = await pk({ profileId: 2002, name: 'Bjorn Iron-Hand', why: 'executed' });
    yes('a PK from the game is not written over it', r.status !== 200);
    yes('  and pk.json is left byte for byte', fs.readFileSync(PK, 'utf8') === pkBroken);
    fs.writeFileSync(PK, '[]');
    r = await ready();
    yes('a pk.json that is a list, not a table, is broken too', r.status === 503 && r.j.broken[0].why === 'is not a table');
    fs.unlinkSync(PK);

    // ----------------------------------------------- 3. linked.json broken --
    console.log('\nlinked.json cut short:');
    const linkedBroken = LINKED_OK.slice(0, 60);
    fs.writeFileSync(LINKED, linkedBroken);
    r = await ready();
    yes('/api/ready answers 503 naming linked.json', r.status === 503 && r.j.broken.length === 1 && r.j.broken[0].file === 'linked.json');
    r = await allowed();
    yes('the door lets nobody through, and says why', r.status === 200 && r.j.profiles.length === 0 && /^linked\.json /.test(r.j.stateBroken || ''));
    r = await passFor(BJORN_D, 2002);
    yes('the join pass refuses', r.status === 503 && r.j.why === 'state broken' && !r.j.pass);
    r = await join(BJORN_D, 2002);
    yes('the check in at Play refuses rather than saying yes to a door that would turn it away',
        r.status === 503 && r.j.ok === false && r.j.why === 'not recorded');
    yes('  and writes nothing over linked.json, so Aela\'s row is still there to repair', fs.readFileSync(LINKED, 'utf8') === linkedBroken);
    fs.writeFileSync(LINKED, LINKED_OK);

    // ---------------------------------- 4. sessions.json and signins.json --
    console.log('\nsessions.json and signins.json:');
    fs.writeFileSync(SESSIONS, '{"not": "a list"}');
    fs.writeFileSync(SIGNINS, '[{"at": 1, "id": "3');
    r = await ready();
    const names = (r.j && r.j.broken || []).map((b) => b.file + ':' + b.play).sort().join(',');
    yes('/api/ready names both, and neither shuts play', r.status === 503 && names === 'sessions.json:false,signins.json:false');
    r = await allowed();
    yes('the door still lists the linked characters', r.status === 200 && r.j.profiles.indexOf(2002) >= 0 && !r.j.stateBroken);
    r = await request(port, 'POST', '/api/play/start', {}, { ticket: ticketFor(BJORN_D), session: 'harness-session-1', profileId: 2002, channel: 'main' });
    yes('a session started over a broken sessions.json is refused as not saved', r.status === 500);
    yes('  and writes nothing over it', fs.readFileSync(SESSIONS, 'utf8') === '{"not": "a list"}');
    yes('  and the site log says it is broken, without writing it', /STATE BROKEN: \S*sessions\.json is not a list\. Nothing is written over it/.test(siteSaid(dir)));

    // ----------------------------------------------------- 5. repaired --
    console.log('\nrepaired:');
    fs.writeFileSync(SESSIONS, '[]');
    fs.writeFileSync(SIGNINS, '[]');
    r = await ready();
    yes('/api/ready answers 200 again', r.status === 200 && r.j.ok === true);
    const said = siteSaid(dir);
    yes('  and the log says each reads again', /pk\.json reads again\./.test(said) && /linked\.json reads again\./.test(said) && /sessions\.json reads again\./.test(said));
    r = await passFor(BJORN_D, 2002);
    yes('the join pass gives a pass again', r.status === 200 && !!r.j.pass);
    r = await join(BJORN_D, 2002);
    yes('the check in records again', r.status === 200 && r.j.ok === true);
    r = await request(port, 'POST', '/api/play/start', {}, { ticket: ticketFor(BJORN_D), session: 'harness-session-1', profileId: 2002, channel: 'main' });
    const rows = JSON.parse(fs.readFileSync(SESSIONS, 'utf8'));
    yes('and a session is written again', r.status === 200 && Array.isArray(rows) && rows.length === 1 && rows[0].profile === 2002);
  } finally {
    await stop(run, dir);
  }
  if (fail) console.log('site log:\n' + run.log);

  // ------------------------------------------- 6. started with one broken --
  console.log('\nstarted with linked.json broken:');
  const dir2 = scratch();
  fs.writeFileSync(path.join(dir2, 'data', 'linked.json'), '{');
  const run2 = await start(dir2);
  try {
    yes('the second site starts', run2.up);
    const r2 = await request(run2.port, 'GET', '/api/ready');
    yes('its /api/ready answers 503 naming linked.json', r2.status === 503 && r2.j && r2.j.broken.length === 1 && r2.j.broken[0].file === 'linked.json');
    const said2 = siteSaid(dir2);
    yes('and its start log says NOT READY, naming linked.json', /NOT READY: linked\.json will not read, \/api\/ready answers 503/.test(said2));
    yes('  after saying STATE BROKEN for it', /STATE BROKEN: \S*linked\.json will not parse[\s\S]*NOT READY: linked\.json/.test(said2));
  } finally {
    await stop(run2, dir2);
  }
  if (fail) console.log('second site log:\n' + run2.log);
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
