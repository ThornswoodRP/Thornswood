// test-1703-test-ports.js
//
//     node tests\test-1703-test-ports.js
//
// #1703. Since #1690 the VPS runs several "Launcher builds" jobs at once, and
// they share one 127.0.0.1. Harnesses started the voice service on fixed
// ports (7931 in test-deploy-records.js and test-staff-commands.js, 7911 and
// 7912 in test-command-ack.js, 7901 to 7921 in voice\), so one run's /health
// was answered by another run's service: on 5 Oct, twice, a run read "deploy"
// off the other run's copy, the one with a record beside it, or found the
// port held and got nothing.
//
// Now each harness asks the system for a port nothing holds, starts the
// service on it, and asks nothing of it until that service has said
// "[voice] listening on ...:port" itself. If the service stops first, the
// port was taken in between, and the harness fails saying so.
//
// This checks:
//   1. no .js harness in tests\ or voice\ gives a service a fixed port, by
//      environment or by listen();
//   2. every harness that starts voice-server.js waits for its own line, and
//      that wait, lifted out of each one, refuses a port somebody else holds
//      and takes one the service does hold;
//   3. three copies of test-deploy-records.js started at the same moment all
//      pass, which is what failed on the VPS. Before the change, two copies
//      at once failed in three runs of six on one machine.
//
// #1727, the same for the site. Twelve harnesses took a port from the system,
// let it go, started site\server.js on it and polled the port until
// something answered, so in that moment another run could take the port and
// answer as their site. This also checks:
//   4. every harness that starts server.js waits for its own site's line
//      before asking the port anything, and none polls the port to find out;
//   5. the wait in each of the twelve, lifted out, refuses a port somebody
//      else holds and takes one its site does hold;
//   6. three copies of test-staff-bans.js started at the same moment all pass.
//
// #1755, the same for the five PowerShell harnesses that start the site
// (test-feed-store, test-record-sync, test-release-baseline, test-scrub-feed,
// test-site-assets). Each read the child's output away with ReadToEndAsync()
// and polled the port. This also checks:
//   7. every .ps1 harness that starts server.js has Wait-OwnLine, waits on the
//      site's own line with it, and neither polls the port nor drains the
//      site's output before that line; the GitHub stand-in and the game
//      server stand-in say their own line and are waited on the same way;
//   8. Wait-OwnLine, lifted out of each and run in pwsh, refuses a port
//      somebody else holds and takes one its site does hold.
//
// #1816, the port the site checks for the game. The site calls the game up
// when a connect to cfg.gameCheckPort succeeds (pollGame in server.js), and
// seven site harnesses handed it a port they took from the system and let
// go, so another run that took the port made the game read as up. This also
// checks:
//   9. every harness that starts the site and sets its gameCheckPort sets it
//      to 1, which the system never hands out for a listen on 0 and which no
//      harness listens on (1. above), so no run can take it.
//
// HARNESS_ROOT points it at another copy of the repository, which is how it
// was shown to fail on the harnesses before the change.
//
// Writes only to temp folders.
const REPO_DIR = process.env.HARNESS_ROOT || require('path').join(__dirname, '..');
const fs = require('fs');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');
const CR = String.fromCharCode(13);
const read = (p) => fs.readFileSync(p, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the harnesses
const files = [];
// And each product's own tests folder, beside its code (plan line 42).
const beside = fs.readdirSync(REPO_DIR, { withFileTypes: true })
  .filter(d => d.isDirectory() && d.name !== 'tests' && d.name !== 'node_modules' && fs.existsSync(path.join(REPO_DIR, d.name, 'tests')))
  .map(d => d.name + '/tests').sort();
for (const dir of ['tests'].concat(beside)) {
  for (const n of fs.readdirSync(path.join(REPO_DIR, dir)).sort()) {
    if (/^test-.*\.js$/.test(n)) { files.push(dir + '/' + n); }
  }
}
const text = {};
for (const f of files) { text[f] = read(path.join(REPO_DIR, f)); }

/*
  A value is fixed when it is a number other than 0, or a name the file sets
  to one (const PORT = 7931). The port reaches a service two ways: an
  environment entry whose name ends in _PORT (THORNSWOOD_VOICE_PORT,
  THORNSWOOD_DOCS_PORT, FAKE_DISCORD_PORT), or listen() in this process.
*/
function fixed(src, expr) {
  let v = String(expr).trim();
  const s = /^String\(\s*([\w$.]+)\s*\)$/.exec(v);
  if (s) { v = s[1]; }
  v = v.replace(/^['"]|['"]$/g, '');
  if (/^\d+$/.test(v)) { return Number(v) !== 0; }
  if (!/^[A-Za-z_$][\w$]*$/.test(v)) { return false; }
  return new RegExp('\\b(?:const|let|var)\\s+' + v + '\\s*=\\s*[\'"]?[1-9]\\d*\\b').test(src);
}
const hits = [];
for (const f of files) {
  const src = text[f];
  let m;
  const env = /\b([A-Z][A-Z0-9_]*_PORT)\s*:\s*([^,}\n]+)/g;
  while ((m = env.exec(src))) {
    if (fixed(src, m[2])) { hits.push(f + ': ' + m[1] + ' is ' + m[2].trim()); }
  }
  const lis = /\.listen\(\s*([^,)\n]+)/g;
  while ((m = lis.exec(src))) {
    if (fixed(src, m[1])) { hits.push(f + ': listen(' + m[1].trim() + ')'); }
  }
}
console.log('fixed ports:');
yes('the scan reads the harnesses (' + files.length + ')', files.length > 250);
yes('and finds the services they start (' +
    files.filter((f) => /_PORT\s*:/.test(text[f]) || /\.listen\(/.test(text[f])).length + ' that start one)',
    files.filter((f) => /_PORT\s*:/.test(text[f]) || /\.listen\(/.test(text[f])).length >= 30);
// The scan itself, on the lines this issue took out.
yes('it would have caught const PORT = 7931 handed over as THORNSWOOD_VOICE_PORT',
    fixed('const PORT = 7931;\n', 'String(PORT)'));
yes('and listen(FAKE) with const FAKE = 7912', fixed('const FAKE = 7912;\n', 'FAKE'));
yes('and leaves a port the system named alone', !fixed('let PORT = 0;\nPORT = await freePort();\n', 'String(PORT)') &&
    !fixed('', '0') && !fixed('const port = await freePort();\n', 'String(port)'));
yes('no harness gives a service a fixed port' + (hits.length ? ': ' + hits.join('; ') : ''), hits.length === 0);

// ------------------------------------------------- the voice service's own word
const SELF = 'tests/' + path.basename(__filename);
const starters = files.filter((f) => f !== SELF && /spawn\(/.test(text[f]) && /'voice-server\.js'/.test(text[f]));
console.log('\nthe harnesses that start the voice service (' + starters.length + '):');
yes('there are the twelve this issue found, and test-local-chat.js',
    ['voice/tests/test-command-ack.js', 'tests/test-deploy-records.js', 'tests/test-staff-commands.js',
     'voice/tests/test-auth.js', 'voice/tests/test-backpressure.js', 'voice/tests/test-chat-limit.js', 'voice/tests/test-cull.js',
     'voice/tests/test-ice.js', 'voice/tests/test-keepalive.js', 'voice/tests/test-line-close.js', 'voice/tests/test-local-chat.js',
     'voice/tests/test-moved.js', 'voice/tests/test-turn-key.js'].every((f) => starters.indexOf(f) >= 0));
function lift(src) {
  const a = src.indexOf('function listening(srv, port) {');
  if (a < 0) { return null; }
  const b = src.indexOf('\n}\n', a);
  if (b < 0) { return null; }
  try { return new Function('return ' + src.slice(a, b + 2))(); } catch (e) { return null; }
}
const waits = {};
for (const f of starters) {
  waits[f] = lift(text[f]);
  yes(f + ' waits for its own service to say it is listening before asking it anything',
      !!waits[f] && /await listening\(srv, (PORT|port)\)/.test(text[f]));
}
// The bot pass starts the service through scripts/bot/relay.js (#5196), on
// the port its copy's settings name, and asks it nothing (not /token) until
// that copy has said it is listening there.
{
  const relay = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'bot', 'relay.js'), 'utf8');
  yes('scripts/bot/relay.js waits for its own service to say it is listening on its port before asking it anything',
      relay.indexOf("new RegExp('\\\\[voice\\\\] listening on 127\\\\.0\\\\.0\\\\.1:' + this.port + '\\\\b')") >= 0 &&
      relay.indexOf('if (this.lines.some((l) => said.test(l))) { return \'\'; }') >= 0);
}

// ------------------------------------------------------ the site's own word
const sites = files.filter((f) => f !== SELF && /spawn\(/.test(text[f]) && /THORNSWOOD_DOCS_PORT/.test(text[f]));
const TWELVE = ['tests/test-bans-pk.js', 'site/tests/test-discord-callback-hang.js', 'site/tests/test-for-bot-folder.js',
  'tests/test-help-report.js', 'site/tests/test-home-html.js', 'site/tests/test-report-limits.js', 'tests/test-site-auth.js',
  'site/tests/test-site-discovery.js', 'site/tests/test-site-hangs.js', 'site/tests/test-site-render.js', 'site/tests/test-staff-bans.js',
  'site/tests/test-submit-answers.js'];
console.log('\nthe harnesses that start the site (' + sites.length + '):');
yes('there are the twelve #1727 found, and the five that already waited for the site\'s line',
    TWELVE.concat(['tests/test-deploy-records.js', 'site/tests/test-gallery.js', 'site/tests/test-hub-staff-gallery.js',
                   'site/tests/test-site-headers.js', 'tests/test-site-local.js']).every((f) => sites.indexOf(f) >= 0));
// Waiting on the site's own line is "await listening(...)" here, or reading
// the child's "listening on " line, as the five did before #1727, or its
// ready line, which the same site says after that one and after its first
// sweep (#4082). waitUp() was the connect loop six of the twelve polled the
// port with.
for (const f of sites) {
  const own = /await listening\(\w+, \w+\)/.test(text[f]) || text[f].indexOf("'listening on ") >= 0 ||
              text[f].indexOf('/\\[thornswood-docs\\] (ready|NOT READY): /.test(out)') >= 0;
  yes(f + ' waits for its own site to say it is listening, with no waitUp() poll of the port',
      own && !/function waitUp\(/.test(text[f]));
}
const siteWaits = {};
for (const f of TWELVE) {
  siteWaits[f] = lift(text[f]);
  yes(f + ' has the wait for the site\'s own line, and waits on it',
      !!siteWaits[f] && /\[thornswood-docs\\\] listening on/.test(String(siteWaits[f])) &&
      /await listening\(\w+, \w+\)/.test(text[f]));
}

// ------------------------------------------ the PowerShell harnesses (#1755)
const psFiles = ['tests'].concat(beside).reduce((all, dir) => all.concat(
  fs.readdirSync(path.join(REPO_DIR, dir)).filter((n) => /^test-.*\.ps1$/.test(n)).sort().map((n) => dir + '/' + n)), []);
const psText = {};
for (const f of psFiles) { psText[f] = read(path.join(REPO_DIR, f)).replace(/^\uFEFF/, ''); }
const psSites = psFiles.filter((f) => /THORNSWOOD_DOCS_PORT/.test(psText[f]));
const FIVE = ['tests/test-deployed-build.ps1', 'tests/test-feed-store.ps1', 'tests/test-record-sync.ps1', 'tests/test-release-baseline.ps1',
  'tests/test-scrub-feed.ps1', 'site/tests/test-site-assets.ps1'];
console.log('\nthe PowerShell harnesses that start the site (' + psSites.length + '):');
yes('they are the five #1755 found, and test-deployed-build.ps1', psSites.length === FIVE.length && FIVE.every((f) => psSites.indexOf(f) >= 0));
// The function, from its line to the brace that closes it at the margin.
function psLift(src) {
  const m = /^function Wait-OwnLine\([\s\S]*?\n\}\n/m.exec(src);
  return m ? m[0] : null;
}
const psWaits = {};
for (const f of psSites) {
  const fn = psLift(psText[f]);
  psWaits[f] = fn;
  const rest = fn ? psText[f].replace(fn, '') : psText[f];
  yes(f + ' has Wait-OwnLine and waits on the site\'s own line with it',
      !!fn && /Wait-OwnLine \$\w+ \$[\w:]+(\[\$\w+\.Id\])? '\[thornswood-docs\]' \$\w+ 'the site'/.test(rest));
  yes(f + ' neither polls the port nor drains the site\'s output before its line',
      !/function Up\(/.test(rest) && !/for \(\$i = 0; \$i -lt 100/.test(rest) && rest.indexOf('StandardOutput.ReadToEndAsync()') < 0);
}
yes('they all carry the same Wait-OwnLine', psSites.every((f) => psWaits[f] && psWaits[f] === psWaits[psSites[0]]));
{
  const sa = psText['site/tests/test-site-assets.ps1'] || '';
  yes('test-site-assets.ps1: the GitHub stand-in says its own line, and is waited on',
      /\.listen\(port, '127\.0\.0\.1', \(\) => console\.log\('\[github\] listening on 127\.0\.0\.1:' \+ port\)\)/.test(sa) &&
      /Wait-OwnLine \$ghProc \$script:errOf\[\$ghProc\.Id\] '\[github\]' \$ghPort/.test(sa));
  const rs = psText['tests/test-record-sync.ps1'] || '';
  yes('test-record-sync.ps1: the game server stand-in says its own line, and is waited on',
      /console\.log\('\[game\] listening on 127\.0\.0\.1:\$gamePort'\)/.test(rs) &&
      /Wait-OwnLine \$gp \$gpErr '\[game\]' \$gamePort/.test(rs));
}

// ------------------------------------- the game port the site checks (#1816)
// The value each harness gives gameCheckPort: `gameCheckPort: X` in a .js
// config, `gameCheckPort = X` in a .ps1 one. X is port 1 when it is 1, or a
// name the file only ever sets to 1.
function gamePorts(src, ps) {
  const out = [];
  const re = ps ? /\bgameCheckPort\s*=\s*([^;\s}]+)/g : /\bgameCheckPort\s*:\s*([^,}\n]+)/g;
  let m;
  while ((m = re.exec(src))) { out.push(m[1].trim()); }
  return out;
}
function portOne(src, v, ps) {
  if (v === '1') { return true; }
  const n = (ps ? /^\$(\w+)$/ : /^([A-Za-z_$][\w$]*)$/).exec(v);
  if (!n) { return false; }
  const sets = [];
  const re = new RegExp((ps ? '\\$' : '\\b') + n[1].replace(/\$/g, '\\$') + '\\s*=(?!=)\\s*([^;\\n]+)', 'g');
  let m;
  while ((m = re.exec(src))) { sets.push(m[1].trim()); }
  return sets.length > 0 && sets.every((x) => x === '1');
}
const gameSites = sites.filter((f) => /\bgameCheckPort\b/.test(text[f]))
  .concat(psSites.filter((f) => /\bgameCheckPort\b/.test(psText[f])));
const SEVEN = ['site/tests/test-site-assets.ps1', 'tests/test-feed-store.ps1', 'tests/test-record-sync.ps1',
  'tests/test-release-baseline.ps1', 'tests/test-scrub-feed.ps1', 'site/tests/test-report-limits.js', 'site/tests/test-for-bot-folder.js'];
console.log('\nthe game port each site harness gives its site (' + gameSites.length + '):');
yes('they include the seven #1816 found', SEVEN.every((f) => gameSites.indexOf(f) >= 0));
// The check itself, on the lines this issue took out.
yes('it would have caught $dead from a listener let go, and DEAD from freePort()',
    !portOne('$l.Start(); $dead = $l.LocalEndpoint.Port; $l.Stop()\n', '$dead', true) &&
    !portOne('const DEAD = await freePort();\n', 'DEAD', false) &&
    portOne('$dead = 1\n', '$dead', true) && portOne('const DEAD = 1;\n', 'DEAD', false));
for (const f of gameSites) {
  const ps = /\.ps1$/.test(f);
  const vs = gamePorts(ps ? psText[f] : text[f], ps);
  yes(f + ' gives its site port 1 to check for the game (' + vs.join(', ') + ')',
      vs.length > 0 && vs.every((v) => portOne(ps ? psText[f] : text[f], v, ps)));
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-1703-'));
for (const n of ['voice-server.js', 'headlines.js']) {
  fs.copyFileSync(path.join(REPO_DIR, 'voice', n), path.join(scratch, n));
}
const siteDir = path.join(scratch, 'site');
fs.mkdirSync(siteDir);
siteFiles.copy(siteDir);
function site(port) {
  const srv = spawn(process.execPath, ['server.js'], { cwd: siteDir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' }) });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', () => {});
  return srv;
}
function voice(port) {
  const srv = spawn(process.execPath, ['voice-server.js'], { cwd: scratch,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                                          THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: path.join(scratch, 'chat') }) });
  srv.stdout.on('data', () => {}); srv.stderr.on('data', () => {});
  return srv;
}
function gone(srv) {
  return new Promise((ok) => {
    if (srv.exitCode !== null || srv.signalCode !== null) { ok(); return; }
    srv.once('exit', () => ok());
    srv.kill();
  });
}
function get(port, where) {
  return new Promise((ok) => {
    const req = http.get({ host: '127.0.0.1', port: port, path: where, agent: false }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b }));
    });
    req.on('error', () => ok({ status: 0, body: '' }));
  });
}

/*
  Copies of one harness at the same moment, the way two runners on the VPS
  reached test-deploy-records.js in the same second. Each must pass.
*/
function runHarness(rel) {
  return new Promise((ok) => {
    const c = spawn(process.execPath, [path.join(REPO_DIR, rel)], { cwd: REPO_DIR });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('exit', (code) => ok({ code: code, out: out }));
  });
}

(async () => {
  // Somebody else on the port: a server that answers /health the way a voice
  // service with a deploy record would.
  const other = http.createServer((q, r) => {
    r.writeHead(200, { 'content-type': 'application/json' });
    r.end('{"ok":true,"build":"not this run","deploy":{"commit":"another run"}}');
  });
  await new Promise((r) => other.listen(0, '127.0.0.1', r));
  const held = other.address().port;
  for (const f of starters) {
    if (!waits[f]) { continue; }
    const srv = voice(held);
    let said = '';
    try { await waits[f](srv, held); said = 'took it'; } catch (e) { said = e.message.split('\n')[0]; }
    await gone(srv);
    yes(f + ': with another server on its port, the wait fails and says so ("' + said + '")',
        said.indexOf('something else already holds port ' + held) === 0);
  }
  // The same for each of the twelve site harnesses' waits.
  for (const f of TWELVE) {
    if (!siteWaits[f]) { continue; }
    const srv = site(held);
    let said = '';
    try { await siteWaits[f](srv, held); said = 'took it'; } catch (e) { said = e.message.split('\n')[0]; }
    await gone(srv);
    yes(f + ': with another server on its port, the wait fails and says so ("' + said + '")',
        said.indexOf('something else already holds port ' + held) === 0);
  }
  other.close();

  // The same for each PowerShell harness's Wait-OwnLine, run in pwsh.
  const pwsh = await new Promise((ok) => {
    const c = spawn('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']);
    c.on('error', () => ok(false)); c.on('exit', (code) => ok(code === 0));
  });
  yes('pwsh is on this machine, so the PowerShell waits can be run', pwsh);
  function psWait(f, port) {
    const driver = path.join(scratch, 'wait-' + path.basename(f, '.ps1') + '.ps1');
    fs.writeFileSync(driver, psWaits[f] + [
      '$port = [int]$env:WAIT_PORT',
      '$psi = New-Object Diagnostics.ProcessStartInfo',
      '$psi.FileName = $env:WAIT_NODE; $psi.Arguments = \'"server.js"\'; $psi.WorkingDirectory = $env:WAIT_SITE',
      '$psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $psi.RedirectStandardOutput = $true; $psi.RedirectStandardError = $true',
      '$psi.EnvironmentVariables[\'THORNSWOOD_DOCS_PORT\'] = [string]$port',
      '$psi.EnvironmentVariables[\'THORNSWOOD_DOCS_LOCAL\'] = \'1\'',
      '$p = [Diagnostics.Process]::Start($psi); $e = $p.StandardError.ReadToEndAsync()',
      '$why = Wait-OwnLine $p $e \'[thornswood-docs]\' $port \'the site\'',
      'Write-Output (\'WHY:\' + $why)',
      'if (-not $why) {',
      '  try { $r = [Net.HttpWebRequest]::Create("http://127.0.0.1:$port/api/public").GetResponse(); $b = (New-Object IO.StreamReader($r.GetResponseStream())).ReadToEnd(); Write-Output (\'STATUS:\' + [int]$r.StatusCode + \' \' + $b.Contains(\'not this run\')); $r.Close() }',
      '  catch { Write-Output (\'STATUS:0 \' + $_.Exception.Message) }',
      '}',
      'if (-not $p.HasExited) { $p.Kill() }',
      ''].join('\n'));
    return new Promise((ok) => {
      const c = spawn('pwsh', ['-NoProfile', '-File', driver], {
        env: Object.assign({}, process.env, { WAIT_PORT: String(port), WAIT_NODE: process.execPath, WAIT_SITE: siteDir }) });
      let out = '';
      c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
      c.on('exit', () => ok(out));
    });
  }
  if (pwsh) {
    const psOther = http.createServer((q, r) => { r.writeHead(200); r.end('not this run'); });
    await new Promise((r) => psOther.listen(0, '127.0.0.1', r));
    const psHeld = psOther.address().port;
    for (const f of psSites) {
      if (!psWaits[f]) { continue; }
      const out = await psWait(f, psHeld);
      const why = ((/WHY:(.*)/.exec(out) || [])[1] || out.trim().split(/\r?\n/).pop() || '').trim();
      yes(f + ': with another server on its port, Wait-OwnLine fails and says so ("' + why + '")',
          why.indexOf('something else already holds port ' + psHeld) === 0);
    }
    psOther.close();
    const firstPs = psSites.filter((f) => !!psWaits[f])[0];
    if (firstPs) {
      const port = await new Promise((ok) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
      });
      const out = await psWait(firstPs, port);
      yes('on a port the site holds, Wait-OwnLine ends and the site answers there (' + out.trim().split(/\r?\n/).join(' | ') + ')',
          /WHY:\s*(\r?\n|$)/.test(out) && /STATUS:200 False/.test(out));
    }
  }

  // A site on its own port: the wait ends, and what answers is that site.
  const firstSite = TWELVE.filter((f) => !!siteWaits[f])[0];
  if (firstSite) {
    const port = await new Promise((ok) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
    });
    const srv = site(port);
    let up = false;
    try { await siteWaits[firstSite](srv, port); up = true; } catch (e) { console.log('      ' + e.message); }
    const h = up ? await get(port, '/api/public') : { status: 0, body: '' };
    yes('on a port the site holds, the wait ends and the site answers there',
        up && h.status === 200 && h.body.indexOf('not this run') < 0);
    await gone(srv);
  }

  // And the service's own port: the wait ends, and what answers is this service.
  const first = starters.filter((f) => !!waits[f])[0];
  if (first) {
    const port = await new Promise((ok) => {
      const s = net.createServer();
      s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
    });
    const srv = voice(port);
    let up = false;
    try { await waits[first](srv, port); up = true; } catch (e) { console.log('      ' + e.message); }
    const h = up ? await get(port, '/health') : { status: 0, body: '' };
    let j = null; try { j = JSON.parse(h.body); } catch (e) { j = null; }
    yes('on a port the service holds, the wait ends and /health is this service\'s own',
        up && h.status === 200 && !!j && j.ok === true && j.build !== 'not this run');
    await gone(srv);
  }

  console.log('\nbuilds at once:');
  const runs = await Promise.all([1, 2, 3].map(() => runHarness('tests/test-deploy-records.js')));
  for (let i = 0; i < runs.length; i++) {
    const r = runs[i];
    const tail = (r.out.trim().split(/\r?\n/).pop() || '');
    yes('test-deploy-records.js, copy ' + (i + 1) + ' of ' + runs.length + ' started together, passes (' + tail + ')',
        r.code === 0 && / 0 failed$/.test(tail));
    if (r.code !== 0) {
      for (const l of r.out.split(/\r?\n/).filter((x) => /^FAIL|^ {6}\S/.test(x))) { console.log('      copy ' + (i + 1) + ' said: ' + l.trim()); }
    }
  }

  const siteRuns = await Promise.all([1, 2, 3].map(() => runHarness('site/tests/test-staff-bans.js')));
  for (let i = 0; i < siteRuns.length; i++) {
    const r = siteRuns[i];
    const tail = (r.out.trim().split(/\r?\n/).pop() || '');
    yes('test-staff-bans.js, copy ' + (i + 1) + ' of ' + siteRuns.length + ' started together, passes (' + tail + ')',
        r.code === 0 && / 0 failed$/.test(tail));
    if (r.code !== 0) {
      for (const l of r.out.split(/\r?\n/).filter((x) => /^FAIL/.test(x))) { console.log('      copy ' + (i + 1) + ' said: ' + l.trim()); }
    }
  }

  try { fs.rmSync(scratch, { recursive: true, force: true }); } catch (e) { }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.log('FAIL  ' + (e && e.stack || e)); process.exitCode = 1; });
