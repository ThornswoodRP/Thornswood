// test-creation-docs.js
//
// The public pages say where a new character's choices are made, and they say
// what the game actually does.
//
// From the To Do List, entry 162: "Nothing in the creation hall is a choice,
// and it is where your face is made but not anything else", and the end state
// it names is that the published line on Known Issues "is no longer true".
//
// WHAT WAS MEASURED, 24 September. The launcher chooses nothing any more:
// 3aa37ef on 20 September ("Pick your character at the game's main menu, not
// in the launcher") took Creation.cs out, and c87da23 the same afternoon moved
// class, profession and home onto the K panel in the hall. beginChoosing in
// gamemode.js opens that panel by itself once the face is made, the character
// block ends creation the moment a home is picked, and the panel offers
// "Choose later" for class and profession and never for the home. But the two
// pages anybody can read without signing in, /known and /help (the known board
// and help.md), still said the opposite:
//
//   known.md  "Your profession, half, class and town are chosen in the
//              launcher before Play, and the hall holds nothing to pick up
//              or read"
//   known.md  "Everything else about a new character is decided in the
//              launcher"
//   help.md   "the launcher is the only place they are made", and "with the
//              tools of your trade in your pack", when a2ba2ee on 21
//              September hands a tool to three picks and nothing to the rest.
//
// So this reads what the code does and then reads what the pages say, and
// fails when they disagree. Each claim about the game is checked against the
// file that makes it true, not against a sentence copied into this harness,
// so a page that goes stale again fails here rather than in front of a tester.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(rel) {
  return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const gm = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const skills = read(path.join('game', 'ui', 'thornswood-skills.js'));
// Known Issues is the page /known writes, from the bot's list since #3140 (#2414).
const known = require('./fixtures/known-page').knownPage() || '';
const help = read(path.join('site', 'data', 'help.md'));

/** From a start marker to the first end marker after it, or null. */
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

// ------------------------------------------------------ what the game does

// The launcher has no creation step. Creation.cs was the dialog; nothing in
// launcher/app declares a class of that name now.
const appDir = path.join(REPO_DIR, 'launcher', 'app');
const csFiles = fs.readdirSync(appDir).filter(function (f) { return /\.cs$/i.test(f); });
const launcherCreates = csFiles.some(function (f) {
  return /\bclass\s+Creation\b/.test(fs.readFileSync(path.join(appDir, f), 'utf8'));
});
yes('the launcher has no creation dialog to choose anything in',
    csFiles.length > 0 && !fs.existsSync(path.join(appDir, 'Creation.cs')) && !launcherCreates);

// Once the face is made the hall dresses them and opens the panel itself.
const choosing = slice(gm, 'function beginChoosing(', '\n}\n');
yes('beginChoosing is in the gamemode', choosing !== null);
yes('and it opens the panel without a key press',
    choosing !== null && /openCreation\(actorId\)/.test(choosing));
yes('and it dresses them before the panel opens',
    choosing !== null && /giveShift\(actorId\)/.test(choosing));

// The home is the pick that ends creation, whatever else is still unset.
const ends = slice(gm, 'if (creating && st.home) {', '\n      }\n');
yes('picking a home is what sends a new character to their town',
    ends !== null && /chargen\.arrive\(actorId, st\.home\)/.test(ends));

// The panel offers "later" for class and profession, never for the home.
// Run the panel's own rule rather than reading its comment.
const laterSrc = slice(skills, 'function laterOffered(sec) {', '\n  }\n');
yes('the panel has a rule for what can be left for later', laterSrc !== null);
let later = null;
if (laterSrc) {
  later = function (sec, isNew, hasClass, hasProf) {
    const fn = new Function('creating', 'haveClass', 'haveProf',
                            laterSrc + '\nreturn laterOffered;');
    return fn(function () { return isNew; },
              function () { return hasClass; },
              function () { return hasProf; })(sec);
  };
}
const classCanWait = !!later && later('class', true, false, false) === true;
const profCanWait = !!later && later('profession', true, false, false) === true;
const homeMustBe = !!later && later('home', true, false, false) === false;
yes('in the hall a class can be left for later', classCanWait);
yes('in the hall a profession can be left for later', profCanWait);
yes('and a home cannot', homeMustBe);

