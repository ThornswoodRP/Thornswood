'use strict';
/*
  test-4585-escattr-served.js

      node .\site\tests\test-4585-escattr-served.js
      node .\site\tests\test-4585-escattr-served.js <an older server.js>

  Issue #4585. The site's server-side escaper escAttr (lib/pages.js) puts the
  gallery's names, alt text and links and the release notes into the HTML of
  /gallery and /news. With escAttr made to give back its input unchanged, or
  with only its &quot; step taken out, every site test still passed: the one
  escaping test checks the hub's escaper and the markdown, not this one.

  Against a copy of the site in a scratch folder on a spare port, with a
  gallery entry and a release note whose every field holds <, >, & and ":
    A  /gallery serves each field with all four escaped, and none of the four
       reaches the HTML as it was written;
    B  /news does the same for the launcher line, the date, the title, the
       body and each detail.

  Each of the four is held on its own, so a change that drops one step of
  escAttr fails here. Nothing leaves the machine. The scratch folder is
  removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const APP = path.join(__dirname, '..', '..', 'site');
const SITE_SRC = path.resolve(process.argv[2] || path.join(APP, 'server.js'));

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300) : '')); }
}

/* One text per field, each with its own name, so a field that is left out
   or escaped wrongly is named. */
const mark = (name) => name + '<x-' + name + '>&' + name + '"q';
const escaped = (name) => name + '&lt;x-' + name + '&gt;&amp;' + name + '&quot;q';

/* Holds one field: its escaped form is there, and none of the four
   characters reaches the HTML as written. */
function held(where, html, name) {
  yes(where + ': ' + name + ' is served escaped', html.indexOf(escaped(name)) >= 0,
    (html.match(new RegExp(name + '.{0,40}')) || ['not on the page'])[0]);
  yes(where + ': ' + name + '\'s < and > are not served as a tag', html.indexOf('<x-' + name) < 0 && html.indexOf('x-' + name + '>') < 0);
  yes(where + ': ' + name + '\'s & is not served bare', html.indexOf('&' + name + '"') < 0 && html.indexOf('&' + name + '&') < 0);
  yes(where + ': ' + name + '\'s " is not served bare', html.indexOf(name + '"q') < 0);
}

function get(port, where) {
  return new Promise((done) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'GET', path: where, agent: false }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { text += d; });
      res.on('end', () => done({ status: res.statusCode, text }));
    });
    req.on('error', (e) => done({ status: 0, text: String(e) }));
    req.setTimeout(15000, () => req.destroy(new Error('timed out')));
    req.end();
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4585-'));
  let srv = null, out = '';
  try {
    siteFiles.copy(dir, SITE_SRC);
    // The page every public route is drawn into, and its parts.
    fs.cpSync(path.join(path.dirname(SITE_SRC), 'public'), path.join(dir, 'public'), { recursive: true, force: true });
    const data = path.join(dir, 'data');
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(16).toString('hex'), admins: [],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));
    fs.writeFileSync(path.join(data, 'gallery.json'), JSON.stringify([
      { name: 'a.png', url: '/shot/' + mark('url') + '.png', srcset: mark('srcset') + ' 640w', alt: mark('alt'), by: mark('by') }
    ]));
    fs.writeFileSync(path.join(data, 'news.json'), JSON.stringify({
      launcher: mark('launcher'),
      news: [{ date: mark('date'), title: mark('title'), body: mark('body'), details: [mark('detail')] }]
    }));
    srv = spawn(process.execPath, ['server.js'], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { out += d; });
    srv.stderr.on('data', (d) => { out += d; });
    const port = (await siteFiles.listening(srv)).port;

    console.log('A. /gallery:');
    let r = await get(port, '/gallery');
    yes('/gallery is served (' + r.status + ')', r.status === 200, r.text);
    for (const n of ['url', 'srcset', 'alt', 'by']) held('/gallery', r.text, n);

    console.log('\nB. /news:');
    r = await get(port, '/news');
    yes('/news is served (' + r.status + ')', r.status === 200, r.text);
    for (const n of ['launcher', 'date', 'title', 'body', 'detail']) held('/news', r.text, n);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, out);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
})();
