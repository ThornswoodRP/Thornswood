'use strict';
/*
  test-5641-comment-strips.js

      node tests/test-5641-comment-strips.js

  Issue #5641. Several files took HTML comments out with one pass of
  /<!--[\s\S]*?-->/, which can leave a new "<!--" behind: taking "<!--x-->"
  out of "<!<!--x-->--" joins the two halves into one, and an opener with no
  end was left in the text. The site's lines file was read that way, so a
  note left open there was read as hints and lore lines.

  Now there are three copies of one way to do it, one per language:
  noComments in site/lib/pages.js (which the JavaScript harnesses take
  through tests/html-comments.js), the steps in Go.ps1's
  Write-ThornswoodHints, and no_comments in tests/test-3656-public-words.py.
  Each strips until nothing changes, then cuts at an opener left with no end.

    A  each copy turns every case below into the same text, with no "<!--"
       left (PowerShell with pwsh, Python with python3; a SKIP line without);
    B  parseLines and Write-ThornswoodHints read no hint out of a note left
       open, or out of one whose halves join;
    C  no other tracked file takes comments out with that pattern.

  Read only, but for Write-ThornswoodHints' file in a scratch folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync, execFileSync } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok, why) {
  if (ok) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 400) : '')); }
}

// The cases, with what is left of each.
const CASES = [
  ['no comment', 'a\nb', 'a\nb'],
  ['one comment', 'a<!-- note -->b', 'ab'],
  ['two on one line', 'a<!--x-->b<!--y-->c', 'abc'],
  ['over lines', 'a\n<!-- one\ntwo -->\nb', 'a\n\nb'],
  ['halves that join', '<!<!--x-->-- y -->z', 'z'],
  ['halves that join, left open', 'a<!<!--x-->-- y', 'a'],
  ['an opener with no end', 'a\n<!-- a note\n- not a line', 'a\n'],
  ['one inside another', 'a<!-- b <!-- c --> d -->e', 'a d -->e'],
  ['an end with no opener', 'a --> b', 'a --> b']
];

// ------------------------------------------------------------ A. copies --
let noComments = null;
try { noComments = require('./html-comments').noComments; } catch (e) { noComments = null; }
yes('the site has noComments, and the harnesses take it', typeof noComments === 'function');
const js = CASES.map((c) => (noComments ? noComments(c[1]) : null));

let ps = null;
const pwsh = spawnSync(process.platform === 'win32' ? 'pwsh.exe' : 'pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' });
const GO = path.join(ROOT, 'scripts', 'release', 'Go.ps1');
// Go.ps1's steps, lifted out of Write-ThornswoodHints by PowerShell's own
// parser: the statements from the first that strips to the cut.
const LIFT = [
  '$ErrorActionPreference = "Stop"',
  '$t = $null; $e = $null',
  '$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:GO, [ref]$t, [ref]$e)',
  'if ($e.Count) { throw "Go.ps1 does not parse" }',
  '$f = $ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq "Write-ThornswoodHints" }, $true) | Select-Object -First 1',
  'if (-not $f) { throw "no Write-ThornswoodHints" }'
];
if (pwsh.error || pwsh.status !== 0) {
  console.log('SKIP  Go.ps1: no pwsh here');
} else {
  const script = LIFT.concat([
    '$st = @($f.Body.EndBlock.Statements)',
    '$a = -1; $b = -1',
    'for ($i = 0; $i -lt $st.Count; $i++) {',
    '  if ($a -lt 0 -and $st[$i].Extent.Text -match [regex]::Escape("<!--[\\s\\S]*?-->")) { $a = $i }',
    "  if ($a -ge 0 -and $st[$i].Extent.Text -match 'Substring\\(0, \\\$open\\)') { $b = $i; break }",
    '}',
    'if ($a -lt 0 -or $b -lt 0) { throw "no comment steps in Write-ThornswoodHints" }',
    '$steps = [ScriptBlock]::Create((($st[$a..$b] | ForEach-Object { $_.Extent.Text }) -join "`n") + "`n`$md")',
    '$cases = Get-Content -Raw -LiteralPath $env:CASES | ConvertFrom-Json',
    '$out = foreach ($c in $cases) { $md = [string]$c; ,(& $steps) }',
    'ConvertTo-Json -InputObject @($out) -Compress'
  ]).join('\n');
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5641-'));
  try {
    const casesFile = path.join(work, 'cases.json');
    fs.writeFileSync(casesFile, JSON.stringify(CASES.map((c) => c[1])));
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8', env: Object.assign({}, process.env, { GO, CASES: casesFile }) });
    try { ps = JSON.parse(r.stdout); } catch (e) { ps = null; }
    yes('Go.ps1\'s comment steps run', Array.isArray(ps) && ps.length === CASES.length, r.stdout + r.stderr);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

let py = null;
const PY = path.join(ROOT, 'tests', 'test-3656-public-words.py');
const python = ['python3', 'python'].find((p) => !spawnSync(p, ['-c', '1']).error);
if (!python) {
  console.log('SKIP  test-3656-public-words.py: no python here');
} else {
  // no_comments, lifted out by Python's own parser and run alone.
  const lift = [
    'import ast, json, re, sys',
    'src = open(sys.argv[1], encoding="utf-8").read()',
    'fn = [n for n in ast.parse(src).body if isinstance(n, ast.FunctionDef) and n.name == "no_comments"]',
    'if not fn: raise SystemExit("no no_comments")',
    'box = {"re": re}',
    'exec(ast.get_source_segment(src, fn[0]), box)',
    'print(json.dumps([box["no_comments"](t) for t in json.loads(sys.argv[2])]))'
  ].join('\n');
  const r = spawnSync(python, ['-I', '-c', lift, PY, JSON.stringify(CASES.map((c) => c[1]))], { encoding: 'utf8' });
  try { py = JSON.parse(r.stdout); } catch (e) { py = null; }
  yes('test-3656\'s no_comments runs', Array.isArray(py) && py.length === CASES.length, r.stdout + r.stderr);
}

CASES.forEach((c, i) => {
  const want = c[2];
  yes('A ' + c[0] + ': noComments leaves ' + JSON.stringify(want), js[i] === want && String(js[i]).indexOf('<!--') < 0, JSON.stringify(js[i]));
  if (ps) yes('A ' + c[0] + ': Go.ps1 leaves the same', ps[i] === want, JSON.stringify(ps[i]));
  if (py) yes('A ' + c[0] + ': test-3656 leaves the same', py[i] === want, JSON.stringify(py[i]));
});

// ---------------------------------------------------------- B. the lines --
const cut = /\/\/ ==== thornswood lines ====([\s\S]*?)\/\/ ==== end thornswood lines ====/.exec(siteFiles.source());
const parseLines = cut ? new Function(cut[1] + '\nreturn parseLines;')() : null;
const LINES = '# Lines\n\n## Hints\n\n- A real hint.\n<!<!--x-->-- a note for the team\n- Not a hint, inside the note.\n-->\n' +
  '- Another real hint.\n\n<!-- left open\n- Not a hint either.\n';
const WANT = ['A real hint.', 'Another real hint.'];
const got = parseLines ? parseLines(LINES).hints : null;
yes('B parseLines reads no hint out of a note whose halves join, or one left open (' + JSON.stringify(got) + ')',
    JSON.stringify(got) === JSON.stringify(WANT));
if (!(pwsh.error || pwsh.status !== 0)) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5641-'));
  try {
    const lines = path.join(work, 'lines.md'), out = path.join(work, 'UI', 'thornswood-hints.js');
    fs.writeFileSync(lines, LINES);
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', LIFT.concat(['. ([ScriptBlock]::Create($f.Extent.Text))',
      'Write-ThornswoodHints $env:LINES $env:OUT']).join('\n')], { encoding: 'utf8', env: Object.assign({}, process.env, { GO, LINES: lines, OUT: out }) });
    const box = { window: {} };
    try { vm.createContext(box); vm.runInContext(fs.readFileSync(out, 'latin1'), box); } catch (e) { box.window.THORNSWOOD_HINTS = null; }
    yes('B and Write-ThornswoodHints writes the same hints', r.status === 0 &&
        JSON.stringify(box.window.THORNSWOOD_HINTS) === JSON.stringify(WANT), r.stdout + r.stderr);
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------- C. a scan --
/* The pattern, as source code writes it in each language, in every tracked
   file of code. The three copies hold it; test-4364 finds a page's comments
   with it to read them, which takes nothing out; and this file names it. */
