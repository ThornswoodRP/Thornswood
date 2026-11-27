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
   file. */
function writeWhole(p, body) {
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

module.exports = { writeWhole };
