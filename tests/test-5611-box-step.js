// tests/test-5611-box-step.js
//
//     node tests/test-5611-box-step.js
//
// Issue #5611: an issue whose Done when is a step on the box closes on that
// step's own output, never on the merge before it. This holds
// scripts/ops/Box-Step.js and .github/workflows/box-step.yml:
//
//   1. the Done when of an issue is read in its two shapes (a line, and a
//      heading with a paragraph), and a step on the box is told from one
//      that is not: a verb of the gate's verbs.json, "on the box", "box
//      step", Box-Run;
//   2. an issue opened or edited with such a Done when gets the label once;
//   3. a labelled issue closed as done with no "Box step output:" comment
//      is opened again with a plain comment; one with that comment, or closed
//      as not planned or a duplicate, stays closed; an issue a step file
//      under deploy/after names is labelled and held the same way;
//   4. the daily sweep does the same for labelled issues closed lately;
//   5. the workflow runs on those events with issues write and no secret,
//      and the board's rule names the label and the comment's first words.
'use strict';
const fs = require('fs');
const path = require('path');
const B = require('../scripts/ops/Box-Step.js');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

function fakeGitHub(comments, closed) {
  const g = { labelled: [], made: 0, said: {}, reopened: [] };
  g.api = {
    label: async () => { g.made++; },
    addLabel: async n => { g.labelled.push(n); },
    issue: async () => { throw new Error('not read'); },
    closedSince: async () => (closed || []).slice(),
    comments: async n => ((comments || {})[n] || []).slice(),
    comment: async (n, body) => { (g.said[n] = g.said[n] || []).push(body); },
    reopen: async n => { g.reopened.push(n); },
  };
  return g;
}

