// test-1590-hunter-lists.js
//
// #1590. game/data/hunts.json was rebuilt in #1523 and the lists made from it
// were not written again, so docs/systems/classes/hunter.md (the table under
// Every record), docs/systems/lists/hunter.md and the Hunter line of
// docs/systems/lists/README.md described 36 rows and 119 records the server no
// longer had. This runs scripts/dev/Write-SystemLists.js in a temporary copy
// of what it reads and writes and holds those three to what it writes from
// today's hunts.json, and holds the numbers the hunter page states above
// Every record to the same table. The repository is never written.
const REPO_DIR = require("path").join(__dirname, "..");
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
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  fs.readdirSync(from, { withFileTypes: true }).forEach(function (e) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) { copyDir(a, b); } else { fs.copyFileSync(a, b); }
  });
}

const HUNTER_LIST = "docs/systems/lists/hunter.md";
const HUNTER_PAGE = "docs/systems/classes/hunter.md";
const INDEX = "docs/systems/lists/README.md";
function repo(rel) { return lf(fs.readFileSync(path.join(REPO_DIR, rel), "utf8")); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1590-"));
try {
  fs.mkdirSync(path.join(tmp, "scripts", "dev"), { recursive: true });
  fs.copyFileSync(path.join(REPO_DIR, "scripts", "dev", "Write-SystemLists.js"), path.join(tmp, "scripts", "dev", "Write-SystemLists.js"));
  fs.mkdirSync(path.join(tmp, "game", "data"), { recursive: true });
  ["recipes", "harvests", "ores", "hunts", "races", "item-sources"].forEach(function (n) {
    fs.copyFileSync(path.join(REPO_DIR, "game", "data", n + ".json"), path.join(tmp, "game", "data", n + ".json"));
  });
  fs.copyFileSync(path.join(REPO_DIR, "game", "gamemode.js"), path.join(tmp, "game", "gamemode.js"));
  // The gamemode's tables and the helper that reads them (#5191).
  fs.copyFileSync(path.join(REPO_DIR, "scripts", "dev", "GamemodeTables.js"), path.join(tmp, "scripts", "dev", "GamemodeTables.js"));
  copyDir(path.join(REPO_DIR, "game", "gamemode-tables"), path.join(tmp, "game", "gamemode-tables"));
  copyDir(path.join(REPO_DIR, "docs", "systems"), path.join(tmp, "docs", "systems"));

  const r = cp.spawnSync(process.execPath, [path.join(tmp, "scripts", "dev", "Write-SystemLists.js")], { encoding: "utf8", timeout: 120000 });
  yes("Write-SystemLists.js runs (exit " + r.status + ")", r.status === 0);
  function made(rel) { return lf(fs.readFileSync(path.join(tmp, rel), "utf8")); }

  yes("lists/hunter.md is what the script writes from today's hunts.json", made(HUNTER_LIST) === repo(HUNTER_LIST));
  yes("the hunter page is what the script writes from today's hunts.json", made(HUNTER_PAGE) === repo(HUNTER_PAGE));
  const lineOf = function (t) { return (/^- \[Hunter\]\(hunter\.md\).*$/m.exec(t) || [""])[0]; };
  yes("the Hunter line of the lists index is what the script writes", lineOf(made(INDEX)) !== "" && lineOf(made(INDEX)) === lineOf(repo(INDEX)));

  // The numbers the page states above Every record, against that table.
  const hunts = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "game", "data", "hunts.json"), "utf8")).hunts;
  const records = Object.keys(hunts).length;
  const names = {};
  Object.keys(hunts).forEach(function (k) { names[hunts[k].name] = true; });
  const page = repo(HUNTER_PAGE);
  const a = page.indexOf("## Every record"), b = page.indexOf("<!-- detail:end -->");
  const rows = page.slice(a, b).split("\n").filter(function (l) { return /^\| /.test(l) && !/^\| (Name|---)/.test(l); });
  const sum = rows.reduce(function (n, l) { return n + Number(l.split("|")[3]); }, 0);
  const tableNames = {};
  rows.forEach(function (l) { tableNames[l.split("|")[1].trim()] = true; });
  yes("Every record holds every placed body in hunts.json (" + sum + " of " + records + ")", sum === records);
  yes("and every name (" + Object.keys(tableNames).length + " of " + Object.keys(names).length + ")",
    Object.keys(tableNames).length === Object.keys(names).length);
  const stated = /^(\d+) names, (\d+) placed bodies\./m.exec(page);
  yes("the page says " + (stated ? stated[1] + " names, " + stated[2] + " placed bodies" : "no count") + ", which is the table",
    !!stated && Number(stated[1]) === Object.keys(names).length && Number(stated[2]) === records);
  const idx = /\((\d+) rows, (\d+) records\)/.exec(lineOf(repo(INDEX)));
  yes("the index says " + (idx ? idx[1] + " rows, " + idx[2] + " records" : "nothing") + ", which is the table",
    !!idx && Number(idx[1]) === rows.length && Number(idx[2]) === records);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
