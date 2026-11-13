// test-1885-manifest-order.js
//
// #1885. The gamemode's server manifest block publishes the load order
// manifest at load. When that failed it tried again every second for twenty
// seconds and then stopped without a word, under a comment saying the case
// should not happen. It cannot happen: the engine's main() writes
// data/manifest.json (manifestGen.generateManifest, with writeFileSync) and
// only after that loads the gamemode (setupGamemode). So the timer is gone,
// the block publishes once, and a publish that fails says so in one error
// line with the reason and takes off what an earlier start published.
//
// This drives that start order against a pretend disk with every timer
// refused: the settings, generateManifest, then the gamemode. With the fork
// on this machine (engine\skymp, or SKYMP=<path>) it also reads the order in
// the engine's own source; without it those checks say SKIP.
//
// Read only.
const REPO_DIR = require("path").join(__dirname, "..", "..");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const CR = String.fromCharCode(13);
function read() {
  return fs.readFileSync(path.join.apply(path, [REPO_DIR].concat([].slice.call(arguments))), "utf8").split(CR).join("");
}
const gm = read("game", "gamemode.js");
const FORK = process.env.SKYMP || path.join(REPO_DIR, "engine", "skymp");
function readFork(rel) {
  try { return fs.readFileSync(path.join(FORK, rel), "utf8").split(CR).join(""); } catch (e) { return null; }
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log("PASS  " + what); }
  else { fail++; console.log("FAIL  " + what); }
}
function skip(what) { console.log("SKIP  " + what); }
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}
function strip(code) { return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/.*$/gm, ""); }

const block = slice(gm, "// ==== thornswood server manifest ====", "// ==== end thornswood server manifest ====");
yes("the server manifest block is in the gamemode", block !== null);

// ------------------------------------------------ the engine's start order

