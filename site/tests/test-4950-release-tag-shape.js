/*
  test-4950-release-tag-shape.js

      node site\tests\test-4950-release-tag-shape.js

  Issue #4950. Release ids name their instant in UTC with a Z on the
  seconds: 20261113-010203Z, and 20261113-010203Z-dev on dev, tagged
  release/main/<id> and release/dev/<id>. The site reads a feed's release
  tag through RELEASE_TAG_RE (site/lib/feed.js) and treats one it refuses
  as no tag at all, so every release named the new way would have had no
  Release to serve its files from.

  The real RELEASE_TAG_RE, lifted out of feed.js:

    A  the new ids, main and dev, are taken;
    B  the ids already published (seconds, and the older minutes) still are;
    C  nothing looser is: a Z after minutes, a lower-case z, a Z after -dev,
       other lengths, another channel, and anything round the tag. Which
       channel carries -dev is not this shape's to say (it never was);
       Set-Ref.ps1 ties the two where a tag is made.

  Read only.
*/
const fs = require('fs');
const path = require('path');

const FEED = fs.readFileSync(path.join(__dirname, '..', 'lib', 'feed.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond, why) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (why ? '\n      ' + why : '')); }
}

const line = (/^const RELEASE_TAG_RE = (\/.*\/);\s*$/m.exec(FEED) || [])[1];
yes('RELEASE_TAG_RE is found in site/lib/feed.js', !!line);
// eslint-disable-next-line no-new-func
const RE = line ? new Function('return ' + line)() : /$^/;

console.log('\nA. the new ids:');
for (const tag of ['release/main/20261113-010203Z', 'release/dev/20261113-010203Z-dev']) {
  yes(tag + ' is taken', RE.test(tag));
}

console.log('\nB. the ids already published:');
for (const tag of ['release/main/20261102-121621', 'release/dev/20261102-121621-dev',
                   'release/main/20261001-1800', 'release/dev/20261001-1800-dev']) {
  yes(tag + ' is still taken', RE.test(tag));
}

console.log('\nC. nothing looser:');
for (const tag of ['release/main/20261101-1810Z', 'release/main/20261113-010203z',
                   'release/dev/20261113-010203-devZ', 'release/main/20261113-010203ZZ',
                   'release/main/2026111-010203Z', 'release/main/20261113-01020Z',
                   'release/main/20261113-0102030Z', 'release/next/20261113-010203Z',
                   ' release/main/20261113-010203Z', 'release/main/20261113-010203Z\n',
                   'release/main/20261113-010203Z/x', 'release/main/']) {
  yes(JSON.stringify(tag) + ' is refused', !RE.test(tag));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
