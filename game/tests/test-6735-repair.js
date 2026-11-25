'use strict';
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
const copy = x => JSON.parse(JSON.stringify(x));
const le32 = n => [n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
for (const server of ['main','dev']) {
  const w = standIn.world({name:'6735-repair',settings:{thornswoodServer:server,
    thornswoodPlaytesters:[302],thornswoodDevs:[303],thornswoodAdmins:[304]}});
  w.record('12eb7:Skyrim.esm','WEAP');
  w.record('13952:Skyrim.esm','ARMO',{fields:[{type:'BOD2',data:le32(1<<2).concat(le32(1))}]});
  w.record('1cf2b:Skyrim.esm','ARMO',{fields:[{type:'BOD2',data:le32(1<<6).concat(le32(2))}]});
  w.record('e3c16:Skyrim.esm','WEAP');
  const actors=[301,302,303,304,305,306].map((profileId,i) => w.person(0xff006750+i,{
    profileId,name:['Guest','Tester','Helper','Admin','Alia West','Alia East'][i],cell:'3c:Skyrim.esm'}));
  const [GUEST,TESTER,HELPER,ADMIN,WEST] = actors;
  yes(server+' whole gamemode loads',w.boot());
  if (!w.loaded()) {t.done(w);continue;}
  actors.forEach(w.arrive);w.run(30000);
  w.run=()=>w.box().__thornswoodCommandTimer.fn();
  const sword={baseId:0x12eb7,count:2,name:'Aldis Blade (25%)',health:1.4,enchantmentId:0x1234,
    maxCharge:99,chargePercent:0.7,removeEnchantmentOnUnequip:false,poisonId:0x4567,poisonCount:2,
    madeEnchantment:{effects:[{effectId:0x6789,magnitude:5,area:0,duration:10}]}};
  function seed(actor) {
    w.row(actor).inventory={entries:[copy(sword),{baseId:0x13952,count:1,name:'Forged Armour (120%)',health:1.6},
      {baseId:0x1cf2b,count:1,name:'Ring (10%)'},{baseId:0xe3c16,count:1,name:'Pickaxe (10%)'},
      {baseId:15,count:40}]};
    w.row(actor).equipment={inv:{entries:[Object.assign(copy(sword),{count:1,worn:true})]},
      numChanges:12,leftSpell:0,rightSpell:0,voiceSpell:0,instantSpell:0};
  }
  actors.forEach(seed);
  // Contract-only shim: records one native request and supplies the configured
  // response. Native validation and atomicity are proved by the engine suite.
  let calls=[],answer=true;
  w.mp().compareAndSetActorInventoryAndEquipment=function(actor,profile,change) {
    calls.push({actor,profile,change:copy(change)});
    if(answer==='throw')throw Error('fixture engine refused');
    if(!answer)return false;
    w.row(actor).inventory=copy(change.replacementInventory);
    w.row(actor).equipment=copy(change.replacementEquipment);
    return true;
  };
  function ask(actor,line) {const n=w.heard(actor).length;w.say(actor,line);return w.heardSince(actor,n).join('\n');}
  function snapshot(){return JSON.stringify(actors.map(actor=>w.row(actor)));}
  function refused(actor,line) {const before=snapshot(),n=calls.length,logs=w.logged(/staff: .* repair /).length;
    const text=ask(actor,line);yes('refused without engine request or success audit: '+line,
      snapshot()===before&&calls.length===n&&w.logged(/staff: .* repair /).length===logs);return text;}
  const previous=copy(w.row(TESTER)),text=ask(TESTER,'/repairgear');
  yes(server+' self repair routes through the real queue',/Repaired /i.test(text)&&w.prop(TESTER,'inventory').entries[0].name==='Aldis Blade');
  yes('one native call carries actor, profile and both expected snapshots',calls.length===1&&calls[0].actor===TESTER&&calls[0].profile===302&&
    JSON.stringify(calls[0].change.expectedInventory)===JSON.stringify(previous.inventory)&&JSON.stringify(calls[0].change.expectedEquipment)===JSON.stringify(previous.equipment));
  const repaired=w.prop(TESTER,'inventory');const expected=copy(previous.inventory);expected.entries[0].name='Aldis Blade';
  yes('repair changes only canonical names and keeps every count and extra',JSON.stringify(repaired)===JSON.stringify(expected));
  const equipment=copy(previous.equipment);equipment.inv.entries[0].name='Aldis Blade';
  yes('worn names match while every equipment field is preserved',JSON.stringify(w.prop(TESTER,'equipment'))===JSON.stringify(equipment));
  yes('progression and unrelated character state are preserved',JSON.stringify(w.row(TESTER).thornswoodCharacter)===JSON.stringify(previous.thornswoodCharacter));
  yes('the native request fences the exact runtime and life',calls.length>0&&calls[0].change.expectedRuntimeIdentity===w.mp().getActorRuntimeIdentity(TESTER)&&calls[0].change.expectedLifeGeneration===0);
  const n=calls.length;ask(TESTER,'/repairgear');yes('already sound equipment is a clear no-op',calls.length===n);
  yes('regular account denied',/not yours/.test(refused(GUEST,'/repairgear')));
  for(const actor of [TESTER,HELPER])yes('only admin can repair another person',/not yours/.test(refused(actor,'/repairgear for Guest')));
  ask(HELPER,'/repairgear');yes('staff can repair their own equipment',w.prop(HELPER,'inventory').entries[0].name==='Aldis Blade');
  seed(TESTER);ask(TESTER,'/repairgear for Tester');yes('explicit self target works for tester',w.prop(TESTER,'inventory').entries[0].name==='Aldis Blade');
  ask(ADMIN,'/repairgear for Alia W');yes('admin targets an unambiguous prefix',w.prop(WEST,'inventory').entries[0].name==='Aldis Blade');
  for(const line of ['/repairgear Guest','/repairgear for','/repairgear for Alia','/repairgear for Missing','/repairgear for Tester extra'])refused(ADMIN,line);
  seed(TESTER);answer=false;
  const before=snapshot(),logs=w.logged(/staff: .* repair /).length;
  yes('native stale-snapshot refusal never reports success',/changed|could not|refus/i.test(ask(TESTER,'/repairgear'))&&snapshot()===before&&w.logged(/staff: .* repair /).length===logs);
  answer='throw';yes('native error never reports success',/could not|confirm/i.test(ask(TESTER,'/repairgear'))&&snapshot()===before&&w.logged(/staff: .* repair /).length===logs);
  answer=true;
  w.mp().compareAndSetActorInventoryAndEquipment=undefined;
  yes('missing native binding is unavailable without fallback',/unavailable/i.test(refused(TESTER,'/repairgear')));
  const D=w.box().__thornswoodDurability;
  if(D.prepareTestingRepair) {
    seed(TESTER);const inv=w.prop(TESTER,'inventory'),eq=w.prop(TESTER,'equipment'),saved=JSON.stringify([inv,eq]);
    const plan=D.prepareTestingRepair(inv,eq);
    yes('canonical preparation is pure and reports the intended units',plan.ok&&plan.items===2&&plan.stacks===1&&JSON.stringify([inv,eq])===saved);
    eq.inv.entries[0].name='Aldis Blade (24%)';
    yes('stale worn identity refuses instead of guessing',!D.prepareTestingRepair(inv,eq).ok);
    eq.inv.entries[0].name='Aldis Blade (25%)';inv.entries[0].count=0;
    yes('malformed inventory refuses without inventing a stack',!D.prepareTestingRepair(inv,eq).ok);
  }else yes('canonical durability exposes pure repair preparation',false);
  const api=w.box().__thornswoodStaffRepair;
  if(api){const n=w.heard(ADMIN).length;api.command({proven:false},'/repairgear',['/repairgear'],304,ADMIN);
    yes('proof cannot be bypassed through direct calls',/proved/.test(w.heardSince(ADMIN,n).join('\n')));
    const m=w.heard(ADMIN).length;api.command({proven:true},'/repairgear',['/repairgear'],304,TESTER);
    yes('the current requestor actor cannot be substituted',/own current character/.test(w.heardSince(ADMIN,m).join('\n')));
  }else yes('the repair handler exposes its boundary',false);
  yes('tester help lists only own repair',/\/repairgear:/.test(ask(TESTER,'/testhelp'))&&!/\/repairgear for/.test(ask(TESTER,'/testhelp')));
  yes('admin help includes target repair',/\/repairgear for <person>/.test(ask(ADMIN,'/adminhelp')));
  const internalCalls=calls.length;
  ask(GUEST,'/repair');
  yes('ordinary repair-panel traffic still reaches the existing kit UI for any account',
    !!w.prop(GUEST,'thornswoodRepairView') && w.prop(GUEST,'thornswoodRepairView').open === true && calls.length===internalCalls);
  t.done(w);
}
