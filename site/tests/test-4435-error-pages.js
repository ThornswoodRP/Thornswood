'use strict';
/*
  test-4435-error-pages.js

      node .\site\tests\test-4435-error-pages.js
      node .\site\tests\test-4435-error-pages.js <an older server.js>

  Issue #4435. An unknown address answered a browser with a Thornswood page
  and a way back (wantsHtml and notFoundPage, lib/passes.js), but every other
  error a browser can reach answered one line of plain text: a bad address,
  the invite when none is set, Discord sign in when it is not set up, a page
  file the site could not read, a source map, a removed or unknown picture,
  an old or wrong download link, a Release file GitHub could not place, and
  an upload asked for without signing in. Each was its own
  send(..., 'text/plain') with nothing asking who was reading.

  Against a copy of the site in a scratch folder on a spare port (no public
  pages, no invite, no Discord login, GitHub on 127.0.0.1:1), this asks each
  of those twice:

    A  as a browser does (Accept: text/html, ...): the same status as before,
       and a Thornswood page with a way back (the site's door stylesheet, a
       link to the front page and one to help), never the bare line.
    B  as the launcher and scripts do (no Accept, any type, or JSON): exactly
       the answer it always had, the same status, text/plain and the same
       words, so nothing that reads them changes.
    C  the launcher's own routes (the feed, its watch and its assets, and the
       launcher's Release list) answer what they always did even when a
       browser asks, because nothing but the launcher reads them.

  Nothing leaves the machine. The scratch folder is removed at the end.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE = process.argv[2] || path.join(ROOT, 'site', 'server.js');
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 300).split('\n').join('\n      ') : '')); }
}

const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
// Waits for the site's own "[thornswood-docs] listening on ...:port" line
// rather than polling the port (#1727).
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const end = (e) => { clearTimeout(late); srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', err); srv.removeListener('close', gone); if (e) { srv.kill(); bad(e); } else { ok(); } };
    const said = (d) => { out += d; const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(); } };
    const err = (d) => { out += d; };
    const gone = (code) => end(new Error('site stopped (exit ' + code + ') before it was listening:\n' + out));
    const late = setTimeout(() => end(new Error('site not listening in 15 s:\n' + out)), 15000);
    srv.stdout.on('data', said);
    srv.stderr.on('data', err);
    srv.on('close', gone);
  });
}
function ask(port, where, accept) {
  return new Promise((ok) => {
    const h = {};
    if (accept !== null) h.accept = accept;
    const r = http.request({ host: '127.0.0.1', port, method: 'GET', path: where, headers: h, agent: false }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => ok({ status: res.statusCode, text: buf, type: String(res.headers['content-type'] || '') }));
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', (e) => ok({ status: 0, text: String(e), type: '' }));
    r.end();
  });
}

// A page with a way back: the site's door stylesheet, the front page, help.
const isPage = (r) => /^text\/html/.test(r.type) && r.text.indexOf('<!doctype html>') === 0 &&
  r.text.indexOf('/door.css') >= 0 && r.text.indexOf('<a href="/">') >= 0 && r.text.indexOf('<a href="/help">') >= 0;
const isPlain = (r, words) => /^text\/plain/.test(r.type) &&
  (typeof words === 'string' ? r.text === words : words.test(r.text));

// Every browser-reachable error: where, why it fails here, its status, and
// the plain answer the launcher and scripts have always had.
const RELEASE_PLAIN = /^(?:no such file on a published Release|GitHub could not say where that file is just now \(.+\)\. Try again in a minute\.)$/;
const BROWSER_ERRORS = [
  ['/%', 'an address that cannot be read', [400], 'bad request'],
  ['/discord', 'the invite, with none set', [404], 'No invite link set yet.'],
  ['/.well-known/nothing', 'a domain proof that is not there', [404], 'no such file'],
  ['/auth/discord', 'Discord sign in, not set up here', [500], 'Discord login is not set up on this server yet.'],
  ['/', 'the front page, its file missing', [500], 'no home.html'],
  ['/hub', 'the hub, its file missing', [500], 'no index.html'],
  ['/hub.js.map', 'a source map', [404], 'not here'],
  ['/shot/nothing.png', 'a picture not on the gallery', [404], 'no such picture'],
  ['/file/nothing.zip', 'an old or wrong download link', [404], 'no such file'],
  ['/release/v0.0.1/nothing.zip', 'a Release file GitHub cannot place', [404, 503], RELEASE_PLAIN],
  ['/up/nothing.png', 'an upload, not signed in', [401], 'sign in first'],
  ['/nowhere-at-all', 'an unknown address', [404], 'not here']
];
const LAUNCHER_ROUTES = [
  ['/feed/version.json', 'the feed, with none written', 404, 'no such file', /^text\/plain/],
  ['/feed/watch', 'the feed watch, with no feed', 404, 'no such file', /^text\/plain/],
  ['/feed/assets/' + '0'.repeat(64), 'a pack that is not there', 404, 'no such file', /^text\/plain/],
  ['/api/launcher/releases', 'the launcher\'s Release list, GitHub down', 503, null, /^application\/json/]
];

(async function main() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4435-'));
  let srv = null;
  try {
    siteFiles.copy(dir, SITE);
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'public', '.well-known'), { recursive: true });
    // No home.html and no index.html: what the site answers when it cannot
    // read its own page is one of the errors asked for.
    for (const f of ['home.html', 'index.html']) fs.rmSync(path.join(dir, 'public', f), { force: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: crypto.randomBytes(24).toString('hex'), admins: ['222222222'],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));

    const port = await freePort();
    srv = spawn(process.execPath, [path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
    });
    await listening(srv, port);

    console.log('A. a browser is shown a page with a way back:');
    for (const [where, what, codes] of BROWSER_ERRORS) {
      const r = await ask(port, where, BROWSER);
      yes(what + ' (' + where + '): ' + r.status + ', a Thornswood page with a way back',
          codes.indexOf(r.status) >= 0 && isPage(r), r.status + ' ' + r.type + ': ' + r.text);
    }

    console.log('\nB. the launcher and scripts get the answer they always had:');
    for (const [where, what, codes, words] of BROWSER_ERRORS) {
      for (const accept of [null, '*/*', 'application/json']) {
        const r = await ask(port, where, accept);
        yes(what + ' (' + where + ', Accept ' + (accept || 'none') + '): ' + r.status + ', the same plain line',
            codes.indexOf(r.status) >= 0 && isPlain(r, words), r.status + ' ' + r.type + ': ' + r.text);
      }
    }

    console.log('\nC. the launcher\'s own routes answer as they always did, whoever asks:');
    for (const [where, what, code, words, type] of LAUNCHER_ROUTES) {
      for (const accept of [null, BROWSER]) {
        const r = await ask(port, where, accept);
        yes(what + ' (' + where + ', Accept ' + (accept ? 'a browser\'s' : 'none') + '): ' + r.status + ', ' + type.source,
            r.status === code && type.test(r.type) && (words === null || r.text === words) && r.text.indexOf('<!doctype') < 0,
            r.status + ' ' + r.type + ': ' + r.text);
      }
    }
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  } finally {
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the scratch folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
