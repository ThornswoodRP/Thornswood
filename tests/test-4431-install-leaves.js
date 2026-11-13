'use strict';
/*
  test-4431-install-leaves.js

      node tests/test-4431-install-leaves.js

  What an install leaves on the PC is one list, in installer\README.md
  (#4431). Nothing said what the setup and the launcher's first start put
  on a PC and what takes each back out, and launcher\app\ARCHITECTURE.md
  said the uninstall deletes only under the install folder, which the
  shortcuts, the Installed apps entry and the files in Skyrim's folder
  are not.

  It reads the code that writes, so a new write cannot go unlisted:
    1. Every write in the setup and first start code (the files in SETUP
       below): File.Write*, File.Append*, File.Copy, File.Move,
       Directory.CreateDirectory, Directory.Move, new StreamWriter, a
       registry CreateSubKey, a shortcut's Save, and the install's own
       CopyIfThere and CopyTree. For each, the method it is in, and every
       name its path is built from: the literals in its target, through
       the locals, foreach lists, constants and properties the target is
       made of.
    2. The list, the table under "## What an install leaves on the PC" in
       installer\README.md, names that method as Class.Method in its
       Written by column, and every one of those names somewhere in it.
    3. Every row has all four columns, and every Class.Method it names
       is a method in that code, so the list cannot name one that is gone.
    4. Every licence text InstallSteps.LicenceFiles puts in the install
       folder is named in it.
    5. ARCHITECTURE.md points at the list and no longer says the uninstall
       only ever deletes under Root.

  Red before #4431: there was no such list.
*/
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, ok, why) {
  if (ok) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? ' | ' + why : '')); }
}

// The setup (the install window and its steps) and what the launcher's
// first start writes before anybody presses anything: its Installed apps
// entry and its shortcuts.
const SETUP = [
  'launcher/app/InstallWindow.cs',
  'launcher/app/InstallSteps.cs',
  'launcher/app/InstallPlace.cs',
  'launcher/app/InstallAgreements.cs',
  'launcher/app/InstallShortcut.cs',
  'launcher/app/InstallSkyrim.cs',
  'launcher/app/Register.cs',
  'launcher/app/Icons.cs',
];

// ------------------------------------------------------------ reading C#

// The source with comments and the text of strings blanked to spaces, so
// brackets and keywords are found only in code. Positions are kept.
function codeOnly(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (c === '/' && d === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; out += ' '.repeat(end - i); i = end; continue; }
    if (c === '/' && d === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; out += src.slice(i, end).replace(/[^\n]/g, ' '); i = end; continue; }
    if (c === '@' && d === '"') {
      let j = i + 2;
      while (j < src.length) { if (src[j] === '"' && src[j + 1] === '"') { j += 2; continue; } if (src[j] === '"') break; j++; }
      out += '@"' + ' '.repeat(j - i - 2) + '"'; i = j + 1; continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') { if (src[j] === '\\') j++; j++; }
      out += '"' + ' '.repeat(j - i - 1) + '"'; i = j + 1; continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") { if (src[j] === '\\') j++; j++; }
      out += "'" + ' '.repeat(j - i - 1) + "'"; i = j + 1; continue;
    }
    out += c; i++;
  }
  return out;
}

// The string literals in a stretch of the real source, as C# reads them.
function literals(text) {
  const found = [];
  const re = /@"((?:[^"]|"")*)"|"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[1] !== undefined) found.push(m[1].replace(/""/g, '"'));
    else found.push(m[2].replace(/\\(.)/g, (x, y) => (y === 'n' ? '\n' : y === 'r' ? '\r' : y === 't' ? '\t' : y)));
  }
  return found;
}

// The index just after the bracket that closes the one at open.
function closing(code, open) {
  const pairs = { '(': ')', '{': '}', '[': ']' };
  const want = pairs[code[open]];
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === code[open]) depth++;
    else if (code[i] === want) { depth--; if (depth === 0) return i + 1; }
  }
  return code.length;
}

