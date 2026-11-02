'use strict';
/*
  test-5198-scenarios.js

  #5198: every gamemode system docs/GAME-SYSTEMS.md lists has a scenario
  harness on the gate, one that runs the whole gamemode over the stand-in
  server (tests/stand-in-server.js) in the engine's message order.

  A scenario says which systems it covers with header lines of its own,
  "Scenario: systems/<page>.md". This reads every tests/test-scenario-*.js,
  and for each system the guide links (a page directly under docs/systems):

    covered     a scenario names it, requires the stand-in, and is on the
                gate (not in tests/gate-excluded.txt);
    part of     its own page is a part of a bigger system's, named below with
                why, and that system is covered or waiting;
    not here    it is not something the gamemode runs, named below with why;
    waiting     no scenario yet, named in WAITING, which is #5198's own list.
                #5198 stays open until WAITING is empty.

  It fails when a system the guide links is none of these (a new system
  needs a scenario or a reason here), when a system in WAITING has a
  scenario now (take it off: the list only shrinks), when a name below is
  no longer in the guide, and when a scenario names a page that is not
  there. The pages under systems/professions/ and systems/classes/ are the
  halves and classes of professions.md and classes.md, so they count as
  those.

  Read only.

      node tests\test-5198-scenarios.js
*/
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
function read(p) { return fs.readFileSync(path.join(REPO, p), 'utf8').split(CR).join(''); }

/* Pages that are a part of a bigger system's page, and why. */
const PART_OF = {
  'merchant-all-hold-deliveries.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-crimson-work.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-expansion.md': ['merchants-guild.md', 'the six trades in each hold, the guild\'s roster'],
  'merchant-geode-work.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-legacy-offers.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-longfin-work.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-mammoth-work.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-orchard-work.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-pearl-bed.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-quest-catalogue.md': ['quests.md', 'the quests the traders give'],
  'merchant-quest-content.md': ['quests.md', 'the quests the traders give'],
  'merchant-regional-deliveries.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-retrieval-work.md': ['merchants-guild.md', 'a page of the merchant work catalogue'],
  'merchant-traders.md': ['merchants-guild.md', 'the traders\' counts and places'],
  'quest-locations.md': ['quests.md', 'where the quests send people'],
  'scene-reward-budget.md': ['quests.md', 'what a scene quest pays']
};

/* Pages the guide links that are not something the gamemode runs, and why. */
const NOT_HERE = {
  'body.md': 'not in the server: the page says so',
  'cut-items.md': 'items the last plugin takes out of the game; no server step',
  'discord.md': 'the Discord bot (bot/), which has harnesses of its own',
  'people.md': 'the index of the People table; each row is its own system here',
  'station-placement.md': 'where the content plugin stands the stations; no server step'
};

/*
  #5198's own list: gamemode systems with no scenario yet. It only shrinks.
*/
const WAITING = [
  'apprenticeship.md', 'carriages.md', 'carts.md', 'chat.md', 'classes.md', 'commands.md', 'creation.md',
  'death.md', 'disease.md', 'dungeon-loot.md', 'durability.md', 'embassy.md', 'emotes.md',
  'enchantments.md', 'factions.md', 'friends.md', 'gold.md', 'hair-dye.md', 'injury.md', 'journal.md',
  'magic.md', 'merchants-guild.md', 'mixtures.md', 'npcs.md', 'party.md', 'quests.md', 'races.md',
  'skill-tree.md', 'spoilage.md', 'stalls.md', 'thalmor.md', 'trade.md', 'trading-company.md', 'voice.md'
];

// ------------------------------------------------------- what the guide lists --
const guide = read('docs/GAME-SYSTEMS.md');
const listed = new Set();
const linkRe = /\]\(systems\/([a-z0-9-]+(?:\/[a-z0-9-]+)*\.md)\)/g;
let m;
while ((m = linkRe.exec(guide))) {
  const page = m[1];
  const top = page.indexOf('/') < 0 ? page : page.split('/')[0] + '.md';
  listed.add(top);
}
yes('the guide links systems (' + listed.size + ')', listed.size > 20);

// ------------------------------------------------------ what the scenarios say --
const excluded = new Set(read('tests/gate-excluded.txt').split('\n')
  .map(function (l) { return l.trim(); })
  .filter(function (l) { return l && l[0] !== '#'; })
  .map(function (l) { return l.split(/\s+/)[0]; }));
const covered = {};
const files = fs.readdirSync(path.join(REPO, 'tests')).filter(function (f) { return /^test-scenario-[a-z0-9-]+\.js$/.test(f); }).sort();
yes('there are scenario harnesses (' + files.length + ')', files.length > 0);
files.forEach(function (f) {
  const text = read('tests/' + f);
  const head = (text.match(/^'use strict';\s*\/\*([\s\S]*?)\*\//) || [, ''])[1];
  const names = [];
  const re = /^\s*Scenario: systems\/([a-z0-9-]+\.md)\s*$/gm;
  let s;
  while ((s = re.exec(head))) { names.push(s[1]); }
  yes(f + ' names what it covers in its header (' + names.join(', ') + ')', names.length > 0);
  yes(f + ' runs over the stand-in server', /require\('\.\/stand-in-server\.js'\)/.test(text));
  yes(f + ' is on the gate', !excluded.has(f));
  names.forEach(function (n) {
    yes(f + ' names a page that is there: systems/' + n, fs.existsSync(path.join(REPO, 'docs', 'systems', n)));
    if (!excluded.has(f)) { (covered[n] = covered[n] || []).push(f); }
  });
});

// ------------------------------------------------------------- every system --
const waiting = new Set(WAITING);
const open = [];
Array.from(listed).sort().forEach(function (page) {
  if (covered[page]) { return; }
  if (PART_OF[page]) {
    const whole = PART_OF[page][0];
    if (!covered[whole] && !waiting.has(whole)) { open.push(page + ' (part of ' + whole + ', which has nothing)'); }
    return;
  }
  if (NOT_HERE[page] || waiting.has(page)) { return; }
  open.push(page);
});
yes('every system the guide lists has a scenario, a reason, or is on #5198\'s list (' + open.join(', ') + ')', open.length === 0);
const done = WAITING.filter(function (p) { return covered[p]; });
yes('nothing on #5198\'s list has a scenario now; take these off it (' + done.join(', ') + ')', done.length === 0);
const stale = WAITING.concat(Object.keys(PART_OF), Object.keys(NOT_HERE)).filter(function (p) { return !listed.has(p); });
yes('every page named here is still in the guide (' + stale.join(', ') + ')', stale.length === 0);
const twice = WAITING.filter(function (p) { return PART_OF[p] || NOT_HERE[p]; });
yes('no page is named twice here (' + twice.join(', ') + ')', twice.length === 0);
console.log('');
console.log('covered by a scenario: ' + Object.keys(covered).filter(function (p) { return listed.has(p); }).sort().join(', '));
console.log('still waiting on #5198: ' + WAITING.length);
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
