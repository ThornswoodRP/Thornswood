// test-churn.js
//
// The butter churn is the farmer's, and nothing about it touches any other
// press in the world.
//
// To Do List entry 94. Patrick, 21 September: "give milk and butter to farmers
// and make mammoth cheese bowls able to be picked up by literally anybody."
// BYOHButterChurn is a FLOR somebody presses E on. The food rule took it off
// the gatherer that day and gave it to nobody, so a press on it fell out of
// onActivate untouched and the engine handed Butter to whoever pressed it,
// while Butter was 46 of the Cook's inputs with no class supplying any.
//
// What this proves, against the real text of game/gamemode.js:
//   - churn() gives a farmer one Butter, the record the Cook's recipes ask for,
//     counts the work under the farm verb, and starts that farmer's own wait;
//   - everybody else is told whose work it is and gets nothing, and so is a
//     farmer inside the wait;
//   - churn() answers null for every base that is not a churn, '__proto__'
//     included, so it can never answer a press meant for something else;
//   - the real onActivate, with the real churn() in it, hands the churn press
//     to churn() and leaves a door, a living cow and the mammoth cheese bowl
//     exactly as they were: undefined, which lets the engine go ahead. A
//     non-null answer there would block that press for everybody.
//   - nothing is put back for any press (#3080). The fork's client blocks
//     activation on a FLOR now, so a press never empties the churn on the
//     presser's machine and there is nothing to undo; the churn is never
//     shown spent either (showsPick, test-3080-flora-blocked.js).
//   - the churn and the cheese are in none of the generated tables, so the
//     branch order cannot hand either one to another class.
//   - the note over CHURNS says what holds milk the way the entry does: a goat
//     and a rank are Patrick's to say, the cooldown is already settled, and
//     one press on a living cow on dev, read off the console line the fork's
//     activationService prints, decides whether the entry's plan works.
//
// Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
// A byte order mark, spelled out so no invisible character sits in this file.
const BOM = new RegExp('^' + String.fromCharCode(0xFEFF));
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* A top level function out of the gamemode, braces balanced. */
function liftFn(name) {
  const a = src.indexOf('\nfunction ' + name + '(');
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(a + 1, i + 1); } }
  }
  return null;
}

/* The function mp.onActivate is given, braces balanced. */
function liftHandler() {
  const head = "mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {";
  const a = src.indexOf(head);
  if (a < 0) { return null; }
  const f = a + head.indexOf('function');
  const open = src.indexOf('{', f);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(f, i + 1); } }
  }
  return null;
}

/* A one line top level const, up to its semicolon and not the comment after. */
function constLine(name) {
  const m = new RegExp('^const ' + name + ' = [^;\\n]*;', 'm').exec(src);
  return m ? m[0] : null;
}

/*
  The cooldown block, from COOLDOWN_MS to the end of stampCooldown, the same
  slice test-cooldown-sweep.js takes. stampCooldown sweeps lastUse through
  lastUseSweepAt and forgetOldUses, so lifting it on its own is a function
  that throws on its first stamp.
*/
function coolBlock() {
  const a = src.indexOf('\nconst COOLDOWN_MS = ');
  const s = liftFn('stampCooldown');
  if (a < 0 || !s) { return null; }
  const b = src.indexOf(s, a);
  return b < 0 ? null : src.slice(a + 1, b + s.length);
}

const CHURN_BASE = 'bc0:HearthFires.esm';
const BUTTER = '353c:HearthFires.esm';
const CHEESE_BASE = '7edf0:Skyrim.esm';

const itemsLine = constLine('ITEMS');
let ITEMS = {};
try { ITEMS = JSON.parse(/^const ITEMS = (\{.*\});$/.exec(itemsLine)[1]); } catch (e) { ITEMS = {}; }
yes('ITEMS carries the Butter the churn gives, 353c:HearthFires.esm', ITEMS.butter === BUTTER);

