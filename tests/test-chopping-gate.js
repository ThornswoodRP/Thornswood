// test-chopping-gate.js
//
// A press on Solstheim's ash chopping block is gated exactly as a press on the
// common block is: firewood for a Woodwright, the Woodwright refusal for
// anybody else.
//
// WHAT WAS FOUND. The chopping blocks fix of 24 September (#321) read every
// placed block in the load order and saw that "Dragonborn.esm's
// DLC2WoodChoppingBlockAsh (3828b, 3 placed on Solstheim) is not in the
// gamemode's CHOPPING_BLOCKS, so those blocks are outside the Woodwright
// rules."
//
// WHAT WAS MEASURED. Every FURN record in the load order, read out of
// C:\Thornswood\Game\Data with the profile's plugins.txt, last one wins, on
// 24 September:
//
//   7022e:Skyrim.esm      WoodChoppingBlock         107 placed
//   3828b:Dragonborn.esm  DLC2WoodChoppingBlockAsh    3 placed, all in
//                                                     DLC2SolstheimWorld
//
// Both: MODL Furniture\Clutter\WoodChoppingBlock.nif; KWDA FurnitureSpecial,
// FurnitureWoodChoppingBlock, FurnitureForce3rdPerson; WBDT 00ff (not a
// bench); MNAM 01000048; ENAM 00000000; FNPR 01000600; VMAD
// ResourceFurnitureScript. No plugin overrides 3828b. So it is the same
// furniture used the same way, and the only thing that treated it
// differently was the list of bases in the gamemode.
//
// So this RUNS the real activate handler out of the gamemode, with the real
// chopping block section, the real bench gate and its tables, the real
// halfGate and the character block's real gateHalf, and the real loot()
// that a press nobody claims falls through to. What is pretend: the people
// (their trade and whether they carry an axe), the inventory write, and the
// branches for shrines, crops, fish, game, plants and seams, which answer
// no for both bases. That last is checked rather than assumed below: neither
// base is named anywhere in the gamemode's code outside CHOPPING_BLOCKS, and
// every one of those tables is keyed by the same descriptor string.
//
// Before the change a press on 3828b fell through every branch to loot(),
// which answers null for a thing that is not an actor, so the handler
// returned nothing and the engine sat whoever pressed it down to swing.
// chopWood never ran: no Woodwright was paid and nobody was refused.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* From `from` to the first `end` after it, inclusive, or null. */
function cut(from, end) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

/* One top level `const NAME = {...};` line, parsed. */
function table(name) {
  const m = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm').exec(src);
  if (!m) { return null; }
  try { return JSON.parse(m[1]); } catch (e) { return null; }
}

const ASH = '3828b:Dragonborn.esm';
const COMMON = '7022e:Skyrim.esm';

// The chopping block section runs from the list of bases to the end of
// chopWood, and carries CHOP_AT, choppedSwing, BLOCKS_OFF and blockIsOff.
const chopA = src.indexOf('const CHOPPING_BLOCKS = [');
const chopB = chopA < 0 ? -1 : src.indexOf('\n}\n', src.indexOf('function chopWood(', chopA));
const chopping = (chopA >= 0 && chopB >= 0) ? src.slice(chopA, chopB + 3) : null;
const handler = cut("mp.onActivate = guard('onActivate', function (refrId, casterRefrId) {", '\n});\n');
const loot = cut('function loot(actorId, refrId, baseDesc) {', '\n}\n');
const benchGate = cut('function benchGate(actorId, baseDesc) {', '\n}\n');
const halfGate = cut('function halfGate(actorId, half, rank, refusal) {', '\n}\n');
const gateHalf = cut('  function gateHalf(actorId, half, rank, refusal) {', '\n  }\n');
const allowM = /^const ALLOW = \{ thornswoodAllow: true \};$/m.exec(src);
const noProfM = /var NO_PROFESSION = '([^']*)';/.exec(src);
const STATIONS = table('STATIONS');
const ITEMS = table('ITEMS');
const BENCH_BY_BASE = table('BENCH_BY_BASE');
const BENCH_ACCESS = table('BENCH_ACCESS');

