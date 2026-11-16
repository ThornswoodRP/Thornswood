// test-menu-backdrop.js
//
//     node tests\test-menu-backdrop.js
//
// Issue #425: the main menu drew its backdrop twice, the picture was one mip
// level, and the build assumed a plane shape the mesh disagrees with. This
// reads the three files in game\menu with a small nif and dds reader and
// proves each half:
//
//   1. logo.nif is one plate: a single shape under its root, textured with
//      MAINMENUWALLPAPER.dds.
//   2. logo01ae.nif is there (deleting it brings the vanilla Anniversary plate
//      back), and its root has the one shape child the Anniversary menu
//      reads, as the vanilla file does (a BSFadeNode over one BSTriShape).
//      Issue #1158: #425 made it an empty node, and the game crashed at the
//      main menu reading a first child that was not there. The shape is
//      flagged hidden and the root is at scale 0, so it draws nothing and the
//      menu has exactly one plate to draw, not two.
//   3. The plate as drawn has the shape Build-Backdrop.py builds for: the
//      mesh's width over height, after its own rotation and scale, equals
//      ASPECT; its V reaches texel row 3004, so ROWS is 3005; its UVs are a
//      flat, straight mapping of the plate, so a centred crop at ASPECT
//      squeezed into 4096 x ROWS is the right picture.
//   4. Mainmenuwallpaper.dds is 4096 x 4096 with a full chain of 13 mip
//      levels, sized exactly for its levels, and rows 3005 to 4095 repeat the
//      last picture row instead of black. 4096 texels over the plate's 20/21
//      of the screen width is at least one texel per screen pixel up to 3900
//      wide, so 1080p to 4K is never magnified.
//   5. Issue #994: it is BC7_UNORM, not DXT1, which banded the sky, and not
//      BC7_UNORM_SRGB, which draws darker. A small BC7 decoder below reads
//      the pixels back: alpha stays above the plate's alpha test everywhere,
//      the row repeated under the picture is picture, not black padding, and
//      along the sky row BACKDROP-
//      SPEC.md measured (y = 60) no flat band is anywhere near DXT1's 204
//      texels.
//   6. Build-Backdrop.py's default paths exist, it pins texconv by release
//      and sha256, THIRD-PARTY.md names that same file, --logo reproduces
//      logo.nif and --blank-logo logo01ae.nif byte for byte (needs python;
//      SKIP without it). Issue #2177: logo.nif is Thornswood's own since
//      16 Oct, one flat plate the script writes from its own numbers, so
//      neither mesh carries anything of the wallpaper replacer it replaced
//      (its root name, its author string, its optimizer's stamp).
//      With THORNSWOOD_REBUILD_BACKDROP=1 it also rebuilds the texture from
//      the picture and holds it to game\menu byte for byte (about half an
//      hour of processor, so not by default).
//   7. Check-Backdrop.ps1 passes the repo's three files in a game folder and
//      names a DXT1 or BC7_UNORM_SRGB texture as wrong (Windows only).
//   8. Go.ps1 copies, and Ship-Rules.ps1 owns, the same three files.
//
// The source picture's size is reported, not failed: the artist's 4466 x 3016
// render is what makes the picture sharp, and it is outside the code.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const MENU = path.join(REPO, 'game', 'menu');
const BUILD = path.join(REPO, 'scripts', 'dev', 'Build-Backdrop.py');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}

// ------------------------------------------------------------ nif reader --
// Skyrim SE only: 20.2.0.7, user version 12, stream version 100. Every block
// is located from the header's size table, so a block this does not parse is
// still counted and skipped correctly.
function readNif(file) {
  const b = Buffer.isBuffer(file) ? file : fs.readFileSync(file);
  let o = b.indexOf(10) + 1;
  const nif = { bytes: b, version: b.readUInt32LE(o), user: b.readUInt32LE(o + 5),
    bsver: b.readUInt32LE(o + 13), types: [], blocks: [], strings: [] };
  const count = b.readUInt32LE(o + 9);
  o += 17;
  for (let i = 0; i < 3; i++) { o += 1 + b[o]; }
  const ntypes = b.readUInt16LE(o); o += 2;
  for (let i = 0; i < ntypes; i++) {
    const n = b.readUInt32LE(o); o += 4;
    nif.types.push(b.toString('latin1', o, o + n)); o += n;
  }
  const kinds = [];
  for (let i = 0; i < count; i++) { kinds.push(nif.types[b.readUInt16LE(o)]); o += 2; }
  const sizes = [];
  nif.sizesAt = o;
  for (let i = 0; i < count; i++) { sizes.push(b.readUInt32LE(o)); o += 4; }
  const nstr = b.readUInt32LE(o); o += 8;
  for (let i = 0; i < nstr; i++) {
    const n = b.readUInt32LE(o); o += 4;
    nif.strings.push(b.toString('latin1', o, o + n)); o += n;
  }
  const groups = b.readUInt32LE(o); o += 4 + 4 * groups;
  for (let i = 0; i < count; i++) {
    nif.blocks.push({ index: i, type: kinds[i], at: o, size: sizes[i] });
    o += sizes[i];
  }
  const roots = b.readUInt32LE(o);
  nif.root = roots ? b.readInt32LE(o + 4) : -1;
  nif.endsWhereItShould = (o + 4 + 4 * roots === b.length);
  return nif;
}

