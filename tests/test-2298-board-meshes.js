// tests/test-2298-board-meshes.js
//
//     node tests/test-2298-board-meshes.js
//
// #2298: the notice board and the hold's drop box are Thornswood's own meshes,
// built from vanilla pieces by scripts/mods/Build-NoticeBoard.py, and
// Patrick's rule (12 Oct) is that clicking the board does only the board and
// clicking the box does only the box. Since #2827 neither mesh is in the
// repository or ships: each machine makes them from its own game
// (launcher/app/FromGame.cs), from the recipe Build-NoticeBoard.py writes,
// launcher/app/FromGameBoard.cs. Build-NoticeBoard.py checks each mesh it
// builds (a whole NIF, every texture in the game's own archives) before it
// writes the recipe, the launcher writes a mesh only when it is the sha256
// the recipe names, and tests/test-2827-from-game.ps1 holds the launcher's
// build to the script's. This proves, from the recipe, without the game:
//
//   1. The meshes it makes are the ones that shipped until #2827 (their
//      sha256 and size), from vanilla meshes only.
//   2. Nothing in the recipe is the Missives board's (no missive). The other
//      server's short names, which its folder carried, are refused in every
//      tracked file by tests/test-other-server-name-gone.js.
//   3. Each has its own collision, and none of the board's reaches over the
//      box where it stands beside the board; the box's covers only the box.
//   4. Thornswood-Content.esp's board names the new mesh, the drop box is a
//      separate object naming its own, and no record names the old mesh.
//   5. Go.ps1 makes both meshes, and Ship-Rules.ps1 never ships them.
//   6. E on the board or the box is the server's to answer, on its own
//      references (#2516): the client answers neither, so a press on the box
//      can never open the board. game/tests/test-2516-server-boards.js drives the
//      server's answer: the board opens only the board, the box only the box.
//
// What cannot be proven here is how the game's own crosshair meets that
// collision; that is the in game check on the issue's test task.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
const read = rel => fs.readFileSync(path.join(REPO, rel));
const HAVOK = 69.99125;
const RECIPE = 'launcher/app/FromGameBoard.cs';
// Where the box's origin stands in the board's own space (Build-NoticeBoard.py says it).
const BOX_AT = [-134.52, 4.0, 80.0];

// ------------------------------------------------------------ the recipe --
const recipe = read(RECIPE).toString().replace(/\r\n/g, '\n');
// A C# string the recipe writes as base64 in pieces joined with +.
const blob = text => Buffer.from([...text.matchAll(/"([A-Za-z0-9+/=]*)"/g)].map(m => m[1]).join(''), 'base64');
function field(name) {
  const m = new RegExp('\\n\\s*' + name + ' = ([\\s\\S]*?),\\n\\s*([A-Z][A-Za-z0-9]* = |\\})').exec(recipe);
  return m ? m[1] : null;
}
function blobs(name) {
  const m = new RegExp('\\n\\s*' + name + ' = new\\[\\]\\s*\\{([\\s\\S]*?)\\n\\s*\\},').exec(recipe);
  return m ? m[1].split(/,\n/).map(t => t.trim()).filter(Boolean).map(blob) : [];
}
// Corners of a bhkConvexVerticesShape block, in game units.
function corners(b) {
  let o = 32;
  const n = b.readUInt32LE(o); o += 4;
  const v = [];
  for (let i = 0; i < n; i++) {
    v.push([0, 1, 2].map(j => b.readFloatLE(o + 4 * j) * HAVOK));
    o += 16;
  }
  return v;
}

