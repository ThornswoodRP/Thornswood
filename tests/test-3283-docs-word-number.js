// test-3283-docs-word-number.js
//
//     node tests\test-3283-docs-word-number.js
//
// Issue #3283. The merchant pages in docs/systems were written by ChatGPT's
// lane with the space before every number dropped: "adds141", "all240",
// "definitions:241", "histories,23". Its PR text from the same work has the
// same fault (the #2861 description reads "head1773cb7c", "CI39366838341"), so
// the text was broken as it was written, not by a later tool; `git log -S`
// shows each page already broken in the commit that added it. One line came
// from a generator, scripts/dev/Build-NpcPopulation.py, which writes
// merchant-traders.md ("after360 minutes ... existing512-unit"). The same
// pages also carried hand-off notes saying who owns a release step.
//
// This holds, for every page under docs/systems:
//
//   1. no prose runs a word into a number: a lowercase word, "The", "PR",
//      "Expert" or "Master" straight into a digit, or a word's colon or comma
//      straight into a digit. Code spans, fenced blocks, link targets, URLs and
//      form ids (eda3:Dragonborn.esm) are not prose;
//   2. no page says Claude or Codex owns, delivers or releases a step, and no
//      page keeps the PR notes "This source section" or "not the issue";
//   3. the generator's own prose lines, which become merchant-traders.md,
//      follow rule 1 too.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const DOCS = path.join(REPO_DIR, 'docs', 'systems');

let pass = 0, fail = 0;
function yes(what, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (detail ? '\n      ' + detail : '')); }
}

function pages(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(pages(p));
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out.sort();
}

const RUN_ON = /\b[a-z]{2,}\d|\b(?:The|PR|Expert|Master)\d|[a-z][:,]\d/g;
function prose(line) {
  return line
    .replace(/`[^`]*`/g, ' ')
    .replace(/\]\([^)]*\)/g, '] ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\b[0-9a-f]{3,8}:[^\s;,)]+/g, ' ');
}
function runOns(text) {
  const found = [];
  let fence = false;
  text.split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const m = prose(line).match(RUN_ON);
    if (m) found.push((i + 1) + ': ' + m.join(' '));
  });
  return found;
}

const files = pages(DOCS);
yes('docs/systems has pages to read (' + files.length + ')', files.length > 50);

// ---- 1. no word runs into a number -----------------------------------------
const runs = [];
for (const f of files) {
  const rel = path.relative(REPO_DIR, f).split(path.sep).join('/');
  for (const r of runOns(fs.readFileSync(f, 'utf8').split(CR).join(''))) runs.push(rel + ':' + r);
}
yes('no docs/systems page runs a word into a number', runs.length === 0, runs.slice(0, 20).join('\n      '));

// The rule itself sees the faults #3283 names, and leaves ids alone.
const seen = (s) => runOns(s).length > 0;
yes('the rule sees "adds141" and "all240"', seen('This section adds141 parcels, all240 slots.'));
yes('the rule sees "definitions:241" and "histories,23"', seen('contains 245 definitions:241') && seen('all 20 histories,23 legacy'));
yes('the rule sees "PR2065" and "The60"', seen('in PR2065.') && seen('The60 guild traders'));
yes('the rule leaves form ids, code and spaced numbers alone',
  !seen('base `154a5:Thornswood-Content.esp` and eda3:Dragonborn.esm, 12 minutes, version 2'));

// ---- 2. nobody is named as owning a release step ---------------------------
const owner = /\b(?:Claude|Codex)\b[^.]*\b(?:owns?|deliver|delivers|release|releases|releasing|handoff|operational|performed)\b|\b(?:release|handoff|delivery|activation|operational)\b[^.]*\b(?:Claude|Codex)\b/i;
const notes = /This source section|, not the issue/;
const named = [];
for (const f of files) {
  const rel = path.relative(REPO_DIR, f).split(path.sep).join('/');
  const flat = fs.readFileSync(f, 'utf8').split(CR).join('').replace(/\s+/g, ' ');
  for (const s of flat.split(/(?<=[.;])\s/)) {
    if (owner.test(s) || notes.test(s)) named.push(rel + ': ' + s.slice(0, 120));
  }
}
yes('no docs/systems page says who owns a release step', named.length === 0, named.slice(0, 20).join('\n      '));
yes('the owner rule sees "Claude owns the operational step after merge."', owner.test('Claude owns the operational step after merge.'));
yes('the owner rule sees "remains with Claude."', owner.test('matching content delivery remains with Claude.'));

// ---- 3. the generator's prose lines -----------------------------------------
const gen = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'dev', 'Build-NpcPopulation.py'), 'utf8').split(CR).join('');
const genLines = gen.split('\n').filter((l) => /^\s*'[A-Z][^']* [^']*'[,)]?\s*$/.test(l));
const genRuns = genLines.filter((l) => prose(l).match(RUN_ON));
yes('Build-NpcPopulation.py writes merchant-traders.md prose with its spaces (' + genLines.length + ' lines)',
  genLines.length > 0 && genRuns.length === 0, genRuns.join('\n      '));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
