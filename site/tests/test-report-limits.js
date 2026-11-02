// test-report-limits.js
//
// The public report form: five an hour from one place, a hidden field that
// only a script fills in, and an inbox where reports cannot push tickets out.
//
// From the To Do List: "The public report form has no rate limit, and the
// inbox drops the oldest, so real reports can be flushed out". /api/report took
// anything from anybody as often as they liked, and it shared one list with
// the bot's tickets, trimmed to the newest 2000 rows, so 2000 posts from
// anywhere pushed every ticket off the end.
//
// TWO HALVES. The first lifts the block between the report limits markers out
// of site\server.js and drives it with fake requests and a fake clock,
// because that is the only way to reach a socket that is not loopback and a
// day that has gone by. The second copies the real server.js into a scratch
// folder, starts it on a spare port and fires real posts at it, which is the
// check the entry asks for: ten posts from one address answer 429 after the
// fifth, and tickets written through /api/ticket are all still in the file
// after a flood of reports.
//
// Nothing here touches the repository's data folder or anything on the VPS.
// server.js writes beside itself, and the copy it runs as is in a temp folder
// that is deleted afterwards.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const CR = String.fromCharCode(13);
const SRC = path.join(REPO_DIR, 'site', 'server.js');
const src = siteFiles.source(SRC).split(CR).join('');
// The report form and its request handler moved out of home.html in #1474.
const HOME = fs.readFileSync(path.join(REPO_DIR, 'site', 'public', 'home.js'), 'utf8')
  .split(CR).join('');
