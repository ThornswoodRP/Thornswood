// test-5197-real-client.js
//
// #5197. The scripted real game run on One: game/plugins/thornswood-test.js
// walks the real game through a list of steps, and
// scripts/dev/Run-RealClient.ps1 starts the launcher, presses Play, takes the
// screenshots and presses the keys the plugin asks for.
//
// This runs the real plugin in vm with a fake Skyrim Platform, a fake disk
// and a fake clock, and plays the runner's half by hand, and checks:
//   - it idles with no run file, and with no dev answer on disk, so a retail
//     game never runs one;
//   - it takes the run file and deletes it, so the next ordinary Play does
//     not run it again;
//   - each kind of step passes on what it waits for, asks the runner and
//     waits for its answer, and the run ends with a done line and an end ask;
//   - a step that times out fails, asks for a screenshot named after it, and
//     ends the run as failed;
//   - every step in tests/real-client/*.json is one the plugin knows, and the
//     runner names the same three files the plugin does;
//   - the runner's Windows helper compiles under PowerShell 7, where pwsh is;
//   - an install on main is put on dev for the run as the launcher's Server
//     card does, Play waits for dev's launcher, and the channel goes back
//     after, byte for byte (on a config.json in the system's temp folder).
//
// Reads only, but for that config.json in a folder of its own in the
// system's temp, removed after.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pluginPass = require('./fixtures/plugin-pass');
const CR = String.fromCharCode(13);
function read(p) {
  return fs.readFileSync(path.isAbsolute(p) ? p : path.join(REPO_DIR, p), 'utf8').split(CR).join('');
}
const PLUGIN = read(process.env.PLUGIN || path.join('game', 'plugins', 'thornswood-test.js'));
const RUNNER = read(path.join('scripts', 'dev', 'Run-RealClient.ps1'));
const OUR_ADDRESS = JSON.parse(read(path.join('scripts', 'vps', 'vps.json'))).address;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const RUN = 'Data/Platform/thornswood-test-run.json';
const OUT = 'Data/Platform/thornswood-test-results.jsonl';
const ACK = 'Data/Platform/thornswood-test-ack.txt';
const DEV = '../Profile/dev-allowed.txt';

/*
  The game around the plugin. opts.dev: the site's dev answer on disk.
  opts.steps: the run file's steps, or none for no run file.
*/
function game(opts) {
  let now = Date.now();
  const files = {};
  files['Data/Platform/Plugins/skymp5-client-settings.txt'] = JSON.stringify({ 'server-ip': OUR_ADDRESS, gameData: { profileId: 1 } });
  files['Data/Platform/thornswood-session.txt'] = String(now);
  if (opts.dev !== false) { files[DEV] = 'yes'; }
  if (opts.steps) { files[RUN] = JSON.stringify({ id: 'run-1', steps: opts.steps }); }
  const fakeFs = {
    readFileSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) { throw new Error('ENOENT ' + p); }
      return files[p];
    },
    writeFileSync: function (p, text) { files[p] = String(text); },
    appendFileSync: function (p, text) { files[p] = (files[p] || '') + String(text); },
    unlinkSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) { throw new Error('ENOENT ' + p); }
      delete files[p];
    }
  };
  const handlers = {};
  const world = { cell: null };
  const pageRuns = [];
  const sp = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    printConsole: function () { },
    getPlatformVersion: function () { return 'test'; },
    browser: { executeJavaScript: function (src) { pageRuns.push(src); } },
    Game: { getPlayer: function () { return { getParentCell: function () { return world.cell; } }; } }
  };
  const FakeDate = { now: function () { return now; }, parse: Date.parse };
  const sandbox = {
    skyrimPlatform: sp,
    require: function (name) { if (name === 'fs') { return fakeFs; } throw new Error(name); },
    console: console, Date: FakeDate, JSON: JSON, Number: Number, String: String,
    Math: Math, Array: Array, Object: Object, RegExp: RegExp, isFinite: isFinite
  };
  vm.createContext(sandbox);
  pluginPass.load(sandbox, PLUGIN, { filename: 'thornswood-test.js' });
  function fire(name, ev) { (handlers[name] || []).forEach(function (fn) { fn(ev); }); }
  function lines() {
    return String(files[OUT] || '').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
  }
  return {
    files: files, handlers: handlers, world: world, pageRuns: pageRuns, lines: lines,
    // A frame: time moves on by ms, then update and tick, as the game sends them.
    frame: function (ms) { now += ms || 16; fire('update'); fire('tick'); },
    menu: function (name, open) { fire(open ? 'menuOpen' : 'menuClose', { name: name }); },
    page: function () { fire('browserMessage', { arguments: [].slice.call(arguments) }); },
    // The runner's half: answer every ask so far.
    ack: function () {
      const asks = lines().filter(function (l) { return l.t === 'ask'; });
      if (asks.length) { files[ACK] = String(asks[asks.length - 1].n); }
      return asks;
    }
  };
}

