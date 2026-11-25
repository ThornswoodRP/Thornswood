// test-afk.js
//
//     node .\tests\test-afk.js
//
// Are you still here (#1142). Patrick, 29 Sep: "we also need an AFK kick in
// game after 15 mins idle with the opportunity for a menu to pop after that
// 15 minutes with the option to click I am still here, if they do click I'm
// still here it resets, if not it kicks them to the main menu where they can
// rechoose their character and they automatically rejoin the queue with the
// same 1 minute to join rule". Agreed the same day: the window counts down 60
// seconds, and staff get it too.
//
// THE GAME. The idle check in thornswood-front.js is lifted out between its
// heading and the end of its update handler and run in a vm with a stand-in
// game, a clock of its own and the page calls written down: the 15 minutes,
// what counts as input, the window and its keyboard, "I am still here", the
// minute running out, and what leaving the world does (the connection closed,
// the main menu, the choice back with the place in line, "/afk out").
//
// THE WINDOW. thornswood-afk.js in a vm with a small stand-in page: the
// question, the countdown in seconds, the button, Enter.
//
// THE SERVER. The seats and idle blocks of gamemode.js in one vm with a
// stand-in mp: the backstop on no movement and nothing from the game, what
// resets it, the move out (the seat freed for the next in line, the automatic
// place at the end of the line, the relay told, the session ended if the game
// stays, the staff log), and the same minute's Join now on their turn.
//
// THE MENU. The relay hands the server's word to the front; the chat opens
// its connection again as another character; the choice page opens in the
// place and offers another character; the front reconnects on Join now.
//
// Read only apart from its own temp folder. Nothing connects to anything.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const src = read('game/gamemode.js');
const front = read('game/plugins/thornswood-front.js');
const afkPage = read('game/ui/thornswood-afk.js');
const chatJs = read('game/ui/thornswood-chat.js');
const page = read('game/ui/thornswood-select.js');

let pass = 0, fail = 0;
let serverUp = false;
function yes(what, cond) {
  // AFK_DEBUG=1 prints the end of the server log under a server check that fails.
  if (!cond && process.env.AFK_DEBUG && serverUp && S) { console.log(S.log().split('\n').slice(-12).join('\n')); }
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
const EM = String.fromCharCode(0x2014);
const FORBIDDEN = new RegExp('pla' + 'yer', 'i');
function clean(s) { return String(s).indexOf(EM) < 0 && !FORBIDDEN.test(String(s)); }
const MIN = 60000;

// =================================================================== the game
const HEAD = '  /*\n    ------------------------------------------------- are you still here (#1142)';
const TAIL = '    if (now - afkLastInput >= AFK_MS) { afkAsk(now); }\n  }));\n';
const fa = front.indexOf(HEAD);
const fb = front.indexOf(TAIL, fa);
yes('the idle check is in thornswood-front.js where this expects it', fa >= 0 && fb > fa);
if (!(fa >= 0 && fb > fa)) { done(); return; }
const check = front.slice(fa, fb + TAIL.length);

function game() {
  const g = {
    now: 1000000, logs: [], js: [], told: [], injected: [], claims: {}, handlers: {},
    keysDown: 0, racemenu: false, pos: { x: 0, y: 0, z: 0, az: 0, ax: 0 },
    destroyed: 0, quit: 0, lineStarts: []
  };
  const box = {
    Date: { now: function () { return g.now; } }, Math: Math, Number: Number, String: String, JSON: JSON,
    PROFILE: 4242, chooseAtMenu: true, HOST: 'h', client: { 'server-port': 7777 },
    menuPhase: 9, menuAt: 0, menuAsked: 0, menuLoaded: true, menuBeatAt: 0, menuReloads: 0, menuGaveUp: false,
    menuChosenId: 0, menuAgain: null, relogAt: 5,
    globalThis: { __thornswoodInWorld: true },
    log: function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); },
    guard: function (name, fn) { return fn; },
    T: { js: function (s) { g.js.push(s); return true; }, claimFocus: function (who, on) { g.claims[who] = !!on; } },
    inject: function (f) { g.injected.push(f); },
    tellServer: function (l) { g.told.push(l); },
    keysHeldNow: function () { return g.keysDown; },
    raceMenuOpen: function () { return g.racemenu; },
    myName: function () { return 'Bjorn'; },
    lineStart: function (id, o) { g.lineStarts.push({ id: id, o: o }); },
    sp: {
      on: function (ev, fn) { (g.handlers[ev] = g.handlers[ev] || []).push(fn); },
      Game: {
        getPlayer: function () {
          return { getPositionX: function () { return g.pos.x; }, getPositionY: function () { return g.pos.y; },
                   getPositionZ: function () { return g.pos.z; }, getAngleZ: function () { return g.pos.az; },
                   getAngleX: function () { return g.pos.ax; } };
        },
        quitToMainMenu: function () { g.quit++; }
      },
      mpClientPlugin: { destroyClient: function () { g.destroyed++; } }
    }
  };
  vm.createContext(box);
  vm.runInContext(check + '\n;globalThis.__api = { afkStillHere: afkStillHere, get askAt() { return afkAskAt; },' +
                  ' set outAsked(v) { afkOutAsked = v; }, get gone() { return afkGone; } };', box);
  g.box = box;
  g.api = box.globalThis.__api;
  g.fire = function (ev) { (g.handlers[ev] || []).forEach(function (fn) { fn({}); }); };
  g.update = function () { (g.handlers.update || []).forEach(function (fn) { fn(); }); };
  // Time passes in half second samples, as the handler does.
  g.pass = function (ms, each) {
    const end = g.now + ms;
    while (g.now < end) { g.now = Math.min(end, g.now + 500); if (each) { each(); } g.update(); }
  };
  g.log = function () { return g.logs.join('\n'); };
  g.windowUp = function () { return g.api.askAt > 0; };
  return g;
}

