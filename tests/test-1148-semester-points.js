// test-1148-semester-points.js
//
// #1148. The rulebook (#391, THE MAGE EXCEPTION): "At the College each
// semester you can study for two more spell points. Outside the College each
// semester you may choose a school if you have not already got one from a
// master or an earlier semester, and study for one spell point and novice
// spells only." When #1148 was filed, LIMITS.collegeSemester (2) and
// LIMITS.outsiderSemester (1) were read by nothing. #1387 (#1687) built the
// semester; this holds the rules to the rulebook and the pages, and the pages
// to Patrick's answer on #1387 (4 Oct): somebody a Master mage taught needs a
// semester's point and one of their 2 places for each spell.
//
// The behaviour of the Study button, the rooms and the restart is
// tests/test-1387-college.js. This runs the progression block alone.
//
// Read only.
const REPO_DIR = require("path").join(__dirname, "..");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const CR = String.fromCharCode(13);
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), "utf8").split(CR).join(""); }
const gm = require('./gamemode-tables.js').joined(read("game/gamemode.js"));
function flat(s) { return s.replace(/\s+/g, " "); }

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

const block = slice(gm, "// ==== thornswood progression ====", "// ==== end thornswood progression ====");
yes("the progression block is in the gamemode", block !== null);
const box = { console: { log: function () {} } };
box.globalThis = box;
if (block) { vm.runInNewContext(block, box); }
const P = box.__thornswoodProgression;
yes("the rules registered", !!P && !!P.TABLE && typeof P.study === "function");
if (!P || !P.TABLE) {
  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(1);
}
const L = P.TABLE.limits;
const HOUR = 3600000;
const t0 = 1800000000000;

// ---------------------------------------------------------- the numbers

yes("the rulebook's numbers: 2 a semester for a mage, 1 for anybody else, a semester is 24 hours",
  L.collegeSemester === 2 && L.outsiderSemester === 1 && L.semesterHours === 24 && L.outsiderSpells === 2);
const rulesNoComments = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
function reads(name) {
  const re = new RegExp("\\bLIMITS\\." + name + "\\b", "g");
  return (rulesNoComments.match(re) || []).length;
}
yes("both limits are read by the rules now, not only written down (" + reads("collegeSemester") + ", " + reads("outsiderSemester") + ")",
  reads("collegeSemester") >= 1 && reads("outsiderSemester") >= 1 &&
  /var gain = mage \? LIMITS\.collegeSemester : LIMITS\.outsiderSemester;/.test(rulesNoComments));

// ---------------------------------------------------------- a mage

const mage = P.pickProfession(P.fresh(), "mage", ["destruction", "restoration"]).state;
const start = P.spellPoints(mage);
const m1 = P.study(mage, t0);
yes("a mage's semester is two more spell points (" + start + " to " + (m1.ok ? P.spellPoints(m1.state) : "refused") + ")",
  m1.ok && m1.gained === 2 && P.spellPoints(m1.state) === start + 2);
const m2 = P.study(m1.state, t0 + 23 * HOUR);
yes("once a semester: not again inside 24 hours (" + m2.why + ")", !m2.ok);
const m3 = P.study(m1.state, t0 + 24 * HOUR);
yes("and again at 24 hours", m3.ok && P.spellPoints(m3.state) === start + 4);

// ---------------------------------------------------------- anybody else

const smith = P.pickProfession(P.fresh(), "smith", "edgewright").state;
const lone = P.study(smith, t0);
yes("somebody nobody taught studies nothing and is not given a school (" + lone.why + ")",
  !lone.ok && /magic is not yours/.test(lone.why) && P.schoolsOf(smith).length === 0);
yes("the pages say why: anybody else casts nothing until a master mage takes them on",
  /Anybody else casts nothing until a master mage apprentices them/.test(flat(read("docs/systems/magic.md"))) &&
  /They do not pick schools on K/.test(flat(read("docs/systems/apprenticeship.md"))));

const master = P.pickProfession(P.fresh(), "mage", ["destruction", "illusion"]).state;
master.ranks.destruction = "master";
const taught = P.teach(smith, master, "destruction").state;
const flames = { name: "Flames", school: "destruction", rank: "novice" };
const o1 = P.study(taught, t0);
yes("somebody a Master mage taught: a semester is one spell point, for the school they were taught",
  o1.ok && o1.gained === 1 && o1.school === "destruction" && P.spellPoints(o1.state) === 1);
const fireball = P.learnFromTome(o1.state, { name: "Fireball", school: "destruction", rank: "advanced" });
yes("novice spells only: the point does not buy Fireball", !fireball.ok && fireball.missing.some(function (m) { return m.what === "level"; }));
const noPoint = P.learnFromTome(taught, flames);
yes("Patrick's answer on #1387: a place alone does not teach a tome (" + (noPoint.missing || []).map(function (m) { return m.why; }).join("; ") + ")",
  !noPoint.ok && P.placesLeft(taught) === 2 && noPoint.missing[0].what === "points" && /semester at the College/.test(noPoint.missing[0].why));
const withPoint = P.learnFromTome(o1.state, flames);
yes("a semester's point and a place teach the novice tome, and spend the point", withPoint.ok && P.spellPoints(withPoint.state) === 0);
const s2 = P.study(withPoint.state, t0 + 24 * HOUR);
const sparks = P.learnFromTome(s2.state, { name: "Sparks", school: "destruction", rank: "novice" });
const s3 = P.study(sparks.state, t0 + 48 * HOUR);
const third = P.learnFromTome(s3.state, { name: "Frostbite", school: "destruction", rank: "novice" });
yes("a point and no place left does not teach a third (" + (third.missing || []).map(function (m) { return m.why; }).join("; ") + ")",
  sparks.ok && s3.ok && s3.state.spells.points === 1 && P.placesLeft(s3.state) === 0 && !third.ok);

// ---------------------------------------------------------- the pages say the decision

const magic = flat(read("docs/systems/magic.md"));
const appr = flat(read("docs/systems/apprenticeship.md"));
const mageP = flat(read("docs/systems/professions/mage.md"));
yes("magic.md's first gate gives anybody else a semester's point and a place",
  /Anybody else earns 1 with a semester at the College, and each spell also takes one of the 2 places a master gave them/.test(magic));
yes("magic.md says Patrick decided they need both", /Patrick decided on 4 October that they need both \(issue 1387\)/.test(magic));
yes("apprenticeship.md's gates and Where this is say the same",
  /a semester's point and a place under those 2/.test(appr) && /Patrick decided on 4 October that they need both \(issue 1387\)/.test(appr));
yes("mage.md says each spell takes a place and a semester's point", /each spell takes a place and a point from a semester at the College/.test(mageP));
yes("no page or comment still says the question is open",
  !/places alone should (still )?be enough is asked/.test(magic + appr + flat(gm.split("\n").filter(function (l) { return l.length < 2000; }).join("\n"))));
yes("the semester's own harness is on the build's gate (not in tests/gate-excluded.txt, #3009)", !/^test-1387-college\.js\s/m.test(read("tests/gate-excluded.txt")));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
