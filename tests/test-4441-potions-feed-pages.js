/*
  #4441: the potions page, the college block's comment and the feed page say
  what the code does, not what it waited on before.

  On main 9dc6e19:
  - docs/systems/potions.md said the diminishing potions were "waiting on an
    engine build" and that potions still stack "until the engine build that
    reads it is on the server (skymp #62)". The gamemode hands the scale to
    the engine as eatItemScale, and skymp #62 is in the pin
    (records/client-build.json) and in the engine both servers run.
  - potions.md and game/gamemode/college.ts said the withered clear on a
    cooked meal waits because the server does not know a cooked meal (#1382).
    The needs block knows one (NEEDS.foodGroup.cooked). The clear itself is
    still not built (#6239), and the page may say that.
  - docs/FEED.md gave version.json as about ninety kilobytes, from before
    the site split it, and its "today" section was checked on 28 Sep, before
    the page's own note that the launcher stopped reading the feed.

  Each rule reads the code first and only holds while the code does the
  thing. Read only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const flat = (t) => t.replace(/\s+/g, ' ');
const sentences = (t) => flat(t).split(/(?<=[.!?])\s/);

let pass = 0;
let fail = 0;
function yes(name, ok) {
  if (ok) pass++; else fail++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
}
function none(name, text, re) {
  const bad = sentences(text).filter((s) => re.test(s));
  yes(name + (bad.length ? ': "' + bad[0] + '"' : ''), bad.length === 0);
}

const potions = read('docs/systems/potions.md');
const college = read('game/gamemode/college.ts');
const needs = read('game/gamemode/needs.ts');
const injury = read('game/gamemode/injury-and-disease.ts');
const feedMd = read('docs/FEED.md');
const feedJs = read('site/lib/feed.js');
const pin = JSON.parse(read('records/client-build.json'));

// A. The diminishing potions.
const scales = /mp\.set\(actorId, 'eatItemScale', scale\)/.test(injury) && /function potionScale\(/.test(needs);
yes('the gamemode hands the potion window to the engine as eatItemScale', scales);
yes('records/client-build.json names a fork commit (' + pin.forkCommit + ')', /^[0-9a-f]{8,40}$/.test(String(pin.forkCommit || '')));
if (scales) {
  none('potions.md does not say the diminishing potions wait on an engine build', potions,
    /\bwaiting on an engine build\b|\buntil the engine build\b|\bpotions still stack\b/i);
  const where = flat(potions.slice(potions.indexOf('## Where this is')));
  yes('potions.md points at the pin (records/client-build.json) and states the main server\'s engine build',
    where.indexOf('records/client-build.json') >= 0 && /\bmain server runs\b[^.]*\b[0-9a-f]{8}\b/.test(where));
}

// B. The cooked-meal and bed-rest recovery.
const cooked = /foodGroup:\s*\{[\s\S]*?cooked:\s*\{\s*food:\s*\d+/.test(needs);
yes('the needs block knows a cooked meal (NEEDS.foodGroup.cooked)', cooked);
if (cooked) {
  const stale = /\b(?:does not|doesn't) know a cooked meal\b|\bwaits for the cooked meal\b|\bcooked meal\b[^.]*\bnot (?:know|known) yet\b|\buntil the meals on\b/i;
  none('potions.md does not say the server cannot tell a cooked meal', potions, stale);
  const comment = college.slice(0, college.indexOf('*/'));
  none('college.ts\'s comment does not say the server cannot tell a cooked meal', comment, stale);
  yes('the guide and implementation cite the recovery work (#6239)', potions.indexOf('#6239') >= 0 && comment.indexOf('#6239') >= 0);
}

// C. The feed page.
const split = /const FEED_SPLIT_LAUNCHER = '/.test(feedJs) && /function feedSplit\(/.test(feedJs);
yes('the site answers version.json split (feedSplit)', split);
if (split) {
  const head = feedMd.slice(0, feedMd.indexOf('## A real entry'));
  none('FEED.md does not give version.json as ninety kilobytes today', head, /\b(?:is|are)\b[^.]*\bninety kilobytes\b/i);
}
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const day = (m) => (m ? Date.UTC(Number(m[3]), MONTHS[m[2]], Number(m[1])) : NaN);
const retired = day(/Retired from the launcher by #5608 \((\d{1,2}) (\w{3}) (\d{4})\)/.exec(feedMd));
const today = feedMd.slice(feedMd.indexOf('## What looks wrong in the feeds today'));
const checked = day(/Re-checked on (\d{1,2}) (\w{3}) (\d{4})/.exec(today));
yes('FEED.md\'s today section was re-checked, with a year, on or after the launcher stopped reading the feed',
  !isNaN(retired) && !isNaN(checked) && checked >= retired);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