// NiObjectNET + NiAVObject as stream 100 writes them.
function avObject(b, o) {
  const r = { name: b.readInt32LE(o) };
  o += 4;
  o += 4 + 4 * b.readUInt32LE(o);          // extra data
  o += 4;                                  // controller
  r.flags = b.readUInt32LE(o); o += 4;
  r.t = [0, 1, 2].map(i => b.readFloatLE(o + 4 * i)); o += 12;
  r.R = [0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => b.readFloatLE(o + 4 * i)); o += 36;
  r.scale = b.readFloatLE(o); o += 4;
  o += 4;                                  // collision
  r.end = o;
  return r;
}

function children(nif, block) {
  const b = nif.bytes;
  const av = avObject(b, block.at);
  const n = b.readUInt32LE(av.end);
  const out = [];
  for (let i = 0; i < n; i++) { out.push(b.readInt32LE(av.end + 4 + 4 * i)); }
  return out;
}

const isShape = t => /TriShape|TriStrips/.test(t);
const isNode = t => /Node$/.test(t);

// Shapes the renderer draws: reachable from the root, not under an object
// flagged hidden (APP_CULLED, flag bit 0), at a scale above zero.
const HIDDEN = 1;
function drawn(nif) {
  const out = [];
  (function walk(i, scale) {
    if (i < 0 || i >= nif.blocks.length) { return; }
    const blk = nif.blocks[i];
    const av = avObject(nif.bytes, blk.at);
    if (av.flags & HIDDEN) { return; }
    if (isShape(blk.type)) { if (scale * av.scale > 0) { out.push({ block: blk, scale: scale * av.scale }); } return; }
    if (isNode(blk.type)) { for (const c of children(nif, blk)) { walk(c, scale * av.scale); } }
  })(nif.root, 1);
  return out;
}

function half(u) {
  const s = u >> 15, e = (u >> 10) & 31, f = u & 1023;
  const v = e === 0 ? f / 1024 * Math.pow(2, -14) : (1 + f / 1024) * Math.pow(2, e - 15);
  return s ? -v : v;
}

// BSTriShape, stream 100: vertices, UVs, and the shader and texture it uses.
function triShape(nif, blk) {
  const b = nif.bytes;
  const av = avObject(b, blk.at);
  let o = av.end + 16 + 4;                 // bound, skin
  const shader = b.readInt32LE(o); o += 8; // shader, alpha
  const descLo = b.readUInt32LE(o); o += 8;
  o += 2;                                  // triangles
  const nv = b.readUInt16LE(o); o += 2;
  o += 4;                                  // data size
  const vsize = (descLo & 0xf) * 4;
  const uvAt = ((descLo >>> 8) & 0xf) * 4;
  const verts = [];
  for (let i = 0; i < nv; i++) {
    const p = o + i * vsize;
    verts.push({ x: b.readFloatLE(p), y: b.readFloatLE(p + 4), z: b.readFloatLE(p + 8),
      u: half(b.readUInt16LE(p + uvAt)), v: half(b.readUInt16LE(p + uvAt + 2)) });
  }
  // The first texture of the texture set the shader names. A
  // BSLightingShaderProperty is: shader type, name, extra data, controller,
  // two flag words, UV offset, UV scale, then the texture set.
  let texture = null;
  const sh = nif.blocks[shader];
  if (sh && sh.type === 'BSLightingShaderProperty') {
    const extra = b.readUInt32LE(sh.at + 8);
    const set = nif.blocks[b.readInt32LE(sh.at + 12 + 4 * extra + 4 + 8 + 16)];
    if (set && set.type === 'BSShaderTextureSet' && b.readUInt32LE(set.at) > 0) {
      const len = b.readUInt32LE(set.at + 4);
      texture = b.toString('latin1', set.at + 8, set.at + 8 + len);
    }
  }
  return { av, verts, texture };
}

// ----------------------------------------------------------- BC7 decoder --
// The BC7 format as Microsoft documents it, enough to read texels back out.
// Partition and anchor tables are DirectXTex's (BC6HBC7.cpp, may2026).
// Checked on 28 Sep against texconv's own decode of the whole top level of
// the shipped file: every byte the same.
const P2 = (
  '0011001100110011000100010001000101110111011101110001001100110111' +
  '0000000100010011001101110111111100010011011111110000000100110111' +
  '0000000000010011001101111111111100000001011111110000000000010111' +
  '0001011111111111000000001111111100001111111111110000000000001111' +
  '0000100011101111011100010000000000000000100011100111001100010000' +
  '0011000100000000000010001100111000000000100011000111001100110001' +
  '0011000100010000000010001000110001100110011001100011011001101100' +
  '0001011111101000000011111111000001110001100011100011100110011100' +
  '0101010101010101000011110000111101011010010110100011001111001100' +
  '0011110000111100010101011010101001101001011010010101101010100101' +
  '0111001111001110000100111100100000110010010011000011101111011100' +
  '0110100110010110001111001100001101100110100110010000011001100000' +
  '0100111001000000001001110010000000000010011100100000010011100100' +
  '0110110010010011001101101100100101100011100111000011100111000110' +
  '0110110011001001011000110011100101111110100000010001100011100111' +
  '0000111100110011001100111111000000100010111011100100010001110111');
