'use strict';
/*
  test-4301-site-settings-docs.js

      node site\tests\test-4301-site-settings-docs.js

  #4301. site\README.md names each setting the site reads for where it listens,
  which proxies it believes and where it reads chat, with its default. The
  defaults are read out of the code, so the README cannot drift from it.
  Read only.
*/
const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(SITE, f), 'utf8');
const readme = read('README.md');
const base = read('lib/base.js');
const limits = read('lib/limits.js');
const logs = read('lib/serverlogs.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const unq = (s) => s.replace(/\\\\/g, '\\');
const chatMain = unq((/main:\s*process\.env\.THORNSWOOD_CHAT_DIR \|\| '([^']+)'/.exec(logs) || [])[1] || '');
const chatDev = unq((/dev:\s*process\.env\.THORNSWOOD_DEV_CHAT_DIR \|\| '([^']+)'/.exec(logs) || [])[1] || '');
yes('serverlogs.js gives the live chat folder default (' + chatMain + ')', !!chatMain);
yes('serverlogs.js gives the dev chat folder default (' + chatDev + ')', !!chatDev);
yes('base.js opens every address only for EXPOSE exactly 1, and LOCAL=1 wins',
  /THORNSWOOD_DOCS_EXPOSE === '1' && process\.env\.THORNSWOOD_DOCS_LOCAL !== '1'/.test(base));
yes('limits.js reads TRUSTED_PROXIES as empty when unset',
  /process\.env\.THORNSWOOD_TRUSTED_PROXIES \|\| ''/.test(limits));

const row = (name) => readme.split(/\r?\n/).find((l) => l.startsWith('| `' + name + '` |')) || '';
const rows = [
  ['THORNSWOOD_DOCS_EXPOSE', 'unset'],
  ['THORNSWOOD_TRUSTED_PROXIES', 'empty'],
  ['THORNSWOOD_CHAT_DIR', '`' + chatMain + '`'],
  ['THORNSWOOD_DEV_CHAT_DIR', '`' + chatDev + '`']
];
for (const [name, def] of rows) {
  const r = row(name);
  yes('the README has a row for ' + name + ' with its default, ' + def, !!r && r.split('|')[2].trim() === def);
}
yes('the EXPOSE row says LOCAL=1 keeps it on loopback', /THORNSWOOD_DOCS_LOCAL=1/.test(row('THORNSWOOD_DOCS_EXPOSE')));
yes('the TRUSTED_PROXIES row says only the last forwarded hop is believed', /last/i.test(row('THORNSWOOD_TRUSTED_PROXIES')));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
