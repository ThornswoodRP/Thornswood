// test-1383-injury.js
//
// #1383. Wounds and disease on the character: the five diseases with the
// chances and clocks of docs/systems/disease.md, the cuts, bites, breaks and
// burns of docs/systems/injury.md with their bleed, fever, crooked heal and
// half warmth, the cures (a potion of cure disease, the temple shrine, rest
// and warmth for a chill, the healing spells by rank), the costs the needs
// block now reads, the bench refused while a disease is bad or an arm is
// broken, the wound kept through a death, and /hurt for staff.
//
// It drives the REAL injury and disease block and the REAL needs block out of
// gamemode.js over one fake mp and one fake clock, the way test-temp.js does.
// The dice are the test's: Math.random answers what the case needs.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const FRONT = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');
const FOOD = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'food.json'), 'utf8'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i);
  return (i >= 0 && j >= 0) ? src.slice(i, j + b.length) : null;
}

const NEEDS_SRC = slice('// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const HURT_SRC = slice('// ==== thornswood injury and disease ====', '// ==== end thornswood injury and disease ====');
const PROG_SRC = slice('// ==== thornswood progression ====', '// ==== end thornswood progression ====');
yes('the needs, injury and progression blocks are in the gamemode', !!NEEDS_SRC && !!HURT_SRC && !!PROG_SRC);

// From its file when the gamemode reads it from one (#5191), else its line.
function table(name) { return require('./gamemode-tables.js').inGamemode(src, name) || { items: {} }; }
const WARMTH = table('WARMTH');
const WEATHER = table('WEATHER');
const WATERS = table('WATERS');
const benchLine = /^const BENCH_BY_BASE = (\{.*\});$/m.exec(src);
const BENCH_BY_BASE = benchLine ? JSON.parse(benchLine[1]) : {};

// The progression block, run on its own, for spellByDesc, perks and TUNING.
const progBox = {};
if (PROG_SRC) {
  new Function('globalThis', 'console', PROG_SRC)(progBox, { log: function () { } });
}
const P = progBox.__thornswoodProgression;
yes('the progression rules load', !!P && !!P.spellByDesc && !!P.perks);

const TEMPLE_CELL = '165a7:Skyrim.esm';

/*
  The rig: one store of properties per actor, one clock, the dice, and what
  DamageActorValue was asked. Every descriptor resolves to its own number.
*/
function rig() {
  const G = {};
  const props = {};
  const extra = {};
  const said = [];
  const damage = [];
  const clock = { now: 1700000000000 };
  const dice = { next: [] };
  const timers = [];
  const ids = {};
  let nextId = 0x10;
  function idOf(desc) { if (!ids[desc]) { ids[desc] = nextId++; } return ids[desc]; }
  const M = Object.create(Math);
  M.random = function () { return dice.next.length ? dice.next.shift() : 0.999; };
  const made = {};
  const mp = {
    makeProperty: function (name, opts) { made[name] = opts; },
    getDescFromId: function (id) { return 'ff' + id.toString(16) + ':Runtime'; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(extra).map(Number); }
      const e = extra[id] || {};
      if (key === 'profileId') { return e.pid || 0; }
      if (key === 'isDead') { return !!e.dead; }
      if (key === 'worldOrCellDesc') { return e.cell || '3c:Skyrim.esm'; }
      if (key === 'baseDesc') { return e.base || ''; }
      if (key === 'inventory') { return { entries: e.worn || [] }; }
      if (key === 'equipment') { return { inv: { entries: e.worn || [] } }; }
      if (key === 'pos') { return [0, 0, 0]; }
      return props[id] ? props[id][key] : undefined;
    },
    set: function (id, key, v) {
      if (!props[id]) { props[id] = {}; }
      props[id][key] = JSON.parse(JSON.stringify(v));
    },
    callPapyrusFunction: function (kind, cls, fn, self, args) { damage.push({ fn: fn, self: self, args: args }); }
  };
  const D = { now: function () { return clock.now; } };
  const common = ['globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
                  'guard', 'notify', 'say', 'Math', 'idOf'];
  const vals = [G, mp, D, { log: function () { } },
                function (f, ms) { timers.push({ f: f, ms: ms }); return 0; }, function () { },
                function (n, f) { return f; },
                function (id, line) { said.push({ id: id, line: line }); }, function () { },
                M, idOf];
  new Function(common.concat(['WARMTH', 'WEATHER', 'WATERS']).join(','), NEEDS_SRC)
    .apply(null, vals.concat([WARMTH, WEATHER, WATERS]));
  new Function(common.concat(['BENCH_BY_BASE']).join(','), HURT_SRC)
    .apply(null, vals.concat([BENCH_BY_BASE]));
  const state = {};
  G.__thornswoodProgression = P;
  G.__thornswoodCharacter = {
    stateOf: function (id) { return state[id] || P.fresh(); },
    writeState: function (id) { (extra[id] = extra[id] || {}).redrawn = (extra[id].redrawn || 0) + 1; }
  };
  G.__thornswoodStuck = { TEMPLES: [{ key: 'whiterun', desc: TEMPLE_CELL }] };
  // The perks block's answer, the way it reads it: the perks over the tree.
  G.__thornswoodPerks = { holds: function (id, key) { return P.perks(state[id] || P.fresh()).indexOf(key) !== -1; } };
  return {
    G: G, mp: mp, made: made, H: G.__thornswoodHurt, N: G.__thornswoodNeeds, clock: clock, dice: dice,
    said: said, damage: damage, state: state, idOf: idOf, timers: timers,
    person: function (id, pid) { extra[id] = extra[id] || {}; extra[id].pid = pid || id; return id; },
    set: function (id, k, v) { extra[id] = extra[id] || {}; extra[id][k] = v; },
    redrawn: function (id) { return (extra[id] || {}).redrawn || 0; },
    minutes: function (m) { clock.now += m * 60000; },
    rec: function (id) { return G.__thornswoodHurt.read(id); },
    needs: function (id, n) {
      const base = G.__thornswoodNeeds.fresh();
      base.at = clock.now;
      for (const k in n) { base[k] = n[k]; }
      mp.set(id, 'thornswoodNeeds', base);
    },
    tick: function () { G.__thornswoodHurt.tick(); },
    lines: function (id) { return said.filter(function (s) { return s.id === id; }).map(function (s) { return s.line; }); }
  };
}

