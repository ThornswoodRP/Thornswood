#!/usr/bin/env node
// scripts/ops/Sync-Board.js
//
// Puts an issue's card on the board where the facts GitHub has say it
// belongs (#5185, the redesign's part 5, approved by Patrick on 31 Oct 2026).
//
// WHY. Until November the board's Status and Order were set by hand, or by a
// board: or order: label that board-status.yml carried out, and the card
// could say In Progress for an issue nobody touched in weeks, or Todo for one
// with a pull request open, because nothing tied the card to what was really
// happening. 909 issues were open when #5185 was filed. The board was a
// Projects board of Patrick's own account, which no GitHub App can reach, so
// every move went through his personal token. Now the board belongs to the
// ThornswoodRP organization, and one workflow (.github/workflows/board.yml)
// runs this for every issue that changes, with the board App's own token.
// Nobody moves a card by hand, and nothing else writes the board.
//
// WHAT DECIDES THE STATUS, in this order:
//   Done         the issue is closed; or a merged pull request of this
//                repository carries its test task ("Test task for #N:"),
//                so its fix is on main and waits only for a main Ship
//                (docs/guide/the-board.md), unless another pull
//                request naming it is open
//   In Progress  an open pull request of this repository names it (Closes,
//                Fixes, Resolves, Refs or Part of #N, or its test task), in
//                its title or body, draft or not; or it carries a claimed:
//                label, which is how a Bot or a person says they are on it
//                and how a waiting issue keeps its place (docs/guide/the-board.md)
//   Todo         anything else
// A pull request names an issue only in its own title and body. A mention in
// a comment, or a commit message, puts a cross-reference on the issue's
// timeline too, but says nothing about which work the pull request does.
//
// THE ORDER. Order is the board's one do-order, and every open issue carries
// one (Patrick, 27 Oct 2026, #3534). An open issue whose card has no Order
// gets 10000 plus its number: after every Order a person or a review gave,
// in the order the issues were filed, and never the same as another card's
// (what order-on-filing.yml did until #5185). Moving a card in the queue is
// a label, `order: <number>` (`order: 52.5`): this sets the card's Order to
// it and takes the label off, so a cloud thread, which cannot reach the
// board, moves a card the same way a person does. A card's Order is never
// changed otherwise. --copy-order carries every card's Order over from the
// board this one replaced, Patrick's own account's, once.
//
// WHAT DECIDES THE TYPE. An issue filed from a form gets its type from the
// form (.github/ISSUE_TEMPLATE). One with none gets Bug when it is labelled
// bug, Dev Findings or Main Findings, Feature when it is labelled Suggestion,
// and Task otherwise; a type somebody set is never changed.
//
// HOW IT IS RUN.
//   node scripts/ops/Sync-Board.js --issues 12,34       those issues
//   node scripts/ops/Sync-Board.js --pull 56             the issues pull request 56 names
//   node scripts/ops/Sync-Board.js --all                 every open issue (a closed one
//                                                        is put in Done by its closed event)
//   node scripts/ops/Sync-Board.js --setup               makes the Order field when the
//                                                        board has none; changes nothing else
//   node scripts/ops/Sync-Board.js --copy-order EvilPatrick06/1
//                                                        each card's Order from that user
//                                                        board, for the issues of this
//                                                        repository; run once, with a token
//                                                        that reads that board (Patrick's)
//   --dry-run with any of them reads and says, and writes nothing.
// It reads BOARD_TOKEN (the board App's installation token: the board, and
// the repository's issues and pull requests), GITHUB_REPOSITORY,
// BOARD_OWNER and BOARD_NUMBER. It prints one line per issue and exits 1 when
// any issue could not be put right, naming each, and 2 when it was not asked
// properly.
'use strict';

const API = 'https://api.github.com/';
const STATUSES = ['Todo', 'In Progress', 'Done'];
// Where a new issue goes until a review moves it (order-on-filing.yml's rule,
// #3534): after the queue, which is below 10000, in the order of filing.
const FILED_ORDER = 10000;

// ------------------------------------------------------------- the rules

