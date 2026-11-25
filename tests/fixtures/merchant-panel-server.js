'use strict';
// Local browser fixture for the actual CEF trader panel. No game/server writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const base={open:true,sessionId:'fixture-1',transfer:true,canTrade:true,sellReason:'',trader:'Guild trader',place:'Whiterun',purse:250,
  offers:[{name:'Iron Ingot',buy:3,sell:5,stock:4,carried:8,maxSell:8}],supply:[],quests:[
    {id:'ebony',name:'The ebony',who:'Miner, master',ask:4,holds:12,hours:24,state:'available',drawn:0,
      gems:[],locations:'Raven Rock Mine',canTake:true,canReturn:false,canAbandon:false},
    {id:'gem',name:'A gem',who:'Miner, master',ask:2,holds:6,hours:24,state:'available',drawn:0,
      gems:['Ruby','Sapphire','Emerald','Amethyst'],locations:{Ruby:'White Ridge Sanctum',Sapphire:'Highpoint Tower',Emerald:'Kolbjorn Barrow',Amethyst:'Highpoint Tower'},
      canTake:true,canReturn:false,canAbandon:false},
    {id:'stalhrim',name:'The stalhrim',who:'Miner, master',ask:3,holds:8,hours:24,state:'locked',drawn:0,
      gems:[],locations:'Kolbjorn Barrow',canTake:false,canReturn:false,canAbandon:false},
    {id:'heartstone',name:'The heart stone',who:'Miner, master',ask:3,holds:8,hours:24,state:'cooldown',drawn:0,waitMinutes:80,
      gems:[],locations:'Coldcinder Cave',canTake:false,canReturn:false,canAbandon:false}
  ]};
