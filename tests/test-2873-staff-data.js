'use strict';
// #2873: the staff files under game/data reach the gamemode on the servers.
//
// The server runs gamemode.js from a copy in its own temp folder, and the
// gamemode artifact is that one file, so nothing under game/data is beside
// it there. Measured on dev, 19 Oct: thalmor-patrols.json, property-word.json
// and furniture.json all "would not read ... ENOENT ... Temp\skymp5-server...".
// scripts/dev/Build-StaffData.js now carries the three inside gamemode.js as
// STAFF_DATA, and each reader takes its file from there. merchant-traders.json
// joined them for first steps' Cook (#5137).
//
// This harness runs the readers the way the server does: from a folder with
// no data beside them. It fails when STAFF_DATA is stale, when a reader opens
// game/data without looking at STAFF_DATA first, and when the gamemode starts
// reading another game/data file at run time that nothing carries.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const cp = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8')).split('\r\n').join('\n');
const BUILD = require(path.join(ROOT, 'scripts', 'dev', 'Build-StaffData.js'));

let passed = 0, failed = 0;
function yes(name, ok, extra) {
  if (ok) { passed++; console.log('PASS  ' + name); } else { failed++; console.log('FAIL  ' + name + (extra ? '\n      ' + extra : '')); }
}
function file(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', name), 'utf8').replace(/^﻿/, ''));
}
// A disk with no data folder: every read is ENOENT, as on the server.
const noDisk = {
  readFileSync(p) { const e = new Error('ENOENT: no such file or directory, open ' + p); e.code = 'ENOENT'; throw e; }
};
function between(startText, endText, from) {
  const a = gm.indexOf(startText, from || 0);
  const b = a < 0 ? -1 : gm.indexOf(endText, a);
  return a < 0 || b < 0 ? null : gm.slice(a, b + endText.length);
}

// ------------------------------------------------------------ the line
const built = cp.spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dev', 'Build-StaffData.js'), '--check'], { encoding: 'utf8' });
yes('S1 Build-StaffData.js --check passes', built.status === 0, (built.stdout + built.stderr).trim());

const lines = gm.match(/^const STAFF_DATA = .*;$/gm) || [];
yes('S2 gamemode.js has exactly one STAFF_DATA line', lines.length === 1, 'found ' + lines.length);
const box = {};
vm.createContext(box);
vm.runInContext(lines[0] ? lines[0].replace(/^const /, 'globalThis.') : 'globalThis.STAFF_DATA = null;', box);
const SD = box.STAFF_DATA;
yes('S2 it carries exactly ' + BUILD.FILES.join(', '),
    !!SD && JSON.stringify(Object.keys(SD).sort()) === JSON.stringify(BUILD.FILES.slice().sort()));
BUILD.FILES.forEach(function (name) {
  yes('S3 STAFF_DATA["' + name + '"] is game/data/' + name, !!SD && JSON.stringify(SD[name]) === JSON.stringify(file(name)));
});
const firstCode = gm.search(/^(function |var |let |mp\.|\(function)/m);
yes('S4 the line is set before any code runs (it sits with the other inlined data at the top)',
    gm.indexOf(lines[0]) > 0 && gm.indexOf(lines[0]) < firstCode);

// ------------------------------------- every run-time game/data read is carried
// Each file the gamemode opens out of its own data folder, and what carries it
// on the server. A new one fails here until it is carried.
// merchant-traders.json was listed here as env.catalog until #5137: that is
// only the merchant install's own copy, and first steps read the file from
// beside the gamemode, so on a server it found no Cook. It is in STAFF_DATA now.
const CARRIED_ELSEWHERE = {
  'guild-sites.json': 'MERCHANT_GUILD_SITES, written by Build-MerchantGamemode.js'
};
const reads = new Set();
gm.replace(/'data',\s*'([^']+\.json)'/g, function (m, name) { reads.add(name); return m; });
const loose = [...reads].filter(n => BUILD.FILES.indexOf(n) < 0 && !CARRIED_ELSEWHERE[n]);
yes('S5 every game/data file the gamemode opens at run time is carried inside it', loose.length === 0, 'not carried: ' + loose.join(', '));
BUILD.FILES.forEach(function (name) {
  const re = new RegExp("STAFF_DATA\\['" + name.replace('.', '\\.') + "'\\]\\)\\)\\s*:\\s*JSON\\.parse\\(fs\\.readFileSync\\(path\\.join\\([^)]*'data', '" + name.replace('.', '\\.') + "'");
  yes('S6 the ' + name + ' reader looks at STAFF_DATA before game/data', re.test(gm));
});

