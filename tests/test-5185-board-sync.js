// #5185: the board follows what GitHub knows. scripts/ops/Sync-Board.js puts
// each card's Status, Order and the issue's type where the issue and the
// pull requests that name it say, and .github/workflows/board.yml is the one
// workflow that runs it. Offline: the script against a stand-in GitHub, and
// the workflows read from their files. Nothing reaches GitHub.
//
// What is held here:
//   1. the rules: which text names an issue, the Status order (closed or a
//      merged test task is Done, an open pull request or a claim is In
//      Progress, anything else Todo), the order: labels, the type an
//      issue with none gets, and which timeline entries count;
//   2. the script against a stand-in GitHub: one issue, a pull request's
//      issues (with the issues it named before an edit, and itself read
//      fresh), every open issue across pages, a new issue's Order and an
//      order: label carried out, the Order field made once, the old board's
//      Orders copied, an issue already on the board put right through the
//      add that gives back its card (REST's add answers 422 for one, #5185),
//      a dry run that writes nothing, a type somebody set left alone, an
//      issue that fails named and the run red, a board without its Status
//      options refused, and nothing run without its settings;
//   3. the wiring: board.yml runs on issue events for the labels it reads,
//      on pr-events.yml's completion and by hand, on main, in the board
//      environment with the board App's token; pr-events.yml has no token
//      and checks out nothing; the label workflows it replaces are gone;
//   4. the duplicate check on filing (scripts/ops/Find-Duplicate.js and
//      duplicate-check.yml): real pairs from the board are named and real
//      strangers are not, the issue itself never is, at most three, the
//      comment is plain, a dry run writes nothing, GitHub failing is exit 1,
//      and the workflow runs on main with the run's token and the title kept
//      out of the script.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO = path.join(__dirname, '..');
const S = require(path.join(REPO, 'scripts', 'ops', 'Sync-Board.js'));
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }
function read(f) { try { return fs.readFileSync(path.join(REPO, f), 'utf8').split('\r\n').join('\n'); } catch (e) { return ''; } }
const same = (a, b) => JSON.stringify(Array.from(a).sort((x, y) => x - y)) === JSON.stringify(b);
const HERE = 'ThornswoodRP/Thornswood';
const FORK = 'ThornswoodRP/skymp';

// ---- 1. the rules -----------------------------------------------------------
yes('Refs, Closes, Fixes, Resolves and Part of name issues, each of a list',
    same(S.namedIn('Faster boards (Refs #5191, #5196)\nCloses #12 and #13. Fixes #14 & #15\nresolved #16\nPart of #17', HERE, HERE), [12, 13, 14, 15, 16, 17, 5191, 5196]));
yes('a test task names its issue', same(S.namedIn('Test task for #40: Forge lists what you can make\nServer: Main', HERE, HERE), [40]));
yes('a bare #N with no keyword names nothing (a mention is not the work)', same(S.namedIn('Like #12 said, see #13', HERE, HERE), []));
yes('owner/name#N names an issue here from the engine fork', same(S.namedIn('Refs ThornswoodRP/Thornswood#77', HERE, FORK), [77]));
yes('  but a bare #N in the fork\'s pull request is the fork\'s own issue', same(S.namedIn('Refs #5 and Test task for #6: x', HERE, FORK), []));
yes('  and another repository\'s issue is not one here', same(S.namedIn('Fixes other/repo#9', HERE, HERE), []));

const st = (issue, pulls) => S.statusFor(Object.assign({ repo: HERE, number: 10, state: 'open', labels: [] }, issue), pulls || []).status;
const pr = (n, extra) => Object.assign({ repo: HERE, number: n, state: 'open', merged: false, title: 'x', body: 'Refs #10' }, extra || {});
yes('an open issue nothing names is Todo', st({}) === 'Todo');
yes('a closed issue is Done, whatever else', st({ state: 'closed', labels: ['claimed: Wisp'] }, [pr(1)]) === 'Done');
yes('an open pull request naming it makes it In Progress', st({}, [pr(1)]) === 'In Progress');
yes('  a draft one too', st({}, [pr(1, { draft: true })]) === 'In Progress');
yes('  named in the title only, too', st({}, [pr(1, { title: 'Faster (Refs #10)', body: '' })]) === 'In Progress');
yes('an open pull request that names another issue does not', st({}, [pr(1, { body: 'Refs #11' })]) === 'Todo');
yes('a merged pull request with its test task makes it Done',
    st({}, [pr(1, { state: 'closed', merged: true, body: 'Refs #10\n\nTest task for #10: Forge works\nServer: Main\n\n1. Open it' })]) === 'Done');
yes('  but not while another pull request naming it is open',
    st({}, [pr(1, { state: 'closed', merged: true, body: 'Test task for #10: Forge works' }), pr(2)]) === 'In Progress');
yes('a merged pull request that only Refs it leaves it where the rest says (part of the work)',
    st({}, [pr(1, { state: 'closed', merged: true })]) === 'Todo' && st({ labels: ['claimed: Wisp'] }, [pr(1, { state: 'closed', merged: true })]) === 'In Progress');
