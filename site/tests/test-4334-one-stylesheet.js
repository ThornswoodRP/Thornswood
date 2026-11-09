'use strict';
/*
  test-4334-one-stylesheet.js

      node site/tests/test-4334-one-stylesheet.js

  #4334: every page of the site linked two stylesheets in its head, its own
  and fonts.css, which held nothing but the six @font-face rules. A browser
  draws nothing until every stylesheet in the head is in, so each first paint
  waited on two sheets. The faces are in each page's own sheet now (home.css
  for the front and every public page, hub.css for the hub), and fonts.css
  is gone. This reads the pages as they ship:

  A. every page the site sends, site/public/*.html and every page a module
     in site/lib or server.js writes out whole, has at most one stylesheet
     that blocks its first draw: a <link rel="stylesheet"> with no media that
     keeps it from applying, plus any @import inside the sheets it links;
  B. home.css and hub.css each declare the six faces, Cinzel and five
     Spectral, with font-display: swap, and the two declare them the same;
  C. home.html's two font preloads name files home.css declares, so the
     preload is the file the face asks for;
  D. fonts.css is not in public/, and nothing the site sends names it.

  Against main it fails A (home.html and index.html link two each), B and D.
*/
const fs = require('fs');
const path = require('path');

const SITE = path.join(__dirname, '..');
const PUB = path.join(SITE, 'public');
const LIB = path.join(SITE, 'lib');
const read = (p) => { try { return fs.readFileSync(p, 'utf8').split('\r\n').join('\n'); } catch (e) { return null; } };
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the pages --
// Every page the site sends: the files in public/, and each page a module
// writes out whole, from its <!doctype to the next one.
const pages = [];
for (const f of fs.readdirSync(PUB).filter((n) => /\.html$/i.test(n)).sort()) {
  pages.push({ name: 'public/' + f, text: read(path.join(PUB, f)) });
}
const modules = fs.readdirSync(LIB).filter((n) => /\.js$/.test(n)).sort().map((n) => 'lib/' + n).concat(['server.js']);
for (const m of modules) {
  const text = read(path.join(SITE, m)) || '';
  const at = [];
  const re = /<!doctype html/gi;
  let hit;
  while ((hit = re.exec(text))) { at.push(hit.index); }
  at.forEach((start, i) => pages.push({ name: m + ' page ' + (i + 1), text: text.slice(start, i + 1 < at.length ? at[i + 1] : text.length) }));
}
yes('found the pages: ' + pages.map((p) => p.name).join(', '),
    pages.some((p) => p.name === 'public/home.html') && pages.some((p) => p.name === 'public/index.html') &&
    pages.some((p) => /^lib\/passes\.js/.test(p.name)));

// A stylesheet link blocks the first draw unless its media keeps it from
// applying (print, or not all) or it is disabled.
function blocking(html) {
  const noComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const out = [];
  for (const m of noComments.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    if (/\bdisabled\b/i.test(tag)) continue;
    const media = /\bmedia\s*=\s*["']([^"']*)["']/i.exec(tag);
    if (media && /^\s*(print|not all)\s*$/i.test(media[1])) continue;
    const href = (/\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1] || '?';
    out.push(href);
  }
  return out;
}
// What a local sheet pulls in by @import, which blocks as well.
function imports(href) {
  const name = /^\/([A-Za-z0-9._-]+\.css)(?:\?.*)?$/.exec(href);
  const css = name ? read(path.join(PUB, name[1])) : null;
  if (!css) return [];
  return [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)/gi)].map((m) => m[1]);
}
for (const p of pages) {
  const sheets = blocking(p.text);
  const all = sheets.concat(...sheets.map(imports));
  yes('A ' + p.name + ' has at most one stylesheet in the way of its first draw (' + (all.join(', ') || 'none') + ')', all.length <= 1);
}

// ------------------------------------------------------------ the faces --
const FACES = [
  ['Cinzel', 'normal', '400 700', 'cinzel.woff2'],
  ['Spectral', 'normal', '300', 'spectral-300.woff2'],
  ['Spectral', 'normal', '400', 'spectral-400.woff2'],
  ['Spectral', 'normal', '600', 'spectral-600.woff2'],
  ['Spectral', 'italic', '300', 'spectral-300-italic.woff2'],
  ['Spectral', 'italic', '400', 'spectral-400-italic.woff2'],
];
function faces(css) {
  return [...(css || '').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => {
    const v = (k) => ((new RegExp('(?:^|;)\\s*' + k + '\\s*:\\s*([^;]+)').exec(m[1]) || [])[1] || '').trim();
    return { family: v('font-family').replace(/['"]/g, ''), style: v('font-style'), weight: v('font-weight'),
             display: v('font-display'), src: v('src') };
  });
}
const got = {};
for (const sheet of ['home.css', 'hub.css']) {
  const css = read(path.join(PUB, sheet));
  const f = faces(css);
  got[sheet] = JSON.stringify(f);
  yes('B ' + sheet + ' declares six faces (' + f.length + ')', f.length === 6);
  for (const want of FACES) {
    const one = f.find((x) => x.family === want[0] && x.style === want[1] && x.weight === want[2]);
    yes('B ' + sheet + ': ' + want[0] + ' ' + want[1] + ' ' + want[2] + ', from /' + want[3] + ', font-display: swap',
        !!one && one.display === 'swap' && one.src === "url(/" + want[3] + ") format('woff2')");
  }
}
yes('B and the two sheets declare them the same', got['home.css'] === got['hub.css']);

// ------------------------------------------------------------- preloads --
const home = read(path.join(PUB, 'home.html')) || '';
const preloads = [...home.matchAll(/<link rel="preload" href="\/([^"]+)" as="font"[^>]*>/g)].map((m) => m[1]);
yes('C home.html preloads two fonts (' + preloads.join(', ') + ')', preloads.length === 2);
yes('C and each is a face home.css declares', preloads.every((n) => FACES.some((f) => f[3] === n)));

// ------------------------------------------------------------ fonts.css --
yes('D public/fonts.css is gone', !fs.existsSync(path.join(PUB, 'fonts.css')));
const naming = pages.filter((p) => /href\s*=\s*\\?["']?\/fonts\.css/.test(p.text.replace(/<!--[\s\S]*?-->/g, ''))).map((p) => p.name);
yes('D and no page links it' + (naming.length ? ' (' + naming.join(', ') + ')' : ''), naming.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
