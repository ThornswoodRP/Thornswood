'use strict';
/*
  media-3648.js

      node tests\fixtures\media-3648.js <folder>

  Pictures and recordings with what a phone or camera writes about where and
  when they were made (#3648), each beside the bytes the site's stripMedia
  and the launcher's MediaStrip must make of it. Built here, block by block,
  so no tool and no real photo is needed: the blocks that only describe the
  file are the ones a phone writes (Exif with a GPS block, XMP, IPTC, a
  comment, a second picture after the end, a recording's udta and Tags), and
  the rest stand in for the picture itself and must come out unchanged.

  require() it for { cases }: each is { name, ext, dirty, clean }, clean null
  for a file whose blocks cannot be walked. Run with a folder, it writes
  in\<name><ext> and out\<name><ext> there (no out file for a null), for
  tests\test-3648-launcher-strip.ps1.
*/
const fs = require('fs');
const path = require('path');

const cat = (...parts) => Buffer.concat(parts.map((p) => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
const latin = (s) => Buffer.from(s, 'latin1');
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

const XMP = latin('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description ' +
  'exif:GPSLatitude="40,44.2N" exif:GPSLongitude="73,59.0W" tiff:Model="Phone 9"/></rdf:RDF></x:xmpmeta>');

// An Exif TIFF (big-endian) as a phone writes one: the camera, the
// orientation, and a GPS block holding a latitude.
function exifTiff(turn) {
  const ifd0 = 8, gpsAt = ifd0 + 2 + 3 * 12 + 4;
  const t = Buffer.alloc(gpsAt + 2 + 12 + 4);
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(ifd0, 4);
  t.writeUInt16BE(3, ifd0);
  let at = ifd0 + 2;
  t.writeUInt16BE(0x010f, at); t.writeUInt16BE(2, at + 2); t.writeUInt32BE(4, at + 4); t.write('Cam\0', at + 8, 'latin1'); at += 12;
  t.writeUInt16BE(0x0112, at); t.writeUInt16BE(3, at + 2); t.writeUInt32BE(1, at + 4); t.writeUInt16BE(turn, at + 8); at += 12;
  t.writeUInt16BE(0x8825, at); t.writeUInt16BE(4, at + 2); t.writeUInt32BE(1, at + 4); t.writeUInt32BE(gpsAt, at + 8);
  t.writeUInt16BE(1, gpsAt);
  t.writeUInt16BE(0x0001, gpsAt + 2); t.writeUInt16BE(2, gpsAt + 4); t.writeUInt32BE(2, gpsAt + 6); t.write('N\0', gpsAt + 10, 'latin1');
  return t;
}
// The Exif TIFF the strip keeps: the orientation and nothing else.
function turnOnly(turn) {
  const t = Buffer.alloc(26);
  t.write('MM', 0, 'latin1'); t.writeUInt16BE(42, 2); t.writeUInt32BE(8, 4);
  t.writeUInt16BE(1, 8);
  t.writeUInt16BE(0x0112, 10); t.writeUInt16BE(3, 12); t.writeUInt32BE(1, 14); t.writeUInt16BE(turn, 18);
  return t;
}

// ---- JPEG ------------------------------------------------------------------
const seg = (marker, body) => cat(Buffer.from([0xff, marker]), u16(body.length + 2), body);
function jpeg() {
  const SOI = Buffer.from([0xff, 0xd8]), EOI = Buffer.from([0xff, 0xd9]);
  const app0 = seg(0xe0, cat(latin('JFIF\0'), Buffer.from([1, 2, 0, 0, 1, 0, 1, 0, 0])));
  const exif = seg(0xe1, cat(latin('Exif\0\0'), exifTiff(6)));
  const xmp = seg(0xe1, cat(latin('http://ns.adobe.com/xap/1.0/\0'), XMP));
  const icc = seg(0xe2, cat(latin('ICC_PROFILE\0'), Buffer.from([1, 1]), latin('a colour profile')));
  const mpf = seg(0xe2, cat(latin('MPF\0'), latin('II*\0 the second picture is after the end')));
  const iptc = seg(0xed, cat(latin('Photoshop 3.0\0'), latin('8BIM City=Whiterun')));
  const maker = seg(0xe5, latin('maker notes'));
  const com = seg(0xfe, latin('taken at home'));
  const dqt = seg(0xdb, Buffer.alloc(65, 3));
  const sof = Buffer.alloc(19);
  sof[0] = 0xff; sof[1] = 0xc0; sof.writeUInt16BE(17, 2); sof[4] = 8;
  sof.writeUInt16BE(48, 5); sof.writeUInt16BE(64, 7); sof[9] = 3;
  const sos = seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0]));
  // A scan with a stuffed zero and a restart in it, then a second scan the
  // way a progressive picture has, with a table between.
  const scan = Buffer.from([0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56, 0x78]);
  const dht = seg(0xc4, Buffer.alloc(20, 7));
  const scan2 = Buffer.from([0x9a, 0xbc, 0xff, 0x00]);
  const second = cat(SOI, seg(0xe1, cat(latin('Exif\0\0'), exifTiff(1))), EOI);
  const keptExif = seg(0xe1, cat(latin('Exif\0\0'), turnOnly(6)));
  return {
    dirty: cat(SOI, app0, exif, xmp, icc, mpf, iptc, maker, com, dqt, sof, sos, scan, dht, sos, scan2, EOI, second),
    clean: cat(SOI, app0, keptExif, icc, dqt, sof, sos, scan, dht, sos, scan2, EOI)
  };
}

