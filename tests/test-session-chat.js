/*
  test-session-chat.js

      node .\tests\test-session-chat.js

  What people said used to be a page of its own: the whole chat log, a day at a
  time, for everybody at once. Patrick on 22 September: put it under each
  person on /sessions, split per session. chatSlice in site\server.js does
  the splitting and /api/session-logs hands the lines back with the rest of
  that session.

  THE SPLIT IS THE WHOLE THING AND IT IS THE PART THAT CAN BE SILENTLY WRONG.
  A slice that is too wide puts somebody else's words, or last night's words,
  under this session and into a report about behaviour. A slice that is too
  narrow drops what was actually said. Neither looks like a fault on the page:
  both render as a tidy list. So these check the boundaries, one at a time.

  It reads the real function out of site\server.js rather than a copy.

  DEV AND LIVE ARE TWO VOICE SERVICES WITH TWO CHAT FOLDERS. Until 24
  September chatSlice read the live folder for every session, so a dev session
  showed nothing, or showed what the same profile number said on the live
  server in that window. Testing goes to the dev build first, so most sessions
  on /sessions are dev ones. The last block checks the dev case, the call that
  passes the session's channel in, and the folders the defaults point at.
*/
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const os = require('os');
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-slice-'));
const CHAT_DIR = path.join(TMP, 'live');
const DEV_CHAT_DIR = path.join(TMP, 'dev');
fs.mkdirSync(CHAT_DIR);
fs.mkdirSync(DEV_CHAT_DIR);
const CHAT_DIRS = { main: CHAT_DIR, dev: DEV_CHAT_DIR };
eval(grab('chatSlice'));

/* The voice service's own day naming, local time, so a line written at
   23:59 and one written at 00:01 land in different files. */
