// test-1874-hunting-spots.js
//
// #1874. docs/HUNTING-SPOTS.csv is every retained animal placement with what
// its body gives, from game/data/npc-population.json and game/data/hunts.json.
// It was last written in #1413, and #1523 and #1808 rebuilt hunts.json without
// writing it again: 878 rows named products the table no longer gives (every
// Skeever lacked Skeever Meat) and the Spectral Warhounds still said Hunter,
// Ectoplasm. Two things kept it stale. Its only full writer,
// Build-ResourceLocations.py, refuses to run unless every plugin matches the
// hashes the population recorded, so it never ran where hunts.json changed.
// And Build-NpcPopulation.py wrote the same file with the population columns
// only, dropping the hunt columns. Now one function writes it, from the two
// JSON files alone, and `Build-ResourceLocations.py --hunting-only` runs it
// with no plugin.
//
// This runs both writers in a temporary copy of what they read and holds the
// committed file to what they write from today's tables. The repository is
// never written. When this fails because the hunt table or the population
// changed, run, from the repository folder:
//
//     python scripts/dev/Build-ResourceLocations.py --hunting-only
//
// and commit docs/HUNTING-SPOTS.csv with the table.
const REPO_DIR = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}
function lf(s) { return s.split(CR).join(""); }
function readRepo(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8"); }

const CSV = "docs/HUNTING-SPOTS.csv";
const FIX = "python scripts/dev/Build-ResourceLocations.py --hunting-only";

// The runner on the VPS has python; this VM has python3 as well. No Python is
// a failure, not a skip: the file would go unchecked.
let PY = null;
for (const name of ["python", "python3"]) {
  const r = cp.spawnSync(name, ["-c", "import sys; print(sys.version_info[0])"], { encoding: "utf8" });
  if (!r.error && r.status === 0 && r.stdout.trim() === "3") { PY = name; break; }
}
yes("a Python 3 to run the writers (" + (PY || "none found") + ")", PY !== null);
if (!PY) { console.log(""); console.log(pass + " passed, " + fail + " failed"); process.exit(1); }

// The first row that differs, so a failure says where.
function firstDiff(a, b) {
  const x = lf(a).split("\n"), y = lf(b).split("\n");
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] !== y[i]) {
      const a = x[i] || "", b = y[i] || "";
      let at = 0;
      while (at < a.length && a[at] === b[at]) { at++; }
      const from = Math.max(0, at - 40);
      return "line " + (i + 1) + " (" + a.split(",")[0] + "): committed ..." + JSON.stringify(a.slice(from, at + 80)) +
             ", written ..." + JSON.stringify(b.slice(from, at + 80));
    }
  }
  return "";
}

