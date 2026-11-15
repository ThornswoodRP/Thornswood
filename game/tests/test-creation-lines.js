// test-creation-lines.js
//
// Every step of creation says one line to the person, beside its log line,
// and says it ONCE.
//
// WHY. Issue #416: "The whole of character creation is narrated to a log file
// on the VPS and to nothing the person can see." A stranger's first minutes
// were a stone room with nobody in it, a race menu, silence, clothes turning
// up in the pack and a teleport. arriveAt got its line on 24 September
// (test-arrival-line.js). This covers the rest:
//
//   nothing -> appearance   beginAppearance: the hall, and the move into it
//   appearance -> choosing  beginChoosing: the clothes, and what the pick does
//   choosing -> done        arriveAt: the town's start spot (#2622)
//   nothing -> done         the returning stamp in chargenTick: welcome back
//
// AND ONCE. Patrick, 28 September, on these lines: "Yes I want it, the
// problem was it kept spamming the same message every like 5 seconds". The
// old creation line rode the choosing reminder, a timer that also fires
// straight away whenever the tick sees somebody afresh. So this does not call
// the step functions by hand and count one call: it lifts the REAL chargenTick
// and runs it at the real CHARGEN_TICK_MS, hundreds of ticks in every stage,
// through reconnects, a hot reload, the panel that did not open and its
// reminder, the stuck-in-the-hall give up (which no longer publishes a
// missing face), and a record write that does not stick, and counts every
// line each person was sent.
//
// Everything that decides anything is the real text lifted out of gamemode.js
// by name. Stubbed: mp, the clock, say/notify/log (recorded), and the helpers
// that only touch the client (closeRaceMenu, dressing, respawn points). GM
// points it at another copy of the file, which is how it was shown to fail on
// the code before the change.
//
// Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// ------------------------------------------------------- lifted by text
function fnOf(head) {
  const a = src.indexOf(head);
  const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
  return (a >= 0 && b >= 0) ? src.slice(a, b + 2) : null;
}
function num(name) {
  const m = new RegExp('\nconst ' + name + ' = (\\d+);').exec(src);
  return m ? Number(m[1]) : null;
}
const FNS = {
  faceMark: fnOf('function faceMark(a) {'),
  hasStoredAppearance: fnOf('function hasStoredAppearance(a) {'),
  chargenOf: fnOf('function chargenOf(actorId) {'),
  setChargen: fnOf('function setChargen(actorId, state) {'),
  tellOnce: fnOf('function tellOnce(actorId, step, text) {'),
  sendToHall: fnOf('function sendToHall(actorId) {'),
  beginAppearance: fnOf('function beginAppearance(actorId) {'),
  giveShift: fnOf('function giveShift(actorId) {'),
  beginChoosing: fnOf('function beginChoosing(actorId, state, why) {'),
  openCreation: fnOf('function openCreation(actorId) {'),
  arriveAt: fnOf('function arriveAt(actorId, townKey) {'),
  chargenTick: fnOf('function chargenTick() {'),
};
const NUMS = ['CHARGEN_TICK_MS', 'SETTLE_MS', 'NUDGE_MS', 'MOVED_ENOUGH_MS', 'MOVED_UNITS',
  'MOVED_DEGREES', 'CHOOSE_REMIND_MS', 'GIVEUP_MS', 'FACE_SEEN_MS', 'FACE_CAP_MS'];
const K = {};
for (const n of NUMS) { K[n] = num(n); }
const PROP = (/\nconst CHARGEN_PROPERTY = '([^']+)';/.exec(src) || [])[1] || null;
const HALL_SRC = (/\nconst HALL = (\{[\s\S]*?\n\});/.exec(src) || [])[1] || null;
let CHARGEN = null;
{
  const m = /\nconst CHARGEN = (\{.*\});\n/.exec(src);
  try { CHARGEN = m ? JSON.parse(m[1]) : null; } catch (e) { CHARGEN = null; }
}
yes('tellOnce, which says each step once, is in gamemode.js', !!FNS.tellOnce);
if (!FNS.tellOnce) { delete FNS.tellOnce; }
const missing = Object.keys(FNS).filter(function (k) { return !FNS[k]; })
  .concat(NUMS.filter(function (n) { return K[n] === null; }))
  .concat(PROP ? [] : ['CHARGEN_PROPERTY']).concat(HALL_SRC ? [] : ['HALL'])
  .concat(CHARGEN ? [] : ['CHARGEN']);
