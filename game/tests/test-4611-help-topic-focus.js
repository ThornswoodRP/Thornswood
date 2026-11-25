'use strict';
// The actual F7 page/bridge, with native button activation dispatched after
// browser-order key events. Topic nodes must survive selecting another topic.
const fs=require('fs'),path=require('path');
const makePage=require('../../tests/fixtures/panel-page.js');
const root=path.join(__dirname,'../..');
const ui=fs.readFileSync(process.env.HELP_UI||path.join(root,'game/ui/thornswood-help.js'),'utf8');
const bridge=fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8');
let pass=0,fail=0;
function yes(name,ok){console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;}
const p=makePage();p.run('bridge',bridge);p.run('help',ui);
const api=p.win.thornswoodHelp;api.open();
const topics=['talking','people','living','work','land','help'];
const buttons=()=>p.doc.querySelectorAll('button[data-topic]');
const button=id=>p.doc.querySelector('[data-topic="'+id+'"]');
const body=()=>p.doc.getElementById('ts-help-body');
const current=()=>buttons().filter(b=>b.getAttribute('aria-current')==='page');
const original=buttons();
function activate(id,key='Enter'){
  const b=button(id);b.focus();
  const down=p.fire(b,'keydown',key),up=p.fire(b,'keyup',key);
  if(!down.defaultPrevented&&!up.defaultPrevented)b.click();
  return b;
}
yes('all six topics remain ordinary keyboard buttons',original.length===6&&original.every(b=>b.tagName==='BUTTON'));
yes('the initially open topic is exposed as current',current().length===1&&current()[0]===button('talking'));
for(const [i,id] of topics.entries()){
  const b=activate(id,i%2?' ':'Enter');
  yes(id+' keeps focus on the selected live topic button',p.doc.activeElement===b&&button(id)===b);
  yes(id+' leaves every topic button mounted for continuing Tab navigation',buttons().every((node,index)=>node===original[index]));
  yes(id+' exposes exactly one current topic and its visual mark',current().length===1&&current()[0]===b&&/\bgo\b/.test(b.className));
  yes(id+' labels the help content with the selected topic',body().getAttribute('role')==='region'&&!!b.id&&body().getAttribute('aria-labelledby')===b.id);
}
activate('talking');const focused=p.doc.activeElement;
api.setKeys({chat:'T'});
yes('key-name refresh does not discard topic focus',p.doc.activeElement===focused&&button('talking')===focused);
yes('key-name refresh still updates the displayed instructions',body().innerHTML.includes('T opens the chat box'));
api.open('unknown-topic');
yes('an unknown requested topic cannot leave navigation without a current topic',current().length===1&&current()[0]===button('talking'));
api.close();api.open('work');
yes('reopening on a named topic updates current state without replacing navigation',current().length===1&&current()[0]===button('work')&&buttons().every((node,index)=>node===original[index]));
activate('help');api.setKeys({help:'X'});
const text=p.doc.getElementById('ts-help-ptext');text.focus();
const down=p.fire(text,'keydown','x'),press=p.fire(text,'keypress','x');
yes('typing the rebound help letter in the problem field remains ordinary typing',api.isOpen()&&!down.defaultPrevented&&!press.defaultPrevented&&!press.stopped);
text.value='A saved problem draft';text.oninput();activate('people');activate('help');
yes('changing topics preserves the report draft',body().innerHTML.includes('A saved problem draft'));
p.fire(p.doc.body,'keydown','Escape');
yes('Escape still closes the help panel',!api.isOpen());
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
