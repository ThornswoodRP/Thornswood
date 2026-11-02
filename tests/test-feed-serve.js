/*
  test-feed-serve.js

      node .\tests\test-feed-serve.js

  The ship feed (#649) is served from /feed/ and /feed-dev/ on the site:
  version.json anonymously, and assets named only by lowercase sha256 with
  the same Range resume as /file/. It lifts those routes and rangeReply out
  of site\server.js by text and serves them from a real node http server on
  a loopback port against files in a temp folder.

  Since #445 version.json also carries an ETag and answers 304 to a launcher
  that already holds that copy, because every launcher asks for it every
  thirty seconds in a session.

  Since #2727 the feed on disk is a folder of write-once generations,
  <channel>\version\<8 digits>.json, and the newest is the one served, so
  this lifts the generations block (feedFile) too and writes a new
  generation where it changes the feed.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const siteFiles = require('./site-files');

const CR = String.fromCharCode(13);
const SRC = path.join(__dirname, '..', 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');
const CSP_HEADER = JSON.parse(src.match(/const CSP_HEADER = ("[^"\r\n]*");/)[1]);
// send() names it beside the CSP (#2762).
const PERMISSIONS_POLICY = src.match(/const PERMISSIONS_POLICY = '([^'\r\n]*)';/)[1];

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

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-feed-'));
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
// send() and rangeReply() put each answer's nonce into the CSP (#3216).
eval(grab('function cspFor('));

const rangeSrc = grab('function rangeReply(');
yes('server.js has rangeReply()', !!rangeSrc);
if (rangeSrc) eval(rangeSrc);

// The release copies block (#3686): the asset route asks it for a GitHub
// Release copy first. GitHub is never asked here; it answers 404, as it does
// while the repository is private, unless a case puts a Release in place.
eval(grab('function readJsonQuiet('));
const relFrom = src.indexOf('/* ---- release copies (#3686) ----');
const relTo = src.indexOf('/* ---- end release copies ---- */');
yes('server.js has the release copies block', relFrom >= 0 && relTo > relFrom);
const rel = eval('(function () {\nconst https = null;\n' + src.slice(relFrom, relTo) +
  '\nreleaseGitHub = () => Promise.resolve({ status: 404, why: \'GitHub answered 404\' });' +
  '\nreturn { releaseCopies: releaseCopies, releaseCopy: releaseCopy };\n})()');
const releaseCopy = rel.releaseCopy;

