'use strict';
/*
  test-4489-built-by.js

      node tests/test-4489-built-by.js

  Issue #4489. A data table says which script built it ("builtBy"), so the
  next person can build it again. Nothing checked that the name was a script
  that exists: the food table said "scriptsdevBuild-FoodTable.js", because its
  builder wrote 'scripts\dev\...' in a JavaScript string, where \d is d, and
  the mine buildings table named tools/Measure-MineBuildings.py after the
  script had moved to scripts/dev. Both were put right by hand (#6629, #6667).

  This holds every one of them to a file in the repository:
    A  every tracked JSON file with a builtBy names a file that is tracked
       (its first word: some add the switch they were run with);
    B  every builtBy a script writes, read the way its own language reads
       the text (JavaScript and Python strings take a backslash as an escape,
       a PowerShell single-quoted string does not, a JSON line in one is
       JSON), names a file that is tracked.

  Read only.
*/
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0').filter(Boolean);
const have = new Set(tracked);
const names = (v) => String(v).trim().split(/\s+/)[0].replace(/\\/g, '/');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ------------------------------------------------------------------ A --
console.log('A. the tables:');
let tables = 0;
for (const rel of tracked.filter((f) => /\.json$/i.test(f))) {
  const text = read(rel);
  if (text.indexOf('"builtBy"') < 0) continue;
  let doc = null;
  try { doc = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { continue; }
  if (!doc || typeof doc !== 'object' || typeof doc.builtBy !== 'string') continue;
  tables++;
  const by = names(doc.builtBy);
  yes(rel + ' was built by ' + by + ', which is here', have.has(by));
}
yes('the tables were found (' + tables + ')', tables >= 5);

// ------------------------------------------------------------------ B --
console.log('\nB. the builders:');
const unescape = (s) => s.replace(/\\(.)/g, '$1');
const ways = {
  '.js': [[/builtBy\s*:\s*'((?:[^'\\\n]|\\.)*)'/g, unescape], [/builtBy\s*:\s*"((?:[^"\\\n]|\\.)*)"/g, unescape]],
  '.py': [[/['"]builtBy['"]\s*:\s*'((?:[^'\\\n]|\\.)*)'/g, unescape], [/['"]builtBy['"]\s*:\s*"((?:[^"\\\n]|\\.)*)"/g, unescape]],
  '.ps1': [
    [/\bbuiltBy\s*=\s*'([^'\n]*)'/g, (s) => s],
    [/"builtBy":\s*'\s*\+\s*\(JsonStr\s+'([^'\n]*)'\)/g, (s) => s],
    [/"builtBy":\s*"((?:[^"\\\n]|\\.)*)"/g, (s) => JSON.parse('"' + s + '"')]
  ]
};
let builders = 0;
for (const rel of tracked) {
  const ext = path.extname(rel).toLowerCase();
  if (!ways[ext] || /(^|\/)tests?\//.test(rel)) continue;
  const text = read(rel);
  if (text.indexOf('builtBy') < 0) continue;
  for (const [rx, decode] of ways[ext]) {
    rx.lastIndex = 0;
    let m;
    while ((m = rx.exec(text))) {
      builders++;
      const line = text.slice(0, m.index).split('\n').length;
      const by = names(decode(m[1]));
      yes(rel + ':' + line + ' writes ' + by + ', which is here', have.has(by));
    }
  }
}
yes('the builders were found (' + builders + ')', builders >= 30);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
