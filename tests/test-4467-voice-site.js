'use strict';
/*
  test-4467-voice-site.js

      node tests/test-4467-voice-site.js

  Issue #4467. Install-Voice.ps1 said its -Site was "the site the voice
  server asks about character creation choices" and that empty "turns that
  check off". Since #1303 and #1315 the voice service asks that site, on
  /token, whether a Discord ticket owns the profile it wants a join token
  for, and mints nothing it cannot ask about: with THORNSWOOD_SITE empty
  every /token answers 503, so every voice and chat join is refused. The
  install took an empty -Site, put it on the service's command line, and its
  checks after the swap read only /health, so it still ended as a pass.

  This holds, against the real voice service on loopback ports of its own
  and a stand-in site:

    A  scripts\deploy\VoiceSite.ps1's Get-VoiceSiteProblem refuses an empty
       site, a blank one, one that is not https, and one carrying anything
       a cmd.exe line would run, and takes https://thornswood.net;
    B  its join check (Get-VoiceJoinCheck, the text the install runs on the
       box, read by Read-VoiceJoin), run against a service with no site,
       says a join does not get through and why (503);
    C  and against a service whose site answers a ticket it does not take,
       says a join reaches the site (403 ticket), which is what a working
       box answers a ticket nobody holds;
    D  Install-Voice.ps1 asks the first before it reaches for ssh or builds
       anything, runs the second on the box after the swap and after
       -TaskOnly and stops when it fails, and its words say what the site is
       for and that the port is opened only on an outside bind.

  Nothing leaves the machine. The temp folder is removed at the end.
*/
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const REPO_DIR = path.join(__dirname, '..');
const HELPER = path.join(REPO_DIR, 'scripts', 'deploy', 'VoiceSite.ps1');
const INSTALL = path.join(REPO_DIR, 'scripts', 'deploy', 'Install-Voice.ps1');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 1500).split('\n').join('\n      ') : '')); }
}

/* The helper, dot-sourced in pwsh, with one call; its answer as JSON. */
function ps(call) {
  const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
  const r = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command',
    '$ErrorActionPreference = "Stop"; . ' + lit(HELPER) + '; ' + call + ' | ConvertTo-Json -Compress'],
    { encoding: 'utf8', timeout: 60000 });
  const out = String(r.stdout || '').trim();
  try { return { ok: true, value: JSON.parse(out || 'null') }; }
  catch (e) { return { ok: false, value: null, said: out + '\n' + String(r.stderr || '') + (r.error ? '\n' + r.error.message : '') }; }
}
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4467-'));
for (const n of ['voice-server.js', 'headlines.js']) fs.copyFileSync(path.join(REPO_DIR, 'voice', n), path.join(dir, n));
fs.writeFileSync(path.join(dir, 'token-key.txt'), crypto.randomBytes(32).toString('hex'));

// A port of this run's own (#1703), asked of nothing until the service says
// it is listening there.
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[voice\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', more); srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said); srv.stderr.on('data', more); srv.on('exit', gone);
  });
}
async function startVoice(site) {
  const port = await freePort('0.0.0.0');
  const srv = spawn(process.execPath, ['voice-server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_VOICE_PORT: String(port), THORNSWOOD_VOICE_BIND: '127.0.0.1',
                                          THORNSWOOD_SITE: site, THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
  });
  await listening(srv, port);
  return { srv: srv, port: port };
}
// The install's join check, run here as the box runs it, and read as the install reads it.
const joinCheck = (port) => ps('Read-VoiceJoin @(& ([scriptblock]::Create((Get-VoiceJoinCheck ' + port + '))))');
function stop(srv) {
  return new Promise((ok) => {
    if (!srv || srv.exitCode !== null || srv.signalCode !== null) { ok(); return; }
    srv.once('exit', () => ok());
    srv.kill();
  });
}

