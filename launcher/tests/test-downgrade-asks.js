/*
  test-downgrade-asks.js

  The Downgrade button asks before it takes over Steam's window.

  WHY THIS EXISTS. Downgrade.Start opens Steam's console, brings Steam's
  window to the front, clicks 72 pixels above its bottom edge, sends Ctrl+A
  and Backspace, types a download_depot line and presses Enter twice, once
  for each of three depots. Until 24 September the button went from the click
  straight to that, with no question of any kind: To Do List entry 273, "At
  minimum a Continue or Cancel dialog saying exactly what will be typed and
  that Steam's window will come to the front".

  The button cannot be pressed from here (the ops repo's CLAUDE.md forbids starting the
  launcher), so this reads the source and checks the shape that makes the
  question impossible to go around:

    - Downgrade.Start is called from one place in the launcher, RunDowngrade,
      and RunDowngrade is reached from one place, the button;
    - inside RunDowngrade a Yes or No question comes before Downgrade.Start
      and before the button changes, and anything but Yes returns;
    - the lines the question shows come from Downgrade.Commands(), and Run
      types the same strings, so the two cannot drift apart;
    - the words follow the house rules and match the card's own size.

  Read only. It reads launcher\app\*.cs and launcher\app\MainWindow.axaml and
  nothing else.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');

const APP = path.join(REPO_DIR, 'launcher', 'app');
const SHELL = fs.readFileSync(path.join(APP, 'Shell.cs'), 'utf8');
const DOWN = fs.readFileSync(path.join(APP, 'Downgrade.cs'), 'utf8');
const XAML = fs.readFileSync(path.join(APP, 'MainWindow.axaml'), 'utf8');

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

/* Every C# string literal in a piece of source, joined, with \n unescaped. */
function literals(src) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"'));
  return out.join('');
}

