#!/usr/bin/env node
// scripts/dev/Check-ProcessExit.js
//
//     node scripts/dev/Check-ProcessExit.js           compare with the baseline
//     node scripts/dev/Check-ProcessExit.js --list    print today's numbers in
//                                                     the baseline's format
//
// Counts the calls to node's exit function, file by file, in every .js,
// .cjs, .mjs, .ps1 and .psm1 file in the checkout (tracked, or new and not
// ignored), and fails when any file has more than
// scripts/dev/exit-baseline.txt allows, or fewer than it allows with its line
// not yet lowered. tests/test-6036-process-exit.js runs it on every pull
// request.
//
// WHY (#6036). On Node 24 that call joins V8's background compiler threads
// while the isolate is still alive, and a compile job parked for a garbage
// collection only the main thread can run waits for ever on a main thread
// that is waiting for it (nodejs/node#64274). The harness has printed its
// result by then, so the step sits until its job is cancelled: on 16 Nov 2026
// that took five pull requests out of the merge queue. Measured on Node
// 24.22.2 with the upstream reproduction, 10 of 20 runs ending that way hung,
// and 0 of 20 ending by setting process.exitCode, the exit that disposes the
// isolate first. So a harness or a tool ends by setting process.exitCode and
// closing what it opened, and this holds the count where it is until every
// area has moved.
//
// The count reads the text, so a comment or a string that spells out the
// call counts too: say it another way. A number in the baseline only goes
// down. Lower a file's line in the pull request that lowers its count, and
// take it out when it reaches none. Raising one is not a fix.
'use strict';
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const CALL = 'process' + '.exit(';
const KINDS = /\.(js|cjs|mjs|ps1|psm1)$/i;
const BASELINE = 'scripts/dev/exit-baseline.txt';

function files(root) {
  const r = cp.spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error('git ls-files did not list ' + root + ': ' + (r.error ? r.error.message : String(r.stderr).trim()));
  }
  return Array.from(new Set(r.stdout.split('\0').filter((f) => f && KINDS.test(f)))).sort();
}

function count(text) {
  let n = 0;
  let at = text.indexOf(CALL);
  while (at >= 0) { n++; at = text.indexOf(CALL, at + CALL.length); }
  return n;
}

// Every file with one or more calls, by its path from the root with /.
function measure(root) {
  const have = new Map();
  for (const f of files(root)) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), 'utf8'); }
    catch (e) {
      // A tracked file deleted in the working tree holds no call.
      if (e.code === 'ENOENT') continue;
      throw e;
    }
    const n = count(text);
    if (n) have.set(f, n);
  }
  return have;
}

function readBaseline(file) {
  const allowed = new Map();
  const bad = [];
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith('#')) return;
    const m = /^(\S+)\s+(\d+)$/.exec(s);
    if (!m || Number(m[2]) < 1 || allowed.has(m[1])) { bad.push(path.basename(file) + ':' + (i + 1) + ' is not one path and a count above 0 it has not had before: ' + s); return; }
    allowed.set(m[1], Number(m[2]));
  });
  return { allowed, bad };
}

function compare(have, allowed) {
  const problems = [];
  for (const [f, n] of have) {
    const b = allowed.get(f) || 0;
    if (n > b) problems.push(f + ' calls it ' + n + ' time(s), and the baseline allows ' + b + '. End by setting process.exitCode, and close what is still open.');
    else if (n < b) problems.push(f + ' calls it ' + n + ' time(s), and its line says ' + b + '. Lower the line to ' + n + ' in this pull request.');
  }
  for (const [f, b] of allowed) {
    if (!have.has(f)) problems.push(f + ' calls it no more (its line says ' + b + '). Take the line out in this pull request.');
  }
  return problems;
}

function list(have) {
  return Array.from(have.keys()).sort().map((f) => f + ' ' + have.get(f));
}

function main(argv) {
  const root = path.resolve(__dirname, '..', '..');
  const have = measure(root);
  if (argv.includes('--list')) { list(have).forEach((l) => console.log(l)); return 0; }
  const { allowed, bad } = readBaseline(path.join(root, BASELINE));
  const problems = bad.concat(compare(have, allowed));
  problems.forEach((p) => console.log('FAIL  ' + p));
  let total = 0;
  for (const n of have.values()) total += n;
  console.log(problems.length ? (problems.length + ' problem(s); ' + total + ' call(s) in ' + have.size + ' file(s)') : ('the count holds: ' + total + ' call(s) in ' + have.size + ' file(s), none above ' + BASELINE));
  return problems.length ? 1 : 0;
}

module.exports = { CALL, KINDS, BASELINE, files, count, measure, readBaseline, compare, list };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