(async function main() {
  let voice = null, site = null;
  try {
    yes('scripts/deploy/VoiceSite.ps1 is there', fs.existsSync(HELPER));

    // -------------------------------------------------------------- A --
    console.log('\nA. which site addresses the install takes:');
    for (const [s, take] of [['', false], ['   ', false], ['http://thornswood.net', false],
                             ['https://thornswood.net&& calc', false], ['https://thornswood.net', true],
                             ['https://thornswood.net/', true]]) {
      const r = ps('Get-VoiceSiteProblem ' + lit(s));
      const why = r.ok ? String(r.value == null ? '' : r.value) : null;
      yes(JSON.stringify(s) + ' is ' + (take ? 'taken' : 'refused, with why') + (why ? ' (' + why + ')' : ''),
          why !== null && (take ? why === '' : why.length > 0), r.said);
    }

    // -------------------------------------------------------------- B --
    console.log('\nB. a service with no site lets nobody join, and the check says so:');
    voice = await startVoice('');
    let r = joinCheck(voice.port);
    yes('the join check says a join does not get through, naming the 503 (' + (r.value && r.value.Said) + ')',
        r.ok && r.value && r.value.Ok === false && /503/.test(String(r.value.Said)), r.said);
    await stop(voice.srv); voice = null;

    // -------------------------------------------------------------- C --
    console.log('\nC. a service whose site answers says a join reaches it:');
    let asked = 0;
    site = http.createServer((q, s) => {
      if (q.method === 'POST' && q.url === '/api/play/owns') {
        asked++;
        q.resume();
        q.on('end', () => { s.writeHead(200, { 'content-type': 'application/json' }); s.end('{"ok":false,"why":"ticket"}'); });
        return;
      }
      s.writeHead(404); s.end();
    });
    await new Promise((ok) => site.listen(0, '127.0.0.1', ok));
    voice = await startVoice('http://127.0.0.1:' + site.address().port);
    r = joinCheck(voice.port);
    yes('the join check says a join reaches the site (' + (r.value && r.value.Said) + ')',
        r.ok && r.value && r.value.Ok === true, r.said);
    yes('  and the site was asked', asked >= 1);

    // -------------------------------------------------------------- D --
    console.log('\nD. Install-Voice.ps1:');
    const iv = fs.readFileSync(INSTALL, 'utf8').replace(/\r\n/g, '\n');
    const at = (s) => iv.indexOf(s);
    yes('it dot-sources VoiceSite.ps1', /\. \(Join-Path \$Here 'VoiceSite\.ps1'\)/.test(iv));
    const askSite = at('Get-VoiceSiteProblem $Site');
    yes('it asks Get-VoiceSiteProblem before it looks for ssh and before it builds anything',
        askSite > 0 && askSite < at("foreach ($t in 'ssh', 'scp')") && askSite < at('New-ThornswoodArtifact'));
    const checking = at("Head 'Checking from here'");
    const fn = at('function Assert-VoiceJoin');
    const fnBody = fn > 0 ? iv.slice(fn, iv.indexOf('\n}', fn)) : '';
    yes('Assert-VoiceJoin runs the join check on the box and reads it',
        /Read-VoiceJoin @\(Remote \(Get-VoiceJoinCheck \$Port\)/.test(fnBody));
    yes('  and stops (Die) when a join does not get through', /if \(-not \$join\.Ok\) \{\s*Die /.test(fnBody));
    const recorded = at("# The service's files are in place");
    yes('it is asked after the swap and its record, in the checks',
        checking > 0 && recorded > checking && iv.indexOf('\nAssert-VoiceJoin', recorded) > recorded);
    const taskOnly = at('if ($TaskOnly) {');
    yes('  and after -TaskOnly, whose new task carries -Site too',
        taskOnly > 0 && /\n\s+Assert-VoiceJoin\s*\n/.test(iv.slice(taskOnly, iv.indexOf('exit 0', taskOnly))));
    yes('its words no longer say the site is asked about character creation choices, or that empty turns a check off',
        !/character creation choices/.test(iv) && !/Empty\s+#?\s*turns that\s+#?\s*check off/.test(iv));
    yes('its header no longer says it opens the one port it needs',
        !/opens\s+the one port it needs/.test(iv.slice(0, at('[CmdletBinding()]'))));
    yes('its header says the port is opened only on an outside bind (-Bind 0.0.0.0)',
        /only[\s\S]{0,120}-Bind 0\.0\.0\.0/.test(iv.slice(0, at('[CmdletBinding()]'))));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  } finally {
    await stop(voice && voice.srv);
    if (site) site.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