const ALLOWED = {
  'site/lib/pages.js': 'noComments',
  'scripts/release/Go.ps1': 'Write-ThornswoodHints',
  'tests/test-3656-public-words.py': 'no_comments',
  'site/tests/test-4364-site-comment-paths.ps1': 'reads the comments, takes none out',
  'tests/test-5641-comment-strips.js': 'this harness'
};
const files = execFileSync('git', ['-C', ROOT, 'ls-files', '*.js', '*.mjs', '*.cjs', '*.ts', '*.ps1', '*.psm1', '*.py', '*.cs'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);
yes('there are files to read (' + files.length + ')', files.length > 500);
const PATTERN = '<!--[\\s\\S]*?-->';
const found = files.filter((f) => {
  let t = '';
  try { t = fs.readFileSync(path.join(ROOT, f), 'utf8'); } catch (e) { return false; /* in the index but not on disk: nothing to read */ }
  return t.indexOf(PATTERN) >= 0;
});
const stray = found.filter((f) => !ALLOWED[f]);
yes('C no other file takes comments out with one pass of the pattern' + (stray.length ? ' (' + stray.join(', ') + ')' : ''), stray.length === 0);
// In each copy, every line of code that has it is the loop's, with its
// while on that line or the one above. A comment that names it is not code.
for (const f of Object.keys(ALLOWED)) {
  if (f.indexOf('test-4364') >= 0 || f.indexOf('test-5641') >= 0) continue;
  const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/);
  const uses = lines.map((l, i) => ({ l, i })).filter((x) => x.l.indexOf(PATTERN) >= 0 && !/^\s*(?:\/\/|\/?\*|#)/.test(x.l));
  yes('C ' + f + ' strips it in a loop, in ' + ALLOWED[f], uses.length > 0 &&
      uses.every((x) => /\bwhile\b/.test(x.l) || /\bwhile\b/.test(lines[x.i - 1] || '')));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
