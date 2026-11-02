// test-1730-forced-panel.js
//
// #1730. A redraw the server sent with the same K panel view as the one
// before it never reached the page. The client's script (updateOwnerScript)
// runs every frame, so it cannot tell a second write of the same value from
// the next frame, and it draws only a value unlike the one it last handed the
// page. The creation hall's reminder leans on a redraw reaching the page: it
// is the same view every time, so the panel re-opened for somebody who had
// closed it while choosing only when something else on it had moved.
//
// This lifts the real chargen tick and every step it calls, the chargen
// block's handle (__thornswoodChargen), the rules and the character block,
// and runs them over one store at the real tick. The client's half is played
// the way skymp5-client plays it (gamemodeUpdateService.ts and remoteServer.ts
// in the fork): a write replaces the value with a fresh one, and the
// property's own script runs every frame over whatever is there. The page is
// the K panel's contract in thornswood-skills.js: setData takes the value,
// open() does nothing when the panel is up and otherwise asks for the view
// ('skills:refresh', which the front sends as /pick refresh), and Escape or K
// while creating sends '/pick later' and puts it down.
//
// Done when the reminder re-opens the panel for somebody who closed it while
// choosing. GM points it at another copy of gamemode.js, which is how it was
// shown to fail on the code before the change.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).replace(/\r/g, '');

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
function fnOf(head) {
  const a = gm.indexOf(head);
  const b = a < 0 ? -1 : gm.indexOf('\n}\n', a);
  return (a >= 0 && b >= 0) ? gm.slice(a, b + 2) : null;
}
function num(name) {
  const m = new RegExp('\nconst ' + name + ' = (\\d+);').exec(gm);
  return m ? Number(m[1]) : null;
}

// ------------------------------------------------------- lifted by text --
const RULES = between(gm, '// ==== thornswood progression ====', '// ==== end thornswood progression ====');
const CHARACTER = between(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const SPELLON = between(gm, 'function spellOn(actorId, spellDesc, on) {', '\n}\n');
const HANDLE = between(gm, '\nglobalThis.__thornswoodChargen = {', '\n};\n');
const FNS = {
  faceMark: fnOf('function faceMark(a) {'),
  hasStoredAppearance: fnOf('function hasStoredAppearance(a) {'),
  publishedForOthers: fnOf('function publishedForOthers(actorId) {'),
  chargenOf: fnOf('function chargenOf(actorId) {'),
  setChargen: fnOf('function setChargen(actorId, state) {'),
  tellOnce: fnOf('function tellOnce(actorId, step, text) {'),
  townsForPanel: fnOf('function townsForPanel() {'),
  sendToHall: fnOf('function sendToHall(actorId) {'),
  beginAppearance: fnOf('function beginAppearance(actorId) {'),
  giveShift: fnOf('function giveShift(actorId) {'),
  beginChoosing: fnOf('function beginChoosing(actorId, state, why) {'),
  openCreation: fnOf('function openCreation(actorId) {'),
  arriveAt: fnOf('function arriveAt(actorId, townKey) {'),
  chargenTick: fnOf('function chargenTick() {')
};
const NUMS = ['CHARGEN_TICK_MS', 'SETTLE_MS', 'NUDGE_MS', 'MOVED_ENOUGH_MS', 'MOVED_UNITS',
  'MOVED_DEGREES', 'CHOOSE_REMIND_MS', 'CHOOSE_LATER_MS', 'GIVEUP_MS', 'FACE_SEEN_MS', 'FACE_CAP_MS'];
const K = {};
for (const n of NUMS) { K[n] = num(n); }
const PROP = (/\nconst CHARGEN_PROPERTY = '([^']+)';/.exec(gm) || [])[1] || null;
const HALL_SRC = (/\nconst HALL = (\{[\s\S]*?\n\});/.exec(gm) || [])[1] || null;
let CHARGEN = null;
{
  const m = /\nconst CHARGEN = (\{.*\});\n/.exec(gm);
  try { CHARGEN = m ? JSON.parse(m[1]) : null; } catch (e) { CHARGEN = null; }
}
const missing = Object.keys(FNS).filter(function (k) { return !FNS[k]; })
  .concat(NUMS.filter(function (n) { return K[n] === null; }))
  .concat(RULES ? [] : ['progression']).concat(CHARACTER ? [] : ['character'])
  .concat(SPELLON ? [] : ['spellOn']).concat(HANDLE ? [] : ['__thornswoodChargen'])
  .concat(PROP ? [] : ['CHARGEN_PROPERTY']).concat(HALL_SRC ? [] : ['HALL'])
  .concat(CHARGEN ? [] : ['CHARGEN']);
