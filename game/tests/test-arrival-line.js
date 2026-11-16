// test-arrival-line.js
//
// The move to the inn at the end of creation is said to the person, once.
//
// WHY. The To Do List's entry on narrating creation: the first minutes are "a
// stone room with nobody in it, a race menu, silence, an unexplained teleport".
// arriveAt is the teleport. It set the spawn point, moved the character, wrote
// "home = whiterun" to the server's own log and said nothing to anybody, so the
// person got a load screen and a room they had never seen.
//
// Only the arrival. Patrick, 21 September, on a creation line that described
// what was already on the screen: "that is chat spam and is unnescery". Which
// other steps of creation get a line is his call, so this holds the one line
// and nothing more.
//
// So this lifts the real arriveAt out of gamemode.js by text, and the real town
// table beside it, and runs it against a stand-in mp that records what was
// said. GM points it at another copy of the file, which is how it was shown to
// fail on the code before the change.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------- lifted by text
// A FAILURE AND NOT A THROW when either piece is missing, so the harness can
// still give a verdict on a file that has moved underneath it.
const FN = 'function arriveAt(actorId, townKey) {';
const a = src.indexOf(FN);
const b = a < 0 ? -1 : src.indexOf('\n}\n', a);
const fnSrc = (a >= 0 && b >= 0) ? src.slice(a, b + 2) : null;
yes('arriveAt is in the file', fnSrc !== null);

let CHARGEN = null;
{
  const m = /\nconst CHARGEN = (\{.*\});\n/.exec(src);
  try { CHARGEN = m ? JSON.parse(m[1]) : null; } catch (e) { CHARGEN = null; }
}
yes('the town table is in the file and reads as JSON',
    !!(CHARGEN && CHARGEN.towns && Object.keys(CHARGEN.towns).length > 0));

const PASSAGES = CHARGEN ? CHARGEN.towns : {};
const TOWN_BY_KEY = {};
for (const desc in PASSAGES) { TOWN_BY_KEY[PASSAGES[desc].key] = desc; }

/**
 * Run the real arriveAt once. stage is where the person's creation stands;
 * null means the server has no creation record for them at all. Hands back
 * what it answered, every line said, every log line, and the state after.
 */
function run(townKey, stage) {
  const out = { answer: null, said: [], logs: [], sets: [], state: null, threw: null };
  if (fnSrc === null) { return out; }
  const state = stage === null ? null : { stage: stage };
  const mp = { set: function (id, prop, v) { out.sets.push([id, prop, v]); } };
  const fn = new Function(
    'mp', 'chargenOf', 'setChargen', 'closeRaceMenu', 'log', 'say', 'notify',
    'TOWN_BY_KEY', 'PASSAGES',
    fnSrc + '\nreturn arriveAt;');
  const arriveAt = fn(
    mp,
    function () { return state; },
    function (id, st) { out.state = st; },
    function () { },
    function () { out.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
    function (id, text) { out.said.push({ id: id, text: text }); },
    function (id, text) { out.said.push({ id: id, text: text, notify: true }); },
    TOWN_BY_KEY, PASSAGES);
  try { out.answer = arriveAt(0xff000058, townKey); } catch (e) { out.threw = e; }
  return out;
}

// ------------------------------------------------------- the arrival
{
  const r = run('whiterun', 'choosing');
  yes('arriving runs without throwing', r.threw === null);
  yes('somebody choosing Whiterun is sent', r.answer === true);
  yes('THE ENTRY: the move is said to them, exactly once', r.said.length === 1);
  const line = r.said.length ? r.said[0] : { id: 0, text: '' };
  yes('said to the person who arrived and nobody else', line.id === 0xff000058);
  yes('through say, not notify, which may well do nothing from here',
      r.said.length === 1 && !line.notify);
  // Djinn, 17 October: "Welcome to (insert Hold name here), Safe Travels."
  yes('it is Djinn\'s line with the hold they chose: "Welcome to Whiterun Hold, Safe Travels."',
      line.text === 'Welcome to Whiterun Hold, Safe Travels.');
  yes('the log line is still written beside it',
      r.logs.some(function (l) { return /home = whiterun/.test(l); }));
  yes('and the character is still moved and marked done',
      r.sets.some(function (s) { return s[1] === 'locationalData'; }) &&
      !!(r.state && r.state.stage === 'done'));
}

// Every town in the table gets its own name, not one hard coded town.
{
  let every = Object.keys(TOWN_BY_KEY).length > 0;
  const wrong = [];
  for (const key in TOWN_BY_KEY) {
    const t = PASSAGES[TOWN_BY_KEY[key]];
    const r = run(key, 'choosing');
    const ok = typeof t.hold === 'string' && t.hold.length > 0 &&
      r.answer === true && r.said.length === 1 &&
      r.said[0].text === 'Welcome to ' + t.hold + ', Safe Travels.';
    if (!ok) { every = false; wrong.push(key); }
  }
  yes('every town in the table has a hold name, and its line names that hold' +
      (wrong.length ? ' (not: ' + wrong.join(', ') + ')' : ''), every);
}

// ------------------------------------------------------- and only then
// Nothing is said when nothing moved: those people are still in the hall with
// the panel in front of them, and a welcome would be a lie.
{
  const r = run('nowhere', 'choosing');
  yes('a town that is not in the table sends nobody', r.answer === false);
  yes('and says nothing', r.said.length === 0);
}
{
  const r = run('whiterun', 'done');
  yes('somebody already past creation is not sent again', r.answer === false);
  yes('and is not welcomed again', r.said.length === 0);
}
{
  const r = run('whiterun', 'appearance');
  yes('somebody still making their face is not sent', r.answer === false);
  yes('and is told nothing', r.said.length === 0);
}
{
  const r = run('whiterun', null);
  yes('somebody with no creation record is not sent', r.answer === false);
  yes('and is told nothing', r.said.length === 0);
}

// ------------------------------------------------------- the words
// Customers read this line, so it is held to the repo's rules for words: read
// off the real run, so a later edit to the wording is held to them too.
{
  const r = run('whiterun', 'choosing');
  const text = r.said.length ? r.said[0].text : '';
  const EM = String.fromCharCode(0x2014);
  yes('the line is there to check', text.length > 0);
  yes('it never says player', !/player/i.test(text));
  yes('it has no em dash', text.indexOf(EM) < 0);
  yes('it is short enough to read during a load, under 80 characters', text.length < 80);
  yes('it is one line, with no line break in it', !/\n/.test(text));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
