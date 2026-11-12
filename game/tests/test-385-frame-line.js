// test-385-frame-line.js
//
// The front plugin's frame line says how long the longest frame was and what
// the SkyMP client is drawing. Issue #385, "Dev is laggy".
//
// MEASURED 17 October on the dev front log, in Whiterun with the NPCs on:
// 28 to 45 frames a second outdoors and 60 indoors, with this plugin at 1.4
// to 5.4% of a core. So most of what the frame lost went somewhere the line
// could not see, and the line could not say whether it stuttered or ran slow
// all the time. The same spot with the NPCs on and off decides it, if the
// line also gives:
//   - the longest gap between two frames and how many were over 50 ms, with
//     a gap of a second or more (a load screen) counted apart;
//   - how many forms the SkyMP client keeps for the server (sp.storage.view),
//     and how many of them are actors.
//
// This lifts the real text (spent through frameWent) out of
// thornswood-front.js and runs it on a pretend clock against a pretend
// client view, in a storage that answers an unset key the way the engine's
// does: with a function, not undefined (#3333). A view read as plain
// truthiness took that function for the view, and every frame line ended
// "not known (TypeError: sp.storage.view.getFormViews is not a function)".
// Run it against the plugin before the change with FRONT=<that file>: the
// longest frame and drawn cases fail there, and before #3333 the not known
// case does.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT || path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const a = src.indexOf('  const spent = {};');
const b = a < 0 ? -1 : src.indexOf('  T.log = log;', a);
const code = (a >= 0 && b > a) ? src.slice(a, b) : null;
yes('the frame line is in the plugin', code !== null);
if (code === null) {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

let now = 1000000;
const FakeDate = { now: function () { return now; } };
const lines = [];
function log() { lines.push(Array.prototype.slice.call(arguments).join(' ')); }

// The client keeps four forms: two actors, a door, and an empty slot.
const forms = { 0: { id: 0xff000010, actor: true }, 1: { id: 0x1b1f1, actor: false },
                3: { id: 0xff000011, actor: true } };
function view(i) {
  const f = forms[i];
  return f ? { getLocalRefrId: function () { return f.id; } } : undefined;
}
const byId = {};
Object.keys(forms).forEach(function (k) { byId[forms[k].id] = forms[k]; });
let haveView = true;
// The engine's storage: an unset key is a function that throws when called
// (the fork's storageProxy.js).
const unset = function () { throw new Error('Property "view" is not defined in storage'); };
const sp = {
  storage: {},
  Game: { getFormEx: function (id) { return byId[id] || null; } },
  Actor: { from: function (f) { return f && f.actor ? f : null; } }
};
Object.defineProperty(sp.storage, 'view', { get: function () {
  return haveView ? { getFormViews: function () {
    return { getFormViewsArrayLength: function () { return 4; }, getNthFormView: view };
  } } : unset;
} });

const T = new Function('sp', 'log', 'Date', code + '\nreturn { guard: guard, frameWent: frameWent };')(sp, log, FakeDate);

// 30 seconds: frames 16 ms apart, three hitches of 80, 120 and 70 ms, and one
// load screen of 4 seconds.
function frame(gap) { now += gap; T.frameWent(); }
T.frameWent();
let elapsed = 0;
const gaps = [];
while (elapsed < 30000) { gaps.push(16); elapsed += 16; }
gaps[100] = 80; gaps[200] = 120; gaps[300] = 70; gaps[400] = 4000;
gaps.forEach(frame);
const line = lines.filter(function (l) { return /^frame: /.test(l); })[0] || '';
console.log('  ' + line);
yes('the line still says frames a second and the plugin\'s share', /^frame: \d+ updates a second, \d+ms of plugin/.test(line));
const m = /longest frame (\d+)ms, (\d+) over 50ms, (\d+) pause\(s\) of a second or more/.exec(line);
yes('the longest frame is the 120 ms hitch, not the load screen', !!m && Number(m[1]) === 120);
yes('three frames were over 50 ms', !!m && Number(m[2]) === 3);
yes('and the load screen is counted apart', !!m && Number(m[3]) === 1);
yes('the client draws 3 forms, 2 of them actors', /the client draws 3 forms, 2 of them actors$/.test(line));

// The next 30 seconds start clean: no hitch carried over.
lines.length = 0;
elapsed = 0;
while (elapsed < 30100) { frame(16); elapsed += 16; }
const next = lines.filter(function (l) { return /^frame: /.test(l); })[0] || '';
yes('the next line starts clean', /longest frame 16ms, 0 over 50ms, 0 pause\(s\)/.test(next));

// Before the client has a view (the menu, a load), the line says so and still goes out.
haveView = false;
lines.length = 0;
elapsed = 0;
while (elapsed < 30100) { frame(16); elapsed += 16; }
const none = lines.filter(function (l) { return /^frame: /.test(l); })[0] || '';
yes('with no client view yet it says not known, and no TypeError', /the client draws not known$/.test(none));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
