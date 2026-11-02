// test-1766-fishing-mod-poles.js
//
// #1766. The fishing mod's three pole recipes (FishingInSkyrim.esp) stayed in
// the Woodwright's open book beside the three poles Thornswood-Content.esp
// makes, because the first cut pass kept them by name before ours existed.
// docs/systems/classes/fisher.md: "The fishing mod's rows are not the plan" and
// "The master pole does not take dragon bone", and TOOLS.fisher.accept takes
// only our three, so a mod pole made at the forge did not fish.
//
// They are cut now through CUT_SINCE in scripts/dev/Write-CutItems.js, the
// recipe table is rebuilt from the cut file, and the Woodwright's pages list
// only poles that fish. This holds all of that, and runs Write-CutItems.js in
// a temporary copy to show a later cut is added once and only once.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const vm = require("vm");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}

const MOD = ["1f24f:FishingInSkyrim.esp", "2180d:FishingInSkyrim.esp", "1f252:FishingInSkyrim.esp"];
const OURS = ["1549c:Thornswood-Content.esp", "1549d:Thornswood-Content.esp", "1549e:Thornswood-Content.esp"];
const recipes = JSON.parse(read("game/data/recipes.json"));
const cutDoc = JSON.parse(read("docs/systems/cut-items.json"));
const cutById = {};
cutDoc.items.forEach(function (i) { cutById[i.id] = i; });
const gm = require('./gamemode-tables.js').joined(read("game/gamemode.js"));

// ---- the cut file and the recipe table -----------------------------------
MOD.forEach(function (id) {
  const r = recipes.recipes[id];
  yes(id + " (" + (r ? r.name : "missing") + ") is in the cut file as cut, saying why",
    !!cutById[id] && cutById[id].disposition === "cut" && /fishing mod's pole/.test(cutById[id].why) && /#1766/.test(cutById[id].why));
  yes("  and recipes.json carries it out of the open book, its owner kept",
    !!r && r.book === "cut" && r.owner === "Woodworker" && r.half === "Woodwright");
});
yes("the master pole's reason says it asked for dragon bone, which is cut",
  !!cutById["1f252:FishingInSkyrim.esp"] && /dragon bone, which is cut/.test(cutById["1f252:FishingInSkyrim.esp"].why));
OURS.concat(["1549f:Thornswood-Content.esp"]).forEach(function (id) {
  const r = recipes.recipes[id];
  yes((r ? r.name : id) + " stays in the open book", !!r && !r.book && !cutById[id]);
});
yes("the cut file's counts are its items", cutDoc.counts.cut === cutDoc.items.filter(function (i) { return i.disposition === "cut"; }).length);

// ---- the gamemode ----------------------------------------------------------
const a = gm.indexOf("\nconst TOOLS = {"), b = gm.indexOf("\n};\n", a);
const box = {};
vm.runInNewContext(gm.slice(a, b + 3).replace("const TOOLS", "TOOLS"), box);
const accept = box.TOOLS && box.TOOLS.fisher ? box.TOOLS.fisher.accept : [];
const outs = OURS.map(function (id) { return recipes.recipes[id].out; });
yes("the poles that fish are what our three recipes make", accept.slice().sort().join() === outs.slice().sort().join());
const BOOK = require('./gamemode-tables.js').table('RECIPES_BY_ID');
const FUEL = require('./gamemode-tables.js').table('FUEL_BY_RECIPE');
MOD.forEach(function (id) {
  yes("RECIPES_BY_ID refuses " + id + " as cut", !!BOOK[id] && /^Cut from the open book/.test(BOOK[id].nobody || ""));
  yes("  and FUEL_BY_RECIPE no longer burns charcoal for it", !Object.prototype.hasOwnProperty.call(FUEL, id));
});

// ---- the Woodwright's pages list only poles that fish -----------------------
const fishing = {};
OURS.forEach(function (id) { fishing[recipes.recipes[id].name] = true; });
["docs/systems/professions/woodworker/woodwright.md", "docs/systems/lists/woodworker-woodwright.md"].forEach(function (rel) {
  const page = read(rel);
  const poles = (page.match(/\| ([^|]*Fishing Pole[^|]*) \|/g) || []).map(function (m) { return m.slice(2, -2).trim(); });
  yes(rel + " lists our three poles and no other (" + poles.join(", ") + ")",
    poles.length === 3 && poles.every(function (p) { return fishing[p]; }));
  yes("  and not the fishing mod's", !/Fishing Pole - /.test(page) && page.indexOf("FishingInSkyrim.esp`") < 0);
});
yes("the fisher page says the mod's pole recipes are cut", /its three pole recipes are cut/.test(read("docs/systems/classes/fisher.md").replace(/\s+/g, " ")));

// ---- a later cut is added once ---------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1766-"));
try {
  fs.mkdirSync(path.join(tmp, "scripts", "dev"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "game", "data"), { recursive: true });
  fs.mkdirSync(path.join(tmp, "docs", "systems"), { recursive: true });
  fs.copyFileSync(path.join(REPO_DIR, "scripts", "dev", "Write-CutItems.js"), path.join(tmp, "scripts", "dev", "Write-CutItems.js"));
  fs.copyFileSync(path.join(REPO_DIR, "game", "data", "recipes.json"), path.join(tmp, "game", "data", "recipes.json"));
  // The cut file as it was before #1766: the three poles not in it, and the
  // first pass's kept count.
  const before = JSON.parse(JSON.stringify(cutDoc));
  before.items = before.items.filter(function (i) { return MOD.indexOf(i.id) < 0; });
  before.counts.cut -= 3;
  before.counts.kept += 3;
  fs.writeFileSync(path.join(tmp, "docs", "systems", "cut-items.json"), JSON.stringify(before, null, 2) + "\n");
  fs.writeFileSync(path.join(tmp, "docs", "systems", "cut-items.md"), "old\n");
  // and the rows it left in the open book, the three poles among them (#4087).
  const keptBefore = JSON.parse(read("docs/systems/cut-kept.json"));
  keptBefore.ids = keptBefore.ids.concat(MOD).sort();
  fs.writeFileSync(path.join(tmp, "docs", "systems", "cut-kept.json"), JSON.stringify(keptBefore, null, 2) + "\n");
  const run = function () {
    return cp.spawnSync(process.execPath, [path.join(tmp, "scripts", "dev", "Write-CutItems.js")], { encoding: "utf8", timeout: 120000 });
  };
  const r1 = run();
  const after = JSON.parse(fs.readFileSync(path.join(tmp, "docs", "systems", "cut-items.json"), "utf8"));
  yes("on a cut table, CUT_SINCE adds the three poles the file did not have (exit " + r1.status + ")",
    r1.status === 0 && (r1.stdout.match(/cut since the first pass, added/g) || []).length === 3 &&
    MOD.every(function (id) { return after.items.some(function (i) { return i.id === id && i.disposition === "cut"; }); }));
  yes("  the cut count goes up by three and the kept count down by three",
    after.counts.cut === before.counts.cut + 3 && after.counts.kept === before.counts.kept - 3);
  yes("  and the result is the cut file in the repository", JSON.stringify(after) === JSON.stringify(cutDoc));
  const once = fs.readFileSync(path.join(tmp, "docs", "systems", "cut-items.json"), "utf8");
  const r2 = run();
  yes("a second run adds nothing", r2.status === 0 && !/added/.test(r2.stdout) &&
    fs.readFileSync(path.join(tmp, "docs", "systems", "cut-items.json"), "utf8") === once);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
