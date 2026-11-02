// test-1385-perks.js
//
// #1385. Each filled perk on docs/systems/skill-tree.md does the magnitude
// written there, a once-a-day perk does not fire twice (not across a restart
// either, since its clock is on the character), and Precision's critical
// chance is said to be ignored rather than pretended. The page's table is
// read and held against the block, so a change to either side shows here.
// Nothing here is a chat command (Patrick, 4 Oct): Font of Magic is the Use
// button on the K panel, and the panel shows the clocks.
//
// Read only. Drives the real blocks out of gamemode.js over a fake mp.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(root, 'game', 'gamemode.js'), 'utf8')).replace(/\r/g, '');
const page = fs.readFileSync(path.join(root, 'docs', 'systems', 'skill-tree.md'), 'utf8').replace(/\r/g, '');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function near(a, b) { return Math.abs(a - b) < 1e-6; }

const progression = slice(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const perks = slice(gm, '// ==== thornswood skill perks ====', '// ==== end thornswood skill perks ====');
const onDeath = slice(gm, "mp.onDeath = guard('onDeath', function (actorId, killerId) {", '\n});');
const onHit = slice(gm, "mp['onPapyrusEvent:OnHit'] = guard(", '\n});');
const panel = fs.readFileSync(path.join(root, 'game', 'ui', 'thornswood-skills.js'), 'utf8').replace(/\r/g, '');
yes('the progression block, the skill perks block, mp.onDeath and the OnHit handler are in the gamemode',
  !!progression && !!perks && !!onDeath && !!onHit);
if (!(progression && perks && onDeath && onHit)) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

// ------------------------------------------------------------ the world --
const clock = { t: 1700000000000 };
const DAY = 24 * 60 * 60 * 1000;
const world = { actors: new Map(), props: new Map(), calls: [], timers: [], logs: [], told: [], failProp: false };
// An actor may carry its own descriptor, the way another character loaded at
// the same ID has one (#2069).
function desc(id) { const a = world.actors.get(id); return (a && a.desc) || id.toString(16) + ':run'; }
function actor(id, o) {
  world.actors.set(id, Object.assign({ pid: id > 0xff000000 && id < 0xff001000 ? id - 0xff000000 : -1, dead: false,
    p: { health: 1, magicka: 1, stamina: 1 }, max: { Health: 200, Magicka: 100, Stamina: 100 },
    worn: [], race: RACE }, o || {}));
  return id;
}
function bytes(n, at, size) {
  const out = new Array(size || 4).fill(0);
  out[at] = n & 255; out[at + 1] = (n >>> 8) & 255; out[at + 2] = (n >>> 16) & 255; out[at + 3] = (n >>> 24) & 255;
  return out;
}
function floatBytes(x, at, size) {
  const out = new Array(size || 4).fill(0);
  const buf = Buffer.alloc(4); buf.writeFloatLE(x, 0);
  for (let i = 0; i < 4; i++) { out[at + i] = buf[i]; }
  return out;
}
// The records the block reads: spells, weapons, armour, an enchantment, its
// effect, the two armour settings and a race.
const SPELL = 0x5ee, HOLD_SPELL = 0x5ef, SWORD = 0x6a0, BOW = 0x6b0, CROSSBOW = 0x6b1;
const CUIRASS = 0x7a0, ENCH = 0x7b0, MGEF_ARMOUR = 0x7c0, MGEF_OTHER = 0x7c1, RACE = 0x13746;
function spit(cost, castType) {
  const b = new Array(36).fill(0);
  bytes(cost, 0).slice(0, 4).forEach(function (v, i) { b[i] = v; });
  b[16] = castType;
  return b;
}
function mgefData(av) { const b = new Array(0x48 + 4).fill(0); const x = bytes(av, 0x44, 0x48 + 4); return x; }
// An MGEF's DATA with its flags (4 is hostile) and the value it works on.
function mgefFlags(flags, av) { const x = mgefData(av); bytes(flags, 0, 4).forEach(function (v, i) { x[i] = v; }); return x; }
// An EFIT: magnitude, area, duration.
function efit(mag, dur) { const x = floatBytes(mag, 0, 12); bytes(dur, 8, 12).slice(8, 12).forEach(function (v, i) { x[8 + i] = v; }); return x; }
// A SPIT with its spell type at 8 (0 a spell, 1 a disease, 2 a power).
function spitTyped(cost, castType, type) { const b = spit(cost, castType); b[8] = type; return b; }
const RECORDS = {};
RECORDS[SPELL] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spit(50, 1) }] };
RECORDS[HOLD_SPELL] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spit(14, 2) }] };
RECORDS[SWORD] = { type: 'WEAP', fields: [{ type: 'DNAM', data: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }] };
RECORDS[BOW] = { type: 'WEAP', fields: [{ type: 'DNAM', data: [7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }] };
RECORDS[CROSSBOW] = { type: 'WEAP', fields: [{ type: 'DNAM', data: [9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }] };
RECORDS[CUIRASS] = { type: 'ARMO', fields: [{ type: 'EITM', data: bytes(ENCH, 0) }, { type: 'DNAM', data: bytes(4000, 0) }] };
RECORDS[ENCH] = { type: 'ENCH', fields: [
  { type: 'EFID', data: bytes(MGEF_ARMOUR, 0) }, { type: 'EFIT', data: floatBytes(20, 0, 12) },
  { type: 'EFID', data: bytes(MGEF_OTHER, 0) }, { type: 'EFIT', data: floatBytes(99, 0, 12) }] };
RECORDS[MGEF_ARMOUR] = { type: 'MGEF', fields: [{ type: 'DATA', data: mgefData(39) }] };
RECORDS[MGEF_OTHER] = { type: 'MGEF', fields: [{ type: 'DATA', data: mgefData(24) }] };
RECORDS[0x37deb] = { type: 'GMST', fields: [{ type: 'DATA', data: floatBytes(80, 0) }] };
RECORDS[0x21a72] = { type: 'GMST', fields: [{ type: 'DATA', data: floatBytes(0.12, 0) }] };
RECORDS[RACE] = { type: 'RACE', fields: [{ type: 'DATA', data: floatBytes(3, 88, 128) }] };
// Overcharge's other half: spells that hold, and spells that do not.
const OAK = 0x5f0, LIGHT = 0x5f1, BURN = 0x5f2, HELD_WARD = 0x5f3, POWER = 0x5f4, BOLT = 0x5f5;
const MGEF_BUFF = 0x7c2, MGEF_HURT = 0x7c3, MGEF_HEAL = 0x7c4;
RECORDS[MGEF_BUFF] = { type: 'MGEF', fields: [{ type: 'DATA', data: mgefFlags(0, 39) }] };
RECORDS[MGEF_HURT] = { type: 'MGEF', fields: [{ type: 'DATA', data: mgefFlags(4, 24) }] };
RECORDS[MGEF_HEAL] = { type: 'MGEF', fields: [{ type: 'DATA', data: mgefFlags(0, 24) }] };
RECORDS[OAK] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spitTyped(40, 1, 0) },
  { type: 'EFID', data: bytes(MGEF_BUFF, 0) }, { type: 'EFIT', data: efit(40, 60) }] };
// A light whose second effect heals over a time: helping health is not taking it.
RECORDS[LIGHT] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spitTyped(20, 1, 0) },
  { type: 'EFID', data: bytes(MGEF_BUFF, 0) }, { type: 'EFIT', data: efit(0, 0) },
  { type: 'EFID', data: bytes(MGEF_HEAL, 0) }, { type: 'EFIT', data: efit(2, 30) }] };
// A slow that also burns: it takes health, so it never holds longer.
RECORDS[BURN] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spitTyped(30, 1, 0) },
  { type: 'EFID', data: bytes(MGEF_BUFF, 0) }, { type: 'EFIT', data: efit(1, 20) },
  { type: 'EFID', data: bytes(MGEF_HURT, 0) }, { type: 'EFIT', data: efit(5, 4) }] };
RECORDS[HELD_WARD] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spitTyped(30, 2, 0) },
  { type: 'EFID', data: bytes(MGEF_BUFF, 0) }, { type: 'EFIT', data: efit(40, 1) }] };
RECORDS[POWER] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spitTyped(0, 1, 2) },
  { type: 'EFID', data: bytes(MGEF_BUFF, 0) }, { type: 'EFIT', data: efit(40, 60) }] };
// A bolt that only takes health, at once.
RECORDS[BOLT] = { type: 'SPEL', fields: [{ type: 'SPIT', data: spitTyped(30, 1, 0) },
  { type: 'EFID', data: bytes(MGEF_HURT, 0) }, { type: 'EFIT', data: efit(25, 0) }] };

