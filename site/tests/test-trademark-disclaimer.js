'use strict';
// test-trademark-disclaimer.js
//
// The Bethesda disclaimer stays where it is, word for word, and nothing we
// publish puts a trademark mark or a registration claim on a name that is not
// registered. Entry 319 on the To Do List.
//
// WHY THIS EXISTS. Entry 319 was "the README still names the old multiplayer
// mod, and Thornswood is unregistered". The README half is done on main by entry 193
// (#265, 7b5c73f), which rewrote README.md from scratch, and
// test-repo-docs.js holds it there: the title, the old name, the em dashes and
// the word the project never uses for people. Measured on main at 8d4fbdb on
// 24 September: README.md line 1 is # Thornswood, it never names the old
// mod, it has no em dash, and the Bethesda search returns credits.md:12,
// credits.md:13 and home.html:681.
//
// Nothing checked the other half of the entry. The disclaimer is, in the
// entry's words, "the one legally useful sentence on the site", and the entry
// says to leave it as written: the Bethesda search over credits.md and
// home.html returns three lines, two in one and one in the other. It also
// says to "add no trademark symbol or registration claim, because the name is
// unregistered and saying otherwise would be a false statement". So this
// fails if somebody tidying the site or the README tidies the disclaimer
// away, and if a mark or a registration claim turns up on README.md or on a
// public page.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const ROOT = REPO_DIR;
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }
  catch (e) { return null; }
}
// Select-String matches line by line, the form the entry's own checks take.
function lines(t, re) {
  return (t || '').split('\n').map(function (l, i) { return { n: i + 1, l: l }; })
    .filter(function (x) { return re.test(x.l); });
}
function at(hits) {
  return hits.map(function (x) { return x.n; }).join(', ');
}

// --------------------------------------------------- the disclaimer stays --
const credits = read('site/data/site/credits.md');
const home = read('site/public/home.html');
yes('credits.md and home.html are both there', credits !== null && home !== null);
const bc = lines(credits, /bethesda/i);
const bh = lines(home, /bethesda/i);
yes('the Bethesda search returns three lines, two in credits.md (' + at(bc) + ') and one in home.html (' +
    at(bh) + ')', bc.length === 2 && bh.length === 1);
function flat(x) { return (x || '').replace(/<br>/g, ' ').replace(/\s+/g, ' '); }
const line = 'not affiliated with or endorsed by Bethesda Softworks. The Elder Scrolls and Skyrim are their trademarks';
yes('credits.md still carries the disclaimer word for word', flat(credits).indexOf(line) >= 0);
yes('and so does the foot of home.html', flat(home).indexOf(line) >= 0);

// ---------------------------------------------------------- no false mark --
// The trade mark and registered signs, their HTML entities, a (TM) or (R)
// typed out, or the words. Case matters for the typed ones, because the
// scripts in home.html are full of function (r).
const MARK = /™|®|&trade;|&reg;|&#8482;|&#174;|\((TM|R)\)|[Rr]egistered [Tt]rademark/;
const pages = ['README.md', 'site/public/home.html'];
let site = [];
try {
  site = fs.readdirSync(path.join(ROOT, 'site/data/site'))
    .filter(function (f) { return /\.md$/.test(f); }).sort();
} catch (e) { site = []; }
yes('the public pages in data/site can be listed (' + site.length + ')', site.length > 0);
site.forEach(function (f) { pages.push('site/data/site/' + f); });
pages.forEach(function (rel) {
  const t = read(rel);
  if (t === null) { yes(rel + ' is there', false); return; }
  const m = lines(t, MARK);
  yes(rel + ' puts no trademark mark or registration claim on anything' + (m.length ? ' (line ' + at(m) + ')' : ''),
      m.length === 0);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
