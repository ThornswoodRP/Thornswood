// test-626-tundra-cotton.js
//
// #626: Tundra Cotton must be gatherer flora (answered by harvest()), not a farm crop.
//
// Discord: counting as farming and does not phase back like flowers/mushrooms;
// should be gatherers. Root cause: TreeFloraTundraCotton01 was named in
// CROP_BY_EDITOR_ID because its produce is INGR, so isCrop won over isPlant in
// onActivate. Farm activates never call putBack, so a refused press left the
// FLOR stripped on the client.
//
// Read only against game/gamemode.js (and the crop knobs in Build-HarvestTable).
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
const BUILD = path.join(__dirname, '..', 'scripts', 'dev', 'Build-HarvestTable.ps1');
const src = fs.readFileSync(SRC, 'utf8').split(String.fromCharCode(13)).join('');
const build = fs.existsSync(BUILD)
  ? fs.readFileSync(BUILD, 'utf8').split(String.fromCharCode(13)).join('')
  : '';

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function cut(from, end) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

function evalObjectLiteral(fromMark, toMark) {
  const a = src.indexOf(fromMark);
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  const b = src.indexOf(toMark, open);
  if (open < 0 || b < 0) { return null; }
  // Take from { through the }; before toMark (or include the closing of the var).
  const close = src.lastIndexOf('};', b);
  if (close < open) { return null; }
  try { return eval('(' + src.slice(open, close + 1) + ')'); }
  catch (e) { return null; }
}

const COTTON = 'bb947:Skyrim.esm';
const WHEAT = 'bb953:Skyrim.esm';

// The gamemode reads both tables from game/gamemode-tables (#5191).
const GT = require('./gamemode-tables.js');
const cropsBlock = JSON.stringify(GT.table('CROPS_BY_BASE'));
yes('CROPS_BY_BASE block is present', !!cropsBlock);
yes('Tundra Cotton is NOT in CROPS_BY_BASE',
  !!cropsBlock && !cropsBlock.includes('"' + COTTON + '"') && !/Tundra Cotton/.test(cropsBlock));
yes('Wheat stays in CROPS_BY_BASE (still the INGR field crop)',
  !!cropsBlock && cropsBlock.includes('"' + WHEAT + '"'));

const rulesStart = src.indexOf('var CROP_RULES = {');
const rulesEnd = src.indexOf('\n};\n', rulesStart);
const rules = rulesStart >= 0 && rulesEnd > rulesStart ? src.slice(rulesStart, rulesEnd + 3) : '';
yes('CROP_RULES is present', !!rules);
yes('Tundra Cotton is NOT in CROP_RULES',
  !!rules && !rules.includes("'" + COTTON + "'") && !/Tundra Cotton/.test(rules));
yes('Wheat stays in CROP_RULES', !!rules && rules.includes("'" + WHEAT + "'"));

const harvests = JSON.stringify(GT.table('HARVESTS_BY_BASE'));
yes('HARVESTS_BY_BASE is present', !!harvests);
yes('Tundra Cotton stays in HARVESTS_BY_BASE as gatherer flora',
  !!harvests && harvests.includes('"' + COTTON + '"') && /"name":"Tundra Cotton"/.test(harvests));

const CROPS_BY_BASE = GT.table('CROPS_BY_BASE');
const HARVESTS_BY_BASE = GT.table('HARVESTS_BY_BASE');
const CROP_RULES = (function () {
  const m = src.match(/var CROP_RULES = (\{[\s\S]*?\n\});/);
  if (!m) { return null; }
  try { return eval('(' + m[1] + ')'); } catch (e) { return null; }
})();

yes('parsed CROPS_BY_BASE / HARVESTS_BY_BASE / CROP_RULES',
  !!(CROPS_BY_BASE && HARVESTS_BY_BASE && CROP_RULES));
if (CROPS_BY_BASE && HARVESTS_BY_BASE && CROP_RULES) {
  yes('CROPS_BY_BASE has no cotton key',
    !Object.prototype.hasOwnProperty.call(CROPS_BY_BASE, COTTON));
  yes('CROP_RULES has no cotton key',
    !Object.prototype.hasOwnProperty.call(CROP_RULES, COTTON));
  yes('HARVESTS_BY_BASE has cotton',
    Object.prototype.hasOwnProperty.call(HARVESTS_BY_BASE, COTTON));
  yes('cotton harvest name is Tundra Cotton',
    HARVESTS_BY_BASE[COTTON] && HARVESTS_BY_BASE[COTTON].name === 'Tundra Cotton');
  yes('crop base count is 14', Object.keys(CROPS_BY_BASE).length === 14);
  yes('wheat is still a crop base',
    Object.prototype.hasOwnProperty.call(CROPS_BY_BASE, WHEAT));
}

// onActivate: crop before plant; nothing is put back for either (#3080).
const handler = cut("mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {", '\n});\n');
yes('onActivate is in the gamemode', !!handler);
if (handler) {
  const cropBranch = handler.indexOf('else if (isCrop(baseDesc))');
  const plantBranch = handler.indexOf('else if (isPlant(baseDesc))');
  yes('isCrop is asked before isPlant (load-bearing order)',
    cropBranch >= 0 && plantBranch > cropBranch);

  function branchSlice(start, nextMarks) {
    let end = handler.length;
    for (const m of nextMarks) {
      const i = handler.indexOf(m, start + 1);
      if (i >= 0 && i < end) { end = i; }
    }
    return handler.slice(start, end);
  }
  const plantText = branchSlice(plantBranch, ['else if (isVein(baseDesc))', 'else {']);
  yes('plant branch answers through harvest() and puts nothing back (#3080: the press never picked it)',
    /harvest\(casterRefrId, refrId, baseDesc\)/.test(plantText) &&
    !/putBack\(/.test(plantText));

  const cropText = branchSlice(cropBranch, ['else if (isFish(baseDesc))', 'else if (isPlant(baseDesc))']);
  yes('crop branch does not call putBack (why cotton looked stuck when misclassified)',
    !/putBack\(/.test(cropText));
}

// Build script knobs: cotton must not be re-added on the next harvests pass.
yes('Build-HarvestTable.ps1 is present', !!build);
if (build) {
  yes('CROP_BY_EDITOR_ID is wheat only',
    /\$CROP_BY_EDITOR_ID = @\('TreeFloraWheat01'\)/.test(build) &&
    !/\$CROP_BY_EDITOR_ID = @\('TreeFloraWheat01',\s*'TreeFloraTundraCotton01'\)/.test(build));
  yes('CROP_RANK_BY_EDITOR_ID has no TreeFloraTundraCotton01',
    !/'TreeFloraTundraCotton01'\s*=/.test(build));
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
