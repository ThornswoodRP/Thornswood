/*
  Taking where and when a picture or recording was made out of it (#3648),
  for every upload and for node server.js --strip-metadata. It needs nothing
  but Node, so the strip runs without starting the site.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { exifTags, mediaSignature, stripFolder, stripMedia };

const fs     = require('fs');
const path   = require('path');

/* One place that takes a file off a request and lands it in uploads/ under a
   stamped name, so /api/upload and /api/gallery/submit stamp and cap the same
   way and a change to either is a change to both. The request body IS the file,
   the way /api/upload has always worked, so the name and any note ride in the
   query. asked is the name the caller offered; cap is the byte ceiling; allow
   is null for any kind or a list of lower case extensions (with the dot) when a
   route only wants some. It answers 413 or 415 itself and returns; on a good
   file it calls saved(name) and leaves the reply to the route, because /upload
   and /gallery/submit write different things once the bytes are down. A
   smaller copy of a gallery picture (copy true, #3218) counts its bytes
   against the hour and not its file, so sending a picture and its two
   copies is one of the 40 files an hour, as the picture alone was. */
// ==== thornswood upload guard ====
const uploadBudgets = new Map();
function mediaSignature(ext, bytes) {
  if (ext === '.png') return bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'));
  if (ext === '.jpg' || ext === '.jpeg') return bytes.subarray(0,3).equals(Buffer.from('ffd8ff','hex'));
  if (ext === '.gif') return /^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii'));
  if (ext === '.webp') return bytes.subarray(0,4).toString('ascii') === 'RIFF' && bytes.subarray(8,12).toString('ascii') === 'WEBP';
  if (ext === '.mp4') return bytes.subarray(4,8).toString('ascii') === 'ftyp';
  if (ext === '.webm') return bytes.subarray(0,4).equals(Buffer.from('1a45dfa3','hex'));
  return false;
}
/*
  WHAT A FILE SAYS ABOUT WHERE IT WAS MADE (#3648). A phone or a camera
  writes into a picture or a recording where and when it was made and with
  what, often with the GPS position, and the gallery kept that file byte for
  byte and served it to anyone at /shot/<name>. Now every picture and
  recording has those blocks taken out as it lands in uploads/, before staff
  or anybody else can fetch it, and the launcher takes them out before it
  sends (Gallery.Submit). Node reads and writes no pictures, so nothing is
  decoded or encoded again: the file's blocks are walked and the ones that
  only describe it are left out, and every pixel and frame is the sender's.

    JPEG  every APP1 (Exif, XMP), APP3 to APP13 (IPTC, Photoshop, makers'
          blocks), APP15 and comment; APP2 unless it is the colour profile;
          and anything after the end of the picture, where a phone hangs a
          second picture with an Exif of its own.
    PNG   eXIf, tEXt, zTXt, iTXt, tIME and caBX (content credentials), and
          anything after IEND.
    WebP  EXIF and XMP, and the VP8X flags that name them.
    GIF   comments, and application blocks other than looping and colour.
    MP4   udta, meta and XMP uuid boxes become free space of the same size,
          so no offset into the file moves, and the made and changed times
          in mvhd, tkhd and mdhd are zeroed.
    WebM  Tags become Void of the same size, and DateUTC in Info is zeroed.

  Kept: the colour profile and the orientation. A camera picture that is
  turned gets a new Exif block saying only that, so it still shows the right
  way up and pictureSize still reads it turned.

  stripMedia answers { ok: true, changed, gps, removed } or { ok: false,
  why }. changed is false for a file that had nothing to take out, which is
  then not written at all. A file whose blocks cannot be walked is not ok,
  and receiveUpload refuses it rather than keep it as it came. The launcher's
  copy of these rules is launcher/app/MediaStrip.cs; a change here is a
  change there.

  node server.js --strip-metadata <folder> runs it over a folder (the one-off
  for uploads/ already on the box, scripts/vps/Strip-Uploads.ps1).
*/
function stripMedia(file) {
  const strip = {
    '.jpg': stripJpeg, '.jpeg': stripJpeg, '.png': stripPng, '.webp': stripWebp,
    '.gif': stripGif, '.mp4': stripMp4, '.webm': stripWebm
  }[path.extname(String(file)).toLowerCase()];
  if (!strip) return { ok: true, changed: false, gps: false, removed: [] };
  let b;
  try { b = fs.readFileSync(file); }
  catch (e) { return { ok: false, why: 'could not be read (' + (e.code || e.message) + ')' }; }
  const said = { changed: false, gps: false, removed: [] };
  let out;
  try { out = strip(b, said); }
  catch (e) { out = null; }
  if (!out) return { ok: false, why: 'its blocks could not be walked' };
  if (!said.changed) return { ok: true, changed: false, gps: said.gps, removed: [] };
  const temp = file + '.strip';
  try {
    fs.writeFileSync(temp, out, { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (e) {
    try { fs.unlinkSync(temp); } catch (e2) { /* never made, or already renamed */ }
    return { ok: false, why: 'could not be written back (' + (e.code || e.message) + ')' };
  }
  return { ok: true, changed: true, gps: said.gps, removed: said.removed };
}

// Orientation (0x0112) and whether there is a GPS block (0x8825) in the first
// IFD of the Exif TIFF at start to end. turn is 0 when it does not say.
function exifTags(b, start, end) {
  const got = { turn: 0, gps: false };
  if (start < 0 || start + 8 > end || end > b.length) return got;
  const order = b.subarray(start, start + 2).toString('latin1');
  if (order !== 'II' && order !== 'MM') return got;
  const u16 = (at) => (order === 'II' ? b.readUInt16LE(at) : b.readUInt16BE(at));
  const u32 = (at) => (order === 'II' ? b.readUInt32LE(at) : b.readUInt32BE(at));
  const ifd = start + u32(start + 4);
  if (ifd + 2 > end) return got;
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const at = ifd + 2 + k * 12;
    if (at + 12 > end) break;
    const tag = u16(at);
    if (tag === 0x0112) got.turn = u16(at + 8);
    if (tag === 0x8825) got.gps = true;
  }
  return got;
}
// The Exif TIFF kept for a turned picture: one tag, its orientation.
function exifOnlyTurn(turn) {
  const t = Buffer.alloc(26);
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  t.writeUInt16BE(1, 8);
  t.writeUInt16BE(0x0112, 10); t.writeUInt16BE(3, 12); t.writeUInt32BE(1, 14); t.writeUInt16BE(turn, 18);
  return t;
}
function keepTurn(turn) { return turn >= 2 && turn <= 8; }
// XMP and text blocks are only looked at to count positions, never kept.
// The copyright sign then xyz is the box a phone writes its position into in a recording.
function saysWhere(bytes) { return /GPS|ISO6709|\u00a9xyz|loci|location/i.test(bytes.toString('latin1')); }

function stripJpeg(b, said) {
  if (b.length < 2 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  const out = [b.subarray(0, 2)];
  let i = 2, turn = 0, exifAt = -1;
  while (i < b.length) {
    if (b[i] !== 0xff) return null;
    if (i + 1 >= b.length) { out.push(b.subarray(i)); break; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9) {
      out.push(b.subarray(i, i + 2));
      if (i + 2 < b.length) said.removed.push('data after the picture');
      break;
    }
    if (m === 0x01 || m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) { out.push(b.subarray(i, i + 2)); i += 2; continue; }
    if (i + 4 > b.length) { out.push(b.subarray(i)); break; }
    const end = i + 2 + b.readUInt16BE(i + 2);
    const seg = b.subarray(i, Math.min(end, b.length));
    const body = seg.subarray(4);
    let drop = '';
    if (m === 0xe1 && body.subarray(0, 6).toString('latin1') === 'Exif\0\0') {
      const t = exifTags(body, 6, body.length);
      if (t.gps) said.gps = true;
      if (!turn) turn = t.turn;
      if (exifAt < 0) exifAt = out.length;
      drop = 'Exif';
    } else if (m === 0xe1) {
      if (saysWhere(body)) said.gps = true;
      drop = 'XMP';
    } else if (m === 0xe2 && body.subarray(0, 12).toString('latin1') !== 'ICC_PROFILE\0') drop = 'APP2';
    else if ((m >= 0xe3 && m <= 0xed) || m === 0xef) drop = 'APP' + (m - 0xe0);
    else if (m === 0xfe) drop = 'comment';
    if (drop) said.removed.push(drop); else out.push(seg);
    i = end;
    if (m === 0xda && end <= b.length) {
      // The scan: entropy-coded bytes up to the next marker that is not a
      // stuffed zero, a restart or a fill byte.
      let j = end;
      while (j < b.length) {
        if (b[j] === 0xff && j + 1 < b.length) {
          const n = b[j + 1];
          if (n !== 0x00 && n !== 0xff && !(n >= 0xd0 && n <= 0xd7)) break;
        }
        j++;
      }
      out.push(b.subarray(end, j));
      i = j;
    }
  }
  if (keepTurn(turn)) {
    const tiff = exifOnlyTurn(turn);
    const head = Buffer.alloc(10);
    head[0] = 0xff; head[1] = 0xe1; head.writeUInt16BE(2 + 6 + tiff.length, 2); head.write('Exif\0\0', 4, 'latin1');
    out.splice(exifAt, 0, head, tiff);
  }
  const buf = Buffer.concat(out);
  said.changed = !buf.equals(b);
  return buf;
}

function crc32(buf) {
  let c = ~0;
  for (let k = 0; k < buf.length; k++) {
    c ^= buf[k];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function stripPng(b, said) {
  if (b.length < 8) return null;
  const out = [b.subarray(0, 8)];
  let i = 8, turn = 0, exifAt = -1;
  while (i < b.length) {
    if (i + 8 > b.length) { out.push(b.subarray(i)); break; }
    const len = b.readUInt32BE(i), type = b.subarray(i + 4, i + 8).toString('latin1');
    if (len > 0x7fffffff) return null;
    const end = i + 12 + len;
    const chunk = b.subarray(i, Math.min(end, b.length));
    if (type === 'eXIf') {
      const t = exifTags(b, i + 8, Math.min(i + 8 + len, b.length));
      if (t.gps) said.gps = true;
      if (!turn) turn = t.turn;
      if (exifAt < 0) exifAt = out.length;
      said.removed.push('eXIf');
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt' || type === 'tIME' || type === 'caBX') {
      if (saysWhere(chunk)) said.gps = true;
      said.removed.push(type);
    } else out.push(chunk);
    i = end;
    if (type === 'IEND') {
      if (i < b.length) said.removed.push('data after the picture');
      break;
    }
  }
  if (keepTurn(turn)) {
    const tiff = exifOnlyTurn(turn);
    const chunk = Buffer.alloc(12 + tiff.length);
    chunk.writeUInt32BE(tiff.length, 0); chunk.write('eXIf', 4, 'latin1'); tiff.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + tiff.length)), 8 + tiff.length);
    out.splice(exifAt, 0, chunk);
  }
  const buf = Buffer.concat(out);
  said.changed = !buf.equals(b);
  return buf;
}

function stripWebp(b, said) {
  if (b.length < 12) return null;
  const out = [Buffer.from(b.subarray(0, 12))];
  let i = 12, turn = 0, exifAt = -1, vp8x = -1;
  while (i < b.length) {
    if (i + 8 > b.length) { out.push(b.subarray(i)); break; }
    const tag = b.subarray(i, i + 4).toString('latin1'), len = b.readUInt32LE(i + 4);
    const end = i + 8 + len + (len & 1);
    const chunk = b.subarray(i, Math.min(end, b.length));
    if (tag === 'EXIF') {
      const data = b.subarray(i + 8, Math.min(i + 8 + len, b.length));
      const at = data.subarray(0, 6).toString('latin1') === 'Exif\0\0' ? 6 : 0;
      const t = exifTags(data, at, data.length);
      if (t.gps) said.gps = true;
      if (!turn) turn = t.turn;
      if (exifAt < 0) exifAt = out.length;
      said.removed.push('EXIF');
    } else if (tag === 'XMP ') {
      if (saysWhere(chunk)) said.gps = true;
      said.removed.push('XMP');
    } else {
      if (tag === 'VP8X' && vp8x < 0 && chunk.length >= 9) { vp8x = out.length; out.push(Buffer.from(chunk)); }
      else out.push(chunk);
    }
    i = end;
  }
  if (!said.removed.length) return b;
  if (vp8x >= 0) {
    out[vp8x][8] &= ~0x0c;
    if (keepTurn(turn)) {
      const tiff = exifOnlyTurn(turn);
      const chunk = Buffer.alloc(8 + tiff.length);
      chunk.write('EXIF', 0, 'latin1'); chunk.writeUInt32LE(tiff.length, 4); tiff.copy(chunk, 8);
      out[vp8x][8] |= 0x08;
      out.splice(exifAt, 0, chunk);
    }
  }
  const buf = Buffer.concat(out);
  buf.writeUInt32LE(buf.length - 8, 4);
  said.changed = !buf.equals(b);
  return buf;
}

function stripGif(b, said) {
  if (b.length < 13) return null;
  // Sub-blocks from j: the end, past the empty one that closes them.
  const blocks = (j) => {
    while (j < b.length) { const n = b[j]; j += 1 + n; if (n === 0) break; }
    return j;
  };
  let i = 13;
  if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
  const out = [b.subarray(0, Math.min(i, b.length))];
  while (i < b.length) {
    const kind = b[i];
    if (kind === 0x3b) {
      out.push(b.subarray(i, i + 1));
      if (i + 1 < b.length) said.removed.push('data after the picture');
      break;
    }
    if (kind === 0x21) {
      const label = b[i + 1];
      const end = blocks(i + 2);
      const part = b.subarray(i, Math.min(end, b.length));
      let drop = '';
      if (label === 0xfe) drop = 'comment';
      else if (label === 0xff) {
        const app = b.subarray(i + 3, i + 14).toString('latin1');
        if (app !== 'NETSCAPE2.0' && app !== 'ANIMEXTS1.0' && app !== 'ICCRGBG1012') drop = app.trim() || 'application block';
      }
      if (drop) {
        if (saysWhere(part)) said.gps = true;
        said.removed.push(drop);
      } else out.push(part);
      i = end;
      continue;
    }
    if (kind === 0x2c) {
      let j = i + 10;
      if (b[i + 9] & 0x80) j += 3 * (1 << ((b[i + 9] & 7) + 1));
      const end = blocks(j + 1);
      out.push(b.subarray(i, Math.min(end, b.length)));
      i = end;
      continue;
    }
    return null;
  }
  const buf = Buffer.concat(out);
  said.changed = !buf.equals(b);
  return buf;
}

// Box by box from from to to; each(type, at, head, end). False when a size
// cannot be a box's.
function mp4Boxes(b, from, to, each) {
  let i = from;
  while (i + 8 <= to) {
    let size = b.readUInt32BE(i), head = 8;
    const type = b.subarray(i + 4, i + 8).toString('latin1');
    if (size === 1) {
      if (i + 16 > to) return true;
      size = Number(b.readBigUInt64BE(i + 8));
      head = 16;
    } else if (size === 0) size = to - i;
    if (size < head) return false;
    each(type, i, head, Math.min(i + size, to));
    i += size;
  }
  return true;
}
function stripMp4(b, said) {
  const XMP = 'be7acfcb97a942e89c71999491e3afac';
  const free = (type, at, head, end) => {
    const body = b.subarray(at + head, end);
    if (saysWhere(body)) said.gps = true;
    said.removed.push(type);
    b.write('free', at + 4, 'latin1');
    body.fill(0);
    said.changed = true;
  };
  const describes = (type, at, head, end) => type === 'udta' || type === 'meta' ||
    (type === 'uuid' && end - at >= head + 16 && b.subarray(at + head, at + head + 16).toString('hex') === XMP);
  // The made and changed times of a full box: four bytes each in version 0,
  // eight in version 1, after the version and flags.
  const times = (at, head, end) => {
    const wide = b[at + head] === 1 ? 8 : 4;
    const from = at + head + 4, to = from + 2 * wide;
    if (to > end) return;
    if (!b.subarray(from, to).some((x) => x !== 0)) return;
    b.fill(0, from, to);
    said.changed = true;
    if (said.removed.indexOf('times') < 0) said.removed.push('times');
  };
  let good = true;
  const walk = (from, to, inside) => mp4Boxes(b, from, to, (type, at, head, end) => {
    if (describes(type, at, head, end)) return free(type, at, head, end);
    if (inside === 'moov' && type === 'mvhd') return times(at, head, end);
    if (inside === 'trak' && type === 'tkhd') return times(at, head, end);
    if (inside === 'mdia' && type === 'mdhd') return times(at, head, end);
    if (type === 'moov' || type === 'trak' || type === 'mdia') {
      if (!walk(at + head, end, type)) good = false;
    }
  });
  if (!walk(0, b.length, '') || !good) return null;
  return b;
}

function stripWebm(b, said) {
  const SEGMENT = 0x18538067, TAGS = 0x1254c367, INFO = 0x1549a966, DATE = 0x4461, CLUSTER = 0x1f43b675;
  const TOP = [0x114d9b74, INFO, CLUSTER, 0x1654ae6b, 0x1c53bb6b, 0x1941a469, 0x1043a770, TAGS, SEGMENT, 0x1a45dfa3];
  // An element's id and size at i: null when the bytes cannot be one, and
  // short when the file ends inside its head.
  const head = (i) => {
    if (i >= b.length) return { short: true };
    const f = b[i];
    const iw = f & 0x80 ? 1 : f & 0x40 ? 2 : f & 0x20 ? 3 : f & 0x10 ? 4 : 0;
    if (!iw) return null;
    if (i + iw >= b.length) return { short: true };
    const s = b[i + iw];
    let sw = 1;
    while (sw <= 8 && !(s & (0x80 >> (sw - 1)))) sw++;
    if (sw > 8) return null;
    if (i + iw + sw > b.length) return { short: true };
    let v = s & (0xff >> sw), all = v === (0xff >> sw);
    for (let k = 1; k < sw; k++) { v = v * 256 + b[i + iw + k]; if (b[i + iw + k] !== 0xff) all = false; }
    return { id: b.readUIntBE(i, iw), data: i + iw + sw, size: all ? -1 : v };
  };
  // An element at at to end made into a Void of the same length.
  const voidOut = (at, end) => {
    const total = end - at, w = Math.min(8, total - 1);
    let v = total - 1 - w;
    b.fill(0, at, end);
    b[at] = 0xec;
    for (let k = w - 1; k >= 1; k--) { b[at + 1 + k] = v % 256; v = Math.floor(v / 256); }
    b[at + 1] = (0x80 >> (w - 1)) | v;
    said.changed = true;
  };
  let i = 0;
  while (i < b.length) {
    const top = head(i);
    if (!top) return null;
    if (top.short) break;
    const end = top.size < 0 ? b.length : Math.min(top.data + top.size, b.length);
    if (top.id !== SEGMENT) { i = end; continue; }
    let j = top.data;
    while (j < end) {
      const el = head(j);
      if (!el) return null;
      if (el.short) break;
      if (el.size < 0) {
        // A cluster a recorder wrote with no size: it ends where an element
        // that only sits at the top of a segment starts.
        let k = el.data;
        for (;;) {
          const c = head(k);
          if (!c) return null;
          if (c.short || TOP.indexOf(c.id) >= 0) break;
          if (c.size < 0) return null;
          k = Math.min(c.data + c.size, end);
          if (k >= end) break;
        }
        j = k;
        continue;
      }
      const stop = Math.min(el.data + el.size, end);
      if (el.id === TAGS) {
        if (saysWhere(b.subarray(el.data, stop))) said.gps = true;
        said.removed.push('Tags');
        voidOut(j, stop);
      } else if (el.id === INFO) {
        let k = el.data;
        while (k < stop) {
          const c = head(k);
          if (!c || c.short || c.size < 0) break;
          const cend = Math.min(c.data + c.size, stop);
          if (c.id === DATE && b.subarray(c.data, cend).some((x) => x !== 0)) {
            b.fill(0, c.data, cend);
            said.changed = true;
            said.removed.push('DateUTC');
          }
          k = cend;
        }
      }
      j = stop;
    }
    i = end;
  }
  return b;
}

// node server.js --strip-metadata <folder>: stripMedia over every file in the
// folder and the folders in it. Prints one line for each file it changed or
// could not walk, names and block names only, never what a block said, then
// the counts. 0 when every file is clean now, 1 when one is not.
function stripFolder(folder) {
  const seen = { looked: 0, changed: 0, gps: 0, failed: 0 };
  const visit = (dir) => {
    let names;
    try { names = fs.readdirSync(dir); }
    catch (e) { console.error('could not list ' + dir + ' (' + (e.code || e.message) + ')'); seen.failed++; return; }
    for (const name of names) {
      const file = path.join(dir, name);
      let st;
      try { st = fs.statSync(file); } catch (e) { continue; }
      if (st.isDirectory()) { visit(file); continue; }
      seen.looked++;
      const r = stripMedia(file);
      const shown = path.relative(folder, file);
      if (!r.ok) { seen.failed++; console.log('NOT CLEANED  ' + shown + ': ' + r.why); continue; }
      if (r.gps) seen.gps++;
      if (r.changed) {
        seen.changed++;
        console.log('cleaned  ' + shown + ': ' + Array.from(new Set(r.removed)).join(', ') + (r.gps ? ' (it held a position)' : ''));
      }
    }
  };
  if (!folder) { console.error('say which folder: node server.js --strip-metadata <folder>'); return 2; }
  visit(path.resolve(folder));
  console.log(seen.looked + ' files looked at, ' + seen.changed + ' had blocks taken out, ' +
              seen.gps + ' held a position, ' + seen.failed + ' could not be cleaned');
  return seen.failed ? 1 : 0;
}

Object.assign(module.exports, { uploadBudgets });
