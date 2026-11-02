/*
  Uploads and the gallery: where files land, the small copies, a removal
  and its keeping time, and receiveUpload, which checks each upload before
  it is kept.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { deleteUpload, listUploads, pendingCopies, pictureSize,
  pruneRemovedUploads, receiveUpload, shotSrcset, smallCopy, smallFile,
  srcsetWidths, uploadRemoved, withGalleryPending };

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const { DATA, UP } = require('./base');
const { jsonFile, putJson } = require('./store');
const { reportFrom } = require('./limits');
const { exifTags, mediaSignature, stripMedia, uploadBudgets } = require('./media');

// --------------------------------------------------------------- uploads --
/* Somewhere to put a screenshot or a papyrus log without a share link and
   three permission prompts in the way. They land in uploads/ under a stamped
   name, and anyone with ssh reads that folder directly, which is the point: a
   log nobody can fetch is a log nobody reads. */
const UPMETA = path.join(UP, 'uploads.json');
// The two lists the gallery keeps in data/, deployed by the same rule as every
// other data JSON (Deploy-Docs sends a data JSON only when the VPS is missing
// it, so neither is ever overwritten once it exists there). gallery.json is the
// approved list /api/public and /shot read; gallery-pending.json is what is
// waiting for staff to Accept, and is never public. Unaccepted items sit
// in the staff Gallery until Accept or Delete; there is no Reject.
const GALLERY = path.join(DATA, 'gallery.json');
const GPENDING = path.join(DATA, 'gallery-pending.json');
/* Serialise gallery-pending.json writes. The site form can POST several files
   back to back; without this, two read-modify-write callbacks can drop one. */
let galleryPendingWrite = Promise.resolve();
function withGalleryPending(fn) {
  const run = galleryPendingWrite.then(() => fn());
  galleryPendingWrite = run.catch(() => {
    /* Not dropped: the caller has run, and hears the failure there (the
       upload answers it through failed). This only keeps the next write from
       waiting on a broken one. */
  });
  return run;
}
// Reports against approved shots. Same deploy rule as the queue: starts [],
// and Deploy-Docs only sends it when the VPS is missing it.
const GREPORTS = path.join(DATA, 'gallery-reports.json');
// What the gallery accepts and how big. Images and screen recordings (mp4,
// webm). /shot honours a byte range the same way public/ and /file do, so
// Safari and iOS can play an approved recording. Cap is 100 MB for
// recordings. The launcher AllowExt must match this list.
const GALLERY_ALLOW = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm'];
const GALLERY_CAP = 100 * 1024 * 1024;
const KIND = {
  '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.gif':'image/gif',
  '.webp':'image/webp', '.bmp':'image/bmp',
  '.mp4':'video/mp4', '.webm':'video/webm',
  '.txt':'text/plain; charset=utf-8', '.log':'text/plain; charset=utf-8',
  '.json':'text/plain; charset=utf-8', '.ini':'text/plain; charset=utf-8',
  '.md':'text/plain; charset=utf-8', '.cfg':'text/plain; charset=utf-8'
};

