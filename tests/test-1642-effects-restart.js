// test-1642-effects-restart.js
//
// #1642. An effect the server runs for a few seconds rides the K panel's
// view, and that view is kept on the character: a warrior's Rush (+4 speed),
// Font of Magic (100 on each school's cost value) and restoration strain.
// Each ends on a timer in memory, which a restart loses. This drives the real
// blocks out of gamemode.js over one store, restarts the server over the same
// store, and plays the client's half with the client's own code: the
// property's updateOwner script, and the skill tree hand lifted out of
// thornswood-front.js, setting a fake character's values.
//
// Done when a restart while those run leaves nobody with the speed, the free
// spells or the strain once they are back in the world.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(root, 'game', 'gamemode.js'), 'utf8')).replace(/\r/g, '');
const front = fs.readFileSync(path.join(root, 'game', 'plugins', 'thornswood-front.js'), 'utf8').replace(/\r/g, '');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(src, a, b) {
  const i = src.indexOf(a);
  const j = i < 0 ? -1 : src.indexOf(b, i + a.length);
  return (i >= 0 && j >= 0) ? src.slice(i, j + b.length) : null;
}

const RULES = between(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const PERKS = between(gm, '// ==== thornswood skill perks ====', '// ==== end thornswood skill perks ====');
const MANEUVERS = between(gm, '// ==== thornswood warrior maneuvers ====', '// ==== end thornswood warrior maneuvers ====');
const TOMES = between(gm, '// ==== thornswood spell tomes ====', '// ==== end thornswood spell tomes ====');
const COLLEGE = between(gm, '// ==== thornswood college ====', '// ==== end thornswood college ====');
const SPELLON = between(gm, 'function spellOn(actorId, spellDesc, on) {', '\n}\n');
const TREE = between(front, '// >>> tree apply: begin >>>', '// <<< tree apply: end <<<');
// Ends at the settle wait. It used to end at the dressIfBare watch, which came
// out with the other dress asks when a new character began to be dressed where
// it is made (#1560, #1604).
const FIRST_SIGHT = between(gm, '    if (!firstSeen.has(actorId)) {', '    if (now - firstSeen.get(actorId) < SETTLE_MS) {');
const ok = RULES && CHARACTER && PERKS && MANEUVERS && TOMES && COLLEGE && SPELLON && TREE && FIRST_SIGHT;
yes('the rules, character, skill perks, maneuvers, tomes and college blocks, the chargen tick\'s first sight ' +
    'and the client\'s skill tree hand are where this reads them', !!ok);
if (!ok) { done(); }

// ------------------------------------------------------- a fake load order --
const PLUG = ['Skyrim.esm', 'Update.esm', 'Dawnguard.esm', 'HearthFires.esm', 'Dragonborn.esm'];
function idOf(desc) {
  const at = String(desc).indexOf(':');
  if (at < 0) { return parseInt(String(desc), 16) >>> 0; }
  const i = PLUG.indexOf(String(desc).slice(at + 1));
  return i < 0 ? 0 : (i * 0x1000000 + parseInt(String(desc).slice(0, at), 16)) >>> 0;
}
function descOf(id) {
  if (id >= 0xff000000) { return (id >>> 0).toString(16); }
  return (id & 0xffffff).toString(16) + ':' + PLUG[Math.floor(id / 0x1000000)];
}
function put32(b, at, v) { v = v >>> 0; b[at] = v & 255; b[at + 1] = (v >>> 8) & 255; b[at + 2] = (v >>> 16) & 255; b[at + 3] = (v >>> 24) & 255; return b; }
function text(s) { const out = []; for (let i = 0; i < s.length; i++) { out.push(s.charCodeAt(i)); } out.push(0); return out; }

/*
  The records the server reads: a race whose DATA starts stamina at 50 and a
  base whose ACBS adds 50, so 100, the way a person starts (the maneuvers
  block's engineStamina), and Healing, a restoration spell.
*/
const RACE = '13746:Skyrim.esm';
const RECORDS = {};
{
  const race = Buffer.alloc(104); race.writeFloatLE(50, 44);
  const npc = Buffer.alloc(24); npc.writeInt16LE(50, 6);
  RECORDS[idOf(RACE)] = { type: 'RACE', fields: [{ type: 'DATA', data: Array.from(race) }] };
  RECORDS[idOf('7:Skyrim.esm')] = { type: 'NPC_', fields: [{ type: 'ACBS', data: Array.from(npc) }] };
  const mgef = idOf('5f0000:Skyrim.esm');
  const data = new Array(0x48).fill(0);
  put32(data, 12, 22);   // Restoration
  RECORDS[mgef] = { type: 'MGEF', editorId: 'HealEffect', fields: [{ type: 'DATA', data: data }] };
  const spit = new Array(36).fill(0);
  RECORDS[idOf('12fcc:Skyrim.esm')] = { type: 'SPEL', editorId: 'Healing',
    fields: [{ type: 'FULL', data: text('Healing') }, { type: 'SPIT', data: spit },
             { type: 'EFID', data: put32([0, 0, 0, 0], 0, mgef) }] };
}
const HEALING = '12fcc:Skyrim.esm';

// ------------------------------------------------------------ the store --
/* Every actor's properties, as the engine keeps them across a restart. */
const store = {};
/* The client of each actor that has one: the property's script runs on every write. */
const clients = {};
let charProp = '';

/* One server process over the store. A second one over the same store is a restart. */
function server(t) {
  let clock = t;
  const timers = [];
  const said = [];
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return Object.keys(clients).map(Number); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    set: function (id, key, value) {
      (store[id] = store[id] || {})[key] = JSON.stringify(value);
      if (key === charProp && clients[id]) { clients[id].frame(); }
    },
    getIdFromDesc: idOf,
    getDescFromId: descOf,
    lookupEspmRecordById: function (id) {
      const r = RECORDS[id];
      return r ? { record: r, toGlobalRecordId: function (local) { return local; } } : null;
    },
    callPapyrusFunction: function (kind, cls, fn) {
      if (fn === 'GetRace') { return { type: 'espm', desc: RACE }; }
      return undefined;
    }
  };
  const FakeDate = function () { return new Date(clock); };
  FakeDate.now = function () { return clock; };
  const ctx = {
    mp: mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: FakeDate,
    Buffer: Buffer, isFinite: isFinite, parseInt: parseInt, Infinity: Infinity,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    setTimeout: function (fn, ms) { timers.push({ fn: fn, at: clock + (ms || 0) }); return timers.length; },
    notify: function () { },
    say: function (id, m) { said.push({ id: id, text: m }); },
    log: function () { },
    giveTool: function () { return null; },
    INSTRUMENT_SPELL: '9456:PlayFluteLuteDrum.esp'
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SPELLON, ctx, { filename: 'spellOn' });
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  vm.runInContext(PERKS, ctx, { filename: 'gamemode.js perks' });
  vm.runInContext(MANEUVERS, ctx, { filename: 'gamemode.js maneuvers' });
  vm.runInContext(TOMES, ctx, { filename: 'gamemode.js tomes' });
  vm.runInContext(COLLEGE, ctx, { filename: 'gamemode.js college' });
  const C = ctx.__thornswoodCharacter;
  charProp = C.PROPERTY;
  return {
    ctx: ctx, C: C, P: ctx.__thornswoodProgression, PK: ctx.__thornswoodPerks,
    M: ctx.__thornswoodManeuvers, CO: ctx.__thornswoodCollege, said: said,
    now: function () { return clock; },
    /* Time passes on this server, and every timer due by then runs. */
    run: function (ms) {
      clock += ms;
      for (;;) {
        const due = timers.filter(function (x) { return !x.done && x.at <= clock; });
        if (!due.length) { break; }
        due.forEach(function (x) { x.done = true; x.fn(); });
      }
    },
    /* A press on the K panel reaches the server as this line. */
    pick: function (id, words) {
      const parts = ('/pick ' + words).split(/\s+/);
      C.command('/pick', parts, id, Number(mp.get(id, 'profileId')) || 0, function () { });
    }
  };
}

