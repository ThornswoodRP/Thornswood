// test-2679-furniture.js
//
// Furniture a holder sets down, moves and picks up in a held building
// (#2679, split from #507). The design is on the issue (comment 6246616411).
//
// What this holds:
//   - the catalog, game/data/furniture.json, is staff data with every number
//     in it, its form ids in the plugin's furniture range, and statics off;
//   - the content records and the recipes exist for every row that is on,
//     at the woodworking bench, owned by the Woodwright;
//   - the furniture block's core, driven with a pretend world: who may
//     arrange (holder, deed, master key; not a plain key, not a stranger,
//     not in a building nobody holds), the cap, placing in front of you and
//     facing you, moving, turning, picking up (a chest only empty), the
//     register naming nobody, standing pieces again at start, and the pieces
//     staying with the building when a claim lapses;
//   - nothing is typed: /furniture is registered, dispatched and not in
//     PLAYER_WORDS, and the plugin's keys, lines and panel send it;
//   - a wipe takes the register with the world (Wipe-Saves.ps1);
//   - on a machine with the game, every base is the kind its row says and a
//     container base neither respawns nor carries contents.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) { return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split('\r\n').join('\n'); }

const gm = require('./gamemode-tables.js').joined(read('game/gamemode.js'));
const front = read('game/plugins/thornswood-front.js');
const doc = JSON.parse(read('game/data/furniture.json'));
const acr = read('scripts/mods/Add-ContentRecords.py');

// ------------------------------------------------------------ the catalog
{
  const L = doc.limits || {};
  ['perBuilding', 'reach', 'pickReach', 'carryMs', 'turnStep'].forEach(function (k) {
    yes('limits.' + k + ' is a number in the catalog', typeof L[k] === 'number' && L[k] > 0);
  });
  yes('limits.buildings is a table of per-building caps', L.buildings && typeof L.buildings === 'object');
  yes('FURN and CONT are on, STAT is off until the dev check', L.types && L.types.FURN === true &&
      L.types.CONT === true && L.types.STAT === false);
  const ids = {};
  let inRange = true, unique = true, shaped = true;
  (doc.pieces || []).forEach(function (r) {
    [r.item, r.recipe].forEach(function (h) {
      const n = parseInt(h, 16);
      if (!(n >= 0x16000 && n <= 0x16fff)) { inRange = false; }
      if (ids[n]) { unique = false; }
      ids[n] = true;
    });
    if (!r.key || !r.edid || !r.name || !/^[0-9a-f]+:Skyrim\.esm$/.test(r.base) ||
        ['FURN', 'CONT', 'STAT'].indexOf(r.type) < 0 || !Array.isArray(r.inputs) || !r.inputs.length) { shaped = false; }
  });
  yes('every row has its key, editor id, name, a Skyrim.esm base, a type and inputs', shaped);
  yes('every item and recipe id is in 0x16000-0x16fff', inRange);
  yes('no id is used twice', unique);
  yes('at least one chair, one bed and one chest are on', ['chair', 'bed', 'chest'].every(function (k) {
    return (doc.pieces || []).some(function (r) { return r.key === k && L.types[r.type]; });
  }));
}

