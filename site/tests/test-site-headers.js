'use strict';
// Runs the Cursor branch's response checks against the current stricter CSP.
const fs = require('fs'), path = require('path'), os = require('os');
const net = require('net'), http = require('http');
const {spawn} = require('child_process');
const siteFiles = require('../../tests/site-files');
const APP = path.join(__dirname, '..', '..', 'site'), PUBLIC = path.join(APP, 'public');
let pass = 0, fail = 0;
function yes(what, condition) {
 console.log((condition ? 'PASS  ' : 'FAIL  ') + what);
 if(condition) pass++; else fail++;
}
const src = siteFiles.source();
const policy = src.match(/const CSP_HEADER = ("[^"\r\n]*");/);
// Permissions-Policy (#2762): the value is checked against the Caddyfile's in
// test-2762-door-headers.js; here, that every answer carries it once.
const perms = src.match(/const PERMISSIONS_POLICY = '([^'\r\n]*)';/);
const G = {
 'X-Content-Type-Options': 'nosniff',
 'X-Frame-Options': 'SAMEORIGIN',
 'Referrer-Policy': 'strict-origin-when-cross-origin',
 'Permissions-Policy': perms ? perms[1] : 'PERMISSIONS_POLICY is not in server.js',
 'Content-Security-Policy': policy ? JSON.parse(policy[1]) : ''
};
yes('the current CSP still refuses inline script and styling', !!policy && !G['Content-Security-Policy'].includes('unsafe-inline'));
const sample = JSON.parse(fs.readFileSync(path.join(APP, 'config.example.json'), 'utf8'));
const quiet = ['clientId','clientSecret','botToken','guildId','invite'].every(k => !(sample.discord || {})[k]);
function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
async function until(cond, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) { return true; } await wait(20); }
  return cond();
}
function freePort() {
  return new Promise(function (ok, no) {
    const s = net.createServer();
    s.on('error', no);
    s.listen(0, '127.0.0.1', function () {
      const p = s.address().port;
      s.close(function () { ok(p); });
    });
  });
}
function ask(port, route, headers) {
  return new Promise(function (ok) {
    const req = http.request({
      host: '127.0.0.1', port: port, method: 'GET', path: route, agent: false,
      headers: headers || {}
    }, function (res) {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { buf += d; });
      res.on('end', function () {
        ok({ status: res.statusCode, headers: res.headers, raw: res.rawHeaders, body: buf });
      });
    });
    req.on('error', function (e) { ok({ status: 0, error: e.message, headers: {}, raw: [], body: '' }); });
    req.setTimeout(10000, function () { req.destroy(new Error('no answer in ten seconds')); });
    req.end();
  });
}
// Every guard header, with the value GUARD holds, written exactly once.
function guarded(what, r) {
  const missing = [];
  const twice = [];
  Object.keys(G).forEach(function (name) {
    const low = name.toLowerCase();
    // The CSP carries a nonce of its own on every answer (cspFor, #3216);
    // apart from it, it is the one CSP_HEADER says.
    let got = String(r.headers[low] || '');
    if (low === 'content-security-policy') got = got.replace(/ 'nonce-[A-Za-z0-9+/=]+'/, '');
    if (got !== String(G[name])) { missing.push(name); }
    let seen = 0;
    for (let i = 0; i < r.raw.length; i += 2) { if (String(r.raw[i]).toLowerCase() === low) { seen++; } }
    if (seen !== 1) { twice.push(name + ' x' + seen); }
  });
  yes(what + ' carries all five guard headers, once each' +
      (missing.length ? ', missing or wrong: ' + missing.join(', ') : '') +
      (twice.length ? ', not once: ' + twice.join(', ') : ''),
      missing.length === 0 && twice.length === 0);
}

