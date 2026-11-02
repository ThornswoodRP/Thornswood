'use strict';
/*
  test-home-html.js

      node .\site\tests\test-home-html.js

  Issue #997. site/public/home.html is the template the front route fills in.
  The static route was handing that file out at /home.html as it sits on disk:
  the Apply links still say DISCORD_URL, and both the alpha wording and the
  open wording are in the same page. Nothing links there, but a guess finds it.

  GET /home.html (and HEAD, and the same path with a trailing slash or a
  different case) answers 301 to /, the same kind of redirect /download uses.
  The body of that answer is not the raw file. The front page, which is where
  it lands, still replaces DISCORD_URL and keeps only the alpha wording while
  the open switch is off.

  A copy of server.js in a temp folder. It does not read this machine's
  config.json, and it does not talk to the VPS or to Discord.
*/
const fs = require('fs');
const path = require('path');
const siteFiles = require('../../tests/site-files');
const os = require('os');
const net = require('net');
const http = require('http');
const { spawn } = require('child_process');

const APP = path.join(__dirname, '..', '..', 'site');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-home-html-'));
let srv = null;
let started = false;
let finished = false;
function clean() { try { fs.rmSync(work, { recursive: true, force: true }); } catch (e) { } }
function stop() {
  if (!srv) { clean(); return; }
  const s = srv;
  srv = null;
  s.once('exit', clean);
  try { s.kill(); } catch (e) { clean(); }
}
function done() {
  if (finished) return;
  finished = true;
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (!started) process.exit(fail ? 1 : 0);
  process.exitCode = fail ? 1 : 0;
  stop();
}
process.on('exit', function () {
  if (srv) { try { srv.kill(); } catch (e) { } }
});

function copy(rel) {
  const to = path.join(work, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(APP, rel), to);
}

const rawHome = fs.readFileSync(path.join(APP, 'public', 'home.html'), 'utf8').split(CR).join('');
yes('the template on disk still has the DISCORD_URL placeholder', rawHome.indexOf('DISCORD_URL') >= 0);
yes('the template on disk still has both the alpha wording and the open wording',
    rawHome.indexOf('Alpha, eighteen and over.') >= 0 &&
    rawHome.indexOf('Open, eighteen and over.') >= 0);

siteFiles.copy(work);
copy(path.join('public', 'home.html'));
copy(path.join('public', 'fonts.css'));
// Fixed test values so a fresh config does not invent a password and print it.
fs.writeFileSync(path.join(work, 'config.json'), JSON.stringify({
  secret: 'home-html-test-secret',
  password: 'home-html-test-password',
  passKey: 'home-html-test-pass',
  gameCheckPort: 1,
  open: false,
  onlineFile: path.join(work, 'online.json')
}));

function freePort() {
  return new Promise(function (resolve, reject) {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', function () {
      const p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

/*
  Waits for the site's own "[thornswood-docs] listening on ...:port" line, so
  nothing is asked of the port before this run's site holds it (#1727). The
  port came from the system and was let go again, and builds run side by side
  on the VPS: if something takes it in between, the site stops on EADDRINUSE,
  and polling the port would have read whatever holds it as this site. The
  error says which, with what the site printed.
*/
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const m = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (m && Number(m[1]) === port) { end(null); }
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}

function raw(port, reqPath, method) {
  return new Promise(function (resolve) {
    const r = http.request({
      host: '127.0.0.1', port: port, path: reqPath, method: method || 'GET'
    }, function (res) {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', function (d) { text += d; });
      res.on('end', function () {
        resolve({ status: res.statusCode, where: res.headers.location || '', text: text });
      });
    });
    r.on('error', function (e) { resolve({ status: 0, where: '', text: String(e.message) }); });
    r.end();
  });
}

function bothWordings(text) {
  return text.indexOf('Alpha, eighteen and over.') >= 0 &&
         text.indexOf('Open, eighteen and over.') >= 0;
}

(async function () {
  const watchdog = setTimeout(function () {
    yes('the scratch server answered inside 20 seconds', false);
    done();
  }, 20000);

  const port = await freePort();
  let log = '';
  srv = spawn(process.execPath, ['server.js'], {
    cwd: work,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_LOCAL: '1',
      THORNSWOOD_DOCS_PORT: String(port)
    })
  });
  started = true;
  srv.stdout.on('data', function (d) { log += d; });
  srv.stderr.on('data', function (d) { log += d; });
  let up = false;
  try { await listening(srv, port); up = true; } catch (e) { log = e.message; }
  clearTimeout(watchdog);
  yes('a copy of server.js came up on 127.0.0.1', up);
  if (!up) {
    const safe = log.split('\n').filter(function (line) {
      return line.toLowerCase().indexOf('password') < 0;
    }).join('\n');
    console.log(safe);
    done();
    return;
  }
  yes('startup did not print a bootstrap password', log.indexOf('shown once') < 0);

  const home = await raw(port, '/home.html');
  yes('GET /home.html is a 301 to / (was ' + home.status + ' ' + home.where + ')',
      home.status === 301 && home.where === '/');
  yes('that answer is not the raw template',
      home.text.indexOf('DISCORD_URL') < 0 && !bothWordings(home.text));

  const head = await raw(port, '/home.html', 'HEAD');
  yes('HEAD /home.html is the same 301', head.status === 301 && head.where === '/');

  const slash = await raw(port, '/home.html/');
  yes('GET /home.html/ is a 301 to /', slash.status === 301 && slash.where === '/');

  const upper = await raw(port, '/Home.HTML');
  yes('GET /Home.HTML is a 301 to /', upper.status === 301 && upper.where === '/');

  const queried = await raw(port, '/home.html?from=old');
  yes('GET /home.html?from=old is a 301 to /', queried.status === 301 && queried.where === '/');

  const css = await raw(port, '/fonts.css');
  yes('a real file in public/ is still served', css.status === 200 && css.text.length > 0);

  const front = await raw(port, '/');
  yes('GET / is the filled front page', front.status === 200 && front.text.indexOf('<div id="landing">') >= 0);
  yes('the front page does not leave DISCORD_URL in the links', front.text.indexOf('DISCORD_URL') < 0);
  yes('the front page, with the switch off, keeps the alpha wording only',
      front.text.indexOf('Alpha, eighteen and over.') >= 0 &&
      front.text.indexOf('Open, eighteen and over.') < 0);

  done();
})().catch(function (e) {
  yes('the harness ran without throwing: ' + (e && e.message), false);
  done();
});
