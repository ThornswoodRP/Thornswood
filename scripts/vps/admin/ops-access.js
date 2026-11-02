/*
  ops-access.js

  An installation token of the "Thornswood box admin" App for one change to
  the private ops repository, ThornswoodRP/Thornswood-Ops, where the box's
  runners are registered and the box's keys are kept (#2862, Patrick's A on
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

  Each prints the token alone on its own line. It is for the ops repository
  alone, with that one permission and nothing more, and GitHub ends it within
  the hour. Nothing keeps it: the caller hands it to gh through GH_TOKEN for
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
// What each ask may do, and nothing else is ever asked for.
const ASKS = {
  runners: { permissions: { administration: 'write' }, needs: 'Administration write' },
  keys: { permissions: { environments: 'write' }, needs: 'Environments write' },
};

async function main(ask) {
  const want = Object.prototype.hasOwnProperty.call(ASKS, ask) ? ASKS[ask] : null;
  if (!want) throw new Error('say what the token is for: runners or keys. Nothing was asked of GitHub.');
  const keyPath = path.join(STATE, 'key.pem');
  const appPath = path.join(STATE, 'app.json');
  if (!fs.existsSync(keyPath) || !fs.existsSync(appPath)) throw new Error('the box admin App is not set up here: there is no ' + keyPath + ' and ' + appPath + ' (Install-AdminService.ps1 -Setup makes them)');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  const jwt = appJwt(app.id, fs.readFileSync(keyPath, 'utf8'), Math.floor(Date.now() / 1000));
  const inst = await call('GET', API + '/repos/' + OWNER + '/' + REPOS[0] + '/installation', jwt);
  if (inst.status !== 200) throw new Error('GitHub would not say where the App is installed on ' + OWNER + '/' + REPOS[0] + ' (' + said(inst) + ')');
  const tok = await call('POST', API + '/app/installations/' + inst.body.id + '/access_tokens', jwt, { repositories: REPOS, permissions: want.permissions });
  if (tok.status !== 201 || !tok.body || !tok.body.token) {
    throw new Error('GitHub gave the App no token for ' + REPOS[0] + ' with ' + want.needs + ' (' + said(tok) + '). ' +
      'The App has it on its page, github.com/settings/apps/' + (app.slug || '<the App>') + '/permissions, only once it is accepted on the installation for ' + REPOS[0] + '.');
  }
  process.stdout.write(tok.body.token + '\n');
}

if (require.main === module) {
  main(process.argv[2]).catch(e => { process.stderr.write('ops-access: ' + e.message + '\n'); process.exit(1); });
}
module.exports = { REPOS, ASKS };
