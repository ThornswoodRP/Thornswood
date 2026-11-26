'use strict';
// #4398. Check the authored fishing pages against the placed waters and run
// the list generator in scratch, because CI lays the latest shipped content.
// Its generated Markdown may predate this checkout's generator (#5191).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { steps } = require('../../scripts/mods/content-tables.json');

const root = path.join(__dirname, '..', '..');
const generator = 'scripts/dev/Write-SystemLists.js';
const fisherPage = 'docs/systems/classes/fisher.md';
const classesPage = 'docs/systems/classes.md';
const read = (rel, base = root) => fs.readFileSync(path.join(base, rel), 'utf8').replace(/\r\n/g, '\n');
const harvests = JSON.parse(read('game/data/harvests.json'));
const waterCount = Object.keys(harvests.fish || {}).length;

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}

yes('the harvest data contains placed fishing water', waterCount > 0);

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-4398-'));
let list;
try {
  const { reads } = steps.find(step => step.tool === generator);
  for (const rel of [generator, ...reads, 'scripts/dev/Check-Makers.js', 'scripts/dev/GamemodeTables.js', 'game/gamemode-tables/SPELL_IDS.json']) {
    const destination = path.join(scratch, rel);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(root, rel), destination);
  }
  execFileSync(process.execPath, [path.join(scratch, generator)], { timeout: 120_000 });
  list = read('docs/systems/lists/fisher.md', scratch);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

const noPole = /\bno (?:fishing )?(?:rod|pole)\b|\b(?:rod|pole) (?:is )?not (?:needed|required)\b/i;
const handCatch = /They are taken by hand, so no pole is asked\./g;
const pages = [fisherPage, classesPage, 'docs/systems/creation.md', 'site/data/site/classes.md', 'site/data/help.md'];
for (const rel of pages) {
  const text = read(rel).replace(/\s+/g, ' ');
  const waterText = rel === fisherPage ? text.replace(handCatch, '') : text;
  yes(rel + ' does not say fishing needs no pole', !noPole.test(waterText));
}
yes('the generated fisher list asks for a fishing pole', /with a fishing pole in your pack/i.test(list) && !noPole.test(list));

const gamemode = read('game/gamemode.js');
const fish = /^function fish\([^\n]*\n([\s\S]*?)^}/m.exec(gamemode);
yes('the live fishing verb returns the pole refusal', !!fish &&
    /const pole = toolGate\(actorId, 'fisher'\);\n\s*if \(pole\) return pole;/.test(fish[1]));

const authored = [
  [fisherPage, read(fisherPage), '../lists/fisher.md'],
  [classesPage, /^\| \[Fisher\][^\n]*/m.exec(read(classesPage))?.[0] || '', 'lists/fisher.md'],
];
for (const [rel, text, link] of authored) {
  const counts = Array.from(text.matchAll(/\b(\d+) water records\b/g), m => Number(m[1]));
  yes(rel + ' points to the fisher list', text.includes('](' + link + ')'));
  yes(rel + ' gives the number of placed waters (' + waterCount + ')',
    counts.length > 0 && counts.every(count => count === waterCount));
}

const listCount = /^Generated from[^\n]*, (\d+) placed records\./m.exec(list);
yes('the generated fisher list gives the same number of waters', Number(listCount?.[1]) === waterCount);
const tableRows = list.split('\n').filter(line => /^\| /.test(line) && !/^\| (Name|---)/.test(line));
const total = tableRows.reduce((sum, line) => sum + Number(line.split('|')[3]), 0);
yes('the generated table sums to ' + waterCount + ' placed waters', total === waterCount);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