// ---- one way in --------------------------------------------------------------
const csFiles = fs.readdirSync(APP).filter(f => f.endsWith('.cs'));
let starts = 0, startWhere = [];
const runsIn = {};
for (const f of csFiles) {
  const src = fs.readFileSync(path.join(APP, f), 'utf8');
  const s = (src.match(/\bDowngrade\.Start\(/g) || []).length;
  if (s) { starts += s; startWhere.push(f); }
  const r = (src.match(/\bRunDowngrade\(\)/g) || []).length;
  if (r) runsIn[f] = r;
}
yes('Downgrade.Start is called from exactly one place in the launcher', starts === 1);
yes('and that place is Shell.cs', startWhere.length === 1 && startWhere[0] === 'Shell.cs');
// In Shell.cs the definition plus the button's Click handler. Since #2627
// Fix on Diagnostics also starts it when Scan found the Skyrim build wrong,
// through the same RunDowngrade, so the question still comes first; nothing
// else reaches it.
const elsewhere = Object.keys(runsIn).filter(f => f !== 'Shell.cs' && f !== 'ShellScanFix.cs');
yes('RunDowngrade is reached from the button and from Fix only, and both go through its question',
    runsIn['Shell.cs'] === 2 && /btnDowngrade\.Click \+= delegate \{ RunDowngrade\(\); \};/.test(SHELL) &&
    elsewhere.length === 0 && (runsIn['ShellScanFix.cs'] || 0) > 0);

// ---- the question comes first ------------------------------------------------
const run = body(SHELL, 'static void RunDowngrade()');
yes('RunDowngrade is found in Shell.cs', run.length > 0);
const iStart = run.indexOf('Downgrade.Start(');
const iAsk = run.indexOf('Ask.YesNo(');
const iDisable = run.indexOf('btnDowngrade.IsEnabled = false');
yes('RunDowngrade still starts the downgrade', iStart > 0);
yes('RunDowngrade asks a question', iAsk > 0);
yes('the question comes before Downgrade.Start', iAsk > 0 && iAsk < iStart);
yes('the question comes before the button changes to Working', iAsk > 0 && iDisable > 0 && iAsk < iDisable);
const ask = iAsk > 0 ? run.slice(iAsk, run.indexOf(';', run.indexOf('Ask.Icon', iAsk)) + 1) : '';
yes('the question is Yes or No', /^Ask\.YesNo\(/.test(ask));
const afterAsk = iAsk > 0 ? run.slice(iAsk + ask.length, iStart) : '';
yes('anything but Yes returns before the downgrade starts',
    /bool r = Ask\.YesNo\(/.test(run) && /if \(!r\) \{[^}]*\breturn;\s*\}/.test(afterAsk));
yes('saying No leaves a line in the log', /if \(!r\) \{ Log\("[^"]+"\); return; \}/.test(afterAsk));
// Nothing between the answer and the start may throw the answer away: no
// second return path that skips the question, no goto, no early Start.
yes('only one question stands in front of the start', (run.match(/Ask\.(YesNo|OkCancel|YesNoCancel|Tell)\(/g) || []).length === 1);

// ---- what it shows is what is typed ----------------------------------------
yes('the question lists the lines from Downgrade.Commands(cfg)', /Downgrade\.Commands\(cfg\)/.test(ask));
yes('Downgrade.Commands is public so the button can read it',
    /public static string\[\] Commands\(Config cfg\)/.test(DOWN));
const commandsBody = body(DOWN, 'public static string[] Commands(Config cfg)');
// Since #471 the depots come from the feed when it has sent them, so the
// question and the run both take them from PinnedDepots(cfg).
yes('Commands builds every line through Command, from the pinned depots',
    /string\[\]\[\] depots = PinnedDepots\(cfg\);/.test(commandsBody) && /all\[i\] = Command\(depots\[i\]\);/.test(commandsBody));
const runBody = body(DOWN, 'static bool Run(Config cfg');
yes('Run takes the same pinned depots the question showed',
    /Depots = PinnedDepots\(cfg\);/.test(runBody) && runBody.indexOf('Depots = PinnedDepots(cfg);') < runBody.indexOf('for (int i = 0; i < Depots.Length; i++)'));
yes('Run types the line Command builds, the same one the question showed',
    /string cmd = Command\(Depots\[i\]\);/.test(runBody) && /TypeIntoConsole\(cmd, log\)/.test(runBody));
yes('Run no longer builds the line by hand anywhere else',
    !/"download_depot " \+/.test(runBody));

// Rebuild the three lines from the source, the way Command does, and check
// they are the three lines a person would expect to see.
const appId = (DOWN.match(/const int AppId = (\d+);/) || [])[1];
const depots = [];
const depotBlock = (DOWN.match(/static readonly string\[\]\[\] FallbackDepots = \{([\s\S]*?)\};/) || [])[1] || '';
depotBlock.replace(/new\[\] \{ "(\d+)", "(\d+)" \}/g, (_, d, m) => { depots.push([d, m]); return ''; });
const commandShape = /return "download_depot " \+ AppId \+ " " \+ depot\[0\] \+ " " \+ depot\[1\];/.test(DOWN);
yes('Command writes download_depot, the app, the depot and the manifest in that order', commandShape);
const lines = depots.map(d => 'download_depot ' + appId + ' ' + d[0] + ' ' + d[1]);
yes('there are three depots, so three lines', lines.length === 3);
yes('every line is download_depot 489830 <depot> <manifest>',
    lines.length === 3 && lines.every(l => /^download_depot 489830 4898(31|32|33) \d{15,20}$/.test(l)));
yes('the first line is the 1.6.1170 manifest for depot 489831',
    lines[0] === 'download_depot 489830 489831 8442952117333549665');

// ---- the words --------------------------------------------------------------
const words = literals(ask);
yes('it asks about the downgrade by name', /Downgrade Skyrim to 1\.6\.1170\?/.test(words));
yes("it says Steam's window comes to the front", /Steam's window comes to the front/.test(words));
yes("it says the launcher types into Steam's console", /console/.test(words) && /types/.test(words));
yes('it says the command line is clicked', /clicks the console's command line/.test(words));
yes('it says there are three lines, one at a time', /three lines/.test(words) && /one at a time/.test(words));
yes('it tells the person not to type or click meanwhile', /Do not type or click/.test(words));
yes('it says the download is under their own account', /under your own account/.test(words));
const cardGb = (XAML.match(/About (\d+) GB, and Steam has to be signed in/) || [])[1];
const askGb = (words.match(/about (\d+) GB/) || [])[1];
yes('the size it names matches the card above the button', cardGb && askGb && cardGb === askGb);
yes('the title is Thornswood, like every other question here', /"Thornswood", Ask\.Icon\.Question\);$/.test(ask));
yes('no "player" in the words', !/player/i.test(words));
yes('no em or en dash in the words', !/[–—]/.test(words));
const noLine = (afterAsk.match(/Log\("([^"]+)"\)/) || [])[1] || '';
yes('the log line for No is plain words too', noLine.length > 0 && !/player/i.test(noLine) && !/[–—]/.test(noLine));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
