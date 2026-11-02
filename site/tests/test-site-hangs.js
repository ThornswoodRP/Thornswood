/*
  test-site-hangs.js

      node .\site\tests\test-site-hangs.js [path\to\server.js]

  Nothing the site is asked may hang (#1094, #1095, #1096, #1097, #1164).

  #1094: discordGet only listened for 'data' and 'end'. When Discord sent its
  headers and then stalled, the ten second socket timeout destroyed the
  request, the answer never ended, and the promise never settled, so the
  request waiting on it never answered. Play's two doors, /api/play/join and
  /api/play/pass, have to answer the launcher inside its fifteen seconds with
  words, whatever Discord does.

  #1095: body() resolved on 'end' only. Over its cap it destroyed the request,
  so 'end' never came; a sender that stopped or dropped halfway left it
  waiting too. Too big has to be 413 in words, too slow 408 in words, and a
  connection that went has to settle (the site logs it) with no half file
  left behind.

  #1096: a page load from a signed in visitor waited on Discord in full. It
  has to answer inside a second, with the last answer Discord gave for that
  account when there is one, and /api/gallery/who has to say when Discord
  could not be asked. The gallery page draws the pictures without waiting on
  who is asking.

  #1097: the report page told a signed in visitor with no role to sign in. It
  shows the site's own sentence instead, the same one /api/report answers.

  The real site\server.js runs on a scratch copy over http. Discord is a
  small server in this process, reached through a preload that turns
  https.get to discord.com into http.get to it. Each account can be answered
  at once, three seconds late, with headers and then nothing (stall), with
  half an answer and a dropped connection (drop), or not at all (silent).

  Takes about ninety seconds: the last answer is only used once the site's
  own minute of memory has run out, and that minute is waited out.

  Nothing here touches the repository's data folder or the network. Scratch
  files go under THORNSWOOD_TEMP when it is set.
*/
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('../../tests/site-files');

const SITE = process.argv[2] || path.join(__dirname, '..', '..', 'site', 'server.js');
// The gallery and report pages live in home.js since the scripts left home.html (#1474).
const HOME = fs.readFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'home.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
const fair = (s) => typeof s === 'string' && s.length > 0 && s.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(s);
const QUICK = 1000;
/*
  The site's own waits, read out of the server.js under test (#2358). A page
  load and a Submit wait SUBMIT_WAIT_MS on Discord and then answer anyway;
  everything else waits PLAY_ANSWER_MS. A case answered by the Submit wait is
  checked against those two, not against the wall clock's second: it waited
  at least SUBMIT_WAIT_MS (it asked Discord afresh and did not answer off an
  old reply at once), and it answered well before PLAY_ANSWER_MS (it did not
  wait on Discord in full, which here never answers). That the wait is inside
  a second is checked once, on the number itself.

  Until #2358 these cases asked for under 1000 ms of wall clock. On One the
  Submit about a person took 708 to 718 ms in six runs side by side; on the
  hosted runner (run 38215011581) it took 1566 ms while the page loads in the
  same run took 724 to 741 ms, so that one request took about 850 ms beyond
  the site's wait, for a reason no log from that run shows, and a second
  left 300 ms of room for it. The site's log is printed on any failure now.
*/
const SITE_TEXT = siteFiles.source(SITE);
const constMs = (name) => Number((new RegExp('const ' + name + ' = (\\d+);').exec(SITE_TEXT) || [])[1] || NaN);
const SUBMIT_WAIT_MS = constMs('SUBMIT_WAIT_MS');
const PLAY_ANSWER_MS = constMs('PLAY_ANSWER_MS');
const waitedOut = (got) => got.ms >= SUBMIT_WAIT_MS && got.ms < PLAY_ANSWER_MS;
// The launcher gives the site fifteen seconds (Discord.cs PostJson). Play's
// doors answer inside ten, and a second of room for a slow machine.
const PLAY_BOUND = 11500;
const SLOW_MS = 3000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------- fake Discord --
// Members by id: 'play' holds the role that lets somebody in, 'none' is in
// the server with no role. MODE says how Discord answers about that account.
const MEMBERS = {};
const MODE = {};
const held = new Set();
// When set, every Discord question sends headers and then nothing, so one
// lookup is the member list, then the member, then the role names (#1164).
let stallDiscord = false;
const discord = http.createServer((req, res) => {
  const u = req.url;
  if (stallDiscord) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"user":');
    held.add(res);
    return;
  }
  const out = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (/\/roles$/.test(u)) return out(200, [{ id: 'r1', name: 'Playtester' }, { id: 'r2', name: 'Banned' }, { id: 'r3', name: 'Owner' }]);
  // The bulk list is refused, as with the members intent off, so every
  // account is its own lookup and MODE decides it.
  if (/\/members\?limit=/.test(u)) return out(403, { message: 'Missing Access' });
  if (/\/bans\//.test(u)) return out(404, { message: 'Unknown Ban' });
  const id = u.slice(u.lastIndexOf('/') + 1);
  const m = MEMBERS[id];
  const answer = () => {
    if (!m) return out(404, { message: 'Unknown Member' });
    return out(200, { user: { id, username: 'u' + id, global_name: 'Visitor ' + id }, nick: null,
                      roles: m === 'play' ? ['r1'] : [] });
  };
  const mode = MODE[id] || 'fast';
  if (mode === 'silent') { held.add(res); return; }
  if (mode === 'stall') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"user":');
    held.add(res);
    return;
  }
  if (mode === 'drop') {
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': '400' });
    res.write('{"user":{"id":"' + id + '"');
    setTimeout(() => { try { res.socket.destroy(); } catch (e) { } }, 50);
    return;
  }
  if (mode === 'slow') { setTimeout(answer, SLOW_MS); return; }
  answer();
});
const sockets = new Set();
discord.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

