// Build-WarmthTable.js
//
// Builds game\data\warmth.json: what every wearable in the load order is made of
// and what it covers, so the temperature meter can tell a fur cloak from a
// steel cuirass from bare skin.
//
// WHY THERE IS ANYTHING TO BUILD
//
// Patrick, 23 September: "also clothing should affect temperature depening on
// what clothes and if you are weaing them no clothes should equal colder some
// clothes/armor should be hotter than others etc".
//
// The server can already see what somebody is wearing: mp.get(actorId,
// 'inventory') gives a baseId and a worn flag for every entry. What it cannot
// see is what that baseId IS. This table is the answer, and it is read out of
// the plugins rather than typed, for the same reason the ore table is.
//
// WHAT IS MEASURED AND WHAT IS JUDGEMENT
//
// MEASURED, off each ARMO record:
//   slots     the BOD2 body template's first four bytes, which say which parts
//             of a body the piece covers. Bit 2 is the torso, bit 0 the head,
//             bit 3 the hands, bit 7 the feet. A cuirass covers more skin than
//             a ring and the record says so.
//   material  the ARMO's own keywords, resolved through the KYWD records, so
//             ArmorMaterialFur is read off the armour and not guessed from its
//             name. A modded armour that uses the vanilla material keywords
//             lands in the right class for free.
//   weight    the DATA subrecord's weight.
//
// JUDGEMENT, and it is deliberately NOT here: how warm fur is. That is
// balance, it belongs with the rest of the balance in the NEEDS table in
// gamemode.js, and Patrick can move it without rebuilding anything. This file
// answers "what is it", the gamemode answers "what is that worth".
//
// Read only. It opens the plugins of the build and writes game\data\warmth.json.
//
// Usage:
//   node scripts\dev\Build-WarmthTable.js
//   node scripts\dev\Build-WarmthTable.js --data "C:\Thornswood\Game\Data"
//   node scripts\dev\Build-WarmthTable.js --print
//
// Exit code 1 if a plugin will not parse or if no vanilla material keyword is
// found at all, which would mean the keyword resolution is broken rather than
// the load order being unusual.
const fs = require('fs');
const path = require('path');
const { pluginPath, loadedOrder } = require('./OwnPlugins.js');
const TABLES = require('./GamemodeTables.js');
const zlib = require('zlib');

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const DATA = opt('data', 'C:\\Thornswood\\Game\\Data');
const PLUGINS_TXT = opt('plugins', 'C:\\Thornswood\\Profile\\Default\\plugins.txt');
const OUT = opt('out', path.join(__dirname, '..', '..', 'game', 'data', 'warmth.json'));
const PRINT = args.indexOf('--print') !== -1;

/*
  THE MATERIAL CLASSES, AND WHY THERE ARE ONLY SIX.

  Every one of these is a keyword that exists in Skyrim.esm and is put on the
  armour by Bethesda. The classes are grouped by what the material DOES to
  somebody standing in weather, which is the only question this table is for:

    fur      fur and hide: the warmest thing in the game, and the reason
             anybody wears it in the Pale
    leather  leather and studded: warm, breathes
    cloth    clothing, robes, anything with no armour keyword at all
    light    elven, glass, scaled, chitin: thin plate over padding
    heavy    iron, steel, dwarven, orcish, ebony, daedric, dragonplate:
             metal, which is the worst thing to wear in a blizzard and the
             worst thing to wear in a forge
    none     jewellery and anything covering no skin

  An armour with no material keyword falls to cloth, which is the middle, so a
  modded piece nobody has classified is neither a blessing nor a punishment.
*/
const MATERIALS = {
  fur: ['ArmorMaterialFur', 'ArmorMaterialHide', 'ArmorMaterialBearStrap',
        'DLC1ArmorMaterialHunter', 'DLC2ArmorMaterialBonemoldHeavy',
        'ArmorMaterialStormcloak'],
  leather: ['ArmorMaterialLeather', 'ArmorMaterialStudded',
            'ArmorMaterialStuddedDragonscale', 'ArmorMaterialImperialLight',
            'ArmorMaterialImperialStudded', 'ArmorMaterialThievesGuild',
            'ArmorMaterialForsworn', 'ArmorMaterialDarkBrotherhood'],
  cloth: ['ArmorClothing', 'ClothingRich', 'ClothingPoor', 'ClothingBody',
          'ClothingHead', 'ClothingFeet', 'ClothingHands', 'ClothingCirclet',
          'ArmorMaterialPenitus'],
  light: ['ArmorMaterialElven', 'ArmorMaterialElvenGilded', 'ArmorMaterialGlass',
          'ArmorMaterialScaled', 'ArmorMaterialDragonscale',
          'DLC2ArmorMaterialChitinLight', 'DLC2ArmorMaterialChitinHeavy',
          'ArmorMaterialImperialHeavy'],
  heavy: ['ArmorMaterialIron', 'ArmorMaterialIronBanded', 'ArmorMaterialSteel',
          'ArmorMaterialSteelPlate', 'ArmorMaterialDwarven',
          'ArmorMaterialOrcish', 'ArmorMaterialEbony', 'ArmorMaterialDaedric',
          'ArmorMaterialDragonplate', 'ArmorMaterialBlades',
          'DLC2ArmorMaterialStalhrimLight', 'DLC2ArmorMaterialStalhrimHeavy',
          'DLC2ArmorMaterialNordicLight', 'DLC2ArmorMaterialNordicHeavy',
          'ArmorMaterialFalmer', 'ArmorMaterialFalmerHardened',
          'ArmorMaterialFalmerHeavy', 'ArmorMaterialFalmerHeavyOriginal']
};
const CLASS_OF = {};
for (const cls in MATERIALS) {
  if (!Object.prototype.hasOwnProperty.call(MATERIALS, cls)) { continue; }
  MATERIALS[cls].forEach(function (k) { CLASS_OF[k.toLowerCase()] = cls; });
}

