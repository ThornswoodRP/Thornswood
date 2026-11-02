// test-1384-shut-benches.js
//
// #1384, part 3. Tempering is cut: a piece is mended with a repair kit
// (docs/systems/durability.md) and the temper rows are in the cut list, held
// so an event can bring one back. The sharpening wheel and the armour table
// carry nothing but temper rows, the engine throws every recipe at either out
// (CraftService RecipeItemsMatch, isTemper), and recipelessCraft refuses one
// that gets through. Yet both still opened Skyrim's crafting menu, which listed
// every piece you could temper, and only the pick was refused:
//
// - scripts/dev/Build-BenchTable.py counted the wheel's temper rows as
//   Edgewright and Woodwright work, so the wheel opened for them;
// - it carried the armour table as open furniture, on the premise "Tempering
//   never reaches the server", which stopped being true when the refusal
//   went in.
//
// The fix is in the generator, not a hide: SHUT_BENCHES writes both benches
// shut for everybody, with the sentence the gate says instead, and benchGate
// answers that sentence first, so mp.onActivate returns false and the menu
// never opens. Both stay in BENCH_BY_BASE, which recipelessCraft and TWO_HANDS
// still read, and the temper refusal stays behind them.
//
// This holds the knob, the generated table, the page, the gate run against
// the real table, and the builder run against a small plugin made here.
// Nothing outside a temporary folder is written.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}

const gm = require('./gamemode-tables.js').joined(read("game/gamemode.js"));
const py = read("scripts/dev/Build-BenchTable.py");
const page = read("docs/systems/professions.md");
const durability = read("docs/systems/durability.md");
const WHEEL = "88108:Skyrim.esm";
const TABLE = "adb78:Skyrim.esm";