function stage(tag) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1874-" + tag + "-"));
  fs.mkdirSync(path.join(tmp, "scripts", "dev"), { recursive: true });
  fs.readdirSync(path.join(REPO_DIR, "scripts", "dev")).filter(function (n) { return /\.py$/.test(n); }).forEach(function (n) {
    fs.copyFileSync(path.join(REPO_DIR, "scripts", "dev", n), path.join(tmp, "scripts", "dev", n));
  });
  fs.mkdirSync(path.join(tmp, "game", "data"), { recursive: true });
  ["npc-population.json", "hunts.json", "merchant-roster.json"].forEach(function (n) {
    fs.copyFileSync(path.join(REPO_DIR, "game", "data", n), path.join(tmp, "game", "data", n));
  });
  fs.mkdirSync(path.join(tmp, "docs", "systems"), { recursive: true });
  fs.copyFileSync(path.join(REPO_DIR, CSV), path.join(tmp, CSV));
  return tmp;
}
function huntingOnly(tmp, extra) {
  return cp.spawnSync(PY, [path.join(tmp, "scripts", "dev", "Build-ResourceLocations.py")].concat(extra || ["--hunting-only"]),
    { cwd: tmp, encoding: "utf8", timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
}
const temps = [];
function done() {
  temps.forEach(function (t) { try { fs.rmSync(t, { recursive: true, force: true }); } catch (e) { } });
  console.log("");
  console.log(pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

const committed = readRepo(CSV);

// ---- 1. the committed file is what --hunting-only writes from today's tables
{
  const tmp = stage("now"); temps.push(tmp);
  const r = huntingOnly(tmp);
  yes("Build-ResourceLocations.py --hunting-only runs with no plugin and no settings (exit " + r.status + ")",
      r.status === 0);
  if (r.status !== 0) { console.log((r.stderr || "") + (r.stdout || "")); }
  const made = fs.readFileSync(path.join(tmp, CSV), "utf8");
  const same = lf(made) === lf(committed);
  yes(CSV + " is what it writes from today's hunts.json and npc-population.json", same);
  if (!same) { console.log("      " + firstDiff(committed, made)); console.log("      to write it again: " + FIX); }
  yes("and it keeps the line ending the file already had", (made.indexOf(CR) >= 0) === (committed.indexOf(CR) >= 0));
  let said = null;
  try { said = JSON.parse((r.stdout || "").trim().split("\n").pop()); } catch (e) { }
  yes("it says how many placements it wrote", said && typeof said.animalPlacements === "number" && said.animalPlacements > 0);
}

// ---- 2. the rows, read against the two tables directly
const population = JSON.parse(readRepo("game/data/npc-population.json"));
const hunts = JSON.parse(readRepo("game/data/hunts.json")).hunts;
const lines = lf(committed).split("\n").filter(function (l) { return l !== ""; });
const header = lines[0].split(",");
yes("the header carries the hunt columns as well as the population ones",
    ["ref", "base", "x", "y", "z", "rank", "access", "products", "productIds", "yieldByRank", "sharedStock", "rewardRule"]
      .every(function (c) { return header.indexOf(c) >= 0; }));
// A CSV row: quoted fields only hold the yield pairs, which carry commas.
function cells(line) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') { q = false; } else { cur += c; } }
    else if (c === '"') { q = true; } else if (c === ",") { out.push(cur); cur = ""; } else { cur += c; }
  }
  out.push(cur);
  return out;
}
const rows = lines.slice(1).map(function (l) {
  const v = cells(l), o = {};
  header.forEach(function (h, i) { o[h] = v[i]; });
  return o;
});
const kept = population.npcs.filter(function (n) { return n.keep && n.role === "animal"; });
yes("one row for each retained animal placement (" + rows.length + " of " + kept.length + ")",
    rows.length === kept.length && rows.every(function (r, i) { return r.ref === kept[i].ref && r.base === kept[i].base; }));
let wrong = [];
rows.forEach(function (r) {
  const h = hunts[r.base];
  const want = h
    ? { access: "Hunter", rank: h.rank, products: h.gives.map(function (g) { return g.name; }).join("; "),
        productIds: h.gives.map(function (g) { return g.item; }).join("; "), yieldByRank: JSON.stringify(h.yield),
        rewardRule: "One dressing per life" }
    : { access: "No dressing yield", rank: "", products: "", productIds: "", yieldByRank: "", rewardRule: "None" };
  Object.keys(want).forEach(function (k) { if (r[k] !== want[k]) { wrong.push(r.ref + " " + k + ": " + r[k] + " (hunts.json: " + want[k] + ")"); } });
});
yes("every row's rank, products, yield and access are hunts.json's for its base" + (wrong.length ? " (" + wrong.length + " wrong, first " + wrong[0] + ")" : ""),
    wrong.length === 0);
const skeevers = rows.filter(function (r) { return r.name === "Skeever" && hunts[r.base]; });
yes("the issue's example: every dressable Skeever gives what the table gives, Skeever Meat with it (" + skeevers.length + ")",
    skeevers.length > 0 && skeevers.every(function (r) {
      return r.products === hunts[r.base].gives.map(function (g) { return g.name; }).join("; ") && /Skeever Meat/.test(r.products);
    }));
const ghosts = rows.filter(function (r) { return r.name === "Spectral Warhound"; });
yes("a body the hunt table leaves out (#1808) is not a Hunter row: the Spectral Warhounds (" + ghosts.length + ")",
    ghosts.every(function (r) { return !hunts[r.base] && r.access === "No dressing yield" && r.products === ""; }));

// ---- 3. a change to the hunt table changes what is written, so a pull
// request that rebuilds hunts.json without the file goes red here
{
  const tmp = stage("drift"); temps.push(tmp);
  const hp = path.join(tmp, "game", "data", "hunts.json");
  const table = JSON.parse(fs.readFileSync(hp, "utf8"));
  const base = skeevers.length ? skeevers[0].base : Object.keys(table.hunts)[0];
  table.hunts[base].gives = table.hunts[base].gives.slice(0, 1);
  fs.writeFileSync(hp, JSON.stringify(table));
  const r = huntingOnly(tmp);
  const made = fs.readFileSync(path.join(tmp, CSV), "utf8");
  yes("a hunt table that gives one thing less writes a file that is not the committed one",
      r.status === 0 && lf(made) !== lf(committed));
}

// ---- 4. the population writer leaves the same file, all its columns
{
  const tmp = stage("pop"); temps.push(tmp);
  fs.copyFileSync(path.join(REPO_DIR, "docs", "NPC-SPAWNS.csv"), path.join(tmp, "docs", "NPC-SPAWNS.csv"));
  const prog = [
    "import importlib.util, json, pathlib, sys",
    "here = pathlib.Path(sys.argv[1])",
    "sys.path.insert(0, str(here))",
    "spec = importlib.util.spec_from_file_location('population', here / 'Build-NpcPopulation.py')",
    "P = importlib.util.module_from_spec(spec)",
    "spec.loader.exec_module(P)",
    "P.write_catalogues(json.loads((here.parent.parent / 'game/data/npc-population.json').read_text(encoding='utf-8')))"
  ].join("\n");
  const r = cp.spawnSync(PY, ["-c", prog, path.join(tmp, "scripts", "dev")], { cwd: tmp, encoding: "utf8", timeout: 120000 });
  yes("Build-NpcPopulation.py's catalogues run in the copy (exit " + r.status + ")", r.status === 0);
  if (r.status !== 0) { console.log(r.stderr || ""); }
  const made = fs.readFileSync(path.join(tmp, CSV), "utf8");
  yes("the population rebuild writes " + CSV + " with the hunt columns, the same file", lf(made) === lf(committed));
  if (lf(made) !== lf(committed)) { console.log("      " + firstDiff(committed, made)); }
  yes("and NPC-SPAWNS.csv is still what it writes",
      lf(fs.readFileSync(path.join(tmp, "docs", "NPC-SPAWNS.csv"), "utf8")) === lf(readRepo("docs/NPC-SPAWNS.csv")));
}

// ---- 5. the full run still needs the plugins, and says so
{
  const tmp = stage("full"); temps.push(tmp);
  fs.writeFileSync(path.join(tmp, CSV), "untouched\n");
  const r = huntingOnly(tmp, []);
  yes("without --hunting-only it refuses when --settings and --strings-dir are missing (exit " + r.status + ")",
      r.status === 2 && /--settings and --strings-dir are required/.test(r.stderr || ""));
  yes("and writes nothing", fs.readFileSync(path.join(tmp, CSV), "utf8") === "untouched\n");
}

done();
