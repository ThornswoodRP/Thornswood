// test-picked-character.js
//
//     node .\tests\test-picked-character.js
//
// Picking a character that has already been made puts you in the world as that
// character, never into creation, and a character the server no longer has is
// said so on the menu before it is picked (#955).
//
// WHAT HAPPENED. Patrick on dev, 28 Sep 20:34, launcher 1.1.102.4: "I clicked a
// current character it took me to creation". His menu listed slot 2, profile
// 902356861, "Adventurer5435434, Whiterun Bannered Mare", made on 20 Sep. The
// launcher chose that id ("chose character 902356861"), the join pass named it,
// the client logged in as it, and the dev server's log says why creation ran:
//
//     20:34:50.563  Creating character ff000005
//     20:34:50.566  1 logged as 902356861
//     20:35:00.700  chargen ff000005 profile 902356861 is new, in the hall with nothing
//
// "Creating", not "Loading": the engine found no actor under that profile and
// made one, so there was no chargen record to read. The dev world started over
// on 23 Sep ("loaded 4 ChangeForms (Including 1 player characters)"), and since
// 26 Sep the engine also skips characters whose saved race will not load
// ("Skipping ChangeForm ...: bad raceId in appearanceDump"). The name on the
// card came from the site's roster, which keeps a row for ever. The join pass,
// #934's told flags, a hot reload and the load order refusal play no part.
//
// So the cause is a list that outlived the world, and the fix tells the menu:
//   A. the chargen rule itself, run through the real chargenTick: a finished
//      record is never sent to creation, whatever else is true; and the
//      session above, replayed, is new because there is no record.
//   B. the gamemode reports which allowed profiles this world holds, with the
//      roster push (the roster block run in a vm).
//   C. the site keeps that per server and answers each launcher with its own
//      characters the server does not hold ("gone"), and takes the dev server's
//      push at /dev/api/roster, which answered 404 until now.
//   D. the launcher reads "gone" (its C# compiled with the build's compiler,
//      tests/launcher-csc.js) and marks the character in the menu's list;
//      the page says so.
//
// Read only. Temp files go under os.tmpdir().
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const siteFiles = require('./site-files');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }
const src = process.env.GM ? fs.readFileSync(process.env.GM, 'utf8').split(CR).join('') : read('game/gamemode.js');
const site = siteFiles.source();
const rosterCs = read('launcher/app/Roster.cs');
const charsCs = read('launcher/app/Chars.cs');
const page = read('game/ui/thornswood-select.js');

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
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-955-'));

// =================================================== A. the chargen rule
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
const missing = Object.keys(FNS).filter(function (k) { return !FNS[k]; })
  .concat(NUMS.filter(function (n) { return K[n] === null; }))
  .concat(PROP ? [] : ['CHARGEN_PROPERTY']).concat(HALL_SRC ? [] : ['HALL'])
  .concat(CHARGEN ? [] : ['CHARGEN']);
