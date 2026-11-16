// Check-SkyUIMenus.js
//
//     node scripts\mods\Check-SkyUIMenus.js
//     node scripts\mods\Check-SkyUIMenus.js --data <a Data folder> --plugins <its plugins.txt>
//     node scripts\mods\Check-SkyUIMenus.js ... --gone "Data\Scripts\a.pex;Data\Interface\b.swf" --quiet
//     node scripts\mods\Check-SkyUIMenus.js --holding <archive.bsa> ...
//
// With no --plugins it reads Profile\OwnGame\plugins.txt of the install --data
// is in (two folders up from Data).
//
// Says whether SkyUI's menu files carry the version SkyUI's own script expects,
// and exits 2 when one does not. Ship.ps1 runs it before a release.
//
// Issue #960, 28 September, on dev: "SKYUI ERROR CODE 6", menu file version
// mismatch for magicmenu.swf, skyui/itemcard.swf, skyui/bottombar.swf,
// map.swf and more, "required 5.2 SE, detected 6.11 SE". SkyUI's ski_main.pex
// holds the version it wants and the list of menus it checks; each menu holds
// the version it is. When the two come from different SkyUI releases, the box
// goes up on the way in. On the shipping machine the menus were the
// collection's SkyUI (6.11 SE, inside SkyUI_SE.bsa) and the script was SkyUI
// 5.2 SE's, loose in Data\Scripts, left in the Steam copy by the collection
// installer. Loose beats an archive, so the old script won.
//
// WHAT IT READS, the way the game does. A file loose in Data beats any archive.
// Between archives, the one loaded by the later plugin wins, and an archive no
// plugin loads (the game's own, named in its ini) comes first. So:
//
//   1. ski_main.pex, from wherever the game would take it. Its string table
//      holds the version it requires ("5.2 SE") and the menus it checks
//      ("magicmenu.swf", "skyui/itemcard.swf" ...). A ski_main with no
//      "Menu file version mismatch" message in it does not check menus at all
//      (the collection's SkyUI no longer does), and then there is nothing to
//      mismatch.
//   2. Each of those menus, from wherever the game would take it: its
//      SKYUI_VERSION_STRING. It must be the version the script requires. A
//      menu with no SKYUI_ marker in it at all is not SkyUI's (that is ERROR
//      CODE 5, the loose map.swf of 22 September) and fails as well.
//
// The version strings are compared, not the release numbers, because the
// strings are what the box shows and they move together with the numbers.
//
// --gone lists paths under the game folder that the release deletes from every
// install (Ship-Rules.ps1, $ShipDeleteAlways). They are read as absent, so a
// release that takes the old scripts off every machine passes on the machine
// that builds it before its own launcher has applied that release.
//
// Read only. It opens files in the game folder and writes nothing.
// Exits 0 when every menu matches, or SkyUI's script checks none, or SkyUI is
// not installed; 2 when a menu is not the version the script expects; 1 when
// the folder or the load order is not there or a file cannot be read.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const M = require('./Audit-ModMenus.js');
const { loadOrder } = require('../dev/OwnPlugins.js');

// ------------------------------------------------------------------ archives

function readAt(fd, pos, len) {
  const b = Buffer.alloc(len);
  let got = 0;
  while (got < len) {
    const n = fs.readSync(fd, b, got, len - got, pos + got);
    if (n <= 0) { break; }
    got += n;
  }
  return got === len ? b : b.slice(0, got);
}

