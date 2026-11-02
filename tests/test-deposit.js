// test-deposit.js
//
// A seam holds twenty, gives one a swing, and comes back on a clock.
//
// Patrick, 21 September, after playing it: "make each quarry have up to 20 ore
// and not skip the animation ... you get an ore each time you hit it you know
// not all at omce so you can stay for a little and get a little or stay andd
// get all 20", with ten minutes for iron, gold, corundum and silver and thirty
// for moonstone, quicksilver, orichalcum, ebony and malachite. Issue #1380 put
// the miner page's own clock in their place: iron fifteen, gold twenty,
// corundum and silver ten, the rest thirty. Ebony is a scarce place now.
//
// WHAT IT REPLACED: one press handed over the whole yield and then refused
// everybody for between ten minutes and four hours. A seam was a vending
// machine with a long queue. And every branch of the activate chain ends at
// `return false`, which blocks the engine's own handover, so the mining
// animation was thrown away by our own code.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const a = src.indexOf('const DEPOSIT_SIZE = 20;');
const b = a < 0 ? -1 : src.indexOf('\n}\n', src.indexOf('function depositBackIn', a));
const block = (a >= 0 && b >= 0) ? src.slice(a, b + 3) : null;

yes('the deposit is in the gamemode', block !== null);

/** The real functions, with one reference's property in a box and a clock. */
function rig(startAt) {
  const store = {};
  const clock = { now: startAt || 1000000 };
  const logs = [];
  const fn = new Function(
    'mp', 'log', 'Date', 'Number', 'Math', 'String',
    block + '\nreturn { left: depositLeft, take: takeFromDeposit, ' +
            'backMs: depositBackMs, backIn: depositBackIn, SIZE: DEPOSIT_SIZE };');
  const api = fn(
    { get: function (id, key) { return store[key]; },
      set: function (id, key, v) { store[key] = v; } },
    function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    { now: function () { return clock.now; } },
    Number, Math, String);
  api.clock = clock;
  api.store = store;
  return api;
}

if (block !== null) {
  const REF = 0xabc;

  // S1: twenty in a fresh seam, one at a time.
  {
    const r = rig();
    yes('S1 a seam nobody has touched holds twenty', r.left(REF, 600000) === r.SIZE);
    yes('S1 twenty is the number Patrick asked for', r.SIZE === 20);
    const first = r.take(REF, 600000);
    yes('S1 one swing takes one', first === 20 && r.left(REF, 600000) === 19);
  }

  // S2: THE WHOLE POINT. Stay and work it down, or take a little and go.
  {
    const r = rig();
    let got = 0;
    for (let i = 0; i < 20; i++) { if (r.take(REF, 600000)) { got++; } }
    yes('S2 twenty swings give twenty ore', got === 20);
    yes('S2 and the twenty-first gives nothing', r.take(REF, 600000) === 0);
    yes('S2 and the seam reads as empty', r.left(REF, 600000) === 0);
  }

  // S3: and it comes back on its own clock, for everybody at once.
  {
    const r = rig();
    for (let i = 0; i < 20; i++) { r.take(REF, 600000); }
    yes('S3 still empty a minute later',
        (r.clock.now += 60000, r.left(REF, 600000) === 0));
    yes('S3 full again after ten minutes',
        (r.clock.now += 600000, r.left(REF, 600000) === 20));
    yes('S3 and can be worked again', r.take(REF, 600000) === 20);
  }

  // S4: THE MINER PAGE'S CLOCK, by name (issue #1380).
  {
    const r = rig();
    const ten = ['Corundum Ore', 'Silver Ore'];
    const slow = ['Clay', 'Quarried Stone', 'Moonstone Ore', 'Quicksilver Ore',
                  'Orichalcum Ore', 'Malachite Ore', 'Shellbug Chitin'];
    let allTen = true, allSlow = true;
    ten.forEach(function (n) { if (r.backMs(n) !== 10 * 60000) { allTen = false; } });
    slow.forEach(function (n) { if (r.backMs(n) !== 30 * 60000) { allSlow = false; } });
    yes('S4 iron comes back in fifteen minutes', r.backMs('Iron Ore') === 15 * 60000);
    yes('S4 gold in twenty', r.backMs('Gold Ore') === 20 * 60000);
    yes('S4 corundum and silver in ten', allTen);
    yes('S4 clay, quarried stone, moonstone, quicksilver, orichalcum, malachite and shellbug in thirty', allSlow);
    yes('S4 and an ore nobody named takes the LONGER one, not the shorter',
        r.backMs('Some Modded Ore') === 30 * 60000);
    yes('S4 and so does one with no name at all', r.backMs('') === 30 * 60000);
  }

  // S5: a deposit read while it is refilling does not half-refill.
  {
    const r = rig();
    for (let i = 0; i < 20; i++) { r.take(REF, 1800000); }
    r.clock.now += 1799000;
    yes('S5 a second short of its time it is still empty', r.left(REF, 1800000) === 0);
    r.clock.now += 2000;
    yes('S5 and a second past it is whole again', r.left(REF, 1800000) === 20);
  }

  // S6: a property read that throws is a full seam, not a dead one. Failing
  //     shut here would take every seam in the province out of the game.
  {
    const fn = new Function(
      'mp', 'log', 'Date', 'Number', 'Math', 'String',
      block + '\nreturn depositLeft;');
    const left = fn(
      { get: function () { throw new Error('no property'); }, set: function () { } },
      function () { }, { now: function () { return 1; } }, Number, Math, String);
    yes('S6 a seam the server cannot read is workable, not broken',
        left(REF, 600000) === 20);
  }
}

