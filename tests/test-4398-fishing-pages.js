/*
  #4398: the fishing pages agree on the pole and on how much water there is.

  On main a4dd4ef the generated fisher list said "No rod." (written by
  scripts/dev/Write-SystemLists.js), while the game refuses to fish without a
  pole (toolGate(actorId, 'fisher')) and the class pages and the site say a
  pole is needed. The pages also gave three counts of the fisher's water:
  21 on the generated list, "fifteen" on the class page, "15 spots" on the
  classes page. The fish map in game/data/harvests.json holds the truth.

  This holds:
  - no page, and not the generator, says fishing needs no rod or no pole;
  - the fishing verb still asks for a pole, so the pages are right to say so;
  - every count of the fisher's water on the fishing pages is the number of
    records in harvests.json's fish map.
  Read only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}

const harvests = JSON.parse(read('game/data/harvests.json'));
const N = Object.keys(harvests.fish || {}).length;
yes('game/data/harvests.json has a fish map (' + N + ' water records)', N > 0);

// The pages a person reads about fishing, and the generator of the list.
const PAGES = [
  'docs/systems/lists/fisher.md',
  'docs/systems/classes/fisher.md',
  'docs/systems/classes.md',
  'docs/systems/creation.md',
  'site/data/site/classes.md',
  'site/data/help.md',
];
const GENERATOR = 'scripts/dev/Write-SystemLists.js';

const NO_ROD = /\bno (?:fishing )?(?:rod|pole)\b(?! is asked)|\b(?:rod|pole) (?:is )?not (?:needed|required)\b|\bneeds? no (?:rod|pole)\b/i;
// The Windhelm catch is taken by hand, "so no pole is asked": that is true
// and stays. Any other way of saying fishing needs no rod fails.
PAGES.concat([GENERATOR]).forEach(function (rel) {
  const text = read(rel).replace(/\s+/g, ' ');
  const hit = text.split(/(?<=[.!?|])\s/).filter(function (l) { return NO_ROD.test(l); });
  yes(rel + ' says nowhere that fishing needs no rod' + (hit.length ? ': "' + hit[0].trim() + '"' : ''), hit.length === 0);
});

const gm = read('game/gamemode.js');
yes('the fishing verb asks for a pole (toolGate(actorId, \'fisher\'))', /toolGate\(actorId, 'fisher'\)/.test(gm));

// Counts of the fisher's water, said in digits or words.
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
  'twenty', 'twenty-one', 'twenty-two', 'twenty-three', 'twenty-four', 'twenty-five'];
function num(s) {
  s = s.toLowerCase();
  return /^\d+$/.test(s) ? Number(s) : WORDS.indexOf(s);
}
const COUNT = new RegExp('\\b(\\d+|' + WORDS.join('|') + ')\\s+(?:placed records|water records|records of water|pieces\\s+of\\s+water|spots stand|fishing spots|records, the waits)', 'gi');
const COUNTED = [
  ['docs/systems/lists/fisher.md', /^Generated from[^\n]*/m],
  ['docs/systems/classes/fisher.md', null],
  ['docs/systems/classes.md', /^\| \[Fisher\][^\n]*/m],
];
COUNTED.forEach(function (c) {
  let text = read(c[0]);
  if (c[1]) { const m = text.match(c[1]); text = m ? m[0] : ''; }
  const said = [];
  let m;
  COUNT.lastIndex = 0;
  while ((m = COUNT.exec(text))) { said.push(m[0].replace(/\s+/g, ' ')); }
  const wrong = said.filter(function (s) { return num(s.split(' ')[0]) !== N; });
  yes(c[0] + ' gives a count of the water (' + (said.join('; ') || 'none') + ')', said.length > 0);
  yes(c[0] + ' and every count is ' + N + (wrong.length ? ' (not: ' + wrong.join('; ') + ')' : ''), wrong.length === 0);
});

// The class page's breakdown of the water adds up to the same number.
const page = read('docs/systems/classes/fisher.md');
const rows = page.split('<!-- detail:begin -->')[1] || '';
const sum = rows.split('\n').filter(function (l) { return /^\| [A-Z]/.test(l) && !/^\| Name /.test(l); })
  .reduce(function (t, l) { return t + Number(l.split('|')[3]); }, 0);
yes('the class page\'s Every record table adds up to ' + N + ' (' + sum + ')', sum === N);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
