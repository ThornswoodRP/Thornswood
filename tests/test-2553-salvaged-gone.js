// test-2553-salvaged-gone.js
//
// Issue #2553. Thornswood-Content.esp came with records salvaged from another
// server's plugin, and no permission from that server's makers is recorded.
// Patrick, 15 October 2026, option B on #2177: the salvaged records are remade
// as Thornswood's own and the salvaged ones removed.
//
// scripts\mods\content-salvaged.json (written by
// scripts\mods\List-SalvagedRecords.py) lists every salvaged record, what
// became of it, and the sha256 of every version of it the repository held
// (its subrecords, inflated, editor id left out). This reads the committed
// plugin with its own reader and proves:
//
//   1. no record in it is a salvaged record: none has the bytes of any
//      salvaged version, under any editor id, but the six recipes every
//      field of which Thornswood's rulebook states, each rebuilt here from
//      its page's table row, and the register keeps nothing waiting;
//   2. nothing the register says goes, or went before #2553, is there, and
//      every record it says is remade is, of the same type;
//   3. the placements are exactly game/data/station-sites.json's, Thornswood's
//      own spots for the kiln, the salt quarry, the hive and the lab (Patrick,
//      A on #2553), each at its point and turn in its cell;
//   4. every record the tool writes from its own numbers is the committed
//      record byte for byte, and with no game to copy from it writes nothing;
//   5. where the repository's history is here (not a shallow clone), the
//      register's sources are those commits' plugins, byte for byte, and its
//      salvaged set and hashes are what they give.
//
// Copies go to a temporary folder (TEST_TMP if set) and are removed.

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');
const REGISTER = path.join(ROOT, 'scripts', 'mods', 'content-salvaged.json');
const COMPRESSED = 0x00040000;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------ the reader --
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
function readPlugin(buf) {
  const headerSize = buf.readUInt32LE(4);
  const masters = subsOf(buf.subarray(24, 24 + headerSize)).filter(s => s.tag === 'MAST')
    .map(s => s.body.toString('latin1').replace(/\0+$/, ''));
  const records = [];
  let ends = true;
  function walk(start, end, groups) {
    let p = start;
    while (p + 24 <= end) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') {
        walk(p + 24, p + size, groups.concat([[buf.readUInt32LE(p + 8), buf.readInt32LE(p + 12)]]));
        p += size; continue;
      }
      const flags = buf.readUInt32LE(p + 8);
      const fid = buf.readUInt32LE(p + 12);
      let data = buf.subarray(p + 24, p + 24 + size);
      if (flags & COMPRESSED) { data = zlib.inflateSync(data.subarray(4)); }
      records.push({ tag, flags, fid, data, subs: subsOf(data), groups });
      p += 24 + size;
    }
    if (p !== end) { ends = false; }
  }
  walk(24 + headerSize, buf.length, []);
  return { masters, records, ends };
}
// The register's hash: the subrecords without the editor id, each as its tag,
// a four byte length and its bytes.
function bodyHash(rec) {
  const parts = [];
  for (const s of rec.subs) {
    if (s.tag === 'EDID') { continue; }
    const h = Buffer.alloc(8); h.write(s.tag, 0, 'latin1'); h.writeUInt32LE(s.body.length, 4);
    parts.push(h, s.body);
  }
  return crypto.createHash('sha256').update(Buffer.concat(parts)).digest('hex');
}
function edid(rec) {
  const e = rec.subs.find(s => s.tag === 'EDID');
  return e ? e.body.toString('latin1').replace(/\0+$/, '') : '';
}
const hex = n => '0x' + (n >>> 0).toString(16).toUpperCase().padStart(8, '0');

const reg = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
const shipped = fs.readFileSync(ESP);
const plugin = readPlugin(shipped);
yes('the committed plugin reads to its last byte (' + plugin.records.length + ' records)', plugin.ends);
yes('the register is #2553\'s, built by List-SalvagedRecords.py, with ' + reg.records.length + ' salvaged records',
    reg.issue === 2553 && reg.builtBy === 'scripts/mods/List-SalvagedRecords.py' && reg.records.length > 300);

const names = plugin.masters.map(m => m.toLowerCase());
function localFid(desc) {
  const [obj, owner] = desc.split(':');
  const i = owner.toLowerCase() === 'thornswood-content.esp' ? names.length : names.indexOf(owner.toLowerCase());
  return ((i << 24) | parseInt(obj, 16)) >>> 0;
}
const byHash = new Map();
const row = new Map();
for (const r of reg.records) {
  const fid = localFid(r.formId);
  row.set(fid, r);
  for (const h of r.dataSha256) { byHash.set(h, fid); }
}
const counts = {};
for (const r of reg.records) { const k = r.type + ' ' + r.disposition; counts[k] = (counts[k] || 0) + 1; }
const sorted = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
yes('the register\'s counts are its rows', sorted(counts) === sorted(reg.counts));

