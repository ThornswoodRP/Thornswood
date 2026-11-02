'use strict';
// test-3218-site-cache.js
//
//     node tests\test-3218-site-cache.js
//
// #3218, the Lighthouse runs of thornswood.net on 21 Oct 2026. What they
// measured, and what this holds:
//
//   1. Every file a page names is kept for an hour at most (Cloudflare made
//      it four), home.js and home.css with a ?v= the site never read. Now a
//      page names every file of public/ with its hash, and a file asked for
//      with the hash it has now is immutable for a year. With no hash, or an
//      old one, it is the hour, as before. fonts.css names its fonts with
//      their hashes too, the preloads in home.html name the same addresses,
//      and a stylesheet's own hash moves when a font it names does.
//   2. Every public page and /api/public went out no-store, which keeps a
//      page out of the browser's back and forward cache. They are no-cache
//      now. The hub, which holds who is signed in, stays no-store.
//   3. The pictures the front page draws at 28 pixels and as the hero still
//      are the WebP ones Build-SiteImages.py makes, at the sizes they are
//      drawn, and the ones in the repository are what it builds.
//   4. The CSP lets Cloudflare Web Analytics through (Patrick, 22 Oct 2026).
//   5. The header logo's alt is empty, the link beside it names the site.
//
// Starts a copy of the site on a port the system gives it, and waits for
// that site's own "listening on" line before asking it anything (#1727).
const fs = require('fs'), path = require('path'), os = require('os');
const net = require('net'), http = require('http'), crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const siteFiles = require('./site-files');
const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'site'), PUBLIC = path.join(APP, 'public');

let pass = 0, fail = 0;
function yes(what, condition) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + what);
  if (condition) pass++; else fail++;
}
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
      const parts = [];
      res.on('data', function (d) { parts.push(d); });
      res.on('end', function () {
        const buf = Buffer.concat(parts);
        ok({ status: res.statusCode, headers: res.headers, buf: buf, body: buf.toString('utf8') });
      });
    });
    req.on('error', function (e) { ok({ status: 0, error: e.message, headers: {}, buf: Buffer.alloc(0), body: '' }); });
    req.setTimeout(10000, function () { req.destroy(new Error('no answer in ten seconds')); });
    req.end();
  });
}

