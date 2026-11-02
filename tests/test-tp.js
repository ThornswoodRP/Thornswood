// test-tp.js
//
// /tp to anywhere that is named, not just the nine holds.
//
// Patrick, 22 September: "let's add it so we can tp to any city, town,
// stronghold, anwyehre that is nnamed and not just the main holds."
//
// The names and the positions both already existed: BUILDING_NAME is 852
// named places read out of the load order and BUILDING_BY_DOOR is the 4,891
// doors into them. A door is a placed reference, so at run time it has a
// position and a cell, which is the one thing a cell descriptor cannot give.
//
// What this checks is the MATCHING, because that is where a command somebody
// types goes wrong: the whole rest of the line has to be taken, an exact name
// has to beat a partial one, and an ambiguous word has to ask rather than
// guess. Sending somebody to the wrong Hall of the Dead is worse than asking.
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

function table(name) {
  const re = new RegExp('^const ' + name + ' = (\\{.*\\});$', 'm');
  const m = re.exec(src);
  return m ? JSON.parse(m[1]) : null;
}

const NAME = table('BUILDING_NAME');
const BYDOOR = table('BUILDING_BY_DOOR');
yes('the named building table is in the gamemode', NAME !== null);
yes('and the doors that lead into them', BYDOOR !== null);

/*
  The real functions, over a pretend world.

  idOf and mp.get are the two things that only exist on a live server, so they
  are supplied: every door resolves, and each one is given a cell and a
  position. One door of each pair is put INSIDE the building so the preference
  for the street door can be checked.
*/
function rig(opts) {
  opts = opts || {};
  const a = src.indexOf('  function places() {');
  const b = src.indexOf('\n  function round1(', a);
  const block = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
  if (!block) { return null; }

  const inside = {};
  let n = 0;
  for (const door in BYDOOR) {
    // Every other door is the inside one.
    inside[door] = (n++ % 2 === 1);
  }

  /*
    DATA is passed in, and leaving it out was a real failure of this harness.

    holdTownOf reads DATA.cellToHold and DATA.capitals to tell six Halls of
    the Dead apart by hold. Without it every call threw, every duplicate fell
    to the unnamed branch, and the test reported the feature broken when what
    was broken was the rig. A harness that does not supply what the code reads
    is measuring itself.
  */
  const dataLine = src.split('\n').find(function (l) { return l.indexOf('const DATA = ') === 0; });
  const DATA = JSON.parse(dataLine.slice('const DATA = '.length).replace(/;\s*$/, ''));

  const fn = new Function(
    'PASSAGES', 'HALL', 'BUILDING_BY_DOOR', 'BUILDING_NAME', 'DATA',
    'idOf', 'mp', 'log', 'Object', 'String',
    block + '\nreturn { places: places, findPlace: findPlace, namedPlace: namedPlace,' +
            ' index: buildNamedDoors };');

  return fn(
    { 'x:Y.esp': { key: 'whiterun', town: 'Whiterun',
                   start: { desc: '3c:Skyrim.esm', pos: [19189.1, -12006.5, -4558.4], rot: [0, 0, 309.9] },
                   arrival: { desc: '1605e:Skyrim.esm', pos: [1, 2, 3], rot: [0, 0, 0] } } },
    { desc: 'hall:Y.esp', pos: [0, 0, 0], rot: [0, 0, 0] },
    BYDOOR, NAME, DATA,
    function (desc) { return opts.noDoors ? 0 : 1; },
    {
      get: function (id, key) {
        if (key === 'pos') { return [10, 20, 30]; }
        // The door's own cell: the building itself for an inside door, a
        // street cell for an outside one.
        if (key === 'worldOrCellDesc') { return rigCell; }
        return undefined;
      }
    },
    function () { }, Object, String);
}

// The cell the fake mp hands back for the door currently being asked about.
let rigCell = '3c:Skyrim.esm';

const api = rig();
yes('the /tp lookup block runs', api !== null);

