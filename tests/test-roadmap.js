// test-roadmap.js
//
// What the emote wheel's notes say about it is read off the files that decide
// it. This began as a check on the roadmap's wheel row; since #3140 the
// roadmap is built from the issue board, so that row is the "Roadmap:"
// comment on the wheel's issue and is no longer a file here. The ini and the
// plugin it was held to still are.
//
// WHY THIS EXISTS. The roadmap's Later section said "Emote wheel | Wanted
// since the start, never started", while game/plugins/thornswood-emotes.js,
// 593 lines, went out in every release and testers were asked to use it. From
// the To Do List: "Verified: it exists and works. Move it to Done. Also check
// the rest of Later the same way, because a roadmap that lists a shipped
// feature as not started is a roadmap nobody will trust on the items that
// really are unstarted".
//
// The one note that did record the wheel as done, in data/todo.md (gone with
// the hub's boards in #4359), was wrong
// twice over: "B opens it" and "twenty four emotes". B is the plugin's fallback
// for when the ini has no WheelKey line at all (thornswood-emotes.js,
// key('WheelKey', 48)); the ini that ships says 34, which is G. Twenty four was
// the count when the wheel was two rings of twelve, and again when it was
// six categories and thirty four emotes. Both numbers had been copied out of
// a note rather than out of the code, which is how a wrong one gets onto a
// page. The wheel is one list now, with eight quick slots.
//
// So nothing below takes a key or a count on trust. The letter comes out of
// launcher/Thornswood.ini, decoded with that file's own A to Z table, and
// the count comes out of the plugin's EMOTES array. A key that moves or a
// wheel that grows fails here until the words say so too.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);

function read(rel) {
  let t = fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
  if (t.charCodeAt(0) === 0xFEFF) { t = t.slice(1); }
  return t;
}

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the roadmap --
/* Since #3140 the roadmap is built from the issue board: the wheel's row is
   the "Roadmap:" comment on its issue, and an issue that is closed as done is
   under Done by itself, so the row this harness held to the ini and the
   plugin is no longer a file here. What it was checked against still is.
   The note in data/todo.md the wrong numbers came from went with the hub's
   boards in #4359. */

// -------------------------------------------------------------- the keys ----
const ini = read('launcher/Thornswood.ini');
function iniKey(name) {
  const m = ini.match(new RegExp('^\\s*' + name + '\\s*=\\s*(\\d+)', 'm'));
  return m ? parseInt(m[1], 10) : NaN;
}
/* The ini's own comment is the scan code table, so the decoding here cannot
   drift from what the file tells somebody editing it by hand. */
const notes = ini.split('\n').filter(function (l) { return /^\s*;/.test(l); })
  .map(function (l) { return l.replace(/^\s*;\s?/, ''); }).join(' ');
const az = notes.match(/A-Z are ([\d,\s]+?)\s*for A\.\.Z/);
const codes = az ? az[1].split(',').map(function (x) { return parseInt(x.trim(), 10); }) : [];
yes('the ini\'s own A to Z table has 26 scan codes, found ' + codes.length, codes.length === 26);
function letter(code) {
  const at = codes.indexOf(code);
  return at < 0 ? '' : String.fromCharCode(65 + at);
}
yes('that table decodes scan code 34 as G and 48 as B, so the decoding is right',
    letter(34) === 'G' && letter(48) === 'B');
const tab = notes.match(/\bTab (\d+)/);

const WHEEL = iniKey('WheelKey'), PAGE = iniKey('PageKey'), STOP = iniKey('StopKey');
const wheelLetter = letter(WHEEL), stopLetter = letter(STOP);
yes('WheelKey (' + WHEEL + ') and StopKey (' + STOP + ') are letters: ' +
    (wheelLetter || '?') + ' and ' + (stopLetter || '?'), !!wheelLetter && !!stopLetter);
yes('PageKey (' + PAGE + ') is Tab by the ini\'s table', !!tab && parseInt(tab[1], 10) === PAGE);


/* "Settings in the game moves any of those keys" is a claim too. Until
   #3126 it was the launcher's Controls page. */
const settingsPage = read('game/ui/thornswood-settings.js');
yes('Settings in the game does list WheelKey, PageKey and StopKey',
    ['WheelKey', 'PageKey', 'StopKey'].every(function (k) {
      return settingsPage.indexOf("{ ini: '" + k + "', def: ") !== -1;
    }));

// ------------------------------------------------------------ the emotes ----
const plugin = read('game/plugins/thornswood-emotes.js');
const a = plugin.indexOf('const EMOTES = [');
const b = a < 0 ? -1 : plugin.indexOf('\n];', a);
let list = null;
try {
  if (a >= 0 && b >= 0) {
    list = new Function('return ' + plugin.slice(a + 'const EMOTES = '.length, b + 2) + ';')();
  }
} catch (e) { console.log('      EMOTES: ' + e.message); }
yes('the plugin\'s EMOTES array evaluates', Array.isArray(list) && list.length > 0);
const nEmotes = list ? list.length : 0;
const events = (a >= 0 && b >= 0) ? (plugin.slice(a, b).match(/event: '/g) || []).length : -1;
yes('and it agrees with a plain count of its event lines, ' + nEmotes + ' and ' + events,
    nEmotes > 0 && nEmotes === events);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
