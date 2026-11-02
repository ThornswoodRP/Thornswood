// test-smith-charcoal.js
//
// #613: forge crafts burn charcoal. Same shape as the wooden-handle rule:
// not a CNTO on the COBJ, taken in onCraft when the craft is allowed.
//
// Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// #1398 replaced the bench read (no installed row carried a bench, so it never
// fired) with FUEL_BY_RECIPE, a grade per recipe. tests/test-1398-fuel.js drives
// the grades, the refusals and the takes; this keeps the shape.
yes('fuelFor is in the gamemode', src.indexOf('function fuelFor(recipeDesc)') >= 0);
yes('charcoalHeld is in the gamemode', src.indexOf('function charcoalHeld(actorId, grade)') >= 0);
yes('onCraft asks for charcoal before the handle', (() => {
  const a = src.indexOf('const fuel = fuelFor(desc);');
  const b = src.indexOf('const hafted = wantsAHandle(row);');
  return a >= 0 && b >= 0 && a < b;
})());
yes('the four grades are the kiln tiers, and Skyrim\'s own Charcoal is the Charcoal grade', (() => {
  const i = src.indexOf('const CHARCOAL_GRADES = [');
  if (i < 0) return false;
  const block = src.slice(i, src.indexOf('];', i) + 2);
  return /name: 'Poor Charcoal', descs: \[ITEMS\.charcoalT1\]/.test(block) &&
    /name: 'Charcoal', descs: \[ITEMS\.charcoalT2, ITEMS\.charcoal\]/.test(block) &&
    /name: 'Charcoal Briquette', descs: \[ITEMS\.charcoalT3\]/.test(block) &&
    /name: 'Coke', descs: \[ITEMS\.charcoalT4\]/.test(block);
})());

const fuelLine = /^const FUEL_BY_RECIPE = (\{.*\});$/m.exec(src);
const FUEL = fuelLine ? JSON.parse(fuelLine[1]) : {};
const benches = {};
Object.keys(FUEL).forEach(k => { benches[FUEL[k][2]] = true; });
yes('a forge recipe wants charcoal', !!benches.forge);
yes('a skyforge recipe wants charcoal', !!benches.skyforge);
yes('a smelt wants charcoal too, at the grade of its metal (smith.md)', !!benches.smelter);
yes('nothing else in the table', Object.keys(benches).sort().join(',') === 'forge,skyforge,smelter');
yes('a recipe the table does not carry burns nothing', !Object.prototype.hasOwnProperty.call(FUEL, 'not:a.esp'));
yes('recipe book has a race-aware index', src.indexOf('function recipeRaceMatches(actorId, row)') >= 0 &&
  src.indexOf('function recipeIndex(actorId)') >= 0);
yes('race-locked rows are excluded from the recipe book index',
  src.indexOf('if (!recipeRaceMatches(actorId, row)) { continue; }') >= 0);
yes('recipe book cache is separated by race',
  src.indexOf('var bookIndexes = {};') >= 0 && src.indexOf('bookIndexes[cacheKey] = out;') >= 0);
yes('panel passes actor race into the recipe book',
  src.indexOf('var book = bookView(s, actorId);') >= 0 &&
  src.indexOf("bookHalf(own, 'own', P.rankOf(s, own) || 'novice', actorId)") >= 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
