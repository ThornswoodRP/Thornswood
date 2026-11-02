// test-other-server-name-gone.js
//
// The name of the SkyMP server Thornswood-Content.esp was salvaged from, and
// its two short forms, are in no tracked file: not in code, comments, tests,
// records, data, documents, docs\archive, the plugins themselves, or any
// tracked file's path.
//
// WHY THIS EXISTS. Issue #400. Patrick, 12 October, answering the decision on
// the plugin's header description: "B and yes they can just don't mention
// [it] at all", and later the same day, "no records may keep it". The
// salvaged records stay in the plugin; the name goes from everything. On 15
// October it stood in 18 tracked files, the plugin's header among them, and
// they were reworded: "the other server" in prose, OtherServer in file,
// folder and code names, as #497 did for the old multiplayer mod
// (tests\test-old-name-gone.js). Git history is not rewritten.
//
// THE SHORT FORMS. Patrick, 15 October, decision C on #400: the other
// server's two abbreviations (a three letter prefix on its editor ids,
// scripts and folders, and a six letter one, also spelled with two letters in
// front, on its board and its records) go the same way, from paths, tools,
// prose and docs\archive. On 16 October they stood on 86 lines of 27 tracked
// files; the ones in text were reworded, and the checks that find the other
// server's leftovers on a machine match them by shape instead of by name.
//
// The name and the short forms are written here as their code points, so
// that this file does not carry them either and needs no exception for
// itself. A spelling of the name with one a fewer or an extra i (one quote in
// the archive had that) is caught too.
//
// WHERE EACH IS LOOKED FOR.
//   - Every tracked file's path: all of them, in any case.
//   - Text: all of them, in any case, except inside a PEM block (a
//     certificate written out as base64, where any three letters turn up by
//     chance: tests\fixtures\3111-roots.pem holds eight).
//   - A plugin (.esp, .esm, .esl): its header and every record, compressed
//     records inflated first, all of them, in any case. That is where the
//     short forms last lived, on 33 editor ids and one attached script.
//   - Pictures, video, sound and fonts: the name and the six letter form, as
//     single bytes and as UTF-16. Not the three letter form: these are
//     compressed or pixel data, where three letters turn up by chance
//     (measured 16 October: nine of them hold it, in mixed case, inside
//     their compressed data, and none as a word).
//   - Every other binary file (meshes, interface files, programs): all of
//     them, as single bytes and as UTF-16, in any case.
//   - Thornswood-Last.esp, which no repository holds since #2791 step 3: it
//     is made from game/data/last-plugin.recipe (tests/last-plugin-made.js)
//     and searched as a plugin. The recipe itself is searched as a binary
//     file. Without a game Data folder to make it from, that one check
//     prints SKIP and the rest still run.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const c = String.fromCharCode;
// k e i z a, then a, i, both or neither, then l.
const NAME_SRC = c(107, 101, 105, 122, 97) + '(?:' + c(97) + '?' + c(105) + '?)' + c(108);
// The same four spellings, lower case, for the binary search.
const SPELLINGS = ['', c(97), c(105), c(97, 105)].map(function (mid) { return c(107, 101, 105, 122, 97) + mid + c(108); });
// The short forms, lower case: the three letter prefix, and the six letter
// one, which its longer spelling contains.
const SHORT3 = c(107, 122, 108);
const SHORT6 = c(111, 108, 105, 118, 97, 114);
const ALL_SRC = NAME_SRC + '|' + SHORT3 + '|' + SHORT6;
const ALL = new RegExp(ALL_SRC, 'gi');

// The pattern itself works: the name and its misspelling, in any case, and
// not a word that only starts the same way; and the short forms, in any case,
// as a prefix, inside a word and inside a path.
const probe = c(75, 101, 105, 122, 97, 97, 108);
const once = function (s) { return new RegExp(ALL_SRC, 'i').test(s); };
yes('the pattern finds the name, in any case', once('x ' + probe + ' y') && once(probe.toUpperCase()));
yes('  and the one misspelling the archive had', once(c(75, 101, 105, 122, 97, 97, 105, 108)));
yes('  and nothing that only starts the same way', !once('keizer'));
yes('  and the three letter form as a prefix, inside a name and in a path, in any case',
    once(c(75) + SHORT3.slice(1) + 'Chop') && once('Data\\_disabledBy' + c(75) + SHORT3.slice(1)) &&
    once('meshes\\weapons\\' + SHORT3 + '\\' + SHORT3 + '_haybale.nif') && once(SHORT3.toUpperCase()));
yes('  and the six letter form, in its longer spelling too, in any case',
    once(c(107, 122) + SHORT6 + 'messageboard') && once('meshes\\' + SHORT6 + '-messageboard\\x.nif') && once(SHORT6.toUpperCase()));

let tracked = [];
try {
  tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    .split('\0').filter(Boolean);
} catch (e) {
  console.log('git ls-files failed: ' + e.message);
}
yes('git lists the tracked files (' + tracked.length + ')', tracked.length > 100);