let G = game();
yes('it listens for keys, the mouse and a gamepad stick',
    !!(G.handlers.buttonEvent && G.handlers.mouseMove && G.handlers.thumbstickEvent && G.handlers.update));
yes('the numbers: 15 minutes, a 60 second window, "/afk active" at most every two minutes',
    /const AFK_MS = 15 \* 60000;/.test(check) && /const AFK_WINDOW_S = 60;/.test(check) &&
    /const AFK_ACTIVE_EVERY_MS = 120000;/.test(check));
G.update();
G.pass(14 * MIN + 50000);
yes('14 minutes and 50 seconds with nothing: no window yet', !G.windowUp() && G.injected.length === 0);
G.pass(15000);
yes('at 15 minutes the window goes up', G.windowUp() && G.injected.indexOf('thornswood-afk.js') >= 0 &&
    G.js.some(function (s) { return /thornswoodAfk\.ask\(60\)/.test(s) && /THORNSWOOD_AFK_ASK=60/.test(s); }));
yes('and takes the keyboard so the button can be clicked', G.claims.afk === true);
yes('and the log says why', /idle: nothing from the keyboard, mouse or character in 15 minutes, asking "Are you still here\?"/.test(G.log()));
G.pass(30000, function () { G.fire('buttonEvent'); G.pos.x += 100; });
yes('while it is up only its button counts: keys and moving do not close it', G.windowUp());
G.api.afkStillHere();
yes('"I am still here" closes it, gives the keyboard back and tells the server',
    !G.windowUp() && G.claims.afk === false && G.told.indexOf('/afk here') >= 0 &&
    G.js.some(function (s) { return /thornswoodAfk&&window\.thornswoodAfk\.close\(\)/.test(s); }));
G.pass(14 * MIN);
yes('and the 15 minutes start again from the press', !G.windowUp());
G.pass(61000);
yes('15 minutes after the press it asks again', G.windowUp());

// Each kind of input keeps the window away.
function keptAwayBy(what, each) {
  const h = game();
  h.update();
  h.pass(16 * MIN, function () { if (h.now % (5 * MIN) < 500) { each(h); } });
  return !h.windowUp() && !/asking/.test(h.log());
}
yes('a key or mouse button now and then keeps it away', keptAwayBy('keys', function (h) { h.fire('buttonEvent'); }));
yes('the mouse moving keeps it away', keptAwayBy('mouse', function (h) { h.fire('mouseMove'); }));
yes('a gamepad stick keeps it away', keptAwayBy('stick', function (h) { h.fire('thumbstickEvent'); }));
yes('a key held while the chat or a panel has the keyboard keeps it away',
    keptAwayBy('held', function (h) { h.keysDown = 1; h.update(); h.keysDown = 0; }));
