/*
  test-help-report.js

      node .\tests\test-help-report.js

  #414: there was no way to ask anybody for help from inside the game, and no
  way to report a person from anywhere. Now /helpme and /report in the game,
  a report-a-person box on the site's report page, and both land in the inbox
  the Discord bot reads into the staff channel.

  FOUR HALVES.

  1. handle(). The two new branches are lifted out of game\gamemode.js the way
     test-help.js lifts /help, and run with a fake character, a fake staff
     test and a toProfile that writes down every line. Both branches have to
     reach the asking staff block and answer through toProfile.

  2. The asking staff block, lifted whole from the end of the gamemode and run
     against a fake mp: the name parsing, the limits, who in the world is told
     (staff, never the person reported), and the reply once the site answers.

  3. The site. The real site\server.js is copied into a scratch folder and run
     on a spare port with a key made here, and the block's own post goes to it
     through a door.json written here, on the dev route the dev server uses.
     The rows have to land in inbox.json, which is what the admins read on the
     hub and what the bot reads into the staff channel. A wrong key, no key,
     an unsigned report about a person and the sixth report in an hour are all
     refused.

  4. The bot. With the Python the bot runs on (tests\bot-python.js: py -3.12
     first, then python, each only if it loads the bot's version check and
     discord.py), the rows the site wrote are handed to bot.report_text, the
     line the staff channel reads. With none, the bot half is a SKIP line
     saying why.

  Nothing leaves this machine and nothing touches the repository's data
  folder. Scratch files go under THORNSWOOD_TEMP when it is set.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
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
const src = fs.readFileSync(GM, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const EMDASH = String.fromCharCode(0x2014);
function fair(s) { return typeof s === 'string' && s.indexOf(EMDASH) < 0 && !/\bplayers?\b/i.test(s); }

// ------------------------------------------------------------ the sources --
const bA = src.indexOf("    if (word === '/helpme' || word === '/help-me' || word === '/report') {");
const bB = bA < 0 ? -1 : src.indexOf("\n    if (word === '/help' || word === '/commands') {", bA);
const branch = (bA >= 0 && bB > bA) ? src.slice(bA, bB) : null;
yes('handle() has a branch for /helpme and /report', branch !== null);

const kA = src.indexOf('// ==== thornswood asking staff ====');
const kB = kA < 0 ? -1 : src.indexOf('// ==== end thornswood asking staff ====', kA);
const block = (kA >= 0 && kB > kA) ? src.slice(kA, kB) : null;
yes('the asking staff block is in the gamemode', block !== null);

const words = (name) => {
  const m = src.match(new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);'));
  try { return m ? new Function('return ' + m[1])() : []; } catch (e) { return []; }
};
const W = words('WORDS'), PW = words('PLAYER_WORDS');
yes('the server answers /helpme, /help-me and /report',
    ['/helpme', '/help-me', '/report'].every((w) => W.indexOf(w) >= 0));
yes('and everybody is told about /helpme and /report',
    PW.indexOf('/helpme') >= 0 && PW.indexOf('/report') >= 0);

// ------------------------------------------------------------ a fake world --
/*
  Profiles 11 (Aela, asking), 12 (Brynjolf, staff, the one reported), 13
  (Farkas, staff), 14 (Lydia Stormblade, nobody in particular).
*/
const WORLD = {
  0xff000011: { profileId: 11, name: 'Aela', cell: 'Whiterun', pos: [1.26, 2, 3] },
  0xff000012: { profileId: 12, name: 'Brynjolf', cell: 'Riften', pos: [0, 0, 0] },
  0xff000013: { profileId: 13, name: 'Farkas', cell: 'Whiterun', pos: [0, 0, 0] },
  0xff000014: { profileId: 14, name: 'Lydia Stormblade', cell: 'Whiterun', pos: [0, 0, 0] }
};
const STAFF = { 12: true, 13: true };
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

// The block, loaded into a context of its own so its globalThis is ours.
const g = {};
function loadBlock() {
  if (!block) return null;
  const run = new Function('mp', 'require', 'globalThis', 'console', 'URL', 'Buffer',
    block + '\nreturn globalThis.__thornswoodAskStaff;');
  return run(fakeMp, require, g, { log() { } }, URL, Buffer);
}
const ask = loadBlock();
yes('the block hands handle() its ask', !!(ask && typeof ask.ask === 'function'));

