// test-3470-potion-recipes.js
//
// The Physicker's ten potion recipes in game/content/Thornswood-Content.esp
// make what they say, from ingredients that carry the potion's effect and
// that somebody gathers, at a rank that climbs with the strength.
//
// WHY. Issue #3470. Patrick, 26 Oct 2026, A+B on the report page: the dungeon
// pile pays ingredients instead of Skyrim's ten potion records, and the
// Physicker gets a recipe for each record at the alchemy lab. A on 27 Oct:
// the weakest takes two ingredients that share the potion's effect, each step
// up takes one more, and the rank climbs with it (Minor novice, plain
// advanced, Plentiful expert, Vigorous master; the two resists expert, their
// rank in docs/systems/mixtures.md). A recipe whose ingredient does not carry
// the effect would brew nothing in the game's own menu, so each input is held
// to game/data/ingredients.json, which reads the effects off the INGR
// records, and to game/data/item-sources.json, which says who gathers each
// one and at what rank.
//
// Read only. It reads the committed plugin and tables.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

// The ten, by editor id: the potion, how many ingredients, the rank.
const WANT = {
  ThornswoodRecipePotionMinorHealing:     ['3eadd:Skyrim.esm', 2, 'novice'],
  ThornswoodRecipePotionHealing:          ['3eade:Skyrim.esm', 3, 'advanced'],
  ThornswoodRecipePotionPlentifulHealing: ['3eadf:Skyrim.esm', 4, 'expert'],
  ThornswoodRecipePotionVigorousHealing:  ['3eae3:Skyrim.esm', 5, 'master'],
  ThornswoodRecipePotionMinorMagicka:     ['3eae0:Skyrim.esm', 2, 'novice'],
  ThornswoodRecipePotionMagicka:          ['3eae1:Skyrim.esm', 3, 'advanced'],
  ThornswoodRecipePotionMinorStamina:     ['3eae5:Skyrim.esm', 2, 'novice'],
  ThornswoodRecipePotionStamina:          ['39be8:Skyrim.esm', 3, 'advanced'],
  ThornswoodRecipePotionResistFire:       ['39b4a:Skyrim.esm', 2, 'expert'],
  ThornswoodRecipePotionResistShock:      ['39be1:Skyrim.esm', 2, 'expert']
};
const RANKS = ['novice', 'advanced', 'expert', 'master'];
const ALCHEMY_KEYWORD = 0x5042E6B;

// ------------------------------------------------------------ the plugin --

const buf = fs.readFileSync(path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp'));
const masters = [];
{
  const end = 24 + buf.readUInt32LE(4);
  let k = 24;
  while (k + 6 <= end) {
    const t = buf.toString('latin1', k, k + 4), sz = buf.readUInt16LE(k + 4);
    if (t === 'MAST') { masters.push(buf.toString('latin1', k + 6, k + 6 + sz - 1)); }
    k += 6 + sz;
  }
}
function desc(fid) {
  const i = fid >>> 24;
  return (fid & 0xffffff).toString(16) + ':' + (i < masters.length ? masters[i] : 'Thornswood-Content.esp');
}
const recipes = {};
function walk(s, e) {
  let j = s;
  while (j + 24 <= e) {
    const t = buf.toString('latin1', j, j + 4), sz = buf.readUInt32LE(j + 4);
    if (t === 'GRUP') { walk(j + 24, j + sz); j += sz; continue; }
    if (t === 'COBJ') {
      let rec = buf.subarray(j + 24, j + 24 + sz);
      if (buf.readUInt32LE(j + 8) & 0x40000) { rec = zlib.inflateSync(rec.subarray(4)); }
      const r = { inputs: [], out: null, bench: null, makes: 0, edid: '' };
      let k = 0;
      while (k + 6 <= rec.length) {
        const st = rec.toString('latin1', k, k + 4), ss = rec.readUInt16LE(k + 4), d = k + 6;
        if (st === 'EDID') { r.edid = rec.toString('latin1', d, d + ss - 1); }
        if (st === 'CNTO') { r.inputs.push([desc(rec.readUInt32LE(d)), rec.readInt32LE(d + 4)]); }
        if (st === 'CNAM') { r.out = desc(rec.readUInt32LE(d)); }
        if (st === 'BNAM') { r.bench = rec.readUInt32LE(d); }
        if (st === 'NAM1') { r.makes = rec.readUInt16LE(d); }
        k = d + ss;
      }
      if (/^ThornswoodRecipePotion/.test(r.edid)) { recipes[r.edid] = r; }
    }
    j += 24 + sz;
  }
}
walk(24 + buf.readUInt32LE(4), buf.length);

// --------------------------------------------------------------- the rows --

const table = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'ingredients.json'), 'utf8'));
// The ranks each ingredient is gathered at, out of the item source table.
const gatheredAt = new Map();
for (const [desc, item] of Object.entries(JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'item-sources.json'), 'utf8')).items)) {
  const ranks = item.via.filter((v) => v.kind === 'gathered' && v.rank).map((v) => v.rank);
  if (ranks.length) { gatheredAt.set(desc.toLowerCase(), ranks); }
}
// RECIPE_OWNER and RECIPE_RANK, which Build-RecipeTable.ps1 reads from records/recipe-owners.json.
const named = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'recipe-owners.json'), 'utf8'));

yes('the plugin holds the ten potion recipes and no other',
  Object.keys(recipes).sort().join() === Object.keys(WANT).sort().join());
for (const edid of Object.keys(WANT)) {
  const [potion, count, rank] = WANT[edid];
  const r = recipes[edid];
  if (!r) { yes(edid + ' is in the plugin', false); continue; }
  const effects = (table.potions[potion] || {}).effects || [];
  yes(edid + ' makes one ' + potion + ' at the alchemy lab',
    r.out === potion && r.makes === 1 && r.bench === ALCHEMY_KEYWORD && effects.length === 1);
  yes('...from ' + count + ' different ingredients, one of each',
    r.inputs.length === count && new Set(r.inputs.map((x) => x[0])).size === count && r.inputs.every((x) => x[1] === 1));
  const bad = r.inputs.filter((x) => ((table.ingredients[x[0]] || {}).effects || []).indexOf(effects[0]) < 0);
  yes('...every one carrying ' + effects[0] + (bad.length ? ' (not: ' + bad.map((x) => x[0]).join(', ') + ')' : ''), bad.length === 0);
  const above = r.inputs.filter((x) => {
    const at = gatheredAt.get(x[0].toLowerCase()) || [];
    return !at.some((k) => RANKS.indexOf(k) >= 0 && RANKS.indexOf(k) <= RANKS.indexOf(rank));
  });
  yes('...and every one gathered at ' + rank + ' or below' + (above.length ? ' (not: ' + above.map((x) => x[0]).join(', ') + ')' : ''),
    above.length === 0);
  yes('...ranked ' + rank + ' and named to the Physicker in records/recipe-owners.json',
    !!named.rank[edid] && named.rank[edid].Rank === rank &&
    !!named.owner[edid] && named.owner[edid].Owner === 'Alchemist' && named.owner[edid].Half === 'Physicker');
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