yes('the chargen tick, every step it calls, tellOnce and the constants are all in gamemode.js' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
if (missing.length) { done(); }

const HALL = new Function('return ' + HALL_SRC)();
const PASSAGES = CHARGEN.towns;
const SHIFT = CHARGEN.shift;
const TOWN_BY_KEY = {};
for (const desc in PASSAGES) { TOWN_BY_KEY[PASSAGES[desc].key] = desc; }
const TICK = K.CHARGEN_TICK_MS;
const WHITERUN = '1605e:Skyrim.esm';

/*
  A server: actors' properties, a clock, who is online, and every say, notify
  and log recorded. load() is the gamemode module over it, and calling load()
  again is a hot reload: the same actors and records, a fresh module with an
  empty firstSeen, which is what the real hot reload does.
*/
function server(opts) {
  opts = opts || {};
  const S = {
    clock: { now: 1790000000000 },
    props: {},
    online: [],
    said: [], notified: [], logs: [], errors: [], raceOpens: [],
    // A record write that does not stick: 'drop' loses it, 'throw' throws.
    chargenWrite: 'ok',
  };
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return S.online.slice(); }
      const p = S.props[id] || {};
      return p[key] === undefined ? undefined : JSON.parse(JSON.stringify(p[key]));
    },
    set: function (id, key, v) {
      if (key === PROP && S.chargenWrite === 'drop') { return; }
      if (key === PROP && S.chargenWrite === 'throw') { throw new Error('no such property'); }
      if (!S.props[id]) { S.props[id] = {}; }
      S.props[id][key] = JSON.parse(JSON.stringify(v));
    },
    setRaceMenuOpen: function () { S.raceOpens.push(S.clock.now); },
  };
  const FakeDate = { now: function () { return S.clock.now; } };
  const g = {
    __thornswoodSpoils: { GOLD: 0x0000000F },
    __thornswoodCharacter: opts.panel === false
      ? { grantKnown: function () { }, stateOf: function () { return null; } }
      : { beginCreation: function () { }, grantKnown: function () { },
          stateOf: function () { return null; } },
  };
  const ids = {};
  const stubs = {
    idOf: function (desc) {
      if (!desc) { return 0; }
      if (!ids[desc]) { ids[desc] = 0x1000 + Object.keys(ids).length; }
      return ids[desc];
    },
    closeRaceMenu: function () { },
    resolveArrival: function () { return null; },
    say: function (id, text) { S.said.push({ id: id, text: String(text), at: S.clock.now }); },
    notify: function (id, text) { S.notified.push({ id: id, text: String(text) }); },
    log: function () { S.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
  };
  const PARAMS = ['mp', 'Date', 'globalThis', 'HALL', 'SHIFT', 'PASSAGES', 'TOWN_BY_KEY',
    'CHARGEN_PROPERTY', 'CHARGEN_ENABLED'].concat(NUMS).concat(Object.keys(stubs));
  const BODY = 'const firstSeen = new Map();\n' +
    Object.keys(FNS).map(function (k) { return FNS[k]; }).join('\n') +
    '\nreturn { chargenTick: chargenTick, arriveAt: arriveAt, chargenOf: chargenOf, firstSeen: firstSeen };';
  const make = Function.apply(null, PARAMS.concat([BODY]));
  S.load = function () {
    const args = [mp, FakeDate, g, HALL, SHIFT, PASSAGES, TOWN_BY_KEY, PROP, true]
      .concat(NUMS.map(function (n) { return K[n]; }))
      .concat(Object.keys(stubs).map(function (k) { return stubs[k]; }));
    S.mod = make.apply(null, args);
    return S.mod;
  };
  S.load();
  S.mp = mp;
  // n ticks at the real interval. A throw is what guard() would catch and log.
  S.run = function (n) {
    for (let i = 0; i < n; i++) {
      S.clock.now += TICK;
      try { S.mod.chargenTick(); } catch (e) { S.errors.push(e); }
    }
  };
  S.join = function (id, desc, pid, pack) {
    mp.set(id, 'worldOrCellDesc', desc);
    mp.set(id, 'profileId', pid);
    mp.set(id, 'inventory', { entries: pack || [] });
    mp.set(id, 'pos', [0, 0, 0]);
    mp.set(id, 'angle', [0, 0, 0]);
    if (S.online.indexOf(id) < 0) { S.online.push(id); }
  };
  S.leave = function (id) { S.online = S.online.filter(function (x) { return x !== id; }); };
  // Offline for a few ticks, then back: a reconnect as the tick sees one.
  S.reconnect = function (id, ticksAway) {
    S.leave(id);
    S.run(ticksAway || 6);
    S.online.push(id);
  };
  S.face = function (id, mark) { mp.set(id, 'appearance', { raceId: 7, name: String(mark) }); };
  S.stage = function (id) { return (S.mod.chargenOf(id) || {}).stage; };
  S.to = function (id, re) {
    return S.said.filter(function (s) { return s.id === id && (!re || re.test(s.text)); });
  };
  return S;
}

