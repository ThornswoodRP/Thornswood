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
// "ask" line with a number; the runner writes {n,ok,note} to
// Data/Platform/thornswood-test-ack.txt. A rejected key fails its step.
// Successful input means Windows accepted both events and focus checks
// passed; the following menu, message or page check must prove its effect.
//
// The steps (tests\real-client\README.md has the long form):
//   {"do":"wait","for":"menu","menu":"Main Menu","open":true}
//   {"do":"wait","for":"world"}            in a cell, no loading screen
//   {"do":"wait","for":"message","match":["thornswood-front","journal:opened"]}
//   {"do":"page","js":"<an expression>"}   true, a number or a word passes
//   {"do":"shot","name":"journal-open"}
//   {"do":"key","code":36}                 a DirectInput scan code (J is 36)
//   {"do":"face","what":"bed"}             stand before the nearest bed in the cell
//   {"do":"wait","for":"crosshair","what":"bed"}
//   {"do":"wait","for":"time","ms":1500}   a pause, so a shot catches a message
//   {"do":"wait","for":"running","ms":10000}  the world kept running that long
// Any step may carry "task": <issue>; a failing one ends that test task and
// the run goes on with the next.
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
const INVENTORY_TRACE_MS = 5000;

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
// When each menu last opened and last closed, as well as which are open
// now: steps run on tick, and tick does not come while a loading screen is
// up, so a Loading Menu that opened and closed between two ticks was never
// seen open (16 Nov: the trip from the hall to Whiterun, about a second).
const openMenus = {};
const menuOpenedAt = {};
const menuClosedAt = {};
sp.on('menuOpen', function (e) {
  const name = String((e && e.name) || '');
  openMenus[name] = true;
  menuOpenedAt[name] = Date.now();
  write({ t: 'menu', name: name, open: true });
});
sp.on('menuClose', function (e) {
  const name = String((e && e.name) || '');
  delete openMenus[name];
  menuClosedAt[name] = Date.now();
  write({ t: 'menu', name: name, open: false });
});

