// test-1808-hunt-not-a-body.js
//
// #1808. game/data/hunts.json carried bodies a hunter never stands over: the
// guardian spirits, the Companions' wolf spirits, the Spectral Warhound, spell
// actors (Fire Storm, Odin's Flaming Thrall and familiars, Arvak, a summoned
// frost troll, YokuWeapons' Jar Bomb), a mod's hidden actors (Odin's Buried
// Storage, FishingInSkyrim's net) and DLC2EncNetchTest, a test netch whose
// death item is the mammoth's. The table's own rule is a race carrying
// ActorTypeAnimal, and every one of those has such a race.
//
// scripts/dev/Build-HuntTable.ps1 now takes them out by rules read off the
// records (NOT A BODY TO DRESS in its knobs) and lists each under skipped with
// the rule's words. This runs a copy of the builder against a small Data
// folder made here, one base per rule and one beside it that the rule must not
// reach, beside a copy of the real gamemode. It also holds the builder to LF
// in both files whatever ending it finds (the hunt table's share of #1787,
// #1828 and #3029), and shows a knob that names nothing in the load order stops the run
// with the table left as it was. Nothing outside a temporary folder is written.
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

const script = fs.readFileSync(path.join(REPO_DIR, "scripts", "dev", "Build-HuntTable.ps1"), "utf8");
const hunts = JSON.parse(fs.readFileSync(path.join(REPO_DIR, "game", "data", "hunts.json"), "utf8"));

// ---- the checked-in table ----------------------------------------------------
const GONE = {
  "2173b:Dragonborn.esm": "the test Netch that gave mammoth parts",
  "e7eaf:Skyrim.esm": "Mammoth Guardian Spirit",
  "9ce28:Skyrim.esm": "Flaming Thrall",
  "877eb:Skyrim.esm": "Fire Storm",
  "1b829f:Odin - Skyrim Magic Overhaul.esp": "Buried Storage",
  "863:YokuWeapons.esp": "Jar Bomb",
  "f9060:Skyrim.esm": "Spectral Warhound",
  "58303:Skyrim.esm": "Kodlak's Wolf Spirit",
  "d64:FishingInSkyrim.esp": "FishingInSkyrim's net"
};
for (const k of Object.keys(GONE)) {
  const sk = hunts.skipped.filter(function (s) { return s.desc === k; })[0];
  yes("hunts.json has no row for " + GONE[k] + " (" + k + ") and lists it under skipped with a reason",
    !hunts.hunts[k] && !hunts.detail[k] && !!sk && sk.why.length > 20);
}
yes("hunts.json keeps the arena's animal gladiators, a bear, a wolf and a sabre cat with their own parts",
  ["c12a", "c12b", "c12c"].every(function (b) { return !!hunts.hunts[b + ":Solitude Arena.esp"]; }) &&
  hunts.hunts["c12a:Solitude Arena.esp"].gives.some(function (g) { return g.name === "Bear Pelt"; }));
yes("no row gives a mammoth's parts but a mammoth's",
  Object.keys(hunts.hunts).every(function (k) {
    const r = hunts.hunts[k];
    return !r.gives.some(function (g) { return /Mammoth/.test(g.name); }) || /Mammoth/.test(r.name);
  }));
yes("no row gives ectoplasm", Object.keys(hunts.hunts).every(function (k) {
  return !hunts.hunts[k].gives.some(function (g) { return g.name === "Ectoplasm"; });
}));
yes("count matches the rows", hunts.count === Object.keys(hunts.hunts).length);
const huntTable = require('./gamemode-tables.js').table('HUNTS_BY_BASE');
yes("the gamemode's HUNTS_BY_BASE table holds the same " + hunts.count + " rows as hunts.json",
  Object.keys(huntTable).length === hunts.count &&
  Object.keys(GONE).every(function (k) { return !huntTable[k]; }));