const P3 = (
  '0011001102212222000100112211222100002001221122110222002200110111' +
  '0000000011221122001100110022002200220022111111110011001122112211' +
  '0000000011112222000011111111222200001111222222220012001200120012' +
  '0112011201120112012201220122012200110112112212220011200122002220' +
  '0001001101121122011100112001220000001122112211220022002200221111' +
  '0111011102220222000100012221222100000011012201220000110022102210' +
  '0122012200110000001200121122222201101221122101100000011012211221' +
  '0022110211020022011001102002222200110122012200110000200022112221' +
  '0000000211221222022200220012001100110012002202220120012001200120' +
  '0000111122220000012012012012012001202012120101200011220011220011' +
  '0011112222000011010101012222222200000000212121210022112200221122' +
  '0022001100220011022012210220122101012222222201010000212121212121' +
  '0101010101012222022201110222011100021112000211120000211221122112' +
  '0222011101110222000211121112000201100110011022220000000021122112' +
  '0110011022222222002200110011002200221122112200220000000000002112' +
  '0002000100020001022212220222122201012222222222220111201122012220');
const A2 = [15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 2, 8, 2, 2, 8, 8, 15, 2, 8, 2, 2, 8, 8, 2, 2,
  15, 15, 6, 8, 2, 8, 15, 15, 2, 8, 2, 2, 2, 15, 15, 6, 6, 2, 6, 8, 15, 15, 2, 2, 15, 15, 15, 15, 15, 2, 2, 15];
const A3A = [3, 3, 15, 15, 8, 3, 15, 15, 8, 8, 6, 6, 6, 5, 3, 3, 3, 3, 8, 15, 3, 3, 6, 10, 5, 8, 8, 6, 8, 5, 15, 15,
  8, 15, 3, 5, 6, 10, 8, 15, 15, 3, 15, 5, 15, 15, 15, 15, 3, 15, 5, 5, 5, 8, 5, 10, 5, 10, 8, 13, 15, 12, 3, 3];
const A3B = [15, 8, 8, 3, 15, 15, 3, 8, 15, 15, 15, 15, 15, 15, 15, 8, 15, 8, 15, 3, 15, 8, 15, 8, 3, 15, 6, 10, 15, 15, 10, 8,
  15, 3, 15, 10, 10, 8, 9, 10, 6, 15, 8, 15, 3, 6, 6, 8, 15, 3, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 3, 15, 15, 8];
const WEIGHTS = { 2: [0, 21, 43, 64], 3: [0, 9, 18, 27, 37, 46, 55, 64],
  4: [0, 4, 9, 13, 17, 21, 26, 30, 34, 38, 43, 47, 51, 55, 60, 64] };
// subsets, partition bits, rotation bits, index selection bit, colour bits,
// alpha bits, a P-bit per endpoint, a P-bit per subset, index bits, second index bits
const MODES = [[3, 4, 0, 0, 4, 0, 1, 0, 3, 0], [2, 6, 0, 0, 6, 0, 0, 1, 3, 0], [3, 6, 0, 0, 5, 0, 0, 0, 2, 0],
  [2, 6, 0, 0, 7, 0, 1, 0, 2, 0], [1, 0, 2, 1, 5, 6, 0, 0, 2, 3], [1, 0, 2, 0, 7, 8, 0, 0, 2, 2],
  [1, 0, 0, 0, 7, 7, 1, 0, 4, 0], [2, 6, 0, 0, 5, 5, 1, 0, 2, 0]];

