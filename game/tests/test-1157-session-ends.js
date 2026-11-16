// test-1157-session-ends.js
//
//     node .\game\tests\test-1157-session-ends.js
//
// A session the server ends on purpose stays ended until the person acts
// (#1157). Seen while working #481 and #1142: skymp5-client connects again
// after every disconnect (networkingService.ts, onTick: "disconnect" calls
// reconnect()) and logs in as the same character from storage.authGameData
// (AuthService.handleConnectionAccepted), so a person refused at the door was
// back a second later, told the same sentence, ended again, and so on until
// they closed the game.
//
// THE SERVER. Every place that ends a session on purpose (the door refusing
// somebody past the line, the join pass, the load order, a ban, a character
// dead for good, a staff /kick) says the sentence, then says { end: <that
// sentence> } on the line the character choice reads, then kicks a few
// seconds later. Each block is lifted out of gamemode.js between its markers
// and run in a vm with a stand-in mp, the way test-afk.js, test-join-pass-game.js,
// test-load-order-refusal.js and test-bans-pk.js run them. A restart's kick
// does not say it: that reconnect is wanted.
//
// THE RELAY. thornswood-chat.js hands { end } from the server, and only from
// the server, to the front as 'session:end' with the sentence.
//
// THE GAME. The front's idle block (where sessionEnded sits beside afkOut) is
// lifted out of thornswood-front.js and run with a stand-in game and a model
// of skymp5-client's networking: a kick reaches the client only while it has
// a connection, and the client answers it by connecting again. The front
// closes the connection before the kick, so there is nothing to answer, and
// nothing connects again until a character is picked (relogAs, also lifted).
//
// THE MENU. thornswood-select.js in a vm with a stand-in page: the sentence
// over the slots until a pick.
//
// Read only apart from its own temp folder. Nothing connects to anything.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..', '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const src = read('game/gamemode.js');
const front = read('game/plugins/thornswood-front.js');
const chatJs = read('game/ui/thornswood-chat.js');
const page = read('game/ui/thornswood-select.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function block(name) {
  const a = src.indexOf('// ==== thornswood ' + name + ' ====');
  const b = a < 0 ? -1 : src.indexOf('// ==== end thornswood ' + name + ' ====', a);
  return (a >= 0 && b > a) ? src.slice(a, b) : null;
}
const PRIV = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-1157-'));
const ACTOR = 0xff000000;

// =================================================================== the server