yes('walking keeps it away', keptAwayBy('walk', function (h) { h.pos.x += 50; }));
yes('turning keeps it away', keptAwayBy('turn', function (h) { h.pos.az += 3; }));
yes('a step too small to be a step does not', !keptAwayBy('twitch', function (h) { h.pos.x += 1; }));
yes('the race menu is never idle', (function () {
  const h = game(); h.racemenu = true; h.update(); h.pass(20 * MIN); return !h.windowUp();
})());
yes('at the menu, out of the world, nothing is counted', (function () {
  const h = game(); h.box.globalThis.__thornswoodInWorld = false; h.update(); h.pass(20 * MIN); return !h.windowUp();
})());

// "/afk active" while somebody is there, never more than every two minutes, and never while nobody is.
G = game();
G.update();
G.pass(10 * MIN, function () { G.fire('mouseMove'); });
const actives = G.told.filter(function (t) { return t === '/afk active'; }).length;
yes('input all the time says "/afk active" every two minutes, not more (' + actives + ' in 10 minutes)', actives >= 4 && actives <= 6);
G.pass(2 * MIN + 1000);
G.told.length = 0;
G.pass(10 * MIN);
yes('and nothing at all once there is no input (the last input is said within two minutes, then silence)',
    G.told.indexOf('/afk active') < 0);

// The minute runs out.
G = game();
G.update();
G.pass(15 * MIN + 1000);
yes('the window is up', G.windowUp());
G.pass(G.api.askAt + 59000 - G.now);
yes('59 seconds on it is still waiting for the button', !G.api.gone && G.destroyed === 0);
G.pass(1500);
yes('60 seconds with no press: out of the world', G.api.gone);
yes('it tells the server "/afk out"', G.told.indexOf('/afk out') >= 0);
yes('it closes its own connection to the game server, so the client does not come straight back in', G.destroyed === 1);
yes('it goes to the main menu', G.quit === 1);
yes('it is no longer in the world', G.box.globalThis.__thornswoodInWorld === false);
yes('the window and its keyboard go', !G.windowUp() && G.claims.afk === false);
yes('the character choice comes back: the old one is taken off the page and the menu starts again',
    G.box.menuPhase === 0 && G.box.menuChosenId === 0 && G.box.menuLoaded === false &&
    G.js.some(function (s) { return /"ts-select","ts-select-css","ts-thornswood-select-js"/.test(s) && /window\.thornswoodSelect=undefined/.test(s); }));
yes('it remembers the character they were, for the page', G.box.menuAgain && G.box.menuAgain.id === 4242 && G.box.menuAgain.name === 'Bjorn');
yes('and waits in line as that character straight away: the place is automatic',
    G.lineStarts.length === 1 && G.lineStarts[0].id === 4242 && G.lineStarts[0].o === null);
yes('the log says it', /idle: no answer to "Are you still here\?" in 60 seconds, so out of the world to the character choice as profile 4242/.test(G.log()));
G.pass(20 * MIN);
yes('once out, nothing asks again at the menu', G.destroyed === 1 && G.quit === 1);
G.box.globalThis.__thornswoodInWorld = true;
G.pass(1000);
yes('back in the world the clock starts again', !G.api.gone && !G.windowUp());
G.pass(15 * MIN + 1000);
yes('and 15 minutes later it asks again', G.windowUp());

// The server moved them: the same, from the relay, in update.
G = game();
G.update();
G.pass(3 * MIN, function () { G.fire('mouseMove'); });
G.api.outAsked = 'the server moved them out for being idle';
G.update();
yes('the server word (over the relay) takes the game out too, on the next update', G.api.gone && G.destroyed === 1 && G.quit === 1);
yes('the front takes afk:out from the page into update, where the main menu can be reached',
    /if \(what\.indexOf\('afk:out'\) === 0\) \{[\s\S]{0,300}afkOutAsked = 'the server moved them out for being idle';/.test(front) &&
    /if \(what === 'afk:here'\) \{ afkStillHere\(\); return; \}/.test(front));

// Back in: the front connects again as the picked character.
yes('picking on the way back connects again as that character: authGameData then createClient',
    /if \(menuAgain\) \{ pickedAgain\(id\); relogAs\(id\); \}/.test(front) &&
    /sp\.storage\.authGameData = \{ local: \{ profileId: id \} \};[\s\S]{0,300}sp\.mpClientPlugin\.createClient\(host, port\);/.test(front) &&
    /try \{ up = !!sp\.mpClientPlugin\.isConnected\(\); \}/.test(front));
yes('the menu shows the choice again even though a choice is on disk for this session',
    /if \(!menuAgain && chosenOnDisk\(\)\)/.test(front));
yes('the page is given the character they were, with no scroll and no theme',
    /if \(menuAgain\) \{\s*list\.intro = false; list\.music = '';\s*if \(menuAgain\.ended\) \{ list\.ended = String\(menuAgain\.ended\); \}\s*else if \(menuAgain\.switched\) \{[^]*?\}\);\s*\}\s*else \{ list\.away = menuAgain; \}\s*\}/.test(front));
