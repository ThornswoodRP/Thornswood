// test-3656-lore-dates.js
//
//     node .\site\tests\test-3656-lore-dates.js
//
// The World page is written in 4E 252, and the year counts on it are worked
// out from the dates beside them (#3656). It said Eirik had held the crown
// twenty-two years though Ulfric died in 4E 229, and that a playable Legion
// veteran served forty years ago though the Legion left Skyrim in the thaw
// after 4E 202. Patrick, 27 Oct, on the report page: Eirik has held it
// twenty-three years, and the veteran served in the war about fifty years
// ago and stayed when the Legion left.
//
// What it checks, every count taken from the page's own dates with the
// year it is written in as now:
//   1. Ulfric's reign (crowned 4E 203, died 4E 229) is the twenty-six years
//      the World page, the home page and the Discord #lore post give;
//   2. Eirik's years (now less Ulfric's death) are what the World page and
//      the #lore post give;
//   3. the Thalmor's years outlawed (now less the Expulsion) are what the
//      World page and its lines page give;
//   4. the Legion veteran: the World page and embassy.md word the service
//      the same way, and the count in it is the years since the Legion
//      left, to the nearest ten; lore/factions.md gives the same count for
//      how long no Legion soldier has been in Skyrim under arms.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const REPO_DIR = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join(''); }
function flat(s) { return s.replace(/<[^>]*>/g, ' ').replace(/[*_`]/g, '').replace(/\s+/g, ' '); }
function year(text, re) { const m = re.exec(text); return m ? Number(m[1]) : NaN; }

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function words(n) {
  if (n < 20) { return WORDS[n]; }
  const t = TENS[Math.floor(n / 10)], u = n % 10;
  return u ? t + '-' + WORDS[u] : t;
}

const world = flat(read('site/data/site/world.md'));
const lines = flat(read('site/data/site/lines.md'));
const home = flat(read('site/public/home.html'));
const lore = flat(read('bot/content.py'));
const embassy = flat(read('docs/systems/embassy.md'));
const factions = flat(read('lore/factions.md'));

const now = year(world, /set down at Windhelm in the year 4E (\d+)/);
const crowned = year(world, /Ulfric Stormcloak was crowned High King by the Moot at Windhelm in 4E (\d+)/);
const died = year(world, /Ulfric died in his bed in 4E (\d+)/);
const expelled = year(world, /In 4E (\d+) the High King ordered them out/);
const signed = year(world, /By the close of 4E (\d+) the Legion held the road/);
yes('the World page gives the year it is written in (4E ' + now + '), Ulfric\'s crowning (' + crowned + '), his death (' + died +
  '), the Expulsion (' + expelled + ') and the war\'s end (' + signed + ')',
  [now, crowned, died, expelled, signed].every(function (n) { return n > 0; }));

// 1. Ulfric
const reign = words(died - crowned);
yes('the World page gives Ulfric ' + reign + ' years', world.indexOf('He would hold the crown for ' + reign + ' years.') >= 0);
yes('the home page gives Ulfric ' + reign + ' years', home.indexOf(reign + ' years and died in his bed') >= 0);
yes('the #lore post gives Ulfric ' + reign + ' years', lore.indexOf('He wore it ' + reign + ' years') >= 0);

// 2. Eirik
const eirik = words(now - died);
yes('the World page gives Eirik ' + eirik + ' years', world.indexOf('He has held the crown for ' + eirik + ' years.') >= 0);
yes('the #lore post gives Eirik ' + eirik + ' years', lore.indexOf("who's had it " + eirik + ' years') >= 0);

// 3. the Thalmor
const outlawed = words(now - expelled);
yes('the World page gives the Thalmor ' + outlawed + ' years outlawed', world.indexOf('illegal in Skyrim for ' + outlawed + ' years') >= 0);
yes('and so does its lines page', lines.indexOf('illegal in Skyrim for ' + outlawed + ' years') >= 0);

// 4. the Legion veteran: the Legion left in the first thaw after the war's end
const gone = words(Math.round((now - (signed + 1)) / 10) * 10);
const service = 'served in the war about ' + gone + ' years ago';
yes('the World page says a Legion veteran ' + service + ' and settled when the Legion left',
  world.indexOf('Somebody who ' + service + ' and settled here when the Legion left') >= 0);
yes('docs/systems/embassy.md words it the same way',
  embassy.indexOf('A Legion veteran who ' + service + ' and settled in a hold when the Legion left') >= 0);
yes('lore/factions.md says no Legion soldier has been in Skyrim under arms in ' + gone + ' years',
  factions.indexOf('none has in ' + gone + ' years') >= 0);
const stale = [];
[['site/data/site/world.md', world], ['docs/systems/embassy.md', embassy]].forEach(function (pair) {
  if (/served (forty|thirty|decades) (years )?ago/.test(pair[1])) { stale.push(pair[0]); }
});
yes('neither says the veteran served forty years or decades ago' + (stale.length ? ' (' + stale.join(', ') + ')' : ''), stale.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
