'use strict';
/*
  test-4368-hub-skip-link.js

      node site\tests\test-4368-hub-skip-link.js

  #4368. The hub had no skip link: every tab in its nav comes before main,
  and under 900px the nav stays on screen as a sticky bar, so a keyboard
  went through every tab on every page. And its sign in error, "Not that
  one." or "Could not reach the server.", has to be said aloud, not only
  written into the box.

  This reads site/public/index.html and hub.css as they ship, and runs the
  real site/public/hub.js against a small stand-in page:

    A. the first thing in the hub's frame is a link to #main, before the
       nav, and main is #main and can take focus without joining the Tab
       order;
    B. hub.css keeps the link off screen until it has focus, then shows it
       above the sticky nav;
    C. the sign in error box is a live region (role="status" or "alert",
       or aria-live), so what signIn() writes into it is read out;
    D. following the link in the hub puts focus on the open page's heading,
       or on main when a page has none, and leaves the address alone: no
       #main, which the browser would hand the hub as a popstate and the hub
       would draw again as a page change.

  Read only. Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
function read(f) { return fs.readFileSync(path.join(ROOT, 'site', 'public', f), 'utf8').split('\r\n').join('\n'); }
// The page and the stylesheet with their comments left out, cut at each
// opener and its closer rather than by a pattern.
function uncomment(text, open, close) {
  return text.split(open).map((part, i) => {
    if (i === 0) return part;
    const end = part.indexOf(close);
    return end < 0 ? '' : part.slice(end + close.length);
  }).join('');
}
const HTML = uncomment(read('index.html'), '<!--', '-->');
const CSS = uncomment(read('hub.css'), '/*', '*/');
const HUB_JS = read('hub.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* ------------------------------------------------------------------- A -- */
const shell = /<div id="shell">([\s\S]*?)<\/main>/.exec(HTML);
const inShell = shell ? shell[1] : '';
const firstTag = /<(a|button|input|select|textarea|nav|div|main)\b[^>]*>/.exec(inShell);
yes('A1 the first thing in the hub\'s frame is a link to #main' + (firstTag ? ' (' + firstTag[0] + ')' : ''),
    !!firstTag && firstTag[1] === 'a' && /\bhref="#main"/.test(firstTag[0]) && /\bclass="skip"/.test(firstTag[0]));
yes('A2 it comes before the nav and its tabs', inShell.indexOf('href="#main"') >= 0 &&
    inShell.indexOf('href="#main"') < inShell.indexOf('<nav'));
const mainTag = /<main\b[^>]*>/.exec(HTML);
yes('A3 main is #main' + (mainTag ? ' (' + mainTag[0] + ')' : ''), !!mainTag && /\bid="main"/.test(mainTag[0]));
yes('A4 and it can take focus without joining the Tab order', !!mainTag && /\btabindex="-1"/.test(mainTag[0]));
yes('A5 there is one link to #main in the page', (HTML.match(/href="#main"/g) || []).length === 1);

/* ------------------------------------------------------------------- B -- */
function rule(sel) {
  const re = new RegExp('(^|[}\\s])' + sel.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'm');
  const m = re.exec(CSS);
  return m ? m[2] : '';
}
const off = rule('.skip');
const on = (/(^|[}\s])\.skip:focus[^{]*\{([^}]*)\}/m.exec(CSS) || [])[2] || '';
yes('B1 the link is off screen until it has focus', /clip-path:\s*inset\(50%\)/.test(off) && /width:\s*1px/.test(off) &&
    /height:\s*1px/.test(off) && /overflow:\s*hidden/.test(off) && /position:\s*absolute/.test(off));
yes('B2 and shown when it does', /clip-path:\s*none/.test(on) && /width:\s*auto/.test(on) && /height:\s*auto/.test(on) &&
    /overflow:\s*visible/.test(on));
const navZ = /position:\s*sticky[^}]*z-index:\s*(\d+)/.exec(CSS);
const skipZ = /z-index:\s*(\d+)/.exec(off);
yes('B3 above the nav\'s sticky bar on a narrow screen (' + (skipZ ? skipZ[1] : '?') + ' over ' + (navZ ? navZ[1] : '?') + ')',
    !!navZ && !!skipZ && +skipZ[1] > +navZ[1]);

