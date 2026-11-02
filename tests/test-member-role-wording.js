// test-member-role-wording.js
//
// Issue #986: the access comment and the bot README still told people that
// Member is handed out on join, or that Discord has a default-role setting.
// Staff give Member after an application is accepted. Playtester (access.play)
// is what opens the game. Discord has no default-role setting.
// Reads the files. No server.

const fs = require('fs');
const path = require('path');
const siteFiles = require('./site-files');
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const server = siteFiles.source();
const readme = read('bot/README.md');
const accessAt = server.indexOf('Discord roles decide everything');
const access = accessAt < 0 ? '' : server.slice(accessAt, accessAt + 1400);
const itemAt = readme.indexOf('3. **Hand Member out on join.**');
const item = itemAt < 0 ? '' : readme.slice(itemAt, itemAt + 600);

yes('the access comment says staff give Member after an application is accepted',
    access.indexOf('Staff give Member after an application is accepted.') >= 0);
yes('the access comment says Discord has no default-role setting',
    access.indexOf('Discord has no\n    default-role setting') >= 0);
yes('the access comment says Playtester (access.play) opens the game',
    access.indexOf('Playtester\n    (access.play) is what opens the game') >= 0);
yes('the access comment no longer punts to the issue',
    access.indexOf('Who gives Member') < 0);

yes('item 3 says the bot cannot hand Member out on join',
    item.indexOf('**Hand Member out on join.** It cannot.') >= 0);
yes('item 3 says Discord has no default-role setting',
    item.indexOf('Discord has no default-role\n   setting') >= 0);
yes('item 3 says staff give Member after an application is accepted',
    item.indexOf('Staff give Member after an application is accepted.') >= 0);
yes('item 3 says Playtester (access.play) opens the game',
    item.indexOf('Playtester\n   (access.play) is what opens the game.') >= 0);
yes('item 3 no longer names a default role option',
    readme.indexOf('default role option') < 0);
yes('the role table no longer says Member is handed out on the way in',
    readme.indexOf('handed out on the way in') < 0);
yes('the roles section no longer says everyone gets Member on the way in',
    readme.indexOf('Everyone gets **Member**') < 0);
yes('the open-switch note no longer says everybody in the Discord is given Member',
    server.indexOf('everybody in the Discord is given Member') < 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exit(1);
