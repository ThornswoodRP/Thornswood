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
  recipe table still refuses all four. Then it gives the tool's own step
  (never_listed() in scripts/mods/Add-ContentRecords.py, loaded as a module)
  each override with the condition taken off, as a plain copy of the master
  would be, and checks it puts the condition back byte for byte, once. The
  tool builds the whole plugin from its sources (#5191), so with no game to
  copy the four from it stops and writes nothing. On a machine with the game
  (C:\Thornswood\Game\Data, or THORNSWOOD_DATA) it builds the plugin and the
  four are the committed overrides. Its output goes to a temp folder
  (TEST_TMP).
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
const out = path.join(dir, 'Thornswood-Content.esp');
const empty = path.join(dir, 'no-game');
fs.mkdirSync(empty);
const fids = PARTS.map((p) => p.fid);
// The tool's own step: each committed override with its condition taken off,
// as a plain copy of the master would be, and never_listed() run over it.
const driver = [
  'import importlib.util, struct, sys',
  'spec = importlib.util.spec_from_file_location("acr", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)',
  'raw = open(sys.argv[2], "rb").read()',
  'hs = struct.unpack_from("<I", raw, 4)[0]',
  'have = dict((x.fid, x) for x in m.every_record(m.parse(raw, 24 + hs, len(raw))))',
  'fids = [' + fids.join(', ') + ']',
  'for f in fids:',
  '    r = have[f]',
  '    bare = m.Rec(r.tag, r.flags, r.fid, r.extra, m.pack_subrecords([(t, b) for t, b in m.subrecords(r.data) if t != b"CTDA"]))',
  '    first = bare.data != r.data and m.never_listed(bare)',
  '    second = m.never_listed(bare)',
  '    print("%X %s %s %s" % (f, "added" if first else "none", "again" if second else "once", "same" if bare.bytes() == r.bytes() else "differs"))',
].join('\n');
try {
  const run = python(['-c', driver, TOOL, ESP]);
  yes('T0 python is on this machine and the tool loads as a module', !!run && run.status === 0);
  if (run && run.status !== 0) { console.log(run.stdout + run.stderr); }
  const lines = run && run.status === 0 ? run.stdout.trim().split(/\r?\n/) : [];
  for (const part of PARTS) {
    const l = lines.find((x) => x.split(' ')[0] === part.fid.toString(16).toUpperCase()) || '';
    yes('T1 ' + part.name + ': never_listed() puts the condition on a bare copy of the master\'s recipe, once, and gets the committed override byte for byte', l.endsWith(' added once same'));
  }
  const stop = python([TOOL, '--masters', empty, '--out', out]);
  yes('T2 with no game to copy the four from, the tool stops', !!stop && stop.status !== 0 && /HearthFires\.esm/.test(stop.stdout + stop.stderr) && /Nothing was written/.test(stop.stdout));
  yes('T3   and writes nothing', !fs.existsSync(out));
  const data = process.env.THORNSWOOD_DATA || 'C:\\Thornswood\\Game\\Data';
  if (fs.existsSync(path.join(data, 'HearthFires.esm'))) {
    const fresh = python([TOOL, '--masters', data, '--out', out]);
    yes('T4 with the game there, the tool builds the plugin', !!fresh && fresh.status === 0 && fs.existsSync(out));
    if (fresh && fresh.status === 0) {
      const built = records(fs.readFileSync(out));
      yes('T5   and the four it copies from HearthFires.esm are the committed overrides',
          fids.every((f) => built[f] && Buffer.concat(built[f].subs.map((x) => x.b)).equals(Buffer.concat(r[f].subs.map((x) => x.b)))));
    }
  } else {
    console.log('SKIP  T4 and T5: no HearthFires.esm at ' + data + ' (a machine with the game runs them)');
  }
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { }
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
