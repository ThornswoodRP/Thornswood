// test-beds-sleepable.js
//
// All beds are sleepable (#839).
//
// Vanilla Owned beds refuse Sleep/Wait. Under SkyMP that ownership has no
// host, so the front clears it on a bed press and re-activates, and when
// somebody lies down it tells the server /rest bed for exhaustion recovery,
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
yes('front handles furniture type 40 on activate', /type === 40/.test(front) && /Clear Owned so Sleep\/Wait works/.test(front));
yes('front re-activates after clearing owned beds', /cleared ownership on/.test(front) && /activate\(pc, false\)/.test(front));
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

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
