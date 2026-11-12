// test-journal-theme.js
//
// The journal behind J wears the K panel's theme, and still does what it did.
//
// Patrick, 23 September, playing on dev: "Also the journal menu works but is
// ugly asf and doesn't match the theme we use with our other menus".
//
// MEASURED before the change: the K panel (game/ui/thornswood-skills.js)
// is the game's theme, a Palatino serif, parchment text #d9cfb4, gold #c6aa6d
// and #e9d19b, gold hairline borders, square corners, a dark vignette behind a
// near black panel, uppercase gold buttons with a gold primary, and gold
// scrollbars. The journal was drawn from another template: system-ui sans
// serif, 12px and 7px rounded corners, flat grey #1b1f26 and #212630 and a
// brass #d9ab52, the To Do List web page's palette.
//
// So this reads the K panel's own stylesheet out of thornswood-skills.js and
// holds the journal's to it, value for value, rather than to a copy of the
// numbers written here. If the K panel's theme moves, this says the journal
// has not followed.
//
// AND THE OTHER HALF: only the look was to change. The journal is RUN here,
// in a small stand-in for the page, and every button is pressed, so a restyle
// that broke an id or a class the script reads fails this too.
//
// thornswood-party.js and thornswood-trade.js were drawn from the same old
// template and now wear the same theme; game/tests/test-party-trade-theme.js holds
// them to it.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}
const journalSrc = read('game', 'ui', 'thornswood-journal.js');
const skillsSrc = read('game', 'ui', 'thornswood-skills.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function code(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ------------------------------------------------------ a page to run it in
/*
  Just enough of a document for the journal: elements made from the markup it
  writes, found again by id or by tag and attribute, with onclick, value and
  getAttribute. Every element a string of markup makes is kept on the element
  that string was written into, so a search from the root reaches the side
  list and the page after they are drawn.
*/
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag).toLowerCase(), attrs: {}, kids: [], children: [], html: '',
    id: '', className: '', textContent: '', value: '', onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) {
          if (tests.some(function (t) { return t(k); })) { out.push(k); }
          walk(k.kids);
        });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this.html; },
    set(h) { this.html = h; this.kids = parse(h); }
  });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { throw new Error('the stand-in page cannot read the selector ' + sel); }
  return function (el) {
    if (m[1] && el.tagName !== m[1].toLowerCase()) { return false; }
    if (m[2] && el.attrs.id !== m[2]) { return false; }
    if (m[3] && !Object.prototype.hasOwnProperty.call(el.attrs, m[3])) { return false; }
    return true;
  };
}
function parse(html) {
  const out = [];
  const tag = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const el = makeEl(m[1]);
    const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
    let a;
    while ((a = attr.exec(m[2]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
    el.id = el.attrs.id || '';
    el.className = el.attrs['class'] || '';
    if (el.tagName === 'input') { el.value = el.attrs.value || ''; }
    if (el.tagName === 'textarea') {
      const shut = html.indexOf('</textarea>', tag.lastIndex);
      el.value = unesc(html.slice(tag.lastIndex, shut));
    }
    out.push(el);
  }
  return out;
}

const told = [];
const sent = [];
const keys = {};
const doc = {
  head: makeEl('head'),
  body: makeEl('body'),
  activeElement: null,
  createElement: makeEl,
  addEventListener(type, fn) { keys[type] = fn; }
};
const win = {
  skyrimPlatform: { sendMessage(to, what) { told.push(to + ' ' + what); } },
  thornswoodNet: { say(line) { sent.push(line); return true; } },
  // The panel is scaled to the screen (test-journal-scale.js holds that).
  innerWidth: 1920, innerHeight: 1080,
  addEventListener() { }
};
new Function('window', 'document', journalSrc)(win, doc);
const J = win.thornswoodJournal;
const style = doc.head.children[0];
const root = doc.body.children[0];
const CSS = style ? style.textContent : '';

// -------------------------------------------------------------- read the css
function rules(css) {
  const out = {};
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const sel = m[1].replace(/\s+/g, ' ').trim();
    const d = out[sel] || (out[sel] = {});
    m[2].split(';').forEach(function (bit) {
      const at = bit.indexOf(':');
      if (at < 0) { return; }
      d[bit.slice(0, at).trim()] = bit.slice(at + 1).replace(/\s+/g, ' ').trim();
    });
  }
  return out;
}
const kMatch = /var css = \[([\s\S]*?)\]\.join\(''\);/.exec(skillsSrc);
const kCss = kMatch ? new Function('return [' + kMatch[1] + '].join("");')() : '';
const K = rules(kCss);
const JR = rules(CSS);
function k(sel, prop) { return (K['#ts-skills' + sel] || {})[prop]; }
function j(sel, prop) { return (JR['#ts-journal' + sel] || {})[prop]; }

// ------------------------------------------------------- it loads and opens
yes('the journal loads and says it is ready', !!J && told.indexOf('thornswood-front journal:ready') >= 0);
yes('its stylesheet is in the page', CSS.length > 0);
yes('the K panel\'s stylesheet was read out of thornswood-skills.js', !!K['#ts-skills'] && !!K['#ts-skills .panel']);

// ------------------------------------------------------------- the fonts
{
  const stack = k('', 'font-family');
  yes('the K panel\'s type is the Palatino stack', /^"Palatino Linotype",Palatino,/.test(stack || ''));
  yes('the journal is set in the same type', j('', 'font-family') === stack);
  const faces = [];
  Object.keys(JR).forEach(function (s) {
    const f = JR[s]['font-family'];
    if (f && f !== stack && f !== 'inherit') { faces.push(s + ' ' + f); }
  });
  yes('and nothing inside it picks another' + (faces.length ? ' (' + faces.join('; ') + ')' : ''), !faces.length);
  const src = code(journalSrc);
  yes('no system-ui or sans serif anywhere in the page, markup included',
      !/system-ui|sans-serif/.test(src));
  yes('no font off the network: the game\'s browser has only the machine\'s',
      !/@font-face|@import|url\(/.test(CSS));
}

// ----------------------------------------------------------- the colours
{
  const COLOUR = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;
  const norm = function (c) { return c.toLowerCase().replace(/\s+/g, ''); };
  const theirs = {};
  (kCss.match(COLOUR) || []).forEach(function (c) { theirs[norm(c)] = true; });
  const stray = {};
  (code(journalSrc).match(COLOUR) || []).forEach(function (c) {
    if (!theirs[norm(c)]) { stray[norm(c)] = true; }
  });
  const list = Object.keys(stray);
  yes('every colour in the journal, markup included, is one the K panel uses' +
      (list.length ? ' (not: ' + list.join(' ') + ')' : ''), list.length === 0);
  yes('the text is the K panel\'s parchment', j('', 'color') === k('', 'color'));
  [['#1b1f26', 'the flat grey panel'], ['#212630', 'the grey list rows'],
   ['#d9ab52', 'the To Do List page\'s brass'], ['#3a424e', 'the grey borders'],
   ['#79828f', 'the grey small print']].forEach(function (old) {
    yes('the old template\'s ' + old[1] + ' ' + old[0] + ' is gone',
        code(journalSrc).toLowerCase().indexOf(old[0]) < 0);
  });
}

// ------------------------------------------------ backdrop, panel, corners
{
  yes('the screen behind is the K panel\'s dark vignette',
      /radial-gradient/.test(j('', 'background') || '') && j('', 'background') === k('', 'background'));
  ['background', 'border', 'outline', 'outline-offset', 'box-shadow'].forEach(function (p) {
    yes('the panel\'s ' + p + ' is the K panel\'s', !!k(' .panel', p) && j(' .panel', p) === k(' .panel', p));
  });
  const rounded = [];
  Object.keys(JR).forEach(function (s) {
    if (JR[s]['border-radius'] && !/::-webkit-scrollbar-thumb$/.test(s)) { rounded.push(s); }
  });
  yes('square corners: no rounding but the scrollbar\'s, which the K panel has too' +
      (rounded.length ? ' (' + rounded.join('; ') + ')' : ''), rounded.length === 0);
  yes('and none in the markup the script writes either',
      !/border-radius/.test(code(journalSrc.slice(journalSrc.indexOf('function build()')))));
  yes('the title is the K panel\'s title, in size and colour',
      j(' h2', 'color') === k(' .title', 'color') && j(' h2', 'font-size') === k(' .title', 'font-size'));
  yes('the lines across the panel are the K panel\'s gold hairline',
      j(' h2', 'border-bottom') === k(' .head', 'border-bottom') &&
      j(' .foot', 'border-top') === k(' .foot', 'border-top') &&
      j(' .side', 'border-right') === k(' .nav', 'border-right'));
}

// ------------------------------------------------------ buttons and inputs
{
  yes('a button is the K panel\'s: uppercase, spaced, gold on dark',
      j(' button', 'text-transform') === 'uppercase' &&
      j(' button', 'letter-spacing') === k(' .tsbtn', 'letter-spacing') &&
      j(' button', 'color') === k(' .tsbtn', 'color') &&
      j(' button', 'border') === k(' .tsbtn', 'border') &&
      j(' button', 'background') === k(' .tsbtn', 'background'));
  yes('and the primary is the K panel\'s gold one with dark words',
      j(' button.go', 'background') === k(' .tsbtn.primary', 'background') &&
      j(' button.go', 'border-color') === k(' .tsbtn.primary', 'border-color') &&
      j(' button.go', 'color') === k(' .tsbtn.primary', 'color'));
  yes('New journal is that same primary',
      j(' .item.go', 'background') === k(' .tsbtn.primary', 'background') &&
      j(' .item.go', 'color') === k(' .tsbtn.primary', 'color'));
  yes('the journal you are reading is lit the way the K panel lights a row',
      j(' .item.sel', 'background') === k(' .navrow.on', 'background') &&
      j(' .item.sel', 'box-shadow') === k(' .card.at', 'box-shadow'));
  yes('the page you are on is lit the way the K panel lights a choice',
      j(' button[data-page].go', 'background') === k(' .half.on', 'background') &&
      j(' button[data-page].go', 'border-color') === k(' .half.on', 'border-color'));
  const field = JR['#ts-journal input,#ts-journal textarea,#ts-journal select'] || {};
  yes('a text box has a gold hairline and square corners',
      /^1px solid rgba\(198,170,109,/.test(field.border || '') && !field['border-radius']);
  yes('the list a select drops down is a solid dark, not see-through',
      /^#[0-9a-f]{6}$/i.test(j(' option', 'background') || ''));
  const moving = Object.keys(JR).filter(function (s) { return /:hover/.test(s) || JR[s].transition; });
  yes('no :hover and no transitions, the K panel\'s rule' +
      (moving.length ? ' (' + moving.join('; ') + ')' : ''), moving.length === 0);
}

// ------------------------------------------------------------- scrollbars
{
  const theirs = Object.keys(K).filter(function (s) { return /^::-webkit-scrollbar/.test(s); });
  yes('the K panel\'s scrollbar rules were found', theirs.length >= 4);
  theirs.forEach(function (s) {
    const mine = JR['#ts-journal ' + s];
    yes('the journal carries ' + s + ' as the K panel writes it',
        !!mine && JSON.stringify(mine) === JSON.stringify(K[s]));
  });
}

// ---------------------------------------- the layout is what it was before
{
  yes('the panel is still 1040 by 660', j(' .panel', 'width') === '1040px' && j(' .panel', 'height') === '660px');
  yes('with the title, the two columns and the foot, in that order',
      j(' .panel', 'grid-template-rows') === 'auto 1fr auto');
  yes('and the journal list still 280px down the left', j(' .cols', 'grid-template-columns') === '280px 1fr');
  yes('the text box is still at least 300px tall', j(' textarea', 'min-height') === '300px');
}

// ------------------------------------------------- and it does what it did
{
  J.setData({
    journals: [
      { id: 'b1', title: 'Road notes', pages: [
        { id: 'p1', title: 'Day one', text: 'Left <Riverwood> at dawn.' },
        { id: 'p2', title: 'Day two', text: '' }] },
      { id: 'b2', title: 'Recipes', pages: [] }
    ],
    shared: [{ title: 'Maps', from: 'Sera', whole: true, pages: [{ title: 'North', text: 'Snow.' }] }],
    friends: [{ name: 'Sera' }, { name: 'Bjorn' }]
  });
  J.open();
  yes('opening shows the panel and tells the plugin', root.className === 'on' &&
      told.indexOf('thornswood-front journal:opened') >= 0);

  const side = root.querySelector('#ts-journal-side');
  const books = side.querySelectorAll('button[data-book]');
  yes('both journals are listed as items', books.length === 2 && /\bitem\b/.test(books[0].className));
  yes('a shared journal is listed, from whom', side.querySelectorAll('button[data-shared]').length === 1 &&
      /from Sera/.test(side.innerHTML));

  side.querySelector('button[data-new]').onclick.call(side.querySelector('button[data-new]'));
  yes('New journal sends /journal new', sent[sent.length - 1] === '/journal new Journal');

  books[0].onclick.call(books[0]);
  const lit = root.querySelector('#ts-journal-side').querySelectorAll('button[data-book]')[0];
  yes('clicking a journal marks it picked', / sel\b/.test(lit.className));

  let main = root.querySelector('#ts-journal-main');
  const does = main.querySelectorAll('button[data-do]').map(function (b) { return b.getAttribute('data-do'); });
  yes('its actions are all there', ['rename', 'sharebook', 'unsharebook', 'dropbook', 'newpage']
      .every(function (d) { return does.indexOf(d) >= 0; }));
  function press(verb) {
    const b = root.querySelector('#ts-journal-main').querySelectorAll('button[data-do]')
      .filter(function (x) { return x.getAttribute('data-do') === verb; })[0];
    b.onclick.call(b);
  }
  root.querySelector('#ts-journal-title').value = 'Road book';
  press('rename');
  yes('Rename sends the new title', sent[sent.length - 1] === '/journal title b1 Road book');
  root.querySelector('#ts-journal-who').value = 'Sera';
  press('sharebook');
  yes('sharing the whole journal names the friend', sent[sent.length - 1] === '/journal share b1 - Sera');

  const tab = root.querySelector('#ts-journal-main').querySelectorAll('button[data-page]')[0];
  tab.onclick.call(tab);
  main = root.querySelector('#ts-journal-main');
  const onTab = main.querySelectorAll('button[data-page]')[0];
  yes('clicking a page marks its tab', /\bgo\b/.test(onTab.getAttribute('class') || ''));
  yes('and opens its text for writing, escaped', !!root.querySelector('#ts-journal-text') &&
      root.querySelector('#ts-journal-text').value === 'Left <Riverwood> at dawn.' &&
      /&lt;Riverwood&gt;/.test(main.innerHTML));
  root.querySelector('#ts-journal-ptitle').value = 'Day one';
  root.querySelector('#ts-journal-text').value = 'one\ntwo';
  press('save');
  yes('Save sends the page on one line', sent[sent.length - 1] === '/journal page b1 p1 Day one :: one\\ntwo');
  root.querySelector('#ts-journal-who').value = 'Bjorn';
  press('sharepage');
  yes('sharing one page names it and the friend', sent[sent.length - 1] === '/journal share b1 p1 Bjorn');

  const sh = root.querySelector('#ts-journal-side').querySelectorAll('button[data-shared]')[0];
  sh.onclick.call(sh);
  yes('a shared journal reads with who it is from',
      /class="from"/.test(root.querySelector('#ts-journal-main').innerHTML) &&
      /Snow\./.test(root.querySelector('#ts-journal-main').innerHTML));

  yes('the foot still says how to close it',
      /Escape or J closes this/.test(root.querySelector('#ts-journal-foot').textContent));
  keys.keydown({ key: 'Escape', preventDefault() { } });
  yes('Escape closes it and tells the plugin', root.className === '' &&
      told.indexOf('thornswood-front journal:closed') >= 0);

  // J, as the foot says (#530). While the page holds the keyboard the plugin
  // hears no key at all, so the page has to close itself on J. Not while
  // somebody is typing a j into a page or a title, and not Ctrl+J.
  const shutWas = told.filter(function (t) { return t === 'thornswood-front journal:closed'; }).length;
  J.open();
  keys.keydown({ key: 'j', target: makeEl('textarea'), preventDefault() { } });
  yes('J typed into the page text leaves it open', J.isOpen());
  keys.keydown({ key: 'j', target: makeEl('input'), preventDefault() { } });
  yes('J typed into a title or a name leaves it open', J.isOpen());
  keys.keydown({ key: 'j', ctrlKey: true, target: doc.body, preventDefault() { } });
  yes('Ctrl+J leaves it open', J.isOpen());
  keys.keydown({ key: 'j', target: doc.body, preventDefault() { } });
  yes('J anywhere else closes it and tells the plugin', !J.isOpen() && root.className === '' &&
      told.filter(function (t) { return t === 'thornswood-front journal:closed'; }).length === shutWas + 1);
  J.open();
  keys.keydown({ key: 'J', target: doc.body, preventDefault() { } });
  yes('and so does Shift+J', !J.isOpen());
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
