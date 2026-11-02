'use strict';
// test-5190-pages-export.js
//
//     node tests\test-5190-pages-export.js
//
// #5190, plan line 31: the site's plain pages also on Cloudflare Pages.
// scripts/deploy/Export-Pages.js starts this commit's site on loopback and
// writes the front page and the written pages as files for Pages. This runs
// it against a stand-in for the live site's /api/public (THORNSWOOD_PAGES_LIVE)
// and checks:
//   - each page is what the site sends, as <page>.html, with the wording
//     switch and the invite the live site says;
//   - Known Issues, News, the hub, the APIs and the feeds go to thornswood.net
//     by _redirects, and the hub's files and the page template are left out;
//   - _headers gives each page the site's own security headers and asks
//     search engines not to index the copy;
//   - when the live site does not answer, it writes nothing and exits 1,
//     leaving what was there (the last good copy is Pages' to keep serving).
// Writes only under its own temp folder.
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFile } = require('child_process');
const siteFiles = require('./site-files');
const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'deploy', 'Export-Pages.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  console.log((cond ? 'PASS  ' : 'FAIL  ') + what);
  if (cond) pass++; else fail++;
}
function standIn(answer) {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const a = answer(req.url);
      res.writeHead(a.status, { 'content-type': 'application/json' });
      res.end(a.body || '');
    });
    s.listen(0, '127.0.0.1', () => ok(s));
  });
}
function run(live, out) {
  return new Promise((ok) => {
    execFile(process.execPath, [SCRIPT, out], { env: Object.assign({}, process.env, { THORNSWOOD_PAGES_LIVE: live }), timeout: 60000 },
      (err, stdout, stderr) => ok({ code: err ? (err.code || 1) : 0, out: String(stdout) + String(stderr) }));
  });
}

(async function () {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5190-pages-'));
  try {
    const invite = 'https://discord.gg/standin123';
    let asked = [];
    const good = await standIn((u) => { asked.push(u); return u.startsWith('/api/public') ? { status: 200, body: JSON.stringify({ open: false, invite }) } : { status: 404 }; });
    const live = 'http://127.0.0.1:' + good.address().port;
    const out = path.join(tmp, 'out');
    const r = await run(live, out);
    good.close();
    yes('it exports (exit ' + r.code + ')', r.code === 0 && /10 pages written/.test(r.out));
    if (r.code !== 0) console.log('  it said: ' + r.out.trim().slice(-600));
    yes('it asked the live site for its wording and invite', asked.some((u) => u.startsWith('/api/public')));
    const html = (n) => { try { return fs.readFileSync(path.join(out, n), 'utf8'); } catch (e) { return ''; } };
    const src = siteFiles.source();
    const md = (/const MD_PAGES = \[([^\]]*)\]/.exec(src)[1].match(/'\/[a-z-]+'/g) || []).map((s) => s.slice(2, -1)).filter((p) => p !== 'known');
    yes('the front page and every written page but Known Issues are there as <page>.html',
        html('index.html').length > 0 && md.every((p) => html(p + '.html').includes('<title>')) && !fs.existsSync(path.join(out, 'known.html')));
    yes('each is the site\'s own page, its words in it', /<title>Rules · Thornswood<\/title>/.test(html('rules.html')) &&
        html('rules.html').includes('</h1>'));
    // Each link of the page, held whole to the invite: a link is the invite
    // or it is not, never one that has it somewhere inside.
    const links = [...html('index.html').matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
    yes('the invite is the one the live site says', links.some((l) => l === invite) && !html('index.html').includes('DISCORD_URL'));
    yes('the site\'s files are beside them, and the hub\'s and the template are not', fs.existsSync(path.join(out, 'home.css')) &&
        fs.existsSync(path.join(out, 'home.js')) && !fs.existsSync(path.join(out, 'hub.js')) && !fs.existsSync(path.join(out, 'home.html')));
    const redirects = html('_redirects');
    for (const p of ['/news', '/gallery', '/roadmap', '/downloads', '/report', '/known', '/hub', '/api/*', '/feed/*', '/auth/*']) {
      yes('_redirects sends ' + p + ' to the site', redirects.split('\n').some((l) => l.startsWith(p + ' ' + live + '/') && l.endsWith(' 302')));
    }
    const headers = html('_headers');
    yes('_headers gives each page the site\'s CSP and frame rule', ['/', '/rules', '/help'].every((p) =>
        new RegExp('^' + p.replace('/', '\\/') + '\\n  content-security-policy: default-src \'self\'', 'm').test(headers)) &&
        /x-frame-options: SAMEORIGIN/i.test(headers));
    yes('and asks search engines not to index the copy', /^\/\*\n  X-Robots-Tag: noindex$/m.test(headers));

    // The record the Pages project is made from runs this script.
    const rec = JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'cloudflare-pages.json'), 'utf8')).project;
    yes('records/cloudflare-pages.json builds with this script into the folder Pages serves',
        rec.build_config.build_command === 'node scripts/deploy/Export-Pages.js ' + rec.build_config.destination_dir &&
        rec.source.type === 'github' && rec.source.config.repo_name === 'Thornswood' && rec.source.config.production_branch === 'main');
    yes('  with no previews and no comments on pull requests, built only when the site or the export moves',
        rec.source.config.preview_deployment_setting === 'none' && rec.source.config.pr_comments_enabled === false &&
        rec.source.config.path_includes.includes('scripts/deploy/Export-Pages.js') && rec.source.config.path_includes.some((p) => p.startsWith('site/')));
    yes('  and no custom domain: thornswood.net stays the box\'s', JSON.parse(fs.readFileSync(path.join(REPO, 'records', 'cloudflare-pages.json'), 'utf8')).custom_domains.length === 0);

    // The live site down: nothing written, the last copy left as it was.
    const down = await standIn(() => ({ status: 503 }));
    fs.writeFileSync(path.join(out, 'index.html'), 'the last good copy');
    const r2 = await run('http://127.0.0.1:' + down.address().port, out);
    down.close();
    yes('with the live site not answering it stops, exit 1, and says why', r2.code === 1 && /answered 503\. Nothing was written/.test(r2.out));
    yes('and leaves what was there', html('index.html') === 'the last good copy');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
