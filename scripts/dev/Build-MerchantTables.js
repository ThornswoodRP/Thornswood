'use strict';
// The merchant catalogues are gamemode tables (game/gamemode-tables, #5191),
// built here from game/data and the load order and checked against their
// sources. They are a step of the content chain (scripts/mods/content-tables.json).
// The code that reads them with table() is Build-MerchantGamemode.js, which
// is not in the chain, so a content build never carries gamemode code (#6195).
// --tables <folder> writes them somewhere else; --check says whether they are current.
const fs = require('node:fs');
const path = require('node:path');
const gamemodeSource = require('./gamemode-source.js');
const TABLES = require(path.join(__dirname, 'GamemodeTables.js'));
const opts = TABLES.options(process.argv.slice(2), ['--tables'], ['--check']);
if (!opts) return;
const tablesDir = opts['--tables'] || TABLES.DIR;
const root = path.join(__dirname, '../..');
const modePath = path.join(root, 'game/gamemode');
const old = gamemodeSource.read(modePath).replace(/\r\n/g, '\n');
// The progression block (read, never written) gives the quest gates SPELL_IDS
// with the gamemode's table().
const progression={table:name=>TABLES.read(name,tablesDir)};
require('node:vm').runInNewContext(old.slice(old.indexOf('// ==== thornswood progression ===='),old.indexOf('// ==== end thornswood progression ====')),progression);
const gates=require(path.join(root,'game/quest-eligibility.js')).createQuestEligibility({
  table:progression.__thornswoodProgression.TABLE,spellIds:progression.__thornswoodProgression.SPELL_IDS});
const scarceGeodes=require(path.join(root,'scripts/dev/MerchantScarceGeodeSources.js')).validateScarceGeodes(
 require(path.join(root,'game/data/merchant-scarce-geodes.json')),require(path.join(root,'game/data/npc-population.json')));
const scarceHarvest=require(path.join(root,'scripts/dev/MerchantScarceHarvestSources.js')).validateScarceHarvest(
 require(path.join(root,'game/data/merchant-scarce-harvest.json')),require(path.join(root,'game/data/npc-population.json')));
const scarceFishing=require(path.join(root,'scripts/dev/MerchantScarceFishingSources.js')).validateScarceFishing(
 require(path.join(root,'game/data/merchant-scarce-fishing.json')),require(path.join(root,'game/data/resource-locations.json')));
const scarceLongfin=require(path.join(root,'scripts/dev/MerchantScarceLongfinSources.js')).longfinSources(
 require(path.join(root,'game/data/quest-content.json')));
const retrievalData=require(path.join(root,'scripts/dev/MerchantRetrievalSources.js')).validateRetrievalSources(
 require(path.join(root,'game/data/merchant-retrievals.json')),require(path.join(root,'game/data/npc-population.json')),
 fs.readFileSync(path.join(root,'game/content/Thornswood-Content.esp')),require(path.join(root,'game/data/merchant-roster.json')));
const orchardData=require(path.join(root,'game/data/merchant-orchard.json'));
const sites = JSON.parse(fs.readFileSync(path.join(root, 'game/data/guild-sites.json'), 'utf8')).sites;
const traders = JSON.parse(fs.readFileSync(path.join(root, 'game/data/merchant-traders.json'), 'utf8'));
const roster = JSON.parse(fs.readFileSync(path.join(root, 'game/data/merchant-roster.json'), 'utf8'));
const roles = JSON.parse(fs.readFileSync(path.join(root, 'game/data/merchant-role-tables.json'), 'utf8'));
const quests = JSON.parse(fs.readFileSync(path.join(root, 'game/data/merchant-quests.json'), 'utf8'));
const activation = JSON.parse(fs.readFileSync(path.join(root, 'game/data/merchant-quest-activation.json'), 'utf8'));
const ranked=require(path.join(root,'scripts/dev/MerchantQuestSources.js')).validateRankedQuests(
  JSON.parse(fs.readFileSync(path.join(root,'game/data/merchant-ranked-quests.json'),'utf8')),
  {legacy:quests.quests,roster:roster.merchants,roles,gates,
   published:Object.fromEntries((Array.isArray(activation.commissions)?activation.commissions:[]).map(pin=>[pin.id,pin.sha256])),
   recipes:require(path.join(root,'game/data/recipes.json')).recipes,
   harvests:require(path.join(root,'game/data/harvests.json')).harvests,ores:require(path.join(root,'game/data/ores.json')).ores});
if(activation.version!==1 || !Array.isArray(activation.killScenes) || activation.killScenes.length>4 ||
    new Set(activation.killScenes.map(row=>row.id)).size!==activation.killScenes.length)
  throw new Error('Invalid merchant quest activation manifest');
