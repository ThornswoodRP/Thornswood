// test-1588-tools-50.js
//
// #1588. #1381 asked for every worn tool to have 50 uses: the pick, the
// shovel, the axe, the pole, and the tool handed at creation. It was closed by
// a pull request that changed only README.md, so the server kept
// `const TOOL_USES = 100;` and the pages kept saying 100. This runs the real
// tool functions out of game/gamemode.js (TOOLS, handTool, giveTool,
// heldToolId, wearTool) with a small fake inventory and holds the pages to the
// number: each tool warns at 15 left and breaks at its 50th use, a tool handed
// at creation counts the same way, a count left past 49 by the old hundred
// breaks at the next use, and no page says a tool has a hundred.
//
// Read only.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }
const gm = read("game/gamemode.js");

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
function cut(head) { return slice(gm, "\n" + head, "\n}\n"); }
function flat(s) { return s.replace(/\s+/g, " "); }

// ------------------------------------------------------------ the numbers

const usesM = /^const TOOL_USES = (\d+);$/m.exec(gm);
const poleM = /^const POLE_USES = (\d+);$/m.exec(gm);
const warnM = /^const TOOL_WARN_AT = (\d+);$/m.exec(gm);
yes("TOOL_USES is 50 (" + (usesM ? usesM[1] : "missing") + ")", !!usesM && usesM[1] === "50");
yes("POLE_USES is 50 (" + (poleM ? poleM[1] : "missing") + ")", !!poleM && poleM[1] === "50");
yes("the warning still comes at 15 left", !!warnM && warnM[1] === "15");

// ------------------------------------------------------------ the code, run

const toolsSrc = slice(gm, "\nconst TOOLS = {", "\n};\n");
const fns = ["function idOf(", "function aWord(", "function toolFor(", "function toolStamps(", "function handTool(",
  "function giveTool(", "function heldToolId(", "function wearTool("].map(cut);
yes("TOOLS and the tool functions are in the gamemode", !!toolsSrc && fns.every(function (f) { return !!f; }));

const ids = {};
let nextId = 0x100;
function idFor(desc) {
  if (!Object.prototype.hasOwnProperty.call(ids, desc)) { ids[desc] = nextId++; }
  return ids[desc];
}
const props = {};
const inv = {};
const logs = [];
const box = {
  mp: {
    getIdFromDesc: function (d) { return idFor(d); },
    get: function (actor, key) {
      if (key === "inventory") { return { entries: (inv[actor] || []).slice() }; }
      return props[actor + ":" + key];
    },
    set: function (actor, key, v) { props[actor + ":" + key] = JSON.parse(JSON.stringify(v)); }
  },
  addItem: function (actor, desc, count) {
    const id = idFor(desc);
    const list = inv[actor] = inv[actor] || [];
    const e = list.filter(function (x) { return x.baseId === id; })[0];
    if (e) { e.count += count; } else { list.push({ baseId: id, count: count }); }
    return true;
  },
  takeItemById: function (actor, id, count) {
    const list = inv[actor] || [];
    const e = list.filter(function (x) { return x.baseId === id && x.count >= count; })[0];
    if (!e) { return false; }
    e.count -= count;
    return true;
  },
  log: function () { logs.push(Array.prototype.join.call(arguments, " ")); },
  Date: Date
};
let ran = false;
if (toolsSrc && fns.every(function (f) { return !!f; })) {
  const src = [usesM ? usesM[0] : "", poleM ? poleM[0] : "", warnM ? warnM[0] : "",
    "const TOOL_PROPERTY = 'thornswoodTools';",
    toolsSrc].concat(fns).join("\n") +
    "\nthis.TOOLS = TOOLS; this.handTool = handTool; this.giveTool = giveTool; this.wearTool = wearTool;";
  try { vm.runInNewContext(src, box); ran = true; } catch (e) { console.log("could not run: " + e); }
}
yes("the tool functions run", ran && typeof box.wearTool === "function");

