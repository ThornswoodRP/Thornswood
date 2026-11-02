/*
  test-3155-report-problem.js

      node .\tests\test-3155-report-problem.js

  #3155. Patrick, 21 Oct: testers get a button that files an issue on the
  board with their log and where they are, in the game and in Discord. This
  is the game's half, end to end; bot\tests\test-3155-problems.py holds the bot's.

  1. THE BUTTON. thornswood-help.js in a stand-in document: Getting help ends
     with Report a problem, a box and Send; Send says 'help:problem <words>'
     to the plugin, on one line; an empty box sends nothing; what is typed
     survives a redraw; a letter typed in the box never closes the panel.
  2. THE PLUGIN. thornswood-front.js sends it on as /problem, which nobody
     types: it is answered by the server and named nowhere as a command.
  3. THE SERVER. handle()'s branch and the asking staff block, lifted from
     game\gamemode.js and run against a fake world: the problem kind, its
     limits, that no staff in the world are pinged, and the answer.
  4. THE SITE. The real site\server.js in a scratch folder: the problem lands
     in inbox.json tied to the session the account's launcher has open on
     that server, which is what the issue links to.
  5. THE BOT. With the Python the bot runs on, bot.problem_issue turns that
     row into the issue, linking that session.
  6. THE HUB AND THE WORDS. /sessions?find= opens on the session; the rule
     "Buttons, not commands" carries Patrick's exception.

  Nothing leaves this machine. Scratch files go under THORNSWOOD_TEMP.
*/
const REPO_DIR = require('path').join(__dirname, '..');
const { spawn, spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const siteFiles = require('./site-files');

const GM = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const SITE = path.join(REPO_DIR, 'site', 'server.js');
const BOT = path.join(REPO_DIR, 'bot');
const CR = String.fromCharCode(13);
const read = (...p) => fs.readFileSync(path.join(REPO_DIR, ...p), 'utf8').split(CR).join('');
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');
const page = read('game', 'ui', 'thornswood-help.js');
const front = read('game', 'plugins', 'thornswood-front.js');
const hub = read('site', 'public', 'hub.js');
const rules = read('docs', 'GAME-SYSTEMS.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
function fair(s) { return typeof s === 'string' && s.indexOf(EMDASH) < 0 && !new RegExp('\\bpla' + 'yers?\\b', 'i').test(s); }

// ------------------------------------------------------------ 1. the button
function unesc(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}
function makeEl(tag) {
  const e = {
    tagName: String(tag).toLowerCase(), attrs: {}, kids: [], children: [], html: '', style: {},
    id: '', className: '', textContent: '', value: '', onclick: null,
    appendChild(c) { this.children.push(c); return c; },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    focus() { },
    querySelectorAll(sel) {
      const tests = sel.split(',').map(function (s) { return matcher(s.trim()); });
      const out = [];
      (function walk(list) {
        list.forEach(function (k) {
          if (tests.some(function (t) { return t(k); })) { out.push(k); }
          walk(k.kids);
        });
      })(this.kids.concat(this.children));
      return out;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  };
  Object.defineProperty(e, 'innerHTML', {
    get() { return this.html; },
    set(h) { this.html = h; this.kids = parse(h); }
  });
  return e;
}
function matcher(sel) {
  const m = /^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)\])?$/i.exec(sel);
  if (!m) { throw new Error('the stand-in page cannot read the selector ' + sel); }
  return function (el) {
    if (m[1] && el.tagName !== m[1].toLowerCase()) { return false; }
    if (m[2] && el.attrs.id !== m[2]) { return false; }
    if (m[3] && !Object.prototype.hasOwnProperty.call(el.attrs, m[3])) { return false; }
    return true;
  };
}
function parse(html) {
  const out = [];
  const tag = /<([a-z0-9]+)((?:\s+[a-z-]+(?:="[^"]*")?)*)\s*\/?>/gi;
  let m;
  while ((m = tag.exec(html))) {
    const el = makeEl(m[1]);
    const attr = /([a-z-]+)(?:="([^"]*)")?/gi;
    let a;
    while ((a = attr.exec(m[2]))) { el.attrs[a[1]] = a[2] == null ? '' : unesc(a[2]); }
    el.id = el.attrs.id || '';
    el.className = el.attrs['class'] || '';
    const shut = html.indexOf('</' + m[1] + '>', tag.lastIndex);
    if ((el.tagName === 'button' || el.tagName === 'p') && shut > 0) { el.textContent = unesc(html.slice(tag.lastIndex, shut)); }
    out.push(el);
  }
  return out;
}
function load(src, initial) {
  const pg = { told: [], sent: [], keys: {} };
  const doc = {
    head: makeEl('head'), body: makeEl('body'), activeElement: null, createElement: makeEl,
    addEventListener(type, fn) { pg.keys[type] = fn; }
  };
  const win = {
    skyrimPlatform: { sendMessage(to, what) { pg.told.push(to + ' ' + what); } },
    thornswoodNet: { say(line) { pg.sent.push(line); return true; } },
    innerWidth: 1920, innerHeight: 1080,
    addEventListener() { }
  };
  Object.assign(win, initial || {});
  new Function('window', 'document', src)(win, doc);
  pg.win = win;
  pg.doc = doc;
  pg.root = doc.body.children[0];
  return pg;
}
function key(pg, k) { pg.keys.keydown({ key: k, preventDefault() { } }); }
{
  const h = load(page);
  const help = h.win.thornswoodHelp;
  help.open('help');
  const root = h.root;
  const box = () => root.querySelector('#ts-help-ptext');
  const send = () => root.querySelector('#ts-help-psend');
  const said = () => root.querySelector('#ts-help-psaid');
  yes('1 Getting help ends with Report a problem, a box and Send',
      !!box() && !!send() && /<h3>Report a problem<\/h3>/.test(root.querySelector('#ts-help-body').html) &&
      send().textContent === 'Send');
  yes('1 and only there', (help.open('talking'), !box()) && (help.open('help'), !!box()));
  const told = () => h.told.filter((t) => /help:problem/.test(t));
  send().onclick();
  yes('1 an empty box sends nothing and says why', told().length === 0 && said().textContent === 'Say what went wrong first.');
  box().value = 'The door\n  to the   inn will not open';
  box().oninput();
  help.setKeys({ help: 'F9' });
  yes('1 what is typed survives a redraw', /The door/.test(box().html || '') || /The door/.test(root.querySelector('#ts-help-body').html));
  box().value = 'The door\n  to the   inn will not open';
  send().onclick();
  yes('1 Send says it to the plugin on one line', told().length === 1 &&
      told()[0] === 'thornswood-front help:problem The door to the inn will not open');
  yes('1 empties the box and says the chat has the answer',
      box().value === '' && said().textContent === 'Sent. The chat says when it reaches the site.');
  box().value = 'x'.repeat(1500);
  send().onclick();
  yes('1 at most 1000 characters go', told()[1].length === 'thornswood-front help:problem '.length + 1000);
  h.doc.activeElement = { tagName: 'TEXTAREA' };
  key(h, 'F9');
  yes('1 the help key typed in the box is a letter, not a close', help.isOpen());
  key(h, 'Escape');
  yes('1 Escape still closes it', !help.isOpen());
  h.doc.activeElement = null;
  yes('1 the page sends the server nothing itself', h.sent.length === 0);
  yes('1 its words are fair', fair(root.querySelector('#ts-help-body').html));
}

// ------------------------------------------------------------ 2. the plugin
yes('2 the plugin sends help:problem on to the server as /problem, on one line',
    /if \(what\.indexOf\('help:problem '\) === 0\) \{\s*const text = what\.slice\(13\)\.replace\(\/\\s\+\/g, ' '\)\.trim\(\)\.slice\(0, 1000\);\s*if \(text\) \{[^}]*tellServer\('\/problem ' \+ text\); \}/.test(front));

// ------------------------------------------------------------ 3. the server
const bA = src.indexOf("    if (word === '/problem') {");
const bB = bA < 0 ? -1 : src.indexOf("\n    /*", bA);
const branch = (bA >= 0 && bB > bA) ? src.slice(bA, bB) : null;
yes('3 handle() has a branch for /problem', branch !== null);
const kA = src.indexOf('// ==== thornswood asking staff ====');
const kB = kA < 0 ? -1 : src.indexOf('// ==== end thornswood asking staff ====', kA);
const block = (kA >= 0 && kB > kA) ? src.slice(kA, kB) : null;
const words = (name) => {
  const m = src.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'));
  try { return m ? new Function('return ' + m[1])() : []; } catch (e) { return []; }
};
yes('3 the server answers /problem, and nobody is told to type it',
    words('WORDS').indexOf('/problem') >= 0 && words('PLAYER_WORDS').indexOf('/problem') < 0 &&
    page.replace(/\/\*[\s\S]*?\*\//g, '').indexOf('/problem') < 0);

const WORLD = {
  0xff000011: { profileId: 11, name: 'Aela', cell: 'Whiterun, The Bannered Mare', pos: [1.26, 2, 3] },
  0xff000013: { profileId: 13, name: 'Farkas', cell: 'Whiterun', pos: [0, 0, 0] }
};
const STAFF = { 13: true };
const fakeMp = {
  get(id, prop) {
    if (id === 0 && prop === 'onlinePlayers') return Object.keys(WORLD).map(Number);
    const a = WORLD[id];
    if (!a) throw new Error('no such actor');
    if (prop === 'profileId') return a.profileId;
    if (prop === 'appearance') return { name: a.name };
    if (prop === 'pos') return a.pos;
    if (prop === 'worldOrCellDesc') return a.cell;
    return undefined;
  }
};
const g = {};
const ask = block ? new Function('mp', 'require', 'globalThis', 'console', 'URL', 'Buffer',
  block + '\nreturn globalThis.__thornswoodAskStaff;')(fakeMp, require, g, { log() { } }, URL, Buffer) : null;
const EVERY = [];
function collector() {
  const s = [];
  const fn = function (pid, text) { s.push({ pid: pid, text: String(text) }); EVERY.push(String(text)); };
  fn.said = s;
  fn.to = (pid) => s.filter((x) => x.pid === pid).map((x) => x.text);
  return fn;
}
function settle(fn, n, ms) {
  return new Promise((ok) => {
    const until = Date.now() + (ms || 10000);
    (function look() {
      if (fn.said.length >= n || Date.now() > until) return ok();
      setTimeout(look, 20);
    })();
  });
}
function handleLine(text, profileId, actorId) {
  const toProfile = collector();
  const parts = String(text).trim().split(/\s+/);
  const word = parts[0].toLowerCase();
  const fn = new Function('word', 'parts', 'profileId', 'actorId', 'toProfile', 'needCharacter', 'g', 'isDev',
    'return (function () {\n' + branch + '\n    return "fell through";\n  })();');
  const out = fn(word, parts, profileId, actorId, toProfile,
    function () { if (actorId) return true; toProfile(profileId, 'no character'); return false; },
    g, function (pid) { return !!STAFF[pid]; });
  return { toProfile, out };
}

// ------------------------------------------------------ the scratch site --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-3155-'));
const KEY = crypto.randomBytes(24).toString('hex');
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: KEY, admins: ['222'], secret: crypto.randomBytes(32).toString('hex'),
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
// Aela's account holds profile 11. Its launcher has a dev session open now,
// an older main one open (a machine that never said its end), and a dev one
// that ended; Farkas's account has one open too.
const ACCT = '555000111';
const NOW = Date.now();
fs.writeFileSync(path.join(dir, 'data', 'linked.json'), JSON.stringify({
  [ACCT]: { name: 'aela', profiles: [11] }, '555000999': { name: 'farkas', profiles: [13] }
}));
const S = (session, who, channel, start, end) => ({ session, who, name: '', profile: 0, channel, version: '1.2.3',
  start, end, minutes: 0, why: '', note: '' });
fs.writeFileSync(path.join(dir, 'data', 'sessions.json'), JSON.stringify([
  S('dev-ended-1', ACCT, 'dev', NOW - 7200000, NOW - 3600000),
  S('main-open-old', ACCT, 'main', NOW - 600000, 0),
  S('dev-open-now', ACCT, 'dev', NOW - 300000, 0),
  S('farkas-open', '555000999', 'dev', NOW - 100000, 0)
]));
const gameDir = path.join(dir, 'game');
fs.mkdirSync(path.join(gameDir, 'private'), { recursive: true });
fs.writeFileSync(path.join(gameDir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));

function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function request(port, method, where, headers, body) {
  return new Promise((ok) => {
    const data = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  // A browser names the page that sent a signed in write, and the site
  // refuses one that names no page (#1367). These come from its own pages.
    const signed = method !== 'GET' && Object.keys(headers || {}).some((k) => k.toLowerCase() === 'cookie');
    const r = http.request({ host: '127.0.0.1', port, method, path: where,
      headers: Object.assign({ 'content-type': 'application/json',
                               'content-length': Buffer.byteLength(data) },
                             signed ? { origin: 'http://127.0.0.1:' + port } : {}, headers || {}) },
    (res) => {
      let buf = '';
      res.on('data', (d) => { buf += d; });
      res.on('end', () => { let j = null; try { j = JSON.parse(buf); } catch (e) { } ok({ status: res.statusCode, j }); });
    });
    r.on('error', () => ok({ status: 0, j: null }));
    r.end(data);
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
const inbox = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'for-bot', 'inbox.json'), 'utf8')); } catch (e) { return []; } };

(async function main() {
  const port = await freePort();
  const site = spawn(process.execPath, [path.join(dir, 'server.js')], {
    cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  const home = process.cwd();
  try {
    yes('the scratch site starts', await listening(site, port).then(() => true));
    fs.writeFileSync(path.join(gameDir, 'private', 'door.json'),
      JSON.stringify({ site: 'http://127.0.0.1:' + port + '/dev', key: KEY }));
    process.chdir(gameDir);

    if (branch && ask) {
      let r = handleLine('/problem The door to the inn will not open', 11, 0xff000011);
      yes('3 /problem is handled by its branch', r.out === undefined);
      await settle(r.toProfile, 1);
      yes('3 nobody from staff in the world is pinged: a problem is for the board', r.toProfile.to(13).length === 0);
      const reply = r.toProfile.to(11);
      yes('3 the person is answered once the site has it, and told the logs go when the game closes',
          reply.length === 1 && /Your problem report reached the site and goes on the board/.test(reply[0]) &&
          /logs of this game once you close it/.test(reply[0]));
      r = handleLine('/problem The door to the inn will not open', 11, 0xff000011);
      yes('3 the same problem again inside the hour is not sent twice',
          r.toProfile.said.length === 1 && /You sent that problem/.test(r.toProfile.said[0].text));
      r = handleLine('/problem', 11, 0xff000011);
      yes('3 nothing said is asked for', r.toProfile.said.length === 1 && /Say what went wrong/.test(r.toProfile.said[0].text));
      r = handleLine('/problem ' + 'long '.repeat(400), 11, 0xff000011);
      await settle(r.toProfile, 1);
      const now = Date.now();
      ask.taken('help', 11, '', now); ask.taken('help', 11, '', now); ask.taken('help', 11, '', now);
      r = handleLine('/problem one more thing', 11, 0xff000011);
      yes('3 the sixth in an hour is refused, pointing at #test-findings',
          r.toProfile.said.length === 1 && /reports and calls to staff from you in the last hour/.test(r.toProfile.said[0].text) &&
          /#test-findings/.test(r.toProfile.said[0].text));
      g.__thornswoodAskSeen.by = {}; g.__thornswoodAskSeen.all = [];
      fs.writeFileSync(path.join(gameDir, 'private', 'door.json'), JSON.stringify({ site: 'http://127.0.0.1:1/dev', key: KEY }));
      r = handleLine('/problem site is down now', 11, 0xff000011);
      await settle(r.toProfile, 1);
      yes('3 with the site unreachable it says nothing was filed and where to post it',
          r.toProfile.to(11).length === 1 && /could not reach the site, so nothing was filed/.test(r.toProfile.to(11)[0]));
      fs.writeFileSync(path.join(gameDir, 'private', 'door.json'), JSON.stringify({ site: 'http://127.0.0.1:' + port + '/dev', key: KEY }));
      r = handleLine('/problem no character', 11, 0);
      yes('3 with no character in the world nothing goes out', r.toProfile.said.length === 1 && r.toProfile.said[0].text === 'no character');
      yes('3 every line it said is fair (' + EVERY.length + ')', EVERY.length >= 6 && EVERY.every(fair));
    }

    // ------------------------------------------------------- 4. the site --
    const rows = inbox();
    const p = rows.find((x) => x.kind === 'problem' && /door to the inn/.test(x.title));
    yes('4 the problem lands in the inbox as a problem, with what was said', !!p && p.title === 'The door to the inn will not open');
    yes('4 with who, where the server had them, and which server',
        p && p.by === 'Aela' && p.profileId === 11 && p.cell === 'Whiterun, The Bannered Mare' &&
        p.pos[0] === 1.3 && p.server === 'dev' && p.from === 'in game on the dev server');
    yes('4 tied to the account and the session its launcher has open on that server, not an older or ended one',
        p && p.discordId === ACCT && p.session === 'dev-open-now');
    yes('4 and no staff sentence, since none were told', p && !/staff in the world/.test(p.detail));
    const long = rows.find((x) => x.kind === 'problem' && /^long long/.test(x.title));
    yes('4 a long one is kept to 1000 characters (less the space the cut leaves at its end)',
        !!long && long.title.length <= 1000 && long.title.length >= 995 && long.title === long.title.trim());
    let r2 = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'problem', profileId: 13, said: '' });
    yes('4 a problem with nothing said is refused', r2.status === 400);
    r2 = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'problem', profileId: 13, said: 'main one' });
    yes('4 from the live server, a session open on dev is not taken for it',
        r2.status === 200 && inbox()[0].server === 'main' && inbox()[0].session === '');
    r2 = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'problem', profileId: 77, said: 'nobody' });
    yes('4 a profile no account holds has no session and no account', r2.status === 200 &&
        inbox()[0].discordId === '' && inbox()[0].session === '');
    r2 = await request(port, 'POST', '/api/report/game', {}, { kind: 'problem', profileId: 11, said: 'x' });
    yes('4 and the route still takes nothing without the key', r2.status === 401);

    // --------------------------------------------------------- 5. the bot --
    const py = require('./bot-python').find();
    if (!py.cmd) {
      console.log('SKIP  no Python here loads the bot, so the issue is not made here ' +
                  '(bot\\tests\\test-3155-problems.py covers it): ' + py.why);
    } else {
      const probe = path.join(dir, 'probe.py');
      fs.writeFileSync(probe, [
        'import json, os, sys',
        'sys.path.insert(0, os.environ["BOT_DIR"])',
        'os.environ.setdefault("DISCORD_TOKEN", "not-a-real-token")',
        'import bot',
        'rows = json.load(open(os.environ["INBOX"], encoding="utf-8"))',
        'out = [bot.problem_issue(r) for r in rows if r.get("kind") == "problem"]',
        'print(json.dumps(out))'
      ].join('\n'));
      const out = spawnSync(py.cmd, py.args.concat([probe]), { encoding: 'utf8',
        env: Object.assign({}, process.env, { BOT_DIR: BOT, INBOX: path.join(dir, 'data', 'for-bot', 'inbox.json'),
                                              PYTHONDONTWRITEBYTECODE: '1' }) });
      let issues = [];
      try { issues = JSON.parse(String(out.stdout).trim().split('\n').pop()); } catch (e) { issues = []; }
      const it = issues.find((x) => x[0] === 'The door to the inn will not open');
      yes('5 the bot makes the issue from the row: its title is what was said', !!it);
      yes('5 its logs line links that game\'s session on the hub',
          !!it && it[1].indexOf('/sessions?find=dev-open-now') > 0 && /on the dev server/.test(it[1]));
      yes('5 and says where and who', !!it && /Whiterun, The Bannered Mare, at 1\.3, 2, 3/.test(it[1]) &&
          /Aela, profile 11, Discord account 555000111/.test(it[1]));
    }

    // -------------------------------------------- 6. the hub and the words --
    yes('6 /sessions?find= starts the page search with it, and a session id is searched',
        /var f = new URLSearchParams\(location\.search\)\.get\('find'\);\s*if \(f\) SFIND\.q = String\(f\)\.slice\(0, 80\);/.test(hub) &&
        /var hay = \[\s*s\.session, /.test(hub));
    yes('6 and opens the one person it leaves', /\(mq \|\| \(SFIND\.q && people\.length === 1\) \? ' open' : ''\)/.test(hub));
    yes('6 the inbox calls it a problem', /n\.kind === 'ticket' \|\| n\.kind === 'problem'\) \? n\.kind : 'bug'/.test(hub));
    yes('6 "Buttons, not commands" carries the exception, with its date', /Report a problem/.test(rules) && /21 Oct/.test(rules) && /#3155/.test(rules));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack ? e.stack : e), false);
  } finally {
    process.chdir(home);
    try { site.kill(); } catch (e) { }
    setTimeout(() => {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
      console.log('');
      console.log(pass + ' passed, ' + fail + ' failed');
      process.exit(fail ? 1 : 0);
    }, 300);
  }
})();
