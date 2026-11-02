// test-browser-backend.js
//
// What the launcher's comments say about the in game browser agrees with what
// the code does, and none of them claims which backend this build runs on.
//
// WHY THIS EXISTS. To Do entry 268, "Which browser the in-game interface uses
// is inferred from another server's file, and recorded nowhere", warned that
// "the repo currently contradicts itself about NirnLabUIPlatform in three
// places". On 24 September two of them were still in launcher/app/Checks.cs. The
// note on ForeignNames said NirnLab "is the browser backend this build runs
// on", that SkyrimPlatform.ini says BackendName = nirnlab, and that
// Data\NirnLabUIPlatform "is not foreign either"; the note on ForeignPaths
// called that folder "this build's own browser". Meanwhile OwnGame.Foreign and
// Test-ShipOtherServer in scripts/release/Ship-Rules.ps1 both leave NirnLab out as
// another server's, and the ini on Patrick's machine read BackendName =
// tilted, with his thornswood-front.log saying "browser backend: tilted".
//
// A comment that names the backend goes stale the moment the folder changes,
// and a session reading it believes the wrong browser is live. So the notes
// now point at the two places that do know, Chars.WriteBrowserBackend, which
// chooses on every Play, and thornswood-front.log, where the plugin writes
// what SkyrimPlatform answered. This checks that the claim is gone, that the
// pointers are there and lead somewhere real, and that the warning never to
// put NirnLabUIPlugin.dll back on the list survived the rewrite.
//
// Since 27 September (issue #474) it also checks the record itself: the
// choice WriteBrowserBackend makes reaches launcher.log on every Play,
// config.json across a restart, and a line on the Settings page. Since the
// move to .NET 10 and Avalonia (#4823) config.json is written by
// System.Text.Json, which takes a field marked [JsonInclude], and the Settings
// line is in launcher\app\MainWindow.axaml, reached as win.TxtInGameBrowser.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const REPO = REPO_DIR;
function read(rel) { return fs.readFileSync(path.join(REPO, rel), 'utf8'); }

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The body of the first block that opens after `head`, braces matched.
function body(src, head) {
  const at = src.indexOf(head);
  if (at < 0) return '';
  const b = src.indexOf('{', at);
  if (b < 0) return '';
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(b, i + 1); }
  }
  return '';
}

// Every // and /// comment in a C# file, joined into one line of prose so a
// phrase that wraps across two comment lines is still found.
function comments(src) {
  const out = [];
  src.split(/\r?\n/).forEach(function (line) {
    const m = /^\s*\/\/\/?(.*)$/.exec(line);
    if (m) out.push(m[1].trim());
  });
  return out.join(' ').replace(/\s+/g, ' ');
}

const checks = read('launcher/app/Checks.cs');
const chars = read('launcher/app/Chars.cs');
const ownGame = read('launcher/app/OwnGame.cs');
const shipRules = read('scripts/release/Ship-Rules.ps1');
const front = read('game/plugins/thornswood-front.js');

// The note on ForeignNames: from its warning line to the ForeignPaths array.
const noteFrom = checks.indexOf('NirnLabUIPlugin.dll WAS on this list');
const noteTo = checks.indexOf('public static readonly string[] ForeignPaths');
yes('Checks.cs still has the note on ForeignNames and the ForeignPaths array after it',
  noteFrom >= 0 && noteTo > noteFrom);
// Sliced from the start of the warning's line, so its /// is kept.
const note = comments(checks.slice(checks.lastIndexOf('\n', noteFrom) + 1, noteTo));
const all = comments(checks);

// 1. The warning that matters most survived.
yes('the note still says NirnLabUIPlugin.dll must never go back on the list',
  /NirnLabUIPlugin\.dll WAS on this list and must never go back on it\./.test(note));

const names = body(checks, 'ForeignNames =');
const paths = body(checks, 'ForeignPaths =');
yes('the ForeignNames array was found', names.length > 0);
yes('the ForeignPaths array was found', paths.length > 0);
yes('ForeignNames names nothing of NirnLab\'s', !/nirnlab/i.test(names));
yes('ForeignPaths names nothing of NirnLab\'s', !/nirnlab/i.test(paths));

