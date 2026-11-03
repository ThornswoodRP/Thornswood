/*
  ops-access.js

  An installation token of the "Thornswood box admin" App for one change to
  the private ops repository, ThornswoodRP/Thornswood-Ops, where the box's
  runners are registered and the box's keys are kept, or to the organization
  runner of ThornswoodRP/Thornswood-Hermes's guard rail tests on the box (#2862, Patrick's A on
  q-retire-box-keys, 31 Oct 2026: runners and keys are renewed from the
  cloud, through the deploy gate, never made new). Run as SYSTEM under the
  gate's broker, the one account besides the admin service's own task and
  Administrators that may read the App's key, by:

      node scripts/vps/admin/ops-access.js runners   for scripts\deploy\Install-Runner.ps1 -FromGate:
                                                     Administration write on the ops repository,
                                                     which a runner's registration and removal
                                                     tokens and its list need
      node scripts/vps/admin/ops-access.js keys      for scripts\vps\Renew-BoxKey.ps1:
                                                     Environments write on the ops repository,
                                                     which an environment's secret needs
      node scripts/vps/admin/ops-access.js hermes-runners
                                                     for Install-Runner.ps1 -FromGate -Hermes:
                                                     the organization's Self-hosted runners write,
                                                     for the one organization runner of
                                                     Thornswood-Hermes's guard rail tests on the box
                                                     (records\hermes-runner.json); the App is never
                                                     on Thornswood-Hermes itself

  Each prints the token alone on its own line. It carries that one permission
  and nothing more, the first two for the ops repository alone, and GitHub
  ends it within the hour. Nothing keeps it: the caller hands it to gh through GH_TOKEN for
  that run and takes it away after. The App holds both permissions
  (administration write since #3107 for the runner labels, environments write
  for this; records/github-apps.json lists them), so nothing has to be added
  on its page.

  The key is read and never shown, logged or sent; only the App's own short
  token (appJwt in admin.js) goes to GitHub.

      THORNSWOOD_ADMIN_STATE         the App's state folder; C:\Thornswood-Admin\state when unset
      THORNSWOOD_ADMIN_GITHUB_API    https://api.github.com when unset (the harness points it at a stand-in)
*/
'use strict';
const fs = require('fs');
const path = require('path');
const { appJwt } = require('./admin.js');
const { call, said } = require('./ship-access.js');

const STATE = process.env.THORNSWOOD_ADMIN_STATE || 'C:\\Thornswood-Admin\\state';
const API = (process.env.THORNSWOOD_ADMIN_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const OWNER = 'ThornswoodRP'; // the repositories' owner since the move (#5184)
const REPOS = ['Thornswood-Ops'];
// What each ask may do, and nothing else is ever asked for. A repository ask
// names its one repository; an organization ask names none, and holds an
// organization permission alone. Thornswood-Hermes's guard rail tests run on
// an organization runner of the box since its free minutes ran out on 2 Nov
// 2026 with the limit at $0 (Patrick's A on q-hermes-ci-free-runners); the
// App is never on that repository (records/github-apps.json).
const ASKS = {
  runners: { repo: 'Thornswood-Ops', permissions: { administration: 'write' }, needs: 'Administration write' },
  keys: { repo: 'Thornswood-Ops', permissions: { environments: 'write' }, needs: 'Environments write' },
  'hermes-runners': { org: true, permissions: { organization_self_hosted_runners: 'write' }, needs: 'Self-hosted runners write on the organization' },
};

async function main(ask) {
  const want = Object.prototype.hasOwnProperty.call(ASKS, ask) ? ASKS[ask] : null;
  if (!want) throw new Error('say what the token is for: runners, keys or hermes-runners. Nothing was asked of GitHub.');
  const keyPath = path.join(STATE, 'key.pem');
  const appPath = path.join(STATE, 'app.json');
  if (!fs.existsSync(keyPath) || !fs.existsSync(appPath)) throw new Error('the box admin App is not set up here: there is no ' + keyPath + ' and ' + appPath + ' (Install-AdminService.ps1 -Setup makes them)');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  const jwt = appJwt(app.id, fs.readFileSync(keyPath, 'utf8'), Math.floor(Date.now() / 1000));
  const where = want.org ? OWNER : OWNER + '/' + want.repo;
  const inst = await call('GET', API + (want.org ? '/orgs/' + OWNER : '/repos/' + where) + '/installation', jwt);
  if (inst.status !== 200) throw new Error('GitHub would not say where the App is installed on ' + where + ' (' + said(inst) + ')');
  const body = want.org ? { permissions: want.permissions } : { repositories: [want.repo], permissions: want.permissions };
  const tok = await call('POST', API + '/app/installations/' + inst.body.id + '/access_tokens', jwt, body);
  if (tok.status !== 201 || !tok.body || !tok.body.token) {
    throw new Error('GitHub gave the App no token for ' + where + ' with ' + want.needs + ' (' + said(tok) + '). ' +
      'The App has it on its page, github.com/settings/apps/' + (app.slug || '<the App>') + '/permissions, only once it is accepted on the installation for ' + where + '.');
  }
  process.stdout.write(tok.body.token + '\n');
}

if (require.main === module) {
  main(process.argv[2]).catch(e => { process.stderr.write('ops-access: ' + e.message + '\n'); process.exit(1); });
}
module.exports = { REPOS, ASKS };
