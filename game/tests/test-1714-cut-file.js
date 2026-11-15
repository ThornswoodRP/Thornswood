// test-1714-cut-file.js
//
// #1714. scripts/dev/Write-CutItems.js sorted the recipe table into
// docs/systems/cut-items.json once, before anything was cut (#1391). Since
// #1622 Build-RecipeTable.ps1 reads that file and writes a table that is
// already cut, and the script's rules read such a table wrongly: cut rows
// nobody owned are in the refused map now, and the rows kept after the first
// pass have owners. Run on the table of 5 October it wrote 3107 cut instead of
// 3318, and cut 20 kept rows (the smelt and leather rows, the kits, the poles
// and the trap). A recipe build after it would have put 231 rows back in the
// open book.
//
// The script now starts from the cut file it has on a table that is already
// cut. This runs it in a temporary copy of the folders it reads and writes,
// so the repository is never written.
const REPO_DIR = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}

const SCRIPT = fs.readFileSync(path.join(REPO_DIR, "scripts", "dev", "Write-CutItems.js"), "utf8");
const TABLE = fs.readFileSync(path.join(REPO_DIR, "game", "data", "recipes.json"), "utf8");
const CUT_JSON = fs.readFileSync(path.join(REPO_DIR, "docs", "systems", "cut-items.json"), "utf8");
const CUT_MD = fs.readFileSync(path.join(REPO_DIR, "docs", "systems", "cut-items.md"), "utf8");
const KEPT_JSON = fs.readFileSync(path.join(REPO_DIR, "docs", "systems", "cut-kept.json"), "utf8");

// A folder laid out the way the script expects, with what it reads.
function sandbox(table, cutJson, cutMd, keptJson) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1714-"));
  fs.mkdirSync(path.join(root, "scripts", "dev"), { recursive: true });
  fs.mkdirSync(path.join(root, "game", "data"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "systems"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "dev", "Write-CutItems.js"), SCRIPT);
  fs.writeFileSync(path.join(root, "game", "data", "recipes.json"), typeof table === "string" ? table : JSON.stringify(table));
  if (cutJson !== null) { fs.writeFileSync(path.join(root, "docs", "systems", "cut-items.json"), cutJson); }
  if (cutMd !== null) { fs.writeFileSync(path.join(root, "docs", "systems", "cut-items.md"), cutMd); }
  if (keptJson) { fs.writeFileSync(path.join(root, "docs", "systems", "cut-kept.json"), keptJson); }
  return root;
}
function run(root) {
  const r = cp.spawnSync(process.execPath, [path.join(root, "scripts", "dev", "Write-CutItems.js")], { encoding: "utf8", timeout: 120000 });
  return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
}
function readOut(root, name) {
  const f = path.join(root, "docs", "systems", name);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
}
const roots = [];
function box(a, b, c, d) { const r = sandbox(a, b, c, d); roots.push(r); return r; }

