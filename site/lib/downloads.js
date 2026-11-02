/*
  The downloads folder: the files listed for download, and the installer
  from its GitHub Release.
*/

'use strict';

// Its functions, given before it loads any other module, so a module that
// needs this one back finds them (a function is there from the top of its
// file).
module.exports = { downloadServed, listFiles };

const fs     = require('fs');
const path   = require('path');
const { FILES } = require('./base');
const { jsonFile } = require('./store');
const { newestSetup } = require('./feed');

// ------------------------------------------------------------- downloads --
// The old installer's names: the setup program and its payload zip, stamped or
// not, as Publish-Installer put them in the downloads folder until #4824. The
// setup program comes from a GitHub Release now (newestSetup), so a copy left
// in the folder is never served or listed, whatever files.json still says.
function oldInstaller(name) {
  return /^Thornswood(?:-Dev)?-Setup(?:-\d{8}-\d{4})?\.(?:exe|zip)$/i.test(name);
}

// What /file/ serves from the downloads folder, which is also all the
// Downloads list may show from it (#3798). files.json is the list of what is
// published, so a name is served only when it is listed there and not hidden.
// files.json itself is served too. Anything else in the folder is not
// published, and answers 404. Until this the route served whatever sat in the
// folder, and a read only diagnostic put there by hand on the box (a script
// naming a staff member and the game server's address) went to anyone who
// asked for it by name, while the Downloads page only hid it.
function downloadServed(name, meta) {
  if (name === 'files.json') return true;
  if (oldInstaller(name)) return false;
  const m = Object.prototype.hasOwnProperty.call(meta, name) ? meta[name] : null;
  if (!m || typeof m !== 'object') return false;
  return !m.hidden;
}

function listFiles() {
  const meta = jsonFile(path.join(FILES, 'files.json'), {});
  const out = [];
  let names = [];
  // No downloads folder is no downloads. One that is there and cannot be
  // listed is said (#2736), since the page then offers nothing and the log
  // is the only place that says it is the folder and not the build.
  if (fs.existsSync(FILES)) {
    try { names = fs.readdirSync(FILES); }
    catch (e) { console.error('[thornswood-docs] could not list the downloads in ' + FILES + ' (' + (e.code || e.message) + ')'); }
  }
  for (const name of names) {
    // Only what /file/ serves, so the page never offers a name that answers
    // 404, and nothing files.json does not publish is listed at all.
    if (name === 'files.json' || !downloadServed(name, meta)) continue;
    let st;
    try { st = fs.statSync(path.join(FILES, name)); } catch (e) { continue; }
    if (!st.isFile()) continue;
    const m = meta[name];
    // A file's SHA-256, when files.json gives one, so the Downloads page can
    // print it beside the size and date (To Do entry 176). Only a well formed
    // hash goes out, in lower case because Get-FileHash writes upper and the
    // page builds an address from it.
    const sha256 = String(m.sha256 || '').toLowerCase();
    const hash = /^[0-9a-f]{64}$/.test(sha256) ? sha256 : '';
    out.push({ name, size: st.size, at: st.mtimeMs, hidden: !!m.hidden,
      label: m.label || name, version: m.version || '', note: m.note || '',
      sha256: hash, publisher: typeof m.publisher === 'string' ? m.publisher.trim() : '' });
  }
  // The installer: main's setup program, from its GitHub Release (#4824),
  // with the sha256 GitHub measured on it. Who signed it is not on the
  // Release, so the page names nobody rather than a name nothing checked
  // (#5275). Dev's is not listed: it is for staff, at /file/ by its name.
  const setup = newestSetup('main');
  if (setup) {
    out.push({ name: setup.name, size: setup.size, at: setup.at, hidden: false,
      label: setup.name, version: setup.tag, note: '', sha256: setup.sha256, publisher: '' });
  }
  out.sort((a, b) => b.at - a.at);
  return out;
}
