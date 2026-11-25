/*
  #4414: the embassy page agrees with the Accord and leaves fares to the
  carriage page.

  On main 3bd7c3a docs/systems/embassy.md said "A Legion soldier under arms
  is one of the 6, inside the walls", while the same page, the World page
  and lore/factions.md say no Legion soldier sets foot in Skyrim under arms
  and the 6 are the embassy's own guard. It also said a carriage to
  Solitude is "20 gold", while the carriage page and the gamemode make the
  fare 10 inside a hold and 20 between holds, into the drop box of the hold
  the ride leaves from. Read only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const flat = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\s+/g, ' ');

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}

const page = flat('docs/systems/embassy.md');
const sentences = page.split(/(?<=[.!?])\s/);

// 1. The Accord: every Legion soldier on the page is one who is not there.
yes('the Accord still bars every Legion soldier under arms (lore/factions.md)',
  /no Legion soldier sets foot in Skyrim under arms/.test(flat('lore/factions.md')));
const legion = sentences.filter(function (s) {
  return /Legion soldier/i.test(s) && !/\bno Legion soldier\b|\bnot (?:a )?Legion\b|cannot play a (?:serving )?Legion soldier/i.test(s);
});
yes('embassy.md names no Legion soldier as one of the six or as somebody who plays at the embassy' +
  (legion.length ? ': "' + legion[0] + '"' : ''), legion.length === 0);
yes('and still says the 6 are the embassy\'s own guard, not Legion', /The 6 are the embassy's own guard, not Legion/.test(page));

// 2. Fares belong to the carriage page.
const fareLines = sentences.filter(function (s) { return /carriage|ferry|fare/i.test(s) && /\b\d+ gold\b/.test(s); });
yes('embassy.md gives no carriage fare in gold' + (fareLines.length ? ': "' + fareLines[0] + '"' : ''), fareLines.length === 0);
yes('and points at the carriage page for the fare', /fare[^.]*\]\(carriages\.md\)|\]\(carriages\.md\)[^.]*fare/i.test(page) ||
  sentences.some(function (s) { return /fare/i.test(s) && /\(carriages\.md\)/.test(s); }));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
