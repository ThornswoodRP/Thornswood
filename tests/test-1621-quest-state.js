// test-1621-quest-state.js
//
// #1621. An open custom quest, what it has drawn or killed, and each
// person's cooldowns survive a server restart. They are kept on the
// character, in one property beside the pack, the way the perk clocks are.
//
// The custom quests block is run the way the server starts it, over a
// pretend world whose characters are change forms: a pack and the custom
// properties. A restart throws the block away, round-trips every change form
// through JSON the way the database does, and starts the block again from
// that. A record that cannot be read refuses every step and is never
// written over; a step that cannot be written changes nothing.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const population = require('../game/data/npc-population.json');
const compactPopulation={keep:population.npcs.filter(r=>r.keep).map(r=>
  [r.ref,r.base,r.world||r.cell,r.pos,r.leash,r.returnMinutes,r.role,r.habitat,r.tier,r.cap,r.populationBucket,0,r.species])};
const npcStates={}, npcIds={};
compactPopulation.keep.forEach((r,i)=>{
  const id=i+5000;npcIds[r[0]]=id;npcStates[id]={ref:r[0],base:r[1],world:r[2],pos:r[3].slice(),
    race:r[12]==='sabre-cat'?'SabreCatRace':r[12]+'Race',
    profileId:-1,isHuman:false,isDead:false,isServerControlled:true,lifeGeneration:0,runtimeLifeIdentity:'100'};
});
for(const [id,ref] of [[31,'50533'],[32,'50549'],[33,'5054a'],[41,'86a88']]) {
  npcStates[id]=npcStates[npcIds[ref+':Skyrim.esm']];npcIds[ref+':Skyrim.esm']=id;
}
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const questPage = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'quests.md'), 'utf8').split(CR).join('');
const minerPage = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'classes', 'miner.md'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const block = slice(gm, '// ==== thornswood custom quests ====', '// ==== end thornswood custom quests ====');
yes('the custom quests block is in the gamemode', !!block);
if (!block) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }

const PROP = (/var QUEST_PROPERTY = '([^']+)';/.exec(block) || [])[1];
yes('the block names the property it keeps each person\'s quests in', PROP === 'thornswoodQuests');
yes('and keeps no map of people in the process', !/new Map\(\)/.test(block) && !/\bpeople\b/.test(block));
const EBONY_CELL = (/ebony: \{ cell: '([^']+)' \}/.exec(block) || [])[1];
const RUBY_CELL = (/Ruby: '([^']+)'/.exec(block) || [])[1];
yes('the ebony and ruby places are bound by cell', !!EBONY_CELL && !!RUBY_CELL);

const HOUR = 3600000;
const EBONY = { name: 'Ebony Ore', ore: '5ad9d:Skyrim.esm' };
const RUBY = { name: 'Ruby', ore: '63b42:Skyrim.esm' };

/*
  The saved world. forms[actor] is that character's change form: inv is the
  pack, props the custom properties. What a restart reads is what is here.
*/
let forms = {};
const clock = { now: 1000000 };
const ranks = { '1:miner': 'master', '2:miner': 'master', '3:miner': 'master', '4:miner': 'master' };
const veinCell = {};
let nextVein = 0x9000;
function vein(cell) { const ref = nextVein++; veinCell[ref] = cell; return ref; }
function form(id) {
  if (!forms[id]) { forms[id] = { inv: {}, props: {} }; }
  return forms[id];
}
function have(id, item) { return (forms[id] && forms[id].inv[item]) || 0; }
const fault = { read: null, write: false, noAdd: [], throwAdd: [] };
const said = [];
function lastSaid() { return said.length ? said[said.length - 1] : ''; }

function boot(into, source, expanded) {
  const made = {};
  const logged = [];
  const ctx = into || {
    console: { log: function () {} }, Map: Map, Set: Set, Math: Math, Number: Number, String: String,
    Buffer: Buffer, JSON: JSON, Object: Object, Array: Array, RegExp: RegExp, Error: Error,
    Date: { now: function () { return clock.now; } },
    idOf: function () { return 0; },
    classGate: function () { return null; },
    toolGate: function () { return null; },
    mining: function () { return false; },
    stopMining: function () {},
    swinging: function () { return false; },
    toolIdIn: function () { return 1; },
    swing: function (a, anim, done) { done(); },
    SWING_MINE: 'mine',
    notify: function (a, m) { said.push(m); },
    say: function () {},
    creditWork: function () { return null; },
    wearTool: function () { return null; }
  };
  ctx.__made = ctx.__made || made;
  ctx.__logged = logged;
  ctx.log = function () { logged.push([].slice.call(arguments).join(' ')); };
  ctx.mp = {
    makeProperty: function (name, opts) {
      if (ctx.__made[name]) { throw new Error('Property \'' + name + '\' already exists'); }
      ctx.__made[name] = opts;
    },
    get: function (id, key) {
      if (key === 'thornswoodCharacter') {
        if (ctx.__questRankRead) return ctx.__questRankRead(id);
        const savedRanks = {};
        Object.keys(ranks).forEach(function (entry) {
          const prefix = id + ':';
          if (entry.indexOf(prefix) === 0) savedRanks[entry.slice(prefix.length)] = ranks[entry];
        });
        return {v: 1, cls: 'miner', ranks: savedRanks};
      }
      if(npcStates[id] && key==='baseDesc')return npcStates[id].base;
      if(npcStates[id] && key==='worldOrCellDesc')return npcStates[id].world;
      if (key === 'locationalData') { return veinCell[id] ? { cellOrWorldDesc: veinCell[id], pos: [0, 0, 0] } : undefined; }
      if (key === PROP && fault.read === 'throw') { throw new Error('the change form could not be read'); }
      if (!forms[id] || !(key in forms[id].props)) { return undefined; }
      return JSON.parse(JSON.stringify(forms[id].props[key]));
    },
    set: function (id, key, v) {
      if (!ctx.__made[key]) { throw new Error('Property \'' + key + '\' doesn\'t exist'); }
      if (key === PROP && fault.write) { throw new Error('the write was refused'); }
      form(id).props[key] = JSON.parse(JSON.stringify(v));
    },
    getDescFromId: function (id) { return npcStates[id] ? npcStates[id].ref : 'human:'+id; },
    getIdFromDesc: function(ref){return npcIds[ref];},
    getNpcAIState: function(id){return JSON.parse(JSON.stringify(npcStates[id]));}
  };
  ctx.addItem = function (a, item, n) {
    if (fault.throwAdd.indexOf(item) >= 0) throw new Error('native inventory write failed');
    if (fault.noAdd.indexOf(item) >= 0) { return false; }
    const f = form(a);
    f.inv[item] = (f.inv[item] || 0) + n;
    return true;
  };
  ctx.takeItem = function (a, item, n) {
    const f = form(a);
    if ((f.inv[item] || 0) < n) { return false; }
    f.inv[item] -= n;
    return true;
  };
  ctx.NPC_POPULATION_DATA=compactPopulation;
  ctx.raceEdidOf=id=>npcStates[id].race;
  ctx.MERCHANT_TRADING = {expandedScenes:()=>expanded || [],sceneBudget:require('../game/scene-reward-budget'),
    createKillContracts: require('../game/kill-contracts').createKillContracts,
    createQuestTransactions: function () {
    return {identity: function (a) {
      if(ctx.__runtimeIdentityApi)return require('../game/quest-transactions').actorIdentity(ctx.__runtimeIdentityApi,a);
      return ctx.__identityToken || 'actor:' + a;
    }, shutdown: function () {},available:function(){return !ctx.__revoked;},
      commit: function (a, expected, next, changes, admission) {
        if (fault.write) throw new Error('the write was refused');
        if(ctx.__beforeQuestCommit)ctx.__beforeQuestCommit();
        if(admission!==undefined && (typeof admission!=='function' || admission()!==true))return {ok:false};
        const current = form(a);
        if (JSON.stringify(current.props[PROP] || null) !== JSON.stringify(expected)) return {ok:false};
        const pack = JSON.parse(JSON.stringify(current.inv));
        for (const change of changes) {
          if (fault.throwAdd.indexOf(change.item) >= 0 && change.count > 0) throw new Error('native inventory write failed');
          if (fault.noAdd.indexOf(change.item) >= 0 && change.count > 0) return {ok:false};
          const count = (pack[change.item] || 0) + change.count;
          if (count < 0) return {ok:false};
          pack[change.item] = count;
        }
        // The native boundary publishes a single complete character snapshot.
        forms[a] = {inv:pack,props:Object.assign({},current.props,{[PROP]:JSON.parse(JSON.stringify(next))})};
        if(ctx.__afterCommit)ctx.__afterCommit();
        return {ok:true};
      }
    };
  }};
  ctx.__thornswoodMerchantTrade={nativeReady:function(){return true;},questReady:function(){return true;},
    questRole:function(){return '';},
    questAdmission:function(){return ()=>true;},
    questHold:function(id){return id===9000?'Whiterun':id===9001?'Eastmarch':'';}};
  ctx.globalThis = ctx;
  ctx.__thornswoodCharacter = { PROPERTY: 'thornswoodCharacter' };
  ctx.__thornswoodDungeonLoot = { GOLD_DESC: 'f:Skyrim.esm' };
  if (!into) { vm.createContext(ctx); }
  require('./quest-eligibility-fixture')(ctx, gm);
  ctx.MERCHANT_TRADING.expandedScenes=vm.runInContext('(function(){return '+JSON.stringify(expanded || [])+';})',ctx);
  if(typeof ctx.__beforeQuestStartup==='function')ctx.__beforeQuestStartup(ctx);
  vm.runInContext(source || block, ctx);
  return { svc: ctx.__thornswoodQuests, ctx: ctx, logged: logged };
}
function restart() {
  forms = JSON.parse(JSON.stringify(forms));
  return boot();
}

