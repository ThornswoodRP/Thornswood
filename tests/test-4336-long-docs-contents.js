'use strict';
/*
  test-4336-long-docs-contents.js

      node tests/test-4336-long-docs-contents.js

  #4336. A long doc with no contents and few headings means scrolling to
  find anything. Every Markdown page in docs/ and at the top of the repo
  that runs past LONG lines has a ## Contents before its first section,
  linking every ## heading on it, and no page there runs more than GAP
  lines without a heading.

  A page a builder writes (a docs/ path under "writes" or "writesOffChain"
  in scripts/mods/content-tables.json) is held by its builder's own harness,
  byte for byte, so it is not edited by hand here. Its contents come from
  the builder (#6103).

  A page that fails names each heading its Contents lacks, as the link to
  paste. Read only.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const LONG = 300;
const GAP = 150;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules') { continue; }
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walk(p, out); } else if (/\.md$/i.test(e.name)) { out.push(p); }
  }
  return out;
}
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');

const chain = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'content-tables.json'), 'utf8'));
const built = [];
for (const s of chain.steps || []) {
  for (const w of (s.writes || []).concat(s.writesOffChain || [])) { if (/^docs\//.test(w)) { built.push(w.replace(/\/$/, '')); } }
}
const isBuilt = (r) => built.some((w) => r === w || r.startsWith(w + '/'));
yes('scripts/mods/content-tables.json names the docs its builders write (' + built.length + ')', built.length > 0);

const files = walk(path.join(ROOT, 'docs'), [])
  .concat(fs.readdirSync(ROOT).filter((f) => /\.md$/i.test(f)).map((f) => path.join(ROOT, f)))
  .map(rel).filter((r) => !isBuilt(r)).sort();

// GitHub's anchor for a heading: lower case, punctuation but - and _ gone,
// each space a hyphen; a repeated one gets -1, -2.
function anchorOf(text, seen) {
  const a = text.trim().toLowerCase()
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .replace(/ /g, '-');
  const n = seen.get(a) || 0;
  seen.set(a, n + 1);
  return n ? a + '-' + n : a;
}

function headings(lines) {
  const out = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; return; }
    if (fence) { return; }
    const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) { out.push({ level: m[1].length, text: m[2], line: i }); }
  });
  return out;
}

for (const r of files) {
  const lines = fs.readFileSync(path.join(ROOT, r), 'utf8').replace(/\r\n/g, '\n').split('\n');
  const hs = headings(lines);
  const stops = [0].concat(hs.map((h) => h.line)).concat([lines.length]);
  let gap = 0, at = 0;
  for (let i = 1; i < stops.length; i++) {
    if (stops[i] - stops[i - 1] > gap) { gap = stops[i] - stops[i - 1]; at = stops[i - 1] + 1; }
  }
  yes(r + ': no stretch over ' + GAP + ' lines without a heading (longest ' + gap + ', from line ' + at + ')', gap <= GAP);
  if (lines.length <= LONG) { continue; }
  const seen = new Map();
  const all = hs.map((h) => Object.assign({ anchor: anchorOf(h.text, seen) }, h));
  const want = all.filter((h) => h.level === 2 && !/^contents$/i.test(h.text));
  const c = hs.find((h) => h.level === 2 && /^contents$/i.test(h.text));
  const next = c ? (hs.find((h) => h.line > c.line && h.level <= 2) || { line: lines.length }).line : 0;
  const list = c ? lines.slice(c.line + 1, next).join('\n') : '';
  const missing = want.filter((h) => list.indexOf('](#' + h.anchor + ')') < 0);
  const firstSection = want.length ? want[0].line : lines.length;
  const ok1 = !!c && c.line < firstSection;
  const ok2 = !!c && missing.length === 0;
  yes(r + ' (' + lines.length + ' lines) has a ## Contents before its first section', ok1);
  yes(r + ': its Contents links every ## heading' + (missing.length ? ', missing ' + missing.map((h) => '[' + h.text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') + '](#' + h.anchor + ')').join(' ; ') : ''), ok2);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
