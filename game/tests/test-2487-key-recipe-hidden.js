'use strict';
/*
  test-2487-key-recipe-hidden.js

  #2487: a key crafted from the forge's list was named by a 250 ms timer after
  the craft, because the engine adds a menu craft's output in OnFireSuccess,
  after mp.onCraft returns, and hands nothing back. The lock key at a forge
  (cutKey) already cuts a key server side, takes the ingot and hands it over
  named in one step, so the menu recipe ThornswoodRecipeKey now carries the
  never-true condition #2258 gave the house parts, and the gamemode refuses it
  for any client on an older plugin. No timer names a key.

  This reads the committed Thornswood-Content.esp and the gamemode.
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const ESP = path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp');
const GM = path.join(ROOT, 'game', 'gamemode.js');
const COMPRESSED = 0x00040000;
const RECIPE_KEY = 0x05015497;
const MOLD_RECIPE = 0x05015496;
const KEY = 0x05015494;
const FORGE = 0x00088105;
const IRON_INGOT = 0x0005ACE4;
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
      const subs = [];
      let i = 0;
      while (i + 6 <= d.length) {
        const t = d.toString('latin1', i, i + 4), n = d.readUInt16LE(i + 4);
        subs.push({ t: t, b: d.subarray(i + 6, i + 6 + n) });
        i += 6 + n;
      }
      out[fid] = { tag: tag, subs: subs };
      p += 24 + size;
    }
  })(24 + hs, buf.length);
  return out;
}
const all = (r, t) => r.subs.filter((s) => s.t === t).map((s) => s.b);
const one = (r, t) => all(r, t)[0];
function neverTrue(c) {
  return c.length === 32 && (c[0] >> 5) === 4 && c.readFloatLE(4) === 0 && c.readUInt16LE(8) === 47 &&
         c.readUInt32LE(12) === 0xF && c.readUInt32LE(24) === 0 && c.readInt32LE(28) === -1;
}

const r = records(fs.readFileSync(ESP));
const rec = r[RECIPE_KEY];
yes('R1 ThornswoodRecipeKey is still in the plugin, so its form id stays taken', !!rec && rec.tag === 'COBJ' &&
    one(rec, 'EDID').toString('latin1').replace(/\0+$/, '') === 'ThornswoodRecipeKey');
if (rec) {
  const ctda = all(rec, 'CTDA');
  yes('R2 it carries exactly one condition, GetItemCount(gold) < 0, which is never true', ctda.length === 1 && neverTrue(ctda[0]));
  const order = rec.subs.map((s) => s.t);
  yes('R3 the condition sits before the output, where the game reads it', order.indexOf('CTDA') < order.indexOf('CNAM'));
  yes('R4 nothing else moved: a Key, at the forge, from one iron ingot',
      one(rec, 'CNAM').readUInt32LE(0) === KEY && one(rec, 'BNAM').readUInt32LE(0) === FORGE &&
      all(rec, 'CNTO').length === 1 && one(rec, 'CNTO').readUInt32LE(0) === IRON_INGOT && one(rec, 'CNTO').readUInt32LE(4) === 1);
}
const mold = r[MOLD_RECIPE];
yes('R5 the blank key mold is still listed at the forge (no condition)', !!mold && all(mold, 'CTDA').length === 0);

const gm = fs.readFileSync(GM, 'utf8');
yes('G1 no KEY_NAME_DELAY and no nameFreshKey', !/KEY_NAME_DELAY/.test(gm) && !/nameFreshKey/.test(gm));
const at = gm.indexOf('if (desc === KEY_RECIPE) {');
const blk = at === -1 ? '' : gm.slice(at, gm.indexOf('\n  }', at));
yes('G2 the menu craft of a key is refused, and the refusal points at the lock key', !!blk && /return false;/.test(blk) && /lock key/.test(blk));
yes('G3 and nothing in it waits on a timer', !!blk && !/setTimeout/.test(blk));
yes('G4 cutKey still hands the key over named, in the same step it takes the ingot',
    /takeItem\(actorId, KEY_INGOT, 1\)[\s\S]{0,200}giveNamed\(actorId, KEY, keyLabel\(building\)\)/.test(gm));
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
