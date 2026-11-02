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

const QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, first: 50, after: $after, orderBy: {field: CREATED_AT, direction: ASC}) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id number isDraft isCrossRepository baseRefName headRefOid mergeable isInMergeQueue
        author { login }
        autoMergeRequest { enabledAt }
        timelineItems(last: 1, itemTypes: [REMOVED_FROM_MERGE_QUEUE_EVENT]) {
          nodes { ... on RemovedFromMergeQueueEvent { createdAt reason beforeCommit { oid } } }
        }
      }
    }
  }
}`;

const ENABLE = `mutation($id: ID!) {
  enablePullRequestAutoMerge(input: {pullRequestId: $id, mergeMethod: SQUASH}) {
    pullRequest { number autoMergeRequest { enabledAt } }
  }
}`;

// What to do with one pull request: [true, why] to turn auto-merge on,
// [false, why] to leave it.
function judge(pr, base) {
  if (pr.baseRefName !== base) return [false, 'aimed at ' + pr.baseRefName + ', not ' + base];
  if (pr.isDraft) return [false, 'a draft'];
  if (pr.isCrossRepository) return [false, 'from another repository'];
  const who = (pr.author && pr.author.login) || '';
  if (HANDS_OFF.indexOf(who) >= 0) return [false, who + "'s, which is hands off"];
  if (pr.autoMergeRequest) return [false, 'already on auto-merge'];
  if (pr.isInMergeQueue) return [false, 'already in the queue'];
  if (pr.mergeable === 'CONFLICTING') return [false, 'it conflicts with ' + base + '; its owner brings ' + base + ' in'];
  const drop = ((pr.timelineItems || {}).nodes || [])[0];
  if (drop && drop.beforeCommit && drop.beforeCommit.oid === pr.headRefOid) {
    if (NOT_ITS_OWN.test(drop.reason || '')) return [true, 'the queue let it go (' + drop.reason + '), which was not its own doing'];
    return [false, 'the queue let it go at this commit (' + (drop.reason || 'no reason given') + '); a push with the fix puts it back'];
  }
  return [true, 'open and ready'];
}

async function sweep(repo, gql, say, opts) {
  const [owner, name] = repo.split('/');
  const base = (opts && opts.base) || 'main';
  const dry = !!(opts && opts.dryRun);
  let after = null, put = 0, refused = 0;
  for (;;) {
    const data = await gql(QUERY, { owner, name, after });
    const page = data.repository.pullRequests;
    for (const pr of page.nodes) {
      const [on, why] = judge(pr, base);
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

module.exports = { judge, sweep, HANDS_OFF, NOT_ITS_OWN, QUERY, ENABLE };

if (require.main === module) {
  const repo = process.env.REPO, token = process.env.GH_TOKEN;
  if (!repo || !token) { console.log('REPO and GH_TOKEN must be set'); process.exit(2); }
  sweep(repo, github(token), (l) => console.log(l), { dryRun: process.argv.includes('--dry-run') })
    .then((code) => process.exit(code))
    .catch((e) => { console.log('the open pull requests could not be read: ' + e.message); process.exit(1); });
}