// ------------------------------------------------------------ the start --
let w = boot();
yes('the server starts the quest service', !!w.svc && !!w.svc.mineRare &&
    !w.logged.some(function (l) { return /failed to start/.test(l); }));
yes('the property is made, seen by nobody\'s client', !!w.ctx.__made[PROP] &&
    w.ctx.__made[PROP].isVisibleByOwner === false && w.ctx.__made[PROP].isVisibleByNeighbors === false);
{
  let threw = false;
  try { w.ctx.__thornswoodCustomQuestsCreate({ now: function () { return 0; } }); } catch (e) { threw = true; }
  yes('the block refuses to start with nowhere on the character to keep the quests', threw);
}

// ------------------------------------------- the draw, then a restart ----
const here = [vein(EBONY_CELL), vein(EBONY_CELL)];
yes('a master miner takes the ebony', w.svc.offer(1, 'ebony').ok === true);
for (let i = 0; i < 5; i++) { w.svc.mineRare(1, here[i % 2], EBONY); }
yes('and draws 5 of the 12', have(1, EBONY.ore) === 5);
yes('the open quest and its draw are on the character, not only in the process',
    forms[1].props[PROP] && forms[1].props[PROP].v === 1 && forms[1].props[PROP].open.ebony.drawn === 5);

w = restart();
yes('after a restart the ebony quest is still open', w.svc.offer(1, 'ebony').why === 'open');
let more = 0;
for (let i = 0; i < 10; i++) { if (w.svc.mineRare(1, here[i % 2], EBONY) === '') { more++; } }
yes('the place gives the 7 it had left and no more (' + more + ')',
    have(1, EBONY.ore) === 12 && /nothing left/.test(w.svc.mineRare(1, here[0], EBONY)));

w = restart();
yes('after a second restart, walking away puts all 12 back',
    w.svc.walkAway(1, 'ebony').ok === true && have(1, EBONY.ore) === 0);
yes('and the cooldown does not start', w.svc.offer(1, 'ebony').ok === true);
w.svc.walkAway(1, 'ebony');

// --------------------------------- the twelve-ebony trick, played out ----
yes('the trick: draw 12, wait for a restart', w.svc.offer(2, 'ebony').ok === true);
for (let i = 0; i < 12; i++) { w.svc.mineRare(2, here[0], EBONY); }
w = restart();
yes('then take the quest again at once: refused, it is still open',
    have(2, EBONY.ore) === 12 && w.svc.offer(2, 'ebony').why === 'open');
yes('and the place still has nothing left for them', /nothing left/.test(w.svc.mineRare(2, here[1], EBONY)));
yes('turned in after the restart, the ask goes and the extra stays',
    w.svc.turnIn(2, 'ebony').ok === true && have(2, EBONY.ore) === 8);
w = restart();
yes('a restart after the turn-in keeps the 24 hour cooldown', w.svc.offer(2, 'ebony').why === 'cooldown' &&
    w.svc.mineRare(2, here[0], EBONY) === 'This place is shut.');
clock.now += 24 * HOUR - 1;
w = restart();
yes('a second short of 24 hours, after another restart, it still holds', w.svc.offer(2, 'ebony').why === 'cooldown');
clock.now += 1;
yes('and at 24 hours the trader can open it again', w.svc.offer(2, 'ebony').ok === true);
w.svc.walkAway(2, 'ebony');
yes('an expired cooldown is retained as history without blocking the next offer',
    forms[2].props[PROP].cool.ebony <= clock.now);

// ------------------------------------------------ the gem they named -----
yes('a ruby quest', w.svc.offer(3, 'gem', { gem: 'Ruby' }).ok === true);
w = restart();
const ruby = vein(RUBY_CELL);
yes('after a restart the ruby is still the gem, and its place is open to them',
    w.svc.mineRare(3, ruby, RUBY) === '' && have(3, RUBY.ore) === 1);
w.svc.walkAway(3, 'gem');

