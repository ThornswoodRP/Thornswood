'use strict';
/*
  test-2185-site-bind.js

      node .\tests\test-2185-site-bind.js
      node .\tests\test-2185-site-bind.js <an older server.js>

  #2185: site\server.js listened on 0.0.0.0 unless THORNSWOOD_DOCS_LOCAL=1
  was set, so on any box where it was not, port 3001 was a plain HTTP way
  past Caddy's certificate, sign-ins and cookies included. Loopback is the
  default now; a plain listener on every address takes
  THORNSWOOD_DOCS_EXPOSE=1 and warns at every start. Deploy-Docs opens the
  firewall for 3001 only on a box that set EXPOSE, and says EXPOSED when the
  running site listens anywhere but loopback without it.

  Live, against copies of the site on spare ports: started with no setting,
  with EXPOSE=1, and with EXPOSE=1 beside LOCAL=1, each asked on 127.0.0.1
  and on this machine's own non-loopback address. Scratch folder removed at
  the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const SITE_SRC = process.argv[2] || path.join(__dirname, '..', 'site', 'server.js');
const DEPLOY = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'deploy', 'Deploy-Docs.ps1'), 'utf8');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2185-'));
siteFiles.copy(dir, SITE_SRC);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
  botKey: crypto.randomBytes(24).toString('hex'), admins: [], secret: crypto.randomBytes(32).toString('hex'),
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));

// This machine's own address that is not loopback: what a stranger would dial.
function outside() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) { if (a.family === 'IPv4' && !a.internal) { return a.address; } }
  }
  return '';
}
function freePort() {
  return new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
}
function answers(host, port) {
  return new Promise((done) => {
    const r = http.get({ host: host, port: port, path: '/' }, (res) => { res.resume(); done(res.statusCode); });
    r.on('error', () => done(0));
    r.setTimeout(3000, () => r.destroy(new Error('timed out')));
  });
}
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const end = (e) => { clearTimeout(late); srv.stdout.removeListener('data', said); srv.removeListener('close', gone); if (e) { bad(e); } else { ok(out); } };
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on (\S+):(\d+)[^\n]*\n([^\n]*\n)?/.exec(out); if (m && Number(m[2]) === port && m[3] !== undefined) { end(); } };
    const gone = (c) => end(new Error('site stopped ' + c + ' before it was listening:\n' + out));
    const late = setTimeout(() => end(new Error('site did not say it was listening on ' + port + ':\n' + out)), 15000);
    srv.stdout.on('data', said);
    srv.on('close', gone);
  });
}
async function run(env) {
  const port = await freePort();
  const e = Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port) });
  delete e.THORNSWOOD_DOCS_LOCAL; delete e.THORNSWOOD_DOCS_EXPOSE;
  Object.assign(e, env);
  const srv = spawn(process.execPath, ['server.js'], { cwd: dir, env: e });
  srv.stderr.on('data', () => { });
  try {
    const out = await listening(srv, port);
    const bind = (/listening on (\S+):/.exec(out) || [])[1] || '';
    const home = await answers('127.0.0.1', port);
    const far = OUT ? await answers(OUT, port) : -1;
    return { out: out, bind: bind, home: home, far: far };
  } finally { srv.kill(); await new Promise((ok) => { if (srv.exitCode !== null) { ok(); } else { srv.on('close', ok); } }); }
}

const OUT = outside();
(async () => {
  try {
    console.log('THE SITE ITSELF (other address: ' + (OUT || 'none on this machine') + ')');
    let r = await run({});
    yes('1a: with no setting it listens on loopback: ' + r.bind, r.bind === '127.0.0.1');
    yes('1b: and answers HTTP there: ' + r.home, r.home > 0);
    if (OUT) { yes('1c: and not on this machine\'s own address: ' + r.far, r.far === 0); }
    yes('1d: and says no warning', !/WARNING/.test(r.out));

    r = await run({ THORNSWOOD_DOCS_EXPOSE: '1' });
    yes('2a: THORNSWOOD_DOCS_EXPOSE=1 listens on every address: ' + r.bind, r.bind === '0.0.0.0');
    if (OUT) { yes('2b: so it answers on this machine\'s own address: ' + r.far, r.far > 0); }
    yes('2c: and warns at the start that it is plain HTTP on every address', /WARNING: plain HTTP on every address/.test(r.out));

    r = await run({ THORNSWOOD_DOCS_EXPOSE: '1', THORNSWOOD_DOCS_LOCAL: '1' });
    yes('3a: THORNSWOOD_DOCS_LOCAL=1 wins over EXPOSE: ' + r.bind, r.bind === '127.0.0.1' && !/WARNING/.test(r.out));
    r = await run({ THORNSWOOD_DOCS_EXPOSE: 'yes' });
    yes('3b: only EXPOSE=1 exposes it, not any value: ' + r.bind, r.bind === '127.0.0.1');

    console.log('DEPLOY-DOCS');
    const fw = DEPLOY.slice(DEPLOY.indexOf("`$local = [Environment]::GetEnvironmentVariable('THORNSWOOD_DOCS_LOCAL','Machine')"));
    yes('4a: the firewall rule is torn down unless the box set EXPOSE=1',
      /if \(`\$local -eq '1' -or `\$expose -ne '1'\) \{\s*if \(`\$fwHas\) \{ Remove-NetFirewallRule -PolicyStore localhost /.test(fw) &&
      /`\$fwHas = \[bool\]\(Get-NetFirewallRule -PolicyStore localhost /.test(DEPLOY));
    yes('4b: and opened only in the branch after that', fw.indexOf('New-NetFirewallRule') > fw.indexOf("`$expose -ne '1'"));
    yes('4c: after the swap it says EXPOSED when the site listens anywhere but loopback without EXPOSE',
      /\$open = @\(\$l \| Where-Object \{ \$_\.LocalAddress -notmatch '\^\(127\\\.\|::1\$\)' \}/.test(DEPLOY) && /'EXPOSED: the site listens on '/.test(DEPLOY));
  } catch (e) {
    fail++; console.log('FAIL  ' + (e && e.message));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
