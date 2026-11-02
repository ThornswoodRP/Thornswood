// test-chat-refusals.js
//
// The chat words that must refuse, driven end to end (codex coverage sweep,
// docs/dev/gamemode-coverage.md). Before this, /shutdown was never sent by any
// test, and /restart only appeared in lists of words: nothing checked that an
// ADMIN typing either is refused and that no restart file is written. The
// profile id a chat line carries is the page's own claim (#410), so a restart
// from chat would let anybody with an admin's number take the server down.
// Also: /give and /spawn from a staff admin who is not a playtester, an
// uppercase word, an unproven line under the join pass, and /deeds as /deed.
//
// Loads the whole gamemode in a vm the way test-spawn-reply.js does.
// Read only: writes are caught and listed, never made.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GM = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
// The whole gamemode loads below, and it reads its tables from the folder it
// runs in, which is the server's folder on the box and here the repository's
// root, where game/gamemode-tables is (#5191). So this runs from the root
// wherever it was started from.
process.chdir(path.join(__dirname, '..'));
const src = fs.readFileSync(GM, 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the world ---
const ME = 0x14, PID = 5, OTHER = 6;
const CELL = '1a26f:Skyrim.esm';
const actors = {};
actors[ME] = { profileId: PID, pos: [1000, 2000, 300], angle: [0, 0, 90],
               worldOrCellDesc: CELL, inventory: { entries: [] } };

// Which ids are not NPC records; everything else the load order has is one.
const NOT_NPC = { 0x12eb7: 'WEAP' };
const placed = [], moved = [], destroyed = [], created = [], said = [], logs = [];
let nextRef = 0xff000100;
let placeThrows = '', setThrows = '';
// The join pass hold off on purpose: these lines come from a chat connection
// with no join token and a session with no pass, and the hold is what
// test-join-pass-trust.js covers. Absent would be on (#1319).
const HOLD_OFF = { thornswoodRequirePass: false };
let settings = Object.assign({}, HOLD_OFF);
const properties = new Set();

const mpBase = {
  get: function (id, prop) {
    if (id === 0 && prop === 'onlinePlayers') { return [ME]; }
    if (actors[id] && prop in actors[id]) { return actors[id][prop]; }
    return undefined;
  },
  set: function (id, prop, value) {
    if(prop === 'thornswoodNpcCommanded' && !properties.has(prop)) throw new Error('Property '+prop+" doesn't exist");
    if (prop === 'locationalData') {
      if (setThrows) { throw new Error(setThrows); }
      moved.push({ id: id, to: value });
      return;
    }
    if (actors[id]) { actors[id][prop] = value; }
  },
  getIdFromDesc: function (d) { return /:Skyrim\.esm$/.test(d) ? parseInt(d, 16) : 0; },
  getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
  lookupEspmRecordById: function (id) {
    return { record: { id: id, type: NOT_NPC[id] || 'NPC_', editorId: '', flags: 0, fields: [] } };
  },
  place: function (baseId) {
    if (placeThrows) { throw new Error(placeThrows); }
    const ref = nextRef++;
    actors[ref] = {baseDesc:baseId.toString(16)+':Skyrim.esm',profileId:-1};
    placed.push({ base: baseId, ref: ref });
    return ref;
  },
  destroyActor: function (id) { destroyed.push(id); },
  // The engine's meaning: the id the NEW actor gets. Nothing here should call it.
  createActor: function (formId) { created.push(formId); return formId; },
  getServerSettings: function () { return settings; },
  makeProperty: function (name) { properties.add(name); },
  makeEventSource: function () {},
  clear: function () {},
};
const mp = new Proxy(mpBase, {
  get: function (t, k) {
    if (k in t) { return t[k]; }
    if (typeof k === 'string' && /^on[A-Z]/.test(k)) { return undefined; }
    return function () { return undefined; };
  },
});

// ------------------------------------------- the voice service's two ends ---
let queue = [];
const fakeHttp = {
  request: function (opts, cb) {
    const req = {
      on: function () { return req; },
      destroy: function () {},
      write: function () {},
      end: function (body) {
        if (opts.path === '/say') { try { said.push(JSON.parse(body)); } catch (e) { } return; }
        if (String(opts.path).indexOf('/commands?') === 0 && cb) {
          const out = JSON.stringify({ commands: queue });
          queue = [];
          const res = { statusCode: 200, on: function (ev, fn) { res['_' + ev] = fn; return res; },
                        setEncoding: function () {}, resume: function () {} };
          cb(res);
          if (res._data) { res._data(out); }
          if (res._end) { res._end(); }
        }
      },
    };
    return req;
  },
  get: function () { return { on: function () { return this; }, end: function () {} }; },
};

// Reads go through; anything that would write, remove or start something does not.
const writes = [];
const quietFs = {};
Object.keys(fs).forEach(function (k) {
  quietFs[k] = /write|append|mkdir|rename|copy|unlink|rm|symlink|link|truncate|chmod|chown|utimes|cp/i.test(k) &&
               typeof fs[k] === 'function' ? function (p) { writes.push(k + ' ' + String(p)); } : fs[k];
});
quietFs.createWriteStream = function () { return { write: function () {}, end: function () {}, on: function () {} }; };

const timers = [];
const box = {
  mp: mp,
  console: { log: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
             error: function () { logs.push('ERR ' + Array.prototype.join.call(arguments, ' ')); },
             warn: function () { logs.push('WARN ' + Array.prototype.join.call(arguments, ' ')); } },
  require: function (n) {
    if (n === 'http' || n === 'https') { return fakeHttp; }
    if (n === 'fs') { return quietFs; }
    if (n === 'child_process') { return { spawn: function () { throw new Error('no'); }, exec: function () {}, execFile: function () {} }; }
    return require(n);
  },
  setInterval: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; },
  clearInterval: function () {},
  setTimeout: function () { return 0; },
  clearTimeout: function () {},
  setImmediate: function () {},
  Buffer: Buffer, process: process,
};
box.globalThis = box;
vm.createContext(box);
let loaded = true;
try { vm.runInContext(src, box, { filename: 'gamemode.js' }); }
catch (e) { loaded = false; console.log('gamemode.js threw while loading: ' + (e && e.stack)); }
yes('the whole gamemode loads under the stand-in', loaded);