// Settle plus a margin, in ticks.
const SETTLE_TICKS = Math.ceil(K.SETTLE_MS / TICK) + 4;
const HALL_LINE = /Welcome to Thornswood\. (This is|You are going to) the creation hall/;
const CLOTHES_LINE = /plain clothes/;
const PANEL_LINE = /Press K/;
// The arrival line, Djinn's words since 17 October (test-arrival-line.js holds every town's).
const INN_LINE = /^Welcome to [A-Z][A-Za-z ]+, Safe Travels\.$/;
const BACK_LINE = /Welcome back to Thornswood/;
const AGAIN_LINE = "Your character creation menu didn't open. Opening it again.";
const RELOG_LINE = 'The character creation menu still did not open. Relog, and if it ' +
  'still does not open, contact staff.';

const EM = String.fromCharCode(0x2014);
function clean(line) {
  return !!line && line.text.length > 0 && !/player/i.test(line.text) &&
    line.text.indexOf(EM) < 0 && !/\n/.test(line.text);
}

// ------------------------------------------- a whole creation, start to the start spot
{
  const ME = 0xff000058;
  const S = server();
  S.join(ME, HALL.desc, 744947683, []);

  S.run(SETTLE_TICKS);
  yes('a new person in the hall is put in the appearance stage', S.stage(ME) === 'appearance');
  S.run(200);
  yes('appearance: 200 more ticks (' + (200 * TICK / 1000) + ' s) and the hall line was said exactly once',
      S.to(ME, HALL_LINE).length === 1 && S.to(ME).length === 1);
  const l1 = S.to(ME)[0];
  yes('it welcomes them and names the creation hall', !!l1 && /This is the creation hall/.test(l1.text));
  yes('and the log line is still written beside it',
      S.logs.some(function (l) { return /-> appearance \(already in the hall\)/.test(l); }));

  S.face(ME, 'made');
  S.run(1);
  yes('the face made, they are choosing', S.stage(ME) === 'choosing');
  S.run(400);
  yes('choosing: 400 ticks (' + (400 * TICK / 1000) + ' s, ' +
      Math.floor(400 * TICK / K.CHOOSE_REMIND_MS) + ' reminders) and the clothes line was said exactly once',
      S.to(ME, CLOTHES_LINE).length === 1 && S.to(ME).length === 2);
  const l2 = S.to(ME, CLOTHES_LINE)[0];
  yes('it says what the town pick does, and not Press K, since the panel is on the screen',
      !!l2 && /home town/.test(l2.text) && /where you will start/.test(l2.text) && !/\binn\b/.test(l2.text) && !PANEL_LINE.test(l2.text));
  yes('the shift was really handed over (the log says so)',
      S.logs.some(function (l) { return /shift: 2 handed over/.test(l); }));
  yes('and the choosing log line is still written',
      S.logs.some(function (l) { return /-> choosing \(the face arrived\), panel opened/.test(l); }));

  yes('picking Riften sends them', S.mod.arriveAt(ME, 'riften') === true && S.stage(ME) === 'done');
  S.mod.arriveAt(ME, 'riften');
  S.run(200);
  yes('done: a second pick and 200 ticks later, the arrival line was said exactly once, naming Riften\'s hold',
      S.to(ME, INN_LINE).length === 1 && S.to(ME, INN_LINE)[0].text === 'Welcome to The Rift, Safe Travels.');
  yes('three steps, three lines, all to this person, none repeated',
      S.said.length === 3 && S.to(ME).length === 3 &&
      new Set(S.said.map(function (s) { return s.text; })).size === 3);
  yes('all through say, none through notify', S.notified.length === 0);
  yes('every line is plain: no player, no em dash, one line each', S.said.every(clean));
  yes('no tick threw', S.errors.length === 0);
}