try {
  // ---- today's table, which is cut ----------------------------------------
  const table = JSON.parse(TABLE);
  const cut = JSON.parse(CUT_JSON);
  const cutIds = {};
  cut.items.forEach(function (i) { cutIds[i.id] = i; });
  const ownedCut = Object.keys(table.recipes).filter(function (id) { return table.recipes[id].book === "cut"; }).length;
  const refusedCut = Object.keys(table.refused).filter(function (id) { return !!cutIds[id]; }).length;
  yes("today's recipe table is cut: " + ownedCut + " owned rows out of the open book, " + refusedCut + " refused rows the cut file names",
    ownedCut > 0 && refusedCut > 0);

  const today = box(TABLE, CUT_JSON, CUT_MD, KEPT_JSON);
  const r = run(today);
  yes("a run on today's table exits 0", r.code === 0);
  yes("it says it started from the cut file", /already cut, so the list is the one docs\/systems\/cut-items\.json has/.test(r.out));
  yes("cut-items.json is written back byte for byte", readOut(today, "cut-items.json") === CUT_JSON);
  yes("cut-items.md is written back byte for byte", readOut(today, "cut-items.md") === CUT_MD);
  yes("and so is cut-kept.json", readOut(today, "cut-kept.json") === KEPT_JSON);
  yes("the counts are the file's: cut " + cut.counts.cut + ", embassy " + cut.counts.embassy + ", thalmor " + cut.counts.thalmor + ", kept " + cut.counts.kept,
    r.out.indexOf("cut " + cut.counts.cut + " embassy " + cut.counts.embassy + " thalmor " + cut.counts.thalmor + " kept " + cut.counts.kept) >= 0 &&
    cut.counts.cut === cut.items.filter(function (i) { return i.disposition === "cut"; }).length);
  const r2 = run(today);
  yes("a second run changes nothing", r2.code === 0 && readOut(today, "cut-items.json") === CUT_JSON && readOut(today, "cut-items.md") === CUT_MD);

  // Every row the rules got wrong on 5 October is still where the file puts it.
  const refusedNow = Object.keys(table.refused).filter(function (id) { return !!cutIds[id]; });
  const back = JSON.parse(readOut(today, "cut-items.json"));
  const backIds = {};
  back.items.forEach(function (i) { backIds[i.id] = true; });
  yes("the " + refusedNow.length + " cut rows now in the refused map stay in the cut file",
    refusedNow.every(function (id) { return backIds[id]; }));
  const keptOwned = ["154b4:Thornswood-Content.esp", "a30c3:Skyrim.esm", "f7f43:Skyrim.esm", "1549c:Thornswood-Content.esp", "1549f:Thornswood-Content.esp"];
  yes("the kept rows that have owners now (Armor Kit, Iron Ingot, Leather Strips, Crude Fishing Pole, Fish Trap) are not cut",
    keptOwned.every(function (id) { return !!table.recipes[id] && !table.recipes[id].book && !backIds[id]; }));

  // A checkout from before .gitattributes (#3029) held both files with CRLF;
  // they are written back LF, the way every checkout holds them now.
  const lfJson = CUT_JSON.split("\r\n").join("\n");
  const lfMd = CUT_MD.split("\r\n").join("\n");
  const crlfJson = lfJson.split("\n").join("\r\n");
  const crlfMd = lfMd.split("\n").join("\r\n");
  const win = box(TABLE, crlfJson, crlfMd, KEPT_JSON);
  const rw = run(win);
  yes("a CRLF checkout's files are written back as the same text in LF",
    rw.code === 0 && readOut(win, "cut-items.json") === lfJson && readOut(win, "cut-items.md") === lfMd);
  const lin = box(TABLE, lfJson, lfMd, KEPT_JSON);
  const rl = run(lin);
  yes("an LF checkout's files are written back byte for byte, LF kept",
    rl.code === 0 && readOut(lin, "cut-items.json") === lfJson && readOut(lin, "cut-items.md") === lfMd);

  // ---- rows a plugin adds to a cut table (#4087) ---------------------------
  // Collection revision 5 brought Cheddar's Mashups' tempers and Wamsu Bone
  // Armor, which asks for Dragon Bone, into the open book: the script replayed
  // the cut file and never looked at them.
  const keptNow = JSON.parse(KEPT_JSON);
  const keptSet = new Set(keptNow.ids);
  const model = Object.keys(table.recipes).map(function (id) { return table.recipes[id]; }).filter(function (row) {
    return row.fires === true && !row.book && !row.roll && row.half === "Edgewright";
  })[0];
  function newRow(over) { return Object.assign(JSON.parse(JSON.stringify(model)), { plugin: "New.esp" }, over); }
  const grown = JSON.parse(TABLE);
  grown.recipes["901:New.esp"] = newRow({ name: "New Steel Sword", fires: false, benchName: "CraftingSmithingSharpeningWheel", editorId: "TemperNewSword" });
  grown.recipes["902:New.esp"] = newRow({ name: "Wamsu Bone Cuirass", out: "a02:New.esp",
    inputItems: [{ item: "3ada4:Skyrim.esm", name: "Dragon Bone", type: "MISC", count: 2 }] });
  grown.recipes["903:New.esp"] = newRow({ name: "Imperial Travel Cloak", out: "a03:New.esp" });
  grown.recipes["904:New.esp"] = newRow({ name: "Hunter's Long Coat", out: "a04:New.esp" });
  grown.unowned["905:New.esp"] = Object.assign({}, model, { name: "Dragonsteel Ingot", out: "a05:New.esp", benchName: "CraftingSmelter", plugin: "New.esp" });
  const newIds = ["901:New.esp", "902:New.esp", "903:New.esp", "904:New.esp", "905:New.esp"];
  yes("the five new rows are in neither file", !!model && newIds.every(function (id) { return !cutIds[id] && !keptSet.has(id); }));
  const g = box(JSON.stringify(grown), CUT_JSON, CUT_MD, KEPT_JSON);
  const rg = run(g);
  let gCut = null, gKept = null;
  try { gCut = JSON.parse(readOut(g, "cut-items.json")); gKept = JSON.parse(readOut(g, "cut-kept.json")); } catch (e) { gCut = null; }
  const gDisp = {};
  ((gCut && gCut.items) || []).forEach(function (i) { gDisp[i.id] = i; });
  yes("a run on a cut table with new rows exits 0 and names them", rg.code === 0 && /5 new row\(s\) sorted: 4 into this file, 1 left as they are/.test(rg.out));
  yes("the new temper is cut", !!gDisp["901:New.esp"] && gDisp["901:New.esp"].disposition === "cut" && /^Temper/.test(gDisp["901:New.esp"].why));
  yes("the new recipe that asks for Dragon Bone is cut, and says so",
    !!gDisp["902:New.esp"] && gDisp["902:New.esp"].disposition === "cut" && /^Asks for Dragon Bone, which this file cuts/.test(gDisp["902:New.esp"].why));
  yes("the new Imperial piece goes to the embassy roll", !!gDisp["903:New.esp"] && gDisp["903:New.esp"].disposition === "embassy");
  yes("the new dragon smelt nobody owns is cut", !!gDisp["905:New.esp"] && gDisp["905:New.esp"].disposition === "cut");
  yes("the new ordinary piece stays in the open book and goes in cut-kept.json",
    !gDisp["904:New.esp"] && !!gKept && gKept.ids.indexOf("904:New.esp") >= 0 && gKept.ids.length === keptNow.ids.length + 1);
  yes("every row the file had before stays as it was",
    cut.items.every(function (i) { return !!gDisp[i.id] && gDisp[i.id].disposition === i.disposition && gDisp[i.id].why === i.why; }) &&
    gCut.items.length === cut.items.length + 4);
  yes("the counts take them in: cut " + (cut.counts.cut + 3) + ", embassy " + (cut.counts.embassy + 1) + ", kept still " + cut.counts.kept,
    gCut.counts.cut === cut.counts.cut + 3 && gCut.counts.embassy === cut.counts.embassy + 1 && gCut.counts.thalmor === cut.counts.thalmor &&
    gCut.counts.kept === cut.counts.kept);
  const gJson = readOut(g, "cut-items.json"), gMd = readOut(g, "cut-items.md"), gKj = readOut(g, "cut-kept.json");
  const rg2 = run(g);
  yes("a second run on it changes nothing and finds nothing new",
    rg2.code === 0 && !/new row/.test(rg2.out) && readOut(g, "cut-items.json") === gJson && readOut(g, "cut-items.md") === gMd && readOut(g, "cut-kept.json") === gKj);
  const blind = box(JSON.stringify(grown), CUT_JSON, CUT_MD, null);
  const rb = run(blind);
  yes("new rows with no cut-kept.json to tell them apart stop (exit 1) and write nothing",
    rb.code === 1 && /STOP\. There is no docs\/systems\/cut-kept\.json/.test(rb.out) && readOut(blind, "cut-items.json") === CUT_JSON && readOut(blind, "cut-kept.json") === null);

  // ---- a cut table with no cut file ---------------------------------------
  const lost = box(TABLE, null, null);
  const r3 = run(lost);
  yes("a cut table with no cut file to start from stops (exit 1)", r3.code === 1 && /STOP\./.test(r3.out));
  yes("and writes nothing", readOut(lost, "cut-items.json") === null && readOut(lost, "cut-items.md") === null);

  // ---- a table cut only by a roll, or only by the refused map, is cut -----
  const rolled = { recipes: { "1:A.esp": { name: "Imperial Helmet", owner: "Smith", half: "Platewright", rank: "novice", roll: "embassy" } }, unowned: {}, refused: {} };
  const rr = run(box(rolled, null, null));
  yes("an owned row on a roll makes the table cut", rr.code === 1 && /STOP\./.test(rr.out));
  const refusedOnly = { recipes: {}, unowned: {}, refused: { "2:A.esp": { name: "Dwarven Metal Ingot", why: "x" } } };
  const cutNaming = JSON.stringify({ builtFrom: "x", note: "x", counts: { cut: 1, embassy: 0, thalmor: 0, kept: 7 }, rieklingKept: [],
    items: [{ id: "2:A.esp", name: "Dwarven Metal Ingot", plugin: "A.esp", half: "", owner: "", family: "", rank: "", fires: true, disposition: "cut", why: "Duplicate smelt or tan row for Dwarven Metal Ingot. One row stays." }] }, null, 2) + "\n";
  const ro = box(refusedOnly, cutNaming, "old\n");
  const r4 = run(ro);
  let kept4 = null;
  try { kept4 = JSON.parse(readOut(ro, "cut-items.json")); } catch (e) { kept4 = null; }
  yes("a refused row the cut file names makes the table cut, and the file's list and counts are kept",
    r4.code === 0 && !!kept4 && JSON.stringify(kept4.items) === JSON.stringify(JSON.parse(cutNaming).items) &&
    JSON.stringify(kept4.counts) === JSON.stringify(JSON.parse(cutNaming).counts) && /kept 7/.test(r4.out));

  // ---- a table with nothing cut is still sorted by the rules --------------
  const uncut = {
    recipes: {
      "10:A.esp": { name: "Iron Sword", family: "Swords", owner: "Smith", half: "Edgewright", rank: "novice", fires: true },
      "11:A.esp": { name: "Daedric Sword", family: "Swords", owner: "Smith", half: "Edgewright", rank: "master", fires: true },
      "12:A.esp": { name: "Cutlass", family: "Swords", owner: "Smith", half: "Edgewright", rank: "novice", fires: true }
    },
    unowned: {}, refused: {}
  };
  const fresh = box(uncut, null, null);
  const r5 = run(fresh);
  const made = readOut(fresh, "cut-items.json");
  let doc = null;
  try { doc = JSON.parse(made); } catch (e) { doc = null; }
  const disp = {};
  ((doc && doc.items) || []).forEach(function (i) { disp[i.id] = i.disposition; });
  yes("on a table with nothing cut the rules still sort it (exit 0)", r5.code === 0 && !!doc);
  yes("the rules cut the Daedric sword and the cutlass and keep the iron sword",
    disp["11:A.esp"] === "cut" && disp["12:A.esp"] === "cut" && !disp["10:A.esp"] && doc.counts.kept === 1);
} finally {
  roots.forEach(function (r) { fs.rmSync(r, { recursive: true, force: true }); });
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
