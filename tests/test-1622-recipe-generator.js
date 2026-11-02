// test-1622-recipe-generator.js
//
// #1622. scripts/dev/Build-RecipeTable.ps1 writes game/data/recipes.json and
// the RECIPES_BY_ID block, and four merged changes put their decisions into
// those two by hand after the build: the cut file (#1391), the one smelt row
// per ingot and the leather rows (#1391, #1400), the refused dwarven scrap
// smelts (#613) and the poles and the trap (#1379). A rebuild undid all of
// them. The build now carries them, and this holds the build and the tables
// it wrote to the same answers, so the next rebuild changes nothing it was not
// meant to. It also holds the load order to the plugins Vortex switched on.
//
// The rebuild itself (4 October): the poles and the trap moved into the block,
// the kits (#1384) and the treatments (#1383) are owned at the halves and ranks
// their pages give, and the thirteen college book staves sit at their spell's
// rank, Patrick's answer B on #1622, with heart stone on master.
//
// The build itself reads the game's plugins and is not run here. Read only.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const path = require("path");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }

const ps = read("scripts/dev/Build-RecipeTable.ps1").replace(/^﻿/, "");
const gm = require('./gamemode-tables.js').joined(read("game/gamemode.js"));
const recipes = JSON.parse(read("game/data/recipes.json"));
const cutDoc = JSON.parse(read("docs/systems/cut-items.json"));
const fisher = read("docs/systems/classes/fisher.md");

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
// A PowerShell single quoted string, with '' for a quote inside it.
const PSSTR = "'((?:[^']|'')*)'";
function unq(s) { return String(s).split("''").join("'"); }
// One [ordered]@{ ... } knob of the build, as name -> its fields.
function knob(name) {
  const src = slice(ps, "$" + name + " = [ordered]@{", "\n}\n");
  const out = {};
  if (!src) { return null; }
  const re = new RegExp("^\\s+" + PSSTR + "\\s*=\\s*(.*)$", "gm");
  let m;
  while ((m = re.exec(src)) !== null) {
    const key = unq(m[1]);
    const rest = m[2];
    if (rest.indexOf("@{") === 0) {
      const f = {};
      const fr = new RegExp("(\\w+)\\s*=\\s*" + PSSTR, "g");
      let n;
      while ((n = fr.exec(rest)) !== null) { f[n[1]] = unq(n[2]); }
      out[key] = f;
    } else {
      const s = new RegExp("^" + PSSTR).exec(rest);
      out[key] = s ? unq(s[1]) : rest;
    }
  }
  return out;
}
function oneString(name) {
  const m = new RegExp("^\\$" + name + " = " + PSSTR + "\\s*$", "m").exec(ps);
  return m ? unq(m[1]) : null;
}

// ---- the load order is the plugins that are switched on -----------------
// The build reads plugins.txt through scripts/dev/OwnPlugins.ps1 (#2976), which
// leaves a switched off line out; tests/test-2923-own-plugins.js holds the
// helper to that and tests/test-1712-builders-skip-off.js runs builders on it.
const loadOrder = slice(ps, "if (-not (Test-Path -LiteralPath $PluginsTxt))", "Ok (\"{0} plugins: the five masters, then {1}\"");
yes("the build takes its load order from plugins.txt", loadOrder !== null);
yes("through the helper, which leaves a line Vortex switched off (no '*') out of it",
  !!loadOrder && loadOrder.indexOf("foreach ($p in (Get-LoadOrder $PluginsTxt)) { $order.Add($p) }") >= 0 &&
  loadOrder.indexOf("$offCount = (Get-SwitchedOff $PluginsTxt).Count") >= 0);
yes("and the run says how many were left out", ps.indexOf("line(s) in that list are switched off and were left out") >= 0);

