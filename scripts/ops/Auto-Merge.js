// Puts every open pull request on auto-merge, and puts back one the merge
// queue let go for a reason that was not the pull request's own (Patrick,
// 2 Nov 2026: "Every green PR must merge without anyone touching it: every
// PR goes on auto-merge when it opens, dropped PRs go back in the queue").
//
// .github/workflows/auto-merge.yml runs it from main, with that run's own
// token, after every build of a pull request, after every push to main and
// by hand. It never reads a pull request's code. The merge queue lands each
// one once main's ruleset is satisfied, so turning auto-merge on is all it
// does: no merge, no push, no comment.
//
// A pull request is put on auto-merge when it is open, not a draft, from
// this repository, not somebody's whose work is hands off (HANDS_OFF), not
// already on auto-merge or in the queue, and has no conflict with main.
//
// One labelled OUTSIDE_LABEL is left off too: it carries the work of
// somebody outside the team, and that merges only when Patrick says so for
// that person (8 Nov 2026: "don't ever let them auto merge tho unless I saw
// that even if the PR is good unless I specficallyt say that I want that
// person to automerge"). A fork's own pull request is already left off.
//
// Two are left off (Patrick's yes on Bramble's card, 2 Nov 2026, "Add the two
// skips"). One that changes what runs on the live box, unless it is
// Patrick's: a workflow, the deploy gate, a verb list or a script a verb runs
// (BOX_DIRS, VERB_LISTS and the scripts main's two verb lists name). And a
// Bot's (BOT_BRANCH) without Bramble's approving review at its head commit:
// Bramble reviews the Bots' work and turns auto-merge on for it itself.
//
// One the queue let go stays off when it was let go at the commit it is on
// now for a reason of its own: a failed check of the queue's merge of it, a
// conflict, or a person taking it out. Putting that back unchanged would only run the same failure
// again, so it is its owner's (Bramble hands it back with the run's link,
// bramble-duties section 2), and a new push puts it on again. One let go for
// anything else (the queue cleared or rolled back, a check that never
// started in time, a rule that changed) goes back on now.
//
//     node scripts/ops/Auto-Merge.js            (GH_TOKEN and REPO set)
//     node scripts/ops/Auto-Merge.js --dry-run  (says what it would do)
'use strict';

const HANDS_OFF = ['WiccanDjinn', 'Jhinswife'];
// GitHub's reasons (the pull_request "dequeued" event's list) for letting a
// pull request go that are not the pull request's own doing: the queue was
// cleared or rolled back, its check never came back in time, a rule
// changed, or GitHub could not reach it. Every other reason (a failed
// check, a conflict, a bad merge, taken out by hand, unknown) is its
// owner's to answer.
const NOT_ITS_OWN = /queue.?cleared|roll.?back|time.?out|timed out|branch.?protection|unreachable/i;

// What runs on the live box: every workflow, the deploy gate, the two verb
// lists, and each script a verb of theirs runs (verbScripts reads them).
const BOX_DIRS = ['.github/workflows/', 'scripts/vps/gate/'];
const VERB_LISTS = ['scripts/vps/gate/verbs.json', 'scripts/release/nexus-verbs.json'];
const PATRICK = 'EvilPatrick06';
const OUTSIDE_LABEL = 'outside work';
// A Bot's branch, as the Bots' policy names it (Thornswood-Hermes
// policy.yaml, branches.pattern), and Bramble's App, whose review counts.
const BOT_BRANCH = /^(bramble|rift|sprocket|echo|magpie|wisp)\/[0-9]+-[a-z0-9][a-z0-9-]{0,60}$/;
const BRAMBLE = /^thornswood-bramble(\[bot\])?$/;

// The scripts main's verb lists name, read from the checkout.
function verbScripts(root) {
  const fs = require('fs');
  const path = require('path');
  const out = [];
  for (const f of VERB_LISTS) {
    const verbs = JSON.parse(fs.readFileSync(path.join(root, f), 'utf8')).verbs || {};
    for (const k of Object.keys(verbs)) { if (verbs[k].script) out.push(verbs[k].script); }
  }
  return out;
}

// The files it changes that run on the box.
function boxFiles(paths, scripts) {
  return paths.filter((p) => BOX_DIRS.some((d) => p.indexOf(d) === 0) || VERB_LISTS.indexOf(p) >= 0 || scripts.indexOf(p) >= 0);
}

const QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number isDraft isCrossRepository baseRefName headRefName headRefOid mergeable isInMergeQueue
        author { login }
        labels(first: 30) { nodes { name } }
        files(first: 100) { pageInfo { hasNextPage endCursor } nodes { path } }
        reviews(last: 50, states: [APPROVED]) { nodes { author { login } commit { oid } } }
        autoMergeRequest { enabledAt }
        timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT, PULL_REQUEST_COMMIT, HEAD_REF_FORCE_PUSHED_EVENT]) {
          nodes { __typename ... on RemovedFromMergeQueueEvent { createdAt reason } }
        }
      }
    }
  }
}`;

// The rest of a pull request's files, past its first hundred.
const FILES = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) { files(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { path } } }
  }
}`;

const ENABLE = `mutation($id: ID!) {
  enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) {
    pullRequest { number autoMergeRequest { enabledAt } }
  }
}`;

