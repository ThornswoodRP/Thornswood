// test-1715-light-manifest.js
//
// #1715. Once the engine loads light plugins it writes them into its
// manifest apart from the full ones: "mods" stays the full plugins, because
// the client's own check walks it position by position against
// Game.getModName, which counts full plugins only, and "light" lists the
// light plugins in light index order. "loadOrder" is the server's whole
// order, full and light together. The gamemode publishes that manifest where
// the launcher asks for it, and the launcher holds every machine's light
// order to the "light" list.
//
// The engine decides which plugins are light (from each header, the same
// rule as espm::IsLightPlugin). The gamemode must pass its answer on as it
// is: deciding again from the files would be a second answer that can
// disagree with the first.
//
// The gamemode's server manifest block is run here against a pretend disk,
// the way test-1180-own-plugins.js runs it. The launcher's half is held by
// its text; tests\test-load-order.ps1 runs its light order code.
//
// Read only.
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const REPO_DIR = process.argv[2] || path.join(__dirname, "..");
const CR = String.fromCharCode(13);
function read() {
  return fs.readFileSync(path.join.apply(path, [REPO_DIR].concat([].slice.call(arguments))), "utf8").split(CR).join("");
}
const gm = read("game", "gamemode.js");
const verify = read("launcher", "app", "Verify.cs");

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

const block = slice(gm, "// ==== thornswood server manifest ====", "// ==== end thornswood server manifest ====");
yes("the server manifest block is in the gamemode", block !== null);

const MASTERS = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"];
const FULL = MASTERS.concat(["Water for ENB.esm", "Thornswood-Content.esp", "Skyrim Unbound.esp"]);
const LIGHT = ["_ResourcePack.esl", "Expressive Facegen Morphs.esl", "KhisartinBeards.esp", "HammerHair.esp"];
const WHOLE = MASTERS.concat(["_ResourcePack.esl", "Water for ENB.esm", "Expressive Facegen Morphs.esl", "KhisartinBeards.esp",
  "Thornswood-Content.esp", "HammerHair.esp", "Skyrim Unbound.esp"]);

function entry(n, i) { return { filename: n, size: 1000 + i, crc32: i }; }

function run(manifest) {
  const files = {};
  const log = [];
  function norm(p) { return path.posix.normalize(String(p).split("\\").join("/")); }
  function put(p, d) { files[norm(p)] = d; }
  put("data/manifest.json", JSON.stringify(manifest));
  put("server-settings.json", JSON.stringify({ dataDir: "data", loadOrder: WHOLE.map(function (n) { return "/srv/plugins/" + n; }) }));
  WHOLE.forEach(function (n) { put("/srv/plugins/" + n, "bytes of " + n); });
  const fake = {
    readFileSync: function (p) { const k = norm(p); if (!(k in files)) { throw new Error("ENOENT: " + k); } return files[k]; },
    writeFileSync: function (p, d) { put(p, String(d)); },
    existsSync: function (p) { return norm(p) in files; },
    mkdirSync: function () {},
    readdirSync: function () { return []; },
    unlinkSync: function (p) { delete files[norm(p)]; },
    linkSync: function (s, d) { files[norm(d)] = files[norm(s)]; },
    copyFileSync: function (s, d) { files[norm(d)] = files[norm(s)]; },
    // Reading a plugin's header is the engine's job, not the gamemode's.
    openSync: function () { throw new Error("the gamemode opened a plugin file"); }
  };
  const box = {
    require: function (name) { return name === "fs" ? fake : name === "path" ? path.posix : null; },
    console: { log: function () { log.push([].join.call(arguments, " ")); } },
    // The engine's whole-file write (#2740), onto the fake disk.
    mp: { writeFileWhole: function (p, text) { fake.writeFileSync(p, text); } },
    setInterval: function () { return 0; },
    clearInterval: function () {}
  };
  box.globalThis = box;
  vm.runInNewContext(block, box);
  let out = null;
  try { out = JSON.parse(files["data/api/servers/thornswood/manifest.json"]); } catch (e) { out = null; }
  return { manifest: out, log: log, box: box };
}

