// test-1382-well-buckets.js
//
// #1382: water is drawn at a well by activating it (Patrick, 12 Oct 2026),
// and every placed well in the load order is a static, which raises no
// activation. So Thornswood-Content.esp stands a well bucket, an activator,
// beside each well scripts/dev/Build-StationSites.py finds a clear spot at
// (game/data/station-sites.json, kind well), and NEEDS.wellActivators is that
// bucket.
//
// Root cause: NEEDS.wellActivators was empty because nothing a person could
// activate stood at any well.
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
const wells = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'wells.json'), 'utf8'));
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8');
const esp = fs.readFileSync(path.join(ROOT, 'game', 'content', 'Thornswood-Content.esp'));
const BUCKET = '18030:Thornswood-Content.esp';

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

const acti = recs.find(function (r) { return r.tag === 'ACTI' && r.fid === 0x5018030; });
yes('the plugin has the well bucket activator', !!acti && String(acti.subs.EDID).indexOf('ThornswoodActivatorWellBucket') === 0);
yes('wearing Skyrim\'s wooden bucket, and the crosshair says Draw Water', !!acti &&
  String(acti.subs.MODL).indexOf('Clutter\\Bucket02a.nif') === 0 && String(acti.subs.RNAM).indexOf('Draw Water') === 0);

const rows = Object.keys(sites.sites).filter(function (k) { return sites.sites[k].kind === 'well'; }).map(function (k) { return sites.sites[k]; });
const left = Object.keys(sites.skipped).filter(function (k) { return sites.skipped[k].kind === 'well'; });
yes('every placed well is either given a bucket or left out with why (' + rows.length + ' + ' + left.length + ' of ' +
  Object.keys(wells.placed).length + ')', rows.length + left.length === Object.keys(wells.placed).length);
yes('each left out well says why', left.every(function (k) {
  const v = sites.skipped[k]; return !!v.why || (v.triedAnchors || []).every(function (a) { return !!a.why; });
}));
yes('each bucket stands beside a placed well, within 400 units', rows.length > 0 && rows.every(function (r) {
  return !!wells.placed[r.anchor] && r.base === BUCKET && r.fromAnchor <= 400;
}));
const placed = recs.filter(function (r) { return r.tag === 'REFR' && r.subs.NAME && r.subs.NAME.readUInt32LE(0) === 0x5018030; });
yes('the plugin places one bucket for each row (' + placed.length + ')', placed.length === rows.length &&
  rows.every(function (r) { return placed.some(function (p) { return p.fid === ((5 << 24) | parseInt(r.ref, 16)); }); }));
yes('and the server lists the bucket as the well activator', /wellActivators: \['18030:Thornswood-Content\.esp'\]/.test(gm));

// The water bucket at a river or a lake (Patrick, 12 Oct 2026; and 20 Oct: lake water is a river's).
const water = recs.find(function (r) { return r.tag === 'ACTI' && r.fid === 0x5018031; });
yes('the plugin has the water bucket activator, saying Draw Water', !!water &&
  String(water.subs.EDID).indexOf('ThornswoodActivatorWaterBucket') === 0 && String(water.subs.RNAM).indexOf('Draw Water') === 0);
const banks = Object.keys(sites.sites).filter(function (k) { return sites.sites[k].kind === 'river'; }).map(function (k) { return sites.sites[k]; });
const bankLeft = Object.keys(sites.skipped).filter(function (k) { return sites.skipped[k].kind === 'river'; });
yes('one site for each of the nine towns with a forge, placed or left out (' + banks.length + ' + ' + bankLeft.length + ')',
  banks.length > 0 && banks.length + bankLeft.length === 9);
const onBank = recs.filter(function (r) { return r.tag === 'REFR' && r.subs.NAME && r.subs.NAME.readUInt32LE(0) === 0x5018031; });
yes('the plugin places one water bucket for each row (' + onBank.length + ')', onBank.length === banks.length &&
  banks.every(function (r) { return onBank.some(function (p) { return p.fid === ((5 << 24) | parseInt(r.ref, 16)); }); }));
yes('and the server lists it as the river activator', /riverActivators: \['18031:Thornswood-Content\.esp'\]/.test(gm));

console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