const made = [];
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-headers-'));
  made.push(dir);
  siteFiles.copy(dir);
  fs.mkdirSync(path.join(dir, 'public'));
  ['home.html','home.js','home.css'].forEach(function (f) {
    fs.copyFileSync(path.join(PUBLIC, f), path.join(dir, 'public', f));
  });
  fs.writeFileSync(path.join(dir, 'public', 'fixture.txt'), 'public fixture bytes');
  fs.mkdirSync(path.join(dir, 'data', 'site'), {recursive:true});
  fs.copyFileSync(path.join(APP, 'data', 'site', 'rules.md'), path.join(dir, 'data', 'site', 'rules.md'));
  fs.copyFileSync(path.join(APP, 'config.example.json'), path.join(dir, 'config.json'));
  fs.mkdirSync(path.join(dir, 'feed', 'assets'), {recursive:true});
  fs.writeFileSync(path.join(dir, 'feed', 'assets', 'a'.repeat(64)), 'feed asset bytes');
  return dir;
}
async function start(dir) {
  const port = await freePort();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(port),
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_CHAT_DIR: path.join(dir, 'chat')
    })
  });
  const run = { child: child, port: port, out: '', exited: false };
  child.stdout.on('data', function (d) { run.out += d; });
  child.stderr.on('data', function (d) { run.out += d; });
  child.on('exit', function () { run.exited = true; });
  run.up = await until(function () { return run.out.indexOf('listening on ') >= 0 || run.exited; }, 10000) &&
           !run.exited;
  return run;
}
function stop(run) {
  return new Promise(function (ok) {
    if (!run || run.exited) { ok(); return; }
    run.child.once('exit', function () { ok(); });
    try { run.child.kill(); } catch (e) { ok(); }
    setTimeout(ok, 3000);
  });
}

(async function () {
  let run = null;
  try {
    if (!quiet) {
      console.log('SKIP  no copy was started: config.example.json is missing, or holds a Discord setting or a secret');
      yes('the sample is safe to start a copy on', false);
    } else {
      run = await start(copy());
      yes('a copy of server.js comes up on 127.0.0.1', run.up);
      if (!run.up) {
        console.log('      what the copy said:');
        run.out.split('\n').slice(-12).forEach(function (l) { if (l.trim()) { console.log('        ' + l.trim()); } });
      } else {
        const page = await ask(run.port, '/rules');
        yes('a public page answers 200 as HTML (' + page.status + ')',
            page.status === 200 && /text\/html/.test(String(page.headers['content-type'] || '')));
        guarded('a public page', page);
        // no-cache, so the back and forward cache can keep it (#3218): a
        // public page holds nothing about who asked.
        yes('and is no-cache, asked again each time but kept for Back',
            String(page.headers['cache-control'] || '') === 'no-cache');

        const api = await ask(run.port, '/api/public');
        yes('an API answer is 200 JSON (' + api.status + ')',
            api.status === 200 && /application\/json/.test(String(api.headers['content-type'] || '')));
        guarded('an API answer', api);

        const moved = await ask(run.port, '/download');
        yes('a redirect is 301 to /downloads (' + moved.status + ')',
            moved.status === 301 && String(moved.headers.location || '') === '/downloads');
        guarded('a redirect', moved);

        const gone = await ask(run.port, '/no-such-address', { accept: 'text/html' });
        yes('an address that is not there is 404 (' + gone.status + ')', gone.status === 404);
        guarded('a 404 page', gone);

        const asset = await ask(run.port, '/fixture.txt');
        yes('a static file is 200 and cached (' + asset.status + ')',
            asset.status === 200 && /max-age/.test(String(asset.headers['cache-control'] || '')));
        guarded('a static file', asset);

        const etag = String(asset.headers.etag || '');
        const again = await ask(run.port, '/fixture.txt', { 'if-none-match': etag });
        yes('the same file with its ETag is 304 (' + again.status + ')', !!etag && again.status === 304);
        guarded('a 304, which never goes through send()', again);

        const part = await ask(run.port, '/fixture.txt', { range: 'bytes=0-3' });
        yes('a byte range is 206 with four bytes (' + part.status + ')',
            part.status === 206 && part.body.length === 4);
        guarded('a byte range, which writes its own headers', part);

        const feedAsset = await ask(run.port, '/feed/assets/' + 'a'.repeat(64));
        yes('a full streamed feed asset answers 200', feedAsset.status === 200);
        guarded('a full streamed feed asset', feedAsset);
        const bad = await ask(run.port, '/%zz');
        yes('an address that cannot be read is 400, never 500 (' + bad.status + ')', bad.status === 400);
        guarded('the 400 for a bad address', bad);

        // Nothing here runs over the certificate, so the one header that is
        // only for that must not go out on plain HTTP.
        yes('no Strict-Transport-Security on a plain HTTP answer, as before',
            !page.headers['strict-transport-security']);
      }
    }
  } catch (e) {
    yes('the run finished without throwing: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    await stop(run);
    for (const d of made) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { }
    }
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
