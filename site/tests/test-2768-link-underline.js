'use strict';
// test-2768-link-underline.js
//
//     node site\tests\test-2768-link-underline.js
//
// #2768, Patrick's answer on 22 Oct 2026: links in running text are underlined
// across the site, and menus and buttons opt out.
//
// Lighthouse link-in-text-block failed on the front page because the base rule
// in home.css took the underline off every link, and each section that wanted
// one drew a border of its own (.page, .notice, the gallery caption and the
// rest). A section nobody remembered, the three columns and the features on
// the front page, had links told apart by colour alone. This holds the cause
// shut, reading the stylesheets as they ship:
//
//   1. home.css's base rule underlines every link.
//   2. One rule takes the underline off, and it names only menus and buttons.
//   3. No rule draws a border under a link in place of the underline.
//   4. The hub's breadcrumb, a link inside a line of text, keeps its underline.
const fs = require('fs'), path = require('path');
const PUBLIC = path.join(__dirname, '..', '..', 'site', 'public');

let pass = 0, fail = 0;
function yes(what, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + what);
  if (condition) pass++; else fail++;
}

// Every rule in a stylesheet as { selectors, body }, comments taken out. A rule
// inside @media comes out on its own, since only the innermost braces match.
function rules(file) {
  const css = fs.readFileSync(path.join(PUBLIC, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [], re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    out.push({ selectors: m[1].split(',').map(s => s.trim().replace(/\s+/g, ' ')), body: m[2] });
  }
  return out;
}
const offRe = /text-decoration(-line)?\s*:\s*none/;
// A selector that picks out a link: ends on an a, or is one of home.css's link
// classes. Hover and focus states count as the link.
const LINK_CLASSES = ['.mark', '.mobile-cta', '.btn', '.skip', '.enter'];
function picksLink(sel) {
  const last = sel.split(' ').pop().replace(/:[\w-]+(\([^)]*\))?/g, '');
  return /(^|[^\w-])a$/.test(last) || /^a[.#\[]/.test(last) || LINK_CLASSES.some(c => last.split(/(?=\.)/).includes(c));
}

const home = rules('home.css');
const base = home.filter(r => r.selectors.length === 1 && r.selectors[0] === 'a');
yes('home.css has one base rule for a', base.length === 1);
yes('and it underlines every link',
    base.length === 1 && /text-decoration-line\s*:\s*underline/.test(base[0].body) && !offRe.test(base[0].body));

const off = home.filter(r => offRe.test(r.body));
const MENUS_AND_BUTTONS = ['nav.top a', 'footer .cols a', '.mark', '.mobile-cta', '.btn', '.skip'];
yes('one rule in home.css takes the underline off (found ' + off.length + ': ' +
    off.map(r => r.selectors.join(',')).join(' | ') + ')', off.length === 1);
yes('and it names the menus and buttons and nothing else',
    off.length === 1 && off[0].selectors.slice().sort().join(',') === MENUS_AND_BUTTONS.slice().sort().join(','));

// A .btn is a box with a border all round, which is a button and not a stand-in
// for an underline; the rule is about a border drawn under a link alone.
const under = home.filter(r => /border-bottom\s*:/.test(r.body) && r.selectors.some(picksLink));
yes('no rule in home.css draws a border under a link instead of the underline (found: ' +
    under.map(r => r.selectors.join(',')).join(' | ') + ')', under.length === 0);

const hub = rules('hub.css');
const crumb = hub.filter(r => r.selectors.includes('.crumb a'));
yes('the hub breadcrumb link keeps its underline', crumb.length > 0 && crumb.every(r => !offRe.test(r.body)));
yes('the hub base rule does not take the underline off',
    hub.filter(r => r.selectors.length === 1 && r.selectors[0] === 'a').every(r => !offRe.test(r.body)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
