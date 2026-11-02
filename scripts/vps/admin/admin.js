#!/usr/bin/env node
'use strict';
/*
  admin.js

  The box's GitHub admin service (#3107, Patrick's A of 22 Oct 2026). A cloud
  Claude thread cannot make a repository-admin call: the cloud environment's
  proxy refuses every actions/runners, variables, secrets and environments
  path (measured 22 Oct 2026, 10:20 AM), and a workflow's own token has no
  permission for any of them. So a GitHub App made for Thornswood holds that
  right, its key lives here and nowhere else, and this is the only thing
  that uses it.

  WHAT IT DOES. It makes GitHub's admin settings match what this
  repository's main records, or says where the App is installed, and
  nothing else:
    runner-labels   every records/<name>-runners.json on main, { label,
                    runners }: the runners it lists (thornswood-vps is 1,
                    thornswood-vps-<n> is n) carry the label and no other
                    runner does. The runners are registered to the private
                    ops repository, ThornswoodRP/Thornswood-Ops, since
                    this one went public (#4013, Patrick's A on #3685).
                    records/build-runners.json is the build cap
                    (#2994). A record may also list off-box runners by
                    name (offBox, thornswood-pr-*), which carry its label
                    too (build runners on One, 26 Oct 2026); they never
                    carry thornswood-vps, so box-only jobs never reach
                    them. It stops for a record whose runners GitHub does
                    not have, since every job asking for its label would
                    then wait for a runner that never comes. A label of
                    our own that no record names any more comes off every
                    runner, so a record taken off main takes its label with
                    it (#4033: thornswood-sign stayed on runner 3 after
                    the box stopped signing, since only a record's own
                    label was ever looked at).
    repo-about      records/repo-about.json on main, { description,
                    homepage, topics }: the About box a stranger sees on
                    the repository's front page (#3682, Patrick's A of 26
                    Oct 2026). A cloud thread's proxy refuses repository
                    settings writes ("Repository settings writes are not
                    permitted through this proxy", measured 26 Oct 2026,
                    5:13 PM), and the App's administration write covers
                    them. It stops for a record that is not a plain line,
                    an https website, or GitHub's own topic shape.
    settings        reads, and changes nothing (#3534): the Actions settings
                    (on or off, which actions may run, the workflow token's
                    default, sharing, log and artifact retention, fork pull
                    requests), the runners, and the names (never the values,
                    which GitHub never gives) of the secrets and variables of
                    the repository and of each environment
                    records/github-settings.json on main names. A name the
                    App has no permission to read is said, with the
                    permission it needs, instead of being read.
    installation-repos
                    the repositories the App is installed on, read with a
                    token that can read their metadata and nothing more, and
                    nothing changed (#4013: the App has to be on
                    Thornswood-Ops before the runners move there).
    repo-settings   records/github-repo-settings.json on main (#3683,
                    Patrick's answers of 26 Oct 2026), { repositories: [{
                    repository, rulesets: [...],
                    private_vulnerability_reporting, immutable_releases,
                    secret_scanning, secret_scanning_push_protection,
                    allow_auto_merge, allow_squash_merge,
                    allow_merge_commit, allow_rebase_merge,
                    collaborators: [login] }] }, for Thornswood, the
                    engine fork, ThornswoodRP/skymp, and the ops
                    repository, and no other repository (the ops one,
                    private on GitHub Free, has no rulesets and no
                    auto-merge, so its entry names neither): each ruleset an entry names is on GitHub
                    with exactly its target, enforcement, conditions, rules
                    and bypass list, made or put back by name, and private
                    vulnerability reporting, immutable releases, secret
                    scanning and its push protection, auto-merge and the
                    three merge methods (all three or none), are
                    each on or off as the entry says (left as they are when the entry does not
                    say). An App or a deploy key may bypass only a tag
                    ruleset: a record that lets one bypass a branch
                    ruleset stops the run (the redesign's part 20). A
                    ruleset GitHub has that the record does not name
                    is never deleted here; it stops the run, named, so a
                    protection nobody wrote down is a pull request to the
                    record or a deliberate removal, never a silent loss. A repository
                    the App is not installed on stops the run for it, with
                    the link to the installation's settings, and the others
                    go on. An entry's collaborators, when it gives them, is
                    the whole list of people besides the owner who may push
                    there (a personal repository has no other role): one
                    GitHub has that the list does not name is taken off,
                    and an invitation to one is withdrawn, so a person who
                    leaves the team is a pull request to the record (31 Oct
                    2026). It only ever takes people off. One the list names
                    who is not there yet is reported and nothing is sent
                    for them: giving somebody push is Patrick's by hand on
                    GitHub, never a merged pull request through this App.
                    An entry that gives no list leaves its people as they
                    are.
  What to do comes from Thornswood's main, read through the App, never from the caller,
  so whoever asks can only make GitHub match main. A change is a pull
  request to the record.

  WHO MAY ASK. A run of the ops repository's .github/workflows/
  github-admin.yml on its main, and nothing else: it sends the OIDC token
  GitHub gave that run, for the audience thornswood-admin, and this checks it
  against GitHub's published keys (fetched each time) and its claims:
  GitHub's issuer, the audience, not expired, the ops repository,
  refs/heads/main, that exact workflow on main, started by hand or by its
  nightly schedule. A scheduled run may only check (CHANGING_ASKS): its
  repository settings check opens one issue on the board while GitHub
  differs from the record and closes it once it matches. A push here
  cannot start it there, so the Desk runs Set-BuildRunners.ps1 (with
  -RepoSettings for the repository settings) or Set-RepoAbout.ps1 after a
  merge that changes a record. A pull request's
  run has another ref
  and another workflow ref, so it cannot. No secret is involved: the token
  is GitHub's word for which run is asking.

  WHERE. 127.0.0.1:7791. Caddy carries https://thornswood.net/github-app/ to
  it for the App's one-time setup only (scripts\deploy\Caddyfile), and
  anything that came through Caddy (it has X-Forwarded-For) is refused
  everything but the setup pages.

  THE APP'S SETUP. Install-AdminService.ps1 -Setup arms it: state\setup.json
  with a one-time state and an hour to live, and prints the address
  https://thornswood.net/github-app/setup?state=<state>. That page sends the
  App's manifest to GitHub (name, no webhook, private, administration write
  and contents read on the repositories it is installed on, and since #3534
  read of the names of its secrets, variables and environments, never their
  values, Environments write for an environment's secret, which only
  ops-access.js keys asks for (Renew-BoxKey.ps1), Issues write for the
  Discord bot's token (#5260), and since #2841's Ship verbs Actions write,
  which only ship-access.js asks for, and Deployments write, which only the
  deploy agent asks for (tools/DeployAgent, #5180); records/github-apps.json is the list
  and the nightly checks the App against it); Patrick creates
  it, GitHub sends him back to /setup/done with a one-time code, and this
  trades the code for the App's key straight from GitHub. The key goes into
  state\key.pem, the App's id and name into state\app.json, the setup is
  disarmed, and the page links the App's install page. The key is never
  shown, logged or sent anywhere. An App another account made is refused.

  It logs one line per request: what was asked, by which run, and what
  changed. Never a token or the key.

      node admin.js                      listens on 127.0.0.1:7791
      THORNSWOOD_ADMIN_PORT              another port; 0 takes a free one,
                                         which the first line names
      THORNSWOOD_ADMIN_STATE             the state folder; state beside this
                                         file when unset
      THORNSWOOD_ADMIN_GITHUB_API        https://api.github.com when unset
      THORNSWOOD_ADMIN_GITHUB_WEB        https://github.com when unset
      THORNSWOOD_ADMIN_JWKS              GitHub Actions' OIDC keys when unset
                                         (the harness points these at
                                         stand-ins)

  Install-AdminService.ps1 puts it on the box as the task "Thornswood
  Admin", LOCAL SERVICE with a SID of its own, its folder closed to every
  other account, the runners' included. tests\test-3107-admin.js drives it.
*/
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.THORNSWOOD_ADMIN_PORT ? Number(process.env.THORNSWOOD_ADMIN_PORT) : 7791;
const STATE = process.env.THORNSWOOD_ADMIN_STATE || path.join(__dirname, 'state');
const API = (process.env.THORNSWOOD_ADMIN_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const WEB = (process.env.THORNSWOOD_ADMIN_GITHUB_WEB || 'https://github.com').replace(/\/$/, '');
const JWKS = process.env.THORNSWOOD_ADMIN_JWKS || 'https://token.actions.githubusercontent.com/.well-known/jwks';
const PLAIN = 'box admin: not here';
// The Discord bot's GitHub token (#5184, Patrick's A of 1 Nov 2026): the
// folder the service writes it into, which Install-AdminService.ps1 makes and
// gives the bot's own account read of, and how often a new one is made.
const FOR_BOT = process.env.THORNSWOOD_ADMIN_FOR_BOT || path.join(path.dirname(STATE), 'for-bot');
const BOT_EVERY = Math.max(1, Number(process.env.THORNSWOOD_ADMIN_BOT_EVERY) || 1800);

// Where the records are, and where the runners and the workflow that asks
// are (#4013).
const REPO = 'ThornswoodRP/Thornswood';
const RUNNERS_REPO = 'ThornswoodRP/Thornswood-Ops';
// The owner of the repositories (#5184).
const OWNER = 'ThornswoodRP';
// Patrick's own login, which owns the App and holds the organization. He is
// never a collaborator a record lists and never one this takes off: after
// the move into the organization GitHub may list him beside the others.
const HOLDER = 'EvilPatrick06';
// A run is known by its repository's id, which GitHub never changes, not by
// its owner/name, which a move into the ThornswoodRP organization changes
// (#5184): matched by name, the box refused every admin run the moment the
// ops repository moved, until this file was changed and the service put back
// by hand. The workflow must be that same repository's own github-admin.yml
// on main, so it is checked against the name the token itself carries.
const RULES = {
  iss: 'https://token.actions.githubusercontent.com',
  aud: 'thornswood-admin',
  repositoryId: '1435123931', // ThornswoodRP/Thornswood-Ops (repos API, 1 Nov 2026)
  ref: 'refs/heads/main',
  workflow: '/.github/workflows/github-admin.yml@refs/heads/main',
  // A scheduled run (github-admin.yml's nightly) may only check: converge
  // refuses it anything that would change GitHub (CHECK_ONLY).
  events: ['workflow_dispatch', 'schedule'],
};
// The asks that change GitHub unless they are a check. A scheduled run may
// ask them only with check (the redesign's part 20, 1 Nov 2026); settings and
// installation-repos only read, so they need no check.
const CHANGING_ASKS = ['runner-labels', 'repo-about', 'repo-settings'];
// The one issue a scheduled check of the repository settings opens on the
// board when GitHub differs from the record, and closes once it matches
// again. Found by this title among the open issues the App itself opened.
const DRIFT_TITLE = 'GitHub\'s repository settings differ from the record';
const DRIFT_LINES = 8;
// The labels every VPS runner carries, or GitHub gives itself; a record may
// never name one, since taking it off would strand every job that asks.
const RESERVED = ['self-hosted', 'windows', 'linux', 'macos', 'x64', 'arm64', 'thornswood-vps', 'thornswood-pr'];
// What a run may ask for. None takes anything from the caller but the
// check: runner-labels, repo-about and repo-settings each read their record
// from main, and settings reads GitHub's settings alone.
const ASKS = ['runner-labels', 'installation-repos', 'repo-about', 'settings', 'repo-settings'];
const SETTINGS_FILE = 'records/github-repo-settings.json';
// The repositories repo-settings may change: this one, the engine fork and
// the private ops repository (its merge settings, 2 Nov 2026). The App
// reaches only those it is installed on, and this stops a record naming any
// other even then.
const SETTINGS_REPOS = [REPO, OWNER + '/skymp', RUNNERS_REPO];
// The private repositories, on GitHub Free: GitHub keeps no rulesets and no
// auto-merge for them, so their entry names neither, and Bramble merges
// their pull requests.
const FREE_PRIVATE_REPOS = [RUNNERS_REPO];
// The record's on-or-off switches that have an endpoint of their own, each
// true or false: its path under the repository, and what a line calls it.
// Immutable releases (Patrick, 26 Oct 2026, #3287): a published Release's
// files and tag can no longer change; every release step here only fills a
// draft, so nothing that runs breaks.
const SWITCHES = {
  private_vulnerability_reporting: { path: 'private-vulnerability-reporting', name: 'private vulnerability reporting' },
  immutable_releases: { path: 'immutable-releases', name: 'immutable releases' },
};
// A GitHub login: letters, digits and single hyphens, 39 at most.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;
// security_and_analysis keys the record may switch, each true or false.
const SCANNING_KEYS = ['secret_scanning', 'secret_scanning_push_protection'];
// The repository's own merge settings the record may switch, each true or
// false, sent as top-level keys of one PATCH. allow_auto_merge (Patrick's A on
// #5182, 31 Oct 2026): a pull request merges itself once the checks main's
// ruleset requires are green, so nobody waits to press merge; the ruleset,
// with no bypass, still refuses a merge past red for everybody.
// The three ways GitHub may merge a pull request (2 Nov 2026, after fork
// #147 and Ops #200 and #201 sat green and unmerged): each repository allows
// only the one way it merges, so a button, a gh pr merge or a Bot can never
// merge another way. An entry that names one names all three, with one on,
// since GitHub refuses a repository that allows none.
const METHOD_KEYS = ['allow_squash_merge', 'allow_merge_commit', 'allow_rebase_merge'];
const MERGE_KEYS = ['allow_auto_merge'].concat(METHOD_KEYS);
// What a line calls each merge setting.
const MERGE_NAMES = { allow_auto_merge: 'auto-merge', allow_squash_merge: 'squash merging', allow_merge_commit: 'merge commits', allow_rebase_merge: 'rebase merging' };
// What repo-settings' token for each repository may do: Thornswood's reads
// main's record too; the others' only need their settings.
const HOME_PERMISSIONS = { administration: 'write', contents: 'read' };
const FORK_PERMISSIONS = { administration: 'write' };
// The parts of a ruleset the record says and GitHub is made to match. Any
// other key in a record entry (why) is the record's own note and never sent.
const RULESET_KEYS = ['name', 'target', 'enforcement', 'conditions', 'rules', 'bypass_actors'];
// The bypass actors that are machines rather than people's roles: GitHub's
// actor_type for an App, and for a deploy key. checkRulesets lets them bypass
// a tag ruleset only.
const MACHINE_ACTORS = ['Integration', 'DeployKey'];

// Server-Log.js --stamp puts the time on each line, as it does for the bridge.
function log(line) {
  console.log(line);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function unb64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// The claims of a GitHub Actions OIDC token, once its signature checks out
// against one of GitHub's keys and every claim is what RULES says. Throws
// with why otherwise. now is in seconds.
function verifyOidc(token, jwks, now, rules) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw new Error('not a token');
  let head, claims;
  try {
    head = JSON.parse(unb64url(parts[0]).toString('utf8'));
    claims = JSON.parse(unb64url(parts[1]).toString('utf8'));
  } catch (e) {
    throw new Error('not a token');
  }
  if (head.alg !== 'RS256') throw new Error('signed with ' + head.alg + ', not RS256');
  const jwk = ((jwks && jwks.keys) || []).find(k => k.kid === head.kid && k.kty === 'RSA');
  if (!jwk) throw new Error('signed with a key GitHub does not publish');
  const key = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
  const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, unb64url(parts[2]));
  if (!ok) throw new Error('its signature does not check out');
  if (claims.iss !== rules.iss) throw new Error('issued by ' + claims.iss);
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (aud.indexOf(rules.aud) < 0) throw new Error('for the audience ' + aud.join(', '));
  if (!(Number(claims.exp) > now)) throw new Error('expired');
  if (claims.nbf !== undefined && Number(claims.nbf) > now + 60) throw new Error('not valid yet');
  if (String(claims.repository_id) !== rules.repositoryId || !claims.repository) throw new Error('from ' + claims.repository + ' (repository id ' + claims.repository_id + ')');
  if (claims.ref !== rules.ref) throw new Error('from ' + claims.ref + ', not ' + rules.ref);
  if (claims.job_workflow_ref !== claims.repository + rules.workflow) throw new Error('from the workflow ' + claims.job_workflow_ref);
  if (rules.events.indexOf(claims.event_name) < 0) throw new Error('started by ' + claims.event_name);
  return claims;
}

