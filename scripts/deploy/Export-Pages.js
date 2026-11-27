'use strict';
/*
  Export-Pages.js

      node scripts/deploy/Export-Pages.js <out folder>

  The site's plain pages as plain files, for Cloudflare Pages (#5190, plan
  line 31). The site stays whole on the box (Patrick, 31 Oct, 5:34 PM); this
  is a second copy of the pages that are only words, served from Cloudflare's
  network at the Pages project's own address, built by Cloudflare from this
  repository on every merge that touches site/ with no token stored anywhere.

  HOW. It starts this commit's site (server.js and lib) on loopback in a
  scratch copy, the way the site harnesses do, asks it for the front page
  and every written page (MD_PAGES), and writes each as <page>.html beside
  a copy of site/public. So the copy is what the site itself sends for this commit,
  never a second renderer that could drift from it.

  WHAT IT TAKES FROM THE LIVE SITE. Two things the site's config holds and
  the repository does not: the alpha or open wording switch (#428) and the
  Discord invite. Both are public, in https://thornswood.net/api/public, and
  the copy says what the site says. When that does not answer, the export
  stops and writes nothing: a copy with the wrong wording or no invite is
  worse than the last good one, which Pages keeps serving.

  WHAT IT LEAVES TO THE SITE. Everything that is not only words: the News,
  Gallery, Roadmap, Report and Known Issues pages, the hub, the APIs, the feeds
  and the files. And the pages behind the age gate (AGE_PAGES in
  site/lib/pages.js: Downloads and How to join), which the site sends as the
  gate or the page by the browser's cookie (#4330, #5624), and a plain file
  cannot read a cookie. _redirects sends each of those to thornswood.net. _headers
  gives each page the security headers the site sent with it, and asks search
  engines not to index the copy, whose pages name thornswood.net as theirs.

  tests/test-5190-pages-export.js runs it against a stand-in for the live
  site. It writes only under <out folder> and its own scratch folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'site');
const LIVE = process.env.THORNSWOOD_PAGES_LIVE || 'https://thornswood.net';
// Pages served by the box, and how the copy sends people there.
// AGE_PAGES, read from site/lib/pages.js below, join them.
const TO_SITE = ['/news', '/gallery', '/roadmap', '/report', '/known', '/hub', '/hub/*',
                 '/api/*', '/feed/*', '/feed-dev/*', '/file/*', '/auth/*', '/sitemap.xml'];
// The headers of each page that are the site's and say nothing about the request.
const KEEP_HEADERS = ['content-security-policy', 'referrer-policy', 'x-content-type-options',
                      'x-frame-options', 'permissions-policy', 'cross-origin-opener-policy',
                      'strict-transport-security'];

// Thrown, so the site copy started below is stopped and its scratch folder
// goes before the export says why and exits 1.
function fail(why) { throw new Error(why); }
function getJson(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(url, { headers: { 'user-agent': 'thornswood-pages-export' } }, (res) => {
      let out = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { out += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ why: url + ' answered ' + res.statusCode });
        try { resolve({ body: JSON.parse(out) }); } catch (e) { resolve({ why: url + ' did not answer JSON' }); }
      });
    });
    req.setTimeout(20000, () => { req.destroy(); resolve({ why: url + ' did not answer inside twenty seconds' }); });
    req.on('error', (e) => resolve({ why: 'could not reach ' + url + ': ' + e.message }));
  });
}
function ask(port, route) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: route, agent: false }, (res) => {
      const parts = [];
      res.on('data', (d) => parts.push(d));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
    });
    req.on('error', (e) => resolve({ status: 0, why: e.message }));
  });
}
/* The port the site said it got. It is started on 0 so the system picks a
   free one as it listens; a port chosen here and let go first can be taken
   by then (#6136). site/server.js prints this line. */
