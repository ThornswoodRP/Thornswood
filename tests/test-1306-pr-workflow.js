// #1306: pull requests build on GitHub's hosted runner, in their own workflow
// file. Since #4983 (the repository is public and GitHub's runners are free)
// every build runs there alone: no fallback on the box, no runner choice.
// build-pr.yml is generated from build.yml and must match it.
// #6879: in the merge queue the box builds a merge whose content inputs
// are new, and the content checks run over that build before it lands.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const WF = path.join(REPO, '.github', 'workflows');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }
function read(f) { try { return fs.readFileSync(f, 'utf8').split('\r\n').join('\n'); } catch (e) { return ''; } }
function code(t) { return t.replace(/^\s*#.*$/gm, ''); }
function triggers(t) {
  const m = /\non:\n((?:  .*\n)+)/.exec(t);
  return m ? m[1].split('\n').filter(l => /^  [a-z_]+:/.test(l)).map(l => l.trim().replace(':', '')) : [];
}
const build = read(path.join(WF, 'build.yml'));
const pr = read(path.join(WF, 'build-pr.yml'));

yes('build.yml no longer runs on a pull request', build && triggers(build).indexOf('pull_request') < 0);
yes('build.yml still runs a push to main and a manual run', /push:\n    branches: \[main\]/.test(build) && triggers(build).indexOf('workflow_dispatch') >= 0);
// #5292: on Windows unless the pick says the change reaches nothing it
// checks; on main the pick always says it does (Launcher-Reach.ps1).
yes('main builds on GitHub\'s hosted runner, unless its pull request already passed the tree (#3182)', /\n  launcher:\n    name: Launcher builds\n    needs: \[tested, pick\]\n    if: \$\{\{ !cancelled\(\) && needs\.tested\.outputs\.run == '' \}\}\n    runs-on: \$\{\{ needs\.pick\.outputs\.launcher == 'false' && 'ubuntu-24\.04-arm' \|\| 'windows-latest' \}\}\n/.test(build));
yes('  with no fallback job and nothing on a self-hosted runner (#4983)', !/\n  launcher-vps:\n|\n  tested-vps:\n/.test(build) && code(build).indexOf('self-hosted') < 0);
yes('  and no runner to pick on a manual run', !/\n    inputs:\n/.test(build) && !/inputs\.runner|vars\.BUILD_RUNNER/.test(code(build)));
yes('build-pr.yml exists', !!pr);
// #5148: and a manual run, which engine-pin.yml starts on the pin branch it
// pushes, since a push with the run's own token starts no pull_request run.
// #5182: and in the merge queue, which lands a pull request only once the
// checks main's ruleset requires passed on the queue's merge of it.
yes('build-pr.yml runs on a pull request, in the merge queue and on a manual run, nothing else', JSON.stringify(triggers(pr)) === '["pull_request","merge_group","workflow_dispatch"]' &&
    /\n  merge_group:\n    types: \[checks_requested\]\n/.test(pr));
yes('on GitHub\'s hosted windows-latest', /\n    runs-on: windows-latest\n/.test(pr));
yes('no pull request job is on a self-hosted runner (#4983)', !!pr && code(pr).indexOf('self-hosted') < 0 && !/\n  launcher-vps:\n/.test(pr));
yes('it takes no secrets', !!pr && !/\$\{\{\s*secrets\./.test(pr));
yes('its check keeps the name Launcher builds', /\n    name: Launcher builds\n/.test(pr));
// #5292: its job always runs and reports a result: on Windows, building,
// unless the pick said the change reaches nothing it checks, and then on
// Linux, saying so. A failed pick still builds.
yes('a pull request build has no "tested" job, and its launcher job always runs, on Windows unless the pick says the change cannot reach it (#3182, #5292)',
    !/\n  tested:\n|needs\.tested|needs: \[?tested/.test(code(pr)) && /\n  launcher:\n    name: Launcher builds\n    needs: pick\n    if: \$\{\{ !cancelled\(\) \}\}\n    runs-on: \$\{\{ needs\.pick\.outputs\.launcher == 'false' && 'ubuntu-24\.04-arm' \|\| 'windows-latest' \}\}\n/.test(pr));
yes('  and the tree checks always run, on Linux, once the pick laid their content build (#5292, #7115)', /\n  checks:\n    name: Tree checks\n    needs: pick\n    runs-on: ubuntu-latest\n/.test(pr));
const prTree = (/\n  checks:\n[\s\S]*?(?=\n  \w[\w-]*:\n|$)/.exec(pr) || [''])[0];
yes('PR role derivation checks can read the retained commit without persisting credentials',
    /persist-credentials: false\n\s+fetch-depth: 0\n\s+filter: blob:none/.test(prTree) &&
    /python scripts\/dev\/Check-MerchantRoleCandidate\.py --allow-candidate/.test(prTree) &&
    !/secrets\.|GH_TOKEN:|GITHUB_TOKEN:/.test(code(prTree)));
yes('the Main build still checks exact generated merchant role data',
    /python tests\/test-merchant-role-data\.py/.test(build) &&
    /python scripts\/dev\/Build-MerchantRoleTables\.py --check/.test(build) &&
    !/Check-MerchantRoleCandidate\.py/.test(build));
// No workflow runs a pull request on the VPS, and none runs on
// pull_request_target.
const others = fs.readdirSync(WF).filter(f => /\.ya?ml$/.test(f)).filter(f => {
  const t = read(path.join(WF, f));
  const tr = triggers(t);
  if (tr.indexOf('pull_request_target') >= 0) { return true; }
  if (tr.indexOf('pull_request') < 0 || !/thornswood-vps/.test(code(t))) { return false; }
  return true;
});
yes('no workflow runs a pull request on the VPS (' + (others.join(', ') || 'none') + ')', others.length === 0);
// #3683, Patrick's A on q-3683-required-check: the one name main's ruleset
// requires passes only when the build succeeded on GitHub's runner. The
// repository is public since 30 Oct, so it no longer waits for that.
const result = /\n  result:\n([\s\S]*)$/.exec(code(pr));
const rj = result ? result[1] : '';
yes('a "Build check result" job needs the pick, the tree checks, the build, the gate\'s shares on both platforms and the queued merge\'s content checks (#3683, #5292, #5293, #6879)', /^    name: Build check result\n    needs: \[pick, checks, launcher, gate, gate-linux, bot, queue-content, queue-pick, queue-checks, queue-checks-linux\]\n/.test(rj));
yes('  runs unless cancelled', /\n    if: \$\{\{ !cancelled\(\) \}\}\n/.test(rj));
yes('  on GitHub\'s ubuntu-latest, never the box', /\n    runs-on: ubuntu-latest\n/.test(rj) && !/self-hosted|thornswood/.test(rj));
yes('  with no checkout, action or secret: it reads only their results', !/uses:|secrets\.|checkout/.test(rj) &&
    /BUILD: \$\{\{ needs\.launcher\.result \}\}/.test(rj) && /GATE: \$\{\{ needs\.gate\.result \}\}/.test(rj) &&
    /BOT: \$\{\{ needs\.bot\.result \}\}/.test(rj) && /CHECKS: \$\{\{ needs\.checks\.result \}\}/.test(rj) && /PICK: \$\{\{ needs\.pick\.result \}\}/.test(rj) &&
    /GATE_LINUX: \$\{\{ needs\['gate-linux'\]\.result \}\}/.test(rj) && /LINUX_SHARES: \$\{\{ needs\.pick\.outputs\.linux_shares \}\}/.test(rj));
// Which results pass is run, not read: tests\test-5292-path-rule.ps1 runs
// this step's script for every result and output it can be given.
yes('  and passes only when the tree checks passed, and the build and the gate passed or the pick skipped them (#5292)',
    /\[ "\$CHECKS" = success \] \|\| ok=0/.test(rj) && /if \[ "\$ok" = 1 \]; then exit 0; fi\n[\s\S]*exit 1/.test(rj));
// 31 Oct 2026: the gate runs in five shares beside the launcher job, each on
// a hosted runner of its own, and both builds have the same shares.
for (const [what, t] of [['main\'s build', build], ['the pull request build', pr]]) {
  // The gate job runs from its key to the next line at the jobs' indent.
  const at = t.indexOf('\n  gate:\n');
  const rest = at < 0 ? '' : t.slice(at + '\n  gate:\n'.length);
  const end = rest.search(/\n  \S/);
  const g = end < 0 ? rest : rest.slice(0, end + 1);
  yes(what + ' runs the gate in its own job on GitHub\'s hosted Windows runner', /\n    runs-on: windows-latest\n/.test(g) && !/self-hosted/.test(code(g)));
  // How many is the pick job's SHARES (#5183), handed on as its output.
  const p = t.indexOf('\n  pick:\n');
  const pick = p < 0 || p > at ? '' : t.slice(p, at);
  yes('  in shares, every one running to its end, as many as the pick says', /\n      fail-fast: false\n      matrix:\n        shard: \$\{\{ fromJSON\(needs\.pick\.outputs\.shares\) \}\}\n/.test(g) &&
      /\n          SHARES: '([2-9]|\d\d)'\n/.test(pick) && /\n    runs-on: ubuntu-latest\n/.test(pick));
}
yes('  main\'s own build has no such job: only a pull request is held to it', !/\n  result:\n/.test(code(build)));
let gen = null;
try { gen = require(path.join(REPO, 'scripts', 'dev', 'Build-PrWorkflow.js')); } catch (e) { gen = null; }
yes('the generator is there', !!gen);
let want = '';
try { want = gen ? gen.build(build) : ''; } catch (e) { console.log('  ' + e.message); }
yes('build-pr.yml is exactly what build.yml generates (run node scripts/dev/Build-PrWorkflow.js)', !!want && want === pr);
// #1306, 12 Oct: always() ignores a cancelled run, so a new push could not
// cancel an older run whose job waited for a runner. The older run held the
// concurrency group and the new run sat pending behind it. !cancelled() lets
// cancel-in-progress take the waiting job down with its run.
yes('main\'s build does not use always(), so a newer run cancels it', code(build).indexOf('always()') < 0);
yes('the pull request build does not use always() either', code(pr).indexOf('always()') < 0);
// #3874: main's build traces the gate for the pull requests after it, so a
// newer push to main waits for the build in progress rather than cancelling
// it; a pull request's newer push still cancels its older run.
yes('main waits for the build in progress, one group a ref', /\nconcurrency:\n(?:#.*\n)*  group: build-\$\{\{ github\.ref \}\}\n  cancel-in-progress: false\n/.test(build));
yes('a pull request cancels its older run', /\nconcurrency:\n(?:#.*\n)*  group: build-pr-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true\n/.test(pr));
// #5958: an independent job, outside the JS/PS gate's path selection. The
// runner's real process behavior is exercised by test-5958-bot-runner.ps1.
for (const [what, workflow] of [['main', build], ['pull request', pr], ['nightly', read(path.join(WF, 'nightly.yml'))]]) {
  const match = /\n  bot:\n([\s\S]*?)(?=\n  [a-z][\w-]*:\n|$)/.exec(workflow);
  const bot = match ? match[1] : '';
  yes(what + ' runs the same complete bot suite on hosted Windows with Python 3.12',
    /name: Bot harnesses/.test(bot) && /runs-on: windows-latest/.test(bot) &&
    /python-version: '3.12'/.test(bot) && /& \.\/scripts\/dev\/Run-BotHarnesses\.ps1 -Python \$py/.test(bot));
  yes(what + ' installs the bot lock with hashes and refuses installation failures',
    /--require-hashes --only-binary :all: -r bot\\requirements\.txt/.test(bot) &&
    /if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/.test(bot));
  if (what === 'pull request') {
    yes('the bot job has no path-selection or conditional skip on a pull request',
      !/^    (needs|if):/m.test(bot));
  }
}
// #6879: in the merge queue the box builds a merge whose content inputs are
// not the newest kept build's, and the content checks run over that build
// before it lands. The token that may write Contents and Deployments is that
// job's alone, and only a merge group's run starts it; what it waits for and
// the checks after it fit in the time main's ruleset gives a merge group.
{
  const job = (t, name) => { const m = new RegExp('\\n  ' + name + ':\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|$)').exec(t); return m ? m[1] : ''; };
  const qc = job(pr, 'queue-content');
  yes('the merge queue asks the box for the queued merge\'s content build, on a merge group\'s run alone (#6879)',
    /\n    needs: pick\n    if: \$\{\{ github\.event_name == 'merge_group' && needs\.pick\.outputs\.content_same == 'no' \}\}\n/.test(qc) &&
    /Get-ContentBuild\.ps1 -Server dev -Queued -Ask -WaitMinutes \d+ -Take -Keep /.test(qc) &&
    /\n      content_same: \$\{\{ steps\.content\.outputs\.same \}\}\n/.test(job(pr, 'pick')));
  // Each job's own permissions block, read job by job.
  const jobs = code(pr).split('\njobs:\n')[1] || '';
  const writers = jobs.split(/\n(?=  [a-z][\w-]*:\n)/).filter(b => /^      (contents|deployments): write$/m.test(b)).map(b => /^\s*([a-z][\w-]*):/.exec(b)[1]);
  yes('  and only that job holds a token that writes Contents or Deployments',
    writers.join(',') === 'queue-content' && !/^  [a-z_]+:\s*write/m.test(code(pr).split('\njobs:\n')[0]));
  const qp = job(pr, 'queue-pick'), qw = job(pr, 'queue-checks'), ql = job(pr, 'queue-checks-linux');
  yes('  the content checks are picked over that build and run in shares on both platforms',
    /Run-Gate\.ps1 -Pick \d+ -LinuxShares \d+ -Content/.test(qp) && /\n    needs: queue-content\n    runs-on: /.test(qp) &&
    /name: content-queued/.test(qw) && /name: content-queued/.test(ql) && /runs-on: windows-latest/.test(qw) && /-Platform Linux/.test(ql));
  const settings = read(path.join(REPO, 'records', 'github-repo-settings.json'));
  const limit = +((/"check_response_timeout_minutes": (\d+)/.exec(settings) || [])[1] || 0);
  const minutes = re => +((re.exec(qc) || [])[1] || 0);
  const wait = minutes(/-WaitMinutes (\d+)/), job1 = minutes(/\n    timeout-minutes: (\d+)\n/);
  const share = Math.max(+((/\n    timeout-minutes: (\d+)\n/.exec(qw) || [])[1] || 99), +((/\n    timeout-minutes: (\d+)\n/.exec(ql) || [])[1] || 99));
  const budget = Math.max(+((/-BudgetSeconds (\d+)/.exec(qw) || [])[1] || 9999), +((/-BudgetSeconds (\d+)/.exec(ql) || [])[1] || 9999)) / 60;
  yes('  its wait ends before its job\'s clock, each share\'s budget before its own, and the wait and a share\'s budget together inside the ' + limit + ' minutes main\'s ruleset gives a merge group',
    limit > 0 && wait > 0 && wait < job1 && budget < share && wait + budget < limit);
}
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
