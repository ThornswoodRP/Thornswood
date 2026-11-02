// test-1380-rare-mines.js
//
// #1380. A rare seam is one place, shut until the scarce quest opens it, and
// the common seams come back on the miner page's clock. A swing takes 1 ore
// and has a chance of one more, by the rank table on that page, out of the
// same seam of twenty. Heart stone is master.
//
// The one place is the building Patrick named for each rare seam on 4 Oct,
// read here by name out of game/data/mine-buildings.json: every vein of that
// seam inside it is the place, and the same seam anywhere else stays shut.
// The trader's scarce quest opens it and the quest's cooldown on the server
// shuts it again. No steward has any part in it, on the pages or in the code.
//
// The numbers are read off docs/systems/classes/miner.md, so the page and the
// server cannot drift apart without this failing. The functions are lifted out
// of game/gamemode.js and run over a pretend world.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(REPO_DIR, 'game', 'gamemode.js'), 'utf8')).split(CR).join('');
const page = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'classes', 'miner.md'), 'utf8').split(CR).join('');
const oresJson = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'ores.json'), 'utf8'));
const buildOre = fs.readFileSync(path.join(REPO_DIR, 'scripts', 'dev', 'Build-OreTable.ps1'), 'utf8');
const questPage = fs.readFileSync(path.join(REPO_DIR, 'docs', 'systems', 'quests.md'), 'utf8').split(CR).join('');
const mineBuildings = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'game', 'data', 'mine-buildings.json'), 'utf8'));
const population = require('../game/data/npc-population.json');
const compactPopulation = {keep: population.npcs.filter(r => r.keep).map(r =>
  [r.ref,r.base,r.world||r.cell,r.pos,r.leash,r.returnMinutes,r.role,r.habitat,r.tier,r.cap,r.populationBucket,0,r.species])};

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
function tableAfter(md, head) {
  const at = md.indexOf(head);
  if (at < 0) { return []; }
  const rows = [];
  const lines = md.slice(at).split('\n');
  for (let i = 2; i < lines.length; i++) {
    if (lines[i].indexOf('|') !== 0) { break; }
    rows.push(lines[i].split('|').slice(1, -1).map(function (c) { return c.trim(); }));
  }
  return rows;
}

// ------------------------------------------------------------ the tables ---
const oresSrc = slice(gm, '  var ORES_BY_BASE = {', ';\n');
let ORES = null;
try { ORES = new Function('return ' + oresSrc.slice('  var ORES_BY_BASE = '.length).replace(/;$/, ''))(); } catch (e) { ORES = null; }
yes('ORES_BY_BASE reads', !!ORES && Object.keys(ORES).length === 581);
const names = {};
Object.keys(ORES || {}).forEach(function (k) { names[ORES[k].name] = ORES[k]; });

