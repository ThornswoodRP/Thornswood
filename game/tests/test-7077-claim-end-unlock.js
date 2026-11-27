// test-7077-claim-end-unlock.js
//
// #7077: a door a property claim locked stayed locked after the claim ended.
//
// The server's lists (shutFor) are built from the claims that stand now, so a
// claim that ends takes its doors off both the shut list and the open list.
// The client's lock script used to act only on doors that are on a list, so a
// door it had locked for the claim was never given back.
//
// Now the script remembers how it found each door before it first turned it,
// and when a door is on neither list any more it puts the door back that way:
// a door the game left open opens, and a door the game itself ships locked
// keeps its own lock. A door that is not loaded when the claim ends is put
// back when its cell comes in.
//
// This runs the real script out of the built gamemode against a fake game.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
// The lock script reads no load order table, so the source is read as it is.
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function lift(name) {
  const a = src.indexOf('  function ' + name + '() {');
  if (a < 0) { return null; }
  const b = src.indexOf('\n  }', a);
  return b > 0 ? src.slice(a, b + 4) : null;
}

const builder = lift('lockScript');
const everyM = /var LOCK_EVERY_MS = (\d+);/.exec(src);
yes('the lock script and its heartbeat are in the gamemode', builder !== null && !!everyM);

if (builder && everyM) {
  const EVERY = Number(everyM[1]);
  const body = new Function('LOCK_EVERY_MS', builder + '\nreturn lockScript();')(EVERY);

  // A game where a door resolves only while its cell is loaded, and where a
  // door's lock stays as it was last set, the way a reference keeps it.
  function world(authored) {
    const clock = { now: 1700000000000 };
    const loaded = {};
    const locks = Object.assign({}, authored || {});
    const sp = {
      Game: { getFormEx: function (id) { return loaded[id] ? { id: id } : null; } },
      ObjectReference: {
        from: function (f) {
          if (!f) { return null; }
          return {
            lock: function (on) { locks[f.id] = !!on; },
            isLocked: function () { return !!locks[f.id]; }
          };
        }
      }
    };
    const state = {};
    // The script keeps how it found each door on globalThis, for the whole
    // game, so each world here starts a new game.
    delete globalThis.__thornswoodLockFound;
    function frame(value) {
      const ctx = { value: value, state: state, sp: sp };
      new Function('ctx', 'Date', body)(ctx, { now: function () { return clock.now; } });
    }
    return { clock: clock, loaded: loaded, locks: locks, frame: frame, state: state };
  }

  const DOOR = 0x111, CELLAR = 0x222, OTHER = 0x333;

  // ----------------------------------------- the claim ends while you look on
  {
    const w = world();
    w.loaded[DOOR] = true;
    w.frame({ shut: [DOOR], open: [], at: 1 });
    yes('a claim locks its door for a visitor', w.locks[DOOR] === true);
    // The claim ends: the server lists the door nowhere.
    w.frame({ shut: [], open: [], at: 2 });
    yes('and when the claim ends the door opens for them', w.locks[DOOR] === false);
  }

  // ----------------------------------- the door is not loaded when it ends
  {
    const w = world();
    w.loaded[DOOR] = true;
    w.frame({ shut: [DOOR], open: [], at: 1 });
    delete w.loaded[DOOR];
    w.frame({ shut: [], open: [], at: 2 });
    yes('a door out of reach when the claim ends is still locked meanwhile', w.locks[DOOR] === true);
    w.loaded[DOOR] = true;
    w.clock.now += EVERY;
    w.frame({ shut: [], open: [], at: 2 });
    yes('and opens once its cell comes back in', w.locks[DOOR] === false);
  }

  // ---------------------------------- a door the game itself ships locked
  {
    const w = world({ [CELLAR]: true });
    w.loaded[CELLAR] = true;
    // The holder may pass, so the claim opens it for them.
    w.frame({ shut: [], open: [CELLAR], at: 1 });
    yes('a claim opens a door the game ships locked for someone it lets in', w.locks[CELLAR] === false);
    w.frame({ shut: [], open: [], at: 2 });
    yes('and when the claim ends the game\'s own lock is back', w.locks[CELLAR] === true);
  }

  // ------------------------------------------ doors no claim ever touched
  {
    const w = world({ [OTHER]: true });
    w.loaded[OTHER] = true; w.loaded[DOOR] = true;
    w.frame({ shut: [DOOR], open: [], at: 1 });
    w.frame({ shut: [], open: [], at: 2 });
    yes('a door no claim listed is left as the game has it', w.locks[OTHER] === true);
  }

  // ------------------------------------- a door still listed stays as listed
  {
    const w = world();
    w.loaded[DOOR] = true; w.loaded[CELLAR] = true;
    w.frame({ shut: [DOOR, CELLAR], open: [], at: 1 });
    w.frame({ shut: [DOOR], open: [], at: 2 });
    yes('ending one claim leaves another claim\'s door locked',
        w.locks[DOOR] === true && w.locks[CELLAR] === false);
    w.clock.now += EVERY * 3;
    w.frame({ shut: [DOOR], open: [], at: 2 });
    yes('and the heartbeat after that changes nothing', w.locks[DOOR] === true && w.locks[CELLAR] === false);
  }

  // ----------------------- a change of character before the claim ends
  {
    const w = world();
    w.loaded[DOOR] = true;
    w.frame({ shut: [DOOR], open: [], at: 1 });
    // The next character's script runs with a state of its own.
    for (const key of Object.keys(w.state)) { delete w.state[key]; }
    w.frame({ shut: [], open: [], at: 2 });
    yes('a door locked for one character opens for the next once the claim is gone', w.locks[DOOR] === false);
  }

  // ------------------------------------------- claimed again after it ended
  {
    const w = world();
    w.loaded[DOOR] = true;
    w.frame({ shut: [DOOR], open: [], at: 1 });
    w.frame({ shut: [], open: [], at: 2 });
    w.frame({ shut: [DOOR], open: [], at: 3 });
    yes('a door claimed again is locked again', w.locks[DOOR] === true);
    w.frame({ shut: [], open: [], at: 4 });
    yes('and opens again when that claim ends', w.locks[DOOR] === false);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