// ----------------------------------------------------- it idles unless --
{
  const g = game({ steps: null });
  yes('no run file: the plugin hooks nothing', Object.keys(g.handlers).length === 0);
  yes('and writes nothing', !g.files[OUT]);
}
{
  const g = game({ dev: false, steps: [{ do: 'end' }] });
  yes('no dev answer on disk: the plugin hooks nothing, even with a run file there', Object.keys(g.handlers).length === 0);
  yes('and leaves the file alone', !!g.files[RUN] && !g.files[OUT]);
}

// --------------------------------------------------------- a whole run ----
{
  const g = game({ steps: [
    { do: 'page', js: '!!window.thornswoodSelect' },
    { do: 'shot', name: 'choice page' },
    { do: 'wait', for: 'world' },
    { do: 'key', code: 36 },
    { do: 'wait', for: 'message', match: ['thornswood-front', 'journal:opened'] },
    { do: 'wait', for: 'menu', menu: 'InventoryMenu', open: true },
    { do: 'wait', for: 'menu', menu: 'InventoryMenu', open: false },
    { do: 'end' }
  ] });
  yes('the run file is taken and deleted, so the next Play does not run it', !g.files[RUN]);
  yes('the start line says how many steps', g.lines()[0] && g.lines()[0].t === 'start' && g.lines()[0].steps === 8);

  g.frame();
  yes('a page step asks the page', g.pageRuns.length === 1 && g.pageRuns[0].indexOf('!!window.thornswoodSelect') >= 0);
  const id = /"page","([^"]+)"/.exec(g.pageRuns[0]);
  g.page('thornswood-test', 'page', id ? id[1] : '', 'false');
  g.frame(100);
  yes('an answer of false does not pass it', !g.lines().some(function (l) { return l.t === 'step'; }));
  g.frame(500);
  yes('and it asks again half a second on', g.pageRuns.length === 2);
  const id2 = /"page","([^"]+)"/.exec(g.pageRuns[1]);
  g.page('thornswood-test', 'page', id2 ? id2[1] : '', 'true');
  g.frame();
  const s0 = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('an answer of true passes it', s0.length === 1 && s0[0].ok === true && s0[0].i === 0);

  g.frame();
  let asks = g.lines().filter(function (l) { return l.t === 'ask'; });
  yes('a shot asks the runner, by name', asks.length === 1 && asks[0].do === 'shot' && asks[0].arg === 'choice page');
  g.frame(1000);
  yes('and waits for its answer', g.lines().filter(function (l) { return l.t === 'step'; }).length === 1);
  g.ack();
  g.frame(300);
  yes('the runner\'s answer ends the step', g.lines().filter(function (l) { return l.t === 'step' && l.ok; }).length === 2);

  g.frame(); g.frame();
  yes('waiting for the world while a menu is up', g.lines().filter(function (l) { return l.t === 'step'; }).length === 2);
  g.world.cell = {};
  g.menu('Loading Menu', true);
  g.frame();
  yes('a loading screen is not the world', g.lines().filter(function (l) { return l.t === 'step'; }).length === 2);
  g.menu('Loading Menu', false);
  g.frame();
  yes('in a cell with no loading screen is', g.lines().filter(function (l) { return l.t === 'step'; }).length === 3);

  g.frame();
  asks = g.lines().filter(function (l) { return l.t === 'ask'; });
  yes('a key asks the runner to press it', asks.length === 2 && asks[1].do === 'key' && asks[1].arg === 36);
  g.page('thornswood-front', 'journal:opened');   // the journal opened before the runner said it pressed
  g.ack();
  g.frame(300);
  g.frame();
  yes('a message that came while the key step ran still counts for the wait after it',
      g.lines().filter(function (l) { return l.t === 'step' && l.do === 'wait' && l.ok; }).length === 2);

  g.frame();
  g.menu('InventoryMenu', true);
  g.frame();
  g.menu('InventoryMenu', false);
  g.frame();
  g.frame();
  g.frame();
  const done = g.lines().filter(function (l) { return l.t === 'done'; });
  yes('the menu waits pass on open and on close, and the run ends passed, 8 of 8',
      done.length === 1 && done[0].ok === true && done[0].passed === 8);
  asks = g.lines().filter(function (l) { return l.t === 'ask'; });
  yes('and asks the runner to end it', asks[asks.length - 1].do === 'end' && asks[asks.length - 1].arg === 'pass');
  const before = g.lines().length;
  g.frame(); g.frame(1000);
  yes('nothing more after that', g.lines().length === before);
}