// ---- plugin records ------------------------------------------------------------
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
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0, 0); return b; }
function header(masters) {
  const hedr = Buffer.alloc(12); hedr.writeFloatLE(1.7, 0);
  const subs = [sub("HEDR", hedr)];
  for (const m of masters || []) { subs.push(sub("MAST", z(m)), sub("DATA", Buffer.alloc(8))); }
  return rec("TES4", 0, subs);
}
function wstr(s) { const b = Buffer.alloc(2); b.writeUInt16LE(s.length, 0); return Buffer.concat([b, Buffer.from(s, "ascii")]); }
// VMAD version 5, object format 2. A script's properties are stepped over by
// the reader, so the first script carries one of each kind it has to step.
function vmad(scripts) {
  const head = Buffer.alloc(6); head.writeInt16LE(5, 0); head.writeInt16LE(2, 2); head.writeUInt16LE(scripts.length, 4);
  const parts = [head];
  for (const s of scripts) {
    const props = s.props || [];
    const pc = Buffer.alloc(2); pc.writeUInt16LE(props.length, 0);
    parts.push(wstr(s.name), Buffer.from([1]), pc);
    for (const p of props) { parts.push(wstr(p.name), Buffer.from([p.type, 1]), p.value); }
  }
  return Buffer.concat(parts);
}
const ALL_KINDS = [
  { name: "Obj", type: 1, value: Buffer.alloc(8) },
  { name: "Str", type: 2, value: wstr("Dirt Cloud") },
  { name: "Int", type: 3, value: u32(7) },
  { name: "Flt", type: 4, value: u32(0) },
  { name: "Bool", type: 5, value: Buffer.from([1]) },
  { name: "Objs", type: 11, value: Buffer.concat([u32(2), Buffer.alloc(16)]) },
  { name: "Strs", type: 12, value: Buffer.concat([u32(2), wstr("a"), wstr("bc")]) },
  { name: "Ints", type: 13, value: Buffer.concat([u32(1), u32(3)]) },
  { name: "Flts", type: 14, value: Buffer.concat([u32(1), u32(0)]) },
  { name: "Bools", type: 15, value: Buffer.concat([u32(3), Buffer.from([1, 0, 1])]) }
];
// ACBS: the flags as a uint32 at 0, the template flags as a uint16 at 18
function acbs(flags, tmpl) {
  const b = Buffer.alloc(24); b.writeUInt32LE(flags >>> 0, 0); b.writeUInt16LE(tmpl || 0, 18); return b;
}
function npc(fid, edid, o) {
  const subs = [sub("EDID", z(edid))];
  if (o.full) { subs.push(sub("FULL", z(o.full))); }
  if (o.vmad) { subs.push(sub("VMAD", o.vmad)); }
  subs.push(sub("ACBS", acbs(o.flags || 0, o.tmpl || 0)));
  for (const s of o.spells || []) { subs.push(sub("SPLO", u32(s))); }
  if (o.inam) { subs.push(sub("INAM", u32(o.inam))); }
  subs.push(sub("RNAM", u32(o.race)));
  if (o.tplt) { subs.push(sub("TPLT", u32(o.tplt))); }
  subs.push(sub("CNAM", u32(0x900)));
  return rec("NPC_", fid, subs);
}
function lvl(tag, fid, edid, entries) {
  const subs = [sub("EDID", z(edid)), sub("LVLD", Buffer.from([0]))];
  for (const e of entries) {
    const o = Buffer.alloc(12); o.writeUInt16LE(1, 0); o.writeUInt32LE(e, 4); o.writeUInt16LE(1, 8);
    subs.push(sub("LVLO", o));
  }
  return rec(tag, fid, subs);
}
function ingr(fid, edid, name, value) {
  const d = Buffer.alloc(8); d.writeUInt32LE(value, 0); d.writeFloatLE(0.5, 4);
  return rec("INGR", fid, [sub("EDID", z(edid)), sub("FULL", z(name)), sub("DATA", d)]);
}
function race(fid, edid, name, kws) {
  return rec("RACE", fid, [sub("EDID", z(edid)), sub("FULL", z(name)), sub("KWDA", Buffer.concat(kws.map(u32)))]);
}

const K_ANIMAL = 0x100, K_NPC = 0x101;
const R_WOLF = 0x200, R_SPIRIT = 0x201, R_NORD = 0x202, R_NETCH = 0x203;
const I_PELT = 0x300, I_ECTO = 0x301, I_TUSK = 0x302;
const D_WOLF = 0x400, D_GHOST = 0x401, D_MAMMOTH = 0x402;
const GHOST_SPELLS = ["GhostAbility", "GhostAbilityFire", "GhostAbilityFireNoAlpha", "GhostAbilityFrost",
  "GhostAbilityNew", "GhostAbilityStorm", "GhostAbilityViolet"];
const SUMMONABLE = 0x4000, GHOST = 0x20000000;
const USE_TRAITS = 0x1, USE_SPELLS = 0x8, USE_BASE = 0x80, USE_SCRIPT = 0x200;

