'use strict';
// Real board page/front bridge -> whole queued property letter -> carry -> hand over.
const fs=require('fs'),path=require('path'),standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const {attachScenarioReservation}=require('../../tests/fixtures/pack-first');
const t=standIn.checks(),yes=t.yes,root=path.join(__dirname,'../..');
const w=standIn.world({name:'4412-letter',settings:{thornswoodServer:'main'}});
const cell='1691d:Skyrim.esm',spot=[134265.1,35842.3,-12397.5];
w.record('593b:Thornswood-Content.esp','ACTI');w.ref(w.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell,pos:[spot[0]+876,spot[1],spot[2]]});
const sender=w.person(0xff004412,{profileId:1000,name:'Brenna',cell,pos:spot,inventory:{entries:[{baseId:15,count:300}]}});
const courier=w.person(0xff004413,{profileId:1001,name:'Corvin',cell,pos:[spot[0]+100,spot[1],spot[2]],inventory:{entries:[]}});
const recipient=w.person(0xff004414,{profileId:1002,name:'Lydia "Red" Stone',cell,pos:[spot[0]+200,spot[1],spot[2]]});
const wrong=w.person(0xff004415,{profileId:1003,name:'Lydia Red Stone',cell,pos:[spot[0]+250,spot[1],spot[2]]});
yes('the whole gamemode loads',w.boot());if(!w.loaded())t.done(w);attachScenarioReservation(w);
for(const a of [sender,courier,recipient,wrong])w.arrive(a);w.run(30000);
const prop=w.box().__thornswoodProperty;
const rows=()=>w.readPrivate('property.json').notices.windhelm||[];
function command(a,line){w.say(a,line);w.run(2200);}
function post(to,body){const p=makePage();for(const file of ['bridge','board'])p.run(file,fs.readFileSync(path.join(root,'game/ui/thornswood-'+file+'.js'),'utf8'));
 p.win.thornswoodBoard.setData({board:prop.boardPanel(sender,1000)});p.win.thornswoodBoard.open();
 p.doc.getElementById('ts-board-to').value=to;p.doc.getElementById('ts-board-letter').value=body;p.doc.querySelector('[data-do="letter"]').click();
 for(const line of p.sent)command(sender,line);return p;}
for(const [name,body]of [['Lydia "Red" Stone','SEALED-4412-QUOTED'],['Lydia Red Stone','SEALED-4412-ORDINARY']]){
 const target=name.includes('"')?recipient:wrong,prior=w.count(sender,15),p=post(name,body),row=rows().at(-1),index=rows().length;
 yes('the actual board uses a distinct encoded letter command for '+name,p.sent.length===1&&p.sent[0].startsWith('/letter-post-v1 '));
 yes('posting retains the exact intended recipient '+name,row&&row.to===name&&row.text===body);
 yes('posting uses the ordinary single letter fee '+name,w.count(sender,15)===prior-35);
 command(courier,'/take '+index);
 const near=w.prop(courier,'thornswoodNear');
 yes('the actual near view offers handover to the intended person '+name,near&&near.w[target.toString(16)]&&near.w[target.toString(16)].d===1);
 yes('the courier board view keeps the letter sealed '+name,!JSON.stringify(prop.boardPanel(courier,1001)).includes(body));
 const carried=prop.lettersCarried();yes('the canonical carried-letter gate retains the quoted identity '+name,carried.carries(1001,name));
 const before=w.count(courier,15);command(courier,'/deliver '+(target===recipient?wrong:recipient).toString(16));
 yes('a different full name receives neither this letter nor its reward '+name,w.count(courier,15)===before&&!rows()[index-1].down);
 command(courier,'/deliver '+target.toString(16));
 yes('the intended recipient receives the sealed words '+name,w.said.some(m=>m.profileId===(target===recipient?1002:1003)&&m.text.includes(body)));
 yes('delivery pays the courier once and retires its letter '+name,w.count(courier,15)===before+15&&!!rows()[index-1].down&&rows()[index-1].deliveredTo===(target===recipient?1002:1003));
 command(courier,'/deliver '+target.toString(16));yes('delivery replay cannot pay a second reward '+name,w.count(courier,15)===before+15);
}
const encoded=(name,words)=>'/letter-post-v1 '+encodeURIComponent(name)+' '+encodeURIComponent(words);
const invalid=[
 '/letter-post-v1','/letter-post-v1 A','/letter-post-v1 A B extra',
 '/letter-post-v1 %ZZ B','/letter-post-v1 %FF B','/letter-post-v1 A %E0%A4',
 encoded('x'.repeat(61),'body'),encoded('Lydia','x'.repeat(301)),
 encoded('   ','body'),encoded('Lydia','   '),encoded('Lydia\nRed','body'),
 encoded('Lydia\u0000Red','body'),encoded('Lydia\u202eRed','body'),encoded('Lydia<Red>','body'),
 '/letter-post-v1 '+'%41'.repeat(181)+' B','/letter-post-v1 A '+'%41'.repeat(901)
];
for(const line of invalid){
 const prior=w.count(sender,15),stored=JSON.stringify(w.readPrivate('property.json'));
 command(sender,line);
 yes('malformed encoded request refuses before posting or fees: '+line.slice(0,45),w.count(sender,15)===prior&&JSON.stringify(w.readPrivate('property.json'))===stored);
}
const oldGold=w.count(sender,15),oldRows=rows().length;
command(sender,'/letter "Lydia Red Stone" LEGACY-CONTROL');
yes('legacy ordinary letter callers retain their existing parser and fee',rows().length===oldRows+1&&rows().at(-1).to==='Lydia Red Stone'&&rows().at(-1).text==='LEGACY-CONTROL'&&w.count(sender,15)===oldGold-35);
const oldSender=w.count(sender,15),priorRows=rows().length;
w.moveTo(sender,cell,[spot[0]+10000,spot[1],spot[2]]);command(sender,encoded('Lydia "Red" Stone','TOO-FAR'));
yes('the new encoded boundary keeps the canonical at-board location gate',w.count(sender,15)===oldSender&&rows().length===priorRows);
t.done(w);
