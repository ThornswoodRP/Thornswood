'use strict';
/*
  test-4596-runtime-revision.js

      node tests/test-4596-runtime-revision.js

  #4596. THIRD-PARTY.md's Client Runtime section said revision 4 of the
  collection carries version 1.0.1, and that 1.0.1 is "the version revisions 3
  and 4 install", after revisions 5 to 8 were published. Neither sentence calls
  revision 4 the newest, so test-4533's check of stale "newest revision" words
  did not see them, and nothing held the section to records/collection.json.
  This does:

    R1  the section names the Client Runtime file the record pins
    R2  it says the record's revision is the newest published one carrying it
    R3  no sentence in it says an older revision carries or installs 1.0.1 as
        if it were the last
    R4  it still names the shader compiler's Windows SDK terms

  Reads only the repository.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

const record = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'collection.json'), 'utf8'));
const now = record.revision;
const runtime = (record.mods || []).filter((m) => m.name === 'Thornswood Client Runtime');
yes('R0 the record lists the Client Runtime once', runtime.length === 1);
const fileId = runtime.length === 1 ? String(runtime[0].fileId) : '';

const text = fs.readFileSync(path.join(ROOT, 'THIRD-PARTY.md'), 'utf8').replace(/\r\n/g, '\n');
const start = text.indexOf('\n## Thornswood Client Runtime');
const older = text.indexOf('\n### Version 1.0.0', start);
yes('R0 THIRD-PARTY.md has the Client Runtime section and its 1.0.0 part', start >= 0 && older > start);
const section = start >= 0 && older > start ? text.slice(start, older) : '';
const flat = section.replace(/\s+/g, ' ');

yes('R1 it names file ' + fileId + ', the one records/collection.json pins', fileId !== '' && new RegExp('\\bfile ' + fileId + '\\b').test(flat));

const said = /\bRevision (\d+), the newest published revision\b/.exec(flat);
yes('R2 it says revision ' + now + ' is the newest published revision' + (said ? ' (it says ' + said[1] + ')' : ' (it names none)'),
    !!said && Number(said[1]) === now);

const stale = [];
const carries = /\bRevision (\d+) of the collection\b[^.]*\bcarries version 1\.0\.1/g;
let m;
while ((m = carries.exec(flat))) { if (Number(m[1]) < now) { stale.push(m[0]); } }
const installs = /\bthe version revisions? ([0-9][0-9, ]*(?:(?:and|to) [0-9]+)?) install\b/g;
while ((m = installs.exec(flat))) {
  const nums = (m[1].match(/\d+/g) || []).map(Number);
  if (Math.max.apply(null, nums) < now) { stale.push(m[0]); }
}
yes('R3 no sentence says 1.0.1 is carried or installed only up to a revision older than ' + now + (stale.length ? ' (' + stale.join('; ') + ')' : ''),
    stale.length === 0);

yes('R4 it names the Windows SDK terms for d3dcompiler_47.dll',
    /d3dcompiler_47\.dll/.test(flat) && /Windows SDK's terms for Distributable Code/.test(flat) && /sdk_license\.rtf/.test(flat));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