yes('the chopping block section is in the gamemode', chopping !== null);
yes('the activate handler is in the gamemode', handler !== null);
yes('loot, the bench gate and both half gates are in the gamemode',
    loot !== null && benchGate !== null && halfGate !== null && gateHalf !== null);
yes('ALLOW, NO_PROFESSION, STATIONS, ITEMS and the bench tables read',
    !!allowM && !!noProfM && !!STATIONS && !!ITEMS && !!BENCH_BY_BASE && !!BENCH_ACCESS);

// ------------------------------------------------------------- the list
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const listM = /const CHOPPING_BLOCKS = \[([^\]]*)\];/.exec(code);
  const list = listM ? (listM[1].match(/'[^']*'/g) || []).map(function (s) { return s.slice(1, -1); }) : [];
  yes('CHOPPING_BLOCKS names the common block ' + COMMON, list.indexOf(COMMON) >= 0);
  yes('CHOPPING_BLOCKS names the ash block ' + ASH + ' (it names ' + list.join(', ') + ')',
      list.indexOf(ASH) >= 0);

  // Nothing ahead of the chopping branch can claim either base, and no
  // generated table carries them: every table the chain asks is keyed by the
  // same descriptor string, so a base the code never spells is in none.
  [COMMON, ASH].forEach(function (base) {
    let n = 0, at = code.indexOf(base), inList = 0;
    const listAt = listM ? listM.index : -1;
    const listEnd = listM ? listM.index + listM[0].length : -1;
    while (at >= 0) {
      n++;
      if (at > listAt && at < listEnd) { inList++; }
      at = code.indexOf(base, at + 1);
    }
    yes('the code spells ' + base + ' only in CHOPPING_BLOCKS (' + n + ' times, ' +
        inList + ' in the list)', n === 1 && inList === 1);
    yes('and the bench table does not carry ' + base,
        !!BENCH_BY_BASE && !Object.prototype.hasOwnProperty.call(BENCH_BY_BASE, base));
  });
}

// ------------------------------------------------------------- the world
//
// Reference ids are the runtime ones: Dragonborn.esm is load index 04 and
// Skyrim.esm 00. Positions are the placed references' own, from the same read.
const REFS = {
  // Tamriel, a common block on the road out of Solitude, nowhere near
  // Djinn's three points (test-chopping-blocks.js has it at the same spot).
  0x000b3949: { base: COMMON, pos: [-75967.2734, 90795.7109, -13881.7363] },
  // The three ash blocks, DLC2SolstheimWorld.
  0x0402b1a4: { base: ASH, pos: [29909.4, 37515.2, 422.5] },
  0x0402c097: { base: ASH, pos: [28899.5, 32814.7, 368.0] },
  0x04039d0f: { base: ASH, pos: [29602.5, 38996.3, 609.1] },
  // Dragon Bridge, one of Djinn's three, which nobody works.
  0x000abf83: { base: COMMON, pos: [-101831.9688, 80606.4531, -12516.9336] }
};
const ASH_REFS = [0x0402b1a4, 0x0402c097, 0x04039d0f];

const RANKS = ['novice', 'apprentice', 'adept', 'advanced', 'master'];
const PEOPLE = {
  // A Woodwright with a woodcutter's axe.
  wright: { prof: 'woodworker', half: 'woodwright', ranks: { woodwright: 'novice' }, axe: true },
  // A Smith, Edgewright, a master of it, carrying an axe, so the only thing
  // that can refuse them at a block is the trade.
  smith: { prof: 'smith', half: 'edgewright', ranks: { edgewright: 'master' }, axe: true },
  // Somebody who has not pressed K yet.
  fresh: { prof: null, half: null, ranks: {}, axe: true },
  // A Woodwright who left the axe at home.
  bare: { prof: 'woodworker', half: 'woodwright', ranks: { woodwright: 'novice' }, axe: false }
};
const ACTOR = { wright: 0x14000001, smith: 0x14000002, fresh: 0x14000003, bare: 0x14000004 };
const WHO = {};
Object.keys(ACTOR).forEach(function (k) { WHO[ACTOR[k]] = PEOPLE[k]; });

