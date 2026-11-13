// test-menu-choice.js
//
// Choosing a character at the main menu has to actually get you into the world.
//
// WHAT WAS REPORTED, twice, by a playtester and then by Djinn: "click make a
// new character and than are stuck on the main menu with selector menu gone".
// The selector vanishes and the game never loads.
//
// WHY. The pick travels from the page to skymp5-client as a browserMessage.
// The page repeats it every two seconds until something says it heard, because
// SkyrimPlatform loads the page at start and runs plugins about fifteen seconds
// later, so a pick made in that gap would otherwise be lost. That repeat is the
// only thing covering the gap.
//
// thornswood-front.js is NOT skymp5-client. Its own handler saw the pick, wrote
// the choice file and acked the page, which hid the menu and stopped the
// repeat. skymp5-client's AuthService only acts on that message while it is
// waiting for it, and it starts waiting when authNeeded fires. Click before
// that and AuthService returned early, the front plugin acked anyway, the page
// went quiet, and the pick was gone. No authAttempt, no join, and the main menu
// is where you stay. The ack was coming from the wrong side of the room.
//
// So the plugin takes the repeat over instead of ending it, and stops when the
// world is really there rather than after a guess at how long that takes.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const START = '  const MENU_SAY_EVERY = ';
const END = '\n  }\n';
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, src.indexOf('function keepSayingChoice', a));
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;

yes('the plugin keeps saying the choice at all', block !== null);

/**
 * The real block, with a clock and a world you control.
 *
 * Nothing that decides anything is stubbed: log, the page bridge and the
 * in-world flag are the only things replaced, and those are the three things
 * that touch the game.
 */
function harness() {
  const said = [];
  const logs = [];
  const world = { here: false };
  const T = { js: function (s) { said.push(s); } };
  const log = function () { logs.push(Array.prototype.join.call(arguments, ' ')); };
  const fn = new Function('log', 'T', 'globalThis', block +
    '\nreturn {' +
    '  say: keepSayingChoice,' +
    '  chose: function (id, at) { menuChosenId = id; menuChosenAt = at; menuSaidAt = at; },' +
    '  still: function () { return menuChosenId; },' +
    '  every: MENU_SAY_EVERY, forMs: MENU_SAY_FOR' +
    '};');
  const api = fn(log, T, { get __thornswoodInWorld() { return world.here; } });
  api.said = said; api.logs = logs; api.world = world;
  return api;
}

if (block !== null) {
  // S1: THE BUG. Nobody has joined yet, so the choice keeps being said.
  {
    const h = harness();
    const t0 = 1000000;
    h.chose(933578397, t0);
    h.say(t0 + 100);
    yes('S1 it does not repeat faster than its own interval', h.said.length === 0);
    h.say(t0 + h.every + 1);
    yes('S1 after the interval it says the choice again', h.said.length === 1);
    yes('S1 and it says the profile that was picked',
        h.said[0].indexOf('933578397') !== -1);
    yes('S1 as a select message to the client',
        h.said[0].indexOf('"thornswood","select"') !== -1);
    h.say(t0 + h.every * 2 + 2);
    yes('S1 and it goes on saying it while nobody has joined',
        h.said.length === 2);
    yes('S1 and it is still waiting', h.still() === 933578397);
  }

  // S2: arriving in the world is what stops it, not a timer.
  {
    const h = harness();
    const t0 = 2000000;
    h.chose(42, t0);
    h.say(t0 + h.every + 1);
    yes('S2 it is saying the choice before the world is there',
        h.said.length === 1);
    h.world.here = true;
    h.say(t0 + h.every * 2 + 2);
    yes('S2 once in the world it stops saying it', h.said.length === 1);
    yes('S2 and it stops waiting', h.still() === 0);
    yes('S2 and it says in the log that the choice is done',
        h.logs.join(' ').indexOf('in the world') !== -1);
  }

  // S3: it does not say it forever. A client that never takes it is a fault
  //     worth a line in the log, not a message every two seconds until the
  //     game closes.
  {
    const h = harness();
    const t0 = 3000000;
    h.chose(7, t0);
    h.say(t0 + h.forMs + 1);
    yes('S3 past the limit it gives up', h.still() === 0);
    yes('S3 and says so once, naming what went wrong',
        h.logs.join(' ').indexOf('never loaded') !== -1);
    const n = h.logs.length;
    h.say(t0 + h.forMs + h.every + 2);
    yes('S3 and does not say it again', h.logs.length === n);
  }

  // S4: a world flag that throws is not a reason to stop. It would read as
  //     having arrived, which is the one wrong answer here.
  {
    const h = harness();
    const t0 = 4000000;
    h.chose(9, t0);
    Object.defineProperty(h.world, 'here',
      { get: function () { throw new Error('no globals yet'); } });
    h.say(t0 + h.every + 1);
    yes('S4 a flag that throws still leaves it saying the choice',
        h.still() === 9);
  }

  // S5: the retries are visible in the log, because that log is the only place
  //     anybody can watch this work. A run where the client was ready shows
  //     none of them at all, so a run that shows them is one that would have
  //     been stuck before the fix.
  {
    const h = harness();
    const t0 = 5000000;
    h.chose(11, t0);
    h.say(t0 + h.every + 1);
    yes('S5 the first retry says so in the log',
        h.logs.join(' ').indexOf('saying it again') !== -1);
    // The two flags remoteServer decides on are the whole diagnosis, so they
    // have to be in the line somebody will be reading.
    yes('S5 and the line carries the in-world flag',
        h.logs.join(' ').indexOf('inWorld=') !== -1);
    yes('S5 and the uncaused load count that the guard actually reads',
        h.logs.join(' ').indexOf('uncausedLoads=') !== -1);
    const first = h.logs.length;
    for (let i = 2; i <= 9; i++) { h.say(t0 + h.every * i + i); }
    yes('S5 and the next eight stay quiet', h.logs.length === first);
    h.say(t0 + h.every * 10 + 10);
    yes('S5 and the tenth speaks up again', h.logs.length === first + 1);
  }
}

// ------------------------------------------------------- the clock is real
//
// PROVED IN A TESTER'S LOG, 21 September: the resends ran from 17:35:55 to
// 17:38:01, which is 126 seconds, and the ninety second give up never fired.
// Every resend asks the page to send again, that arrives back as another
// menuChose, and menuChose was restarting the clock each time, so it was
// reset two seconds before it was ever due. The same shape as the chargen
// nudge that sat unreachable behind its own guard, written the same evening.
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the clock is only started when the choice is new',
      /if \(menuChosenId !== id\)/.test(code));
  const guard = code.indexOf('if (menuChosenId !== id)');
  const at = code.indexOf('menuChosenAt = Date.now()');
  yes('THE BUG: nothing restarts the clock outside that guard',
      guard > 0 && at > guard);
  yes('and the clock is set in exactly one place',
      (code.match(/menuChosenAt = Date\.now\(\)/g) || []).length === 1);
}

// ---------------------------------------------------------------- structure
//
// The repeat has to run after menuChose parks the phase at 9, so the tick
// cannot return before reaching it.
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const call = code.indexOf('keepSayingChoice(now)');
  const parked = code.indexOf('if (menuPhase === 9) { return; }');
  yes('the tick calls it', call > 0);
  yes('the tick still gives up on phase 9 for everything else', parked > 0);
  yes('THE BUG: it is called BEFORE the phase 9 return, not after',
      call > 0 && parked > 0 && call < parked);
  yes('menuChose starts it rather than going quiet',
      /menuChosenId = id;/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
