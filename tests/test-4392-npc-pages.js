// test-4392-npc-pages.js
//
// Issue #4392: two pages described the NPC server and disagreed.
// docs/npc-server-runtime.md still described a dev-only loader and an inn
// routine (Hulda in the Bannered Mare) the server no longer runs, and was
// indexed in docs/README.md as current. docs/NPC-SERVER-ACTIVITY.md gave the
// catalogue as 48 plugins, 14,641 placements, 5,072 retained and 9,569
// excluded, while docs/NPC-POPULATION.md, which Build-NpcPopulation.py
// writes, said 106 plugins, 14,668, 4,883 and 9,785.
//
// The activity page's numbers were typed by hand and nothing compared them
// with the generated page, so this holds them together:
//
//   1. docs/npc-server-runtime.md is gone from docs/ and from the index;
//   2. the activity page names the catalogue with the plugin count the
//      generated page was built from, and no other count;
//   3. it gives the generated page's placements, retained and excluded.
//
// Read only.
//
//     node tests/test-4392-npc-pages.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^\uFEFF/, ''); }
  catch (e) { return null; }
}

const index = read('docs/README.md') || '';
const population = read('docs/NPC-POPULATION.md') || '';
const activity = read('docs/NPC-SERVER-ACTIVITY.md') || '';

// ------------------------------------------------------------- the old page
yes('docs/npc-server-runtime.md is retired, not kept beside the current page',
    read('docs/npc-server-runtime.md') === null);
yes('and docs/README.md no longer lists it as current',
    index.indexOf('npc-server-runtime.md') < 0);

// --------------------------------------------------- the generated numbers
const plugins = /in the (\d+)-plugin load order/.exec(population);
const counts = /([\d,]+) placements inspected; ([\d,]+) retained; ([\d,]+) excluded\./.exec(population);
yes('NPC-POPULATION.md says which load order it was built from', !!plugins);
yes('NPC-POPULATION.md says how many placements it inspected, kept and cut', !!counts);

// ----------------------------------------------------- the activity page
if (plugins) {
  const named = [];
  const re = /(\d+)-plugin catalogue/g;
  let m;
  while ((m = re.exec(activity)) !== null) named.push(m[1]);
  yes('NPC-SERVER-ACTIVITY.md names the catalogue as the ' + plugins[1] + '-plugin one',
      named.indexOf(plugins[1]) >= 0, 'it names: ' + (named.join(', ') || 'none'));
  yes('and names no other plugin count for it',
      named.every((n) => n === plugins[1]), 'it names: ' + named.join(', '));
}
if (counts) {
  for (const [what, n] of [['placements', counts[1]], ['retained', counts[2]], ['excluded', counts[3]]]) {
    yes('NPC-SERVER-ACTIVITY.md gives the catalogue\'s ' + n + ' ' + what,
        new RegExp('\\b' + n.replace(/,/g, ',') + '\\b[^.]*').test(activity));
  }
  const sentence = new RegExp(counts[1] + ' placements: ' + counts[2] + ' retained and ' + counts[3] + ' excluded');
  yes('in one sentence, as the generated page has them', sentence.test(activity));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
