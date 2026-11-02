/*
  test-downgrade-copy-order.js

  The downgrade finishes safely and the installer sends a wrong build to it.
  This guards the three fixes from issue #369 that shipped without a harness of
  their own (commit 146b605, "Launcher: #369 F1/F2/F3/F4 downgrade path").

  WHY THIS EXISTS. Three small faults were found on the downgrade path and
  fixed but never covered by a test, so a later change could undo any of them
  in silence. This reads the source and checks the shape each fix relies on:

    F1  launcher\app\InstallSteps.cs, the install Velopack's Setup.exe runs
        (installer\Setup-Thornswood.ps1 until #4824): a wrong Skyrim build is
        not a failed check. Counting it as a miss kept the window shut and never opened the
        launcher whose Downgrade button fixes it. So the build check counts it
        as next, and the notice above tells the person to press Downgrade in
        the launcher, not to pick a build from Steam's Betas list.

    F3  launcher\app\OwnGameShare.cs, TakePinned, which the Downgrade copies
        through since #1218: SkyrimSE.exe is held back and copied last,
        after every other file is in place. The build is read from that one
        file, so the moment it lands the copy reads as 1.6.1170. Copied first,
        a copy that then stops part way took the Downgrade card and its Try
        again button away with the job unfinished; copied last, a stop part way
        leaves the exe on the old build so the card and button stay.

    F4  launcher\app\Downgrade.cs: the twenty minute fallback takes a part as
        done only once the folder has reached the size Steam announced for it.
        A folder short of that is a stall, not a finish, and taking it as done
        writes the marker and copies truncated files over the Steam copy.

  The launcher cannot be started from here (the ops repo's CLAUDE.md forbids it), and this
  machine has no Windows csc, so like test-downgrade-asks.js this reads the
  source and checks the shape rather than running the button.

  Read only. It reads launcher\app\Downgrade.cs, launcher\app\OwnGameShare.cs
  and launcher\app\InstallSteps.cs.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const ROOT = REPO_DIR;
const APP = path.join(ROOT, 'launcher', 'app');
const DOWN = fs.readFileSync(path.join(APP, 'Downgrade.cs'), 'utf8');
const SETUP = fs.readFileSync(path.join(APP, 'InstallSteps.cs'), 'utf8');

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

/* A method's body: from its signature to the closing brace at the same indent. */
function body(src, signature) {
  const at = src.indexOf(signature);
  if (at < 0) return '';
  const lineStart = src.lastIndexOf('\n', at) + 1;
  const indent = src.slice(lineStart, at);
  const end = src.indexOf('\n' + indent + '}', at);
  return end < 0 ? '' : src.slice(at, end + indent.length + 2);
}

// ============================================================ F1, the installer

// The build check counts a wrong game build as next and hands it to the
// launcher's Downgrade button.
const gameBranch = /\n\s*else if \(c\.Key == "Game 1\.6\.1170"\)\s*\{([\s\S]*?)\n\s*\}\s*\n\s*else\s*\{/.exec(SETUP);
yes('F1: the build check has a branch for a wrong Game 1.6.1170', !!gameBranch);
const branchText = gameBranch ? gameBranch[1] : '';
yes('F1: a wrong build is counted as next, not a miss', /Later\+\+/.test(branchText) && !/Bad\+\+/.test(branchText));
yes('F1: it says the launcher\'s Downgrade button fixes this', /"  \[next\] " \+ c\.Key \+ "  the launcher's Downgrade button fixes this"/.test(branchText));
// The MISS branch that adds to Bad is the one after it, so the two do not
// collapse into one: a real miss still fails the install.
yes('F1: a real miss still counts against the install', /\n\s*else\s*\{\s*Say\("  \[MISS\] " \+ c\.Key\);\s*Bad\+\+;/.test(SETUP));

// The notice above the check points at the launcher's Downgrade button, not at
// Steam's Betas list, which is where it used to send people.
yes('F1: the wrong-build notice tells the person to open the launcher and press Downgrade',
    /Open the launcher and press Downgrade/.test(SETUP));
yes('F1: and no longer sends anybody to Steam\'s Betas list', !/Betas/.test(SETUP));

// ======================================================== F3, SkyrimSE.exe last

const run = body(DOWN, 'static bool Run(Config cfg');
yes('Run is found in Downgrade.cs', run.length > 0);

// Since #1218 the copy is OwnGame.TakePinned (OwnGameShare.cs), which puts the
// files into Thornswood's own folder and never into the Steam copy; Run calls it
// and turns what it throws into Stop. test-own-folder-alone.ps1 runs it.
const SHARE = fs.readFileSync(path.join(APP, 'OwnGameShare.cs'), 'utf8');
const take = body(SHARE, 'public static string TakePinned(Config cfg');
yes('TakePinned is found in OwnGameShare.cs, and Run copies through it', take.length > 0 && /OwnGame\.TakePinned\(cfg, folders,/.test(run));

// In the walk of the downloads SkyrimSE.exe is not taken where it is met: it is
// held in exe and added to the end of the list.
yes('F3: SkyrimSE.exe is held back in the walk, not copied in place',
    /if \(string\.Equals\(f\.Rel, "SkyrimSE\.exe", StringComparison\.OrdinalIgnoreCase\)\) exe = f;\s*else take\.Add\(f\);/.test(take));

// The held-back exe goes on the end of the list after the walk, and the list is
// copied in order.
const heldSkip = take.indexOf('exe = f;');
const exeLast = take.indexOf('if (exe != null) take.Add(exe);');
const copyLoop = take.indexOf('foreach (Found f in take)');
yes('F3: the held-back exe is copied last, after every other file', heldSkip >= 0 && exeLast > heldSkip && copyLoop > exeLast);
yes('F3: each file is copied by its path, its old name taken off first',
    /if \(File\.Exists\(dest\)\) DropName\(dest\);\s*File\.Copy\(f\.From, dest, false\);/.test(take));
// A file that will not copy (a locked exe) throws, and Run stops through Stop,
// so the card and Try again button stay.
yes('F3: a locked file stops the run through Stop, so the card and Try again button stay',
    /throw new Exception\("Could not put " \+ f\.Rel/.test(take) &&
    /catch \(Exception ex\)\s*\{\s*return Stop\(ex\.Message, log, status\);\s*\}/.test(run));
yes('F3: the build is read again after the copy, and a wrong one stops through Stop',
    /bool right = File\.Exists\(targetExe\) && !Wrong\(cfg, targetExe\);/.test(run));

// ================================================== F4, only at the announced size

// The twenty minute fallback takes a part as done only once size has reached
// the total Steam announced, and only for a download this run saw start.
yes('F4: a stalled part is taken as done only at the size Steam announced',
    /if \(sawStart && total > 0 && size >= total\)/.test(run));
yes('F4: and the log says it was the announced size that was reached',
    /the folder has reached the " \+ \(total \/ 1048576\)\.ToString\("n0"\) \+ " MB Steam announced for this part/.test(run));
// A folder that never saw a start line is still refused as leftover, so a short
// or aborted folder is not trusted.
yes('F4: a folder this run never saw start is still refused as leftover',
    /if \(!sawStart\)\s*\n\s*return Stop\("Steam never started this download/.test(run));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
