'use strict';
/*
  WHICH ITEMS ARE QUEST ITEMS (#4915). The seven quest tokens in
  Thornswood-Content.esp, 17000 to 17006, and nothing else. An item is one of
  them or it is not, so the answer comes from its record and no other test.

  The engine names a form with mp.getDescFromId: "<id>:<plugin>" for a
  form a plugin holds, and the bare id for a form made while the server runs
  (FormDesc::FromFormId gives a form at 0xff000000 and up no file, and
  FormDesc::ToString prints only the id then), which is what a brewed potion
  or a poison mixed at the lab is. Such a form is in no plugin, so it is not
  one of the seven. Refusing every name without a plugin made each of those
  bottles a quest item, and nothing could store, drop, take, trade or load it.

  Still refused: an id that is no form id, and a lookup that throws or answers
  with something that is no form name, because then which item it is is not
  known, and a quest token must never get through for that.
*/
function createQuestItemPolicy(mp) {
 if(!mp||typeof mp.getDescFromId!=='function')throw new Error('Quest item identity lookup is unavailable');
 const lookup=mp.getDescFromId;
 const tokens=new Set(Array.from({length:7},(_,i)=>(0x17000+i).toString(16)+':thornswood-content.esp'));
 return Object.freeze({blocked(baseId) {
  if(!Number.isInteger(baseId)||baseId<=0||baseId>0xffffffff)return true;
  try {
   const desc=Reflect.apply(lookup,mp,[baseId]);
   const named=typeof desc==='string'?/^([0-9a-f]{1,8})(:[^:\0\r\n]+\.(?:esm|esp|esl))?$/i.exec(desc):null;
   if(!named)return true;
   return !!named[2]&&tokens.has(parseInt(named[1],16).toString(16)+named[2].toLowerCase());
  }catch(error){return true;}
 }});
}
module.exports={createQuestItemPolicy};
