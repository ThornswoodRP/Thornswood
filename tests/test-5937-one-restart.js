// test-5937-one-restart.js
//
//     node tests/test-5937-one-restart.js
//
// The first setup restarts the launcher once (Patrick, 12 Nov 2026: "it
// should do the scan and fix, the own game folder, and all the body slider and
// pandora stuff and update to the latest version if the launcher is ... behind
// ... and than restart just once").
//
// Before this the make restarted the launcher, the start after it ran Fix,
// and a newer launcher found by a check after that restarted it again. Paths
// already name the new folder once the make is done (FolderWork), so:
//   1. the make's finish runs Fix in this run, as the Fix after a make, and
//      does not restart; it takes the note first, so the start after the
//      restart does not run Fix a second time;
//   2. an update already going in restarts the launcher itself once the
//      folder is let go, so Fix is left to the note on the start after it;
//   3. no update goes in by itself while that Fix runs (UpdateBySelf), so
//      none closes the launcher while Pandora or BodySlide build;
//   4. the end of that Fix, found something or not, is FirstSetupRestart:
//      it asks GitHub for the newest launcher then, takes it when automatic
//      updates are on (Velopack's start of it is the one restart; one that
//      fails still restarts once), and otherwise restarts once;
//   5. Skyrim on another build still goes to the Downgrade, which restarts
//      into what it makes, and the flag is let go.
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
const upd = read(app + 'ShellUpdate.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function body(src, sig) {
  const at = src.indexOf(sig);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return '';
}
// Comments quote code on purpose; only the code is read.
function code(src) { return src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'); }

// 1 and 2. The make's finish.
const work = code(body(own, 'static void FolderWork('));
const made = work.slice(work.indexOf('if (make)', work.indexOf('Log(said);')));
const madeBlock = made.slice(0, made.indexOf('return;', made.indexOf('RunFix(')) + 7);
yes('the make\'s finish runs Fix in this run, as the Fix after a make', /RunFix\(false, false, true\);/.test(madeBlock));
yes('and does not restart there', !/RestartLauncher\(\);/.test(madeBlock));
const take = madeBlock.indexOf('OwnGame.TakeFixAfterMake();');
const flag = madeBlock.indexOf('restartAfterFirstFix = true;');
const run = madeBlock.indexOf('RunFix(false, false, true);');
yes('it takes the note before that Fix, so the start after the restart does not run it again', take > 0 && take < run);
yes('and marks the run for its one restart before Fix starts', flag > 0 && flag < run);
const upd1 = madeBlock.indexOf('if (updating)');
yes('an update already going in is left to restart the launcher, and Fix to the note', upd1 > 0 && upd1 < take && /if \(updating\)\s*\{[^}]*return;\s*\}/.test(madeBlock));

// 3. No update by itself meanwhile.
const self = code(body(upd, 'static void UpdateBySelf()'));
yes('no update goes in by itself while the first setup\'s Fix runs', /if \(restartAfterFirstFix\) return;/.test(self));

// 4. The one restart.
const fsr = code(body(sf, 'static void FirstSetupRestart()'));
yes('FirstSetupRestart runs once: it lets the flag go first', /if \(!restartAfterFirstFix\) return;\s*restartAfterFirstFix = false;/.test(fsr));
yes('it asks GitHub for the newest launcher then, off the window\'s thread', /ThreadPool\.QueueUserWorkItem/.test(fsr) && /Updater\.CheckLauncher\(cfg\)/.test(fsr));
yes('and records the answer as any check does', /LauncherAnswer\(asked, launcher, note, why, false\);/.test(fsr));
yes('a newer launcher goes in when automatic updates are on and it is not the one that just failed',
  /pendingLauncher != null && cfg\.AutoUpdate/.test(fsr) && /updateTried != pendingLauncher\.Version/.test(fsr) && /RunUpdate\(/.test(fsr));
yes('one that fails still restarts once', /RunUpdate\(delegate\(bool wentIn\) \{ RestartLauncher\(\); \}\);/.test(fsr));
yes('otherwise the launcher restarts once', (fsr.match(/RestartLauncher\(\);/g) || []).length === 2);

const runFix = code(body(sf, 'static void RunFix(bool afterUpdate'));
const nothing = runFix.slice(runFix.indexOf('if (AllIssues(plugins).Count == 0)'));
yes('a Fix that finds nothing ends in the one restart', /ShowVerify\(plugins, false\);\s*FirstSetupRestart\(\);\s*return;/.test(nothing));
const rest = code(body(sf, 'static void FixRest('));
const report = rest.indexOf('Report(plugins);');
const first = rest.indexOf('FirstSetupRestart();');
const asks = rest.indexOf('if (Paths.Collection && Has(Upkeep.LastIssues, IssueKind.Skyrim))');
yes('a Fix that put things right ends in it, after its report and before anything asks or restarts', report > 0 && first > report && asks > first);

// 5. The Downgrade.
yes('Skyrim on another build goes to the Downgrade and lets the flag go',
  /if \(restartAfterFirstFix\)\s*\{\s*if \(!Has\(Upkeep\.LastIssues, IssueKind\.Skyrim\)\) \{ FirstSetupRestart\(\); return; \}\s*restartAfterFirstFix = false;\s*\}/.test(rest));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
