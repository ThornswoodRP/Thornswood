'use strict';
/*
  test-4534-ombo2a-revision.js

      node tests/test-4534-ombo2a-revision.js

  #4534. The collection was ombo2a until 7essxf replaced it, and the swap
  changed the slug wherever it was written down, the dates and counts beside
  it included. So lines written about ombo2a's revisions (its revision 2
  folder of 15 September, its revision 5 of 22 September with 52 full plugins
  in one chain, measured on 24 September) came to read as 7essxf's, which has
  its own revision 5, published 21 October, and is on revision 8 now. A reader
  takes the old dates and counts to be about today's collection.

  This holds every text file in the repository, the history pages included,
  to two things:

    F  no folder name Vortex gave one of ombo2a's revisions is written with
       the 7essxf slug;
    R  a line about revision 5 that gives ombo2a's revision 5 (22 or
       24 September, the 52 full plugins, one chain, "revision 5's chain",
       the plugin order from revision 5) names ombo2a within three lines.

  The history pages name ombo2a where they give its revisions, so they pass
  as they are.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SELF = path.relative(ROOT, __filename).split(path.sep).join('/');

let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'engine', 'bin', 'obj', 'dist']);
const TEXT = /\.(ps1|psm1|psd1|js|mjs|cjs|ts|cs|md|json|py|yml|yaml|txt|axaml|xaml|html|css)$/i;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (e.isFile() && TEXT.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

// ombo2a's folders, as Vortex named them: collection_<slug>_<revision>_<when>.
// The revision 2 one is in scripts/mods/LoadOrder.ps1, the revision 5 one in
// tests/test-collection-newest.ps1, both under ombo2a.
const OMBO_FOLDERS = ['_2_2026-09-15T21-08-00Z', '_5_2026-09-22T22-26-11Z'];
const SWAPPED = OMBO_FOLDERS.map((s) => 'collection_' + '7essxf' + s);

const REV5 = /revision 5/i;
const OMBO_REV5 = [
  /\b2[24] Sep/i,
  /\b52 full\b/i,
  /\bone chain\b/i,
  /revision 5's chain/i,
  /plugin order from revision 5/i
];

const files = walk(ROOT, []);
yes('the repository has text files to read (' + files.length + ')', files.length > 100);

const swapped = [];
const unnamed = [];
for (const full of files) {
  const rel = path.relative(ROOT, full).split(path.sep).join('/');
  if (rel === SELF) continue;
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) { continue; }
  if (text.indexOf('7essxf') < 0 && !REV5.test(text)) continue;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const s of SWAPPED) {
      if (lines[i].indexOf(s) >= 0) swapped.push(rel + ':' + (i + 1) + ' ' + s);
    }
    if (!REV5.test(lines[i])) continue;
    const from = Math.max(0, i - 3), to = Math.min(lines.length, i + 4);
    const near = lines.slice(from, to).join('\n');
    if (/ombo2a/i.test(near)) continue;
    if (OMBO_REV5.some((re) => re.test(near))) unnamed.push(rel + ':' + (i + 1));
  }
}

yes('F no folder of an ombo2a revision is written with the 7essxf slug' +
    (swapped.length ? ' (' + swapped.join(', ') + ')' : ''), swapped.length === 0);
yes('R every line giving ombo2a\'s revision 5 names ombo2a' +
    (unnamed.length ? ' (' + unnamed.join(', ') + ')' : ''), unnamed.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
