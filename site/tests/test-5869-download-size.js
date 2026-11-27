'use strict';
// test-5869-download-size.js
//
//     node site/tests/test-5869-download-size.js
//
// #5869. The help and join pages said the installer fetches "about half a
// gigabyte" of Thornswood's own content. Measured on #4538, the build was
// about 290 files and under 100 MB, so the pages said five times what people
// download. The figure was typed into the pages, and nothing ties it to the
// build, so the pages now give no size for that fetch.
//
//   A. No page under site/data says "half a gigabyte".
//   B. On help.md and join.md, the sentence that says what the installer
//      fetches names no size in gigabytes, megabytes, GB or MB.
//
// Read only.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
// A page that is not there fails by name rather than reading as empty text.
function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) { yes(rel + ' is there', false); return ''; }
  return fs.readFileSync(p, 'utf8');
}
function pages(dir) {
  let out = [];
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(function (e) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) out = out.concat(pages(rel));
    else if (/\.md$/i.test(e.name)) out.push(rel);
  });
  return out;
}

// --------------------------------------------------- A. the old figure --
const all = pages('site/data');
yes('site/data has the help and join pages among its pages (' + all.length + ')',
    all.indexOf('site/data/help.md') >= 0 && all.indexOf('site/data/site/join.md') >= 0);
all.forEach(function (rel) {
  const lines = read(rel).split(/\r?\n/);
  const at = [];
  lines.forEach(function (l, i) { if (/half\s+a\s+gigabyte/i.test(l)) at.push(i + 1); });
  yes('A ' + rel + ' does not say half a gigabyte' + (at.length ? ' (line ' + at.join(', ') + ')' : ''),
      at.length === 0);
});

// ------------------------------------------ B. the fetch names no size --
const SIZE = /\b(giga|mega)bytes?\b|\b\d+(\.\d+)?\s*(GB|MB)\b/i;
['site/data/help.md', 'site/data/site/join.md'].forEach(function (rel) {
  // Sentences, with the page's line breaks taken out first.
  const text = read(rel).replace(/\s*\r?\n\s*/g, ' ');
  const said = text.split(/(?<=[.!?])\s+/).filter(function (s) {
    return /fetches Thornswood's own content/.test(s);
  });
  yes('B ' + rel + ' says the installer fetches Thornswood\'s own content', said.length === 1);
  said.forEach(function (s) {
    yes('B ' + rel + ' names no size for it' + (SIZE.test(s) ? ': "' + s + '"' : ''), !SIZE.test(s));
  });
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
