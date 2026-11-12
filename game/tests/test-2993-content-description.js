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
//      records (the tool's --check has nothing to write), it fits the 512
//      bytes the format gives it, and it names no skill manual;
//   2. every record of the committed plugin is named by a row, and every row
//      with words that names a record puts its words in the description;
//   3. a row whose records have all left drops out of the description by
//      itself, and a kind of record no row names comes back unnamed;
//   4. the tool, given a copy of the plugin with a kind of record no row
//      names, stops, says which record, and writes nothing.
//
// Copies go to a temporary folder (TEST_TMP if set) and are removed.

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

// ------------------------------------------------------- 4. the tool, run --
function withRecord(tag, fid, subs) {
  const body = Buffer.concat(subs.map(([t, s]) => {
    const v = Buffer.from(s + '\0', 'latin1');
    const h = Buffer.alloc(6); h.write(t, 0, 'latin1'); h.writeUInt16LE(v.length, 4);
    return Buffer.concat([h, v]);
  }));
  const rh = Buffer.alloc(24);
  rh.write(tag, 0, 'latin1'); rh.writeUInt32LE(body.length, 4); rh.writeUInt32LE(fid >>> 0, 12); rh.writeUInt16LE(44, 20);
  const gh = Buffer.alloc(24);
  gh.write('GRUP', 0, 'latin1'); gh.writeUInt32LE(24 + 24 + body.length, 4); gh.write(tag, 8, 'latin1');
  return Buffer.concat([shipped, gh, rh, body]);
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-2993-'));
try {
  const noGame = path.join(dir, 'no-game');
  fs.mkdirSync(noGame);
  const copy = path.join(dir, 'Thornswood-Content.esp');
  const check = python([TOOL, '--data', path.dirname(ESP), '--masters', noGame, '--check']);
  yes('4 the tool\'s --check on the committed plugin leaves the description as it is',
      !!check && check.status === 0 && /its description already reads as this tool writes it/.test(check.stdout));
  const planted = withRecord('ACTI', 0x050150F0, [['EDID', 'ThornswoodActivatorSkillManual'], ['FULL', 'Skill Manual']]);
  fs.writeFileSync(copy, planted);
  const stop = python([TOOL, '--data', dir, '--masters', noGame]);
  yes('4 a copy with a kind of record no row names: the tool stops',
      !!stop && stop.status === 1 && /STOP\. 1 record\(s\) the plugin would hold are named by no row of CONTENTS/.test(stop.stdout));
  yes('4 and says which record', !!stop && /^  ACTI ThornswoodActivatorSkillManual\r?$/m.test(stop.stdout));
  if (stop && stop.status !== 1) { console.log(stop.stdout + stop.stderr); }
  yes('4 and writes nothing', fs.readFileSync(copy).equals(planted));
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
