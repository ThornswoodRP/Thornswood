// test-3203-ready-words.js
//
//     node .\launcher\tests\test-3203-ready-words.js
//
// The Ready card on the launcher's Play page names the problem in a few words
// instead of only "Check Diagnostics" (#3203).
//
// WHAT HAPPENED. Patrick, 21 Oct 2026, 6:30 PM: "the ready thing where it says
// check diagnostics needs to say what is the problem in a few words". The card
// is UpdateReadySummary in Shell.cs, the one line summary of the Diagnostics
// checklist (#607). It knew how many rows failed and threw away which, so every
// failure read the same red "Check Diagnostics" and the only way to find out
// that Steam was closed was to open another page. The Steam row itself said
// "running" whether Steam was running or not (#3204), so even Diagnostics read
// "Steam  running" in red.
//
// THE FIX. Every row that can shut Play carries Check.Problem, its few words,
// set in Checks.cs where the row is made and the specifics are known. The card
// says the first failing row's words, in the order Diagnostics lists them, and
// how many more there are; hovering lists every one.
//
// What this checks:
//   A. Checks.cs: class Check has Problem, and every row that can block sets it
//      (a row that cannot fail, or an advisory one, is left alone).
//   B. Shell.cs: DrawStatus hands the failing rows to UpdateReadySummary, the
//      card says ReadyTitle's words, and "Check Diagnostics" is gone.
//   C. The Steam row says "not running" when it is not.
//   D. Class Check and the three word functions, lifted out of the shipped
//      files and built the way the launcher project builds (the .NET 10 SDK,
//      tests/launcher-csc.js), say the right words for none, one and several
//      failures. That runs on Linux too.
//
// Read only. The build goes under out/harness/, which git ignores.
'use strict';
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const REPO_DIR = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
const checksCs = read('launcher/app/Checks.cs');
const shellCs = read('launcher/app/Shell.cs');

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

// The member that starts with head, through its closing brace: from the start
// of its line to the brace that balances the first one after head.
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

// Every `new Check(...)` in text: its arguments, split at the top level, and
// what follows the closing parenthesis up to the end of the statement.
function rowsMade(text) {
  const out = [];
  const re = /new Check\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    let i = m.index + m[0].length, depth = 1, arg = '', args = [];
    for (; i < text.length && depth > 0; i++) {
      const ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') { depth--; if (depth === 0) break; }
      if (ch === ',' && depth === 1) { args.push(arg.trim()); arg = ''; } else arg += ch;
    }
    args.push(arg.trim());
    const end = text.indexOf(';', i);
    out.push({ args: args, after: text.slice(i + 1, end), at: text.slice(m.index, Math.min(end, m.index + 70)) });
  }
  return out;
}

// ============================================== A. every blocking row has words
const checkClass = lift(checksCs, '    class Check\n');
yes('Checks.cs has class Check', !!checkClass);
yes('class Check has Problem, the few words the Ready card says', !!checkClass && /public string Problem;/.test(checkClass));

