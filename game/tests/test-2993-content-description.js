// test-2993-content-description.js
//
// Issue #2993. Thornswood-Content.esp's header carries a description (SNAM),
// which Vortex and other mod tools show beside the plugin. It was one sentence
// typed into Add-ContentRecords.py, and nothing held it to the plugin: on 21
// October it still listed the skill manuals, which left on 21 September, and
// named neither the woodworking bench, the furniture, the teas, the well and
// water buckets nor the burnt and fine meals. Since #2993 the tool builds the
// description from the records the plugin holds, a row of CONTENTS for each
// kind of record.
//
// This proves:
//
//   1. the committed plugin's description is the one the tool builds from its
//      records, it fits the 512
//      bytes the format gives it, and it names no skill manual;
//   2. every record of the committed plugin is named by a row, and every row
//      with words that names a record puts its words in the description;
//   3. a row whose records have all left drops out of the description by
//      itself, and a kind of record no row names comes back unnamed;
//   4. the header the tool writes (#5191: it writes the whole plugin from
//      its sources) is the committed header byte for byte, given its
//      records; and with no game to copy from, the tool writes nothing.
//
// The tool's output goes to a temporary folder (TEST_TMP if set) and is
// removed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');
const COMPRESSED = 0x00040000;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function subsOf(d) {
  const out = [];
  let i = 0, big = null;
  while (i + 6 <= d.length) {
    const tag = d.toString('latin1', i, i + 4);
    let size = d.readUInt16LE(i + 4);
    if (tag === 'XXXX') { big = d.readUInt32LE(i + 6); i += 6 + size; continue; }
    if (big !== null) { size = big; big = null; }
    out.push({ tag, body: d.subarray(i + 6, i + 6 + size) });
    i += 6 + size;
  }
  return out;
}
function records(buf) {
  const out = [];
  function walk(start, end) {
    let p = start;
    while (p + 24 <= end) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8);
      let data = buf.subarray(p + 24, p + 24 + size);
      if (flags & COMPRESSED) { data = zlib.inflateSync(data.subarray(4)); }
      const edid = subsOf(data).find(s => s.tag === 'EDID');
      out.push({ tag, fid: buf.readUInt32LE(p + 12), edid: edid ? edid.body.toString('latin1').replace(/\0+$/, '') : '' });
      p += 24 + size;
    }
  }
  walk(24 + buf.readUInt32LE(4), buf.length);
  return out;
}
function description(buf) {
  const s = subsOf(buf.subarray(24, 24 + buf.readUInt32LE(4))).find(x => x.tag === 'SNAM');
  return s ? s.body.toString('latin1').replace(/\0+$/, '') : null;
}
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8' });
    if (!p.error) { return p; }
  }
  return null;
}

const shipped = fs.readFileSync(ESP);
const recs = records(shipped);
const said = description(shipped);
const keys = recs.map(r => r.tag + ' ' + r.edid);

// The tool's own CONTENTS and description_of, asked about a list of keys.
const ASK = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
  'acr = importlib.util.module_from_spec(spec); spec.loader.exec_module(acr)',
  'out = []',
  'for keys in json.load(sys.stdin):',
  '    text, unnamed = acr.description_of(keys)',
  '    out.append({"text": text.decode("ascii"), "unnamed": unnamed})',
  'rows = [{"pattern": p, "whose": w, "words": t} for p, w, t in acr.CONTENTS]',
  'print(json.dumps({"answers": out, "rows": rows, "most": acr.DESCRIPTION_MOST}))',
].join('\n');
function ask(lists) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, ['-I', '-c', ASK, TOOL], { input: JSON.stringify(lists), encoding: 'utf8' });
    if (!p.error) { return p.status === 0 ? JSON.parse(p.stdout) : (console.log(p.stdout + p.stderr), null); }
  }
  return null;
}

