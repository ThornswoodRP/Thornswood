// test-3204-open-steam.js
//
//     node .\launcher\tests\test-3204-open-steam.js
//
// The Ready card on the launcher's Play page has an Open Steam button while
// Steam is not running, and notices Steam starting or closing by itself (#3204).
//
// WHAT HAPPENED. Patrick, 21 Oct 2026, 6:30 PM: "when steam isn't running it
// needs to say not running instead of running and a button to open steam".
// The wording was fixed with #3203. Two things were left. Nothing on the card
// opened Steam. And the rows were drawn on a page change, a scan or a recheck
// and at no other time, so Steam closed after that still read "running", and
// Steam started by hand left "Steam not running" up until somebody changed
// page.
//
// THE FIX. The window has BtnOpenSteam on the Ready card, shown by
// UpdateReadySummary whenever the Steam row is one of the failing rows, and
// Shell.OpenSteam opens Steam's window through steam://open/main
// (Downgrade.AskSteam, which falls back to steam.exe itself). The window's two
// second tick asks Checks.SteamStillRunning, a watch on steam.exe's handle the
// way GameStillRunning watches the game (#978), and redraws the rows when the
// answer differs from what the Steam row last said.
//
// What this checks:
//   A. MainWindow.axaml: BtnOpenSteam is on the Ready card, starts hidden,
//      and has a row of its own under the words.
//   B. Shell.cs: the button is found, pressing it runs OpenSteam, OpenSteam asks
//      Steam for steam://open/main, and UpdateReadySummary shows it only while
//      the Steam row fails.
//   C. Shell.cs: DrawStatus records what the Steam row said, and the tick
//      redraws when Steam's answer differs from it, only while not playing.
//   D. Checks.cs: the Steam row is named by SteamRow, and SteamStillRunning is
//      a Watched over steam.exe.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const REPO_DIR = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
const checksCs = read('launcher/app/Checks.cs');
const shellCs = read('launcher/app/Shell.cs');
const xaml = read('launcher/app/MainWindow.axaml');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

// The member that starts with head, through its closing brace.
function lift(text, head) {
  const a = text.indexOf(head);
  if (a < 0) return null;
  let i = text.indexOf('{', a);
  let depth = 0;
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) break; }
  }
  return text.slice(text.lastIndexOf('\n', a) + 1, i + 1);
}

// ============================================== A. the button on the card
const cardAt = xaml.indexOf('x:Name="DotReady"');
const cardEnd = xaml.indexOf('</Grid>', cardAt);
const card = cardAt >= 0 && cardEnd > cardAt ? xaml.slice(xaml.lastIndexOf('<Grid>', cardAt), cardEnd) : '';
yes('the window has the Ready card', card.length > 0);
const btn = (/<Button x:Name="BtnOpenSteam"[^>]*\/>/.exec(card) || [''])[0];
yes('the Ready card has the Open Steam button', btn.length > 0);
yes('it says "Open Steam"', btn.includes('Content="Open Steam"'));
yes('it starts hidden, so it shows only when Shell says Steam is not running', btn.includes('IsVisible="False"'));
yes('it sits on a row of its own under the words', btn.includes('Grid.Row="1"') && /<RowDefinition Height="Auto"\/>\s*<RowDefinition Height="Auto"\/>/.test(card));

// ============================================== B. pressing it opens Steam
yes('Shell finds the button', shellCs.includes('btnOpenSteam = win.BtnOpenSteam;'));
yes('pressing it runs OpenSteam', shellCs.includes('btnOpenSteam.Click += delegate { OpenSteam(); };'));
const open = lift(shellCs, 'static void OpenSteam()');
yes('Shell has OpenSteam', !!open);
yes('OpenSteam opens Steam\'s window through its link, falling back to steam.exe (Downgrade.AskSteam)',
    !!open && open.includes('Downgrade.AskSteam("steam://open/main", Log)'));
yes('and says what happened either way', !!open && (open.match(/Log\("/g) || []).length === 2);
const summary = lift(shellCs, 'static void UpdateReadySummary(List<Check> blocking)');
yes('UpdateReadySummary shows the button while the Steam row is one of the failing rows',
    !!summary && /foreach \(Check c in blocking\) if \(c\.Name == Checks\.SteamRow\) steamDown = true;/.test(summary) &&
    /bool want = steamDown;\s*if \(btnOpenSteam\.IsVisible != want\) btnOpenSteam\.IsVisible = want;/.test(summary));

// ============================================== C. Steam starting or closing redraws
const draw = lift(shellCs, 'static bool DrawStatus()');
yes('DrawStatus records what the Steam row said', !!draw && draw.includes('if (c.Name == Checks.SteamRow) steamShown = c.Ok;'));
yes('Shell keeps it in steamShown', /static bool steamShown;/.test(shellCs));
const tick = (function () {
  const a = shellCs.indexOf('timer.Tick += delegate');
  return a < 0 ? '' : shellCs.slice(a, shellCs.indexOf('if (Checks.GameStillRunning())', a));
})();
// Other idle work may follow the Steam line before the return, such as the
// look at Vortex for a finished collection update (#5136).
yes('the two second tick redraws the rows when Steam\'s answer differs from what they say, while not playing',
    /if \(!playing\)\s*\{\s*if \(Checks\.SteamStillRunning\(\) != steamShown\) DrawStatus\(\);[^{}]*?return;\s*\}/.test(tick));

// ============================================== D. Checks
const all = lift(checksCs, 'public static List<Check> All(Config cfg)');
yes('the Steam row is named by Checks.SteamRow', !!all && all.includes('new Check(SteamRow, steam,'));
yes('SteamRow is "Steam"', /public const string SteamRow = "Steam";/.test(checksCs));
const still = lift(checksCs, 'public static bool SteamStillRunning()');
yes('SteamStillRunning asks the watch', !!still && still.includes('return steamUp.Any();'));
yes('the watch is a Watched over steam.exe, which asks the kept handle before listing again',
    /static readonly Watched<Process> steamUp = new Watched<Process>\(\s*SteamProcesses,/.test(checksCs) &&
    /try \{ return !p\.HasExited; \}/.test(lift(checksCs, 'static readonly Watched<Process> steamUp') || ''));
const procs = lift(checksCs, 'static List<Process> SteamProcesses()');
yes('SteamProcesses lists steam.exe', !!procs && procs.includes('Process.GetProcessesByName("steam")'));

done();
