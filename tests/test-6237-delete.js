// tests/test-6237-delete.js
//
// A deletion request (#2351) on a game server whose world is kept in MongoDB
// (#6237).
//
// HOW. Always:
//   1. Server-Log.js's --people is refused for a folder whose world is not in
//      MongoDB, and for ids that are not ids.
//   2. A read-out a tool left (world-mongo-<stamp>) is aged out after 30 days
//      like every other copy set aside, and a newer one is kept.
// With THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI (a mongod that
// takes writes to thornswood-wtestd), without them that prints SKIP:
//   3. Delete-Person.ps1's own node part (the text between $core = @' and
//      '@, run as the script runs it) finds the person's character in the
//      live server's database through server-log.js beside it, counts it,
//      names its form id in the list the server takes at its next start, and
//      leaves the database alone; a copy in a tool's read-out goes at once.
//   4. The server's start (startDeletions) takes it out of the database and
//      leaves everyone else's forms, and the list's part "saves" is marked.
//   5. A database it cannot sign in to stops Delete-Person with nothing
//      written, and leaves the server's part waiting.
// Any platform. A few seconds.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

let pass = 0;
let fail = 0;
function yes(what, ok) {
  if (ok) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}

const repo = path.join(__dirname, '..');
const serverLog = path.join(repo, 'scripts', 'vps', 'Server-Log.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-6237d-'));
const node = process.execPath;

