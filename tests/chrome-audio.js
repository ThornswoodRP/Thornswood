'use strict';
// chrome-audio.js
//
// Chrome's own Web Audio, for a harness that compares what the launcher does
// with what the voice page did in a browser (tests\test-voice-hrtf.js). It
// starts a headless Chrome of this machine's with a profile of its own in a
// temp folder, talks to it over the DevTools protocol (node's own WebSocket,
// nothing installed), runs one expression in a blank page and hands back
// what the expression's promise gave.
//
//   const C = require('./chrome-audio');
//   const exe = C.find();                 // null when this machine has none
//   const out = await C.evaluate(exe, '(async () => { ... })()');
//
// CHROME names a Chrome or Chromium to use instead of the usual places.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

function find() {
  const tries = [];
  if (process.env.CHROME) { tries.push(process.env.CHROME); }
  if (os.platform() === 'win32') {
    for (const base of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]) {
      if (base) { tries.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe')); }
    }
  } else if (os.platform() === 'darwin') {
    tries.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  } else {
    tries.push('/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/local/bin/chromium');
  }
  for (const t of tries) { if (fs.existsSync(t)) { return t; } }
  return null;
}

// On Windows, chrome.exe takes no --version: it opens a browser window and
// keeps running, which held the gate's Windows runner until the harness was
// killed at 300 s. So there the version is the one the exe's own file
// version resource carries, read by Windows PowerShell; elsewhere --version
// prints it and exits.
function version(exe) {
  const r = os.platform() === 'win32'
    ? cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$v = (Get-Item -LiteralPath $env:TS_CHROME_EXE).VersionInfo; $v.ProductName + \' \' + $v.ProductVersion'],
    { encoding: 'utf8', env: Object.assign({}, process.env, { TS_CHROME_EXE: exe }) })
    : cp.spawnSync(exe, ['--version'], { encoding: 'utf8' });
  return ((r.stdout || '') + (r.stderr || '')).trim();
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/* Runs expression in a blank page and gives back its value (returnByValue).
   ms is the whole run's time, Chrome's start with it: on a runner with every
   core busy, Chrome took more than the 20 s its start once had of its own
   (gate run 41503513653), and a start that is only slow is no failure. */
async function evaluate(exe, expression, ms) {
  const limit = ms || 60000;
  const by = Date.now() + limit;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-chrome-'));
  const chrome = cp.spawn(exe, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0', '--user-data-dir=' + dir, 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  let said = '';
  chrome.stderr.on('data', (d) => { said += d; });
  const exited = new Promise((ok) => { if (chrome.exitCode !== null) { ok(); } else { chrome.once('exit', ok); } });
  let browserWs = '';
  try {
    const file = path.join(dir, 'DevToolsActivePort');
    while (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').split('\n').length < 2) {
      if (Date.now() > by) { throw new Error('Chrome did not open its DevTools port in ' + Math.round(limit / 1000) + ' s. It said:\n' + said); }
      if (chrome.exitCode !== null) { throw new Error('Chrome stopped (exit ' + chrome.exitCode + '). It said:\n' + said); }
      await sleep(50);
    }
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    const port = lines[0].trim();
    browserWs = 'ws://127.0.0.1:' + port + lines[1].trim();
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    const page = list.find((t) => t.type === 'page');
    if (!page) { throw new Error('Chrome has no page to run in'); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('no DevTools socket')); });
    const answer = new Promise((ok, bad) => {
      const late = setTimeout(() => bad(new Error('Chrome gave no answer in ' + Math.round(limit / 1000) + ' s')), Math.max(0, by - Date.now()));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== 1) { return; }
        clearTimeout(late);
        if (m.error) { bad(new Error(JSON.stringify(m.error))); return; }
        if (m.result.exceptionDetails) { bad(new Error('the page threw: ' + JSON.stringify(m.result.exceptionDetails))); return; }
        ok(m.result.result.value);
      };
    });
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expression, awaitPromise: true, returnByValue: true } }));
    const value = await answer;
    ws.close();
    return value;
  } finally {
    await close(chrome, exited, browserWs, dir);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* Ends Chrome and every process it started on the profile in dir, so the
   folder can go. Killing the browser process alone left its children
   holding files in the profile on Windows, and deleting it then failed
   with EPERM (merge queue run 41506188065). So Chrome is asked to close
   (Browser.close) when DevTools is up, killed only when it is not, and on
   Windows the folder waits until no process that names it is left. Named by
   its own name, ts-chrome- and six letters, the same in a short path and a
   long one. */
async function close(chrome, exited, browserWs, dir) {
  let asked = false;
  if (browserWs && chrome.exitCode === null) {
    try {
      const ws = new WebSocket(browserWs);
      await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error('no browser socket')); });
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      asked = true;
    } catch (e) { asked = false; }
  }
  if (!asked) { chrome.kill(); }
  await exited;
  if (os.platform() !== 'win32') { return; }
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '$d = $env:TS_CHROME_DIR; $ids = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($d) } | ForEach-Object { $_.ProcessId }); ' +
    'if ($ids.Count) { Wait-Process -Id $ids -Timeout 60 -ErrorAction SilentlyContinue }; ' +
    '$left = @(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($d) }); ' +
    'if ($left.Count) { \'still running on the profile: \' + (($left | ForEach-Object { $_.Name + \' \' + $_.ProcessId }) -join \', \'); exit 1 }'],
  { encoding: 'utf8', env: Object.assign({}, process.env, { TS_CHROME_DIR: path.basename(dir) }) });
  if (r.status !== 0) { throw new Error('Chrome left processes on its profile after it closed: ' + ((r.stdout || '') + (r.stderr || '')).trim()); }
}

module.exports = { find: find, version: version, evaluate: evaluate };
