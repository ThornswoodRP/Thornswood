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
    Game: {
      getPlayer: function () { return world.pc || { getParentCell: function () { return world.cell; } }; },
      getCurrentCrosshairRef: function () { return world.crosshair || null; }
    }
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
    files: files, handlers: handlers, world: world, pageRuns: pageRuns, lines: lines, box: sandbox, fire: fire,
    // A frame: time moves on by ms, then update and tick, as the game sends them.
    frame: function (ms) { now += ms || 16; fire('update'); fire('tick'); },
    // A frame of a paused game: tick comes, update does not.
    tickOnly: function (ms) { now += ms || 16; fire('tick'); },
    menu: function (name, open) { fire(open ? 'menuOpen' : 'menuClose', { name: name }); },
    button: function (ev) { fire('buttonEvent', ev); },
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

// Inventory input receipts contain only the scripted key and bounded state.
{
  const g = game({ steps: [
    { do: 'key', code: 23, inventoryTrace: true },
    { do: 'wait', for: 'menu', menu: 'InventoryMenu', open: false },
    { do: 'shot', name: 'inventory-closed' },
    { do: 'key', code: 23 },
    { do: 'end' }
  ] });
  const receipts = () => g.lines().filter(l => l.t === 'inventory-key');
  const event = { device: 0, code: 23, isDown: true, isUp: false, userEventName: 'Quick Inventory' };
  g.button(event);
  yes('an inventory trace is idle before the runner is asked', receipts().length === 0);
  g.menu('InventoryMenu', true);
  g.frame();
  g.button({ ...event, code: 36 });
  g.button({ ...event, device: 2 });
  g.button({ ...event, isRepeating: true });
  g.button({ ...event, isHeld: true });
  g.button({ ...event, userEventName: '' });
  g.button(event);
  g.ack();
  g.frame(300);
  g.menu('InventoryMenu', false);
  g.frame();
  g.button({ ...event, isDown: false, isUp: true, userEventName: 'ignored event name' });
  const got = receipts();
  yes('records one physical down and later up even after the release wait has already passed',
    got.length === 2 && got[0].phase === 'down' && got[1].phase === 'up' && got.every(l => l.i === 0) && got[0].inventoryOpen && !got[1].inventoryOpen);
  yes('receipts distinguish no action and another action without storing raw action values',
    got.length === 2 && got[0].action === 'none' && got[1].action === 'other' && !JSON.stringify(got).includes('ignored event name'));
  g.frame();
  g.ack();
  g.frame(300);
  g.frame();
  g.button(event);
  yes('an untraced key step retires the inventory probe', receipts().length === 2);
}
{
  const g = game({ steps: [{ do: 'key', code: 23, inventoryTrace: true }, { do: 'end' }] });
  const event = { device: 0, code: 23, isDown: true, userEventName: 'Quick Inventory' };
  g.frame();
  g.button(event);
  g.frame(6000);
  g.button({ ...event, isDown: false, isUp: true });
  const receipts = g.lines().filter(l => l.t === 'inventory-key');
  yes('a named Inventory action is reported and releases past the trace deadline are ignored',
    receipts.length === 1 && receipts[0].action === 'inventory');
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
    const start = RUNNER.indexOf('$launcher = Start-LauncherApart');
    const tryAt = RUNNER.indexOf('\ntry {', RUNNER.indexOf('$launcherLogStart'));
    yes('a PC on the lock screen stops the run inside its try, before the launcher starts',
        lock > tryAt && tryAt > 0 && start > lock && /\$_\.SessionId -eq \$mySession/.test(RUNNER) && /throw 'This PC is on the lock screen/.test(RUNNER));
  }
  // The launcher is made by WMI, outside the container of the app that
  // started the run, so its moves under %LOCALAPPDATA% reach the real
  // folders (27 Nov: from the Claude app's container they went to its store).
  {
    const fnAt = RUNNER.indexOf('function Start-LauncherApart');
    const body = fnAt >= 0 ? RUNNER.slice(fnAt, RUNNER.indexOf('\n}\n', fnAt)) : '';
    yes('the launcher is started by Win32_Process.Create with its own folder, never as a child of the run',
        /Invoke-CimMethod -ClassName Win32_Process -MethodName Create/.test(body) &&
        /CurrentDirectory = \(Split-Path \$launcherExe\)/.test(body) &&
        !/Start-Process[^\n]*\$launcherExe/.test(RUNNER) &&
        (RUNNER.match(/\$launcher = Start-LauncherApart/g) || []).length === 1);
    yes('a refused start and a launcher gone before it is followed stop the run with what Windows said',
        /if \(\$made\.ReturnValue -ne 0\)\s*\{\s*throw /.test(body) && /Get-Process -Id \$made\.ProcessId/.test(body));
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

// Facing a bed (#6712): the step tries the spots on the nearest bed's four
// sides, 45 units clear of its bounds, nearest first, and stands at the
// first from which the crosshair lands on it; the crosshair wait sees it; a
// pause waits its time; lying down is a results line.
{
  function ref(id, name, x, y, bed) {
    return {
      bed: bed, getFormID: function () { return id; },
      getBaseObject: function () { return { getName: function () { return name; } }; },
      getPositionX: function () { return x; }, getPositionY: function () { return y; }, getPositionZ: function () { return 64; },
      getAngleZ: function () { return 0; }, getWidth: function () { return 100; }, getLength: function () { return 200; }, getHeight: function () { return 50; }
    };
  }
  const chair = ref(0x101, 'Chair', 10, 10, false);
  const far = ref(0x102, 'Bed', 1000, 1000, true);
  const near = ref(0x103, 'Bed', 300, 0, true);
  const refs = [chair, far, near];
  const g = game({ steps: [
    { do: 'face', what: 'bed' },
    { do: 'wait', for: 'crosshair', what: 'bed', timeout: 2000 },
    { do: 'wait', for: 'time', ms: 1500 },
    { do: 'end' }
  ] });
  g.box.Thornswood.isBedRef = function (r) { return !!(r && r.bed); };
  let firstPerson = 0;
  g.box.skyrimPlatform.Game.forceFirstPerson = function () { firstPerson++; };
  const cell = { getNumRefs: function (t) { return t === 40 ? refs.length : 0; }, getNthRef: function (i) { return refs[i]; }, getName: function () { return 'The Bannered Mare'; } };
  const at = { x: 0, y: 0, angle: null, tried: [] };
  g.world.cell = cell;
  // A wall on the bed's left (the side nearest the character): from there
  // the crosshair meets the wall. From its foot it meets the bed.
  Object.defineProperty(g.world, 'crosshair', { get: function () { return at.y < -100 ? near : null; } });
  g.world.pc = {
    getParentCell: function () { return cell; },
    getPositionX: function () { return at.x; }, getPositionY: function () { return at.y; }, getPositionZ: function () { return 64; },
    setPosition: function (x, y) { at.x = x; at.y = y; at.tried.push([Math.round(x), Math.round(y)]); },
    setAngle: function (x, y, z) { at.angle = [x, y, z]; }
  };
  const steps = function () { return g.lines().filter(function (l) { return l.t === 'step'; }); };
  for (let i = 0; i < 40 && steps().length < 2; i++) { g.frame(100); }
  const faced = steps()[0];
  yes('face bed passes and names the nearest bed', !!faced && faced.ok && /before bed 103 "Bed" from its foot, 2 bed\(s\) in the cell, it was 300 units off/.test(faced.note));
  yes('  trying its sides nearest first, 45 units clear of its bounds', JSON.stringify(at.tried.slice(0, 2)) === JSON.stringify([[205, 0], [300, -145]]));
  yes('  and says the side the crosshair did not find it from', /not from left \(nothing under the crosshair\)/.test(faced.note));
  yes('  turned to the bed (heading north from its foot), looking down at it, in first person', !!at.angle && Math.round(at.angle[2]) === 0 && at.angle[0] > 30 && at.angle[0] < 50 && firstPerson === 1);
  yes('  and the crosshair wait after it passes', steps().length >= 2 && steps()[1].ok && /bed 103/.test(steps()[1].note));
  const t0 = steps().length;
  g.frame(1000);
  yes('a pause has not passed before its time', steps().length === t0);
  g.frame(600); g.frame(16);
  yes('  and passes after it', steps().length >= t0 + 1 && steps()[t0].ok && steps()[t0].do === 'wait');
  g.fire('furnitureEnter', { actor: { getFormID: function () { return 0x14; } }, target: near });
  g.fire('furnitureEnter', { actor: { getFormID: function () { return 0x999; } }, target: near });
  const sat = g.lines().filter(function (l) { return l.t === 'furniture'; });
  yes('lying down in a bed is a results line, the character\'s own only', sat.length === 1 && sat[0].enter === true && sat[0].bed === true && /103/.test(sat[0].ref));
}
// A bed the crosshair finds from none of its sides fails, naming each.
{
  const g = game({ steps: [{ do: 'face', what: 'bed' }, { do: 'end' }] });
  g.box.Thornswood.isBedRef = function (r) { return !!(r && r.bed); };
  const bed = { bed: true, getFormID: function () { return 0x200; }, getBaseObject: function () { return { getName: function () { return 'Bed'; } }; },
    getPositionX: function () { return 0; }, getPositionY: function () { return 0; }, getPositionZ: function () { return 0; },
    getAngleZ: function () { return 90; }, getWidth: function () { return 100; }, getLength: function () { return 200; }, getHeight: function () { return 50; } };
  const cell = { getNumRefs: function () { return 1; }, getNthRef: function () { return bed; } };
  g.world.cell = cell;
  g.world.pc = { getParentCell: function () { return cell; }, getPositionX: function () { return 500; }, getPositionY: function () { return 0; }, getPositionZ: function () { return 0; },
    setPosition: function () {}, setAngle: function () {} };
  for (let i = 0; i < 30; i++) { g.frame(100); }
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('face bed fails when the crosshair finds the bed from none of its four sides, naming them', st.length && st[0].ok === false &&
      /from none of its sides: .*right.*left.*foot.*head|from none of its sides: (?=.*right)(?=.*left)(?=.*foot)(?=.*head)/.test(st[0].note));
}
{
  const g = game({ steps: [{ do: 'face', what: 'bed' }, { do: 'end' }] });
  g.box.Thornswood.isBedRef = function (r) { return !!(r && r.bed); };
  const cell = { getNumRefs: function () { return 0; }, getNthRef: function () { return null; } };
  g.world.cell = cell;
  g.world.pc = { getParentCell: function () { return cell; }, getPositionX: function () { return 0; }, getPositionY: function () { return 0; }, getPositionZ: function () { return 0; } };
  for (let i = 0; i < 4; i++) { g.frame(16); }
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('face bed in a cell with no bed fails and says so', st.length && st[0].ok === false && /no bed among the 0 furniture/.test(st[0].note));
}
{
  let list = [];
  try { list = JSON.parse(read(path.join('tests', 'real-client', 'dev-release.json')) || '{}').steps || []; } catch (e) { list = []; }
  const tp = list.filter(function (x) { return x.do === 'page' && /\/tp bannered/.test(x.js || ''); });
  yes('the bed steps go to an inn with one /tp, sent once though a page step is asked again every half second',
      tp.length === 1 && /if\(window\.__tsBedTp\)\{return 'sent';\}/.test(tp[0].js) && /window\.__tsBedTp=1/.test(tp[0].js) &&
      /    say: function \(text, how\)/.test(read(path.join('game', 'ui', 'thornswood-chat.js'))));
  const face = list.findIndex(function (x) { return x.do === 'face'; });
  yes('  then face a bed, wait for its prompt and use it with E', face > 0 && list[face + 1].for === 'crosshair' && list.slice(face, face + 4).some(function (x) { return x.do === 'key' && x.code === 18; }));
  yes('  and press T in the same room', list.slice(face).some(function (x) { return x.do === 'key' && x.code === 20; }));
}
{
  const FRONT_SRC = read(path.join('game', 'plugins', 'thornswood-front.js'));
  yes('front shares its bed rule as Thornswood.isBedRef, the one the face step uses', /T\.isBedRef = isBedRef;/.test(FRONT_SRC) && /T\.isBedRef\(ref\)/.test(PLUGIN));
}

// Facing a carriage driver (#4581): the step finds the driver by his placed
// reference, stands 100 units out on the character's side, turned to him and
// looking level; the crosshair wait sees him; one not front's driver fails.
{
  const WS = { getFormID: function () { return 0x3c; } };
  const cell = { getFormID: function () { return 0x9999; } };
  function person(id, x, y, driver) {
    return {
      driver: driver, getFormID: function () { return id; },
      getBaseObject: function () { return { getName: function () { return 'Bjorlam'; } }; },
      getParentCell: function () { return cell; }, getWorldSpace: function () { return WS; },
      getPositionX: function () { return x; }, getPositionY: function () { return y; }, getPositionZ: function () { return -4750; }
    };
  }
  function run(driver, ref) {
    const bjorlam = person(0x5bbf6d, 400, 0, driver);
    const asked = [];
    const g = game({ steps: [
      { do: 'face', what: 'driver', ref: ref || 'bbf6d:CFTO.esp' },
      { do: 'wait', for: 'crosshair', what: 'driver', timeout: 2000 },
      { do: 'end' }
    ] });
    g.box.Thornswood.isRideDriverRef = function (r) { return !!(r && r.driver); };
    g.box.skyrimPlatform.Game.getFormFromFile = function (id, file) { asked.push(id.toString(16) + ':' + file); return id === 0xbbf6d ? bjorlam : null; };
    g.box.skyrimPlatform.ObjectReference = { from: function (f) { return f; } };
    const at = { x: 0, y: 0, angle: null };
    g.world.cell = cell;
    g.world.pc = {
      getParentCell: function () { return cell; }, getWorldSpace: function () { return WS; },
      getPositionX: function () { return at.x; }, getPositionY: function () { return at.y; },
      setPosition: function (x, y) { at.x = x; at.y = y; },
      setAngle: function (x, y, z) { at.angle = [x, y, z]; }
    };
    for (let i = 0; i < 5; i++) { g.frame(16); }
    const steps = function () { return g.lines().filter(function (l) { return l.t === 'step'; }); };
    return { g: g, at: at, asked: asked, steps: steps, bjorlam: bjorlam };
  }
  const r = run(true);
  const faced = r.steps()[0];
  yes('face driver asks for the reference the step names', r.asked[0] === 'bbf6d:CFTO.esp');
  yes('  passes and names him', !!faced && faced.ok && /before driver 5bbf6d "Bjorlam", he was 400 units off/.test(faced.note));
  yes('  and stands 100 units out on the side the character was on', Math.round(r.at.x) === 300 && Math.round(r.at.y) === 0);
  yes('  turned to him, heading east (90), looking level', !!r.at.angle && Math.round(r.at.angle[2]) === 90 && r.at.angle[0] === 0);
  yes('the crosshair wait holds while no driver is under it', r.steps().length === 1);
  r.g.world.crosshair = r.bjorlam;
  r.g.frame(16); r.g.frame(16);
  yes('  and passes once he is', r.steps().length >= 2 && r.steps()[1].ok && /driver 5bbf6d/.test(r.steps()[1].note));
  const notOne = run(false).steps()[0];
  yes('a person front does not take for a driver fails the face, and says E is not taken', !!notOne && notOne.ok === false && /is not a driver to thornswood-front\.js/.test(notOne.note));
  const badRef = run(true, 'Bjorlam').steps()[0];
  yes('a driver step without <id>:<plugin> fails and says so', !!badRef && badRef.ok === false && /names his reference as <id>:<plugin>/.test(badRef.note));
  const missing = run(true, '123:CFTO.esp').steps()[0];
  yes('a reference not in the load order fails and says so', !!missing && missing.ok === false && /no reference 123:CFTO\.esp/.test(missing.note));
}
{
  let list = [];
  try { list = JSON.parse(read(path.join('tests', 'real-client', 'dev-release.json')) || '{}').steps || []; } catch (e) { list = []; }
  const ride = list.filter(function (x) { return String(x.task) === '4581'; });
  const at = list.findIndex(function (x) { return String(x.task) === '4581'; });
  const tp = ride.filter(function (x) { return x.do === 'page' && /\/tp whiterun'/.test(x.js || ''); });
  yes('the driver task goes to Whiterun with one /tp, sent once', tp.length === 1 && /if\(window\.__tsRideTp\)\{return 'sent';\}/.test(tp[0].js) && /window\.__tsRideTp=1/.test(tp[0].js));
  const face = ride.findIndex(function (x) { return x.do === 'face'; });
  yes('  faces Bjorlam, the Whiterun carriage driver the server knows, and waits for him under the crosshair',
      face > 0 && ride[face].what === 'driver' && /ref: 'bbf6d:CFTO\.esp'/.test(read(path.join('game', 'gamemode', 'carriages.ts'))) &&
      ride[face].ref === 'bbf6d:CFTO.esp' && ride[face + 1].for === 'crosshair' && ride[face + 1].what === 'driver');
  const e = ride.findIndex(function (x) { return x.do === 'key' && x.code === 18; });
  const wants = ride.findIndex(function (x) { return x.for === 'message' && x.match && x.match[1] === 'ride:wants'; });
  const opened = ride.findIndex(function (x) { return x.for === 'message' && x.match && x.match[1] === 'ride:opened'; });
  const closed = ride.findIndex(function (x) { return x.for === 'message' && x.match && x.match[1] === 'ride:closed'; });
  yes('  presses E, waits for the server\'s answer and the panel, shoots it and closes it', e > face && wants > e && opened > wants &&
      ride.slice(opened).some(function (x) { return x.do === 'shot'; }) && closed > opened);
  yes('  every step of it carries the task, and it comes last, before the end', at > 0 && list.slice(at, list.length - 1).every(function (x) { return String(x.task) === '4581'; }) && list[list.length - 1].do === 'end');
}
{
  const FRONT_SRC = read(path.join('game', 'plugins', 'thornswood-front.js'));
  yes('front shares its driver rule as Thornswood.isRideDriverRef, the one E on a driver and the face step use',
      /T\.isRideDriverRef = isRideDriverRef;/.test(FRONT_SRC) && /if \(!ref \|\| !isRideDriverRef\(ref\)\) \{ return false; \}/.test(FRONT_SRC) && /T\.isRideDriverRef\(ref\)/.test(PLUGIN));
}

// Test tasks (#5197): a failing step ends its task, not the run, after its
// screenshot; the next task runs; each task gets one results line; the run
// ends failed and names the failed tasks.
{
  const g = game({ steps: [
    { do: 'wait', for: 'menu', menu: 'Nope', open: true, timeout: 100, task: 101 },
    { do: 'shot', name: 'never', task: 101 },
    { do: 'wait', for: 'time', ms: 10, task: 202 },
    { do: 'wait', for: 'time', ms: 10, task: 202 },
    { do: 'end' }
  ] });
  for (let i = 0; i < 12; i++) { g.frame(50); g.ack({ ok: true }); }
  const L = g.lines();
  const tasks = L.filter(function (l) { return l.t === 'task'; });
  const shots = L.filter(function (l) { return l.t === 'ask' && l.do === 'shot'; }).map(function (l) { return l.arg; });
  const done = L.filter(function (l) { return l.t === 'done'; })[0];
  yes('a failing step of a task takes its fail shot and fails only that task', shots.indexOf('fail-0') >= 0 && shots.indexOf('never') < 0 &&
      tasks.length === 2 && tasks[0].task === '101' && tasks[0].ok === false && /waited 100 ms for Nope/.test(tasks[0].note));
  yes('  the next task runs and passes', tasks[1].task === '202' && tasks[1].ok === true);
  yes('  and the run ends failed, naming the failed task', !!done && done.ok === false && /test task\(s\) failed: #101/.test(done.note));
}
// The cell wait: not in the Bannered Mare skips the trip's steps when the
// character is there already, and the wait for it fails naming where it is.
{
  const cell = { name: 'The Bannered Mare' };
  const g = game({ steps: [
    { do: 'wait', for: 'cell', name: 'Bannered Mare', in: false, timeout: 300, skip: 2 },
    { do: 'wait', for: 'time', ms: 99999 }, { do: 'wait', for: 'time', ms: 99999 },
    { do: 'wait', for: 'cell', name: 'Bannered Mare', timeout: 300 },
    { do: 'wait', for: 'cell', name: 'Jorrvaskr', timeout: 300, task: 9 },
    { do: 'end' }
  ] });
  g.world.cell = { getName: function () { return cell.name; } };
  for (let i = 0; i < 20; i++) { g.frame(50); }
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('the cell wait skips the trip when the character is in the Bannered Mare already', st.length >= 4 && st[0].ok && /so the next 2 step\(s\) are skipped/.test(st[0].note) && st[1].note === 'skipped' && st[2].note === 'skipped');
  yes('  then sees it there', st[3].ok && st[3].note === 'in The Bannered Mare');
  yes('  and a wait for another cell fails naming the one it is in', st.length >= 5 && st[4].ok === false && /the character is in The Bannered Mare/.test(st[4].note));
}
// A key with ifMenu presses only while one of those menus is open, and the
// shut wait holds until none is.
{
  const g = game({ steps: [
    { do: 'key', code: 1, ifMenu: ['InventoryMenu', 'TweenMenu'] },
    { do: 'key', code: 1, ifMenu: ['InventoryMenu', 'TweenMenu'] },
    { do: 'wait', for: 'shut', menus: ['InventoryMenu', 'TweenMenu'], timeout: 5000 },
    { do: 'end' }
  ] });
  g.frame(16);
  let st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('a key with ifMenu is not pressed while none of its menus is open', st.length >= 1 && st[0].ok && /so not pressed/.test(st[0].note) &&
      !g.lines().some(function (l) { return l.t === 'ask' && l.do === 'key'; }));
  g.menu('InventoryMenu', true);
  g.frame(16);
  const asked = g.lines().filter(function (l) { return l.t === 'ask' && l.do === 'key'; });
  yes('  and pressed while one is', asked.length === 1 && asked[0].arg === 1);
  g.ack({}); g.frame(16);
  g.frame(16); g.frame(16);
  st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('  and the shut wait holds while it is still open', st.length === 2);
  g.menu('InventoryMenu', false); g.frame(16);
  st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('  and passes once it shut', st.length >= 3 && st[2].ok);
}
// The dev release run: after the world, every step belongs to a task, so a
// failure stops only its own part (26 Nov: the inventory step ended the run
// and nothing after it ran), and each task after the first starts by
// shutting whatever a failed one left open.
{
  const dev = JSON.parse(read(path.join('tests', 'real-client', 'dev-release.json'))).steps;
  const tt = JSON.parse(read(path.join('tests', 'real-client', 'test-tasks.json'))).steps;
  const cut = dev.findIndex(function (x) { return x.do === 'shot' && x.name === 'in-world'; });
  const after = dev.slice(cut + 1, -1);
  yes('the dev release run puts every step after the world in a task', after.length > 0 && after.every(function (x) { return x.task !== undefined; }));
  function starts(list) {
    const out = [];
    for (let i = 1; i < list.length; i++) {
      if (list[i].task !== undefined && list[i].task !== list[i - 1].task) { out.push(i); }
    }
    return out;
  }
  function clean(list, i) {
    return list[i].do === 'key' && list[i].code === 1 && Array.isArray(list[i].ifMenu) && list[i].ifMenu.indexOf('InventoryMenu') >= 0 &&
      list[i + 1].for === 'shut' && JSON.stringify(list[i + 1].menus) === JSON.stringify(list[i].ifMenu) &&
      list[i + 2].do === 'page' && /thornswoodJournal/.test(list[i + 2].js);
  }
  const ds = starts(dev).slice(1), ts = starts(tt);
  yes('  and every task after its first starts by shutting what was left open', ds.length >= 3 && ds.every(function (i) { return clean(dev, i); }));
  yes('  the same in the test-task run, for every task', ts.length >= 7 && ts.every(function (i) { return clean(tt, i); }));
  const bed = dev.findIndex(function (x) { return x.do === 'page' && /\/tp bannered/.test(x.js || ''); });
  yes('  the trip to the inn is skipped when the character is in it already', bed > 0 && dev[bed - 1].for === 'cell' && dev[bed - 1].in === false && dev[bed - 1].skip === 3 &&
      dev[bed + 1].menu === 'Loading Menu' && dev[bed + 1].skip === 1 && dev[bed + 2].for === 'world' && dev[bed + 3].for === 'cell' && dev[bed + 3].in !== false);
  const jShut = dev.findIndex(function (x, i) { return i > cut && x.do === 'page' && /isOpen\(\)\?'shut'/.test(x.js || ''); });
  yes('  and J shutting our journal is checked, not only the game\'s', jShut > cut && dev[jShut - 1].code === 36);
}
// Mining (#4549): equip gives the pickaxe once when the pack has none, then
// equips and draws it; a held key goes as { code, hold, with }; the watches
// write what the character did, and sheathe puts the weapon away.
{
  const g = game({ steps: [
    { do: 'equip', form: '0E3C16', give: '/give pickaxe', draw: true, timeout: 5000, task: 4549 },
    { do: 'key', code: 57, task: 4549 },
    { do: 'watch', what: 'jump', ms: 1000, label: 'drawn', task: 4549 },
    { do: 'key', code: 56, hold: 2000, with: [17], task: 4549 },
    { do: 'watch', what: 'sprint', ms: 300, label: 'drawn', task: 4549 },
    { do: 'sheathe', timeout: 5000, task: 4549 },
    { do: 'end' }
  ] });
  const pick = { id: 0x0E3C16 };
  const pc = { count: 0, drawn: false, z: 0, sprint: false, equipped: null, gives: 0,
    getParentCell: function () { return g.world.cell; }, getPositionX: function () { return 0; }, getPositionY: function () { return 0; },
    getPositionZ: function () { return this.z; }, isSprinting: function () { return this.sprint; }, isWeaponDrawn: function () { return this.drawn; },
    getItemCount: function (f) { return f === pick ? this.count : 0; }, equipItem: function (f) { this.equipped = f; },
    drawWeapon: function () { this.drawn = true; }, sheatheWeapon: function () { this.drawn = false; } };
  g.world.cell = { getName: function () { return 'Iron-Breaker Mine'; } };
  g.world.pc = pc;
  g.box.skyrimPlatform.Game.getFormEx = function (id) { return id === 0x0E3C16 ? pick : null; };
  for (let i = 0; i < 5; i++) { g.frame(100); }
  const gives = g.pageRuns.filter(function (src) { return /\/give pickaxe/.test(src); });
  yes('equip says /give once while the pack has no pickaxe, and waits', gives.length === 1 && pc.equipped === null);
  pc.count = 1;
  for (let i = 0; i < 10; i++) { g.frame(100); }
  let st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('  then equips and draws it', st.length >= 1 && st[0].ok && pc.equipped === pick && pc.drawn && /drawn after/.test(st[0].note) && /given by \/give pickaxe/.test(st[0].note));
  // The jump: the key, then the character rises 60 units and comes down.
  g.ack({}); g.frame(16);
  [20, 45, 60, 40, 0].forEach(function (z) { pc.z = z; g.frame(100); });
  for (let i = 0; i < 8; i++) { g.frame(100); }
  const keyAsk = g.lines().filter(function (l) { return l.t === 'ask' && l.do === 'key'; });
  // The held sprint key: asked as one object.
  for (let i = 0; i < 3; i++) { g.frame(100); }
  const held = g.lines().filter(function (l) { return l.t === 'ask' && l.do === 'key'; });
  yes('a held key is asked as { code, hold, with }', held.length === 2 && held[1].arg && held[1].arg.code === 56 && held[1].arg.hold === 2000 && JSON.stringify(held[1].arg.with) === '[17]' && keyAsk[0].arg === 57);
  pc.sprint = true;
  g.frame(100); g.frame(100);
  g.ack({}); pc.sprint = true; g.frame(100); pc.sprint = false;
  for (let i = 0; i < 6; i++) { g.frame(100); }
  const watches = g.lines().filter(function (l) { return l.t === 'watch'; });
  yes('the jump watch writes that the character jumped, and how high', watches.length >= 1 && watches[0].what === 'jump' && watches[0].did === true && watches[0].value === 60 && watches[0].drawn === true && watches[0].label === 'drawn');
  yes('  and the sprint watch that it sprinted', watches.length >= 2 && watches[1].what === 'sprint' && watches[1].did === true);
  for (let i = 0; i < 4; i++) { g.frame(100); }
  st = g.lines().filter(function (l) { return l.t === 'step'; });
  const sh = st.filter(function (l) { return l.do === 'sheathe'; })[0];
  yes('  and sheathe puts the weapon away', !!sh && sh.ok && pc.drawn === false);
}
{
  const g = game({ steps: [{ do: 'equip', form: '0E3C16', draw: true, timeout: 500, task: 1 }, { do: 'end' }] });
  g.world.cell = {};
  g.world.pc = { getParentCell: function () { return g.world.cell; }, getPositionZ: function () { return 0; }, isSprinting: function () { return false; },
    isWeaponDrawn: function () { return false; }, getItemCount: function () { return 0; } };
  g.box.skyrimPlatform.Game.getFormEx = function () { return { id: 1 }; };
  for (let i = 0; i < 10; i++) { g.frame(100); }
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('equip with nothing to give fails, naming what is not in the pack', st.length && st[0].ok === false && /no 0E3C16 in the pack/.test(st[0].note));
}
// The mining task in the list: a Miner at the Iron-Breaker Mine, the
// pickaxe drawn before the first press, jump and sprint after each spell,
// and the second spell from sheathed.
{
  const tt = JSON.parse(read(path.join('tests', 'real-client', 'test-tasks.json'))).steps;
  const m = tt.filter(function (x) { return x.task === 4549; });
  const iEquip = m.findIndex(function (x) { return x.do === 'equip'; });
  const iSheathe = m.findIndex(function (x) { return x.do === 'sheathe'; });
  const presses = m.map(function (x, i) { return x.do === 'key' && x.code === 18 ? i : -1; }).filter(function (i) { return i >= 0; });
  const watches = m.filter(function (x) { return x.do === 'watch'; });
  yes('the mining task makes the character a Miner and goes to the Iron-Breaker Mine', m.some(function (x) { return x.do === 'page' && /\/setclass miner/.test(x.js) && /\/tp Iron-Breaker Mine/.test(x.js); }));
  yes('  draws the pickaxe before the first press on the seam, and sheathes before the second spell',
      iEquip > 0 && m[iEquip].draw === true && m[iEquip].form === '0E3C16' && m[iEquip].give === '/give pickaxe' &&
      presses.filter(function (i) { return i > iEquip && i < iSheathe; }).length === 2 && presses.filter(function (i) { return i > iSheathe; }).length === 2);
  yes('  and watches a jump and a sprint after each spell', watches.length === 4 && watches.filter(function (x) { return x.what === 'jump'; }).length === 2 &&
      m.filter(function (x) { return x.do === 'key' && x.code === 56 && x.hold >= 1000 && JSON.stringify(x.with) === '[17]'; }).length === 2);
  const pg = read(path.join('game', 'gamemode', 'staff-progression.ts'));
  const tp = read(path.join('game', 'gamemode', 'teleport.ts'));
  yes('  with lines the server takes: /setclass for oneself, /give by name', /word: '\/setclass', role: 'playtester'/.test(pg) && /word === '\/give' \|\| word === '\/spawn'/.test(tp));
}
// The test-task list starts as the dev-release run does, up to the world,
// and every step after that belongs to a test task.
{
  const dev = JSON.parse(read(path.join('tests', 'real-client', 'dev-release.json'))).steps;
  const tt = JSON.parse(read(path.join('tests', 'real-client', 'test-tasks.json'))).steps;
  const cut = dev.findIndex(function (x) { return x.do === 'shot' && x.name === 'in-world'; });
  yes('test-tasks.json joins the world with dev-release.json\'s own steps', cut > 0 && JSON.stringify(tt.slice(0, cut + 1)) === JSON.stringify(dev.slice(0, cut + 1)));
  const firstTidy = tt.findIndex(function (x) { return x.tidy === true; });
  const tasksEnd = firstTidy > 0 ? firstTidy : tt.length - 1;
  yes('  and every step after that carries its test task, but the tidy steps and the end', tt.slice(cut + 1, tasksEnd).every(function (x) { return x.task !== undefined; }) &&
      tt.slice(tasksEnd, -1).every(function (x) { return x.tidy === true && x.task === undefined; }) && tt[tt.length - 1].do === 'end');
  // The journal tasks (2135, 5429, 2563) press what the panel draws, so
  // every id and button they name is one thornswood-journal.js makes, J is
  // the front's journal key, and the limits they check are the panel's.
  const jsOf = function (task) { return tt.filter(function (x) { return x.task === task && x.do === 'page'; }).map(function (x) { return x.js; }).join('\n'); };
  const jr = read(path.join('game', 'ui', 'thornswood-journal.js'));
  const front = read(path.join('game', 'plugins', 'thornswood-front.js'));
  const jAll = [2135, 5429, 2563].map(jsOf).join('\n') + tt.filter(function (x) { return x.tidy; }).map(function (x) { return x.js; }).join('\n');
  const ids = (jAll.match(/#ts-journal-[a-z]+/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; });
  yes('  its journal steps name only ids the journal panel makes', ids.length >= 4 && /var ID = 'ts-journal';/.test(jr) &&
      ids.every(function (id) { return jr.indexOf("ID + '-" + id.slice(12)) >= 0; }));
  const verbs = (jAll.match(/act\('[a-z]+'\)/g) || []).map(function (v) { return v.slice(5, -2); });
  yes('  and only its buttons', verbs.length >= 3 && verbs.every(function (v) { return jr.indexOf('data-do="' + v + '"') >= 0; }) &&
      /data-new="1"/.test(jr) && /data-book="/.test(jr) && /data-page="/.test(jr));
  yes('  J is the journal key they press', tt.filter(function (x) { return [2135, 5429, 2563].indexOf(x.task) >= 0 && x.do === 'key' && !x.ifMenu; }).every(function (x) { return x.code === 36; }) &&
      /iniNumber\(ini, 'JournalKey', 36\)/.test(front));
  yes('  a page holds 4,000 characters, as the long-page task checks', /var PAGE_CHARS = 4000;/.test(jr) && /maxLength!==4000/.test(jsOf(2563)));
  yes('  and the presses of New are judged after the panel\'s wait for an answer', /var NEW_WAIT_MS = 3000;/.test(jr) &&
      tt.filter(function (x) { return x.task === 2135 && x.for === 'time'; }).every(function (x) { return x.ms > 3000; }));
  yes('  every page step\'s script parses', tt.every(function (x) { if (x.do !== 'page') { return true; } try { new Function('return ' + x.js); return true; } catch (e) { return false; } }));
  const tp = read(path.join('game', 'gamemode', 'teleport.ts'));
  yes('  its dice check reads the lines the server writes', /rwho \+ ' rolls ' \+ rsides \+ ': ' \+ total/.test(tp) && /rwho \+ ' rolls ' \+ rcount \+ 'x' \+ rsides \+ ': ' \+ rolls\.join\(' \+ '\) \+ ' = ' \+ total/.test(tp) && /'The number is the sides: /.test(tp));
}
// The world-runs wait: passes while updates keep coming, fails on a pause.
{
  const g = game({ steps: [{ do: 'wait', for: 'running', ms: 300, task: 7 }, { do: 'end' }] });
  for (let i = 0; i < 10; i++) { g.frame(50); }
  const ran = g.lines().filter(function (l) { return l.t === 'task'; });
  yes('the world-runs wait passes while updates keep coming', ran.length === 1 && ran[0].task === '7' && ran[0].ok === true);
}
{
  const g = game({ steps: [{ do: 'wait', for: 'running', ms: 5000, task: 8 }, { do: 'end' }] });
  g.frame(16);
  // Ticks for 1.6 s with no update between them.
  for (let i = 0; i < 4; i++) { g.tickOnly(400); }
  const st = g.lines().filter(function (l) { return l.t === 'step'; });
  yes('  and fails when the game stops sending updates (a paused world)', st.length && st[0].ok === false && /sent no update for \d+ ms/.test(st[0].note));
}

// The inventory is closed with a second I, the way Patrick wants it to
// close (26 Nov): the run checks that it does, rather than going round it
// with Tab or Escape.
{
  let list = [];
  try { list = JSON.parse(read(path.join('tests', 'real-client', 'dev-release.json')) || '{}').steps || []; } catch (e) { list = []; }
  const shut = list.findIndex(function (x) { return x.do === 'wait' && x.menu === 'InventoryMenu' && x.open === false; });
  yes('the key before the inventory close wait is a second I (23)', shut > 0 && list[shut - 1].do === 'key' && list[shut - 1].code === 23);
}

// The game's own logs are kept with the run, since the next game start
// writes over them (26 Nov: #6619's "Owner outfit" lines were gone).
{
  const RUN = read(path.join('scripts', 'dev', 'Run-RealClient.ps1')) || '';
  yes('the run keeps the SKSE logs its game wrote, under game\\',
      /\$runStarted = Get-Date/.test(RUN) && /'Profile\\MyGames\\SKSE'/.test(RUN) &&
      /Filter '\*\.log' -File \| Where-Object \{ \$_\.LastWriteTime -ge \$runStarted \}/.test(RUN) &&
      /Join-Path \$Out 'game'/.test(RUN));
  yes('  read while the game may still hold them, as launcher.log is', /\[IO\.File\]::Open\(\$f\.FullName, 'Open', 'Read', 'ReadWrite'\)/.test(RUN));
  yes('  and kept before the summary is written, so they go up with the run', RUN.indexOf("Join-Path $Out 'game'") > 0 && RUN.indexOf("Join-Path $Out 'game'") < RUN.indexOf("Compress-Archive"));
}

// The watcher starts a run by itself after a dev release (#5197's Done when:
// nobody at the PC), once per Deployment, and never over somebody's game,
// on a locked PC, or while somebody is using it.
{
  const cp = require('child_process');
  const WATCH = read(path.join('scripts', 'dev', 'Watch-RealClient.ps1')) || '';
  yes('the watcher is there and names its rule', /function Get-WatchVerdict/.test(WATCH));
  yes('it makes the run from the Deployment\'s own commit, in a worktree that goes afterwards',
      /worktree add -q --detach \$tree \$dep\.sha/.test(WATCH) && /finally \{\s*git -C \$repoRoot worktree remove --force \$tree/.test(WATCH));
  yes('it marks a Deployment started before the run, so a run that stops early is not started again',
      WATCH.indexOf('Add-Content -LiteralPath $startedFile') > 0 && WATCH.indexOf('Add-Content -LiteralPath $startedFile') < WATCH.indexOf("Run-RealClient.ps1'), '-Publish'"));
  yes('the task runs the watcher from its own worktree, moved to origin/main before every look',
      /\$watcher = Join-Path \$repoRoot 'worktrees\\real-client-watcher'/.test(WATCH) &&
      /\$look = "git -C '\$watcher' fetch -q origin main; git -C '\$watcher' checkout -q --detach origin\/main; & '" \+ \(Join-Path \$watcher 'scripts\\dev\\Watch-RealClient\.ps1'\)/.test(WATCH) &&
      /-Command "' \+ \$look/.test(WATCH));
  yes('its worktrees and temp hang off the clone, found through git\'s shared directory',
      /rev-parse --git-common-dir/.test(WATCH) && /\$repoRoot = Split-Path -Parent/.test(WATCH));
  yes('-Now runs at once when asked, skipping only the idle wait', /\[switch\]\$Now/.test(WATCH) && /if \(\$Now\) \{ \$IdleMinutes = 0 \}/.test(WATCH));
  yes('the run goes on the Deployment it was started for, not the newest when it ends',
      /'-Deployment', \[string\]\$dep\.id/.test(WATCH) && /\[string\]\$Deployment = ''/.test(RUNNER) && /deployments\/\$Deployment"/.test(RUNNER));
  yes('-Uninstall takes the watcher\'s worktree off too', /if \(\$Uninstall\) \{[\s\S]*?worktree remove --force \$watcher/.test(WATCH));
  const ver = cp.spawnSync('pwsh', ['--version'], { encoding: 'utf8' });
  if (ver.status === 0) {
    const file = path.join(REPO_DIR, 'scripts', 'dev', 'Watch-RealClient.ps1').replace(/'/g, "''");
    const script = "$ErrorActionPreference = 'Stop'\n. '" + file + "'\n" +
      "$d = [pscustomobject]@{ id = '7'; state = 'success'; lines = @('Deployed build-1.3.130') }\n" +
      "function V($dep, $started, $open, $locked, $idle, $going) { Get-WatchVerdict $dep $started $open $locked $idle 10 $going }\n" +
      "'A ' + (V $d @() $false $false 30 $false)\n" +
      "'B ' + (V ([pscustomobject]@{ id = '7'; state = 'success'; lines = @('Real game run: failed. 22 of 38 steps passed.', 'Deployed') }) @() $false $false 30 $false)\n" +
      "'C ' + (V $d @('7') $false $false 30 $false)\n" +
      "'D ' + (V $d @() $true $false 30 $false)\n" +
      "'E ' + (V $d @() $false $true 30 $false)\n" +
      "'F ' + (V $d @() $false $false 3 $false)\n" +
      "'G ' + (V $d @() $false $false 30 $true)\n" +
      "'H ' + (V ([pscustomobject]@{ id = '8'; state = 'in_progress'; lines = @() }) @() $false $false 30 $false)\n" +
      "'I ' + (V $null @() $false $false 30 $false)\n" +
      "'J ' + (V ([pscustomobject]@{ id = '9'; state = $null; lines = @() }) @() $false $false 30 $false)\n";
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 120000 });
    const out = (r.stdout || '') + (r.stderr || '');
    const said = function (k) { const m = new RegExp('^' + k + ' (.*)$', 'm').exec(out); return m ? m[1].trim() : ''; };
    yes('a new successful Deployment, nothing open, unlocked, idle: it runs', said('A') === 'run');
    yes('a Deployment that has had its run is not run again', /has had its run/.test(said('B')));
    yes('nor one it started a run for already', /was started for the newest Dev Deployment already/.test(said('C')));
    yes('not over an open launcher or game', /launcher or the game is open/.test(said('D')));
    yes('not on the lock screen', /lock screen/.test(said('E')));
    yes('not while somebody is using the PC', /somebody used the PC 3 minute/.test(said('F')));
    yes('not while its own run is going', /still going/.test(said('G')));
    yes('not before the Deployment has succeeded', /in_progress, not success/.test(said('H')));
    yes('and not with no Deployment', said('I') === 'no Dev Deployment');
    yes('a Deployment with no status yet is said so, not with a blank', said('J') === 'the newest Dev Deployment has no status yet');
    if (said('A') !== 'run') { console.log(out.split('\n').slice(0, 12).map(function (l) { return '      ' + l; }).join('\n')); }
  }
}

// A seat acceptance run observes the actual furniture event and native state.
// It neither calls Activate directly nor repairs the animation or position.
{
  function seating(options) {
    options = options || {};
    const steps = [
      { do: 'face', what: 'seat' },
      { do: 'wait', for: 'crosshair', what: 'seat', timeout: 2000 },
      { do: 'key', code: 18 },
      { do: 'wait', for: 'furniture', enter: true, timeout: 3000 },
      { do: 'wait', for: 'seated', ms: options.duration === undefined ? 60000 : options.duration },
      { do: 'key', code: 17 },
      { do: 'wait', for: 'furniture', enter: false, timeout: 3000 },
      { do: 'end' }
    ];
    const g = game({ steps: steps });
    let sit = 0, nativeRef = null;
    const calledTypes = [];
    function seat(id, x, name, workbench, occupied, bed) {
      return { bed: !!bed, workbench: workbench || 0,
        getFormID: () => id, getBaseObject: () => ({ getFormID: () => id + 0x1000,
          getType: () => 40, getName: () => name }),
        getPositionX: () => x, getPositionY: () => 0, getPositionZ: () => 0,
        getAngleZ: () => 0, getWidth: () => 80, getLength: () => 80, getHeight: () => 70,
        isFurnitureInUse: () => !!occupied };
    }
    const target = seat(0x303, 300, 'Bench', 0, options.occupied || options.allOccupied);
    const farSeat = seat(0x304, 500, 'Chair', 0, options.allOccupied);
    const refs = options.missing ? [] : [seat(0x301, 10, 'Bed', 0, false, true),
      seat(0x302, 50, 'Crafting Bench', 1), target, farSeat];
    const cell = { getNumRefs: type => { calledTypes.push(type); return refs.length; }, getNthRef: i => refs[i] };
    g.world.cell = cell;
    g.world.pc = { getFormID: () => 0x14, getParentCell: () => g.world.cell,
      getPositionX: () => 0, getPositionY: () => 0, getPositionZ: () => 0,
      setPosition: () => {}, setAngle: () => {}, getSitState: () => sit,
      getFurnitureReference: () => nativeRef };
    g.box.Thornswood.isBedRef = r => !!(r && r.bed);
    g.box.skyrimPlatform.getWorkbenchType = id => {
      const r = refs.find(x => x.getBaseObject().getFormID() === id); return r ? r.workbench : 0;
    };
    g.box.skyrimPlatform.Game.forceFirstPerson = () => {};
    g.world.crosshair = options.occupied ? farSeat : target;
    function advance(n, ms) { for (let i = 0; i < n; i++) { g.frame(ms || 100); g.ack(); } }
    function enter(actor, ref) {
      sit = 3; nativeRef = ref === undefined ? target : ref;
      g.fire('furnitureEnter', { actor: { getFormID: () => actor || 0x14 }, target: nativeRef });
    }
    function exit() {
      sit = 0; nativeRef = null;
      g.fire('furnitureExit', { actor: { getFormID: () => 0x14 }, target: target });
    }
    return { g, target, advance, enter, exit, calledTypes,
      state: value => { sit = value; }, nativeRef: value => { nativeRef = value; },
      steps: () => g.lines().filter(l => l.t === 'step'),
      presses: () => g.lines().filter(l => l.t === 'ask' && l.do === 'key') };
  }
  const normal = seating(); normal.advance(12);
  yes('seat fixture faces the closest valid non-bed, noncraft chair or bench in this room',
    normal.steps()[0]?.ok && /before seat 303/.test(normal.steps()[0].note) &&
    normal.calledTypes.every(x => x === 40));
  yes('one normal E press is requested, with no direct Activate call',
    normal.presses().filter(x => x.arg === 18).length === 1);
  normal.enter(); normal.advance(2);
  yes('a fresh own enter and native seated state pass the entry wait', normal.steps()[3]?.ok === true);
  normal.advance(59, 1000);
  yes('the seat hold cannot pass before its full minute', !normal.steps()[4]);
  normal.advance(2, 1000);
  yes('the uninterrupted native seated minute passes', normal.steps()[4]?.ok === true);
  const holdReceipt = normal.g.lines().filter(l => l.t === 'seated-observation');
  yes('a successful hold emits one bounded native sampling receipt', holdReceipt.length === 1 &&
    holdReceipt[0].ref === '303' && holdReceipt[0].ms >= 60000 && holdReceipt[0].samples >= 60 && holdReceipt[0].maxGap <= 1000);
  normal.advance(3); normal.exit(); normal.advance(3);
  yes('only the intentional movement follows the hold and its own Exit ends the wait',
    normal.presses().filter(x => x.arg === 17).length === 1 && normal.steps()[6]?.ok === true);

  const staleExit = seating(); staleExit.advance(12); staleExit.enter(); staleExit.advance(3); staleExit.advance(61, 1000); staleExit.advance(3);
  staleExit.exit(); staleExit.nativeRef(staleExit.target); staleExit.advance(35);
  yes('an Exit event with a stale native furniture ref cannot pass standing verification', staleExit.steps()[6]?.ok === false);
  const missingEvent = seating(); missingEvent.advance(12); missingEvent.state(3); missingEvent.advance(35);
  yes('native seated state without furnitureEnter cannot pass acceptance', missingEvent.steps()[3]?.ok === false);
  const otherActor = seating(); otherActor.advance(12); otherActor.enter(0x99); otherActor.advance(35);
  yes('another actor entering does not count as the runner entering', otherActor.steps()[3]?.ok === false);
  const wrongTarget = seating(); wrongTarget.advance(12);
  wrongTarget.enter(0x14, { getFormID: () => 0x304, getBaseObject: () => ({ getName: () => 'Bench' }) }); wrongTarget.advance(35);
  yes('an enter for another same-named seat does not verify the target', wrongTarget.steps()[3]?.ok === false && /fresh own furnitureEnter/.test(wrongTarget.steps()[3].note));
  const premature = seating(); premature.advance(12); premature.enter(); premature.advance(3); premature.exit(); premature.advance(3);
  yes('a premature Exit fails the hold', premature.steps()[4]?.ok === false);
  const silent = seating(); silent.advance(12); silent.enter(); silent.advance(3); silent.state(0); silent.advance(3);
  yes('native unseating without Exit also fails the hold', silent.steps()[4]?.ok === false);
  const reentry = seating(); reentry.advance(12); reentry.enter(); reentry.advance(3); reentry.exit(); reentry.enter(); reentry.advance(3);
  yes('Exit followed by immediate reentry cannot conceal a broken hold', reentry.steps()[4]?.ok === false);
  const lostWorld = seating(); lostWorld.advance(12); lostWorld.enter(); lostWorld.advance(3); lostWorld.g.world.cell = null; lostWorld.advance(2);
  yes('a lost room fails instead of counting time outside the world', lostWorld.steps()[4]?.ok === false && /lost the world/.test(lostWorld.steps()[4].note));
  const paused = seating(); paused.advance(12); paused.enter(); paused.advance(3); paused.g.tickOnly(1500);
  yes('lost update/world progress fails with a verification error', paused.steps()[4]?.ok === false);
  const blocked = seating(); blocked.advance(12); blocked.enter(); blocked.advance(3); blocked.g.frame(1500);
  yes('a gap with neither ticks nor updates cannot be counted as continuous seating', blocked.steps()[4]?.ok === false);
  const gap = seating(); gap.advance(12); gap.enter(); gap.advance(1); gap.exit(); gap.enter(); gap.advance(3);
  yes('an Exit/reentry between entry confirmation and the first hold tick still fails', gap.steps()[4]?.ok === false);
  const flicker = seating(); flicker.advance(12); flicker.enter(); flicker.advance(3); flicker.nativeRef(null); flicker.advance(61, 1000);
  yes('a null native furniture reference cannot verify the exact occupied target', flicker.steps()[4]?.ok === false);
  const switched = seating(); switched.advance(12); switched.enter(); switched.advance(3);
  switched.nativeRef({ getFormID: () => 0x999 }); switched.advance(3);
  yes('native furniture changing to another reference fails the hold', switched.steps()[4]?.ok === false);
  const missingApi = seating(); missingApi.g.box.skyrimPlatform.getWorkbenchType = undefined; missingApi.advance(5);
  yes('missing bench classification is an explicit verification error', missingApi.steps()[0]?.ok === false && /getWorkbenchType/.test(missingApi.steps()[0].note));
  const occupied = seating({ occupied: true }); occupied.advance(12);
  yes('an occupied nearest seat is skipped for the closest valid free seat', occupied.steps()[0]?.ok && /before seat 304/.test(occupied.steps()[0].note));
  const allOccupied = seating({ allOccupied: true }); allOccupied.advance(5);
  yes('an entirely occupied room reports that no valid seat is available', allOccupied.steps()[0]?.ok === false && /no seat/.test(allOccupied.steps()[0].note));
  const badDuration = seating({ duration: 0 }); badDuration.advance(12); badDuration.enter(); badDuration.advance(3);
  yes('a missing positive observation interval cannot pass a seat hold', badDuration.steps()[4]?.ok === false);
  const absent = seating({ missing: true }); absent.advance(5);
  yes('no ordinary seat in the local room is an actionable failure', absent.steps()[0]?.ok === false && /no seat/.test(absent.steps()[0].note));
}

{
  const seatRun = JSON.parse(read('tests/real-client/bench-seat.json')).steps;
  const defaultSteps = JSON.parse(read('tests/real-client/dev-release.json')).steps;
  const prefix = defaultSteps.findIndex(s => s.do === 'shot' && s.name === 'in-world') + 1;
  yes('the separate seat fixture preserves the exact canonical choice/world preamble', prefix > 0 &&
    JSON.stringify(seatRun.slice(0, prefix)) === JSON.stringify(defaultSteps.slice(0, prefix)));
  const face = seatRun.findIndex(s => s.do === 'face' && s.what === 'seat');
  const hold = seatRun.findIndex(s => s.do === 'wait' && s.for === 'seated');
  const exit = seatRun.findIndex(s => s.do === 'key' && s.code === 17);
  yes('the separate seat recipe uses exactly one normal E interaction', seatRun.filter(s => s.do === 'key' && s.code === 18).length === 1);
  yes('it waits for its own entry, holds a minute and exits intentionally in that order',
    face >= 0 && seatRun.slice(face, hold).some(s => s.for === 'furniture' && s.enter === true) &&
    seatRun[hold].ms === 60000 && exit > hold && seatRun.slice(exit).some(s => s.for === 'furniture' && s.enter === false));
  yes('the seat fixture does not send a fabricated rest command', !JSON.stringify(seatRun).includes('/rest '));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
