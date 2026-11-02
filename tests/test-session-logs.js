/*
  test-session-logs.js

  The logs kept against one session, which are meant to stand up when somebody
  is suspended or banned.

  Asked for by Patrick on 22 September: collect the logs so he never has to ask
  for them, and so they can be used as evidence later. Three things follow from
  "evidence" and each of them is a check here, because each can be quietly
  wrong while the feature still looks like it works:

    WRITE ONCE. A second set for the same session must not overwrite the
    first. Without that, anybody who knew the endpoint could do something worth
    banning for and then post a clean set over the top from the same launcher,
    and the evidence would be whatever the accused chose to send last.

    PROVENANCE. The Discord id is taken off the TICKET, never off the body, and
    a sha256 of every log is recorded, so a copy pasted into an argument months
    later can be held against the one on the box.

    KEPT BY AGE, NOT BY THE ROLLING LIST. sessions.json keeps the last two
    thousand rows. Tying the logs to it would delete the evidence for an old
    incident the moment two thousand newer sessions had happened.

  It also checks what the endpoint REFUSES to store, because this is a body
  from every launcher and a file name is the shortest way into a folder nobody
  meant to write.

  This lifts the real functions out of server.js by text, so a rename fails
  loudly rather than testing a copy. Read only apart from its own temp folder.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const siteFiles = require('./site-files');

const SRC = path.join(REPO_DIR, 'site', 'server.js');
const src = siteFiles.source(SRC);

function grab(name) {
  const at = src.indexOf('function ' + name);
  if (at < 0) throw new Error('site/server.js has no function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-slogs-'));
const SLOGS = path.join(TMP, 'session-logs');

/* The same values server.js declares. If they change there, they change here,
   and the caps check below is what notices. */
const SLOG_ONE = 256 * 1024;
const SLOG_ALL = 1024 * 1024;
const SLOG_DAYS = 365;
/* The list itself is lifted, not copied: a copy here kept passing on 24
   September while the site had no place for the crash log at all. */
const SLOG_NAMES = eval(grabConst('SLOG_NAMES'));
const SERVER_LOGS = {
  main: path.join(TMP, 'server.log'),
  dev:  path.join(TMP, 'server-dev.log')
};
let ROWS = [];
function sessionRows() { return ROWS; }

eval([
  grab('slogFile'), grab('slogTrim'), grab('putSessionLogs'),
  grab('retentionSay'), grab('pruneSessionLogs'), grab('serverLogGenerations'), grab('serverLogSlice')
].join('\n'));

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

// ---- write once ------------------------------------------------------------
const K = 'aaaaaaaabbbbbbbb';
yes('a first set is saved',
    putSessionLogs(K, '111', { 'launcher.log': 'hello\nworld\n' }) === 'saved');
yes('a second set for the same session is refused',
    putSessionLogs(K, '111', { 'launcher.log': 'CLEAN LOGS, NOTHING HAPPENED\n' }) === 'already');

const set = JSON.parse(fs.readFileSync(slogFile(K), 'utf8'));
yes('the FIRST set is what is still on disk', set.logs['launcher.log'] === 'hello\nworld\n');
yes('the replay attempt is recorded rather than ignored', set.resent === 1);
yes('the Discord id off the ticket is recorded', set.who === '111');
yes('a sha256 is recorded for each log',
    set.sha256['launcher.log'] ===
    crypto.createHash('sha256').update('hello\nworld\n', 'utf8').digest('hex'));

// ---- what it will not store ------------------------------------------------
yes('a file name not on the allowed list is dropped',
    putSessionLogs('ccccccccdddddddd', '111',
      { '../../evil.txt': 'x', 'secrets.env': 'y', 'bot.env.json': 'z' }) === 'nothing');
yes('and nothing at all was written for it',
    !fs.existsSync(slogFile('ccccccccdddddddd')));
yes('an empty log is not stored',
    putSessionLogs('eeeeeeeeffffffff', '111', { 'launcher.log': '   \n  ' }) === 'nothing');

// ---- caps ------------------------------------------------------------------
putSessionLogs('11111111aaaaaaaa', '222', { 'launcher.log': 'x'.repeat(SLOG_ONE + 50000) });
const capped = JSON.parse(fs.readFileSync(slogFile('11111111aaaaaaaa'), 'utf8'));
yes('one log is trimmed to its cap', capped.logs['launcher.log'].length <= SLOG_ONE + 200);
yes('the trim keeps the END, where a crash is, and says what it dropped',
    capped.logs['launcher.log'].indexOf('are not kept') >= 0 &&
    capped.logs['launcher.log'].endsWith('x'));

const many = {};
for (const n of SLOG_NAMES) many[n] = 'y'.repeat(SLOG_ONE);
putSessionLogs('22222222bbbbbbbb', '222', many);
const all = JSON.parse(fs.readFileSync(slogFile('22222222bbbbbbbb'), 'utf8'));
yes('a whole set is held under the total cap', all.bytes <= SLOG_ALL);

// ---- retention -------------------------------------------------------------
function age(key, days) {
  const f = slogFile(key);
  const o = JSON.parse(fs.readFileSync(f, 'utf8'));
  o.at = Date.now() - days * 86400000;
  fs.writeFileSync(f, JSON.stringify(o));
}
putSessionLogs('old11111old11111', '333', { 'launcher.log': 'old\n' });
putSessionLogs('keep1111keep1111', '333', { 'launcher.log': 'evidence\n' });
age('old11111old11111', SLOG_DAYS + 5);
age('keep1111keep1111', SLOG_DAYS + 5);

/* Neither session is in the rolling list. Under the old rule that alone would
   have deleted both; under this one only age decides, and a row marked kept
   is held whatever its age. */
ROWS = [{ session: 'keep1111keep1111', who: '333', keep: true }];
/* A set past its time that cannot be deleted (#2354). A folder with a set's
   name is a real failure on every system: it cannot be read as a set, so its
   own time ages it, and unlink refuses a folder. It used to be caught and
   dropped with nothing said. */
