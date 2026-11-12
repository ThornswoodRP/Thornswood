// Build-FireTable.js
//
// Builds game\data\fires.json: every base record in the load order that is a LIT
// FIRE, so the client can ask "is one of those near me" and the server can
// warm somebody up.
//
// WHY THERE IS ANYTHING TO BUILD
//
// Patrick, 23 September, with five screenshots of the meter reading Fine 50
// outside at night, beside a brazier, inside the Bannered Mare and standing
// in the middle of its fire pit: "not any warmer when near or in fire or in a
// building also make so if you are in a fire you catch on fire". Then:
// "yeah forges and stuff like that should be included too because they are
// hot".
//
// The temperature meter has worked since it was written. Nothing ever told it
// where anybody was standing, so n.place was always '' and the target was
// always comfort. The server cannot know: whether there is a fire in front of
// you is a fact about the machine drawing the world. The client has
// Game.findClosestReferenceOfType, which needs a BASE FORM, and that is what
// this table is.
//
// WHAT COUNTS AS A FIRE, MEASURED RATHER THAN TYPED
//
// Nothing here is a list of form ids from memory. Every row is read out of
// the plugins of the build on this machine, and the rule is on the record:
//
//   1. THE FLAME ITSELF. The thing that burns in Skyrim is not the fireplace,
//      it is a separate object placed in it: a movable static whose model is
//      one of the fire effects (Effects\FXfireWithEmbers*, Effects\FXFire0*,
//      Effects\BFXFireVol*) or one of the wood fires
//      (Clutter\WoodFires\*Burning*, Clutter\Giant\GiantCampfire01Burning).
//      A fireplace alcove is architecture and is cold; the FXfire sitting in
//      it is the fire. That is why this matches on the MODEL PATH and not on
//      the name: hundreds of Skyrim statics have "fireplace" in their editor
//      id and are stonework.
//
//   2. THE WORKING HEAT. A forge, a skyforge and a smelter are hot, which is
//      Patrick's line above. Those are crafting furniture markers and have no
//      flame model of their own, so they are matched by editor id, which is
//      the only thing that identifies them. The list of needles is in
//      CRAFT_HEAT and each one is checked to exist.
//
//   3. NOT WHEN IT IS OUT. Campfire01LandOff, Campfire01Off,
//      FireplaceWood01Off and FXfireWithEmbersOut are the unlit versions of
//      rows 1 and 2, and they are the reason a name match alone would have
//      warmed people up at a dead fire. Anything whose editor id or model
//      ends in Off or Out is dropped, and the count of what was dropped is
//      printed so the rule can be seen working.
//
// Read only. It opens the plugins of the build and writes game\data\fires.json.
// It touches nothing in the game folder and nothing on the VPS.
//
// Usage:
//   node scripts\dev\Build-FireTable.js
//   node scripts\dev\Build-FireTable.js --data "C:\Thornswood\Game\Data"
//   node scripts\dev\Build-FireTable.js --print
//
// Exit code 1 if a plugin will not parse, if any CRAFT_HEAT needle matches
// nothing, or if the table comes out empty. Nothing is written unless every
// check passed.
const fs = require('fs');
const path = require('path');
const { pluginPath, loadedOrder } = require('./OwnPlugins.js');
const zlib = require('zlib');

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const DATA = opt('data', 'C:\\Thornswood\\Game\\Data');
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'fires.json'));
const PRINT = args.indexOf('--print') !== -1;

/*
  EVERY PLUGIN IN THE ORDER, WHICH IS THE WHOLE POINT, and this used to be
  Skyrim.esm alone.

  WHAT THE OLD LIMIT COST, measured 23 September. Patrick walked into a fire
  and the temperature did not move. The plugin log showed the place tick alive
  and its fire distance never leaving nothing, so no fire of ours was ever
  within three hundred units of somebody standing in one. This collection has
  EMBERS XD, which is a fire overhaul, and Embers XD.esp defines SIXTEEN lit
  fire bases of its own: FXfireWithEmbersLogs02, 03 and 04, FXFirepit01,
  FXfireWithEmbersLight02 and 04, its own Campfire01LandBurning variants and
  the rest. Those are the fires people actually stand next to in this build,
  and none of them was in a table read out of Skyrim.esm.

  THE REASON THE LIMIT EXISTED WAS REAL and it is answered rather than
  ignored: a form id is only the number the game uses when its plugin is at
  load index 00. A mod's ids move whenever anybody adds a mod. So the table no
  longer carries runtime ids for anything but Skyrim.esm. It carries the FILE
  and the LOCAL id, and the client resolves them with Game.getFormFromFile,
  which is the engine's own answer to this question and exists in the client
  build (Modules\skyrimPlatform.ts, Game.getFormFromFile).

  A record that OVERRIDES a master's is credited to the master that defines
  it, because that is the file the engine resolves it from and the override is
  what it hands back.
*/
const PLUGINS_TXT = opt('plugins', 'C:\\Thornswood\\Profile\\Default\\plugins.txt');