/*
  EVERY SLOT THAT COVERS SKIN, ONE AT A TIME.

  Patrick, 23 September: "different types of clothes and wether one is on and
  others are like a hat, helmet, scarf, cape, shirt, pants, boots, gloves, etc
  are all counted individually and not grouped".

  The first version read six bits and threw the rest away, which was fine for
  vanilla, where a cuirass is torso and legs in one record, and wrong for this
  load order, where the mods put a cloak on slot 47, a scarf on 45 and hoods on
  31 and 42. A cloak covering nothing was a cloak worth nothing.

  The bits are Skyrim's biped slots offset by thirty: bit 0 is slot 30 and bit
  31 is slot 61. Named here the way a person would name them, and the same
  names are the keys of NEEDS.wear.perPart in gamemode.js, so the two files
  have to agree and tests\test-temp.js checks that they do.

  WHAT IS DELIBERATELY LEFT OUT: amulet (35), ring (36), shield (39), tail
  (40), the decapitation slots (50 and 51) and FX01 (61). None of them is
  between weather and a person.
*/
const SKIN = {
  0: 'head',       // 30, helmets and hoods
  1: 'hair',       // 31, the hood half of a hood
  2: 'body',       // 32, the cuirass or the shirt
  3: 'hands',      // 33, gloves and gauntlets
  4: 'arms',       // 34, bracers
  7: 'feet',       // 37, boots
  8: 'calves',     // 38, greaves
  12: 'circlet',   // 42
  13: 'ears',      // 43
  15: 'neck',      // 45, where the scarves go
  16: 'chest',     // 46, over armour
  17: 'back',      // 47, where the cloaks go
  19: 'pelvis',    // 49, pants
  22: 'pelvis',    // 52, the other pants slot
  23: 'legs',      // 53
  24: 'legs',      // 54
  26: 'chest',     // 56
  27: 'shoulder',  // 57
  28: 'arms',      // 58
  29: 'arms'       // 59
};

function fail(msg) { console.error('FAIL  ' + msg); process.exitCode = 1; }

function masters(b, headerSize) {
  const out = [];
  let k = 24;
  const end = 24 + headerSize;
  while (k + 6 <= end) {
    const sub = b.toString('ascii', k, k + 4);
    const sz = b.readUInt16LE(k + 4);
    k += 6;
    if (sub === 'MAST' && sz > 1) { out.push(b.toString('latin1', k, k + sz - 1)); }
    k += sz;
  }
  return out;
}

function descOf(formId, mast, self) {
  const idx = (formId >>> 24) & 0xff;
  const local = formId & 0x00ffffff;
  const from = idx < mast.length ? mast[idx] : self;
  return local.toString(16) + ':' + from;
}

const keywordName = {};   // descriptor -> editor id
const items = {};         // descriptor -> row
let armoSeen = 0;

