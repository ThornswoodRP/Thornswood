/*
  test-start-on-save-gone.js

      node .\tests\test-start-on-save-gone.js

  Start On Save is out of Thornswood, issue #394.

  WHY THIS EXISTS. Start On Save (po3, Nexus 50054) loads the newest save at
  the main menu, or presses New Game when there is none. Under SkyMP either
  one is a second load on top of the one the server starts, and on 12 and 13
  September that crashed the game about thirty seconds in with its DLL on the
  stack. The launcher held it still by rewriting its settings file on every
  Play (Chars.WriteStartIni, sCharacterName = Thornswood-Nobody), and the mod
  earned nothing else. The readiness row went first (Dev 1.1.101.11) and the
  hand installer was stopped (#781); this is the rest.

  The one thing that must never happen is the half the issue's own trap warns
  about: the settings rewrite gone while the DLL is still in the game folder,
  because an untouched settings file is the crash again. So this holds both
  halves together:

    - nothing in the launcher writes the settings file, checks for the mod or
      shows a row or a card about it; the one place it is named is the rule
      that keeps it out of the game folder (OwnGame.RetiredFiles);
    - that rule leaves both files out when a folder is made, takes them out of
      a folder that already has them, and Rules moved so every folder does
      that once;
    - no pack carries either file (Ship-Rules.ps1,
      Test-ShipRetired inside Test-ShipMachine), the two lists agree, and no
      script installs the mod by hand any more;
    - the public pages no longer describe it as part of the build;
    - on a machine whose game folder was refreshed under those rules, neither
      file is there. Anywhere else that part says SKIP.

  The collection still carrying the mod is Patrick's to change in Vortex, not
  something code can check; the issue says what to do.

  Read only, apart from asking PowerShell what Ship-Rules.ps1 answers.
*/
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'launcher', 'app');
const BS = String.fromCharCode(92);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function skip(what) { console.log('SKIP  ' + what); }
function read(p) { return fs.readFileSync(p, 'utf8'); }

const NAMES = /po3_StartOnSave|Start ?On ?Save|\bStartIni\b|Thornswood-Nobody|bDisableMissingContentWarning/i;

// ---- the launcher -------------------------------------------------------------
// The window is compiled markup in launcher\app since #4823 (MainWindow.axaml,
// App.axaml); launcher\ui.xaml went with WPF.
const launcherFiles = fs.readdirSync(APP)
  .filter(function (f) { return /\.(cs|md|axaml)$/i.test(f); })
  .map(function (f) { return path.join(APP, f); });

const naming = [];
for (const f of launcherFiles) {
  if (path.basename(f) === 'OwnGame.cs') continue;
  const lines = read(f).split(/\r?\n/);
  lines.forEach(function (l, i) { if (NAMES.test(l)) naming.push(path.basename(f) + ':' + (i + 1)); });
}
yes('nothing in the launcher but OwnGame names the mod or its settings file' +
    (naming.length ? ': ' + naming.join(', ') : ''), naming.length === 0);

const OG = read(path.join(APP, 'OwnGame.cs'));
const CHARS = read(path.join(APP, 'Chars.cs'));
const CHECKS = read(path.join(APP, 'Checks.cs'));
yes('Chars no longer writes the settings file (no WriteStartIni, no StartIni)',
    !/WriteStartIni|\bStartIni\b/.test(CHARS));
yes('Checks has no StartOnSaveInstalled and no Auto load readiness row',
    !/StartOnSaveInstalled/.test(CHECKS) && CHECKS.indexOf('Auto load') < 0);

function member(src, header) {
  const at = src.indexOf(header);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return null;
}
const retiredList = member(OG, 'static readonly string[] RetiredFiles =');
const retiredOf = [];
if (retiredList) {
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(retiredList)) !== null) retiredOf.push(m[1].split(BS + BS).join(BS));
}
const WANT = ['Data' + BS + 'SKSE' + BS + 'Plugins' + BS + 'po3_StartOnSave.dll',
              'Data' + BS + 'SKSE' + BS + 'Plugins' + BS + 'po3_StartOnSave.ini'];
