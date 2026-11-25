// Drive the real voice queue and catalog on both server roles.
'use strict';
const fs = require('fs');
const path = require('path');
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
for (const server of ['main', 'dev']) {
  const w = standIn.world({name:'6734-setneeds', settings:{thornswoodServer:server,
    thornswoodAdmins:[104], thornswoodDevs:[103], thornswoodPlaytesters:[102]}});
  let actors = [101,102,103,104,105,106].map((profileId,i) => w.person(0xff006740+i,{
    profileId, name:['Guest','Tester','Helper','Admin','Alia West','Alia East'][i], cell:'3c:Skyrim.esm'}));
  const [GUEST,TESTER,HELPER,ADMIN,WEST] = actors;
  yes(server+' whole gamemode loads', w.boot());
  if (!w.loaded()) { t.done(w); continue; }
  actors.forEach(w.arrive); w.run(30000);
  w.run = () => w.box().__thornswoodCommandTimer.fn();
  function seed(actor, patch) {
    w.row(actor).thornswoodNeeds = Object.assign(w.box().__thornswoodNeeds.fresh(),{
      food:80, drink:70, rest:60, temp:50, place:'indoors', at:w.now(),
      water:[{kind:'clean',count:2}], wellAt:{old:123}, extraMetadata:{kept:true}},patch);
    w.row(actor).thornswoodCharacter = {v:1,cls:'miner',prof:'smith',half:'platewright',
      ranks:{miner:'novice',platewright:'novice'},schools:[],tree:{},points:0,work:{}};
  }
  actors.forEach(actor => seed(actor));
  function audit() {
    const file = path.join(w.dir,'for-bot','moderation.log');
    return fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '';
  }
  function ask(actor,text) {
    const at = w.heard(actor).length, marks = w.did.length;
    w.say(actor,text);
    return {text:w.heardSince(actor,at).join('\n'), sets:w.did.slice(marks).filter(d => d[2] === 'set')};
  }
  function refused(actor,text) {
    const before = JSON.stringify(actors.map(a => w.row(a))), log = audit();
    const reply = ask(actor,text);
    yes('refused without any save or audit: '+text,
      JSON.stringify(actors.map(a => w.row(a))) === before && reply.sets.length === 0 && audit() === log);
    return reply.text;
  }
  let reply = ask(TESTER,'/setneeds hunger 0');
  yes(server+' tester self command works at zero', w.prop(TESTER,'thornswoodNeeds').food === 0 && /Hunger.*0/i.test(reply.text));
  yes('one authoritative needs snapshot reaches the owner property', reply.sets.filter(d => d[3] === 'thornswoodNeeds').length === 1);
  const pane = w.prop(TESTER,'thornswoodCharacter').panel;
  yes('derived effects and Body values refresh after save', !!pane && pane.effects.attackDamageMult < 0 && pane.body.food === 0);
  const maxPaneBytes = Buffer.byteLength(JSON.stringify(w.prop(TESTER,'thornswoodCharacter')), 'utf8');
  console.log('Measured character property bytes after needs refresh: '+maxPaneBytes);
  yes('audit records the successful old/new meter values', /"did":"setneeds"/.test(audit()) && /"from":80/.test(audit()) && /"to":0/.test(audit()));
  for (const [word,key,value] of [['thirst','drink',100],['rest','rest',0],['temperature','temp',100],['temperature','temp',0],['hunger','food',37.25]]) {
    reply = ask(TESTER,'/setneeds '+word+' '+value);
    yes('exact accepted meter and bound '+word+' '+value, w.prop(TESTER,'thornswoodNeeds')[key] === value && !/Usage:|could not/i.test(reply.text));
    yes('one needs save for '+word+' '+value, reply.sets.filter(d => d[3] === 'thornswoodNeeds').length === 1);
  }
  seed(TESTER);
  reply = ask(TESTER,'/setneeds rest 45 for Tester');
  yes('an explicit unambiguous self target keeps tester permission', w.prop(TESTER,'thornswoodNeeds').rest === 45);
  reply = ask(HELPER,'/setneeds rest 46');
  yes('ordinary staff can set their own needs', w.prop(HELPER,'thornswoodNeeds').rest === 46);
  for (const actor of [TESTER,HELPER]) yes('only admins target another person', /not yours/.test(refused(actor,'/setneeds rest 50 for Guest')));
  yes('ordinary account is refused', /not yours/.test(refused(GUEST,'/setneeds rest 50')));
  reply = ask(ADMIN,'/setneeds thirst 20 for Alia W');
  yes('admin can target a unique name prefix', w.prop(WEST,'thornswoodNeeds').drink === 20);
  for (const text of ['/setneeds rest 50 for Alia','/setneeds rest 50 for Missing',
    '/setneeds hunger -1','/setneeds hunger 101','/setneeds hunger NaN','/setneeds hunger Infinity',
    '/setneeds hunger 1e999','/setneeds hunger 5oops','/setneeds hunger 0x20',
    '/setneeds health 5','/setneeds rest','/setneeds rest 5 Guest','/setneeds rest 5 for',
    '/setneeds rest 5 for Tester extra']) refused(ADMIN,text);
  seed(TESTER,{at:w.now()-3600000,worked:0,drugUntil:w.now()+60000,teaUntil:w.now()+120000});
  const before = w.prop(TESTER,'thornswoodNeeds');
  reply = ask(TESTER,'/setneeds hunger 33');
  const after = w.prop(TESTER,'thornswoodNeeds'), N = w.box().__thornswoodNeeds;
  yes('the other meters pay their pending interval exactly once', after.food === 33 &&
    Math.abs(after.drink-Math.max(0,before.drink-N.NEEDS.drain.drink)) < 1e-9 && after.at === w.now());
  yes('unrelated clocks and metadata survive the setter', after.drugUntil === before.drugUntil && after.teaUntil === before.teaUntil &&
    JSON.stringify(after.water) === JSON.stringify(before.water) && JSON.stringify(after.wellAt) === JSON.stringify(before.wellAt) && after.extraMetadata.kept);
  yes('elapsed projection plus effect refresh still makes one needs save', reply.sets.filter(d => d[3] === 'thornswoodNeeds').length === 1);
  const settled = N.settle(TESTER,w.now());
  yes('settling again does not charge the same interval twice', settled.food === 33 && settled.drink === after.drink);
  for (const [key,value] of [['food',NaN],['food',Infinity],['food',-Infinity],['food','10'],['food',null],['at',5]]) {
    const previous = JSON.stringify(w.row(TESTER)), marks = w.did.length;
    const result = N.setForTesting(TESTER,key,value);
    yes('helper rejects invalid typed or nonfinite input without writes: '+key+' '+String(value),
      !result.ok && JSON.stringify(w.row(TESTER)) === previous && !w.did.slice(marks).some(d => d[2] === 'set'));
  }
  seed(TESTER,{at:w.now()-3600000,rest:12,temp:3});
  const godHook = N.ignoresNeeds;
  N.ignoresNeeds = actor => actor === TESTER;
  reply = ask(TESTER,'/setneeds hunger 44');
  yes('authoritative God mode bypass preserves other meters and advances the clock',
    w.prop(TESTER,'thornswoodNeeds').food === 44 && w.prop(TESTER,'thornswoodNeeds').drink === 70 &&
    w.prop(TESTER,'thornswoodNeeds').rest === 12 && w.prop(TESTER,'thornswoodNeeds').temp === 3 && w.prop(TESTER,'thornswoodNeeds').at === w.now());
  N.ignoresNeeds = godHook;
  seed(TESTER,{at:w.now()-3600000,worked:w.now()-1,fire:0});
  w.row(TESTER).thornswoodCharacter = null;
  const oldState = w.box().__thornswoodCharacter.stateOf;
  let migrations = 0;
  w.box().__thornswoodCharacter.stateOf = () => { migrations++; throw new Error('unexpected migration'); };
  reply = ask(TESTER,'/setneeds hunger 45');
  yes('projection and refresh do not migrate a missing progression record',
    w.prop(TESTER,'thornswoodNeeds').food === 45 && w.prop(TESTER,'thornswoodCharacter') === null && migrations === 0);
  w.box().__thornswoodCharacter.stateOf = oldState;
  seed(TESTER);
  const dateNow = w.box().Date.now;
  let milliseconds = 0;
  w.box().Date.now = () => dateNow() + milliseconds++;
  reply = ask(TESTER,'/setneeds rest 39');
  w.box().Date.now = dateNow;
  yes('real-time movement during effects delivery cannot produce a second needs save',
    reply.sets.filter(d => d[3] === 'thornswoodNeeds').length === 1 && milliseconds > 1);
  seed(TESTER);
  const set = w.mp().set;
  w.mp().set = function(actor,property,value) {
    if (actor === TESTER && property === 'thornswoodNeeds') throw new Error('fixture save failed');
    return set(actor,property,value);
  };
  yes('failed authoritative save reports refusal', /could not save/i.test(refused(TESTER,'/setneeds rest 12')));
  w.mp().set = set;
  w.row(TESTER).thornswoodNeeds = {food:null,drink:70,rest:60,temp:50,at:w.now()};
  yes('malformed existing needs are refused rather than repaired silently', /invalid|unavailable/i.test(refused(TESTER,'/setneeds rest 12')));
  delete w.row(TESTER).thornswoodNeeds;
  let freshMilliseconds = 0;
  w.box().Date.now = () => dateNow() + freshMilliseconds++;
  reply = ask(TESTER,'/setneeds rest 12');
  w.box().Date.now = dateNow;
  yes('explicit change initializes genuinely absent needs canonically', w.prop(TESTER,'thornswoodNeeds').rest === 12 && w.prop(TESTER,'thornswoodNeeds').food === 100);
  seed(TESTER);
  const get = w.mp().get;
  w.mp().get = function(actor,property) {if(actor === TESTER && property === 'thornswoodNeeds') throw new Error('fixture read failed'); return get(actor,property);};
  yes('failed read is not mistaken for an absent record', /could not read/i.test(refused(TESTER,'/setneeds rest 12')));
  w.mp().get = get;
  seed(TESTER);
  const needs = w.box().__thornswoodNeeds, runtimeIdentity = w.mp().getActorRuntimeIdentity;
  needs.setBurning(TESTER, true);
  yes('strict context fixture started a canonical body fire', w.prop(TESTER,'thornswoodBurnVisual').on === true);
  w.box().Date.now = () => dateNow() + 3000;
  w.mp().getActorRuntimeIdentity = function (actor) {
    if (actor === TESTER) throw new Error('fixture burning runtime read failed');
    return runtimeIdentity(actor);
  };
  try {
    yes('failed burning identity refuses the staged change instead of dropping live warmth',
      /could not read the needs context/i.test(refused(TESTER,'/setneeds rest 27')));
  } finally {
    w.mp().getActorRuntimeIdentity = runtimeIdentity;
  }
  try {
    reply = ask(TESTER,'/setneeds rest 27');
    yes('a readable active fire banks its warmth in the single staged save',
      w.prop(TESTER,'thornswoodNeeds').rest === 27 && w.prop(TESTER,'thornswoodNeeds').temp > 51 &&
      reply.sets.filter(d => d[3] === 'thornswoodNeeds').length === 1);
  } finally {
    needs.clearBurning(TESTER);
    w.box().Date.now = dateNow;
  }
  const api = w.box().__thornswoodStaffNeeds;
  if (api) {
    const n = w.heard(ADMIN).length, previous = JSON.stringify(w.row(ADMIN));
    api.command({proven:false},'/setneeds',['/setneeds','rest','10'],104,ADMIN);
    yes('even admin requires connection proof', /proved/.test(w.heardSince(ADMIN,n).join('\n')) && JSON.stringify(w.row(ADMIN)) === previous);
    const size = w.heard(ADMIN).length;
    api.command({proven:true},'/setneeds',['/setneeds','rest','10'],104,TESTER);
    yes('an admin cannot supply another actor as their own', /own current character/.test(w.heardSince(ADMIN,size).join('\n')));
    const save = w.box().__thornswoodPassSeen.passes[104];
    delete w.box().__thornswoodPassSeen.passes[104];
    yes('current launcher pass is required', /launcher.s pass/.test(refused(ADMIN,'/setneeds rest 12')));
    w.box().__thornswoodPassSeen.passes[104] = save;
  } else yes('the needs command has a testable entry point',false);
  yes('tester help contains the own-character form only', /\/setneeds/.test(ask(TESTER,'/testhelp').text) && !/\[for <person>\]/.test(ask(TESTER,'/testhelp').text));
  yes('admin help contains the target form', /for <person>/.test(ask(ADMIN,'/adminhelp').text));
  ask(TESTER,'/setneeds rest 21');
  const saved = w.prop(TESTER,'thornswoodNeeds');
  yes('saved meter survives a server restart',w.restart() && w.prop(TESTER,'thornswoodNeeds').rest === saved.rest);
  t.done(w);
}
