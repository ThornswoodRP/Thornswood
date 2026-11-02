// test-1235-skyrim-facts.js
//
//     node launcher\tests\test-1235-skyrim-facts.js
//
// The facts about the game are read from the Skyrim the folder will be made
// from, not from Profile\Payload (#1235).
//
// With Thornswood's own folder chosen at install and not made yet,
// Paths.Game is Profile\Payload (#1226): Thornswood's own files, and no game.
// Checks.All already read the game build, the script extender and Address
// Library from the Steam copy in that state, but the What is installed facts
// (Pages.BuildInstalled), the support report (Diag.Summary) and the build in
// the corner (Downgrade.Describe(cfg)) read Paths.Game, so they said the game
// and the script extender were missing until the folder was made.
//
// This reads launcher\app and holds:
//   - Paths.Skyrim is the Steam copy while OwnFirst and Game otherwise, the
//     same rule Checks.All uses, and Exe, Loader and MpClient stay under Game
//     so nothing is ever written into the Steam copy through them;
//   - SksePluginDirs is Skyrim's plugin folder, then Game's when it differs;
//   - Diag.Summary and Describe(cfg) read the exe, the script extender and its
//     plugins through those, and no longer through Paths.Exe or Paths.Game
//     (the What is installed facts went with the hidden Build page, #3146);
//   - nothing in the launcher writes through Paths.Skyrim, SkyrimExe or
//     SksePluginDirs.
// The rule itself is run in the scenes of launcher\tests\test-own-folder-first.ps1,
// which compiles the launcher (Windows).
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'launcher', 'app');
const CR = String.fromCharCode(13);
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The body of a C# member, from its declaration to its closing brace.
function member(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

const paths = read('Paths.cs');
const pages = read('Pages.cs');
const diag = read('Diag.cs');
const down = read('Downgrade.cs');
const checks = read('Checks.cs');

// ---- the rule ---------------------------------------------------------------
yes('Paths.Skyrim is the Steam copy while OwnFirst and Game otherwise',
    /public static string Skyrim \{ get \{ return OwnFirst \? SteamCopy : Game; \} \}/.test(paths));
yes('Paths.SkyrimExe is SkyrimSE.exe in it',
    /public static string SkyrimExe \{ get \{ return Path\.Combine\(Skyrim, "SkyrimSE\.exe"\); \} \}/.test(paths));
const all = member(checks, 'public static List<Check> All(Config cfg)');
yes('Checks.All reads the game by the same rule, so the rows and the facts cannot disagree',
    /string game = Paths\.OwnFirst \? Paths\.SteamCopy : Paths\.Game;/.test(all));
yes('Exe, Loader and MpClient stay under Game, so no writer is pointed at the Steam copy',
    /public static string Exe \{ get \{ return Path\.Combine\(Game, "SkyrimSE\.exe"\); \} \}/.test(paths) &&
    /public static string Loader \{ get \{ return Path\.Combine\(Game, "skse64_loader\.exe"\); \} \}/.test(paths) &&
    /get \{ return Path\.Combine\(Game, "Data\\\\SKSE\\\\Plugins\\\\MpClientPlugin\.dll"\); \}/.test(paths));

const dirs = member(paths, 'public static string[] SksePluginDirs');
yes('SksePluginDirs exists', dirs.length > 0);
yes('it takes Skyrim\'s plugin folder and Game\'s',
    /Path\.Combine\(Skyrim, "Data\\\\SKSE\\\\Plugins"\)/.test(dirs) && /Path\.Combine\(Game, "Data\\\\SKSE\\\\Plugins"\)/.test(dirs));
yes('one folder when they are the same, Skyrim\'s first then Game\'s when not',
    /if \(string\.Equals\(skyrim, game, StringComparison\.OrdinalIgnoreCase\)\) return new string\[\] \{ game \};/.test(dirs) &&
    /return new string\[\] \{ skyrim, game \};/.test(dirs));

// ---- the readers --------------------------------------------------------------
yes('the What is installed facts are gone with the Build page (#3146), so no third reader can disagree',
    !/static void BuildInstalled\(\)/.test(pages));

const summary = member(diag, 'static string Summary(Config cfg, string launcherVersion)');
yes('Diag.Summary is in Diag.cs', summary.length > 0);
yes('the report\'s game exe is SkyrimExe\'s', /Add\("game exe", new FileInfo\(Paths\.SkyrimExe\)/.test(summary));
yes('the report says where the game was read from while the folder is not made',
    /if \(Paths\.OwnFirst\) Add\("game read from", Paths\.Skyrim/.test(summary));
yes('the report lists the plugins of every SksePluginDirs folder, naming each when there are two',
    /string\[\] dirs = Paths\.SksePluginDirs;/.test(summary) && /if \(dirs\.Length > 1\) s\.AppendLine\("in " \+ dir\);/.test(summary));
yes('it no longer reads Paths.Exe or the game\'s files under Paths.Game',
    !/Paths\.Exe\b/.test(summary) && !/Path\.Combine\(Paths\.Game,/.test(summary));

yes('Downgrade.Describe(cfg) names the build of SkyrimExe, the one Needed asks about',
    /public static string Describe\(Config cfg\) \{ return Describe\(cfg, Paths\.SkyrimExe\); \}/.test(down));
const needed = member(down, 'public static bool Needed(Config cfg)');
yes('Needed still asks about the Steam copy before the folder exists', /if \(Paths\.Collection\) return OwnGame\.SteamCopyNotPinned\(cfg\)/.test(needed));

// ---- read only -------------------------------------------------------------------
const writes = /\b(File\.(Write\w*|Copy|Move|Delete|Create\w*|AppendAll\w*|Replace|SetAttributes)|Directory\.(Create\w*|Delete|Move)|new (StreamWriter|FileStream))\b/;
const bad = [];
fs.readdirSync(APP).filter(f => /\.cs$/.test(f)).forEach(function (f) {
  read(f).split('\n').forEach(function (line, i) {
    if (/Paths\.(Skyrim|SkyrimExe|SksePluginDirs)\b/.test(line) && writes.test(line)) bad.push(f + ':' + (i + 1));
  });
});
yes('nothing writes through Paths.Skyrim, SkyrimExe or SksePluginDirs' + (bad.length ? ' (' + bad.join(', ') + ')' : ''), bad.length === 0);

// ---- the scenes that run it ------------------------------------------------------
const scenes = fs.readFileSync(path.join(REPO, 'launcher', 'tests', 'test-own-folder-first.ps1'), 'utf8');
yes('test-own-folder-first.ps1 runs the rule chosen and not made, made, chosen on a newer build, and not chosen',
    (scenes.match(/#1235\)/g) || []).length >= 4);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
