'use strict';
// test-3138-one-copy.js
//
// #3138, the website refresh. Every public page was out of date for two
// reasons, and this holds both shut.
//
// One: four texts lived in two copies that were edited apart. The link
// blurbs were in server.js and again in home.js; the Accord and the history
// were in site\data\site\world.md and again in lore\; the cookie list was on
// /cookies and again at the foot of /privacy. Each now has one copy, and the
// others point at it.
//
// Two: the pages said what was built yet. Every merge left a "not yet" or a
// "being built" behind, while the roadmap and Known Issues, which are built
// from the board, already say what is coming and what is broken. The public
// pages now say how the world works, and nothing about when.
//
// It also holds #2763: every cookie the site sets and every key it keeps in
// the browser is named on /cookies. No server and no VPS: this reads files.

const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); }
  catch (e) { return null; }
}

// ------------------------------------------------------------ one copy --
const server = siteFiles.source() || '';
const home = read('site/public/home.js') || '';
yes('server.js has the list of page blurbs', /const BLURB\s*=/.test(server));
yes('home.js keeps no second list of them',
    !/BLURB\s*=/.test(home) && !/'\/(?:join|known|world)':\s*\[/.test(home));

const world = read('site/data/site/world.md') || '';
yes('world.md has all nine articles of the Accord',
    (world.match(/^## Article the /gm) || []).length === 9);
['lore/accord.md', 'lore/history.md'].forEach(function (rel) {
  const t = read(rel);
  yes(rel + ' is there', t !== null);
  yes(rel + ' points at world.md', /site\\data\\site\\world\.md/.test(t || ''));
  yes(rel + ' carries no article of its own', !/^## Article the /m.test(t || ''));
  yes(rel + ' is a pointer, not a copy', (t || '').split('\n').length < 30);
});

const privacy = read('site/data/site/privacy.md') || '';
yes('privacy points at the cookie page', /\]\(\/cookies\)/.test(privacy));
yes('privacy keeps no cookie table of its own', !/^\|\s*`?twa`?\s*\|/m.test(privacy));

// ------------------------------------------------ no build status -------
/* The roadmap and Known Issues say when. A public page that says it is
   only true until the next merge. */
const STATUS = /being built|not yet|coming soon|for now|will be added|is coming|still to come|in a later|work in progress|not built|is planned|are planned/i;
const dir = path.join(ROOT, 'site', 'data', 'site');
const pages = fs.readdirSync(dir).filter(function (f) { return /\.md$/.test(f); })
  .map(function (f) { return 'site/data/site/' + f; }).concat(['site/data/help.md']);
pages.forEach(function (rel) {
  const t = (read(rel) || '').replace(/<!--[\s\S]*?-->/g, '');
  const hits = t.split('\n').map(function (l, i) { return { n: i + 1, l: l }; })
    .filter(function (x) { return STATUS.test(x.l); });
  if (hits.length) console.log('      ' + rel + ': ' + hits.map(function (x) { return x.n + ' ' + x.l.trim(); }).join(' | '));
  yes(rel + ' says how the world works, not what is built yet', hits.length === 0);
});
{
  const t = (read('site/public/home.html') || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ');
  yes('the home page says nothing about what is built yet', !STATUS.test(t));
}

// ------------------------------------------ each footer link once --------
/* Patrick, 26 Oct: "the links at the bottom of the page are sometumes in
   more than opne category and thats just not nessacery". The live footer had
   Roadmap under The World and Community, Release notes under Community and
   Behind it, and Download twice under Playing. Each link has one column. */
{
  const html = read('site/public/home.html') || '';
  const foot = (html.match(/<footer[\s\S]*?<\/footer>/) || [''])[0];
  const cols = foot.split(/<h2>/).slice(1);
  const seen = {};
  const twice = [];
  cols.forEach(function (c) {
    (c.match(/href="([^"]+)"/g) || []).forEach(function (h) {
      const url = h.slice(6, -1);
      if (seen[url]) twice.push(url);
      seen[url] = true;
    });
  });
  if (twice.length) console.log('      in the footer more than once: ' + twice.join(', '));
  yes('the footer has its four columns', cols.length === 4);
  yes('each footer link is in one column, once', twice.length === 0 && Object.keys(seen).length > 0);
}

// ------------------------------------- the words under the painting ------
/* Patrick, 26 Oct: "the text be covering the logo some". On a wide screen the
   words sat over the painting's foot and covered the painted title's thorns
   and crest. The painting is a band of its own at every width now, kept to
   its top, and the words follow it (home.css, the hero). */
{
  const css = read('site/public/home.css') || '';
  const rule = function (sel) {
    const i = css.indexOf(sel + '{');
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  };
  const paint = rule('.hero > .paint');
  yes('the painting is a band in the page, not a layer under the words',
      /position:relative/.test(paint) && !/position:absolute|inset:0/.test(paint));
  yes('the band is the whole 16:9 picture when it fits, and never under 27vw, so the title is in it',
      /height:min\(56\.25vw,max\([0-9.]+vh,27vw\)\)/.test(paint));
  yes('the picture is kept to its top, where the title is painted',
      /object-position:50% 0\b/.test(rule('.hero .art')));
  yes('no wide-screen rule lays the words over the painting again',
      !/\.hero\{[^}]*align-items:end/.test(css) && css.indexOf('.hero .wrap::before{') < 0);
}

// ----------------------------------------- every cookie is named, #2763 --
const cookies = read('site/data/site/cookies.md') || '';
function named(name) { return cookies.indexOf('`' + name + '`') >= 0; }
const set = [];
[/const (?:COOKIE|ADMIN|ATTEMPT)\s*=\s*'([^']+)'/g].forEach(function (re) {
  let m; while ((m = re.exec(server))) set.push(m[1]);
});
yes('server.js names the three sign-in cookies', set.length === 3);
set.forEach(function (n) {
  const shown = /_$/.test(n) ? n + '*' : n;
  yes('/cookies names the ' + shown + ' cookie', named(shown));
});

