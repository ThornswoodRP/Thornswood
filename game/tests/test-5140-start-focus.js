// test-5140-start-focus.js
//
//     node game/tests/test-5140-start-focus.js
//
// The character choice at the game's start (#5140). On 31 Oct the engine
// showed and focused the page about 25 seconds before the plugins ran, with
// no cursor, so the menu looked frozen, and a click at the middle of the
// screen picked the character drawn there. The engine now shows the page
// without focusing it (fork misc/tests/node/test_browser_start_focus.js), and
// the front focuses it when it runs. This holds the page's half: until the
// front has said anything to it, the line under the slots says the game is
// still loading and nothing is picked; the first word from the front clears
// it. The page builds itself from innerHTML, so it is read, not drawn, as
// test-start-screen.js explains.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const page = read('game/ui/thornswood-select.js');
const front = read('game/plugins/thornswood-front.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function body(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return '';
}

const m = /var LOADING_WORDS = '([^']+)';/.exec(page);
const words = m ? m[1] : '';
yes('the page has a still-loading line', !!words);
yes("it says the game is still loading and the characters come in a moment ('" + words + "')",
    /still loading/.test(words) && /picked in a moment/.test(words));
yes('it has no em dash and never the word the house rules forbid',
    words.indexOf(String.fromCharCode(0x2014)) < 0 && !new RegExp('pla' + 'yer', 'i').test(words));
yes('the page starts with the front out unless the front wrote the list',
    /var frontIn = LIST\.front === true;/.test(page));
yes('draw() shows the still-loading line while the front is out, and nothing once it is in',
    /if \(!sent\) elStatus\.textContent = frontIn \? '' : LOADING_WORDS;/.test(page) &&
    !/if \(!sent\) elStatus\.textContent = '';/.test(page));

const here = body(page, 'function frontHere()');
yes('frontHere marks the front in and clears only its own line', /frontIn = true;/.test(here) &&
    /if \(!sent && elStatus\.textContent === LOADING_WORDS\) elStatus\.textContent = '';/.test(here));
yes('the front\'s once a second keys() marks it in', /function keysSay\(on, ask\) \{\s*frontHere\(\);/.test(page));
yes('so do its go() and line()', /function go\(\) \{\s*frontHere\(\);/.test(page) &&
    /function lineSays\(what\) \{\s*frontHere\(\);/.test(page));
yes('play() takes no pick before the front is in',
    /if \(!frontIn\) \{ tell\('a pick before the front was in was not taken'\); return; \}/.test(body(page, 'function play()')));
yes('and that check comes before the pick is kept or sent',
    body(page, 'function play()').indexOf('if (!frontIn)') < body(page, 'function play()').indexOf('picked = e.id'));

yes('the front marks a list it writes itself (a page it reloads or brings back)',
    /list\.front = true;\s*if \(has !== 'list' \|\| menuAgain\)/.test(front));
yes('the front still focuses the page when it shows the choice',
    /sp\.browser\.setVisible\(true\);\s*sp\.browser\.setFocused\(true\);/.test(front));
yes('and still says keys() once a second while the choice is up',
    /window\.thornswoodSelect&&window\.thornswoodSelect\.keys\(/.test(front));

// ------------------------------------------------------------ run the page
// The same stand-in page as test-1157-session-ends.js: enough for the page to
// build itself, draw the slots and say what it says.
const vm = require('vm');
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
  const doc = { createElement: function (t) { return node(t); }, createTextNode: function () { return node('#text'); },
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
  const holder = made.filter(function (n) { return n.kids['.status']; })[0];
  return { threw: threw, sent: sent, win: win, status: holder ? holder.kids['.status'] : null,
           cards: made.filter(function (n) { return typeof n.onclick === 'function' && typeof n.onmousedown === 'function'; }) };
}
function wants(r) {
  return r.sent.filter(function (m) { return m[0] === 'thornswood-front' && /^select:want /.test(String(m[1])); }).length;
}
const CHARS = [{ profileId: 858917097, name: 'Bjorn', slot: 1 }];

{
  // The page as the launcher wrote it, up before any plugin: 31 Oct's case.
  const P = pageRun({ characters: CHARS, intro: false });
  yes('the launcher\'s page runs' + (P.threw ? ': ' + P.threw : ''), !P.threw);
  yes('it says the game is still loading under the slots', !!P.status && P.status.textContent === words);
  const card = P.cards[0];
  yes('a character to click is drawn', !!card);
  if (card) { card.onmousedown(); card.onclick(); }
  yes('a click before the front is in picks nobody (31 Oct: it loaded the character in the middle)', wants(P) === 0);
  yes('and the page says so to the front log',
      P.sent.some(function (m) { return m[0] === 'thornswood-front' && String(m[1]) === 'select:a pick before the front was in was not taken'; }));
  // The front's first word, its once a second keys().
  P.win.thornswoodSelect.keys(true);
  yes('the front\'s first keys() takes the still-loading line away', P.status.textContent === '');
  if (card) { card.onmousedown(); card.onclick(); }
  yes('and then a click picks, through the seat check', wants(P) === 1);
}
{
  // A page the front wrote itself: no still-loading line at all.
  const Q = pageRun({ characters: CHARS, intro: false, front: true });
  yes('a page the front wrote runs' + (Q.threw ? ': ' + Q.threw : ''), !Q.threw);
  yes('it never says still loading', !!Q.status && Q.status.textContent !== words);
  if (Q.cards[0]) { Q.cards[0].onmousedown(); Q.cards[0].onclick(); }
  yes('and a click picks at once', wants(Q) === 1);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
