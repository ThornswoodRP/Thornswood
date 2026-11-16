'use strict';
// test-3133-crafting-categories.js
//
//     node tests\test-3133-crafting-categories.js
//
// The crafting menu's groups (#3133). Patrick, 22 Oct 2026, A: crafting tables
// are sorted by item type, with material groups inside.
//
// WHAT DRAWS THE MENU. The forge, tanning rack, smelter, loom, cooking pot,
// oven, grain mill, staff enchanter and our own benches open Constructible
// Object Custom Keyword System's menu (Crafting Categories for SkyUI, Nexus
// Mods mod 81409, file 493920, with the NG build of its plugin, mod 81731,
// file 792919, both in collection 7essxf revision 4). It reads one JSON config
// per plugin of the load order from Data\SKSE\Plugins\CraftingCategories, in
// load order, and a later config takes a keyword away from an earlier one.
// "sections" are the headers down the side of the menu and "categories" the
// groups inside a header. An item goes under the section one of its keywords
// names, then into the group one of its keywords names within that section.
// Its menu, constructibleobjectmenu.swf, matches an item to a header by the
// top byte of its filter flag and to a group by the whole flag (ItemTypeFilter
// MODE_TIERED, read from the movie's bytecode on 26 Oct 2026), so nothing caps
// how many groups a header holds.
//
// WHAT WAS WRONG. The mod's own Skyrim.json puts every weapon type, armour
// weight, shield and arrow under one header, WEAPONS & ARMOR, with the
// material groups inside it, so the Iron group held iron swords and iron
// helmets alike, among more than 1,200 forge recipes. Immersive Armors marks
// its pieces only with its own IAKMaterial keywords, which no config named,
// so not one of its 477 forge, skyforge and tanning rack pieces was in a
// group; 428 of them carry an IAKMaterial keyword (measured 26 Oct 2026 from
// the collection's revision 4 plugins).
//
// THE FIX. game\ours\Data\SKSE\Plugins\CraftingCategories\Thornswood-Content.json,
// named for our content plugin so it loads after the collection's own configs,
// gives weapons, armour and arrows a header each, takes every keyword the
// shared header held, and puts the material groups inside the header they
// belong to, Immersive Armors' keywords beside Skyrim's. The labels are our
// own keys, named in game\ours\Data\Interface\Translations\Thornswood-Content_ENGLISH.txt,
// which the game reads because it is named for the same plugin.
//
// This holds:
//   1. the config is plain JSON (the mod skips a file it cannot parse) named
//      for a plugin this repository ships;
//   2. every keyword of the mod's shared header is in one of ours, and no
//      keyword is in two of our headers or two groups of one header;
//   3. every group is inside one of our headers, and each header's icon is a
//      frame SkyUI's item icons have;
//   4. every label key has exactly one English line, and the file is the
//      UTF-16 with a byte order mark the game reads, with no line for a key
//      nothing uses and no banned word;
//   5. both files ship: Ship-Rules.ps1 $ShipOursFiles and Go.ps1
//      $oursMenuFiles name them;
//   6. the checks catch a shared keyword, a group outside our headers and a
//      label with no line, on planted copies.
//
// Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const CONFIG = 'game/ours/Data/SKSE/Plugins/CraftingCategories/Thornswood-Content.json';
const LABELS = 'game/ours/Data/Interface/Translations/Thornswood-Content_ENGLISH.txt';

// The section keywords of WEAPONS & ARMOR in the mod's Skyrim.json (file
// 493920, 3,707 bytes, read 26 Oct 2026).
const SHARED = ['ArmorHeavy', 'ArmorLight', 'ArmorShield', 'VendorItemArrow', 'WeapTypeBattleaxe', 'WeapTypeBow',
  'WeapTypeDagger', 'WeapTypeGreatsword', 'WeapTypeMace', 'WeapTypeStaff', 'WeapTypeSword', 'WeapTypeWarAxe',
  'WeapTypeWarhammer'];