// Every issue number of repo the text names as the work of a pull request:
// after Close(s/d), Fix(es/ed), Resolve(s/d), Ref(s) or "Part of", each #N of
// the list that follows ("Refs #1, #2 and #3"), and every "Test task for
// #N:". A bare #N is an issue of the pull request's own repository, so it
// counts only when the pull request is in repo (from); owner/name#N counts
// from anywhere when it names repo, which is how a pull request of the engine
// fork names an issue here.
function namedIn(text, repo, from) {
  const out = new Set();
  const t = String(text || '');
  const self = !repo || !from || String(repo).toLowerCase() === String(from).toLowerCase();
  const ref = '(?:[\\w.-]+\\/[\\w.-]+)?#\\d+';
  const kw = new RegExp('\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|refs?|part\\s+of)\\b[\\s:]*(' + ref + '(?:\\s*(?:,|and|&|\\/)?\\s*' + ref + ')*)', 'gi');
  let m;
  while ((m = kw.exec(t)) !== null) {
    for (const one of m[1].match(new RegExp(ref, 'g')) || []) {
      const at = one.indexOf('#');
      const where = one.slice(0, at);
      if (where ? (repo && where.toLowerCase() === String(repo).toLowerCase()) : self) { out.add(Number(one.slice(at + 1))); }
    }
  }
  if (self) { for (const n of tasksIn(t)) { out.add(n); } }
  return out;
}

// The issues a body carries a test task for, by done-on-merge.yml's own
// first-line pattern.
function tasksIn(text) {
  const out = new Set();
  const re = /^\s*Test task for #(\d+)\s*:\s*\S/gim;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) { out.add(Number(m[1])); }
  return out;
}

/*
  statusFor(issue, pulls) -> { status, why }
  issue: { repo, number, state, labels: [names] }
  pulls: [{ repo, number, state: 'open'|'closed', merged: bool, title, body }],
         the pull requests of the organization on the issue's timeline
*/
function statusFor(issue, pulls) {
  const n = Number(issue.number);
  if (String(issue.state).toLowerCase() === 'closed') { return { status: 'Done', why: 'it is closed' }; }
  const naming = (pulls || []).filter(p => namedIn(String(p.title || '') + '\n' + String(p.body || ''), issue.repo, p.repo).has(n));
  const name = p => (p.repo && issue.repo && p.repo.toLowerCase() !== issue.repo.toLowerCase() ? p.repo : '') + '#' + p.number;
  const open = naming.filter(p => p.state === 'open');
  if (open.length) { return { status: 'In Progress', why: 'pull request ' + open.map(name).join(', ') + ' names it and is open' }; }
  const shipped = naming.filter(p => p.merged && (!p.repo || !issue.repo || p.repo.toLowerCase() === issue.repo.toLowerCase()) && tasksIn(p.body).has(n));
  if (shipped.length) { return { status: 'Done', why: 'pull request ' + name(shipped[0]) + ' merged with its test task, so it waits on a main Ship' }; }
  const claim = (issue.labels || []).find(l => /^claimed:/i.test(l));
  if (claim) { return { status: 'In Progress', why: 'it carries ' + claim }; }
  return { status: 'Todo', why: 'no open pull request names it and nobody has claimed it' };
}

// The Order an `order: <number>` label asks for, or null; and every such
// label, which all come off once the card has it. Two that ask for different
// numbers ask for nothing: neither is picked, and the line says so.
function orderFor(labels) {
  const found = [];
  for (const l of labels || []) {
    const m = /^\s*order:\s*(-?\d+(?:\.\d+)?)\s*$/i.exec(String(l));
    if (m) { found.push({ label: String(l), value: Number(m[1]) }); }
  }
  const values = Array.from(new Set(found.map(f => f.value)));
  return { order: values.length === 1 ? values[0] : null, labels: found.map(f => f.label), clash: values.length > 1 };
}

// A card's number field value as the REST item answers it.
function numberOf(v) {
  if (typeof v === 'number') { return v; }
  if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) { return Number(v); }
  if (v && typeof v === 'object') { return numberOf(v.number !== undefined ? v.number : v.raw !== undefined ? v.raw : v.value); }
  return null;
}

// The type an issue with none gets, from its labels.
function typeFor(labels) {
  const has = name => (labels || []).some(l => String(l).toLowerCase() === name.toLowerCase());
  if (has('bug') || has('Dev Findings') || has('Main Findings')) { return 'Bug'; }
  if (has('Suggestion')) { return 'Feature'; }
  return 'Task';
}

