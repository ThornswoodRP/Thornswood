// test-3565-report-words.js
//
//     node launcher\tests\test-3565-report-words.js
//
// The words under "One zip for Discord" on the Diagnostics page say every
// file in the support report and every part of its summary (#3565).
//
// The page used to say "Nothing personal beyond your Windows user name in
// file paths" in words written apart from Diag.Summary(), which also wrote the
// machine's name, the user name on a line of its own and the server's
// address, into a zip the page tells people to post to Discord. Nothing tied
// the two together, so they drifted.
//
// Now Diag.cs keeps two lists, InTheZip and InTheSummary, each part with the
// words the page says for it. Report() and Summary() name a part for every
// file and every line they write, and Held() throws for one the lists do not
// have; WhatTheReportHolds() makes the page's words from the same lists, and
// the page's TextBlock has no words of its own. This reads launcher\app and
// launcher\app\MainWindow.axaml and holds:
//   - every file Report() grabs and every key Summary() writes is in a list,
//     and every part in a list is written, so a field added without words
//     fails here (and throws at run time if it got past this);
//   - the page's words come from WhatTheReportHolds(), which says both lists;
//   - the machine's name, the user name line and the server's address are
//     not written, and the server is said as main or dev;
//   - the zips are kept to the number the words say, and the oldest go;
//   - what the words say the launcher log names (the Discord account, the
//     microphone) is what the launcher logs.
// The words themselves are printed at the end, as the page shows them.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'launcher', 'app');
const CR = String.fromCharCode(13);
const read = f => fs.readFileSync(path.join(APP, f), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The body of a C# member, from its declaration to its closing brace.
function member(src, decl) {
  const at = src.indexOf(decl);
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
  }
  return '';
}

function all(rx, src) { const out = []; let m; while ((m = rx.exec(src)) !== null) out.push(m); return out; }

const diag = read('Diag.cs');
const pages = read('Pages.cs');
const shell = read('Shell.cs');
const play = read('ShellPlay.cs');
const xaml = fs.readFileSync(path.join(REPO, 'launcher', 'app', 'MainWindow.axaml'), 'utf8').split(CR).join('');

// ---- the two lists ------------------------------------------------------------
function list(name) {
  const m = new RegExp('static readonly Part\\[\\] ' + name + ' =\\s*\\{([\\s\\S]*?)\\n\\s*\\};').exec(diag);
  if (!m) return null;
  return all(/new Part\("([^"]+)", "([^"]*)"\)/g, m[1]).map(p => ({ key: p[1], words: p[2] }));
}
const zipParts = list('InTheZip');
const sumParts = list('InTheSummary');
yes('Diag.cs keeps the list of files in the zip (InTheZip)', !!zipParts && zipParts.length > 0);
yes('Diag.cs keeps the list of parts of the summary (InTheSummary)', !!sumParts && sumParts.length > 0);
if (!zipParts || !sumParts) { console.log(''); console.log(pass + ' passed, ' + fail + ' failed'); process.exit(1); }
const zipKeys = zipParts.map(p => p.key), sumKeys = sumParts.map(p => p.key);

yes('every part in both lists has words', zipParts.concat(sumParts).every(p => p.words.trim().length > 0));
yes('no key is in a list twice',
    new Set(zipKeys).size === zipKeys.length && new Set(sumKeys).size === sumKeys.length);

