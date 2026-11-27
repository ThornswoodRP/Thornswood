'use strict';
/*
  test-4316-full-table.js

      node site/tests/test-4316-full-table.js

  #4316. The public read limit and the upload budget each kept one row per
  sender in a table of at most 4096, and refused every sender it had no row
  for once it was full. One machine sending from 4096 IPv6 /64s locked every
  new visitor out of /api/public for a minute and out of uploads for an hour.

  The site's own code is copied into a scratch folder and loaded from there
  (loading it writes config.json), and driven with stand-in requests:

    A. The real publicApiWait: 4096 /64s from one /48 fill the table. A
       visitor from another network, IPv6 or IPv4, still reads. The sprayer's
       next addresses share their network's row, so they are still limited.
    B. The upload budget the same way, on budgets.js with the real
       senderKeys, and receiveUpload counts through it.
    C. Rows still go when their window is up, and each table stays bounded.

  Nothing leaves this machine. Read only, apart from the scratch folder.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');

const SITE = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4316-'));
fs.cpSync(path.join(SITE, 'lib'), path.join(work, 'lib'), { recursive: true });
fs.cpSync(path.join(SITE, 'data'), path.join(work, 'data'), { recursive: true });
fs.cpSync(path.join(SITE, 'public'), path.join(work, 'public'), { recursive: true });
const log = console.log;
console.log = () => {};                      // the copy's start-up lines
let limits;
try { limits = require(path.join(work, 'lib', 'limits.js')); }
finally { console.log = log; }

const from = (addr) => ({ socket: { remoteAddress: addr }, headers: {} });
const T0 = 1700000000000;

// ------------------------------------------------------------- A. reads --
for (let n = 0; n < 4096; n++) limits.publicApiWait(from('2001:db8:1:' + n.toString(16) + '::1'), T0);
yes('A1 a visitor from another IPv6 network still reads once 4096 /64s are held',
    limits.publicApiWait(from('2001:db8:2:1::5'), T0 + 10) === 0);
yes('A2 and a visitor on IPv4 too', limits.publicApiWait(from('203.0.113.5'), T0 + 10) === 0);
let sprayed = 0, held = 0;
for (let n = 4096; n < 4096 + 300; n++) {
  if (limits.publicApiWait(from('2001:db8:1:' + n.toString(16) + '::1'), T0 + 20) === 0) sprayed++;
  else held++;
}
yes('A3 the sprayer\'s next /64s share their network\'s row: 120 read, the rest wait (read ' + sprayed + ')',
    sprayed === 120 && held === 180);
yes('A4 and the visitor from elsewhere still reads after that',
    limits.publicApiWait(from('2001:db8:2:1::5'), T0 + 30) === 0);
yes('A5 a known sender keeps its own count', (() => {
  let w = 0;
  for (let n = 0; n < 120; n++) w = limits.publicApiWait(from('2001:db8:1:7::1'), T0 + 40);
  return w > 0;                              // its one read at T0, then 119 more, then the 121st waits
})());

// ----------------------------------------------------------- B. uploads --
let budgets = null;
try { budgets = require(path.join(work, 'lib', 'budgets.js')); } catch (e) { /* main has none */ }
yes('B1 the counts live in budgets.js', !!budgets && typeof budgets.uploadBudget === 'function');
if (budgets) {
  const take = budgets.uploadBudget();
  for (let n = 0; n < 4096; n++) take(limits.senderKeys(from('2001:db8:1:' + n.toString(16) + '::1')), T0, false);
  const visitor = take(limits.senderKeys(from('2001:db8:2:1::5')), T0 + 10, false);
  yes('B2 a visitor from another network can still upload once 4096 /64s are held',
      !!visitor.row && !visitor.full && !visitor.wait);
  let taken = 0;
  for (let n = 4096; n < 4096 + 60; n++) {
    const got = take(limits.senderKeys(from('2001:db8:1:' + n.toString(16) + '::1')), T0 + 20, false);
    if (got.row) { taken++; got.row.active--; }
  }
  yes('B3 the sprayer\'s next /64s share one network\'s 40 files an hour (took ' + taken + ')', taken === 40);
}
const uploads = fs.readFileSync(path.join(SITE, 'lib', 'uploads.js'), 'utf8');
yes('B4 receiveUpload counts through budgets.js by senderKeys',
    /takeUploadBudget\(senderKeys\(req\), now, copy\)/.test(uploads) && !/uploadBudgets/.test(uploads));

// ---------------------------------------------------------- C. bounds --
if (budgets) {
  const read = budgets.readBudget(2);
  const keys = (n) => ['own' + n, 'net' + (n % 2), 'wide'];
  read(keys(0), 0); read(keys(1), 0);
  yes('C1 a third sender with the narrow table full is counted at its network', read(keys(2), 0) === 0);
  // own0 and own1 fill the narrow table; net0 and y fill the middle one;
  // r and u fill the widest. A sender with no row anywhere then waits.
  read(['x', 'y', 'z'], 1); read(['p', 'q', 'r'], 1); read(['s', 't', 'u'], 1);
  yes('C2 when every width is full, an unseen sender waits a second, as before',
      read(['v', 'w', 'k'], 2) === 1);
  yes('C3 rows go when their minute is up', read(['v', 'w', 'k'], 60002) === 0);
}

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
