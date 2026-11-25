'use strict';
/*
  Scenario: systems/staff-tools.md
  Whole-gamemode queued scene tools, role restrictions, native mode requests,
  reload revocation and rendered name visibility through the real transport.
*/
// Real queued command transport, canonical roles and whole-gamemode reload.
const assert=require('node:assert/strict');
const standIn=require('../../tests/stand-in-server.js');
const t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'6628-queued-scene-tools',settings:{
  thornswoodAdmins:[101],thornswoodDevs:[102],thornswoodPlaytesters:[103]
}});
const actors=[101,102,103].map((profileId,i)=>w.person(0xff006628+i,{
  profileId,name:['Admin','Staff','Tester'][i],cell:'3c:Skyrim.esm',pos:[1000+i*100,0,0]
}));
const [ADMIN,STAFF,TESTER]=actors;
yes('the whole gamemode loads with the scene tools',w.boot());
if(!w.loaded())t.done(w);
actors.forEach(w.arrive);w.run(30000);
function ask(actor,line){const before=w.heard(actor).length;w.say(actor,line);return w.heardSince(actor,before).join('\n');}
yes('test help discovers all implemented self-only scene tools',
  /\/fly.*\/phase.*\/godmode.*\/invisible.*\/cleareffects/s.test(ask(TESTER,'/testhelp')));
yes('killall stays out of playtest help and is named to admins',
  !/\/killall/.test(ask(TESTER,'/testhelp'))&&/\/killall/.test(ask(ADMIN,'/adminhelp')));
yes('a queued playtester command enables native server god mode',
  /is on/.test(ask(TESTER,'/godmode on'))&&w.mp().get(TESTER,'isGodMode')===true);
yes('god mode includes effective flight',w.row(TESTER).thornswoodStaffTools.fly===true);
yes('a queued off command restores ordinary server damage behavior',
  /is off/.test(ask(TESTER,'/godmode off'))&&w.mp().get(TESTER,'isGodMode')===false);
yes('staff without Admin cannot use destructive cleanup',/not yours/.test(ask(STAFF,'/killall')));
yes('a playtester cannot redirect self tools to another person',
  /on or.*off/.test(ask(TESTER,'/godmode on Admin'))&&!w.mp().get(ADMIN,'isGodMode'));
const trail=w.box().__thornswoodStuck.state.chars[TESTER.toString(16)],oldPoint={desc:'3c:Skyrim.esm',pos:[9999,9999,0],rot:[0,0,0],at:w.now()};
trail.trail=[oldPoint];trail.last=oldPoint;
const from=w.row(TESTER).pos.slice();
yes('a queued phase confirms the native move and drops the old stuck trail',
  /Moved a short distance/.test(ask(TESTER,'/phase'))&&w.row(TESTER).pos[1]===from[1]+256&&
  !trail.trail.some(p=>p.pos[0]===9999)&&trail.last!==oldPoint);
yes('flight can be enabled through the real queued route',/is on/.test(ask(TESTER,'/fly on'))&&w.row(TESTER).thornswoodStaffTools.fly===true);
yes('a native god-mode grant is active before reload',/is on/.test(ask(TESTER,'/godmode on'))&&w.mp().get(TESTER,'isGodMode')===true);
yes('hot reload remains loaded while withdrawing old runtime modes',w.reload());
yes('the prior module withdrew flight and server protection during reload',w.row(TESTER).thornswoodStaffTools.fly===false&&w.mp().get(TESTER,'isGodMode')===false);
yes('a new explicit mode request works after reload',/is on/.test(ask(TESTER,'/godmode on'))&&w.mp().get(TESTER,'isGodMode')===true);
let bad=0;
for(const value of ['true',1,null]){try{w.mp().set(TESTER,'isGodMode',value);}catch(e){bad++;}}
yes('the stand-in native boundary refuses coercible nonboolean grants',bad===3);
let badIds=0;
try{w.mp().get(String(TESTER),'isGodMode');}catch(e){badIds++;}
try{w.mp().set(String(TESTER),'isGodMode',true);}catch(e){badIds++;}
yes('the stand-in rejects string actor ids instead of masking bad native calls',badIds===2);
ask(TESTER,'/godmode off');w.row(TESTER).isDead=true;
let deadRefused=false;try{w.mp().set(TESTER,'isGodMode',true);}catch(e){deadRefused=true;}
yes('the stand-in rejects dead enable instead of masking a resurrection',deadRefused&&w.row(TESTER).isDead===true);
w.row(TESTER).isDead=false;ask(TESTER,'/invisible on');
w.box().__thornswoodSocial.nearTick();
yes('invisibility also hides nearby name tags',w.row(ADMIN).thornswoodNear.w[TESTER.toString(16)].h===1);
ask(TESTER,'/invisible off');w.box().__thornswoodSocial.nearTick();
yes('ordinary name visibility returns when the mode ends',w.row(ADMIN).thornswoodNear.w[TESTER.toString(16)].h===0);
assert.equal(typeof w.box().__thornswoodStaff.authorizeTool,'function');
t.done(w);