// ---- the line ending (#1622, #3029) --------------------------------------
// A checkout that keeps LF got CRLF lines in the table and the blocks, and the
// fuel and name builders then turned the whole gamemode.js to CRLF. Since
// #3029 .gitattributes checks both out with LF everywhere, and this writes LF.
yes("the build writes recipes.json with LF",
  ps.indexOf('$Eol = "`n"') >= 0 && ps.indexOf("EolOf") < 0 &&
  ps.indexOf("$jsonEol = $Eol") >= 0 && ps.indexOf("$json = ($doc -join $jsonEol) + $jsonEol") >= 0);
yes("and both gamemode tables go to their own files through GamemodeTables.ps1, which writes LF (#5191)",
  (ps.match(/Write-GamemodeTable '(RECIPES_BY_ID|STAFF_SPELLS)'/g) || []).length === 2 && ps.indexOf('"`r`n"') < 0);

// ---- the cut file (#1391) ------------------------------------------------
yes("the build reads docs/systems/cut-items.json",
  ps.indexOf("$CUT_FILE = Join-Path $PSScriptRoot '..\\..\\docs\\systems\\cut-items.json'") >= 0);
const rolls = knob("CUT_ROLLS") || {};
const rollsLine = /^\$CUT_ROLLS = \[ordered\]@\{ 'embassy' = 'embassy'; 'thalmor' = 'remnant' \}$/m.test(ps);
yes("embassy rows go on the embassy roll and thalmor rows on the remnant roll", rollsLine || (rolls.embassy === "embassy" && rolls.thalmor === "remnant"));
const ROLL = { embassy: "embassy", thalmor: "remnant" };
const CUT_SENTENCE = oneString("CUT_SENTENCE");
yes("the build says what the gate says for a cut row", !!CUT_SENTENCE);

const sections = ["# ------------------------------------------------------------- the counts ---",
                  "# ------------------------------------------------------------ the cut file -",
                  "# ------------------------------------------------------------- the writing -"].map(function (h) { return ps.indexOf(h); });
yes("the cut file is applied after every rank and count and before anything is written",
  sections[0] > 0 && sections[1] > sections[0] && sections[2] > sections[1]);

const items = cutDoc.items || [];
let cutOwned = 0, cutRefused = 0, rolled = 0, wrong = [];
items.forEach(function (it) {
  const owned = recipes.recipes[it.id], refused = recipes.refused[it.id], open = recipes.unowned[it.id];
  if (it.disposition === "cut") {
    if (owned && owned.book === "cut") { cutOwned++; return; }
    if (refused) { cutRefused++; return; }
  } else if (ROLL[it.disposition]) {
    if (owned && owned.roll === ROLL[it.disposition] && owned.book !== "cut") { rolled++; return; }
  }
  if (wrong.length < 5) { wrong.push(it.id + " (" + it.disposition + ") is " + (owned ? "owned" : refused ? "refused" : open ? "open to anybody" : "not in the table")); }
  else { wrong.push(""); }
});
wrong.forEach(function (w) { if (w) { console.log("      " + w); } });
yes("every cut owned row in recipes.json carries book cut, as the build writes it (" + cutOwned + ")", cutOwned > 3000);
yes("every cut row nobody owned is refused, as the build writes it (" + cutRefused + ")", cutRefused > 200);
const rollRows = items.filter(function (it) { return ROLL[it.disposition]; }).length;
yes("every embassy and thalmor row carries its roll (" + rolled + ")",
  rolled > 0 && rolled === rollRows && rolled === (cutDoc.counts || {}).embassy + (cutDoc.counts || {}).thalmor);
yes("and no row of the cut file is open to anybody or carries the wrong mark", wrong.length === 0);
const stray = Object.keys(recipes.recipes).filter(function (k) {
  const r = recipes.recipes[k];
  return (r.book === "cut" || r.roll) && !items.some(function (it) { return it.id === k; });
});
yes("nothing in recipes.json is cut or rolled that the cut file does not name", stray.length === 0);