/*
  A warrior, a Berserker, so Rush is theirs, with Efficiency full, so Font
  of Magic is theirs, standing in the world with full bars.
*/
function person(srv, id, pid) {
  store[id] = store[id] || {};
  store[id].profileId = JSON.stringify(pid);
  store[id].appearance = JSON.stringify({ name: 'P' + pid });
  store[id].percentages = JSON.stringify({ health: 1, magicka: 1, stamina: 1 });
  store[id].baseDesc = JSON.stringify('7:Skyrim.esm');
  store[id].isOnline = 'true';
  let s = srv.P.fresh();
  const r = srv.P.pickProfession(s, 'warrior', 'berserker');
  if (r.ok) { s = r.state; }
  s.tree = Object.assign({}, s.tree, { efficiency: 5 });
  srv.C.writeState(id, s);
  return id;
}
function stored(id) { return JSON.parse(store[id][charProp]); }
/* The character block's arrival, as the chargen tick's first sight calls it. */
function arrive(srv, id) { return (srv.C && typeof srv.C.arrival === 'function') ? srv.C.arrival(id) : undefined; }

// ------------------------------------------------------------ the client --
/* What a value of the game reads before anything sets it. */
const NATURAL = { speedmult: 100, staminaratemult: 100, healratemult: 100, stamina: 100, health: 100, magicka: 100 };
const SCRIPT = (function () { const s = server(1); return s.C.updateOwnerScript(); })();