{
  const index = readFork("skymp5-server/ts/index.ts");
  const gen = readFork("skymp5-server/ts/manifestGen.ts");
  if (index === null || gen === null) {
    skip("the fork is not on this machine, so the engine's start order is not read from its source");
  } else {
    console.log("      reading the engine at " + FORK);
    const main = slice(index, "const main = async () => {", "\n};\n");
    yes("index.ts has main()", !!main);
    if (main) {
      const g = main.indexOf("\n  manifestGen.generateManifest(settingsObject);\n");
      const s = main.indexOf("\n  setupGamemode(server, gamemodePath);\n");
      yes("main() calls generateManifest in its own body, not awaited and not in a callback", g > 0);
      yes("main() loads the gamemode in its own body (setupGamemode)", s > 0);
      yes("generateManifest comes before setupGamemode, so the gamemode loads after the manifest is written", g > 0 && s > g);
      yes("main() calls each of them once", (main.match(/generateManifest\(/g) || []).length === 1 &&
          (main.match(/setupGamemode\(/g) || []).length === 1);
    }
    const setup = slice(index, "const setupGamemode = (", "\n};\n");
    const loads = (index.match(/requireUncached\(/g) || []).length;
    const inSetup = setup ? (setup.match(/requireUncached\(/g) || []).length : 0;
    yes("the gamemode is loaded only from setupGamemode (every requireUncached call is in it)",
        !!setup && inSetup >= 1 && loads === inSetup + 1);
    yes("setupGamemode is called nowhere but main()",
        (index.match(/setupGamemode\(/g) || []).length === 1 && !!main && /setupGamemode\(/.test(main));
    yes("generateManifest is synchronous: not async and returns void",
        /export const generateManifest = \(settings: Settings\): void => \{/.test(gen) && !/async/.test(gen));
    yes("it writes the file with writeFileSync and with nothing asynchronous",
        /fs\.writeFileSync\(manifestPath, /.test(gen) && !/fs\.writeFile\(|fs\.promises|await /.test(gen));
    yes("it writes <dataDir>/manifest.json, the file the block reads",
        /const manifestPath = path\.join\(settings\.dataDir, "manifest\.json"\);/.test(gen) &&
        !!block && /var SRC = path\.join\(dataDir, 'manifest\.json'\);/.test(block));
  }
}

// ------------------------------------------------ the start, driven

const ORDER = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm",
               "Embers XD.esm", "JKs Skyrim.esp", "Thornswood-Content.esp", "Playable Rieklings.esp"];
const OUR_AT = ORDER.indexOf("Thornswood-Content.esp");
const KEY_URL = "/api/servers/thornswood/manifest.json";
const DST = "data/api/servers/thornswood/manifest.json";

function disk(opts) {
  opts = opts || {};
  const files = {};
  const dirs = {};
  const steps = [];
  function norm(p) { return path.posix.normalize(String(p).split("\\").join("/")); }
  function put(p, data) { files[norm(p)] = data; dirs[path.posix.dirname(norm(p))] = true; }
  put("server-settings.json", JSON.stringify({ dataDir: "data",
    loadOrder: ORDER.map(function (n) { return "/srv/thornswood/plugins/" + n; }) }));
  ORDER.forEach(function (n) { put("/srv/thornswood/plugins/" + n, "bytes of " + n); });
  // An archive in dataDir, so generateManifest puts a bsa entry in mods.
  put("data/Embers XD.bsa", "archive bytes");
  if (opts.earlier) {
    put(DST, JSON.stringify({ versionMajor: 1, mods: [{ filename: "Old.esp", size: 1, crc32: 1 }], loadOrder: ["Old.esp"], served: [] }));
  }
  const fake = {
    readFileSync: function (p) {
      const k = norm(p);
      steps.push("read " + k);
      if (!(k in files)) { const e = new Error("ENOENT: no such file or directory, open '" + k + "'"); e.code = "ENOENT"; throw e; }
      return files[k];
    },
    writeFileSync: function (p, d) {
      const k = norm(p);
      if (opts.readOnlyApi && k.indexOf("data/api/") === 0) { throw new Error("EACCES: permission denied, open '" + k + "'"); }
      steps.push("write " + k);
      put(k, String(d));
    },
    existsSync: function (p) { return norm(p) in files || norm(p) in dirs; },
    mkdirSync: function (p) { dirs[norm(p)] = true; },
    readdirSync: function (p) {
      const k = norm(p);
      return Object.keys(files).filter(function (f) { return path.posix.dirname(f) === k; })
        .map(function (f) { return path.posix.basename(f); });
    },
    unlinkSync: function (p) {
      const k = norm(p);
      if (opts.readOnlyApi && k.indexOf("data/api/") === 0) { throw new Error("EACCES: permission denied, unlink '" + k + "'"); }
      if (!(k in files)) { const e = new Error("ENOENT"); e.code = "ENOENT"; throw e; }
      steps.push("unlink " + k);
      delete files[k];
    },
    linkSync: function (src, dst) {
      if (!(norm(src) in files)) { throw new Error("ENOENT"); }
      if (norm(dst) in files) { throw new Error("EEXIST"); }
      files[norm(dst)] = files[norm(src)];
    },
    copyFileSync: function (src, dst) { files[norm(dst)] = files[norm(src)]; }
  };
  return { fs: fake, files: files, steps: steps, put: put };
}

// The engine's generateManifest (skymp5-server/ts/manifestGen.ts), over the
// pretend disk: each plugin in the load order with its size and a checksum,
// a bsa beside it when one sits in dataDir, written in one writeFileSync.
function generateManifest(d, settings) {
  const P = path.posix;
  const manifest = { mods: [], versionMajor: 1, loadOrder: settings.loadOrder.map(function (x) { return P.basename(x); }) };
  settings.loadOrder.forEach(function (el) {
    const name = P.isAbsolute(el) ? P.basename(el) : el;
    const where = P.isAbsolute(el) ? el : P.join(settings.dataDir, name);
    if (!d.fs.existsSync(where)) { return; }
    const buf = String(d.fs.readFileSync(where));
    manifest.mods.push({ crc32: buf.length * 7919, filename: name, size: buf.length });
    const bsa = P.join(settings.dataDir, name.replace(/\.[^.]+$/, "") + ".bsa");
    if (d.fs.existsSync(bsa)) {
      const b = String(d.fs.readFileSync(bsa));
      manifest.mods.push({ crc32: b.length * 7919, filename: P.basename(bsa), size: b.length });
    }
  });
  d.fs.writeFileSync(P.join(settings.dataDir, "manifest.json"), JSON.stringify(manifest, null, 4));
}

// main(): the settings, generateManifest, then setupGamemode loads the
// gamemode. opts.engine replaces the manifest step (to plant a broken file,
// or none); opts.box carries globals over from an earlier load.
function start(opts) {
  opts = opts || {};
  const d = disk(opts);
  const settings = JSON.parse(d.fs.readFileSync("server-settings.json"));
  if (!settings.dataDir) { settings.dataDir = "./data"; }
  if (opts.engine) { opts.engine(d, settings); } else { generateManifest(d, settings); }
  d.steps.push("gamemode loads");
  d.out = [];
  d.err = [];
  d.timers = [];
  const box = opts.box || {};
  box.require = function (name) { return name === "fs" ? d.fs : name === "path" ? path.posix : null; };
  // The engine's whole-file write (#2740), onto the fake disk.
  box.mp = { writeFileWhole: function (p, text) { d.fs.writeFileSync(p, text); } };
  box.console = { log: function () { d.out.push([].join.call(arguments, " ")); },
                  error: function () { d.err.push([].join.call(arguments, " ")); } };
  ["setInterval", "setTimeout", "setImmediate"].forEach(function (t) {
    box[t] = function () { d.timers.push(t); return 0; };
  });
  box.clearInterval = box.clearTimeout = box.clearImmediate = function () { };
  box.globalThis = box;
  vm.runInNewContext(block, box);
  d.box = box;
  try { d.manifest = JSON.parse(d.files[DST]); } catch (e) { d.manifest = null; }
  return d;
}

if (block) {
  const a = start({ earlier: true });
  const wrote = a.steps.indexOf("write data/manifest.json");
  const loads = a.steps.indexOf("gamemode loads");
  const reads = a.steps.lastIndexOf("read data/manifest.json");
  yes("the engine writes data/manifest.json before the gamemode loads, and the block reads it after",
      wrote >= 0 && loads > wrote && reads > loads);
  yes("the block reads it once and publishes on that first read",
      a.steps.filter(function (s) { return s === "read data/manifest.json"; }).length === 1 &&
      a.steps.indexOf("write " + DST) > reads);
  yes("no timer of any kind is started", a.timers.length === 0);
  yes("nothing goes to the error log on a good start", a.err.length === 0);
  yes("the log says the manifest was published, with its plugin count and the archive left out",
      a.out.some(function (l) { return l === "[thornswood] load order manifest published at " + KEY_URL + ", " + ORDER.length +
                                       " plugins (1 archive entries left out)"; }));
  yes("the published manifest is this start's: the client's mods and loadOrder, plugins only",
      !!a.manifest && a.manifest.mods.length === ORDER.length &&
      a.manifest.mods.every(function (m, i) { return m.filename === ORDER[i]; }) &&
      JSON.stringify(a.manifest.loadOrder) === JSON.stringify(ORDER));
  yes("the launcher's Fix keeps its list: served names Thornswood-Content.esp and nothing else",
      !!a.manifest && JSON.stringify(a.manifest.served) === JSON.stringify(["Thornswood-Content.esp"]));
  yes("and no plugin file is published beside it (#3386: Fix takes ours from the release)",
      !(("data/api/servers/thornswood/plugins/" + OUR_AT + ".bin") in a.files));
  yes("the refusal block gets the list the client is compared with",
      Array.isArray(a.box.__thornswoodManifestMods) && a.box.__thornswoodManifestMods.length === ORDER.length);

  // The order the timer was written for: the gamemode loads with no
  // data/manifest.json. The engine never does this; if it ever did, the
  // block must say so once and not wait for it.
  const carried = { __thornswoodManifestMods: [{ filename: "Old.esp", size: 1, crc32: 1 }] };
  const b = start({ earlier: true, box: carried, engine: function () { } });
  const bLine = b.err.length === 1 ? b.err[0] : "";
  yes("a gamemode loaded before the manifest is written logs exactly one error line",
      b.err.length === 1 && b.out.every(function (l) { return !/manifest/.test(l); }));
  yes("the line says it was NOT published, where, and why (could not read data/manifest.json: ENOENT)",
      bLine.indexOf("[thornswood] the load order manifest was NOT published at " + KEY_URL + ": ") === 0 &&
      /could not read data\/manifest\.json: ENOENT/.test(bLine));
  yes("it says what that means and that nothing tries again",
      /launchers check no plugin bytes and nobody's load order is checked\. Nothing tries again: put the cause right and restart the server\.$/.test(bLine));
  yes("no timer is started to wait for it", b.timers.length === 0);
  yes("the manifest an earlier start published is taken off, and the line says so",
      !(DST in b.files) && /The one an earlier start published was taken off\./.test(bLine));
  yes("the refusal block is left no list, not an earlier load's", b.box.__thornswoodManifestMods === null);
  generateManifest(b, { dataDir: "data", loadOrder: ORDER.map(function (n) { return "/srv/thornswood/plugins/" + n; }) });
  yes("a manifest written afterwards is not picked up by anything left running (nothing was)",
      !(DST in b.files) && b.timers.length === 0);

  const c = start({ engine: function (d) { d.put("data/manifest.json", "{ \"mods\": [ "); } });
  yes("an unreadable manifest gives one line with the parse error, and nothing was there to take off",
      c.err.length === 1 && /NOT published at [^:]+: could not read data\/manifest\.json: Unexpected end of JSON input\./.test(c.err[0]) &&
      !/earlier start/.test(c.err[0]) && c.timers.length === 0 && !(DST in c.files));

  const e = start({ earlier: true, engine: function (d) { d.put("data/manifest.json", JSON.stringify({ versionMajor: 1, loadOrder: ORDER })); } });
  yes("a manifest with no mods gives one line saying so, and the earlier one is taken off",
      e.err.length === 1 && /: data\/manifest\.json has no mods list\. The one an earlier start published was taken off\./.test(e.err[0]) &&
      !(DST in e.files) && e.timers.length === 0);

  const f = start({ earlier: true, readOnlyApi: true });
  yes("an api folder that cannot be written gives one line with the write error",
      f.err.length === 1 && /: could not write data\/api\/servers\/thornswood\/manifest\.json: EACCES/.test(f.err[0]) && f.timers.length === 0);
  yes("and says the earlier manifest could not be taken off, so it still answers",
      /The one an earlier start published could not be taken off, so it still answers: EACCES[^.]*\./.test(f.err[0]) &&
      f.box.__thornswoodManifestMods === null);
  yes("a failure is never also logged as published",
      [b, c, e, f].every(function (r) { return !r.out.some(function (l) { return /manifest published/.test(l); }); }));

  const code = strip(block);
  yes("the block starts no timer (no setInterval, setTimeout or setImmediate in its code)",
      !/\bset(Interval|Timeout|Immediate)\s*\(/.test(code));
  yes("publish() runs once, at load", (code.match(/\bpublish\(\)/g) || []).length === 2 &&
      /var why = publish\(\);/.test(code));
}

// ------------------------------------------------ the refusal's line

{
  const lo = slice(gm, "// ==== thornswood load order refusal ====", "// ==== end thornswood load order refusal ====");
  yes("the load order refusal no longer says the manifest is not published yet, as if a retry were coming",
      !!lo && !/not published yet/.test(lo) &&
      /not checked: the load order manifest was not published \(the line saying why is earlier in this log\)/.test(lo));
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
