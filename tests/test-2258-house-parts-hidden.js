'use strict';
/*
  test-2258-house-parts-hidden.js

  #2258: the Hearthfire house parts (Nails, Hinge, Lock, Iron Fittings) were
  listed at the forge though nobody builds a Hearthfire house here and the
  server already refuses them. The menu entry is the record, read on the
  machine in front of the person, so Thornswood-Content.esp now overrides the
  four HearthFires.esm recipes with one condition that is never true:
  GetItemCount(gold) < 0 on the person at the bench. Everything else on the
  records is Bethesda's: the inputs, the output, the forge and the count.

  This reads the committed plugin with its own reader and proves the four
  overrides, that HearthFires.esm is the master their ids name, and that the
  recipe table still refuses all four. Then it gives the tool
  (scripts/mods/Add-ContentRecords.py, loaded as a module) a copy with the
  condition taken off again and checks the tool's run puts it back byte for
  byte, that a second run writes nothing, and that a copy with the overrides
  gone and no game to copy them from stops with nothing written. On a machine
  with the game (C:\Thornswood\Game\Data, or THORNSWOOD_DATA) it also rebuilds
  the four from HearthFires.esm and gets the committed plugin back.
  Copies go to a temp folder (TEST_TMP).
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Add-ContentRecords.py');
const RECIPES = path.join(ROOT, 'game', 'data', 'recipes.json');
const GM = path.join(ROOT, 'game', 'gamemode.js');
const COMPRESSED = 0x00040000;
const FORGE = 0x00088105;
const IRON_INGOT = 0x0005ACE4;
// In this plugin's numbering: HearthFires.esm is master 03.
const PARTS = [
  { fid: 0x0300306D, edid: 'BYOHRecipeNails', out: 0x0300300F, name: 'Nails', makes: 10 },
  { fid: 0x0300306E, edid: 'BYOHRecipeHinge', out: 0x03003011, name: 'Hinge', makes: 2 },
  { fid: 0x0300306F, edid: 'BYOHRecipeLock', out: 0x03003012, name: 'Lock', makes: 1 },
  { fid: 0x03003036, edid: 'BYOHRecipeFittings', out: 0x03003035, name: 'Iron Fittings', makes: 1 },
];
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

function header(buf) {
  const hs = buf.readUInt32LE(4);
  const masters = [];
  let i = 24;
  while (i + 6 <= 24 + hs) {
    const t = buf.toString('latin1', i, i + 4), n = buf.readUInt16LE(i + 4);
    if (t === 'MAST') { masters.push(buf.toString('latin1', i + 6, i + 6 + n).replace(/\0+$/, '')); }
    i += 6 + n;
  }
  return { size: hs, masters: masters };
}

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
      const subs = [];
      let i = 0;
      while (i + 6 <= d.length) {
        const t = d.toString('latin1', i, i + 4), n = d.readUInt16LE(i + 4);
        subs.push({ t: t, b: d.subarray(i + 6, i + 6 + n) });
        i += 6 + n;
      }
      out[fid] = { tag: tag, flags: flags, subs: subs };
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return out;
}
const all = (r, t) => r.subs.filter((s) => s.t === t).map((s) => s.b);
const one = (r, t) => all(r, t)[0];

const esp = fs.readFileSync(ESP);
const h = header(esp);
yes('M0 HearthFires.esm is the plugin\'s master 03, the index the overrides\' ids carry: ' + h.masters.join(', '),
    h.masters[3] === 'HearthFires.esm' && h.masters.length === 5);
const r = records(esp);
for (const part of PARTS) {
  const rec = r[part.fid];
  const label = part.name + ' (0x' + part.fid.toString(16) + ')';
  yes('R1 ' + label + ' is overridden here as a recipe', !!rec && rec.tag === 'COBJ' && !(rec.flags & COMPRESSED));
  if (!rec) { continue; }
  yes('R2 ' + label + ' keeps Bethesda\'s editor id ' + part.edid, one(rec, 'EDID').toString('latin1').replace(/\0+$/, '') === part.edid);
  const ctda = all(rec, 'CTDA');
  yes('R3 ' + label + ' has exactly one condition', ctda.length === 1);
  if (ctda.length === 1) {
    const c = ctda[0];
    yes('R4 ' + label + ': the condition is GetItemCount (47) of gold (0xF) < 0, on the subject, no reference',
        c.length === 32 && (c[0] >> 5) === 4 && (c[0] & 0x1f) === 0 && c.readFloatLE(4) === 0 &&
        c.readUInt16LE(8) === 47 && c.readUInt32LE(12) === 0xF && c.readUInt32LE(16) === 0 &&
        c.readUInt32LE(20) === 0 && c.readUInt32LE(24) === 0 && c.readInt32LE(28) === -1);
  }
  yes('R5 ' + label + ' still makes HearthFires.esm\'s ' + part.name + ', in this plugin\'s numbering', one(rec, 'CNAM').readUInt32LE(0) === part.out);
  yes('R6 ' + label + ' still sits at the forge, so the table\'s bench is still right', one(rec, 'BNAM').readUInt32LE(0) === FORGE);
  yes('R7 ' + label + ' still makes ' + part.makes + ' and asks for an iron ingot',
      one(rec, 'NAM1').readUInt16LE(0) === part.makes && all(rec, 'CNTO').some((b) => b.readUInt32LE(0) === IRON_INGOT));
  const order = rec.subs.map((s) => s.t);
  yes('R8 ' + label + ': the condition sits before the output, where the game reads conditions', order.indexOf('CTDA') < order.indexOf('CNAM'));
}

// The server's half was already there, and this must not have moved it.
const recipes = JSON.parse(fs.readFileSync(RECIPES, 'utf8'));
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(GM, 'utf8'));
for (const part of PARTS) {
  const key = (part.fid & 0xFFFFFF).toString(16) + ':HearthFires.esm';
  const row = recipes.refused && recipes.refused[key];
  yes('S1 recipes.json still refuses ' + key + ' (' + part.name + ')', !!row && row.name === part.name && /nobody builds|not made at a forge/.test(row.why || ''));
  yes('S2   and no profession owns it', !(recipes.recipes && recipes.recipes[key]) && !(recipes.unowned && recipes.unowned[key]));
  yes('S3   and the gamemode carries the refusal', gm.indexOf('"' + key + '"') !== -1);
}

function python(args) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8' });
    if (!p.error) { return p; }
  }
  return null;
}
const tmpRoot = process.env.TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpRoot, { recursive: true });
const dir = fs.mkdtempSync(path.join(tmpRoot, 'ts-2258-'));
const copy = path.join(dir, 'Thornswood-Content.esp');
const empty = path.join(dir, 'no-game');
fs.mkdirSync(empty);
const fids = PARTS.map((p) => p.fid);
function prep(mode) {
  return python(['-c', [
    'import importlib.util, struct, sys',
    'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
    'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
    'raw = open(sys.argv[2], "rb").read()',
    'hs = struct.unpack_from("<I", raw, 4)[0]',
    'tree = m.parse(raw, 24 + hs, len(raw))',
    'fids = set([' + fids.join(', ') + '])',
    'if sys.argv[4] == "bare":',
    '    for x in m.every_record(tree):',
    '        if x.fid in fids:',
    '            x.data = m.pack_subrecords([(t, b) for t, b in m.subrecords(x.data) if t != b"CTDA"])',
    'else:',
    '    tree = m.take_out(tree, fids)',
    'open(sys.argv[3], "wb").write(raw[:24 + hs] + b"".join(k.bytes() for k in tree))'
  ].join('\n'), TOOL, ESP, copy, mode]);
}
try {
  const bare = prep('bare');
  yes('T0 python is on this machine and the tool loads as a module', !!bare && bare.status === 0);
  if (bare && bare.status === 0) {
    const old = records(fs.readFileSync(copy));
    yes('T1 the copy has the four overrides with no condition, as a plain copy of the master would be', fids.every((f) => old[f] && all(old[f], 'CTDA').length === 0));
    const run = python([TOOL, '--data', dir, '--masters', empty]);
    yes('T2 the tool runs over it with no game to read', !!run && run.status === 0);
    if (run && run.status !== 0) { console.log(run.stdout + run.stderr); }
    yes('T3 and says 4 edited, nothing added or taken out', !!run && /0 added, 4 edited, 0 taken out/.test(run.stdout));
    yes('T4 and its result is the committed plugin byte for byte', fs.readFileSync(copy).equals(esp));
    const again = python([TOOL, '--data', dir, '--masters', empty]);
    yes('T5 a second run writes nothing', !!again && again.status === 0 && /Nothing was written/.test(again.stdout) && fs.readFileSync(copy).equals(esp));
  }
  const gone = prep('gone');
  if (gone && gone.status === 0) {
    const before = fs.readFileSync(copy);
    const stop = python([TOOL, '--data', dir, '--masters', empty]);
    yes('T6 with the overrides gone and no HearthFires.esm to copy from, the tool stops', !!stop && stop.status !== 0 && /HearthFires\.esm is not in/.test(stop.stdout + stop.stderr));
    yes('T7   and writes nothing', fs.readFileSync(copy).equals(before));
    const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
    if (fs.existsSync(path.join(data, 'HearthFires.esm'))) {
      const fresh = python([TOOL, '--data', dir, '--masters', data]);
      yes('T8 with the game there, the tool copies the four in from HearthFires.esm', !!fresh && fresh.status === 0 && /4 added, 0 edited, 0 taken out/.test(fresh.stdout));
      yes('T9   and gets the committed plugin back byte for byte', fs.readFileSync(copy).equals(esp));
    } else {
      console.log('SKIP  T8 and T9: no HearthFires.esm at ' + data + ' (a machine with the game runs them)');
    }
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
