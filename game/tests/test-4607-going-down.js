// test-4607-going-down.js
//
// #4607. Health that would reach zero leaves a person down, not dead: they
// can talk, not fight or cast. A bandage from somebody else, a healing spell
// landing on them or a healing potion stands them back up at a quarter of
// their health; nobody does in 3 minutes and they wake at the temple with
// the wounds they had (docs/systems/injury.md, "Down").
//
// It drives the REAL injury and disease block, the REAL mp.onDying and the
// REAL cuffs lines out of game/gamemode.js, over one fake mp that does what
// the fork does with a death (skymp #101, #1626): onDying is asked before a
// health write takes somebody to nothing; false keeps them at dyingHealth
// with nothing of a death sent; anything else is the death, then onDeath.
// The client half runs the down property's own script over a fake sp.
//
// Read only. No tables needed: the blocks are sliced out of gamemode.js.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

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

const HURT_SRC = slice('// ==== thornswood injury and disease ====', '// ==== end thornswood injury and disease ====');
const DYING_SRC = slice("mp.onDying = guard('onDying',", '\n});');
yes('the injury block and mp.onDying are in the gamemode', !!HURT_SRC && !!DYING_SRC);

const ME = 0xff000010, HELPER = 0xff000011, WOLF = 0xff000012, BANDIT = 0xff000013;
const BANDAGE = '154c0:Thornswood-Content.esp';
const POTION = 0x3eadd, STEW = 0x3eade, RESTORE = 0x3eb15;

/*
  The rig. The engine half is death(): what MpActor::AskBeforeDeath and the
  death after it do, reached from a blow (hitToNothing) or from the
  gamemode's own write of health to nothing (mp.set of percentages).
*/
function rig(opts) {
  opts = opts || {};
  const G = {};
  const clock = { now: 1700000000000 };
  const actors = {};
  const props = {};
  const made = {};
  const said = [];
  const papyrus = [];
  const deaths = [];
  const timers = [];
  const pack = {};
  const taken = [];
  let dyingHealth = null;
  function actor(id, o) {
    actors[id] = Object.assign({ pid: 0, dead: false, health: 1, magicka: 0.5, stamina: 0.75,
                                 cell: '3c:Skyrim.esm', pos: [0, 0, 0] }, o || {});
    return id;
  }
  const records = {};
  records[POTION] = { type: 'ALCH', fields: [{ type: 'ENIT', data: [10, 0, 0, 0, 0, 0, 0, 0] }, { type: 'EFID', data: [0x15, 0xeb, 0x03, 0x00] }] };
  records[STEW] = { type: 'ALCH', fields: [{ type: 'ENIT', data: [10, 0, 0, 0, 2, 0, 0, 0] }, { type: 'EFID', data: [0x15, 0xeb, 0x03, 0x00] }] };
  records[RESTORE] = { type: 'MGEF', editorId: 'AlchRestoreHealth', fields: [] };
  const mp = {
    makeProperty: function (name, o) { made[name] = o; },
    getDescFromId: function (id) { return 'ff' + id.toString(16) + ':Runtime'; },
    lookupEspmRecordById: function (id) {
      return records[id] ? { record: records[id], toGlobalRecordId: function (x) { return x; } } : null;
    },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') {
        return Object.keys(actors).map(Number).filter(function (a) { return actors[a].pid > 0; });
      }
      const a = actors[id] || {};
      if (key === 'profileId') { return a.pid || 0; }
      if (key === 'isDead') { return !!a.dead; }
      if (key === 'worldOrCellDesc') { return a.cell; }
      if (key === 'pos') { return a.pos; }
      if (key === 'percentages') { return { health: a.health, magicka: a.magicka, stamina: a.stamina }; }
      return props[id] ? props[id][key] : undefined;
    },
    set: function (id, key, v) {
      if (key === 'dyingHealth') { dyingHealth = v; return; }
      if (key === 'percentages') {
        const a = actors[id];
        if (!(v.health > 0) && !a.dead) { death(id, 0); }
        else { a.health = v.health; }
        a.magicka = v.magicka; a.stamina = v.stamina;
        return;
      }
      if (!props[id]) { props[id] = {}; }
      props[id][key] = JSON.parse(JSON.stringify(v));
    },
    callPapyrusFunction: function (kind, cls, fn, self, args) { papyrus.push({ fn: fn, self: self, args: args }); }
  };
  // MpActor::AskBeforeDeath, then the death and onDeath.
  function death(id, killer) {
    dyingHealth = null;
    const answer = mp.onDying(id, killer || 0, actors[id].health);
    if (answer === false) {
      actors[id].health = dyingHealth === null ? actors[id].health : dyingHealth;
      return false;
    }
    actors[id].dead = true;
    actors[id].health = 0;
    deaths.push(id);
    // mp.onDeath for a person: the injury block's died() (event-handlers.ts).
    if (actors[id].pid > 0 && G.__thornswoodHurt) { G.__thornswoodHurt.died(id); }
    return true;
  }
  const D = { now: function () { return clock.now; } };
  const names = ['globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval', 'guard', 'notify',
                 'say', 'Math', 'idOf', 'BENCH_BY_BASE', 'packCount', 'takeItem'];
  const vals = [G, mp, D, { log: function () { } },
                function (f, ms) { timers.push({ f: f, ms: ms }); return 0; }, function () { },
                function (n, f) { return f; }, function () { },
                function (id, line) { said.push({ id: id, line: line }); }, Math,
                function (desc) { return desc === BANDAGE ? 0x154c0 : 0; }, {},
                function (id, desc) { return (pack[id] && pack[id][desc]) || 0; },
                function (id, desc, n) {
                  if (!pack[id] || (pack[id][desc] || 0) < n) { return false; }
                  pack[id][desc] -= n; taken.push(id.toString(16) + ' ' + desc); return true;
                }];
  new Function(names.join(','), HURT_SRC).apply(null, vals);
  if (opts.cheatDeath) { G.__thornswoodPerks = { cheatDeath: opts.cheatDeath }; }
  // The healing spells, the way the progression block names them.
  const H = G.__thornswoodHurt;
  const healingName = H && H.HEALING ? Object.keys(H.HEALING).filter(function (k) { return !H.HEALING[k].self; })[0] : '';
  G.__thornswoodProgression = {
    spellByDesc: function (desc) { return desc === 'heal-other' ? { name: healingName, rank: 'novice' } : null; }
  };
  const box = { guard: function (n, f) { return f; }, mp: mp };
  box.globalThis = G;
  vm.createContext(box);
  vm.runInContext(DYING_SRC || '', box);
  return {
    G: G, H: H, mp: mp, made: made, said: said, papyrus: papyrus, deaths: deaths, taken: taken, pack: pack,
    actors: actors, clock: clock, actor: actor, timers: timers,
    hitToNothing: function (id, killer) { return death(id, killer); },
    downProp: function (id) { return (props[id] && props[id].thornswoodDown) || {}; },
    rec: function (id) { return H.read(id); },
    lines: function (id) { return said.filter(function (s) { return s.id === id; }).map(function (s) { return s.line; }); },
    minutes: function (m) { clock.now += m * 60000; }
  };
}

