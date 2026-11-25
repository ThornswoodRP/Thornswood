'use strict';
// Actual journal page/front bridge -> queued whole gamemode -> saved state.
const standIn=require('../../tests/stand-in-server');
const t=standIn.checks(),yes=t.yes;
const w=standIn.world({name:'4771-journal',settings:{thornswoodServer:'main'}});
const a=w.person(0xff004771,{profileId:1000,name:'Brenna',cell:'3c:Skyrim.esm',pos:[0,0,0]});
const social=()=>w.box().__thornswoodSocial;
const stored=()=>w.prop(a,'thornswoodSocial');
function say(line){w.say(a,line);w.run(2100);}
function page(jid,pid){return require('../../tests/fixtures/journal-editor')({journalId:jid,pageId:pid,view:()=>{social().push(a);return w.prop(a,'thornswoodSocialView');}});}
yes('the whole gamemode loads',w.boot());
if(w.loaded()){
 w.arrive(a);w.run(30000);
 const book=social().newJournal(a,'Exact notebook').journal;
 social().writePage(a,book.id,'','Before','Original body');social().push(a);
 const pid=stored().journals[0].pages[0].id;
 const cases=[
  ['literal escape','Literal',String.raw`a typed \n stays literal`+'\nA real second line'],
  ['separator and spacing','  Title :: has  spaces\t', '  indented\tline\n    next :: literal\\n  '],
  ['Unicode and quotes','“雪”  résumé','Ω\t雪 😀 “quotes” & <marks>\nlast  line'],
  ['boundary','T'.repeat(60),'雪'.repeat(4000)]
 ];
 for(const [label,title,text]of cases){
  const p=page(book.id,pid);p.type(title,text);const line=p.save();say(line);
  let saved=stored().journals[0].pages[0];
  yes(label+' title and body are saved exactly from the actual page',saved.title===title&&saved.text===text);
  yes(label+' uses a separate versioned save command',line.startsWith('/journal-write-v1 '));
  yes(label+' server reload succeeds',w.reload());
  saved=stored().journals[0].pages[0];yes(label+' persisted text survives reload unchanged',saved.title===title&&saved.text===text);
 }
 const p=page(book.id,pid),before=JSON.stringify(stored());
 const title='Unsent  :: title',text=String.raw`keep \n`+'\n  keep my indentation';p.type(title,text);
 const set=w.mp().set;w.mp().set=function(id,key,value){if(id===a&&key==='thornswoodSocial')throw Error('fixture save refused');return set.call(this,id,key,value);};
 try{say(p.save());p.feed();}finally{w.mp().set=set;}
 yes('a refused property write preserves the actual saved journal',JSON.stringify(stored())===before);
 yes('a refused save keeps the current title and text draft after the button takes focus',p.field('ptitle').value===title&&p.field('text').value===text);
 yes('the refused draft is visibly identified as unsaved',/unsaved|not saved/i.test(p.doc.getElementById('ts-journal-foot').textContent));
 const q=page(book.id,pid);
 q.type('Older A','Older A text');const older=q.save();q.type('Newer B','  Newer B\\n\n  text');say(older);q.feed();
 yes('an older accepted save cannot overwrite a newer unsent draft',q.field('ptitle').value==='Newer B'&&q.field('text').value==='  Newer B\\n\n  text');
 say(q.save());q.feed();
 yes('a matching accepted save clears the unsaved mark only after exact authoritative readback',!/unsaved/i.test(q.doc.getElementById('ts-journal-foot').textContent));

 const fixedNow=w.now(),DateType=w.box().Date,realNow=DateType.now;
 DateType.now=()=>fixedNow;
 let applied=0;
 q.type('Uncertain','A live copy is not a queue receipt.');
 w.mp().set=function(id,key,value){if(id===a&&key==='thornswoodSocial'){set.call(this,id,key,value);applied++;throw Error('fixture applied then threw');}return set.call(this,id,key,value);};
 try{
  const uncertain=social().writePageExact(a,book.id,pid,q.field('ptitle').value,q.field('text').value);q.feed();
  yes('applied-then-throw is reported as uncertain rather than saved',/could not be confirmed/.test(uncertain)&&social().view(a).journalSave.status==='uncertain'&&applied===1);
  yes('an uncertain matching live page still keeps its unsaved draft',q.field('ptitle').value==='Uncertain'&&/unsaved/i.test(q.doc.getElementById('ts-journal-foot').textContent));
  w.mp().set=function(id,key,value){if(id===a&&key==='thornswoodSocial'&&JSON.stringify(w.prop(id,key))===JSON.stringify(value))return;return set.call(this,id,key,value);};
  const same=()=>social().writePageExact(a,book.id,pid,'Uncertain','A live copy is not a queue receipt.');
  yes('an identical-value setter no-op cannot turn uncertainty into save acceptance',/could not be confirmed/.test(same())&&social().view(a).journalSave.status==='uncertain');
  yes('the actual gamemode reload succeeds while this result is uncertain',w.reload());
  yes('hot reload cannot turn the same no-op into an accepted save',/could not be confirmed/.test(same())&&social().view(a).journalSave.status==='uncertain');
  w.box().__thornswoodJournalSaveState={};w.reload();
  yes('missing prior outcome metadata cannot qualify an identical live snapshot',/could not be confirmed/.test(same())&&social().view(a).journalSave.status==='uncertain');
  q.feed();yes('uncertainty across reload keeps the actual editor draft',q.field('ptitle').value==='Uncertain'&&/unsaved/i.test(q.doc.getElementById('ts-journal-foot').textContent));
  q.type('Changed C','A genuinely changed requested snapshot');
  const changed=social().writePageExact(a,book.id,pid,q.field('ptitle').value,q.field('text').value);q.feed();
  yes('an explicitly changed successful snapshot can resolve the earlier uncertainty',changed===''&&social().view(a).journalSave.status==='saved'&&!/unsaved/i.test(q.doc.getElementById('ts-journal-foot').textContent));
 }finally{w.mp().set=set;DateType.now=realNow;}
 const previousProfile=w.row(a).profileId;w.row(a).profileId=1001;
 yes('a recycled actor with another profile receives no prior private save result',social().view(a).journalSave===null);w.row(a).profileId=previousProfile;
 yes('save outcome metadata remains owner-only',w.propertyDefinition('thornswoodSocialView').isVisibleByOwner===true&&w.propertyDefinition('thornswoodSocialView').isVisibleByNeighbors===false);

 const beforeInvalid=JSON.stringify(stored().journals);
 for(const payload of[null,{},[book.id,pid,'title'],[book.id,pid,'title','body','extra'],[book.id,pid,5,'body'],[book.id,pid,'T'.repeat(61),'body'],[book.id,pid,'title','x'.repeat(4001)]]){
  say('/journal-write-v1 '+JSON.stringify(payload));
  yes('invalid exact-save shape or bound is refused without mutating journal state',JSON.stringify(stored().journals)===beforeInvalid);
 }
 social().writePage(a,book.id,'','Large sibling one','雪'.repeat(4000));social().writePage(a,book.id,'','Large sibling two','雪'.repeat(4000));
 yes('a valid existing journal state can exceed the metadata CAS limit',Buffer.byteLength(JSON.stringify(stored()),'utf8')>16384);
 const large=page(book.id,pid);large.type('Full-size edit','  exact :: full-size\\n\n  body');say(large.save());
 yes('the canonical full-size writer retains existing allowed journal capacity',stored().journals[0].pages[0].text==='  exact :: full-size\\n\n  body'&&stored().journals[0].pages.length===3);
 yes('a new server process loads the journal change forms',w.restart().loaded);w.arrive(a);w.run(30000);
 yes('the complete large journal survives the process restart and JSON change-form round trip',stored().journals[0].pages.length===3&&stored().journals[0].pages[0].text==='  exact :: full-size\\n\n  body');
}
t.done(w);
