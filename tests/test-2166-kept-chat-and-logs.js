'use strict';
/*
  test-2166-kept-chat-and-logs.js

      node .\tests\test-2166-kept-chat-and-logs.js

  Issue #2166, the two gaps Patrick decided on 17 Oct (Herald's root-cause
  comment on the issue):

    G1  A session staff mark kept keeps its chat. The chat under a session
        used to be read live out of the voice service's day files, which the
        voice service deletes whole 365 days on, and Delete-Person.ps1 took a
        person's lines out of them even inside a kept session. Now keeping a
        session copies its chat into its own log set, which the 365-day prune
        and Delete-Person.ps1 already hold for a kept session, and
        Delete-Person.ps1 leaves the day-file lines inside a kept session's
        window (tests\test-2351-delete-person.ps1 runs that part for real).
    G5  site.log, voice.log, thornswood.log and bot.log rolled by size only,
        with nothing aging them, and the privacy page did not name them. Now
        nothing in any of them reaches 90 days, and the page says so in one
        line. bot.log's rule is in BotService.cs and is driven for real by
        tests\test-bot-service.ps1; voice and the game server's task lines are
        run through cmd by tests\test-roll-log.ps1.

  Everything runs on scratch folders with made-up ids, names and lines.
  Nothing leaves the machine and the scratch folders are removed at the end.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const crypto = require('crypto');
const cp = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const SITE_SRC = path.join(ROOT, 'site', 'server.js');
const site = siteFiles.source(SITE_SRC);
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return ''; } };

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}
function grab(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) return '';
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  return '';
}
function freePort() {
  return new Promise((ok) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); });
  });
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const scratch = [];
function tmp(tag) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-2166-' + tag + '-')); scratch.push(d); return d; }
process.on('exit', () => { for (const d of scratch) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { } } });

const DAY = 86400000;
const NOW = Date.now();
const p2 = (n) => (n < 10 ? '0' : '') + n;
const dayName = (t) => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '.jsonl'; };
const stampOf = (t) => { const d = new Date(t); return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); };

// ---------------------------------------------------------------- G1, live --
async function keptChatOnASite() {
  console.log('G1  A KEPT SESSION KEEPS ITS CHAT');
  const dir = tmp('site');
  siteFiles.copy(dir, SITE_SRC);
  fs.mkdirSync(path.join(dir, 'public'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data', 'session-logs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'chat'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({
    password: crypto.randomBytes(12).toString('hex'),
    discord: { clientId: '', clientSecret: '', botToken: '', guildId: '', invite: '' },
    botKey: crypto.randomBytes(16).toString('hex'),
    admins: ['111111111111111111'],
    secret: crypto.randomBytes(32).toString('hex'),
    gameCheckPort: 1,
    onlineFile: path.join(dir, 'online.json')
  }, null, 2));
  // A day ten days back, at noon, so the session and its minute either side
  // are in one day file.
  const d = new Date(NOW - 10 * DAY); d.setHours(12, 0, 0, 0);
  const start = d.getTime(), end = start + 3600000;
  fs.writeFileSync(path.join(dir, 'data', 'sessions.json'), JSON.stringify([
    { session: 'keptchat00000001', who: '601', profile: 777001, start, end, channel: 'main', keep: true, keptBy: 'Staff', keptAt: end },
    { session: 'keptlogs00000002', who: '602', profile: 777002, start, end, channel: 'main', keep: true, keptBy: 'Staff', keptAt: end },
    { session: 'notkept00000003', who: '603', profile: 777003, start, end, channel: 'main' },
    { session: 'keptnochat000004', who: '604', profile: 777004, start: start - 30 * DAY, end: end - 30 * DAY, channel: 'main', keep: true }
  ], null, 2));
  // The launcher set the second one sent, which the copy goes in beside.
  fs.writeFileSync(path.join(dir, 'data', 'session-logs', 'keptlogs00000002.json'), JSON.stringify({
    session: 'keptlogs00000002', who: '602', at: end, bytes: 9, sha256: { 'launcher.log': 'x' }, logs: { 'launcher.log': 'stand-in' } }));
  const line = (pid, at, text) => JSON.stringify({ at, kind: 'say', mode: 'say', profileId: pid, name: 'Stand-in ' + pid, text });
  fs.writeFileSync(path.join(dir, 'chat', dayName(start)), [
    line(777001, start + 60000, 'said in the kept session'),
    line(777001, end + 120000, 'said after it ended'),
    line(777002, start + 120000, 'said in the other kept session'),
    line(777003, start + 60000, 'said in a session nobody kept')
  ].join('\n') + '\n');

  const port = await freePort();
  const srv = cp.spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: String(port), THORNSWOOD_DOCS_LOCAL: '1',
                                          THORNSWOOD_CHAT_DIR: path.join(dir, 'chat'),
                                          THORNSWOOD_DEV_CHAT_DIR: path.join(dir, 'chat-dev') })
  });
  let out = '';
  srv.stdout.on('data', (b) => { out += b; });
  srv.stderr.on('data', (b) => { out += b; });
  try {
    let up = false;
    /* Up once the site says ready or NOT READY: it says that right after its
       first retention sweep, in the same callback, so the sweep's files are
       all written by then however busy the machine is (#4082). The minute
       only bounds a site that never comes up. */
    for (let i = 0; i < 1200 && !up; i++) {
      if (/\[thornswood-docs\] (ready|NOT READY): /.test(out)) { up = true; break; }
      if (srv.exitCode !== null) break;
      await wait(50);
    }
    if (!up) throw new Error('the scratch site never came up:\n' + out);
    const set = (k) => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'session-logs', k + '.json'), 'utf8')); } catch (e) { return null; } };
    const a = set('keptchat00000001');
    yes('a session kept before this existed has its chat copied by the sweep at start', a && a.chat && Array.isArray(a.chat.lines) && a.chat.lines.length === 1, JSON.stringify(a));
    yes('  only what that person said inside the session, a minute either side', a && a.chat && a.chat.lines[0] && a.chat.lines[0].text === 'said in the kept session');
    yes('  in a set of its own that says it holds only the chat', a && a.chatOnly === true && a.who === '601' && JSON.stringify(a.logs) === '{}');
    yes('  with the window, when it was copied and a sha256 of the lines', a && a.chat && a.chat.from === start - 60000 && a.chat.to === end + 60000 &&
        a.chat.copiedAt > 0 && a.chat.sha256 === crypto.createHash('sha256').update(JSON.stringify(a.chat.lines), 'utf8').digest('hex'));
    const b = set('keptlogs00000002');
    yes('a kept session with launcher logs gets its chat beside them, the logs untouched', b && b.logs && b.logs['launcher.log'] === 'stand-in' &&
        !b.chatOnly && b.chat && b.chat.lines.length === 1 && b.chat.lines[0].text === 'said in the other kept session');
    yes('a session nobody kept gets no copy', set('notkept00000003') === null);
    yes('a kept session whose day files are gone gets no empty copy standing in for them', set('keptnochat000004') === null);
    yes('nothing about the copies was said as a failure', out.indexOf('kept-chat-retention') < 0, out);
  } catch (err) {
    fail++;
    console.log('FAIL  the kept-chat harness threw: ' + (err && err.stack ? err.stack : err));
  }
  await new Promise((ok) => { srv.on('exit', ok); try { srv.kill(); } catch (e) { ok(); } setTimeout(ok, 3000); });
}

