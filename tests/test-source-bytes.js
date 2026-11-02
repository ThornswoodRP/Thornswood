// test-source-bytes.js
//
// No tracked source file carries a control character it did not mean to.
//
// WHY THIS EXISTS. On 23 September two form feeds were found in
// scripts/release/Publish-Update.ps1, one of them inside the message Die prints when the
// launcher's record of Vortex's files is missing:
//
//     "$ProfileDir\OwnGame<FF>iles.txt is missing"
//
// It was written as OwnGame\files.txt. Somewhere between a session and the
// file, a tool that eats backslashes turned "\f" into the form feed character,
// and the file parsed, ran, and passed every check there was, because nothing
// looks at bytes. The same thing happened to game/gamemode.js the same night
// and was only caught by reading the line back. And a "\n" in a comment in
// that file became a real line break at some point before that, splitting
// game\data\recipes.json across two lines.
//
// So this reads every tracked text file and fails on any byte below 32 that is
// not a tab, a line feed or a carriage return. A form feed, a vertical tab, a
// bell or a NUL in source is always one of these accidents: nothing in this
// repository needs one on purpose.
//
// Except the licence texts under records/client-licences (#3099). Those are
// other people's files kept byte for byte, and the old licence texts break
// their pages with a form feed (proxy-libintl's GNU LGPL 2.0, inside
// frida-gum.txt). Nothing written here goes in them: each is held by sha256
// and size to records/client-licences.json, which the fork's build wrote, by
// Check-Records.ps1 and tests/test-third-party.js, so an accident there fails
// those instead.
//
// And the form feed alone in the licence texts the install hands over,
// installer/licences (#4823), but its README.txt. Each is byte for byte a
// file of the package README.txt names (SkiaSharp's THIRD-PARTY-NOTICES.txt
// quotes the GNU LGPL 2.1, whose pages end with one), so the form feed there
// is the authors', not an accident. Every other control byte in them is
// still found, as in any other file.
//
// And a translation file for the game (#3133), Data\Interface\Translations\
// <plugin>_<LANGUAGE>.txt, which Skyrim reads only as UTF-16 with a byte
// order mark, so every other byte of it is a NUL on purpose. One of those is
// read as the UTF-16 text it is, and the same rule holds for its characters.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = REPO_DIR;
const TEXT = /\.(js|mjs|cjs|ps1|psm1|psd1|py|cs|xaml|md|json|html|htm|css|txt|yml|yaml|toml|cmd|bat|sh|ini|xml)$/i;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

let files = [];
try {
  files = execSync('git ls-files -z', { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8').split('\0').filter(Boolean);
} catch (e) {
  console.log('SKIP  git ls-files did not answer, so there is nothing to read: ' + e.message);
  process.exit(0);
}
const KEPT_AS_THEY_CAME = 'records/client-licences/';
const text = files.filter(function (f) { return TEXT.test(f) && f.indexOf(KEPT_AS_THEY_CAME) !== 0; });
yes('there are tracked text files to read, ' + text.length + ' of them', text.length > 50);

const GAME_TRANSLATION = /(^|\/)Interface\/Translations\/[^/]+_[A-Za-z]+\.txt$/;
const HANDED_OVER = /^installer\/licences\/(?!README\.txt$)/;

const bad = [];
text.forEach(function (rel) {
  let d = null;
  try { d = fs.readFileSync(path.join(ROOT, rel)); } catch (e) { return; }
  if (GAME_TRANSLATION.test(rel) && d.length >= 2 && d[0] === 0xff && d[1] === 0xfe) {
    if (d.length % 2) { bad.push(rel + '  is UTF-16 with an odd number of bytes, so its last character is cut'); return; }
    const t = d.slice(2).toString('utf16le');
    let ln = 1;
    for (let i = 0; i < t.length; i++) {
      const c = t.charCodeAt(i);
      if (c === 10) { ln++; continue; }
      if (c < 32 && c !== 9 && c !== 13) bad.push(rel + ':' + ln + '  character 0x' + c.toString(16).padStart(2, '0') + '  ...' + JSON.stringify(t.slice(Math.max(0, i - 30), i + 12)) + '...');
    }
    return;
  }
  const pageBreaks = HANDED_OVER.test(rel);
  let line = 1;
  for (let i = 0; i < d.length; i++) {
    const b = d[i];
    if (b === 10) { line++; continue; }
    if (b === 12 && pageBreaks) continue;
    if (b < 32 && b !== 9 && b !== 13) {
      const from = Math.max(0, i - 30);
      const near = d.slice(from, Math.min(d.length, i + 12)).toString('latin1')
        .replace(/[\x00-\x1f]/g, function (c) { return '<' + c.charCodeAt(0).toString(16).padStart(2, '0') + '>'; });
      bad.push(rel + ':' + line + '  byte 0x' + b.toString(16).padStart(2, '0') + '  ...' + near + '...');
    }
  }
});

bad.forEach(function (b) { console.log('      ' + b); });
yes('no tracked text file carries a stray control character', bad.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
