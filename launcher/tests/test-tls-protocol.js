// test-tls-protocol.js
//
// Nothing turns TLS 1.2 on by taking everything else off.
//
// WHY THIS EXISTS. Issue #1360. ServicePointManager.SecurityProtocol is one
// setting for the whole process, so the launcher, the setup program and every
// script share it. Written as
//
//     ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
//
// it does not add TLS 1.2, it replaces whatever was there with TLS 1.2 alone,
// and the next call this process makes can no longer offer TLS 1.3 even where
// the other end would have taken it. Updater.cs did that twice, Discord.cs
// twice, Sync.cs twice, Bootstrap.cs twice, Gallery.cs and Shell.cs once each,
// while Voice.cs and the other half of Shell.cs already wrote |=, so the
// protocol the launcher ended up using depended on which of them ran last.
//
// The rule: an assignment to SecurityProtocol either uses |= (C#), or reads
// SecurityProtocol on the right as well, which is how PowerShell adds a
// protocol: `= [Net.ServicePointManager]::SecurityProtocol -bor ...`. An
// assignment that names only the protocols it wants is what this fails on.
//
// SINCE .NET 10 (#4823). The C# in the repository (the launcher, the
// installer, tools\DeployAgent) runs on .NET 10, where HttpClient ignores
// ServicePointManager and offers whatever Windows allows, TLS 1.3 included.
// There the setting's default is SystemDefault, which is no bits at all, so
// even |= Tls12 turns it into TLS 1.2 alone for anything that still reads it.
// So no C# sets it any more, and the places #1360 named are held to that.
// The |= / -bor rule stays for PowerShell, which on Windows PowerShell 5.1
// still runs on the .NET Framework and its old default.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in launcher\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// Every assignment to SecurityProtocol in one file, each said to add to what
// is there or to replace it. A comparison (==) is not an assignment, and
// reading the setting into something else does not match at all, because the
// = has to follow the name.
function assignments(rel, text) {
  const out = [];
  const rx = /SecurityProtocol\s*(\|)?=(?!=)/g;
  const ps = /\.ps1$/i.test(rel);
  let m;
  while ((m = rx.exec(text)) !== null) {
    const line = text.slice(0, m.index).split('\n').length;
    if (m[1]) { out.push({ rel: rel, line: line, adds: true }); continue; }
    let rhs;
    if (ps) {
      // PowerShell has no |=, and an assignment whose right side is empty
      // carries on over the line break, as Publish-VirusTotal.ps1 writes it.
      const rest = text.slice(rx.lastIndex);
      const brk = rest.indexOf('\n');
      rhs = brk < 0 ? rest : rest.slice(0, brk);
      if (!rhs.trim()) {
        const after = rest.slice(brk + 1);
        const next = after.indexOf('\n');
        rhs = next < 0 ? after : after.slice(0, next);
      }
    } else {
      const rest = text.slice(rx.lastIndex);
      const end = rest.indexOf(';');
      rhs = end < 0 ? rest.split('\n')[0] : rest.slice(0, end);
    }
    // SecurityProtocolType names the protocol and is not the setting, so the
    // right side has to read SecurityProtocol itself to count as adding.
    out.push({ rel: rel, line: line, adds: /SecurityProtocol(?!Type)/.test(rhs), text: rhs.trim() });
  }
  return out;
}

let files = [];
try {
  files = execSync('git ls-files -z -- "*.cs" "*.ps1"', { cwd: REPO_DIR, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
} catch (e) {
  console.log('SKIP  git ls-files did not answer, so there is nothing to read: ' + e.message);
  process.exit(0);
}

const found = [];
files.forEach(function (rel) {
  let text = '';
  try { text = fs.readFileSync(path.join(REPO_DIR, rel), 'utf8'); } catch (e) { return; }
  if (text.indexOf('SecurityProtocol') < 0) return;
  assignments(rel, text).forEach(function (a) { found.push(a); });
});

yes('there are SecurityProtocol assignments to read, ' + found.length + ' of them', found.length > 20);

const inCs = found.filter(function (a) { return /\.cs$/i.test(a.rel); });
inCs.forEach(function (a) { console.log('      ' + a.rel + ':' + a.line + '  ' + (a.text || '|=')); });
yes('no C# sets SecurityProtocol: on .NET 10 HttpClient takes what Windows offers', inCs.length === 0);

const replaces = found.filter(function (a) { return !a.adds; });
replaces.forEach(function (a) { console.log('      ' + a.rel + ':' + a.line + '  ' + a.text); });
yes('every one of them adds TLS 1.2 and takes nothing away', replaces.length === 0);

// The places issue #1360 named, by file, so a rewrite that puts the setting
// back is caught where it was found. The setup program, Bootstrap.cs, was
// one; it retired in #4824.
['launcher/app/Updater.cs', 'launcher/app/Discord.cs', 'launcher/app/Shell.cs',
 'launcher/app/Gallery.cs', 'launcher/app/Sync.cs'].forEach(function (rel) {
  let text = null;
  try { text = fs.readFileSync(path.join(REPO_DIR, rel), 'utf8'); } catch (e) { text = null; }
  yes(rel + ' is there and sets no SecurityProtocol of its own',
    text !== null && assignments(rel, text).length === 0);
});

// The rule itself, against text that is not in the repository, so a harness
// that has stopped reading anything cannot pass quietly.
const planted = [
  ['a C# assignment that replaces', 'X.cs', 'ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;', false],
  ['a C# assignment that casts the number', 'X.cs', 'ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072;', false],
  ['a C# |=', 'X.cs', 'ServicePointManager.SecurityProtocol |= SecurityProtocolType.Tls12;', true],
  ['a C# = that ors the current value', 'X.cs', 'ServicePointManager.SecurityProtocol = ServicePointManager.SecurityProtocol | SecurityProtocolType.Tls12;', true],
  ['a PowerShell assignment that replaces', 'X.ps1', '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12', false],
  ['a PowerShell -bor', 'X.ps1', '[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12', true],
  ['a PowerShell -bor carried over the line break', 'X.ps1', '[Net.ServicePointManager]::SecurityProtocol =\n    [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12', true]
];
planted.forEach(function (p) {
  const got = assignments(p[1], p[2]);
  yes('the rule reads ' + p[0] + ' as ' + (p[3] ? 'adding' : 'replacing'),
    got.length === 1 && got[0].adds === p[3]);
});
yes('the rule leaves a comparison and a read alone',
  assignments('X.cs', 'if (ServicePointManager.SecurityProtocol == want) { }').length === 0 &&
  assignments('X.ps1', '$was = [Net.ServicePointManager]::SecurityProtocol').length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
