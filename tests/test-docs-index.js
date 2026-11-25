// test-docs-index.js
//
// docs/README.md is the index of the pages in docs/. Every page outside
// archive/ must have a row there, so a new page cannot land without being
// findable from the index.
//
// WHY THIS EXISTS. Issue #1103: docs/COLLECTION-REBUILD-7ESSXF.md was in
// docs/ but not in the index, found while adding COLLECTION-REVISION-2.md
// for #476. The index says "Every page cites file and line for what it
// says" and lists every page but that one. Without a harness the next
// page will miss the table the same way.
//
// What it checks:
//   1. docs/README.md exists and has a markdown table;
//   2. every .md file directly under docs/ other than README.md itself
//      appears as a link target in that table (systems/ and archive/ are
//      covered by their own directory rows; nested pages stay under those);
//   3. COLLECTION-REBUILD-7ESSXF.md specifically has a row (#1103);
//   4. every page outside archive/ is reached from docs/README.md by
//      following links, and every page directly under systems/ has a link
//      in docs/GAME-SYSTEMS.md, the index of that folder;
//   5. every other file outside archive/ (a picture, a table) is linked from
//      a page that uses it, here or in Developer-Guide.md;
//   6. no two names in one folder are a letter apart;
//   7. no folder outside archive/ holds a single file.
//
// Issue #2801 added 4 to 7. The rows above stopped at docs/ itself, so
// systems/ pages landed linked from nowhere (seven of them, and five more
// by the time it was fixed), SYSTEM.md sat beside SYSTEMS.md with a
// different job, and docs/guide/ held one picture. Those names are now
// SERVER.md (in the private ops repo since #3693) and GAME-SYSTEMS.md.
//
// Read only.
//
//     node tests/test-docs-index.js
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const INDEX = path.join(DOCS, 'README.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function read(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }
  catch (e) { return null; }
}

const index = read(INDEX);
yes('docs/README.md exists', index !== null);

const targets = new Set();
if (index !== null) {
  const linkRe = /\[([^\]]*)\]\(([^)]+)\)/g;
  let m;
  while ((m = linkRe.exec(index)) !== null) {
    targets.add(m[2].trim().replace(/^\.\//, ''));
  }
}
yes('docs/README.md has at least one markdown link (the index table)', targets.size > 0);

let topPages = [];
try {
  topPages = fs.readdirSync(DOCS).filter(function (name) {
    return /\.md$/i.test(name) && !/^README\.md$/i.test(name);
  }).sort();
} catch (e) {
  yes('docs/ can be listed', false);
}

topPages.forEach(function (name) {
  yes('docs/' + name + ' has a row (or link) in docs/README.md', targets.has(name));
});
yes('COLLECTION-REBUILD-7ESSXF.md is in the index (#1103)', targets.has('COLLECTION-REBUILD-7ESSXF.md'));
yes('docs/README.md has a systems/ row', targets.has('systems/') || targets.has('systems'));
// The archive row went with docs/archive, to the private ops repo (#3693).

// ------------------------------------------------- every file is found (#2801)
// Every file under docs/ outside archive/, as a path from the repository.
function walk(dir, out) {
  fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).forEach(function (e) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (rel !== 'docs/archive') walk(rel, out); }
    else out.push(rel);
  });
  return out;
}
const files = walk('docs', []).sort();

// The repository paths a page links to, without anchors, and only those that
// are files of the repository.
function linksOf(page) {
  const text = read(path.join(ROOT, page)) || '';
  const out = [];
  const re = /\]\(([^)\s]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const target = m[1].replace(/#.*$/, '');
    if (!target || /^[a-z]+:/i.test(target)) continue;
    out.push(path.posix.normalize(path.posix.join(path.posix.dirname(page), decodeURI(target))));
  }
  return out;
}

const reached = new Set();
const todo = ['docs/README.md'];
while (todo.length) {
  const page = todo.pop();
  if (reached.has(page)) continue;
  reached.add(page);
  if (!/\.md$/i.test(page) || !fs.existsSync(path.join(ROOT, page))) continue;
  linksOf(page).forEach(function (t) { if (t.startsWith('docs/') && !t.startsWith('docs/archive/')) todo.push(t); });
}

const used = new Set(linksOf('Developer-Guide.md'));
files.filter(function (f) { return /\.md$/i.test(f); }).forEach(function (f) {
  linksOf(f).forEach(function (t) { used.add(t); });
});

files.forEach(function (f) {
  if (/\.md$/i.test(f)) yes(f + ' is reached from docs/README.md', reached.has(f));
  else yes(f + ' is linked from a page that uses it', reached.has(f) || used.has(f));
});

const systemsIndex = new Set(linksOf('docs/GAME-SYSTEMS.md'));
files.filter(function (f) { return /^docs\/systems\/[^/]+\.md$/i.test(f) && !/\/README\.md$/i.test(f); })
  .forEach(function (f) {
    yes(f + ' has a link in docs/GAME-SYSTEMS.md', systemsIndex.has(f));
  });

// ------------------------------------------------- names a letter apart (#2801)
// One letter added, taken out or changed. A number that differs (COLLECTION-
// REVISION-2 and -3) is a series, not a near miss.
function letterApart(a, b) {
  if (a === b) return false;
  if (a.length === b.length) {
    let diff = -1;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) { if (diff >= 0) return false; diff = i; }
    }
    return /[a-z]/.test(a[diff]) || /[a-z]/.test(b[diff]);
  }
  if (Math.abs(a.length - b.length) !== 1) return false;
  const long = a.length > b.length ? a : b, short = a.length > b.length ? b : a;
  for (let i = 0; i < long.length; i++) {
    if (long.slice(0, i) + long.slice(i + 1) === short) return /[a-z]/.test(long[i]);
  }
  return false;
}
const byFolder = {};
files.forEach(function (f) {
  const dir = path.posix.dirname(f);
  (byFolder[dir] = byFolder[dir] || []).push(path.posix.basename(f).replace(/\.[^.]+$/, '').toLowerCase());
});
Object.keys(byFolder).sort().forEach(function (dir) {
  const names = byFolder[dir];
  const near = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (letterApart(names[i], names[j])) near.push(names[i] + ' and ' + names[j]);
    }
  }
  yes(dir + ' has no two names a letter apart' + (near.length ? ' (' + near.join('; ') + ')' : ''), near.length === 0);
});

// ------------------------------------------------- a folder of one (#2801)
const folders = {};
files.forEach(function (f) {
  let dir = path.posix.dirname(f);
  while (dir !== 'docs' && dir.startsWith('docs/')) {
    folders[dir] = (folders[dir] || 0) + 1;
    dir = path.posix.dirname(dir);
  }
});
Object.keys(folders).sort().forEach(function (dir) {
  yes(dir + ' holds more than one file (' + folders[dir] + ')', folders[dir] > 1);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail > 0 ? 1 : 0;
