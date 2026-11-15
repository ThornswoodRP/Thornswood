/*
  test-4223-key-compare.js

      node site\tests\test-4223-key-compare.js

  Issue #4223. sameSecret (site/lib/auth.js) padded both sides to 96
  characters, cut them there, and handed their UTF-8 bytes to
  crypto.timingSafeEqual. A character outside ASCII makes the byte lengths
  differ, and timingSafeEqual throws, so a wrong bot key or password with
  one accent was a 500 and a stack in the log, not a 401. The padding and
  the cut also let trailing spaces and anything past 96 characters match,
  and the keyed routes passed String(o.key || ''), so a key sent as ["pw"]
  stood for "pw".

  The real sameSecret, lifted out of auth.js and run with Node's crypto:

    A  the same key matches, and a wrong ASCII one does not;
    B  a given side with a character outside ASCII, or one Latin-1 byte as a
       header carries it, is false and does not throw;
    C  trailing spaces do not match;
    D  past 96 characters counts: a key longer than 96 and a given side
       that differs only after 96 do not match, nor does the key with
       more on the end;
    E  anything that is not a string is false: an array holding the key,
       a number, an object, null and undefined, on either side;
    F  the routes that read a key out of a request body pass it as it came,
       with no String() around it.

  Named for what it compares and not for the word the secrets scan reads
  as a credential file. Read only.
*/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const AUTH = fs.readFileSync(path.join(ROOT, 'site', 'lib', 'auth.js'), 'utf8').replace(/\r\n/g, '\n');
const SERVE = fs.readFileSync(path.join(ROOT, 'site', 'lib', 'serve.js'), 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + String(why).slice(0, 600) : '')); }
}

const src = (/\nfunction sameSecret\([\s\S]*?\n\}\n/.exec(AUTH) || [''])[0];
yes('sameSecret is found in site/lib/auth.js', !!src);
const box = { crypto: crypto, Buffer: Buffer };
vm.runInNewContext(src + '\nthis.sameSecret = sameSecret;', box);
const same = box.sameSecret;

// What it answers, or the error it threw.
function ask(a, b) {
  try { return { v: same(a, b) }; } catch (e) { return { threw: e.message }; }
}
function no(what, a, b) {
  const r = ask(a, b);
  yes(what, !r.threw && r.v === false, r.threw ? 'it threw: ' + r.threw : 'it answered ' + r.v);
}

const KEY = 'k3y-for-the-bot-0123456789abcdef';

console.log('A. the same key, and a wrong one:');
yes('the same key matches', ask(KEY, KEY).v === true, JSON.stringify(ask(KEY, KEY)));
no('a wrong ASCII key does not', 'not-the-key', KEY);

console.log('\nB. outside ASCII:');
no('a key with an accent is false and does not throw', 'k\u00e9y-for-the-bot', KEY);
no('one Latin-1 byte, as a header carries it, is false and does not throw', 'k3y\u00ff', KEY);
no('a password with an accent against an ASCII one', 'p\u00e4ssword', 'password');
no('an emoji against the key', '\ud83d\udd11', KEY);

console.log('\nC. trailing spaces:');
no('"pw  " is not "pw"', 'pw  ', 'pw');
no('the key with a space on the end is not the key', KEY + ' ', KEY);

console.log('\nD. past 96 characters:');
const LONG = 'a'.repeat(96) + 'the-rest-of-it';
no('a given side the same for 96 characters and different after is not the key', 'a'.repeat(96) + 'something-else', LONG);
no('the first 96 characters alone are not the key', 'a'.repeat(96), LONG);
no('the key with more on the end is not the key', LONG + 'x', LONG);
yes('a key past 96 characters still matches itself', ask(LONG, LONG).v === true, JSON.stringify(ask(LONG, LONG)));

console.log('\nE. anything that is not a string:');
no('["pw"] is not "pw"', ['pw'], 'pw');
no('a number is not its digits', 1234, '1234');
no('an object is not "[object Object]"', {}, '[object Object]');
no('null is not "null"', null, 'null');
no('undefined is not "undefined"', undefined, 'undefined');
no('a string against a key that is not one', 'pw', ['pw']);

console.log('\nF. the keyed routes pass the key as it came:');
const wrapped = SERVE.split('\n').filter((l) => /sameSecret\(String\(o\.key/.test(l));
yes('no route turns a body\'s key into a string before comparing it (' + wrapped.length + ')', wrapped.length === 0,
    wrapped.map((l) => l.trim()).join('\n'));
const raw = SERVE.split('\n').filter((l) => /sameSecret\(o\.key, String\(cfg\.botKey\)\)/.test(l));
yes('the ticket, roster and economy routes compare o.key itself (' + raw.length + ')', raw.length === 3);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
