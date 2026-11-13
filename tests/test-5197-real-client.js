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
//     runner names the same three files the plugin does.
//
// Read only.
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
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
