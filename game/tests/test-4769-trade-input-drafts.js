'use strict';
// Actual trade page/front bridge. Native input value/selection APIs are supplied
// at the DOM boundary; no page draw, handler or transport semantics are replaced.
const fs = require('fs'), path = require('path');
const makePage = require('../../tests/fixtures/panel-page');
const root = path.join(__dirname, '../..');
const source = fs.readFileSync(process.env.TRADE_UI || path.join(root,'game/ui/thornswood-trade.js'),'utf8');
let pass=0,fail=0;
function yes(label,ok){console.log((ok?'PASS ':'FAIL ')+label);ok?pass++:fail++;}
function rig(patch){
  const p=makePage();p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));p.run('trade',source);
  const panel=p.doc.getElementById('ts-trade'), query=panel.querySelector;
  panel.querySelector=function(selector){const node=query.call(this,selector);if(node&&node.tagName==='INPUT'){
    if(!node._nativeValue){node.value=node.getAttribute('value')||'';node._nativeValue=true;}
    node.setSelectionRange=function(a,b,direction){this.selectionStart=a;this.selectionEnd=b;this.selectionDirection=direction||'none';};
  }return node;};
  const state=Object.assign({open:true,sessionId:'a'.repeat(48),offerVersion:'b'.repeat(48),them:'Aldis',myGold:12,theirGold:5,heldGold:100,iAgreed:false,theyAgreed:false,
    pack:[{n:'Iron Sword',c:3,k:'Weapons',id:'12eb7',p:1}],mine:[],theirs:[]},patch);
  p.api=p.win.thornswoodTrade;p.state=state;p.panel=panel;p.field=name=>panel.querySelector('#ts-trade-'+name);
  p.update=patch=>{p.state=Object.assign({},p.state,patch);p.api.setData(p.state);};
  p.type=(name,value,start=value.length,end=start)=>{const n=p.field(name);n.focus();n.value=value;n.setSelectionRange(start,end,'backward');if(n.oninput)n.oninput.call(n);return p.field(name);};
  p.click=name=>panel.querySelector('[data-do="'+name+'"]').click();
  p.api.setData(state);return p;
}
{
 const p=rig();p.type('gold','37',1,2);p.update({theirGold:9});
 yes('an unrelated owner update preserves an unsent gold draft',p.field('gold').value==='37');
 yes('gold typing retains focus and caret through an owner update',p.doc.activeElement===p.field('gold')&&p.field('gold').selectionStart===1&&p.field('gold').selectionEnd===2);
 p.update({myGold:20});yes('even an authoritative pile update does not overwrite an unsent local draft',p.field('gold').value==='37');
 p.click('gold');yes('Set sends exactly the typed amount through the real bridge',p.sent.at(-1)==='/trade gold 37');
 p.update({myGold:37});yes('after explicit submission the authoritative gold value owns the field',p.field('gold').value==='37');
 p.update({myGold:30});yes('submitted text is not retained as a stale draft over later authority',p.field('gold').value==='30');
 p.type('gold','999');p.click('gold');p.update({myGold:30});
 yes('a refused submitted amount gives way to the unchanged authoritative offer',p.field('gold').value==='30');
 p.type('gold','55');p.win.thornswoodNet.say=()=>false;p.click('gold');p.update({theirGold:11});
 yes('known local delivery refusal keeps the unsent draft',p.field('gold').value==='55');
 p.win.thornswoodNet.say=line=>{p.sent.push(line);return true;};
 p.click('goldall');yes('All sends held gold rather than the old draft',p.sent.at(-1)==='/trade gold 100');
 p.update({myGold:100});yes('All releases the old unsent draft',p.field('gold').value==='100');
 p.type('gold','44');p.click('goldclear');p.update({myGold:0});yes('None releases the old draft in favor of authoritative zero',p.field('gold').value==='0');
}
{
 const p=rig();p.type('find','Iron',2,3);p.update({theirGold:8});
 yes('the already-fixed search remains editable through a server redraw',p.field('find').value==='Iron'&&p.doc.activeElement===p.field('find')&&p.field('find').selectionStart===2&&p.field('find').selectionEnd===3);
 p.type('find','Iron "Sword"');
 yes('quoted search text stays a complete input attribute',p.field('find')?.value==='Iron "Sword"');
 p.update({pack:[{n:'Iron "Sword"',c:1,k:'Weapons',p:1,id:'12eb7'}]});
 yes('quoted item text remains readable and its canonical Add reference is intact',/Iron "Sword"/.test(p.panel.querySelector('#ts-trade-pack').innerHTML)&&p.panel.querySelector('[data-add="#1"]'));
}
{
 const p=rig();p.type('gold','39');p.type('find','Iron');
 p.api.setData({open:false});p.update({open:true,myGold:7,them:'Brenna'});
 yes('a new trade starts with authoritative gold and an empty search',p.field('gold').value==='7'&&p.field('find').value==='');
 p.type('gold','28');p.type('find','Iron');
 p.update({sessionId:'c'.repeat(48),offerVersion:'d'.repeat(48),myGold:6});
 yes('a coalesced close cannot carry drafts into a different session with the same name',p.field('gold').value==='6'&&p.field('find').value==='');
 p.type('gold','41');p.type('find','Iron');p.update({offerVersion:'e'.repeat(48),theirGold:11});
 yes('a new offer revision inside the same session preserves unsent text',p.field('gold').value==='41'&&p.field('find').value==='Iron');
 p.type('gold','');p.update({theirGold:12});
 yes('an intentionally empty unsent amount survives a valid same-session update',p.field('gold').value==='');
 p.type('gold','23');p.update({sessionId:undefined,myGold:9});
 yes('missing session identity clears drafts rather than guessing continuity',p.field('gold').value==='9'&&p.field('find').value==='');
 p.type('gold','24');p.update({sessionId:'not-a-session',myGold:8});
 yes('malformed session identity also clears local drafts',p.field('gold').value==='8');
 p.update({sessionId:'f'.repeat(48)});p.type('gold','26');p.type('find','Iron');
 p.update({sessionId:'1'.repeat(48),myGold:7});
 yes('a new session does not transfer the old field focus or cursor',p.doc.activeElement!==p.field('find')&&p.doc.activeElement!==p.field('gold'));
}
{
 const p=rig();let box=p.panel.querySelector('input[data-for="#1"]');box.value='3';box.oninput.call(box);
 p.update({theirGold:8});box=p.panel.querySelector('input[data-for="#1"]');
 yes('row quantity drafts keep their existing same-session continuity',box.value==='3');
 p.update({sessionId:'c'.repeat(48)});
 yes('row quantity drafts also reset when the session changes',p.panel.querySelector('input[data-for="#1"]').value==='');
}
{
 const p=rig();p.type('gold','36');
 p.win.thornswoodNet.say=line=>{p.sent.push(line);p.update({myGold:36});return true;};
 p.click('gold');
 yes('a synchronous authoritative reply is not hidden behind the released draft',p.field('gold').value==='36');
 p.win.thornswoodNet.say=line=>{p.sent.push(line);p.update({myGold:36});return true;};
 p.type('gold','999');p.click('gold');
 yes('a synchronous refusal likewise leaves the authoritative amount visible',p.field('gold').value==='36');
}
{
 const p=rig({pack:[{n:'Iron "Sword"',c:1,k:'Weapons',id:'12eb7'}]});
 const add=p.panel.querySelectorAll('[data-add]').find(n=>n.getAttribute('data-add')==='Iron "Sword"');
 yes('a legacy quoted item reference stays one complete attribute',!!add);
 if(add)add.click();
 yes('the quoted item reference reaches the real bridge without attribute corruption',p.sent.at(-1)==='/trade add Iron "Sword" 1');
}
{
 const pack=Array.from({length:205},(_,i)=>({n:'Item '+i,c:1,k:'Miscellaneous',p:i+1,id:'a'+i}));
 const p=rig({pack});
 yes('the pack still bounds its rendered list to two hundred Add controls',p.panel.querySelectorAll('[data-add]').length===200);
 yes('the bounded pack tells the reader how many matches are shown and how to narrow it',/200/.test(p.panel.querySelector('#ts-trade-pack').textContent||p.panel.querySelector('#ts-trade-pack').innerHTML)&&/205/.test(p.panel.querySelector('#ts-trade-pack').textContent||p.panel.querySelector('#ts-trade-pack').innerHTML)&&/find|narrow|search/i.test(p.panel.querySelector('#ts-trade-pack').innerHTML));
 p.type('find','no such item');
 yes('a search miss explains that no match was found rather than declaring a category empty',/no.*match|nothing.*match/i.test(p.panel.querySelector('#ts-trade-pack').innerHTML)&&!/Nothing in that category/.test(p.panel.querySelector('#ts-trade-pack').innerHTML));
 p.type('find','Item 204');
 yes('narrowing reaches an item beyond the initial bounded display',p.panel.querySelector('[data-add="#205"]')&&p.panel.querySelectorAll('[data-add]').length===1);
}
console.log(pass+' passed, '+fail+' failed');process.exitCode=fail?1:0;
