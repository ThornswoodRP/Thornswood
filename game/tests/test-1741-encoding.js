// test-1741-encoding.js
//
// #1741. A commit on the way to #1689 (d43fbd5a0a, 4 Oct) wrote
// game/gamemode.js after reading it as Windows-1252 instead of UTF-8. Every
// character outside ASCII in the file came out as the characters of its UTF-8
// bytes: the dash in the needs block's HUD icon comment, and the byte order
// mark inside seven regular expressions that strip one from allowed.json and
// door.json before JSON.parse. Those seven then stripped nothing, so a file
// saved with a byte order mark would not have parsed.
//
// This holds the file to UTF-8 read as UTF-8: no Windows-1252 reading of
// UTF-8 bytes anywhere in it, no byte order mark character written into the
// source (an escape, \uFEFF, cannot be misread), every strip after a
// readFileSync removes a real byte order mark, and the comment reads as it
// did before.
//
// GM=<path> runs it against another copy of the gamemode.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = process.env.GM || path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const raw = fs.readFileSync(SRC);
const gm = raw.toString('utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the bytes --

yes('E1 the gamemode reads back as the same bytes as UTF-8', Buffer.from(raw.toString('utf8'), 'utf8').equals(raw));
yes('E2 the gamemode does not start with a byte order mark', !(raw[0] === 0xEF && raw[1] === 0xBB && raw[2] === 0xBF));

// The characters Windows-1252 gives the bytes 0x80 to 0xBF, which is what the
// second and third bytes of a UTF-8 character turn into when read that way.
const TAIL = '\u0080-\u00BF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC' +
             '\u2013\u2014\u2018-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122';
const MISREAD = new RegExp('[\u00C2-\u00F4][' + TAIL + ']', 'g');
const misread = [];
gm.split('\n').forEach(function (line, i) {
  if (MISREAD.test(line)) { misread.push(i + 1); }
  MISREAD.lastIndex = 0;
});
yes('E3 no line holds UTF-8 read as Windows-1252' + (misread.length ? ' (lines ' + misread.slice(0, 10).join(', ') + ')' : ''),
    misread.length === 0);
const BOM = String.fromCharCode(0xFEFF);
yes('E4 no byte order mark character is written into the source', gm.indexOf(BOM) < 0);

// ------------------------------------------------ the strips that broke --

const strips = [];
let at = gm.indexOf('readFileSync(');
while (at >= 0) {
  const end = gm.indexOf(';', at);
  const stmt = gm.slice(at, end < 0 ? at + 400 : end);
  const m = /\.replace\(\s*(\/\^[^\/\n]+\/[a-z]*)\s*,\s*''\s*\)/.exec(stmt);
  if (m) { strips.push({ line: gm.slice(0, at).split('\n').length, re: m[1] }); }
  at = gm.indexOf('readFileSync(', at + 1);
}
const broken = strips.filter(function (s) {
  let re = null;
  try { re = new Function('return ' + s.re)(); } catch (e) { re = null; }
  return !re || (BOM + '{"a":1}').replace(re, '') !== '{"a":1}';
});
yes('S1 the gamemode strips a byte order mark after reading a file (' + strips.length + ' places)', strips.length > 0);
yes('S2 every one of them removes a real byte order mark' +
    (broken.length ? ' (lines ' + broken.map(function (s) { return s.line; }).join(', ') + ')' : ''),
    broken.length === 0);
['allowed.json', 'door.json'].forEach(function (name) {
  const reads = strips.filter(function (s) {
    const line = gm.split('\n').slice(s.line - 1, s.line + 1).join('\n');
    return line.indexOf("'" + name + "'") >= 0;
  });
  yes('S3 ' + name + ' is read with a strip that works, everywhere it is read (' + reads.length + ')',
      reads.length > 0 && reads.every(function (s) { return broken.indexOf(s) < 0; }));
});

// ------------------------------------------------------- the comment --

const comment = 'droplet was "M10 2C10 2 4 9 4 12.5A6 6 0 0 0 16 12.5C16 9 10 2 10 2z":\n' +
                '      the same teardrop, one of them upside down.';
yes('C1 the HUD icon comment reads as it did before #1689, with no dash', gm.indexOf(comment) >= 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