(async () => {
  const verbs = B.verbNames(REPO);
  yes('the gate\'s verbs are read from verbs.json', verbs.indexOf('Install-Voice') >= 0 && verbs.indexOf('Install-DeployAgent') >= 0);

  // ---- 1. the Done when, and whether it is a step on the box -------------------
  yes('a "Done when:" line is read', B.doneWhen('Some words.\n\nDone when: Install-Voice has run on dev and on live.') === 'Install-Voice has run on dev and on live.');
  yes('  and the paragraph under a "## Done when" heading', B.doneWhen('## What\nx\n\n## Done when\n\nTrace-Gate.ps1 -Uninstall has been run\non the box.\n\n## Related\nnone') === 'Trace-Gate.ps1 -Uninstall has been run\non the box.');
  yes('  and a "Needs" line', B.doneWhen('Needs: Install-Bot -CodeOnly and Deploy-Docs -Site.') === 'Install-Bot -CodeOnly and Deploy-Docs -Site.');
  yes('a gate verb in the Done when is a step on the box', B.namesBoxStep('Done when: Install-Voice has run on dev and on live.', verbs) === 'Install-Voice');
  yes('  with .ps1 after it too', B.namesBoxStep('Done when: Setup-Discord.ps1 -Check prints nothing to make.', verbs) === 'Setup-Discord');
  yes('  and so are "on the box", "box step" and Box-Run', B.namesBoxStep('Done when: Trace-Gate.ps1 -Uninstall has been run on the box.', verbs) === 'on the box' &&
      B.namesBoxStep('Done when: the box step ran.', verbs) === 'box step' && B.namesBoxStep('Done when: Box-Run of it ends 0.', verbs) === 'Box-Run');
  yes('a verb named only above the Done when is not', B.namesBoxStep('Found while running Install-Voice.\n\nDone when: the page says it.', verbs) === '');
  yes('  nor a longer word that starts with a verb\'s name', B.namesBoxStep('Done when: Install-VoiceCheck passes.', verbs) === '');
  yes('  nor an issue with no Done when', B.namesBoxStep('Install-Voice has run on dev.', verbs) === '');

  // ---- 2. labelled when opened or edited ----------------------------------------
  let g = fakeGitHub();
  let said = await B.act({ event: 'issues', payload: { action: 'opened', issue: { number: 7, labels: [], body: 'Done when: Install-DeployAgent -Main has run.' } }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('an issue opened with a box step in its Done when is labelled: ' + said.join('; '), g.labelled.join() === '7' && g.made === 1);
  g = fakeGitHub();
  said = await B.act({ event: 'issues', payload: { action: 'edited', issue: { number: 7, labels: [{ name: B.LABEL }], body: 'Done when: Install-DeployAgent -Main has run.' } }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('  and not labelled twice', g.labelled.length === 0 && /already labelled/.test(said[0]));
  g = fakeGitHub();
  await B.act({ event: 'issues', payload: { action: 'edited', issue: { number: 8, labels: [], body: 'Done when: the page loads.' } }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('an issue whose Done when is no box step is left as it is', g.labelled.length === 0 && g.reopened.length === 0);
  g = fakeGitHub();
  await B.act({ event: 'issues', payload: { action: 'opened', issue: { number: 9, labels: [], pull_request: {}, body: 'Done when: Install-Voice ran.' } }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('  and so is a pull request', g.labelled.length === 0);

  // ---- 3. a close on the merge is opened again ------------------------------------
  const closed = n => ({ number: n, state: 'closed', state_reason: 'completed', labels: [{ name: B.LABEL }], body: 'Done when: Install-Voice ran.' });
  g = fakeGitHub({ 10: [{ body: 'This is done on main.' }] });
  said = await B.act({ event: 'issues', payload: { action: 'closed', issue: closed(10) }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  const c = (g.said[10] || [])[0] || '';
  yes('a box step closed with no output is opened again: ' + said.join('; '), g.reopened.join() === '10' && c === B.REOPEN);
  yes('  saying why and what closes it, plainly, with no footer', /closes on that step's own output, not on a merge/.test(c) && c.indexOf('"Box step output:"') >= 0 && !/Generated|Claude|\n---|#\d/.test(c));
  g = fakeGitHub({ 11: [{ body: 'x' }, { body: 'Box step output: Install-Voice ran, gate run 20261109-0723, ENDED 0.' }] });
  said = await B.act({ event: 'issues', payload: { action: 'closed', issue: closed(11) }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('  one with a "Box step output:" comment stays closed: ' + said.join('; '), g.reopened.length === 0 && !g.said[11]);
  g = fakeGitHub({ 12: [{ body: 'It said Box step output: somewhere in the middle.' }] });
  await B.act({ event: 'issues', payload: { action: 'closed', issue: closed(12) }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('  and only a comment whose first words they are counts', g.reopened.join() === '12');
  for (const why of ['not_planned', 'duplicate']) {
    g = fakeGitHub();
    await B.act({ event: 'issues', payload: { action: 'closed', issue: Object.assign(closed(13), { state_reason: why }) }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
    yes('  one closed as ' + why + ' stays closed', g.reopened.length === 0);
  }
  g = fakeGitHub();
  await B.act({ event: 'issues', payload: { action: 'closed', issue: { number: 14, state_reason: 'completed', labels: [], body: 'Done when: it works.' } }, verbs: verbs, steps: new Set(), gh: g.api, now: Date.now() });
  yes('an unlabelled issue no step file names closes as it always did', g.reopened.length === 0 && g.labelled.length === 0);
  g = fakeGitHub();
  said = await B.act({ event: 'issues', payload: { action: 'closed', issue: { number: 15, state_reason: 'completed', labels: [], body: 'Done when: it works.' } }, verbs: verbs, steps: new Set([15]), gh: g.api, now: Date.now() });
  yes('an issue a deploy/after step file names is labelled and held to its output too: ' + said.join('; '), g.labelled.join() === '15' && g.reopened.join() === '15');

  // ---- 4. the daily sweep -----------------------------------------------------------
  const now = Date.parse('2026-11-09T13:17:00Z');
  g = fakeGitHub({}, [Object.assign(closed(20), { closed_at: '2026-11-08T22:00:00Z' }), Object.assign(closed(21), { closed_at: '2026-11-01T22:00:00Z' })]);
  said = await B.act({ event: 'schedule', payload: {}, verbs: verbs, steps: new Set(), gh: g.api, now: now });
  yes('the daily sweep opens again a labelled issue closed in the last two days with no output: ' + said.join('; '), g.reopened.join() === '20');

  // ---- 5. the workflow and the rule ---------------------------------------------------
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'box-step.yml'), 'utf8').replace(/\r\n/g, '\n');
  yes('box-step.yml runs on an issue opened, edited or closed, each day and by hand', /\non:\n  issues:\n    types: \[opened, edited, closed\]\n  schedule:\n    - cron: '[^']+'\n  workflow_dispatch:\n/.test(wf));
  yes('  with issues write and contents read only, the run\'s own token and no secret', /\npermissions:\n  contents: read\n  issues: write\n(?! )/.test(wf) && !/secrets\./.test(wf) && /GH_TOKEN: \$\{\{ github\.token \}\}/.test(wf));
  yes('  every action named by a full length commit SHA', (wf.match(/uses: [^\n]+/g) || []).every(u => /@[0-9a-f]{40} # v/.test(u)));
  yes('  running Box-Step.js with the gate\'s verbs and the step files beside it', /run: node scripts\/ops\/Box-Step\.js\n/.test(wf) && /scripts\/vps\/gate\/verbs\.json/.test(wf) && /deploy\/after\//.test(wf));
  const board = fs.readFileSync(path.join(REPO, 'docs', 'guide', 'the-board.md'), 'utf8');
  yes('the-board.md says the rule: the label, the comment\'s first words, and the workflow', board.indexOf('`' + B.LABEL + '`') >= 0 && board.indexOf('`' + B.OUTPUT) >= 0 && board.indexOf('box-step.yml') >= 0);

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL  ' + e.stack); process.exit(1); });
