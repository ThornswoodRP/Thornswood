/*
  test-submit-answers.js

      node .\site\tests\test-submit-answers.js [path\to\server.js]

  #467: nobody who presses Submit waits on a timeout to hear back.

  Every request to the site asked Discord who a signed in visitor is before it
  looked at what they sent, and each question to Discord is given ten seconds
  (discordGet). The guild list and then the single member are two questions,
  so with Discord slow or not answering, a signed in visitor pressing Send it
  on the report page watched the button for twenty seconds. Then a report
  about a person was told "Sign in with Discord", which they were. The same
  wait sat in front of the gallery's Send it and Report buttons.

  The Discord bot's ticket form had the same shape and was fixed on
  24 September (bot/bot.py, the push to the site is no longer awaited before
  the reply; bot/tests/test-ticket.py holds it). This is the site's half.

  The real site\server.js is copied into a scratch folder and run on a spare
  port. Discord is a small server in this process that the site is pointed at
  by a preload which turns https.get to discord.com into http.get to it, so
  the site's own discordGet, memberOf, standing and who all run. It can answer
  at once, answer after three seconds, or never answer.

  Every path of the report form's Submit is driven over http and has to
  answer inside a second with the words the page shows. The page itself has
  to say it is sending, and give up with a clear message rather than wait
  forever.

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
// The home page's script, which moved out of home.html into home.js in #1479
// (no inline script under the content security policy).
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

// ---------------------------------------------------------- fake Discord --
/*
  Members by id. 'play' holds the role that lets somebody in, 'none' is in
  the server with no role, 'banned' holds the Banned role. Anybody not listed
  is not in the server. mode is how Discord behaves right now.
*/
const MEMBERS = {};
let mode = 'fast';
const SLOW_MS = 3000;
const held = new Set();
const asked = {};
const discord = http.createServer((req, res) => {
  const who = req.url.slice(req.url.lastIndexOf('/') + 1);
  asked[who] = (asked[who] || 0) + 1;
  const answer = () => {
    const u = req.url;
    const out = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (/\/roles$/.test(u)) return out(200, [{ id: 'r1', name: 'Playtester' }, { id: 'r2', name: 'Banned' }]);
    // The bulk list is refused, as it is when the members intent is off, so
    // every visitor is a single lookup and the cache of the list stays out
    // of the way between cases.
    if (/\/members\?limit=/.test(u)) return out(403, { message: 'Missing Access' });
    const id = u.slice(u.lastIndexOf('/') + 1);
    const m = MEMBERS[id];
    if (!m) return out(404, { message: 'Unknown Member' });
    return out(200, { user: { id, username: 'u' + id, global_name: 'Visitor ' + id }, nick: null,
                      roles: m === 'play' ? ['r1'] : (m === 'banned' ? ['r2'] : []) });
  };
  if (mode === 'hang') { held.add(res); return; }
  if (mode === 'slow') { setTimeout(answer, SLOW_MS); return; }
  answer();
});
const sockets = new Set();
discord.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

