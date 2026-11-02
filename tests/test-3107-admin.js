// #3107 (Patrick's A of 22 Oct 2026): the box's GitHub admin service.
//
// A cloud Claude thread cannot change a runner's labels (its proxy refuses
// every actions/runners path) and a workflow's own token cannot either, so a
// GitHub App made for Thornswood holds that right, its key kept on the box by
// scripts/vps/admin/admin.js, which listens only to a run of the private
// ops repository's .github/workflows/github-admin.yml on its main and only
// makes the runners registered there match this repository's main runner
// records (#4013). This runs it for real on loopback:
//   1. the OIDC check, against tokens signed here with a key a stand-in for
//      GitHub's published keys serves: a hand-started run of the ops
//      repository's github-admin.yml on main passes; a push's run, a token
//      from another workflow, another branch, a pull request, another
//      repository (this one included, and one with the ops repository's
//      name but not its id), another
//      audience or issuer, an expired one, one signed by a key GitHub does
//      not publish, one whose body was changed after signing, and one that
//      says it needs no signature, each fail;
//   2. the App's own token: RS256, signed by the App's key, issued by its id,
//      ten minutes at most;
//   3. the records' rules and the plan for one record, the cases #2994's
//      test held Set-BuildRunners.ps1 to: a listed runner without the label
//      gets it, a VPS runner or an off-box runner the record does not list
//      loses it, a right one is left alone, a listed runner GitHub does not
//      have is named, and a record whose runners GitHub has none of, one
//      that names a label every runner carries, lists no runners, or names a
//      label another record names, stops; and a label of our own that no
//      record names comes off every runner (#4033), while the labels GitHub
//      gives (read-only) and the reserved ones stay;
//   3b. the About record (#3682): the real records/repo-about.json passes, and
//      an empty, too long or two-line description, a website that is not
//      https, and a topic in capitals, twice, or past GitHub's 20 each stop;
//      topics compare in any order;
//   3c. redirects (#5184): a read GitHub moved (301) and a change it sends on
//      (307) are followed, a change answered 301 is not, nor a redirect to
//      another host, and a loop stops after five;
//   4. admin.js spawned against a stand-in GitHub: anything through Caddy
//      (X-Forwarded-For) but the setup pages is the plain 404; no token, a
//      branch's token, and a token for another audience are 403 with nothing
//      asked of GitHub; with no App it says how to make one; with one, a
//      check says what differs and changes nothing, a run puts the labels
//      right on the ops repository with an installation token for it alone,
//      reads them back, and a second run changes nothing; runner 3's
//      thornswood-sign, whose record is gone (#4033), comes off; the records come
//      from this repository's main through the App, with a read-only token
//      for this repository alone, never from the caller; installation-repos
//      (#4013) lists the repositories the App is on with a token that reads
//      metadata alone, and changes nothing; settings (#3534) only reads this
//      repository's, with a read-only token for it alone that asks for the
//      secret, variable and environment names only when the App holds them,
//      says which it could not read and why, and never hands back a value;
//      and the log holds no token. The About box the same way, with a token
//      for this repository alone: a check names what differs and writes
//      nothing, a run sets it in one PATCH and one PUT and reads it back, a
//      second run changes nothing, and a bad record on main stops it;
//   4a. repository settings (#3683): the record's rules (Thornswood and the
//      engine fork only, each once; reporting true or false when given; per
//      ruleset a name, branch or tag, active or disabled, a ref, rules with
//      types, a bypass list, no name twice), what GitHub's copy must say
//      (every key the record gives, lists in any order, GitHub's own ids and
//      defaults ignored), and the service: a check says what would be made
//      or switched and changes nothing; a run makes the missing rulesets in
//      each repository with a token for that repository alone, puts a
//      changed one back by name, sending only the ruleset's own keys,
//      switches the fork's private reporting as the record says and leaves
//      it alone where the record says nothing, switches secret scanning and
//      push protection in one PATCH of only the keys that differ (push
//      protection only with scanning, each true or false), switches
//      immutable releases with PUT or DELETE as the record says, switches
//      auto-merge in one PATCH of that key alone (#5182), reads everything
//      back, and a
//      second run changes nothing; a ruleset the record does not name stops
//      it and is never deleted; a repository the App is not installed on
//      stops for it with the link to the installation's settings while the
//      other is still matched; an entry's collaborators list takes off
//      whoever it does not name (never the owner), withdraws an unnamed
//      invitation, only reports who it names that is missing and never
//      invites anybody (no PUT), reads back, and changes nothing a second
//      time, and an entry with no list never touches its people;
//      and the real records/github-repo-settings.json, when there is one,
//      passes;
//   5. the App's setup: no armed setup, a wrong or expired state, and an App
//      already held are the plain 404; the armed page sends the manifest
//      (administration write, contents read, no webhook, private) to GitHub
//      with the state; GitHub's code comes back to /setup/done, the key
//      lands in the state folder, the setup is disarmed, and the key is in
//      neither the page nor the log; an App another account made is refused
//      and nothing is kept.
//   6. the redesign's part 20 (1 Nov 2026): an App or a deploy key may bypass
//      a tag ruleset and stops the record on a branch one; github-admin.yml's
//      nightly schedule passes the token check but is refused any change, and
//      its repository settings check opens one issue on the board while
//      GitHub differs (#5298), says so once, closes it with a comment once a
//      check matches, never touches a person's issue of the same title, and
//      fails the run when the board cannot be told; go-public is gone, and
//      the manifest asks for exactly what records/github-apps.json gives the
//      box admin App.
//
// Nothing leaves loopback, and nothing outside the temp folder is touched.
'use strict';
const fs = require('fs');
const os = require('os');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..');
const ADMIN = path.join(REPO, 'scripts', 'vps', 'admin', 'admin.js');
let pass = 0, fail = 0;
function yes(what, ok) { if (ok) { pass++; console.log('  ok   ' + what); } else { fail++; console.log('  FAIL ' + what); } }

const admin = require(ADMIN);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-admin-'));

const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const unb64url = s => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const now = () => Math.floor(Date.now() / 1000);

// GitHub's OIDC key, here, and one it does not publish.
const oidc = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const stray = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = Object.assign(oidc.publicKey.export({ format: 'jwk' }), { kid: 'gh-1', use: 'sig', alg: 'RS256' });
const JWKS = { keys: [jwk] };

function sign(claims, opts) {
  const o = opts || {};
  const head = b64url(JSON.stringify({ alg: o.alg || 'RS256', typ: 'JWT', kid: o.kid || 'gh-1' }));
  const body = b64url(JSON.stringify(claims));
  if (o.alg === 'none') return head + '.' + body + '.';
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), (o.key || oidc).privateKey);
  return head + '.' + body + '.' + b64url(sig);
}
function good(over) {
  const t = now();
  return Object.assign({
    iss: 'https://token.actions.githubusercontent.com', aud: 'thornswood-admin', iat: t - 5, nbf: t - 5, exp: t + 300,
    repository: 'ThornswoodRP/Thornswood-Ops', repository_id: '1435123931', ref: 'refs/heads/main',
    job_workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/main',
    workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/main',
    event_name: 'workflow_dispatch', run_id: '4242', actor: 'EvilPatrick06',
  }, over || {});
}
function why(token) {
  try { admin.verifyOidc(token, JWKS, now(), admin.RULES); return ''; } catch (e) { return e.message || 'refused'; }
}

// ---- 1. the OIDC check ----------------------------------------------------------
console.log('the OIDC check');
yes('a hand-started run of the ops repository\'s github-admin.yml on main passes', why(sign(good())) === '');
yes('the rules name the ops repository for the runners and this one for the records', admin.RULES.repositoryId === '1435123931' && admin.RUNNERS_REPO === 'ThornswoodRP/Thornswood-Ops' && admin.REPO === 'ThornswoodRP/Thornswood');
yes('one a push started fails, since a push here cannot start it there (#4013)', /started by push/.test(why(sign(good({ event_name: 'push' })))));
yes('its nightly schedule passes the token check (part 20); what a scheduled run may ask is held below', why(sign(good({ event_name: 'schedule' }))) === '');
yes('this repository\'s own github-admin.yml on main fails', /from ThornswoodRP\/Thornswood \(repository id 1365246621\)$/.test(why(sign(good({ repository: 'ThornswoodRP/Thornswood', repository_id: '1365246621', job_workflow_ref: 'ThornswoodRP/Thornswood/.github/workflows/github-admin.yml@refs/heads/main' })))));
// #5184: the ops repository is known by its id, so its move into the
// Thornswood organization changes nothing here.
yes('the ops repository moved into the organization still passes, by its id', why(sign(good({ repository: 'Thornswood/Thornswood-Ops',
  job_workflow_ref: 'Thornswood/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/main', workflow_ref: 'Thornswood/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/main' }))) === '');
