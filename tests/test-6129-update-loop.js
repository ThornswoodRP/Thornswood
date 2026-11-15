// test-6129-update-loop.js
//
//     node tests/test-6129-update-loop.js
//
// #6129. Switching One from dev (1.3.65) back to main (1.3.55) on 15 Nov 2026
// looped from 11:16 AM: Velopack's apply failed every time on a held folder,
// started the old launcher again, and that launcher took the same update
// again, every 15 seconds, until GitHub's allowance for the address ran out.
// Twice the launcher sat on Updating instead. Measured on One:
//   - Icons.Repair restarted Explorer at 11:15:39 from the launcher's working
//     folder, Velopack's current folder, and Explorer kept it for as long as
//     it ran, so Velopack could not move current aside ("being used by another
//     process");
//   - after a failed apply Velopack starts the launcher again, which had no
//     record of the update it handed over and took it again;
//   - the automatic update ran while the scan after an update was running,
//     its close was held back for that scan ("Wait for Skyrim to finish
//     closing", with no Skyrim) and never made again.
// So this reads the launcher for:
//   1. the launcher leaves current right after Velopack's start, before it
//      starts anything, and works from Velopack's root, which no update moves;
//   2. Icons.Repair starts Explorer from the Windows folder;
//   3. the version handed to Velopack is written as the launcher ends, before
//      ExitApply, and the next start reads it: still on another version, it
//      says so with Velopack's own error line and marks it tried;
//   4. the automatic update never runs while a Fix does (Fix takes it last),
//      and never takes the tried one;
//   5. a close held back by a wait is made once the last wait ends when an
//      update is staged, and the held-back line no longer blames Skyrim.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const app = 'launcher/app/';
const shell = read(app + 'Shell.cs');
const velo = read(app + 'Velo.cs');
const icons = read(app + 'Icons.cs');
const upd = read(app + 'ShellUpdate.cs');
const waiting = read(app + 'Waiting.cs');

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
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

// 1. Out of current, first thing after Velopack's start.
const main = body(shell, 'static void Main(string[] args)');
const startAt = main.indexOf('Velo.Start(args, Uninstall.FromVelopack);');
const leaveAt = main.indexOf('Velo.LeaveCurrentFolder()');
yes('1. Main leaves current right after Velo.Start', startAt >= 0 && leaveAt > startAt);
const between = main.slice(startAt, leaveAt);
yes('1. and starts nothing before it', !/Process\.Start|new Mutex|Run\(/.test(between.replace('Velo.Start(args, Uninstall.FromVelopack);', '')));
const leave = body(velo, 'public static string LeaveCurrentFolder()');
yes('1. LeaveCurrentFolder works from Velopack\'s root', /Environment\.CurrentDirectory = root;/.test(leave) && /Locator\.RootAppDir/.test(leave));
yes('1. and does nothing for a launcher Velopack did not install', /if \(!Installed\) return null;/.test(leave));
yes('1. what it could not do is said in launcher.log', /if \(leftCurrentFolder != null\) LogOnly\(leftCurrentFolder\);/.test(shell));

// 2. Explorer from the Windows folder.
const repair = body(icons, 'public static string Repair()');
yes('2. Icons.Repair starts Explorer with a working folder of its own', /new ProcessStartInfo\("explorer\.exe"\)/.test(repair)
  && /psi\.WorkingDirectory = Environment\.GetFolderPath\(Environment\.SpecialFolder\.Windows\);/.test(repair));
yes('2. and never with the launcher\'s', !/Process\.Start\("explorer\.exe"\)/.test(repair));

// 3. The handed-over update, kept across the restart.
const handAt = main.indexOf('HandOverUpdate(Velo.StagedVersion);');
const exitAt = main.indexOf('Velo.ExitApply();');
yes('3. the version handed to Velopack is written before ExitApply', handAt >= 0 && exitAt > handAt);
const say = body(upd, 'static void SayHandedUpdate()');
yes('3. the next start reads it once and deletes it', /File\.ReadAllText\(file\)/.test(say) && /File\.Delete\(file\);/.test(say));
yes('3. still on another version, it is marked tried', /version == Updater\.Version\) return;/.test(say) && /updateTried = version;/.test(say));
yes('3. and said with Velopack\'s own error line', /Velo\.LastError\(\)/.test(say) && /Velopack said: /.test(say));
yes('3. Velopack\'s log is read where Velopack writes it', /"velopack", "velopack_" \+ l\.AppId \+ "\.log"/.test(velo));
yes('3. the start reads it once the window is up', /try \{ SayHandedUpdate\(\); \}/.test(shell));

// 4. The automatic update.
const self = body(upd, 'static void UpdateBySelf()');
yes('4. no automatic update while a Fix runs', /if \(fixing\) return;/.test(self));
yes('4. and never the one that was tried', /updateTried != null && updateTried == pendingLauncher\.Version/.test(self));

// 5. A held-back close.
yes('5. the held-back close no longer blames Skyrim', !/Wait for Skyrim to finish closing/.test(shell));
yes('5. with an update staged, the close is kept for when the waits end', /if \(Velo\.Staged\)\s*\{\s*closeWhenWaitsEnd = true;/.test(shell));
const go = body(waiting, 'static void LetWindowGo()');
yes('5. the last wait to end makes the close', /if \(closeWhenWaitsEnd\)/.test(go) && /win\.Close\(\)/.test(go)
  && go.indexOf('closeWhenWaitsEnd') > go.indexOf('if (waitDepth > 0) return;'));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