const mpFake = {
  getActorRuntimeIdentity: function(id) {
    const a=world.actors.get(id);
    if (!a) throw new Error('no actor');
    return String(1+(a.runtime || 0));
  },
  getNpcAIState: function(id) {
    const a=world.actors.get(id);
    return a ? {isHuman:a.pid>0,profileId:a.pid,lifeGeneration:a.life || 0,runtimeLifeIdentity:String(1+(a.body || 0))} : null;
  },
  get: function (id, prop) {
    if (id === 0 && prop === 'onlinePlayers') {
      return Array.from(world.actors.keys()).filter(function (k) { return world.actors.get(k).pid > 0; });
    }
    const a = world.actors.get(id);
    if (!a) { throw new Error('no actor ' + id); }
    if (prop === 'percentages') { return Object.assign({}, a.inDeath || a.p); }
    if (prop === 'isDead') { return a.dead; }
    if (prop === 'profileId') { return a.pid; }
    if (prop === 'appearance') { return { raceId: a.race }; }
    if (prop === 'worldOrCellDesc') { return 'cell:Skyrim.esm'; }
    if (prop === 'pos') { return [0, 0, 0]; }
    if (prop === 'baseDesc') { return a.pid > 0 ? '7:Skyrim.esm' : 'wolf:Skyrim.esm'; }
    if (prop === 'equipment') { return { inv: { entries: a.worn.map(function (b) { return { baseId: b, count: 1, worn: true }; }) } }; }
    if (world.failGet && prop === 'thornswoodPerks') { throw new Error('the read failed'); }
    const bag = world.props.get(id) || {};
    if (Object.prototype.hasOwnProperty.call(bag, prop)) { return JSON.parse(bag[prop]); }
    if (prop === 'thornswoodPerks') { return null; }
    throw new Error('no ' + prop);
  },
  set: function (id, prop, v) {
    const a = world.actors.get(id);
    if (prop === 'percentages') {
      if (a.inDeath) { return; }
      a.p = { health: v.health, magicka: v.magicka, stamina: v.stamina };
      if (v.health === 0) { a.dead = true; }
      return;
    }
    if (prop === 'isDead') {
      a.dead = !!v;
      if (!v) { a.p = { health: 1, magicka: 1, stamina: 1 }; world.calls.push('stood ' + id.toString(16)); }
      return;
    }
    if (world.failProp) { throw new Error('the write failed'); }
    const bag = world.props.get(id) || {};
    bag[prop] = JSON.stringify(v);
    world.props.set(id, bag);
  },
  makeProperty: function () {},
  getDescFromId: desc,
  getIdFromDesc: function (d) { return parseInt(String(d).split(':')[0], 16); },
  lookupEspmRecordById: function (id) {
    const r = RECORDS[id];
    return r ? { record: r, toGlobalRecordId: function (local) { return local; } } : null;
  },
  callPapyrusFunction: function (type, cls, fn, self, args) {
    world.calls.push(cls + '.' + fn + ' ' + (args || []).join(' '));
    if (fn === 'RestoreActorValue') {
      const a = world.actors.get(parseInt(self.desc, 16));
      const key = String(args[0]).toLowerCase();
      a.p[key] = Math.min(1, a.p[key] + args[1] / a.max[args[0]]);
    }
    return null;
  }
};