const rows = rowsMade(checksCs);
yes('Checks.cs makes its rows with new Check(...) (found ' + rows.length + ')', rows.length >= 10);
for (const r of rows) {
  const canFail = r.args[1] !== 'true';
  const advisory = r.args.length === 4 && r.args[3] === 'true';
  if (!canFail || advisory) continue;
  yes('the ' + r.args[0] + ' row that can shut Play says its problem in a few words  [' + r.at.replace(/\s+/g, ' ') + ']',
      /\{\s*Problem\s*=/.test(r.after));
}
const all = lift(checksCs, 'public static List<Check> All(Config cfg)');
yes('Checks.All still has nine rows', !!all && (all.match(/l\.Add\(/g) || []).length === 9);
for (const w of ['"Wrong Skyrim build"', '"Skyrim not found"', '"Script Extender missing"', '"Multiplayer client missing"',
                 '"Another server\'s client found"', '"Steam not running"']) {
  yes('Checks.All says ' + w, !!all && all.includes(w));
}
yes('the Client row reads its words only when it fails, so the files are not read again on a good pass',
    !!all && /Problem = client \? null : ClientProblem\(\)/.test(all));
const clientProblem = lift(checksCs, 'static string ClientProblem()');
yes('ClientProblem tells missing files from files of another build',
    !!clientProblem && clientProblem.includes('"Client files missing"') && clientProblem.includes('"Client files not this build\'s"'));
const modsRow = lift(checksCs, 'static Check ModsRow(');
yes('the Mods row says how many are missing, or that the mods are not installed',
    !!modsRow && modsRow.includes('" mods missing"') && modsRow.includes('"1 mod missing"') && modsRow.includes('"Mods not installed"'));
const modListRow = lift(checksCs, 'static Check ModListRow(');
yes('the Mod list row says it does not match the server', !!modListRow && modListRow.includes('"Mod list does not match the server"'));

// ============================================== B. the card says the words
const draw = lift(shellCs, 'static bool DrawStatus()');
yes('DrawStatus keeps the failing rows, not just a count', !!draw && /if \(c\.Blocks\)\s*\{\s*all = false; blocking\.Add\(c\); \}/.test(draw));
yes('and hands them to UpdateReadySummary', !!draw && draw.includes('UpdateReadySummary(blocking);'));
const summary = lift(shellCs, 'static void UpdateReadySummary(List<Check> blocking)');
yes('UpdateReadySummary takes the failing rows', !!summary);
yes('the card\'s words come from ReadyTitle', !!summary && summary.includes('string title = ReadyTitle(blocking);'));
yes('hovering it lists every problem when there is more than one', !!summary && summary.includes('blocking.Count > 1 ? ReadyList(blocking) : null'));
const shellCode = shellCs.split('\n').filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
yes('"Check Diagnostics" is not said anywhere in the launcher\'s code any more', !shellCode.includes('"Check Diagnostics"'));
yes('the Diagnostics button beside the card still shows on a failure',
    !!summary && summary.includes('btnCheckDiagnostics.IsVisible = !all;'));

// ============================================== C. the Steam row
yes('the Steam row says "not running" when Steam is not running',
    !!all && /new Check\(SteamRow, steam, steam \? "running" : "not running"\)/.test(all));
yes('and asks once, so the dot and the words cannot disagree',
    !!all && (all.match(/SteamRunning\(\)/g) || []).length === 1);

// ============================================== D. the words, compiled and run
const parts = ['static string ReadyTitle(List<Check> blocking)', 'static string ReadyList(List<Check> blocking)',
               'static string ProblemWords(Check c)'].map(function (h) { return lift(shellCs, h); });
yes('Shell.cs has ReadyTitle, ReadyList and ProblemWords', parts.every(Boolean));
const lc = require('../../tests/launcher-csc');
yes('the .NET SDK the launcher builds with is on this machine', !!lc.dotnet);
if (lc.dotnet && checkClass && parts.every(Boolean)) {
  const prog =
    'using System; using System.Collections.Generic;\n' +
    checkClass + '\n' +
    'static class T {\n' + parts.join('\n') + '\n' +
    ' static Check Bad(string n, string p) { return new Check(n, false, "x") { Problem = p }; }\n' +
    ' static void Main() {\n' +
    '  Console.WriteLine("none=" + ReadyTitle(new List<Check>()));\n' +
    '  Console.WriteLine("one=" + ReadyTitle(new List<Check> { Bad("Steam", "Steam not running") }));\n' +
    '  var three = new List<Check> { Bad("Game build", "Wrong Skyrim build"), Bad("Mods", "3 mods missing"), Bad("Steam", "Steam not running") };\n' +
    '  Console.WriteLine("three=" + ReadyTitle(three));\n' +
    '  Console.WriteLine("list=" + ReadyList(three).Replace("\\n", "|"));\n' +
    '  Console.WriteLine("bare=" + ReadyTitle(new List<Check> { new Check("Later row", false, "found this") }));\n' +
    ' }\n}\n';
  let out = '';
  try {
    const r = lc.run(lc.build({ sources: [prog], exe: true }));
    out = r.status === 0 ? r.stdout.split(CR).join('') : 'ERROR exit ' + r.status + '\n' + r.stdout + r.stderr;
  } catch (e) { out = 'ERROR ' + e.message; }
  const has = function (line) { return out.split('\n').indexOf(line) >= 0; };
  yes('the lifted C# builds the way the launcher does, and runs', !/ERROR/.test(out));
  yes('nothing failing: "Everything checks out"', has('none=Everything checks out'));
  yes('one failing row: its words alone, "Steam not running"', has('one=Steam not running'));
  yes('three failing rows: the first and how many more, "Wrong Skyrim build and 2 more"', has('three=Wrong Skyrim build and 2 more'));
  yes('the hover lists all three, in order', has('list=Wrong Skyrim build|3 mods missing|Steam not running'));
  yes('a row without words still says which row and what it found', has('bare=Later row: found this'));
  if (/ERROR/.test(out)) console.log(out);
}

done();