function lineOf(text, at) {
  let n = 1;
  for (let i = 0; i < at; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

// Text with every PEM block blanked, keeping the line breaks so line numbers
// still match the file.
const PEM = /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g;
function withoutPem(s) {
  return s.replace(PEM, function (block) { return block.replace(/[^\n]/g, ' '); });
}
yes('a PEM block is blanked and nothing else is',
    withoutPem('a\n-----BEGIN CERTIFICATE-----\nAB' + SHORT3 + 'Z\n-----END CERTIFICATE-----\n' + SHORT3 + '\n')
      .split('\n').length === 6 &&
    new RegExp(ALL_SRC, 'gi').exec(withoutPem('a\n-----BEGIN CERTIFICATE-----\nAB' + SHORT3 + 'Z\n-----END CERTIFICATE-----\n' + SHORT3 + '\n')).index > 40);

// A plugin's header and every record, compressed ones inflated, as one string.
// Null when it does not read as records, which is itself a finding.
function pluginText(buf) {
  try {
    if (buf.toString('latin1', 0, 4) !== 'TES4') return null;
    const parts = [buf.subarray(0, 24 + buf.readUInt32LE(4))];
    (function walk(start, end) {
      let p = start;
      while (p + 24 <= end) {
        const tag = buf.toString('latin1', p, p + 4);
        const size = buf.readUInt32LE(p + 4);
        if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
        const raw = buf.subarray(p + 24, p + 24 + size);
        parts.push(buf.subarray(p, p + 24));
        parts.push((buf.readUInt32LE(p + 8) & 0x00040000) ? zlib.inflateSync(raw.subarray(4)) : raw);
        p += 24 + size;
      }
      if (p !== end) throw new Error('a group does not add up');
    })(parts[0].length, buf.length);
    return Buffer.concat(parts).toString('latin1');
  } catch (e) { return null; }
}

// Compressed or pixel data, where three letters turn up by chance.
const MEDIA = /\.(png|jpe?g|gif|webp|ico|bmp|tga|dds|mp3|mp4|webm|ogg|wav|flac|xwm|fuz|ttf|otf|woff2?)$/i;

const hits = [];
let text = 0, binary = 0, plugins = 0;
const pluginNames = [];
function searchPlugin(rel, buf) {
  const s = pluginText(buf);
  if (s === null) { hits.push(rel + ' (a plugin that does not read as records, so it could not be searched)'); return; }
  let m;
  ALL.lastIndex = 0;
  while ((m = ALL.exec(s)) !== null) hits.push(rel + ' (plugin, at byte ' + m.index + ' of its inflated records)  ' + JSON.stringify(m[0]));
}
tracked.forEach(function (rel) {
  ALL.lastIndex = 0;
  if (ALL.test(rel)) hits.push(rel + ' (its path)');

  let buf;
  try {
    const st = fs.statSync(path.join(ROOT, rel));
    if (!st.isFile()) return;
    buf = fs.readFileSync(path.join(ROOT, rel));
  } catch (e) { return; }
  let m;
  if (/\.es[pml]$/i.test(rel)) {
    plugins++;
    pluginNames.push(path.basename(rel));
    searchPlugin(rel, buf);
    return;
  }
  if (buf.indexOf(0) < 0) {
    text++;
    const s = withoutPem(buf.toString('utf8'));
    ALL.lastIndex = 0;
    while ((m = ALL.exec(s)) !== null) hits.push(rel + ':' + lineOf(s, m.index) + '  ' + JSON.stringify(m[0]));
    return;
  }
  binary++;
  // Folded to lower case byte by byte (A to Z only), then searched natively
  // for every spelling, as single bytes and as UTF-16: a string of a large
  // video is slow to build and search with a regular expression.
  const low = Buffer.from(buf);
  for (let i = 0; i < low.length; i++) if (low[i] >= 65 && low[i] <= 90) low[i] += 32;
  const forms = SPELLINGS.concat([SHORT6]).concat(MEDIA.test(rel) ? [] : [SHORT3]);
  forms.forEach(function (sp) {
    if (low.indexOf(Buffer.from(sp, 'latin1')) >= 0) hits.push(rel + ' (binary, as bytes)');
    if (low.indexOf(Buffer.from(sp, 'utf16le')) >= 0) hits.push(rel + ' (binary, as UTF-16)');
  });
});

yes('read the tracked text files (' + text + '), plugins (' + plugins + ') and other binary files (' + binary + ')',
    text > 100 && pluginNames.indexOf('Thornswood-Content.esp') >= 0 && tracked.indexOf('game/data/last-plugin.recipe') >= 0 && binary > 0);
const last = require('./last-plugin-made.js').made();
if (last.buf) { searchPlugin('Thornswood-Last.esp (made from game/data/last-plugin.recipe)', last.buf); yes('read Thornswood-Last.esp, made from its recipe', true); }
else { console.log('SKIP  Thornswood-Last.esp: ' + last.why); }
hits.forEach(function (h) { console.log('      ' + h); });
yes('no tracked file names the server the content plugin was salvaged from, or its short forms (' + hits.length + ' found)', hits.length === 0);

// The plugin reader finds a short form inside a compressed record, where a
// byte search of the file cannot see it.
{
  const edid = Buffer.from('EDID\x0b\x00' + c(75) + SHORT3.slice(1) + 'Example\x00', 'latin1');
  const packed = zlib.deflateSync(edid);
  const rec = Buffer.alloc(24 + 4 + packed.length);
  rec.write('MISC', 0, 'latin1'); rec.writeUInt32LE(4 + packed.length, 4); rec.writeUInt32LE(0x00040000, 8);
  rec.writeUInt32LE(edid.length, 24); packed.copy(rec, 28);
  const grup = Buffer.alloc(24); grup.write('GRUP', 0, 'latin1'); grup.writeUInt32LE(24 + rec.length, 4); grup.write('MISC', 8, 'latin1');
  const head = Buffer.alloc(24); head.write('TES4', 0, 'latin1');
  const planted = Buffer.concat([head, grup, rec]);
  yes('a short form inside a compressed record is invisible to a byte search',
      planted.toString('latin1').toLowerCase().indexOf(SHORT3) < 0);
  const s = pluginText(planted);
  yes('  and found by the plugin reader', s !== null && new RegExp(ALL_SRC, 'i').test(s));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
