/*
  test-file-range.js

      node .\site\tests\test-file-range.js

  The site's downloads are served from /file/, and a client resumes a half
  finished download by asking for the rest with a Range header and appending
  whatever a 206 brings. The old installer's payload was served that way
  (Bootstrap.cs, gone with it in #4824), and a browser resumes any download
  the same way. From the To Do List: "a Range request was confirmed live to
  return 200 with the full length and no Accept-Ranges", which is why a
  dropped connection started the whole download again while the Join page
  says it carries on.

  THE START BYTE IS THE WHOLE THING. A client appends a 206 onto the partial
  file without looking at it. A reply that starts one byte early or late is a
  corrupt zip that nothing notices until it will not open, so the resume case
  below puts the two halves back together and compares every byte.

  It lifts the real /file/ route and the real static route out of
  site\server.js by text and serves them from a real node http server on
  a loopback port, against files in a temp folder. Nothing is read from or
  written to the site's own folders, and no other port is touched.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const SRC = path.join(REPO_DIR, 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');
const CSP_HEADER = JSON.parse(src.match(/const CSP_HEADER = ("[^"\r\n]*");/)[1]);
// send() names it beside the CSP (#2762).
const PERMISSIONS_POLICY = src.match(/const PERMISSIONS_POLICY = '([^'\r\n]*)';/)[1];

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// From the first '{' at or after `at` to the brace that closes it.
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
// A route inside handle(): from `first` to the end of the if block `guard`.
function route(first, guard) {
  const at = src.indexOf(first);
  if (at < 0) return '';
  const g = src.indexOf(guard, at);
  if (g < 0) return '';
  return src.slice(at, block(g));
}

// ---- what the lifted code expects to find around it ------------------------
const FILES = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-range-files-'));
const PUBLIC = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-range-public-'));
const TYPES = { '.mp4': 'video/mp4' };

const sendSrc = grab('function send(');
yes('server.js still has send()', !!sendSrc);
eval(sendSrc);
// send() and rangeReply() put each answer's nonce into the CSP (#3216).
eval(grab('function cspFor('));

// The static route asks the file's hash (versionAssets, #3218) for how long
// it may be kept, so those come with it.
const crypto = require('crypto');
eval(src.split('\n').filter((l) => /^const (publicAssetVersions|ASSET_NAME|ASSET_ATTR|ASSET_SRCSET|ASSET_URL) /.test(l)).join('\n') + '\n' +
     ['function publicAssetVersion(', 'function publicAssetBody(', 'function assetRefs(', 'function versionAssets(']
       .map(grab).join('\n'));

// /file/ serves only what files.json publishes (#3798), so the route reads
// it through jsonFile and asks downloadServed.
// A const in an eval stays in the eval, so jsonFile is taken as its arrow.
const JSON_AT = src.indexOf('const jsonFile = (p, fallback) => {');
const jsonFile = eval('(' + src.slice(src.indexOf('(', JSON_AT), block(JSON_AT)) + ')');
eval(grab('function oldInstaller(') + '\n' + grab('function downloadServed('));
// The installer's names answer from their GitHub Release before the folder is
// looked at (#4824, test-release-copies.js); none is published here.
const SETUP_KINDS = { main: { name: 'Thornswood-Setup.exe' }, dev: { name: 'Thornswood-Dev-Setup.exe' } };
function newestSetup() { return null; }

const rangeSrc = grab('function rangeReply(');
yes('server.js has one range function, rangeReply()', !!rangeSrc);
if (rangeSrc) eval(rangeSrc);

const fileSrc = route('const dl = p.match(', "if (dl && req.method === 'GET')");
const staticSrc = route("if (req.method === 'GET' && /^\\/[A-Za-z0-9._-]+$/.test(p))",
                        "if (req.method === 'GET' && /^\\/[A-Za-z0-9._-]+$/.test(p))");
yes('the /file/ route is where this expects it', !!fileSrc);
yes('the static route is where this expects it', !!staticSrc);
yes('the /file/ route answers ranges through rangeReply', /rangeReply\(/.test(fileSrc));
yes('and so does the static route, so the two cannot drift apart again', /rangeReply\(/.test(staticSrc));

const fileRoute = eval('(function (p, req, res, head) {\n' + fileSrc + '\n})');
const staticRoute = eval('(function (p, req, res, head, url) {\n' + staticSrc + '\n})');

// A file whose every byte depends on where it sits, so an offset that is
// out by one shows as a mismatch rather than as a run of identical bytes.
const SIZE = 300007;
const whole = Buffer.alloc(SIZE);
for (let i = 0; i < SIZE; i++) whole[i] = (i * 7 + (i >> 8) + (i >> 16)) & 255;
const NAME = 'Guide-20260924-0100.zip';
fs.writeFileSync(path.join(FILES, NAME), whole);
fs.writeFileSync(path.join(FILES, 'files.json'), JSON.stringify({ [NAME]: { label: 'a large download' } }));
fs.writeFileSync(path.join(PUBLIC, 'clip.mp4'), whole.subarray(0, 5000));

// The two lines of handle() that come before every route: HEAD is routed as
// GET and the streamed routes are told it was a HEAD.
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  const head = req.method === 'HEAD';
  if (head) req.method = 'GET';
  try {
    staticRoute(p, req, res, head, url);
    if (!res.headersSent) fileRoute(p, req, res, head);
  } catch (e) {
    if (!res.headersSent) { res.writeHead(500); res.end(String(e && e.message)); }
    return;
  }
  if (!res.headersSent) { res.writeHead(404); res.end(); }
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

const FILE = '/file/' + encodeURIComponent(NAME);

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));

  // ---- no range: the old download, now saying it may be resumed ------------
  const full = await ask('GET', FILE);
  yes('a plain download is still 200', full.code === 200);
  yes('with the whole file, byte for byte', full.body.equals(whole));
  yes('and says Accept-Ranges: bytes before the client starts', full.h['accept-ranges'] === 'bytes');
  yes('with its length', full.h['content-length'] === String(SIZE));
  yes('as an attachment under its own name',
      full.h['content-disposition'] === 'attachment; filename="' + NAME + '"');
  yes('with an ETag, which a browser needs before it will resume', !!full.h['etag']);
  yes('and a Last-Modified', !!full.h['last-modified']);

  const head = await ask('HEAD', FILE);
  yes('a HEAD is 200', head.code === 200);
  yes('a HEAD shows Accept-Ranges: bytes', head.h['accept-ranges'] === 'bytes');
  yes('a HEAD gives the size', head.h['content-length'] === String(SIZE));
  yes('a HEAD has no body', head.body.length === 0);

  // ---- the To Do List's done-when, exactly --------------------------------
  const first = await ask('GET', FILE, { Range: 'bytes=0-1023' });
  yes('bytes=0-1023 is 206 Partial Content', first.code === 206);
  yes('with Content-Range: bytes 0-1023/' + SIZE, first.h['content-range'] === 'bytes 0-1023/' + SIZE);
  yes('and Content-Length: 1024', first.h['content-length'] === '1024');
  yes('and exactly the first kilobyte', first.body.equals(whole.subarray(0, 1024)));
  yes('a 206 is still an octet-stream', first.h['content-type'] === 'application/octet-stream');
  yes('and still an attachment', /^attachment; filename="/.test(first.h['content-disposition'] || ''));
  yes('and still says Accept-Ranges', first.h['accept-ranges'] === 'bytes');

  // ---- a resume: the client sends bytes=have- ------------------------------
  const have = 123457;
  const rest = await ask('GET', FILE, { Range: 'bytes=' + have + '-' });
  yes('resuming from ' + have + ' is 206, which is what a client checks for', rest.code === 206);
  yes('Content-Range starts at exactly the byte asked for',
      rest.h['content-range'] === 'bytes ' + have + '-' + (SIZE - 1) + '/' + SIZE);
  yes('Content-Length is what is left', rest.h['content-length'] === String(SIZE - have));
  yes('the partial file plus the reply is the whole file, every byte',
      Buffer.concat([whole.subarray(0, have), rest.body]).equals(whole));

  const last = await ask('GET', FILE, { Range: 'bytes=' + (SIZE - 1) + '-' });
  yes('one byte left comes back as that one byte',
      last.code === 206 && last.body.length === 1 && last.body[0] === whole[SIZE - 1]);

  // ---- the other shapes a range can take ----------------------------------
  const tail = await ask('GET', FILE, { Range: 'bytes=-100' });
  yes('bytes=-100 is the last hundred, not the first',
      tail.code === 206 && tail.body.equals(whole.subarray(SIZE - 100)) &&
      tail.h['content-range'] === 'bytes ' + (SIZE - 100) + '-' + (SIZE - 1) + '/' + SIZE);

  const over = await ask('GET', FILE, { Range: 'bytes=1000-' + (SIZE + 5000) });
  yes('an end past the file is cut at the file',
      over.code === 206 && over.h['content-range'] === 'bytes 1000-' + (SIZE - 1) + '/' + SIZE &&
      over.body.equals(whole.subarray(1000)));

  const done = await ask('GET', FILE, { Range: 'bytes=' + SIZE + '-' });
  yes('asking to start at the end is 416', done.code === 416);
  yes('with Content-Range: bytes */' + SIZE, done.h['content-range'] === 'bytes */' + SIZE);
  yes('and no body', done.body.length === 0);

  const many = await ask('GET', FILE, { Range: 'bytes=0-1,5-9' });
  yes('several ranges at once are not attempted: the whole file, 200',
      many.code === 200 && many.body.equals(whole));

  const headRange = await ask('HEAD', FILE, { Range: 'bytes=0-' });
  yes('a HEAD with a range gives the 206 headers', headRange.code === 206 &&
      headRange.h['content-length'] === String(SIZE));
  yes('and no body', headRange.body.length === 0);

  // ---- If-Range: only resume the file the first half came from -------------
  const same = await ask('GET', FILE, { Range: 'bytes=' + have + '-', 'If-Range': full.h['etag'] || '"none"' });
  yes('If-Range with the current ETag resumes', same.code === 206 &&
      Buffer.concat([whole.subarray(0, have), same.body]).equals(whole));
  const dated = await ask('GET', FILE, { Range: 'bytes=' + have + '-',
                                          'If-Range': full.h['last-modified'] || 'none' });
  yes('If-Range with the current Last-Modified resumes', dated.code === 206);
  const stale = await ask('GET', FILE, { Range: 'bytes=' + have + '-', 'If-Range': '"not-this-build"' });
  yes('If-Range naming another build gets the whole new file, 200',
      stale.code === 200 && stale.body.equals(whole));

  const none = await ask('GET', '/file/Guide-19990101-0000.zip', { Range: 'bytes=0-9' });
  yes('a file that is not there is still 404', none.code === 404);

  // ---- the static route, which now shares the function ---------------------
  const clip = whole.subarray(0, 5000);
  const vid = await ask('GET', '/clip.mp4', { Range: 'bytes=0-99' });
  yes('a video range is still 206', vid.code === 206 && vid.body.equals(clip.subarray(0, 100)));
  yes('served as video', vid.h['content-type'] === 'video/mp4');
  yes('with Content-Range', vid.h['content-range'] === 'bytes 0-99/5000');
  // It went out no-store, so the banner video was never kept (#3218). A range
  // carries the line the whole file does.
  yes('and the hour the whole file is kept for', vid.h['cache-control'] === 'public, max-age=3600');
  const vidAll = await ask('GET', '/clip.mp4');
  yes('a video with no range is still the cached 200',
      vidAll.code === 200 && vidAll.body.equals(clip) &&
      vidAll.h['cache-control'] === 'public, max-age=3600' && vidAll.h['accept-ranges'] === 'bytes');
  const v = crypto.createHash('sha256').update(clip).digest('hex').slice(0, 16);
  const vidTagged = await ask('GET', '/clip.mp4?v=' + v, { Range: 'bytes=0-99' });
  yes('asked for with its hash, a range of it is kept a year, immutable',
      vidTagged.code === 206 && vidTagged.h['cache-control'] === 'public, max-age=31536000, immutable');
  const vidOld = await ask('GET', '/clip.mp4?v=0000000000000000');
  yes('asked for with a hash it no longer has, it is the hour',
      vidOld.code === 200 && vidOld.h['cache-control'] === 'public, max-age=3600');
  const vidBad = await ask('GET', '/clip.mp4', { Range: 'bytes=9000-' });
  yes('a video range past the end is 416', vidBad.code === 416 &&
      vidBad.h['content-range'] === 'bytes */5000');

  server.close();
  for (const d of [FILES, PUBLIC]) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.log('FAIL  ' + (e && e.stack || e));
  process.exit(1);
});