const parts = {
  churnsLine: constLine('CHURNS'),
  waitLine: constLine('HARVEST_COOLDOWN_MS'),
  coolBlock: coolBlock(),
  isChurn: liftFn('isChurn'),
  churn: liftFn('churn'),
  waitWord: liftFn('waitWord'),
  handler: liftHandler(),
  // The owners of a plant no table names (#3141), the real lists and the real
  // two functions, so the cheese is seen going to the engine through them.
  ownerLists: (function () {
    const a = src.indexOf('\nvar WORLD_PRODUCE_ANYBODY = {');
    const b = src.indexOf('\nvar unownedProduceSeen = {};');
    return (a < 0 || b < 0) ? null : src.slice(a + 1, b + '\nvar unownedProduceSeen = {};'.length);
  })(),
  isWorldProduce: liftFn('isWorldProduce'),
  worldProduce: liftFn('worldProduce')
};
yes('churn() is in the gamemode', !!parts.churn);
yes('and isChurn() and CHURNS beside it', !!parts.isChurn && !!parts.churnsLine);
/*
  The plants' ten minutes and not a wait of its own. longestWaitMs has to read
  every wait a cooldown is checked against or the sweep drops rows that are
  still waiting, and test-cooldown-sweep.js fails on one it does not read.
*/
yes('the churn waits HARVEST_COOLDOWN_MS, a wait longestWaitMs already reads',
    !!parts.churn && /cooldownLeft\(actorId, refrId, HARVEST_COOLDOWN_MS\)/.test(parts.churn) &&
    !!parts.waitLine);
yes('the real cooldown block and wait sentence are where they were',
    !!parts.coolBlock && !!parts.waitWord);
yes('the activate handler is in the gamemode', !!parts.handler);
yes('and the owner lists and both owner functions of #3141 beside it',
    !!parts.ownerLists && !!parts.isWorldProduce && !!parts.worldProduce);

const FARMER = 0x14a, GATHERER = 0x14b, NOCLASS = 0x14c, FARMER2 = 0x14d;
const FARM_NO = 'Only a farmer can bring a crop in. Ask one.';
const NO_CLASS = 'You have not chosen a class yet. Press K and choose one.';