const recSrc = slice(gm, "var RECIPES_BY_ID = {", ";\n");
let BLOCK = null;
try { BLOCK = recSrc ? new Function("return " + recSrc.slice("var RECIPES_BY_ID = ".length).replace(/;$/, ""))() : null; } catch (e) { BLOCK = null; }
yes("the RECIPES_BY_ID block reads", !!BLOCK && Object.keys(BLOCK).length > 1500);
const cutFiring = Object.keys(recipes.recipes).filter(function (k) { return recipes.recipes[k].book === "cut" && recipes.recipes[k].fires; });
yes("every cut row the server is asked about is a row nobody makes in the block, with the build's sentence (" + cutFiring.length + ")",
  !!BLOCK && cutFiring.length > 1000 && cutFiring.every(function (k) { return BLOCK[k] && BLOCK[k].nobody === CUT_SENTENCE && !BLOCK[k].half; }));
yes("every rolled row carries its roll in the block",
  !!BLOCK && Object.keys(recipes.recipes).filter(function (k) { return recipes.recipes[k].roll; })
    .every(function (k) { return BLOCK[k] && BLOCK[k].roll === recipes.recipes[k].roll; }));
yes("the block writer writes a cut row as nobody's, with its race", ps.indexOf("', \"nobody\": ' + (JsonStr $CUT_SENTENCE) + ' },')") >= 0 &&
  ps.indexOf("', \"owner\": \"\", \"half\": \"\", \"race\": ' + (JsonStr $r.Race) + ', \"rank\": \"\", \"family\": \"\"'") >= 0);
yes("and a refused row the cut file sent there says the same sentence", ps.indexOf("if ($r.PSObject.Properties['Cut'] -and $r.Cut) { $nobodyWhy = $CUT_SENTENCE }") >= 0);
yes("recipes.json gets book and roll on the row", ps.indexOf("', \"book\": ' + (JsonStr $r.Book)") >= 0 && ps.indexOf("', \"roll\": ' + (JsonStr $r.Roll)") >= 0);

// ---- one smelt row per ingot and the leather rows (#1391, #1400) ---------
// RECIPE_OWNER and RECIPE_RANK, which Build-RecipeTable.ps1 reads from records/recipe-owners.json.
const NAMED = JSON.parse(read("records/recipe-owners.json"));
const OWNER = NAMED.owner || {};
const RANK = NAMED.rank || {};
// Every smelt row a half owns, and the tanning rows that make leather, that
// the cut file did not cut.
const keptHere = Object.keys(recipes.recipes).filter(function (k) {
  const r = recipes.recipes[k];
  if (r.book === "cut") { return false; }
  if (r.benchName === "CraftingSmelter") { return true; }
  return r.benchName === "CraftingTanningRack" && (r.name === "Leather" || r.name === "Leather Strips");
});
yes("recipes.json keeps 13 of them: one smelt row per ingot and two leather rows (" + keptHere.length + ")", keptHere.length === 13);
const keptOk = keptHere.filter(function (k) {
  const r = recipes.recipes[k];
  const o = OWNER[r.editorId], n = RANK[r.editorId];
  return o && n && o.Owner === r.owner && o.Half === r.half && o.Family === r.family && o.Why === r.why &&
    r.owner === "Smith" && r.half === "Platewright" && r.rank === "novice" && n.Rank === "novice";
});
yes("each is named in RECIPE_OWNER and RECIPE_RANK with the owner, half, family, reason and rank recipes.json gives it", keptOk.length === 13);
yes("Ingots and Leather, the families the recipe book shows", keptHere.every(function (k) { return ["Ingots", "Leather"].indexOf(recipes.recipes[k].family) >= 0; }));
yes("a recipe named in RECIPE_OWNER is not handed to the smelter's open bench rule",
  ps.indexOf("if ($benchOwner -and -not $benchOwner.Owner -and -not $RECIPE_OWNER.Contains($r.Edid)) {") >= 0);