// ------------------------------------------------------- G1, the rules lifted --
function keptChatRules() {
  const dir = tmp('rules');
  const SLOGS = path.join(dir, 'session-logs');
  const CHAT = path.join(dir, 'chat');
  fs.mkdirSync(CHAT, { recursive: true });
  const said = [];
  const SLOG_ONE = 256 * 1024, SLOG_ALL = 1024 * 1024;
  let rowsNow = [];
  const sessionRows = () => rowsNow;
  const retentionSay = (what, o) => said.push(what + ' ' + JSON.stringify(o));
  const CHAT_DIRS = { main: CHAT, dev: path.join(dir, 'chat-dev') };
  const src = ['sessionKey', 'slogFile', 'slogTrim', 'putSessionLogs', 'chatSlice', 'isObjectLike', 'sessionWindow',
    'readSlogSet', 'keptChatCurrent', 'copyKeptChat', 'dropKeptChat', 'copyKeptChats'].map((n) => grab(site, n));
  const namesAt = site.indexOf('const SLOG_NAMES = [');
  const names = site.slice(namesAt, site.indexOf('];', namesAt) + 2);
  yes('server.js has every piece of the kept chat', src.every((s) => s) && namesAt >= 0);
  if (!src.every((s) => s)) return;
  const api = new Function('fs', 'path', 'crypto', 'SLOGS', 'SLOG_ONE', 'SLOG_ALL', 'sessionRows', 'retentionSay', 'CHAT_DIRS',
    names + '\n' + src.join('\n') + '\nreturn { putSessionLogs, copyKeptChat, dropKeptChat, copyKeptChats };')(
    fs, path, crypto, SLOGS, SLOG_ONE, SLOG_ALL, sessionRows, retentionSay, CHAT_DIRS);
  const d = new Date(NOW - 3 * DAY); d.setHours(12, 0, 0, 0);
  const start = d.getTime();
  const line = (at, text) => JSON.stringify({ at, kind: 'say', profileId: 778001, name: 'Stand-in', text });
  fs.writeFileSync(path.join(CHAT, dayName(start)), line(start + 1000, 'first') + '\n' + line(start + 7200000, 'later') + '\n');
  const key = 'openkept00000001';
  const open = { session: key, who: '701', profile: 778001, start, channel: 'main', keep: true };
  const file = path.join(SLOGS, key + '.json');
  const readSet = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; } };

  yes('keeping a session still open copies what is there so far', api.copyKeptChat(open, start + 3600000) === 'copied' && readSet().chat.lines.length === 1);
  yes('  and again, once it has ended past what the copy holds', api.copyKeptChat(Object.assign({}, open, { end: start + 7300000 }), start + 7400000) === 'copied' &&
      readSet().chat.lines.length === 2);
  yes('  and not a third time once the copy covers it', api.copyKeptChat(Object.assign({}, open, { end: start + 7300000 }), start + 7500000) === 'already');
  yes('the launcher\'s logs arriving after the keep go in beside the chat, not refused as a resend',
      api.putSessionLogs(key, '701', { 'launcher.log': 'arrived late' }) === 'saved' &&
      readSet().logs['launcher.log'] === 'arrived late' && readSet().chat && readSet().chat.lines.length === 2 && !readSet().chatOnly);
  yes('  and a real second set is still refused and counted', api.putSessionLogs(key, '701', { 'launcher.log': 'again' }) === 'already' &&
      readSet().logs['launcher.log'] === 'arrived late' && readSet().resent === 1);
  fs.rmSync(path.join(CHAT, dayName(start)));
  const ended = Object.assign({}, open, { end: start + 9000000 });
  yes('a copy is never written over by a read that found no day files', api.copyKeptChat(ended, start + 9100000) === 'already' && readSet().chat.lines.length === 2);
  yes('letting the session go drops the copy and leaves the launcher logs', api.dropKeptChat(key) === 'dropped' && readSet() && !readSet().chat &&
      readSet().logs['launcher.log'] === 'arrived late');
  fs.writeFileSync(path.join(CHAT, dayName(start)), line(start + 1000, 'first') + '\n');
  const key2 = 'chatonly00000002';
  yes('a chat-only set is deleted whole when its session is let go', api.copyKeptChat({ session: key2, who: '702', profile: 778001, start, end: start + 5000, channel: 'main' }, NOW) === 'copied' &&
      api.dropKeptChat(key2) === 'dropped' && !fs.existsSync(path.join(SLOGS, key2 + '.json')));
  yes('a row with neither a start nor an end has no window to copy', api.copyKeptChat({ session: 'nowindow00000003', who: '703', profile: 778001, channel: 'main', keep: true }) === 'no-window');
  rowsNow = [{ session: 'sweepkept0000004', who: '704', profile: 778001, start, end: start + 5000, channel: 'main', keep: true }, { session: 'sweepnot00000005', profile: 778001, start, end: start + 5000 }];
  const swept = api.copyKeptChats(NOW);
  yes('the hourly pass copies a kept session missing one, and only kept ones', swept.copied === 1 && fs.existsSync(path.join(SLOGS, 'sweepkept0000004.json')) &&
      !fs.existsSync(path.join(SLOGS, 'sweepnot00000005.json')), JSON.stringify(swept));
  yes('nothing failed on the way', said.length === 0, said.join('\n'));

  const keepRoute = site.slice(site.indexOf("if (p === '/api/session-keep'"), site.indexOf("if (p === '/api/session-keep'") + 1600);
  yes('the keep switch copies on keep and drops on let go', /const chatCopy = on \? copyKeptChat\(rows\[at\]\) : dropKeptChat\(key\)/.test(keepRoute));
  const logsRoute = site.slice(site.indexOf("if (p === '/api/session-logs'"), site.indexOf("if (p === '/api/session-logs'") + 4000);
  yes('/api/session-logs shows a kept session\'s copy, and says it is the copy', /keptChat \? \{ why: '', lines: keptChat\.lines \}/.test(logsRoute) && /chatKept: !!keptChat/.test(logsRoute));
  yes('the hourly sweep copies before the prune', /const keptChat = copyKeptChats\(now\);[\s\S]*sessionLogs: pruneSessionLogs\(\)/.test(grab(site, 'retentionSweep')));
  yes('the 365-day prune still skips a kept session\'s set, which now holds the chat', /if \(held\.has\(key\)\) continue;/.test(grab(site, 'pruneSessionLogs')));
  const dp = read('scripts/vps/Delete-Person.ps1');
  yes('Delete-Person.ps1 holds the day-file lines inside a kept session\'s window', /keptWindows\.some\(\(w\) => w\.voice === v\.tag && w\.profile === Number\(o\.profileId\) && at >= w\.from && at <= w\.to\)/.test(dp) &&
      /voice: chat lines in sessions staff marked kept/.test(dp));
}

