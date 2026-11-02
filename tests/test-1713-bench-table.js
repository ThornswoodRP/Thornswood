// test-1713-bench-table.js
//
// #1713. scripts/dev/Build-BenchTable.py rewrites everything between the
// BENCH_ACCESS markers in game/gamemode.js. Three faults made a run unsafe:
//
// - The race gate (raceIndex, raceOf, RACE_CALLED, raceGate) sat inside those
//   markers, so a run deleted it, and craftAnswer calls raceGate.
// - It set a bench open for everybody only when the bench held a row nobody
//   owned. #1391 moved every cookpot row nobody owned into the refused map, so
//   a run shut the cookpot, which docs/systems/professions.md then called
//   open furniture. The page's open furniture became a knob, OPEN_FURNITURE.
// - It wrote both blocks with CRLF whatever the gamemode held, so on a
//   checkout that keeps LF a run left two CRLF blocks in an LF file. It then
//   took the gamemode's own ending; since #3029 .gitattributes checks the
//   gamemode out with LF everywhere, and both blocks are written LF.
//
// #1384 took the armour table out of the open furniture: tempering is cut, so
// it and the sharpening wheel are shut for everybody (SHUT_BENCHES, held by
// tests/test-1384-shut-benches.js).
//
// #3080 took the knob away. Patrick, 21 October: "An open bench opens only for
// somebody with at least one recipe there that they may make." Each bench
// carries its rows and benchGate asks craftAnswer of them. No bench opens for
// everybody: Patrick, asked about the smelter, "yes any bench or thing you can
// craft or do anything Proffesion or Trade related".
//
// Since #5191 the builder writes the two tables into their own files,
// game/gamemode-tables/BENCH_ACCESS.json and BENCH_BY_BASE.json, and never
// touches gamemode.js, so it cannot take the race gate with it again. This
// holds the gamemode's two table() lines and the race gate beside them, the
// table against the page and against game/data/recipes.json, and runs the
// builder against a small plugin made here into a tables folder of its own.
// Nothing outside a temporary folder is written.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8"); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}
function between(src, open, close) {
  const a = src.indexOf(open);
  const b = src.indexOf(close, a < 0 ? 0 : a);
  return a < 0 || b < 0 ? null : src.slice(a + open.length, b);
}

const GT = require('./gamemode-tables.js');
const gmText = read("game/gamemode.js").split(CR).join("");
const gm = GT.joined(gmText);
const py = read("scripts/dev/Build-BenchTable.py").split(CR).join("");
const page = read("docs/systems/professions.md").split(CR).join("");

// ---- the race gate is the gamemode's own, beside the tables -----------------
yes("the gamemode reads BENCH_ACCESS from its table file, once", gmText.split("const BENCH_ACCESS = table('BENCH_ACCESS');").length === 2);
yes("and BENCH_BY_BASE", gmText.split("const BENCH_BY_BASE = table('BENCH_BY_BASE');").length === 2);
["var raceIndex", "function raceOf(", "var RACE_CALLED", "function raceGate("].forEach(function (name) {
  yes(name + " is in the gamemode, once", gm.split(name).length === 2);
});
yes("craftAnswer still calls raceGate", /raceGate\(actorId, row\)/.test(gm.slice(gm.indexOf("const BENCH_ACCESS = "))));
yes("the builder writes the two tables into their files and nothing into gamemode.js",
  py.indexOf("'BENCH_ACCESS'") >= 0 && py.indexOf("'BENCH_BY_BASE'") >= 0 && py.indexOf("gamemode.js'") < 0);

// ---- no knob: a bench opens for anybody only on a row nobody owns ---------
yes("the builder has no OPEN_FURNITURE knob", py.indexOf("OPEN_FURNITURE") < 0);
yes("no bench opens for everybody: the builder writes no anyone and has no list of trades' benches",
  py.indexOf("'anyone'") < 0 && py.indexOf("TRADE_BENCHES") < 0);
