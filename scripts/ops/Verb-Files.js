// Every file of code a verb of the box runs, so that a change to any of them
// is held for Patrick the way a change to the verb's own script is (#6184).
//
// A verb of scripts/vps/gate/verbs.json (the deploy gate) or
// scripts/release/nexus-verbs.json (Nexus-Run) is one script of main, run
// with the box's or the Nexus key's rights. That script runs others: it
// dot-sources them, calls them, hands them to node or python, compiles C# in
// with Add-Type. Auto-merge (scripts/ops/Auto-Merge.js) and the Bots' merge
// (TWHermesAgents tw_git) hold a pull request that changes a verb's script or
// anything its 'reads' names, and they read only the lists. On 13 Nov 2026
// New-NexusRevision's nexus-collection.js and collection-permissions.js were
// in neither, so changes to both merged with no card (#6007, #5992). So each
// verb's 'reads' names every file it runs, this finds them, and
// tests/test-6184-verb-files.js fails when a list is behind.
//
// What counts as run. From the verb's script, and from every file found
// that way, a file of code (.ps1 .psm1 .psd1 .js .cjs .mjs .py .cs .sh .cmd
// .bat) of this repository that the file names as a path of its own:
//   - a string that is wholly that path ('Nexus.ps1', '..\mods\X.ps1',
//     'scripts/vps/Vps.ps1'), from the file's folder or the repository's;
//   - the parts of one Join-Path on a line ('..' 'release' 'X.ps1');
//   - a require('./x') of JavaScript (.js left off), an import of a Python
//     file beside it.
// A name in a comment, or inside a message (a string with words around the
// name), is not a path of its own and does not count.
// It is followed under scripts/ and tools/, where the box's own tooling is.
// The services' folders (game, site, bot, voice, launcher) hold what a verb
// puts on the box, not what it runs: they reach the box through a release,
// dev first. Their C# is the one exception: a .cs named anywhere counts,
// since a script compiles it in (LoadOrder.ps1's VortexProfileState.cs) or
// takes from it what the box trusts (Updater.cs's ExpectedSigner).
// It errs toward more: a file named only to be read (LauncherVersion.ps1
// hashes Build-Launcher.ps1) counts, and so does what that file names. A
// path built at run time from words that are not in the file (a name read
// from another file) is not seen; the harness holds what is written down.
//
//     node scripts/ops/Verb-Files.js           (says which lists are behind)
//     node scripts/ops/Verb-Files.js --write   (puts what each verb runs in its reads)
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const VERB_LISTS = ['scripts/vps/gate/verbs.json', 'scripts/release/nexus-verbs.json'];
const CODE = /\.(ps1|psm1|psd1|js|cjs|mjs|py|cs|sh|cmd|bat)$/i;
const FOLLOWED = ['scripts/', 'tools/'];
const WHOLE = /^[A-Za-z0-9_.\\/-]+\.(ps1|psm1|psd1|js|cjs|mjs|py|cs|sh|cmd|bat)$/i;
const PART = /^[A-Za-z0-9_.\\/-]+$/;

function kindOf(f) {
  const e = path.extname(f).toLowerCase();
  if (e === '.ps1' || e === '.psm1' || e === '.psd1') return 'ps';
  if (e === '.js' || e === '.cjs' || e === '.mjs' || e === '.cs') return 'c';
  if (e === '.py') return 'py';
  return null;
}

function lines(s) { let n = 0; for (let i = 0; i < s.length; i++) if (s[i] === '\n') n++; return n; }