// ------------------------------------------------------- the scratch site --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-site-hangs-'));
const SECRET = crypto.randomBytes(32).toString('hex');
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
fs.copyFileSync(path.join(__dirname, '..', '..', 'site', 'public', 'home.html'), path.join(dir, 'public', 'home.html'));
fs.mkdirSync(path.join(dir, 'feed', 'version'), { recursive: true });
fs.writeFileSync(path.join(dir, 'feed', 'version', '00000001.json'), JSON.stringify({ launcherVersion: '1.1.102', minLauncher: '1.1.100' }));
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: 'g1', invite: '' },
  access: { admin: ['Owner'], play: ['Playtester'], banned: ['Banned'], dev: ['Owner'], slots3: [], jarl: [] },
  botKey: crypto.randomBytes(24).toString('hex'), admins: [], secret: SECRET,
  passKey: crypto.randomBytes(32).toString('hex'),
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
fs.writeFileSync(path.join(dir, 'fake-discord.js'), [
  "const http = require('http'), https = require('https');",
  "const port = Number(process.env.FAKE_DISCORD_PORT);",
  "const real = https.get;",
  "https.get = function (o, cb) {",
  "  if (o && typeof o === 'object' && o.hostname === 'discord.com') {",
  "    return http.get({ host: '127.0.0.1', port: port, path: o.path, headers: o.headers }, cb);",
  "  }",
  "  return real.apply(this, arguments);",
  "};"
].join('\n'));

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
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
/*
  Waits for a line the site says when it settles a request nobody is left to
  answer: a body or an upload whose sender went (#3062). There is no answer
  to read after, so the line itself is the event. The bound only turns a site
  that never says it into a fail, not a hang. soFar is what the harness has
  collected; its own listeners were added first, so it is up to date when
  this looks.
*/
function heard(srv, soFar, re, ms) {
  return new Promise((ok) => {
    if (re.test(soFar())) { ok(true); return; }
    const look = () => { if (re.test(soFar())) end(true); };
    const late = setTimeout(() => end(false), ms);
    function end(v) {
      clearTimeout(late);
      srv.stdout.removeListener('data', look);
      srv.stderr.removeListener('data', look);
      ok(v);
    }
    srv.stdout.on('data', look);
    srv.stderr.on('data', look);
  });
}
const hmac = (v) => crypto.createHmac('sha256', SECRET).update(String(v)).digest('hex').slice(0, 32);
const cookieFor = (id) => {
  const at = String(Date.now());
  const name = 'Visitor ' + id;
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + hmac(id + '|' + name + '|' + at));
};
const ticketFor = (id) => {
  const b = Buffer.from(JSON.stringify({ d: String(id), n: 'Visitor ' + id, x: Date.now() + 86400000 })).toString('base64url');
  return 'tk1.' + b + '.' + hmac('ticket:' + b);
};