// One 16 byte block to 16 RGBA texels, row by row.
function bc7Block(buf, at) {
  let bit = 0;
  const get = n => {
    let v = 0;
    for (let i = 0; i < n; i++, bit++) { v |= ((buf[at + (bit >> 3)] >> (bit & 7)) & 1) << i; }
    return v;
  };
  let m = 0;
  while (m < 8 && !get(1)) { m++; }
  const px = new Uint8Array(64);
  if (m === 8) { return px; }                        // reserved: transparent black
  const [ns, pb, rb, isb, cb, ab, epb, spb, ib, ib2] = MODES[m];
  const part = get(pb), rot = get(rb), sel = get(isb);
  const ne = ns * 2;
  const ep = [];
  for (let i = 0; i < ne; i++) { ep.push([0, 0, 0, 255]); }
  for (let c = 0; c < 3; c++) { for (let i = 0; i < ne; i++) { ep[i][c] = get(cb); } }
  if (ab) { for (let i = 0; i < ne; i++) { ep[i][3] = get(ab); } }
  const chans = ab ? 4 : 3;
  if (epb) { for (let i = 0; i < ne; i++) { const p = get(1); for (let c = 0; c < chans; c++) { ep[i][c] = (ep[i][c] << 1) | p; } } }
  if (spb) { for (let s = 0; s < ns; s++) { const p = get(1); for (const i of [2 * s, 2 * s + 1]) { for (let c = 0; c < chans; c++) { ep[i][c] = (ep[i][c] << 1) | p; } } } }
  const extra = (epb || spb) ? 1 : 0;
  const widen = (v, n) => { v <<= (8 - n); return v | (v >> n); };
  for (const e of ep) {
    for (let c = 0; c < 3; c++) { e[c] = widen(e[c], cb + extra); }
    if (ab) { e[3] = widen(e[3], ab + extra); }
  }
  const subset = i => ns === 1 ? 0 : +(ns === 2 ? P2 : P3)[part * 16 + i];
  const anchor = i => i === 0 || (ns === 2 && i === A2[part]) || (ns === 3 && (i === A3A[part] || i === A3B[part]));
  const idx1 = [], idx2 = [];
  for (let i = 0; i < 16; i++) { idx1.push(get(anchor(i) ? ib - 1 : ib)); }
  if (ib2) { for (let i = 0; i < 16; i++) { idx2.push(get(i === 0 ? ib2 - 1 : ib2)); } }
  const mix = (a, b, w) => ((64 - w) * a + w * b + 32) >> 6;
  for (let i = 0; i < 16; i++) {
    const s = subset(i), e0 = ep[2 * s], e1 = ep[2 * s + 1];
    let cw, aw;
    if (ib2) {
      cw = sel ? WEIGHTS[ib2][idx2[i]] : WEIGHTS[ib][idx1[i]];
      aw = sel ? WEIGHTS[ib][idx1[i]] : WEIGHTS[ib2][idx2[i]];
    } else {
      cw = aw = WEIGHTS[ib][idx1[i]];
    }
    const t = [mix(e0[0], e1[0], cw), mix(e0[1], e1[1], cw), mix(e0[2], e1[2], cw), mix(e0[3], e1[3], aw)];
    if (rot) { const k = rot - 1; const a = t[3]; t[3] = t[k]; t[k] = a; }
    px.set(t, i * 4);
  }
  return px;
}

// A whole level, RGBA, from the byte where it starts.
function bc7Level(buf, at, size) {
  const out = new Uint8Array(size * size * 4);
  const bw = Math.max(1, Math.ceil(size / 4));
  for (let by = 0; by < bw; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const px = bc7Block(buf, at + (by * bw + bx) * 16);
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 4; x++) {
          const X = bx * 4 + x, Y = by * 4 + y;
          if (X < size && Y < size) { out.set(px.subarray((y * 4 + x) * 4, (y * 4 + x) * 4 + 4), (Y * size + X) * 4); }
        }
      }
    }
  }
  return out;
}

// ------------------------------------------------------------ the meshes --
const LOGO = path.join(MENU, 'logo.nif');
const AE = path.join(MENU, 'logo01ae.nif');
yes('game\\menu\\logo.nif is there', fs.existsSync(LOGO));
yes('game\\menu\\logo01ae.nif is there (without it the vanilla Anniversary plate comes back)', fs.existsSync(AE));
if (!fs.existsSync(LOGO) || !fs.existsSync(AE)) { done(); return; }

const logo = readNif(LOGO);
const ae = readNif(AE);
for (const [name, nif] of [['logo.nif', logo], ['logo01ae.nif', ae]]) {
  yes(name + ' is a Skyrim SE nif (20.2.0.7, 12, 100)',
    nif.version === 0x14020007 && nif.user === 12 && nif.bsver === 100);
  yes(name + ' reads to its last byte (block sizes and footer add up)', nif.endsWhereItShould);
  yes(name + "'s root is a BSFadeNode", nif.root === 0 && nif.blocks[0].type === 'BSFadeNode');
}

const logoDrawn = drawn(logo);
const aeDrawn = drawn(ae);
const aeShapes = ae.blocks.filter(x => isShape(x.type)).length;
console.log('      shapes drawn: logo.nif ' + logoDrawn.length + ', logo01ae.nif ' + aeDrawn.length +
  ' (blocks: ' + logo.blocks.length + ' and ' + ae.blocks.length + ')');
