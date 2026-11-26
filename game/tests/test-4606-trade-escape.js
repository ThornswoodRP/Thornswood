'use strict';
// Real trade page + bridge and browser-order key dispatch. No trade/server
// handler is replaced: only outbound transport is recorded by the fixture.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page.js');
const root=path.join(__dirname,'../..');
const source=fs.readFileSync(process.env.TRADE_UI||path.join(root,'game/ui/thornswood-trade.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8');
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
function rig(){
  const p=makePage();p.run('bridge',bridge);p.run('trade',source);
  const view={open:true,offerVersion:'a'.repeat(48),them:'Aldis',myGold:12,theirGold:5,heldGold:100,iAgreed:false,theyAgreed:true,
    pack:[{n:'Iron Sword',c:3,k:'Weapons',id:'12eb7'}],mine:[{n:'Iron Sword',c:1,id:'12eb7'}],theirs:[]};
  p.win.thornswoodTrade.setData(view);p.view=view;
  p.api=p.win.thornswoodTrade;
  p.field=name=>p.doc.getElementById('ts-trade-'+name);
  p.escape=(target,repeat=false)=>p.fire(target||p.doc.activeElement,'keydown','Escape',{repeat});
  return p;
}
for(const name of ['gold','find']){
  const p=rig(),before=JSON.stringify(p.view),input=p.field(name);
  input.value=name==='gold'?'37':'Iron';input.focus();
  const event=p.escape(input);
  yes(name+' first Escape is consumed without a cancel',event.defaultPrevented&&p.sent.length===0);
  yes(name+' first Escape leaves the text box',p.doc.activeElement!==input);
  yes(name+' first Escape retains the open trade and unsubmitted edit',p.api.isOpen()&&input.value===(name==='gold'?'37':'Iron')&&JSON.stringify(p.view)===before);
  p.escape(p.doc.body,true);
  yes(name+' holding the first Escape cannot turn its repeat into walking away',p.sent.length===0&&p.api.isOpen());
  p.escape(p.doc.body);
  yes(name+' a fresh second Escape sends one cancel and awaits the server',p.sent.length===1&&p.sent[0]==='/trade cancel'&&p.api.isOpen());
  p.api.setData({open:false});p.escape(p.doc.body);
  yes(name+' the authoritative close still ends the panel and its Escape handling',!p.api.isOpen()&&p.sent.length===1);
}
{
  const p=rig(),input=p.field('find');input.value='Iron';input.focus();input.selectionStart=2;input.selectionEnd=3;
  // Add the ordinary browser input API at the DOM boundary, without replacing
  // the page's redraw or event handlers.
  const panel=p.doc.getElementById('ts-trade'),query=panel.querySelector;
  panel.querySelector=function(selector){
    const node=query.call(this,selector);
    if(node&&node.tagName==='INPUT')node.setSelectionRange=function(a,b){this.selectionStart=a;this.selectionEnd=b;};
    return node;
  };
  input.oninput.call(input);
  const current=p.field('find');
  // The field is kept through the redraw rather than replaced (#4475).
  yes('typing a search keeps focus on the same live field',p.doc.activeElement===current&&current===input);
  yes('search redraw preserves the edit cursor and selection',current.selectionStart===2&&current.selectionEnd===3);
  p.escape(p.doc.activeElement);
  yes('Escape immediately after typing search only leaves the field',p.sent.length===0&&p.api.isOpen()&&p.doc.activeElement!==current);
}
{
  const p=rig();p.escape(p.doc.body);
  for(let i=0;i<4;i++)p.escape(p.doc.body,true);
  yes('Escape outside a field still walks away once, even while held',p.sent.length===1&&p.sent[0]==='/trade cancel');
}
{
  const p=rig();p.doc.getElementById('ts-trade-cancel').click();
  yes('the explicit Walk away button still cancels the trade',p.sent.length===1&&p.sent[0]==='/trade cancel');
  const q=rig();q.doc.getElementById('ts-trade-ok').click();
  yes('the explicit Agree button sends the displayed offer version',q.sent.length===1&&q.sent[0]==='/trade agree '+q.view.offerVersion);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