/*
  Every file in one archive under scripts or interface, by lower case path
  (folder\leaf), with where its bytes are. Only the header, the folder records
  and the name block are read. Same layout Audit-ModMenus.archiveScripts reads,
  for every folder rather than scripts alone.
*/
function archiveIndex(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const h = readAt(fd, 0, 36);
    if (h.length < 36 || h.toString('ascii', 0, 4) !== 'BSA\u0000') { throw new Error('not an archive'); }
    const version = h.readUInt32LE(4);
    const offset = h.readUInt32LE(8);
    const flags = h.readUInt32LE(12);
    const folderCount = h.readUInt32LE(16);
    const fileCount = h.readUInt32LE(20);
    const folderNamesLen = h.readUInt32LE(24);
    const fileNamesLen = h.readUInt32LE(28);
    const rec = version >= 105 ? 24 : 16;
    const recs = readAt(fd, offset, folderCount * rec);
    const blockAt = offset + folderCount * rec;
    const block = readAt(fd, blockAt, folderCount + folderNamesLen + fileCount * 16);
    const names = readAt(fd, blockAt + block.length, fileNamesLen);
    const found = {};
    let nameAt = 0;
    for (let f = 0; f < folderCount; f++) {
      const count = recs.readUInt32LE(f * rec + 8);
      const off = recs.readUInt32LE(f * rec + (version >= 105 ? 16 : 12));
      let q = off - fileNamesLen - blockAt;
      const nameLen = block[q];
      const folder = block.toString('latin1', q + 1, q + nameLen).replace(/\u0000+$/, '').toLowerCase();
      q += 1 + nameLen;
      for (let i = 0; i < count; i++) {
        const sz = block.readUInt32LE(q + 8);
        const at = block.readUInt32LE(q + 12);
        q += 16;
        const end = names.indexOf(0, nameAt);
        const leaf = names.toString('latin1', nameAt, end < 0 ? names.length : end).toLowerCase();
        nameAt = end < 0 ? names.length : end + 1;
        if (folder !== 'scripts' && folder !== 'interface' && folder.indexOf('interface\\') !== 0) { continue; }
        let compressed = !!(flags & 0x4);
        if (sz & 0x40000000) { compressed = !compressed; }
        found[folder + '\\' + leaf] = {
          archive: file, version: version, embedded: !!(flags & 0x100),
          compressed: compressed, at: at, size: sz & 0x3fffffff
        };
      }
    }
    return found;
  } finally {
    fs.closeSync(fd);
  }
}

/*
  The loose file at k (lower case, folders split by \) under Data, or null.
  Each folder and the file are matched in any case, because Windows, where
  the game reads them, matches them so: Data\Scripts\SKI_Main.pex is
  scripts\ski_main.pex to it. Joined as one string, k named a file called
  "scripts\ski_main.pex" on Linux, found nothing, and every menu passed (#3005).
*/
function looseFile(data, k) {
  let at = data;
  for (const part of k.split('\\')) {
    let names;
    try { names = fs.readdirSync(at); } catch (e) { return null; }
    const hit = names.filter(function (n) { return n.toLowerCase() === part; })[0];
    if (hit === undefined) { return null; }
    at = path.join(at, hit);
  }
  return fs.statSync(at).isFile() ? at : null;
}

