// test-1397-npc-docs-live.js
//
//     node tests/test-1397-npc-docs-live.js
//
// Issue #1397: the population cut (catalogue, habitat limits, difficulty
// tiers) is in release 1.2.3 on dev and main, but docs/systems/npcs.md and
// docs/NPC-POPULATION.md still said it was waiting for a future dev release.
// This keeps both pages, and the generator that writes NPC-POPULATION.md,
// from going back to calling the live cut unreleased.
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let fail = 0;
function check(ok, msg) { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fail++; }

const stale = [
  /not described as shipped until a complete dev release/i,
  /prepared for the next dev release/i,
];
for (const file of ['docs/systems/npcs.md', 'docs/NPC-POPULATION.md', 'scripts/dev/Build-NpcPopulation.py']) {
  const text = read(file);
  for (const re of stale) check(!re.test(text), `${file} does not say ${re.source}`);
}
const npcs = read('docs/systems/npcs.md').replace(/\s+/g, ' ');
check(/population catalogue, habitat limits and difficulty tiers are live/i.test(npcs),
  'npcs.md says the population catalogue, habitat limits and difficulty tiers are live');
const pop = read('docs/NPC-POPULATION.md');
const gen = read('scripts/dev/Build-NpcPopulation.py');
const line = pop.split(/\r?\n/)[3];
check(Boolean(line) && gen.includes(line), 'NPC-POPULATION.md line 4 matches the generator');
process.exitCode = fail ? 1 : 0;