// ------------------------------------------------------------- G5, the logs --
function serverLogWriter() {
  console.log('\nG5  THE FOUR LOGS THAT NAME PEOPLE ARE KEPT TO 90 DAYS');
  const WRITER = path.join(ROOT, 'scripts', 'vps', 'Server-Log.js');
  const sl = require(WRITER);
  yes('server-log.js takes --days, --stamp, --also and --also-days, and keeps 30 and 90 as its defaults', (() => {
    const o = sl.parseArgs(['--log', 'x.log', '--days', '90', '--stamp', '--also', 'thornswood.log', 'stand-in-voice.js', '--days', '5']);
    const d = sl.parseArgs(['--log', 'x.log', 'a.js']);
    return o.days === 90 && o.stamp && o.also.length === 1 && /thornswood\.log$/.test(o.also[0]) && o.alsoDays === 90 &&
      o.program.join(' ') === 'stand-in-voice.js --days 5' && d.days === 30 && !d.stamp && d.also.length === 0 && sl.ALSO_DAYS === 90;
  })());
  yes('a line stamped without brackets, the gamemode\'s, has a time', sl.lineTime('2026-10-12 21:40:03 [thornswood] x') === new Date(2026, 9, 12, 21, 40, 3).getTime() &&
      sl.lineTime('[2026-10-12 21:40:03.155] x') === new Date(2026, 9, 12, 21, 40, 3).getTime() && sl.lineTime('no stamp') === null);

  // thornswood.log: the live file from an earlier day moved aside, every
  // rolled copy cut to 90 days, and server.log's 30 days as before.
  const g = tmp('game');
  const gm = path.join(g, 'thornswood.log');
  fs.writeFileSync(gm, stampOf(NOW - DAY) + ' [thornswood] yesterday\n');
  fs.writeFileSync(gm + '.1', stampOf(NOW - 100 * DAY) + ' [thornswood] 100 days\n' + stampOf(NOW - 80 * DAY) + ' [thornswood] 80 days\n');
  fs.writeFileSync(gm + '.2', stampOf(NOW - 95 * DAY) + ' [thornswood] all past 90\n');
  fs.writeFileSync(path.join(g, 'server.log.1'), '[' + stampOf(NOW - 40 * DAY) + '.000] forty days\n[' + stampOf(NOW - 20 * DAY) + '.000] twenty days\n');
  const r = cp.spawnSync(process.execPath, [WRITER, '--log', path.join(g, 'server.log'), '--also', gm, '--roll'], { cwd: g, encoding: 'utf8' });
  const left = fs.readdirSync(g).sort();
  const dated = left.filter((n) => /^thornswood\.log\.\d{17,}$/.test(n));
  yes('the install roll moves a thornswood.log from an earlier day aside, under a dated name', r.status === 0 && !fs.existsSync(gm) && dated.length === 1 &&
      /yesterday/.test(fs.readFileSync(path.join(g, dated[0]), 'utf8')), r.stdout + r.stderr + left.join(','));
  yes('  cuts a rolled copy to its last 90 days', fs.existsSync(gm + '.1') && !/100 days/.test(fs.readFileSync(gm + '.1', 'utf8')) && /80 days/.test(fs.readFileSync(gm + '.1', 'utf8')));
  yes('  deletes one with nothing inside 90 days', !fs.existsSync(gm + '.2'));
  yes('  and says so, naming thornswood.log', /thornswood\.log: older than 90 days: 1 rolled log deleted, 1 cut/.test(r.stdout), r.stdout);
  yes('server.log keeps its own 30 days alongside', !/forty days/.test(fs.readFileSync(path.join(g, 'server.log.1'), 'utf8')));

  // voice.log: run under the writer with --days 90 --stamp, each line stamped
  // and a rolled copy past 90 days cut at the start.
  const v = tmp('voice');
  fs.writeFileSync(path.join(v, 'stand-in-voice.js'), "console.log('[voice] listening');\nprocess.stdout.write('[voice] two\\n[voice] lines in one write\\n');\n");
  fs.writeFileSync(path.join(v, 'voice.log.20250101000000000'), '[' + stampOf(NOW - 120 * DAY) + '.000] [voice] old\n[' + stampOf(NOW - 60 * DAY) + '.000] [voice] sixty\n');
  const rv = cp.spawnSync(process.execPath, [WRITER, '--log', path.join(v, 'voice.log'), '--days', '90', '--stamp', 'stand-in-voice.js'], { cwd: v, encoding: 'utf8' });
  const vlog = (() => { try { return fs.readFileSync(path.join(v, 'voice.log'), 'utf8'); } catch (e) { return ''; } })();
  const STAMPED = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] /;
  const vlines = vlog.split('\n').filter((l) => l);
  yes('voice under the writer: every line in voice.log carries a time', rv.status === 0 && vlines.length >= 3 && vlines.every((l) => STAMPED.test(l)), vlog);
  yes('  voice\'s own lines among them, two in one write each stamped', /\] \[voice\] listening$/m.test(vlog) && /\] \[voice\] two$/m.test(vlog) && /\] \[voice\] lines in one write$/m.test(vlog));
  const oldCopy = fs.readFileSync(path.join(v, 'voice.log.20250101000000000'), 'utf8');
  yes('  a rolled voice.log is cut to 90 days, not 30', !/\[voice\] old/.test(oldCopy) && /\[voice\] sixty/.test(oldCopy), oldCopy);
}

