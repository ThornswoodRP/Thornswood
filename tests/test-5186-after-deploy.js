// tests/test-5186-after-deploy.js
//
//     node tests/test-5186-after-deploy.js
//
// Issue #5186: a step a pull request needs done after its deploy is a file
// under deploy/after/ that the box deploy agent runs once, not a run note.
// The agent's half (running each step once through the gate, and what it
// keeps) is held by tools/DeployAgent.Tests/AfterDeployTests.cs. This holds
// the half GitHub runs, scripts/release/After-Deploy.js and
// .github/workflows/after-deploy.yml:
//
//   1. an in-game check the agent listed becomes one issue labelled
//      "check: in game", with its words from the commit's own step file, and
//      a second run files no second issue;
//   2. a failed or cut short step is said on its own issue, once for each
//      Deployment;
//   3. a result naming a step the commit does not hold, or one for another
//      environment, is refused and writes nothing; a file for another
//      Deployment or commit stops the run;
//   4. the workflow runs on a Deployment's success only, with issues write
//      and no secret, from the Deployment's own commit; the agent's tests
//      run on a pull request that changes a step file or the gate's verbs.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('../scripts/release/After-Deploy.js');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const COMMIT = 'a'.repeat(40);
function fakeGitHub() {
  const g = { issues: [], comments: {}, labels: [], made: [], said: [] };
  g.api = {
    label: async n => { if (g.labels.indexOf(n) < 0) { g.labels.push(n); } },
    issues: async () => g.issues.slice(),
    create: async i => { const n = 9000 + g.issues.length; g.issues.push(Object.assign({ number: n }, i)); g.made.push(n); return { number: n }; },
    comments: async n => (g.comments[n] || []).slice(),
    comment: async (n, body) => { (g.comments[n] = g.comments[n] || []).push({ body: body }); g.said.push(n); },
  };
  return g;
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'after-deploy-'));
  try {
    fs.mkdirSync(path.join(dir, 'deploy', 'after'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'deploy', 'after', '2484-gates.json'), JSON.stringify({ issue: 2484, environment: 'dev', steps: [
      { run: 'Reset-Npcs-Dev' }, { inGame: 'Walk in at Whiterun\'s main gate and at Riften\'s.', doneWhen: 'Neither gate shows a lock prompt.' }] }));
    fs.writeFileSync(path.join(dir, 'deploy', 'after', '5300-main.json'), JSON.stringify({ issue: 5300, environment: 'main', steps: [{ inGame: 'Look at the main menu once.', doneWhen: 'It shows.' }] }));
    const steps = A.readSteps(dir);
    yes('the step files are read by id, file then place', steps.get('2484-gates#1').step.run === 'Reset-Npcs-Dev' && steps.get('2484-gates#2').issue === 2484 && steps.has('5300-main#1'));

    // ---- 1. an in-game check, filed once --------------------------------------
    const base = { deployment: '77', commit: COMMIT, environment: 'dev', logUrl: 'http://box.test:7788/deploy-77.log', steps: steps };
    const after = { format: 1, deployment: '77', commit: COMMIT, steps: [
      { id: '2484-gates#1', issue: 2484, state: 'success', code: 0 },
      { id: '2484-gates#2', issue: 2484, state: 'in-game', inGame: 'SOMETHING THE BOX SAID' }] };
    let g = fakeGitHub();
    let said = await A.act(Object.assign({ after: after, gh: g.api }, base));
    const made = g.issues[0] || {};
    yes('an in-game check becomes one issue: ' + said.join('; '), g.made.length === 1 && made.labels.join() === A.LABEL && g.labels.join() === A.LABEL);
    yes('  its title and words from the commit\'s step file, never from the box\'s file', made.title === 'Check in game: Walk in at Whiterun\'s main gate and at Riften\'s.' &&
        made.body.indexOf('SOMETHING THE BOX SAID') < 0 && made.body.indexOf('Walk in at Whiterun\'s main gate and at Riften\'s.') === 0);
    yes('  in the plain shape: the check, where and from which issue, and a Done when line', /\n\nOn dev since the deploy of aaaaaaaaaaaa, from #2484\. Step 2484-gates#2 of deploy\/after\.\n\nDone when: Neither gate shows a lock prompt\.$/.test(made.body));
    said = await A.act(Object.assign({ after: after, gh: g.api }, base));
    yes('  a second run files no second one: ' + said.join('; '), g.made.length === 1 && /already #9000/.test(said[0]));
    yes('  a step that ran is no issue and no comment', g.said.length === 0);

    // ---- 2. a failed step, said on its issue once for each Deployment --------
    g = fakeGitHub();
    const failed = { format: 1, deployment: '78', commit: COMMIT, steps: [{ id: '2484-gates#1', issue: 2484, state: 'failure', code: 3 }] };
    said = await A.act(Object.assign({}, base, { after: failed, deployment: '78', logUrl: 'http://box.test:7788/deploy-78.log', gh: g.api }));
    const c = ((g.comments[2484] || [])[0] || {}).body || '';
    yes('a failed step is said on its own issue: ' + said.join('; '), g.said.join() === '2484' && c.indexOf('`Reset-Npcs-Dev`, failed, exit 3 (Deployment 78, Step 2484-gates#1 of deploy/after.)') >= 0);
    yes('  with the log, that the deploy is in, and a Done when line', c.indexOf('The log: http://box.test:7788/deploy-78.log') >= 0 && c.indexOf('The deploy itself is in.') >= 0 && /\n\nDone when: .+$/.test(c));
    yes('  and no footer, as every comment on the public repository (Ops CLAUDE.md)', !/Generated|Claude|\n---/.test(c));
    await A.act(Object.assign({}, base, { after: failed, deployment: '78', logUrl: 'http://box.test:7788/deploy-78.log', gh: g.api }));
    yes('  said once for that Deployment', g.comments[2484].length === 1);
    const cut = { format: 1, deployment: '79', commit: COMMIT, steps: [{ id: '2484-gates#1', issue: 2484, state: 'cut-short' }] };
    said = await A.act(Object.assign({}, base, { after: cut, deployment: '79', gh: g.api }));
    yes('  and a cut short one says it never runs a second time', g.comments[2484].length === 2 && /was cut short: the deploy agent stopped while it ran, and it is never run a second time/.test(g.comments[2484][1].body));

    // ---- 3. what is refused ----------------------------------------------------
    g = fakeGitHub();
    said = await A.act(Object.assign({}, base, { after: { format: 1, deployment: '77', commit: COMMIT, steps: [
      { id: '9999-none#1', issue: 9999, state: 'in-game' }, { id: '5300-main#1', issue: 5300, state: 'in-game' }, { id: '2484-gates#2', issue: 2484, state: 'failure', code: 1 }] }, gh: g.api }));
    yes('a step this commit does not hold, one for another environment, or of another kind writes nothing: ' + said.join('; '),
        g.made.length === 0 && g.said.length === 0 && said.filter(l => /^REFUSED /.test(l)).length === 3);
    let threw = '';
    try { await A.act(Object.assign({}, base, { after: Object.assign({}, after, { deployment: '12' }), gh: fakeGitHub().api })); } catch (e) { threw = e.message; }
    yes('a file for another Deployment stops the run: ' + threw, /for deployment 12, not 77/.test(threw));
    threw = '';
    try { await A.act(Object.assign({}, base, { after: Object.assign({}, after, { commit: 'b'.repeat(40) }), gh: fakeGitHub().api })); } catch (e) { threw = e.message; }
    yes('  and so does one for another commit', /for commit b+, not a+/.test(threw));
    said = await A.act(Object.assign({}, base, { after: { format: 1, deployment: '77', commit: COMMIT, steps: [{ id: '2484-gates#1', state: 'success' }] }, gh: fakeGitHub().api }));
    yes('a Deployment whose steps all ran says it has nothing for people', /^nothing for people: 1 step/.test(said[0]));
    const long = A.issueFor('x-y#1', { issue: 1, step: { inGame: 'word '.repeat(40).trim(), doneWhen: 'It does.' } }, base);
    yes('a long check\'s title is cut at a word, under 100 characters', long.title.length < 100 && /word\.\.\.$/.test(long.title));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // ---- 4. the workflows ----------------------------------------------------------
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'after-deploy.yml'), 'utf8').replace(/\r\n/g, '\n');
  yes('after-deploy.yml runs on a Deployment\'s status, for a success with a log only', /\non:\n  deployment_status:\n/.test(wf) &&
      wf.indexOf("if: ${{ github.event.deployment_status.state == 'success' && github.event.deployment_status.log_url != '' }}") >= 0);
  yes('  with the run\'s own token, issues write and contents read only, and no secret', /\npermissions:\n  contents: read\n  issues: write\n(?! )/.test(wf) && !/secrets\./.test(wf) && /GH_TOKEN: \$\{\{ github\.token \}\}/.test(wf));
  yes('  from the Deployment\'s own commit, keeping no credentials', /ref: \$\{\{ github\.event\.deployment\.sha \}\}/.test(wf) && /persist-credentials: false/.test(wf) && /COMMIT: \$\{\{ github\.event\.deployment\.sha \}\}/.test(wf));
  yes('  taking the Deployment to Dev as the step files\' dev and to Main as main, and no other', /\n            Dev\) export ENVIRONMENT=dev ;;\n            Main\) export ENVIRONMENT=main ;;\n            \*\) /.test(wf));
  yes('  running After-Deploy.js', /\n          node scripts\/release\/After-Deploy\.js\n/.test(wf));
  const da = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'deploy-agent.yml'), 'utf8').replace(/\r\n/g, '\n');
  yes('deploy-agent.yml runs the agent\'s tests on a pull request that changes a step file or the gate\'s verbs',
      /\n      - deploy\/after\/\*\*\n/.test(da) && /\n      - scripts\/vps\/gate\/verbs\.json\n/.test(da));
  yes('  and holds the steps to their rules there', da.indexOf('dotnet run --project tools/DeployAgent --no-restore -- steps --folder deploy/after --verbs scripts/vps/gate/verbs.json') >= 0);
  const build = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'build.yml'), 'utf8').replace(/\r\n/g, '\n');
  const checks = (build.split('\n  checks:\n')[1] || '').split(/\n  [a-z-]+:\n/)[0];
  yes('Tree checks holds the step files to the same rules whenever there is one, so Build check result stops a bad one',
      checks.indexOf("- name: Check the steps after a deploy\n        if: ${{ hashFiles('deploy/after/*.json') != '' }}") >= 0 &&
      checks.indexOf('dotnet run --project tools/DeployAgent --no-restore -- steps --folder deploy/after --verbs scripts/vps/gate/verbs.json') >= 0 &&
      /uses: actions\/setup-dotnet@[0-9a-f]{40} # v[\d.]+\n        if: \$\{\{ hashFiles\('deploy\/after\/\*\.json'\) != '' \}\}/.test(checks));
  const readme = fs.readFileSync(path.join(REPO, 'deploy', 'after', 'README.md'), 'utf8');
  yes('deploy/after/README.md names the label and the check command', readme.indexOf('`' + A.LABEL + '`') >= 0 && readme.indexOf('-- steps --folder deploy/after --verbs scripts/vps/gate/verbs.json') >= 0);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + e.stack); process.exit(1); });