/*
  One person's game: the property's own script (ctx.state lives as long as
  the game does, as skymp5-client makes it), a page that has the K panel or
  not yet, and thornswood-front.js's skill tree hand setting a character.
*/
function client(id, mounted) {
  const c = { id: id, drawn: [], base: Object.assign({}, NATURAL), update: null };
  const page = {};
  page.window = page;
  page.skyrimPlatform = {
    sendMessage: function (name, msg) {
      if (name === 'thornswood-front' && String(msg).indexOf('skills:view ') === 0) { hand.treeFromView(String(msg).slice(12)); }
    }
  };
  vm.createContext(page);
  const pc = {
    getBaseActorValue: function (name) {
      const k = String(name).toLowerCase();
      return Object.prototype.hasOwnProperty.call(c.base, k) ? c.base[k] : 0;
    },
    setActorValue: function (name, v) { c.base[String(name).toLowerCase()] = v; }
  };
  const hand = {
    console: { log: function () { } },
    T: { js: function (src) { vm.runInContext(src, page); } },
    log: function () { },
    guard: function (name, fn) { return fn; },
    sp: {
      on: function (ev, fn) { if (ev === 'update') { c.update = fn; } },
      Game: { getPlayer: function () { return pc; } }
    }
  };
  hand.globalThis = hand;
  hand.__thornswoodInWorld = true;
  vm.createContext(hand);
  vm.runInContext(TREE, hand, { filename: 'thornswood-front.js tree apply' });
  const script = new Function('ctx', SCRIPT);
  const ctx = { value: undefined, state: {}, sp: { browser: { executeJavaScript: function (src) { vm.runInContext(src, page); } } } };
  /* The panel is in: what 'skills:ready' does in thornswood-front.js before it asks /pick refresh. */
  c.mount = function () {
    page.thornswoodSkills = {
      setData: function (table, got) { c.drawn.push(got); },
      open: function () { }
    };
    hand.treeForwardInstall();
  };
  /* A frame: the script over what is on the character now, then the hand's update. */
  c.frame = function () {
    const raw = store[id] && store[id][charProp];
    ctx.value = raw ? JSON.parse(raw) : undefined;
    script(ctx);
    c.update();
  };
  c.value = function (name) { return pc.getBaseActorValue(name); };
  c.script = script;
  if (mounted) { c.mount(); }
  clients[id] = c;
  c.frame();
  return c;
}

/* What the tree alone puts on a value, from the server's own rules. */
function treeOnly(srv, id, name) {
  const map = srv.P.treeApplies(srv.C.stateOf(id));
  return Number(map[name] || 0);
}
const SCHOOLS = ['AlterationMod', 'ConjurationMod', 'DestructionMod', 'IllusionMod', 'RestorationMod'];

const T0 = 1800000000000;
const W = 0xff000011, F = 0xff000012, R = 0xff000013, MAKING = 0xff000014;

// ---------------------------------- A. a restart, the game still connected --
let srv = server(T0);
person(srv, W, 11);
const w = client(W, true);
yes('A1 the client draws the view and sets the tree: speed is the tree\'s, no school is free',
  w.drawn.length >= 1 && w.value('speedMult') === 100 + treeOnly(srv, W, 'speedMult') &&
  SCHOOLS.every(function (k) { return w.value(k) === treeOnly(srv, W, k); }));

yes('A2 Rush starts', srv.M.use(W, 'rush') === 'Rush: +4 speed for 5 seconds.');
const font = srv.PK.use(W, srv.C.stateOf(W), 'fontofmagic');
yes('A2 Font of Magic starts', font.ok === true);
for (let i = 0; i < 4; i++) { srv.CO.cast(W, { desc: HEALING }); }
yes('A2 and four restoration spells strain them', !!srv.CO.effects(W) && srv.CO.effects(W).RestorationMod === -1000000);
yes('A3 the client has +4 speed on',
  w.value('speedMult') === 100 + treeOnly(srv, W, 'speedMult') + 4);