if (HURT_SRC && DYING_SRC) {
  // --------------------------------------------------------- going down --
  {
    const r = rig();
    const H = r.H;
    yes('D0 the injury block has going down: goDown, standUp and wake', !!H && typeof H.goDown === 'function' &&
      typeof H.standUp === 'function' && typeof H.wake === 'function');
    yes('D0 the numbers are injury.md\'s: 3 minutes, back up at a quarter', !!H && !!H.DOWN &&
      H.DOWN.minutes === 3 && H.DOWN.stable === 0.25 && H.DOWN.keep > 0 && H.DOWN.keep <= 0.01);
    r.actor(ME, { pid: 7, health: 0.3 });
    r.actor(WOLF, { pid: 0 });
    r.actor(BANDIT, { pid: 0, health: 0.2 });
    const died = r.hitToNothing(ME, WOLF);
    yes('D1 a blow that would kill a person leaves them alive, with no death sent', died === false &&
      !r.actors[ME].dead && r.deaths.length === 0);
    yes('D1 ...kept at a sliver of health, not nothing', r.actors[ME].health > 0 && r.actors[ME].health <= 0.01);
    const rec = r.rec(ME);
    yes('D1 ...and down on their record, for 3 minutes, by the world', !!rec.down &&
      rec.down.until === r.clock.now + 3 * 60000 && rec.down.by === 0);
    yes('D1 ...their machine is told they are down', !!r.downProp(ME) && r.downProp(ME).down === true);
    yes('D1 ...and so is anybody near them', !!r.made.thornswoodDown && r.made.thornswoodDown.isVisibleByOwner === true &&
      r.made.thornswoodDown.isVisibleByNeighbors === true);
    yes('D1 they are told they are down, can talk, and what gets them up',
      r.lines(ME).some(function (l) { return /You are down\. You can talk, but not fight or cast\..*bandage.*healing spell.*potion.*3 minutes.*temple/.test(l); }));
    yes('D1 the screen\'s lines say Down', rec.show[0] === 'Down');
    yes('D1 somebody near is offered the treatment panel on them', H.careOf(ME) === true);

    const until = rec.down ? rec.down.until : -1;
    r.minutes(1);
    const again = r.hitToNothing(ME, WOLF);
    yes('D2 a blow on somebody down does not kill them, and the clock is not moved', again === false &&
      !r.actors[ME].dead && !!r.rec(ME).down && r.rec(ME).down.until === until);

    const banditDied = r.hitToNothing(BANDIT, ME);
    yes('D3 somebody who is not a person dies as before', banditDied === true && r.actors[BANDIT].dead);
  }

  // A person's blow is remembered, for the question death.md asks.
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.actor(HELPER, { pid: 9 });
    r.hitToNothing(ME, HELPER);
    yes('D4 a person\'s blow names their profile on the down', !!r.rec(ME).down && r.rec(ME).down.by === 9);
  }

  // Cheat Death answers first, and a spared person is not down.
  {
    const r = rig({ cheatDeath: function (id) { return id === ME ? 0.2 : 0; } });
    r.actor(ME, { pid: 7, health: 0.3 });
    r.hitToNothing(ME, 0);
    yes('D5 Cheat Death is asked first: spared at its health, and not down', r.actors[ME].health === 0.2 &&
      !r.rec(ME).down && r.downProp(ME).down === undefined);
  }

  // No bleed while down.
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.H.wound(ME, 'cut', '', r.clock.now);
    r.hitToNothing(ME, 0);
    r.papyrus.length = 0;
    r.H.bleedTick();
    yes('D6 somebody down is not bled further', !!r.rec(ME).down &&
      r.papyrus.filter(function (p) { return p.fn === 'DamageActorValue'; }).length === 0);
  }

  // ---------------------------------------------------- stood back up --
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.actor(HELPER, { pid: 9 });
    r.pack[HELPER] = {}; r.pack[HELPER][BANDAGE] = 2;
    r.pack[ME] = {}; r.pack[ME][BANDAGE] = 1;
    r.hitToNothing(ME, 0);
    const self = r.H.treat(ME, ME, 'bandage');
    yes('S1 they cannot bandage themselves up, and keep the bandage', self.ok === false &&
      /Somebody near you has to/.test(self.line) && r.pack[ME][BANDAGE] === 1 && !!r.rec(ME).down);
    const t = r.H.treat(HELPER, ME, 'bandage');
    yes('S2 a bandage from somebody else stands them up', t.ok === true && !r.rec(ME).down &&
      /back up/.test(t.line) && /back up/.test(t.them));
    yes('S2 ...at a quarter of their health', r.actors[ME].health === 0.25 && !r.actors[ME].dead);
    yes('S2 ...magicka and stamina as they were', r.actors[ME].magicka === 0.5 && r.actors[ME].stamina === 0.75);
    yes('S2 ...the bandage is the helper\'s, and one is used', r.pack[HELPER][BANDAGE] === 1);
    yes('S2 ...and their machine is told they are up', r.downProp(ME).down === false);
    r.minutes(5);
    r.H.tick();
    yes('S2 the clock that ran out after does nothing', !r.actors[ME].dead && r.deaths.length === 0);
  }
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.actor(HELPER, { pid: 9 });
    r.hitToNothing(ME, 0);
    r.H.hit(ME, HELPER, { desc: 'heal-other' });
    yes('S3 a healing spell landing on them stands them up at a quarter', !r.rec(ME).down &&
      r.actors[ME].health === 0.25 && r.downProp(ME).down === false &&
      r.lines(ME).indexOf('You are back on your feet, still hurt.') !== -1);
  }
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.hitToNothing(ME, 0);
    yes('S4 a stew that heals is food, not a potion, and does not stand them up',
      r.H.swallowed(ME, STEW) === '' && !!r.rec(ME).down);
    const line = r.H.swallowed(ME, POTION);
    yes('S4 a healing potion stands them up at a quarter', line === 'You are back on your feet, still hurt.' &&
      !r.rec(ME).down && r.actors[ME].health === 0.25);
    yes('S4 a healing potion when nobody is down says nothing here', r.H.swallowed(ME, POTION) === '');
  }
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.hitToNothing(ME, 0);
    r.actors[ME].health = 0.6;
    if (typeof r.H.standUp === 'function') { r.H.standUp(ME, 'a test'); }
    yes('S5 standing up never takes health away', !!r.H.standUp && r.actors[ME].health === 0.6);
  }

  // --------------------------------------------------------- the wake --
  {
    const r = rig();
    r.actor(ME, { pid: 7, health: 0.3 });
    r.H.wound(ME, 'break', 'leg', r.clock.now);
    r.hitToNothing(ME, 0);
    r.minutes(2.9);
    r.H.tick();
    yes('W1 before the 3 minutes are up the tick leaves them down', !r.actors[ME].dead && !!r.rec(ME).down);
    r.minutes(0.2);
    r.H.tick();
    yes('W2 nobody came in 3 minutes: the death goes through to the wake', r.actors[ME].dead && r.deaths.join() === String(ME));
    const rec = r.rec(ME);
    yes('W2 ...with the wounds they had', rec.wounds.length === 1 && rec.wounds[0].k === 'break');
    yes('W2 ...and the down is over, so the next fall is a fresh one', !rec.down && rec.wake === false &&
      r.downProp(ME).down === false);
    r.actors[ME].dead = false; r.actors[ME].health = 1;
    const next = r.hitToNothing(ME, 0);
    yes('W3 after the wake, health reaching nothing is a new down, not a death', next === false && !!r.rec(ME).down);
  }

  // ---------------------------------------------- their own machine --
  const script = (r0 => (r0.made.thornswoodDown && r0.made.thornswoodDown.updateOwner) || '')(rig());
  function client(storage) {
    const log = [];
    const sp = {
      storage: storage || {},
      printConsole: function (s) { log.push('console ' + s); },
      Game: {
        getPlayer: function () { return pc; },
        disablePlayerControls: function (m, f) { log.push('controls off fight=' + f); },
        enablePlayerControls: function (m, f) { log.push('controls on fight=' + f); }
      },
      Debug: { sendAnimationEvent: function (who, e) { log.push('anim ' + e); } }
    };
    const pc = { cell: 1, getParentCell: function () { return { getFormID: function () { return pc.cell; } }; },
                 isWeaponDrawn: function () { return true; }, sheatheWeapon: function () { log.push('sheathe'); } };
    const st = {};
    return {
      sp: sp, pc: pc, log: log,
      frame: function (value) { new Function('ctx', script)({ sp: sp, state: st, value: value }); }
    };
  }
  yes('C0 the down property has an owner script', !!script);
  if (script) {
    const c = client();
    c.frame({ down: false, at: 1 });
    yes('C1 coming into the world up does nothing', c.log.length === 0);
    c.frame({ down: true, at: 2 });
    yes('C2 down: fighting and casting off, the weapon away, the bleedout pose',
      c.log.join('|') === 'controls off fight=true|sheathe|anim BleedoutStart');
    yes('C2 ...and fighting is named held for being down', c.sp.storage.thornswoodControlsHeld.fighting === 'down');
    c.frame({ down: true, at: 2 });
    yes('C3 the next frame does nothing again', c.log.length === 3);
    c.pc.cell = 2;
    c.frame({ down: true, at: 2 });
    yes('C3 after a load into a new cell the pose is played once more', c.log[3] === 'anim BleedoutStart' && c.log.length === 4);
    c.frame({ down: false, at: 3 });
    yes('C4 up: fighting back, the pose ended, nothing named held',
      c.log.slice(4).join('|') === 'controls on fight=true|anim BleedoutStop' && !c.sp.storage.thornswoodControlsHeld.fighting);

    const both = client({ thornswoodControlsHeld: { fighting: 'cuffed' } });
    both.frame({ down: true, at: 5 });
    yes('C5 cuffed and down: both reasons are named', both.sp.storage.thornswoodControlsHeld.fighting === 'cuffed,down');
    both.frame({ down: false, at: 6 });
    yes('C5 up while still cuffed: fighting stays off', both.log.indexOf('controls on fight=true') === -1 &&
      both.sp.storage.thornswoodControlsHeld.fighting === 'cuffed');
  }

  // The cuffs coming off somebody still down leave fighting off as well.
  {
    const lit = function (name) {
      const m = new RegExp("^\\s*('\\s*step\\(\"" + name + "\".*'),$", 'm').exec(src);
      return m ? eval(m[1]) : '';
    };
    const off = lit('stop naming fighting held');
    const back = lit('give fighting back');
    yes('K0 the cuffs\' release lines are in the gamemode', !!off && !!back);
    const log = [];
    const sp = { storage: { thornswoodControlsHeld: { fighting: 'cuffed,down' } },
                 Game: { enablePlayerControls: function () { log.push('controls on'); } } };
    new Function('sp', 'step', off + '\n' + back)(sp, function (w, f) { f(); });
    yes('K1 the cuffs off somebody down: fighting stays off, down still named',
      log.length === 0 && sp.storage.thornswoodControlsHeld.fighting === 'down');
    const log2 = [];
    const sp2 = { storage: { thornswoodControlsHeld: { fighting: 'cuffed' } },
                  Game: { enablePlayerControls: function () { log2.push('controls on'); } } };
    new Function('sp', 'step', off + '\n' + back)(sp2, function (w, f) { f(); });
    yes('K2 the cuffs off with nothing else holding it: fighting back', log2.join() === 'controls on' &&
      !sp2.storage.thornswoodControlsHeld.fighting);
  }
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