// The App's own token, ten minutes at most, for asking GitHub for an
// installation token. now is in seconds.
function appJwt(appId, pem, now) {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(head + '.' + body), crypto.createPrivateKey(pem));
  return head + '.' + body + '.' + b64url(sig);
}

// A VPS runner's number from its name: thornswood-vps is 1, thornswood-vps-<n> is n.
function runnerNumber(name) {
  if (name === 'thornswood-vps') return 1;
  const m = /^thornswood-vps-(\d+)$/.exec(String(name));
  return m ? Number(m[1]) : 0;
}

// Checks each record and that no two name the same label. Throws with why.
function checkRecords(records) {
  const seen = {};
  for (const r of records) {
    const label = String(r.label || '').trim();
    if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(label)) throw new Error(r.file + ': the label must be one lower case word, and it is "' + r.label + '"');
    if (RESERVED.indexOf(label) >= 0) throw new Error(r.file + ': ' + label + ' is a label every runner carries or GitHub gives, so no record may name it');
    if (seen[label]) throw new Error(r.file + ' and ' + seen[label] + ' both name ' + label);
    seen[label] = r.file;
    const nums = Array.isArray(r.runners) ? r.runners : [];
    if (!nums.length) throw new Error(r.file + ' lists no runners, so no job asking for ' + label + ' could ever run');
    if (nums.some(n => !Number.isInteger(n) || n < 1)) throw new Error(r.file + ' lists a runner that is not a number from 1');
    if (new Set(nums).size !== nums.length) throw new Error(r.file + ' lists a runner twice');
    const off = Array.isArray(r.offBox) ? r.offBox : [];
    if (off.some(n => !/^thornswood-pr-[a-z0-9-]{1,40}$/.test(String(n)))) throw new Error(r.file + ' lists an off-box runner whose name is not thornswood-pr-<machine>[-<n>]');
    if (new Set(off).size !== off.length) throw new Error(r.file + ' lists an off-box runner twice');
  }
}

// What has to change for GitHub's runners to match one record:
// { changes: [{ id, name, do: 'put on'|'take off' }], lines, refuse }. refuse
// is why nothing may change for it, or ''.
function planLabels(record, runners) {
  const label = record.label;
  const want = record.runners;
  const offBox = Array.isArray(record.offBox) ? record.offBox : [];
  const changes = [];
  const lines = [];
  let carry = 0;
  for (const r of runners) {
    const n = runnerNumber(r.name);
    const has = (r.labels || []).some(l => l.name === label);
    // An off-box runner carries it only by its name in the record, and never
    // one that carries thornswood-vps too, which would take box-only jobs.
    const vps = (r.labels || []).some(l => l.name === 'thornswood-vps');
    const should = (n > 0 && want.indexOf(n) >= 0) || (n === 0 && !vps && offBox.indexOf(r.name) >= 0);
    if (should) carry++;
    if (has && !should) changes.push({ id: r.id, name: r.name, do: 'take off' });
    else if (should && !has) changes.push({ id: r.id, name: r.name, do: 'put on' });
  }
  for (const n of want) {
    if (!runners.some(r => runnerNumber(r.name) === n)) lines.push('runner ' + n + ' is in ' + record.file + ' but not registered on GitHub');
  }
  for (const name of offBox) {
    if (!runners.some(r => r.name === name)) lines.push('off-box runner ' + name + ' is in ' + record.file + ' but not registered on GitHub');
  }
  const refuse = carry ? '' : 'no runner ' + record.file + ' lists is registered on GitHub, so every job asking for ' + label + ' would wait for a runner that never comes';
  return { changes, lines, refuse };
}