yes('the chargen tick, its steps, its handle, the rules and the character block are where this reads them' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
if (missing.length) { done(); }

const HALL = new Function('return ' + HALL_SRC)();
const PASSAGES = CHARGEN.towns;
const SHIFT = CHARGEN.shift;
const TOWN_BY_KEY = {};
for (const desc in PASSAGES) { TOWN_BY_KEY[PASSAGES[desc].key] = desc; }
const TICK = K.CHARGEN_TICK_MS;

// ------------------------------------------------------------ the store --
/* Every actor's properties, as the engine keeps them across a restart. */
const store = {};
/* The game of each actor that has one. */
const clients = {};
let charProp = '';

/*
  One server process over the store: the chargen block, the rules and the
  character block in one context, the way gamemode.js puts them in one file.
  A second one over the same store is a restart.
*/
function server(t0) {
  const S = { clock: t0, online: [], said: [], lines: [] };
  const ids = {};
  function idOf(desc) {
    if (!desc) { return 0; }
    if (!ids[desc]) { ids[desc] = 0x1000 + Object.keys(ids).length; }
    return ids[desc];
  }
  const mp = {
    makeProperty: function () { },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return S.online.slice(); }
      const p = store[id] || {};
      return Object.prototype.hasOwnProperty.call(p, key) ? JSON.parse(p[key]) : undefined;
    },
    // The engine sends every write to the owner, with no comparison
    // (CustomPropertyBinding::Set in the fork).
    set: function (id, key, value) {
      (store[id] = store[id] || {})[key] = JSON.stringify(value);
      if (key === charProp && clients[id]) { clients[id].receive(store[id][key]); }
    },
    setRaceMenuOpen: function () { },
    getIdFromDesc: idOf,
    getDescFromId: function (id) { return (id >>> 0).toString(16); },
    lookupEspmRecordById: function () { return null; },
    callPapyrusFunction: function () { return undefined; }
  };
  const FakeDate = function () { return new Date(S.clock); };
  FakeDate.now = function () { return S.clock; };
  const ctx = {
    mp: mp, Date: FakeDate, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number,
    Math: Math, Buffer: Buffer, isFinite: isFinite, parseInt: parseInt, Infinity: Infinity,
    console: { log: function () { }, error: function () { } },
    guard: function (name, fn) { return fn; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    setTimeout: function () { return 1; },
    HALL: HALL, SHIFT: SHIFT, PASSAGES: PASSAGES, TOWN_BY_KEY: TOWN_BY_KEY,
    CHARGEN_PROPERTY: PROP, CHARGEN_ENABLED: true,
    idOf: idOf,
    closeRaceMenu: function () { }, resolveArrival: function () { return null; },
    say: function (id, text) { S.said.push({ id: id, text: String(text) }); },
    notify: function () { },
    log: function () { },
    giveTool: function () { return null; },
    INSTRUMENT_SPELL: '9456:PlayFluteLuteDrum.esp'
  };
  for (const n of NUMS) { ctx[n] = K[n]; }
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext('const firstSeen = new Map();\n' +
    Object.keys(FNS).map(function (k) { return FNS[k]; }).join('\n') + HANDLE, ctx, { filename: 'gamemode.js chargen' });
  vm.runInContext(SPELLON, ctx, { filename: 'gamemode.js spellOn' });
  vm.runInContext(RULES, ctx, { filename: 'gamemode.js rules' });
  vm.runInContext(CHARACTER, ctx, { filename: 'gamemode.js character' });
  const C = ctx.__thornswoodCharacter;
  charProp = C.PROPERTY;
  S.ctx = ctx;
  S.C = C;
  S.chargen = ctx.__thornswoodChargen;
  /* A line the page sent through the front reaches the server as chat. */
  S.chat = function (id, line) { S.lines.push({ id: id, line: line }); };
  /*
    One tick at the real interval: the lines that came in since the last one,
    the chargen tick, and three frames of every game.
  */
  S.step = function () {
    const lines = S.lines.splice(0);
    for (const l of lines) {
      const parts = l.line.split(/\s+/);
      C.command(parts[0], parts, l.id, Number(mp.get(l.id, 'profileId')) || 0, function () { });
    }
    S.clock += TICK;
    vm.runInContext('chargenTick()', ctx);
    for (const id in clients) { clients[id].frames(3); }
  };
  S.run = function (n) { for (let i = 0; i < n; i++) { S.step(); } };
  S.runFor = function (ms) { S.run(Math.ceil(ms / TICK)); };
  S.join = function (id, desc, pid) {
    mp.set(id, 'worldOrCellDesc', desc);
    mp.set(id, 'profileId', pid);
    mp.set(id, 'inventory', { entries: [] });
    mp.set(id, 'pos', [0, 0, 0]);
    mp.set(id, 'angle', [0, 0, 0]);
    if (S.online.indexOf(id) < 0) { S.online.push(id); }
  };
  S.face = function (id) { mp.set(id, 'appearance', { raceId: 7, name: 'made' }); };
  S.stage = function (id) { return (S.chargen.isChoosing(id) ? 'choosing' : ((mp.get(id, PROP) || {}).stage)); };
  S.mp = mp;
  return S;
}
function stored(id) { return JSON.parse(store[id][charProp]); }

