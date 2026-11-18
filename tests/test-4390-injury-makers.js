/*
  #4390: the injury page names the makers the game's recipes name.

  docs/systems/injury.md has two tables that say who makes the treatments:
  "Who treats what" and the recipe table under "Where this is". On main
  eea2ca7 the first said "A woodworker or a tailor" makes a splint, while
  the recipe (game/data/recipes.json, ThornswoodRecipeSplint) and the page's
  own recipe table say a Woodwright makes it, at the kiln. Nothing compared
  either table with the recipes, so one drifted.

  For every Thornswood-Content.esp recipe the recipe table lists, this holds:
  - its recipe table row gives the recipe's bench, inputs, profession, half
    and rank;
  - its "Who treats what" row, when it has one, names a maker, and every
    profession or half it names is the recipe's own.
  Read only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PAGE = 'docs/systems/injury.md';
const RECIPES = 'game/data/recipes.json';

// The bench records the page names in words.
const BENCH = {
  MCE_CraftingLoom: 'Loom',
  ThornswoodCraftingCharcoalKiln: 'Kiln',
  ThornswoodCraftingAlchemy: 'Alchemy lab',
};
// Every profession and half a page could name as a maker.
const MAKERS = ['alchemist', 'blightbrewer', 'physicker', 'cook', 'hearthcook', 'confectioner',
  'enchanter', 'bladebinder', 'wardweaver', 'smith', 'platewright', 'edgewright', 'tailor',
  'haberdasher', 'liverywright', 'woodworker', 'charburner', 'woodwright', 'mage', 'warrior',
  'berserker', 'bulwark', 'farmer', 'fisher', 'gatherer', 'hunter', 'miner'];

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}

const page = fs.readFileSync(path.join(ROOT, PAGE), 'utf8').replace(/\r\n/g, '\n');
const all = JSON.parse(fs.readFileSync(path.join(ROOT, RECIPES), 'utf8'));
const recipes = [];
(function walk(o) {
  if (!o || typeof o !== 'object') return;
  if (typeof o.editorId === 'string' && typeof o.name === 'string' && o.inputItems) { recipes.push(o); return; }
  for (const k of Object.keys(o)) walk(o[k]);
})(all);

function rows(heading) {
  const lines = page.split('\n');
  const out = [];
  let i = lines.findIndex((l) => l.startsWith('| ' + heading + ' |'));
  if (i < 0) return out;
  for (i += 2; i < lines.length && lines[i].startsWith('|'); i++) {
    out.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
  }
  return out;
}

const made = rows('Item');
const who = rows('Treatment');
yes(PAGE + ' has the recipe table (' + made.length + ' rows) and Who treats what (' + who.length + ' rows)',
  made.length > 0 && who.length > 0);

for (const r of made) {
  const [item, asks, bench, by] = r;
  const rec = recipes.find((x) => x.name === item && x.plugin === 'Thornswood-Content.esp');
  yes(item + ': ' + RECIPES + ' has its Thornswood-Content.esp recipe', Boolean(rec));
  if (!rec) continue;
  const wantAsks = rec.inputItems.map((x) => x.count + ' ' + x.name).join(', ');
  yes(item + ': the page asks for what the recipe does (' + wantAsks + ')', asks === wantAsks);
  const wantBench = BENCH[rec.benchName];
  yes(item + ': the page gives the recipe\'s bench (' + (wantBench || rec.benchName) + ')', Boolean(wantBench) && bench === wantBench);
  const wantBy = rec.owner + ', ' + rec.half + ', ' + rec.rank;
  yes(item + ': the page says who makes it as the recipe does (' + wantBy + ')', by === wantBy);

  const w = who.find((x) => x[0].toLowerCase() === item.toLowerCase());
  if (!w) continue;
  const named = MAKERS.filter((m) => new RegExp('\\b' + m + '\\b', 'i').test(w[1]));
  const own = [rec.owner.toLowerCase(), rec.half.toLowerCase()];
  const wrong = named.filter((m) => own.indexOf(m) < 0);
  yes(item + ': Who treats what names its maker (' + (named.join(', ') || 'none') + ')', named.length > 0);
  yes(item + ': and no maker the recipe does not name' + (wrong.length ? ' (' + wrong.join(', ') + ')' : ''), wrong.length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
