/*
  test-4932-no-self-lift.js

      node tests/test-4932-no-self-lift.js

  #4932: /silence and /freeze refused to aim at yourself, but /unsilence and
  /unfreeze never compared the person named with the one asking. A silenced
  person's slash commands still reach the server and a frozen one can still
  type, so a member of staff another had silenced or frozen could lift it
  from themselves at once, and the moderation log showed an ordinary lift.

  This runs the REAL chat command block and the REAL staff block of
  game/gamemode.js over a pretend world, the way test-staff-commands.js
  does: each line goes in as the voice service's queued command, and every
  answer is read back from the /say it makes. Aela and Sera are both staff.
  Sera silences and freezes Aela; Aela naming herself, by name or by her
  profile number, is refused with "That is you." and nothing is lifted or
  recorded; Sera then lifts both.
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
const STAFF = slice('// ==== thornswood staff ====', '// ==== end thornswood staff ====');
const PLACE_ACTORS = slice('\nfunction serverRunId(', '\n  return { made: made, why: why };\n}');
yes('the chat command, staff and placing blocks are in gamemode.js', !!COMMANDS && !!STAFF && !!PLACE_ACTORS);

const AELA = 1001, SERA = 4004, BJORN = 2002;
const A_AELA = 0xff000001, A_SERA = 0xff000004, A_BJORN = 0xff000002;

function world() {
  return {
    online: [A_AELA, A_SERA, A_BJORN],
    pid: { [A_AELA]: AELA, [A_SERA]: SERA, [A_BJORN]: BJORN },
    name: { [A_AELA]: 'Aela', [A_SERA]: 'Sera', [A_BJORN]: 'Bjorn' },
    where: {
      [A_AELA]: { desc: 'Whiterun:1', pos: [100, 200, 300], rot: [0, 0, 90] },
      [A_SERA]: { desc: 'Markarth:4', pos: [9, 9, 9], rot: [0, 0, 0] },
      [A_BJORN]: { desc: 'Riften:2', pos: [5000, 6000, 700], rot: [0, 0, 10] }
    },
    staff: { [AELA]: true, [SERA]: true }, said: [], records: [], queue: [], timers: [], set: []
  };
}

function load(w) {
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return w.online.slice(); }
      if (key === 'profileId') { return w.pid[id]; }
      if (key === 'appearance') { return { name: w.name[id] }; }
      if (key === 'worldOrCellDesc') { return (w.where[id] || {}).desc; }
      if (key === 'pos') { return (w.where[id] || {}).pos; }
      if (key === 'angle') { return (w.where[id] || {}).rot; }
      return undefined;
    },
    set: function (id, key, v) {
      w.set.push({ id: id, key: key });
      if (key === 'locationalData') { w.where[id] = { desc: v.cellOrWorldDesc, pos: v.pos.slice(), rot: v.rot.slice() }; }
    },
    getServerSettings: function () { return { privDir: 'private' }; },
    getUserByActor: function (a) { return w.online.indexOf(a) >= 0 ? 70 + w.online.indexOf(a) : -1; },
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
  const fakeFs = {
    readFileSync: function () { throw new Error('not here'); },
    existsSync: function () { return false; },
    appendFileSync: function (p, text) { w.records.push(String(text)); },
    mkdirSync: function () { }, writeFileSync: function () { }, unlinkSync: function () { }
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
  box.__thornswoodIsDev = function (p) { return !!w.staff[p]; };
  box.__thornswoodIsAdmin = function () { return false; };
  box.__thornswoodIsAllowed = function () { return true; };
  box.__thornswoodPassSeen = { passes: {}, online: {}, said: {} };
  box.__thornswoodSocial = {
    findPerson: function (want) {
      const low = String(want).toLowerCase();
      const hit = w.online.filter(function (a) { return String(w.name[a]).toLowerCase().indexOf(low) === 0; });
      if (hit.length === 1) { return { actorId: hit[0], why: '' }; }
      return { actorId: 0, why: hit.length ? 'More than one person here answers to that.' : 'Nobody here by that name.' };
    }
  };
  vm.runInContext(PLACE_ACTORS + '\n' +
                  COMMANDS.split('const WORDS').join('var WORDS').split('const PLAYER_WORDS').join('var PLAYER_WORDS') +
                  '\n' + STAFF, box, { filename: 'gamemode.js (commands and staff)' });
  w.box = box;
  w.tick = w.timers.filter(function (t) { return t.ms === 1500; })[0];
  [AELA, SERA].forEach(function (p) { box.__thornswoodPassSeen.passes[p] = { at: Date.now(), x: Date.now() + 600000, v: '1.1.102' }; });
  return w;
}

let nextId = 1;
function run(w, pid, text) {
  const before = w.said.length;
  w.queue.push({ id: 't:' + (nextId++), profileId: pid, name: '', text: text, at: Date.now(), proven: true });
  w.tick.fn();
  return w.said.slice(before).filter(function (l) { return l.to === pid; }).map(function (l) { return l.text; });
}
function lifts(w, who) { return w.records.filter(function (r) { return r.indexOf('"unsilence"') >= 0 || r.indexOf('"unfreeze"') >= 0; }).length; }

if (COMMANDS && STAFF && PLACE_ACTORS) {
  const w = load(world());
  yes('the blocks load and arm the command timer', !!w.tick && !!w.box.__thornswoodStaff);
  const st = w.box.__thornswoodStaffState;

  // ------------------------------------------------------------ silence --
  let got = run(w, SERA, '/silence Aela 10 talking over the scene');
  yes('Sera silences Aela (' + got.join(' | ') + ')', !!st.silenced[AELA] && /^Silenced Aela/.test(got[0] || ''));

  got = run(w, AELA, '/unsilence Aela');
  yes('Aela naming herself in /unsilence is refused with the /silence words (' + got.join(' | ') + ')',
      got.length === 1 && got[0] === 'That is you.');
  yes('  and she is still silenced', !!st.silenced[AELA]);
  got = run(w, AELA, '/unsilence ' + AELA);
  yes('by her profile number too (' + got.join(' | ') + ')', got.length === 1 && got[0] === 'That is you.' && !!st.silenced[AELA]);
  yes('  and no lift is in the moderation log', lifts(w) === 0);

  got = run(w, SERA, '/unsilence Aela');
  yes('another member of staff still lifts it (' + got.join(' | ') + ')', !st.silenced[AELA] && got[0] === 'Aela can speak again.');

  // ------------------------------------------------------------- freeze --
  got = run(w, SERA, '/freeze Aela wait here');
  yes('Sera freezes Aela (' + got.join(' | ') + ')', !!st.frozen[AELA] && /^Froze Aela/.test(got[0] || ''));

  got = run(w, AELA, '/unfreeze Aela');
  yes('Aela naming herself in /unfreeze is refused with the /freeze words (' + got.join(' | ') + ')',
      got.length === 1 && got[0] === 'That is you.');
  yes('  and she is still frozen where Sera froze her', !!st.frozen[AELA] && st.frozen[AELA].desc === 'Whiterun:1');
  got = run(w, AELA, '/unfreeze ' + AELA);
  yes('by her profile number too (' + got.join(' | ') + ')', got.length === 1 && got[0] === 'That is you.' && !!st.frozen[AELA]);
  yes('  and no lift is in the moderation log', lifts(w) === 1);

  got = run(w, SERA, '/unfreeze Aela');
  yes('another member of staff still lets her go (' + got.join(' | ') + ')', !st.frozen[AELA] && got[0] === 'Aela can move again.');

  // Naming yourself when nothing is on you is refused the same way.
  got = run(w, SERA, '/unsilence Sera');
  yes('naming yourself with nothing on you is the same refusal (' + got.join(' | ') + ')', got.length === 1 && got[0] === 'That is you.');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