yes('A3 and every school\'s cost value 100 more, restoration also shut by the strain',
  ['AlterationMod', 'ConjurationMod', 'DestructionMod', 'IllusionMod'].every(function (k) {
    return w.value(k) === treeOnly(srv, W, k) + 100;
  }) && w.value('RestorationMod') === treeOnly(srv, W, 'RestorationMod') + 100 - 1000000);
yes('A3 and stamina and health come back 20 slower',
  w.value('staminaRateMult') === 100 + treeOnly(srv, W, 'staminaRateMult') - 20 &&
  w.value('healRateMult') === 100 + treeOnly(srv, W, 'healRateMult') - 20);

// Two seconds in, the server restarts. Its timers go with it.
srv.run(2000);
const before = stored(W);
srv = server(T0 + 60000);
yes('A4 measured: the view kept on the character still carries all three',
  before.panel.effects.speedMult === treeOnly(srv, W, 'speedMult') + 4 &&
  before.panel.effects.DestructionMod === treeOnly(srv, W, 'DestructionMod') + 100 &&
  before.panel.effects.RestorationMod === treeOnly(srv, W, 'RestorationMod') + 100 - 1000000);
yes('A4 and nothing runs on the new server: the three ended with the old one',
  srv.M.effects(W) === null && srv.PK.effects(W) === null && srv.CO.effects(W) === null);
const drawnBefore = w.drawn.length;
w.frame();
yes('A5 the game reconnects to the same view and draws nothing new, so the speed is still on it',
  w.drawn.length === drawnBefore && w.value('speedMult') === 100 + treeOnly(srv, W, 'speedMult') + 4);

arrive(srv, W);
yes('A6 arrival sends the view worked out now, and the client draws it', w.drawn.length === drawnBefore + 1);
yes('A6 the speed is the tree\'s again', w.value('speedMult') === 100 + treeOnly(srv, W, 'speedMult'));
yes('A6 no school is free and restoration is not shut',
  SCHOOLS.every(function (k) { return w.value(k) === treeOnly(srv, W, k); }));
yes('A6 stamina and health come back at the usual rate',
  w.value('staminaRateMult') === 100 + treeOnly(srv, W, 'staminaRateMult') &&
  w.value('healRateMult') === 100 + treeOnly(srv, W, 'healRateMult'));
const after = stored(W);
yes('A7 and the view kept on the character carries none of the three now',
  after.panel.effects.speedMult === (treeOnly(srv, W, 'speedMult') || undefined) &&
  after.panel.effects.DestructionMod === (treeOnly(srv, W, 'DestructionMod') || undefined) &&
  !after.panel.perkClocks.fontofmagic.until);
yes('A7 the day Font of Magic spent is still spent', /^Font of Magic comes back in \d+ hours$/.test(
  (srv.PK.use(W, srv.C.stateOf(W), 'fontofmagic') || {}).why || ''));
yes('A7 arrival is not a redraw, so it carries no ask time', after.asked === undefined && after.panel.asked === undefined);

// ------------------------------------- B. a restart, the game started again --
srv = server(T0 + 120000);
person(srv, F, 12);
srv.M.use(F, 'rush');
srv.PK.use(F, srv.C.stateOf(F), 'fontofmagic');
srv.run(1000);
yes('B1 Rush and Font of Magic are on the view kept for somebody who then quits',
  stored(F).panel.effects.speedMult === treeOnly(srv, F, 'speedMult') + 4);
srv = server(T0 + 240000);
const f = client(F, false);
yes('B2 the game starts afresh and reads the kept view before the K panel is in: nothing drawn, nothing set',
  f.drawn.length === 0 && f.value('speedMult') === 100);
arrive(srv, F);
const arrivedView = stored(F);
yes('B3 arrival writes the view worked out now, still before the panel is in', f.drawn.length === 0 &&
  arrivedView.panel.effects.speedMult === (treeOnly(srv, F, 'speedMult') || undefined));
