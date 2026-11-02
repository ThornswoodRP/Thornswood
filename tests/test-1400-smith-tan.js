// test-1400-smith-tan.js
//
// #1400. Smelting an ingot belongs to the smith halves. Tanning a hide into
// leather belongs to the Platewright. One row of each stays. Duplicate ingot
// rows stay cut. Nails, hinges, locks and iron fittings stay refused. The
// tanning rack and the forge open only for somebody who can make something there
// (#3080: no bench opens for everybody).
//
// Read only.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, "game", "gamemode.js"), "utf8")).split(CR).join("");

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function cut(head) {
  return slice(gm, head, "\n}\n");
}

const block = slice(gm, "// ==== thornswood progression ====", "// ==== end thornswood progression ====");
yes("the progression block is in the gamemode", block !== null);
const box = { console: { log: function () {} } };
box.globalThis = box;
if (block) { vm.runInNewContext(block, box); }
const P = box.__thornswoodProgression;
yes("the rules registered", !!P && !!P.TABLE);

const recSrc = slice(gm, "var RECIPES_BY_ID = {", ";\n");
let RECIPES = null;
try {
  RECIPES = recSrc ? new Function("return " + recSrc.slice("var RECIPES_BY_ID = ".length).replace(/;$/, ""))() : null;
} catch (e) { RECIPES = null; }
yes("the recipe table reads", !!RECIPES && Object.keys(RECIPES).length > 1500);

const keptSrc = slice(gm, "const KEPT_SMELT = {", "\n};");
let KEPT = null;
try {
  KEPT = keptSrc ? new Function("return " + keptSrc.slice("const KEPT_SMELT = ".length).replace(/;$/, ""))() : null;
} catch (e) { KEPT = null; }
yes("the one dwarven smelt #613 kept is a named row the gate can see", !!KEPT && !!KEPT["10dd28:Skyrim.esm"]);

const noProfM = /^const NO_PROFESSION_AT_A_BENCH = '([^']*)';$/m.exec(gm);
const NO_PROFESSION = noProfM ? noProfM[1] : null;
const helpers = ["function rankWord(", "function aWord(", "function professionName("].map(cut);
const craftSrc = cut("function craftAnswer(");
const rowSrc = cut("function craftRow(");
yes("craftAnswer and craftRow are in the gamemode", !!craftSrc && !!rowSrc && helpers.every(function (h) { return !!h; }));

function nameOf(key) {
  const T = P.TABLE;
  if (P.has(T.classes, key)) { return T.classes[key].name; }
  for (const p in T.professions) {
    if (P.has(T.professions[p].halves, key)) { return T.professions[p].halves[key]; }
  }
  if (P.has(T.professions, key)) { return T.professions[key].name; }
  return key;
}
function gates(state) {
  const g = {
    __thornswoodProgression: P,
    __thornswoodCharacter: { stateOf: function () { return state; }, nameOf: nameOf }
  };
  const fn = new Function("globalThis", "log", "raceGate", "NO_PROFESSION_AT_A_BENCH", "RECIPES_BY_ID", "KEPT_SMELT",
    helpers.join("\n") + "\n" + craftSrc + "\n" + rowSrc +
    "\nreturn { craftAnswer: craftAnswer, craftRow: craftRow };");
  return fn(g, function () {}, function () { return null; }, NO_PROFESSION, RECIPES, KEPT || {});
}
function person(prof, half, rank) {
  const r = P.pickProfession(P.fresh(), prof, half);
  if (r.ok && rank) { r.state.ranks[half] = rank; }
  return r.ok ? r.state : null;
}
function answer(state, row) {
  return gates(state).craftAnswer(1, row);
}
function keptAnswer(state, id) {
  const row = gates(state).craftRow(id);
  if (!row) { return { missing: true, refusal: null }; }
  const out = answer(state, row);
  out.row = row;
  return out;
}

