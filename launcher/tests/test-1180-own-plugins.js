// test-1180-own-plugins.js
//
// #1180. The launcher's Fix fetched the server's copy of any plugin whose
// bytes differed, and the server handed out every plugin in its load order
// but Bethesda's five masters: measured on 5 Oct, 43 plugins on the main and
// the dev server alike, 42 of them other authors' mods. Now the server serves
// Thornswood's own plugin and nothing else, names it in the manifest's
// "served" list, and the launcher fetches only what that list names; for
// another author's plugin Scan and Fix name the mod to put right in Vortex.
//
// #3386. The bytes no longer come from the server at all: its resources port
// is plain http, and the size and crc32 that vouched for them came over the
// same port. The server serves no plugin file now, and Fix takes ours from
// the release the update feed names, over https, by the sha256 its record
// gives them (Updater.ReleaseCopy). launcher\tests\test-2627-scan-fix.ps1 runs
// that reader with Fix.
//
// The gamemode's server manifest block is run here against a pretend disk.
// The launcher cannot be compiled here, so its half is held by its text.
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
const verify = read("launcher", "app", "Verify.cs");
const ownGame = read("launcher", "app", "OwnGame.cs");
const rules = read("scripts", "release", "Ship-Rules.ps1");

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

// ------------------------------------------------ the gamemode's half

const block = slice(gm, "// ==== thornswood server manifest ====", "// ==== end thornswood server manifest ====");
yes("the server manifest block is in the gamemode", block !== null);

// The live load order's shape on 5 Oct, shortened: Bethesda's five, other
// authors' mods, ours (position 30 there), and more of theirs after it.
const BETHESDA = ["Skyrim.esm", "Update.esm", "Dawnguard.esm", "HearthFires.esm", "Dragonborn.esm"];
const THEIRS = ["Water for ENB.esm", "Embers XD.esm", "RaceCompatibility.esm", "JKs Skyrim.esp",
                "WindhelmSSE.esp", "Cloaks&Capes.esp", "UIExtensions.esp"];
const AFTER = ["Populated Cities Towns Villages Legendary.esp", "Playable Rieklings.esp"];
const ORDER = BETHESDA.concat(THEIRS, ["Thornswood-Content.esp"], AFTER);
const OUR_AT = ORDER.indexOf("Thornswood-Content.esp");

// A pretend disk: a flat map of normalised path to { data, links }.
function disk(opts) {
  opts = opts || {};
  const files = {};
  const dirs = {};
  const log = [];
  const links = [];
  function norm(p) { return path.posix.normalize(String(p).split("\\").join("/")); }
  function put(p, data) { files[norm(p)] = data; dirs[path.posix.dirname(norm(p))] = true; }
  const mods = ORDER.map(function (n, i) { return { filename: n, size: 1000 + i, crc32: i }; });
  mods.splice(6, 0, { filename: "Embers XD - Textures.bsa", size: 5, crc32: 5 });
  // A server that loads light plugins (#1715) publishes them apart, in
  // light index order; #2627 serves ours among them.
  const light = (opts.light || []).map(function (n, i) { return { filename: n, size: 2000 + i, crc32: 100 + i }; });
  const whole = ORDER.concat(opts.light || []);
  const doc = { versionMajor: 1, mods: mods, loadOrder: whole };
  if (opts.light) { doc.light = light; }
  put("data/manifest.json", JSON.stringify(doc));
  const present = whole.filter(function (n) { return !(opts.without || []).includes(n); });
  put("server-settings.json", JSON.stringify({ dataDir: "data", loadOrder: whole.map(function (n) { return "/srv/thornswood/plugins/" + n; }) }));
  present.forEach(function (n) { put("/srv/thornswood/plugins/" + n, "bytes of " + n); });
  // What an older start published: every plugin but Bethesda's, by index.
  (opts.stale || []).forEach(function (f) { put("data/api/servers/thornswood/plugins/" + f, "old"); });
  const fake = {
    readFileSync: function (p) {
      const k = norm(p);
      if (!(k in files)) { const e = new Error("ENOENT: " + k); e.code = "ENOENT"; throw e; }
      return files[k];
    },
    writeFileSync: function (p, d) { put(p, String(d)); },
    existsSync: function (p) { return norm(p) in files || norm(p) in dirs; },
    mkdirSync: function (p) { dirs[norm(p)] = true; },
    readdirSync: function (p) {
      const k = norm(p);
      return Object.keys(files).filter(function (f) { return path.posix.dirname(f) === k; })
        .map(function (f) { return path.posix.basename(f); });
    },
    unlinkSync: function (p) {
      const k = norm(p);
      if ((opts.stuck || []).includes(path.posix.basename(k))) { throw new Error("EBUSY: resource busy"); }
      delete files[k];
    },
    linkSync: function (src, dst) {
      if (!(norm(src) in files)) { throw new Error("ENOENT"); }
      if (norm(dst) in files) { throw new Error("EEXIST"); }
      files[norm(dst)] = files[norm(src)];
      links.push([norm(src), norm(dst)]);
    },
    copyFileSync: function (src, dst) { files[norm(dst)] = files[norm(src)]; }
  };
  return { fs: fake, files: files, log: log, links: links };
}