const pub = fs.readdirSync(path.join(ROOT, 'site', 'public'))
  .filter(function (f) { return /\.js$/.test(f) && !/\.min\.js$/.test(f); });
const keys = [];
pub.forEach(function (f) {
  const src = read('site/public/' + f) || '';
  let m;
  const cookieRe = /document\.cookie\s*=\s*'([^'=]+)=/g;
  while ((m = cookieRe.exec(src))) keys.push({ f: f, k: m[1], what: 'cookie' });
  const consts = {};
  const c = /var ([A-Z_]+)\s*=\s*'([^']+)'/g;
  while ((m = c.exec(src))) consts[m[1]] = m[2];
  const store = /(?:localStorage|sessionStorage)\.setItem\(\s*('([^']*)'(?:\s*\+\s*(\w+))?|([A-Z_]+))/g;
  while ((m = store.exec(src))) {
    if (m[4]) keys.push({ f: f, k: consts[m[4]] || m[4], what: 'storage key' });
    else if (m[3]) {
      /* A prefix and a name: hub.js keeps remember(k) under 'tw:' + k. Each
         name it is called with is a key of its own. */
      const prefix = m[2];
      const call = /remember\('([^']+)',/g;
      let n; let any = false;
      while ((n = call.exec(src))) { any = true; keys.push({ f: f, k: prefix + n[1], what: 'storage key' }); }
      if (!any) keys.push({ f: f, k: prefix + '*', what: 'storage key' });
    } else keys.push({ f: f, k: m[2], what: 'storage key' });
  }
});
yes('the site\'s scripts keep something in the browser', keys.length > 0);
const seen = {};
keys.forEach(function (x) {
  const id = x.what + ' ' + x.k;
  if (seen[id]) return;
  seen[id] = true;
  yes('/cookies names the ' + x.k + ' ' + x.what + ' (' + x.f + ')', named(x.k));
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