// ------------------------------------------------ the records and recipes
{
  yes('Add-ContentRecords.py writes the furniture rows', acr.indexOf('out += furniture_records()') >= 0 &&
      acr.indexOf("FURNITURE_RANGE = (0x5016000, 0x5016FFF)") >= 0);
  yes('a row is written only while its type is on', /if not types\.get\(row\.get\('type'\)\):\s*\n\s*continue/.test(acr));
  yes('the recipe is made at the woodworking bench', /cobj\(recipe,[^\n]*\n[^\n]*inputs, item, WOODWORKING_KEYWORD\)/.test(acr));
  let all = true, offs = true;
  // The gamemode reads RECIPES_BY_ID from game/gamemode-tables (#5191).
  const BOOK = require('./gamemode-tables.js').table('RECIPES_BY_ID');
  (doc.pieces || []).forEach(function (r) {
    const row = BOOK[r.recipe + ':Thornswood-Content.esp'];
    const at = row && row.out === r.item + ':Thornswood-Content.esp' ? row : null;
    if (doc.limits.types[r.type]) {
      if (!at || at.owner !== 'Woodworker' || at.half !== 'Woodwright') {
        all = false; console.log('      no Woodwright recipe row for ' + r.key);
      }
    } else if (at) { offs = false; }
  });
  yes('RECIPES_BY_ID has a Woodwright row for every piece that is on', all);
  yes('RECIPES_BY_ID has no row for a piece that is off', offs);
  const recipes = JSON.parse(read('game/data/recipes.json'));
  const flat = JSON.stringify(recipes);
  yes('game/data/recipes.json names the furniture recipes', flat.indexOf('16081:Thornswood-Content.esp') >= 0);
}

// -------------------------------------------- the core, in a pretend world
const a = gm.indexOf('// ==== thornswood furniture ====');
const b = gm.indexOf('// ==== end thornswood furniture ====');
yes('the furniture block is in the gamemode', a > 0 && b > a);
const block = gm.slice(a, b);
const box = { require: require, console: console };
vm.createContext(box);
vm.runInContext(block, box);
const create = box.__thornswoodFurnitureCreate;
yes('the block hands its core out for tests', typeof create === 'function');

function world() {
  const W = {
    t: 1000000, logs: [], lines: {}, shows: {}, book: null, nextRef: 0xff000001,
    refs: {}, actors: {}, claims: {}, deeds: {}, masters: {}, keys: {}, online: [], refuse: '', throwPlace: false,
    doors: { 'b1:Skyrim.esm': 0x500, 'b2:Skyrim.esm': 0x501 }
  };
  const cat = JSON.parse(JSON.stringify(doc));
  cat.pieces.forEach(function (r) { r.itemDesc = r.item + ':Thornswood-Content.esp'; });
  W.catalog = cat;
  W.refs[0x500] = { base: 'door', cell: 'b1:Skyrim.esm', pos: [0, 0, 0], angle: 0 };
  W.refs[0x501] = { base: 'door', cell: 'b2:Skyrim.esm', pos: [0, 0, 0], angle: 0 };
  W.api = {
    catalog: cat,
    now: function () { return W.t; },
    log: function () { W.logs.push(Array.prototype.join.call(arguments, ' ')); },
    readRegister: function () { return W.book ? JSON.parse(JSON.stringify(W.book)) : null; },
    writeRegister: function (bk) { W.book = JSON.parse(JSON.stringify(bk)); },
    cellOf: function (id) { const o = W.actors[id] || W.refs[id]; return o ? o.cell : ''; },
    posOf: function (id) { const o = W.actors[id] || W.refs[id]; return o ? o.pos.slice() : null; },
    angleOf: function (id) { const o = W.actors[id] || W.refs[id]; return o ? [0, 0, o.angle] : null; },
    isBuilding: function (cell) { return Object.prototype.hasOwnProperty.call(W.doors, cell); },
    holderOf: function (bd) { return W.claims[bd] || null; },
    nameOf: function (bd) { return bd === 'b1:Skyrim.esm' ? 'Breezehome' : 'The Shack'; },
    mayArrange: function (id, bd, held) {
      return held.by === W.actors[id].pid || !!(W.deeds[id] === bd) || !!(W.masters[id] === bd);
    },
    who: function (id) { return 'p' + id; },
    online: function () { return W.online; },
    count: function (id, desc) { return (W.actors[id].pack[desc] || 0); },
    take: function (id, desc) { if (!(W.actors[id].pack[desc] > 0)) { return false; } W.actors[id].pack[desc]--; return true; },
    give: function (id, desc) { W.actors[id].pack[desc] = (W.actors[id].pack[desc] || 0) + 1; return true; },
    baseRefusal: function () { return W.refuse; },
    place: function (base) {
      if (W.throwPlace) { throw new Error('no'); }
      const id = W.nextRef++; W.refs[id] = { base: base, cell: '3c:Skyrim.esm', pos: [0, 0, 0], angle: 0, inv: 0 }; return id;
    },
    turn: function (id, ang) { W.refs[id].angle = ang; },
    moveNear: function (id, anchor, pos) {
      const an = W.actors[anchor] || W.refs[anchor];
      W.refs[id].cell = an.cell; W.refs[id].pos = pos.slice();
    },
    remove: function (id) { delete W.refs[id]; },
    containerEmpty: function (id) { return !(W.refs[id].inv > 0); },
    refStands: function (id, base) { return !!W.refs[id] && W.refs[id].base === base; },
    refAt: function (id, base, cell, pos, ang) {
      const r = W.refs[id];
      return !!r && r.base === base && r.cell === cell && Math.abs(r.pos[0] - pos[0]) <= 1 &&
        Math.abs(r.pos[1] - pos[1]) <= 1 && Math.abs(r.angle - ang) < 0.5;
    },
    anchorIn: function (bd) { return W.doors[bd] && W.refs[W.doors[bd]] ? W.doors[bd] : 0; },
    line: function (id, v) { W.lines[id] = v; },
    show: function (id, v) { W.shows[id] = v; }
  };
  return W;
}