const STUCK = path.join(SLOGS, 'stuck111stuck111.json');
fs.mkdirSync(path.join(STUCK, 'inside'), { recursive: true });
const longAgo = new Date(Date.now() - (SLOG_DAYS + 9) * 86400000);
fs.utimesSync(STUCK, longAgo, longAgo);
const errLines = [];
const realError = console.error;
console.error = (line) => { errLines.push(String(line)); };
let pruned;
try { pruned = pruneSessionLogs(); } finally { console.error = realError; }
yes('an old set with nothing holding it is pruned',
    !fs.existsSync(slogFile('old11111old11111')));
yes('an old set on a row marked kept survives, because it is evidence',
    fs.existsSync(slogFile('keep1111keep1111')));
yes('a recent set survives even though it is not in the rolling list',
    fs.existsSync(slogFile(K)));
const stuckLine = errLines.filter((l) => l.indexOf('session-log-retention') >= 0);
let stuckDoc = null;
try { stuckDoc = JSON.parse(stuckLine[0].slice(stuckLine[0].indexOf('{'))); } catch (e) { }
yes('a set past its time that will not delete is said in one log line (' + (stuckLine[0] || 'nothing said') + ')',
    stuckLine.length === 1 && !!stuckDoc && stuckDoc.event === 'delete-failed' &&
    stuckDoc.file === 'stuck111stuck111.json' && typeof stuckDoc.code === 'string' && stuckDoc.code.length > 0 &&
    stuckDoc.daysPastRetention >= 8);
yes('the line names the file and the error, never what it holds',
    !!stuckDoc && Object.keys(stuckDoc).sort().join(',') === 'code,daysPastRetention,event,file');
yes('and the prune answers how many went and which would not, rather than nothing',
    !!pruned && pruned.deleted === 1 && pruned.failed.length === 1 && pruned.failed[0].file === 'stuck111stuck111.json');
fs.rmSync(STUCK, { recursive: true, force: true });
yes('pruning cannot throw into the session end that calls it, so the call is no longer wrapped',
    /\n    if \(ending\) pruneSessionLogs\(\);\r?\n/.test(src) && !/catch \(e\) \{ \}\s*\}\s*$/.test(grab('pruneSessionLogs')));

// ---- the server log slice --------------------------------------------------
fs.writeFileSync(SERVER_LOGS.main,
  '[2026-09-22 10:00:00.000] [console] [info] before the session\n' +
  '[2026-09-22 10:05:00.000] [console] [info] inside the window\n' +
  '    a continuation line carrying no stamp of its own\n' +
  '[2026-09-22 10:30:00.000] [console] [info] after the session\n');

const from = new Date(2026, 8, 22, 10, 4, 0).getTime();
const to   = new Date(2026, 8, 22, 10, 6, 0).getTime();
const slice = serverLogSlice('main', from, to);
yes('the slice reads the log', slice.ok);
yes('it keeps the line inside the window',
    slice.lines.some(l => l.indexOf('inside the window') >= 0));
yes('it drops the line before the window',
    !slice.lines.some(l => l.indexOf('before the session') >= 0));
yes('it drops the line after the window',
    !slice.lines.some(l => l.indexOf('after the session') >= 0));
yes('a continuation line with no stamp stays with the line above it',
    slice.lines.some(l => l.indexOf('continuation line') >= 0));

const missing = serverLogSlice('dev', from, to);
yes('a server log that is not on this box says so rather than throwing',
    missing.ok === false && missing.lines.length === 0 && String(missing.why).length > 0);

// ---- the server log slice after a roll (entry 220, #2349) ------------------
/*
  The game server runs under server-log.js, which moves server.log aside into
  server.log.<when> at a start when it is full or from another day, at
  midnight, at 4 MB, and at every install whatever the size. Found in review
  (entry 220), measured: a crash with the log past 4 MB, the watcher's restart
  rolled it, and the page then showed nothing for the crash session, because
  the slice read server.log and nothing else. So this builds that log, rolls
  it with the real writer's own roll, and asks again.
*/
const WRITER = require(path.join(REPO_DIR, 'scripts', 'vps', 'Server-Log.js'));
const rolledBy = 'Server-Log.js';
/* A start's roll (only when full or from another day) or, forced, an
   install's. The 30 days are left out on purpose: these lines are dated
   22 September and the sweep is tests\test-2349-server-log.js's. Each roll
   is a millisecond apart from the last, as a real one is, so no two rolled
   files share a last-write time. */
let rollClock = new Date(2026, 8, 22, 23, 0, 0).getTime();
function rollLog(file, force) {
  rollClock += 1000;
  if (!force && !WRITER.rollAtStart(file, rollClock)) return '';
  const to = WRITER.rollFile(file, rollClock);
  if (to) fs.utimesSync(to, new Date(rollClock), new Date(rollClock));
  return to ? 'rolled ' + path.basename(to) : '';
}
const has = (s, what) => s.lines.some(l => l.indexOf(what) >= 0);
const at = (h, m) => new Date(2026, 8, 22, h, m, 0).getTime();

const ROLLDIR = path.join(TMP, 'rolled');
fs.mkdirSync(path.join(ROLLDIR, 'dev'), { recursive: true });
SERVER_LOGS.main = path.join(ROLLDIR, 'server.log');
SERVER_LOGS.dev = path.join(ROLLDIR, 'dev', 'server.log');

/* A day's run past 4 MB, the crash at the end of it. */
const filler = '[2026-09-22 09:00:00.000] [console] [info] an ordinary line of engine noise\n';
const CRASHED =
  filler.repeat(Math.ceil((4 * 1024 * 1024 + 4096) / filler.length)) +
  '[2026-09-22 22:00:00.000] [console] [info] the crash session begins\n' +
  '[2026-09-22 22:05:00.000] [console] [error] FATAL the server went down\n' +
  '    at a stack line carrying no stamp of its own\n';
