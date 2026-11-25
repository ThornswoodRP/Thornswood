'use strict';
/*
  test-4438-system-pages.js

      node tests/test-4438-system-pages.js

  Issue #4438. The gold, temperature and durability pages said things the
  gamemode contradicts, and layout.json, which says it lists the
  repository's top folders, left some out. Nothing held any of them to the
  code, so each went stale when the code moved. This reads the numbers out
  of the code, never a copy of them, and holds:

    1. gold.md: a guild trader's purse is the amount the merchant ledger
       opens a trader with, the server starts that ledger, and the page's
       "Where this is" says the purse is in, not that it is missing;
    2. temperature.md: a bad burn halves everything worn (the injury block's
       burntWear, read by the needs block's insulation), a meal's warmth is
       the needs block's mealHelp numbers on the group that warms, a feast's
       is that times the feast strength for that times the feast time, only
       on the feasts food-groups.json says warm, and "Where this is" names
       neither the burn nor the meal as missing;
    3. durability.md: each kit's row names the recipe's own inputs and
       bench, out of scripts/mods/Add-ContentRecords.py, and the charcoal the
       bench burns for it, out of scripts/dev/Build-FuelTable.js's fuelOf;
    4. layout.json: every top folder git tracks is in folders, or is a place
       (engine), or is git's or GitHub's own, and every folder it names is
       one; its note says why the rest are not there.

  Reads files and asks git for the tracked top folders. Writes nothing.
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/^\uFEFF/, '');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

// The text under one '## ' heading of a page, up to the next.
function section(page, heading) {
  const at = page.indexOf('\n## ' + heading + '\n');
  if (at < 0) { return ''; }
  const rest = page.slice(at + heading.length + 5);
  const next = rest.indexOf('\n## ');
  return next < 0 ? rest : rest.slice(0, next);
}
const flat = (s) => String(s).replace(/\s+/g, ' ');
function num(src, re) { const m = re.exec(src); return m ? Number(m[1]) : NaN; }

// ---- 1. gold ----------------------------------------------------------------
const gold = read('docs/systems/gold.md');
const purses = read('game/gamemode/npc-merchant-purses.ts');
const startup = read('game/gamemode/npc-server-startup.ts');
const traderPurse = num(purses, /state=\{version:1,reference:identity\.reference,base:identity\.base,purse:(\d+),stock:\[\]\}/);
yes('1 the merchant ledger opens a trader with a purse (' + traderPurse + ')', traderPurse > 0);
yes('1 and the server starts that ledger', /merchants=createNpcMerchantPurses\(/.test(startup));
const goldWhere = flat(section(gold, 'Where this is'));
yes('1 gold.md gives a guild trader ' + traderPurse,
  new RegExp('A guild trader receives ' + traderPurse + '\\b').test(flat(gold)));
yes('1 gold.md\'s "Where this is" says the trader\'s ' + traderPurse + ' is in',
  new RegExp('trader\'s ' + traderPurse + ' is in\\b').test(goldWhere));
yes('1 and never that it is not', !new RegExp('trader\'s ' + traderPurse + ' is not\\b').test(goldWhere));

// ---- 2. temperature -----------------------------------------------------------
const temp = read('docs/systems/temperature.md');
const needs = read('game/gamemode/needs.ts');
const hurt = read('game/gamemode/injury-and-disease.ts');
const groups = JSON.parse(read('game/data/food-groups.json'));

const burnRow = /burn: \{ perSecond: \d+, bad: (\d+), healDays: \d+, warmth: ([\d.]+) \}/.exec(hurt);
const burnBad = burnRow ? Number(burnRow[1]) : NaN, burnWarmth = burnRow ? Number(burnRow[2]) : NaN;
yes('2 the injury block halves what is worn after a bad burn (' + burnBad + ' health, ' + burnWarmth + ')',
  burnWarmth === 0.5 &&
  /if \(w\.k === 'burn' && w\.dealt >= HURT\.burn\.bad\) \{ return \{ all: true, counts: HURT\.burn\.warmth \}; \}/.test(hurt));
yes('2 and the needs block\'s insulation reads it',
  /burnt = \(H && H\.burntWear\) \? H\.burntWear\(actorId\) : null;/.test(needs) &&
  /if \(w && burnt && \(burnt\.all \|\| burnt\[parts\[p\]\]\)\) \{ w = w \* burnt\.counts; \}/.test(needs));
const clothing = flat(section(temp, 'Clothing'));
yes('2 temperature.md\'s Clothing says a bad burn of ' + burnBad + ' health halves everything worn',
  new RegExp('bad burn[\\s\\S]{0,80}?' + burnBad + ' health').test(clothing) && /everything (?:you wear|worn)[^.]*at half/.test(clothing));

const help = /mealHelp: \{\s*minutes: (\d+), warm: (\d+),/.exec(needs);
const feastRow = /feast: \{ strength: (\d+), time: ([\d.]+) \}/.exec(needs);
const fineMinutes = num(needs, /fineMinutes: (\d+),/);
const helpMinutes = help ? Number(help[1]) : NaN, warm = help ? Number(help[2]) : NaN;
const strength = feastRow ? Number(feastRow[1]) : NaN, time = feastRow ? Number(feastRow[2]) : NaN;
yes('2 the needs block warms a meal ' + warm + ' for ' + helpMinutes + ' minutes (' + fineMinutes +
    ' fine), a feast ' + strength + ' times for ' + time + ' of the time',
  warm > 0 && helpMinutes > 0 && fineMinutes > 0 && strength > 0 && time > 0);
const warmGroups = Object.keys(groups.season.plain).filter((g) => groups.season.plain[g] === 'warm');
const warmFeasts = Object.keys(groups.feasts).filter((d) => groups.feasts[d] === 'warm').map((d) => groups.spoil.names[d]);
const coldFeasts = Object.keys(groups.feasts).filter((d) => groups.feasts[d] !== 'warm').map((d) => groups.spoil.names[d]);
yes('2 food-groups.json warms the ' + warmGroups.join(', ') + ' group and the ' + warmFeasts.join(', '),
  warmGroups.length > 0 && warmFeasts.length > 0 && warmFeasts.every(Boolean) && coldFeasts.every(Boolean));
const meal = flat(section(temp, 'A meal'));
yes('2 temperature.md\'s meal is a ' + warmGroups.join(', ') + ', ' + warm + ' degrees warmer for ' + helpMinutes +
    ' minutes, ' + fineMinutes + ' for a fine one',
  warmGroups.every((g) => meal.indexOf(g) >= 0) &&
  meal.indexOf(warm + ' degrees warmer for ' + helpMinutes + ' minutes') >= 0 &&
  meal.indexOf(fineMinutes + ' minutes') >= 0);
const feastWarm = warm * strength, feastMinutes = helpMinutes * time, fineFeastMinutes = fineMinutes * time;
yes('2 and the ' + warmFeasts.join(', ') + ' ' + feastWarm + ' degrees for ' + feastMinutes + ' minutes, ' +
    fineFeastMinutes + ' for a fine one',
  warmFeasts.every((n) => meal.indexOf(n) >= 0) &&
  meal.indexOf(feastWarm + ' degrees warmer for ' + feastMinutes + ' minutes') >= 0 &&
  meal.indexOf(fineFeastMinutes + ' minutes') >= 0);
yes('2 and does not give every feast warmth: ' + coldFeasts.join(', ') + ' are named as not warming',
  !/A feast shifts/.test(meal) && coldFeasts.every((n) => meal.indexOf(n) >= 0));
const tempWhere = flat(section(temp, 'Where this is'));
const notIn = (/Not in it:([^]*)$/.exec(tempWhere) || ['', ''])[1];
yes('2 temperature.md\'s "Where this is" names neither the burn nor the meal as not in',
  !/burn|meal/i.test(notIn));
yes('2 and names both as in', /the bad burn halving what is worn/.test(tempWhere) && /a meal's warmth/.test(tempWhere));

// ---- 3. durability --------------------------------------------------------------
const dur = read('docs/systems/durability.md');
const content = read('scripts/mods/Add-ContentRecords.py');
const FUEL = require(path.join(ROOT, 'scripts', 'dev', 'Build-FuelTable.js'));
const GRADE = [null, 'Poor Charcoal', 'Charcoal', 'Charcoal Briquette', 'Coke'];
const BENCH = { FORGE_KEYWORD: ['Forge', 'CraftingSmithingForge'], TANNING_KEYWORD: ['Tanning rack', 'CraftingTanningRack'] };
const KIT = { WEAPON: 'Weapon Kit', ARMOR: 'Armor Kit', SEWING: 'Sewing Kit' };
const words = (c) => c.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

const recipes = {};
const cobjRe = /cobj\(RECIPE_(WEAPON|ARMOR|SEWING)_KIT, '\w+', \[([^\]]*)\],\s*\w+,\s*(\w+)/g;
let m;
while ((m = cobjRe.exec(content))) {
  const inputs = [];
  const inRe = /\((\w+), (\d+)\)/g;
  let x;
  while ((x = inRe.exec(m[2]))) { inputs.push(x[2] + ' ' + words(x[1])); }
  recipes[KIT[m[1]]] = { inputs: inputs, bench: BENCH[m[3]] };
}
yes('3 Add-ContentRecords.py makes the three kits at a bench this test knows',
  Object.keys(recipes).length === 3 && Object.values(recipes).every((r) => r.bench && r.inputs.length));

const kitRows = {};
for (const line of section(dur, 'What a kit is made of').split('\n')) {
  const cells = line.split('|').map((c) => c.trim());
  if (cells.length === 6 && /\S Kit$/.test(cells[1])) {
    kitRows[cells[1]] = Object.assign(kitRows[cells[1]] || {}, { made: cells[2], bench: cells[3], who: cells[4] });
  }
  if (cells.length === 4 && /\S Kit$/.test(cells[1])) {
    kitRows[cells[1]] = Object.assign(kitRows[cells[1]] || {}, { burns: cells[2] });
  }
}
yes('3 durability.md has the kit table and a row each for what the bench burns (Kit, The bench burns)',
  /\| Kit \| Made of \| Bench \| Who \|/.test(dur) && /\| Kit \| The bench burns \|/.test(dur) &&
  Object.keys(kitRows).length === 3 && Object.values(kitRows).every((r) => r.made && r.burns));
for (const kit of Object.keys(recipes)) {
  const r = recipes[kit], row = kitRows[kit] || {};
  if (!r.bench) { yes('3 ' + kit + ' is made at a bench this test knows', false); continue; }
  const fuel = FUEL.fuelOf({ benchName: r.bench[1], name: kit, inputItems: r.inputs.map((i) => ({ name: i.replace(/^\d+ /, '') })) });
  const burns = fuel ? '1 ' + GRADE[fuel[0]] : 'Nothing';
  yes('3 ' + kit + ': ' + r.inputs.join(', ') + ' at the ' + r.bench[0].toLowerCase() + ', burning ' + burns.toLowerCase(),
    row.made === r.inputs.join(', ') && row.bench === r.bench[0] && row.burns === burns);
}

// ---- 4. layout.json ---------------------------------------------------------------
const layout = JSON.parse(read('layout.json'));
const git = spawnSync('git', ['ls-tree', '-d', '--name-only', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
const top = git.status === 0 ? git.stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
yes('4 git lists the tracked top folders (' + top.length + ')', top.length > 0);
const folders = Object.values(layout.folders || {});
const places = Object.values(layout.places || {}).map((p) => p.split('/')[0]);
const own = top.filter((f) => f[0] === '.');
const missing = top.filter((f) => f[0] !== '.' && folders.indexOf(f) < 0 && places.indexOf(f) < 0);
yes('4 layout.json\'s folders lists every top folder that is not a place or git\'s own' +
    (missing.length ? ': missing ' + missing.join(', ') : ''), top.length > 0 && missing.length === 0);
const gone = folders.filter((f) => top.indexOf(f) < 0);
yes('4 and every folder it lists is one' + (gone.length ? ': not a folder ' + gone.join(', ') : ''), top.length > 0 && gone.length === 0);
yes('4 its note says why ' + own.concat(places.filter((p) => top.indexOf(p) >= 0)).join(', ') + ' are not in folders',
  own.concat(places.filter((p) => top.indexOf(p) >= 0)).every((f) => String(layout.note).indexOf(f) >= 0));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
