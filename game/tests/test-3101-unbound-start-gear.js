'use strict';
/*
  test-3101-unbound-start-gear.js

      node game/tests/test-3101-unbound-start-gear.js

  #3101: new characters came out of creation with an axe on the hip that
  nobody gave them. It was invisible, in no inventory, and could still be
  drawn, swung and sheathed. Skyrim Unbound's start
  (SkyrimUnboundQuestScript.PrepareForStart, then the inventory module's
  GivePlayerStuff) runs in each person's own game and hands the new character
  a random weapon, equipped, because ChoiceRandomWeapons defaults to True on
  SkyrimUnboundInventory; with ChoiceSpellsMode at its default 0 it can hand
  out random spells too. The server never gives either. Djinn read it out of
  the compiled scripts on 16 Oct 2026 (#2039). Thornswood-Last.esp now carries
  that quest with ChoiceRandomWeapons False and ChoiceSpellsMode 1
  (scripts/mods/Build-LastPlugin.py, the policy's questScriptProperties).

    P  the policy sets exactly those two on SkyrimUnboundInventory's
       SkyrimUnboundModuleInventory, and says why
    Q  the plugin carries the quest, and its script holds both values; the
       manifest lists it
    B  the builder adds or changes the property, and its verify refuses a
       plugin that does not carry it

  Reads the plugin, its manifest, the policy and the builder. No repository
  holds the plugin since #2791 step 3, so Q1 to Q6 read it made from its
  recipe out of the game's plugins (tests/last-plugin-made.js), and print
  SKIP without the game; the rest still run. A machine with the game also
  rebuilds the plugin (tests/test-2468-last-plugin.js R1).
*/
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const made = require('../../tests/last-plugin-made.js').made();
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin.json'), 'utf8'));
const POLICY = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin-policy.json'), 'utf8'));
const TOOL = fs.readFileSync(path.join(ROOT, 'scripts', 'mods', 'Build-LastPlugin.py'), 'utf8');
const COMPRESSED = 0x00040000;
const QUEST = 'bdfb6a:Skyrim Unbound.esp';
const SCRIPT = 'SkyrimUnboundModuleInventory';
let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

// ---------------------------------------------------------------------- P
const rules = (POLICY.questScriptProperties || {}).quests || [];
const row = rules.find((r) => r.quest === QUEST);
yes('P1 the policy sets script properties on Skyrim Unbound\'s SkyrimUnboundInventory, and only there',
    rules.length === 1 && !!row && row.edid === 'SkyrimUnboundInventory' && row.script === SCRIPT);
const set = {};
((row && row.properties) || []).forEach((p) => { set[p.name] = p; });
yes('P2 ChoiceRandomWeapons is set False, as a bool: no random weapon',
    !!set.ChoiceRandomWeapons && set.ChoiceRandomWeapons.type === 'bool' && set.ChoiceRandomWeapons.value === false);
yes('P3 ChoiceSpellsMode is set 1, as an int: no spells handed out',
    !!set.ChoiceSpellsMode && set.ChoiceSpellsMode.type === 'int' && set.ChoiceSpellsMode.value === 1);
yes('P4 nothing else is set, and each says why',
    Object.keys(set).length === 2 && Object.keys(set).every((k) => typeof set[k].why === 'string' && set[k].why.length > 40) &&
    typeof POLICY.questScriptProperties.why === 'string' && /3101/.test(POLICY.questScriptProperties.why));
yes('P5 the quest is not one the policy stops as well',
    !(POLICY.modQuestsStopped || []).some((q) => q.quest === QUEST));

// ---------------------------------------------------------------------- Q
function subs(d) {
  const out = [];
  let i = 0, big = null;
  while (i + 6 <= d.length) {
    const t = d.toString('latin1', i, i + 4);
    let n = d.readUInt16LE(i + 4);
    if (t === 'XXXX') { big = d.readUInt32LE(i + 6); i += 6 + n; continue; }
    if (big !== null) { n = big; big = null; }
    out.push({ t: t, b: d.subarray(i + 6, i + 6 + n) });
    i += 6 + n;
  }
  return out;
}
/* The scripts at the head of a VMAD, each with its properties, every type
   Skyrim writes (an object, a string, an int, a float, a bool and a list of
   each). One of another type is reported rather than skipped. */