// The labels on GitHub's runners that no record names: every label of our
// own (not one GitHub gives, type read-only, and not one RESERVED lists)
// that main has no record for any more. [{ id, name, label }] to take off.
function planLeftovers(records, runners) {
  const named = records.map(r => String(r.label || '').trim().toLowerCase());
  const out = [];
  for (const r of runners) {
    for (const l of r.labels || []) {
      const n = String(l.name || '').toLowerCase();
      if (l.type === 'read-only' || RESERVED.indexOf(n) >= 0 || named.indexOf(n) >= 0) continue;
      out.push({ id: r.id, name: r.name, label: l.name });
    }
  }
  return out;
}

// Checks one repository's rulesets in main's settings record. An empty list
// says the repository has none. Throws with why.
function checkRulesets(repo, list) {
  const at = SETTINGS_FILE + ', ' + repo;
  if (!Array.isArray(list)) throw new Error(at + ': no rulesets list (an empty one says it has none)');
  const seen = {};
  for (const r of list) {
    const name = String((r && r.name) || '').trim();
    if (!name) throw new Error(at + ': a ruleset has no name');
    if (seen[name]) throw new Error(at + ' names ' + name + ' twice');
    seen[name] = true;
    if (['branch', 'tag'].indexOf(r.target) < 0) throw new Error(at + ': ' + name + ' targets ' + r.target + ', not branch or tag');
    if (['active', 'disabled'].indexOf(r.enforcement) < 0) throw new Error(at + ': ' + name + ' is ' + r.enforcement + ', not active or disabled');
    const inc = r.conditions && r.conditions.ref_name && r.conditions.ref_name.include;
    if (!Array.isArray(inc) || !inc.length) throw new Error(at + ': ' + name + ' applies to no ref');
    if (!Array.isArray(r.rules) || !r.rules.length || r.rules.some(x => !x || typeof x.type !== 'string')) throw new Error(at + ': ' + name + ' has no rules, or one with no type');
    if (!Array.isArray(r.bypass_actors)) throw new Error(at + ': ' + name + ' does not say who may bypass it (an empty list is nobody)');
    // An App or a deploy key, a machine's identity, may bypass a tag ruleset
    // and never a branch one (the redesign's part 20, 1 Nov 2026): a branch
    // is changed only through a pull request with its checks, whoever pushes.
    for (const b of r.bypass_actors) {
      // GitHub Actions, the identity of a run's own token, is refused as a
      // bypass actor: 422 Validation Failed on 31 Oct 2026 in a personal
      // repository and on 1 Nov 2026 in the organization (#5296).
      if (b && b.actor_type === 'Integration' && b.actor_id === 15368) {
        throw new Error(at + ': ' + name + ' lets GitHub Actions (15368) bypass it, which GitHub refuses (422); a run that must bypass a ruleset uses an App of its own');
      }
      if (MACHINE_ACTORS.indexOf(b && b.actor_type) >= 0 && r.target !== 'tag') {
        throw new Error(at + ': ' + name + ' lets ' + (b.actor_type === 'Integration' ? 'the App ' + b.actor_id : 'a deploy key') + ' bypass a branch ruleset; an App or a deploy key may bypass only a tag ruleset');
      }
    }
  }
}

// Checks main's settings record: Thornswood, the fork and Ops only, each
// once, with its rulesets (none for Ops), each switch a yes or no when it is
// given, and the merge methods all three or none. Throws.
function checkSettings(doc) {
  const list = doc && doc.repositories;
  if (!Array.isArray(list) || !list.length) throw new Error(SETTINGS_FILE + ' names no repositories');
  const seen = {};
  for (const e of list) {
    const repo = String((e && e.repository) || '');
    if (SETTINGS_REPOS.indexOf(repo) < 0) throw new Error(SETTINGS_FILE + ' names ' + (repo || 'a repository with no name') + ', and the only ones this changes are ' + SETTINGS_REPOS.slice(0, -1).join(', ') + ' and ' + SETTINGS_REPOS[SETTINGS_REPOS.length - 1]);
    if (seen[repo]) throw new Error(SETTINGS_FILE + ' names ' + repo + ' twice');
    seen[repo] = true;
    for (const k of Object.keys(SWITCHES).concat(SCANNING_KEYS, MERGE_KEYS)) {
      if (e[k] !== undefined && typeof e[k] !== 'boolean') throw new Error(SETTINGS_FILE + ', ' + repo + ': ' + k + ' is true or false, not ' + JSON.stringify(e[k]));
    }
    // GitHub has no push protection without the scanning it protects.
    if (e.secret_scanning_push_protection === true && e.secret_scanning !== true) throw new Error(SETTINGS_FILE + ', ' + repo + ': secret_scanning_push_protection is on only with secret_scanning on too');
    const methods = METHOD_KEYS.filter(k => e[k] !== undefined);
    if (methods.length && methods.length < METHOD_KEYS.length) throw new Error(SETTINGS_FILE + ', ' + repo + ': it names ' + methods.join(' and ') + ' but not ' + METHOD_KEYS.filter(k => methods.indexOf(k) < 0).join(' and ') + '; the merge methods are all three or none');
    if (methods.length && !METHOD_KEYS.some(k => e[k] === true)) throw new Error(SETTINGS_FILE + ', ' + repo + ': it allows no way to merge, which GitHub refuses; one of ' + METHOD_KEYS.join(', ') + ' is true');
    if (FREE_PRIVATE_REPOS.indexOf(repo) >= 0) {
      if (e.rulesets !== undefined) throw new Error(SETTINGS_FILE + ', ' + repo + ': GitHub Free keeps no rulesets on a private repository, so its entry names none');
      if (e.allow_auto_merge === true) throw new Error(SETTINGS_FILE + ', ' + repo + ': GitHub Free has no auto-merge on a private repository; Bramble merges its pull requests');
    } else {
      checkRulesets(repo, e.rulesets);
    }
    if (e.collaborators !== undefined) checkCollaborators(repo, e.collaborators);
  }
}

// Checks an entry's collaborators: a list of GitHub logins, each once, never
// the owner (who is not a collaborator and can never be taken off). An empty
// list says nobody but the owner. Throws.
function checkCollaborators(repo, list) {
  const at = SETTINGS_FILE + ', ' + repo;
  if (!Array.isArray(list)) throw new Error(at + ': collaborators is a list of GitHub logins, not ' + JSON.stringify(list));
  const seen = {};
  for (const x of list) {
    if (typeof x !== 'string' || !LOGIN.test(x)) throw new Error(at + ': ' + JSON.stringify(x) + ' is not a GitHub login');
    const k = x.toLowerCase();
    if (k === OWNER.toLowerCase() || k === HOLDER.toLowerCase()) throw new Error(at + ': ' + x + ' owns these repositories, is not a collaborator and is never listed');
    if (seen[k]) throw new Error(at + ' names the collaborator ' + x + ' twice');
    seen[k] = true;
  }
}

// What has to change for a repository's people to match its list:
// { missing: [login], drop: [login], withdraw: [{ id, login }], right: [login] }.
// missing is only ever reported: this App takes people off and never adds
// anybody (a named login with an open invitation is neither right nor
// missing).
// have is GitHub's direct collaborators ({ login }), invites its open
// invitations ({ id, invitee: { login } }). Logins compare in any case, as
// GitHub's do. The owner is never dropped.
function planCollaborators(list, have, invites) {
  const named = k => list.some(x => x.toLowerCase() === k.toLowerCase());
  const logins = have.map(c => String(c.login)).filter(l => l.toLowerCase() !== OWNER.toLowerCase() && l.toLowerCase() !== HOLDER.toLowerCase());
  const asked = invites.map(i => ({ id: i.id, login: String((i.invitee && i.invitee.login) || '') }));
  const right = list.filter(x => logins.some(l => l.toLowerCase() === x.toLowerCase()));
  const missing = list.filter(x => !right.includes(x) && !asked.some(i => i.login.toLowerCase() === x.toLowerCase()));
  const drop = logins.filter(l => !named(l));
  const withdraw = asked.filter(i => !named(i.login));
  return { missing, drop, withdraw, right };
}

// The body GitHub is sent for one record entry: its API keys and nothing else.
function rulesetBody(r) {
  const out = {};
  for (const k of RULESET_KEYS) out[k] = r[k];
  return out;
}

// Whether GitHub's copy says everything the record says. An object matches
// when each key the record gives matches (GitHub adds ids, links and
// defaults of its own); a list matches when it has as many entries and, in
// a stable order, each matches; anything else is equal.
function says(want, have) {
  if (Array.isArray(want)) {
    if (!Array.isArray(have) || have.length !== want.length) return false;
    const key = x => JSON.stringify(x && typeof x === 'object' ? [x.type, x.actor_type, x.actor_id, x.context] : x);
    const w = want.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const h = have.slice().sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    return w.every((x, i) => says(x, h[i]));
  }
  if (want && typeof want === 'object') {
    if (!have || typeof have !== 'object') return false;
    return Object.keys(want).every(k => says(want[k], have[k]));
  }
  return want === have;
}

// What has to change for GitHub's rulesets to match the record:
// { make: [entry], put: [{ id, entry }], extra: [name], right: [name] }.
// have is GitHub's rulesets, each read in full.
function planRulesets(list, have) {
  const make = [], put = [], right = [];
  for (const r of list) {
    const g = have.find(x => x.name === r.name);
    if (!g) make.push(r);
    else if (!says(rulesetBody(r), g)) put.push({ id: g.id, entry: r });
    else right.push(r.name);
  }
  const extra = have.filter(g => !list.some(r => r.name === g.name)).map(g => g.name);
  return { make, put, extra, right };
}

