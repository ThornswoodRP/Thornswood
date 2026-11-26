'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createMerchantTrading}=require('../merchant-trading');
const {createQuestEligibility}=require('../quest-eligibility');
const source=fs.readFileSync(require.resolve('./test-merchant-trading.js'),'utf8');
const {memoryPurses,worldOf}=vm.runInNewContext(source.slice(source.indexOf('function memoryPurses'),source.indexOf('const places'))+'\n({memoryPurses,worldOf});');
const rules=createQuestEligibility({table:{ranks:['novice','advanced','expert','master'],classes:{hunter:{name:'Hunter'}},
  professions:{smith:{name:'Smith',halves:{platewright:'Platewright'}}},schools:[],spells:{}},spellIds:{}});
const cases=[
  ['class',{classKey:'hunter',rank:'expert'},{v:1,cls:'miner',ranks:{}},/Hunter class/],
  ['profession',{profession:'smith',half:'platewright',rank:'expert'},{v:1,prof:'cook',ranks:{}},/Smith profession/],
  ['rank',{profession:'smith',half:'platewright',rank:'expert'},{v:1,prof:'smith',ranks:{platewright:'advanced'}},/Expert.*Platewright/],
  ['cooldown',{classKey:'hunter',rank:'expert'},null,/2 minutes/],
  ['success',{classKey:'hunter',rank:'expert'},null,/You take the work/],
];
for(const [name,gate,standing,expected] of cases) {
  const world=worldOf({on:true}),reference='1:Skyrim.esm',job='q-test-work',at=1_700_000_000_000;
  const key=require('../merchant-commission-state').key(world.transfer.identity(10),job);
  const state={version:1,reference,base:'a:Skyrim.esm',purse:250,stock:[],supply:{}};
  if(name==='cooldown') state.commissions={v:1,serial:1,held:{},cool:{[key]:at-6*3600000+61000}};
  const purses=memoryPurses([[1,state]]);
  purses.stats=()=>({catalogue:1});purses.ledgerStates=()=>[{reference,state:purses.read(1)}];
  const character=standing||{v:1,cls:'hunter',ranks:{hunter:'expert'}};
  const api=createMerchantTrading({world,purses,transfer:world.transfer,isTrader:id=>id===1,now:()=>at,
    places:{[reference]:{name:'Trader',hold:'Whiterun',bookHold:'whiterun',locationName:'Whiterun'}},
    prices:{catalog:()=>[]},rewards:{price:()=>({name:'Iron Ingot',gold:2})},
    commissionEligible:(_,g)=>rules.check(g,character),
    commissions:[{id:job,name:'Test work',tier:'expert',text:'Bring ingots.',who:'Test requirement',gate,
      merchantId:1,merchantRef:reference,role:'Smith',hold:'Whiterun',itemId:100,itemDesc:'5ace4:Skyrim.esm',count:3,sourceHash:'a'.repeat(64)}]});
  const command=(...parts)=>api.command({actorId:10,profileId:7,parts:['/merchant',...parts]});
  const before=command('1').view.quests.find(row=>row.id===job);
  const answer=command('quest','take',job,'@2'),after=purses.read(1);
  assert.equal(answer.view.note,answer.text);
  assert.match(answer.text,expected);
  if(name==='success') {
    assert.equal(before.canTake,true);
    assert.equal(after.commissions.held[key].gold,6);
    assert.equal(after.purse,250);
    assert.equal(world.inv[10][100],8);
  } else {
    assert.equal(before.canTake,false);
    if(name==='cooldown') { assert.equal(before.waitMinutes,2); assert.match(before.check,/Come back in 2 minutes\.$/); }
    else assert.match(before.check,expected);
    assert.deepEqual(JSON.parse(JSON.stringify(after)),state);
  }
  console.log('PASS '+name+': '+answer.text);
}