if (P && RECIPES && craftSrc && rowSrc && KEPT) {
  const cook = person("cook", "hearthcook");
  const edge = person("smith", "edgewright");
  const plate = person("smith", "platewright");
  const wood = person("woodworker", "woodwright");
  const none = P.fresh();
  const iron = RECIPES["a30c3:Skyrim.esm"];
  const leather = RECIPES["1033de:Skyrim.esm"];
  const nail = Object.keys(RECIPES).map(function (k) { return RECIPES[k]; }).filter(function (r) { return r.name === "Nails"; })[0];
  const ironRows = Object.keys(RECIPES).filter(function (k) { return RECIPES[k].name === "Iron Ingot"; });
  const ironOpen = ironRows.filter(function (k) { return !RECIPES[k].nobody; });
  const ironCut = ironRows.filter(function (k) { return !!RECIPES[k].nobody; });

  yes("one iron ingot row stays and the duplicates are cut", ironOpen.length === 1 && ironCut.length > 1 && ironOpen[0] === "a30c3:Skyrim.esm");
  yes("the staying iron row asks novice Platewright, which both smith halves can work",
    iron && iron.half === "Platewright" && String(iron.rank).toLowerCase() === "novice" && !iron.nobody);
  yes("a cook cannot smelt that iron row", !!answer(cook, iron).refusal);
  yes("a woodwright cannot smelt it", !!answer(wood, iron).refusal);
  yes("somebody with no profession cannot smelt it", answer(none, iron).refusal === NO_PROFESSION);
  yes("an Edgewright can smelt it, because they can work a smith half at novice", !answer(edge, iron).refusal);
  yes("a Platewright can smelt it", !answer(plate, iron).refusal);

  yes("the staying leather row is the Platewright hide into leather",
    leather && leather.name === "Leather" && leather.half === "Platewright" && String(leather.rank).toLowerCase() === "novice" && !leather.nobody);
  yes("a cook cannot tan that leather row", !!answer(cook, leather).refusal);
  yes("an Edgewright can tan it, because novice Platewright is the sister half", !answer(edge, leather).refusal);
  yes("a Platewright can tan it", !answer(plate, leather).refusal);
  yes("a woodwright cannot tan it", !!answer(wood, leather).refusal);

  const dwarvenCook = keptAnswer(cook, "10dd28:Skyrim.esm");
  const dwarvenEdge = keptAnswer(edge, "10dd28:Skyrim.esm");
  yes("the dwarven keeper is not a second public recipe",
    !dwarvenCook.missing && dwarvenCook.row.half === "Platewright" && String(dwarvenCook.row.rank).toLowerCase() === "novice" && !dwarvenCook.row.nobody);
  yes("a cook cannot smelt the dwarven keeper", !!dwarvenCook.refusal);
  yes("an Edgewright can smelt the dwarven keeper", !dwarvenEdge.refusal);

  yes("nails stay refused", !!nail && !!nail.nobody && !nail.owner && !nail.half);
  ["Hinge", "Lock", "Iron Fittings"].forEach(function (name) {
    const row = Object.keys(RECIPES).map(function (k) { return RECIPES[k]; }).filter(function (r) { return r.name === name; })[0];
    yes(name + " stays refused", !!row && !!row.nobody && !row.owner);
  });

  const benchLine = /^const BENCH_ACCESS = (\{.*\});$/m.exec(gm);
  const benches = benchLine ? JSON.parse(benchLine[1]) : {};
  function bench(name) {
    return Object.keys(benches).map(function (k) { return benches[k]; }).filter(function (b) { return b.name === name; })[0];
  }
  yes("the smelter opens only for somebody who can make something there (#3080)", bench("CraftingSmelter") && !("anyone" in bench("CraftingSmelter")) && bench("CraftingSmelter").rows.length > 0);
  yes("the tanning rack opens only for somebody who can make something there", bench("CraftingTanningRack") && !("anyone" in bench("CraftingTanningRack")) && bench("CraftingTanningRack").rows.length > 0);
  yes("the forge opens only for somebody who can make something there", bench("CraftingSmithingForge") && !("anyone" in bench("CraftingSmithingForge")) && bench("CraftingSmithingForge").rows.length > 0);

  const onCraft = cut("mp.onCraft = guard('onCraft', function (actorId, craftedItemBaseId, count, recipeId, workbenchId) {") ||
    slice(gm, "mp.onCraft = guard('onCraft'", "desc === KEY_RECIPE");
  yes("onCraft asks craftRow instead of letting an unlisted smelt straight through",
    /const row = craftRow\(desc\);/.test(gm) && !/ingots, leather, tanning, smelting\. Straight through/.test(gm));
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
