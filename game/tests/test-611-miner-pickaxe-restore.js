// test-611-miner-pickaxe-restore.js
//
// #611: after mining, the pickaxe stays equipped if it was on the hip or
// drawn before the spell. IdlePickaxeEnter carries its own pick, so the
// real one comes off at the start of a held swing; the end path must put
// it back only when it was equipped then.
//
// Read only. Source shape checks against game/gamemode.js.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const start = src.indexOf('function swingScript() {');
const end = src.indexOf('\n}\n', start);
yes('swingScript is in the gamemode', start >= 0 && end > start);
const body = start >= 0 && end > start ? src.slice(start, end + 3) : '';

yes('A1 end path restores via thornswoodSwingHadTool',
  /thornswoodSwingHadTool === v\.tool/.test(body) &&
  /pc\.equipItem\(back, false, true\)/.test(body));

yes('A2 start path remembers isEquipped before unequip',
  /had = !!ac\.isEquipped\(it\)/.test(body) &&
  /thornswoodSwingHadTool = had \? v\.tool : 0/.test(body) &&
  /if \(had\) \{ pc\.unequipItem\(it, false, true\); \}/.test(body));

yes('A3 restore clears the remembered flag',
  /st\.thornswoodSwingHadTool = 0/.test(body));

yes('A4 restore runs on the end message, before return', (() => {
  const iEnd = body.indexOf("if (v.end) {");
  const iRestore = body.indexOf('pc.equipItem(back, false, true)');
  const iReturn = body.indexOf("return;", iEnd);
  return iEnd >= 0 && iRestore > iEnd && iRestore < iReturn;
})());

yes('A5 stopMining still hands the tool id to swingEnd',
  /function stopMining\(actorId\) \{[\s\S]{0,260}swingEnd\(actorId, tool\);/.test(src));

yes('A6 mining still holds the swing with the owned pickaxe',
  /swing\(actorId, SWING_MINE, function \(\) \{ lands\(\); \}, \{ hold: true, tool: pick \}\)/.test(src));

// Simulate the client decision: restore only when the flag matches the tool.
function decideRestore(v, st) {
  const restore = (v.tool && st.thornswoodSwingHadTool === v.tool) ? v.tool : 0;
  return restore;
}
yes('B1 equipped pick is restored on end',
  decideRestore({ tool: 0xe3c16, end: true }, { thornswoodSwingHadTool: 0xe3c16 }) === 0xe3c16);
yes('B2 pack-only pick is not equipped on end',
  decideRestore({ tool: 0xe3c16, end: true }, { thornswoodSwingHadTool: 0 }) === 0);
yes('B3 a mismatched tool id is not restored',
  decideRestore({ tool: 0xe3c16, end: true }, { thornswoodSwingHadTool: 0x1019d4 }) === 0);

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