/* ------------------------------------------------------------------- C -- */
const err = /<[a-z]+\b[^>]*\bid="err"[^>]*>/.exec(HTML);
yes('C1 the sign in error box is a live region' + (err ? ' (' + err[0] + ')' : ''),
    !!err && (/\brole="(status|alert)"/.test(err[0]) || /\baria-live="(polite|assertive)"/.test(err[0])));
yes('C2 and it is in the page from the start, so a later line in it is read out', !!err && !/\bhidden\b/.test(err[0]));
yes('C3 signIn() writes its failures into that box',
    /el\('err'\)\.textContent = r\.status === 401 \? 'Not that one\.'/.test(HUB_JS) &&
    /el\('err'\)\.textContent = 'Could not reach the server\.'/.test(HUB_JS));

/* ------------------------------------------------------------------- D -- */
/* Only what hub.js reaches for at load and in its click handler. */
function makePage(pageHasH1) {
  const doc = { activeElement: null, title: '', body: null };
  const clicks = [];
  function node(id, tag) {
    return {
      id: id, tagName: tag || 'DIV', attrs: {}, dataset: {}, style: {}, className: '', hidden: false,
      value: '', scrollTop: 0, textContent: '', innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      removeAttribute(k) { delete this.attrs[k]; },
      focus() { doc.activeElement = this; },
      appendChild() {}, insertBefore() {}, removeChild() {}, addEventListener() {},
      querySelectorAll() { return []; },
      querySelector(sel) { return sel === 'h1' ? this._h1 || null : null; }
    };
  }
  const byId = {};
  ['gate', 'shell', 'tabs', 'whoami', 'page', 'go', 'pw', 'err', 'gatediscord', 'pwbox', 'out', 'hubsaid']
    .forEach(function (id) { byId[id] = node(id); });
  if (pageHasH1) byId.page._h1 = node('', 'H1');
  const main = node('main', 'MAIN');
  doc.body = node('', 'BODY');
  doc.getElementById = function (id) { return byId[id] || null; };
  doc.querySelector = function (sel) { return sel === 'main' ? main : null; };
  doc.querySelectorAll = function () { return []; };
  doc.addEventListener = function (type, fn) { if (type === 'click') clicks.push(fn); };
  doc.createElement = function (t) { return node('', String(t).toUpperCase()); };
  const pushed = [];
  const box = {
    document: doc,
    location: { pathname: '/hub', search: '', href: '', hash: '' },
    history: { pushState(s, t, u) { pushed.push(u); }, replaceState() {} },
    localStorage: { getItem() { return null; }, setItem() {} },
    fetch: function () { return new Promise(function () {}); },
    marked: { parse: function (s) { return '<p>' + String(s) + '</p>'; }, parseInline: String, setOptions() {}, use() {} },
    URLSearchParams, setTimeout: function () { return 0; }, clearTimeout() {},
    alert() {}, confirm() { return true; }, navigator: {}, console
  };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(HUB_JS, box, { filename: 'hub.js' });
  return { box, doc, byId, main, clicks, pushed };
}
function skipLink() {
  return { getAttribute(k) { return k === 'href' ? '#main' : null; }, target: '' };
}
function follow(p) {
  let stopped = false;
  const link = skipLink();
  const e = { target: { closest(sel) { return sel === 'a' ? link : null; } },
              metaKey: false, ctrlKey: false, shiftKey: false, preventDefault() { stopped = true; } };
  p.clicks.forEach(function (fn) { fn(e); });
  return stopped;
}

{
  const p = makePage(true);
  yes('D0 hub.js listens for clicks on the page (' + p.clicks.length + ')', p.clicks.length >= 1);
  const h1 = p.byId.page.querySelector('h1');
  const stopped = follow(p);
  yes('D1 following the link puts focus on the open page\'s heading', p.doc.activeElement === h1);
  yes('D2 and the browser is not left to put #main in the address', stopped);
  yes('D3 nor does the hub change the address or the page', p.pushed.length === 0);
}
{
  const p = makePage(false);
  follow(p);
  yes('D4 on a page with no heading, focus goes to main', p.doc.activeElement === p.main);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
