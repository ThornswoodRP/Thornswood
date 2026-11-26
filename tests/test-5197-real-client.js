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
//     waits for its answer (a menu wait also on a menu that opened and closed
//     between two ticks, as a loading screen does), and the run ends with a done line and an end ask;
//   - a step that times out fails, asks for a screenshot named after it, and
//     ends the run as failed, unless it is a wait with skip (or a page step
//     answered with its skipIf word), which passes
//     over the steps that deal with what it waited for (creation, for a
//     character the server has not got);
//   - every step in tests/real-client/*.json is one the plugin knows, every
//     K panel tab, button and call a page step uses is one the panel has, and
//     the runner names the same three files the plugin does;
//   - the runner's Windows helper compiles under PowerShell 7, where pwsh is;
//   - an install on main is put on dev for the run as the launcher's Server
//     card does, Play waits for dev's launcher, and the channel goes back
//     after, byte for byte (on a config.json in the system's temp folder);
//   - -Publish puts the run on a draft Release of its own, since a build's
//     Release is immutable once published, and the Deployment links it;
//   - the runner reads the results file sharing writing, so the plugin's
//     append never fails under it, and takes only whole lines (on a file in
//     the system's temp folder).
//
// Reads only, but for that config.json and that results file, each in a
// folder of its own in the system's temp, removed after.
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
const SKILLS = read(path.join('game', 'ui', 'thornswood-skills.js')) || '';
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
    ack: function (reply) {
      const asks = lines().filter(function (l) { return l.t === 'ask'; });
      if (asks.length) {
        const ask = asks[asks.length - 1];
        files[ACK] = JSON.stringify(Object.assign({ n: ask.n, ok: true, note: '' }, reply));
      }
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

// --------------------------------------- a wait for what may not come ----
// Creation, for a character the server has not got: the race menu opens in
// the hall. For one it has, the wait runs out and the creation steps after it
// are passed over, and the run goes on.
{
  const g = game({ steps: [
    { do: 'wait', for: 'menu', menu: 'RaceSex Menu', open: true, timeout: 1000, skip: 2 },
    { do: 'key', code: 19 },
    { do: 'wait', for: 'menu', menu: 'RaceSex Menu', open: false },
    { do: 'end' }
  ] });
  g.frame(); g.frame(1100);
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('a wait with skip that runs out passes, saying so', st.length >= 1 && st[0].ok === true && /RaceSex Menu to open, so the next 2 step\(s\) are skipped/.test(st[0].note));
  yes('  and the next two steps are skipped, asking the runner nothing', st.length === 3 && st[1].note === 'skipped' && st[2].note === 'skipped' &&
      !g.lines().some(function (l) { return l.t === 'ask'; }));
  g.frame(); g.frame();
  const done = g.lines().filter(function (l) { return l.t === 'done'; });
  yes('  and the run goes on to its end, passed', done.length === 1 && done[0].ok === true && done[0].passed === 4);
}
{
  const g = game({ steps: [
    { do: 'wait', for: 'menu', menu: 'RaceSex Menu', open: true, timeout: 1000, skip: 1 },
    { do: 'key', code: 19 },
    { do: 'end' }
  ] });
  g.frame();
  g.menu('RaceSex Menu', true);
  g.frame();
  g.frame();
  const asks = g.lines().filter(function (l) { return l.t === 'ask'; });
  yes('when it comes, the steps after it run', asks.length === 1 && asks[0].do === 'key' && asks[0].arg === 19);
}

// A page step with skipIf: a character the server has placed already needs
// no Starting Location, so the page says so and the steps for it are passed
// over; any other answer passes the step and the run goes on to them.
{
  const steps = [
    { do: 'page', js: 'k()', skip: 2, skipIf: 'placed' },
    { do: 'shot', name: 'home-chosen' },
    { do: 'wait', for: 'menu', menu: 'Loading Menu', open: true },
    { do: 'end' }
  ];
  const g = game({ steps: steps });
  g.frame();
  const id = /"page","([^"]+)"/.exec(g.pageRuns[0] || '');
  g.page('thornswood-test', 'page', id ? id[1] : '', 'placed');
  g.frame(); g.frame();
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('a page step answered with its skipIf word passes, saying so', st.length >= 1 && st[0].ok === true && /the page said placed, so the next 2 step\(s\) are skipped/.test(st[0].note));
  yes('  and the two steps after it are skipped, asking the runner for nothing but the end', st.length >= 3 && st[1].note === 'skipped' && st[2].note === 'skipped' &&
      !g.lines().some(function (l) { return l.t === 'ask' && l.do !== 'end'; }));
  const done = g.lines().filter(function (l) { return l.t === 'done'; });
  yes('  and the run ends passed', done.length === 1 && done[0].ok === true && done[0].passed === 4);

  const h = game({ steps: steps });
  h.frame();
  const id2 = /"page","([^"]+)"/.exec(h.pageRuns[0] || '');
  h.page('thornswood-test', 'page', id2 ? id2[1] : '', 'confirmed Whiterun');
  h.frame(); h.frame();
  const st2 = h.lines().filter(function (l) { return l.t === 'step'; });
  const asks = h.lines().filter(function (l) { return l.t === 'ask'; });
  yes('any other answer passes it and the next step runs', st2.length === 1 && st2[0].note === 'confirmed Whiterun' && asks.length === 1 && asks[0].arg === 'home-chosen');
}