// -------------------------------------------------------- scene quests ---
w.svc.bindPlace('camp', { cell: 'camp-1' });
yes('anyone takes the camp', w.svc.offer(4, 'camp',{traderRef:9000}).ok === true);
const names = { 31: 'Bandit', 32: 'Bandit Outlaw', 33: 'Bandit' };
function bandit(id) { npcStates[id].isDead=true;return id; }
// creatureName is the server's own, which reads the record; give the deaths a name by a stub over it.
function kill(svc, killer, id) { return svc.noteKill(killer, bandit(id)); }
w.ctx.mp.lookupEspmRecordById = function () { return null; };
kill(w.svc, 4, 31); kill(w.svc, 4, 32);
yes('two of three bandits are counted on the character', forms[4].props[PROP].open.camp.kills === 2);
w = restart();
w.svc.bindPlace('camp', { cell: 'camp-1' });
w.ctx.mp.lookupEspmRecordById = function () { return null; };
yes('after a restart the camp is not done', w.svc.turnIn(4, 'camp',9000).why === 'short');
kill(w.svc, 4, 33);
yes('the third bandit finishes it and its 45 gold is created once',
    w.svc.turnIn(4, 'camp',9000).ok === true && have(4, 'f:Skyrim.esm') === 45);
w = restart();
yes('a restart keeps the camp\'s 6 hour cooldown, so its gold cannot be taken again',
    w.svc.offer(4, 'camp',{traderRef:9000}).why === 'cooldown' && have(4, 'f:Skyrim.esm') === 45);

{
  const fixture=require('./merchant-retrieval-fixture'),retrieval=fixture.setup(),row=fixture.data.sources[0];
  yes('the satchel',retrieval.take(row).ok===true && retrieval.pickup(row)==='You take it.');
  retrieval.restart();
  yes('after a restart the satchel taken is still counted: no second one',
    retrieval.pickup(row)==='You already have this quest item.' && fixture.h.have(500,row.item)===1);
  yes('and walking away puts it back',retrieval.leave(row).ok===true && fixture.h.have(500,row.item)===0);
}

// ------------------------------------------------ a record rebuilt -------
forms[5] = { inv: {}, props: {} };
forms[5].props[PROP] = { v: 1, open: { ebony: { drawn: 2.5, kills: -1, itemDesc: 7 }, nothere: { drawn: 3 },
  constructor: { drawn: 1 } }, cool: { stalhrim: clock.now + HOUR, gem: clock.now - 1, nothere: clock.now + HOUR } };
ranks['5:miner'] = 'master';
w = restart();
yes('a record is rebuilt field by field: a count that is not whole reads as none',
    w.svc.offer(5, 'ebony').why === 'open' && w.svc.walkAway(5, 'ebony').ok === true);
