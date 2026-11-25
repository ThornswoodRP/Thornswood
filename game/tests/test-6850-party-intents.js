'use strict';
// Real P page/bridge -> authenticated relay queue -> whole gamemode.
// Scenario: systems/party.md
// Scenario: systems/friends.md
const fs=require('fs'),path=require('path'),standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..'),t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'6850-party-intents',settings:{thornswoodServer:'main',thornswoodRequirePass:true}});
const a=w.person(0xff006850,{profileId:1000,name:'Aldis'}),b=w.person(0xff006851,{profileId:1001,name:'Brenna'}),c=w.person(0xff006852,{profileId:1002,name:'Corvin'});
yes('whole gamemode loads',w.boot());if(!w.loaded())t.done(w);[a,b,c].forEach(w.arrive);w.run(30000);
const s=w.box().__thornswoodSocial,view=()=>s.view(a),cap=()=>view().partyIntent||{},party=()=>s.partyOf(1000);
function reset(){[1000,1001,1002].forEach(s.leaveParty);yes('canonical party starts',s.joinParty(1000,1001)==='');}
function wire(action,v=cap(),pid=1001){return '/party-action-v1 '+action+' '+(v.id||'a'.repeat(48))+' '+(v.version||'b'.repeat(48))+(action==='kick'?' '+pid:'');}
function queued(line,change){const run=w.run;w.run=()=>{};try{w.say(a,line);}finally{w.run=run;}change();w.run(2100);}
function pageWire(action){const p=makePage();for(const file of ['bridge','party'])p.run(file,fs.readFileSync(path.join(root,'game/ui/thornswood-'+file+'.js'),'utf8'));p.win.thornswoodParty.setData(view());p.win.thornswoodParty.open();const button=p.doc.querySelector('[data-do="'+action+'"]');button.click();button.click();return p.sent.at(-1)||'';}
reset();const initial=cap();
yes('owner view carries bounded opaque instance and version',/^[a-f0-9]{48}$/.test(initial.id||'')&&/^[a-f0-9]{48}$/.test(initial.version||''));
yes('both party owners see the same binding',JSON.stringify(initial)===JSON.stringify(s.view(b).partyIntent));
yes('the actual social view remains owner-only',w.propertyDefinition('thornswoodSocialView').isVisibleByOwner===true&&w.propertyDefinition('thornswoodSocialView').isVisibleByNeighbors===false);
yes('mere refresh preserves binding',JSON.stringify(initial)===JSON.stringify(cap()));
for(const action of ['disband','kick']){
 reset();const line=pageWire(action);yes(action+' actual page sends distinct bound opcode',line===wire(action));
 queued(line,()=>{s.leaveParty(1000);s.joinParty(1000,action==='kick'?1001:1002);});
 yes(action+' old queued intent cannot affect a recreated party',!!party()&&party().members.length===2);
}
reset();let old=cap();s.joinParty(1000,1002);yes('join rotates only the version',cap().id===old.id&&cap().version!==old.version);
old=cap();s.leaveParty(1002);yes('leave rotates the version',cap().id===old.id&&cap().version!==old.version);
const beforeABA=cap();s.joinParty(1000,1002);s.leaveParty(1002);w.say(a,wire('disband',beforeABA));yes('join/leave ABA refuses old snapshot even with same final roster',!!party());
old=cap();s.leadParty(1000,1001);s.leadParty(1001,1000);yes('leadership ABA rotates the version',cap().version!==old.version);w.say(a,wire('disband',old));yes('old leadership approval is refused',!!party());
reset();s.joinParty(1000,1002);old=cap();s.kickParty(1000,1002);yes('canonical kick rotates version',cap().version!==old.version);
reset();s.joinParty(1000,1002);old=cap();s.leaveParty(1000);yes('leader departure rotates surviving party version',s.view(b).partyIntent&&s.view(b).partyIntent.version!==old.version);
reset();const good=wire('disband'),before=JSON.stringify(party());
for(const line of ['/party-action-v1','/party-action-v1 disband','/party-action-v1 disband bad bad',good+' extra',good.replace('disband','lead'),wire('kick',cap(),0),wire('kick',cap(),'1001x'),wire('kick',cap(),'9007199254740992'),' '+good,good.replace(' ','\n'),good+'\n']){
 w.say(a,line);yes('malformed intent refuses before any party mutation',JSON.stringify(party())===before);
}
w.say(b,good);yes('valid tokens do not grant leader authority',JSON.stringify(party())===before);
w.say(c,good);yes('valid tokens do not grant nonmember authority',JSON.stringify(party())===before);
w.relayCommand({profileId:1000,text:good,proven:false});yes('a copied binding does not authenticate a relay command',JSON.stringify(party())===before);
reset();let line=wire('kick');w.say(a,line);yes('current accepted kick runs canonical action once',!party()&&!s.partyOf(1001));w.say(a,line);yes('accepted intent replay stays refused',!party());
reset();line=wire('disband');w.say(a,line);yes('current accepted disband ends the exact party',!party()&&!s.partyOf(1001));
reset();const crypto=require('crypto'),randomBytes=crypto.randomBytes;old=cap();
try{crypto.randomBytes=()=>{throw Error('unavailable fixture');};s.joinParty(1000,1002);}finally{crypto.randomBytes=randomBytes;}
yes('token failure preserves ordinary party join',party().members.includes(1002));yes('failed rotation retires capability instead of preserving old approval',!view().partyIntent);
w.say(a,wire('disband',old));yes('retired capability refuses previously valid intent',!!party());
reset();const priorRestart=cap();yes('hot reload succeeds',w.reload());const s2=w.box().__thornswoodSocial;s2.joinParty(1000,1001);yes('hot reload/recreation never reuses prior instance',s2.view(a).partyIntent&&s2.view(a).partyIntent.id!==priorRestart.id);w.say(a,wire('disband',priorRestart));yes('pre-reload intent cannot affect new party',!!s2.partyOf(1000));
const beforeRestart=s2.view(a).partyIntent;yes('full server restart succeeds',w.restart().loaded);[a,b,c].forEach(w.arrive);w.run(30000);const s3=w.box().__thornswoodSocial;s3.joinParty(1000,1001);
yes('server restart does not reuse the old party instance',s3.view(a).partyIntent&&s3.view(a).partyIntent.id!==beforeRestart.id);w.say(a,wire('disband',beforeRestart));yes('pre-restart intent cannot affect a new party',!!s3.partyOf(1000));
if(process.env.LEGACY_GM){
 const old=standIn.world({name:'6850-old-server',gm:process.env.LEGACY_GM,settings:{thornswoodServer:'main',thornswoodRequirePass:true}});
 const x=old.person(0xff006850,{profileId:1000,name:'Aldis'}),y=old.person(0xff006851,{profileId:1001,name:'Brenna'});
 yes('exact previous bundle loads',old.boot());[x,y].forEach(old.arrive);old.run(30000);const legacy=old.box().__thornswoodSocial;legacy.joinParty(1000,1001);
 for(const action of ['kick','disband']){old.say(x,wire(action,s3.view(a).partyIntent));yes('previous server never treats the new '+action+' opcode as its old destructive route',!!legacy.partyOf(1000)&&legacy.partyOf(1000).members.length===2);}
 old.done();
}
t.done(w);