// 2. No comment in Checks.cs says which backend this build runs on.
const claims = [
  [/backend this build runs on/i, '"the browser backend this build runs on"'],
  [/this build'?s own browser/i, '"this build\'s own browser"'],
  [/\b(this|the) build (runs|is running|uses) (on )?(nirnlab|tilted)\b/i, 'the build runs on a named backend'],
  [/SkyrimPlatform\.ini says BackendName/i, '"SkyrimPlatform.ini says BackendName ..." in the present tense'],
  [/is not foreign either/i, 'Data\\NirnLabUIPlatform "is not foreign either"'],
  [/It is not another server'?s file/i, '"It is not another server\'s file"'],
];
claims.forEach(function (c) {
  yes('no comment in Checks.cs claims ' + c[1], !c[0].test(all));
});

// 3. OwnGame.Foreign and Test-ShipOtherServer do leave NirnLab out, which is
//    what made the old wording a contradiction and what the note now says.
const foreign = body(ownGame, 'public static bool Foreign(string rel)');
yes('OwnGame.Foreign was found', foreign.length > 0);
yes('OwnGame.Foreign leaves out Data\\NirnLabUIPlatform',
  /"Data\\\\NirnLabUIPlatform\\\\"[\s\S]{0,80}return true;/.test(foreign));
yes('OwnGame.Foreign leaves out NirnLabUIPlugin.dll',
  /"NirnLabUIPlugin\.dll"[\s\S]{0,80}return true;/.test(foreign));
const shipOther = body(shipRules, 'function Test-ShipOtherServer');
yes('Test-ShipOtherServer was found', shipOther.length > 0);
yes('Test-ShipOtherServer leaves out Data\\NirnLabUIPlatform',
  /NirnLabUIPlatform[^\n]*return \$true/.test(shipOther));
yes('Test-ShipOtherServer leaves out NirnLabUIPlugin.dll',
  /'NirnLabUIPlugin\.dll'\)[^\n]*return \$true/.test(shipOther));
yes('the note names OwnGame.Foreign as what keeps NirnLab out of the own folder',
  /OwnGame\.Foreign/.test(note));
yes('the note names Test-ShipOtherServer as the same rule', /Test-ShipOtherServer/.test(note));
const pathsFrom = checks.indexOf('The rest of another server\'s client');
const pathsNote = comments(checks.slice(checks.lastIndexOf('\n', pathsFrom) + 1, noteTo));
yes('the note on ForeignPaths points at OwnGame.Foreign too',
  /deliberately NOT here[\s\S]{0,200}OwnGame\.Foreign/.test(pathsNote));

// 4. The note points at where the answer is recorded, and both places exist.
yes('the note points at Chars.WriteBrowserBackend', /Chars\.WriteBrowserBackend/.test(note));
yes('Chars.cs defines WriteBrowserBackend', /static \w+ WriteBrowserBackend\(\)/.test(chars));
yes('Chars.cs chooses between nirnlab and tilted there',
  /string want = nirnlab \? "nirnlab" : "tilted";/.test(chars));
yes('the note points at Data\\Platform\\thornswood-front.log',
  /Data\\Platform\\thornswood-front\.log/.test(note));
yes('thornswood-front.js writes to Data/Platform/thornswood-front.log',
  /LOG_FILE = 'Data\/Platform\/thornswood-front\.log'/.test(front));
yes('thornswood-front.js logs the backend SkyrimPlatform answered',
  /sp\.browser\.getBackend\(\)/.test(front) && /say\('browser backend: '/.test(front));

// 5. The choice is recorded (issue #474). WriteBrowserBackend used to be void,
//    so nothing afterwards knew what it had decided. It returns the name now
//    from every way out, the steady state included: on a healthy install the
//    ini already says the right thing and `if (next == text) return` is the
//    exit that runs on every Play, so a return added only at the end would
//    leave the record blank exactly when it matters.
const wbb = body(chars, 'static string WriteBrowserBackend()');
yes('WriteBrowserBackend returns a string', /static string WriteBrowserBackend\(\)/.test(chars) && wbb.length > 0);
yes('WriteBrowserBackend has no bare return left', wbb.length > 0 && !/\breturn\s*;/.test(wbb));
yes('no SkyrimPlatform.ini returns null', /if \(!File\.Exists\(PlatformIni\)\) return null;/.test(wbb));
yes('the steady state (ini already right) returns the choice', /if \(next == text\) return want;/.test(wbb));
yes('a written ini returns the choice',
  /File\.WriteAllText\(PlatformIni, next, new UTF8Encoding\(true\)\);\s*return want;/.test(wbb));
yes('a read or write that threw returns null, after the Swallow note',
  /Swallow\.Note\("Chars\.WriteBrowserBackend, write", ex\);\s*\}[\s\S]*return null;\s*\}$/.test(wbb));