// ----------------------------------- a menu seen only between two ticks ----
// Tick does not come while a loading screen is up, so the trip from the hall
// to the town (16 Nov) opened and closed the Loading Menu between two ticks.
{
  const g = game({ steps: [
    { do: 'wait', for: 'menu', menu: 'Loading Menu', open: true, timeout: 5000 },
    { do: 'end' }
  ] });
  g.frame();
  g.menu('Loading Menu', true);
  g.menu('Loading Menu', false);
  g.frame();
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('a menu that opened and closed between two ticks passes its wait', st.length >= 1 && st[0].ok === true && /opened and closed again/.test(st[0].note));
}
{
  const g = game({ steps: [
    { do: 'wait', for: 'menu', menu: 'InventoryMenu', open: true },
    { do: 'wait', for: 'menu', menu: 'InventoryMenu', open: false },
    { do: 'wait', for: 'menu', menu: 'Loading Menu', open: true, timeout: 1000 },
    { do: 'end' }
  ] });
  g.frame(100);
  g.menu('Loading Menu', true);
  g.menu('Loading Menu', false);
  g.frame(100);
  g.menu('InventoryMenu', true);
  g.frame(100);
  g.menu('InventoryMenu', false);
  g.frame(100);
  g.frame(500); g.frame(600); g.frame(); g.frame();
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('  and one that came and went before the step before it began does not', st.length >= 3 && st[0].ok && st[1].ok && st[2].ok === false);
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
// A keyboard acknowledgement must say whether delivery succeeded. Merely
// seeing an ask number (the old runner's reply) cannot prove it did.
[
  { reply: { ok: false, note: 'the game window does not have the keyboard' }, ok: false },
  { reply: { ok: false, note: 'SendInput sent 1 of 2 events' }, ok: false },
  { reply: { ok: true, note: '2 events, game window focused' }, ok: true }
].forEach(function (c) {
  const g = game({ steps: [{ do: 'key', code: 36 }, { do: 'end' }] });
  g.frame(); g.ack(c.reply); g.frame(300);
  const step = g.lines().find(function (l) { return l.t === 'step'; });
  yes('key delivery result reaches the step: ' + c.reply.note,
      !!step && step.ok === c.ok && step.note === c.reply.note);
  if (!c.ok) {
    g.ack(); g.frame(300);
    const done = g.lines().find(function (l) { return l.t === 'done'; });
    yes('a rejected key stops the run with zero steps passed', !!done && !done.ok && done.passed === 0);
  }
});
{
  const g = game({ steps: [{ do: 'key', code: 36 }, { do: 'end' }] });
  g.frame(); g.files[ACK] = '1'; g.frame(300);
  const step = g.lines().find(function (l) { return l.t === 'step'; });
  yes('an old numeric acknowledgement cannot pass a key step', !!step && step.ok === false);
}
{
  const g = game({ steps: [{ do: 'key', code: 36 }, { do: 'end' }] });
  g.frame(); g.ack({ n: 2 }); g.frame(300);
  yes('an acknowledgement for another request cannot pass a key step',
      !g.lines().some(function (l) { return l.t === 'step'; }));
}

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
    // A page step finds the K panel's tabs by the titles it shows and its
    // buttons by data-act, so a renamed tab fails here and not two minutes
    // into a run on One (26 Nov: #6454 renamed Home to Starting Location).
    const pages = doc && Array.isArray(doc.steps) ? doc.steps.filter(function (s) { return s.do === 'page' && /ts-skills/.test(s.js || ''); }) : [];
    const lost = [];
    pages.forEach(function (s) {
      let t;
      const rowRx = /row\('([^']+)'\)/g;
      while ((t = rowRx.exec(s.js))) { if (SKILLS.indexOf("title: '" + t[1] + "'") < 0) lost.push('tab ' + t[1]); }
      const callRx = /\bk\.([A-Za-z]+)\b|thornswoodSkills\.([A-Za-z]+)\b/g;
      while ((t = callRx.exec(s.js))) { const fn = t[1] || t[2]; if (SKILLS.indexOf('    ' + fn + ': function') < 0) lost.push('panel call ' + fn); }
      const actRx = /data-act=\\?"([a-z]+)\\?"/g;
      while ((t = actRx.exec(s.js))) { if (SKILLS.indexOf('data-act="' + t[1] + '"') < 0) lost.push('button ' + t[1]); }
    });
    // The run plays its own character, by the name on its slot, and never
    // the slot the page picks by itself, which is the last played: at 2:08
    // PM on 26 Nov the run joined as somebody's own character.
    if (doc && Array.isArray(doc.steps)) {
      const sel = read(path.join('game', 'ui', 'thornswood-select.js'));
      const picks = doc.steps.filter(function (s) { return s.do === 'page' && /#ts-select/.test(s.js || '') && /onclick\(\)|play\(\)/.test(s.js || ''); });
      yes(n + ': its character is picked by the name on its slot, never by Play on whatever is picked',
          picks.length > 0 && picks.every(function (s) { return !/thornswoodSelect\.play\(\)/.test(s.js) && /\.name'\)/.test(s.js) && /textContent==='[^']+'/.test(s.js); }));
      yes(n + ': the slot card, its name and its click are where the page draws them',
          /el\('div', 'slot'/.test(sel) && /el\('div', 'name'/.test(sel) && /card\.onclick = function/.test(sel));
    }
    // After the face the K panel's view still says not creating until the
    // server's answer comes, so the run waits for creating before the step
    // that tells a new character from a placed one, inside the race menu's
    // skip (26 Nov, 1:44 PM: placed was read 21 ms after the menu closed).
    if (doc && Array.isArray(doc.steps)) {
      const st = doc.steps;
      const open = st.findIndex(function (s) { return s.do === 'wait' && s.menu === 'RaceSex Menu' && s.open === true; });
      const close = st.findIndex(function (s) { return s.do === 'wait' && s.menu === 'RaceSex Menu' && s.open === false; });
      if (open >= 0 && close > open) {
        const after = st[close + 1] || {};
        yes(n + ': after the race menu closes the run waits for the server to say creating, inside the race menu\'s skip',
            after.do === 'page' && /isCreating\(\)===true/.test(after.js || '') && open + Number(st[open].skip) === close + 1);
      }
    }
    if (pages.length) {
      yes(n + ': every K panel tab, button and call its page steps use is in game/ui/thornswood-skills.js', lost.length === 0);
      if (lost.length) { console.log('      not there: ' + lost.join(', ')); }
    }
  });
  [['thornswood-test-run.json', RUN], ['thornswood-test-results.jsonl', OUT], ['thornswood-test-ack.txt', ACK]].forEach(function (p) {
    yes('the plugin and the runner name the same ' + p[0],
        PLUGIN.indexOf("'" + p[1] + "'") >= 0 && RUNNER.indexOf("'" + p[0] + "'") >= 0);
  });
  // The launcher puts its build's own Data\\Platform files back before Play,
  // so a copy laid in by hand never reaches the game (26 Nov). The runner
  // lays none, and says when the game's plugin is not this checkout's.
  yes('the runner lays no plugin of its own into the game', !/InstallPlugin/.test(RUNNER) && !/Copy-Item[^\n]*thornswood-test\.js/.test(RUNNER));
  yes('  and says, once the game is up, when the game\'s plugin is not this checkout\'s',
      /function Get-PluginMismatch\b/.test(RUNNER) && /Get-FileHash -LiteralPath \$inGame/.test(RUNNER) &&
      /if \(-not \$sawGame\) \{[\s\S]{0,200}\$pluginOff = Get-PluginMismatch/.test(RUNNER) && /if \(\$pluginOff\) \{ \$note = /.test(RUNNER));
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
  yes('PowerShell 7 is available for the required keyboard delivery regressions', ver.status === 0);
  const keyFunction = /function Invoke-GameKey\b[\s\S]*?\n}\n/.exec(RUNNER);
  const gameProcessFunction = /function Get-GameProcess\b[\s\S]*?\n}\n/.exec(RUNNER);
  yes('the runner has a testable keyboard delivery function', !!keyFunction);
  yes('the runner has a testable process lookup', !!gameProcessFunction);
  if (ver.status === 0 && keyFunction && gameProcessFunction) {
    // Execute the production PowerShell control flow against fake user32
    // calls. This neither launches a window nor injects any real input.
    const script = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
namespace ThornswoodRealClient {
  public static class Win {
    public static IntPtr Foreground;
    public static bool Activate, MoveOnActivate, LoseOnHold, LoseOnUp, ThrowDown, ThrowHold, ThrowUp, Down, SawDown;
    public static uint DownSent, UpSent;
    public static int Calls;
    public static int NativeCalls;
    public static string Events = "";
    public static bool SetForegroundWindow(IntPtr h) {
      NativeCalls++;
      if (Activate && MoveOnActivate) Foreground = h;
      return Activate;
    }
    public static IntPtr GetForegroundWindow() { NativeCalls++; return Foreground; }
    public static string ForegroundWho() { return "notepad " + Foreground + " \\"Untitled\\""; }
    public static uint SendScan(ushort scan, bool up) {
      Calls++; NativeCalls++; Events += (up ? "U" : "D") + scan + ";";
      if (up) {
        Down = false;
        if (LoseOnUp) Foreground = new IntPtr(99);
        if (ThrowUp) throw new Exception("release error");
        return UpSent;
      }
      if (ThrowDown) throw new Exception("press error");
      Down = DownSent == 1;
      return DownSent;
    }
    public static void Hold(int ms) {
      Events += "H" + ms + ";";
      // A current-state reader samples between down and up, like the CEF
      // listener. Buffered native events alone cannot establish this.
      SawDown = Down;
      if (LoseOnHold) Foreground = new IntPtr(99);
      if (ThrowHold) throw new Exception("hold error");
    }
  }
}
'@
${keyFunction[0]}
${gameProcessFunction[0]}
function Start-Sleep([int]$Milliseconds) { [ThornswoodRealClient.Win]::Hold($Milliseconds) }
function Get-Process { $script:fakeProcess }
$script:fakeProcess = [pscustomobject]@{ MainWindowHandle = [IntPtr]::Zero }
$p = Get-GameProcess
if ($p) {
  $r = Invoke-GameKey $p.MainWindowHandle 36
  if (-not $r.ok) { 'WINDOWLESS ALIVE: ' + $r.note }
}
$script:fakeProcess = $null
if (-not (Get-GameProcess)) { 'TERMINATED ABSENT' }
function Case($name, $handle, $foreground, $activate, $move, $down, $up, $lose, $throwDown=$false, $throwHold=$false, $throwUp=$false, $loseOnUp=$false, $code=36) {
  [ThornswoodRealClient.Win]::Foreground = [IntPtr]$foreground
  [ThornswoodRealClient.Win]::Activate = $activate
  [ThornswoodRealClient.Win]::MoveOnActivate = $move
  [ThornswoodRealClient.Win]::DownSent = $down
  [ThornswoodRealClient.Win]::UpSent = $up
  [ThornswoodRealClient.Win]::LoseOnHold = $lose
  [ThornswoodRealClient.Win]::LoseOnUp = $loseOnUp
  [ThornswoodRealClient.Win]::ThrowDown = $throwDown
  [ThornswoodRealClient.Win]::ThrowHold = $throwHold
  [ThornswoodRealClient.Win]::ThrowUp = $throwUp
  [ThornswoodRealClient.Win]::Down = $false
  [ThornswoodRealClient.Win]::SawDown = $false
  [ThornswoodRealClient.Win]::Calls = 0
  [ThornswoodRealClient.Win]::NativeCalls = 0
  [ThornswoodRealClient.Win]::Events = ''
  $r = Invoke-GameKey ([IntPtr]$handle) $code
  @{name=$name; code=$code; ok=$r.ok; note=$r.note; calls=[ThornswoodRealClient.Win]::Calls; nativeCalls=[ThornswoodRealClient.Win]::NativeCalls; events=[ThornswoodRealClient.Win]::Events; sawDown=[ThornswoodRealClient.Win]::SawDown} | ConvertTo-Json -Compress
}
Case 'unsupported' 42 99 $true $true 1 1 $false -code 200
Case 'zero-code' 42 99 $true $true 1 1 $false -code 0
Case 'fraction' 42 99 $true $true 1 1 $false -code 36.4
Case 'rounded-boundary' 42 99 $true $true 1 1 $false -code 127.4
Case 'preserved-fraction' 42 99 $true $true 1 1 $false -code '127.00000000000000001'
Case 'missing' 0 0 $true $true 1 1 $false
Case 'denied' 42 99 $false $false 1 1 $false
Case 'not-foreground' 42 99 $true $false 1 1 $false
Case 'zero-down' 42 42 $true $true 0 1 $false
Case 'zero-up' 42 42 $true $true 1 0 $false
Case 'lost' 42 42 $true $true 1 1 $true -code 1
Case 'press-error' 42 42 $true $true 1 1 $false $true
Case 'hold-error' 42 42 $true $true 1 1 $false $false $true
Case 'release-error' 42 42 $true $true 1 1 $false $false $false $true
Case 'release-focus' 42 42 $true $true 1 1 $false -loseOnUp $true
Case 'already' 42 42 $false $false 1 1 $false
Case 'activated' 42 99 $true $true 1 1 $false -code 23
`;
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const cases = (r.stdout || '').split('\n').filter(function (l) { return l.trim().startsWith('{'); }).map(JSON.parse);
    yes('a living process without a window reaches the failed-key path instead of the crashed exit',
        /WINDOWLESS ALIVE: no game window/.test(r.stdout || ''));
    yes('a terminated process is still detected as absent', /TERMINATED ABSENT/.test(r.stdout || ''));
    yes('keyboard delivery cases execute without real Windows calls', r.status === 0 && cases.length === 17);
    ['unsupported', 'zero-code', 'fraction', 'rounded-boundary', 'preserved-fraction'].forEach(function (name) {
      const c = cases.find(function (x) { return x.name === name; });
      yes(name + ': invalid code cannot query or change native focus', !!c && !c.ok && c.nativeCalls === 0);
    });
    ['denied', 'not-foreground', 'lost'].forEach(function (name) {
      const c = cases.find(function (x) { return x.name === name; });
      yes(name + ': the note names the window that is in front', !!c && /in front: notepad (99|42) "Untitled"/.test(c.note || ''));
    });
    yes('the runner\'s helper asks Windows which process and title are in front',
        /public static string ForegroundWho\(\)/.test(RUNNER) && /GetWindowThreadProcessId\(h, out pid\)/.test(RUNNER) && /GetWindowText\(h, t, t\.Capacity\)/.test(RUNNER));
    ['unsupported', 'zero-code', 'fraction', 'rounded-boundary', 'preserved-fraction', 'missing', 'denied', 'not-foreground'].forEach(function (name) {
      const c = cases.find(function (x) { return x.name === name; });
      yes(name + ': no injection without game focus', !!c && !c.ok && c.calls === 0 && !!c.note);
    });
    ['zero-down', 'zero-up', 'lost', 'press-error', 'hold-error', 'release-error', 'release-focus'].forEach(function (name) {
      const c = cases.find(function (x) { return x.name === name; });
      yes(name + ': rejected delivery cannot pass, and releases the requested key',
          !!c && !c.ok && c.calls === 2 && c.events.endsWith('U' + c.code + ';') && c.events.startsWith('D' + c.code + ';') && !!c.note);
    });
    ['already', 'activated'].forEach(function (name) {
      const c = cases.find(function (x) { return x.name === name; });
      yes(name + ': snapshot input sees the requested held key before release',
          !!c && c.ok && c.calls === 2 && c.sawDown && c.events === 'D' + c.code + ';H120;U' + c.code + ';');
    });
    if (r.status !== 0) { console.log(r.stderr || r.stdout); }
  }
  if (ver.status !== 0) {
    console.log('      Install PowerShell 7 to run the keyboard delivery regressions and compile the Windows helper.');
  } else if (from >= 0 && end > from) {
    const block = 'Add-Type -AssemblyName System.Drawing\n' + RUNNER.slice(from, end + 5) + '\n' +
      "if ('ThornswoodRealClient.Win' -as [type]) { 'HELPER OK' }\n";
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(block, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const said = (r.stdout || '') + (r.stderr || '');
    yes('the runner\'s Windows helper compiles under PowerShell ' + ver.stdout.trim().replace(/^PowerShell /, ''), /HELPER OK/.test(said));
    if (!/HELPER OK/.test(said)) { console.log(said.split('\n').slice(0, 12).map(function (l) { return '      ' + l; }).join('\n')); }

    // Exercise production packet construction, replacing only the native
    // SendInput boundary. Counts, flags and scan bytes must match exactly;
    // no Windows input is sent, on either Windows or Linux.
    const boundary = /\[DllImport\("user32\.dll", SetLastError = true\)\] static extern uint SendInput\(uint n, INPUT\[\] inputs, int size\);/;
    yes('the native input boundary is identified for packet checks', boundary.test(block));
    // A changed declaration must fail this check without ever executing the
    // unreplaced P/Invoke on a Windows test machine.
    if (boundary.test(block)) {
    const recording = block.replace(boundary, `public static string Packets = "";
    public static bool PacketLayoutOkay = true;
    static uint SendInput(uint n, INPUT[] inputs, int size) {
      int nativeSize = IntPtr.Size == 8 ? 40 : 28;
      int unionOffset = IntPtr.Size == 8 ? 8 : 4;
      PacketLayoutOkay &= size == nativeSize && inputs[0].type == 1 &&
        Marshal.OffsetOf(typeof(INPUT), "u").ToInt32() == unionOffset &&
        Marshal.OffsetOf(typeof(INPUTUNION), "ki").ToInt32() == 0 &&
        Marshal.OffsetOf(typeof(KEYBDINPUT), "wScan").ToInt32() == 2;
      Packets += n + "," + inputs.Length + "," + inputs[0].u.ki.wScan + "," + inputs[0].u.ki.dwFlags + ";";
      return n;
    }`) + `
foreach ($scan in @(1,23,36)) {
  [void][ThornswoodRealClient.Win]::SendScan([uint16]$scan, $false)
  [void][ThornswoodRealClient.Win]::SendScan([uint16]$scan, $true)
}
'PACKETS ' + [ThornswoodRealClient.Win]::Packets
'LAYOUT ' + [ThornswoodRealClient.Win]::PacketLayoutOkay
`;
    const packets = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(recording, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    yes('production native code sends one requested scan per call with down/up flags', packets.status === 0 &&
        (packets.stdout || '').includes('PACKETS 1,1,1,8;1,1,1,10;1,1,23,8;1,1,23,10;1,1,36,8;1,1,36,10;'));
    yes('production packets use keyboard input and the Windows INPUT layout and size', packets.status === 0 && /LAYOUT True/.test(packets.stdout || ''));
    if (packets.status !== 0) { console.log(packets.stderr || packets.stdout); }
    }
  }

  // -Publish: a draft Release of the run's own, since a build's Release is
  // immutable once published (GitHub's 422 on 16 Nov), linked from the
  // Deployment, and older runs past the newest ten taken down.
  yes('-Publish puts the run on a draft Release of its own, never on the build\'s Release',
      /gh release create \$relTag @files --repo \$Repo --draft --target \$dep\.sha/.test(RUNNER) && !/gh release upload/.test(RUNNER));
  yes('  and the Deployment\'s line links that draft', /log_url = \$relUrl;/.test(RUNNER));
  yes('  and only the runs\' own drafts past the newest ten are taken down',
      /Where-Object \{ \$_\.draft -and \(\[string\]\$_\.tag_name\)\.StartsWith\('real-client-'\) \}[\s\S]*Select-Object -Skip 10/.test(RUNNER));

  // The results file: read sharing writing, so the plugin's append never
  // fails under the read and loses its line (16 Nov), and only whole lines.
  yes('the runner reads the results file sharing writing, never with ReadAllLines',
      !/ReadAllLines\(\$resultsFile\)/.test(RUNNER) &&
      /\[IO\.File\]::Open\(\$resultsFile, 'Open', 'Read', 'ReadWrite, Delete'\)/.test(RUNNER) &&
      /\$lines = @\(Read-NewResultLines\)/.test(RUNNER));
  const rf = RUNNER.indexOf('$script:resultsReadAt = 0\nfunction Read-NewResultLines');
  const re = rf >= 0 ? RUNNER.indexOf('\n}\n', rf) : -1;
  yes('the runner has Read-NewResultLines', rf >= 0 && re > rf);
  if (ver.status === 0 && rf >= 0 && re > rf) {
    const os = require('os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-5197-'));
    const file = path.join(dir, 'results.jsonl');
    fs.writeFileSync(file, '{"t":"start"}\n{"t":"ask","n":1}\n{"t":"ask","n"');
    const script = '$ErrorActionPreference = "Stop"\n$resultsFile = ' + JSON.stringify(file).replace(/"/g, "'") + '\n' +
      RUNNER.slice(rf, re + 3) +
      "'FIRST ' + (@(Read-NewResultLines) -join '|')\n" +
      "'NONE ' + (@(Read-NewResultLines).Count)\n" +
      "[IO.File]::AppendAllText($resultsFile, ':2}' + [char]10)\n" +
      "'SECOND ' + (@(Read-NewResultLines) -join '|')\n";
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    yes('it takes the whole lines and leaves a line still being written',
        ((/FIRST (.*)/.exec(out) || [])[1] || '').trim() === '{"t":"start"}|{"t":"ask","n":1}' && ((/NONE (.*)/.exec(out) || [])[1] || '').trim() === '0');
    yes('  and takes that line once its end is there, once', ((/SECOND (.*)/.exec(out) || [])[1] || '').trim() === '{"t":"ask","n":2}');
    if (!/SECOND/.test(out)) { console.log(out.split('\n').slice(0, 12).map(function (l) { return '      ' + l; }).join('\n')); }
    fs.rmSync(dir, { recursive: true, force: true });
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

// A Play the launcher could not start (26 Nov, 10:59 AM on One: "Could not
// redirect ... Skyrim Special Edition") leaves the launcher open with no game.
// The run must stop on the launcher's own "Failed to start" line, with its
// reason, and not wait -Minutes for a game that is never coming.
{
  const cp = require('child_process');
  const os = require('os');
  const fn = /function Read-LauncherLines \{[\s\S]*?\nfunction Read-LauncherFailure \{[\s\S]*?\n\}\n/.exec(RUNNER);
  yes('the runner reads the launcher log for a failed Play', !!fn);
  const loop = RUNNER.indexOf('$sawGame = $false');
  const check = RUNNER.indexOf('$failed = Read-LauncherFailure', loop);
  const game = RUNNER.indexOf("Say \"The game is up", loop);
  yes('the game wait stops on it before any game is up',
      loop > 0 && check > loop && game > check &&
      /if \(\$failed\) \{ throw "The launcher could not start the game: \$failed" \}/.test(RUNNER));
  // The run closes the game, waits for the launcher's own line that it saw
  // the game close (which is when it puts Windows' Skyrim folders back), and
  // then closes the launcher's window as a person does. Ending the launcher
  // by force first left both folders pointing into Profile after every run
  // (26 Nov, 12:42 PM on One).
  const fin = RUNNER.slice(RUNNER.indexOf('} finally {', RUNNER.indexOf('$sawGame = $false')));
  const killGame = fin.indexOf("Get-Process -Name SkyrimSE");
  const sawClose = fin.indexOf("'Game closed after '");
  const closeWin = fin.indexOf('CloseMainWindow()');
  const forced = fin.indexOf('$lp | Stop-Process -Force');
  yes('after the run the game closes first, then the launcher says the folders are back, then its window is closed',
      killGame >= 0 && sawClose > killGame && closeWin > sawClose && forced > closeWin);
  yes('the launcher is not ended by force before its window was asked to close',
      !/\$ours \| Stop-Process/.test(fin) && /if \(\$lp\.WaitForExit\(30000\)\)/.test(fin));
  yes('folders still pointing at the build after the run fail it and are named',
      /\$left = @\(Get-StillRedirected\)/.test(fin) && /if \(\$result -eq 'passed'\) \{ \$result = 'failed' \}/.test(fin));
  // A locked PC stops the run before the launcher starts, with its reason.
  {
    const lock = RUNNER.indexOf("Get-Process -Name LogonUI");
    const start = RUNNER.indexOf('$launcher = Start-Process -FilePath $launcherExe');
    const tryAt = RUNNER.indexOf('\ntry {', RUNNER.indexOf('$launcherLogStart'));
    yes('a PC on the lock screen stops the run inside its try, before the launcher starts',
        lock > tryAt && tryAt > 0 && start > lock && /\$_\.SessionId -eq \$mySession/.test(RUNNER) && /throw 'This PC is on the lock screen/.test(RUNNER));
  }
  // And the launcher says why. "Could not redirect" alone, with Junction's
  // reason dropped, is all One's log had to go on.
  const swap = read(path.join('launcher', 'app', 'Swap.cs'));
  yes('a redirect that fails says what Windows said and what was found there',
      /static bool MakeLink\(string link, string target, out string why\)/.test(swap) &&
      /if \(!MakeLink\(win, ours\[i\], out why\)\)\s*throw new Exception\("Could not redirect " \+ win \+ " \(" \+ why \+ "; found " \+ found \+ "\)"\)/.test(swap));
  const ver = cp.spawnSync('pwsh', ['--version'], { encoding: 'utf8' });
  if (ver.status === 0 && fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-5197-log-'));
    const log = path.join(dir, 'launcher.log');
    const old = '2026-11-26T16:00:00Z  Failed to start: an older Play, before the run\n';
    fs.writeFileSync(log, old);
    const q = function (v) { return "'" + v.replace(/'/g, "''") + "'"; };
    const script = '$ErrorActionPreference = "Stop"\n$launcherLog = ' + q(log) + '\n' +
      '$script:launcherLogReadAt = ' + Buffer.byteLength(old) + '\n' + fn[0] +
      "'NONE [' + (Read-LauncherFailure) + ']'\n" +
      "[IO.File]::AppendAllText($launcherLog, \"2026-11-26T17:59:51Z  Play pressed by no input device`n2026-11-26T17:59:53Z  Failed to start: Windows would not let go of`n`n    C:\\x`n`nSomething else has it open.`n2026-11-26T17:59:54Z  Next line`n\")\n" +
      "'GOT [' + (Read-LauncherFailure) + ']'\n" +
      "'AGAIN [' + (Read-LauncherFailure) + ']'\n" +
      "[IO.File]::AppendAllText($launcherLog, '2026-11-26T18:00:00Z  Failed to start: half a li')\n" +
      "'PART [' + (Read-LauncherFailure) + ']'\n";
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    yes('a failure from before the run is not taken for this one', /NONE \[\]/.test(out));
    yes('the failure is read with every line of its reason, and stops at the next stamped line',
        /GOT \[Windows would not let go of C:\\x Something else has it open\.\]/.test(out));
    yes('a failure is read once', /AGAIN \[\]/.test(out));
    yes('a line still being written is not read yet', /PART \[\]/.test(out));
    if (!/GOT \[Windows/.test(out)) { console.log(out.split('\n').slice(0, 12).map(function (l) { return '      ' + l; }).join('\n')); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