yes('OwnGame.RetiredFiles lists the DLL and its settings file',
    retiredList !== null && WANT.every(function (w) { return retiredOf.indexOf(w) >= 0; }));

// Inside OwnGame the file names appear in code only in that list.
const strayCode = OG.split(/\r?\n/).filter(function (l) {
  const t = l.trim();
  if (!t.length || t.startsWith('//') || t.startsWith('*')) return false;
  return /po3_StartOnSave/i.test(t) && !/^"Data\\\\SKSE\\\\Plugins\\\\po3_StartOnSave\.(dll|ini)",$/.test(t);
});
yes('and OwnGame names the files nowhere else in its code' +
    (strayCode.length ? ': ' + strayCode.map(function (s) { return s.trim(); }).join(' | ') : ''),
    strayCode.length === 0);

const skipBody = member(OG, 'static string Skip(string rel)');
yes('Skip leaves a retired file out when a folder is made or refreshed',
    skipBody !== null && /if \(Retired\(rel\)\) return "/.test(skipBody));
const refresh = member(OG, 'static string RefreshNow(Config cfg, Action<string> say)');
const afterRetired = refresh ? refresh.slice(Math.max(0, refresh.indexOf('foreach (string r in RetiredFiles)'))) : '';
yes('Refresh deletes a retired file from a folder that has it, recorded or not',
    refresh !== null && refresh.indexOf('foreach (string r in RetiredFiles)') >= 0 &&
    /if \(File\.Exists\(dest\)\) \{ DropName\(dest\); removed\+\+; \}/.test(afterRetired));
const rulesNum = /(?:^|\n)\s*const int Rules = (\d+);/.exec(OG);
const rulesDoc = /\/\/\/ (\d+): Start On Save is left out/.exec(OG);
yes('Rules moved for it, so every folder already made refreshes once and drops both files',
    rulesNum !== null && rulesDoc !== null && Number(rulesNum[1]) >= Number(rulesDoc[1]) && Number(rulesDoc[1]) >= 7);

// ---- packs ---------------------------------------------------------------------
const SHIP_RULES = path.join(ROOT, 'scripts', 'release', 'Ship-Rules.ps1');
const RULES_SRC = read(SHIP_RULES);
const shipBlock = /\$ShipRetiredFiles = @\(([\s\S]*?)\)/.exec(RULES_SRC);
const shipOf = [];
if (shipBlock) {
  const re = /'([^']+)'/g;
  let m;
  while ((m = re.exec(shipBlock[1])) !== null) shipOf.push(m[1]);
}
yes('Ship-Rules.ps1 lists the same retired files as OwnGame',
    shipOf.length > 0 && shipOf.length === retiredOf.length &&
    shipOf.every(function (s) { return retiredOf.some(function (r) { return r.toLowerCase() === s.toLowerCase(); }); }));
yes('and Test-ShipMachine asks Test-ShipRetired, so packs leave them out',
    /function Test-ShipMachine\([^)]*\) \{[\s\S]*?if \(Test-ShipRetired \$rel\) \{ return \$true \}/.test(RULES_SRC));