yes('logo.nif draws one shape, at a scale above zero', logoDrawn.length === 1 && logoDrawn[0].scale > 0);
// Issue #2177: Thornswood's own plate, written by Build-Backdrop.py --logo.
// The replacer it replaced named its root CivilWarMap01, carried the author
// string npurkeypile and the stamp of SSE NIF Optimizer; none of that is in
// either mesh now, and both say Thornswood made them.
for (const [name, nif] of [['logo.nif', logo], ['logo01ae.nif', ae]]) {
  const text = nif.bytes.toString('latin1');
  yes(name + ' carries nothing of the old wallpaper replacer (CivilWarMap01, npurkeypile, NIF Optimizer)',
    !/CivilWarMap|npurkeypile|NIF Optimizer/i.test(text));
  yes(name + "'s export info names Thornswood", text.indexOf('\x0bThornswood\0') > 0);
}
// Issue #1158. The Anniversary menu reads the first child of logo01ae.nif's
// root as the logo's shape (vanilla: BSFadeNode 'Logo' over one BSTriShape,
// 'actualLogoMirrorLow'). With no child the game crashed at the main menu:
// MistMenu, "mov rbx, [rax]" with rax 0, on the root named CivilWarMap01.
// The root's only child when it is a BSTriShape, with its shader block.
function menuShape(nif) {
  const kids = children(nif, nif.blocks[0]);
  const child = kids.length === 1 ? nif.blocks[kids[0]] : null;
  if (!child || child.type !== 'BSTriShape') { return null; }
  return { child, shader: nif.blocks[nif.bytes.readInt32LE(avObject(nif.bytes, child.at).end + 16 + 4)] };
}
// The file #425 shipped: the same root with its children cut away.
function emptyRoot(nif) {
  const b = nif.bytes;
  const av = avObject(b, nif.blocks[0].at);
  const kids = b.readUInt32LE(av.end);
  const cut = Buffer.concat([b.subarray(0, av.end), Buffer.alloc(4), b.subarray(av.end + 4 + 4 * kids)]);
  cut.writeUInt32LE(nif.blocks[0].size - 4 * kids, nif.sizesAt);
  return cut;
}
const aeShape = menuShape(ae);
const aeChild = aeShape && aeShape.child;
yes("logo01ae.nif's root has exactly one child, a BSTriShape, the shape the Anniversary menu reads " +
  '(an empty root crashed the game at the main menu, #1158)', !!aeShape);
yes('that shape has a BSLightingShaderProperty, as the vanilla logo01ae.nif shape does',
  !!aeShape && !!aeShape.shader && aeShape.shader.type === 'BSLightingShaderProperty');
const empty = readNif(emptyRoot(ae));
yes('this check catches the empty root #425 shipped (it reads to its end and has no shape child)',
  empty.endsWhereItShould && children(empty, empty.blocks[0]).length === 0 && menuShape(empty) === null);
yes('that shape is flagged hidden (APP_CULLED), so the renderer skips it',
  !!aeChild && (avObject(ae.bytes, aeChild.at).flags & HIDDEN) === HIDDEN);
yes("and logo01ae.nif's root is at scale 0, so it is a point even if the flag is cleared",
  avObject(ae.bytes, ae.blocks[0].at).scale === 0);
yes('logo01ae.nif draws nothing', aeShapes === 1 && aeDrawn.length === 0);
yes('the menu has one plate to draw, not two', logoDrawn.length + aeDrawn.length === 1);

// ------------------------------------------------------------- the plate --
const build = fs.readFileSync(BUILD, 'utf8');
const num = re => { const m = build.match(re); return m ? Number(m[1]) : NaN; };
const ASPECT = num(/^ASPECT = ([0-9.]+)/m);
const ROWS = num(/^ROWS = ([0-9]+)/m);
const TEX = num(/^TEX = ([0-9]+)/m);

const plate = triShape(logo, logoDrawn[0].block);
yes('the plate is textured with textures\\interface\\objects\\MAINMENUWALLPAPER.dds',
  /^textures\\interface\\objects\\mainmenuwallpaper\.dds$/i.test(plate.texture || ''));
const V = plate.verts;
const span = k => [Math.min(...V.map(p => p[k])), Math.max(...V.map(p => p[k]))];
const [x0, x1] = span('x'), [y0, y1] = span('y'), [u0, u1] = span('u'), [v0, v1] = span('v');
// Local x is the plate's width and local y its height; the shape's rotation
// carries the scale of each (column lengths of R), and its scale and the
// root's multiply both alike.
const R = plate.av.R;
const colX = Math.hypot(R[0], R[3], R[6]);
const colY = Math.hypot(R[1], R[4], R[7]);
const aspect = ((x1 - x0) * colX) / ((y1 - y0) * colY);
console.log('      plate as drawn: ' + ((x1 - x0) * colX).toFixed(4) + ' x ' + ((y1 - y0) * colY).toFixed(4) +
  ', aspect ' + aspect.toFixed(10) + '; Build-Backdrop.py ASPECT ' + ASPECT);
yes('the plate as drawn is Build-Backdrop.py\'s ASPECT (to 1e-6)', Math.abs(aspect - ASPECT) < 1e-6);
yes('the plate is not 3:2 (the old guess) and is 77:52 to 0.001 percent',
  Math.abs(aspect - 1.5) > 0.01 && Math.abs(aspect / (77 / 52) - 1) < 1e-5);
console.log('      UV: U ' + u0 + ' to ' + u1 + ', V ' + v0 + ' to ' + v1 + ' (row ' + (v1 * TEX) + ' of ' + TEX + ')');
yes('V reaches texel row 3004, so the picture fills ROWS = 3005 rows', v1 * TEX === 3004 && ROWS === 3005);
yes('U covers the whole texture width (within 3 texels at each edge)', u0 * TEX < 3 && (1 - u1) * TEX < 3);
// Flat, straight mapping: U follows x and V follows y linearly, to within the
// half-float the UVs are stored in (2 texels at 4096).
let worst = 0;
for (const p of V) {
  const du = u0 + (p.x - x0) / (x1 - x0) * (u1 - u0) - p.u;
  const dv = v0 + (y1 - p.y) / (y1 - y0) * (v1 - v0) - p.v;
  worst = Math.max(worst, Math.abs(du) * TEX, Math.abs(dv) * TEX);
}
console.log('      worst UV departure from a flat mapping: ' + worst.toFixed(3) + ' texels over ' + V.length + ' vertices');
yes('the UVs map the plate flat and straight (every vertex within 2 texels)', worst <= 2);
const [z0, z1] = span('z');
yes('the plate is flat: every corner at one depth (' + V.length + ' vertices, z ' + z0 + ' to ' + z1 + ')', z0 === z1);