try {
  // ---- 1. --people refuses --------------------------------------------------
  const fileWorld = path.join(tmp, 'file-server');
  fs.mkdirSync(fileWorld);
  fs.writeFileSync(path.join(fileWorld, 'server-settings.json'), '{"databaseName":"world"}');
  let r = childProcess.spawnSync(node, [serverLog, '--people', '5001'], { cwd: fileWorld, encoding: 'utf8' });
  yes('--people says a world kept in files is not in MongoDB (exit 2)', r.status === 2 && /NOT MONGODB/.test(r.stdout));
  r = childProcess.spawnSync(node, [serverLog, '--people', '50x1'], { cwd: fileWorld, encoding: 'utf8' });
  yes('--people refuses what is not a profile id', r.status === 1 && /WORLD FAILED: --people takes profile ids/.test(r.stdout));

  // ---- 2. a read-out's age ----------------------------------------------------
  const sl = require(serverLog);
  const aged = path.join(tmp, 'aged');
  fs.mkdirSync(aged);
  fs.writeFileSync(path.join(aged, 'server-settings.json'), '{"databaseDriver":"mongodb","databaseName":"thornswood-wtestd"}');
  fs.mkdirSync(path.join(aged, 'world-mongo-20261001-120000', 'changeForms', '_discarded-20261001-120000'), { recursive: true });
  fs.mkdirSync(path.join(aged, 'world-mongo-20261110-120000', 'changeForms'), { recursive: true });
  const said = sl.ageAside(aged, new Date(2026, 10, 16, 12, 0, 0).getTime());
  yes('a read-out set aside more than 30 days ago is deleted', !fs.existsSync(path.join(aged, 'world-mongo-20261001-120000')) && said.some((l) => /deleted world-mongo-20261001-120000/.test(l)));
  yes('and a newer one is kept', fs.existsSync(path.join(aged, 'world-mongo-20261110-120000')));

  // ---- with a MongoDB -----------------------------------------------------------
  const shell = process.env.THORNSWOOD_TEST_MONGOSH;
  const uri = process.env.THORNSWOOD_TEST_MONGO_URI;
  if (!shell || !uri || !fs.existsSync(shell)) {
    console.log('SKIP  a deletion in a MongoDB world: set THORNSWOOD_TEST_MONGOSH and THORNSWOOD_TEST_MONGO_URI');
  } else {
    const db = 'thornswood-wtestd';
    const dbUri = uri.replace(/\/\?/, '/' + db + '?');
    const mongo = (js) => childProcess.spawnSync(shell, ['--quiet', dbUri, '--eval', js], { encoding: 'utf8' });
    const uriFile = path.join(tmp, 'live.uri');
    fs.writeFileSync(uriFile, uri);
    try {
      mongo('db.dropDatabase(); db.changeForms.insertMany([' +
        '{ formDesc: "a01", profileId: 5001, recType: 1, isDeleted: false },' +
        '{ formDesc: "a02", profileId: NumberLong(5002), recType: 1, isDeleted: false },' +
        '{ formDesc: "a03", profileId: 7, recType: 1, isDeleted: false },' +
        '{ formDesc: "3eb15:Skyrim.esm", profileId: -1 }])');
      const discord = '123456789012345678';
      const site = path.join(tmp, 'site');
      fs.mkdirSync(path.join(site, 'data'), { recursive: true });
      fs.writeFileSync(path.join(site, 'data', 'linked.json'), JSON.stringify({ [discord]: { profiles: [5001, 5002] }, '223456789012345678': { profiles: [7] } }));
      const live = path.join(tmp, 'Thornswood-Server');
      fs.mkdirSync(path.join(live, 'private'), { recursive: true });
      fs.copyFileSync(serverLog, path.join(live, 'server-log.js'));
      const settings = (u) => JSON.stringify({ databaseDriver: 'mongodb', databaseName: db, databaseUriFile: u });
      fs.writeFileSync(path.join(live, 'server-settings.json'), settings(uriFile));
      // A tool's read-out, saved: only what it set aside is left in it.
      const aside = path.join(live, 'world-mongo-20261115-100000', 'changeForms', '_discarded-20261115-100000');
      fs.mkdirSync(aside, { recursive: true });
      fs.writeFileSync(path.join(aside, 'a01.json'), JSON.stringify({ formDesc: 'a01', profileId: 5001 }));
      fs.writeFileSync(path.join(aside, 'a03.json'), JSON.stringify({ formDesc: 'a03', profileId: 7 }));

      const ps = fs.readFileSync(path.join(repo, 'scripts', 'vps', 'Delete-Person.ps1'), 'utf8');
      const core = /\$core = @'\r?\n([\s\S]*?)\r?\n'@/.exec(ps)[1];
      const coreFile = path.join(tmp, 'core.js');
      fs.writeFileSync(coreFile, core);
      const plan = (mode) => {
        const f = path.join(tmp, mode + '.json');
        fs.writeFileSync(f, JSON.stringify({
          mode, now: Date.now(), people: [{ discordId: discord, profiles: [] }], site,
          servers: [{ tag: 'live', root: live }, { tag: 'dev', root: path.join(tmp, 'no-dev') }],
          voices: [{ tag: 'live', root: path.join(tmp, 'no-voice') }, { tag: 'dev', root: path.join(tmp, 'no-dev-voice') }],
          bot: path.join(tmp, 'no-bot')
        }));
        return f;
      };
      const env = Object.assign({}, process.env, { THORNSWOOD_MONGOSH: shell });
      const runCore = (mode) => childProcess.spawnSync(node, [coreFile, plan(mode)], { encoding: 'utf8', env });
      const person = (out) => { const l = out.split(/\r?\n/).find((x) => x.indexOf('PERSON|') === 0); return l ? JSON.parse(l.slice(7)) : null; };
      const count = () => mongo('print(db.changeForms.countDocuments({}) + "|" + db.changeForms.countDocuments({ profileId: { $in: [5001, 5002] } }))').stdout.trim();

      // ---- 3. Delete-Person
      let out = runCore('plan');
      let p = person(out.stdout);
      yes('a dry run counts their two characters in the database', !!p && p.removed['live game server: characters in ' + db] === 2);
      yes('and changes nothing', count() === '4|2' && fs.existsSync(path.join(aside, 'a01.json')) && !fs.existsSync(path.join(live, 'private', 'deleted-characters.json')));
      out = runCore('apply');
      p = person(out.stdout);
      yes('a real run finishes (DONE)', /DONE\|/.test(out.stdout) && !!p);
      const list = JSON.parse(fs.readFileSync(path.join(live, 'private', 'deleted-characters.json'), 'utf8'));
      yes('the list the server takes at its next start names them and their characters\' form ids',
        JSON.stringify(list.profiles) === '[5001,5002]' && JSON.stringify(list.actors) === JSON.stringify([0xff000a01, 0xff000a02]));
      yes('the database, the live server\'s, is left for the server to change', count() === '4|2');
      yes('their copy in a tool\'s read-out goes at once, and another\'s stays', !fs.existsSync(path.join(aside, 'a01.json')) && fs.existsSync(path.join(aside, 'a03.json')));

      // ---- 4. the server's start
      const prev = process.env.THORNSWOOD_MONGOSH;
      process.env.THORNSWOOD_MONGOSH = shell;
      delete require.cache[require.resolve(serverLog)];
      const sl2 = require(serverLog);
      let lines = sl2.startDeletions(live, Date.now());
      yes('the server\'s start takes their characters out of the database', count() === '2|0' && lines.some((l) => /saves: characters 2/.test(l)));
      const still = mongo('print(db.changeForms.find({}, { _id: 0, formDesc: 1 }).sort({ formDesc: 1 }).toArray().map((d) => d.formDesc).join(","))').stdout.trim();
      yes('and leaves everyone else\'s forms', still === '3eb15:Skyrim.esm,a03');
      const taken = path.join(live, 'private', 'deleted-characters.taken.json');
      const marked = fs.existsSync(taken) ? JSON.parse(fs.readFileSync(taken, 'utf8')) : null;
      yes('and marks the part "saves" done', !!marked && !!marked.done && marked.done.saves > 0);

      // ---- 5. a database it cannot sign in to
      fs.rmSync(taken, { force: true });
      fs.writeFileSync(path.join(live, 'private', 'deleted-characters.json'), JSON.stringify({ profiles: [7], actors: [] }));
      fs.writeFileSync(path.join(live, 'server-settings.json'), settings(path.join(tmp, 'none.uri')));
      lines = sl2.startDeletions(live, Date.now());
      yes('a start that cannot reach the database says so and the part waits', lines.some((l) => /were not taken out/.test(l)) && lines.some((l) => /the part waits/.test(l)));
      yes('and nothing of theirs is gone', mongo('print(db.changeForms.countDocuments({ profileId: 7 }))').stdout.trim() === '1');
      fs.rmSync(path.join(live, 'private', 'deleted-characters.json'), { force: true });
      fs.rmSync(taken, { force: true });
      out = runCore('apply');
      yes('Delete-Person stops, with nothing written, when the database cannot be asked',
        /STOP\|the characters in thornswood-wtestd could not be looked for/.test(out.stdout) && !fs.existsSync(path.join(live, 'private', 'deleted-characters.json')));
      if (prev === undefined) delete process.env.THORNSWOOD_MONGOSH; else process.env.THORNSWOOD_MONGOSH = prev;
    } finally {
      mongo('db.dropDatabase()');
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