// ------------------------------------------------- the readers, run as the server
// furniture.json: the catalog the furniture block hands to its core.
{
  const fb = between('// ==== thornswood furniture ====', '// ==== end thornswood furniture ====');
  const fn = fb && between('  function catalog() {', '\n    return doc;\n  }', gm.indexOf('// ==== thornswood furniture ===='));
  const ctx = { fs: noDisk, path: path.posix, __dirname: 'temp', JSON: JSON, String: String };
  vm.createContext(ctx);
  let doc = null, err = '';
  try { vm.runInContext('var STAFF_DATA = ' + JSON.stringify(SD) + ';\n' + fn + '\nglobalThis.out = catalog();', ctx); doc = ctx.out; }
  catch (e) { err = String(e && e.message); }
  const want = file('furniture.json');
  yes('R1 with no data folder the furniture catalog comes from STAFF_DATA, every piece with its item', !!doc &&
      doc.pieces.length === want.pieces.length && doc.pieces.every(r => r.itemDesc === String(r.item) + ':Thornswood-Content.esp'), err);
  yes('R1 the catalog is a copy: STAFF_DATA itself is not written to',
      !!doc && (ctx.STAFF_DATA['furniture.json'].pieces || []).every(r => r.itemDesc === undefined));
  let threw = false;
  try { vm.runInContext('delete globalThis.STAFF_DATA; STAFF_DATA = undefined; catalog();', ctx); } catch (e) { threw = /ENOENT/.test(String(e && e.message)); }
  yes('R1 without STAFF_DATA and no data folder it fails the way the server did (ENOENT)', threw);
}
// property-word.json: the limits on word to a holder.
{
  const fn = between('  var WORD_DEFAULTS = {', '    wordRulesRead = out;\n    return out;\n  }');
  // The shipped numbers equal WORD_DEFAULTS, so the run marks one to tell them apart.
  const marked = JSON.parse(JSON.stringify(SD || {}));
  if (marked['property-word.json']) marked['property-word.json'].perHolderPerDay = 9;
  function run(withData) {
    const logs = [];
    const ctx = { require: n => (n === 'fs' ? noDisk : n === 'path' ? path.posix : null), __dirname: 'temp', JSON: JSON, Object: Object,
      isFinite: isFinite, plog: function () { logs.push(Array.prototype.join.call(arguments, ' ')); } };
    vm.createContext(ctx);
    vm.runInContext((withData ? 'var STAFF_DATA = ' + JSON.stringify(marked) + ';\n' : '') + fn + '\nglobalThis.out = wordRules();', ctx);
    return { out: ctx.out, logs: logs };
  }
  const on = run(true), off = run(false);
  const want = file('property-word.json');
  yes('R2 with no data folder the word limits come from STAFF_DATA, not the defaults',
      on.logs.length === 0 && on.out.perHolderPerDay === 9 &&
      ['pick', 'deed'].every(k => JSON.stringify(on.out[k]) === JSON.stringify(want[k])),
      on.logs.join(' | ') + ' perHolderPerDay=' + (on.out && on.out.perHolderPerDay));
  yes('R2 without STAFF_DATA and no data folder it falls back to the defaults and says so',
      off.logs.some(l => /would not read, so the limits are the defaults/.test(l)));
}
// merchant-traders.json: first steps' traders by town and role, read at load
// to find the start town's Cook for the first errand (#3459, #5137).
{
  const fn = between('  var TRADERS = {};\n  (function readTraders() {', '\n  })();');
  function run(withData) {
    const logs = [];
    const ctx = { require: n => (n === 'fs' ? noDisk : n === 'path' ? path.posix : null), __dirname: 'temp', JSON: JSON, Object: Object, String: String,
      flog: function () { logs.push(Array.prototype.join.call(arguments, ' ')); } };
    vm.createContext(ctx);
    vm.runInContext((withData ? 'var STAFF_DATA = ' + JSON.stringify(SD) + ';\n' : '') + (fn || '') + '\nglobalThis.out = TRADERS;', ctx);
    return { out: ctx.out, logs: logs };
  }
  const want = file('merchant-traders.json').byRef;
  const cooks = Object.keys(want).filter(r => want[r].role === 'Cook');
  let on = null, off = null, err = '';
  try { on = run(true); off = run(false); } catch (e) { err = String(e && e.message); }
  yes('R4 with no data folder first steps finds every town\'s Cook in STAFF_DATA (' + cooks.length + ' Cooks)', !!fn && !!on &&
      on.logs.length === 0 && cooks.every(r => on.out[want[r].bookHold] && on.out[want[r].bookHold].Cook && on.out[want[r].bookHold].Cook.ref === r),
      err || (on && on.logs.join(' | ')));
  yes('R4 without STAFF_DATA and no data folder it says it could not read the traders, as the server did',
      !!off && off.logs.some(l => /could not read data\\merchant-traders\.json/.test(l)), off && off.logs.join(' | '));
}
// thalmor-patrols.json is run in tests/test-1390-thalmor-patrols.js (K2b, K2c),
// which drives the whole keeper with no data folder.
const tp = fs.readFileSync(path.join(__dirname, 'test-1390-thalmor-patrols.js'), 'utf8');
yes('R3 the patrol keeper is run with no data folder in test-1390-thalmor-patrols.js', /K2b with no data folder/.test(tp));

// ------------------------------------------------------------ on the gate
const gx = fs.readFileSync(path.join(ROOT, 'tests', 'gate-excluded.txt'), 'utf8');
yes('G1 this harness is on the gate of build.yml and build-pr.yml (not in tests/gate-excluded.txt, #3009)', !/^test-2873-staff-data\.js\s/m.test(gx));

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