const pollTimer = timers.filter(function (t) { return /\bpoll\(\)/.test(String(t.fn)); }).pop();
yes('the command timer that polls the voice service is armed', !!pollTimer);

let seq = 0;
function send(text, pid) {
  queue.push({ id: 'test:' + (++seq), profileId: pid || PID, name: 'Patrick', text: text });
  said.length = 0; placed.length = 0; moved.length = 0; destroyed.length = 0; created.length = 0;
  const before = logs.length;
  if (pollTimer) { pollTimer.fn(); }
  return {
    said: said.map(function (s) { return s.text; }),
    to: said.map(function (s) { return s.profileId; }),
    placed: placed.slice(), moved: moved.slice(), destroyed: destroyed.slice(), created: created.slice(),
    threw: logs.slice(before).filter(function (l) { return /threw/.test(l); }),
  };
}
function one(r) { return r.said.length === 1 ? r.said[0] : JSON.stringify(r.said); }

function wrote(re) { return writes.some(function (w) { return re.test(w); }); }

if (loaded && pollTimer) {
  // ------------------------------------------ restarts never from chat ---
  settings = Object.assign({ thornswoodAdmins: [PID], thornswoodPlaytesters: [PID] }, HOLD_OFF);
  ['/restart', '/shutdown', '/SHUTDOWN', '/restart now', '/shutdown 0'].forEach(function (line) {
    writes.length = 0;
    const r = send(line);
    yes(line + ' from an admin and tester is refused in a sentence: ' + one(r),
        r.said.length === 1 && /^Restarts are not run from chat\./.test(r.said[0]) && r.to[0] === PID);
    yes(line + ' writes no restart file', !wrote(/restart/i));
    yes(line + ' throws nothing', r.threw.length === 0);
  });
  yes('the refusal is logged with who sent it',
      logs.some(function (l) { return /command: \/shutdown from 5 refused: restarts come from the box/.test(l); }));

  // ---------------------- /give is a listed tier's only, never a stranger's ---
  // An admin is a dev is a playtester by design (isPlaytester), so the list
  // that matters is "on none of them". OTHER gets a character of their own so
  // the refusal is the answer and not the "not back in the world" hold.
  actors[0x15] = { profileId: OTHER, pos: [0, 0, 0], angle: [0, 0, 0],
                   worldOrCellDesc: CELL, inventory: { entries: [] } };
  const online = mpBase.get;
  mpBase.get = function (id, prop) {
    if (id === 0 && prop === 'onlinePlayers') { return [ME, 0x15]; }
    return online(id, prop);
  };
  settings = Object.assign({ thornswoodAdmins: [PID] }, HOLD_OFF);
  const invBefore = JSON.stringify(actors[0x15].inventory);
  let r = send('/give gold 100000', OTHER);
  yes('somebody on no list cannot /give gold, even with an admin online: ' + one(r),
      r.said.length === 1 && /is not yours to run/.test(r.said[0]) && r.to[0] === OTHER);
  yes('and their pack is untouched', JSON.stringify(actors[0x15].inventory) === invBefore);
  r = send('/GIVE gold 5', OTHER);
  yes('an uppercase /GIVE is the same word and the same refusal: ' + one(r),
      r.said.length === 1 && /is not yours to run/.test(r.said[0]));
  r = send('/spawn troll', OTHER);
  yes('nor can they /spawn: ' + one(r),
      r.said.length === 1 && /is not yours to run/.test(r.said[0]) && r.placed.length === 0);
  r = send('/give gold 5');
  yes('while the admin, a playtester by design, can: ' + one(r), /^Given 5 Gold\.$/.test(r.said[0] || ''));
  mpBase.get = online;
  // ------------------------- an unproven line runs nothing (#410, #1319) ---
  settings = { thornswoodPlaytesters: [PID], thornswoodRequirePass: true };
  r = send('/spawn troll');
  yes('with the pass required, an unproven tester line places nothing', r.placed.length === 0);
  yes('and is not answered (the answer would go to whoever holds the number)',
      r.said.every(function (s) { return !/Spawned/.test(s); }));

  // ----------------------------------------------- /deeds is /deed ---
  settings = Object.assign({}, HOLD_OFF);
  const a = send('/deed'), b = send('/deeds');
  yes('/deeds answers: ' + one(b), b.said.length >= 1 && b.threw.length === 0);
  yes('and says what /deed says', JSON.stringify(a.said) === JSON.stringify(b.said));
}

// -------------- refused before arrival, not held (refuse-before-arrival) ---
// Somebody on no list with no character in the world used to be told "That
// will run as soon as you arrive" for /give, and refused 90 seconds later.
if (loaded && pollTimer) {
  const GHOST = 7;   // a profile with no character online
  settings = Object.assign({ thornswoodAdmins: [PID] }, HOLD_OFF);
  ['/give gold 5', '/spawn troll', '/tp whiterun', '/where', '/kick 5', '/spawnat 5 troll', '/ban 5'].forEach(function (line) {
    const r = send(line, GHOST);
    yes(line + ' from somebody on no list, not in the world yet, is refused at once: ' + one(r),
        r.said.length >= 1 && r.said.every(function (s) { return !/as soon as you arrive/.test(s); }) &&
        r.said.some(function (s) { return /not yours|refuses everybody|not on|playtester/i.test(s); }) &&
        r.placed.length === 0);
  });
  settings = Object.assign({ thornswoodPlaytesters: [GHOST + 1] }, HOLD_OFF);
  const r = send('/give gold 5', GHOST + 1);
  yes('a listed tester not in the world yet is still held for arrival: ' + one(r),
      r.said.length === 1 && /as soon as you arrive/.test(r.said[0]));
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);