let port = 0;
let lane = 0;
// One address per case, so the report form's five an hour is never met.
function ask(method, where, body, opts) {
  const o = opts || {};
  return new Promise((ok) => {
    const data = body == null ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = { 'x-forwarded-for': o.from || ('10.8.0.' + (++lane)) };
    if (method !== 'GET') { headers['content-type'] = o.type || 'application/json'; headers['content-length'] = Buffer.byteLength(data); }
    if (o.as) headers.cookie = cookieFor(o.as);
    // A browser names the page that sent a signed in write, and the site
    // refuses one that names no page (#1367). These come from its own pages.
    if (o.as && method !== 'GET') headers.origin = 'http://127.0.0.1:' + port;
    const started = Date.now();
    const r = http.request({ host: '127.0.0.1', port, method, path: where, headers }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { }
        ok({ status: res.statusCode, j: j || {}, text: buf, ms: Date.now() - started, headers: res.headers });
      });
      res.on('error', () => ok({ status: res.statusCode, j: {}, text: buf, ms: Date.now() - started, headers: res.headers }));
    });
    r.setTimeout(30000, () => r.destroy());
    r.on('error', () => ok({ status: 0, j: {}, text: '', ms: Date.now() - started, headers: {} }));
    r.end(data);
  });
}
/*
  A raw request that sends its headers and only some of its body. Then it
  waits for an answer (hold), or cuts the connection (drop). Host carries the
  port, as every client sends it: the site's own origin is read from Host
  (crossSite), and without the port an Origin naming this site was another
  site's, so the cut upload below was refused before it was read and its
  check passed with nothing tested (#3062).
*/
function partial(where, total, sent, how, extraHeaders) {
  return new Promise((ok) => {
    const started = Date.now();
    const s = net.connect(port, '127.0.0.1');
    let buf = '';
    let done = false;
    const finish = (v) => { if (done) return; done = true; ok(v); };
    s.on('connect', () => {
      s.write('POST ' + where + ' HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nContent-Type: application/json\r\n' +
              'X-Forwarded-For: 10.8.1.' + (++lane) + '\r\n' + (extraHeaders || '') +
              'Content-Length: ' + total + '\r\n\r\n' + 'x'.repeat(sent));
      if (how === 'drop') setTimeout(() => { s.destroy(); finish({ ms: Date.now() - started }); }, 200);
    });
    s.on('data', (d) => { buf += d; });
    const end = () => {
      const code = Number((/^HTTP\/1\.1 (\d+)/.exec(buf) || [])[1] || 0);
      const at = buf.indexOf('\r\n\r\n');
      // Chunked or not, the answer is the one JSON object in the body.
      const b = buf.slice(at + 4);
      let j = {}; try { j = JSON.parse(b.slice(b.indexOf('{'), b.lastIndexOf('}') + 1)); } catch (e) { }
      finish({ status: code, j, ms: Date.now() - started });
    };
    s.on('end', end);
    s.on('close', end);
    s.on('error', () => { });
    setTimeout(() => { try { s.destroy(); } catch (e) { } }, 30000);
  });
}