yes('arriving in the world ends it', /menuChosenId = 0;\s*menuAgain = null;/.test(front));
yes('another character takes the place with "/line hand" before the connection becomes theirs',
    /if \(lineId\) \{ lineHand\(id\); return; \}/.test(front) &&
    /say\(' \+ JSON\.stringify\('\/line hand ' \+ id\) \+ ',\{quiet:true\}\)/.test(front) &&
    /thornswoodNet\.rejoinAs\(' \+ lineId \+ ','/.test(front));
yes('the window is one of the overlays, and one the two minute rescue can close by name',
    (function () { const m = /const OVERLAYS = (\[[\s\S]*?\]);/.exec(front); const list = m ? new Function('return ' + m[1])() : []; return list.indexOf('thornswood-afk.js') >= 0; })() && /afk: 'thornswoodAfk'/.test(front));

// =================================================================== the window
function windowPage(preset) {
  const told = [];
  const keys = [];
  function node(tag) {
    const n = { tag: tag, className: '', textContent: '', innerHTML: '', id: '', kids: {}, listeners: {} };
    n.querySelector = function (sel) { if (!n.kids[sel]) { n.kids[sel] = node('x'); n.kids[sel].parentNode = n; } return n.kids[sel]; };
    n.addEventListener = function (ev, fn) { n.listeners[ev] = fn; };
    n.appendChild = function (c) { c.parentNode = n; return c; };
    n.focus = function () { box.document.activeElement = n; };
    n.contains = function (other) { while (other) { if (other === n) { return true; } other = other.parentNode; } return false; };
    return n;
  }
  const win = {
    skyrimPlatform: { sendMessage: function (a, b) { told.push(a + ' ' + b); } },
    addEventListener: function (ev, fn) { if (ev === 'keydown') { keys.push(fn); } },
    THORNSWOOD_AFK_ASK: preset || 0
  };
  let root = null;
  const clock = { now: 5000 };
  const box = {
    window: win, Math: Math, Number: Number, String: String,
    Date: { now: function () { return clock.now; } },
    setInterval: function () { return 1; }, clearInterval: function () { },
    document: {
      createElement: function (t) { const n = node(t); if (t === 'div' && !root) { root = n; } return n; },
      head: node('head'), body: node('body')
    }
  };
  vm.createContext(box);
  vm.runInContext(afkPage, box);
  return { win: win, told: told, keys: keys, clock: clock, root: function () { return root; },
           left: function () { return root.querySelector('.left').textContent; },
           press: function () { root.querySelector('.here').listeners.click(); } };
}
let W = windowPage(0);
yes('the window file puts window.thornswoodAfk on the page and shows nothing by itself',
    !!(W.win.thornswoodAfk && W.win.thornswoodAfk.ask) && W.root() === null);
W.win.thornswoodAfk.ask(60);
yes('ask(60) shows it and says so', W.win.thornswoodAfk.isOpen() && W.told.indexOf('thornswood-front afk:shown') >= 0);
const HTML = W.root().innerHTML;
yes('it asks "Are you still here?" with an "I am still here" button',
    /Are you still here\?/.test(HTML) && />I am still here<\/button>/.test(HTML));
yes('the words are clean', clean(HTML) && clean(W.left()));
yes('it counts down from 60 seconds', W.left() === 'Back to the character choice in 60 seconds.');
W.clock.now += 59000; W.win.thornswoodAfk.close(); W.win.thornswoodAfk.ask(1);
yes('one second reads as one second', W.left() === 'Back to the character choice in 1 second.');
W.clock.now += 1000;
yes('and at the end no seconds are left', W.win.thornswoodAfk.left() === 0);
W.press();
yes('pressing the button closes it and tells the front', !W.win.thornswoodAfk.isOpen() &&
    W.told.indexOf('thornswood-front afk:here') >= 0);
W = windowPage(60);
yes('a window asked for before the file was in shows as soon as it is', W.win.thornswoodAfk.isOpen() && W.win.THORNSWOOD_AFK_ASK === 0);
W.keys[0]({ key: 'Enter', preventDefault: function () { } });
yes('Enter presses the button', !W.win.thornswoodAfk.isOpen() && W.told.indexOf('thornswood-front afk:here') >= 0);
W.told.length = 0; W.keys[0]({ key: 'Enter', preventDefault: function () { } });
yes('and does nothing while the window is down', W.told.length === 0);

// =================================================================== the server
const sa = src.indexOf('// ==== thornswood seats ====');
const sb = src.indexOf('// ==== end thornswood idle ====');
const ia = src.indexOf('// ==== thornswood idle ====');
yes('the idle block follows the seats block in gamemode.js', sa >= 0 && ia > sa && sb > ia);
if (!(sa >= 0 && ia > sa && sb > ia)) { done(); return; }
const blocks = src.slice(sa, sb);
const ACTOR = 0xff000000;
// private in a scratch folder of its own, so the staff log lands in for-bot beside it (#2321).
const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'afk-'));
const PRIV = path.join(SCRATCH, 'private');
fs.mkdirSync(PRIV, { recursive: true });