function ill(r, id, k) {
  const rec = r.rec(id);
  for (let i = 0; i < rec.ills.length; i++) { if (rec.ills[i].k === k) { return rec.ills[i]; } }
  return null;
}
function woundOf(r, id, k) {
  const rec = r.rec(id);
  for (let i = 0; i < rec.wounds.length; i++) { if (rec.wounds[i].k === k) { return rec.wounds[i]; } }
  return null;
}

if (NEEDS_SRC && HURT_SRC && P) {
  // ------------------------------------------------------- the numbers
  {
    const r = rig();
    const H = r.H;
    yes('a cut bleeds 2 a second and torn cloth slows it to 1', H.HURT.bleed.open === 2 && H.HURT.bleed.cloth === 1);
    yes('wound fever is 40% open, 10% bandaged and 5% with a poultice, rolled at 10 minutes',
      H.HURT.fever.open === 0.40 && H.HURT.fever.bandage === 0.10 && H.HURT.fever.poultice === 0.05 && H.HURT.feverAfter === 10);
    yes('bite sickness is 25% closed and 60% open', H.HURT.bite.closed === 0.25 && H.HURT.bite.open === 0.60);
    yes('a break heals in 3 days and a crooked one costs 4 speed or 0.05 melee',
      H.HURT.breakDays === 3 && H.HURT.crooked.leg.speedMult === -4 && H.HURT.crooked.arm.attackDamageMult === -0.05);
    yes('a broken arm is -0.15 melee and a broken leg -8 speed',
      H.HURT.broken.arm.attackDamageMult === -0.15 && H.HURT.broken.leg.speedMult === -8);
    yes('a bad burn is 30 dealt, half warmth, and a day to heal',
      H.HURT.burn.bad === 30 && H.HURT.burn.warmth === 0.5 && H.HURT.burn.healDays === 1);
    const fb = /const BURN_PER_SECOND = (\d+);/.exec(FRONT);
    yes('the server times a fire at the client\'s own BURN_PER_SECOND', !!fb && Number(fb[1]) === H.HURT.burn.perSecond);
    yes('a missing eye is -20% with a bow and with a destruction spell',
      H.HURT.eye.MarksmanPowerMod === -20 && H.HURT.eye.DestructionPowerMod === -20);
    yes('caught is 10 minutes and bad another 20', H.CAUGHT_MIN === 10 && H.BAD_AFTER_MIN === 20);
    yes('a chill is 2 hours, food sickness 30 minutes and fouled water 45, and fever and bite last until cured',
      H.DISEASE.chill.lasts === 120 && H.DISEASE.food.lasts === 30 && H.DISEASE.fouled.lasts === 45 &&
      H.DISEASE.fever.lasts === 0 && H.DISEASE.bite.lasts === 0);
    yes('only wound fever and bite sickness turn bad',
      H.DISEASE.fever.bad && H.DISEASE.bite.bad && !H.DISEASE.chill.bad && !H.DISEASE.food.bad && !H.DISEASE.fouled.bad);
    yes('raw meat 40%, a full stomach always, marsh 80%, the sea 40%, a river 15%',
      H.EXPOSED.food.raw === 0.40 && H.EXPOSED.food.full === 1 && H.EXPOSED.fouled.marsh === 0.80 &&
      H.EXPOSED.fouled.sea === 0.40 && H.EXPOSED.fouled.river === 0.15);
    const cure = Object.keys(FOOD.items).filter(function (k) { return /^CureDisease$/i.test(FOOD.items[k].edid || ''); });
    yes('the potion of cure disease is the CureDisease record food.json names (' + cure.join(', ') + ')',
      cure.length === 1 && H.CURE_DISEASE.length === 1 && H.CURE_DISEASE[0] === cure[0]);
    const book = P.SPELLS.restoration;
    const known = [].concat(book.novice, book.advanced, book.expert, book.master);
    yes('every healing spell is one the College book teaches, so it has a rank',
      Object.keys(H.HEALING).every(function (n) { return known.indexOf(n) !== -1 && !!P.SPELL_IDS[n]; }));
    const kws = {};
    Object.keys(BENCH_BY_BASE).forEach(function (b) { kws[BENCH_BY_BASE[b]] = true; });
    yes('every two-handed bench is a bench keyword the server can see',
      Object.keys(H.TWO_HANDS).every(function (k) { return kws[k]; }));
    yes('the cookpot, the alchemy lab and the enchanter are not two-handed',
      !H.TWO_HANDS['a5cb3:Skyrim.esm'] && !H.TWO_HANDS.alchemy && !H.TWO_HANDS.enchanting);
  }

  // --------------------------------------------------- the disease clock
  {
    const r = rig();
    const me = r.person(0x20);
    r.H.staff(me, ['fever'], 'staff');
    yes('a fever given is caught and does not show for 10 minutes',
      r.H.stageOf(ill(r, me, 'fever'), r.clock.now) === 'caught' && r.rec(me).show.length === 0);
    r.minutes(10); r.tick();
    yes('at 10 minutes it is ill and says so once', r.H.stageOf(ill(r, me, 'fever'), r.clock.now) === 'ill' &&
      r.lines(me).filter(function (l) { return /Wound fever\./.test(l); }).length === 1);
    yes('and the screen shows it', r.rec(me).show.indexOf('Wound fever') !== -1);
    yes('and the character panel was asked to redraw', r.redrawn(me) > 0);
    r.tick();
    yes('a second tick does not say it again', r.lines(me).filter(function (l) { return /Wound fever\./.test(l); }).length === 1);
    r.minutes(19); r.tick();
    yes('at 29 minutes it is still only ill', r.H.stageOf(ill(r, me, 'fever'), r.clock.now) === 'ill');
    r.minutes(1); r.tick();
    yes('at 30 minutes untreated it is bad', r.H.stageOf(ill(r, me, 'fever'), r.clock.now) === 'bad' &&
      r.rec(me).show.indexOf('Wound fever, bad') !== -1);
    r.minutes(600); r.tick();
    yes('waiting does not clear a bad fever', !!ill(r, me, 'fever'));

    const two = r.person(0x21);
    r.H.staff(two, ['food'], 'staff');
    r.minutes(10); r.tick();
    yes('food sickness shows at 10 minutes', !!ill(r, two, 'food') && r.rec(two).show.indexOf('Food sickness') !== -1);
    r.minutes(29); r.tick();
    yes('and is still there 29 minutes after it showed', !!ill(r, two, 'food'));
    r.minutes(1); r.tick();
    yes('and passes 30 minutes after it showed, and says so', !ill(r, two, 'food') &&
      r.lines(two).some(function (l) { return /food sickness has passed/.test(l); }));
    r.H.staff(two, ['fouled'], 'staff');
    r.minutes(10 + 44); r.tick();
    yes('fouled water is still there 44 minutes after it showed', !!ill(r, two, 'fouled'));
    r.minutes(1); r.tick();
    yes('and passes at 45', !ill(r, two, 'fouled'));
    r.H.staff(two, ['food'], 'staff');
    r.minutes(10 + 60); r.tick();
    yes('food sickness never turns bad', !ill(r, two, 'food') || r.H.stageOf(ill(r, two, 'food'), r.clock.now) !== 'bad');
  }

  // ------------------------------------------------------------ the cures
  {
    const r = rig();
    const me = r.person(0x30);
    const cureId = r.idOf('ae723:Skyrim.esm');
    r.H.staff(me, ['fever'], 'staff');
    r.minutes(3);
    const line = r.H.swallowed(me, cureId);
    yes('a potion of cure disease in the caught window clears it and it never shows', !ill(r, me, 'fever') && line === '');
    r.H.staff(me, ['fever'], 'staff');
    r.H.staff(me, ['chill'], 'staff');
    r.minutes(31); r.tick();
    const l2 = r.H.swallowed(me, cureId);
    yes('a potion clears one disease, the one furthest along', !ill(r, me, 'fever') && !!ill(r, me, 'chill') &&
      /wound fever is gone/.test(l2));
    yes('any other potion clears nothing', r.H.swallowed(me, r.idOf('10201e:Skyrim.esm')) === '' && !!ill(r, me, 'chill'));
    r.H.swallowed(me, cureId);
    yes('a second potion clears the next', r.rec(me).ills.length === 0);
    yes('a potion with nothing to cure says nothing', r.H.swallowed(me, cureId) === '');

    // The temple.
    r.H.staff(me, ['fever'], 'staff');
    r.H.staff(me, ['break', 'leg'], 'staff');
    r.set(me, 'cell', '3c:Skyrim.esm');
    yes('a shrine outside a temple is not the rite', r.H.rite(me) === '' && !!ill(r, me, 'fever'));
    r.set(me, 'cell', TEMPLE_CELL);
    const rite = r.H.rite(me);
    yes('a shrine in a temple clears the disease and sets the break', /sickness/.test(rite) && /break/.test(rite) &&
      !ill(r, me, 'fever') && woundOf(r, me, 'break').set > 0);
    r.H.staff(me, ['agreed', 'eye'], 'staff');
    r.H.rite(me);
    yes('the temple does not clear an agreed loss', !!r.rec(me).agreed.eye);
    r.minutes(3 * 24 * 60); r.tick();
    yes('a break the temple set heals in 3 days, straight', !woundOf(r, me, 'break') && !r.rec(me).crooked.leg &&
      r.lines(me).some(function (l) { return /leg has healed\./.test(l); }));
  }

  // ------------------------------------------------- resistance and chances
  {
    const r = rig();
    const me = r.person(0x40);
    yes('with no toughness the chance is the chance', Math.abs(r.H.chanceFor(me, 0.4) - 0.4) < 1e-9);
    r.state[me] = P.fresh(); r.state[me].tree = { toughness: 2 };
    yes('two points of Toughness take 20% off the chance', Math.abs(r.H.chanceFor(me, 0.4) - 0.32) < 1e-9);
    r.state[me].tree = { toughness: 5 };
    yes('Purified Blood: a filled Toughness means no disease takes', P.perks(r.state[me]).indexOf('purifiedblood') !== -1 &&
      r.H.chanceFor(me, 1) === 0 && r.H.exposed(me, 'food', 'full') === false);
    const two = r.person(0x41);
    r.dice.next = [0.39];
    yes('raw meat at a roll under 40% catches food sickness', r.H.exposed(two, 'food', 'raw') === true && !!ill(r, two, 'food'));
    r.dice.next = [0.0];
    yes('a disease already held is not caught twice', r.H.exposed(two, 'food', 'raw') === false && r.rec(two).ills.length === 1);
    r.dice.next = [0.79];
    yes('marsh water at 79 catches fouled water', r.H.exposed(two, 'fouled', 'marsh') === true);
    const three = r.person(0x42);
    r.dice.next = [0.16];
    yes('a river at 16 does not', r.H.exposed(three, 'fouled', 'river') === false);
    r.dice.next = [0.0];
    yes('an unknown source is no risk at all', r.H.exposed(three, 'fouled', 'boiled') === false && r.rec(three).ills.length === 0);
    r.dice.next = [0.999];
    yes('a full stomach always catches it', r.H.exposed(three, 'food', 'full') === true);
  }

  // ------------------------------------------------------------ the chill
  {
    const r = rig();
    const me = r.person(0x50);
    r.needs(me, { resting: 'sit', roof: false, place: 'outdoors', temp: 45, fire: -1 });
    r.tick(); r.minutes(59); r.tick();
    yes('59 minutes asleep on open ground does not catch a chill', !ill(r, me, 'chill'));
    r.minutes(1); r.tick();
    yes('an hour of it does', !!ill(r, me, 'chill'));
    const two = r.person(0x51);
    r.needs(two, { resting: 'sit', roof: true, place: 'outdoors', temp: 45, fire: -1 });
    r.tick(); r.minutes(70); r.tick();
    yes('an hour under a roof does not', !ill(r, two, 'chill'));
    const three = r.person(0x52);
    r.needs(three, { resting: 'sit', roof: false, place: 'indoors', temp: 50, fire: -1 });
    r.tick(); r.minutes(70); r.tick();
    yes('nor an hour indoors', !ill(r, three, 'chill'));
    const four = r.person(0x53);
    r.needs(four, { resting: '', roof: false, place: 'snow', temp: 5, fire: -1 });
    r.tick(); r.minutes(30); r.tick();
    r.needs(four, { resting: '', roof: false, place: 'snow', temp: 25, fire: -1 });
    r.tick(); r.minutes(40); r.tick();
    yes('half an hour at spent cold, then less cold, does not', !ill(r, four, 'chill'));
    r.needs(four, { resting: '', roof: false, place: 'snow', temp: 5, fire: -1 });
    r.tick(); r.minutes(60); r.tick();
    yes('an hour at spent cold does', !!ill(r, four, 'chill'));
    r.minutes(10); r.tick();
    yes('and it shows as Chilled', r.rec(four).show.indexOf('Chilled') !== -1);
    r.needs(four, { resting: '', roof: false, place: 'snow', temp: 5, fire: 120 });
    r.tick();
    yes('a fire clears it', !ill(r, four, 'chill') && r.lines(four).some(function (l) { return /fire shakes the chill/.test(l); }));

    // A bed, warmth back to fine, and 2 hours.
    r.H.staff(me, ['clear'], 'staff');
    r.H.staff(me, ['chill'], 'staff');
    r.needs(me, { resting: 'bed', roof: true, place: 'indoors', temp: 50, fire: -1 });
    r.minutes(1); r.tick();
    yes('a bed clears a chill, and in its caught window it never showed', !ill(r, me, 'chill') &&
      !r.lines(me).some(function (l) { return /bed shakes/.test(l); }));
    r.H.staff(me, ['chill'], 'staff');
    r.minutes(12); r.tick();
    r.needs(me, { resting: 'rough', roof: false, place: 'outdoors', temp: 50, fire: -1 });
    r.tick();
    yes('so does a bedroll nobody lends you, the ladder\'s rough', !ill(r, me, 'chill') &&
      r.lines(me).some(function (l) { return /bed shakes/.test(l); }));
    const seat = r.person(0x54);
    r.needs(seat, { resting: 'campfire', roof: false, place: 'outdoors', temp: 50, fire: 100 });
    r.tick(); r.minutes(70); r.tick();
    yes('an hour on a seat at a fire is not open ground', !ill(r, seat, 'chill'));
    r.H.staff(me, ['chill'], 'staff');
    r.needs(me, { resting: '', roof: false, place: 'outdoors', temp: 50, fire: -1 });
    r.minutes(20); r.tick();
    yes('warm all along is not "warm again": the chill stays', !!ill(r, me, 'chill'));
    r.needs(me, { resting: '', roof: false, place: 'snow', temp: 22, fire: -1 });
    r.minutes(1); r.tick();
    r.needs(me, { resting: '', roof: true, place: 'indoors', temp: 50, fire: -1 });
    r.minutes(1); r.tick();
    yes('cold, then warm again, clears it', !ill(r, me, 'chill'));
    r.H.staff(me, ['chill'], 'staff');
    r.needs(me, { resting: '', roof: false, place: 'outdoors', temp: 50, fire: -1 });
    r.minutes(119); r.tick();
    yes('a chill is still there at 1 hour 59', !!ill(r, me, 'chill'));
    r.minutes(1); r.tick();
    yes('and gone at 2 hours', !ill(r, me, 'chill'));
  }

  // ------------------------------------------------------ cuts and bites
  {
    const r = rig();
    const me = r.person(0x60);
    r.H.staff(me, ['cut'], 'staff');
    yes('a cut bleeds at 2 a second', r.H.bleedRate(r.rec(me)) === 2 && r.rec(me).show[0] === 'Bleeding');
    r.H.bleedTick();
    yes('the bleed is the engine\'s own DamageActorValue on Health, 2', r.damage.length === 1 &&
      r.damage[0].fn === 'DamageActorValue' && r.damage[0].args[0] === 'Health' && r.damage[0].args[1] === 2);
    const rec = r.rec(me); rec.wounds[0].cloth = true; r.H.write(me, rec);
    yes('torn cloth slows it to 1', r.H.bleedRate(r.rec(me)) === 1 && r.rec(me).show[0] === 'Bleeding, slowed');
    r.set(me, 'dead', true);
    r.damage.length = 0; r.H.bleedTick();
    yes('a body does not bleed', r.damage.length === 0);
    r.set(me, 'dead', false);
    r.H.died(me);
    yes('a death stops the bleed and keeps the cut', r.H.bleedRate(r.rec(me)) === 0 && !!woundOf(r, me, 'cut'));

    // The fever roll, in a rig of its own so nobody else's wound takes the dice.
    const r2 = rig();
    const a = r2.person(0x61);
    r2.H.staff(a, ['cut'], 'staff');
    r2.minutes(9); r2.tick();
    yes('no fever roll before 10 minutes', !woundOf(r2, a, 'cut').rolled);
    r2.dice.next = [0.39];
    r2.minutes(1); r2.tick();
    yes('an open cut at 10 minutes rolls 40% and catches it at 39', !!ill(r2, a, 'fever'));
    yes('and a cut still bleeding stays on the list', !!woundOf(r2, a, 'cut'));
    const r3 = rig();
    const b = r3.person(0x62);
    r3.H.staff(b, ['cut'], 'staff');
    const rb = r3.rec(b); rb.wounds[0].bandage = true; rb.wounds[0].bleed = false; r3.H.write(b, rb);
    r3.dice.next = [0.11];
    r3.minutes(10); r3.tick();
    yes('a bandaged cut at 11 does not catch it (10%)', !ill(r3, b, 'fever'));
    yes('and a stopped cut whose roll is done leaves the list', !woundOf(r3, b, 'cut'));

    // The spells, by their own rank.
    const r4 = rig();
    const c = r4.person(0x63);
    r4.H.staff(c, ['cut'], 'staff');
    const healing = { type: 'espm', desc: P.SPELL_IDS['Healing'] };
    r4.H.cast(c, healing);
    yes('novice Healing on yourself stops the bleed and leaves the cut open', r4.H.bleedRate(r4.rec(c)) === 0 &&
      !woundOf(r4, c, 'cut').closed && r4.lines(c).some(function (l) { return /still open/.test(l); }));
    r4.dice.next = [0.39];
    r4.minutes(10); r4.tick();
    yes('so it still rolls the open 40% at 10 minutes', !!ill(r4, c, 'fever'));
    r.minutes(10); r.tick();
    const d = r.person(0x64);
    r.H.staff(d, ['bite'], 'staff');
    r.H.hit(d, { type: 'form', desc: 'x' }, { type: 'espm', desc: P.SPELL_IDS['Heal Other'] });
    yes('advanced Heal Other landing on somebody closes their bite', woundOf(r, d, 'bite').closed &&
      r.H.bleedRate(r.rec(d)) === 0);
    r.dice.next = [0.26];
    r.minutes(10); r.tick();
    yes('a closed bite rolls no fever and bite sickness at 25%: 26 does not catch it',
      !ill(r, d, 'fever') && !ill(r, d, 'bite') && !woundOf(r, d, 'bite'));
    const e = r.person(0x65);
    r.H.staff(e, ['bite'], 'staff');
    r.dice.next = [0.99, 0.59];
    r.minutes(10); r.tick();
    yes('an open bite rolls 60% for bite sickness: 59 catches it', !!ill(r, e, 'bite') && !ill(r, e, 'fever'));
    r.H.cast(e, { type: 'espm', desc: P.SPELL_IDS['Heal Other'] });
    yes('a spell meant for somebody else, cast, does nothing to the caster', r.H.bleedRate(r.rec(e)) === 2);
    const npc = 0x66;
    r.set(npc, 'pid', 0);
    r.H.hit(npc, null, { type: 'espm', desc: P.SPELL_IDS['Heal Other'] });
    yes('a hit on something that is not a person writes nothing', !r.mp.get(npc, 'thornswoodHurt'));
    r.H.cast(e, { type: 'espm', desc: P.SPELL_IDS['Flames'] || '12fcd:Skyrim.esm' });
    yes('a spell that is not a healing spell does nothing', r.H.bleedRate(r.rec(e)) === 2);
  }

  // --------------------------------------------------------------- breaks
  {
    const r = rig();
    const me = r.person(0x70);
    r.H.staff(me, ['break', 'arm'], 'staff');
    let n = r.H.forNeeds(me);
    yes('a broken arm costs -0.15 melee', n.add.attackDamageMult === -0.15);
    r.H.cast(me, { type: 'espm', desc: P.SPELL_IDS['Grand Healing'] });
    yes('an expert spell does not set a break that is not splinted', !woundOf(r, me, 'break').set);
    const rec = r.rec(me); rec.wounds[0].splint = true; r.H.write(me, rec);
    r.H.cast(me, { type: 'espm', desc: P.SPELL_IDS['Fast Healing'] });
    yes('an advanced spell does not set a splinted one', !woundOf(r, me, 'break').set);
    r.H.cast(me, { type: 'espm', desc: P.SPELL_IDS['Grand Healing'] });
    yes('an expert spell sets a splinted break', woundOf(r, me, 'break').set > 0);
    const two = r.person(0x71);
    r.H.staff(two, ['break', 'leg'], 'staff');
    yes('a broken leg costs -8 speed', r.H.forNeeds(two).add.speedMult === -8);
    r.minutes(3 * 24 * 60 - 1); r.tick();
    yes('an unset break is still a break just short of 3 days', !!woundOf(r, two, 'break'));
    r.minutes(1); r.tick();
    yes('ignored for 3 days it heals crooked', !woundOf(r, two, 'break') && !!r.rec(two).crooked.leg &&
      r.lines(two).some(function (l) { return /healed crooked/.test(l); }));
    n = r.H.forNeeds(two);
    yes('a crooked leg is a lasting -4 speed and no longer -8', n.add.speedMult === -4);
    r.minutes(30 * 24 * 60); r.tick();
    yes('and it lasts', !!r.rec(two).crooked.leg);
    r.set(two, 'cell', TEMPLE_CELL);
    r.H.rite(two);
    yes('the temple puts a crooked heal right', !r.rec(two).crooked.leg);
  }

  // ---------------------------------------------------------------- burns
  {
    const r = rig();
    const me = r.person(0x80);
    r.H.burning(me, true);
    r.clock.now += 4000;
    r.H.burning(me, true);
    r.clock.now += 200;
    yes('four seconds in the fire (28) is not a bad burn', r.H.burning(me, false) === '' && !woundOf(r, me, 'burn'));
    r.H.burning(me, true);
    r.clock.now += 3000; r.H.burning(me, true);
    r.clock.now += 2000;
    const said = r.H.burning(me, false);
    yes('five seconds (35) is a bad burn, and says so', /burnt you badly/.test(said) && woundOf(r, me, 'burn').dealt === 35);
    yes('the screen says Bad burn', r.rec(me).show.indexOf('Bad burn') !== -1);
    yes('it halves what is worn', JSON.stringify(r.H.burntWear(me)) === JSON.stringify({ all: true, counts: 0.5 }));
    r.H.burning(me, true);
    r.clock.now += 60000;
    r.H.burning(me, true);
    r.clock.now += 3000;
    yes('a report after a long silence is a new fire, not one that burned all along',
      (function () { const s = r.H.burning(me, false); return s === ''; })());
    r.dice.next = [0.39];
    r.minutes(10); r.tick();
    yes('an untreated burn at 10 minutes rolls 40% wound fever', !!ill(r, me, 'fever'));
    r.minutes(24 * 60); r.tick();
    yes('the burn heals in a day', !woundOf(r, me, 'burn') && r.H.burntWear(me) === null &&
      r.lines(me).some(function (l) { return /burn has healed/.test(l); }));

    // What the needs block makes of it: the cover halves.
    const two = r.person(0x81);
    let fur = null;
    for (const dsc in WARMTH.items) { if (WARMTH.items[dsc].m === 'fur' && WARMTH.items[dsc].c === 'body') { fur = dsc; break; } }
    r.set(two, 'worn', [{ baseId: r.idOf(fur), worn: true }]);
    r.needs(two, { place: 'outdoors' });
    const before = r.N.view(two).cover;
    r.H.burning(two, true); r.clock.now += 6000; r.H.burning(two, false);
    const after = r.N.view(two).cover;
    yes('with a bad burn a fur cuirass counts at half its warmth (' + before + ' to ' + after + ')',
      !!fur && before > 0 && Math.abs(after - before / 2) <= 1);
  }

  // ------------------------------------------------- the needs read it
  {
    const r = rig();
    const me = r.person(0x90);
    r.needs(me, { food: 100, drink: 100, rest: 100, temp: 50 });
    const n0 = r.N.effects(me, r.N.read(me));
    yes('nothing wrong, nothing to pay', Object.keys(n0).length === 0);
    r.H.staff(me, ['food'], 'staff');
    yes('a disease in its caught window costs nothing', Object.keys(r.N.effects(me, r.N.read(me))).length === 0);
    r.minutes(10);
    r.needs(me, { food: 100, drink: 100, rest: 100, temp: 50 });
    const n1 = r.N.effects(me, r.N.read(me));
    yes('food sickness is the weary hunger penalties on a full stomach',
      JSON.stringify(n1) === JSON.stringify(r.N.COST.food.weary));
    r.needs(me, { food: 15, drink: 100, rest: 100, temp: 50 });
    const n2 = r.N.effects(me, r.N.read(me));
    yes('and does not stack on a stomach already bad: the bad band, once',
      JSON.stringify(n2) === JSON.stringify(r.N.COST.food.bad));
    const two = r.person(0x91);
    r.H.staff(two, ['fever'], 'staff');
    r.minutes(30);
    r.needs(two, { food: 100, drink: 100, rest: 100, temp: 50 });
    const n3 = r.N.effects(two, r.N.read(two));
    const want = {};
    [r.N.COST.food.bad, r.N.COST.rest.bad].forEach(function (c) { for (const k in c) { want[k] = (want[k] || 0) + c[k]; } });
    yes('a bad fever is the bad hunger and the bad rest penalties', JSON.stringify(n3) === JSON.stringify(want));
    const three = r.person(0x92);
    r.H.staff(three, ['chill'], 'staff');
    r.minutes(10);
    r.needs(three, { food: 100, drink: 100, rest: 100, temp: 50 });
    yes('a chill is the weary cold penalties when warmth is fine',
      JSON.stringify(r.N.effects(three, r.N.read(three))) === JSON.stringify(r.N.TEMP_COST.cold.weary));
    r.needs(three, { food: 100, drink: 100, rest: 100, temp: 85 });
    const hot = r.N.effects(three, r.N.read(three));
    const both = {};
    [r.N.TEMP_COST.hot.bad, r.N.TEMP_COST.cold.weary].forEach(function (c) { for (const k in c) { both[k] = (both[k] || 0) + c[k]; } });
    yes('and on top of the heat for somebody chilled at a forge', JSON.stringify(hot) === JSON.stringify(both));
    const four = r.person(0x93);
    r.H.staff(four, ['agreed', 'eye'], 'staff');
    r.needs(four, { food: 100, drink: 100, rest: 100, temp: 50 });
    yes('an agreed eye is -20 bow and -20 destruction on the panel',
      JSON.stringify(r.N.effects(four, r.N.read(four))) === JSON.stringify({ MarksmanPowerMod: -20, DestructionPowerMod: -20 }));
  }

  // ---------------------------------------------------------------- the bench
  {
    const r = rig();
    const me = r.person(0xa0);
    const forge = 0xa1, pot = 0xa2, loom = 0xa3;
    const forgeBase = Object.keys(BENCH_BY_BASE).filter(function (b) { return BENCH_BY_BASE[b] === '88105:Skyrim.esm'; })[0];
    const potBase = Object.keys(BENCH_BY_BASE).filter(function (b) { return BENCH_BY_BASE[b] === 'a5cb3:Skyrim.esm'; })[0];
    const loomBase = Object.keys(BENCH_BY_BASE).filter(function (b) { return BENCH_BY_BASE[b] === '6ce000:Update.esm'; })[0];
    r.set(forge, 'base', forgeBase); r.set(pot, 'base', potBase); r.set(loom, 'base', loomBase);
    yes('nothing wrong, every bench is open', r.H.craftRefusal(me, forge) === '' && r.H.craftRefusal(me, pot) === '');
    r.H.staff(me, ['fever'], 'staff');
    r.minutes(11);
    yes('an ill fever does not refuse a craft', r.H.craftRefusal(me, pot) === '');
    r.minutes(20);
    yes('a bad fever refuses every craft, a pot included', /too sick/.test(r.H.craftRefusal(me, pot)));
    const two = r.person(0xa4);
    r.H.staff(two, ['break', 'arm'], 'staff');
    yes('a broken arm refuses the forge', /two hands, and your arm is broken/.test(r.H.craftRefusal(two, forge)));
    yes('and not the cooking pot', r.H.craftRefusal(two, pot) === '');
    const three = r.person(0xa5);
    r.H.staff(three, ['break', 'leg'], 'staff');
    yes('a broken leg refuses no bench', r.H.craftRefusal(three, forge) === '');
    r.H.staff(three, ['agreed', 'hand'], 'staff');
    yes('a missing hand refuses the loom, for good', /you have one/.test(r.H.craftRefusal(three, loom)));
    r.minutes(30 * 24 * 60); r.tick();
    yes('and still does a month later', /you have one/.test(r.H.craftRefusal(three, loom)));
  }

  // ------------------------------------------------- staff, and the record
  {
    const r = rig();
    const me = r.person(0xb0);
    yes('/hurt with nothing after the person says what they have', /nothing\./.test(r.H.staff(me, [], 'staff').staff));
    const sc = r.H.staff(me, ['agreed', 'scar', 'a', '<b>pale</b>', 'line', 'across', 'the', 'jaw'], 'Djinn');
    yes('an agreed scar is written with no markup in it', r.H.scarOf(me) === 'a bpale/b line across the jaw' &&
      /People who look at you are told/.test(sc.them));
    yes('a scar needs words', /What is the scar/.test(r.H.staff(me, ['agreed', 'scar'], 'x').staff));
    r.H.staff(me, ['cut'], 'staff');
    r.H.staff(me, ['fever'], 'staff');
    r.H.staff(me, ['clear'], 'staff');
    yes('/hurt clear takes the wounds and the sickness and keeps the agreed loss',
      r.rec(me).wounds.length === 0 && r.rec(me).ills.length === 0 && !!r.rec(me).agreed.scar);
    r.H.staff(me, ['unagree', 'scar'], 'staff');
    yes('/hurt unagree takes a loss written by mistake off', !r.rec(me).agreed.scar && r.H.scarOf(me) === '');
    yes('/hurt break with no limb asks which', /Break which/.test(r.H.staff(me, ['break'], 'x').staff));
    yes('/hurt with a word it does not know says what it does know', /not something \/hurt knows/.test(r.H.staff(me, ['stab'], 'x').staff));
    for (let i = 0; i < 20; i++) { r.H.staff(me, ['break', 'arm'], 'x'); }
    yes('a record holds at most ' + r.H.HURT.most + ' wounds', r.rec(me).wounds.length === r.H.HURT.most);
    r.mp.set(me, 'thornswoodHurt', { wounds: [{ k: 'stab', at: 1 }, null, 'x'], ills: [{ k: 'plague', at: 1 }], junk: 1 });
    const back = r.rec(me);
    yes('a record rebuilt from somebody else\'s JSON keeps only what it knows', back.wounds.length === 0 &&
      back.ills.length === 0 && !('junk' in back));
  }

  // ------------------------------------------------------- the screen
  {
    const r = rig();
    const opts = r.made.thornswoodHurt;
    yes('the record is a property its owner sees and nobody else does',
      !!opts && opts.isVisibleByOwner === true && opts.isVisibleByNeighbors === false);
    const sent = [];
    const ctx = { value: { show: ['Bleeding', 'Broken arm'] }, state: {},
                  sp: { browser: { executeJavaScript: function (js) { sent.push(js); } } } };
    const draw = new Function('ctx', opts.updateOwner);
    draw(ctx); draw(ctx);
    let parses = false;
    try { new Function(sent[0]); parses = true; } catch (e) { parses = false; }
    yes('the screen script draws the lines once, and the page script it sends parses',
      sent.length === 1 && parses && sent[0].indexOf('Broken arm') !== -1 && sent[0].indexOf('ts-hurt') !== -1);
    ctx.value = { show: [] };
    draw(ctx);
    yes('and hides itself when there is nothing to say', sent.length === 2 && /display=\\?"none\\?"|display="none"|\"none\"/.test(sent[1]));
  }

  // --------------------------------------------------- joined up in the file
  {
    const craft = src.indexOf("mp.onCraft = guard('onCraft'");
    const craftBody = craft >= 0 ? src.slice(craft, src.indexOf('NO RECIPE AT ALL', craft)) : '';
    const gate = src.indexOf('function unfitToMake(actorId, workbenchId) {');
    const gateBody = gate >= 0 ? src.slice(gate, src.indexOf('\n}\n', gate)) : '';
    yes('mp.onCraft asks the injury block before anything else, through the one craft gate (#1733), and refuses with false',
      /hurt\.craftRefusal\(actorId, workbenchId\)/.test(gateBody) &&
      /const unfit = unfitToMake\(actorId, workbenchId\);/.test(craftBody) && /return false;/.test(craftBody));
    // The client's /ate line is gone (#3136): nothing in the chat commands
    // hears a drink, so the engine's is the only one.
    const chatAt = src.indexOf('// ==== thornswood chat commands ====');
    const chatSrc = chatAt >= 0 ? src.slice(chatAt, src.indexOf('// ==== end thornswood chat commands ====', chatAt)) : '';
    yes('a potion of cure disease is heard from the engine\'s own drink, never from a chat line',
      (src.match(/^  mp\.onEatItem = guard\('onEatItem'/gm) || []).length === 1 &&
      /swallowed\(actorId, Number\(baseId\) \|\| 0\)/.test(HURT_SRC) &&
      !!chatSrc && chatSrc.indexOf('swallowed') === -1 && chatSrc.indexOf("word === '/ate'") === -1);
    const burn = src.indexOf("if (word === '/burn') {");
    yes('the /burn report times the fire', burn >= 0 && /burnt\.burning\(actorId,/.test(src.slice(burn, burn + 1500)));
    const death = src.indexOf("mp.onDeath = guard('onDeath'");
    const deathBody = death >= 0 ? src.slice(death, src.indexOf("mp.onRespawn = guard('onRespawn'", death)) : '';
    yes('mp.onDeath tells the injury block of a person\'s death, after the people only test',
      deathBody.indexOf('hurt.died(actorId)') > deathBody.indexOf('if (!(pid > 0)) { return; }'));
    const hitAt = src.indexOf("mp['onPapyrusEvent:OnHit'] = guard(");
    yes('the one OnHit handler hands a hit to the injury block', hitAt >= 0 &&
      /hurt\.hit\(targetId, aggressor, source\)/.test(src.slice(hitAt, hitAt + 1500)));
    yes('there is one OnSpellCast handler in the file', (src.match(/mp\['onPapyrusEvent:OnSpellCast'\] =/g) || []).length === 1);
    yes('one OnHit handler, still', (src.match(/mp\['onPapyrusEvent:OnHit'\] =/g) || []).length === 1);
    const bless = slice('function bless(actorId, baseDesc) {', '\n}\n');
    yes('a shrine press asks for the temple rite', !!bless && /hurt\.rite\(actorId\)/.test(bless));
    yes('the needs block reads a disease and a wound', /H\.forNeeds\(actorId\)/.test(NEEDS_SRC) && /H\.burntWear\(actorId\)/.test(NEEDS_SRC));
    const words = /^const WORDS = \[([\s\S]*?)\];/m.exec(src);
    const player = /^const PLAYER_WORDS = \[([\s\S]*?)\];/m.exec(src);
    yes('/hurt is a word the server answers', !!words && words[1].indexOf("'/hurt'") !== -1);
    yes('and is not one a person is told about: it is staff\'s', !!player && player[1].indexOf("'/hurt'") === -1);
    const staffWords = /var WORDS_STAFF = \[([\s\S]*?)\];/.exec(src);
    yes('the staff block gates /hurt on the staff roles', !!staffWords && staffWords[1].indexOf("'/hurt'") !== -1 &&
      /if \(word === '\/hurt'\) \{[\s\S]{0,200}g\.__thornswoodHurt/.test(src));
    yes('the look prompt draws an agreed scar, and redraws when it changes',
      /\(row\.c \? '<div/.test(FRONT) && /\|' \+ \(row\.c \|\| ''\)/.test(FRONT));
    yes('the near list carries the scar as c, never over the sleep key s',
      /w\[them\.id\.toString\(16\)\]\.c = them\.scar/.test(src) && !/\]\.s = them\.scar/.test(src));
    yes('no line the block says calls anybody a player', !/player/i.test(HURT_SRC.replace(/'onlinePlayers'/g, '')));
    yes('no em dash in the block', HURT_SRC.indexOf('—') === -1);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
