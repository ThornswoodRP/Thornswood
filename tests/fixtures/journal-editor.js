'use strict';
// Native input value APIs over the real journal page and front bridge.
const fs=require('fs'),path=require('path'),makePage=require('./panel-page');
const root=path.join(__dirname,'../..');
function unesc(s){return s.replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');}
module.exports = function journalEditor(options) {
 const jid=options.journalId,pid=options.pageId;
 const p=makePage();p.run('bridge',fs.readFileSync(path.join(root,'game/ui/thornswood-bridge.js'),'utf8'));p.run('journal',fs.readFileSync(process.env.JOURNAL_UI||path.join(root,'game/ui/thornswood-journal.js'),'utf8'));
 const panel=p.doc.getElementById('ts-journal'),query=panel.querySelector;
 panel.querySelector=function(selector){const node=query.call(this,selector);if(node&&!node._nativeValue&&(node.tagName==='INPUT'||node.tagName==='TEXTAREA')){
   const main=query.call(this,'#ts-journal-main');
   const text=node.tagName==='TEXTAREA'&&main?new RegExp('<textarea[^>]*id="'+node.id+'"[^>]*>([\\s\\S]*?)</textarea>').exec(main.innerHTML):null;
   node.value=node.tagName==='INPUT'?(node.getAttribute('value')||''):text?unesc(text[1]):'';node._nativeValue=true;
 }return node;};
 p.api=p.win.thornswoodJournal;p.field=id=>panel.querySelector('#ts-journal-'+id);
 p.feed=()=>p.api.setData(options.view());
 p.feed();p.api.open();panel.querySelector('[data-book="'+jid+'"]').click();panel.querySelector('[data-page="'+pid+'"]').click();
 p.type=(title,text)=>{for(const [id,value]of[['ptitle',title],['text',text]]){const node=p.field(id);node.value=value;if(node.oninput)node.oninput.call(node);}};
 p.save=()=>{const button=panel.querySelector('[data-do="save"]');button.focus();button.click();return p.sent.at(-1)||'';};
 return p;
}