yes("and its family comes from the knob", ps.indexOf("$famRead = @([string]$RECIPE_OWNER[$r.Edid].Family, 'named in RECIPE_OWNER', 'named')") >= 0);
const openWhy = knob("OPEN_ROW_WHY") || {};
const keeper = recipes.unowned["10dd28:Skyrim.esm"];
yes("the dwarven scrap smelt that stays open keeps #1400's reason", !!keeper && openWhy.RecipeIngotDwarvenScrapPlateMetalLarge === keeper.why);

// ---- the five refused dwarven scrap smelts (#613) -------------------------
const collapsed = knob("COLLAPSED_SMELT_EDITOR_IDS") || {};
const scrap = Object.keys(recipes.refused).filter(function (k) { return collapsed[recipes.refused[k].editorId]; });
yes("five scrap smelts are refused with the build's own reason", scrap.length === 5 &&
  scrap.every(function (k) { return collapsed[recipes.refused[k].editorId] === recipes.refused[k].why; }));
yes("and no reason says the word the words rule bans", Object.keys(collapsed).every(function (k) { return !/player/i.test(collapsed[k]); }));
const routeA = ps.indexOf("if ($COLLAPSED_SMELT_EDITOR_IDS.Contains($r.Edid)) {");
const routeNone = ps.indexOf("    # 2. A recipe with no bench keyword.");
yes("they are refused before the bench NONE rule, which the plugin's override would otherwise hand them to", routeA > 0 && routeNone > routeA);
yes("and refused in one place only", ps.split("$COLLAPSED_SMELT_EDITOR_IDS.Contains($r.Edid)").length === 2);

// ---- the poles and the trap (#1379), at the fisher page's ranks ----------
const POLES = { "Crude pole": "ThornswoodRecipePoleCrude", "Fine pole": "ThornswoodRecipePoleFine",
                "Master pole": "ThornswoodRecipePoleMaster", "Fish trap": "ThornswoodRecipeFishTrap" };
const table = slice(fisher, "## The poles and the trap", "## How much");
const pageRank = {};
if (table) {
  table.split("\n").forEach(function (line) {
    const m = /^\| ([^|]+?) \| (Novice|Advanced|Expert|Master) \|/.exec(line);
    if (m) { pageRank[m[1]] = m[2].toLowerCase(); }
  });
}
yes("the fisher page ranks the three poles and the trap", Object.keys(POLES).every(function (p) { return !!pageRank[p]; }));
yes("RECIPE_RANK gives each the fisher page's rank", Object.keys(POLES).every(function (p) {
  return RANK[POLES[p]] && RANK[POLES[p]].Rank === pageRank[p];
}));
yes("the trap is the Woodwright's in RECIPE_OWNER", !!OWNER.ThornswoodRecipeFishTrap &&
  OWNER.ThornswoodRecipeFishTrap.Owner === "Woodworker" && OWNER.ThornswoodRecipeFishTrap.Half === "Woodwright");
const ids = { ThornswoodRecipePoleCrude: "1549c:Thornswood-Content.esp", ThornswoodRecipePoleFine: "1549d:Thornswood-Content.esp",
              ThornswoodRecipePoleMaster: "1549e:Thornswood-Content.esp", ThornswoodRecipeFishTrap: "1549f:Thornswood-Content.esp" };
// The gamemode carries them, in the block once it is rebuilt and in the four
// lines after it until then; either way the gate must say the page's rank.
const gate = {};
Object.keys(ids).forEach(function (e) {
  const k = ids[e];
  if (BLOCK && BLOCK[k]) { gate[e] = BLOCK[k]; return; }
  const m = new RegExp("RECIPES_BY_ID\\['" + k.replace(/[.]/g, "\\.") + "'\\] = (\\{[^\\n]*\\});").exec(gm);
  if (m) { try { gate[e] = new Function("return " + m[1])(); } catch (err) { gate[e] = null; } }
});
yes("the gate asks the Woodwright for each at the rank RECIPE_RANK names", Object.keys(ids).every(function (e) {
  return gate[e] && gate[e].owner === "Woodworker" && gate[e].half === "Woodwright" && RANK[e] && gate[e].rank === RANK[e].Rank;
}));

