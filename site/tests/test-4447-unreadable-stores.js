'use strict';
/*
  test-4447-unreadable-stores.js

      node .\site\tests\test-4447-unreadable-stores.js

  Issue #4447. putFile (lib/store.js) refused to write over a file that is
  there but will not read only for the five files heldShape names (bans,
  pk, linked, sessions, sign-in attempts, #2180). Every other store is read
  through jsonFile, which hands back the empty fallback for a file that will
  not parse, and was then written back through putJson as that fallback
  plus one row: a cut-short inbox.json lost every ticket and report at the
  next help request.

  1. A real copy of the site in a scratch folder on a spare port, its
     for-bot/inbox.json cut short with two rows in it. A help request from
     the game (/api/report/game, with the door's key) is refused with a 500,
     inbox.json is left byte for byte, and the site's log names the file.
  2. inbox.json mended: the next request is taken, and both earlier rows are
     still there beside the new one. inbox.json taken away: the request is
     taken and the file is made, as on a new box.
  3. putJson itself, from the same scratch copy, on two stores heldShape
     does not name (notes.json and the gallery list): a file that will not
     parse, and one that is empty, are not written over; a missing one is
     written; a good one is replaced whole.

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
const SITE = path.join(ROOT, 'site', 'server.js');
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 400).split('\n').join('\n      ') : '')); }
}

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
function post(port, where, headers, body) {
  return new Promise((ok) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: where, agent: false,
      headers: Object.assign({ 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }, headers) }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => ok({ status: res.statusCode, text: buf }));
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', (e) => ok({ status: 0, text: String(e) }));
    r.end(data);
  });
}
const rows = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } };

(async function main() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4447-'));
  let srv = null;
  let log = '';
  try {
    const KEY = crypto.randomBytes(24).toString('hex');
    siteFiles.copy(dir, SITE);
    const DATA = path.join(dir, 'data'), FOR_BOT = path.join(DATA, 'for-bot');
    fs.mkdirSync(FOR_BOT, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: crypto.randomBytes(12).toString('hex'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
      botKey: KEY, admins: ['222222222'],
      secret: crypto.randomBytes(32).toString('hex'),
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
    }, null, 2));

    // Two rows, then the file stops where a crash part way through a write
    // would have left it. Sent a minute ago, so the inbox's keeping time
    // (trimInbox) keeps them.
    const INBOX = path.join(FOR_BOT, 'inbox.json');
    const sent = Date.now() - 60000;
    const whole = JSON.stringify([
      { id: 'iold1', kind: 'ticket', title: 'an application from before', at: sent, state: 'new' },
      { id: 'iold2', kind: 'report', title: 'a report from before', at: sent + 1000, state: 'new' }
    ], null, 2);
    const cut = whole.slice(0, whole.length - 40);
    fs.writeFileSync(INBOX, cut);

    const port = await freePort();
    srv = spawn(process.execPath, [path.join(dir, 'server.js')], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
      env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
    });
    srv.stdout.on('data', (d) => { log += d; });
    srv.stderr.on('data', (d) => { log += d; });
    await listening(srv, port);
    const K = { 'x-thornswood-key': KEY };
    const help = (pid, said) => post(port, '/api/report/game', K, { kind: 'help', profileId: pid, name: 'Aela', said });

    console.log('1. inbox.json cut short:');
    const before = log.length;
    let r = await help(5, 'stuck in a wall');
    yes('a help request is refused rather than saved (' + r.status + ')', r.status === 500, r.text);
    yes('inbox.json is left byte for byte, both earlier rows still there to repair',
        fs.readFileSync(INBOX, 'utf8') === cut);
    const said = log.slice(before);
    yes('the site says on its log that inbox.json will not read and was not written',
        /inbox\.json/.test(said) && /not written|left as it is|will not read/i.test(said), said);
    yes('and no temp copy of it is left beside it',
        fs.readdirSync(FOR_BOT).filter((n) => /\.tmp$/.test(n)).length === 0);

    console.log('\n2. inbox.json mended, then gone:');
    fs.writeFileSync(INBOX, whole);
    r = await help(6, 'mended now');
    let got = rows(INBOX);
    yes('the next request is taken (' + r.status + ')', r.status === 200, r.text);
    yes('and both earlier rows are still there beside the new one',
        Array.isArray(got) && got.length === 3 && got.some((x) => x.id === 'iold1') && got.some((x) => x.id === 'iold2') &&
        got.some((x) => x.title === 'mended now'), JSON.stringify(got));
    fs.rmSync(INBOX);
    r = await help(7, 'a new box');
    got = rows(INBOX);
    yes('with no inbox.json at all, the request is taken and the file made (' + r.status + ')',
        r.status === 200 && Array.isArray(got) && got.length === 1 && got[0].title === 'a new box', JSON.stringify(got));

    srv.kill();
    srv = null;

    console.log('\n3. putJson on stores heldShape does not name:');
    // The scratch copy's own modules, so nothing here reads or writes the
    // repository's site folder.
    const store = require(path.join(dir, 'lib', 'store.js'));
    const errs = [];
    const was = console.error;
    console.error = function () { errs.push(Array.prototype.join.call(arguments, ' ')); };
    try {
      for (const name of ['notes.json', 'gallery.json']) {
        const p = path.join(DATA, name);
        for (const [what, text] of [['will not parse', '{"a": {"why": "kept"'], ['is empty', '']]) {
          fs.writeFileSync(p, text);
          errs.length = 0;
          const ok = store.putJson(p, { only: 'the new row' });
          yes(name + ' that ' + what + ': putJson says false and leaves it as it was',
              ok === false && fs.readFileSync(p, 'utf8') === text);
          yes('  and says so on the log, naming it', errs.some((l) => l.indexOf(name) >= 0), errs.join('\n'));
        }
        fs.rmSync(p);
        yes(name + ' not there yet: putJson writes it', store.putJson(p, { first: 1 }) === true && JSON.stringify(rows(p)) === '{"first":1}');
        yes(name + ' that reads: putJson replaces it whole', store.putJson(p, { second: 2 }) === true && JSON.stringify(rows(p)) === '{"second":2}');
      }
    } finally {
      console.error = was;
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