function held(actor, desc) {
  const id = idFor(desc);
  return (inv[actor] || []).filter(function (x) { return x.baseId === id; }).reduce(function (n, x) { return n + x.count; }, 0);
}
function stamps(actor) { return props[actor + ":thornswoodTools"] || {}; }

// Each tool, handed at the pick the way creation hands it, then worked: the
// four gathering tools and the bench trades' five (#3162).
const KINDS = ["miner", "farmer", "woodworker", "fisher", "smith", "tailor", "cook", "alchemist", "enchanter"];
yes("TOOLS holds exactly these " + KINDS.length + " tools", ran && JSON.stringify(Object.keys(box.TOOLS).sort()) === JSON.stringify(KINDS.slice().sort()));
let actor = 0x1000;
KINDS.forEach(function (key) {
  if (!ran) { yes(key + ": not run", false); return; }
  const a = actor++;
  const tool = box.TOOLS[key];
  const line = box.giveTool(a, key);
  yes(key + ": the pick hands the " + tool.name + " (" + line + ")", held(a, tool.give) === 1 && /You are handed an? /.test(line || ""));
  yes(key + ": handing it starts no count of its own", !Object.prototype.hasOwnProperty.call(stamps(a), "wear:" + key));
  const said = [];
  let brokeAt = 0;
  for (let i = 1; i <= 60 && !brokeAt; i++) {
    const r = box.wearTool(a, key);
    if (r) { said.push([i, r]); }
    if (held(a, tool.give) === 0) { brokeAt = i; }
  }
  yes(key + ": the " + tool.name + " breaks at its 50th use (" + brokeAt + ")", brokeAt === 50);
  yes(key + ": it says two things in 50 uses, the warning and the break (" + said.length + ")", said.length === 2);
  yes(key + ": the warning comes at use 35, 15 left (" + (said[0] ? said[0][0] : "none") + ")",
    !!said[0] && said[0][0] === 35 && /is worn thin/.test(said[0][1]));
  yes(key + ": the break says so and names who makes the next (" + (said[1] ? said[1][1] : "none") + ")",
    !!said[1] && said[1][0] === 50 && said[1][1] === "Your " + tool.name + " breaks. " + tool.broken);
  // #1038: no handout clock is set, because nothing hands a replacement over
  yes(key + ": the count starts again and no handout clock is set", stamps(a)["wear:" + key] === 0 && !Object.prototype.hasOwnProperty.call(stamps(a), key));
  yes(key + ": the log says 50 uses", logs.some(function (l) { return l.indexOf("broke a " + tool.name + " after 50 uses") >= 0; }));
});

// The pick, the shovel and the axe all read TOOL_USES and the pole POLE_USES,
// so a change to one cannot leave the other behind without this seeing it.
const wearSrc = cut("function wearTool(") || "";
yes("wearTool reads POLE_USES for the pole and TOOL_USES for the rest",
  /const limit = key === 'fisher' \? POLE_USES : TOOL_USES;/.test(wearSrc));

// A count left past 49 by the old hundred breaks at its next use.
if (ran) {
  const a = actor++;
  box.addItem(a, box.TOOLS.miner.give, 1);
  box.mp.set(a, "thornswoodTools", { "wear:miner": 70, miner: 1 });
  const r = box.wearTool(a, "miner");
  yes("a pickaxe already worked 70 times under the old hundred breaks at the next swing (" + r + ")",
    held(a, box.TOOLS.miner.give) === 0 && /breaks/.test(r || ""));
  const b = actor++;
  box.addItem(b, box.TOOLS.farmer.give, 1);
  box.mp.set(b, "thornswoodTools", { "wear:farmer": 48, farmer: 1 });
  const r1 = box.wearTool(b, "farmer");
  const r2 = box.wearTool(b, "farmer");
  yes("a shovel worked 48 times lasts one more use and breaks at the 50th",
    r1 === null && /breaks/.test(r2 || "") && held(b, box.TOOLS.farmer.give) === 0);
}