function run(opts) {
  const d = disk(opts);
  const box = {
    require: function (name) { return name === "fs" ? d.fs : name === "path" ? path.posix : null; },
    console: { log: function () { d.log.push([].join.call(arguments, " ")); } },
    // The engine's whole-file write (#2740), onto the fake disk.
    mp: { writeFileWhole: function (p, text) { d.fs.writeFileSync(p, text); } },
    setInterval: function () { d.log.push("a retry was started"); return 0; },
    clearInterval: function () {}
  };
  box.globalThis = box;
  vm.runInNewContext(block, box);
  d.box = box;
  d.served = Object.keys(d.files).filter(function (f) { return f.indexOf("data/api/servers/thornswood/plugins/") === 0; })
    .map(function (f) { return path.posix.basename(f); }).sort();
  try { d.manifest = JSON.parse(d.files["data/api/servers/thornswood/manifest.json"]); } catch (e) { d.manifest = null; }
  return d;
}

if (block) {
  const everyOld = ORDER.map(function (n, i) { return i; }).filter(function (i) { return i >= 5; }).map(function (i) { return i + ".bin"; });
  const a = run({ stale: everyOld });

  yes("the manifest is published with the client's two fields as before (mods, loadOrder)",
      !!a.manifest && Array.isArray(a.manifest.mods) && a.manifest.mods.length === ORDER.length &&
      Array.isArray(a.manifest.loadOrder) && a.manifest.loadOrder.length === ORDER.length);
  yes("the archive entry is still left out of mods, so positions are the client's",
      !!a.manifest && a.manifest.mods.every(function (m) { return /\.(esp|esm|esl)$/i.test(m.filename); }) &&
      a.manifest.mods[OUR_AT].filename === "Thornswood-Content.esp");
  yes("the manifest names what the server hands out: Thornswood-Content.esp and nothing else",
      !!a.manifest && JSON.stringify(a.manifest.served) === JSON.stringify(["Thornswood-Content.esp"]));
  yes("the refusal block still gets every plugin the client is compared with",
      Array.isArray(a.box.__thornswoodManifestMods) && a.box.__thornswoodManifestMods.length === ORDER.length);
  yes("no plugin file is served from the box, ours included (#3386): " + (a.served.join(", ") || "none new"),
      a.links.length === 0 && Object.keys(a.files).every(function (f) {
        return f.indexOf("data/api/servers/thornswood/plugins/") !== 0 || everyOld.indexOf(path.posix.basename(f)) >= 0;
      }));
  yes("and the log no longer says any was published",
      !a.log.some(function (l) { return /plugin files published/.test(l); }));
  yes("the manifest was there, so no retry ran", !a.log.includes("a retry was started"));

  // #2627: our light plugin is named as ours too. On 16 Oct the server's
  // light order named Thornswood-Last.esp and nothing called it ours, so a
  // machine without it had nothing for Fix to put in.
  const LIGHT = ["_ResourcePack.esl", "KhisartinBeards.esp", "Thornswood-Last.esp"];
  const d = run({ light: LIGHT });
  const lastAt = LIGHT.indexOf("Thornswood-Last.esp");
  yes("a server with a light list names our light plugin as served, beside our full one",
      !!d.manifest && JSON.stringify(d.manifest.served) === JSON.stringify(["Thornswood-Content.esp", "Thornswood-Last.esp"]));
  yes("and its bytes are not served either", d.links.length === 0 && d.served.length === 0);
  yes("the client's own lists are as they were: mods the full plugins, light the light ones",
      !!d.manifest && d.manifest.mods.length === ORDER.length && Array.isArray(d.manifest.light) && d.manifest.light.length === LIGHT.length);

  const code = block.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  yes("the rule names what is ours, not what to leave out (no STOREFRONT list in the block)",
      !/STOREFRONT/.test(code) && /return OURS\[m\.filename\.toLowerCase\(\)\];/.test(code));
  yes("the block writes no plugin file anywhere (#3386)",
      !/publishFiles|\blinkSync|copyFileSync|['"]plugins['"]/.test(code));
}

// ------------------------------------------------ one list of ours

{
  const m = /var OURS = \{([^}]*)\};/.exec(gm);
  const inGamemode = m ? m[1].split(",").map(function (s) { return s.split(":")[0].trim().replace(/^'|'$/g, ""); })
    .filter(Boolean).sort() : [];
  const list = /\$ShipOursFiles = @\(([\s\S]*?)\n\)/.exec(rules);
  const inRules = list ? (list[1].replace(/#.*$/gm, "").match(/'[^']+'/g) || [])
    .map(function (s) { return s.slice(1, -1); })
    .filter(function (p) { return /^Data\\[^\\]+\.(esp|esm|esl)$/i.test(p); })
    .map(function (p) { return p.slice(5).toLowerCase(); }) : [];
  // And the one a release carries as its recipe, which each machine makes the
  // plugin from (#2791): still ours, and the manifest still names it served,
  // so the launcher never takes it for another author's mod.
  const made = /\$ShipMadeFromRecipe = @\(([\s\S]*?)\n\)/.exec(rules);
  const madeNames = made ? (made[1].replace(/#.*$/gm, "").match(/'[^']+'/g) || [])
    .map(function (s) { return s.slice(1, -1); })
    .filter(function (p) { return /^Data\\[^\\]+\.(esp|esm|esl)$/i.test(p); })
    .map(function (p) { return p.slice(5).toLowerCase(); }) : [];
  const recipes = madeNames.filter(function (n) {
    return list && list[1].toLowerCase().indexOf("'data\\" + n.replace(/\.es[pml]$/i, "") + ".recipe'") >= 0;
  });
  inRules.push.apply(inRules, recipes);
  inRules.sort();
  yes("Ship-Rules.ps1 names our plugins in $ShipOursFiles, or their recipes (" + inRules.join(", ") + ")", inRules.length > 0);
  yes("  each plugin it makes from a recipe ships as that recipe (" + madeNames.join(", ") + ")", recipes.length === madeNames.length);
  yes("the gamemode serves exactly the plugins Ship-Rules.ps1 calls ours (" + inGamemode.join(", ") + ")",
      inGamemode.length > 0 && JSON.stringify(inGamemode) === JSON.stringify(inRules));
}

// ------------------------------------------------ the launcher's half

{
  yes("Verify reads the manifest's served list", /\[JsonInclude\] public string\[\] served;/.test(verify));
  yes("Manifest marks each plugin served or not from that list, and nothing else sets it",
      /m\.Served = served\.Contains\(m\.filename\);/.test(verify) &&
      (verify.match(/\bm\.Served = /g) || []).length === 1);

  const fetch = slice(verify, "static bool FetchPlugin(Config cfg, Issue i, Func<string, byte[]> release, Action<string> say)", "\n        }\n");
  yes("FetchPlugin is in Verify.cs", !!fetch);
  if (fetch) {
    const guard = fetch.indexOf("if (!i.Served)");
    const get = fetch.indexOf("bytes = release(i.Plugin);");
    yes("FetchPlugin refuses a plugin the server does not call ours before it asks the release for anything",
        guard > 0 && get > guard && /if \(!i\.Served\)\s*\{[^}]*FromVortex\(cfg, i\.Plugin\)[^}]*return false;\s*\}/.test(fetch));
    yes("FetchPlugin takes the bytes from the release, never from the game server (#3386)",
        get > 0 && !/Get\(|ServerBase\(|WebRequest|http:/.test(fetch));
    yes("and writes them only when they are the copy the server's manifest describes",
        /if \(bytes\.LongLength != i\.WantSize \|\| crc != i\.WantCrc\)\s*\{[^}]*return false;\s*\}/.test(fetch));
  }
  yes("nothing in Verify.cs asks the server for /plugins/ any more (#3386)", !/"\/plugins\/"/.test(verify));
  const others = fs.readdirSync(path.join(REPO_DIR, "launcher", "app")).filter(function (f) { return /\.cs$/.test(f); })
    .filter(function (f) { return /\/plugins\/"|\/plugins\/" \+/.test(read("launcher", "app", f)); });
  yes("no launcher file fetches from /plugins/" + (others.length ? " (" + others.join(", ") + ")" : ""), others.length === 0);
  const upkeep = read("launcher", "app", "Upkeep.cs");
  yes("Fix is handed the release the feed names, read over https by Updater.ReleaseCopy",
      /Verify\.Fix\(cfg, say, Updater\.ReleaseCopy\(cfg, v\)\)/.test(upkeep));
  const sync = read("launcher", "app", "Sync.cs");
  const copy = slice(sync, "public static Func<string, byte[]> ReleaseCopy(Config cfg, VersionDoc v)", "\n        }\n");
  yes("ReleaseCopy checks the record's address (https, a host on the list) before it reads a byte",
      !!copy && copy.indexOf("CheckUrl(r.url);") >= 0 && copy.indexOf("CheckUrl(r.url);") < copy.indexOf("ReleaseCopyAt("));

  const bytes = slice(verify, "public static List<Issue> Bytes(Config cfg)", "\n        }\n");
  yes("Scan carries served on each issue and names Vortex for another author's plugin",
      !!bytes && /i\.Served = m\.Served;/.test(bytes) &&
      /m\.Served \? "Fix puts in the release's copy\." : null,/.test(bytes) &&
      /m\.Served \? NotInRelease : FromVortex\(cfg, m\.filename\)/.test(bytes));
  // #2627: a light plugin of ours is ours too, at its place in the light list.
  yes("Scan says where a light plugin of ours is: its place in the light list",
      !!bytes && /i\.WantLight = isLight;/.test(bytes) && /i\.WantIndex = isLight \? idx - mods\.Length : idx;/.test(bytes));
  yes("Manifest marks served on the light list as well as mods",
      /foreach \(ServerMod\[\] list in new ServerMod\[\]\[\] \{ doc\.mods, light \}\)/.test(verify));
  const fix = slice(verify, "public static int Fix(Config cfg, Action<string> say, Func<string, byte[]> release)", "\n        }\n");
  yes("Fix's fetch of a missing plugin passes over any the server does not serve",
      !!fix && /Storefront\.Contains\(m\.filename\) \|\| !m\.Served( \|\| LastPlugin\.Makes\(Paths\.Game, m\.filename\))?\) continue;/.test(fix) &&
      /miss\.Served = true;\s*if \(FetchPlugin\(cfg, miss, release, say\)\) n\+\+;/.test(fix));
  yes("Fix fetches a missing plugin of ours from the light list as well as mods",
      !!fix && /int all = mods\.Length \+ light\.Length;/.test(fix) && /miss\.WantLight = isLight;/.test(fix));
  yes("Fix's fetch of a plugin that differs goes through FetchPlugin with Scan's issue",
      !!fix && /foreach \(Issue i in Bytes\(cfg\)\)\s*if \(i\.Plugin != null && (!LastPlugin\.Makes\(Paths\.Game, i\.Plugin\) && )?FetchPlugin\(cfg, i, release, say\)\) n\+\+;/.test(fix));
  // #2791: the plugin the release's recipe makes here is never fetched;
  // tests/test-2791-last-plugin.ps1 holds that.

  const from = slice(verify, "static string FromVortex(Config cfg, string plugin)", "\n        }\n");
  yes("what to do about another author's plugin names the mod in Vortex and says to update or reinstall it",
      !!from && /OwnGame\.VortexModOf\(cfg, plugin\)/.test(from) &&
      /update the Thornswood collection, or reinstall/.test(from) && /Reinstall\), then press Scan\./.test(from) &&
      /Thornswood has no copy of it to give/.test(from));
  const mod = slice(ownGame, "public static string VortexModOf(Config cfg, string plugin)", "\n        }\n");
  yes("OwnGame.VortexModOf reads Vortex's own deployment record for the plugin's mod folder",
      !!mod && /Staged\(src\)\.From\.TryGetValue\("Data\\\\" \+ plugin, out from\)/.test(mod) &&
      /Path\.GetFileName\(Path\.GetDirectoryName\(from\)\)/.test(mod));
  yes("and it writes nothing", !!mod && !/File\.(Write|Copy|Move|Delete)|Directory\.(Create|Delete|Move)/.test(mod));
}

// ------------------------------------------------ what people read

{
  // The launcher's Help page went with #3146: help is F7 in the game and
  // help.md on the site, so the site's copy is the one held here.
  const join = read("site", "data", "site", "join.md");
  const known = require("../../tests/fixtures/known-page").knownPage() || "";  // the page /known writes, from the bot's list (#3140)
  const md = read("site", "data", "help.md");
  yes("the join page says the same", /For Thornswood's own plugin \*\*Fix\*\* downloads the latest release's\s+copy; for another author's mod it names the mod to update or reinstall in\s+Vortex\./.test(join));
  yes("the known issues page leaves the load order to the help (#3137)", known.length > 0 && !/LOAD ORDER ERROR/.test(known));
  yes("the site's help says the same", /Fix only has a copy of Thornswood's own\s+plugin, from the latest release, and nobody else's/.test(md));
  yes("nothing people read still says Fix downloads the server's copy of a plugin (#3386)",
      [join, known, md].every(function (t) { return !/server's copy of\s+(any|that|Thornswood's own) plugin|downloads the server's copy/.test(t); }));
}

console.log("");
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