// ------------------------------------------------------------ the client --
/*
  One person's game. skymp5-client parses each property write into a fresh
  value on the character's model (remoteServer.ts, onUpdatePropertyMessage),
  and calls the property's script with whatever value is there on every
  frame (gamemodeUpdateService.ts, onUpdate). ctx.state lives as long as the
  game does. The page is the K panel, in by the time the face is done.
*/
function client(srv, id) {
  const script = new Function('ctx', srv.C.updateOwnerScript());
  const c = { id: id, value: undefined, handed: 0, srv: srv };
  const page = { up: false, opened: 0, got: [] };
  const win = {};
  win.window = win;
  vm.createContext(win);
  function tell(what, extra) {
    // thornswood-front.js: 'skills:refresh' and 'skills:pick X' go to the server as /pick lines.
    if (what === 'refresh') { c.srv.chat(id, '/pick refresh'); }
    if (what === 'pick') { c.srv.chat(id, '/pick ' + extra); }
  }
  function creating() { return !!(page.mine && page.mine.creating); }
  win.thornswoodSkills = {
    open: function () {
      if (page.up) { return; }
      page.up = true;
      page.opened++;
      tell('opened');
      tell('refresh');
    },
    close: function () {
      if (!page.up) { return; }
      page.up = false;
      tell('closed');
    },
    setData: function (table, got) {
      page.mine = (got && got.panel && typeof got.panel === 'object') ? got.panel : got;
      page.got.push(JSON.stringify(page.mine));
    }
  };
  /* Escape or K on the panel: closeByHand in thornswood-skills.js. */
  page.closeByHand = function () {
    if (creating()) { tell('pick', 'later'); }
    win.thornswoodSkills.close();
  };
  const ctx = { value: undefined, state: {},
    sp: { browser: { executeJavaScript: function (src) { c.handed++; vm.runInContext(src, win); } } } };
  c.receive = function (raw) { c.value = JSON.parse(raw); };
  c.frames = function (n) {
    for (let i = 0; i < n; i++) {
      if (c.value === undefined) { continue; }
      ctx.value = c.value;
      script(ctx);
    }
  };
  c.page = page;
  c.script = script;
  clients[id] = c;
  if (store[id] && store[id][charProp]) { c.receive(store[id][charProp]); }
  return c;
}

const T0 = 1800000000000;
const ME = 0xff000058, PID = 744947683;
const SETTLE_TICKS = Math.ceil(K.SETTLE_MS / TICK) + 4;

// -------------------------------------- A. the reminder in the creation hall --
let srv = server(T0);
srv.join(ME, HALL.desc, PID);
const me = client(srv, ME);
srv.run(SETTLE_TICKS);
srv.face(ME);
srv.run(4);
yes('A1 the face is made: they are choosing, and the panel opened by itself, once',
  srv.stage(ME) === 'choosing' && me.page.up && me.page.opened === 1);
yes('A1 and the page holds the creating view', !!(me.page.mine && me.page.mine.creating));

{
  const handed = me.handed, got = me.page.got.length;
  srv.runFor(2 * K.CHOOSE_REMIND_MS + 2 * TICK);
  yes('A2 the reminders while the panel is up reach the page, and it stays up without opening again',
    me.handed >= handed + 2 && me.page.got.length >= got + 2 && me.page.up && me.page.opened === 1);
  const last = me.page.got.slice(-3);
  yes('A2 and the page is handed the same panel each time, so it has nothing to tear down and draw again',
    last.length === 3 && last[0] === last[1] && last[1] === last[2]);
}

me.page.closeByHand();
srv.run(2);
yes('A3 Escape while choosing puts the panel down and holds the reminder off', !me.page.up);
srv.runFor(K.CHOOSE_LATER_MS - 60000);
yes('A3 nine minutes on, it is still down: the back off holds', !me.page.up && me.page.opened === 1);
srv.runFor(60000 + 4 * TICK);
yes('A4 ten minutes on, the reminder opens the panel again (the Done when)', me.page.up && me.page.opened === 2);
yes('A4 and the reopened panel asks for its view, which is drawn', !!(me.page.mine && me.page.mine.creating));