const EVERY = [];
// A reply collector. Each call to toProfile is written down with who got it.
function collector() {
  const said = [];
  const fn = function (pid, text) { said.push({ pid: pid, text: String(text) }); EVERY.push(String(text)); };
  fn.said = said;
  fn.to = (pid) => said.filter((s) => s.pid === pid).map((s) => s.text);
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

// ------------------------------------------------------ the scratch site --
const TEMP = process.env.THORNSWOOD_TEMP || os.tmpdir();
fs.mkdirSync(TEMP, { recursive: true });
const dir = fs.mkdtempSync(path.join(TEMP, 'ts-help-report-'));
const KEY = crypto.randomBytes(24).toString('hex');
const SECRET = crypto.randomBytes(32).toString('hex');
const ADMIN_ID = '222';
siteFiles.copy(dir, SITE);
fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
  password: crypto.randomBytes(12).toString('hex'),
  discord: { clientId: 'harness-client', clientSecret: 'harness-secret', botToken: '', guildId: '', invite: '' },
  botKey: KEY, admins: [ADMIN_ID], secret: SECRET,
  gameCheckPort: 1, onlineFile: path.join(dir, 'online.json')
}, null, 2));
// The game server's side: server-settings.json names a private folder and the
// door.json in it names the scratch site, with /dev on the end like the dev
// server's does.
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

    // ---------------------------------------------- 1. handle()'s branches --
    function handleLine(text, profileId, actorId, withBlock) {
      const toProfile = collector();
      const parts = String(text).trim().split(/\s+/);
      const word = parts[0].toLowerCase();
      const fn = new Function('word', 'parts', 'profileId', 'actorId', 'toProfile',
        'needCharacter', 'g', 'isDev',
        'return (function () {\n' + branch + '\n    return "fell through";\n  })();');
      const out = fn(word, parts, profileId, actorId, toProfile,
        function () { if (actorId) return true; toProfile(profileId, 'no character'); return false; },
        withBlock === false ? {} : g, function (pid) { return !!STAFF[pid]; });
      return { toProfile, out };
    }

    if (branch && ask) {
      // /helpme: the branch reaches the block, staff hear it at once, and the
      // person asking is answered through toProfile once the site has it.
      let r = handleLine('/helpme stuck in a rock by the gate', 11, 0xff000011);
      yes('/helpme is handled by the branch', r.out === undefined);
      await settle(r.toProfile, 3);
      yes('/helpme tells both members of staff in the world at once',
          r.toProfile.to(12).length === 1 && r.toProfile.to(13).length === 1 &&
          /Aela asks for help at Whiterun: stuck in a rock/.test(r.toProfile.to(13)[0]));
      yes('nobody else in the world hears it', r.toProfile.to(14).length === 0);
      const helpReply = r.toProfile.to(11);
      yes('/helpme answers the person through toProfile, once, after the site took it',
          helpReply.length === 1 && /Your call for help reached staff/.test(helpReply[0]) &&
          /2 members of staff in the world have it now/.test(helpReply[0]) &&
          /staff channel in the Discord/.test(helpReply[0]));
      yes('and in plain words', fair(helpReply[0] || ''));

      // /help-me is the same command.
      r = handleLine('/help-me again', 14, 0xff000014);
      await settle(r.toProfile, 3);
      yes('/help-me is the same command',
          r.toProfile.to(14).some((t) => /Your call for help reached staff/.test(t)));

      // /helpme twice inside five minutes is the same call.
      r = handleLine('/helpme hello?', 11, 0xff000011);
      yes('/helpme again inside five minutes is refused at once, through toProfile',
          r.toProfile.said.length === 1 && r.toProfile.said[0].pid === 11 &&
          /already have your call for help/.test(r.toProfile.said[0].text));

      // /report: resolves a name with a space in it, never tells the person
      // reported, and answers through toProfile.
      r = handleLine('/report lydia stormblade shoved me off the bridge', 11, 0xff000011);
      yes('/report is handled by the branch', r.out === undefined);
      await settle(r.toProfile, 3);
      yes('/report tells staff who and what, with a two word name read whole',
          r.toProfile.to(13).length === 1 &&
          /Aela reported Lydia Stormblade: shoved me off the bridge/.test(r.toProfile.to(13)[0]));
      yes('and the person reported hears nothing', r.toProfile.to(14).length === 0);
      const repReply = r.toProfile.to(11);
      yes('/report answers the person through toProfile once the site took it',
          repReply.length === 1 && /Your report reached staff/.test(repReply[0]) &&
          /Nobody else was told/.test(repReply[0]));

      // A member of staff who is reported is not the one told about it.
      r = handleLine('/report Brynjolf took my sword', 11, 0xff000011);
      await settle(r.toProfile, 2);
      yes('staff who are reported are not told about their own report',
          r.toProfile.to(12).length === 0 && r.toProfile.to(13).length === 1);

      // Same person again inside the hour.
      r = handleLine('/report Brynjolf took my shield too', 11, 0xff000011);
      yes('the same report about the same person inside an hour is refused',
          r.toProfile.said.length === 1 && /You reported them/.test(r.toProfile.said[0].text));

      // Asked wrong, and about yourself.
      r = handleLine('/report', 11, 0xff000011);
      yes('/report on its own says how to use it',
          r.toProfile.said.length === 1 && /\/report Lydia shoved me/.test(r.toProfile.said[0].text));
      r = handleLine('/report Lydia Stormblade', 11, 0xff000011);
      yes('/report with a name and no reason asks for the reason',
          r.toProfile.said.length === 1 && /Say what Lydia Stormblade did/.test(r.toProfile.said[0].text));
      r = handleLine('/report Aela did a thing', 11, 0xff000011);
      yes('reporting yourself is refused', r.toProfile.said.length === 1 && /That is you/.test(r.toProfile.said[0].text));

      // No character: needCharacter answers, nothing is sent.
      r = handleLine('/helpme', 11, 0);
      yes('with no character in the world, needCharacter answers and nothing goes out',
          r.toProfile.said.length === 1 && r.toProfile.said[0].text === 'no character');

      // No block loaded: the branch still answers.
      r = handleLine('/helpme', 11, 0xff000011, false);
      yes('with the block missing the branch still answers through toProfile',
          r.toProfile.said.length === 1 && /open a ticket|Open a ticket/.test(r.toProfile.said[0].text));

      // The per-hour limit: profile 11 has used three; two more and it stops.
      const now = Date.now();
      ask.taken('report', 11, 'x1', now); ask.taken('report', 11, 'x2', now);
      r = handleLine('/report Farkas was rude', 11, 0xff000011);
      yes('the sixth call in an hour from one profile is refused',
          r.toProfile.said.length === 1 && /5 calls to staff from you in the last hour/.test(r.toProfile.said[0].text));

      // The whole server's cap.
      const pids = [];
      for (let i = 0; i < ask.LIMIT.all; i++) { ask.taken('help', 900 + i, '', now); pids.push(900 + i); }
      r = handleLine('/helpme', 13, 0xff000013);
      yes('past the whole server\'s cap everybody is pointed at a ticket',
          r.toProfile.said.length === 1 && /taking a lot of calls/.test(r.toProfile.said[0].text));
      g.__thornswoodAskSeen.by = {}; g.__thornswoodAskSeen.all = [];

      // The site down: staff in the world were still told, and the reply says so.
      fs.writeFileSync(path.join(gameDir, 'private', 'door.json'),
        JSON.stringify({ site: 'http://127.0.0.1:1/dev', key: KEY }));
      r = handleLine('/helpme site is down', 14, 0xff000014);
      await settle(r.toProfile, 3);
      yes('with the site unreachable the reply says staff in the world have it and the Discord does not',
          r.toProfile.to(14).length === 1 && /reached staff in the world/.test(r.toProfile.to(14)[0]) &&
          /could not reach the staff channel/.test(r.toProfile.to(14)[0]));
      fs.writeFileSync(path.join(gameDir, 'private', 'door.json'),
        JSON.stringify({ site: 'http://127.0.0.1:' + port + '/dev', key: KEY }));
      g.__thornswoodAskSeen.by = {}; g.__thornswoodAskSeen.all = [];

      // Every reply the block can give, in plain words.
      yes('every line said in this run follows the words rules (' + EVERY.length + ' lines)',
          EVERY.length > 20 && EVERY.every(fair));
    }

    // ------------------------------------------------------- 2. the site --
    const rows = inbox();
    const help = rows.find((x) => x.kind === 'help' && /stuck in a rock/.test(x.title));
    yes('the call for help landed in the inbox the admins read', !!help);
    yes('with who asked, from which server, and where',
        help && help.by === 'Aela' && help.profileId === 11 &&
        help.from === 'in game on the dev server' && help.cell === 'Whiterun' &&
        help.pos && help.pos[0] === 1.3);
    yes('and it says the profile id is a claim, not proof',
        help && /a claim, not proof/.test(help.detail));
    const rep = rows.find((x) => x.kind === 'report' && x.about === 'Lydia Stormblade');
    yes('the report landed in the inbox, naming who it is about',
        rep && rep.title === 'shoved me off the bridge' && rep.aboutProfileId === 14);

    let r2 = await request(port, 'POST', '/api/report/game', {}, { kind: 'help', profileId: 5 });
    yes('the game route refuses a post with no key', r2.status === 401);
    r2 = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': 'nope' }, { kind: 'help', profileId: 5 });
    yes('and a post with the wrong key', r2.status === 401);
    r2 = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'report', profileId: 5, said: 'x' });
    yes('and a report that names nobody', r2.status === 400);
    r2 = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'help', profileId: 5, said: 'live' });
    yes('the live route takes one too, and says it came from the live game',
        r2.status === 200 && inbox()[0].from === 'in game');
    let codes = [];
    for (let i = 0; i < 5; i++) {
      const x = await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'help', profileId: 6, said: 'n' + i });
      codes.push(x.status);
    }
    yes('the site holds one profile to five an hour whatever the game does',
        codes.slice(0, 5).join() === '200,200,200,200,200' &&
        (await request(port, 'POST', '/api/report/game', { 'X-Thornswood-Key': KEY }, { kind: 'help', profileId: 6 })).status === 429);

    // The public page: a report about a person needs a Discord sign in.
    const before = inbox().length;
    r2 = await request(port, 'POST', '/api/report', {}, { kind: 'report', about: 'Brynjolf', title: 'nobody signed in' });
    yes('the public page refuses an unsigned report about a person, and keeps nothing',
        r2.status === 401 && /Sign in with Discord/.test((r2.j || {}).error || '') && inbox().length === before);
    const at = String(Date.now());
    const sig = crypto.createHmac('sha256', SECRET).update(ADMIN_ID + '|Tester|' + at).digest('hex').slice(0, 32);
    const cookie = 'twa=' + encodeURIComponent(ADMIN_ID + '|Tester|' + at + '|' + sig);
    r2 = await request(port, 'POST', '/api/report', { 'X-Forwarded-For': '203.0.113.9', Cookie: cookie },
      { kind: 'report', about: 'Brynjolf', title: 'harassing people at the inn', by: 'somebody else' });
    const web = inbox()[0];
    yes('signed in, it lands as a report kept against that account',
        r2.status === 200 && web.kind === 'report' && web.about === 'Brynjolf' &&
        web.discordId === ADMIN_ID && web.by === 'Tester' && web.from === 'the public page, signed in');
    r2 = await request(port, 'POST', '/api/report', { 'X-Forwarded-For': '203.0.113.10' },
      { kind: 'bug', title: 'the launcher will not start' });
    yes('a problem still needs no account', r2.status === 200 && inbox()[0].kind === 'bug');

    // --------------------------------------------------------- 3. the bot --
    // The Python the bot itself runs on, not whichever is first on PATH
    // (#2437): on One that is 3.9, which bot\_pyguard.py refuses.
    const py = require('./bot-python').find();
    if (!py.cmd) {
      console.log('SKIP  no Python here loads the bot, so the staff channel line is not checked here ' +
                  '(bot\\tests\\test-reports.py covers it): ' + py.why);
    } else {
      const probe = path.join(dir, 'probe.py');
      fs.writeFileSync(probe, [
        'import json, os, sys',
        'sys.path.insert(0, os.environ["BOT_DIR"])',
        'os.environ.setdefault("DISCORD_TOKEN", "not-a-real-token")',
        'import bot',
        'rows = json.load(open(os.environ["INBOX"], encoding="utf-8"))',
        'out = [bot.report_text(r) for r in rows if r.get("kind") != "ticket"]',
        'print(json.dumps(out))'
      ].join('\n'));
      const said = spawnSync(py.cmd, py.args.concat([probe]), { encoding: 'utf8',
        env: Object.assign({}, process.env, { BOT_DIR: BOT, INBOX: path.join(dir, 'data', 'for-bot', 'inbox.json'),
                                              PYTHONDONTWRITEBYTECODE: '1' }) });
      let lines = [];
      try { lines = JSON.parse(String(said.stdout).trim().split('\n').pop()); } catch (e) { lines = []; }
      yes('the bot reads every one of those rows into a staff channel line', lines.length === inbox().length);
      yes('the call for help reads as one, from the dev server',
          lines.some((l) => /Aela asked for help in game on the dev server/.test(l) && /stuck in a rock/.test(l)));
      yes('the report from the game names both people',
          lines.some((l) => /Aela reported Lydia Stormblade in game/.test(l)));
      yes('the report from the site names the account that sent it',
          lines.some((l) => /Tester reported Brynjolf on the site/.test(l) && l.indexOf('<@' + ADMIN_ID + '>') >= 0));
      yes('and every staff line follows the words rules', lines.every(fair));
    }
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
