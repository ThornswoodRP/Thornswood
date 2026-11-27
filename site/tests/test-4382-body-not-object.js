'use strict';
/*
  test-4382-body-not-object.js

      node .\site\tests\test-4382-body-not-object.js
      node .\site\tests\test-4382-body-not-object.js <an older server.js>

  Issue #4382. JSON.parse takes the body null, and /api/report then read
  o.title and /api/ticket o.key from it: both answered 500 "server error" and
  the site log had a TypeError, with no sign in or key asked for first. Every
  route that reads a JSON body read it as JSON.parse(await body(...)), so any
  of them could be handed something that is JSON but not an object.

    A  bodyObject (lib/http.js) gives back an object, refuses null, a number,
       a string, true and a list with the SyntaxError a body that is not JSON
       gets, and lets a body that is too big through as the BodyFailed it is;
    B  no route in lib/serve.js reads a body with JSON.parse any more: each
       reads it with bodyObject, so each answers such a body the way it
       answers one that is not JSON;
    C  against a copy of the site in a scratch folder on a spare port,
       /api/report and /api/ticket answer each of those bodies 400, never
       500, and the site logs no TypeError;
    D  and an object still reaches them: /api/ticket with the wrong key is
       refused 401, and with the bot's key and a title it is taken.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const EventEmitter = require('events');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.resolve(process.argv[2] || path.join(ROOT, 'site', 'server.js'));
const LIB = path.join(path.dirname(SITE), 'lib');
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300).split('\n').join('\n      ') : '')); }
}

const NOT_OBJECTS = ['null', '5', '"x"', 'true', '[]', '[{"title":"a"}]'];

function fakeReq(text) {
  const r = new EventEmitter();
  r.complete = true;
  setImmediate(() => { r.emit('data', Buffer.from(text)); r.emit('end'); });
  return r;
}

function post(port, where, text) {
  return new Promise((ok) => {
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: where, agent: false,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text),
                 origin: 'http://127.0.0.1:' + port, host: '127.0.0.1:' + port } }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => ok({ status: res.statusCode, text: buf }));
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', (e) => ok({ status: 0, text: String(e) }));
    r.end(text);
  });
}

(async function main() {
  // ---------------------------------------------------------------- A --
  console.log('A. bodyObject:');
  const h = require(path.join(LIB, 'http.js'));
  yes('lib/http.js gives bodyObject', typeof h.bodyObject === 'function');
  if (typeof h.bodyObject === 'function') {
    const got = await h.bodyObject(fakeReq('{"title":"a"}'), 100);
    yes('an object comes back as it was sent', got && got.title === 'a');
    for (const t of NOT_OBJECTS) {
      let e = null;
      try { await h.bodyObject(fakeReq(t), 100); } catch (x) { e = x; }
      yes('the body ' + t + ' is refused as a body that is not JSON is (a SyntaxError)', e instanceof SyntaxError, e);
    }
    let big = null;
    try { await h.bodyObject(fakeReq('{"title":"' + 'a'.repeat(200) + '"}'), 50); } catch (x) { big = x; }
    yes('a body over the cap goes through as the BodyFailed it is, 413', !!big && big instanceof h.BodyFailed && big.status === 413, big);
  }

  // ---------------------------------------------------------------- B --
  console.log('\nB. every route reads its body with bodyObject:');
  const serve = fs.readFileSync(path.join(LIB, 'serve.js'), 'utf8');
  const parsed = serve.match(/JSON\.parse\(\s*await\s+body\(/g) || [];
  yes('no route reads a body with JSON.parse (' + parsed.length + ' do)', parsed.length === 0);
  const readers = serve.match(/await bodyObject\(/g) || [];
  yes('and bodyObject reads them (' + readers.length + ' routes)', readers.length >= 20);

  // --------------------------------------------------------------- C, D --
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4382-'));
  let srv = null, said = '';
  const botKey = crypto.randomBytes(24).toString('hex');
  try {
    siteFiles.copy(dir, SITE);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey, admins: ['222222222'],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    let port = 0;
    srv = spawn(process.execPath, [path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { said += d; });
    srv.stderr.on('data', (d) => { said += d; });
    await siteFiles.listening(srv).then((r) => (port = r.port, r));

    console.log('\nC. a body that is JSON but not an object:');
    for (const where of ['/api/report', '/api/ticket']) {
      for (const t of NOT_OBJECTS) {
        const r = await post(port, where, t);
        yes(where + ' with the body ' + t + ' answers 400 (' + r.status + ')', r.status === 400, r.status + ': ' + r.text);
      }
    }
    yes('and the site logs no TypeError', !/TypeError/.test(said), said.split('\n').filter((l) => /TypeError/.test(l)).slice(0, 3).join('\n'));

    console.log('\nD. an object still reaches them:');
    const wrong = await post(port, '/api/ticket', JSON.stringify({ key: 'not the key', title: 'a' }));
    yes('/api/ticket with the wrong key is refused 401 (' + wrong.status + ')', wrong.status === 401, wrong.text);
    const right = await post(port, '/api/ticket', JSON.stringify({ key: botKey, title: 'The door sticks', kind: 'help', by: 'Ada' }));
    yes('/api/ticket with the bot\'s key and a title is taken (' + right.status + ')', right.status === 200, right.text);
    const empty = await post(port, '/api/report', JSON.stringify({ title: '' }));
    yes('/api/report with an object and no title says what to put in (' + empty.status + ')',
        empty.status === 400 && /first box/.test(empty.text), empty.text);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
