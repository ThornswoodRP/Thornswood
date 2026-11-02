// test-issue-616.js
//
// Issue #616, imported from the Discord launcher thread: "Dev build: Creation
// can close Skyrim, and the race table reads the winning plugin." Two dev
// build guarantees that were built and shipped separately (the K panel and
// the RaceSex close key on patrick/creation-can-close-skyrim, pull request
// #337; the race table's winning override on patrick/race-table-winning-override,
// pull request #345) and are one line in a customer's eyes. This guard holds
// both to the SHIPPED files at once, so a later change that quietly undoes
// either half fails a check that names the issue rather than passing because
// the two are tested apart.
//
// test-creation-close.js and test-race-table.js prove the mechanisms. This
// file does not repeat them. It pins the two facts a person on dev would see,
// at the places those suites leave thin:
//
//   1. THE RACE TABLE READS THE WINNING PLUGIN. game/data/races.json says,
//      for every race an override touched, which plugin's version was kept,
//      and the RACES line in game/gamemode.js carries that version's editor
//      id and playable bit. test-race-table.js checks the winning "from" on
//      the shipped table only for UndeadDragonRace, which is not playable.
//      Here every one of the ten vanilla playable races is checked: its
//      shipped version is read from the override that wins the load order,
//      it is still playable, and the set of playable races is exactly the
//      twelve this build has, so an override that flipped a race on or off
//      would be caught.
//
//   2. CREATION KEEPS A DELIBERATE, TWICE ASKED WAY TO CLOSE SKYRIM. The K
//      panel's Close Skyrim and the RaceSex Menu's close key both ask twice.
//      The shipped Thornswood.ini carries the key, the front plugin's default
//      matches it, and the on screen and button words a person reads are all
//      present. If a rename or a moved default left creation with no way out
//      again, which is what Patrick reported on 24 September, this fails.
//
// Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const read = function (p) { return fs.readFileSync(p, 'utf8').split(CR).join(''); };

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ===================================================== the race table half

const gm = read(path.join(ROOT, 'game', 'gamemode.js'));
const RACES = (function () {
  const m = require('./gamemode-tables.js').lineOf(gm, 'RACES');
  try { return m ? JSON.parse(m[1]).items : null; } catch (e) { return null; }
})();
const json = (function () {
  try { return JSON.parse(read(path.join(ROOT, 'game', 'data', 'races.json'))).items; }
  catch (e) { return null; }
})();
yes('the RACES line is in the gamemode and parses', !!RACES);
yes('game/data/races.json parses and every row names the plugin its version was read from',
    !!json && Object.keys(json).length > 0 &&
    Object.keys(json).every(function (d) { return typeof json[d].from === 'string' && json[d].from; }));

if (RACES && json) {
  // The ten vanilla races the game reports by their Skyrim.esm ids. Each is
  // overridden by Update.esm on this build, so a table that read the winning
  // plugin keeps Update.esm's version, and a table that read the plugin the
  // record was found under would say Skyrim.esm.
  const VANILLA = {
    '13740': 'ArgonianRace', '13741': 'BretonRace', '13742': 'DarkElfRace',
    '13743': 'HighElfRace', '13744': 'ImperialRace', '13745': 'KhajiitRace',
    '13746': 'NordRace', '13747': 'OrcRace', '13748': 'RedguardRace',
    '13749': 'WoodElfRace'
  };
  Object.keys(VANILLA).forEach(function (local) {
    const desc = local + ':Skyrim.esm';
    const name = VANILLA[local];
    const j = json[desc];
    const r = RACES[desc];
    yes(name + ' is one line, keyed by the plugin that made it (' + desc + ')', !!j && !!r);
    yes(name + '\'s shipped version is read from the override that wins the order, not Skyrim.esm\'s own' +
        (j ? ' (' + j.from + ')' : ''),
        !!j && typeof j.from === 'string' && j.from !== 'Skyrim.esm');
    yes(name + ' stays playable and the RACES line agrees with races.json',
        !!r && r.p === true && !!j && !!j.p === r.p && (j.e || j.n) === r.e && r.e === name);
  });

  // At least one race really is overridden, so the checks above are testing
  // the winning read and not a load order where nothing overrides anything.
  const overridden = Object.keys(json).filter(function (d) {
    return json[d].from && json[d].from !== d.slice(d.indexOf(':') + 1);
  });
  yes('the shipped table has races an override won (' + overridden.length + '), so the winning read is exercised',
      overridden.length > 0);

  // The whole set of playable races, by editor id. If an override flipped a
  // race playable or unplayable, or a mod added or dropped a playable race,
  // this is the line that moves. Ten vanilla and the two from Playable
  // Rieklings.esp, which is what lets riekling gear be locked to rieklings.
  const EXPECTED_PLAYABLE = [
    'ArgonianRace', 'BretonRace', 'DarkElfRace', 'HighElfRace', 'ImperialRace',
    'KhajiitRace', 'NordRace', 'OrcRace', 'RedguardRace', 'WoodElfRace',
    '1RieklingBlueRace', '1RieklingPurpleRace'
  ].sort();
  const playable = Object.keys(RACES).filter(function (d) { return RACES[d].p; })
    .map(function (d) { return RACES[d].e; }).sort();
  yes('exactly the twelve known playable races are playable in the shipped table (' + playable.length + ')',
      playable.join(',') === EXPECTED_PLAYABLE.join(','));
}

// ========================================================= the close half

const skills = read(path.join(ROOT, 'game', 'ui', 'thornswood-skills.js'));
const front = read(path.join(ROOT, 'game', 'plugins', 'thornswood-front.js'));
const ini = read(path.join(ROOT, 'launcher', 'Thornswood.ini'));

// The key: one number in the ini, the same number as the front plugin's
// default, so a build where the ini and the plugin drifted apart is caught.
const iniKey = /^\s*CloseGameKey\s*=\s*(\d+)\s*$/m.exec(ini);
const frontDefault = /(?:const|let) CLOSE_GAME_KEY = iniNumber\(ini, 'CloseGameKey', (\d+)\);/.exec(front);
yes('Thornswood.ini carries a CloseGameKey', !!iniKey);
yes('the front plugin reads CloseGameKey with a default', !!frontDefault);
yes('the shipped ini key and the front plugin default are the same key',
    !!iniKey && !!frontDefault && iniKey[1] === frontDefault[1]);

// The words a person reads while creating, on the K panel and on the line
// over the RaceSex Menu. Both ask twice; both must still say so.
yes('the K panel offers Close Skyrim while creating', skills.indexOf("return 'Close Skyrim';") !== -1);
yes('and after one press asks again before it closes',
    skills.indexOf("'Press again to close Skyrim'") !== -1 && skills.indexOf("'Closing Skyrim'") !== -1);
yes('the RaceSex Menu line says the key closes Skyrim, twice',
    /' twice closes Skyrim'/.test(front) && /' again to close Skyrim'/.test(front));

// The one place the game is actually ended, reached only after a second
// press: the front plugin's closeGame, off the K panel's skills:quit, the
// character page's select:quit and the RaceSex close key.
yes('the K panel\'s quit is taken only when the server still says this character is being created',
    /if \(what === 'skills:quit'\) \{[\s\S]*?if \(!skillsCreating\) \{[\s\S]*?return;/.test(front));
yes('and the close key ends the game only with the RaceSex Menu open',
    /if \(!raceMenuOpen\(\)\) \{ closeArmedAt = 0; return; \}/.test(front));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
