// test-chopping-blocks.js
//
// The three chopping blocks at Djinn's points leave the world, only those
// three, from wherever the person stands near them, and again when SkyMP
// puts them back.
//
// WHAT WAS REPORTED. Djinn on dev, 24 September, in "wood chopping Blocks",
// with three screenshots of a Wood Chopping Block and "E Use" under the
// crosshair: "The ones I gave you coords for are not removed".
//
// WHAT WAS MEASURED. Every placed reference in the load order was read out of
// the plugins (99 of them, C:\Thornswood\Game\Data and the profile's
// plugins.txt, last one wins, with Build-DoorTable.py's reader). At the three
// points:
//
//   Solitude          d6ae9:Skyrim.esm, base 7022e, 103 units away, in
//                     SolitudeWorld, made PERSISTENT by Populated Cities
//                     Towns Villages Legendary.esp
//   Solitude Stables  a9ee1:Skyrim.esm, base 7022e, 61 units away, Tamriel,
//                     an ordinary reference in the cell at -19,23
//   Dragon Bridge     abf83:Skyrim.esm, base 7022e, 132 units away, Tamriel,
//                     PERSISTENT, standing in the cell at -25,19
//
// In the plugins a persistent reference is filed under its worldspace's
// persistent cell, not the exterior cell it stands in, and the plugin walked
// only the cell the person stood in. And the fork's client re-enables any
// Skyrim.esm reference every time the server streams it (remoteServer.ts
// onCreateActorMessage, applyModelIsDisabled with a flag the server never
// sends under that name), while the plugin marked a site done after its
// first disable.
//
// So this RUNS the real blocksgone handler, lifted out of the plugin, over a
// pretend world built from those measurements: the three blocks, every other
// block on the woodcutting bases within 7,000 units of a point, and
// Skyrim.esm's execution block in Solitude, at their real positions, in
// their real cells, persistent where the plugins say so. One block is
// pretend and says so below.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.FRONT ||
            path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// From `from` to the end of the named function, the way test-fire-walk.js
// lifts walkCellSlice: the first closing brace at the plugin's own indent.
function liftFn(from, fnName) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const f = src.indexOf('function ' + fnName + '(', a);
  if (f < 0) { return null; }
  const END = '\n  }\n';
  const b = src.indexOf(END, f);
  return b < 0 ? null : src.slice(a, b + END.length);
}

// From `from` to the end of the blocksgone handler, which closes with the
// first "  }));" at the plugin's own indent after it is registered.
function liftHandler(from) {
  const a = src.indexOf(from);
  if (a < 0) { return null; }
  const h = src.indexOf("guard('blocksgone'", a);
  if (h < 0) { return null; }
  const END = '\n  }));\n';
  const b = src.indexOf(END, h);
  return b < 0 ? null : src.slice(a, b + END.length);
}

const walk = liftFn('  const CELL_TYPES = [', 'walkCellSlice');
const blocks = liftHandler('  const BLOCK_BASES = [');
yes('the blocksgone handler is in the plugin', blocks !== null);

const CELL = 4096;
const TAMRIEL = 0x3c;
const SOLITUDE_WORLD = 0x37edf;
const WOOD = 0x7022e;          // WoodChoppingBlock
const EXECUTION = 0x2e8eb;     // ExecutionerChoppingBlock, a different base
const BENCH = 0xa4ad6;         // FarmBench01F, 251 units from Dragon Bridge

const POINTS = {
  'Solitude': [-64263, 106003.5, -8377.8],
  'Solitude Stables': [-76193.3, 96600.6, -11435],
  'Dragon Bridge': [-101780.7, 80484.5, -12522.7]
};

