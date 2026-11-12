// ---------------------------------------------------------------------------
// Thornswood: the scripted real game run (#5197).
//
// Some failures only show in the real game: the choice page that froze, the
// journal that crashed it, the launcher's Play, the load order. GitHub's
// runners have no graphics card and no Skyrim, so the real game runs on One,
// started by scripts\test\Run-RealClient.ps1, and this plugin walks it
// through a list of steps while the runner watches.
//
// IT DOES NOTHING unless the runner left a run behind. The runner writes
// Data/Platform/thornswood-test-run.json before it presses Play in the
// launcher; this plugin reads it once, deletes it so the next ordinary Play
// does not run it again, and goes through its steps. Like the mark plugin it
// also needs the site's dev answer on disk (../Profile/dev-allowed.txt), so a
// retail client never runs one even with a file planted beside it. With no
// run file this plugin reads two files at the first tick and stops.
//
// How the two talk. Everything this plugin finds goes in one line of JSON per
// event in Data/Platform/thornswood-test-results.jsonl, which the runner reads
// as it grows. What only the runner can do, a screenshot of the whole window
// (the game and our page over it) or a real key press through Windows, is an
// "ask" line with a number; the runner does it and writes that number to
// Data/Platform/thornswood-test-ack.txt, and the step is over when the number
// is there. So a screenshot is of the screen the step before it reached, and
// a key press has landed before the next step looks for what it did.
//
// The steps (tests\real-client\README.md has the long form):
//   {"do":"wait","for":"menu","menu":"Main Menu","open":true}
//   {"do":"wait","for":"world"}            in a cell, no loading screen
//   {"do":"wait","for":"message","match":["thornswood-front","journal:opened"]}
//   {"do":"page","js":"<an expression>"}   true, a number or a word passes
//   {"do":"shot","name":"journal-open"}
//   {"do":"key","code":36}                 a DirectInput scan code (J is 36)
//   {"do":"end"}
// Each takes "timeout" in milliseconds (30000 when not given). The run stops
// at the first step that fails, after a screenshot named fail-<step>, and
// the last line says how it went.
// ---------------------------------------------------------------------------

