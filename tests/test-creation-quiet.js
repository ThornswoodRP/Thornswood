// test-creation-quiet.js
//
// Creation is quiet: the needs stand still and are not drawn, and the chat
// does not say "Not connected yet" over lines nobody typed.
//
// Patrick, 24 September, with a tester's screenshot of the creation hall: the
// K panel open and asking for a home, the needs bars drawn at 96, 91 and 99
// with Temp at 58, and the chat showing "Not connected yet, that is queued."
// twice and "Chat lost the server. Trying again." once:
//
//   "needs menu shouldnt show or be actuive during creation plus it says
//    mulitple trimes he wasnt connected yet"
//
// Three halves, each driven for real:
//
//   1. The REAL needs block and the REAL chargen global, lifted out of
//      gamemode.js by text, over a fake mp and a fake clock. The needs tick is
//      the one the block hands to setInterval. An hour of ticks in creation
//      leaves every meter exactly where it was; the same hour out of creation
//      moves them; and the moment the stage says done they run, without a
//      reconnect and without being charged for the hour in the hall.
//   2. The HUD script the block registers on its property, which is what the
//      client runs every frame, fed the values the tick wrote and run against
//      a small document. No bars in creation, the bars again after.
//   3. The REAL chat page, thornswood-chat.js, in a sandbox with a fake
//      socket, fed by the REAL tellServer lifted out of thornswood-front.js.
//      A typed line is told it is queued, once; the plugin's own lines are
//      queued without a word; every one of them goes out on connect; and the
//      reconnect setName does on purpose does not say the server was lost.
//
// GM, FRONT and CHAT point it at other copies of the three files, which is how
// it was shown to fail on the code before the change.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const CR = String.fromCharCode(13);
function read(p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); }
const GM = read(process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js'));
const FRONT = read(process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js'));
const CHAT = read(process.env.CHAT || path.join(REPO_DIR, 'game', 'ui', 'thornswood-chat.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------- lifted by text
function between(src, from, to) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(to, a);
  if (b < 0) { return null; }
  return src.slice(a, b + to.length);
}

const NEEDS_BLOCK = between(GM, '// ==== thornswood needs: hunger, thirst and exhaustion ====',
                            '// ==== end thornswood needs ====');
const CHARGEN_GLOBAL = between(GM, 'globalThis.__thornswoodChargen = {', '\n};\n');
const CHARGEN_OF = between(GM, 'function chargenOf(actorId) {', '\n}\n');
// The chargen global hands out the gamemode's own test of a stored face and
// whether a person is in the world for others (#1573), so both are lifted
// with it.
const HAS_STORED = between(GM, '\nfunction hasStoredAppearance(a) {', '\n}\n');
const PUBLISHED = between(GM, '\nfunction publishedForOthers(actorId) {', '\n}\n');
const HALL_SRC = (/\nconst HALL = (\{[\s\S]*?\n\});/.exec(GM) || [])[1] || null;
const CHARGEN_PROPERTY = (/const CHARGEN_PROPERTY = '([^']+)';/.exec(GM) || [])[1] || null;

yes('the needs block, the chargen global, chargenOf, hasStoredAppearance, publishedForOthers, HALL and the property name are all in gamemode.js',
    !!(NEEDS_BLOCK && CHARGEN_GLOBAL && CHARGEN_OF && HAS_STORED && PUBLISHED && HALL_SRC && CHARGEN_PROPERTY));

const HALL = HALL_SRC ? new Function('return ' + HALL_SRC)() : { desc: '' };
const HOUR = 3600000;
const TICK = 20000;

/*
  One world: a fake mp that keeps every property per actor and copies what it
  is given, the way the server serialises it; a clock; and the two real blocks
  wired to each other through one fake global, the way the gamemode wires them.
*/
function world(opts) {
  opts = opts || {};
  const clock = { now: 1790000000000 };
  const props = {};
  const made = {};
  const guarded = {};
  const said = [];
  const online = [];
  const mp = {
    makeProperty: function (name, o) { made[name] = o; },
    getDescFromId: function () { return ''; },
    get: function (id, key) {
      if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
      const p = props[id] || {};
      if (key === 'worldOrCellDesc') { return p.worldOrCellDesc || 'a5a5:Skyrim.esm'; }
      return p[key] === undefined ? undefined : JSON.parse(JSON.stringify(p[key]));
    },
    set: function (id, key, v) {
      if (!props[id]) { props[id] = {}; }
      props[id][key] = JSON.parse(JSON.stringify(v));
    }
  };
  const FakeDate = { now: function () { return clock.now; } };
  const g = {};

  if (opts.chargen !== false) {
    const chargenOf = new Function('mp', 'CHARGEN_PROPERTY', CHARGEN_OF + '\nreturn chargenOf;')(
      mp, CHARGEN_PROPERTY);
    new Function('globalThis', 'mp', 'Date', 'chargenOf', 'setChargen', 'log', 'townsForPanel',
                 'TOWN_BY_KEY', 'CHOOSE_LATER_MS', 'arriveAt', 'HALL', 'CHARGEN_ENABLED',
                 HAS_STORED + PUBLISHED + '\n' + CHARGEN_GLOBAL)(
      g, mp, FakeDate, chargenOf,
      function (id, st) { mp.set(id, CHARGEN_PROPERTY, st); },
      function () { }, function () { return []; }, {}, 600000, function () { return false; },
      HALL, opts.enabled !== false);
  }

  const api = new Function(
    'globalThis', 'mp', 'Date', 'console', 'setInterval', 'clearInterval',
    'guard', 'notify', 'say', 'Math', 'Number', 'String', 'Object', 'isFinite',
    NEEDS_BLOCK + '\nreturn globalThis.__thornswoodNeeds;')(
    g, mp, FakeDate, { log: function () { } },
    function () { return 0; }, function () { },
    function (name, f) { guarded[name] = f; return f; },
    function (id, line) { said.push([id, line]); },
    function (id, line) { said.push([id, line]); },
    Math, Number, String, Object, isFinite);

  return {
    api: api, mp: mp, clock: clock, made: made, said: said, g: g,
    tick: guarded.needsTick,
    online: function (id) { if (online.indexOf(id) < 0) { online.push(id); } },
    stage: function (id, stage) {
      if (stage === null) { if (props[id]) { delete props[id][CHARGEN_PROPERTY]; } return; }
      mp.set(id, CHARGEN_PROPERTY, { stage: stage, at: clock.now });
    },
    standIn: function (id, desc) { if (!props[id]) { props[id] = {}; } props[id].worldOrCellDesc = desc; },
    needs: function (id) { return mp.get(id, 'thornswoodNeeds'); },
    // Values nobody would land on by accident, in a cold place at night so a
    // temperature that is not held has somewhere to go.
    seed: function (id) {
      mp.set(id, 'thornswoodNeeds', {
        food: 72.5, drink: 40.25, rest: 88, temp: 31, at: clock.now,
        resting: '', worked: 0, place: 'snow', sky: '', night: true, roof: false,
        high: 0, fire: -1
      });
    },
    ticks: function (n) { for (let i = 0; i < n; i++) { clock.now += TICK; this.tick(); } }
  };
}

function held(n) {
  return !!n && n.food === 72.5 && n.drink === 40.25 && n.rest === 88 && n.temp === 31;
}

let W = null;
if (NEEDS_BLOCK && CHARGEN_GLOBAL && CHARGEN_OF) {
  try { W = world(); } catch (e) { console.log('  (' + e.message + ')'); W = null; }
}
yes('both blocks run, and the needs block hands its tick to setInterval',
    !!(W && W.api && typeof W.tick === 'function'));

// ================================================= 1. the needs stand still
if (W && W.tick) {
  const MAKING = 0xff000061;   // choosing, the K panel in the screenshot
  const FACE = 0xff000062;     // appearance, in the race menu
  const DONE = 0xff000063;     // out in the world
  const w = world();
  [MAKING, FACE, DONE].forEach(function (id) { w.online(id); w.seed(id); });
  w.stage(MAKING, 'choosing');
  w.stage(FACE, 'appearance');
  w.stage(DONE, 'done');
  // The client reporting the hall, which is what walked the tester's Temp to 58.
  w.api.place(MAKING, 'indoors', '-', '0', '1', '0', '-');

  w.ticks(180);   // an hour, at the tick's own twenty seconds

  yes('1 an hour of ticks choosing a home leaves all four meters exactly as they were',
      held(w.needs(MAKING)));
  yes('1 and the same hour in the race menu does too', held(w.needs(FACE)));
  yes('1 the hall reported as indoors did not warm them either', w.needs(MAKING).temp === 31);
  const out = w.needs(DONE);
  yes('1 the same hour out in the world still drains and cools (food ' +
      (out ? out.food.toFixed(2) : '?') + ', temp ' + (out ? out.temp.toFixed(2) : '?') + ')',
      !!out && out.food < 72.5 - 40 && out.drink === 0 && out.temp < 31);
  const toMaking = w.said.filter(function (s) { return s[0] === MAKING || s[0] === FACE; });
  const toDone = w.said.filter(function (s) { return s[0] === DONE; });
  yes('1 nothing is said to anybody in creation', toMaking.length === 0);
  yes('1 while the one in the world is told they are thirsty', toDone.length > 0);

  // The home is picked: arriveAt writes done. Nobody reconnects.
  w.stage(MAKING, 'done');
  w.ticks(1);
  const first = w.needs(MAKING);
  const due = 72.5 - w.api.NEEDS.drain.food * (TICK / HOUR);
  // Indoors, where the hall said they were, so the held 31 now warms.
  yes('1 the first tick after creation runs them at once, charged twenty seconds and not the hour (food ' +
      (first ? first.food.toFixed(4) : '?') + ', want ' + due.toFixed(4) + ')',
      !!first && Math.abs(first.food - due) < 1e-9 && first.temp > 31);
  w.ticks(180);
  const later = w.needs(MAKING);
  yes('1 and an hour later they have drained a whole hour',
      !!later && Math.abs((72.5 - later.food) - w.api.NEEDS.drain.food * (181 * TICK / HOUR)) < 1e-6);

  // The first SETTLE_MS of a session, before the stage opens: the hall is creation.
  const NEW = 0xff000064, BACK = 0xff000065;
  const w2 = world();
  [NEW, BACK].forEach(function (id) { w2.online(id); w2.seed(id); });
  w2.standIn(NEW, HALL.desc);
  w2.ticks(30);
  yes('1 a new arrival in the hall with no stage yet is held too', held(w2.needs(NEW)));
  yes('1 somebody with no stage anywhere else is not', !held(w2.needs(BACK)));

  // Creation switched off in server-settings.json, and a gamemode with no chargen block.
  const w3 = world({ enabled: false });
  w3.online(NEW); w3.seed(NEW); w3.standIn(NEW, HALL.desc);
  w3.ticks(30);
  yes('1 with thornswoodChargen off, standing in the hall holds nobody', !held(w3.needs(NEW)));
  const w4 = world({ chargen: false });
  w4.online(NEW); w4.seed(NEW); w4.standIn(NEW, HALL.desc);
  w4.ticks(30);
  yes('1 and with no chargen block loaded at all, nobody is frozen', !held(w4.needs(NEW)));

  // A brand new character with no meters yet, in creation.
  const w5 = world();
  w5.online(NEW); w5.stage(NEW, 'appearance');
  w5.ticks(1);
  const born = w5.needs(NEW);
  w5.ticks(90);
  const still = w5.needs(NEW);
  yes('1 a character whose meters are made in creation starts full and stays there',
      !!born && !!still && born.food === 100 && still.food === 100 &&
      still.drink === 100 && still.rest === 100 && still.temp === born.temp);
}

// ============================================ 2. the bars, as the client draws them
/*
  A document just big enough for the HUD: it makes, finds and removes one div.
  The script hands the page a string to run; this runs it here.
*/
function page() {
  const els = {};
  const body = {
    appendChild: function (el) { el.parentNode = body; if (el.id) { els[el.id] = el; } return el; },
    removeChild: function (el) { if (els[el.id] === el) { delete els[el.id]; } el.parentNode = null; return el; }
  };
  const doc = {
    body: body,
    getElementById: function (id) { return els[id] || null; },
    createElement: function (tag) { return { tagName: tag, id: '', style: {}, innerHTML: '', parentNode: null }; }
  };
  return {
    doc: doc,
    run: function (src) { new Function('document', src)(doc); },
    bars: function () {
      const d = doc.getElementById('ts-hud');
      if (!d) { return false; }
      return /Hunger/.test(d.innerHTML) && /Thirst/.test(d.innerHTML) &&
             /Rest/.test(d.innerHTML) && /Temp/.test(d.innerHTML);
    }
  };
}

if (W && W.tick) {
  const w = world();
  const script = w.made.thornswoodNeeds && w.made.thornswoodNeeds.updateOwner;
  yes('2 the needs property carries a HUD script for its owner', typeof script === 'string' && script.length > 0);

  const ME = 0xff000071;
  const p = page();
  const state = {};
  // One frame on the client: the script run with the property's current value.
  function frame() {
    const ctx = { value: w.needs(ME), state: state,
                  sp: { browser: { executeJavaScript: function (src) { p.run(src); } } } };
    new Function('ctx', script)(ctx);
  }

  w.online(ME); w.seed(ME);
  // The first seconds, before any stage: somewhere that is not the hall.
  w.ticks(1);
  frame();
  yes('2 out of creation the four bars are drawn', p.bars());

  w.stage(ME, 'appearance');
  w.ticks(1);
  for (let i = 0; i < 5; i++) { frame(); }
  yes('2 in the race menu the bars come off, and stay off over frames', !p.bars() &&
      p.doc.getElementById('ts-hud') === null);

  w.stage(ME, 'choosing');
  w.ticks(3);
  for (let i = 0; i < 5; i++) { frame(); }
  yes('2 with the K panel up choosing a home, no bars', p.doc.getElementById('ts-hud') === null);

  w.stage(ME, 'done');
  w.ticks(1);
  frame();
  yes('2 the home picked, the next reading draws them again', p.bars());
}

// ============================================================ 3. the chat
/*
  The chat page in a sandbox. The socket is opened, welcomed and dropped by
  hand, and timers only run when this says so, so an outage lasts exactly as
  long as the check needs it to.
*/
function chatPage() {
  const notes = [];
  const sockets = [];
  const timers = [];
  function Sock(url) {
    this.url = url; this.readyState = 0; this.sent = [];
    sockets.push(this);
  }
  Sock.prototype.send = function (m) { this.sent.push(JSON.parse(m)); };
  Sock.prototype.close = function () {
    if (this.readyState === 3) { return; }
    this.readyState = 3;
    if (this.onclose) { this.onclose(); }
  };
  // The front, which answers the page's ask for a join token (#1322) a
  // moment later, the way the launcher's fetch does, as a timer here.
  let minted = 0;
  const win = {
    // The https address the launcher writes; there is no ws:// fallback (#1304).
    THORNSWOOD: { host: 'voice.test', port: 7778, profileId: 7, name: 'Traveller', token: 't', base: 'https://voice.test/voice' },
    thornswoodChat: { add: function (parts) { notes.push(parts.map(function (r) { return r.text; }).join('')); } },
    skyrimPlatform: { sendMessage: function (to, what) {
      if (to !== 'thornswood-front' || String(what).indexOf('token? ') !== 0) { return; }
      timers.push(function () { win.thornswoodNet.setToken('front-' + (++minted)); });
    } }
  };
  const box = {
    window: win, WebSocket: Sock, console: { log: function () { } },
    setTimeout: function (fn) { timers.push(fn); return timers.length; },
    clearTimeout: function () { }, JSON: JSON, Math: Math,
    // The keepalive's tick (issue #519), which nothing here waits for.
    setInterval: function () { return 0; }, clearInterval: function () { }
  };
  vm.createContext(box);
  vm.runInContext(CHAT, box);
  return {
    box: box, notes: notes, sockets: sockets, net: win.thornswoodNet,
    ws: function () { return sockets[sockets.length - 1]; },
    up: function () {
      const s = sockets[sockets.length - 1];
      s.readyState = 1; s.onopen(); s.onmessage({ data: JSON.stringify({ t: 'welcome', peer: 3 }) });
    },
    drop: function () { const s = sockets[sockets.length - 1]; s.close(); },
    // The next try: timers run until it has opened a socket, since a try with
    // no token asks the front first and goes when the answer comes (#1322).
    retry: function () {
      const before = sockets.length;
      for (let i = 0; i < 5 && sockets.length === before; i++) {
        const t = timers.splice(0); t.forEach(function (fn) { fn(); });
      }
    },
    count: function (text) { return notes.filter(function (n) { return n === text; }).length; },
    chatSent: function (s) { return s.sent.filter(function (m) { return m.t === 'chat'; }).map(function (m) { return m.text; }); }
  };
}

const TELL = between(FRONT, 'function tellServer(line) {', '\n  }\n');
yes('3 tellServer is in thornswood-front.js', !!TELL);

const QUEUED = 'Not connected yet, that is queued.';
const LOST = 'Chat lost the server. Trying again.';
const ON = 'Chat is on. Press enter to talk.';

if (TELL) {
  const c = chatPage();
  // The plugin's own channel, exactly as it runs: T.js hands a string to the page.
  const T = { ready: true, js: function (code) { vm.runInContext(code, c.box); return true; } };
  const tellServer = new Function('T', 'toServer', TELL + '\nreturn tellServer;')(T, []);

  // The hall: the socket is still opening and the plugin reports what it does.
  tellServer('/place indoors - 0 1 0 -');
  tellServer('/pick refresh');
  tellServer('/face done');
  yes('3 three lines the plugin sent by itself while the socket was down say nothing',
      c.count(QUEUED) === 0);

  c.net.typed('hello, is anybody here');
  yes('3 a line the person typed is told it is queued, once', c.count(QUEUED) === 1);

  c.up();
  yes('3 on connect every queued line goes out, in order',
      JSON.stringify(c.chatSent(c.ws())) === JSON.stringify(
        ['/place indoors - 0 1 0 -', '/pick refresh', '/face done', 'hello, is anybody here']));
  yes('3 and chat says it is on, once', c.count(ON) === 1);

  // The name arrives after the race menu, and setName reconnects on purpose.
  c.net.setName('Aela of the Hall');
  c.retry();
  c.up();
  yes('3 the reconnect setName does on purpose does not say the server was lost', c.count(LOST) === 0);
  yes('3 nor that chat is on a second time', c.count(ON) === 1);
  yes('3 and the new socket joined under the new name',
      c.ws().sent[0].t === 'join' && c.ws().sent[0].name === 'Aela of the Hall');

  // A real outage: the server drops the socket, and two retries fail.
  c.drop();
  c.retry(); c.drop();
  c.retry(); c.drop();
  yes('3 a real outage is said once, not once per failed retry', c.count(LOST) === 1);
  tellServer('/place outdoors - 1 0 0 -');
  c.net.typed('/me waits');
  yes('3 during it, the plugin\'s line is quiet and the typed one is told',
      c.count(QUEUED) === 2);
  c.retry();
  c.up();
  yes('3 and both go out when it comes back',
      JSON.stringify(c.chatSent(c.ws())) === JSON.stringify(['/place outdoors - 1 0 0 -', '/me waits']));
  yes('3 which is when chat says it is on again', c.count(ON) === 2);
}

// ------------------------------------------------ who else calls say, by text
{
  // The bridge sends what was typed into the chat box. It must stay a typed
  // line, so it goes through typed, the one door for that (#2732).
  const bridge = read(path.join(REPO_DIR, 'game', 'ui', 'thornswood-bridge.js'));
  yes('3 the chat box still sends a typed line as a typed line',
      /window\.thornswoodNet\.typed\(text\);/.test(bridge) &&
      /window\.thornswoodNet\.typed\(held\.shift\(\)\);/.test(bridge));
  // The panels are somebody pressing a button, which is theirs, so they keep the notice.
  const panels = ['thornswood-journal.js', 'thornswood-party.js', 'thornswood-trade.js'];
  // Read as every say call the panel makes passing the line and nothing
  // after it, which is what keeps the notice. Since #2155 (#2135) the
  // journal calls it through a name of its own (n.say(line), n being
  // window.thornswoodNet) to compare the queue before and after, so the
  // whole call is not spelled out the same way in every panel any more.
  yes('3 and the journal, party and trade buttons still say so when they are queued',
      panels.every(function (f) {
        const calls = read(path.join(REPO_DIR, 'game', 'ui', f)).match(/\.say\([^)]*\)/g) || [];
        return calls.length > 0 && calls.every(function (c) { return c === '.say(line)'; });
      }));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
