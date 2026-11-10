'use strict';
/*
  test-4377-records-readme.js

      node tests/test-4377-records-readme.js

  #4377. records/README.md says what each record is, and it had fallen
  behind the folder: records the releases and the build read were named
  nowhere, the four client provenance notes were named by names no file has,
  JSON records sat under the provenance notes heading, a path held a tab,
  its closing rule said every record is changed by running the script that
  writes it while its own entries say no script writes theirs, and it said
  a provenance note backs the current engine pin when none names that commit.

    N  every file and folder in records/ is named in the readme
    E  every record a list entry names is in records/
    P  nothing under "Provenance notes" is a JSON record
    C  the readme holds no control character but the line ends
    R  the closing rule does not contradict an entry that no script writes
    K  the readme claims a note behind the current pin only when one names it

  Reads only the repository.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'records');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
const some = (l) => l.length ? ' (' + l.slice(0, 6).join(', ') + (l.length > 6 ? ' and ' + (l.length - 6) + ' more' : '') + ')' : '';

const raw = fs.readFileSync(path.join(DIR, 'README.md'), 'utf8');
const text = raw.replace(/\r\n/g, '\n');
const entries = fs.readdirSync(DIR).filter((n) => n !== 'README.md');
const ticked = new Set();
text.replace(/`([^`\n]+)`/g, (m, v) => { ticked.add(v.replace(/[\\/]$/, '')); return m; });

// ---------------------------------------------------------------- N
const unnamed = entries.filter((n) => !ticked.has(n));
yes('N1 every file and folder in records/ is named in its readme (' + entries.length + ')' + some(unnamed), unnamed.length === 0);

// ---------------------------------------------------------------- E
const listed = [];
text.split('\n').forEach((l) => {
  const m = /^- (.*)$/.exec(l);
  if (!m) { return; }
  const lead = m[1].split(':')[0];
  lead.replace(/`([^`]+)`/g, (x, v) => { listed.push(v.replace(/[\\/]$/, '')); return x; });
});
const gone = listed.filter((n) => !/[\\/ ]/.test(n) && !fs.existsSync(path.join(DIR, n)));
yes('E1 every record a list entry names is in records/ (' + listed.length + ')' + some(gone), listed.length > 0 && gone.length === 0);

// ---------------------------------------------------------------- P
const at = text.indexOf('\n## Provenance notes');
const next = at < 0 ? -1 : text.indexOf('\n## ', at + 1);
const notes = at < 0 ? '' : text.slice(at, next < 0 ? text.length : next);
const jsonInNotes = [];
notes.split('\n').forEach((l) => {
  const m = /^- `([^`]+\.json)`/.exec(l);
  if (m) { jsonInNotes.push(m[1]); }
});
yes('P1 nothing filed under Provenance notes is a JSON record' + some(jsonInNotes), at >= 0 && jsonInNotes.length === 0);

// ---------------------------------------------------------------- C
const control = [];
raw.split('\n').forEach((l, i) => {
  const s = l.replace(/\r$/, '');
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c < 32 || c === 127) { control.push('line ' + (i + 1) + ' column ' + (k + 1) + ' (0x' + c.toString(16) + ')'); }
  }
});
yes('C1 the readme holds no control character but the line ends' + some(control), control.length === 0);

// ---------------------------------------------------------------- R
const byHand = (text.match(/No script writes (this one|it)/g) || []).length;
const strict = /Change a record only by running the script that writes it/.test(text);
yes('R1 the closing rule does not say every record is written by a script while ' + byHand + ' entries say none writes theirs',
    !(strict && byHand > 0));

// ---------------------------------------------------------------- K
const pin = (JSON.parse(fs.readFileSync(path.join(DIR, 'client-build.json'), 'utf8')).forkCommit || '').slice(0, 8);
const noteFiles = entries.filter((n) => /\.md$/.test(n));
const behind = noteFiles.filter((n) => fs.readFileSync(path.join(DIR, n), 'utf8').indexOf(pin) >= 0);
const claims = /point at the one behind the current pin/.test(text.replace(/\s+/g, ' '));
yes('K1 the readme says a note backs the current pin ' + pin + ' only when one names it (' + behind.length + ' do)',
    pin.length === 8 && (!claims || behind.length > 0));
yes('K2 and when none does, it says so', behind.length > 0 || /no provenance note/i.test(notes));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