// ------------------------------------------------------------- the page --
function pageChecks() {
  const ga = HOME.indexOf("} else if (here === '/gallery') {");
  const gb = HOME.indexOf("} else if (here === '/downloads') {");
  const gal = (ga >= 0 && gb > ga) ? HOME.slice(ga, gb) : '';
  yes('home.js has the gallery page', !!gal);
  yes('the gallery does not wait on who is asking before drawing the pictures (#1096)',
      !/Promise\.all\(/.test(gal) &&
      /request\('\/api\/public\?galleryLimit=24'\)[\s\S]{0,200}galData = d[\s\S]{0,40}drawGallery\(\)/.test(gal) &&
      /galWho = w[^;]*;\s*if \(galData\) drawGallery\(\)/.test(gal));
  yes('  and says it is checking until the site says who it is',
      /if \(waiting\)[\s\S]{0,120}Checking who you are\./.test(gal));
  const said = (gal.match(/Thornswood could not ask Discord about your '\s*\+\s*'account[^']*'/) || [''])[0];
  yes('  and a signed in visitor Discord could not be asked about is told that, not to sign in',
      /who\.signed && who\.asked === false/.test(gal) && !!said && fair(said.replace(/'\s*\+\s*'/g, '')));

  const ra = HOME.indexOf("} else if (here === '/report') {");
  const rb = ra < 0 ? -1 : HOME.indexOf('\n}\n', ra);
  const rep = (ra >= 0 && rb > ra) ? HOME.slice(ra, rb) : '';
  yes('home.js has the report page', !!rep);
  yes('the report page reads personWhy and personSays, not canSubmit (#1097)',
      /d\.personWhy/.test(rep) && /d\.personSays/.test(rep) && !/canSubmit/.test(rep));
  yes('  the sign in line shows only when not signed in',
      /needsSignIn = d\.personWhy === 'sign in'/.test(rep) &&
      /sign\.hidden = !on \|\| letIn !== false \|\| !needsSignIn/.test(rep));
  yes('  and otherwise the site\'s own sentence shows, in a line of its own',
      /<p id="rNo" class="hint" hidden><\/p>/.test(rep) && /no\.textContent = personSays/.test(rep) &&
      /no\.hidden = !on \|\| letIn !== false \|\| needsSignIn/.test(rep));
  yes('  and Send it about a person waits until the site has said they may',
      /form\.querySelector\('button'\)\.disabled = on && !letIn/.test(rep));
}

(async function main() {
  pageChecks();
  yes('the site waits ' + SUBMIT_WAIT_MS + ' ms on Discord for a page load or a Submit, inside a second (#1096), ' +
      'and ' + PLAY_ANSWER_MS + ' ms for anything else',
      SUBMIT_WAIT_MS > 0 && SUBMIT_WAIT_MS < QUICK && PLAY_ANSWER_MS > SUBMIT_WAIT_MS + 5000);
  const dport = await new Promise((ok) => discord.listen(0, '127.0.0.1', () => ok(discord.address().port)));
  port = await freePort();
  let log = '';
  const site = spawn(process.execPath, ['-r', path.join(dir, 'fake-discord.js'), path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
                                          FAKE_DISCORD_PORT: String(dport) })
  });
  site.stdout.on('data', (d) => { log += d; });
  site.stderr.on('data', (d) => { log += d; });
  const t0 = Date.now();
  try {
    yes('the scratch site starts', await listening(site, port).then(() => true));
    let r;

    // ----------------------------------------------- #1164 launcher doors --
    // Discord stalls on every question, caches still cold, so a lookup that
    // is not given up on is the member list and then the member, about
    // twenty seconds, and the role names after that when the member answers.
    // Each door has to answer inside Play's ten seconds with the same words
    // /api/play/join uses.
    stallDiscord = true;
    const q = (id) => encodeURIComponent(ticketFor(id));
    const unasked = (got) => got.status === 503 && got.ms < PLAY_BOUND && got.j.why === 'could not ask Discord' &&
      /could not ask Discord about your account/.test(got.j.message || '') && fair(got.j.message || '');
    const [gSub, gRep, gApp, gDel, gDis, whoAll, staffBan] = await Promise.all([
      ask('POST', '/api/gallery/submit?ticket=' + q('801') + '&name=shot.png', 'not-a-picture'),
      ask('POST', '/api/gallery/report?ticket=' + q('802'), { name: 'shot.png', why: 'stall' }),
      ask('POST', '/api/gallery/approve?ticket=' + q('803'), { name: 'shot.png' }),
      ask('DELETE', '/api/gallery/approved?ticket=' + q('804'), { name: 'shot.png' }),
      ask('POST', '/api/gallery/report/dismiss?ticket=' + q('805'), { id: 'none' }),
      ask('POST', '/api/play/who', { ticket: ticketFor('806') }),
      ask('POST', '/api/staff/ban', { id: '1', why: 'stall', minutes: 1 }, { as: '807' })
    ]);
    stallDiscord = false;
    yes('gallery submit with a ticket, Discord stalled: 503 inside the launcher\'s time (' + gSub.ms + ' ms)', unasked(gSub));
    yes('gallery report with a ticket, Discord stalled: 503 inside the launcher\'s time (' + gRep.ms + ' ms)', unasked(gRep));
    yes('staff gallery approve, Discord stalled: 503 inside the launcher\'s time (' + gApp.ms + ' ms)', unasked(gApp));
    yes('staff gallery delete, Discord stalled: 503 inside the launcher\'s time (' + gDel.ms + ' ms)', unasked(gDel));
    yes('staff gallery dismiss, Discord stalled: 503 inside the launcher\'s time (' + gDis.ms + ' ms)', unasked(gDis));
    yes('play/who, every Discord question stalled: 503 inside the launcher\'s time (' + whoAll.ms + ' ms)', unasked(whoAll));
    yes('a staff POST from the hub, Discord stalled: 503 inside the launcher\'s time (' + staffBan.ms + ' ms)', unasked(staffBan));


    // The account whose last answer is used later: asked once while Discord
    // is fast, so the site has an answer for it, then Discord goes silent.
    MEMBERS['714'] = 'play';
    r = await ask('GET', '/api/gallery/who', null, { as: '714' });
    yes('signed in and let in, Discord fast: /api/gallery/who says they can send', r.status === 200 && r.j.canSubmit === true && r.j.asked === true);
    MODE['714'] = 'silent';
    const staleFrom = Date.now();

    // ------------------------------------------ #1094 and Play, all at once --
    MEMBERS['601'] = 'play'; MODE['601'] = 'stall';
    MEMBERS['602'] = 'play'; MODE['602'] = 'drop';
    MEMBERS['603'] = 'play'; MODE['603'] = 'stall';
    MEMBERS['604'] = 'play'; MODE['604'] = 'silent';
    MEMBERS['605'] = 'play'; MODE['605'] = 'stall';
    MEMBERS['606'] = 'play'; MODE['606'] = 'slow';
    MEMBERS['607'] = 'play'; MODE['607'] = 'slow';
    MEMBERS['608'] = 'play'; MODE['608'] = 'stall';
    MEMBERS['609'] = 'play'; MODE['609'] = 'silent';
    MEMBERS['610'] = 'play'; MODE['610'] = 'stall';
    MEMBERS['611'] = 'none';
    MEMBERS['615'] = 'play'; MODE['615'] = 'drop';
    const passBody = (id, pid) => ({ ticket: ticketFor(id), profileId: pid, channel: 'main', version: '1.1.102' });
    const [who601, who602, join603, join604, pass605, join606, pass607, gw608, home609, pub610, gw611, rep611, gwNone, join615] =
      await Promise.all([
        ask('POST', '/api/play/who', { ticket: ticketFor('601') }),
        ask('POST', '/api/play/who', { ticket: ticketFor('602') }),
        ask('POST', '/api/play/join', { ticket: ticketFor('603'), profileId: 6003 }),
        ask('POST', '/api/play/join', { ticket: ticketFor('604'), profileId: 6004 }),
        ask('POST', '/api/play/pass', passBody('605', 6005)),
        ask('POST', '/api/play/join', { ticket: ticketFor('606'), profileId: 6006 }),
        ask('POST', '/api/play/pass', passBody('607', 6007)),
        ask('GET', '/api/gallery/who', null, { as: '608' }),
        ask('GET', '/', null, { as: '609' }),
        ask('GET', '/api/public', null, { as: '610' }),
        ask('GET', '/api/gallery/who', null, { as: '611' }),
        ask('POST', '/api/report', { title: 'person no role', about: 'Brynjolf', kind: 'report' }, { as: '611' }),
        ask('GET', '/api/gallery/who'),
        ask('POST', '/api/play/join', { ticket: ticketFor('615'), profileId: 6015 })
      ]);

    yes('Discord sends headers and stalls: /api/play/who answers 503 inside the launcher\'s time (' + who601.ms + ' ms)',
        who601.status === 503 && who601.ms < PLAY_BOUND && who601.j.why === 'could not ask Discord' &&
        /could not ask Discord about your account/.test(who601.j.message) && fair(who601.j.message));
    yes('Discord drops the connection halfway through its answer: /api/play/who answers 503 inside a second (' + who602.ms + ' ms)',
        who602.status === 503 && who602.ms < QUICK && who602.j.why === 'could not ask Discord' &&
        /could not ask Discord about your account/.test(who602.j.message));
    yes('Play, Discord stalls: /api/play/join answers 503 inside the launcher\'s time (' + join603.ms + ' ms)',
        join603.status === 503 && join603.ms < PLAY_BOUND && join603.j.why === 'could not ask Discord');
    yes('  saying Discord could not be asked, in words',
        /could not ask Discord about your account/.test(join603.j.message) && fair(join603.j.message));
    yes('Play, Discord never answers at all: /api/play/join answers 503 inside the launcher\'s time (' + join604.ms + ' ms)',
        join604.status === 503 && join604.ms < PLAY_BOUND && /could not ask Discord/.test(join604.j.message));
    yes('Play, Discord stalls: /api/play/pass answers 503 inside the launcher\'s time (' + pass605.ms + ' ms)',
        pass605.status === 503 && pass605.ms < PLAY_BOUND && pass605.j.why === 'could not ask Discord' &&
        /could not ask Discord/.test(pass605.j.message) && fair(pass605.j.message));
    yes('Play, Discord drops halfway: /api/play/join answers 503 inside a second (' + join615.ms + ' ms)',
        join615.status === 503 && join615.ms < QUICK && /could not ask Discord/.test(join615.j.message));
    yes('Play, Discord three seconds slow: /api/play/join still lets them in (' + join606.ms + ' ms)',
        join606.status === 200 && join606.j.ok === true && join606.ms >= SLOW_MS - 200 && join606.ms < PLAY_BOUND);
    yes('Play, Discord three seconds slow: /api/play/pass still hands out a pass (' + pass607.ms + ' ms)',
        pass607.status === 200 && pass607.j.ok === true && /^jp1\./.test(pass607.j.pass || '') && pass607.ms < PLAY_BOUND);

    yes('a signed in page load, Discord stalls: /api/gallery/who answers when the site\'s wait runs out (' + gw608.ms + ' ms)',
        gw608.status === 200 && waitedOut(gw608));
    yes('  saying they are signed in and Discord could not be asked, not that they cannot send',
        gw608.j.signed === true && gw608.j.asked === false && gw608.j.canSubmit === false &&
        gw608.j.personWhy === 'could not ask Discord' && /could not ask Discord/.test(gw608.j.personSays) &&
        !/Sign in/.test(gw608.j.personSays) && fair(gw608.j.personSays));
    yes('a signed in page load, Discord silent: the front page answers when the site\'s wait runs out (' + home609.ms + ' ms)',
        home609.status === 200 && waitedOut(home609) && /<html/i.test(home609.text));
    yes('a signed in page load, Discord stalls: /api/public answers when the site\'s wait runs out (' + pub610.ms + ' ms)',
        pub610.status === 200 && waitedOut(pub610));

    yes('signed in with no role (#1097): /api/gallery/who says signed in and not let in, with no sign in',
        gw611.status === 200 && gw611.j.signed === true && gw611.j.asked === true && gw611.j.personWhy === 'role' &&
        !/Sign in/.test(gw611.j.personSays) && /not let into Thornswood/.test(gw611.j.personSays) && fair(gw611.j.personSays));
    yes('  and it is word for word what /api/report answers for them',
        rep611.status === 403 && rep611.j.error === gw611.j.personSays);
    yes('not signed in: /api/gallery/who says to sign in', gwNone.status === 200 && gwNone.j.signed === false &&
        gwNone.j.personWhy === 'sign in' && /Sign in with Discord/.test(gwNone.j.personSays));
    MEMBERS['616'] = 'play';
    r = await ask('GET', '/api/gallery/who', null, { as: '616' });
    yes('signed in and let in: nothing stands in the way of a report about a person',
        r.status === 200 && r.j.canSubmit === true && r.j.personWhy === '' && r.j.personSays === '');

    // --------------------------------------------------------- #1095 bodies --
    MEMBERS['613'] = 'play';
    const tk613 = ticketFor('613');
    const head = '{"ticket":"' + tk613 + '","profileId":6013,"pad":"';
    const atCap = head + 'x'.repeat(8192 - head.length - 2) + '"}';
    const [b1, b2, b3, b4, b5] = await Promise.all([
      ask('POST', '/api/play/join', atCap),
      ask('POST', '/api/play/join', 'x'.repeat(8193)),
      ask('POST', '/api/report', 'x'.repeat(20001)),
      partial('/api/play/pass', 400, 40, 'hold'),
      partial('/api/play/join', 400, 40, 'drop')
    ]);
    yes('a body exactly at the cap is read: /api/play/join lets them in', b1.status === 200 && b1.j.ok === true && Buffer.byteLength(atCap) === 8192);
    yes('one byte over the cap: /api/play/join answers 413 inside a second (' + b2.ms + ' ms)',
        b2.status === 413 && b2.ms < QUICK && b2.j.why === 'too big');
    yes('  saying it was too big and what the most is',
        /too big/.test(b2.j.message) && /8 KB/.test(b2.j.message) && fair(b2.j.message) && b2.j.error === b2.j.message);
    yes('one byte over the cap: /api/report answers 413 inside a second, with words for the page (' + b3.ms + ' ms)',
        b3.status === 413 && b3.ms < QUICK && /too big/.test(b3.j.error) && fair(b3.j.error));
    yes('a body that stops halfway: /api/play/pass answers 408 inside six seconds (' + b4.status + ', ' + b4.ms + ' ms)',
        b4.status === 408 && b4.ms < 6500 && b4.j.why === 'slow' && /too long/.test(b4.j.message) && fair(b4.j.message));
    yes('a body cut off halfway: the route settles and says so in the log',
        await heard(site, () => log, /body closed on "\/api\/play\/join"/, 10000));

    // An upload cut off halfway leaves no half file behind.
    MEMBERS['612'] = 'play';
    r = await ask('GET', '/api/gallery/who', null, { as: '612' });
    const up = path.join(dir, 'uploads');
    const before = fs.existsSync(up) ? fs.readdirSync(up).length : 0;
    await partial('/api/gallery/submit?name=cut.png', 5000, 300, 'drop',
                  'Cookie: ' + cookieFor('612') + '\r\nOrigin: http://127.0.0.1:' + port + '\r\n');
    yes('a picture cut off halfway: the site took it, and says the half file is removed',
        await heard(site, () => log, /upload cut off after \d+ bytes on "\/api\/gallery\/submit", the half file is removed/, 10000));
    const after = fs.existsSync(up) ? fs.readdirSync(up).filter((n) => /cut\.png$/.test(n)).length : 0;
    yes('a picture cut off halfway: no half file is left in uploads (' + before + ' before, ' + after + ' left)', after === 0);

    r = await ask('POST', '/api/report', { title: 'after the bodies', kind: 'bug' });
    yes('the site still answers after all of that', r.status === 200 && r.j.ok === true);

    // ------------------------------------ #1096 the last answer Discord gave --
    const wait = 61500 - (Date.now() - staleFrom);
    if (wait > 0) { console.log('      (waiting ' + Math.round(wait / 1000) + ' s for the site\'s minute of memory to run out)'); await sleep(wait); }
    r = await ask('GET', '/api/gallery/who', null, { as: '714' });
    yes('a signed in page load, Discord silent, a minute on: /api/gallery/who answers when the site\'s wait runs out (' + r.ms + ' ms)',
        r.status === 200 && waitedOut(r));
    yes('  with the last answer Discord gave for them, so they can still send',
        r.j.signed === true && r.j.canSubmit === true && r.j.asked === true);
    r = await ask('POST', '/api/report', { title: 'person stale', about: 'Brynjolf', kind: 'report' }, { as: '714' });
    yes('  a Submit still does not act on an old answer: about a person is 503 when the site\'s wait runs out (' + r.ms + ' ms)',
        r.status === 503 && waitedOut(r) && /could not ask Discord/.test(r.j.error));

    yes('nothing the site did ended in an uncaught exception or unhandled rejection',
        !/uncaught exception|unhandled rejection/.test(log));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    try { site.kill(); } catch (e) { }
    held.forEach((res) => { try { res.destroy(); } catch (e) { } });
    sockets.forEach((s) => { try { s.destroy(); } catch (e) { } });
    discord.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed (' + Math.round((Date.now() - t0) / 1000) + ' s)');
  // On a failure the site's own lines go with it, so a slow answer on a
  // runner nobody can log in to says what the site was doing (#2358).
  if (fail) console.log('---- what the site printed\n' + log);
  process.exit(fail ? 1 : 0);
})();
