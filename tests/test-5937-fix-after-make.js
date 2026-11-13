// test-5937-fix-after-make.js
//
//     node tests/test-5937-fix-after-make.js
//
// A fresh install finishes without a press of Fix (#5937). On 12 Nov a fresh
// install with the collection already deployed made Thornswood's own folder
// by itself and restarted, and the start after that only scanned:
// Thornswood-Last.esp and the other files made from the game, the light
// plugin order and the Pandora and BodySlide build all waited for a press of
// Fix. The restart after the make is the launcher's own, not Velopack's, so
// Velo.Restarted (which runs Fix after an update) never said it happened.
//
// What this holds, by the launcher's source:
//   1. the make's finish leaves a note in the profile, after Paths point at
//      the new folder and before Fix runs in it (the note is for a launcher
//      that closes before that Fix; test-5937-one-restart.js holds the rest);
//   2. the first start in the folder takes that note (reading it deletes it,
//      so Fix runs once for it and never at every start) and runs Fix whole,
//      after a bring-up-to-date from Vortex when one is due, whether that
//      succeeds or not;
//   3. that Fix waits for a folder being prepared, as Fix after an update
//      does, and the folder's finish runs it as the Fix after a make;
//   4. the scan before the folder is made does not judge the files made from
//      the game against Profile\Payload, which holds no Skyrim.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const app = 'launcher/app/';
const own = read(app + 'ShellOwnGame.cs');
const sf = read(app + 'ShellScanFix.cs');
const og = read(app + 'OwnGame.cs');
const upkeep = read(app + 'Upkeep.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function body(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const open = src.indexOf('{', at + sig.length - 1);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return '';
}
// Comments quote code on purpose; only the code is read.
function code(src) { return src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); }

// 1. the note
const work = code(body(own, 'static void FolderWork('));
const init = work.indexOf('Paths.Init(Paths.Root);');
const note = work.indexOf('OwnGame.NoteFixAfterMake();');
const firstFix = work.indexOf('RunFix(false, false, true);');
yes('the make leaves the note once Paths name the new folder, before Fix runs in it',
  init > 0 && note > init && firstFix > note);
yes('only when the make succeeded', /if \(make && fail == null\)\s*\{[^}]*Paths\.Init\(Paths\.Root\);[\s\S]*?OwnGame\.NoteFixAfterMake\(\);/.test(work));
yes('the note lives in the profile beside the folder\'s other records',
  /static string FixAfterMakeFile \{ get \{ return Path\.Combine\(Dir, "fix-after-make\.txt"\); \} \}/.test(og));
const take = code(body(og, 'public static bool TakeFixAfterMake()'));
yes('reading the note deletes it, so Fix runs once for it',
  /if \(!File\.Exists\(f\)\) return false;\s*File\.Delete\(f\);\s*return true;/.test(take));
yes('and a note that cannot be deleted does not run Fix, so it never runs at every start',
  /catch \(Exception ex\)\s*\{\s*Swallow\.Note\([^)]*\);\s*return false;\s*\}/.test(take));

// 2. the first start in the folder
const start = code(body(own, 'static void OwnGameAtStart()'));
yes('the first start in the folder takes the note', /if \(active\) fixAfterMake = OwnGame\.TakeFixAfterMake\(\);/.test(start));
yes('and does not stop before running Fix when nothing else is due', /if \(!refresh && !offer && !fixAfterMake\) return;/.test(start));
yes('it runs Fix as the Fix after a make', /Action fix = fixAfterMake \? \(Action\)delegate \{ RunFix\(false, false, true\); \} : null;/.test(start));
yes('after a bring-up-to-date that is due, whether it succeeds or not',
  /if \(!StartOwnGame\(false, false, fix, fix\) && fix != null\) fix\(\);/.test(start));
yes('and straight away when none is', /else if \(offer\) AskOwnGame\(true\);\s*else fix\(\);/.test(start));

// 3. Fix itself
const runFix = code(body(sf, 'static async Task RunFixAsync(bool afterUpdate, bool afterVortex, bool afterMake)'));
yes('Fix knows it is the one after a make', runFix.length > 0);
yes('it waits for a folder being prepared and the folder\'s finish runs it',
  runFix.indexOf('if (ownGameBusy && afterMake) { fixWhenFolderReady = true; fixWhenFolderReadyAfterMake = true;') >= 0 &&
  runFix.indexOf('if (ownGameBusy && afterMake)') < runFix.indexOf('if (ownGameBusy) {') &&
  own.indexOf('else if (fixWhenFolderReadyAfterMake) { fixWhenFolderReadyAfterMake = false; RunFix(false, false, true); }') >= 0);
yes('the log says what it is doing and that Pandora and BodySlide show their own windows',
  /afterMake \? "Thornswood's own Skyrim folder is made\. Scanning everything[^"]*Pandora and BodySlide build in their own windows\."/.test(runFix));
yes('the rest is the Fix a press runs: the folder first, then FixRest',
  /StartOwnGame\(false, true, delegate \{ Begin\(FixRest\(afterUpdate, afterVortex\)\); \}, delegate \{ Begin\(FixRest\(afterUpdate, afterVortex\)\); \}\)/.test(runFix) &&
  /await FixRest\(afterUpdate, afterVortex\);\s*\}$/.test(runFix.trim()));
const disk = code(body(upkeep, 'public static void FixOnDisk('));
yes('and Fix writes the made files, builds the animation and body files and puts the plugin list in the server\'s order',
  disk.indexOf('MadeFromGame.Ensure()') > 0 && disk.indexOf('GeneratedHere.Ensure(say)') > 0 && disk.indexOf('Verify.Fix(cfg, say, Updater.ReleaseCopy(cfg))') > 0);

// 4. the scan before the folder
const look = code(body(upkeep, 'public static List<Issue> Look(Config cfg, bool pressed)'));
yes('the scan before the folder is made does not judge the made files against Profile\\Payload',
  /if \(!Paths\.OwnFirst\)\s*\{\s*try \{ Made\(l\); \}/.test(look));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