// ---- the repair kits (#1384) ---------------------------------------------
const KITS = { ThornswoodRecipeWeaponKit: ["Smith", "Edgewright"], ThornswoodRecipeArmorKit: ["Smith", "Platewright"],
               ThornswoodRecipeSewingKit: ["Tailor", "Haberdasher"] };
yes("the three kits are named to the halves #1384 picked", Object.keys(KITS).every(function (e) {
  return OWNER[e] && OWNER[e].Owner === KITS[e][0] && OWNER[e].Half === KITS[e][1];
}));

// ---- the rebuild of 4 October: what the tables say now (#1622) ----------
// Every row a Thornswood-Content.esp recipe makes, in recipes.json and in the
// block, by editor id.
function rowOf(edid) {
  const k = Object.keys(recipes.recipes).filter(function (d) { return recipes.recipes[d].editorId === edid; })[0];
  return k ? { desc: k, row: recipes.recipes[k], gate: BLOCK && BLOCK[k] } : null;
}
yes("the poles and the trap are in the block now, and the four lines after it are gone",
  Object.keys(ids).every(function (e) { return BLOCK && BLOCK[ids[e]] && BLOCK[ids[e]].half === "Woodwright"; }) &&
  !/^RECIPES_BY_ID\[/m.test(gm));

// The kits at the halves and the rank docs/systems/durability.md gives them:
// "All three are novice", with the bench in its table.
const durability = read("docs/systems/durability.md");
yes("the durability page says all three kits are novice", durability.indexOf("All three are novice.") >= 0);
const KIT_BENCH = { ThornswoodRecipeWeaponKit: "CraftingSmithingForge", ThornswoodRecipeArmorKit: "CraftingSmithingForge",
                    ThornswoodRecipeSewingKit: "CraftingTanningRack" };
Object.keys(KITS).forEach(function (e) {
  const r = rowOf(e);
  yes(e + " is " + KITS[e].join("/") + " novice at the " + KIT_BENCH[e] + ", in recipes.json and in the block",
    !!r && r.row.owner === KITS[e][0] && r.row.half === KITS[e][1] && r.row.rank === "novice" && r.row.benchName === KIT_BENCH[e] &&
    r.row.fires === true && !!r.gate && r.gate.owner === KITS[e][0] && r.gate.half === KITS[e][1] && r.gate.rank === "novice");
});

// The four treatments of #1383 at the half and rank docs/systems/injury.md
// gives them, in its table of what each asks for: "Tailor, Haberdasher, novice".
const injury = read("docs/systems/injury.md");
const TREAT = { "Bandage": "ThornswoodRecipeBandage", "Splint": "ThornswoodRecipeSplint",
                "Poultice": "ThornswoodRecipePoultice", "Physicker's Remedy": "ThornswoodRecipeRemedy" };
Object.keys(TREAT).forEach(function (name) {
  const m = new RegExp("^\\| " + name.replace(/[.']/g, "\\$&") + " \\| [^|]+ \\| [^|]+ \\| (\\w+), (\\w+), (novice|advanced|expert|master) \\|$", "m").exec(injury);
  const r = rowOf(TREAT[name]);
  yes(name + " is " + (m ? m[1] + "/" + m[2] + " " + m[3] : "?") + " as the injury page says, in recipes.json and in the block",
    !!m && !!r && r.row.owner === m[1] && r.row.half === m[2] && r.row.rank === m[3] && r.row.fires === true &&
    !!r.gate && r.gate.owner === m[1] && r.gate.half === m[2] && r.gate.rank === m[3]);
});

// Patrick, 4 October, on #1622: "B, each college book staff at its spell's
// rank". The college book is the mage school pages; each staff's spell is the
// HasSpell its recipe carries.
const bookRank = {};
["destruction", "restoration", "alteration", "conjuration", "illusion"].forEach(function (school) {
  read("docs/systems/professions/mage/" + school + ".md").split("\n").forEach(function (line) {
    const m = /^\| ([^|]+?) \| (novice|advanced|expert|master) \| `([^`]+)` \|$/.exec(line);
    if (m) { bookRank[m[3]] = { name: m[1], rank: m[2] }; }
  });
});
const spellSrc = slice(gm, "var STAFF_SPELLS = {", ";\n");
let STAFF = null;
try { STAFF = spellSrc ? new Function("return " + spellSrc.slice("var STAFF_SPELLS = ".length).replace(/;$/, ""))() : null; } catch (e) { STAFF = null; }
const staves = Object.keys(recipes.recipes).filter(function (k) {
  const r = recipes.recipes[k];
  return r.owner === "Enchanter" && r.half === "Bladebinder";
});
const kept = staves.filter(function (k) { return recipes.recipes[k].book !== "cut"; });
yes("the Bladebinder keeps thirteen staves out of 161 (" + kept.length + " of " + staves.length + ")", kept.length === 13 && staves.length === 161);
const spellOf = function (k) {
  const n = (recipes.recipes[k].needs || []).filter(function (x) { return x.function === 264; })[0];
  return n ? n.ofDesc : null;
};
const offRank = kept.filter(function (k) {
  const r = recipes.recipes[k], sp = spellOf(k), b = sp && bookRank[sp], named = RANK[r.editorId];
  return !b || !named || named.Rank !== b.rank || r.rank !== b.rank || r.rankFrom !== "named outright in RECIPE_RANK" ||
    !BLOCK || !BLOCK[k] || BLOCK[k].rank !== b.rank || !STAFF || !STAFF[sp] || STAFF[sp].rank !== b.rank;
});
offRank.forEach(function (k) { console.log("      not at its spell's rank: " + recipes.recipes[k].name); });
yes("each of the thirteen is named in RECIPE_RANK at its spell's rank in the college book, and recipes.json, the block and STAFF_SPELLS agree",
  kept.length === 13 && offRank.length === 0);
const byRank = { novice: 0, advanced: 0, expert: 0, master: 0 };
kept.forEach(function (k) { byRank[recipes.recipes[k].rank]++; });
yes("so the book's staves sit novice 3, advanced 6, expert 4 (" + JSON.stringify(byRank) + ")",
  byRank.novice === 3 && byRank.advanced === 6 && byRank.expert === 4 && byRank.master === 0);
const namedStaves = Object.keys(RANK).filter(function (e) { return /^DLC2RecipeStaff/.test(e); });
yes("RECIPE_RANK names no staff the Bladebinder page cuts", namedStaves.length === 13 &&
  namedStaves.every(function (e) { const r = rowOf(e); return r && r.row.book !== "cut"; }));
const cutStaves = staves.filter(function (k) { return recipes.recipes[k].book === "cut"; });
yes("the 148 cut staves stay where their stone puts them, master by input cost",
  cutStaves.length === 148 && cutStaves.every(function (k) {
    const r = recipes.recipes[k];
    return r.rank === "master" && r.rankFrom === "what its inputs cost a producer";
  }));
yes("no half needs the second rule or the one rung fill for the staves",
  !recipes.halves["Enchanter/Bladebinder"].secondRule && !recipes.halves["Enchanter/Bladebinder"].movedOneRung &&
  Object.keys(recipes.halves).every(function (h) { return !recipes.halves[h].secondRule; }));
const unstand = (knob("HALVES_WITH_AN_UNSTANDABLE_RUNG") || {})["Enchanter/Bladebinder"] || "";
yes("the Bladebinder's unstandable rung reason says master mining and the answer, and recipes.json carries it",
  unstand.indexOf("which is master mining") >= 0 && unstand.indexOf("each college book staff at its spell's rank") >= 0 &&
  recipes.halves["Enchanter/Bladebinder"].andThatIsAllowedBecause === unstand);
yes("and nothing in the build or recipes.json still says the stone is advanced mining",
  ps.indexOf("which Patrick made advanced mining") < 0 && JSON.stringify(recipes).indexOf("advanced mining") < 0);

console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