function actor(W, id, pid, cell, pos, angle, pack) {
  W.actors[id] = { pid: pid, cell: cell, pos: pos, angle: angle || 0, pack: pack || {} };
  W.online.push(id);
}

const CHAIR = '16001:Thornswood-Content.esp';
const CHEST = '16009:Thornswood-Content.esp';
const B1 = 'b1:Skyrim.esm';

{
  const W = world();
  W.claims[B1] = { by: 1, name: 'Holder' };
  actor(W, 0x14, 1, B1, [100, 100, 0], 0, { [CHAIR]: 2, [CHEST]: 1 });
  actor(W, 0x15, 2, B1, [110, 110, 0], 90, { [CHAIR]: 1 });   // a stranger
  actor(W, 0x16, 3, B1, [120, 100, 0], 0, { [CHAIR]: 1 });   // carries the deed
  actor(W, 0x17, 4, B1, [100, 120, 0], 0, { [CHAIR]: 1 });   // carries the master key
  actor(W, 0x18, 5, 'b2:Skyrim.esm', [0, 0, 0], 0, { [CHAIR]: 1 });   // nobody holds b2
  actor(W, 0x19, 6, '3c:Skyrim.esm', [0, 0, 0], 0, { [CHAIR]: 1 });   // outdoors
  W.deeds[0x16] = B1;
  W.masters[0x17] = B1;
  const F = create(W.api);

  F.command(0x14, []);
  const v = W.shows[0x14];
  yes('the holder\'s panel opens with the building, the cap and the pieces they carry',
      v && v.open && v.n === 'Breezehome' && v.cap === doc.limits.perBuilding && !v.why &&
      v.rows.some(function (r) { return r.key === 'chair' && r.carried === 2; }));
  yes('the panel lists no static while STAT is off', v.rows.every(function (r) {
    return doc.pieces.filter(function (p) { return p.key === r.key; })[0].type !== 'STAT';
  }));
  yes('opening the panel writes the line too', W.lines[0x14] && W.lines[0x14].may === true);

  yes('a stranger may not arrange', /held by Holder/.test(F.command(0x15, ['place', 'chair'])) && W.actors[0x15].pack[CHAIR] === 1);
  yes('the stranger\'s line says no', F.lineFor(0x15).may === false && F.lineFor(0x15).p.length === 0);
  yes('nobody may arrange a building nobody holds', /Nobody holds/.test(F.command(0x18, ['place', 'chair'])));
  yes('nobody may arrange outdoors', /inside a building/.test(F.command(0x19, ['place', 'chair'])));

  const said = F.command(0x14, ['place', 'chair']);
  const refs = Object.keys(F.pieces());
  const p = F.pieces()[refs[0]];
  yes('the holder sets a chair down', said === '' && refs.length === 1 && W.actors[0x14].pack[CHAIR] === 1);
  yes('it stands in front of them, at the reach, in the building',
      W.refs[p.ref].cell === B1 && Math.abs(W.refs[p.ref].pos[0] - 100) < 0.01 &&
      Math.abs(W.refs[p.ref].pos[1] - (100 + doc.limits.reach)) < 0.01);
  yes('it faces them', W.refs[p.ref].angle === 180 && p.angle === 180);
  yes('the panel shuts after a Place that worked', W.shows[0x14].open === false);
  yes('everybody in the building who may arrange has the piece on their line',
      W.lines[0x16].p.indexOf(refs[0]) >= 0 && W.lines[0x17].p.indexOf(refs[0]) >= 0 && W.lines[0x15].p.length === 0);
  yes('the register names nobody', JSON.stringify(W.book).indexOf('"by"') < 0 &&
      JSON.stringify(W.book).indexOf('pid') < 0 && W.book.pieces[refs[0]].building === B1);
  yes('the register keeps the row, base, place and angle', W.book.pieces[refs[0]].key === 'chair' &&
      W.book.pieces[refs[0]].base === '2ec1c:Skyrim.esm' && W.book.pieces[refs[0]].pos.length === 3);
  yes('setting it down is logged with who did it', W.logs.some(function (l) { return /p20 set down a Wooden Chair/.test(l); }));

  yes('the deed carrier may arrange', F.command(0x16, ['place', 'chair']) === '');
  yes('the master key carrier may arrange', F.command(0x17, ['place', 'chair']) === '');
  yes('nothing carried, nothing placed', /You carry no Bar Stool/.test(F.command(0x14, ['place', 'stool'])));
  yes('a static cannot be set down while STAT is off', /cannot be set down|not furniture/.test(F.command(0x14, ['place', 'roundtable'])));
  W.refuse = 'respawns';
  yes('a base the server refuses is not set down and the item stays', /cannot be set down/.test(F.command(0x14, ['place', 'chest'])) &&
      W.actors[0x14].pack[CHEST] === 1);
  W.refuse = '';
  W.throwPlace = true;
  yes('a place that fails gives the item back', /back in your pack/.test(F.command(0x14, ['place', 'chest'])) &&
      W.actors[0x14].pack[CHEST] === 1 && Object.keys(F.pieces()).length === 3);
  W.throwPlace = false;

  // The cap, from staff data.
  W.catalog.limits.buildings[B1] = 3;
  yes('a building\'s own cap overrides the default', F.capOf(B1) === 3);
  yes('the cap refuses one more and keeps the item', /all it takes/.test(F.command(0x14, ['place', 'chest'])) &&
      W.actors[0x14].pack[CHEST] === 1);
  W.catalog.limits.buildings[B1] = 10;
  yes('a chest goes down under the cap', F.command(0x14, ['place', 'chest']) === '');
  const chestHex = Object.keys(F.pieces()).filter(function (k) { return F.pieces()[k].key === 'chest'; })[0];

  // Move, set down, turn.
  W.actors[0x14].pos = [5000, 5000, 0];
  yes('too far to move', /closer/.test(F.command(0x14, ['move', refs[0]])));
  W.actors[0x14].pos = [100, 100, 0];
  yes('a key carrier cannot move what a stranger may not', /held by/.test(F.command(0x15, ['move', refs[0]])));
  yes('the holder takes it up', F.command(0x14, ['move', refs[0]]) === '' && W.lines[0x14].c === refs[0] &&
      W.lines[0x14].left === doc.limits.carryMs);
  yes('nobody else can take the same piece meanwhile', /Somebody else/.test(F.command(0x16, ['move', refs[0]])));
  yes('turn turns it by the step, where it stands', F.command(0x14, ['turn']) === '' &&
      W.refs[p.ref].angle === (180 + doc.limits.turnStep) % 360);
  W.actors[0x14].pos = [300, 300, 0];
  W.actors[0x14].angle = 90;
  yes('set it down here: in front of them, keeping its turn', F.command(0x14, ['down']) === '' &&
      Math.abs(W.refs[p.ref].pos[0] - (300 + doc.limits.reach)) < 0.01 && Math.abs(W.refs[p.ref].pos[1] - 300) < 0.01 &&
      W.refs[p.ref].angle === (180 + doc.limits.turnStep) % 360 && W.book.pieces[refs[0]].pos[0] === 300 + doc.limits.reach);
  yes('the hands are empty after', W.lines[0x14].c === '' && /not carrying/.test(F.command(0x14, ['down'])));
  W.actors[0x14].pos = W.refs[p.ref].pos.slice();
  F.command(0x14, ['move', refs[0]]);
  W.t += doc.limits.carryMs + 1;
  yes('after the carry time it is let go where it stands', /not carrying/.test(F.command(0x14, ['down'])) &&
      W.book.pieces[refs[0]].pos[0] === 300 + doc.limits.reach);
  let wrapped = true;
  F.command(0x14, ['move', refs[0]]);
  for (let i = 0; i < 20; i++) { F.command(0x14, ['turn']); if (!(W.refs[p.ref].angle >= 0 && W.refs[p.ref].angle < 360)) { wrapped = false; } }
  yes('turning goes round and stays between 0 and 360', wrapped);
  F.command(0x14, ['down']);

  // Pick up.
  W.actors[0x14].pos = W.refs[F.pieces()[chestHex].ref].pos.slice();
  W.refs[F.pieces()[chestHex].ref].inv = 2;
  yes('a chest with something in it is not picked up', /Empty the Chest/.test(F.command(0x14, ['pick', chestHex])) &&
      !!F.pieces()[chestHex]);
  W.refs[F.pieces()[chestHex].ref].inv = 0;
  const chestRef = F.pieces()[chestHex].ref;
  yes('an empty chest is picked up into the pack', F.command(0x14, ['pick', chestHex]) === '' &&
      !W.refs[chestRef] && !F.pieces()[chestHex] && W.actors[0x14].pack[CHEST] === 1 && !W.book.pieces[chestHex]);
  yes('a piece nobody set down is not touched', /not a piece/.test(F.command(0x14, ['pick', '500'])) && !!W.refs[0x500]);

  // A claim lapses: the pieces stay, and the next holder may arrange them.
  delete W.claims[B1];
  yes('a claim that ends leaves the pieces in the register', Object.keys(F.pieces()).length === 3);
  yes('with nobody holding it, nobody arranges', /Nobody holds/.test(F.command(0x14, ['move', refs[0]])));
  W.claims[B1] = { by: 2, name: 'Next' };
  W.actors[0x15].pos = W.refs[p.ref].pos.slice();
  yes('the next holder may pick up what the last one set down', F.command(0x15, ['pick', refs[0]]) === '' &&
      W.actors[0x15].pack[CHAIR] === 2);

  // A restart.
  const book = W.book;
  const left = Object.keys(book.pieces);
  const one = book.pieces[left[0]], two = book.pieces[left[1]];
  delete W.refs[two.ref];
  W.refs[one.ref].pos = [0, 0, 0];
  W.logs = [];
  const F2 = create(W.api);
  const r = F2.standAll();
  yes('at start a piece that wandered is moved back and a missing one is stood again', r.stood === 2 && r.kept === 0);
  const after = Object.keys(F2.pieces()).map(function (k) { return F2.pieces()[k]; });
  yes('every piece stands where the register says, in its building', after.every(function (q) {
    return W.refs[q.ref] && W.refs[q.ref].cell === B1 && Math.abs(W.refs[q.ref].pos[0] - q.pos[0]) < 0.01 &&
      W.refs[q.ref].angle === q.angle;
  }));
  yes('a piece placed again is kept under its new reference', Object.keys(W.book.pieces).length === 2 &&
      Object.keys(W.book.pieces).every(function (k) { return parseInt(k, 16) === W.book.pieces[k].ref; }));
  const r2 = create(W.api).standAll();
  yes('a second start finds every piece where it was', r2.kept === 2 && r2.stood === 0);
  delete W.refs[0x500];
  const k0 = Object.keys(W.book.pieces)[0];
  delete W.refs[W.book.pieces[k0].ref];
  const r3 = create(W.api).standAll();
  yes('with nothing to stand next to, a piece is said and kept for the next start',
      r3.stood === 0 && !!W.book.pieces[k0] && W.logs.some(function (l) { return /nothing to stand/.test(l); }));
}

