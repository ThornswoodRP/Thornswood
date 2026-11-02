// test-locks.js
//
// The door locks stopped running sixty times a second without losing a door.
//
// From the To Do List: "The door locks re-lock every door on the list sixty
// times a second... updateOwner scripts run every frame in skymp5-client, not
// on change. Three scripts ride that channel. The swing and the skills panel
// were both fixed; the door locks were not, and deliberately, because that one
// may be LOAD BEARING... WHAT IS NEEDED is to find out whether the re-runs are
// actually what catches a late door, or whether the separate door tick that
// comment mentions already does it."
//
// IT IS LOAD BEARING, and the answer was in the file. The script's own comment
// says "a door in a cell nobody has loaded does not resolve... the tick below
// comes back to it", and there is no tick below: pushAll says "Done on a
// change rather than on a tick: a lock is changed a handful of times a day and
// there is nothing to poll for." So the re-runs were the only thing that ever
// caught a door whose cell streamed in afterwards, and a plain edge trigger
// would have left those doors unlocked with nothing anywhere to notice.
//
// So it keeps running again, on a four second heartbeat instead of every
// frame, and a CHANGE is still instant. This file runs the real script against
// a fake clock and a fake game to prove all three of those at once, because
// the failure being guarded against is a door that quietly never locks.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Lift the script builder out of the gamemode and run it. */
function lift(name) {
  const a = src.indexOf('  function ' + name + '() {');
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }', a);
  return b > 0 ? src.slice(a, b + 4) : null;
}

const builder = lift('lockScript');
yes('the lock script is in the gamemode', builder !== null);

const everyM = /var LOCK_EVERY_MS = (\d+);/.exec(src);
yes('and the heartbeat is a named number', !!everyM);