function owns(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
yes('unknown quest fields and expired cooldowns remain saved outside the working view',
    owns(forms[5].props[PROP].open, 'nothere') && owns(forms[5].props[PROP].open, 'constructor') &&
    owns(forms[5].props[PROP].cool, 'nothere') && owns(forms[5].props[PROP].cool, 'gem') &&
    forms[5].props[PROP].cool.stalhrim === clock.now + HOUR);

// --------------------------------------- a record that cannot be read ----
function unread(value, what) {
  forms[6] = { inv: {}, props: {} };
  forms[6].props[PROP] = value;
  ranks['6:miner'] = 'master';
  const before = JSON.stringify(forms[6].props[PROP]);
  w = restart();
  const o = w.svc.offer(6, 'ebony');
  const line = w.svc.mineRare(6, here[0], EBONY);
  yes(what + ': the offer is refused and the place stays shut',
      o.ok === false && o.why === 'unread' && /could not be read/.test(line) && have(6, EBONY.ore) === 0);
  yes(what + ': walking away and turning in are refused too',
      w.svc.walkAway(6, 'ebony').why === 'unread' && w.svc.turnIn(6, 'ebony').why === 'unread');
  yes(what + ': and nothing is written over it', JSON.stringify(forms[6].props[PROP]) === before);
  yes(what + ': and the log says so', w.logged.some(function (l) { return /custom quests:/.test(l) && /6/.test(l); }));
}
unread('a string', 'a value that is not a record');
unread({ v: 2, open: {}, cool: {} }, 'a record of another shape');
unread({v:1,open:[],cool:{}}, 'an array where the open quest map belongs');
unread({v:1,open:{},cool:'unreadable'}, 'an unreadable cooldown map');
unread({v:1,open:null,cool:{}}, 'a null open quest map');
unread({v:1,open:{},cool:null}, 'a null cooldown map');
{
  forms[7] = { inv: {}, props: {} };
  forms[7].props[PROP] = { v: 1, open: {}, cool: { ebony: clock.now + HOUR } };
  ranks['7:miner'] = 'master';
  w = restart();
  fault.read = 'throw';
  const o = w.svc.offer(7, 'ebony');
  fault.read = null;
  yes('a read that throws refuses the offer rather than handing the cooldown back',
      o.why === 'unread' && forms[7].props[PROP].cool.ebony === clock.now + HOUR);
  yes('and once it reads again the cooldown is there', w.svc.offer(7, 'ebony').why === 'cooldown');
}

// --------------------------------------- a step that cannot be written ---
{
  ranks['8:miner'] = 'master';
  w = restart();
  fault.write = true;
  const o = w.svc.offer(8, 'ebony');
  fault.write = false;
  yes('an offer that cannot be written opens nothing',
      o.why === 'unwritten' && !(forms[8] && forms[8].props[PROP]) && w.svc.offer(8, 'ebony').ok === true);
  fault.write = true;
  w.svc.mineRare(8, here[0], EBONY);
  fault.write = false;
  yes('a draw that cannot be written hands over no ore', /could not be committed/.test(lastSaid()) && have(8, EBONY.ore) === 0 &&
      forms[8].props[PROP].open.ebony.drawn === 0);
  for (let i = 0; i < 4; i++) { w.svc.mineRare(8, here[0], EBONY); }
  fault.write = true;
  const t = w.svc.turnIn(8, 'ebony');
  fault.write = false;
  yes('a turn-in that cannot be written keeps the goods and the quest open',
      t.why === 'unwritten' && have(8, EBONY.ore) === 4 && forms[8].props[PROP].open.ebony.drawn === 4 &&
      !forms[8].props[PROP].cool.ebony);
  fault.write = true;
  const a = w.svc.walkAway(8, 'ebony');
  fault.write = false;
  yes('a walk away that cannot be written leaves the goods with the quest that drew them',
      a.why === 'unwritten' && have(8, EBONY.ore) === 4 && forms[8].props[PROP].open.ebony.drawn === 4);
  fault.noAdd = [EBONY.ore];
  w.svc.mineRare(8, here[0], EBONY);
  fault.noAdd = [];
  yes('ore the load order cannot hand over is not counted as drawn',
      /could not be committed/.test(lastSaid()) && forms[8].props[PROP].open.ebony.drawn === 4 && have(8, EBONY.ore) === 4);
  w.svc.walkAway(8, 'ebony');
}
{
  ranks['9:miner'] = '';
  w = restart();
  w.svc.bindPlace('wolf', { cell: 'pad-1' });
  w.svc.offer(9, 'wolf',{traderRef:9000});
  names[41] = 'Wolf'; veinCell[41] = 'pad-1';
  w.ctx.mp.lookupEspmRecordById = function () { return null; };
  npcStates[41].isDead=false; // Newly accepted living body, then a server death.
  npcStates[41].lifeGeneration++;
  w.svc.walkAway(9,'wolf');w.svc.offer(9,'wolf',{traderRef:9000});npcStates[41].isDead=true;
  fault.write = true;
  const k = w.svc.noteKill(9, 41);
  fault.write = false;
  yes('a kill that cannot be written is not counted', k.why === 'unwritten' && forms[9].props[PROP].open.wolf.kills === 0);
  w.svc.noteKill(9, 41);
  fault.noAdd = ['f:Skyrim.esm'];
  const t = w.svc.turnIn(9, 'wolf',9000);
  fault.noAdd = [];
  yes('gold that cannot be handed over leaves the quest open, with no cooldown',
      t.why === 'unwritten' && forms[9].props[PROP].open.wolf.kills === 1 && !forms[9].props[PROP].cool.wolf);
  fault.write = true;
  const t2 = w.svc.turnIn(9, 'wolf',9000);
  fault.write = false;
  yes('a scene turn-in that cannot be written creates no gold', t2.why === 'unwritten' && have(9, 'f:Skyrim.esm') === 0);
  yes('and written, it pays the 25 once', w.svc.turnIn(9, 'wolf',9000).ok === true && have(9, 'f:Skyrim.esm') === 25);
}

// A native inventory setter can throw instead of returning false. The
// quest and its payment must remain one state, including after restart.
{
  w = restart();
  w.svc.bindPlace('wolf', { cell: 'pad-1' });
  w.svc.offer(30, 'wolf',{traderRef:9000});
  forms[30].props[PROP].open.wolf.kills = 1;
  fault.throwAdd = ['f:Skyrim.esm'];
  try { w.svc.turnIn(30, 'wolf'); } catch (error) { /* observe saved state below */ }
  fault.throwAdd = [];
  w = restart();
  const saved = forms[30].props[PROP];
  yes('a thrown inventory write cannot save the cooldown without its scene reward',
      !!saved.open.wolf && !saved.cool.wolf && have(30, 'f:Skyrim.esm') === 0);
}

// ------------------------------------------------------- a hot reload ----
{
  ranks['31:miner']='master';w=restart();w.svc.offer(31,'ebony');
  let finish;
  w.ctx.swing=function(a,anim,done){finish=done;};
  const old=w.svc;
  old.mineRare(31,here[0],EBONY);
  boot(w.ctx);
  finish();
  yes('a mining callback from the old controller cannot draw after reload',have(31,EBONY.ore)===0);
}
{
  ranks['32:miner']='master';w=restart();w.svc.offer(32,'ebony');
  let finish;
  w.ctx.swing=function(a,anim,done){finish=done;};
  w.ctx.__identityToken='original';w.svc.mineRare(32,here[0],EBONY);
  w.ctx.__identityToken='replacement';finish();
  yes('a delayed mining callback cannot draw for a replacement identity',have(32,EBONY.ore)===0);
}
{
  ranks['36:miner']='master';w=restart();w.svc.offer(36,'ebony');
  let finish,runtime='100';
  w.ctx.__runtimeIdentityApi={getActorRuntimeIdentity:()=>runtime,
    getDescFromId:()=> 'ff000024:Skyrim.esm',getNpcAIState:()=>({isHuman:true,profileId:36,lifeGeneration:0})};
  w.ctx.swing=function(a,anim,done){finish=done;};
  w.svc.mineRare(36,here[0],EBONY);
  runtime='101';finish();
  yes('a delayed mining callback refuses a new native session with unchanged profile and NPC life',have(36,EBONY.ore)===0);
}
{
  w=restart();
  const ctx = w.ctx;
  const again = boot(ctx);
  yes('a hot reload starts the service again over the property the first load made',
      !!again.svc && !again.logged.some(function (l) { return /failed to start/.test(l); }) &&
      again.svc.offer(2, 'ebony').ok === true && forms[2].props[PROP].open.ebony.drawn === 0);
  again.svc.walkAway(2, 'ebony');
}

// ------------------------------------------------------- the pages -------
{
  const timers=[],writes=[];
  const start=gm.indexOf('function swing(actorId, anim, lands, opts) {');
  const finish=gm.indexOf('\n}\n/*',start)+2;
  const ctx={mp:{set:(...args)=>writes.push(args)},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},
    clearTimeout(){},guard:(label,fn)=>fn,SWING_PROPERTY:'swing',SWING_STOP:'stop',SWING_FREE:'free',
    SWING_MS:2500,SWING_LAND_MS:900,SWING_QUIET:{},SWING_IN_AIR:{},SWING_CLEAR:{},log(){}};
  vm.createContext(ctx);vm.runInContext(gm.slice(start,finish),ctx);
  let alive=true;ctx.swing(36,'mine',null,{alive:()=>alive});alive=false;
  const count=writes.length;timers.forEach(t=>t.fn());
  yes('the real swing cleanup cannot write after its owner is revoked',writes.length===count);
  yes('revoked swing cleanup retires its local busy state',!ctx.SWING_IN_AIR[36] && !ctx.SWING_CLEAR[36]);
}
{
  w=restart();w.svc.bindPlace('wolf',{cell:'pad-1'});w.svc.offer(34,'wolf',{traderRef:9000});
  names[41]='Wolf';veinCell[41]='pad-1';
  const saved=JSON.stringify(forms[34]);w.ctx.__revoked=true;
  w.svc.noteKill(34,41);w.svc.offer(34,'ebony');
  yes('transaction revocation blocks every quest-state writer',JSON.stringify(forms[34])===saved);
}
{
  ranks['35:miner']='master';w=restart();w.svc.offer(35,'ebony');
  let done,valid,credits=0;
  w.ctx.swing=function(a,anim,finish,opts){done=finish;valid=opts.alive;};
  w.ctx.creditWork=function(){credits++;};
  w.svc.mineRare(35,here[0],EBONY);
  yes('a current quest swing owns its cleanup lease',valid());
  w.svc.shutdown();done();
  yes('shutdown revokes mining cleanup and work credit',!valid() && credits===0 && have(35,EBONY.ore)===0);
}
{
  ranks['37:miner']='master';w=restart();w.svc.offer(37,'ebony');
  let credits=0,wear=0;
  w.ctx.creditWork=function(){credits++;};w.ctx.wearTool=function(){wear++;};
  w.ctx.__afterCommit=function(){w.svc.shutdown();};
  w.svc.mineRare(37,here[0],EBONY);
  yes('publication followed by shutdown cannot credit work to the next controller',
      have(37,EBONY.ore)===1 && credits===0 && wear===0);
}
{
  ranks['33:miner']='master';w=restart();
  yes('the trader describes the four authored mine quests',typeof w.svc.describe==='function' &&
      w.svc.describe(33).length===4);
  yes('unbound scarce locations cannot be taken from the trader panel',typeof w.svc.act==='function' &&
      w.svc.act(33,'take','pearl').why==='unbound');
}
function whereThis(md) {
  const at = md.indexOf('## Where this is');
  return at < 0 ? '' : md.slice(at).replace(/\s+/g, ' ');
}
const qWhere = whereThis(questPage);
const mWhere = whereThis(minerPage);
yes('the quests page says the open quests and cooldowns are kept on the character and a restart keeps them',
    /kept on the character/.test(qWhere) && /restart of the server keeps them/.test(qWhere) &&
    !/kept in memory/.test(qWhere) && !/restart of the server clears them/.test(qWhere));
