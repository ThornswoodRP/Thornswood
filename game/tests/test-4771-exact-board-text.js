'use strict';
// Real board page/front bridge -> whole queued gamemode and canonical pack-first post.
const fs=require('fs'),path=require('path');
const standIn=require('../../tests/stand-in-server'),makePage=require('../../tests/fixtures/panel-page');
const {attachScenarioReservation}=require('../../tests/fixtures/pack-first');
const root=path.join(__dirname,'../..'),t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'4771-board',settings:{thornswoodServer:'main'}});
const CITY='1691d:Skyrim.esm',SPOT=[134265.1,35842.3,-12397.5];
w.record('593b:Thornswood-Content.esp','ACTI');
w.ref(w.idOf('23592:Skyrim.esm'),{base:'1a2b3:Skyrim.esm',cell:CITY,pos:[SPOT[0]+876,SPOT[1],SPOT[2]]});
const a=w.person(0xff004772,{profileId:1000,name:'Brenna',town:'windhelm',cell:CITY,pos:[SPOT[0]+100,SPOT[1],SPOT[2]],inventory:{entries:[{baseId:15,count:500}]}});
const prop=()=>w.box().__thornswoodProperty;
const rows=()=>{const record=w.readPrivate('property.json');return record&&record.notices&&record.notices.windhelm||[];};
function say(line){w.say(a,line);w.run(2100);}
function compose(title,text,job){
 const p=makePage();p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));p.run('board',fs.readFileSync(process.env.BOARD_UI||path.join(root,'game/ui/thornswood-board.js'),'utf8'));
 p.api=p.win.thornswoodBoard;p.feed=()=>p.api.setData({board:prop().boardPanel(a,1000)});p.feed();p.api.open();
 p.doc.querySelector('[data-do="compose"]').click();
 if(job)p.doc.getElementById('ts-board-k-job').click();
 for(const [id,value]of[['title',title],['text',text],['reward',job?'15':'']]){
  const field=p.doc.getElementById('ts-board-'+id);field.value=value;p.fire(field,'input');
 }
 p.send=()=>{p.doc.querySelector('[data-do="send"]').click();return p.sent.at(-1)||'';};
 return p;
}
yes('the whole gamemode loads',w.boot());
if(w.loaded()){
 attachScenarioReservation(w);w.arrive(a);w.run(30000);
 for(const job of[false,true]){
  const title='  Title :: with  spaces\t',text=String.raw`literal \n`+'\n    indented\t雪 :: “quoted”  ';
  const p=compose(title,text,job),gold=w.count(a,15);say(p.send());
  let row=rows().at(-1);
  yes((job?'job':'notice')+' preserves exact title and body through the real page and queue',row&&row.title===title&&row.text===text&&row.job===job);
  yes((job?'job':'notice')+' retains its canonical fee and reward debit',w.count(a,15)===gold-(job?45:20)&&(!job||row.pay===15));
  yes('posting uses a distinct versioned command',p.sent.at(-1).startsWith('/board-post-v1 '));
  w.reload();attachScenarioReservation(w);row=rows().at(-1);
  yes('the exact post text survives gamemode reload',row&&row.title===title&&row.text===text);
 }
 const title='Keep  :: this',text='  keep my draft\tand spaces  ',p=compose(title,text,false);
 w.moveTo(a,CITY,[SPOT[0]+3000,SPOT[1],SPOT[2]]);
 const before=JSON.stringify(rows()),gold=w.count(a,15);say(p.send());
 yes('the existing board-location gate still refuses without spending or posting',JSON.stringify(rows())===before&&w.count(a,15)===gold);
 w.moveTo(a,CITY,[SPOT[0]+100,SPOT[1],SPOT[2]]);p.feed();
 yes('a refused post retains the exact editor draft',p.doc.getElementById('ts-board-title').value===title&&p.doc.getElementById('ts-board-text').value===text);
 const moved=compose('Keep this in Windhelm','For the Windhelm board only.',false),movedLine=moved.send();
 const [otherHold,otherBoard]=Object.entries(prop().boards()).find(([hold])=>hold!=='windhelm');
 const allNotices=()=>JSON.stringify(w.readPrivate('property.json').notices),beforeMove=allNotices(),moveGold=w.count(a,15);
 w.moveTo(a,otherBoard.cell,otherBoard.pos);
 yes('the move actually reaches a different hold noticeboard',prop().boardPanel(a,1000).hold===otherHold);
 say(movedLine);
 yes('a queued post cannot land or spend gold at a different hold noticeboard',
  allNotices()===beforeMove&&w.count(a,15)===moveGold);
 moved.feed();
 yes('the different-board refusal keeps the original draft in the editor',
  moved.doc.getElementById('ts-board-text').value==='For the Windhelm board only.');
 w.moveTo(a,CITY,[SPOT[0]+100,SPOT[1],SPOT[2]]);
 const newer=compose('Same title','Older body A',false),olderLine=newer.send();
 const field=newer.doc.getElementById('ts-board-text');field.value='Newer body B';newer.fire(field,'input');say(olderLine);newer.feed();
 yes('an older accepted board post cannot clear a newer same-title draft',newer.doc.getElementById('ts-board-text')?.value==='Newer body B');
 if(newer.doc.getElementById('ts-board-text')){
  say(newer.send());newer.feed();
  yes('the exact current posted draft can still settle its form',rows().at(-1).text==='Newer body B'&&!newer.doc.getElementById('ts-board-text'));
 }else yes('the exact current posted draft can still settle its form',false);
 const invalidBefore=JSON.stringify(rows()),invalidGold=w.count(a,15);
 for(const payload of[null,{},['notice',0,'title'],['notice',0,'title','body'],
     ['notice',0,'title','body','windhelm','extra'],['notice',0,'title','body',1],
     ['notice',0,'title','body','Bad hold'],['unknown',0,'title','body','windhelm'],
     ['notice',1,'title','body','windhelm'],['job',0,'title','body','windhelm'],
     ['job',1.5,'title','body','windhelm'],['notice',0,'T'.repeat(61),'body','windhelm'],
     ['notice',0,'title','x'.repeat(601),'windhelm']]){
  say('/board-post-v1 '+JSON.stringify(payload));
  yes('malformed post schema or bound is refused before any fee or post',JSON.stringify(rows())===invalidBefore&&w.count(a,15)===invalidGold);
 }
}
t.done(w);
