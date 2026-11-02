// test-nobody-makes.js
//
// Three answers, not two: one half makes it, anybody makes it, nobody makes it.
//
// Patrick, 23 September: "Remove all of the house pars except for a key", and
// asked which parts he meant, "I mean the craftable stuff in the forge hinges,
// locks, nails, iron fittings, etc". Separately, about the same menu: "Locks
// shouldn't be craftable". And, about the same bucket those four were sitting
// in: "Same with fishing poles which should be woodworkers".
//
// Both halves of that are one rule. Nine MISC rows come off the forge on this
// build and every one of them was open to everybody, because the rule that
// sorted them called itself stock and tools and its own comment named "nails,
// fishing poles" as the examples. Four of them are house parts nobody should
// make and four are the Woodwright's.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------- the table
// The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
const book = require('./gamemode-tables.js').inGamemode(src, 'RECIPES_BY_ID');
yes('the recipe block is installed', !!book);

const rows = {};
if (book) {
  Object.keys(book).forEach(function (k) { if (book[k] && typeof book[k] === 'object') { rows[k] = book[k]; } });
}
yes('and it parses, ' + Object.keys(rows).length + ' rows', Object.keys(rows).length > 1500);

function rowFor(name) {
  const hit = Object.keys(rows).filter(function (k) { return rows[k].name === name; });
  return hit.length ? rows[hit[0]] : null;
}

// ------------------------------------------------- what nobody makes at all
['Nails', 'Hinge', 'Lock', 'Iron Fittings'].forEach(function (what) {
  const r = rowFor(what);
  yes(what + ' is in the table the server is asked about', !!r);
  if (r) {
    yes('  and nobody makes it', !!r.nobody && String(r.nobody).length > 20);
    yes('  and it is nobody’s trade, so no rank can unlock it',
        !r.owner && !r.half && !r.rank);
    yes('  and the sentence says why rather than just no',
        /mold|deed|house/i.test(String(r.nobody)));
  }
});

/*
  AND THE ONE THING HE KEPT, which is now the only thing in that list of his
  that a forge still makes.

  Patrick: "Remove all of the house pars except for a key". When this file was
  first written there was no craftable key anywhere in the order, so this check
  said so. He then said plainly that there should be: "Smith's are supposed to
  be able to make a key", and "make a fucking mold item craftable dude this
  would solve alot". Both records are in the plugin now, so the check says the
  opposite thing for the same reason: the parts go, the key stays.
*/
const theKey = rowFor('Key');
yes('a key IS craftable, because it is the one he kept', !!theKey);
if (theKey) {
  yes('  and only a smith makes it', theKey.owner === 'Smith');
  yes('  and nobody is not set on it, so it is not refused with the parts', !theKey.nobody);
}
const theMold = rowFor('Key Mold');
yes('and the mold that names it is craftable too', !!theMold && theMold.owner === 'Smith');

// --------------------------------------------- and what the Woodwright makes
// The poles are Thornswood-Content.esp's own since #1379. The fishing mod's
// three keep the Woodwright as their owner, so putting one back is one line of
// the cut file, and are cut (#1766): the fisher page says the fishing mod's
// rows are not the plan, and only ours fish.
['Crude Fishing Pole', 'Fine Fishing Pole', 'Master Fishing Pole'].forEach(function (what) {
  const r = rowFor(what);
  yes(what + ' is the Woodwright’s',
      !!r && r.owner === 'Woodworker' && r.half === 'Woodwright');
  if (r) { yes('  and nobody is not set on it', !r.nobody); }
});
{
  const table = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8').split(CR).join('')).recipes;
  ['Fishing Pole - Crude', 'Fishing Pole - Fine', 'Fishing Pole - Master'].forEach(function (what) {
    const r = rowFor(what);
    const ids = Object.keys(table).filter(function (k) { return table[k].name === what; });
    const t = ids.length ? table[ids[0]] : null;
    yes('the fishing mod\'s ' + what + ' keeps the Woodwright as its owner in the recipe table, and is cut there',
        !!t && t.owner === 'Woodworker' && t.half === 'Woodwright' && t.book === 'cut');
    yes('  and the gamemode refuses it as cut, so nobody makes it',
        !!r && /^Cut from the open book/.test(String(r.nobody || '')));
  });
}