const states = new Map();
function makeBox() {
  const box = {
    MERCHANT_TRADING: require('../game/merchant-trading'),
    console: { log: function () {} },
    mp: mpFake,
    guard: function (n, fn) { return fn; },
    log: function () { world.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
    say: function (id, text) { world.told.push({ id: id, text: text }); },
    setTimeout: function (fn, ms) { world.timers.push({ fn: fn, at: clock.t + (ms || 0) }); return world.timers.length; },
    setInterval: function () { return 1; },
    clearInterval: function () {},
    __thornswoodCharacter: {
      stateOf: function (id) { return states.get(id) || null; },
      // The map the client applies: the tree is enough for Vitality's health.
      effectsOf: function (id) { return box.__thornswoodProgression.treeApplies(states.get(id) || null); }
    },
    // The engine's own most, as the maneuvers block reads it off the records.
    __thornswoodManeuvers: { engineMost: function (id, which) { return world.noMost ? 0 : (which === 'health' ? 100 : 0); } }
  };
  box.globalThis = box;
  vm.createContext(box);
  box.__clock = clock;
  vm.runInContext('Date.now = function () { return __clock.t; };', box);
  vm.runInContext(progression, box);
  vm.runInContext(perks, box);
  return box;
}
let box = makeBox();
const P = box.__thornswoodProgression;
let K = box.__thornswoodPerks;
yes('the skill perks block registered', !!K && !!K.cheatDeath && !!K.hit && !!K.tick && !!K.use && !!K.clocks && !!K.holds && !!K.effects);

function later(ms) {
  clock.t += ms;
  world.timers.sort(function (a, b) { return a.at - b.at; });
  while (world.timers.length && world.timers[0].at <= clock.t) { world.timers.shift().fn(); }
}
function settle() { later(0); }
function filled(skills) {
  const s = P.fresh();
  s.tree = {};
  skills.forEach(function (k) { s.tree[k] = 5; });
  return s;
}
function logged(name) { return world.logs.filter(function (l) { return l.indexOf('perks: ' + name + ' fired') === 0; }).length; }
function strike(by, target, took, source, opts) {
  opts = opts || {};
  K.hit(target, { type: 'form', desc: desc(by) }, { type: 'espm', desc: source.toString(16) + ':Skyrim.esm' },
        !!opts.power, !!opts.bash);
  const a = world.actors.get(target);
  a.p.health = Math.max(0, a.p.health - took);
  if (a.p.health === 0) { a.dead = true; }
}
function health(id) { return Math.round(world.actors.get(id).p.health * 1e6) / 1e6; }
function heal(id) { const a = world.actors.get(id); a.p.health = 1; a.dead = false; }

// ---------------------------------------------------------- the page --
const rows = {};
page.split('\n').forEach(function (line) {
  const c = line.split('|').slice(1, -1).map(function (x) { return x.trim(); });
  if (c.length === 3 && /^[A-Z][a-z]+$/.test(c[0]) && /^[+-]\d/.test(c[1]) && c[2].indexOf('. ') > 0) {
    const at = c[2].indexOf('. ');
    rows[c[0].toLowerCase()] = { name: c[2].slice(0, at), says: c[2].slice(at + 2) };
  }
});
yes('the page has fifteen sub-skills with a perk each', Object.keys(rows).length === 15);
K.ORDER.forEach(function (key) {
  const p = K.PERKS[key];
  const row = rows[p.skill];
  yes(p.name + ' is the filled perk of ' + p.skill + ' on the page, and says what the page says',
    !!row && row.name === p.name && p.say.indexOf(row.says + '.') === 0 &&
    P.TABLE.tree[Object.keys(P.TABLE.tree).filter(function (a) { return !!P.TABLE.tree[a].skills[p.skill]; })[0]].skills[p.skill].perk === key);
});
yes('the numbers are the page\'s: 2 a second, 25% more, a tenth to half, one in five, 20%, 15 seconds, 5 minutes, half the armour, once a day',
  K.PERKS.trollsblood.perSecond === 2 && K.PERKS.devastatingblow.more === 0.25 &&
  K.PERKS.archmagesvessel.below === 0.1 && K.PERKS.archmagesvessel.to === 0.5 &&
  K.PERKS.overcharge.inEvery === 5 && K.PERKS.overcharge.more === 1 && K.PERKS.spellbreaker.share === 0.2 &&
  K.PERKS.fontofmagic.seconds === 15 && K.PERKS.secondwind.every === 5 * 60 * 1000 && K.PERKS.lethalaim.armour === 0.5 &&
  K.PERKS.cheatdeath.every === DAY && K.PERKS.archmagesvessel.every === DAY && K.PERKS.fontofmagic.every === DAY &&
  K.PERKS.cheatdeath.health === 1 && K.PERKS.leylineattunement.rate === 0.5);

// ------------------------------------------- the tree's totals, perks in --
{
  const T = P.TABLE.tuning;
  yes('the per point numbers are still the one set: Agility 2 speed, Toughness 10 and 10',
    T.perPoint.agility.speedMult === 2 && T.perPoint.toughness.poisonResist === 10 && T.perPoint.toughness.diseaseResist === 10);
  const four = P.fresh(); four.tree = { agility: 4, toughness: 4 };
  const a4 = P.treeApplies(four);
  yes('four points are only the points: 8 speed, 40 and 40', a4.speedMult === 8 && a4.poisonResist === 40 && a4.diseaseResist === 40);
  const five = P.treeApplies(filled(['agility', 'toughness']));
  yes('Windwalker: a filled Agility is 10 speed and 4 more', five.speedMult === 14);
  yes('Purified Blood: a filled Toughness brings disease resistance to 100 (none takes) and poison to 75 (poison deals 25%)',
    five.diseaseResist === 100 && five.poisonResist === 75);
  yes('and nothing else is added for a perk that is not a number', P.treeApplies(filled(['vitality'])).health === 50 &&
    Object.keys(P.treeApplies(filled(['vitality']))).join(',') === 'health');
}

// ---------------------------------------------------------- Cheat Death --
// mp.onDying asks cheatDeath() before the engine kills (#1626). Its answer is
// the share of the most that is 1 health, or 0 for an ordinary death. A
// filled Vitality is 50 health on the engine's 100 here, so 1 in 150.
const VIT = actor(0xff000001), NONE = actor(0xff000002), WOLF = actor(0xff002101, { pid: -1 });
states.set(VIT, filled(['vitality']));
states.set(NONE, P.fresh());
yes('somebody without Cheat Death is not spared', K.cheatDeath(NONE) === 0);
yes('an animal is never asked about', K.cheatDeath(WOLF) === 0);
world.noMost = true;
yes('a most health that cannot be read spends no day and is said in the log', K.cheatDeath(VIT) === 0 &&
  !(world.props.get(VIT) || {}).thornswoodPerks &&
  world.logs.some(function (l) { return /^perks: Cheat Death could not read the most health of ff000001/.test(l); }));
world.noMost = false;
yes('Cheat Death spares a filled Vitality, at 1 health of the 150 their bar shows', near(K.cheatDeath(VIT), 1 / 150));
const clockRec = JSON.parse(world.props.get(VIT).thornswoodPerks);
yes('and its clock is written on the character, 24 hours on', clockRec.ready.cheatdeath === clock.t + DAY);
yes('they are told, and the log records it', world.told.some(function (x) { return x.id === VIT && /^Cheat Death\. .*1 health/.test(x.text); }) &&
  logged('Cheat Death') === 1);
yes('nothing is stood back up and no timer is left to do it', world.calls.length === 0 && world.timers.length === 0);
later(60 * 60 * 1000);
yes('asked again the same day, it does not fire twice', K.cheatDeath(VIT) === 0 && logged('Cheat Death') === 1);
// A restart: the block is loaded fresh, and the clock is still on the character.
const KBefore = K;
box = makeBox();
K = box.__thornswoodPerks;
yes('after a restart the day is still spent, because the clock is on the character', K !== KBefore && K.cheatDeath(VIT) === 0);
later(DAY);
yes('24 hours after it fired, it fires again', near(K.cheatDeath(VIT), 1 / 150) && logged('Cheat Death') === 2);
later(DAY + 1000);
world.failProp = true;
yes('a clock that cannot be written does not fire', K.cheatDeath(VIT) === 0);
world.failProp = false;
world.failGet = true;
yes('nor one that cannot be read: an empty clock in its place would hand the day back',
  K.cheatDeath(VIT) === 0 && world.logs.some(function (l) { return /^perks: could not read the clocks of ff000001/.test(l); }));
world.failGet = false;
later(DAY + 1000);

// The death path does not ask it: by mp.onDeath the death has been sent, and
// standing the body back up would be a death undone.
{
  const deaths = [];
  const dbox = {
    console: { log: function () {} }, mp: mpFake, guard: function (n, fn) { return fn; },
    log: function () {}, notify: function () {}, say: function () {},
    HUNT_TUNING: { bodySeconds: 300 }, isCarcass: function () { return false; },
    creditWork: function () { return null; },
    cameInOf: function () { return null; },
    resolveArrival: function () { deaths.push('wake'); return { desc: 'temple', pos: [0, 0, 0], rot: [0, 0, 0], cell: 't', slot: 's', hold: 'h', via: 'v', reason: 'r' }; },
    __thornswoodPerks: { cheatDeath: function (id) { deaths.push('asked ' + id.toString(16)); return true; }, killerOf: function () { return 0; } }
  };
  dbox.globalThis = dbox;
  vm.createContext(dbox);
  vm.runInContext(onDeath, dbox);
  dbox.mp.onDeath(VIT, 0);
  yes('mp.onDeath never asks Cheat Death, and a death goes on to the wake', deaths.join(',') === 'wake' &&
    onDeath.indexOf('cheatDeath') === -1);
  const shown = K.clocks(VIT, states.get(VIT));
  yes('the K panel is sent the clock of Cheat Death', !!shown && !!shown.cheatdeath && shown.cheatdeath.ready > 0);
}

// mp.onDying is where it is asked: before the engine kills, with nothing sent.
{
  const onDying = slice(gm, "mp.onDying = guard('onDying', function (actorId) {", '\n});');
  yes('mp.onDying is in the gamemode', !!onDying);
  const asked = [], written = [];
  const ybox = {
    guard: function (n, fn) { return fn; },
    mp: { set: function (id, prop, v) { written.push(prop + ' ' + id.toString(16) + ' ' + v); } },
    __thornswoodPerks: { cheatDeath: function (id) { asked.push(id.toString(16)); return id === VIT ? 0.25 : 0; } }
  };
  ybox.globalThis = ybox;
  vm.createContext(ybox);
  vm.runInContext(onDying || '', ybox);
  const spared = ybox.mp.onDying(VIT, 0, 0.3);
  yes('Cheat Death refuses the death and writes the health the engine keeps them at',
    spared === false && written.join('|') === 'dyingHealth ff000001 0.25');
  const died = ybox.mp.onDying(NONE, VIT, 0.3);
  yes('an ordinary death is let through with nothing written', died === undefined && written.length === 1 &&
    asked.join(',') === 'ff000001,ff000002');
  yes('mp.onDying asks nothing but Cheat Death', (onDying || '').split('__thornswood').length === 2);
}

// -------------------------------------------------------- Troll's Blood --
const TROLL = actor(0xff000003);
states.set(TROLL, filled(['fortitude']));
world.actors.get(TROLL).p.health = 0.5;
K.tick();
yes('out of a fight Troll\'s Blood gives nothing', health(TROLL) === 0.5);
strike(WOLF, TROLL, 0.1, SWORD);
settle();
K.tick();
yes('in a fight it returns 2 health, in the engine\'s units', near(health(TROLL), 0.4 + 2 / 200));
later(250); K.tick();
yes('and not again until the second is up', near(health(TROLL), 0.4 + 2 / 200));
later(750); K.tick();
yes('2 a second', near(health(TROLL), 0.4 + 4 / 200));
yes('the log says it once a fight, not once a second', logged('Troll\'s Blood') === 1);
later(15000); K.tick();
yes('15 seconds after the last blow the fight is over and it stops', near(health(TROLL), 0.4 + 4 / 200));
world.actors.get(TROLL).p.health = 1;
strike(WOLF, TROLL, 0, SWORD);
settle(); K.tick();
yes('at full health it gives nothing', health(TROLL) === 1);
later(20000);

// ----------------------------------------------------- Devastating Blow --
const MIGHT = actor(0xff000004);
states.set(MIGHT, filled(['might']));
strike(MIGHT, WOLF, 0.2, SWORD, { power: true });
settle();
yes('a filled Might power attack deals 25% more: 0.2 becomes 0.25', health(WOLF) === 0.75);
yes('and the log records it', logged('Devastating Blow') === 1);
heal(WOLF);
strike(MIGHT, WOLF, 0.2, SWORD, {});
settle();
yes('a hit that is not a power attack is only itself', health(WOLF) === 0.8);
heal(WOLF);
strike(MIGHT, WOLF, 0.2, SWORD, { power: true, bash: true });
settle();
yes('a bash is not a power attack', health(WOLF) === 0.8);
heal(WOLF);
strike(MIGHT, WOLF, 0.2, SPELL, { power: true });
settle();
yes('a spell is not a power attack', health(WOLF) === 0.8);
heal(WOLF);
strike(NONE, WOLF, 0.2, SWORD, { power: true });
settle();
yes('somebody without the perk deals what the blow dealt', health(WOLF) === 0.8);
heal(WOLF);
strike(MIGHT, WOLF, 0, SWORD, { power: true });
settle();
yes('a blow the engine threw away (it took nothing) is not made bigger', health(WOLF) === 1);
world.actors.get(WOLF).p.health = 0.22;
strike(MIGHT, WOLF, 0.2, SWORD, { power: true });
settle();
yes('the quarter again can kill, and mp.onDeath is told whose blow it was',
  world.actors.get(WOLF).dead === true && K.killerOf(WOLF) === MIGHT && K.killerOf(WOLF) === 0);

// ------------------------------------------- a replaced target (#2069) --
// A queued Might bonus belongs to the body it was queued on. A new life or
// another descriptor at the same ID before the flush is left alone.
// The native life of whoever is at an ID (#2069). A replacement is a new
// life, or another descriptor at the same ID.
if (!mpFake.getNpcAIState) {
  mpFake.getNpcAIState = function (id) {
    const a = world.actors.get(id);
    return a ? { isHuman: a.pid > 0, profileId: a.pid, lifeGeneration: a.life || 0 } : null;
  };
}
function replaced(id, how) {
  const a = world.actors.get(id);
  if (how === 'life') { a.life = (a.life || 0) + 1; }
  else if (how === 'body') { a.body = (a.body || 0) + 1; }
  else { a.desc = 'other' + id.toString(16) + ':run'; }
  // Its health is what the engine left at the ID, as in the issue: the
  // queued effect is all that could still move it.
}
function restored(id) { const a = world.actors.get(id); delete a.desc; }
{
  const by = actor(0xff000060);
  states.set(by, filled(['might']));
  const PERSON = actor(0xff000061);
  for (const [name, target] of [['person', PERSON], ['creature', WOLF]]) {
    for (const how of ['life', 'desc', 'body']) {
      heal(target);
      strike(by, target, 0.2, SWORD, { power: true });
      replaced(target, how);
      settle();
      yes('T1 a Might bonus queued on a ' + name + ' does not land on a replacement (' + how + ')', health(target) === 0.8);
      restored(target);
    }
    heal(target);
    strike(by, target, 0.2, SWORD, { power: true });
    settle();
    yes('T2 on the same ' + name + ' it still lands: 0.2 becomes 0.25', health(target) === 0.75);
    for (const how of ['life','body']) {
      heal(target); world.actors.get(target).p.health = 0.22;
      strike(by, target, 0.2, SWORD, { power: true });
      settle();
      replaced(target, how);
      yes('T3 the fallback killer of a ' + name + ' is not named for a replacement '+how, K.killerOf(target) === 0);
    }
    heal(target); world.actors.get(target).p.health = 0.22;
    strike(by, target, 0.2, SWORD, { power: true });
    settle();
    yes('T3 and is named for the life it killed', world.actors.get(target).dead === true && K.killerOf(target) === by);
    heal(target);
  }
}
heal(WOLF);

// ------------------------------------------------------------ Lethal Aim --
const AIM = actor(0xff000005);
states.set(AIM, filled(['precision']));
world.actors.get(WOLF).worn = [CUIRASS];
yes('the armour is the engine\'s sum: the cuirass\'s 40 and its enchantment\'s 20 DamageResist, not its other effect',
  near(K.armourOf(WOLF), 60));
strike(AIM, WOLF, 0.1, BOW);
settle();
// 60 armour keeps 1 - 7.2% = 0.928 of a blow; half of it keeps 0.964.
yes('an arrow takes what it would have against half the armour: 0.1 at 0.928 becomes 0.1 at 0.964',
  near(1 - health(WOLF), 0.1 * 0.964 / 0.928));
heal(WOLF);
strike(AIM, WOLF, 0.1, CROSSBOW);
settle();
yes('a crossbow bolt the same', near(1 - health(WOLF), 0.1 * 0.964 / 0.928));
heal(WOLF);
strike(AIM, WOLF, 0.1, SWORD);
settle();
yes('a sword is not an arrow', health(WOLF) === 0.9);
heal(WOLF);
world.actors.get(WOLF).worn = [];
strike(AIM, WOLF, 0.1, BOW);
settle();
yes('against no armour there is nothing to ignore', health(WOLF) === 0.9);
heal(WOLF);
yes('Lethal Aim fired twice and the log says so', logged('Lethal Aim') === 2);

// ------------------------------------------------------------ Overcharge --
const POT = actor(0xff000006);
states.set(POT, filled(['potency']));
for (let i = 0; i < 4; i++) { strike(POT, WOLF, 0.1, SPELL); settle(); }
yes('four spells land as themselves', near(health(WOLF), 0.6));
strike(POT, WOLF, 0, SPELL); settle();
yes('a spell that took nothing does not count towards five', near(health(WOLF), 0.6));
strike(POT, WOLF, 0.1, SPELL); settle();
yes('the fifth deals double: 0.1 becomes 0.2', near(health(WOLF), 0.4));
yes('and the caster is told, and the log records it', world.told.some(function (x) { return x.id === POT && x.text === 'Overcharge: that spell lands double.'; }) &&
  logged('Overcharge') === 1);
strike(POT, WOLF, 0.1, SPELL); settle();
yes('the count starts again', near(health(WOLF), 0.3));
heal(WOLF);

// The other half (#2848): every fifth cast that holds, twice as long. The
// caster's machine counts and asks (the engine fork, setCastDurationEvery);
// the server counts the same casts and answers for everybody else.
yes('a spell holds when it is cast and let go, lasts a time, and takes no health',
  K.holdsLonger(OAK) === true && K.holdsLonger(LIGHT) === true);
yes('one that takes health, one held up, a power and one that lasts no time do not',
  K.holdsLonger(BURN) === false && K.holdsLonger(HELD_WARD) === false && K.holdsLonger(POWER) === false &&
  K.holdsLonger(BOLT) === false && K.holdsLonger(SPELL) === false && K.holdsLonger(SWORD) === false && K.holdsLonger(0x999) === false);
{
  const before = world.told.length;
  const got = [];
  for (let i = 0; i < 4; i++) { got.push(K.cast(POT, OAK, 1)); }
  got.push(K.cast(POT, LIGHT, 2));
  got.push(K.cast(POT, OAK, 1));
  yes('four casts that hold hold their own time, and the fifth, asked for, holds twice as long', got.join(',') === '1,1,1,1,2,1');
  yes('and the caster is told, and the log records it',
    world.told.slice(before).some(function (x) { return x.id === POT && x.text === 'Overcharge: that spell holds twice as long.'; }) &&
    logged('Overcharge') === 2);
  K.state.holding[POT] = 0;
  yes('a spell that takes health or is held up does not count, asked or not',
    [K.cast(POT, BURN, 2), K.cast(POT, HELD_WARD, 2), K.cast(POT, BOLT, 1)].join(',') === '1,1,1' && !K.state.holding[POT]);
  const early = [K.cast(POT, OAK, 1), K.cast(POT, OAK, 2)];
  yes('a cast that asks before the count is there holds its own time for everybody else, and counts',
    early.join(',') === '1,1' && K.state.holding[POT] === 2 &&
    world.logs.some(function (l) { return /Overcharge: the cast of 5f0 by ff000006 asked for 2 times as long at 2 of 5/.test(l); }));
  const late = [K.cast(POT, OAK, 1), K.cast(POT, OAK, 1), K.cast(POT, OAK, 1), K.cast(POT, OAK, 2)];
  yes('a fifth its machine did not ask for keeps the count, so the next one it asks for is it',
    late.join(',') === '1,1,1,2' && K.state.holding[POT] === 0);
  yes('somebody who does not hold Overcharge holds every spell its own time, asked or not',
    [1, 2, 3, 4, 5, 6].map(function () { return K.cast(NONE, OAK, 2); }).join(',') === '1,1,1,1,1,1');
  yes('nor does an NPC', K.cast(WOLF, OAK, 2) === 1);

  // mp.onSpellCast, the handler the engine asks before the cast goes out.
  const onCast = slice(gm, "mp.onSpellCast = guard('onSpellCast', function (casterId, spell, asked) {", '\n});');
  yes('mp.onSpellCast is in the gamemode, after the skill perks block', !!onCast && gm.indexOf(onCast) > gm.indexOf('// ==== end thornswood skill perks ===='));
  if (onCast) {
    vm.runInContext(onCast, box);
    const answered = [];
    const realSet = mpFake.set;
    mpFake.set = function (id, prop, v) { if (prop === 'spellCastDurationMult') { answered.push(id.toString(16) + '=' + v); return; } return realSet(id, prop, v); };
    K.state.holding[POT] = 4;
    const r = box.mp.onSpellCast(POT, OAK, 2);
    box.mp.onSpellCast(POT, OAK, 1);
    box.mp.onSpellCast(NONE, OAK, 2);
    mpFake.set = realSet;
    yes('it answers through spellCastDurationMult, only when the answer is more than the game\'s own, and refuses nothing',
      answered.join(',') === 'ff000006=2' && r === undefined);
  }
}

// ---------------------------------------------------------- Spellbreaker --
const WARD = actor(0xff000007);
states.set(WARD, filled(['ward']));
world.actors.get(WARD).p.magicka = 0.5;
strike(WOLF, WARD, 0.05, SPELL); settle();
yes('a spell costing 50 that hits a filled Ward gives 10 magicka', near(world.actors.get(WARD).p.magicka, 0.5 + 10 / 100));
strike(WOLF, WARD, 0.05, SWORD); settle();
yes('a sword gives nothing', near(world.actors.get(WARD).p.magicka, 0.6));
strike(WOLF, WARD, 0.01, HOLD_SPELL); settle();
strike(WOLF, WARD, 0.01, HOLD_SPELL); settle();
yes('a concentration spell costing 14 a second counts once a second: 2.8', near(world.actors.get(WARD).p.magicka, 0.6 + 2.8 / 100));
later(1000);
strike(WOLF, WARD, 0.01, HOLD_SPELL); settle();
yes('and again the next second', near(world.actors.get(WARD).p.magicka, 0.6 + 5.6 / 100));
const noneMag = world.actors.get(NONE).p.magicka;
strike(WOLF, NONE, 0.01, SPELL); settle();
yes('somebody without the perk gets nothing', world.actors.get(NONE).p.magicka === noneMag);
heal(WARD); heal(NONE);

// ----------------------------------------------------- Archmage's Vessel --
const CAP = actor(0xff000008);
states.set(CAP, filled(['capacity']));
later(3000);
world.actors.get(CAP).p.magicka = 0.15;
K.tick();
yes('above a tenth nothing happens', world.actors.get(CAP).p.magicka === 0.15);
world.actors.get(CAP).p.magicka = 0.05;
K.tick();
yes('below a tenth, magicka returns to half', world.actors.get(CAP).p.magicka === 0.5);
yes('the clock is on the character, and the log records it',
  JSON.parse(world.props.get(CAP).thornswoodPerks).ready.archmagesvessel === clock.t + DAY && logged('Archmage\'s Vessel') === 1);
world.actors.get(CAP).p.magicka = 0.05;
later(250); K.tick();
yes('once a day: the second drop the same day stays where it is', world.actors.get(CAP).p.magicka === 0.05);
later(DAY);
K.tick();
yes('the next day it fires again', world.actors.get(CAP).p.magicka === 0.5 && logged('Archmage\'s Vessel') === 2);

// ----------------------------------------------------------- Second Wind --
const VIG = actor(0xff000009);
states.set(VIG, filled(['vigor']));
later(3000);
world.actors.get(VIG).p.stamina = 0;
K.tick();
yes('stamina at 0 fills', world.actors.get(VIG).p.stamina === 1);
world.actors.get(VIG).p.stamina = 0;
later(60 * 1000); K.tick();
yes('not again inside 5 minutes', world.actors.get(VIG).p.stamina === 0);
box = makeBox();
K = box.__thornswoodPerks;
later(3 * 60 * 1000); K.tick();
yes('nor after a restart inside the 5 minutes', world.actors.get(VIG).p.stamina === 0);
later(60 * 1000 + 1000); K.tick();
yes('after 5 minutes it fills again', world.actors.get(VIG).p.stamina === 1 && logged('Second Wind') === 2);

// --------------------------------------------------------- Font of Magic --
const EFF = actor(0xff00000a);
states.set(EFF, filled(['efficiency']));
later(3000);
const pushed = [];
box.__thornswoodCharacter.writeState = function (id, s, redraw) { pushed.push({ id: id, redraw: redraw, effects: K.effects(id) }); return s; };
function useFont(id) { return K.use(id, states.get(id), 'fontofmagic'); }
const noFont = useFont(NONE);
yes('Use is refused to somebody without it', noFont.ok === false && noFont.why === 'Font of Magic comes with five points in Efficiency' && pushed.length === 0);
yes('and every other perk fires by itself, so it has no Use', K.use(EFF, states.get(EFF), 'secondwind').why === 'Second Wind fires by itself' &&
  K.use(EFF, states.get(EFF), 'fireball').why === 'there is no perk by that name');
yes('before it is used, the K panel shows it ready: no clock yet', JSON.stringify(K.clocks(EFF, states.get(EFF))) === '{"fontofmagic":{"ready":0}}');
yes('nothing is on the map before it starts', K.effects(EFF) === null);
const fontStart = clock.t;
const started = useFont(EFF);
yes('Use starts it', started.ok === true && started.line === 'Font of Magic: for 15 seconds, a spell costs nothing. It comes back in 24 hours.');
const free = K.effects(EFF);
yes('while it runs, every school\'s cost value is 100 more: the game\'s own free spell',
  !!free && Object.keys(free).sort().join(',') === 'AlterationMod,ConjurationMod,DestructionMod,IllusionMod,RestorationMod' &&
  Object.keys(free).every(function (k) { return free[k] === 100; }));
yes('and the panel is redrawn at once, so the client sets it', pushed.length === 1 && pushed[0].id === EFF && pushed[0].redraw === true &&
  !!pushed[0].effects && pushed[0].effects.DestructionMod === 100);
yes('its clock is on the character before it runs', JSON.parse(world.props.get(EFF).thornswoodPerks).ready.fontofmagic === fontStart + DAY);
world.actors.get(EFF).p.magicka = 0.5;
later(250); K.tick();
yes('nothing watches the magicka: the game takes none, so none is given back', world.actors.get(EFF).p.magicka === 0.5);
yes('Use again while it runs says how long is left', /^Font of Magic is running, \d+ seconds left$/.test(useFont(EFF).why));
yes('while it runs, the K panel is sent when it ends and when it is back',
  JSON.stringify(K.clocks(EFF, states.get(EFF))) === JSON.stringify({ fontofmagic: { ready: fontStart + DAY, until: fontStart + 15000 } }));
later(15000);
yes('after 15 seconds the map is redrawn without it', pushed.length === 2 && pushed[1].effects === null && K.effects(EFF) === null);
yes('and they are told it ran out', world.told.some(function (x) { return x.id === EFF && x.text === 'Font of Magic has run out.'; }));
yes('and it is a day before it comes back', useFont(EFF).why === 'Font of Magic comes back in 24 hours');
yes('and the panel is no longer told it runs', JSON.stringify(K.clocks(EFF, states.get(EFF))) === JSON.stringify({ fontofmagic: { ready: fontStart + DAY } }));
yes('the log records the one use', logged('Font of Magic') === 1);
box = makeBox();
K = box.__thornswoodPerks;
yes('a restart does not give the day back', /^Font of Magic comes back in \d+ hours$/.test(useFont(EFF).why));
later(DAY);
world.actors.get(EFF).dead = true;
yes('nobody starts it while down', useFont(EFF).why === 'not while you are down');
world.actors.get(EFF).dead = false;
yes('nor when the character block is not there to send it, and then the day is not spent',
  /cannot reach your character/.test(useFont(EFF).why) && JSON.parse(world.props.get(EFF).thornswoodPerks).ready.fontofmagic <= clock.t);

// A clock that moves by itself is sent to the K panel the moment it moves.
{
  const sent = [];
  box.__thornswoodCharacter.writeState = function (id, s, redraw) { sent.push({ id: id, redraw: redraw }); return s; };
  later(5 * 60 * 1000);
  world.actors.get(VIG).p.stamina = 0;
  K.tick();
  yes('Second Wind firing redraws the panel, so its clock is current there',
    world.actors.get(VIG).p.stamina === 1 && sent.length === 1 && sent[0].id === VIG && sent[0].redraw === true &&
    K.clocks(VIG, states.get(VIG)).secondwind.ready === clock.t + 5 * 60 * 1000);
  later(250); K.tick();
  yes('and a tick that fires nothing redraws nothing', sent.length === 1);
  delete box.__thornswoodCharacter.writeState;
}

// The character block folds it into the one map the client applies.
{
  const fold = slice(gm, '  function withPerks(actorId, base) {', '\n  }\n');
  const fbox = { g: { __thornswoodPerks: { effects: function (id) { return id === 7 ? { DestructionMod: 100 } : null; } } } };
  vm.createContext(fbox);
  vm.runInContext(fold, fbox);
  const base = { DestructionMod: 6, health: 50 };
  const got = fbox.withPerks(7, base);
  yes('withPerks adds a running perk to the totals, on top of what is there', got.DestructionMod === 106 && got.health === 50 &&
    base.DestructionMod === 6);
  yes('and hands the totals back as they were when nothing runs', fbox.withPerks(8, base) === base);
  yes('the panel\'s map is the tree, the needs, the maneuvers and the running perks together',
    gm.indexOf('effects: withManeuvers(actorId, withNeeds(actorId, P.treeApplies(s))),') > 0 &&
    gm.indexOf('view.effects = withPerks(actorId, view.effects);') > gm.indexOf('effects: withManeuvers(actorId, withNeeds(actorId, P.treeApplies(s))),'));
}

// --------------------------------------------------- Leyline Attunement --
const CLAR = actor(0xff00000b);
states.set(CLAR, filled(['clarity']));
later(3000);
world.actors.get(CLAR).p.magicka = 0.8;
K.tick();
world.actors.get(CLAR).p.magicka = 0.7;
later(250); K.tick();
// The race's 3% a second, raised by Clarity's 50%, is 4.5%; half of it for a quarter second.
yes('while magicka falls, it comes back at half the usual rate: 0.5 x 4.5% x 0.25 s',
  near(world.actors.get(CLAR).p.magicka, 0.7 + 0.5 * 0.045 * 0.25));
const steady = world.actors.get(CLAR).p.magicka;
later(250); K.tick();
yes('not while magicka is not falling: that is the game\'s own return', world.actors.get(CLAR).p.magicka === steady);
yes('the log says it once a cast', logged('Leyline Attunement') === 1);

// --------------------------------------------------- the words and Precision --
{
  const crit = K.CRIT_LINE;
  yes('the critical chance line says the game ignores it', /the game ignores it/.test(crit) && /no critical hit/.test(crit));
  const one = P.fresh(); one.tree = { precision: 1 };
  yes('a point in Precision is answered with that line', K.spendLine(one, 'precision') === crit);
  const full = filled(['precision']);
  yes('the point that fills Precision names Lethal Aim, and still says the game ignores critical chance',
    K.spendLine(full, 'precision').indexOf('Precision is full. Lethal Aim: An arrow ignores half the armour it hits.') === 0 &&
    K.spendLine(full, 'precision').indexOf(crit) > 0);
  yes('the point that fills Vitality names Cheat Death as the page says it, and no longer says it is not in the game',
    K.spendLine(filled(['vitality']), 'vitality') ===
    'Vitality is full. Cheat Death: Once a day, the blow that would kill you leaves you at 1 health.');
  yes('the point that fills Resilience names Unshakeable as the page says it, and no longer says it is not in the game',
    K.spendLine(filled(['resilience']), 'resilience') === 'Resilience is full. Unshakeable: Nothing staggers you while you block.');
  yes('so do Endurance and Agility: Tireless and the whole of Windwalker are in, on the person\'s own machine',
    K.spendLine(filled(['endurance']), 'endurance') === 'Endurance is full. Tireless: Running and swinging cost half stamina.' &&
    K.spendLine(filled(['agility']), 'agility') === 'Agility is full. Windwalker: +4 speed, and a fall deals no damage.');
  yes('the point that fills Potency names Overcharge as the page says it, and no longer says any of it is not in the game',
    K.spendLine(filled(['potency']), 'potency') === 'Potency is full. Overcharge: One spell in five deals double, or holds twice as long.' &&
    !K.PERKS.overcharge.none && !K.PERKS.overcharge.not && K.PERKS.overcharge.longer === 2);
  yes('the point that fills Burden names Pack Mule as the page says it, and no longer says it is not in the game',
    K.spendLine(filled(['burden']), 'burden') === 'Burden is full. Pack Mule: Being overloaded does not slow you.' &&
    !K.PERKS.packmule.none && !K.PERKS.packmule.not && !K.PERKS.unshakeable.none && !K.PERKS.tireless.none);
  const two = P.fresh(); two.tree = { might: 2 };
  yes('any other point says nothing more than the panel', K.spendLine(two, 'might') === '');
  states.set(AIM, filled(['precision', 'capacity']));
  yes('the K panel is sent the clocks of the waiting perks held, and nothing for the rest',
    JSON.stringify(K.clocks(AIM, states.get(AIM))) === '{"archmagesvessel":{"ready":0}}' && K.clocks(NONE, states.get(NONE)) === null);
  yes('the point that fills Efficiency says where Font of Magic is started: a button, never a command',
    K.spendLine(filled(['efficiency']), 'efficiency') ===
    'Efficiency is full. Font of Magic: Once a day, 15 seconds where a spell costs nothing. Press Use beside it on the K panel to start it.');
  yes('holds() answers any block, fresh', K.holds(VIT, 'cheatdeath') === true && K.holds(NONE, 'cheatdeath') === false &&
    K.holds(WOLF, 'cheatdeath') === false);
  const critStrings = (perks.match(/'(?:[^'\\\n]|\\.)*'/g) || []).filter(function (q) { return /critical/i.test(q); });
  yes('nothing in the block calls a hit critical: the only words about it are the line that says the game ignores it',
    critStrings.length === 2 && (critStrings[0] + critStrings[1]).indexOf('the game ignores it') > 0 &&
    (critStrings[0] + critStrings[1]).indexOf('there is no critical hit') > 0);

  const words = /^const WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const W = words ? new Function('return ' + words[1])() : [];
  const pw = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(gm);
  const PW = pw ? new Function('return ' + pw[1])() : [];
  yes('no person is given a command for a perk: /perk is not a word, not routed, and no line names it',
    W.length > 10 && PW.indexOf('/helpme') !== -1 && W.indexOf('/perk') === -1 && PW.indexOf('/perk') === -1 &&
    gm.indexOf("word === '/perk'") === -1 && !/\/perk\b/.test(perks) && !/\/perk\b/.test(panel));
  yes('/spend answers with the skill perks block\'s line', /PK\.spendLine\(st, spentIn\)/.test(gm));
  yes('the OnHit handler hands the hit to the perks before the maneuvers, and never answers false',
    onHit.indexOf('pk.hit(targetId, aggressor, source, power, bash)') > 0 &&
    onHit.indexOf('pk.hit(') < onHit.indexOf('mv.hit(') && !/\breturn\s+false\b/.test(onHit));
}

// ---------------------------------------------- the K panel's Use button --
// The server's half: /pick perk <key>, the route every press on the panel
// travels, driven out of the character block.
{
  const branch = slice(gm, "      if (what === 'perk') {", "\n        return true;\n      }\n");
  yes('/pick perk is a branch of the panel\'s own route', !!branch);
  const run = new Function('word', 'what', 'parts', 'actorId', 'profileId', 's', 'g', 'toProfile', 'writeState', 'clog',
    (branch || '') + '\n      return false;');
  function press(answer, s) {
    const out = { said: [], wrote: [] };
    const g = { __thornswoodPerks: { use: function (id, st, key) { out.asked = [id, st, key]; return answer; } } };
    const done = run('/pick', 'perk', ['/pick', 'perk', 'fontofmagic'], 0xff00000a, 10, s, g,
      function (pid, line) { out.said.push(line); }, function (id, st, redraw) { out.wrote.push({ id: id, note: st.note, redraw: redraw }); },
      function () {});
    out.done = done;
    return out;
  }
  const s1 = { tree: {}, note: null };
  const no = press({ ok: false, why: 'Font of Magic comes back in 3 hours' }, s1);
  yes('a refusal is said in the chat and under the panel, as a note about perk',
    no.done === true && no.asked[2] === 'fontofmagic' && no.said[0] === 'No: Font of Magic comes back in 3 hours.' &&
    no.wrote.length === 1 && no.wrote[0].note.about === 'perk' && no.wrote[0].note.text === 'Font of Magic comes back in 3 hours' &&
    no.wrote[0].redraw === true);
  const s2 = { tree: {}, note: { text: 'old', at: 1, about: 'perk' } };
  const go = press({ ok: true, line: 'Font of Magic: for 15 seconds, a spell costs nothing. It comes back in 24 hours.' }, s2);
  yes('an accepted Use says so, and clears the refusal before it',
    go.done === true && go.said[0] === 'Font of Magic: for 15 seconds, a spell costs nothing. It comes back in 24 hours.' &&
    go.wrote.length === 1 && go.wrote[0].note === null);
  const quiet = press({ ok: true, line: 'x' }, { tree: {}, note: null });
  yes('and with no refusal to clear writes nothing: the perks block already redrew', quiet.wrote.length === 0);
  yes('the K panel view carries the clocks, in the world', /PKV\.clocks\(actorId, s\)[\s\S]{0,120}if \(perkClocks\) \{ view\.perkClocks = perkClocks; \}/.test(gm));
}

// The panel's half: the clock beside the perk, and Use.
{
  const helpersTo = slice(panel, '  var PERK_OF = {', '\n  /* Creation is over');
  const helpers = helpersTo ? helpersTo.slice(0, helpersTo.lastIndexOf('/* Creation is over')) : null;
  yes('the panel has the perk helpers', !!helpers);
  const pbox = { mine: null, pending: [], sent: [], drawn: 0, status: '', statusKind: '', __clock: clock };
  vm.createContext(pbox);
  vm.runInContext('Date.now = function () { return __clock.t; };' +
    'function send(sec, words) { pending.push({ section: sec, words: words, at: Date.now() }); sent.push(words); }' +
    'function draw() { drawn++; }', pbox);
  vm.runInContext(helpers || '', pbox);
  const t0 = clock.t;
  pbox.mine = { perkClocks: { fontofmagic: { ready: 0 }, secondwind: { ready: t0 + 90 * 1000 }, archmagesvessel: { ready: t0 + 20 * 3600 * 1000 } } };
  yes('the clock beside a waiting perk reads back in so long, and a ready one Ready',
    vm.runInContext("perkClock('secondwind')", pbox) === 'Back in 90 seconds.' &&
    vm.runInContext("perkClock('archmagesvessel')", pbox) === 'Back in 20 hours.' &&
    vm.runInContext("perkClock('fontofmagic')", pbox) === 'Ready.' &&
    vm.runInContext("perkClock('cheatdeath')", pbox) === '');
  vm.runInContext("usePerk('fontofmagic')", pbox);
  yes('Use sends perk fontofmagic down the panel\'s route, once', pbox.sent.join('|') === 'perk fontofmagic');
  vm.runInContext("usePerk('fontofmagic')", pbox);
  yes('and a second press while that is in flight sends nothing', pbox.sent.length === 1);
  pbox.pending.length = 0;
  pbox.mine = { perkClocks: { fontofmagic: { ready: t0 + DAY, until: t0 + 15000 } } };
  yes('while it runs, the panel says so and Use is dark', vm.runInContext("perkClock('fontofmagic')", pbox) === 'Running now.' &&
    vm.runInContext("perkReady('fontofmagic')", pbox) === false);
  vm.runInContext("usePerk('fontofmagic')", pbox);
  yes('and a press then sends nothing', pbox.sent.length === 1);
  yes('the panel clears a refusal about perk, and the Use button is drawn only on a full Efficiency',
    /'perk': 'perk'/.test(panel) && /full && PERK_OF\[s\.key\] === 'fontofmagic'/.test(panel) &&
    /send\('perk', 'perk ' \+ key\)/.test(panel));
}

// ------------------------------- a restart while Font of Magic runs (#1642) --
/*
  Font of Magic's 15 seconds ride the K panel's view and end on a timer in
  memory. A restart takes the timer with it, and the server that comes up has
  nothing running, so the view it works out when the person is back (arrival
  in the character block, tests/test-1642-effects-restart.js) has no free
  spells on it. The day stays spent: that clock is on the character.
*/
{
  const RUN = actor(0xff00000c);
  states.set(RUN, filled(['efficiency']));
  box.__thornswoodCharacter.writeState = function (id, s) { return s; };
  const go = K.use(RUN, states.get(RUN), 'fontofmagic');
  yes('Font of Magic starts, with the free spells on the map', go.ok === true && !!K.effects(RUN) && K.effects(RUN).DestructionMod === 100);
  later(5000);
  world.timers.length = 0;   // the process's timers go with it
  box = makeBox();
  K = box.__thornswoodPerks;
  yes('a restart five seconds in ends it: the new server puts no free spells on any view it works out',
    K.effects(RUN) === null && !K.clocks(RUN, states.get(RUN)).fontofmagic.until);
  yes('and the day it spent is still spent', /^Font of Magic comes back in \d+ hours$/.test(K.use(RUN, states.get(RUN), 'fontofmagic').why));
}

// A queued bonus belongs to the character who caused the engine hit.
for (const field of ['pid','life','runtime']) {
  const by=actor(0xff000040+['pid','life','runtime'].indexOf(field));
  states.set(by,filled(['might']));
  heal(WOLF);
  strike(by,WOLF,0.2,SWORD,{power:true});
  world.actors.get(by)[field]=(world.actors.get(by)[field] || 0)+1;
  settle();
  yes('perk damage refuses attacker '+field+' replacement before flush',health(WOLF)===0.8);
}
for (const field of ['life','runtime']) {
  const by=actor(0xff000044+['life','runtime'].indexOf(field));
  states.set(by,filled(['might']));
  heal(WOLF); world.actors.get(WOLF).p.health=0.22;
  strike(by,WOLF,0.2,SWORD,{power:true}); settle();
  world.actors.get(by)[field]=1;
  yes('perk fallback does not name a replacement character after '+field,K.killerOf(WOLF)===0);
}

// ---------------------------- the perks that happen on the person's machine --
/*
  Unshakeable, Tireless and Windwalker's fall are the game's own, on the
  person's own machine, so the front plugin does them from the K panel's
  view: the real block between its markers, over a fake skyrimPlatform with
  the game settings Skyrim.esm sets (read out of it on 12 Oct), a hook list
  and a frame. FRONT=<path> runs it on another copy of the plugin.
*/
{
  const FR = fs.readFileSync(process.env.FRONT || path.join(root, 'game', 'plugins', 'thornswood-front.js'), 'utf8').replace(/\r/g, '');
  const block = slice(FR, '  // >>> machine perks: begin >>>', '  // <<< machine perks: end <<<');
  yes('the front plugin has the block for the perks on the person\'s own machine', !!block);
  yes('and the K panel\'s view reaches it, beside the tree and the maneuver rows',
    /treeFromView\(what\.slice\(12\)\);\n\s+maneuversFromView\(what\.slice\(12\)\);\n\s+perksFromView\(what\.slice\(12\)\);/.test(FR));
  yes('the view the server sends carries the perks held', /\n      perks: P\.perks\(s\),\n/.test(gm));

  const GAME = { fJumpFallHeightMult: 0.1, fJumpFallHeightMin: 600, fJumpFallHeightMultNPC: 0.1,
                 fSprintStaminaDrainMult: 7, fStaminaAttackWeaponBase: 20, fStaminaAttackWeaponMult: 1,
                 fStaminaBashBase: 35, fStaminaPowerBashBase: 55 };
  function front(settings, storage) {
    const g = { settings: settings, storage: storage, hooks: [], updates: [], said: [], sets: [], blocking: false, carry: [], casts: [] };
    const sp = {
      storage: storage,
      setOverEncumberedIgnored: function (formId, ignored) { g.carry.push(formId + '=' + ignored); },
      setCastDurationEvery: function (formId, every, mult) { g.casts.push(formId + ',' + every + ',' + mult); },
      hooks: { sendAnimationEvent: { add: function (h, from, to, pattern) { g.hooks.push({ h: h, from: from, to: to, pattern: pattern }); } } },
      on: function (ev, fn) { if (ev === 'update') { g.updates.push(fn); } },
      Game: {
        getGameSettingFloat: function (n) { return Object.prototype.hasOwnProperty.call(settings, n) ? settings[n] : 0; },
        setGameSettingFloat: function (n, v) { settings[n] = v; g.sets.push(n + '=' + v); },
        getPlayer: function () { return { getAnimationVariableBool: function (n) { return n === 'IsBlocking' && g.blocking; } }; }
      }
    };
    const api = new Function('sp', 'guard', 'say', 'log',
      block + '\nreturn { fromView: perksFromView };')(
      sp, function (n, fn) { return fn; }, function (t) { g.said.push(String(t)); },
      function () { g.said.push(Array.prototype.slice.call(arguments).join(' ')); });
    g.view = function (perks) { api.fromView(JSON.stringify({ v: 1, panel: perks === undefined ? { tree: {} } : { perks: perks } })); };
    g.frame = function () { g.updates.forEach(function (f) { f(); }); };
    g.stagger = function () {
      const ctx = { animEventName: 'staggerStart', selfId: 0x14 };
      g.hooks[0].h.enter(ctx);
      g.frame();
      return ctx.animEventName;
    };
    return g;
  }
  if (block) {
    const settings = Object.assign({}, GAME);
    const storage = {};
    const f = front(settings, storage);
    yes('Unshakeable hooks staggerStart on your own character and nobody else\'s',
      f.hooks.length === 1 && f.hooks[0].from === 0x14 && f.hooks[0].to === 0x14 && f.hooks[0].pattern === 'staggerStart');
    f.frame();
    yes('before any view says what is held, no game setting is touched', f.sets.length === 0);
    f.blocking = true; f.frame();
    yes('and a stagger plays, block or not', f.stagger() === 'staggerStart');

    f.view(['trollsblood', 'unshakeable']); f.frame();
    f.blocking = false; f.frame();
    yes('holding Unshakeable with the block down, a stagger plays', f.stagger() === 'staggerStart' &&
      f.said.some(function (l) { return /unshakeable: a stagger played with the block down \(1 so far\)/.test(l); }));
    f.blocking = true; f.frame();
    yes('with the block up, a stagger is refused', f.stagger() === '');
    yes('and the log says so', f.said.some(function (l) { return /unshakeable: refused a stagger while blocking \(1 so far\)/.test(l); }));
    yes('Unshakeable changes no game setting', f.sets.length === 0);
    f.view(['trollsblood']); f.frame();
    yes('once the view stops listing it, a stagger plays with the block up', f.stagger() === 'staggerStart');

    f.view(['windwalker']); f.frame();
    yes('Windwalker: the fall\'s multiplier is 0, so a fall comes to nothing', settings.fJumpFallHeightMult === 0 &&
      f.sets.join(',') === 'fJumpFallHeightMult=0');
    yes('and only your own character\'s: the NPC set and the rest of the fall stay the game\'s',
      settings.fJumpFallHeightMultNPC === 0.1 && settings.fJumpFallHeightMin === 600);
    yes('the change is a line in the log, with the game\'s own value',
      f.said.some(function (l) { return l === 'perks: fJumpFallHeightMult 0, from the game\'s 0.1'; }));
    f.view(['windwalker']); f.frame();
    yes('the same list again writes nothing', f.sets.length === 1);
    f.view(undefined); f.frame();
    yes('a view with no perks list changes nothing', f.sets.length === 1 && settings.fJumpFallHeightMult === 0);

    f.view(['windwalker', 'tireless']); f.frame();
    yes('Tireless: a sprint and a power attack cost half, from the game\'s own 7, 20 and 1',
      settings.fSprintStaminaDrainMult === 3.5 && settings.fStaminaAttackWeaponBase === 10 &&
      settings.fStaminaAttackWeaponMult === 0.5 && settings.fJumpFallHeightMult === 0);
    yes('and a shield bash and a power bash, from the game\'s own 35 and 55: a bash is a swing (Patrick, 12 Oct)',
      settings.fStaminaBashBase === 17.5 && settings.fStaminaPowerBashBase === 27.5);

    // A plugin reload in the same game: the settings are still this file's,
    // and the game's own are what the storage kept.
    const again = front(settings, storage);
    again.view(['windwalker']); again.frame();
    yes('after a reload, dropping Tireless puts the game\'s own back, not this file\'s half',
      settings.fSprintStaminaDrainMult === 7 && settings.fStaminaAttackWeaponBase === 20 &&
      settings.fStaminaAttackWeaponMult === 1 && settings.fStaminaBashBase === 35 &&
      settings.fStaminaPowerBashBase === 55 && settings.fJumpFallHeightMult === 0);
    again.view([]); again.frame();
    yes('and a character who holds none of them has every setting the game\'s own',
      Object.keys(GAME).every(function (k) { return settings[k] === GAME[k]; }));

    f.view(['windwalker', 'packmule']); f.frame();
    yes('Pack Mule: your own character goes on the client\'s list of those not held to their carry weight',
      f.carry.join(',') === '20=false,20=true' &&
      f.said.some(function (l) { return l === 'perks: Pack Mule held, so carrying past your carry weight does not make you walk'; }));
    yes('and it changes no game setting', settings.fJumpFallHeightMult === 0 && settings.fSprintStaminaDrainMult === 7);
    f.view(['packmule', 'windwalker']); f.frame();
    yes('the same perks again tell the client nothing', f.carry.length === 2);
    f.view(['windwalker']); f.frame();
    yes('dropping Pack Mule takes your character off the list, so the game\'s own walk is back',
      f.carry.join(',') === '20=false,20=true,20=false' &&
      f.said.some(function (l) { return l === 'perks: Pack Mule not held, so carrying past your carry weight makes you walk, as the game does'; }));
    const reloaded = front(settings, storage);
    reloaded.view(['windwalker']); reloaded.frame();
    yes('a reloaded plugin tells the client at its first view, whatever an earlier copy left', reloaded.carry.join(',') === '20=false');

    const oc = front(Object.assign({}, GAME), {});
    oc.view(['windwalker']); oc.frame();
    yes('without Overcharge, your own character\'s casts have no rule: every spell holds its own time',
      oc.casts.join(';') === '20,0,1' &&
      oc.said.some(function (l) { return l === 'perks: Overcharge not held, so every spell of yours holds its own time'; }));
    oc.view(['windwalker', 'overcharge']); oc.frame();
    yes('Overcharge: every fifth cast of yours that holds holds twice as long, the gamemode\'s numbers',
      oc.casts.join(';') === '20,0,1;20,5,2' && K.PERKS.overcharge.inEvery === 5 && K.PERKS.overcharge.longer === 2 &&
      oc.said.some(function (l) { return l === 'perks: Overcharge held, so every 5th spell of yours that holds holds 2 times as long'; }));
    oc.view(['overcharge', 'windwalker']); oc.frame();
    yes('the same perks again tell the client nothing, so its count is not started again', oc.casts.length === 2);
    oc.view(['windwalker']); oc.frame();
    yes('dropping Overcharge takes the rule off', oc.casts.join(';') === '20,0,1;20,5,2;20,0,1');
    yes('and it changes no game setting and touches no carry weight', oc.carry.join(',') === '20=false' &&
      oc.sets.join(',') === 'fJumpFallHeightMult=0');

    const keys = /const PERK_SETTINGS = \{([\s\S]*?)\n  \};/.exec(block);
    yes('the page\'s table of game settings is the block\'s, at the same share',
      !!keys && /\| Windwalker, the fall \| `fJumpFallHeightMult` \| 0\.1 \| 0, so a fall comes to nothing \|/.test(page) &&
      /\| Tireless, a sprint \| `fSprintStaminaDrainMult` \| 7 \| half \|/.test(page) &&
      /\| Tireless, a power attack \| `fStaminaAttackWeaponBase` and `fStaminaAttackWeaponMult` \| 20 and 1 \| half of each \|/.test(page) &&
      /\| Tireless, a shield bash \| `fStaminaBashBase` and `fStaminaPowerBashBase` \| 35 and 55 \| half of each \|/.test(page) &&
      /windwalker: \{ fJumpFallHeightMult: 0 \}/.test(keys[1]) &&
      /tireless: \{\s*fSprintStaminaDrainMult: 0\.5, fStaminaAttackWeaponBase: 0\.5, fStaminaAttackWeaponMult: 0\.5,\s*fStaminaBashBase: 0\.5, fStaminaPowerBashBase: 0\.5\s*\}/.test(keys[1]) &&
      !/packmule/.test(keys[1]));
  }
  yes('the K panel says the four are in, and the whole of Overcharge',
    panel.indexOf("perk: 'Unshakeable: nothing staggers you while you block.' }") !== -1 &&
    panel.indexOf("perk: 'Tireless: running and swinging cost half stamina.' }") !== -1 &&
    panel.indexOf("perk: 'Windwalker: +4 speed, and a fall deals no damage.' }") !== -1 &&
    panel.indexOf("perk: 'Pack Mule: being overloaded does not slow you.' }") !== -1 &&
    panel.indexOf("perk: 'Overcharge: one spell in five deals double, or holds twice as long.' }") !== -1 &&
    !/not in the game/.test(panel.slice(panel.indexOf("key: 'potency'"), panel.indexOf("key: 'ward'"))));
  const where = {};
  page.split('\n').forEach(function (line) {
    const c = line.split('|').slice(1, -1).map(function (x) { return x.trim(); });
    if (c.length === 3 && Object.prototype.hasOwnProperty.call(K.PERKS, c[0].toLowerCase().replace(/[^a-z]/g, ''))) { where[c[0]] = c; }
  });
  yes('the page\'s "Where this is" says Unshakeable, Tireless, Windwalker and Pack Mule fire',
    /^Yes/.test(where.Unshakeable[1]) && where.Unshakeable[2] === '' && /^Yes/.test(where.Tireless[1]) && where.Tireless[2] === '' &&
    /^Yes/.test(where.Windwalker[1]) && where.Windwalker[2] === '' && /^Yes, on your own machine/.test(where['Pack Mule'][1]) && where['Pack Mule'][2] === '');
  yes('and that both halves of Overcharge fire, with nothing left out',
    /^Yes, both halves/.test(where.Overcharge[1]) && /holds twice as long/.test(where.Overcharge[1]) && where.Overcharge[2] === '');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
