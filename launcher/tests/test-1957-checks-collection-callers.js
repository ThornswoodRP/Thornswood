// test-1957-checks-collection-callers.js
//
//     node .\launcher\tests\test-1957-checks-collection-callers.js
//
// Every collection reader in launcher\app\Checks.cs is called by the launcher
// (#1957). Four of them had no caller at all: CollectionNewest,
// CollectionState, CollectionModIds and CollectionInstalledFolder. Only the
// PowerShell half in scripts\mods\LoadOrder.ps1 runs, for Deploy-Gamemode,
// Check-ShipReady and Check-CollectionRules. #1902 (PR #1949) still had to
// keep the four in step with the PowerShell readers although nothing ran
// them, and a launcher check that nothing runs looks, to the next person who
// reads it, like a check the launcher makes. Patrick, 5 Oct: remove them.
//
// #1981: RemoveForeign, the old name kept as a wrapper of IsolateForeign,
// had no caller either. It is gone, and every method in Checks.cs whose name
// ends in Foreign is held to the same rule as the collection readers.
//
// What it checks:
//   1. each method in Checks.cs whose name starts with Collection, or ends
//      with Foreign (#1981), is reached
//      from code that runs: a call from another file in launcher\app, or from
//      a method in Checks.cs that is not a collection reader, or from a
//      collection reader that is itself reached. A reader called only by
//      another uncalled reader (CollectionModIds by CollectionInstalledFolder,
//      CollectionNewest by CollectionState) counts as uncalled;
//   2. every Checks.<Name> the scripts name is a method Checks.cs declares,
//      so a script's "same as Checks.X" never points at one that was removed;
//   3. every VortexProfileState method LoadOrder.ps1 calls is still declared,
//      because the shared reader's CollectionNewest and CollectionModIds are
//      the PowerShell half's and stay.
//
// Comments and strings are blanked before a name is looked for, so a
// Swallow.Note("Checks.CollectionNewest", ex) or a doc comment is not a call.
//
// CHECKS=<path> runs it against another copy of Checks.cs, which is how it
// was shown to fail on origin/main.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const APP = path.join(ROOT, 'launcher', 'app');
const CHECKS = process.env.CHECKS || path.join(APP, 'Checks.cs');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// C# with every comment and every string or char literal turned to spaces,
// same length, so positions still line up with the source.
function code(src) {
  const out = src.split('');
  let i = 0;
  const n = src.length;
  function blank(a, b) { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; }
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { let j = src.indexOf('\n', i); if (j < 0) j = n; blank(i, j); i = j; continue; }
    if (c === '/' && d === '*') { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; blank(i, j); i = j; continue; }
    if (c === '@' && d === '"') {
      let j = i + 2;
      while (j < n) { if (src[j] === '"') { if (src[j + 1] === '"') { j += 2; continue; } break; } j++; }
      blank(i, j + 1); i = j + 1; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== '\n') { if (src[j] === '\\') j++; j++; }
      blank(i, j + 1); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

// The methods a file declares, each with where its name is and where its body
// runs from and to.
function methods(text) {
  const found = [];
  const re = /\b(?:public|internal|private|protected)?\s*static\s+[\w<>\[\],. ]+?\s+(\w+)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1];
    const nameAt = m.index + m[0].lastIndexOf(name);
    // The body is the first { after the parameter list, unless a ; ends the
    // declaration first.
    let depth = 0, j = m.index + m[0].length - 1, open = -1;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') { depth--; if (depth === 0) break; }
    }
    for (j++; j < text.length; j++) {
      if (text[j] === '{') { open = j; break; }
      if (text[j] === ';' || text[j] === '=') break;
    }
    if (open < 0) continue;
    depth = 0;
    let close = open;
    for (; close < text.length; close++) {
      if (text[close] === '{') depth++;
      else if (text[close] === '}') { depth--; if (depth === 0) break; }
    }
    found.push({ name, nameAt, from: open, to: close });
  }
  return found;
}