// ------------------------------------------------------ a failing step ----
{
  const g = game({ steps: [
    { do: 'wait', for: 'menu', menu: 'Journal Menu', open: true, timeout: 1000 },
    { do: 'end' }
  ] });
  g.frame(); g.frame(500);
  yes('a wait inside its time has not failed', !g.lines().some(function (l) { return l.t === 'step'; }));
  g.frame(600);
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('past its time it fails, saying what it waited for', st.length === 1 && st[0].ok === false && /Journal Menu to open/.test(st[0].note));
  const asks = g.lines().filter(function (l) { return l.t === 'ask'; });
  yes('and asks for a screenshot named after the step', asks.length === 1 && asks[0].do === 'shot' && asks[0].arg === 'fail-0');
  g.ack();
  g.frame(300);
  const done = g.lines().filter(function (l) { return l.t === 'done'; });
  yes('once it is taken the run ends failed, 0 of 2, without the steps after it',
      done.length === 1 && done[0].ok === false && done[0].passed === 0);
}

// -------------------------------------------- the lists and the runner ----
{
  const known = [];
  const rx = /case '([a-z]+)':/g;
  let m;
  while ((m = rx.exec(PLUGIN))) { known.push(m[1]); }
  const dir = path.join(REPO_DIR, 'tests', 'real-client');
  const lists = fs.readdirSync(dir).filter(function (n) { return /\.json$/.test(n); });
  yes('tests/real-client has a step list, ' + lists.length + ' in all', lists.length > 0);
  lists.forEach(function (n) {
    let doc = null;
    try { doc = JSON.parse(read(path.join(dir, n))); } catch (e) { doc = null; }
    const bad = doc && Array.isArray(doc.steps) ? doc.steps.filter(function (s) { return known.indexOf(s.do) < 0; }) : null;
    yes(n + ' reads, and every step is one the plugin knows', !!bad && bad.length === 0);
    if (bad && bad.length) { console.log('      unknown: ' + bad.map(function (s) { return s.do; }).join(', ')); }
    yes(n + ' ends with an end step', !!doc && doc.steps.length > 0 && doc.steps[doc.steps.length - 1].do === 'end');
  });
  [['thornswood-test-run.json', RUN], ['thornswood-test-results.jsonl', OUT], ['thornswood-test-ack.txt', ACK]].forEach(function (p) {
    yes('the plugin and the runner name the same ' + p[0],
        PLUGIN.indexOf("'" + p[1] + "'") >= 0 && RUNNER.indexOf("'" + p[0] + "'") >= 0);
  });
  yes('the runner presses the launcher\'s Play by its name in MainWindow.axaml',
      /AutomationIdProperty, 'BtnPlay'/.test(RUNNER) && /x:Name="BtnPlay"/.test(read(path.join('launcher', 'app', 'MainWindow.axaml'))));
  // A launcher from the setup is a Velopack install in %LOCALAPPDATA%\Thornswood,
  // not <install>\Launcher (15 Nov: the run stopped on "Not there" on One).
  const place = read(path.join('launcher', 'app', 'InstallPlace.cs')) || '';
  yes('the runner finds a Velopack launcher by the record the launcher writes',
      /"install-root\.txt"/.test(place) && /'install-root\.txt'/.test(RUNNER) &&
      /Join-Path \$veloHome 'current\\Thornswood\.exe'/.test(RUNNER) && /& \$where MachineData/.test(RUNNER));
  yes('the runner takes the one install, not the old -DevBuild folder',
      /\$Root = & \$where Install\b/.test(RUNNER) && !/InstallDev/.test(RUNNER));
  // An install on main is put on dev for the run and back after it, the way
  // the launcher's Server card switch sets it (16 Nov: the run refused One,
  // which Patrick had put on main to play).
  const cfg = read(path.join('launcher', 'app', 'Config.cs')) || '';
  const dev = read(path.join('launcher', 'app', 'DevBuild.cs')) || '';
  const setBody = (/public static bool Set\(Config cfg, string channel\)\s*\{([\s\S]*?)\n        \}/.exec(dev) || [])[1] || '';
  const fields = (/\$channelFields = @\(([^)]*)\)/.exec(RUNNER) || [])[1] || '';
  ['Channel', 'UpdateBranch', 'ServerPort', 'VoicePort', 'VoiceUrl'].forEach(function (n) {
    yes('the runner sets ' + n + ' as DevBuild.Set does, a field config.json keeps',
        new RegExp('cfg\\.' + n + ' = ').test(setBody) && fields.indexOf("'" + n + "'") >= 0 &&
        new RegExp('\\[JsonInclude[^\\]]*\\] public string ' + n + '\\b').test(cfg));
  });
  yes('and with the dev ports DevBuild names',
      /DevPort = "7787"/.test(dev) && /DevVoicePort = "7789"/.test(dev) &&
      /ServerPort = '7787'; VoicePort = '7789'/.test(RUNNER));
  yes('the runner puts the channel back in its finally, only when it changed it',
      /\} finally \{[\s\S]*if \(\$switched\) \{\s*Set-RunChannel \$leftOn/.test(RUNNER));
  yes('and presses Play only once the launcher in place is dev\'s',
      /\$ch = Get-InstalledChannel\s*\n\s*if \(\$ch -and \$ch -ne 'dev'\)[\s\S]*?continue[\s\S]*?BtnPlay|\$ch = Get-InstalledChannel\s*\n\s*if \(\$ch -and \$ch -ne 'dev'\)[\s\S]*?continue[\s\S]*?\$btn\.Current\.IsEnabled/.test(RUNNER));
}