const PLUGINS = loadedOrder(PLUGINS_TXT, DATA);

// The form types a fire can be. STAT is in the scan so the unlit versions are
// seen and counted as dropped rather than silently missing.
const TYPES = ['MSTT', 'ACTI', 'FURN', 'STAT'];

// Rule 1: the flame itself, by model path.
const FLAME_MODELS = [
  // FXFire01, FXFire02, FXfireWithEmbers* and FXFireSovngarde. Deliberately
  // anchored at the start of the path: MGMagicFirePillar01 and
  // TG09NocturnalFXFirePurple are in the same folder and are quest set
  // dressing rather than something that would warm anybody.
  /^Effects\\FXFire/i,
  /^Effects\\BFXFireVol/i,
  /^Clutter\\WoodFires\\.*Burning/i,
  /^Clutter\\Giant\\GiantCampfire01Burning/i
];

// Rule 2: the working heat, by editor id. Every one of these must match at
// least one record or the build fails: a needle that matches nothing is a
// renamed record and a silently missing forge. A needle matches when the
// editor id begins with it (full editor ids listed when the shared words are not at the front).
// #2259: a 'craft' row warms and never sets anybody alight. Rows of this kind
// carry a third element 'craft' in FIRE_BASES in game/plugins/thornswood-front.js;
// game/tests/test-2259-forge-burn.js fails until the plugin's marks match a rebuild.
const CRAFT_HEAT = [
  'CraftingBlackSmithForge',
  'CraftingSmelterMarker',
  'CraftingBlacksmithForgeSTATIC',
  'CraftingCookingFireSpit',
  // Prefix-start on the four short needles misses these. The shared words are not
  // at the front (Dawnguard, Dragonborn, NKP, Thornswood), so the full
  // editor id is the needle and each one still has to exist.
  'DLC1DawnguardCraftingBlackSmithForge',
  'DLC2CraftingBlackSmithForge',
  'DLC2CraftingBlackSmithSkaalForge',
  'CraftingNKPBlackSmithForge',
  'ThornswoodCraftingCharcoalKilnMarker'
];

// Rule 3: not when it is out.
/*
  NOT WHEN IT IS OUT, and the ends of the names are not the whole of it.

  Off and Out were enough while this read Skyrim.esm alone. Reading the whole
  order on 23 September brought in Embers XD, which names its unlit variants
  differently: FXfireWithEmbersLogs01NoFire is a fire pit with no flame in it,
  and it would have warmed somebody standing at a cold hearth. NoFire, Unlit
  and Dead are added for that, anywhere in the name rather than only at the
  end, because that is where Embers puts them.
*/
const OUT_OF = /((off|out)\d*$)|nofire|unlit|dead(fire|hearth)?\d*$/i;

/*
  How far each kind reaches, in game units. A campfire is about 100 units
  across, so 300 is standing at it and 160 is standing IN it. These are the
  only invented numbers in the file and they are here rather than in the
  plugin so the table is the whole of the answer.
*/
const REACH = { flame: 300, craft: 260 };
const INSIDE = 90;

function fail(msg) {
  console.error('FAIL  ' + msg);
  process.exitCode = 1;
}

/*
  The masters a plugin declares, in order. A record's high byte is an index
  into this list, and anything past the end is the plugin's own.
*/
function mastersOf(b) {
  const out = [];
  let k = 24;
  const end = 24 + b.readUInt32LE(4);
  while (k + 6 <= end) {
    const sub = b.toString('ascii', k, k + 4);
    const sz = b.readUInt16LE(k + 4);
    k += 6;
    if (sub === 'MAST' && sz > 1) { out.push(b.toString('latin1', k, k + sz - 1)); }
    k += sz;
  }
  return out;
}

function subrecords(rec) {
  const got = { EDID: '', MODL: '' };
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if ((sub === 'EDID' || sub === 'MODL') && sz > 1 && k + sz <= rec.length) {
      got[sub] = rec.toString('latin1', k, k + sz - 1);
    }
    k += sz;
  }
  return got;
}

const rows = [];
const dropped = [];
const seen = {};
// Which plugin the walk is inside, and what it declares as its masters.
const here = { file: '', masters: [] };
let scanned = 0;