const without = keys.filter(k => k !== 'BOOK ThornswoodWelcome');
const answer = ask([keys, without, keys.concat(['BOOK ThornswoodSkillManualAlchemy'])]);
yes('python is on this machine and the tool answers', answer !== null);
if (answer) {
  const [all, noWelcome, manual] = answer.answers;
  // --------------------------------------------- 1. the committed plugin --
  yes('1 the committed plugin\'s description is the one the tool builds from its records: ' + JSON.stringify(said),
      said === all.text);
  yes('1 it fits the ' + answer.most + ' bytes the format gives a description, its end included (' +
      (Buffer.byteLength(said || '', 'latin1') + 1) + ')',
      !!said && Buffer.byteLength(said, 'latin1') + 1 <= answer.most);
  yes('1 it names no skill manual, which left the plugin on 21 September', !!said && !/manual/i.test(said));
  yes('1 it is still Thornswood\'s, as #400 asks', !!said && /^Thornswood's crafting and gathering content: /.test(said));

  // ---------------------------------------------------------- 2. the rows --
  yes('2 every record of the committed plugin is named by a row (' + keys.length + ')' +
      (all.unnamed.length ? ': not ' + all.unnamed.join(', ') : ''), all.unnamed.length === 0);
  const rowOf = k => answer.rows.findIndex(r => new RegExp('^(?:' + r.pattern + ')').test(k));
  const used = new Set(keys.map(rowOf));
  const missing = answer.rows.filter((r, i) => used.has(i) && r.words && said.indexOf(r.words) < 0);
  yes('2 each row with words that names a record puts them in the description' +
      (missing.length ? ': not ' + missing.map(r => r.words).join(', ') : ''), missing.length === 0);
  const idle = answer.rows.filter((r, i) => !used.has(i));
  yes('2 and no row is there for nothing' + (idle.length ? ': ' + idle.map(r => r.pattern).join(', ') : ''),
      idle.length === 0);

  // ------------------------------------------------- 3. rows come and go --
  const others = answer.rows.filter((r, i) => used.has(i) && r.words && r.words !== 'the welcome letter');
  yes('3 with the welcome letter gone, its words leave the description: ' + JSON.stringify(noWelcome.text),
      noWelcome.unnamed.length === 0 && noWelcome.text.indexOf('welcome letter') < 0);
  yes('3 and every other row\'s words stay', others.every(r => noWelcome.text.indexOf(r.words) >= 0));
  yes('3 a skill manual back is a kind of record no row names',
      manual.unnamed.length === 1 && manual.unnamed[0] === 'BOOK ThornswoodSkillManualAlchemy');
}

// ------------------------------------------- 4. the header the tool writes --
// The tool writes the plugin from nothing (#5191): its header is the
// description description_of builds, around the plugin's count, author and
// masters. Given the committed records' description and count, it has to be
// the committed header byte for byte.
const HEAD = [
  'import importlib.util, struct, sys',
  'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
  'acr = importlib.util.module_from_spec(spec); spec.loader.exec_module(acr)',
  'raw = open(sys.argv[2], "rb").read()',
  'hs = struct.unpack_from("<I", raw, 4)[0]',
  'count = struct.unpack_from("<i", raw, 24 + 6 + 4)[0]',
  'keys = [r.tag.decode() + " " + r.editor_id() for r in acr.every_record(acr.parse(raw, 24 + hs, len(raw)))]',
  'text, unnamed = acr.description_of(keys)',
  'print("same" if acr.header(text, count) == raw[:24 + hs] and not unnamed else "differs")',
].join('\n');
const head = python(['-I', '-c', HEAD, TOOL, ESP]);
if (head && head.status !== 0) { console.log(head.stdout + head.stderr); }
yes('4 the header the tool writes around that description is the committed header, byte for byte',
    !!head && head.status === 0 && head.stdout.trim() === 'same');
const noGame = fs.mkdtempSync(path.join(process.env.TEST_TMP || os.tmpdir(), 'ts-2993-'));
try {
  const out = path.join(noGame, 'Thornswood-Content.esp');
  const stop = python([TOOL, '--masters', noGame, '--out', out]);
  yes('4 with no game to copy from, the tool stops and writes nothing',
      !!stop && stop.status === 1 && /Nothing was written/.test(stop.stdout) && !fs.existsSync(out));
} finally {
  try { fs.rmSync(noGame, { recursive: true, force: true }); } catch (e) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