// --------------------------------------------------- the wiring on the server
{
  const list = gm.indexOf("               '/furniture',");
  yes('/furniture is registered with the commands', list > 0);
  const pw = gm.indexOf('const PLAYER_WORDS = [');
  const pwEnd = gm.indexOf('];', pw);
  yes('/furniture is not in PLAYER_WORDS', pw > 0 && gm.slice(pw, pwEnd).indexOf('/furniture') < 0);
  yes('the dispatcher hands /furniture to the furniture block', /if \(word === '\/furniture'\) \{\s*\n\s*if \(!needCharacter\(\)\) \{ return; \}\s*\n\s*var arrange = g\.__thornswoodFurniture;/.test(gm));
  yes('the server reads the catalog from game/data', block.indexOf("path.join(root, 'data', 'furniture.json')") >= 0);
  yes('the register is private/furniture.json, beside property.json', block.indexOf("path.join(dir, 'furniture.json')") >= 0 &&
      block.indexOf('privDir') >= 0);
  yes('the rights are setLock\'s: holder, deed or master key', /held\.by === pid\) \|\| P\.holdsDeed\(actorId, building\) \|\|\s*\n\s*P\.holdsMasterKey\(actorId, building\)/.test(block));
  yes('a container base that respawns or brings contents is refused', block.indexOf("t === 'CNTO'") >= 0 &&
      block.indexOf('& 0x02') >= 0);
  yes('the angle is set before the move, the boards\' way', /turn: function \(id, angle\) \{ refCall\('SetAngle'/.test(block) &&
      /api\.turn\(id, angle\);\s*\n\s*api\.moveNear\(id, anchor, pos\);/.test(block));
  yes('the pieces are stood when the server starts', block.indexOf('g.__thornswoodFurniture.standAll();') >= 0);
  yes('every action is logged under [property]', block.indexOf("var a = ['[property]'];") >= 0);
}

// --------------------------------------------------- the plugin and the page
{
  yes('the panel is one of the overlays', /const OVERLAYS = \[[^\]]*'thornswood-furniture\.js'/.test(front));
  yes('the keys reach furniturePress and arrangePress before the mold key\'s other uses',
      /furniturePress\(e\.code\)\) \{ return; \}\s*\n\s*if \(e\.code === LOCK_KEY && arrangePress\(\)\) \{ return; \}\s*\n\s*if \(e\.code === MOLD_KEY && moldPress\(\)\)/.test(front));
  yes('the inventory line is Arrange furniture on the lock key', front.indexOf("lockRow(LOCK_NAME, 'Arrange furniture'") >= 0);
  yes('a piece offers Move and Pick up', front.indexOf("lockRow(MOLD_NAME, 'Move it'), lockRow(LOCK_NAME, 'Pick it up')") >= 0);
  yes('a piece in hand offers Set it down here and Turn it', front.indexOf("lockRow(MOLD_NAME, 'Set it down here'), lockRow(LOCK_NAME, 'Turn it')") >= 0);
  yes('the plugin asks for the line on a new cell and on the inventory', front.indexOf("tellServer('/furniture look')") >= 0);
  yes('a placed piece is found by its server id', /pieceLookedAt[\s\S]{0,700}thornswoodSocialServerId/.test(front));
  yes('focus follows the panel', front.indexOf("what === 'furniture:opened'") >= 0 && front.indexOf("what === 'furniture:closed'") >= 0);
  const page = read('game/ui/thornswood-furniture.js');
  yes('the page keeps the contract', page.indexOf('window.thornswoodFurniture = {') >= 0 &&
      page.indexOf("net('/furniture place ' + row.key)") >= 0 && page.indexOf("'furniture:' + what") >= 0);
  yes('nothing on the page tells anybody to type', !/type \/|\/furniture</.test(page));
  yes('the UI README names the panel', read('game/ui/README.md').indexOf('thornswood-furniture.js') >= 0);
}

// --------------------------------------------------------- docs and the wipe
{
  const wipe = read('scripts/ops/Wipe-Saves.ps1');
  const lists = wipe.split('\n').filter(function (l) { return l.indexOf("@('world', 'private\\characters.json'") >= 0; });
  yes('Wipe-Saves.ps1\'s one list of what a wipe moves aside, $Moves, takes private\\furniture.json', lists.length === 1 &&
      /^\$Moves = @\(/.test(lists[0]) && lists[0].indexOf("'private\\furniture.json'") >= 0);
  const pm = read('docs/systems/property.md');
  yes('property.md has the furniture section', pm.indexOf('## Furniture') >= 0 && pm.indexOf('game/data/furniture.json') >= 0);
  yes('commands.md has the /furniture row', read('docs/systems/commands.md').indexOf('| `/furniture`') >= 0);
  yes('this harness runs in both workflows (it is not in tests/gate-excluded.txt, #3009)', !/^test-2679-furniture\.js\s/m.test(read('tests/gate-excluded.txt')));
}

// ------------------------------------ on a machine with the game: the bases
{
  const esm = 'C:\\Thornswood\\Game\\Data\\Skyrim.esm';
  if (!fs.existsSync(esm)) {
    console.log('SKIP  no ' + esm + ' here, so the bases are not read');
  } else {
    const buf = fs.readFileSync(esm);
    const want = {};
    doc.pieces.forEach(function (r) { want[parseInt(r.base, 16)] = r; });
    const found = {};
    const hs = buf.readUInt32LE(4);
    let p = 24 + hs;
    while (p + 24 <= buf.length) {
      const size = buf.readUInt32LE(p + 4);
      const label = buf.toString('ascii', p + 8, p + 12);
      if (buf.toString('ascii', p, p + 4) === 'GRUP' && ['FURN', 'CONT', 'STAT'].indexOf(label) >= 0) {
        let q = p + 24;
        while (q < p + size) {
          const tag = buf.toString('ascii', q, q + 4), ds = buf.readUInt32LE(q + 4);
          if (tag === 'GRUP') { q += ds; continue; }
          const flags = buf.readUInt32LE(q + 8), fid = buf.readUInt32LE(q + 12) & 0xffffff;
          if (want[fid]) {
            const rec = { type: tag, cnto: false, respawn: false, compressed: !!(flags & 0x40000) };
            if (!rec.compressed) {
              let s = q + 24;
              while (s < q + 24 + ds) {
                const st = buf.toString('ascii', s, s + 4), sl = buf.readUInt16LE(s + 4);
                if (st === 'CNTO') { rec.cnto = true; }
                if (st === 'DATA' && tag === 'CONT' && (buf[s + 6] & 0x02)) { rec.respawn = true; }
                s += 6 + sl;
              }
            }
            found[fid] = rec;
          }
          q += 24 + ds;
        }
      }
      p += buf.toString('ascii', p, p + 4) === 'GRUP' ? size : 24 + size;
    }
    doc.pieces.forEach(function (r) {
      const f = found[parseInt(r.base, 16)];
      yes(r.key + ': ' + r.base + ' is a ' + r.type + ' in Skyrim.esm', !!f && f.type === r.type);
      if (r.type === 'CONT') {
        yes(r.key + ': the container neither respawns nor carries contents', !!f && !f.compressed && !f.cnto && !f.respawn);
      }
    });
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
