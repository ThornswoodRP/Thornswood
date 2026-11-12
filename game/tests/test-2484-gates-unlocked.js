'use strict';
/*
  test-2484-gates-unlocked.js

  #2484: Bethesda ships the Whiterun main gate's outside leaf (1b1f1) and
  Riften's two outer leaves (42284, 42286) locked at level 255, and under SkyMP
  no quest script opens them. The front plugin used to unlock them on every
  person's game every 30 seconds. Thornswood-Last.esp now carries the three
  winning records without their lock (XLOC) and without their script (VMAD),
  so they load unlocked, and the timer is gone.

  This reads Thornswood-Last.esp, its manifest, the builder and the front
  plugin. No repository holds the plugin since #2791 step 3, so it is made
  from its recipe out of the game's plugins (tests/last-plugin-made.js);
  without the game, M and R print SKIP and the rest still run.
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const made = require('../../tests/last-plugin-made.js').made();
const MANIFEST = path.join(ROOT, 'game', 'data', 'last-plugin.json');
const TOOL = path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py');
const FRONT = path.join(ROOT, 'game', 'plugins', 'thornswood-front.js');
const COMPRESSED = 0x00040000;
const GATES = [0x1b1f1, 0x42284, 0x42286];
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

const buf = made.buf;
if (!buf) { console.log('SKIP  M, R: ' + made.why); }
if (buf) {
  const hs = buf.readUInt32LE(4);
  const masters = [];
  for (let i = 24; i + 6 <= 24 + hs;) {
    const t = buf.toString('latin1', i, i + 4), n = buf.readUInt16LE(i + 4);
    if (t === 'MAST') { masters.push(buf.toString('latin1', i + 6, i + 6 + n).replace(/\0+$/, '')); }
    i += 6 + n;
  }
  const sky = masters.indexOf('Skyrim.esm');
  yes('M0 Skyrim.esm is one of the plugin\'s masters', sky >= 0);
  const found = {};
  (function walk(s, e, cell, child) {
    let p = s;
    while (p + 24 <= e) {
      const tag = buf.toString('latin1', p, p + 4);
      const size = buf.readUInt32LE(p + 4);
      if (tag === 'GRUP') {
        const gt = buf.readInt32LE(p + 12);
        walk(p + 24, p + size, gt === 6 ? buf.readUInt32LE(p + 8) : cell, gt >= 8 && gt <= 10 ? gt : child);
        p += size; continue;
      }
      const flags = buf.readUInt32LE(p + 8), fid = buf.readUInt32LE(p + 12);
      if (tag === 'REFR') {
        let d = buf.subarray(p + 24, p + 24 + size);
        if (flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
        const subs = [];
        for (let i = 0; i + 6 <= d.length;) {
          const t = d.toString('latin1', i, i + 4), n = d.readUInt16LE(i + 4);
          subs.push(t); i += 6 + n;
        }
        found[fid] = { subs: subs, cell: cell, child: child, flags: flags };
      }
      p += 24 + size;
    }
  })(24 + hs, buf.length, null, null);
  for (const g of GATES) {
    const fid = ((sky << 24) >>> 0) + g;
    const r = found[fid];
    const label = g.toString(16) + ':Skyrim.esm';
    yes('R1 the gate ' + label + ' is overridden here as a placed reference', !!r);
    if (!r) { continue; }
    yes('R2 ' + label + ' has no lock (XLOC) and no script (VMAD)', r.subs.indexOf('XLOC') === -1 && r.subs.indexOf('VMAD') === -1);
    yes('R3 ' + label + ' keeps its base, its teleport to the other side and its position',
        r.subs.indexOf('NAME') !== -1 && r.subs.indexOf('XTEL') !== -1 && r.subs.indexOf('DATA') !== -1);
    yes('R4 ' + label + ' sits in a cell\'s persistent group, where Bethesda placed it', r.cell !== null && r.child === 8);
    yes('R5 ' + label + ' is not disabled', !(r.flags & 0x800));
  }
  // The only other placed references here are the floor items, each switched
  // off (#3077, tests/test-3077-floor-items.js).
  const gateFids = GATES.map((g) => ((sky << 24) >>> 0) + g);
  yes('R6 no other placed reference is overridden, but the floor items, each switched off',
      Object.keys(found).every((f) => gateFids.indexOf(Number(f)) >= 0 || (found[f].flags & 0x800)));
}

const man = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
yes('J1 the manifest names the three gates', JSON.stringify(man.gatesUnlocked) ===
    JSON.stringify(['1b1f1:Skyrim.esm', '42284:Skyrim.esm', '42286:Skyrim.esm']) && man.counts.gatesUnlocked === 3);

const tool = fs.readFileSync(TOOL, 'utf8');
yes('B1 the builder lists the gates, drops XLOC and VMAD, and its verify refuses a gate left locked',
    /GATES = \(\('skyrim\.esm', 0x01B1F1\), \('skyrim\.esm', 0x042284\), \('skyrim\.esm', 0x042286\)\)/.test(tool) &&
    /GATE_DROP = \{b'XLOC', b'VMAD'\}/.test(tool) && /town gate %s is left locked/.test(tool));
const front = fs.readFileSync(FRONT, 'utf8');
yes('F1 the front plugin no longer opens gates on a timer', !/openTheGates|TOWN_GATES|GATE_EVERY_MS/.test(front));
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
