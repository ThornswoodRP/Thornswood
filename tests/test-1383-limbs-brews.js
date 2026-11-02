// test-1383-limbs-brews.js
//
// #1383, what Herald built on 17 October:
//   - the record carries which limb is broken and the screen script hands it to
//     the front plugin as thornswoodBrokenLimbs;
//   - the front plugin's broken limbs block shuts the sprint gate on a broken
//     leg (a broken arm's dearer block is the server's, test-1386-warrior.js);
//   - the mixtures list keys Cure Disease by its magic effect (0xAE722), not
//     by the potion record (0xAE723);
//   - a brewed bottle of cure disease cures when drunk, by the runtime id the
//     alchemy gate told the injury block about;
//   - a cooked meal's help against disease halves the chance (a quarter for a
//     feast) while it lasts, and unguarded() takes it off (#2682).
//
// It drives the REAL injury and needs blocks out of gamemode.js and the REAL
// broken limbs block out of thornswood-front.js, over fakes. Read only.
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const FRONT = fs.readFileSync(path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');
const FOOD = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'food.json'), 'utf8'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(text, a, b) {
  const i = text.indexOf(a);
  const j = i < 0 ? -1 : text.indexOf(b, i);
  return (i >= 0 && j >= 0) ? text.slice(i, j + b.length) : null;
}

const NEEDS_SRC = slice(src, '// ==== thornswood needs: hunger, thirst and exhaustion ====', '// ==== end thornswood needs ====');
const HURT_SRC = slice(src, '// ==== thornswood injury and disease ====', '// ==== end thornswood injury and disease ====');
const PROG_SRC = slice(src, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const LIMBS_SRC = slice(FRONT, '  // ==== broken limbs (#1383) ====', '  // ==== end broken limbs ====');
yes('the needs, injury, progression and broken limbs blocks are there', !!NEEDS_SRC && !!HURT_SRC && !!PROG_SRC && !!LIMBS_SRC);

function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(src);
  return m ? JSON.parse(m[1]) : { items: {} };
}
const WARMTH = table('WARMTH'), WEATHER = table('WEATHER'), WATERS = table('WATERS');
const benchLine = /^const BENCH_BY_BASE = (\{.*\});$/m.exec(src);
const BENCH_BY_BASE = benchLine ? JSON.parse(benchLine[1]) : {};
const progBox = {};
if (PROG_SRC) { new Function('globalThis', 'console', PROG_SRC)(progBox, { log: function () { } }); }
const P = progBox.__thornswoodProgression;

function rig() {
  const G = {}, props = {}, extra = {}, said = [];
  const clock = { now: 1700000000000 };
  const dice = { next: [] };
  const ids = {};
  let nextId = 0x10;
  function idOf(desc) {
    const m = /^([0-9a-f]+):Skyrim\.esm$/.exec(desc);
    if (m) { return parseInt(m[1], 16); }
    if (!ids[desc]) { ids[desc] = nextId++; }
    return ids[desc];
  }
  const M = Object.create(Math);
  M.random = function () { return dice.next.length ? dice.next.shift() : 0.999; };
  const made = {};
  const mp = {
    makeProperty: function (name, opts) { made[name] = opts; },
    getDescFromId: function (id) { return id.toString(16) + ':Skyrim.esm'; },
    get: function (id, key) { if (id === 0 && key === 'onlinePlayers') { return Object.keys(extra).map(Number); }
      const e = extra[id] || {};
      if (key === 'profileId') { return e.pid || 0; }
      if (key === 'isDead') { return false; }
      if (key === 'worldOrCellDesc') { return '3c:Skyrim.esm'; }
      if (key === 'inventory') { return { entries: [] }; }
      if (key === 'equipment') { return { inv: { entries: [] } }; }
      if (key === 'pos') { return [0, 0, 0]; }
      return props[id] ? props[id][key] : undefined;
    },
    set: function (id, key, v) { if (!props[id]) { props[id] = {}; } props[id][key] = JSON.parse(JSON.stringify(v)); },
    callPapyrusFunction: function () { }
  };
  const D = { now: function () { return clock.now; } };
  const common = ['globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
                  'guard', 'notify', 'say', 'Math', 'idOf'];
  const vals = [G, mp, D, { log: function () { } }, function () { return 0; }, function () { },
                function (n, f) { return f; }, function (id, line) { said.push({ id: id, line: line }); },
                function () { }, M, idOf];
  new Function(common.concat(['WARMTH', 'WEATHER', 'WATERS']).join(','), NEEDS_SRC).apply(null, vals.concat([WARMTH, WEATHER, WATERS]));
  new Function(common.concat(['BENCH_BY_BASE']).join(','), HURT_SRC).apply(null, vals.concat([BENCH_BY_BASE]));
  G.__thornswoodProgression = P;
  G.__thornswoodCharacter = { stateOf: function () { return P.fresh(); }, writeState: function () { } };
  G.__thornswoodPerks = { holds: function () { return false; } };
  return {
    G: G, H: G.__thornswoodHurt, mp: mp, made: made, clock: clock, dice: dice, said: said, idOf: idOf,
    person: function (id) { extra[id] = { pid: id }; return id; },
    minutes: function (m) { clock.now += m * 60000; },
    rec: function (id) { return G.__thornswoodHurt.read(id); },
    raw: function (id) { return props[id] ? props[id].thornswoodHurt : undefined; }
  };
}
function ill(r, id, k) { return r.rec(id).ills.filter(function (x) { return x.k === k; })[0] || null; }

