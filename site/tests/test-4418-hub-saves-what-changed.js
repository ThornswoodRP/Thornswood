/*
  test-4418-hub-saves-what-changed.js

      node site/tests/test-4418-hub-saves-what-changed.js

  #4418: the hub saved its inbox, its test marks and its pages by sending back
  the whole copy the page loaded when it opened. So an inbox button deleted
  every report sent since, and could bring back a row a deletion request had
  taken out; a test mark wiped other people's marks made meanwhile; and two
  people editing one page lost each other's work.

  This runs the hub's own code (the inbox page and its buttons, saveResult,
  the page editor), lifted out of site/public/hub.js, against a real copy of
  the site on a scratch folder, signed in as an admin, with the page opened
  first from /api/all as the hub opens it. Then something changes on the site
  while the page is open, and a button on the open page is pressed:

    A. a new report is sent; Not doing this, then Delete, on an older row.
       The new report is still in the inbox, and the button did what it says.
    B. a deletion request is applied as the site starts again; Not doing
       this on the row that went, which the page still shows, then on
       another row. Nothing the request took out comes back.
    C. another tester marks a test; a mark on a different test. Both marks
       are kept.
    D. somebody else saves a page; a save from the page opened before it. It
       is refused and said, their text is kept, and the text being written is
       still in the box. Saving again, now that the page knows the newer copy,
       writes it. A save that names no copy at all is refused.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP when it
  is set. The site takes a free port each time it starts (#1756).
*/
'use strict';
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
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const ADMIN_D = '222222222222222222', BJORN_D = '333333333333333333';
const KEY = crypto.randomBytes(24).toString('hex');

function scratch() {
  const dir = fs.mkdtempSync(path.join(TEMP, 'ts-4418-'));
  const secret = crypto.randomBytes(32).toString('hex');
  siteFiles.copy(dir, SITE);
  fs.mkdirSync(path.join(dir, 'data', 'for-bot'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
    botKey: KEY, admins: [ADMIN_D], secret,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
    [ADMIN_D]: { id: ADMIN_D, name: 'Aela', profiles: [1001] },
    [BJORN_D]: { id: BJORN_D, name: 'Bjorn', profiles: [2002] }
  }));
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
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_GITHUB_API: 'http://127.0.0.1:1', THORNSWOOD_DOCS_LOCAL: '1' })
  });
  await listening(srv, port);
  s.port = port; s.srv = srv;
}
/* Stopped, and let go of its folder, when it has closed. */
function stop(s) {
  return new Promise((ok) => {
    const srv = s.srv; s.srv = null;
    if (!srv || srv.exitCode !== null || srv.signalCode !== null) { ok(); return; }
    srv.once('close', ok);
    srv.kill();
  });
}
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? null : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
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
const readJson = (dir, f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { return d; } };
const readText = (dir, f) => { try { return fs.readFileSync(path.join(dir, f), 'utf8'); } catch (e) { return null; } };
const INBOX = 'data/for-bot/inbox.json';
const rowOf = (dir, id) => readJson(dir, INBOX, []).filter((x) => x && x.id === id)[0];

// ------------------------------------------------------ the hub's own code --
function fnSource(src, name) {
  const at = src.indexOf('\nfunction ' + name + '(');
  if (at < 0) return '';
  let depth = 0, i = src.indexOf('{', at);
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) break; }
  }
  return src.slice(at + 1, i + 1);
}
// Whichever of these the hub has: the inbox page, its buttons and how they
// save, the test marks' save, and the page editor, with the shared readers
// those saves use to say why the site refused (#4187).
const LIFTED = ['each', 'siteSaid', 'whyWords', 'notSaved', 'drawInbox', 'saveInbox', 'inboxAct', 'inboxName', 'saveResult', 'drawEdit']
  .map((n) => fnSource(HUB, n)).filter(Boolean).join('\n');
yes('the hub has its inbox page, the test marks\' save and the page editor',
    ['drawInbox', 'saveResult', 'drawEdit'].every((n) => fnSource(HUB, n)));

const pending = [];
/* Until every request the page started, and what it does with each answer,
   has finished. */
async function settle() {
  for (let i = 0; i < 8; i++) {
    await Promise.allSettled(pending.slice());
    await new Promise((r) => setImmediate(r));
  }
}

/* One open hub page: its own S, read from /api/all as the hub reads it, and
   the hub's own functions run on it. Its requests go to the site as the
   browser would send them, with the admin's cookie and this site's origin. */
