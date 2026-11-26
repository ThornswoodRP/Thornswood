'use strict';
// Scenario: systems/noticeboards.md
// Real board/front bridge -> authenticated queue -> whole canonical unpin.
const fs=require('fs'),path=require('path'),standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const root=path.join(__dirname,'../..'),t=standIn.checks(),yes=t.yes;
const posts=[
 {by:1000,title:'Target'}, {by:1000,title:'Own job',job:true,pay:15}, {by:1000,title:'Taken job',job:true,pay:25,taken:1001,takenName:'Brenna'},
 {by:1001,title:'Guard target'}, {by:1001,title:'Haul',job:true,haul:true,pay:30,dest:'whiterun',taken:1000,takenName:'Aldis'},
 {by:1000,title:'',job:true,letter:true,to:'Brenna',text:'SECRET LETTER',pay:15}, {by:1001,title:'Jarl target'}, {by:1000,title:'Legacy route'},
 {by:1000,title:'Zero stamp',at:0}, {by:1000,title:'Missing stamp',at:null}, {by:1000,title:'String stamp',at:'1000'}, {by:1000,title:'Save failure',job:true,pay:12}
].map((x,i)=>Object.assign({name:x.by===1000?'Aldis':'Brenna',text:'Public body',at:1000+i},x));delete posts[9].at;
const w=standIn.world({name:'6856-board-intents',settings:{thornswoodServer:'main',thornswoodRequirePass:true},files:{
 'private/allowed.json':{profiles:[1000,1001,2000,3000,4000,5000],accounts:{1000:'a',1001:'b',2000:'g',3000:'s',4000:'j',5000:'x'},offices:{2000:{guard:['windhelm']},3000:{steward:['windhelm']},4000:{jarl:['windhelm']}}},
 'private/property.json':{funds:{windhelm:500,whiterun:500},notices:{windhelm:posts.slice(0,2),whiterun:[{by:1000,name:'Aldis',title:'Other board',text:'Do not remove',at:2000}]}}
}});
const actors=[1000,1001,2000,3000,4000,5000].map((pid,i)=>w.person(0xff006856+i,{profileId:pid,name:['Aldis','Brenna','Guard','Steward','Jarl','Stranger'][i],inventory:{entries:[{baseId:15,count:100}]}}));
const [a,b,guard,steward,jarl,stranger]=actors;
yes('whole gamemode loads',w.boot());if(!w.loaded())t.done(w);actors.forEach(w.arrive);w.run(30000);
const prop=()=>w.box().__thornswoodProperty,doc=()=>w.readPrivate('property.json'),row=n=>doc().notices.windhelm[n-1],site=h=>prop().boards()[h];
function move(actor,h='windhelm'){const p=site(h);w.moveTo(actor,p.cell,p.pos);}
function wire(h,n,at){return '/board-unpin-v1 '+JSON.stringify([h,n,at]);}
function say(actor,line){w.say(actor,line);w.run(2100);}
function pageWire(n){const p=makePage();for(const f of ['bridge','board'])p.run(f,fs.readFileSync(path.join(root,'game/ui/thornswood-'+f+'.js'),'utf8'));p.win.thornswoodBoard.setData(w.box().__thornswoodSocial.view(a));p.win.thornswoodBoard.open();const button=p.doc.querySelectorAll('[data-do="unpin"]').find(x=>x.getAttribute('data-n')===String(n));button.click();button.click();return p.sent.at(-1)||'';}
function queued(line,change){const run=w.run;w.run=()=>{};try{w.say(a,line);}finally{w.run=run;}change();w.run(2100);}
actors.forEach(x=>move(x));
function firstWire(){return pageWire(1);}
let line=firstWire();yes('actual page emits exact board/index/creation payload',line===wire('windhelm',1,1000));
queued(line,()=>move(a,'whiterun'));yes('old queued board intent cannot remove either board after movement',!row(1).down&&!doc().notices.whiterun[0].down);
move(a);line=firstWire();queued(line,()=>{const d=doc();d.notices.windhelm[0]={by:1000,name:'Aldis',title:'Replacement book',text:'New creation',at:3000};w.writePrivate('property.json',d);w.reload();});
yes('old queued intent cannot remove a same-index replacement after reload',!row(1).down&&row(1).at===3000);
const withMore=doc(),capturedFirst=withMore.notices.windhelm[0];withMore.notices.windhelm=posts;withMore.notices.windhelm[0]=capturedFirst;w.writePrivate('property.json',withMore);yes('additional canonical saved fixtures load',w.reload());
move(a);const before=JSON.stringify(doc()),inventory=JSON.stringify(w.row(a).inventory);
for(const payload of [[],['windhelm',1],['windhelm',1,3000,'extra'],[null,1,3000],['unknown',1,3000],['windhelm',0,3000],['windhelm',1.5,3000],['windhelm','1',3000],['windhelm',1,'3000'],['windhelm',1,null],['windhelm',1,-1],['windhelm',1,1.5],['windhelm',9007199254740992,3000],['windhelm',1,9007199254740992],['whiterun',1,2000],['windhelm',1,1000]]){
 say(a,'/board-unpin-v1 '+JSON.stringify(payload));yes('malformed/mismatched intent changes no register or pack',JSON.stringify(doc())===before&&JSON.stringify(w.row(a).inventory)===inventory);
}
for(const raw of ['/board-unpin-v1 nope',' '+wire('windhelm',1,3000),wire('windhelm',1,3000)+' extra']){say(a,raw);yes('invalid outer JSON request changes no register',JSON.stringify(doc())===before);}
say(a,wire('windhelm',10,0));say(a,wire('windhelm',11,1000));yes('missing/string stored timestamps never coerce to an accepted stamp',!row(10).down&&!row(11).down);
w.relayCommand({profileId:1000,proven:false,text:wire('windhelm',1,3000)});yes('a copied board target does not authenticate an unproven caller',!row(1).down);
say(stranger,wire('windhelm',1,3000));yes('the new route still refuses a nonowner with no office',!row(1).down);
say(a,wire('windhelm',3,1002));yes('owner cannot cancel a taken ordinary job',!row(3).down&&row(3).pay===25);
for(const [actor,office]of [[guard,'guard'],[steward,'steward'],[jarl,'jarl']]){say(actor,'/office hold '+office+' windhelm');yes('canonical '+office+' is held on this character',prop().boardPanel(actor,w.row(actor).profileId)[office==='steward'?'steward':'guard']===true);}
move(guard,'whiterun');say(guard,wire('whiterun',1,2000));yes('a Guard of another hold has no takedown authority',!doc().notices.whiterun[0].down);move(guard);
const gold=w.count(a,15),funds=doc().funds.windhelm;say(a,wire('windhelm',2,1001));yes('current own job uses canonical exact held-pay refund',!!row(2).down&&row(2).pay===0&&w.count(a,15)===gold+15&&doc().funds.windhelm===funds-15);
const oldGuardGold=w.count(a,15);say(guard,wire('windhelm',3,1002));yes('canonical local Guard can remove a taken job and refund its owner',!!row(3).down&&w.count(a,15)===oldGuardGold+25);
say(jarl,wire('windhelm',7,1006));yes('canonical local Jarl can take another person post down',!!row(7).down);
const haulGold=w.count(b,15);say(steward,wire('windhelm',5,1004));yes('canonical Steward cancellation of taken haul returns owner pay',!!row(5).down&&w.count(b,15)===haulGold+30);
const letterGold=w.count(a,15);say(a,wire('windhelm',6,1005));yes('letter courier pay returns through unchanged canonical rules',!!row(6).down&&w.count(a,15)===letterGold+15);
say(a,wire('windhelm',9,0));yes('actual numeric zero legacy creation is accepted',!!row(9).down);
const failedGold=w.count(a,15),failedFunds=doc().funds.windhelm,mp=w.mp(),originalSet=mp.set;
try{mp.set=function(actor,name,value){if(actor===a&&name==='inventory')throw Error('before pack commit fixture');return originalSet.call(mp,actor,name,value);};say(a,wire('windhelm',12,1011));}finally{mp.set=originalSet;}
yes('failed canonical refund preserves post, held pay, ledger and pack',!row(12).down&&row(12).pay===12&&doc().funds.windhelm===failedFunds&&w.count(a,15)===failedGold);
say(a,'/unpin 8');yes('the legacy four-argument route still works',!!row(8).down);
const complete=JSON.stringify(doc());say(a,wire('windhelm',2,1001));yes('accepted intent replay cannot refund or mutate twice',JSON.stringify(doc())===complete);
// Instrument the real canonical operation: a second board lookup would now
// describe another town. The expected context must use its one captured row.
move(a);const nativeGet=mp.get;let boardReads=0,lines=[];
try{mp.get=function(actor,name){if(actor===a&&!prop().notices().windhelm[0].down){if(name==='worldOrCellDesc'){boardReads++;return site(boardReads===1?'windhelm':'whiterun').cell;}if(name==='pos')return site(boardReads===1?'windhelm':'whiterun').pos;}return nativeGet.call(mp,actor,name);};
 if(typeof prop().unpin==='function')prop().unpin(['/unpin','1'],a,1000,(_,line)=>lines.push(line),{hold:'windhelm',at:3000});
}finally{mp.get=nativeGet;}
yes('expected context is checked within one canonical captured-board resolution',boardReads===1&&!!row(1).down&&!doc().notices.whiterun[0].down);
t.done(w);