// ------------------------------------------- reconnects and a hot reload, every stage
{
  const ME = 0xff000059;
  const S = server();
  S.join(ME, HALL.desc, 11, []);
  S.run(SETTLE_TICKS + 20);
  for (let i = 0; i < 5; i++) { S.reconnect(ME); S.run(SETTLE_TICKS + 20); }
  yes('appearance: five reconnects mid creation, the hall line still said once',
      S.to(ME, HALL_LINE).length === 1 && S.stage(ME) === 'appearance');
  yes('and each reconnect was seen as one (the wait started again)',
      S.logs.filter(function (l) { return /came back mid creation/.test(l); }).length === 5);
  S.load();
  S.run(SETTLE_TICKS + 100);
  yes('appearance: a hot reload (fresh module, empty firstSeen) says nothing again',
      S.to(ME).length === 1);

  S.face(ME, 'made');
  S.run(100);
  yes('into choosing, one clothes line', S.to(ME, CLOTHES_LINE).length === 1);
  for (let i = 0; i < 5; i++) { S.reconnect(ME); S.run(SETTLE_TICKS + 100); }
  S.load();
  S.run(SETTLE_TICKS + 400);
  yes('choosing: five reconnects, a hot reload and ' + (SETTLE_TICKS + 400) +
      ' ticks after it, the reminder re-armed each time and still one clothes line',
      S.to(ME, CLOTHES_LINE).length === 1 && S.to(ME).length === 2);
  yes('no tick threw', S.errors.length === 0);
}

// ------------------------------------------- the teleport into the hall
{
  const ME = 0xff00005a;
  const S = server();
  S.join(ME, HALL.desc, 12, []);
  // In the hall for the new-or-returning decision, somewhere else by the time
  // beginAppearance looks, which is the only way it moves anybody.
  const realGet = S.mp.get;
  let reads = 0;
  S.mp.get = function (id, key) {
    if (id === ME && key === 'worldOrCellDesc' && S.mod.chargenOf(ME) === null && ++reads === 2) {
      return WHITERUN;
    }
    return realGet(id, key);
  };
  S.run(SETTLE_TICKS + 200);
  const st = S.mod.chargenOf(ME) || {};
  yes('somebody not in the hall when the stage opens is moved there',
      st.moved === true && (realGet(ME, 'locationalData') || {}).cellOrWorldDesc === HALL.desc);
  yes('and told where they are going, exactly once in 200 ticks',
      S.to(ME).length === 1 && /going to the creation hall/.test(S.to(ME)[0].text));
  yes('that line is plain too', clean(S.to(ME)[0]));
}

// ------------------------------------------- the panel that did not open, and its reminder
{
  const ME = 0xff00005b;
  const S = server({ panel: false });
  S.join(ME, HALL.desc, 13, []);
  S.run(SETTLE_TICKS);
  S.face(ME, 'made');
  S.run(600);
  yes('the panel not opening: 600 ticks (' + Math.floor(600 * TICK / K.CHOOSE_REMIND_MS) +
      ' reminders, each finding the panel still shut) and the Press K line said exactly once',
      S.to(ME, PANEL_LINE).length === 1);
  const l = S.to(ME, PANEL_LINE)[0];
  yes('it is the clothes line, with how to open the panel', !!l && CLOTHES_LINE.test(l.text));
  yes('and does not welcome them a second time', !!l && !/Welcome/.test(l.text));
  S.reconnect(ME);
  S.run(SETTLE_TICKS + 200);
  S.load();
  S.run(SETTLE_TICKS + 200);
  yes('a reconnect and a hot reload re-arm the reminder at once, and it still says nothing more',
      S.to(ME, PANEL_LINE).length === 1 && S.to(ME).length === 2);
  yes('the reminder did keep trying the panel (the log counts every choosing pass)',
      S.logs.some(function (l2) { return /panel NOT opened/.test(l2); }));
  yes('that line is plain too', clean(l));
}

// ------------------------------------------- stuck in the hall: never moves, no face
{
  const ME = 0xff00005c;
  const S = server();
  S.join(ME, HALL.desc, 14, []);
  S.run(SETTLE_TICKS + 20);
  yes('stuck in the hall starts on the face step with one hall line',
      S.stage(ME) === 'appearance' && S.to(ME).length === 1 &&
      HALL_LINE.test(S.to(ME)[0].text) && S.to(ME, CLOTHES_LINE).length === 0);
  const askedAt = (S.mod.chargenOf(ME) || {}).askedAt;
  function runUntil(at) {
    while (S.clock.now < at) { S.run(1); }
  }
  runUntil(askedAt + K.NUDGE_MS + TICK);
  yes('first lost-request interval: one race-menu ask and no extra line',
      S.raceOpens.length === 1 && S.to(ME).length === 1);
  runUntil(askedAt + 2 * K.NUDGE_MS + TICK);
  yes('second interval: two asks and the first player line once',
      S.raceOpens.length === 2 && S.to(ME).length === 2 &&
      S.to(ME)[1].text === AGAIN_LINE);
  runUntil(askedAt + 3 * K.NUDGE_MS + TICK);
  yes('third interval: three asks and the relog line once',
      S.raceOpens.length === 3 && S.to(ME).length === 3 &&
      S.to(ME)[1].text === AGAIN_LINE && S.to(ME)[2].text === RELOG_LINE);
  runUntil(askedAt + 4 * K.NUDGE_MS + TICK);
  yes('fourth interval: four asks and still those two lines only',
      S.raceOpens.length === 4 && S.to(ME).length === 3 &&
      S.to(ME)[0] && HALL_LINE.test(S.to(ME)[0].text) &&
      S.to(ME)[1].text === AGAIN_LINE && S.to(ME)[2].text === RELOG_LINE &&
      S.to(ME, CLOTHES_LINE).length === 0 && S.stage(ME) === 'appearance');
  yes('the give up still does not publish them',
      S.logs.filter(function (l) { return /staying unpublished/.test(l); }).length >= 1);
}