// The strings of a file outside its comments, each with the line it starts
// on. 'ps' is PowerShell, 'c' JavaScript and C#, 'py' Python.
function strings(text, kind) {
  const out = [];
  const n = text.length;
  let i = 0, line = 1;
  const skipTo = (end) => { line += lines(text.slice(i, end)); i = end; };
  while (i < n) {
    const c = text[i];
    if (c === '\n') { line++; i++; continue; }
    if (kind === 'ps') {
      if (c === '<' && text[i + 1] === '#') { const e = text.indexOf('#>', i + 2); skipTo(e < 0 ? n : e + 2); continue; }
      if (c === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      if (c === '@' && (text[i + 1] === "'" || text[i + 1] === '"') && text[i + 2] === '\n') {
        const e = text.indexOf('\n' + text[i + 1] + '@', i + 3);
        out.push({ s: text.slice(i + 3, e < 0 ? n : e), line }); skipTo(e < 0 ? n : e + 3); continue;
      }
      if (c === "'" || c === '"') {
        const at = line; let j = i + 1, s = '';
        while (j < n) {
          if (c === '"' && text[j] === '`') { s += text[j + 1] || ''; j += 2; continue; }
          if (text[j] === c) { if (text[j + 1] === c) { s += c; j += 2; continue; } break; }
          if (text[j] === '\n') line++;
          s += text[j++];
        }
        out.push({ s, line: at }); i = j + 1; continue;
      }
      i++; continue;
    }
    if (kind === 'c') {
      if (c === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      if (c === '/' && text[i + 1] === '*') { const e = text.indexOf('*/', i + 2); skipTo(e < 0 ? n : e + 2); continue; }
      if (c === "'" || c === '"' || c === '`') {
        const at = line; let j = i + 1, s = '';
        while (j < n && text[j] !== c) {
          if (text[j] === '\\') { s += text[j + 1] || ''; j += 2; continue; }
          if (text[j] === '\n') { if (c !== '`') break; line++; }
          s += text[j++];
        }
        out.push({ s, line: at }); i = j + 1; continue;
      }
      i++; continue;
    }
    if (kind === 'py') {
      if (c === '#') { while (i < n && text[i] !== '\n') i++; continue; }
      if ((c === "'" || c === '"') && text.substr(i, 3) === c + c + c) {
        const e = text.indexOf(c + c + c, i + 3);
        out.push({ s: text.slice(i + 3, e < 0 ? n : e), line }); skipTo(e < 0 ? n : e + 3); continue;
      }
      if (c === "'" || c === '"') {
        let j = i + 1, s = '';
        while (j < n && text[j] !== c && text[j] !== '\n') { if (text[j] === '\\') { s += text[j + 1] || ''; j += 2; continue; } s += text[j++]; }
        out.push({ s, line }); i = j + 1; continue;
      }
      i++; continue;
    }
    i++;
  }
  return out;
}

// The files of `have` (a Set of repository paths, with /) that the file f,
// whose text is given, names as paths of its own, each with why.
function named(f, text, have) {
  const kind = kindOf(f);
  const out = new Map();
  if (!kind) return out;
  text = text.split('\r').join('');
  const dir = path.posix.dirname(f);
  const at = (p) => { p = path.posix.normalize(p); return have.has(p) && p !== f ? p : null; };
  const lits = strings(text, kind);
  for (let k = 0; k < lits.length; k++) {
    if (!WHOLE.test(lits[k].s)) continue;
    const t = lits[k].s.split('\\').join('/');
    let hit = at(path.posix.join(dir, t)) || at(t);
    for (let b = k - 1; !hit && b >= 0 && lits[b].line === lits[k].line && PART.test(lits[b].s); b--) {
      const j = lits.slice(b, k + 1).map((x) => x.s.split('\\').join('/')).join('/');
      hit = at(path.posix.join(dir, j)) || at(j);
    }
    if (hit && !out.has(hit)) out.set(hit, 'line ' + lits[k].line + ' names ' + lits[k].s);
  }
  // require('./x') and the like: a string of JavaScript that is wholly a
  // path from its own folder, with .js or /index.js left off.
  if (/\.(js|cjs|mjs)$/i.test(f)) {
    for (const l of lits) {
      if (!/^\.{1,2}\/[A-Za-z0-9_.\/-]+$/.test(l.s)) continue;
      for (const p of [l.s, l.s + '.js', l.s + '/index.js']) {
        const q = at(path.posix.join(dir, p));
        if (q) { if (!out.has(q)) out.set(q, 'line ' + l.line + ' names ' + l.s); break; }
      }
    }
  }
  if (kind === 'py') {
    const im = /^[ \t]*(?:from[ \t]+([A-Za-z_][A-Za-z0-9_.]*)[ \t]+import|import[ \t]+([A-Za-z_][A-Za-z0-9_., \t]*))/gm;
    let m;
    while ((m = im.exec(text))) {
      for (const mod of (m[1] || m[2]).split(',').map((s) => s.trim().split(/\s+/)[0])) {
        const q = at(path.posix.join(dir, mod.split('.').join('/') + '.py'));
        if (q && !out.has(q)) out.set(q, 'imports ' + mod);
      }
    }
  }
  for (const p of [...out.keys()]) {
    if (!CODE.test(p) || !(FOLLOWED.some((d) => p.indexOf(d) === 0) || /\.cs$/i.test(p))) out.delete(p);
  }
  return out;
}

// What one verb runs: from its script, every file named, and what each of
// those names, as a sorted list (its script left out), with why each is there.
function runs(script, read, have) {
  const seen = new Map([[script, null]]);
  const queue = [script];
  while (queue.length) {
    const f = queue.shift();
    let text;
    try { text = read(f); } catch (e) { continue; }
    for (const [p, why] of named(f, text, have)) {
      if (!seen.has(p)) { seen.set(p, f + ' ' + why); queue.push(p); }
    }
  }
  seen.delete(script);
  const files = [...seen.keys()].sort();
  return { files, why: seen };
}

function repoFiles(root) {
  return new Set(execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean));
}

function readList(root, list) {
  return JSON.parse(fs.readFileSync(path.join(root, list), 'utf8').split('\r').join(''));
}

// For every verb of both lists: what it runs, what its reads names now, and
// what is missing from its reads or named there though it runs no longer. A
// reads entry that is a folder or not a file of code (what a verb acts on,
// such as Grant-BoxKey's keys) is the list's own and is kept as it is.
function compare(root) {
  const have = repoFiles(root);
  const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  const out = [];
  for (const list of VERB_LISTS) {
    const verbs = readList(root, list).verbs || {};
    for (const name of Object.keys(verbs)) {
      const v = verbs[name];
      const r = runs(v.script, read, have);
      const reads = (v.reads || []).filter((x) => typeof x === 'string');
      const own = reads.filter((x) => x.slice(-1) === '/' || !CODE.test(x));
      const missing = r.files.filter((x) => reads.indexOf(x) < 0);
      const stale = reads.filter((x) => own.indexOf(x) < 0 && r.files.indexOf(x) < 0);
      out.push({ list, name, script: v.script, runs: r.files, why: r.why, reads, own, missing, stale, want: own.concat(r.files) });
    }
  }
  return out;
}

// The list's text with one verb's reads put in, or replaced, keeping the
// rest of the file as it is written. The array goes on the line after the
// verb's "script" line, one entry a line.
function putReads(text, name, entries) {
  const nl = text.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l === '    ' + JSON.stringify(name) + ': {');
  if (start < 0) throw new Error('the verb ' + name + ' is not where it was looked for');
  let end = start + 1;
  while (end < lines.length && !/^    \}/.test(lines[end])) end++;
  let from = -1, to = -1;
  for (let i = start + 1; i < end; i++) {
    if (/^      "reads": /.test(lines[i])) {
      from = i; to = i;
      if (!/\],?\s*$/.test(lines[i])) { while (to < end && !/^      \],?\s*$/.test(lines[to])) to++; }
      break;
    }
  }
  const block = entries.length === 0 ? [] : (['      "reads": ['].concat(entries.map((e, i) => '        ' + JSON.stringify(e) + (i < entries.length - 1 ? ',' : '')), ['      ],']));
  if (from >= 0) {
    lines.splice(from, to - from + 1, ...block);
  } else {
    let after = -1;
    for (let i = start + 1; i < end; i++) if (/^      "script": .*,\s*$/.test(lines[i])) after = i;
    if (after < 0) throw new Error('the verb ' + name + ' has no script line');
    lines.splice(after + 1, 0, ...block);
  }
  return lines.join(nl);
}