fs.writeFileSync(SERVER_LOGS.main, CRASHED);

const crashFrom = at(21, 59), crashTo = at(22, 6);
yes('before the restart, the crash session is on the page',
    has(serverLogSlice('main', crashFrom, crashTo), 'FATAL the server went down'));

const said = rollLog(SERVER_LOGS.main, false);
yes('the writer moved the 4 MB log aside, as it does at a start',
    said.indexOf('rolled') >= 0 && !fs.existsSync(SERVER_LOGS.main) &&
    WRITER.rolledFiles(SERVER_LOGS.main).length === 1);

const between = serverLogSlice('main', crashFrom, crashTo);
yes('in the moment before the server opens a new server.log, the crash session is still found',
    between.ok && has(between, 'FATAL the server went down'));

/* The restart, the writer opening a fresh server.log. */
fs.writeFileSync(SERVER_LOGS.main,
  '[2026-09-22 22:07:00.000] [console] [info] the server is up again\n' +
  '[2026-09-22 22:30:00.000] [console] [info] a session after the restart\n');

const after = serverLogSlice('main', crashFrom, crashTo);
yes('after the restart, the crash session is still on the page', after.ok && has(after, 'FATAL the server went down'));
yes('with the stack line under it', has(after, 'a stack line carrying no stamp'));
yes('and without the restart, which is outside its window', !has(after, 'the server is up again'));

const later = serverLogSlice('main', at(22, 29), at(22, 31));
yes('a session after the restart comes out of the new server.log',
    has(later, 'a session after the restart') && !has(later, 'FATAL'));

const across = serverLogSlice('main', at(22, 4), at(22, 8));
const fi = across.lines.findIndex(l => l.indexOf('FATAL') >= 0);
const ui = across.lines.findIndex(l => l.indexOf('the server is up again') >= 0);
yes('a session across the restart has both halves, oldest first', fi >= 0 && ui > fi);

/* An install rolls whatever the size, so the run before it can be a small
   rolled file with the crash a generation further back. */
rollLog(SERVER_LOGS.main, true);
fs.writeFileSync(SERVER_LOGS.main, '[2026-09-22 23:00:00.000] [console] [info] installed\n');
yes('an install roll put the crash a generation further back',
    WRITER.rolledFiles(SERVER_LOGS.main).length === 2);
yes('and the crash session is still found there',
    has(serverLogSlice('main', crashFrom, crashTo), 'FATAL the server went down'));

/* The read stays the 4 MB it always was: a server.log that fills the window
   is all that is read, so a busy week cannot make the page read five files. */
fs.writeFileSync(SERVER_LOGS.main, CRASHED.replace(/FATAL the server went down/, 'a later crash'));
const capped2 = serverLogSlice('main', crashFrom, crashTo);
yes('a server.log that fills the 4 MB window is read alone',
    has(capped2, 'a later crash') && !has(capped2, 'FATAL the server went down'));

/* dev is its own server with its own rolled logs, and a dev session reads
   only those. */
fs.writeFileSync(SERVER_LOGS.dev + '.1',
  '[2026-09-22 22:05:00.000] [console] [error] only on dev\n');
fs.writeFileSync(SERVER_LOGS.dev, '[2026-09-22 22:40:00.000] [console] [info] dev up again\n');
yes('a dev session reads the dev server\'s rolled log',
    has(serverLogSlice('dev', crashFrom, crashTo), 'only on dev'));
yes('and a live session never does',
    !has(serverLogSlice('main', crashFrom, crashTo), 'only on dev'));
console.log('       (rolled by ' + rolledBy + ')');

// ---- red against yellow ----------------------------------------------------
/*
  Two levels, because they want two different things done about them. Red is a
  crash or a throw and the bot says so out loud. Yellow is a session that
  failed for a reason already understood with a known fix, and says nothing in
  Discord, because there are a lot of those and a channel full of them is a
  channel nobody reads.
*/
/* The two marker lists, lifted whole, so the checks below run against the
   real ones rather than a copy that drifts. */
function grabConst(name) {
  const at = src.indexOf('const ' + name);
  if (at < 0) throw new Error('site/server.js has no const ' + name);
  const open = src.indexOf('[', at);
  let d = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '[') d++;
    else if (src[i] === ']') { d--; if (d === 0) return src.slice(open, i + 1); }
  }
  throw new Error('unbalanced brackets reading ' + name);
}
const TROUBLE_BAD = eval(grabConst('TROUBLE_BAD'));
const TROUBLE_WARN = eval(grabConst('TROUBLE_WARN'));
function grabLine(name) {
  const m = src.match(new RegExp('^const ' + name + ' = [^\\n]*;$', 'm'));
  if (!m) throw new Error('site/server.js has no one line const ' + name);
  return m[0];
}
eval([grabLine('SESSION_START_MARK'), grabLine('CRASH_EMPTY_MARK'), grab('thisSessionOf'), grab('serverRefusal'),
      grab('lineAround'), grab('scanFor'), grab('crashOf'), grab('readTrouble')].join('\n'));
/* How Shell starts a session in launcher.log, which is where this session's
   part of that log begins (#945). */
const PLAY = '2026-09-22 09:59:00  Starting the game on launcher 1.1.101.34, pack 20260928-1512-dev, borderless.\n';

yes('the red list and the yellow list are both real and separate',
    TROUBLE_BAD.length > 0 && TROUBLE_WARN.length > 0 &&
    !TROUBLE_BAD.some(b => TROUBLE_WARN.some(w => w[0] === b[0])));

const crash = readTrouble({ 'thornswood-front.log': 'fine\nUncaught TypeError: x is not a function\nmore\n' });
yes('a throw in a game log is red', crash && crash.level === 'bad');
yes('and the line it sat on is kept',
    crash && crash.line.indexOf('Uncaught TypeError') >= 0);