// [form id, editor id, what the record is, whether it stays in the table]
const BASES = [
  [0x500, "TestWolf", { race: R_WOLF, inam: D_WOLF }, true, "a plain wolf"],
  [0x501, "TestSummonedWolf", { race: R_WOLF, inam: D_WOLF, flags: SUMMONABLE }, false, "a Summonable wolf"],
  [0x502, "TestSummonedThroughBase", { race: R_WOLF, inam: D_WOLF, tmpl: USE_BASE, tplt: 0x501 }, false,
    "a wolf whose Use Base Data template is Summonable"],
  [0x503, "TestOwnBaseData", { race: R_WOLF, inam: D_WOLF, tmpl: USE_TRAITS, tplt: 0x501 }, true,
    "a wolf whose template is Summonable but which keeps its own base data"],
  [0x504, "TestGhostFlag", { race: R_WOLF, inam: D_WOLF, flags: GHOST }, false, "an Is Ghost wolf"],
  [0x505, "TestGhostScript", { race: R_WOLF, inam: D_WOLF,
    vmad: vmad([{ name: "SomeOtherScript", props: ALL_KINDS }, { name: "defaultGhostScript", props: [ALL_KINDS[0]] }]) }, false,
    "a wolf carrying defaultGhostScript second, behind a script with one property of every kind"],
  [0x506, "TestGhostScriptReplaced", { race: R_WOLF, inam: D_WOLF, tmpl: USE_SCRIPT, tplt: 0x500,
    vmad: vmad([{ name: "defaultGhostScript" }]) }, true,
    "a wolf whose own ghost script is replaced by its template's, because Use Script is set"],
  [0x507, "TestGhostScriptThroughTemplate", { race: R_WOLF, inam: D_WOLF, tmpl: USE_SCRIPT, tplt: 0x505 }, false,
    "a wolf whose Use Script template carries the ghost script"],
  [0x508, "TestGhostSpell", { race: R_WOLF, inam: D_WOLF, spells: [0x606] }, false, "a wolf with GhostAbilityViolet in its spells"],
  [0x509, "TestOtherSpell", { race: R_WOLF, inam: D_WOLF, spells: [0x6ff] }, true, "a wolf with another ability"],
  [0x50a, "TestGhostItem", { race: R_WOLF, inam: D_GHOST }, false, "a wolf whose death item is DeathItemGhost"],
  [0x50b, "TestSpiritRace", { race: R_SPIRIT, inam: D_WOLF }, false, "a wolf of C06WolfSpiritRace"],
  [0x50c, "TestListAllSummoned", { race: R_WOLF, inam: D_WOLF, tmpl: USE_TRAITS | USE_BASE, tplt: 0x700 }, false,
    "a base whose template list is all Summonable"],
  [0x50d, "TestListPartlySummoned", { race: R_WOLF, inam: D_WOLF, tmpl: USE_TRAITS | USE_BASE, tplt: 0x701 }, true,
    "a base whose template list is partly real wolves"],
  [0x50e, "TestBroken", { race: R_WOLF, inam: D_WOLF, vmad: Buffer.from([5, 0, 2, 0, 1, 0, 3, 0]) }, true,
    "(the broken VMAD, used only in the run that must stop)"]
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tw-1808-"));
try {
  function buildData(dir, opts) {
    fs.mkdirSync(dir);
    const npcs = BASES.filter(function (b) { return opts.broken || b[0] !== 0x50e; })
      .map(function (b) { return npc(b[0], b[1], b[2]); });
    const spells = GHOST_SPELLS.filter(function (s) { return s !== opts.dropSpell; })
      .map(function (s, i) { return rec("SPEL", 0x600 + GHOST_SPELLS.indexOf(s), [sub("EDID", z(s))]); });
    spells.push(rec("SPEL", 0x6ff, [sub("EDID", z("AbWolfRegen"))]));
    fs.writeFileSync(path.join(dir, "Skyrim.esm"), Buffer.concat([header(),
      grup("KYWD", [rec("KYWD", K_ANIMAL, [sub("EDID", z("ActorTypeAnimal"))]), rec("KYWD", K_NPC, [sub("EDID", z("ActorTypeNPC"))])]),
      grup("SPEL", spells),
      grup("RACE", [race(R_WOLF, "WolfRace", "Wolf", [K_ANIMAL]), race(R_SPIRIT, "C06WolfSpiritRace", "Wolf", [K_ANIMAL]),
        race(R_NORD, "NordRace", "Nord", [K_NPC]), race(R_NETCH, "DLC2NetchRace", "Netch", [K_ANIMAL])]),
      grup("INGR", [ingr(I_PELT, "WolfPelt", "Wolf Pelt", 10), ingr(I_ECTO, "Ectoplasm", "Ectoplasm", 25),
        ingr(I_TUSK, "MammothTusk", "Mammoth Tusk", 150)]),
      grup("LVLI", [lvl("LVLI", D_WOLF, "DeathItemWolf", [I_PELT]), lvl("LVLI", D_GHOST, "DeathItemGhost", [I_ECTO]),
        lvl("LVLI", D_MAMMOTH, "DeathItemMammoth", [I_TUSK])]),
      grup("LVLN", [lvl("LVLN", 0x700, "TestLvlSummoned", [0x501, 0x501]), lvl("LVLN", 0x701, "TestLvlMixed", [0x501, 0x500])]),
      grup("NPC_", npcs)]));
    ["Update.esm", "Dawnguard.esm", "HearthFires.esm"].forEach(function (m) { fs.writeFileSync(path.join(dir, m), header()); });
    // DLC2EncNetchTest, 2173b:Dragonborn.esm, named in LEFT_OUT. Its race and
    // death item are Skyrim.esm's, so Dragonborn.esm has that one master and
    // its own records carry index 1.
    const netch = opts.noNetch ? [] : [grup("NPC_", [npc(0x0102173b, "DLC2EncNetchTest", { race: R_NETCH, inam: D_MAMMOTH, full: "Netch" })])];
    fs.writeFileSync(path.join(dir, "Dragonborn.esm"), Buffer.concat([header(["Skyrim.esm"])].concat(netch)));
  }
  const pluginsTxt = path.join(tmp, "plugins.txt");
  fs.writeFileSync(pluginsTxt, "# Automatically generated by Vortex\r\n");
  const repo = path.join(tmp, "repo");
  fs.mkdirSync(path.join(repo, "scripts", "dev"), { recursive: true });
  fs.mkdirSync(path.join(repo, "game", "data"), { recursive: true });
  fs.mkdirSync(path.join(repo, "records"), { recursive: true });
  const ps1 = path.join(repo, "scripts", "dev", "Build-HuntTable.ps1");
  fs.writeFileSync(ps1, script);
  fs.copyFileSync(path.join(REPO_DIR, "scripts", "dev", "OwnPlugins.ps1"), path.join(repo, "scripts", "dev", "OwnPlugins.ps1"));
  fs.copyFileSync(path.join(REPO_DIR, "records", "update-creation-club.json"), path.join(repo, "records", "update-creation-club.json"));
  fs.copyFileSync(path.join(REPO_DIR, "scripts", "dev", "GamemodeTables.ps1"), path.join(repo, "scripts", "dev", "GamemodeTables.ps1"));
  // Since #5191 the builder writes the gamemode's table into its own file.
  const gm = path.join(repo, "game", "gamemode-tables", "HUNTS_BY_BASE.json");
  const out = path.join(repo, "game", "data", "hunts.json");

  const ver = cp.spawnSync("pwsh", ["--version"], { encoding: "utf8" });
  yes("pwsh is on this machine, so the hunt builder can be run", !ver.error && ver.status === 0);
  function build(data) {
    const r = cp.spawnSync("pwsh", ["-NoProfile", "-File", ps1, "-Data", data, "-PluginList", pluginsTxt, "-Out", out],
      { encoding: "utf8", timeout: 170000 });
    return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
  }
  function failures(r) { return r.out.split("\n").filter(function (l) { return /FAIL|rror/.test(l); }).slice(0, 20).join("\n"); }

  if (!ver.error && ver.status === 0) {
    const data = path.join(tmp, "Data");
    buildData(data, {});
    fs.writeFileSync(out, "{\n  \"old\": true\n}\n");
    const r = build(data);
    yes("a run against the small Data folder writes the table and the gamemode's table file (exit " + r.code + ")",
      r.code === 0 && /wrote .*hunts\.json \(\d+ animals/.test(r.out) && /animals into .*HUNTS_BY_BASE\.json/.test(r.out));
    if (r.code !== 0) { console.log(failures(r)); }
    let doc = null;
    try { doc = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { doc = null; }
    yes("the table parses", !!doc && !!doc.hunts);
    if (doc && doc.hunts) {
      const why = {};
      for (const s of doc.skipped) { why[s.desc] = s.why; }
      for (const b of BASES) {
        if (b[0] === 0x50e) { continue; }
        const d = b[0].toString(16) + ":Skyrim.esm";
        if (b[3]) { yes("stays in the table: " + b[4], !!doc.hunts[d] && !why[d]); }
        else { yes("left out and listed under skipped: " + b[4], !doc.hunts[d] && !!why[d]); }
      }
      yes("the test netch (LEFT_OUT) is left out with its reason",
        !doc.hunts["2173b:Dragonborn.esm"] && /mammoth/.test(why["2173b:Dragonborn.esm"] || ""));
      yes("each reason names its rule", /Summonable/.test(why["501:Skyrim.esm"] || "") && /Is Ghost/.test(why["504:Skyrim.esm"] || "") &&
        /defaultGhostScript/.test(why["505:Skyrim.esm"] || "") && /ghost ability/.test(why["508:Skyrim.esm"] || "") &&
        /DeathItemGhost/.test(why["50a:Skyrim.esm"] || "") && /C06WolfSpiritRace/.test(why["50b:Skyrim.esm"] || ""));
      yes("the count is the rows: " + doc.count, doc.count === Object.keys(doc.hunts).length && doc.count === 5);
      yes("the run prints each rule's count", /SUMMONABLE_BIT\s+3/.test(r.out) && /GHOST_BIT\s+1/.test(r.out) &&
        /GHOST_SCRIPT\s+2/.test(r.out) && /GHOST_SPELLS\s+1/.test(r.out) && /GHOST_DEATH_ITEM\s+1/.test(r.out) &&
        /SPIRIT_RACES\s+1/.test(r.out) && /LEFT_OUT\s+1/.test(r.out));
    }
    const t1 = fs.readFileSync(out, "utf8");
    const g1 = fs.existsSync(gm) ? fs.readFileSync(gm, "utf8") : "";
    yes("an LF hunts.json stays LF", t1.indexOf(CR) < 0 && /"editorId": "TestWolf",\n      "name"/.test(t1));
    let gt = null;
    try { gt = JSON.parse(g1); } catch (e) { gt = null; }
    yes("the gamemode's table file is LF and holds the wolf", g1.indexOf(CR) < 0 && !!gt && !!gt["500:Skyrim.esm"] && gt["500:Skyrim.esm"].name === "Wolf");
    const r2 = build(data);
    yes("a second run changes neither file", r2.code === 0 && fs.readFileSync(out, "utf8") === t1 && fs.readFileSync(gm, "utf8") === g1);

    fs.writeFileSync(gm, "{\r\n\"old\":1\r\n}\r\n");
    fs.writeFileSync(out, "{\r\n  \"old\": true\r\n}\r\n");
    const r3 = build(data);
    yes("a CRLF hunts.json comes out LF", r3.code === 0 && fs.readFileSync(out, "utf8") === t1);
    yes("and a CRLF table file is written over LF", r3.code === 0 && fs.readFileSync(gm, "utf8") === g1);
    fs.unlinkSync(out);
    const r4 = build(data);
    yes("a new hunts.json is written with LF", r4.code === 0 && fs.readFileSync(out, "utf8") === t1);

    // ---- the refusals: each stops the run and leaves the table as it was ------
    fs.writeFileSync(out, "{\n  \"kept\": true\n}\n");
    const cases = [
      ["a ghost ability named in GHOST_SPELLS that the load order does not have", { dropSpell: "GhostAbilityStorm" },
        /GhostAbilityStorm is named in GHOST_SPELLS and no SPEL record/],
      ["a base named in LEFT_OUT that is not an animal in the load order", { noNetch: true },
        /2173b:Dragonborn\.esm is named in LEFT_OUT and is not an animal/],
      ["a script list it cannot read", { broken: true }, /the scripts on 50e:Skyrim\.esm \(TestBroken\) could not be read/]
    ];
    let n = 0;
    for (const c of cases) {
      const dir = path.join(tmp, "Data" + (++n));
      buildData(dir, c[1]);
      const rr = build(dir);
      yes("the run stops on " + c[0] + " (exit " + rr.code + ") and leaves the table as it was",
        rr.code === 1 && c[2].test(rr.out) && fs.readFileSync(out, "utf8") === "{\n  \"kept\": true\n}\n");
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