yes('the miner page says the same', /kept on the character/.test(mWhere) &&
    /restart of the server keeps them/.test(mWhere) && !/kept in memory/.test(mWhere) &&
    !/restart of the server clears them/.test(mWhere));

// A miner action owns its own quest fields. Other quest metadata can be
// newer than this controller, or malformed and awaiting explicit recovery.
{
  const untouched = { killHistory: {'86a88:Skyrim.esm': 7}, future: {format: 2},
    wolf: {kills: 'unreadable', credited: ['old-life'], extension: {hold: 'Whiterun'}},
    unknown: {drawn: 3, itemDesc: 'retained:item'} };
  forms[50] = {inv:{}, props:{[PROP]:{v:1, open:{wolf:untouched.wolf, futureQuest:untouched.unknown},
    cool:{futureQuest:clock.now+HOUR},killHistory:untouched.killHistory,future:untouched.future}}};
  ranks['50:miner']='master';w=restart();
  function preserved(phase) {
    const record=forms[50].props[PROP];
    yes(phase+': opaque root quest state survives', JSON.stringify(record.killHistory)===JSON.stringify(untouched.killHistory) &&
      JSON.stringify(record.future)===JSON.stringify(untouched.future));
    yes(phase+': unrelated malformed kill state survives verbatim', JSON.stringify(record.open.wolf)===JSON.stringify(untouched.wolf));
    yes(phase+': unknown quest and cooldown survive', JSON.stringify(record.open.futureQuest)===JSON.stringify(untouched.unknown) &&
      record.cool.futureQuest===clock.now+HOUR);
  }
  yes('a valid miner offer still opens beside retained quest fields',w.svc.offer(50,'ebony').ok===true);
  preserved('offer');
  for(let i=0;i<4;i++)w.svc.mineRare(50,here[0],EBONY);
  yes('mining still commits four goods beside retained fields',have(50,EBONY.ore)===4);
  preserved('draw');
  yes('the miner return still consumes its ask',w.svc.turnIn(50,'ebony').ok===true && have(50,EBONY.ore)===0);
  preserved('return');
  w=restart();w.svc.offer(50,'stalhrim');w.svc.walkAway(50,'stalhrim');
  preserved('abandon after restart');
}
{
  forms[51]={inv:{},props:{[PROP]:{v:1,open:{ebony:{drawn:0,kills:0,itemDesc:null,
    extension:{source:'future-format'}}},cool:{}}}};
  ranks['51:miner']='master';w=restart();w.svc.mineRare(51,here[0],EBONY);
  yes('a draw changes its known counter while retaining extra fields on the same quest',
    forms[51].props[PROP].open.ebony.drawn===1 && have(51,EBONY.ore)===1 &&
    forms[51].props[PROP].open.ebony.extension.source==='future-format');
}

{
  w=restart();
  const view=w.svc.describe(70,9000),kills=view.filter(q=>q.kind==='kill');
  yes('Whiterun traders show only their three authored kill contracts',kills.length===3 &&
    kills.some(q=>q.id==='wolf'&&q.locations==='White River Watch') && !kills.some(q=>q.id==='bear'));
  yes('a different hold cannot take a Whiterun contract',w.svc.act(70,'take','wolf',null,9001).why==='hold');
  npcStates[41].isDead=false;npcStates[41].lifeGeneration++;
  yes('the authenticated local trader accepts a bound kill contract',w.svc.act(70,'take','wolf',null,9000).ok===true);
  npcStates[41].isDead=true;
  yes('the authored body credits a saved quest once',w.svc.noteKill(70,41).ok===true &&
    forms[70].props[PROP].open.wolf.kills===1 && forms[70].props[PROP].killHistory['86a88:Skyrim.esm']===npcStates[41].lifeGeneration);
  w=restart();const before=JSON.stringify(forms[70]);
  yes('duplicate death after restart changes nothing',w.svc.noteKill(70,41).ok===false && JSON.stringify(forms[70])===before);
  yes('a different hold cannot pay the kill contract',w.svc.turnIn(70,'wolf',9001).why==='hold');
  yes('the local trader pays exactly the documented gold',w.svc.turnIn(70,'wolf',9000).ok===true && have(70,'f:Skyrim.esm')===25);
  yes('turn-in retains the consumed body history',forms[70].props[PROP].killHistory['86a88:Skyrim.esm']===npcStates[41].lifeGeneration);
}
{
  ranks['80:miner']='master';w=restart();w.svc.offer(80,'ebony');
  let entered=false;
  w.ctx.__questRankRead=function(){
    if(!entered){entered=true;w.svc.mineRare(80,here[0],EBONY);}
    return {v:1,cls:'miner',ranks:{miner:'master'}};
  };
  const result=w.svc.offer(80,'stalhrim');
  yes('a metadata offer refuses a snapshot superseded by a nested inventory commit',
    result.why==='unwritten' && forms[80].props[PROP].open.ebony.drawn===1 &&
    !forms[80].props[PROP].open.stalhrim && have(80,EBONY.ore)===1);
}
{
  ranks['81:miner']='master';w=restart();w.ctx.__identityToken='old-session';
  w.ctx.__questRankRead=function(){w.ctx.__identityToken='new-session';return {v:1,cls:'miner',ranks:{miner:'master'}};};
  const result=w.svc.offer(81,'ebony');
  yes('a metadata offer cannot cross its actor session during qualification',
    result.why==='unwritten' && !form(81).props[PROP]);
}

{
  ranks['82:miner']='master';w=restart();w.ctx.__identityToken='old';w.svc.offer(82,'ebony');
  w.ctx.__questRankRead=function(){w.ctx.__identityToken='new';return {v:1,cls:'miner',ranks:{miner:'master'}};};
  w.svc.mineRare(82,here[0],EBONY);
  yes('mining qualification cannot adopt a new actor session',have(82,EBONY.ore)===0 && forms[82].props[PROP].open.ebony.drawn===0);
}
{
  const fixture=require('./merchant-retrieval-fixture'),s=fixture.setup(),row=fixture.data.sources[0];
  s.w.ctx.__identityToken='old';
  const accepted=s.take(row).ok;
  s.sourceChange(function(){s.w.ctx.__identityToken='new';});
  s.pickup(row);
  yes('retrieval activation cannot adopt a new actor session',accepted && fixture.h.have(500,row.item)===0 &&
    fixture.h.form(500).props[PROP].open.satchel.drawn===0);
}

