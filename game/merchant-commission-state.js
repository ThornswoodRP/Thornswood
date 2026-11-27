'use strict';

// Promise existing NPC gold before asking for goods. This state belongs to
// the same private ledger entry as the purse, never a character projection.
const WAIT=6*60*60*1000,MAX_GOLD=2147483647,MAX_HELD=100,MAX_COOL=1024;
const CADENCES=[6,12,24,48];
const owns=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const integer=(value,min,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>owns(value,key));
const copy=value=>JSON.parse(JSON.stringify(value));
const job=id=>typeof id==='string'&&/^q-[a-z0-9-]{1,46}$/.test(id);
// One shape for a character's form id (#2870); game\form-id.js is the
// original and tests\test-2870-form-id-shape.js keeps this copy the same.
function formIdOf(desc) {
  if (typeof desc !== 'string' || !/^[0-9a-f]{1,6}$/i.test(desc)) return 0;
  var local = parseInt(desc, 16);
  return local > 0 ? 0xff000000 + local : 0;
}
function isFormId(n) {
  return Number.isSafeInteger(n) && n > 0xff000000 && n <= 0xffffffff;
}
// A runtime character (formDesc the local hex alone) owns by its runtime form
// id, [0xff000000 | local, '', profile]; a placed form (hex:plugin) keeps
// [local, plugin, profile]. The merchant ledger stores these strings, so its
// version is 2 from #2870. A version 1 ledger, whose owners were
// [local, '', profile], is not read: the alpha reset replaces it.
function owner(human) {
 if(!human||!integer(human.profileId,1,MAX_GOLD)||typeof human.desc!=='string')return '';
 const match=/^([0-9a-f]{1,6})(?::([^:/\\\x00-\x1f\x7f]+\.(?:esm|esp|esl)))?$/i.exec(human.desc);
 if(!match||!(parseInt(match[1],16)>0))return '';
 return JSON.stringify(match[2]?[parseInt(match[1],16),match[2].toLowerCase(),human.profileId]:[formIdOf(match[1]),'',human.profileId]);
}
function ownerString(value) {
 if(typeof value!=='string')return false;
 try {
  const row=JSON.parse(value);
  return Array.isArray(row)&&row.length===3&&typeof row[1]==='string'&&(row[1]?integer(row[0],1,0xffffff):isFormId(row[0]))&&
   (!row[1]||/^[^:/\\\x00-\x1f\x7f]+\.(?:esm|esp|esl)$/.test(row[1]))&&row[1]===row[1].toLowerCase()&&
   integer(row[2],1,MAX_GOLD)&&JSON.stringify(row)===value;
 }catch(error){return false;}
}
function key(human,id) {const who=owner(human);return who&&job(id)?JSON.stringify([who,id]):'';}
function keyParts(value) {
 try {const row=JSON.parse(value);return Array.isArray(row)&&row.length===2&&ownerString(row[0])&&job(row[1])&&
  JSON.stringify(row)===value?row:null;}catch(error){return null;}
}
function empty(){return {v:1,serial:0,held:{},cool:{}};}
function item(value) {
 return fields(value,['baseId','name'])&&integer(value.baseId,1,0xffffffff)&&value.baseId!==15&&
  typeof value.name==='string'&&!!value.name.trim()&&value.name.length<=160&&!/[\x00-\x1f\x7f]/.test(value.name);
}
function goods(value) {
 if(!Array.isArray(value)||value.length<1||value.length>5)return false;
 const seen=new Set();
 for(let i=0;i<value.length;i++) {
  if(!owns(value,i))return false;
  const row=value[i];
  if(!fields(row,['item','count','unit'])||!item(row.item)||seen.has(row.item.baseId)||
    !integer(row.count,1,100000)||!integer(row.unit,0,MAX_GOLD)||!integer(row.count*row.unit,0,MAX_GOLD))return false;
  seen.add(row.item.baseId);
 }
 return integer(value.reduce((sum,row)=>sum+row.count*row.unit,0),0,MAX_GOLD);
}
function cooldownAt(value){return Array.isArray(value)?value[0]:value;}
function cooldownWait(value){return Array.isArray(value)?value[1]*3600000:WAIT;}
function read(raw) {
 if(raw===undefined)return empty();
 function bad(){throw Error('Saved commission promises cannot be verified.');}
 if(!fields(raw,['v','serial','held','cool'])||![1,2].includes(raw.v)||!integer(raw.serial,0)||!object(raw.held)||!object(raw.cool)||
   Object.keys(raw.held).length>MAX_HELD||Object.keys(raw.cool).length+Object.keys(raw.held).length>MAX_COOL)bad();
 const tokens=new Set();
 for(const name of Object.keys(raw.held)) {
  const parts=keyParts(name),row=raw.held[name];
  const bundle=raw.v===2&&object(row)&&owns(row,'goods');
  if(!parts||!fields(row,bundle?['token','owner','job','hash','goods','hours','gold','at']:['token','owner','job','hash','item','count','unit','gold','at'])||
    !integer(row.token,1,raw.serial)||tokens.has(row.token)||row.owner!==parts[0]||row.job!==parts[1]||
    typeof row.hash!=='string'||!/^[0-9a-f]{64}$/.test(row.hash)||
    !integer(row.gold,0,MAX_GOLD)||!integer(row.at,1)||owns(raw.cool,name))bad();
  if(bundle) {
   if(!goods(row.goods)||!CADENCES.includes(row.hours)||row.gold!==row.goods.reduce((sum,part)=>sum+part.count*part.unit,0))bad();
  }else if(!item(row.item)||!integer(row.count,1,100000)||!integer(row.unit,0,MAX_GOLD)||row.gold!==row.count*row.unit)bad();
  tokens.add(row.token);
 }
 for(const name of Object.keys(raw.cool)) {
  const stamp=raw.cool[name],bundle=Array.isArray(stamp);
  if(!keyParts(name)||bundle&&(raw.v!==2||stamp.length!==2||!owns(stamp,0)||!owns(stamp,1)||!CADENCES.includes(stamp[1]))||
    !integer(cooldownAt(stamp),1))bad();
 }
 return copy(raw);
}
function reserved(raw){return Object.values(read(raw).held).reduce((sum,row)=>sum+row.gold,0);}
// A commission's pay is new gold, never the trader's (#6180, Patrick, 16 Nov
// 2026: "no dont make it come out of the purse", "othwerwise the economy would
// have like 0 gold people only start with 40"), so work taken holds none of
// the purse back and the whole purse is the trader's to trade with.
function spendable(state) {
 reserved(state.commissions);
 if(!integer(state.purse,0,MAX_GOLD))throw Error('The merchant purse cannot be verified.');
 return state.purse;
}
function openCount(states,human) {
 const who=owner(human);if(!who)throw Error('Commission owner cannot be verified.');
 return states.reduce((sum,state)=>{if(state===null)return sum;spendable(state);return sum+Object.values(read(state.commissions).held).filter(row=>row.owner===who).length;},0);
}
function prepare(raw,at) {
 if(!integer(at,1))throw Error('Commission time cannot be verified.');
 const next=read(raw);
 for(const name of Object.keys(next.cool))if(at-cooldownAt(next.cool[name])>=cooldownWait(next.cool[name]))delete next.cool[name];
 return next;
}
function reserve(raw,human,id,terms,at) {
 const next=prepare(raw,at),name=key(human,id);
 if(!name)return {ok:false,why:'session'};
 const bundle=terms&&owns(terms,'goods');
 if(!terms||typeof terms.hash!=='string'||!/^[0-9a-f]{64}$/.test(terms.hash)||
   (bundle?!goods(terms.goods)||!CADENCES.includes(terms.hours):!item(terms.item)||terms.hours!==undefined||
    !integer(terms.unit,0,MAX_GOLD)||!integer(terms.count,1,100000)||!integer(terms.unit*terms.count,0,MAX_GOLD)))return {ok:false,why:'price'};
 const gold=bundle?terms.goods.reduce((sum,row)=>sum+row.count*row.unit,0):terms.unit*terms.count;
 if(owns(next.held,name))return {ok:false,why:'open'};
 if(owns(next.cool,name))return {ok:false,why:'cooldown',waitMinutes:Math.ceil((cooldownWait(next.cool[name])-at+cooldownAt(next.cool[name]))/60000)};
 if(Object.keys(next.held).length>=MAX_HELD||Object.keys(next.cool).length+Object.keys(next.held).length>=MAX_COOL)return {ok:false,why:'capacity'};
 if(next.serial===Number.MAX_SAFE_INTEGER)return {ok:false,why:'counter'};
 const token=++next.serial;
 if(bundle){next.v=2;next.held[name]={token,owner:owner(human),job:id,hash:terms.hash,goods:copy(terms.goods),hours:terms.hours,gold,at};}
 else next.held[name]={token,owner:owner(human),job:id,hash:terms.hash,item:copy(terms.item),count:terms.count,unit:terms.unit,gold,at};
 read(next);
 return {ok:true,next,token};
}
function close(raw,human,id,token,at,pay) {
 const next=prepare(raw,at),name=key(human,id),row=name&&next.held[name];
 if(!row||!integer(token,1)||row.token!==token)return {ok:false,why:'session'};
 if(at<row.at)return {ok:false,why:'time'};
 if(pay&&Object.keys(next.cool).length>=MAX_COOL)return {ok:false,why:'capacity'};
 delete next.held[name];
 if(pay)next.cool[name]=owns(row,'goods')?[at,row.hours]:at;
 return {ok:true,next,gold:pay?row.gold:0,terms:row};
}
module.exports={WAIT,MAX_HELD,MAX_COOL,formIdOf,isFormId,ownerString,empty,read,owner,key,reserved,spendable,openCount,reserve,cooldownAt,cooldownWait,
 cancel:(raw,human,id,token,at)=>close(raw,human,id,token,at,false),
 finish:(raw,human,id,token,at)=>close(raw,human,id,token,at,true)};
