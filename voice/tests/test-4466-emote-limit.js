/*
  test-4466-emote-limit.js

      node voice\tests\test-4466-emote-limit.js

  Issue #4466. The chat limit (chatAllow) was asked only on typed lines. An
  emote never asked it, and its name was any 80 characters of free text
  (headlines.emoteHead), so one connection could put any number of free-text
  lines over its head and into the chat log. And a slash command refused
  because the command queue was full was still written to the chat log, one
  line per refusal.

  Against the real service spawned in a temp folder on a loopback port of its
  own, with the chat limit's refill set long so a burst cannot earn more:

    A  twelve emotes at once: five go out (the limit's burst), the sender is
       told to slow down, and a typed line after them is held as well, since
       they spend the same limit;
    B  an emote whose name the wheel cannot send goes nowhere and is not in
       the chat log, and one the wheel can send still goes out;
    C  more commands than the queue holds: every refused one is left out of
       the chat log, and the service log says the queue is full once;
    D  the names the service takes are the wheel's own list
       (game\plugins\thornswood-emotes.js, EMOTES), every one of them.

  VOICE points it at another copy of voice-server.js, which is how it was
  shown to fail on main. Read only apart from its own temp folder.
*/
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process');

const REPO_DIR = path.join(__dirname, '..', '..');
const VOICE = process.env.VOICE || path.join(REPO_DIR, 'voice', 'voice-server.js');
const WHEEL = path.join(REPO_DIR, 'game', 'plugins', 'thornswood-emotes.js');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 1500).split('\n').join('\n      ') : '')); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, ms) {
  const end = Date.now() + (ms || 3000);
  while (Date.now() < end) { if (await cond()) return true; await wait(25); }
  return false;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4466-'));
fs.copyFileSync(VOICE, path.join(dir, 'voice-server.js'));
fs.copyFileSync(path.join(path.dirname(VOICE), 'headlines.js'), path.join(dir, 'headlines.js'));
const KEY = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dir, 'token-key.txt'), KEY);
const CHAT_DIR = path.join(dir, 'chat');
function tokenFor(pid) {
  const body = 'v2.' + pid + '.' + Date.now() + '.' + crypto.randomBytes(16).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return body + '.' + crypto.createHmac('sha256', KEY).update(body).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// A port of this run's own (#1703), asked of nothing until the service says
// it is listening there.
function freePort(host) {
  return new Promise((ok, bad) => {
    const s = net.createServer();
    s.on('error', bad);
    s.listen(0, host, () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
function listening(srv, port) {
  return new Promise((ok, bad) => {
    let out = '';
    const said = (d) => { out += d; const m = /\[voice\] listening on \S+:(\d+)/.exec(out); if (m && Number(m[1]) === port) { end(null); } };
    const more = (d) => { out += d; };
    const gone = (code) => end(new Error((/EADDRINUSE/.test(out) ? 'something else already holds port ' + port + ', so ' : '') +
                                         'the voice service stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    const late = setTimeout(() => end(new Error('the voice service did not say it was listening on ' + port + ' within fifteen seconds. It printed:\n' + out)), 15000);
    function end(err) {
      clearTimeout(late);
      srv.stdout.removeListener('data', said); srv.stderr.removeListener('data', more); srv.removeListener('exit', gone);
      if (err) { bad(err); } else { ok(); }
    }
    srv.stdout.on('data', said); srv.stderr.on('data', more); srv.on('exit', gone);
  });
}

let PORT = 0, srv = null, srvLog = '';
const sockets = [];
/* Join the room as somebody, and keep everything the service sends them. */
function join(profileId, name) {
  return new Promise((done, bad) => {
    const ws = new WebSocket('ws://127.0.0.1:' + PORT + '/', ['thornswood', tokenFor(profileId)]);
    const got = [];
    let peer = 0;
    sockets.push(ws);
    ws.onopen = () => ws.send(JSON.stringify({ t: 'join', profileId: profileId, name: name }));
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      got.push(m);
      if (m.t === 'welcome') {
        peer = m.peer;
        done({ got: got, peer: () => peer, send: (o) => ws.send(JSON.stringify(o)) });
      }
    };
    ws.onerror = () => bad(new Error('could not join'));
    setTimeout(() => bad(new Error('no welcome')), 4000);
  });
}
function logged() {
  const out = [];
  if (!fs.existsSync(CHAT_DIR)) return out;
  for (const f of fs.readdirSync(CHAT_DIR)) {
    if (!/\.jsonl$/.test(f)) continue;
    for (const line of fs.readFileSync(path.join(CHAT_DIR, f), 'utf8').split('\n')) {
      if (!line) continue;
      try { out.push(JSON.parse(line)); } catch (e) { }
    }
  }
  return out;
}

(async function main() {
  try {
    PORT = await freePort('0.0.0.0');
    srv = spawn(process.execPath, ['voice-server.js'], {
      cwd: dir,
      env: Object.assign({}, process.env, {
        THORNSWOOD_VOICE_PORT: String(PORT), THORNSWOOD_SITE: '', THORNSWOOD_CHAT_DIR: CHAT_DIR,
        // Five at once and nothing earned back while this runs, so what is
        // counted below is the limit and not the clock.
        THORNSWOOD_CHAT_BURST: '5', THORNSWOOD_CHAT_REFILL_MS: '600000'
      })
    });
    srv.stdout.on('data', (d) => { srvLog += d; });
    srv.stderr.on('data', (d) => { srvLog += d; });
    await listening(srv, PORT);

    // ------------------------------------------------------------------ A --
    console.log('A. a burst of emotes is slowed by the chat limit:');
    const a = await join(4661, 'Aela');
    for (let i = 0; i < 12; i++) a.send({ t: 'emote', name: 'Wave' });
    const heads = () => a.got.filter((m) => m.t === 'head' && m.kind === 'emote');
    const slowed = () => a.got.some((m) => m.t === 'chat' && m.from === 0 && /^Slow down/.test(String(m.text)));
    await until(() => slowed() || heads().length >= 12, 3000);
    await wait(300);
    yes('twelve emotes at once: five go out (' + heads().length + ')', heads().length === 5);
    yes('and the sender is told to slow down', slowed());
    yes('five are in the chat log as emotes (' + logged().filter((e) => e.kind === 'emote' && e.profileId === 4661).length + ')',
        logged().filter((e) => e.kind === 'emote' && e.profileId === 4661).length === 5);
    a.send({ t: 'chat', text: 'after the waving' });
    await wait(500);
    yes('a typed line after them is held too: the same limit, not a second one',
        !a.got.some((m) => m.t === 'chat' && m.from === a.peer() && m.text === 'after the waving'));

    // ------------------------------------------------------------------ B --
    console.log('\nB. only a name the wheel can send:');
    const b = await join(4662, 'Brynja');
    const FREE = 'anything at all anybody typed into the socket';
    b.send({ t: 'emote', name: FREE });
    b.send({ t: 'emote', name: 'Bow' });
    const bHeads = () => b.got.filter((m) => m.t === 'head' && m.kind === 'emote');
    await until(() => bHeads().some((m) => m.text === 'Bow'), 3000);
    await wait(200);
    yes('a wheel name (Bow) goes out', bHeads().some((m) => m.text === 'Bow'));
    yes('free text as an emote name goes nowhere', !bHeads().some((m) => m.text !== 'Bow'), JSON.stringify(bHeads()));
    yes('and is not in the chat log', !logged().some((e) => e.text === FREE));

    // ------------------------------------------------------------------ C --
    console.log('\nC. a command refused at the cap is not written each time:');
    const c = await join(4663, 'Cicero');
    const SENT = 230;
    for (let i = 0; i < SENT; i++) c.send({ t: 'chat', text: '/xyzzy ' + i });
    const cmds = () => logged().filter((e) => e.kind === 'command' && e.profileId === 4663).length;
    await until(() => /the command queue is full/.test(srvLog) && cmds() >= 200, 5000);
    await wait(500);
    yes('the commands the queue took are in the chat log, and none it refused (' + cmds() + ' of ' + SENT + ' sent, 200 taken)',
        cmds() === 200);
    const full = (srvLog.match(/the command queue is full/g) || []).length;
    yes('the service log says the queue is full once (' + full + ')', full === 1);
    yes('and the sender is told once', c.got.filter((m) => m.t === 'chat' && m.from === 0 && /not taking commands/.test(String(m.text))).length === 1);

    // ------------------------------------------------------------------ D --
    console.log('\nD. the names the service takes are the wheel\'s:');
    const wheel = fs.readFileSync(WHEEL, 'utf8');
    const block = (/const EMOTES = \[([\s\S]*?)\n\];/.exec(wheel) || [])[1] || '';
    const names = [];
    block.replace(/\{ name: '([^']+)'/g, (m, n) => { names.push(n); return m; });
    const heads2 = require(path.join(dir, 'headlines.js'));
    yes('the wheel has its list (' + names.length + ' names)', names.length > 40);
    const taken = names.filter((n) => heads2.emoteHead(n) === n);
    yes('every one of them is taken as itself (' + taken.length + ' of ' + names.length + ')', taken.length === names.length,
        names.filter((n) => taken.indexOf(n) < 0).join(', '));
    yes('and a name not on it is not', heads2.emoteHead('Moonwalk') === '' && heads2.emoteHead(FREE) === '');
    const theirs = (heads2.EMOTE_NAMES || []).slice().sort().join('|');
    yes('the service names no emote the wheel does not have', theirs === names.slice().sort().join('|'));
  } catch (e) {
    yes('the harness ran to the end: ' + (e && e.stack || e), false, srvLog);
  } finally {
    for (const s of sockets) { try { s.close(); } catch (e) { } }
    if (srv) srv.kill();
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('      the temp folder was not removed: ' + e.message); }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