{
  ranks['84:miner']='master';w=restart();w.svc.offer(84,'ebony');let finish;
  w.ctx.swing=(a,anim,done)=>{finish=done;};w.svc.mineRare(84,here[0],EBONY);
  w.svc.offer(84,'stalhrim');finish();
  yes('a landing swing cannot adopt a newer quest record',have(84,EBONY.ore)===0);
}
{
  ranks['85:miner']='master';w=restart();w.svc.offer(85,'ebony');
  const saved=JSON.stringify(forms[85]);
  w.ctx.__identityToken='old';w.ctx.__thornswoodMerchantTrade.questReady=()=>{w.ctx.__identityToken='new';return true;};
  w.svc.act(85,'abandon','ebony');
  yes('trader readiness cannot adopt a replacement character session',JSON.stringify(forms[85])===saved);
}
{
  ranks['86:miner']='master';w=restart();w.svc.offer(86,'ebony');let wear=0;
  w.ctx.creditWork=()=>{w.ctx.__identityToken='new';};w.ctx.wearTool=()=>wear++;
  w.svc.mineRare(86,here[0],EBONY);
  yes('work credit cannot pass tool wear into a replacement session',have(86,EBONY.ore)===1 && wear===0);
}
{
  ranks['87:miner']='master';forms[87]={inv:{},props:{[PROP]:{v:1,open:{wolf:{kills:{toString:null,valueOf:null}}},
    cool:{futureQuest:{toString:null,valueOf:null}}}}};w=restart();let result;
  try{result=w.svc.offer(87,'ebony');}catch(error){}
  yes('unrelated malformed legacy fields cannot throw during a miner offer',result && result.ok===true);
}
{
  ranks['88:miner']='master';w=restart();w.svc.offer(88,'ebony');
  w.ctx.__identityToken='old';w.ctx.classGate=()=>{w.ctx.__identityToken='new';return null;};
  w.ctx.isVein=()=>true;w.ctx.ORES_BY_BASE={test:EBONY};w.ctx.ORE_ONE_PLACE=['Ebony Ore'];
  const start=gm.indexOf('function mineOre(actorId, refrId, baseDesc) {'),end=gm.indexOf('\n}\n',start)+2;
  vm.runInContext(gm.slice(start,end),w.ctx);w.ctx.mineOre(88,here[0],'test');
  yes('the outer mining caller cannot replace the session before rare-work capture',have(88,EBONY.ore)===0);
}
{
  ranks['89:miner']='master';w=restart();w.svc.offer(89,'ebony');let stopped=0;
  w.ctx.__identityToken='old';w.ctx.mining=()=>true;w.ctx.stopMining=()=>stopped++;
  w.ctx.__thornswoodMerchantTrade.questReady=()=>{w.ctx.__identityToken='new';return true;};
  w.svc.mineRare(89,here[0],EBONY);
  yes('readiness cannot stop a replacement session mining spell',stopped===0);
}
{
  const timers=[],writes=[];let runtime='100';
  const start=gm.indexOf('function swing(actorId, anim, lands, opts) {');
  const finish=gm.indexOf('\nconst SWING_QUIET',start);
  const ctx={mp:{set:(...args)=>writes.push(args),getActorRuntimeIdentity:()=>runtime},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},
    guard:(label,fn)=>fn,SWING_PROPERTY:'swing',SWING_STOP:'stop',SWING_FREE:'free',
    SWING_MS:2500,SWING_LAND_MS:900,SWING_QUIET:{},SWING_IN_AIR:{},SWING_CLEAR:{},log(){}};
  vm.createContext(ctx);vm.runInContext(gm.slice(start,finish),ctx);
  ctx.swing(90,'old',null,{alive:()=>{ctx.swing(90,'new',null,{});return true;}});
  timers[0].fn();
  yes('a cleanup validation callback cannot erase a newer swing',writes.at(-1)[2].anim==='new');
  ctx.swingEnd(91,1);const endTimer=timers.at(-1);
  ctx.swing(91,'new',null,{});const count=writes.length;endTimer.fn();
  yes('a mining-stop timer cannot erase a newer swing',writes.length===count);
  ctx.swingEnd(92,1);const revoked=timers.at(-1);runtime='101';const before=writes.length;revoked.fn();
  yes('a mining-stop timer cannot write into a replacement session',writes.length===before);
}
{
  w=restart();
  const {createQuestTransactions}=require('../game/quest-transactions');
  const {createKillContracts}=require('../game/kill-contracts');
  let record=null,inventory={entries:[{baseId:15,count:40}]};
  let receipt=JSON.stringify({actor:'ff000060:Skyrim.esm',profile:42,sequence:1}),saved='null',goods=0;
  const clone=x=>JSON.parse(JSON.stringify(x));
  const mp={getActorRuntimeIdentity:()=> '100',getNpcAIState:id=>id===96?
    {isHuman:true,profileId:42,lifeGeneration:0}:npcStates[id],
    getDescFromId:id=>id===96?'ff000060:Skyrim.esm':npcStates[id].ref,
    getIdFromDesc:desc=>desc==='f:Skyrim.esm'?15:npcIds[desc],
    get:(id,key)=>id===96?clone(key==='inventory'?inventory:record):w.ctx.mp.get(id,key),
    getInventoryReceipt:()=>receipt,getSavedInventoryReceipt:()=>saved,
    compareAndSetActorProperty(id,profile,change){
      if(profile!==42 || JSON.stringify(change.expected)!==JSON.stringify(record))return false;
      record=clone(change.replacement);return true;
    },
    compareAndSetInventoryAndProperty(id,before,old,next,sequence,profile,change){
      if(old!==receipt || JSON.stringify(change.expected)!==JSON.stringify(record))return false;
      goods++;inventory=clone(next);record=clone(change.replacement);
      receipt=JSON.stringify({actor:'ff000060:Skyrim.esm',profile,sequence});return true;
    }};
  const tx=createQuestTransactions({mp,withInventoryMutation:(id,fn)=>receipt===saved?
    fn({desc:'ff000060:Skyrim.esm',profileId:42},()=>true):{ok:false,why:'waiting'}});
  const kills=createKillContracts({mp,population:compactPopulation,raceOf:id=>npcStates[id].race,identity:tx.identity});
  const svc=w.ctx.__thornswoodCustomQuestsCreate({now:()=>clock.now,goldDesc:'f:Skyrim.esm',
    eligibility:w.ctx.MERCHANT_TRADING.createQuestEligibility({table:w.ctx.__thornswoodProgression.TABLE,
      spellIds:w.ctx.__thornswoodProgression.SPELL_IDS}),readCharacter:()=>({v:1,cls:'miner',ranks:{miner:'master'}}),
    load:()=>clone(record),commit:tx.commit,identity:tx.identity,available:tx.available,killContracts:kills,
    traderHold:()=> 'Whiterun'});
  for(const ref of kills.rows.find(r=>r.id==='camp').refs) {
    const state=npcStates[npcIds[ref]];state.isDead=false;state.lifeGeneration++;
  }
  yes('a contract opens through the real transaction path while an inventory save is pending',svc.offer(96,'camp').ok===true);
  for(const id of [31,32,33]){npcStates[id].isDead=true;svc.noteKill(96,id);}
  yes('three successive authored kills survive the real controller and transaction path',record.open.camp.kills===3);
  yes('kill progress leaves inventory and its unacknowledged receipt intact',goods===0 && inventory.entries[0].count===40 && saved==='null');
  yes('the camp reward stays fenced while inventory is unacknowledged',svc.turnIn(96,'camp',9000).ok===false && !!record.open.camp);
  saved=receipt;
  yes('acknowledged inventory permits exactly the authored camp reward',svc.turnIn(96,'camp',9000).ok===true && inventory.entries[0].count===85 && goods===1);
  yes('the completed contract cannot pay twice',svc.turnIn(96,'camp',9000).ok===false && goods===1);
}
{
  ranks['94:miner']='master';w=restart();w.svc.offer(94,'ebony');let armed=false,stopped=0;
  w.ctx.__runtimeIdentityApi={getNpcAIState:()=>({isHuman:true,profileId:7,lifeGeneration:0}),
    getDescFromId:()=> 'ff000094:Skyrim.esm',getActorRuntimeIdentity:()=>{
      if(armed){armed=false;w.svc.shutdown();}return '100';}};
  w.ctx.mining=()=>{armed=true;return true;};w.ctx.stopMining=()=>stopped++;
  w.svc.mineRare(94,here[0],EBONY);
  yes('an identity callback shutdown cannot stop replacement mining',stopped===0);
}
{
  const timers=[],writes=[];let publish=false;
  const start=gm.indexOf('function swing(actorId, anim, lands, opts) {');
  const finish=gm.indexOf('\nconst SWING_QUIET',start);
  const ctx={mp:{set:(...args)=>{writes.push(args);if(publish && args[2].end){publish=false;ctx.swing(95,'new',null,{});}},
    getActorRuntimeIdentity:()=> '100'},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout(){},
    guard:(label,fn)=>fn,SWING_PROPERTY:'swing',SWING_STOP:'stop',SWING_FREE:'free',
    SWING_MS:2500,SWING_LAND_MS:900,SWING_QUIET:{},SWING_IN_AIR:{},SWING_CLEAR:{},log(){}};
  vm.createContext(ctx);vm.runInContext(gm.slice(start,finish),ctx);
  publish=true;ctx.swingEnd(95,1);
  const before=writes.length;
  timers.filter(t=>t.ms===1500).forEach(t=>t.fn());
  yes('a swing-end publication cannot clear a newer animation',writes.length===before);
  timers.filter(t=>t.ms===3500).forEach(t=>t.fn());
  yes('the newer swing keeps its cleanup lease after swing-end publication',!ctx.SWING_IN_AIR[95]);
}
// Accepted legacy work must survive retirement of its former interaction point.
const legacyMines=[
  {id:'ebony',role:'Smith',name:'Ebony Ore',ore:EBONY.ore,cell:EBONY_CELL},
  {id:'gem',role:'Enchanter',name:'Ruby',ore:'63b42:Skyrim.esm',cell:RUBY_CELL,gem:'Ruby'},
  {id:'stalhrim',role:'Smith',name:'Stalhrim',ore:'2b06b:Dragonborn.esm',cell:'142ee:Dragonborn.esm'},
  {id:'heartstone',role:'Smith',name:'Heart Stone',ore:'17749:Dragonborn.esm',cell:'3929e:Dragonborn.esm'}
];
for(const [index,source] of legacyMines.entries()) {
  const actor=200+index;ranks[actor+':miner']='master';w=restart();
  yes(source.id+': legacy mine offer opens',w.svc.offer(actor,source.id,{gem:source.gem}).ok===true);
  const ask=w.svc.lineup().scarce.find(row=>row.id===source.id).ask,ref=vein(source.cell);
  for(let n=0;n<ask;n++)w.svc.mineRare(actor,ref,{name:source.name,ore:source.ore});
  form(actor).props[PROP].retained={unchanged:true};w=restart();
  w.ctx.__thornswoodMerchantTrade.questRole=id=>id===9100?source.role:id===9101?'Cook':null;
  w.ctx.__thornswoodMerchantTrade.questHold=()=> 'the Rift'; // legacy mines remain any-hold
  const before=JSON.stringify(forms[actor]);
  yes(source.id+': retired and wrong-role traders cannot return the work',
    w.svc.turnIn(actor,source.id,9000).why==='role' && w.svc.turnIn(actor,source.id,9101).why==='role' && JSON.stringify(forms[actor])===before);
  yes(source.id+': retained role finishes the saved mine after restart',w.svc.act(actor,'return',source.id,null,9100).ok===true);
  const after=JSON.stringify(forms[actor]);
  yes(source.id+': duplicate return changes nothing and opaque state remains',
    w.svc.turnIn(actor,source.id,9100).ok===false && JSON.stringify(forms[actor])===after && form(actor).props[PROP].retained.unchanged);
}
const contractRows=require('../game/kill-contracts').createKillContracts({mp:w.ctx.mp,population:compactPopulation,
  raceOf:id=>npcStates[id].race,identity:actor=>'actor:'+actor}).rows;