if (builder && everyM) {
  const EVERY = Number(everyM[1]);
  /*
    The builder reads LOCK_EVERY_MS out of its own scope, so it is handed in
    here rather than inlined. That is the point of it being a named constant:
    change the number in the gamemode and this follows, instead of two numbers
    drifting apart and nobody noticing which one the client is using.
  */
  const body = new Function('LOCK_EVERY_MS', builder + '\nreturn lockScript();')(EVERY);

  /*
    A world where a door only resolves once its cell has been loaded, which is
    the whole point: getFormEx answers null for anything in a cell nobody is
    standing near.
  */
  function world() {
    const clock = { now: 1700000000000 };
    const loaded = {};        // form id -> true once its cell is in
    const locks = {};         // form id -> true or false, as last set
    let resolves = 0, lockCalls = 0;

    const sp = {
      Game: {
        getFormEx: function (id) {
          resolves++;
          return loaded[id] ? { id: id } : null;
        }
      },
      ObjectReference: {
        from: function (f) {
          if (!f) { return null; }
          return {
            lock: function (on) { lockCalls++; locks[f.id] = !!on; },
            // A door nobody has touched reads unlocked, as vanilla ships most.
            isLocked: function () { return !!locks[f.id]; }
          };
        }
      }
    };

    const state = {};
    function frame(value) {
      const ctx = { value: value, state: state, sp: sp };
      new Function('ctx', 'Date',
        body)(ctx, { now: function () { return clock.now; } });
    }
    return {
      clock: clock, loaded: loaded, locks: locks, frame: frame, state: state,
      counts: function () { return { resolves: resolves, lockCalls: lockCalls }; },
      reset: function () { resolves = 0; lockCalls = 0; }
    };
  }

  const A = 0x111, B = 0x222, C = 0x333;

  // ------------------------------------------------- it still locks a door
  {
    const w = world();
    w.loaded[A] = true;
    w.frame({ shut: [A], open: [], at: 1 });
    yes('a door in a loaded cell is locked', w.locks[A] === true);
    w.frame({ shut: [], open: [A], at: 2 });
    yes('and unlocked when it stops being shut to you', w.locks[A] === false);
  }

  // --------------------------------------------- and it stops doing it constantly
  {
    const w = world();
    w.loaded[A] = true; w.loaded[B] = true;
    w.frame({ shut: [A, B], open: [], at: 1 });
    const first = w.counts().lockCalls;
    yes('the first frame does the work', first === 2);

    w.reset();
    for (let i = 0; i < 240; i++) { w.frame({ shut: [A, B], open: [], at: 1 }); }
    yes('four seconds of frames at sixty a second do nothing at all',
        w.counts().lockCalls === 0 && w.counts().resolves === 0);
  }

  /*
    ------------------------------------------------- THE ONE THAT MATTERS

    A door whose cell was not loaded when the list arrived. Nothing on the
    server ever pushes again, so if the script does not come back to this by
    itself the door is unlocked for the rest of the session and nothing
    anywhere says so.
  */
  {
    const w = world();
    w.frame({ shut: [C], open: [], at: 1 });
    yes('a door in a cell nobody has loaded cannot be locked yet',
        w.locks[C] === undefined);

    // The person walks over there. The cell streams in. The server says
    // nothing, because a lock has not changed.
    w.loaded[C] = true;
    for (let i = 0; i < 60; i++) { w.frame({ shut: [C], open: [], at: 1 }); }
    yes('and a second of frames does not lock it, because it is on a heartbeat',
        w.locks[C] === undefined);

    w.clock.now += EVERY;
    w.frame({ shut: [C], open: [], at: 1 });
    yes('but the heartbeat comes back for it', w.locks[C] === true);
  }

  // ------------------------------------------------ a change is still instant
  {
    const w = world();
    w.loaded[A] = true;
    w.frame({ shut: [], open: [A], at: 1 });
    yes('starting unlocked', !w.locks[A]);

    // Somebody locks it. The server pushes a new list, a moment later.
    w.clock.now += 50;
    w.frame({ shut: [A], open: [], at: 2 });
    yes('locking a door reaches you on the next frame, not in four seconds',
        w.locks[A] === true);

    // And the other way.
    w.clock.now += 50;
    w.frame({ shut: [], open: [A], at: 3 });
    yes('and so does unlocking it', w.locks[A] === false);
  }

  /*
    ----------------------------- THE HEARTBEAT LEAVES A RIGHT DOOR ALONE (#963)

    lock() fires the game's lockChanged event even when the door is already
    that way, and the front plugin answers each one with a log line and a
    blockActivation. The dev log of 28 September has the same open door
    "opened" twice every four seconds, 408 ms of the frame in 30 s, worst
    229 ms. So a heartbeat over doors already right calls lock() not at all,
    and a door that went wrong in between (a lock picked open) is still fixed.
  */
  {
    const w = world();
    w.loaded[A] = true; w.loaded[B] = true;
    w.frame({ shut: [A], open: [B], at: 1 });
    yes('the first pass locks the shut door and leaves the open one, already open, alone',
        w.locks[A] === true && w.locks[B] === undefined && w.counts().lockCalls === 1);
    w.reset();
    for (let beat = 0; beat < 15; beat++) {         // a minute of heartbeats
      w.clock.now += EVERY;
      w.frame({ shut: [A], open: [B], at: 1 });
    }
    yes('a minute of heartbeats over doors already right calls lock() no times (' +
        w.counts().lockCalls + ')', w.counts().lockCalls === 0);
    w.locks[A] = false;                              // picked open
    w.locks[B] = true;                               // somebody else's script locked it
    w.clock.now += EVERY;
    w.frame({ shut: [A], open: [B], at: 1 });
    yes('and a door that went wrong between beats is put right on the next one',
        w.locks[A] === true && w.locks[B] === false && w.counts().lockCalls === 2);
  }

  /*
    ------------------------------------------ AND IT FAILS THE SAFE WAY ROUND

    ctx.state is the client's, and a client that does not supply it gets the
    old behaviour: every frame, correct and expensive. A door that is not
    locked is a house anybody can walk into, so that is the right way to fail.
  */
  {
    const clock = { now: 1 };
    const locks = {};
    let calls = 0;
    const sp = {
      Game: { getFormEx: function (id) { return { id: id }; } },
      ObjectReference: {
        from: function (f) { return { lock: function (on) { calls++; locks[f.id] = !!on; } }; }
      }
    };
    for (let i = 0; i < 5; i++) {
      new Function('ctx', 'Date', body)(
        { value: { shut: [A], open: [], at: 1 }, state: null, sp: sp },
        { now: function () { return clock.now; } });
    }
    yes('a client with nowhere to remember does it every time, as it always did',
        calls === 5 && locks[A] === true);
  }

  // ------------------------------------------------ rubbish in, nothing out
  {
    const w = world();
    let threw = false;
    try {
      w.frame(null);
      w.frame({});
      w.frame({ shut: null });
      w.frame({ shut: [A], open: null, at: 9 });
    } catch (e) { threw = true; }
    yes('a missing or broken list is ignored rather than thrown', !threw);
  }

  // --------------------------------------- and the server stamps what it sends
  {
    const push = src.slice(src.indexOf('  function push(actorId, profileId) {'),
                           src.indexOf('  function pushAll() {'));
    yes('the server stamps each push, or a change could not be told from a repeat',
        /v\.at = Date\.now\(\);/.test(push));
    /*
      The claim this whole change rests on. If somebody ever adds a tick that
      re-pushes, the heartbeat becomes redundant and this comment is where they
      will find out why it was there.
    */
    yes('and it still pushes on a change rather than on a tick',
        /Done on a change rather than on a tick/.test(src));
  }
}

