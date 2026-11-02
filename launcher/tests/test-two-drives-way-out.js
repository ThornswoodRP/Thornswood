// test-two-drives-way-out.js
//
//     node launcher\tests\test-two-drives-way-out.js
//
// Skyrim on one drive and Thornswood on another is a refusal that names the
// way out, not a rule with nothing to press.
//
// WHY THIS EXISTS. Thornswood's own game folder is built from hard links, and
// Windows will not make a hard link across volumes, so OwnGame.WhyNot has
// always refused when the two are apart. What it said was "Skyrim is on D: and
// Thornswood is on C:. Links only work inside one drive, so Thornswood has to
// be installed on the same drive as Skyrim for this." That is where it ended:
// a rule, no path, no button, nothing to do next. And since Play began
// refusing to start out of a shared Skyrim (Shell.OwnGameRequired), that
// sentence stopped being a feature nobody could have and became the whole
// game for anybody who keeps their Steam library on a second drive.
//
// WHAT THIS HOLDS THE LAUNCHER TO.
//   1. The dead end sentence is gone from the launcher.
//   2. Both cross-drive answers still refuse, through OneDriveOnly. The links
//      are settled design, so this is not a place to start copying 26 to 41 GB
//      instead, quietly or otherwise.
//   3. The answer names both sides by path and by drive letter, and both ways
//      out: install Thornswood on the other drive, which lands in
//      <drive>\Thornswood, or move the other side to Thornswood's drive. Each
//      way out is somebody else's screen, so each says which one and which
//      buttons: Steam, Settings, Storage for the Steam library, and Vortex,
//      Settings, Mods for Vortex's staging folder.
//   4. It stays one sentence with no line break. The same string goes to a
//      box (Ask.Tell), to the card in Settings, to the one line status strip on
//      the Play page and to Profile\launcher.log, which is one entry to a line.
//   5. Everything that shows WhyNot's answer shows all of it, so the drive
//      letters and the two ways out are what the person reads.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const appDir = path.join(REPO_DIR, 'launcher', 'app');
const own = fs.readFileSync(path.join(appDir, 'OwnGame.cs'), 'utf8');
const shell = fs.readFileSync(path.join(appDir, 'ShellOwnGame.cs'), 'utf8');

// ---- 1. the dead end is gone ------------------------------------------------

// Comment lines are dropped first: the comment beside the volume test quotes
// the sentence it replaced, on purpose, so the next person reading that code
// knows what it used to say and why it changed. What must not come back is a
// sentence the launcher shows.
const code = own.split('\n').filter(function (l) { return l.trim().indexOf('//') !== 0; }).join('\n');
yes('nothing the launcher says ends at "has to be installed on the same drive"',
    code.indexOf('has to be installed on the same drive') < 0);

// ---- 2. it is still a refusal, and both sides go through one answer ---------

// The public WhyNot hands on to the overload that has the body, which a Make
// given the game's own files in a folder of their own calls too (#2603).
const whyNot = /static string WhyNot\(Config cfg, string src, bool skyrimGiven\)\s*\{([\s\S]*?)\n        \}/.exec(own);
yes('OwnGame.WhyNot is still the one place that says why not', !!whyNot);
const body = whyNot ? whyNot[1] : '';

// Skyrim's volume, then Vortex's staging folders: each still refuses rather
// than falling through to copies.
// Since #1218 the folder checked is the Steam copy for a first build and the
// folder Vortex deploys into once made, since only Vortex's files are linked
// then (test-own-folder-alone.ps1).
const gate = /string linked = made \? src : game;\s*if \(!SameVolume\(linked, Paths\.Root\)\)\s*return OneDriveOnly\(/.test(body);
yes('Skyrim on another drive still refuses, through OneDriveOnly', gate);
const staging = /foreach \(string dir in rec\.Staging\)[\s\S]*?if \(!SameVolume\(dir, Paths\.Root\)\)\s*return OneDriveOnly\(/.test(body);
yes("Vortex's mods on another drive still refuse, through OneDriveOnly", staging);

// ---- 3. what the answer names ----------------------------------------------

const one = /static string OneDriveOnly\(string where, string theirs, string move\)\s*\{([\s\S]*?)\n        \}/.exec(own);
yes('OwnGame.OneDriveOnly is there to build that answer', !!one);
const said = one ? one[1] : '';

yes('it names the drive the other side is on', said.indexOf('" + theirs + "') >= 0 || said.indexOf('+ theirs +') >= 0);
yes("it names Thornswood's folder and the drive it is on",
    said.indexOf('Paths.Root') >= 0 && said.indexOf('Volume(Paths.Root)') >= 0);
yes('the first way out is installing Thornswood on the other drive, with Thornswood-Setup.exe',
    said.indexOf('Install Thornswood on ') >= 0 && said.indexOf('Thornswood-Setup.exe') >= 0);
// Velopack's Setup.exe over an install asks to replace it, takes Velopack's
// folder with install-root.txt away, and the first start's install window
// asks for the drive again (Shell.Run, InstallPlace.Recorded).
yes("and says the install window is where the drive is chosen",
    said.indexOf("install window asks where to put it") >= 0);
yes('and it says where that lands, <drive>\\Thornswood',
    said.indexOf('\\\\Thornswood') >= 0);
yes('the second way out is passed in, so each side names its own screen',
    said.indexOf('+ move +') >= 0);

// The two ways out that are somebody else's screen, read off the call sites.
yes('moving the Steam library says Steam, Settings, Storage, and Move',
    /move Skyrim to[\s\S]*?Steam, Settings, Storage[\s\S]*?press Move/.test(body));
yes("moving Vortex's mods says Vortex, Settings, Mods, and the staging folder",
    /move Vortex's mods to[\s\S]*?Vortex, Settings, Mods[\s\S]*?staging folder/.test(body));

// ---- 4. one sentence, because of where it is shown --------------------------

yes('the answer carries no line break, so the status strip and the log hold it whole',
    said.indexOf('\\n') < 0);

// ---- 5. everything that shows it shows all of it ----------------------------

const required = /static bool OwnGameRequired\(\)\s*\{([\s\S]*?)\n        \}/.exec(shell);
yes('Play still refuses through OwnGameRequired', !!required);
const box = required ? required[1] : '';
yes('the box Play puts up ends with the whole answer', /"The folder cannot be made yet:\\n\\n" \+ why;/.test(box));
yes('and the log line carries it too', /Log\([\s\S]*?\+ why\);/.test(box));

const ask = /static void AskOwnGame\(bool atStart\)\s*\{([\s\S]*?)\n        \}/.exec(shell);
yes('Make it, in Settings, shows the whole answer as well',
    !!ask && /Ask\.Tell\(why,/.test(ask[1]));
yes('and the card in Settings draws it whole', /"Off\. " \+ why/.test(shell));
yes('nothing cuts the answer down before showing it',
    shell.indexOf('why.Substring') < 0 && shell.indexOf('why.Split') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