function server(settings) {
  // asking: the profiles whose menus say "/line" every 10 seconds, as the front does while it waits.
  const r = { lines: [], told: [], logged: [], kicked: [], timers: [], online: [], staff: {}, now: 1000000,
              where: {}, creating: {}, intervals: [], asking: {} };
  const box = {
    console: { log: function () { r.logged.push(Array.prototype.join.call(arguments, ' ')); } },
    Date: Object.assign(function () { return new Date(r.now); }, { now: function () { return r.now; } }),
    Math: Math, Number: Number, String: String, Object: Object, Array: Array, JSON: JSON,
    require: require,
    setTimeout: function (fn) { r.timers.push(fn); return r.timers.length; },
    setInterval: function (fn, ms) { r.intervals.push({ fn: fn, ms: ms }); return r.intervals.length; },
    clearInterval: function () { },
    mp: {
      getServerSettings: function () { return settings; },
      getUserByActor: function (actorId) {
        for (let i = 0; i < r.online.length; i++) { if (r.online[i].actorId === actorId) { return actorId - ACTOR; } }
        return -1;
      },
      get: function (id, what) {
        if (id === 0 && what === 'onlinePlayers') { return r.online.map(function (o) { return o.actorId; }); }
        const o = r.online.filter(function (x) { return x.actorId === id; })[0];
        if (!o) { throw new Error('no such actor'); }
        if (what === 'profileId') { return o.profileId; }
        const w = r.where[o.profileId] || { pos: [0, 0, 0], rot: [0, 0, 0] };
        if (what === 'pos') { return w.pos.slice(); }
        if (what === 'angle') { return w.rot.slice(); }
        if (what === 'appearance') { return { name: 'Name' + o.profileId }; }
        return null;
      },
      kick: function (userId) { r.kicked.push(userId); }
    },
    __thornswoodToProfile: function (p, text) { r.told.push({ p: p, text: text }); },
    __thornswoodSayLine: function (p, what) {
      r.lines.push({ p: p, what: JSON.parse(JSON.stringify(what)) });
      // Their game, back at the choice, waits in line as that character from now on.
      if (what && what.afk === 'out') { r.asking[p] = true; }
    },
    __thornswoodHoldsStaffRole: function (p) { return !!r.staff[p]; },
    __thornswoodPassSeen: { passes: {}, online: {}, said: {} },
    __thornswoodCommandPoll: { okAt: 0, failAt: 0 },
    __thornswoodChargen: { inCreation: function (actorId) { return !!r.creating[actorId - ACTOR]; } }
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(blocks, box);
  r.box = box;
  r.seats = box.__thornswoodSeats;
  r.idle = box.__thornswoodIdle;
  // Both blocks' timers, each on its own period.
  const seatsTick = r.intervals.filter(function (i) { return i.ms === 2000; })[0];
  const idleTick = r.intervals.filter(function (i) { return i.ms === 5000; })[0];
  r.pass = function (ms, each) {
    const end = r.now + ms;
    while (r.now < end) {
      r.now = Math.min(end, r.now + 1000);
      if (each) { each(); }
      if (r.now % 10000 === 0) {
        for (const p in r.asking) { if (r.seats.want(Number(p), r.now, r.seats.liveHow()) === 'in the world') { delete r.asking[p]; } }
      }
      if (r.now % 2000 === 0) { seatsTick.fn(); }
      if (r.now % 5000 === 0) { idleTick.fn(); }
    }
  };
  r.join = function (pid) { r.online.push({ actorId: ACTOR + pid, profileId: pid }); };
  r.leave = function (pid) { r.online = r.online.filter(function (o) { return o.profileId !== pid; }); };
  // Long enough for both blocks to have seen everybody once.
  r.fill = function (from, n) { for (let p = 0; p < n; p++) { r.join(from + p); } r.pass(5000); };
  r.want = function (pid) { r.asking[pid] = true; return r.seats.want(pid, r.now, r.seats.liveHow()); };
  r.afk = function (pid, word) { return r.idle.heard(pid, word, r.now, r.idle.liveHow()); };
  r.runTimers = function () { const t = r.timers; r.timers = []; t.forEach(function (fn) { fn(); }); };
  r.linesTo = function (pid) { return r.lines.filter(function (t) { return t.p === pid; }).map(function (t) { return t.what; }); };
  r.lastLine = function (pid) { const l = r.linesTo(pid); return l.length ? l[l.length - 1] : null; };
  r.saidTo = function (pid) { return r.told.filter(function (t) { return t.p === pid; }); };
  r.log = function () { return r.logged.join('\n'); };
  r.moved = function (pid, n) { const w = r.where[pid] || (r.where[pid] = { pos: [0, 0, 0], rot: [0, 0, 0] }); w.pos[0] += (n || 100); };
  r.staffLog = function () {
    try {
      return fs.readFileSync(path.join(SCRATCH, 'for-bot', 'moderation.log'), 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
    } catch (e) { return []; }
  };
  return r;
}

const SEATS = { thornswoodMostOnline: 25, maxPlayers: 30, privDir: PRIV, thornswoodServer: 'dev' };
let S = server(SEATS);
serverUp = true;
yes('the idle block says at startup what it does',
    /idle: after 15 minutes with no input the game asks "Are you still here\?" for 60 seconds; the server moves anybody still for 18 minutes itself/.test(S.log()));
yes('the server backstop is 18 minutes: the game 15, its 60 seconds, and two to spare', S.idle.serverIdle === 18 * MIN);

S.fill(100, 25);
S.want(126); S.pass(2000);
yes('25 in the world and one waiting in line', S.seats.status().line === 1 && S.lastLine(126).place === 1);
// 101 walks about; 102 sends "/afk active" now and then; 103 is in creation; 104 does nothing.
S.creating[103] = true;
S.pass(17 * MIN + 50000, function () {
  if (S.now % 30000 === 0) { S.moved(101); }
  if (S.now % (2 * MIN) === 0) { S.afk(102, 'active'); }
});
yes('17 minutes 50 seconds of standing still with nothing from the game: not yet', !/idle: Name104/.test(S.log()));
S.pass(20000, function () { if (S.now % 30000 === 0) { S.moved(101); } });
yes('at 18 minutes the server moves the one who did nothing, and the log says who and why',
    /idle: Name104 \(profile 104\) was taken out of the world to the character choice and put in line: nothing moved and nothing came from their game for 18 minutes, so the server moved them/.test(S.log()));
yes('walking about keeps somebody in', !/profile 101\) was taken/.test(S.log()));
yes('"/afk active" from their game keeps somebody standing still in', !/profile 102\) was taken/.test(S.log()));
yes('character creation is never idle', !/profile 103\) was taken/.test(S.log()));
yes('the others, who did nothing either, go too, staff with no exemption', (function () {
  return /profile 105\) was taken/.test(S.log()) && /profile 124\) was taken/.test(S.log());
})());
yes('their menus are told over the relay', S.lastLine(104) && S.linesTo(104).some(function (w) { return w.afk === 'out'; }));
yes('the one who was waiting gets the first freed seat, with the minute to press Join now',
    S.linesTo(126).some(function (w) { return w.go === true && w.secs === 60; }) &&
    S.log().indexOf('a seat is held for profile 126') < S.log().indexOf('a seat is held for profile 104'));