// ---------------------------------------------------------------- 1 and 2 --
{
  yes('the board it makes is the one that shipped until #2827 (155,907 bytes)',
      field('BoardSha256') === '"47cfe0f22bdf8db0c66ad059cf77c546aeba972ad694d20e6ad7318630918216"' && field('BoardSize') === '155907');
  yes('and so is the drop box (29,665 bytes)',
      field('BoxSha256') === '"09d8ae9277b6006017ff82f21fa2081e63f6c2249ffe63300e1e8cffb299241e"' && field('BoxSize') === '29665');
  const meshes = [...recipe.matchAll(/new Board(?:Part|Source)\("[^"]*", "([^"]+)"|new BoardSource\("([^"]+)"/g)].map(m => (m[1] || m[2]));
  const named = [...recipe.matchAll(/"(meshes\\\\[^"]+)"/g)].map(m => m[1].replace(/\\\\/g, '\\'));
  yes('every piece is one of the game\'s own meshes (' + new Set(named).size + ' of them), none of Thornswood\'s',
      named.length > 0 && named.every(p => /^meshes\\/.test(p) && !/^meshes\\thornswood\\/.test(p)) && meshes.length > 0);
  yes('the recipe carries nothing of the Missives board', recipe.toLowerCase().indexOf('missive') < 0);
}

// ---------------------------------------------------------------------- 3 --
{
  const boardHulls = blobs('BoardHulls').map(corners);
  const boxHulls = blobs('BoxHulls').map(corners);
  yes('the board has a collision box for each part but the notices (11), in one list', boardHulls.length === 11 && field('BoardList') !== 'null');
  yes('the box has one, covering only the box', boxHulls.length === 1 && field('BoxList') === 'null');
  const bx = boxHulls[0].map(v => [v[0] + BOX_AT[0], v[1] + BOX_AT[1], v[2] + BOX_AT[2]]);
  const lo = [0, 1, 2].map(i => Math.min(...bx.map(v => v[i])));
  const hi = [0, 1, 2].map(i => Math.max(...bx.map(v => v[i])));
  yes('the box, where it is placed, stands on the shelf (its bottom ' + lo[2].toFixed(1) + ')', Math.abs(lo[2] - 80) < 0.5);
  // A board hull reaches over the box when any part of it lies inside the box's
  // footprint above the shelf. Each hull is a box; test its corners and centre.
  const inside = p => p[0] > lo[0] + 0.5 && p[0] < hi[0] - 0.5 && p[1] > lo[1] + 0.5 && p[1] < hi[1] - 0.5 &&
                      p[2] > lo[2] + 0.5 && p[2] < hi[2] - 0.5;
  let over = 0;
  for (const h of boardHulls) {
    const c = [0, 1, 2].map(i => h.reduce((s, v) => s + v[i], 0) / h.length);
    if (h.some(inside) || inside(c)) { over++; }
    // and a hull that passes over the box's top, inside its footprint, is over it too
    const hlo = [0, 1, 2].map(i => Math.min(...h.map(v => v[i])));
    const hhi = [0, 1, 2].map(i => Math.max(...h.map(v => v[i])));
    const overlapsXY = hlo[0] < hi[0] && hhi[0] > lo[0] && hlo[1] < hi[1] && hhi[1] > lo[1];
    if (overlapsXY && hlo[2] < hi[2] + 40 && hhi[2] > lo[2] + 0.5) { over++; }
  }
  yes('no board collision reaches into or just over the box', over === 0);
}

// ---------------------------------------------------------------------- 4 --
{
  const esp = read('game/content/Thornswood-Content.esp');
  function records(buf) {
    const out = [];
    const hs = buf.readUInt32LE(4);
    (function walk(p, end) {
      while (p + 24 <= end) {
        const tag = buf.toString('latin1', p, p + 4);
        const size = buf.readUInt32LE(p + 4);
        if (tag === 'GRUP') { walk(p + 24, p + size); p += size; continue; }
        const flags = buf.readUInt32LE(p + 8);
        let data = buf.subarray(p + 24, p + 24 + size);
        if (flags & 0x40000) { data = zlib.inflateSync(data.subarray(4)); }
        out.push({ tag, fid: buf.readUInt32LE(p + 12), data });
        p += 24 + size;
      }
    })(24 + hs, buf.length);
    return out;
  }
  function sub(data, want) {
    for (let i = 0; i + 6 <= data.length;) {
      const t = data.toString('latin1', i, i + 4);
      const n = data.readUInt16LE(i + 4);
      if (t === want) { return data.subarray(i + 6, i + 6 + n); }
      i += 6 + n;
    }
    return null;
  }
  const z = b => (b ? b.toString('latin1').replace(/\0+$/, '') : '');
  const recs = records(esp);
  const board = recs.find(r => r.tag === 'ACTI' && r.fid === 0x0500593B);
  const box = recs.find(r => r.fid === 0x050154D0);
  yes('the board (ACTI 0500593B) names meshes\\thornswood\\noticeboard01.nif',
      !!board && z(sub(board.data, 'EDID')) === 'ThornswoodMessageBoard' &&
      z(sub(board.data, 'MODL')) === 'thornswood\\noticeboard01.nif');
  yes('  and its bounds are the new mesh\'s, not the old one\'s', !!board && (() => {
    const o = sub(board.data, 'OBND');
    return o && [0, 1, 2, 3, 4, 5].map(i => o.readInt16LE(2 * i)).join(',') === '-168,-71,0,140,71,246';
  })());
  yes('the drop box is an object of its own (050154D0, ThornswoodDropBox) on dropbox01.nif',
      !!box && z(sub(box.data, 'EDID')) === 'ThornswoodDropBox' && z(sub(box.data, 'MODL')) === 'thornswood\\dropbox01.nif');
  // Not a container: a container shows whoever opens it everything in it, and
  // Patrick's rule is that a person sees only what they put in (#2298).
  yes('  an activator, so E on it is answered by the box\'s own panel, never a container\'s',
      !!box && box.tag === 'ACTI');
  yes('no record names the old Missives board any more',
      !recs.some(r => r.data.toString('latin1').toLowerCase().indexOf('missiveboard') >= 0));
}

// ---------------------------------------------------------------------- 5 --
{
  const go = read('scripts/release/Go.ps1').toString();
  const rules = read('scripts/release/Ship-Rules.ps1').toString();
  yes('Go.ps1 makes the meshes from the game with the launcher\'s own code',
      go.indexOf('[Thornswood.FromGame]::Build(') >= 0 && go.indexOf("'FromGame*.cs'") >= 0);
  for (const p of ['Data\\meshes\\thornswood\\noticeboard01.nif', 'Data\\meshes\\thornswood\\dropbox01.nif']) {
    yes(p + ' is made from the game in Ship-Rules.ps1 and never ours to ship',
        /\$ShipMadeFromGame = @\(([\s\S]*?)\n\)/.exec(rules)[1].indexOf("'" + p + "'") >= 0 &&
        /\$ShipOursFiles = @\(([\s\S]*?)\n\)/.exec(rules)[1].indexOf("'" + p + "'") < 0 &&
        !fs.existsSync(path.join(REPO, 'game', 'ours', ...p.split('\\'))));
  }
}

// ---------------------------------------------------------------------- 6 --
{
  const front = read('game/plugins/thornswood-front.js').toString().replace(/\r\n/g, '\n');
  const gm = read('game/gamemode.js').toString().replace(/\r\n/g, '\n');
  yes('the client answers no press on the board or the box', front.indexOf('function boardPress(') < 0 &&
      front.indexOf('function boxPress(') < 0 && front.indexOf('function boardFacing(') < 0);
  yes('the server answers it, first in onActivate, on its own references',
      gm.indexOf('propBoard.boardActivated(refrId, casterRefrId)') > 0 &&
      gm.indexOf('propBoard.boardActivated(refrId, casterRefrId)') < gm.indexOf('WATER (#1382)'));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