for(const [index,source] of contractRows.entries()) {
  const actor=210+index,role=['wolf','sabre','bear'].includes(source.id)?'Tailor':'Smith';w=restart();
  w.ctx.__thornswoodMerchantTrade.questHold=()=>source.hold;
  for(const ref of source.refs){npcStates[npcIds[ref]].isDead=false;npcStates[npcIds[ref]].lifeGeneration++;}
  yes(source.id+': legacy contract opens',w.svc.act(actor,'take',source.id,null,9000).ok===true);
  for(const ref of source.refs.slice(0,source.count)){const id=npcIds[ref];npcStates[id].isDead=true;w.svc.noteKill(actor,id);}
  form(actor).props[PROP].retained={unchanged:true};w=restart();
  w.ctx.__thornswoodMerchantTrade.questRole=id=>id===9100||id===9102?role:id===9101?'Cook':null;
  w.ctx.__thornswoodMerchantTrade.questHold=id=>id===9102?(source.hold==='Falkreath'?'Whiterun':'Falkreath'):source.hold;
  const before=JSON.stringify(forms[actor]);
  const newActor=240+index;
  yes(source.id+': direct new offer also requires its appointed specialist',
    w.svc.offer(newActor,source.id,{traderRef:9102}).why==='role' && !(forms[newActor] && forms[newActor].props[PROP]));
  yes(source.id+': wrong role, wrong hold and absent trader make no write',
    w.svc.act(actor,'return',source.id,null,9101).why==='role' &&
    w.svc.act(actor,'return',source.id,null,9102).why==='hold' &&
    w.svc.turnIn(actor,source.id,9000).why==='role' && JSON.stringify(forms[actor])===before);
  const reward=w.svc.lineup().scene.find(row=>row.id===source.id).gold;
  yes(source.id+': retained role pays the original reward after restart',
    w.svc.act(actor,'return',source.id,null,9100).ok===true && have(actor,'f:Skyrim.esm')===reward);
  const after=JSON.stringify(forms[actor]);
  yes(source.id+': another return cannot pay twice or remove saved fields',
    w.svc.act(actor,'return',source.id,null,9100).ok===false && JSON.stringify(forms[actor])===after && form(actor).props[PROP].retained.unchanged);
}
w=restart();ranks['230:miner']='master';
yes('a roleless live trader cannot open an unbound retrieval quest',
  w.svc.offer(260,'satchel',{traderRef:9000}).why==='unbound' && !(forms[260] && forms[260].props[PROP]));
w.ctx.__thornswoodMerchantTrade.questRole=id=>id===9100?'Smith':id===9101?'Enchanter':id===9102?'Tailor':null;
w.ctx.__thornswoodMerchantTrade.questHold=()=> 'Whiterun';
const oldTraderDesc=w.ctx.mp.getDescFromId;
w.ctx.mp.getDescFromId=id=>id===9100?'1a67c:Skyrim.esm':id===9101?'177da:Dragonborn.esm':
  id===9102?'1a684:Skyrim.esm':oldTraderDesc(id);
