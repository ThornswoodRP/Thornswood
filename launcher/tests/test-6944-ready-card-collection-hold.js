// test-6944-ready-card-collection-hold.js
//
//     node .\launcher\tests\test-6944-ready-card-collection-hold.js
//
// While Play is held for the mods, the Ready card says so, and launcher.log
// says once why Play is held and when that ends (#6944).
//
// WHAT HAPPENED. On One, 26 Nov 2026, launcher 1.3.125 on dev, Play said
// UPDATE THE MODS FIRST because the server is on collection revision 12 and
// Vortex had 11. The Ready card on the Play page said "Everything checks out",
// and launcher.log had no line saying Play was held, so the log alone could not
// explain a 15 minute wait for Play.
//
// THE CAUSE. The Ready card is built only from the Checks rows, and the Mods
// row never compared the collection revision Vortex installed with the
// server's. That comparison lived only in Shell.CollectionProblem, which drives
// the collection card and the Play button, so a held Play sat beside a green
// Mods row and "Everything checks out". Nothing wrote to launcher.log when the
// hold started or ended either: the only line was VortexChanged's, and only
// when Vortex's files changed.
//
// THE FIX. The comparison is Checks.RevisionProblem, made by the Mods row and
// by Shell.CollectionProblem alike. DrawStatus reads the revision once, before
// the rows, and hands it to Checks.All, so the row and the card judge the same
// reading. SayCollectionHold writes one line when the hold starts, one when
// either revision moves while it holds, and one when it ends.
//
// What this checks:
//   A. Checks.cs and Shell.cs are wired that way: Checks.All takes the
//      reading, DrawStatus reads it before the rows and hands it in, one
//      comparison serves both, and DrawStatus says the hold after the card.
//   B. The Mods row and the Ready card words, lifted out of the shipped files
//      and built the way the launcher builds (tests/launcher-csc.js): behind,
//      ahead, level, unreadable, not installed, and no server revision yet.
//   C. SayCollectionHold, lifted with CollectionProblem, CollectionWait and
//      CollectionKey and run across a sequence of draws: a line at the start,
//      none while nothing changes, one when the revision moves, one at the
//      end, and no extra read of Vortex's state for any of it.
//
// B and C run on Linux too. Read only. The builds go under out/harness/,
// which git ignores.
'use strict';
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const REPO_DIR = path.join(__dirname, '..', '..');
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
const checksCs = read('launcher/app/Checks.cs');
const shellCs = read('launcher/app/Shell.cs');
const watchCs = read('launcher/app/ShellVortexWatch.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
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

// ============================================== A. the wiring
const all = lift(checksCs, 'public static List<Check> All(Config cfg, int collectionRevision = -1)');
yes('Checks.All takes the revision the caller read', !!all);
yes('and the Mods row is made with it', !!all && all.includes('l.Add(ModsRow(plugins, issues, mine));'));
yes('Checks.All reads the revision itself only when none was handed in',
    !!all && all.includes('mine = collectionRevision < 0 ? CollectionRevision(cfg) : collectionRevision;'));
const modsRow = lift(checksCs, 'static Check ModsRow(int plugins, List<Issue> issues, int mine)');
yes('the Mods row asks the shared comparison', !!modsRow && modsRow.includes('RevisionProblem(mine, wants)'));
const draw = lift(shellCs, 'static bool DrawStatus()');
const readAt = draw ? draw.indexOf('int collectionRevision = ') : -1;
const rowsAt = draw ? draw.indexOf('List<Check> checks = Checks.All(cfg, collectionRevision);') : -1;
yes('DrawStatus reads the revision before the rows and hands it to them', readAt >= 0 && rowsAt > readAt);
yes('and still reads it once a draw', !!draw && (draw.match(/Checks\.CollectionRevision\(cfg\)/g) || []).length === 1);
const barAt = draw ? draw.indexOf('ShowCollectionBar(collectionRevision);') : -1;
const sayAt = draw ? draw.indexOf('SayCollectionHold(collectionRevision);') : -1;
yes('DrawStatus says the hold after the card is up or down', barAt >= 0 && sayAt > barAt);
const problem = lift(shellCs, 'static string CollectionProblem(int revision = -1)');
yes('Shell.CollectionProblem asks the same comparison the Mods row does',
    !!problem && problem.includes('return Checks.RevisionProblem(mine, Updater.ServerCollectionRevision);') &&
    !/mine < wants/.test(problem));
const changed = lift(watchCs, 'static void VortexChanged(int revision, string problem)');
yes('VortexChanged no longer writes its own line while the card stays up, which SayCollectionHold now writes',
    !!changed && !changed.includes('LogOnly('));

// ============================================== B. the Mods row and the card
const checkClass = lift(checksCs, '    class Check\n');
const parts = [lift(checksCs, 'public static string RevisionProblem(int mine, int wants)'), modsRow,
               lift(checksCs, 'static string MissingDetail(List<string> missing)')];
const words = ['static string ReadyTitle(List<Check> blocking)', 'static string ProblemWords(Check c)']
  .map(function (h) { return lift(shellCs, h); });
yes('the row, the comparison and the card words can be lifted out', !!checkClass && parts.every(Boolean) && words.every(Boolean));
const lc = require('../../tests/launcher-csc');
yes('the .NET SDK the launcher builds with is on this machine', !!lc.dotnet);

function runProg(prog) {
  try {
    const r = lc.run(lc.build({ sources: [prog], exe: true }));
    return r.status === 0 ? r.stdout.split(CR).join('') : 'ERROR exit ' + r.status + '\n' + r.stdout + r.stderr;
  } catch (e) { return 'ERROR ' + e.message; }
}

if (lc.dotnet && checkClass && parts.every(Boolean) && words.every(Boolean)) {
  const prog =
    'using System; using System.Collections.Generic;\n' +
    'class Issue { public bool FileMissing; public string Plugin, Text; }\n' +
    'static class Updater { public static int ServerCollectionRevision; }\n' +
    checkClass + '\n' +
    'static class Checks {\n public const int MostPluginsWithoutCollection = 40;\n' + parts.join('\n') + '\n' +
    ' public static Check Row(int plugins, int mine) { return ModsRow(plugins, new List<Issue>(), mine); }\n}\n' +
    'static class T {\n' + words.join('\n') + '\n' +
    ' static void Say(string name, Check c) {\n' +
    '  var blocking = new List<Check>(); if (c.Blocks) blocking.Add(c);\n' +
    '  Console.WriteLine(name + "=" + (c.Ok ? "ok" : "fail") + "|" + c.Detail + "|" + ReadyTitle(blocking));\n' +
    ' }\n' +
    ' static void Main() {\n' +
    '  Updater.ServerCollectionRevision = 12;\n' +
    '  Say("behind", Checks.Row(94, 11));\n' +
    '  Say("ahead", Checks.Row(94, 13));\n' +
    '  Say("level", Checks.Row(94, 12));\n' +
    '  Say("unread", Checks.Row(94, 0));\n' +
    '  Say("none", Checks.Row(30, 11));\n' +
    '  Updater.ServerCollectionRevision = 0;\n' +
    '  Say("noserver", Checks.Row(94, 11));\n' +
    ' }\n}\n';
  const out = runProg(prog);
  const has = function (line) { return out.split('\n').indexOf(line) >= 0; };
  yes('the lifted row builds the way the launcher does, and runs', !/ERROR/.test(out));
  yes('Vortex on 11, the server on 12: the Mods row fails and the card says "Mods need updating"',
      has("behind=fail|revision 11, the server's is 12|Mods need updating"));
  yes('Vortex on 13, the server on 12: the card says "Mods ahead of the server"',
      has("ahead=fail|revision 13, the server's is 12|Mods ahead of the server"));
  yes('the same revision as the server: green, and "Everything checks out"', has('level=ok|94 plugins|Everything checks out'));
  yes('a revision that cannot be read holds nothing, as Shell.CollectionProblem holds nothing', has('unread=ok|94 plugins|Everything checks out'));
  yes('not installed still says "Mods not installed", whatever the revision', has('none=fail|30 plugins|Mods not installed'));
  yes('no server revision known yet holds nothing', has('noserver=ok|94 plugins|Everything checks out'));
  if (/ERROR/.test(out)) console.log(out);
}

// ============================================== C. the log lines
const hold = ['static string CollectionProblem(int revision = -1)', 'static string[] CollectionWait(int revision = -1)',
              'static void SayCollectionHold(int revision)'].map(function (h) { return lift(shellCs, h); });
const key = lift(watchCs, 'static string CollectionKey(int revision, string problem)');
const revisionProblem = parts[0];
yes('SayCollectionHold, CollectionProblem, CollectionWait and CollectionKey can be lifted out', hold.every(Boolean) && !!key);
if (lc.dotnet && hold.every(Boolean) && key && revisionProblem) {
  const prog =
    'using System; using System.Collections.Generic;\n' +
    'class Config { public string CollectionUrl = "https://example/collections/7essxf"; }\n' +
    'static class Updater { public static int ServerCollectionRevision; }\n' +
    'static class Swallow { public static void Note(string tag, Exception ex) { throw ex; } }\n' +
    'static class Checks {\n public const int MostPluginsWithoutCollection = 40;\n public static int Reads, Plugins = 94;\n' +
    ' public static int EnabledPlugins() { return Plugins; }\n' +
    ' public static int CollectionRevision(Config c) { Reads++; return 0; }\n' + revisionProblem + '\n}\n' +
    'static class T {\n static Config cfg = new Config();\n static bool collectionBarUp;\n' +
    ' static string collectionHoldSaid = "";\n static List<string> lines = new List<string>();\n' +
    ' static void LogOnly(string m) { lines.Add(m); }\n' +
    key + '\n' + hold.join('\n') + '\n' +
    ' static void Draw(string name, bool up, int revision) {\n' +
    '  int before = lines.Count; collectionBarUp = up; SayCollectionHold(revision);\n' +
    '  Console.WriteLine(name + "=" + (lines.Count - before) + (lines.Count > before ? "|" + lines[lines.Count - 1] : ""));\n' +
    ' }\n' +
    ' static void Main() {\n' +
    '  Updater.ServerCollectionRevision = 12;\n' +
    '  Draw("fine", false, 12);\n' +
    '  Draw("held", true, 11);\n' +
    '  Draw("again", true, 11); Draw("again2", true, 11);\n' +
    '  Draw("moved", true, 10);\n' +
    '  Draw("ended", false, 12);\n' +
    '  Draw("after", false, 12);\n' +
    '  Draw("ahead", true, 13);\n' +
    '  Updater.ServerCollectionRevision = 13;\n' +
    '  Draw("rebuilt", false, 13);\n' +
    '  Updater.ServerCollectionRevision = 12; Checks.Plugins = 30;\n' +
    '  Draw("none", true, 0);\n' +
    '  Draw("build", false, 0);\n' +
    '  Console.WriteLine("reads=" + Checks.Reads);\n' +
    ' }\n}\n';
  const out = runProg(prog);
  const has = function (line) { return out.split('\n').indexOf(line) >= 0; };
  yes('the lifted log code builds the way the launcher does, and runs', !/ERROR/.test(out));
  yes('nothing held: no line', has('fine=0'));
  yes('the hold starts: one line saying why and what it waits for',
      has("held=1|The collection here is on revision 11 and the server's is 12. Play waits for the collection to be updated to revision 12."));
  yes('the same hold on the next draws: no more lines', has('again=0') && has('again2=0'));
  yes('Vortex moves while it holds: one line with the new revision',
      has("moved=1|The collection here is on revision 10 and the server's is 12. Play waits for the collection to be updated to revision 12."));
  yes('the hold ends: one line saying so',
      has('ended=1|Play no longer waits on the mods: the collection here is on revision 12, the one the server was built against.'));
  yes('and nothing after it', has('after=0'));
  yes('ahead of the server: says it waits for the server',
      has("ahead=1|The collection here is on revision 13, ahead of the server's 12. Play waits for the server to be rebuilt on revision 13."));
  yes('the server rebuilt on that revision: the hold ends',
      has('rebuilt=1|Play no longer waits on the mods: the collection here is on revision 13, the one the server was built against.'));
  yes('not installed: says it waits for the install', has('none=1|The collection is not installed yet. Play waits for it to be installed.'));
  yes('a hold that ends without a revision to name still says it ended', has('build=1|Play no longer waits on the mods.'));
  yes('none of it reads Vortex\'s state again: DrawStatus\'s one reading serves', has('reads=0'));
  if (/ERROR/.test(out)) console.log(out);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