// ----------------------------------------------------------- the texture --
const DDS = path.join(MENU, 'Mainmenuwallpaper.dds');
yes('game\\menu\\Mainmenuwallpaper.dds is there', fs.existsSync(DDS));
if (!fs.existsSync(DDS)) { done(); return; }
const d = fs.readFileSync(DDS);
const h = d.readUInt32LE(12), w = d.readUInt32LE(16), mips = d.readUInt32LE(28);
const fourcc = d.toString('latin1', 84, 88);
const caps = d.readUInt32LE(108);
const DXGI = { 98: 'BC7_UNORM', 99: 'BC7_UNORM_SRGB', 71: 'BC1_UNORM' };
let format = fourcc, blockBytes = fourcc === 'DXT1' ? 8 : 16, start = 128, dim = 0, arraySize = 0;
if (fourcc === 'DX10') {
  const dxgi = d.readUInt32LE(128);
  format = DXGI[dxgi] || ('DXGI ' + dxgi);
  dim = d.readUInt32LE(132); arraySize = d.readUInt32LE(140);
  start = 148;
}
console.log('      texture: ' + w + ' x ' + h + ', ' + mips + ' mip levels, ' + format + ', ' + d.length + ' bytes');
yes('it is a DDS file', d.toString('latin1', 0, 4) === 'DDS ');
yes('it is 4096 x 4096 (TEX in Build-Backdrop.py)', w === 4096 && h === 4096 && TEX === 4096);
yes('it has the full chain: 13 mip levels', mips === 13 && mips === Math.log2(w) + 1);
yes('its header says so (DDSCAPS_MIPMAP and DDSCAPS_COMPLEX)', (caps & 0x400000) !== 0 && (caps & 0x8) !== 0);
yes('it is BC7_UNORM (DXGI 98 behind a DX10 header), not DXT1, which bands the sky', format === 'BC7_UNORM');
yes('not BC7_UNORM_SRGB, which Skyrim would draw darker than it was built', format !== 'BC7_UNORM_SRGB');
yes('its DX10 header is one plain 2D texture (dimension 3, array size 1)', dim === 3 && arraySize === 1);
yes("Build-Backdrop.py asks texconv for the same format", /^FORMAT = "BC7_UNORM"/m.test(build));
let expect = start;
for (let i = 0, s = w; i < mips; i++, s = Math.max(1, s >> 1)) { expect += Math.pow(Math.ceil(s / 4), 2) * blockBytes; }
yes('its size is exactly the header plus 13 levels (' + expect + ' bytes)', d.length === expect);
yes('4096 texels over 20/21 of the screen width is at least one per pixel at 3840 wide (4K)',
  w * 20 / 21 >= 3840);

// Rows ROWS-1 .. 4095 are the last picture row repeated. In block rows that
// is every block row from (ROWS-1)/4 down identical, column by column, and
// not black.
const bpr = w / 4;
const firstRepeat = Math.floor((ROWS - 1) / 4);
let same = true;
for (let br = firstRepeat; br < h / 4 && same; br++) {
  for (let bc = 0; bc < bpr; bc++) {
    const a = start + (firstRepeat * bpr + bc) * blockBytes;
    const bb = start + (br * bpr + bc) * blockBytes;
    if (d.compare(d, a, a + blockBytes, bb, bb + blockBytes) !== 0) { same = false; break; }
  }
}
yes('below the picture, rows 3004 to 4095 repeat the last picture row', same);

