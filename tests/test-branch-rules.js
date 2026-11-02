// test-branch-rules.js
//
// The three files that say how work reaches main say what GitHub and the
// scripts actually do.
//
// WHY THIS EXISTS. Entry 232 on the To Do List, first opened as "the review
// routine both documents describe has never happened, and the settings exempt
// the only person it would bind". Branch protection on main changed twice on
// 22 September, and each time the documents were a step behind. Read off GitHub
// on 23 September: enforce_admins on, one required check "Launcher builds",
// required approving reviews 0, code owner review off. CLAUDE.md was corrected
// in #196. Developer-Guide.md still said a main Ship commits and pushes the
// source when the release is out, and that the other person reads every pull
// request. .github/CODEOWNERS still said Patrick's own work goes straight to
// main and never becomes a pull request. CLAUDE.md itself still said a main
// Ship commits and pushes the source, one bullet above the paragraph saying
// Ship writes nothing to the repository. With enforce_admins on, a push
// straight to main is refused, so all of those described something the
// tooling will not allow.
//
// So this checks two things. First, the facts the documents lean on, read off
// the files that decide them: build.yml has one job and it is "Launcher
// builds"; Ship.ps1 never writes to the source repository; nothing commits
// the launcher's number (#5179); CODEOWNERS names files that exist and
// covers the six shared ones the ops repo's CLAUDE.md lists. Then the documents: each states
// the four settings (since 25 September: enforce_admins off, no required
// check, since the build check on GitHub is off), gives
// the command that reads the live settings, and says none of the things that
// stopped being true.
//
// #3617: with enforce_admins off, GitHub holds the admin account to none of
// main's rules, yet the guide still said "GitHub refuses it" of a push to main
// and that enforce_admins "went on". So the documents must also say who a push
// or force push to main is refused for, and must not say any of the lines that
// claimed GitHub refuses everybody. With --live it reads the rulesets too,
// since a ruleset can hold an admin even with enforce_admins off.
//
//     node tests/test-branch-rules.js           the files only, no network
//     node tests/test-branch-rules.js --live    also reads branch protection
//                                               off GitHub with gh and checks
//                                               the documents against it
//
// The --live read is a GET and changes nothing. CI does not pass it: the
// token a workflow gets cannot read branch protection.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = REPO_DIR;
const LIVE = process.argv.indexOf('--live') !== -1;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

