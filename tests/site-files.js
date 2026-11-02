'use strict';
/*
  site-files.js: the site's program as the harnesses read and copy it (#5357).

  The site was one file, site\server.js. Now server.js is the start, and the
  site is the modules in site\lib, one per area, which server.js names in the
  order it loads them. A harness that lifts a function or a block out of the
  site by text reads source(): every module in that order and then
  server.js, the order the code had in the one file, so it finds the code
  in whichever module holds it. Its lines end in a bare line feed whatever
  the checkout, so a harness reads the same text on Windows, where git may
  hand the files out with CRLF, as on Linux.
  One that runs a real copy of the site in a scratch folder puts every file
  there with copy().

    const siteFiles = require('./site-files');
    siteFiles.source()                  the whole program as one text
    siteFiles.files()                   ['server.js', 'lib/base.js', ...]
    siteFiles.copy(dir)                 server.js and lib\ into dir
    siteFiles.copy(dir, other, patch)   another copy's server.js (and its
                                        lib\ when it has one), each file's
                                        text through patch(text, rel)

  Where a harness takes another copy of the site to run against, other is
  that copy's server.js; one from before the split is the whole program.
*/

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..', 'site');

// The folder and the start file a path names: a folder holding server.js,
// or a server.js (by any name) itself.
function where(p) {
  if (!p) return { app: APP, entry: 'server.js' };
  const full = path.resolve(p);
  if (/\.js$/i.test(full)) return { app: path.dirname(full), entry: path.basename(full) };
  return { app: full, entry: 'server.js' };
}

// server.js, then each module it requires from lib, in its order (the
// --strip-metadata line asks for one module early, and is not the order).
function files(p) {
  const w = where(p);
  const entry = fs.readFileSync(path.join(w.app, w.entry), 'utf8')
    .split('\n').filter((l) => l.indexOf('--strip-metadata') < 0).join('\n');
  const out = ['server.js'];
  const re = /require\('\.\/lib\/([a-z0-9-]+)'\)/g;
  let m;
  while ((m = re.exec(entry)) !== null) {
    const rel = 'lib/' + m[1] + '.js';
    if (out.indexOf(rel) < 0) out.push(rel);
  }
  return out;
}

function read(w, rel) {
  return fs.readFileSync(path.join(w.app, rel === 'server.js' ? w.entry : rel), 'utf8');
}

function source(p) {
  const w = where(p);
  const all = files(p);
  return all.slice(1).concat(all.slice(0, 1)).map((rel) => read(w, rel).split('\r\n').join('\n')).join('\n');
}

function copy(dir, p, patch) {
  const w = where(p);
  for (const rel of files(p)) {
    let text = read(w, rel);
    if (patch) text = patch(text, rel);
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}

module.exports = { APP, files, source, copy };