// ---- PNG -------------------------------------------------------------------
function crc32(buf) {
  let c = ~0;
  for (let k = 0; k < buf.length; k++) {
    c ^= buf[k];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
const chunk = (type, body) => cat(u32(body.length), latin(type), body, u32(crc32(cat(latin(type), body))));
function png() {
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = cat(u32(64), u32(48), Buffer.from([8, 2, 0, 0, 0]));
  const head = chunk('IHDR', ihdr), iccp = chunk('iCCP', cat(latin('sRGB\0\0'), Buffer.alloc(12, 9)));
  const idat = chunk('IDAT', Buffer.from([0x78, 0x9c, 1, 2, 3, 4, 5])), end = chunk('IEND', Buffer.alloc(0));
  return {
    dirty: cat(sig, head, iccp, chunk('eXIf', exifTiff(6)), chunk('tEXt', latin('Comment\0taken at home')),
               chunk('iTXt', cat(latin('XML:com.adobe.xmp\0\0\0\0\0'), XMP)), chunk('tIME', Buffer.from([7, 234, 10, 1, 10, 0, 0])),
               chunk('pHYs', cat(u32(2835), u32(2835), Buffer.from([1]))), idat, end, latin('after the end')),
    clean: cat(sig, head, iccp, chunk('eXIf', turnOnly(6)), chunk('pHYs', cat(u32(2835), u32(2835), Buffer.from([1]))), idat, end)
  };
}

// ---- WebP ------------------------------------------------------------------
const riff = (tag, body) => cat(latin(tag), u32le(body.length), body, body.length & 1 ? Buffer.from([0]) : Buffer.alloc(0));
function webp() {
  const vp8x = (flags) => { const b = Buffer.alloc(10); b[0] = flags; b.writeUIntLE(63, 4, 3); b.writeUIntLE(47, 7, 3); return riff('VP8X', b); };
  const iccp = riff('ICCP', latin('a colour profile')), image = riff('VP8L', Buffer.from([0x2f, 1, 2, 3, 4, 5, 6]));
  const file = (...parts) => { const body = cat(latin('WEBP'), ...parts); return cat(latin('RIFF'), u32le(body.length), body); };
  return {
    dirty: file(vp8x(0x20 | 0x08 | 0x04), iccp, image, riff('EXIF', exifTiff(6)), riff('XMP ', XMP)),
    clean: file(vp8x(0x20 | 0x08), iccp, image, riff('EXIF', turnOnly(6)))
  };
}

// ---- GIF -------------------------------------------------------------------
function gif() {
  const head = cat(latin('GIF89a'), Buffer.from([64, 0, 48, 0, 0x80, 0, 0]), Buffer.from([0, 0, 0, 255, 255, 255]));
  const loop = cat(Buffer.from([0x21, 0xff, 11]), latin('NETSCAPE2.0'), Buffer.from([3, 1, 0, 0, 0]));
  const comment = cat(Buffer.from([0x21, 0xfe, 13]), latin('taken at home'), Buffer.from([0]));
  const xmp = cat(Buffer.from([0x21, 0xff, 11]), latin('XMP DataXMP'), Buffer.from([XMP.length]), XMP, Buffer.from([0]));
  const gce = Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0]);
  const frame = cat(Buffer.from([0x2c, 0, 0, 0, 0, 64, 0, 48, 0, 0]), Buffer.from([2, 3, 0x44, 0x01, 0x05, 0]));
  return {
    dirty: cat(head, loop, comment, xmp, gce, frame, gce, frame, Buffer.from([0x3b]), latin('after the end')),
    clean: cat(head, loop, gce, frame, gce, frame, Buffer.from([0x3b]))
  };
}

