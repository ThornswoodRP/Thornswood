'use strict';
/*
  Scenario: systems/playtest-and-admin-commands.md
  Self-only person teleport through the whole gamemode's actual chat queue,
  canonical admission, target resolver, restraints and stuck history.
*/
const standIn=require('../../tests/stand-in-server.js');
const t=standIn.checks(),yes=t.yes;
for(const server of ['dev','main']) {
  const w=standIn.world({name:'6757-tpto-'+server,settings:{thornswoodServer:server,
    thornswoodPlaytesters:[102],thornswoodAdmins:[103]}});
  const actors=[101,102,103,104,105].map((profileId,i)=>w.person(0xff006750+i,
    {profileId,name:['Guest','Tester','Admin','Alia West','Alia East'][i],cell:'3c:Skyrim.esm',pos:[1000+i*100,0,0]}));
  const [GUEST,TESTER,ADMIN,WEST]=actors;
  yes(server+': whole gamemode loads',w.boot());
  if(!w.loaded()){t.done(w);continue;}
  actors.forEach(w.arrive);w.run(30000);
  // Drain the actual queue without advancing unrelated movement/needs clocks.
  w.run=()=>w.box().__thornswoodCommandTimer.fn();
  const staff=w.box().__thornswoodStaff,stuck=w.box().__thornswoodStuck;
  const at=id=>JSON.stringify(w.mp().get(id,'locationalData'));
  function ask(actor,text){const before=w.heard(actor).length;w.say(actor,text);return w.heardSince(actor,before).join('\n');}
  function refused(text,actor=TESTER){
    const before=actors.map(at).join('|'),trail=JSON.stringify(stuck.state),audit=w.logged(/staff: .* tpto /).length;
    const reply=ask(actor,text);
    yes(server+': refused move preserves positions, history and audit: '+text,before===actors.map(at).join('|')&&trail===JSON.stringify(stuck.state)&&w.logged(/staff: .* tpto /).length===audit);
    return reply;
  }
  yes(server+': implemented self command appears in playtest help',/\/tpto/.test(ask(TESTER,'/testhelp')));
  w.moveTo(WEST,'165a7:Skyrim.esm',[2500,3000,4]);
  const destination=at(WEST),targetHistory=JSON.stringify(stuck.state.chars[WEST.toString(16)]);
  const key=TESTER.toString(16);
  const caller=stuck.state.chars[key];
  caller.trail=[{desc:'3c:Skyrim.esm',pos:[1,2,3],rot:[0,0,0],at:w.now()-1000}];
  caller.last={desc:'3c:Skyrim.esm',pos:[1,2,3],rot:[0,0,0]};caller.fightAt=w.now();
  stuck.state.used[key]={at:w.now()-1000,from:{},to:{}};
  stuck.state.waiting[102]={actorId:TESTER,at:w.now(),from:caller.last,hp:1};
  const used=JSON.stringify(stuck.state.used[key]),fight=caller.fightAt;
  yes(server+': a playtester reaches an unambiguous online person',/sent|teleport/i.test(ask(TESTER,'/tpto Alia West'))&&at(TESTER)===destination);
  yes(server+': the target and their trail remain untouched',at(WEST)===destination&&JSON.stringify(stuck.state.chars[WEST.toString(16)])===targetHistory);
  yes(server+': successful teleport clears stale caller trail and pending wait',caller.trail.length===0&&caller.last===null&&!stuck.state.waiting[102]);
  yes(server+': teleport preserves combat history and stuck cooldown',caller.fightAt===fight&&JSON.stringify(stuck.state.used[key])===used);
  yes(server+': a successful self teleport is recorded',w.logged(/staff: .* tpto /).length===1);
  yes(server+': an exact online character id also resolves',/Sent to Alia West/.test(ask(TESTER,'/tpto '+WEST.toString(16))));
  yes(server+': guest cannot move themselves',/not yours/.test(refused('/tpto Admin',GUEST)));
  for(const text of ['/tpto','/tpto Missing','/tpto Alia','/tpto Tester','/tpto Alia West extra'])refused(text);
  yes(server+': ambiguous names explain why no target was chosen',/More than one/.test(refused('/tpto Alia')));
  staff.state.frozen[102]={desc:'3c:Skyrim.esm',pos:[1000,0,0],rot:[0,0,0],by:103};
  yes(server+': a freeze refuses the move',/frozen/.test(refused('/tpto Admin')));delete staff.state.frozen[102];
  const cuffs=w.box().__thornswoodCuffs,oldCuff=cuffs.cuffedBy;cuffs.cuffedBy=()=>({bound:true});
  yes(server+': cuffs refuse the move',/cuff/.test(refused('/tpto Admin')));cuffs.cuffedBy=oldCuff;
  const property=w.box().__thornswoodProperty,oldJail=property.lockedJailHere;property.lockedJailHere=()=> 'Whiterun';
  yes(server+': locked jail refuses the move',/jail|cell locked/.test(refused('/tpto Admin')));property.lockedJailHere=oldJail;
  const pass=w.box().__thornswoodPassSeen.passes[102];delete w.box().__thornswoodPassSeen.passes[102];
  yes(server+': a current pass is required',/launcher.*pass/.test(refused('/tpto Admin')));w.box().__thornswoodPassSeen.passes[102]=pass;
  w.row(WEST).isDead=true;refused('/tpto Alia West');w.row(WEST).isDead=false;
  const oldSet=w.mp().set;
  w.mp().set=(id,prop,value)=>{if(id===TESTER&&prop==='locationalData')throw Error('move refused');return oldSet(id,prop,value);};
  refused('/tpto Admin');w.mp().set=oldSet;
  w.mp().set=(id,prop,value)=>{if(id===TESTER&&prop==='locationalData')return;return oldSet(id,prop,value);};
  yes(server+': a silent native refusal cannot report success',/could not be confirmed/.test(refused('/tpto Admin')));w.mp().set=oldSet;
  const oldPos=w.row(WEST).pos;w.row(WEST).pos=[NaN,0,0];refused('/tpto Alia West');w.row(WEST).pos=oldPos;
  const api=w.box().__thornswoodPersonTeleport;
  yes(server+': the handler has its own testable authorization boundary',!!api);
  if(api){
    const before=at(TESTER),notes=w.heard(TESTER).length;
    api.command({proven:false},'/tpto',['/tpto','Admin'],102,TESTER);
    api.command({proven:true},'/tpto',['/tpto','Admin'],102,ADMIN);
    yes(server+': direct calls cannot bypass proof or substitute the caller actor',at(TESTER)===before&&/proved|own current/.test(w.heardSince(TESTER,notes).join('\n')));
  }
  t.done(w);
}