function write(root) {
  const rows = compare(root);
  const changed = [];
  for (const list of VERB_LISTS) {
    const file = path.join(root, list);
    let text = fs.readFileSync(file, 'utf8');
    for (const r of rows.filter((x) => x.list === list)) {
      if (r.missing.length === 0 && r.stale.length === 0) continue;
      text = putReads(text, r.name, r.want);
      changed.push(r.name);
    }
    JSON.parse(text);
    fs.writeFileSync(file, text);
  }
  return changed;
}

module.exports = { VERB_LISTS, CODE, strings, named, runs, compare, putReads, write };

if (require.main === module) {
  const root = path.join(__dirname, '..', '..');
  if (process.argv.indexOf('--write') >= 0) {
    const changed = write(root);
    console.log(changed.length ? 'Wrote the reads of ' + changed.length + ' verbs: ' + changed.join(', ') : 'Every verb\'s reads already names what it runs. Nothing was written.');
    process.exit(0);
  }
  let behind = 0;
  for (const r of compare(root)) {
    for (const m of r.missing) { behind++; console.log(r.name + ' runs ' + m + ' (' + r.why.get(m) + '), which its reads in ' + r.list + ' does not name.'); }
    for (const s of r.stale) { behind++; console.log(r.name + ' no longer runs ' + s + ', which its reads in ' + r.list + ' still names.'); }
  }
  if (behind) { console.log(behind + ' to put right: node scripts/ops/Verb-Files.js --write'); process.exit(1); }
  console.log('Every verb\'s reads names what it runs.');
}