const checksText = code(fs.readFileSync(CHECKS, 'utf8'));
const checksMethods = methods(checksText);
const declared = new Set(checksMethods.map(x => x.name));
const readers = [...declared].filter(x => /^Collection/.test(x) || /Foreign$/.test(x));
yes('Checks.cs declares collection readers to check (' + readers.join(', ') + ')', readers.length > 0);
yes('and still reads the installed revision the Play page and the update bar use (CollectionRevision)', declared.has('CollectionRevision'));
// #1981: the foreign-plugin check Verify runs is still there, and is checked below.('and still sets aside foreign plugins (IsolateForeign)', declared.has('IsolateForeign'));

// Who calls each reader. A call inside Checks.cs belongs to the method whose
// body holds it; a call from another file runs.
const others = fs.readdirSync(APP).filter(f => f.endsWith('.cs') && f !== 'Checks.cs');
const otherText = others.map(f => code(fs.readFileSync(path.join(APP, f), 'utf8'))).join('\n');

const callers = {};
for (const r of readers) {
  callers[r] = new Set();
  // From another file a static of Checks is called as Checks.<Name>; inside
  // Checks.cs bare, or as Checks.<Name>. VortexProfileState.CollectionNewest
  // is the shared reader's method of the same name, not a call of this one.
  if (new RegExp('\\bChecks\\.' + r + '\\b').test(otherText)) callers[r].add('*');
  const re = new RegExp('(?:\\bChecks\\.|(?<![\\w.]))' + r + '\\b', 'g');
  let m;
  while ((m = re.exec(checksText))) {
    const at = m.index + m[0].length - r.length;
    if (checksMethods.some(x => x.name === r && x.nameAt === at)) continue;
    const inside = checksMethods.filter(x => at > x.from && at < x.to)
      .sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
    callers[r].add(inside ? inside.name : '*');
  }
}
const reached = new Set();
let grew = true;
while (grew) {
  grew = false;
  for (const r of readers) {
    if (reached.has(r)) continue;
    for (const c of callers[r]) {
      if (c === '*' || (!/^Collection/.test(c)) || reached.has(c)) { reached.add(r); grew = true; break; }
    }
  }
}
for (const r of readers) {
  const by = [...callers[r]].map(c => c === '*' ? 'the launcher' : c);
  yes('Checks.' + r + ' is called by code the launcher runs' + (by.length ? ' (called by ' + by.join(', ') + ')' : ' (nothing calls it)'),
    reached.has(r));
}

// 2. What the scripts say about Checks.
function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.ps1$/i.test(e.name)) out.push(p);
  }
  return out;
}
const named = [];
for (const f of walk(path.join(ROOT, 'scripts'), [])) {
  const t = fs.readFileSync(f, 'utf8');
  const re = /\bChecks\.([A-Z]\w+)/g;
  let m;
  while ((m = re.exec(t))) named.push({ file: path.relative(ROOT, f), name: m[1] });
}
// A field counts as much as a method: Ship-Rules.ps1 names Checks.ForeignNames.
const missing = named.filter(x => !new RegExp('\\b' + x.name + '\\b').test(checksText));
yes('every Checks.<Name> a script names is still in Checks.cs' +
  (missing.length ? ' (' + missing.map(x => x.file + ' names Checks.' + x.name).join('; ') + ')' : ' (' + named.length + ' named)'),
  missing.length === 0);

// 3. The shared reader keeps what LoadOrder.ps1 calls.
const loadOrder = fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'LoadOrder.ps1'), 'utf8');
const vps = methods(code(fs.readFileSync(path.join(APP, 'VortexProfileState.cs'), 'utf8')));
const vpsNames = new Set(vps.map(x => x.name));
const calls = [...new Set((loadOrder.match(/\[Thornswood\.VortexProfileState\]::(\w+)/g) || []).map(s => s.split('::')[1]))];
yes('LoadOrder.ps1 calls the shared reader (' + calls.join(', ') + ')', calls.indexOf('CollectionNewest') >= 0 && calls.indexOf('CollectionModIds') >= 0);
for (const c of calls) yes('VortexProfileState.' + c + ', which LoadOrder.ps1 calls, is still declared', vpsNames.has(c));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