/*
  One world: the real churn(), isChurn(), cooldownLeft(), stampCooldown(),
  waitWord() and onActivate handler, with everything they call that is not
  about the churn standing in as a recorder. Every other branch of the chain
  says which one it was, so a press is seen landing where it lands.
*/
function world(opts) {
  const o = opts || {};
  const clock = { now: 1700000000000 };
  const rec = { gates: [], given: [], credited: [], putBack: [], told: [], branch: [] };
  const bases = o.bases || {};
  const actors = o.actors || {};
  const classGate = function (actorId, verb) {
    rec.gates.push(verb);
    if (actorId === FARMER || actorId === FARMER2) { return null; }
    if (actorId === NOCLASS) { return NO_CLASS; }
    return FARM_NO;
  };
  const addItem = function (actorId, desc, n) {
    if (o.unloadable) { return false; }
    rec.given.push({ actorId: actorId, desc: desc, n: n });
    return true;
  };
  const creditWork = function (actorId, key) { rec.credited.push(key); return o.rankLine || null; };
  const putBack = function (actorId, refrId) { rec.putBack.push({ actorId: actorId, refrId: refrId }); };
  const mp = {
    get: function (id, key) {
      if (key === 'baseDesc') {
        if (!Object.prototype.hasOwnProperty.call(bases, id)) { throw new Error('no such reference'); }
        return bases[id];
      }
      if (key === 'type') { return actors[id] ? 'MpActor' : 'MpObjectReference'; }
      if (key === 'isDead') { return !!(actors[id] && actors[id].dead); }
      return null;
    },
    getDescFromId: function () { return null; }
  };
  const tag = function (name) {
    return function () { rec.branch.push(name); return 'answered by ' + name; };
  };
  const never = function () { return false; };
  // loot() in the gamemode reads the reference and falls through for anything
  // that is not a dead actor. This stands in for that, and says when it was
  // asked, because a churn press reaching it is the fault being fixed.
  const loot = function (actorId, refrId) {
    rec.branch.push('loot');
    const a = actors[refrId];
    if (!a || !a.dead) { return null; }
    return 'You take 1 Cow Hide off the Cow.';
  };
  const names = ['classGate', 'addItem', 'creditWork', 'putBack', 'Date', 'benchGate',
    'notify', 'say', 'globalThis', 'mp', 'kindIsContainer', 'STATIONS', 'mineSalt',
    'burnCharcoal', 'isChoppingBlock', 'chopWood', 'SHRINES', 'bless', 'isCrop',
    'farmActivate', 'isFish', 'fish', 'isGame', 'game', 'isChickenNest', 'collectEgg',
    'isPlant', 'harvest', 'ALLOW',
    'isVein', 'mineOre', 'loot', 'milk', 'log', 'ITEMS', 'floraHanded', 'isHive', 'hive'];
  const body = "'use strict';\n" + 'function economyGathered() { }\n' +
    [parts.coolBlock, parts.waitLine, parts.churnsLine,
     parts.waitWord, parts.isChurn, parts.churn,
     parts.ownerLists, parts.isWorldProduce, parts.worldProduce].filter(Boolean).join('\n') + '\n' +
    'const onActivate = ' + (parts.handler || 'null') + ';\n' +
    'return { churn: typeof churn === "function" ? churn : null,\n' +
    '         isChurn: typeof isChurn === "function" ? isChurn : null,\n' +
    '         onActivate: onActivate };';
  let api = null;
  try {
    api = new Function(names.join(','), body).apply(null, [
      classGate, addItem, creditWork, putBack, { now: function () { return clock.now; } },
      function () { return null; },
      function (id, text) { rec.told.push(text); },
      function () { },
      {},
      mp, never, { saltQuarry: 'quarry:Test.esp', charcoalKiln: 'kiln:Test.esp' },
      tag('mineSalt'), tag('burnCharcoal'), function (d) { return d === 'block:Test.esp'; },
      tag('chopWood'), {}, tag('bless'),
      function (d) { return d === 'cabbage:Test.esp'; }, tag('farmActivate'),
      never, tag('fish'), never, tag('game'),
      never, function () { return null; },
      function (d) { return d === 'flower:Test.esp'; }, tag('harvest'),
      { thornswoodAllow: true }, never, tag('mineOre'), loot, function () { return null; }, function () { }, ITEMS,
      function (message) {
        return typeof message === 'string' && /^(You pick |You take )/.test(message);
      },
      function () { return false; },
      function () { return null; }]);
  } catch (e) {
    console.log('      the world would not build: ' + e.message);
    api = null;
  }
  return { api: api, rec: rec, clock: clock };
}

// ---------------------------------------------------------------- churn() --
{
  const w = world();
  yes('the churn and the handler compile together', !!w.api && typeof w.api.onActivate === 'function');
  const churn = w.api && w.api.churn;
  if (churn) {
    const REF = 0x9001;

    const first = churn(FARMER, REF, CHURN_BASE);
    yes('a farmer at the churn is told they churned one Butter', first === 'You churn 1 Butter.');
    yes('and is handed exactly one of 353c:HearthFires.esm', w.rec.given.length === 1 &&
        w.rec.given[0].actorId === FARMER && w.rec.given[0].desc === BUTTER && w.rec.given[0].n === 1);
    yes('the gate asked was the farm verb', w.rec.gates.length === 1 && w.rec.gates[0] === 'farm');
    yes('and the work is counted under the farm verb', w.rec.credited.join() === 'farm');

    w.clock.now += 60000;
    const again = churn(FARMER, REF, CHURN_BASE);
    yes('the same farmer a minute later is told how long is left, in minutes',
        again === 'You have worked this churn for now. 9 minutes to go.');
    yes('and gets nothing', w.rec.given.length === 1);

    const other = churn(FARMER2, REF, CHURN_BASE);
    yes('a second farmer is not held by the first one\'s wait', other === 'You churn 1 Butter.' &&
        w.rec.given.length === 2 && w.rec.given[1].actorId === FARMER2);

    w.clock.now += 9 * 60000;
    yes('ten minutes after the first press the first farmer churns again',
        churn(FARMER, REF, CHURN_BASE) === 'You churn 1 Butter.' && w.rec.given.length === 3);

    const b0 = w.rec.given.length;
    const g = churn(GATHERER, REF, CHURN_BASE);
    yes('a gatherer is told whose work it is', g === FARM_NO);
    yes('and gets nothing', w.rec.given.length === b0);
    const n = churn(NOCLASS, REF, CHURN_BASE);
    yes('somebody with no class yet is told to choose one and gets nothing',
        n === NO_CLASS && w.rec.given.length === b0);
    yes('churn() on its own puts nothing back; the branch in onActivate does that',
        w.rec.putBack.length === 0);

    const c0 = w.rec.credited.length;
    const before = { g: w.rec.gates.length, p: w.rec.putBack.length, i: w.rec.given.length };
    const notChurn = [CHEESE_BASE, 'cabbage:Test.esp', 'door:Skyrim.esm', '__proto__',
                      'constructor', 'toString', 'hasOwnProperty', '', undefined, null];
    let quiet = true;
    for (const d of notChurn) { if (churn(FARMER, REF, d) !== null) { quiet = false; } }
    yes('churn() answers null for every base that is not a churn, __proto__ and toString included', quiet);
    yes('and asks nothing, gives nothing, puts nothing back and counts nothing for them',
        w.rec.gates.length === before.g && w.rec.putBack.length === before.p &&
        w.rec.given.length === before.i && w.rec.credited.length === c0);
    yes('isChurn is true for the churn and false for the cheese and __proto__',
        w.api.isChurn(CHURN_BASE) === true && w.api.isChurn(CHEESE_BASE) === false &&
        w.api.isChurn('__proto__') === false);
  }
}

