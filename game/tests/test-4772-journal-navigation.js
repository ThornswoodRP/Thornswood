'use strict';
// Actual journal page + front bridge, preserving the existing exact-save contract.
const editor=require('../../tests/fixtures/journal-editor');
let pass=0,fail=0;function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(){
 const state={journals:[{id:'j1',title:'First',pages:[{id:'p1',title:'One',text:'SAVED-ONE'},{id:'p2',title:'Two',text:'SAVED-TWO'}]},
  {id:'j2',title:'Second',pages:[{id:'p3',title:'Three',text:'SAVED-THREE'}]}],
  shared:[{title:'Shared book',from:'Corvin',pages:[{id:'s1',title:'Shared',text:'SHARED'}]}],
  group:{show:true,books:[{id:'g1',name:'Group book',kind:'business',read:true,people:[],roles:[]}]},
  boards:{list:[{hold:'windhelm',where:'Windhelm'}]}};
 const p=editor({journalId:'j1',pageId:'p1',view:()=>JSON.parse(JSON.stringify(state))});
 p.state=state;p.button=id=>p.doc.getElementById('ts-journal-'+id);p.choose=selector=>{const n=p.doc.querySelector(selector);if(n)n.click();return !!n;};
 p.type('DRAFT TITLE','DRAFT\n  literal\\n :: words');return p;
}
const moves=[['page','[data-page="p2"]'],['book','[data-book="j2"]'],['shared','[data-shared="0"]'],['group','[data-group="g1"]'],['board','[data-board="windhelm"]']];
for(const [name,selector]of moves){
 const p=rig(),before=p.sent.length;yes(name+' real navigation control exists',p.choose(selector));
 yes(name+' navigation asks before replacing an unsaved owned page',!!p.button('leave-choice')&&!p.button('leave-choice').hidden&&p.field('text')&&p.field('text').value==='DRAFT\n  literal\\n :: words');
 yes(name+' pending navigation sends no save or other action',p.sent.length===before);
 const keep=p.button('keep');if(keep)keep.click();
 yes(name+' Keep editing retains the exact draft and restores editor focus',p.field('text')&&p.field('text').value==='DRAFT\n  literal\\n :: words'&&p.doc.activeElement===p.field('text'));
}
{
 const p=rig();p.choose('[data-page="p2"]');const discard=p.button('discard');if(discard)discard.click();
 yes('explicit discard continues to the intended page',p.field('text')&&p.field('text').value==='SAVED-TWO'&&p.doc.activeElement===p.field('text'));
 p.choose('[data-page="p1"]');yes('discarded changes cannot reappear on returning',p.field('text')&&p.field('text').value==='SAVED-ONE');
}
{
 const p=rig();p.api.close();p.api.open();yes('close and reopen keep the existing current-page draft',p.field('text').value==='DRAFT\n  literal\\n :: words');
 p.choose('[data-page="p1"]');yes('choosing the current page never asks to discard it',!p.button('leave-choice')||p.button('leave-choice').hidden);
}
{
 const p=rig();p.choose('[data-page="p2"]');const before=p.sent.length;
 p.fire(p.button('keep'),'keydown','Escape');
 yes('fresh Escape cancels the choice and keeps the journal open',p.api.isOpen()&&p.button('leave-choice').hidden&&p.field('text').value.startsWith('DRAFT'));
 p.fire(p.field('text'),'keydown','Escape',{repeat:true});
 yes('held Escape cannot immediately close after cancelling',p.api.isOpen());
 p.fire(p.field('text'),'keydown','Escape');p.api.open();
 yes('another fresh Escape closes while preserving the draft for reopen',p.field('text').value.startsWith('DRAFT')&&p.sent.length===before);
}
{
 const p=rig();p.choose('[data-page="p2"]');const stale=p.button('discard').onclick;
 p.type('NEWER','NEWER PRIVATE WORDS');stale();
 yes('typing cancels the pending choice and its retained handler cannot discard newer writing',p.field('text').value==='NEWER PRIVATE WORDS'&&p.button('leave-choice').hidden);
}
{
 const p=rig();p.choose('[data-page="p2"]');const stale=p.button('discard').onclick;
 p.choose('[data-book="j2"]');stale();
 yes('an earlier pending action cannot execute after a different destination was chosen',p.field('text').value.startsWith('DRAFT')&&!p.button('leave-choice').hidden);
 p.button('discard').click();p.choose('[data-page="p3"]');yes('the current explicit choice still reaches its book',p.field('text').value==='SAVED-THREE');
}
{
 const p=rig();p.choose('[data-page="p2"]');p.state.journals[0].pages.pop();p.feed();p.button('discard').click();
 yes('a disappeared destination is rechecked before any draft is discarded',p.field('text').value.startsWith('DRAFT')&&p.button('leave-choice').hidden);
}
for(const change of ['text','identity']){
 const p=rig();p.choose('[data-shared="0"]');
 if(change==='text')p.state.shared[0].pages[0].text='CHANGED';else p.state.shared.unshift({title:'Other',from:'Brenna',pages:[]});
 p.feed();p.button('discard').click();
 yes('a changed shared entry snapshot cannot receive the earlier discard choice ('+change+')',p.field('text').value.startsWith('DRAFT')&&p.button('leave-choice').hidden);
}
{
 const p=rig();p.type('A','SENT-A');p.save();p.type('B','NEWER-B');p.choose('[data-page="p2"]');
 Object.assign(p.state.journals[0].pages[0],{title:'A',text:'SENT-A'});p.state.journalSave={journalId:'j1',pageId:'p1',title:'A',text:'SENT-A',status:'saved'};p.feed();
 yes('an older saved reply cannot clear the newer draft or its pending choice',p.field('text').value==='NEWER-B'&&!p.button('leave-choice').hidden);
 Object.assign(p.state.journals[0].pages[0],{title:'B',text:'NEWER-B'});p.state.journalSave={journalId:'j1',pageId:'p1',title:'B',text:'NEWER-B',status:'uncertain'};p.feed();
 yes('matching live words with an uncertain save remain guarded',p.field('text').value==='NEWER-B'&&!p.button('leave-choice').hidden);
 const before=p.sent.length;p.state.journalSave.status='saved';p.feed();
 yes('a matching accepted save cancels the choice without navigating or sending again',p.field('text').value==='NEWER-B'&&p.button('leave-choice').hidden&&p.sent.length===before);
}
{
 const p=rig(),saveButton=p.doc.querySelector('[data-do="save"]'),staleSave=saveButton.onclick,before=p.sent.length;
 p.state.journals.shift();p.feed();
 yes('a removed source journal leaves its unsaved private words readable',p.field('text')&&p.field('text').value.startsWith('DRAFT'));
 staleSave.call(saveButton);yes('a retained save handler cannot send a write for a source no longer in the owner view',p.sent.length===before);
 p.choose('[data-book="j2"]');p.button('discard').click();p.choose('[data-page="p3"]');
 yes('a disappeared source can still be left through an explicit fresh discard',p.field('text')&&p.field('text').value==='SAVED-THREE');
}
for(const [verb,prefix]of [['newpage','/journal-write-v1 '],['dropbook','/journal drop ']]){
 const p=rig(),before=p.sent.length;p.choose('[data-do="'+verb+'"]');
 yes(verb+' waits for an explicit discard before its existing command',p.sent.length===before&&!p.button('leave-choice').hidden);
 p.button('discard').click();yes(verb+' explicit choice sends once through its existing path',p.sent.length===before+1&&p.sent.at(-1).startsWith(prefix));
}
{
 const p=rig(),before=p.sent.length;p.choose('[data-new="1"]');
 yes('new journal waits for an explicit discard before its existing command',p.sent.length===before&&!p.button('leave-choice').hidden);
 p.button('discard').click();yes('new journal uses its original command and throttle once',p.sent.length===before+1&&p.sent.at(-1)==='/journal new Journal'&&p.field('text').value==='SAVED-ONE');
}
{
 const p=rig();p.state.journals[0].pages.shift();p.feed();
 yes('a removed source page keeps its draft readable even when the book remains',p.field('text').value.startsWith('DRAFT'));
 p.choose('[data-book="j1"]');p.button('discard').click();p.choose('[data-page="p2"]');
 yes('the remaining book can be revisited after explicit discard of its removed page',p.field('text').value==='SAVED-TWO');
}
{
 const p=rig(),title=p.field('ptitle');title.focus();p.fire(title,'focusin','');
 p.choose('[data-page="p2"]');p.button('keep').click();
 yes('Keep editing restores a title focused without another text change',p.doc.activeElement===p.field('ptitle')&&p.field('text').value.startsWith('DRAFT'));
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