const upd = readTrouble({ 'launcher.log': 'fine\n' + PLAY + '2026-09-22 10:00:00  Update failed: the file was locked\n' });
yes('an update that did not install is yellow, not red', upd && upd.level === 'warn');
yes('it says what went wrong in plain words', upd && upd.why === 'an update did not install');

/* The game's own check, as the client writes it to Skyrim Platform's log. */
const lo = readTrouble({ 'skyrim-platform.log':
  '[18:11:18:263] [Script] Server load order:\n' +
  '[18:11:18:270] [Script] 21-th mod (numbered from 0) does not match.\n' +
  '[18:11:18:271] [Script] Error: Load order check failed! Indices: [21]\n' });
yes('the game finding its load order is not the server\'s is yellow, not red', lo && lo.level === 'warn');
yes('and it says the game showed LOAD ORDER ERROR', lo && /the game showed LOAD ORDER ERROR/.test(lo.why));

const both = readTrouble({
  'launcher.log': PLAY + 'Update failed: locked\n',
  'thornswood-front.log': 'Unhandled exception in the plugin\n'
});
yes('a session that both crashed and had a load order complaint is RED',
    both && both.level === 'bad');

yes('a clean session is neither', readTrouble({ 'launcher.log': PLAY + 'played\nclosed\n' }) === null);

// ---- a crash log in the set is a crash (#2319) -------------------------------
/*
  Three dev crashes from 29 Sep to 6 Oct hung inside the crash handler and left
  Crash Logger's log empty. The launcher did not send an empty log, nothing in
  the other logs matched a red marker, and none of the three went red or
  reached the staff channel. The launcher's crash.log now starts with a line
  of its own (Discord.CrashLogHead; tests\test-log-upload.ps1 sends one through
  here), so an empty log arrives, and a crash.log in the set is a crash.
*/
const EMPTY_HEAD = 'Sent by the launcher: this session crashed. Crash Logger\'s log of it is crash-2026-10-04-17-03-03.log, ' +
  'and it is empty: 0 bytes when the launcher read it, so nothing of the crash is in it. The full crash snapshot beside it is ' +
  'crash-2026-10-04-17-03-03.dmp, 3,973,120,000 bytes; it stays on that PC.\n';
const empty = readTrouble({ 'launcher.log': PLAY + 'The game crashed. Its crash log is crash-2026-10-04-17-03-03.log in C:\\x.\n',
                            'crash.log': EMPTY_HEAD, 'thornswood-front.log': 'fine\n' });
yes('a crash whose log is empty is red', !!empty && empty.level === 'bad');
yes('  and says the crash log is empty', !!empty && empty.why === 'the game crashed, and its crash log is empty');
yes('  keeping the launcher\'s line, with the log\'s name, its size and the snapshot\'s',
    !!empty && empty.file === 'crash.log' && /crash-2026-10-04-17-03-03\.log/.test(empty.line) && /0 bytes/.test(empty.line) && /3,973,120,000 bytes/.test(empty.line));
const full = readTrouble({ 'crash.log': 'Sent by the launcher: this session crashed. Crash Logger\'s log of it is crash-x.log, 45,120 bytes; what it says follows. There is no crash snapshot beside it.\n' +
                                        'Skyrim SSE v1.6.1170\nCrashLoggerSSE v1-24-0-0\n\nUnhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF7C52AF7EF\n' });
yes('a crash with a full log is red too, saying the game crashed', !!full && full.level === 'bad' && full.why === 'the game crashed');
yes('  keeping the crash\'s own line', !!full && /Unhandled exception "EXCEPTION_ACCESS_VIOLATION"/.test(full.line));
const odd = readTrouble({ 'crash.log': 'a crash log in a shape no marker knows\n' });
yes('a crash.log no marker matches is still a crash', !!odd && odd.level === 'bad' && odd.file === 'crash.log');
yes('a crash.log of nothing but white space is not', readTrouble({ 'crash.log': '  \n\n' }) === null);
/* launcher.log carries earlier days; a crash from before this session's
   start is not this one (#945), and neither is the launcher's own crash line. */
const older = readTrouble({ 'launcher.log': '2026-10-03 21:00:00  The game crashed. Its crash log is crash-2026-10-03-21-00-00.log in C:\\x.\n' +
                                            'Skyrim has crashed with an older fault\n' + PLAY + 'played\nclosed\n' });
yes('a crash written in launcher.log before this session started does not mark it', older === null);

// ---- only this session's part of launcher.log (#945) ------------------------
/*
  28 Sep: 42 of the 53 sessions from 25 Sep on were labelled "the game refused
  them over the load order". Every one took the label from a Scan line in
  launcher.log written half an hour to 65 hours BEFORE the session, which Fix
  had put right; the Scan just before each Play said 0 issues, and the game's
  own check passed in every session whose platform log still held it. These
  are the three lines that did it, as they were written.
*/
const DJINN = '2026-09-24 12:31:43    blocks Play: Your load order is not the server\'s from position 52: you have Hothtrooper44_Armor_Ecksstra.esp there, the server has SkyHUD.esp. The game shows that as LOAD ORDER ERROR. Fix puts the server\'s order into this build\'s plugin list; nothing is downloaded.\n';
const BLADE = '2026-09-24 22:23:00    blocks Play: ccBGSSSE001-Fish.esm is loaded by the game on its own, because Skyrim.ccc names it, and the server does not have it, so every plugin after it is out of place and the game shows LOAD ORDER ERROR. Fix moves it aside into Thornswood\'s Isolated folder and nothing is deleted.\n';
const PATRICK = '2026-09-24 09:56:00    blocks Play: Thornswood-Content.esp is not the same file the server has (yours is 138.1 KB, the server\'s is 137.9 KB). The game shows that as LOAD ORDER ERROR and anything in it can mean something else here than on the server. Fix fetches the server\'s copy.\n';
const FIXED = '2026-09-24 12:32:00  Fix put 3 things right. Restart the game for it to take effect.\n' +
              '2026-09-24 12:32:01  Scan finished. 0 issues found.\n';