function walk(b, start, end) {
  let j = start;
  while (j + 24 <= end) {
    const type = b.toString('ascii', j, j + 4);
    const dataSize = b.readUInt32LE(j + 4);
    if (type === 'GRUP') {
      if (dataSize < 24) { return; }
      walk(b, j + 24, j + dataSize);
      j += dataSize;
      continue;
    }
    const flags = b.readUInt32LE(j + 8);
    const formId = b.readUInt32LE(j + 12);
    if (TYPES.indexOf(type) !== -1) {
      scanned++;
      let rec = null;
      try {
        rec = (flags & 0x00040000)
          ? zlib.inflateSync(b.slice(j + 28, j + 24 + dataSize))
          : b.slice(j + 24, j + 24 + dataSize);
      } catch (e) { rec = null; }
      if (rec) {
        const s = subrecords(rec);
        let kind = '';
        let why = '';
        for (let i = 0; i < FLAME_MODELS.length; i++) {
          if (FLAME_MODELS[i].test(s.MODL)) {
            kind = 'flame';
            why = 'model ' + s.MODL;
            break;
          }
        }
        if (!kind) {
          for (let i = 0; i < CRAFT_HEAT.length; i++) {
            if (s.EDID.toLowerCase().indexOf(CRAFT_HEAT[i].toLowerCase()) === 0) {
              kind = 'craft';
              why = 'editor id begins ' + CRAFT_HEAT[i];
              break;
            }
          }
        }
        if (kind) {
          if (OUT_OF.test(s.EDID) || OUT_OF.test(s.MODL.replace(/\.nif$/i, ''))) {
            dropped.push({ id: formId, edid: s.EDID, modl: s.MODL });
          } else {
            // Which file the engine will resolve this from, and the id within
            // it. An index inside the master list means the record belongs to
            // that master and this plugin is only changing it.
            const idx = (formId >>> 24) & 0xff;
            const local = formId & 0x00ffffff;
            const file = idx < here.masters.length ? here.masters[idx] : here.file;
            const key = file.toLowerCase() + ':' + local;
            if (!seen[key]) {
              seen[key] = true;
              rows.push({
                file: file, local: '0x' + local.toString(16),
                type: type, kind: kind, edid: s.EDID, modl: s.MODL, why: why
              });
            }
          }
        }
      }
    }
    j += 24 + dataSize;
  }
}

for (const pl of PLUGINS) {
  const p = pluginPath(DATA, pl);
  const b = fs.readFileSync(p);
  if (b.toString('ascii', 0, 4) !== 'TES4') { fail('not a plugin: ' + p); continue; }
  here.file = pl;
  here.masters = mastersOf(b);
  walk(b, 24 + b.readUInt32LE(4), b.length);
}

// Every craft needle has to have found something.
for (const pre of CRAFT_HEAT) {
  const hit = rows.some(function (r) {
    return r.edid.toLowerCase().indexOf(pre.toLowerCase()) === 0;
  });
  if (!hit) { fail('nothing matched the craft heat needle ' + pre); }
}
if (!rows.length) { fail('the table came out empty'); }

rows.sort(function (a, b) { return a.edid.toLowerCase() < b.edid.toLowerCase() ? -1 : 1; });

console.log(PLUGINS.length + ' plugins in the order');
console.log(scanned + ' records read, ' + rows.length + ' are lit fires, ' +
            dropped.length + ' dropped for being out');
{
  const byFile = {};
  rows.forEach(function (r) { byFile[r.file] = (byFile[r.file] || 0) + 1; });
  Object.keys(byFile).sort(function (a, b) { return byFile[b] - byFile[a]; })
    .forEach(function (f) { console.log('  ' + String(byFile[f]).padStart(4) + '  ' + f); });
}
if (PRINT) {
  for (const r of rows) {
    console.log('  ' + r.kind.padEnd(6) + r.local.padEnd(10) + r.edid.padEnd(38) + r.file);
  }
}

if (process.exitCode === 1) {
  console.error('nothing written');
} else {
  const doc = {
    builtFrom: PLUGINS,
    builtAt: new Date().toISOString(),
    reach: REACH,
    inside: INSIDE,
    rule: 'flame: the model is one of the fire effects or wood fires. ' +
          'craft: the editor id begins one of ' + CRAFT_HEAT.join(', ') + '. ' +
          'Anything whose editor id or model ends Off or Out is dropped.',
    fires: rows,
    droppedForBeingOut: dropped.length
  };
  fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
  console.log('wrote ' + OUT);
}
