// #6732: the real queued inspection reports an allowlist without changing play.
'use strict';
const standIn = require('../../tests/stand-in-server.js');
const t = standIn.checks(), yes = t.yes;
for (const server of ['main','dev']) {
  console.log('\n'+server+' inspection:');
  const w = standIn.world({name:'6732-inspect',settings:{thornswoodServer:server,
    thornswoodAdmins:[104],thornswoodDevs:[103],thornswoodPlaytesters:[102]}});
  const actors = [101,102,103,104,105,106].map((profileId,i) => w.person(0xff006720+i,{
    profileId,name:['Guest','Tester','Helper','Admin','Alia West','Alia East'][i],
    cell:'3c:Skyrim.esm',pos:[1234.5+i*10,-678.9,42],inventory:{entries:[{baseId:15,count:50}]}
  }));
  const [GUEST,TESTER,HELPER,ADMIN,WEST,EAST] = actors;
  yes('the whole gamemode loads',w.boot());
  if (!w.loaded()) { t.done(w); continue; }
  actors.forEach(w.arrive); w.run(30000);
  for (const actor of actors) {
    const row = w.row(actor);
    row.percentages = {health:0.75,magicka:0.5,stamina:0};
    row.thornswoodNeeds = {food:81,drink:72,rest:63,temp:44,at:w.now()-3600000,privateToken:'PRIVATE_NEEDS'};
    row.thornswoodCharacter = {v:1,cls:'miner',prof:'smith',half:'platewright',ranks:{miner:'expert',platewright:'advanced',edgewright:'novice'},
      schools:[],tree:{},points:7,work:{},privateAccount:'PRIVATE_ACCOUNT',discord:'PRIVATE_DISCORD'};
  }
  // Poll the actual voice queue without advancing unrelated needs/work timers.
  // A hidden settle/migrate/write in the inspection itself is still observable.
  w.run = () => w.box().__thornswoodCommandTimer.fn();
  function snapshot() { return JSON.stringify(actors.map(actor => w.row(actor))); }
  function ask(actor,text) {
    const before = snapshot(), marks = w.did.length, n = w.heard(actor).length;
    w.say(actor,text);
    const lines = w.heardSince(actor,n);
    yes('inspection leaves every character unchanged: '+text,snapshot() === before && !w.did.slice(marks).some(d => d[2] === 'set'));
    return lines;
  }
  // Exercise an older engine explicitly. The shared stand-in may support
  // this native flag now; its default false is a valid value, not absence.
  const initialGet = w.mp().get;
  w.mp().get = function(actor,property) {
    if (property === 'isGodMode') { throw new Error('isGodMode binding unavailable'); }
    return initialGet(actor,property);
  };
  let lines;
  try { lines = ask(TESTER,'/inspect'); }
  finally { w.mp().get = initialGet; }
  let output = lines.join('\n');
  yes('a playtester receives their gameplay identity and actual location',/Tester/.test(output) && /ff006721/i.test(output) && /3c:Skyrim.esm/.test(output) && /1244.5/.test(output));
  yes('vitals show actual percentages, including a real zero',/Health: 75%/.test(output) && /Magicka: 50%/.test(output) && /Stamina: 0%/.test(output));
  yes('needs are the last recorded values, without an elapsed drain',/last recorded/i.test(output) && /Food: 81/.test(output) && /Drink: 72/.test(output) && /Rest: 63/.test(output) && /Temperature: 44/.test(output));
  yes('class, profession, chosen half and ranks are reported',/Miner/.test(output) && /Smith/.test(output) && /Platewright/.test(output) && /expert/.test(output) && /advanced/.test(output));
  yes('private account and unrelated state never reach the output',!/PRIVATE_|discord|account|token/i.test(output));
  yes('the output arrives as complete bounded lines',lines.length >= 5 && lines.every(line => line.length <= 300));
  yes('an engine without the god-mode binding reports unavailable',/God mode: unavailable/.test(output));
  output = ask(TESTER,'/inspect for Tester').join('\n');
  yes('an explicit unambiguous self target keeps the playtester permission',/Tester/.test(output) && /Health: 75%/.test(output));
  output = ask(HELPER,'/inspect').join('\n');
  yes('ordinary staff can inspect their own character',/Helper/.test(output) && /Health: 75%/.test(output));
  output = ask(GUEST,'/inspect').join('\n');
  yes('a regular account cannot inspect gameplay data',/not yours/.test(output) && !/Health:/.test(output));
  for (const actor of [TESTER,HELPER]) {
    const originalGet = w.mp().get;
    let targetReads = 0;
    w.mp().get = function(id,property) {
      if (id === GUEST && ['pos','worldOrCellDesc','percentages','thornswoodNeeds','thornswoodCharacter','isGodMode'].includes(property)) targetReads++;
      return originalGet(id,property);
    };
    output = ask(actor,'/inspect for Guest').join('\n');
    yes('a non-admin cannot inspect another person or read their gameplay state',/not yours/.test(output) && !/Health:/.test(output) && targetReads === 0);
    w.mp().get = originalGet;
  }
  output = ask(ADMIN,'/inspect for Alia W').join('\n');
  yes('an admin can inspect one unambiguous name prefix',/Alia West/.test(output) && /Health: 75%/.test(output));
  output = ask(ADMIN,'/inspect for Alia').join('\n');
  yes('ambiguous targets fail clearly',/More than one/.test(output) && !/Health:/.test(output));
  output = ask(ADMIN,'/inspect for Missing').join('\n');
  yes('unknown targets fail clearly',/Nobody/.test(output) && !/Health:/.test(output));
  output = ask(TESTER,'/inspect Guest').join('\n');
  yes('unexpected syntax cannot become an implicit target',/Usage:/.test(output) && !/Health:/.test(output));
  output = ask(TESTER,'/testhelp').join('\n');
  yes('playtest help includes only the own-character inspection form',/\/inspect:/.test(output) && !/\/inspect for/.test(output));
  output = ask(ADMIN,'/adminhelp').join('\n');
  yes('admin help includes the targeted inspection form',/\/inspect for <person>/.test(output));

  const row = w.row(TESTER);
  row.percentages = {health:null,magicka:'0.5',stamina:0};
  row.thornswoodNeeds = {food:null,drink:'12',rest:0,temp:null};
  row.thornswoodCharacter = null;
  output = ask(TESTER,'/inspect').join('\n');
  yes('missing values are unavailable, not fabricated zeros or defaults',/Health: unavailable/.test(output) && /Magicka: unavailable/.test(output) && /Stamina: 0%/.test(output) &&
    /Food: unavailable/.test(output) && /Drink: unavailable/.test(output) && /Rest: 0/.test(output) && /Temperature: unavailable/.test(output) && /Class: unavailable/.test(output));
  yes('a character without a progression record is not migrated',row.thornswoodCharacter === null);
  const table = w.box().__thornswoodProgression.TABLE;
  const known = Object.keys(table.classes).concat(table.schools);
  Object.keys(table.professions).forEach(prof => known.push(...Object.keys(table.professions[prof].halves || {})));
  row.thornswoodCharacter = {v:1,cls:'miner',prof:'smith',half:'platewright',ranks:{}};
  known.forEach(key => row.thornswoodCharacter.ranks[key] = 'master');
  output = ask(TESTER,'/inspect').join('\n');
  yes('all recorded valid rank tracks arrive without truncating the end',
    known.every(key => output.toLowerCase().includes(key+': master')) && output.split('\n').every(line => line.length <= 300));
  const get = w.mp().get;
  for (const flag of [true,false,null]) {
    // Model an engine build exposing its authoritative boolean flag.
    w.mp().get = function(actor,property) { return property === 'isGodMode' ? flag : get(actor,property); };
    output = ask(TESTER,'/inspect').join('\n');
    yes('god mode reflects only an available boolean: '+flag,
      output.includes('God mode: '+(flag === null ? 'unavailable' : flag ? 'on' : 'off')));
  }
  w.mp().get = get;
  const inspect = w.box().__thornswoodInspect;
  if (inspect) {
    const before = snapshot(), n = w.heard(ADMIN).length;
    inspect.command({text:'/inspect',proven:false},'/inspect',['/inspect'],104,ADMIN);
    yes('an unproven admin gets no inspection',snapshot() === before && /proved/.test(w.heardSince(ADMIN,n).join('\n')));
    const actorReply = w.heard(ADMIN).length;
    inspect.command({text:'/inspect',proven:true},'/inspect',['/inspect'],104,TESTER);
    output = w.heardSince(ADMIN,actorReply).join('\n');
    yes('a proven admin cannot substitute another actor as their own',snapshot() === before && /own current character/.test(output) && !/Health:/.test(output));
    const saved = w.box().__thornswoodPassSeen.passes[104];
    delete w.box().__thornswoodPassSeen.passes[104];
    output = ask(ADMIN,'/inspect').join('\n');
    yes('an admin without a current launcher pass gets no report',/launcher.s pass/.test(output) && !/Health:/.test(output));
    w.box().__thornswoodPassSeen.passes[104] = saved;
  } else yes('the implemented inspection has an entry point',false);
  t.done(w);
}