function parseSubs(rec, want) {
  const got = {};
  let k = 0, over = 0;
  while (k + 6 <= rec.length) {
    const sub = rec.toString('ascii', k, k + 4);
    let sz = rec.readUInt16LE(k + 4);
    k += 6;
    if (over > 0) { sz = over; over = 0; }
    if (sub === 'XXXX') { over = rec.readUInt32LE(k); k += sz; continue; }
    if (k + sz > rec.length) { break; }
    if (want.indexOf(sub) !== -1) {
      if (!got[sub]) { got[sub] = []; }
      got[sub].push(rec.slice(k, k + sz));
    }
    k += sz;
  }
  return got;
}

/*
  TOP LEVEL GROUPS ONLY, AND THAT IS THE DIFFERENCE BETWEEN SECONDS AND NEVER.

  A plugin is a list of GRUPs and a top level one is labelled with the record
  signature it holds. The first version of this descended into every group it
  found, which means walking every REFR in every cell of every worldspace:
  about one and a third million records in Skyrim.esm, twice, before it had
  looked at a single piece of armour. It had not finished after ten minutes.

  KYWD and ARMO are both top level groups, so there is nothing below the first
  level worth opening.
*/
function walk(b, start, end, pass, mast, self) {
  const wantType = (pass === 'kywd') ? 'KYWD' : 'ARMO';
  let i = start;
  while (i + 24 <= end) {
    if (b.toString('ascii', i, i + 4) !== 'GRUP') { break; }
    const groupSize = b.readUInt32LE(i + 4);
    if (groupSize < 24) { break; }
    if (b.toString('ascii', i + 8, i + 12) === wantType) {
      records(b, i + 24, Math.min(i + groupSize, end), pass, mast, self, wantType);
    }
    i += groupSize;
  }
}

function records(b, start, end, pass, mast, self, wantType) {
  let j = start;
  while (j + 24 <= end) {
    const type = b.toString('ascii', j, j + 4);
    const dataSize = b.readUInt32LE(j + 4);
    if (type === 'GRUP') {
      if (dataSize < 24) { return; }
      j += dataSize;
      continue;
    }
    const flags = b.readUInt32LE(j + 8);
    const formId = b.readUInt32LE(j + 12);
    if (type === wantType) {
      let rec = null;
      try {
        rec = (flags & 0x00040000)
          ? zlib.inflateSync(b.slice(j + 28, j + 24 + dataSize))
          : b.slice(j + 24, j + 24 + dataSize);
      } catch (e) { rec = null; }
      if (rec) {
        const desc = descOf(formId, mast, self);
        if (pass === 'kywd') {
          const s = parseSubs(rec, ['EDID']);
          if (s.EDID) { keywordName[desc] = s.EDID[0].toString('latin1', 0, s.EDID[0].length - 1); }
        } else {
          armoSeen++;
          const s = parseSubs(rec, ['EDID', 'BOD2', 'KWDA', 'DATA', 'BODT']);
          let slots = 0;
          if (s.BOD2 && s.BOD2[0].length >= 4) { slots = s.BOD2[0].readUInt32LE(0); }
          else if (s.BODT && s.BODT[0].length >= 4) { slots = s.BODT[0].readUInt32LE(0); }
          let weight = 0;
          if (s.DATA && s.DATA[0].length >= 8) { weight = s.DATA[0].readFloatLE(4); }
          let mat = '';
          if (s.KWDA) {
            for (const buf of s.KWDA) {
              for (let o = 0; o + 4 <= buf.length; o += 4) {
                const kd = descOf(buf.readUInt32LE(o), mast, self);
                const name = keywordName[kd];
                if (name && CLASS_OF[name.toLowerCase()]) { mat = CLASS_OF[name.toLowerCase()]; }
                if (mat === 'fur' || mat === 'heavy') { break; }
              }
              if (mat === 'fur' || mat === 'heavy') { break; }
            }
          }
          // What skin it covers, out of the slot bits. Deduplicated, because
          // two bits map to the same part: 49 and 52 are both pants and 53,
          // 54, 58 and 59 are limbs, and a record that sets both should not
          // count the same skin twice.
          const covers = [];
          for (const bit in SKIN) {
            if (!Object.prototype.hasOwnProperty.call(SKIN, bit)) { continue; }
            if (!(slots & (1 << Number(bit)))) { continue; }
            if (covers.indexOf(SKIN[bit]) === -1) { covers.push(SKIN[bit]); }
          }
          /*
            A ring warms nobody, and this is NOT a `continue`.

            It was, and the loop it was continuing is the one that walks the
            records, whose only advance is at the bottom. So the first
            wearable that covered no skin - an amulet, a couple of hundred
            records into Skyrim.esm's ARMO group - sent it round the same
            record for ever. Two builds sat there for ten minutes each looking
            like a slow file read.
          */
          if (covers.length) {
            if (!mat) { mat = 'cloth'; }
            items[desc] = {
              m: mat,
              c: covers.join(','),
              w: Math.round(weight * 10) / 10,
              e: (s.EDID ? s.EDID[0].toString('latin1', 0, s.EDID[0].length - 1) : '')
            };
          }
        }
      }
    }
    j += 24 + dataSize;
  }
}