yes('those moved out are put in the line by themselves, behind the one already waiting',
    /line: profile 100 was moved out for being idle and waits at the menu, 2 in line/.test(S.log()) &&
    /line: profile 104 was moved out for being idle and waits at the menu, 3 in line/.test(S.log()));
yes('and with seats free their turn comes at once, the same minute to press Join now',
    S.linesTo(104).some(function (w) { return w.go === true && w.secs === 60; }));
yes('the staff log has a line for each, with the server and why',
    S.staffLog().some(function (row) {
      return row.did === 'idle' && row.who === 104 && row.whoName === 'Name104' && row.server === 'dev' &&
             /nothing moved and nothing came from their game/.test(row.why);
    }));
yes('what the staff log says is clean', S.staffLog().every(function (row) { return clean(row.why); }));
S.runTimers();
yes('a game that did not leave by itself has its session ended', S.kicked.indexOf(104) >= 0);

// The game's own "/afk out", the reset, and the seat freeing for the next in line.
S = server(SEATS);
S.fill(200, 25);
S.want(226); S.pass(1000); S.want(227); S.pass(2000);
S.pass(10 * MIN, function () { if (S.now % 60000 === 0) { for (let p = 200; p < 225; p++) { S.moved(p); } } });
yes('"/afk here" is somebody at the game: it resets the clock', S.afk(210, 'here') === 'here');
yes('"/afk out" from somebody not in the world moves nobody and writes nothing', S.afk(9999, 'out') === 'not in the world');
const before = S.staffLog().length;
yes('"/afk out" from their game moves them', S.afk(205, 'out') === 'out' &&
    /idle: Name205 \(profile 205\) was taken out of the world to the character choice and put in line: no answer to "Are you still here\?" within 60 seconds, after 15 minutes with nothing from the keyboard, mouse or character/.test(S.log()));
