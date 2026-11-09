'use strict';
/*
  test-4423-builders-collection-plugins.js

      node tests/test-4423-builders-collection-plugins.js

  #4423. The builders that measure the world out of the load order
  (Build-WoodworkingBenches.py, Build-BuildingHolds.py, Build-StationSites.py
  and Build-MarketStalls.py) take the order from game/data/last-plugin.json
  and hold it to records/collection-plugins.json. They asked one way only:
  each plugin they read has to be in the record with the record's bytes. A
  plugin the record lists and the order leaves out was never looked at, so a
  table could be built without a plugin the collection installs and nothing
  said so.

  Each builder runs here against a made-up Data folder: one small plugin for
  every name in the load order, and a stand-in collection record
  (THORNSWOOD_COLLECTION_PLUGINS) naming those plugins at those bytes.

    1. with one more plugin in the record than the load order has, the
       builder stops before it reads anything else and names that plugin;
    2. with the record naming exactly the load order, it does not stop on
       the collection.

  Everything it writes is in its own temp folder.
*/
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DEV = path.join(ROOT, 'scripts', 'dev');
const BUILDERS = ['Build-WoodworkingBenches.py', 'Build-BuildingHolds.py', 'Build-StationSites.py', 'Build-MarketStalls.py'];
const EXTRA = 'Stand-in 4423 Extra.esp';

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

function python(args, env) {
  for (const exe of ['python', 'py', 'python3']) {
    const p = spawnSync(exe, args, { encoding: 'utf8', env: env, maxBuffer: 1 << 26 });
    if (!p.error) { return p; }
  }
  return null;
}

const lastDoc = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin.json'), 'utf8'));
const own = fs.readdirSync(path.join(ROOT, 'game', 'content')).map((n) => n.toLowerCase());
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4423-'));
try {
  // A plugin with a header and nothing else: the builders read it as one with no records.
  const stub = Buffer.alloc(24);
  stub.write('TES4', 0, 'latin1');
  const sha = crypto.createHash('sha256').update(stub).digest('hex');
  const data = path.join(T, 'Data');
  fs.mkdirSync(data);
  const inData = lastDoc.loadOrder.filter((n) => own.indexOf(n.toLowerCase()) < 0);
  for (const n of inData.concat(['Thornswood-Last.esp'])) { fs.writeFileSync(path.join(data, n), stub); }
  const rows = inData.map((n) => ({ name: n, size: stub.length, sha256: sha }));

  function record(file, plugins) {
    const p = path.join(T, file);
    fs.writeFileSync(p, JSON.stringify({ version: 1, collection: '7essxf', revision: 99, plugins: plugins }, null, 2));
    return p;
  }
  const withExtra = record('with-extra.json', rows.concat([{ name: EXTRA, size: stub.length, sha256: sha }]));
  const exact = record('exact.json', rows);

  for (const b of BUILDERS) {
    const tool = path.join(DEV, b);
    const out = (env) => {
      const r = python([tool, '--data', data, '--check'], Object.assign({}, process.env, env));
      return r ? { code: r.status, said: (r.stdout || '') + (r.stderr || '') } : { code: null, said: 'no python' };
    };
    const a = out({ THORNSWOOD_COLLECTION_PLUGINS: withExtra, THORNSWOOD_DATA: data });
    const stop = a.said.split(/\r?\n/).find((l) => /^STOP\./.test(l)) || '';
    yes(b + ': a plugin the collection lists and the load order leaves out stops it, named', a.code !== 0 && stop.indexOf(EXTRA) >= 0);
    if (stop.indexOf(EXTRA) < 0) { console.log('      it said: ' + (stop || a.said.trim().split(/\r?\n/).slice(-3).join(' | '))); }
    const c = out({ THORNSWOOD_COLLECTION_PLUGINS: exact, THORNSWOOD_DATA: data });
    yes(b + ': the load order the record names exactly does not stop it on the collection',
        !/the collection's bytes|the collection installs/.test(c.said));
  }
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
