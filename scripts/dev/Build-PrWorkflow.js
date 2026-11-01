#!/usr/bin/env node
// scripts/dev/Build-PrWorkflow.js
//
// #1306 (Patrick, 11 Oct 2026, option C): a pull request builds on GitHub's
// hosted windows-latest runner, in a file of its own,
// .github/workflows/build-pr.yml, and build.yml keeps a push to main and a
// manual run. The VPS fallback both had went at the flip (#4983).
//
// build-pr.yml is GENERATED from build.yml so the two can never test
// different things. Edit build.yml, then run:
//
//     node scripts/dev/Build-PrWorkflow.js
//
// With --check it writes nothing and exits 1 if build-pr.yml is stale;
// tests/test-1306-pr-workflow.js runs that in the Launcher builds check.
'use strict';
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SRC = path.join(REPO, '.github', 'workflows', 'build.yml');
const OUT = path.join(REPO, '.github', 'workflows', 'build-pr.yml');

function fail(why) { throw new Error('Build-PrWorkflow: ' + why); }
function code(t) { return t.replace(/^\s*#.*$/gm, ''); }
function swap(text, from, to, what) {
  if (text.indexOf(from) < 0) { fail('build.yml no longer has ' + what + ' (' + JSON.stringify(from) + ')'); }
  return text.replace(from, to);
}

function build(src) {
  src = src.split('\r\n').join('\n');
  const at = src.indexOf('\nname: Build check\n');
  if (at < 0) { fail('build.yml no longer starts its body with "name: Build check"'); }
  let body = src.slice(at + 1);
  body = swap(body, 'name: Build check\n', 'name: Build check (pull requests)\n', 'its name');
  const on = /\non:\n(?:  .*\n|    .*\n)+?(?=permissions:)/.exec(body);
  if (!on || on[0].indexOf('  push:') < 0) { fail('build.yml no longer has its push and manual triggers'); }
  /*
    A PIN PULL REQUEST'S OWN RUN (#5148). engine-pin.yml pushes the rolling
    engine pin branch with the run's own token, and GitHub starts no
    pull_request run for a push made with that token. A manual run is the one
    event that token may start, so engine-pin.yml starts this workflow on the
    branch after each push, and its checks land on the pull request's head.
    A manual run needs write access, which a push already needs.
  */
  /*
    THE MERGE QUEUE'S RUN (#5182, the redesign's part 5). Main's ruleset puts
    a pull request in GitHub's merge queue, and the queue lands it only once
    every check the ruleset requires has passed on the queue's own merge of
    it onto the newest main, a merge_group event. Without this trigger
    "Build check result" is never reported there and nothing merges. The
    pick runs the whole gate on it (it narrows only a pull_request run), and
    build.yml's tested job finds this run when that merge lands on main.
  */
  body = body.replace(on[0], '\non:\n  pull_request:\n  merge_group:\n    types: [checks_requested]\n  workflow_dispatch:\n');
  body = swap(body, 'group: build-${{ github.ref }}', 'group: build-pr-${{ github.ref }}', 'its concurrency group');
  /*
    A PULL REQUEST'S NEWER PUSH CANCELS ITS OLDER RUN (#3874). Main's builds
    wait for each other, because each one traces the gate for the pull
    requests after it; nothing reads a pull request's trace, so its older run
    is a commit nobody wants.
  */
  const conc = /(\nconcurrency:\n(?:#.*\n|  .*\n)*?)  cancel-in-progress: false\n/.exec(body);
  if (!conc) { fail('build.yml no longer has cancel-in-progress: false in its concurrency'); }
  body = body.replace(conc[0], conc[1] + '  cancel-in-progress: true\n');
  /*
    NO "tested" JOB ON A PULL REQUEST (#3182). build.yml's first job asks
    whether a pull request build already passed main's tree; a pull request
    is what makes that note, so its build has no such job and the launcher
    job needs nothing.
  */
  const tested = /\n  # ALREADY TESTED \(#3182[\s\S]*?\n  tested:\n[\s\S]*?\n\n(?=  # )/.exec(body);
  if (!tested) { fail('build.yml no longer has its "tested" job before the gate and launcher jobs'); }
  body = body.replace(tested[0], '\n');
  // The gate's pick and the tree checks wait for it in build.yml (#5292),
  // the gate's shares wait for it and the pick (#5183), and the launcher job
  // waits for it and the pick's path rule (#5292).
  const waits = "    needs: tested\n    if: ${{ !cancelled() && needs.tested.outputs.run == '' }}\n";
  if (body.split(waits).length !== 3) { fail('build.yml no longer has the tested condition on exactly the pick and tree checks jobs'); }
  body = body.split(waits).join('');
  const shareWaits = "    needs: [tested, pick]\n    if: ${{ !cancelled() && needs.tested.outputs.run == '' && needs.pick.result == 'success' && needs.pick.outputs.shares != '[]' }}\n";
  if (body.split(shareWaits).length !== 2) { fail('build.yml no longer has the gate\'s shares waiting for the tested and pick jobs, and skipped when the pick gave none'); }
  body = body.replace(shareWaits, "    needs: pick\n    if: ${{ needs.pick.outputs.shares != '[]' }}\n");
  // The gate's Linux shares the same way (#5293).
  const linuxWaits = "    needs: [tested, pick]\n    if: ${{ !cancelled() && needs.tested.outputs.run == '' && needs.pick.result == 'success' && needs.pick.outputs.linux_shares != '[]' }}\n";
  if (body.split(linuxWaits).length !== 2) { fail('build.yml no longer has the gate\'s Linux shares waiting for the tested and pick jobs, and skipped when the pick gave none'); }
  body = body.replace(linuxWaits, "    needs: pick\n    if: ${{ needs.pick.outputs.linux_shares != '[]' }}\n");
  const launcherWaits = "    needs: [tested, pick]\n    if: ${{ !cancelled() && needs.tested.outputs.run == '' }}\n    runs-on: ${{ needs.pick.outputs.launcher == 'false' && 'ubuntu-24.04-arm' || 'windows-latest' }}\n";
  if (body.split(launcherWaits).length !== 2) { fail('build.yml no longer has the launcher job waiting for the tested job, and on Linux when the pick\'s path rule says it has nothing to build'); }
  body = body.replace(launcherWaits, "    needs: pick\n    if: ${{ !cancelled() }}\n    runs-on: ${{ needs.pick.outputs.launcher == 'false' && 'ubuntu-24.04-arm' || 'windows-latest' }}\n");
  if (/needs\.tested|needs: \[?tested|^  tested:/m.test(code(body))) { fail('the pull request build still names the tested job'); }
  /*
    THE ONE CHECK MAIN'S PROTECTION REQUIRES (#3683, Patrick's A on
    q-3683-required-check, 27 Oct 2026). Main's ruleset names "Build check
    result", not "Launcher builds", because GitHub counts a skipped required
    check as passed. While the box built there were two builds and either
    could be skipped; since #4983 there is one, and this passes only when it
    succeeded, so a skipped or cancelled build still cannot merge. Since
    31 Oct 2026 the gate runs in shares beside it, in the job "gate", and
    this needs both: a matrix job's result is success only when every share
    succeeded.

    It runs on GitHub's ubuntu-latest: it is a pull request's job, and a
    fork's pull request brings its own copy of this file.

    THE PATH RULE (#5292). When the pick says the change reaches nothing the
    launcher job checks (launcher=false), that job still runs, on Linux, and
    passes with a step that says why; it is never skipped for the path rule,
    so its result here has to be success like the tree checks' (Magpie's
    finding of 1 Nov 2026: a skipped check is not a pass). The gate's shares
    are skipped when the change reaches no harness (shares=[]), and that skip
    counts as passed only when the pick said exactly that and the pick itself
    passed; any other skip, a failure or a cancel cannot merge. The tree
    checks always run and always have to pass. The gate's Linux shares (#5293) the same
    way: skipped counts only when the pick gave none (linux_shares=[]).
  */
  if (/\n  result:\n/.test(body)) { fail('build.yml already has a job named result'); }
  body = body.replace(/\n*$/, '\n') + [
    '',
    '  # The one check main\'s ruleset requires (#3683): passes only when the',
    '  # build and every share of the gate above succeeded. Written by',
    '  # Build-PrWorkflow.js, which says why.',
    '  result:',
    '    name: Build check result',
    '    needs: [pick, checks, launcher, gate, gate-linux]',
    '    if: ${{ !cancelled() }}',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 5',
    '    steps:',
    '      - name: The tree checks, the launcher build and the gate passed',
    '        env:',
    '          PICK: ${{ needs.pick.result }}',
    '          CHECKS: ${{ needs.checks.result }}',
    '          BUILD: ${{ needs.launcher.result }}',
    '          GATE: ${{ needs.gate.result }}',
    "          GATE_LINUX: ${{ needs['gate-linux'].result }}",
    '          REACHES_LAUNCHER: ${{ needs.pick.outputs.launcher }}',
    '          SHARES: ${{ needs.pick.outputs.shares }}',
    '          LINUX_SHARES: ${{ needs.pick.outputs.linux_shares }}',
    '        run: |',
    '          echo "Pick the gate harnesses: $PICK"',
    '          echo "Tree checks: $CHECKS"',
    '          echo "Launcher builds: $BUILD (the change reaches it: $REACHES_LAUNCHER)"',
    '          echo "Gate harnesses, every share: $GATE (shares: $SHARES)"',
    '          echo "Gate harnesses on Linux, every share: $GATE_LINUX (shares: $LINUX_SHARES)"',
    '          ok=1',
    '          [ "$PICK" = success ] || ok=0',
    '          [ "$CHECKS" = success ] || ok=0',
    '          [ "$BUILD" = success ] || ok=0',
    '          if [ "$GATE" != success ]; then',
    '            if [ "$GATE" = skipped ] && [ "$PICK" = success ] && [ "$SHARES" = "[]" ]; then echo "The gate was skipped: the change reaches no gate harness (#5292)"; else ok=0; fi',
    '          fi',
    '          if [ "$GATE_LINUX" != success ]; then',
    '            if [ "$GATE_LINUX" = skipped ] && [ "$PICK" = success ] && [ "$LINUX_SHARES" = "[]" ]; then echo "The gate on Linux was skipped: the change reaches no harness that runs there (#5293)"; else ok=0; fi',
    '          fi',
    '          if [ "$ok" = 1 ]; then exit 0; fi',
    '          echo "::error::the pick, the tree checks, the launcher build or a share of the gate did not pass, so this pull request may not merge"',
    '          exit 1',
    '',
  ].join('\n');
  if (/self-hosted/.test(code(body))) { fail('a job asks for a runner of our own'); }
  if (code(body).indexOf('always()') >= 0) { fail('a job uses always(), which a newer run cannot cancel'); }
  const head =
    '# GENERATED from build.yml by scripts/dev/Build-PrWorkflow.js. Do not edit:\n' +
    '# change build.yml and run  node scripts/dev/Build-PrWorkflow.js\n' +
    '#\n' +
    '# Every pull request runs the same checks as build.yml, on GitHub\'s hosted\n' +
    '# windows-latest runner (#1306, #4983), and again on the merge queue\'s\n' +
    '# merge of it onto the newest main (#5182). No secrets, no live folders: every\n' +
    '# scratch path is under RUNNER_TEMP. The job keeps the name "Launcher builds",\n' +
    '# and the gate runs beside it in shares, "Gate harnesses (n of 5)", after\n' +
    '# the job "Pick the gate harnesses" says what each runs, and the harnesses\n' +
    '# that need nothing from Windows in "Gate harnesses on Linux (n of 4)".\n';

  return head + body;
}
if (require.main === module) {
  const want = build(fs.readFileSync(SRC, 'utf8'));
  const have = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\r\n').join('\n') : '';
  if (process.argv.indexOf('--check') >= 0) {
    if (have !== want) { console.error('build-pr.yml is stale: run node scripts/dev/Build-PrWorkflow.js'); process.exit(1); }
    console.log('build-pr.yml matches build.yml');
  } else {
    fs.writeFileSync(OUT, want);
    console.log('wrote ' + path.relative(REPO, OUT));
  }
}
module.exports = { build: build };