function siteLogAge() {
  const a = site.indexOf('function makeLog(dir, name, maxBytes, keep, opts) {');
  const b = site.indexOf('// Four megabytes is a few days');
  yes('server.js has makeLog where the harness expects it', a >= 0 && b > a);
  if (a < 0 || b < 0) return;
  let clock = NOW;
  class PretendDate extends Date { static now() { return clock; } }
  const said = [];
  const fakeProcess = { stdout: { write(s) { said.push(String(s)); } } };
  const makeLog = new Function('fs', 'path', 'process', 'Date', site.slice(a, b) + '\nreturn makeLog;')(fs, path, fakeProcess, PretendDate);
  const dir = tmp('sitelog');
  const file = path.join(dir, 'site.log');
  fs.writeFileSync(file, stampOf(NOW - 2 * DAY) + '  a line two days old\n');
  const old = new Date(NOW - 60 * DAY), fresh = new Date(NOW - 10 * DAY);
  fs.writeFileSync(file + '.2', 'a copy last written 60 days ago\n'); fs.utimesSync(file + '.2', old, old);
  fs.writeFileSync(file + '.3', 'a copy last written 10 days ago\n'); fs.utimesSync(file + '.3', fresh, fresh);
  const log = makeLog(dir, 'site.log', 1024 * 1024, 5, { liveDays: 30, copyDays: 59, ageEveryMs: 3600000 });
  yes('site.log, as it is made: a rolled copy past 59 days goes, a newer one stays, the live file under 30 days stays',
      !fs.existsSync(file + '.2') && fs.existsSync(file + '.3') && /two days old/.test(fs.readFileSync(file, 'utf8')));
  yes('  and it says so in the log', /site\.log by age: 1 rolled copy past 59 days deleted/.test(fs.readFileSync(file, 'utf8')));
  clock = NOW + 29 * DAY;
  const r = log.age();
  yes('once its first line is 30 days old the live file is rolled', r.rolled && /two days old/.test(fs.readFileSync(file + '.1', 'utf8')));
  yes('the site\'s own log is made with 30 and 59', /makeLog\(ROOT, 'site\.log', 4 \* 1024 \* 1024, 5, \{ liveDays: 30, copyDays: 59 \}\)/.test(site));
  yes('  and 30 + 59 and the hour between passes is under 90', 30 + 59 + 1 / 24 < 90);
}