yes('a pull request closed without merging counts for nothing', st({}, [pr(1, { state: 'closed', body: 'Test task for #10: x' })]) === 'Todo');
yes('a claimed: label makes it In Progress', st({ labels: ['area: launcher', 'claimed: Sprocket'] }) === 'In Progress');
yes('an open engine fork pull request naming it makes it In Progress',
    st({}, [pr(3, { repo: FORK, body: 'Refs ThornswoodRP/Thornswood#10' })]) === 'In Progress');
yes('  but a merged fork pull request\'s test task is not this repository\'s Done',
    st({}, [pr(3, { repo: FORK, state: 'closed', merged: true, body: 'Refs ThornswoodRP/Thornswood#10\nTest task for #10: x' })]) === 'Todo');
yes('it says why', /pull request #1 names it and is open/.test(S.statusFor({ repo: HERE, number: 10, state: 'open', labels: [] }, [pr(1)]).why));

yes('an order: label asks for its number, a decimal too', S.orderFor(['area: bot', 'order: 52.5']).order === 52.5 && S.orderFor([]).order === null);
yes('  two asking for different numbers ask for nothing, and say so', S.orderFor(['order: 3', 'order: 4']).order === null && S.orderFor(['order: 3', 'order: 4']).clash);
yes('  two asking for the same number ask for it, and both come off', S.orderFor(['order: 3', 'Order:3']).order === 3 && S.orderFor(['order: 3', 'Order:3']).labels.length === 2);
yes('  a label that is not a number asks for nothing', S.orderFor(['order: soon', 'reorder: 3']).order === null);
yes('a card\'s number reads however the item answers it', S.numberOf(5) === 5 && S.numberOf('7.5') === 7.5 && S.numberOf({ number: 2 }) === 2 && S.numberOf(null) === null && S.numberOf('') === null);
yes('a typeless issue labelled bug, Dev Findings or Main Findings is a Bug',
    S.typeFor(['bug']) === 'Bug' && S.typeFor(['Dev Findings']) === 'Bug' && S.typeFor(['Main Findings']) === 'Bug');
yes('  one labelled Suggestion a Feature, anything else a Task', S.typeFor(['Suggestion']) === 'Feature' && S.typeFor(['area: site']) === 'Task');

const tl = [
  { event: 'cross-referenced', source: { issue: { number: 1, state: 'open', title: 'a', body: 'Refs #10', pull_request: {}, repository: { full_name: HERE } } } },
  { event: 'cross-referenced', source: { issue: { number: 1, state: 'open', title: 'a', body: 'Refs #10', pull_request: {}, repository: { full_name: HERE } } } },
  { event: 'cross-referenced', source: { issue: { number: 2, state: 'closed', title: 'b', body: '', pull_request: { merged_at: '2026-11-01T00:00:00Z' }, repository: { full_name: FORK } } } },
  { event: 'cross-referenced', source: { issue: { number: 3, state: 'open', title: 'an issue', body: 'Refs #10', repository: { full_name: HERE } } } },
  { event: 'cross-referenced', source: { issue: { number: 4, state: 'open', title: 'c', body: 'Refs ThornswoodRP/Thornswood#10', pull_request: {}, repository: { full_name: 'someone/Thornswood' } } } },
  { event: 'labeled', label: { name: 'P1' } },
];
const got = S.pullsOnTimeline(tl, HERE);
yes('the timeline gives each pull request of the organization once, merged or not',
    got.length === 2 && got.some(p => p.number === 1 && p.state === 'open' && !p.merged) && got.some(p => p.repo === FORK && p.merged));
yes('  never an issue that mentions it, nor a stranger\'s fork', !got.some(p => p.number === 3 || p.number === 4));

// ---- 2. the script against a stand-in GitHub --------------------------------
const OPT = (id, name) => ({ id: id, name: { raw: name, html: name } });
function github(o) {
  const writes = [];
  const reads = [];
  const fields = () => [
    { id: 101, name: 'Status', data_type: 'single_select', options: (o.statuses || ['Todo', 'In Progress', 'Done']).map((n, i) => OPT('s' + i, n)) },
  ].concat(o.order === false ? [] : [{ id: 102, name: 'Order', data_type: 'number' }]);
  async function f(url, init) {
    const method = (init && init.method) || 'GET';
    const p = url.replace('https://api.github.com/', '');
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    const answer = (status, data, link) => ({ ok: status < 400, status: status, text: async () => JSON.stringify(data), headers: { get: k => (k === 'link' ? link || '' : '') } });
    if (method !== 'GET') { writes.push({ method: method, path: p, body: body }); } else { reads.push(p); }
    let m;
    if ((m = /^orgs\/ThornswoodRP\/projectsV2\/7\/fields\?per_page=100$/.exec(p))) { return answer(200, fields()); }
    if (method === 'POST' && p === 'orgs/ThornswoodRP/projectsV2/7/fields') { o.order = true; return answer(201, { id: 102 }); }
    if ((m = /^orgs\/ThornswoodRP\/projectsV2\/7\/items\/(\d+)\?fields=102$/.exec(p))) {
      const had = (o.cardOrder || {})[Number(m[1]) - 9000];
      return answer(200, { id: Number(m[1]), fields: [{ id: 101, name: 'Status', value: null }, { id: 102, name: 'Order', data_type: 'number', value: had === undefined ? null : had }] });
    }
    if (method === 'DELETE' && (m = /^repos\/ThornswoodRP\/Thornswood\/issues\/(\d+)\/labels\/(.+)$/.exec(p))) { return answer(o.labelGone ? 404 : 200, []); }
    if (/^users\/EvilPatrick06\/projectsV2\/1\/fields\?per_page=100$/.test(p)) {
      return answer(200, [{ id: 201, name: 'Status', data_type: 'single_select', options: ['Todo', 'In Progress', 'Done'].map((n, i) => OPT('o' + i, n)) }].concat(o.oldOrder === false ? [] : [{ id: 202, name: 'Order', data_type: 'number' }]));
    }
    if (/^users\/EvilPatrick06\/projectsV2\/1\/items\?fields=202&per_page=100$/.test(p)) { return answer(200, o.oldItems || []); }
    // This board's cards, two a page, the way GitHub pages them.
    if ((m = /^orgs\/ThornswoodRP\/projectsV2\/7\/items\?fields=102&per_page=100(&page=(\d+))?$/.exec(p))) {
      const page = Number(m[2] || 1);
      const all = o.newItems || [];
      const next = page * 2 < all.length ? '<https://api.github.com/orgs/ThornswoodRP/projectsV2/7/items?fields=102&per_page=100&page=' + (page + 1) + '>; rel="next"' : '';
      return answer(200, all.slice((page - 1) * 2, page * 2), next);
    }
    if (p === 'orgs/ThornswoodRP/projectsV2/7') { return answer(200, { id: 7, number: 7, node_id: 'PVT_7' }); }
    if (p === 'users/EvilPatrick06/projectsV2/1') { return answer(200, { id: 1, number: 1, node_id: 'PVT_old' }); }
    // GitHub's REST add refuses an issue already on the board (422) and
    // names no card; GraphQL's add gives back the card already there.
    if (method === 'POST' && p === 'orgs/ThornswoodRP/projectsV2/7/items') { return answer(422, { message: 'Content already exists in this project' }); }
    if (method === 'POST' && p === 'graphql') {
      if (o.graphqlRefused) { return answer(200, { data: null, errors: [{ message: o.graphqlRefused }] }); }
      const n = Number(String(body.variables.content).replace('I_', ''));
      if (!/addProjectV2ItemById/.test(body.query) || body.variables.project !== 'PVT_7' || !n) { return answer(200, { errors: [{ message: 'the stand-in was not asked for that' }] }); }
      o.added = (o.added || []).concat(o.onBoard && o.onBoard.indexOf(n) >= 0 ? [] : [n]);
      return answer(200, { data: { addProjectV2ItemById: { item: { databaseId: 9000 + n } } } });
    }
    if (method === 'PATCH' && (m = /^orgs\/ThornswoodRP\/projectsV2\/7\/items\/(\d+)$/.exec(p))) { return answer(200, { id: Number(m[1]) }); }
    if (method === 'PATCH' && (m = /^repos\/ThornswoodRP\/Thornswood\/issues\/(\d+)$/.exec(p))) { return answer(200, {}); }
    if ((m = /^repos\/ThornswoodRP\/Thornswood\/issues\/(\d+)\/timeline\?per_page=100$/.exec(p))) { return answer(200, (o.timelines || {})[m[1]] || []); }
    if ((m = /^repos\/ThornswoodRP\/Thornswood\/issues\/(\d+)$/.exec(p))) {
      const i = (o.issues || {})[m[1]];
      if (!i || o.broken === Number(m[1])) { return answer(o.broken === Number(m[1]) ? 502 : 404, { message: 'Not Found' }); }
      return answer(200, Object.assign({ node_id: 'I_' + m[1] }, i));
    }
    if ((m = /^repos\/ThornswoodRP\/Thornswood\/pulls\/(\d+)$/.exec(p))) { return answer(200, (o.pulls || {})[m[1]]); }
    if ((m = /^repos\/ThornswoodRP\/Thornswood\/issues\?state=open&per_page=100(&page=(\d+))?$/.exec(p))) {
      const page = Number(m[2] || 1);
      const all = o.open || [];
      const next = page * 2 < all.length ? '<https://api.github.com/repos/ThornswoodRP/Thornswood/issues?state=open&per_page=100&page=' + (page + 1) + '>; rel="next"' : '';
      return answer(200, all.slice((page - 1) * 2, page * 2), next);
    }
    return answer(404, { message: 'the stand-in was not asked for ' + method + ' ' + p });
  }
  f.writes = writes; f.reads = reads;
  return f;
}
const ENV = { GITHUB_REPOSITORY: HERE, BOARD_OWNER: 'ThornswoodRP', BOARD_NUMBER: '7', BOARD_TOKEN: 't' };
const issue = (n, extra) => Object.assign({ number: n, node_id: 'I_' + n, state: 'open', labels: [], type: { name: 'Task' } }, extra || {});
const xref = (n, extra) => ({ event: 'cross-referenced', source: { issue: Object.assign({ number: n, state: 'open', title: 'x', body: 'Refs #10', pull_request: {}, repository: { full_name: HERE } }, extra || {}) } });
async function go(argv, o, env) {
  const lines = [];
  const g = github(o);
  const code = await S.run(argv, Object.assign({}, ENV, env || {}), g, s => lines.push(String(s)));
  return { code: code, lines: lines, out: lines.join('\n'), writes: g.writes, reads: g.reads, added: o.added || [] };
}
const fieldWrite = (w, n) => w.find(x => x.method === 'PATCH' && x.path === 'orgs/ThornswoodRP/projectsV2/7/items/' + (9000 + n));
const restAdd = w => w.some(x => x.method === 'POST' && /projectsV2\/\d+\/items$/.test(x.path));
const cardAdd = (w, n) => w.find(x => x.method === 'POST' && x.path === 'graphql' && x.body.variables.content === 'I_' + n && x.body.variables.project === 'PVT_7');

(async () => {
  let r = await go(['--issues', '10'], { issues: { 10: issue(10) }, timelines: { 10: [xref(55)] }, cardOrder: { 10: 52.5 } });
  let w = fieldWrite(r.writes, 10);
  yes('one issue: its card is added and set to In Progress, and the Order it has is kept: ' + r.lines[0], r.code === 0 &&
      cardAdd(r.writes, 10) && same(r.added, [10]) &&
      w && JSON.stringify(w.body) === JSON.stringify({ fields: [{ id: 101, value: 's1' }] }));
  yes('  the card is added the way that gives back one already there, never by REST\'s add (422 for a card on the board)', !restAdd(r.writes));
  r = await go(['--issues', '10'], { issues: { 10: issue(10) }, onBoard: [10], cardOrder: { 10: 52.5 } });
  yes('an issue already on the board: its card is the one there, put right, nothing added and no failure: ' + r.lines[0], r.code === 0 &&
      r.added.length === 0 && !restAdd(r.writes) && fieldWrite(r.writes, 10) && JSON.stringify(fieldWrite(r.writes, 10).body.fields) === JSON.stringify([{ id: 101, value: 's0' }]));
  r = await go(['--issues', '10'], { issues: { 10: issue(10) }, graphqlRefused: 'Resource not accessible by integration' });
  yes('  GraphQL\'s errors in a 200 answer are a failure, named, and nothing is written to the card: ' + r.lines[0], r.code === 1 &&
      /#10: not put right: GraphQL answered: Resource not accessible/.test(r.out) && !fieldWrite(r.writes, 10));
  yes('  a type somebody set is left as it is', !r.writes.some(x => x.path === 'repos/ThornswoodRP/Thornswood/issues/10'));
  r = await go(['--issues', '11'], { issues: { 11: issue(11, { type: null, labels: [{ name: 'Suggestion' }] }) } });
  w = fieldWrite(r.writes, 11);
  yes('an issue with no type gets one, Todo, and an open card with no Order gets 10000 plus its number: ' + r.lines[0], r.code === 0 &&
      r.writes.some(x => x.method === 'PATCH' && x.path === 'repos/ThornswoodRP/Thornswood/issues/11' && x.body.type === 'Feature') &&
      w && JSON.stringify(w.body.fields) === JSON.stringify([{ id: 101, value: 's0' }, { id: 102, value: 10011 }]) && /Order 10011 \(it had none\)/.test(r.lines[0]));
  r = await go(['--issues', '12'], { issues: { 12: issue(12, { state: 'closed' }) } });
  yes('a closed issue goes to Done, and its Order is not read or given', JSON.stringify(fieldWrite(r.writes, 12).body.fields) === JSON.stringify([{ id: 101, value: 's2' }]) &&
      !r.reads.some(p => /items\/9012\?/.test(p)));
  r = await go(['--issues', '14'], { issues: { 14: issue(14, { labels: [{ name: 'order: 52.5' }, { name: 'bug' }] }) }, cardOrder: { 14: 10014 } });
  w = fieldWrite(r.writes, 14);
  yes('an order: label sets the card\'s Order, then comes off: ' + r.lines[0], r.code === 0 &&
      w && JSON.stringify(w.body.fields) === JSON.stringify([{ id: 101, value: 's0' }, { id: 102, value: 52.5 }]) &&
      r.writes.filter(x => x.method === 'DELETE').map(x => x.path).join() === 'repos/ThornswoodRP/Thornswood/issues/14/labels/order%3A%2052.5' &&
      r.writes.indexOf(w) < r.writes.findIndex(x => x.method === 'DELETE'));
  r = await go(['--issues', '14'], { issues: { 14: issue(14, { labels: [{ name: 'order: 3' }] }) }, labelGone: true });
  yes('  a label somebody already took off is no failure', r.code === 0 && fieldWrite(r.writes, 14).body.fields[1].value === 3);
  r = await go(['--issues', '14'], { issues: { 14: issue(14, { labels: [{ name: 'order: 3' }, { name: 'order: 4' }] }) }, cardOrder: { 14: 20 } });
  yes('  two that disagree: the Order and the labels stay, and it says so: ' + r.lines[0], r.code === 0 &&
      JSON.stringify(fieldWrite(r.writes, 14).body.fields) === JSON.stringify([{ id: 101, value: 's0' }]) && !r.writes.some(x => x.method === 'DELETE') && /disagree/.test(r.lines[0]));

  r = await go(['--pull', '55'], {
    pulls: { 55: { number: 55, state: 'open', merged_at: null, title: 'Faster (Refs #10)', body: 'Test task for #12: x\nServer: Main' } },
    issues: { 10: issue(10), 12: issue(12), 13: issue(13) },
    timelines: { 10: [], 12: [], 13: [xref(55, { body: 'Refs #13' })] },
  }, { EARLIER_ISSUES: '13 10' });
  yes('a pull request: every issue it names, and those it named before an edit: ' + r.lines[0],
      r.code === 0 && /names #10, #12/.test(r.lines[0]) && fieldWrite(r.writes, 10) && fieldWrite(r.writes, 12) && fieldWrite(r.writes, 13));
  yes('  the pull request read just now stands in for its timeline entry, not there yet',
      fieldWrite(r.writes, 10).body.fields[0].value === 's1' && fieldWrite(r.writes, 12).body.fields[0].value === 's1');
  yes('  and an issue the edit took out goes back to Todo, whatever its old timeline entry said',
      fieldWrite(r.writes, 13).body.fields[0].value === 's0');
  r = await go(['--pull', '56'], {
    pulls: { 56: { number: 56, state: 'closed', merged_at: '2026-11-01T20:00:00Z', title: 'x', body: 'Refs #10\n\nTest task for #10: Forge works\nServer: Main\n\n1. Open it' } },
    issues: { 10: issue(10) }, timelines: { 10: [xref(56)] },
  });
  yes('a merged pull request with its test task: Done', fieldWrite(r.writes, 10).body.fields[0].value === 's2');

  r = await go(['--all'], { open: [issue(1), issue(2, { pull_request: {} }), issue(3), issue(4), issue(5)], issues: {} });
  yes('every open issue, across pages, never a pull request: ' + r.lines[0], r.code === 0 && /^4 open issues$/.test(r.lines[0]) &&
      [1, 3, 4, 5].every(n => fieldWrite(r.writes, n)) && !fieldWrite(r.writes, 2) && !r.reads.some(p => /issues\/[1345]$/.test(p)));

  r = await go(['--issues', '10', '--dry-run'], { issues: { 10: issue(10, { type: null }) } });
  yes('a dry run reads and says, and writes nothing: ' + r.lines[0], r.code === 0 && r.writes.length === 0 && /nothing written/.test(r.lines[0]) && /type Task/.test(r.lines[0]));

  r = await go(['--issues', '10,11'], { issues: { 10: issue(10), 11: issue(11) }, broken: 10 });
  yes('an issue that fails is named, the others still put right, and the run is red: ' + r.lines[r.lines.length - 1],
      r.code === 1 && /#10: not put right/.test(r.out) && fieldWrite(r.writes, 11) && /not put right: #10$/.test(r.lines[r.lines.length - 1]));

  r = await go(['--issues', '10'], { issues: { 10: issue(10) }, statuses: ['Todo', 'Doing', 'Done'] });
  yes('a board whose Status lacks an option is refused, and none is added: ' + r.out.split('\n').pop(), r.code === 1 && /has no In Progress/.test(r.out) && r.writes.length === 0);
  r = await go(['--issues', '10'], { issues: { 10: issue(10, { labels: [{ name: 'order: 5' }] }) }, order: false });
  yes('with no Order field yet: Status is still set, the label stays, and it says so', r.code === 0 && /no Order field yet/.test(r.out) &&
      JSON.stringify(fieldWrite(r.writes, 10).body.fields) === JSON.stringify([{ id: 101, value: 's0' }]) && !r.writes.some(x => x.method === 'DELETE'));

  const o = { order: false };
  r = await go(['--setup'], o);
  yes('setup makes the Order field, a number', r.code === 0 && r.writes.length === 1 && r.writes[0].body.name === 'Order' && r.writes[0].body.data_type === 'number');
  r = await go(['--setup'], {});
  yes('  and only when there is none', r.code === 0 && r.writes.length === 0 && /nothing to make/.test(r.out));

  const oldItem = (n, order, repoUrl, type) => ({ id: 500 + n, content_type: type || 'Issue', content: { number: n, node_id: 'I_' + n, repository_url: repoUrl || 'https://api.github.com/repos/ThornswoodRP/Thornswood' }, fields: [{ id: 202, name: 'Order', value: order }] });
  const oldItems = [oldItem(10, 52.5), oldItem(11, null), oldItem(12, 7, 'https://api.github.com/repos/ThornswoodRP/Thornswood-Ops'), oldItem(13, 8, null, 'PullRequest'), oldItem(14, 3)];
  r = await go(['--copy-order', 'EvilPatrick06/1'], { oldItems: oldItems });
  yes('copy-order: each issue of this repository with an Order on the old board gets it here: ' + r.lines[0], r.code === 0 &&
      /^2 issues of ThornswoodRP\/Thornswood with an Order on EvilPatrick06\/1; 0 already hold it here, 0 have a card here to set, 2 have no card here yet$/.test(r.lines[0]) &&
      JSON.stringify(fieldWrite(r.writes, 10).body.fields) === JSON.stringify([{ id: 102, value: 52.5 }]) &&
      JSON.stringify(fieldWrite(r.writes, 14).body.fields) === JSON.stringify([{ id: 102, value: 3 }]) &&
      ![11, 12, 13].some(n => fieldWrite(r.writes, n)) && /^2 Orders written/.test(r.lines[r.lines.length - 1]));
  yes('  a card it has to add goes through the add that gives back one already there, never REST\'s add', !restAdd(r.writes) && cardAdd(r.writes, 10) && cardAdd(r.writes, 14));
  // The board as the first copy left it (1 Nov): #10 already right, #14 on
  // the board with no Order, #15 with another Order, #16 not on it yet, and
  // an Ops issue with the same number that is not this repository's.
  const old2 = oldItems.concat([oldItem(15, 9), oldItem(16, 4)]);
  const newItem = (n, order, repoUrl) => ({ id: 9000 + n, content_type: 'Issue', content: { number: n, node_id: 'I_' + n, repository_url: repoUrl || 'https://api.github.com/repos/ThornswoodRP/Thornswood' }, fields: [{ id: 102, name: 'Order', value: order }] });
  const partly = [newItem(10, 52.5), newItem(14, null), newItem(15, 10015), newItem(16, 1, 'https://api.github.com/repos/ThornswoodRP/Thornswood-Ops')];
  r = await go(['--copy-order', 'EvilPatrick06/1'], { oldItems: old2, newItems: partly, onBoard: [10, 14, 15] });
  yes('a rerun after a partial copy: cards already here keep their id and get the Order, only a missing one is added: ' + r.lines[0], r.code === 0 &&
      /4 issues .*; 1 already hold it here, 2 have a card here to set, 1 have no card here yet$/.test(r.lines[0]) &&
      !restAdd(r.writes) && !cardAdd(r.writes, 14) && !cardAdd(r.writes, 15) && cardAdd(r.writes, 16) && same(r.added, [16]) &&
      fieldWrite(r.writes, 14).body.fields[0].value === 3 && fieldWrite(r.writes, 15).body.fields[0].value === 9 && fieldWrite(r.writes, 16).body.fields[0].value === 4);
  yes('  an Order already the same is not written again, and each line says what it was', !fieldWrite(r.writes, 10) &&
      /#14: Order 3 \(it had none\)/.test(r.out) && /#15: Order 9 \(it had 10015\)/.test(r.out) && /#16: Order 4 \(card added\)/.test(r.out) && /^3 Orders written/.test(r.lines[r.lines.length - 1]));
  r = await go(['--copy-order', 'EvilPatrick06/1'], { oldItems: old2, newItems: [newItem(10, 52.5), newItem(14, 3), newItem(15, 9), newItem(16, 4)] });
  yes('  run again once all is copied: nothing written, exit 0', r.code === 0 && r.writes.length === 0 && /4 already hold it here/.test(r.lines[0]));
  r = await go(['--copy-order', 'EvilPatrick06/1', '--dry-run'], { oldItems: old2, newItems: partly });
  yes('  a dry run says each it would write and writes nothing', r.code === 0 && r.writes.length === 0 &&
      /#14: Order 3 \(it had none\); nothing written/.test(r.out) && /#16: Order 4 \(card added\); nothing written/.test(r.out) && !/#10:/.test(r.out));
  r = await go(['--copy-order', 'EvilPatrick06/1'], { oldItems: oldItems, order: false });
  yes('  no Order field here yet: stopped, nothing written', r.code === 1 && r.writes.length === 0 && /no Order field yet/.test(r.out));
  r = await go(['--copy-order', 'EvilPatrick06/1'], { oldItems: oldItems, oldOrder: false });
  yes('  the old board with no Order field: stopped, nothing written', r.code === 1 && r.writes.length === 0);
  r = await go(['--copy-order', 'nobody'], {});
  yes('  a board that is not user/number: exit 2', r.code === 2 && r.writes.length === 0);

  for (const [what, env, argv] of [['no repository', { GITHUB_REPOSITORY: '' }, ['--all']], ['no board number', { BOARD_NUMBER: '' }, ['--all']],
    ['no token', { BOARD_TOKEN: '' }, ['--all']], ['nothing asked', {}, []], ['a bad issue list', {}, ['--issues', 'x']]]) {
    r = await go(argv, {}, env);
    yes('nothing runs with ' + what + ': ' + r.lines[0], r.code === 2 && r.writes.length === 0 && r.reads.length === 0);
  }

  // ---- 3. the wiring --------------------------------------------------------
  const board = read('.github/workflows/board.yml');
  const bell = read('.github/workflows/pr-events.yml');
  const code = t => t.replace(/^\s*#.*$/gm, '');
  const on = t => { const m = /\non:\n((?:  .*\n|    .*\n|      .*\n|        .*\n)+)/.exec(t); return m ? m[1].split('\n').filter(l => /^  [a-z_]+:/.test(l)).map(l => l.trim().replace(':', '')) : []; };
  yes('board.yml runs on issues, on pr-events.yml completing, and by hand', JSON.stringify(on(board)) === '["issues","workflow_run","workflow_dispatch"]' &&
      /\n    types: \[opened, reopened, closed, labeled, unlabeled\]\n/.test(board) && /\n    workflows: \[Pull request changed\]\n    types: \[completed\]\n/.test(board));
  yes('  only on main, and only for the labels the board reads', /github\.ref == 'refs\/heads\/main'/.test(board) &&
      /startsWith\(github\.event\.label\.name, 'claimed:'\)/.test(board) && /startsWith\(github\.event\.label\.name, 'order:'\)/.test(board) && !/P0/.test(board));
  yes('  in the board environment, with the board App\'s token and only these permissions', /\n    environment: board\n/.test(board) &&
      /client-id: \$\{\{ vars\.BOARD_APP_CLIENT_ID \}\}/.test(board) && /private-key: \$\{\{ secrets\.BOARD_APP_KEY \}\}/.test(board) &&
      /permission-organization-projects: write\n          permission-issues: write\n          permission-pull-requests: read\n/.test(board));
  yes('  and no other secret, and never the old BOARD_TOKEN secret', (code(board).match(/secrets\./g) || []).length === 1 && !/secrets\.BOARD_TOKEN/.test(board));
  yes('  every action pinned by a full commit', (code(board).match(/uses: [^\n]+/g) || []).every(u => /@[0-9a-f]{40} # v/.test(u)));
  yes('  it runs Sync-Board.js for the event, and nothing from the event is pasted into a script',
      /--issues "\$ISSUE"/.test(board) && /--pull "\$PULL"/.test(board) && /--all \$DRY/.test(board) && /--setup \$DRY/.test(board) &&
      (board.split('run: |').slice(1).every(b => !/\$\{\{/.test(b.split(/\n      - /)[0]))));
  yes('pr-events.yml runs on a pull request\'s open, reopen, edit and close, with no token, checkout or action',
      JSON.stringify(on(bell)) === '["pull_request"]' && /\n    types: \[opened, reopened, edited, closed\]\n/.test(bell) &&
      /\npermissions: \{\}\n/.test(bell) && !/uses:|secrets\.|checkout|github\.token/.test(code(bell)));
  yes('  its job is the one board.yml reads, and both build the markers at run time',
      /\n    name: Say which pull request changed\n/.test(bell) && board.indexOf("$_.name -eq 'Say which pull request changed'") >= 0 &&
      /printf '%s-%s' BOARD PULL/.test(bell) && /'BOARD' \+ '-PULL'/.test(board) && !/BOARD-PULL|BOARD-BEFORE/.test(bell + board));
  yes('  board.yml reads that log the way gh 2.92 needs (#5202), with LogHandBack.ps1 checked out',
      /\$flags = @\(Get-GhLogFlags\)/.test(board) && /\/logs" @flags\)/.test(board) && /\n            scripts\/release\/LogHandBack\.ps1\n/.test(board));
  yes('  and its name is the one board.yml waits for', /\nname: Pull request changed\n/.test(bell));
  for (const gone of ['board-status.yml', 'order-on-filing.yml']) {
    yes('the label workflow ' + gone + ' is gone', !fs.existsSync(path.join(REPO, '.github', 'workflows', gone)));
  }
  const dom = read('.github/workflows/done-on-merge.yml');
  yes('done-on-merge.yml writes the test task and puts no board: label on', dom && !/board: Done|BOARD_TOKEN|environment: board/.test(code(dom)));
  const wfs = fs.readdirSync(path.join(REPO, '.github', 'workflows')).filter(f => /\.ya?ml$/.test(f));
  const writers = wfs.filter(f => /updateProjectV2ItemFieldValue|addProjectV2ItemById|projectsV2\/[^/]+\/items/.test(read('.github/workflows/' + f)));
  yes('no other workflow writes the board (' + (writers.join(', ') || 'none') + ')', writers.length === 0);

  // ---- 4. the duplicate check on filing -----------------------------------
  const D = require(path.join(REPO, 'scripts', 'ops', 'Find-Duplicate.js'));
  // Titles from the board as they were filed, with others open beside them
  // so the weights are the board's kind of weights.
  const OPEN = [
    { number: 1650, title: 'test-page-changed.js never runs in Launcher builds: a comma is missing in the list' },
    { number: 2024, title: 'Quit to Main Menu freezes or crashes the game (EngineFixes access violation)' },
    { number: 5254, title: "test-3147-lines reads the site's log before the log has arrived" },
    { number: 4329, title: 'Launcher controls have no names a screen reader can say' },
    { number: 4987, title: 'The deploy gate has no Publish-Server verb' },
    { number: 1602, title: 'The server freezes for 25 to 29 seconds the first time someone enters a cell' },
    { number: 4164, title: 'Most voice tests only run at night, not on pull requests' },
    { number: 3411, title: 'The main Ship never closes an issue moved to Done by hand' },
    { number: 4729, title: "The launcher opens the feed's collection link without checking it" },
    { number: 4606, title: "Escape in the trade panel's gold or find box walks away from the whole trade" },
  ];
  const named = (n, t, open) => D.likelyRepeats(n, t, open || OPEN).map(f => f.number);
  yes('a title becomes its words: small words and counts out, a name taken apart, a plain ending off',
      D.wordsOf('The build never runs test-3147-lines.js in 2 builds').join(' ') === 'build never run test 3147 line js' &&
      D.wordsOf('the of 12 is').length === 0);
  yes('#1686 names #1650, the same missing comma', same(named(1686, 'The build check never runs test-page-changed.js: a comma is missing in its list'), [1650]));
  yes('#2025 names #2024, the same title', same(named(2025, 'Quit to Main Menu freezes or crashes the game (EngineFixes access violation)'), [2024]));
  yes('#5300 names #5254, the same early read', same(named(5300, 'test-3147-lines.js reads the site log before its line has arrived'), [5254]));
  yes('a stranger names nothing', named(9001, 'Wolves in the Rift drop no pelts when skinned').length === 0);
  yes('one shared word is never enough, however rare', named(9002, 'EngineFixes').length === 0);
  yes('the issue itself is never named', named(2024, OPEN[1].title).indexOf(2024) < 0);
  const many = [1, 2, 3, 4, 5].map(n => ({ number: n, title: 'The harvest bench drops the oak bark on a relog' })).concat(OPEN);
  const top = D.likelyRepeats(9003, 'The harvest bench drops the oak bark on a relog', many);
  yes('at most ' + D.MOST + ' are named, best first', top.length === D.MOST && top.every((f, i) => i === 0 || top[i - 1].score >= f.score));
  const body = D.commentFor([{ number: 1650, title: OPEN[0].title }]);
  yes('the comment links the issue and says what to do, plainly, with no footer or byline',
      /^- #1650 test-page-changed\.js/m.test(body) && /close this one as a duplicate/.test(body) && !/---|Claude|Generated|@/.test(body));

  function issuesHub(o) {
    const writes = [];
    const f = async (url, init) => {
      const p = url.replace('https://api.github.com/', '');
      const m = (init && init.method) || 'GET';
      if (m !== 'GET') writes.push({ method: m, path: p, body: init.body && JSON.parse(init.body) });
      let status = 200, out = null;
      if (o.fail && p.startsWith('repos/' + HERE + '/issues?')) { status = 502; out = { message: 'bad gateway' }; }
      else if (p.startsWith('repos/' + HERE + '/issues?')) {
        const page = Number(/page=(\d+)/.exec(p.split('per_page')[1])[1]);
        const all = o.open.concat([{ number: 4000, title: 'a pull request', pull_request: {} }]);
        out = all.slice((page - 1) * 100, page * 100);
      } else if (m === 'POST') out = { id: 1 };
      return { ok: status < 400, status: status, text: async () => JSON.stringify(out) };
    };
    return { f, writes };
  }
  const pad = Array.from({ length: 150 }, (_, i) => ({ number: 6000 + i, title: 'Filler ' + i + ' about wolf ' + i + ' pelts' }));
  async function find(argv, o, env) {
    const h = issuesHub(o); const lines = [];
    const code = await D.run(argv, Object.assign({ GITHUB_REPOSITORY: HERE, GITHUB_TOKEN: 't' }, env || {}), h.f, s => lines.push(String(s)));
    return { code, writes: h.writes, out: lines.join('\n') };
  }
  let d = await find(['--issue', '1686'], { open: pad.concat(OPEN) }, { TITLE: 'The build check never runs test-page-changed.js: a comma is missing in its list' });
  yes('run: reads every page of open issues, leaves the pull request out, and makes one comment naming #1650',
      d.code === 0 && d.writes.length === 1 && d.writes[0].path === 'repos/' + HERE + '/issues/1686/comments' && /#1650/.test(d.writes[0].body.body) && /160 open issue/.test(d.out));
  d = await find(['--issue', '9001'], { open: OPEN }, { TITLE: 'Wolves in the Rift drop no pelts when skinned' });
  yes('  nothing alike: no comment, exit 0', d.code === 0 && d.writes.length === 0 && /none alike/.test(d.out));
  d = await find(['--issue', '1686', '--dry-run'], { open: OPEN }, { TITLE: 'The build check never runs test-page-changed.js: a comma is missing in its list' });
  yes('  a dry run says the comment and writes nothing', d.code === 0 && d.writes.length === 0 && /dry run/.test(d.out) && /#1650/.test(d.out));
  d = await find(['--issue', '1686'], { open: OPEN, fail: true }, { TITLE: 'x y z' });
  yes('  GitHub failing is exit 1 and says so', d.code === 1 && /STOP\. GET/.test(d.out) && d.writes.length === 0);
  d = await find([], { open: OPEN });
  yes('  no --issue is exit 2', d.code === 2);
  d = await find(['--issue', '5'], { open: OPEN }, { GITHUB_TOKEN: '' });
  yes('  no token is exit 2', d.code === 2);

  const dup = read('.github/workflows/duplicate-check.yml');
  yes('duplicate-check.yml runs when an issue is opened, on main, on GitHub\'s runner',
      JSON.stringify(on(dup)) === '["issues"]' && /\n    types: \[opened\]\n/.test(dup) && /github\.ref == 'refs\/heads\/main'/.test(dup) && /runs-on: ubuntu-latest/.test(dup));
  yes('  with the run\'s token and issues write only, and no secret', /permissions:\n      contents: read\n      issues: write\n/.test(dup) && !/secrets\.|environment:/.test(code(dup)));
  yes('  the title through the environment, never pasted into the script', /TITLE: \$\{\{ github\.event\.issue\.title \}\}/.test(dup) &&
      /run: node scripts\/ops\/Find-Duplicate\.js --issue "\$ISSUE"\n/.test(dup));
  yes('  every action pinned by a full commit', (code(dup).match(/uses: [^\n]+/g) || []).every(u => /@[0-9a-f]{40} # v/.test(u)));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL ' + (e && e.stack || e)); process.exit(1); });