const pu = read(path.join(ROOT, 'scripts', 'release', 'Publish-Update.ps1'));
yes('Publish-Update scans through Test-ShipMachine',
    /function Test-Machine\(\[string\]\$rel\) \{ return \(\(?Test-ShipMachine \$rel\)/.test(pu) &&
    /if \(Test-Machine \$rel\) \{ continue \}/.test(pu));
// The old installer's Package-Thornswood.ps1 scanned through it too until
// #4824. Velopack's Setup.exe carries no game files: an install gets the
// game from the packs Publish-Update makes, or on dev from the merge
// release's game files built over them.

// What the rules actually answer, from PowerShell itself.
const probe = WANT.concat(['data' + BS + 'skse' + BS + 'plugins' + BS + 'PO3_STARTONSAVE.DLL',
                           'Data' + BS + 'SKSE' + BS + 'Plugins' + BS + 'po3_StartOnSave.dll.txt']);
const cmd = ". '" + SHIP_RULES.replace(/'/g, "''") + "'; " +
  probe.map(function (p) { return "'" + p + "=' + [string](Test-ShipMachine '" + p + "')"; }).join('; ');
let run = null;
const env = Object.assign({}, process.env);
for (const k of Object.keys(env)) if (k.toLowerCase() === 'psmodulepath') delete env[k];
for (const shell of ['pwsh', 'powershell']) {
  run = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd],
                  { encoding: 'utf8', env: env });
  if (!run.error) break;
}
if (!run || run.error) {
  skip('no PowerShell here to ask Ship-Rules.ps1');
} else {
  const got = {};
  String(run.stdout || '').split(/\r?\n/).forEach(function (l) {
    const i = l.lastIndexOf('=');
    if (i > 0) got[l.slice(0, i)] = l.slice(i + 1).trim();
  });
  yes('Ship-Rules.ps1 dot-sources and answers', run.status === 0 && Object.keys(got).length === probe.length);
  if (run.status !== 0) console.log(run.stderr);
  yes('no pack carries the DLL or its settings file, in any letter case',
      got[probe[0]] === 'True' && got[probe[1]] === 'True' && got[probe[2]] === 'True');
  yes('and a different name that merely starts the same way is not caught by it',
      got[probe[3]] === 'False');
}

// ---- scripts ------------------------------------------------------------------
yes('Add-Characters.ps1, which installed the mod by hand, is deleted',
    !fs.existsSync(path.join(ROOT, 'scripts', 'mods', 'Add-Characters.ps1')));
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ps1|psm1|js|py|cmd|bat)$/i.test(e.name)) out.push(p);
  }
  return out;
}
const scriptHits = [];
for (const f of walk(path.join(ROOT, 'scripts'), [])) {
  if (f === SHIP_RULES) continue;
  read(f).split(/\r?\n/).forEach(function (l, i) {
    // A comment recording history is fine; a line that does something is not.
    if (/po3_StartOnSave/i.test(l) && !/^\s*#/.test(l)) scriptHits.push(path.relative(ROOT, f) + ':' + (i + 1));
  });
}
yes('no script outside Ship-Rules.ps1 acts on the mod' + (scriptHits.length ? ': ' + scriptHits.join(', ') : ''),
    scriptHits.length === 0);

// ---- what people read ---------------------------------------------------------
{
  const p = path.join(ROOT, 'site', 'data', 'help.md');
  yes('site' + BS + 'data' + BS + 'help.md no longer describes Start On Save as part of the build',
      fs.existsSync(p) && !/Start ?On ?Save/i.test(read(p)));
  // Known Issues is the page /known writes, from the bot's list since #3140 (#2414).
  const known = require('./fixtures/known-page').knownPage(ROOT);
  yes('the Known Issues page no longer describes Start On Save as part of the build',
      known !== null && !/Start ?On ?Save/i.test(known));
}

// ---- this machine -------------------------------------------------------------
const TS_ROOT = process.env.TS_ROOT || ('C:' + BS + 'Thornswood');
const MADE = path.join(TS_ROOT, 'Profile', 'OwnGame', 'made.txt');
if (!fs.existsSync(MADE)) {
  skip('no game folder made by the launcher at ' + TS_ROOT);
} else {
  const rec = /(?:^|\n)rules=(-?\d+)/.exec(read(MADE));
  const made = rec ? Number(rec[1]) : -1;
  const there = WANT.filter(function (w) { return fs.existsSync(path.join(TS_ROOT, 'Game', w)); });
  if (rulesDoc && made >= Number(rulesDoc[1])) {
    yes('the game folder, refreshed under rules ' + made + ', holds neither file' +
        (there.length ? ': ' + there.join(', ') : ''), there.length === 0);
  } else {
    skip('the game folder at ' + TS_ROOT + ' was last made under rules ' + made +
         ', before this; the next launcher start refreshes it' +
         (there.length ? ' (it still has ' + there.map(function (t) { return path.basename(t); }).join(' and ') + ')' : ''));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
