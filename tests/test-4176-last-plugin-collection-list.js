// test-4176-last-plugin-collection-list.js
//
//     node tests/test-4176-last-plugin-collection-list.js
//
// tests\test-2468-last-plugin.js holds Thornswood-Last.esp's record of the
// plugins it was built against (game\data\last-plugin.json "builtAgainst")
// to the collection's record (records\collection-plugins.json). Its B2 asks
// one way only: is every plugin it was built against the collection's bytes?
// A plugin the collection adds is not in the built-against list, so nothing
// asked about it and the harness stayed green (#4176). The NPC catalogue
// (game\data\npc-population.json), which the plugin is built after, had the
// same gap.
//
// HOW. test-2468-last-plugin.js runs as a child with a stand-in collection
// record (THORNSWOOD_COLLECTION_PLUGINS):
//   1. the record names exactly the plugins the manifest was built against:
//      B4 (the plugin) and B5 (the catalogue) pass;
//   2. the record adds one plugin the manifest was not built against: B2
//      still passes, and B4 and B5 fail, naming it.
//
// Everything it writes is in its own temp folder.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const ROOT = path.join(__dirname, '..');
const HARNESS = path.join(__dirname, 'test-2468-last-plugin.js');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'game', 'data', 'last-plugin.json'), 'utf8'));
const real = JSON.parse(fs.readFileSync(path.join(ROOT, 'records', 'collection-plugins.json'), 'utf8'));
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4176-'));
const ADDED = 'Stand-in 4176 Added.esp';

function run(plugins) {
  const rec = path.join(T, 'collection-plugins-' + plugins.length + '.json');
  fs.writeFileSync(rec, JSON.stringify({ version: 1, collection: real.collection, revision: real.revision, plugins: plugins }, null, 2));
  const env = Object.assign({}, process.env, { THORNSWOOD_COLLECTION_PLUGINS: rec });
  const r = spawnSync(process.execPath, [HARNESS], { env: env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { out: (r.stdout || '') + (r.stderr || ''), code: r.status };
}
function line(out, re) { return out.split(/\r?\n/).find((l) => re.test(l)) || ''; }

try {
  // The collection's plugins exactly as the manifest was built against them.
  const same = manifest.builtAgainst.filter((r) => r.name !== 'Thornswood-Content.esp')
    .map((r) => ({ name: r.name, size: r.size, sha256: r.sha256 }));

  // 1. Nothing added.
  const a = run(same);
  yes('a collection record that is the built-against list: B2 passes', /^PASS  B2 /m.test(a.out));
  yes('  B4, the plugin was built against every plugin the collection installs, passes', /^PASS  B4 /m.test(a.out));
  yes('  B5, the NPC catalogue was built from every plugin the collection installs, passes', /^PASS  B5 /m.test(a.out));

  // 2. The collection adds a plugin.
  const added = same.concat([{ name: ADDED, size: 1, sha256: 'a'.repeat(64) }]);
  const b = run(added);
  yes('a collection that adds a plugin: B2 still passes, as it only asks about the built-against list', /^PASS  B2 /m.test(b.out));
  const b4 = line(b.out, /^(PASS|FAIL)  B4 /);
  yes('  B4 fails and names the plugin it was not built against', /^FAIL  B4 /.test(b4) && b4.indexOf(ADDED) >= 0);
  const b5 = line(b.out, /^(PASS|FAIL)  B5 /);
  yes('  B5 fails and names the plugin the catalogue was not built from', /^FAIL  B5 /.test(b5) && b5.indexOf(ADDED) >= 0);
  yes('  and the harness exits 1', b.code === 1);
  if (fail) { console.log(''); console.log(b.out.split(/\r?\n/).filter((l) => /^(FAIL|SKIP)/.test(l)).join('\n')); }
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
