'use strict';
// Whole gamemode and the actual CraftService event order over the stand-in.
// A stale or modified menu still reaches the server's authoritative gate.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const standIn = require('../../tests/stand-in-server');
const tables = require('../../tests/gamemode-tables');
const t = standIn.checks(), yes = t.yes;
const recipes = JSON.parse(fs.readFileSync(path.join(standIn.REPO_DIR, 'game/data/recipes.json'), 'utf8')).recipes;
const rows = tables.table('RECIPES_BY_ID'), benches = tables.table('BENCH_BY_BASE');
const recosted = tables.table('RECIPES_SET_IN_GAME'), moved = tables.table('RECIPES_MOVED_IN_GAME');
const w = standIn.world({name:'4911-craft-preflight'});
try {
const CITY = '1691d:Skyrim.esm', HAMMER = w.idOf('5cae1:Skyrim.esm');
const COAL = w.idOf('15481:Thornswood-Content.esp');
const cases = [
  {label:'rank', desc:'dc9ff:Skyrim.esm', reason:/Advanced Platewright/},
  {label:'sister half', desc:'a5cd6:Skyrim.esm', reason:/sister half/},
  {label:'nobody', desc:'108cfd:Skyrim.esm', reason:/Nobody makes that here/},
  {label:'race', desc:'bfee5:Playable Rieklings.esp', reason:/Only a Riekling/},
  {label:'profession', desc:'dca01:Skyrim.esm', prof:'tailor', half:'haberdasher', reason:/Only a Platewright/},
  {label:'no profession', desc:'dca01:Skyrim.esm', character:{prof:null,half:null,ranks:{}}, reason:/not chosen a profession/},
  {label:'roll', desc:'dc9f9:Skyrim.esm', reason:/Only the embassy roll/},
  {label:'old recosted ID', desc:'286a:Hothtrooper44_ArmorCompilation.esp',
    prof:'tailor',half:'haberdasher',reason:/takes different materials/},
  {label:'old moved ID', desc:'231c6:Hothtrooper44_ArmorCompilation.esp',
    prof:'tailor',half:'haberdasher',bench:moved['231c6:Hothtrooper44_ArmorCompilation.esp'].from,
    reason:/not made at this bench/},
  // Since #7184 the Eyepatch lists its Leather Strips, not the gold every
  // game takes out, so it is novice work. Another trade is still refused,
  // and a Haberdasher with no shears is told so before any wait (#7226).
  {label:'recosted recipe, another trade', desc:'286a:Hothtrooper44_ArmorCompilation.esp',
    prof:'smith',half:'platewright',remapped:true,reason:/Only a Haberdasher/,
    inputs:recosted['286a:Hothtrooper44_ArmorCompilation.esp'].inputs.filter(x => x[2]).map(x => ({item:x[0],count:x[2]}))},
  {label:'recosted recipe, no shears', desc:'286a:Hothtrooper44_ArmorCompilation.esp',
    prof:'tailor',half:'haberdasher',remapped:true,reason:/pair of shears/,
    inputs:recosted['286a:Hothtrooper44_ArmorCompilation.esp'].inputs.filter(x => x[2]).map(x => ({item:x[0],count:x[2]}))},
  {label:'moved recipe', desc:'231c6:Hothtrooper44_ArmorCompilation.esp',
    // Linen now has its novice supplier; Troll Fat sets this row's Advanced rung.
    prof:'tailor',half:'haberdasher',remapped:true,reason:/Advanced Haberdasher/,
    bench:moved['231c6:Hothtrooper44_ArmorCompilation.esp'].to,
    inputs:moved['231c6:Hothtrooper44_ArmorCompilation.esp'].inputs.map(x => ({item:x[0],count:x[1]}))},
];
function fixture(desc, index, options = {}) {
  const raw = recipes[desc];
  assert(raw && rows[desc], desc + ' must be an actual server-owned recipe');
  const base = Object.keys(benches).find(key => benches[key] === (options.bench || raw.bench));
  assert(base, desc + ' must have a classified bench');
  w.record(base, 'FURN');
  const pos = [1000+index*2000,0,0], bench = w.ref(0xff200100+index,{base,cell:CITY,pos});
  const craft = {recipe:options.remapped ? 0 : w.idOf(desc),output:w.idOf(raw.out),count:raw.makes || 1,
    inputs:(options.inputs || raw.inputItems).map(x => ({baseId:w.idOf(x.item),count:x.count}))};
  const actor = w.person(0xff001000+index,{profileId:1000+index*2,name:'Maker '+index,
    prof:options.prof || 'smith',half:options.half || 'platewright',character:options.character,
    cell:CITY,pos:[pos[0]+40,0,0],inventory:{entries:[
      {baseId:15,count:40},{baseId:HAMMER,count:1},{baseId:COAL,count:10}
    ].concat(craft.inputs.map(x => ({baseId:x.baseId,count:x.count*3})))}});
  w.row(actor).thornswoodNeeds={food:90,drink:90,rest:90,temp:50,at:w.now()};
  return {actor,bench,craft};
}
cases.forEach((row,index) => Object.assign(row,fixture(row.desc,index,row)));
const normal = fixture('dca01:Skyrim.esm',cases.length);
const eyepatchDesc = '286a:Hothtrooper44_ArmorCompilation.esp';
const noviceRecosted = fixture(eyepatchDesc,cases.length+1,{prof:'tailor',half:'haberdasher',remapped:true,
  inputs:recosted[eyepatchDesc].inputs.filter(x => x[2]).map(x => ({item:x[0],count:x[2]}))});
w.row(noviceRecosted.actor).inventory.entries.push({baseId:w.idOf('1b000:Thornswood-Content.esp'),count:1});
yes('the whole gamemode loads',w.boot());
if (!w.loaded()) { t.done(w); }
cases.concat(normal,noviceRecosted).forEach(row => w.arrive(row.actor));
w.run(30000);
const pack = actor => JSON.stringify(w.row(actor).inventory);
const character = actor => JSON.stringify(w.row(actor).thornswoodCharacter);
const last = actor => w.heard(actor).slice(-1)[0] || '';
const completed = () => w.did.filter(row => row[2] === 'event' && row[3] === 'onCraft').length;
for (const row of cases) {
  const {actor,bench,craft} = row;
  const args = [actor,craft.output,craft.count,craft.recipe,bench,null,craft.inputs,[]];
  const beforePack = pack(actor), beforeCharacter = character(actor);
  yes(row.label + ': completion still refuses with its canonical reason',
    w.fire('onCraft',args) === false && row.reason.test(last(actor)));
  const reason = last(actor), beforeTime = w.now(), beforeCompletion = completed();
  const heard = w.heard(actor).length;
  const result = w.craft(actor,bench,craft);
  yes(row.label + ': the same refusal is given before any wait or completion event',
    !result.started && !result.made && result.workMs === 0 && w.now() === beforeTime
    && completed() === beforeCompletion && last(actor) === reason
    && !w.heard(actor).slice(heard).some(line => /Stay at the bench|takes \d+ seconds?/.test(line)));
  yes(row.label + ': no ingredients, fuel, tool use or progression were spent',
    pack(actor) === beforePack && character(actor) === beforeCharacter);
}
const {actor,bench,craft} = normal;
const beforePack = pack(actor), beforeCharacter = character(actor), beforeCoal = w.count(actor,COAL);
const beforeInputs = craft.inputs.map(x => w.count(actor,x.baseId));
let preflightUnchanged = false;
const begin = w.now(), beforeCompletion = completed();
const allowed = w.craft(actor,bench,craft,() => {
  preflightUnchanged = pack(actor) === beforePack && character(actor) === beforeCharacter;
});
yes('allowed work keeps its five-second delay and performs no preflight spending or credit',
  preflightUnchanged && allowed.started && allowed.made && allowed.workMs === 5000
  && w.now() === begin+5000 && completed() === beforeCompletion+1);
// Since #6726 the charcoal is an input on the record, so the server takes
// none on top of the inputs the craft names.
yes('allowed completion spends the original inputs and nothing more, and makes one output',
  w.count(actor,craft.output) === craft.count
  && craft.inputs.every((x,i) => w.count(actor,x.baseId) === beforeInputs[i]-x.count)
  && (craft.inputs.some(x => x.baseId === COAL) || w.count(actor,COAL) === beforeCoal));
{
  const {actor,bench,craft} = noviceRecosted;
  const beforePack = pack(actor), beforeCharacter = character(actor), beforeCoal = w.count(actor,COAL);
  const beforeInputs = craft.inputs.map(x => w.count(actor,x.baseId));
  const beforeCompletion = completed(), begin = w.now();
  let unchanged = false;
  const made = w.craft(actor,bench,craft,() => {
    unchanged = pack(actor) === beforePack && character(actor) === beforeCharacter;
  });
  yes('canonical novice Eyepatch remains allowed after recosting without preflight spending',
    rows[eyepatchDesc].rank === 'novice' && unchanged && made.started && made.made && made.workMs === 5000
    && w.now() === begin+5000 && completed() === beforeCompletion+1);
  yes('novice recosted completion spends its canonical inputs once and makes one output',
    w.count(actor,craft.output) === craft.count
    && craft.inputs.every((x,i) => w.count(actor,x.baseId) === beforeInputs[i]-x.count)
    && w.count(actor,COAL) === beforeCoal);
}
const unknown = {recipe:w.idOf('abcdef:Skyrim.esm'),output:w.idOf('abcdee:Skyrim.esm'),inputs:[]};
const unclassified = w.craft(actor,bench,unknown);
yes('a recipe with no known row retains its existing allowance and default time',
  unclassified.started && unclassified.made && unclassified.workMs === 5000);
const remaining = pack(actor), output = w.count(actor,craft.output);
const changed = w.craft(actor,bench,craft,() => {
  const state = w.row(actor).thornswoodCharacter;
  state.prof='tailor';state.half='haberdasher';state.ranks={haberdasher:'novice',clothier:'novice'};
});
yes('eligibility changing during the wait is checked again at completion',
  changed.started && !changed.made && changed.workMs === 5000
  && /Only a Platewright/.test(last(actor)) && pack(actor) === remaining
  && w.count(actor,craft.output) === output);
const legacy = cases[0];
const legacyRow = w.row(legacy.actor);
delete legacyRow.thornswoodCharacter;
legacyRow.thornswoodChargen = {class:'smith', half:'platewright'};
const legacySnapshot = JSON.stringify(legacyRow.thornswoodChargen);
const legacyPack = pack(legacy.actor);
const legacyArgs = [legacy.actor,legacy.craft.output,legacy.craft.count,legacy.craft.recipe,legacy.bench,null,legacy.craft.inputs,[]];
yes('staged craft permission reads the legacy trade without starting work',
  w.fire('onCraftWork',legacyArgs) === false && /Advanced Platewright/.test(last(legacy.actor)));
yes('craft preflight never saves a migrated character or changes the old record',
  legacyRow.thornswoodCharacter === undefined && JSON.stringify(legacyRow.thornswoodChargen) === legacySnapshot &&
  pack(legacy.actor) === legacyPack);
yes('no handler or timer throws',w.faults.length === 0 && w.threw.length === 0
  && w.logged(/\] on[A-Z][A-Za-z]+ threw/).length === 0);
t.done(w);
} finally {
  w.done();
}
