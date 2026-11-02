// test-first-run-words.js
//
// The launcher tells a new person to give their character a Skyrim name, and
// never tells them to save before connecting.
//
// From the To Do List, entry 163: "The Play page tells a new person to name the
// character after themselves, and to save before connecting." The first-run
// card on the Play page said "Create a character and name it after yourself"
// and "Save once before connecting. Joining from an unsaved game drops you back
// to the menu." Both were the old multiplayer mod's advice, carried over. The name is
// what everybody sees above your head, so somebody who followed the card walked
// into Whiterun under their own name. And there is no saving here: the site's
// hints say "There is no saving. The server holds your character, so quitting
// is safe." (site\data\site\lines.md, the one copy of the hints, #3147; Help's
// list of what is normal here, which said it too, was removed on 26 Oct).
//
// The same name advice was in the Help page's first Joining item, two pages
// away, and its third item still explained saving by what the old
// multiplayer mod used to refuse. Fixing the card alone would have left the launcher telling
// two different stories, so this reads both and checks they agree. The
// launcher's Help page went with #3146 (help before the game is the site's,
// in the game it is F7), so the other half is the site's help now.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in site\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
function read(rel) {
  return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
}
const xaml = read('launcher/app/MainWindow.axaml');
const site = read(path.join('site', 'data', 'help.md'));
const lines = read(path.join('site', 'data', 'site', 'lines.md'));
const shell = read(path.join('launcher', 'app', 'Shell.cs'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The words every place has to share. Written once here, so the card and the
// help page are checked against the same rule rather than against each other.
const RULE_SKYRIM = 'a name that belongs in Skyrim';
const RULE_SHAPE = 'a first name and a family name or a byname';
const RULE_NOT_OWN = 'not your own';

// ---------------------------------------------------------------- the card
// Shell.cs finds the card by its name and hides it once the person has played,
// so the StackPanel has to survive whatever happens to the words inside it.
// Found by its name alone: the tag has since gained a Margin, and whatever
// else it gains is not what this is about.
const a = xaml.search(/<StackPanel x:Name="FirstRunCard"[\s>]/);
const b = a < 0 ? -1 : xaml.indexOf('</Border>', a);
const card = (a >= 0 && b > a) ? xaml.slice(a, b) : '';
yes('the window still has the FirstRunCard StackPanel', card !== '');
yes('Shell.cs still finds the card by that name',
    shell.indexOf('firstRunCard = win.FirstRunCard;') >= 0);

// Only what a person reads: the Text attributes, not the markup or comments.
const cardWords = [];
card.replace(/\bText="([^"]*)"/g, function (m, t) { cardWords.push(t); return m; });
const cardText = cardWords.join(' ');
yes('the card has words in it', cardWords.length >= 2);

yes('the card no longer says to name the character after yourself',
    !/after yourself/i.test(cardText));
yes('the card no longer says to save before connecting',
    !/\bsav(e|ed|ing)\b/i.test(cardText) && !/unsaved/i.test(cardText));
yes('the card gives the rule: ' + RULE_SKYRIM, cardText.indexOf(RULE_SKYRIM) >= 0);
yes('the card gives the rule: ' + RULE_SHAPE, cardText.indexOf(RULE_SHAPE) >= 0);
yes('the card gives the rule: ' + RULE_NOT_OWN, cardText.indexOf(RULE_NOT_OWN) >= 0);
yes('the card still says the name cannot be changed later',
    /cannot be changed later/.test(cardText));
yes('the separator that stood between the two lines went with the save line',
    card.indexOf('<Rectangle') < 0);

// ------------------------------------------------------- the site's help
// Its Your first character section, where a new character is made, gives
// the rule in the card's words.
function mdSection(title) {
  const at = site.indexOf('\n## ' + title + '\n');
  if (at < 0) { return ''; }
  const end = site.indexOf('\n## ', at + 5);
  return site.slice(at, end < 0 ? undefined : end);
}
// Read as one line: the page wraps where it likes.
const first = mdSection('Your first character').replace(/\s+/g, ' ');
yes('the site\'s help has its Your first character section', first !== '');
yes('it gives the same rule as the card: ' + RULE_SKYRIM, first.indexOf(RULE_SKYRIM) >= 0);
yes('it gives the same rule as the card: ' + RULE_SHAPE, first.indexOf(RULE_SHAPE) >= 0);
yes('it gives the same rule as the card: ' + RULE_NOT_OWN, first.indexOf(RULE_NOT_OWN) >= 0);
yes('nothing in the site\'s help says to name the character after yourself', !/after yourself/i.test(site));
// Help lost its on-purpose list in #3544; the hints say it now.
yes('the site\'s hints still say there is no saving',
    /There is no saving\. The server holds your character\b/.test(lines));
yes('the section explains nothing by the old multiplayer mod',
    !/Skyrim\s*Together|\bTogether\b/.test(first));

// ------------------------------------------------------------- the words
// People read all of this. No em dash, and nobody is a player.
const shown = [cardText, first].join(' ');
yes('no em dash in the card or the section', shown.indexOf(String.fromCharCode(0x2014)) < 0);
yes('nobody is called a player in the card or the section', !/\bplayers?\b/i.test(shown));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