// Which picks are handed a tool, read out of TOOLS itself.
const toolsSrc = slice(gm, 'const TOOLS = {', '\n};\n');
let TOOLS = null;
try { TOOLS = toolsSrc ? new Function('return ' + toolsSrc.slice('const TOOLS = '.length).replace(/;\n$/, ''))() : null; }
catch (e) { TOOLS = null; }
const toolKeys = TOOLS ? Object.keys(TOOLS) : [];
yes('the gamemode says which picks come with a tool', toolKeys.length > 0);
yes('and hands the tool over at the pick, for a class or a profession',
    /var handed = giveTool\(actorId, whose\);/.test(gm));

// --------------------------------------------------------- what the pages say

/*
  Every sentence and every table cell on a page, one per entry. Paragraphs are
  joined first so a sentence that wraps is still one sentence.
*/
function sentences(md) {
  return md.split(/\n\s*\n/)
    .map(function (p) { return p.replace(/\n/g, ' '); })
    .join('\n')
    .split(/[.!?](?:\s|$)|\||\n/)
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

/*
  A sentence that puts a character choice in the launcher. All three have to
  be there: the launcher, something about a new character, and a word saying
  it is chosen. "The launcher points it at a character that does not exist"
  is about Start On Save and is not one.
*/
function launcherChooses(s) {
  return /\blauncher\b/i.test(s) &&
         /\b(profession|class|town|trade|half|new character)\b/i.test(s) &&
         /\b(chosen|choose|chooses|decided|decides|asks|made|comes? from|picks?|picked)\b/i.test(s);
}

[['the Known Issues page', known], ['help.md', help]].forEach(function (page) {
  const wrong = sentences(page[1]).filter(launcherChooses);
  yes(page[0] + ' does not say anything about a new character is chosen in the launcher' +
      (wrong.length ? ': "' + wrong[0] + '"' : ''), wrong.length === 0);
});

// The public site pages are not this entry's to rewrite, but they say the
// same thing and must go on agreeing with the game. They do today.
const siteDir = path.join(REPO_DIR, 'site', 'data', 'site');
fs.readdirSync(siteDir).filter(function (f) { return /\.md$/.test(f); }).forEach(function (f) {
  const wrong = sentences(read(path.join('site', 'data', 'site', f))).filter(launcherChooses);
  if (wrong.length) { yes('site/' + f + ' puts a choice in the launcher: "' + wrong[0] + '"', false); }
});

// The bare hall is how it works, not a bug, so since #3137 it is not on Known
// Issues, which lists only what is broken. Help's Things that are normal here
// went on 26 Oct (Patrick), so the hall is said once, in Your first character.
const rows = known.split('\n').filter(function (l) { return /^\|/.test(l); });
yes('Known Issues no longer lists the creation hall',
    !rows.some(function (l) { return /\bhall\b/i.test(l); }));
yes('Help has no Things that are normal here section to repeat it in',
    !/## Things that are normal here/.test(help));
yes('nothing says nothing in the hall is a choice',
    !/nothing in the creation hall is a choice/i.test(help + known));
yes('Help says only the town has to be chosen to leave, and the class and profession can wait',
    homeMustBe && classCanWait && profCanWait &&
    /Only the town has to be chosen before you leave the hall\. Your class and\s+profession can wait/.test(help));

// Help: the first character, in the order it happens.
const first = slice(help, '## Your first character', '\n## ');
yes('Help still has a section on the first character', first !== null);
const f1 = first || '';
yes('it says the panel on K opens by itself once the face is made',
    choosing !== null && /\brace menu\b/i.test(f1) && /\bpanel\b/i.test(f1) &&
    /\bK\b/.test(f1) && /\b(by itself|on its own)\b/i.test(f1));
yes('it says only the town has to be chosen before leaving the hall',
    homeMustBe && /\btown\b/i.test(f1) && /\b(can wait|later)\b/i.test(f1));
yes('it no longer promises the tools of every trade',
    first !== null && !/tools of your trade/i.test(f1));
toolKeys.forEach(function (key) {
  const who = key.charAt(0).toUpperCase() + key.slice(1);
  const what = TOOLS[key].name;
  yes('it says a ' + who + ' is handed a ' + what,
      f1.indexOf(who) >= 0 && f1.indexOf(what) >= 0);
});

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
