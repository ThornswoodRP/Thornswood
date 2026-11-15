'use strict';
/*
  test-4333-hero-motion-space.js

  #4333: on a phone the front page's banner grew a moment after it loaded.
  The motion button (#bannerMotion) goes out with the hidden attribute and
  home.js clears it once it has found the video. The browser's own
  stylesheet makes [hidden] display:none, so until then the button took no
  room, and when it appeared the hero grew by its height and pushed the
  page down. This holds the fix, reading the page and its stylesheets as
  they ship:

  A. the button goes out hidden, as before, so nobody can press or reach it
     before the script that gives it a meaning has run;
  B. home.css keeps its box while it is hidden: a .hero-motion[hidden] rule
     that sets a display other than none and visibility:hidden, and no rule
     in the stylesheets the page loads that sets display:none on [hidden]
     for it;
  C. the button's own rule still gives it its height, so the reserved box
     is the box it shows in;
  D. home.js only clears hidden: no inline display, height or visibility
     change, no timer, so the box never moves after the first paint.

  Against main it fails B1.
*/
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', '..', 'site', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8').split('\r\n').join('\n');
const HTML = read('home.html');
const JS = read('home.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Every rule as { media, selectors, body }, comments out. One level of
// @media is enough for these files.
function rules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) { break; }
    const head = css.slice(i, open).trim();
    if (/^@media/.test(head)) {
      let depth = 1, j = open + 1;
      while (j < css.length && depth) { if (css[j] === '{') { depth++; } else if (css[j] === '}') { depth--; } j++; }
      for (const r of rules(css.slice(open + 1, j - 1))) { out.push({ media: head, selectors: r.selectors, body: r.body }); }
      i = j;
    } else {
      const close = css.indexOf('}', open);
      out.push({ media: '', selectors: head.split(',').map((s) => s.trim()), body: css.slice(open + 1, close) });
      i = close + 1;
    }
  }
  return out;
}

// The stylesheets the page loads, in order.
const sheets = [...HTML.matchAll(/<link rel="stylesheet" href="\/([^"?]+)"/g)].map((m) => m[1]);
yes('the page loads home.css (' + sheets.join(', ') + ')', sheets.indexOf('home.css') >= 0);
const all = [];
for (const s of sheets) { for (const r of rules(read(s))) { all.push(Object.assign({ sheet: s }, r)); } }

// ------------------------------------------------------------- A. markup --
const bm = /<button\b[^>]*\bid="bannerMotion"[^>]*>/.exec(HTML);
yes('A1 the motion button is in the page', !!bm);
yes('A2 it carries class hero-motion and goes out hidden', !!bm && /\sclass="hero-motion"/.test(bm[0]) && /\shidden(?=[\s>])/.test(bm[0]));
yes('A3 with no inline style that could undo its box', !!bm && !/\sstyle=/.test(bm[0]));

// ------------------------------------------------------ B. reserved box --
const held = all.filter((r) => !r.media && r.selectors.indexOf('.hero-motion[hidden]') >= 0);
const body = held.map((r) => r.body).join(';');
yes('B1 home.css has a .hero-motion[hidden] rule for every screen', held.length > 0);
yes('B2 it keeps a box: display is set and is not none', /(^|;)\s*display\s*:\s*(?!none)[a-z-]+/.test(body));
yes('B3 and it is only unseen: visibility:hidden', /(^|;)\s*visibility\s*:\s*hidden\b/.test(body));
const hides = all.filter((r) => /display\s*:\s*none/.test(r.body) && r.selectors.some((s) =>
  /^\[hidden\]$|^\*\[hidden\]$|^button\[hidden\]$|hero-motion|#bannerMotion/.test(s)));
yes('B4 no rule in ' + sheets.join(' or ') + ' sets display:none on it, on any screen' +
    (hides.length ? ' (' + hides.map((r) => r.sheet + ' ' + r.selectors.join(',')).join(' | ') + ')' : ''), hides.length === 0);
yes('B5 nothing marks it !important against the reserved box', !hides.length && !/!important/.test(body));

// ------------------------------------------------------ C. its own size --
const own = all.filter((r) => !r.media && r.selectors.indexOf('.hero-motion') >= 0).map((r) => r.body).join(';');
yes('C1 .hero-motion gives it its height (min-height:44px), shown or not', /min-height\s*:\s*44px/.test(own));
const narrow = all.filter((r) => r.media && r.selectors.some((s) => /hero-motion|#bannerMotion/.test(s)));
yes('C2 no narrow-screen rule changes its box after the fact', narrow.every((r) => !/display|height|visibility/.test(r.body)));

// ---------------------------------------------------------- D. home.js --
const end = JS.indexOf("var burger = document.getElementById('burger')");
const banner = JS.slice(0, end < 0 ? JS.length : end);
yes('D1 home.js shows it by clearing hidden', /bannerMotion\.hidden\s*=\s*false/.test(banner));
yes('D2 and touches nothing else of its box', !/bannerMotion\.style\b|bannerMotion\.setAttribute\(\s*'style'/.test(JS));
yes('D3 with no timer in the banner code', !/setTimeout|setInterval|requestAnimationFrame/.test(banner));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
