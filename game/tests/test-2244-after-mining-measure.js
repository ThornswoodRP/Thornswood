// test-2244-after-mining-measure.js
//
//     node game/tests/test-2244-after-mining-measure.js
//
// #2244: after a mining spell with the pick only in the pack, the character
// cannot jump, sprint or use a forge until a pickaxe is equipped and taken off.
// The cause is unmeasured, and #2289's cycle of the pick was a band-aid that
// #2306 reverted. thornswood-front.js now writes the character's state after
// a spell and after the equip that frees them. This holds that measurement to
// what it is for: it reads at the right moments, names the variables, and
// changes nothing in play (no equip, no animation event, no message to the
// server).
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8');
const a = src.indexOf('WHAT THE CHARACTER IS LEFT IN AFTER A MINING SPELL (#2244)');
const b = src.indexOf("guard('after mining',", a);
const end = b < 0 ? -1 : src.indexOf('}));', b);
yes('the measurement is in thornswood-front.js', a > 0 && b > a && end > b);
const block = a > 0 && end > 0 ? src.slice(a, end) : '';
const code = block.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

yes('it starts on a pickaxe idle and reads at the end of the spell, 0.5 s and 3 s later',
    /MINE_START\.test\(name\)/.test(code) && /idlechairexitstart/i.test(code) && /now \+ 500/.test(code) && /now \+ 3000/.test(code));
yes('and again after the next equip and unequip, which is what frees them',
    /sp\.on\('equip'/.test(code) && /sp\.on\('unequip'/.test(code));
yes('only the character\'s own equip and unequip count, not an NPC\'s near the camera',
    /function afterMine\(e\)[\s\S]*?e\.actor\.getFormID\(\) === pc\.getFormID\(\)/.test(code) &&
    /guard\('after mining equip', \(e\) => \{\s*if \(!afterWaitEquip \|\| !afterMine\(e\)\)/.test(code) &&
    /guard\('after mining unequip', \(e\) => \{\s*if \([^)]*!afterMine\(e\)\)/.test(code));
yes('each spell writes its own events, not only the first spell since the game started',
    /afterWaitEquip = true;\s*afterEvents = \{\};/.test(code));
yes('the line has the sit state, the weapon, the hand types and the graph variables',
    /getSitState/.test(code) && /isWeaponDrawn/.test(code) && /getEquippedItemType/.test(code) &&
    /getAnimationVariableBool/.test(code) && /getAnimationVariableInt/.test(code));
['bAnimationDriven', 'bMotionDriven', 'bInJumpState', 'bAnimObjectLoaded', 'iState', 'iFurnitureState'].forEach(function (n) {
  yes('it reads ' + n, code.indexOf("'" + n + "'") > 0);
});
yes('it changes nothing: no equip, unequip, animation event or message to the server',
    !/equipItem|unequipItem|sendAnimationEvent\(|tellServer|sendCustomPacket/.test(code.replace(/sp\.hooks\.sendAnimationEvent/g, '')));
yes('the reads happen on a frame, not inside the hook',
    /sp\.on\('update', guard\('after mining'/.test(block) && !/afterLine\(/.test(code.slice(0, code.indexOf("sp.on('equip'"))
      .replace(/function afterLine[\s\S]*?say\('after mining, '[^;]*;\s*\}/, '')));
yes('and the reverted cycle is not back: nothing in the gamemode equips a pack-only pick at the end',
    !/thornswoodSwingCycle|cycle the pick/i.test(fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'gamemode.js'), 'utf8')));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);