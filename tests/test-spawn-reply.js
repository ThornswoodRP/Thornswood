// test-spawn-reply.js
//
// #959: "/spawn doesn't spawn anything and also gives no chat feedback", on dev.
//
// What made nothing appear: /spawn called mp.createActor(baseId, pos, 0, cell).
// In the engine (ScampServer::CreateActor -> PartOne::CreateActor) the first
// argument is the form id the NEW actor gets, not the record to build it
// from, so it made a bare actor with the player's base under the troll
// record's own id, and no troll. mp.place(baseId) builds an actor from the
// record (ScampServer::Place, MpActor(..., baseId) for an NPC_), and a
// locationalData set moves it beside the person, which is what PlaceAtMe does.
// Both /spawn and the staff block's /spawnat now go through placeActors.
//
// This loads the WHOLE of game/gamemode.js in a vm with a stand-in mp, and
// sends each line the way the voice service hands it over: the real poll()
// reads GET /commands, the real dispatch() and handle() run it, and every
// line said back is caught at POST /say. So a command that never reached
// handle(), or one that threw on the way, shows up here as no reply.
//
// Read only: file writes, child processes and the network are stood in for.
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
const quietFs = {};
Object.keys(fs).forEach(function (k) {
  quietFs[k] = /write|append|mkdir|rename|copy|unlink|rm|symlink|link|truncate|chmod|chown|utimes|cp/i.test(k) &&
               typeof fs[k] === 'function' ? function () {} : fs[k];
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

if (loaded && pollTimer) {
  // ------------------------------------------------ nobody on a list ---
  settings = Object.assign({}, HOLD_OFF);
  let r = send('/spawn troll');
  yes('a person on no list is told /spawn is not theirs: ' + one(r),
      r.said.length === 1 && /is not yours to run/.test(r.said[0]) && r.to[0] === PID);
  yes('and nothing is placed', r.placed.length === 0 && r.created.length === 0);
  r = send('/give iron sword');
  yes('the same for /give: ' + one(r), r.said.length === 1 && /is not yours to run/.test(r.said[0]));

  // ------------------------------------------------------- a tester ---
  settings = Object.assign({ thornswoodPlaytesters: [PID] }, HOLD_OFF);

  r = send('/spawn troll');
  const trollId = r.placed.length ? r.placed[0].base : 0;
  yes('Main spawn succeeds when the Dev-only private marker is unregistered',
      !properties.has('thornswoodNpcCommanded') && r.destroyed.length === 0 && r.said.some(s => /placed|spawn|troll/i.test(s)));
  yes('/spawn troll places one actor from the troll record with mp.place: ' + JSON.stringify(r.placed),
      r.placed.length === 1 && r.placed[0].base === trollId && trollId > 0);
  yes('and never calls createActor, whose first argument is the new actor\'s own id',
      r.created.length === 0);
  const to = r.moved.length ? r.moved[0].to : null;
  yes('it is moved into the cell the person is in', r.moved.length === 1 && r.moved[0].id === r.placed[0].ref &&
      to.cellOrWorldDesc === CELL);
  yes('150 units in front of them, facing east (angle 90): ' + (to && JSON.stringify(to.pos)),
      !!to && Math.abs(to.pos[0] - 1150) < 0.01 && Math.abs(to.pos[1] - 2000) < 0.01 && to.pos[2] === 300);
  yes('turned to face them', !!to && to.rot[2] === 270);
  yes('and they are told: ' + one(r), r.said.length === 1 && /^Spawned 1 Troll\. Temporary: when it dies its body lies the usual time, then it is gone, and a restart takes it too\. Add keep to make one stay\.$/.test(r.said[0]) && r.to[0] === PID);

  r = send('/spawn troll 3');
  yes('/spawn troll 3 places three and says so: ' + one(r),
      r.placed.length === 3 && r.moved.length === 3 && r.said.length === 1 && /^Spawned 3 Troll\. Temporary: when it dies its body lies the usual time, then it is gone, and a restart takes it too\. Add keep to make one stay\.$/.test(r.said[0]));
  const spots = r.moved.map(function (m) { return m.to.pos[0].toFixed(1) + ',' + m.to.pos[1].toFixed(1); });
  yes('spread round them, not stacked: ' + spots.join(' '),
      spots[0] !== spots[1] && spots[1] !== spots[2] && spots[0] !== spots[2]);

  r = send('/spawn troll 500');
  yes('forty at most: ' + one(r), r.placed.length === 40 && /^Spawned 40 Troll\. Temporary: when it dies its body lies the usual time, then it is gone, and a restart takes it too\. Add keep to make one stay\.$/.test(r.said[0]));

  r = send('/spawn nosuchthingatall');
  yes('a name it cannot find says so: ' + one(r),
      r.said.length === 1 && /Nothing called that/.test(r.said[0]) && r.placed.length === 0);

  r = send('/spawn');
  yes('/spawn with nothing after it says how: ' + one(r), r.said.length === 1 && /^Spawn what\?/.test(r.said[0]));

  r = send('/spawn 12eb7');
  yes('a form id that is not a creature or a person is refused, and says why: ' + one(r),
      r.said.length === 1 && /^Nothing was spawned: that record is a WEAP/.test(r.said[0]) && r.placed.length === 0);

  r = send('/spawn 23aba');
  yes('an NPC record by form id is placed: ' + one(r),
      r.placed.length === 1 && r.placed[0].base === 0x23aba && /^Spawned 1 /.test(r.said[0]));

  placeThrows = 'Bad record Id 23aba';
  r = send('/spawn troll');
  placeThrows = '';
  yes('when the engine will not place it, the person is told why: ' + one(r),
      r.said.length === 1 && r.said[0] === 'Nothing was spawned: Bad record Id 23aba.');

  setThrows = 'no such cell';
  r = send('/spawn troll');
  setThrows = '';
  yes('one placed and then not moved is taken away again, and they are told: ' + one(r),
      r.destroyed.length === 1 && r.said.length === 1 && /^Nothing was spawned: no such cell\.$/.test(r.said[0]));

  // #1413 ran every placeActors call through the habitat cap. admit refuses a
  // dynamic actor that is not inside an authored habitat with a free slot, and
  // the refusal destroyed the one just placed. /spawn and /spawnat are a
  // tester or staff asking for a creature where they stand, not a world birth.
  properties.add('thornswoodNpcCommanded');
  let capAsks = 0;
  box.__thornswoodNpcPopulation = {
    // #2623: the marker names the run a temporary spawn belongs to.
    admit: function (id) { capAsks++; var m = actors[id].thornswoodNpcCommanded; return !!(m && typeof m.run === 'string'); },
    release: function () {}
  };
  r = send('/spawn troll');
  yes('a habitat cap does not eat a tester spawn or swallow the reply: ' + one(r) + ' admits=' + capAsks,
      capAsks === 1 && r.placed.length === 1 && r.moved.length === 1 && r.destroyed.length === 0 &&
      r.created.length === 0 && r.said.length === 1 && /^Spawned 1 Troll\. Temporary: when it dies its body lies the usual time, then it is gone, and a restart takes it too\. Add keep to make one stay\.$/.test(r.said[0]));
  box.__thornswoodNpcPopulation = null;

  // Nothing went through a path that threw on the way to handle().
  yes('no command threw on the way', r.threw.length === 0);

  // ----------------------------------------------------------- /give ---
  r = send('/give iron sword');
  const inv = actors[ME].inventory.entries || [];
  yes('/give iron sword as a tester hands it over and says so: ' + one(r),
      r.said.length === 1 && /^Given 1 Iron Sword\.$/.test(r.said[0]) &&
      inv.some(function (e) { return e.baseId === 0x12eb7 && e.count >= 1; }));
  r = send('/give nosuchthingatall');
  yes('/give of a name it cannot find says so: ' + one(r), r.said.length === 1 && /Nothing called that/.test(r.said[0]));

  // --------------------------------------------- the shared helper ---
  // Dev population registers its private property. Admission must see the
  // marker before checking habitat capacity; Main has no such property.
  properties.add('thornswoodNpcCommanded');
  let admittedMarker = false, enrolled = 0;
  box.__thornswoodNpcRuntime = {enroll:function() {enrolled++;}};
  box.__thornswoodNpcPopulation = {
    admit: function(id) { var m = actors[id].thornswoodNpcCommanded; admittedMarker = !!(m && typeof m.run === 'string'); return admittedMarker; },
    release: function() {}
  };
  settings = Object.assign({ thornswoodPlaytesters: [PID] }, HOLD_OFF);
  const devSpawn = send('/spawn troll');
  yes('Dev command marks its actor before population admission', admittedMarker && devSpawn.destroyed.length === 0 && devSpawn.placed.length === 1 && enrolled === 1);
  delete box.__thornswoodNpcPopulation;
  delete box.__thornswoodNpcRuntime;

  yes('placeActors is one function at the top of the file, for /spawn and /spawnat',
      /\nfunction placeActors\(baseId, where, count, away, commanded, keep\) \{/.test(src));
  yes('/spawn goes through it',
      /var put = placeActors\(baseId, \{ desc: inCell, pos: at, rot: facing \|\| \[0, 0, 0\] \}, count, 150, true, keep\);/.test(src));
  yes('the staff block\'s spawnBeside goes through it too',
      /function spawnBeside\(baseId, where, count, keep\) \{[^}]*return placeActors\(baseId, where, count, SPAWN_AWAY, true, keep\);/.test(src));
  yes('nothing in the file calls mp.createActor any more', !/mp\.createActor\(/.test(src));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
