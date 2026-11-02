/*
  ship-access.js

  An installation token of the "Thornswood box admin" App for one Ship
  through the deploy gate (#2841, Patrick's pick on 30 Oct 2026: the box
  admin App mints a token, so a dev Ship runs on the box end to end). Run by
  scripts\release\Ship-OnBox.ps1, as SYSTEM under the gate's broker, which is
  the one account besides the admin service's own task and Administrators
  that may read the App's key.

      node scripts/vps/admin/ship-access.js            the token, on its own line

  WHAT IT CAN DO. Only what a Ship from the feed asks GitHub for: Actions
  write on the engine fork (start thornswood-sign-manifest.yml, read its run,
  download the signed catalog) and on Thornswood (release-tag.yml and
  release.yml, for a Ship that carries a new launcher), and Contents read on
  Thornswood (the launcher release.yml signed). GitHub ends it after an hour,
  and nothing keeps it: Ship-OnBox.ps1 hands it to gh through GH_TOKEN for
  that run alone. The installation only gives it these once Patrick has added
  Actions write on the App's page and accepted it on the installation; until
  then GitHub refuses, and that refusal is what this prints.

  The key is read and never shown, logged or sent; only the App's own short
  token (appJwt in admin.js) goes to GitHub.

      THORNSWOOD_ADMIN_STATE         the App's state folder; C:\Thornswood-Admin\state when unset
      THORNSWOOD_ADMIN_GITHUB_API    https://api.github.com when unset (the harness points it at a stand-in)
*/
'use strict';
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { appJwt } = require('./admin.js');

const STATE = process.env.THORNSWOOD_ADMIN_STATE || 'C:\\Thornswood-Admin\\state';
const API = (process.env.THORNSWOOD_ADMIN_GITHUB_API || 'https://api.github.com').replace(/\/$/, '');
const OWNER = 'ThornswoodRP'; // the repositories' owner since the move (#5184)
const REPOS = ['skymp', 'Thornswood'];
const PERMISSIONS = { actions: 'write', contents: 'read' };

function call(method, url, token, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const h = { 'User-Agent': 'thornswood-gate', Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', Authorization: 'Bearer ' + token };
    if (data) { h['Content-Type'] = 'application/json'; h['Content-Length'] = data.length; }
    const req = (u.protocol === 'http:' ? http : https).request(u, { method, headers: h, timeout: 30000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (e) { parsed = null; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error(method + ' ' + u.pathname + ' had no answer in 30 seconds')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}
function said(a) { return 'HTTP ' + a.status + (a.body && a.body.message ? ': ' + a.body.message : ''); }

async function main() {
  const keyPath = path.join(STATE, 'key.pem');
  const appPath = path.join(STATE, 'app.json');
  if (!fs.existsSync(keyPath) || !fs.existsSync(appPath)) throw new Error('the box admin App is not set up here: there is no ' + keyPath + ' and ' + appPath + ' (Install-AdminService.ps1 -Setup makes them)');
  const app = JSON.parse(fs.readFileSync(appPath, 'utf8'));
  const now = Math.floor(Date.now() / 1000);
  const jwt = appJwt(app.id, fs.readFileSync(keyPath, 'utf8'), now);
  const inst = await call('GET', API + '/repos/' + OWNER + '/' + REPOS[0] + '/installation', jwt);
  if (inst.status !== 200) throw new Error('GitHub would not say where the App is installed on ' + OWNER + '/' + REPOS[0] + ' (' + said(inst) + ')');
  const tok = await call('POST', API + '/app/installations/' + inst.body.id + '/access_tokens', jwt, { repositories: REPOS, permissions: PERMISSIONS });
  if (tok.status !== 201 || !tok.body || !tok.body.token) {
    throw new Error('GitHub gave the App no token for ' + REPOS.join(' and ') + ' with Actions write and Contents read (' + said(tok) + '). ' +
      'The App takes Actions write only once it is added on its page, github.com/settings/apps/' + (app.slug || '<the App>') + '/permissions, and accepted on its installation.');
  }
  process.stdout.write(tok.body.token + '\n');
}

if (require.main === module) {
  main().catch(e => { process.stderr.write('ship-access: ' + e.message + '\n'); process.exit(1); });
}
// call and said serve ops-access.js too, the same App's token for the ops
// repository's runners and keys (#2862).
module.exports = { REPOS, PERMISSIONS, call, said };
