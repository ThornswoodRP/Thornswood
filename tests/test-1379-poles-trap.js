// test-1379-poles-trap.js
//
// #1379 poles + trap contract (Temp-Fish3 harness on temp-fishing/1379-poles-trap).
// Plan: docs/systems/classes/fisher.md.
//
// Four cases Temp-Fishing is landing in gamemode/TOOLS + recipes:
//   1) no pole => no catch
//   2) fisher create hands a crude pole
//   3) fish trap craft / max 3 at once
//   4) pole tool uses 50
//
// TODO(Temp-Fishing): hooks below are planned names. Expect FAIL until
// poles+trap land in game/gamemode.js on this same branch. Do not edit
// gamemode from this harness lane.
//
// Read only against game/gamemode.js.
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(__dirname, '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = require('./gamemode-tables.js').joined(fs.readFileSync(SRC, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

function liftFn(name) {
  const a = src.indexOf('\nfunction ' + name + '(');
  if (a < 0) { return null; }
  const open = src.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') { depth++; }
    else if (src[i] === '}') { depth--; if (!depth) { return src.slice(a + 1, i + 1); } }
  }
  return null;
}

function cut(from, end) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a);
  return b < 0 ? null : src.slice(a, b + end.length);
}

// Planned constants / tables Temp-Fishing should add beside TOOLS / fish().
// TODO(Temp-Fishing): confirm final names if they diverge; harness keys on these.
const POLE_USES_RE = /^const POLE_USES = 50;$/m;
const FISH_TRAP_MAX_RE = /^const FISH_TRAP_MAX = 3;$/m;
const TOOLS_BLOCK = cut('const TOOLS = {', '\n};\n');
const fishFn = liftFn('fish');
const toolGateFn = liftFn('toolGate');
const giveToolFn = liftFn('giveTool');
const wearToolFn = liftFn('wearTool');

yes('fish() is in the gamemode', !!fishFn);
yes('toolGate(), giveTool(), wearTool() are in the gamemode',
    !!toolGateFn && !!giveToolFn && !!wearToolFn);
yes('TOOLS table is in the gamemode', !!TOOLS_BLOCK);

// ----------------------------------------------------------------- TOOLS.fisher
let TOOLS = null;
try {
  TOOLS = TOOLS_BLOCK
    ? new Function('return (' + TOOLS_BLOCK.replace(/^const TOOLS = /, '').replace(/;\s*$/, '') + ')')()
    : null;
} catch (e) { TOOLS = null; }

const fisherTool = TOOLS && Object.prototype.hasOwnProperty.call(TOOLS, 'fisher')
  ? TOOLS.fisher : null;
yes('TOOLS.fisher exists (planned: crude pole handout + accept list)', !!fisherTool);
yes('TOOLS.fisher.name names a pole',
    !!fisherTool && /pole/i.test(String(fisherTool.name || '')));
yes('TOOLS.fisher.give is set (crude pole descriptor)',
    !!fisherTool && !!fisherTool.give);
yes('TOOLS.fisher.accept lists at least the handout pole',
    !!fisherTool && Array.isArray(fisherTool.accept) &&
    fisherTool.accept.indexOf(fisherTool.give) >= 0);

// --------------------------------------------------------- 1) no pole => no catch
{
  // Source shape: after classGate, fish() must ask toolGate for 'fisher'
  // before cooldown / stock take. Same order as mineOre / chopWood.
  const classAt = fishFn ? fishFn.indexOf("classGate(actorId, 'fish')") : -1;
  const toolAt = fishFn ? fishFn.indexOf("toolGate(actorId, 'fisher')") : -1;
  const stockAt = fishFn ? fishFn.indexOf('stock.take') : -1;
  yes('fish() calls toolGate(actorId, \'fisher\') (planned: no pole => refuse)',
      toolAt >= 0);
  yes('fish() asks for the pole after the class gate',
      classAt >= 0 && toolAt > classAt);
  yes('fish() asks for the pole before taking stock',
      toolAt >= 0 && (stockAt < 0 || toolAt < stockAt));

  // Behavioral lift when the call is present; otherwise stay red with TODO.
  // TODO(Temp-Fishing): once toolGate is wired in fish(), these run for real.
  if (fishFn && toolAt >= 0) {
    const fishTable = cut('var FISH_BY_BASE = ', ';\n');
    yes('FISH_BY_BASE table cuts for the no-pole lift', !!fishTable);
    if (fishTable) {
      const FISH_BY_BASE = new Function(fishTable + '\nreturn FISH_BY_BASE;')();
      const fishBase = Object.keys(FISH_BY_BASE).find(function (k) {
        return FISH_BY_BASE[k].rank === 'novice';
      });
      yes('a novice fish row exists for the no-pole lift', !!fishBase);

      const given = [];
      const POLE_NO = 'You need a pole in your pack for that.';
      const FISH_NO = 'Only a fisher can fish. Ask one.';
      let trail = [];

      function makeFish(opts) {
        trail = [];
        given.length = 0;
        return new Function(
          'classGate', 'rankStep', 'rankWord', 'RANK_LADDER', 'addItem', 'addItemsAtomic',
          'creditWork', 'cooldownLeft', 'stampCooldown', 'waitWord', 'randInt',
          'FISH_BY_BASE', 'FISH_TUNING', 'isFish', 'toolGate', 'withinResourceReach',
          'wearTool',
          'function economyGathered() { }\n' + fishFn + '\nreturn fish;'
        )(
          function (actorId, verb) {
            trail.push('classGate:' + verb);
            if (verb === 'fish' && actorId !== 1) { return FISH_NO; }
            return null;
          },
          function () { return 0; },
          function (r) { return r; },
          ['novice', 'advanced', 'expert', 'master'],
          function (a, d, n) { given.push([a, d, n]); return true; },
          function (a, rows) {
            rows.forEach(function (r) { given.push([a, r.item, r.count]); });
            return true;
          },
          function () { return null; },
          function () { return 0; },
          function () { },
          function () { return '1 minute'; },
          function (a) { return a; },
          FISH_BY_BASE,
          { cooldownMs: { novice: 1, advanced: 1, expert: 1, master: 1 }, yieldByStep: { 0: [1, 1] } },
          function (d) { return Object.prototype.hasOwnProperty.call(FISH_BY_BASE, d); },
          function (actorId, key) {
            trail.push('toolGate:' + key);
            if (opts && opts.hasPole) { return null; }
            return POLE_NO;
          },
          function () { return true; },
          function () { return null; }
        );
      }

      // Shared stock stub used by current fish().
      globalThis.__thornswoodResourceStock = {
        left: function () { return 0; },
        take: function (refrId, span, fn) {
          const ok = fn();
          return { ok: !!ok };
        }
      };

      const noPole = makeFish({ hasPole: false });
      const refused = noPole(1, 0x10, fishBase);
      yes('no pole => fish() returns a need-a-pole line',
          typeof refused === 'string' && /pole/i.test(refused));
      yes('no pole => toolGate:fisher was asked',
          trail.indexOf('toolGate:fisher') >= 0);
      yes('no pole => nothing was given', given.length === 0);

      const withPole = makeFish({ hasPole: true });
      const ok = withPole(1, 0x10, fishBase);
      yes('with pole => fish() hands a You take toast', /^You take /.test(ok || ''));
      yes('with pole => produce was given', given.length >= 1);
    }
  } else {
    yes('TODO scaffold: fish() does not yet call toolGate(actorId, \'fisher\')', false);
  }
}

