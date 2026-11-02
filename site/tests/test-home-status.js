// test-home-status.js
//
// The line beside the green dot on the home page says what the dot means.
//
// WHY. Issue #884. With the server up and nobody on, the line read 'The world
// is open', and Djinn read it on 28 September as the game being open to the
// public. It is alpha and application based everywhere else on the site; the
// dot only says the server is up. Patrick: "The green light shows the server
// is up also", and then the line itself: "The world is open, apply to be an
// alpha playtester in the discord!" So it keeps saying open, and says how in.
//
// This cuts the status branch out of the home page's script and runs it with a
// stand-in document for nobody on, one on, three on, and the server down. The
// script moved out of home.html into home.js in #1479 (no inline script under
// the site's content security policy), so that is the file it reads.
//
// Read only.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', '..', 'site', 'public', 'home.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// paintStatus in home.js, which the first load and a page brought back from
// the back and forward cache both call (#3218).
const START = "  var dot = document.getElementById('dot'), t = document.getElementById('livetext');";
const END = "      if (gone) gone.hidden = true;\n    }\n  }\n";
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;
yes('home.js still has its status line', block !== null);
if (!block) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

// A node that keeps its text and its children, enough to read back what a
// person sees and where the link goes.
function node(tag) {
  const n = { tag: tag, children: [], href: '', className: '', hidden: false, _text: '' };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._text + n.children.map(function (c) { return c.textContent; }).join(''); },
    set: function (v) { n._text = String(v); n.children = []; }
  });
  n.appendChild = function (c) { n.children.push(c); return c; };
  return n;
}

function run(status, before) {
  const els = {
    dot: node('span'), livetext: node('span'),
    figOnline: node('span'), figOnlineWrap: node('div')
  };
  els.dot.className = before && before.lit ? 'dot on' : 'dot';
  els.figOnlineWrap.hidden = !(before && before.lit);
  const document = {
    getElementById: function (id) { return els[id] || null; },
    createElement: function (tag) { return node(tag); }
  };
  vm.runInNewContext('(function(d){' + block + '})(d);', { document: document, d: { status: status }, String: String });
  return els;
}

let e = run({ up: true, online: 0 });
yes('nobody on: the dot is lit', e.dot.className === 'dot on');
yes("nobody on: Patrick's line, word for word (got '" + e.livetext.textContent + "')",
    e.livetext.textContent === 'The world is open, apply to be an alpha playtester in the Discord!');
yes('nobody on: it says it is an alpha and that getting in is an application',
    /alpha/i.test(e.livetext.textContent) && /apply/i.test(e.livetext.textContent));
const link = e.livetext.children[0];
yes('nobody on: the apply half is one link to /join', e.livetext.children.length === 1 &&
    link.tag === 'a' && link.href === '/join' &&
    link.textContent === 'apply to be an alpha playtester in the Discord!');
yes("nobody on: 'The world is open, ' stays plain text", e.livetext._text === 'The world is open, ');
yes('nobody on: no head count tile', e.figOnlineWrap.hidden === true);

e = run({ up: true, online: 1 });
yes('one on: unchanged, and no link', e.livetext.textContent === '1 person in the world' &&
    e.livetext.children.length === 0);
e = run({ up: true, online: 3 });
yes('three on: unchanged, with the tile', e.livetext.textContent === '3 people in the world' &&
    e.figOnlineWrap.hidden === false && e.figOnline.textContent === '3');
e = run({ up: false });
yes('down: unchanged', e.livetext.textContent === 'Server offline' && e.dot.className === 'dot');
// Painted again over a page that showed three on, as Back to the page does
// (#3218): the dot goes out and the head count tile goes with it.
e = run({ up: false }, { lit: true });
yes('down after three on: the dot goes out and the tile is hidden',
    e.livetext.textContent === 'Server offline' && e.dot.className === 'dot' && e.figOnlineWrap.hidden === true);
e = run({ up: true, online: 0 }, { lit: true });
yes('nobody on after three on: the tile is hidden', e.figOnlineWrap.hidden === true);

// Out of the server's own number when it says one (#481).
e = run({ up: true, online: 3, max: 25 });
yes("three of 25: '3 of 25 people in the world' (got '" + e.livetext.textContent + "')",
    e.livetext.textContent === '3 of 25 people in the world');
yes('three of 25: the tile says 3 of 25', e.figOnline.textContent === '3 of 25' && e.figOnlineWrap.hidden === false);
e = run({ up: true, online: 1, max: 25 });
yes('one of 25: 1 of 25 people in the world', e.livetext.textContent === '1 of 25 people in the world');
e = run({ up: true, online: 25, max: 25 });
yes("full: 'The world is full, 25 of 25 people are in it' (got '" + e.livetext.textContent + "')",
    e.livetext.textContent === 'The world is full, 25 of 25 people are in it');
e = run({ up: true, online: 0, max: 25 });
yes("nobody on with a number: still Patrick's line", /^The world is open, /.test(e.livetext.textContent));

const said = e.livetext.textContent + run({ up: true, online: 0 }).livetext.textContent;
yes('no em dash in what it says', said.indexOf(String.fromCharCode(0x2014)) < 0);
yes('never the word the house rules forbid', !new RegExp('pla' + 'yer', 'i').test(said));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