function names(list) { return (list || []).map(function (m) { return m.filename; }); }

if (block) {
  // What an engine that loads light plugins writes: the full plugins in mods
  // (an archive after one of them, which is left out), the light ones apart.
  const mods = FULL.map(entry);
  mods.splice(6, 0, { filename: "Water for ENB.bsa", size: 5, crc32: 5 });
  const light = LIGHT.map(entry);
  light.splice(3, 0, { filename: "KhisartinBeards.bsa", size: 6, crc32: 6 });
  const a = run({ versionMajor: 1, mods: mods, light: light, loadOrder: WHOLE.map(function (n) { return "/srv/plugins/" + n; }) });

  yes("the manifest is published", !!a.manifest);
  yes("mods stays the full plugins, archives left out, so the client's own check is unchanged",
      !!a.manifest && JSON.stringify(names(a.manifest.mods)) === JSON.stringify(FULL));
  yes("light is the engine's light list, in its order, archives left out: " + (a.manifest ? names(a.manifest.light).join(", ") : ""),
      !!a.manifest && JSON.stringify(names(a.manifest.light)) === JSON.stringify(LIGHT));
  yes("each light entry keeps its size and crc32, for the launcher's byte check",
      !!a.manifest && Array.isArray(a.manifest.light) && a.manifest.light.length === LIGHT.length && a.manifest.light[2].size === 1002 && a.manifest.light[2].crc32 === 2);
  yes("loadOrder is the server's whole order, full and light together",
      !!a.manifest && Array.isArray(a.manifest.loadOrder) && a.manifest.loadOrder.length === WHOLE.length &&
      path.posix.basename(a.manifest.loadOrder[5]) === "_ResourcePack.esl");
  yes("served names our plugin and nothing light", !!a.manifest && JSON.stringify(a.manifest.served) === JSON.stringify(["Thornswood-Content.esp"]));
  yes("the refusal block still gets the full plugins the client is compared with",
      Array.isArray(a.box.__thornswoodManifestMods) && JSON.stringify(names(a.box.__thornswoodManifestMods)) === JSON.stringify(FULL));
  yes("the log counts both kinds",
      a.log.some(function (l) { return /manifest published at \/api\/servers\/thornswood\/manifest\.json, 8 plugins and 4 light plugins/.test(l); }));

  // What an engine that loads no light plugin writes: no light list.
  const b = run({ versionMajor: 1, mods: FULL.map(entry), loadOrder: FULL });
  // The client compares its light plugins with the server's only when the
  // manifest has the list (loadOrderCheck.ts in the fork), so an empty list
  // here would tell everybody with a light plugin they have more than the
  // server.
  yes("an engine that writes no light list: no light list is published, and mods is every plugin",
      !!b.manifest && !("light" in b.manifest) && JSON.stringify(names(b.manifest.mods)) === JSON.stringify(FULL));
  yes("  and the refusal block is told there is none",
      b.box.__thornswoodManifestLight === null && Array.isArray(a.box.__thornswoodManifestLight) &&
      JSON.stringify(names(a.box.__thornswoodManifestLight)) === JSON.stringify(LIGHT));
  yes("  and the log says nothing about light plugins",
      b.log.some(function (l) { return /, 8 plugins/.test(l); }) && !b.log.some(function (l) { return /light plugins/.test(l); }));

  const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  yes("the block reads no plugin's header itself", !/openSync|readSync|0x200/.test(code));
}

// The launcher reads the same two fields.
yes("the launcher reads the light list and the whole order from the manifest",
    /\[JsonInclude\] public ServerMod\[\] light;/.test(verify) && /\[JsonInclude\] public string\[\] loadOrder;/.test(verify));
yes("and puts a plugin list into the whole order when there is a light list",
    /LoadOrder\.ReorderWhole\(lines, whole, ccc\)/.test(verify));

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