const LATER = '2026-09-26 17:48:00  Starting the game on launcher 1.1.95.2, pack 20260926-1612, borderless.\n' +
              '2026-09-26 17:53:00  Game closed after 5 minutes. Your Windows Skyrim folders are back to normal.\n';

for (const [who, line] of [['Djinn\'s position 52', DJINN], ['Blade\'s Creation Club file', BLADE], ['Patrick\'s content plugin', PATRICK]]) {
  yes(who + ': a Scan line from days before the session, put right by Fix, does not colour the session',
      readTrouble({ 'launcher.log': line + FIXED + LATER }) === null);
}
yes('an update that failed days before the session does not colour it',
    readTrouble({ 'launcher.log': '2026-09-19 03:23:00  Update failed: (404) Not Found\n' + LATER }) === null);
yes('nor does a launcher exception from days before, which would have been red and said in Discord',
    readTrouble({ 'launcher.log': '2026-09-20 10:00:00  Unhandled exception in Scan\n' + LATER }) === null);
yes('only the LAST start is this session: a failure between two earlier games is not it',
    readTrouble({ 'launcher.log': PLAY + 'Update failed: locked\n' + LATER }) === null);
yes('a launcher.log with no start line has nothing to place in this session, so none of it is read',
    readTrouble({ 'launcher.log': DJINN + 'Update failed: locked\n' }) === null);
yes('the game logs are read whole: they start afresh every run',
    readTrouble({ 'launcher.log': DJINN, 'thornswood-front.log': 'Uncaught TypeError: x\n' }).level === 'bad');

const mid = readTrouble({ 'launcher.log': LATER + DJINN });
yes('a launcher Scan during the session still says their load order did not match',
    !!mid && mid.why === 'their load order did not match the server');
yes('and never that the game showed LOAD ORDER ERROR, which only the game can say',
    !!mid && !/the game showed/.test(mid.why));
yes('the words LOAD ORDER ERROR are not a marker: they are in the launcher\'s own sentences',
    !TROUBLE_WARN.some(w => w[0] === 'LOAD ORDER ERROR'));

// ---- what the game server said (#945, #402, #873) ---------------------------
const SRV = [
  '[2026-09-28 20:00:01.000] [console] [info] [thornswood] load order of profile 7 matches the server\'s, 48 plugins',
  '[2026-09-28 20:00:02.000] [console] [info] [thornswood] refusing profile 42: load order differs at 21, where the server has ElysiumEstateSSE.esp'
];
const refused = readTrouble({ 'launcher.log': LATER }, SRV, 42);
yes('the server ending the session over the load order is said, from the server log',
    !!refused && refused.file === 'server' && /the server ended the session: their load order/.test(refused.why));
yes('and the line names the plugin', !!refused && refused.line.indexOf('ElysiumEstateSSE.esp') >= 0);
yes('another profile\'s refusal is not this session\'s', readTrouble({ 'launcher.log': LATER }, SRV, 4) === null);
yes('a profile that matched is clean', readTrouble({ 'launcher.log': LATER }, SRV, 7) === null);
yes('profile 4 is not read as the start of 42',
    serverRefusal(['[x] [thornswood] refusing profile 42: load order differs at 1'], 4) === null);
const noReport = serverRefusal(['[x] [thornswood] refusing profile 42: no load order report in 300s online'], 42);
yes('a refusal for never reporting says so, not that the order differed',
    !!noReport && /never said which plugins/.test(noReport.why));
const watched = serverRefusal(['[x] [thornswood] WOULD REFUSE profile 42: load order differs at 21, where the server has X.esp. Watching only, they stayed (thornswoodLoadOrderRefuse is not true).'], 42);
yes('watching only says the server let them stay', !!watched && /let them stay/.test(watched.why));
yes('the server failing to find the connection is not a refusal',
    serverRefusal(['[x] [thornswood] could not refuse profile 42: gone'], 42) === null);
yes('a crash still outranks the server',
    readTrouble({ 'launcher.log': LATER, 'thornswood-front.log': 'Uncaught TypeError: x\n' }, SRV, 42).level === 'bad');
yes('the server outranks the launcher\'s own Scan lines',
    readTrouble({ 'launcher.log': LATER + DJINN }, SRV, 42).file === 'server');

/* The words these read are other files' words. If one moves, this says so. */
const GM = fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8');
yes('gamemode.js still logs a refusal as "refusing profile N: load order differs"',
    GM.indexOf("'[thornswood] refusing profile ' + profileId + ': load order differs at '") >= 0);
yes('and one for no report as "refusing profile N: no load order report"',
    GM.indexOf("'[thornswood] refusing profile ' + pid + ': no load order report in '") >= 0);
yes('and watching only as "WOULD REFUSE profile N:"',
    GM.indexOf("'[thornswood] WOULD REFUSE profile ' + profileId + ': load order differs at '") >= 0);
// Play(), which writes it, moved from Shell.cs to ShellPlay.cs in #2093 (#500).
const SHELL_PLAY = fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'ShellPlay.cs'), 'utf8');
yes('ShellPlay.cs still starts a session in launcher.log with the line this cuts at',
    SHELL_PLAY.indexOf('Log("' + eval(grabLine('SESSION_START_MARK').replace(/^const SESSION_START_MARK = /, '')) + '" + Updater.Version') >= 0);
const CLIENT = path.join(REPO_DIR, 'engine', 'skymp', 'skymp5-client', 'src', 'services', 'services', 'loadOrderVerificationService.ts');
if (fs.existsSync(CLIENT)) {
  const LOV = fs.readFileSync(CLIENT, 'utf8');
  yes('the client still logs "Load order check failed" and "Missing some server mods"',
      LOV.indexOf('Load order check failed!') >= 0 && LOV.indexOf('Missing some server mods') >= 0);
} else {
  console.log('SKIP  the engine is not checked out here, so the client\'s own words are not read');
}