/*
  One server. Everything the handler and chopWood can reach is either the
  gamemode's own code or a recorder here, and every recorder says which
  branch it stands in for, so a press that goes somewhere unexpected shows.
*/
function server() {
  const clock = { now: 1700000000000 };
  const trail = [];         // which pretend branch was asked
  const told = [];          // notify
  const said = [];          // say
  const given = [];         // addItem
  const reads = [];         // mp.get keys
  const kicks = [];         // swingEnd (#842 refuse kick)
  const G = {};

  function branch(name, answer) {
    return function () { trail.push(name); return answer; };
  }

  const mp = {
    get: function (id, key) {
      reads.push(key);
      const r = REFS[id];
      if (key === 'baseDesc') { if (!r) { throw new Error('no such reference'); } return r.base; }
      if (key === 'pos') { if (!r) { throw new Error('no such reference'); } return r.pos.slice(); }
      if (key === 'type') { return r ? 'MpObjectReference' : 'MpActor'; }
      throw new Error('this harness does not answer ' + key);
    }
  };

  const names = [
    'mp', 'guard', 'globalThis', 'log', 'notify', 'say', 'Date',
    'STATIONS', 'ITEMS', 'BENCH_BY_BASE', 'BENCH_ACCESS', 'NO_PROFESSION',
    'stateOf', 'P', 'toolGate', 'addItem', 'creditWork', 'wearTool',
    'kindIsContainer', 'mineSalt', 'burnCharcoal', 'SHRINES', 'bless',
    'isCrop', 'farmActivate', 'isFish', 'fish', 'isGame', 'game',
    'isPlant', 'harvest', 'putBack', 'isVein', 'mineOre',
    'isCarcass', 'HUNTS_BY_BASE', 'classGate', 'swingEnd'
  ];
  const body = 'function economyGathered() { }\n' + allowM[0] + '\n' + halfGate + '\n' + gateHalf + '\n' + benchGate + '\n' +
    loot + '\n' + chopping + '\n' +
    'globalThis.__thornswoodCharacter = { gateHalf: gateHalf };\n' +
    handler + '\n' +
    'return { press: mp.onActivate, swing: choppedSwing, CHOP_AT: CHOP_AT, ' +
    'isChoppingBlock: isChoppingBlock, blockIsOff: blockIsOff, ALLOW: ALLOW };';
  const fn = Function.apply(null, names.concat([body]));
  const api = fn(
    mp,
    function (name, f) { return f; },
    G,
    function () { },
    function (id, text) { told.push({ id: id, text: String(text) }); },
    function (id, text) { said.push({ id: id, text: String(text) }); },
    { now: function () { return clock.now; } },
    STATIONS, ITEMS, BENCH_BY_BASE, BENCH_ACCESS, noProfM[1],
    function (id) { return WHO[id] || { prof: null, half: null, ranks: {} }; },
    {
      canWork: function (s, half, rank) {
        const have = s && s.ranks ? s.ranks[half] : null;
        if (!have) { return false; }
        return RANKS.indexOf(have) >= RANKS.indexOf(rank || 'novice');
      }
    },
    function (id, key) {
      trail.push('toolGate:' + key);
      const p = WHO[id];
      return (p && p.axe) ? null : 'You need a Woodcutter\'s Axe in your pack for that.';
    },
    function (id, desc, count) { given.push({ id: id, desc: desc, count: count }); return true; },
    function () { return null; },
    function () { return null; },
    branch('kindIsContainer', false),
    branch('mineSalt', 'SALT'), branch('burnCharcoal', 'KILN'),
    {}, branch('bless', 'SHRINE'),
    branch('isCrop', false), branch('farmActivate', 'CROP'),
    branch('isFish', false), branch('fish', 'FISH'),
    branch('isGame', false), branch('game', 'GAME'),
    branch('isPlant', false), branch('harvest', 'PLANT'), branch('putBack', undefined),
    branch('isVein', false), branch('mineOre', 'VEIN'),
    branch('isCarcass', false), {}, branch('classGate', null),
    function (id) { kicks.push(id); }
  );

  return {
    api: api, clock: clock, trail: trail, told: told, said: said, given: given, reads: reads, kicks: kicks,
    /* One press, and everything it did, as a record two presses can be compared by. */
    press: function (who, refrId) {
      trail.length = 0; told.length = 0; said.length = 0; given.length = 0; reads.length = 0; kicks.length = 0;
      const actor = ACTOR[who];
      const ret = api.press(refrId, actor);
      return {
        ret: ret === undefined ? 'let through' : (ret === false ? 'blocked' : String(ret)),
        told: told.map(function (t) { return t.text; }),
        firewood: given.filter(function (g) { return g.desc === ITEMS.firewood; })
          .reduce(function (n, g) { return n + g.count; }, 0),
        other: given.filter(function (g) { return g.desc !== ITEMS.firewood; }).length,
        session: !!api.CHOP_AT[actor] && api.CHOP_AT[actor].refrId === refrId,
        axeAsked: trail.indexOf('toolGate:woodworker') >= 0,
        fellThrough: reads.indexOf('type') >= 0,
        kicked: kicks.indexOf(actor) >= 0,
        kickCount: kicks.length
      };
    }
  };
}

