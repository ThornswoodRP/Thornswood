/*
  test-chat-log.js

  What people said, written down, so a report about behaviour can be answered
  by reading it rather than by asking both of them and believing whichever is
  more convincing.

  The parts worth a test are the ones that are quietly wrong while the feature
  still looks like it works:

    APPEND ONLY, ONE LINE A MESSAGE. A log that gets rewritten is not evidence.
    An append is also the only shape that survives the process being killed
    mid-write, and the reader has to cope with the truncated last line that
    leaves rather than throwing away the other four thousand.

    THE PROFILE ID COMES OFF THE TOKEN. onJoin decides who somebody is from the
    signed token and records whether that was proven. Every line carries that
    flag, because a line from an unproven join is worth keeping and is not
    worth hanging anybody on.

    A DAY IS LOCAL TIME. Every other stamp on that box is local, and an
    evening's argument that straddles midnight UTC should not straddle two
    files.

  This lifts the real functions out of voice-server.js by text, so a rename
  fails loudly rather than testing a copy. Read only apart from its own temp
  folder.
*/
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in voice\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const os = require('os');

const SRC = path.join(REPO_DIR, 'voice', 'voice-server.js');
const src = fs.readFileSync(SRC, 'utf8');

function grab(name) {
  // By the exact name and its bracket: 'function chatPrune' also starts
  // 'function chatPruneSay', which #2191 put above it (#2278).
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('voice/voice-server.js has no function ' + name);
  const b = src.indexOf('{', at);
  let d = 0;
  for (let i = b; i < src.length; i++) {
    if (src[i] === '{') d++;
    else if (src[i] === '}') { d--; if (d === 0) return src.slice(at, i + 1); }
  }
  throw new Error('unbalanced braces reading ' + name);
}

const CHAT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-chat-'));
const CHAT_DAYS = 365;
const logged = [];
const console2 = { log: (m) => logged.push(m) };

// The name a line is logged under is peerName's (#410): the game server's
// name for a proven profile, none known here, so the page's.
const positions = new Map();
// What the prune reads since #2191: its failure book, its alert count, and a
// timer that is never really set here, so the harness does not wait an hour.
// The delay it asks for is kept: since #2166 it is one hour every time.
const CHAT_PRUNE_ALERT = 3;
const chatPruneFailures = {};
let chatOverdue = 0, chatPruneError = '', chatPruneTimer = null;
const pruneWaits = [];
const setTimeout = (fn, ms) => { pruneWaits.push(ms); return 0; };
const clearTimeout = () => {};
eval(grab('peerName') + '\n' +
     grab('chatDay').replace(/^function/, 'function') + '\n' +
     grab('chatWrite').replace('console.log', 'console2.log') + '\n' +
     grab('chatPruneSay').replace('console.log', 'console2.log') + '\n' +
     grab('chatPrune'));

let pass = 0, fail = 0;
const yes = (w, c) => {
  if (c) { pass++; console.log('PASS  ' + w); }
  else { fail++; console.log('FAIL  ' + w); }
};

const today = chatDay(Date.now());
const file = path.join(CHAT_DIR, today + '.jsonl');

// ---- one line a message, appended -----------------------------------------
const me = { profileId: 4242, name: 'Djinn', proven: true, mode: 'local' };
chatWrite('say', 7, me, 'hello the room');
chatWrite('say', 7, me, 'and another');
chatWrite('command', 7, me, '/tp riverwood');

const lines = fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim());
yes('one line a message', lines.length === 3);
yes('every line is its own json object', lines.every(l => { try { JSON.parse(l); return true; } catch (e) { return false; } }));

const first = JSON.parse(lines[0]);
yes('the first message is still the first line, so nothing was rewritten',
    first.text === 'hello the room');
yes('the profile id is recorded', first.profileId === 4242);
yes('the name is recorded', first.name === 'Djinn');
yes('whether the join was proven is recorded', first.proven === true);
yes('the voice mode is recorded', first.mode === 'local');
yes('the peer is recorded', first.peer === 7);
yes('there is a timestamp', typeof first.at === 'number' && first.at > 0);

const cmd = JSON.parse(lines[2]);
yes('a slash command is kept too, and marked as one',
    cmd.kind === 'command' && cmd.text === '/tp riverwood');
yes('an ordinary line is marked say', first.kind === 'say');

// ---- an unproven join ------------------------------------------------------
chatWrite('say', 8, { profileId: 99, name: 'nobody', proven: false, mode: '' }, 'it was not me');
const un = JSON.parse(fs.readFileSync(file, 'utf8').trim().split('\n').pop());
yes('a line from an unproven join is still written', un.text === 'it was not me');
yes('and it says it was unproven, rather than reading like the others', un.proven === false);

// ---- the reader must survive a truncated last line -------------------------
/* Exactly what an append-only log killed mid-write leaves behind. One bad
   line must not cost the other four thousand. */
fs.appendFileSync(file, '{"at":1,"text":"cut off half w');
let read = 0, skipped = 0;
for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
  if (!l.trim()) continue;
  try { JSON.parse(l); read++; } catch (e) { skipped++; }
}
yes('a truncated last line is skipped, not thrown', skipped === 1);
yes('and every whole line before it is still read', read === 4);

// ---- a day is local time ---------------------------------------------------
/* 00:30 local on the 2nd is the 2nd. Under UTC in a negative offset it would
   file as the 1st, and an evening's argument would straddle two files. */
const localEarly = new Date(2026, 8, 2, 0, 30, 0).getTime();
yes('half past midnight local files under that local day',
    chatDay(localEarly) === '2026-09-02');
const localLate = new Date(2026, 8, 2, 23, 45, 0).getTime();
yes('quarter to midnight local files under the same day',
    chatDay(localLate) === '2026-09-02');

// ---- writing must never stop the message -----------------------------------
/*
  Somebody losing chat because a disk filled would be a worse fault than a gap
  in the log, so the write is wrapped and says so instead of throwing. Proved
  by calling it with a peer object that blows up when it is read, which is the
  shape of any failure inside there.
*/
const before = logged.length;
let threw = false;
try {
  chatWrite('say', 9, { get profileId() { throw new Error('disk full, say'); } }, 'still sent');
} catch (e) { threw = true; }
yes('a write that fails does not throw at the caller', !threw);
yes('and it says so rather than failing in silence',
    logged.length > before && logged[logged.length - 1].indexOf('chat log') >= 0);

// ---- retention -------------------------------------------------------------
const old = path.join(CHAT_DIR, '2020-01-01.jsonl');
fs.writeFileSync(old, '{"at":1,"text":"ancient"}\n');
const keepDay = path.join(CHAT_DIR, chatDay(Date.now() - 3 * 86400000) + '.jsonl');
fs.writeFileSync(keepDay, '{"at":1,"text":"recent"}\n');
const notALog = path.join(CHAT_DIR, 'notes.txt');
fs.writeFileSync(notALog, 'not a log');

chatPrune();
yes('a day older than the limit goes', !fs.existsSync(old));
yes('a recent day stays', fs.existsSync(keepDay));
yes('today stays', fs.existsSync(file));
yes('a file that is not a day log is left alone', fs.existsSync(notALog));
// #2166: the privacy page says the check is hourly and chat ages the same
// way as the site's records; it used to wait six hours unless a day was overdue.
yes('the next prune is an hour away, with nothing overdue (#2166)',
    pruneWaits.length > 0 && pruneWaits.every((ms) => ms === 3600000), String(pruneWaits));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
try { fs.rmSync(CHAT_DIR, { recursive: true, force: true }); } catch (e) { }
process.exit(fail ? 1 : 0);