// The runner's Windows helper is compiled by Add-Type when it starts. On One,
// under PowerShell 7, it failed with CS1069 (Bitmap is in System.Drawing.Common)
// before the launcher started (16 Nov). Compile it here the same way, with the
// text the runner has, wherever PowerShell 7 is.
{
  const cp = require('child_process');
  const from = RUNNER.indexOf("if (-not ('ThornswoodRealClient.Win' -as [type])) {");
  const end = from >= 0 ? RUNNER.indexOf("\n'@\n}", from) : -1;
  yes('the runner has its Windows helper block', from >= 0 && end > from);
  const ver = cp.spawnSync('pwsh', ['--version'], { encoding: 'utf8' });
  if (ver.status !== 0) {
    console.log('SKIP  the runner\'s Windows helper compiles under PowerShell 7 (no pwsh here)');
  } else if (from >= 0 && end > from) {
    const block = 'Add-Type -AssemblyName System.Drawing\n' + RUNNER.slice(from, end + 5) + '\n' +
      "if ('ThornswoodRealClient.Win' -as [type]) { 'HELPER OK' }\n";
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(block, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const said = (r.stdout || '') + (r.stderr || '');
    yes('the runner\'s Windows helper compiles under PowerShell ' + ver.stdout.trim().replace(/^PowerShell /, ''), /HELPER OK/.test(said));
    if (!/HELPER OK/.test(said)) { console.log(said.split('\n').slice(0, 12).map(function (l) { return '      ' + l; }).join('\n')); }
  }

  // The runner's channel functions on a config.json as the launcher writes
  // it, in a folder of the system's temp: main to dev, and back byte for byte.
  const cf = RUNNER.indexOf('$cfgFile = Join-Path $Root');
  const ce = RUNNER.indexOf('$leftOn = Read-ChannelFields');
  yes('the runner has its channel functions', cf >= 0 && ce > cf);
  if (ver.status === 0 && cf >= 0 && ce > cf) {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-5197-'));
    const before = '{"ServerIp":"203.0.113.9","ServerPort":"7777","VoicePort":"7778","VoiceUrl":"https://example.invalid/voice/","UpdateBranch":"main","Theme":"Forge","Channel":"","Note":"a \\"quoted\\" word"}';
    fs.writeFileSync(path.join(dir, 'config.json'), before);
    const script = '$ErrorActionPreference = "Stop"\n$Root = ' + JSON.stringify(dir).replace(/"/g, "'") + '\n' +
      RUNNER.slice(cf, ce) +
      '$leftOn = Read-ChannelFields\n' +
      "Set-RunChannel ([ordered]@{ Channel = 'dev'; UpdateBranch = 'dev'; ServerPort = '7787'; VoicePort = '7789'; VoiceUrl = (Get-DevVoiceUrl $leftOn.VoiceUrl) })\n" +
      "'ON DEV ' + ([IO.File]::ReadAllText($cfgFile))\n" +
      'Set-RunChannel $leftOn\n' +
      "'BACK ' + ([IO.File]::ReadAllText($cfgFile))\n";
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const on = (/ON DEV (.*)/.exec(out) || [])[1] || '';
    let onCfg = null;
    try { onCfg = JSON.parse(on); } catch (e) { onCfg = null; }
    yes('on dev, config.json has the five fields as DevBuild.Set gives them',
        !!onCfg && onCfg.Channel === 'dev' && onCfg.UpdateBranch === 'dev' && onCfg.ServerPort === '7787' &&
        onCfg.VoicePort === '7789' && onCfg.VoiceUrl === 'https://example.invalid/voice-dev');
    yes('and every other field as the launcher wrote it', !!onCfg && onCfg.Theme === 'Forge' && onCfg.ServerIp === '203.0.113.9' && onCfg.Note === 'a "quoted" word');
    yes('put back, config.json is byte for byte what it was', ((/BACK (.*)/.exec(out) || [])[1] || '').trim() === before);
    if (!onCfg) { console.log(out.split('\n').slice(0, 12).map(function (l) { return '      ' + l; }).join('\n')); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