// ---- the rows written before #945 are read again, once ---------------------
const TROUBLE_RULES = Number(grabLine('TROUBLE_RULES').replace(/[^0-9]/g, ''));
function putSessions(rows) { ROWS = rows; return true; }
eval([grab('sessionKey'), grab('applyTrouble'), grab('rereadTrouble')].join('\n'));
putSessionLogs('stale945stale945', '555', { 'launcher.log': DJINN + FIXED + LATER });
putSessionLogs('crash945crash945', '555', { 'launcher.log': LATER, 'thornswood-front.log': 'Uncaught TypeError: x\n' });
ROWS = [
  { session: 'stale945stale945', who: '555', trouble: 'the game refused them over the load order',
    troubleAt: 'warn', troubleFile: 'launcher.log', troubleLine: DJINN.trim() },
  { session: 'crash945crash945', who: '555', trouble: 'a script threw and nothing caught it',
    troubleAt: 'bad', troubleFile: 'thornswood-front.log', troubleLine: 'Uncaught TypeError: x' },
  { session: 'nologs945nologs9', who: '555', trouble: 'the game refused them over the load order', troubleAt: 'warn' }
];
rereadTrouble();
yes('a stored session labelled from a days old Scan line is clean once read again',
    !ROWS[0].trouble && !ROWS[0].troubleAt && !ROWS[0].troubleLine);
yes('a genuine crash stays red', ROWS[1].troubleAt === 'bad');
yes('a session with no stored logs keeps what it had, there is nothing to read it against',
    ROWS[2].trouble === 'the game refused them over the load order');
yes('every row is marked read under these rules', ROWS.every(r => r.troubleRules === TROUBLE_RULES));
ROWS[1].trouble = 'left alone';
rereadTrouble();
yes('and a row already read under these rules is not read again', ROWS[1].trouble === 'left alone');
const withIssues = { issues: [{ text: 'x', blocking: true }] };
applyTrouble(withIssues, null);
yes('with no log line, the launcher\'s own blocking issues still colour the session',
    withIssues.troubleAt === 'warn' && /would have stopped them connecting/.test(withIssues.trouble));
yes('no logs at all is neither', readTrouble({}) === null);

/* The thing that would make this useless: a marker so loose that ordinary
   lines match it. The word "error" appears in healthy logs all the time. */
yes('the word error on its own does not colour a session',
    readTrouble({ 'launcher.log': 'checked for errors, found none\n' }) === null);

// ---- the crash evidence (entry 105) ----------------------------------------
/*
  Entry 105: the game went down with the creation panel open and an alt tab,
  and left no message. What settles a native crash is the SKSE crash log and
  Skyrim Platform's own log. Until 24 September the launcher sent neither and
  the site would have dropped both. These check that the two ends agree, by
  reading the launcher's list out of Discord.cs rather than keeping a copy of
  it here. The launcher's own half is test-log-upload.ps1.
*/
const CS = fs.readFileSync(path.join(REPO_DIR, 'launcher', 'app', 'Discord.cs'), 'utf8');
const sends = (function () {
  const at = CS.indexOf('public static void SessionLogs()');
  const end = at < 0 ? -1 : CS.indexOf('};', at);
  const block = end < 0 ? '' : CS.slice(at, end);
  const out = [];
  const re = /new string\[\] \{ "([^"]+)",/g;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return out;
})();
yes('the launcher list reads out of Discord.cs', sends.length >= 8);
yes('the launcher sends the SKSE crash log', sends.indexOf('crash.log') >= 0);
yes("the launcher sends Skyrim Platform's own log", sends.indexOf('skyrim-platform.log') >= 0);
yes('every log the launcher sends is one the site keeps',
    sends.length > 0 && sends.every(n => SLOG_NAMES.indexOf(n) >= 0));
yes('in the same order, so both ends leave out the same ones first',
    JSON.stringify(sends) === JSON.stringify(SLOG_NAMES));

/* #3627: the privacy page named one log, "about the game", while ten files
   went up at the end of every session. The page now names each file the
   site keeps, under one heading, and this pins the two lists together both
   ways: a name added to SLOG_NAMES that the page does not name fails here,
   and so does a file the page names that nothing sends any more. */
const PRIVACY = fs.readFileSync(path.join(REPO_DIR, 'site', 'data', 'site', 'privacy.md'), 'utf8').replace(/\r\n/g, '\n');
const LOGS_HEAD = '**The logs sent when a session ends.**';
const logsAt = PRIVACY.indexOf(LOGS_HEAD);
const logsEnd = logsAt < 0 ? -1 : PRIVACY.indexOf('\n**', logsAt + LOGS_HEAD.length);
const logsPart = logsAt < 0 ? '' : PRIVACY.slice(logsAt, logsEnd < 0 ? PRIVACY.length : logsEnd);
const named = (logsPart.match(/\*\*[a-z0-9-]+\.(?:log|txt)\*\*/g) || []).map((m) => m.slice(2, -2));
yes('the privacy page has a part for the logs sent when a session ends', logsPart.length > 0);
const unnamed = SLOG_NAMES.filter((n) => named.indexOf(n) < 0);
yes('every file the site keeps is named there (' + (unnamed.join(', ') || 'all named') + ')', logsPart.length > 0 && unnamed.length === 0);
const unsent = named.filter((n) => SLOG_NAMES.indexOf(n) < 0);
yes('and the page names no file that is not sent (' + (unsent.join(', ') || 'none') + ')', logsPart.length > 0 && unsent.length === 0);
const keptFor = /\*\*The logs sent when a session ends\*\*[^\n]*\n(?:  [^\n]*\n)*/.exec(PRIVACY);
yes('and the page gives those logs their 365 days, and says a kept session keeps them',
    !!keptFor && /365 days/.test(keptFor[0]) && /kept/.test(keptFor[0]) && SLOG_DAYS === 365);

