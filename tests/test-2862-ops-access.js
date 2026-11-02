/*
  test-2862-ops-access.js

      node tests/test-2862-ops-access.js

  scripts/vps/admin/ops-access.js, the box admin App's token for one change
  to the ops repository's runners or keys through the deploy gate (#2862,
  Patrick's A on q-retire-box-keys, 31 Oct 2026). Against a stand-in GitHub
  on 127.0.0.1 and a key made here:
    1. it asks where the App is installed on the ops repository, with the
       App's own short token signed by the key in the state folder;
    2. runners asks for the ops repository alone with Administration write
       and nothing more; keys for the ops repository alone with Environments
       write and nothing more;
    3. it prints the token alone, and nothing of the key;
    4. any other ask, or none, ends it with 1 and asks GitHub nothing;
    5. a refusal from GitHub ends it with 1 and prints no token.
*/
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const Repo = path.join(__dirname, '..');
const script = path.join(Repo, 'scripts', 'vps', 'admin', 'ops-access.js');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-access-'));
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
    if (req.method === 'GET' && req.url === '/repos/ThornswoodRP/Thornswood-Ops/installation') { res.end(JSON.stringify({ id: 88 })); return; }
    if (req.method === 'POST' && req.url === '/app/installations/88/access_tokens') {
      if (refuse) { res.statusCode = 422; res.end(JSON.stringify({ message: 'The permissions requested are not granted to this installation.' })); return; }
      res.statusCode = 201; res.end(JSON.stringify({ token: 'ghs_' + 'b'.repeat(36) })); return;
    }
    res.statusCode = 404; res.end('{}');
  });
});

function run(args, api) {
  return new Promise(resolve => {
    execFile(process.execPath, [script].concat(args), { env: Object.assign({}, process.env, { THORNSWOOD_ADMIN_STATE: state, THORNSWOOD_ADMIN_GITHUB_API: api }) },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
}
function lastAsk() {
  const post = asked.filter(a => a.method === 'POST').pop();
  try { return JSON.parse(post.body); } catch (e) { return {}; }
}

server.listen(0, '127.0.0.1', async () => {
  const api = 'http://127.0.0.1:' + server.address().port;
  try {
    const r = await run(['runners'], api);
    yes('runners prints the token alone and ends 0', r.code === 0 && r.stdout === 'ghs_' + 'b'.repeat(36) + '\n');
    yes('  and nothing of the key, on either stream', !(r.stdout + r.stderr).includes('PRIVATE KEY') && !(r.stdout + r.stderr).includes(pem.split('\n')[1]));
    const where = asked.find(a => a.method === 'GET');
    const parts = where ? where.auth.replace(/^Bearer /, '').split('.') : [];
    let claims = {};
    try { claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8')); } catch (e) { claims = {}; }
    const signed = parts.length === 3 && crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    yes("it asks where the App is installed on the ops repository with the App's signed token", signed && claims.iss === '4242');
    let want = lastAsk();
    yes('runners asks for the ops repository alone with Administration write and nothing more',
      JSON.stringify(want.repositories) === '["Thornswood-Ops"]' && JSON.stringify(want.permissions) === '{"administration":"write"}');

    const k = await run(['keys'], api);
    want = lastAsk();
    yes('keys asks for the ops repository alone with Environments write and nothing more',
      k.code === 0 && JSON.stringify(want.repositories) === '["Thornswood-Ops"]' && JSON.stringify(want.permissions) === '{"environments":"write"}');

    const before = asked.length;
    const other = await run(['secrets'], api);
    const none = await run([], api);
    const proto = await run(['__proto__'], api);
    yes('any other ask, or none, ends 1 and asks GitHub nothing', other.code === 1 && none.code === 1 && proto.code === 1 && asked.length === before && other.stdout === '');

    refuse = true;
    const no = await run(['keys'], api);
    yes('a refusal ends it with 1, says which permission, and prints no token', no.code === 1 && no.stdout === '' && !no.stderr.includes('ghs_') && no.stderr.includes('Environments write'));
  } finally {
    server.close();
    fs.rmSync(state, { recursive: true, force: true });
  }
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) process.exit(1);
});
