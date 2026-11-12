// test-new-character.js
//
// A brand new character must be seen as new, and the starting purse must not
// be what stops that happening.
//
// MEASURED ON THE LIVE SERVER, 21 September, three sessions in a row and the
// same line every time:
//
//   15:19:54  chargen ff000058 profile 744947683 already has a character
//             carrying 1 thing, in the hall, no face, so creation is skipped
//
// In the hall, no face, and told they had already done this. The thing they
// were carrying was the forty gold the starting purse had handed them seconds
// earlier, on the same tick, from a loop that ran above the one that decides
// whether somebody is new. Creation was skipped and closeRaceMenu shut the
// race menu Spawn had correctly opened, so the person was left standing in the
// creation room with nothing. Djinn described exactly that from the other side.
//
// The decision reads a pack to answer "has this person played before". Gold the
// server hands out unprompted is the one thing in a pack that is no evidence of
// that, so it does not count. The purse also moved below the whole loop. Either
// fix alone is enough; both are here because the comment the old code leaned on
// said the ordering "cannot be wrong", and it was.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
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

// ---------------------------------------------------------------- the count
// A FAILURE AND NOT A THROW WHEN THE BLOCK IS NOT THERE. Pointed with GM at
// the version that was live on 21 September this has to give a verdict, not a
// stack trace: a harness that cannot report on the broken build is a harness
// nobody can use to prove the fix.
const START = '      const goldId = (globalThis.__thornswoodSpoils';
const END = '      } catch (e) { owns = 0; }\n';
const a = src.indexOf(START);
const b = a < 0 ? -1 : src.indexOf(END, a);
const block = (a >= 0 && b >= 0) ? src.slice(a, b + END.length) : null;

const GOLD = 0x0000000F;
const SWORD = 0x12eb7;

yes('the count knows about gold at all', block !== null);

/** Run the real block against a pack and hand back what it counted. */
function counts(entries) {
  if (block === null) { return null; }
  const mp = { get: function () { return { entries: entries }; } };
  const fn = new Function('mp', 'actorId', 'globalThis',
                          block + '\nreturn owns;');
  return fn(mp, 0xff000058, { __thornswoodSpoils: { GOLD: GOLD } });
}

yes('an empty pack owns nothing', counts([]) === 0);
yes('THE BUG: a pack holding only the starting purse owns nothing',
    counts([{ baseId: GOLD, count: 40 }]) === 0);
yes('a pack with a sword in it owns something',
    counts([{ baseId: SWORD, count: 1 }]) === 1);
yes('gold beside real things is not counted, the things are',
    counts([{ baseId: GOLD, count: 40 }, { baseId: SWORD, count: 1 }]) === 1);
yes('two real things count as two',
    counts([{ baseId: SWORD, count: 1 }, { baseId: 0x1397d, count: 2 }]) === 2);
yes('a hole in the pack is skipped rather than counted',
    counts([null, { baseId: GOLD, count: 40 }]) === 0);

// An inventory read that throws must count as nothing owned, because
// re-creating somebody who has played is the worse of the two mistakes and the
// doubt is supposed to go the other way.
if (block !== null) {
  const mp = { get: function () { throw new Error('no inventory'); } };
  const fn = new Function('mp', 'actorId', 'globalThis',
                          block + '\nreturn owns;');
  yes('a pack that cannot be read counts as nothing',
      fn(mp, 0xff000058, { __thornswoodSpoils: { GOLD: GOLD } }) === 0);
}

// The gold id comes from the spoils block, so the two can never drift apart,
// and there is still an answer if that block has not loaded.
if (block !== null) {
  const fn = new Function('mp', 'actorId', 'globalThis',
                          block + '\nreturn goldId;');
  const mp = { get: function () { return { entries: [] }; } };
  yes('the gold id is taken from the spoils block',
      fn(mp, 1, { __thornswoodSpoils: { GOLD: 0xABC } }) === 0xABC);
  yes('and falls back to Gold001 when that block is not there',
      fn(mp, 1, {}) === 0x0000000F);
}

// ------------------------------------------------------------- the ordering
//
// A source order check, because the fault was never in a value. Both fixes were
// made, and this is the one that says the second is still true.
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  const decision = code.indexOf('const returning = owns > 0');
  const handout = code.indexOf('spoilsBlock.purse(who)');
  yes('the returning decision is still in the file', decision > 0);
  yes('the purse handout is still in the file', handout > 0);
  yes('THE BUG: the purse is handed out AFTER the decision that reads a pack',
      decision > 0 && handout > decision);
  yes('and it is handed out exactly once',
      (code.match(/spoilsBlock\.purse\(who\)/g) || []).length === 1);
}

// ------------------------------------------- dressed when made, never asked
/*
  THE SHIFT ARRIVED AND NOBODY EVER PUT IT ON (21 and 23 September). The
  engine could not write the equipment record the client dresses from, so four
  asks grew up to make the client wear it, and the one at every login put back
  on clothes somebody had taken off. Patrick, 4 October: "my clothes should
  just stay on from the moment someone creates a new character until they
  take them off".

  These checks used to hold those asks in place. Since #1560 the engine writes
  the record for an actor no client owns, and the gamemode does it once in
  created(), before the hand-over; that is run for real in
  test-dressed-at-creation.js. What this holds now is the other half: none of
  the asks is left.
*/
{
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ');
  yes('a new character is dressed where it is made',
      /function dressNewCharacter\(actorId\)/.test(code) &&
      /dressNewCharacter\(actorId\)/.test(code.slice(code.indexOf('created: function (actorId)'))));
  yes('there is no ask to put something on any more',
      !/\bwearThese\b|\bWEAR_PROPERTY\b|\bwearScript\b/.test(code));
  yes('arriving does not put anything back on',
      !/\bwearWhatIsWorn\b/.test(code));
  yes('and nobody is watched for wearing nothing',
      !/\bdressIfBare\b|\bDRESS_TRIES\b|\bDRESS_EVERY\b/.test(code));
}


// ------------------------------------- RP-only old trades must re-pick
/*
  Issue #391: a character whose old chargen class was bard / merchant /
  priest / scholar / thief must not keep Class or Profession privileges.
  migrate clears the key and leaves progression empty so they pick again.
*/
{
  const five = ['bard', 'merchant', 'priest', 'scholar', 'thief'];
  yes('RP_ONLY names all five retired trades',
      /var RP_ONLY = \{/.test(src) &&
      five.every(function (k) { return new RegExp('\\b' + k + ':\\s*\\{').test(src); }));
  five.forEach(function (k) {
    yes('migrate treats ' + k + ' as RP-only (clear and re-pick)',
        /P\.has\(P\.TABLE\.rpOnly, trade\)/.test(src) &&
        src.indexOf("is RP-only; cleared, they must pick a class and profession") >= 0);
  });
  yes('migrate clears the old class key on thornswoodChargen',
      /old\['class'\]\s*=\s*''/.test(src) &&
      /mp\.set\(actorId, 'thornswoodChargen', old\)/.test(src));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