yes('  but a repository with its old name and another id fails', /repository id 999/.test(why(sign(good({ repository_id: '999' })))));
yes('  and a token with no repository id fails', /repository id undefined/.test(why(sign(good({ repository_id: undefined })))));
yes('  and the workflow from another repository, called from it, fails', /workflow/.test(why(sign(good({ job_workflow_ref: 'ThornswoodRP/Thornswood/.github/workflows/github-admin.yml@refs/heads/main' })))));
yes('  with the audience as a list too', why(sign(good({ aud: ['x', 'thornswood-admin'] }))) === '');
yes('another workflow on main fails', /workflow/.test(why(sign(good({ job_workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/build.yml@refs/heads/main' })))));
yes('github-admin.yml from a branch fails',
  why(sign(good({ ref: 'refs/heads/claude/x', job_workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/claude/x' }))) !== '');
yes('  even with a ref claim that says main', /workflow/.test(why(sign(good({ job_workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/claude/x' })))));
yes('a pull request\'s run fails',
  why(sign(good({ ref: 'refs/pull/3323/merge', event_name: 'pull_request', job_workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/github-admin.yml@refs/pull/3323/merge' }))) !== '');
yes('  and a pull_request_target run on main, by its event', /started by/.test(why(sign(good({ event_name: 'pull_request_target' })))));
yes('another repository fails', /from ThornswoodRP\/skymp/.test(why(sign(good({ repository: 'ThornswoodRP/skymp', repository_id: '1375283516' })))));
yes('another audience fails', /audience/.test(why(sign(good({ aud: 'sigstore' })))));
yes('another issuer fails', /issued by/.test(why(sign(good({ iss: 'https://example.com' })))));
yes('an expired token fails', why(sign(good({ exp: now() - 1 }))) === 'expired');
yes('one signed by a key GitHub does not publish fails', /key GitHub does not publish/.test(why(sign(good(), { kid: 'other', key: stray }))));
yes('  or by another key under GitHub\'s key id', /signature/.test(why(sign(good(), { key: stray }))));
const real = sign(good()).split('.');
const changed = [real[0], b64url(JSON.stringify(good({ repository: 'ThornswoodRP/Thornswood', run_id: '1' }))), real[2]].join('.');
yes('one whose body was changed after signing fails', /signature/.test(why(changed)));
yes('one that says it needs no signature fails', /not RS256/.test(why(sign(good(), { alg: 'none' }))));
yes('something that is not a token fails', why('Bearer') === 'not a token' && why('') === 'not a token');

// ---- 2. the App's own token -------------------------------------------------------
console.log('the App\'s own token');
const app = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const appPem = app.privateKey.export({ type: 'pkcs1', format: 'pem' });
const jwt = admin.appJwt(123456, appPem, now()).split('.');
const jhead = JSON.parse(unb64url(jwt[0]));
const jbody = JSON.parse(unb64url(jwt[1]));
yes('RS256, signed by the App\'s key', jhead.alg === 'RS256' && crypto.verify('RSA-SHA256', Buffer.from(jwt[0] + '.' + jwt[1]), app.publicKey, unb64url(jwt[2])));
yes('issued by the App\'s id, ten minutes at most', jbody.iss === '123456' && jbody.exp - jbody.iat <= 600 && jbody.exp > now());

// ---- 3. the records and the plan ----------------------------------------------------
console.log('the records and the plan');
const base = ['self-hosted', 'Windows', 'X64', 'thornswood-vps'];
// GitHub marks the labels it gives a runner itself read-only, and ours custom.
const given = ['self-hosted', 'Windows', 'Linux', 'X64', 'ARM', 'ARM64'];
const runner = (id, name, labels, status) => ({ id, name, status: status || 'online', busy: false, labels: labels.map(n => ({ name: n, type: given.indexOf(n) >= 0 ? 'read-only' : 'custom' })) });
const mixed = [
  runner(1, 'thornswood-vps', base.concat('thornswood-build')),
  runner(2, 'thornswood-vps-2', base),
  runner(3, 'thornswood-vps-3', base.concat('thornswood-build')),
  runner(27, 'thornswood-vps-5', base.concat('thornswood-build')),
  runner(40, 'thornswood-pr-one', ['self-hosted', 'Windows', 'thornswood-pr', 'thornswood-build']),
];
const rec4 = { file: 'records/build-runners.json', label: 'thornswood-build', runners: [1, 2, 3, 4] };
const p = admin.planLabels(rec4, mixed);
const did = (name) => (p.changes.find(c => c.name === name) || {}).do;
yes('a listed runner without the label gets it', did('thornswood-vps-2') === 'put on');
yes('a VPS runner the record does not list loses it', did('thornswood-vps-5') === 'take off');
yes('  and so does an off-box runner, which never takes box jobs', did('thornswood-pr-one') === 'take off');
yes('a runner that is right is left alone', !did('thornswood-vps') && !did('thornswood-vps-3') && p.changes.length === 3);
yes('a listed runner GitHub does not have is named', p.lines.some(l => /runner 4 is in records\/build-runners\.json but not registered/.test(l)));
yes('  and nothing is refused', p.refuse === '');
// Build runners on One (26 Oct 2026): named in offBox, an off-box runner keeps it,
// but never one that carries thornswood-vps too.
const recOne = Object.assign({}, rec4, { offBox: ['thornswood-pr-one', 'thornswood-pr-one-2'] });
const withVps = mixed.concat([runner(41, 'thornswood-pr-one-2', ['self-hosted', 'Windows', 'thornswood-pr', 'thornswood-vps', 'thornswood-build'])]);
const pOne = admin.planLabels(recOne, withVps);
const didOne = (name) => (pOne.changes.find(c => c.name === name) || {}).do;
yes('an off-box runner the record names by name keeps the label', !didOne('thornswood-pr-one'));
yes('  but not one that also carries thornswood-vps', didOne('thornswood-pr-one-2') === 'take off');
yes('an off-box name with no runner under it is named', admin.planLabels(Object.assign({}, rec4, { offBox: ['thornswood-pr-one-5'] }), mixed).lines.some(l => /off-box runner thornswood-pr-one-5 is in/.test(l)));
yes('a record whose runners GitHub has none of is refused', /never comes/.test(admin.planLabels({ file: 'r', label: 'thornswood-build', runners: [9] }, mixed).refuse));
yes('runner numbers: thornswood-vps is 1, thornswood-vps-<n> is n, anything else none',
  admin.runnerNumber('thornswood-vps') === 1 && admin.runnerNumber('thornswood-vps-7') === 7 && admin.runnerNumber('thornswood-pr-one') === 0 && admin.runnerNumber('thornswood-vps-x') === 0);
function stops(records) { try { admin.checkRecords(records); return ''; } catch (e) { return e.message; } }
const light3 = { file: 'records/light-runners.json', label: 'thornswood-light', runners: [3] };
yes('two records with labels of their own pass together', stops([rec4, light3]) === '');
yes('a record naming thornswood-vps stops', /every runner carries/.test(stops([{ file: 'r', label: 'thornswood-vps', runners: [1] }])));
yes('  and one naming self-hosted', /every runner carries/.test(stops([{ file: 'r', label: 'self-hosted', runners: [1] }])));
yes('a record listing no runners stops', /lists no runners/.test(stops([{ file: 'r', label: 'thornswood-x', runners: [] }])));
yes('two records naming one label stop', /both name/.test(stops([rec4, Object.assign({}, light3, { label: 'thornswood-build' })])));
yes('a label that is not one lower case word stops', /one lower case word/.test(stops([{ file: 'r', label: 'a b', runners: [1] }])));
yes('an off-box name that is not thornswood-pr-* stops', /not thornswood-pr-/.test(stops([Object.assign({}, rec4, { offBox: ['thornswood-vps-9'] })])));
yes('an off-box name listed twice stops', /off-box runner twice/.test(stops([Object.assign({}, rec4, { offBox: ['thornswood-pr-one', 'thornswood-pr-one'] })])));
yes('a runner number below 1 stops', /number from 1/.test(stops([{ file: 'r', label: 'thornswood-x', runners: [0] }])));
// #4033: a label no record names comes off, whoever carries it.
const left = admin.planLeftovers([rec4], [
  runner(1, 'thornswood-vps', base.concat('thornswood-build', 'ARM')),
  runner(3, 'thornswood-vps-3', base.concat('thornswood-sign')),
  runner(40, 'thornswood-pr-one', ['self-hosted', 'Windows', 'thornswood-pr', 'Thornswood-Sign']),
]);
yes('a label of our own that no record names comes off every runner carrying it, in any case',
  left.length === 2 && left.some(c => c.name === 'thornswood-vps-3' && c.label === 'thornswood-sign' && c.id === 3) && left.some(c => c.name === 'thornswood-pr-one' && c.label === 'Thornswood-Sign'));
yes('  a record\'s label, a reserved one and one GitHub gives (read-only) stay', !left.some(c => /^(thornswood-build|thornswood-vps|thornswood-pr|ARM|self-hosted|Windows|X64)$/.test(c.label)));
yes('  and a label a record names stays, whatever its case', admin.planLeftovers([rec4, light3], [runner(3, 'thornswood-vps-3', base.concat('Thornswood-Light'))]).length === 0);
yes('the real records on this checkout pass', (() => {
  const dir = path.join(REPO, 'records');
  const recs = fs.readdirSync(dir).filter(f => /^[a-z0-9-]+-runners\.json$/.test(f)).map(f => {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    return { file: 'records/' + f, label: String(j.label || '').trim(), runners: (j.runners || []).map(Number) };
  });
  return recs.length > 0 && stops(recs) === '';
})());

// ---- 4a. the ruleset record and the plan ---------------------------------------------
console.log('the ruleset record and the plan');
const tagSet = {
  name: 'release tags', target: 'tag', enforcement: 'active', why: 'a note of the record\'s own',
  conditions: { ref_name: { include: ['refs/tags/v*'], exclude: [] } },
  rules: [{ type: 'creation' }, { type: 'update' }, { type: 'deletion' }],
  bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }, { actor_id: 5547080, actor_type: 'Integration', bypass_mode: 'always' }],
};
const mainSet = {
  name: 'main', target: 'branch', enforcement: 'disabled',
  conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
  rules: [{ type: 'deletion' }, { type: 'non_fast_forward' },
    { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'Launcher builds' }] } }],
  bypass_actors: [],
};
function rstops(list) { try { admin.checkRulesets('ThornswoodRP/Thornswood', list); return ''; } catch (e) { return e.message; } }
const with_ = (o, k, v) => Object.assign({}, o, { [k]: v });
yes('the two rulesets pass together', rstops([tagSet, mainSet]) === '');
yes('no list stops, and an empty one says there are none', /no rulesets list/.test(rstops(undefined)) && rstops([]) === '');
yes('a name twice stops', /twice/.test(rstops([tagSet, with_(mainSet, 'name', 'release tags')])));
yes('a target that is not branch or tag stops', /not branch or tag/.test(rstops([with_(tagSet, 'target', 'push')])));
yes('an enforcement that is not active or disabled stops', /not active or disabled/.test(rstops([with_(tagSet, 'enforcement', 'evaluate')])));
yes('a ruleset on no ref stops', /no ref/.test(rstops([with_(tagSet, 'conditions', { ref_name: { include: [] } })])));
yes('one with no rules, or a rule with no type, stops', /no rules/.test(rstops([with_(tagSet, 'rules', [])])) && /no type/.test(rstops([with_(tagSet, 'rules', [{}])])));
yes('one that does not say who may bypass it stops', /bypass/.test(rstops([with_(mainSet, 'bypass_actors', undefined)])));
// The redesign's part 20 (1 Nov 2026): an App or a deploy key bypasses a tag
// ruleset only, never a branch one.
const appBypass = { actor_id: 5547080, actor_type: 'Integration', bypass_mode: 'always' };
yes('GitHub Actions as a bypass stops, named, since GitHub refuses it (#5296)',
  /lets GitHub Actions \(15368\) bypass it, which GitHub refuses/.test(rstops([with_(tagSet, 'bypass_actors', [{ actor_id: 15368, actor_type: 'Integration', bypass_mode: 'always' }])])));
yes('an App may bypass a tag ruleset', rstops([with_(tagSet, 'bypass_actors', [appBypass])]) === '');
yes('an App that may bypass a branch ruleset stops, named', /main lets the App 5547080 bypass a branch ruleset; an App or a deploy key may bypass only a tag ruleset/.test(rstops([with_(mainSet, 'bypass_actors', [appBypass])])));
yes('  and so does a deploy key', /lets a deploy key bypass a branch ruleset/.test(rstops([with_(mainSet, 'bypass_actors', [{ actor_id: 7, actor_type: 'DeployKey', bypass_mode: 'always' }])])));
yes('  while a role on a branch ruleset still passes', rstops([with_(mainSet, 'bypass_actors', [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }])]) === '');
// What GitHub answered keeps its reasons (#5296): a 422 says why only in errors.
yes('a refusal names GitHub\'s reasons, strings or objects',
  admin.said({ status: 422, body: { message: 'Validation Failed', errors: ['Actor GitHub Actions integration must be part of the ruleset source or owner organization'] } }) ===
    'HTTP 422: Validation Failed (Actor GitHub Actions integration must be part of the ruleset source or owner organization)' &&
  admin.said({ status: 422, body: { message: 'Validation Failed', errors: [{ resource: 'Ruleset', field: 'bypass_actors', code: 'invalid' }, { message: 'one more' }] } }) ===
    'HTTP 422: Validation Failed (Ruleset bypass_actors invalid; one more)');
yes('  and says only the status and message when there are none', admin.said({ status: 404, body: { message: 'Not Found' } }) === 'HTTP 404: Not Found' &&
  admin.said({ status: 502, body: null }) === 'HTTP 502');
yes('the body sent is the ruleset\'s own keys, never the record\'s note',
  JSON.stringify(Object.keys(admin.rulesetBody(tagSet))) === '["name","target","enforcement","conditions","rules","bypass_actors"]');
// GitHub's copy, as it reads one back: ids, links and defaults of its own, lists in its own order.
const ghCopy = (r, id) => Object.assign(JSON.parse(JSON.stringify(admin.rulesetBody(r))), {
  id, source_type: 'Repository', source: 'ThornswoodRP/Thornswood', node_id: 'RRS_' + id, current_user_can_bypass: 'always',
  _links: { self: { href: 'x' } }, created_at: '2026-10-26T00:00:00Z', updated_at: '2026-10-26T00:00:00Z',
  rules: r.rules.slice().reverse().map(x => x.type === 'required_status_checks'
    ? { type: x.type, parameters: Object.assign({ do_not_enforce_on_create: false }, x.parameters) } : x),
  bypass_actors: r.bypass_actors.slice().reverse(),
});
yes('GitHub\'s copy with its own ids, defaults and order says what the record says', admin.says(admin.rulesetBody(tagSet), ghCopy(tagSet, 1)) && admin.says(admin.rulesetBody(mainSet), ghCopy(mainSet, 2)));
yes('  and not once a bypass actor is added on GitHub', !admin.says(admin.rulesetBody(tagSet), Object.assign(ghCopy(tagSet, 1), { bypass_actors: tagSet.bypass_actors.concat([{ actor_id: 4, actor_type: 'RepositoryRole', bypass_mode: 'always' }]) })));
yes('  or its enforcement is changed', !admin.says(admin.rulesetBody(mainSet), Object.assign(ghCopy(mainSet, 2), { enforcement: 'active' })));
yes('  or a required check is renamed', !admin.says(admin.rulesetBody(mainSet), Object.assign(ghCopy(mainSet, 2), { rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }, { type: 'required_status_checks', parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: 'Launcher builds (VPS fallback)' }] } }] })));
const rp = admin.planRulesets([tagSet, mainSet], [Object.assign(ghCopy(mainSet, 2), { enforcement: 'active' }), ghCopy(Object.assign({}, tagSet, { name: 'by hand' }), 9)]);
yes('the plan makes the missing one, puts the changed one back by its id, and names the one the record does not',
  rp.make.length === 1 && rp.make[0].name === 'release tags' && rp.put.length === 1 && rp.put[0].id === 2 && JSON.stringify(rp.extra) === '["by hand"]');
function sstops(doc) { try { admin.checkSettings(doc); return ''; } catch (e) { return e.message; } }
const forkMain = {
  name: 'main', target: 'branch', enforcement: 'active',
  conditions: { ref_name: { include: ['refs/heads/main'], exclude: [] } },
  rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
  bypass_actors: [],
};
const settings = () => ({ repositories: [
  { repository: 'ThornswoodRP/Thornswood', rulesets: [tagSet, mainSet] },
  { repository: 'ThornswoodRP/skymp', private_vulnerability_reporting: true, rulesets: [forkMain] },
] });
yes('Thornswood and the fork pass together', sstops(settings()) === '');
yes('the repositories it may change are Thornswood, the fork and Ops, and no other', JSON.stringify(admin.SETTINGS_REPOS) === '["ThornswoodRP/Thornswood","ThornswoodRP/skymp","ThornswoodRP/Thornswood-Ops"]');
// The merge methods and Ops (2 Nov 2026, after fork #147 and Ops #200 and #201 sat green).
const opsEntry = () => ({ repository: 'ThornswoodRP/Thornswood-Ops', allow_squash_merge: true, allow_merge_commit: false, allow_rebase_merge: false });
const methods = (e, sq, mc, rb) => Object.assign({}, e, { allow_squash_merge: sq, allow_merge_commit: mc, allow_rebase_merge: rb });
yes('Ops passes with its merge methods and no rulesets beside the other two', sstops({ repositories: settings().repositories.concat([opsEntry()]) }) === '');
yes('  Ops with a rulesets list stops, since GitHub Free keeps none on a private repository', /Thornswood-Ops: GitHub Free keeps no rulesets on a private repository/.test(sstops({ repositories: [with_(opsEntry(), 'rulesets', [])] })));
yes('  Ops with auto-merge on stops, since GitHub Free has none on a private repository', /Thornswood-Ops: GitHub Free has no auto-merge on a private repository/.test(sstops({ repositories: [with_(opsEntry(), 'allow_auto_merge', true)] })));
yes('  and the fork with no rulesets list still stops', /ThornswoodRP\/skymp: no rulesets list/.test(sstops({ repositories: [with_(settings().repositories[1], 'rulesets', undefined)] })));
yes('the merge methods pass all three given, one or more on', sstops({ repositories: [methods(settings().repositories[1], false, true, false)] }) === '' &&
  sstops({ repositories: [methods(settings().repositories[0], true, true, false)] }) === '');
yes('  one or two of them given stops, naming the missing ones', /names allow_squash_merge but not allow_merge_commit and allow_rebase_merge; the merge methods are all three or none/.test(sstops({ repositories: [with_(settings().repositories[0], 'allow_squash_merge', true)] })));
yes('  all three off stops, since GitHub refuses a repository with no way to merge', /allows no way to merge/.test(sstops({ repositories: [methods(settings().repositories[0], false, false, false)] })));
yes('  one that is not true or false stops, named', /allow_merge_commit is true or false/.test(sstops({ repositories: [methods(settings().repositories[0], true, 'no', false)] })));
yes('a record with no repositories stops', /names no repositories/.test(sstops({})) && /names no repositories/.test(sstops({ repositories: [] })));
yes('another repository stops, named', /names ThornswoodRP\/other, and the only ones/.test(sstops({ repositories: [{ repository: 'ThornswoodRP/other', rulesets: [] }] })));
yes('a repository named twice stops', /twice/.test(sstops({ repositories: [settings().repositories[1], settings().repositories[1]] })));
yes('reporting that is not true or false stops', /true or false/.test(sstops({ repositories: [with_(settings().repositories[1], 'private_vulnerability_reporting', 'yes')] })));
yes('immutable releases that is not true or false stops, named', /immutable_releases is true or false/.test(sstops({ repositories: [with_(settings().repositories[0], 'immutable_releases', 1)] })));
yes('auto-merge that is not true or false stops, named (#5182)', /allow_auto_merge is true or false/.test(sstops({ repositories: [with_(settings().repositories[0], 'allow_auto_merge', 'on')] })) &&
  sstops({ repositories: [with_(settings().repositories[0], 'allow_auto_merge', true)] }) === '');
yes('secret scanning that is not true or false stops, named', /secret_scanning is true or false/.test(sstops({ repositories: [with_(settings().repositories[1], 'secret_scanning', 'on')] })));
yes('push protection without secret scanning stops', /secret_scanning_push_protection is on only with secret_scanning on too/.test(sstops({ repositories: [with_(settings().repositories[1], 'secret_scanning_push_protection', true)] })) &&
  sstops({ repositories: [Object.assign({}, settings().repositories[1], { secret_scanning: true, secret_scanning_push_protection: true })] }) === '');
yes('a bad ruleset stops, naming its repository', /ThornswoodRP\/skymp: main targets push/.test(sstops({ repositories: [with_(settings().repositories[1], 'rulesets', [with_(forkMain, 'target', 'push')])] })));
yes('a list of collaborators passes, an empty one too (nobody but the owner)', sstops({ repositories: [with_(settings().repositories[1], 'collaborators', ['Ture-Neko', 'WiccanDjinn'])] }) === '' &&
  sstops({ repositories: [with_(settings().repositories[1], 'collaborators', [])] }) === '');
yes('collaborators that are not a list stop, named', /collaborators is a list of GitHub logins/.test(sstops({ repositories: [with_(settings().repositories[1], 'collaborators', { WiccanDjinn: 'write' })] })));
yes('a login GitHub could not have stops', /is not a GitHub login/.test(sstops({ repositories: [with_(settings().repositories[1], 'collaborators', ['two words'])] })) &&
  /is not a GitHub login/.test(sstops({ repositories: [with_(settings().repositories[1], 'collaborators', ['-x'])] })));
yes('Patrick listed as a collaborator stops', /evilpatrick06 owns these repositories, is not a collaborator/.test(sstops({ repositories: [with_(settings().repositories[1], 'collaborators', ['evilpatrick06'])] })));
yes('  and so does the organization (#5184)', /ThornswoodRP owns these repositories, is not a collaborator/.test(sstops({ repositories: [with_(settings().repositories[1], 'collaborators', ['ThornswoodRP'])] })));
yes('a collaborator named twice, in any case, stops', /names the collaborator wiccandjinn twice/.test(sstops({ repositories: [with_(settings().repositories[1], 'collaborators', ['WiccanDjinn', 'wiccandjinn'])] })));
const pc = admin.planCollaborators(['WiccanDjinn', 'NewPerson', 'Asked'],
  [{ login: 'EvilPatrick06' }, { login: 'wiccandjinn' }, { login: 'Jhinswife' }],
  [{ id: 5, invitee: { login: 'Asked' } }, { id: 6, invitee: { login: 'Stale' } }]);
yes('the people plan takes off whoever the list does not name and never the owner, withdraws an unnamed invitation, names who is missing, and compares logins in any case',
  JSON.stringify(pc.drop) === '["Jhinswife"]' && JSON.stringify(pc.withdraw) === '[{"id":6,"login":"Stale"}]' && JSON.stringify(pc.missing) === '["NewPerson"]' && JSON.stringify(pc.right) === '["WiccanDjinn"]' &&
  !('invite' in pc));
yes('the real records/github-repo-settings.json, when there is one, passes', (() => {
  const f = path.join(REPO, 'records', 'github-repo-settings.json');
  if (!fs.existsSync(f)) return true;
  return sstops(JSON.parse(fs.readFileSync(f, 'utf8'))) === '';
})());
// ---- 3b. the About record (#3682) ---------------------------------------------------
console.log('the About record');
const aboutReal = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'repo-about.json'), 'utf8'));
const aboutRec = (o) => Object.assign({ file: 'records/repo-about.json', description: aboutReal.description, homepage: aboutReal.homepage, topics: aboutReal.topics.slice() }, o || {});
function aboutStops(r) { try { admin.checkAbout(r); return ''; } catch (e) { return e.message; } }
yes('the real records/repo-about.json passes', aboutStops(aboutRec()) === '');
yes('an empty description stops', /empty/.test(aboutStops(aboutRec({ description: ' ' }))));
yes('one longer than GitHub takes stops', /350/.test(aboutStops(aboutRec({ description: 'x'.repeat(351) }))));
yes('one of two lines stops', /one line/.test(aboutStops(aboutRec({ description: 'a\nb' }))));
yes('a website that is not https stops', /https/.test(aboutStops(aboutRec({ homepage: 'http://thornswood.net' }))));
yes('  and no website at all is allowed', aboutStops(aboutRec({ homepage: '' })) === '');
yes('a topic in capitals stops', /lower case/.test(aboutStops(aboutRec({ topics: ['Skyrim'] }))));
yes('a topic twice stops', /twice/.test(aboutStops(aboutRec({ topics: ['skyrim', 'skyrim'] }))));
yes('more topics than GitHub takes stops', /20/.test(aboutStops(aboutRec({ topics: Array.from({ length: 21 }, (_, i) => 't' + i) }))));
const ap = admin.planAbout(aboutRec(), { description: null, homepage: null }, []);
yes('an empty About box differs in all three parts', ap.length === 3 && ap.map(c => c.what).join(',') === 'description,website,topics');
yes('topics in another order are the same', admin.planAbout(aboutRec(), { description: aboutReal.description, homepage: aboutReal.homepage }, aboutReal.topics.slice().reverse()).length === 0);

// ---- 4 and 5. the service, against a stand-in GitHub ---------------------------------
const gh = {
  calls: [],
  records: {
    'build-runners.json': { label: 'thornswood-build', runners: [1, 2] },
  },
  runners: [
    runner(11, 'thornswood-vps', base.concat('thornswood-build')),
    runner(12, 'thornswood-vps-2', base),
    // Runner 3 as #4033 found it: the signing record is gone, its label is not.
    runner(13, 'thornswood-vps-3', base.concat('thornswood-build', 'thornswood-sign')),
    runner(14, 'thornswood-vps-4', base),
  ],
  repo: { full_name: 'ThornswoodRP/Thornswood', description: null, homepage: null, allow_auto_merge: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, security_and_analysis: { secret_scanning: { status: 'disabled' }, secret_scanning_push_protection: { status: 'disabled' } } },
  topics: [],
  instToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  readToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  aboutToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  settingsToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  installed: true,
  repoToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  installRepos: ['ThornswoodRP/Thornswood-Ops', 'ThornswoodRP/Thornswood'],
  conversion: null,
  instPerms: { administration: 'write', contents: 'read', metadata: 'read' },
  settings: {
    '/repos/ThornswoodRP/Thornswood/actions/permissions': { enabled: true, allowed_actions: 'all', sha_pinning_required: false },
    '/repos/ThornswoodRP/Thornswood/actions/permissions/workflow': { default_workflow_permissions: 'read', can_approve_pull_request_reviews: false },
    '/repos/ThornswoodRP/Thornswood/actions/permissions/access': { access_level: 'none' },
    '/repos/ThornswoodRP/Thornswood/actions/permissions/artifact-and-log-retention': { days: 90, maximum_allowed_days: 400 },
    '/repos/ThornswoodRP/Thornswood/actions/permissions/fork-pr-workflows-private-repos': { run_workflows_from_fork_pull_requests: false, send_write_tokens_to_workflows: false, send_secrets_and_variables: false, require_approval_for_fork_pr_workflows: false },
  },
  repoNames: { secrets: ['CLOUDFLARE_TURNSTILE_TOKEN'], variables: ['BUILD_RUNNER'] },
  envNames: { board: { secrets: ['BOARD_TOKEN'], variables: [] }, notices: { secrets: ['NOTICE_KEY_B64'], variables: [] } },
  forkToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  forkInstalled: true,
  // The Discord bot's issues token (#5184), and whether the installation
  // holds Issues write yet.
  botToken: 'ghs_' + crypto.randomBytes(16).toString('hex'),
  botGranted: true,
  issues: [{ number: 1, title: 'GitHub\'s repository settings differ from the record', body: 'by a person', state: 'open', user: { login: 'EvilPatrick06' }, comments: [] }],
  nextIssue: 50,
  sets: { Thornswood: [], skymp: [] },
  pvr: { Thornswood: false, skymp: false },
  immutable: { Thornswood: false, skymp: false },
  forkRepo: { full_name: 'ThornswoodRP/skymp', allow_auto_merge: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true, security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } },
  // The private ops repository on GitHub Free: no rulesets, no auto-merge.
  // opsIgnores: GitHub answers a PATCH 200 and keeps the old values.
  opsRepo: { full_name: 'ThornswoodRP/Thornswood-Ops', private: true, allow_auto_merge: false, allow_squash_merge: true, allow_merge_commit: true, allow_rebase_merge: true },
  opsIgnores: false,
  nextRuleset: 100,
  people: { Thornswood: ['Jhinswife', 'WiccanDjinn'], skymp: ['Ture-Neko', 'WiccanDjinn'] },
  invites: { Thornswood: [], skymp: [{ id: 40, invitee: { login: 'Stale' }, permissions: 'write' }] },
};
gh.records['github-settings.json'] = { environments: { board: {}, notices: {}, 'bad name/../x': {} } };
const appKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const appKeyPem = appKey.privateKey.export({ type: 'pkcs1', format: 'pem' });

function standIn(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const u = new URL(req.url, 'http://x');
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
    gh.calls.push({ method: req.method, path: u.pathname + u.search, auth: req.headers.authorization || '', body });
    const send = (code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
    const asApp = () => {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (!m) return false;
      const t = m[1].split('.');
      return t.length === 3 && crypto.verify('RSA-SHA256', Buffer.from(t[0] + '.' + t[1]), appKey.publicKey, unb64url(t[2]));
    };
    // The token for the ops repository changes runners; the read token for
    // this repository reads records, and the About token sets its About box.
    // Each is good for its own paths alone.
    const asInst = () => req.headers.authorization === 'Bearer ' + gh.instToken;
    const asRead = () => req.headers.authorization === 'Bearer ' + gh.readToken || req.headers.authorization === 'Bearer ' + gh.aboutToken;
    const asAbout = () => req.headers.authorization === 'Bearer ' + gh.aboutToken;
    const P = u.pathname;
    // repo-settings (#3683) changes Thornswood with its administration write
    // token, the About one, and the fork with the fork's alone.
    const asAdmin = () => req.headers.authorization === 'Bearer ' + (P.startsWith('/repos/ThornswoodRP/skymp/') ? gh.forkToken : gh.aboutToken);
    if (P === '/jwks') return send(200, JWKS);
    if (P === '/repos/ThornswoodRP/Thornswood/installation' || P === '/repos/ThornswoodRP/Thornswood-Ops/installation') return !asApp() ? send(401, { message: 'Bad credentials' }) : gh.installed ? send(200, { id: 77, permissions: gh.instPerms }) : send(404, { message: 'Not Found' });
    if (P === '/app/installations/77/access_tokens' && req.method === 'POST') {
      if (!asApp()) return send(401, { message: 'Bad credentials' });
      const perms = JSON.stringify((body && body.permissions) || {});
      if (body && body.repositories === undefined) return perms === '{"metadata":"read"}' ? send(201, { token: gh.repoToken }) : send(422, { message: 'not a metadata token' });
      const repos = JSON.stringify((body && body.repositories) || []);
      if (repos === '["Thornswood-Ops"]') return perms === '{"administration":"write"}' ? send(201, { token: gh.instToken }) : send(422, { message: 'not a runner token' });
      if (repos === '["Thornswood"]' && perms === '{"issues":"write"}') return gh.botGranted ? send(201, { token: gh.botToken, expires_at: '2026-11-01T05:00:00Z' }) : send(422, { message: 'The permissions requested are not granted to this installation.' });
      if (repos === '["Thornswood"]') return perms === '{"contents":"read"}' ? send(201, { token: gh.readToken }) : perms === '{"administration":"write","contents":"read"}' ? send(201, { token: gh.aboutToken }) :
        /^\{"administration":"read","contents":"read"/.test(perms) && Object.values(body.permissions).every(v => v === 'read') ? send(201, { token: gh.settingsToken }) : send(422, { message: 'no such permissions' });
      // repo-settings' fork token (#3683): administration write on skymp alone,
      // which GitHub refuses while the installation does not hold skymp.
      if (repos === '["skymp"]') return !gh.forkInstalled ? send(422, { message: 'There is at least one repository that does not exist or is not accessible to the parent installation.' }) :
        perms === '{"administration":"write"}' ? send(201, { token: gh.forkToken }) : send(422, { message: 'not a fork token' });
      return send(422, { message: 'no such repositories' });
    }
    if (P === '/installation/repositories') return req.headers.authorization === 'Bearer ' + gh.repoToken ? send(200, { total_count: gh.installRepos.length, repositories: gh.installRepos.map(n => ({ full_name: n })) }) : send(401, { message: 'Bad credentials' });
    if (P.startsWith('/repos/ThornswoodRP/Thornswood/contents/') && !asRead() && req.headers.authorization !== 'Bearer ' + gh.settingsToken) return send(401, { message: 'Bad credentials' });
    if ((P === '/repos/ThornswoodRP/Thornswood' || P === '/repos/ThornswoodRP/Thornswood/topics') && !asAbout()) return send(401, { message: 'Bad credentials' });
    if (P.startsWith('/repos/ThornswoodRP/Thornswood-Ops/actions/') && !asInst()) return send(401, { message: 'Bad credentials' });
    if (P.startsWith('/repos/ThornswoodRP/Thornswood/actions/') || P.startsWith('/repos/ThornswoodRP/Thornswood/environments/')) { if (req.headers.authorization !== 'Bearer ' + gh.settingsToken) return send(401, { message: 'Bad credentials' }); }
    if (P === '/repos/ThornswoodRP/Thornswood/contents/records') {
      if (u.searchParams.get('ref') !== 'main') return send(404, { message: 'No commit found for the ref' });
      return send(200, Object.keys(gh.records).concat(['README.md']).map(n => ({ type: 'file', name: n })));
    }
    if (P === '/repos/ThornswoodRP/Thornswood/contents/records/github-repo-settings.json') {
      if (u.searchParams.get('ref') !== 'main' || !gh.settingsRecord) return send(404, { message: 'Not Found' });
      return send(200, { content: Buffer.from(JSON.stringify(gh.settingsRecord)).toString('base64') });
    }
    let m = /^\/repos\/ThornswoodRP\/Thornswood\/contents\/records\/(.+)$/.exec(P);
    if (m && gh.records[m[1]] && u.searchParams.get('ref') === 'main') return send(200, { content: Buffer.from(JSON.stringify(gh.records[m[1]])).toString('base64') });
    if (/^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/(rulesets|private-vulnerability-reporting|immutable-releases|collaborators|invitations)/.test(P) && !asAdmin()) return send(401, { message: 'Bad credentials' });
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/collaborators$/.exec(P);
    if (m && req.method === 'GET') {
      if (u.searchParams.get('affiliation') !== 'direct') return send(400, { message: 'ask for the direct ones' });
      return send(200, [{ login: 'EvilPatrick06', role_name: 'admin' }].concat(gh.people[m[1]].map(l => ({ login: l, role_name: 'write' }))));
    }
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/collaborators\/([^/]+)$/.exec(P);
    if (m && req.method === 'DELETE') { const i = gh.people[m[1]].indexOf(m[2]); if (i < 0) return send(404, { message: 'Not Found' }); gh.people[m[1]].splice(i, 1); return send(204); }
    if (m && req.method === 'PUT') {
      gh.people[m[1]].push(m[2]);
      return send(204);
    }
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/invitations$/.exec(P);
    if (m && req.method === 'GET') return send(200, gh.invites[m[1]]);
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/invitations\/(\d+)$/.exec(P);
    if (m && req.method === 'DELETE') { const i = gh.invites[m[1]].findIndex(x => x.id === Number(m[2])); if (i < 0) return send(404, { message: 'Not Found' }); gh.invites[m[1]].splice(i, 1); return send(204); }
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/rulesets$/.exec(P);
    if (m && req.method === 'GET') {
      if (u.searchParams.get('includes_parents') !== 'false') return send(400, { message: 'ask for this repository\'s own' });
      return send(200, gh.sets[m[1]].map(r => ({ id: r.id, name: r.name, target: r.target, enforcement: r.enforcement, source_type: 'Repository' })));
    }
    if (m && req.method === 'POST') {
      const sets = gh.sets[m[1]];
      if (sets.some(r => r.name === body.name)) return send(422, { message: 'Name must be unique' });
      const made = ghCopy(body, gh.nextRuleset++);
      sets.push(made);
      return send(201, made);
    }
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/rulesets\/(\d+)$/.exec(P);
    if (m) {
      const sets = gh.sets[m[1]];
      const i = sets.findIndex(r => r.id === Number(m[2]));
      if (i < 0) return send(404, { message: 'Not Found' });
      if (req.method === 'GET') return send(200, sets[i]);
      if (req.method === 'PUT') { sets[i] = ghCopy(body, sets[i].id); return send(200, sets[i]); }
      if (req.method === 'DELETE') { sets.splice(i, 1); return send(204); }
    }
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/immutable-releases$/.exec(P);
    if (m) {
      if (req.method === 'GET') return send(200, { enabled: gh.immutable[m[1]], enforced_by_owner: false });
      if (req.method === 'PUT') { gh.immutable[m[1]] = true; return send(204); }
      if (req.method === 'DELETE') { gh.immutable[m[1]] = false; return send(204); }
    }
    m = /^\/repos\/ThornswoodRP\/(Thornswood|skymp)\/private-vulnerability-reporting$/.exec(P);
    if (m) {
      if (req.method === 'GET') return send(200, { enabled: gh.pvr[m[1]] });
      if (req.method === 'PUT') { gh.pvr[m[1]] = true; return send(204); }
      if (req.method === 'DELETE') { gh.pvr[m[1]] = false; return send(204); }
    }
    // The board, for a scheduled settings check (part 20), with the bot's
    // issues token alone.
    if (/^\/repos\/ThornswoodRP\/Thornswood\/issues/.test(P)) {
      if (req.headers.authorization !== 'Bearer ' + gh.botToken) return send(401, { message: 'Bad credentials' });
      if (P === '/repos/ThornswoodRP/Thornswood/issues' && req.method === 'GET') {
        if (u.searchParams.get('state') !== 'open') return send(400, { message: 'ask for the open ones' });
        return send(200, gh.issues.filter(i => i.state === 'open' && i.user.login === u.searchParams.get('creator')));
      }
      if (P === '/repos/ThornswoodRP/Thornswood/issues' && req.method === 'POST') {
        const made = { number: gh.nextIssue++, title: body.title, body: body.body, state: 'open', user: { login: 'thornswood-box-admin[bot]' }, comments: [] };
        gh.issues.push(made);
        return send(201, made);
      }
      const mi = /^\/repos\/ThornswoodRP\/Thornswood\/issues\/(\d+)(\/comments)?$/.exec(P);
      const issue = mi && gh.issues.find(i => i.number === Number(mi[1]));
      if (!issue) return send(404, { message: 'Not Found' });
      if (mi[2] && req.method === 'POST') { issue.comments.push(body.body); return send(201, { body: body.body }); }
      if (!mi[2] && req.method === 'PATCH') { Object.assign(issue, body); return send(200, issue); }
    }
    if (P === '/repos/ThornswoodRP/Thornswood' && req.method === 'GET') return send(200, gh.repo);
    if (P === '/repos/ThornswoodRP/Thornswood' && req.method === 'PATCH') {
      // GitHub switches only the security_and_analysis keys a PATCH names.
      const sa = Object.assign({}, gh.repo.security_and_analysis, body.security_and_analysis || {});
      Object.assign(gh.repo, body, { security_and_analysis: sa });
      return send(200, gh.repo);
    }
    if (P === '/repos/ThornswoodRP/skymp') {
      if (req.headers.authorization !== 'Bearer ' + gh.forkToken) return send(401, { message: 'Bad credentials' });
      if (req.method === 'GET') return send(200, gh.forkRepo);
      if (req.method === 'PATCH') {
        const sa = Object.assign({}, gh.forkRepo.security_and_analysis, body.security_and_analysis || {});
        Object.assign(gh.forkRepo, body, { security_and_analysis: sa });
        return send(200, gh.forkRepo);
      }
    }
    if (P === '/repos/ThornswoodRP/Thornswood-Ops') {
      if (!asInst()) return send(401, { message: 'Bad credentials' });
      if (req.method === 'GET') return send(200, gh.opsRepo);
      if (req.method === 'PATCH') { if (!gh.opsIgnores) Object.assign(gh.opsRepo, body); return send(200, gh.opsRepo); }
    }
    if (P.startsWith('/repos/ThornswoodRP/Thornswood-Ops/rulesets')) return send(403, { message: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' });
    if (P === '/repos/ThornswoodRP/Thornswood/topics' && req.method === 'GET') return send(200, { names: gh.topics });
    if (P === '/repos/ThornswoodRP/Thornswood/topics' && req.method === 'PUT') { gh.topics = body.names.slice(); return send(200, { names: gh.topics }); }
    if (P === '/repos/ThornswoodRP/Thornswood-Ops/actions/runners') return send(200, { total_count: gh.runners.length, runners: gh.runners });
    // This repository's own runners, which the settings read lists.
    if (P === '/repos/ThornswoodRP/Thornswood/actions/runners') return send(200, { total_count: gh.runners.length, runners: gh.runners });
    if (req.method === 'GET' && gh.settings[P]) return send(200, gh.settings[P]);
    m = /^\/repos\/ThornswoodRP\/Thornswood\/(?:environments\/([^/]+)\/)?actions\/(secrets|variables)$|^\/repos\/ThornswoodRP\/Thornswood\/environments\/([^/]+)\/(secrets|variables)$/.exec(P);
    if (m && req.method === 'GET') {
      const env = m[3] ? decodeURIComponent(m[3]) : '';
      const kind = m[2] || m[4];
      const names = env ? ((gh.envNames[env] || {})[kind] || []) : (gh.repoNames[kind] || []);
      return send(200, { total_count: names.length, [kind]: names.map(n => ({ name: n, value: kind === 'variables' ? 'the value' : undefined })) });
    }
    m = /^\/repos\/ThornswoodRP\/Thornswood-Ops\/actions\/runners\/(\d+)\/labels(?:\/(.+))?$/.exec(P);
    if (m) {
      const r = gh.runners.find(x => x.id === Number(m[1]));
      if (!r) return send(404, { message: 'Not Found' });
      if (req.method === 'POST') { for (const l of body.labels) if (!r.labels.some(x => x.name === l)) r.labels.push({ name: l, type: 'custom' }); return send(200, { labels: r.labels }); }
      if (req.method === 'DELETE') { r.labels = r.labels.filter(x => x.name !== decodeURIComponent(m[2])); return send(200, { labels: r.labels }); }
    }
    m = /^\/app-manifests\/([^/]+)\/conversions$/.exec(P);
    if (m && req.method === 'POST') return gh.conversion ? send(201, gh.conversion) : send(404, { message: 'Not Found' });
    send(404, { message: 'Not Found' });
  });
}

function ask(port, method, p, headers, body) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    const h = Object.assign({}, headers || {});
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h }, res => {
      const c = [];
      res.on('data', x => c.push(x));
      res.on('end', () => {
        const text = Buffer.concat(c).toString('utf8');
        let j = null;
        try { j = JSON.parse(text); } catch (e) { j = null; }
        resolve({ status: res.statusCode, headers: res.headers, text, json: j });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function start(stateDir, ghPort, more) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ADMIN], {
      env: Object.assign({}, process.env, more || {}, {
        THORNSWOOD_ADMIN_PORT: '0', THORNSWOOD_ADMIN_STATE: stateDir,
        THORNSWOOD_ADMIN_GITHUB_API: 'http://127.0.0.1:' + ghPort, THORNSWOOD_ADMIN_GITHUB_WEB: 'http://127.0.0.1:' + ghPort + '/web',
        THORNSWOOD_ADMIN_JWKS: 'http://127.0.0.1:' + ghPort + '/jwks',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const t = setTimeout(() => reject(new Error('admin.js did not start: ' + out)), 10000);
    child.stdout.on('data', d => {
      out += d;
      const m = /listening on 127\.0\.0\.1:(\d+)/.exec(out);
      if (m && !child.port) { child.port = Number(m[1]); clearTimeout(t); resolve(child); }
    });
    child.stderr.on('data', d => { out += d; });
    child.log = () => out;
    child.on('exit', () => { clearTimeout(t); if (!child.port) reject(new Error('admin.js exited: ' + out)); });
  });
}

(async () => {
  const stand = http.createServer(standIn);
  await new Promise(r => stand.listen(0, '127.0.0.1', r));
  const ghPort = stand.address().port;
  const state = path.join(tmp, 'state');
  fs.mkdirSync(state);
  const svc = await start(state, ghPort);
  const P = svc.port;
  const bearer = t => ({ Authorization: 'Bearer ' + t });
  const ask4 = (headers, body) => ask(P, 'POST', '/converge', headers, body === undefined ? { what: 'runner-labels' } : body);
  try {
    // #5184: a repository that moved answers with a redirect to where it is
    // now; call follows it the way GitHub's REST guide says, on the same
    // host only and at most five times.
    console.log('redirects');
    const seen = [];
    const mover = http.createServer((q, s) => {
      const c = [];
      q.on('data', d => c.push(d));
      q.on('end', () => {
        seen.push({ method: q.method, url: q.url, auth: q.headers.authorization || '', body: Buffer.concat(c).toString('utf8') });
        const go = (code, to) => { s.writeHead(code, { Location: to }); s.end(); };
        if (q.url === '/repos/ThornswoodRP/Thornswood-Ops/x') return go(301, '/repositories/1435123931/x');
        if (q.url === '/repos/ThornswoodRP/Thornswood-Ops/y') return go(307, '/repositories/1435123931/y');
        if (q.url === '/away') return go(301, 'http://other.example/x');
        if (q.url.startsWith('/loop')) return go(302, '/loop' + q.url.length);
        s.writeHead(200, { 'Content-Type': 'application/json' });
        s.end(JSON.stringify({ at: q.url, method: q.method }));
      });
    });
    await new Promise(r => mover.listen(0, '127.0.0.1', r));
    const M = 'http://127.0.0.1:' + mover.address().port;
    try {
      let a = await admin.call('GET', M + '/repos/ThornswoodRP/Thornswood-Ops/x', { Authorization: 'Bearer t' });
      yes('a read that GitHub moved (301) is followed to where it is now', a.status === 200 && a.body.at === '/repositories/1435123931/x' &&
        seen[seen.length - 1].auth === 'Bearer t');
      seen.length = 0;
      a = await admin.call('POST', M + '/repos/ThornswoodRP/Thornswood-Ops/y', { Authorization: 'Bearer t' }, { labels: ['a'] });
      yes('  a change sent on with 307 is followed with the same method and body', a.status === 200 && a.body.method === 'POST' &&
        seen.length === 2 && seen[1].body === '{"labels":["a"]}');
      a = await admin.call('POST', M + '/repos/ThornswoodRP/Thornswood-Ops/x', {}, { labels: ['a'] });
      yes('  a change answered 301 is not turned into a read; the 301 comes back', a.status === 301);
      seen.length = 0;
      a = await admin.call('GET', M + '/away', { Authorization: 'Bearer t' });
      yes('  a redirect to another host is not followed, so the token goes nowhere else', a.status === 301 && /another host/.test(a.body.message) && seen.length === 1);
      seen.length = 0;
      a = await admin.call('GET', M + '/loop', {});
      yes('  a loop stops after five', a.status === 302 && /more than 5/.test(a.body.message) && seen.length === 6);
    } finally {
      mover.close();
    }

    console.log('the service');
    let r = await ask(P, 'GET', '/', {});
    yes('a plain request is the plain 404, which says which service it is', r.status === 404 && r.text === 'box admin: not here');
    gh.calls = [];
    r = await ask4(Object.assign({ 'X-Forwarded-For': '203.0.113.9' }, bearer(sign(good()))));
    yes('anything through Caddy but the setup pages is the plain 404, even a good token', r.status === 404 && r.text === 'box admin: not here' && gh.calls.length === 0);
    r = await ask(P, 'GET', '/converge', bearer(sign(good())));
    yes('  and so is a GET', r.status === 404);
    r = await ask4({});
    yes('no token: 403, and GitHub is asked nothing but its keys', r.status === 403 && gh.calls.every(c => c.path === '/jwks'));
    gh.calls = [];
    r = await ask4(bearer(sign(good({ ref: 'refs/heads/claude/x', job_workflow_ref: 'ThornswoodRP/Thornswood-Ops/.github/workflows/github-admin.yml@refs/heads/claude/x' }))));
    yes('a branch\'s token: 403, and nothing but the keys asked', r.status === 403 && /refs\/heads\/claude\/x/.test(r.text) && gh.calls.every(c => c.path === '/jwks'));
    r = await ask4(bearer(sign(good({ aud: 'sigstore' }))));
    yes('a token for another audience: 403', r.status === 403);
    r = await ask4(bearer(sign(good())));
    yes('with no App yet it says how to make one (503)', r.status === 503 && /Install-AdminService\.ps1 -Setup/.test(r.text));
    r = await ask4(bearer(sign(good())), { what: 'secrets' });
    yes('anything but runner-labels, installation-repos, repo-about, settings and repo-settings is refused (400)', r.status === 400 && /runner-labels, installation-repos, repo-about, settings and repo-settings/.test(r.text));
    r = await ask4(bearer(sign(good())), { what: 'go-public' });
    yes('  go-public among them: it is retired (part 20), and the App no longer writes secrets', r.status === 400);

    // The App, as the setup would leave it.
    fs.writeFileSync(path.join(state, 'key.pem'), appKeyPem);
    fs.writeFileSync(path.join(state, 'app.json'), JSON.stringify({ id: 123456, slug: 'thornswood-box-admin', owner: 'EvilPatrick06' }));
    gh.installed = false;
    r = await ask4(bearer(sign(good())));
    yes('an App not installed says where to install it', r.status === 502 && /not installed/.test(r.text) && /installations\/new/.test(r.text));
    gh.installed = true;

    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'runner-labels', check: true });
    const writes = () => gh.calls.filter(c => c.method === 'POST' && /labels/.test(c.path) || c.method === 'DELETE');
    yes('a check answers 200 with what differs, and changes nothing', r.status === 200 && r.json.ok && r.json.differs === 3 && r.json.changed === 0 && writes().length === 0);
    yes('  runner 2 would get the build label, runner 3 lose it', r.json.lines.some(l => /thornswood-vps-2 would have thornswood-build put on/.test(l)) && r.json.lines.some(l => /thornswood-vps-3 would have thornswood-build taken off/.test(l)));
    yes('  and runner 3 thornswood-sign, which no record names', r.json.lines.some(l => /no record names thornswood-sign: thornswood-vps-3 would have it taken off/.test(l)));
    const toks = gh.calls.filter(c => /access_tokens$/.test(c.path)).map(c => JSON.stringify(c.body));
    yes('two installation tokens: contents read on this repository alone, administration write on the ops repository alone (' + toks.join(' ') + ')',
      toks.length === 2 && toks.includes(JSON.stringify({ repositories: ['Thornswood'], permissions: { contents: 'read' } })) && toks.includes(JSON.stringify({ repositories: ['Thornswood-Ops'], permissions: { administration: 'write' } })));
    const recs = gh.calls.filter(c => /contents\/records/.test(c.path));
    yes('the records come from this repository\'s main, read with the read token', recs.length > 0 && recs.every(c => c.path.startsWith('/repos/ThornswoodRP/Thornswood/contents/') && /ref=main/.test(c.path) && c.auth === 'Bearer ' + gh.readToken));
    const lists = gh.calls.filter(c => /actions\/runners/.test(c.path));
    yes('  and the runners are the ops repository\'s, asked with its token', lists.length > 0 && lists.every(c => c.path.startsWith('/repos/ThornswoodRP/Thornswood-Ops/actions/runners') && c.auth === 'Bearer ' + gh.instToken));

    // The sign label is on runner 3 and no record names it: #4033's case.
    gh.calls = [];
    r = await ask4(bearer(sign(good())));
    yes('a run puts every label right (200, 3 changed)', r.status === 200 && r.json.ok && r.json.changed === 3);
    const labels = n => gh.runners.find(x => x.name === n).labels.map(l => l.name);
    yes('  runner 1 and 2 carry the build label, 3 and 4 do not',
      labels('thornswood-vps').includes('thornswood-build') && labels('thornswood-vps-2').includes('thornswood-build') && !labels('thornswood-vps-3').includes('thornswood-build') && !labels('thornswood-vps-4').includes('thornswood-build'));
    yes('  no runner carries thornswood-sign any more', gh.runners.every(x => !labels(x.name).includes('thornswood-sign')) && r.json.lines.some(l => /no record names thornswood-sign: thornswood-vps-3, taken off/.test(l)));
    yes('  the labels every runner carries are untouched', gh.runners.every(x => base.every(b => labels(x.name).includes(b))));
    yes('  each change is one call with the installation token', writes().length === 3 && writes().every(c => c.auth === 'Bearer ' + gh.instToken));
    yes('  and it reads them back after', gh.calls.filter(c => /actions\/runners\?/.test(c.path)).length === 2);
    gh.calls = [];
    r = await ask4(bearer(sign(good())));
    yes('a second run changes nothing', r.status === 200 && r.json.changed === 0 && writes().length === 0);
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'installation-repos', check: false });
    const repoTok = gh.calls.find(c => /access_tokens$/.test(c.path));
    yes('installation-repos lists the repositories the App is on, sorted (200)',
      r.status === 200 && r.json.ok && JSON.stringify(r.json.repos) === '["ThornswoodRP/Thornswood","ThornswoodRP/Thornswood-Ops"]' && r.json.lines.includes('installed on ThornswoodRP/Thornswood-Ops'));
    yes('  with a token that reads metadata alone, for no one repository',
      repoTok && repoTok.body.repositories === undefined && JSON.stringify(repoTok.body.permissions) === '{"metadata":"read"}');
    yes('  asked with that token, and changing nothing, reading no record and no runner',
      gh.calls.some(c => c.path.startsWith('/installation/repositories') && c.auth === 'Bearer ' + gh.repoToken) && writes().length === 0 && !gh.calls.some(c => /contents\/records|actions\/runners/.test(c.path)));
    gh.installRepos = [];
    r = await ask4(bearer(sign(good())), { what: 'installation-repos' });
    yes('  an installation on no repository says so', r.status === 200 && r.json.repos.length === 0 && r.json.lines[0] === 'installed on no repository');
    gh.installRepos = ['ThornswoodRP/Thornswood-Ops', 'ThornswoodRP/Thornswood'];
    r = await ask4(bearer(sign(good())), { what: 'runner-labels', records: { 'x-runners.json': { label: 'thornswood-x', runners: [4] } } });
    yes('records sent by the caller are not used', r.status === 200 && r.json.changed === 0 && !labels('thornswood-vps-4').includes('thornswood-x'));

    // The About box (#3682), from records/repo-about.json on main.
    gh.records['repo-about.json'] = { about: 'x', description: aboutReal.description, homepage: aboutReal.homepage, topics: aboutReal.topics };
    const aboutWrites = () => gh.calls.filter(c => c.method === 'PATCH' || c.method === 'PUT');
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'repo-about', check: true });
    yes('an About check answers 200 with the three parts that differ, and changes nothing', r.status === 200 && r.json.ok && r.json.differs === 3 && r.json.changed === 0 && aboutWrites().length === 0);
    yes('  it names what each would be', r.json.lines.some(l => /the website would be "https:\/\/thornswood\.net"/.test(l)));
    yes('  and the runner records are not read for it', !gh.calls.some(c => /runners/.test(c.path)));
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'repo-about' });
    yes('an About run sets the description, the website and the topics (200, 3 changed)', r.status === 200 && r.json.ok && r.json.changed === 3 &&
      gh.repo.description === aboutReal.description && gh.repo.homepage === aboutReal.homepage && gh.topics.join(',') === aboutReal.topics.join(','));
    yes('  in one PATCH and one PUT, with a token for this repository alone', aboutWrites().length === 2 && aboutWrites().every(c => c.auth === 'Bearer ' + gh.aboutToken) &&
      gh.calls.some(c => /access_tokens$/.test(c.path) && JSON.stringify(c.body) === '{"repositories":["Thornswood"],"permissions":{"administration":"write","contents":"read"}}') &&
      JSON.stringify(Object.keys(aboutWrites().find(c => c.method === 'PATCH').body).sort()) === '["description","homepage"]');
    yes('  and the record came from main', gh.calls.some(c => c.path === '/repos/ThornswoodRP/Thornswood/contents/records/repo-about.json?ref=main'));
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'repo-about' });
    yes('a second About run changes nothing', r.status === 200 && r.json.changed === 0 && aboutWrites().length === 0 && /GitHub matches it/.test(r.text));
    gh.records['repo-about.json'] = { description: 'two\nlines', homepage: '', topics: ['skyrim'] };
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'repo-about', description: 'from the caller' });
    yes('a bad About record on main stops it, nothing changed (502)', r.status === 502 && /one line/.test(r.text) && aboutWrites().length === 0);
    delete gh.records['repo-about.json'];

    gh.records['bad-runners.json'] = { label: 'thornswood-vps', runners: [1] };
    gh.calls = [];
    r = await ask4(bearer(sign(good())));
    yes('a bad record on main stops it, nothing changed (502)', r.status === 502 && /every runner carries/.test(r.text) && writes().length === 0);
    delete gh.records['bad-runners.json'];
    gh.records['light-runners.json'] = { label: 'thornswood-light', runners: [9] };
    gh.runners.find(x => x.name === 'thornswood-vps-3').labels.push({ name: 'thornswood-light', type: 'custom' });
    gh.calls = [];
    r = await ask4(bearer(sign(good())));
    yes('a record whose runners GitHub has none of stops for it (409) and leaves its label where it is', r.status === 409 && /never comes/.test(r.text) && labels('thornswood-vps-3').includes('thornswood-light') && writes().length === 0);
    delete gh.records['light-runners.json'];
    gh.calls = [];
    r = await ask4(bearer(sign(good())));
    yes('  and once its record is off main, the label comes off with it (#4033)', r.status === 200 && r.json.changed === 1 && !labels('thornswood-vps-3').includes('thornswood-light'));

    // ---- 4a. repository settings ----
    console.log('repository settings');
    const T = 'ThornswoodRP/Thornswood', S = 'ThornswoodRP/skymp';
    const rsWrites = () => gh.calls.filter(c => /\/(rulesets|private-vulnerability-reporting)/.test(c.path) && c.method !== 'GET');
    const askRs = (check, over) => ask4(bearer(sign(good(over))), { what: 'repo-settings', check: !!check });
    const has = (re) => r.json.lines.some(l => re.test(l));
    gh.calls = [];
    r = await askRs();
    yes('with no record on main it says so and changes nothing (502)', r.status === 502 && /main has no records\/github-repo-settings\.json/.test(r.text) && rsWrites().length === 0);
    gh.settingsRecord = settings();
    gh.calls = [];
    r = await askRs(true);
    yes('a check says what would be made and switched, and changes nothing', r.status === 200 && r.json.ok && r.json.differs === 4 && r.json.changed === 0 && rsWrites().length === 0 &&
      has(/^ThornswoodRP\/Thornswood: the ruleset release tags would be made \(active\)$/) && has(/^ThornswoodRP\/Thornswood: the ruleset main would be made \(disabled\)$/) &&
      has(/^ThornswoodRP\/skymp: the ruleset main would be made \(active\)$/) && has(/^ThornswoodRP\/skymp: private vulnerability reporting would be switched on$/));
    gh.calls = [];
    r = await askRs(false);
    const posted = gh.calls.filter(c => c.method === 'POST' && /\/rulesets$/.test(c.path));
    yes('a run makes all three and switches the fork\'s reporting on (200, 4 changed)', r.status === 200 && r.json.ok && r.json.changed === 4 &&
      gh.sets.Thornswood.length === 2 && gh.sets.skymp.length === 1 && gh.pvr.skymp === true);
    yes('  sending each ruleset\'s own keys and not the record\'s note',
      posted.length === 3 && posted.every(c => !('why' in c.body)) &&
      JSON.stringify(posted.find(c => c.body.name === 'release tags').body.bypass_actors) === JSON.stringify(tagSet.bypass_actors));
    yes('  each repository\'s with a token for that repository alone',
      posted.filter(c => c.path.startsWith('/repos/' + T + '/')).every(c => c.auth === 'Bearer ' + gh.aboutToken) &&
      posted.filter(c => c.path.startsWith('/repos/' + S + '/')).every(c => c.auth === 'Bearer ' + gh.forkToken) &&
      gh.calls.some(c => c.method === 'PUT' && c.path === '/repos/' + S + '/private-vulnerability-reporting' && c.auth === 'Bearer ' + gh.forkToken));
    const forkTok = gh.calls.find(c => /access_tokens$/.test(c.path) && c.body.repositories && c.body.repositories[0] === 'skymp');
    yes('  the fork\'s token asked for skymp alone, with administration write only',
      forkTok && JSON.stringify(forkTok.body.repositories) === '["skymp"]' && JSON.stringify(forkTok.body.permissions) === '{"administration":"write"}');
    yes('  Thornswood\'s reporting, which the record does not mention, is not asked about or touched',
      gh.pvr.Thornswood === false && !gh.calls.some(c => c.path === '/repos/' + T + '/private-vulnerability-reporting'));
    yes('  and it reads everything back after',
      gh.calls.filter(c => c.method === 'GET' && c.path.startsWith('/repos/' + T + '/rulesets?')).length === 2 &&
      gh.calls.filter(c => c.method === 'GET' && c.path.startsWith('/repos/' + S + '/rulesets?')).length === 2 &&
      gh.calls.filter(c => c.method === 'GET' && c.path === '/repos/' + S + '/private-vulnerability-reporting').length === 2);
    gh.calls = [];
    r = await askRs();
    yes('a second run changes nothing', r.status === 200 && r.json.changed === 0 && rsWrites().length === 0 &&
      r.json.lines.filter(l => /GitHub matches the record for the ruleset/.test(l)).length === 3 && has(/^ThornswoodRP\/skymp: private vulnerability reporting is on, as the record says$/));
    const tagId = gh.sets.Thornswood.find(x => x.name === 'release tags').id;
    gh.sets.Thornswood.find(x => x.name === 'release tags').bypass_actors.push({ actor_id: 4, actor_type: 'RepositoryRole', bypass_mode: 'always' });
    gh.calls = [];
    r = await askRs();
    yes('a ruleset changed on GitHub is put back by its id', r.status === 200 && r.json.changed === 1 && rsWrites().length === 1 &&
      rsWrites()[0].method === 'PUT' && rsWrites()[0].path === '/repos/' + T + '/rulesets/' + tagId &&
      gh.sets.Thornswood.find(x => x.name === 'release tags').bypass_actors.length === 2);
    gh.pvr.skymp = false;
    gh.calls = [];
    r = await askRs();
    yes('the fork\'s reporting switched off on GitHub is switched on again', r.status === 200 && r.json.changed === 1 && gh.pvr.skymp === true && has(/skymp: private vulnerability reporting switched on$/));
    gh.settingsRecord.repositories[1].private_vulnerability_reporting = false;
    gh.calls = [];
    r = await askRs();
    yes('  and a record that says off switches it off', r.status === 200 && r.json.changed === 1 && gh.pvr.skymp === false &&
      rsWrites().length === 1 && rsWrites()[0].method === 'DELETE');
    gh.settingsRecord = settings();
    r = await askRs();
    gh.sets.skymp.push(ghCopy(Object.assign({}, forkMain, { name: 'by hand' }), 900));
    gh.calls = [];
    r = await askRs();
    yes('a ruleset the record does not name stops it (409), and is never deleted', r.status === 409 && /skymp: GitHub has a ruleset by hand/.test(r.text) && rsWrites().length === 0 && gh.sets.skymp.some(x => x.name === 'by hand'));
    yes('  while the other repository is still matched', r.json.lines.filter(l => /^ThornswoodRP\/Thornswood: GitHub matches/.test(l)).length === 2);
    gh.sets.skymp = gh.sets.skymp.filter(x => x.name !== 'by hand');
    gh.forkInstalled = false;
    gh.sets.Thornswood = gh.sets.Thornswood.filter(x => x.name !== 'main');
    gh.calls = [];
    r = await askRs();
    yes('a repository the App is not installed on stops for it (409) with the link to the installation\'s settings', r.status === 409 && has(/^STOP ThornswoodRP\/skymp: GitHub gave the App no token \(.*\); is the App installed on it\? \S+\/settings\/installations\/77; nothing more/) &&
      !gh.calls.some(c => c.path.startsWith('/repos/' + S + '/') && c.method !== 'GET'));
    yes('  and the other is still put right', gh.sets.Thornswood.some(x => x.name === 'main') && has(/^ThornswoodRP\/Thornswood: the ruleset main made \(disabled\)$/));
    gh.forkInstalled = true;
    gh.settingsRecord = { repositories: [{ repository: 'ThornswoodRP/other', rulesets: [] }] };
    gh.calls = [];
    r = await askRs();
    yes('a record naming another repository stops it, nothing changed (502)', r.status === 502 && /the only ones this changes are/.test(r.text) && rsWrites().length === 0);
    gh.settingsRecord = { repositories: [{ repository: T, rulesets: [with_(tagSet, 'target', 'push')] }] };
    gh.calls = [];
    r = await askRs();
    yes('a bad ruleset on main stops it, nothing changed (502)', r.status === 502 && /not branch or tag/.test(r.text) && rsWrites().length === 0);
    gh.settingsRecord = settings();
    r = await ask4(bearer(sign(good())), { what: 'repo-settings', repositories: [{ repository: S, private_vulnerability_reporting: false, rulesets: [] }] });
    yes('settings sent by the caller are not used', r.status === 200 && r.json.changed === 0 && gh.pvr.skymp === true && gh.sets.skymp.length === 1);
    yes('  and a record that names no scanning never reads or touches it', !gh.calls.some(c => c.path === '/repos/' + T || c.path === '/repos/' + S));

    // Secret scanning and push protection (#3683, at the flip).
    const scan = (o) => (o.security_and_analysis.secret_scanning.status + '/' + o.security_and_analysis.secret_scanning_push_protection.status);
    const patches = () => gh.calls.filter(c => c.method === 'PATCH' && (c.path === '/repos/' + T || c.path === '/repos/' + S));
    gh.settingsRecord = settings();
    Object.assign(gh.settingsRecord.repositories[0], { secret_scanning: true, secret_scanning_push_protection: true });
    Object.assign(gh.settingsRecord.repositories[1], { secret_scanning: true, secret_scanning_push_protection: true });
    gh.calls = [];
    r = await askRs(true);
    yes('a check says Thornswood\'s scanning and push protection would be switched on, and changes nothing', r.status === 200 && r.json.differs === 2 && r.json.changed === 0 && patches().length === 0 &&
      has(/^ThornswoodRP\/Thornswood: secret scanning would be switched on$/) && has(/^ThornswoodRP\/Thornswood: push protection would be switched on$/) && scan(gh.repo) === 'disabled/disabled');
    yes('  and says the fork\'s are on already', has(/^ThornswoodRP\/skymp: secret scanning is on, as the record says$/) && has(/^ThornswoodRP\/skymp: push protection is on, as the record says$/));
    gh.calls = [];
    r = await askRs();
    yes('a run switches both on in one PATCH with Thornswood\'s token, and reads it back (2 changed)', r.status === 200 && r.json.ok && r.json.changed === 2 && scan(gh.repo) === 'enabled/enabled' &&
      patches().length === 1 && patches()[0].auth === 'Bearer ' + gh.aboutToken &&
      JSON.stringify(patches()[0].body) === '{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}' &&
      gh.calls.filter(c => c.method === 'GET' && c.path === '/repos/' + T).length === 2);
    yes('  sending nothing to the fork, whose are on', !patches().some(c => c.path === '/repos/' + S));
    gh.calls = [];
    r = await askRs();
    yes('a second run changes nothing', r.status === 200 && r.json.changed === 0 && patches().length === 0);
    gh.repo.security_and_analysis.secret_scanning_push_protection = { status: 'disabled' };
    gh.calls = [];
    r = await askRs();
    yes('push protection switched off on GitHub is switched on again, sending only that key', r.status === 200 && r.json.changed === 1 && scan(gh.repo) === 'enabled/enabled' &&
      JSON.stringify(patches()[0].body) === '{"security_and_analysis":{"secret_scanning_push_protection":{"status":"enabled"}}}' && has(/^ThornswoodRP\/Thornswood: push protection switched on$/));

    // The nightly (part 20, #5298): a scheduled run may only check, and its
    // repository settings check tells the board.
    const sched = { event_name: 'schedule' };
    const mine = () => gh.issues.filter(i => i.user.login === 'thornswood-box-admin[bot]');
    gh.repo.security_and_analysis.secret_scanning = { status: 'disabled' };
    gh.repo.security_and_analysis.secret_scanning_push_protection = { status: 'disabled' };
    gh.calls = [];
    r = await askRs(false, sched);
    yes('a scheduled run that asks to change the settings is refused (403), with nothing asked of GitHub but the keys', r.status === 403 && /a scheduled run only checks/.test(r.text) && gh.calls.every(c => c.path === '/jwks'));
    r = await ask4(bearer(sign(good(sched))), { what: 'runner-labels' });
    yes('  and so is one that asks to change the runner labels', r.status === 403);
    r = await ask4(bearer(sign(good(sched))), { what: 'repo-about', check: 'yes' });
    yes('  and one whose check is not exactly true', r.status === 403);
    gh.calls = [];
    r = await askRs(true, sched);
    yes('a scheduled check that finds scanning off opens one issue on the board, and changes nothing', r.status === 200 && r.json.differs === 2 && patches().length === 0 &&
      mine().length === 1 && mine()[0].title === "GitHub's repository settings differ from the record" && has(/^board: issue #50 opened$/));
    yes('  the issue names what differs and how it is done, and nothing that matches', /- ThornswoodRP\/Thornswood: secret scanning would be switched on\n- ThornswoodRP\/Thornswood: push protection would be switched on\n/.test(mine()[0].body) &&
      /\nDone when: /.test(mine()[0].body) && !/as the record says/.test(mine()[0].body));
    yes('  with the issues token for Thornswood alone', gh.calls.filter(c => c.path.startsWith('/repos/' + T + '/issues')).every(c => c.auth === 'Bearer ' + gh.botToken));
    yes('  and leaves a person\'s issue of the same title alone', gh.issues[0].state === 'open' && gh.issues[0].body === 'by a person');
    gh.calls = [];
    r = await askRs(true, sched);
    yes('the next night, still the same, it neither opens another nor writes', r.status === 200 && mine().length === 1 && has(/^board: issue #50 already says this$/) &&
      !gh.calls.some(c => c.method !== 'GET' && c.path.startsWith('/repos/' + T + '/issues')));
    r = await askRs();
    gh.calls = [];
    r = await askRs(true, sched);
    yes('once a run puts it right, the next scheduled check closes the issue with a comment', r.status === 200 && r.json.differs === 0 && mine()[0].state === 'closed' && mine()[0].state_reason === 'completed' &&
      mine()[0].comments.length === 1 && has(/^board: issue #50 closed: GitHub matches the record again$/));
    gh.calls = [];
    r = await askRs(true, sched);
    yes('  and a night that matches with nothing open writes nothing', r.status === 200 && has(/^board: GitHub matches the record$/) && !gh.calls.some(c => c.method !== 'GET' && c.path.startsWith('/repos/' + T + '/issues')));
    gh.calls = [];
    r = await askRs(true);
    yes('a check started by hand never tells the board', r.status === 200 && !gh.calls.some(c => c.path.startsWith('/repos/' + T + '/issues')) && !has(/^board:/));
    gh.botGranted = false;
    gh.repo.security_and_analysis.secret_scanning_push_protection = { status: 'disabled' };
    r = await askRs(true, sched);
    yes('a board GitHub will not give the token for fails the run (409), saying so', r.status === 409 && has(/^STOP the board was not told: GitHub gave the App no token/));
    gh.botGranted = true;
    r = await askRs();

    // Auto-merge (Patrick's A on #5182, 31 Oct 2026).
    gh.settingsRecord = settings();
    gh.settingsRecord.repositories[0].allow_auto_merge = true;
    gh.calls = [];
    r = await askRs(true);
    yes('a check says Thornswood\'s auto-merge would be switched on, and changes nothing (#5182)', r.status === 200 && r.json.differs === 1 && r.json.changed === 0 && patches().length === 0 &&
      gh.repo.allow_auto_merge === false && has(/^ThornswoodRP\/Thornswood: auto-merge would be switched on$/));
    gh.calls = [];
    r = await askRs();
    yes('a run switches it on in one PATCH of that key alone, with Thornswood\'s token, and reads it back', r.status === 200 && r.json.ok && r.json.changed === 1 && gh.repo.allow_auto_merge === true &&
      patches().length === 1 && patches()[0].auth === 'Bearer ' + gh.aboutToken && JSON.stringify(patches()[0].body) === '{"allow_auto_merge":true}' &&
      has(/^ThornswoodRP\/Thornswood: auto-merge switched on$/));
    yes('  and the fork, whose entry does not name it, is not asked', !gh.calls.some(c => c.path === '/repos/' + S));
    gh.calls = [];
    r = await askRs();
    yes('a second run changes nothing and says it is on', r.status === 200 && r.json.changed === 0 && patches().length === 0 && has(/^ThornswoodRP\/Thornswood: auto-merge is on, as the record says$/));

    // The merge methods, and Ops (2 Nov 2026, after fork #147 and Ops #200
    // and #201 sat green and unmerged with auto-merge off).
    const O = 'ThornswoodRP/Thornswood-Ops';
    const mpatches = () => gh.calls.filter(c => c.method === 'PATCH' && [T, S, O].some(n => c.path === '/repos/' + n));
    gh.settingsRecord = settings();
    gh.settingsRecord.repositories[0] = methods(gh.settingsRecord.repositories[0], true, false, false);
    gh.settingsRecord.repositories[1] = Object.assign(methods(gh.settingsRecord.repositories[1], false, true, false), { allow_auto_merge: true });
    gh.settingsRecord.repositories.push(opsEntry());
    gh.calls = [];
    r = await askRs(true);
    yes('a check says which merge methods and auto-merge would be switched in all three, and changes nothing', r.status === 200 && r.json.ok && r.json.differs === 7 && r.json.changed === 0 && mpatches().length === 0 &&
      has(/^ThornswoodRP\/Thornswood: merge commits would be switched off$/) && has(/^ThornswoodRP\/Thornswood: rebase merging would be switched off$/) &&
      has(/^ThornswoodRP\/Thornswood: squash merging is on, as the record says$/) && has(/^ThornswoodRP\/skymp: auto-merge would be switched on$/) &&
      has(/^ThornswoodRP\/skymp: squash merging would be switched off$/) && has(/^ThornswoodRP\/Thornswood-Ops: merge commits would be switched off$/));
    yes('  and never asks GitHub for Ops\' rulesets, which GitHub Free keeps none of', !gh.calls.some(c => c.path.startsWith('/repos/' + O + '/rulesets')));
    gh.calls = [];
    r = await askRs();
    const body = n => JSON.stringify((mpatches().find(c => c.path === '/repos/' + n) || {}).body);
    yes('a run sends one PATCH to each, of the keys that differ alone, each with its own token', r.status === 200 && r.json.ok && r.json.changed === 7 && mpatches().length === 3 &&
      body(T) === '{"allow_merge_commit":false,"allow_rebase_merge":false}' && body(S) === '{"allow_auto_merge":true,"allow_squash_merge":false,"allow_rebase_merge":false}' &&
      body(O) === '{"allow_merge_commit":false,"allow_rebase_merge":false}' &&
      mpatches().find(c => c.path === '/repos/' + T).auth === 'Bearer ' + gh.aboutToken && mpatches().find(c => c.path === '/repos/' + S).auth === 'Bearer ' + gh.forkToken &&
      mpatches().find(c => c.path === '/repos/' + O).auth === 'Bearer ' + gh.instToken);
    yes('  and GitHub has each as the record says, read back', gh.repo.allow_squash_merge && !gh.repo.allow_merge_commit && !gh.repo.allow_rebase_merge &&
      gh.forkRepo.allow_auto_merge && !gh.forkRepo.allow_squash_merge && gh.forkRepo.allow_merge_commit && !gh.forkRepo.allow_rebase_merge &&
      gh.opsRepo.allow_squash_merge && !gh.opsRepo.allow_merge_commit && !gh.opsRepo.allow_rebase_merge && gh.opsRepo.allow_auto_merge === false &&
      has(/^ThornswoodRP\/Thornswood-Ops: rebase merging switched off$/) && gh.calls.filter(c => c.method === 'GET' && c.path === '/repos/' + O).length === 2);
    gh.calls = [];
    r = await askRs();
    yes('a second run changes nothing', r.status === 200 && r.json.changed === 0 && mpatches().length === 0 && has(/^ThornswoodRP\/Thornswood-Ops: merge commits is off, as the record says$/));
    gh.opsRepo.allow_merge_commit = true;
    gh.opsIgnores = true;
    gh.calls = [];
    r = await askRs();
    yes('a switch GitHub answers but does not make stops the run, named, and the others still match', r.status === 409 && !r.json.ok &&
      has(/^STOP ThornswoodRP\/Thornswood-Ops: GitHub still has merge commits on$/) && has(/^ThornswoodRP\/skymp: merge commits is on, as the record says$/));
    gh.opsIgnores = false;
    r = await askRs();
    yes('  and the next run puts it right', r.status === 200 && r.json.ok && gh.opsRepo.allow_merge_commit === false);

    // Immutable releases (Patrick, 26 Oct 2026, #3287).
    const immu = () => gh.calls.filter(c => c.path === '/repos/' + T + '/immutable-releases' && c.method !== 'GET');
    gh.settingsRecord = settings();
    gh.settingsRecord.repositories[0].immutable_releases = true;
    gh.calls = [];
    r = await askRs(true);
    yes('a check says Thornswood\'s immutable releases would be switched on, and changes nothing', r.status === 200 && r.json.differs === 1 && immu().length === 0 &&
      gh.immutable.Thornswood === false && has(/^ThornswoodRP\/Thornswood: immutable releases would be switched on$/));
    gh.calls = [];
    r = await askRs();
    yes('a run switches them on with one PUT and Thornswood\'s token, and reads it back', r.status === 200 && r.json.ok && r.json.changed === 1 && gh.immutable.Thornswood === true &&
      immu().length === 1 && immu()[0].method === 'PUT' && immu()[0].auth === 'Bearer ' + gh.aboutToken &&
      gh.calls.filter(c => c.method === 'GET' && c.path === '/repos/' + T + '/immutable-releases').length === 2 && has(/^ThornswoodRP\/Thornswood: immutable releases switched on$/));
    yes('  and the fork\'s, which its entry does not name, are not asked about', gh.immutable.skymp === false && !gh.calls.some(c => c.path === '/repos/' + S + '/immutable-releases'));
    gh.calls = [];
    r = await askRs();
    yes('a second run changes nothing', r.status === 200 && r.json.changed === 0 && immu().length === 0 && has(/^ThornswoodRP\/Thornswood: immutable releases is on, as the record says$/));
    gh.settingsRecord.repositories[0].immutable_releases = false;
    gh.calls = [];
    r = await askRs();
    yes('  and a record that says off switches them off with DELETE', r.status === 200 && r.json.changed === 1 && gh.immutable.Thornswood === false && immu().length === 1 && immu()[0].method === 'DELETE');
    gh.settingsRecord = settings();

    // Collaborators (Four stepped down, 31 Oct 2026).
    const peopleWrites = () => gh.calls.filter(c => /\/(collaborators|invitations)/.test(c.path) && c.method !== 'GET');
    gh.calls = [];
    r = await askRs();
    yes('a record that lists nobody for either repository never reads or touches their people', r.status === 200 && !gh.calls.some(c => /\/(collaborators|invitations)/.test(c.path)));
    gh.settingsRecord.repositories[0].collaborators = ['WiccanDjinn'];
    gh.settingsRecord.repositories[1].collaborators = ['Ture-Neko', 'WiccanDjinn', 'NewPerson'];
    gh.calls = [];
    r = await askRs(true);
    yes('a check says who would be taken off and withdrawn, names who is missing, and changes nothing', r.status === 200 && r.json.differs === 2 && r.json.changed === 0 && peopleWrites().length === 0 &&
      has(/^ThornswoodRP\/Thornswood: Jhinswife would be taken off, as the record does not name them$/) && has(/^ThornswoodRP\/skymp: the invitation to Stale would be withdrawn/) &&
      has(/^ThornswoodRP\/skymp: NewPerson is named but not a collaborator; Patrick invites them by hand on GitHub$/) && has(/^ThornswoodRP\/Thornswood: WiccanDjinn is a collaborator, as the record says$/));
    gh.calls = [];
    r = await askRs();
    yes('a run takes Jhinswife off Thornswood and withdraws the stale invitation, each with its own repository\'s token, and reads back (2 changed)',
      r.status === 200 && r.json.ok && r.json.changed === 2 &&
      JSON.stringify(gh.people.Thornswood) === '["WiccanDjinn"]' && gh.invites.skymp.length === 0 && !gh.people.skymp.includes('NewPerson') &&
      peopleWrites().some(c => c.method === 'DELETE' && c.path === '/repos/' + T + '/collaborators/Jhinswife' && c.auth === 'Bearer ' + gh.aboutToken) &&
      peopleWrites().some(c => c.method === 'DELETE' && c.path === '/repos/' + S + '/invitations/40' && c.auth === 'Bearer ' + gh.forkToken) &&
      gh.calls.filter(c => c.method === 'GET' && c.path.startsWith('/repos/' + T + '/collaborators?')).length === 2);
    yes('  and never the owner or a named collaborator', !peopleWrites().some(c => /EvilPatrick06$|WiccanDjinn$|Ture-Neko$/.test(c.path)));
    yes('  and never adds anybody: no PUT, the missing one only reported', !peopleWrites().some(c => c.method === 'PUT') &&
      has(/^ThornswoodRP\/skymp: NewPerson is named but not a collaborator; Patrick invites them by hand on GitHub$/));
    gh.calls = [];
    r = await askRs();
    yes('a second run changes nothing and still names the missing one', r.status === 200 && r.json.changed === 0 && peopleWrites().length === 0 &&
      has(/^ThornswoodRP\/skymp: NewPerson is named but not a collaborator/));
    gh.people.Thornswood.push('ByHand');
    gh.calls = [];
    r = await askRs();
    yes('someone added on GitHub by hand and not in the record is taken off again', r.status === 200 && r.json.changed === 1 && JSON.stringify(gh.people.Thornswood) === '["WiccanDjinn"]' && has(/^ThornswoodRP\/Thornswood: ByHand taken off$/));
    gh.settingsRecord = settings();

    const tokenSeen = sign(good());
    await ask4(bearer(tokenSeen));
    const log = svc.log();
    yes('the log names the run and what changed', /run 4242 \(workflow_dispatch by EvilPatrick06\)/.test(log));
    yes('  and never a token or the key', !log.includes(tokenSeen.split('.')[2]) && !log.includes(gh.instToken) && !log.includes(gh.repoToken) && !log.includes(gh.readToken) && !log.includes(gh.aboutToken) && !log.includes(gh.settingsToken) && !log.includes(gh.forkToken) && !log.includes('PRIVATE KEY'));

    // ---- settings (#3534): read only ----
    console.log('the settings read');
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'settings' });
    const reads = () => gh.calls.filter(c => c.method !== 'GET' && !/access_tokens$/.test(c.path));
    yes('settings answers 200 and makes no call but GETs and the token', r.status === 200 && r.json.ok && reads().length === 0);
    let stok = gh.calls.find(c => /access_tokens$/.test(c.path));
    yes('  its token is for Thornswood alone, administration and contents read only, while the App holds no more',
      stok && JSON.stringify(stok.body.repositories) === '["Thornswood"]' && JSON.stringify(stok.body.permissions) === '{"administration":"read","contents":"read"}');
    const rd = (r.json && r.json.readings) || {};
    yes('  it reads the Actions settings, the workflow token, sharing, retention and fork pull requests',
      rd.actions && rd.actions.allowed_actions === 'all' && rd.workflow_token.default_workflow_permissions === 'read' && rd.sharing.access_level === 'none' &&
      rd.retention.days === 90 && rd.fork_pull_requests.send_secrets_and_variables === false);
    yes('  and the runners, with their labels', Array.isArray(rd.runners) && rd.runners.length === 4 && rd.runners[0].labels.includes('thornswood-vps'));
    yes('  says the secret and variable names are not read, naming the permission, and asks for none of them',
      !rd.secrets && !rd.variables && r.json.unread.some(l => /^secrets: the App has no Secrets permission/.test(l)) &&
      r.json.unread.some(l => /^variables: the App has no Variables permission/.test(l)) && r.json.unread.some(l => /Environments permission/.test(l)) &&
      !gh.calls.some(c => /secrets|variables/.test(c.path)));
    yes('  the environments are the record\'s on main, a name GitHub could not have left out', JSON.stringify(Object.keys(rd.environments)) === '["board","notices"]');
    gh.instPerms = { administration: 'write', contents: 'read', metadata: 'read', secrets: 'read', actions_variables: 'read', environments: 'read' };
    gh.calls = [];
    r = await ask4(bearer(sign(good())), { what: 'settings' });
    stok = gh.calls.find(c => /access_tokens$/.test(c.path));
    yes('with the App holding them, the token asks for secrets, variables and environments read too, and nothing more',
      stok && JSON.stringify(stok.body.permissions) === '{"administration":"read","contents":"read","secrets":"read","actions_variables":"read","environments":"read"}');
    const rd2 = r.json.readings;
    yes('  and the names are read: the repository\'s and each environment\'s', r.status === 200 && JSON.stringify(rd2.secrets) === '["CLOUDFLARE_TURNSTILE_TOKEN"]' &&
      JSON.stringify(rd2.variables) === '["BUILD_RUNNER"]' && JSON.stringify(rd2.environments.board.secrets) === '["BOARD_TOKEN"]' && r.json.unread.length === 0);
    yes('  a variable\'s value never comes back, only its name', !r.text.includes('the value'));
    yes('  and still nothing but GETs', reads().length === 0);
    gh.instPerms = { administration: 'write', contents: 'read', metadata: 'read' };

    // ---- 5. setup ----
    console.log('the App\'s setup');
    fs.unlinkSync(path.join(state, 'key.pem'));
    fs.unlinkSync(path.join(state, 'app.json'));
    const st = crypto.randomBytes(24).toString('hex');
    const fwd = { 'X-Forwarded-For': '203.0.113.9' };
    r = await ask(P, 'GET', '/setup?state=' + st, fwd);
    yes('no armed setup: the plain 404', r.status === 404 && r.text === 'box admin: not here');
    fs.writeFileSync(path.join(state, 'setup.json'), JSON.stringify({ state: st, expires: now() + 3600 }));
    r = await ask(P, 'GET', '/setup?state=' + crypto.randomBytes(24).toString('hex'), fwd);
    yes('a wrong state: the plain 404', r.status === 404);
    r = await ask(P, 'GET', '/setup?state=' + st.slice(0, 8), fwd);
    yes('  and a short one', r.status === 404);
    r = await ask(P, 'GET', '/setup?state=' + st, fwd);
    const form = /<form action="([^"]+)" method="post"><input type="hidden" name="manifest" value="([^"]+)">/.exec(r.text);
    const unesc = s => s.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    yes('the armed page, through Caddy, posts the manifest to GitHub with the state', r.status === 200 && form && unesc(form[1]) === 'http://127.0.0.1:' + ghPort + '/web/settings/apps/new?state=' + st);
    const mf = form ? JSON.parse(unesc(form[2])) : {};
    yes('  the manifest: private, administration write, contents read, secrets read, environments write for a box key (ops-access.js), variables read, Actions write for the Ship verbs (#2841), Issues write for the Discord bot (#5184), Deployments write for the deploy agent (#5180), no webhook, back to /github-app/setup/done',
      mf.public === false && JSON.stringify(mf.default_permissions) === '{"administration":"write","contents":"read","secrets":"read","actions_variables":"read","environments":"write","actions":"write","issues":"write","deployments":"write"}' && mf.hook_attributes.active === false &&
      mf.redirect_url === 'https://thornswood.net/github-app/setup/done' && (mf.default_events || []).length === 0);
    yes('  and it asks for exactly what records/github-apps.json gives the box admin App (part 20)', (() => {
      const rec = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'github-apps.json'), 'utf8')).apps.find(a => a.slug === 'thornswood-box-admin');
      const want = Object.assign({}, rec.permissions); delete want.metadata;
      const have = mf.default_permissions || {};
      return JSON.stringify(Object.keys(want).sort().map(k => k + want[k])) === JSON.stringify(Object.keys(have).sort().map(k => k + have[k]));
    })());
    yes('  and the page is neither kept nor passed on', /no-store/.test(r.headers['cache-control'] || '') && r.headers['referrer-policy'] === 'no-referrer');

    // A key made here for the stand-in to hand over; a line of its body is
    // what the page and the log must never hold.
    const madeKey = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
    const keyLine = madeKey.split('\n')[1];
    gh.conversion = { id: 999, slug: 'thornswood-box-admin', pem: madeKey, owner: { login: 'SomebodyElse' } };
    r = await ask(P, 'GET', '/setup/done?code=abcdef123456&state=' + st, fwd);
    yes('an App another account made is refused, and nothing is kept', r.status === 403 && !fs.existsSync(path.join(state, 'key.pem')) && fs.existsSync(path.join(state, 'setup.json')));
    gh.conversion.owner = { login: 'EvilPatrick06' };
    r = await ask(P, 'GET', '/setup/done?code=abcdef123456&state=' + crypto.randomBytes(24).toString('hex'), fwd);
    yes('/setup/done with a wrong state: the plain 404', r.status === 404 && !fs.existsSync(path.join(state, 'key.pem')));
    gh.calls = [];
    r = await ask(P, 'GET', '/setup/done?code=abcdef123456&state=' + st, fwd);
    yes('GitHub\'s code comes back: the key and the App\'s id are kept', r.status === 200 && fs.readFileSync(path.join(state, 'key.pem'), 'utf8') === gh.conversion.pem &&
      JSON.parse(fs.readFileSync(path.join(state, 'app.json'), 'utf8')).id === 999);
    yes('  traded with GitHub by the code alone', gh.calls.length === 1 && gh.calls[0].path === '/app-manifests/abcdef123456/conversions' && gh.calls[0].auth === '');
    yes('  the setup is disarmed', !fs.existsSync(path.join(state, 'setup.json')));
    yes('  the page links the App\'s install page and never shows the key', /\/apps\/thornswood-box-admin\/installations\/new/.test(r.text) && !r.text.includes(keyLine));
    yes('  and says to pick Thornswood, Thornswood-Ops and skymp, the engine fork (#3683)', /pick <b>Thornswood<\/b>, <b>Thornswood-Ops<\/b> and <b>skymp<\/b>/.test(r.text));
    yes('  and the log never holds the key', !svc.log().includes(keyLine));
    fs.writeFileSync(path.join(state, 'setup.json'), JSON.stringify({ state: st, expires: now() + 3600 }));
    r = await ask(P, 'GET', '/setup?state=' + st, fwd);
    yes('with an App held, an armed setup still shows nothing', r.status === 404);
    fs.unlinkSync(path.join(state, 'key.pem'));
    fs.unlinkSync(path.join(state, 'app.json'));
    fs.writeFileSync(path.join(state, 'setup.json'), JSON.stringify({ state: st, expires: now() - 1 }));
    r = await ask(P, 'GET', '/setup?state=' + st, fwd);
    yes('an expired setup: the plain 404', r.status === 404);

    // #5184, Patrick's A of 1 Nov 2026: the Discord bot's GitHub token comes
    // from the App, issues write on Thornswood alone, into the folder only the
    // bot's account may read, and never into the log.
    console.log('the bot\'s token');
    const botRoot = path.join(tmp, 'bot-box');
    const botState = path.join(botRoot, 'state');
    const forBot = path.join(botRoot, 'for-bot');
    fs.mkdirSync(botState, { recursive: true });
    fs.writeFileSync(path.join(botState, 'key.pem'), appKeyPem);
    fs.writeFileSync(path.join(botState, 'app.json'), JSON.stringify({ id: 123456, slug: 'thornswood-box-admin', owner: 'EvilPatrick06' }));
    const waitFor = async (what, ms) => { const until = Date.now() + ms; while (Date.now() < until) { if (what()) return true; await new Promise(r => setTimeout(r, 100)); } return what(); };
    let botSvc = await start(botState, ghPort, { THORNSWOOD_ADMIN_BOT_EVERY: '1' });
    try {
      yes('with no for-bot folder no token is asked for, and the log says why',
        await waitFor(() => /bot token: no .*for-bot, which Install-AdminService\.ps1 makes/.test(botSvc.log()), 5000) &&
        !gh.calls.some(c => /access_tokens$/.test(c.path) && JSON.stringify(c.body.permissions) === '{"issues":"write"}'));
    } finally { botSvc.kill(); }
    fs.mkdirSync(forBot);
    gh.calls = [];
    botSvc = await start(botState, ghPort, { THORNSWOOD_ADMIN_BOT_EVERY: '1' });
    try {
      const file = path.join(forBot, 'github-token.json');
      yes('the token is made and written into for-bot', await waitFor(() => fs.existsSync(file), 5000));
      const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
      yes('  issues write on Thornswood alone, with when it ends', doc.token === gh.botToken && doc.expires_at === '2026-11-01T05:00:00Z' &&
        doc.repository === 'ThornswoodRP/Thornswood' && JSON.stringify(doc.permissions) === '{"issues":"write"}');
      const asked = gh.calls.filter(c => /access_tokens$/.test(c.path));
      yes('  asked of GitHub with only that', asked.length > 0 && asked.every(c => JSON.stringify(c.body) === '{"repositories":["Thornswood"],"permissions":{"issues":"write"}}'));
      yes('  and made again on the clock', await waitFor(() => gh.calls.filter(c => /access_tokens$/.test(c.path)).length >= 2, 5000));
      // Every second the service writes github-token.json.part and renames it
      // over the file, so a look at one instant can land inside that write
      // (it did on GitHub's Windows runner, 1 Nov 2026). What must hold is
      // that the part file goes: one that a failed rename left stays for good.
      yes('  no half-written file is left beside it', await waitFor(() => !fs.existsSync(file + '.part'), 5000));
      yes('  the log says it once and never holds the token', (botSvc.log().match(/bot token: made for ThornswoodRP\/Thornswood issues/g) || []).length === 1 && !botSvc.log().includes(gh.botToken));
      gh.botGranted = false;
      fs.writeFileSync(file, JSON.stringify({ token: 'old', expires_at: '2026-11-01T04:00:00Z' }));
      yes('an installation without Issues write: the log says where it is added, and the file is left as it was',
        await waitFor(() => /bot token: GitHub gave the App no issues token .*settings\/apps\/thornswood-box-admin\/permissions/.test(botSvc.log()), 5000) &&
        JSON.parse(fs.readFileSync(file, 'utf8')).token === 'old');
    } finally {
      botSvc.kill();
      gh.botGranted = true;
    }
  } catch (e) {
    yes('the run went through without throwing: ' + e.stack, false);
  } finally {
    svc.kill();
    stand.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
