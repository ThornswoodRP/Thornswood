/*
  test-2841-ship-access.js

      node tests/test-2841-ship-access.js

  scripts/vps/admin/ship-access.js, the token a Ship through the deploy gate
  signs with (#2841, Patrick's pick on 30 Oct 2026: the box admin App mints
  it). Against a stand-in GitHub on 127.0.0.1 and a key made here:
    1. it asks where the App is installed with the App's own short token,
       signed by the key in the state folder;
    2. it asks for a token for the engine fork and Thornswood only, with
       Actions write and Contents read and nothing more;
    3. it prints the token alone, and nothing of the key;
    4. a refusal from GitHub (the App not yet given Actions write) ends it
       with 1, says where to add the permission, and prints no token;
    5. with no key in the state folder it says so and asks GitHub nothing.
*/
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const Repo = path.join(__dirname, '..');
const script = path.join(Repo, 'scripts', 'vps', 'admin', 'ship-access.js');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-access-'));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-access-empty-'));
fs.writeFileSync(path.join(state, 'key.pem'), pem);
fs.writeFileSync(path.join(state, 'app.json'), JSON.stringify({ id: 4242, slug: 'thornswood-box-admin' }));

let refuse = false;
const asked = [];
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    asked.push({ method: req.method, url: req.url, auth: req.headers.authorization || '', body });
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && req.url === '/repos/ThornswoodRP/skymp/installation') { res.end(JSON.stringify({ id: 77 })); return; }
    if (req.method === 'POST' && req.url === '/app/installations/77/access_tokens') {
      if (refuse) { res.statusCode = 422; res.end(JSON.stringify({ message: 'The permissions requested are not granted to this installation.' })); return; }
      res.statusCode = 201; res.end(JSON.stringify({ token: 'ghs_' + 'a'.repeat(36) })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
});

function run(stateDir, api) {
  return new Promise(resolve => {
    execFile(process.execPath, [script], { env: Object.assign({}, process.env, { THORNSWOOD_ADMIN_STATE: stateDir, THORNSWOOD_ADMIN_GITHUB_API: api }) },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}

server.listen(0, '127.0.0.1', async () => {
  const api = 'http://127.0.0.1:' + server.address().port;
  try {
    const ok = await run(state, api);
    yes('it prints the token alone and ends 0', ok.code === 0 && ok.stdout === 'ghs_' + 'a'.repeat(36) + '\n');
    yes('  and nothing of the key, on either stream', !(ok.stdout + ok.stderr).includes('PRIVATE KEY') && !(ok.stdout + ok.stderr).includes(pem.split('\n')[1]));
    const where = asked.find(a => a.method === 'GET');
    const jwt = where ? where.auth.replace(/^Bearer /, '') : '';
    const parts = jwt.split('.');
    let claims = {};
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')); } catch (e) { claims = {}; }
    const signed = parts.length === 3 && crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    yes("it asks where the App is installed with the App's token, signed by the state folder's key", signed && claims.iss === '4242' && claims.exp - claims.iat <= 600);
    const post = asked.find(a => a.method === 'POST');
    let want = {};
    try { want = JSON.parse(post.body); } catch (e) { want = {}; }
    yes('it asks for the fork and Thornswood only', JSON.stringify(want.repositories) === '["skymp","Thornswood"]');
    yes('  with Actions write and Contents read and nothing more', JSON.stringify(want.permissions) === '{"actions":"write","contents":"read"}');

    refuse = true;
    const no = await run(state, api);
    yes('a refusal ends it with 1 and prints no token', no.code === 1 && no.stdout === '' && !no.stderr.includes('ghs_'));
    yes('  and says where Actions write is added', no.stderr.includes('github.com/settings/apps/thornswood-box-admin/permissions') && no.stderr.includes('not granted'));

    const before = asked.length;
    const none = await run(empty, api);
    yes('with no key it says so and asks GitHub nothing', none.code === 1 && none.stderr.includes('not set up here') && asked.length === before);
  } finally {
    server.close();
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(empty, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
});
