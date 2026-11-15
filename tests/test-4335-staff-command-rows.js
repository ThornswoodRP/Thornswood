'use strict';
/*
  test-4335-staff-command-rows.js

      node tests/test-4335-staff-command-rows.js

  #4335. docs/systems/commands.md is every command there is; the Developer
  Guide's Staff commands page is how staff run theirs. Every command the
  commands page lets staff run (its Staff and dev table, and any row of the
  commands for people whose Who names staff) needs a row on the guide page,
  and the guide's /spawn rows say a spawn is temporary unless the line ends
  in keep. Read only.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');
const page = read('docs/systems/commands.md');
const guide = read('docs/guide/staff-commands.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function section(text, title) {
  const at = text.indexOf('\n## ' + title + '\n');
  if (at < 0) { return ''; }
  const next = text.indexOf('\n## ', at + 4);
  return text.slice(at, next < 0 ? text.length : next);
}
function rows(text) {
  return text.split('\n').filter((l) => /^\| `/.test(l))
    .map((l) => l.replace(/^\| /, '').replace(/ \|$/, '').split(' | '));
}
function words(cell) {
  const out = [];
  const re = /`(\/[a-z-]+)/g;
  let m;
  while ((m = re.exec(cell))) { out.push(m[1]); }
  return out;
}

const staffTable = rows(section(page, 'Staff and dev commands'));
const peopleTable = rows(section(page, 'Commands for people'));
yes('the commands page has its Staff and dev table (' + staffTable.length + ' rows)', staffTable.length > 5);
yes('and its Commands for people table (' + peopleTable.length + ' rows)', peopleTable.length > 5);

const wanted = new Set();
for (const r of staffTable) {
  if (/^Nobody/.test(r[1] || '')) { continue; }
  words(r[0]).forEach((w) => wanted.add(w));
}
for (const r of peopleTable) {
  if (/\bstaff\b/i.test(r[1] || '')) { words(r[0]).forEach((w) => wanted.add(w)); }
}
yes('the commands page lets staff run /despawn, /evict and /rent',
  wanted.has('/despawn') && wanted.has('/evict') && wanted.has('/rent'));

const guideRows = rows(guide);
const have = new Set();
guideRows.forEach((r) => words(r[0]).forEach((w) => have.add(w)));
for (const w of Array.from(wanted).sort()) {
  yes('the guide has a row for ' + w, have.has(w));
}

const spawnRows = guideRows.filter((r) => /`\/spawn /.test(r[0]));
yes('the guide has the /spawn rows for yourself and at somebody (' + spawnRows.length + ')', spawnRows.length >= 2);
yes('every /spawn row takes keep', spawnRows.length >= 2 && spawnRows.every((r) => /\[keep\]/.test(r[0])));
yes('the guide says a spawn is temporary unless the line ends in keep',
  /temporary unless the line ends in `keep`/.test(guide));
const evictRow = guideRows.find((r) => /`\/evict/.test(r[0])) || [];
yes('the guide\'s /evict row says staff may use it at any building', /any building/.test(evictRow.join(' ')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