function wiring() {
  const bot = read('scripts/vps/BotService.cs');
  yes('bot.log: the service rolls by age at 30 days and deletes copies past 59, every hour', /public double LiveSeconds = 30 \* 86400;/.test(bot) &&
      /public double CopySeconds = 59 \* 86400;/.test(bot) && /public double AgeCheckSeconds = 3600;/.test(bot) &&
      /log\.AgeBy\(s\.LiveSeconds, s\.CopySeconds, s\.AgeCheckSeconds\);/.test(bot));
  const inst = read('scripts/deploy/Install-ThornswoodServer.ps1');
  yes('the game server\'s task keeps thornswood.log through the writer', /--log "\{2\}" --also thornswood\.log dist_back\/skymp5-server\.js/.test(inst));
  const iv = read('scripts/deploy/Install-Voice.ps1');
  yes('voice\'s task runs voice under the writer with 90 days and stamps, and no >> holds voice.log', /start "" \/b \/wait \/high "\{0\}" "\{2\}" --log "\{1\}" --days 90 --stamp voice-server\.js & call exit/.test(iv) &&
      !/voice-server\.js >>/.test(iv));
  const dv = read('scripts/vps/vps-dev-instance.ps1');
  yes('and dev voice\'s run file the same', /server-log\.js" --log "\{1\}\\voice\.log" --days 90 --stamp voice-server\.js/.test(dv) && !/voice-server\.js >>/.test(dv));
  const privacy = read('site/data/site/privacy.md');
  const at = privacy.indexOf("**The site's, voice's, gamemode's and bot's own logs**");
  const item = at >= 0 ? privacy.slice(at, privacy.indexOf('\n- ', at) >= 0 ? privacy.indexOf('\n- ', at) : at + 400) : '';
  yes('the privacy page names the four logs, what they hold and the 90 days, in one line', at >= 0 && /site\.log/.test(item) && /voice\.log/.test(item) &&
      /thornswood\.log/.test(item) && /bot\.log/.test(item) && /profile\s+numbers/.test(item) && /90 days/.test(item));
}

(async () => {
  await keptChatOnASite();
  keptChatRules();
  serverLogWriter();
  siteLogAge();
  wiring();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
