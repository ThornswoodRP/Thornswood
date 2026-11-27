'use strict';
/*
  test-4458-stale-reasons.js

      node tests/test-4458-stale-reasons.js

  #4458. The Thalmor page said a nearby person's machine moves the patrols
  and that guards are mostly the game's own actors, and cited a known-issues
  page that is no longer in the repository; the NPC page says the server
  runs the cast that stays and that there are no NPC guards. The Professions
  page listed the repair kits as not in the world yet, when Durability has
  the three kits and Mend uses them.

    A  no page under docs/systems cites a known-issues page;
    B  the Thalmor page says nothing about a nearby person's machine moving
       the patrols, a host that changes, or guards being the game's actors,
       and links People who are not people for both;
    C  the Professions page's "Not in the world yet" names no repair kits,
       nor does the Smith page say the kits are not in the plugin, while
       the Durability page says the three kits are records in the plugin.

  Read only.
*/
const fs = require('fs');
const path = require('path');
const SYSTEMS = path.join(__dirname, '..', 'docs', 'systems');
const read = (f) => fs.readFileSync(path.join(SYSTEMS, f), 'utf8').replace(/\r\n/g, '\n');
const flat = (s) => s.replace(/\s+/g, ' ');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- A ---------------------------------------------------------------------
function pages(dir, base) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) { out.push(...pages(path.join(dir, e.name), rel)); }
    else if (/\.md$/.test(e.name)) { out.push(rel); }
  }
  return out.sort();
}
const citing = pages(SYSTEMS, '').filter((f) => /known-issues page|known issues page|\]\([^)]*known\.md/i.test(flat(read(f))));
yes('no page under docs/systems cites a known-issues page' + (citing.length ? ' (' + citing.join(', ') + ')' : ''), citing.length === 0);

// ---- B ---------------------------------------------------------------------
const thalmor = flat(read('thalmor.md'));
yes('the Thalmor page does not say a nearby person\'s machine moves the patrols', !/machine of a nearby person|nearby person'?s machine/i.test(thalmor));
yes('nor that a host changes every 2 seconds', !/host can change/i.test(thalmor));
yes('nor that guards are the game\'s own actors', !/game's own actors/i.test(thalmor));
yes('it says there are no NPC guards', /There are no NPC guards/.test(thalmor));
yes('and links People who are not people, and its Who does not stay section',
    /\]\(npcs\.md\)/.test(thalmor) && /\]\(npcs\.md#who-does-not-stay\)/.test(thalmor));
const npcs = read('npcs.md');
yes('which the NPC page has, saying guards are people', /^## Who does not stay$/m.test(npcs) && /There are no NPC guards/.test(flat(npcs)));

// ---- C ---------------------------------------------------------------------
const prof = flat(read('professions.md'));
// The line runs from its words to the sentence after it, which starts
// "Each profession page says"; its parts have links with dots in them.
const notYet = (/Not in the world yet:.*?(?=Each profession page says)/.exec(prof) || [''])[0];
yes('the Professions page has its "Not in the world yet" line', notYet.length > 0);
yes('and it names no repair kits', notYet.length > 0 && !/repair kit|kits/i.test(notYet));
const smith = flat(read('professions/smith.md'));
yes('the Smith page does not say the kits are not in the plugin', !/(kits[^.]*not (yet )?(records|in the plugin))|(not records in the plugin)/i.test(smith));
yes('the Durability page says the three kits are records in the plugin', /The three kits are records in the plugin/.test(flat(read('durability.md'))));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
