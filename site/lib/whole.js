/*
  Putting a file on disk whole (#5890): written to a temp file beside it and
  renamed in, so a crash or a restart part way through leaves the old file
  or the new one, never one cut short. Loaded before everything but base,
  with nothing of the site's own, so config.js (which loads before store.js)
  writes config.json through it too.
*/

'use strict';

const fs   = require('fs');
const path = require('path');

/* Writes body to p whole, or throws as writeFileSync or renameSync does and
   leaves p as it was. A rename that fails is never copied over p in its
   place: on Windows a rename onto a file another program holds open fails,
   and copying over it is the in-place write this is here to stop. The error
   carries step 'rename' then, for the caller to say. A temp file that will
   not go is said, by its name and code (#2736): it holds a whole copy of the
   file. A file that may not be written is not renamed over either: writing
   it in place refused it, and on Linux a rename would replace it. */
function writeWhole(p, body) {
  if (fs.existsSync(p)) fs.accessSync(p, fs.constants.W_OK);
  // TEMP's name; one a run leaves goes at the next start (clearLeftWrites).
  const tmp = path.join(path.dirname(p), '.' + path.basename(p) + '.' + process.pid + '.tmp');
  try {
    fs.writeFileSync(tmp, body, typeof body === 'string' ? 'utf8' : undefined);
    try { fs.renameSync(tmp, p); }
    catch (e) { e.step = 'rename'; throw e; }
  } catch (e) {
    if (fs.existsSync(tmp)) {
      try { fs.unlinkSync(tmp); }
      catch (e2) { console.error('[thornswood-docs] could not remove ' + tmp + ' (' + (e2.code || e2.message) + ')'); }
    }
    throw e;
  }
}

/* The name of the temp file writeWhole puts beside <name>: a dot, the name,
   the writer's process id, .tmp. */
const TEMP = /^\.(.+)\.(\d+)\.tmp$/;

// Whether a process of that id is running now (EPERM: running, not ours).
function running(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

/* LEFT BY AN EARLIER RUN (#7437). A site killed or a box restarted part way
   through writeWhole leaves the target whole and the temp file beside it,
   up to a whole copy of the file (config.json's holds the Discord secret,
   the bot token, botKey and the cookie secret), and no later write is ever
   given that name again, since the next run has its own process id. So the
   site clears them on the way up, before it writes anything: every temp
   file of writeWhole's name under root, in every folder but node_modules
   and folders whose name starts with a dot (uploads' .part, which
   clearPartUploads owns). One whose writer is still running is another
   process part way through its own write, and is left and said; on Windows
   a later process can have that id, so it goes at a later start. Each one
   removed is said, and each that will not go, with its code. Returns
   { removed, left, failed }, each a list of paths under root. */
function clearLeftWrites(root) {
  const out = { removed: [], left: [], failed: [] };
  const rel = (p) => path.relative(root, p);
  const walk = (dir) => {
    let names;
    try { names = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) {
      if (e.code === 'ENOENT') return;
      out.failed.push(rel(dir) || '.');
      console.error('[thornswood-docs] could not look for left temp files in ' + (rel(dir) || root) + ' (' + (e.code || e.message) + ')');
      return;
    }
    for (const d of names) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (d.name !== 'node_modules' && d.name[0] !== '.') walk(p);
        continue;
      }
      const m = d.isFile() ? TEMP.exec(d.name) : null;
      if (!m) continue;
      const pid = Number(m[2]);
      if (pid === process.pid || running(pid)) {
        out.left.push(rel(p));
        console.log('[thornswood-docs] left ' + rel(p) + ': process ' + pid + ' is running and may be writing it');
        continue;
      }
      try {
        fs.unlinkSync(p);
        out.removed.push(rel(p));
        console.log('[thornswood-docs] removed ' + rel(p) + ', left by a write cut off when the site last stopped');
      } catch (e) {
        out.failed.push(rel(p));
        console.error('[thornswood-docs] could not remove ' + rel(p) + ', left by a write cut off when the site last stopped (' + (e.code || e.message) + ')');
      }
    }
  };
  walk(root);
  return out;
}

module.exports = { clearLeftWrites, writeWhole };