/*
  SMALLER COPIES OF A GALLERY PICTURE (#3218). Every picture went out as it
  was uploaded: the first on the front page was 1.15 MB at 2563 by 1440 and
  drawn at about 1229 by 514. The site cannot make a smaller copy, because
  node reads and writes no pictures and the site installs nothing, so the
  one that sends the picture makes them (Patrick's answer on the report
  page, 22 Oct 2026, option B): the upload page and the launcher's gallery
  button each send an 800 and a 1600 pixel wide copy after the picture, one
  for each width the picture is wider than, over POST /api/gallery/copy.

  WHAT GOES PUBLIC IS WHAT STAFF SAW. The site cannot look at a picture, so
  it cannot tell that a copy shows the same thing as the picture it is a
  copy of. What it can read is the width and height a file says it has
  (pictureSize), and a copy is refused unless it is exactly its width and
  the picture's shape. The rest is staff: the hub and the launcher show the
  copies on the waiting card beside the picture, and Accept says which
  copies it showed (copies on /api/gallery/approve). Only those go on the
  gallery. A launcher from before this sends no copies on Accept, so a
  picture it accepts goes out at full size, as every picture did.

  The sender may send each copy once, and only while the picture waits, so
  a copy cannot change between staff looking at it and accepting it. Staff
  may send or replace one at any time from the hub, made in their own
  browser from the picture they are looking at; that is how a picture
  accepted at full size gets its copies.

  A copy lives in uploads/small as <picture>.w<width>.webp or .jpg, is
  served at /shot/<picture>?w=<width> once the picture is on the gallery and
  at /up/<picture>?w=<width> to staff while it waits, and goes when the
  picture's file goes: deleteUpload takes the copies with it, so every door
  and sweep that deletes a picture deletes them too. gallery.json names the
  copies in the item's srcset, so /api/public and /api/gallery hand them
  out with nothing worked out per request.
*/
const SMALL_WIDTHS = [800, 1600];
const SMALL_KINDS = ['.webp', '.jpg'];
const SMALL_CAP = 8 * 1024 * 1024;
const UP_SMALL = path.join(UP, 'small');
function smallFile(name, width, ext) {
  return path.join(UP_SMALL, String(name) + '.w' + width + ext);
}
// The copy at that width on disk, or '' when there is none.
function smallCopy(name, width) {
  for (const ext of SMALL_KINDS) {
    const file = smallFile(name, width, ext);
    if (file.startsWith(UP_SMALL + path.sep) && fs.existsSync(file)) return file;
  }
  return '';
}
/* The width and height a PNG, JPEG, GIF or WebP file is shown at, read off
   its header, or null when the header cannot be read. A JPEG's size is in
   its frame header, after any metadata, so the markers are walked; a camera
   JPEG may say in its Exif that it is turned a quarter, and is then shown
   with width and height the other way round, as browsers show it and as a
   copy of it is made. */