// ----------------------------------------------------------------- the gate
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the gate reads nobody off the row', /if \(row && row\.nobody\)/.test(code));
  yes('and it refuses with the row’s own sentence',
      /out\.refusal = 'Nobody makes that here\. ' \+ String\(row\.nobody\)/.test(code));
  /*
    THE ORDER IS THE POINT, and it has to be read inside craftAnswer rather
    than across the whole file. "raceGate(actorId, row)" matches the function's
    own definition six thousand characters earlier, so a whole-file comparison
    answers a question about where raceGate is written and not about when it
    is asked. The first version of this check did exactly that and failed on
    code that was correct.

    There is no rank at which a nail becomes useful, so answering "you are not
    a smith yet" would promise somebody that one day they can have it.
  */
  const at = code.indexOf('function craftAnswer(actorId, row)');
  const body = at >= 0 ? code.slice(at, at + 4000) : '';
  yes('craftAnswer is in the file', at >= 0);
  yes('and it asks nobody before the race, the profession and the rank',
      body.indexOf('row.nobody') > 0 &&
      body.indexOf('row.nobody') < body.indexOf('raceGate(actorId, row)') &&
      body.indexOf('raceGate(actorId, row)') < body.indexOf('const half = String(row.half'));
}

// ----------------------------------------------------- and the file beside it
let recipes = null;
try { recipes = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8')); }
catch (e) { recipes = null; }
if (recipes) {
  /*
    THE FOUR HOUSE PARTS ARE STILL REFUSED, BY NAME, AND EVERY REFUSED ROW SAYS
    WHY. This used to be a fixed total of four. cc3d904 ("Gate smelting to the
    smith and tanning to the Platewright", 2 October) moved the duplicate
    smelts and tans into the refused bucket too, 235 rows in all, every one
    with its reason, so the total is the table's to set and not this file's.
  */
  const refused = recipes.refused || {};
  const refusedKeys = Object.keys(refused);
  const parts = refusedKeys.filter(function (k) {
    return /^(Nails|Hinge|Lock|Iron Fittings)$/.test(String(refused[k].name || '')) &&
           refused[k].benchName === 'CraftingSmithingForge';
  });
  const partNames = parts.map(function (k) { return refused[k].name; }).sort();
  yes('recipes.json refuses the four house parts at the forge (' + partNames.join(', ') + ')',
      ['Hinge', 'Iron Fittings', 'Lock', 'Nails'].every(function (n) { return partNames.indexOf(n) >= 0; }));
  yes('  and each with its reason', parts.every(function (k) { return /mold|deed|house/i.test(String(refused[k].why || '')); }));
  const noWhy = refusedKeys.filter(function (k) { return !String(refused[k].why || '').trim(); });
  yes('recipes.json carries every refused row with its reason (' + refusedKeys.length + ' rows, ' + noWhy.length + ' without)',
      refusedKeys.length > 0 && noWhy.length === 0);
  yes('and its refused count is the rows it carries', recipes.refusedCount === refusedKeys.length);
  yes('and its own count adds up across all three buckets',
      recipes.count === recipes.owned + recipes.unownedCount + recipes.refusedCount);
  const poles = Object.keys(recipes.recipes).filter(function (k) {
    return /^Fishing Pole/.test(String(recipes.recipes[k].name || ''));
  });
  yes('the fishing mod\'s poles moved out of unowned and into a half, ' + poles.length + ' of them',
      poles.length >= 3);
  const stillOpen = Object.keys(recipes.unowned || {}).filter(function (k) {
    return /^(Nails|Hinge|Lock|Iron Fittings|Fishing Pole)/i.test(String(recipes.unowned[k].name || ''));
  });
  yes('and none of the nine is left open to everybody', stillOpen.length === 0);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