// ------------------------------------- 6 recipes the rulebook states ------
// Every field of these is a fact a rulebook page's table states, so they come
// out the bytes the plugin held. Each is rebuilt here from its page's row.
const ITEMS = {
  'firewood': 0x0006F993, 'iron ingot': 0x0005ACE4, 'tool handle': 0x05015490,
  'poor charcoal': 0x05015481, 'charcoal': 0x05015482, 'charcoal briquette': 0x05015484, 'coke': 0x05015485,
  'pickaxe': 0x000E3C16, "woodcutter's axe": 0x0002F2F4,
};
const KILN = 0x0501547F, FORGE = 0x00088105;
const pages = {
  charburner: fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'professions', 'woodworker', 'charburner.md'), 'utf8'),
  edgewright: fs.readFileSync(path.join(ROOT, 'docs', 'systems', 'professions', 'smith', 'edgewright.md'), 'utf8'),
};
function fromCharburner(name) {
  // | Poor Charcoal | Novice | 2 firewood | 1 |
  const m = pages.charburner.match(new RegExp('^\\| ' + name + ' \\| \\w+ \\| (\\d+) firewood \\| (\\d+) \\|$', 'm'));
  return m && { inputs: [[ITEMS.firewood, +m[1]]], out: ITEMS[name.toLowerCase()], bench: KILN, makes: +m[2] };
}
function fromEdgewright(name) {
  // | Pickaxe | 1 | novice | War axes | SmithingForge | 1 Iron Ingot, 1 Tool Handle |  | yes | `1548d:...` |
  const m = pages.edgewright.match(new RegExp('^\\| ' + name + ' \\| (\\d+) \\| \\w+ \\| [^|]+ \\| SmithingForge \\| ([^|]+) \\|', 'm'));
  if (!m) { return null; }
  const inputs = m[2].trim().split(', ').map(part => {
    const k = part.match(/^(\d+) (.+)$/);
    return k && ITEMS[k[2].toLowerCase()] ? [ITEMS[k[2].toLowerCase()], +k[1]] : null;
  });
  return inputs.every(Boolean) && { inputs, out: ITEMS[name.toLowerCase()], bench: FORGE, makes: +m[1] };
}
const DESIGN = {
  0x05015480: () => fromCharburner('Poor Charcoal'), 0x05015486: () => fromCharburner('Charcoal'),
  0x05015487: () => fromCharburner('Charcoal Briquette'), 0x05015488: () => fromCharburner('Coke'),
  0x0501548D: () => fromEdgewright('Pickaxe'), 0x0501548E: () => fromEdgewright("Woodcutter's Axe"),
};
function recipeBody(d) {
  const sub = (tag, body) => { const h = Buffer.alloc(6); h.write(tag, 0, 'latin1'); h.writeUInt16LE(body.length, 4); return Buffer.concat([h, body]); };
  const u32 = v => { const b = Buffer.alloc(4); b.writeUInt32LE(v >>> 0, 0); return b; };
  const parts = [sub('COCT', u32(d.inputs.length))];
  for (const [item, count] of d.inputs) { parts.push(sub('CNTO', Buffer.concat([u32(item), u32(count)]))); }
  const nam1 = Buffer.alloc(2); nam1.writeUInt16LE(d.makes, 0);
  parts.push(sub('CNAM', u32(d.out)), sub('BNAM', u32(d.bench)), sub('NAM1', nam1));
  return Buffer.concat(parts);
}
// The winning master's own hash of each cell or worldspace kept as Bethesda's.
const bethesdaOwn = new Map(reg.records.filter(r => r.bethesdaSha256).map(r => [localFid(r.formId), r.bethesdaSha256]));
const byDesign = new Set();
for (const r of reg.records) {
  if (!r.sameByDesign) { continue; }
  const fid = localFid(r.formId);
  const rec = plugin.records.find(x => x.fid === fid);
  const want = DESIGN[fid] && DESIGN[fid]();
  const rest = rec && Buffer.concat(rec.subs.filter(s => s.tag !== 'EDID').map(s => {
    const h = Buffer.alloc(6); h.write(s.tag, 0, 'latin1'); h.writeUInt16LE(s.body.length, 4); return Buffer.concat([h, s.body]);
  }));
  const ok = !!rec && rec.tag === 'COBJ' && !!want && rest.equals(recipeBody(want));
  yes('S ' + (rec ? edid(rec) : hex(fid)) + ' is field for field the row its page states (' + r.sameByDesign.split(':')[0] + ')', ok);
  if (ok) { byDesign.add(fid); }
}
yes('the register names exactly the six recipes the rulebook states', byDesign.size === 6 &&
    Object.keys(DESIGN).length === 6 && reg.records.filter(r => r.sameByDesign).length === 6);