// Read out of the plugins on 24 September. `site` marks the three that are
// Djinn's; everything else is a block that must stay.
const REAL = [
  { id: 0xd6ae9, base: WOOD, world: SOLITUDE_WORLD, persistent: true,
    pos: [-64192.375, 106073.8125, -8404.0303], site: 'Solitude' },
  { id: 0xa9ee1, base: WOOD, world: TAMRIEL, persistent: false,
    pos: [-76140.3828, 96631.5469, -11431.0459], site: 'Solitude Stables' },
  { id: 0xabf83, base: WOOD, world: TAMRIEL, persistent: true,
    pos: [-101831.9688, 80606.4531, -12516.9336], site: 'Dragon Bridge' },
  { id: 0x104ae1, base: WOOD, world: TAMRIEL, persistent: false,
    pos: [-69192.4531, 101761.8047, -9359.5947] },
  { id: 0x3487a, base: WOOD, world: TAMRIEL, persistent: false,
    pos: [-81702.4297, 95772.3281, -11687.2002] },
  { id: 0xb3949, base: WOOD, world: TAMRIEL, persistent: false,
    pos: [-75967.2734, 90795.7109, -13881.7363] },
  { id: 0xb70c0, base: WOOD, world: TAMRIEL, persistent: true,
    pos: [-101563.9688, 85080.1406, -11933.708] },
  { id: 0xa6ce5, base: EXECUTION, world: SOLITUDE_WORLD, persistent: true,
    pos: [-64550.75, 103530.0547, -8311.5625] }
];

// PRETEND, not in any plugin: a block on the same base 300 units from the
// Dragon Bridge point, filed in the very cell a person standing there is in.
// Nothing in this load order is that close. It is here because it is the one
// thing a search by base and position takes and a lookup by form id must not.
const DECOY = { id: 0xff000abc, base: WOOD, world: TAMRIEL, persistent: false,
                pos: [-101480.7, 80484.5, -12522.7] };

function gridOf(x, y) { return [Math.floor(x / CELL), Math.floor(y / CELL)]; }

/*
  A pretend world. The person stands somewhere; getParentCell answers the
  exterior cell under them, listing the ORDINARY references filed there, the
  way the plugins file them (persistent ones sit in the worldspace's
  persistent cell). getFormEx answers a persistent reference always and an
  ordinary one only while its cell is loaded, five by five around the person,
  which is Skyrim's own uGridsToLoad. `opts.swap` replaces what a reference
  id answers, for a load order that put something else there.
*/
function world(opts) {
  opts = opts || {};
  const refs = {};
  const all = REAL.concat([DECOY]).map(function (r) {
    const o = opts.swap && opts.swap[r.id] ? Object.assign({}, r, opts.swap[r.id]) : r;
    const g = gridOf(o.pos[0], o.pos[1]);
    const ref = {
      id: o.id, site: o.site || null, world: o.world, persistent: o.persistent,
      gx: g[0], gy: g[1], disabled: false, disables: 0,
      getFormID: function () { return o.id; },
      getBaseObject: function () { return { getFormID: function () { return o.base; } }; },
      getPositionX: function () { return o.pos[0]; },
      getPositionY: function () { return o.pos[1]; },
      getPositionZ: function () { return o.pos[2]; },
      isDisabled: function () { return ref.disabled; },
      disable: function () {
        ref.disables++;
        if (opts.throwOn === o.id) { throw new Error('Disable failed'); }
        ref.disabled = true;
        return Promise.resolve();
      },
      enable: function () { ref.disabled = false; return Promise.resolve(); }
    };
    refs[o.id] = ref;
    return ref;
  });

  const me = { world: TAMRIEL, x: 0, y: 0, z: 0 };
  const calls = { formEx: 0, parentCell: 0 };
  let loaded = true;

  function inMemory(r) {
    if (r.persistent) { return true; }
    if (!loaded || r.world !== me.world) { return false; }
    const g = gridOf(me.x, me.y);
    return Math.abs(r.gx - g[0]) <= 2 && Math.abs(r.gy - g[1]) <= 2;
  }

  function exteriorCell() {
    const g = gridOf(me.x, me.y);
    const here = all.filter(function (r) {
      return r.world === me.world && r.gx === g[0] && r.gy === g[1] &&
             (!r.persistent || opts.persistentInExterior) && inMemory(r);
    });
    return {
      getFormID: function () { return 0x9349; },
      getNumRefs: function (t) { return t === 42 ? here.length : 0; },
      getNthRef: function (i, t) { return t === 42 ? here[i] : null; }
    };
  }

  const pc = {
    getPositionX: function () { return me.x; },
    getPositionY: function () { return me.y; },
    getPositionZ: function () { return me.z; },
    getParentCell: function () { calls.parentCell++; return exteriorCell(); }
  };

  const handlers = {};
  const sp = {
    on: function (name, fn) { handlers[name] = fn; },
    Game: {
      getPlayer: function () { return pc; },
      getFormEx: function (id) {
        calls.formEx++;
        const r = refs[id];
        if (r) { return inMemory(r) ? r : null; }
        return { getFormID: function () { return id; } };   // a base record
      }
    },
    Form: {
      from: function (raw) { return raw && raw.getFormID ? raw : null; }
    },
    ObjectReference: {
      from: function (raw) { return raw && raw.disable ? raw : null; }
    }
  };

  const logs = [];
  const threw = [];
  const clock = { t: 0 };
  const fakeDate = { now: function () { return clock.t; } };
  function guard(name, fn) {
    return function () {
      try { return fn.apply(null, arguments); }
      catch (e) { threw.push(name + ': ' + String((e && e.message) || e)); return undefined; }
    };
  }
  function say(text) { logs.push(String(text)); }

  const fn = new Function('sp', 'guard', 'say', 'Date',
    (walk || '') + blocks +
    '\nreturn { gone: BLOCKS_GONE, find: BLOCK_FIND, near: BLOCK_NEAR };');
  const api = fn(sp, guard, say, fakeDate);

  return {
    api: api, refs: refs, all: all, logs: logs, threw: threw, calls: calls,
    standAt: function (w, x, y, z) { me.world = w; me.x = x; me.y = y; me.z = z; },
    load: function (v) { loaded = v; },
    tick: function (t) { clock.t = t; handlers.update(); },
    disabled: function () {
      return all.filter(function (r) { return r.disabled; })
        .map(function (r) { return r.id; }).sort(function (a, b) { return a - b; });
    },
    said: function (text) { return logs.indexOf(text) >= 0; },
    saidLike: function (re) { return logs.some(function (l) { return re.test(l); }); }
  };
}

