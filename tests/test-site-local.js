'use strict';
/*
  test-site-local.js

      node .\tests\test-site-local.js

  The site runs on a machine the way site\README.md says it does, the
  README says truly what asks the site for what, and what one process means for
  the door is measured rather than guessed.

  WHY THIS EXISTS. To Do List entry 246: "The public site, the installer host
  and the game's identity door are one process, with one instance, and it is
  production". Before anything moves, its first step: "Add a documented
  one-line local run and a README to site first, with a sample
  config beside it", so that "a change is seen working first". The README had
  the run line but none of the rest: no sample config, no list of what depends
  on the site, no way to see the door answer. And the entry's proof,
  "make a public page route throw on purpose and confirm the identity route
  still answers", had never been run.

  So this starts real copies of server.js and asks them over HTTP.

    With no config.json, what server.js writes for itself is its defaults,
    except the cookie secret, the join pass key and the member password, which
    it makes. The password is printed once on that first start and not on the
    next. config.example.json leaves all three empty, so the sample cannot
    drift from what the code reads.

    With config.example.json as config.json, as the README says, the door check
    the README gives answers 401 with why link, and a ticket signed with the
    copy's own secret gets a yes, because with no bot token every account is
    allowed in.

    With a page made to throw, the door still answers (that throw is caught).
    With a timer behind a page made to throw, the process exits after logging
    so the process manager can start a clean one (#1358). With a page made to
    hold the event loop for 1.5 seconds, the door waits for it. Measured on
    24 September, four runs:
    1,478 to 1,491 ms for /api/play/who while the loop was held, against 3 or
    4 ms with nothing held. That is the half only a separate process fixes.
    When the door is split out of server.js this check fails, and the
    paragraph in the README that says one process is what to change.

  Every copy is in the temp folder: server.js, public\home.html, the three
  written pages it asks for (data\site\rules.md, credits.md, world.md), and
  config.example.json as config.json. Nothing here opens
  site\config.json, which on a machine that has one is that
  machine's own, and nothing asks Discord: the sample is checked for empty
  Discord settings before any copy that reads it is started.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = REPO_DIR;
const APP = path.join(REPO_DIR, 'site');
const CR = String.fromCharCode(13);
// A backslash, built rather than typed, so no tool on the way can eat it.
const BS = String.fromCharCode(92);
// How long the page made to hold the loop holds it, in milliseconds.
const HOLD = 1500;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split(CR).join(''); }
  catch (e) { return null; }
}
function uniq(a) {
  return a.filter(function (x, i) { return a.indexOf(x) === i; });
}
// JSON with every object's keys in order, so two configs compare by content.
function canon(v) {
  if (Array.isArray(v)) { return '[' + v.map(canon).join(',') + ']'; }
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map(function (k) {
      return JSON.stringify(k) + ':' + canon(v[k]);
    }).join(',') + '}';
  }
  return JSON.stringify(v);
}

const readme = read('site/README.md') || '';
const server = siteFiles.source() || '';
const deploy = read('scripts/deploy/Deploy-Docs.ps1') || '';
const sampleText = String(read('site/config.example.json'));
// server.js takes a byte order mark off the front before it parses, so this
// does too. Built rather than typed, like the backslash.
const BOM = String.fromCharCode(65279);
let sample = null;
try { sample = JSON.parse(sampleText.charAt(0) === BOM ? sampleText.slice(1) : sampleText); } catch (e) { sample = null; }

// ------------------------------------------------------------ the sample --
yes('site' + BS + 'config.example.json is there and parses the way server.js reads a config',
    !!sample && typeof sample === 'object' && !Array.isArray(sample));
const S = sample || {};

function readsOf(re) {
  const out = [];
  let m;
  while ((m = re.exec(server)) !== null) { out.push(m[1]); }
  return uniq(out);
}
const top = readsOf(/\bcfg\.([A-Za-z_]\w*)/g);
const disc = readsOf(/\bcfg\.discord\.([A-Za-z_]\w*)/g);
const acc = readsOf(/\bcfg\.access\.([A-Za-z_]\w*)/g);
function missing(keys, obj) {
  return keys.filter(function (k) { return !obj || !Object.prototype.hasOwnProperty.call(obj, k); });
}
yes('server.js reads settings to hold the sample to (' + top.length + ' top level, ' +
    disc.length + ' discord, ' + acc.length + ' access)', top.length >= 8 && disc.length >= 4 && acc.length >= 4);
const noTop = missing(top, S), noDisc = missing(disc, S.discord), noAcc = missing(acc, S.access);
yes('every setting server.js reads is in the sample' +
    (noTop.length + noDisc.length + noAcc.length
      ? ', missing ' + noTop.concat(noDisc.map(function (k) { return 'discord.' + k; }),
                                   noAcc.map(function (k) { return 'access.' + k; })).join(', ')
      : ''),
    noTop.length === 0 && noDisc.length === 0 && noAcc.length === 0);

// Nothing in it is a credential, and nothing in it would make a copy ask
// Discord: the startup check, the role lookups and the sign in all need one of
// these set.
const D = S.discord || {};
const quiet = ['clientId', 'clientSecret', 'botToken', 'guildId', 'invite'].every(function (k) {
  return D[k] === '';
}) && S.botKey === '' && S.secret === '' && Array.isArray(S.admins) && S.admins.length === 0;
yes('every Discord setting, the bot key, the cookie secret and the admin ids are empty in the sample', quiet);
const pw = (/\bpassword: '([^']*)'/.exec(server) || [])[1];
yes('the sample leaves the member password empty, and server.js does not ship a shared one',
    S.password === '' && pw === '' && server.indexOf("password: 'thornswood'") < 0);
yes('Deploy-Docs.ps1 never names the sample, so it stays on the machine',
    deploy.length > 0 && deploy.indexOf('config.example') < 0);
yes('site config template uses .example (same suffix as root config.example.json); .sample is gone',
    read('site/config.example.json') !== null && read('site/config.sample.json') === null);

// ------------------------------------------------------------ the README --
yes('the README tells a copy to take config.example.json as its config.json',
    readme.indexOf('Copy `config.example.json` into the copy as `config.json`') >= 0);
const runPort = (/THORNSWOOD_DOCS_PORT = '(\d+)'; \$env:THORNSWOOD_DOCS_LOCAL = '1'; node server\.js/.exec(readme) || [])[1];
yes('the README has the one line local run, on loopback, port ' + runPort, !!runPort);
const curl = readme.split('\n').filter(function (l) { return /^curl\.exe /.test(l); })[0] || '';
yes('the README gives a curl.exe line that POSTs to /api/play/who on that port',
    !!runPort && / -X POST /.test(curl) && curl.indexOf('http://127.0.0.1:' + runPort + '/api/play/who') >= 0 &&
    curl.indexOf('-d "{}"') >= 0);
yes('and says what it answers: 401 with why link, and that a GET proves nothing',
    readme.indexOf('It answers 401 with `{"ok":false,"why":"link"}`') >= 0 &&
    readme.indexOf('`sign in first`') >= 0);
yes('the README names this harness', readme.indexOf('`tests' + BS + 'test-site-local.js`') >= 0);

// The table of what asks the site for something.
const lines = readme.split('\n');
const headAt = lines.findIndex(function (l) { return /^\|\s*Route\s*\|\s*Method\s*\|\s*Asked by\s*\|\s*$/.test(l); });
yes('the README has a table of routes, methods and who asks', headAt >= 0);
const rows = [];
if (headAt >= 0) {
  for (let i = headAt + 2; i < lines.length && lines[i].indexOf('|') === 0; i++) {
    const cells = lines[i].split('|').slice(1, -1).map(function (s) { return s.trim(); });
    rows.push({
      routes: (cells[0] || '').match(/`\/[^`]*`/g) ? cells[0].match(/`\/[^`]*`/g).map(function (s) { return s.slice(1, -1); }) : [],
      method: cells[1] || '',
      files: uniq(((cells[2] || '').match(new RegExp('(?:tools|game|launcher|installer|bot|voice)' + BS + BS + '[A-Za-z0-9_.' + BS + BS + '-]+', 'g')) || [])
        .map(function (p) { return p.replace(/[.]+$/, ''); })),
      text: cells[2] || ''
    });
  }
}
yes('the table has rows, each with a route and GET or POST (' + rows.length + ' rows)',
    rows.length >= 8 && rows.every(function (r) { return r.routes.length > 0 && /^(GET|POST)$/.test(r.method); }));

// server.js answers a route with a method when the line that tests for it, or
// the one after, tests the method too.
const srvLines = server.split('\n');
function answers(route, method) {
  for (let i = 0; i < srvLines.length; i++) {
    if (srvLines[i].indexOf("=== '" + route + "'") < 0) { continue; }
    if (srvLines.slice(i, i + 2).join('\n').indexOf("req.method === '" + method + "'") >= 0) { return true; }
  }
  return false;
}
const wrong = [];
rows.forEach(function (r) {
  r.routes.forEach(function (route) { if (!answers(route, r.method)) { wrong.push(r.method + ' ' + route); } });
});
yes('every route in the table is one server.js answers, with that method' +
    (wrong.length ? ', not: ' + wrong.join(', ') : ''), rows.length > 0 && wrong.length === 0);

// Who asks. A /dev route is the same path asked under /dev, so the caller names
// the path without it.
const unasked = [];
rows.forEach(function (r) {
  // A route the table says nothing asks any more names no caller, and the
  // check below holds that to the code: /api/play/who.
  if (/^nothing in the repo asks it now/.test(r.text)) { return; }
  if (!r.files.length) { unasked.push(r.routes[0] + ' names no caller'); return; }
  const text = r.files.map(function (f) { return read(f.split(BS).join('/')) || ''; }).join('\n');
  r.files.forEach(function (f) { if (read(f.split(BS).join('/')) === null) { unasked.push(f + ' is not there'); } });
  r.routes.forEach(function (route) {
    const asked = route.replace(/^\/dev\//, '/');
    if (text.indexOf(asked) < 0) { unasked.push(route + ' is not in ' + r.files.join(' or ')); }
  });
});
yes('every caller the table names is there and asks for that route' +
    (unasked.length ? ', not: ' + unasked.join('; ') : ''), rows.length > 0 && unasked.length === 0);

// The one the table says nothing asks. Every folder that could ask it.
function walk(dir, re, out) {
  let list = [];
  try { list = fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }); } catch (e) { return out; }
  list.forEach(function (e) {
    const rel = dir + '/' + e.name;
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__pycache__') { walk(rel, re, out); } }
    else if (re.test(e.name) && !/^test-/.test(e.name)) { out.push(rel); }
  });
  return out;
}
const askers = walk('launcher/app', /\.cs$/, []).concat(
  walk('game/plugins', /\.js$/, []), walk('game/ui', /\.js$/, []),
  walk('voice', /\.js$/, []), walk('bot', /\.py$/, []), ['game/gamemode.js']);
const whoRow = rows.filter(function (r) { return r.routes.indexOf('/api/play/who') >= 0; })[0];
const whoCallers = askers.filter(function (f) { return (read(f) || '').indexOf('/api/play/who') >= 0; });
yes('the table says nothing asks /api/play/who, and nothing in ' + askers.length + ' files does' +
    (whoCallers.length ? ', but ' + whoCallers.join(', ') + ' does' : ''),
    !!whoRow && /^nothing in the repo asks it now/.test(whoRow.text) && askers.length > 20 && whoCallers.length === 0);

// /api/payload went with the old setup program (#4824): not answered, not in
// the table, and nothing asks it.
const payloadRow = rows.filter(function (r) { return r.routes.indexOf('/api/payload') >= 0; })[0];
const payloadCallers = askers.filter(function (f) { return (read(f) || '').indexOf('/api/payload') >= 0; });
yes('/api/payload is gone from server.js and the table, and nothing asks it' +
    (payloadCallers.length ? ', but ' + payloadCallers.join(', ') + ' does' : ''),
    !payloadRow && !answers('/api/payload', 'GET') && payloadCallers.length === 0);

// Nothing the launcher or a key holder asks can be left out of the table.
const inTable = [].concat.apply([], rows.map(function (r) { return r.routes; }));
const play = readsOf(/=== '(\/api\/play\/[a-z]+)'/g);
const keyed = [];
srvLines.forEach(function (l, i) {
  if (l.indexOf('if (!cfg.botKey)') < 0) { return; }
  const m = /=== '(\/[^']+)'/.exec(srvLines.slice(Math.max(0, i - 2), i).join('\n'));
  if (m) { keyed.push(m[1]); }
});
const left = uniq(play.concat(keyed)).filter(function (r) { return inTable.indexOf(r) < 0; });
yes('every /api/play/ route and every route behind the bot key is in the table (' +
    play.length + ' and ' + keyed.length + ')' + (left.length ? ', missing ' + left.join(', ') : ''),
    play.length >= 6 && keyed.length >= 3 && left.length === 0);

const grace = (/const int GraceHours = (\d+);/.exec(read('launcher/app/Door.cs') || '') || [])[1];
yes('the grace the README gives, ' + grace + ' hours, is GraceHours in Door.cs',
    !!grace && new RegExp('a yes from the last ' + grace + '\\s+hours').test(readme));

// The README tells whoever runs -Password what happens to the VPS config.json,
// the one file there holding the Discord settings, the bot's key and the cookie
// secret, so it has to say what the script does. The script reads the file,
// sets the password and writes the rest back, and leaves a file that will not
// parse alone. If that changes, this fails and the -Password sentence in the
// README is what to change. tests\test-docs-password.ps1 runs the script itself.
// The read, the set and the write are SiteConfigSet.ps1, which Deploy-Docs
// shares with Rotate-ServerPassword (#2317).
const configSet = read('scripts/deploy/SiteConfigSet.ps1') || '';
yes('Deploy-Docs.ps1 -Password sets the password in the config.json it read, and the README says so',
    deploy.indexOf("Get-ThornswoodSiteConfigSet -ConfigPath \"$rootWin\\config.json\" -Key 'password'") >= 0 &&
    configSet.indexOf("`$cfg['$Key'] = `$pw") >= 0 &&
    configSet.indexOf('WILL NOT READ AS JSON. Nothing written') >= 0 &&
    deploy.indexOf('$json = (@{ password = $Password }') < 0 &&
    /`-Password` reads the `config\.json`\s+on the VPS, changes the member password in it and keeps every other setting/.test(readme) &&
    /will not read as JSON, an empty one included, is\s+left exactly as it is and the password is not changed/.test(readme) &&
    readme.indexOf('holding the password and nothing else') < 0);
yes('the README names the harness that runs -Password, and it is there',
    readme.indexOf('tests' + BS + 'test-docs-password.ps1') >= 0 &&
    read('tests/test-docs-password.ps1') !== null);
yes('the README says the site is one node process', /one\s+node process/.test(readme));

// ------------------------------------------------------------- the copies --
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
const made = [];
function copy(tag, withConfig, patch) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-site-' + tag + '-'));
  made.push(dir);
  // server.js and its modules (#5357), with patch run over each file's text:
  // the anchor it changes is in one of them.
  siteFiles.copy(dir, null, patch ? function (src) { return patch(src); } : null);
  fs.mkdirSync(path.join(dir, 'public'));
  fs.copyFileSync(path.join(APP, 'public', 'home.html'), path.join(dir, 'public', 'home.html'));
  // The written pages the copy serves. Since #1585 a written page with no
  // file behind it answers 404 rather than a 200 saying it does not exist
  // yet, so /rules, /credits and /world need their markdown to be pages.
  fs.mkdirSync(path.join(dir, 'data', 'site'), { recursive: true });
  for (const md of ['rules.md', 'credits.md', 'world.md']) {
    fs.copyFileSync(path.join(APP, 'data', 'site', md), path.join(dir, 'data', 'site', md));
  }
  if (withConfig) { fs.copyFileSync(path.join(APP, 'config.example.json'), path.join(dir, 'config.json')); }
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
function ask(port, method, route, body, extra) {
  return new Promise(function (ok) {
    const t0 = Date.now();
    const data = body === undefined ? null : Buffer.from(body);
    const req = http.request({
      host: '127.0.0.1', port: port, method: method, path: route, agent: false,
      headers: Object.assign({},
        data ? { 'content-type': 'application/json', 'content-length': data.length } : {},
        extra || {})
    }, function (res) {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { buf += d; });
      res.on('end', function () {
        let json = null;
        try { json = JSON.parse(buf); } catch (e) { json = null; }
        ok({ status: res.statusCode, type: String(res.headers['content-type'] || ''), headers: res.headers, json: json, ms: Date.now() - t0 });
      });
    });
    req.on('error', function (e) { ok({ status: 0, error: e.message, json: null, ms: Date.now() - t0 }); });
    req.setTimeout(10000, function () { req.destroy(new Error('no answer in ten seconds')); });
    if (data) { req.write(data); }
    req.end();
  });
}
function linkOnly(r) { return r.status === 401 && !!r.json && r.json.ok === false && r.json.why === 'link'; }
// The launcher's ticket, made the way server.js makes it, with the copy's secret.
function ticket(secret, id, name) {
  const body = Buffer.from(JSON.stringify({ d: String(id), n: String(name), x: Date.now() + 3600000 })).toString('base64url');
  return 'tk1.' + body + '.' + crypto.createHmac('sha256', secret).update('ticket:' + body).digest('hex').slice(0, 32);
}
function said(run) {
  console.log('      what the copy said:');
  run.out.split('\n').slice(-12).forEach(function (l) { if (l.trim()) { console.log('        ' + l.trim()); } });
}

// The checkout's own config.json, by its size and time only. It is never
// opened here; this is only to show it was not touched.
const theirs = path.join(APP, 'config.json');
function stamp() {
  try { const s = fs.statSync(theirs); return s.size + '/' + s.mtimeMs; } catch (e) { return 'none'; }
}
const before = stamp();

// Where a copy writes, the page made to throw and the page made to hold go in.
const ANCHOR = "  if (req.method === 'GET' && PUBLIC_PAGES.indexOf(route) >= 0) {";
const anchors = server.split(ANCHOR).length - 1;
function breakPages(src) {
  return src.replace(ANCHOR, ANCHOR + '\n' + [
    '    // Put here by test-site-local.js, in a copy in the temp folder only.',
    "    if (route === '/rules') { throw new Error('test-site-local: a page made to throw'); }",
    "    if (route === '/world') { setTimeout(function () { throw new Error('test-site-local: a timer made to throw'); }, 0); }",
    "    if (route === '/credits') {",
    "      fs.writeFileSync(path.join(ROOT, 'holding'), String(Date.now()));",
    '      const until = Date.now() + ' + HOLD + ';',
    '      while (Date.now() < until) { }',
    '    }'
  ].join('\n'));
}

(async function () {
  const runs = [];
  try {
    // ----------------------------------------------- no config.json at all
    const dA = copy('defaults', false);
    const a = await start(dA);
    runs.push(a);
    yes('a copy with no config.json comes up on 127.0.0.1 only', a.up && a.out.indexOf('listening on 127.0.0.1:' + a.port) >= 0);
    if (!a.up) { said(a); }
    let wrote = null;
    try { wrote = JSON.parse(fs.readFileSync(path.join(dA, 'config.json'), 'utf8')); } catch (e) { wrote = null; }
    yes('and writes its own config.json, with a cookie secret it made',
        !!wrote && typeof wrote.secret === 'string' && wrote.secret.length >= 32);
    // Since #937 server.js makes the join pass key the same way, once, on a
    // first start, so the sample leaves it empty like the cookie secret.
    yes('and a join pass key it made',
        !!wrote && typeof wrote.passKey === 'string' && wrote.passKey.length >= 32);
    if (wrote && sample) {
      const bare = Object.assign({}, wrote, { secret: '', passKey: '', password: '' });
      const off = uniq(Object.keys(bare).concat(Object.keys(sample))).filter(function (k) {
        return canon(bare[k]) !== canon(sample[k]);
      });
      yes('config.example.json is exactly those defaults with the cookie secret, pass key and member password left empty' +
          (off.length ? ', differs in ' + off.join(', ') : ''), off.length === 0);
    } else {
      yes('config.example.json is exactly those defaults with the cookie secret, pass key and member password left empty', false);
    }
    const freshPw = wrote && typeof wrote.password === 'string' ? wrote.password : '';
    yes('a fresh config gets a random member password, printed once, not a shared one',
        freshPw.length >= 32 && freshPw !== 'thornswood' &&
        JSON.stringify(wrote).indexOf('thornswood') < 0 &&
        a.out.split(freshPw).length - 1 === 1);
    const loginMax = Number((/\bLOGIN_MAX = (\d+)/.exec(server) || [])[1]);
    yes('POST /api/login has a small fixed attempt cap', loginMax >= 3 && loginMax <= 20);
    if (a.up && loginMax && freshPw) {
      const hdr = { 'x-forwarded-for': '203.0.113.10' };
      const wrong = [];
      for (let i = 0; i < loginMax; i++) {
        wrong.push(await ask(a.port, 'POST', '/api/login',
          JSON.stringify({ password: 'not-the-password' }), hdr));
      }
      yes('wrong passwords from one address are refused, up to the limit (' +
          wrong.map(function (r) { return r.status; }).join(',') + ')',
          wrong.length === loginMax && wrong.every(function (r) { return r.status === 401; }));
      const blocked = await ask(a.port, 'POST', '/api/login',
        JSON.stringify({ password: 'not-the-password' }), hdr);
      yes('the next attempt from that address is limited (' + blocked.status + ')',
          blocked.status === 429 && Number(blocked.headers['retry-after']) > 0);
      const longer = await ask(a.port, 'POST', '/api/login',
        JSON.stringify({ password: 'not-the-password' }), hdr);
      yes('a further guess from that address waits longer (' +
          (blocked.headers && blocked.headers['retry-after']) + ', ' +
          (longer.headers && longer.headers['retry-after']) + ')',
          longer.status === 429 &&
          Number(longer.headers['retry-after']) > Number(blocked.headers['retry-after']));
      const other = await ask(a.port, 'POST', '/api/login',
        JSON.stringify({ password: 'not-the-password' }), { 'x-forwarded-for': '203.0.113.11' });
      yes('a different address is not limited by that (' + other.status + ')', other.status === 401);
      const page = await ask(a.port, 'GET', '/rules', undefined, hdr);
      yes('the login limit does not apply to other routes (' + page.status + ')', page.status === 200);
      const signed = await ask(a.port, 'POST', '/api/login',
        JSON.stringify({ password: freshPw }), { 'x-forwarded-for': '203.0.113.12' });
      yes('the generated password signs in from an address under the limit (' + signed.status + ')',
          signed.status === 200 && !!signed.json && signed.json.ok === true);
    }
    await stop(a);
    const a2 = await start(dA);
    runs.push(a2);
    yes('a second start does not print the member password',
        a2.up && a2.out.indexOf(freshPw) < 0 && a2.out.indexOf('shown once') < 0);
    let again = null;
    try { again = JSON.parse(fs.readFileSync(path.join(dA, 'config.json'), 'utf8')); } catch (e) { again = null; }
    yes('and keeps the same password on disk', !!again && again.password === freshPw && freshPw.length >= 32);
    await stop(a2);

    const dLegacy = copy('legacy', false);
    const legacyPw = 'thornswood';
    fs.writeFileSync(path.join(dLegacy, 'config.json'), JSON.stringify({
      password: legacyPw,
      secret: crypto.randomBytes(32).toString('hex'),
      passKey: crypto.randomBytes(32).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' }
    }, null, 2));
    const leg = await start(dLegacy);
    runs.push(leg);
    let legCfg = null;
    try { legCfg = JSON.parse(fs.readFileSync(path.join(dLegacy, 'config.json'), 'utf8')); } catch (e) { legCfg = null; }
    yes('a config that already has a password is left as it is and not printed again',
        leg.up && !!legCfg && legCfg.password === legacyPw && leg.out.indexOf('shown once') < 0);
    const legIn = await ask(leg.port, 'POST', '/api/login',
      JSON.stringify({ password: legacyPw }), { 'x-forwarded-for': '203.0.113.20' });
    yes('that existing password still signs in (' + legIn.status + ')',
        legIn.status === 200 && !!legIn.json && legIn.json.ok === true);
    await stop(leg);

    if (!quiet) {
      console.log('SKIP  the copies that read the sample were not started: it is missing, or holds a Discord setting or a secret');
      yes('the sample is safe to start a copy on', false);
    } else {
      // ------------------------------------------------ the README's run
      const dB = copy('readme', true);
      const b = await start(dB);
      runs.push(b);
      yes('the README run, config.example.json as config.json, comes up on 127.0.0.1 only',
          b.up && b.out.indexOf('listening on 127.0.0.1:' + b.port) >= 0);
      if (!b.up) { said(b); }
      // Said a few lines after the listening line, which can arrive on its own.
      await until(function () { return b.out.indexOf('discord login ') >= 0; }, 5000);
      yes('and says it will not ask Discord', b.out.indexOf('discord login NOT SET UP, guild check OFF') >= 0);

      const who0 = await ask(b.port, 'POST', '/api/play/who', '{}');
      yes('the README check: POST /api/play/who with {} answers 401 why link (' + who0.status + ')', linkOnly(who0));
      const whoGet = await ask(b.port, 'GET', '/api/play/who');
      yes('a GET answers 401 from the sign in gate instead, as the README says (' + whoGet.status + ')',
          whoGet.status === 401 && !!whoGet.json && whoGet.json.error === 'sign in first');
      const join0 = await ask(b.port, 'POST', '/api/play/join', '{}');
      yes('POST /api/play/join with no ticket answers 401 why link (' + join0.status + ')', linkOnly(join0));
      const rules = await ask(b.port, 'GET', '/rules');
      yes('a public page, /rules, answers 200 as HTML (' + rules.status + ')',
          rules.status === 200 && /text\/html/.test(rules.type));

      let secret = '';
      try { secret = String(JSON.parse(fs.readFileSync(path.join(dB, 'config.json'), 'utf8')).secret || ''); }
      catch (e) { secret = ''; }
      yes('the copy wrote a secret into its own config.json', secret.length >= 32);
      const who1 = await ask(b.port, 'POST', '/api/play/who', JSON.stringify({ ticket: ticket(secret, '123456789', 'Local Tester') }));
      yes('with no bot token, a ticket signed with that secret gets a 200 yes (' + who1.status + ')',
          who1.status === 200 && !!who1.json && who1.json.ok === true && who1.json.id === '123456789' &&
          who1.json.name === 'Local Tester');
      await stop(b);

      // --------------------------------------------- pages made to break
      yes('server.js has the public page route this puts the breakage in, once', anchors === 1);
      const dC = copy('blast', true, breakPages);
      const c = await start(dC);
      runs.push(c);
      yes('a copy with pages made to break comes up', c.up);
      if (!c.up) { said(c); }

      const first = await ask(c.port, 'POST', '/api/play/who', '{}');
      yes('its door answers 401 before anything breaks', linkOnly(first));
      const thrown = await ask(c.port, 'GET', '/rules');
      yes('a page made to throw answers 500 (' + thrown.status + ')', thrown.status === 500);
      const afterThrow = await ask(c.port, 'POST', '/api/play/who', '{}');
      yes('and the door still answers its 401 after it', linkOnly(afterThrow));

      const home = await ask(c.port, 'GET', '/');
      yes('the home page sent Content-Security-Policy with frame-ancestors self',
          home.status === 200 && String((home.headers && home.headers['content-security-policy']) || '').indexOf("frame-ancestors 'self'") >= 0);
      yes('the home page sent Referrer-Policy strict-origin-when-cross-origin',
          String((home.headers && home.headers['referrer-policy']) || '') === 'strict-origin-when-cross-origin');

      const quick = await ask(c.port, 'POST', '/api/play/who', '{}');
      const holding = path.join(dC, 'holding');
      const credits = ask(c.port, 'GET', '/credits');
      const began = await until(function () { return fs.existsSync(holding); }, 5000);
      const held = await ask(c.port, 'POST', '/api/play/who', '{}');
      const heldPage = await credits;
      yes('the page made to hold the loop began holding it', began && heldPage.status === 200);
      yes('and held the door with it: /api/play/who took ' + held.ms + ' ms while it held, ' + quick.ms +
          ' ms with nothing held. One process cannot keep these apart; a door of its own would',
          linkOnly(held) && linkOnly(quick) && quick.ms < 500 && held.ms >= HOLD - 500);
      yes('and the process that started is the one still answering', !c.exited);

      // After the hold proof, an uncaught timer throw must exit (#1358).
      const world = await ask(c.port, 'GET', '/world');
      yes('the page that arms a timer throw still answers 200 first', world.status === 200);
      await until(function () { return c.exited; }, 5000);
      yes('a timer behind a page that throws exits so the manager can restart', c.exited);
      let log = '';
      try { log = fs.readFileSync(path.join(dC, 'site.log'), 'utf8'); } catch (e) { log = ''; }
      yes("the copy's site.log says the handler threw and the uncaught exit",
          log.indexOf('handler threw on "/rules"') >= 0 && log.indexOf('uncaught exception, exiting') >= 0);
      await stop(c);
    }

    yes("the checkout's own config.json, if this machine has one, was not touched", stamp() === before);
  } catch (e) {
    yes('the run finished without throwing: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    for (const r of runs) { await stop(r); }
    for (const d of made) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { }
    }
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
