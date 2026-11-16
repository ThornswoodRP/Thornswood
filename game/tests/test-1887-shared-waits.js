// test-1887-shared-waits.js
//
// #1887. The fisher and hunter pages said a water's and a rack's wait was kept
// per person and cleared by a restart. Since #1413 the server keeps both on the
// reference, in the shared resource stock (createSharedResourceStock), shared
// by everyone and kept through a restart, which is what People who are not
// people says ("Return times and shared stock survive a restart"). The pages
// now say the same. This holds the two pages to the server: fish() and game()
// ask the stock about the reference and nothing else, the stock keeps its wait
// in a property on the reference, and neither page says the wait is yours or
// that a restart clears it. game/tests/test-resource-stock-integration.js runs the
// stock itself, the sharing and the reload.
//
// Read only.
const REPO_DIR = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }
function squash(s) { return s.replace(/\s+/g, " "); }

// ---- the server
const gm = read("game/gamemode.js");
// A top-level function's text, up to its closing brace at the start of a
// line, so the comment above the next function is not read as this one's.
function fn(name) {
  const at = gm.indexOf("\nfunction " + name + "(");
  if (at < 0) { return ""; }
  const end = gm.indexOf("\n}\n", at);
  return gm.slice(at, end < 0 ? gm.length : end + 2);
}
const fish = fn("fish"), game = fn("game"), stock = fn("createSharedResourceStock");
yes("fish(), game() and createSharedResourceStock are in the gamemode", fish && game && stock);
[["fish", fish], ["game", game]].forEach(function (p) {
  yes(p[0] + "() asks the shared stock for the wait by the reference alone",
      /stock\.left\(refrId,\s*span\)/.test(p[1]) && /stock\.take\(refrId,\s*span,/.test(p[1]));
  yes(p[0] + "() keeps no wait of its own per person (no cooldownLeft or lastUse)",
      !/cooldownLeft|lastUse|actorId\s*\+\s*['"]:/.test(p[1]));
});
yes("the stock keeps readyAt in a property on the reference, which the server saves",
    /makeProperty\(property/.test(stock) && /property\s*=\s*'thornswoodResourceStock'/.test(stock) &&
    /readyAt:deadline/.test(stock));

// ---- the pages
const npcs = squash(read("docs/systems/npcs.md"));
yes("People who are not people says return times and shared stock survive a restart",
    /Return times and shared stock survive a restart\./.test(npcs));
const fisher = squash(read("docs/systems/classes/fisher.md"));
const hunter = squash(read("docs/systems/classes/hunter.md"));
function section(page, heading) {
  const at = page.indexOf("## " + heading);
  if (at < 0) { return ""; }
  const next = page.indexOf(" ## ", at + 3);
  return page.slice(at, next < 0 ? page.length : next);
}
const fishWait = section(fisher, "How much, and how often");
const rack = section(hunter, "Hanging game");
yes("the fisher page keeps the wait on the water, for everyone",
    /kept on the water/.test(fishWait) && /fished for everyone/.test(fishWait));
yes("and says a restart does not clear it", /A restart does not clear it/.test(fishWait));
yes("and no longer says the water is kept per person or that a restart clears it",
    !/kept per person/.test(fishWait) && !/A restart clears it/.test(fishWait));
yes("the hunter page keeps a rack's wait on the rack, for every hunter",
    /kept on the rack/.test(rack) && /picked for every hunter/.test(rack));
yes("and says a restart does not clear it", /A restart does not clear the wait/.test(rack));
yes("and no longer calls it your own wait or says a restart clears it",
    !/your own wait/.test(rack) && !/A restart clears the wait/.test(rack));
yes("both pages point at the page that states the rule",
    /\(\.\.\/npcs\.md\)/.test(fishWait) && /\(\.\.\/npcs\.md\)/.test(rack));
yes("both Where this is sections say the wait is kept through a restart",
    /kept through a restart \(#1413\)/.test(section(fisher, "Where this is")) &&
    /kept through a restart \(#1413\)/.test(section(hunter, "Where this is")));

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
