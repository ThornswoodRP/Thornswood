// test-for-bot-folder.js
//
// The site writes what the bot reads, trouble.json, inbox.json and
// moderation.log, into data\for-bot and nowhere else, and moves the copies a
// site from before left directly in data into it (issue #1102).
//
// WHY THIS EXISTS. The bot runs as its own account, NT SERVICE\ThornswoodBot,
// and was granted read on every file in the site's data folder because those
// three sat there beside the site's own records: sessions.json, signins.json,
// linked.json and the rest. So the bot's account could read the site's
// session records. Now the three have a folder of their own and the bot is
// granted read on that alone (scripts\vps\Bot-Service.ps1, which
// tests\test-bot-service.ps1 reads back).
//
// It copies the real server.js into a scratch folder with the three files and
// sessions.json directly in data, starts it on a spare port, and checks:
//   - each of the three is moved into data\for-bot, byte for byte, and is no
//     longer directly in data
//   - sessions.json is left where it is, and nothing else goes into for-bot
//   - a report sent in lands in data\for-bot\inbox.json
//   - a second start with a stray old copy in data leaves the for-bot one
//     alone and says so
//   - the bot reads its two site files from for-bot by default
// Nothing here touches the repository's data folder or the VPS.
const REPO_DIR = require('path').join(__dirname, '..', '..');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const siteFiles = require('../../tests/site-files');

const SRC = path.join(REPO_DIR, 'site', 'server.js');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
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
const read = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-forbot-'));
const DATA = path.join(dir, 'data');
const FOR_BOT = path.join(DATA, 'for-bot');
const KEY = crypto.randomBytes(16).toString('hex');

async function start() {
  const PORT = await freePort();
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(PORT), THORNSWOOD_DOCS_LOCAL: '1' })
  });
  let said = '';
  srv.stdout.on('data', (d) => { said += d; });
  srv.stderr.on('data', (d) => { said += d; });
  const base = 'http://127.0.0.1:' + PORT;
  let up = false;
  try { await listening(srv, PORT); up = true; } catch (e) { said = e.message; }
  return { srv, base, up, said: () => said };
}
// A site that already stopped has no exit to wait for.
function stop(s) {
  return new Promise((resolve) => {
    if (!s || !s.srv || s.srv.exitCode !== null || s.srv.signalCode !== null) return resolve();
    s.srv.once('exit', resolve); s.srv.kill();
  });
}

(async () => {
  let s = null;
  try {
    siteFiles.copy(dir, SRC);
    fs.mkdirSync(DATA, { recursive: true });
    // The game check knocks on port 1 (#1816): the system never hands it out
    // for a listen on 0 and no harness listens on a fixed port
    // (test-1703-test-ports.js), so no run beside this one can take it and
    // make the game read as up. A port taken from the system and let go could be.
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
      password: '', secret: crypto.randomBytes(32).toString('hex'), botKey: KEY,
      gameCheckPort: 1, onlineFile: path.join(dir, 'online.json'),
      discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' }
    }));
    const was = {
      'trouble.json': JSON.stringify([{ session: 's1', why: 'it crashed' }]),
      'inbox.json': JSON.stringify([{ id: 'r1', kind: 'report', title: 'a report from before' }]),
      'moderation.log': JSON.stringify({ at: '2026-09-28T00:00:00Z', server: 'site', did: 'note' }) + '\n'
    };
    for (const n of Object.keys(was)) fs.writeFileSync(path.join(DATA, n), was[n]);
    fs.writeFileSync(path.join(DATA, 'sessions.json'), '{"secret-session":"not the bot\'s"}');

    s = await start();
    yes('a scratch copy of the site starts', s.up);
    if (!s.up) { console.log(s.said()); return; }
    for (const n of Object.keys(was)) {
      yes(n + ' is moved into data\\for-bot, byte for byte', read(path.join(FOR_BOT, n)) === was[n]);
      yes('  and is no longer directly in data', !fs.existsSync(path.join(DATA, n)));
    }
    yes('sessions.json stays in data, where the bot is not granted anything', fs.existsSync(path.join(DATA, 'sessions.json')));
    yes('and for-bot holds the three and nothing else',
      fs.readdirSync(FOR_BOT).sort().join(',') === 'inbox.json,moderation.log,trouble.json');
    yes('the move is said in the site\'s log', /moved trouble\.json into data\\for-bot/.test(s.said()));

    const r = await fetch(s.base + '/api/report', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Something is wrong', detail: 'a report sent in after the move', who: 'Tester' })
    });
    const inbox = JSON.parse(read(path.join(FOR_BOT, 'inbox.json')) || '[]');
    yes('a report sent in now lands in data\\for-bot\\inbox.json (answer ' + r.status + ')',
      r.ok && inbox.length === 2 && inbox.some((x) => /after the move/.test(JSON.stringify(x))));
    yes('and not in data', !fs.existsSync(path.join(DATA, 'inbox.json')));
    await stop(s); s = null;

    // A stray old copy beside a for-bot one: for-bot wins, the old one stays.
    fs.writeFileSync(path.join(DATA, 'trouble.json'), '[]');
    s = await start();
    yes('a second start is up', s.up);
    yes('with a stray copy in data, the one in for-bot is not written over',
      read(path.join(FOR_BOT, 'trouble.json')) === was['trouble.json']);
    yes('  and the stray one is left for a look, and said', fs.existsSync(path.join(DATA, 'trouble.json')) &&
      /trouble\.json is in data and in data\\for-bot/.test(s.said()));
    await stop(s); s = null;

    // The bot's defaults, read from its source rather than imported, so this
    // needs no python.
    const bot = fs.readFileSync(path.join(REPO_DIR, 'bot', 'bot.py'), 'utf8');
    yes('the bot reads trouble.json from for-bot by default', bot.indexOf("r'C:\\Thornswood-Docs\\data\\for-bot\\trouble.json'") >= 0);
    yes('and inbox.json', bot.indexOf("r'C:\\Thornswood-Docs\\data\\for-bot\\inbox.json'") >= 0);
    yes('and the site\'s moderation.log beside trouble.json',
      /os\.path\.join\(os\.path\.dirname\(TROUBLE_FILE\), 'moderation\.log'\)/.test(bot));
  } finally {
    await stop(s);
    console.log('\n' + pass + ' passed, ' + fail + ' failed');
    process.exitCode = fail ? 1 : 0;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
    setTimeout(() => {}, 300);
  }
})();