// Frames of SkyUI's interface\skyui\icons_item_psychosteve.swf (SkyUI_SE.bsa,
// file 749043) that a header here may use, read from its FrameLabel tags on
// 26 Oct 2026.
const ICONS = ['weapon_sword', 'weapon_bow', 'weapon_arrow', 'weapon_bolt', 'armor_body', 'armor_head', 'armor_shield',
  'clothing_body', 'armor_ring', 'default_food', 'misc_ingot'];
const ICON_MOVIE = 'skyui/icons_item_psychosteve.swf';
const BANNED = /\bplayers?\b|—/i;

function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel)); } catch (e) { return null; }
}

// The English lines, or null when the file is not UTF-16 with a byte order mark.
function labelsOf(buf) {
  if (!buf || buf.length < 2 || buf[0] !== 0xff || buf[1] !== 0xfe) return null;
  const out = new Map();
  for (const line of buf.slice(2).toString('utf16le').split('\r\n')) {
    if (!line) continue;
    const tab = line.indexOf('\t');
    const key = tab < 0 ? line : line.slice(0, tab);
    if (out.has(key)) out.set(key, null); else out.set(key, tab < 0 ? '' : line.slice(tab + 1));
  }
  return out;
}

// Each finding is one line saying what is wrong.
function audit(cfg, labels) {
  const bad = [];
  const sections = cfg.sections || {};
  const categories = cfg.categories || {};
  const ours = Object.keys(sections);
  const inSection = new Map();
  for (const s of ours) {
    const sec = sections[s];
    for (const k of sec.keywords || []) {
      const at = inSection.get(k.toLowerCase());
      if (at) bad.push(k + ' is a keyword of two headers, ' + at + ' and ' + s);
      else inSection.set(k.toLowerCase(), s);
    }
    if (!sec.icon || sec.icon.source !== ICON_MOVIE || ICONS.indexOf(sec.icon.label) < 0) bad.push(s + ' has no icon from SkyUI\'s item icons');
  }
  for (const k of SHARED) if (!inSection.has(k.toLowerCase())) bad.push(k + ' is left under the shared WEAPONS & ARMOR header');
  const inGroup = new Map();
  for (const c of Object.keys(categories)) {
    const cat = categories[c];
    if (ours.indexOf(cat.section) < 0) { bad.push(c + ' is inside ' + cat.section + ', not one of our headers'); continue; }
    if (!(cat.keywords || []).length) bad.push(c + ' names no keyword');
    for (const k of cat.keywords || []) {
      const key = cat.section + '|' + k.toLowerCase();
      if (inGroup.has(key)) bad.push(k + ' is in two groups of ' + cat.section + ', ' + inGroup.get(key) + ' and ' + c);
      else inGroup.set(key, c);
    }
  }
  const keys = ours.concat(Object.keys(categories));
  for (const k of keys) {
    if (!/^\$TW_/.test(k)) bad.push(k + ' is not one of our label keys ($TW_...), so another mod\'s line could name it');
    if (!labels.has(k)) bad.push(k + ' has no English line');
    else if (labels.get(k) === null) bad.push(k + ' has two English lines');
    else if (!labels.get(k).trim()) bad.push(k + ' has an empty English line');
    else if (BANNED.test(labels.get(k))) bad.push(k + '\'s English line breaks the writing rules');
  }
  for (const k of labels.keys()) if (keys.indexOf(k) < 0) bad.push(k + ' has an English line and nothing uses it');
  return bad;
}

// ---- 1. the config reads, named for a plugin we ship -------------------------
const raw = read(CONFIG);
let cfg = null;
try { cfg = JSON.parse(raw.toString('utf8')); } catch (e) { console.log('  ' + e.message); }
yes(CONFIG + ' is plain JSON', cfg !== null && typeof cfg === 'object');
const plugin = path.basename(CONFIG, '.json');
yes('it is named for a plugin this repository ships (game\\content\\' + plugin + '.esp)', fs.existsSync(path.join(ROOT, 'game', 'content', plugin + '.esp')));
yes('and so are its English names', path.basename(LABELS) === plugin + '_ENGLISH.txt');
const labels = labelsOf(read(LABELS));
yes(LABELS + ' is UTF-16 with a byte order mark, one key and name per line', labels !== null && labels.size > 0);
if (!cfg || !labels) {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = 1;
  return;
}

