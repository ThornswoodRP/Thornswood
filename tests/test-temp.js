// test-temp.js
//
// Temperature: where you are standing, what you are wearing, and the fire.
//
// Patrick, 23 September, with five screenshots of the meter reading Fine 50
// outside at night, beside a brazier, inside the Bannered Mare and standing in
// its fire pit: "not any warmer when near or in fire or in a building also
// make so if you are in a fire you catch on fire". Then "yeah forges and stuff
// like that should be included too because they are hot", and "also clothing
// should affect temperature depening on what clothes and if you are weaing
// them no clothes should equal colder some clothes/armor should be hotter than
// others etc".
//
// THE METER WAS NEVER WRONG. Nothing ever told it where anybody was standing,
// so every one of those screenshots is the same bug: n.place was '' and the
// target was always comfort. So the first thing this checks is that the two
// halves are actually joined up - that the client reports, that the server has
// a number for every word the client can send, and that the fire table the
// client scans with is the one the builder wrote.
//
// It drives the REAL needs block out of gamemode.js over a fake mp and a fake
// clock, the way test-needs.js does.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const FRONT = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const A = '// ==== thornswood needs: hunger, thirst and exhaustion ====';
const B = '// ==== end thornswood needs ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('the needs block is in the gamemode', block !== null);

// The installed table, lifted rather than re-read from warmth.json, because
// what the server runs on is the line in gamemode.js.
const warmLine = require('./gamemode-tables.js').lineOf(src, 'WARMTH');
yes('the warmth table is installed in the gamemode', !!warmLine);
const WARMTH = warmLine ? JSON.parse(warmLine[1]) : { items: {} };
const skyLine = require('./gamemode-tables.js').lineOf(src, 'WEATHER');
const WEATHER = skyLine ? JSON.parse(skyLine[1]) : { most: 0, mid: 0, items: {} };
const wetLine = require('./gamemode-tables.js').lineOf(src, 'WATERS');
const WATERS = wetLine ? JSON.parse(wetLine[1]) : { items: {} };

/*
  The rig.

  idOf and the inventory are the two things the clothing half needs and that
  test-needs.js does not supply: descriptors are resolved to numbers on a live
  server out of the load order, so here every descriptor resolves to its own
  index, and the fake mp answers 'inventory' with whatever the test dressed
  somebody in.
*/
function rig() {
  const store = {};
  const worn = {};
  const equipped = {};
  const cells = {};
  const pos = {};
  const props = {};
  const clock = { now: 1700000000000 };
  const ids = {};
  let nextId = 0x10;
  function idOf(desc) {
    if (!ids[desc]) { ids[desc] = nextId++; }
    return ids[desc];
  }
  const Fake = {
    makeProperty: function () { },
    // The real one turns a form id back into its descriptor. The rig knows
    // both halves already, because it is what hands out the ids.
    getDescFromId: function (id) {
      for (const d in ids) {
        if (Object.prototype.hasOwnProperty.call(ids, d) && ids[d] === id) { return d; }
      }
      return '';
    },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(store).map(Number); }
      if (key === 'worldOrCellDesc') { return cells[id] || 'cell:X.esm'; }
      if (key === 'inventory') { return { entries: worn[id] || [] }; }
      if (key === 'equipment') {
        if (!Object.prototype.hasOwnProperty.call(equipped, id)) { return undefined; }
        return { inv: { entries: equipped[id] || [] } };
      }
      if (key === 'pos') { return pos[id] || [0, 0, 0]; }
      return store[id] ? store[id].v : undefined;
    },
    set: function (id, key, v) {
      if (key === 'thornswoodBurn') {
        if (!props[id]) { props[id] = []; }
        props[id].push(v);
        return;
      }
      if (!store[id]) { store[id] = {}; }
      store[id].v = v;
    }
  };
  let ticker = null;
  const fn = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
    'idOf', 'WARMTH', 'WEATHER', 'WATERS',
    block + '\nreturn globalThis.__thornswoodNeeds;');
  const api = fn(
    {}, Fake, { now: function () { return clock.now; } },
    { log: function () { } },
    // The burn timer is caught rather than run, so a test can beat it by hand.
    function (f, ms) { if (ms <= 3000) { ticker = f; } return 0; },
    function () { },
    function (n, f) { return f; },
    function () { }, function () { },
    Math, Number, String, Object, isFinite,
    idOf, WARMTH, WEATHER, WATERS);
  api.clock = clock;
  api.idOf = idOf;
  api.cellOf = function (id, desc) { cells[id] = desc; };
  api.putAt = function (id, xyz) { pos[id] = xyz; if (!store[id]) { store[id] = {}; } };
  api.caught = function (id) { return props[id] || []; };
  api.burnTick = function () { if (ticker) { ticker(); } };
  /** Put a set of descriptors on somebody's back (inventory + equipment). */
  api.dress = function (id, descs) {
    const entries = descs.map(function (d) { return { baseId: idOf(d), worn: true }; });
    worn[id] = entries;
    equipped[id] = entries.slice();
  };
  /** The same things, in the pack rather than on. */
  api.carry = function (id, descs) {
    worn[id] = descs.map(function (d) { return { baseId: idOf(d), worn: false }; });
    equipped[id] = [];
  };
  /** A worn thing by raw id, for the piece no table has heard of. */
  api.wearRaw = function (id, baseId) {
    const entries = [{ baseId: baseId, worn: true }];
    worn[id] = entries;
    equipped[id] = entries.slice();
  };
  /**
   * Inventory worn flags say one thing; equipment says another.
   * #608: warmth must follow equipment when that record is readable.
   */
  api.dressDisagree = function (id, invDescs, eqDescs) {
    worn[id] = (invDescs || []).map(function (d) { return { baseId: idOf(d), worn: true }; });
    equipped[id] = (eqDescs || []).map(function (d) { return { baseId: idOf(d), worn: true }; });
  };
  api.minutes = function (m) { clock.now += m * 60000; };
  return api;
}