{
  const w = world({ rankLine: 'You are now an Advanced Farmer.' });
  const churn = w.api && w.api.churn;
  yes('a new rank from the work is said after the Butter',
      !!churn && churn(FARMER, 0x9002, CHURN_BASE) === 'You churn 1 Butter. You are now an Advanced Farmer.');
}

{
  const bases = {};
  bases[0x9003] = CHURN_BASE;
  const w = world({ unloadable: true, bases: bases });
  const on = w.api && w.api.onActivate;
  if (on) {
    const r = on(0x9003, FARMER);
    const said = w.rec.told[w.rec.told.length - 1];
    yes('with HearthFires missing from the load order the farmer is told so, not given a wait',
        r === false && /nothing in this load order/.test(said || '') && /dev channel/.test(said || ''));
    yes('nothing is put back and nothing is counted',
        w.rec.putBack.length === 0 && w.rec.credited.length === 0);
    on(0x9003, FARMER);
    yes('and no wait was started by it',
        /nothing in this load order/.test(w.rec.told[w.rec.told.length - 1] || ''));
  } else {
    yes('with HearthFires missing from the load order the farmer is told so', false);
  }
}

// ------------------------------------------------------------- onActivate --
{
  const CHURN_REF = 0x5001, DOOR = 0x5002, COW = 0x5003, CHEESE = 0x5004,
        DEAD_COW = 0x5005, FLOWER = 0x5006;
  const bases = {};
  bases[CHURN_REF] = CHURN_BASE;
  bases[DOOR] = 'door:Skyrim.esm';
  bases[COW] = 'cow:Skyrim.esm';
  bases[CHEESE] = CHEESE_BASE;
  bases[DEAD_COW] = 'cow:Skyrim.esm';
  bases[FLOWER] = 'flower:Test.esp';
  const actors = {};
  actors[COW] = { dead: false };
  actors[DEAD_COW] = { dead: true };

  const w = world({ bases: bases, actors: actors });
  const on = w.api && w.api.onActivate;
  if (on) {
    const r = on(CHURN_REF, FARMER);
    yes('a farmer pressing the churn is answered by the server, which blocks the engine\'s own handover',
        r === false);
    yes('and it was churn() that answered, not the plants and not loot()',
        w.rec.branch.length === 0 && w.rec.given.length === 1 && w.rec.given[0].desc === BUTTER);
    yes('and the farmer is told what they got', w.rec.told.indexOf('You churn 1 Butter.') !== -1);
    yes('and the churn is not put back: the press never emptied it (#3080)',
        w.rec.putBack.length === 0);

    const told0 = w.rec.told.length;
    const r2 = on(CHURN_REF, GATHERER);
    yes('a gatherer pressing the churn is refused and the engine does not hand it over either',
        r2 === false && w.rec.given.length === 1);
    yes('they are told the farm verb\'s sentence', w.rec.told[told0] === FARM_NO);
    yes('and nothing is put back for their press', w.rec.putBack.length === 0);

    w.clock.now += 60000;
    const r3 = on(CHURN_REF, FARMER);
    yes('the farmer pressing again inside the wait is told so and given nothing',
        r3 === false && w.rec.given.length === 1 &&
        /^You have worked this churn for now\. /.test(w.rec.told[w.rec.told.length - 1] || '') &&
        w.rec.putBack.length === 0);

    // Everybody else's presses, with the churn branch in the chain.
    const gates0 = w.rec.gates.length, put0 = w.rec.putBack.length, told1 = w.rec.told.length;
    const who = [FARMER, GATHERER, NOCLASS];
    let open = true;
    for (const a of who) {
      for (const ref of [DOOR, COW, CHEESE]) {
        if (on(ref, a) !== undefined) { open = false; }
      }
    }
    yes('a door, a living cow and the mammoth cheese still answer undefined for a farmer, a gatherer ' +
        'and somebody with no class, so the engine goes ahead for all of them', open);
    yes('nothing was said, gated or put back for any of those presses',
        w.rec.gates.length === gates0 && w.rec.putBack.length === put0 && w.rec.told.length === told1);
    yes('a farmer pressing a living cow whose base is not a milk cow is still nothing',
        on(COW, FARMER) === undefined);
    const dead = on(DEAD_COW, 0x14e);
    yes('a dead cow still goes to loot() and the hunter, unchanged', dead === false &&
        w.rec.told[w.rec.told.length - 1] === 'You take 1 Cow Hide off the Cow.');
    const put1 = w.rec.putBack.length;
    yes('a flower still goes to harvest()', on(FLOWER, GATHERER) === false &&
        w.rec.branch[w.rec.branch.length - 1] === 'harvest');
    yes('and a refused flower is not put back either', w.rec.putBack.length === put1);
    yes('a press with nobody behind it is dropped before anything is asked',
        on(CHURN_REF, 0) === undefined);
  }
}

