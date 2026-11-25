// tests/test-6237-load.js
//
// The load test on a server whose world is kept in MongoDB (#6237).
//
// HOW. Always:
//   1. Load-Test.js reads where the engine kept the world and its saver's
//      line a minute out of the server's log, and the summary says both;
//      a log with no save line says so.
//   2. Load-Box.ps1 gives the copy the load test's own database when the
//      server's world is in MongoDB, and empties it before the copy starts
//      and as the copy goes.
// With THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI (a mongod that
// takes writes to thornswood-load and thornswood-wtestl), without them that
// prints SKIP:
//   3. world.js empties the load test's database, and refuses to empty any
//      other but the rehearsal's.
// Any platform. A second.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');
const { saveLines, markdown } = require('../scripts/bot/Load-Test.js');

let pass = 0;
let fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-6237l-'));

try {
  // ---- 1. the server's log -----------------------------------------------
  const log = path.join(tmp, 'load-test-server.log');
  fs.writeFileSync(log, [
    '[2026-11-16 12:00:01.000] [info] Using mongodb with name \'thornswood-load\'',
    '[2026-11-16 12:01:01.500] [info] Saves in the last 60 s: 12 batch(es), 340 form(s), 85.3 ms writing, slowest batch 21.4 ms, most batches waiting 2',
    'a line of the gamemode',
    '[2026-11-16 12:02:01.600] [info] Saves in the last 61 s: 30 batch(es), 1500 form(s), 400.0 ms writing, slowest batch 52.0 ms, most batches waiting 4',
    ''].join('\n'));
  const w = saveLines(log);
  yes('the world is read off the engine\'s own line', w.world === 'mongodb thornswood-load');
  yes('each minute\'s saves are read, with its time', w.saves.length === 2 && w.saves[1].at === '2026-11-16 12:02:01' && w.saves[1].seconds === 61 &&
    w.saves[1].batches === 30 && w.saves[1].forms === 1500 && w.saves[1].writingMs === 400 && w.saves[1].slowestMs === 52 && w.saves[1].waiting === 4);
  const doc = { shape: 'crowd', started: 'now', engine: 'e', blob: '0123456789abcdef', cores: 4, steps: [], world: w };
  const md = markdown(doc);
  yes('the summary says where the world was kept and each minute\'s saves', md.includes('The world was kept in mongodb thornswood-load.') &&
    md.includes('| 2026-11-16 12:02:01 | 61 | 30 | 1500 | 400.0 | 52.0 | 4 |'));
  fs.writeFileSync(log, '[2026-11-16 12:00:01.000] [info] Using file with name \'world\'\n');
  const none = markdown(Object.assign({}, doc, { world: saveLines(log) }));
  yes('a log with no save line says no minute had a save', none.includes('The world was kept in file world.') && none.includes('no line, so no minute had a save'));
  yes('a log that is not there is said, not read as no saves', /could not be read/.test(saveLines(path.join(tmp, 'none.log')).problem));

  // ---- 2. Load-Box.ps1 ----------------------------------------------------
  const box = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'bot', 'Load-Box.ps1'), 'utf8');
  const before = box.indexOf('$e = Clear-ThornswoodScratchWorld $loadWorld');
  const copy = box.indexOf("& $node (Join-Path $Here 'New-LoadServer.js')");
  const after = box.lastIndexOf('$e = Clear-ThornswoodScratchWorld $loadWorld');
  const fin = box.indexOf('} finally {');
  yes('Load-Box.ps1 gives the copy the load test\'s own database only when the server\'s world is in MongoDB',
    box.includes("if ($theirs.Driver -eq 'mongodb') {") && box.includes("Where-Object { $_.User -eq [string]$rec.load.user }") &&
    box.includes("$worldArgs = @('--world-db', $lu.Db, '--world-uri', $lu.File)") && box.includes('--voice-port ([string]$VoicePort) @worldArgs'));
  yes('  empties it before the copy starts, and stops when it cannot', before > 0 && before < copy && box.includes("Stop-Run ($e.Substring(5) + ', so the copy would not start on an empty world')"));
  yes('  and again as the copy goes, whatever the run did', after > fin && after !== before);

  // ---- 3. world.js empty ----------------------------------------------------
  const shell = process.env.THORNSWOOD_TEST_MONGOSH;
  const uri = process.env.THORNSWOOD_TEST_MONGO_URI;
  if (!shell || !uri || !fs.existsSync(shell)) {
    console.log('SKIP  emptying the load test\'s database: set THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI');
  } else {
    const uriFile = path.join(tmp, 'test.uri');
    fs.writeFileSync(uriFile, uri);
    const mongo = (db, js) => childProcess.spawnSync(shell, ['--quiet', uri.replace(/\/\?/, '/' + db + '?'), '--eval', js], { encoding: 'utf8' }).stdout.trim();
    const empty = (db) => {
      const plan = path.join(tmp, 'plan.json');
      fs.writeFileSync(plan, JSON.stringify({ op: 'empty', uri: uriFile, db }));
      return childProcess.spawnSync(shell, ['--nodb', '--quiet', '--file', path.join(__dirname, '..', 'scripts', 'vps', 'world.js')],
        { encoding: 'utf8', env: Object.assign({}, process.env, { THORNSWOOD_WORLD_PLAN: plan }) });
    };
    try {
      mongo('thornswood-load', 'db.dropDatabase(); db.changeForms.insertMany([{ formDesc: "a01", profileId: 1 }, { formDesc: "a02", profileId: 2 }])');
      mongo('thornswood-wtestl', 'db.dropDatabase(); db.changeForms.insertOne({ formDesc: "a01", profileId: 1 })');
      let r = empty('thornswood-load');
      yes('world.js empties the load test\'s database', r.status === 0 && /EMPTIED\|2/.test(r.stdout) && mongo('thornswood-load', 'print(db.changeForms.countDocuments({}))') === '0');
      r = empty('thornswood-wtestl');
      yes('and refuses any other but the rehearsal\'s, with nothing dropped', r.status === 1 && /only the rehearsal's and the load test's worlds/.test(r.stdout) &&
        mongo('thornswood-wtestl', 'print(db.changeForms.countDocuments({}))') === '1');
    } finally {
      mongo('thornswood-load', 'db.dropDatabase()');
      mongo('thornswood-wtestl', 'db.dropDatabase()');
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