// ------------------------------------------------- 1. nothing salvaged ----
yes('1 the register keeps nothing salvaged waiting on anything (Patrick, A on #2553)',
    reg.records.every(r => ['dropped', 'remade', "Bethesda's", 'gone before #2553'].indexOf(r.disposition) >= 0));
const left = [];
for (const r of plugin.records) {
  const h = bodyHash(r);
  if (!byHash.has(h)) { continue; }
  if (byDesign.has(r.fid)) { continue; }
  // A cell or worldspace kept as Bethesda's that is the winning master's own
  // bytes, which the salvaged copy happened to be as well (#1382).
  if (bethesdaOwn.get(r.fid) === h) { continue; }
  left.push(r.tag + ' ' + hex(r.fid) + ' ' + edid(r) + ', the bytes of salvaged ' + hex(byHash.get(h)));
}
yes('1 no record is a salvaged record, under any editor id, but the six by design', left.length === 0);
for (const l of left) { console.log('      ' + l); }

// ---------------------------------------------- 2. what goes is gone ------
const here = new Map(plugin.records.map(r => [r.fid, r]));
const stillHere = reg.records.filter(r => (r.disposition === 'dropped' || r.disposition === 'gone before #2553') &&
                                          here.has(localFid(r.formId)));
yes('2 nothing the register says goes, or went before #2553, is in the plugin (' +
    reg.records.filter(r => r.disposition === 'dropped').length + ' dropped, ' +
    reg.records.filter(r => r.disposition === 'gone before #2553').length + ' gone before)', stillHere.length === 0);
for (const r of stillHere) { console.log('      ' + r.type + ' ' + r.formId); }
const theirs = reg.records.filter(r => r.type === 'REFR' && /placements of Thornswood's/.test(r.why || ''));
yes('2 the other server\'s 57 placements of the four stations are among what goes',
    theirs.length === 57 && theirs.every(r => r.disposition === 'dropped' && !here.has(localFid(r.formId))));
const remade = reg.records.filter(r => r.disposition === 'remade');
yes('2 every record the register says is remade is there, the same type (' + remade.length + ')',
    remade.every(r => here.has(localFid(r.formId)) && here.get(localFid(r.formId)).tag === r.type));
const bethesdas = reg.records.filter(r => r.disposition === "Bethesda's");
yes('2 every cell and world the register keeps is there and holds a placement (' + bethesdas.length + ')',
    bethesdas.every(r => here.has(localFid(r.formId)) && plugin.records.some(x => x.tag === 'REFR' &&
      x.groups.some(g => g[0] === localFid(r.formId) && (g[1] === 1 || g[1] === 6 || g[1] === 8 || g[1] === 9)))));

// ------------------------------- 3. the placements are Thornswood's own --
// Every placement is one game/data/station-sites.json measures (written by
// scripts/dev/Build-StationSites.py), at its point and turn, in its cell.
// The kiln, the lab, the hive, the salt quarry, the well and water buckets (#1382), and the study desk (#1387).
const STATIONS = new Set([0x05042E69, 0x0501547E, 0x05DBF8B3, 0x05DDE4EF, 0x05018030, 0x05018031, 0x05018032]);
const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'station-sites.json'), 'utf8'));
const sites = Object.keys(table.sites).map(k => table.sites[k]);
const allRefs = plugin.records.filter(r => r.tag === 'REFR');
const questSites = Object.values(JSON.parse(fs.readFileSync(path.join(ROOT, 'game/data/quest-content.json'), 'utf8')).sites);
const questIds = new Set(questSites.map(s => localFid(s.ref)));
const refs = allRefs.filter(r => !questIds.has(r.fid));
const bySite = new Map(sites.map(s => [localFid(s.ref), s]));
const declaredIds = new Set([...bySite.keys(), ...questIds]);
yes('3 every placement is exactly a declared station or dedicated quest source',
    allRefs.length === declaredIds.size && allRefs.every(r => declaredIds.has(r.fid)) &&
    new Set(allRefs.map(r => r.fid)).size === allRefs.length);
yes('3 the placements in the plugin are exactly the station table\'s ' + sites.length,
    sites.length > 0 && refs.length === sites.length && refs.every(r => bySite.has(r.fid)));
yes('3 each is of the kiln, the salt quarry, the hive, the lab or the well bucket, switched on, the table\'s base',
    refs.every(r => {
      const n = r.subs.find(s => s.tag === 'NAME');
      const s = bySite.get(r.fid);
      return n && STATIONS.has(n.body.readUInt32LE(0)) && !(r.flags & 0x800) && s && n.body.readUInt32LE(0) === localFid(s.base);
    }));