// ------------------------------------------------------------- the tables --
{
  let h = null;
  try { h = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'data', 'harvests.json'), 'utf8').replace(BOM, '')); }
  catch (e) { h = null; }
  yes('harvests.json is readable', !!h);
  if (h) {
    const row = h.unranked && h.unranked[CHURN_BASE];
    yes('harvests.json leaves BYOHButterChurn, ' + CHURN_BASE + ', out of the plant table with Butter as its produce',
        !!row && row.editorId === 'BYOHButterChurn' && row.produce === BUTTER);
    yes('which is the churn churn() answers and the Butter it hands over',
        !!row && constLine('CHURNS') !== null && constLine('CHURNS').indexOf("'" + CHURN_BASE + "'") !== -1 &&
        ITEMS.butter === row.produce);
    const cheese = h.unranked && h.unranked[CHEESE_BASE];
    yes('and the mammoth cheese bowl is left out beside it', !!cheese && cheese.editorId === 'MammothCheese01');
    let inTable = false;
    for (const m of ['harvests', 'crops', 'fish', 'game']) {
      if (h[m] && (Object.prototype.hasOwnProperty.call(h[m], CHURN_BASE) ||
                   Object.prototype.hasOwnProperty.call(h[m], CHEESE_BASE))) { inTable = true; }
    }
    yes('neither is in the plant, crop, fish or game map', !inTable);
  }
  // The generated blocks in the gamemode write descriptors in double quotes.
  yes('neither base is in any generated table in the gamemode, so no class branch can take either',
      src.indexOf('"' + CHURN_BASE + '"') === -1 && src.indexOf('"' + CHEESE_BASE + '"') === -1);
  yes('and the cheese is in no hand table but WORLD_PRODUCE_ANYBODY, which hands it to the engine for anybody (#3141)',
      !!parts.ownerLists && parts.ownerLists.indexOf("'" + CHEESE_BASE + "'") !== -1 &&
      src.split("'" + CHEESE_BASE + "'").length === 2);

  let r = null;
  try { r = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'data', 'recipes.json'), 'utf8').replace(BOM, '')); }
  catch (e) { r = null; }
  if (r && r.recipes) {
    let want = 0, other = 0;
    for (const k in r.recipes) {
      const ins = r.recipes[k].inputItems || [];
      for (const it of ins) {
        if (it.name !== 'Butter') { continue; }
        if (it.item === BUTTER) { want++; } else { other++; }
      }
    }
    yes('every recipe input called Butter is the record the churn gives (' + want + ' of them)',
        want > 0 && other === 0);
  } else {
    yes('recipes.json is readable', false);
  }
}