// In the world: read on update, which only runs once there is a game.
// The steps run on tick, where a call into the game is refused ("can't be
// called in this context"), so what a step needs from the game is read or
// done here and left for the step to pick up.
let inWorld = false;
let crosshairBed = '';     // the bed under the crosshair now, or ''
let faceAsked = '';        // what a face step wants stood before
let faceDone = null;       // { ok, note } once the update has done it
let faceTry = null;        // the bed and the spots beside it still to try
let cellName = '';         // the name of the cell the character is in
function isBed(ref) {
  const T = globalThis.Thornswood;
  return !!(T && typeof T.isBedRef === 'function' && T.isBedRef(ref));
}
function refName(ref) {
  let id = 0, name = '';
  try { id = ref.getFormID(); } catch (e) { log('could not read a reference id:', e); }
  try { const b = ref.getBaseObject(); name = b ? String(b.getName() || '') : ''; } catch (e) { log('could not read a reference name:', e); }
  return (id >>> 0).toString(16) + (name ? ' "' + name + '"' : '');
}
// Stand beside the nearest bed in the cell, turned to it and looking down at
// it, as somebody walks up to a bed to use it. 40 is kFurniture.
//
// Where beside it is measured, not guessed: a bed stands against a wall on
// some sides, and which of its sides are free differs bed to bed. So the
// spots on its four sides, 45 units clear of its bounds (GetWidth along its
// own x, GetLength along its own y), are tried in turn, nearest to the
// character first, and the first from which the crosshair lands on that bed
// is the one. The camera goes to first person so the crosshair is the eyes'
// line. Each spot gets FACE_LOOK_MS before the crosshair is read, and every
// spot that does not see the bed is said in the step's note.
const FACE_LOOK_MS = 400;
const EYE_HEIGHT = 115;
function faceStart() {
  const pc = sp.Game.getPlayer();
  const cell = pc ? pc.getParentCell() : null;
  if (!cell) { return { ok: false, note: 'not in a cell' }; }
  const T = globalThis.Thornswood;
  if (!T || typeof T.isBedRef !== 'function') { return { ok: false, note: 'thornswood-front.js shares no isBedRef, so this build cannot tell a bed' }; }
  const px = pc.getPositionX(), py = pc.getPositionY(), pz = pc.getPositionZ();
  let best = null, bestD = Infinity, beds = 0;
  const n = cell.getNumRefs(40);
  for (let i = 0; i < n; i++) {
    const ref = cell.getNthRef(i, 40);
    if (!ref || !isBed(ref)) { continue; }
    beds++;
    const d = Math.hypot(ref.getPositionX() - px, ref.getPositionY() - py, (ref.getPositionZ() - pz) * 2);
    if (d < bestD) { bestD = d; best = ref; }
  }
  if (!best) { return { ok: false, note: 'no bed among the ' + n + ' furniture in this cell' }; }
  const bx = best.getPositionX(), by = best.getPositionY(), bz = best.getPositionZ();
  const h = best.getAngleZ() * Math.PI / 180;
  // The bed's own axes on the ground: y is where its heading points
  // (0 is north, clockwise), x is to its right.
  const ax = { x: Math.cos(h), y: -Math.sin(h) }, ay = { x: Math.sin(h), y: Math.cos(h) };
  const halfW = (Number(best.getWidth()) || 100) / 2, halfL = (Number(best.getLength()) || 200) / 2;
  const top = bz + Math.min(60, (Number(best.getHeight()) || 60) * 0.6);
  const spots = [
    { side: 'right', x: bx + ax.x * (halfW + 45), y: by + ax.y * (halfW + 45) },
    { side: 'left', x: bx - ax.x * (halfW + 45), y: by - ax.y * (halfW + 45) },
    { side: 'foot', x: bx - ay.x * (halfL + 45), y: by - ay.y * (halfL + 45) },
    { side: 'head', x: bx + ay.x * (halfL + 45), y: by + ay.y * (halfL + 45) }
  ].sort(function (p, q) { return Math.hypot(p.x - px, p.y - py) - Math.hypot(q.x - px, q.y - py); });
  try { sp.Game.forceFirstPerson(); } catch (e) { log('could not go to first person:', e); }
  faceTry = { bed: best, name: refName(best), beds: beds, off: Math.round(bestD), bx: bx, by: by, bz: bz, top: top, spots: spots, k: -1, at: 0, missed: [] };
  return null;
}
// One look per update: put the character on the next spot, or read whether
// the crosshair found the bed from the spot it was put on.
function faceStep() {
  const f = faceTry, now = Date.now();
  if (f.k >= 0 && now - f.at < FACE_LOOK_MS) { return null; }
  if (f.k >= 0) {
    let on = '';
    try { const r = sp.Game.getCurrentCrosshairRef(); on = r ? refName(r) : ''; } catch (e) { log('could not read the crosshair:', e); }
    if (on === f.name) {
      faceTry = null;
      return { ok: true, note: 'before bed ' + f.name + ' from its ' + f.spots[f.k].side + ', ' + f.beds + ' bed(s) in the cell, it was ' + f.off + ' units off' + (f.missed.length ? '; not from ' + f.missed.join(', ') : '') };
    }
    f.missed.push(f.spots[f.k].side + ' (' + (on || 'nothing') + ' under the crosshair)');
  }
  f.k++;
  if (f.k >= f.spots.length) {
    faceTry = null;
    return { ok: false, note: 'bed ' + f.name + ' was under the crosshair from none of its sides: ' + f.missed.join(', ') };
  }
  const pc = sp.Game.getPlayer(), s = f.spots[f.k];
  pc.setPosition(s.x, s.y, f.bz);
  const dist = Math.hypot(f.bx - s.x, f.by - s.y) || 1;
  // Papyrus angles are degrees. Heading 0 is north (+y), turning clockwise;
  // a positive x looks down, here from the eyes to the top of the bed.
  pc.setAngle(Math.atan2(f.bz + EYE_HEIGHT - f.top, dist) * 180 / Math.PI, 0, Math.atan2(f.bx - s.x, f.by - s.y) * 180 / Math.PI);
  f.at = now;
  return null;
}
let lastUpdateAt = 0;
const updateTimes = [];
function updatesSince(t) {
  let n = 0;
  for (let i = updateTimes.length - 1; i >= 0 && updateTimes[i] >= t; i--) { n++; }
  return n;
}
sp.on('update', function () {
  lastUpdateAt = Date.now();
  updateTimes.push(lastUpdateAt);
  if (updateTimes.length > 2000) { updateTimes.splice(0, updateTimes.length - 2000); }
  let cell = null;
  try { const pc = sp.Game.getPlayer(); cell = pc ? pc.getParentCell() : null; } catch (e) { cell = null; }
  inWorld = !!cell && !openMenus['Loading Menu'] && !openMenus['Main Menu'];
  try { cellName = cell ? String(cell.getName() || '') : ''; } catch (e) { cellName = ''; log('could not read the cell name:', e); }
  crosshairBed = '';
  try { const r = sp.Game.getCurrentCrosshairRef(); if (r && isBed(r)) { crosshairBed = refName(r); } } catch (e) { log('could not read the crosshair:', e); }
  if (faceAsked && !faceDone) {
    try {
      if (faceAsked !== 'bed') { faceDone = { ok: false, note: 'cannot face a ' + faceAsked }; }
      else { faceDone = faceTry ? faceStep() : faceStart(); }
    } catch (e) { faceTry = null; faceDone = { ok: false, note: 'facing threw: ' + e }; }
  }
});

