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
//   2. the tool (which writes the plugin from its sources since #5191; its
//      refused() is asked, loaded as a module) refuses nothing in the
//      committed plugin, and with no game it writes nothing;
//   3. with the Execution Block's base put back, the tool refuses it as a
//      salvaged record;
//   5. the header's description is Thornswood's own and the other server's
//      full name is nowhere in the committed plugin (Patrick, 12 Oct, B), and
//      the tool sees it in a header whose description still names it;
//   6. with a short name planted in an editor id, or the longer one in a
//      model path, the tool refuses it and says where it is.
//
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
// carry it; tests\test-other-server-name-gone.js reads every tracked file.
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
  for (const exe of ['python', 'py', 'python3']) {
    const r = spawnSync(exe, args, { encoding: 'utf8' });
    if (!r.error) { return r; }
  }
  return null;
}
// The tool writes the plugin from nothing (#5191), so what it refuses is
// asked of its own refused() and other_server_in_header(), loaded as a
// module, over a plugin given on stdin: the lines that would stop it.
const ASK = [
  'import importlib.util, json, struct, sys',
  'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'raw = sys.stdin.buffer.read()',
  'hs = struct.unpack_from("<I", raw, 4)[0]',
  'recs = list(m.every_record(m.parse(raw, 24 + hs, len(raw))))',
  'print(json.dumps({"refused": m.refused(recs, m.read_register(list(m.PLUGIN_MASTERS))),',
  '                  "header": m.other_server_in_header(raw[:24 + hs])}))',
].join('\n');
function ask(buf) {
  for (const exe of ['python', 'py', 'python3']) {
    const r = spawnSync(exe, ['-c', ASK, TOOL], { input: buf, encoding: 'utf8', maxBuffer: 1 << 26 });
    if (!r.error) { return r.status === 0 ? JSON.parse(r.stdout) : (console.log(r.stdout + r.stderr), null); }
  }
  return null;
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-content-names-'));
try {
  const plain = ask(shipped);
  yes('python is on this machine and the tool answers', plain !== null);
  if (plain) {
    yes('the tool refuses nothing in the committed plugin', plain.refused.length === 0 && !plain.header);
    if (plain.refused.length) { console.log(plain.refused.join('\n')); }
    const out = path.join(dir, 'Thornswood-Content.esp');
    const stop = python([TOOL, '--masters', path.join(dir, 'no-game'), '--out', out]);
    yes('with no game to copy from, the tool stops and writes nothing', !!stop && stop.status === 1 && !fs.existsSync(out));

    // ------------------------------------ 3. the block put back ----------
    // The block is a salvaged record (#2553). Among what the tool would write,
    // it stops the tool.
    const back = ask(fixture);
    yes('with the Execution Block put back the tool refuses it as a salvaged record',
        !!back && back.refused.some(l => /^FURN 0x5DF7B34 ThornswoodExecutionerChoppingBlock is a salvaged record$/.test(l)));

    // ------------------------------------------- 5. the header's description --
    // The committed plugin as it was before 15 October: the description named
    // the server the records were salvaged from. The tool writes the
    // description from its records (#2993), and a header that names the
    // other server stops it.
    const oldText = 'Crafting and gathering content salvaged from ' +
      OTHER_NAME.charAt(0).toUpperCase() + OTHER_NAME.slice(1) +
      ' Online. Stations, salt, ore, charcoal kilns, the skill manuals and their recipes.';
    const named = withDescription(shipped, oldText);
    const was = readPlugin(named);
    yes('a copy whose description names the other server could be made',
        description(was.head) === oldText && was.ends && everyByte(was).indexOf(OTHER_NAME) >= 0);
    const h = ask(named);
    yes('the tool sees the other server in that header', !!h && h.header === true);

    // ------------------------------------------- 6. a short name planted --
    // A short name planted in a record has to stop the tool, which says
    // where it is. Planted in place, the same length, so every size in the
    // file stays right.
    function plantIn(tagWanted, choose, word) {
      const buf = Buffer.from(shipped);
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
    const plants = [
      ['EDID', (t) => /^Thornswood/.test(t), cap(SHORT3), 'an editor id'],
      ['MODL', (t, r) => !!edid(r), SHORT6, 'a model path'],
    ];
    for (const [tag, choose, word, kind] of plants) {
      const planted = plantIn(tag, choose, word);
      yes('a copy with a short name planted in ' + kind + ' could be made' + (planted ? ' (' + planted.what + ', ' + planted.was + ')' : ''),
          !!planted && readPlugin(planted.buf).ends);
      if (!planted) { continue; }
      const s6 = ask(planted.buf);
      yes('  the tool refuses it and says which record carries it',
          !!s6 && s6.refused.length > 0 && s6.refused.every(l => l.indexOf(planted.what + ' ') === 0) &&
          s6.refused.some(l => l.indexOf('carries the other server\'s name') >= 0));
    }
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