/*
  Where the game would take a file under Data from: loose first, unless the
  release deletes it; then the archive loaded last. Returns { from, bytes }
  or null, and throws when the file is there and cannot be read.
*/
function fileFinder(data, order, gone) {
  let archived = null;
  const problems = [];
  function indexArchives() {
    archived = {};
    let files = [];
    try { files = fs.readdirSync(data).filter(function (f) { return /\.bsa$/i.test(f); }); } catch (e) { files = []; }
    const stems = order.map(function (n) { return n.replace(/\.(esp|esm|esl)$/i, '').toLowerCase(); });
    function rank(f) {
      const stem = f.replace(/\.bsa$/i, '').toLowerCase();
      for (let i = stems.length - 1; i >= 0; i--) {
        if (stem === stems[i] || stem.indexOf(stems[i] + ' - ') === 0) { return i; }
      }
      return -1;
    }
    files.sort(function (a, b) { return rank(a) - rank(b) || (a.toLowerCase() < b.toLowerCase() ? -1 : 1); });
    files.forEach(function (f) {
      let got = {};
      try { got = archiveIndex(path.join(data, f)); } catch (e) { problems.push(f + ' would not read: ' + e.message); return; }
      Object.keys(got).forEach(function (k) { archived[k] = got[k]; });
    });
  }
  function find(rel) {
    const k = rel.toLowerCase().replace(/\//g, '\\');
    const loose = gone[('data\\' + k)] ? null : looseFile(data, k);
    if (loose) {
      return { from: 'loose in Data\\' + path.win32.dirname(rel.replace(/\//g, '\\')), bytes: fs.readFileSync(loose) };
    }
    if (!archived) { indexArchives(); }
    const entry = archived[k];
    if (!entry) { return null; }
    return { from: path.basename(entry.archive), bytes: M.archiveFile(entry) };
  }
  find.problems = problems;
  return find;
}

// ------------------------------------------------------------------ SkyUI

const VERSION = /^\d+\.\d+(\.\d+)? SE$/;
const CHECKS_MENUS = /^Menu file version mismatch/;

/* What a ski_main.pex asks for: the version, the menus, and when it was built. */
function readSkyUIScript(bytes) {
  const pex = M.readPex(bytes);
  const version = pex.strings.filter(function (s) { return VERSION.test(s); })[0] || '';
  const menus = [];
  pex.strings.forEach(function (s) {
    if (/\.swf$/i.test(s) && menus.indexOf(s.toLowerCase()) === -1) { menus.push(s.toLowerCase()); }
  });
  // The compile time, seconds since 1970, big endian, after the four byte
  // magic, the two version bytes and the two byte game id.
  const secs = bytes.readUInt32BE(8) * 4294967296 + bytes.readUInt32BE(12);
  return {
    version: version,
    checks: pex.strings.some(function (s) { return CHECKS_MENUS.test(s); }),
    menus: menus,
    built: secs > 0 ? new Date(secs * 1000).toISOString().slice(0, 10) : ''
  };
}

/* An uncompressed movie: FWS as it is, CWS inflated. */
function swfBody(bytes) {
  const sig = bytes.toString('ascii', 0, 3);
  if (sig === 'FWS') { return bytes; }
  if (sig === 'CWS') { return Buffer.concat([bytes.slice(0, 8), zlib.inflateSync(bytes.slice(8))]); }
  throw new Error('not a Flash movie this reads (' + JSON.stringify(sig) + ')');
}

/* What a menu says it is: whether it is SkyUI's at all, and the version strings in it. */
function readMenu(bytes) {
  const body = swfBody(bytes).toString('latin1');
  const skyui = body.indexOf('SKYUI_VERSION_STRING') !== -1 || body.indexOf('SKYUI_RELEASE_IDX') !== -1;
  const versions = [];
  body.split('\u0000').forEach(function (s) {
    if (VERSION.test(s) && versions.indexOf(s) === -1) { versions.push(s); }
  });
  return { skyui: skyui, versions: versions };
}

function check(opts) {
  const order = loadOrder(opts.plugins);
  const gone = {};
  (opts.gone || []).forEach(function (g) { if (g) { gone[g.toLowerCase().replace(/\//g, '\\')] = true; } });
  const find = fileFinder(opts.data, order, gone);
  const r = { data: opts.data, script: null, rows: [], problems: find.problems, verdict: 'ok' };

  let s;
  try { s = find('Scripts\\ski_main.pex'); } catch (e) { r.problems.push('ski_main.pex would not read: ' + e.message); }
  if (!s) { r.verdict = 'none'; return finish(r); }
  try { r.script = readSkyUIScript(s.bytes); r.script.from = s.from; }
  catch (e) { r.problems.push('ski_main.pex (' + s.from + ') would not read: ' + e.message); return finish(r); }
  // A loose ski_main over an archive's: say what it hides, because that is
  // the question somebody reading a failure asks next.
  if (/^loose/.test(s.from)) {
    const hidden = fileFinder(opts.data, order, { 'data\\scripts\\ski_main.pex': true });
    try {
      const a = hidden('Scripts\\ski_main.pex');
      if (a) { const h = readSkyUIScript(a.bytes); r.script.hides = { from: a.from, built: h.built, checks: h.checks }; }
    } catch (e) { /* only the explanation is lost; the check itself stands */ }
  }
  if (!r.script.checks) { r.verdict = 'unchecked'; return finish(r); }
  if (!r.script.version) { r.problems.push('ski_main.pex (' + s.from + ') checks menus but names no version this can read'); return finish(r); }

  r.script.menus.forEach(function (name) {
    const row = { menu: name, from: '', versions: [], state: '' };
    let f = null;
    try { f = find('Interface\\' + name); }
    catch (e) { row.state = 'unread'; row.why = e.message; r.rows.push(row); return; }
    if (!f) { row.state = 'missing'; r.rows.push(row); return; }
    row.from = f.from;
    let m;
    try { m = readMenu(f.bytes); }
    catch (e) { row.state = 'unread'; row.why = e.message; r.rows.push(row); return; }
    row.versions = m.versions;
    if (!m.skyui) { row.state = 'foreign'; }
    else if (m.versions.indexOf(r.script.version) !== -1) { row.state = 'ok'; }
    else if (m.versions.length) { row.state = 'wrong'; }
    else { row.state = 'unread'; row.why = 'SkyUI\'s, but no version string in it this can read'; }
    r.rows.push(row);
  });
  return finish(r);
}

function finish(r) {
  const bad = r.rows.filter(function (x) { return x.state === 'wrong' || x.state === 'foreign' || x.state === 'missing'; });
  const unread = r.rows.filter(function (x) { return x.state === 'unread'; });
  // A menu that is the wrong one is certain whatever else could not be read.
  if (bad.length) { r.verdict = 'mismatch'; }
  else if (unread.length || r.problems.length) { r.verdict = 'unread'; }
  r.code = r.verdict === 'mismatch' ? 2 : r.verdict === 'unread' ? 1 : 0;
  return r;
}

// ------------------------------------------------------------------ the report

function report(r, quiet) {
  const out = [];
  function say(s) { out.push(s); }
  const sc = r.script;
  if (sc) {
    say('SkyUI\'s script: ski_main.pex ' + sc.from + (sc.built ? ', built ' + sc.built : '') +
        (sc.checks ? ', checks ' + sc.menus.length + ' menus for ' + sc.version : ', checks no menu versions'));
    if (sc.hides) {
      say('  it hides the one in ' + sc.hides.from + (sc.hides.built ? ', built ' + sc.hides.built : '') +
          (sc.hides.checks ? '' : ', which checks no menu versions'));
    }
  }
  r.rows.forEach(function (x) {
    const v = x.versions.length ? x.versions.join(', ') : 'no version';
    if (x.state === 'ok') { if (!quiet) { say('  ok       ' + x.menu + '  ' + v + ', ' + x.from); } return; }
    if (x.state === 'wrong') { say('  WRONG    ' + x.menu + '  ' + v + ', ' + x.from + '; SkyUI\'s script wants ' + sc.version); return; }
    if (x.state === 'foreign') { say('  WRONG    ' + x.menu + '  not SkyUI\'s menu at all (' + x.from + ')'); return; }
    if (x.state === 'missing') { say('  WRONG    ' + x.menu + '  not in the game folder or any archive'); return; }
    say('  UNREAD   ' + x.menu + '  ' + (x.from ? x.from + ': ' : '') + (x.why || ''));
  });
  r.problems.forEach(function (p) { say('  UNREAD   ' + p); });
  say('');
  if (r.verdict === 'none') { say('SkyUI is not in this game folder, so there is nothing to check.'); }
  else if (r.verdict === 'unchecked') { say('SkyUI\'s script does not compare menu versions, so no menu can mismatch it.'); }
  else if (r.verdict === 'ok') { say('Every menu SkyUI checks is ' + sc.version + ', the version its script wants.'); }
  else if (r.verdict === 'unread') { say('Something could not be read, so this is not certain. See above.'); }
  else {
    say('SkyUI will show ERROR CODE 6 (or 5) on the way in: its script and its menus are from different releases.');
    if (sc && /^loose/.test(sc.from) && sc.hides) {
      say('The script is a loose ski_main.pex that hides the one in ' + sc.hides.from + '. Take the loose SkyUI scripts out of Data\\Scripts');
      say('(scripts\\release\\Ship-Rules.ps1, $ShipOldSkyUIScripts, lists the ones found so far), then run this again.');
    } else {
      say('Whichever mod ships the menus marked WRONG is overriding SkyUI\'s own: set SkyUI to win that conflict in Vortex, or remove the other mod.');
    }
  }
  return out;
}

/*
  Whether an archive holds anything this check can read: SkyUI's script
  (scripts\ski_main.pex) or any menu under interface. Install-NexusRevision
  -KeepPlugins keeps those archives of a revision, and no other, so the box
  can run this check on a revision that is not on any machine (#4069). An
  archive that will not read is kept too: the check says what it could not
  read, which is a refusal, never a pass.
*/
function holdsInput(file) {
  let got;
  try { got = archiveIndex(file); } catch (e) { return true; }
  return Object.keys(got).some(function (k) {
    return k === 'scripts\\ski_main.pex' || (k.indexOf('interface\\') === 0 && /\.swf$/.test(k));
  });
}

module.exports = {
  archiveIndex: archiveIndex, fileFinder: fileFinder, readSkyUIScript: readSkyUIScript,
  swfBody: swfBody, readMenu: readMenu, check: check, report: report, holdsInput: holdsInput
};

function main(args) {
  // --holding <archive> ...: prints each archive that holds anything the
  // check reads (holdsInput), one per line, and exits 0.
  const holding = args.indexOf('--holding');
  if (holding >= 0) {
    args.slice(holding + 1).forEach(function (f) { if (holdsInput(f)) { console.log(f); } });
    return 0;
  }
  const opt = function (name, def) {
    const at = args.indexOf('--' + name);
    return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : def;
  };
  const data = opt('data', 'C:\\Thornswood\\Game\\Data');
  const plugins = opt('plugins', path.join(data, '..', '..', 'Profile', 'OwnGame', 'plugins.txt'));
  if (!fs.existsSync(data)) { console.error('FAIL  no Data folder at ' + data); return 1; }
  if (!fs.existsSync(plugins)) { console.error('FAIL  no plugins.txt at ' + plugins); return 1; }
  const gone = opt('gone', '').split(';').map(function (g) { return g.trim(); }).filter(Boolean);
  const r = check({ data: data, plugins: plugins, gone: gone });
  report(r, args.indexOf('--quiet') !== -1).forEach(function (l) { console.log(l); });
  return r.code;
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