// The refusals: nothing in the pack, nothing counted; a quest pickaxe is worn
// the same as the handout.
if (ran) {
  const a = actor++;
  const r = box.wearTool(a, "miner");
  yes("no pickaxe in the pack: nothing said and nothing counted", r === null && !Object.prototype.hasOwnProperty.call(stamps(a), "wear:miner"));
  const n = actor++;
  const notched = box.TOOLS.miner.accept[1];
  box.addItem(n, notched, 1);
  let at = 0;
  for (let i = 1; i <= 60 && !at; i++) { box.wearTool(n, "miner"); if (held(n, notched) === 0) { at = i; } }
  yes("another accepted pickaxe breaks at 50 too (" + at + ")", at === 50);
}

// ------------------------------------------------------------ the pages

function whereThis(rel) {
  const p = read(rel);
  const i = p.indexOf("## Where this is");
  if (i < 0) { return null; }
  const j = p.indexOf("\n## ", i + 5);
  return flat(j < 0 ? p.slice(i) : p.slice(i, j));
}
const classesWhere = whereThis("docs/systems/classes.md");
yes("classes.md Where this is says every tool has 50 uses, the one handed at the pick included",
  !!classesWhere && /Every tool in the server has 50 uses: the pick, the shovel, the axe, the pole, and the one handed at the pick/.test(classesWhere));
yes("classes.md Where this is no longer says the server has 100", !!classesWhere && !/100/.test(classesWhere));
yes("classes.md Where this is no longer says a pole is not required (the fishing verb refuses without one)",
  !!classesWhere && !/pole is not required/.test(classesWhere) && /toolGate\(actorId, 'fisher'\)/.test(gm));
const minerWhere = whereThis("docs/systems/classes/miner.md");
yes("miner.md Where this is says the pickaxe has 50 uses", !!minerWhere && /The pickaxe has 50 uses/.test(minerWhere) && !/100 uses/.test(minerWhere));
const farmerWhere = whereThis("docs/systems/classes/farmer.md");
yes("farmer.md Where this is says a shovel of 50 uses", !!farmerWhere && /a shovel of 50 uses are in the server/.test(farmerWhere) && !/100/.test(farmerWhere));
const woodWhere = whereThis("docs/systems/professions/woodworker.md");
yes("woodworker.md Where this is says the axe has 50 uses", !!woodWhere && /The axe has 50 uses/.test(woodWhere));
yes("durability.md says the three wear out by use, 50 uses each",
  /The pickaxe, the woodcutter's axe and the shovel wear out by use instead, 50 uses each/.test(flat(read("docs/systems/durability.md"))));
const site = flat(read("site/data/site/classes.md"));
yes("the public classes page says each tool has 50 uses", /each one has 50 uses in it/.test(site));
yes("the public classes page no longer says a hundred", !/a hundred uses/i.test(site));

const PAGES = ["docs/systems/classes.md", "docs/systems/creation.md", "docs/systems/durability.md",
  "docs/systems/classes/miner.md", "docs/systems/classes/farmer.md", "docs/systems/classes/fisher.md",
  "docs/systems/professions/woodworker.md", "docs/systems/professions/woodworker/charburner.md",
  "site/data/site/classes.md"];
PAGES.forEach(function (rel) {
  const t = flat(read(rel));
  yes(rel + " gives no tool 100 or a hundred uses", !/\b(100|a hundred|hundred) uses\b/i.test(t) && !/tools in the server have 100/.test(t));
});
const gmNoHundred = gm.split("\n").filter(function (l) { return l.length < 2000; }).join("\n");
yes("the gamemode's comments no longer say TOOL_USES is 100", !/TOOL_USES is 100/.test(gmNoHundred));

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