// The pull requests on an issue's timeline from a repository of the same
// owner (Thornswood's own, and the engine fork's), one each.
function pullsOnTimeline(events, repo) {
  const seen = new Map();
  const owner = String(repo).split('/')[0].toLowerCase();
  for (const e of events || []) {
    if (!e || e.event !== 'cross-referenced' || !e.source || !e.source.issue) { continue; }
    const s = e.source.issue;
    if (!s.pull_request) { continue; }
    const from = String((s.repository && s.repository.full_name) || repo);
    if (from.split('/')[0].toLowerCase() !== owner) { continue; }
    seen.set(from.toLowerCase() + '#' + Number(s.number), {
      repo: from,
      number: Number(s.number),
      state: String(s.state || '').toLowerCase(),
      merged: !!(s.pull_request && s.pull_request.merged_at),
      title: String(s.title || ''),
      body: String(s.body || ''),
    });
  }
  return Array.from(seen.values());
}

// ---------------------------------------------------------- GitHub calls

function client(token, fetchImpl) {
  const f = fetchImpl || fetch;
  let calls = 0;
  async function call(method, path, body) {
    calls++;
    const res = await f(API + path, {
      method: method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'thornswood-board',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const said = data && typeof data === 'object' && data.message ? data.message : String(text).slice(0, 300);
      const err = new Error(method + ' ' + path.split('?')[0] + ' answered ' + res.status + ': ' + said);
      err.status = res.status;
      throw err;
    }
    return { data: data, link: res.headers && res.headers.get ? res.headers.get('link') || '' : '' };
  }
  async function all(path) {
    const out = [];
    let next = path + (path.indexOf('?') >= 0 ? '&' : '?') + 'per_page=100';
    while (next) {
      const r = await call('GET', next);
      for (const x of Array.isArray(r.data) ? r.data : []) { out.push(x); }
      const m = /<https:\/\/api\.github\.com\/([^>]+)>;\s*rel="next"/.exec(r.link);
      next = m ? m[1] : '';
    }
    return out;
  }
  // GraphQL answers 200 with its errors in the body; those are failures too.
  async function graphql(query, variables) {
    const r = await call('POST', 'graphql', { query: query, variables: variables });
    const d = r.data || {};
    if (Array.isArray(d.errors) && d.errors.length) {
      throw new Error('GraphQL answered: ' + d.errors.map(e => String(e && e.message || e)).join('; '));
    }
    return d.data || {};
  }
  return { call: call, all: all, graphql: graphql, count: () => calls };
}

function optionName(o) { return o && typeof o.name === 'object' && o.name ? String(o.name.raw || '') : String((o && o.name) || ''); }

// The board's Status field, with each option's id by name, and its Order.
async function readBoard(gh, owner, number, kind) {
  const fields = await gh.all((kind || 'orgs') + '/' + owner + '/projectsV2/' + number + '/fields');
  const pick = name => fields.find(f => String(f.name).toLowerCase() === name.toLowerCase());
  const status = pick('Status');
  if (!status || String(status.data_type).toLowerCase() !== 'single_select') { throw new Error('the board has no single select field named Status'); }
  const so = {};
  for (const o of status.options || []) { so[optionName(o)] = o.id; }
  const missing = STATUSES.filter(s => !so[s]);
  if (missing.length) { throw new Error('the board\'s Status has no ' + missing.join(', ') + '; it has ' + Object.keys(so).join(', ') + ' (an option is never added from here: GitHub rewrites every option when one is added, which can clear every card\'s Status)'); }
  const order = pick('Order');
  if (order && String(order.data_type).toLowerCase() !== 'number') { throw new Error('the board\'s Order field is not a number'); }
  const project = (await gh.call('GET', (kind || 'orgs') + '/' + owner + '/projectsV2/' + number)).data || {};
  return { node: String(project.node_id || ''), status: { id: status.id, options: so }, order: order ? { id: order.id } : null };
}

// The issue's card on the board, its REST id. REST's add answers 422
// "Content already exists in this project" for an issue already on the board
// and does not say which card that is (board.yml runs 41350871295,
// 41350710978 and 41350708585, 1 Nov 2026), and REST has no way to ask an
// issue for its card. GraphQL's addProjectV2ItemById hands back the card
// already there, or the new one, in one call, so two runs for the same issue
// at once both get the one card. Its databaseId is the id the REST item
// paths take.
const ADD_CARD = 'mutation($project:ID!,$content:ID!){addProjectV2ItemById(input:{projectId:$project,contentId:$content}){item{databaseId}}}';
async function cardFor(gh, board, issueNode) {
  if (!board.node) { throw new Error('the board gave back no node id'); }
  if (!issueNode) { throw new Error('the issue gave back no node id'); }
  const d = await gh.graphql(ADD_CARD, { project: board.node, content: issueNode });
  const item = d.addProjectV2ItemById && d.addProjectV2ItemById.item && d.addProjectV2ItemById.item.databaseId;
  if (!item) { throw new Error('the board gave back no card'); }
  return item;
}

async function setup(gh, owner, number, dry, say) {
  const fields = await gh.all('orgs/' + owner + '/projectsV2/' + number + '/fields');
  if (fields.some(f => String(f.name).toLowerCase() === 'order')) { say('the board has an Order field; nothing to make'); return; }
  if (dry) { say('would make the Order field, a number'); return; }
  await gh.call('POST', 'orgs/' + owner + '/projectsV2/' + number + '/fields', { name: 'Order', data_type: 'number' });
  say('made the Order field, a number');
}

// Puts one issue right: its type when it has none, its card, its Status, and
// its Order when an order: label asks for one or an open issue's card has
// none. Returns the line to print.
// fresh, when given, is the pull request this run is for, read just now: it
// stands in for its own entry on the timeline, which GitHub may not have
// written yet a few seconds after the pull request was opened.
async function syncIssue(gh, o, issue, board, fresh) {
  const n = Number(issue.number);
  const labels = (issue.labels || []).map(l => (typeof l === 'string' ? l : l.name));
  const events = await gh.all('repos/' + o.repo + '/issues/' + n + '/timeline');
  let pulls = pullsOnTimeline(events, o.repo);
  if (fresh) { pulls = pulls.filter(p => !(p.number === fresh.number && String(p.repo).toLowerCase() === String(fresh.repo).toLowerCase())).concat([fresh]); }
  const s = statusFor({ repo: o.repo, number: n, state: issue.state, labels: labels }, pulls);
  const ask = orderFor(labels);
  const typeNow = issue.type && issue.type.name ? String(issue.type.name) : '';
  const parts = ['#' + n + ': ' + s.status + ' (' + s.why + ')'];
  if (ask.clash) { parts.push('order labels disagree (' + ask.labels.join(', ') + '), so the Order is left as it is and the labels stay'); }
  let typeSet = '';
  if (!typeNow) { typeSet = typeFor(labels); parts.push('type ' + typeSet + ' (it had none)'); }
  if (o.dry) {
    if (ask.order !== null) { parts.push('Order ' + ask.order + ' (asked by its label)'); }
    return parts.join(', ') + '; nothing written (dry run)';
  }
  if (typeSet) { await gh.call('PATCH', 'repos/' + o.repo + '/issues/' + n, { type: typeSet }); }
  const item = await cardFor(gh, board, issue.node_id);
  const itemPath = 'orgs/' + o.owner + '/projectsV2/' + o.number + '/items/' + item;
  const fields = [{ id: board.status.id, value: board.status.options[s.status] }];
  if (board.order && ask.order !== null) {
    fields.push({ id: board.order.id, value: ask.order });
    parts.push('Order ' + ask.order + ' (asked by its label)');
  } else if (board.order && !ask.clash && String(issue.state).toLowerCase() === 'open') {
    const now = await gh.call('GET', itemPath + '?fields=' + board.order.id);
    const has = (now.data && now.data.fields || []).find(f => String(f.id) === String(board.order.id));
    if (numberOf(has && has.value) === null) {
      fields.push({ id: board.order.id, value: FILED_ORDER + n });
      parts.push('Order ' + (FILED_ORDER + n) + ' (it had none)');
    }
  }
  await gh.call('PATCH', itemPath, { fields: fields });
  if (board.order && ask.order !== null) {
    // A label already gone (somebody took it off meanwhile) is what was wanted.
    for (const l of ask.labels) {
      try { await gh.call('DELETE', 'repos/' + o.repo + '/issues/' + n + '/labels/' + encodeURIComponent(l)); } catch (e) { if (e.status !== 404) { throw e; } }
    }
  }
  return parts.join(', ');
}

// Each card of o.repo's issues on a board, by issue number: its REST id and
// its Order (null when it has none). One read of the whole board, a page of
// 100 cards a call.
async function cardsOf(gh, kind, owner, number, orderId, repo) {
  const name = repo.split('/')[1].toLowerCase();
  const out = new Map();
  for (const it of await gh.all(kind + '/' + owner + '/projectsV2/' + number + '/items?fields=' + orderId)) {
    const c = it.content || {};
    if (String(it.content_type || '') !== 'Issue' || !c.number || String(c.repository_url || '').split('/').pop().toLowerCase() !== name) { continue; }
    const f = (it.fields || []).find(x => String(x.id) === String(orderId));
    out.set(Number(c.number), { item: it.id, node: String(c.node_id || ''), order: numberOf(f && f.value) });
  }
  return out;
}

// Carries each card's Order over from the board this one replaced (a user's
// board, read with a token that may read it), for the issues of o.repo. A
// card already here keeps its id and gets the Order; a card already holding
// that Order is left as it is, so a second run writes only what the first
// did not; an issue with no card here gets one. Cards of other repositories,
// and cards with no Order there, are left alone.
// The first copy (1 Nov 2026) added every card through REST, which answers
// 422 "Content already exists in this project" for a card already on the
// board: 92 Orders copied, 149 refused, stopped by hand. Nothing here adds a
// card the board already has.
async function copyOrder(gh, o, from, say) {
  const m = /^([\w.-]+)\/(\d+)$/.exec(from);
  if (!m) { say('--copy-order takes the old board as user/number, such as EvilPatrick06/1'); return 2; }
  let old, board;
  try {
    old = await readBoard(gh, m[1], m[2], 'users');
    board = await readBoard(gh, o.owner, o.number);
  } catch (e) { say('stopped, nothing written: ' + e.message); return 1; }
  if (!old.order) { say('stopped, nothing written: the board ' + from + ' has no Order field'); return 1; }
  if (!board.order) { say('stopped, nothing written: this board has no Order field yet (--setup makes it)'); return 1; }
  const there = await cardsOf(gh, 'users', m[1], m[2], old.order.id, o.repo);
  const found = Array.from(there.entries()).filter(([, c]) => c.order !== null).map(([n, c]) => ({ number: n, node: c.node, order: c.order }));
  const here = await cardsOf(gh, 'orgs', o.owner, o.number, board.order.id, o.repo);
  const same = found.filter(f => here.has(f.number) && here.get(f.number).order === f.order).length;
  const missing = found.filter(f => !here.has(f.number)).length;
  say(found.length + ' issues of ' + o.repo + ' with an Order on ' + from + '; ' + same + ' already hold it here, ' +
      (found.length - same - missing) + ' have a card here to set, ' + missing + ' have no card here yet');
  const failed = [];
  let wrote = 0;
  for (const f of found.sort((a, b) => a.number - b.number)) {
    const card = here.get(f.number);
    if (card && card.order === f.order) { continue; }
    const was = card ? (card.order === null ? 'it had none' : 'it had ' + card.order) : 'card added';
    if (o.dry) { say('#' + f.number + ': Order ' + f.order + ' (' + was + '); nothing written (dry run)'); continue; }
    try {
      let item = card && card.item;
      if (!item) {
        const node = f.node || String(((await gh.call('GET', 'repos/' + o.repo + '/issues/' + f.number)).data || {}).node_id || '');
        item = await cardFor(gh, board, node);
      }
      await gh.call('PATCH', 'orgs/' + o.owner + '/projectsV2/' + o.number + '/items/' + item, { fields: [{ id: board.order.id, value: f.order }] });
      wrote++;
      say('#' + f.number + ': Order ' + f.order + ' (' + was + ')');
    } catch (e) {
      failed.push(f.number);
      say('#' + f.number + ': not copied: ' + e.message);
    }
  }
  say((o.dry ? 'nothing written; ' : wrote + ' Orders written; ') + gh.count() + ' calls to GitHub');
  if (failed.length) { say('not copied: ' + failed.map(x => '#' + x).join(', ')); return 1; }
  return 0;
}

async function run(argv, env, fetchImpl, say) {
  say = say || (s => console.log(s));
  const arg = name => { const i = argv.indexOf(name); return i >= 0 ? String(argv[i + 1] || '') : null; };
  const o = {
    repo: String(env.GITHUB_REPOSITORY || ''),
    owner: String(env.BOARD_OWNER || ''),
    number: String(env.BOARD_NUMBER || ''),
    dry: argv.indexOf('--dry-run') >= 0,
  };
  if (!/^[\w.-]+\/[\w.-]+$/.test(o.repo)) { say('GITHUB_REPOSITORY names no repository'); return 2; }
  if (!/^[\w.-]+$/.test(o.owner)) { say('BOARD_OWNER names no organization'); return 2; }
  if (!/^\d+$/.test(o.number)) { say('BOARD_NUMBER is not the board\'s number (the board environment\'s variable, #5185 says how it is set)'); return 2; }
  if (!env.BOARD_TOKEN) { say('BOARD_TOKEN is empty, so nothing can reach the board'); return 2; }
  const gh = client(env.BOARD_TOKEN, fetchImpl);
  if (argv.indexOf('--setup') >= 0) { await setup(gh, o.owner, o.number, o.dry, say); return 0; }
  const from = arg('--copy-order');
  if (from !== null) { return copyOrder(gh, o, from, say); }

  let numbers = [];
  let fresh = null;
  const listed = new Map();
  const issues = arg('--issues');
  const pull = arg('--pull');
  if (issues !== null) {
    numbers = issues.split(/[\s,]+/).filter(Boolean).map(Number);
    if (!numbers.length || numbers.some(x => !Number.isInteger(x) || x <= 0)) { say('--issues takes issue numbers, by commas'); return 2; }
  } else if (pull !== null) {
    if (!/^\d+$/.test(pull)) { say('--pull takes one pull request number'); return 2; }
    const pr = (await gh.call('GET', 'repos/' + o.repo + '/pulls/' + pull)).data;
    fresh = { repo: o.repo, number: Number(pr.number), state: String(pr.state || '').toLowerCase(), merged: !!pr.merged_at, title: String(pr.title || ''), body: String(pr.body || '') };
    numbers = Array.from(namedIn(String(pr.title || '') + '\n' + String(pr.body || ''), o.repo, o.repo)).sort((a, b) => a - b);
    // An edit that took a name out: the names before the edit come from the
    // workflow (EARLIER_ISSUES), since GitHub keeps no old body to ask.
    for (const x of String(env.EARLIER_ISSUES || '').split(/[\s,]+/).filter(s => /^\d+$/.test(s)).map(Number)) {
      if (numbers.indexOf(x) < 0) { numbers.push(x); }
    }
    say('pull request #' + pull + ' names ' + (numbers.length ? numbers.map(x => '#' + x).join(', ') : 'no issue'));
  } else if (argv.indexOf('--all') >= 0) {
    for (const i of await gh.all('repos/' + o.repo + '/issues?state=open')) {
      if (!i.pull_request) { listed.set(Number(i.number), i); }
    }
    numbers = Array.from(listed.keys()).sort((a, b) => a - b);
    say(numbers.length + ' open issues');
  } else {
    say('say which issues: --issues, --pull, --all, --setup or --copy-order');
    return 2;
  }

  let board;
  try { board = await readBoard(gh, o.owner, o.number); } catch (e) { say('stopped, nothing written: ' + e.message); return 1; }
  if (!board.order) { say('the board has no Order field yet, so no Order is set (--setup makes it)'); }
  const failed = [];
  for (const n of numbers) {
    try {
      let issue = listed.get(n);
      if (!issue) { issue = (await gh.call('GET', 'repos/' + o.repo + '/issues/' + n)).data; }
      if (issue.pull_request) { say('#' + n + ' is a pull request; its card is GitHub\'s to keep'); continue; }
      say(await syncIssue(gh, o, issue, board, fresh));
    } catch (e) {
      failed.push(n);
      say('#' + n + ': not put right: ' + e.message);
    }
  }
  say(gh.count() + ' calls to GitHub');
  if (failed.length) { say('not put right: ' + failed.map(x => '#' + x).join(', ')); return 1; }
  return 0;
}

if (require.main === module) {
  run(process.argv.slice(2), process.env).then(code => process.exit(code), e => { console.log('stopped: ' + (e && e.message || e)); process.exit(1); });
}
module.exports = { namedIn, tasksIn, statusFor, orderFor, numberOf, typeFor, pullsOnTimeline, readBoard, syncIssue, copyOrder, run, client, STATUSES, FILED_ORDER };