yes('once only', S.afk(205, 'out') === 'already' && S.staffLog().length === before + 1);
S.pass(2000);
yes('the seat frees at once for the first in line, with the minute to press Join now',
    S.lastLine(226).go === true && S.lastLine(226).secs === 60);
yes('the one moved out is at the end of the line: 2nd of 2 behind the one still waiting',
    S.lastLine(205).place === 2 && S.lastLine(205).of === 2 && S.lastLine(227).place === 1);
yes('while their game is leaving it is not judged as somebody arriving past the line', S.saidTo(205).length === 0);
S.leave(205); S.pass(2000);
S.runTimers();
yes('their game left by itself, so no session needed ending', S.kicked.indexOf(205) < 0);
S.join(226); S.pass(2000);
yes('the first in line takes the freed seat', /profile 226 took the seat held for them/.test(S.log()));
// Their turn comes like anybody's: the same minute.
S.leave(201); S.pass(2000);
yes('when a seat frees, the one who was first in line after them is told to come in', S.lastLine(227).go === true);
S.leave(202); S.pass(2000);
yes('and then the one moved out gets their turn, with the same minute to press Join now',
    S.lastLine(205).go === true && S.lastLine(205).secs === 60);
S.join(205); S.pass(2000);
yes('and pressing Join now brings them back in', /profile 205 took the seat held for them/.test(S.log()) && S.saidTo(205).length === 0);
// Idle again straight after coming back is a fresh clock.
S.pass(6000);
yes('coming back is a fresh clock, not the old one',
    !!S.idle.state.by[205] && S.idle.state.by[205].out === 0 && S.now - S.idle.state.by[205].last <= 10000);
// Back so quickly that the server never saw them gone: still a fresh clock once the move is over.
S.afk(206, 'out'); S.pass(2000);
S.pass(25000);
yes('somebody moved out whose game is still there 20 seconds on is judged afresh, not left out of the watch for good',
    !!S.idle.state.by[206] && S.idle.state.by[206].out === 0);

// A game that stays after being moved out, and comes back in past the line.
S = server(SEATS);
S.fill(300, 25);
S.want(326); S.pass(2000);
S.afk(300, 'out'); S.pass(2000);
S.pass(10000); S.runTimers();
yes('a game still in the world 10 seconds after being moved out has its session ended', S.kicked.indexOf(300) >= 0);
S.pass(S.seats.outFor + 2000);
yes('and if it stays after that, it is somebody past the line and is refused like anybody',
    S.saidTo(300).length === 1 && /door: full, refusing profile 300/.test(S.log()));

// Moved out when nobody else waits: straight to their turn, with the minute.
S = server({ thornswoodMostOnline: 25, maxPlayers: 30, privDir: PRIV });
S.fill(400, 10);
S.afk(401, 'out'); S.pass(2000);
yes('moved out with seats free and nobody waiting, their menu shows their turn at once, with the minute',
    S.lastLine(401).go === true && S.lastLine(401).secs === 60);

// With no number at all, the check still runs and the seat still goes.
S = server({ maxPlayers: 100, privDir: PRIV });
S.fill(500, 3);
S.pass(18 * MIN + 10000);
yes('with no number set, the server still moves somebody idle out, and they can come straight back in',
    /profile 500\) was taken/.test(S.log()) && S.lastLine(500).go === true);