/*
  ============================== A LOCK KEEPS PEOPLE OUT AND NEVER SHUTS THEM IN

  Entry 330, step 1. Both halves of a front door answer with the house in
  BUILDING_BY_DOOR, so shutFor locked the inside half as well, and a guest or
  a burglar inside when the holder locked up found every way out locked. The
  refusal in onActivate then refused the same door if the client lock had not
  run. Measured against doors.json on 24 September: 3,326 of the 4,891 doors
  stand inside their own building, in 812 of the 852 buildings, and 124 more
  stand in a room, a cellar or a lodging, whose only road to open ground is
  through the building.

  This runs the real shutFor, mayPass and doorsOf, and the real refusal lifted
  out of onActivate, against a small house, and then checks the generated
  table against doors.json.
*/
function liftFn(name) {
  const a = src.indexOf('  function ' + name + '(');
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }\n', a);
  return b > 0 ? src.slice(a, b + 4) : null;
}

{
  // One house. Its front and back doors each have a half on the street and a
  // half in the hall, there is a bedroom door inside, and a cellar whose only
  // way out is the door up into the hall.
  const HOUSE = 'h:Test.esp', CELLAR = 'c:Test.esp';
  const BY = {
    'f0:Test.esp': HOUSE,   // front door, the half on the street
    'f1:Test.esp': HOUSE,   // front door, the half in the hall
    'b0:Test.esp': HOUSE,   // back door, the half in the yard
    'b1:Test.esp': HOUSE,   // back door, the half in the kitchen
    'r1:Test.esp': HOUSE,   // the bedroom door, inside
    'c0:Test.esp': CELLAR,  // down into the cellar, standing in the hall
    'c1:Test.esp': HOUSE    // up out of the cellar into the hall
  };
  const OUT = { 'f1:Test.esp': 1, 'b1:Test.esp': 1, 'r1:Test.esp': 1, 'c1:Test.esp': 1 };
  const ID = { 'f0:Test.esp': 0xf0, 'f1:Test.esp': 0xf1, 'b0:Test.esp': 0xb0,
               'b1:Test.esp': 0xb1, 'r1:Test.esp': 0x71, 'c0:Test.esp': 0xc0,
               'c1:Test.esp': 0xc1 };
  const HOLDER = 7, STRANGER = 9, KEYED = 11;
  const PID = { 0x107: HOLDER, 0x109: STRANGER, 0x111: KEYED };

  const parts = ['wayOut', 'mayPass', 'shutFor', 'doorsOf'].map(liftFn);
  yes('wayOut is in the gamemode', !!parts[0]);
  yes('and mayPass, shutFor and doorsOf are where they were', !!parts[1] && !!parts[2] && !!parts[3]);

  function town(locked) {
    const claims = {};
    claims[HOUSE] = { by: HOLDER, name: 'Holder', locked: locked };
    // No jail in this town: the cells (#502) are tests/test-502-jail-cells.js.
    return new Function('BUILDING_BY_DOOR', 'WAY_OUT', 'claims', 'holderOf', 'holdsKey',
      'holdsDeed', 'idOf', 'jailHoldOf', 'cellLists', 'holdsMasterKey',
      'var doorIndex = null;\n' + parts.filter(Boolean).join('\n') +
      '\nreturn { shutFor: shutFor, mayPass: mayPass,' +
      ' wayOut: typeof wayOut === "function" ? wayOut : null };')(
      BY, OUT, claims,
      function (b) { return claims[b] || null; },
      function (actorId, b) { return actorId === 0x111 && b === HOUSE; },
      function () { return false; },
      function (d) { return ID[d] || 0; },
      function () { return null; },
      function () { },
      // 0x113 carries the house's working master key (#2254).
      function (actorId, b) { return actorId === 0x113 && b === HOUSE; });
  }
  function ids(list) { return list.slice().sort(function (x, y) { return x - y; }).join(','); }
  function same(list, want) {
    return ids(list) === ids(want.map(function (d) { return ID[d]; }));
  }

  if (parts[1] && parts[2] && parts[3]) {
    {
      const M = town(true);
      const m = M.shutFor(0x113, 13);
      yes('somebody carrying its master key finds no door of it locked (#2254)',
          m.shut.length === 0 && M.mayPass(0x113, 13, HOUSE) === true);
    }
    const T = town(true);
    const s = T.shutFor(0x109, STRANGER);
    yes('a stranger finds both doors in from outside locked, and only those',
        same(s.shut, ['f0:Test.esp', 'b0:Test.esp']));
    yes('and every way out of the house open, so nobody inside is shut in',
        same(s.open, ['f1:Test.esp', 'b1:Test.esp', 'r1:Test.esp', 'c1:Test.esp']));
    yes('the door up out of the cellar is one of them',
        s.open.indexOf(0xc1) !== -1 && s.shut.indexOf(0xc1) === -1);
    yes('and the cellar door, which is its own building nobody holds, is left alone',
        s.open.indexOf(0xc0) === -1 && s.shut.indexOf(0xc0) === -1);

    const h = T.shutFor(0x107, HOLDER);
    yes('the holder still finds every door of the house open', h.shut.length === 0 &&
        same(h.open, ['f0:Test.esp', 'f1:Test.esp', 'b0:Test.esp', 'b1:Test.esp',
                      'r1:Test.esp', 'c1:Test.esp']));
    const k = T.shutFor(0x111, KEYED);
    yes('and so does somebody carrying the key', k.shut.length === 0);

    const U = town(false);
    yes('a claim nobody has locked shuts nothing, as before',
        U.shutFor(0x109, STRANGER).shut.length === 0);

    /*
      THE SECOND HALF, the refusal in onActivate, lifted out and run with the
      same house. It is the half a client that did not lock the door meets, so
      it has to agree with the list above or a way out is open on the client
      and refused by the server.
    */
    const at = src.indexOf('const shutTo = prop.buildingOf(doorDesc);');
    const end = at >= 0 ? src.indexOf('\n        }\n', at) : -1;
    yes('the refusal is in onActivate', at >= 0 && end > at);
    if (at >= 0 && end > at) {
      const told = [];
      const refusal = new Function('prop', 'mp', 'casterRefrId', 'doorDesc', 'notify', 'say',
        'log', src.slice(at, end + 10) + '\nreturn true;');
      const prop = {
        buildingOf: function (d) { return BY[d] || null; },
        mayPass: T.mayPass, wayOut: T.wayOut,
        nameOf: function () { return 'the house'; }
      };
      const mp = { get: function (id, k) { return k === 'profileId' ? (PID[id] || 0) : null; } };
      function press(actor, door) {
        return refusal(prop, mp, actor, door, function (id, text) { told.push(text); },
                       function () { }, function () { });
      }
      yes('a stranger pressing the street half of the front door is refused',
          press(0x109, 'f0:Test.esp') === false && /locked and you have no key/.test(told[0] || ''));
      yes('a stranger pressing the hall half walks out', press(0x109, 'f1:Test.esp') === true);
      yes('and out of the back door', press(0x109, 'b1:Test.esp') === true);
      yes('and up out of the cellar', press(0x109, 'c1:Test.esp') === true);
      yes('and through the bedroom door', press(0x109, 'r1:Test.esp') === true);
      yes('the holder is not refused anywhere', press(0x107, 'f0:Test.esp') === true);
    }
  }

  // ------------------------------------------------ the table the server carries
  const wayM = /const WAY_OUT = (\{.*\});/.exec(src);
  const byM = /const BUILDING_BY_DOOR = (\{.*\});/.exec(src);
  const nameM = /const BUILDING_NAME = (\{.*\});/.exec(src);
  // The gamemode reads it from game/gamemode-tables (#5191).
  yes('WAY_OUT is generated into game/gamemode-tables and the gamemode reads it',
      !!wayM && fs.existsSync(require('./gamemode-tables.js').file('WAY_OUT')));
  let doorsJson = null;
  try { doorsJson = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'doors.json'), 'utf8')); }
  catch (e) { doorsJson = null; }
  yes('doors.json is readable', !!doorsJson);
  if (wayM && byM && nameM && doorsJson) {
    const WAY = JSON.parse(wayM[1]), ALL = JSON.parse(byM[1]), NAME = JSON.parse(nameM[1]);
    const placed = doorsJson.doors, cells = doorsJson.cells;
    let stray = 0;
    for (const d in WAY) { if (!Object.prototype.hasOwnProperty.call(ALL, d)) { stray++; } }
    yes('every way out is a door of a building the server knows', stray === 0);

    let inside = 0, insideMissed = 0, street = 0, streetOut = 0;
    for (const d in ALL) {
      const r = placed[d];
      if (!r) { continue; }
      if (r.cell === ALL[d]) { inside++; if (!WAY[d]) { insideMissed++; } }
      const c = cells[r.cell];
      if (c && !c.interior) { street++; if (WAY[d]) { streetOut++; } }
    }
    yes('every door standing inside its own building is a way out (' + inside + ' of them)',
        inside > 3000 && insideMissed === 0);
    yes('and not one of the ' + street + ' doors on open ground is, so a lock still keeps people out',
        street > 900 && streetOut === 0);

    // A Hearthfire cellar, where a guest is most likely to be when the holder
    // locks up, and the Winking Skeever's lower cellar, two rooms down.
    function cellNamed(n) {
      for (const c in cells) { if (cells[c].name === n) { return c; } }
      return null;
    }
    function upOutOf(room, into) {
      for (const d in ALL) {
        if (placed[d] && placed[d].cell === room && NAME[ALL[d]] === into) { return d; }
      }
      return null;
    }
    const windstad = upOutOf(cellNamed('Windstad Manor, Cellar'), 'Windstad Manor');
    yes('the door up out of Windstad Manor\'s cellar is a way out', !!windstad && !!WAY[windstad]);
    const lower = upOutOf(cellNamed('Winking Skeever Lower Cellar'), 'Winking Skeever Cellar');
    const upper = upOutOf(cellNamed('Winking Skeever Cellar'), 'The Winking Skeever');
    yes('and both doors up out of the Winking Skeever\'s cellars',
        !!lower && !!WAY[lower] && !!upper && !!WAY[upper]);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
