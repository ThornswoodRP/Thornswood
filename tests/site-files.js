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
    siteFiles.listening(child)          a copy started on port 0: resolves
                                        with { port, out } once it has said
                                        the port the system gave it
    siteFiles.saidPort(text)            that port from what a copy printed,
                                        0 while it has not said it

  A copy a harness runs is started with THORNSWOOD_DOCS_PORT=0 and asked
  nothing until it has said its port (#6136). A port the harness takes from
  the system and lets go can be taken by somebody else before the copy
  listens on it: on the Linux gate a copy exited with EADDRINUSE on the port
  freePort() had just closed, with four to six harnesses running at once.

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

// The port in a copy's "[thornswood-docs] listening on <address>:<port>"
// line, 0 while it has not said one.
function saidPort(text) {
  const m = /\[thornswood-docs\] listening on \S+:(\d+)\r?\n/.exec(String(text));
  return m ? Number(m[1]) : 0;
}

// Waits for a copy started on port 0 to say the port it got. Rejects when
// the copy stops first, or says nothing in ms (15 s), with what it printed.
function listening(child, ms) {
  return new Promise((ok, bad) => {
    let out = '';
    let late = null;
    const end = (e) => {
      clearTimeout(late);
      child.stdout.removeListener('data', said);
      child.stderr.removeListener('data', said);
      child.removeListener('exit', gone);
      if (e) { bad(e); } else { ok({ port: saidPort(out), out: out }); }
    };
    const said = (d) => { out += d; if (saidPort(out)) { end(null); } };
    const gone = (code) => end(new Error('the site stopped (exit ' + code + ') before it was listening. It printed:\n' + out));
    child.stdout.on('data', said);
    child.stderr.on('data', said);
    child.on('exit', gone);
    late = setTimeout(() => end(new Error('the site did not say it was listening within ' + Math.round((ms || 15000) / 1000) +
                                         ' seconds. It printed:\n' + out)), ms || 15000);
    if (child.exitCode !== null) { gone(child.exitCode); }
  });
}

module.exports = { APP, files, source, copy, listening, saidPort };