// ---- the sentence: the gamemode's temper refusal, word for word -----------
const nt = /var noTemper = '([^']*)' \+\s*'([^']*)';/.exec(gm);
const SAYS = nt ? nt[1] + nt[2] : null;
yes("the temper refusal's sentence is in recipelessCraft", !!SAYS && /repair kit/.test(SAYS));
const ps = /SHUT_SAYS = \('([^']*)'\s*'([^']*)'\)/.exec(py);
yes("SHUT_SAYS in the builder is that sentence, word for word", !!ps && ps[1] + ps[2] === SAYS);

// ---- the knob ---------------------------------------------------------------
const knob = (/SHUT_BENCHES = \{([\s\S]*?)\n\}/.exec(py) || [])[1] || "";
yes("SHUT_BENCHES names the sharpening wheel", /'CraftingSmithingSharpeningWheel': SHUT_SAYS,/.test(knob));
yes("SHUT_BENCHES names the armour table", /'CraftingSmithingArmorTable': SHUT_SAYS,/.test(knob));
yes("SHUT_BENCHES names the Aetherium forge, with its own sentence (#3080)", /'DLC1LD_CraftingForgeAetherium': AETHERIUM_SAYS,/.test(knob));
yes("and nothing else", (knob.match(/^\s+'[^']+': /gm) || []).length === 3);
yes("no list of open furniture is left to call the armour table open (#3080)", py.indexOf("OPEN_FURNITURE") < 0);
const iShut = py.indexOf("for bname in sorted(SHUT_BENCHES):");
yes("the shut benches are written after the rows nobody owns, so none opens one again",
  iShut > py.indexOf("for row in unowned.values():"));
yes("a shut bench is written with no rows, no halves, and its sentence",
  /access\[bench\] = \{'name': bname, 'halves': \{\},\s*'shut': SHUT_BENCHES\[bname\]\}/.test(py.slice(iShut)));

// ---- the table in the gamemode ------------------------------------------------
let ACCESS = null, BY_BASE = null;
try { ACCESS = JSON.parse(/const BENCH_ACCESS = (\{.*\});/.exec(gm)[1]); } catch (e) { ACCESS = null; }
try { BY_BASE = JSON.parse(/const BENCH_BY_BASE = (\{.*\});/.exec(gm)[1]); } catch (e) { BY_BASE = null; }
yes("BENCH_ACCESS and BENCH_BY_BASE parse", !!ACCESS && !!BY_BASE);
[[WHEEL, "the sharpening wheel"], [TABLE, "the armour table"]].forEach(function (b) {
  const row = ACCESS && ACCESS[b[0]];
  yes(b[1] + " is in BENCH_ACCESS, shut, with nobody let in",
    !!row && !row.rows && JSON.stringify(row.halves) === "{}" && row.shut === SAYS);
  const bases = Object.keys(BY_BASE || {}).filter(function (k) { return BY_BASE[k] === b[0]; });
  yes(b[1] + " is still in BENCH_BY_BASE, which recipelessCraft and TWO_HANDS read", bases.length > 0);
});
const shutRows = Object.keys(ACCESS || {}).filter(function (k) { return ACCESS[k].shut; });
yes("no other bench is shut but the Aetherium forge (#3080)", shutRows.length === 3 &&
  shutRows.some(function (k) { return ACCESS[k].name === "DLC1LD_CraftingForgeAetherium" && ACCESS[k].shut === "Nobody works the Aetherium forge."; }));
yes("the forge is not shut, so the fix closed only the temper benches",
  Object.keys(ACCESS || {}).some(function (k) { return ACCESS[k].name === "CraftingSmithingForge" && !ACCESS[k].shut && (ACCESS[k].rows || []).length > 0; }));

// ---- the gate, run against the real table ---------------------------------
const gs = gm.indexOf("function benchGate(actorId, baseDesc) {");
const ge = gm.indexOf("\n}\n", gs);
const gateSrc = gs < 0 || ge < 0 ? "" : gm.slice(gs, ge + 2);
yes("benchGate answers a shut bench's sentence before it reads the character",
  gateSrc.indexOf("if (bench.shut) { return String(bench.shut); }") > 0 &&
  gateSrc.indexOf("if (bench.anyone)") < 0 &&
  gateSrc.indexOf("if (bench.shut)") < gateSrc.indexOf("__thornswoodCharacter"));
function gateWith(character, progression) {
  const g = { __thornswoodCharacter: character, __thornswoodProgression: progression };
  // craftRow and craftAnswer are the gamemode's; here every row is one this
  // master smith may make.
  const make = new Function("BENCH_BY_BASE", "BENCH_ACCESS", "globalThis", "log", "NO_PROFESSION_AT_A_BENCH", "rankWord",
    "craftRow", "craftAnswer", "benchToolKey", "toolGate", "professionOfHalf", gateSrc + "\nreturn benchGate;");
  return make(BY_BASE, ACCESS, g, function () {}, "NO PROFESSION", function (r) { return r; },
    function () { return {}; }, function () { return { refusal: null }; },
    // No tool asked here: these rows are nobody's trade's (#3162).
    function () { return ''; }, function () { return null; }, function () { return ''; });
}
const MASTER = { prof: "smith", half: "edgewright", ranks: { edgewright: "master", platewright: "master" } };
const C = { stateOf: function () { return MASTER; }, nameOf: function (h) { return h; } };
const P = { canWork: function () { return true; } };
let gate = null;
try { gate = gateWith(C, P); } catch (e) { gate = null; }
yes("benchGate can be run out of the gamemode", typeof gate === "function");
if (gate) {
  [[WHEEL, "the sharpening wheel"], [TABLE, "the armour table"]].forEach(function (b) {
    Object.keys(BY_BASE).filter(function (k) { return BY_BASE[k] === b[0]; }).forEach(function (base) {
      yes("a master smith pressing " + b[1] + " (" + base + ") is told why and it does not open", gate(0x14, base) === SAYS);
    });
  });
  const unloaded = gateWith(undefined, undefined);
  yes("with the character block not loaded, the wheel is still shut: it is the same answer for everybody",
    unloaded(0x14, Object.keys(BY_BASE).filter(function (k) { return BY_BASE[k] === WHEEL; })[0]) === SAYS);
  const forge = Object.keys(BY_BASE).filter(function (k) { return ACCESS[BY_BASE[k]] && ACCESS[BY_BASE[k]].name === "CraftingSmithingForge"; })[0];
  yes("a forge still opens for that smith", !!forge && gate(0x14, forge) === null);
  // #3080: somebody craftAnswer refuses every forge row is told so and the
  // forge does not open, whatever halves canWork would have said.
  const refusedAll = new Function("BENCH_BY_BASE", "BENCH_ACCESS", "globalThis", "log", "NO_PROFESSION_AT_A_BENCH", "rankWord",
    "craftRow", "craftAnswer", "benchToolKey", "toolGate", "professionOfHalf", gateSrc + "\nreturn benchGate;")(BY_BASE, ACCESS,
    { __thornswoodCharacter: C, __thornswoodProgression: P }, function () {}, "NO PROFESSION", function (r) { return r; },
    function () { return {}; }, function () { return { refusal: "no" }; },
    function () { return ''; }, function () { return null; }, function () { return ''; });
  const said = forge ? refusedAll(0x14, forge) : null;
  yes("a forge does not open for somebody who may make none of its rows", typeof said === "string" && /^There is nothing you can make here\./.test(said));
}

// ---- onActivate refuses on the gate's answer, and the refusal stays behind it
const act = gm.slice(gm.indexOf("mp.onActivate = guard('onActivate'"));
yes("mp.onActivate returns false on the gate's sentence, so the crafting menu never opens",
  /const shut = benchGate\(casterRefrId, baseDesc\);\s*if \(shut\) \{\s*notify\(casterRefrId, shut\);\s*say\(casterRefrId, shut\);\s*return false;\s*\}/.test(act));
yes("recipelessCraft still refuses a temper that reaches it anyway",
  /var tempering = benchKey === '88108:Skyrim\.esm' \|\| benchKey === 'adb78:Skyrim\.esm';/.test(gm) &&
  /if \(tempering\) \{[\s\S]*?return false;\s*\}/.test(gm));

// ---- the pages ----------------------------------------------------------
yes("the professions page shuts the sharpening wheel for everybody",
  page.indexOf("| Sharpening wheel | Shut for everybody. Tempering is cut, and a piece is mended with a repair kit |") >= 0);
yes("and the armour table", page.indexOf("| Armour table | Shut for everybody. Tempering is cut, and a piece is mended with a repair kit |") >= 0);
yes("the page no longer says tempering never reaches the server", page.indexOf("Tempering never reaches the server") < 0);
yes("durability.md says neither bench opens, and the menu never comes up",
  /The grindstone and the armour table do not open, for anybody\./.test(durability) &&
  /crafting menu never comes up/.test(durability.split("\n").join(" ")));

// ---- the builder, run ----------------------------------------------------
function sub(tag, body) {
  const h = Buffer.alloc(6); h.write(tag, 0, "ascii"); h.writeUInt16LE(body.length, 4);
  return Buffer.concat([h, body]);
}
function rec(tag, fid, subs) {
  const body = Buffer.concat(subs);
  const h = Buffer.alloc(24); h.write(tag, 0, "ascii"); h.writeUInt32LE(body.length, 4); h.writeUInt32LE(fid, 12);
  return Buffer.concat([h, body]);
}
function grup(label, recs) {
  const body = Buffer.concat(recs);
  const h = Buffer.alloc(24); h.write("GRUP", 0, "ascii"); h.writeUInt32LE(body.length + 24, 4); h.write(label, 8, "ascii");
  return Buffer.concat([h, body]);
}
function z(s) { return Buffer.from(s + "\0", "ascii"); }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n, 0); return b; }
function header() {
  const hedr = Buffer.alloc(12); hedr.writeFloatLE(1.7, 0);
  return rec("TES4", 0, [sub("HEDR", hedr)]);
}
const pyCmd = ["python", "python3"].filter(function (c) {
  const r = cp.spawnSync(c, ["--version"], { encoding: "utf8" });
  return !r.error && r.status === 0;
})[0];
yes("python is on this machine, so the bench builder can be run", !!pyCmd);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1384-"));
try {
  const data = path.join(tmp, "Data");
  fs.mkdirSync(data);
  // The wheel, the armour table and a forge, each a keyword and a piece of
  // furniture carrying it, at the real form ids.
  const skyrim = Buffer.concat([header(),
    grup("KYWD", [rec("KYWD", 0x88108, [sub("EDID", z("CraftingSmithingSharpeningWheel"))]),
                  rec("KYWD", 0xadb78, [sub("EDID", z("CraftingSmithingArmorTable"))]),
                  rec("KYWD", 0x88105, [sub("EDID", z("CraftingSmithingForge"))])]),
    grup("FURN", [rec("FURN", 0x900, [sub("EDID", z("Wheel01")), sub("KWDA", u32(0x88108))]),
                  rec("FURN", 0x901, [sub("EDID", z("ArmorTable01")), sub("KWDA", u32(0xadb78))]),
                  rec("FURN", 0x902, [sub("EDID", z("Forge01")), sub("KWDA", u32(0x88105))])])]);
  fs.writeFileSync(path.join(data, "Skyrim.esm"), skyrim);
  ["Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"].forEach(function (m) {
    fs.writeFileSync(path.join(data, m), header());
  });
  const pluginsTxt = path.join(tmp, "plugins.txt");
  fs.writeFileSync(pluginsTxt, "# Automatically generated by Vortex\r\n");
  const recipes = path.join(tmp, "recipes.json");
  // Owned temper rows at both benches and a row nobody owns at the armour
  // table: every way the old builder opened one.
  fs.writeFileSync(recipes, JSON.stringify({
    recipes: {
      "b1:Skyrim.esm": { bench: WHEEL, benchName: "CraftingSmithingSharpeningWheel", half: "Edgewright", rank: "novice", fires: false },
      "b2:Skyrim.esm": { bench: WHEEL, benchName: "CraftingSmithingSharpeningWheel", half: "Woodwright", rank: "novice", fires: false },
      "b3:Skyrim.esm": { bench: TABLE, benchName: "CraftingSmithingArmorTable", half: "Platewright", rank: "novice", fires: false },
      "b4:Skyrim.esm": { bench: "88105:Skyrim.esm", benchName: "CraftingSmithingForge", half: "Edgewright", rank: "novice", fires: true }
    },
    unowned: {
      "b5:Skyrim.esm": { benchName: "CraftingSmithingArmorTable", why: "the recipe carries no CNAM" }
    }
  }));
  // The gamemode's tables, a folder of their own (#5191).
  const tablesDir = path.join(tmp, "gamemode-tables");
  fs.mkdirSync(tablesDir);
  function tablesText() { return fs.readdirSync(tablesDir).sort().map(function (n) { return n + "\n" + fs.readFileSync(path.join(tablesDir, n), "utf8"); }).join("\n"); }
  function tableOf(n) { try { return JSON.parse(fs.readFileSync(path.join(tablesDir, n + ".json"), "utf8")); } catch (e) { return null; } }
  function build() {
    const r = cp.spawnSync(pyCmd, [path.join(REPO_DIR, "scripts", "dev", "Build-BenchTable.py"),
      "--data", data, "--plugins", pluginsTxt, "--recipes", recipes, "--tables", tablesDir], { encoding: "utf8", timeout: 120000 });
    return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
  }
  if (pyCmd) {
    const r = build();
    yes("a run writes both tables (exit " + r.code + ")", r.code === 0 && /wrote 3 furniture base\(s\)/.test(r.out));
    const after = tablesText();
    const A = tableOf("BENCH_ACCESS"), B = tableOf("BENCH_BY_BASE");
    yes("the wheel's temper rows no longer open it for the Edgewright or the Woodwright",
      !!A && !!A[WHEEL] && !A[WHEEL].rows && JSON.stringify(A[WHEEL].halves) === "{}" && A[WHEEL].shut === SAYS);
    yes("the armour table's owned temper row and the row nobody owns no longer open it",
      !!A && !!A[TABLE] && !A[TABLE].rows && JSON.stringify(A[TABLE].halves) === "{}" && A[TABLE].shut === SAYS);
    yes("both benches' furniture is still in BENCH_BY_BASE",
      !!B && B["900:Skyrim.esm"] === WHEEL && B["901:Skyrim.esm"] === TABLE);
    yes("the forge is untouched: it opens for whoever may make one of its rows (#3080)",
      !!A && !!A["88105:Skyrim.esm"] && !("anyone" in A["88105:Skyrim.esm"]) && !A["88105:Skyrim.esm"].shut &&
      JSON.stringify(A["88105:Skyrim.esm"].halves) === '{"edgewright":"novice"}');
    yes("the run says both benches are shut", /CraftingSmithingArmorTable\s+adb78:Skyrim\.esm\s+shut/.test(r.out) &&
      /CraftingSmithingSharpeningWheel\s+88108:Skyrim\.esm\s+shut/.test(r.out));
    const r2 = build();
    yes("a second run changes nothing", r2.code === 0 && tablesText() === after);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
