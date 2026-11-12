'use strict';
/*
  test-4127-slideshow-a11y.js

      node site\tests\test-4127-slideshow-a11y.js

  Issue #4127. The front page's slideshow turned every 5 seconds and stopped
  only while the pointer was over it: tabbing into it did not hold it, and
  there was no way to pause it. A press on an arrow or a dot started a new
  8 second timer every time without clearing the last, and that timer
  started the turning again even with the pointer on it. Its box was a live
  region, so a screen reader read the next name and "Open the gallery" at
  every turn, wherever the reader was. The open picture's dot was marked
  only by a class, and the top bar never marked the open page. And the
  smooth in-page scroll ignored a visitor's reduced motion setting.

  site\public\home.js's startSlideshow and markCurrent are lifted out and run
  on a small stand-in page with a clock the test turns by hand:

    A  focus in the slideshow, or on its dots, holds it, and it turns again
       only once focus has left both.
    B  a pause button stops it until pressed again, and says which it does.
    C  presses clear the resume before them, and a resume never starts the
       turning while the pointer or focus is on it (the issue's measured
       cases: a Next at 1 s with the pointer kept over it; Next at 1 s and
       at 7 s).
    D  the open dot carries aria-current, and only it.
    E  the open page's top bar link carries aria-current="page", only it.
    F  #galleryShow is not a live region, and smooth scrolling is only for
       a visitor who has not asked for less motion.

  Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
const read = (f) => fs.readFileSync(path.join(ROOT, 'site', 'public', f), 'utf8').split(CR).join('');
const JS = read('home.js'), HTML = read('home.html'), CSS = read('home.css');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why) : '')); }
}

// A top level function of home.js, by its braces.
function lift(name) {
  const at = JS.indexOf('\nfunction ' + name + '(');
  if (at < 0) return null;
  let depth = 0;
  for (let i = JS.indexOf('{', at); i < JS.length; i++) {
    if (JS[i] === '{') depth++;
    else if (JS[i] === '}' && --depth === 0) return JS.slice(at + 1, i + 1);
  }
  return null;
}

/* ---- a small page ------------------------------------------------------ */
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = {}; this.children = []; this.parent = null; this.listeners = {};
    this.className = ''; this.hidden = false; this.innerHTML = ''; this.textContent = '';
  }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  hasAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k); }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  fire(t, ev) { (this.listeners[t] || []).forEach((fn) => fn(Object.assign({ target: this }, ev || {}))); }
  all() { return this.children.reduce((a, c) => a.concat([c], c.all()), []); }
  querySelectorAll(sel) { const t = sel.toUpperCase(); return this.all().filter((e) => e.tagName === t); }
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  click() { if (typeof this.onclick === 'function') this.onclick({ target: this }); this.fire('click'); }
}
// Focus moving from one element to another, as the browser tells it: a
// focusout on where it was (relatedTarget: where it goes), bubbling up, then
// a focusin on where it lands, bubbling up.
function bubble(el, type, ev) { for (let x = el; x; x = x.parent) x.fire(type, Object.assign({ target: el }, ev)); }
function focusMove(from, to) {
  if (from) bubble(from, 'focusout', { relatedTarget: to || null });
  if (to) bubble(to, 'focusin', { relatedTarget: from || null });
}

function clock() {
  const c = { now: 0, timers: [], seq: 0, turns: 0 };
  c.setTimeout = (fn, ms) => { const t = { id: ++c.seq, at: c.now + ms, fn, every: 0 }; c.timers.push(t); return t.id; };
  c.setInterval = (fn, ms) => { const t = { id: ++c.seq, at: c.now + ms, fn, every: ms }; c.timers.push(t); return t.id; };
  c.clearTimeout = c.clearInterval = (id) => { c.timers = c.timers.filter((t) => t.id !== id); };
  c.run = (to) => {
    for (;;) {
      const due = c.timers.filter((t) => t.at <= to).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      c.now = due.at;
      if (due.every) due.at += due.every; else c.timers = c.timers.filter((t) => t !== due);
      due.fn();
    }
    c.now = to;
  };
  return c;
}

function slideshow(opts) {
  opts = opts || {};
  const src = lift('startSlideshow');
  if (!src) return null;
  const c = clock();
  const show = new El('div'), dots = new El('div');
  const document = { createElement: (t) => new El(t) };
  const shots = [1, 2, 3, 4].map((n) => ({ name: n + '.png', url: '/shot/' + n + '.png', by: 'P' + n }));
  const esc = (s) => String(s);
  const fn = new Function('document', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'esc',
    src + '\nreturn startSlideshow;')(document, c.setTimeout, c.clearTimeout, c.setInterval, c.clearInterval, esc);
  fn(show, dots, shots, !!opts.reduce);
  const open = () => show.querySelectorAll('img').findIndex((im) => im.className === 'on');
  const btn = (label) => show.querySelectorAll('button').find((b) => (b.getAttribute('aria-label') || '').indexOf(label) === 0);
  return { c, show, dots, open, btn, at: (s) => { c.run(s * 1000); return open(); } };
}

