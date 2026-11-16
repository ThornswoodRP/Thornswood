// test-beds-sleepable.js
//
// All beds are sleepable (#839).
//
// Vanilla Owned beds refuse Sleep/Wait. Under SkyMP that ownership has no
// host, so the front clears it when a bed loads (#4583: at the press was a
// frame too late), and when somebody lies down it tells the server /rest bed
// for exhaustion recovery,
// and /rest sit at any other furniture, which the server sorts (#1603).
//
//   node game/tests/test-beds-sleepable.js
'use strict';
const fs = require('fs');
const path = require('path');
const FRONT = process.env.FRONT ||
  path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js');
const GM = process.env.GM ||
  path.join(__dirname, '..', '..', 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');
const gm = fs.readFileSync(GM, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

yes('front names the beds sleepable work', /Beds are sleepable for everybody \(#839\)/.test(front));
yes('front lists bed keywords', /FurnitureBedDouble/.test(front) && /FurnitureBedSingle/.test(front) && /isBedRoll/.test(front));
yes('front has isBedRef', /function isBedRef\(ref\)/.test(front));
yes('front has clearBedOwnership', /function clearBedOwnership\(ref\)/.test(front));
yes('front clears actor and faction owners', /setActorOwner\(null\)/.test(front) && /setFactionOwner\(null\)/.test(front));
yes('front clears a bed\'s owner when it loads, not at the press (#4583)',
    /sp\.on\('objectLoaded', guard\('bed owner'/.test(front) && /if \(type === 40\) \{ return; \}/.test(front));
yes('front never presses a bed a second time (#4583)', !/cleared ownership on/.test(front));
yes('front watches furnitureEnter: a bed is /rest bed, any other furniture /rest sit (#1603)',
    /furnitureEnter/.test(front) && /tellServer\(bed \? '\/rest bed' : '\/rest sit'\)/.test(front));
yes('front watches furnitureExit to stop rest', /furnitureExit/.test(front) && /tellServer\('\/rest up'\)/.test(front));
yes('front ignores non-player furniture events', /actorId !== 0x14/.test(front));

yes('gamemode still accepts /rest bed', /\/rest/.test(gm) && /recover:\s*\{[^}]*bed:\s*80/.test(gm));
yes('gamemode resting verb still exists', /function resting\(actorId, kind\)/.test(gm));

// Drive isBedRef / clearBedOwnership with a stubbed sp.
{
  const a = front.indexOf('  const BED_KEYWORDS = [');
  const b = a < 0 ? -1 : front.indexOf('\n  function clearBedOwnership', a);
  const c = b < 0 ? -1 : front.indexOf('\n  }', b);
  const end = c < 0 ? -1 : front.indexOf('\n', c + 1);
  const block = (a >= 0 && end >= 0) ? front.slice(a, end + 1) : null;
  yes('bed helpers still extract', !!block);
  if (block) {
    const keywords = {};
    function Keyword(name) { this.name = name; }
    const said = [];
    const fn = new Function(
      'sp',
      block + '\nreturn { isBedRef: isBedRef, clearBedOwnership: clearBedOwnership, BED_KEYWORDS: BED_KEYWORDS };');
    const api = fn({
      Keyword: {
        getKeyword: function (name) {
          if (!keywords[name]) { keywords[name] = new Keyword(name); }
          return keywords[name];
        }
      }
    });

    function ref(opts) {
      opts = opts || {};
      const base = {
        type: opts.type == null ? 40 : opts.type,
        name: opts.name || '',
        kws: opts.kws || [],
        getType: function () { return this.type; },
        getName: function () { return this.name; },
        hasKeyword: function (kw) { return this.kws.indexOf(kw.name) !== -1; }
      };
      return {
        actorOwner: opts.actorOwner || null,
        factionOwner: opts.factionOwner || null,
        getBaseObject: function () { return base; },
        getActorOwner: function () { return this.actorOwner; },
        getFactionOwner: function () { return this.factionOwner; },
        setActorOwner: function (v) { this.actorOwner = v; this.actorCleared = true; },
        setFactionOwner: function (v) { this.factionOwner = v; this.factionCleared = true; }
      };
    }

    const bedByKw = ref({ kws: ['FurnitureBedDouble'], actorOwner: { id: 1 } });
    yes('a FurnitureBedDouble is a bed', api.isBedRef(bedByKw) === true);
    yes('clearing ownership drops the actor owner',
        api.clearBedOwnership(bedByKw) === true && bedByKw.actorOwner === null && bedByKw.actorCleared);

    const bedByName = ref({ name: 'Single Bed', factionOwner: { id: 2 } });
    yes('a named Single Bed is a bed', api.isBedRef(bedByName) === true);
    yes('clearing ownership drops the faction owner',
        api.clearBedOwnership(bedByName) === true && bedByName.factionOwner === null);

    const chair = ref({ name: 'Wooden Chair' });
    yes('a wooden chair is not a bed', api.isBedRef(chair) === false);
    yes('clearing a chair changes nothing', api.clearBedOwnership(chair) === false);

    const notFurn = ref({ type: 24, name: 'Bed Lever' });
    yes('a non-furniture base is not a bed', api.isBedRef(notFurn) === false);
  }
}

// The walk of the person's own cell at start runs on the first frame (15 Nov
// 2026). Skyrim Platform refuses a game call made while the plugin file is
// still being run, so a walk called as the plugin loaded threw "can't be
// called in this context" on every PC and cleared no bed.
{
  yes('front walks the starting cell on the first update, not as it loads',
      /sp\.once\('update', guard\('bed owners at start', \(\) => \{/.test(front));
  yes('front never calls the start walk as the plugin loads',
      !/guard\('bed owners at start', \(\) => \{[\s\S]*?\n  \}\)\(\);/.test(front.slice(front.indexOf("guard('bed owners at start'") - 40, front.indexOf("guard('bed owners at start'") + 600)));

  // Run the start walk's lines with an sp whose game calls throw outside an
  // update, the way Skyrim Platform does, and see it clear the bed only once
  // the first update runs it.
  const at = front.indexOf("  sp.once('update', guard('bed owners at start'");
  const stop = at < 0 ? -1 : front.indexOf('\n  }));', at);
  const startBlock = (at >= 0 && stop >= 0) ? front.slice(at, stop + 7) : null;
  yes('start walk block still extracts', !!startBlock);
  if (startBlock) {
    let inUpdate = false;
    const onceHandlers = [];
    const owned = { actorOwner: 'Hulda' };
    const cell = { refs: [owned] };
    function game(fn) {
      return function () {
        if (!inUpdate) { throw new Error("'ObjectReference.getParentCell' can't be called in this context"); }
        return fn.apply(null, arguments);
      };
    }
    const sp = {
      once: function (name, cb) { if (name === 'update') { onceHandlers.push(cb); } },
      Game: { getPlayer: function () { return { getParentCell: game(function () { return cell; }) }; } }
    };
    const threw = [];
    const said = [];
    function guard(name, fn) { return function () { try { return fn.apply(null, arguments); } catch (e) { threw.push(name + ': ' + e.message); } }; }
    function say(line) { said.push(line); }
    function clearBedsIn(c) {
      let n = 0;
      c.refs.forEach(function (r) { if (r.actorOwner) { r.actorOwner = null; n++; } });
      return n;
    }
    new Function('sp', 'guard', 'say', 'clearBedsIn', startBlock)(sp, guard, say, clearBedsIn);
    yes('loading the plugin makes no game call and throws nothing', threw.length === 0 && owned.actorOwner === 'Hulda');
    yes('the start walk waits for one update', onceHandlers.length === 1);
    inUpdate = true;
    onceHandlers.forEach(function (h) { h(); });
    yes('on the first update the bed already in the cell loses its owner',
        threw.length === 0 && owned.actorOwner === null && said.length === 1);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