const verSrc = route('const feedVer = p.match(', "if (feedVer && req.method === 'GET')");
const assetSrc = route('const feedAsset = p.match(', "if (feedAsset && req.method === 'GET')");
yes('the /feed/version.json route is where this expects it', !!verSrc);
yes('the /feed/assets/ route is where this expects it', !!assetSrc);
yes('assets answer ranges through rangeReply', /rangeReply\(/.test(assetSrc));
yes('rangeReply keeps a caller cache-control on 206',
   /headers\['cache-control'\] \|\| 'no-store'/.test(rangeSrc));

const verRoute = eval('(function (p, req, res, head) {\n' + verSrc + '\n})');
const assetRoute = eval('(function (p, req, res, head) {\n' + assetSrc + '\n})');

const SHA = 'a'.repeat(64);
const BODY = Buffer.from('pack-bytes-for-feed-test-0123456789');
fs.writeFileSync(path.join(ROOT, 'feed', 'version', '00000001.json'),
  JSON.stringify({ launcherUrl: 'https://thornswood.net/feed/assets/' + SHA }));
fs.writeFileSync(path.join(ROOT, 'feed', 'assets', SHA), BODY);
fs.writeFileSync(path.join(ROOT, 'feed-dev', 'version', '00000001.json'),
  JSON.stringify({ launcherUrl: 'https://thornswood.net/feed-dev/assets/' + SHA }));
fs.writeFileSync(path.join(ROOT, 'feed-dev', 'assets', SHA), BODY);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const head = req.method === 'HEAD';
  if (head) req.method = 'GET';
  try {
    verRoute(p, req, res, head);
    if (!res.headersSent) assetRoute(p, req, res, head);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
    return;
  }
  if (!res.headersSent) { res.writeHead(404); res.end('no'); }
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
    req.end();
  });
}

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  const v = await ask('GET', '/feed/version.json');
  yes('GET /feed/version.json is 200', v.code === 200);
  yes('version.json is application/json', /^application\/json/.test(v.h['content-type'] || ''));
  yes('version.json Cache-Control is no-cache', v.h['cache-control'] === 'no-cache');
  yes('version.json holds the rewritten launcherUrl',
      /thornswood\.net\/feed\/assets\//.test(v.body.toString('utf8')));

  // #445: the launcher asks every thirty seconds in a session, so an unchanged
  // feed must cost a 304 and no body rather than ninety kilobytes.
  yes('version.json carries an ETag', !!v.h['etag']);
  const again = await ask('GET', '/feed/version.json', { 'If-None-Match': v.h['etag'] });
  yes('the same ETag back is answered 304', again.code === 304);
  yes('and the 304 carries no body', again.body.length === 0);
  yes('the 304 still says no-cache, so the next check still asks',
      again.h['cache-control'] === 'no-cache');
  const other = await ask('GET', '/feed/version.json', { 'If-None-Match': '"not-the-one"' });
  yes('a stale ETag gets the whole document', other.code === 200 && other.body.equals(v.body));

  // The one risk in answering 304: a shipped release hidden behind a tag that
  // did not move. The tag is size and modified time, so a new generation of the
  // feed changes it and the launcher holding the old one is given the new document.
  const shipped = JSON.stringify({
    launcherUrl: 'https://thornswood.net/feed/assets/' + SHA,
    launcherVersion: '1.1.102'
  });
  fs.writeFileSync(path.join(ROOT, 'feed', 'version', '00000002.json'), shipped);
  const after = await ask('GET', '/feed/version.json', { 'If-None-Match': v.h['etag'] });
  yes('a feed written since is 200 and not 304', after.code === 200);
  yes('with the new document', after.body.toString('utf8') === shipped);
  yes('and a new ETag', !!after.h['etag'] && after.h['etag'] !== v.h['etag']);

  const missing = await ask('GET', '/feed/assets/' + 'b'.repeat(64));
  yes('a missing asset is 404', missing.code === 404);

  const bad = await ask('GET', '/feed/assets/not-a-sha');
  yes('a non-sha256 asset name is 404 (route miss)', bad.code === 404);

  const a = await ask('GET', '/feed/assets/' + SHA);
  yes('GET /feed/assets/<sha256> is 200', a.code === 200);
  yes('asset is the whole file', a.body.equals(BODY));
  yes('asset Accept-Ranges: bytes', a.h['accept-ranges'] === 'bytes');
  yes('asset Cache-Control is long immutable',
      a.h['cache-control'] === 'public, max-age=31536000, immutable');

  const part = await ask('GET', '/feed/assets/' + SHA, { Range: 'bytes=0-3' });
  yes('asset Range is 206', part.code === 206);
  yes('asset Range body is the first four bytes', part.body.equals(BODY.subarray(0, 4)));
  yes('asset 206 keeps immutable Cache-Control',
      part.h['cache-control'] === 'public, max-age=31536000, immutable');

  const dv = await ask('GET', '/feed-dev/version.json');
  yes('GET /feed-dev/version.json is 200', dv.code === 200);
  yes('feed-dev version.json Cache-Control is no-cache', dv.h['cache-control'] === 'no-cache');

  const da = await ask('GET', '/feed-dev/assets/' + SHA);
  yes('GET /feed-dev/assets/<sha256> is 200', da.code === 200);

  // Once the feed's release has a public GitHub Release holding the asset at
  // this size, the route answers 302 to it, and sends no bytes (#3686).
  const TAG = 'release/main/20261026-170000';
  const COPY = 'https://github.com/ThornswoodRP/Thornswood/releases/download/' + TAG + '/' + SHA;
  fs.writeFileSync(path.join(ROOT, 'feed', 'version', '00000003.json'),
    JSON.stringify({ launcherUrl: 'https://thornswood.net/feed/assets/' + SHA, release: { id: '20261026-170000', tag: TAG } }));
  const before = await ask('GET', '/feed/assets/' + SHA);
  yes('a release with no Release copy yet: the site still sends the bytes', before.code === 200 && before.body.equals(BODY));
  rel.releaseCopies[TAG] = { files: { [SHA]: { url: COPY, size: BODY.length } }, installer: null, seen: Date.now() };
  const moved = await ask('GET', '/feed/assets/' + SHA);
  yes('with one, GET /feed/assets/<sha256> is 302 to the Release copy', moved.code === 302 && moved.h['location'] === COPY && moved.body.length === 0);
  yes('  and the redirect is not cached as if it were the bytes', moved.h['cache-control'] === 'no-cache');
  rel.releaseCopies[TAG].files[SHA].size = BODY.length + 1;
  const sized = await ask('GET', '/feed/assets/' + SHA);
  yes('a Release copy of another size is never used', sized.code === 200 && sized.body.equals(BODY));

  // Who the ETag above is for, so it is not taken out again as unused: the
  // launcher asks with the tag of the copy it holds and reads a 304 as the
  // document it already has (#445, launcher\app\Updater.cs FromSite).
  const updater = fs.readFileSync(path.join(__dirname, '..', 'launcher', 'app', 'Updater.cs'), 'utf8');
  yes('the launcher asks with If-None-Match', /If-None-Match/.test(updater));
  yes('and reads 304 as the copy it already has',
      /StatusCode\s*==\s*304/.test(updater) && /have\.Doc/.test(updater));

  server.close();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch (e) { }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