// The pixels, read back. Level 0 whole, and the 1 x 1 level at the end.
const bright = (px, i) => px[i] + px[i + 1] + px[i + 2];
if (format === 'BC7_UNORM' && d.length === expect) {
  const top = bc7Level(d, start, w);
  let lowAlpha = 0;
  for (let i = 3; i < top.length; i += 4) { if (top[i] <= 188) { lowAlpha++; } }
  yes('every texel of the top level has alpha above 188, so the plate\'s alpha test drops none (' + lowAlpha + ' do not)',
    lowAlpha === 0);
  // The picture's own shadows are black in places (50 texels of this row; the
  // DXT1 build had 183), so the test is that the row is picture, not padding.
  let dark = 0, sum = 0;
  for (let x = 0; x < w; x++) {
    const v = bright(top, ((ROWS - 1) * w + x) * 4);
    if (v === 0) { dark++; }
    sum += v / 3;
  }
  console.log('      last picture row: ' + dark + ' black texels of ' + w + ', mean level ' + (sum / w).toFixed(1));
  yes('the last picture row, repeated below it, is picture and not black padding (under a tenth black)',
    dark < w / 10 && sum / w > 8);
  const last = bc7Level(d, d.length - 16, 1);
  console.log('      1 x 1 level: ' + Array.from(last.subarray(0, 3)).join(', '));
  yes('the smallest mip level, the average of the whole picture, is not black', bright(last, 0) > 0);
  // Banding in the sky. BACKDROP-SPEC.md decoded the DXT1 build along y = 60:
  // the blue channel held one value for 204 texels running. Every run here is
  // counted in the middle of the row, away from the edges.
  const Y = 60;
  let run = 1, longest = 0, values = new Set();
  for (let x = 256; x < w - 256; x++) {
    const b0 = top[(Y * w + x) * 4 + 2], b1 = top[(Y * w + x - 1) * 4 + 2];
    values.add(b0);
    run = (b0 === b1) ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  console.log('      sky at y = 60: longest flat run of blue ' + longest + ' texels, ' + values.size + ' blue values');
  yes('the sky at y = 60 has no flat band of 64 texels or more (DXT1: 204)', longest < 64);
} else {
  yes('the pixels can be read back (a BC7_UNORM file of the right size)', false);
}

// -------------------------------------------------------- the build script --
const art = path.join(REPO, 'launcher', 'art', 'thornswood-mainmenu-1535.png');
yes("Build-Backdrop.py's default picture is launcher\\art\\thornswood-mainmenu-1535.png",
  /DEFAULT_SRC = REPO \/ "launcher" \/ "art" \/ "thornswood-mainmenu-1535\.png"/.test(build) && fs.existsSync(art));
yes("Build-Backdrop.py writes into game\\menu by default",
  /^MENU = REPO \/ "game" \/ "menu"$/m.test(build) && /^DEFAULT_OUT = MENU \/ "Mainmenuwallpaper\.dds"$/m.test(build) &&
  /^REPO = HERE\.parent\.parent$/m.test(build));
if (fs.existsSync(art)) {
  const png = fs.readFileSync(art);
  const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
  console.log('INFO  the source picture is ' + pw + ' x ' + ph + ', against the 4466 x 3016 the spec asks for (' +
    (4466 * 3016 / (pw * ph)).toFixed(1) + ' times the pixels): the menu stays soft until the artist\'s render is built');
}

const py = spawnSync('python', ['--version'], { encoding: 'utf8' });
if (py.error || py.status !== 0) {
  console.log('SKIP  --logo and --blank-logo reproduce logo.nif and logo01ae.nif (no python here)');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backdrop-'));
  const plateOut = path.join(tmp, 'logo.nif');
  const p = spawnSync('python', [BUILD, '--logo', plateOut], { encoding: 'utf8' });
  const built = fs.existsSync(plateOut) ? fs.readFileSync(plateOut) : null;
  yes('Build-Backdrop.py --logo reproduces game\\menu\\logo.nif byte for byte (#2177)',
    p.status === 0 && built && built.equals(logo.bytes));
  const out = path.join(tmp, 'logo01ae.nif');
  const r = spawnSync('python', [BUILD, '--blank-logo', out], { encoding: 'utf8' });
  const made = fs.existsSync(out) ? fs.readFileSync(out) : null;
  yes('Build-Backdrop.py --blank-logo reproduces game\\menu\\logo01ae.nif byte for byte',
    r.status === 0 && made && made.equals(ae.bytes));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// texconv: one release, by sha256, kept out of git, and in THIRD-PARTY.md.
const tcUrl = (build.match(/^TEXCONV_URL = "([^"]+)"/m) || [])[1] || '';
const tcSha = (build.match(/^TEXCONV_SHA256 = "([0-9a-f]{64})"/m) || [])[1] || '';
const tcRelease = (tcUrl.match(/^https:\/\/github\.com\/microsoft\/DirectXTex\/releases\/download\/([^/]+)\/texconv\.exe$/) || [])[1];
yes('Build-Backdrop.py fetches texconv from one DirectXTex release (' + tcRelease + ')', !!tcRelease);
yes('and runs it only when its sha256 is the pinned one', tcSha.length === 64 &&
  /sha256\(TEXCONV\) == TEXCONV_SHA256/.test(build) && /got != TEXCONV_SHA256/.test(build));
yes('it keeps texconv under local\\, which git ignores',
  /^TEXCONV = REPO \/ "local" \//m.test(build) && /^\/local\/$/m.test(fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8')));
yes('it runs texconv on the processor (-nogpu), so every machine builds the same bytes', /"-nogpu"/.test(build));
const notices = fs.readFileSync(path.join(REPO, 'THIRD-PARTY.md'), 'utf8');
const tcSection = (/\n## [^\n]*texconv[^\n]*\n([\s\S]*?)(\n## |$)/.exec(notices) || [])[1] || '';
yes('THIRD-PARTY.md has a section on texconv', tcSection.length > 0);
yes('it gives the same release, sha256 and download as Build-Backdrop.py',
  tcSection.indexOf(tcSha) >= 0 && tcSection.indexOf(tcUrl) >= 0 && tcSection.indexOf(tcRelease) >= 0);
yes('it gives the MIT licence', /\bMIT\b/.test(tcSection));

if (process.env.THORNSWOOD_REBUILD_BACKDROP !== '1') {
  console.log('SKIP  a rebuild from the picture matches game\\menu byte for byte (set THORNSWOOD_REBUILD_BACKDROP=1; about half an hour)');
} else if (py.error || py.status !== 0 || process.platform !== 'win32') {
  console.log('SKIP  a rebuild from the picture (needs python and Windows)');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'backdrop-'));
  const out = path.join(tmp, 'Mainmenuwallpaper.dds');
  const r = spawnSync('python', [BUILD, art, out], { encoding: 'utf8' });
  console.log((r.stdout || '') + (r.stderr || ''));
  const made = fs.existsSync(out) ? fs.readFileSync(out) : null;
  yes('Build-Backdrop.py rebuilds game\\menu\\Mainmenuwallpaper.dds from the picture byte for byte',
    r.status === 0 && made && made.equals(d));
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ------------------------------------------------------- Check-Backdrop.ps1 --
if (process.platform !== 'win32') {
  console.log('SKIP  Check-Backdrop.ps1 (Windows only)');
} else {
  const CHECK = path.join(REPO, 'scripts', 'dev', 'Check-Backdrop.ps1');
  const game = fs.mkdtempSync(path.join(os.tmpdir(), 'backdrop-game-'));
  const place = (rel, bytes) => {
    const p = path.join(game, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, bytes);
  };
  // Without PSModulePath, as test-download-hash.js does: Windows PowerShell
  // started under pwsh 7 inherits its module folders and loses Get-FileHash.
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) { if (k.toLowerCase() === 'psmodulepath') { delete env[k]; } }
  const run = () => {
    let r = null;
    for (const shell of ['pwsh', 'powershell']) {
      r = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', CHECK, '-Game', game],
        { encoding: 'utf8', env: env });
      if (!r.error) { break; }
    }
    if (r.status !== 0 && r.stderr) { console.log('      ' + r.stderr.trim().split('\n')[0]); }
    return r;
  };
  const TEXREL = 'Data\\textures\\interface\\objects\\Mainmenuwallpaper.dds';
  place('Data\\meshes\\interface\\logo\\logo.nif', logo.bytes);
  place('Data\\meshes\\interface\\logo\\logo01ae.nif', ae.bytes);
  place(TEXREL, d);
  let r = run();
  yes('Check-Backdrop.ps1 passes a game folder holding the repo\'s three files (exit ' + r.status + ')',
    r.status === 0 && /BC7_UNORM, mipmap flag set/.test(r.stdout));
  place('Data\\meshes\\interface\\logo\\logo01ae.nif', emptyRoot(ae));
  r = run();
  yes('it names an empty logo01ae.nif root as the main menu crash (#1158)',
    r.status === 1 && /AN EMPTY ROOT: the Anniversary menu reads its first child/.test(r.stdout));
  place('Data\\meshes\\interface\\logo\\logo01ae.nif', logo.bytes);
  r = run();
  yes('it names a logo01ae.nif that draws the plate as a second plate',
    r.status === 1 && /A SECOND PLATE/.test(r.stdout));
  place('Data\\meshes\\interface\\logo\\logo01ae.nif', ae.bytes);
  const srgb = Buffer.from(d); srgb.writeUInt32LE(99, 128);
  place(TEXREL, srgb);
  r = run();
  yes('it names a BC7_UNORM_SRGB texture as wrong', r.status === 1 && /BC7_UNORM_SRGB: draws darker/.test(r.stdout));
  // The old build's shape: DXT1, 13 levels, 11,184,952 bytes.
  let dxtLen = 128;
  for (let s = 4096; s >= 1; s >>= 1) { dxtLen += Math.pow(Math.ceil(s / 4), 2) * 8; }
  const dxt = Buffer.alloc(dxtLen);
  d.copy(dxt, 0, 0, 128);
  dxt.write('DXT1', 84, 'latin1');
  place(TEXREL, dxt);
  r = run();
  yes('it names a DXT1 texture as the old build that bands (' + dxtLen + ' bytes)',
    r.status === 1 && /DXT1: the old build, the sky bands/.test(r.stdout) && !/BYTES, the levels need/.test(r.stdout));
  place(TEXREL, d.subarray(0, d.length - 16));
  r = run();
  yes('it names a texture cut short of its levels', r.status === 1 && /BYTES, the levels need/.test(r.stdout));
  fs.rmSync(game, { recursive: true, force: true });
}

// ------------------------------------------------------ Go.ps1, Ship-Rules --
const go = fs.readFileSync(path.join(REPO, 'scripts', 'release', 'Go.ps1'), 'utf8');
const rules = fs.readFileSync(path.join(REPO, 'scripts', 'release', 'Ship-Rules.ps1'), 'utf8');
const three = ['Data\\meshes\\interface\\logo\\logo.nif', 'Data\\meshes\\interface\\logo\\logo01ae.nif',
  'Data\\textures\\interface\\objects\\Mainmenuwallpaper.dds'];
for (const rel of three) {
  const leaf = rel.split('\\').pop();
  yes('Go.ps1 copies game\\menu\\' + leaf + ' to ' + rel, go.includes("'" + leaf + "'") && go.includes("'" + rel + "'"));
  yes('Ship-Rules.ps1 counts ' + rel + ' as ours', rules.includes("'" + rel + "'"));
}

done();