yes('the appointed Whiterun Smith displays its own contracts, without distant mine work',
  w.svc.describe(230,9100).map(row=>row.id).sort().join(',')==='camp,giant');
yes('an Enchanter displays the bound gem work only',w.svc.describe(230,9101).map(row=>row.id).join(',')==='gem');
yes('a Tailor displays the local wolf work only',w.svc.describe(230,9102).map(row=>row.id).join(',')==='wolf');
yes('a direct wrong-role offer cannot bypass the route',w.svc.offer(230,'ebony',{traderRef:9101}).why==='role');
// Change only a source-owned fixture definition, retaining the actual factory.
const gatedScene = block.replace('  var byId = {};',
  "  SCENE.find(function(row){return row.id==='wolf';}).gate={classKey:'miner',rank:'master'};\n  var byId = {};");
yes('the gated scene fixture changes exactly its source definition', gatedScene !== block);
npcStates[41].isDead=false; npcStates[41].lifeGeneration++;
ranks['300:miner']='advanced'; ranks['301:miner']='advanced';
w=boot(undefined,gatedScene);
const lockedScene=w.svc.describe(300,9000).find(row=>row.id==='wolf');
yes('a gated scene panel refuses insufficient standing',lockedScene && !lockedScene.canTake && lockedScene.state==='locked');
yes('a direct gated scene take refuses insufficient standing without a write',
  w.svc.offer(301,'wolf',{traderRef:9000}).ok===false && !forms[301]);
for(const boundary of ['rank','session','shutdown','metadata']) {
  const actor=310+['rank','session','shutdown','metadata'].indexOf(boundary);
  w=boot(undefined,gatedScene);
  let standing='master';
  w.ctx.__questRankRead=()=>({v:1,cls:'miner',ranks:{miner:standing}});
  w.ctx.__beforeQuestCommit=()=>{
    if(boundary==='rank')standing='advanced';
    if(boundary==='session')w.ctx.__identityToken='replacement';
    if(boundary==='shutdown')w.svc.shutdown();
    if(boundary==='metadata')w.ctx.__thornswoodProgression={};
  };
  const outcome=w.svc.offer(actor,'wolf',{traderRef:9000});
  yes('acceptance refuses '+boundary+' change at the transaction admission boundary',
    outcome.ok===false && !(forms[actor] && forms[actor].props[PROP]) && have(actor,'f:Skyrim.esm')===0);
}
{
  w=boot(undefined,gatedScene);let inCommit=false,snapshotRead=false,standing='master',lateIdentityReads=0;
  w.ctx.__runtimeIdentityApi={getNpcAIState:()=>({isHuman:true,profileId:7,lifeGeneration:0}),
    getDescFromId:()=> 'ff00013a:Skyrim.esm',getActorRuntimeIdentity:()=>{
      if(inCommit && snapshotRead){lateIdentityReads++;standing='advanced';}return '100';
    }};
  w.ctx.__beforeQuestCommit=()=>{inCommit=true;};
  w.ctx.__questRankRead=()=>{
    if(inCommit)snapshotRead=true;
    return {v:1,cls:'miner',ranks:{miner:standing}};
  };
  const outcome=w.svc.offer(314,'wolf',{traderRef:9000});
  yes('the final skill snapshot is the last native read before acceptance',
    outcome.ok===true && standing==='master' && snapshotRead && lateIdentityReads===0);
}
{
  const actor=315;w=restart();ranks[actor+':miner']='master';
  let standing='master';w.ctx.__questRankRead=()=>({v:1,cls:'miner',ranks:{miner:standing}});
  yes('a scarce contract opens before its mining rank changes',w.svc.offer(actor,'ebony',{traderRef:9000}).ok===true);
  w.ctx.__beforeQuestCommit=()=>{standing='advanced';};
  w.svc.mineRare(actor,here[0],EBONY);
  yes('scarce harvest checks ordinary class standing at the final inventory write',
    have(actor,EBONY.ore)===0 && forms[actor].props[PROP].open.ebony.drawn===0);
}
for(const action of ['return','abandon']) {
  const actor=action==='return'?320:321;
  w=boot(undefined,gatedScene);let standing='master';
  w.ctx.__questRankRead=()=>({v:1,cls:'miner',ranks:{miner:standing}});
  npcStates[41].isDead=false;npcStates[41].lifeGeneration++;
  yes('Master accepts the gated scene before losing standing for '+action,w.svc.offer(actor,'wolf',{traderRef:9000}).ok===true);
  standing='advanced';
  if(action==='return') {
    npcStates[41].isDead=true;w.svc.noteKill(actor,41);
    yes('accepted work retains its original reward after eligibility is lost',
      w.svc.turnIn(actor,'wolf',9000).ok===true && have(actor,'f:Skyrim.esm')===25);
  } else yes('accepted work remains cancellable after eligibility is lost',
    w.svc.walkAway(actor,'wolf').ok===true && !forms[actor].props[PROP].open.wolf);
}
const schools=['destruction','restoration','alteration','conjuration','illusion'];
for(const [index,school] of schools.entries()) {
  const mageSource=block.replace('  var byId = {};',
    "  SCENE.find(function(row){return row.id==='wolf';}).gate="+
    JSON.stringify({profession:'mage',school,rank:'master'})+';\n  var byId = {};');
  w=boot(undefined,mageSource);
  const P=w.ctx.__thornswoodProgression,other=schools.find(s=>s!==school);
  const master=P.TABLE.spells[school].master.find(name=>Object.hasOwn(P.SPELL_IDS,name));
  const lower=P.TABLE.spells[school].novice[0],wrong=P.TABLE.spells[other].master[0];
  let state={v:1,prof:'mage',schools:[school,other],ranks:{[school]:'master'},spells:{known:[master]}};
  w.ctx.__questRankRead=()=>state;
  npcStates[41].isDead=false;npcStates[41].lifeGeneration++;
  const actor=330+index, valid=state;
  for(const changed of [
    {...valid,spells:{known:[]}}, {...valid,spells:{known:[lower]}}, {...valid,spells:{known:[wrong]}},
    {...valid,spells:{known:['Unknown spell']}}, {...valid,ranks:{[school]:'expert'}},
    {...valid,schools:[other]}, {...valid,prof:'smith'},
    {...valid,spells:null,staffSpells:[P.SPELL_IDS[master]],inventory:[master]}
  ]) {
    state=changed;
    const shown=w.svc.describe(actor,9000).find(row=>row.id==='wolf');
    yes(school+': panel and direct take agree that missing Master evidence refuses',
      shown && shown.state==='locked' && !shown.canTake && !w.svc.offer(actor,'wolf',{traderRef:9000}).ok && !forms[actor]);
  }
  state=valid;
  yes(school+': learned mapped Master spell and standing permit panel and direct acceptance',
    w.svc.describe(actor,9000).find(row=>row.id==='wolf').canTake && w.svc.offer(actor,'wolf',{traderRef:9000}).ok===true);
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
