#!/usr/bin/env node
// Find-Duplicate.js: when an issue is filed, says on it which open issues it
// may repeat (#5185, the redesign's part 5).
//
//   node scripts/ops/Find-Duplicate.js --issue 5301            reads and comments
//   node scripts/ops/Find-Duplicate.js --issue 5301 --dry-run  reads and says
//
// WHY. The same problem gets filed twice when nobody finds the first one:
// 17 issues were closed as duplicates by 1 Nov 2026, found by hand, some of
// them weeks later and after work had gone into both. A new issue is read
// against the open ones the moment it is filed, and a likely repeat is
// linked on it, so whoever triages sees both at once. It never closes,
// labels or edits anything: a person decides.
//
// HOW IT MATCHES. Titles only, since a title here is a whole sentence about
// the problem. Each title becomes its words, less the small ones (the, is,
// when) and the numbers, with a plain ending taken off an ordinary word (runs
// and run match) and a name kept whole. Each word weighs more the fewer open
// titles have it, so "test-page-changed.js" counts for a lot and "launcher"
// for little. Two
// titles score from 0 (no word shared) to 1 (the same words). An open issue
// is named when it scores THRESHOLD or more and shares at least two words;
// at most three are named, best first.
//
// THE THRESHOLD, measured on 1 Nov 2026 against every issue filed from #1500
// to #5300 (1,795 issues), each read against the issues open on the day it
// was filed: at 0.5, 42 got a comment (one filing in 43). 15 of those named
// the same problem (#2025 and #2024, #1686 and #1650, #5300 and #5254), 22 a
// close sibling worth linking (the same fault in another script), and 5
// nothing useful. Of 18 repeats found by reading the list by hand, 0.5 named
// 15; 0.45 named 17 but commented on 72 issues, and 0.6 named 11 on 19.
// Issues closed as duplicates whose titles share almost no words (#1602 and
// #1560) are not found by any title match; this does not pretend to.
//
// The title reaches the script through the environment (TITLE), never pasted
// into a command. The comment is plain, as docs/guide/the-board.md says an issue
// comment is written.
//
// Exits 0 when it has looked (a comment made or none due), 1 when GitHub
// could not be read or written, 2 for a bad argument or a missing setting.

'use strict';

const THRESHOLD = 0.5;
const MOST = 3;

const SMALL = new Set(('a an the and or of to in on for is are be was were it its this that these those with from at by as ' +
  'not no can cannot does do when what which who how so but if then than into out up off one two every each all any some ' +
  'only still now there here their they them we our us you your has have had after before about over under per via just ' +
  'also more most get gets make makes made say says said').split(' '));

// A title's words, once each.
function wordsOf(title) {
  const out = new Set();
  for (let w of String(title || '').toLowerCase().replace(/[`'"’]/g, '').split(/[^a-z0-9]+/)) {
    // A name comes apart at its dots and dashes (test-3147-lines.js is test,
    // 3147, lines and js), so test-3147-lines matches it. A number of three
    // digits or more is kept, since it names something (a test, a port); a
    // shorter one is a count and is left out.
    if (w.length < 2 || SMALL.has(w) || /^\d{1,2}$/.test(w)) continue;
    // An ordinary word loses a plain ending, leaving at least three letters.
    if (/^[a-z]{4,}$/.test(w)) w = w.replace(/(ing|ed|s)$/, m => (w.length - m.length >= 3 ? '' : m));
    out.add(w);
  }
  return [...out];
}

// Each open issue scored against the new title; the ones worth naming, best
// first. open: [{number, title}]. The new issue itself is never named.
function likelyRepeats(number, title, open) {
  const docs = open.filter(i => i.number !== number).map(i => ({ number: i.number, title: i.title, words: wordsOf(i.title) }));
  const mine = wordsOf(title);
  const count = new Map();
  for (const d of docs.concat([{ words: mine }])) for (const w of d.words) count.set(w, (count.get(w) || 0) + 1);
  const n = docs.length + 1;
  const weight = w => Math.log((n + 1) / ((count.get(w) || 0) + 1));
  const size = ws => Math.sqrt(ws.reduce((s, w) => s + weight(w) ** 2, 0));
  const mineSize = size(mine);
  const found = [];
  for (const d of docs) {
    const theirs = new Set(d.words);
    let dot = 0, shared = 0;
    for (const w of mine) if (theirs.has(w)) { dot += weight(w) ** 2; shared++; }
    const both = mineSize * size(d.words);
    const score = both ? dot / both : 0;
    if (shared >= 2 && score >= THRESHOLD) found.push({ number: d.number, title: d.title, score });
  }
  found.sort((x, y) => y.score - x.score || x.number - y.number);
  return found.slice(0, MOST);
}

function commentFor(found) {
  const lines = found.map(f => `- #${f.number} ${f.title}`);
  return [
    found.length === 1 ? 'This may repeat an open issue, or be close to it:' : 'This may repeat one of these open issues, or be close to them:',
    '',
    ...lines,
    '',
    'If it is the same problem, close this one as a duplicate of that one. If not, say here how it differs.',
  ].join('\n');
}

function client(token, fetchImpl) {
  const f = fetchImpl || fetch;
  async function call(method, path, body) {
    const r = await f('https://api.github.com/' + path.replace(/^\//, ''), {
      method,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thornswood-find-duplicate',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`${method} ${path}: ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : null;
  }
  return { call };
}

// Every open issue's number and title, page by page until a short one (the
// issues list mixes in pull requests, which are left out here).
async function openIssues(gh, repo) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const got = await gh.call('GET', `repos/${repo}/issues?state=open&per_page=100&page=${page}`);
    for (const i of got) if (!i.pull_request) out.push({ number: i.number, title: i.title });
    if (got.length < 100) break;
  }
  return out;
}

async function run(argv, env, fetchImpl, say) {
  say = say || (s => console.log(s));
  const at = argv.indexOf('--issue');
  const number = at >= 0 ? Number(argv[at + 1]) : NaN;
  const dry = argv.includes('--dry-run');
  if (!Number.isInteger(number) || number < 1) { say('STOP. --issue <number> is needed.'); return 2; }
  const repo = env.GITHUB_REPOSITORY || '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { say('STOP. GITHUB_REPOSITORY is not owner/name.'); return 2; }
  if (!env.GITHUB_TOKEN) { say('STOP. GITHUB_TOKEN is not set.'); return 2; }
  const gh = client(env.GITHUB_TOKEN, fetchImpl);
  try {
    const title = env.TITLE || (await gh.call('GET', `repos/${repo}/issues/${number}`)).title;
    const open = await openIssues(gh, repo);
    const found = likelyRepeats(number, title, open);
    say(`#${number} "${title}" read against ${open.length} open issue(s): ${found.length ? found.map(f => `#${f.number} (${f.score.toFixed(2)})`).join(', ') : 'none alike'}`);
    if (!found.length) return 0;
    if (dry) { say('dry run, no comment made:\n' + commentFor(found)); return 0; }
    await gh.call('POST', `repos/${repo}/issues/${number}/comments`, { body: commentFor(found) });
    say(`commented on #${number}`);
    return 0;
  } catch (e) {
    say('STOP. ' + e.message);
    return 1;
  }
}

module.exports = { THRESHOLD, MOST, wordsOf, likelyRepeats, commentFor, openIssues, run };

if (require.main === module) {
  run(process.argv.slice(2), process.env).then(code => process.exit(code));
}
