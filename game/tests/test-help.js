// test-help.js
//
// /help points at the help panel, and nothing advertises a command it will
// then refuse.
//
// From the To Do List: "/help is a developer's command list, and the
// unknown-command reply advertises a command everybody is then refused...
// /help opens a short menu: controls, how to talk, the rules, how to reach
// staff, what to do first. Filter it by permission, which /help two lines
// above already does correctly and the fallback simply forgot to."
//
// Since #1633 (Patrick, 4 October: no chat commands for anything people do)
// the menu and its six topics are the help panel, game/ui/thornswood-help.js,
// on its own key and on Help on the K, P and J panels; test-1633-help-panel.js
// holds the panel. What is left here is the half worth a harness from the
// start: /help, /commands and a word nobody has are answered with one line,
// helpLine, that says where the panel is and names the commands people still
// type, and a tester's own commands to a tester alone. A reply that names /tp
// to somebody who will be refused /tp is worse than saying nothing: it is the
// first thing a new person learns about this server and it is a no.
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

const a = src.indexOf("    if (word === '/help' || word === '/commands') {");
const b = a < 0 ? -1 : src.indexOf('\n    // Anything else beginning with a slash', a);
const help = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
yes('/help is in the gamemode', help !== null);

const la = src.indexOf('  function helpLine(profileId) {');
const lb = la < 0 ? -1 : src.indexOf('\n  }\n', la);
const helpLine = (la >= 0 && lb >= 0) ? src.slice(la, lb + 4) : null;
yes('and so is helpLine, the one line it answers with', helpLine !== null);

const pw = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
let PLAYER_WORDS = [];
try { PLAYER_WORDS = pw ? new Function('return ' + pw[1])() : []; } catch (e) { PLAYER_WORDS = []; }
yes('PLAYER_WORDS is read, ' + PLAYER_WORDS.length + ' words', PLAYER_WORDS.length > 0);

/*
  Run it, for a playtester and for everybody else.

  Everything it needs is passed in: whether this profile is a playtester, what
  they are called, the list, and somewhere for the answer to land.
*/
function run(body, word, parts, playtester) {
  if (!body || !helpLine) { return []; }
  const said = [];
  const fn = new Function(
    'word', 'parts', 'toProfile', 'isPlaytester', 'roleOf', 'profileId', 'PLAYER_WORDS', 'String',
    helpLine + '\n' + body.replace(/\n\s*$/, '') + '\n');
  fn(word, parts,
     function (pid, line) { said.push(String(line)); },
     function () { return !!playtester; },
     function () { return 'a playtester'; },
     11, PLAYER_WORDS, String);
  return said;
}
function ask(line, playtester) {
  const parts = line.split(' ');
  return run(help, parts[0], parts, playtester);
}

if (help && helpLine) {
  // ------------------------------------------------------------ the line
  {
    const top = ask('/help', false);
    yes('/help answers once', top.length === 1);
    const line = top[0] || '';
    yes('and says the help is a panel, on F7 or Help on the K, P or J panel',
        /^Help is a panel: F7 opens it, unless you moved it on Settings in the game, and so does Help on the K, P or J panel\./.test(line));
    yes('it names the commands people still type, every one of them',
        PLAYER_WORDS.every(function (w) { return line.indexOf(w) !== -1; }));
    const named = (line.match(/\/[a-z]+/g) || []).filter(function (w, i, all) { return all.indexOf(w) === i; });
    yes('and no other', named.every(function (w) { return PLAYER_WORDS.indexOf(w) !== -1; }));
    yes('it tells nobody to type /help', line.indexOf('/help ') === -1 && !/\/help\b(?!me)/.test(line));
    yes('/commands answers the same', ask('/commands', false)[0] === line);
    // There are no topics to ask for any more: they are the panel's.
    yes('and a topic after it is the same line, not a topic', ask('/help land', false)[0] === line &&
        ask('/help fish', false)[0] === line);
    yes('the old topics are gone from the gamemode', !/topic === 'talking'/.test(src) && !/Ask for one of these/.test(src));
  }

  // ------------------------------------------- filtered the same way twice
  {
    const plain = ask('/help', false)[0] || '';
    const staff = ask('/help', true)[0] || '';
    yes('an ordinary person is not told about /tp, /give, /spawn or /where',
        !/\/(tp|give|spawn|where)\b/.test(plain));
    yes('a playtester is', /\/tp <place>/.test(staff) && /\/give and \/spawn/.test(staff) && /\/where says where you stand/.test(staff));
    yes('and is told what they are', /a playtester/.test(staff));
  }
}

// --------------------------------------- the reply to a command that is not
{
  const c = src.indexOf("    toProfile(profileId, 'No command called ' + word");
  const fallback = c >= 0 ? src.slice(c, src.indexOf('\n', c) + 1) : '';
  yes('there is a reply for a command nobody has', !!fallback);
  const said = run(fallback, '/fish', ['/fish'], false);
  const tester = run(fallback, '/fish', ['/fish'], true);
  yes('it says there is no such word, then the same line /help gives',
      said.length === 1 && said[0] === 'No command called /fish. ' + (ask('/help', false)[0] || '-'));
  /*
    THE DEFECT ITSELF. This line named /tp to everybody and then refused
    everybody who was not a playtester, which is the To Do entry's own
    complaint and the first thing a new person learned about this server.
  */
  yes('it only names the playtester commands to a playtester',
      !/\/tp\b/.test(said[0] || '') && /\/tp <place>/.test(tester[0] || ''));
  yes('and it points at the help panel rather than at /help',
      /Help is a panel/.test(said[0] || '') && !/Try \/help/.test(src));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
