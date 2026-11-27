'use strict';
// Build-time evidence for public delivery goods. Delivery never claims that
// the accepting character personally made or harvested the supplied items.
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const hash=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ranks=['novice','advanced','expert','master'];
const recipeFields=['owner','half','rank','out','makes','bench','inputItems','needs'];
// #4676 leaves the burial set on dungeon loot lists. Keep these exact
// published orders available for existing turn-ins after their recipes go away.
const retiredBurialRecipes=new Map([
 ['q-solitude-enchanter-advanced-parcel',{
  pin:'62e017232f60eaa1d8700b6a252fdd8666a6107484468230df7fd5d48936edec',reference:'f46d0:Skyrim.esm',item:'56a9e:Skyrim.esm'}],
 ['q-riften-smith-advanced-parcel',{
  pin:'f9e445a8711b9825fd5117b8f74299d58daa5b3f66eeb190a96e51bb2b892a8c',reference:'f46cc:Skyrim.esm',item:'18388:Skyrim.esm'}]
]);
function retiredBurialGood(id,pin,good,recipes) {
 const retired=retiredBurialRecipes.get(id);
 if(!retired||pin!==retired.pin||good.item!==retired.item||good.recipe?.reference!==retired.reference)return false;
 const actual=recipes[retired.reference];
 if(actual?.book!=='cut'||actual.type!=='ARMO'||!Array.isArray(actual.needs))return false;
 // The original conditions predate the explicit OR flag. An unset flag
 // preserves the old condition; a set flag is a change to the proof.
 const needs=actual.needs.map(need=>{
  if(need?.or!==false)return need;
  const {or,...condition}=need;
  return condition;
 });
 return same(good.recipe,{reference:retired.reference,...Object.fromEntries(recipeFields.map(key=>[key,actual[key]])),needs});
}
function publicRecipe(source,reference,row) {
 return row&&row.fires===true&&row.book!=='cut'&&row.roll===undefined&&row.race===''&&row.inputsWithNoProducer===0&&
  ranks.includes(row.rank)&&Array.isArray(row.inputItems)&&row.inputItems.length>0&&
  row.inputItems.every(input=>input.suppliedBy&&ranks.includes(input.suppliedAt))&&
  (source.roles.evidence[row.out]||[]).includes(row.owner+':recipe:'+reference+':out');
}
function producerMinimum(source) {
 const minimum=new Map(),put=(item,rank)=>minimum.set(item,Math.min(minimum.get(item)??9,rank));
 for(const [reference,row]of Object.entries(source.recipes))if(publicRecipe(source,reference,row))
  put(row.out,Math.max(ranks.indexOf(row.rank),...row.inputItems.map(input=>ranks.indexOf(input.suppliedAt))));
 for(const row of Object.values(source.harvests))if(ranks.includes(row.rank))put(row.produce,ranks.indexOf(row.rank));
 for(const row of Object.values(source.ores))if(ranks.includes(row.rank))put(row.ore,ranks.indexOf(row.rank));
 return minimum;
}
// A commission is admitted on a field-for-field copy of today's source rows.
// Once published (source.published, the activation manifest's id -> sha256)
// its definition is immutable and accepted jobs are bound to its hash, so a
// later change to a row it copied (a recipe moved to its trade's bench, #3120)
// cannot be copied into it. A published one is held to its pin instead, and
// each good to a source that still makes it at no higher rank than its tier.
function validateRankedQuests(doc,source) {
 const fail=()=>{throw Error('Ranked commission source evidence cannot be verified.');};
 const pins=source.published||{};
 doc=JSON.parse(JSON.stringify(doc));
 if(!doc||doc.version!==1||doc.active!==false||doc.complete!==false||!Array.isArray(doc.quests))fail();
 const ids=new Set(),objectives=new Set();
 const minimum=producerMinimum(source);
 for(const row of [...source.legacy,...doc.quests]) {
  if(!row||ids.has(row.id))fail();ids.add(row.id);
  if(row.kind==='commission') {
   const objective=row.goods.map(good=>good.item).sort().join('|');
   if(objectives.has(objective))fail();objectives.add(objective);
  }
 }
 return doc.quests.map(row=>{
  const tier=ranks.indexOf(row.tier),merchant=row.merchant;
  const pinned=Object.prototype.hasOwnProperty.call(pins,row.id);
  if(Object.prototype.hasOwnProperty.call(row,'accepting')||pinned&&hash(row)!==pins[row.id])fail();
  const copied=(proof,actual)=>pinned||same(proof,actual);
  let gate;try{gate=source.gates.validate(row.gate);}catch(error){fail();}
  if(!/^q-[a-z0-9-]{1,46}$/.test(row.id)||typeof row.name!=='string'||!row.name.trim()||typeof row.text!=='string'||!row.text.trim()||
    row.kind!=='commission'||row.deliveryVersion!==2||tier<0||gate.open===true||gate.rank!==row.tier||
    row.cooldownHours!==[6,12,24,48][tier]||!same(row.reward,{source:'merchant-purse',pricing:'submitted-hold-price'})||
    !source.roster.some(candidate=>same(candidate,merchant))||!Array.isArray(row.goods)||row.goods.length<2||row.goods.length>5)fail();
  const table=source.roles.tables[merchant.role];let batches=0,masterBatches=0,expertBatches=0,highest=-1;
  const types={};let accepting=true;
  for(const good of row.goods) {
   const retired=retiredBurialGood(row.id,pins[row.id],good,source.recipes);
   const record=source.roles.records[good.item];
   if(!retired&&(!record||!table.buy.includes(good.item))||
     record&&(record.flags&0x20||['ARMO','WEAP'].includes(record.type)&&record.flags&4||retired&&record.type!=='ARMO')||
     !Number.isSafeInteger(good.count)||good.count<1||good.count>100000||
     ['recipe','harvest','mining'].filter(key=>good[key]).length!==1)fail();
   types[good.item]=retired?'ARMO':record.type;
   if(retired)accepting=false;
   let rank;
   if(good.recipe) {
    const proof=good.recipe,actual=source.recipes[proof.reference];
    if(!retired&&!publicRecipe(source,proof.reference,actual)||actual.out!==good.item||
      !copied(proof,{reference:proof.reference,...Object.fromEntries(recipeFields.map(key=>[key,actual[key]]))})||
      !actual.inputItems.every(item=>item.suppliedBy&&ranks.indexOf(item.suppliedAt)>=0&&ranks.indexOf(item.suppliedAt)<=tier))fail();
    rank=ranks.indexOf(actual.rank);const quantity=Math.ceil(good.count/actual.makes);
    if(!Number.isSafeInteger(quantity)||quantity<1)fail();
    batches+=quantity;if(rank===3&&minimum.get(good.item)===3)masterBatches+=quantity;
    if(rank===2&&actual.owner==='Tailor'&&minimum.get(good.item)===2)expertBatches+=quantity;
   }else if(good.harvest) {
    const proof=good.harvest,actual=source.harvests[proof.reference];
    if(!actual||!copied(proof,{reference:proof.reference,...actual})||actual.produce!==good.item||merchant.role!=='Alchemist')fail();
    rank=ranks.indexOf(actual.rank);
   }else {
    const proof=good.mining,actual=source.ores[proof.reference];
    if(!actual||!copied(proof,{reference:proof.reference,...actual})||actual.ore!==good.item||
      merchant.role!=='Smith'||row.gate.classKey!=='miner')fail();
    rank=ranks.indexOf(actual.rank);
   }
   const producerRank=retired?Math.max(rank,...good.recipe.inputItems.map(input=>ranks.indexOf(input.suppliedAt))):minimum.get(good.item);
   if(rank<0||rank>tier||producerRank===undefined)fail();highest=Math.max(highest,producerRank);
  }
  // Preserve the first published mixed six-batch order exactly. Later Master
  // logistics use six Expert batches; copying its title or ID is insufficient.
  const firstOrder=row.id==='q-whiterun-tailor-winter-vestments'&&require('node:crypto').createHash('sha256')
   .update(JSON.stringify(row)).digest('hex')==='68f0406f1fe3db80d3b820d13413c0419a960da038eef3a54ac103091d9af2e0';
  if(Object.keys(types).length!==row.goods.length||highest!==tier&&!(tier===3&&merchant.role==='Tailor'&&highest===2&&batches>=6&&expertBatches>=(firstOrder?3:6))||
    tier===3&&highest===3&&masterBatches===1)fail();
  return {...row,itemTypes:types,...(accepting?{}:{accepting:false})};
 });
}
module.exports={validateRankedQuests};