const made = [];
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-3218-'));
  made.push(dir);
  siteFiles.copy(dir);
  fs.mkdirSync(path.join(dir, 'public'));
  for (const f of fs.readdirSync(PUBLIC)) {
    if (fs.statSync(path.join(PUBLIC, f)).isFile()) fs.copyFileSync(path.join(PUBLIC, f), path.join(dir, 'public', f));
  }
  fs.mkdirSync(path.join(dir, 'data', 'site'), { recursive: true });
  for (const f of fs.readdirSync(path.join(APP, 'data', 'site'))) {
    fs.copyFileSync(path.join(APP, 'data', 'site', f), path.join(dir, 'data', 'site', f));
  }
  fs.copyFileSync(path.join(APP, 'config.example.json'), path.join(dir, 'config.json'));
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
const hash = (b) => crypto.createHash('sha256').update(b).digest('hex').slice(0, 16);
// Every "/name.ext" a page names in src, href, poster or srcset.
function named(html) {
  const out = [];
  const re = /\s(?:src|href|poster)="(\/[A-Za-z0-9._-]+\.[a-z0-9]+(?:\?[^"]*)?)"/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  const set = /\ssrcset="([^"]*)"/gi;
  while ((m = set.exec(html))) m[1].split(',').forEach((part) => out.push(part.trim().split(/\s+/)[0]));
  return out;
}

(async function () {
  // ---- what is in the repository, read without a server --------------------
  const src = siteFiles.source();
  const csp = JSON.parse((src.match(/const CSP_HEADER = ("[^"\r\n]*");/) || [, '""'])[1]);
  yes('the CSP lets Cloudflare\'s analytics script in', /script-src 'self' https:\/\/static\.cloudflareinsights\.com[ ;]/.test(csp));
  yes('and lets it report', /connect-src 'self' https:\/\/cloudflareinsights\.com;/.test(csp));
  const privacy = fs.readFileSync(path.join(APP, 'data', 'site', 'privacy.md'), 'utf8');
  yes('the privacy page names Cloudflare Web Analytics and where it comes from',
      /Cloudflare Web Analytics/.test(privacy) && /static\.cloudflareinsights\.com/.test(privacy));
  yes('and no longer says the site has no analytics', !/no analytics on this site/.test(privacy));

  let built = '';
  for (const py of ['python3', 'python']) {
    try {
      built = execFileSync(py, [path.join(ROOT, 'scripts', 'dev', 'Build-SiteImages.py'), '--check'],
                           { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      break;
    } catch (e) {
      // Exit 1 with STALE lines is the answer; anything else (no python, no
      // Pillow) is no answer, and the next name is tried.
      if (e.status === 1 && /STALE/.test(String(e.stdout || ''))) { built = String(e.stdout); break; }
    }
  }
  if (!built) console.log('SKIP  no python with Pillow here to rebuild the site pictures');
  else yes('the site pictures in the repository are what Build-SiteImages.py makes',
           !/STALE/.test(built));

  // ---- a copy of the site ---------------------------------------------------
  let run;
  try {
    run = await start(copy());
    yes('a copy of server.js comes up on 127.0.0.1', run.up);
    if (!run.up) { console.log(run.out.split('\n').slice(-12).join('\n')); return; }

    const home = await ask(run.port, '/');
    yes('the front page is no-cache, so Back can keep it', home.headers['cache-control'] === 'no-cache');
    const rules = await ask(run.port, '/rules');
    yes('a written page as well', rules.headers['cache-control'] === 'no-cache');
    const api = await ask(run.port, '/api/public?galleryLimit=24');
    yes('and /api/public, which the front page fetches', api.headers['cache-control'] === 'no-cache');
    const hub = await ask(run.port, '/hub');
    yes('the hub, which says who is signed in, stays no-store', hub.headers['cache-control'] === 'no-store');
    // #5190: Cloudflare's cache rule keeps only what carries this header.
    yes('Cloudflare keeps the front page and a written page five minutes, by its own header',
      home.headers['cloudflare-cdn-cache-control'] === 'max-age=300' && rules.headers['cloudflare-cdn-cache-control'] === 'max-age=300');
    yes('and never the hub or /api/public', hub.headers['cloudflare-cdn-cache-control'] === undefined &&
      api.headers['cloudflare-cdn-cache-control'] === undefined);

    const refs = named(home.body).filter((r) => fs.existsSync(path.join(PUBLIC, r.split('?')[0].slice(1))));
    yes('the front page names files of public/ (' + refs.length + ')', refs.length >= 8);
    const bare = refs.filter((r) => !/\?v=[0-9a-f]{16}$/.test(r));
    yes('and every one carries its hash' + (bare.length ? ', not: ' + bare.join(' ') : ''), bare.length === 0);
    const hubRefs = named(hub.body);
    yes('so does every file the hub names', hubRefs.length > 0 && hubRefs.every((r) => /\?v=[0-9a-f]{16}$/.test(r)));

    const js = refs.find((r) => /^\/home\.js\?/.test(r));
    yes('home.js is named by the hash of the file', js === '/home.js?v=' + hash(fs.readFileSync(path.join(PUBLIC, 'home.js'))));
    const got = await ask(run.port, js);
    yes('and asked for that way it is kept a year, immutable',
        got.status === 200 && got.headers['cache-control'] === 'public, max-age=31536000, immutable');
    const plain = await ask(run.port, '/home.js');
    yes('asked for with no hash it is the hour, as before', plain.headers['cache-control'] === 'public, max-age=3600');
    const stale = await ask(run.port, '/home.js?v=0000000000000000');
    yes('and with a hash it no longer has, the hour', stale.headers['cache-control'] === 'public, max-age=3600');
    const again = await ask(run.port, js, { 'if-none-match': got.headers.etag });
    yes('its ETag is its hash and answers 304', got.headers.etag === '"' + js.split('=')[1] + '"' && again.status === 304 &&
        again.headers['cache-control'] === 'public, max-age=31536000, immutable');

    const fontsRef = refs.find((r) => /^\/fonts\.css\?/.test(r));
    const fonts = await ask(run.port, fontsRef);
    yes('fonts.css is kept a year too', fonts.headers['cache-control'] === 'public, max-age=31536000, immutable');
    const fontUrls = (fonts.body.match(/url\(([^)]+)\)/g) || []).map((u) => u.slice(4, -1).replace(/["']/g, ''));
    yes('it names each font with that font\'s hash',
        fontUrls.length === 6 && fontUrls.every((u) => {
          const name = u.split('?')[0].slice(1);
          return u === '/' + name + '?v=' + hash(fs.readFileSync(path.join(PUBLIC, name)));
        }));
    yes('fonts.css\'s own hash is of what it serves, font hashes in it', fontsRef === '/fonts.css?v=' + hash(fonts.buf));
    const preloads = (home.body.match(/<link rel="preload"[^>]*>/g) || []);
    yes('the front page preloads two fonts, as fonts', preloads.length === 2 &&
        preloads.every((l) => /as="font"/.test(l) && /type="font\/woff2"/.test(l) && /crossorigin/.test(l)));
    yes('at exactly the addresses fonts.css names, so nothing is fetched twice',
        preloads.every((l) => fontUrls.indexOf((l.match(/href="([^"]+)"/) || [])[1]) >= 0));
    const font = await ask(run.port, fontUrls[0]);
    yes('a font asked for that way is kept a year', font.headers['cache-control'] === 'public, max-age=31536000, immutable');

    // A font changes: fonts.css's address has to move with it, or a browser
    // holding fonts.css for a year would keep asking for the old font.
    const dir = made[made.length - 1];
    fs.appendFileSync(path.join(dir, 'public', 'cinzel.woff2'), Buffer.from([0]));
    const home2 = await ask(run.port, '/');
    const fontsRef2 = named(home2.body).find((r) => /^\/fonts\.css\?/.test(r));
    yes('a changed font moves fonts.css to a new address', !!fontsRef2 && fontsRef2 !== fontsRef);
    const old = await ask(run.port, fontsRef);
    yes('and the old address is the hour, not a year', old.headers['cache-control'] === 'public, max-age=3600');

    const logo = (home.body.match(/<a class="mark"[^>]*>(<img[^>]*>)/) || [])[1] || '';
    yes('the header logo is the 28 pixel WebP, 2x and 3x beside it',
        /src="\/logo-28\.webp\?v=/.test(logo) && /logo-56\.webp\?v=[0-9a-f]+ 2x/.test(logo) &&
        /logo-84\.webp\?v=[0-9a-f]+ 3x/.test(logo) && /width="28"/.test(logo) && /height="28"/.test(logo));
    yes('with an empty alt, the link names the site in words', /alt=""/.test(logo));
    const still = (home.body.match(/<img class="art"[^>]*>/) || [''])[0];
    yes('the hero still is the WebP at three widths, asked for first',
        /banner-800\.webp\?v=[0-9a-f]+ 800w/.test(still) && /banner-1600\.webp\?v=[0-9a-f]+ 1600w/.test(still) &&
        /sizes="100vw"/.test(still) && /fetchpriority="high"/.test(still));
    yes('and the video has no poster, so a phone is not sent the 1600 pixel JPEG',
        /<video class="art"/.test(home.body) && !/poster=/.test(home.body));
    const webp = await ask(run.port, (still.match(/src="([^"]+)"/) || [])[1]);
    yes('the still is served as image/webp', webp.status === 200 && webp.headers['content-type'] === 'image/webp');
  } finally {
    await stop(run);
    for (const d of made) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } }
  }
})().then(function () {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, function (e) {
  console.log('FAIL  the harness threw: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