function dayOf(at) {
  const d = new Date(at);
  const p = (n) => (n < 10 ? '0' : '') + n;
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function write(at, profileId, text, extra, dir) {
  const line = Object.assign({ at: at, kind: 'say', peer: 1, profileId: profileId,
                               name: 'p' + profileId, proven: true, mode: 'local', text: text }, extra || {});
  fs.appendFileSync(path.join(dir || CHAT_DIR, dayOf(at) + '.jsonl'), JSON.stringify(line) + '\n');
}

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

// A session at a fixed local time, well away from midnight.
const T = new Date(2026, 8, 22, 14, 0, 0).getTime();
const START = T, END = T + 30 * 60000;

write(START - 5000,  7, 'before the session');
write(START + 1000,  7, 'first thing');
write(START + 60000, 7, '/tp somewhere', { kind: 'command' });
write(START + 90000, 8, 'somebody else entirely');
write(START + 120000, 7, 'unproven line', { proven: false });
write(END - 1000,    7, 'last thing');
write(END + 5000,    7, 'after the session');

const got = chatSlice(7, START, END);

yes('only this profile and this window come back', got.lines.length === 4);
yes('nothing from before the session', !got.lines.some((l) => l.text === 'before the session'));
yes('nothing from after the session', !got.lines.some((l) => l.text === 'after the session'));
yes('nobody else in the room', !got.lines.some((l) => l.text === 'somebody else entirely'));
yes('slash commands are kept', got.lines.some((l) => l.kind === 'command'));
yes('and marked as commands', got.lines.filter((l) => l.kind === 'command').length === 1);
yes('an unproven line is kept', got.lines.some((l) => l.text === 'unproven line'));
yes('and marked unproven', got.lines.filter((l) => l.proven === false).length === 1);
yes('oldest first, the way it was said', got.lines[0].text === 'first thing' &&
    got.lines[got.lines.length - 1].text === 'last thing');
yes('the reason is empty when a log was actually read', got.why === '');

// ---- the edges of the window, one at a time --------------------------------
yes('a line exactly on the start is in', chatSlice(7, START + 1000, END).lines.some((l) => l.text === 'first thing'));
yes('a line exactly on the end is in', chatSlice(7, START, END - 1000).lines.some((l) => l.text === 'last thing'));
yes('a millisecond before the start is out', !chatSlice(7, START + 1001, END).lines.some((l) => l.text === 'first thing'));
yes('a millisecond after the end is out', !chatSlice(7, START, END - 1001).lines.some((l) => l.text === 'last thing'));

// ---- a session that runs over midnight -------------------------------------
const LATE = new Date(2026, 8, 23, 23, 50, 0).getTime();
write(LATE + 60000, 9, 'said before midnight');
write(LATE + 25 * 60000, 9, 'said after midnight');
const over = chatSlice(9, LATE, LATE + 40 * 60000);
yes('a session over midnight reads both days', over.lines.length === 2);
yes('and puts them in order across the boundary',
    over.lines[0].text === 'said before midnight' && over.lines[1].text === 'said after midnight');

// ---- nothing to read -------------------------------------------------------
yes('a profile that said nothing comes back empty', chatSlice(404, START, END).lines.length === 0);
yes('and says nothing was wrong', chatSlice(404, START, END).why === '');

const far = new Date(2019, 0, 1, 12, 0, 0).getTime();
const none = chatSlice(7, far, far + 60000);
yes('a day with no file at all says so', none.lines.length === 0 && none.why.indexOf('no chat log') >= 0);

/* A session with no profile number never reached a world, so there is nobody
   to match on. Asking for profile 0 would otherwise match every line whose
   profileId is missing. */
const zero = chatSlice(0, START, END);
yes('a session with no profile matches nothing', zero.lines.length === 0);

// ---- a truncated last line ------------------------------------------------
// An append-only log killed mid-write has one by design, and one bad line
// must not cost the rest.
fs.appendFileSync(path.join(CHAT_DIR, dayOf(START) + '.jsonl'), '{"at":' + (START + 2000) + ',"prof');
const after = chatSlice(7, START, END);
yes('a half written last line is skipped, not thrown', after.lines.length === 4);

// ---- a dev session reads the dev voice service's folder --------------------
// The same profile number on both servers in the same window, which is what
// happens when somebody tries a thing on dev and then goes back to live. Its
// own day, so nothing above is disturbed.
const D = new Date(2026, 8, 24, 15, 0, 0).getTime();
const DEND = D + 30 * 60000;
write(D + 1000, 12, 'said on live', null, CHAT_DIR);
write(D + 2000, 12, 'said on dev', null, DEV_CHAT_DIR);
write(D + 3000, 12, '/tp dev', { kind: 'command' }, DEV_CHAT_DIR);
write(D + 4000, 13, 'somebody else on dev', null, DEV_CHAT_DIR);

const onDev = chatSlice(12, D, DEND, 'dev');
yes('a dev session gets what they said on dev', onDev.lines.length === 2 && onDev.lines[0].text === 'said on dev');
yes('and never the live server\'s lines for the same profile', !onDev.lines.some((l) => l.text === 'said on live'));
yes('and its slash commands on dev, marked', onDev.lines.some((l) => l.kind === 'command' && l.text === '/tp dev'));
const onMain = chatSlice(12, D, DEND, 'main');
yes('a live session gets what they said on live', onMain.lines.length === 1 && onMain.lines[0].text === 'said on live');
yes('and never the dev lines', !onMain.lines.some((l) => l.text === 'said on dev' || l.text === '/tp dev'));
/* serverLogSlice reads live when the launcher did not say which build it was,
   so the chat does too: the two halves of one session come from one server. */
const unsaid = chatSlice(12, D, DEND, '');
yes('a session that did not say its build reads live, as its server log does',
    unsaid.lines.length === 1 && unsaid.lines[0].text === 'said on live');

const E = new Date(2026, 8, 25, 15, 0, 0).getTime();
write(E + 1000, 12, 'live only day', null, CHAT_DIR);
const noDev = chatSlice(12, E, E + 60000, 'dev');
yes('a dev day with no dev file does not borrow the live one', noDev.lines.length === 0);
yes('and says it is the dev log that is missing', noDev.why.indexOf('no chat log') >= 0 && noDev.why.indexOf('dev') >= 0);

// ---- the call that hands a session its chat ---------------------------------
// The function taking a channel is no use if the one caller leaves it off,
// which is exactly how the live folder got read for every session.
const route = src.indexOf("p === '/api/session-logs'");
const handler = route >= 0 ? src.slice(route, src.indexOf('sendJson(res, 200', route)) : '';
yes('/api/session-logs passes the session\'s channel into chatSlice',
    /chatSlice\(\s*row\.profile\s*,\s*from\s*,\s*to\s*,\s*row\.channel\s*\)/.test(handler));
yes('and reads the server log beside it by the same channel', /serverLogSlice\(\s*row\.channel\s*,/.test(handler));

// ---- the folders the defaults point at --------------------------------------
// Where each voice service writes its chat is known from the repo, not
// guessed: voice-server.js writes into its own folder unless
// THORNSWOOD_CHAT_DIR is set, nothing that installs it sets that, and the
// folders are named in vps-dev-instance.ps1 and Get-Logs.ps1. If any of those
// moves, the site's default has to move with it, and this is what says so.
const readTool = (f) => { try { return fs.readFileSync(path.join(REPO_DIR, f), 'utf8'); } catch (e) { return ''; } };
const vpsDev = readTool('scripts/vps/vps-dev-instance.ps1');
const getLogs = readTool('scripts/vps/Get-Logs.ps1');
// Since ae7b0e0 (29 September) the two folders are the script's parameters,
// -LiveVoice and -DevVoice, and these are their defaults.
const liveRoot = (vpsDev.match(/\[string\]\$LiveVoice\s*=\s*'([^']+)'/) || [])[1] || '';
const devRoot = (vpsDev.match(/\[string\]\$DevVoice\s*=\s*'([^']+)'/) || [])[1] || '';
const dirsAt = src.indexOf('const CHAT_DIRS');
const dirsSrc = dirsAt >= 0 ? src.slice(dirsAt, src.indexOf('};', dirsAt)) : '';
function fallback(key) {
  const m = dirsSrc.match(new RegExp(key + ':[^\\n]*\\|\\|\\s*\'([^\']+)\''));
  return m ? m[1].replace(/\\\\/g, '\\') : '';
}
yes('the live default is the live voice service\'s chat folder', !!liveRoot && fallback('main') === liveRoot + '\\chat');
yes('the dev default is the dev voice service\'s chat folder', !!devRoot && fallback('dev') === devRoot + '\\chat');
yes('Get-Logs reads dev voice from the same folder', !!devRoot && getLogs.indexOf("if ($Dev) { '" + devRoot + "' }") >= 0);
yes('the voice service writes chat into its own folder unless told otherwise',
    /const CHAT_DIR = process\.env\.THORNSWOOD_CHAT_DIR \|\| path\.join\(HERE, 'chat'\)/.test(readTool(path.join('voice', 'voice-server.js'))));
yes('and neither install script tells it otherwise',
    readTool('scripts/deploy/Install-Voice.ps1').indexOf('THORNSWOOD_CHAT_DIR') < 0 && vpsDev.indexOf('THORNSWOOD_CHAT_DIR') < 0);

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) { }
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