// ------------------------------------------------------------- the words --
{
  const said = [];
  const w = world();
  const churn = w.api && w.api.churn;
  if (churn) {
    said.push(churn(FARMER, 0x9100, CHURN_BASE));
    said.push(churn(FARMER, 0x9100, CHURN_BASE));
    const u = world({ unloadable: true });
    said.push(u.api.churn(FARMER, 0x9101, CHURN_BASE));
  }
  const bad = said.filter(function (s) {
    return typeof s !== 'string' || /player/i.test(s) || s.indexOf(String.fromCharCode(0x2014)) !== -1;
  });
  yes('every sentence churn() says of its own is plain words: no "player", no em dash', said.length === 3 && bad.length === 0);
}

// -------------------------------------------------------------- the milk --
/*
  What holds milk, said the way the entry says it. The entry already puts milk
  on a cooldown, and Patrick's open step asks whether a goat should give milk
  too and whether milking should have a rank. The first version of the note
  over CHURNS said "whether milking waits" was his to say, which sends the next
  person to ask him a question the entry has answered and leaves out the one it
  has not. A reviewer caught it on 24 September.

  The note also names the one press that decides whether the entry's plan
  works, and the console line to read it off. The fork is read where it is, the
  way test-audit-handlers.js does, so the line the note sends people to look for
  is the line the client prints. Anywhere without the fork that half says SKIP.
*/
{
  const a = src.indexOf("THE BUTTER CHURN IS THE FARMER'S.");
  const b = a < 0 ? -1 : src.indexOf('*/', a);
  const note = (a < 0 || b < 0) ? '' : src.slice(a, b).replace(/\s+/g, ' ');
  yes('the note over CHURNS is in the gamemode', note.length > 0);
  yes('the note says milk is beside loot for living cows',
      /MILK IS BESIDE loot/.test(note) && /living cow/.test(note));
  yes('and still leaves Patrick goats and a rank',
      /Goats and a milking rank are still Patrick/.test(note));
  yes('it names the console line a press on a living cow on dev is read for',
      note.indexOf('"Sent activation for caster="') !== -1);

  const FORK = process.env.SKYMP || path.join(__dirname, '..', '..', 'engine', 'skymp');
  const svc = path.join(FORK, 'skymp5-client', 'src', 'services', 'services', 'activationService.ts');
  const ref = path.join(FORK, 'skymp5-client', 'src', 'extensions', 'objectReferenceEx.ts');
  let svcText = null, refText = null;
  try { svcText = fs.readFileSync(svc, 'utf8'); } catch (e) { svcText = null; }
  try { refText = fs.readFileSync(ref, 'utf8'); } catch (e) { refText = null; }
  if (svcText === null || refText === null) {
    console.log('SKIP  the fork is not at ' + FORK + ', so the console line and the NPC block were not read in it');
  } else {
    yes('the fork\'s activationService still prints "Sent activation for caster=" for every press it sends',
        svcText.indexOf('`Sent activation for caster=`') !== -1);
    yes('and objectReferenceEx still blocks activation on an NPC, so the server owns a press on a cow',
        // The whole condition up to its opening brace, however many kinds it
        // names (#3080 added plants, trees, benches and doors to it), then
        // the block itself as the first thing inside.
        /t === FormType\.NPC[^{}]*\)\s*\{\s*self\.blockActivation\(true\)/.test(refText));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