async function openHub(site, who) {
  const cookie = cookieFor(site.secret, ADMIN_D, who);
  const all = await request(site.port, 'GET', '/api/all', { cookie });
  const d = all.j || {};
  const els = {};
  const page = {
    buttons: {},
    _html: '',
    set innerHTML(v) { this._html = String(v); this.buttons = {}; },
    get innerHTML() { return this._html; },
    querySelectorAll(sel) {
      const m = /^\[data-([a-z]+)\]$/.exec(sel);
      if (!m) return [];
      const out = [];
      const re = new RegExp('data-' + m[1] + '="([^"]*)"', 'g');
      let x;
      while ((x = re.exec(this._html))) {
        const b = { dataset: { [m[1]]: x[1] }, onclick: null, disabled: false, textContent: '' };
        (this.buttons[m[1]] = this.buttons[m[1]] || {})[x[1]] = b;
        out.push(b);
      }
      return out;
    }
  };
  els.page = page;
  const said = [];
  const sandbox = {
    S: {
      at: 'tests', editing: false, me: d.me || {},
      docs: d.docs || {}, docWas: d.docWas || {},
      results: d.results || {}, inbox: d.inbox || []
    },
    el: (id) => els[id] || (els[id] = { id: id, value: '', textContent: '', innerHTML: '', onclick: null }),
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]),
    head: () => '',
    draw: () => {},
    tally: () => {},
    remember: () => '',
    saidNow: (t) => { said.push(String(t)); },
    // Where focus goes and what is said aloud after an inbox button are
    // test-4421-hub-focus-and-words.js's to check; here they do nothing.
    inboxFocus: () => {},
    announce: () => {},
    confirm: () => true,
    alert: () => {},
    api: (p, opts) => {
      opts = opts || {};
      const h = { cookie, origin: 'http://127.0.0.1:' + site.port };
      for (const k of Object.keys(opts.headers || {})) h[k.toLowerCase()] = opts.headers[k];
      const pr = request(site.port, opts.method || 'GET', p, h, opts.body === undefined ? undefined : String(opts.body))
        .then((r) => ({
          ok: r.status >= 200 && r.status < 300, status: r.status,
          json: () => new Promise((ok, bad) => { try { ok(JSON.parse(r.text)); } catch (e) { bad(e); } }),
          text: () => Promise.resolve(r.text)
        }));
      pending.push(pr);
      return pr;
    },
    JSON, Date, String, Array, Object, Number, Promise
  };
  vm.createContext(sandbox);
  vm.runInContext(LIFTED, sandbox);
  return { sandbox, page, els, said, run: (code) => vm.runInContext(code, sandbox) };
}
/* Presses a button the inbox page drew, by its data- name and the row. */
function press(hub, kind, id) {
  hub.run('drawInbox()');
  const b = (hub.page.buttons[kind] || {})[id];
  if (!b || typeof b.onclick !== 'function') return false;
  b.onclick();
  return true;
}

