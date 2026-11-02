/*
  test-3029-builder-eol.js

  #3029. The repository had no .gitattributes, so a checkout with
  core.autocrlf true (One, the Windows runners) held the content builders'
  outputs with CRLF while every builder wrote LF. Each rebuild there rewrote
  the line endings of every output it wrote, changed or not: on 21 Oct
  Rebuild-ContentTables.ps1 listed 59 files on One where git diff showed 12.
  And game/data/merchant-role-tables.json, which pins its five inputs by
  sha256, pinned the CRLF bytes, so its --check failed on every LF checkout.
  Twenty builders had been taught to take the ending of the file they found
  instead (#1622, #1713, #1787, #1828); .gitattributes now gives every
  checkout LF, and the builders write LF.

  A  every text file a step of scripts/mods/content-tables.json writes is
     text eol=lf in .gitattributes, and a plugin it writes is not text.
  B  every tracked file under those writes is stored LF, with no CR at all
     (a lone CR made git take game/gamemode.js for binary, so autocrlf
     passed it by and nothing said so).
  C  and is checked out LF here, whatever core.autocrlf says: on a Windows
     runner this is the proof .gitattributes does what it says.
  D  every line of .gitattributes covers something a step writes, so the
     list cannot drift past the chain. The two other lines are
     records/client-licences/** -text: the vcpkg licence texts, held byte for
     byte by records/client-licences.json, whose line ends no checkout may
     turn (#3099), and records/front-licences/** -text, the same for the npm
     packages in build.js, held by records/front-build.json (#3751). And
     .githooks/** text eol=lf, the pre-push hook, which no step writes: sh
     reads it, Git for Windows' too, and a CR ends its lines wrong (#5291,
     held by tests/test-5291-pre-push.ps1).
  E  no step takes its line ending from a file, joins with CRLF, or writes
     with the platform's ending.
  F  merchant-role-tables.json pins the bytes every checkout now has.
  G  a VPS runner keeps its folder between jobs, and a checkout there leaves
     every file the two commits share as the last job wrote it, so the
     attributes above never reached a runner that already had the repository
     (measured 21 Oct: the job log says "Cleaning the repository", and a
     checkout made that way kept all 5,182 CRLF lines of hunts.json). Every
     self-hosted job writes every tracked file again right after its checkout.
     Since #4983 no job here runs on a self-hosted runner, so there are none
     to check; a job put back on one must write again.

  Nothing is written.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function git(args) {
  return cp.execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}
function some(list) { return list.length ? ' (' + list.slice(0, 4).join('; ') + (list.length > 4 ? '; ' + (list.length - 4) + ' more' : '') + ')' : ''; }

const chain = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'content-tables.json'), 'utf8'));
// With what a step's builder writes only when run by hand (writesOffChain,
// #3120), which is written LF as well.
const writes = Array.from(new Set([].concat.apply([], chain.steps.map(function (s) { return (s.writes || []).concat(s.writesOffChain || []); })))).sort();
// A plugin, or the recipe Thornswood-Last.esp is built from (#2791): bytes, not text.
const PLUGIN = /\.(esp|esm|esl|recipe)$/i;

let tracked = null;
try { tracked = git(['ls-files', '-z']).split('\0').filter(Boolean); }
catch (e) { console.log('NOTE  git did not answer, so nothing here can be measured: ' + e.message); }

if (tracked) {
  // Every tracked file a write names: the file itself, or each file in a folder.
  const files = [];
  const named = [];
  for (const w of writes) {
    const under = tracked.filter(function (f) { return f === w || f.indexOf(w + '/') === 0; });
    if (!under.length) { named.push(w); }
    for (const f of under) { files.push(f); }
  }
  yes('every write content-tables.json names is in the repository' + some(named), named.length === 0);
  const text = files.filter(function (f) { return !PLUGIN.test(f); });
  const plugins = files.filter(function (f) { return PLUGIN.test(f); });

  // ---- A ----------------------------------------------------------------------
  const attr = {};
  const out = git(['check-attr', 'text', 'eol', '--'].concat(files));
  for (const line of out.split('\n')) {
    const m = /^(.*): (text|eol): (.*)$/.exec(line);
    if (m) { (attr[m[1]] = attr[m[1]] || {})[m[2]] = m[3]; }
  }
  const notLf = text.filter(function (f) { return !attr[f] || attr[f].text !== 'set' || attr[f].eol !== 'lf'; });
  yes('A1 .gitattributes says text eol=lf for all ' + text.length + ' text files the steps write' + some(notLf), text.length > 0 && notLf.length === 0);
  const plugText = plugins.filter(function (f) { return attr[f] && (attr[f].text === 'set' || attr[f].eol !== 'unspecified'); });
  yes('A2 and nothing about the ' + plugins.length + ' plugins they write, which are bytes' + some(plugText), plugText.length === 0);

  // ---- B and C ----------------------------------------------------------------
  const eol = {};
  for (const line of git(['ls-files', '--eol', '--'].concat(text)).split('\n')) {
    const m = /^i\/(\S+)\s+w\/(\S+)\s+attr\/.*?\t(.*)$/.exec(line);
    if (m) { eol[m[3]] = { i: m[1], w: m[2] }; }
  }
  const storedBad = text.filter(function (f) { return !eol[f] || (eol[f].i !== 'lf' && eol[f].i !== 'none'); });
  yes('B1 each is stored LF' + some(storedBad.map(function (f) { return f + ' i/' + (eol[f] || {}).i; })), storedBad.length === 0);
  const withCr = text.filter(function (f) { return fs.readFileSync(path.join(ROOT, f)).indexOf(13) >= 0; });
  yes('B2 and holds no CR at all' + some(withCr), withCr.length === 0);
  const outBad = text.filter(function (f) { return !eol[f] || (eol[f].w !== 'lf' && eol[f].w !== 'none'); });
  let autocrlf = '';
  try { autocrlf = git(['config', 'core.autocrlf']).trim(); } catch (e) { autocrlf = 'unset'; }
  yes('C  each is checked out LF here, with core.autocrlf ' + autocrlf + some(outBad.map(function (f) { return f + ' w/' + (eol[f] || {}).w; })), outBad.length === 0);

  // ---- D ----------------------------------------------------------------------
  const attrFile = path.join(ROOT, '.gitattributes');
  const lines = (fs.existsSync(attrFile) ? fs.readFileSync(attrFile, 'utf8') : '').split('\n')
    .map(function (l) { return l.trim(); }).filter(function (l) { return l && l[0] !== '#'; });
  // #3099, #3751: the licence texts are records held by sha256, not a
  // builder's output, and are kept byte for byte. #2791: the recipe is bytes
  // inside game/data, whose text rule it is taken out of, so A2 holds for it
  // like a plugin.
  const BYTES = ['records/client-licences/** -text', 'records/front-licences/** -text', 'game/data/last-plugin.recipe -text !eol'];
  // #5291: a script sh runs, no builder's output; test-5291-pre-push.ps1
  // holds that it is stored LF.
  const NOT_BUILT = ['.githooks/** text eol=lf'];
  const stray = [];
  for (const l of lines) {
    if (BYTES.indexOf(l) >= 0 || NOT_BUILT.indexOf(l) >= 0) { continue; }
    const pattern = l.split(/\s+/)[0];
    const hits = git(['ls-files', '--', ':(glob)' + pattern]).split('\n').filter(Boolean);
    if (!hits.some(function (f) { return text.indexOf(f) >= 0; })) { stray.push(l); }
  }
  yes('D  each of the ' + lines.length + ' lines of .gitattributes covers a file a step writes' + some(stray), lines.length > 0 && stray.length === 0);
  const bad = lines.filter(function (l) { return BYTES.indexOf(l) < 0 && !/^\S+ text eol=lf$/.test(l); });
  yes('D2 and says text eol=lf, nothing else' + some(bad), bad.length === 0);
}

// ---- E ------------------------------------------------------------------------
const RULES = {
  '.ps1': [[/EolOf/, 'takes the ending of a file (EolOf)'], [/"`r`n"/, 'joins with CRLF']],
  '.py': [[/'\\r\\n' (if|in)\b/, 'takes the ending of a file'], [/'\\r\\n'\.join|\+ '\\r\\n'/, 'joins with CRLF'],
          [/\bopen\((?:(?!newline=)[^)])*'w'(?:(?!newline=)[^)])*\)/, 'writes with the platform\'s ending'],
          [/\.write_text\((?:(?!newline=)[^)])*\)/, 'writes with the platform\'s ending']],
  '.js': [[/\? '\\r\\n' :|\bcrlf\b/, 'takes the ending of a file'], [/join\('\\r\\n'\)|\+ '\\r\\n'/, 'joins with CRLF']]
};
const found = [];
for (const s of chain.steps) {
  const src = fs.readFileSync(path.join(ROOT, s.tool), 'utf8');
  for (const [re, why] of RULES[path.extname(s.tool)] || []) {
    if (re.test(src)) { found.push(s.tool + ' ' + why); }
  }
}
yes('E  none of the ' + chain.steps.length + ' steps takes its line ending from a file or writes CRLF' + some(found), found.length === 0);

// ---- F ------------------------------------------------------------------------
const roles = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'merchant-role-tables.json'), 'utf8'));
const stale = Object.keys(roles.sources || {}).filter(function (f) {
  return crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex') !== roles.sources[f];
});
yes('F  merchant-role-tables.json pins the bytes of its ' + Object.keys(roles.sources || {}).length + ' inputs as they are checked out' + some(stale),
  Object.keys(roles.sources || {}).length > 0 && stale.length === 0);

// ---- G ------------------------------------------------------------------------
const WF = path.join(ROOT, '.github', 'workflows');
const AGAIN = /\n\s*- name: Check every tracked file out again\n\s*if: runner\.environment == 'self-hosted'\n\s*shell: pwsh\n\s*run: \|\n\s*git rm -r -q --cached \.\n\s*if \(\$LASTEXITCODE -ne 0\) \{ exit 1 \}\n\s*git reset -q --hard HEAD\n\s*if \(\$LASTEXITCODE -ne 0\) \{ exit 1 \}(\n|$)/;
const missing = [];
let checkouts = 0;
let jobs = 0;
for (const f of fs.readdirSync(WF).filter(function (n) { return /\.ya?ml$/.test(n); }).sort()) {
  const t = fs.readFileSync(path.join(WF, f), 'utf8').split('\r\n').join('\n');
  const starts = [];
  const re = /^  ([A-Za-z0-9_-]+):\s*$/gm;
  let m;
  while ((m = re.exec(t))) { starts.push({ name: m[1], at: m.index }); }
  starts.forEach(function (s, k) {
    const job = t.slice(s.at, k + 1 < starts.length ? starts[k + 1].at : t.length);
    const runs = /^\s*runs-on:(.*)$/m.exec(job);
    if (runs) { jobs++; }
    if (!runs || runs[1].indexOf('self-hosted') < 0) { return; }
    const parts = job.split(/(?=\n\s*- (?:uses|name): )/);
    parts.forEach(function (p, i) {
      if (p.indexOf('uses: actions/checkout@') < 0) { return; }
      checkouts++;
      if (!AGAIN.test(parts[i + 1] || '')) { missing.push(f + ' ' + s.name); }
    });
  });
}
yes('G  each of the ' + checkouts + ' checkouts on a self-hosted runner (of ' + jobs + ' jobs read) is followed by writing every file again' + some(missing),
  jobs > 0 && missing.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