// Sitting down and getting up, the character's own only, as results lines:
// whether somebody lay down in a bed is what #6712 asks.
sp.on('furnitureEnter', function (e) {
  try {
    if (!e || !e.actor || e.actor.getFormID() !== 0x14) { return; }
    write({ t: 'furniture', enter: true, bed: isBed(e.target), ref: e.target ? refName(e.target) : '' });
  } catch (err) { log('could not note sitting down:', err); }
});
sp.on('furnitureExit', function (e) {
  try {
    if (!e || !e.actor || e.actor.getFormID() !== 0x14) { return; }
    write({ t: 'furniture', enter: false, bed: isBed(e.target), ref: e.target ? refName(e.target) : '' });
  } catch (err) { log('could not note getting up:', err); }
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
let ackSeen = null;
let ackReadAt = 0;
function ask(what, arg) {
  askNo++;
  write({ t: 'ask', n: askNo, do: what, arg: arg });
  return askNo;
}
function readAck(n) {
  const now = Date.now();
  if ((!ackSeen || ackSeen.n !== n) && now - ackReadAt >= 250) {
    ackReadAt = now;
    try {
      const reply = JSON.parse(String(fs.readFileSync(ACK, 'utf8')).trim());
      // Older runners write just the ask number. That can still finish a
      // screenshot, but it says nothing about keyboard delivery.
      ackSeen = typeof reply === 'number' ? { n: reply, legacy: true } : reply;
    } catch (e) { }
  }
  return ackSeen && ackSeen.n === n ? ackSeen : null;
}
function acked(n) {
  return !!readAck(n);
}

// ----------------------------------------------------------- the steps ----
let at = 0;            // the step being run
let stepAt = 0;        // when it started
let prevAt = 0;        // when the step before it started
let waitingAsk = 0;    // the ask this step waits on
let pageId = '';       // the page question this step waits on
let pageAskedAt = 0;
let failing = false;   // the fail screenshot is being taken
let failNote = '';     // what the failing step said
let finished = false;
let passed = 0;
// Test tasks (#5197): steps that carry "task": <issue> belong to that test
// task. One that fails ends its task, not the run: the run goes on at the
// first step of the next task, so one list checks many tasks and each has its
// own "task" results line, passed or failed.
const failedTasks = [];
let inventoryKey = null;

// Windows acknowledging a press and Skyrim routing it are two observations.
// Only explicitly traced script steps can log their own requested key.
if (steps.some(s => s && s.do === 'key' && s.inventoryTrace === true)) {
  sp.on('buttonEvent', function (e) {
    if (finished || failing || !inventoryKey || Date.now() > inventoryKey.until ||
        !e || e.device !== 0 || e.code !== inventoryKey.code || e.isRepeating || e.isHeld) return;
    const phase = e.isDown && !e.isUp ? 'down' : e.isUp && !e.isDown ? 'up' : '';
    if (!phase || inventoryKey[phase]) return;
    inventoryKey[phase] = true;
    const action = e.userEventName === 'Quick Inventory' ? 'inventory' : e.userEventName ? 'other' : 'none';
    write({ t: 'inventory-key', i: inventoryKey.i, phase: phase, action: action,
      inventoryOpen: !!openMenus['InventoryMenu'] });
  });
}

function pass(note) {
  write({ t: 'step', i: at, do: steps[at].do, ok: true, ms: Date.now() - stepAt, note: note || '' });
  passed++;
  next();
}
function fail(note) {
  write({ t: 'step', i: at, do: steps[at].do, ok: false, ms: Date.now() - stepAt, note: note || '' });
  log('step', at, 'failed:', note);
  failNote = String(note || '');
  failing = true;
  waitingAsk = ask('shot', 'fail-' + at);
  stepAt = Date.now();
}
// A wait with "skip": n that does not see what it waits for in its time is
// no failure: what it waits for happens only sometimes (creation, for a
// character the server has not got), and the next n steps are the ones that
// deal with it, so they are passed over and said so.
function skipOn(note) {
  const s = steps[at];
  const n = Math.max(0, Math.floor(Number(s.skip) || 0));
  write({ t: 'step', i: at, do: s.do, ok: true, ms: Date.now() - stepAt, note: note + ', so the next ' + n + ' step(s) are skipped' });
  passed++;
  next();
  for (let k = 0; k < n && at < steps.length; k++) {
    write({ t: 'step', i: at, do: steps[at].do, ok: true, ms: 0, note: 'skipped' });
    passed++;
    next();
  }
}
function taskOf(i) {
  const s = steps[i];
  return s && s.task !== undefined ? String(s.task) : '';
}
function next() {
  const task = taskOf(at);
  at++;
  if (task && taskOf(at) !== task && failedTasks.indexOf(task) < 0) { write({ t: 'task', task: task, ok: true }); }
  prevAt = stepAt;
  stepAt = Date.now();
  waitingAsk = 0;
  pageId = '';
}
// The failing step of a task has had its screenshot: the task is failed and
// the run goes on at the next task's first step.
function failTask() {
  const task = taskOf(at);
  failedTasks.push(task);
  write({ t: 'task', task: task, ok: false, step: at, note: failNote });
  failing = false;
  while (at < steps.length && taskOf(at) === task) { at++; }
  prevAt = stepAt;
  stepAt = Date.now();
  waitingAsk = 0;
  pageId = '';
  faceAsked = '';
  faceDone = null;
  faceTry = null;
}
function tasksNote() {
  return failedTasks.length ? 'test task(s) failed: ' + failedTasks.map(function (t) { return '#' + t; }).join(', ') : '';
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
    if (acked(waitingAsk) || now - stepAt > TIMEOUT) {
      if (taskOf(at)) { failTask(); } else { end(false, ['step ' + at + ' failed', tasksNote()].filter(Boolean).join('; ')); }
    }
    return;
  }
  if (at >= steps.length) { end(failedTasks.length === 0, tasksNote()); return; }

  const s = steps[at] || {};
  const limit = Number(s.timeout) || TIMEOUT;
  const late = now - stepAt > limit;

  switch (s.do) {
    case 'wait': {
      if (s.for === 'menu') {
        // Open (or shut) now, or it opened (or closed) since the step before
        // this one started, as a message counts for the wait after a key.
        const want = s.open !== false;
        const name = String(s.menu);
        const since = want ? menuOpenedAt[name] : menuClosedAt[name];
        if (!!openMenus[name] === want) { pass(); return; }
        if (since !== undefined && since >= prevAt) { pass(want ? 'it opened and closed again before this tick' : 'it closed and opened again before this tick'); return; }
      } else if (s.for === 'world') {
        if (inWorld) { pass(); return; }
      } else if (s.for === 'shut') {
        // None of "menus" is open.
        const up = (Array.isArray(s.menus) ? s.menus : []).filter(function (m) { return !!openMenus[String(m)]; });
        if (!up.length) { pass(); return; }
        if (late) { fail('waited ' + limit + ' ms for ' + up.join(', ') + ' to shut'); }
        return;
      } else if (s.for === 'cell') {
        // In (or, with "in": false, not in) a cell whose name holds "name".
        const want = s.in !== false;
        const here = cellName.toLowerCase().indexOf(String(s.name || '').toLowerCase()) >= 0 && cellName !== '';
        if (inWorld && here === want) { pass(cellName ? 'in ' + cellName : 'in an unnamed cell'); return; }
      } else if (s.for === 'crosshair') {
        if (s.what === 'bed' && crosshairBed) { pass('bed ' + crosshairBed); return; }
      } else if (s.for === 'running') {
        // The world runs while a menu is up: update, which the game sends
        // only while it is not paused, kept coming for ms with no gap of a
        // second (#6408, #6428).
        if (lastUpdateAt && now - lastUpdateAt >= 1000) { fail('the game sent no update for ' + (now - lastUpdateAt) + ' ms, so the world stood still'); return; }
        if (now - stepAt >= (Number(s.ms) || 0)) { pass(updatesSince(stepAt) + ' updates in ' + (now - stepAt) + ' ms'); return; }
        return;
      } else if (s.for === 'time') {
        if (now - stepAt >= (Number(s.ms) || 0)) { pass(); return; }
        return;
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
      if (late) {
        const what = 'waited ' + limit + ' ms for ' + (s.for === 'menu' ? s.menu + (s.open === false ? ' to close' : ' to open') : s.for === 'message' ? JSON.stringify(s.match) : s.for === 'crosshair' ? 'a ' + s.what + ' under the crosshair' : s.for === 'cell' ? (s.in === false ? 'a cell other than ' : 'the cell ') + s.name + ', and the character is in ' + (cellName || 'no named cell') : 'the world');
        if (Number(s.skip) > 0) { skipOn(what); } else { fail(what); }
      }
      return;
    }
    case 'page': {
      // Asked again every half second until the answer passes, because the
      // thing asked about (a panel drawn, a button there) may come later.
      // With "skipIf" and "skip": n, the answer skipIf names says what the
      // next n steps deal with is not here (a character the server has
      // already placed needs no Starting Location), so they are passed over.
      if (pageId && answerPasses(pageAnswers[pageId])) {
        if (Number(s.skip) > 0 && s.skipIf !== undefined && pageAnswers[pageId] === String(s.skipIf)) { skipOn('the page said ' + pageAnswers[pageId]); }
        else { pass(pageAnswers[pageId]); }
        return;
      }
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
    case 'face': {
      if (!faceAsked) { faceAsked = String(s.what || ''); faceDone = null; return; }
      if (faceDone) {
        const done = faceDone;
        faceAsked = ''; faceDone = null;
        if (done.ok) { pass(done.note); } else { fail(done.note); }
        return;
      }
      if (late) { faceAsked = ''; faceTry = null; fail('no update came in ' + limit + ' ms to stand before a ' + s.what); }
      return;
    }
    case 'shot':
    case 'key': {
      // A key with "ifMenu": [names] is pressed only while one of those menus
      // is open: the first step of a task shuts what a failed task before it
      // left open, and presses nothing when nothing is.
      if (!waitingAsk && s.do === 'key' && Array.isArray(s.ifMenu) && !s.ifMenu.some(function (m) { return !!openMenus[String(m)]; })) {
        pass('none of ' + s.ifMenu.join(', ') + ' is open, so not pressed');
        return;
      }
      if (!waitingAsk) {
        if (s.do === 'key') {
          inventoryKey = s.inventoryTrace === true
            ? { i: at, code: Number(s.code), until: now + INVENTORY_TRACE_MS, down: false, up: false }
            : null;
        }
        waitingAsk = ask(s.do, s.do === 'shot' ? String(s.name || ('step-' + at)) : Number(s.code));
        return;
      }
      const reply = readAck(waitingAsk);
      if (reply) {
        if (s.do === 'key' && reply.ok !== true) {
          fail(reply.legacy ? 'the runner did not confirm keyboard delivery; update Run-RealClient.ps1' : String(reply.note || 'the runner could not deliver the key'));
        } else { pass(reply.note); }
        return;
      }
      if (late) { fail('the runner did not answer ' + s.do + ' in ' + limit + ' ms'); }
      return;
    }
    case 'end':
      write({ t: 'step', i: at, do: 'end', ok: true, ms: 0, note: '' });
      passed++;
      end(failedTasks.length === 0, tasksNote());
      return;
    default:
      fail('no such step: ' + s.do);
  }
});
});