// ------------------------------------------- 2) fisher create hands crude pole
{
  // Class/profession pick already calls giveTool(actorId, whose). Once
  // TOOLS.fisher exists, pick Fisher hands the crude pole with no new door.
  const pickHand = /var handed = giveTool\(actorId, whose\);/.test(src);
  yes('class/profession pick calls giveTool(actorId, whose)', pickHand);
  yes('giveTool hands via handTool(actorId, key) (toolFor lives in handTool)',
      !!giveToolFn && /handTool\(actorId, key\)/.test(giveToolFn));
  yes('TOOLS.fisher is the create handout for Fisher (crude pole)',
      !!fisherTool && (/crude/i.test(String(fisherTool.name || '')) ||
      /pole/i.test(String(fisherTool.name || ''))));
  // Soft note when only "pole" is named: fisher.md says the handout is crude.
  if (fisherTool && /pole/i.test(String(fisherTool.name || '')) &&
      !/crude/i.test(String(fisherTool.name || ''))) {
    console.log('NOTE  TOOLS.fisher.name is a pole but does not say crude; fisher.md wants crude');
  }
}

// ---------------------------------------------------- 3) trap craft / max 3
{
  // TODO(Temp-Fishing): planned FISH_TRAP_MAX = 3 and a place/collect path that
  // refuses a fourth. Recipe rows land via Build-RecipeTable; do not assert esp.
  yes('FISH_TRAP_MAX = 3 is in the gamemode (planned)', FISH_TRAP_MAX_RE.test(src));

  const placeTrap = liftFn('placeFishTrap') || liftFn('setFishTrap') || liftFn('fishTrapSet');
  const collectTrap = liftFn('collectFishTrap') || liftFn('takeFishTrap') || liftFn('fishTrapCollect');
  yes('a fish-trap place hook is in the gamemode (planned: placeFishTrap / setFishTrap)',
      !!placeTrap);
  yes('a fish-trap collect hook is in the gamemode (planned: collectFishTrap)',
      !!collectTrap);

  // Behavioral scaffold when both hooks + max exist.
  if (FISH_TRAP_MAX_RE.test(src) && placeTrap) {
    const maxM = FISH_TRAP_MAX_RE.exec(src);
    const max = maxM ? 3 : 0;
    yes('FISH_TRAP_MAX parses as 3', max === 3);

    // Count gate only: Temp-Fishing should keep the max check obvious in source.
    yes('placeFishTrap / setFishTrap source mentions the max of 3',
        /FISH_TRAP_MAX|\b3\b/.test(placeTrap) && /trap/i.test(placeTrap));
  } else {
    yes('TODO scaffold: trap place + FISH_TRAP_MAX not landed yet', false);
  }
}

// ---------------------------------------------------------- 4) pole uses 50
{
  // fisher.md: 50 uses on a pole. Picks/axes/shovels may still use TOOL_USES;
  // poles are the number under test here.
  yes('POLE_USES = 50 is in the gamemode (planned)', POLE_USES_RE.test(src));

  const wearUsesPole = wearToolFn &&
    (/POLE_USES/.test(wearToolFn) ||
     /key === 'fisher'/.test(wearToolFn) ||
     (/fisher/.test(wearToolFn) && /50/.test(wearToolFn)));
  yes('wearTool (or pole path) spends against 50 pole uses',
      POLE_USES_RE.test(src) || wearUsesPole ||
      (!!fisherTool && Number(fisherTool.uses) === 50));

  // Source: fish() should wear the pole after a successful catch.
  const wearAt = fishFn ? fishFn.indexOf("wearTool(actorId, 'fisher')") : -1;
  const takeAt = fishFn ? fishFn.indexOf('stock.take') : -1;
  yes('fish() calls wearTool(actorId, \'fisher\') after work (planned)',
      wearAt >= 0);
  yes('fish() wears the pole after stock.take (use counted after work)',
      wearAt >= 0 && takeAt >= 0 && wearAt > takeAt);
}

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
