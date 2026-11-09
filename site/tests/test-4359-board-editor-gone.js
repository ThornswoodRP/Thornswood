'use strict';
/*
  test-4359-board-editor-gone.js

      node .\site\tests\test-4359-board-editor-gone.js

  #4359. The known issues and the roadmap are written from the issue board
  (#3140), and the hub has had no board page since then (BOARDKEYS is empty in
  site/public/hub.js). What was left behind still ran: every hub load had
  /api/all send the four retired boards in site/data/board.json (Active
  Issues, Suggestions, Archive and Patrick's to do), PUT /api/board/<name>
  still saved one, and hub.js still carried the editor that called it.

  A. A scratch site with an admin signed in: /api/all sends no boards and no
     board revisions, and a board save is not taken and writes no file.
  B. The code: site/data/board.json is gone from the repository, and neither
     the site nor the hub names the board file, its save or its route.
  C. The one part of the boards that was still in use, the Patreon words
     Patrick pastes by hand (#998), lives in docs/PATREON.md, word for word.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP.
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
const SITE = path.join(ROOT, 'site', 'server.js');
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\r\n').join('\n'); } catch (e) { return null; } };
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const ADMIN_D = '222222222';

function scratch() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4359-'));
  const secret = crypto.randomBytes(32).toString('hex');
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data', 'for-bot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
    botKey: crypto.randomBytes(24).toString('hex'), admins: [ADMIN_D], secret,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({ [ADMIN_D]: { id: ADMIN_D, name: 'Aela', profiles: [1001] } }));
  return { dir, secret };
}
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
/* Waits for this run's site to say it is listening on its port (#1727). */
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => {
      out += d;
      const mm = /\[thornswood-docs\] listening on \S+:(\d+)/.exec(out);
      if (mm && Number(mm[1]) === port) end(null);
    };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error('the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the site did not say it was listening on ' + port +
                                                ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said);
      srv.stderr.removeListener('data', more);
      srv.removeListener('close', gone);
      if (err) bad(err); else ok();
    }
    srv.stdout.on('data', said);
    srv.stderr.on('data', more);
    srv.on('close', gone);
  });
}
async function start(s) {
  const port = await freePort();
  const srv = spawn(process.execPath, [path.join(s.dir, 'server.js')], {
    cwd: s.dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
  });
  try { await listening(srv, port); }
  catch (e) {
    // A site that never said it was listening may still be running.
    if (srv.exitCode === null && srv.signalCode === null) {
      await new Promise((ok) => { srv.once('exit', ok); srv.kill(); });
    }
    throw e;
  }
  return { port, srv };
}
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers: h, agent: false }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { }
        ok({ status: res.statusCode, j: j || {}, text: buf });
      });
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', () => ok({ status: 0, j: {}, text: '' }));
    if (data) r.write(data);
    r.end();
  });
}
function cookieFor(secret, id, name) {
  const at = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
}

(async function main() {
  // ------------------------------------------------------- A. the site --
  const S = scratch();
  let site = null;
  try {
    site = await start(S);
    const port = site.port;
    const admin = cookieFor(S.secret, ADMIN_D, 'Aela');
    const all = await request(port, 'GET', '/api/all', { cookie: admin });
    yes('A1 /api/all answers the hub (' + all.status + ')', all.status === 200);
    yes('A2 and sends no boards and no board revisions',
        all.status === 200 && !('boards' in all.j) && !('boardRevs' in all.j));
    const put = await request(port, 'PUT', '/api/board/todo',
      { 'content-type': 'application/json', origin: 'http://127.0.0.1:' + port, cookie: admin, 'x-board-rev': '0' },
      { intro: 'a save nobody should be able to make', sections: [] });
    yes('A3 a board save from an admin is not taken (' + put.status + ')', put.status !== 200 && put.status !== 0);
    yes('A4 and no board file is written', !fs.existsSync(path.join(S.dir, 'data', 'board.json')));
  } catch (e) {
    yes('the scratch site ran: ' + e.message, false);
  } finally {
    /* The site has to be gone before its folder is removed (#4359): kill()
       only sends the signal, and on Windows a file the process still holds
       open cannot be deleted, so removing the folder at once threw out of
       this finally and ended the harness with exit 1. Linux deletes open
       files, which is why only the Windows shares went red. */
    if (site && site.srv.exitCode === null && site.srv.signalCode === null) {
      await new Promise((ok) => { site.srv.once('exit', ok); site.srv.kill(); });
    }
    fs.rmSync(S.dir, { recursive: true, force: true });
  }

  // ------------------------------------------------------- B. the code --
  const GONE = ['board.json', 'active.md', 'archive.md', 'suggestions.md', 'todo.md'];
  const left = GONE.filter((f) => fs.existsSync(path.join(ROOT, 'site', 'data', f)));
  yes('B1 the five retired board files are gone from site/data' + (left.length ? ' (still there: ' + left.join(', ') + ')' : ''),
      left.length === 0);
  const src = siteFiles.source();
  yes('B2 the site names no board file, board save or board route',
      !/board\.json/.test(src) && !/writeBoardOne|boardRev|readBoard\b|\bBOARDS\s*[,=)\]}]/.test(src) && !/api\\?\/board\\?\//.test(src));
  const hub = read('site/public/hub.js') || '';
  yes('B3 the hub has no board editor and fetches no board',
      !/saveBoard|\/api\/board\/|boardRevs|S\.boards/.test(hub));

  // --------------------------------------------- C. the words still used --
  const pat = read('docs/PATREON.md') || '';
  yes('C1 docs/PATREON.md holds the page blurb, with what the Patreon pays for',
      /A modded Skyrim roleplay server\. Fewer NPCs, more people who matter\./.test(pat) &&
      /Patreon pays for the server, the domain, and other expenses of keeping it running/.test(pat));
  yes('C2 and the three tiers', /Milk Drinker, \$3/.test(pat) && /Talos Worshiper, \$7/.test(pat) && /Thalmor Boot-Licker, \$15/.test(pat));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
