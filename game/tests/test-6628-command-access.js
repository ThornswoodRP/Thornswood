'use strict';
// Exercise the actual shared boundary that playtest/admin tools call.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../gamemode/staff.ts'),'utf8');
const router = fs.readFileSync(path.join(__dirname,'../gamemode/teleport.ts'),'utf8');
let checks=0;
function test(name,run){run();checks++;console.log('PASS  '+name);}
function setup(){
  let tier='playtester',online=true,actorProfile=123;
  const ctx={console,Date,Number,Object,String,Math,Array,JSON,
    log:()=>{},guard:(_,fn)=>fn,setInterval:()=>0,clearInterval:()=>{},
    __thornswoodPassSeen:{passes:{123:{x:Date.now()+60000}}},
    __thornswoodCommandRoles:{playtester:()=>tier==='playtester'||tier==='staff'||tier==='admin',
      staff:()=>tier==='staff'||tier==='admin',admin:()=>tier==='admin'},
    mp:{getServerSettings:()=>({}),get:(actor,key)=>{
      if(actor===0&&key==='onlinePlayers')return online?[10]:[];
      if(actor===10&&key==='profileId')return actorProfile;
      throw Error('unknown actor');
    }}
  };
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const api=ctx.__thornswoodStaff;
  return {ctx,api,authorize:(wanted='playtester',cmd={proven:true},pid=123,actor=10)=>api.authorizeTool(cmd,pid,actor,wanted),
    tier:v=>{tier=v;},online:v=>{online=v;},profile:v=>{actorProfile=v;}};
}
test('playtest, staff and admin permissions remain distinct',()=>{
  const r=setup();assert.equal(r.authorize(),'');assert.ok(r.authorize('staff'));assert.ok(r.authorize('admin'));
  r.tier('staff');assert.equal(r.authorize('staff'),'');assert.ok(r.authorize('admin'));
  r.tier('admin');assert.equal(r.authorize('playtester'),'');assert.equal(r.authorize('staff'),'');assert.equal(r.authorize('admin'),'');
  r.tier('none');assert.ok(r.authorize());
});
test('a role alone cannot replace connection proof and a current join pass',()=>{
  const r=setup();r.tier('admin');assert.ok(r.authorize('admin',{proven:false}));
  assert.ok(r.authorize('admin',null));delete r.ctx.__thornswoodPassSeen.passes[123];assert.ok(r.authorize('admin'));
  r.ctx.__thornswoodPassSeen.passes[123]={x:1};assert.ok(r.authorize('admin'));
});
test('the requesting profile must own its current online actor',()=>{
  const r=setup();r.online(false);assert.ok(r.authorize());r.online(true);
  r.profile(456);assert.ok(r.authorize());r.profile(123);
  assert.ok(r.authorize('playtester',{proven:true},'123'));assert.ok(r.authorize('playtester',{proven:true},123,20));
});
test('unknown role names and failed role lookups fail closed',()=>{
  const r=setup();assert.ok(r.authorize('owner'));delete r.ctx.__thornswoodCommandRoles;assert.ok(r.authorize());
  r.ctx.__thornswoodCommandRoles={playtester:()=>{throw Error('unreadable');}};assert.ok(r.authorize());
});
test('the shared helpers retain the existing target resolver and audit',()=>{
  const r=setup();for(const name of ['takePerson','tell','nameOf','actorFor','record','unproven'])assert.equal(typeof r.api[name],'function');
});
test('router publishes its existing tier functions without overwriting door role hooks',()=>{
  const line=router.match(/g\.__thornswoodCommandRoles\s*=\s*\{[^\n]+\};/);
  assert.ok(line,'the command router publishes its roles');
  const hooks={Admin:()=>false},g={__thornswoodIsAdmin:hooks.Admin};
  const roles={isPlaytester:()=>true,isStaff:()=>false,isAdmin:()=>false};
  vm.runInNewContext(line[0],Object.assign({g},roles));
  assert.equal(g.__thornswoodIsAdmin,hooks.Admin);
  assert.equal(g.__thornswoodCommandRoles.playtester,roles.isPlaytester);
  assert.equal(g.__thornswoodCommandRoles.admin,roles.isAdmin);
});
console.log(checks+' access checks passed');
