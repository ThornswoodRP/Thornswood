// test-1595-deliver.js
//
// #1595. A letter is written on the board panel and handed over from the
// look prompt, never typed. Patrick, 4 Oct: "no more commands for things
// [people] do"; on the issue, /deliver "becomes a key on the look prompt,
// shown while you carry a letter for the person under the crosshair, and
// posting a letter moves into the board panel".
//
// Which key was not said. The question is on the issue, and its suggested
// answer is built: E, Skyrim's own Activate, on the person, because every
// letter is already taken and U on a person is Let sleep here (#1603),
// which can be up at the same time. DELIVER_KEY in the front plugin moves it.
//
// What is checked: the server marks the person you carry a letter for on
// the near list (`d`, from lettersCarried); the prompt draws Hand over the
// letter only then, and its key sends /deliver with their form id; Write a
// letter on the board panel sends /letter with the name in quotes; the
// server's own lines and every help list stop naming /letter and /deliver;
// and the lines the panel and the prompt send still post and deliver.
//
// The real functions, lifted out of game/gamemode.js and
// game/plugins/thornswood-front.js, over a pretend engine. Read only.
'use strict';
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(path.join(REPO_DIR, p), 'utf8').split(CR).join(''); };
const gm = process.env.GM ? fs.readFileSync(process.env.GM, 'utf8').split(CR).join('') : read('game/gamemode.js');
const front = read('game/plugins/thornswood-front.js');
const page = read('game/ui/thornswood-board.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function attempt(what, f) {
  try { f(); } catch (e) { yes(what + ' threw: ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e), false); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function code(src) {
  return String(src || '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1 ');
}
const NAMES_A_LETTER_WORD = /\/(letter|deliver)\b/;

const prop = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const SOCIAL = slice(gm, '// ==== thornswood social:', '// ==== end thornswood social ====');
const character = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
yes('the property, social and character blocks are in the gamemode', !!prop && !!SOCIAL && !!character);
if (!prop || !SOCIAL || !character) { done(); }

function fn(name) {
  const head = '\n  function ' + name + '(';
  const a = prop.indexOf(head);
  if (a < 0 || prop.indexOf(head, a + 1) >= 0) { return null; }
  const b = prop.indexOf('\n  }\n', a + 1);
  return b < 0 ? null : prop.slice(a + 1, b + 4);
}
const NAMES = ['takeGold', 'payOut', 'payHeld', 'sealed', 'nameIs', 'postWords', 'post', 'board', 'take',
               'jobsOf', 'dropJob', 'takedown', 'unpin', 'postLetter', 'deliver', 'letterReach', 'lettersCarried',
               'boardHere', 'nearestBoard', 'wallOf', 'boardPanel', 'boardsView', 'moveBoard', 'command',
               'haulTenth', 'haulText'];
const lifted = {};
const missing = [];
NAMES.forEach(function (n) { lifted[n] = fn(n); if (!lifted[n]) { missing.push(n); } });
yes('every piece of the letter is in the property block, once' +
    (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''), missing.length === 0);
const fees = slice(prop, '  var NOTICE_FEE = ', 'var LETTER_REACH = 700;');
const holds = slice(prop, '  var LEDGER_HOLDS = [', '];');
// The company's cut of a haul is its terms now (#512, #2695), read by the company terms block.
const COMPANY = require('./fixtures/company-block').companyApi(gm);
const reads = slice(prop, '  var boardReads = ', ';');
const seeding = (function () {
  const a = prop.indexOf('  var BOARD_REACH = 400;');
  const b = prop.indexOf('  /** The hold whose board somebody is standing at', a);
  return (a < 0 || b < 0) ? null : prop.slice(a, b);
})();
const chargenLine = gm.split('\n').find(function (l) { return l.indexOf('const CHARGEN = ') === 0; });
const PASSAGES = chargenLine ? JSON.parse(chargenLine.slice('const CHARGEN = '.length).replace(/;$/, '')).towns : null;
yes('the fees, the ledgers, the seeding and the town table read', !!fees && !!holds && !!COMPANY && !!reads && !!seeding && !!PASSAGES);
if (missing.length || !fees || !holds || !COMPANY || !reads || !seeding || !PASSAGES) { done(); }

const GOLD = 15;
const TAMRIEL = '3c:Skyrim.esm';
// Whiterun's and Riften's boards stand inside their walled cities (#2516).
const WHITERUN_WORLD = '1a26f:Skyrim.esm';
const RIFTEN_WORLD = '16bb4:Skyrim.esm';
const WHITERUN = [23139.4, -7891.7, -3494.4];
const WORDS_OF_IT = 'Meet me at the Drunken Huntsman at dusk.';

/* The engine: packs, names, places, who is online and the properties written to a person. */
function world() {
  const people = {};
  const online = [];
  const props = {};
  const w = {
    people: people, online: online, props: props,
    add: function (p) {
      people[p.actor] = { pid: p.pid, name: p.name, cell: p.cell || WHITERUN_WORLD,
                          pos: (p.pos || WHITERUN).slice(), pack: [{ baseId: GOLD, count: p.gold }] };
      online.push(p.actor);
      return p;
    },
    move: function (p, pos) { people[p.actor].pos = pos.slice(); },
    gold: function (p) {
      return people[p.actor].pack.reduce(function (s, e) { return s + (e.baseId === GOLD ? e.count : 0); }, 0);
    },
    mp: {
      makeProperty: function () { },
      get: function (id, key) {
        if (id === 0 && key === 'onlinePlayers') { return online.slice(); }
        const p = people[id];
        if (!p) { return undefined; }
        if (key === 'inventory') { return { entries: JSON.parse(JSON.stringify(p.pack)) }; }
        if (key === 'appearance') { return { name: p.name }; }
        if (key === 'worldOrCellDesc') { return p.cell; }
        if (key === 'pos') { return p.pos.slice(); }
        if (key === 'profileId') { return p.pid; }
        const k = id + ':' + key;
        return Object.prototype.hasOwnProperty.call(props, k) ? JSON.parse(props[k]) : undefined;
      },
      set: function (id, key, v) {
        if (key === 'inventory') { people[id].pack = JSON.parse(JSON.stringify(v.entries)); return; }
        props[id + ':' + key] = JSON.stringify(v);
      }
    }
  };
  return w;
}

/* The real social block in a sandbox over the engine. */
function social(w) {
  const ctx = {
    mp: w.mp, JSON: JSON, Object: Object, Array: Array, String: String, Number: Number, Math: Math, Date: Date,
    isFinite: isFinite, parseInt: parseInt, isNaN: isNaN,
    console: { log: function () { }, error: function () { } },
    guard: function (name, f) { return f; },
    setInterval: function () { return 1; }, clearInterval: function () { },
    notify: function () { }, say: function () { }, log: function () { }
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  ctx.__thornswoodCompany = COMPANY;
  vm.runInContext(SOCIAL, ctx, { filename: 'gamemode.js social' });
  return ctx;
}

/* One boot of the board, over the real social block. */
function boot(w) {
  const reg = {};
  const ctx = social(w);
  const body = [
    'var boxes = {};', 'var funds = {};', 'var notices = {};', 'var GOLD_ID = ' + GOLD + ';',
    reads, holds, fees, seeding,
    'function save() { }',
    'function refreshPanel() { }',
    'function cancelHaul() { return true; }', 'function haulCmd() { return true; }',
    ['deeds', 'setLock', 'mold', 'moldHere', 'cutKey', 'here', 'claim', 'officeCmd',
     'evict', 'boxCmd', 'rentCmd', 'sleepHere'].map(function (n) { return 'function ' + n + '() { return true; }'; }).join('\n')
  ];
  NAMES.forEach(function (n) { body.push(lifted[n]); });
  body.push('return { boards: boards, notices: function () { return notices; }, command: command, ' +
            'lettersCarried: lettersCarried, funds: function () { return funds; } };');
  const make = new Function('reg', 'mp', 'plog', 'loadPart', 'PASSAGES', 'g', 'isSteward', body.join('\n'));
  const api = make(reg, w.mp, function () { }, function (k, fb) { return fb; }, PASSAGES, ctx, function () { return false; });
  ctx.__thornswoodProperty = { lettersCarried: api.lettersCarried };
  api.ctx = ctx;
  api.every = [];
  api.say = function (p, line) {
    const parts = line.trim().split(/\s+/);
    const said = [];
    const to = function (pid, m) { api.every.push(m); if (pid === p.pid) { said.push(m); } };
    const answered = api.command(parts[0].toLowerCase(), parts, p.actor, p.pid, to);
    return answered ? said.join('\n') : null;
  };
  /* What the near list tells `p` about `them`, after one tick. */
  api.near = function (p, them) {
    ctx.__thornswoodSocial.nearTick();
    const v = w.mp.get(p.actor, 'thornswoodNear');
    return (v && v.w && v.w[them.actor.toString(16)]) || null;
  };
  return api;
}

const ALICE = { actor: 0xff000101, pid: 101, name: 'Alice', gold: 200 };
const BOB = { actor: 0xff000102, pid: 102, name: 'Bob', gold: 10 };
const LYDIA = { actor: 0xff000103, pid: 103, name: 'Lydia Stormblade', gold: 0 };
const CYRUS = { actor: 0xff000104, pid: 104, name: 'Cyrus', gold: 50 };
const LYLE = { actor: 0xff000105, pid: 105, name: 'Lyle', gold: 0 };

// ------------------------------------------------- what the server marks
attempt('who carries a letter for whom', function () {
  const w = world();
  [ALICE, BOB, LYDIA, CYRUS, LYLE].forEach(w.add);
  const s = boot(w);
  yes('M1 nobody carries anything on an empty board', !s.lettersCarried().carries(BOB.pid, 'Lydia Stormblade') &&
      !s.near(BOB, LYDIA).d);

  // The line Write a letter sends: the name in double quotes.
  const posted = s.say(ALICE, '/letter "Lydia" ' + WORDS_OF_IT);
  yes('M2 the panel\'s line posts the letter, for the name in the quotes', /Your letter for Lydia is on the board/.test(posted) &&
      s.notices().whiterun[0].to === 'Lydia' && s.notices().whiterun[0].text === WORDS_OF_IT && w.gold(ALICE) === 165);
  s.say(ALICE, '/job 5 Clear the cellar :: Rats, and a lot of them.');
  yes('M3 a letter on the board that nobody has taken is carried by nobody',
      !s.lettersCarried().carries(BOB.pid, 'Lydia Stormblade') && !s.near(BOB, LYDIA).d);

  s.say(BOB, '/take 1');
  s.say(CYRUS, '/take 2');
  const c = s.lettersCarried();
  yes('M4 the courier carries it for Lydia Stormblade, by her first name', c.carries(BOB.pid, 'Lydia Stormblade'));
  yes('M4 and for nobody else: not Cyrus, not a name that only starts the same',
      !c.carries(BOB.pid, 'Cyrus') && !c.carries(BOB.pid, 'Lyle') && !c.carries(BOB.pid, 'Lydiana'));
  yes('M5 somebody carrying a plain job carries no letter', !c.carries(CYRUS.pid, 'Lydia Stormblade') &&
      !c.carries(CYRUS.pid, 'Alice'));
  yes('M6 the near list marks Lydia for the courier with d, and nobody else for anybody',
      s.near(BOB, LYDIA).d === 1 && !s.near(BOB, CYRUS).d && !s.near(BOB, LYLE).d &&
      !s.near(CYRUS, LYDIA).d && !s.near(LYDIA, BOB).d && !s.near(ALICE, LYDIA).d);

  s.say(BOB, '/dropjob 1');
  yes('M7 handed back, it is not carried and the mark goes', !s.lettersCarried().carries(BOB.pid, 'Lydia Stormblade') &&
      !s.near(BOB, LYDIA).d);
  s.say(BOB, '/take 1');
  yes('M7 and taken again, the mark comes back', s.near(BOB, LYDIA).d === 1);

  // The line the prompt's key sends: their form id.
  w.move(BOB, [WHITERUN[0] + 300, WHITERUN[1], WHITERUN[2]]);
  w.move(LYDIA, [WHITERUN[0] + 900, WHITERUN[1], WHITERUN[2]]);
  const said = s.say(BOB, '/deliver ' + LYDIA.actor.toString(16));
  yes('D1 the prompt\'s line hands the letter over with her form id, and pays the courier',
      /You hand Lydia Stormblade the letter\. 15 gold is yours\./.test(said) && w.gold(BOB) === 25 &&
      !!s.notices().whiterun[0].delivered);
  yes('D2 delivered, it is carried no more and the prompt loses the row',
      !s.lettersCarried().carries(BOB.pid, 'Lydia Stormblade') && !s.near(BOB, LYDIA).d);
  yes('D3 a delivered letter cannot be handed over again',
      /You are not carrying a letter/.test(s.say(BOB, '/deliver ' + LYDIA.actor.toString(16))) && w.gold(BOB) === 25);

  // Taken down by the sender: carried by nobody.
  s.say(ALICE, '/letter "Cyrus" again');
  s.say(BOB, '/take 3');
  yes('D4 a second letter, for Cyrus, marks Cyrus', s.near(BOB, CYRUS).d === 1);
  s.say(BOB, '/dropjob 3');
  s.say(ALICE, '/unpin 3');
  yes('D5 taken down, it is carried by nobody', !s.near(BOB, CYRUS).d);

  yes('S1 nothing anybody was told names /letter or /deliver',
      s.every.length > 8 && s.every.every(function (m) { return !NAMES_A_LETTER_WORD.test(String(m)); }));
  yes('S2 the courier taking a letter is told to use the prompt\'s key',
      (function () {
        s.say(ALICE, '/letter "Lyle" hello');
        const t = s.say(CYRUS, '/take 4');
        return /look at them within about 10 metres, and hand it over with the key the prompt shows/.test(t);
      })());
  yes('S3 a /letter with no name, or /deliver with nobody, names no command',
      s.say(ALICE, '/letter') === 'Say who the letter is for.' &&
      s.say(CYRUS, '/deliver') === 'Look at the person the letter is for, and use the key the prompt shows.');
});

// ---------------------------------------------------------------- the words
attempt('the words', function () {
  function arrayOf(name) {
    const m = new RegExp('^const ' + name + ' = (\\[[\\s\\S]*?\\]);$', 'm').exec(gm);
    if (!m) { return null; }
    try { return new Function('return ' + m[1])(); } catch (e) { return null; }
  }
  const WORDS = arrayOf('WORDS');
  const PLAYER_WORDS = arrayOf('PLAYER_WORDS');
  yes('W1 the server answers /letter and /deliver, the lines the panel and the prompt send',
      !!WORDS && WORDS.indexOf('/letter') !== -1 && WORDS.indexOf('/deliver') !== -1 &&
      /word === '\/letter' \|\| word === '\/deliver' \|\|/.test(character));
  yes('W2 and the list named to everybody names neither', !!PLAYER_WORDS &&
      PLAYER_WORDS.indexOf('/letter') === -1 && PLAYER_WORDS.indexOf('/deliver') === -1);
  let told = '';
  ['take', 'postLetter', 'deliver', 'lettersCarried'].forEach(function (n) {
    (code(lifted[n]).match(/'(?:[^'\\]|\\.)*'/g) || []).forEach(function (str) {
      if (NAMES_A_LETTER_WORD.test(str)) { told += ' ' + n + ': ' + str; }
    });
  });
  yes('W3 no line the letter functions say names /letter or /deliver' + told, told === '');
  const pages = read('docs/systems/noticeboards.md');
  yes('W4 the page names the form and the key, and tells nobody to type a letter\'s line',
      /Write a letter, with who it is for and the\s+words/.test(pages) &&
      /E, Hand over the letter/.test(pages) && !/`\/letter|`\/deliver/.test(pages));
  const commands = read('docs/systems/commands.md');
  yes('W5 the commands page says nobody is told of either',
      /\| `\/letter "<name>" <words>`, `\/deliver <id>` \| Anybody \|[^\n]*\| Nowhere\.[^\n]*Never in the list or the help\. \| #1595 \|/.test(commands));
  yes('W7 the systems page lists E on the look prompt',
      /E to hand over a letter you carry for\s+them/.test(read('docs/GAME-SYSTEMS.md')));
});

// ------------------------------------------------------------ the look prompt
attempt('the look prompt', function () {
  const deliverPress = slice(front, '  function deliverPress(e) {', '\n  }\n');
  const lookVerb = slice(front, '  function lookVerb(cmd) {', '\n  }\n');
  const deliverName = slice(front, '  function deliverName() {', '\n  }\n');
  const keyName = slice(front, '  function keyName(code) {', '\n  }\n');
  const keyM = /\n  const DELIVER_KEY = (\d+);\n/.exec(front);
  yes('P1 the pieces are in the front plugin, and the key is Activate (0) as the suggested answer',
      !!deliverPress && !!lookVerb && !!deliverName && !!keyName && !!keyM && keyM[1] === '0');
  if (!deliverPress || !lookVerb || !deliverName || !keyName) { return; }

  function rig(opts) {
    const sent = [];
    const T = { ready: true, js: function (src) { const m = /say\(("[^"]*")\)/.exec(src); if (m) { sent.push(JSON.parse(m[1])); } return true; } };
    const sp = { Input: { getMappedKey: function (name) { return name === 'Activate' ? (opts.activate || 18) : 0; } } };
    const make = new Function('T', 'sp', 'near', 'lookingAt', 'claims', 'busy',
      'const DELIVER_KEY = ' + (opts.key || 0) + ';\n' +
      'function nearList() { return near; }\n' +
      'function busyMenuOpenNow() { return busy; }\n' +
      'function note() { }\nfunction say() { }\n' +
      keyName + deliverName + lookVerb + deliverPress +
      'return { press: deliverPress, name: deliverName };');
    const api = make(T, sp, opts.near || null, opts.looking || '', opts.claims || {}, opts.busy || '');
    api.sent = sent;
    return api;
  }
  const HEX = 'ff000103';
  const withLetter = {}; withLetter[HEX] = { n: 'Lydia Stormblade', d: 1 };
  const without = {}; without[HEX] = { n: 'Lydia Stormblade' };
  const ACT = { userEventName: 'Activate', code: 18 };

  let r = rig({ near: withLetter, looking: HEX });
  yes('P2 E on the person you carry a letter for sends /deliver with their form id',
      r.press(ACT) === true && r.sent.length === 1 && r.sent[0] === '/deliver ' + HEX);
  r = rig({ near: without, looking: HEX });
  yes('P3 E on somebody you carry nothing for falls through to the board, the driver and the trader',
      r.press(ACT) === false && r.sent.length === 0);
  r = rig({ near: withLetter, looking: '' });
  yes('P4 E with nobody under the crosshair falls through', r.press(ACT) === false && r.sent.length === 0);
  r = rig({ near: withLetter, looking: HEX });
  yes('P5 any other key does nothing here', r.press({ userEventName: 'Jump', code: 57 }) === false &&
      r.press({ code: 22 }) === false && r.sent.length === 0);
  r = rig({ near: withLetter, looking: HEX, claims: { chat: true } });
  yes('P6 not while the chat has the keyboard', r.press(ACT) === false && r.sent.length === 0);
  r = rig({ near: withLetter, looking: HEX, busy: 'InventoryMenu' });
  yes('P7 not over a menu', r.press(ACT) === false && r.sent.length === 0);
  r = rig({ near: withLetter, looking: HEX, key: 22 });
  yes('P8 a scan code in DELIVER_KEY moves it to that key, the one-line change',
      r.press(ACT) === false && r.press({ code: 22 }) === true && r.sent[0] === '/deliver ' + HEX && r.name() === 'U');
  yes('P9 the row names the key Activate is bound to, E by default', rig({}).name() === 'E' &&
      rig({ activate: 19 }).name() === 'R');

  const drawPrompt = slice(front, '  function drawPrompt(row) {', '\n  }\n');
  yes('P10 the prompt draws Hand over the letter only for a row the server marked, and redraws when the mark moves',
      !!drawPrompt && /\(row\.d \? keyRow\(deliverName\(\), 'Hand over the letter', false\) : ''\)/.test(drawPrompt) &&
      /'\|' \+ \(row\.d \|\| 0\)/.test(drawPrompt));
  const keys = slice(front, "  sp.on('buttonEvent', guard('keys', (e) => {", '\n  }));\n');
  const at = keys ? keys.indexOf('if (deliverPress(e)) return;') : -1;
  yes('P11 the key handler asks it before the board, the driver and the trader take E',
      at > 0 && at < keys.indexOf('if (driverPress(e)) return;') && at < keys.indexOf('if (merchantPress(e)) return;'));
});

// -------------------------------------------------------------- the board panel
attempt('Write a letter', function () {
  let parses = true;
  try { new vm.Script(page); new vm.Script(front); } catch (e) { parses = false; }
  yes('B1 the board panel and the front plugin parse', parses);
  yes('B2 the panel has Write a letter: who it is for, held to 60, and the words, held to 300',
      page.indexOf("out += '<h3>Write a letter</h3>';") !== -1 &&
      /id="' \+ ID \+ '-to" maxlength="60"/.test(page) && /id="' \+ ID \+ '-letter" maxlength="300"/.test(page) &&
      /data-do="letter">Post the letter<\/button>/.test(page));
  const branch = slice(page, "    if (verb === 'letter') {", '\n    }\n');
  yes('B3 it sends /letter with the name in double quotes, quotes taken out of the name', !!branch &&
      /field\(ID \+ '-to'\)\.replace\(\/"\/g, ''\)/.test(branch) && branch.indexOf("net('/letter \"' + to + '\" ' + words);") !== -1);
  // The chat socket cuts a command at COMMAND_CHARS, and a line said at 400 (voice/voice-server.js, #2554).
  const voice = read('voice/voice-server.js');
  const longest = ('/letter "' + 'x'.repeat(60) + '" ' + 'y'.repeat(300)).length;
  const cap = Number((/const COMMAND_CHARS = (\d+);/.exec(voice) || [])[1]);
  yes('B4 the longest line the form can send fits what the chat socket carries for a command (' + cap + ')',
      /pageText\(msg\.text\)\.slice\(0, COMMAND_CHARS\)/.test(voice) && longest <= 400 && cap >= 400);
  // Run the branch: what it sends for a name with quotes and spaces in it.
  if (branch) {
    const sent = [];
    const fields = { 'ts-board-to': '  "Lydia   Stormblade" ', 'ts-board-letter': WORDS_OF_IT };
    new Function('verb', 'ID', 'field', 'net', branch)('letter', 'ts-board',
      function (id) { return String(fields[id] || '').trim(); }, function (l) { sent.push(l); });
    yes('B5 a name with quotes and doubled spaces goes over as one clean name',
        sent.length === 1 && sent[0] === '/letter "Lydia Stormblade" ' + WORDS_OF_IT);
  }
});

done();
