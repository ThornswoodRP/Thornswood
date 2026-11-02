// test-race-gate.js
//
// A people's own dress is theirs. A tier of metal is anybody's.
//
// Patrick, 23 September: "Riekling stuff should only be able to be made by a
// riekling", then "We already agreed on the race gate for race based items so
// if there is anything by another race aswell it should be race locked", then,
// reading a list with Falmer and Dremora in it, "they are not playable races
// so they can be by anuone only playable races should be race locked", then
// "somtimes things are called bosmer, orsimer, altmer, dunmer", "That's the
// exact reason I said it because of Bosmer armour", and finally, asked what
// should happen to the 70 Nord named recipes, he chose the cultural sets
// alone: Nord Mail locks, Nordic Carved does not.
//
// That last line is the whole of this file. Nordic Carved is the quicksilver
// tier between Elven and Glass, and taking a smithing tier away from everybody
// who is not a Nord is the failure worth a harness. Every check below is a
// recipe by the name it has in the game.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// -------------------------------------------------------------- the races
const line = require('./gamemode-tables.js').lineOf(src, 'RACES');
const RACES = line ? JSON.parse(line[1]) : { items: {} };
const races = Object.keys(RACES.items || {});
const playable = races.filter(function (d) { return RACES.items[d].p; });
const names = playable.map(function (d) { return String(RACES.items[d].e || '').toLowerCase(); });

yes('the race table is installed in the gamemode', races.length > 100);
yes('and it says which races are playable',
    playable.length > 0 && playable.length < races.length);
yes('the ten vanilla races are playable',
    ['nordrace', 'bretonrace', 'imperialrace', 'redguardrace', 'orcrace',
     'argonianrace', 'khajiitrace', 'highelfrace', 'woodelfrace', 'darkelfrace']
      .every(function (n) { return names.indexOf(n) >= 0; }));
yes('a riekling is playable here, which is what makes that lock mean anything',
    names.some(function (n) { return n.indexOf('riekling') >= 0; }));
yes('and the three he named are not',
    !names.some(function (n) { return n.indexOf('falmer') >= 0; }) &&
    !names.some(function (n) { return n.indexOf('dremora') >= 0; }) &&
    !names.some(function (n) { return n.indexOf('draugr') >= 0; }));

// ------------------------------------------------------------- the recipes
let recipes = null;
try { recipes = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'recipes.json'), 'utf8')); }
catch (e) { recipes = null; }

if (!recipes) {
  yes('game/data/recipes.json is readable', false);
} else {
  const items = recipes.items || recipes.recipes || recipes;
  const keys = Object.keys(items);
  function nameOf(k) { return String(items[k].name || items[k].n || items[k].outName || ''); }
  function raceFor(what) {
    const hit = keys.filter(function (k) { return nameOf(k) === what; });
    if (!hit.length) { return '(not in the table)'; }
    return items[hit[0]].race || '';
  }
  function locks(what, to) {
    yes(what + ' is ' + to + ' work', raceFor(what) === to);
  }
  function open(what) {
    const got = raceFor(what);
    yes(what + ' is open to any smith', got === '');
  }

  /*
    A PEOPLE'S OWN DRESS. Each of these is a set named for the people who wear
    it, and the word recorded is the one the RACE record uses, because that is
    all the gamemode has to compare somebody against.
  */
  locks('Bosmer Cuirass', 'woodelf');
  locks('Bosmer Hood', 'woodelf');
  locks('Dunmer Outfit', 'darkelf');
  locks('Telvanni Robes', 'darkelf');
  locks('Orsimer Cheiftan Bow', 'orc');
  locks('Nord Mail Hauberk', 'nord');
  locks('Skaal Coat', 'nord');
  locks('Redguard Knight Cape', 'redguard');
  locks("Alik'r Hood", 'redguard');
  locks('Yokudan Shotel', 'redguard');
  locks('Colovian Composite Bow', 'imperial');
  locks('Ornate Khajiit Bow', 'khajiit');

  /*
    A TIER OF METAL. THIS IS THE HALF THAT MATTERS.

    Every one of these carries the name of a people and none of them is that
    people's dress: they are what a smith with the perk hammers out, and Patrick
    said so on 23 September when he was asked directly. If one of these ever
    reads as locked, a smithing tier has just been taken off everybody who was
    born wrong, and that is the bug this file exists to catch.
  */
  open('Nordic Carved Armor');
  open('Nordic Carved Helmet');
  open('Nordic Battleaxe');
  open('Ancient Nord Helmet');
  open('Ancient Nord Armor');
  open('Nord Hero Sword');
  open('Elven Armor');
  open('Orcish Armor');
  open('Imperial Light Armor');
  open('Glass Armor');
  open('Dwarven Armor');
  open('Chitin Armor');
  open('Bonemold Armor');

  /*
    A FACTION IS NOT A PEOPLE. The Thalmor take Bosmer as readily as Altmer,
    and the Forsworn are a tribe at war with the Reach rather than a race.
  */
  open('Thalmor Robes');
  open('Forsworn Boots');

  // And nothing is locked to a race nobody can be.
  const locked = {};
  keys.forEach(function (k) { if (items[k].race) { locked[items[k].race] = (locked[items[k].race] || 0) + 1; } });
  yes('nothing is locked to a race nobody can choose',
      !locked.falmer && !locked.dremora && !locked.draugr && !locked.dwemer);
  yes('every locked word is a race the table says is playable',
      Object.keys(locked).every(function (w) {
        return names.some(function (n) { return n.indexOf(w) !== -1; });
      }));
  // Most of the order stays open. A number that collapses means a word went wide.
  const lockedCount = Object.keys(locked).reduce(function (a, w) { return a + locked[w]; }, 0);
  yes('the lock is a small part of the order, ' + lockedCount + ' of ' + keys.length,
      lockedCount > 300 && lockedCount < keys.length * 0.2);
}

// ---------------------------------------------------------------- the gate
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('the gate reads the race off the appearance the client uploads',
      /function raceOf\(actorId\)/.test(code) &&
      /mp\.get\(actorId, 'appearance'\)/.test(code) &&
      /a\.raceId/.test(code));
  yes('a row with no race passes', /if \(!row \|\| !row\.race\) \{ return ''; \}/.test(code));
  yes('and a race that cannot be read passes, rather than refusing everything',
      /if \(!mine\) \{ return ''; \}/.test(code));
  yes('the word is matched inside the editor id, so every variant of a race counts',
      /mine\.indexOf\(want\) !== -1/.test(code));
  /*
    Read inside craftAnswer, not across the file: "raceGate(actorId, row)"
    also matches the function's own definition further up, so a whole-file
    comparison answers where it is written rather than when it is asked.
  */
  const at = code.indexOf('function craftAnswer(actorId, row)');
  const body = at >= 0 ? code.slice(at, at + 4000) : '';
  yes('and it is asked before the profession, the half and the rank',
      at >= 0 &&
      body.indexOf('raceGate(actorId, row)') > 0 &&
      body.indexOf('raceGate(actorId, row)') < body.indexOf('const half = String(row.half'));
  yes('the refusal says Wood Elf out loud rather than woodelf',
      /RACE_CALLED\[want\]/.test(code) && /woodelf: 'Wood Elf'/.test(code));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
