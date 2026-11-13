'use strict';
/*
  test-2255-key-mold-models.js

  #2255: "the key item isn't a key and is the same block log item as the
  mold". ThornswoodMiscKey (0x5015494) and ThornswoodMiscKeyMold (0x5015495)
  were cloned from the charcoal MISC in scripts/mods/Add-ContentRecords.py and
  kept its mesh, Clutter\Quest\TG06CharcoalStick.nif, so both were the same
  stick of charcoal. They now wear vanilla meshes: the key Clutter\Key01.nif
  (what most of Skyrim.esm's keys use) and the mold Clutter\SilverMold01.nif
  (the Thieves Guild silver mold). The charcoal's MODT goes with its mesh.

  This reads the committed plugin with its own reader and proves the two
  records, then loads the tool as a module and checks the two it writes from
  its own numbers (#5191) are the committed records byte for byte.
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');
const KEY = 0x5015494, MOLD = 0x5015495, DEED = 0x5015493, CHARCOAL = 0x5015481;
const COMPRESSED = 0x00040000;
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

function records(buf) {
  const out = {};
  const hs = buf.readUInt32LE(4);
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = buf.readUInt32LE(p + 8), fid = buf.readUInt32LE(p + 12);
      let d = buf.subarray(p + 24, p + 24 + size);
      if (flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
      const subs = {};
      let i = 0;
      while (i + 6 <= d.length) {
        const t = d.toString('latin1', i, i + 4), n = d.readUInt16LE(i + 4);
        if (!(t in subs)) { subs[t] = d.subarray(i + 6, i + 6 + n); }
        i += 6 + n;
      }
      out[fid] = { tag: tag, subs: subs };
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return out;
}
const z = (b) => b ? b.toString('latin1').replace(/\0+$/, '') : '';

const esp = fs.readFileSync(ESP);
const r = records(esp);
const key = r[KEY], mold = r[MOLD];
yes('R0 the key, the mold, the deed and the charcoal are in the plugin', !!key && !!mold && !!r[DEED] && !!r[CHARCOAL]);
if (key && mold) {
  yes('R1 the key wears a key: ' + z(key.subs.MODL), z(key.subs.MODL) === 'Clutter\\Key01.nif');
  yes('R2 the mold wears the silver mold: ' + z(mold.subs.MODL), z(mold.subs.MODL) === 'Clutter\\SilverMold01.nif');
  yes('R3 the key and the mold no longer look alike', z(key.subs.MODL) !== z(mold.subs.MODL));
  yes('R4 neither is the charcoal stick any more', !/Charcoal/i.test(z(key.subs.MODL)) && !/Charcoal/i.test(z(mold.subs.MODL)));
  yes('R5 neither carries the charcoal mesh\'s MODT', !key.subs.MODT && !mold.subs.MODT);
  yes('R6 the key is still MISC "Key", 0 gold, weightless', key.tag === 'MISC' && z(key.subs.FULL) === 'Key' &&
      key.subs.DATA.readUInt32LE(0) === 0 && key.subs.DATA.readFloatLE(4) === 0);
  yes('R7 the mold is still MISC "Key Mold", 25 gold, 1 weight', mold.tag === 'MISC' && z(mold.subs.FULL) === 'Key Mold' &&
      mold.subs.DATA.readUInt32LE(0) === 25 && mold.subs.DATA.readFloatLE(4) === 1);
  yes('R8 the charcoal itself keeps its stick', /TG06CharcoalStick/.test(z(r[CHARCOAL].subs.MODL)));
}

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8' });
    if (!p.error) { return p; }
  }
  return null;
}
// The tool writes the key and the mold from its own numbers (#5191):
// thornswood_records(), loaded as a module, given the clam it keeps and no
// scrap, has to make the committed two byte for byte.
const run = python(['-c', [
  'import importlib.util, struct, sys',
  'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'raw = open(sys.argv[2], "rb").read()',
  'hs = struct.unpack_from("<I", raw, 4)[0]',
  'have = dict((x.fid, x) for x in m.every_record(m.parse(raw, 24 + hs, len(raw))))',
  'made = dict((x.fid, x) for x in m.thornswood_records(m.clam01(), []))',
  'for f in (0x5015494, 0x5015495):',
  '    print("%X %s" % (f, "same" if f in made and made[f].bytes() == have[f].bytes() else "differs"))',
].join('\n'), TOOL, ESP]);
yes('T0 python is on this machine and the tool loads as a module', !!run && run.status === 0);
if (run && run.status !== 0) { console.log(run.stdout + run.stderr); }
const said = run && run.status === 0 ? run.stdout : '';
yes('T1 the tool writes the key the committed plugin carries, byte for byte', /5015494 same/.test(said));
yes('T2 the tool writes the mold the committed plugin carries, byte for byte', /5015495 same/.test(said));
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
