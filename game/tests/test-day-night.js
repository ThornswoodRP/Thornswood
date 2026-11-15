// test-day-night.js
//
// Day/night for warmth must match what is on screen (#841).
//
// Measured: SkyMP TimeService (engine/skymp/.../timeService.ts) sets GameHour
// (form 0x38) from UTC every two seconds. That is what paints the sky.
// thornswood-front used to derive night from Utility.getCurrentGameTime(),
// which is GameDaysPassed. TimeService never writes GameDaysPassed, so the
// /place night bit could disagree with daylight on screen and warmth/rest.
//
// Fix: night = GameHour < 6 or >= 20, same cut as before, against the sky.
//
//   node game/tests/test-day-night.js
'use strict';
const fs = require('fs');
const path = require('path');
const FRONT = process.env.FRONT ||
  path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const from = front.indexOf('const FIRE_BASES');
const to = front.indexOf('   * Jump and sprint.', from);
const where = (from >= 0 && to > from) ? front.slice(from, to) : '';
yes('the place block is findable', !!where);

yes('front names the day/night match work (#841)',
    /Discord close-out #841/.test(where) || /GameHour 0x38[\s\S]*#841/.test(where));
yes('night reads GameHour via GlobalVariable 0x38',
    /GlobalVariable\.from\(sp\.Game\.getFormEx\(0x38\)\)/.test(where));
yes('night still uses the 6 / 20 hour cut',
    /hour < 6 \|\| hour >= 20/.test(where));
yes('place line still sends the night bit',
    /'\/place '/.test(where) && /\+ night \+/.test(where));
yes('place block no longer calls getCurrentGameTime',
    !/getCurrentGameTime\(\)/.test(where));
yes('comment still names the old wrong clock so nobody puts it back',
    /getCurrentGameTime/.test(where) && /GameDaysPassed/.test(where));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
