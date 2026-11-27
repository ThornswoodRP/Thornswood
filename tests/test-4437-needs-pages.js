/*
  #4437: the four needs pages (thirst, hunger, drink, food under
  docs/systems) agree with the server and with each other, and none says a
  thing is not built that the server does.

  On main b643399, thirst.md said "The server does not yet know whether the
  water you drank was a well or a ditch" and "Soups do not yet add thirst on
  top of hunger", and hunger.md said "Food states are not on the meal". The
  server does all three in game/gamemode/needs.ts: NEEDS.waterSource keeps
  where each bottle came from, NEEDS.foodGroup.soup is 25 hunger and 10
  thirst, and the raw, cooked, soup and feast groups, the burnt quality and
  the spoiled line put a meal's state on the meal. drink.md and food.md
  already said so.

  For each, the check reads the code first. While the code does it, no page
  may say it is not yet built, and the numbers the pages give are the code's.
  Read only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PAGES = ['thirst', 'hunger', 'drink', 'food'];
const page = {};
for (const p of PAGES) page[p] = read('docs/systems/' + p + '.md').replace(/\s+/g, ' ');
const sentences = (t) => t.split(/(?<=[.!?])\s/);
const needs = read('game/gamemode/needs.ts');

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}
function num(re) { const m = re.exec(needs); return m ? Number(m[1]) : NaN; }

// What the server does, read from the code.
const sea = num(/waterSource:\s*\{[\s\S]*?sea:\s*\{\s*thirst:\s*(\d+)/);
const standing = num(/waterSource:\s*\{[\s\S]*?standing:\s*\{\s*thirst:\s*(\d+)/);
const soupFood = num(/foodGroup:\s*\{[\s\S]*?soup:\s*\{\s*food:\s*(\d+)/);
const soupDrink = num(/foodGroup:\s*\{[\s\S]*?soup:\s*\{\s*food:\s*\d+,\s*drink:\s*(\d+)/);
const raw = num(/foodGroup:\s*\{[\s\S]*?raw:\s*\{\s*food:\s*(\d+)/);
const burnt = num(/cookQuality:\s*\{[\s\S]*?burnt:\s*\{\s*food:\s*(\d+)/);
const feast = num(/feast:\s*\{\s*food:\s*(\d+)/);

const FEATURES = [
  { what: 'where the water you drank came from',
    done: /waterSource:\s*\{/.test(needs) && /waterItems:\s*\{[^}]*river:/.test(needs) && sea > 0,
    said: /\bnot yet know\b[^.]*\bwater\b|\bwater\b[^.]*\bnot yet\b/i },
  { what: 'a soup\'s thirst on top of its hunger',
    done: soupDrink > 0,
    said: /\bsoups?\b[^.]*\bnot yet\b[^.]*\bthirst\b|\bnot yet add thirst\b/i },
  { what: 'food states on the meal (raw, burnt, spoiled, cooked, feast)',
    done: raw > 0 && burnt > 0 && feast > 0 && /spoiledLine:/.test(needs),
    said: /\bfood states? (?:are|is) not\b|\bstates? (?:are|is) not (?:yet )?on the meal\b|\bfood states?\b[^.]*\bnot yet\b/i }
];

for (const f of FEATURES) {
  yes('the server does ' + f.what, f.done);
  for (const p of PAGES) {
    const bad = sentences(page[p]).filter((s) => f.said.test(s));
    yes(p + '.md does not say ' + f.what + ' is not built' + (bad.length ? ': "' + bad[0] + '"' : ''), !f.done || bad.length === 0);
  }
}

// The numbers the pages give are the server's.
yes('thirst.md gives a soup, stew or chowder\'s thirst as the server\'s ' + soupDrink,
  new RegExp('(?:soup|stew|chowder)[^|]*\\|\\s*' + soupDrink + '\\b', 'i').test(page.thirst));
yes('thirst.md gives the sea\'s ' + sea + ' and drink.md the same',
  new RegExp('\\bhalf a normal drink, ' + sea + '\\b').test(page.thirst) && new RegExp('The sea \\| ' + sea + ' \\|').test(page.drink));
yes('drink.md gives standing water\'s ' + standing, new RegExp('standing water \\| ' + standing + ' \\|').test(page.drink));
yes('food.md gives a soup ' + soupFood + ' hunger and ' + soupDrink + ' thirst',
  page.food.indexOf(soupFood + ' hunger and ' + soupDrink + ' thirst') >= 0);
yes('food.md gives raw ' + raw + ', burnt ' + burnt + ' and a feast ' + feast,
  new RegExp('Raw meat or fish \\| ' + raw + ' \\|').test(page.food) && new RegExp('Burnt \\| ' + burnt + ' \\|').test(page.food) &&
  new RegExp('A feast \\| ' + feast + ' \\|').test(page.food));
yes('hunger.md names every state food.md has: raw, burnt, spoiled, cooked and a feast',
  ['raw', 'burnt', 'spoiled', 'cooked', 'feast'].every((w) => new RegExp('\\b' + w + '\\b', 'i').test(page.hunger)));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