// Checks the About record. Throws with why. GitHub takes a description of
// 350 characters at most, and topics of lower case letters, digits and
// hyphens, 50 characters each and 20 at most.
function checkAbout(rec) {
  const d = rec.description;
  if (typeof d !== 'string' || !d.trim()) throw new Error(rec.file + ': the description is empty');
  if (d.length > 350) throw new Error(rec.file + ': the description is ' + d.length + ' characters, and GitHub takes 350');
  if (/[\r\n]/.test(d)) throw new Error(rec.file + ': the description is more than one line');
  const h = rec.homepage;
  if (typeof h !== 'string' || (h !== '' && !/^https:\/\/[^\s/?#]+\.[^\s]+$/.test(h))) throw new Error(rec.file + ': the website is not an https address');
  const t = rec.topics;
  if (!Array.isArray(t) || !t.length) throw new Error(rec.file + ' lists no topics');
  if (t.length > 20) throw new Error(rec.file + ' lists ' + t.length + ' topics, and GitHub takes 20');
  for (const x of t) if (typeof x !== 'string' || !/^[a-z0-9][a-z0-9-]{0,49}$/.test(x)) throw new Error(rec.file + ': the topic "' + x + '" is not lower case letters, digits and hyphens');
  if (new Set(t).size !== t.length) throw new Error(rec.file + ' lists a topic twice');
}

// What has to change for the About box to match the record:
// [{ what: 'description'|'website'|'topics', from, to }]. GitHub keeps
// topics in no order of ours, so they compare as a set.
function planAbout(rec, repo, topics) {
  const out = [];
  const has = (repo && repo.description) || '';
  const site = (repo && repo.homepage) || '';
  if (has !== rec.description) out.push({ what: 'description', from: has, to: rec.description });
  if (site !== rec.homepage) out.push({ what: 'website', from: site, to: rec.homepage });
  const now = (topics || []).slice().sort();
  const want = rec.topics.slice().sort();
  if (now.join(' ') !== want.join(' ')) out.push({ what: 'topics', from: now.join(', '), to: want.join(', ') });
  return out;
}

// ------------------------------------------------------------------ GitHub --
// One HTTPS call. Resolves { status, body } with the body parsed when it is
// JSON; never rejects for a status, only when nothing answered.
// GitHub answers a request to a repository that moved (a rename, or the move
// into the Thornswood organization, #5184) with a redirect to where it is
// now, and its REST guide says a client follows it: 301, 302 and 303 for a
// read, 307 and 308 for anything, with the same method and body. Only one on
// the same host as the request is followed, so the App's or a run's token
// never goes anywhere else, and at most five, so a loop ends.
const REDIRECTS = 5;
function call(method, url, headers, body, hops) {
  return send(method, url, headers, body).then(a => {
    const to = a.location ? new URL(a.location, url) : null;
    const read = method === 'GET' || method === 'HEAD';
    const follows = to && ([307, 308].includes(a.status) || (read && [301, 302, 303].includes(a.status)));
    if (!follows) return { status: a.status, body: a.body };
    if (to.host !== new URL(url).host) return { status: a.status, body: { message: 'redirected to another host, ' + to.host + ', which is not followed' } };
    if ((hops || 0) >= REDIRECTS) return { status: a.status, body: { message: 'redirected more than ' + REDIRECTS + ' times' } };
    return call(method, to.toString(), headers, body, (hops || 0) + 1);
  });
}
function send(method, url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const h = Object.assign({ 'User-Agent': 'thornswood-admin', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, headers || {});
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
    const req = (u.protocol === 'http:' ? http : https).request(u, { method, headers: h, timeout: 30000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        if (text.trim()) { try { parsed = JSON.parse(text); } catch (e) { parsed = text; } } else parsed = null;
        resolve({ status: res.statusCode, body: parsed, location: res.headers.location });
      });
    });
    req.on('timeout', () => req.destroy(new Error(method + ' ' + u.pathname + ' had no answer in 30 seconds')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
// What GitHub answered, with its reasons. A 422 says only "Validation
// Failed" in message; why is in errors, as strings (rulesets) or as
// { resource, field, code, message } objects, and leaving them out hid why
// the release tag ruleset was refused on 1 Nov 2026 (#5296).
function said(a) {
  const b = a.body || {};
  const why = (Array.isArray(b.errors) ? b.errors : []).map(e =>
    typeof e === 'string' ? e : (e && (e.message || [e.resource, e.field, e.code].filter(Boolean).join(' '))) || '').filter(Boolean);
  return 'HTTP ' + a.status + (b.message ? ': ' + b.message : '') + (why.length ? ' (' + why.join('; ') + ')' : '');
}

function readApp() {
  const keyPath = path.join(STATE, 'key.pem');
  const appPath = path.join(STATE, 'app.json');
  if (!fs.existsSync(keyPath) || !fs.existsSync(appPath)) return null;
  return { pem: fs.readFileSync(keyPath, 'utf8'), app: JSON.parse(fs.readFileSync(appPath, 'utf8')) };
}

// What settings reads with, all of it read only. The last three are asked for
// only when the installation holds them (SETTINGS_EXTRA): the App was first
// made with administration and contents alone, and Patrick chose on 26 Oct
// (#3534) to give it Secrets, Variables and Environments read, which an App
// already made takes only once he adds them on its page and accepts them on
// the installation. GitHub calls the Variables permission actions_variables.
const SETTINGS_PERMISSIONS = { administration: 'read', contents: 'read' };
const SETTINGS_EXTRA = ['secrets', 'actions_variables', 'environments'];

// Which permissions the installation holds, and where it is:
// { id, permissions }. One App on one account has one installation, found
// by any repository it holds.
async function installation(held, now) {
  const jwt = appJwt(held.app.id, held.pem, now);
  const inst = await call('GET', API + '/repos/' + REPO + '/installation', { Authorization: 'Bearer ' + jwt });
  if (inst.status === 404) throw new Error('the App is not installed on ' + REPO + ' yet: ' + WEB + '/apps/' + held.app.slug + '/installations/new');
  if (inst.status !== 200) throw new Error('GitHub would not say where the App is installed (' + said(inst) + ')');
  return { id: inst.body.id, permissions: (inst.body && inst.body.permissions) || {} };
}

// A token for the hour GitHub gives it, with only the permissions given,
// for one repository, or with repo null for every repository the
// installation holds (installation-repos, which asks for their metadata
// alone); nothing keeps it after the request.
async function installationToken(held, now, repo, permissions, inst) {
  const where = inst || await installation(held, now);
  const jwt = appJwt(held.app.id, held.pem, now);
  const tok = await call('POST', API + '/app/installations/' + where.id + '/access_tokens', { Authorization: 'Bearer ' + jwt },
    repo ? { repositories: [repo.split('/')[1]], permissions } : { permissions });
  if (tok.status !== 201) throw new Error('GitHub gave the App no token (' + said(tok) + ')');
  return tok.body.token;
}

// Every records/<name>-runners.json on main, read through the App.
async function mainRecords(token) {
  const auth = { Authorization: 'Bearer ' + token };
  const dir = await call('GET', API + '/repos/' + REPO + '/contents/records?ref=main', auth);
  if (dir.status !== 200 || !Array.isArray(dir.body)) throw new Error('GitHub would not list records on main (' + said(dir) + ')');
  const out = [];
  for (const f of dir.body.filter(x => x.type === 'file' && /^[a-z0-9-]+-runners\.json$/.test(x.name)).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const got = await call('GET', API + '/repos/' + REPO + '/contents/records/' + f.name + '?ref=main', auth);
    if (got.status !== 200 || !got.body || !got.body.content) throw new Error('GitHub would not give records/' + f.name + ' on main (' + said(got) + ')');
    let j;
    try { j = JSON.parse(Buffer.from(got.body.content, 'base64').toString('utf8').replace(/^﻿/, '')); }
    catch (e) { throw new Error('records/' + f.name + ' on main is not JSON'); }
    out.push({ file: 'records/' + f.name, label: String(j.label || '').trim(), runners: Array.isArray(j.runners) ? j.runners.map(Number) : [], offBox: Array.isArray(j.offBox) ? j.offBox.map(String) : [] });
  }
  return out;
}

// main's settings record, read through the App.
async function mainSettings(token) {
  const got = await call('GET', API + '/repos/' + REPO + '/contents/' + SETTINGS_FILE + '?ref=main', { Authorization: 'Bearer ' + token });
  if (got.status === 404) throw new Error('main has no ' + SETTINGS_FILE + ', so there is nothing to match');
  if (got.status !== 200 || !got.body || !got.body.content) throw new Error('GitHub would not give ' + SETTINGS_FILE + ' on main (' + said(got) + ')');
  try { return JSON.parse(Buffer.from(got.body.content, 'base64').toString('utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error(SETTINGS_FILE + ' on main is not JSON'); }
}

// A repository's own rulesets, each read in full.
async function listRulesets(token, repo) {
  const auth = { Authorization: 'Bearer ' + token };
  const a = await call('GET', API + '/repos/' + repo + '/rulesets?includes_parents=false&per_page=100', auth);
  if (a.status !== 200 || !Array.isArray(a.body)) throw new Error('GitHub would not list the rulesets of ' + repo + ' (' + said(a) + ')');
  const out = [];
  for (const s of a.body) {
    const one = await call('GET', API + '/repos/' + repo + '/rulesets/' + s.id, auth);
    if (one.status !== 200 || !one.body) throw new Error('GitHub would not give the ruleset ' + s.name + ' of ' + repo + ' (' + said(one) + ')');
    out.push(one.body);
  }
  return out;
}

// Makes one repository's rulesets match its entry, or with check says only
// what differs. { ok, lines, changed, differs }.
async function rulesets(token, repo, list, check) {
  const p = planRulesets(list, await listRulesets(token, repo));
  const lines = [];
  let changed = 0;
  let ok = true;
  for (const n of p.right) lines.push(repo + ': GitHub matches the record for the ruleset ' + n);
  for (const n of p.extra) { lines.push('STOP ' + repo + ': GitHub has a ruleset ' + n + ' that ' + SETTINGS_FILE + ' does not name; it was left as it is. Add it to the record, or remove it on GitHub on purpose'); ok = false; }
  const differs = p.make.length + p.put.length;
  const auth = { Authorization: 'Bearer ' + token };
  for (const r of p.make) {
    if (check) { lines.push(repo + ': the ruleset ' + r.name + ' would be made (' + r.enforcement + ')'); continue; }
    const a = await call('POST', API + '/repos/' + repo + '/rulesets', auth, rulesetBody(r));
    if (a.status !== 201) { lines.push('STOP ' + repo + ': GitHub did not make the ruleset ' + r.name + ' (' + said(a) + ')'); ok = false; continue; }
    changed++;
    lines.push(repo + ': the ruleset ' + r.name + ' made (' + r.enforcement + ')');
  }
  for (const c of p.put) {
    if (check) { lines.push(repo + ': the ruleset ' + c.entry.name + ' differs and would be put back'); continue; }
    const a = await call('PUT', API + '/repos/' + repo + '/rulesets/' + c.id, auth, rulesetBody(c.entry));
    if (a.status !== 200) { lines.push('STOP ' + repo + ': GitHub did not put the ruleset ' + c.entry.name + ' back (' + said(a) + ')'); ok = false; continue; }
    changed++;
    lines.push(repo + ': the ruleset ' + c.entry.name + ' put back (' + c.entry.enforcement + ')');
  }
  if (!check && changed) {
    // Read back rather than trust the calls.
    const again = planRulesets(list, await listRulesets(token, repo));
    for (const r of again.make.concat(again.put.map(c => c.entry))) { lines.push('STOP ' + repo + ': GitHub still differs for the ruleset ' + r.name); ok = false; }
  }
  return { ok, lines, changed, differs };
}

// A repository's direct collaborators and its open invitations, read in
// full: { have, invites }.
async function listPeople(token, repo) {
  const auth = { Authorization: 'Bearer ' + token };
  const all = async (what, part) => {
    const out = [];
    for (let page = 1; ; page++) {
      const a = await call('GET', API + '/repos/' + repo + '/' + part + (part.includes('?') ? '&' : '?') + 'per_page=100&page=' + page, auth);
      if (a.status !== 200 || !Array.isArray(a.body)) throw new Error('GitHub would not list the ' + what + ' of ' + repo + ' (' + said(a) + ')');
      out.push(...a.body);
      if (a.body.length < 100) return out;
    }
  };
  return { have: await all('collaborators', 'collaborators?affiliation=direct'), invites: await all('invitations', 'invitations') };
}

// Takes off whoever of a repository's collaborators and invitations its list
// does not name, or with check says only who that is. One the list names who
// is not there is reported and never invited (remove only, 31 Oct 2026).
// { ok, lines, changed, differs }.
async function collaborators(token, repo, list, check) {
  const p0 = await listPeople(token, repo);
  const p = planCollaborators(list, p0.have, p0.invites);
  const lines = p.right.map(l => repo + ': ' + l + ' is a collaborator, as the record says');
  const notHere = l => repo + ': ' + l + ' is named but not a collaborator; Patrick invites them by hand on GitHub';
  const differs = p.drop.length + p.withdraw.length;
  if (!differs) return { ok: true, lines: lines.concat(p.missing.map(notHere)), changed: 0, differs: 0 };
  if (check) {
    for (const l of p.drop) lines.push(repo + ': ' + l + ' would be taken off, as the record does not name them');
    for (const i of p.withdraw) lines.push(repo + ': the invitation to ' + i.login + ' would be withdrawn, as the record does not name them');
    for (const l of p.missing) lines.push(notHere(l));
    return { ok: true, lines, changed: 0, differs };
  }
  const auth = { Authorization: 'Bearer ' + token };
  let ok = true, changed = 0;
  for (const l of p.drop) {
    const a = await call('DELETE', API + '/repos/' + repo + '/collaborators/' + encodeURIComponent(l), auth);
    if (a.status !== 204) { lines.push('STOP ' + repo + ': GitHub did not take ' + l + ' off (' + said(a) + ')'); ok = false; continue; }
    changed++;
    lines.push(repo + ': ' + l + ' taken off');
  }
  for (const i of p.withdraw) {
    const a = await call('DELETE', API + '/repos/' + repo + '/invitations/' + Number(i.id), auth);
    if (a.status !== 204) { lines.push('STOP ' + repo + ': GitHub did not withdraw the invitation to ' + i.login + ' (' + said(a) + ')'); ok = false; continue; }
    changed++;
    lines.push(repo + ': the invitation to ' + i.login + ' withdrawn');
  }
  for (const l of p.missing) lines.push(notHere(l));
  // Read back rather than trust the calls.
  const p1 = await listPeople(token, repo);
  const again = planCollaborators(list, p1.have, p1.invites);
  for (const l of again.drop) { lines.push('STOP ' + repo + ': GitHub still has ' + l + ' as a collaborator'); ok = false; }
  for (const i of again.withdraw) { lines.push('STOP ' + repo + ': GitHub still has an invitation to ' + i.login); ok = false; }
  return { ok, lines, changed, differs };
}

// Makes one of a repository's on-or-off switches (SWITCHES: private
// vulnerability reporting, immutable releases) on or off as its entry says,
// or with check says only whether it differs. GitHub answers each the same
// way: GET says { enabled }, PUT switches it on and DELETE off, with 204.
async function setSwitch(token, repo, key, want, check) {
  const auth = { Authorization: 'Bearer ' + token };
  const url = API + '/repos/' + repo + '/' + SWITCHES[key].path;
  const what = SWITCHES[key].name;
  const word = want ? 'on' : 'off';
  const read = async () => {
    const a = await call('GET', url, auth);
    if (a.status !== 200 || !a.body || typeof a.body.enabled !== 'boolean') throw new Error('GitHub would not say whether ' + what + ' is on for ' + repo + ' (' + said(a) + ')');
    return a.body.enabled;
  };
  if ((await read()) === want) return { ok: true, lines: [repo + ': ' + what + ' is ' + word + ', as the record says'], changed: 0, differs: 0 };
  if (check) return { ok: true, lines: [repo + ': ' + what + ' would be switched ' + word], changed: 0, differs: 1 };
  const a = await call(want ? 'PUT' : 'DELETE', url, auth);
  if (a.status !== 204) return { ok: false, lines: ['STOP ' + repo + ': GitHub did not switch ' + what + ' ' + word + ' (' + said(a) + ')'], changed: 0, differs: 1 };
  // Read back rather than trust the call.
  if ((await read()) !== want) return { ok: false, lines: ['STOP ' + repo + ': GitHub still has ' + what + ' ' + (want ? 'off' : 'on')], changed: 1, differs: 1 };
  return { ok: true, lines: [repo + ': ' + what + ' switched ' + word], changed: 1, differs: 1 };
}

// Makes a repository's secret scanning and push protection on or off as its
// entry says (only the keys it gives), in one PATCH, or with check says only
// which differ.
async function scanning(token, repo, e, check) {
  const keys = SCANNING_KEYS.filter(k => typeof e[k] === 'boolean');
  const auth = { Authorization: 'Bearer ' + token };
  const word = k => (e[k] ? 'on' : 'off');
  const name = k => (k === 'secret_scanning' ? 'secret scanning' : 'push protection');
  const read = async () => {
    const a = await call('GET', API + '/repos/' + repo, auth);
    const sa = a.body && a.body.security_and_analysis;
    if (a.status !== 200 || !sa) throw new Error('GitHub would not say whether secret scanning is on for ' + repo + ' (' + said(a) + ')');
    return keys.filter(k => ((sa[k] && sa[k].status) === 'enabled') !== e[k]);
  };
  const off = await read();
  const lines = keys.filter(k => off.indexOf(k) < 0).map(k => repo + ': ' + name(k) + ' is ' + word(k) + ', as the record says');
  if (!off.length) return { ok: true, lines, changed: 0, differs: 0 };
  if (check) return { ok: true, lines: lines.concat(off.map(k => repo + ': ' + name(k) + ' would be switched ' + word(k))), changed: 0, differs: off.length };
  const body = { security_and_analysis: {} };
  for (const k of off) body.security_and_analysis[k] = { status: e[k] ? 'enabled' : 'disabled' };
  const a = await call('PATCH', API + '/repos/' + repo, auth, body);
  if (a.status !== 200) return { ok: false, lines: lines.concat(['STOP ' + repo + ': GitHub did not switch ' + off.map(name).join(' and ') + ' (' + said(a) + ')']), changed: 0, differs: off.length };
  // Read back rather than trust the call.
  const still = await read();
  if (still.length) return { ok: false, lines: lines.concat(still.map(k => 'STOP ' + repo + ': GitHub still has ' + name(k) + ' ' + (e[k] ? 'off' : 'on'))), changed: off.length - still.length, differs: off.length };
  return { ok: true, lines: lines.concat(off.map(k => repo + ': ' + name(k) + ' switched ' + word(k))), changed: off.length, differs: off.length };
}

// Makes a repository's merge settings (MERGE_KEYS) what its entry says (only
// the keys it gives), in one PATCH of the keys that differ, or with check
// says only which differ. GitHub's repository read gives each as true or
// false.
async function mergeSettings(token, repo, e, check) {
  const keys = MERGE_KEYS.filter(k => typeof e[k] === 'boolean');
  const auth = { Authorization: 'Bearer ' + token };
  const word = k => (e[k] ? 'on' : 'off');
  const name = k => MERGE_NAMES[k];
  const read = async () => {
    const a = await call('GET', API + '/repos/' + repo, auth);
    if (a.status !== 200 || !a.body || keys.some(k => typeof a.body[k] !== 'boolean')) throw new Error('GitHub would not say whether ' + keys.map(name).join(' and ') + ' is on for ' + repo + ' (' + said(a) + ')');
    return keys.filter(k => a.body[k] !== e[k]);
  };
  const off = await read();
  const lines = keys.filter(k => off.indexOf(k) < 0).map(k => repo + ': ' + name(k) + ' is ' + word(k) + ', as the record says');
  if (!off.length) return { ok: true, lines, changed: 0, differs: 0 };
  if (check) return { ok: true, lines: lines.concat(off.map(k => repo + ': ' + name(k) + ' would be switched ' + word(k))), changed: 0, differs: off.length };
  const body = {};
  for (const k of off) body[k] = e[k];
  const a = await call('PATCH', API + '/repos/' + repo, auth, body);
  if (a.status !== 200) return { ok: false, lines: lines.concat(['STOP ' + repo + ': GitHub did not switch ' + off.map(name).join(' and ') + ' (' + said(a) + ')']), changed: 0, differs: off.length };
  // Read back rather than trust the call.
  const still = await read();
  if (still.length) return { ok: false, lines: lines.concat(still.map(k => 'STOP ' + repo + ': GitHub still has ' + name(k) + ' ' + (e[k] ? 'off' : 'on'))), changed: off.length - still.length, differs: off.length };
  return { ok: true, lines: lines.concat(off.map(k => repo + ': ' + name(k) + ' switched ' + word(k))), changed: off.length, differs: off.length };
}

// Makes every repository main's settings record names match its entry, or
// with check says only what differs. One repository's stop does not keep
// the others from being matched. { ok, lines, changed, differs }.
async function repoSettings(held, now, check) {
  const inst = await installation(held, now);
  const home = await installationToken(held, now, REPO, HOME_PERMISSIONS, inst);
  const doc = await mainSettings(home);
  checkSettings(doc);
  const out = { ok: true, lines: [], changed: 0, differs: 0 };
  const add = r => { out.ok = out.ok && r.ok; out.lines.push(...r.lines); out.changed += r.changed; out.differs += r.differs; };
  for (const e of doc.repositories) {
    try {
      let token = home;
      if (e.repository !== REPO) {
        // GitHub gives no token for a repository the installation does not hold.
        try { token = await installationToken(held, now, e.repository, FORK_PERMISSIONS, inst); }
        catch (err) { throw new Error(err.message + '; is the App installed on it? ' + WEB + '/settings/installations/' + inst.id); }
      }
      // checkSettings let only a Free private repository's entry leave them out.
      if (e.rulesets !== undefined) add(await rulesets(token, e.repository, e.rulesets, check));
      for (const k of Object.keys(SWITCHES)) if (typeof e[k] === 'boolean') add(await setSwitch(token, e.repository, k, e[k], check));
      if (SCANNING_KEYS.some(k => typeof e[k] === 'boolean')) add(await scanning(token, e.repository, e, check));
      if (MERGE_KEYS.some(k => typeof e[k] === 'boolean')) add(await mergeSettings(token, e.repository, e, check));
      if (Array.isArray(e.collaborators)) add(await collaborators(token, e.repository, e.collaborators, check));
    } catch (err) {
      add({ ok: false, lines: ['STOP ' + e.repository + ': ' + err.message + '; nothing more was changed there'], changed: 0, differs: 0 });
    }
  }
  return out;
}

// records/repo-about.json on main, read through the App.
async function aboutRecord(token) {
  const got = await call('GET', API + '/repos/' + REPO + '/contents/records/repo-about.json?ref=main', { Authorization: 'Bearer ' + token });
  if (got.status !== 200 || !got.body || !got.body.content) throw new Error('GitHub would not give records/repo-about.json on main (' + said(got) + ')');
  let j;
  try { j = JSON.parse(Buffer.from(got.body.content, 'base64').toString('utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('records/repo-about.json on main is not JSON'); }
  return { file: 'records/repo-about.json', description: j.description, homepage: j.homepage, topics: j.topics };
}

async function readAbout(token) {
  const auth = { Authorization: 'Bearer ' + token };
  const repo = await call('GET', API + '/repos/' + REPO, auth);
  if (repo.status !== 200 || !repo.body) throw new Error('GitHub would not give the repository (' + said(repo) + ')');
  const top = await call('GET', API + '/repos/' + REPO + '/topics', auth);
  if (top.status !== 200 || !top.body || !Array.isArray(top.body.names)) throw new Error('GitHub would not give the topics (' + said(top) + ')');
  return { repo: repo.body, topics: top.body.names };
}

// Makes the About box match main's record, or with check says only what
// differs. { ok, lines, changed, differs }, as runnerLabels answers.
async function repoAbout(token, check) {
  const rec = await aboutRecord(token);
  checkAbout(rec);
  const before = await readAbout(token);
  const plan = planAbout(rec, before.repo, before.topics);
  const lines = [];
  if (!plan.length) return { ok: true, lines: [rec.file + ': GitHub matches it'], changed: 0, differs: 0 };
  for (const c of plan) lines.push(rec.file + ': the ' + c.what + (check ? ' would be ' : ' is now ') + JSON.stringify(c.to) + ', was ' + JSON.stringify(c.from));
  if (check) return { ok: true, lines, changed: 0, differs: plan.length };
  const auth = { Authorization: 'Bearer ' + token };
  let ok = true;
  if (plan.some(c => c.what !== 'topics')) {
    const a = await call('PATCH', API + '/repos/' + REPO, auth, { description: rec.description, homepage: rec.homepage });
    if (a.status !== 200) { lines.push('STOP GitHub did not change the description and website (' + said(a) + ')'); ok = false; }
  }
  if (plan.some(c => c.what === 'topics')) {
    const a = await call('PUT', API + '/repos/' + REPO + '/topics', auth, { names: rec.topics });
    if (a.status !== 200) { lines.push('STOP GitHub did not change the topics (' + said(a) + ')'); ok = false; }
  }
  // Read back rather than trust the calls.
  const after = await readAbout(token);
  const left = planAbout(rec, after.repo, after.topics);
  if (left.length) { lines.push('STOP ' + rec.file + ': GitHub still differs in the ' + left.map(c => c.what).join(', ')); ok = false; }
  return { ok, lines, changed: plan.length - left.length, differs: plan.length };
}

async function listRunners(token) {
  const a = await call('GET', API + '/repos/' + RUNNERS_REPO + '/actions/runners?per_page=100', { Authorization: 'Bearer ' + token });
  if (a.status !== 200 || !a.body || !Array.isArray(a.body.runners)) throw new Error('GitHub would not list the runners (' + said(a) + ')');
  return a.body.runners;
}

// Makes the runners' labels match main's records, or with check says only
// what differs. { ok, lines, changed, differs }. read reads the records,
// token changes the runners.
async function runnerLabels(read, token, check) {
  const records = await mainRecords(read);
  if (!records.length) throw new Error('main has no records/*-runners.json, so there is nothing to match');
  checkRecords(records);
  const runners = await listRunners(token);
  const lines = [];
  let changed = 0;
  let differs = 0;
  let ok = true;
  for (const rec of records) {
    const p = planLabels(rec, runners);
    lines.push(...p.lines);
    if (p.refuse) { lines.push('STOP ' + p.refuse + '; nothing was changed for it'); ok = false; continue; }
    if (!p.changes.length) { lines.push(rec.file + ': GitHub matches it, ' + rec.label + ' on runner(s) ' + rec.runners.join(', ')); continue; }
    differs += p.changes.length;
    for (const c of p.changes) {
      if (check) { lines.push(rec.file + ': ' + c.name + ' would have ' + rec.label + ' ' + (c.do === 'put on' ? 'put on' : 'taken off')); continue; }
      const auth = { Authorization: 'Bearer ' + token };
      const a = c.do === 'put on'
        ? await call('POST', API + '/repos/' + RUNNERS_REPO + '/actions/runners/' + c.id + '/labels', auth, { labels: [rec.label] })
        : await call('DELETE', API + '/repos/' + RUNNERS_REPO + '/actions/runners/' + c.id + '/labels/' + encodeURIComponent(rec.label), auth);
      if (a.status !== 200) { lines.push('STOP ' + c.name + ': GitHub did not ' + c.do + ' ' + rec.label + ' (' + said(a) + ')'); ok = false; continue; }
      changed++;
      lines.push(rec.file + ': ' + c.name + ', ' + rec.label + ' ' + (c.do === 'put on' ? 'put on' : 'taken off'));
    }
  }
  // A label no record names comes off (#4033).
  for (const c of planLeftovers(records, runners)) {
    differs++;
    if (check) { lines.push('no record names ' + c.label + ': ' + c.name + ' would have it taken off'); continue; }
    const a = await call('DELETE', API + '/repos/' + RUNNERS_REPO + '/actions/runners/' + c.id + '/labels/' + encodeURIComponent(c.label), { Authorization: 'Bearer ' + token });
    if (a.status !== 200) { lines.push('STOP ' + c.name + ': GitHub did not take off ' + c.label + ' (' + said(a) + ')'); ok = false; continue; }
    changed++;
    lines.push('no record names ' + c.label + ': ' + c.name + ', taken off');
  }
  if (!check && changed) {
    // Read back rather than trust the calls.
    const after = await listRunners(token);
    for (const rec of records) {
      const p = planLabels(rec, after);
      if (!p.refuse && p.changes.length) { lines.push('STOP ' + rec.file + ': GitHub still differs for ' + p.changes.map(c => c.name).join(', ')); ok = false; }
    }
    const left = planLeftovers(records, after);
    if (left.length) { lines.push('STOP labels no record names are still on ' + left.map(c => c.name + ' (' + c.label + ')').join(', ')); ok = false; }
  }
  return { ok, lines, changed, differs };
}

// ---------------------------------------------------------------- settings --
// The environments records/github-settings.json on main names, read through
// the App, so the caller never says which to read.
async function mainSettingsRecord(token) {
  const got = await call('GET', API + '/repos/' + REPO + '/contents/records/github-settings.json?ref=main', { Authorization: 'Bearer ' + token });
  if (got.status === 404) return { environments: [] };
  if (got.status !== 200 || !got.body || !got.body.content) throw new Error('GitHub would not give records/github-settings.json on main (' + said(got) + ')');
  let j;
  try { j = JSON.parse(Buffer.from(got.body.content, 'base64').toString('utf8').replace(/^\uFEFF/, '')); }
  catch (e) { throw new Error('records/github-settings.json on main is not JSON'); }
  const envs = Object.keys((j && j.environments) || {}).filter(n => /^[A-Za-z0-9._-]{1,255}$/.test(n)).sort();
  return { environments: envs };
}

// Every name on every page of a list GitHub pages, key being the array's
// name in the answer (secrets, variables, runners).
async function pagedNames(token, pathPart, key, pick) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const a = await call('GET', API + '/repos/' + REPO + '/' + pathPart + (pathPart.indexOf('?') >= 0 ? '&' : '?') + 'per_page=100&page=' + page, { Authorization: 'Bearer ' + token });
    if (a.status !== 200 || !a.body || !Array.isArray(a.body[key])) return { ok: false, why: 'GET ' + pathPart + ' answered ' + said(a) };
    for (const x of a.body[key]) out.push(pick ? pick(x) : x.name);
    if (a.body[key].length < 100) break;
  }
  return { ok: true, items: out };
}

// The settings, read and never changed: { ok, readings, unread }. unread
// says, per thing not read, why. held is what the installation holds.
async function readSettings(token, held) {
  const auth = { Authorization: 'Bearer ' + token };
  const readings = {};
  const unread = [];
  const one = async (key, pathPart) => {
    const a = await call('GET', API + '/repos/' + REPO + '/' + pathPart, auth);
    if (a.status === 200) readings[key] = a.body;
    else unread.push(key + ': GET ' + pathPart + ' answered ' + said(a));
  };
  await one('actions', 'actions/permissions');
  if (readings.actions && readings.actions.allowed_actions === 'selected') await one('selected_actions', 'actions/permissions/selected-actions');
  await one('workflow_token', 'actions/permissions/workflow');
  await one('sharing', 'actions/permissions/access');
  await one('retention', 'actions/permissions/artifact-and-log-retention');
  await one('fork_pull_requests', 'actions/permissions/fork-pr-workflows-private-repos');
  const runners = await pagedNames(token, 'actions/runners', 'runners', r => ({ name: r.name, status: r.status, labels: (r.labels || []).map(l => l.name).sort() }));
  if (runners.ok) readings.runners = runners.items; else unread.push('runners: ' + runners.why);

  const has = p => held[p] === 'read' || held[p] === 'write';
  const need = what => 'the App has no ' + what + ' permission, so GitHub gives it none of these names';
  if (has('secrets')) {
    const r = await pagedNames(token, 'actions/secrets', 'secrets');
    if (r.ok) readings.secrets = r.items.sort(); else unread.push('secrets: ' + r.why);
  } else unread.push('secrets: ' + need('Secrets'));
  if (has('actions_variables')) {
    const r = await pagedNames(token, 'actions/variables', 'variables');
    if (r.ok) readings.variables = r.items.sort(); else unread.push('variables: ' + r.why);
  } else unread.push('variables: ' + need('Variables'));

  const rec = await mainSettingsRecord(token);
  readings.environments = {};
  for (const env of rec.environments) {
    const e = {};
    const at = 'environments/' + encodeURIComponent(env);
    if (has('environments')) {
      const s = await pagedNames(token, at + '/secrets', 'secrets');
      if (s.ok) e.secrets = s.items.sort(); else unread.push('environment ' + env + ' secrets: ' + s.why);
      const v = await pagedNames(token, at + '/variables', 'variables');
      if (v.ok) e.variables = v.items.sort(); else unread.push('environment ' + env + ' variables: ' + v.why);
    }
    readings.environments[env] = e;
  }
  if (rec.environments.length && !has('environments')) unread.push('environment secrets and variables: ' + need('Environments'));
  return { ok: true, readings, unread };
}

// What a scheduled repository settings check found, told to the board: the
// one open issue titled DRIFT_TITLE that this App opened is opened, or its
// body brought up to date, while GitHub differs from the record (or the
// check stopped), and closed with a comment once a check matches again.
// Uses the Issues write the Discord bot's token already takes, for this
// repository alone. Returns what it did, in a few words.
function driftBody(r) {
  // Only what differs or stopped; a line that says GitHub matches is left out.
  const what = r.lines.filter(l => /^STOP\b| would /.test(l));
  const shown = what.slice(0, DRIFT_LINES).map(l => '- ' + l);
  if (what.length > DRIFT_LINES) shown.push('- and ' + (what.length - DRIFT_LINES) + ' more in the run\'s log');
  return 'The nightly check of records/github-repo-settings.json found GitHub ' + (r.ok ? 'differs from it in ' + r.differs + ' place(s)' : 'could not be checked all the way') + ':\n\n' +
    shown.join('\n') + '\n\nDone when: the Desk\'s pwsh scripts/deploy/Set-BuildRunners.ps1 -RepoSettings run, or a pull request to the record, makes the nightly check match.';
}
async function reportDrift(held, now, r) {
  const token = await installationToken(held, now, REPO, BOT_PERMISSIONS);
  const auth = { Authorization: 'Bearer ' + token };
  const me = String(held.app.slug || '') + '[bot]';
  const list = await call('GET', API + '/repos/' + REPO + '/issues?state=open&per_page=100&creator=' + encodeURIComponent(me), auth);
  if (list.status !== 200 || !Array.isArray(list.body)) throw new Error('GitHub would not list the open issues (' + said(list) + ')');
  const open = list.body.find(i => i && i.title === DRIFT_TITLE && !i.pull_request);
  if (!r.ok || r.differs > 0) {
    const body = driftBody(r);
    if (open) {
      if (open.body === body) return 'issue #' + open.number + ' already says this';
      const a = await call('PATCH', API + '/repos/' + REPO + '/issues/' + open.number, auth, { body });
      if (a.status !== 200) throw new Error('GitHub did not update issue #' + open.number + ' (' + said(a) + ')');
      return 'issue #' + open.number + ' updated';
    }
    const a = await call('POST', API + '/repos/' + REPO + '/issues', auth, { title: DRIFT_TITLE, body });
    if (a.status !== 201 || !a.body) throw new Error('GitHub did not open the issue (' + said(a) + ')');
    return 'issue #' + a.body.number + ' opened';
  }
  if (!open) return 'GitHub matches the record';
  const c = await call('POST', API + '/repos/' + REPO + '/issues/' + open.number + '/comments', auth, { body: 'The nightly check matches the record again.' });
  if (c.status !== 201) throw new Error('GitHub did not take the comment on issue #' + open.number + ' (' + said(c) + ')');
  const a = await call('PATCH', API + '/repos/' + REPO + '/issues/' + open.number, auth, { state: 'closed', state_reason: 'completed' });
  if (a.status !== 200) throw new Error('GitHub did not close issue #' + open.number + ' (' + said(a) + ')');
  return 'issue #' + open.number + ' closed: GitHub matches the record again';
}

// The repositories the App's installation holds, and nothing changed.
// { ok, lines, repos }.
async function installationRepos(token) {
  const a = await call('GET', API + '/installation/repositories?per_page=100', { Authorization: 'Bearer ' + token });
  if (a.status !== 200 || !a.body || !Array.isArray(a.body.repositories)) throw new Error('GitHub would not list the App\'s repositories (' + said(a) + ')');
  const repos = a.body.repositories.map(r => String(r.full_name)).sort();
  const lines = repos.length ? repos.map(r => 'installed on ' + r) : ['installed on no repository'];
  return { ok: true, lines, repos };
}

// ------------------------------------------------------------ the bot ----
// The Discord bot reads Thornswood's issues and writes on them: the rule
// comments under a refused test task and the issues Report a problem files
// (bot\bot.py). It did that with a fine-grained token of Patrick's, which is
// bound to EvilPatrick06 and can write nothing of a repository after the move
// into ThornswoodRP (#5184). Patrick chose on 1 Nov 2026 (A) that this App
// gives it one instead: issues write on Thornswood alone, made here every
// BOT_EVERY seconds for the hour GitHub gives it, and written into FOR_BOT,
// which only SYSTEM, Administrators, this task and the bot's own account
// NT SERVICE\ThornswoodBot may read. No person's token, nothing to paste,
// nothing that runs out. The App takes Issues write only once it is added on
// its page and accepted on the installation; until then GitHub refuses, and
// the refusal is what the log says. Nothing is written without the folder,
// so a box whose install has not made it is left as it was.
const BOT_PERMISSIONS = { issues: 'write' };
const BOT_FILE = 'github-token.json';
let botSaid = '';

function botLog(line) {
  if (line !== botSaid) log('bot token: ' + line);
  botSaid = line;
}

// One new token into FOR_BOT, or the reason there is none. Written whole
// beside the old one and renamed over it, so the bot never reads half a file.
// The token is never logged. Returns the line it logged.
async function botToken(now) {
  if (!fs.existsSync(FOR_BOT)) { botLog('no ' + FOR_BOT + ', which Install-AdminService.ps1 makes, so none is made'); return botSaid; }
  const held = readApp();
  if (!held) { botLog('no App held yet, so none is made'); return botSaid; }
  try {
    const where = await installation(held, now);
    const jwt = appJwt(held.app.id, held.pem, now);
    const tok = await call('POST', API + '/app/installations/' + where.id + '/access_tokens', { Authorization: 'Bearer ' + jwt },
      { repositories: [REPO.split('/')[1]], permissions: BOT_PERMISSIONS });
    if (tok.status !== 201 || !tok.body || !tok.body.token) {
      throw new Error('GitHub gave the App no issues token for ' + REPO + ' (' + said(tok) + '). It takes Issues write only once it is added on ' +
        WEB + '/settings/apps/' + (held.app.slug || '<the App>') + '/permissions and accepted on the installation');
    }
    const doc = { token: tok.body.token, expires_at: String(tok.body.expires_at || ''), repository: REPO, permissions: BOT_PERMISSIONS, made: new Date(now * 1000).toISOString() };
    const file = path.join(FOR_BOT, BOT_FILE);
    const part = file + '.part';
    fs.writeFileSync(part, JSON.stringify(doc) + '\n');
    fs.renameSync(part, file);
    botLog('made for ' + REPO + ' issues, written to ' + file + ', every ' + BOT_EVERY + ' seconds');
  } catch (e) {
    botLog(e.message);
  }
  return botSaid;
}

function keepBotToken() {
  const once = () => botToken(Math.floor(Date.now() / 1000)).catch(e => botLog(e.message));
  once();
  const t = setInterval(once, BOT_EVERY * 1000);
  if (t.unref) t.unref();
  return t;
}

// ------------------------------------------------------------------- setup --
function readSetup(now) {
  const p = path.join(STATE, 'setup.json');
  if (!fs.existsSync(p)) return null;
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!s.state || !(Number(s.expires) > now)) return null;
  return s;
}
function sameState(a, b) {
  const x = Buffer.from(String(a || ''));
  const y = Buffer.from(String(b || ''));
  return x.length === y.length && x.length >= 32 && crypto.timingSafeEqual(x, y);
}
function manifest() {
  return {
    name: 'Thornswood box admin',
    url: 'https://thornswood.net',
    hook_attributes: { url: 'https://thornswood.net/github-app/hook', active: false },
    redirect_url: 'https://thornswood.net/github-app/setup/done',
    public: false,
    default_permissions: { administration: 'write', contents: 'read', secrets: 'read', actions_variables: 'read', environments: 'write', actions: 'write', issues: 'write', deployments: 'write' },
    default_events: [],
  };
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function page(res, status, title, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + esc(title) +
    '</title><body style="font-family:sans-serif;max-width:40em;margin:2em auto;padding:0 1em"><h1>' + esc(title) + '</h1>' + body + '</body>');
}

async function setupStart(res, q, now) {
  const s = readSetup(now);
  if (!s || readApp() || !sameState(q.get('state'), s.state)) { plain(res); return; }
  const action = WEB + '/settings/apps/new?state=' + encodeURIComponent(s.state);
  page(res, 200, 'Make the Thornswood box admin App',
    '<p>This makes a private GitHub App on your account that can change the runners\' labels, the About box, the rulesets and private vulnerability reporting, and read the repository, and nothing else. Its key comes straight back to the box and is never shown.</p>' +
    '<form action="' + esc(action) + '" method="post"><input type="hidden" name="manifest" value="' + esc(JSON.stringify(manifest())) + '">' +
    '<p><button type="submit" style="font-size:1.2em;padding:.5em 1em">Make it on GitHub</button></p></form>');
}

async function setupDone(res, q, now) {
  const s = readSetup(now);
  if (!s || readApp() || !sameState(q.get('state'), s.state)) { plain(res); return; }
  const code = String(q.get('code') || '');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(code)) { plain(res); return; }
  const a = await call('POST', API + '/app-manifests/' + encodeURIComponent(code) + '/conversions', {}, undefined);
  if (a.status !== 201 || !a.body || !a.body.pem || !a.body.id) {
    log('setup: GitHub would not make the App (' + said(a) + ')');
    page(res, 502, 'GitHub did not make the App', '<p>GitHub answered ' + esc(said(a)) + '. Nothing was kept. Ask for a new setup link.</p>');
    return;
  }
  const owner = a.body.owner && a.body.owner.login;
  if (owner !== HOLDER) {
    log('setup: refused an App made by ' + owner);
    page(res, 403, 'Not this App', '<p>That App belongs to ' + esc(owner) + ', not ' + HOLDER + ', so nothing was kept.</p>');
    return;
  }
  fs.writeFileSync(path.join(STATE, 'key.pem'), a.body.pem, { mode: 0o600 });
  fs.writeFileSync(path.join(STATE, 'app.json'), JSON.stringify({ id: a.body.id, slug: a.body.slug, owner, made: new Date(now * 1000).toISOString() }, null, 2));
  fs.unlinkSync(path.join(STATE, 'setup.json'));
  log('setup: App ' + a.body.slug + ' (' + a.body.id + ') made by ' + owner + '; its key is kept here and the setup is closed');
  const install = WEB + '/apps/' + encodeURIComponent(a.body.slug) + '/installations/new';
  page(res, 200, 'Made. Now install it',
    '<p>The App is made and its key is on the box. Last step: install it on Thornswood, Thornswood-Ops and skymp only.</p>' +
    '<p><a href="' + esc(install) + '" style="font-size:1.2em">Install it</a>, choose <b>Only select repositories</b>, pick <b>Thornswood</b>, <b>Thornswood-Ops</b> and <b>skymp</b>, then Install.</p>');
}

// ------------------------------------------------------------------ server --
function plain(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end(PLAIN);
}
function json(res, status, o) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(o));
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too long')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function converge(req, res, now) {
  const auth = String(req.headers.authorization || '');
  const m = /^Bearer (\S+)$/.exec(auth);
  let claims;
  try {
    if (!m) throw new Error('no token');
    const keys = await call('GET', JWKS, {});
    if (keys.status !== 200) throw new Error('GitHub\'s keys could not be read (' + said(keys) + ')');
    claims = verifyOidc(m[1], keys.body, now, RULES);
  } catch (e) {
    log('refused: ' + e.message);
    json(res, 403, { ok: false, lines: ['refused: the token is ' + e.message.replace(/^the token is /, '')] });
    return;
  }
  let ask;
  try { ask = JSON.parse((await readBody(req, 4096)) || '{}'); } catch (e) { ask = null; }
  if (!ask || !ASKS.includes(ask.what)) { json(res, 400, { ok: false, lines: ['the only things this does are ' + ASKS.slice(0, -1).join(', ') + ' and ' + ASKS[ASKS.length - 1]] }); return; }
  const run = claims.run_id + ' (' + claims.event_name + ' by ' + claims.actor + ')';
  const scheduled = claims.event_name === 'schedule';
  if (scheduled && CHANGING_ASKS.includes(ask.what) && ask.check !== true) {
    log('run ' + run + ': refused ' + ask.what + ' without check');
    json(res, 403, { ok: false, lines: ['refused: a scheduled run only checks, and ' + ask.what + ' was asked without check'] });
    return;
  }
  const held = readApp();
  if (!held) { log('run ' + run + ': no App yet'); json(res, 503, { ok: false, lines: ['there is no App here yet: Install-AdminService.ps1 -Setup makes it'] }); return; }
  if (ask.what === 'settings') {
    try {
      const inst = await installation(held, now);
      // This repository alone, read only (SETTINGS_PERMISSIONS, and whichever
      // of SETTINGS_EXTRA the installation holds).
      const perms = Object.assign({}, SETTINGS_PERMISSIONS);
      for (const p of SETTINGS_EXTRA) if (inst.permissions[p] === 'read' || inst.permissions[p] === 'write') perms[p] = 'read';
      const token = await installationToken(held, now, REPO, perms, inst);
      const r = await readSettings(token, inst.permissions);
      log('run ' + run + ': settings read, ' + r.unread.length + ' not read');
      for (const l of r.unread) log('  not read: ' + l);
      json(res, 200, { ok: true, readings: r.readings, unread: r.unread, lines: r.unread.map(l => 'not read: ' + l) });
    } catch (e) {
      log('run ' + run + ': settings: ' + e.message);
      json(res, 502, { ok: false, lines: [e.message] });
    }
    return;
  }
  try {
    if (ask.what === 'installation-repos') {
      const r = await installationRepos(await installationToken(held, now, null, { metadata: 'read' }));
      log('run ' + run + ': installation-repos, ' + r.repos.length + ' repositor' + (r.repos.length === 1 ? 'y' : 'ies'));
      for (const l of r.lines) log('  ' + l);
      json(res, 200, r);
      return;
    }
    // Reading the records here and changing the runners there are two
    // tokens, so neither can do the other's work. The About box is this
    // repository's own, so one token here reads its record and writes it.
    let r;
    if (ask.what === 'repo-settings') {
      r = await repoSettings(held, now, !!ask.check);
      // The nightly check tells the board (#5298: scanning went off on both
      // repositories and nothing read it for a day).
      if (scheduled) {
        try { r.lines.push('board: ' + await reportDrift(held, now, r)); }
        catch (e) { r.ok = false; r.lines.push('STOP the board was not told: ' + e.message); }
      }
    } else if (ask.what === 'repo-about') {
      r = await repoAbout(await installationToken(held, now, REPO, { administration: 'write', contents: 'read' }), !!ask.check);
    } else {
      const read = await installationToken(held, now, REPO, { contents: 'read' });
      const token = await installationToken(held, now, RUNNERS_REPO, { administration: 'write' });
      r = await runnerLabels(read, token, !!ask.check);
    }
    log('run ' + run + ': ' + ask.what + (ask.check ? ' check' : '') + ', ' + r.changed + ' changed, ' + (r.ok ? 'ok' : 'stopped'));
    for (const l of r.lines) log('  ' + l);
    json(res, r.ok ? 200 : 409, r);
  } catch (e) {
    log('run ' + run + ': ' + e.message);
    json(res, 502, { ok: false, lines: [e.message] });
  }
}

function serve() {
  const server = http.createServer((req, res) => {
    const now = Math.floor(Date.now() / 1000);
    const u = new URL(req.url, 'http://127.0.0.1');
    // Through Caddy: the setup pages and nothing else.
    const outside = !!(req.headers['x-forwarded-for'] || req.headers['x-forwarded-host'] || req.headers.forwarded);
    let work;
    if (req.method === 'GET' && u.pathname === '/setup') work = setupStart(res, u.searchParams, now);
    else if (req.method === 'GET' && u.pathname === '/setup/done') work = setupDone(res, u.searchParams, now);
    else if (!outside && req.method === 'POST' && u.pathname === '/converge') work = converge(req, res, now);
    else { plain(res); return; }
    work.catch(e => {
      log('failed: ' + e.message);
      if (!res.headersSent) json(res, 500, { ok: false, lines: [e.message] });
      else res.end();
    });
  });
  server.listen(PORT, '127.0.0.1', () => { log('listening on 127.0.0.1:' + server.address().port); keepBotToken(); });
  return server;
}

module.exports = { said, driftBody, CHANGING_ASKS, DRIFT_TITLE, MACHINE_ACTORS, verifyOidc, appJwt, call, botToken, BOT_PERMISSIONS, planCollaborators, planLabels, planLeftovers, checkRecords, checkAbout, planAbout, runnerNumber, checkRulesets, checkSettings, planRulesets, rulesetBody, says, manifest, RULES, ASKS, REPO, RUNNERS_REPO, SETTINGS_REPOS, SCANNING_KEYS, MERGE_KEYS, METHOD_KEYS, FREE_PRIVATE_REPOS, SETTINGS_PERMISSIONS, SETTINGS_EXTRA, serve };
if (require.main === module) serve();