function saidPort(text) {
  const m = /\[thornswood-docs\] listening on \S+:(\d+)\r?\n/.exec(String(text));
  return m ? Number(m[1]) : 0;
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const f of fs.readdirSync(from)) {
    const a = path.join(from, f), b = path.join(to, f);
    if (fs.statSync(a).isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

async function main() {
  const out = process.argv[2];
  if (!out) fail('name the folder to write the pages to');
  const outDir = path.resolve(out);

  // The pages the site writes from words alone, read from the site itself.
  const src = fs.readFileSync(path.join(APP, 'lib', 'pages.js'), 'utf8');
  const md = /const MD_PAGES = \[([^\]]*)\]/.exec(src);
  if (!md) fail('site/lib/pages.js has no MD_PAGES list');
  // Known Issues is written from the issue board the bot keeps on the box,
  // which the repository holds no live copy of, so it stays the site's.
  const routes = (list) => (list.match(/'\/[a-z-]+'/g) || []).map((s) => s.slice(1, -1));
  const age = /const AGE_PAGES = \[([^\]]*)\]/.exec(src);
  if (!age) fail('site/lib/pages.js has no AGE_PAGES list');
  const gated = routes(age[1]);
  const toSite = TO_SITE.concat(gated.filter((p) => TO_SITE.indexOf(p) < 0));
  // The gated pages go to the site, above, so they are not copied either.
  const pages = ['/'].concat(routes(md[1]))
    .filter((p) => p !== '/known' && gated.indexOf(p) < 0);

  const pub = await getJson(LIVE + '/api/public?galleryLimit=0');
  if (pub.why) fail(pub.why);
  if (typeof pub.body.open !== 'boolean' || typeof pub.body.invite !== 'string') fail(LIVE + '/api/public did not say open and invite');

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-pages-'));
  let child = null;
  try {
    fs.copyFileSync(path.join(APP, 'server.js'), path.join(scratch, 'server.js'));
    copyDir(path.join(APP, 'lib'), path.join(scratch, 'lib'));
    copyDir(path.join(APP, 'public'), path.join(scratch, 'public'));
    copyDir(path.join(APP, 'data', 'site'), path.join(scratch, 'data', 'site'));
    fs.copyFileSync(path.join(APP, 'data', 'help.md'), path.join(scratch, 'data', 'help.md'));
    const cfg = JSON.parse(fs.readFileSync(path.join(APP, 'config.example.json'), 'utf8'));
    cfg.open = pub.body.open;
    cfg.discord = Object.assign({}, cfg.discord, { invite: pub.body.invite });
    fs.writeFileSync(path.join(scratch, 'config.json'), JSON.stringify(cfg, null, 2));

    let port = 0;
    let said = '', exited = false;
    child = spawn(process.execPath, ['server.js'], {
      cwd: scratch,
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1',
                                            THORNSWOOD_CHAT_DIR: path.join(scratch, 'chat') })
    });
    child.stdout.on('data', (d) => { said += d; });
    child.stderr.on('data', (d) => { said += d; });
    child.on('exit', () => { exited = true; });
    const until = Date.now() + 15000;
    while (!exited && !saidPort(said) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    if (exited || !saidPort(said)) fail('the site did not start: ' + said.slice(-400));
    port = saidPort(said);

    const got = {};
    for (const route of pages) {
      const r = await ask(port, route);
      if (r.status !== 200 || !/^text\/html/.test(String(r.headers['content-type'] || ''))) {
        fail('the site answered ' + route + ' with ' + (r.status || r.why));
      }
      got[route] = r;
    }

    // Written only once every page answered.
    fs.rmSync(outDir, { recursive: true, force: true });
    copyDir(path.join(APP, 'public'), outDir);
    // The hub's files and the page template are the box's, not the copy's.
    for (const name of ['index.html', 'home.html', 'hub.js', 'hub.css']) fs.rmSync(path.join(outDir, name), { force: true });
    let headers = '';
    for (const route of pages) {
      // /rules as rules.html: Pages serves /rules from it with no redirect.
      const file = path.join(outDir, route === '/' ? 'index.html' : route.slice(1) + '.html');
      fs.writeFileSync(file, got[route].body);
      headers += route + '\n';
      for (const h of KEEP_HEADERS) {
        const v = got[route].headers[h];
        if (v) headers += '  ' + h + ': ' + v + '\n';
      }
    }
    headers += '/*\n  X-Robots-Tag: noindex\n';
    fs.writeFileSync(path.join(outDir, '_headers'), headers);
    fs.writeFileSync(path.join(outDir, '_redirects'),
      toSite.map((p) => p + ' ' + LIVE + (p.endsWith('/*') ? p.slice(0, -1) + ':splat' : p) + ' 302').join('\n') + '\n');
    console.log('Export-Pages: ' + pages.length + ' pages written to ' + outDir + ' (' +
                (pub.body.open ? 'open' : 'alpha') + ' wording)');
  } finally {
    // The site copy is stopped and its exit waited for before its folder
    // goes: on Windows a running process holds the files it opened there,
    // and the folder cannot be removed until it has exited (the gate's
    // Windows run of this, 1 Nov: pages written, then exit 1 on the cleanup).
    if (child && child.exitCode === null && child.signalCode === null) {
      const gone = new Promise((r) => child.once('exit', r));
      try { child.kill(); } catch (e) { /* gone already */ }
      await gone;
    }
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error('Export-Pages: ' + (e && e.message) + '. Nothing was written.');
  process.exitCode = 1;
});
