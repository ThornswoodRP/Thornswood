'use strict';
/*
  test-2188-board-revision.js

      node .\site\tests\test-2188-board-revision.js

  #2188. Two people saving the same staff board used to overwrite each other
  silently: last save won. Every board now has a revision in board.json
  (_rev), /api/all hands it to the hub as boardRevs, the hub sends it back in
  X-Board-Rev, and a save made from an older copy is refused 409 with a
  sentence saying to reload.

  A. A scratch site with an admin signed in:
     two saves of one board sent at the same moment from the same revision:
     exactly one lands, the other is 409 with the message, and board.json
     holds the one that landed. The refused one, reloaded, then saves. A
     save with no revision is 428. Two boards saved at once both land. The
     public roadmap does not carry _rev. Ten saves at once: exactly one lands.
  B. The hub's own save code (site/public/hub.js) run against a stand-in api:
     a second edit made while a save is out waits for it and goes with the
     new revision, so one person never clashes with themselves; a 409 is
     said in words and not retried.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const vm = require('vm');
const siteFiles = require('../../tests/site-files');

const ROOT = path.join(__dirname, '..', '..');
const SITE = path.join(ROOT, 'site', 'server.js');
const HUB = fs.readFileSync(path.join(ROOT, 'site', 'public', 'hub.js'), 'utf8').split('\r\n').join('\n');
let pass = 0, fail = 0;
function yes(what, cond) { if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); } }

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const ADMIN_D = '222222222';
function scratch() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-2188-'));
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
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
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
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  await listening(srv, port);
  return { port, srv };
}
/* Exactly the headers given, and nothing a browser would add on its own. */
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? null : (Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    const h = Object.assign({}, headers || {});
    if (data) h['content-length'] = data.length;
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers: h, agent: false }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { }
        ok({ status: res.statusCode, j: j || {}, text: buf, headers: res.headers });
      });
    });
    r.setTimeout(15000, () => r.destroy());
    r.on('error', () => ok({ status: 0, j: {}, text: '', headers: {} }));
    if (data) r.write(data);
    r.end();
  });
}
function cookieFor(secret, id, name) {
  const at = String(Date.now());
  const sig = crypto.createHmac('sha256', secret).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
}

const boardFile = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'board.json'), 'utf8')); } catch (e) { return null; } };
const board = (who) => ({ intro: '', sections: [{ id: 's1', title: 'Open', columns: ['What'], rows: [{ id: 'r1', cells: [who] }] }] });

