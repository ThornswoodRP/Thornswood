// test-sweep.js
//
// The small things, checked so they stay done.
//
// From the To Do List: "Ten small things worth sweeping while you are already
// in these files. None of these will hurt anybody on their own. Together they
// are the difference between code that reads as finished and code that reads
// as still being worked on."
//
// Most of them are absences: a reply that was not sent, a frame that was not
// answered, a loop with no way out. An absence leaves nothing behind to notice
// later, which is exactly why they are worth a harness rather than a commit.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/*
  CARRIAGE RETURNS OUT FIRST, and this file learned that the hard way.

  Every other harness in this folder starts by stripping them and none of them
  says why. This one did not, and the check below that matches across a line
  break passed on a working copy with Unix endings and failed on the GitHub
  runner, which checks out CRLF: `\n` does not match `\r\n`, so it counted
  zero of fourteen and called a deliberate pattern a slip.

  It is the right failure in the wrong place. Read the file the same way
  everywhere rather than writing every regex twice.
*/
const CR = String.fromCharCode(13);
function read(...bits) {
  return fs.readFileSync(path.join(REPO_DIR, ...bits), 'utf8').split(CR).join('');
}

const gm = read('game', 'gamemode.js');
const chat = read('game', 'ui', 'thornswood-chat.js');
const voice = read('game', 'ui', 'thornswood-voice.js');
const svc = read('voice', 'voice-server.js');

/* Comments in this repo quote old code on purpose, so a check that reads them
   as code is a check that punishes writing them. */
function codeOf(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

// ---------------------------------------------- the wrapper that was always true
{
  const c = codeOf(chat);
  yes('the chat handler no longer tests a thing it has just tested',
      (c.match(/msg\.t === 'chat'/g) || []).length <= 1);
  yes('and the not-chat case still hands everything else on',
      /msg\.t !== 'chat'.*fanout\(msg\)/.test(c));
}

// -------------------------------------------------------- a close is answered
{
  const c = codeOf(svc);
  yes('a close frame is answered with a close frame, not a dropped socket',
      /0x88, 2, 0x03, 0xe8/.test(c));

  /*
    Built here rather than trusted, because a close frame with the wrong
    length byte is a frame the other end cannot read and this is four bytes of
    magic numbers in a file nobody looks at twice.
  */
  const m = /Buffer\.from\(\[(0x88), (\d+), (0x03), (0xe8)\]\)/.exec(c);
  yes('it is a FIN close with a two byte body', !!m && m[2] === '2');
  if (m) {
    const code = (parseInt(m[3], 16) << 8) | parseInt(m[4], 16);
    yes('and the body is 1000, a normal closure', code === 1000);
  }
  yes('the socket is still torn down afterwards',
      // The frame is written inline since #2817 took out the bye variable
      // and the catch around it; what matters is that close follows it.
      /this\.socket\.write\(Buffer\.from\(\[0x88, 2, 0x03, 0xe8\]\)\);[\s\S]{0,80}this\.close\('close_frame'\);/.test(c));
}

// ----------------------------------------------------- an oversized body answers
{
  const c = codeOf(svc);
  const drops = (c.match(/req\.destroy\(\)/g) || []).length;
  const says = (c.match(/writeHead\(413/g) || []).length;
  yes('every place that drops an oversized body says 413 first',
      drops > 0 && says >= drops);
  yes('and it only answers once, however much more arrives',
      (c.match(/if \(tooBig\) \{ return; \}/g) || []).length === says);
}

// --------------------------------------- health can tell a restart from a hang
{
  const c = codeOf(svc);
  yes('the health payload carries an uptime', /uptimeSeconds: Math\.round\(process\.uptime\(\)\)/.test(c));
  yes('and when it started, so a watchdog has two ways to tell',
      /startedAt:/.test(c));
}

// ------------------------------------------------------ no loop without an end
{
  const c = codeOf(voice);
  yes('waiting for the chat socket gives up eventually',
      /Date\.now\(\) - waitedFrom > 120000/.test(c));
  yes('and says so rather than going quiet',
      /the chat page never loaded/.test(voice));
}

// ---------------------------------------- the drop box is not the working directory
{
  const c = codeOf(gm);
  yes('the restart drop box is resolved against the data folder',
      /rpath\.join\(String\(rcfg\.dataDir\), 'restart\.json'\)/.test(c));
  yes('and still falls back to what has always worked',
      /return 'data\/restart\.json';/.test(c));
}

/*
  ---------------------------------------------------------------- AND ONE THAT
  IS NOT A DEFECT, written down rather than done.

  The list asks to "pick one of notify() or say() rather than sending both".
  Read across the file, that pairing is not an oversight in one place: it is
  the pattern everywhere something has to be seen. notify is Skyrim's own
  corner message and needs no browser; say is the chat, which can be scrolled
  back to and survives the corner message fading. A message that matters goes
  to both on purpose, and changing one of them would make that one the odd one
  out.

  So this check pins the pattern instead. If somebody later decides one channel
  is enough, this is what will tell them how many places agree with them.
*/
{
  const pairs = (gm.match(/notify\(actorId, [^\n]*\);\n\s*say\(actorId, /g) || []).length;
  yes('the notify and say pairing is a pattern rather than a slip (' + pairs + ' places)',
      pairs >= 3);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
