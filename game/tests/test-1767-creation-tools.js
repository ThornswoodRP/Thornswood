// test-1767-creation-tools.js
//
// #1767. docs/systems/creation.md, "Where this is", said "the three tools are
// in the server" and "A fisher is not handed a pole", while the server's TOOLS
// table (game/gamemode.js) hands a new fisher the crude fishing pole beside the
// pickaxe, the woodcutter's axe and the shovel (#1379, #1487), and the fishing
// verb refuses without a pole. This holds the page to TOOLS: the count, every
// tool by its name, and the fisher's pole. Since #3162 the five bench trades
// have a tool each too, so TOOLS hands out nine.
//
// Read only.
const REPO_DIR = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}

const gm = read("game/gamemode.js");
const page = read("docs/systems/creation.md");

const a = gm.indexOf("\nconst TOOLS = {");
const b = a < 0 ? -1 : gm.indexOf("\n};\n", a);
yes("TOOLS is in the gamemode", a >= 0 && b > a);
let TOOLS = null;
if (a >= 0 && b > a) {
  const box = {};
  vm.runInNewContext(gm.slice(a, b + 3).replace("const TOOLS", "TOOLS"), box);
  TOOLS = box.TOOLS;
}
const kinds = TOOLS ? Object.keys(TOOLS) : [];
yes("TOOLS hands out nine tools: miner, woodworker, farmer, fisher and the bench trades smith, tailor, cook, alchemist, enchanter",
  kinds.join(",") === "miner,woodworker,farmer,fisher,smith,tailor,cook,alchemist,enchanter");
yes("the fisher is handed the crude fishing pole", !!TOOLS && TOOLS.fisher && TOOLS.fisher.give === "15498:Thornswood-Content.esp" &&
  TOOLS.fisher.name === "crude fishing pole");
yes("the fishing verb refuses without a pole", /toolGate\(actorId, 'fisher'\)/.test(gm));

const where = page.slice(page.indexOf("## Where this is"));
yes("the creation page has a Where this is section", page.indexOf("## Where this is") >= 0);
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const said = /the (\w+) tools are in the server/.exec(where.replace(/\s+/g, " "));
yes("Where this is counts the tools as TOOLS does (" + (said ? said[1] : "no count") + ")",
  !!said && WORDS.indexOf(said[1]) === kinds.length);
kinds.forEach(function (k) {
  const name = TOOLS[k].name.replace("\\'", "'");
  yes("Where this is names the " + name, where.replace(/\s+/g, " ").indexOf(name) >= 0);
});
yes("it no longer says a fisher is not handed a pole", !/not handed a pole/.test(page));
yes("it says a new fisher is handed the crude pole", /crude fishing pole\s+a new fisher is handed/.test(where));
yes("the design above it says the same", /crude fishing pole for a Fisher/.test(page.replace(/\s+/g, " ")));

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