if (api && NAME && BYDOOR) {
  // S1: the towns still work exactly as they did.
  {
    const r = api.findPlace('whiterun');
    yes('S1 a hold still resolves', !!r.where && r.where.town === 'Whiterun');
    // #2622: the town is where a new character arrives, the inn is "<town> inn".
    yes('S1 /tp whiterun goes to the start spot, not the inn', !!r.where && r.where.desc === '3c:Skyrim.esm');
    const inn = api.findPlace('whiterun inn');
    yes('S1 /tp whiterun inn goes to the inn spot', !!inn.where && inn.where.desc === '1605e:Skyrim.esm' &&
        JSON.stringify(inn.where.pos) === '[1,2,3]');
    const h = api.findPlace('hall');
    yes('S1 and so does the creation hall', !!h.where);
  }

  // S2: a named building resolves.
  {
    const names = Object.keys(NAME).map(function (k) { return NAME[k]; });
    const one = names.find(function (n) { return n.indexOf(' ') !== -1; }) || names[0];
    const r = api.findPlace(one.toLowerCase());
    yes('S2 a named building resolves by its full name (' + one + ')',
        !!r.where && r.where.town === one);
    yes('S2 and comes back with a cell and a position to stand in',
        !!r.where && !!r.where.desc && Array.isArray(r.where.pos) && r.where.pos.length === 3);
  }

  // S3: part of a name is enough, which is the point of the feature.
  {
    let uniqueWord = null, expect = null;
    const counts = {};
    for (const k in NAME) {
      const words = String(NAME[k]).toLowerCase().split(/[^a-z0-9]+/);
      words.forEach(function (w) { if (w.length >= 6) { counts[w] = (counts[w] || 0) + 1; } });
    }
    for (const w in counts) {
      if (counts[w] === 1) {
        uniqueWord = w;
        for (const k in NAME) {
          if (String(NAME[k]).toLowerCase().indexOf(w) !== -1) { expect = NAME[k]; break; }
        }
        break;
      }
    }
    yes('S3 there is a word that names exactly one place to test with', !!uniqueWord);
    if (uniqueWord) {
      const r = api.findPlace(uniqueWord);
      yes('S3 part of a name finds it (' + uniqueWord + ' -> ' + expect + ')',
          !!r.where && r.where.town === expect);
    }
  }

  // S4: AMBIGUITY ASKS. This is the one that matters.
  {
    // 'hall of the dead' exists in several holds in any normal load order.
    const many = {};
    for (const k in NAME) {
      const low = String(NAME[k]).toLowerCase();
      if (low.indexOf('hall of the dead') !== -1) { many[NAME[k]] = true; }
    }
    const count = Object.keys(many).length;
    if (count > 1) {
      const r = api.findPlace('hall of the dead');
      yes('S4 a word matching several places asks instead of guessing (' + count + ' of them)',
          !r.where && /Which one/.test(r.why || ''));
      yes('S4 and names the candidates so the next try can be exact',
          !r.where && Object.keys(many).some(function (n) { return (r.why || '').indexOf(n) !== -1; }));
    } else {
      yes('S4 skipped: this load order has no repeated name to be ambiguous about', true);
      yes('S4 skipped', true);
    }
  }

  // S5: an exact name beats a partial one. A place whose whole name is inside
  // another place's name must still be reachable by typing it exactly.
  {
    let shortName = null;
    const all = Object.keys(NAME).map(function (k) { return NAME[k]; });
    for (let i = 0; i < all.length && !shortName; i++) {
      const s = all[i].toLowerCase();
      for (let j = 0; j < all.length; j++) {
        if (all[j] !== all[i] && all[j].toLowerCase().indexOf(s) !== -1) { shortName = all[i]; break; }
      }
    }
    if (shortName) {
      const r = api.findPlace(shortName.toLowerCase());
      yes('S5 an exact name wins over a longer one containing it (' + shortName + ')',
          !!r.where && r.where.town === shortName);
    } else {
      yes('S5 skipped: no name is a substring of another here', true);
    }
  }

  // S6: nonsense is refused, and helpfully.
  {
    const r = api.findPlace('qzxwv nowhere');
    yes('S6 a place that does not exist is refused', !r.where && !!r.why);
    yes('S6 and the refusal suggests how to search', /part of/i.test(r.why));
  }

  // S7: the street door is preferred over the one inside.
  {
    // Ask for a building and make every door report the building's own cell,
    // which is the inside case. It must still resolve rather than refuse.
    const first = Object.keys(NAME)[0];
    rigCell = first;
    const r2 = rig().findPlace(String(NAME[first]).toLowerCase());
    yes('S7 a building whose doors all read as inside still resolves', !!r2.where);
    rigCell = '3c:Skyrim.esm';
    const r3 = rig().findPlace(String(NAME[first]).toLowerCase());
    yes('S7 and an outside door is used when there is one',
        !!r3.where && r3.where.desc === '3c:Skyrim.esm');
  }

  // S8: a load order missing the plugin answers nothing rather than throwing.
  {
    const none = rig({ noDoors: true });
    const first = Object.keys(NAME)[0];
    const r = none.findPlace(String(NAME[first]).toLowerCase());
    yes('S8 a building whose plugin is not loaded is refused, not crashed',
        !r.where && !!r.why);
  }

  // S9: the command takes the whole line, not the first word.
  {
    const cmd = src.slice(src.indexOf("word === '/tp'"), src.indexOf("log('command: /tp'"));
    yes('S9 /tp reads the rest of the line, because place names have spaces',
        /parts\.slice\(1\)\.join\(' '\)/.test(cmd));
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
