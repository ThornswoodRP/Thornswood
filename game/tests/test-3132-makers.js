// test-3132-makers.js
//
// Everything the world hands out, and everything an open-book recipe asks
// for, has somebody who makes or gathers it, or waits on a named issue.
//
// WHY. Issue #3132. Patrick, 22 Oct 2026: everything in the world has a recipe
// except named uniques and quest items. Nothing held the loot table to that,
// so it grew 102 items nobody could make, and two of its rows named a second
// record of a common item (an orichalcum ingot and a petty soul gem) that no
// bench takes and no producer gives. scripts/dev/Check-Makers.js measures it
// from game/data/item-sources.json, the one table of where every item comes
// from (#3145). This runs it on the repository, then plants
// each break in a copy and proves the check refuses it.
//
// Read only: the plants go in a folder under the system's temp folder.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const check = require(path.join(REPO_DIR, 'scripts', 'dev', 'Check-Makers.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// ------------------------------------------------------- the repository --

const real = check.run(REPO_DIR, false);
for (const p of real.problems) console.log('      ' + p);
yes('the repository passes Check-Makers (' + real.rows.length + ' items)', real.problems.length === 0);
yes('the check reads the loot, the clothes, the tools and the recipe inputs, out of item-sources.json',
  ['Dungeon and body loot', 'Dungeon exclusive', 'A new character\'s clothes', 'A class pick\'s tool', 'Asked for by a recipe']
    .every(by => real.rows.some(r => r.by.indexOf(by) >= 0)));
const byDesc = new Map(real.rows.map(r => [r.desc.toLowerCase(), r]));
yes('the dungeon\'s orichalcum ingot is the one the smelter makes (5ad99)',
  byDesc.has('5ad99:skyrim.esm') && !byDesc.has('43e27:skyrim.esm'));
yes('the dungeon\'s petty soul gem is the one the geode gives (2e4e2)',
  byDesc.has('2e4e2:skyrim.esm') && !byDesc.has('1fe9b:skyrim.esm'));
const code = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'dev', 'Check-Makers.js'), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
yes('Check-Makers takes its sources from item-sources.json alone, reading no loot, class or kit table again (#3145)',
  /item-sources\.json/.test(code) && !/gamemode\.js|harvests\.json|hunts\.json|ores\.json|chargen\.json|merchant-scarce/.test(code));
yes('every waiting entry names an issue',
  real.rows.filter(r => r.waiting).every(r => /^#\d+$/.test(r.waiting.issue)));

// ------------------------------------------------------------ the plants --

// Check-Makers reads game/data/item-sources.json, so a copy carries what
// scripts/dev/Build-ItemSources.js reads, and a plant in the gamemode writes
// the table again in the copy before the check runs (#3145).
const SOURCES = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'item-sources.json'), 'utf8'));
const FILES = SOURCES.readFrom.concat([
  'game/data/item-sources.json',
  'scripts/dev/Check-Makers.waiting.json', 'docs/systems/lists/who-makes-it.md'
]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-3132-'));
function copy() {
  const root = fs.mkdtempSync(path.join(tmp, 'r-'));
  for (const f of FILES) {
    fs.mkdirSync(path.join(root, path.dirname(f)), { recursive: true });
    fs.copyFileSync(path.join(REPO_DIR, f), path.join(root, f));
  }
  return root;
}
function edit(root, f, fn) {
  const p = path.join(root, f);
  fs.writeFileSync(p, fn(fs.readFileSync(p, 'utf8')), 'utf8');
}
function plantLoot(root, row) {
  edit(root, 'game/gamemode.js', s => s.replace(/  var GOODS = \[\r?\n/, m => m + '    ' + row + '\n'));
  const built = spawnSync(process.execPath, [path.join(REPO_DIR, 'scripts', 'dev', 'Build-ItemSources.js'), '--root', root], { encoding: 'utf8' });
  if (built.status !== 0) console.log('      ' + built.stderr.trim());
}
function waiting(root, fn) {
  edit(root, 'scripts/dev/Check-Makers.waiting.json', s => JSON.stringify(fn(JSON.parse(s)), null, 2) + '\n');
}
function refused(what, root, words) {
  const r = check.run(root, false);
  const hit = r.problems.some(p => p.indexOf(words) >= 0);
  if (!hit) for (const p of r.problems) console.log('      ' + p);
  yes(what, hit);
}

try {
  let root = copy();
  yes('an untouched copy passes', check.run(root, false).problems.length === 0);

  root = copy();
  plantLoot(root, "{ desc: '7a:Skyrim.esm', name: 'planted thing', plural: 'planted things', count: 1, weight: 1, tier: 1 },");
  refused('a loot row nobody makes is refused', root, 'has nobody who makes or gathers it');

  root = copy();
  plantLoot(root, "{ desc: '43e27:Skyrim.esm', name: 'orichalcum ingot', plural: 'orichalcum ingots', count: 1, weight: 1, tier: 4 },");
  refused('a loot row naming a second record of a made item is refused, with the right record', root, '5ad99:Skyrim.esm');

  root = copy();
  waiting(root, w => { w.items.push({ desc: '5ace4:Skyrim.esm', name: 'Iron Ingot', issue: '#1', why: 'planted' }); return w; });
  refused('a waiting entry for something that has a maker is refused', root, 'makes it now');

  root = copy();
  waiting(root, w => { w.items.push({ desc: '7b:Skyrim.esm', name: 'Nothing', issue: '#1', why: 'planted' }); return w; });
  refused('a waiting entry for something the world no longer has is refused', root, 'no longer hands it out');

  root = copy();
  waiting(root, w => { w.items[0].issue = ''; return w; });
  refused('a waiting entry with no issue number is refused', root, 'with no issue number');

  root = copy();
  waiting(root, w => { w.exempt.push({ desc: w.items[0].desc, name: w.items[0].name, why: '' }); w.items.shift(); return w; });
  refused('an exemption with no reason is refused', root, 'exempt with no reason');

  root = copy();
  edit(root, 'docs/systems/lists/who-makes-it.md', s => s + '\nhand edit\n');
  refused('a hand-edited or stale list page is refused', root, 'is out of date');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

done();