me.page.closeByHand();
srv.run(2);
srv.runFor(K.CHOOSE_LATER_MS + 4 * TICK);
yes('A5 closed a second time, the next reminder, the same view as the last, opens it again',
  me.page.up && me.page.opened === 3);

me.page.closeByHand();
srv.run(2);
srv.runFor(K.CHOOSE_LATER_MS + 4 * TICK);
yes('A5 and a third time', me.page.up && me.page.opened === 4);

// The panel put down some other way, with no '/pick later': the thirty second reminder.
srv.runFor(K.CHOOSE_REMIND_MS);
me.page.up = false;
srv.runFor(K.CHOOSE_REMIND_MS + 4 * TICK);
yes('A6 a panel that went down without saying later is back within the thirty second reminder',
  me.page.up && me.page.opened === 5);

{
  const handed = me.handed;
  me.frames(600);
  yes('A7 ten seconds of frames with no write hand the page nothing: the script still holds back a value it drew',
    me.handed === handed);
}

{
  const v = stored(ME);
  yes('A8 the reminder\'s write carries when it was asked, beside the panel and not in it',
    typeof v.asked === 'number' && v.asked > 0 && !!v.panel && v.panel.asked === undefined);
}

// ---------------------------------------- B. a redraw, on writeState itself --
const W = 0xff000060, WPID = 744947700;
srv.online.push(W);
store[W] = store[W] || {};
srv.mp.set(W, 'profileId', WPID);
srv.mp.set(W, 'appearance', { raceId: 7, name: 'W' });
srv.mp.set(W, PROP, { stage: 'done' });
let s = srv.C.stateOf(W);
{
  const st = {};
  let handed = 0;
  const probe = { state: st, sp: { browser: { executeJavaScript: function () { handed++; } } } };
  srv.C.writeState(W, srv.C.stateOf(W), true);
  const one = stored(W);
  srv.C.writeState(W, srv.C.stateOf(W), true);
  const two = stored(W);
  yes('B1 two redraws in the same millisecond with nothing changed each carry an ask, the second later',
    typeof one.asked === 'number' && two.asked > one.asked);
  yes('B1 and the panel on each is the same', JSON.stringify(one.panel) === JSON.stringify(two.panel));
  probe.value = one; me.script(probe);
  probe.value = one; me.script(probe);
  probe.value = two; me.script(probe);
  yes('B1 the client\'s script draws each of the two once, and a repeated frame not at all', handed === 2);

  srv.C.writeState(W, srv.C.stateOf(W));
  const three = stored(W);
  yes('B2 a write that is not a redraw carries no ask, and with nothing changed, no panel: the signature still holds it back',
    three.asked === undefined && three.panel === undefined);

  srv.clock += 1000;
  srv.C.command('/pick', ['/pick', 'class', 'nosuchclass'], W, WPID, function () { });
  const four = stored(W);
  yes('B3 a refusal is a redraw: it carries an ask beside the panel, and the note in it',
    typeof four.asked === 'number' && four.asked > two.asked && !!four.panel && !!four.panel.note &&
    four.panel.asked === undefined);
}
{
  const before = stored(W).asked;
  srv = server(T0 + 3600000);
  srv.C.writeState(W, srv.C.stateOf(W), true);
  yes('B4 after a restart the first redraw carries a later ask than the last one before it', stored(W).asked > before);
}

// ------------------------------------------------------------ the wiring --
{
  const OPEN = FNS.openCreation;
  yes('C1 the reminder and the first push both go through openCreation, which asks the character block to begin creation',
    /c\.beginCreation\(actorId\)/.test(OPEN) &&
    /if \(!openCreation\(actorId\)\)/.test(FNS.chargenTick) && /const opened = openCreation\(actorId\);/.test(FNS.beginChoosing));
  yes('C2 beginCreation writes as a redraw',
    /function beginCreation\(actorId\) \{[\s\S]{0,700}writeState\(actorId, stateOf\(actorId\), true\);/.test(CHARACTER));
  yes('C3 a redraw, and only a redraw, adds the ask, after the signature is worked out',
    /var sig = drawn\(view\);[\s\S]{0,200}delete s\.asked;[\s\S]{0,900}if \(redraw\) \{ s\.asked = askedNow\(\); \}/.test(CHARACTER) &&
    (CHARACTER.match(/\.asked = /g) || []).length === 1);
  yes('C4 no redraw of its own kind is left: the panel\'s refresh is a redraw like the rest',
    !/ASKED/.test(CHARACTER) && /if \(what === 'refresh'\) \{[\s\S]{0,300}writeState\(actorId, s, true\);/.test(CHARACTER));
}

done();