f.mount();
srv.pick(F, 'refresh');
const answer = stored(F);
yes('B4 the panel is in and asks: the answer carries when it was asked, beside the panel (#1730)',
  answer.asked === srv.now() && answer.panel.asked === undefined);
{
  const a = JSON.parse(JSON.stringify(arrivedView)), b = JSON.parse(JSON.stringify(answer));
  delete b.asked;
  yes('B4 and apart from that it is the same view arrival sent', JSON.stringify(a) === JSON.stringify(b));
  // The trap: the client's script holds back a value it last handed, even to a page with no panel.
  const st = {};
  let handed = 0;
  const probe = { state: st, sp: { browser: { executeJavaScript: function () { handed++; } } } };
  probe.value = a; f.script(probe);
  probe.value = b; f.script(probe);
  yes('B4 without the time the script would hold that answer back as drawn already', handed === 1);
}
yes('B5 the answer is drawn', f.drawn.length === 1);
yes('B5 and the tree is set with no Rush and no free spells on it',
  f.value('speedMult') === 100 + treeOnly(srv, F, 'speedMult') &&
  SCHOOLS.every(function (k) { return f.value(k) === treeOnly(srv, F, k); }));
srv.run(1000);
srv.pick(F, 'refresh');
yes('B6 a second ask, the panel opened again, is drawn too', f.drawn.length === 2);

// ------------------------------------------ C. arrival with no restart --
person(srv, R, 13);
const r = client(R, true);
srv.M.use(R, 'rush');
yes('C1 Rush is on', r.value('speedMult') === 100 + treeOnly(srv, R, 'speedMult') + 4);
const drawnC = r.drawn.length;
arrive(srv, R);
yes('C2 arrival while it runs keeps it: the view is worked out now, and it is running now',
  r.value('speedMult') === 100 + treeOnly(srv, R, 'speedMult') + 4 && srv.M.effects(R).speedMult === 4);
yes('C2 and the view is the one this server last sent, so nothing is sent again',
  r.drawn.length === drawnC && stored(R).panel === undefined);
srv.run(5100);
yes('C3 its own end still takes it off', r.value('speedMult') === 100 + treeOnly(srv, R, 'speedMult') &&
  stored(R).panel.effects.speedMult === (treeOnly(srv, R, 'speedMult') || undefined));

// ------------------------------------------------ D. somebody being made --
person(srv, MAKING, 14);
srv.ctx.__thornswoodChargen = { isChoosing: function (id) { return id === MAKING; } };
const kept = store[MAKING][charProp];
yes('D1 somebody still in creation is left to the hall: arrival writes nothing',
  arrive(srv, MAKING) === null && store[MAKING][charProp] === kept);
delete srv.ctx.__thornswoodChargen;

// ------------------------------------------ E. what else runs for a while --
{
  const t = srv.now();
  srv.M.state.on[R] = { set: t + 8000, plant: t + 8000, wall: t + 10000, heavy: t + 8000, 'break': t + 8000, wreck: t + 8000,
                        cover: { until: t + 8000, who: W } };
  yes('E1 Set, Plant, Cover, Wall, Heavy, Break and Wreck put nothing on the client\'s map: the server applies them ' +
      'at the hit, so a restart that clears them leaves nothing on anybody', srv.M.effects(R) === null);
  delete srv.M.state.on[R];
}

// ------------------------------------------------------------ the wiring --
{
  const at = FIRST_SIGHT.indexOf('c.arrival(actorId)');
  // The login ask that put worn clothes back on is gone (#1560), so arrival
  // comes after the spells, and no clothes ask is left in front of it.
  yes('F1 the chargen tick\'s first sight of somebody calls arrival, after the spells',
    at > 0 && at > FIRST_SIGHT.indexOf('c.grantKnown(actorId)') && FIRST_SIGHT.indexOf('wearWhatIsWorn') < 0);
  yes('F2 the character block hands arrival out', /beginCreation: beginCreation, arrival: arrival,/.test(CHARACTER));
  yes('F3 the refresh answers as a redraw, and a redraw, and nothing else, adds the time (#1730)',
    /if \(what === 'refresh'\) \{[\s\S]{0,300}writeState\(actorId, s, true\);/.test(CHARACTER) &&
    (CHARACTER.match(/\.asked = /g) || []).length === 1 && /if \(redraw\) \{ s\.asked = askedNow\(\); \}/.test(CHARACTER));
  yes('F4 arrival is not a redraw, so a view this server already sent is not sent again',
    // 900, not 300: withered's end is armed first (#1387) and the game is
    // taught what the character knows of alchemy (#3134), and the view is
    // still written by writeState, which sends only a view not sent before.
    /function arrival\(actorId\) \{[\s\S]{0,900}return writeState\(actorId, stateOf\(actorId\)\);/.test(CHARACTER));
  yes('F5 nothing here watches for a stale effect: no timer in the character block reads one',
    !/setInterval\(/.test(CHARACTER) && !/setTimeout\(/.test(between(CHARACTER, '  function arrival(actorId) {', '\n  }\n')));
}

done();
