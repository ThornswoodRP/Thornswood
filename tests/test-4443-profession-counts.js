'use strict';
// #4443. The generated books own catalogue totals; prose links to them.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const systems = path.join(root, 'docs', 'systems');
const professions = path.join(systems, 'professions');
const lists = path.join(systems, 'lists');
const read = file => fs.readFileSync(file, 'utf8').replace(/\r/g, '');
const pages = fs.readdirSync(professions, { recursive: true }).filter(file => file.endsWith('.md'));
let failed = 0;
function check(ok, message) {
  if (!ok) { failed++; console.log('FAIL ' + message); }
}

// Deliberately reject duplicate catalogue totals even while they agree: a
// table change must not require a parallel edit to the prose. Counts of
// ingredients, points and ranks are rules, not catalogue totals.
const quantity = '(?:[0-9][0-9,]*|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|hundred)';
const summary = new RegExp('\\b' + quantity + '\\s+(?:(?:bench|owned|public|race.locked|tempering|alchemy|staff)\\s+)?(?:recipes|rows|names|staves|spells)\\b|\\b' + quantity + '\\s+(?:reach the server|are (?:tempering|the armou?r table|the sharpening wheel|race.locked))\\b|\\b(?:recipes|spells) are ' + quantity + '\\b', 'gi');
for (const file of pages.filter(file => !/^warrior(?:\.|[\\/])/.test(file))) {
  const text = read(path.join(professions, file));
  for (const paragraph of text.split(/\n\s*\n/)) {
    const prose = paragraph.replace(/\[[^\]]+\]\([^)]*\)/g, '').replace(/\s+/g, ' ');
    check(!/^\| (?:Rank|Kind|Bench|Race) \| Recipes \|/m.test(paragraph), `${file}: duplicated recipe totals table`);
    check(!/^(?:Benches:.*\d|\d+ of the rows name a people)/i.test(prose.trim()), `${file}: duplicated bench or race counts: ${prose.trim()}`);
    for (const match of prose.matchAll(summary)) {
      // These are rules or examples, not claims about a generated list.
      if (/starting spells|^No halves and no recipes|thirst|^A mage who|^Someone a master/i.test(prose)) continue;
      check(false, `${file}: catalogue count belongs in its generated book: ${prose.trim()}`);
      break;
    }
  }
}
const mage = read(path.join(professions, 'mage.md'));
check(/each school separately/i.test(mage) && /Advanced in a school \| \+1/.test(mage) &&
  /Expert in a school \| \+1/.test(mage) && /Master in a school \| \+2/.test(mage) &&
  !/holds 6 points by master/i.test(mage), 'mage.md: points are earned per school rank, with no single Master total');

// The PR gate lays the content build before this runs. A bare checkout can
// still check the prose; it cannot report against a book it does not have.
if (fs.existsSync(lists)) {
  const byProfession = new Map();
  for (const file of pages.filter(file => file.includes(path.sep))) {
    const [profession, half] = file.split(path.sep);
    const name = `${profession}-${half}`;
    const link = `../../lists/${name}`;
    const prose = read(path.join(professions, file));
    if (!prose.includes(`(${link})`)) continue;
    const book = read(path.join(lists, name));
    const spells = profession === 'mage';
    const section = spells ? book : book.split('## Every recipe\n')[1] || '';
    const rows = section.split('\n').filter(line => /^\| /.test(line)).slice(2).map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
    check(rows.length > 0 && rows.every(row => row.length === (spells ? 3 : 9)), `${name}: missing or malformed book rows`);
    const asked = spells ? rows.filter(row => row[2]).length : rows.filter(row => row[7] === 'yes').length;
    const locks = spells ? 0 : rows.filter(row => row[6]).length;
    const benches = spells ? '' : [...new Set(rows.map(row => row[4]))].sort().join(', ');
    const total = byProfession.get(profession) || [0, 0, 0];
    total[0] += rows.length; total[1] += asked; total[2] += locks;
    byProfession.set(profession, total);
    console.log(`${name}: ${rows.length} rows, ${asked} ${spells ? 'mapped' : 'reach the server'}, ${spells ? '' : `${rows.length - asked} tempering, ${locks} race-locked; ${benches}`}`);
    if (!spells) {
      const heading = /\b(\d+) recipes, (\d+) of them reach the server\./.exec(book);
      check(heading && Number(heading[1]) === rows.length && Number(heading[2]) === asked, `${name}: book heading disagrees with its rows`);
    }
  }
  for (const [profession, [rows, asked, locks]] of byProfession) {
    console.log(`${profession}: ${rows} rows, ${asked} ${profession === 'mage' ? 'mapped' : 'reach the server'}, ${locks} race-locked`);
  }
} else if (process.env.GITHUB_ACTIONS === 'true') {
  check(false, 'The generated books were not laid by the gate');
} else {
  console.log('SKIP generated-book comparison: no content build in this checkout');
}
console.log(`${pages.length} profession and half pages read; ${failed} failures`);
process.exitCode = failed ? 1 : 0;