// A call's arguments, split at the commas of its own level.
function args(code, src, open) {
  const end = closing(code, open) - 1;
  const list = [];
  let depth = 0, from = open + 1;
  for (let i = open + 1; i < end; i++) {
    const c = code[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { list.push([from, i]); from = i + 1; }
  }
  if (end > from) list.push([from, end]);
  return list.map(([a, b]) => ({ code: code.slice(a, b), src: src.slice(a, b), at: a }));
}

const KEYWORDS = new Set(['if', 'for', 'foreach', 'while', 'switch', 'catch', 'using', 'lock', 'return', 'new', 'else', 'when', 'typeof', 'nameof', 'sizeof', 'fixed', 'checked', 'unchecked', 'get', 'set', 'delegate', 'base', 'this', 'default', 'throw']);

// Every method, constructor and property body in a file: its name, its
// class and where its body runs.
function members(code) {
  const list = [];
  const classes = [];
  const cre = /\b(?:class|struct)\s+(\w+)/g;
  let m;
  while ((m = cre.exec(code))) {
    const open = code.indexOf('{', m.index);
    if (open >= 0) classes.push({ name: m[1], from: open, to: closing(code, open) });
  }
  const classAt = (i) => {
    let best = null;
    for (const c of classes) if (i >= c.from && i < c.to && (!best || c.from > best.from)) best = c;
    return best ? best.name : '';
  };
  // A name, its parameters, and the body that follows: a method or a
  // constructor. Calls inside a body are skipped below by taking only
  // what sits directly in a class.
  const mre = /(\w+)\s*(<[^<>()]*>)?\s*\(/g;
  while ((m = mre.exec(code))) {
    const name = m[1];
    if (KEYWORDS.has(name)) continue;
    const open = code.indexOf('(', m.index + name.length);
    const shut = closing(code, open);
    const after = code.slice(shut).match(/^\s*(?::\s*(?:this|base)\s*\([^)]*\)\s*)?(?:where\s[^{;]*)?\{/);
    if (!after) continue;
    const body = shut + after[0].length - 1;
    const cls = classAt(m.index);
    if (!cls) continue;
    // Directly in its class: no other member's body around it.
    if (list.some((x) => m.index > x.from && m.index < x.to)) continue;
    list.push({ name, cls, from: body, to: closing(code, body) });
  }
  // Properties: Name { get { ... } }.
  const pre = /(\w+)\s*\{\s*get\s*\{/g;
  while ((m = pre.exec(code))) {
    if (KEYWORDS.has(m[1])) continue;
    const open = code.indexOf('{', m.index);
    list.push({ name: m[1], cls: classAt(m.index), from: open, to: closing(code, open), property: true });
  }
  return list;
}

// What one name stands for, as code: a local or foreach variable before at
// in the same body, a field or constant, or a property's body.
function meaning(file, name, at, body) {
  const { code, src } = file;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (body) {
    // The last assignment before at, inside the body.
    const are = new RegExp('(?:^|[^\\w.])' + esc + '\\s*=(?!=)', 'g');
    let m, last = null;
    const slice = code.slice(body.from, at);
    while ((m = are.exec(slice))) last = m;
    if (last) {
      const from = body.from + last.index + last[0].length;
      const end = code.indexOf(';', from);
      return { code: code.slice(from, end), src: src.slice(from, end), at: from };
    }
    const fre = new RegExp('foreach\\s*\\(\\s*[\\w<>\\[\\]]+\\s+' + esc + '\\s+in\\s+', 'g');
    let f = null;
    while ((m = fre.exec(slice))) f = m;
    if (f) {
      const from = body.from + f.index + f[0].length;
      const open = body.from + f.index + f[0].indexOf('(');
      const end = closing(code, open) - 1;
      return { code: code.slice(from, end), src: src.slice(from, end), at: from };
    }
  }
  // A field or constant: Type Name = ...;
  const kre = new RegExp('(?:const|static|readonly)[^;=()]*\\b' + esc + '\\s*=(?!=)');
  const k = kre.exec(code);
  if (k) {
    const from = k.index + k[0].length;
    const end = code.indexOf(';', from);
    return { code: code.slice(from, end), src: src.slice(from, end), at: from };
  }
  const p = file.members.find((x) => x.property && x.name === name);
  if (p) return { code: code.slice(p.from, p.to), src: src.slice(p.from, p.to), at: p.from };
  return null;
}

// The names a path expression is built from: its own literals and those
// of what it names, three steps deep. A format given to ToString is how a
// date is written, not a name, and a pattern with * in it is what is read.
function names(file, expr, body, depth, seen) {
  const out = new Set();
  const plain = expr.src.replace(/\.ToString\s*\([^()]*\)/g, '');
  for (const l of literals(plain)) {
    if (l.includes('*')) continue;
    if (l.replace(/[\\/\s.,:|-]/g, '').length < 2 && !/^\.\w+$/.test(l)) continue;
    out.add(l);
  }
  if (depth <= 0) return out;
  const idre = /(?<![\w."])([A-Za-z_]\w*)(?![\w"(])/g;
  let m;
  const plainCode = expr.code.replace(/\.ToString\s*\([^()]*\)/g, '');
  while ((m = idre.exec(plainCode))) {
    const id = m[1];
    if (KEYWORDS.has(id) || seen.has(id)) continue;
    const what = meaning(file, id, expr.at + m.index, body);
    if (!what) continue;
    seen.add(id);
    for (const n of names(file, what, body, depth - 1, seen)) out.add(n);
  }
  return out;
}

// ------------------------------------------------------------ the writes

// [a call, which of its arguments is where it writes]
const WRITES = [
  [/\bFile\.(?:WriteAllText|WriteAllLines|WriteAllBytes|AppendAllText|AppendAllLines|Create)\s*\(/g, 0],
  [/\bFile\.(?:Copy|Move|Replace)\s*\(/g, 1],
  [/\bDirectory\.CreateDirectory\s*\(/g, 0],
  [/\bDirectory\.Move\s*\(/g, 1],
  [/\bnew\s+StreamWriter\s*\(/g, 0],
  [/\bCreateSubKey\s*\(/g, 0],
  [/(?<![\w.])(?:CopyIfThere|CopyTree)\s*\(/g, 1],
  [/\bInstallShortcut\.Make\s*\(/g, 0],
  [/\.\s*Save\s*\(/g, 0],
];

// Helpers that write wherever they are told: the place is named where they
// are called, so their own bodies are not a place of their own.
const HELPERS = new Set(['InstallSteps.CopyIfThere', 'InstallSteps.CopyTree', 'InstallShortcut.Make', 'InstallShortcut.MakeHere', 'Link.Save']);

const writes = [];
const methods = new Set();
for (const rel of SETUP) {
  const src = read(rel);
  const code = codeOnly(src);
  const file = { rel, src, code };
  file.members = members(code);
  for (const x of file.members) if (!x.property) methods.add(x.cls + '.' + x.name);
  for (const [re, which] of WRITES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(code))) {
      const open = code.indexOf('(', m.index + m[0].length - 1);
      const a = args(code, src, open);
      if (!a.length) continue;
      const target = a[Math.min(which, a.length - 1)];
      // The method around it: the innermost body that holds it, so a
      // write in a property or a helper is named by that.
      let body = null;
      for (const x of file.members) if (m.index > x.from && m.index < x.to && (!body || x.from > body.from)) body = x;
      if (!body) continue;
      // The helpers' own bodies are where they write, not a new place: the
      // place is named where they are called.
      if (HELPERS.has(body.cls + '.' + body.name)) continue;
      const line = src.slice(0, m.index).split('\n').length;
      writes.push({
        where: rel + ':' + line,
        method: body.cls + '.' + body.name,
        names: [...names(file, target, body, 3, new Set())],
        call: src.slice(m.index, Math.min(closing(code, open), m.index + 120)).replace(/\s+/g, ' '),
      });
    }
  }
}

// ------------------------------------------------------------ the list

const readme = read('installer/README.md');
const head = readme.search(/^## What an install leaves on the PC\s*$/m);
yes('installer\\README.md has a section "What an install leaves on the PC"', head >= 0);
const section = head < 0 ? '' : readme.slice(head).split(/\n(?=## )/)[0];
const rows = section.split('\n').filter((l) => /^\|/.test(l) && !/^\|\s*-/.test(l)).slice(1)
  .map((l) => l.replace(/^\|/, '').replace(/\|\s*$/, '').split(/(?<!\\)\|/).map((c) => c.trim()));
const table = rows.map((r) => r.join(' | ')).join('\n');
yes('the section holds a table of what, where, which step writes it and what removes it', rows.length >= 8,
  rows.length + ' row(s)');

const short = rows.filter((r) => r.length !== 4 || r.some((c) => c.length === 0));
yes('every row says what, where, which step writes it and what removes it', head >= 0 && short.length === 0,
  short.map((r) => r.join(' | ')).slice(0, 5).join('; '));

// Written by: Class.Method in backticks, or Velopack's own setup.
const named = new Set();
const wrongNames = [];
for (const r of rows) {
  const by = r[2] || '';
  const refs = [...by.matchAll(/`([A-Z]\w*\.[A-Z]\w*)`/g)].map((m) => m[1]);
  for (const x of refs) { named.add(x); if (!methods.has(x)) wrongNames.push(x); }
  if (!refs.length && !/Velopack|older launcher|setup program/i.test(by)) wrongNames.push('(nothing named) ' + by);
}
yes('every Class.Method the list names is a method in the setup and first start code', head >= 0 && wrongNames.length === 0,
  wrongNames.slice(0, 8).join('; '));

yes('the setup and first start code has writes to check (' + writes.length + ' found)', writes.length >= 20);

const unnamed = writes.filter((w) => !named.has(w.method));
yes('every method that writes in the setup and first start code is in the list\'s Written by column', head >= 0 && unnamed.length === 0,
  [...new Set(unnamed.map((w) => w.method + ' (' + w.where + ')'))].slice(0, 12).join('; '));

const missing = [];
for (const w of writes) for (const n of w.names) if (!table.includes(n)) missing.push('"' + n + '" from ' + w.method + ' (' + w.where + ')');
yes('every name a write\'s path is built from is in the list', head >= 0 && missing.length === 0,
  [...new Set(missing)].slice(0, 12).join('; '));

// The licence texts the install copies by a list, not by a literal.
const steps = read('launcher/app/InstallSteps.cs');
const lic = steps.match(/LicenceFiles\s*=\s*\{([^}]*)\}/);
const licNames = lic ? literals(lic[1]) : [];
const licMissing = licNames.filter((n) => !table.includes(n));
yes('every licence text InstallSteps.LicenceFiles puts in the install folder is in the list (' + licNames.length + ')',
  licNames.length > 0 && head >= 0 && licMissing.length === 0, licMissing.join(', '));

// ------------------------------------------------------------ the architecture page

const arch = read('launcher/app/ARCHITECTURE.md');
yes('ARCHITECTURE.md no longer says the uninstall only ever deletes under Root',
  !/only ever deletes under Root/.test(arch));
yes('ARCHITECTURE.md points at the list in installer\\README.md',
  /installer\\README\.md[^\n]{0,80}\n?[^\n]{0,80}What an install leaves on the PC/.test(arch) ||
  /What an install leaves on the PC[^\n]{0,80}\n?[^\n]{0,80}installer\\README\.md/.test(arch));

if (process.argv.includes('--show')) for (const w of writes) console.log('      ' + w.method + '  ' + w.where + '  [' + w.names.join(', ') + ']  ' + w.call);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
