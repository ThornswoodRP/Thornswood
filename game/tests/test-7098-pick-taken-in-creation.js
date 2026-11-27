// test-7098-pick-taken-in-creation.js
//
// A pick the client has taken is not said again through creation (#7098).
//
// A main session's front log on 24 Nov: "the client has not taken profile
// ... yet, saying it again" counting up to 30 with inWorld=false, while the
// character was already in the creation hall with the race menu up. The
// resend (keepSayingChoice) stopped only on __thornswoodInWorld, which the
// update tick sets once no menu is open, and creation is all menus. A world
// loaded after the pick now ends it: skymp5-client loads the world with a
// save of its own only once it has taken the pick.
//
// Runs the real keepSayingChoice and the loadGame handler (#4615's) out of
// game/plugins/thornswood-front.js. Read only.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
const front = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8')
  .split(CR).join('');

const START = '  const MENU_SAY_EVERY = ';
const END = '\n  }\n';
const s = front.indexOf(START);
const e = s < 0 ? -1 : front.indexOf(END, front.indexOf('function keepSayingChoice', s));
const h0 = front.indexOf("  let loadedOutOfWorld = 0;\n  sp.on('loadGame', guard('world load'");
const h1 = h0 < 0 ? -1 : front.indexOf('  }));', h0);
yes('the resend and the world load handler are in the front plugin', s > 0 && e > s && h0 > 0 && h1 > h0);

function rig() {
  const logs = [];
  const said = [];
  const g = { __thornswoodInWorld: false };
  const clock = { now: 1000000 };
  let load = null;
  const sp = { on(ev, f) { if (ev === 'loadGame') { load = f; } } };
  const api = new Function('log', 'T', 'globalThis', 'sp', 'guard', 'Date',
    front.slice(s, e + END.length) + front.slice(h0, h1 + '  }));'.length) +
    '\nreturn { say: keepSayingChoice,' +
    '  chose: function (id, at) { menuChosenId = id; menuChosenAt = at; menuSaidAt = at; },' +
    '  still: function () { return menuChosenId; } };')(
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    { js(x) { said.push(x); } }, g, sp, function (n, f) { return f; }, { now: () => clock.now });
  api.logs = logs; api.said = said; api.g = g; api.clock = clock; api.load = () => load();
  return api;
}

if (s > 0 && e > s && h0 > 0 && h1 > h0) {
  const t0 = 1000000;

  // At the main menu: picked, the client has not loaded anything yet.
  const r = rig();
  r.chose(42, t0);
  r.say(t0 + 2100);
  yes('a pick with no world loaded is said again', r.still() === 42 && r.said.length === 1);

  // The client takes it and loads the creation hall. The race menu keeps the
  // world flag down.
  r.clock.now = t0 + 3000;
  r.load();
  r.say(t0 + 4200);
  yes('a world loaded after the pick ends the resend with the world flag still down',
      r.still() === 0 && r.g.__thornswoodInWorld === false);
  yes('it says the client took the choice',
      r.logs.some(l => /the world loaded for profile 42 so the client took the choice/.test(l)));
  r.say(t0 + 95000);
  yes('so there is no "never took the choice" line at 90 s', !r.logs.some(l => /never took the choice/.test(l)));

  // A load from before the pick (something else loaded a save) is not it.
  const o = rig();
  o.clock.now = t0 - 5000;
  o.load();
  o.chose(7, t0);
  o.say(t0 + 2100);
  yes('a load from before the pick does not end the resend', o.still() === 7);

  // A save loaded while in a world is not an arrival.
  const w = rig();
  w.g.__thornswoodInWorld = true;
  w.clock.now = t0 + 1000;
  w.load();
  w.g.__thornswoodInWorld = false;
  w.chose(9, t0);
  w.say(t0 + 2100);
  yes('a load while in a world is not counted as one', w.still() === 9);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