yes('3 each stands at the table\'s point and turn, in the table\'s cell',
    refs.every(r => {
      const s = bySite.get(r.fid);
      const d = r.subs.find(x => x.tag === 'DATA');
      if (!s || !d || d.body.length !== 24) { return false; }
      const v = [0, 1, 2, 3, 4, 5].map(i => d.body.readFloatLE(i * 4));
      const f32 = x => Math.fround(x);
      return v[0] === f32(s.pos[0]) && v[1] === f32(s.pos[1]) && v[2] === f32(s.pos[2]) && v[3] === 0 && v[4] === 0 &&
        v[5] === f32(s.angle * Math.PI / 180) && r.groups.some(g => g[0] === localFid(s.cell) && g[1] === 9);
    }));
yes('3 no placement carries anything but its base and where it stands',
    refs.every(r => r.subs.map(x => x.tag).join(',') === 'NAME,DATA'));
const byStation = {};
for (const r of refs) { const b = r.subs.find(s => s.tag === 'NAME').body.readUInt32LE(0); byStation[hex(b)] = (byStation[hex(b)] || 0) + 1; }
console.log('      ' + JSON.stringify(byStation));

// --------------------------------------------------- 4. the tool's own ---
function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8' });
    if (!p.error) { return p; }
  }
  return null;
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-2553-'));
try {
  // The tool writes the plugin from nothing (#5191); the records it writes
  // from its own numbers have to be the committed ones, so what 1 to 3 prove
  // of the committed plugin is true of what the tool writes.
  const run = python(['-c', [
    'import importlib.util, struct, sys',
    'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'raw = open(sys.argv[2], "rb").read()',
    'hs = struct.unpack_from("<I", raw, 4)[0]',
    'have = dict((x.fid, x.bytes()) for x in m.every_record(m.parse(raw, 24 + hs, len(raw))))',
    'made = m.thornswood_records(m.clam01(), []) + m.seasonal_records()',
    'off = [r for r in made if have.get(r.fid) != r.bytes()]',
    'print("%d made, %d not the committed record%s" % (len(made), len(off), "".join(" 0x%07X" % r.fid for r in off)))',
  ].join('\n'), TOOL, ESP]);
  yes('4 python is on this machine and the tool loads as a module', !!run && run.status === 0);
  if (run && run.status !== 0) { console.log(run.stdout + run.stderr); }
  if (run && run.status === 0) {
    yes('4 every record the tool writes from its own numbers is the committed record byte for byte: ' + run.stdout.trim(),
        / 0 not the committed record$/.test(run.stdout.trim()) && !/^0 made/.test(run.stdout));
  }
  const noGame = path.join(dir, 'no-game');
  fs.mkdirSync(noGame);
  const out = path.join(dir, 'Thornswood-Content.esp');
  const stop = python([TOOL, '--masters', noGame, '--out', out]);
  yes('4 with no game to copy from, the tool stops and writes nothing',
      !!stop && stop.status !== 0 && /Nothing was written/.test(stop.stdout) && !fs.existsSync(out));

  // ------------------------------------------- 5. the history, if here ---
  const git = (args, enc) => spawnSync('git', ['-C', ROOT].concat(args), { encoding: enc || 'utf8', maxBuffer: 1 << 28 });
  const have = reg.sources.every(s => git(['cat-file', '-e', s.commit + ':' + s.path]).status === 0);
  if (!have) {
    console.log('SKIP  5: this clone does not have the plugin\'s history (a shallow clone); List-SalvagedRecords.py --history --check on a full one');
  } else {
    const blobs = reg.sources.map(s => git(['show', s.commit + ':' + s.path], 'buffer').stdout);
    yes('5 every source in the register is that commit\'s plugin, byte for byte (' + blobs.length + ')',
        blobs.every((b, i) => crypto.createHash('sha256').update(b).digest('hex') === reg.sources[i].sha256));
    const first = readPlugin(blobs[0]);
    const salvaged = first.records.filter(r => !(r.fid >= 0x05E80000 && r.fid <= 0x05E8FFFF));
    const ids = new Set(salvaged.map(r => r.fid));
    yes('5 the salvaged set is the 13 September copy\'s records outside Thornswood\'s own 0x05E8 range (' + ids.size + ')',
        ids.size === reg.records.length && reg.records.every(r => ids.has(localFid(r.formId))));
    const hashes = new Map([...ids].map(f => [f, []]));
    for (const b of blobs) {
      for (const r of readPlugin(b).records) {
        if (!ids.has(r.fid)) { continue; }
        const h = bodyHash(r);
        if (hashes.get(r.fid).indexOf(h) < 0) { hashes.get(r.fid).push(h); }
      }
    }
    yes('5 every salvaged record\'s hashes are every version the history holds',
        reg.records.every(r => JSON.stringify(r.dataSha256) === JSON.stringify(hashes.get(localFid(r.formId)))));
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