// Prose wraps anywhere and CODEOWNERS is all comment lines, so every document
// is compared as one line: comment marks off, Markdown emphasis and code
// marks off, whitespace collapsed.
function flat(text, comments) {
  let t = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
  if (comments) t = t.replace(/^[ \t]*#[ \t]?/gm, '');
  return t.replace(/[*`]/g, '').replace(/\s+/g, ' ');
}

// ------------------------------------------------------------ build.yml
// A required status check is matched by the job's name. Branch protection
// names one, so build.yml has to have exactly one job, and it has to be
// called what the documents and the setting call it.
const yml = read('.github/workflows/build.yml').split(/\r?\n/);
const jobs = [];
let inJobs = false;
yml.forEach(function (l) {
  if (/^jobs:\s*$/.test(l)) { inJobs = true; return; }
  if (!inJobs) return;
  if (/^\S/.test(l) && !/^#/.test(l)) { inJobs = false; return; }
  const job = /^  ([A-Za-z0-9_-]+):\s*$/.exec(l);
  if (job) { jobs.push({ id: job[1], name: null }); return; }
  const nm = /^    name:\s*["']?(.+?)["']?\s*$/.exec(l);
  if (nm && jobs.length && jobs[jobs.length - 1].name === null) jobs[jobs.length - 1].name = nm[1];
});
// No check is required since 25 September (the build check on GitHub is off),
// but the job keeps its name, so turning the requirement back on is one setting.
// #1306: the hosted job is the build, the only one since #4983.
// #3182: "tested" builds nothing; it only asks whether a pull request build
// already passed main's tree, and the build job waits for its answer.
// 31 Oct 2026: "gate" runs the gate harnesses in shares beside the build;
// the required "Build check result" (#3683, build-pr.yml) needs both.
// #5183: "pick" builds nothing; it says what each share of the gate runs.
// #5295: "report" builds nothing either; it merges the shares' reports.
// #5310, #5360: "gate-linux" is the gate's shares that run on Linux, and
// "checks" the tree checks that need no Windows; neither builds (#5386).
const NOT_BUILDS = ['tested', 'pick', 'gate', 'gate-linux', 'report', 'checks'];
const main = jobs.filter(function (j) { return NOT_BUILDS.indexOf(j.id) < 0; });
yes('build.yml has exactly one build job beside its gate and checks (found ' + main.length + ': ' + main.map(function (j) { return j.id; }).join(', ') + ')', main.length === 1);
// The required check of a pull request needs every job of build-pr.yml
// whose failure must stop a merge: all of them but the report, which only
// merges the shares' reports, and itself.
const prYml = read('.github/workflows/build-pr.yml');
const prJobs = (prYml.match(/^  [A-Za-z0-9_-]+:\s*$/gm) || []).map(function (l) { return l.trim().replace(/:$/, ''); })
  .filter(function (id) { return ['pull_request', 'merge_group', 'workflow_dispatch'].indexOf(id) < 0; });
const resNeeds = /\n    name: Build check result\n    needs: \[([^\]]*)\]\n/.exec(prYml);
const needs = resNeeds ? resNeeds[1].split(',').map(function (x) { return x.trim(); }).sort() : [];
const want = prJobs.filter(function (id) { return id !== 'result' && id !== 'report'; }).sort();
yes('  and the required check of a pull request needs every job but the report (needs ' + needs.join(', ') + '; jobs ' + want.join(', ') + ')',
  needs.length > 0 && needs.join(',') === want.join(',') && needs.indexOf('launcher') >= 0 && needs.indexOf('gate') >= 0);
const CHECK = main.length ? main[0].name : null;
yes('that job is named "Launcher builds" (found "' + CHECK + '")', CHECK === 'Launcher builds');

// ------------------------------------------------------------ Ship.ps1
// Every git call in a PowerShell script, with the repository it acts on. A
// call with -C names its own; a call without one acts on wherever the script
// is standing, which is the source repository unless a Push-Location says
// otherwise.
const WRITES = /^(add|commit|push|reset|checkout|switch|merge|rebase|tag|rm|mv|stash|cherry-pick|revert|apply|am|restore)$/;
function gitCalls(src) {
  const out = [];
  let here = null;
  let block = false;
  src.split(/\r?\n/).forEach(function (l, i) {
    if (block) { if (/#>/.test(l)) block = false; return; }
    if (/^\s*<#/.test(l)) { if (!/#>/.test(l)) block = true; return; }
    if (/^\s*#/.test(l)) return;
    const pl = /Push-Location\s+(\$\w+)/.exec(l);
    if (pl) here = pl[1];
    const re = /&\s*git\s+(?:-C\s+(\$\w+)\s+)?([a-z-]+)(.*)/g;
    let m;
    while ((m = re.exec(l))) {
      out.push({ line: i + 1, repo: m[1] || here || '$RepoDir', sub: m[2], rest: m[3], text: l.trim() });
    }
    if (/Pop-Location/.test(l)) here = null;
  });
  return out;
}
function sourceWrites(calls) {
  return calls.filter(function (c) {
    return WRITES.test(c.sub) && (c.repo === '$RepoDir' || c.repo === '$Here');
  });
}

// The parser has to catch the thing it is here for, so it is shown the lines
// Ship used to end with before it is trusted with the real file.
const oldShip = [
  '& git -C $RepoDir add -A 2>&1 | Out-Null',
  '& git -C $RepoDir commit -m $Notes 2>&1 | Out-Null',
  'Push-Location $RepoDir',
  '& git push 2>&1 | Out-Null',
  'Pop-Location',
  'Push-Location $devRel',
  '& git push -u origin HEAD 2>&1 | Out-Null',
  'Pop-Location'
].join('\n');
yes('the check flags the three source writes Ship used to end with, and not the dev feed push',
    sourceWrites(gitCalls(oldShip)).length === 3);

const shipSrc = read('scripts/release/Ship.ps1');
const ship = gitCalls(shipSrc);
const shipReads = ship.filter(function (c) { return c.repo === '$RepoDir' && !WRITES.test(c.sub); });
const shipAnyWrite = ship.filter(function (c) { return WRITES.test(c.sub); });
yes('Ship.ps1 reads the source repository before a main release (' + shipReads.length + ' git calls: branch, status, fetch, ahead and behind)',
    shipReads.length >= 4);
// Until 28 September Ship also pushed the dev feed in a clone of the releases
// repository, which this counted to show the parser sees a write when there is
// one. That repository is gone and Ship records a release on the VPS
// (Feed-Store.ps1), so Ship has no git write anywhere; the parser is shown the
// old lines above instead.
shipAnyWrite.forEach(function (c) { console.log('      Ship.ps1:' + c.line + '  ' + c.text); });
yes('Ship.ps1 makes no git write in any repository, now that the releases clone is gone (' + shipAnyWrite.length + ')',
    shipAnyWrite.length === 0);
const shipBad = sourceWrites(ship);
shipBad.forEach(function (c) { console.log('      Ship.ps1:' + c.line + '  ' + c.text); });
yes('Ship.ps1 never adds, commits, pushes or moves a branch in the source repository', shipBad.length === 0);
yes('Ship.ps1 has no git add -A anywhere', !/&\s*git\s+(?:-C\s+\$\w+\s+)?add\s+-A/.test(shipSrc));
yes('Ship.ps1 refuses a main release with anything uncommitted', /uncommitted change\(s\)\. A release ships what is on GitHub/.test(shipSrc));
// The ahead refusal used to say "Run git push first". main refuses that push
// from everybody, so since #253 it sends people through a pull request, and
// the documents say so.
yes('Ship.ps1 refuses a main release that is ahead of origin/main, and sends it through a pull request rather than a push',
    // origin/$branch since the hotfix path (24 September): the same refusal,
    // naming whichever branch is shipping, main or hotfix/...
    /ahead of origin\/(main|\$branch)\. A release has to be buildable[\s\S]{0,300}?through a pull request/.test(shipSrc) &&
    !/ahead of origin\/(main|\$branch)\. Run git push first/.test(shipSrc));
yes('Ship.ps1 refuses a main release with a file in a folder a release is built from that git does not know, which both documents now name',
    // Since phase 0 of the reorganisation (issue #440) the gate also looks at
    // the other folders a release is built from, and says so; since phase 10
    // (#1151) tools\ is gone and the refusal names only those folders.
    /file\(s\) in a folder a release is built from that git does not know about/.test(shipSrc));

// ------------------------------------------------------------ the launcher's number
// Bump-Version.ps1 is gone (#5179): the launcher's number is worked out from
// git (scripts/release/LauncherVersion.ps1), so no script commits it.
yes('Bump-Version.ps1 is gone: nothing commits the launcher\'s number',
    !fs.existsSync(path.join(ROOT, 'scripts/release/Bump-Version.ps1')));
yes('LauncherVersion.ps1 runs no git command that writes',
    !gitCalls(read('scripts/release/LauncherVersion.ps1')).some(function (c) { return /^(add|commit|push|tag|update-ref)$/.test(c.sub); }));

// ------------------------------------------------------------ CODEOWNERS
const coRaw = read('.github/CODEOWNERS');
// The whole guide, the index and its pages (tests/guide-text.js): these rules sit on several pages.
const claudeRaw = require('./guide-text.js').whole();
const rules = coRaw.split(/\r?\n/).filter(function (l) { return l.trim() && !/^\s*#/.test(l); })
  .map(function (l) { const p = l.trim().split(/\s+/); return { path: p[0], owners: p.slice(1) }; });
yes('CODEOWNERS has rules to read (' + rules.length + ')', rules.length >= 6);
const missing = rules.filter(function (r) {
  return !fs.existsSync(path.join(ROOT, r.path.replace(/^\//, '').replace(/\/$/, '')));
});
missing.forEach(function (r) { console.log('      no such path: ' + r.path); });
yes('every path CODEOWNERS names exists, since GitHub ignores a wrong one in silence', missing.length === 0);
// The guide no longer lists people. The owners on the six shared files are the
// set every other CODEOWNERS line has to stay inside.
const sharedRuleNames = ['Shell.cs', 'Checks.cs', 'Keep.cs', 'Hold.cs', 'Updater.cs', 'Publish-Update.ps1'];
const sharedRules = rules.filter(function (r) { return sharedRuleNames.indexOf(path.posix.basename(r.path)) >= 0; });
const TEAM = sharedRules.length ? sharedRules[0].owners.filter(function (o) {
  return sharedRules.every(function (r) { return r.owners.indexOf(o) >= 0; });
}) : [];
yes('the six shared files name one shared set of owners (' + TEAM.join(' ') + ')',
    sharedRules.length === 6 && TEAM.length >= 1 && sharedRules.every(function (r) {
      return r.owners.length === TEAM.length && TEAM.every(function (o) { return r.owners.indexOf(o) >= 0; });
    }));
const badOwner = [];
rules.forEach(function (r) {
  if (!r.owners.length) badOwner.push(r.path + ' has no owner');
  r.owners.forEach(function (o) { if (TEAM.indexOf(o) < 0) badOwner.push(r.path + ' ' + o); });
});
badOwner.forEach(function (b) { console.log('      ' + b); });
yes('every CODEOWNERS owner is one of the owners on the six shared files', badOwner.length === 0);

const shared = /An edit to ([\s\S]*?) that blocks others' work gets a line in #dev-coordination/.exec(claudeRaw);
const sharedNames = shared ? shared[1].replace(/\s+/g, ' ').split(/,\s*|\s+or\s+/).map(function (s) { return s.trim(); }).filter(Boolean) : [];
yes('The guide lists the six shared files (' + sharedNames.join(', ') + ')', sharedNames.length === 6);
const uncovered = sharedNames.filter(function (n) {
  return !rules.some(function (r) { return path.posix.basename(r.path) === n && TEAM.every(function (o) { return r.owners.indexOf(o) >= 0; }); });
});
uncovered.forEach(function (n) { console.log('      not in CODEOWNERS for the whole team: ' + n); });
yes('each of the six shared files has a CODEOWNERS line naming the whole team (' + TEAM.join(' ') + ')', sharedNames.length === 6 && uncovered.length === 0);

// ------------------------------------------------------------ the documents
const docs = [
  { name: 'The guide', text: flat(claudeRaw, false) },
  { name: '.github/CODEOWNERS', text: flat(coRaw, true) }
];
const PROTECTION = 'gh api repos/ThornswoodRP/Thornswood/branches/main/protection';

docs.forEach(function (d) {
  const t = d.text;
  yes(d.name + ' says enforce_admins is off', /enforce_admins is off\b/.test(t));
  yes(d.name + ' says there is no required check', /there is no required check/.test(t));
  yes(d.name + ' says required approving reviews is 0', /required approving reviews is (0|zero)\b/i.test(t));
  yes(d.name + ' says the code owner review is off', /code owner review is off|Require review from Code Owners is off/i.test(t));
  yes(d.name + ' gives the command that reads the live settings', t.indexOf(PROTECTION) !== -1);

  // What stopped being true. Ship writes nothing to the source repository,
  // and nobody pushes straight to main.
  yes(d.name + ' does not say a Ship commits and pushes the source',
      !/commits and pushes the source|commits the source and push/i.test(t));
  yes(d.name + ' does not describe work going straight to main', !/(goes|going) straight to main/i.test(t));
});

// #5182 (Patrick's A, 31 Oct 2026): auto-merge is on, and a pull request
// merges once main's ruleset's required check is green. The guide says so,
// gives the command, and no longer says auto-merge is off.
const guideText = docs[0].text;
yes('The guide says auto-merge is on (#5182)', /auto-merge is on/i.test(guideText));
yes('The guide gives gh pr merge --auto --squash', guideText.indexOf('gh pr merge --auto --squash') !== -1);
yes('The guide does not say auto-merge is off', !/auto-merge is off/i.test(guideText));
yes('The guide says main\'s ruleset requires Build check result', /ruleset[^.]*requires[^.]*Build check result/.test(guideText));

// #5296 (the redesign's part 5, Patrick's A on 31 Oct 2026): main's ruleset
// requires the merge queue, squash, each pull request passing on its own, and
// the guide says auto-merge puts a green pull request in it.
const settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'github-repo-settings.json'), 'utf8'));
const mainRules = ((((settings.repositories || []).find(r => r.repository === 'ThornswoodRP/Thornswood') || {}).rulesets || []).find(r => r.name === 'main') || {}).rules || [];
const mq = mainRules.find(r => r && r.type === 'merge_queue');
const mqp = (mq && mq.parameters) || {};
yes('main\'s ruleset requires the merge queue (#5296)', !!mq);
yes('  squash, each pull request passing on its own, merging as soon as one passes',
    mqp.merge_method === 'SQUASH' && mqp.grouping_strategy === 'ALLGREEN' && mqp.min_entries_to_merge === 1 && mqp.min_entries_to_merge_wait_minutes === 0);
yes('  with every setting GitHub needs given',
    ['max_entries_to_build', 'max_entries_to_merge', 'check_response_timeout_minutes'].every(k => Number.isInteger(mqp[k]) && mqp[k] > 0));
yes('The guide says auto-merge puts a green pull request in the merge queue', /puts it in the merge queue/.test(guideText));

const sd = docs[0].text;
// #3617. While enforce_admins is off, "GitHub refuses it" is true only for
// write access. These are the lines that said it of everybody.
[
  [/GitHub refuses it[.;]/, '"GitHub refuses it." of a push to main, with nobody named'],
  [/Main refuses a force push\./, '"Main refuses a force push." with nobody named'],
  [/stopped holding the moment it went on/, 'that enforce_admins went on and stayed on'],
  [/went on, because Ship writes nothing/, 'that enforce_admins went on, as if it still is'],
  [/refuses a push from everybody/i, 'that main refuses a push from everybody']
].forEach(function (b) {
  yes('The guide does not say ' + b[1], !b[0].test(sd));
});
yes('The guide says GitHub holds an admin to none of main\'s rules while enforce_admins is off',
    /enforce_admins off, GitHub holds an admin to none of main's rules/.test(sd));
yes('The guide says for whom a push to main is refused: write access, not the admin account',
    /GitHub refuses a push to main from write access\. It does not refuse one from the admin account/.test(sd) &&
    /GitHub refuses it from write access; from the admin account it does not/.test(sd));
yes('The guide says for whom a force push to main is refused',
    /Never force push main: GitHub refuses it from write access, but not from the admin account/.test(sd));
yes('Ship.ps1 does not say main refuses a push from everybody',
    !/refuses a push from everybody|refuses a\s+#?\s*push from everybody/i.test(flat(shipSrc, true)));
yes('The guide does not say Ship bumps the version; it says the version comes from the build (#5179)',
    !/Ship bumps/i.test(sd) && /## The version comes from the build/.test(sd) && /LauncherVersion\.ps1/.test(sd));
yes('The guide does not say Ship patches the client; it checks it with Sync-Client.ps1 -Check',
    !/patches the client/i.test(sd) && /Sync-Client\.ps1 -Check/.test(sd));
yes('The guide does not say the other person reads every pull request, which nothing enforces',
    !/The other person reads the pull request/i.test(sd));
yes('The guide says Patrick\'s own work goes through a pull request too',
    /Every change goes through a pull request, Patrick's included/.test(sd));
[docs[0]].forEach(function (d) {
  // scripts\ and the other folders a release is built from since phase 8 of #440.
  yes(d.name + ' says a main release stops on a file git does not know, as Ship.ps1 does',
      /file under `?(tools|scripts)`?[\s\S]{0,80}?that git does not know/.test(d.text));
});

// ------------------------------------------------------------ --live
if (!LIVE) {
  console.log('SKIP  the live settings on GitHub; run with --live to read them with gh');
} else {
  let p = null;
  try {
    p = JSON.parse(execSync(PROTECTION, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'));
  } catch (e) {
    console.log('      ' + String(e.message).split('\n')[0]);
  }
  yes('gh read branch protection on main', !!p);
  if (p) {
    const checks = (p.required_status_checks && p.required_status_checks.contexts) || [];
    const reviews = p.required_pull_request_reviews || {};
    yes('live: enforce_admins is off, as the documents say', !(p.enforce_admins && p.enforce_admins.enabled));
    yes('live: there is no required check (GitHub says ' + JSON.stringify(checks) + ')', checks.length === 0);
    yes('live: required approving reviews is 0 (GitHub says ' + reviews.required_approving_review_count + ')',
        (reviews.required_approving_review_count || 0) === 0);
    yes('live: the code owner review is off', !reviews.require_code_owner_reviews);
    yes('live: force pushes are refused', !(p.allow_force_pushes && p.allow_force_pushes.enabled));
    yes('live: deleting main is refused', !(p.allow_deletions && p.allow_deletions.enabled));
    yes('live: write access has to come through a pull request, as the documents say', !!p.required_pull_request_reviews);
  }
  // Rulesets hold an admin whatever enforce_admins says, so the guide's "GitHub
  // holds an admin to none of main's rules" is true only while none reaches main.
  let rs = null;
  try {
    rs = JSON.parse(execSync('gh api repos/ThornswoodRP/Thornswood/rules/branches/main', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8'));
  } catch (e) {
    console.log('      ' + String(e.message).split('\n')[0]);
  }
  yes('gh read the ruleset rules on main', Array.isArray(rs));
  if (Array.isArray(rs)) {
    // Since 31 Oct 2026 (#3683) main's ruleset requires Build check result
    // and holds the admin too; auto-merge (#5182) leans on it.
    const required = rs.filter(function (r) { return r.type === 'required_status_checks'; })
      .some(function (r) { return ((r.parameters && r.parameters.required_status_checks) || []).some(function (c) { return c.context === 'Build check result'; }); });
    yes('live: main\'s ruleset requires Build check result (GitHub says ' +
        JSON.stringify(rs.map(function (r) { return r.type; })) + ')', required);
  }
  let auto = null;
  try {
    auto = execSync('gh api repos/ThornswoodRP/Thornswood --jq .allow_auto_merge', { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString('utf8').trim();
  } catch (e) { }
  yes('live: auto-merge is on, as the guide says (#5182; GitHub says ' + auto + ')', auto === 'true');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