// ---- 2 to 4. the groups ------------------------------------------------------
const bad = audit(cfg, labels);
yes('weapons, armour and arrows each have a header, every group is inside one, and every label has one English line' + (bad.length ? ': ' + bad.join('; ') : ''), bad.length === 0);
const secs = Object.keys(cfg.sections);
const groupsOf = (s) => Object.keys(cfg.categories).filter((c) => cfg.categories[c].section === s);
yes('there are three headers, and weapons and armour each hold their material groups (' + secs.map((s) => s + ' ' + groupsOf(s).length).join(', ') + ')',
  secs.length === 3 && groupsOf('$TW_WEAPONS').length >= 10 && groupsOf('$TW_ARMOUR').length >= 10);
const iak = [].concat.apply([], groupsOf('$TW_ARMOUR').map((c) => cfg.categories[c].keywords)).filter((k) => /^IAKMaterial/.test(k));
yes('Immersive Armors\' material keywords are in armour groups (' + iak.length + ')', iak.length >= 14);

// ---- 5. both files ship -------------------------------------------------------
function list(text, re) {
  const m = re.exec(text || '');
  if (!m) return [];
  return (m[1].split('\n').map((l) => l.replace(/#.*$/, '')).join('\n').match(/'[^']+'/g) || []).map((q) => q.slice(1, -1));
}
const rules = (read('scripts/release/Ship-Rules.ps1') || '').toString().split('\r\n').join('\n');
const go = (read('scripts/release/Go.ps1') || '').toString().split('\r\n').join('\n');
const ships = list(rules, /^\$ShipOursFiles = @\(([\s\S]*?)^\)/m);
const copies = list(go, /^\$oursMenuFiles = @\(([\s\S]*?)^\)/m);
for (const rel of [CONFIG, LABELS]) {
  const data = rel.replace(/^game\/ours\//, '').split('/').join('\\');
  yes(data + ' is in Ship-Rules.ps1 $ShipOursFiles', ships.indexOf(data) >= 0);
  yes(data + ' is in Go.ps1 $oursMenuFiles', copies.indexOf(data) >= 0);
}

// ---- 6. the checks bite -------------------------------------------------------
const planted = JSON.parse(JSON.stringify(cfg));
planted.sections.$TW_ARROWS.keywords.push('WeapTypeBow');
let r = audit(planted, labels);
yes('a keyword in two headers is caught', r.some((b) => /WeapTypeBow is a keyword of two headers/.test(b)));
const shared = JSON.parse(JSON.stringify(cfg));
shared.sections.$TW_ARMOUR.keywords = shared.sections.$TW_ARMOUR.keywords.filter((k) => k !== 'ArmorShield');
r = audit(shared, labels);
yes('a keyword left under the shared header is caught', r.some((b) => /ArmorShield is left under the shared/.test(b)));
const outside = JSON.parse(JSON.stringify(cfg));
outside.categories.$TW_Armour_Iron.section = '$WEAPONS & ARMOR';
r = audit(outside, labels);
yes('a group outside our headers is caught', r.some((b) => /\$TW_Armour_Iron is inside \$WEAPONS & ARMOR/.test(b)));
const unnamed = new Map(labels);
unnamed.delete('$TW_Weapons_Iron');
unnamed.set('$TW_Left_Over', 'Left over');
r = audit(cfg, unnamed);
yes('a label with no English line, and a line nothing uses, are caught', r.some((b) => /\$TW_Weapons_Iron has no English line/.test(b)) && r.some((b) => /\$TW_Left_Over has an English line and nothing uses it/.test(b)));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
