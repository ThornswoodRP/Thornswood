'use strict';
/*
  test-4533-collection-revision-docs.js

      node tests/test-4533-collection-revision-docs.js

  #4533. The docs described a collection revision 3 that adds the Unofficial
  Skyrim Special Edition Patch, a plan dropped on 21 October, and nothing said
  which revision the collection is on or what the published ones changed.
  This holds the docs to records/collection-plugins.json, the record of the
  revision the collection is on:

    C  docs/COLLECTION-REVISIONS.md says the collection is on the record's
       revision, gives every revision from 1 to it, and sends a new one to
       docs/COLLECTION-CHANGES.md
    N  no page under docs/, and no Markdown file at the root, names a
       revision older than the record's as the newest, latest or current one
    U  the revision 3 page and its harness are gone, and no page says the
       collection adds the patch

  Reads only the repository.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const PAGE = path.join(DOCS, 'COLLECTION-REVISIONS.md');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

const record = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'collection-plugins.json'), 'utf8'));
const now = record.revision;

// ---------------------------------------------------------------- C
const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
yes('C1 docs/COLLECTION-REVISIONS.md exists', page.length > 0);
const said = /^The collection is on revision (\d+)\b/m.exec(page);
yes('C2 it says the collection is on revision ' + now + ', as records/collection-plugins.json does' + (said ? ' (it says ' + said[1] + ')' : ''),
    !!said && Number(said[1]) === now);
const heads = [];
page.replace(/^## Revision (\d+)\b/gm, (m, n) => { heads.push(Number(n)); return m; });
const want = [];
for (let n = now; n >= 1; n--) { want.push(n); }
yes('C3 it gives every revision, newest first, from ' + now + ' to 1 (' + heads.join(', ') + ')', JSON.stringify(heads) === JSON.stringify(want));
yes('C4 it sends a new revision to COLLECTION-CHANGES.md', /\(COLLECTION-CHANGES\.md\)/.test(page));
const index = fs.readFileSync(path.join(DOCS, 'README.md'), 'utf8');
yes('C5 the docs index has a row for it', /\| \[COLLECTION-REVISIONS\.md\]\(COLLECTION-REVISIONS\.md\) \|/.test(index));

// ---------------------------------------------------------------- N
function pages(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { pages(p, out); } else if (/\.md$/i.test(e.name)) { out.push(p); }
  }
  return out;
}
const all = pages(DOCS, []).concat(fs.readdirSync(ROOT).filter((n) => /\.md$/i.test(n)).map((n) => path.join(ROOT, n)));
const NEWEST = [
  /\b(?:newest|latest|current)\s+(?:published\s+)?(?:collection\s+)?revision\s+(?:is\s+)?(?:revision\s+)?(\d+)/gi,
  /\brevision\s+(\d+)\b[^.\n]{0,40}?\b(?:is|as)\s+the\s+(?:newest|latest|current)\b/gi,
  /\bcollection is on revision\s+(\d+)/gi,
];
const stale = [];
for (const p of all) {
  const text = fs.readFileSync(p, 'utf8').replace(/\r?\n/g, ' ');
  for (const re of NEWEST) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      if (Number(m[1]) < now) { stale.push(path.relative(ROOT, p) + ': "' + m[0] + '"'); }
    }
  }
}
yes('N1 no page names a revision older than ' + now + ' as the newest' + (stale.length ? ' (' + stale.slice(0, 4).join('; ') + ')' : ''), stale.length === 0);

// ---------------------------------------------------------------- U
yes('U1 docs/COLLECTION-REVISION-3.md, the plan for the patch, is gone', !fs.existsSync(path.join(DOCS, 'COLLECTION-REVISION-3.md')));
yes('U2 and so is its harness, tests/test-collection-revision-3.ps1', !fs.existsSync(path.join(ROOT, 'tests', 'test-collection-revision-3.ps1')));
const excluded = fs.readFileSync(path.join(ROOT, 'tests', 'gate-excluded.txt'), 'utf8');
yes('U3 tests/gate-excluded.txt no longer names it', excluded.indexOf('test-collection-revision-3.ps1') < 0);
const ussep = all.filter((p) => /\bUSSEP\b|adds? the Unofficial Skyrim Special Edition Patch/.test(fs.readFileSync(p, 'utf8'))).map((p) => path.relative(ROOT, p));
yes('U4 no page says the collection adds the patch' + (ussep.length ? ' (' + ussep.join(', ') + ')' : ''), ussep.length === 0);
const linked = all.filter((p) => fs.readFileSync(p, 'utf8').indexOf('COLLECTION-REVISION-3.md') >= 0).map((p) => path.relative(ROOT, p));
yes('U5 no page links the revision 3 page' + (linked.length ? ' (' + linked.join(', ') + ')' : ''), linked.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