function pictureSize(file) {
  let b;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      b = Buffer.alloc(Math.min(fs.fstatSync(fd).size, 1048576));
      fs.readSync(fd, b, 0, b.length, 0);
    } finally { fs.closeSync(fd); }
  } catch (e) {
    console.error('[thornswood-docs] could not read the size of ' + path.basename(String(file)) + ' (' + (e.code || e.message) + ')');
    return null;
  }
  const size = (w, h) => (w > 0 && h > 0 ? { w: w, h: h } : null);
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return size(b.readUInt32BE(16), b.readUInt32BE(20));
  }
  if (b.length >= 10 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('ascii'))) {
    return size(b.readUInt16LE(6), b.readUInt16LE(8));
  }
  if (b.length >= 30 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') {
    const chunk = b.subarray(12, 16).toString('ascii');
    if (chunk === 'VP8 ') return size(b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const bits = b.readUInt32LE(21);
      return size((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return size(b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1);
    return null;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2, turned = false;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      // SOF0 to SOF15 hold the size; C4, C8 and CC are other tables.
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        const w = b.readUInt16BE(i + 7), h = b.readUInt16BE(i + 5);
        return turned ? size(h, w) : size(w, h);
      }
      if (m === 0xe1 && i + 4 + 14 <= b.length && b.subarray(i + 4, i + 10).toString('latin1') === 'Exif\0\0') {
        turned = exifTurned(b, i + 10, Math.min(b.length, i + 2 + b.readUInt16BE(i + 2)));
      }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  return null;
}
// Whether the Exif block at start (its TIFF header) to end says the picture
// is turned a quarter: orientation 5 to 8, tag 0x0112 in the first IFD.
function exifTurned(b, start, end) {
  const turn = exifTags(b, start, end).turn;
  return turn >= 5 && turn <= 8;
}
// The widths a waiting picture has copies of, as the queue lists them.
function pendingCopies(entry) {
  return (Array.isArray(entry && entry.copies) ? entry.copies : [])
    .map(Number).filter((n) => SMALL_WIDTHS.indexOf(n) >= 0);
}
/* The srcset gallery.json keeps for a picture: each copy listed, then the
   picture itself at its own width, which the site reads off its header. ''
   with no copy, or when the picture's width cannot be read. */
function shotSrcset(name, widths) {
  const listed = SMALL_WIDTHS.filter((n) => widths.indexOf(n) >= 0 && smallCopy(name, n));
  if (!listed.length) return '';
  const full = pictureSize(path.join(UP, String(name)));
  if (!full) return '';
  // Escaped, because a srcset is split on spaces and a name may hold one.
  const url = '/shot/' + encodeURIComponent(String(name));
  return listed.map((n) => url + '?w=' + n + ' ' + n + 'w').concat(url + ' ' + full.w + 'w').join(', ');
}
// The copy widths a gallery item's srcset names.
function srcsetWidths(srcset) {
  const out = [];
  for (const m of String(srcset || '').matchAll(/\?w=(\d+) /g)) {
    if (SMALL_WIDTHS.indexOf(Number(m[1])) >= 0) out.push(Number(m[1]));
  }
  return out;
}

/*
  Deleting an upload, said truthfully (#2352, #2354). Both doors that delete a
  file used to catch the failure and answer ok, so a picture somebody asked
  to have removed could stay on disk with staff told it had gone. This
  answers { ok } or { ok: false, code } and writes one line to the site's
  log for a failure: the file's name and the error code, never what it holds.
  A file already gone is gone, which is what was asked.

  A gallery picture's smaller copies go with it (#3218), first, so a copy is
  never left behind a picture that went. One that will not go is said the
  same way and the picture stays, so the next sweep asks again for both.
*/
function deleteUpload(name) {
  const file = path.join(UP, String(name));
  if (!file.startsWith(UP + path.sep)) return { ok: false, code: 'BADNAME' };
  const files = [];
  for (const width of SMALL_WIDTHS) {
    for (const ext of SMALL_KINDS) files.push(smallFile(name, width, ext));
  }
  files.push(file);
  for (const one of files) {
    try {
      fs.unlinkSync(one);
    } catch (e) {
      const code = (e && e.code) || 'unknown';
      if (code === 'ENOENT') continue;
      retentionSay('gallery', { event: 'delete-failed', file: path.relative(UP, one), code: code });
      return { ok: false, code: code };
    }
  }
  return { ok: true };
}

/* A gallery submission staff removed and whose file stayed on disk: marked
   on uploads.json by DELETE /api/gallery/approved, and never served again. */
function uploadRemoved(name) {
  const m = jsonFile(UPMETA, {})[String(name)];
  return !!(m && m.removed);
}

/*
  HOW LONG A REMOVED SUBMISSION'S FILE STAYS (#2352). Decided by Patrick on
  12 October, option C: removing a submission deletes its file, and a picture
  taken down after a report is kept, unshown, for GALLERY_HOLD_DAYS so staff
  can look into the report, then deleted. "After a report" is read off the
  site's own record rather than off whichever button was pressed: a
  submission with an open report against it in gallery-reports.json when it
  is removed is held, with those reports beside it on uploads.json, and every
  other removal deletes the file there and then. The hub, the launcher's
  Delete and its Take down all reach the same door, so the rule is the same
  whichever one staff use.

  pruneRemovedUploads is the other half, run by the retention timer: a
  removed file whose hold has ended, or that was never held (one kept by the
  hub's old Cancel, or one whose delete failed at the time), is deleted, and
  a delete that fails is said in the site's log by deleteUpload, file and
  code, never what it holds. Failing to delete a file that the nightly backup
  or a virus scan has open is outside our control; the next hour asks again
  and says so again, rather than going quiet.
*/
const GALLERY_HOLD_DAYS = 30;
function pruneRemovedUploads(now) {
  const at = Number(now) || Date.now();
  const meta = jsonFile(UPMETA, {});
  const out = { deleted: 0, held: 0, failed: [] };
  let changed = false;
  for (const name of Object.keys(meta)) {
    const m = meta[name];
    if (!m || !m.removed) continue;
    if (Number(m.heldUntil) > at) { out.held++; continue; }
    const gone = deleteUpload(name);
    if (gone.ok) { delete meta[name]; changed = true; out.deleted++; }
    else out.failed.push({ file: name, code: gone.code });
  }
  if (changed && !putJson(UPMETA, meta)) {
    retentionSay('gallery', { event: 'note-write-failed', deleted: out.deleted });
  }
  return out;
}

function listUploads() {
  const meta = jsonFile(UPMETA, {});
  const out = [];
  let names = [];
  // As listFiles (#2736): no folder is no uploads, a folder that cannot be
  // listed is said.
  if (fs.existsSync(UP)) {
    try { names = fs.readdirSync(UP); }
    catch (e) { console.error('[thornswood-docs] could not list the uploads in ' + UP + ' (' + (e.code || e.message) + ')'); }
  }
  for (const name of names) {
    if (name === 'uploads.json') continue;
    let st;
    try { st = fs.statSync(path.join(UP, name)); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const m = meta[name] || {};
    const ext = path.extname(name).toLowerCase();
    out.push({
      name, size: st.size, at: m.at || st.mtimeMs,
      orig: m.orig || name, by: m.by || '', note: m.note || '',
      removed: !!m.removed,
      image: /^image\//.test(KIND[ext] || ''),
      text: (KIND[ext] || '').indexOf('text/') === 0
    });
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}

function receiveUpload(req, res, asked, cap, allow, saved, copy) {
  if (Number(req.headers['content-length'] || 0) > cap) {
    return sendJson(res, 413, { error: 'that file is over ' + Math.round(cap / 1048576) + ' MB' });
  }
  const offered = String(asked || 'file').split(/[\\/]/).pop();
  const safe = offered.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/^[. ]+/, '')
                      .slice(0, 90) || 'file';
  if (allow) {
    const ext = path.extname(safe).toLowerCase();
    if (allow.indexOf(ext) < 0) {
      req.resume();
      return sendJson(res, 415, { error: 'that kind of file is not allowed here', allowed: allow });
    }
  }
  const now = Date.now(), key = reportFrom(req);
  for (const [k, row] of uploadBudgets) if (!row.active && now - row.start >= 3600000) uploadBudgets.delete(k);
  let budget = uploadBudgets.get(key);
  if (!budget) {
    if (uploadBudgets.size >= 4096) return sendJson(res, 503, {error:'Uploads are busy. Try again shortly.'});
    budget = {start:now, count:0, bytes:0, active:0}; uploadBudgets.set(key, budget);
  }
  if (budget.active >= 2 || budget.count >= 40 || budget.bytes >= 500 * 1048576) {
    req.resume();
    return send(res, 429, JSON.stringify({error:'This connection has reached its upload limit. Try again later.'}),
      null, {'Retry-After':String(Math.max(1, Math.ceil((budget.start + 3600000 - now) / 1000))), Connection:'close'});
  }
  if (!copy) budget.count++;
  budget.active++;
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + two(d.getMonth() + 1) + two(d.getDate()) + '-' +
                two(d.getHours()) + two(d.getMinutes());
  const name = stamp + '-' + crypto.randomBytes(6).toString('hex') + '-' + safe;
  const dest = path.join(UP, name);
  let descriptor;
  try { descriptor = fs.openSync(dest, 'wx'); }
  catch (e) {
    budget.active--;
    return sendJson(res, 500, {error:'The site could not reserve an upload file. Try again shortly.'});
  }

  /* Over the cap or cut off partway, the half file goes (#1095). Over the cap
     it destroyed the request, so the 413 went to a socket already closed, and
     a sender that dropped partway never ended the pipe, so the half file sat
     open on disk and the route never answered. Now too big is answered 413
     and the rest read and thrown away, and a connection that went is closed
     with nothing left to say. */
  let got = 0, over = false, cut = false, broke = false, timedOut = false, quotaExceeded = false, prefix = Buffer.alloc(0);
  const out = fs.createWriteStream(dest, {fd:descriptor, autoClose:true});
  const deadline = setTimeout(() => {
    timedOut = true; req.unpipe(out); out.destroy(); req.resume();
  }, 300000);
  // The write's own error code is kept, so the 500 below can say it (#2736).
  out.on('error', (e) => { broke = (e && e.code) || 'unknown'; });
  req.on('data', (c) => {
    got += c.length;
    budget.bytes += c.length;
    if (budget.bytes > 500 * 1048576) quotaExceeded = true;
    if (prefix.length < 12) prefix = Buffer.concat([prefix, c.subarray(0, 12 - prefix.length)]);
    if ((got > cap || budget.bytes > 500 * 1048576) && !over) { over = true; req.unpipe(out); out.destroy(); }
  });
  const drop = () => { if (!req.complete && !over && !cut) { cut = true; req.unpipe(out); out.destroy(); } };
  req.on('error', drop);
  req.on('aborted', drop);
  req.on('close', drop);
  req.pipe(out);
  out.on('close', () => {
    clearTimeout(deadline); budget.active--;
    const invalid = !over && !cut && !broke && !timedOut && allow && !mediaSignature(path.extname(safe).toLowerCase(), prefix);
    if (over || cut || broke || timedOut || invalid) {
      // The half file goes. It was made above with wx, so it is there; one
      // that will not go is said, by its name and the code (#2736).
      let removed = false;
      try { fs.unlinkSync(dest); removed = true; }
      catch (e) { console.error('[thornswood-docs] could not remove the half upload ' + name + ' (' + (e.code || e.message) + ')'); }
      if (timedOut) return send(res, 408, JSON.stringify({error:'That upload took too long. Try again with a smaller file.'}), null, {Connection:'close'});
      if (quotaExceeded) return send(res, 429, JSON.stringify({error:'This connection has uploaded 500 MB in the last hour. Try again later.'}),
        null, {'Retry-After':String(Math.max(1, Math.ceil((budget.start + 3600000 - Date.now()) / 1000))), Connection:'close'});
      if (invalid) return sendJson(res, 415, {error:'The file contents do not match its image or recording type.'});
      if (over) return send(res, 413, JSON.stringify({ error: 'that file is over ' + Math.round(cap / 1048576) + ' MB' }),
                            null, { Connection: 'close' });
      // destroy() does not throw, so no try (#2736). A sender that went has
      // nobody left to answer, so the log is the only record it leaves
      // (#3062), said once the half file is gone.
      if (cut) {
        if (removed) console.log('[thornswood-docs] upload cut off after ' + got + ' bytes on ' +
                                 JSON.stringify(String(req.url || '').split('?')[0].slice(0, 200)) + ', the half file is removed');
        res.destroy();
        return;
      }
      console.error('[thornswood-docs] could not write the upload ' + name + ' (' + broke + ')');
      return sendJson(res, 500, { error: 'the site could not save that file. Try again in a minute.' });
    }
    // A picture or recording is what its first bytes say it is: what it says
    // about where and when it was made goes before anybody can fetch it
    // (#3648). One that cannot be cleaned is not kept as it came.
    if (mediaSignature(path.extname(safe).toLowerCase(), prefix)) {
      const clean = stripMedia(dest);
      if (!clean.ok) {
        console.error('[thornswood-docs] could not clean the upload ' + name + ': ' + clean.why);
        try { fs.unlinkSync(dest); }
        catch (e) { console.error('[thornswood-docs] could not remove the upload ' + name + ' (' + (e.code || e.message) + ')'); }
        return sendJson(res, 415, { error: 'The site could not read that file to take out where and when it was made, so it did not keep it.' });
      }
    }
    saved(name);
  });
}

// ==== end thornswood upload guard ====

Object.assign(module.exports, { GALLERY, GALLERY_ALLOW, GALLERY_CAP,
  GALLERY_HOLD_DAYS, GPENDING, GREPORTS, KIND, SMALL_CAP, SMALL_KINDS,
  SMALL_WIDTHS, UP_SMALL, UPMETA });

// From modules loaded after this one, taken once this one is whole, so a
// module that needs this one back finds all of it.
const { send, sendJson } = require('./http');
const { retentionSay } = require('./sessions');
