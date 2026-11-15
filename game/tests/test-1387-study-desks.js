// test-1387-study-desks.js
//
// #1387: a semester at the College is taken at a study desk in the College
// halls, not a command (Patrick, 22 Oct 2026, A). Skyrim's desks are
// statics, which raise no activation, so Thornswood-Content.esp has a study
// desk activator wearing NobleDesk01 and stands one in each of the four
// halls where scripts/dev/Build-StationSites.py finds a clear spot
// (game/data/station-sites.json, kind study). The college block's
// deskActivated answers a press of that base, and mp.onActivate asks it.
//
// Root cause: the semester was the Study button on the K panel, which works
// anywhere in five rooms; nothing in the halls was the place a semester is
// taken.
//
// Reads the committed table, plugin and gamemode. Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
let pass = 0, fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
const sites = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'station-sites.json'), 'utf8'));
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8');
const esp = fs.readFileSync(path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp'));
const DESK = '18032:Thornswood-Content.esp';
const HALLS = { '1380e:Skyrim.esm': 'the Hall of the Elements', '1380f:Skyrim.esm': 'the Hall of Countenance',
                'cab91:Skyrim.esm': 'the Hall of Attainment', '13810:Skyrim.esm': 'the Arcanaeum' };

// Every record in the plugin: tag, form id, subrecords.
const recs = [];
(function walk(s, e) {
  while (s < e) {
    const tag = esp.toString('latin1', s, s + 4), size = esp.readUInt32LE(s + 4);
    if (tag === 'GRUP') { walk(s + 24, s + size); s += size; continue; }
    const subs = {}; let k = s + 24;
    if (!(esp.readUInt32LE(s + 8) & 0x40000)) {
      while (k + 6 <= s + 24 + size) {
        const t = esp.toString('latin1', k, k + 4), n = esp.readUInt16LE(k + 4);
        subs[t] = esp.slice(k + 6, k + 6 + n); k += 6 + n;
      }
    }
    recs.push({ tag: tag, fid: esp.readUInt32LE(s + 12), subs: subs });
    s += 24 + size;
  }
})(24 + esp.readUInt32LE(4), esp.length);

const acti = recs.find(function (r) { return r.tag === 'ACTI' && r.fid === 0x5018032; });
yes('the plugin has the study desk activator', !!acti && String(acti.subs.EDID).indexOf('ThornswoodActivatorStudyDesk') === 0);
yes('wearing Skyrim\'s NobleDesk01, and the crosshair says Study', !!acti &&
  String(acti.subs.MODL).indexOf('Furniture\\Noble\\NobleDesk01.nif') === 0 && String(acti.subs.RNAM).indexOf('Study') === 0 &&
  String(acti.subs.FULL).indexOf('Study Desk') === 0);

const rows = Object.keys(sites.sites).filter(function (k) { return sites.sites[k].kind === 'study'; }).map(function (k) { return sites.sites[k]; });
const left = Object.keys(sites.skipped).filter(function (k) { return sites.skipped[k].kind === 'study'; });
yes('the table has the kind, with its rule naming Patrick\'s A', !!sites.kinds.study && sites.kinds.study.base === DESK &&
  /study desk in the College halls/.test(sites.kinds.study.rule) && sites.kinds.study.count === rows.length);
yes('one desk for each of the four halls, placed or left out with why (' + rows.length + ' + ' + left.length + ')',
  rows.length > 0 && rows.length + left.length === 4 &&
  left.every(function (k) { return (sites.skipped[k].triedAnchors || []).length > 0; }));
yes('each desk stands indoors, in its own hall, every hall once', rows.every(function (r) {
  return r.interior === true && r.base === DESK && Object.prototype.hasOwnProperty.call(HALLS, r.cell) && r.space === r.cell &&
    /^Noble(Table(Square|Round|Thin)01|Bench01)$/.test(r.anchorEdid);
}) && new Set(rows.map(function (r) { return r.cell; })).size === rows.length);
const placed = recs.filter(function (r) { return r.tag === 'REFR' && r.subs.NAME && r.subs.NAME.readUInt32LE(0) === 0x5018032; });
yes('the plugin places one desk for each row (' + placed.length + ')', placed.length === rows.length &&
  rows.every(function (r) { return placed.some(function (p) { return p.fid === ((5 << 24) | parseInt(r.ref, 16)); }); }));

// The server: the desk's base, the halls, and the press.
yes('the college block knows the desk by its base, and the four halls by their cells',
  /var DESK_BASE = '18032:Thornswood-Content\.esp';/.test(gm) &&
  Object.keys(HALLS).every(function (c) { return gm.indexOf("'" + c + "': '" + HALLS[c] + "'") !== -1; }));
yes('mp.onActivate asks the college block about every press, says its line and ends the press',
  /collegeDesk\.deskActivated\(refrId, casterRefrId, baseDesc\)/.test(gm) &&
  /if \(deskLine !== null\) \{\s*notify\(casterRefrId, deskLine\);\s*say\(casterRefrId, deskLine\);\s*return false;/.test(gm));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
