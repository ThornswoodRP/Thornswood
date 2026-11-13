// test-cut-key.js
//
// A smith can make a key.
//
// Patrick, 23 September: "Smith's are supposed to be able to make a key", after
// "A smith can't craft a key it seems so I can't test the property system line
// properly", and then, plainly, "I littarrly said you can't make a fucking key
// but you're supposed to be able too".
//
// He was right, and the shape of the rule was the reason. Every key came off a
// mold; a mold is only cut at the door of a building somebody already holds,
// with that holder standing there. A smith alone had no way to a key at all,
// and neither did anybody else: the ceremony needed two people before it would
// produce the first one.
//
// What this checks is that the fix did not spend the balance it was protecting.
// A mold is still the only way to a key for a door you do not hold.
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

// The body of cutKey, so the order of its gates can be read.
// It takes the line's words since #1637: the lock key at a forge sends /key
// and the forge's id, and forgeHere checks that forge.
const at = code.indexOf('function cutKey(actorId, profileId, toProfile, parts)');
const body = at >= 0 ? code.slice(at, at + 2600) : '';
yes('cutKey is in the file', at >= 0);

// ------------------------------------------------------- the gates that stay
yes('it is still a smith’s work', /if \(!isSmith\(actorId\)\)/.test(body));
yes('and still wants a forge, the one under the crosshair or the one last pressed',
    /var forge = forgeHere\(parts, actorId\);\s*if \(!forge\)/.test(body) &&
    /if \(!raw\) \{ return atForge\(actorId\); \}/.test(code));
yes('and the mold is still asked for first, so a mold in hand always decides',
    body.indexOf('moldInHand(actorId)') > 0 &&
    body.indexOf('moldInHand(actorId)') < body.indexOf('heldBy(profileId)'));

// --------------------------------------------------------- the way through
yes('a holder can cut a key to their own door without a mold',
    /heldBy\(profileId\)/.test(body));
yes('the door they last opened decides when they hold more than one',
    /var at = here\(actorId\)/.test(body) && /mine\.indexOf\(at\) !== -1/.test(body));
yes('and one held building is unambiguous on its own',
    /mine\.length === 1/.test(body));
yes('several, with nothing to choose between them, names them rather than refusing blankly',
    /mine\.length > 1/.test(body) && /names\.join\(', '\)/.test(body));
// With nothing to type (#1637): a blank pressed into the lock, by the mold key.
yes('and holding nothing says how to get there, with nothing to type',
    /Press a blank one into the lock you mean/.test(body) && !/\/claim|\/mold|\/key/.test(body));

// heldBy itself
{
  const hb = code.indexOf('function heldBy(profileId)');
  const hbody = hb >= 0 ? code.slice(hb, hb + 500) : '';
  yes('heldBy reads the claims', hb >= 0 && /for \(var b in claims\)/.test(hbody));
  yes('and only counts what this profile holds', /claims\[b\]\.by === profileId/.test(hbody));
  yes('and answers nothing for no profile, rather than everything',
      /if \(!profileId\) \{ return mine; \}/.test(hbody));
}

/*
  THE BALANCE, WHICH IS THE HALF WORTH GUARDING. Patrick asked for the mold
  because "I don't want people to make new molds when somone is offline". A key
  to somebody else's door still needs their mold, and a mold is still cut at
  that door with its holder standing there.
*/
{
  const m = code.indexOf('function mold(actorId, profileId, toProfile)');
  const mbody = m >= 0 ? code.slice(m, m + 2200) : '';
  yes('a mold is still a smith’s work at the door', m >= 0 &&
      /if \(!isSmith\(actorId\)\)/.test(mbody) && /var building = here\(actorId\)/.test(mbody));
  yes('and the holder still has to be standing there, which is the whole balance',
      /holderNearby\(actorId, building, held\)/.test(mbody));
  yes('and the mold still goes to the holder and not to the smith',
      /giveNamed\(owner\.actorId, MOLD/.test(mbody));
  yes('nothing in cutKey hands a key for a door the person does not hold',
      !/holderOf\(/.test(body));
}

// ------------------------------------------------------- the items exist
yes('the key and the mold are both Thornswood content records',
    /var KEY = '15494:Thornswood-Content\.esp'/.test(code) &&
    /var MOLD = '15495:Thornswood-Content\.esp'/.test(code));
yes('and a key is named for its building, so one key is not every key',
    /function keyLabel\(building\) \{ return 'Key to ' \+ placeOf\(building\); \}/.test(code));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
