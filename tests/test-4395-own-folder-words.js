'use strict';
/*
  test-4395-own-folder-words.js

      node tests\test-4395-own-folder-words.js

  #4395. The Downloads, join and help pages said Thornswood leaves the Skyrim
  you already have alone and builds a game folder of its own, at a fixed
  C:\Thornswood\Game. What the setup window does is different. Its box "Give
  Thornswood a Skyrim folder of its own" starts unticked
  (launcher\app\InstallWindow.cs, Box). Ticked, nothing is written into the
  Steam copy and the launcher builds the folder by itself once Vortex has
  deployed. Left unticked, Thornswood's own files go into the Steam copy and
  the launcher asks before it builds the folder, and Play asks for it too.
  The folder is Game in the install folder, which the setup window puts on
  Skyrim's own drive, not on C: (launcher\app\InstallPlace.cs).
  installer\README.md said both things at once.

  This reads the setup window for the box's words and its default, then
  holds the three pages and the installer's read me to them. Each must:

    1. name the box in the setup window's own words;
    2. say it starts unticked;
    3. say what ticking it does: nothing is written into the Steam copy;
    4. say what leaving it does: Thornswood's own files go into the Steam copy;
    5. say the launcher builds the folder, and never that the installer does;
    6. name no fixed C:\Thornswood\Game;
    7. never say your own Skyrim is left alone without saying it is with
       the box ticked.

  Read only. Nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// A file that is not there fails by name rather than reading as empty text,
// so a moved page is a FAIL line here, not a quiet pass on nothing.
const read = (...p) => {
  const f = path.join(ROOT, ...p);
  const there = fs.existsSync(f);
  yes('reads ' + path.join(...p), there);
  return there ? fs.readFileSync(f, 'utf8').split('\r\n').join('\n') : '';
};

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* ---- what the setup window does ------------------------------------------ */
const win = read('launcher', 'app', 'InstallWindow.cs');
const box = /chkOwn = Box\("([^"]+)"/.exec(win);
const LABEL = box ? box[1] : '';
yes('the setup window has the own folder box ("' + LABEL + '")', LABEL.length > 0);
const boxFn = /CheckBox Box\(string words, Thickness margin\)[\s\S]*?\n        \}/.exec(win);
yes('and it starts unticked: Box sets IsChecked = false, and nothing sets chkOwn ticked',
  !!boxFn && /IsChecked = false/.test(boxFn[0]) && !/chkOwn\.IsChecked = true/.test(win));

/* ---- the texts ------------------------------------------------------------- */
// The Downloads page is written by site\lib\downloads.js out of joined string
// pieces, so the pieces are put back together before it is read.
function fromJs(js) {
  return js.replace(/'\s*\+\s*(?:\/\/[^\n]*\n\s*)*'/g, '').replace(/&rsquo;/g, '\'');
}
const flat = (s) => String(s).replace(/`/g, '').replace(/\*\*/g, '').replace(/\s+/g, ' ');
const TEXTS = [
  ['the help page (site\\data\\help.md)', flat(read('site', 'data', 'help.md'))],
  ['the join page (site\\data\\site\\join.md)', flat(read('site', 'data', 'site', 'join.md'))],
  ['the Downloads page (site\\lib\\downloads.js)', flat(fromJs(read('site', 'lib', 'downloads.js')))],
  ['the installer\'s read me (installer\\README.md)', flat(read('installer', 'README.md'))]
];
for (const [name, t] of TEXTS) {
  console.log('\n' + name);
  yes('1 names the box: "' + LABEL + '"', LABEL.length > 0 && t.indexOf(LABEL) >= 0);
  yes('2 says it starts unticked', /starts unticked|unticked, which is the default|unticked by default/i.test(t));
  yes('3 says ticked, Thornswood writes nothing of its own into the Steam copy',
    /(?:writes nothing of its own|nothing is written) into (?:your Steam copy|the Steam copy|the Skyrim you already have on Steam)/i.test(t));
  yes('4 says left unticked, Thornswood\'s own files go into the Steam copy',
    /unticked[^.]*?(?:files|they) go into (?:your|the) Steam copy/i.test(t));
  yes('5 says the launcher builds the folder', /the launcher (?:builds|makes) (?:it|the folder|a game folder|Thornswood)/i.test(t));
  yes('  and never that the installer or the setup does',
    !/(?:installer|setup|install)\s+(?:builds|makes)\s+(?:a|the|its|Thornswood)/i.test(t));
  yes('6 names no fixed C:\\Thornswood\\Game', t.indexOf('C:\\Thornswood\\Game') < 0);
  const alone = t.split(/(?<=[.!?])\s+/).filter((s) => ((/\balone\b/.test(s) && /Skyrim/.test(s)) || /runs from its own game folder/i.test(s)) && !/\bticked\b/.test(s));
  yes('7 says your Skyrim is left alone, or that Thornswood runs from its own folder, only with the box ticked' + (alone.length ? ' (not: "' + alone[0].slice(0, 120) + '")' : ''),
    alone.length === 0);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