// ---- A: focus holds it ---------------------------------------------------
let s = slideshow();
yes('home.js has a startSlideshow the page runs, lifted on its own', !!s);
if (s) {
  s.at(4);
  const next = s.btn('Next');
  focusMove(null, next);
  const was = s.at(4.1);
  yes('A1 with focus on the Next arrow, it does not turn (open ' + was + ' at 4.1 s, ' + s.at(30) + ' at 30 s)', s.open() === was);
  const dot = s.dots.querySelectorAll('button')[2];
  focusMove(next, dot);
  yes('A2 focus moving from the slideshow to its dots still holds it', s.at(60) === was);
  focusMove(dot, null);
  yes('A3 once focus leaves both, it turns again', s.at(66) !== was);
}

// ---- B: a pause button ---------------------------------------------------
s = slideshow();
if (s) {
  const pause = s.btn('Pause');
  yes('B1 there is a pause button, a real button', !!pause && pause.getAttribute('type') === 'button' || (pause && pause.type === 'button'));
  if (pause) {
    pause.click();
    const was = s.open();
    yes('B2 pressed, the slideshow stops for good (' + s.at(60) + ')', s.open() === was);
    yes('B3 and the button says it now plays it', (pause.getAttribute('aria-label') || '').indexOf('Play') === 0);
    pause.click();
    yes('B4 pressed again, it turns again', s.at(66) !== was);
    yes('B5 and says it pauses it', (pause.getAttribute('aria-label') || '').indexOf('Pause') === 0);
  }
  const r = slideshow({ reduce: true });
  yes('B6 with reduced motion nothing turns, and no pause button is offered for it',
    r.at(30) === 0 && !r.btn('Pause'));
}

// ---- C: presses and the resume ------------------------------------------
// The issue's first case: pointer kept over it, one Next at 1 s.
s = slideshow();
if (s) {
  s.show.fire('mouseenter');
  s.c.run(1000);
  s.btn('Next').click();
  const after = s.open();
  yes('C1 pointer kept over it and one Next at 1 s: no turn at 14, 19, 24 or 29 s (' +
    [14, 19, 24, 29].map((t) => s.at(t)).join(', ') + ')', s.open() === after);
}
// The second: Next at 1 s and at 7 s, pointer away.
s = slideshow();
if (s) {
  s.c.run(1000); s.btn('Next').click();
  s.c.run(7000); s.btn('Next').click();
  const after = s.open();
  yes('C2 Next at 1 s and at 7 s: nothing turns at 14 s, the first press\'s resume is cleared (' + s.at(14.5) + ')', s.at(14.5) === after);
  yes('C3 the second press\'s 8 seconds are honoured: by 20.5 s it has turned (' + s.at(20.5) + ')', s.open() !== after);
}
// A resume never starts while focus is on it.
s = slideshow();
if (s) {
  const next = s.btn('Next');
  focusMove(null, next);
  next.click();
  const after = s.open();
  yes('C4 a press with focus kept on the arrow does not turn again after its 8 seconds (' + s.at(40) + ')', s.open() === after);
}

// ---- D: the open dot -----------------------------------------------------
s = slideshow();
if (s) {
  const ds = s.dots.querySelectorAll('button');
  const cur = () => ds.map((b) => b.getAttribute('aria-current'));
  yes('D1 the open dot carries aria-current, the others none (' + JSON.stringify(cur()) + ')',
    ds.length === 4 && cur()[0] === 'true' && cur().slice(1).every((v) => v === null));
  ds[2].click();
  yes('D2 and it moves with the picture (' + JSON.stringify(cur()) + ')',
    s.open() === 2 && cur()[2] === 'true' && cur().filter((v) => v !== null).length === 1);
}

// ---- E: the open page in the top bar ------------------------------------
const markSrc = lift('markCurrent');
yes('home.js has a markCurrent for the top bar, lifted on its own', !!markSrc);
if (markSrc) {
  const mark = new Function(markSrc + '\nreturn markCurrent;')();
  const nav = new El('nav');
  const hrefs = (HTML.slice(HTML.indexOf('<nav class="top" id="nav"'), HTML.indexOf('</nav>', HTML.indexOf('<nav class="top" id="nav"')))
    .match(/href="[^"]*"/g) || []).map((h) => h.slice(6, -1));
  hrefs.forEach((h) => { const a = new El('a'); a.setAttribute('href', h); nav.appendChild(a); });
  const marked = (here) => {
    mark(nav, here);
    return nav.querySelectorAll('a').filter((a) => a.getAttribute('aria-current') === 'page').map((a) => a.getAttribute('href'));
  };
  yes('E1 on /rules only the Rules link is the open page (' + marked('/rules') + ')', JSON.stringify(marked('/rules')) === '["/rules"]');
  yes('E2 on /downloads only the Download link (' + marked('/downloads') + ')', JSON.stringify(marked('/downloads')) === '["/downloads"]');
  yes('E3 on /help, a page the bar does not list, none, and the old mark is gone (' + marked('/help') + ')', marked('/help').length === 0);
  yes('E4 home.js marks the bar with the page it is on', /markCurrent\(nav, here\)/.test(JS));
}

// ---- F: no live box, no forced smooth scroll ----------------------------
const box = (/<div[^>]*id="galleryShow"[^>]*>/.exec(HTML) || [''])[0];
yes('F1 #galleryShow is not a live region (' + box + ')', !!box && !/aria-live/.test(box));
const bare = CSS.replace(/@media[^{]*prefers-reduced-motion:\s*no-preference[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
yes('F2 smooth scrolling is set only inside @media (prefers-reduced-motion: no-preference)',
  /scroll-behavior:\s*smooth/.test(CSS) && !/scroll-behavior:\s*smooth/.test(bare));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