// What to do with one pull request: [true, why] to turn auto-merge on,
// [false, why] to leave it.
// pr.paths is every file it changes; scripts, the verb scripts.
function judge(pr, base, scripts) {
  if (pr.baseRefName !== base) return [false, 'aimed at ' + pr.baseRefName + ', not ' + base];
  if (pr.isDraft) return [false, 'a draft'];
  if (pr.isCrossRepository) return [false, 'from another repository'];
  const who = (pr.author && pr.author.login) || '';
  if (HANDS_OFF.indexOf(who) >= 0) return [false, who + "'s, which is hands off"];
  if (((pr.labels || {}).nodes || []).some((l) => l && l.name === OUTSIDE_LABEL)) {
    return [false, "it carries an outside contributor's work ('" + OUTSIDE_LABEL + "'), which merges only on Patrick's word"];
  }
  if (pr.autoMergeRequest) return [false, 'already on auto-merge'];
  if (pr.isInMergeQueue) return [false, 'already in the queue'];
  if (pr.mergeable === 'CONFLICTING') return [false, 'it conflicts with ' + base + '; its owner brings ' + base + ' in'];
  const box = boxFiles(pr.paths || [], scripts || []);
  if (box.length && who !== PATRICK) {
    return [false, 'it changes what runs on the live box (' + box.slice(0, 3).join(', ') + (box.length > 3 ? ', ...' : '') + '), and only Patrick\'s goes on by itself'];
  }
  if (BOT_BRANCH.test(pr.headRefName || '')) {
    const reviewed = ((pr.reviews || {}).nodes || []).some((r) => r.author && BRAMBLE.test(r.author.login) && r.commit && r.commit.oid === pr.headRefOid);
    if (!reviewed) return [false, "a Bot's, with no approving review of Bramble's at its head; Bramble reviews it and turns auto-merge on"];
  }
  // The newest of its queue drops, commits and force pushes: when that is a
  // drop, the queue let it go at the commit it is on now. (The drop event's
  // beforeCommit is not the pull request's head: on 2 Nov 2026 the first live
  // run put #5393 straight back after a failed check at its own head, #5470.)
  const last = ((pr.timelineItems || {}).nodes || [])[0];
  const drop = last && last.__typename === 'RemovedFromMergeQueueEvent' ? last : null;
  if (drop) {
    if (NOT_ITS_OWN.test(drop.reason || '')) return [true, 'the queue let it go (' + drop.reason + '), which was not its own doing'];
    return [false, 'the queue let it go at this commit (' + (drop.reason || 'no reason given') + '); a push with the fix puts it back'];
  }
  return [true, 'open and ready'];
}

async function sweep(repo, gql, say, opts) {
  const [owner, name] = repo.split('/');
  const base = (opts && opts.base) || 'main';
  const dry = !!(opts && opts.dryRun);
  const scripts = (opts && opts.scripts) || [];
  let after = null, put = 0, refused = 0;
  for (;;) {
    const data = await gql(QUERY, { owner, name, after });
    const page = data.repository.pullRequests;
    for (const pr of page.nodes) {
      const files = pr.files || { nodes: [], pageInfo: {} };
      pr.paths = files.nodes.map((f) => f.path);
      for (let more = files.pageInfo; more && more.hasNextPage;) {
        const next = (await gql(FILES, { owner, name, number: pr.number, after: more.endCursor })).repository.pullRequest.files;
        pr.paths = pr.paths.concat(next.nodes.map((f) => f.path));
        more = next.pageInfo;
      }
      const [on, why] = judge(pr, base, scripts);
      if (!on) { say('#' + pr.number + ' left: ' + why); continue; }
      if (dry) { say('#' + pr.number + ' would go on auto-merge: ' + why); put++; continue; }
      try {
        await gql(ENABLE, { id: pr.id });
        say('#' + pr.number + ' on auto-merge: ' + why);
        put++;
      } catch (e) {
        // GitHub's own refusal, said as it was given; the next run looks again.
        say('#' + pr.number + ' refused by GitHub: ' + e.message);
        refused++;
      }
    }
    if (!page.pageInfo.hasNextPage) break;
    after = page.pageInfo.endCursor;
  }
  say(put + ' put on auto-merge, ' + refused + ' refused');
  return refused ? 1 : 0;
}

function github(token) {
  return async (query, variables) => {
    const r = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'User-Agent': 'thornswood-auto-merge' },
      body: JSON.stringify({ query, variables }),
    });
    const body = await r.json().catch(() => ({}));
    if (r.status !== 200 || body.errors) {
      throw new Error('HTTP ' + r.status + ': ' + ((body.errors || []).map(x => x.message).join('; ') || JSON.stringify(body).slice(0, 300)));
    }
    return body.data;
  };
}

module.exports = { judge, sweep, verbScripts, boxFiles, HANDS_OFF, OUTSIDE_LABEL, NOT_ITS_OWN, BOX_DIRS, VERB_LISTS, BOT_BRANCH, QUERY, FILES, ENABLE };

if (require.main === module) {
  const repo = process.env.REPO, token = process.env.GH_TOKEN;
  if (!repo || !token) { console.log('REPO and GH_TOKEN must be set'); process.exit(2); }
  let scripts;
  try { scripts = verbScripts(require('path').join(__dirname, '..', '..')); }
  catch (e) { console.log('the verb lists could not be read, so nothing is put on: ' + e.message); process.exit(1); }
  sweep(repo, github(token), (l) => console.log(l), { dryRun: process.argv.includes('--dry-run'), scripts })
    .then((code) => process.exit(code))
    .catch((e) => { console.log('the open pull requests could not be read: ' + e.message); process.exit(1); });
}
