'use strict';
/*
  test-site-credits-fill.js

  The credits page names the engine each server runs and the client commit
  each feed serves. Those were hand edits that went stale with every deploy
  (720a5f7c, caught by tests\test-source-offer.ps1). site/server.js now fills
  them at serve time from data/deployed-build.json (written by
  scripts/deploy/DeployedBuild.ps1 after a server deploy) and from the
  feed and feed-dev it serves (the newest of <channel>\version\<8 digits>.json
  since #2727), and keeps the hand text when either
  is missing or unreadable. A record with only one server in it fills that
  one (#2303), and the hand text names no commit for either server.

  Part one runs fillCreditsCommits, cut out of server.js by its markers, on
  the real credits.md. Part two starts a copy of server.js in a temp folder
  and asks it for /credits: hand text with no file, the new commit after the
  file changes (no restart, no edit to credits.md), and hand text again when
  the file is garbage. Offline; every temp folder is removed.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const REPO = path.join(__dirname, '..', '..');
const APP = path.join(REPO, 'site');
const SRC = siteFiles.source();
const CREDITS = fs.readFileSync(path.join(APP, 'data', 'site', 'credits.md'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const A = 'a'.repeat(40), B = 'b'.repeat(40);
const recorded = (/built from one commit,\s+\[`[0-9a-f]{7,40}`\]\(https:\/\/github\.com\/ThornswoodRP\/skymp\/tree\/([0-9a-f]{40})\)/.exec(CREDITS) || [])[1];
const HAND = /Each server records which commit it runs, and this page names it here once\s+that record can be read\./;

// ---- part one: the pure fill -------------------------------------------------
const cut = /\/\/ ==== thornswood credits fill ====([\s\S]*?)\/\/ ==== end thornswood credits fill ====/.exec(SRC);
yes('server.js has the credits fill between its markers', !!cut);
const fill = cut ? new Function(cut[1] + '\nreturn fillCreditsCommits;')() : function (m) { return m; };
yes('credits.md still has the hand sentence the fill replaces', HAND.test(CREDITS));
const para = (/then to the main server\.[\s\S]*?(?=\n\s*\n)/.exec(CREDITS) || [''])[0];
yes('and the hand text names no commit for either server (#2303)', para.length > 0 && !/[0-9a-f]{7,40}/.test(para));
yes('credits.md names the recorded commit the fill compares with', /^[0-9a-f]{40}$/.test(recorded || ''));
// The channel rows are hand text too (#421): a hash typed into them went stale
// with every Ship, while the page served the feed's.
const rowOf = function (text, ch, feed) {
  return (new RegExp('^\\|\\s*' + ch + '\\s*\\|\\s*`' + feed.replace(/[./]/g, '\\$&') + '`\\s*\\|([^\\n]*)$', 'm').exec(text) || [])[1];
};
const pubRow = rowOf(CREDITS, 'Public', 'feed/version.json'), devRow = rowOf(CREDITS, 'Dev', 'feed-dev/version.json');
yes('credits.md has both channel rows', pubRow !== undefined && devRow !== undefined);
yes('  and neither row names a commit of its own (#421)', !/[0-9a-f]{7,40}/.test((pubRow || '') + (devRow || '')));

yes('no file: the page is the hand text, unchanged', fill(CREDITS, null, {}) === CREDITS);
let one = fill(CREDITS, { live: { commit: A } }, {});
yes('a file with only live: the page names the main server (#2303)', one.indexOf('The main server runs [`aaaaaaaa`](https://github.com/ThornswoodRP/skymp/tree/' + A + ').') >= 0);
yes('  and the hand sentence is gone, with nothing said about the test server', !HAND.test(one) && one.indexOf('test server runs') < 0);
one = fill(CREDITS, { live: { commit: recorded } }, {});
yes('only live, on the recorded commit: it says the main server runs it', one.indexOf('The main server runs it, [`' + recorded.slice(0, 8) + '`]') >= 0);
one = fill(CREDITS, { dev: { commit: B } }, {});
yes('a file with only dev: the page names the test server', one.indexOf('The test server runs [`bbbbbbbb`]') >= 0 && one.indexOf('main server runs') < 0 && !HAND.test(one));
yes('one server whose commit is not 40 hex: unchanged', fill(CREDITS, { live: { commit: 'abc' } }, {}) === CREDITS);
one = fill(CREDITS, { live: { commit: 'zz' + A.slice(2) }, dev: { commit: A } }, {});
yes('a live commit that is not 40 hex beside a good dev one: only dev is said',
  // The bad commit's own text, not any "zz": the page names HarfBuzz since #4823.
  one.indexOf('The test server runs [`aaaaaaaa`]') >= 0 && one.indexOf('main server runs') < 0 && one.indexOf('zz' + A.slice(2, 8)) < 0);
yes('garbage shapes do not throw and change nothing',
  fill(CREDITS, 'nope', 7) === CREDITS && fill(CREDITS, { live: 3, dev: [] }, null) === CREDITS);

let out = fill(CREDITS, { live: { commit: A }, dev: { commit: A } }, {});
yes('both on a new commit: the page names it', out.indexOf('Both servers run [`aaaaaaaa`](https://github.com/ThornswoodRP/skymp/tree/' + A + ')') >= 0);
yes('both on a new commit: the hand sentence is gone', !HAND.test(out));
yes('  and the paragraph after it is untouched', out.indexOf('The six client files are built from the commit named by the feed') >= 0);
yes('both on a new commit: it still says the record is not deployed', out.indexOf('The recorded build has not been deployed yet.') >= 0);

out = fill(CREDITS, { live: { commit: recorded }, dev: { commit: recorded } }, {});
yes('both on the recorded commit: it says both run it, not that it is undeployed',
  out.indexOf('Both servers run it, [`' + recorded.slice(0, 8) + '`]') >= 0 && out.indexOf('has not been deployed yet') < 0);

out = fill(CREDITS, { live: { commit: A }, dev: { commit: recorded } }, {});
yes('dev ahead of live: it names each server',
  out.indexOf('The test server runs [`' + recorded.slice(0, 8) + '`]') >= 0 && out.indexOf('the main server runs [`aaaaaaaa`]') >= 0 &&
  out.indexOf('has not been deployed yet') < 0);

out = fill(CREDITS, null, { public: B, dev: A });
yes('the feeds: the Public row names the public feed commit', /\|\s*Public\s*\|\s*`feed\/version\.json`\s*\|\s*\[`bbbbbbbb`\]\(https:\/\/github\.com\/ThornswoodRP\/skymp\/tree\/b{40}\)/.test(out));
yes('the feeds: the Dev row names the dev feed commit', /\|\s*Dev\s*\|\s*`feed-dev\/version\.json`\s*\|\s*\[`aaaaaaaa`\]/.test(out));
yes('the feeds: the server sentence is left alone', HAND.test(out));
yes('the feeds: each row is still a three cell table row', /\|\s*Public\s*\|\s*`feed\/version\.json`\s*\|\s*\[`bbbbbbbb`\]\([^)]+\)\s*\|\s*$/m.test(out) &&
  /\|\s*Dev\s*\|\s*`feed-dev\/version\.json`\s*\|\s*\[`aaaaaaaa`\]\([^)]+\)\s*\|\s*$/m.test(out));
out = fill(CREDITS.replace(/\n/g, '\r\n'), null, { public: B });
yes('the feeds: a CRLF copy of the page is filled the same', /\|\s*Public\s*\|\s*`feed\/version\.json`\s*\|\s*\[`bbbbbbbb`\]/.test(out));
out = fill(CREDITS, null, { dev: A });
yes('the feeds: only the dev feed read leaves the Public row as hand text',
  /\|\s*Dev\s*\|\s*`feed-dev\/version\.json`\s*\|\s*\[`aaaaaaaa`\]/.test(out) && rowOf(out, 'Public', 'feed/version.json') === pubRow);
out = fill(CREDITS, null, { public: 'not a commit' });
yes('a feed commit that is not hex: the row keeps its hand text', out === CREDITS);
out = fill(CREDITS, { live: { commit: '<img src=x onerror=alert(1)>' }, dev: { commit: A } }, { public: '"><script>' });
yes('markup in either file never reaches the page: only the good dev commit is said',
  out.indexOf('<img') < 0 && out.indexOf('<script>') < 0 && out.indexOf('The test server runs [`aaaaaaaa`]') >= 0 && out.indexOf('main server runs') < 0);
out = fill(CREDITS, { live: { commit: '<img src=x onerror=alert(1)>' } }, { public: '"><script>' });
yes('and with nothing good in either, the page is the hand text', out === CREDITS);

// ---- part two: the server, end to end ----------------------------------------
function freePort() {
  return new Promise(function (ok, no) {
    const s = net.createServer(); s.on('error', no);
    s.listen(0, '127.0.0.1', function () { const p = s.address().port; s.close(function () { ok(p); }); });
  });
}
function get(port, route) {
  return new Promise(function (ok) {
    http.get({ host: '127.0.0.1', port: port, path: route, agent: false }, function (res) {
      let b = ''; res.setEncoding('utf8'); res.on('data', function (d) { b += d; });
      res.on('end', function () { ok({ status: res.statusCode, body: b }); });
    }).on('error', function () { ok({ status: 0, body: '' }); });
  });
}
function wait(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

(async function () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-credits-fill-'));
  let child = null;
  try {
    siteFiles.copy(dir);
    fs.mkdirSync(path.join(dir, 'public'));
    fs.copyFileSync(path.join(APP, 'public', 'home.html'), path.join(dir, 'public', 'home.html'));
    const marked = fs.readdirSync(path.join(APP, 'public')).filter(function (n) { return /^marked-.*\.js$/.test(n); });
    for (const m of marked) fs.copyFileSync(path.join(APP, 'public', m), path.join(dir, 'public', m));
    fs.mkdirSync(path.join(dir, 'data', 'site'), { recursive: true });
    fs.copyFileSync(path.join(APP, 'data', 'site', 'credits.md'), path.join(dir, 'data', 'site', 'credits.md'));
    const port = await freePort();
    let log = '';
    child = spawn(process.execPath, ['server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1', THORNSWOOD_CHAT_DIR: path.join(dir, 'chat') })
    });
    child.stdout.on('data', function (d) { log += d; }); child.stderr.on('data', function (d) { log += d; });
    for (let i = 0; i < 200 && log.indexOf('listening on ') < 0; i++) await wait(50);
    yes('the copy starts', log.indexOf('listening on ') >= 0);

    let r = await get(port, '/credits');
    yes('no deployed-build.json: /credits is 200 with the hand text', r.status === 200 && r.body.indexOf('this page names it here once') >= 0);

    // What the box held on 11 Oct (#2303): live alone.
    fs.writeFileSync(path.join(dir, 'data', 'deployed-build.json'), JSON.stringify({ live: { commit: B } }));
    r = await get(port, '/credits');
    yes('a record with only live: /credits names the main server\'s commit',
      r.status === 200 && r.body.indexOf('The main server runs') >= 0 && r.body.indexOf('tree/' + B) >= 0 && r.body.indexOf('this page names it here once') < 0);

    fs.writeFileSync(path.join(dir, 'data', 'deployed-build.json'), JSON.stringify({ live: { commit: A }, dev: { commit: A } }));
    r = await get(port, '/credits');
    yes('after the file changes, with no hand edit and no restart, /credits names the new commit',
      r.status === 200 && r.body.indexOf('aaaaaaaa') >= 0 && r.body.indexOf('tree/' + A) >= 0 && r.body.indexOf('Both servers run') >= 0);

    fs.mkdirSync(path.join(dir, 'feed', 'version'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'feed', 'version', '00000001.json'), JSON.stringify({ clientRuntime: { forkCommit: B } }));
    r = await get(port, '/credits');
    yes('the public feed it serves fills the Public row', r.body.indexOf('tree/' + B) >= 0);

    fs.writeFileSync(path.join(dir, 'data', 'deployed-build.json'), '{ not json');
    fs.rmSync(path.join(dir, 'feed'), { recursive: true, force: true });
    r = await get(port, '/credits');
    yes('an unreadable file: /credits falls back to the hand text', r.status === 200 && r.body.indexOf('this page names it here once') >= 0 && r.body.indexOf('aaaaaaaa') < 0);
    yes('credits.md on disk was never edited', fs.readFileSync(path.join(dir, 'data', 'site', 'credits.md'), 'utf8') === CREDITS);
  } finally {
    if (child) { try { child.kill(); } catch (e) {} await wait(300); }
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  }
  yes('the temp folder is gone', !fs.existsSync(dir));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