// ---- MP4 -------------------------------------------------------------------
const box = (type, ...body) => { const b = cat(...body); return cat(u32(8 + b.length), latin(type), b); };
const freed = (b) => { const out = Buffer.alloc(b.length); b.copy(out, 0, 0, 4); out.write('free', 4, 'latin1'); return out; };
function mp4() {
  const ftyp = box('ftyp', latin('isom'), u32(512), latin('isomiso2avc1mp41'));
  const full = (version, made, rest) => cat(Buffer.from([version, 0, 0, 0]), made, Buffer.alloc(rest, 1));
  const v0 = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]), v1 = Buffer.alloc(16, 0x5a);
  const xyz = box('\u00a9xyz', u16(18), u16(0), latin('+40.7123-074.0060/'));
  const udta = box('udta', xyz, box('\u00a9mak', latin('Phone')));
  const meta = box('meta', u32(0), box('keys', latin('com.apple.quicktime.location.ISO6709')));
  const loci = box('udta', box('loci', u32(0), Buffer.alloc(20, 4)));
  const xmpUuid = box('uuid', Buffer.from('be7acfcb97a942e89c71999491e3afac', 'hex'), XMP);
  const mdat = box('mdat', Buffer.from([0, 0, 0, 2, 9, 0x10, 0x55, 0x66, 0x77]));
  const build = (made0, made1, u, m, l, x) => cat(ftyp,
    box('moov',
      box('mvhd', full(0, made0, 88)),
      box('trak', box('tkhd', full(1, made1, 64)), box('mdia', box('mdhd', full(0, made0, 12)), box('hdlr', Buffer.alloc(24, 2))), l),
      u, m),
    x, mdat);
  return {
    dirty: build(v0, v1, udta, meta, loci, xmpUuid),
    clean: build(Buffer.alloc(8), Buffer.alloc(16), freed(udta), freed(meta), freed(loci), freed(xmpUuid))
  };
}

// ---- WebM ------------------------------------------------------------------
const size8 = (n) => { const b = Buffer.alloc(8); b[0] = 1; b.writeUIntBE(n, 2, 6); return b; };
const el = (id, body) => cat(Buffer.from(id, 'hex'), size8(body.length), body);
const short = (id, body) => cat(Buffer.from(id, 'hex'), Buffer.from([0x80 | body.length]), body);
function webm() {
  const ebml = el('1a45dfa3', short('4282', latin('webm')));
  const info = (date) => el('1549a966', cat(short('2ad7b1', Buffer.from([0x0f, 0x42, 0x40])), short('4461', date)));
  const tags = el('1254c367', el('7373', cat(el('67c8', cat(short('45a3', latin('LOCATION')), short('4487', latin('+40.7123-074.0060/')))))));
  const asVoid = (b) => { const out = Buffer.alloc(b.length); out[0] = 0xec; out[1] = 1; out.writeUIntBE(b.length - 9, 3, 6); return out; };
  const cluster = cat(Buffer.from('1f43b675', 'hex'), Buffer.from('01ffffffffffffff', 'hex'),
    short('e7', Buffer.from([0])), short('a3', Buffer.from([0x81, 0, 0, 0x80, 1, 2, 3])));
  const cues = el('1c53bb6b', short('bb', Buffer.from([0xb3, 0x81, 0])));
  const segment = (inf, tg) => cat(Buffer.from('18538067', 'hex'), Buffer.from('01ffffffffffffff', 'hex'), inf, tg, cluster, cluster, cues);
  return {
    dirty: cat(ebml, segment(info(Buffer.from([0, 0, 0, 0x1a, 0x2b, 0x3c, 0x4d, 0x5e])), tags)),
    clean: cat(ebml, segment(info(Buffer.alloc(8)), asVoid(tags)))
  };
}

const cases = [
  Object.assign({ name: 'camera', ext: '.jpg' }, jpeg()),
  Object.assign({ name: 'phone', ext: '.png' }, png()),
  Object.assign({ name: 'turned', ext: '.webp' }, webp()),
  Object.assign({ name: 'loop', ext: '.gif' }, gif()),
  Object.assign({ name: 'walk', ext: '.mp4' }, mp4()),
  Object.assign({ name: 'stream', ext: '.webm' }, webm()),
  // Already clean: given back byte for byte.
  { name: 'screenshot', ext: '.png', dirty: png().clean, clean: png().clean },
  // A byte where a JPEG block must start that cannot start one.
  { name: 'broken', ext: '.jpg', dirty: cat(Buffer.from([0xff, 0xd8]), seg(0xe0, latin('JFIF\0')), latin('not a block')), clean: null }
];

module.exports = { cases };

if (require.main === module) {
  const folder = process.argv[2];
  if (!folder) { console.error('say which folder'); process.exitCode = 2; return; }
  fs.mkdirSync(path.join(folder, 'in'), { recursive: true });
  fs.mkdirSync(path.join(folder, 'out'), { recursive: true });
  for (const c of cases) {
    fs.writeFileSync(path.join(folder, 'in', c.name + c.ext), c.dirty);
    if (c.clean) fs.writeFileSync(path.join(folder, 'out', c.name + c.ext), c.clean);
  }
}