/* The launcher leaves a log out rather than send a body the site cuts off,
   because a body past the cap is dropped whole, every log in it. */
const product = s => s.split('*').reduce((a, b) => a * Number(b.trim()), 1);
const lm = /const int LogBodyMax = ([0-9 *]+);/.exec(CS);
const bm = /body\(req, SLOG_ALL \+ ([0-9 *]+)\)/.exec(src);
yes('the launcher never sends a body bigger than the site reads',
    !!lm && !!bm && product(lm[1]) > 0 && product(lm[1]) <= SLOG_ALL + product(bm[1]));

/* The head of a real CrashLogger file, Patrick's machine, 22 September, cut
   to the lines that matter here. */
const CRASH = [
  'CRASH TIME: 2026-09-22 20:48:59',
  'Skyrim SSE v1.6.1170',
  'CrashLoggerSSE v1-24-0-0 Jun 28 2026 00:14:22',
  '',
  'Unhandled exception "EXCEPTION_ACCESS_VIOLATION" at 0x7FF7C52AF7EF SkyrimSE.exe+01AF7EF\tcmp [rdi], eax',
  'Exception Flags: 0x00000000 (Continuable)',
  ''
].join('\n');
/* Ordinary lines out of skyrim-platform.log from a clean session on the same
   machine, 23 September. */
const PLATFORM = [
  '[10:19:48:897] platform_se v2.9.0',
  '[10:19:49:178] Failed to register messaging listener for NirnLabUIPlatform',
  '[10:20:30:775] [Script] Trace in ServerJsVerificationService: Empty server JS, skipping verification',
  '[10:21:31:854] [Script] Trace in AuthService: onBrowserMessage: ["thornswood-front","skills:closed"]',
  '[10:21:37:330] onResult called',
  '[10:21:37:341] Latent callback called',
  '[10:22:03:307] [Script] [front] 10:22:03.306 the Console Native UI Menu opened on its own and has been shut',
  ''
].join('\n');

yes('a set carrying both is saved',
    putSessionLogs('crash105crash105', '444', { 'crash.log': CRASH, 'skyrim-platform.log': PLATFORM }) === 'saved');
const readSet = key => fs.existsSync(slogFile(key))
  ? JSON.parse(fs.readFileSync(slogFile(key), 'utf8')) : { logs: {}, sha256: {} };
const ev = readSet('crash105crash105');
yes('the crash log is kept whole', ev.logs['crash.log'] === CRASH);
yes('the platform log is kept', ev.logs['skyrim-platform.log'] === PLATFORM);
yes('each with its sha256', !!ev.sha256['crash.log'] && !!ev.sha256['skyrim-platform.log']);

const big = {};
for (const n of SLOG_NAMES) big[n] = 'z'.repeat(SLOG_ONE);
big['crash.log'] = CRASH;
putSessionLogs('crash106crash106', '444', big);
const kept = readSet('crash106crash106');
yes('in a set too big for the site, the crash log is still kept', kept.logs['crash.log'] === CRASH);
yes('and the platform log, last on the list, is what goes', !('skyrim-platform.log' in kept.logs));

const cr = readTrouble({ 'launcher.log': 'started\nclosed\n', 'crash.log': CRASH });
yes('a session that sent a crash log is red', !!cr && cr.level === 'bad' && cr.file === 'crash.log');
yes('and the line it points at is the exception',
    !!cr && cr.line.indexOf('EXCEPTION_ACCESS_VIOLATION') >= 0);
yes('the ordinary platform log of a clean session does not colour it',
    readTrouble({ 'launcher.log': 'started\nclosed\n', 'skyrim-platform.log': PLATFORM }) === null);

// ---- the row the bot reads (issue #532) ------------------------------------
/*
  noteTrouble writes the row the bot turns into a Discord line. A late upload
  must not read as a fresh failure: a 401 held Patrick's 23 September logs
  until 14:09 the next day, and the alert fired ~14:10 as if the crash had just
  happened. The fix rests on the session's OWN window surviving into the row,
  apart from the arrival time, so the bot can name the start and call out a
  late arrival. Without start and end the bot has only "at" and every backlog
  looks new. noteTrouble is lifted whole, so a rename fails here.
*/
const TROUBLE_FILE = path.join(TMP, 'trouble.json');
const TROUBLE_KEEP = 200;
const jsonFile = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fb; } };
const putJson = (p, o) => { try { fs.writeFileSync(p, JSON.stringify(o, null, 2), 'utf8'); return true; } catch (e) { return false; } };
eval(grab('noteTrouble'));
// Since #2166 noteTrouble ages the file by the session window on the way in,
// through freshTrouble, which reads which sessions are kept from the same
// sessionRows stand-in as the log prune above.
const SESSIONS_DAYS = 365;
eval(grab('freshTrouble'));

const started = new Date(2026, 8, 23, 20, 7, 0).getTime();
const ended = new Date(2026, 8, 23, 21, 30, 0).getTime();
noteTrouble(
  { session: 'late1111late1111', who: '111', name: 'Patrick Thornwood',
    channel: 'dev', profile: 3, version: '1.1.91.10', start: started, end: ended },
  { why: 'a script hit a ReferenceError', file: 'thornswood-front.log',
    line: 'ReferenceError: x is not defined', level: 'bad' });
const troubled = () => jsonFile(TROUBLE_FILE, []);
const late = troubled().find(r => r.session === 'late1111late1111');
yes('the row the bot reads carries the session start', !!late && late.start === started);
yes('and the session end', !!late && late.end === ended);
yes('and the arrival time, which is when the logs actually landed', !!late && late.at > 0);
yes('so the start and the arrival are separate numbers, the whole point of #532',
    !!late && late.start !== late.at);

