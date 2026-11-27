// test-6493-aggro-radius.js
//
//     node tests/test-6493-aggro-radius.js
//
// #6493: skeevers in the Solitude sewers did not attack people. A skeever is
// Aggressive, and none of its factions (PreyFaction, SkeeverFaction,
// CreatureFaction) has a reaction toward a faction people carry, so the
// reaction is Neutral, and Aggressive starts a fight only on Enemy. The game
// does the same with reactions (its fight reaction 37667 and hostility test
// 37534, read from the 1.6.1170 code). Skeevers attack there because of the
// aggro radius: EncSkeever has it on (warn 3000, warn or attack 1500, attack
// 1000), and a Neutral person inside it is one to fight whatever the
// aggression, unless they are a friend. The server never read the radius.
//
// This takes the runtime's own hostile() out of
// game/gamemode/npc-server-runtime.ts and checks it with the records'
// values: the larger of warn or attack and attack is how near a person
// must be, friends are never attacked, and aggression and faction reactions
// still count only within sight.
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

const source = fs.readFileSync(path.join(ROOT, 'game', 'gamemode', 'npc-server-runtime.ts'), 'utf8');
const found = /  const SIGHT=\d+;\n  function hostile\(a,b,d\) \{[\s\S]*?\n  \}\n/.exec(source);
yes('the runtime has hostile(a,b,d) with its SIGHT distance', !!found);
// Everything below needs hostile(); without it the one FAIL above stands.
function run() {

  // Faction reactions as getFactionReactions gives them: source:target -> 0..3.
  const PREY = 0x2e894, SKEEVER = 0x330b1, CREATURE = 0x13, PLAYER = 0xdb1, PREDATOR = 0x2e893;
  const FRIEND_OF_PEOPLE = 0x1dd09, BANDIT = 0x1bcc0;
  const reactions = new Map([
    [PREY + ':' + PREDATOR, 1],
    [SKEEVER + ':' + SKEEVER, 2],
    [CREATURE + ':' + FRIEND_OF_PEOPLE, 3],
    [BANDIT + ':' + PLAYER, 1]
  ]);
  const hostile = new Function('reactions', found[0] + '\n  return hostile;')(reactions);

  const person = { isHuman: true, factions: [{ id: PLAYER, rank: 0 }], aggroRadius: [0, 0, 0] };
  const skeever = { isHuman: false, aggression: 1, aggroRadius: [3000, 1500, 1000],
    factions: [{ id: PREY, rank: 0 }, { id: SKEEVER, rank: 0 }, { id: CREATURE, rank: 0 }] };

  yes('an Aggressive skeever attacks a person 1400 units away, inside its warn or attack radius',
      hostile(skeever, person, 1400) === true);
  yes('and not one 1600 away, outside both its warn or attack and its attack radius',
      hostile(skeever, person, 1600) === false);
  yes('nor one 2500 away, inside only its warn radius (a warning is not a fight)',
      hostile(skeever, person, 2500) === false);
  yes('without the radius it never attacks a person, however near (the cause)',
      hostile(Object.assign({}, skeever, { aggroRadius: [0, 0, 0] }), person, 100) === false);
  yes('a person its factions count as a friend is never attacked, even inside the radius',
      hostile(skeever, Object.assign({}, person, { factions: [{ id: FRIEND_OF_PEOPLE, rank: 0 }] }), 100) === false);
  yes('the radius is for people only: a skeever does not attack a Neutral NPC inside it',
      hostile(skeever, { isHuman: false, factions: [{ id: BANDIT, rank: 0 }] }, 100) === false);

  const wolf = { isHuman: false, aggression: 0, aggroRadius: [0, 2000, 1500], factions: [{ id: PREDATOR, rank: 0 }] };
  yes('an Unaggressive wolf with the radius on attacks a person 1900 away (warn or attack 2000)',
      hostile(wolf, person, 1900) === true);
  yes('and an Unaggressive NPC without it attacks nobody',
      hostile(Object.assign({}, wolf, { aggroRadius: [0, 0, 0] }), person, 100) === false);

  const deer = { isHuman: false, aggression: 0, aggroRadius: [0, 0, 1500], factions: [{ id: PREY, rank: 0 }] };
  yes('a deer (attack 1500, warn or attack 0) counts a person 1400 away, so it flees by its confidence',
      hostile(deer, person, 1400) === true);

  const bandit = { isHuman: false, aggression: 2, aggroRadius: [0, 0, 0], factions: [{ id: BANDIT, rank: 0 }] };
  yes('a Very Aggressive bandit still attacks a Neutral person within sight', hostile(bandit, Object.assign({}, person, { factions: [] }), 1100) === true);
  yes('and not beyond sight', hostile(bandit, Object.assign({}, person, { factions: [] }), 1300) === false);
  const aggressiveBandit = Object.assign({}, bandit, { aggression: 1 });
  yes('an Aggressive one attacks a person its faction names as an Enemy within sight', hostile(aggressiveBandit, person, 1000) === true);
  yes('and not a Neutral one', hostile(aggressiveBandit, Object.assign({}, person, { factions: [] }), 1000) === false);
  yes('a skeever attacks a predator NPC within sight, since its PreyFaction names PredatorFaction an Enemy',
      hostile(skeever, { isHuman: false, factions: [{ id: PREDATOR, rank: 0 }] }, 800) === true);

  yes('the live state must carry the aggro radius, three distances, as getNpcAIState gives it',
      /Array\.isArray\(s\.aggroRadius\) && s\.aggroRadius\.length===3/.test(source));
  yes('and the stand-in server gives it too',
      /aggroRadius: \(\(records\.get\(baseOf\(row\)\) \|\| \{\}\)\.aggroRadius \|\| \[0, 0, 0\]\)/.test(
        fs.readFileSync(path.join(__dirname, 'stand-in-server.js'), 'utf8')));
}
if (found) { run(); }
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