const panel=path.join(__dirname,'../../game/ui/thornswood-merchant.js');
http.createServer((req,res)=>{
  if(req.url==='/merchant.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(panel));return;}
  const data=JSON.parse(JSON.stringify(base));
  if(new URL(req.url,'http://localhost').searchParams.get('scenario')==='retrieval') {
    data.trader='Cook';data.place='Eastmarch';data.quests=[{id:'dispatch',name:'The dispatch',kind:'retrieval',who:'Open to anyone',
      state:'open',drawn:1,gold:60,hours:12,locations:'Halted Stream Camp. Return to the Eastmarch Cook.',
      canTake:false,canReturn:true,canAbandon:true}];
  }
  if(new URL(req.url,'http://localhost').searchParams.get('scenario')==='supply') {
    data.supply=[{name:'Iron Ingot',pay:15,unit:3,count:5,ready:true}];
  }
  if(new URL(req.url,'http://localhost').searchParams.get('scenario')==='empty-purse') {
    data.purse=0;data.offers[0].maxSell=0;data.sellReason='This trader cannot afford the goods you are carrying.';
  }
  if(new URL(req.url,'http://localhost').searchParams.get('scenario')==='open') {
    Object.assign(data.quests[0],{state:'open',drawn:6,canTake:false,canReturn:true,canAbandon:true});
    Object.assign(data.quests[1],{state:'open',drawn:1,gem:'Ruby',canTake:false,canReturn:false,canAbandon:true});
  }
  if(new URL(req.url,'http://localhost').searchParams.get('scenario')==='kills') {
    data.quests=[
      {id:'wolf',name:'A wolf',kind:'kill',count:1,kills:0,gold:25,hours:3,state:'available',locations:'White River Watch',canTake:true},
      {id:'camp',name:'The camp',kind:'kill',count:3,kills:2,gold:45,hours:6,state:'open',locations:'Halted Stream Camp',canReturn:false,canAbandon:true},
      {id:'giant',name:'A giant',kind:'kill',count:1,kills:1,gold:100,hours:18,state:'open',locations:'Bleakwind Basin',canReturn:true,canAbandon:true},
      {id:'bear',name:'A bear',kind:'kill',count:1,kills:0,gold:50,hours:8,state:'open',locations:'Pinepeak Cavern',canReturn:false,canAbandon:true,recovery:true}
    ];
  }
  if(new URL(req.url,'http://localhost').searchParams.get('scenario')==='expanded') {
    data.quests=[
      {id:'q-whiterun-tailor-cloth-road',name:'Novice: A clear road for cloth',who:'Novice Warrior',kind:'kill',
       count:1,kills:1,gold:15,hours:6,state:'open',locations:"Redoran's Retreat",canReturn:true,canAbandon:true,
       token:7,exactMerchant:true,check:'Defeat the marked bandit and return to this Tailor. New guild jobs share a 150-gold daily payment limit.'},
      {id:'q-winterhold-enchanter-coast',name:'Novice: Coastal preparations',who:'Novice Mage',kind:'kill',
       count:1,kills:0,gold:10,hours:6,state:'locked',locations:'Winterhold coast',canTake:false,exactMerchant:true},base.quests[1]
    ];
  }
  const commissionScenario=new URL(req.url,'http://localhost').searchParams.get('scenario')||'';
  if(commissionScenario.startsWith('commissions')) {
    data.trader='Smith';data.reservedPurse=9;
    data.quests=[
      {id:'q-whiterun-smith-straps',name:'Novice: Straps for the forge',who:'smith, platewright, novice',kind:'commission',
       count:6,item:'Leather',gold:18,quotedUnit:3,hours:6,state:'available',locations:'Whiterun; return to this Smith.',canTake:true,
       check:'The Smith needs six pieces of leather for straps at the forge.'},
      {id:'q-whiterun-smith-spare-pick',name:'Novice: A spare pick for the mine',who:'miner, novice',kind:'commission',
       count:1,item:'Pickaxe',gold:9,quotedUnit:9,hours:6,state:'open',locations:'Whiterun; return to this Smith.',
       canReturn:true,canAbandon:true,token:17}
    ];
    if(commissionScenario==='commissions-no-price')Object.assign(data.quests[0],{
      state:'unavailable',canTake:false,gold:null,quotedUnit:null,check:'Staff have set no reward for this work.'});
    if(commissionScenario==='commissions-waiting') {
      data.canTrade=false;data.offers[0].maxSell=0;data.sellReason='This trader is finishing a saved transfer.';
      Object.assign(data.quests[0],{state:'unavailable',canTake:false,check:data.sellReason});
      Object.assign(data.quests[1],{waiting:true,canReturn:false,canAbandon:false,check:data.sellReason});
    }
  }
  if(commissionScenario==='bundles') {
    data.trader='Woodworker';data.reservedPurse=72;
    data.quests=[
      {id:'q-whiterun-woodworker-outfitter-reserve',name:"Master: An outfitter's last reserve",who:'woodworker, woodwright, master',kind:'commission',
       goods:[{count:1,name:'Master Fishing Pole'},{count:24,name:'Ebony Arrow'}],gold:72,quoteToken:'b'.repeat(64),hours:48,
       state:'available',locations:'Whiterun; return to this Woodworker.',canTake:true},
      {id:'q-whiterun-alchemist-travelling-case',name:"Expert: A field medic's travelling case",who:'alchemist, physicker, expert',kind:'commission',
       goods:[{count:2,name:"Physicker's Remedy"},{count:4,name:'Nirnroot'}],gold:36,hours:24,state:'open',
       locations:'Whiterun; return to this Alchemist.',canReturn:true,canAbandon:true,token:21}
    ];
  }
  res.setHeader('Content-Type','text/html');
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Merchant panel fixture</title>'+
    '<body style="margin:0;background:#302820"><div style="position:fixed;top:0;left:0;color:white;z-index:2147483500"><output id="commands"></output>'+
    '<button onclick="window.rejectCommand=true">Reject commands</button><button onclick="window.thornswoodMerchant.setData(window.fixtureData)">Same session update</button>'+
    '<button onclick="window.fixtureData.sessionId=\'fixture-2\';window.thornswoodMerchant.setData(window.fixtureData)">New activation</button></div>'+
    '<script>window.skyrimPlatform={sendMessage:function(){}};window.thornswoodNet={say:function(line){document.getElementById("commands").textContent=line;return window.rejectCommand!==true;}};</script>'+
    '<script src="/merchant.js"></script><script>window.fixtureData='+JSON.stringify(data)+';window.thornswoodMerchant.setData(window.fixtureData);</script></body></html>');
}).listen(0,'127.0.0.1',function(){console.log('Merchant fixture http://127.0.0.1:'+this.address().port);});
