'use strict';
/*
  test-4457-doc-channels.js

      node tests/test-4457-doc-channels.js

  #4457. The factions page sent a Leader to the faction panel "in #seats",
  and no #seats exists: each faction has its own seats channel. It also said
  traders did not yet buy and sell from a purse the server tracks, when each
  has one and what they buy is capped by it.

    A  every channel a page under docs/systems names (#name in its words, not
       in a code span or a link's address) is one docs/systems/discord.md
       lists as a channel;
    B  the factions page names a faction's own seats channel, and no #seats;
    C  the factions page says traders buy and sell from their own purse, and
       links the Merchant's Guild page's section on it, which is there.

  Read only.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const SYSTEMS = path.join(ROOT, 'docs', 'systems');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- A. every channel named is one the Discord page lists -------------------
const discord = read(path.join(SYSTEMS, 'discord.md'));
const listed = new Set();
const row = /^\| #([a-z0-9][a-z0-9-]*) \|/gm;
let m;
while ((m = row.exec(discord))) { listed.add(m[1]); }
yes('the Discord page lists its channels (' + listed.size + ')', listed.size > 50);

function pages(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { out.push(...pages(p)); }
    else if (/\.md$/.test(e.name) && p !== path.join(SYSTEMS, 'discord.md')) { out.push(p); }
  }
  return out.sort();
}
const named = [];
let checked = 0;
for (const f of pages(SYSTEMS)) {
  read(f).split('\n').forEach((line, i) => {
    const words = line.replace(/`[^`]*`/g, ' ').replace(/\]\([^)]*\)/g, '] ');
    // A channel: # and a lower-case name, not part of a word, a path, an
    // HTML character reference or a link's text joined to its address.
    const chan = /(?<![\w/&\]])#([a-z][a-z0-9-]*)/g;
    let c;
    while ((c = chan.exec(words))) {
      checked++;
      if (!listed.has(c[1])) { named.push(path.relative(ROOT, f) + ':' + (i + 1) + ' #' + c[1]); }
    }
  });
}
yes('pages under docs/systems name channels (' + checked + ')', checked >= 5);
yes('and every one is on the Discord page' + (named.length ? ' (not: ' + named.join(', ') + ')' : ''), named.length === 0);

// ---- B and C. the factions page --------------------------------------------
const factions = read(path.join(SYSTEMS, 'factions.md'));
yes('the factions page names no #seats', !/(?<![\w-])#seats\b/.test(factions));
yes('and names a faction\'s own seats channel', /#[a-z-]+-seats\b/.test(factions) && /own seats channel/.test(factions));
yes('the factions page no longer says traders have no purse', !/do not yet buy and sell/.test(factions));
yes('it says each trader buys and sells from their own purse', /Each trader buys and sells from\s+their own purse/.test(factions));
const link = /\]\(merchants-guild\.md#([a-z0-9-]+)\)/.exec(factions);
yes('and links the Merchant\'s Guild page\'s section on the purse', !!link && link[1] === 'the-traders-purse');
const guild = read(path.join(SYSTEMS, 'merchants-guild.md'));
yes('which has that section', /^## The trader's purse$/m.test(guild));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