// A session whose start was never seen writes 0, so the bot drops the phrase
// rather than naming a wrong time.
noteTrouble(
  { session: 'nostart0nostart0', who: '111', channel: 'main', end: ended },
  { why: 'the game crashed', file: 'crash.log', line: 'EXCEPTION', level: 'bad' });
const noStart = troubled().find(r => r.session === 'nostart0nostart0');
yes('a session with no start writes start 0 rather than guessing',
    !!noStart && noStart.start === 0);

// Write once per session id here too: a second note for the same session does
// not overwrite the first, the way it must not on the box.
noteTrouble(
  { session: 'late1111late1111', who: '111', name: 'Someone Else',
    start: started + 1, end: ended + 1 },
  { why: 'a different thing', file: 'launcher.log', line: 'x', level: 'bad' });
const again = troubled().filter(r => r.session === 'late1111late1111');
yes('a second note for the same session is not added twice', again.length === 1);

// ---- what is said when it fails (#2736) ------------------------------------
/*
  The /api/play/logs handler stored the logs, then read the issues and the
  trouble inside try { ... } with a catch that held nothing, and
  putSessionLogs answered a set the folder would not take as 'nothing', so
  the launcher was told 200 stored false and dropped the logs. Each failure is
  said in the site's log now (the session key and the error code, never what
  the logs hold) and answered for what it is.
*/
{
  const said = [];
  const wasError = console.error;
  console.error = function () { said.push(Array.prototype.slice.call(arguments).join(' ')); };
  try {
    // A file where the folder should be: the set cannot be written.
    const notAFolder = path.join(TMP, 'not-a-folder');
    fs.writeFileSync(notAFolder, 'a file where the session-logs folder should be');
    const putInto = new Function('fs', 'path', 'crypto', 'SLOGS', 'SLOG_ONE', 'SLOG_ALL', 'SLOG_NAMES',
      grab('slogFile') + '\n' + grab('slogTrim') + '\n' + grab('putSessionLogs') + '\nreturn putSessionLogs;')(
      fs, path, crypto, notAFolder, SLOG_ONE, SLOG_ALL, SLOG_NAMES);
    const got = putInto('fail2736fail2736', '111', { 'launcher.log': 'a crash worth keeping\n' });
    yes('a set the folder will not take answers failed, not nothing', got === 'failed');
    const line = said.filter((l) => l.indexOf('session-logs ') >= 0 && l.indexOf('"write-failed"') >= 0)[0] || '';
    yes('and is said in the site log as session-logs write-failed with its key and code',
        /^\[thornswood-docs\] session-logs \{/.test(line) && line.indexOf('fail2736fail2736') >= 0 && /"code":"E[A-Z]+"/.test(line));
    yes('and the line holds nothing the logs held', line.indexOf('a crash worth keeping') < 0);

    // A first set that has gone bad on disk: a replay is still refused, the
    // bad set is not written over, and both are said.
    said.length = 0;
    const BADK = 'bad27362736bad2';
    fs.writeFileSync(slogFile(BADK), '{"logs": {"launcher.log": "truncat');
    const before = fs.readFileSync(slogFile(BADK), 'utf8');
    yes('a replay of a set that will not read is still refused', putSessionLogs(BADK, '111', { 'launcher.log': 'clean\n' }) === 'already');
    yes('and the set that will not read is not written over', fs.readFileSync(slogFile(BADK), 'utf8') === before);
    yes('and it is said as session-logs set-unreadable with its key',
        said.some((l) => l.indexOf('session-logs ') >= 0 && l.indexOf('"set-unreadable"') >= 0 && l.indexOf(BADK) >= 0));
    yes('and nothing it held is in the line', !said.some((l) => l.indexOf('truncat') >= 0));

    // The bot's crash note: true when written, false and said when not.
    said.length = 0;
    const noteWith = (put) => new Function('jsonFile', 'putJson', 'freshTrouble', 'TROUBLE_FILE', 'TROUBLE_KEEP', 'path',
      grab('noteTrouble') + '\nreturn noteTrouble;')(jsonFile, put, freshTrouble, path.join(TMP, 'trouble-2736.json'), TROUBLE_KEEP, path);
    const crash = { why: 'the game crashed', file: 'crash.log', line: 'EXCEPTION', level: 'bad' };
    yes('noteTrouble answers true when the bot\'s row is written',
        noteWith(putJson)({ session: 'note2736note2736', who: '111', start: 1, end: 2 }, crash) === true);
    yes('noteTrouble answers false when the row cannot be written',
        noteWith(() => false)({ session: 'gone2736gone2736', who: '111', start: 1, end: 2 }, crash) === false);
    yes('and says it as trouble write-failed with the session, never the line',
        said.some((l) => /^\[thornswood-docs\] trouble \{/.test(l) && l.indexOf('"write-failed"') >= 0 && l.indexOf('gone2736gone2736') >= 0 && l.indexOf('EXCEPTION') < 0));
  } finally {
    console.error = wasError;
  }

  // The handler itself, read as text: no catch with nothing in it, a set
  // that failed is a 500 the launcher sends again, and a row or a note that
  // will not write is answered read false or noted false.
  const from = src.indexOf("if (p === '/api/play/logs' && req.method === 'POST') {");
  const to = src.indexOf('The character roster', from);
  const handler = (from >= 0 && to > from) ? src.slice(from, to) : '';
  yes('the /api/play/logs handler is found in server.js', handler.length > 0);
  yes('and holds no catch with nothing in it', !/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(handler));
  yes('and answers a set that failed with 500, which the launcher sends again',
      /what === 'failed'\) return sendJson\(res, 500/.test(handler));
  yes('and answers a row that will not write with read false', /if \(!putSessions\(rows\)\)[\s\S]*?answer\.read = false/.test(handler));
  yes('and a crash note that will not write with noted false', /!noteTrouble\(rows\[at\], found\)\) answer\.noted = false/.test(handler));
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
process.exit(fail ? 1 : 0);