const expandedRows = activation.killScenes.map(pin=>{
  const matches=quests.quests.filter(row=>row.id===pin.id),row=matches[0];
  if(matches.length!==1 || row.kind!=='kill' ||
      require('node:crypto').createHash('sha256').update(JSON.stringify(row)).digest('hex')!==pin.sha256)
    throw new Error('An activated merchant quest changed. Preserve published definitions and use a new ID.');
  return Object.assign({},row,{sourceHash:pin.sha256});
});
const publishedCommissions=require(path.join(root,'game/merchant-commissions.js')).publication;
if(!Array.isArray(activation.commissions)||activation.commissions.length!==Object.keys(publishedCommissions).length||
    activation.commissions.some(pin=>!pin||publishedCommissions[pin.id]!==pin.sha256)||
    new Set(activation.commissions.map(row=>row.id)).size!==activation.commissions.length)
  throw new Error('Invalid commission activation manifest');
const commissionSources=quests.quests.concat(ranked);
const commissionRows=activation.commissions.map(pin=>{
  const matches=commissionSources.filter(row=>row.id===pin.id);
  if(matches.length!==1||matches[0].kind!=='commission')
    throw new Error('An activated commission changed. Preserve published definitions and use a new ID.');
  const {itemTypes,accepting,...row}=matches[0];
  if((row.deliveryVersion!==2&&(itemTypes!==undefined||accepting!==undefined))||
    require('node:crypto').createHash('sha256').update(JSON.stringify(row)).digest('hex')!==pin.sha256)
    throw new Error('An activated commission changed. Preserve published definitions and use a new ID.');
  const firstItem=row.goods[0].item;
  const type=row.deliveryVersion===2?itemTypes?.[firstItem]:roles.records[firstItem]?.type;
  if(!type)throw new Error('Commission item has no verified source record.');
  return Object.assign({},row,{sourceHash:pin.sha256,itemType:type,
    ...(row.deliveryVersion===2?{itemTypes}:{}),...(accepting===false?{accepting:false}:{})});
});
// THE GUILD'S STARTING REWARD PRICES (#6180, Patrick's answer on the page,
// 15 Nov 2026, q-6180-guild-prices: "Guild work should be set by staff, give
// them all starting reward prices. The NPCs still wont buy or sell until
// ledgers are submitted"). A commission pays each good's count times its
// reward price; staff change a price in the game (/book reward), and the
// traders' own buying and selling still come only from submitted ledgers.
// Each good starts at the median, over the commissions that ask for it, of
// its share of a tier's pay spread evenly over that commission's goods:
// about 15 gold for novice work, 30 for advanced, 60 for expert and 120 for
// master. At least 1 gold, rounded to the nearest gold.
const REWARD_TARGETS={novice:15,advanced:30,expert:60,master:120};
const itemNames=TABLES.read('ITEM_NAMES',tablesDir);
const nameOf={};
for(const key of Object.keys(itemNames)){const pair=itemNames[key];if(Array.isArray(pair)&&!nameOf[String(pair[1]).toLowerCase()])nameOf[String(pair[1]).toLowerCase()]=String(pair[0]);}
const shares={};
for(const row of commissionRows){
  const target=REWARD_TARGETS[row.tier],goods=row.goods,count=goods.reduce((sum,good)=>sum+good.count,0);
  if(!target||!count)throw new Error('Commission '+row.id+' has no tier pay or no goods.');
  for(const good of goods)(shares[good.item]=shares[good.item]||[]).push(target/count);
}
const median=list=>{const sorted=list.slice().sort((a,b)=>a-b),mid=sorted.length>>1;return sorted.length%2?sorted[mid]:(sorted[mid-1]+sorted[mid])/2;};
const rewardPrices={version:1,targets:REWARD_TARGETS,items:Object.keys(shares).sort().map(item=>{
  const record=roles.records[item];
  return {item,name:nameOf[item.toLowerCase()]||record.edid,gold:Math.max(1,Math.round(median(shares[item])))};
})};
const roleItems = new Set(Object.values(roles.tables).flatMap(table => Object.values(table).flat()));
const stage = {version:1,history:roster.history,merchants:roster.merchants,tables:roles.tables,
  types:Object.fromEntries(Array.from(roleItems,desc=>[desc,roles.records[desc].type]))};
// Each catalogue is read with table() every time the bundle hands it out, so
// each caller gets its own copy, as it did when the literal stood in the code.
const tables = {
  MERCHANT_GUILD_SITES: sites, MERCHANT_TRADERS: traders, MERCHANT_STAGE: stage,
  MERCHANT_COMMISSION_ROWS: commissionRows, MERCHANT_ORCHARD: orchardData, MERCHANT_RETRIEVALS: retrievalData,
  MERCHANT_SCARCE_LONGFIN: scarceLongfin, MERCHANT_SCARCE_GEODES: scarceGeodes, MERCHANT_SCARCE_HARVEST: scarceHarvest,
  MERCHANT_SCARCE_FISHING: scarceFishing, MERCHANT_KILL_SCENES: expandedRows,
  COMMISSION_REWARD_PRICES: rewardPrices,
};
if (opts['--check']) {
  const stale = Object.keys(tables).filter(name => !TABLES.isCurrent(name, tables[name], tablesDir));
  if (stale.length) throw new Error('Merchant tables ' + stale.join(', ') + ' are stale. Run scripts/dev/Build-MerchantTables.js.');
  console.log('PASS merchant tables match their sources');
} else {
  for (const name of Object.keys(tables)) TABLES.write(name, tables[name], tablesDir);
}