// ---------------------------------------------------------------- structure
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the chain lets an ALLOW through without saying anything',
      /if \(message === ALLOW\) \{ return; \}/.test(code));
  yes('a swing takes one rather than the whole pair',
      /const yielded = 1;/.test(code));
  // Specific to mining: fishing has its own cooldown and keeps it.
  const mineBody = code.slice(code.indexOf('function mineOre'),
                              code.indexOf('function chopWood'));
  yes('and mining no longer refuses the press with a per-person cooldown',
      mineBody.indexOf('cooldownLeft(') === -1);

  /*
    ============================== ONE ANIMATION, AND A WAY OUT OF IT =========

    Patrick, 22 September: "the mining animation doesnt always use your pick
    and tehre are two ... it stops making the noise as its supposed you dont
    get the ore as it hits the vein ... you get stuck in the animation no way
    out even when tping, a fresh game load, trying to walk away, trying to
    escape menu anyuthing its trapped in that state".

    THIS HARNESS PASSED THROUGH ALL OF THAT, and the line it passed on is the
    first one below as it used to read: 'mining answers ALLOW so the press is
    not blocked', matched with /return ALLOW;/ against the whole file. mineOre
    stopped answering ALLOW and the test went on passing, because chopWood
    still does and the pattern was never anchored to mining. A check that
    cannot fail is not a check. Every one below names the function it is about
    and cuts the file down to it first.

    WHAT WAS ACTUALLY WRONG is written out at SWING_PROPERTY in the gamemode:
    updateOwner scripts run every frame in skymp5-client, not on change, so a
    stored swing replayed sixty times a second forever and survived a fresh
    game load because nothing cleared it.
  */
  yes('mining plays one animation, not the engine\'s as well',
      mineBody.indexOf('return ALLOW') === -1);
  yes('the swing script only fires when the stamp moves',
      /st\.thornswoodSwingAt === v\.at/.test(code));
  yes('and it gives up when there is no state to remember the stamp in',
      /var st = ctx\.state;[\s\S]{0,40}if \(!st\) \{ return; \}/.test(code));
  yes('a swing is taken off the character once it is swung',
      /mp\.set\(actorId, SWING_PROPERTY, \{ anim: '', at: 0 \}\)/.test(code));
  yes('the exit is the graph reset as well as the named one',
      /IdleForceDefaultState/.test(code));
  yes('the ore comes off the strike and not off the press',
      /swing\(actorId, SWING_MINE, function \(\)/.test(code));
  yes('and so does the salt',
      code.slice(code.indexOf('function mineSalt'),
                 code.indexOf('function rankWord'))
          .indexOf('swing(actorId, SWING_MINE, function ()') !== -1);
  yes('a press inside a swing is not a second strike',
      /if \(swinging\(actorId\)\) \{ return ''; \}/.test(code));
  /*
    ONE PRESS IS A SPELL OF MINING, not one swing.

    Patrick, in the world on 23 September: "it's not doing one animation with
    multiple swings it's doing it one at a time and you have to keep
    clicking". These hold the six ways a spell ends, because the one that
    matters is not the happy path: a loop that keeps swinging after somebody
    has walked away, logged out or broken their pick is worse than clicking.
  */
  yes('one press starts a spell of mining rather than a single swing',
      /MINE_SESSION\[actorId\] = spell;/.test(code));
  yes('and pressing again puts the pick down',
      /if \(mining\(actorId\)\) \{[\s\S]{0,120}stopMining\(actorId\);/.test(code));
  yes('every swing checks it is still the spell it started under',
      /if \(MINE_SESSION\[actorId\] !== spell\) \{ return; \}/.test(code));
  yes('walking away from the seam ends it',
      /if \(!stillAt\(actorId, refrId\)\)/.test(code) && /MINE_AWAY/.test(code));
  yes('and the distance is measured off the server rather than asked of the client',
      /function stillAt[\s\S]{0,400}mp\.get\(refrId, 'pos'\)/.test(code));
  yes('a pick that broke ends it',
      /if \(toolGate\(actorId, 'miner'\)\) \{ stopMining\(actorId\); return; \}/.test(code));
  yes('the seam running out ends it',
      /const more = takeFromDeposit\(refrId, backMs\);[\s\S]{0,120}stopMining\(actorId\);/.test(code));
  yes('the last piece of the seam ends it rather than swinging at nothing',
      /if \(took === 1\) \{ stopMining\(actorId\); return; \}/.test(code));
  yes('logging out ends it, by the next swing asking who is online',
      /if \(miningGone\(actorId\)\) \{ stopMining\(actorId\); return; \}/.test(code) &&
      /function miningGone[\s\S]{0,300}mp\.get\(0, 'onlinePlayers'\)/.test(code));
  yes('and there is a hard stop that no real seam reaches',
      /swungThisSpell >= MINE_MOST/.test(code) && /const MINE_MOST = \d+;/.test(code));
  /*
    ONE ANIMATION FOR THE SPELL, NOT ONE PER STRIKE.

    Patrick, 23 September: "It's stopping the animation and going back in that
    doesn't flow smoothly", and "Still a pick on my hip when I am swinging".
    The first strike enters IdlePickaxeEnter and HOLDS it with the pickaxe in
    hand; the strikes after it send nothing to the client at all; the exit is
    one message when the spell ends. These hold that shape, because "play the
    animation again" is the obvious thing to write here and it is the bug.
  */
  yes('the first strike holds the animation instead of letting it go',
      /swing\(actorId, SWING_MINE, function \(\) \{ lands\(\); \}, \{ hold: true, tool: pick \}\)/.test(code));
  yes('and the ones after it send no animation, only the yield',
      /setTimeout\(guard\('mineLands', function \(\) \{ lands\(\); \}\), SWING_LAND_MS\)/.test(code));
  yes('the strikes come at the rhythm of the swing itself',
      /setTimeout\(guard\('mineAgain', again\), SWING_MS\)/.test(code));
  yes('the pickaxe the person owns is the one put in their hands',
      /const pick = toolIdIn\(actorId, 'miner'\)/.test(code) &&
      /function toolIdIn\(actorId, key\)/.test(code));
  // #611: the pick comes off for the swing, because the animation carries its
  // own, and goes back on after it only if it was on before. This used to look
  // for pc.equipItem(it, false, true), which since #611 only the wear script
  // had, so it was holding the wrong code; the wear script is gone (#1560).
  yes('the client takes the pick off for the swing and puts it back after, if it was on',
      /if \(had\) \{ pc\.unequipItem\(it, false, true\); \}/.test(code) &&
      /if \(back\) \{ pc\.equipItem\(back, false, true\); \}/.test(code));
  yes('a held swing is not ended by a timer, because the spell ends it',
      /if \(o\.hold\) \{/.test(code) && /function swingEnd\(actorId, tool\)/.test(code));
  yes('and stopping a spell is the one place the animation is left',
      /function stopMining\(actorId\) \{[\s\S]{0,260}swingEnd\(actorId, tool\);/.test(code));

  yes('the chopping block is left to Skyrim\'s own furniture',
      code.slice(code.indexOf('function chopWood'),
                 code.indexOf('\n}\n', code.indexOf('function chopWood')))
          .indexOf('swing(') === -1);
  yes('the skills panel is not pushed to the browser every frame',
      /st\.thornswoodPanel === body/.test(code));
  yes('the clock is read by the whole name, so quicksilver is never silver',
      /'quicksilver ore': 30/.test(code) && /'silver ore': 10/.test(code) &&
      /hasOwnProperty\.call\(DEPOSIT_BACK_MIN, n\)/.test(code));

  /*
    THE CHECK THIS HARNESS DID NOT HAVE, AND THE REASON IT PASSED ALL EVENING
    WHILE PATRICK TOOK A HUNDRED ORE OUT OF ONE VEIN.

    Everything above drives the real functions over a pretend mp whose get and
    set work. On the live server they did not. DEPOSIT_PROPERTY was the only
    property in gamemode.js never registered with mp.makeProperty, so every
    read threw, depositLeft's fail-open answered a full seam, and every write
    threw as well. The arithmetic was perfect and there was nowhere to keep it.

    A harness that supplies its own storage can never find that. So it asks the
    file instead, which is the one question a stub cannot answer.
  */
  yes('the deposit property is registered, or nothing it counts is ever stored',
      /mp\.makeProperty\(DEPOSIT_PROPERTY/.test(code));
  yes('and a seam that cannot be written says so rather than never running out',
      src.indexOf('CANNOT BE WRITTEN') !== -1);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