// A hot reload keeps everybody's clock.
S = server(SEATS);
S.fill(600, 3);
S.pass(10 * MIN);
const was = S.idle.state.by[600].last;
vm.runInContext(blocks, S.box);
yes('a hot reload keeps everybody idle clock', S.box.__thornswoodIdle.state.by[600].last === was);

// dispatch and the relay.
yes('dispatch() hands "/afk <word>" to the idle block, with no character needed',
    /if \(word === '\/afk'\) \{[\s\S]{0,300}idleApi\.heard\(profileId, String\(parts\[1\] \|\| ''\)\.toLowerCase\(\), Date\.now\(\), idleApi\.liveHow\(\)\)/.test(src));

// =================================================================== the relay page
(function () {
  const sent = [];
  const sockets = [];
  const win = {
    // The https address the launcher writes; there is no ws:// fallback (#1304).
    THORNSWOOD: { host: 'h', port: 1, profileId: 4242, token: 'v1.4242.9.x', base: 'https://h.test/voice' },
    thornswoodChat: { add: function () { } },
    skyrimPlatform: { sendMessage: function (a, b) { sent.push(a + ' ' + b); } }
  };
  const timers = [];
  const box = { window: win, console: console, JSON: JSON, Number: Number, String: String, Math: Math, Date: Date,
                setTimeout: function (fn) { timers.push(fn); return timers.length; },
                setInterval: function () { return 0; }, clearTimeout: function () { },
                WebSocket: function (url, protocols) {
                  const me = this; me.readyState = 1; me.out = []; me.protocols = protocols || []; sockets.push(me);
                  me.send = function (s) { me.out.push(JSON.parse(s)); };
                  me.close = function () { me.readyState = 3; if (me.onclose) { me.onclose(); } };
                } };
  vm.createContext(box);
  vm.runInContext(chatJs, box);
  const first = sockets[0];
  first.onopen();
  first.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
  first.onmessage({ data: JSON.stringify({ t: 'chat', from: 0, profileId: 0, name: 'Thornswood line', text: '{"afk":"out"}' }) });
  yes('the relay hands the server word that they were moved out to the front', sent.indexOf('thornswood-front afk:out server') >= 0);
  sent.length = 0;
  first.onmessage({ data: JSON.stringify({ t: 'chat', from: 7, profileId: 44, name: 'Thornswood line', text: '{"afk":"out"}' }) });
  yes('a person naming themselves Thornswood line cannot take anybody out', sent.indexOf('thornswood-front afk:out server') < 0);
  yes('rejoinAs as the same character only takes the new token', win.thornswoodNet.rejoinAs(4242, 'v1.4242.10.y') === false &&
      sockets.length === 1 && first.readyState === 1);
  yes('rejoinAs as another character closes the connection', win.thornswoodNet.rejoinAs(5151, 'v1.5151.10.z') === true &&
      first.readyState === 3);
  timers.forEach(function (fn) { fn(); });
  const second = sockets[1];
  yes('and opens it again', !!second);
  if (second) {
    second.onopen();
    const join = second.out.filter(function (m) { return m.t === 'join'; })[0];
    // The token goes with the handshake since #1337, not in the join.
    yes('as that character, with that character own token', join && join.profileId === 5151 &&
        second.protocols[0] === 'thornswood' && second.protocols[1] === 'v1.5151.10.z');
  }
})();

// =================================================================== the choice page
yes('the choice page opens in the place kept for the character they were',
    /var away = \(LIST\.away && Number\(LIST\.away\.id\) > 0\) \? LIST\.away : null;/.test(page) &&
    /if \(away\) \{\s*picked = Number\(away\.id\);[\s\S]{0,300}lineSays\(\{ id: picked \}\);/.test(page));
yes('it says they were away, and why, and that the place is kept',
    /elTitle\.textContent = away \? 'You were away' : 'The world is full';/.test(page) &&
    /You were taken out of the world after 15 minutes with nothing from your keyboard, mouse or character\./.test(page));
yes('Choose another character shows the slots and keeps the place', />Choose another character<\/button>/.test(page) &&
    /function chooseOther\(\) \{[\s\S]{0,400}root\.className = '';[\s\S]{0,300}Your place in line is kept while you choose/.test(page));
yes('the page words are clean', clean((page.match(/var AWAY_WORDS = [\s\S]*?;\n/) || [''])[0]) &&
    clean((page.match(/function chooseOther[\s\S]*?\n  \}\n/) || [''])[0]));

try { fs.rmSync(SCRATCH, { recursive: true, force: true }); } catch (e) { }
done();