if (NEEDS_SRC && HURT_SRC && P) {
  // ------------------------------------------------ the limbs on the record
  {
    const r = rig();
    const me = r.person(0x40);
    yes('a sound record carries no broken limb', r.H.limbsOf(r.rec(me)).arm === 0 && r.H.limbsOf(r.rec(me)).leg === 0);
    r.H.staff(me, ['break', 'leg'], 'staff');
    yes('a broken leg is written on the record as limbs.leg', !!r.raw(me) && r.raw(me).limbs && r.raw(me).limbs.leg === 1 && r.raw(me).limbs.arm === 0);
    r.H.staff(me, ['break', 'arm'], 'staff');
    yes('and a broken arm as limbs.arm', r.raw(me).limbs.arm === 1 && r.raw(me).limbs.leg === 1);
    r.H.staff(me, ['clear'], 'staff');
    yes('cleared, both are gone', r.raw(me).limbs.arm === 0 && r.raw(me).limbs.leg === 0);

    // The screen script hands it to the plugin.
    const script = r.made.thornswoodHurt && r.made.thornswoodHurt.updateOwner;
    yes('the hurt property has a screen script', typeof script === 'string' && script.length > 0);
    const glob = {};
    function run(value, state) {
      new Function('ctx', 'globalThis', script)({ value: value, state: state, sp: { browser: { executeJavaScript: function () { } } } }, glob);
    }
    const st = {};
    run({ show: ['Broken leg'], care: 1, limbs: { arm: 0, leg: 1 } }, st);
    yes('the screen script hands a broken leg to the plugin', !!glob.thornswoodBrokenLimbs && glob.thornswoodBrokenLimbs.leg === 1);
    run({ show: ['Broken arm'], care: 1, limbs: { arm: 1, leg: 0 } }, st);
    yes('and hands nothing of an arm: the server charges its block', glob.thornswoodBrokenLimbs.leg === 0 && !('arm' in glob.thornswoodBrokenLimbs));
    run({ show: [], care: 0, limbs: { arm: 0, leg: 0 } }, st);
    yes('and lets go of the leg once healed', glob.thornswoodBrokenLimbs.leg === 0);
  }

  // ------------------------------------------------------- Cure Disease brew
  {
    const mix = /var MIXTURES = \{([\s\S]*?)\n\};/.exec(src);
    yes('the mixtures list keys Cure Disease by the magic effect 0xAE722', !!mix && /'ae722:Skyrim\.esm': \{ name: 'Cure Disease'/.test(mix[1]));
    const potion = Object.keys(FOOD.items).filter(function (k) { return FOOD.items[k].edid === 'CureDisease'; })[0];
    yes('and not by the potion record food.json names (' + potion + ')', potion === 'ae723:Skyrim.esm' && mix[1].indexOf("'" + potion + "'") === -1);

    const r = rig();
    const me = r.person(0x50);
    const bottle = 0xff000123;
    yes('the injury block keeps the effect as ae722', r.H.CURE_DISEASE_EFFECT === 'ae722:Skyrim.esm');
    yes('a brew without Cure Disease is not remembered', r.H.brewed(me, bottle, [0x3eb15]) === false && r.rec(me).brews.length === 0);
    yes('a brew carrying Cure Disease is remembered by its runtime id', r.H.brewed(me, bottle, [0x3eb15, 0xae722]) === true && r.rec(me).brews.indexOf(bottle) !== -1);
    yes('a plugin form id is never remembered as a brew', r.H.brewed(me, 0xae723, [0xae722]) === false);
    r.H.staff(me, ['fever'], 'staff');
    r.minutes(31); r.H.tick();
    const line = r.H.swallowed(me, bottle);
    yes('drinking the brewed bottle cures the fever', !ill(r, me, 'fever') && /wound fever is gone/.test(line));
    r.H.staff(me, ['fever'], 'staff');
    yes('another runtime bottle cures nothing', r.H.swallowed(me, 0xff000999) === '' && !!ill(r, me, 'fever'));
    r.H.brewed(me, bottle, [0x3eb15]);
    yes('the same id brewed again as something else forgets the cure', r.rec(me).brews.indexOf(bottle) === -1 && r.H.swallowed(me, bottle) === '' && !!ill(r, me, 'fever'));
    const feverBefore = !!ill(r, me, 'fever');
    r.H.swallowed(me, 0xae723);
    yes('the potion record still cures as before', feverBefore && !ill(r, me, 'fever'));
    for (let i = 0; i < r.H.BREWS_MOST + 5; i++) { r.H.brewed(me, 0xff100000 + i, [0xae722]); }
    yes('the record remembers at most BREWS_MOST bottles, newest kept', r.rec(me).brews.length === r.H.BREWS_MOST &&
      r.rec(me).brews.indexOf(0xff100000 + r.H.BREWS_MOST + 4) !== -1 && r.rec(me).brews.indexOf(0xff100000) === -1);
    const gate = slice(src, 'function recipelessCraft(', '\n}\n');
    yes('the alchemy gate tells the injury block about every runtime brew', !!gate && /hurtBrew\.brewed\(actorId, Number\(craftedItemBaseId\), effects\)/.test(gate) &&
      /want === 'alchemist' && \(Number\(craftedItemBaseId\) \|\| 0\) >= RUNTIME && Array\.isArray\(effects\)/.test(gate));
  }

  // --------------------------------------------------------- the meal's help
  {
    const r = rig();
    const me = r.person(0x60);
    yes('the meal help is half for 20 minutes and a quarter for 10 for a feast',
      r.H.MEAL_GUARD.cooked.mult === 0.5 && r.H.MEAL_GUARD.cooked.min === 20 && r.H.MEAL_GUARD.feast.mult === 0.25 && r.H.MEAL_GUARD.feast.min === 10);
    yes('without a meal the chance is whole', r.H.chanceFor(me, 0.4) === 0.4);
    r.H.guarded(me, false);
    yes('a cooked meal halves it', Math.abs(r.H.chanceFor(me, 0.4) - 0.2) < 1e-9);
    r.dice.next = [0.3];
    yes('so raw meat at a roll of 0.30 does not catch', r.H.exposed(me, 'food', 'raw') === false);
    r.minutes(20);
    yes('and 20 minutes later it is whole again', r.H.chanceFor(me, 0.4) === 0.4);
    r.H.guarded(me, true);
    yes('a feast makes it a quarter', Math.abs(r.H.chanceFor(me, 0.4) - 0.1) < 1e-9);
    r.minutes(10);
    yes('for 10 minutes', r.H.chanceFor(me, 0.4) === 0.4);
  }

  // ------------------------------------------ the guard taken off (#2682)
  {
    const r = rig();
    const me = r.person(0x61);
    yes('unguarded is exported beside guarded', typeof r.H.unguarded === 'function' && typeof r.H.guarded === 'function');
    yes('with no guard on the record, unguarded answers false', r.H.unguarded(me) === false);
    yes('and writes nothing', r.raw(me) === undefined);
    r.H.guarded(me, false);
    yes('guarded still answers true and halves the chance', !!r.rec(me).guard && Math.abs(r.H.chanceFor(me, 0.4) - 0.2) < 1e-9);
    yes('unguarded takes the guard off and answers true', r.H.unguarded(me) === true);
    yes('the guard is gone from the record', r.rec(me).guard === null && r.raw(me).guard === null);
    yes('and the chance is whole again before the 20 minutes are up', r.H.chanceFor(me, 0.4) === 0.4);
    yes('a second unguarded answers false', r.H.unguarded(me) === false);
    r.H.guarded(me, false);
    yes('guarding again after it was taken off works', Math.abs(r.H.chanceFor(me, 0.4) - 0.2) < 1e-9);
    r.minutes(20);
    yes('and still runs out after 20 minutes', r.H.chanceFor(me, 0.4) === 0.4);
    r.H.guarded(me, true);
    yes('a feast\'s guard comes off the same way', r.H.unguarded(me) === true && r.H.chanceFor(me, 0.4) === 0.4);

    // Bad ids: guarded() checks nothing and reads through read(), so does
    // unguarded(). A bad id reads as a fresh record with no guard.
    const other = r.person(0x62);
    r.H.guarded(other, false);
    let threw = false, answers = [];
    try { answers = [undefined, null, 0, NaN, 'x', {}].map(function (bad) { return r.H.unguarded(bad); }); }
    catch (e) { threw = true; }
    yes('a bad id does not throw and answers false', !threw && answers.length === 6 && answers.every(function (a) { return a === false; }));
    yes('and takes nobody else\'s guard off', Math.abs(r.H.chanceFor(other, 0.4) - 0.2) < 1e-9);
    yes('and writes no record for a bad id', [undefined, null, 0, 'x', {}].every(function (bad) { return r.raw(bad) === undefined; }));
  }
}

// ------------------------------------------------------- the front plugin
if (LIMBS_SRC) {
  function fake() {
    const s = { sprinting: false, gate: true, events: [], notes: [], hooks: [] };
    const pc = {
      getFormID: function () { return 0x14; },
      getAnimationVariableBool: function () { return s.gate; },
      setAnimationVariableBool: function (k, v) { if (k === 'bSprintOK') { s.gate = v; } },
      isSprinting: function () { return s.sprinting; }
    };
    const sp = {
      Game: { getPlayer: function () { return pc; } },
      Debug: { notification: function (t) { s.notes.push(t); }, sendAnimationEvent: function (a, ev) { s.events.push(ev); } },
      on: function (name) { s.hooks.push(name); }
    };
    const glob = {};
    const L = new Function('sp', 'globalThis', LIMBS_SRC + '\nreturn brokenLimbs;')(sp, glob);
    return { s: s, pc: pc, L: L, glob: glob };
  }
  {
    const f = fake();
    yes('the block hooks no hit and no frame: nothing of the arm is measured on the client', f.s.hooks.length === 0 &&
      !/isHitBlocked|damageActorValue|BLOCK_WINDOW/.test(LIMBS_SRC));
    yes('a sound leg leaves the sprint gate alone', f.L.refuseSprint(f.pc) === false && f.s.gate === true);
    f.glob.thornswoodBrokenLimbs = { arm: 0, leg: 1 };
    f.s.sprinting = true;
    yes('a broken leg shuts the sprint gate', f.L.refuseSprint(f.pc) === true && f.s.gate === false);
    yes('stops a sprint already running', f.s.events.indexOf('SprintStop') !== -1);
    yes('and says so in the world, once', f.s.notes.length === 1 && /broken leg/.test(f.s.notes[0]));
    f.L.refuseSprint(f.pc);
    yes('not every frame', f.s.notes.length === 1);
    const gate = slice(FRONT, '  function holdSprintShut() {', '\n  }\n');
    yes('while the sprint key is down, a broken leg holds the gate shut each frame, and nothing holds it open',
      !!gate && gate.indexOf('brokenLimbs.leg()') !== -1 && gate.indexOf('brokenLimbs.refuseSprint(') !== -1 &&
      FRONT.indexOf("setAnimationVariableBool('bSprintOK', true)") === -1 && /\n    holdSprintShut\(\);\n/.test(FRONT));
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
