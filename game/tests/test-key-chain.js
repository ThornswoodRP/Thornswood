// test-key-chain.js
//
// Make a mold, stamp it on a door, cut keys off it for ever.
//
// Patrick, 23 September, after finding he could not get a key at all: "Wait how
// tf does someone use a mold if you can't make a key to own the building make
// this shit make sense make a fucking mold item craftable dude this would solve
// alot", and then the whole shape in one line: "The key should be too what
// should happen is you make a mold, mold gets used on door to assign mold to
// the door, than key uses that mold during crafting to make a key to
// specifically that house and it can be reused". And: "Each door in a property
// should take the same key".
//
// It was circular before this. Both records had been in the plugin since the
// property system was built and nothing in the game made either one: the only
// mold in the world was conjured out of nothing by /mold at a door, so the
// ceremony had to happen before the object existed.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function body(fn, span) {
  const at = code.indexOf(fn);
  return at >= 0 ? code.slice(at, at + (span || 2000)) : '';
}

// ------------------------------------------------- 1. a smith makes the blank
let recipes = null;
try { recipes = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8')); }
catch (e) { recipes = null; }
yes('recipes.json is readable', !!recipes);

if (recipes) {
  const r = recipes.recipes;
  const mold = r['15496:Thornswood-Content.esp'];
  const key = r['15497:Thornswood-Content.esp'];
  yes('a key mold is craftable', !!mold && mold.name === 'Key Mold');
  yes('and a key is craftable, which is the half that was missing entirely',
      !!key && key.name === 'Key');
  if (mold && key) {
    yes('both are a smith’s work', mold.owner === 'Smith' && key.owner === 'Smith');
    yes('and both are novice, so a new smith is not locked out of their own door',
        mold.rank === 'novice' && key.rank === 'novice');
    yes('and both are made at a forge',
        mold.benchName === 'CraftingSmithingForge' && key.benchName === 'CraftingSmithingForge');
    /*
      THE MOLD IS NOT AN INPUT ON THE KEY, and this is the check that keeps it
      reusable. A CNTO is taken away by the engine before the server is ever
      asked, so a mold listed as an input would be spent on the first key.
      Patrick: "it can be reused".
    */
    const inputs = (key.inputItems || []).map(function (i) { return String(i.name || ''); });
    yes('the key costs metal and not the mold, so the mold survives being used',
        inputs.length === 1 && /ingot/i.test(inputs[0]));
    yes('and the mold costs metal too', (mold.inputItems || []).length === 1);
  }
}

// ------------------------------------------ 2. the door stamps it, and spends it
{
  const b = body('function mold(actorId, profileId, toProfile)', 2600);
  yes('mold() is in the file', b.length > 0);
  yes('the blank comes out of the smith’s pack', /takeBlankMold\(actorId\)/.test(b));
  yes('and it is spent before the stamped one is handed over, not after',
      b.indexOf('takeBlankMold(actorId)') < b.indexOf('giveNamed(owner.actorId, MOLD'));
  yes('and with no blank it says where to get one', /Forge one at a forge/.test(b));
  yes('the stamped mold still goes to the holder and not the smith',
      /giveNamed\(owner\.actorId, MOLD, moldLabel\(building\)\)/.test(b));
  yes('and the holder still has to be standing there', /holderNearby\(actorId, building, held\)/.test(b));
}
{
  const b = body('function takeBlankMold(actorId)', 900);
  yes('takeBlankMold is in the file', b.length > 0);
  /*
    A STAMPED MOLD IS SOMEBODY'S PROPERTY. It says which door it is for, and
    spending one to stamp another would quietly destroy a holder's mold.
  */
  yes('it steps over a stamped mold and only ever spends a blank', /if \(e\.name\) \{ continue; \}/.test(b));
  yes('and it takes one out of a stack rather than the whole stack',
      /e\.count > 1/.test(b) && /entries\.splice\(i, 1\)/.test(b));
}

{
  /*
    THE TRANSITION. The plugin reaches clients only through the Nexus
    collection and the launcher refuses Play on any plugin size difference, so
    the gamemode runs for a while against a plugin with no blank mold in it.
    Demanding a blank then would refuse every /mold in the world.
  */
  const b = body('function blankMoldsExist()', 700);
  yes('the gamemode asks the engine whether the blank mold recipe is loaded', b.length > 0 &&
      /mp\.lookupEspmRecordById\(id\)/.test(b) && /found\.record/.test(b));
  yes('and it asks about the recipe the plugin adds',
      /var BLANK_MOLD_RECIPE = '15496:Thornswood-Content\.esp'/.test(code));
  const m = body('function mold(actorId, profileId, toProfile)', 2600);
  yes('a blank is only demanded once the plugin carries one',
      /if \(blankMoldsExist\(\)\) \{\s*if \(!takeBlankMold\(actorId\)\)/.test(m));
}

// ------------------------------------------- 3. the key comes out named for it
{
  const b = body('mp.onCraft = guard(', 6000);
  yes('the craft of a key is answered', /desc === KEY_RECIPE/.test(b));
  // #2487: the menu's key is refused outright; the lock key at a forge cuts it named.
  const k = b.slice(b.indexOf('desc === KEY_RECIPE'), b.indexOf('desc === KEY_RECIPE') + 900);
  yes('the menu craft of a key is refused, so the ingot stays and no plain key is made',
      /return false;/.test(k) && /lock key/.test(k));
  yes('no timer names a key (#2487)', !/setTimeout/.test(k) && !/KEY_NAME_DELAY/.test(code));
  yes('and nothing in that path spends the mold', !/takeBlankMold/.test(k));
}
yes('nameFreshKey is gone: a key is named in the step that makes it (#2487)', !/nameFreshKey/.test(code));
yes('the recipe the gate watches for is the one the plugin adds',
    /const KEY_RECIPE = '15497:Thornswood-Content\.esp'/.test(code));

// --------------------------------- 4. one key for every door of one property
{
  const m = /const BUILDING_BY_DOOR = (\{.*?\});/s.exec(src);
  yes('the door map is installed', !!m);
  if (m) {
    const map = JSON.parse(m[1]);
    const doors = Object.keys(map);
    const byBuilding = {};
    doors.forEach(function (d) { (byBuilding[map[d]] = byBuilding[map[d]] || []).push(d); });
    const buildings = Object.keys(byBuilding);
    const multi = buildings.filter(function (b) { return byBuilding[b].length > 1; });
    /*
      "Each door in a property should take the same key." It already did, and
      this is the check that says so rather than a change: a key is named for
      the BUILDING, and every door of that building resolves to it.
    */
    yes('most properties have more than one door, ' + multi.length + ' of ' + buildings.length,
        multi.length > 100);
    yes('and a key is named for the property rather than the door',
        /function keyLabel\(building\) \{ return 'Key to ' \+ placeOf\(building\); \}/.test(code));
    yes('and the door is resolved to its property before the key is asked about',
        /function mayPass\(actorId, profileId, building\)/.test(code) &&
        /holdsKey\(actorId, building\)/.test(code));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
