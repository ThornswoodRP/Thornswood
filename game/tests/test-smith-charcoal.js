// test-smith-charcoal.js
//
// #613: forge crafts burn charcoal. Since #6726 (Patrick's B) it is a CNTO
// on the COBJ, written by Thornswood-Last.esp from FUEL_BY_RECIPE, and the
// server takes none of its own.
//
// Read only.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = require('../../tests/gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// #1398 replaced the bench read (no installed row carried a bench, so it never
// fired) with FUEL_BY_RECIPE, a grade per recipe. game/tests/test-1398-fuel.js holds
// the grades and the handles, and test-6726-fuel-in-records.py the plugin's half.
yes('the server takes no charcoal and no handle of its own',
  src.indexOf('function fuelFor(') < 0 && src.indexOf('function charcoalHeld(') < 0 &&
  src.indexOf('function wantsAHandle(') < 0 && src.indexOf('const CHARCOAL_GRADES = [') < 0);

const FUEL = require('../../tests/gamemode-tables.js').table('FUEL_BY_RECIPE');
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
process.exitCode = fail ? 1 : 0;