// ------------------------------------------------------------ whose game ----
// thornswood-front.js owns the whose-game check (issue #485): the client
// settings must point at this server and the launcher's session note must be
// fresh, or every Thornswood plugin stays idle. Front publishes the check as
// globalThis.Thornswood.whoseGame, and only when it says ours. This plugin
// runs nothing until the first tick: Skyrim Platform runs every file in
// Data/Platform/Plugins in one pass and sends that tick after the pass
// (TickImpl in the fork's skyrim-platform SkyrimPlatform.cpp), so by then
// front has published the check or did not load, whichever order the files
// came in. Nothing published means idle; so does the check saying not ours.
(function (start) {
  skyrimPlatform.once('tick', function () {
    const T = globalThis.Thornswood;
    if (!T || typeof T.whoseGame !== 'function' || !T.whoseGame()) { return; }
    start();
  });
})(function () {
'use strict';

const sp = skyrimPlatform;
const fs = require('fs');

const RUN = 'Data/Platform/thornswood-test-run.json';
const OUT = 'Data/Platform/thornswood-test-results.jsonl';
const ACK = 'Data/Platform/thornswood-test-ack.txt';
const DEV = '../Profile/dev-allowed.txt';
const TIMEOUT = 30000;

function log() {
  try { sp.printConsole('[test] ' + Array.prototype.slice.call(arguments).join(' ')); } catch (e) { }
}

// The site's dev answer first, then the run. Either missing: nothing else
// in this file runs.
try { fs.readFileSync(DEV, 'utf8'); } catch (e) { return; }
let run = null;
try { run = JSON.parse(fs.readFileSync(RUN, 'utf8')); } catch (e) { run = null; }
if (!run || !Array.isArray(run.steps) || run.steps.length === 0) { return; }
try { fs.unlinkSync(RUN); } catch (e) { log('could not delete the run file, so the next Play would run it again:', e); }

const runId = String(run.id || '');
const steps = run.steps;

function write(obj) {
  obj.run = runId;
  obj.at = Date.now();
  try { fs.appendFileSync(OUT, JSON.stringify(obj) + '\n'); }
  catch (e) { log('could not write a result:', e); }
}

write({ t: 'start', steps: steps.length, platform: (function () { try { return sp.getPlatformVersion(); } catch (e) { return ''; } })() });
log('run', runId, 'with', steps.length, 'steps');

// ---------------------------------------------------------- what we see ----
// Menus from their events, which come at the main menu too, where update
// (and so any call into the game) does not run yet.
const openMenus = {};
sp.on('menuOpen', function (e) {
  const name = String((e && e.name) || '');
  openMenus[name] = true;
  write({ t: 'menu', name: name, open: true });
});
sp.on('menuClose', function (e) {
  const name = String((e && e.name) || '');
  delete openMenus[name];
  write({ t: 'menu', name: name, open: false });
});

// In the world: read on update, which only runs once there is a game.
let inWorld = false;
sp.on('update', function () {
  let cell = null;
  try { const pc = sp.Game.getPlayer(); cell = pc ? pc.getParentCell() : null; } catch (e) { cell = null; }
  inWorld = !!cell && !openMenus['Loading Menu'] && !openMenus['Main Menu'];
});

// Every message the page sends, kept with when it came, so a step can look
// for one that arrived since the step before it started. Our own page
// answers come back here too, under 'thornswood-test'.
const messages = [];
const pageAnswers = {};
sp.on('browserMessage', function (e) {
  const a = (e && e.arguments) || [];
  if (a[0] === 'thornswood-test' && a[1] === 'page') {
    pageAnswers[String(a[2])] = String(a[3]);
    return;
  }
  messages.push({ at: Date.now(), args: a.map(function (x) { return String(x); }) });
  if (messages.length > 500) { messages.shift(); }
});

function matches(args, want) {
  for (let i = 0; i < want.length; i++) {
    if (String(args[i]) !== String(want[i])) { return false; }
  }
  return true;
}

// --------------------------------------------------- asking the runner ----
let askNo = 0;
let ackSeen = 0;
let ackReadAt = 0;
function ask(what, arg) {
  askNo++;
  write({ t: 'ask', n: askNo, do: what, arg: arg });
  return askNo;
}
function acked(n) {
  const now = Date.now();
  if (ackSeen < n && now - ackReadAt >= 250) {
    ackReadAt = now;
    try { ackSeen = Number(String(fs.readFileSync(ACK, 'utf8')).trim()) || 0; } catch (e) { }
  }
  return ackSeen >= n;
}

// ----------------------------------------------------------- the steps ----
let at = 0;            // the step being run
let stepAt = 0;        // when it started
let prevAt = 0;        // when the step before it started
let waitingAsk = 0;    // the ask this step waits on
let pageId = '';       // the page question this step waits on
let pageAskedAt = 0;
let failing = false;   // the fail screenshot is being taken
let finished = false;
let passed = 0;

function pass(note) {
  write({ t: 'step', i: at, do: steps[at].do, ok: true, ms: Date.now() - stepAt, note: note || '' });
  passed++;
  next();
}
function fail(note) {
  write({ t: 'step', i: at, do: steps[at].do, ok: false, ms: Date.now() - stepAt, note: note || '' });
  log('step', at, 'failed:', note);
  failing = true;
  waitingAsk = ask('shot', 'fail-' + at);
  stepAt = Date.now();
}
function next() {
  at++;
  prevAt = stepAt;
  stepAt = Date.now();
  waitingAsk = 0;
  pageId = '';
}
function end(ok, note) {
  finished = true;
  write({ t: 'done', ok: ok, passed: passed, steps: steps.length, note: note || '' });
  log('run', runId, ok ? 'passed' : 'failed', passed + '/' + steps.length);
  ask('end', ok ? 'pass' : 'fail');
}

function answerPasses(a) {
  return a !== undefined && a !== '' && a !== 'false' && a !== 'null' && a !== 'undefined' && a !== '0' && a.charAt(0) !== '!';
}

stepAt = Date.now();
prevAt = stepAt;

sp.on('tick', function () {
  if (finished) { return; }
  const now = Date.now();

  if (failing) {
    if (acked(waitingAsk) || now - stepAt > TIMEOUT) { end(false, 'step ' + at + ' failed'); }
    return;
  }
  if (at >= steps.length) { end(true); return; }

  const s = steps[at] || {};
  const limit = Number(s.timeout) || TIMEOUT;
  const late = now - stepAt > limit;

  switch (s.do) {
    case 'wait': {
      if (s.for === 'menu') {
        const want = s.open !== false;
        if (!!openMenus[String(s.menu)] === want) { pass(); return; }
      } else if (s.for === 'world') {
        if (inWorld) { pass(); return; }
      } else if (s.for === 'message') {
        const want = Array.isArray(s.match) ? s.match : [];
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].at < prevAt) { break; }
          if (matches(messages[i].args, want)) { pass(messages[i].args.join(' ')); return; }
        }
      } else {
        fail('no such wait: ' + s.for);
        return;
      }
      if (late) { fail('waited ' + limit + ' ms for ' + (s.for === 'menu' ? s.menu + (s.open === false ? ' to close' : ' to open') : s.for === 'message' ? JSON.stringify(s.match) : 'the world')); }
      return;
    }
    case 'page': {
      // Asked again every half second until the answer passes, because the
      // thing asked about (a panel drawn, a button there) may come later.
      if (pageId && answerPasses(pageAnswers[pageId])) { pass(pageAnswers[pageId]); return; }
      if (late) { fail('the page said ' + JSON.stringify(pageId ? pageAnswers[pageId] : undefined) + ' to ' + String(s.js).slice(0, 200)); return; }
      if (!pageId || now - pageAskedAt >= 500) {
        pageId = runId + '-' + at + '-' + now;
        pageAskedAt = now;
        const src = 'try{var r=(' + String(s.js) + ');window.skyrimPlatform.sendMessage("thornswood-test","page",' +
          JSON.stringify(pageId) + ',String(r));}catch(e){try{window.skyrimPlatform.sendMessage("thornswood-test","page",' +
          JSON.stringify(pageId) + ',"!"+e);}catch(e2){}}';
        try { sp.browser.executeJavaScript(src); } catch (e) { fail('executeJavaScript threw: ' + e); }
      }
      return;
    }
    case 'shot':
    case 'key': {
      if (!waitingAsk) { waitingAsk = ask(s.do, s.do === 'shot' ? String(s.name || ('step-' + at)) : Number(s.code)); return; }
      if (acked(waitingAsk)) { pass(); return; }
      if (late) { fail('the runner did not answer ' + s.do + ' in ' + limit + ' ms'); }
      return;
    }
    case 'end':
      end(true);
      return;
    default:
      fail('no such step: ' + s.do);
  }
});
});