/*
  One descriptor out of the installed table, by material and by EXACTLY what it
  covers.

  Exactly, not "contains", and that is the second time coverage has been the
  thing that broke a comparison in this file. Asking for any heavy piece
  covering a body and any cloth piece covering a body got a cuirass that also
  covered arms and a shirt that did not, so "metal is worse than cloth" was
  being measured against two different amounts of skin and came out backwards.
  Two things that differ in two ways measure neither.
*/
function oneOf(material, covers) {
  for (const d in WARMTH.items) {
    if (!Object.prototype.hasOwnProperty.call(WARMTH.items, d)) { continue; }
    const r = WARMTH.items[d];
    if (r.m === material && (!covers || r.c === covers)) { return d; }
  }
  return null;
}

if (block) {
  const NEEDS = rig().NEEDS;

  // ------------------------------------------------ the two halves joined up
  {
    /*
      EVERY WORD THE CLIENT CAN SEND HAS A NUMBER HERE.

      This is the check that would have caught the original bug if the client
      had ever been written: place() refuses a word it has no number for and
      answers '' without saying anything, so a client reporting 'outdoors' to a
      server that has never heard of it looks exactly like a client that is not
      reporting at all.
    */
    /*
      THE PLACE BLOCK, NOT THE WHOLE PLUGIN. The first version of this searched
      the file for `kind = '...'` and found the jump and sprint state machines
      several hundred lines away, then reported the server as missing numbers
      for "jump" and "sprint". Scope the search to the block that is being
      tested; this file has now made that mistake once and test-hud.js twice.
    */
    const from = FRONT.indexOf('const FIRE_BASES');
    const to = FRONT.indexOf('   * Jump and sprint.', from);
    const where = (from >= 0 && to > from) ? FRONT.slice(from, to) : '';
    yes('the place block is findable in the plugin', !!where);
    const sends = (where.match(/kind = '([a-z]+)'/g) || [])
      .map(function (s) { return /'([a-z]+)'/.exec(s)[1]; });
    yes('the client reports a place at all', sends.length >= 5);
    const missing = sends.filter(function (w) { return typeof NEEDS.place[w] !== 'number'; });
    yes('and the server has a number for every word it sends' +
        (missing.length ? ' (missing ' + missing.join(', ') + ')' : ''),
        missing.length === 0);
    yes('the client sends it over the one channel there is',
        /'\/place '/.test(where) && /tellServer\(line\)/.test(where));
    yes('and the server answers that command',
        /word === '\/place'/.test(src));
    // The line carries the weather, the clock, the roof and the height as
    // well as the word, and the server has to read all five.
    yes('the line carries the weather, the clock, the roof and the height',
        /skyId/.test(where) && /night/.test(where) &&
        /indoors \? 1 : 0/.test(where) && /pz \/ 500/.test(where));
    yes('and the server takes all five off the command',
        /pl\.place\(actorId, String\(parts\[1\] \|\| ''\), parts\[2\], parts\[3\],/.test(src));
    /*
      #841: night must follow GameHour (what paints the sky), not
      Utility.getCurrentGameTime (GameDaysPassed). SkyMP TimeService writes
      0x38 and never GameDaysPassed, so the old clock could disagree with
      what is on screen.
    */
    yes('night reads GameHour 0x38 for what is on screen (#841)',
        /GlobalVariable\.from\(sp\.Game\.getFormEx\(0x38\)\)/.test(where) &&
        /hour < 6 \|\| hour >= 20/.test(where));
    yes('night does not use getCurrentGameTime any more (#841)',
        !/getCurrentGameTime\(\)/.test(where));
  }

  // ------------------------------------------------------ the fire table
  {
    let fires = null;
    try { fires = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'fires.json'), 'utf8')); }
    catch (e) { fires = null; }
    yes('the fire table has been built', !!fires && Array.isArray(fires.fires));
    if (fires) {
      const listed = /const FIRE_BASES = \[([\s\S]*?)\n  \];/.exec(FRONT);
      yes('the plugin carries a list of fire bases', !!listed);
      if (listed) {
        /*
          EACH ROW IS A FILE AND AN ID INSIDE IT, not a runtime id, and that is
          the change of 23 September. A mod's form id is its place in the load
          order and moves whenever anybody adds a mod, so the client resolves
          anything outside Skyrim.esm with Game.getFormFromFile. The table is
          the same pair, so they are compared as pairs.
        */
        const inPlugin = (listed[1].match(/\['([^']+)',\s*(0x[0-9a-f]+)(?:,\s*'craft')?\]/g) || [])
          .map(function (t) {
            const m = /\['([^']+)',\s*(0x[0-9a-f]+)/.exec(t);
            return m[1].toLowerCase() + ':' + parseInt(m[2], 16);
          }).sort();
        const inTable = fires.fires.map(function (f) {
          return f.file.toLowerCase() + ':' + parseInt(f.local, 16);
        }).sort();
        /*
          THE ONE THING KEEPING A HAND EDIT HONEST. The list in the plugin is
          what the client actually scans with; fires.json is what the builder
          measured. If somebody adds an id to the plugin by hand, or rebuilds
          the table and forgets the plugin, this is where it shows up.
        */
        yes('and it is exactly what the builder measured (' + inTable.length + ')',
            inPlugin.length === inTable.length &&
            inPlugin.every(function (v, i) { return v === inTable[i]; }));
        /*
          AND THE MOD FIRES ARE IN IT, which is the whole reason this changed.
          Patrick walked into a fire on 23 September and the temperature did
          not move: this collection has Embers XD, a fire overhaul, and every
          fire the client knew about came out of Skyrim.esm.
        */
        const mods = fires.fires.filter(function (f) {
          return ['skyrim.esm', 'update.esm', 'dawnguard.esm', 'hearthfires.esm',
                  'dragonborn.esm'].indexOf(f.file.toLowerCase()) === -1;
        });
        yes('fires a mod added are in it too (' + mods.length + ')', mods.length > 0);
        yes('and the client resolves those through the file rather than an id',
            /getFormFromFile/.test(FRONT));
        /*
          AND IT WALKS THE CELL RATHER THAN ASKING FOR THE CLOSEST REFERENCE.

          Game.findClosestReferenceOfType finds PERSISTENT references, and a
          fire placed in an inn is not one. It answered null for all 62 bases
          everywhere on 23 September: in the Bannered Mare fire pit, in its
          cooking fire, in the brazier outside it. Cell.getNumRefs sees
          temporary references too, which is the whole of the fix, so this
          holds the shape: no closest-reference call, a walk of the cell, and
          the four form types the table is built from.
        */
        /*
          The CALL, not the word: the note explaining why that call was wrong
          names it four times, and a check that cannot tell prose from code
          would have to be deleted the day somebody writes the reason down.
        */
        yes('the client walks the cell instead of asking for the closest reference',
            /getNumRefs\(/.test(FRONT) && /getNthRef\(/.test(FRONT) &&
            FRONT.indexOf('sp.Game.findClosestReferenceOfType(') === -1);
        yes('and it asks for the four form types the table is built from',
            /const CELL_TYPES = \[24, 34, 36, 42\];/.test(FRONT));
        yes('a fire somebody switched off is still skipped',
            /off = !!r\.isDisabled\(\)/.test(FRONT));
        yes('and a walk is kept for the cell rather than redone every probe',
            /if \(cellId !== fireCell\)/.test(FRONT) &&
            /if \(!fireHere && !fireWalk\)/.test(FRONT));
        // #2590: walked again when the cell says it has loaded, never on a clock.
        yes('the cell underfoot is walked again when it finishes loading, not on a timer',
            /sp\.on\('cellFullyLoaded', guard\('fire cell loaded', fireCellLoaded\)\)/.test(FRONT) &&
            !/const FIRE_EMPTY_RETRY =/.test(FRONT) && !/const FIRE_IDS_RETRY =/.test(FRONT));
        yes('using a forge furniture counts as standing in the heat',
            /getFurnitureReference/.test(FRONT) &&
            /function fireDistance/.test(FRONT));
      }
      // The unlit ones are the trap: a name match would have warmed people up
      // at a dead campfire.
      const out = fires.fires.filter(function (f) {
        // Embers names its unlit variants NoFire rather than Off, and one of
        // them was in the first table read off the whole order.
        return /((off|out)\d*$)|nofire|unlit/i.test(f.edid);
      });
      yes('no unlit fire made it into the table', out.length === 0);
      const craft = fires.fires.filter(function (f) { return f.kind === 'craft'; });
      yes('forges and smelters are in it, which Patrick asked for by name',
          craft.length >= 4 &&
          craft.some(function (f) { return /Forge/i.test(f.edid); }) &&
          craft.some(function (f) { return /Smelter/i.test(f.edid); }));
    }
  }

  // ---------------------------------------------------- the meter actually moves
  {
    const api = rig();
    api.seedAt = 1;
    api.view(1);                       // make a state
    api.place(1, 'fire');
    const before = api.view(1).temp;
    api.minutes(3);
    const after = api.view(1).temp;
    /*
      THE HALF LIFE, AND IT HAS BEEN WRONG TWICE.

      First it read warmth: 60 "per real hour" and fed it to a power of a half,
      which worked out at about half a point a minute: an hour of standing in a
      fire to read as warm.

      Then it was three minutes for everything, which is what Patrick was
      standing in the Bannered Mare's fire pit measuring on 23 September when
      he said "Fire is still not changing temp but I do catch on fire now and
      take damage". The client was reporting the fire and the server was
      warming him: from 51 toward 84 it reached 52.2 in ten seconds and 54.6 in
      thirty, and nobody stands in a fire for three minutes to find out whether
      a number works.

      Warming is half a minute now and cooling is a minute and a half, because
      a fire warms you in seconds and a cold night takes you slowly. Half a
      minute in a fire whose target is 92 takes a fresh 50 to about 71.
    */
    yes('standing in a fire actually warms you up', after > before + 10);
    const quick = rig();
    quick.view(4);
    quick.place(4, 'fire');
    quick.minutes(0.5);
    yes('and half a minute in it is halfway there, because heat is fast',
        Math.abs(quick.view(4).temp - (50 + (92 - 50) / 2)) < 4);
    quick.minutes(0.5);
    yes('and a minute in is most of the way',
        quick.view(4).temp > 50 + (92 - 50) * 0.7);

    api.place(1, 'snow');
    api.minutes(9);
    yes('and walking into a blizzard takes it back down', api.view(1).temp < 30);
  }

  // ---------------------------------------------------------- outdoors is cool
  {
    const api = rig();
    api.view(2);
    api.place(2, 'outdoors');
    api.minutes(30);
    const out = api.view(2).temp;
    const api2 = rig();
    api2.view(3);
    api2.place(3, 'indoors');
    api2.minutes(30);
    yes('being outside is cooler than being under a roof', out < api2.view(3).temp);
    yes('but standing in a field is not an emergency', out >= 35);
  }

  // ------------------------------------- the two minutes that read as broken
  /*
    PATRICK'S OWN SESSION, 23 September, written down because the numbers he
    read were right and looked wrong.

    He stood in the creation hall, saw 51, walked outside, saw it move
    between 53 and 54, and said: "I went outside and it's going between 53
    and 54 which is backwards inside is supposed to be warmer".

    Both readings are the meter working. Indoors the target is 58 and the
    meter moves half the remaining distance every three minutes, so a minute
    indoors from a fresh 50 is about 51. Outdoors on a clear day the target
    is in the forties, and a meter that had climbed into the fifties comes
    DOWN through 54 and 53 on its way there. The direction of travel is the
    opposite of what the number looks like.

    That is why /needs now says where it is heading. These checks hold the
    shape so nobody re-diagnoses slow as broken, and so nobody 'fixes' it by
    making the meter snap.
  */
  {
    const api = rig();
    api.view(7);
    api.place(7, 'indoors');
    api.minutes(1);
    const oneMinuteIn = api.view(7).temp;
    /*
      THIS CHECK USED TO HOLD THE SYMPTOM DOWN. It read "a minute indoors from
      fresh is barely off 50, which is what he saw", and it was right about
      what he saw: 51. That was the meter being too slow to read rather than
      the meter being wrong, and the answer was to make warming fast rather
      than to keep explaining the 51. A minute indoors now gets most of the way
      to 58, which is a number somebody can watch move.
    */
    yes('a minute indoors from fresh is most of the way to warm',
        oneMinuteIn > 55 && oneMinuteIn <= 58);
    api.minutes(29);
    const settledIn = api.view(7).temp;
    yes('and half an hour indoors is genuinely warm', settledIn > 55);

    // Now walk outside, warm, on a clear day with no roof.
    api.place(7, 'outdoors');
    api.minutes(1);
    const first = api.view(7).temp;
    api.minutes(1);
    const second = api.view(7).temp;
    yes('stepping outside warm, the number falls rather than rises',
        first < settledIn && second < first);
    yes('and it is in the fifties on the way down, which is what looked backwards',
        first < 58 && first > 50);

    // The report that settles it in one command.
    const v = api.view(7);
    yes('the view says where the warmth is heading', typeof v.tempTarget === 'number');
    yes('and the target outdoors is below the target indoors', v.tempTarget < 50);
    yes('it says which place the server believes', v.place === 'outdoors');
    yes('it says whether there is a roof', v.roof === false);
    yes('it says whether it can see a fire', v.fireAway === -1 && v.fireWorth === 0);
    yes('and what the weather and the height are worth', typeof v.exposure === 'number');
    yes('and how much of you is covered', typeof v.cover === 'number');
  }

  // ------------------------------------------------ naked is colder, dressed is not
  /*
    "still spawned in with no clothes on", and then clothes on and off making
    no difference he could see. On a mild day it genuinely is small: the
    clothes pull the target toward comfortable, and outdoors on a clear day
    the target is only a few degrees off comfortable to begin with. In the
    cold it is the difference between survivable and not, which is the point
    of the design. Both are held here so that neither gets tuned away.
  */
  {
    const mild = rig();
    mild.view(8);
    mild.place(8, 'outdoors');
    mild.minutes(30);
    const bareMild = mild.view(8).temp;

    const cold = rig();
    cold.view(9);
    cold.place(9, 'snow');
    cold.minutes(30);
    const bareCold = cold.view(9).temp;
    yes('bare skin in the snow is dangerous', bareCold < 25);
    yes('bare skin on a mild day is not', bareMild > 35);
    yes('so on a mild day clothes cannot be worth much, which is why they looked dead',
        Math.abs(50 - bareMild) < 12);
  }

  // ------------------------------------------------------------- the clothes
  {
    const fur = oneOf('fur', 'body');
    const heavy = oneOf('heavy', 'body');
    const cloth = oneOf('cloth', 'body');
    yes('the table has a fur, a metal and a cloth body piece to test with',
        !!fur && !!heavy && !!cloth);

    function coldAfter(descs, wearIt) {
      const api = rig();
      api.view(9);
      if (descs) { (wearIt ? api.dress : api.carry)(9, descs); }
      api.place(9, 'snow');
      api.minutes(60);
      /*
        THE RAW NUMBER, NOT THE ROUNDED ONE. view() rounds for the screen, and
        a shirt and a steel cuirass over the same skin differ by less than half
        a point, so comparing what the HUD would print reported them as
        identical and "metal is worse than cloth" failed on the rounding rather
        than on the arithmetic.
      */
      return api.settle(9).temp;
    }

    if (fur && heavy && cloth) {
      const bare = coldAfter(null, true);
      const inFur = coldAfter([fur], true);
      const inSteel = coldAfter([heavy], true);
      const inCloth = coldAfter([cloth], true);

      yes('bare skin in a blizzard is the coldest there is', bare < inCloth);
      yes('fur is the warmest thing in the game', inFur > inCloth && inFur > inSteel);
      yes('and metal is the worst of the things that are not nothing',
          inSteel < inCloth);
      // Patrick's own words: "if you are weaing them".
      const carried = coldAfter([fur], false);
      yes('a coat in your pack keeps nobody warm', Math.abs(carried - bare) < 0.01);
      // Nothing makes a blizzard comfortable.
      yes('and no outfit turns a blizzard into a spring day', inFur < 45);

      /*
        AND THE REPORT NAMES WHAT IT COUNTED.

        Patrick, 23 September: "temperature was not right it said the same
        with clothes, without clothes, and with a mix". Four different faults
        produce that sentence and nothing on screen told them apart. This is
        the half that separates the server not knowing about the clothes from
        the clothes being worth little on the day.
      */
      {
        const api = rig();
        api.view(11);
        api.dress(11, [fur]);
        const v = api.view(11);
        yes('the report lists what is worn', Array.isArray(v.worn) && v.worn.length === 1);
        /*
          The descriptor, not a bare id. The installed table has no editor
          ids in it, so this is what a worn thing is called, and it is the
          more useful of the two here: it names the plugin the piece came
          from, which is the question being asked when clothes are not
          counting.
        */
        yes('and names it rather than printing a bare id',
            !!v.worn[0].name && v.worn[0].name.indexOf(':') > 0);
        yes('and says what it is worth', v.worn[0].known === true && v.worn[0].worth > 0);
        yes('and the cover matches the pieces', v.cover > 0);

        const bare2 = rig();
        bare2.view(12);
        const vb = bare2.view(12);
        yes('somebody the server sees nothing on lists nothing',
            Array.isArray(vb.worn) && vb.worn.length === 0 && vb.cover === 0);
        // Pack says fur is worn; equipment is empty: warmth must be bare (#608).
        {
          const apiD = rig();
          apiD.view(920);
          apiD.dressDisagree(920, [fur], []);
          const vd = apiD.view(920);
          yes('equipment empty wins over inventory worn flags',
              vd.cover === 0 && Array.isArray(vd.worn) && vd.worn.length === 0);
          // Pack flags clear; equipment has fur: warmth must count the coat.
          apiD.view(921);
          apiD.dressDisagree(921, [], [fur]);
          const ve = apiD.view(921);
          yes('equipment worn counts even when inventory flags are clear',
              ve.cover > 0 && ve.worn.length === 1);
        }

        // A worn thing the table has never heard of is said out loud rather
        // than counted as zero and forgotten, because that is the shape of a
        // mod piece nobody classified.
        const odd = rig();
        odd.view(13);
        odd.wearRaw(13, 0x7ffffff);
        const vo = odd.view(13);
        yes('an unknown worn thing is named as unknown rather than ignored',
            vo.worn.length === 1 && vo.worn[0].known === false);
      }
    }

    /*
      EVERY PIECE ON ITS OWN, WHICH IS WHAT PATRICK ASKED FOR.

      23 September: "different types of clothes and wether one is on and others
      are like a hat, helmet, scarf, cape, shirt, pants, boots, gloves, etc are
      all counted individually and not grouped".

      The table names the part each record covers and NEEDS.wear.perPart prices
      it. A part with no price is a silent zero: a cloak worth nothing looks
      exactly like a cloak nobody is wearing, which is the bug this catches.
    */
    {
      const seen = {};
      for (const d in WARMTH.items) {
        if (!Object.prototype.hasOwnProperty.call(WARMTH.items, d)) { continue; }
        WARMTH.items[d].c.split(',').forEach(function (p) { seen[p] = true; });
      }
      const parts = Object.keys(seen).sort();
      const unpriced = parts.filter(function (p) {
        return typeof NEEDS.wear.perPart[p] !== 'number';
      });
      yes('every part the table produces has a price' +
          (unpriced.length ? ' (missing ' + unpriced.join(', ') + ')' : ''),
          unpriced.length === 0);
      yes('and the pieces Patrick named are in there separately (' + parts.length + ' parts)',
          seen.head && seen.body && seen.feet && seen.hands && seen.neck && seen.back);

      // Two pieces on different skin are worth more than either alone.
      const boots = oneOf('fur', 'feet');
      const shirt = oneOf('fur', 'body');
      yes('the table has a fur body piece and fur boots', !!boots && !!shirt);
      if (boots && shirt) {
        function cold(descs) {
          const api = rig();
          api.view(11);
          api.dress(11, descs);
          api.place(11, 'snow');
          api.minutes(60);
          return api.settle(11).temp;
        }
        const both = cold([shirt, boots]);
        yes('boots and a shirt beat a shirt on its own',
            both > cold([shirt]));
        yes('and barefoot costs exactly the boots', both > cold([shirt]) &&
            cold([boots]) > cold([]));
      }
    }

    /*
      AND IT COUNTS IN THE WATER. Patrick: "Make sure clothing affects temp
      while swimming or wading too like barefoot but still has clothes on or
      heavy armor etc".
    */
    if (fur) {
      function swimming(descs, place) {
        const api = rig();
        api.view(12);
        if (descs) { api.dress(12, descs); }
        api.place(12, place, '-', '0', '1', '0');
        api.minutes(60);
        return api.settle(12).temp;
      }
      yes('clothes still count when you are swimming',
          swimming([fur], 'water') > swimming(null, 'water'));
      yes('and when you are wading',
          swimming([fur], 'shallow') > swimming(null, 'shallow'));
    }

    // AND IT CUTS BOTH WAYS. This is the half that makes it a choice.
    if (fur) {
      function hotAfter(descs) {
        const api = rig();
        api.view(8);
        if (descs) { api.dress(8, descs); }
        api.place(8, 'fire');
        api.minutes(60);
        return api.settle(8).temp;
      }
      yes('and the same coat at a forge makes it worse, not better',
          hotAfter([fur]) > hotAfter(null));
    }
  }

  // --------------------------------------------- wind, night and altitude
  {
    let sky = null;
    try { sky = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'weather.json'), 'utf8')); }
    catch (e) { sky = null; }
    yes('the weather table has been built', !!sky && !!sky.items);
    yes('and is installed in the gamemode', !!skyLine);
    const W = skyLine ? WEATHER : null;

    if (W) {
      /*
        THE MIDDLE IS NOT ZERO, which is the whole reason it is in the table.

        Cathedral Weathers overrides SkyrimClear's wind from 25 to 150 and
        SkyrimStormSnow's from 178 to 150. Scaled against the maximum, a clear
        afternoon would have read as most of a gale. Scaled against the median
        of the load order it reads as nothing, which is what it is.
      */
      yes('the wind is measured against this load order, not against 255',
          W.mid > 0 && W.most > W.mid);

      /*
        TWO WEATHERS OF THE SAME KIND, one calm and one blowing.

        The first version took any weather at or under the median and any at
        the maximum, and the pair it happened to pick were a snowy calm and a
        pleasant gale: the classification term swamped the wind term and the
        check reported the gale as WARMER. Comparing two things that differ in
        two ways measures neither. Same classification, different wind.
      */
      const descs = Object.keys(W.items);
      let calm = null, gale = null;
      for (const kind of [1, 2, 4, 8]) {
        const same = descs.filter(function (d) { return (W.items[d].k & 15) === kind; });
        const low = same.filter(function (d) { return W.items[d].w <= W.mid; })[0];
        const high = same.slice().sort(function (a, b) { return W.items[b].w - W.items[a].w; })[0];
        if (low && high && W.items[high].w > W.items[low].w) { calm = low; gale = high; break; }
      }
      yes('the table has a calm and a windy weather of the same kind to compare',
          !!calm && !!gale);

      function tempIn(opts) {
        const api = rig();
        api.view(20);
        const id = opts.sky ? api.idOf(opts.sky).toString(16) : '-';
        api.place(20, opts.place || 'outdoors', id,
                  opts.night ? '1' : '0', opts.roof ? '1' : '0',
                  String(opts.high || 0));
        api.minutes(60);
        return api.view(20).temp;
      }

      if (calm && gale) {
        yes('a gale is colder than a calm day in the same place',
            tempIn({ sky: gale }) < tempIn({ sky: calm }));
        /*
          AND A ROOF STOPS ALL OF IT. This is the check that says the whole
          exposure term is gated where it says it is: same gale, same night,
          same mountain, one of them indoors.
        */
        const outside = tempIn({ sky: gale, night: true, high: 20000 });
        const inside = tempIn({ sky: gale, night: true, high: 20000, roof: true,
                                place: 'indoors' });
        yes('and none of it reaches somebody under a roof', inside > outside + 10);
      }

      yes('night is colder than day', tempIn({ night: true }) < tempIn({ night: false }));
      yes('a mountain top is colder than the tundra',
          tempIn({ high: 25000 }) < tempIn({ high: 0 }));
      yes('and a hill is not', Math.abs(tempIn({ high: 3000 }) - tempIn({ high: 0 })) < 0.01);

      // A campfire in a blizzard is still a campfire, but it is not an inn.
      if (gale) {
        const fireOut = tempIn({ place: 'fire', sky: gale, night: true });
        const fireIn = tempIn({ place: 'fire', roof: true });
        yes('a fire in the open beats nothing but loses to a fire indoors',
            fireOut > 50 && fireOut < fireIn);
      }

      // A client that knows none of this still works.
      {
        const api = rig();
        api.view(21);
        api.place(21, 'snow');
        api.minutes(60);
        yes('a client that sends the word alone still gets a temperature',
            api.view(21).temp < 30);
      }

      /*
        A BLIZZARD OR A HEAVY STORM SLOWS TRAVEL BY 15 PER CENT (#3176).

        Patrick's page answer of 22 Oct, B. The record has no storm flag and
        the two numbers in the table cannot tell one (Cathedral's storm rain
        and overcast rain both blow at 85 and both are rainy), so the builder
        marks a rainy or snowy weather whose name says Storm, and these are the
        records that prove which way that sorts.
      */
      if (sky && sky.items) {
        const byName = {};
        for (const d of Object.keys(sky.items)) { byName[sky.items[d].e] = d; }
        const marked = function (e) { return !!(byName[e] && W.items[byName[e]] && W.items[byName[e]].s); };
        yes('Bethesda\'s blizzard and storm rain are storms in the installed table',
            marked('SkyrimStormSnow') && marked('SkyrimStormRain'));
        yes('and so are the storms the season roll picks, Cathedral\'s',
            marked('xStormSnow') && marked('xStormRain') && marked('SkyrimStormSnow_WildernessOnly'));
        yes('but overcast rain and overcast snow are not',
            byName.SkyrimOvercastRain && byName.xOvercastRain && byName.SkyrimOvercastSnow &&
            !marked('SkyrimOvercastRain') && !marked('xOvercastRain') && !marked('SkyrimOvercastSnow'));
        const odd = Object.keys(W.items).filter(function (d) {
          return W.items[d].s && !(W.items[d].k & 12);
        });
        yes('every storm is rainy or snowy' + (odd.length ? ' (not ' + odd.join(', ') + ')' : ''),
            odd.length === 0);
        const drift = Object.keys(sky.items).filter(function (d) {
          return !!sky.items[d].s !== !!(W.items[d] && W.items[d].s);
        });
        yes('and the gamemode marks the same storms weather.json does' +
            (drift.length ? ' (not ' + drift.join(', ') + ')' : ''), drift.length === 0);

        function speedIn(opts) {
          const api = rig();
          api.view(22);
          const id = opts.sky ? api.idOf(opts.sky).toString(16) : '-';
          api.place(22, opts.place || 'outdoors', id, '0', opts.roof ? '1' : '0', '0');
          if (opts.wear) { api.dress(22, opts.wear); }
          api.minutes(1);
          const n = api.settle(22);
          return { speed: Number(api.effects(22, n).speedMult) || 0, view: api.view(22) };
        }
        const stormRain = byName.xStormRain, calmRain = byName.xOvercastRain;
        const blizzard = byName.xStormSnow, calmSnow = byName.xOvercastSnow;
        if (stormRain && calmRain && blizzard && calmSnow) {
          yes('a heavy storm is 15 slower than rain in the same place',
              speedIn({ place: 'rain', sky: stormRain }).speed - speedIn({ place: 'rain', sky: calmRain }).speed === -15);
          yes('and a blizzard is 15 slower than falling snow',
              speedIn({ place: 'snow', sky: blizzard }).speed - speedIn({ place: 'snow', sky: calmSnow }).speed === -15);
          yes('but none of it reaches somebody under a roof',
              speedIn({ place: 'indoors', sky: blizzard, roof: true }).speed ===
              speedIn({ place: 'indoors', sky: calmSnow, roof: true }).speed);
          yes('the Body page is told the storm slows them by 15',
              speedIn({ place: 'snow', sky: blizzard }).view.storm === 15 &&
              speedIn({ place: 'snow', sky: calmSnow }).view.storm === 0 &&
              speedIn({ place: 'indoors', sky: blizzard, roof: true }).view.storm === 0);
        }
      }
    }
  }

  // ---------------------------------------------------------- water types
  {
    let wet = null;
    try { wet = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'waters.json'), 'utf8')); }
    catch (e) { wet = null; }
    yes('the water table has been built', !!wet && !!wet.waters);
    yes('and is installed in the gamemode', !!wetLine);

    if (wet) {
      yes('it found the classes Patrick named, including ice and shallow water',
          wet.byClass.ice > 0 && wet.byClass.puddle > 0 &&
          wet.byClass.lava > 0 && wet.byClass.marsh > 0);
      /*
        THE UNLIT FIRE OF THIS TABLE: a class that matched nothing would mean
        the rule is wrong rather than that Skyrim has no such water, and a
        class the gamemode has no number for is a silent zero.
      */
      const priced = Object.keys(NEEDS.water);
      const classes = Object.keys(wet.byClass);
      const unpriced = classes.filter(function (c) { return priced.indexOf(c) === -1; });
      yes('and the gamemode has a number for every class it produced' +
          (unpriced.length ? ' (missing ' + unpriced.join(', ') + ')' : ''),
          unpriced.length === 0);
    }

    // Two people in the same weather, one in a river and one in Frostreach.
    {
      const icy = Object.keys(WATERS.items).filter(function (d) { return WATERS.items[d] === 'ice'; })[0];
      const warm = Object.keys(WATERS.items).filter(function (d) { return WATERS.items[d] === 'still'; })[0];
      yes('the installed table has an icy place and a warm one', !!icy && !!warm);
      function swimIn(desc, place) {
        const api = rig();
        api.view(30);
        if (desc) { api.cellOf(30, desc); }
        api.place(30, place || 'water', '-', '0', '1', '0');
        api.minutes(60);
        return api.view(30).temp;
      }
      if (icy && warm) {
        yes('swimming in ice is colder than swimming in a warm indoor pool',
            swimIn(icy) < swimIn(warm));
        yes('and an unlisted lake is somewhere in between',
            swimIn('nowhere:X.esm') < swimIn(warm) && swimIn('nowhere:X.esm') > swimIn(icy));
      }
      // Wading is not swimming. Patrick asked for shallow by name.
      yes('wading is warmer than swimming',
          swimIn('nowhere:X.esm', 'shallow') > swimIn('nowhere:X.esm', 'water'));
      yes('the client has a word for wading',
          /wading = /.test(FRONT) && /kind = 'shallow'/.test(FRONT));
      // #2302: no guessed slack under the feet; placed water is read instead.
      yes('and the cell plane counts only above the feet (#2302)',
          !/FEET_SLACK/.test(FRONT) && /deep > 0 && deep < WADE_DEEP/.test(FRONT));
      yes('and the heartbeat names when placed water decided wading',
          /wading in placed water/.test(FRONT));
      // And the water class only ever applies to somebody in the water.
      {
        const icy2 = Object.keys(WATERS.items).filter(function (d) { return WATERS.items[d] === 'ice'; })[0];
        const api = rig();
        api.view(31);
        if (icy2) { api.cellOf(31, icy2); }
        api.place(31, 'indoors', '-', '0', '1', '0');
        api.minutes(60);
        yes('but standing beside icy water is not standing in it',
            api.view(31).temp === NEEDS.place.indoors);
      }
    }
  }

  // --------------------------------------------- fire spreading to people
  {
    yes('the client tells the server it is on fire',
        /tellServer\('\/burn 1'\)/.test(FRONT) && /tellServer\('\/burn 0'\)/.test(FRONT));
    yes('and the server answers that command', /word === '\/burn'/.test(src));
    yes('and there is a property to tell somebody else they caught it',
        /thornswoodBurn/.test(src) && /function burnScript/.test(src));
    yes('which the plugin picks up', /thornswoodCatchFire/.test(FRONT) &&
        /thornswoodCatchFire/.test(src));

    const api = rig();
    api.view(40); api.view(41); api.view(42);
    api.putAt(40, [0, 0, 0]);
    api.putAt(41, [100, 0, 0]);                 // next to them
    api.putAt(42, [5000, 0, 0]);                // across the field
    api.setBurning(40, true);
    api.burnTick();
    yes('somebody standing next to a burning person catches fire',
        api.caught(41).length === 1);
    yes('and somebody across the field does not', api.caught(42).length === 0);

    // A different cell is a different room, whatever the coordinates say.
    {
      const b = rig();
      b.view(50); b.view(51);
      b.putAt(50, [0, 0, 0]);
      b.putAt(51, [100, 0, 0]);
      b.cellOf(51, 'somewhere-else:X.esm');
      b.setBurning(50, true);
      b.burnTick();
      yes('but not through a wall into another cell', b.caught(51).length === 0);
    }

    // A client that stops reporting stops being a fire.
    {
      const c = rig();
      c.view(60); c.view(61);
      c.putAt(60, [0, 0, 0]);
      c.putAt(61, [100, 0, 0]);
      c.setBurning(60, true);
      c.minutes(1);
      c.burnTick();
      yes('a client that stops saying it is alight stops setting people alight',
          c.caught(61).length === 0);
    }
  }

  // ------------------------------------------------------- catching on fire
  {
    yes('standing IN a fire burns you', /damageActorValue\('Health'/.test(FRONT));
    yes('and you are visibly on fire while it happens',
        /EffectShader\.from/.test(FRONT) && /shader\.play\(/.test(FRONT));
  /*
    AND THEY STAY ON. Patrick, 23 September: "when I am on fire the fire on me
    goes away after awhile even if I am still in the fire but OI still
    correctly keep taking damage its just visibly wrong though". An effect
    shader runs for as long as the shader says, which is a few seconds,
    because it was written for a spell landing rather than for standing in a
    fire pit. It is played again on a clock now.
  */
  yes('the flames are put back on for as long as it burns',
      /BURN_FX_EVERY/.test(FRONT) &&
      /if \(!burnTold \|\| \(now - burnFxAt\) >= BURN_FX_EVERY\)/.test(FRONT));
  yes('and the clock resets when the fire goes out, so the next one lights at once',
      /burnFxAt = 0;/.test(FRONT));
    yes('it stops when you step out', /shader\.stop\(/.test(FRONT));
    const inside = /const FIRE_INSIDE = (\d+)/.exec(FRONT);
    const reach = /const FIRE_REACH = (\d+)/.exec(FRONT);
    yes('being near a fire is not the same as being in one',
        !!inside && !!reach && Number(inside[1]) < Number(reach[1]));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