// ------------------------------------------------------- the scratch site --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-submit-answers-'));
const SECRET = crypto.randomBytes(32).toString('hex');
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret',
             botToken: 'harness-bot', guildId: 'g1', invite: '' },
  access: { admin: ['Owner'], play: ['Playtester'], banned: ['Banned'], dev: ['Owner'], slots3: [], jarl: [] },
  botKey: crypto.randomBytes(24).toString('hex'), admins: [], secret: SECRET,
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
// Discord for the site is the fake above. Only discord.com is moved; nothing
// else the site might ask for is touched.
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
const cookieFor = (id) => {
  const at = String(Date.now());
  const name = 'Visitor ' + id;
  const sig = crypto.createHmac('sha256', SECRET).update(id + '|' + name + '|' + at).digest('hex').slice(0, 32);
  return 'twa=' + encodeURIComponent(id + '|' + name + '|' + at + '|' + sig);
};
let port = 0;
let lane = 0;
// One address per case (the site reads X-Forwarded-For from loopback), so
// the five an hour limit is only met where a case is about it.
function post(where, body, opts) {
  const o = opts || {};
  return new Promise((ok) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'content-type': o.type || 'application/json',
                      'content-length': Buffer.byteLength(data),
                      'x-forwarded-for': o.from || ('10.9.0.' + (++lane)) };
    // A browser names the page that sent a signed in write, and the site
    // refuses one that names no page (#1367). These come from its own pages.
    if (o.as) { headers.cookie = cookieFor(o.as); headers.origin = 'http://127.0.0.1:' + port; }
    const started = Date.now();
    const r = http.request({ host: '127.0.0.1', port, method: 'POST', path: where, headers }, (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => {
        let j = null; try { j = JSON.parse(buf); } catch (e) { }
        ok({ status: res.statusCode, j: j || {}, ms: Date.now() - started, headers: res.headers });
      });
    });
    r.setTimeout(30000, () => r.destroy());
    r.on('error', () => ok({ status: 0, j: {}, ms: Date.now() - started, headers: {} }));
    r.end(data);
  });
}
const inbox = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'for-bot', 'inbox.json'), 'utf8')); } catch (e) { return []; } };
const kept = (title) => inbox().filter((r) => r.title === title);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- the page --
function pageChecks() {
  const a = HOME.indexOf("} else if (here === '/report') {");
  const b = a < 0 ? -1 : HOME.indexOf('\n}\n', a);
  const page = (a >= 0 && b > a) ? HOME.slice(a, b) : '';
  yes('home.js has the report page', !!page);
  const sub = page.slice(page.indexOf("form.addEventListener('submit'"));
  yes('pressing Send it says it is sending, on the button and under it',
      /btn\.textContent\s*=\s*'Sending'/.test(sub) && /said\.textContent\s*=\s*'Sending it\.'/.test(sub));
  yes('the page stops waiting by itself (an AbortController on the fetch, with a timer)',
      /new AbortController\(\)/.test(sub) && /signal:/.test(sub) && /\.abort\(\)/.test(sub) &&
      /setTimeout\(/.test(sub));
  const gaveUp = (sub.match(/'No answer from the site[^']*'/) || [''])[0];
  yes('and says so in words when it does', /No answer from the site/.test(gaveUp) && fair(gaveUp));
  // The button's own label, read off its markup (Send report since #1585),
  // is what it says again once the answer is in.
  const label = (page.match(/<button class="btn first" type="submit">([^<]+)<\/button>/) || [])[1] || '';
  yes('the button comes back as its own label afterwards (' + label + ')',
      !!label && new RegExp("btn\\.textContent\\s*=\\s*'" + label + "'").test(sub));
  yes('an answer that is not JSON still ends in a message, not a stuck button',
      /r\.json\(\)\.catch\(/.test(sub));
}

(async function main() {
  pageChecks();
  const dport = await new Promise((ok) => discord.listen(0, '127.0.0.1', () => ok(discord.address().port)));
  port = await freePort();
  const site = spawn(process.execPath, ['-r', path.join(dir, 'fake-discord.js'), path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
                                          FAKE_DISCORD_PORT: String(dport) })
  });
  try {
    yes('the scratch site starts', await listening(site, port).then(() => true));
    let r;

    // --------------------------------------------------- not signed in --
    r = await post('/api/report', { title: 'bug not signed in', detail: 'x', kind: 'bug' });
    yes('not signed in, a problem: 200 inside a second (' + r.ms + ' ms)', r.status === 200 && r.j.ok && r.ms < QUICK);
    yes('  and it is in the inbox as a bug', kept('bug not signed in').length === 1 && kept('bug not signed in')[0].kind === 'bug');

    r = await post('/api/report', { title: 'idea not signed in', kind: 'idea' });
    yes('not signed in, an idea: 200 inside a second (' + r.ms + ' ms)', r.status === 200 && r.ms < QUICK &&
        kept('idea not signed in').length === 1 && kept('idea not signed in')[0].kind === 'idea');

    r = await post('/api/report', { title: '   ', detail: 'nothing on the first line' });
    yes('nothing in the first box: 400 inside a second with what to do (' + r.ms + ' ms)',
        r.status === 400 && r.ms < QUICK && /say what happened in the first box/.test(r.j.error) && fair(r.j.error));

    r = await post('/api/report', { title: 'filled by a script', homepage: 'http://spam' });
    yes('the hidden field filled in: 200 inside a second and nothing kept (' + r.ms + ' ms)',
        r.status === 200 && r.ms < QUICK && kept('filled by a script').length === 0);

    r = await post('/api/report', 'this is not json');
    yes('a body that is not JSON: 400 inside a second (' + r.ms + ' ms)', r.status === 400 && r.ms < QUICK);

    r = await post('/api/report', { title: 'person not signed in', about: 'Somebody', kind: 'report' });
    yes('not signed in, about a person: 401 inside a second, told to sign in (' + r.ms + ' ms)',
        r.status === 401 && r.ms < QUICK && /Sign in with Discord/.test(r.j.error) && fair(r.j.error) &&
        kept('person not signed in').length === 0);

    for (let i = 0; i < 5; i++) await post('/api/report', { title: 'flood ' + i }, { from: '10.9.9.9' });
    r = await post('/api/report', { title: 'flood 6' }, { from: '10.9.9.9' });
    yes('the sixth in an hour: 429 inside a second, saying when to try again (' + r.ms + ' ms)',
        r.status === 429 && r.ms < QUICK && /five reports/.test(r.j.error) && /Try again in/.test(r.j.error) &&
        fair(r.j.error) && Number(r.headers['retry-after']) > 0);

    // --------------------------------- signed in, Discord answering fast --
    MEMBERS['504'] = 'play'; MEMBERS['505'] = 'none'; MEMBERS['506'] = 'banned';
    mode = 'fast';
    r = await post('/api/report', { title: 'person fast', about: 'Brynjolf', kind: 'report' }, { as: '504' });
    yes('signed in and let in, about a person: 200 inside a second (' + r.ms + ' ms)', r.status === 200 && r.ms < QUICK);
    const row = kept('person fast')[0] || {};
    yes('  kept against their Discord account, about who they named',
        row.kind === 'report' && row.discordId === '504' && row.about === 'Brynjolf');

    r = await post('/api/report', { title: 'person no role', about: 'Brynjolf', kind: 'report' }, { as: '505' });
    yes('signed in with no role that lets them in: 403 inside a second, not told to sign in (' + r.ms + ' ms)',
        r.status === 403 && r.ms < QUICK && !/Sign in/.test(r.j.error) && /not let into Thornswood/.test(r.j.error) &&
        fair(r.j.error) && kept('person no role').length === 0);

    r = await post('/api/report', { title: 'person banned', about: 'Brynjolf', kind: 'report' }, { as: '506' });
    yes('signed in and banned: 403 inside a second, told so (' + r.ms + ' ms)',
        r.status === 403 && r.ms < QUICK && /banned/.test(r.j.error) && fair(r.j.error) &&
        kept('person banned').length === 0);

    // ------------------------------------ signed in, Discord not answering --
    MEMBERS['501'] = 'play'; MEMBERS['502'] = 'play'; MEMBERS['507'] = 'play'; MEMBERS['508'] = 'play';
    mode = 'hang';
    r = await post('/api/report', { title: 'bug discord hangs', kind: 'bug' }, { as: '501' });
    yes('signed in, Discord not answering, a problem: 200 inside a second (' + r.ms + ' ms)',
        r.status === 200 && r.j.ok && r.ms < QUICK && kept('bug discord hangs').length === 1);

    r = await post('/api/report', { title: 'person discord hangs', about: 'Brynjolf', kind: 'report' }, { as: '502' });
    yes('signed in, Discord not answering, about a person: 503 inside a second (' + r.ms + ' ms)',
        r.status === 503 && r.ms < QUICK);
    yes('  saying Discord could not be asked, not "sign in", and that a problem still goes',
        /could not ask Discord/.test(r.j.error) && !/Sign in/.test(r.j.error) && /problem or an idea/.test(r.j.error) &&
        fair(r.j.error) && kept('person discord hangs').length === 0);

    r = await post('/api/report', { title: 'again', about: 'Brynjolf', kind: 'report' }, { as: '502' });
    yes('pressing it again while Discord still has not answered: 503 inside a second (' + r.ms + ' ms)',
        r.status === 503 && r.ms < QUICK);
    yes('  and Discord is still asked once about that account, not once per press (' + asked['502'] + ')',
        asked['502'] === 1);

    r = await post('/api/gallery/report', { name: 'shot.png', why: 'x' }, { as: '507' });
    yes('the gallery Report button, Discord not answering: 503 inside a second, not "sign in" (' + r.ms + ' ms)',
        r.status === 503 && r.ms < QUICK && /could not ask Discord/.test(r.j.error) && !/Sign in/.test(r.j.error) &&
        fair(r.j.error));

    r = await post('/api/gallery/submit?name=shot.png', 'not really a picture', { as: '508', type: 'image/png' });
    yes('the gallery Send it button, Discord not answering: 503 inside a second, not "sign in" (' + r.ms + ' ms)',
        r.status === 503 && r.ms < QUICK && /could not ask Discord/.test(r.j.error) && !/Sign in/.test(r.j.error) &&
        fair(r.j.error));

    // ------------------------------- signed in, Discord answering slowly --
    // The question keeps going after the visitor has been answered, so the
    // next press has it.
    MEMBERS['503'] = 'play';
    mode = 'slow';
    r = await post('/api/report', { title: 'person slow', about: 'Brynjolf', kind: 'report' }, { as: '503' });
    yes('signed in, Discord three seconds slow, about a person: 503 inside a second (' + r.ms + ' ms)',
        r.status === 503 && r.ms < QUICK && /could not ask Discord/.test(r.j.error));
    await sleep(SLOW_MS * 2 + 800);
    r = await post('/api/report', { title: 'person slow', about: 'Brynjolf', kind: 'report' }, { as: '503' });
    yes('once Discord has answered, the same press goes through inside a second (' + r.ms + ' ms)',
        r.status === 200 && r.ms < QUICK && (kept('person slow')[0] || {}).discordId === '503');

    r = await post('/api/report', { title: 'bug discord slow', kind: 'bug' }, { as: '509' });
    yes('signed in, Discord slow, a problem: 200 inside a second (' + r.ms + ' ms)',
        r.status === 200 && r.ms < QUICK && kept('bug discord slow').length === 1);
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    try { site.kill(); } catch (e) { }
    held.forEach((res) => { try { res.destroy(); } catch (e) { } });
    sockets.forEach((s) => { try { s.destroy(); } catch (e) { } });
    discord.close();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
