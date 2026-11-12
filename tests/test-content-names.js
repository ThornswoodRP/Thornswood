// test-content-names.js
//
// Issue #400. Thornswood-Content.esp came from another server, and that
// server's short names (a three letter prefix, and a six letter one with two
// letters in front) were on 33 editor ids and one script. The editor ids were
// renamed on 21 September by a script that did that one job and is gone. The
// script, named with the three letter prefix, was attached by a VMAD to FURN
// 0x05DF7B34, the headsman's block placed once in Solitude (REFR 0x05DFCC75).
// It never shipped, so it never ran. Patrick, 28 Sep: "3. Take it out of
// Solitude." So scripts\mods\Add-ContentRecords.py takes the placed block out
// of its cell and, since nothing else names it, the block's base record too.
// Patrick, 15 Oct, decision C: the short names go from everything, so they are
// written here as code points, and the fixture's script is OtherServerChop.
//
// Since #2553 the tool writes the plugin's records from its own numbers and
// refuses any salvaged record the register does not say stays, the block
// included, so the block's own removal step is gone from it.
//
// This reads the plugin with its own reader, not the tool's, and proves:
//   1. the committed plugin has no editor id, script or string carrying the
//      other server's short names, compressed records included;
//   2. the tool, run over a copy of the committed plugin, writes nothing;
//   3. on a copy with the Execution Block's base put back, the tool refuses
//      it as a salvaged record and writes nothing;
//   5. the header's description is Thornswood's own and the other server's
//      full name is nowhere in the committed plugin (Patrick, 12 Oct, B), and
//      on a copy whose description still names it, the tool writes
//      Thornswood's and changes nothing else;
//   6. on a copy with a short name planted in an editor id, or the longer one
//      in a model path, the tool writes nothing and says where it is.
//
// The copies are written to a temporary folder (TEST_TMP if set) and removed.
// Nothing in the repo is written.
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');

const BLOCK = 0x5DF7B34;        // FURN ThornswoodExecutionerChoppingBlock
const BLOCK_REF = 0x5DFCC75;    // its one placed reference, in Solitude
const SOLITUDE_CELL = 0x37EE9;  // the Skyrim.esm cell it is placed in
const COMPRESSED = 0x00040000;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the reader --
function readPlugin(buf) {
  const headerSize = buf.readUInt32LE(4);
  const head = buf.subarray(0, 24 + headerSize);
  const records = [];
  let ends = true;
  function walk(start, end) {
    let p = start;
    while (p + 24 <= end) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8);
      const fid = buf.readUInt32LE(p + 12);
      const raw = buf.subarray(p + 24, p + 24 + size);
      records.push({ tag, flags, fid, raw, bytes: buf.subarray(p, p + 24 + size) });
      p += 24 + size;
    }
    if (p !== end) { ends = false; }
  }
  walk(24 + headerSize, buf.length);
  return { head, records, ends };
}