const HOME_CSS = fs.readFileSync(path.join(REPO_DIR, 'site', 'public', 'home.css'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the block --
const A = '// ==== thornswood report limits ====';
const B = '// ==== end thornswood report limits ====';
const a = src.indexOf(A);
const b = a < 0 ? -1 : src.indexOf(B, a);
const block = (a >= 0 && b > a) ? src.slice(a, b) : null;
yes('the report limits block is in server.js', block !== null);

let lib = null;
if (block) {
  lib = new Function('crypto', 'net', block +
    '\nreturn { reportFrom, reportRefusal, reportTaken, reportPrune, trimInbox,' +
    ' reportSeen, INBOX_KEEP, REPORT_HOUR, REPORT_DAY };')(crypto, net);
}

// The words, before anything else. The sentence in a 429 is what the page
// puts in front of the person, so it follows the same rules as the page.
const EMDASH = String.fromCharCode(0x2014);
function fair(s) {
  return typeof s === 'string' && s.length > 20 &&
         s.indexOf(EMDASH) < 0 && !/player/i.test(s);
}

if (lib) {
  const req = (sock, xff) => ({
    socket: { remoteAddress: sock },
    headers: xff === undefined ? {} : { 'x-forwarded-for': xff }
  });
  const from = (sock, xff) => lib.reportFrom(req(sock, xff));

  // ------------------------------------------------ where it comes from --
  yes('the numbers are the ones the entry asked for',
      lib.REPORT_HOUR === 5 && lib.REPORT_DAY === 20 && lib.INBOX_KEEP === 2000);

  yes('behind Caddy, two people are two senders and not one',
      from('127.0.0.1', '203.0.113.5') !== from('127.0.0.1', '203.0.113.6'));
  yes('and the same person twice is the same sender',
      from('127.0.0.1', '203.0.113.5') === from('127.0.0.1', '203.0.113.5'));
  yes('only the last hop counts, because that is the one Caddy wrote',
      from('127.0.0.1', 'made up, 203.0.113.5') === from('127.0.0.1', '203.0.113.5'));
  yes('so changing the typed part of the header buys nobody a new sender',
      from('127.0.0.1', 'one lie, 203.0.113.5') === from('127.0.0.1', 'another lie, 203.0.113.5'));
  yes('loopback written the IPv6 way is still Caddy',
      from('::ffff:127.0.0.1', '203.0.113.5') === from('127.0.0.1', '203.0.113.5'));
  yes('and so is ::1',
      from('::1', '203.0.113.5') === from('127.0.0.1', '203.0.113.5'));

  yes('straight to 3001, the header is not believed at all',
      from('198.51.100.7', '203.0.113.5') === from('198.51.100.7', '203.0.113.99'));
  yes('and such a request is keyed by its own socket',
      from('198.51.100.7', '203.0.113.5') !== from('127.0.0.1', '203.0.113.5'));
  yes('an IPv4 address wrapped as IPv6 is the same sender unwrapped',
      from('::ffff:198.51.100.7') === from('198.51.100.7'));

  yes('one home connection\'s /64 is one sender',
      from('2001:db8:1:2::1') === from('2001:db8:1:2:ffff:ffff:ffff:9'));
  yes('and the next /64 along is another',
      from('2001:db8:1:2::1') !== from('2001:db8:1:3::1'));
  yes('written out in full or shortened, it is the same /64',
      from('2001:0db8:0001:0002:0000:0000:0000:0001') === from('2001:db8:1:2::1'));
  yes('an IPv6 address behind Caddy gets the same treatment',
      from('127.0.0.1', '2001:db8:1:2::1') === from('127.0.0.1', '2001:db8:1:2::abcd'));

  // privacy.md: the sign-in log is the only thing on the site holding an address.
  // The key is the block's HMAC of the address under a salt it makes at
  // start. This used to search the key for "203", and a fresh salt makes a
  // hash with those three digits in it about one start in 140 (#1738), so
  // the block is lifted again here with two salts this harness chose, and
  // the key is held to exactly the hash it has to be.
  const k = from('127.0.0.1', '203.0.113.5');
  const under = (salt) => new Function('crypto', 'net', block + '\nreturn reportFrom;')(
    Object.assign(Object.create(crypto), { randomBytes: () => salt }), net)(req('127.0.0.1', '203.0.113.5'));
  const hmac = (salt) => crypto.createHmac('sha256', salt).update('203.0.113.5').digest('hex').slice(0, 32);
  const s1 = Buffer.alloc(32, 1), s2 = Buffer.alloc(32, 2);
  yes('the table is keyed by a hash, not by the address',
      /^[0-9a-f]{32}$/.test(k) && k !== '203.0.113.5');
  yes('the hash is of the address under the salt made at start',
      under(s1) === hmac(s1) && under(s2) === hmac(s2));
  yes('so the same address is another key after the next start',
      under(s1) !== under(s2));

  // ----------------------------------------------------- five an hour --
  const T0 = Date.UTC(2026, 8, 24, 12, 0, 0);
  const MIN = 60 * 1000, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const one = from('127.0.0.1', '203.0.113.10');
  yes('a sender nobody has heard from is taken', lib.reportRefusal(one, T0) === null);
  for (let i = 0; i < 4; i++) lib.reportTaken(one, T0 + i * MIN);
  yes('four in the hour are still taken', lib.reportRefusal(one, T0 + 4 * MIN) === null);
  lib.reportTaken(one, T0 + 4 * MIN);
  const no = lib.reportRefusal(one, T0 + 5 * MIN);
  yes('the sixth in the hour is refused', no !== null);
  yes('with a sentence for the person, in the page\'s words', !!no && fair(no.error));
  yes('which says when to come back', !!no && /about 55 minutes/.test(no.error));
  yes('and a wait in seconds for Retry-After, until the oldest one falls out',
      !!no && no.wait === 55 * 60);
  yes('somebody else is not held up by it',
      lib.reportRefusal(from('127.0.0.1', '203.0.113.11'), T0 + 5 * MIN) === null);
  yes('once the first one is an hour old, the next is taken',
      lib.reportRefusal(one, T0 + HOUR + 1) === null);

  // ----------------------------------------------------- twenty a day --
  const busy = from('127.0.0.1', '203.0.113.20');
  // Sixteen minutes apart is four in any hour, so only the day can refuse.
  for (let i = 0; i < 20; i++) lib.reportTaken(busy, T0 + i * 16 * MIN);
  yes('twenty spread out like that never trip the hour',
      (function () {
        for (let t = T0; t <= T0 + 19 * 16 * MIN; t += MIN) {
          const inHour = lib.reportSeen.get(busy).filter((s) => s <= t && s > t - HOUR).length;
          if (inHour >= 5) return false;
        }
        return true;
      })());
  const hourNow = T0 + 19 * 16 * MIN + 2 * HOUR;
  const day = lib.reportRefusal(busy, hourNow);
  yes('twenty in a day, never five in an hour, and the twenty-first is refused',
      day !== null);
  yes('with its own sentence, saying it is the day', !!day && fair(day.error) && /today/.test(day.error));
  yes('and a wait in hours rather than minutes', !!day && /hours/.test(day.error) && day.wait > HOUR / 1000);
  yes('the day after, it is taken again', lib.reportRefusal(busy, T0 + DAY + 1) === null);

  // --------------------------------------------------------- forgetting --
  yes('the table holds the senders it has seen', lib.reportSeen.has(one) && lib.reportSeen.has(busy));
  lib.reportPrune(T0 + 2 * DAY);
  yes('and a day after their last report they are gone from it',
      !lib.reportSeen.has(one) && !lib.reportSeen.has(busy));
  const late = from('127.0.0.1', '203.0.113.30');
  lib.reportTaken(late, T0 + 2 * DAY - MIN);
  lib.reportPrune(T0 + 2 * DAY);
  yes('but somebody from the last day is kept', lib.reportSeen.has(late));
  yes('and never more stamps than a day can refuse on',
      (function () {
        const k2 = from('127.0.0.1', '203.0.113.31');
        for (let i = 0; i < 50; i++) lib.reportTaken(k2, T0 + i);
        return lib.reportSeen.get(k2).length === 20;
      })());

  // ---------------------------------------------------------- the trim --
  // Newest first, the way the file is written: a flood of reports that
  // arrived after three tickets.
  const rows = [];
  for (let i = 0; i < 2500; i++) rows.push({ id: 'r' + i, kind: i % 2 ? 'idea' : 'bug' });
  for (let i = 0; i < 3; i++) rows.push({ id: 't' + i, kind: 'ticket' });
  const kept = lib.trimInbox(rows);
  yes('2500 reports after three tickets leave all three tickets',
      kept.filter((r) => r.kind === 'ticket').length === 3);
  yes('and the newest 2000 reports',
      kept.filter((r) => r.kind !== 'ticket').length === 2000 &&
      kept[0].id === 'r0' && kept[1999].id === 'r1999');
  yes('in the order they were in', kept[2000].id === 't0' && kept[2002].id === 't2');
  const tix = [];
  for (let i = 0; i < 2500; i++) tix.push({ id: 't' + i, kind: 'ticket' });
  tix.push({ id: 'old report', kind: 'bug' });
  const kept2 = lib.trimInbox(tix);
  yes('and the other way round, a pile of tickets leaves the report',
      kept2.length === 2001 && kept2[2000].id === 'old report');
  yes('a row with no kind counts as a report, which is what the old ones are',
      lib.trimInbox([{ id: 'x' }]).length === 1);
  yes('a file that is not a list reads as empty rather than throwing',
      lib.trimInbox(null).length === 0 && lib.trimInbox({}).length === 0);
  yes('it does not chew the list it was handed', rows.length === 2503);
}

// ---------------------------------------------------------------- page --
yes('the form carries the hidden field', /id="rHome" name="homepage"/.test(HOME));
yes('out of the tab order, so a keyboard never lands on it', /id="rHome"[^>]*tabindex="-1"/.test(HOME));
yes('and hidden from a screen reader', /<div[^>]*aria-hidden="true"[^>]*class="hp-trap"[^>]*><label for="rHome"/.test(HOME));
yes('and the honeypot still sits off the visible page', /\.hp-trap\s*\{[^}]*position:\s*absolute[^}]*left:\s*-10000px/.test(HOME_CSS));
yes('and the page sends it', /homepage: document\.getElementById\('rHome'\)\.value/.test(HOME));
yes('the page shows the site\'s own sentence when a report is refused',
    /(said\.textContent = |finish\()res\.j\.error \|\|/.test(HOME));

// --------------------------------------------------- the real server --
function freePort() {
  return new Promise((done, bad) => {
    const s = net.createServer();
    s.once('error', bad);
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => done(p)); });
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

// Many reports from one address at once, each connection sending its headers
// first and its body only once every connection has sent its headers. fetch
// cannot do that, so this speaks HTTP over plain sockets. The site hands a
// request to handle() as soon as the headers are in, so this is how a script
// gets every one of them past a check made before the body is read, and Caddy
// passes headers on before it has the body, so it works through Caddy too.
// Answers each connection's status code.
function heldBack(port, n, xff) {
  const CRLF = CR + String.fromCharCode(10);
  const conns = [];
  for (let i = 0; i < n; i++) {
    const text = JSON.stringify({ title: 'held ' + i });
    const s = net.connect(port, '127.0.0.1');
    let got = '';
    const answer = new Promise((done) => {
      s.on('data', (d) => { got += d; });
      s.on('close', () => done(got));
      s.on('error', () => done(got));
    });
    const ready = new Promise((done) => s.once('connect', () => {
      s.write('POST /api/report HTTP/1.1' + CRLF + 'Host: 127.0.0.1' + CRLF +
        'Content-Type: application/json' + CRLF + 'X-Forwarded-For: ' + xff + CRLF +
        'Content-Length: ' + Buffer.byteLength(text) + CRLF + 'Connection: close' + CRLF + CRLF);
      done();
    }));
    conns.push({ s, text, answer, ready });
  }
  return Promise.all(conns.map((c) => c.ready))
    // Long enough for the site to have read every set of headers and started
    // waiting on every body.
    .then(() => new Promise((r) => setTimeout(r, 400)))
    .then(() => { conns.forEach((c) => c.s.write(c.text)); })
    .then(() => Promise.all(conns.map((c) => c.answer)))
    .then((all) => all.map((raw) => {
      const m = /^HTTP\/1\.1 (\d{3})/.exec(raw);
      return m ? Number(m[1]) : 0;
    }));
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-report-'));
const KEY = crypto.randomBytes(16).toString('hex');
let srv = null;
let said = '';

function finish() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
  // Kill, then let the loop drain before exiting. process.exit while the
  // child's pipes are closing trips a libuv assertion on Windows.
  if (srv) {
    srv.once('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { } });
    srv.kill();
  } else {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  setTimeout(() => {}, 300);
}

(async () => {
  const PORT = await freePort();
  siteFiles.copy(dir, SRC);
  // A config of its own, so the copy never asks Discord anything and its
  // game check knocks on a port nothing is listening on: port 1 (#1816). The
  // system never hands it out for a listen on 0 and no harness listens on a
  // fixed port (test-1703-test-ports.js), so no run beside this one can take
  // it and make the game read as up. A port taken from the system and let go
  // could be.
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: '', secret: crypto.randomBytes(32).toString('hex'), botKey: KEY,
    gameCheckPort: 1, onlineFile: path.join(dir, 'online.json'),
    discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' }
  }));
  srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, {
      THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1'
    })
  });
  srv.stdout.on('data', (d) => { said += d; });
  srv.stderr.on('data', (d) => { said += d; });

  const base = 'http://127.0.0.1:' + PORT;
  let up = false;
  try { await listening(srv, PORT); up = true; } catch (e) { said = e.message; }
  yes('a scratch copy of the site starts', up);
  if (!up) { console.log(said); return finish(); }

  const post = (route, obj, xff) => fetch(base + route, {
    method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json' },
                           xff ? { 'X-Forwarded-For': xff } : {}),
    body: JSON.stringify(obj)
  });
  const INBOX = path.join(dir, 'data', 'for-bot', 'inbox.json');
  const inbox = () => JSON.parse(fs.readFileSync(INBOX, 'utf8'));

  // Three tickets, the way the bot sends them.
  const codes = [];
  for (let i = 0; i < 3; i++) {
    codes.push((await post('/api/ticket', { key: KEY, kind: 'help', title: 'ticket ' + i,
      detail: 'from the bot', by: 'tester', discordId: '1' })).status);
  }
  yes('three tickets go in through /api/ticket', codes.join(',') === '200,200,200');
  const ticketIds = inbox().filter((r) => r.kind === 'ticket').map((r) => r.id);
  yes('and all three are in the inbox', ticketIds.length === 3);

  // A flood that already arrived after them. Written into the file rather
  // than posted, because 1990 posts at five an address is four hundred
  // addresses and a minute of waiting for the same result: the site reads the
  // file on every post, so the next fifty are trimmed against exactly this.
  const now = inbox();
  const flood = [];
  for (let i = 0; i < 1990; i++) {
    flood.push({ id: 'flood' + i, kind: 'bug', title: 'flood ' + i, detail: '', by: '',
      at: Date.now(), state: 'new', from: 'the public page' });
  }
  fs.writeFileSync(INBOX, JSON.stringify(flood.concat(now), null, 2));

  // Fifty reports, five each from ten people behind Caddy.
  const fifty = [];
  for (let n = 0; n < 10; n++) {
    for (let i = 0; i < 5; i++) {
      fifty.push((await post('/api/report', { title: 'report ' + n + '.' + i, kind: 'bug' },
        '198.51.100.' + (n + 1))).status);
    }
  }
  yes('fifty reports from ten people, five each, are all taken',
      fifty.length === 50 && fifty.every((c) => c === 200));
  const after = inbox();
  yes('every ticket written earlier is still in the inbox after them',
      ticketIds.every((id) => after.some((r) => r.id === id)));
  yes('reports are held to 2000 of their own',
      after.filter((r) => r.kind !== 'ticket').length === 2000);
  yes('and it is the oldest of the flood that went, not the fifty new ones',
      after.some((r) => r.title === 'report 9.4') && after.some((r) => r.title === 'report 0.0') &&
      !after.some((r) => r.id === 'flood1989'));

  // Ten from one address. Five in, then five refusals.
  const rows0 = inbox().length;
  const ten = [];
  let refusal = null;
  for (let i = 0; i < 10; i++) {
    const r = await post('/api/report', { title: 'probe ' + i }, '203.0.113.77');
    ten.push(r.status);
    if (r.status === 429 && !refusal) {
      refusal = { after: r.headers.get('retry-after'), body: await r.json() };
    }
  }
  console.log('      ten posts from one address: ' + ten.join(' '));
  yes('ten posts from one address answer 200 five times, then 429',
      ten.join(',') === '200,200,200,200,200,429,429,429,429,429');
  yes('the refusal says when to try again in Retry-After',
      !!refusal && /^\d+$/.test(refusal.after || '') && Number(refusal.after) > 3000);
  yes('and in a sentence the page shows the person', !!refusal && fair(refusal.body.error));
  // The reports' 2000 are full by now, so each one taken pushed the oldest of
  // the flood out and the file is the same length it was.
  const rows1 = inbox();
  const probes = rows1.filter((r) => /^probe /.test(r.title)).map((r) => r.title).sort();
  yes('only the five that were taken were written',
      rows1.length === rows0 && probes.join(',') === 'probe 0,probe 1,probe 2,probe 3,probe 4');
  yes('a made up first hop does not get round it',
      (await post('/api/report', { title: 'sneaky' }, '10.9.8.7, 203.0.113.77')).status === 429);

  // Thirty at once from one address with the bodies held back. Before the
  // site asked again after reading the body, all thirty were taken and
  // written, and two thousand of those flush every real report out.
  const heldCodes = await heldBack(PORT, 30, '203.0.113.60');
  const took = heldCodes.filter((c) => c === 200).length;
  const refused = heldCodes.filter((c) => c === 429).length;
  console.log('      thirty held back from one address: ' + took + ' taken, ' + refused + ' refused');
  yes('thirty at once with the bodies held back still take only five',
      took === 5 && refused === 25);
  yes('and only five of them are written',
      inbox().filter((r) => /^held /.test(r.title)).length === 5);

  // The hidden field.
  const rows2 = inbox().length;
  const trap = await post('/api/report', { title: 'buy things', homepage: 'http://spam.example' },
    '203.0.113.88');
  yes('a report with the hidden field filled in is answered as if it worked',
      trap.status === 200 && (await trap.json()).ok === true);
  yes('and nothing of it is kept',
      inbox().length === rows2 && !inbox().some((r) => r.title === 'buy things'));
  yes('the same person with the field empty is taken',
      (await post('/api/report', { title: 'a real one', homepage: '' }, '203.0.113.88')).status === 200);

  yes('the bot is never held to the report limit',
      (await post('/api/ticket', { key: KEY, kind: 'help', title: 'one more' },
        '203.0.113.77')).status === 200);
  yes('and every ticket is still there at the end',
      inbox().filter((r) => r.kind === 'ticket').length === 4);

  finish();
})().catch((e) => { console.error(e); fail++; finish(); });
