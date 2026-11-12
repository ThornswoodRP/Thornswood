/*
  test-4541-countdown-opening.js

      node tests/test-4541-countdown-opening.js

  #4541: the first line of a restart, update or notice countdown named its
  time as Math.round(seconds / 60) minutes, so a request for part of a
  minute rounded up: 30 seconds opened with "1 minute", 90 with "2 minutes"
  and 150 with "3 minutes", and people were put out sooner than they were
  told.

  This runs the REAL chat command block of game/gamemode.js (which holds the
  countdown: arm, opening and restartTick) over a pretend world, the way
  test-staff-commands.js does. A restart request goes in as the restart.json
  the deploy scripts drop, the command timer reads it, and the opening line
  is read back from the /say it makes. For each mode and each time, the
  opening must never name more time than is left; whole minutes keep their
  words.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GM = path.join(__dirname, '..', 'game', 'gamemode.js');
const src = fs.readFileSync(GM, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function slice(from, to) {
  const a = src.indexOf(from);
  const b = a < 0 ? -1 : src.indexOf(to, a);
  return (a < 0 || b < 0) ? null : src.slice(a, b + to.length);
}
const COMMANDS = slice('const WORDS = [', '// ==== end thornswood chat commands ====');
const PLACE_ACTORS = slice('\nfunction serverRunId(', '\n  return { made: made, why: why };\n}');
yes('the chat command block (with the countdown) is in gamemode.js', !!COMMANDS && !!PLACE_ACTORS &&
    COMMANDS.indexOf('function arm(seconds, why, mode)') > 0 && COMMANDS.indexOf('function restartTick()') > 0);

const AELA = 1001, A_AELA = 0xff000001;

function load() {
  const w = { said: [], timers: [], request: null, queue: [] };
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return [A_AELA]; }
      if (key === 'profileId') { return id === A_AELA ? AELA : 0; }
      if (key === 'appearance') { return { name: 'Aela' }; }
      return undefined;
    },
    set: function () { },
    getServerSettings: function () { return { privDir: 'private' }; },
    getUserByActor: function () { return 70; },
    kick: function () { }, place: function () { return 0; }, makeProperty: function () { },
    callPapyrusFunction: function () { }, getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    destroyActor: function () { }
  };
  const http = {
    request: function (opts, cb) {
      const req = {
        on: function () { return req; }, destroy: function () { },
        end: function (body) {
          if (opts.method === 'GET' && String(opts.path).indexOf('/commands') === 0) {
            const out = JSON.stringify({ commands: w.queue.splice(0, w.queue.length) });
            const h = {};
            const res = { on: function (ev, fn) { h[ev] = fn; return res; }, resume: function () { } };
            cb(res);
            if (h.data) { h.data(out); }
            if (h.end) { h.end(); }
            return;
          }
          let doc = null;
          try { doc = JSON.parse(body); } catch (e) { doc = body; }
          if (opts.path === '/say') { w.said.push({ to: doc.profileId, text: doc.text }); }
          if (cb) { cb({ resume: function () { }, on: function () { } }); }
        }
      };
      return req;
    }
  };
  const isRequest = (p) => /restart\.json$/.test(String(p));
  const fakeFs = {
    readFileSync: function (p) { if (isRequest(p) && w.request !== null) { return w.request; } throw new Error('not here'); },
    existsSync: function (p) { return isRequest(p) && w.request !== null; },
    unlinkSync: function (p) { if (isRequest(p)) { w.request = null; } },
    appendFileSync: function () { }, mkdirSync: function () { }, writeFileSync: function () { }
  };
  const box = {
    mp: mp,
    require: function (n) { return n === 'http' ? http : n === 'fs' ? fakeFs : n === 'path' ? path : require(n); },
    console: { log: function () { }, error: function () { } },
    Buffer: Buffer,
    log: function () { },
    voicePort: function () { return 7778; },
    guard: function (name, fn) { return fn; },
    setInterval: function (fn, ms) { w.timers.push({ fn: fn, ms: ms }); return w.timers.length; },
    clearInterval: function () { },
    setTimeout: function () { return 0; }, clearTimeout: function () { },
    idOf: function () { return 0; }, addItem: function () { return false; },
    ORES_BY_BASE: {}, HARVESTS_BY_BASE: {}, CROPS_BY_BASE: {}, FISH_BY_BASE: {},
    HUNTS_BY_BASE: {}, GAME_BY_BASE: {}, RECIPES_BY_ID: {}, ITEM_NAMES: {}, ITEMS: {},
    ADMIN_ITEMS: {}, ADMIN_ACTORS: {},
    HALL: { desc: 'Hall:0', pos: [0, 0, 0], rot: [0, 0, 0] },
    PASSAGES: {}, BUILDING_BY_DOOR: {}, BUILDING_NAME: {}, DATA: { cellToHold: {}, capitals: {} }
  };
  vm.createContext(box);
  box.__thornswoodIsDev = function () { return false; };
  box.__thornswoodIsAdmin = function () { return false; };
  box.__thornswoodIsAllowed = function () { return true; };
  box.__thornswoodPassSeen = { passes: {}, online: {}, said: {} };
  vm.runInContext(PLACE_ACTORS + '\n' +
                  COMMANDS.split('const WORDS').join('var WORDS').split('const PLAYER_WORDS').join('var PLAYER_WORDS'),
                  box, { filename: 'gamemode.js (chat commands)' });
  w.tick = w.timers.filter(function (t) { return t.ms === 1500; })[0];
  return w;
}

// How much time a line names, in seconds: "N minute(s)" and "N second(s)",
// added up; "under a minute" names nothing more than is left.
function named(text) {
  let s = 0, any = false;
  const m = /(\d+) minutes?/.exec(text), c = /(\d+) seconds?/.exec(text);
  if (m) { s += Number(m[1]) * 60; any = true; }
  if (c) { s += Number(c[1]); any = true; }
  if (/under a minute/.test(text)) { any = true; }
  return any ? s : null;
}

if (COMMANDS && PLACE_ACTORS) {
  const CASES = [
    [30, '30 seconds'], [90, '1 minute and 30 seconds'], [150, '2 minutes and 30 seconds'],
    [45, '45 seconds'], [61, '1 minute and 1 second'], [1, '1 second'],
    [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes']
  ];
  for (const mode of ['restart', 'update', 'notice']) {
    for (const [secs, words] of CASES) {
      const w = load();
      if (!w.tick) { yes('the command timer is armed', false); break; }
      w.request = JSON.stringify({ seconds: secs, why: 'a test', mode: mode });
      w.tick.fn();
      const lines = w.said.filter((l) => l.to === AELA).map((l) => l.text);
      const first = lines[0] || '';
      const n = named(first);
      yes(mode + ' in ' + secs + 's opens with no more time than is left (' + first.slice(0, 70) + ')',
          n !== null && n <= secs);
      yes('  and says it as "' + words + '"', first.indexOf(' ' + words + ' ') >= 0 || first.indexOf(' ' + words + '.') >= 0);
    }
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
