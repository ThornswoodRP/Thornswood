/*
  test-feed-watch.js

      node .\launcher\tests\test-feed-watch.js

  The long-poll tip at /feed/watch and /feed-dev/watch (#2440): a launcher
  holding an ETag waits until the feed changes (or the wait times out),
  then runs one ordinary feed check. Lifts the route out of site\server.js
  the same way test-feed-serve.js does for version.json.

  Since #2727 the feed on disk is a folder of write-once generations,
  <channel>\version\<8 digits>.json, and the newest is the feed, so the
  generations block (feedFile) is lifted too and a Ship here is a new
  generation.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const SRC = path.join(__dirname, '..', '..', 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function block(at) {
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return i + 1; }
  }
  throw new Error('unbalanced braces in site/server.js');
}
function grab(head) {
  const at = src.indexOf(head);
  if (at < 0) return '';
  return src.slice(at, block(at));
}
function route(first, guard) {
  const at = src.indexOf(first);
  if (at < 0) return '';
  const g = src.indexOf(guard, at);
  if (g < 0) return '';
  return src.slice(at, block(g));
}
// The generations block, from const feedNewest through the end of feedFile.
function generations() {
  const at = src.indexOf('const feedNewest = {};');
  if (at < 0) return '';
  const fn = src.indexOf('function feedFile(', at);
  if (fn < 0) return '';
  return src.slice(at, block(fn));
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-feed-watch-'));
fs.mkdirSync(path.join(ROOT, 'feed', 'assets'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'feed', 'version'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'feed-dev', 'assets'), { recursive: true });
fs.mkdirSync(path.join(ROOT, 'feed-dev', 'version'), { recursive: true });

const genSrc = generations();
yes('server.js has the feed generations block (feedFile)', !!genSrc);
// feedView and feedSettings are in the same block: what the feed routes answer (#1050).
const gen = eval('(function () {\n' + genSrc + '\nreturn { feedFile: feedFile, feedView: feedView, feedSettings: feedSettings };\n})()');
const feedFile = gen.feedFile, feedView = gen.feedView, feedSettings = gen.feedSettings;

const sendSrc = grab('function send(');
yes('server.js still has send()', !!sendSrc);
eval(sendSrc);

const watchSrc = route('const feedWatch = p.match(', "if (feedWatch && req.method === 'GET')");
yes('the /feed/watch route is where this expects it', !!watchSrc);
yes('watch waits up to fifty seconds', /WAIT_MS\s*=\s*50000/.test(watchSrc));
yes('watch answers 204 when the ETag is unchanged through the wait', /204/.test(watchSrc));
yes('watch answers 200 when the ETag differs', /have !== tag/.test(watchSrc) || /!have \|\| have !== tag/.test(watchSrc));

const watchRoute = eval('(function (p, req, res, head) {\n' + watchSrc + '\n})');

fs.writeFileSync(path.join(ROOT, 'feed', 'version', '00000001.json'),
  JSON.stringify({ launcherVersion: '1.2.4' }));
fs.writeFileSync(path.join(ROOT, 'feed-dev', 'version', '00000001.json'),
  JSON.stringify({ launcherVersion: '1.2.4.1' }));

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  try {
    watchRoute(p, req, res, false);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
    return;
  }
  // A matching watch that is still waiting has not sent headers yet; leave it.
  if (!res.headersSent && !/^\/(feed(?:-dev)?)\/watch$/.test(p)) {
    res.writeHead(404); res.end('no');
  }
});

function ask(method, p, headers) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: p,
                               method: method, headers: headers || {}, agent: false }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ code: res.statusCode, h: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', (e) => resolve({ code: 0, h: {}, body: Buffer.alloc(0), error: e.message }));
    req.setTimeout(70000);
    req.end();
  });
}

function etagOf(file) {
  const st = fs.statSync(file);
  return '"' + st.size.toString(16) + '-' + Math.floor(st.mtimeMs).toString(16) + '"';
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const tag = etagOf(path.join(ROOT, 'feed', 'version', '00000001.json'));

  const fresh = await ask('GET', '/feed/watch');
  yes('GET /feed/watch with no If-None-Match is 200 at once', fresh.code === 200);
  yes('and carries an ETag', !!fresh.h['etag']);
  yes('and Cache-Control is no-store', fresh.h['cache-control'] === 'no-store');
  yes('and a JSON body naming the etag', /"etag"/.test(fresh.body.toString('utf8')));

  const changedPromise = ask('GET', '/feed/watch', { 'If-None-Match': tag });
  await new Promise((r) => setTimeout(r, 800));
  // A Ship is the next generation; the one before it stays.
  const file = path.join(ROOT, 'feed', 'version', '00000002.json');
  fs.writeFileSync(file, JSON.stringify({ launcherVersion: '1.2.5', note: 'shipped-for-watch-test' }));
  const changed = await changedPromise;
  yes('a watch holding the old ETag returns 200 when the feed is written', changed.code === 200);
  yes('and the new ETag is the new generation', changed.h['etag'] === etagOf(file));
  yes('with a new ETag', !!changed.h['etag'] && changed.h['etag'] !== tag);

  // Shorten wait for the timeout case by patching WAIT_MS is hard once eval'd.
  // Instead: ask with current tag and abort after proving it has not answered
  // yet within 1.5 s (still holding), then destroy the request.
  const holding = await new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port,
                               path: '/feed/watch', method: 'GET',
                               headers: { 'If-None-Match': etagOf(file) }, agent: false }, (res) => {
      resolve({ early: true, code: res.statusCode });
      res.resume();
    });
    req.on('error', () => resolve({ early: false, aborted: true }));
    setTimeout(() => { req.destroy(); resolve({ early: false, held: true }); }, 1500);
    req.end();
  });
  yes('a watch holding the current ETag does not answer inside 1.5 s', holding.held === true && !holding.early);

  const missing = await ask('GET', '/feed/watch-nope');
  yes('a wrong watch path is 404 from this harness', missing.code === 404);

  const dv = await ask('GET', '/feed-dev/watch');
  yes('GET /feed-dev/watch with no tag is 200', dv.code === 200);

  // Launcher side must exist and name the tip.
  const updater = fs.readFileSync(path.join(__dirname, '..', '..', 'launcher', 'app', 'Updater.cs'), 'utf8');
  yes('Updater has WatchUrl', /WatchUrl\(Config/.test(updater));
  yes('Updater has WaitForFeedChange', /WaitForFeedChange\(Config/.test(updater));
  const shellUp = fs.readFileSync(path.join(__dirname, '..', '..', 'launcher', 'app', 'ShellUpdate.cs'), 'utf8');
  yes('ShellUpdate starts the tip', /StartFeedWatch\(/.test(shellUp));
  yes('ShellUpdate stops the tip', /StopFeedWatch\(/.test(shellUp));

  server.close();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