// ---- the door: somebody past the line (seats block)
(function () {
  const SEATS = block('seats');
  yes('the seats block is in gamemode.js between its markers', !!SEATS);
  if (!SEATS) { return; }
  const r = { lines: [], told: [], kicked: [], timers: [], online: [], intervals: [], order: [] };
  const box = {
    console: { log: function () { } },
    Date: Date, Math: Math, Number: Number, String: String, Object: Object, Array: Array, JSON: JSON,
    require: require,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function (fn, ms) { r.intervals.push({ fn: fn, ms: ms }); return r.intervals.length; },
    clearInterval: function () { },
    mp: {
      getServerSettings: function () { return { thornswoodMostOnline: 3, maxPlayers: 5, privDir: PRIV }; },
      getUserByActor: function (actorId) {
        return r.online.some(function (o) { return o.actorId === actorId; }) ? actorId - ACTOR : -1;
      },
      get: function (id, what) {
        if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
        const o = r.online.filter(function (x) { return x.actorId === id; })[0];
        if (!o) { throw new Error('no such actor'); }
        if (what === 'profileId') { return o.profileId; }
        return null;
      },
      kick: function (userId) { r.kicked.push(userId); r.order.push('kick ' + userId); }
    },
    __thornswoodToProfile: function (p, text) { r.told.push({ p: p, text: text }); r.order.push('told ' + p); },
    __thornswoodSayLine: function (p, what) {
      r.lines.push({ p: p, what: JSON.parse(JSON.stringify(what)) });
      r.order.push('line ' + p + ' ' + JSON.stringify(what));
    },
    __thornswoodHoldsStaffRole: function () { return false; },
    __thornswoodPassSeen: { passes: {}, online: {}, said: {} },
    __thornswoodCommandPoll: { okAt: 0, failAt: 0 }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(SEATS, box);
  const tick = r.intervals.filter(function (i) { return i.ms === 2000; })[0];
  yes('the seats block arms its sweep', !!tick);
  if (!tick) { return; }
  // Three in the world (the number), then a fourth arrives past it.
  [101, 102, 103].forEach(function (p) { r.online.push({ actorId: ACTOR + p, profileId: p }); });
  tick.fn();
  r.online.push({ actorId: ACTOR + 104, profileId: 104 });
  tick.fn();
  const told = r.told.filter(function (t) { return t.p === 104; });
  const ends = r.lines.filter(function (l) { return l.p === 104 && l.what.end; });
  yes('the door tells the one past the line why, once', told.length === 1 && /Thornswood is full/.test(told[0].text));
  yes('and says { end: <that sentence> } on their line, so their game ends its side',
      ends.length === 1 && ends[0].what.end === told[0].text);
  yes('before the kick: nothing is kicked until the timer', r.kicked.length === 0);
  r.timers.splice(0).forEach(function (fn) { fn(); });
  yes('the kick still comes, for a game that does not close (' + r.order.join(' | ') + ')',
      r.kicked.indexOf(104) >= 0 && r.order.indexOf('kick 104') > r.order.findIndex(function (o) { return o.indexOf('line 104 {"end"') === 0; }));
  yes('nobody seated is told anything', r.told.every(function (t) { return t.p === 104; }) &&
      r.lines.every(function (l) { return l.p === 104; }));
  // Moved out for being idle keeps its own word: a place in line, not an end.
  r.seatsApi = box.__thornswoodSeats;
  r.lines.length = 0;
  r.seatsApi.idleOut(101, Date.now(), r.seatsApi.liveHow(), ACTOR + 101);
  yes('moved out for being idle is still { afk: out } with a place in line, not an end (#1142)',
      r.lines.some(function (l) { return l.p === 101 && l.what.afk === 'out'; }) &&
      !r.lines.some(function (l) { return l.what.end; }));
})();

// ---- the join pass
(function () {
  const JP = block('join pass');
  yes('the join pass block is in gamemode.js between its markers', !!JP);
  if (!JP) { return; }
  fs.writeFileSync(path.join(PRIV, 'door.json'), JSON.stringify({ site: 'https://example.test/dev', key: 'k', passKey: 'test-pass-key-not-a-real-one' }));
  const r = { told: [], lines: [], kicked: [], timers: [], order: [] };
  const box = {
    console: { log: function () { } },
    require: require, Buffer: Buffer,
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    mp: {
      getServerSettings: function () { return { privDir: PRIV, thornswoodServer: 'dev', thornswoodRequirePass: true }; },
      getUserByActor: function (actorId) { return actorId === ACTOR + 700 ? 7 : -1; },
      get: function () { return undefined; },
      kick: function (u) { r.kicked.push(u); r.order.push('kick'); }
    },
    __thornswoodSayLine: function (p, what) { r.lines.push({ p: p, what: what }); r.order.push('line'); }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(JP, box);
  const jp = box.__thornswoodJoinPass;
  const online = [{ actorId: ACTOR + 700, profileId: 700 }];
  const T0 = Date.now();
  const say = function (p, t) { r.told.push({ p: p, text: t }); r.order.push('told'); };
  jp.sweep(T0, online, say);
  jp.sweep(T0 + 181000, online, say);
  const sentence = r.told.length ? r.told[r.told.length - 1].text : '';
  yes('no join pass in three minutes: told to update and start from the launcher', /Thornswood launcher/.test(sentence));
  yes('and { end: <that sentence> } on their line, before the kick',
      r.lines.length === 1 && r.lines[0].p === 700 && r.lines[0].what.end === sentence && r.kicked.length === 0);
  r.timers.splice(0).forEach(function (fn) { fn(); });
  yes('then the kick', r.kicked.length === 1 && r.order.indexOf('line') < r.order.indexOf('kick'));
})();

// ---- the load order: no report
(function () {
  const LO = block('load order refusal');
  yes('the load order block is in gamemode.js between its markers', !!LO);
  if (!LO) { return; }
  const r = { told: [], lines: [], kicked: [], timers: [], order: [] };
  const box = {
    console: { log: function () { } },
    Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    mp: {
      getServerSettings: function () { return { thornswoodLoadOrderRefuse: true }; },
      getUserByActor: function (actorId) { return actorId === ACTOR + 12 ? 7 : -1; },
      get: function () { return []; },
      kick: function (u) { r.kicked.push(u); r.order.push('kick'); }
    },
    __thornswoodSayLine: function (p, what) { r.lines.push({ p: p, what: what }); r.order.push('line'); }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(LO, box);
  box.__thornswoodManifestMods = [{ filename: 'Skyrim.esm', size: 1, crc32: 1 }];
  const lo = box.__thornswoodLoadOrder;
  const online = [{ actorId: ACTOR + 12, profileId: 12 }];
  const say = function (p, t) { r.told.push({ p: p, text: t }); r.order.push('told'); };
  const T0 = Date.now();
  box.__thornswoodCommandPoll = { okAt: T0, failAt: 0 };
  lo.sweep(T0, online, say);
  const later = T0 + 301000;
  box.__thornswoodCommandPoll = { okAt: later, failAt: 0 };
  lo.sweep(later, online, say);
  const sentence = r.told.length ? r.told[r.told.length - 1].text : '';
  yes('no load order report in five minutes: told to press Fix and Play again', /press Fix in the launcher/.test(sentence));
  yes('and { end: <that sentence> } on their line, before the kick',
      r.lines.length === 1 && r.lines[0].p === 12 && r.lines[0].what.end === sentence && r.kicked.length === 0);
  r.timers.splice(0).forEach(function (fn) { fn(); });
  yes('then the kick', r.kicked.length === 1 && r.order.indexOf('line') < r.order.indexOf('kick'));
  yes('a load order that differs passes the same sentence it told to the end line',
      /var told = loadOrderSentence\(verdict, true\);\s*tell\(told\);[\s\S]{0,300}refuseLater\(profileId, actorId, told\);/.test(LO));
})();

// ---- staff: /kick, a ban and a character dead for good
(function () {
  const STAFF = block('staff');
  yes('the staff block is in gamemode.js between its markers', !!STAFF);
  if (!STAFF) { return; }
  const WORLD = {
    0xff000001: { pid: 1001, name: 'Aela' },
    0xff000003: { pid: 2002, name: 'Bjorn' },
    0xff000007: { pid: 6006, name: 'Sigrid' },
    0xff000004: { pid: 4001, name: 'Cara' }
  };
  function load() {
    const w = { said: [], lines: [], kicked: [], timeouts: [], order: [] };
    const mp = {
      get: function (id, key) {
        if (id === 0 && key === 'onlinePlayers') { return Object.keys(WORLD).map(Number); }
        const a = WORLD[id];
        if (!a) { throw new Error('no such actor'); }
        if (key === 'profileId') { return a.pid; }
        if (key === 'appearance') { return { name: a.name }; }
        if (key === 'worldOrCellDesc') { return 'Whiterun:1'; }
        if (key === 'pos' || key === 'angle') { return [0, 0, 0]; }
        return undefined;
      },
      set: function () { },
      getServerSettings: function () { return { privDir: PRIV }; },
      getUserByActor: function (a) { return WORLD[a] ? 70 + WORLD[a].pid : -1; },
      kick: function (u) { w.kicked.push(u); w.order.push('kick ' + u); }
    };
    const later = Date.now() + 600000;
    const g = {
      __thornswoodToProfile: function (pid, text) { w.said.push({ pid: pid, text: String(text) }); w.order.push('told ' + pid); },
      __thornswoodSayLine: function (pid, what) { w.lines.push({ pid: pid, what: what }); w.order.push('line ' + pid); },
      __thornswoodPassSeen: { passes: { 1001: { at: Date.now(), x: later } } },
      __thornswoodSocial: {
        findPerson: function (want) {
          const low = String(want).toLowerCase();
          const hit = Object.keys(WORLD).map(Number).filter(function (a) { return WORLD[a].name.toLowerCase().indexOf(low) === 0; });
          return hit.length === 1 ? { actorId: hit[0], why: '' } : { actorId: 0, why: 'Nobody here by that name.' };
        }
      }
    };
    const run = new Function('mp', 'require', 'globalThis', 'console', 'URL', 'Buffer', 'log', 'guard',
      'voicePort', 'setInterval', 'clearInterval', 'setTimeout', 'addItem', 'idOf', 'placeActors',
      STAFF + '\nreturn globalThis.__thornswoodStaff;');
    w.api = run(mp, require, g, { log: function () { } }, URL, Buffer, function () { },
      function (n, fn) { return fn; }, function () { return 1; },
      function () { return 0; }, function () { },
      function (fn, ms) { w.timeouts.push({ fn: fn, ms: ms }); return 0; },
      function () { return false; }, function () { return 0; }, function () { return { made: 0 }; });
    w.to = function (pid) { return w.said.filter(function (s) { return s.pid === pid; }).map(function (s) { return s.text; }); };
    w.endsTo = function (pid) { return w.lines.filter(function (l) { return l.pid === pid && l.what.end; }).map(function (l) { return l.what.end; }); };
    w.fire = function () { w.timeouts.splice(0).forEach(function (t) { t.fn(); }); };
    return w;
  }
  const isStaff = function (pid) { return pid === 1001; };

  fs.writeFileSync(path.join(PRIV, 'allowed.json'), JSON.stringify({ at: new Date().toISOString(), profiles: [], bans: [], pk: [] }));
  let w = load();
  w.api.command({ proven: true }, '/kick', ['/kick', 'Bjorn', 'spamming'], 1001, 0xff000001, isStaff, null);
  yes('/kick tells Bjorn why', w.to(2002).length === 1 && /^Staff have ended your session: spamming\./.test(w.to(2002)[0]));
  yes('and says { end: <that sentence> } on his line, before the kick',
      w.endsTo(2002).length === 1 && w.endsTo(2002)[0] === w.to(2002)[0] && w.kicked.length === 0);
  yes('the moderator gets no end line', w.endsTo(1001).length === 0);
  w.fire();
  yes('then the kick', w.kicked.indexOf(70 + 2002) >= 0 && w.order.indexOf('line 2002') < w.order.indexOf('kick ' + (70 + 2002)));

  fs.writeFileSync(path.join(PRIV, 'allowed.json'), JSON.stringify({
    at: new Date().toISOString(), profiles: [], pk: [6006],
    bans: [{ profiles: [4001], why: 'alt accounts', until: Date.now() + 86400000, scope: 'account' }]
  }));
  w = load();
  w.api.banSweep();
  yes('a ban the door names: told, and the same sentence as { end } on the line, before the kick',
      w.to(4001).length === 1 && /^You are banned from Thornswood/.test(w.to(4001)[0]) &&
      w.endsTo(4001).length === 1 && w.endsTo(4001)[0] === w.to(4001)[0] && w.kicked.length === 0);
  yes('a character dead for good: told, and the same sentence as { end }, before the kick',
      w.to(6006).length === 1 && /^This character has died for good/.test(w.to(6006)[0]) &&
      w.endsTo(6006).length === 1 && w.endsTo(6006)[0] === w.to(6006)[0]);
  w.fire();
  yes('then both kicks', w.kicked.indexOf(70 + 4001) >= 0 && w.kicked.indexOf(70 + 6006) >= 0);
  w.api.banSweep();
  yes('and the next sweep says neither again', w.to(4001).length === 1 && w.endsTo(4001).length === 1);
})();

// ---- a restart's kick does not end anything for good: that reconnect is wanted
(function () {
  const at = src.indexOf("log('restart: cleared the server,");
  const from = at < 0 ? -1 : src.lastIndexOf('var gone = 0;', at);
  const restart = (from >= 0 && at > from) ? src.slice(from, at) : '';
  yes('the restart\'s kick loop is where this expects it', !!restart && /mp\.kick\(userId\);/.test(restart));
  yes('and says no end line, so the game comes back after the restart as before', restart.indexOf('end:') < 0 &&
      restart.indexOf('__thornswoodSayLine') < 0);
})();

// =================================================================== the relay
(function () {
  const sent = [];
  const sockets = [];
  const win = {
    THORNSWOOD: { host: 'h', port: 1, profileId: 4242, token: 'v1.4242.9.x', base: 'https://h.test/voice' },
    thornswoodChat: { add: function () { } },
    skyrimPlatform: { sendMessage: function () { sent.push(Array.prototype.slice.call(arguments)); } }
  };
  const box = { window: win, console: console, JSON: JSON, Number: Number, String: String, Math: Math, Date: Date,
                setTimeout: function () { return 1; }, setInterval: function () { return 0; }, clearTimeout: function () { },
                WebSocket: function () {
                  const me = this; me.readyState = 1; sockets.push(me);
                  me.send = function () { }; me.close = function () { me.readyState = 3; };
                } };
  vm.createContext(box);
  vm.runInContext(chatJs, box);
  const ws = sockets[0];
  yes('the chat page opens its socket', !!ws);
  if (!ws) { return; }
  ws.onopen();
  ws.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
  const SENT = 'Staff have ended your session: spamming. Read the rules on thornswood.net before you come back.';
  ws.onmessage({ data: JSON.stringify({ t: 'chat', from: 0, profileId: 0, name: 'Thornswood line', text: JSON.stringify({ end: SENT }) }) });
  const ends = sent.filter(function (m) { return m[0] === 'thornswood-front' && m[1] === 'session:end'; });
  yes('the relay hands the server\'s end to the front, with the sentence', ends.length === 1 && ends[0][2] === SENT);
  sent.length = 0;
  ws.onmessage({ data: JSON.stringify({ t: 'chat', from: 7, profileId: 44, name: 'Thornswood line', text: JSON.stringify({ end: 'gotcha' }) }) });
  yes('a person naming themselves Thornswood line cannot end anybody\'s session',
      !sent.some(function (m) { return m[1] === 'session:end'; }));
  ws.onmessage({ data: JSON.stringify({ t: 'chat', from: 0, profileId: 0, name: 'Thornswood line', text: JSON.stringify({ place: 2, of: 3 }) }) });
  yes('a place in line is not an end', !sent.some(function (m) { return m[1] === 'session:end'; }));
})();

// =================================================================== the game
const HEAD = '  /*\n    ------------------------------------------------- are you still here (#1142)';
const TAIL = '    if (now - afkLastInput >= AFK_MS) { afkAsk(now); }\n  }));\n';
const fa = front.indexOf(HEAD);
const fb = front.indexOf(TAIL, fa);
yes('the idle block is in thornswood-front.js where this expects it', fa >= 0 && fb > fa);
if (!(fa >= 0 && fb > fa)) { done(); }
const idle = front.slice(fa, fb + TAIL.length);
yes('sessionEnded sits in it beside afkOut', /function sessionEnded\(sentence\) \{/.test(idle));
const RA = '  function relogAs(id) {';
const ra = front.indexOf(RA);
const rb = ra < 0 ? -1 : front.indexOf('\n  }\n', ra);
yes('relogAs, the only way back in from the choice, is in thornswood-front.js', ra >= 0 && rb > ra);
if (!(ra >= 0 && rb > ra)) { done(); }
const relog = front.slice(ra, rb + 4);

/*
  A model of skymp5-client's networking, from networkingService.ts in the
  fork: the game server's kick reaches the client as a "disconnect" packet
  only while the client has a connection (MpClientPlugin's tick reads the
  connection it has), and onTick answers "disconnect" with reconnect(), which
  is createClient. After destroyClient there is no connection to read.
*/
function game() {
  const g = { now: 1000000, logs: [], js: [], told: [], lineStarts: [], handlers: {}, quit: 0,
              net: { up: true, created: 0, destroyed: 0, answered: 0 } };
  const box = {
    Date: { now: function () { return g.now; } }, Math: Math, Number: Number, String: String, JSON: JSON,
    PROFILE: 4242, chooseAtMenu: true, HOST: 'h', client: { 'server-port': 7777 },
    menuPhase: 9, menuAt: 0, menuAsked: 0, menuLoaded: true, menuBeatAt: 0, menuReloads: 0, menuGaveUp: false,
    menuChosenId: 4242, menuAgain: null, relogAt: 5,
    globalThis: { __thornswoodInWorld: true },
    log: function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); },
    guard: function (name, fn) { return fn; },
    T: { js: function (s) { g.js.push(s); return true; }, claimFocus: function () { } },
    inject: function () { },
    tellServer: function (l) { g.told.push(l); },
    keysHeldNow: function () { return 0; },
    raceMenuOpen: function () { return false; },
    myName: function () { return 'Bjorn'; },
    lineStart: function (id, o) { g.lineStarts.push({ id: id, o: o }); },
    sp: {
      on: function (ev, fn) { (g.handlers[ev] = g.handlers[ev] || []).push(fn); },
      storage: {},
      Game: {
        getPlayer: function () {
          return { getPositionX: function () { return 0; }, getPositionY: function () { return 0; },
                   getPositionZ: function () { return 0; }, getAngleZ: function () { return 0; },
                   getAngleX: function () { return 0; } };
        },
        quitToMainMenu: function () { g.quit++; }
      },
      mpClientPlugin: {
        destroyClient: function () { g.net.up = false; g.net.destroyed++; },
        createClient: function () { g.net.up = true; g.net.created++; },
        isConnected: function () { return g.net.up; }
      }
    }
  };
  vm.createContext(box);
  vm.runInContext(idle + '\n' + relog + '\n;globalThis.__api = { relogAs: relogAs,' +
                  ' set endAsked(v) { sessionEndAsked = v; }, get gone() { return afkGone; } };', box);
  g.box = box;
  g.api = box.globalThis.__api;
  g.update = function () { (g.handlers.update || []).forEach(function (fn) { fn(); }); };
  g.pass = function (ms) { const end = g.now + ms; while (g.now < end) { g.now = Math.min(end, g.now + 500); g.update(); } };
  // The server's kick, as skymp5-client sees it.
  g.kick = function () {
    if (!g.net.up) { return; }
    g.net.up = false;
    g.net.answered++;
    box.sp.mpClientPlugin.createClient();
  };
  g.log = function () { return g.logs.join('\n'); };
  return g;
}

const SENTENCE = 'Thornswood is full: 25 people are in the world, the most it holds at once.';

{
  // Before #1157: the kick alone, and the client answers it.
  const G = game();
  G.update();
  G.kick();
  yes('THE BUG, in the model: a kick on its own is answered with a new connection, as the same character',
      G.net.created === 1 && G.net.up === true);
}

{
  const G = game();
  G.update();
  G.pass(3000);
  G.api.endAsked = SENTENCE;
  G.update();
  yes('the server\'s end, from the relay, takes the game out on the next update', G.api.gone === true);
  yes('it closes the game\'s connection itself, before the kick', G.net.destroyed === 1 && G.net.up === false);
  yes('it goes to the main menu', G.quit === 1);
  yes('it is no longer in the world', G.box.globalThis.__thornswoodInWorld === false);
  yes('the character choice comes back: the old one is taken off the page and the menu starts again',
      G.box.menuPhase === 0 && G.box.menuChosenId === 0 && G.box.menuLoaded === false && G.box.relogAt === 0 &&
      G.js.some(function (s) { return /"ts-select","ts-select-css","ts-thornswood-select-js"/.test(s); }));
  yes('with the sentence for the page, and the character they were',
      G.box.menuAgain && G.box.menuAgain.id === 4242 && G.box.menuAgain.ended === SENTENCE);
  yes('no place in line is taken for them, and the server is not told "/afk out"',
      G.lineStarts.length === 0 && G.told.indexOf('/afk out') < 0);
  yes('the log says it, with the sentence', /session: the server ended it \("Thornswood is full/.test(G.log()));
  G.pass(10000);
  G.kick();
  yes('the kick that follows finds no connection, so nothing answers it', G.net.answered === 0 && G.net.created === 0);
  G.pass(5 * 60000);
  yes('five minutes at the choice: nothing connects again by itself', G.net.created === 0 && G.net.destroyed === 1 && G.quit === 1);
  G.api.endAsked = SENTENCE;
  G.update();
  yes('a second end while already out does nothing more', G.net.destroyed === 1 && G.quit === 1);
  G.api.relogAs(4242);
  yes('picking a character is what connects again, once', G.net.created === 1 && G.net.up === true &&
      G.box.sp.storage.authGameData && G.box.sp.storage.authGameData.local.profileId === 4242);
  G.api.endAsked = SENTENCE;
  G.update();
  yes('refused again while the world is still loading after that pick: ended again, before any kick',
      G.net.destroyed === 2 && G.net.up === false && G.quit === 2 && G.box.menuAgain && G.box.menuAgain.ended === SENTENCE);
  G.pass(5 * 60000);
  yes('and again nothing connects by itself', G.net.created === 1);
  G.api.relogAs(4242);
  G.box.globalThis.__thornswoodInWorld = true;
  G.pass(1000);
  yes('back in the world, the idle clock runs again', !G.api.gone);
}

yes('the front takes session:end from the relay into update, with the sentence',
    /if \(what === 'session:end'\) \{\s*if \(!sessionEndAsked\) \{ sessionEndAsked = String\(a\[2\] \|\| /.test(front));
yes('and ends only a connection that is up', /function sessionEnded\(sentence\) \{\s*let up = false;\s*try \{ up = !!sp\.mpClientPlugin\.isConnected\(\); \}/.test(front));
yes('the page is given the sentence, and no place in line',
    /if \(menuAgain\.ended\) \{ list\.ended = String\(menuAgain\.ended\); \}\s*else if \(menuAgain\.switched\) \{[^]*?\}\);\s*\}\s*else \{ list\.away = menuAgain; \}/.test(front));
yes('picking on the way back connects again through relogAs', /if \(menuAgain\) \{ pickedAgain\(id\); relogAs\(id\); \}/.test(front));

// =================================================================== the menu
function pageRun(list) {
  const made = [];
  const sent = [];
  function node(tag) {
    const kids = {};
    const n = {
      tag: tag, style: {}, textContent: '', innerHTML: '', className: '', dataset: {}, children: [], childNodes: [],
      classList: { add: function () { }, remove: function () { }, contains: function () { return false; }, toggle: function () { } },
      querySelector: function (sel) { return kids[sel] || (kids[sel] = node(sel)); },
      querySelectorAll: function () { return []; },
      addEventListener: function () { }, removeEventListener: function () { },
      appendChild: function (c) { return c; }, removeChild: function () { }, insertBefore: function (c) { return c; },
      setAttribute: function () { }, getAttribute: function () { return null; }, removeAttribute: function () { },
      focus: function () { }, blur: function () { }, play: function () { return Promise.resolve(); }, pause: function () { }, load: function () { },
      getBoundingClientRect: function () { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
      contains: function () { return false; }, parentNode: null, kids: kids
    };
    made.push(n);
    return n;
  }
  const win = {
    THORNSWOOD_SELECT: list,
    skyrimPlatform: { sendMessage: function () { sent.push(Array.prototype.slice.call(arguments)); } },
    addEventListener: function () { }, innerWidth: 1920, innerHeight: 1080,
    getComputedStyle: function () { return {}; },
    localStorage: { getItem: function () { return null; }, setItem: function () { } }
  };
  win.window = win;
  const doc = { createElement: function (t) { return node(t); }, createTextNode: function (t) { return node('#text'); },
                getElementById: function () { return null; },
                head: node('head'), body: node('body'), documentElement: node('html'),
                addEventListener: function () { }, querySelector: function (s) { return node(s); },
                querySelectorAll: function () { return []; } };
  const box = { window: win, document: doc, console: { log: function () { } },
                setInterval: function () { return 1; }, clearInterval: function () { },
                setTimeout: function () { return 1; }, clearTimeout: function () { },
                performance: { timeOrigin: Date.now(), now: function () { return 0; } },
                Date: Date, Math: Math, JSON: JSON, Number: Number, String: String, Array: Array, Object: Object,
                navigator: {}, location: { href: '' }, requestAnimationFrame: function () { } };
  vm.createContext(box);
  let threw = '';
  try { vm.runInContext(page, box); } catch (e) { threw = String(e && e.stack || e); }
  const holder = made.filter(function (n) { return n.kids['.ended']; })[0];
  return { threw: threw, sent: sent, ended: holder ? holder.kids['.ended'] : null,
           cards: made.filter(function (n) { return typeof n.onclick === 'function' && typeof n.onmousedown === 'function'; }) };
}

{
  // The front writes an ended page's list itself, so it says front (#5140).
  const P = pageRun({ characters: [{ profileId: 4242, name: 'Bjorn', slot: 1 }], intro: false, ended: SENTENCE, front: true });
  yes('the choice page runs with LIST.ended' + (P.threw ? ': ' + P.threw : ''), !P.threw);
  yes('the sentence is over the slots', !!P.ended && P.ended.textContent === SENTENCE && P.ended.style.display === 'block');
  yes('and the page says so to the front log',
      P.sent.some(function (m) { return m[0] === 'thornswood-front' && /^select:ended: /.test(String(m[1])); }));
  const card = P.cards[0];
  yes('a character to click is drawn', !!card);
  if (card) { card.onclick(); }
  yes('a pick takes the sentence away', !!P.ended && P.ended.style.display === 'none');
  const Q = pageRun({ characters: [{ profileId: 4242, name: 'Bjorn', slot: 1 }], intro: false });
  yes('with no end the page shows no sentence', !Q.threw && (!Q.ended || Q.ended.style.display !== 'block'));
}

done();
