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
          // A metadata save that threw can still have written: the record
          // read back says which (#4524). The new record is a save, the old
          // one a refusal; only anything else, or no answer, is unknown.
          try {
            var record=mp.get(actor,property);
            if(identity(actor)===token) {
              if(same(record,nextRecord))return {ok:true};
              if(same(record==null?null:record,expectedRecord==null?null:expectedRecord)) {
                report('quest metadata refused: ',error);
                return {ok:false,why:'unwritten'};
              }
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
