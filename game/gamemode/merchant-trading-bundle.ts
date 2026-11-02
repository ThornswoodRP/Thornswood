// MERCHANT TRADING BUNDLE BEGIN
const MERCHANT_TRADING = (function () {
const module = { exports: {} };
const MERCHANT_GUILD_SITES = table('MERCHANT_GUILD_SITES');
const MERCHANT_COMMISSION_STATE = (function () { const module = {exports:{}};
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
function spendable(state) {
 const promised=reserved(state.commissions);
 if(!integer(state.purse,0,MAX_GOLD)||promised>state.purse)throw Error('Commission promises exceed the merchant purse.');
 return state.purse-promised;
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
function reserve(raw,human,id,terms,at,purse) {
 const next=prepare(raw,at),name=key(human,id);
 if(!name)return {ok:false,why:'session'};
 const bundle=terms&&owns(terms,'goods');
 if(!terms||typeof terms.hash!=='string'||!/^[0-9a-f]{64}$/.test(terms.hash)||
   (bundle?!goods(terms.goods)||!CADENCES.includes(terms.hours):!item(terms.item)||terms.hours!==undefined||
    !integer(terms.unit,0,MAX_GOLD)||!integer(terms.count,1,100000)||!integer(terms.unit*terms.count,0,MAX_GOLD)))return {ok:false,why:'price'};
 const gold=bundle?terms.goods.reduce((sum,row)=>sum+row.count*row.unit,0):terms.unit*terms.count;
 if(owns(next.held,name))return {ok:false,why:'open'};
 if(owns(next.cool,name))return {ok:false,why:'cooldown'};
 if(Object.keys(next.held).length>=MAX_HELD||Object.keys(next.cool).length+Object.keys(next.held).length>=MAX_COOL)return {ok:false,why:'capacity'};
 if(next.serial===Number.MAX_SAFE_INTEGER)return {ok:false,why:'counter'};
 if(spendable({purse,commissions:next})<gold)return {ok:false,why:'purse'};
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
return module.exports;})();
const MERCHANT_SETTLEMENT = (function () { const module = {exports:{}};
'use strict';

var MAX_PENDING = 25;
var MAX_INVENTORY_BYTES = 128 * 1024;
var MAX_INTENT_BYTES = 512 * 1024;
var MAX_COUNT = 2147483647;
var COMMISSION_STATE=typeof MERCHANT_COMMISSION_STATE!=='undefined'?MERCHANT_COMMISSION_STATE:require('./merchant-commission-state');
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function equal(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function merchantSnapshot(value, compact, extended) {
  if(!value || typeof value!=='object' || Array.isArray(value)) throw new Error('Pending merchant snapshot cannot be verified.');
  var supply=value.supply===undefined ? {} : value.supply;
  if(!supply || typeof supply!=='object' || Array.isArray(supply) ||
      (!compact || value.purse!==undefined || value.stock!==undefined) &&
      (!Number.isInteger(value.purse) || value.purse<0 || value.purse>MAX_COUNT || !Array.isArray(value.stock) ||
        !value.stock.every(function(row) {return row && Number.isInteger(row.baseId) && row.baseId>0 && row.baseId<=0xffffffff &&
          row.baseId!==15 && Number.isInteger(row.count) && row.count>0 && row.count<=MAX_COUNT;})))
    throw new Error('Pending merchant snapshot cannot be verified.');
  var snapshot={purse:value.purse,stock:value.stock,supply:supply};
  if(extended) {
    snapshot.commissions=COMMISSION_STATE.read(value.commissions);
    if(!compact)COMMISSION_STATE.spendable(snapshot);
  }
  return snapshot;
}
function pendingSnapshot(pending,value,compact) {return merchantSnapshot(value,compact,pending.version===4);}
function bounded(value, limit) {
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > limit) throw new Error('The trade is too large.');
  return value;
}
function inventory(value) {
  if (!value || !Array.isArray(value.entries) || Object.keys(value).length !== 1) throw new Error('Inventory cannot be verified.');
  var total=0;
  value.entries.forEach(function (row) {
    if (!row || !Number.isInteger(row.baseId) || row.baseId <= 0 || row.baseId > 0xffffffff ||
        !Number.isInteger(row.count) || row.count <= 0 || row.count > MAX_COUNT) throw new Error('Inventory cannot be verified.');
    total+=row.count;
    if(total>0xffffffff) throw new Error('Inventory total is too large.');
  });
  return bounded(copy(value), MAX_INVENTORY_BYTES);
}
function metadataKey(entry) {
  var out = {};
  Object.keys(entry).sort().forEach(function (key) { if (key !== 'count') out[key] = entry[key]; });
  return JSON.stringify(out);
}
function addEntries(snapshot, entries) {
  var next = inventory(snapshot);
  inventory({entries:entries}).entries.forEach(function (entry) {
    var key = metadataKey(entry);
    var held = next.entries.find(function (row) { return metadataKey(row) === key; });
    if (held) {
      if (held.count + entry.count > MAX_COUNT) throw new Error('Inventory count is too large.');
      held.count += entry.count;
    } else next.entries.push(copy(entry));
  });
  return inventory(next);
}
// skip, when given, names entries that are not the plain item even though
// they are on its record (a hair dye on the Bowl, #2675): they are never taken.
function takeEntries(snapshot, baseId, count, skip) {
  var next = inventory(snapshot), taken = [], left = count;
  for (var i = 0; i < next.entries.length && left > 0; i++) {
    var row = next.entries[i];
    if (row.baseId !== baseId) continue;
    if (typeof skip === 'function' && skip(row)) continue;
    var n = Math.min(left, row.count);
    taken.push(Object.assign({}, copy(row), {count:n}));
    row.count -= n; left -= n;
  }
  if (left) throw new Error('You are not carrying that.');
  next.entries = next.entries.filter(function (row) { return row.count > 0; });
  return {inventory:inventory(next), entries:taken};
}
function receiptAt(human, sequence) {
  return JSON.stringify({actor:human.desc, profile:human.profileId, sequence:sequence});
}
function sequenceOf(receipt, human) {
  var doc = JSON.parse(receipt);
  if (doc === null) return 0;
  if (!doc || Object.keys(doc).length !== 3 || doc.actor !== human.desc || doc.profile !== human.profileId ||
      !Number.isSafeInteger(doc.sequence) || doc.sequence < 1) throw new Error('Inventory receipt cannot be verified.');
  return doc.sequence;
}

function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') {
    var out=Object.create(null);
    Object.keys(value).sort().forEach(function(key) {out[key]=canonical(value[key]);});
    return out;
  }
  return value;
}
function digest(value) {return require('crypto').createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');}
function rows(snapshot) {return inventory(snapshot).entries.map(function(entry) {return {entry:entry,label:''};});}
function stockRows(stock) {
  var out=stock.map(function(row) {
    if(row.baseId===15) throw new Error('Merchant stock cannot be verified.');
    if(typeof row.name!=='string' || !row.name) throw new Error('Merchant stock cannot be verified.');
    var entry=row.entry===undefined ? {baseId:row.baseId,count:row.count} : row.entry;
    if(!entry || entry.baseId!==row.baseId || entry.count!==row.count) throw new Error('Merchant stock cannot be verified.');
    return {entry:copy(entry),label:row.name};
  });
  inventory({entries:out.map(function(row) {return row.entry;})});
  return out;
}
function bag(items, labelled) {
  var result=new Map();
  items.forEach(function(row) {
    var metadata=copy(row.entry);delete metadata.count;
    var key=JSON.stringify([labelled?row.label:'',canonical(metadata)]),held=result.get(key);
    if(held) held.count+=row.entry.count;
    else result.set(key,{entry:row.entry,label:row.label,count:row.entry.count});
  });
  return result;
}
function difference(before, after, labelled) {
  var old=bag(before,labelled), next=bag(after,labelled), result=[];
  next.forEach(function(row,key) {
    if(!old.has(key) || old.get(key).count<row.count) throw new Error('Merchant transfer does not conserve inventory.');
  });
  old.forEach(function(row,key) {
    var count=row.count-(next.has(key)?next.get(key).count:0);
    if(count) result.push({entry:Object.assign({},copy(row.entry),{count:count}),label:row.label});
  });
  return result;
}
function goodsDigest(items) {
  return digest(Array.from(bag(items,false),function(pair) {return [pair[0],pair[1].count];}).sort(function(a,b) {return a[0]<b[0]?-1:a[0]>b[0]?1:0;}));
}
function goldCount(items) {
  var total=0;
  items.forEach(function(row) {
    if(row.entry.baseId!==15) throw new Error('Merchant gold cannot be verified.');
    total+=row.entry.count;
  });
  if(total>MAX_COUNT) throw new Error('Merchant gold cannot be verified.');
  return total;
}

// Native receipt writes are atomic with the human inventory. Ledger writes are
// synchronous durable replacements. Neither is inferred from elapsed time.
function createSettlement(deps) {
  var purses = deps.purses, transfer = deps.transfer, world = deps.world;
  var now = deps.now || function () { return Date.now(); };
  var active = true, cursor = 0, busy = false;
  var errors = new Map();
  function report(id, error) {
    var message=String(error.message || error);
    if(errors.get(id)!==message && deps.log) deps.log('merchant settlement ' + id.toString(16) + ': ' + message);
    errors.set(id,message);
  }
  function available() {
    return active && !!world && !!purses && purses.durable !== false && typeof purses.compareAndCommit === 'function' &&
      typeof purses.pendingRecords === 'function' && typeof purses.read === 'function' &&
      !!transfer && typeof transfer.validate==='function' && transfer.available();
  }
  function humanKey(human) {
    if(!human || typeof human.desc!=='string' || !Number.isSafeInteger(human.profileId) || human.profileId<=0 || human.profileId>MAX_COUNT) return '';
    // FormDesc emits local hex alone for runtime humans and hex:plugin for
    // placed forms. Compare numeric ids so leading zeros cannot split a lock;
    // a runtime human by its runtime form id, the one shape (#2870).
    var parts=/^([0-9a-f]{1,6})(?::([^:\/\\\x00-\x1f\x7f]+\.(?:esm|esp|esl)))?$/i.exec(human.desc);
    if(!parts) return '';
    if(!parts[2]) return COMMISSION_STATE.formIdOf(parts[1]) ? JSON.stringify([COMMISSION_STATE.formIdOf(parts[1]),'',human.profileId]) : '';
    return JSON.stringify([parseInt(parts[1],16),parts[2].toLowerCase(),human.profileId]);
  }
  function nativeRows(snapshot) {
    var value=inventory(snapshot);
    if(transfer.validate(value)!==true || !active) throw new Error('Native inventory cannot be verified.');
    return rows(value);
  }
  function compact(pending) {
    return pending.phase==='credit' && pending.expected===undefined && pending.debit===undefined &&
      pending.previous && pending.previous.purse===undefined && pending.previous.stock===undefined;
  }
  // A supply wait names its character by runtime form id (#2870).
  function supplier(owner,human) {
    var id=COMMISSION_STATE.formIdOf(human && human.desc);
    return id>0 && owner[0]===id;
  }
  function supplyTransition(pending,previous,next,fresh,moved) {
    if(pending.kind!=='supply') {
      if(!equal(canonical(previous.supply),canonical(next.supply))) throw new Error('Merchant supply cannot be verified.');
      return;
    }
    var key=changedSupplyKey(previous,next), before=copy(previous.supply), after=copy(next.supply), owner;
    if(!key) throw new Error('Merchant supply cannot be verified.');
    delete before[key];delete after[key];
    if(!equal(canonical(before),canonical(after))) throw new Error('Merchant supply cannot be verified.');
    try {owner=JSON.parse(key);} catch(error) {owner=null;}
    if(fresh || pending.terms!==undefined) {
      if(!Array.isArray(owner) || owner.length!==3 || !supplier(owner,pending.human) || owner[1]!==pending.human.profileId ||
          typeof owner[2]!=='string' || !owner[2] || owner[2]!==owner[2].toLowerCase()) throw new Error('Merchant supply owner cannot be verified.');
      if(moved) {
        var labels=Array.from(new Set(moved.map(function(row) {return row.label;})));
        if(labels.length!==1 || owner[2]!==labels[0].toLowerCase()) throw new Error('Merchant supply owner cannot be verified.');
      }
    } else if(Array.isArray(owner) && (owner.length!==3 || !supplier(owner,pending.human) || owner[1]!==pending.human.profileId ||
        typeof owner[2]!=='string' || !owner[2]))
      throw new Error('Merchant supply owner cannot be verified.');
  }
  function conservation(pending, fresh) {
    bounded(pending,MAX_INTENT_BYTES);
    var credit=nativeRows({entries:pending.credit}), next=pendingSnapshot(pending,pending.next);
    stockRows(next.stock);
    if(pending.creditAttempt!==undefined) {
      nativeRows(pending.creditAttempt.expected);nativeRows(pending.creditAttempt.replacement);
      if(!equal(pending.creditAttempt.replacement,addEntries(pending.creditAttempt.expected,pending.credit)))
        throw new Error('Merchant recovery inventory cannot be verified.');
    }
    var isCompact=compact(pending), previous=pendingSnapshot(pending,pending.previous,isCompact);
    supplyTransition(pending,previous,next,fresh);
    if(isCompact) {
      if(pending.kind==='buy') {
        if(!credit.length || credit.some(function(row) {return row.entry.baseId===15;})) throw new Error('Merchant goods cannot be verified.');
      } else goldCount(credit);
      if(pending.terms!==undefined) {
        var terms=pending.terms;
        if(!terms || terms.version!==(pending.version===4?2:1) || terms.kind!==pending.kind || Object.keys(terms).length!==(pending.version===4?8:7) ||
            !Number.isInteger(terms.gold) || terms.gold<0 || terms.gold>MAX_COUNT ||
            ![terms.goods,terms.credit,terms.next,terms.previousSupply].every(function(hash) {return typeof hash==='string' && /^[0-9a-f]{64}$/.test(hash);}) ||
            terms.credit!==goodsDigest(credit) || terms.next!==digest(next) || terms.previousSupply!==digest(previous.supply) ||
            (pending.kind==='buy'?terms.goods!==goodsDigest(credit):terms.gold!==goldCount(credit)))
          throw new Error('Merchant compact terms cannot be verified.');
        if(pending.version===4) {
          if(terms.previousCommissions!==digest(previous.commissions))throw new Error('Commission terms cannot be verified.');
          commissionTransition(pending,previous,next,null,terms.gold);
        }
      }
      return pending.terms;
    }
    // A saved full transfer must still fit its eventual native replacement.
    nativeRows(addEntries(pending.debit,pending.credit));
    var removed=difference(nativeRows(pending.expected),nativeRows(pending.debit),false);
    var moved=pending.kind==='buy'?difference(stockRows(previous.stock),stockRows(next.stock),true):
      difference(stockRows(next.stock),stockRows(previous.stock),true);
    if(!moved.length || moved.some(function(row) {return row.entry.baseId===15;})) throw new Error('Merchant goods cannot be verified.');
    var gold=pending.kind==='buy'?next.purse-previous.purse:previous.purse-next.purse;
    if(gold<0 || gold>MAX_COUNT || (pending.kind==='buy'?
      goldCount(removed)!==gold || goodsDigest(credit)!==goodsDigest(moved):
      removed.some(function(row) {return row.entry.baseId===15;}) || goodsDigest(removed)!==goodsDigest(moved) || goldCount(credit)!==gold))
      throw new Error('Merchant transfer does not conserve goods and gold.');
    supplyTransition(pending,previous,next,fresh,moved);
    if(pending.version===4)commissionTransition(pending,previous,next,moved,gold);
    var summary={version:pending.version===4?2:1,kind:pending.kind,gold:gold,goods:goodsDigest(moved),credit:goodsDigest(credit),next:digest(next),previousSupply:digest(previous.supply)};
    if(pending.version===4)summary.previousCommissions=digest(previous.commissions);
    if(pending.terms!==undefined && !equal(canonical(pending.terms),canonical(summary))) throw new Error('Merchant terms cannot be verified.');
    return summary;
  }
  function commissionTransition(pending,previous,next,moved,gold) {
    if(pending.kind!=='commission') {
      if(!equal(canonical(previous.commissions),canonical(next.commissions)))throw new Error('Commission promises cannot change in an ordinary trade.');
      if(previous.purse!==undefined&&pending.kind!=='buy'&&gold>COMMISSION_STATE.spendable(previous))
        throw new Error('The merchant gold is reserved for commissions.');
      return;
    }
    var removed=Object.keys(previous.commissions.held).filter(function(key){return !Object.prototype.hasOwnProperty.call(next.commissions.held,key);});
    if(removed.length!==1)throw new Error('Commission completion must release exactly one promise.');
    var key=removed[0],row=previous.commissions.held[key],at=COMMISSION_STATE.cooldownAt(next.commissions.cool[key]);
    if(COMMISSION_STATE.key(pending.human,row.job)!==key||!Number.isSafeInteger(at)||at<row.at||gold!==row.gold)
      throw new Error('Commission owner or payment cannot be verified.');
    var finished=COMMISSION_STATE.finish(previous.commissions,pending.human,row.job,row.token,at);
    if(!finished.ok||!equal(canonical(finished.next),canonical(next.commissions)))throw new Error('Commission promise transition cannot be verified.');
    if(moved) {
      var promised=row.goods||[{item:row.item,count:row.count,unit:row.unit}],totals=new Map();
      moved.forEach(function(item){
        var good=promised.find(function(good){return item.entry.baseId===good.item.baseId&&item.label===good.item.name;});
        if(!good)throw new Error('Commission goods cannot be verified.');
        totals.set(item.entry.baseId,(totals.get(item.entry.baseId)||0)+item.entry.count);
      });
      if(promised.some(function(good){return totals.get(good.item.baseId)!==good.count;}))throw new Error('Commission goods cannot be verified.');
    }
  }
  function records() {
    try {
      var all=purses.pendingRecords(), merchants=new Set(), references=new Set(), transactions=new Set(), humans=new Set(), receipts=new Set();
      if(!Array.isArray(all) || all.length>MAX_PENDING) throw new Error('Pending merchant records cannot be verified.');
      all.forEach(function(record) {
        var state=record && record.state, pending=state && state.pending;
        if(!record || !state || !Number.isInteger(record.merchantId) || record.merchantId<=0 || record.merchantId>0xffffffff ||
            record.reference!==state.reference || !valid(pending,state)) throw new Error('Pending merchant records cannot be verified.');
        if(pending.version!==4&&state.commissions!==undefined)throw new Error('Legacy transfer cannot own commission promises.');
        var previous=pendingSnapshot(pending,pending.previous,pending.phase==='credit'), next=pendingSnapshot(pending,pending.next);
        if(!equal(pendingSnapshot(pending,state),pending.phase==='debit'?previous:next)) throw new Error('Pending merchant records cannot be verified.');
        conservation(pending,false);
        [[merchants,record.merchantId],[references,record.reference],[transactions,pending.id],[humans,humanKey(pending.human)],
          [receipts,pending.debitReceipt],[receipts,pending.finalReceipt]].forEach(function(pair) {
          if(pair[0].has(pair[1])) throw new Error('Pending merchant records cannot be verified.');
          pair[0].add(pair[1]);
        });
      });
      var latest=purses.pendingRecords();
      if(!active || !equal(all,latest)) throw new Error('Merchant settlement changed during validation.');
      return all;
    } catch(error) {active=false;throw error;}
  }
  function admitted(human, reference, reserveCapacity) {
    var pending = records(), key = humanKey(human);
    if (!key || reserveCapacity!==false && pending.length >= MAX_PENDING) return false;
    return pending.every(function (record) {
      var other = record.state.pending.human;
      return humanKey(other) && humanKey(other) !== key && record.reference !== reference;
    });
  }
  function save(id, state, next, intentId, caller) {
    if (!active || intentId && (!state.pending || state.pending.id !== intentId)) return null;
    try {
      if(caller!==undefined&&purses.callerGuard!==true)throw new Error('Guarded commission writes are unavailable.');
      var committed = purses.compareAndCommit(id, state.revision || 0, next, caller);
      return active ? committed : null;
    } catch (error) {
      // The replacement may be durable even when its acknowledgement failed.
      // Only a newly loaded ledger can decide what happened.
      active = false;
      throw error;
    }
  }
  function identity(pending) {
    var id = transfer.resolve(pending.human.desc);
    if (!id) return 0;
    var human = transfer.identity(id);
    return equal(human, pending.human) ? id : 0;
  }
  function valid(pending, state) {
    return state && pending && (pending.version===2 && pending.terms===undefined || (pending.version===3||pending.version===4) && pending.terms!==undefined) && pending.world === world &&
      pending.reference === state.reference && pending.base === state.base &&
      typeof pending.id === 'string' && pending.id.length>0 && humanKey(pending.human) &&
      (['buy','sell','supply'].indexOf(pending.kind)>=0||pending.version===4&&pending.kind==='commission') &&
      (pending.phase === 'debit' || pending.phase === 'credit') &&
      Number.isSafeInteger(pending.sequence) && pending.sequence > 0 && pending.sequence < Number.MAX_SAFE_INTEGER &&
      pending.debitReceipt === receiptAt(pending.human, pending.sequence) &&
      pending.finalReceipt === receiptAt(pending.human, pending.sequence + 1) &&
      (pending.phase==='credit' && pending.expectedReceipt===undefined && pending.expected===undefined && pending.debit===undefined &&
        pending.previous && pending.previous.purse===undefined && pending.previous.stock===undefined ||
        pending.expectedReceipt===(pending.sequence===1?'null':receiptAt(pending.human,pending.sequence-1)));
  }
  function commitMerchant(id, state) {
    var pending = state.pending;
    if (!equal(pendingSnapshot(pending,state), pendingSnapshot(pending,pending.previous))) return null;
    return save(id, state, creditState(state), pending.id);
  }
  function creditState(state) {
    var next = Object.assign({}, copy(state), pendingSnapshot(state.pending,copy(state.pending.next)));
    next.pending.phase = 'credit';
    // Saved debit is conclusive. Its original snapshots are no longer read
    // in this phase; retaining them would crowd out the recovery snapshots.
    delete next.pending.expected;
    delete next.pending.debit;
    delete next.pending.expectedReceipt;
    next.pending.previous = {supply:copy(next.pending.previous.supply || {}),
      ...(state.pending.version===4?{commissions:copy(state.pending.previous.commissions)}:{})};
    return next;
  }
  function pruneSupplyHistory(id, state, wait) {
    if (!available() || busy) return null;
    busy = true;
    try {
      records();
      var current = purses.read(id);
      if (!current || current.pending || !equal(current, state)) return null;
      try {merchantSnapshot(current,false,current.commissions!==undefined);} catch(error) {active=false;throw error;}
      var next = copy(current), changed = false, at = now();
      Object.keys(next.supply || {}).forEach(function (key) {
        var stamp = next.supply[key];
        if (Number.isSafeInteger(stamp) && stamp > 0 && at - stamp >= wait) {
          delete next.supply[key]; changed = true;
        }
      });
      return changed ? save(id, current, next) : current;
    } finally { busy = false; }
  }
  function changedSupplyKey(previous, next) {
    var before = previous.supply || {}, after = next.supply || {};
    var keys = Object.keys(after).filter(function (key) { return before[key] !== after[key]; });
    return keys.length === 1 && Number.isSafeInteger(after[keys[0]]) && after[keys[0]] > 0 ? keys[0] : null;
  }
  function complete(id, state) {
    var pending = state.pending, next = Object.assign({}, copy(state), {pending:null});
    if (pending.kind === 'supply') {
      // Completion, including legacy intents, follows the exact saved final
      // receipt. A disconnect cannot consume the six-hour window in advance.
      var key = changedSupplyKey(pending.previous, pending.next), at = now();
      if (!key || !Number.isSafeInteger(at) || at <= 0) throw new Error('Supply completion cannot be verified.');
      next.supply[key] = at;
    }
    if(pending.kind==='commission') {
      var keys=Object.keys(pending.previous.commissions.held).filter(function(key){return !Object.prototype.hasOwnProperty.call(pending.next.commissions.held,key);});
      var completedAt=now();
      if(keys.length!==1||!Number.isSafeInteger(completedAt)||completedAt<COMMISSION_STATE.cooldownAt(pending.next.commissions.cool[keys[0]]))
        throw new Error('Commission settlement time cannot be verified.');
      if(Array.isArray(next.commissions.cool[keys[0]]))next.commissions.cool[keys[0]][0]=completedAt;
      else next.commissions.cool[keys[0]]=completedAt;
    }
    return !!save(id, state, next, pending.id);
  }
  function reconcile(id, checked) {
    if (!available()) return false;
    var state = purses.read(id), pending = state && state.pending;
    if (!valid(pending, state) || !equal(state,checked)) return false;
    var humanId = identity(pending);
    if (!active || !humanId) return false;
    var live = transfer.receipt(humanId), saved = transfer.saved(humanId);
    if (!active) return false;
    if (live === pending.finalReceipt) {
      if (pending.phase !== 'credit' || saved !== pending.finalReceipt ||
          !equal(pendingSnapshot(pending,state), pendingSnapshot(pending,pending.next))) return false;
      return complete(id, state);
    }
    if (pending.phase === 'debit') {
      if (live === pending.expectedReceipt) {
        // Replaying the identical debit is safe only against its original
        // snapshot and receipt. A refused snapshot remains reserved.
        if (!active) return false;
        if (!equal(transfer.inventory(humanId), pending.expected)) {
          // Calls are synchronous and busy fences this instance. An unchanged
          // original receipt proves this transaction never changed inventory,
          // including after restart. No original inventory restoration is needed.
          return !!save(id, state, Object.assign({}, copy(state), {pending:null}), pending.id);
        }
        if (!active) return false;
        var currentHumanId=identity(pending);
        if (!active || currentHumanId!==humanId) return false;
        var changed = transfer.cas(humanId, pending.expected, pending.expectedReceipt, pending.debit, pending.sequence, pending.human.profileId);
        if (!active) return false;
        live = transfer.receipt(humanId); saved = transfer.saved(humanId);
        if (changed === false && live === pending.expectedReceipt)
          return !!save(id, state, Object.assign({}, copy(state), {pending:null}), pending.id);
      }
      if (live !== pending.debitReceipt || saved !== pending.debitReceipt || !active) return false;
      state = commitMerchant(id, state);
      if (!state || !active) return false;
      pending = state.pending;
    }
    if (live !== pending.debitReceipt || saved !== pending.debitReceipt || !active) return false;
    // A pre-upgrade credit intent may still contain the saved debit snapshots.
    // Compact it durably before building or replacing a recovery attempt.
    var compact = creditState(state);
    if (!equal(compact, state)) {
      state = save(id, state, bounded(compact, MAX_INTENT_BYTES), pending.id);
      if (!state || !active) return false;
      pending = state.pending;
    }
    var current = inventory(transfer.inventory(humanId));
    if (!pending.creditAttempt || !equal(pending.creditAttempt.expected, current)) {
      var next = copy(state);
      next.pending.creditAttempt = {expected:current,replacement:addEntries(current, pending.credit)};
      if(transfer.validate(next.pending.creditAttempt.replacement)!==true) throw new Error('Native inventory validation failed.');
      state = save(id, state, bounded(next, MAX_INTENT_BYTES), pending.id);
      if (!state || !active) return false;
      pending = state.pending;
    }
    if (!active) return false;
    var currentHumanId=identity(pending);
    if (!active || currentHumanId!==humanId) return false;
    transfer.cas(humanId, pending.creditAttempt.expected, pending.debitReceipt,
      pending.creditAttempt.replacement, pending.sequence + 1, pending.human.profileId);
    // A notification may throw after CAS changed inventory. The saved intent
    // and final receipt, rather than this return value, determine completion.
    if (!active || transfer.receipt(humanId) !== pending.finalReceipt || transfer.saved(humanId) !== pending.finalReceipt) return false;
    return complete(id, state);
  }
  function begin(offer) {
    if (!available() || busy) return {accepted:false,done:false,reason:'Trading is unavailable.'};
    busy = true;
    try {
      var human = transfer.identity(offer.humanId), state = purses.read(offer.merchantId);
      if (!human || human.profileId !== offer.profileId || !state || state.pending ||
          !equal(state, offer.previous) || !admitted(human, state.reference))
        return {accepted:false,done:false,reason:'A transfer is waiting.'};
      var previous;
      var version=state.commissions!==undefined?4:3;
      try {previous=merchantSnapshot(state,false,version===4);merchantSnapshot(offer.next,false,version===4);}
      catch(error) {active=false;throw error;}
      if (offer.kind === 'supply') {
        var key = changedSupplyKey(state, offer.next), owner;
        try { owner = JSON.parse(key); } catch (error) { owner = null; }
        if (!Array.isArray(owner) || owner.length !== 3 || !supplier(owner, human) ||
            owner[1] !== human.profileId || typeof owner[2] !== 'string' || !owner[2])
          throw new Error('Supply cooldown cannot be verified.');
      }
      var expected = inventory(transfer.inventory(offer.humanId));
      if (!equal(expected, offer.expected)) return {accepted:false,done:false,reason:'Your inventory changed. Choose the trade again.'};
      var receipt = transfer.receipt(offer.humanId), sequence = sequenceOf(receipt, human) + 1;
      if (transfer.saved(offer.humanId) !== receipt)
        return {accepted:false,done:false,reason:'Your previous inventory change is waiting on the save.'};
      if (!Number.isSafeInteger(sequence + 1)) throw new Error('Inventory receipt sequence is exhausted.');
      var pending = {version:version,id:world + ':' + state.reference + ':' + (state.revision || 0),world:world,
        reference:state.reference,base:state.base,human:human,kind:offer.kind,phase:'debit',
        previous:copy(previous),next:copy(offer.next),
        expected:expected,expectedReceipt:receipt,debit:inventory(offer.debit),credit:inventory({entries:offer.credit}).entries,
        sequence:sequence,debitReceipt:receiptAt(human,sequence),finalReceipt:receiptAt(human,sequence+1)};
      // Use the same native validator as CAS, including its serialized-byte
      // representation. No separate JS estimate can substitute for that check.
      [expected,pending.debit,addEntries(pending.debit,pending.credit)].forEach(function (snapshot) {
        if(transfer.validate(snapshot)!==true) throw new Error('Native inventory validation failed.');
      });
      pending.terms=conservation(pending,true);
      var armed = Object.assign({}, copy(state), {pending:pending});
      if(!valid(pending,state)) {active=false;throw new Error('Pending merchant records cannot be verified.');}
      // Either recovery inventory can reach the native/JS inventory limit.
      // Reserve both plus the JSON envelope before charging, including later
      // inventory growth. The 512 KiB intent bound stays unchanged.
      var recovery = creditState(armed);
      if (Buffer.byteLength(JSON.stringify(recovery), 'utf8') + 2 * MAX_INVENTORY_BYTES + 64 > MAX_INTENT_BYTES)
        throw new Error('The trade is too large to recover.');
      if (!save(offer.merchantId, state, bounded(armed, MAX_INTENT_BYTES),undefined,offer.caller)) return {accepted:false,done:false,reason:'The offer changed.'};
      var done = false;
      if (active) {
        try {
          var checked=records().find(function(record) {return record.merchantId===offer.merchantId;});
          done=!!checked && reconcile(offer.merchantId,checked.state);
        }
        catch (error) { report(offer.merchantId,error); if (!active) throw error; }
      }
      var after = active && purses.read(offer.merchantId);
      var cancelled = after && !after.pending && equal(pendingSnapshot(pending,after),pendingSnapshot(pending,pending.previous));
      return {accepted:!cancelled,done:done && !cancelled,reason:cancelled ? 'Your inventory changed. Choose the trade again.' : done ? '' : 'The transfer is waiting on the save.'};
    } finally { busy = false; }
  }
  function tick() {
    if (!available() || busy) return [];
    busy = true;
    try {
      var all = records(), changed = [];
      for (var i = 0; i < Math.min(MAX_PENDING, all.length) && active; i++) {
        var record = all[(cursor + i) % all.length];
        try { if(reconcile(record.merchantId,record.state)) {changed.push(record.merchantId);errors.delete(record.merchantId);} }
        catch (error) { report(record.merchantId,error); if (!active) throw error; }
      }
      cursor = all.length ? (cursor + MAX_PENDING) % all.length : 0;
      return changed;
    } finally { busy = false; }
  }
  function withInventoryMutation(actorId,change) {
    if(!available() || busy)return {ok:false,why:'unavailable'};
    busy=true;
    var leased=true;
    try {
      var human=transfer.identity(actorId);
      if(!human || !admitted(human,'',false))return {ok:false,why:'waiting'};
      if(transfer.saved(actorId)!==transfer.receipt(actorId))return {ok:false,why:'waiting'};
      if(!active)return {ok:false,why:'unavailable'};
      var result=change(human,function(){return active && leased;});
      // Unknown receipts revoke all writers until a reload reads durable state.
      if(result && result.uncertain)active=false;
      return result;
    } finally {leased=false;busy=false;}
  }
  function canInventoryMutation(actorId) {
    if(!available() || busy)return false;
    busy=true;
    try {
      var human=transfer.identity(actorId);
      return !!human && admitted(human,'',false) && transfer.saved(actorId)===transfer.receipt(actorId) && active;
    } finally {busy=false;}
  }
  function canRetire() {
    if(!available() || busy) return false;
    busy=true;
    try {return records().every(function(record) {return record.state.pending.version===3||record.state.pending.version===4;});}
    finally {busy=false;}
  }
  function changeCommissions(id,state,next,human,caller,action) {
    if(!available()||busy||purses.callerGuard!==true||typeof caller!=='function')return null;
    busy=true;
    try {
      if(!humanKey(human)||!admitted(human,state.reference,false))return null;
      var current=purses.read(id);
      if(!current||current.pending||!equal(current,state)||
        !equal(merchantSnapshot(state),merchantSnapshot(next)))return null;
      COMMISSION_STATE.spendable(state);COMMISSION_STATE.spendable(next);
      var prior=copy(state),replacement=copy(next);
      delete prior.commissions;delete replacement.commissions;
      if(!equal(canonical(prior),canonical(replacement))||!action||!['reserve','cancel'].includes(action.kind)||
        !Number.isSafeInteger(action.at)||action.at<=0||action.at>now())throw new Error('Commission metadata action cannot be verified.');
      var changed=action.kind==='reserve'?
        COMMISSION_STATE.reserve(state.commissions,human,action.job,action.terms,action.at,state.purse):
        COMMISSION_STATE.cancel(state.commissions,human,action.job,action.token,action.at);
      if(!changed.ok||!equal(canonical(changed.next),canonical(next.commissions)))
        throw new Error('Commission metadata transition cannot be verified.');
      return save(id,state,next,undefined,caller);
    } finally {busy=false;}
  }
  return {begin:begin,tick:tick,available:available,canRetire:canRetire,changeCommissions:changeCommissions,pruneSupplyHistory:pruneSupplyHistory,
    withInventoryMutation:withInventoryMutation,canInventoryMutation:canInventoryMutation,shutdown:function () { active=false; }};
}

module.exports = {createSettlement:createSettlement,stockRows:stockRows,inventory:inventory,takeEntries:takeEntries,
  addEntries:addEntries,metadataKey:metadataKey,MAX_PENDING:MAX_PENDING};
return module.exports;})();
const MERCHANT_COMMISSIONS = (function () { const module = {exports:{}};
'use strict';
const STATE=typeof MERCHANT_COMMISSION_STATE!=='undefined'?MERCHANT_COMMISSION_STATE:require('./merchant-commission-state');
const INVENTORY=typeof MERCHANT_SETTLEMENT!=='undefined'?MERCHANT_SETTLEMENT:require('./merchant-settlement');
const copy=value=>JSON.parse(JSON.stringify(value));
const hash=value=>require('node:crypto').createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Published jobs remain routable while their accepted promises exist.
const publication=Object.freeze({
 'q-whiterun-smith-straps':'8f03bdc903aaf1e37727f54a3e49bfdea5a2b817bc7534ba0111c88d25502734',
 'q-rift-woodworker-hunt-arrows':'84b31663cd265c9b26068ff7343622f04b332ddce394e58b52a55b0b6cbb3a89',
 'q-falkreath-tailor-mourning-thread':'8dded80c9b0e56c8a18158136ca200481a444582a41cc98000fe8ad612ec0aef',
 'q-haafingar-cook-dock-supper':'cfd57250d82ce20c23fa8db5c802509e103d6dd8c0e0a55654b1ed4da12c8a11',
 'q-hjaalmarch-alchemist-marsh-poultices':'5b8b08e462680c7249f9359498a84f1e1ccbc7ff30020ed1d15fbdd204703652',
 'q-whiterun-smith-spare-pick':'df7c54b9f75be97be6c525080c59640af7448efa017dc9d3ed0c7d5c649f00b0',
 'q-rift-woodworker-spare-pole':'5c443c243872afe4c5068bc66345def10fc3efdb3c4bb8291a4bc2222c1f2e74',
 'q-falkreath-tailor-trail-boots':'c80cf0cfa03d0d7bbd02dac97a3ba10a92d6b112c6f18a21df6c77404e22acb1',
 'q-haafingar-cook-field-soup':'7f3e208a1bf02b1e44e007a77e18baa712e74a70c12c06efeea716f6af0210ac',
 'q-hjaalmarch-alchemist-cotton-dressings':'7dd3a8f94cecd900b4211180e69ed764bd684b32512d1d262ae97feb972b78a9',
 'q-whiterun-smith-ebony-seam-account':'d09451fa3306f0743d0e68bd78ae43bde11dcd0fdc2761abe37c350d37a70faa',
 'q-whiterun-woodworker-outfitter-reserve':'a94934368484eaf0bcfa65564909260c8b1da3e198a11495b31a8d1c070836e0',
 'q-whiterun-tailor-winter-vestments':'68f0406f1fe3db80d3b820d13413c0419a960da038eef3a54ac103091d9af2e0',
 'q-whiterun-enchanter-ward-demonstration':'8f19b0da990fc2102dd312016717dc92a48f23d6bcfdec622aaf3adc621d169e',
 'q-whiterun-cook-mammoth-supper':'d8731860a77c3864c7b01ab6fa45c5311e0dfc1b68e8fbfec91e7b2b34fab5d4',
 'q-whiterun-alchemist-ash-expedition':'75d2ee9fbfc5902fe6b9d200feeb7ede1b0773d57c1dbad4e6b14db5b11479df',
 'q-whiterun-alchemist-travelling-case':'7131990508cefa6f7c7601227b888ed4f4c70c28990dda2a863b37436760a9da',
 'q-whiterun-enchanter-commission-rack':'531aabc2aaf3355f9867da014fb417e68b0a6171df577e82d7b39b61c5713787',
 'q-whiterun-smith-steel-blade-set':'b40b831c7c694b54bc1ae5d771e78136855044c542e78c02b492d0232970a43c',
 'q-whiterun-smith-glass-defence':'014841f818c26e6d1cf81ce9343f7554256fe0f12fd649d27d0a21a3e8ff91d3',
 'q-whiterun-woodworker-first-water-kit':'853bb28de7faec0ea0bdf90055369f01567e22b984055c9c835994db1c38ed06',
 'q-whiterun-woodworker-orcish-bow-kit':'7bdfd4fe29bd068d09aca13dddb8622317c7dda4d7410a07876a0bce1799d72c',
 'q-whiterun-woodworker-briquette-tools':'40fc07a8bd93a29fdaabc2cbbeb9fc97ac872cf2cafdbd8dfbe61341575c3507',
 'q-whiterun-tailor-hunt-feast-ribbons':'ebc1fece8c87c358e29c25945d428355036fd4bfe89d2c220c4f630d78b9ad89',
 'q-whiterun-tailor-white-fur-trimmings':'c914eff5b96246ef00a834b319b63d4289ba6f8c925c85220d732a0ca083f4f4',
 'q-whiterun-enchanter-glass-blade-supplies':'9b7585d22ff171b69fdd036ac4a72b191f34797d92350b77dde6c766d24eab37',
 'q-whiterun-cook-field-meal-parcel':'2ea942805da47f530b5bacfac762e1d6fa70c4c2f8d04603e0d06b266c977d79',
 'q-whiterun-cook-tomato-bread-order':'cc4f4f0682b62ef1b3029f500cf17baa8aa0fe689e93bbeaaf7e58260adcff63',
 'q-whiterun-cook-apple-dessert-order':'8abf81285bad8141f47e8908b28158537dd2856e240ba88317a541ede5411ddf',
 'q-whiterun-alchemist-lavender-cotton':'67ab5bbdfc39ab76203ab4b745ee9273277966436811ea357144d99efa1107ae',
 'q-whiterun-alchemist-fungal-collection':'5cb145a895c223d243bdb074f7ff5bd9f5704b75567358fbfab6b87105d87286',
 'q-solitude-smith-novice-parcel':'df7211e51512ad2baaa9b5ac808534cbb2dee4665a81d44fd152ef57a4128efb',
 'q-solitude-smith-advanced-parcel':'a1822b9c559eaf81c5b344087327bc324763cc4a0d7892086822c7962bb7ef09',
 'q-solitude-smith-expert-parcel':'c83f6c333a4a6dab26d77b3060a501ea3410e374148fe6cfe9f82e4ebe7de1d5',
 'q-solitude-smith-master-parcel':'145ec5099550e94b549a8467002eda9be6a95f0013a9c098e15a755f1059b52f',
 'q-solitude-woodworker-novice-parcel':'eff78b719516104c504065fd236abc5b5cf6a0b55aa7dd6d3d73e62acd6c0618',
 'q-solitude-woodworker-advanced-parcel':'5c670ce213b54dda267885e71d68fa98c1e4ff3a26cecef57da5a6bb0e451483',
 'q-solitude-woodworker-expert-parcel':'83b5039ab24f758b03542d82e36e998b802bdb098b788985ba860d84a5714efc',
 'q-solitude-woodworker-master-parcel':'8adf898f6904b8c48693a6f36d3e8979735774b25aa9f23f95756af1722d5af0',
 'q-solitude-tailor-novice-parcel':'46b2bf83e16e8d6d299de0cfdcdcdb5f6ff8f4a3eee8c4165ba868f0671991a6',
 'q-solitude-tailor-advanced-parcel':'038aee1d0874634bcb1f5410763aa71259d615d33fdd4fcac6889d2dfc2e376b',
 'q-solitude-tailor-expert-parcel':'601b656ab3906df24a575a3b11ba3e4c8dfb09fe735b3e75ae8074948989b2f9',
 'q-solitude-tailor-master-parcel':'a6874618ac393fcd1a3de174792564c72f47c6476e56b9a8b2eb5b0c14f05e27',
 'q-solitude-enchanter-novice-parcel':'b85aa9d71e3ba84bc5b330d03f072ba776dc684433d5c9eb6028619d3bcfedc1',
 'q-solitude-enchanter-advanced-parcel':'62e017232f60eaa1d8700b6a252fdd8666a6107484468230df7fd5d48936edec',
 'q-solitude-enchanter-expert-parcel':'c1c516c4149e23ad465a01b897204fcf6891ff936d37a0c531df677bc368db93',
 'q-solitude-enchanter-master-parcel':'4236b0aca6430b17ade65b1f5b179af42239b4bff0479ebd00d9e18271f2f3a4',
 'q-solitude-cook-advanced-parcel':'1772d5bb9a497f7a3b4f4e62f17685cabb682b6145148686eee210e43a7e85b9',
 'q-solitude-cook-expert-parcel':'ae91b7abf34c51b21fca3089f4e7cde187cb9b4d410e28a99d6d6df36024c347',
 'q-solitude-cook-master-parcel':'ff3025444aa93d780a488a686069767b5498561284d7c0629779648c335e7ad0',
 'q-solitude-alchemist-novice-parcel':'5265cf07dd4493c7f21fadedbd79350e672da0ff1adf0aa24edc1c351b8edb84',
 'q-solitude-alchemist-advanced-parcel':'d20cdc3ff2441af5c52ca3fe7851a990f0345775198676024aed996090455cb5',
 'q-solitude-alchemist-expert-parcel':'82035e27fa5993ef137a44bf22a566121e67593bbfc9ceb6e944707ae7a719fb',
 'q-solitude-alchemist-master-parcel':'d02aaac889785a16a365c3eca50b9e955bd94a9e5721451471ac8c70227d88fd',
 'q-riften-smith-novice-parcel':'147aaf8482e18415ffc9f5bbace4bae68cbde751325b5b04f230c30e68ac24d4',
 'q-riften-smith-advanced-parcel':'f9e445a8711b9825fd5117b8f74299d58daa5b3f66eeb190a96e51bb2b892a8c',
 'q-riften-smith-expert-parcel':'956c8368cb647136fed47901da4fed2c6286b4821463eeea7060e162b6beb9d1',
 'q-riften-smith-master-parcel':'e3bb684140354c61c7fc6c98dae1afa6a83fce572a9d3eea424b128940241fae',
 'q-riften-woodworker-advanced-parcel':'76b9aee0436ca6224778be010a1b7f2678550bbfdf7211c0be646c20c7098b71',
 'q-riften-woodworker-expert-parcel':'9c9f0785246cbeb2375a4b4b13ed8be5e35db225c7a8c744d90ea8cc904e3ae2',
 'q-riften-woodworker-master-parcel':'bb78ef69e73338888a8b5a28d1275a2d97b94af1172a2c823c92d39a89bf8342',
 'q-riften-tailor-novice-parcel':'f688f2a5c8441d986603744c398a860b7525f5d6404183e6dea517504dc6013c',
 'q-riften-tailor-expert-parcel':'385d0c7577db65393ab4e08e94429e338ba8e34499fc60d715eaa92751ccf6e4',
 'q-riften-tailor-master-parcel':'cbe99b87e92481de6f5ebcf35f8f842dae8711f919c3397f1c7fc201f41505d7',
 'q-riften-enchanter-novice-parcel':'2e3386850953c862108bf1f33b5d45cb5a5ca39d0579a379520d7867a166fe6d',
 'q-riften-enchanter-advanced-parcel':'5170503cc1f9a7ad816967c3409aece3c4101c37f7a7dffb705e8fe54544ae92',
 'q-riften-enchanter-expert-parcel':'9638f8521d601c8bb16ddde88ce0b82e5f5c187b8d246c59c1aaa51e41c1bae3',
 'q-riften-enchanter-master-parcel':'908deb3f07b96655711c7a4a2bb61988cedaec07fc1c17f8ad968786a0fc0fca',
 'q-riften-cook-novice-parcel':'60489099acb4ad46a6c24ba853b3e587bb62e032958999dc838d5a3dccff84e9',
 'q-riften-cook-advanced-parcel':'e7ca3fe3b22483768aa7a965db571d4af1f2b693aee1e96dc9e0ef6eafac6273',
 'q-riften-cook-expert-parcel':'175b846701a3bc02080ba416438060d794a838ed6839e7d4221d1b32ad15014a',
 'q-riften-cook-master-parcel':'79a05e34b25a2cbf20ca03d6e5227d746a031aafbfed701c46012cce6ce6cf8c',
 'q-riften-alchemist-novice-parcel':'babcd40296416c5a92a0887b832b5c2d5e4572ba790bb76134eb4efcd3337134',
 'q-riften-alchemist-advanced-parcel':'3e8cea381c48b8ceab960e61e9c10e26b5b13a4f558a5d0fb9b22c8d65e66100',
 'q-riften-alchemist-expert-parcel':'890f7cfc2c431c5cfbefc78c7bdef92dc41d0bacbe3ef675f7d4017359433755',
 'q-riften-alchemist-master-parcel':'78a27b84dc9d0aaaa649264dd908a952b0212b2029aa49bd9ffcfb8d0de802b0',
 'q-markarth-smith-novice-parcel':'fc2122cf0cf6c6e988886fb8a4011aa2d286eeff2a9db9ecd12ea35d67113259',
 'q-markarth-smith-advanced-parcel':'7cd6771000f07fd8fab7060d145c07f784d278d0d8935027c73bff65d45a7449',
 'q-markarth-smith-expert-parcel':'9f8a055c39abe1c6da78e026d06439129cb9209423504f58d10aab4011fd5a2d',
 'q-markarth-smith-master-parcel':'f9b1854ae2954c03148c0953b29b7f03077aee9842b9a0405a4340d8ff388bec',
 'q-markarth-woodworker-novice-parcel':'8a14d28f769296a7779f86bfe78517a8388e58d86feded698a791cbcefe9538e',
 'q-markarth-woodworker-advanced-parcel':'83dc5ab0d102b917460dc3ad68b39b8ea25dffaf511f6f0b520356b6b3dd931b',
 'q-markarth-woodworker-expert-parcel':'2bdfa338694777b2af3bf7dad169013e990a12f7b92c1c3bc3fb417b0eff8c69',
 'q-markarth-woodworker-master-parcel':'8378ba65a73153a84b4a6dbde433ed97caf1cbd4d3e4167ce52bc5fe8da8c538',
 'q-markarth-tailor-novice-parcel':'41d6dcf835ba00f47aad39321873750c027453c2f72770f22ac49665b6d7c42b',
 'q-markarth-tailor-advanced-parcel':'3575fb5956c6bfca509b104b5ea5c869b396deea02183b6993e379251fb5b463',
 'q-markarth-tailor-expert-parcel':'a82db75d4c592db004bcdc23e84c5df26ebe1d11ae86d6e84c87b43925760e23',
 'q-markarth-tailor-master-parcel':'d1c3e3fc5101c91621156be66ebb239bc6b230a35308110dcf589c3fdfec86f7',
 'q-markarth-enchanter-novice-parcel':'f4e8deb7f06db5fcbb86b7bea4ce92e6653822e8db470658fd7bd7fb5e7ac78a',
 'q-markarth-enchanter-advanced-parcel':'d512ed14fd1ff31a91572773f99f72de06a4ff8a403c6fbfd881df6e3921ca27',
 'q-markarth-enchanter-expert-parcel':'ae00a0f4ac01f6369331c039a5ff2613a260a67a08e368265f368bbd6dcb9084',
 'q-markarth-enchanter-master-parcel':'ab4c44e94cfb2fb9282dbceda00ceed78b916eb835cc9b13db53c48bc6becc4a',
 'q-markarth-cook-novice-parcel':'5fd53334c226ce6704106b241bc57cdee0d55ed51fc8183aff35703ac0631b10',
 'q-markarth-cook-advanced-parcel':'d1ffb9be87476f061d36e9014350dc72dacb9eee866b4a2e483f9e68dea3732e',
 'q-markarth-cook-expert-parcel':'afdedf75a9443c1a240eeda12e43c19e1a97ee2ccceb99f2036dd9041020b751',
 'q-markarth-cook-master-parcel':'1d9726f66c9475f243dd98c2ad8b5413531d9872e8a2c0f3d236b05e30889f24',
 'q-markarth-alchemist-novice-parcel':'d9f9e50d28fba45eaa5d3f7ffff68474e92931bbbbbdf5ea764ed75fee3e3744',
 'q-markarth-alchemist-advanced-parcel':'d3f55b2c5c9c66b6155d646e31cd8284c847945823f3a6b31253299c2e936b6a',
 'q-markarth-alchemist-expert-parcel':'a12e438d237306c6281f5e532e80c4bf3aebf604ae1cd50f3792fe3588a5b100',
 'q-markarth-alchemist-master-parcel':'f46347e9e2a02ba39a843d35a3bd8bcda9a063d0f98cd85830c439486c2cf419',
 'q-windhelm-smith-novice-parcel':'c0e4218201818d55a7957bfdcf02672343e7d585b74af1b4f76448cf0883b86e',
 'q-windhelm-smith-advanced-parcel':'fa8cafb3541d990d0868527a403051fb9deac6ae4b2c5febf06bb7fc15b102b0',
 'q-windhelm-smith-expert-parcel':'c29193fea0e4eca0b1b77134c1f145a5bc168d9a9de9bb65884708c831026861',
 'q-windhelm-smith-master-parcel':'0e32a9558d1c6f039dc4a57cfeb09383bfccc6eaff0abec37451288f62c3d606',
 'q-windhelm-woodworker-novice-parcel':'04e22dbf3675ba9281a944e7aa4f8e7a42fe253ad91571954bd9e04188de82dd',
 'q-windhelm-woodworker-advanced-parcel':'44380d7414e269163ceb131070d2fa45d9394f3e8e1c575bb82d6e653f80f954',
 'q-windhelm-woodworker-expert-parcel':'4c49c060c88282c277a28b75fe20ecf6438e8360a9f8fbc948e8267d30a11411',
 'q-windhelm-woodworker-master-parcel':'5d6b5bb46c39a96c1a07d0bef4d209f9285eb7dfb26c9a2367f155dce1a2c045',
 'q-windhelm-tailor-novice-parcel':'c312b72a66b80d09c7bb78b9225434eb56d25035810af5054ccd21214bed456b',
 'q-windhelm-tailor-advanced-parcel':'e78c9b94d05aa1048459e5a41c95d3232355b4f72f4e5738cc17f18555b6b419',
 'q-windhelm-tailor-expert-parcel':'692711d814bae0d42cc8be0badc140d2aa18778429af2ff48c2a5824ea7be537',
 'q-windhelm-tailor-master-parcel':'c7a3f61df76c862b67e4e02c0c64e437e7ae8e659bb1eeb9db99641d9d6aa6dc',
 'q-windhelm-enchanter-novice-parcel':'903a626b593e5ef06e17d30529e534e3a6e02a7ba7dec393e987a2b9f36ad7db',
 'q-windhelm-enchanter-advanced-parcel':'ec803e6460f66f8960b16ecd82952a674ab7efc12ef44e7472f54535e24fc611',
 'q-windhelm-enchanter-expert-parcel':'991d265f4c541513b73150d6fc7378041f3801839e7a1b2e4f0235745ab2e78e',
 'q-windhelm-enchanter-master-parcel':'4355d3eb01e0c995716d7bba1d04ebe43d03d3df54df1f20f07a202c44505e3e',
 'q-windhelm-cook-novice-parcel':'9e065bbcc57b9a3f87ed07ed2dfabdc7a7bbb137c5fe08e7c01cb5e51bf1e99b',
 'q-windhelm-cook-advanced-parcel':'9d82f18a0387f7d5c00f201224daa8a47c7f2a83573ab3593c4a441122ef8f5a',
 'q-windhelm-cook-expert-parcel':'4d4ac7df1b7666af20d1ac1f0eb2ac29ad95db1f69c258646a1212d48bd3aa47',
 'q-windhelm-cook-master-parcel':'bf138c7f1125f7f849c416e0ecf8e2edce337eadfae93b88f0af988dbed749a8',
 'q-windhelm-alchemist-novice-parcel':'ee40865e133bd7f2b0d605ef4a9c4712a1ea2810044ede29feb45922ca738361',
 'q-windhelm-alchemist-advanced-parcel':'d24414df81db0d7019f9316b910bb1b6b77619741545c2443295b8a1cf7e102a',
 'q-windhelm-alchemist-expert-parcel':'09281de4aadb3aa2779b01e07851d7ffe5a9262cf400133fc0c814de483133ba',
 'q-windhelm-alchemist-master-parcel':'d18f709cb9a2cba54a85c9d262f2f7e1b34e20d67a18f3b287a03d88d6ef76f7',
 'q-morthal-smith-novice-parcel':'71b4f6416009581f405e7de6f059a2911765f1f807b6287bc637f404ddf6905f',
 'q-morthal-smith-advanced-parcel':'f86f37ec293876d4fbfb1889859cf28e1908b71835df70cc9231afc68cd5b61f',
 'q-morthal-smith-expert-parcel':'419ddedc579950eee90774f768d1b51574f440c2453a2b703f03da5d114355e9',
 'q-morthal-smith-master-parcel':'00d8e6292fbb97467975120876fed4b80579849c1d8ac6c4b2748340c48ae6fd',
 'q-morthal-woodworker-novice-parcel':'1826e4d2d9f8f54abfc7d117dee2a025d9ed97bea817310f72df3509a6e79c41',
 'q-morthal-woodworker-advanced-parcel':'51ce93d15b6ba610a43424b4a32dc4ea099354575112aa27f0893d87327bdc69',
 'q-morthal-woodworker-expert-parcel':'0dc1b3f60331ccec3ef609a166dbaf47ff8196d31ebc49b3d780759272cd0f40',
 'q-morthal-woodworker-master-parcel':'189e472f274ba7a5fc2b9c537c23d1fb1a699c6963d4afdd9c0f28b4465ffa2d',
 'q-morthal-tailor-novice-parcel':'020ac422c90a12d91d074c53ab7f1a0e325ff4a85eb8c77bf9031d8a274c40a5',
 'q-morthal-tailor-advanced-parcel':'c6e0af976053ef88adbec1920db6e3b8cb15ac84e156746dad9932a0ebf42789',
 'q-morthal-tailor-expert-parcel':'8aaa861dbd792e367d851d906f151b2f99f821a26aefade3b77e636097949738',
 'q-morthal-tailor-master-parcel':'cf9c4f718bda5da779e21266d19e2dba3a0c34e66fc3dc43a65054875c0f2852',
 'q-morthal-enchanter-novice-parcel':'24886d3509a1c320fce55b8b45b4e7d30fb68052ae56b5512fa281182b8258c2',
 'q-morthal-enchanter-advanced-parcel':'760e419f89c3578715ff7546a2467a71afef335697504d2b356a9da3bbaed197',
 'q-morthal-enchanter-expert-parcel':'134e901f7a77c9082752569f4bd9624055143774ab9b073ecf828534a0200639',
 'q-morthal-enchanter-master-parcel':'eac915ae01dd6e7774ff92c483c16ad724dac640bbb79ff11ddfda18ee1f5a6e',
 'q-morthal-cook-novice-parcel':'889c1098ce23f5128bf40356d94650060e27ea909d599c4a9b4849aedd1a7764',
 'q-morthal-cook-advanced-parcel':'8a1bfa63a9be5ff7c65ec8ec12e5412e9a3349206b98b007e738a8b129142998',
 'q-morthal-cook-expert-parcel':'e27c070f1cb1eceb650ce1d22cda0225fda286d98c868b9b503d0adfe521744c',
 'q-morthal-cook-master-parcel':'41acabd559d2e2386a52cb90bcfb08767101d6d38ca520e4abfab1bbf81efdcb',
 'q-morthal-alchemist-advanced-parcel':'e4cec0fa1fb02c710391ee52fb5b6a707595c37c2381aebf2a3d591228470840',
 'q-morthal-alchemist-expert-parcel':'f0c57e7eb19b3a3bd872b158585f2f9c3e374351498eb589cc130b451a92bc7a',
 'q-morthal-alchemist-master-parcel':'a2a951da83f6811ca7b50a5a513a79b5dcf131941c14fe7eabb2602ba5b1101c',
 'q-dawnstar-smith-novice-parcel':'7345ba98148e5c941a2fa89f9f4e541c7582824be3757d1f13537662ee75a5f6',
 'q-dawnstar-smith-advanced-parcel':'5a65525543e7182b7e77d90ff3f5977341f11040b908d2bef0c53ac00a553b92',
 'q-dawnstar-smith-expert-parcel':'b0cbd3eb9b479d7aa7ba6048e1cc49f8453c7d5dbccd7bfb21c98a8392088d12',
 'q-dawnstar-smith-master-parcel':'ab644834d136c962ec9783e4cc1d7dcfed25f2033ca102918da25cff860ecaca',
 'q-dawnstar-woodworker-novice-parcel':'85071996fec908c1300c2c471351755da029f369dc35d45c069cc27a3c1d25d8',
 'q-dawnstar-woodworker-advanced-parcel':'85a606247d15cc745a0330e25acc969ca5b7e7fc486171b5e0ba10f58d6dbbbd',
 'q-dawnstar-woodworker-expert-parcel':'dcdc647dd5b1b7cd1f6a2a7911d135320a2e444788665c79f56e7db2493e9900',
 'q-dawnstar-woodworker-master-parcel':'7373b5119b57de4718c9cb4b62cf913ed8b693272127dfb913ce5318650cac8b',
 'q-dawnstar-tailor-novice-parcel':'9b384b54b4f24c87854b4b8c9ae5e24578233a1ef9fc15b432e3ab5d5022a029',
 'q-dawnstar-tailor-advanced-parcel':'e15bfeb0b24485b5884ca8792eb9a5432cc0692b38cb114b02df321c58bd881d',
 'q-dawnstar-tailor-expert-parcel':'bc40f28f23a39c8465ced1c877030df4daa5b0555dc7abb3752bddb10ce6ed89',
 'q-dawnstar-tailor-master-parcel':'4b4ea40b5a6d5ace6112b8e8e46af44d65c20714059f75fd085969d301049e09',
 'q-dawnstar-enchanter-novice-parcel':'af0d27b2e59d18aeb02ce06d4a44fc9eaad702efe4eb5da2689ea5d142e3b1aa',
 'q-dawnstar-enchanter-advanced-parcel':'5d525b5a4c8c2fab1f9144434bddc52325e84104a74c35518083786923410898',
 'q-dawnstar-enchanter-expert-parcel':'c6075730151fb6eadb28e476fcc40be2fa6be568ef659e4dacc01ec79c763a99',
 'q-dawnstar-enchanter-master-parcel':'0f16b90e17e2d31004e4a93a406f29a4bcd7f4331e2c8284386eca19f3f5a03d',
 'q-dawnstar-cook-novice-parcel':'1d0643248109c1e9e66fae653ae8949915f8ca2d1a1ebc3419df88c4b038fef9',
 'q-dawnstar-cook-advanced-parcel':'c0630a94b40b18b6f3bff64c1ffa026a596e06d8592c7db0034f2dae4320b414',
 'q-dawnstar-cook-expert-parcel':'6f77682975f615646a11e3e53e44fb5c0d70ee9044d2a3f0be7f5f2f6f78b7c9',
 'q-dawnstar-cook-master-parcel':'44b5a50455ed1a108049348f11ac507eb1c49c20f4eab6e979413ef3a6edeab7',
 'q-dawnstar-alchemist-novice-parcel':'9c2a4f3bb2d59b3727e7e58c688ef92b643d06ca8f8aec80486977943e1d5db3',
 'q-dawnstar-alchemist-advanced-parcel':'8fea1c65c671810b28782a45186238a69fcc8cb13f97d7afdb98bec5a9da20ff',
 'q-dawnstar-alchemist-expert-parcel':'c16ca4f418c642936bd2edf74fe928a841b9635c870852818beee73d0641df1e',
 'q-dawnstar-alchemist-master-parcel':'2b98c60e1663b678b15054390200f0bae5bb9e3e68bd8ac112bc1d1731905bcf',
 'q-winterhold-smith-novice-parcel':'68c46dc312e61a9359c230ffec9d24bd9543eae91f6f436f893f8148c0b6aa68',
 'q-winterhold-smith-advanced-parcel':'4599fb76f4644416b87817cf0bf6518699b0b46f55149a76769f2b6757d66864',
 'q-winterhold-smith-expert-parcel':'75c5bceb51d5f24af727c4ee968774097754b7cc0f64f10cb415d58330cd7e60',
 'q-winterhold-smith-master-parcel':'59f73bf6d038034fa2c9ac65b1b85a6582c9502c77e512349ef309125969f02d',
 'q-winterhold-woodworker-novice-parcel':'c77c432bc1a72f7da71368a839140359f67880dcc6d2dd928ceee18091aa6339',
 'q-winterhold-woodworker-advanced-parcel':'7362c2e1c85870d505ba5fad8413d5673fb99cb993b33f4bc09d6a82239f4840',
 'q-winterhold-woodworker-expert-parcel':'2b15efd43ad1a57ffa9519a592e41ee56062e220441bf7cdfd340bd1c359335b',
 'q-winterhold-woodworker-master-parcel':'22941c4af6bd41eb6aa96c9f29085ea2605fdd89157f091d562305d1e9e5c184',
 'q-winterhold-tailor-novice-parcel':'4ddea61b68bc9451d942295376ebd20082dc472aa12f5e046cc9960548bf58c8',
 'q-winterhold-tailor-advanced-parcel':'1e25774626e32469e0dae4cf4e949f279d1d6e9f1839ac48a4753a7d7f5fb5e7',
 'q-winterhold-tailor-expert-parcel':'8322953574b8161b13669df1e8f973f9009418f806681e9ecf4ea8b3b8aa0518',
 'q-winterhold-tailor-master-parcel':'c9c8d241fa93e31f3309e390234b02b1669aa5d8a909b21d1957da8fe9f0561b',
 'q-winterhold-enchanter-advanced-parcel':'27f62e866cbfba6be168028131e12b1e7617a36c0836f432544f7a33669ca67f',
 'q-winterhold-enchanter-expert-parcel':'e4a9ed1da463bccc801cac3fa6e15c72b494cb73246aade83a1d280388a3fad2',
 'q-winterhold-enchanter-master-parcel':'0cfba95b4a3024c53110c8c83c3c17a75e7f7d792a6d3a3b39078bc61852e147',
 'q-winterhold-cook-novice-parcel':'277548087151d77d846a585ced8bda3eb84805709af9f2698bd95eaed391a97d',
 'q-winterhold-cook-advanced-parcel':'3aa9880e1f254978a6a2272c66d559a2a69af9247e40fec979d7a6c75b1fb32c',
 'q-winterhold-cook-expert-parcel':'87747364053cb2011be77572dd9c73e613207616a0dec5e61194662aea51ac50',
 'q-winterhold-cook-master-parcel':'779e68af65ae32402a3b4ca0ee8f7e1da7b950d6c1fcc7a516699bd9f718d160',
 'q-winterhold-alchemist-novice-parcel':'8681041354c2bde2e6488629a0b6f771e62da15c91a14cf5a8bf6479832a5456',
 'q-winterhold-alchemist-advanced-parcel':'f51cb1451347adb50bfb81750a95456911a7b3d9973ccacfe1a096f893c868f6',
 'q-winterhold-alchemist-expert-parcel':'0488787bf8ba5adf803a5bbeeac07b71c9413f53e9bebea1334a6b995f1dc80c',
 'q-winterhold-alchemist-master-parcel':'e3fcaff2016fd92fa134179552961c37d237cea450605e44d23dd0db9aeec8c1',
 'q-falkreath-smith-novice-parcel':'ca3c2279d29109699533cdb8fefd39f5f40bfbed975dc3db521a672f0a29ef1b',
 'q-falkreath-smith-advanced-parcel':'c5599272d5fdb9dae5f99345c1c3b2d585f2a5de491e3575263b8ef6bcf5e2fe',
 'q-falkreath-smith-expert-parcel':'bef06ccb520179bd8d2acbaa59cb1ec4e7a4a67f11b33ea5f1079809a32e44e0',
 'q-falkreath-smith-master-parcel':'ab6b81c32740d170ad918b21ed37e61ba9dc4cb8cfda3050c57b5cc3edaeb43a',
 'q-falkreath-woodworker-novice-parcel':'5cd6da18590fac2fad633549b90985c52c2573065446c73c4f19bf90f52cb2ba',
 'q-falkreath-woodworker-advanced-parcel':'e0ce2e8cbf0e43d3a20fd1760c553a808a49bf1e75503427716359789d486d06',
 'q-falkreath-woodworker-expert-parcel':'3efc744007fd932a54dc6a4e09eac53cff8bb2d7ac7409d996be396805a663c8',
 'q-falkreath-woodworker-master-parcel':'c06d0c4cd4240fc4ff615eadec7080561b73e54761e5c71815fcf4c4782fce54',
 'q-falkreath-tailor-advanced-parcel':'4edd3818a0dc0aa5489de0df8aa8389fde26a98439319ceae129c760a2801116',
 'q-falkreath-tailor-expert-parcel':'a0615ea295953a744db2fa781af3b49e0c13226130cbdc815d5a55d52f036f47',
 'q-falkreath-tailor-master-parcel':'0e7a83f0b4cf3592bd68c6bc6cbc27b440b0a1f67ffd1a644b5ea7566bf40393',
 'q-falkreath-enchanter-novice-parcel':'6b4ab04f1b88aae537a34663138fdce78b0f78b77cb993103ba35d4b3a0a8570',
 'q-falkreath-enchanter-advanced-parcel':'9085844625e5af0a5a28f75d725e1d3248eb1c60154e371916c1916843501638',
 'q-falkreath-enchanter-expert-parcel':'5c67b8147d7781b830f790d9337779601e041b51d1912a5c76363a8a5c9fa3d2',
 'q-falkreath-enchanter-master-parcel':'2ddcc4b856c3ff5a37bd34b271789436547be0ba9454edcfab030dab5c37cc90',
 'q-falkreath-cook-novice-parcel':'d2d1aea6a672e08a00f83297378c9e640c58031743ef37857e6fc9da16da6a1b',
 'q-falkreath-cook-advanced-parcel':'84f7e09da0dbcc9e8f028c42bc994e7e1ff595cc3f1393f891cd80cb05a50ac0',
 'q-falkreath-cook-expert-parcel':'1233ab8d8e973049bb6579420ea00b3ec8c45817a060c2d122229ac7a4603e73',
 'q-falkreath-cook-master-parcel':'d0b2bf90773d1ded857b4b62df38463643dd7625131cf4cd109ec2f985160da8',
 'q-falkreath-alchemist-novice-parcel':'3362a1a626e9d923a1df34052aebee69b4631a9ba0f1c8315e1f7f8ffc7c6ea9',
 'q-falkreath-alchemist-advanced-parcel':'03a169491e5bb331843cc9838e8cf49c8f75b9bf81e3a9e9f33ba2d7f77e95e1',
 'q-falkreath-alchemist-expert-parcel':'8e97eca85396e324c2e9ce677cfd43060bc2ed00dc54114116aef13390c0ca08',
 'q-falkreath-alchemist-master-parcel':'dd6462bcececf28c771975e0067523f074bb38f9a5a4cd88532558fb7c5bb3e2',
 'q-ravenrock-smith-novice-parcel':'3cbca79c5f5e6650ad2d9b36ca4dd297bc459015aa5e9c534e955e104021a0ea',
 'q-ravenrock-smith-advanced-parcel':'5af2fa92555f278a4effd6072ed45fadefd1aeb8637525371ff07bb84cd0c66f',
 'q-ravenrock-smith-expert-parcel':'cc61db7e68c6da387bb44cc9bd3500f704315c55eda489f965c90e52a82e704c',
 'q-ravenrock-smith-master-parcel':'adae6050ba1670bb4aaa69ab79a771a505a774a76af77080d05ab98e5b16e0fb',
 'q-ravenrock-woodworker-novice-parcel':'cf1869fb57473e2139b9cc240c0f96083013c0c9d64fa08b0e3af24416141bf8',
 'q-ravenrock-woodworker-advanced-parcel':'90b0b77a702946246027fd48ee0cced62d2f0a8fa171258d1357bdf528760ab1',
 'q-ravenrock-woodworker-expert-parcel':'65d7ba9ae2bb492cfc4a989f3276a4e6f4990ff13b6130ec70b8bf9b12840a15',
 'q-ravenrock-woodworker-master-parcel':'fd63ff331800aae2c4257a1bc0b88b443fcd617b9c9783b6139ea8789c0a19a1',
 'q-ravenrock-tailor-novice-parcel':'5e80ddcd6736ee38ee9eaaabd392645ca7564d0bae66df87658ea87ae1c896d4',
 'q-ravenrock-tailor-advanced-parcel':'40fddf34d93a2c21fd8f9afe00caafba8b6a7b0a4b95a1dad551d9c659495e7b',
 'q-ravenrock-tailor-expert-parcel':'6137111ca25e9c03e324b5d13e33047fee1756c9b68e46f9f29fadde1840008e',
 'q-ravenrock-tailor-master-parcel':'bb5af439f5dc13640c4ecfa4d1c4b29d8e65fb782b01179a0e4891dd541195d1',
 'q-ravenrock-enchanter-novice-parcel':'dd9e05072befea7c2fa9401f522fef644712cfed83f8682aed7e971642463b31',
 'q-ravenrock-enchanter-advanced-parcel':'da1376c750a3b34723cb333f6879a553fb13e709d1921ee12d312508c79e8815',
 'q-ravenrock-enchanter-expert-parcel':'82bbb3f667b0fddfedb0bb3ce4d88338ee2cdc43a4f7bc0760b83cfc4208042f',
 'q-ravenrock-enchanter-master-parcel':'0879f08ed07175f14f519cdfce0b65240c1d5fd8b8c5c1a6ca119f82a54ba3a2',
 'q-ravenrock-cook-novice-parcel':'48bc5bb6b6ca2351b485565bdb1ebbb99a2a85399d98fbe591d5bf4d15d44032',
 'q-ravenrock-cook-advanced-parcel':'567d2e351485ac5f9e3e1e9fe85e845c8e012b2ffaec0684f65bc191480bb5d4',
 'q-ravenrock-cook-expert-parcel':'a43435d6530340ba7d9fff848514f23d1423047fc20faff6ddd2152c16add63b',
 'q-ravenrock-cook-master-parcel':'3562e7b189f3dee63ac2bf957a356b680b725ba67b93d9642c96306b6fb931cf',
 'q-ravenrock-alchemist-novice-parcel':'cbfe3d78eea5c536deea9fc63c1afbfd2ca1fcd34b3f87ab437386e08daa46b0',
 'q-ravenrock-alchemist-advanced-parcel':'28f1ff6e39d2f59f45a21c1025b6d8d847829b57c14f684e78ef0bcc8f319cb2',
 'q-ravenrock-alchemist-expert-parcel':'bcea0c2a92a1ac8b1c53a859b5ef9d511fca9c799c8d934a129a84df30f0ed58',
 'q-ravenrock-alchemist-master-parcel':'66951c0e24ab8e00f349e96fc336766d2a33797bacc40831961188017d611490'
});
function prepareCommissions(author,catalog,native) {
 if(!Array.isArray(author)||author.length!==Object.keys(publication).length)throw Error('Invalid published commission catalogue.');
 author=copy(author);catalog=copy(catalog);
 if(new Set(author.map(row=>row&&row.id)).size!==author.length||author.some(row=>{
   if(!row||publication[row.id]!==row.sourceHash)return true;
   const {sourceHash,itemType,itemTypes,...definition}=row;return hash(definition)!==sourceHash;
  }))
  throw Error('Published commission definitions must remain available.');
 const ids=new Set();
 return author.map(source=>{
  const row=copy(source),merchant=row.merchant,place=merchant&&catalog.byRef[merchant.reference];
  const bundle=row.deliveryVersion===2;
  if(row.kind!=='commission'||!['novice','advanced','expert','master'].includes(row.tier)||
    row.cooldownHours!==[6,12,24,48][['novice','advanced','expert','master'].indexOf(row.tier)]||ids.has(row.id)||
    !place||place.role!==merchant.role||place.hold!==merchant.hold||place.bookHold!==merchant.bookHold||
    !Array.isArray(row.goods)||row.goods.length<(bundle?2:1)||row.goods.length>(bundle?5:1)||!row.reward||row.reward.source!=='merchant-purse'||
    row.reward.pricing!=='submitted-hold-price')throw Error('Commission source or appointed merchant cannot be verified.');
  ids.add(row.id);
  const good=row.goods[0];
  return {id:row.id,name:row.name,text:row.text,tier:row.tier,gate:row.gate,
   who:[row.gate.classKey||row.gate.profession,row.gate.half||row.gate.school,row.gate.rank].filter(Boolean).join(', '),
   merchantId:native.resolveMerchant(merchant.reference,merchant.base),merchantRef:merchant.reference,
   role:merchant.role,hold:merchant.hold,bookHold:merchant.bookHold,
   ...(bundle?{deliveryVersion:2,hours:row.cooldownHours,goods:row.goods.map(part=>({
     itemId:native.resolveItem(part.item,row.itemTypes[part.item]),itemDesc:part.item,count:part.count}))}:
     {itemId:native.resolveItem(good.item,row.itemType),itemDesc:good.item,count:good.count}),sourceHash:row.sourceHash};
 });
}
function createCommissions(deps) {
 const rows=new Map(),now=deps.now||Date.now,purses=deps.purses,transfer=deps.transfer;
 for(const source of deps.rows||[]) {
  const row=copy(source);
  const goods=row.deliveryVersion===2?row.goods:[row];
  if(!/^q-[a-z0-9-]{1,46}$/.test(row.id)||rows.has(row.id)||!Number.isInteger(row.merchantId)||row.merchantId<=0||
    !Array.isArray(goods)||goods.length<1||goods.length>5||new Set(goods.map(good=>good.itemId)).size!==goods.length||
    goods.some(good=>!Number.isInteger(good.itemId)||good.itemId<=0||good.itemId===15||
      !Number.isSafeInteger(good.count)||good.count<1||good.count>100000)||
    row.deliveryVersion===2&&![6,12,24,48].includes(row.hours)||
    typeof row.sourceHash!=='string'||!/^[0-9a-f]{64}$/.test(row.sourceHash)||typeof row.role!=='string'||!row.role)
   throw Error('Published commission authority cannot be verified.');
  rows.set(row.id,row);
 }
 function namespace() {
  if(purses.callerGuard!==true||typeof purses.ledgerStates!=='function'||typeof purses.stats!=='function')
   throw Error('Commission ledger admission is unavailable.');
  const stats=purses.stats(),all=purses.ledgerStates(),size=stats.catalogue+(stats.retired||0);
  if(!Array.isArray(all)||!Number.isInteger(size)||size<1||size>249||all.length!==size||
    new Set(all.map(row=>row.reference)).size!==size)throw Error('The complete commission ledger cannot be verified.');
  return all.filter(row=>row.state!==null).map(row=>{STATE.spendable(row.state);return row.state;});
 }
 function quoteGood(row,good) {
  const catalog=deps.prices.catalog(row.bookHold)||[],matches=[];
  for(const item of catalog) {
   const resolved=deps.resolve(item.name);
   if(resolved&&!resolved.error&&resolved.baseId===good.itemId) {
    const price=deps.prices.quote(row.bookHold,item.name);
    if(price&&Number.isSafeInteger(price.buy)&&price.buy>=0&&price.buy<=2147483647&&
      Number.isSafeInteger(price.buy*good.count)&&price.buy*good.count<=2147483647)
     matches.push({unit:price.buy,name:resolved.name||item.name});
   }
  }
  // Ambiguous names or two aliases are never a guess at an accepted promise.
  return matches.length===1?matches[0]:null;
 }
 function quoted(row) {
  const parts=row.deliveryVersion===2?row.goods:[row],goods=[];
  for(const part of parts) {
   const quote=quoteGood(row,part);if(!quote)return null;
   goods.push({item:{baseId:part.itemId,name:quote.name},count:part.count,unit:quote.unit});
  }
  const gold=goods.reduce((sum,good)=>sum+good.count*good.unit,0);
  if(!Number.isSafeInteger(gold)||gold>2147483647)return null;
  return {goods,gold,argument:row.deliveryVersion===2?hash([row.sourceHash,goods]):String(goods[0].unit)};
 }
 function promised(row,held) {
  const goods=held.goods||[{item:held.item,count:held.count,unit:held.unit}];
  const parts=row.deliveryVersion===2?row.goods:[row];
  return held.hash===row.sourceHash&&goods.length===parts.length&&goods.every((part,i)=>
   part.item.baseId===parts[i].itemId&&part.count===parts[i].count)&&
   (row.deliveryVersion===2?held.hours===row.hours:held.goods===undefined);
 }
 function eligible(actor,row) {return typeof deps.eligible==='function'&&deps.eligible(actor,row.gate)===true;}
 function context(actor,merchant,row) {
  if(!row||row.merchantId!==merchant)return null;
  const state=purses.read(merchant),human=transfer.identity(actor);
  if(!state||state.reference!==row.merchantRef||!STATE.owner(human))return null;
  STATE.spendable(state);
  return {state,human,key:STATE.key(human,row.id),jobs:STATE.read(state.commissions)};
 }
 function view(actor,merchant) {
  const result=[];
  for(const row of rows.values()) {
   const ctx=context(actor,merchant,row);if(!ctx)continue;
   const {state,human,key,jobs}=ctx,held=jobs.held[key],last=jobs.cool[key],at=now();
   const pending=state.pending&&state.pending.kind==='commission'&&state.pending.human&&
     STATE.owner(state.pending.human)===STATE.owner(human)&&state.pending.previous.commissions&&
     state.pending.previous.commissions.held[key];
   const original=held||pending,quote=original?{goods:original.goods||[{item:original.item,count:original.count,unit:original.unit}],gold:original.gold}:quoted(row);
   const gate=original?true:eligible(actor,row),waiting=!!state.pending;
   const cooldown=last&&at-STATE.cooldownAt(last)<STATE.cooldownWait(last);
   const inventory=original?INVENTORY.inventory(transfer.inventory(actor)):null;
   const enough=!!original&&quote.goods.every(good=>inventory.entries.filter(item=>item.baseId===good.item.baseId)
     .reduce((sum,item)=>sum+item.count,0)>=good.count);
   const open=!!original,openLimit=STATE.openCount(namespace(),human)>=3;
   const activeCool=Object.keys(jobs.cool).filter(key=>at-STATE.cooldownAt(jobs.cool[key])<STATE.cooldownWait(jobs.cool[key])).length;
   const room=jobs.serial<Number.MAX_SAFE_INTEGER&&Object.keys(jobs.held).length<STATE.MAX_HELD&&
     Object.keys(jobs.held).length+activeCool<STATE.MAX_COOL;
   const funds=quote&&STATE.spendable(state)>=quote.gold;
   const ready=deps.settlement.available()&&deps.settlement.canInventoryMutation(actor);
   const reason=waiting?'This trader is finishing a saved transfer.':!ready?'Trading is waiting for a saved inventory.':
     !gate?'You do not meet this work\'s requirements.':cooldown?'This work is still resting.':!quote?'No submitted buy price is available for this work.':
     !open&&openLimit?'You already hold three commissions.':!open&&!room?'This trader cannot accept more work yet.':
     !open&&!funds?'The trader cannot reserve this payment.':'';
   result.push({id:row.id,name:row.tier[0].toUpperCase()+row.tier.slice(1)+': '+row.name,kind:'commission',
    who:row.who,check:row.text+' '+reason,locations:row.hold+'; return to this '+row.role+'.',exactMerchant:true,
    state:open?'open':cooldown?'cooldown':!gate?'locked':reason?'unavailable':'available',
    hours:original&&original.hours||row.hours||6,count:row.count,item:quote?quote.goods[0].item.name:row.itemName||'the requested goods',gold:quote?quote.gold:null,
    goods:row.deliveryVersion===2?(row.goods.map((part,i)=>({count:part.count,name:quote?quote.goods[i].item.name:part.itemDesc}))):undefined,
    quoteToken:row.deliveryVersion===2&&quote&&!original?quote.argument:null,
    quotedUnit:row.deliveryVersion!==2&&quote?quote.goods[0].unit:null,token:original?original.token:null,waiting:waiting,
    waitMinutes:cooldown?Math.ceil((STATE.cooldownWait(last)-at+STATE.cooldownAt(last))/60000):0,
    canTake:!open&&!reason,canReturn:open&&!waiting&&ready&&enough,canAbandon:open&&!waiting&&ready});
  }
  return result;
 }
 function act(actor,merchant,verb,id,argument,guards) {
  const row=rows.get(id),ctx=context(actor,merchant,row);
  if(!ctx||!guards||typeof guards.current!=='function'||typeof guards.alive!=='function')return {ok:false,why:'session'};
  const {state,human,key,jobs}=ctx;
  if(state.pending||!deps.settlement.available()||!deps.settlement.canInventoryMutation(actor))return {ok:false,why:'waiting'};
  if(typeof argument!=='string')return {ok:false,why:'session'};
  const number=/^@(0|[1-9][0-9]*)$/.test(argument)?Number(argument.slice(1)):NaN;
  if(!(verb==='take'&&row.deliveryVersion===2? /^@[0-9a-f]{64}$/.test(argument):Number.isSafeInteger(number)))return {ok:false,why:'session'};
  function current(fresh,quote) {
   if(!guards.current()||STATE.owner(transfer.identity(actor))!==STATE.owner(human))return false;
   if(fresh) {
    const again=quoted(row);
    if(!again||again.argument!==quote.argument||!eligible(actor,row))return false;
   }
   const count=STATE.openCount(namespace(),human);
   return (!fresh||count<3)&&guards.current()&&guards.alive();
  }
  if(verb==='take') {
   if(!eligible(actor,row))return {ok:false,why:'eligibility'};
   const quote=quoted(row);if(!quote||'@'+quote.argument!==argument)return {ok:false,why:'price'};
   if(STATE.openCount(namespace(),human)>=3)return {ok:false,why:'open-limit'};
   const terms=row.deliveryVersion===2?{hash:row.sourceHash,goods:quote.goods,hours:row.hours}:
     {hash:row.sourceHash,...quote.goods[0]},at=now();
   const accepted=STATE.reserve(jobs,human,id,terms,at,state.purse);
   if(!accepted.ok)return accepted;
   const next=Object.assign({},state,{commissions:accepted.next});
   const saved=deps.settlement.changeCommissions(merchant,state,next,human,()=>current(true,quote),{kind:'reserve',job:id,terms,at});
   return {ok:!!saved,why:saved?'':'session'};
  }
  const held=jobs.held[key];
  if(!held||held.token!==number)return {ok:false,why:'session'};
  if(verb==='abandon') {
   const at=now(),released=STATE.cancel(jobs,human,id,number,at);if(!released.ok)return released;
   const saved=deps.settlement.changeCommissions(merchant,state,Object.assign({},state,{commissions:released.next}),human,()=>current(false),
     {kind:'cancel',job:id,token:number,at});
   return {ok:!!saved,why:saved?'':'session'};
  }
  if(verb!=='return')return {ok:false,why:'request'};
  if(!promised(row,held))return {ok:false,why:'recovery'};
  const completed=STATE.finish(jobs,human,id,number,now());if(!completed.ok)return completed;
  const expected=INVENTORY.inventory(transfer.inventory(actor));
  let debit=expected,stock=copy(state.stock);
  try {
   for(const good of held.goods||[{item:held.item,count:held.count,unit:held.unit}]) {
    const outgoing=INVENTORY.takeEntries(debit,good.item.baseId,good.count);
    debit=outgoing.inventory;stock=deps.addStock(stock,outgoing.entries,good.item.name);
   }
  }catch(error){return {ok:false,why:'short'};}
  const next={purse:state.purse-held.gold,stock,supply:copy(state.supply||{}),commissions:completed.next};
  const moved=deps.settlement.begin({merchantId:merchant,humanId:actor,profileId:human.profileId,kind:'commission',
   previous:state,next,expected,debit,credit:held.gold?[{baseId:15,count:held.gold}]:[],caller:()=>current(false)});
  return {ok:!!moved.done,why:moved.done?'':'waiting'};
 }
 return {has:id=>rows.has(id),view,act};
}
module.exports={createCommissions,prepareCommissions,publication};
return module.exports;})();
const QUEST_TRANSACTIONS = (function () { const module = {exports:{}};
'use strict';
var inventoryTools=typeof MERCHANT_SETTLEMENT!=='undefined'?MERCHANT_SETTLEMENT:require('./merchant-settlement');
function same(a,b) {
  if(a===b)return true;
  if(!a || !b || typeof a!=='object' || typeof b!=='object' || Array.isArray(a)!==Array.isArray(b))return false;
  var left=Object.keys(a).sort(),right=Object.keys(b).sort();
  return left.length===right.length && left.every(function(key,i){return key===right[i] && same(a[key],b[key]);});
}
function nativeRevision(value) {
  return typeof value==='string' && value.length>0 && value.length<=20 && value[0]!=='0' &&
    !/[^0-9]/.test(value) && (value.length<20 || value<='18446744073709551615');
}
function targetIdentity(mp,actor) {
  try {
    var ai=mp.getNpcAIState(actor),desc=mp.getDescFromId(actor);
    if(!ai || !Number.isInteger(ai.profileId) || !Number.isSafeInteger(ai.lifeGeneration) ||
        ai.lifeGeneration<0 || typeof desc!=='string' || !desc || !nativeRevision(ai.runtimeLifeIdentity))return null;
    return JSON.stringify({desc:desc,profileId:ai.profileId,life:ai.lifeGeneration,body:ai.runtimeLifeIdentity});
  } catch(error) { return null; }
}
function actorIdentity(mp,actor) {
  try {
    var ai=mp.getNpcAIState(actor),desc=mp.getDescFromId(actor),runtime=mp.getActorRuntimeIdentity(actor);
    if(!ai || ai.isHuman!==true || !Number.isInteger(ai.profileId) || ai.profileId<=0 ||
        !Number.isSafeInteger(ai.lifeGeneration) || ai.lifeGeneration<0 || typeof desc!=='string' || !desc ||
        !nativeRevision(runtime))return null;
    return JSON.stringify({desc:desc,profileId:ai.profileId,life:ai.lifeGeneration,runtime:runtime});
  } catch(error) { return null; }
}
function createQuestTransactions(deps) {
  var mp=deps.mp,active=true,property='thornswoodQuests';
  var log=deps.log || function(){};
  function report(message,error) {try{log(message+String(error));}catch(ignored){}}
  function available() {
    return active && typeof deps.withInventoryMutation==='function' && !!mp &&
      ['compareAndSetActorProperty','compareAndSetInventoryAndProperty','getInventoryReceipt','getSavedInventoryReceipt',
        'get','getIdFromDesc','getDescFromId','getNpcAIState','getActorRuntimeIdentity'].every(function(key){return typeof mp[key]==='function';});
  }
  function identity(actor) {
    return active ? actorIdentity(mp,actor) : null;
  }
  function commit(actor,expectedRecord,nextRecord,changes,admission) {
    if(!available())return {ok:false,why:'unavailable'};
    try {
      var token=identity(actor);
      if(!token)return {ok:false,why:'identity'};
      // Match the addon's JSON boundary, including omitted optional fields.
      nextRecord=JSON.parse(JSON.stringify(nextRecord));
      if(!Array.isArray(changes))throw new Error('Invalid quest goods.');
      if(changes.length===0) {
        var metadataOwner=JSON.parse(token);
        if(!available() || identity(actor)!==token)return {ok:false,why:'identity'};
        if(admission!==undefined && (typeof admission!=='function' || admission()!==true))return {ok:false,why:'session'};
        try {
          var committed=mp.compareAndSetActorProperty(actor,metadataOwner.profileId,
            {name:property,expected:expectedRecord===undefined?null:expectedRecord,replacement:nextRecord,
              expectedLifeGeneration:metadataOwner.life,expectedRuntimeIdentity:metadataOwner.runtime});
          return {ok:committed===true,why:committed===true?'':'changed'};
        } catch(error) {
          // An unchanged inventory receipt says nothing about a metadata save.
          // Only a verified unchanged property establishes a refused operation.
          try {
            var record=mp.get(actor,property);
            if(identity(actor)===token && same(record==null?null:record,expectedRecord==null?null:expectedRecord)) {
              report('quest metadata refused: ',error);
              return {ok:false,why:'unwritten'};
            }
          } catch(readError) { /* Unreadable outcomes revoke the service below. */ }
          active=false;
          report('quest metadata outcome is unknown; service revoked: ',error);
          return {ok:false,why:'unavailable',uncertain:true};
        }
      }
      return deps.withInventoryMutation(actor,function(human,stillActive){
        if(!available() || !stillActive())return {ok:false,why:'unavailable'};
        if(identity(actor)!==token)return {ok:false,why:'identity'};
        var owner=JSON.parse(token);
        if(owner.desc!==human.desc || owner.profileId!==human.profileId)return {ok:false,why:'identity'};
        var receipt=mp.getInventoryReceipt(actor);
        if(mp.getSavedInventoryReceipt(actor)!==receipt)return {ok:false,why:'waiting'};
        var oldReceipt=JSON.parse(receipt),sequence=1;
        if(oldReceipt!==null) {
          if(!oldReceipt || Object.keys(oldReceipt).length!==3 || oldReceipt.actor!==human.desc ||
              oldReceipt.profile!==human.profileId || !Number.isSafeInteger(oldReceipt.sequence) || oldReceipt.sequence<1)
            throw new Error('Quest inventory receipt cannot be verified.');
          sequence=oldReceipt.sequence+1;
        }
        if(!Number.isSafeInteger(sequence))throw new Error('Quest inventory receipt sequence is exhausted.');
        var before=inventoryTools.inventory(mp.get(actor,'inventory')),next=before;
        changes.forEach(function(change){
          if(!Number.isSafeInteger(change.count) || change.count===0)throw new Error('Invalid quest goods.');
          var baseId=mp.getIdFromDesc(change.item);
          if(!Number.isInteger(baseId) || baseId<=0 || baseId>0xffffffff)throw new Error('Quest goods are unavailable.');
          next=change.count<0?inventoryTools.takeEntries(next,baseId,-change.count).inventory:
            inventoryTools.addEntries(next,[{baseId:baseId,count:change.count}]);
        });
        var nextReceipt=JSON.stringify({actor:human.desc,profile:human.profileId,sequence:sequence});
        if(!stillActive() || !available() || identity(actor)!==token)return {ok:false,why:'identity'};
        if(admission!==undefined && (typeof admission!=='function' || admission()!==true))return {ok:false,why:'session'};
        try {
          var changed=mp.compareAndSetInventoryAndProperty(actor,before,receipt,next,sequence,human.profileId,
            {name:property,expected:expectedRecord===undefined?null:expectedRecord,replacement:nextRecord,
              expectedLifeGeneration:owner.life,expectedRuntimeIdentity:owner.runtime});
          return {ok:changed===true,why:changed===true?'':'changed'};
        } catch(error) {
          // Publication can fail after the atomic live edit. Read back that
          // identity and receipt; never compensate, replay, or infer a save.
          try {
            if(identity(actor)===token) {
              var live=mp.getInventoryReceipt(actor),record=mp.get(actor,property);
              if(live===nextReceipt && same(record,nextRecord))return {ok:true};
              if(live===receipt && same(record==null?null:record,expectedRecord==null?null:expectedRecord)) {
                report('quest transaction refused: ',error);
                return {ok:false,why:'unwritten'};
              }
            }
          } catch(readError) { /* An unreadable outcome is revoked below before diagnostics. */ }
          active=false;
          report('quest transaction outcome is unknown; service revoked: ',error);
          return {ok:false,why:'unavailable',uncertain:true};
        }
      });
    } catch(error) {
      report('quest transaction unavailable: ',error);
      return {ok:false,why:'unwritten'};
    }
  }
  return {commit:commit,identity:identity,available:available,shutdown:function(){active=false;}};
}
module.exports={createQuestTransactions:createQuestTransactions,actorIdentity:actorIdentity,targetIdentity:targetIdentity};
return module.exports;})();
const QUEST_ELIGIBILITY = (function () { const module = {exports:{}};
'use strict';
// Pure eligibility for the expanded catalogue. The caller owns session fences
// and reads saved state without entering character initialization or migration.
function record(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function field(value, key) {
  if (!record(value)) return undefined;
  var desc = Object.getOwnPropertyDescriptor(value, key);
  return desc && desc.enumerable && Object.prototype.hasOwnProperty.call(desc, 'value') ? desc.value : undefined;
}
function strings(value) {
  if (!Array.isArray(value)) return null;
  var out = [];
  for (var i = 0; i < value.length; i++) {
    var desc = Object.getOwnPropertyDescriptor(value, i);
    if (!desc || !desc.enumerable || !Object.prototype.hasOwnProperty.call(desc, 'value') ||
        typeof desc.value !== 'string') return null;
    out.push(desc.value);
  }
  return out;
}
function createQuestEligibility(source) {
  var table, spellIds;
  try {
    table = JSON.parse(JSON.stringify(source.table));
    spellIds = JSON.parse(JSON.stringify(source.spellIds));
    if (!record(table) || !Array.isArray(table.ranks) ||
        table.ranks.join(',') !== 'novice,advanced,expert,master' ||
        !record(table.classes) || !record(table.professions) ||
        !Array.isArray(table.schools) || !record(table.spells) || !record(spellIds)) throw Error('metadata');
  } catch (error) { throw new Error('Invalid quest eligibility metadata.'); }
  var ranks = table.ranks;
  function validate(gate) {
    function invalid() { throw new Error('Invalid quest gate.'); }
    if (!record(gate)) return invalid();
    var prototype = Object.getPrototypeOf(gate);
    if (prototype !== null && prototype !== Object.prototype) return invalid();
    var keys = Reflect.ownKeys(gate), out = Object.create(null);
    keys.forEach(function (key) {
      if (['open', 'classKey', 'profession', 'rank', 'half', 'school'].indexOf(key) < 0 ||
          (key === 'open' ? field(gate, key) !== true : typeof field(gate, key) !== 'string')) invalid();
      out[key] = field(gate, key);
    });
    if (keys.length === 1 && out.open === true) return Object.freeze(out);
    if (field(out, 'open') !== undefined || ranks.indexOf(out.rank) < 0) return invalid();
    if (field(out, 'classKey') !== undefined) {
      if (keys.length !== 2 || !field(table.classes, out.classKey)) return invalid();
    } else {
      var profession = field(table.professions, out.profession);
      if (!record(profession)) return invalid();
      if (out.profession === 'mage') {
        if (field(out, 'half') !== undefined || keys.length !== (field(out, 'school') === undefined ? 2 : 3) ||
            field(out, 'school') !== undefined && table.schools.indexOf(out.school) < 0 ||
            out.rank === 'master' && field(out, 'school') === undefined) return invalid();
      } else if (field(out, 'school') !== undefined ||
          keys.length !== (field(out, 'half') === undefined ? 2 : 3) ||
          !record(profession.halves) || field(out, 'half') !== undefined && !field(profession.halves, out.half) ||
          out.rank === 'master' && field(out, 'half') === undefined) return invalid();
    }
    return Object.freeze(out);
  }
  function allows(gate, state) {
    try {
      gate = validate(gate);
      if (gate.open === true) return true;
      var standing = field(state, 'ranks');
      if (field(state, 'v') !== 1 || !record(standing)) return false;
      function hasRank(key) {
        var index = ranks.indexOf(field(standing, key));
        return index >= 0 && index >= ranks.indexOf(gate.rank);
      }
      if (field(gate, 'classKey') !== undefined) {
        return field(state, 'cls') === gate.classKey && hasRank(gate.classKey);
      }
      if (field(state, 'prof') !== gate.profession) return false;
      if (gate.profession !== 'mage') {
        var halves = Object.keys(table.professions[gate.profession].halves);
        return field(gate, 'half') !== undefined ? hasRank(gate.half) : halves.some(hasRank);
      }
      var schools = strings(field(state, 'schools'));
      if (!schools || schools.some(function (s) {return table.schools.indexOf(s) < 0;})) return false;
      var selected = field(gate, 'school') !== undefined ? [gate.school] : schools;
      return selected.some(function (school) {
        if (schools.indexOf(school) < 0 || !hasRank(school)) return false;
        if (gate.rank !== 'master') return true;
        var known = strings(field(field(state, 'spells'), 'known'));
        var master = field(field(table.spells, school), 'master');
        return !!known && Array.isArray(master) && known.some(function (name) {
          var desc = field(spellIds, name);
          return typeof name === 'string' && master.indexOf(name) >= 0 && typeof desc === 'string' &&
            /^[0-9a-f]{1,6}:[^:\r\n]+\.(?:esm|esp|esl)$/i.test(desc);
        });
      });
    } catch (error) { return false; }
  }
  return Object.freeze({validate: validate, allows: allows});
}
module.exports = {createQuestEligibility: createQuestEligibility};
return module.exports;})();
const KILL_CONTRACTS = (function () { const module = {exports:{}};
'use strict';
var identityTools=typeof QUEST_TRANSACTIONS!=='undefined'?QUEST_TRANSACTIONS:require('./quest-transactions');
var SPEC=[
  {id:'wolf',hold:'Whiterun',place:'White River Watch',count:1,world:'151f9',refs:{'86a88':'e1672'}},
  {id:'sabre',hold:'Eastmarch',place:'Lost Knife Hideout',count:1,world:'1a337',refs:{'1ce7b':'59397'}},
  {id:'camp',hold:'Whiterun',place:'Halted Stream Camp',count:3,world:'3c',bounds:[14000,18000,16000,22000],
    refs:{'50533':'b623b','50549':'b6fcd','5054a':'1e79f','5054e':'b623b'}},
  {id:'bear',hold:'the Rift',place:'Pinepeak Cavern',count:1,world:'15230',refs:{'19f3e':'1e7a4'}},
  {id:'barrow',hold:'Falkreath',place:'Bleak Falls Temple',count:1,world:'371de',
    refs:{'1d219':'1e7ad','380b3':'4a59a','380b5':'567c8','380b7':'bf7b3','380b8':'a6850'}},
  {id:'giant',hold:'Whiterun',place:'Bleakwind Basin',count:1,world:'3c',bounds:[-500,2500,-1000,3000],
    refs:{'33f9f':'3053f','33fa3':'3053f'}}
];
function own(o,key){return Object.prototype.hasOwnProperty.call(o,key);}
function object(o){return !!o && typeof o==='object' && !Array.isArray(o);}
function copy(o){return JSON.parse(JSON.stringify(o));}
function generation(n){return Number.isSafeInteger(n) && n>=0;}
function point(p){return Array.isArray(p) && p.length===3 && p.every(Number.isFinite);}
function speciesOf(race) {
  if(typeof race!=='string')return '';
  var lower=race.toLowerCase();
  if(lower.indexOf('sabre')>=0)return 'sabre-cat';
  return lower.replace(/race$/,'');
}
var SPECIES={wolf:'wolf',sabre:'sabre-cat',bear:'bear',barrow:'draugr',giant:'giant'};
var BANDITS={'50533':'imperial','50549':'imperial','5054a':'breton','5054e':'imperial'};
function createKillContracts(deps) {
  var mp=deps.mp, sources={},byId={},rows=[];
  var expanded=deps.expandedRows===undefined ? [] : copy(deps.expandedRows);
  if(!Array.isArray(expanded) || expanded.length>4)throw new Error('Invalid expanded kill source catalogue');
  if(!deps.population || !Array.isArray(deps.population.keep))throw new Error('Kill source catalogue is unavailable.');
  SPEC.forEach(function(spec){
    var row={id:spec.id,hold:spec.hold,place:spec.place,count:spec.count,world:spec.world+':Skyrim.esm',
      bounds:spec.bounds,refs:[]};
    Object.keys(spec.refs).forEach(function(local){
      var ref=local+':Skyrim.esm',base=spec.refs[local]+':Skyrim.esm';
      var matches=deps.population.keep.filter(function(r){return r[0]===ref;});
      var kept=matches[0];
      var species=spec.id==='camp'?BANDITS[local]:SPECIES[spec.id];
      if(matches.length!==1 || kept[1]!==base || kept[2]!==row.world || !point(kept[3]) ||
          !Number.isFinite(kept[4]) || kept[4]<=0 || kept[12]!==species ||
          spec.id==='camp' && kept[6]!=='enemy')throw new Error('Kill source disagrees with the kept cast: '+ref);
      sources[ref]={row:row,base:base,species:species,role:spec.id==='camp'?'bandit':species,
        pos:kept[3].slice(),leash:kept[4]};row.refs.push(ref);
    });
    byId[row.id]=row;rows.push(row);
  });
  expanded.forEach(function(spec){
    if(!object(spec) || typeof spec.id!=='string' || !/^q-[a-z0-9-]{1,46}$/.test(spec.id) || own(byId,spec.id) ||
        spec.kind!=='kill' || !object(spec.merchant) || typeof spec.merchant.hold!=='string' ||
        !Array.isArray(spec.targets) || spec.targets.length<1 || spec.targets.length>8 || !spec.targets.every(object) ||
        !Number.isInteger(spec.count) || spec.count<1 || spec.count>spec.targets.length)
      throw new Error('Invalid expanded kill source');
    var first=spec.targets[0],row={id:spec.id,hold:spec.merchant.hold,place:first.locationName,count:spec.count,
      world:first.world||first.cell,refs:[]};
    spec.targets.forEach(function(target){
      var matches=deps.population.keep.filter(function(kept){return kept[0]===target.ref;}),kept=matches[0];
      if(typeof target.ref!=='string' || typeof target.species!=='string' || !target.species ||
          own(sources,target.ref) || matches.length!==1 || kept[1]!==target.base || kept[2]!==row.world ||
          (target.world||target.cell)!==row.world || !point(target.pos) ||
          JSON.stringify(kept[3])!==JSON.stringify(target.pos) || kept[4]!==target.leash || !(target.leash>0) ||
          kept[5]!==target.returnMinutes || kept[6]!==target.role || !['enemy','animal'].includes(target.role) ||
          kept[7]!==target.habitat || kept[8]!==target.tier || kept[12]!==target.species ||
          (target.cap!==undefined && kept[9]!==target.cap) || !!(kept[11]&2)!==!!target.ambush)
        throw new Error('Expanded kill source disagrees with the kept cast: '+target.ref);
      sources[target.ref]={row:row,base:target.base,species:target.species,role:target.role,
        pos:target.pos.slice(),leash:target.leash};row.refs.push(target.ref);
    });
    byId[row.id]=row;rows.push(row);
  });
  function history(b) {
    var raw=own(b,'killHistory')?b.killHistory:b.expected?b.expected.killHistory:undefined;
    if(raw===undefined)return {};
    if(!object(raw) || Object.keys(raw).some(function(ref){return !own(sources,ref) || !generation(raw[ref]);}))return null;
    return copy(raw);
  }
  function uncertain(b) {
    var raw=own(b,'killUncertain')?b.killUncertain:b.expected?b.expected.killUncertain:undefined;
    if(raw===undefined)return {};
    if(!object(raw) || Object.keys(raw).some(function(id){return !own(byId,id) || raw[id]!==true;}))return null;
    return copy(raw);
  }
  function validEntry(row,entry,retained) {
    if(!object(entry) || !generation(entry.kills) || entry.kills>row.count)return false;
    var credited=entry.credited;
    if(credited===undefined && entry.kills===0)return true;
    if(!Array.isArray(credited) || credited.length!==entry.kills)return false;
    var seen={};
    return credited.every(function(body){
      if(!object(body) || row.refs.indexOf(body.ref)<0 || !generation(body.life) ||
          !retained || !own(retained,body.ref) || retained[body.ref]<body.life)return false;
      var key=JSON.stringify([body.ref,body.life]);
      if(own(seen,key))return false;seen[key]=true;return true;
    });
  }
  function snapshot(id) {
    try {
      var ref=mp.getDescFromId(id),source=sources[ref];
      if(!source)return null;
      var ai=mp.getNpcAIState(id),token=identityTools.targetIdentity(mp,id);
      if(!ai || ai.isHuman!==false || ai.isServerControlled!==true || ai.isDisabled===true ||
          !generation(ai.lifeGeneration) || !point(ai.pos) || typeof token!=='string' ||
          mp.get(id,'baseDesc')!==source.base || mp.get(id,'worldOrCellDesc')!==source.row.world ||
          typeof deps.raceOf!=='function' || speciesOf(deps.raceOf(id))!==source.species)return null;
      var body=JSON.parse(token);
      if(body.desc!==ref || body.life!==ai.lifeGeneration || body.body!==ai.runtimeLifeIdentity)return null;
      var distance=ai.pos.reduce(function(n,v,i){return n+Math.pow(v-source.pos[i],2);},0);
      var box=source.row.bounds;
      if(distance>source.leash*source.leash || box && (ai.pos[0]<box[0] || ai.pos[0]>box[1] || ai.pos[1]<box[2] || ai.pos[1]>box[3]))return null;
      return {ref:ref,life:ai.lifeGeneration,dead:ai.isDead===true,row:source.row};
    } catch(error){return null;}
  }
  function bodies(row) {
    try {
      var result=row.refs.map(function(ref){return snapshot(mp.getIdFromDesc(ref));});
      return result.every(Boolean)?result:null;
    } catch(error){return null;}
  }
  function take(b,id) {
    var row=own(byId,id)?byId[id]:null,retained=history(b),doubt=uncertain(b);
    if(!row)return {ok:false,why:'unknown'};
    if(own(b.open,id))return {ok:false,why:'open'};
    if(!retained || !doubt)return {ok:false,why:'recovery'};
    var current=bodies(row);
    if(!current)return {ok:false,why:'unavailable'};
    current.forEach(function(body){
      if(doubt[id] || body.dead)retained[body.ref]=Math.max(own(retained,body.ref)?retained[body.ref]:-1,body.life);
    });
    delete doubt[id];
    b.killHistory=retained;b.killUncertain=doubt;b.open[id]={drawn:0,kills:0,credited:[]};
    return {ok:true};
  }
  function credit(b,killer,victim) {
    var owner=deps.identity(killer);
    if(typeof owner!=='string' || !owner)return {ok:false,why:'identity'};
    var body=snapshot(victim),retained=history(b),doubt=uncertain(b);
    if(!body || !body.dead)return {ok:false,why:'target'};
    var entry=b.open[body.row.id];
    if(!retained || !doubt || doubt[body.row.id] || !validEntry(body.row,entry,retained))return {ok:false,why:'recovery'};
    if(entry.kills>=body.row.count || own(retained,body.ref) && retained[body.ref]>=body.life)return {ok:false,why:'duplicate'};
    if(deps.identity(killer)!==owner)return {ok:false,why:'identity'};
    entry=copy(entry);entry.kills++;entry.credited=(entry.credited || []).concat([{ref:body.ref,life:body.life}]);
    retained[body.ref]=body.life;b.killHistory=retained;b.open[body.row.id]=entry;
    return {ok:true};
  }
  function ready(b,id) {
    var row=own(byId,id)?byId[id]:null,retained=history(b),doubt=uncertain(b),entry=b.open[id];
    return !!row && !!retained && !!doubt && !doubt[id] && validEntry(row,entry,retained) && entry.kills===row.count;
  }
  function verified(b,id) {
    var row=own(byId,id)?byId[id]:null,retained=history(b),doubt=uncertain(b);
    return !!row && !!retained && !!doubt && (!own(b.open,id) || !doubt[id] && validEntry(row,b.open[id],retained));
  }
  function abandon(b,id) {
    var row=own(byId,id)?byId[id]:null,doubt=uncertain(b);
    if(!row || !own(b.open,id))return {ok:false,why:'none'};
    if(!doubt)return {ok:false,why:'recovery'};
    if(!validEntry(row,b.open[id],history(b)))doubt[id]=true;
    b.killUncertain=doubt;delete b.open[id];return {ok:true};
  }
  return {rows:rows,available:function(id){return own(byId,id) && !!bodies(byId[id]);},
    take:take,credit:credit,ready:ready,verified:verified,abandon:abandon};
}
module.exports={createKillContracts:createKillContracts};
return module.exports;})();
const MERCHANT_ROLES = (function () { const module = {exports:{}};
'use strict';
// Role admission does not retire actors or write economy state.
function prepareMerchantRoleStage(population,catalog,stage,native) {
  const roles=['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist'];
  const holds={whiterun:'Whiterun',solitude:'Haafingar',riften:'the Rift',markarth:'the Reach',
    windhelm:'Eastmarch',morthal:'Hjaalmarch',dawnstar:'the Pale',winterhold:'Winterhold',
    falkreath:'Falkreath',ravenrock:'Solstheim'};
  const fail=()=>{throw new Error('Merchant role stage cannot be verified');};
  const object=value=>value!==null && typeof value==='object' && !Array.isArray(value);
  const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
  const identity=value=>typeof value==='string' && /^([1-9a-f][0-9a-f]{0,5}):[^:/\\\x00-\x1f\x7f]+\.(esm|esp|esl)$/i.test(value);
  // No supplied native callback can replace the source being admitted.
  [population,catalog,stage]=JSON.parse(JSON.stringify([population,catalog,stage]));
  if(!object(population) || !object(stage))fail();
  const retirement=population.merchantRoster!==undefined,count=retirement?60:249;
  if(retirement && (!object(population.merchantRoster) || population.merchantRoster.version!==1 ||
      !['existing','alpha'].includes(population.merchantRoster.worldMode) || Object.keys(population.merchantRoster).length!==2 ||
      JSON.stringify(population.merchantHistory)!==JSON.stringify(stage.history)))fail();
  if(!object(stage) || stage.version!==1 || !Array.isArray(stage.history) || stage.history.length!==249 ||
      !Array.isArray(stage.merchants) || stage.merchants.length!==60 || !object(stage.tables) ||
      !object(stage.types) || !object(catalog) || catalog.count!==count || !object(catalog.byRef) ||
      Object.keys(catalog.byRef).length!==count || !object(population) || !Array.isArray(population.keep) ||
      !native || typeof native.resolveMerchant!=='function' ||
      typeof native.resolveItem!=='function') fail();
  const rows=new Map(),history=new Map(),selected=new Map(),coverage=new Set();
  for(const row of population.keep) {
    if(!Array.isArray(row) || rows.has(row[0]))fail();
    rows.set(row[0],row);
  }
  for(const pair of stage.history) {
    if(!Array.isArray(pair) || pair.length!==2 || !pair.every(identity) || history.has(pair[0]))fail();
    const row=rows.get(pair[0]);
    if(!retirement && !row || row && (row[6]!=='trader' || row[1]!==pair[1] || !own(catalog.byRef,pair[0])))fail();
    history.set(pair[0],pair[1]);
  }
  if(population.keep.filter(row=>row[6]==='trader').length!==count ||
      Object.keys(catalog.byRef).some(ref=>!history.has(ref)))fail();
  for(const merchant of stage.merchants) {
    if(!object(merchant) || Object.keys(merchant).sort().join(',')!=='base,bookHold,hold,reference,role' ||
        history.get(merchant.reference)!==merchant.base || !rows.has(merchant.reference) ||
        !own(catalog.byRef,merchant.reference) || selected.has(merchant.reference) ||
        !roles.includes(merchant.role) || !own(holds,merchant.bookHold) || holds[merchant.bookHold]!==merchant.hold ||
        catalog.byRef[merchant.reference].hold!==merchant.hold ||
        catalog.byRef[merchant.reference].bookHold!==merchant.bookHold || coverage.has(merchant.bookHold+':'+merchant.role))fail();
    selected.set(merchant.reference,merchant);coverage.add(merchant.bookHold+':'+merchant.role);
  }
  const items=new Set(),directions=['buy','sell','supply'];
  if(Object.keys(stage.tables).length!==6 || roles.some(role=>!own(stage.tables,role)))fail();
  for(const role of roles) {
    const table=stage.tables[role];
    if(!object(table) || Object.keys(table).sort().join(',')!=='buy,sell,supply')fail();
    for(const direction of directions) {
      const values=table[direction];
      if(!Array.isArray(values) || new Set(values).size!==values.length)fail();
      for(const desc of values) {
        if(!identity(desc) || parseInt(desc,16)===15 && desc.split(':')[1].toLowerCase()==='skyrim.esm' || !own(stage.types,desc) ||
            !['ALCH','AMMO','ARMO','BOOK','INGR','KEYM','MISC','SCRL','SLGM','WEAP'].includes(stage.types[desc]))fail();
        items.add(desc);
      }
    }
    if(table.supply.some(desc=>!table.buy.includes(desc)))fail();
  }
  const resolved=new Map(),ids=new Map();
  function remember(desc,id) {
    if(!Number.isInteger(id) || id<=0 || id>=0xff000000 || ids.has(id) && ids.get(id)!==desc)fail();
    ids.set(id,desc);resolved.set(desc,id);return id;
  }
  for(const merchant of selected.values()) remember(merchant.reference,native.resolveMerchant(merchant.reference,merchant.base));
  for(const desc of items) {
    const id=remember(desc,native.resolveItem(desc,stage.types[desc]));if(id===15)fail();
  }
  const roleTables={};
  for(const role of roles) {
    roleTables[role]={};
    for(const direction of directions)roleTables[role][direction]=stage.tables[role][direction].map(desc=>resolved.get(desc));
  }
  population.merchantRoles={};
  for(const merchant of selected.values()) {
    Object.assign(catalog.byRef[merchant.reference],{name:merchant.role,role:merchant.role});
    rows.get(merchant.reference)[13]=merchant.role;
    population.merchantRoles[merchant.reference]=merchant.role;
  }
  return {population,catalog,roleTables};
}
module.exports={prepareMerchantRoleStage};
return module.exports;})();
const MERCHANT_NATIVE = (function () { const module = {exports:{}};
'use strict';
// Bind an already isolated native reader. This creates no server or actors.
const apply=Reflect.apply;
function fail() {throw new Error('Native merchant ledger evidence cannot be verified.');}
function staticId(id) {return Number.isInteger(id) && id>0 && id<0xff000000;}
function createLedgerNativeValidators(mp) {
  const methods={};
  try {
    for(const key of ['getIdFromDesc','getDescFromId','lookupEspmRecordById','validateInventoryTransaction']) {
      const method=mp[key];
      if(typeof method!=='function')fail();
      methods[key]=method;
    }
  } catch(error) {fail();}
  const call=(key,...args)=>apply(methods[key],mp,args);
  function resolve(description) {
    if(typeof description!=='string' || !description)fail();
    const id=call('getIdFromDesc',description);
    if(!staticId(id) || call('getDescFromId',id)!==description)fail();
    return id;
  }
  function mapped(lookup,raw) {
    if(!staticId(raw) || typeof lookup.toGlobalRecordId!=='function')fail();
    const id=apply(lookup.toGlobalRecordId,lookup,[raw]);
    if(!staticId(id))fail();
    // Native light-slot mapping masks high local bits instead of rejecting them.
    const local=(id>>>24)===0xfe?id&0xfff:id&0xffffff;
    if((raw&0xffffff)!==local)fail();
    return id;
  }
  function winner(id,type) {
    const lookup=call('lookupEspmRecordById',id),record=lookup && lookup.record;
    if(!record || record.type!==type || mapped(lookup,record.id)!==id)fail();
    return lookup;
  }
  function resolveMerchant(reference,base) {
    try {
      const id=resolve(reference),baseId=resolve(base),placement=winner(id,'ACHR');
      const fields=placement.record.fields;
      if(!Array.isArray(fields))fail();
      const names=fields.filter(field=>field && field.type==='NAME');
      if(names.length!==1 || !(names[0].data instanceof Uint8Array) || names[0].data.byteLength!==4)fail();
      const data=names[0].data;
      const raw=Buffer.from(data.buffer,data.byteOffset,data.byteLength).readUInt32LE();
      if(mapped(placement,raw)!==baseId)fail();
      winner(baseId,'NPC_');
      return id;
    } catch(error) {fail();}
  }
  function validateInventory(snapshot) {
    try {if(call('validateInventoryTransaction',snapshot)!==true)fail();return true;}
    catch(error) {fail();}
  }
  function resolveItem(description,type) {
    try {
      if(!['ALCH','AMMO','ARMO','BOOK','INGR','KEYM','MISC','SCRL','SLGM','WEAP'].includes(type))fail();
      const id=resolve(description),record=winner(id,type).record;
      if(id===15 || !Number.isInteger(record.flags) || record.flags<0 || record.flags>0xffffffff || record.flags & 0x20 ||
          ['ARMO','WEAP'].includes(type) && record.flags & 4)fail();
      return id;
    } catch(error) {fail();}
  }
  return Object.freeze({resolveMerchant,resolveItem,validateInventory});
}
module.exports={createLedgerNativeValidators};
return module.exports;})();
const QUEST_FISHING_SOURCES = (function () { const module = {exports:{}};
'use strict';
const apply=Reflect.apply;
const vector=v=>Array.isArray(v)&&v.length===3&&[0,1,2].every(i=>Number.isFinite(v[i]));
const distance=(a,b)=>a.reduce((sum,n,i)=>sum+(n-b[i])**2,0);
const staticId=id=>Number.isInteger(id)&&id>0&&id<0xff000000;
function createQuestSources(mp,input,contract) {
 const fail=()=>{throw new Error('Quest '+contract.label+' source evidence cannot be verified.');};
 const methods={};
 for(const key of ['get','getIdFromDesc','getDescFromId','lookupEspmRecordById']) {
  if(typeof mp[key]!=='function')fail();methods[key]=mp[key];
 }
 const call=(name,...args)=>apply(methods[name],mp,args);
 function resolve(desc) {
  if(typeof desc!=='string'||!desc)fail();const id=call('getIdFromDesc',desc);
  if(!staticId(id)||call('getDescFromId',id)!==desc)fail();return id;
 }
 function mapped(lookup,raw) {
  if(!staticId(raw)||typeof lookup.toGlobalRecordId!=='function')fail();
  const id=apply(lookup.toGlobalRecordId,lookup,[raw]);
  if(!staticId(id)||(raw&0xffffff)!==((id>>>24)===0xfe?id&0xfff:id&0xffffff))fail();
  return id;
 }
 function winner(id,type) {
  const lookup=call('lookupEspmRecordById',id),r=lookup&&lookup.record;
  if(!r||r.type!==type||mapped(lookup,r.id)!==id||!Number.isInteger(r.flags)||r.flags<0||r.flags>0xffffffff||
    r.flags&0x820)fail();return lookup;
 }
 function emptyPetty(lookup) {
  for(const [tag,value] of [['SOUL',0],['SLCP',1]]) {
   const fields=(lookup.record.fields||[]).filter(f=>f&&f.type===tag);
   if(fields.length!==1||!(fields[0].data instanceof Uint8Array)||fields[0].data.byteLength!==1||fields[0].data[0]!==value)fail();
  }
 }
 function produce(lookup,row) {
  const fields=(lookup.record.fields||[]).filter(f=>f&&f.type==='PFIG');
  if(fields.length!==1||!(fields[0].data instanceof Uint8Array)||fields[0].data.byteLength!==4)fail();
  const data=fields[0].data,raw=Buffer.from(data.buffer,data.byteOffset,4).readUInt32LE();
  if(mapped(lookup,raw)!==row.itemId)fail();
 }
 function token(lookup) {
  const fields=(lookup.record.fields||[]).filter(f=>f&&f.type==='DATA');
  if(fields.length!==1||!(fields[0].data instanceof Uint8Array)||fields[0].data.byteLength!==8)fail();
  const bytes=fields[0].data,data=Buffer.from(bytes.buffer,bytes.byteOffset,8);
  if(data.readUInt32LE()!==0||data.readFloatLE(4)!==0)fail();
 }
 const byId=new Map(),byDesc=new Set();
 if(!Array.isArray(input)||input.length!==contract.count)fail();
 for(const original of input) {
  const row=JSON.parse(JSON.stringify(original));
  if(!vector(original.position)||row.itemType!==contract.itemType||row.rank!==contract.rank||row.returnMinutes!==contract.returnMinutes||byDesc.has(row.reference))fail();
  if(contract.retrieval&&(!['CONT','ACTI'].includes(row.baseType)||!['WRLD','CELL'].includes(row.spaceType)||
    !row.provenance||!Number.isInteger(row.provenance.fileIndex)||row.provenance.fileIndex<0||
    !/^[a-f0-9]{64}$/.test(row.provenance.recordSha256)))fail();
  const id=resolve(row.reference),base=resolve(row.base),item=resolve(row.item),world=resolve(row.world);
  if(item===15||byId.has(id)||contract.vanillaIds&&id!==parseInt(row.reference.split(':')[0],16))fail();
  winner(base,contract.retrieval?row.baseType:contract.baseType);const itemRecord=winner(item,contract.itemType);
  winner(world,contract.retrieval?row.spaceType:'WRLD');
  if(contract.emptyPetty)emptyPetty(itemRecord);
  if(contract.retrieval)token(itemRecord);
  byId.set(id,{...row,id,baseId:base,itemId:item,worldId:world});byDesc.add(row.reference);
 }
 function source(row) {
  const baseRecord=winner(row.baseId,contract.retrieval?row.baseType:contract.baseType);
  winner(row.worldId,contract.retrieval?row.spaceType:'WRLD');
  if(contract.produce)produce(baseRecord,row);
  const itemRecord=winner(row.itemId,contract.itemType);
  if(contract.emptyPetty)emptyPetty(itemRecord);
  if(contract.retrieval)token(itemRecord);
  if(call('getDescFromId',row.id)!==row.reference||call('get',row.id,'isDisabled')!==false||
    call('get',row.id,'baseDesc')!==row.base)return false;
  const placement=winner(row.id,'REFR'),names=(placement.record.fields||[]).filter(f=>f&&f.type==='NAME');
  if(contract.retrieval) {
   const record=placement.record;
   if(placement.fileIndex!==row.provenance.fileIndex||record.id!==row.provenance.rawId)return false;
   const nativeFields=(record.fields||[]).map(f=>{
    if(!f||typeof f.type!=='string'||!(f.data instanceof Uint8Array))fail();
    return [f.type,Buffer.from(f.data.buffer,f.data.byteOffset,f.data.byteLength).toString('hex')];
   });
   const hash=require('node:crypto').createHash('sha256').update(JSON.stringify([record.type,record.id,record.flags,nativeFields])).digest('hex');
   if(hash!==row.provenance.recordSha256)return false;
  }
  if(names.length!==1||!(names[0].data instanceof Uint8Array)||names[0].data.byteLength!==4)return false;
  const bytes=names[0].data,raw=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength).readUInt32LE();
  if(mapped(placement,raw)!==row.baseId)return false;
  const transforms=(placement.record.fields||[]).filter(f=>f&&f.type==='DATA');
  if(transforms.length!==1||!(transforms[0].data instanceof Uint8Array)||transforms[0].data.byteLength!==24)return false;
  const transform=Buffer.from(transforms[0].data.buffer,transforms[0].data.byteOffset,24);
  const values=Array.from({length:6},(_,i)=>transform.readFloatLE(i*4));
  if(!values.every(Number.isFinite)||distance(values.slice(0,3),row.position)>0.01**2)return false;

  const loc=call('get',row.id,'locationalData');
  return !!loc&&loc.cellOrWorldDesc===row.world&&vector(loc.pos)&&distance(loc.pos,row.position)<=128**2;
 }
 for(const row of byId.values()) {
  if(!source(row))fail();
 }
 return Object.freeze({contains:desc=>byDesc.has(desc),verify(actor,ref) {
  try {
   const row=byId.get(ref);if(!row||!source(row))return false;
   const actorLoc=call('get',actor,'locationalData'),loc=call('get',ref,'locationalData');
   return !!actorLoc&&actorLoc.cellOrWorldDesc===row.world&&vector(actorLoc.pos)&&!!loc&&loc.cellOrWorldDesc===row.world&&vector(loc.pos)&&distance(loc.pos,row.position)<=128**2&&
    distance(actorLoc.pos,loc.pos)<=400**2;
  }catch(error){return false;}
 }});
}
function createQuestFishingSources(mp,input) {
 return createQuestSources(mp,input,{label:'fishing',count:3,baseType:'FLOR',itemType:'INGR',rank:'expert',returnMinutes:60});
}
function createQuestHarvestSources(mp,input) {
 return createQuestSources(mp,input,{label:'harvest',count:8,baseType:'ACTI',itemType:'INGR',rank:'novice',returnMinutes:10,vanillaIds:true});
}
function createQuestGeodeSources(mp,input) {
 return createQuestSources(mp,input,{label:'geode',count:6,baseType:'ACTI',itemType:'SLGM',rank:'novice',returnMinutes:30,vanillaIds:true,emptyPetty:true});
}
function createQuestLongfinSources(mp,input) {
 return createQuestSources(mp,input,{label:'longfin',count:8,baseType:'FLOR',itemType:'INGR',rank:'master',returnMinutes:240,produce:true});
}
function createQuestRetrievalSources(mp,input) {
 return createQuestSources(mp,input,{label:'retrieval',count:7,itemType:'MISC',retrieval:true});
}
function createQuestOrchardSources(mp,input) {
 return createQuestSources(mp,input,{label:'orchard',count:10,baseType:'FLOR',itemType:'ALCH',rank:'expert',returnMinutes:0,produce:true});
}
module.exports={createQuestOrchardSources,createQuestFishingSources,createQuestHarvestSources,createQuestGeodeSources,createQuestLongfinSources,createQuestRetrievalSources};
return module.exports;})();
const QUEST_ITEMS = (function () { const module = {exports:{}};
'use strict';
function createQuestItemPolicy(mp) {
 if(!mp||typeof mp.getDescFromId!=='function')throw new Error('Quest item identity lookup is unavailable');
 const lookup=mp.getDescFromId;
 const tokens=new Set(Array.from({length:7},(_,i)=>(0x17000+i).toString(16)+':thornswood-content.esp'));
 return Object.freeze({blocked(baseId) {
  if(!Number.isInteger(baseId)||baseId<=0||baseId>0xffffffff)return true;
  try {
   const desc=Reflect.apply(lookup,mp,[baseId]);
   if(typeof desc!=='string'||!/^[0-9a-f]{1,8}:[^:\0\r\n]+\.(?:esm|esp|esl)$/i.test(desc))return true;
   const colon=desc.indexOf(':'),canonical=parseInt(desc.slice(0,colon),16).toString(16)+desc.slice(colon).toLowerCase();
   return tokens.has(canonical);
  }catch(error){return true;}
 }});
}
module.exports={createQuestItemPolicy};
return module.exports;})();
const QUEST_MAMMOTH_SOURCES = (function () { const module = {exports:{}};
'use strict';
const apply=Reflect.apply;
const point=v=>Array.isArray(v)&&v.length===3&&[0,1,2].every(i=>Number.isFinite(v[i]));
const distance=(a,b)=>a.reduce((sum,n,i)=>sum+(n-b[i])**2,0);
const revision=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v)&&(v.length<20||v<='18446744073709551615');
function createQuestMammothSources(mp,population) {
 const fail=()=>{throw new Error('Mammoth source evidence cannot be verified.');};
 const methods={};
 for(const key of ['get','getIdFromDesc','getDescFromId','lookupEspmRecordById','getNpcAIState']) {
  if(!mp||typeof mp[key]!=='function')fail();methods[key]=mp[key];
 }
 const call=(key,...args)=>apply(methods[key],mp,args),byId=new Map();
 const refs=['33fa6:Skyrim.esm','846ea:Skyrim.esm','846eb:Skyrim.esm'];
 const originalPositions=[[519.6705932617188,3950.623291015625,-5856],
  [-1923.1177978515625,3608.172119140625,-6275.24169921875],[-1810.09521484375,2847.945556640625,-6141.3271484375]];
 for(const [index,ref] of refs.entries()) {
  const matches=population&&Array.isArray(population.keep)?population.keep.filter(r=>r[0]===ref):[];
  if(matches.length!==1)fail();const row=JSON.parse(JSON.stringify(matches[0]));
  if(row[1]!=='dd641:Skyrim.esm'||row[2]!=='3c:Skyrim.esm'||!point(row[3])||distance(row[3],originalPositions[index])!==0||row[4]!==[2048,1536,1536][index]||
    row[5]!==240||row[6]!=='animal'||row[12]!=='mammoth')fail();
  const id=call('getIdFromDesc',ref);
  if(id!==parseInt(ref,16)||call('getDescFromId',id)!==ref)fail();
  byId.set(id,row);
 }
 function placement(id,row) {
  const lookup=call('lookupEspmRecordById',id),record=lookup&&lookup.record;
  if(!record||record.type!=='ACHR'||record.id!==id||!Number.isInteger(record.flags)||record.flags<0||record.flags>0xffffffff||record.flags&0x820||
    typeof lookup.toGlobalRecordId!=='function')return false;
  const fields=record.fields||[],names=fields.filter(f=>f.type==='NAME'),transforms=fields.filter(f=>f.type==='DATA');
  if(names.length!==1||transforms.length!==1||!(names[0].data instanceof Uint8Array)||names[0].data.byteLength!==4||
    !(transforms[0].data instanceof Uint8Array)||transforms[0].data.byteLength!==24)return false;
  const name=Buffer.from(names[0].data.buffer,names[0].data.byteOffset,4).readUInt32LE();
  const base=apply(lookup.toGlobalRecordId,lookup,[name]),baseLookup=call('lookupEspmRecordById',base);
  const baseRecord=baseLookup&&baseLookup.record;
  if(call('getDescFromId',base)!==row[1]||!baseRecord||baseRecord.type!=='NPC_'||
    !Number.isInteger(baseRecord.flags)||baseRecord.flags<0||baseRecord.flags>0xffffffff||baseRecord.flags&0x820||
    typeof baseLookup.toGlobalRecordId!=='function'||apply(baseLookup.toGlobalRecordId,baseLookup,[baseRecord.id])!==base)return false;
  const bytes=transforms[0].data,data=Buffer.from(bytes.buffer,bytes.byteOffset,24);
  const values=Array.from({length:6},(_,i)=>data.readFloatLE(i*4));
  return values.every(Number.isFinite)&&distance(values.slice(0,3),row[3])<=0.01**2;
 }
 for(const [id,row] of byId)if(!placement(id,row))fail();
 function read(actor,id) {
  try {
   const row=byId.get(id);if(!row||!placement(id,row)||call('getDescFromId',id)!==row[0])return null;
   const ai=JSON.parse(JSON.stringify(call('getNpcAIState',id)));
   if(!ai||ai.isHuman!==false||ai.isServerControlled!==true||ai.isDisabled===true||ai.isDead!==true||
     !Number.isInteger(ai.profileId)||ai.profileId>=0||!Number.isSafeInteger(ai.lifeGeneration)||ai.lifeGeneration<0||
     !revision(ai.runtimeLifeIdentity)||!point(ai.pos)||distance(ai.pos,row[3])>row[4]**2||
     ai.pos[0]<-2500||ai.pos[0]>1000||ai.pos[1]<2000||ai.pos[1]>4500||
     call('get',id,'baseDesc')!==row[1]||call('get',id,'worldOrCellDesc')!==row[2])return null;
   const loc=call('get',actor,'locationalData');
   if(!loc||loc.cellOrWorldDesc!==row[2]||!point(loc.pos)||distance(loc.pos,ai.pos)>400**2)return null;
   const final=call('getNpcAIState',id);
   if(!final||final.profileId!==ai.profileId||final.lifeGeneration!==ai.lifeGeneration||final.runtimeLifeIdentity!==ai.runtimeLifeIdentity||
     final.isHuman!==false||final.isServerControlled!==true||final.isDisabled===true||final.isDead!==true||
     !point(final.pos)||distance(final.pos,ai.pos)!==0)return null;
   return {ref:row[0],life:ai.lifeGeneration,body:ai.runtimeLifeIdentity};
  }catch(error){return null;}
 }
 return Object.freeze({contains:ref=>refs.includes(ref),read,verify(actor,id,expected) {
  const body=read(actor,id);return !!body&&!!expected&&body.ref===expected.ref&&body.life===expected.life&&body.body===expected.body;
 }});
}
module.exports={createQuestMammothSources};
return module.exports;})();
const QUEST_HUNT_BUNDLES = (function () { const module = {exports:{}};
'use strict';
const refs=new Set(['33fa6:Skyrim.esm','846ea:Skyrim.esm','846eb:Skyrim.esm']);
const items=['3ad6c:Skyrim.esm','669a4:Skyrim.esm'];
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const clone=v=>JSON.parse(JSON.stringify(v));
function readMammothDraw(entry) {
 try {
  if(!object(entry)||!Number.isInteger(entry.drawn)||entry.drawn<0||entry.drawn>3||entry.kills!==0||entry.itemDesc!==null||
    !Array.isArray(entry.bundles)||entry.bundles.length!==entry.drawn)return null;
  const seen=new Set();
  for(const row of entry.bundles) {
   if(!object(row)||!refs.has(row.ref)||!Number.isSafeInteger(row.life)||row.life<0||
     typeof row.body!=='string'||!/^[1-9][0-9]{0,19}$/.test(row.body)||row.body.length===20&&row.body>'18446744073709551615'||
     !Array.isArray(row.goods)||row.goods.length!==2||[0,1].some(i=>!Number.isInteger(row.goods[i])||row.goods[i]<1||row.goods[i]>5))return null;
   const key=JSON.stringify([row.ref,row.life,row.body]);
   if(seen.has(key))return null;seen.add(key);
  }
  return clone(entry);
 }catch(error){return null;}
}
function appendMammothDraw(entry,body) {
 const before=readMammothDraw(entry),one=readMammothDraw({drawn:1,kills:0,itemDesc:null,bundles:[body]});
 if(!before||!one||before.drawn>=3)return {ok:false};
 before.drawn++;before.bundles.push(one.bundles[0]);
 return readMammothDraw(before)?{ok:true,next:before}:{ok:false};
}
function changes(rows) {
 const totals=[0,0];rows.forEach(row=>row.goods.forEach((n,i)=>{totals[i]+=n;}));
 return items.flatMap((item,i)=>totals[i]?[{item,count:-totals[i]}]:[]);
}
function mammothReturn(entry) {
 const value=readMammothDraw(entry);
 return value&&value.drawn>0?{ok:true,changes:changes(value.bundles.slice(0,1))}:{ok:false};
}
function mammothAbandon(entry) {
 const value=readMammothDraw(entry);
 return value?{ok:true,changes:changes(value.bundles)}:{ok:false};
}
module.exports={readMammothDraw,appendMammothDraw,mammothReturn,mammothAbandon};
return module.exports;})();
const ORCHARD_PLOTS = (function () { const module = {exports:{}};
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function createOrchardPlots(storage,references) {
 if(!storage||storage.durable!==true||!Array.isArray(references)||references.length!==10||new Set(references).size!==10)
  throw Error('Orchard plot storage is unavailable');
 let active=true,busy=false,doc=storage.load();
 function validPlot(value) {
  if(value===null)return true;
  if(!value||Array.isArray(value)||typeof value!=='object'||
   !Number.isSafeInteger(value.by)||value.by<0||typeof value.crop!=='string'||
   !Number.isSafeInteger(value.at)||value.at<0||!Number.isSafeInteger(value.ms)||value.ms<0||
   !Number.isInteger(value.step)||value.step<0||value.step>3)return false;
  return value.crop==='' ? value.by===0&&value.at===0&&value.ms===0&&value.step===0 :
   value.crop==="141081:JK's Whiterun's Outskirts.esp"&&value.by>0&&value.at>0&&value.ms>0;
 }
 if(!doc||doc.version!==1||!doc.entries||Array.isArray(doc.entries)||
  Object.keys(doc.entries).length!==10||!references.every(ref=>Object.hasOwn(doc.entries,ref)&&validPlot(doc.entries[ref])))
  throw Error('Orchard plots cannot be verified');
 doc=clone(doc);
 function usable() {return active&&(!storage.current||storage.current());}
 function read(ref) {
  if(!usable()||busy||!Object.hasOwn(doc.entries,ref))throw Error('Orchard plots are unavailable');
  return clone(doc.entries[ref]);
 }
 function save(next) {
  try {
   if(!usable()||storage.save(clone(next))!==true||!usable())throw Error('Orchard save acknowledgement is unavailable');
   doc=clone(next);return true;
  }catch(error){active=false;return false;}
 }
 function write(ref,value) {
  if(!usable()||busy||!Object.hasOwn(doc.entries,ref)||!validPlot(value))return false;
  busy=true;
  try {const next=clone(doc);next.entries[ref]=clone(value);return save(next);}
  finally {busy=false;}
 }
 function compareWrite(ref,expected,value) {
  if(!usable()||busy||!Object.hasOwn(doc.entries,ref)||!same(doc.entries[ref],expected))return false;
  return write(ref,value);
 }
 function sow(ref,value) {
  if(!usable()||busy||!Object.hasOwn(doc.entries,ref)||doc.entries[ref]&&doc.entries[ref].crop!=='')return false;
  return write(ref,value);
 }
 function sowWithSeed(ref,expected,value,eligible,seed) {
  if(!usable()||busy||!Object.hasOwn(doc.entries,ref)||!validPlot(value)||!value.crop||
   !same(doc.entries[ref],expected)||expected&&expected.crop!=='')return false;
  busy=true;
  try {
   if(!eligible()||!usable())return false;
   let paid;
   try {paid=seed(()=>usable()&&eligible()&&usable()&&same(doc.entries[ref],expected));}
   catch(error){active=false;return false;}
   if(paid!==true){if(paid!==false)active=false;return false;}
   if(!usable()||!eligible()||!same(doc.entries[ref],expected))return false;
   const next=clone(doc);next.entries[ref]=clone(value);return save(next);
  }finally{busy=false;}
 }
 function harvest(ref,expected,eligible,award) {
  if(!usable()||busy||!Object.hasOwn(doc.entries,ref)||!same(doc.entries[ref],expected))return false;
  busy=true;
  try {
   if(!eligible()||!usable()||!same(doc.entries[ref],expected))return false;
   const next=clone(doc),reserved={by:0,crop:'',at:0,ms:0,step:0};
   next.entries[ref]=reserved;
   if(!save(next))return false;
   let paid;
   try {paid=award(()=>usable()&&eligible()&&usable()&&same(doc.entries[ref],reserved));}
   catch(error){active=false;return false;}
   if(paid===true)return usable();
   if(paid!==false){active=false;return false;}
   if(!usable()||!same(doc.entries[ref],reserved))return false;
   const restored=clone(doc);restored.entries[ref]=clone(expected);save(restored);
   return false;
  }finally {busy=false;}
 }
 return Object.freeze({read,write,compareWrite,sow,sowWithSeed,harvest,available:usable,shutdown(){active=false;}});
}
function createOrchardStorage(fs,path,settings,writeWhole,references) {
 if(typeof writeWhole!=='function')throw Error('Durable orchard writes are unavailable');
 const dir=path.resolve(settings.privDir||'private'),served=path.resolve(settings.dataDir||'data');
 const file=path.join(dir,'orchard-plots.json'),marker=file+'.initialized';
 function real(input) {
  let found=input;const tail=[];
  while(!fs.existsSync(found)){const parent=path.dirname(found);if(parent===found)throw Error('Orchard path unavailable');tail.unshift(path.basename(found));found=parent;}
  return path.resolve(fs.realpathSync(found),...tail);
 }
 function privacy() {
  const relative=path.relative(real(served),real(dir));
  if(!relative||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw Error('Orchard state must be private');
 }
 const checksum=doc=>require('node:crypto').createHash('sha256').update(JSON.stringify([doc.version,doc.entries])).digest('hex');
 function save(doc) {
  privacy();writeWhole(file,JSON.stringify({version:doc.version,entries:doc.entries,sha256:checksum(doc)}));return true;
 }
 function load() {
  privacy();
  if(!fs.existsSync(file)) {
   if(fs.existsSync(marker))throw Error('Saved orchard plots are missing');
   save({version:1,entries:Object.fromEntries(references.map(ref=>[ref,null]))});
  }
  const doc=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!doc||doc.sha256!==checksum(doc))throw Error('Saved orchard plots are damaged');
  if(!fs.existsSync(marker))writeWhole(marker,'1');
  return {version:doc.version,entries:doc.entries};
 }
 return {load,save,durable:true};
}
module.exports={createOrchardPlots,createOrchardStorage};
return module.exports;})();
const SCENE_BUDGET = (function () { const module = {exports:{}};
'use strict';
// Pure projection. Only the caller's fenced native CAS
// can commit this state together with original quest terms and any reward.
var DAY = 86400000, LIMIT = 150;
function integer(n, min) { return Number.isSafeInteger(n) && n >= min; }
function gold(n) { return integer(n, 10) && n <= LIMIT; }
function id(s) {
  return typeof s === 'string' && s.length <= 48 && s.slice(0, 2) === 'q-' &&
    !/[^a-z0-9-]|--|-$/.test(s);
}
function object(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function data(value, key) {
  var d = Object.getOwnPropertyDescriptor(value, key);
  return d && d.enumerable && Object.prototype.hasOwnProperty.call(d, 'value') ? d.value : undefined;
}
function shape(value, fields) {
  return object(value) && Reflect.ownKeys(value).length === fields.length && fields.every(function(key) {
    return data(value, key) !== undefined;
  });
}
function array(value, length) {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype &&
    value.length === length && Reflect.ownKeys(value).length === length + 1;
}
function read(raw) {
  if (!shape(raw, ['v', 'clock', 'serial', 'held', 'paid']) || data(raw, 'v') !== 1) return null;
  var clock = data(raw, 'clock'), serial = data(raw, 'serial'), held = data(raw, 'held'), paid = data(raw, 'paid');
  if (!integer(clock, 1) || !integer(serial, 0) || !object(held) ||
      !Array.isArray(paid) || paid.length > 15 || !array(paid, paid.length)) return null;
  var keys = Reflect.ownKeys(held), copy = {v: 1, clock: clock, serial: serial, held: {}, paid: []};
  if (keys.length > 3 || serial < keys.length + paid.length) return null;
  var tokens = [], used = 0, last = 0;
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i], row = typeof key === 'string' ? data(held, key) : undefined;
    if (!id(key) || !shape(row, ['gold', 'at', 'token'])) return null;
    var amount = data(row, 'gold'), at = data(row, 'at'), token = data(row, 'token');
    if (!gold(amount) || !integer(at, 1) || at > clock || !integer(token, 1) || token > serial || tokens.indexOf(token) >= 0) return null;
    tokens.push(token); used += amount;
    copy.held[key] = {gold: amount, at: at, token: token};
  }
  for (var j = 0; j < paid.length; j++) {
    var pair = data(paid, String(j));
    if (!array(pair, 2)) return null;
    var stamp = data(pair, '0'), value = data(pair, '1');
    if (!integer(stamp, 1) || stamp > clock || stamp < last || !gold(value)) return null;
    last = stamp;
    if (stamp > clock - DAY) used += value;
    copy.paid.push([stamp, value]);
  }
  return used <= LIMIT ? copy : null;
}
function prepare(raw, now) {
  if (!integer(now, 1)) return {ok: false, why: 'time'};
  var next = raw === undefined ? {v: 1, clock: now, serial: 0, held: {}, paid: []} : read(raw);
  if (!next) return {ok: false, why: 'state'};
  if (now < next.clock) return {ok: false, why: 'time'};
  next.paid = next.paid.filter(function(pair) { return pair[0] > now - DAY; });
  next.clock = now;
  return {ok: true, next: next};
}
function inspect(raw, now) {
  var result = prepare(raw, now);
  if (!result.ok) return result;
  var next = result.next, keys = Object.keys(next.held);
  var paid = next.paid.reduce(function(n, pair) { return n + pair[1]; }, 0);
  var reserved = keys.reduce(function(n, key) { return n + next.held[key].gold; }, 0);
  return {ok: true, paidGold: paid, reservedGold: reserved, availableGold: LIMIT - paid - reserved, openCount: keys.length};
}
function reserve(raw, key, amount, now) {
  if (!id(key) || !gold(amount)) return {ok: false, why: 'request'};
  var result = prepare(raw, now);
  if (!result.ok) return result;
  var next = result.next, view = inspect(next, now);
  if (Object.prototype.hasOwnProperty.call(next.held, key)) return {ok: false, why: 'open'};
  if (view.openCount >= 3) return {ok: false, why: 'open-limit'};
  if (view.availableGold < amount) return {ok: false, why: 'allowance'};
  if (next.serial === Number.MAX_SAFE_INTEGER) return {ok: false, why: 'counter'};
  var token = ++next.serial;
  next.held[key] = {gold: amount, at: now, token: token};
  return {ok: true, next: next, token: token};
}
function close(raw, key, token, now, pay) {
  if (!id(key) || !integer(token, 1)) return {ok: false, why: 'request'};
  var result = prepare(raw, now);
  if (!result.ok) return result;
  var next = result.next, row = next.held[key];
  if (!row || row.token !== token) return {ok: false, why: 'reservation'};
  delete next.held[key];
  if (pay) next.paid.push([now, row.gold]);
  return {ok: true, next: next, gold: pay ? row.gold : 0};
}
module.exports = Object.freeze({reserve: reserve, inspect: inspect,
  complete: function(raw, key, token, now) { return close(raw, key, token, now, true); },
  cancel: function(raw, key, token, now) { return close(raw, key, token, now, false); }});
return module.exports;})();
'use strict';

var GOLD_BASE = 15;
var REACH = 400;
var SUPPLY_COUNT = 5;
var SUPPLY_WAIT = 6 * 60 * 60 * 1000;
var MAX_GOLD = 2147483647;
var MAX_COUNT = 100000;

var BOOK_HOLD = {
  Whiterun: 'whiterun',
  Haafingar: 'solitude',
  'the Rift': 'riften',
  'the Reach': 'markarth',
  Eastmarch: 'windhelm',
  Falkreath: 'falkreath',
  Hjaalmarch: 'morthal',
  'the Pale': 'dawnstar',
  Winterhold: 'winterhold',
  Solstheim: 'ravenrock'
};

function bookHoldOf(hold) {
  if (!hold || hold === 'no hold') return null;
  return BOOK_HOLD[hold] || null;
}

function loadGuildSites() {
  if (typeof MERCHANT_GUILD_SITES !== 'undefined') return MERCHANT_GUILD_SITES;
  var fs = require('fs');
  var path = require('path');
  var file = path.join(__dirname, 'data', 'guild-sites.json');
  var doc = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  if (!doc || !Array.isArray(doc.sites) || doc.sites.length !== 10) {
    throw new Error('Each hold needs one guild site.');
  }
  return doc.sites;
}

var GUILD_SITES = loadGuildSites();

function guildSite(bookHold) {
  for (var i = 0; i < GUILD_SITES.length; i++) {
    if (GUILD_SITES[i].bookHold === bookHold) return GUILD_SITES[i];
  }
  return null;
}

var SETTLEMENT = typeof MERCHANT_SETTLEMENT !== 'undefined' ? MERCHANT_SETTLEMENT : require('./merchant-settlement');
var COMMISSION_STATE=typeof MERCHANT_COMMISSION_STATE!=='undefined'?MERCHANT_COMMISSION_STATE:require('./merchant-commission-state');
var COMMISSIONS=typeof MERCHANT_COMMISSIONS!=='undefined'?MERCHANT_COMMISSIONS:require('./merchant-commissions');
var QUEST_TRANSFER = typeof QUEST_TRANSACTIONS !== 'undefined' ? QUEST_TRANSACTIONS : require('./quest-transactions');

function createRolePermissions(places, tables) {
  var roles = ['Smith','Woodworker','Tailor','Enchanter','Cook','Alchemist'];
  var directions = ['buy','sell','supply'], compiled = new Map(), bindings = new Map();
  if (tables !== undefined) {
    if (!tables || typeof tables !== 'object' || Array.isArray(tables) ||
        Object.keys(tables).length !== roles.length || roles.some(function (role) {
          return !Object.prototype.hasOwnProperty.call(tables, role);
        })) throw new Error('The six merchant role tables are required.');
    roles.forEach(function (role) {
      var table = tables[role], copy = Object.create(null);
      if (!table || typeof table !== 'object' || Array.isArray(table) || Object.keys(table).length !== 3)
        throw new Error('Invalid merchant role table.');
      directions.forEach(function (direction) {
        var values = table[direction], ids = new Set();
        if (!Object.prototype.hasOwnProperty.call(table,direction) || !Array.isArray(values))
          throw new Error('Each role needs buy, sell and supply permissions.');
        for (var i=0;i<values.length;i++) {
          var id=values[i];
          if (!Number.isInteger(id) || id<=0 || id>=0xff000000 || id===GOLD_BASE || ids.has(id))
            throw new Error('Invalid or duplicate role item permission.');
          ids.add(id);
        }
        copy[direction]=ids;
      });
      copy.supply.forEach(function (id) {
        if (!copy.buy.has(id)) throw new Error('Role supplies must be permitted purchases.');
      });
      copy.role=role;
      compiled.set(role,copy);
    });
  }
  Object.keys(places).forEach(function (reference) {
    var place=places[reference], table=null;
    if (place && Object.prototype.hasOwnProperty.call(place,'role')) {
      table=compiled.get(place.role);
      if (!table) throw new Error('A merchant role requires its verified item tables.');
    }
    bindings.set(reference,table);
  });
  var permits = function (reference,direction,baseId) {
    if (!bindings.has(reference)) return false;
    var table=bindings.get(reference);
    return table===null || table[direction].has(baseId);
  };
  permits.roleOf=function (reference) {
    if (!bindings.has(reference)) return null;
    var table=bindings.get(reference);
    return table===null ? '' : table.role;
  };
  return permits;
}

function createNativeMerchantTransfer(mp) {
  return {
    available: function () {
      return !!mp && ['validateInventoryTransaction','compareAndSetInventory','getInventoryReceipt','getSavedInventoryReceipt',
        'getNpcAIState','getDescFromId','getIdFromDesc','get'].every(function (key) { return typeof mp[key] === 'function'; });
    },
    identity: function (id) {
      var ai = mp.getNpcAIState(id);
      if (!ai || !ai.isHuman || !Number.isInteger(ai.profileId) || ai.profileId <= 0) return null;
      return {desc:mp.getDescFromId(id),profileId:ai.profileId};
    },
    resolve: function (desc) { return mp.getIdFromDesc(desc); },
    inventory: function (id) { return mp.get(id, 'inventory'); },
    validate: function (snapshot) { return mp.validateInventoryTransaction(snapshot); },
    receipt: function (id) { return mp.getInventoryReceipt(id); },
    saved: function (id) { return mp.getSavedInventoryReceipt(id); },
    cas: function (id, expected, receipt, next, sequence, profile) {
      return mp.compareAndSetInventory(id, expected, receipt, next, sequence, profile);
    }
  };
}

function createMerchantTrading(deps) {
  var purses = deps.purses;
  var prices = deps.prices;
  var transfer = deps.transfer;
  var world = deps.world;
  // An entry the server made into something else on a plain record (a hair
  // dye on the Bowl, #2675) is neither counted nor taken as the plain item.
  var minted = typeof deps.minted === 'function' ? deps.minted : function () { return false; };
  var places = deps.places || {};
  var permits = createRolePermissions(places,deps.roleTables);
  var now = deps.now || function () { return Date.now(); };
  var reach = deps.reach == null ? REACH : deps.reach;
  var sessions = new Map();
  var viewOwners = new WeakMap();
  var sessionSerial = 0;
  var settlement = SETTLEMENT.createSettlement({purses:purses,transfer:transfer,world:deps.namespace || purses.namespace,log:deps.log,now:now});
  var retirementRequired=deps.retirementRequired===true;
  var active = deps.suspended !== true && !retirementRequired, closed = false;
  var commissions=COMMISSIONS.createCommissions({rows:deps.commissions||[],purses:purses,transfer:transfer,prices:prices,
    resolve:deps.resolve,eligible:deps.commissionEligible,settlement:settlement,addStock:addStock,now:now});

  function placeOf(reference) {
    return places[reference] || null;
  }

  function fail(text, view) {
    return { text: text, view: view || null };
  }

  function stockCopy(stock) { return JSON.parse(JSON.stringify(stock || [])); }
  function addStock(stock, entries, name) {
    entries.forEach(function (entry) {
      var key = SETTLEMENT.metadataKey(entry);
      var row = stock.find(function (held) {
        return held.name === name && SETTLEMENT.metadataKey(held.entry || {baseId:held.baseId,count:held.count}) === key;
      });
      if (row) {
        if (row.count + entry.count > MAX_GOLD) throw new Error('The shelf is full.');
        row.count += entry.count; row.entry = Object.assign({}, entry, {count:row.count});
      } else stock.push({baseId:entry.baseId,count:entry.count,name:name,entry:JSON.parse(JSON.stringify(entry))});
    });
    SETTLEMENT.inventory({entries:stock.map(function (row) { return row.entry || {baseId:row.baseId,count:row.count}; })});
    return stock;
  }
  function takeStock(stock, baseId, name, count) {
    var entries = [], left = count;
    for (var i = 0; i < stock.length && left > 0; i++) {
      var row = stock[i];
      if (row.baseId !== baseId || String(row.name || '').toLowerCase() !== name.toLowerCase()) continue;
      var n = Math.min(row.count, left);
      entries.push(Object.assign({}, row.entry || {baseId:row.baseId}, {count:n}));
      row.count -= n; left -= n;
      if (row.entry) row.entry.count = row.count;
    }
    if (left) throw new Error('The shelf is empty.');
    return {stock:stock.filter(function (row) { return row.count > 0; }),entries:entries};
  }

  function inReach(humanId, merchantId) {
    var human = world.actor(humanId);
    var merchant = world.actor(merchantId);
    if (!human || !merchant || !human.pos || !merchant.pos) {
      return { ok: false, reason: 'You are not close enough to trade.' };
    }
    if (human.isHuman !== true || !(human.profileId > 0)) {
      return { ok: false, reason: 'Only a person can trade.' };
    }
    if (merchant.isHuman || merchant.profileId > 0) {
      return { ok: false, reason: 'That is not a guild trader.' };
    }
    if (String(human.cell) !== String(merchant.cell) || human.cell == null || human.cell === '') {
      return { ok: false, reason: 'You are not close enough to trade.' };
    }
    var d = Math.hypot(
      human.pos[0] - merchant.pos[0],
      human.pos[1] - merchant.pos[1],
      human.pos[2] - merchant.pos[2]
    );
    if (!(d <= reach)) return { ok: false, reason: 'You are not close enough to trade.' };
    return { ok: true, distance: d, human: human };
  }

  function authed(profileId, human) {
    return Number(profileId) > 0 && Number(profileId) === Number(human.profileId);
  }

  function sessionIdentity(human) {
    if (!human || !human.isHuman || !Number.isSafeInteger(human.profileId) || human.profileId<=0 ||
        typeof human.desc!=='string' || !human.desc || !Number.isSafeInteger(human.lifeGeneration) || human.lifeGeneration<0 ||
        typeof human.runtimeIdentity!=='string' || !/^[1-9][0-9]{0,19}$/.test(human.runtimeIdentity) ||
        human.runtimeIdentity.length===20 && human.runtimeIdentity>'18446744073709551615') return null;
    return JSON.stringify([human.desc,human.profileId,human.lifeGeneration,human.runtimeIdentity]);
  }

  function questView(actorId,merchantId) {
    var quests=typeof deps.quests==='function' && deps.quests();
    return (quests ? quests.describe(actorId,merchantId) : []).concat(commissions.view(actorId,merchantId));
  }

  // A supply wait is keyed by the character's runtime form id (#2870), the
  // one shape every register keeps, never by its formDesc. A human whose
  // formDesc is not a runtime form has no key and cannot supply.
  function supplyKey(human, itemName) {
    var id = COMMISSION_STATE.formIdOf(human && human.desc);
    return id ? JSON.stringify([id, human.profileId, itemName.toLowerCase()]) : '';
  }
  function lastSupply(state, key, itemName) {
    var stamps = state.supply || {};
    // Old item-only stamps cannot be assigned to a character. Keep their
    // original window rather than resetting an unidentified completed supply.
    return Math.max(stamps[key] || 0, stamps[itemName.toLowerCase()] || 0);
  }

  function sessionCurrent(actorId, profileId, session) {
    return active && sessions.get(profileId)===session && !!session && session.actorId===actorId;
  }

  function ownsSession(actorId, profileId, session) {
    var identity = sessionIdentity(world.actor(actorId));
    return sessionCurrent(actorId,profileId,session) && identity === session.identity;
  }

  function closedView(actorId, profileId, session) {
    if (!session) return null;
    if (sessions.get(profileId)===session) sessions.delete(profileId);
    var view={open:false};
    viewOwners.set(view,{actorId:actorId,profileId:profileId,session:undefined,identity:session.identity});
    return view;
  }

  function matchesViewOwner(actorId, view) {
    var owner=view && viewOwners.get(view);
    return active && (!owner || owner.actorId===actorId && sessions.get(owner.profileId)===owner.session);
  }

  function isCurrentView(actorId, view) {
    var owner = view && viewOwners.get(view);
    // Legacy callers can publish their own notices. Controller-produced views
    // retain their owner until the actual property write, including closures.
    if (!owner) return active;
    if (owner.actorId !== actorId) return false;
    if (view.open === false) {
      var identity=sessionIdentity(world.actor(actorId));
      return matchesViewOwner(actorId,view) && identity===owner.identity;
    }
    return ownsSession(actorId, owner.profileId, owner.session);
  }

  function viewFor(merchantId, state, place, actorId, profileId, note, owner) {
    var viewSession = owner ? owner.session : sessions.get(profileId);
    var viewIdentity = owner ? owner.identity : (viewSession && viewSession.identity);
    var catalog = prices.catalog ? prices.catalog(place.bookHold) : [];
    var offers = [], supplyIds = [], availablePurse=COMMISSION_STATE.spendable(state);
    var counts = Object.create(null), packReady = true;
    if (settlement.available()) {
      try {
        SETTLEMENT.inventory(transfer.inventory(actorId)).entries.forEach(function (entry) {
          if (minted(entry)) return;
          counts[entry.baseId] = (counts[entry.baseId] || 0) + entry.count;
        });
      } catch (error) { packReady = false; }
    }
    var canTrade = packReady && !state.pending && settlement.canInventoryMutation(actorId);
    var quotedBuy = false, carriedBuy = false, seen = Object.create(null);
    for (var i = 0; i < catalog.length; i++) {
      var row = catalog[i];
      var resolved = deps.resolve ? deps.resolve(row.name) : null;
      if (!resolved || resolved.error || !resolved.baseId || resolved.baseId === GOLD_BASE) continue;
      var accepts = permits(state.reference,'buy',resolved.baseId);
      var sells = permits(state.reference,'sell',resolved.baseId);
      if (!accepts && !sells) continue;
      var name = row.name, key = String(resolved.name || name).toLowerCase();
      var priceKey = String(name).toLowerCase();
      if (seen[priceKey]) continue;
      seen[priceKey] = true;
      // Price books key their submitted labels. The resolved canonical name
      // identifies inventory and shelf goods, not a different price row.
      var price = prices.quote(place.bookHold, name) || {buy:null,sell:null};
      var buy = accepts && Number.isInteger(price.buy) && price.buy >= 0 && price.buy <= MAX_GOLD ? price.buy : null;
      var sell = sells && Number.isInteger(price.sell) && price.sell >= 0 && price.sell <= MAX_GOLD ? price.sell : null;
      var carried = counts[resolved.baseId] || 0;
      if (buy !== null) quotedBuy = true;
      if (buy !== null && carried > 0) carriedBuy = true;
      var held = (state.stock || []).find(function (entry) {
        return entry.baseId === resolved.baseId && String(entry.name || '').toLowerCase() === key;
      });
      var count = 0;
      var stock = state.stock || [];
      for (var s = 0; s < stock.length; s++) {
        if (stock[s].baseId === resolved.baseId && String(stock[s].name || '').toLowerCase() === key) count += stock[s].count;
      }
      offers.push({
        name: name,
        canonicalName: resolved.name || name,
        buy: buy,
        sell: sell,
        carried: carried,
        maxSell: canTrade && buy !== null ? Math.min(carried, MAX_COUNT, buy === 0 ? MAX_COUNT : Math.floor(availablePurse / buy)) : 0,
        stock: count,
        baseId: held ? held.baseId : null
      });
      supplyIds.push(resolved.baseId);
    }
    var supply = [];
    var human = settlement.available() ? transfer.identity(actorId) : null;
    var owns = human && COMMISSION_STATE.formIdOf(human.desc) && human.profileId === profileId;
    var at = now();
    for (var k = 0; k < offers.length; k++) {
      if (offers[k].buy == null || !permits(state.reference,'supply',supplyIds[k])) continue;
      var pay = offers[k].buy * SUPPLY_COUNT;
      var last = owns ? lastSupply(state, supplyKey(human, offers[k].canonicalName), offers[k].canonicalName) : 0;
      var ready = !!owns && canTrade && availablePurse >= pay && (!last || at - last >= SUPPLY_WAIT);
      supply.push({ name: offers[k].name, pay: pay, unit: offers[k].buy, count: SUPPLY_COUNT, ready: ready });
    }
    var view = {
      open: true,
      transfer: settlement.available(),
      canTrade: canTrade,
      trader: place.name || 'Trader',
      place: place.locationName || '',
      hold: place.bookHold,
      purse: state.purse,
      reservedPurse:state.purse-availablePurse,
      offers: offers,
      sellReason: offers.some(function (offer) { return offer.maxSell > 0; }) ? '' :
        !settlement.available() ? 'Trading is unavailable. Nothing has moved.' :
        !packReady ? 'Your pack could not be read. Nothing has moved.' :
        state.pending ? 'This trader is finishing another trade.' :
        !canTrade ? 'Your inventory is waiting for its saved trade.' :
        !quotedBuy ? 'This trader has no submitted buy prices.' :
        !carriedBuy ? 'You are not carrying anything this trader buys.' :
        'This trader cannot afford the goods you are carrying.',
      supply: supply,
      quests: questView(actorId,merchantId),
      note: note || (settlement.available()
        ? ''
        : 'Buying and selling wait on the native transfer. Nothing has moved.')
    };
    var currentIdentity = viewIdentity ? sessionIdentity(world.actor(actorId)) : null;
    if (!active || sessions.get(profileId) !== viewSession || viewIdentity && currentIdentity !== viewIdentity) return null;
    if (viewSession && viewSession.actorId===actorId) view.sessionId=viewSession.id;
    viewOwners.set(view,{actorId:actorId,profileId:profileId,session:viewSession});
    return view;
  }

  function viewKey(view) {
    var copy = Object.assign({}, view);
    delete copy.at;
    delete copy.note;
    return JSON.stringify(copy);
  }

  function recover() {
    if (!active) return [];
    settlement.tick();
    var views = [];
    Array.from(sessions.entries()).forEach(function (entry) {
      var profileId=entry[0],session=entry[1];
      if (!active || sessions.get(profileId)!==session) return;
      var reached=inReach(session.actorId,session.merchantId);
      if (!active || sessions.get(profileId)!==session) return;
      if (!reached.ok || !authed(profileId,reached.human) || sessionIdentity(reached.human)!==session.identity) {
        sessions.delete(profileId);
        var closed=closedView(session.actorId,profileId,session);
        views.push({actorId:session.actorId,view:closed}); return;
      }
      var state = purses.read(session.merchantId), place = state && placeOf(state.reference);
      if (state && place) {
        var view=viewFor(session.merchantId,state,place,session.actorId,profileId,session.note,{session:session,identity:session.identity});
        var current = sessionIdentity(world.actor(session.actorId));
        if (!active || sessions.get(profileId) !== session) return;
        if (current !== session.identity) {
          sessions.delete(profileId);
          var closed=closedView(session.actorId,profileId,session);
          views.push({actorId:session.actorId,view:closed}); return;
        }
        if (!view) return;
        if (session.view === viewKey(view)) return;
        views.push({actorId:session.actorId,view:view});
      }
    });
    return views.filter(function(result){return isCurrentView(result.actorId,result.view);})
      .filter(function(result){return matchesViewOwner(result.actorId,result.view);});
  }

  function sessionMerchant(profileId) {
    var session = sessions.get(Number(profileId));
    return session ? session.merchantId : 0;
  }

  function command(ctx) {
    if (!active) return fail('Trading is unavailable.');
    var parts = (ctx && ctx.parts) || [];
    var profileId = Number(ctx && ctx.profileId) || 0;
    var actorId = ctx && ctx.actorId;
    var verb = String(parts[1] || '').toLowerCase();
    if (!profileId || !actorId) return fail('You are not in the world yet.');
    var requestSession = sessions.get(profileId);
    if (verb === 'join' || verb === 'dues' || verb === 'fee') {
      return fail('People cannot join the Merchant\'s Guild.');
    }
    if (verb === 'scene') {
      return fail('Scene quests are not paid from a trader\'s purse.');
    }
    if (verb === 'e') {
      var pressed = parseInt(String(parts[2] || ''), 16);
      if (!pressed || (typeof deps.isTrader === 'function' && !deps.isTrader(pressed))) {
        return { text: '', view: null };
      }
      if (!active || sessions.get(profileId)!==requestSession) return {text:'',view:null};
      return command({ actorId: actorId, profileId: profileId, parts: ['/merchant', pressed.toString(16)] });
    }
    if (verb === 'close') {
      sessions.delete(profileId);
      return { text: 'You step back from the trader.', view: closedView(actorId,profileId,requestSession) };
    }
    if (verb === 'refresh') {
      var openId = sessionMerchant(profileId);
      if (!openId) return fail('You are not at a trader.');
      return command({ actorId: actorId, profileId: profileId, parts: ['/merchant', openId.toString(16)] });
    }

    var merchantId = 0;
    if (!verb || verb === 'open' || /^[0-9a-f]+$/i.test(verb)) {
      var token = verb === 'open' ? parts[2] : (verb || '');
      if (!token) return fail('Press E on a guild trader.');
      merchantId = parseInt(token, 16);
      if (!merchantId) return fail('That is not a guild trader.');
      var prior = requestSession;
      var reached = inReach(actorId, merchantId);
      if (!active || sessions.get(profileId)!==prior) return fail('This character is unavailable.');
      if (!reached.ok) return fail(reached.reason, closedView(actorId,profileId,prior));
      if (!authed(profileId, reached.human)) return fail('That request is not yours.');
      var identity=sessionIdentity(reached.human);
      if (!identity) return fail('This character is unavailable.', closedView(actorId,profileId,prior));
      var state = purses.prepare(merchantId);
      if (!active || sessions.get(profileId)!==prior) return fail('This character is unavailable.');
      if (!state) return fail('That is not a guild trader.');
      var place = placeOf(state.reference);
      if (!place || !place.bookHold) {
        return fail('This trader has no hold price list.', closedView(actorId,profileId,prior));
      }
      var repeat = prior && prior.merchantId === merchantId && (now() - prior.at) < 3000;
      var opened = viewFor(merchantId, state, place, actorId, profileId,undefined,{session:prior,identity:identity});
      if (!opened) return {text:'',view:null};
      opened.sessionId=identity+':'+now()+':'+(++sessionSerial);
      var nextSession={ id:opened.sessionId, merchantId: merchantId, actorId:actorId, identity:identity, quests:JSON.stringify(opened.quests), view:viewKey(opened), at: now() };
      var current = sessionIdentity(world.actor(actorId));
      if (!active || sessions.get(profileId) !== prior || current !== identity) return {text:'',view:null};
      sessions.set(profileId,nextSession);
      viewOwners.set(opened,{actorId:actorId,profileId:profileId,session:nextSession});
      return {
        text: repeat ? '' : (opened.transfer
          ? ('Trading with ' + opened.trader + ' in ' + opened.place + '. Purse ' + opened.purse + '.')
          : ('The list for ' + opened.trader + ' is open. ' + opened.note)),
        view: opened
      };
    }

    merchantId = sessionMerchant(profileId);
    if (!merchantId) return fail('Press E on a guild trader.');
    if (sessions.get(profileId).actorId !== actorId) {
      sessions.delete(profileId);
      return fail('Press E on a guild trader with this character.', closedView(actorId,profileId,requestSession));
    }
    var originalSession = sessions.get(profileId), quests, heldQuest;
    function refuseSession(text) {
      if (sessions.get(profileId)!==originalSession) return fail(text);
      sessions.delete(profileId);
      return fail(text, closedView(actorId,profileId,originalSession));
    }
    if (verb === 'quest' && !commissions.has(String(parts[3]))) {
      quests = typeof deps.quests==='function' && deps.quests();
      if (!quests || typeof quests.capture!=='function') return fail('Quest work is unavailable.');
      heldQuest = quests.capture(actorId);
      if (!heldQuest) return fail('Quest work is unavailable.');
    }
    var again = inReach(actorId, merchantId);
    if (!again.ok) {
      return refuseSession(again.reason);
    }
    if (!authed(profileId, again.human)) return fail('That request is not yours.');
    var reachedIdentity=sessionIdentity(again.human);
    var currentIdentity=sessionIdentity(world.actor(actorId));
    if (!active || sessions.get(profileId)!==originalSession ||
        reachedIdentity!==originalSession.identity || currentIdentity!==originalSession.identity) {
      return refuseSession('Press E on a guild trader with this character.');
    }
    if (verb === 'quest') {
      if (parts.length<4 || parts.length>5) return fail('Choose the work in the trader panel.');
      var isCommission=commissions.has(String(parts[3]));
      var result=isCommission?commissions.act(actorId,merchantId,String(parts[2]),String(parts[3]),parts[4],{
        current:function(){return ownsSession(actorId,profileId,originalSession);},
        alive:function(){return sessionCurrent(actorId,profileId,originalSession);}}):
        quests.act(actorId,String(parts[2]),String(parts[3]),parts[4],merchantId,heldQuest,
          function(){return sessionCurrent(actorId,profileId,originalSession);});
      var reasons={class:'This work takes a different class.',rank:'This work takes a higher rank.',
        eligibility:'You do not meet this work\'s class or profession requirements.',
        cooldown:'This work is still resting.',open:'You already hold this work.',gem:'Choose a gem first.',
        short:'You have not drawn enough to turn this work in.',none:'You do not hold this work.',
        unbound:'This work has no appointed place yet.',unwritten:'The work could not be committed just now.',
        unavailable:'Quest work is unavailable.',role:'This trader does not handle that work.',
        allowance:'Your new scene work has reached its shared daily gold allowance.',
        price:'The submitted price changed or is missing. Choose the work again.',
        purse:'This trader cannot reserve the quoted payment.',capacity:'This trader cannot accept more work yet.',
        counter:'This trader cannot accept more work yet.',waiting:'The transfer is waiting for its saved inventory.',
        'open-limit':'Finish or leave one of your three open jobs of this kind first.',
        recovery:'This work needs its saved payment checked. You can leave it without payment, or ask staff for recovery.',
        session:'Choose the work again from the trader.'};
      var text=result.ok ? (parts[2]==='take'?'You take the work.':parts[2]==='return'?'The work is turned in.':isCommission?'You leave the work without payment.':'You give back what you drew and leave the work.') :
        reasons[result.why] || 'The work could not be changed.';
      if (!ownsSession(actorId,profileId,originalSession)) return {text:'',view:null};
      var questState=purses.prepare(merchantId),questPlace=questState && placeOf(questState.reference);
      var questResponse=questState && questPlace ? viewFor(merchantId,questState,questPlace,actorId,profileId,text,{session:originalSession,identity:originalSession.identity}) : closedView(actorId,profileId,originalSession);
      return questResponse && isCurrentView(actorId,questResponse) ? fail(text,questResponse) : {text:'',view:null};
    }
    if (verb === 'buy' || verb === 'sell' || verb === 'supply') {
      return trade(actorId, profileId, merchantId, verb, parts.slice(2), originalSession);
    }
    return fail('Use the trader panel to buy, sell, or turn in supplies.');
  }

  function parseCountAndName(bits, fixedCount) {
    if (fixedCount) return parseCountAndName([String(fixedCount)].concat(bits),0);
    if (!bits.length) return null;
    var count = Number(bits[0]);
    if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
    var quoted = /^@[0-9]+$/.test(String(bits[1] || ''));
    var unit = quoted ? Number(bits[1].slice(1)) : null;
    if (quoted && (!Number.isInteger(unit) || unit < 0 || unit > MAX_GOLD)) return null;
    return { count: count, name: bits.slice(quoted ? 2 : 1).join(' ').trim(), quoted:quoted, unit:unit };
  }

  function trade(actorId, profileId, merchantId, verb, bits, originalSession) {
    function responseView(state,note) {
      return viewFor(merchantId,state,place,actorId,profileId,note,{session:originalSession,identity:originalSession.identity});
    }
    function response(text,state,note) {
      var view=responseView(state,note);
      return view && isCurrentView(actorId,view) ? fail(text,view) : {text:'',view:null};
    }
    var state = purses.prepare(merchantId);
    if (!state) return fail('That is not a guild trader.');
    if (state.pending) return fail('This trader has a transfer waiting.');
    var place = placeOf(state.reference);
    if (!place || !place.bookHold) return fail('This trader has no hold price list.');
    var asked = parseCountAndName(bits, verb === 'supply' ? SUPPLY_COUNT : 0);
    if (!asked || !asked.name) return fail('Name the count, then the item.');
    var resolved = deps.resolve ? deps.resolve(asked.name) : null;
    if (!resolved || resolved.error || !resolved.baseId || resolved.baseId === GOLD_BASE) {
      return fail((resolved && resolved.error) || 'That item is not known.');
    }
    var itemName = resolved.name || asked.name;
    var direction = verb==='buy' ? 'sell' : verb==='sell' ? 'buy' : 'supply';
    if (!permits(state.reference,direction,resolved.baseId))
      return fail('This trader does not '+(verb==='buy'?'sell':verb==='sell'?'buy':'request')+' that item.');
    var price = prices.quote(place.bookHold, asked.name) || { buy: null, sell: null };
    var unit = verb === 'buy' ? price.sell : price.buy;
    if (unit == null) {
      return fail(verb === 'buy' ? 'No trader sells that.' : 'No trader buys that.');
    }
    if (!Number.isInteger(unit) || unit < 0 || unit > MAX_GOLD) return fail('That price cannot be verified.');
    if (asked.quoted && asked.unit !== unit) {
      var changedPrice = 'The price changed. Check the new quote before trading.';
      return response(changedPrice,state,changedPrice);
    }
    var gold = unit * asked.count;
    if (!Number.isInteger(gold) || gold < 0 || gold > MAX_GOLD) return fail('That price cannot be verified.');
    var npcBuys = verb !== 'buy';
    var completedSupplyKey = null;
    if (verb === 'supply') {
      if (!settlement.available()) return response('Buying and selling wait on the native transfer. Nothing was taken.',state);
      var human = transfer.identity(actorId);
      if (!human || !COMMISSION_STATE.formIdOf(human.desc) || human.profileId !== profileId) return fail('That request is not yours.');
      completedSupplyKey = supplyKey(human, itemName);
      var last = lastSupply(state, completedSupplyKey, itemName);
      if (last && now() - last < SUPPLY_WAIT) return fail('That supply is not due.');
    }
    if (npcBuys && COMMISSION_STATE.spendable(state) < gold) return fail('The trader cannot pay from its unreserved purse.');
    if (!npcBuys && gold > 0 && world.carry(actorId, GOLD_BASE) < gold) return fail('You cannot pay.');
    if (npcBuys && world.carry(actorId, resolved.baseId) < asked.count) return fail('You are not carrying that.');
    if (!settlement.available()) {
      return response('Buying and selling wait on the native transfer. Nothing was taken.',state);
    }
    var nextPurse = npcBuys ? state.purse - gold : state.purse + gold;
    if (nextPurse < 0 || nextPurse > MAX_GOLD) return fail('That price cannot be verified.');
    var moved;
    try {
      if (!ownsSession(actorId,profileId,originalSession)) return fail('The offer changed. Choose the trade again.');
      // Capture every trade's authenticated native character before a save
      // can publish a projection or reenter another request.
      var tradingHuman = transfer.identity(actorId);
      if (!tradingHuman || tradingHuman.profileId !== profileId) return fail('That request is not yours.');
      if (!ownsSession(actorId,profileId,originalSession)) return {text:'',view:null};
      try {
        state = settlement.pruneSupplyHistory(merchantId, state, SUPPLY_WAIT);
      } catch (error) {
        active = false; sessions.clear(); settlement.shutdown();
        throw error;
      }
      if (!state || !active) return fail('The offer changed. Choose the trade again.');
      var currentHuman = transfer.identity(actorId);
      if (!currentHuman || currentHuman.desc !== tradingHuman.desc || currentHuman.profileId !== tradingHuman.profileId)
        return fail('That request is not yours.');
      var expected = SETTLEMENT.inventory(transfer.inventory(actorId));
      var outgoing = SETTLEMENT.takeEntries(expected, npcBuys ? resolved.baseId : GOLD_BASE, npcBuys ? asked.count : gold, minted);
      var stock = stockCopy(state.stock), credit;
      if (npcBuys) {
        stock = addStock(stock, outgoing.entries, itemName);
        credit = gold > 0 ? [{baseId:GOLD_BASE,count:gold}] : [];
      } else {
        var picked = takeStock(stock, resolved.baseId, itemName, asked.count);
        stock = picked.stock; credit = picked.entries;
      }
      var nextSupply = JSON.parse(JSON.stringify(state.supply || {}));
      if (verb === 'supply') nextSupply[completedSupplyKey] = now();
      if (!ownsSession(actorId,profileId,originalSession)) return fail('The offer changed. Choose the trade again.');
      moved = settlement.begin({merchantId:merchantId,humanId:actorId,profileId:profileId,
        caller:function(){return ownsSession(actorId,profileId,originalSession);},
        previous:state,expected:expected,debit:outgoing.inventory,credit:credit,kind:verb,
        next:Object.assign({purse:nextPurse,stock:stock,supply:nextSupply},
          state.commissions===undefined?{}:{commissions:JSON.parse(JSON.stringify(state.commissions))})});
    } catch (error) {
      return fail(settlement.available() ? String(error.message || error) : 'Trading is unavailable. The saved transfer is retained.');
    }
    var current = purses.prepare(merchantId);
    if (!moved.done) return response(moved.reason,current,moved.reason);
    // The pieces that changed hands, for staff's hold economy page (#3164).
    if (typeof deps.traded === 'function') {
      try { deps.traded({hold:place.bookHold,verb:verb,baseId:resolved.baseId,name:itemName,count:asked.count}); }
      catch (error) { if (typeof deps.log === 'function') deps.log('hold economy count failed: ' + error); }
    }
    var said = npcBuys
      ? ('Sold ' + asked.count + ' ' + itemName + ' for ' + gold + '. Purse ' + current.purse + '.')
      : ('Bought ' + asked.count + ' ' + itemName + ' for ' + gold + '. Purse ' + current.purse + '.');
    return response(said,current);
  }

  function activate(actorId, merchantId) {
    if (!active) return fail('Trading is unavailable.');
    if (typeof deps.isTrader === 'function' && !deps.isTrader(merchantId)) return null;
    var human = world.actor(actorId);
    var profileId = human && Number(human.profileId) || 0;
    return command({
      actorId: actorId,
      profileId: profileId,
      parts: ['/merchant', (Number(merchantId) >>> 0).toString(16)]
    });
  }

  return {
    isCurrentView:isCurrentView,
    acknowledgeView: function(actorId,view) {
      sessions.forEach(function(session){
        if(session.actorId===actorId && session.id===view.sessionId) {
          session.quests=JSON.stringify(view.quests);
          session.view=viewKey(view);
          session.note=view.note;
        }
      });
    },
    command: command,
    activate: activate,
    recover: recover,
    retirementReady: function () {
      var ready=!closed && settlement.canRetire();
      return !closed && ready;
    },
    start: function () {
      if(!settlement.available() || closed) throw new Error('Trading is unavailable.');
      if(retirementRequired && !settlement.canRetire()) throw new Error('Legacy work blocks roster activation.');
      if(!settlement.available() || closed) throw new Error('Trading is unavailable.');
      active=true;
      return true;
    },
    nativeReady: function () { return settlement.available(); },
    withQuestInventoryMutation: function(actorId,change) {return active ? settlement.withInventoryMutation(actorId,change) : {ok:false,why:'unavailable'};},
    questReady: function(actorId) {return active && settlement.canInventoryMutation(actorId);},
    questAdmission: function(actorId,merchantId) {
      if (!active) return null;
      // Capture before actor lookup: native callbacks must not supply a new conversation.
      var session=null,profileId;
      sessions.forEach(function(current,key) {
        if(current.actorId===actorId){session=current;profileId=key;}
      });
      if (!session || session.merchantId!==merchantId || !ownsSession(actorId,profileId,session)) return null;
      // The final transaction admission check must not invoke native callbacks.
      // Actor identity remains fenced by the quest transaction's native CAS.
      return function(){return sessionCurrent(actorId,profileId,session);};
    },
    questRole: function(merchantId) {
      if (!active) return null;
      var state=purses.read(merchantId);
      return active && state ? permits.roleOf(state.reference) : null;
    },
    questHold: function(merchantId) {
      var state=active && purses.read(merchantId),place=state && placeOf(state.reference);
      return place && place.hold || '';
    },
    shutdown: function () { active=false; closed=true; sessions.clear(); settlement.shutdown(); },
    REACH: REACH,
    SUPPLY_COUNT: SUPPLY_COUNT,
    bookHoldOf: bookHoldOf
  };
}

function installMerchantTrading(env) {
  var mp = env.mp;
  var g = env.g || globalThis;
  var log = env.log || function () {};
  var fs = require('fs');
  var path = require('path');
  var root = typeof __dirname === 'string' ? __dirname : path.dirname(__filename);
  var file = path.join(root, 'data', 'merchant-traders.json');
  var doc = env.catalog || JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  var traderIds = new Set();
  if (doc.byRef) {
    Object.keys(doc.byRef).forEach(function (ref) {
      try {
        var found = mp.getIdFromDesc(ref);
        if (found) traderIds.add(Number(found) >>> 0);
      } catch (e) {}
    });
  }
  var minted = typeof env.minted === 'function' ? env.minted : function () { return false; };
  var trading = createMerchantTrading({
    purses: env.purses,
    minted: minted,
    log:log,
    prices: {
      quote: function (hold, item) {
        var books = g.__thornswoodBooks;
        if (!books || typeof books.guildPrice !== 'function') return { buy: null, sell: null };
        return books.guildPrice(hold, item);
      },
      catalog: function (hold) {
        var books = g.__thornswoodBooks;
        if (!books || typeof books.catalog !== 'function') return [];
        return books.catalog(hold);
      }
    },
    transfer: createNativeMerchantTransfer(mp),
    world: {
      actor: function (id) {
        var ai = null;
        try { ai = mp.getNpcAIState(id); } catch (e) { ai = null; }
        var pos = ai && Array.isArray(ai.pos) ? ai.pos.slice(0, 3) : null;
        var cell = ai ? (ai.cellOrWorld || ai.cell || null) : null;
        try {
          var p = mp.get(id, 'pos');
          if (Array.isArray(p) && p.length >= 3 && p.slice(0, 3).every(function (n) { return Number.isFinite(n); })) {
            pos = p.slice(0, 3);
          }
        } catch (e2) {}
        try {
          var c = mp.get(id, 'worldOrCellDesc');
          if (c) cell = c;
        } catch (e3) {}
        return {
          pos: pos,
          cell: cell,
          desc: mp.getDescFromId(id),
          lifeGeneration: ai && ai.lifeGeneration,
          runtimeIdentity: mp.getActorRuntimeIdentity(id),
          profileId: ai && ai.profileId || 0,
          isHuman: !!(ai && ai.isHuman)
        };
      },
      carry: function (id, baseId) {
        var inv = null;
        try { inv = mp.get(id, 'inventory'); } catch (e) { return 0; }
        var entries = (inv && inv.entries) || [];
        var n = 0;
        for (var i = 0; i < entries.length; i++) {
          if (entries[i] && Number(entries[i].baseId) === Number(baseId) && !minted(entries[i])) n += Number(entries[i].count) || 0;
        }
        return n;
      }
    },
    places: doc.byRef || {},
    roleTables: env.roleTables,
    commissions: env.commissions,
    commissionEligible:function(actor,gate) {
      var progression=g.__thornswoodProgression,character=g.__thornswoodCharacter;
      if(!progression||!character||!character.PROPERTY)return false;
      try {
        var rule=QUEST_ELIGIBILITY.createQuestEligibility({table:progression.TABLE,spellIds:progression.SPELL_IDS});
        var allowed=rule.allows(rule.validate(gate),mp.get(actor,character.PROPERTY));
        return allowed&&g.__thornswoodProgression===progression&&g.__thornswoodCharacter===character;
      }catch(error){return false;}
    },
    suspended: env.suspended,
    retirementRequired: env.retirementRequired,
    quests: function () { return g.__thornswoodQuests; },
    resolve: function (name) {
      var fn = g.__thornswoodResolveItem;
      if (typeof fn !== 'function') return null;
      return fn(name);
    },
    isTrader: function (id) { return traderIds.has(Number(id) >>> 0); },
    traded: function (row) {
      var economy = g.__thornswoodEconomy;
      if (economy && typeof economy.traded === 'function') economy.traded(row);
    }
  });
  var property = 'thornswoodMerchantView';
  var script = [
    '(function(){',
    '  try {',
    '    var v = ctx.value;',
    '    if (!v || typeof v !== "object") { return; }',
    '    var st = ctx.state;',
    '    if (!st) { return; }',
    '    if (st.thornswoodMerchantAt === v.at) { return; }',
    '    st.thornswoodMerchantAt = v.at;',
    '    var body = JSON.stringify(v);',
    '    var src = "(function(){try{" +',
    '      "var d=" + body + ";window.thornswoodMerchantView=d;" +',
    '      "if(window.thornswoodMerchant&&window.thornswoodMerchant.setData){window.thornswoodMerchant.setData(d);}" +',
    '      "}catch(e){}})();";',
    '    try { ctx.sp.browser.executeJavaScript(src); } catch (e) { }',
    '  } catch (e) { }',
    '})();'
  ].join('\n');
  mp.makeProperty(property, {
      isVisibleByOwner: true, isVisibleByNeighbors: false,
      updateOwner: script, updateNeighbor: ''
  });
  trading.push = function (actorId, view) {
    var payload = JSON.parse(JSON.stringify(view || { open: false }));
    payload.at = Date.now();
    if (!trading.isCurrentView(actorId,view)) return;
    try { mp.set(actorId, property, payload); }
    catch (e) { trading.shutdown(); log('merchant panel publication failed; controller revoked: ' + e); throw e; }
    trading.acknowledgeView(actorId,payload);
  };
  var timers=env.timers || (typeof setTimeout === 'function' && typeof clearTimeout === 'function' ? {setTimeout:setTimeout,clearTimeout:clearTimeout} : null);
  var alive=true, timer=null, started=false;
  var stop=trading.shutdown;
  trading.shutdown=function () {
    alive=false;
    var ownedTimer=timer;
    timer=null;
    // Revoke authority before cancellation can call back or throw.
    try {stop();}
    finally {if(ownedTimer!==null && timers) timers.clearTimeout(ownedTimer);}
  };
  function scheduleAdvance() {
    if(!alive || !timers || timer!==null) return;
    try {
      timer=timers.setTimeout(function () {timer=null;if(alive && started) advance();},1000);
    } catch(error) {trading.shutdown();throw error;}
  }
  function advance() {
    if(!alive) return;
    try { trading.recover().forEach(function (result) {if(alive) trading.push(result.actorId,result.view);}); }
    catch(error) {log('merchant recover: '+error);}
    // This checks exact save acknowledgements, never elapsed-time settlement.
    if(alive && trading.nativeReady()) scheduleAdvance();
  }
  var start=trading.start;
  trading.start=function () {
    if(!alive) throw new Error('Trading is unavailable.');
    start();
    if(!alive) throw new Error('Trading is unavailable.');
    if(!started) {started=true;advance();}
    if(!alive || !trading.nativeReady()) throw new Error('Trading is unavailable.');
    return true;
  };
  if(trading.nativeReady()) {
    if(env.suspended===true || env.retirementRequired===true) scheduleAdvance();
    else trading.start();
  }
  return trading;
}

module.exports = {
  createMerchantTrading: createMerchantTrading,
  createNativeMerchantTransfer: createNativeMerchantTransfer,
  createQuestTransactions: QUEST_TRANSFER.createQuestTransactions,
  actorIdentity: QUEST_TRANSFER.actorIdentity,
  targetIdentity: QUEST_TRANSFER.targetIdentity,
  installMerchantTrading: installMerchantTrading,
  bookHoldOf: bookHoldOf,
  guildSite: guildSite,
  GUILD_SITES: GUILD_SITES,
  BOOK_HOLD: BOOK_HOLD,
  GOLD_BASE: GOLD_BASE,
  REACH: REACH,
  SUPPLY_COUNT: SUPPLY_COUNT
};
const install = module.exports.installMerchantTrading;
module.exports.installMerchantTrading = function (env) {
  return install(Object.assign({ catalog: table('MERCHANT_TRADERS') }, env));
};
module.exports.prepareRoles = function (population, mp) {
  const native=MERCHANT_NATIVE.createLedgerNativeValidators(mp);
  const prepared=MERCHANT_ROLES.prepareMerchantRoleStage(population, table('MERCHANT_TRADERS'), table('MERCHANT_STAGE'), native);
  prepared.commissions=MERCHANT_COMMISSIONS.prepareCommissions(table('MERCHANT_COMMISSION_ROWS'),prepared.catalog,native);
  return prepared;
};
module.exports.createQuestFishingSources = QUEST_FISHING_SOURCES.createQuestFishingSources;
module.exports.createQuestHarvestSources = QUEST_FISHING_SOURCES.createQuestHarvestSources;
module.exports.createQuestGeodeSources = QUEST_FISHING_SOURCES.createQuestGeodeSources;
module.exports.createQuestLongfinSources = QUEST_FISHING_SOURCES.createQuestLongfinSources;
module.exports.createQuestRetrievalSources = QUEST_FISHING_SOURCES.createQuestRetrievalSources;
module.exports.createQuestItemPolicy = QUEST_ITEMS.createQuestItemPolicy;
module.exports.createQuestMammothSources = QUEST_MAMMOTH_SOURCES.createQuestMammothSources;
module.exports.orchardPlots = ORCHARD_PLOTS;
module.exports.orchardSources = function () { return table('MERCHANT_ORCHARD'); };
module.exports.createQuestOrchardSources = QUEST_FISHING_SOURCES.createQuestOrchardSources;
module.exports.huntBundles = QUEST_HUNT_BUNDLES;
module.exports.retrievalSources = function () { return table('MERCHANT_RETRIEVALS'); };
module.exports.scarceLongfin = function () { return table('MERCHANT_SCARCE_LONGFIN'); };
module.exports.scarceGeodes = function () { return table('MERCHANT_SCARCE_GEODES'); };
module.exports.scarceHarvest = function () { return table('MERCHANT_SCARCE_HARVEST'); };
module.exports.scarceFishing = function () { return table('MERCHANT_SCARCE_FISHING'); };
module.exports.createKillContracts = KILL_CONTRACTS.createKillContracts;
module.exports.sceneBudget = SCENE_BUDGET;
module.exports.expandedScenes = function () { return table('MERCHANT_KILL_SCENES'); };
module.exports.commissionRows = function () { return table('MERCHANT_COMMISSION_ROWS'); };
module.exports.createQuestEligibility = QUEST_ELIGIBILITY.createQuestEligibility;
return module.exports;
})();
// MERCHANT TRADING BUNDLE END

var QUEST_ITEM_POLICY=MERCHANT_TRADING.createQuestItemPolicy(mp);
function questItemBlocked(baseId) {
  return !QUEST_ITEM_POLICY || QUEST_ITEM_POLICY.blocked(baseId);
}