function same(a, b) {
  const x = Object.assign({}, a), y = Object.assign({}, b);
  return JSON.stringify(x) === JSON.stringify(y);
}
function show(r) {
  return r.ret + ', firewood ' + r.firewood +
    (r.told && r.told[0] ? ', told "' + r.told[0] + '"' : '') +
    (r.kicked ? ', kicked' : ', no-kick');
}

if (chopping && handler && loot && benchGate && halfGate && gateHalf && allowM && noProfM &&
    STATIONS && ITEMS && BENCH_BY_BASE && BENCH_ACCESS) {

  // G1: A WOODWRIGHT. Firewood at the common block, and exactly the same at
  // each of the three ash blocks.
  {
    const s = server();
    const common = s.press('wright', 0x000b3949);
    yes('G1 a Woodwright at the common block is paid and the press goes on (' + show(common) + ')',
        common.ret === 'let through' && common.firewood === 2 && common.told.length === 0 &&
        common.session && common.axeAsked && !common.fellThrough && !common.kicked);
    ASH_REFS.forEach(function (ref) {
      const s2 = server();
      const ash = s2.press('wright', ref);
      yes('G1 a Woodwright at ash block ' + ref.toString(16) + ' gets exactly that (' + show(ash) + ')',
          same(ash, common));
    });
  }

  // G2: SOMEBODY WHO IS NOT A WOODWORKER. Refused at the common block with
  // the Woodwright line, before the axe is asked about, nothing handed over,
  // the press blocked, and swingEnd kicked so the local axe loop stops (#842).
  // The same at ash.
  {
    const s = server();
    const common = s.press('smith', 0x000b3949);
    yes('G2 a Smith at the common block is refused with the Woodwright line (' + show(common) + ')',
        common.ret === 'blocked' && common.firewood === 0 && common.other === 0 &&
        common.told.length === 1 && /only a woodworker who took Woodwright/i.test(common.told[0]) &&
        !common.session && !common.axeAsked && common.kicked);
    ASH_REFS.forEach(function (ref) {
      const s2 = server();
      const ash = s2.press('smith', ref);
      yes('G2 a Smith at ash block ' + ref.toString(16) + ' is refused exactly the same (' + show(ash) + ')',
          same(ash, common));
    });
  }

  // G3: SOMEBODY WITH NO PROFESSION YET, and G4: A WOODWRIGHT WITHOUT AN AXE.
  // The two other answers the gate has, both the same at the ash block.
  {
    const c3 = server().press('fresh', 0x000b3949);
    const a3 = server().press('fresh', ASH_REFS[0]);
    yes('G3 no profession: told to press K at the common block (' + show(c3) + ')',
        c3.ret === 'blocked' && c3.firewood === 0 && c3.told[0] === noProfM[1] && c3.kicked);
    yes('G3 and exactly the same at the ash block (' + show(a3) + ')', same(a3, c3));

    const c4 = server().press('bare', 0x000b3949);
    const a4 = server().press('bare', ASH_REFS[0]);
    yes('G4 no axe: refused for the tool at the common block (' + show(c4) + ')',
        c4.ret === 'blocked' && c4.firewood === 0 && /^You need a /.test(c4.told[0] || '') && c4.kicked);
    yes('G4 and exactly the same at the ash block (' + show(a4) + ')', same(a4, c4));
  }

  // G5: THE SWINGS AFTER THE PRESS. The client reports each fall of the axe
  // as /chopped and choppedSwing credits it only to somebody the server has
  // just watched press a block. At the ash block that is now the Woodwright.
  {
    const s = server();
    s.press('wright', ASH_REFS[1]);
    s.given.length = 0;
    s.clock.now += 1500;
    const swung = s.api.swing(ACTOR.wright);
    yes('G5 a swing at the ash block after the press is paid two firewood',
        swung === s.api.ALLOW && s.given.length === 1 && s.given[0].count === 2 &&
        s.given[0].desc === ITEMS.firewood);

    const t = server();
    t.press('smith', ASH_REFS[1]);
    t.clock.now += 1500;
    yes('G5 and a Smith refused at it has no session to swing in',
        t.api.swing(ACTOR.smith) === null && t.given.length === 0);
  }

  // G6: DJINN'S THREE POINTS. BLOCKS_OFF is by position and blockIsOff does
  // not look at the worldspace, so it matters where the ash blocks stand:
  // Solstheim, far from all three. And Dragon Bridge is still off.
  {
    const s = server();
    const nearest = ASH_REFS.map(function (ref) {
      const p = REFS[ref].pos;
      return Math.min.apply(null, [[-64263, 106003.5, -8377.8], [-76193.3, 96600.6, -11435],
        [-101780.7, 80484.5, -12522.7]].map(function (q) {
        return Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2));
      }));
    });
    yes('G6 no ash block is inside a site nobody works (nearest is ' +
        Math.round(Math.min.apply(null, nearest)) + ' units from one)',
        ASH_REFS.every(function (ref) { return s.api.blockIsOff(ref) === null; }));
    const off = s.press('wright', 0x000abf83);
    yes('G6 the Dragon Bridge block is still nobody\'s (' + show(off) + ')',
        off.ret === 'blocked' && off.firewood === 0 && /^Nobody works this block/.test(off.told[0] || '') && off.kicked);
  }
}


// G7: THE SOURCE SAYS THE KICK. chopWood must call swingEnd on every refuse
// path (#842), and must not call it on a paid press.
{
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const fn = cut('function chopWood(actorId, refrId, fromSwing) {', '\n}\n') ||
             (function () {
               const a = src.indexOf('function chopWood(actorId, refrId, fromSwing)');
               if (a < 0) return null;
               let depth = 0, started = false;
               for (let i = a; i < src.length; i++) {
                 if (src[i] === '{') { depth++; started = true; }
                 else if (src[i] === '}') {
                   depth--;
                   if (started && depth === 0) return src.slice(a, i + 1);
                 }
               }
               return null;
             })();
  yes('G7 chopWood is still in the gamemode', !!fn);
  if (fn) {
    const ends = (fn.match(/swingEnd\s*\(/g) || []).length;
    yes('G7 chopWood calls swingEnd on refuse paths (' + ends + ' times)', ends >= 4);
    yes('G7 chopWood names the #842 kick', /#842/.test(fn));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