const order = loadedOrder(PLUGINS_TXT, DATA);
let parsed = 0;

/*
  ONE READ PER PLUGIN, KEYWORDS THEN ARMOUR INSIDE IT.

  The first version made two passes over the whole load order so that an
  armour in one plugin could see a keyword defined in another. That is a few
  gigabytes of plugin read twice and it was the slowest thing in the file.

  It is also unnecessary. A plugin's groups are in the engine's fixed record
  order and KYWD comes a long way before ARMO, and plugins are read in load
  order, so every keyword an armour can refer to has already been seen by the
  time the armour is read: masters load before the plugins that use them, and
  a mod's own keywords are above its own armour in its own file. What this
  cannot handle is a plugin referring to a keyword in a plugin loaded AFTER
  it, which the engine cannot handle either.
*/
for (const pl of order) {
  const p = pluginPath(DATA, pl);
  let b;
  try { b = fs.readFileSync(p); } catch (e) { fail('could not read ' + pl); continue; }
  if (b.length < 24 || b.toString('ascii', 0, 4) !== 'TES4') { fail('not a plugin: ' + pl); continue; }
  const headerSize = b.readUInt32LE(4);
  const mast = masters(b, headerSize);
  for (const pass of ['kywd', 'armo']) {
    try {
      walk(b, 24 + headerSize, b.length, pass, mast, pl);
    } catch (e) {
      fail(pl + ' would not walk: ' + e.message);
    }
  }
  parsed++;
}

const byClass = {};
for (const d in items) {
  if (!Object.prototype.hasOwnProperty.call(items, d)) { continue; }
  byClass[items[d].m] = (byClass[items[d].m] || 0) + 1;
}
if (!byClass.heavy && !byClass.fur) {
  fail('no armour resolved to a vanilla material keyword, so keyword reading is broken');
}

console.log(parsed + ' plugins read, ' + armoSeen + ' wearables seen, ' +
            Object.keys(items).length + ' cover skin');
console.log('  by material: ' + Object.keys(byClass).sort().map(function (k) {
  return k + ' ' + byClass[k];
}).join(', '));
if (PRINT) {
  const ks = Object.keys(items).sort();
  for (let i = 0; i < Math.min(ks.length, 40); i++) {
    console.log('  ' + ks[i].padEnd(24) + items[ks[i]].m.padEnd(8) +
                items[ks[i]].c.padEnd(22) + items[ks[i]].e);
  }
}

/*
  WRITTEN FOR THE GAMEMODE AS WELL, AND THINNER THAN THE JSON.

  warmth.json keeps the editor id and the weight because that is what makes a
  row auditable: "why is this thing cloth" has to be answerable. The server
  needs neither, and at 3,166 rows they are most of the file. So the table
  the gamemode reads, game/gamemode-tables/WARMTH.json (#5191), carries the
  material and what it covers and nothing else, and the json beside it stays
  the record of where each row came from.
*/
function install() {
  const thin = {};
  const keys = Object.keys(items).sort();
  for (const d of keys) { thin[d] = { m: items[d].m, c: items[d].c }; }
  const changed = TABLES.write('WARMTH', { items: thin });
  console.log((changed ? 'wrote ' : 'already current: ') + keys.length + ' rows in game\\gamemode-tables\\WARMTH.json');
}

if (process.exitCode === 1) {
  console.error('nothing written');
} else {
  install();
  fs.writeFileSync(OUT, JSON.stringify({
    builtBy: 'scripts\\dev\\Build-WarmthTable.js',
    builtAt: new Date().toISOString(),
    source: 'the ARMO records of ' + parsed + ' plugins in load order, and the ' +
            'KYWD records their keywords point at',
    readFrom: 'BOD2 for what it covers, KWDA for the material, DATA for the weight',
    note: 'what a material is WORTH is balance and lives in NEEDS.wear in gamemode.js',
    count: Object.keys(items).length,
    byMaterial: byClass,
    items: items
  }, null, 2) + '\n');
  console.log('wrote ' + OUT);
}