function hex(ids) { return ids.map(function (i) { return i.toString(16); }).join(','); }

if (blocks !== null) {
  // S0: THE TABLE. Each site names the reference the plugins put there, and
  // the measured reference really is within reach of the point.
  {
    const h = world();
    const gone = h.api.gone;
    const want = { 'Solitude': 0xd6ae9, 'Solitude Stables': 0xa9ee1, 'Dragon Bridge': 0xabf83 };
    yes('S0 three sites', gone.length === 3);
    gone.forEach(function (s) {
      yes('S0 ' + s.where + ' names reference ' + (want[s.where] || 0).toString(16) +
          ' (it names ' + (s.ref ? s.ref.toString(16) : 'none') + ')',
          s.ref === want[s.where]);
      const r = REAL.filter(function (x) { return x.site === s.where; })[0];
      const d = Math.sqrt(Math.pow(r.pos[0] - s.pos[0], 2) + Math.pow(r.pos[1] - s.pos[1], 2) +
                          Math.pow(r.pos[2] - s.pos[2], 2));
      yes('S0 the ' + s.where + ' block stands ' + Math.round(d) + ' units from the point, inside ' +
          h.api.find, d <= h.api.find);
    });
  }

  // S1: THE STABLES FROM THE NEXT CELL. The block is an ordinary reference in
  // the cell at -19,23; the person stands at -73000, which is the cell at
  // -18,23, 3,193 units from the point and well inside the near gate.
  {
    const h = world();
    h.standAt(TAMRIEL, -73000, 96600, -11400);
    yes('S1 the person is in the next cell over',
        gridOf(-73000, 96600)[0] === -18 && gridOf(-76140.3828, 96631.5469)[0] === -19);
    h.tick(10000);
    yes('S1 the stables block is taken out from the next cell (disabled: ' +
        (hex(h.disabled()) || 'nothing') + ')', h.refs[0xa9ee1].disabled);
    yes('S1 and it says so',
        h.said('took the chopping block at Solitude Stables out of the world'));
    yes('S1 the three other blocks in the loaded cells around it stay',
        !h.refs[0x3487a].disabled && !h.refs[0xb3949].disabled && !h.refs[0x104ae1].disabled);
    yes('S1 nothing threw', h.threw.length === 0);
  }

  // S2: DRAGON BRIDGE, STANDING BESIDE IT. The block is persistent, so the
  // exterior cell the person stands in does not list it; the pretend decoy
  // is in that cell, 300 units from the point.
  {
    const h = world();
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000);
    yes('S2 the Dragon Bridge block is taken out (disabled: ' +
        (hex(h.disabled()) || 'nothing') + ')', h.refs[0xabf83].disabled);
    yes('S2 the block 300 units away on the same base stays', !h.refs[DECOY.id].disabled);
    yes('S2 the other Dragon Bridge block, 4,638 units away and persistent, stays',
        !h.refs[0xb70c0].disabled);
    yes('S2 it says so once', h.logs.length === 1 &&
        h.said('took the chopping block at Dragon Bridge out of the world'));
  }

  // S3: SOLITUDE, INSIDE THE CITY. Its own worldspace, and persistent.
  {
    const h = world();
    const p = POINTS['Solitude'];
    h.standAt(SOLITUDE_WORLD, p[0], p[1], p[2]);
    h.tick(10000);
    yes('S3 the Solitude block is taken out (disabled: ' +
        (hex(h.disabled()) || 'nothing') + ')', h.refs[0xd6ae9].disabled);
    yes('S3 the execution block 2,491 units away stays', !h.refs[0xa6ce5].disabled);
    yes('S3 it says so', h.said('took the chopping block at Solitude out of the world'));
  }

  // S4: IT COMES BACK. SkyMP streams the block in again and its client calls
  // enable(true). The next tick takes it out again and says so.
  {
    const h = world();
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000);
    const first = h.refs[0xabf83].disabled;
    h.refs[0xabf83].enable();
    h.tick(14000);
    yes('S4 the block that came back is taken out again',
        first && h.refs[0xabf83].disabled);
    yes('S4 with one line saying it came back',
        h.said('the Dragon Bridge chopping block came back and was taken out again (2 times this session)'));
    const lines = h.logs.length;
    h.tick(18000);
    yes('S4 a block that is still out is left alone and nothing more is said',
        h.logs.length === lines && h.refs[0xabf83].disables === 2);
  }

  // S5: THE PACE. Four seconds between looks, whatever else happens.
  {
    const h = world();
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000);
    h.refs[0xabf83].enable();
    const asked = h.calls.formEx;
    h.tick(11000);
    yes('S5 one second later nothing is asked of the game', h.calls.formEx === asked);
    yes('S5 and the block that came back waits for the next look', !h.refs[0xabf83].disabled);
    h.tick(14000);
    yes('S5 four seconds on it is taken out', h.refs[0xabf83].disabled);
  }

  // S6: AWAY FROM ALL THREE. Whiterun. Nothing is asked of the game at all.
  {
    const h = world();
    h.standAt(TAMRIEL, 20000, -10000, -2000);
    h.tick(10000);
    h.tick(14000);
    yes('S6 far from every point, no form is looked up', h.calls.formEx === 0);
    yes('S6 and no cell is asked for', h.calls.parentCell === 0);
    yes('S6 and nothing is taken out', h.disabled().length === 0);
  }

  // S7: WALK AWAY AND COME BACK. SkyMP drops the block when the person
  // leaves and streams it again when they return, which enables it.
  {
    const h = world();
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000);
    h.standAt(TAMRIEL, 20000, -10000, -2000);
    h.tick(14000);
    h.refs[0xabf83].enable();
    h.standAt(TAMRIEL, p[0] + 1000, p[1], p[2]);
    h.tick(18000);
    yes('S7 back at Dragon Bridge after leaving, the block is out again',
        h.refs[0xabf83].disabled && h.refs[0xabf83].disables === 2);
  }

  // S8: A TOUR OF ALL THREE, and then the whole world is counted. Exactly
  // the three measured references are out and every other block stands.
  {
    const h = world();
    let t = 10000;
    h.standAt(TAMRIEL, -73000, 96600, -11400); h.tick(t); t += 4000;
    const s = POINTS['Solitude'];
    h.standAt(SOLITUDE_WORLD, s[0], s[1], s[2]); h.tick(t); t += 4000;
    const d = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, d[0], d[1], d[2]); h.tick(t); t += 4000;
    h.standAt(TAMRIEL, d[0] + 300, d[1], d[2]); h.tick(t); t += 4000;
    yes('S8 exactly d6ae9, a9ee1 and abf83 are out (out: ' + hex(h.disabled()) + ')',
        hex(h.disabled()) === hex([0xa9ee1, 0xabf83, 0xd6ae9]));
    yes('S8 every other chopping block stands',
        h.all.every(function (r) { return r.site || !r.disabled; }));
    yes('S8 nothing threw', h.threw.length === 0);
  }

  // S9: THE ENGINE LISTS PERSISTENT REFERENCES UNDER THEIR CELL AFTER ALL.
  // Not measured, because it needs the game. The lookup by id must not care.
  {
    const h = world({ persistentInExterior: true });
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000);
    yes('S9 either way it is the measured block that goes, not the decoy (out: ' +
        (hex(h.disabled()) || 'nothing') + ')',
        hex(h.disabled()) === hex([0xabf83]));
  }

  // S10: A LOAD ORDER THAT PUT SOMETHING ELSE THERE. The id answers a bench,
  // or a block that an override moved: left alone, said once, not retried.
  {
    const h = world({ swap: { 0xabf83: { base: BENCH } } });
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000);
    const asked = h.calls.formEx;
    h.tick(14000);
    yes('S10 a bench at that id is not taken out', !h.refs[0xabf83].disabled);
    yes('S10 and neither is the decoy', !h.refs[DECOY.id].disabled);
    yes('S10 it says why, once',
        h.said('left the Dragon Bridge reference abf83 alone: its base is a4ad6, which is not a chopping block') &&
        h.logs.length === 1);
    yes('S10 and does not ask again', h.calls.formEx === asked);

    const m = world({ swap: { 0xabf83: { pos: [-99780.7, 80484.5, -12522.7] } } });
    m.standAt(TAMRIEL, p[0], p[1], p[2]);
    m.tick(10000);
    yes('S10 a block moved 2,000 units by an override is not taken out',
        !m.refs[0xabf83].disabled && m.saidLike(/^left the Dragon Bridge reference abf83 alone: it stands 2000 units/));
  }

  // S11: THE CELL HAS NOT LOADED YET. The stables block is an ordinary
  // reference, so during a load screen its id answers nothing. That is not a
  // failure: the next look after the cell loads takes it out.
  {
    const h = world();
    h.standAt(TAMRIEL, -76000, 96600, -11400);
    h.load(false);
    h.tick(10000);
    yes('S11 nothing loaded, nothing said', h.logs.length === 0 && !h.refs[0xa9ee1].disabled);
    h.load(true);
    h.tick(14000);
    yes('S11 once loaded it is taken out', h.refs[0xa9ee1].disabled);
  }

  // S12: A DISABLE THAT THROWS is one line, and is not tried every four
  // seconds for the rest of the session.
  {
    const h = world({ throwOn: 0xabf83 });
    const p = POINTS['Dragon Bridge'];
    h.standAt(TAMRIEL, p[0], p[1], p[2]);
    h.tick(10000); h.tick(14000); h.tick(18000);
    yes('S12 one line for the failure',
        h.logs.length === 1 && /^could not take the Dragon Bridge chopping block out/.test(h.logs[0]));
    yes('S12 tried once, not every four seconds', h.refs[0xabf83].disables === 1);
    yes('S12 and the handler did not throw', h.threw.length === 0);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