const held = member(diag, 'static Part Held(Part[] list, string key)');
yes('Held throws for a part the lists do not name', /throw new InvalidOperationException\(/.test(held));

// ---- the zip --------------------------------------------------------------------
const report = member(diag, 'public static string Report(Config cfg, string launcherVersion)');
const grab = member(diag, 'static void Grab(string into, string part, string file, string rename)');
yes('Report() is in Diag.cs, and Grab names a part and checks it first',
    report.length > 0 && /^\s*\{\s*Held\(InTheZip, part\);/.test(grab.slice(grab.indexOf('{'))));
const grabbed = all(/Grab\(work, "([^"]+)"/g, report).map(m => m[1]);
const writes = all(/File\.(?:WriteAllText|Copy|AppendAllText)\(/g, report).length;
yes('the only file Report() writes into the zip besides what it grabs is summary.txt, and it is held first',
    writes === 1 && /Held\(InTheZip, "summary\.txt"\);\s*File\.WriteAllText\(Path\.Combine\(work, "summary\.txt"\)/.test(report));
grabbed.concat(['summary.txt']).forEach(function (k) {
  yes('the zip\'s ' + k + ' is in InTheZip', zipKeys.indexOf(k) >= 0);
});
zipKeys.forEach(function (k) {
  yes('InTheZip\'s ' + k + ' is put in the zip', grabbed.indexOf(k) >= 0 || k === 'summary.txt');
});
yes('every Grab in Report() names its part (no Grab without one)',
    all(/Grab\(work, /g, report).length === grabbed.length);

// ---- the summary ------------------------------------------------------------------
const summary = member(diag, 'static string Summary(Config cfg, string launcherVersion)');
yes('Summary() is in Diag.cs', summary.length > 0);
yes('Summary\'s Add and Section check their key before writing',
    /void Add\(string k, string v\) \{ Held\(InTheSummary, k\);/.test(summary) &&
    /void Section\(string k\) \{ Held\(InTheSummary, k\);/.test(summary));
const written = all(/(?:Add|Section)\("([^"]+)"|Held\(InTheSummary, "([^"]+)"\)/g, summary).map(m => m[1] || m[2]);
written.forEach(function (k) {
  yes('summary.txt\'s ' + k + ' is in InTheSummary', sumKeys.indexOf(k) >= 0);
});
sumKeys.forEach(function (k) {
  yes('InTheSummary\'s ' + k + ' is written by Summary()', written.indexOf(k) >= 0);
});
// A line written straight to the summary is a field that skipped the list.
// The ones allowed: the title, blank lines, the date (held as "built"), and
// the lines inside the two sections (each problem, each plugin, its folder).
const raw = all(/s\.AppendLine\(([^;]*)\);/g, summary).map(m => m[1].trim());
const allowed = ['', '"ThornsWood - report"', '"==================="', 'DateTime.Now.ToString("dddd d MMMM yyyy, HH:mm")',
                 'k', 'new string(\'-\', k.Length)', 'k.PadRight(22) + v', '"none"',
                 '(i.Blocking ? "[blocking] " : "[note]     ") + i.Text', '"could not check: " + ex.Message',
                 '"in " + dir', 'Path.GetFileName(f)'];
const stray = raw.filter(r => allowed.indexOf(r) < 0);
yes('Summary() writes no line of its own outside Add and Section' + (stray.length ? ' (writes ' + stray.join(' | ') + ')' : ''),
    stray.length === 0);

// ---- what came out ------------------------------------------------------------------
yes('the report does not write the machine\'s name', !/MachineName/.test(diag));
yes('the report does not write the user name on a line of its own', !/Environment\.UserName/.test(diag));
yes('the report does not write the server\'s address, only main or dev and the port (no page shows it)',
    !/ServerAddress/.test(diag) && /Add\("server", \(cfg\.IsDev \? "dev" : "main"\) \+ ", port " \+ cfg\.ServerPort\);/.test(summary));
// The Server page, the one place that could show it, went with #3146.
yes('no launcher page shows the address, the rule the report now follows',
    !/ServerAddress|txtSrvAddress/.test(pages) && !/TxtSrvAddress/.test(xaml));

// ---- the page's words -------------------------------------------------------------------
const words = member(diag, 'public static string WhatTheReportHolds()');
yes('WhatTheReportHolds says both lists', /Said\(InTheZip\)/.test(words) && /Said\(InTheSummary\)/.test(words));
const box = /<TextBlock x:Name="TxtDiagHolds"[^>]*\/>/.exec(xaml);
yes('the Diagnostics page has the TxtDiagHolds line, with no words of its own', !!box && !/\bText="/.test(box[0]));
yes('the page is under "One zip for Discord"', /Text="One zip for Discord"\/>\s*(<!--[^>]*-->\s*)?<TextBlock x:Name="TxtDiagHolds"/.test(xaml));
yes('the old promise is gone from the page', xaml.indexOf('Nothing personal beyond your Windows user name') < 0);
yes('Pages.cs fills it from WhatTheReportHolds',
    /txtDiagHolds = win\.TxtDiagHolds;/.test(pages) && /txtDiagHolds\.Text = Diag\.WhatTheReportHolds\(\);/.test(pages));

// ---- keeping -------------------------------------------------------------------------------
const kept = /public const int KeptReports = (\d+);/.exec(diag);
const keep = member(diag, 'static void KeepNewest()');
yes('Diag keeps a number of reports (KeptReports)', !!kept && parseInt(kept[1], 10) > 0);
yes('KeepNewest deletes all but the newest KeptReports, oldest first by the name\'s date',
    /Directory\.GetFiles\(ReportDir, "thornswood-\*\.zip"\)/.test(keep) && /Array\.Sort\(made/.test(keep) &&
    /i < made\.Length - KeptReports/.test(keep) && /File\.Delete\(made\[i\]\)/.test(keep));
yes('Report() keeps the newest after it writes the zip, and its zip names carry the date in order',
    /ZipFile\.CreateFromDirectory\(work, zip, CompressionLevel\.Optimal, false\);\s*KeepNewest\(\);/.test(report) &&
    /"thornswood-" \+ stamp \+ "\.zip"/.test(report) && /DateTime\.Now\.ToString\("yyyyMMdd-HHmm"\)/.test(report));
yes('the words say how many are kept, from the same number', /"The " \+ KeptReports \+ " newest reports stay in Profile, Reports/.test(words));

// ---- what the launcher log names ---------------------------------------------------------------
yes('the words say the launcher log names the Discord account and the microphone',
    /the launcher log names the Discord account you linked/.test(words) && /the microphone the game used/.test(words));
yes('  and the launcher logs exactly those (Linked as, Microphone:)',
    /Log\("Linked as " \+/.test(shell) && /Log\("Microphone: " \+ mic\);/.test(play));

// ---- the words, as the page shows them ---------------------------------------------------------
function said(parts) {
  const w = [];
  parts.forEach(p => { if (w.indexOf(p.words) < 0) w.push(p.words); });
  return w.length === 1 ? w[0] : w.slice(0, -1).join(', ') + ' and ' + w[w.length - 1];
}
console.log('');
console.log('The page says: It holds ' + said(zipParts) + '. The summary says ' + said(sumParts) + '. ...');

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