(async function main() {
  const s = scratch();
  const now = Date.now();
  try {
    // ------------------------------------------- A. a report sent meanwhile --
    console.log('A. a report arrives while the inbox is open:');
    fs.writeFileSync(path.join(s.dir, INBOX), JSON.stringify([
      { id: 'iold', kind: 'bug', title: 'a door in Whiterun will not open', state: 'new', at: now - 60000 }
    ]));
    await start(s);
    const hubA = await openHub(s, 'Aela');
    yes('the page opened with the one row', hubA.sandbox.S.inbox.length === 1);
    let r = await request(s.port, 'POST', '/api/report', { 'content-type': 'application/json', 'x-forwarded-for': '10.44.18.1' },
                          { kind: 'bug', title: 'sent while the page was open' });
    const fresh = () => readJson(s.dir, INBOX, []).filter((x) => x && x.title === 'sent while the page was open')[0];
    yes('a report is sent after the page opened (' + r.status + ')', r.status === 200 && !!fresh());

    yes('Not doing this is pressed on the older row', press(hubA, 'dismiss', 'iold'));
    await settle();
    yes('  the older row is marked not doing this', (rowOf(s.dir, 'iold') || {}).state === 'not doing this');
    yes('  and the report sent meanwhile is still in the inbox, still new', !!fresh() && fresh().state === 'new');

    yes('Delete is pressed on the older row, from the same page', press(hubA, 'forget', 'iold'));
    await settle();
    yes('  the older row is gone', !rowOf(s.dir, 'iold'));
    yes('  and the report sent meanwhile is still there', !!fresh() && fresh().state === 'new');
    await stop(s);

    // ---------------------------------------- B. a deletion request applied --
    console.log('\nB. a deletion request is applied while the inbox is open:');
    fs.writeFileSync(path.join(s.dir, INBOX), JSON.stringify([
      { id: 'ibjorn', kind: 'help', discordId: BJORN_D, title: 'stuck in a wall', by: 'Bjorn', state: 'new', at: now - 30000 },
      { id: 'iother', kind: 'bug', title: 'the cart to Riften is late', state: 'new', at: now - 20000 }
    ]));
    await start(s);
    const hubB = await openHub(s, 'Aela');
    yes('the page opened with both rows', hubB.sandbox.S.inbox.length === 2);
    await stop(s);
    fs.writeFileSync(path.join(s.dir, 'data', 'deletion-requests.json'),
                     JSON.stringify({ people: [{ discordId: BJORN_D, profiles: [2002] }] }));
    await start(s);
    yes('the site took Bjorn\'s call for help out as it started',
        !rowOf(s.dir, 'ibjorn') && !!rowOf(s.dir, 'iother') && !fs.existsSync(path.join(s.dir, 'data', 'deletion-requests.json')));

    yes('Not doing this is pressed on Bjorn\'s row, which the page opened before still shows', press(hubB, 'dismiss', 'ibjorn'));
    await settle();
    yes('  it does not come back', !rowOf(s.dir, 'ibjorn'));
    yes('  and the page is told it is gone', hubB.said.length > 0 && hubB.said[hubB.said.length - 1] !== 'saved');

    yes('Not doing this is pressed on the other row, from the same page', press(hubB, 'dismiss', 'iother'));
    await settle();
    yes('  the other row is marked not doing this', (rowOf(s.dir, 'iother') || {}).state === 'not doing this');
    yes('  and Bjorn\'s call for help still does not come back', !rowOf(s.dir, 'ibjorn'));

    // ------------------------------------------------- C. two testers' marks --
    console.log('\nC. two people mark tests from pages open at once:');
    const tester1 = await openHub(s, 'Aela');
    const tester2 = await openHub(s, 'Brynja');
    tester2.run("saveResult('test-two', { status: 'pass', notes: 'fine', by: 'Brynja' }, null)");
    await settle();
    yes('the second tester\'s mark is saved', ((readJson(s.dir, 'data/results.json', {}) || {})['test-two'] || {}).status === 'pass');
    tester1.run("saveResult('test-one', { status: 'fail', notes: 'the door stuck', by: 'Aela' }, null)");
    await settle();
    const marks = readJson(s.dir, 'data/results.json', {}) || {};
    yes('the first tester\'s mark, from the page opened before, is saved', (marks['test-one'] || {}).status === 'fail' &&
        (marks['test-one'] || {}).notes === 'the door stuck');
    yes('  and the second tester\'s mark is kept', (marks['test-two'] || {}).status === 'pass' && (marks['test-two'] || {}).by === 'Brynja');

    // ---------------------------------------------- D. two people on one page --
    console.log('\nD. two people edit one page:');
    fs.writeFileSync(path.join(s.dir, 'data', 'tests.md'), 'the first text\n');
    const ed1 = await openHub(s, 'Aela');
    const ed2 = await openHub(s, 'Brynja');
    ed2.run('drawEdit()');
    ed2.els.ta.value = 'what Brynja wrote\n';
    ed2.els.save.onclick();
    await settle();
    yes('the second editor saves the page', readText(s.dir, 'data/tests.md') === 'what Brynja wrote\n');
    ed1.run('drawEdit()');
    ed1.els.ta.value = 'what Aela wrote\n';
    ed1.els.save.onclick();
    await settle();
    yes('a save from the page opened before it does not write over it', readText(s.dir, 'data/tests.md') === 'what Brynja wrote\n');
    yes('  the page says it did not save', ed1.said.length > 0 && ed1.said[ed1.said.length - 1] !== 'saved');
    yes('  and what Aela wrote is still in the box', ed1.els.ta.value === 'what Aela wrote\n');
    ed1.els.save.onclick();
    await settle();
    yes('saved again, now the page knows the newer copy, it is written', readText(s.dir, 'data/tests.md') === 'what Aela wrote\n');

    r = await request(s.port, 'PUT', '/api/doc/tests', { cookie: cookieFor(s.secret, ADMIN_D, 'Aela'), origin: 'http://127.0.0.1:' + s.port },
                      'a save that names no copy');
    yes('a save that names no copy it was made from is refused (' + r.status + ')',
        r.status === 409 && readText(s.dir, 'data/tests.md') === 'what Aela wrote\n');
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false);
  } finally {
    await stop(s);
    try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
