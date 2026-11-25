// Self-only person teleport for Playtesters on Dev and Main (#6757).
(function () {
  'use strict';
  var g=globalThis,USAGE='Usage: /tpto <person>.';
  function place(actor) {
    var desc=mp.get(actor,'worldOrCellDesc'),pos=mp.get(actor,'pos'),rot=mp.get(actor,'angle');
    function vector(value){return Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);}
    if(typeof desc!=='string'||!desc||!vector(pos)||!vector(rot)){throw new Error('Authoritative location is unavailable.');}
    return {desc:desc,pos:pos.slice(),rot:rot.slice()};
  }
  function command(cmd,word,parts,pid,actor) {
    if(word!=='/tpto'){return false;}
    var staff=g.__thornswoodStaff,refused=staff.authorizeTool(cmd,pid,actor,'playtester');
    if(refused){staff.tell(pid,refused);return true;}
    if(parts.length<2){staff.tell(pid,USAGE);return true;}
    var person=staff.takePerson(parts.slice(1));
    if(!person.actorId||person.rest.length){staff.tell(pid,person.why||USAGE);return true;}
    if(person.actorId===actor||person.pid===pid){staff.tell(pid,'That is you.');return true;}
    try {
      if(mp.get(actor,'isDead')!==false||mp.get(person.actorId,'isDead')!==false){
        staff.tell(pid,'Both characters must be alive to teleport.');return true;
      }
      var from=place(actor),to=place(person.actorId);
      if(!staff.state||!staff.state.frozen){throw new Error('Staff restraint state is unavailable.');}
      if(staff.state.frozen[pid]){staff.tell(pid,'Staff have frozen you in place.');return true;}
      var cuffs=g.__thornswoodCuffs,property=g.__thornswoodProperty,stuck=g.__thornswoodStuck;
      if(!cuffs||!cuffs.cuffedBy||!property||!property.lockedJailHere||!stuck||!stuck.teleported){
        throw new Error('Movement safeguards are unavailable.');
      }
      if(cuffs.cuffedBy(actor)){staff.tell(pid,'You are cuffed, so you cannot teleport yourself.');return true;}
      if(property.lockedJailHere(actor,pid)){staff.tell(pid,'A guard has a cell locked here, so you cannot teleport out of this jail.');return true;}
      mp.set(actor,'locationalData',{cellOrWorldDesc:to.desc,pos:to.pos,rot:to.rot});
      var confirmed=place(actor);
      if(confirmed.desc!==to.desc||confirmed.pos.some(function(n,i){return n!==to.pos[i];})){
        throw new Error('The native teleport was not applied.');
      }
      stuck.teleported(pid,actor);
      staff.record('tpto',pid,staff.nameOf(actor),person.pid,person.name,'Self-only playtest teleport.',0,{from:from,to:to});
      staff.tell(pid,'Sent to '+person.name+'.');
    } catch(e) {
      log('tpto: could not confirm teleport for '+actor.toString(16)+': '+e);
      staff.tell(pid,'The teleport could not be confirmed. Staff can check the server log.');
    }
    return true;
  }
  g.__thornswoodPersonTeleport={command:command};
  g.__thornswoodCommandTools.register('person-teleport',{command:command,
    help:[{word:'/tpto',role:'playtester',syntax:'/tpto <person>',text:'Teleport yourself to an online person; restraints still apply.'}]});
})();