function subs(rec) {
  let d = rec.raw;
  if (rec.flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
  const out = [];
  let i = 0;
  while (i + 6 <= d.length) {
    const tag = d.toString('latin1', i, i + 4);
    const size = d.readUInt16LE(i + 4);
    if (i + 6 + size > d.length) { break; }
    out.push({ tag, body: d.subarray(i + 6, i + 6 + size) });
    i += 6 + size;
  }
  return out;
}

// The other server's short names, as code points: the three letter prefix,
// and the six letter one, which its longer spelling contains.
const SHORT3 = String.fromCharCode(107, 122, 108);
const SHORT6 = String.fromCharCode(111, 108, 105, 118, 97, 114);
const OTHER = new RegExp(SHORT3 + '|' + SHORT6, 'i');
function edid(rec) {
  const e = subs(rec).find(s => s.tag === 'EDID');
  return e ? e.body.toString('latin1').replace(/\0+$/, '') : '';
}
// A subrecord that is one string: printable ASCII ending in a zero.
function isText(body) {
  return body.length > 1 && body[body.length - 1] === 0 && /^[ -~]+$/.test(body.toString('latin1', 0, body.length - 1));
}
function otherServer(rec) {
  const found = [];
  for (const s of subs(rec)) {
    const text = s.body.toString('latin1');
    if (!OTHER.test(text)) { continue; }
    if (s.tag === 'EDID') { found.push('editor id ' + text.replace(/\0+$/, '')); }
    else if (s.tag === 'VMAD') { found.push('script ' + text.replace(/[^ -~]+/g, ' ').trim()); }
    else if (isText(s.body) || new RegExp(SHORT6, 'i').test(text)) { found.push(s.tag + ' ' + text.replace(/[^ -~]+/g, ' ').trim()); }
  }
  return found;
}
function hedrCount(head) {
  const at = head.indexOf('HEDR', 0, 'latin1');
  return at < 0 ? null : head.readInt32LE(at + 6 + 4);
}

// ------------------------------------------------------ 1. the committed --
const shipped = fs.readFileSync(ESP);
const committed = readPlugin(shipped);
let before = committed;
// 205 records since #2553 took the salvaged placements out.
yes('the committed plugin reads to its last byte (' + before.records.length + ' records)',
    before.ends && before.records.length > 150);
const badIds = [];
for (const r of committed.records) { for (const w of otherServer(r)) { badIds.push(r.tag + ' 0x' + r.fid.toString(16) + ' ' + w); } }
yes('no editor id, script or string in the committed plugin carries the other server\'s short names (' + before.records.length + ' read, compressed included)',
    badIds.length === 0);
for (const l of badIds) { console.log('      ' + l); }
yes('the shipped plugin no longer contains the execution block or its placement',
    !committed.records.some(r => r.fid === BLOCK || r.fid === BLOCK_REF));

// The header's description (#400, Patrick, 12 Oct: B, and the other server is
// mentioned nowhere). Its name is built from code points so this file does not
// carry it; game\tests\test-other-server-name-gone.js reads every tracked file.
const OTHER_NAME = String.fromCharCode(107, 101, 105, 122, 97, 97, 108);
function headerSubs(head) {
  const out = [];
  let i = 24;
  while (i + 6 <= head.length) {
    const tag = head.toString('latin1', i, i + 4);
    const size = head.readUInt16LE(i + 4);
    out.push({ tag, body: head.subarray(i + 6, i + 6 + size) });
    i += 6 + size;
  }
  return out;
}
function description(head) {
  const s = headerSubs(head).find(x => x.tag === 'SNAM');
  return s ? s.body.toString('latin1').replace(/\0+$/, '') : null;
}
function everyByte(p) {
  let s = p.head.toString('latin1');
  for (const r of p.records) {
    s += (r.flags & COMPRESSED) ? zlib.inflateSync(r.raw.subarray(4)).toString('latin1') : r.raw.toString('latin1');
  }
  return s.toLowerCase();
}
// The same plugin with another description, its header size set to match.
function withDescription(buf, text) {
  const p = readPlugin(buf);
  const parts = [];
  for (const s of headerSubs(p.head)) {
    const body = s.tag === 'SNAM' ? Buffer.concat([Buffer.from(text, 'latin1'), Buffer.alloc(1)]) : s.body;
    const h = Buffer.alloc(6); h.write(s.tag, 0, 'latin1'); h.writeUInt16LE(body.length, 4);
    parts.push(h, body);
  }
  const body = Buffer.concat(parts);
  const head = Buffer.from(p.head.subarray(0, 24));
  head.writeUInt32LE(body.length, 4);
  return Buffer.concat([head, body, buf.subarray(p.head.length)]);
}
const committedDescription = description(committed.head);
yes('the committed plugin\'s header describes it as Thornswood\'s: ' + JSON.stringify(committedDescription),
    !!committedDescription && /^Thornswood's crafting and gathering content: /.test(committedDescription));
yes('the other server\'s name is nowhere in the committed plugin, header and records, compressed included',
    everyByte(committed).indexOf(OTHER_NAME) < 0);

// The Execution Block's base record, put back in a temporary fixture in its
// original group. The fixture bytes are from dbbbbcc396f8, but for the name of
// the script the block's VMAD attaches, which carried the other server's
// prefix and is OtherServerChop since 16 October (#400). Its placement is in
// the fixture too, but the Solitude cell it stood in left the plugin with the
// other salvaged placements (#2553), so only the base can be put back.
const fixtureRecords = require('./fixtures/content-execution-block.json');
function restoreFixture(buf) {
  const inserted = new Set();
  function walk(start, end, groups) {
    const parts = [];
    let p = start;
    while (p < end) {
      const size = buf.readUInt32LE(p + 4);
      if (buf.toString('latin1', p, p + 4) === 'GRUP') {
        const groupPath = groups.concat([[buf.subarray(p + 8, p + 12).toString('hex'), buf.readUInt32LE(p + 12)]]);
        const body = walk(p + 24, p + size, groupPath);
        const header = Buffer.from(buf.subarray(p, p + 24));
        header.writeUInt32LE(24 + body.length, 4);
        parts.push(header, body); p += size;
      } else { parts.push(buf.subarray(p, p + 24 + size)); p += 24 + size; }
    }
    fixtureRecords.forEach((r, i) => {
      if (JSON.stringify(r.groups) === JSON.stringify(groups)) {
        parts.push(Buffer.from(r.bytes, 'hex')); inserted.add(i);
      }
    });
    return Buffer.concat(parts);
  }
  const head = Buffer.from(committed.head);
  const body = walk(head.length, buf.length, []);
  const countAt = head.indexOf('HEDR', 0, 'latin1') + 10;
  head.writeInt32LE(committed.records.length + inserted.size, countAt);
  return { buf: Buffer.concat([head, body]), inserted: inserted.size };
}
const restored = restoreFixture(shipped);
const fixture = restored.buf;
yes('the fixture base record was put back in its original group, and its placement had no cell to go in',
    restored.inserted === 1);
before = readPlugin(fixture);
const block = before.records.find(r => r.fid === BLOCK);
yes('the fixture Execution Block is FURN 0x05DF7B34', block && block.tag === 'FURN' &&
    edid(block) === 'ThornswoodExecutionerChoppingBlock');
yes('the Solitude cell 0x37EE9 it was placed in is not in the committed plugin (#2553)',
    !committed.records.some(r => r.tag === 'CELL' && r.fid === SOLITUDE_CELL));

// ------------------------------------------------------- 2. the tool run --
function python(args) {
  for (const exe of ['python', 'py']) {
    const r = spawnSync(exe, args, { encoding: 'utf8' });
    if (!r.error) { return r; }
  }
  return null;
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-content-names-'));
const copy = path.join(dir, 'Thornswood-Content.esp');
const noGame = path.join(dir, 'no-game');
fs.mkdirSync(noGame);
fs.writeFileSync(copy, shipped);
try {
  const check = python([TOOL, '--data', dir, '--masters', noGame, '--check']);
  yes('python is on this machine', check !== null);
  if (check) {
    yes('--check on the committed plugin exits 0', check.status === 0);
    if (check.status !== 0) { console.log(check.stdout + check.stderr); }
    const run = python([TOOL, '--data', dir, '--masters', noGame]);
    yes('a run over the committed plugin exits 0', run.status === 0);
    yes('and writes nothing: the plugin is what the tool writes', /Nothing was written/.test(run.stdout) &&
        fs.readFileSync(copy).equals(shipped));

    // ------------------------------------ 3. the block put back ----------
    // The block is a salvaged record (#2553). Put back, the tool refuses the
    // plugin and writes nothing, whether or not it had anything else to do.
    fs.writeFileSync(copy, fixture);
    const back = python([TOOL, '--data', dir, '--masters', noGame]);
    yes('with the Execution Block put back the tool exits 1', back.status === 1);
    yes('and says it is a salvaged record', /FURN 0x5DF7B34 ThornswoodExecutionerChoppingBlock is a salvaged record/.test(back.stdout));
    yes('and writes nothing', fs.readFileSync(copy).equals(fixture));

    // ------------------------------------------- 5. the header's description --
    // The committed plugin as it was before 15 October: the description named
    // the server the records were salvaged from. The tool writes Thornswood's
    // own and touches nothing else.
    const oldText = 'Crafting and gathering content salvaged from ' +
      OTHER_NAME.charAt(0).toUpperCase() + OTHER_NAME.slice(1) +
      ' Online. Stations, salt, ore, charcoal kilns, the skill manuals and their recipes.';
    const named = withDescription(shipped, oldText);
    const was = readPlugin(named);
    yes('a copy whose description names the other server could be made',
        description(was.head) === oldText && was.ends && everyByte(was).indexOf(OTHER_NAME) >= 0);
    fs.writeFileSync(copy, named);
    const h = python([TOOL, '--data', dir]);
    yes('the tool exits 0 on it', h.status === 0);
    if (h.status !== 0) { console.log(h.stdout + h.stderr); }
    yes('and says the description changes', /its description becomes: Thornswood's crafting/.test(h.stdout));
    const ha = readPlugin(fs.readFileSync(copy));
    yes('the result reads to its last byte', ha.ends);
    yes('its description is Thornswood\'s, the same as the committed plugin\'s',
        description(ha.head) === committedDescription);
    yes('the other server\'s name is nowhere in it', everyByte(ha).indexOf(OTHER_NAME) < 0);
    const rest = x => headerSubs(x).filter(s => s.tag !== 'SNAM').map(s => s.tag + s.body.toString('hex')).join('|');
    yes('every other subrecord of the header is as it was, masters and record count included',
        rest(ha.head) === rest(was.head) && ha.head.subarray(8, 24).equals(was.head.subarray(8, 24)));
    yes('every record is byte for byte what it was (' + was.records.length + ')',
        ha.records.length === was.records.length && ha.records.every((r, i) => r.bytes.equals(was.records[i].bytes)));
    yes('the result is the committed plugin exactly', fs.readFileSync(copy).equals(shipped));
    const h2 = python([TOOL, '--data', dir]);
    yes('a second run changes nothing', h2.status === 0 && fs.readFileSync(copy).equals(shipped));

    // ------------------------------------------- 6. a short name planted --
    // The old description makes the tool write; a short name planted in a
    // record it does not touch has to stop it. Planted in place, the same
    // length, so every size in the file stays right.
    const toolText = fs.readFileSync(TOOL, 'latin1');
    function plantIn(tagWanted, choose, word) {
      const buf = withDescription(shipped, oldText);
      const p = readPlugin(buf);
      for (const r of p.records) {
        if (r.flags & COMPRESSED) { continue; }
        let i = 0;
        while (i + 6 <= r.raw.length) {
          const t = r.raw.toString('latin1', i, i + 4);
          const size = r.raw.readUInt16LE(i + 4);
          const text = r.raw.toString('latin1', i + 6, i + 6 + size).replace(/\0+$/, '');
          if (t === tagWanted && text.length > word.length && choose(text, r)) {
            const at = r.raw.byteOffset - buf.byteOffset + i + 6;
            buf.write(word, at, 'latin1');
            return { buf, what: r.tag + ' 0x' + r.fid.toString(16).toUpperCase(), was: text };
          }
          i += 6 + size;
        }
      }
      return null;
    }
    const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
    // Records the tool names are left alone, so the plant is in one it does
    // not touch.
    const leftAlone = (r) => toolText.indexOf(edid(r)) < 0 && toolText.indexOf(r.fid.toString(16).toUpperCase()) < 0;
    const plants = [
      ['EDID', (t, r) => /^Thornswood/.test(t) && leftAlone(r), cap(SHORT3), 'an editor id'],
      ['MODL', (t, r) => !!edid(r) && leftAlone(r), SHORT6, 'a model path'],
    ];
    for (const [tag, choose, word, kind] of plants) {
      const planted = plantIn(tag, choose, word);
      yes('a copy with a short name planted in ' + kind + ' could be made' + (planted ? ' (' + planted.what + ', ' + planted.was + ')' : ''),
          !!planted && readPlugin(planted.buf).ends);
      if (!planted) { continue; }
      fs.writeFileSync(copy, planted.buf);
      const s6 = python([TOOL, '--data', dir]);
      yes('  the tool exits 1 on it', s6.status === 1);
      yes('  and says which record still carries it', s6.stdout.indexOf(planted.what + ' still carries') >= 0);
      yes('  and writes nothing', fs.readFileSync(copy).equals(planted.buf));
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