const RARE = ['Ebony Ore', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Stalhrim', 'Heart Stone'];
const RANKS = ['novice', 'advanced', 'expert', 'master'];

yes('every heart stone seam is master in the gamemode', Object.keys(ORES || {}).filter(function (k) {
  return ORES[k].name === 'Heart Stone';
}).every(function (k) { return ORES[k].rank === 'master'; }) && !!names['Heart Stone']);
yes('and in ores.json, with the reason under rankNamedOutright',
    Object.keys(oresJson.ores).filter(function (k) { return oresJson.ores[k].name === 'Heart Stone'; })
      .every(function (k) { return oresJson.ores[k].rank === 'master' && oresJson.detail[k].rank === 'master'; }) &&
    /^master: /.test(oresJson.rankNamedOutright.DLC2HeartStone));
yes('and the build script that writes both names it master',
    /'DLC2HeartStone'\s*=\s*@\{\s*Rank\s*=\s*'master'/.test(buildOre));
yes('ORES_BY_BASE is ores.json, row for row', !!ORES &&
    JSON.stringify(Object.keys(ORES)) === JSON.stringify(Object.keys(oresJson.ores)) &&
    Object.keys(ORES).every(function (k) { return JSON.stringify(ORES[k]) === JSON.stringify(oresJson.ores[k]); }));
yes('every row gives 1 to 2 a swing at its rank and above, and nothing below it',
    Object.keys(ORES || {}).every(function (k) {
      const need = RANKS.indexOf(ORES[k].rank);
      return need >= 0 && ORES[k].yield.every(function (p, t) {
        return t < need ? (p[0] === 0 && p[1] === 0) : (p[0] === 1 && p[1] === 2);
      });
    }));

// ------------------------------------------------------ the deposit block --
const depositTo = slice(gm, 'const DEPOSIT_PROPERTY = ', 'function mineOre(');
const depositAll = depositTo ? depositTo.slice(0, -'function mineOre('.length) : null;
const mineSrc = slice(gm, 'function mineOre(actorId, refrId, baseDesc) {', '\n}\n');
const lifted = !!depositAll && !!mineSrc && /function oreExtra\(/.test(depositAll) && /const ORE_ONE_PLACE = /.test(depositAll);
yes('the deposit, the chance of one more and mineOre are in the gamemode', lifted);

function world(opts) {
  opts = opts || {};
  const store = {};
  const inv = {};
  const said = [];
  const timers = [];
  const clock = { now: 1000000 };
  const rolls = (opts.rolls || []).slice();
  let stopped = 0;
  let works = 0;
  const glob = { __thornswoodQuests: opts.quests };
  const Mathy = Object.create(Math);
  Mathy.random = function () { return rolls.length ? rolls.shift() : 0.99; };
  const stubs = {
    mp: {
      get: function (id, key) { return store[id + '|' + key]; },
      set: function (id, key, v) { store[id + '|' + key] = v; }
    },
    log: function () {},
    Date: { now: function () { return clock.now; } },
    Math: Mathy,
    DEPOSIT_SIZE: 20,
    ORES_BY_BASE: ORES,
    isVein: function (d) { return !!ORES[d]; },
    classGate: function () { return null; },
    toolGate: function () { return null; },
    globalThis: glob,
    rankStep: function () { return opts.step || 0; },
    rankWord: function (r) { return r.charAt(0).toUpperCase() + r.slice(1); },
    mining: function () { return false; },
    stopMining: function () { stopped++; },
    swinging: function () { return false; },
    MINE_SESSION: {},
    MINE_TOOL: {},
    toolIdIn: function () { return 1; },
    miningGone: function () { return false; },
    MINE_MOST: 60,
    stillAt: function () { return true; },
    notify: function (a, m) { said.push(m); },
    say: function () {},
    addItem: function (a, item, n) {
      if (opts.noAdd && opts.noAdd.indexOf(item) >= 0) { return false; }
      inv[item] = (inv[item] || 0) + n; return true;
    },
    creditWork: function () { works++; return ''; },
    economyGathered: function () { },
    wearTool: function () { return ''; },
    setTimeout: function (fn) { timers.push(fn); },
    guard: function (n, fn) { return fn; },
    SWING_MS: 2500,
    SWING_LAND_MS: 900,
    SWING_MINE: 'IdlePickaxeEnter',
    swing: function (a, anim, done) { done(); }
  };
  const keys = Object.keys(stubs);
  const fn = new Function(keys.join(', '), depositAll + '\n' + mineSrc +
    '\nreturn { mineOre: mineOre, oreExtra: oreExtra, backMs: depositBackMs, left: depositLeft,' +
    ' PCT: ORE_EXTRA_PCT, TIERS: ORE_TIERS, ONE: ORE_ONE_PLACE };');
  const api = fn.apply(null, keys.map(function (k) { return stubs[k]; }));
  api.inv = inv; api.said = said; api.clock = clock; api.store = store;
  api.run = function () { let n = 0; while (timers.length && n < 200) { timers.shift()(); n++; } return n; };
  api.stopped = function () { return stopped; };
  api.works = function () { return works; };
  return api;
}

if (lifted && ORES) {
  const base = world();

  // ------------------------------------------------- the plan's clock -------
  const clockRows = tableAfter(page, '| Seams | Back in |');
  yes('the miner page has its clock table', clockRows.length === 5);
  let checked = 0, wrong = [];
  clockRows.forEach(function (row) {
    const mins = /^(\d+) minutes$/.exec(row[1]);
    if (!mins) { return; }
    row[0].split(',').map(function (w) { return w.trim().toLowerCase(); }).forEach(function (w) {
      const hit = Object.keys(names).filter(function (n) { return n.toLowerCase().indexOf(w) === 0; });
      if (hit.length !== 1) { wrong.push(w + ' names ' + hit.length + ' ores'); return; }
      checked++;
      if (base.backMs(hit[0]) !== Number(mins[1]) * 60000) { wrong.push(hit[0] + ' ' + base.backMs(hit[0])); }
    });
  });
  yes('every common seam comes back on the page\'s clock (' + checked + ' names' +
      (wrong.length ? '; wrong: ' + wrong.join(', ') : '') + ')', checked === 11 && wrong.length === 0);
  yes('iron is fifteen minutes and quicksilver is not silver\'s ten',
      base.backMs('Iron Ore') === 900000 && base.backMs('Quicksilver Ore') === 1800000 &&
      base.backMs('Silver Ore') === 600000);
  yes('a name nobody classified takes the longest wait', base.backMs('Some Modded Ore') === 1800000);
  yes('every common seam in the table has its own wait, not the fallback by accident',
      Object.keys(names).filter(function (n) { return RARE.indexOf(n) < 0; }).every(function (n) {
        return clockRows.some(function (row) {
          return /minutes/.test(row[1]) && row[0].toLowerCase().split(',').some(function (w) {
            return n.toLowerCase().indexOf(w.trim()) === 0;
          });
        });
      }));

  // ------------------------------------------------ the chance of one more --
  const pctRows = tableAfter(page, '| Your rank | Same ore | Next tier | Two tiers up |');
  const pagePct = pctRows.map(function (row) {
    return [1, 2, 3].map(function (i) { return row[i] ? Number(row[i].replace('%', '')) : 0; });
  });
  yes('the page has the four rank rows', pagePct.length === 4);
  yes('the server rolls the page\'s chances', JSON.stringify(pagePct) === JSON.stringify(base.PCT));
  const tierSentence = /The tiers are ([\s\S]*?)\. Ebony/.exec(page);
  const pageTiers = tierSentence ? tierSentence[1].replace(/\s+/g, ' ').split(/, then /).map(function (t) {
    return t.replace(/, and |, | and /g, ',').split(',').map(function (w) { return w.trim().toLowerCase(); });
  }) : [];
  yes('the server\'s tiers are the page\'s, in its order', pageTiers.length === 3 &&
      JSON.stringify(pageTiers) === JSON.stringify(base.TIERS.map(function (t) {
        return t.map(function (n) { return n.toLowerCase().replace(/ ore$/, ''); });
      })));

  function spread(seamName, step) {
    const seam = names[seamName];
    const got = { same: 0, other: {}, none: 0 };
    for (let i = 0; i < 10000; i++) {
      const x = base.oreExtra(seam, step, i / 10000);
      if (!x) { got.none++; continue; }
      if (x.name === seam.name) { got.same++; continue; }
      got.other[x.name] = (got.other[x.name] || 0) + 1;
    }
    return got;
  }
  // 10,000 even rolls: each per cent is 100 of them.
  const ironN = spread('Iron Ore', 0);
  yes('a novice at iron: 5% a second iron and nothing else', ironN.same === 500 && Object.keys(ironN.other).length === 0);
  const ironA = spread('Iron Ore', 1);
  const t2 = ['Corundum Ore', 'Silver Ore', 'Orichalcum Ore', 'Quicksilver Ore'];
  yes('an advanced at iron: 10% iron and 2% the next tier, split evenly',
      ironA.same === 1000 && t2.every(function (n) { return ironA.other[n] === 50; }) &&
      Object.keys(ironA.other).length === 4);
  const ironM = spread('Iron Ore', 3);
  const t3 = ['Gold Ore', 'Moonstone Ore', 'Malachite Ore'];
  const t3n = t3.map(function (n) { return ironM.other[n] || 0; });
  yes('a master at iron: 20% iron, 8% the next tier, 2% two tiers up (gold, moonstone, malachite)',
      ironM.same === 2000 && t2.every(function (n) { return ironM.other[n] === 200; }) &&
      t3n.reduce(function (a, b) { return a + b; }, 0) === 200 &&
      Math.max.apply(null, t3n) - Math.min.apply(null, t3n) <= 1);
  const goldM = spread('Gold Ore', 3);
  yes('a master at gold: the same-ore roll still stands, and nothing past the third tier',
      goldM.same === 2000 && Object.keys(goldM.other).length === 0);
  const corE = spread('Corundum Ore', 2);
  yes('an expert at corundum: 15% corundum, 5% the third tier, and the roll two tiers up gives nothing',
      corE.same === 1500 && t3.every(function (n) { return (corE.other[n] || 0) >= 166 && (corE.other[n] || 0) <= 167; }) &&
      Object.keys(corE.other).length === 3);
  const shellM = spread('Shellbug Chitin', 3);
  yes('shellbug chitin can give a second chitin and nothing else', shellM.same === 2000 && Object.keys(shellM.other).length === 0);
  let rareSeen = false, shellSeen = false;
  Object.keys(names).forEach(function (n) {
    for (let step = 0; step < 4; step++) {
      for (let i = 0; i < 1000; i++) {
        const x = base.oreExtra(names[n], step, i / 1000);
        if (!x) { continue; }
        if (RARE.indexOf(x.name) >= 0) { rareSeen = true; }
        if (x.name === 'Shellbug Chitin' && n !== 'Shellbug Chitin') { shellSeen = true; }
      }
    }
  });
  yes('ebony, a gem, stalhrim or heart stone is never an extra, from any seam at any rank', !rareSeen);
  yes('shellbug chitin is never an extra from another seam', !shellSeen);
  yes('a rare seam rolls nothing of its own', RARE.every(function (n) {
    return !names[n] || base.oreExtra(names[n], 3, 0) === null;
  }));

  // ------------------------------------------------ a spell at a seam -----
  const ironBase = Object.keys(ORES).find(function (k) { return ORES[k].name === 'Iron Ore'; });
  const goldDesc = names['Gold Ore'].ore;
  {
    // Roll under 5% on the first strike only: a second iron, two off the seam.
    const w = world({ step: 0, rolls: [0.01] });
    const first = w.mineOre(7, 0x100, ironBase);
    yes('a press at an iron seam starts a swing and says nothing', first === '');
    yes('the lucky strike hands two iron', w.inv[ORES[ironBase].ore] === 2);
    yes('and the seam is down two', w.left(0x100, 900000) === 18);
    w.run();
    yes('the rest of the seam comes one a swing, twenty in all', w.inv[ORES[ironBase].ore] === 20 &&
        w.left(0x100, 900000) === 0);
    yes('the lucky strike was one piece of work, so twenty ore took nineteen', w.works() === 19);
    yes('and the last swing says it is the last, and when it comes back',
        w.said.some(function (m) { return /last of this seam/.test(m) && /15 minutes/.test(m); }));
    w.clock.now += 899000;
    yes('a second short of fifteen minutes it is still worked out', w.left(0x100, 900000) === 0);
    w.clock.now += 1000;
    yes('and at fifteen minutes it is whole again', w.left(0x100, 900000) === 20);
  }
  {
    // A master swinging at iron, rolling two tiers up on every strike.
    const w = world({ step: 3, rolls: new Array(40).fill(0.29) });
    w.mineOre(8, 0x200, ironBase);
    w.run();
    const iron = w.inv[ORES[ironBase].ore] || 0;
    const gold = (w.inv[goldDesc] || 0) + (w.inv[names['Moonstone Ore'].ore] || 0) + (w.inv[names['Malachite Ore'].ore] || 0);
    yes('the extra comes out of the same twenty, whatever ore it is (' + iron + ' iron, ' + gold + ' third tier)',
        iron + gold === 20 && iron === 10 && w.left(0x200, 900000) === 0);
    yes('and the extra that takes the last one ends the spell, saying so',
        w.said.some(function (m) { return /last of this seam/.test(m); }) && w.stopped() >= 1);
  }
  {
    // The last ore of the seam rolls lucky: there is nothing left for an extra.
    const rolls = new Array(19).fill(0.99).concat([0.01]);
    const w = world({ step: 0, rolls: rolls });
    w.mineOre(9, 0x300, ironBase);
    w.run();
    yes('a seam holds twenty: the swing that takes the last one finds no extra',
        w.inv[ORES[ironBase].ore] === 20 && w.left(0x300, 900000) === 0);
  }
  {
    // The extra cannot be handed over: the seam keeps it.
    const w2 = world({ step: 3, rolls: [0.29], noAdd: [goldDesc, names['Moonstone Ore'].ore, names['Malachite Ore'].ore] });
    w2.mineOre(9, 0x301, ironBase);
    yes('an extra the load order cannot hand over leaves the seam as it was', w2.left(0x301, 900000) === 19);
  }

  // ------------------------------------------------ the one place --------
  const rareBases = Object.keys(ORES).filter(function (k) { return RARE.indexOf(ORES[k].name) >= 0; });
  yes('the one-place list is the page\'s ebony, gems, stalhrim and heart stone',
      JSON.stringify(base.ONE.slice().sort()) === JSON.stringify(RARE.slice().sort()));
  {
    const w = world({ step: 3, quests: undefined });
    const shut = rareBases.every(function (k) { return w.mineOre(1, 0x400, k) === 'This place is shut.'; });
    yes('with no quest service at all, every rare vein (' + rareBases.length + ') answers shut', shut);
    yes('and nothing came out of any of them', Object.keys(w.inv).length === 0 &&
        Object.keys(w.store).length === 0);
  }

  const qStart = '// ==== thornswood custom quests ====';
  const qEnd = '// ==== end thornswood custom quests ====';
  const qBlock = slice(gm, qStart, qEnd);
  yes('the custom quests block is in the gamemode', !!qBlock);
  if (qBlock) {
    const ctx = { console: console, Map: Map, Set: Set, Date: Date, Math: Math, Number: Number,
      String: String, Buffer: Buffer, JSON: JSON, Object: Object, Array: Array, RegExp: RegExp, Error: Error };
    ctx.globalThis = ctx;
    vm.createContext(ctx);
    const eligibility=require('./quest-eligibility-fixture')(ctx,gm);
    vm.runInContext(qBlock, ctx);
    const inv = {};
    const ranks = { '1:miner': 'master', '2:miner': 'expert', '3:miner': 'master' };
    const kept = {};
    const svc = ctx.__thornswoodCustomQuestsCreate({
      eligibility,readCharacter:a=>({v:1,cls:'miner',ranks:{miner:ranks[a+':miner']}}),
      now: function () { return 5000; },
      goldDesc: 'f:Skyrim.esm',
      // Each person's quests are kept on the character (#1621).
      load: function (a) { return kept[a] ? JSON.parse(kept[a]) : undefined; },
      save: function (a, rec) { kept[a] = JSON.stringify(rec); },
      identity: function (a) {return 'actor:'+a;},
      commit: function (a, expected, next, changes) {
        const pack=Object.assign({},inv);
        for (const change of changes) {
          const key=a+'|'+change.item,count=(pack[key]||0)+change.count;
          if(count<0)return {ok:false};
          pack[key]=count;
        }
        Object.assign(inv,pack);kept[a]=JSON.stringify(next);return {ok:true};
      },
      addItem: function (a, item, n) { inv[a + '|' + item] = (inv[a + '|' + item] || 0) + n; return true; },
      takeItem: function (a, item, n) {
        if ((inv[a + '|' + item] || 0) < n) { return false; }
        inv[a + '|' + item] -= n; return true;
      },
      classGate: function () { return null; },
      toolGate: function () { return null; },
      mining: function () { return false; },
      stopMining: function () {},
      swinging: function () { return false; },
      toolIdIn: function () { return 1; },
      swing: function (a, anim, done) { done(); },
      swingAnim: 'mine',
      notify: function () {},
      say: function () {},
      creditWork: function () { return null; },
      economyGathered: function () { },
      wearTool: function () { return null; },
      cellOf: function (id) { return ({ 0x600: 'mine-a', 0x601: 'mine-b' })[id] || ''; }
    });
    const w = world({ step: 3, quests: svc });
    const heart = rareBases.find(function (k) { return ORES[k].name === 'Heart Stone'; });
    const ebony = rareBases.find(function (k) { return ORES[k].name === 'Ebony Ore'; });
    yes('a master miner without the quest finds the heart stone shut', w.mineOre(1, 0x500, heart) === 'This place is shut.');
    yes('an expert miner is told heart stone takes a master',
        /Master Miner/.test(w.mineOre(2, 0x500, heart)) && svc.offer(2, 'heartstone').ok === false);
    yes('the trader\'s quest opens to a master miner', svc.offer(1, 'heartstone').ok === true);
    yes('and while no place is bound, the quest opens no vein in the world',
        rareBases.every(function (k) { return w.mineOre(1, 0x500, k) === 'This place is shut.'; }));
    svc.bindPlace('ebony', { cell: 'mine-a' });
    yes('with the ebony place bound, the quest holder works it',
        svc.offer(3, 'ebony').ok === true && w.mineOre(3, 0x600, ebony) === '' &&
        inv['3|' + ORES[ebony].ore] === 1);
    yes('and an ebony vein in any other building stays shut to them', w.mineOre(3, 0x601, ebony) === 'This place is shut.');
    yes('and the bound place stays shut to somebody without the quest', w.mineOre(1, 0x600, ebony) === 'This place is shut.');
    yes('the rare place never touches the deposit of twenty', Object.keys(w.store).length === 0);
  }
}

// ------------------------------------------- the places the server binds ---
// The block is run the way the server starts it, with mp and addItem there, so
// the binding under test is the one the dev server makes, not one this file
// makes. Each building is looked up by Patrick's name in mine-buildings.json,
// which keys a building by its cell, the same key a vein's locationalData has.
const PLACES = [
  { seam: 'Ebony Ore', quest: 'ebony', building: 'Raven Rock Mine' },
  { seam: 'Stalhrim', quest: 'stalhrim', building: 'Kolbjorn Barrow' },
  { seam: 'Heart Stone', quest: 'heartstone', building: 'Coldcinder Cave' },
  { seam: 'Ruby', quest: 'gem', building: 'White Ridge Sanctum' },
  { seam: 'Sapphire', quest: 'gem', building: 'Highpoint Tower' },
  { seam: 'Emerald', quest: 'gem', building: 'Kolbjorn Barrow' },
  { seam: 'Amethyst', quest: 'gem', building: 'Highpoint Tower' }
];
const ROWS = { ebony: { ask: 4, holds: 12, hours: 24 }, gem: { ask: 2, holds: 6, hours: 24 },
  stalhrim: { ask: 3, holds: 8, hours: 24 }, heartstone: { ask: 3, holds: 8, hours: 24 } };
const buildingCell = {};
Object.keys(mineBuildings.buildings).forEach(function (cell) {
  const b = mineBuildings.buildings[cell];
  (buildingCell[b.name] = buildingCell[b.name] || []).push(cell);
});
function cellOfBuilding(name) { return (buildingCell[name] || []).length === 1 ? buildingCell[name][0] : null; }
yes('each of Patrick\'s seven buildings is one building in mine-buildings.json, holding its seam',
    PLACES.every(function (p) {
      const cell = cellOfBuilding(p.building);
      return !!cell && (mineBuildings.buildings[cell].ores[p.seam] || 0) >= 1;
    }));

const qBlock2 = slice(gm, '// ==== thornswood custom quests ====', '// ==== end thornswood custom quests ====');
if (ORES && qBlock2) {
  const clock = { now: 1000000 };
  const inv = {};
  const veinCell = {};
  const ranks = {};
  const logged = [];
  // The custom properties on each character, as the server keeps them (#1621).
  const made = {};
  const props = {};
  const orchardRows=require('../game/data/merchant-orchard.json').sources;
  const orchardIds=new Map(orchardRows.map((row,i)=>[row.reference,0x6000000+i]));
  const unusedOrchard=function(){throw new Error('The rare-mine fixture must not work an orchard plot.');};
  const ctx = { console: console, Map: Map, Set: Set, Math: Math, Number: Number, String: String,
    require: require,
    Buffer: Buffer, JSON: JSON, Object: Object, Array: Array, RegExp: RegExp, Error: Error,
    Date: { now: function () { return clock.now; } },
    NPC_POPULATION_DATA: compactPopulation,
    raceEdidOf: function () { throw new Error('The rare-mine fixture must not query a kill target.'); },
    MERCHANT_TRADING: {createKillContracts: require('../game/kill-contracts').createKillContracts,
      orchardSources:()=>({sources:orchardRows}),
      createQuestOrchardSources:()=>({verify:unusedOrchard}),
      orchardPlots:{createOrchardStorage:()=>({}),createOrchardPlots:()=>({available:()=>true,shutdown(){},read:unusedOrchard,write:unusedOrchard})},
      createQuestTransactions: function () {
      return {available: function () {return true;}, identity: function (a) {return 'actor:'+a;}, shutdown: function () {},
        commit: function (a, expected, next, changes, admission) {
          if(admission!==undefined && admission()!==true)return {ok:false};
          const pack=Object.assign({},inv);
          for (const change of changes) {
            const key=a+'|'+change.item,count=(pack[key]||0)+change.count;
            if(count<0)return {ok:false};
            pack[key]=count;
          }
          Object.assign(inv,pack);props[a+'|thornswoodQuests']=JSON.stringify(next);return {ok:true};
        }
      };
    }},
    mp: {
      getServerSettings:()=>({}),
      writeFileWhole:unusedOrchard,
      getIdFromDesc:desc=>orchardIds.get(desc),
      makeProperty: function (name) { made[name] = true; },
      get: function (id, key) {
        if (key === 'thornswoodCharacter') {
          const savedRanks = {};
          Object.keys(ranks).forEach(function (entry) {
            const prefix = id + ':';
            if (entry.indexOf(prefix) === 0) savedRanks[entry.slice(prefix.length)] = ranks[entry];
          });
          return {v: 1, cls:'miner', ranks: savedRanks};
        }
        if (key === 'locationalData') { return veinCell[id] ? { cellOrWorldDesc: veinCell[id], pos: [0, 0, 0] } : undefined; }
        return props[id + '|' + key] ? JSON.parse(props[id + '|' + key]) : undefined;
      },
      set: function (id, key, v) {
        if (!made[key]) { throw new Error('Property \'' + key + '\' doesn\'t exist'); }
        props[id + '|' + key] = JSON.stringify(v);
      },
      getDescFromId: function (id) {return orchardRows[id-0x6000000]?.reference || '';}
    },
    log: function () { logged.push([].slice.call(arguments).join(' ')); },
    idOf: function () { return 0; },
    addItem: function (a, item, n) { inv[a + '|' + item] = (inv[a + '|' + item] || 0) + n; return true; },
    takeItem: function (a, item, n) {
      if ((inv[a + '|' + item] || 0) < n) { return false; }
      inv[a + '|' + item] -= n; return true;
    },
    classGate: function () { return null; },
    toolGate: function () { return null; },
    mining: function () { return false; },
    stopMining: function () {},
    swinging: function () { return false; },
    toolIdIn: function () { return 1; },
    swing: function (a, anim, done) { done(); },
    SWING_MINE: 'mine',
    notify: function () {},
    say: function () {},
    creditWork: function () { return null; },
    economyGathered: function () { },
    wearTool: function () { return null; }
  };
  ctx.globalThis = ctx;
  let traderOpen=true;
  ctx.__thornswoodMerchantTrade = {questReady: function () {return true;},
    questRole: function(ref){return ref===9000?'':null;},
    questAdmission: function(a,ref){return traderOpen && ref===9000 ? function(){return traderOpen;} : null;}};
  ctx.__thornswoodCharacter = { PROPERTY: 'thornswoodCharacter' };
  vm.createContext(ctx);
  require('./quest-eligibility-fixture')(ctx,gm);
  vm.runInContext(qBlock2, ctx);
  const svc = ctx.__thornswoodQuests;
  yes('the server starts the quest service', !!svc && !!svc.mineRare && logged.length === 0);
  traderOpen=false;
  yes('rare work needs an actual trader conversation before the pack or quests change',
    svc.offer(99,'ebony',{traderRef:9000}).why==='session' && !props['99|thornswoodQuests']);
  traderOpen=true;
  const ore = function (seam) { return names[seam] && names[seam].ore; };
  const seamOf = function (seam) { return { name: seam, ore: ore(seam) }; };
  let nextRef = 0x9000;
  function vein(cell) { const ref = nextRef++; veinCell[ref] = cell; return ref; }
  let actor = 100;

  PLACES.forEach(function (p) {
    const cell = cellOfBuilding(p.building);
    const row = ROWS[p.quest];
    const a = actor++;
    ranks[a + ':miner'] = 'master';
    const opts = p.quest === 'gem' ? { gem: p.seam, traderRef:9000 } : {traderRef:9000};
    const here = [vein(cell), vein(cell)];
    const other = Object.keys(mineBuildings.buildings).filter(function (c) {
      return c !== cell && (mineBuildings.buildings[c].ores[p.seam] || 0) > 0;
    }).map(vein);
    const outside = vein('3c:Skyrim.esm');
    yes(p.seam + ': shut at ' + p.building + ' without the quest', svc.mineRare(a, here[0], seamOf(p.seam)) === 'This place is shut.');
    yes(p.seam + ': the trader\'s quest opens to a master miner', svc.offer(a, p.quest, opts).ok === true);
    let got = 0;
    for (let i = 0; i < row.holds; i++) { if (svc.mineRare(a, here[i % 2], seamOf(p.seam)) === '') { got++; } }
    yes(p.seam + ': every vein of it inside ' + p.building + ' is the place, ' + row.holds + ' in all',
        inv[a + '|' + ore(p.seam)] === row.holds && got === row.holds);
    yes(p.seam + ': and nothing more until the turn-in',
        /nothing left/.test(svc.mineRare(a, here[1], seamOf(p.seam))) && inv[a + '|' + ore(p.seam)] === row.holds);
    const b = actor++;
    ranks[b + ':miner'] = 'master';
    svc.offer(b, p.quest, opts);
    yes(p.seam + ': the same seam in ' + other.length + ' other building(s) and on open ground stays shut',
        other.concat([outside]).every(function (r) { return svc.mineRare(b, r, seamOf(p.seam)) === 'This place is shut.'; }) &&
        !inv[b + '|' + ore(p.seam)]);
    yes(p.seam + ': turned in, the ask goes and the extra stays',
        svc.turnIn(a, p.quest,9000).ok === true && inv[a + '|' + ore(p.seam)] === row.holds - row.ask);
    yes(p.seam + ': then the place is shut to that person',
        svc.mineRare(a, here[0], seamOf(p.seam)) === 'This place is shut.' && svc.offer(a, p.quest, opts).why === 'cooldown');
    yes(p.seam + ': while somebody else holding the quest works it', svc.mineRare(b, here[0], seamOf(p.seam)) === '');
    svc.walkAway(b, p.quest);
    clock.now += row.hours * 3600000 - 1;
    yes(p.seam + ': the cooldown is the quest\'s ' + row.hours + ' hours on the server', svc.offer(a, p.quest, opts).why === 'cooldown');
    clock.now += 1;
    yes(p.seam + ': and then the trader can open it again', svc.offer(a, p.quest, opts).ok === true);
    svc.walkAway(a, p.quest);
  });

  // A gem quest is for the gem the trader names: Highpoint Tower holds ruby
  // and emerald veins too, and those are not the ruby or the emerald place.
  const tower = cellOfBuilding('Highpoint Tower');
  const g = actor++;
  ranks[g + ':miner'] = 'master';
  svc.offer(g, 'gem', { gem: 'Ruby',traderRef:9000 });
  yes('a ruby quest finds the Highpoint Tower rubies shut', svc.mineRare(g, vein(tower), seamOf('Ruby')) === 'This place is shut.');
  yes('and a sapphire vein at the ruby place is not the ruby',
      svc.mineRare(g, vein(cellOfBuilding('White Ridge Sanctum')), seamOf('Sapphire')) === 'This place is shut.');
  svc.walkAway(g, 'gem');
  svc.offer(g, 'gem', { gem: 'Emerald',traderRef:9000 });
  yes('an emerald quest finds the Highpoint Tower emerald shut', svc.mineRare(g, vein(tower), seamOf('Emerald')) === 'This place is shut.');
  svc.walkAway(g, 'gem');
  const s = actor++;
  ranks[s + ':miner'] = 'master';
  svc.offer(s, 'stalhrim',{traderRef:9000});
  yes('a stalhrim quest finds the stalhrim in Raven Rock Mine shut',
      svc.mineRare(s, vein(cellOfBuilding('Raven Rock Mine')), seamOf('Stalhrim')) === 'This place is shut.');
  yes('a vein the server cannot place answers shut', svc.mineRare(s, 0x7fff, seamOf('Stalhrim')) === 'This place is shut.');
  svc.walkAway(s, 'stalhrim');
}

// ------------------------------------------------------ the pages agree ---
const placeRows = tableAfter(page, '| Seam | The one place |');
yes('the miner page names the seven places, as the server binds them',
    placeRows.length === 7 && PLACES.every(function (p) {
      return placeRows.some(function (r) {
        return p.seam.toLowerCase().indexOf(r[0].toLowerCase()) === 0 && r[1] === p.building;
      });
    }));
yes('the quests page names each building too', PLACES.every(function (p) {
  return questPage.replace(/\s+/g, ' ').indexOf(p.building) >= 0;
}));
yes('neither page brings a steward into the rare place',
    !/steward/i.test(page) && !/steward/i.test(questPage));
yes('the server block gives a steward no part in it',
    !/steward/i.test((qBlock2 || '').replace(/No steward has any part in it\./, '')));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