function scriptsOf(v) {
  let p = 0;
  const u8 = () => v.readUInt8(p++);
  const u16 = () => { const x = v.readUInt16LE(p); p += 2; return x; };
  const str = () => { const n = u16(); const s = v.toString('latin1', p, p + n); p += n; return s; };
  const ver = v.readInt16LE(0), fmt = v.readInt16LE(2);
  p = 4;
  const out = [];
  for (let n = u16(); n > 0; n--) {
    const s = { name: str(), props: {} };
    if (ver >= 4) { u8(); }
    for (let m = u16(); m > 0; m--) {
      const name = str(), type = u8();
      const status = ver >= 4 ? u8() : null;
      const one = (t) => {
        let x;
        if (t === 1) { x = fmt === 1 ? v.readUInt32LE(p) : v.readUInt32LE(p + 4); p += 8; }
        else if (t === 2) { x = str(); }
        else if (t === 3) { x = v.readInt32LE(p); p += 4; }
        else if (t === 4) { x = v.readFloatLE(p); p += 4; }
        else if (t === 5) { x = v.readUInt8(p) !== 0; p += 1; }
        return x;
      };
      let value;
      if (type >= 1 && type <= 5) { value = one(type); }
      else if (type >= 11 && type <= 15) {
        value = [];
        for (let k = v.readUInt32LE((p += 4) - 4); k > 0; k--) { value.push(one(type - 10)); }
      } else if (type !== 0) { return { error: 'property ' + name + ' of type ' + type }; }
      s.props[name.toLowerCase()] = { type: type, status: status, value: value };
    }
    out.push(s);
  }
  return { scripts: out };
}

const esp = made.buf;
if (!esp) {
  console.log('SKIP  Q1 to Q6: ' + made.why);
} else {
  const hs = esp.readUInt32LE(4);
  const masters = subs(esp.subarray(24, 24 + hs)).filter((s) => s.t === 'MAST')
    .map((s) => s.b.toString('latin1').replace(/\0+$/, ''));
  const ub = masters.indexOf('Skyrim Unbound.esp');
  yes('Q1 Skyrim Unbound.esp is one of the plugin\'s masters', ub >= 0);
  let quest = null;
  (function walk(s, e) {
    let p = s;
    while (p + 24 <= e) {
      const tag = esp.toString('latin1', p, p + 4);
      const size = esp.readUInt32LE(p + 4);
      if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
      const flags = esp.readUInt32LE(p + 8), fid = esp.readUInt32LE(p + 12);
      if (tag === 'QUST' && ub >= 0 && fid === (((ub << 24) >>> 0) + 0xbdfb6a)) {
        let d = esp.subarray(p + 24, p + 24 + size);
        if (flags & COMPRESSED) { d = zlib.inflateSync(d.subarray(4)); }
        quest = subs(d);
      }
      p += 24 + size;
    }
  })(24 + hs, esp.length);
  yes('Q2 the plugin overrides SkyrimUnboundInventory', !!quest &&
      quest.some((s) => s.t === 'EDID' && s.b.toString('latin1').replace(/\0+$/, '') === 'SkyrimUnboundInventory'));
  const vmad = quest && quest.find((s) => s.t === 'VMAD');
  const read = vmad ? scriptsOf(vmad.b) : { error: 'no scripts' };
  const sc = read.scripts && read.scripts.find((s) => s.name.toLowerCase() === SCRIPT.toLowerCase());
  yes('Q3 its scripts read, and ' + SCRIPT + ' is among them' + (read.error ? ' (' + read.error + ')' : ''), !!sc);
  const w = sc && sc.props.choicerandomweapons, sp = sc && sc.props.choicespellsmode;
  yes('Q4 ChoiceRandomWeapons is False on it', !!w && w.type === 5 && w.value === false);
  yes('Q5 ChoiceSpellsMode is 1 on it', !!sp && sp.type === 3 && sp.value === 1);
  const NEVER_TRUE = Buffer.from('80000000000000002f000000' + '0f000000' + '00000000' + '00000000' + '00000000' + 'ffffffff', 'hex');
  yes('Q6 the quest is not stopped: no never-true condition is put on it, and the manifest does not list it as stopped',
      !!quest && !quest.some((s) => s.t === 'CTDA' && s.b.equals(NEVER_TRUE)) &&
      !(MANIFEST.quests.modStopped || []).some((q) => q.quest === QUEST));
}
const mrow = (MANIFEST.questScriptProperties || []).find((r) => r.quest === QUEST);
yes('Q7 the manifest lists it with the values set and the plugin it was copied from',
    !!mrow && mrow.edid === 'SkyrimUnboundInventory' && mrow.script === SCRIPT &&
    mrow.set.ChoiceRandomWeapons === false && mrow.set.ChoiceSpellsMode === 1 && /\.esp$/.test(mrow.winner) &&
    MANIFEST.counts.questScriptProperties === 1);

// ---------------------------------------------------------------------- B
yes('B1 the builder writes the property types the policy names (int 3, float 4, bool 5), as edited',
    /PROPERTY_TYPES = \{'int': 3, 'float': 4, 'bool': 5\}/.test(TOOL) && /PROPERTY_EDITED = 1/.test(TOOL));
yes('B2 it stops on a script the quest lacks and on a property of another type',
    /does not carry the script %s once/.test(TOOL) && /carries %s as type %d, and the policy sets it as a %s/.test(TOOL));
yes('B3 its verify refuses a plugin whose quest does not set the value',
    /does not set %s to %r/.test(TOOL));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