// ------------------------------------------- somebody who has played before
{
  const ME = 0xff00005d;
  const S = server();
  S.join(ME, WHITERUN, 15, [{ baseId: 0x12345, count: 1 }]);
  S.run(SETTLE_TICKS + 200);
  const st = S.mod.chargenOf(ME) || {};
  yes('a returning character is stamped done and not put through creation',
      st.stage === 'done' && st.legacy === true);
  yes('returning: 200 ticks and welcomed back exactly once', S.to(ME, BACK_LINE).length === 1 &&
      S.to(ME).length === 1);
  for (let i = 0; i < 3; i++) { S.reconnect(ME); S.run(SETTLE_TICKS + 50); }
  S.load();
  S.run(SETTLE_TICKS + 200);
  yes('three reconnects and a hot reload later, still once', S.to(ME).length === 1);
  yes('the log still says why creation was skipped',
      S.logs.filter(function (l) { return /creation is skipped for them/.test(l); }).length === 1);
  yes('that line is plain too', clean(S.to(ME)[0]));

  // Gold on its own is no proof of having played, and the hall means new.
  const NEW = 0xff00005e;
  S.join(NEW, HALL.desc, 16, [{ baseId: 0x0000000F, count: 40 }]);
  S.run(SETTLE_TICKS + 100);
  yes('a new one holding only the starting purse is welcomed, once, not welcomed back',
      S.to(NEW).length === 1 && HALL_LINE.test(S.to(NEW)[0].text) && S.stage(NEW) === 'appearance');
}

// ------------------------------------------- a new character is told again
{
  const S = server();
  const FIRST = 0xff000060, SECOND = 0xff000061;
  S.join(FIRST, HALL.desc, 17, []);
  S.run(SETTLE_TICKS);
  S.face(FIRST, 'one');
  S.run(10);
  S.mod.arriveAt(FIRST, 'whiterun');
  S.leave(FIRST);
  // The same person, a second character: a new actor with no record.
  S.join(SECOND, HALL.desc, 17, []);
  S.run(SETTLE_TICKS + 100);
  S.face(SECOND, 'two');
  S.run(100);
  yes('a second character is told each step again, once each',
      S.to(SECOND, HALL_LINE).length === 1 && S.to(SECOND, CLOTHES_LINE).length === 1 &&
      S.to(SECOND).length === 2);
  yes('and the first character was not told anything more',
      S.to(FIRST).length === 3);
}

// ------------------------------------------- a record write that does not stick
{
  const ME = 0xff000062;
  const S = server();
  S.chargenWrite = 'drop';
  S.join(ME, HALL.desc, 18, []);
  S.run(SETTLE_TICKS + 200);
  yes('a record write that is silently lost: 200 ticks re-entering the new branch, nothing said ' +
      '(not a line every tick)', S.to(ME).length === 0);
  S.chargenWrite = 'throw';
  S.run(200);
  yes('a record write that throws: nothing said either', S.to(ME).length === 0);
  S.chargenWrite = 'ok';
  S.run(200);
  yes('once the write sticks, the hall line is said, once', S.to(ME).length === 1 &&
      HALL_LINE.test(S.to(ME)[0].text));

  const BACK = 0xff000063;
  S.chargenWrite = 'drop';
  S.join(BACK, WHITERUN, 19, [{ baseId: 0x12345, count: 1 }]);
  S.run(SETTLE_TICKS + 200);
  yes('the same for a returning character: a lost stamp says nothing', S.to(BACK).length === 0);
  S.chargenWrite = 'ok';
}

done();