yes('the chargen tick and everything it calls are in gamemode.js' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
if (missing.length) { done(); }

const HALL = new Function('return ' + HALL_SRC)();
const TOWN_BY_KEY = {};
for (const desc in CHARGEN.towns) { TOWN_BY_KEY[CHARGEN.towns[desc].key] = desc; }
const TICK = K.CHARGEN_TICK_MS;

/* A server over the real chargen text. load() again is a hot reload. */
function server() {
  const S = { clock: { now: 1790000000000 }, props: {}, online: [], said: [], logs: [], errors: [],
              raceMenu: [], moved: [] };
  const mp = {
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return S.online.slice(); }
      const p = S.props[id] || {};
      return p[key] === undefined ? undefined : JSON.parse(JSON.stringify(p[key]));
    },
    set: function (id, key, v) {
      if (key === 'locationalData') { S.moved.push(id); }
      if (!S.props[id]) { S.props[id] = {}; }
      S.props[id][key] = JSON.parse(JSON.stringify(v));
    },
    setRaceMenuOpen: function (id, open) { if (open) { S.raceMenu.push(id); } },
  };
  const FakeDate = { now: function () { return S.clock.now; } };
  const g = {
    __thornswoodSpoils: { GOLD: 0x0000000F },
    __thornswoodCharacter: { beginCreation: function (id) { S.raceMenu.push(id); }, grantKnown: function () { },
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
    say: function (id, text) { S.said.push({ id: id, text: String(text) }); },
    notify: function () { },
    log: function () { S.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
  };
  const PARAMS = ['mp', 'Date', 'globalThis', 'HALL', 'SHIFT', 'PASSAGES', 'TOWN_BY_KEY',
    'CHARGEN_PROPERTY', 'CHARGEN_ENABLED'].concat(NUMS).concat(Object.keys(stubs));
  const BODY = 'const firstSeen = new Map();\n' +
    Object.keys(FNS).map(function (k) { return FNS[k]; }).join('\n') +
    '\nreturn { chargenTick: chargenTick, chargenOf: chargenOf };';
  const make = Function.apply(null, PARAMS.concat([BODY]));
  S.load = function () {
    S.mod = make.apply(null, [mp, FakeDate, g, HALL, CHARGEN.shift, CHARGEN.towns, TOWN_BY_KEY, PROP, true]
      .concat(NUMS.map(function (n) { return K[n]; }))
      .concat(Object.keys(stubs).map(function (k) { return stubs[k]; })));
  };
  S.load();
  S.mp = mp;
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
  S.stage = function (id) { return (S.mod.chargenOf(id) || {}).stage; };
  return S;
}
const SETTLE_TICKS = Math.ceil(K.SETTLE_MS / TICK) + 4;
const CREATION = /creation hall|-> appearance|-> choosing|is new/;

// A finished record, in every place and state that could look new.
const CASES = [
  ['in an inn with a full pack', '1605e:Skyrim.esm', [{ baseId: 0x12eb7, count: 1 }], true],
  ['in the hall with nothing but gold and no face', HALL.desc, [{ baseId: 0x0000000F, count: 40 }], false],
  ['in the hall with an empty pack and a face', HALL.desc, [], true],
];
for (const c of CASES) {
  const ME = 0xff000005;
  const S = server();
  S.join(ME, c[1], 902356861, c[2]);
  S.mp.set(ME, PROP, { stage: 'done', at: 1789000000000, home: 'whiterun', told: { inn: 1 } });
  if (c[3]) { S.mp.set(ME, 'appearance', { raceId: 0x13746, name: 'Adventurer5435434' }); }
  S.run(SETTLE_TICKS + 200);
  S.online = []; S.run(6); S.online = [ME];      // a reconnect
  S.run(SETTLE_TICKS + 60);
  S.load();                                      // a hot reload: firstSeen empty again
  S.run(SETTLE_TICKS + 60);
  yes('finished record ' + c[0] + ': still done after 300+ ticks, a reconnect and a hot reload',
      S.stage(ME) === 'done');
  yes('  and never moved to the hall, no race menu asked for, nothing said about creation',
      S.moved.length === 0 && S.raceMenu.length === 0 &&
      !S.said.some(function (s) { return CREATION.test(s.text); }) &&
      !S.logs.some(function (l) { return CREATION.test(l); }) && S.errors.length === 0);
}

// Patrick's session replayed: the engine made a new actor, so there is no record.
{
  const ME = 0xff000005;
  const S = server();
  S.join(ME, HALL.desc, 902356861, []);
  S.run(SETTLE_TICKS);
  yes('the session of 28 Sep replayed (a new actor, no record, empty pack, in the hall) is new, ' +
      'as the dev log says: the character was not on the server, not misread',
      S.stage(ME) === 'appearance' &&
      S.logs.some(function (l) { return /profile 902356861 is new, in the hall with nothing/.test(l); }));
}

// =================================================== B. the held report
const RB = src.indexOf('// ==== thornswood character roster ====');
const RE = src.indexOf('// ==== end thornswood character roster ====');
yes('the roster block is in gamemode.js between its markers', RB >= 0 && RE > RB);
function rosterRun(opts) {
  const dir = fs.mkdtempSync(path.join(TMP, 'srv-'));
  const priv = path.join(dir, 'private');
  fs.mkdirSync(priv);
  fs.writeFileSync(path.join(dir, 'server-settings.json'),
    JSON.stringify({ privDir: priv, thornswoodServer: opts.server }));
  fs.writeFileSync(path.join(priv, 'door.json'), JSON.stringify({ site: 'https://example.invalid/dev', key: 'k' }));
  if (opts.allowed) { fs.writeFileSync(path.join(priv, 'allowed.json'), JSON.stringify({ profiles: opts.allowed })); }
  const sent = [], timers = [], intervals = [], cleared = [];
  const fakeHttps = {
    request: function (o, cb) {
      const r = { on: function () { return r; }, destroy: function () { },
                  end: function (body) { sent.push({ path: o.path, body: JSON.parse(body) }); } };
      return r;
    }
  };
  const actors = opts.actors || {};
  const mp = {
    get: function (id, key) { return key === 'onlinePlayers' ? [] : undefined; },
    getActorsByProfileId: opts.noLookup ? undefined : function (pid) { return actors[pid] ? [actors[pid]] : []; },
  };
  const ctx = {
    mp: mp, console: { log: function () { } }, URL: URL, Buffer: Buffer, JSON: JSON,
    require: function (m) { return m === 'https' ? fakeHttps : require(m); },
    setTimeout: function (f) { timers.push(f); return 0; },
    setInterval: function (f) { intervals.push(f); return intervals.length; },
    clearInterval: function (h) { cleared.push(h); },
    chargenOf: function () { return null; },
  };
  ctx.globalThis = ctx;
  const was = process.cwd();
  process.chdir(dir);
  try {
    vm.runInNewContext(src.slice(RB, RE), ctx);
    if (opts.reload) { vm.runInNewContext(src.slice(RB, RE), ctx); }
    timers.forEach(function (f) { f(); });
  } finally { process.chdir(was); }
  return { sent: sent, intervals: intervals, cleared: cleared, ctx: ctx };
}
{
  const r = rosterRun({ server: 'dev', allowed: [902356861, 126519151, 777], actors: { 126519151: 0xff000001, 777: 0xff000002 } });
  const b = r.sent.length ? r.sent[r.sent.length - 1].body : {};
  yes('the push goes to <site>/api/roster, so the dev server lands on /dev/api/roster',
      r.sent.length > 0 && r.sent[0].path === '/dev/api/roster');
  yes('it names the server it came from (dev)', b.server === 'dev');
  yes('checked is every profile allowed in', JSON.stringify(b.checked) === JSON.stringify([902356861, 126519151, 777]));
  yes('held is only the profiles this world has a character for (902356861 is not held)',
      JSON.stringify(b.held) === JSON.stringify([126519151, 777]));
  yes('the door key still rides along as before', b.key === 'k' && typeof b.who === 'object');
  yes('it is sent again on a timer, and the timer is kept on globalThis',
      typeof r.ctx.__thornswoodHeldPush !== 'undefined');
}
{
  const r = rosterRun({ server: 'dev', allowed: [1, 2], reload: true });
  yes('a hot reload replaces the held timer rather than adding one',
      r.cleared.indexOf(r.ctx.__thornswoodHeldPush) >= 0 || r.cleared.length >= 2);
}
{
  const r = rosterRun({ server: '', allowed: null });
  const b = r.sent.length ? r.sent[0].body : {};
  yes('with no allowed.json nothing is claimed gone: no checked or held in the push, and the server is main',
      r.sent.length === 1 && !('checked' in b) && !('held' in b) && b.server === 'main');
}
{
  const r = rosterRun({ server: 'dev', allowed: [5], noLookup: true });
  const b = r.sent.length ? r.sent[0].body : {};
  yes('a server that cannot look characters up claims nothing gone', !('checked' in b));
}

// =================================================== C. the site
function block(startText) {
  const a = site.indexOf(startText);
  if (a < 0) { return null; }
  const b = site.indexOf('\n  }\n', a);
  return b < 0 ? null : site.slice(a, b + 4);
}
const PUSH = block("  if ((route === '/api/roster' || route === '/dev/api/roster') && req.method === 'POST') {");
const ASK = block("  if (p === '/api/play/roster' && req.method === 'POST') {");
const FRESH = (/\nconst ROSTER_HELD_FRESH_MS = ([^;]+);/.exec(site) || [])[1] || null;
yes('the site takes the roster at /api/roster and /dev/api/roster, and answers /api/play/roster',
    !!PUSH && !!ASK && !!FRESH);
if (PUSH && ASK && FRESH) {
  const store = { file: null };
  const LINKED = { '615236910243119104': { profiles: [902356861, 126519151, 114847261] } };
  const ROUTE = new Function('p', 'route', 'req', 'res', 'o_body', 'cfg', 'store', 'LINKED', 'NOW',
    'const ROSTER = "roster"; const ROSTER_HELD_FRESH_MS = ' + FRESH + ';\n' +
    'const Date = { now: function () { return NOW; } };\n' +
    'function body() { return Promise.resolve(o_body); }\n' +
    'function sameSecret(a, b) { return a === b; }\n' +
    'function jsonFile(f, d) { if (f === "linked") return LINKED; if (f === "pk") return d; return store.file ? JSON.parse(JSON.stringify(store.file)) : d; }\n' +
    // Nor any PK an admin undid (#1010): pk.json is empty here.
    'const PK = "pk"; function pkActive(r) { return !!r && !r.undone; }\n' +
    'function putJson(f, v) { store.file = JSON.parse(JSON.stringify(v)); return true; }\n' +
    // Nobody killed for good or banned by character here (#1010); test-bans-pk.js runs those.
    'function characterBar() { return null; }\n' +
    'function sendJson(res, code, obj) { res.code = code; res.obj = obj; return res; }\n' +
    'function readTicket(t) { return t === "good" ? { d: "615236910243119104" } : null; }\n' +
    'const LINKED_ = "linked";\n' +
    'return (async function () {\n' +
    PUSH.split('LINKED').join('LINKED_') + '\n' + ASK.split('jsonFile(LINKED').join('jsonFile(LINKED_') +
    '\n return null; })();');
  const T0 = 1790000000000;
  async function call(pth, obj, now) {
    const res = {};
    await ROUTE(pth, pth.toLowerCase(), { method: 'POST' }, res, JSON.stringify(obj), { botKey: 'k' }, store, LINKED, now || T0);
    return res;
  }
  (async function () {
    let r = await call('/dev/api/roster', { key: 'k', who: { 902356861: { name: 'Adventurer5435434' } },
                                            server: 'dev', checked: [902356861, 126519151], held: [126519151] });
    yes('the dev server\'s push to /dev/api/roster is taken (was a 404)', r.code === 200);
    yes('its report is kept under dev', !!(store.file.servers && store.file.servers.dev) && !store.file.servers.main);
    r = await call('/api/roster', { key: 'nope', who: {} });
    yes('a push with the wrong key is still refused', r.code === 401);
    r = await call('/api/play/roster', { ticket: 'good', channel: 'dev' });
    yes('the dev launcher is told its character 902356861 is gone, with when the server looked',
        r.code === 200 && JSON.stringify(r.obj.gone) === '[902356861]' && r.obj.goneAt === T0);
    yes('the names still come back as before', r.obj.rows && r.obj.rows['902356861'] &&
        r.obj.rows['902356861'].name === 'Adventurer5435434');
    yes('114847261 was not looked at, so it is not called gone', r.obj.gone.indexOf(114847261) < 0);
    r = await call('/api/play/roster', { ticket: 'good' });
    yes('the main launcher gets nothing gone from the dev server\'s report', r.code === 200 && r.obj.gone.length === 0);
    r = await call('/api/play/roster', { ticket: 'good', channel: 'dev' }, T0 + 2 * 60 * 60 * 1000);
    yes('a report two hours old is not passed on', r.code === 200 && r.obj.gone.length === 0 && r.obj.goneAt === 0);
    r = await call('/api/play/roster', { ticket: 'bad', channel: 'dev' });
    yes('no ticket, no answer', r.code === 401);
    partD();
  })().catch(function (e) { yes('the site routes ran: ' + e, false); partD(); });
} else { partD(); }

// =================================================== D. the launcher and the page
function lift(text, head) {
  const a = text.indexOf(head);
  if (a < 0) { return null; }
  let depth = 0, i = text.indexOf('{', a);
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
  }
  const start = text.lastIndexOf('\n', a) + 1;
  return text.slice(start, i + 1);
}
function partD() {
  const parts = ['        public static bool Gone(int profileId, DateTime lastPlayedLocal)',
                 '        public static DateTime Played(DateTime local)',
                 '        public static HashSet<int> ReadGone(string text, out DateTime at)']
    .map(function (h) { return lift(rosterCs, h); });
  yes('Roster.cs has Gone, Played and ReadGone', parts.every(Boolean));
  // Built the way the project builds, by the .NET 10 SDK, which runs here on
  // any machine that has it (#4823).
  const lc = require('./launcher-csc');
  if (parts.every(Boolean) && lc.dotnet) {
    const prog =
      'using System; using System.Collections.Generic; using System.Text.RegularExpressions;\n' +
      'static class Roster {\n static readonly object gate = new object();\n' +
      ' static HashSet<int> gone = new HashSet<int>(); static DateTime goneAt = DateTime.MinValue;\n' +
      parts.join('\n') + '\n' +
      ' public static void Set(string reply) { DateTime at; gone = ReadGone(reply, out at); goneAt = at; }\n' +
      ' static void Main() {\n' +
      '  DateTime before = new DateTime(2026, 9, 20, 16, 55, 0, DateTimeKind.Local);\n' +
      '  DateTime after = new DateTime(2026, 9, 29, 12, 0, 0, DateTimeKind.Local);\n' +
      '  Set("{\\"ok\\":true,\\"rows\\":{},\\"gone\\":[902356861, 5],\\"goneAt\\":1790000000000}");\n' +
      '  Console.WriteLine("read " + gone.Count + " " + goneAt.ToString("o"));\n' +
      '  Console.WriteLine("before " + Gone(902356861, before));\n' +
      '  Console.WriteLine("after " + Gone(902356861, after));\n' +
      '  Console.WriteLine("other " + Gone(126519151, before));\n' +
      '  Console.WriteLine("never " + Gone(5, DateTime.MinValue));\n' +
      '  Set("{\\"ok\\":true,\\"rows\\":{}}");\n' +
      '  Console.WriteLine("old " + gone.Count + " " + Gone(902356861, before));\n' +
      '  Set("{\\"ok\\":true,\\"rows\\":{},\\"gone\\":[],\\"goneAt\\":0}");\n' +
      '  Console.WriteLine("none " + gone.Count);\n' +
      ' }\n}\n';
    let out = '';
    try {
      const r = lc.run(lc.build({ sources: [prog], exe: true }), []);
      out = r.status === 0 ? r.stdout : 'ERROR exit ' + r.status + '\n' + r.stdout + r.stderr;
    } catch (e) { out = 'ERROR ' + e.message; }
    const has = function (re) { return re.test(out); };
    yes('the lifted C# compiles with the compiler the launcher builds with, and runs', !/ERROR/.test(out));
    yes('ReadGone reads both ids and the moment the server looked (2026-09-21T14:13:20Z)',
        has(/read 2 2026-09-21T14:13:20\.0000000Z/));
    yes('a character last played (20 Sep) before the server looked is gone', has(/before True/));
    yes('one played after the server looked is never called gone on that look', has(/after False/));
    yes('a character the server did not name is not gone', has(/other False/));
    yes('an answer from an older site (no gone field) marks nothing', has(/old 0 False/));
    yes('an empty answer marks nothing', has(/none 0/));
    if (/ERROR/.test(out)) { console.log(out); }
  } else if (parts.every(Boolean)) {
    yes('the .NET SDK the launcher builds with is on this machine', false);
  }

  yes('Roster.Refresh sends the channel, so the site answers for this build\'s server',
      /",\\"channel\\":\\"" \+ Discord\.Escape\(channel\)/.test(rosterCs) &&
      /\/api\/play\/roster/.test(rosterCs));
  yes('the menu list gets "gone":true for such a character (Chars.WriteCharacters)',
      /Roster\.Gone\(r\.Id, r\.Played\)/.test(charsCs) && /,\\"gone\\":true/.test(charsCs));
  yes('the card says the server no longer has it and that playing makes a new character',
      /not on this server/.test(page) &&
      /The server no longer has this character\. Playing this slot makes a new character in the creation hall\./.test(page));
  yes('and the status line says creation hall, not "Joining as"',
      /e\.c && !e\.c\.gone \? 'Joining as '/.test(page));
  const words = page.match(/'[^']*no longer has[^']*'/g) || [];
  yes('the new words carry no "player" and no em dash',
      words.every(function (w) { return !/player/i.test(w) && w.indexOf(String.fromCharCode(0x2014)) < 0; }));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
  done();
}
