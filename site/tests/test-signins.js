// Runs the real sign-in ageing out of site\server.js.
//
// That file opens a port and reads a config when it is required, so the block
// between the two markers is taken out and driven on its own. It is a pure
// function over an array, which is exactly why it was written as one.

const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const SRC = path.join(REPO_DIR, 'site', 'server.js');
const text = siteFiles.source(SRC);
const a = text.indexOf('// ==== thornswood signin ageing ====');
const b = text.indexOf('// ==== end thornswood signin ageing ====');
if (a < 0 || b < 0) {
  console.error('the ageing block markers are not in server.js');
  process.exit(1);
}
eval(text.slice(a, b));

let pass = 0, fail = 0;
function check(what, got, want) {
  if (String(got) === String(want)) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + '\n      wanted [' + want + '] got [' + got + ']'); }
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

// Six hundred rows spread over a year, newest first the way the file is
// written. One a day for 600 days would be longer than a year, so they are
// spread across 365 days, which puts several in the same day and is what a
// real week of testing looks like anyway.
const rows = [];
for (let i = 0; i < 600; i++) {
  rows.push({ at: NOW - Math.round((i / 600) * 365 * DAY), id: 'u' + i, handle: 'h' + i, ip: '10.0.0.' + (i % 255) });
}

const kept = freshSignIns(rows, NOW);

// Inside thirty days, by the same sum the rows were built with: 600 rows over
// 365 days is 30/365 of them.
const want = rows.filter((r) => r.at >= NOW - 30 * DAY).length;
check('a year of rows comes back as thirty days of them', kept.length, want);
check('and that is fewer than the cap, so time did the work', kept.length < 500, 'true');
check('the newest row survives', kept[0].id, 'u0');
check('nothing older than thirty days is left',
      kept.filter((r) => r.at < NOW - 30 * DAY).length, 0);
check('and no row inside the window was dropped',
      kept.length === want && kept.every((r) => r.at >= NOW - 30 * DAY), 'true');

// The cap still applies. Six hundred rows all from this morning are 600 rows
// inside the window, and the file may not hold 600.
const busy = [];
for (let i = 0; i < 600; i++) { busy.push({ at: NOW - i * 1000, id: 'b' + i }); }
const capped = freshSignIns(busy, NOW);
check('a busy day is still capped at 500', capped.length, 500);
check('and it is the newest 500 that are kept', capped[0].id, 'b0');
check('the oldest of the kept is the 500th', capped[499].id, 'b499');

// The edges.
check('a row exactly on the line is kept',
      freshSignIns([{ at: NOW - 30 * DAY, id: 'edge' }], NOW).length, 1);
check('a row one millisecond past it is not',
      freshSignIns([{ at: NOW - 30 * DAY - 1, id: 'old' }], NOW).length, 0);

// Rubbish in the file is not a reason to throw away the record of somebody
// being refused at the door, and it is not a reason to crash either.
check('a row with no time is kept', freshSignIns([{ id: 'notime' }], NOW).length, 1);
check('a row with a nonsense time is kept', freshSignIns([{ at: 'yesterday' }], NOW).length, 1);
check('null rows are dropped', freshSignIns([null, { at: NOW }, undefined], NOW).length, 1);
check('a string in the array is dropped', freshSignIns(['what', { at: NOW }], NOW).length, 1);
check('not an array at all reads as empty', freshSignIns(null, NOW).length, 0);
check('and so does a string', freshSignIns('rows', NOW).length, 0);

// No clock passed in means now, which is what every caller does.
check('no clock given still ages', freshSignIns([{ at: Date.now() - 400 * DAY }]).length, 0);
check('and keeps what is current', freshSignIns([{ at: Date.now() }]).length, 1);

// It does not chew the caller's array up.
const before = [{ at: NOW - 400 * DAY }, { at: NOW }];
freshSignIns(before, NOW);
check('the array handed in is left alone', before.length, 2);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