yes("benchGate has no door for everybody", gm.indexOf("bench.anyone") < 0);
yes("a bench with no rows and no halves is shut for everybody before the character is read",
  /if \(!\(Array\.isArray\(bench\.rows\) && bench\.rows\.length\) && !Object\.keys\(halves\)\.length\) \{\s*return 'There is nothing anybody can make here\.';/.test(gm) &&
  gm.indexOf("There is nothing anybody can make here.") < gm.indexOf("const C = globalThis.__thornswoodCharacter;", gm.indexOf("function benchGate(")));
yes("benchGate asks craftAnswer of the bench's rows, and the row's trade tool (#3162)",
  /if \(Array\.isArray\(bench\.rows\)\) \{[\s\S]{0,200}craftRow\(bench\.rows\[i\]\)[\s\S]{0,100}!craftAnswer\(actorId, row\)\.refusal && toolFree\(benchToolKey\(row\)\)\) \{ return null; \}/.test(gm));

// The page's bench table: | Bench | Who |.
const rows = {};
const tbl = between(page, "| Bench | Who |", "\n\n") || "";
tbl.split("\n").forEach(function (l) {
  const m = /^\| ([^|]+?) \| ([^|]+?) \|$/.exec(l);
  if (m && m[1] !== "---") { rows[m[1]] = m[2]; }
});
yes("the professions page calls no bench open furniture", !/open furniture/i.test(page));

let ACCESS = null;
try { ACCESS = GT.table("BENCH_ACCESS"); } catch (e) { ACCESS = null; }
yes("BENCH_ACCESS parses", !!ACCESS);
function byName(n) {
  for (const k in (ACCESS || {})) { if (ACCESS[k].name === n) { return ACCESS[k]; } }
  return null;
}
const PAGE = {
  "Oven": "BYOHCraftingOven", "Cookpot": "CraftingCookpot", "Grain mill": "isGrainMill",
  "Charcoal kiln": "ThornswoodCraftingCharcoalKiln", "Alchemy lab": "the alchemy lab",
  "Arcane enchanter": "the arcane enchanter", "Staff enchanter": "DLC2StaffEnchanter",
  "Sharpening wheel": "CraftingSmithingSharpeningWheel", "Skyforge": "CraftingSmithingSkyforge",
  "Dawnguard bench": "DLC1CraftingDawnguard", "Forge": "CraftingSmithingForge",
  "Tanning rack": "CraftingTanningRack", "Loom": "MCE_CraftingLoom",
  "Armour table": "CraftingSmithingArmorTable", "Aetherium forge": "DLC1LD_CraftingForgeAetherium",
  "Smelter": "CraftingSmelter"
};
yes("every bench on the page is named here", Object.keys(rows).length === Object.keys(PAGE).length &&
  Object.keys(rows).every(function (p) { return !!PAGE[p]; }));
Object.keys(PAGE).forEach(function (p) {
  const b = byName(PAGE[p]);
  yes("the page names who the " + p.toLowerCase() + " opens for, and it is not anybody",
    !!rows[p] && !!b && !("anyone" in b) && !/^Anybody/.test(rows[p]));
});
yes("the cookpot is the Hearthcook's at novice and opens for nobody else",
  !!byName("CraftingCookpot") && !("anyone" in byName("CraftingCookpot")) &&
  JSON.stringify(byName("CraftingCookpot").halves) === '{"hearthcook":"novice"}' &&
  rows["Cookpot"] === "Hearthcook, from novice");

// The table in the gamemode against recipes.json: a bench opens for anybody
// exactly when it holds a row nobody owns and is neither shut nor a trade's
// bench, and it carries every row there that reaches the server.
let RECIPES = null;
try { RECIPES = JSON.parse(read("game/data/recipes.json")); } catch (e) { RECIPES = null; }
yes("game/data/recipes.json parses", !!RECIPES);
if (RECIPES && ACCESS) {
  const unownedAt = {};
  Object.keys(RECIPES.unowned).forEach(function (k) { unownedAt[RECIPES.unowned[k].benchName] = true; });
  const owned = {};
  Object.keys(RECIPES.recipes).forEach(function (k) { if (RECIPES.recipes[k].benchName) { owned[RECIPES.recipes[k].benchName] = true; } });
  const everybody = Object.keys(ACCESS).filter(function (k) { return "anyone" in ACCESS[k]; });
  yes("no bench in BENCH_ACCESS carries a door for everybody", everybody.length === 0);
  const holdsOnlyUnowned = Object.keys(ACCESS).filter(function (k) {
    const a = ACCESS[k];
    return !a.shut && unownedAt[a.name] && !owned[a.name];
  });
  yes("a bench that holds only rows nobody owns has no rows and no halves, so it opens for nobody",
    holdsOnlyUnowned.length > 0 && holdsOnlyUnowned.every(function (k) {
      return !ACCESS[k].rows && JSON.stringify(ACCESS[k].halves) === "{}";
    }));
  const rowsAt = {};
  Object.keys(RECIPES.recipes).forEach(function (d) {
    const r = RECIPES.recipes[d];
    if (r.bench && r.fires !== false) { (rowsAt[r.bench] = rowsAt[r.bench] || []).push(d); }
  });
  const badRows = Object.keys(ACCESS).filter(function (k) {
    const a = ACCESS[k];
    const want = a.shut ? [] : (rowsAt[k] || []).slice().sort();
    return JSON.stringify(a.rows || []) !== JSON.stringify(want);
  }).map(function (k) { return ACCESS[k].name; });
  yes("every bench carries exactly its rows that reach the server, sorted" +
    (badRows.length ? " (not: " + badRows.join(", ") + ")" : ""), badRows.length === 0);
  const lib = gm.slice(gm.indexOf("const KEPT_SMELT"), gm.indexOf("function craftRow("));
  const book = GT.table("RECIPES_BY_ID");
  const unresolved = [];
  Object.keys(ACCESS).forEach(function (k) {
    (ACCESS[k].rows || []).forEach(function (d) {
      if (!Object.prototype.hasOwnProperty.call(book, d) && lib.indexOf('"' + d + '"') < 0) { unresolved.push(d); }
    });
  });
  yes("every row a bench carries is one craftRow finds" + (unresolved.length ? " (not: " + unresolved.slice(0, 3).join(", ") + ")" : ""),
    unresolved.length === 0);
}

// ---- the builder, run ----------------------------------------------------
// A plugin with three keywords and three pieces of furniture: a cookpot and an
// oven by keyword, and an alchemy lab by its workbench type (5).
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1713-"));
try {
  const data = path.join(tmp, "Data");
  fs.mkdirSync(data);
  const skyrim = Buffer.concat([header(),
    grup("KYWD", [rec("KYWD", 0x800, [sub("EDID", z("CraftingCookpot"))]),
                  rec("KYWD", 0x801, [sub("EDID", z("BYOHCraftingOven"))])]),
    grup("FURN", [rec("FURN", 0x900, [sub("EDID", z("Cookpot01")), sub("KWDA", u32(0x800))]),
                  rec("FURN", 0x901, [sub("EDID", z("Oven01")), sub("KWDA", u32(0x801))]),
                  rec("FURN", 0x902, [sub("EDID", z("Lab01")), sub("WBDT", Buffer.from([5, 0]))])])]);
  fs.writeFileSync(path.join(data, "Skyrim.esm"), skyrim);
  ["Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"].forEach(function (m) {
    fs.writeFileSync(path.join(data, m), header());
  });
  const pluginsTxt = path.join(tmp, "plugins.txt");
  fs.writeFileSync(pluginsTxt, "# Automatically generated by Vortex\r\n");
  const recipes = path.join(tmp, "recipes.json");
  fs.writeFileSync(recipes, JSON.stringify({
    recipes: {
      "a1:Skyrim.esm": { bench: "800:Skyrim.esm", benchName: "CraftingCookpot", half: "Hearthcook", rank: "novice" },
      "a2:Skyrim.esm": { bench: "801:Skyrim.esm", benchName: "BYOHCraftingOven", half: "Confectioner", rank: "novice" }
    },
    unowned: {}
  }));

  const pyCmd = ["python", "python3"].filter(function (c) {
    const r = cp.spawnSync(c, ["--version"], { encoding: "utf8" });
    return !r.error && r.status === 0;
  })[0];
  yes("python is on this machine, so the bench builder can be run", !!pyCmd);
  function build(tables, table) {
    const r = cp.spawnSync(pyCmd, [path.join(REPO_DIR, "scripts", "dev", "Build-BenchTable.py"),
      "--data", data, "--plugins", pluginsTxt, "--recipes", table || recipes, "--tables", tables], { encoding: "utf8", timeout: 120000 });
    return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
  }
  function file(dir, name) { const f = path.join(dir, name + ".json"); return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""; }
  if (pyCmd) {
    // A tables folder of its own.
    const lf = path.join(tmp, "tables");
    fs.mkdirSync(lf);
    const r = build(lf);
    yes("a run writes both tables (exit " + r.code + ")", r.code === 0 && /wrote 3 furniture base\(s\)/.test(r.out));
    const after = file(lf, "BENCH_ACCESS") + file(lf, "BENCH_BY_BASE");
    yes("both table files are LF", !!file(lf, "BENCH_ACCESS") && !!file(lf, "BENCH_BY_BASE") && after.indexOf(CR) < 0);
    yes("and nothing else is written", fs.readdirSync(lf).sort().join(",") === "BENCH_ACCESS.json,BENCH_BY_BASE.json");
    let A = null;
    try { A = JSON.parse(file(lf, "BENCH_ACCESS")); } catch (e) { A = null; }
    yes("the cookpot holds no row nobody owns, so it opens only for its half",
      !!A && !!A["800:Skyrim.esm"] && !("anyone" in A["800:Skyrim.esm"]) &&
      JSON.stringify(A["800:Skyrim.esm"].halves) === '{"hearthcook":"novice"}');
    yes("the oven, which the page does not call open, stays shut",
      !!A && !!A["801:Skyrim.esm"] && !("anyone" in A["801:Skyrim.esm"]) &&
      JSON.stringify(A["801:Skyrim.esm"].halves) === '{"confectioner":"novice"}');
    yes("the alchemy lab is placed by its workbench type", !!A && !!A.alchemy && !("anyone" in A.alchemy));
    yes("no bench this plugin does not have is invented", !!A && Object.keys(A).length === 3);
    const r2 = build(lf);
    yes("a second run changes nothing", r2.code === 0 && file(lf, "BENCH_ACCESS") + file(lf, "BENCH_BY_BASE") === after);

    yes("the builder writes each bench's rows", !!A && JSON.stringify(A["800:Skyrim.esm"].rows) === '["a1:Skyrim.esm"]' &&
      JSON.stringify(A["801:Skyrim.esm"].rows) === '["a2:Skyrim.esm"]' && !A.alchemy.rows);

    // Table files from a checkout before .gitattributes, CRLF: written over LF.
    fs.writeFileSync(path.join(lf, "BENCH_ACCESS.json"), "{\r\n\"old\":1\r\n}\r\n");
    fs.writeFileSync(path.join(lf, "BENCH_BY_BASE.json"), "{\r\n\"old\":1\r\n}\r\n");
    const r3 = build(lf);
    yes("CRLF table files are written over LF", r3.code === 0 && file(lf, "BENCH_ACCESS") + file(lf, "BENCH_BY_BASE") === after);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