(async function main() {
  const S = scratch();
  let site = null;
  try {
    site = await start(S);
    const port = site.port;
    const OWN = 'http://127.0.0.1:' + port;
    const admin = cookieFor(S.secret, ADMIN_D, 'Aela');
    const h = (rev) => Object.assign({ 'content-type': 'application/json', origin: OWN, cookie: admin }, rev === undefined ? {} : { 'x-board-rev': String(rev) });
    const all = () => request(port, 'GET', '/api/all', { cookie: admin });

    console.log('A. the site:');
    let a = await all();
    yes('A1 /api/all hands the hub a revision per board, 0 for a board never saved', a.status === 200 && a.j.boardRevs && a.j.boardRevs.todo === 0);

    const [p1, p2] = await Promise.all([
      request(port, 'PUT', '/api/board/todo', h(0), board('Aela, first tab')),
      request(port, 'PUT', '/api/board/todo', h(0), board('Aela, second tab')),
    ]);
    const won = [p1, p2].filter((r) => r.status === 200), lost = [p1, p2].filter((r) => r.status === 409);
    yes('A2 two saves from the same revision at the same moment: exactly one lands', won.length === 1 && lost.length === 1);
    yes('A3 the one that landed is told the new revision, 1', won[0] && won[0].j.ok === true && won[0].j.rev === 1);
    yes('A4 the other is refused 409 with a sentence saying to reload: ' + (lost[0] && lost[0].j.message),
        lost[0] && lost[0].j.error === 'conflict' && /Somebody else saved this board/.test(lost[0].j.message) && /Reload/.test(lost[0].j.message) && lost[0].j.rev === 1);
    const winner = won[0] === p1 ? 'Aela, first tab' : 'Aela, second tab';
    let bf = boardFile(S.dir);
    yes('A5 board.json holds the save that landed, not the refused one', bf && bf.todo.sections[0].rows[0].cells[0] === winner && bf._rev.todo === 1);

    a = await all();
    yes('A6 a reload hands back the new revision and the saved board', a.j.boardRevs.todo === 1 && a.j.boards.todo.sections[0].rows[0].cells[0] === winner);
    const again = await request(port, 'PUT', '/api/board/todo', h(1), board('the refused tab, after reloading'));
    yes('A7 the refused tab, reloaded, saves on revision 1 and gets 2', again.status === 200 && again.j.rev === 2);

    const stale = await request(port, 'PUT', '/api/board/todo', h(1), board('stale'));
    yes('A8 a save from the old revision after that is refused', stale.status === 409);
    const none = await request(port, 'PUT', '/api/board/todo', h(undefined), board('no revision'));
    yes('A9 a save with no revision (a page opened before this) is 428, saying to reload: ' + none.j.message,
        none.status === 428 && /Reload/.test(none.j.message || ''));
    const junk = await request(port, 'PUT', '/api/board/todo', h('2; drop'), board('junk'));
    yes('A10 a revision that is not the number is refused', junk.status === 409);
    bf = boardFile(S.dir);
    yes('A11 none of the refused saves wrote anything', bf.todo.sections[0].rows[0].cells[0] === 'the refused tab, after reloading' && bf._rev.todo === 2);

    const [r1, r2] = await Promise.all([
      request(port, 'PUT', '/api/board/archive', h(0), board('archive edit')),
      request(port, 'PUT', '/api/board/todo', h(2), board('todo edit')),
    ]);
    yes('A12 two people on two boards at once: both land', r1.status === 200 && r2.status === 200 && r1.j.rev === 1 && r2.j.rev === 3);

    const ten = await Promise.all(Array.from({ length: 10 }, (_, i) => request(port, 'PUT', '/api/board/todo', h(3), board('burst ' + i))));
    yes('A13 ten saves at once from one revision: exactly one lands, nine are 409',
        ten.filter((r) => r.status === 200).length === 1 && ten.filter((r) => r.status === 409).length === 9);
    bf = boardFile(S.dir);
    yes('A14 and board.json is at revision 4', bf._rev.todo === 4);

    const pub = await request(port, 'GET', '/api/roadmap', {});
    yes('A15 the public roadmap does not carry the revisions', pub.status === 200 && pub.text.indexOf('_rev') < 0);
    const bad = await request(port, 'PUT', '/api/board/nosuch', h(0), board('x'));
    yes('A16 a board that does not exist is still 400', bad.status === 400 && bad.j.error === 'no such board');
  } catch (e) {
    yes('the scratch site ran: ' + e.message, false);
  } finally {
    if (site) site.srv.kill();
    await new Promise((r) => setTimeout(r, 300));
    try { fs.rmSync(S.dir, { recursive: true, force: true }); } catch (e) { }
  }

  console.log('\nB. the hub:');
  const s0 = HUB.indexOf('var pending = {}, inflight = {}, again = {};');
  const s1 = HUB.indexOf('var newId = function');
  yes('B0 the hub save code is in hub.js', s0 > 0 && s1 > s0);
  const sent = [], said = [];
  let answer = null;
  const timers = [];
  const box = {
    S: { boards: { todo: board('one') }, boardRevs: { todo: 5 } },
    saidNow: (t) => said.push(t),
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => {},
    api: (url, o) => new Promise((ok) => { sent.push({ url, rev: o.headers['X-Board-Rev'], body: o.body }); answer = ok; }),
    String, JSON,
  };
  vm.runInNewContext(HUB.slice(s0, s1), box);
  const reply = (status, j) => answer({ ok: status === 200, status, json: () => Promise.resolve(j) });
  const flush = () => new Promise((r) => setImmediate(r));
  box.saveBoard('todo'); timers.shift()();
  yes('B1 a save goes out with the revision the hub holds (5)', sent.length === 1 && sent[0].rev === '5');
  box.S.boards.todo = board('two');
  box.saveBoard('todo'); timers.shift()();
  yes('B2 an edit made while it is out does not go yet', sent.length === 1);
  reply(200, { ok: true, rev: 6 }); await flush(); await flush(); await flush();
  yes('B3 when the first lands, the waiting edit goes with the new revision (6)', sent.length === 2 && sent[1].rev === '6' && /two/.test(sent[1].body));
  reply(200, { ok: true, rev: 7 }); await flush(); await flush(); await flush();
  yes('B4 and the hub then holds 7', box.S.boardRevs.todo === 7 && said[said.length - 1] === 'saved');
  box.S.boards.todo = board('three');
  box.saveBoard('todo'); timers.shift()();
  box.saveBoard('todo'); timers.shift()();
  reply(409, { error: 'conflict', rev: 9 }); await flush(); await flush(); await flush();
  yes('B5 a 409 is said in words, saying to reload: ' + said[said.length - 1], /somebody else saved this board/.test(said[said.length - 1]) && /Reload/.test(said[said.length - 1]));
  yes('B6 and is not retried, even with an edit waiting behind it', sent.length === 3);
  yes('B7 the hub does not adopt the newer number, so the next save cannot slip past it', box.S.boardRevs.todo === 7);
  yes('B8 refresh() keeps a board with a save on its way', /if \(pending\[k\] \|\| inflight\[k\]\)/.test(HUB));

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