yes('the ini keeps its byte order mark (UTF8Encoding(true))', /new UTF8Encoding\(true\)/.test(wbb));
const prepare = body(chars, 'public static string Prepare(Config cfg)');
yes('Chars.Prepare keeps the answer in Chars.BrowserBackend',
  /BrowserBackend = WriteBrowserBackend\(\);/.test(prepare));
yes('Chars.BrowserBackend is readable from Shell',
  /public static string BrowserBackend \{ get; private set; \}/.test(chars));

const config = read('launcher/app/Config.cs');
yes('config.json has a BrowserBackend field, so the answer survives a restart',
  /\[JsonInclude\] public string BrowserBackend = "";/.test(config));

const shellChars = read('launcher/app/ShellChars.cs');
const startPlay = body(shellChars, 'static void StartPlay()');
yes('StartPlay records the backend right after Chars.Prepare',
  /Chars\.Prepare\(cfg\)[\s\S]{0,300}RecordBrowserBackend\(\);/.test(startPlay));
const record = body(shellChars, 'static void RecordBrowserBackend()');
yes('RecordBrowserBackend reads Chars.BrowserBackend', /Chars\.BrowserBackend/.test(record));
yes('launcher.log gets "In-game browser: <name>" on every Play',
  /LogOnly\([\s\S]*"In-game browser: " \+ backend/.test(record));
yes('launcher.log says so when the answer is not known',
  /"In-game browser: not known/.test(record));
yes('config.json is saved only when the answer changed',
  /if \(keep != \(cfg\.BrowserBackend \?\? ""\)\)[\s\S]*cfg\.Save\(Paths\.CfgFile\);/.test(record));
yes('the Settings line is redrawn after a Play', /DrawInGameBrowser\(\);/.test(record));

const draw = body(shellChars, 'static void DrawInGameBrowser()');
yes('DrawInGameBrowser takes TxtInGameBrowser from the window', /win\.TxtInGameBrowser\b/.test(draw));
yes('the Settings line reads "In-game browser: <name>"', /"In-game browser: " \+ b/.test(draw));
const ui = read('launcher/app/MainWindow.axaml');
const settingsPage = ui.slice(ui.indexOf('x:Name="PageSettings"'));
yes('MainWindow.axaml has TxtInGameBrowser on the Settings page',
  ui.indexOf('x:Name="PageSettings"') >= 0 && /x:Name="TxtInGameBrowser"/.test(settingsPage));
const shell = read('launcher/app/Shell.cs');
yes('the Settings line is drawn at startup with the folder rows',
  /DrawInGameBrowser\(\);/.test(body(shell, 'static void BuildPathRows()')));

// The inference itself is not changed by the record: the folder still decides.
yes('the folder still decides: NirnLabUIPlatform.dll present means nirnlab',
  /bool nirnlab = File\.Exists\(Path\.Combine\(\s*Paths\.Game, "Data\\\\NirnLabUIPlatform\\\\NirnLabUIPlatform\.dll"\)\);/.test(wbb));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
