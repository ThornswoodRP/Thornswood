// test-613-dwarven-ingot-collapse.js
//
// #613: six RecipeIngotDwarvenScrap* smelter recipes collapsed to one.
// Keeper: RecipeIngotDwarvenScrapPlateMetalLarge (10dd28). The other five are
// refused in recipes.json / gamemode and hidden from the smelter menu in
// Thornswood-Content.esp (no BNAM). No sale prices.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const RECIPES = path.join(ROOT, 'game', 'data', 'recipes.json');
const GM = process.env.GM || path.join(ROOT, 'game', 'gamemode.js');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');

const HIDE = [
  '10fbd9:Skyrim.esm',
  '10dd2d:Skyrim.esm',
  '10dd2c:Skyrim.esm',
  '10dd2b:Skyrim.esm',
  '10dd2a:Skyrim.esm',
];
const KEEP = '10dd28:Skyrim.esm';
const KEEP_EDID = 'RecipeIngotDwarvenScrapPlateMetalLarge';
const HIDE_EDIDS = [
  'RecipeIngotDwarvenScrapPlateMetalSmall',
  'RecipeIngotDwarvenScrapLarge03',
  'RecipeIngotDwarvenScrapLarge02',
  'RecipeIngotDwarvenScrapLarge',
  'RecipeIngotDwarvenScrapBent',
];

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const recipes = JSON.parse(fs.readFileSync(RECIPES, 'utf8'));
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(GM, 'utf8'));
const esp = fs.readFileSync(ESP);

const scrapUnowned = Object.keys(recipes.unowned || {}).filter(function (id) {
  const row = recipes.unowned[id];
  return row && row.name === 'Dwarven Metal Ingot' &&
    String(row.editorId || '').indexOf('RecipeIngotDwarvenScrap') === 0;
});
const scrapRefused = Object.keys(recipes.refused || {}).filter(function (id) {
  const row = recipes.refused[id];
  return row && String(row.editorId || '').indexOf('RecipeIngotDwarvenScrap') === 0;
});
const scrapOwned = Object.keys(recipes.recipes || {}).filter(function (id) {
  const row = recipes.recipes[id];
  return row && String(row.editorId || '').indexOf('RecipeIngotDwarvenScrap') === 0;
});

yes('exactly one unowned RecipeIngotDwarvenScrap* remains', scrapUnowned.length === 1 && scrapUnowned[0] === KEEP);
yes('keeper editor id is PlateMetalLarge', recipes.unowned[KEEP] && recipes.unowned[KEEP].editorId === KEEP_EDID);
yes('keeper has no sale price / worth', recipes.unowned[KEEP] && recipes.unowned[KEEP].worth == null && recipes.unowned[KEEP].price == null && recipes.unowned[KEEP].gold == null);
yes('five duplicate scrap recipes are refused', scrapRefused.length === 5 && HIDE.every(function (id) { return scrapRefused.indexOf(id) >= 0; }));
yes('no RecipeIngotDwarvenScrap* is owned', scrapOwned.length === 0);
yes('refused rows name the collapse and no sale price', HIDE.every(function (id) {
  const w = (recipes.refused[id] && recipes.refused[id].why) || '';
  return w.indexOf('duplicate Dwarven Metal Ingot scrap smelt') >= 0 && w.indexOf('No sale price') >= 0;
}));

// The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
const BOOK = require('./gamemode-tables.js').table('RECIPES_BY_ID');
yes('gamemode refuses each hidden scrap id', HIDE.every(function (id) {
  return !!BOOK[id] && (BOOK[id].nobody || '').indexOf('duplicate Dwarven Metal Ingot scrap smelt') >= 0;
}));
yes('gamemode does not mark the keeper as nobody', !BOOK[KEEP] || !BOOK[KEEP].nobody); // the keeper is unowned stock, not in RECIPES_BY_ID
yes('recipe book race filter from #1495 still present', gm.indexOf('function recipeRaceMatches(actorId, row)') >= 0 && gm.indexOf('if (!recipeRaceMatches(actorId, row)) { continue; }') >= 0);

yes('Content.esp still ships', esp.length > 100000);
HIDE_EDIDS.forEach(function (edid) {
  yes('Content.esp carries override EDID ' + edid, esp.indexOf(Buffer.from(edid + '\0')) >= 0);
});
yes('Content.esp does not override the keeper EDID', esp.indexOf(Buffer.from(KEEP_EDID + '\0')) < 0);

yes('collapse script is in the tree', fs.existsSync(path.join(ROOT, 'scripts', 'mods', 'Collapse-DwarvenIngots.py')));
yes('Build-RecipeTable names the collapsed editor ids', (function () {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'dev', 'Build-RecipeTable.ps1'), 'utf8');
  return src.indexOf('COLLAPSED_SMELT_EDITOR_IDS') >= 0 &&
    HIDE_EDIDS.every(function (e) { return src.indexOf("'" + e + "'") >= 0; });
})());

// Eligible smith: refused rows carry empty half so recipeIndex skips them;
// only the one unowned scrap path remains for anybody (including smiths) at the smelter.
yes('refused scrap rows have empty half (not listed in recipe book)', HIDE.every(function (id) {
  return !!BOOK[id] && BOOK[id].half === '';
}));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
