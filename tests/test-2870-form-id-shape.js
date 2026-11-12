'use strict';
/*
  test-2870-form-id-shape.js

      node tests\test-2870-form-id-shape.js

  Issue #2870. A deleted character's form id was kept two ways: the release
  list and the merchant ledger kept the local hex of a change form's formDesc
  ("a01" as 2561), the embassy rolls, dungeon chests and ship manifests the
  runtime form id (0xff000a01). From #2870 there is one shape, the runtime
  form id, 0xff000000 | local (game\form-id.js). This holds:

    F  formIdOf and isFormId, and every copy of them the same as the original
       (game\form-id.js); the PowerShell twin in scripts\ops\Release-List.ps1
       gives the same number for the same formDesc
    O  every reader refuses the old shape and converts nothing: the
       gamemode's release helper (a log line, nothing let go), the merchant
       purses (a version 1 ledger, naming the alpha reset that replaces it),
       Release-List.ps1 and scripts\vps\Server-Log.js (Delete-Person.ps1's
       refusal is in tests\test-2351-delete-person.ps1)
    V  scripts\ops\Verify-FormIdShape.js, the read only count the deploy runs
       first: a version 1 ledger and old shape list actors are counted, the
       fresh ledger scripts\ops\New-AlphaMerchantLedger.js prints counts as
       version 2 with no old shape, and it writes nothing

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');
const crypto = require('crypto');

const REPO = path.join(__dirname, '..');
const FORM = require(path.join(REPO, 'game', 'form-id.js'));
const VERIFY = path.join(REPO, 'scripts', 'ops', 'Verify-FormIdShape.js');
const V = require(VERIFY);
const COMMISSION = require(path.join(REPO, 'game', 'merchant-commission-state.js'));
const ALPHA = require(path.join(REPO, 'scripts', 'ops', 'New-AlphaMerchantLedger.js'));
const read = (p) => fs.readFileSync(p, 'utf8').split(String.fromCharCode(13)).join('');
const gm = read(path.join(REPO, 'game', 'gamemode.js'));

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-2870-'));
function put(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v));
}
const sha = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const ledgerSum = (version, entries) => sha(JSON.stringify([version, entries]));

const A1 = 0xff000a01, A2 = 0xff000a02;   // 4278192641, 4278192642
const P1 = 5001, P2 = 5002;

try {
  // ---------------------------------------------------------------- F --
  const table = [
    ['1e', 0xff00001e], ['a01', A1], ['A01', A1], ['1', 0xff000001], ['ffffff', 0xffffffff], ['00a01', A1],
    ['0', 0], ['000000', 0], ['1000000', 0], ['ff000a01', 0], ['a01:Skyrim.esm', 0], ['', 0], [' a01', 0],
    ['a01 ', 0], ['-1', 0], ['0x1', 0], ['g1', 0], [null, 0], [undefined, 0], [2561, 0], [{}, 0]
  ];
  yes('F1 formDesc "1e" is the runtime form id 0xff00001e, as measured on a server (#2870)', FORM.formIdOf('1e') === 4278190110);
  const wrong = table.filter((r) => FORM.formIdOf(r[0]) !== r[1]).map((r) => JSON.stringify(r[0]));
  yes('F1 formIdOf gives the runtime form id of a local hex, 0 for anything else' + (wrong.length ? ' (' + wrong.join(', ') + ')' : ''), !wrong.length);
  const ids = [[0xff000000, false], [0xff000001, true], [A1, true], [0xffffffff, true], [0x100000000, false],
    [2561, false], [0, false], [-A1, false], [A1 + 0.5, false], [String(A1), false], [null, false]];
  const wrongIds = ids.filter((r) => FORM.isFormId(r[0]) !== r[1]).map((r) => String(r[0]));
  yes('F1 isFormId takes 0xff000001 to 0xffffffff, a whole number, and nothing else' + (wrongIds.length ? ' (' + wrongIds.join(', ') + ')' : ''), !wrongIds.length);

  // Every copy, line for line once its indent is taken off.
  const body = (text, name) => {
    const out = [];
    let at = 0;
    for (;;) {
      const a = text.indexOf('function ' + name + '(', at);
      if (a < 0) return out;
      const lines = text.slice(a).split('\n');
      const end = lines.findIndex((l) => l.trim() === '}');
      out.push(lines.slice(0, end + 1).map((l) => l.replace(/^\s+/, '')).join('\n'));
      at = a + 1;
    }
  };
  const original = read(path.join(REPO, 'game', 'form-id.js'));
  const want = { formIdOf: body(original, 'formIdOf')[0], isFormId: body(original, 'isFormId')[0] };
  yes('F2 game\\form-id.js has the original of each', !!want.formIdOf && !!want.isFormId && body(original, 'formIdOf').length === 1);
  const copies = [
    ['game/gamemode.js', 3, 3],                      // the release helper, the purses, the bundled commission state
    ['game/merchant-commission-state.js', 1, 1],
    ['scripts/vps/Delete-Person.ps1', 1, 1],
    ['scripts/vps/Server-Log.js', 0, 1],
    ['scripts/ops/Verify-FormIdShape.js', 1, 1]
  ];
  for (const [file, nf, ni] of copies) {
    const text = read(path.join(REPO, file));
    const f = body(text, 'formIdOf'), i = body(text, 'isFormId');
    yes('F2 ' + file + ' holds ' + nf + ' formIdOf and ' + ni + ' isFormId, each the same as game\\form-id.js',
        f.length === nf && i.length === ni && f.every((s) => s === want.formIdOf) && i.every((s) => s === want.isFormId));
  }

  // The PowerShell twin, on the same table.
  const strings = table.filter((r) => typeof r[0] === 'string');
  const ps1 = path.join(REPO, 'scripts', 'ops', 'Release-List.ps1');
  const q = (s) => "'" + String(s).split("'").join("''") + "'";
  function pwsh(script) {
    const r = cp.spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
    return { ok: !r.error && r.status === 0, out: (r.stdout || '').split(/\r?\n/).filter(Boolean), err: (r.error && r.error.message) || r.stderr || '' };
  }
  const dot = '. ' + q(ps1) + '; . ([scriptblock]::Create($ThornswoodReleaseList)); ';
  const twin = pwsh(dot + 'foreach ($d in @(' + strings.map((r) => q(r[0])).join(',') + ')) { [string](ConvertFrom-ThornswoodFormDesc $d) }; ' +
    '[string](ConvertFrom-ThornswoodFormDesc $null); [string](ConvertFrom-ThornswoodFormDesc 2561)');
  const twinWant = strings.map((r) => String(r[1])).concat(['0', '0']);
  yes('F3 ConvertFrom-ThornswoodFormDesc (Release-List.ps1) gives what formIdOf gives, formDesc by formDesc' + (twin.ok ? '' : ' (' + twin.err.trim() + ')'),
      twin.ok && JSON.stringify(twin.out) === JSON.stringify(twinWant));
  yes('F3 and the commission owner of a runtime character is its runtime form id; a placed form keeps its local id and plugin',
      COMMISSION.owner({ desc: 'a01', profileId: P1 }) === JSON.stringify([A1, '', P1]) &&
      COMMISSION.owner({ desc: 'a03:Skyrim.esm', profileId: 78 }) === JSON.stringify([0xa03, 'skyrim.esm', 78]) &&
      COMMISSION.ownerString(JSON.stringify([A1, '', P1])) && !COMMISSION.ownerString(JSON.stringify([2561, '', P1])));

  // ---------------------------------------------------------------- O --
  // The gamemode's release helper on an old shape list: nothing let go, said.
  const rs = '// ==== thornswood release of deleted characters ====', re = '// ==== end thornswood release of deleted characters ====';
  const release = gm.slice(gm.indexOf(rs), gm.indexOf(re) + re.length);
  function helper(list) {
    const dir = fs.mkdtempSync(path.join(scratch, 'helper-'));
    put(path.join(dir, 'server-settings.json'), { privDir: 'private' });
    put(path.join(dir, 'private', 'deleted-characters.json'), list);
    const logged = [];
    const box = { require: require, console: console, log: (s) => logged.push(String(s)) };
    box.globalThis = box;
    vm.createContext(box);
    const was = process.cwd();
    process.chdir(dir);
    let seen = null;
    try {
      vm.runInContext(release, box, { filename: 'gamemode.js (release)' });
      box.__thornswoodRelease('property', (who) => { seen = who; return { saved: true, counts: {} }; });
    } finally { process.chdir(was); }
    // The request file as it is after the start: there when it was not taken (#4920).
    const listAfter = path.join(dir, 'private', 'deleted-characters.json');
    return { seen: seen, logged: logged, after: fs.existsSync(listAfter) ? fs.readFileSync(listAfter, 'utf8') : null };
  }
  const oldList = JSON.stringify({ profiles: [P1], actors: [2561] });
  const h1 = helper(oldList);
  yes('O1 the release helper lets nothing go from a list of local ids, the old shape, and leaves it as it is',
      h1.seen === null && h1.after === oldList);
  yes('O1   and says so: from a build before #2870, not read, and where to look', h1.logged.some((l) => /holds form ids in the old shape, from a build before #2870, and is not read, so nothing was let go and it is left as it is; docs\\GAMEMODE\.md says what to do$/.test(l)));
  const h2 = helper(JSON.stringify({ profiles: [P1], actors: [A1] }));
  yes('O1 a list of runtime form ids is read, and who.actor matches the runtime form id and never the local id',
      !!h2.seen && h2.seen.actor(A1) && !h2.seen.actor(2561) && h2.seen.actor(FORM.formIdOf('a01')));

  // The purses refuse a version 1 merchant ledger.
  const ps = gm.indexOf('// NPC MERCHANT PURSES BEGIN'), pe = gm.indexOf('// NPC MERCHANT PURSES END');
  const pctx = { Map: Map, Number: Number, JSON: JSON };
  vm.createContext(pctx);
  vm.runInContext(gm.slice(ps, pe), pctx);
  const papi = { makeProperty() { }, getIdFromDesc: (d) => (d === '1:Skyrim.esm' ? 1 : 0), get: () => undefined, set: () => { },
    getNpcAIState: () => ({ isHuman: false, profileId: 0, isDead: false }) };
  const pdata = { keep: [['1:Skyrim.esm', 'a:Skyrim.esm', null, null, null, null, 'trader']] };
  const purses = (version) => {
    const doc = { version: version, entries: { '1:Skyrim.esm': null } };
    try { pctx.createNpcMerchantPurses(papi, pdata, { namespace: 'v' + version, load: () => JSON.parse(JSON.stringify(doc)), save: () => true }); return ''; }
    catch (e) { return String(e && e.message); }
  };
  yes('O2 the merchant purses refuse a version 1 ledger and read nothing of it, naming the alpha reset that replaces it',
      purses(1) === 'Saved merchant ledger is version 1, from before #2870, and is not read; with this server stopped, replace it with what node scripts\\ops\\New-AlphaMerchantLedger.js --confirm-discard-alpha prints (the alpha reset: merchant stock and purses start fresh)');
  yes('O2   and load a version 2 one', purses(2) === '');

  // Release-List.ps1 will not merge into an old shape list, and writes runtime form ids.
  const rl = path.join(scratch, 'release-list');
  put(path.join(rl, 'server-settings.json'), { privDir: 'private' });
  const rlFile = path.join(rl, 'private', 'deleted-characters.json');
  put(rlFile, oldList);
  put(path.join(rl, 'cf', 'a.json'), { formDesc: 'a01', profileId: P1 });
  put(path.join(rl, 'cf', 'b.json'), { formDesc: 'a02:Skyrim.esm', profileId: P2 });
  const rlRun = pwsh(dot + '$c = Get-ThornswoodCharacterIds @(' + q(path.join(rl, 'cf', 'a.json')) + ',' + q(path.join(rl, 'cf', 'b.json')) + '); ' +
    "'IDS ' + (@($c.ids) -join ','); foreach ($n in $c.notes) { $n }; " +
    'Write-ThornswoodReleaseList -Root ' + q(rl) + ' -Actors $c.ids');
  const rlSaid = rlRun.out.join('\n');
  yes('O3 Release-List.ps1 reads a character\'s runtime form id off its change form' + (rlRun.ok ? '' : ' (' + rlRun.err.trim() + ')'),
      rlRun.ok && rlRun.out.indexOf('IDS ' + A1) >= 0);
  yes('O3   and a formDesc with a plugin is no character of the list, said', /RELEASENOTE\|.*b\.json has a formDesc that is not a runtime form/.test(rlSaid));
  yes('O3   and it writes nothing into a list in the old shape, said: from a build before #2870, not read, and where to look',
      fs.readFileSync(rlFile, 'utf8') === oldList &&
      /RELEASEBAD\|.*holds form ids in the old shape, from a build before #2870, and is not read, so no list was written and it is left as it is; docs\\GAMEMODE\.md says what to do/.test(rlSaid));
  put(rlFile, JSON.stringify({ profiles: [P1], actors: [A2] }));
  const rlRun2 = pwsh(dot + 'Write-ThornswoodReleaseList -Root ' + q(rl) + ' -Actors @(' + A1 + ')');
  const merged = JSON.parse(fs.readFileSync(rlFile, 'utf8'));
  yes('O3   and merges runtime form ids into a list of them', rlRun2.ok && JSON.stringify(merged.actors) === JSON.stringify([A1, A2]));

  // Server-Log.js removes nothing for a list in the old shape.
  const sl = path.join(scratch, 'server-log');
  put(path.join(sl, 'server-settings.json'), { privDir: 'private' });
  put(path.join(sl, 'world', 'changeForms', 'a01.json'), { formDesc: 'a01', profileId: P1 });
  put(path.join(sl, 'private', 'deleted-characters.json'), oldList);
  put(path.join(sl, 'exit.js'), 'process.exit(0);');
  const slRun = cp.spawnSync(process.execPath, [path.join(REPO, 'scripts', 'vps', 'Server-Log.js'), '--log', path.join(sl, 'server.log'), 'exit.js'], { cwd: sl, encoding: 'utf8' });
  const slLog = fs.existsSync(path.join(sl, 'server.log')) ? fs.readFileSync(path.join(sl, 'server.log'), 'utf8') : '';
  yes('O4 Server-Log.js removes nothing for a list of local ids and leaves it as it is, said',
      slRun.status === 0 && fs.existsSync(path.join(sl, 'world', 'changeForms', 'a01.json')) &&
      fs.readFileSync(path.join(sl, 'private', 'deleted-characters.json'), 'utf8') === oldList &&
      /is not a list of deleted characters, so nothing was removed and it is left as it is/.test(slLog));

  // ---------------------------------------------------------------- V --
  const O1 = JSON.stringify([2561, '', P1]), O2 = JSON.stringify([2562, '', P2]), OP = JSON.stringify([0xa03, 'skyrim.esm', 78]);
  const job = (owner, j) => JSON.stringify([owner, j]);
  function entriesV1() {
    return {
      '9:Skyrim.esm': {
        purse: 250, stock: [],
        supply: { [JSON.stringify(['a01', P1, 'iron ore'])]: 2, 'wheat': 1 },
        commissions: {
          serial: 3,
          held: { [job(O1, 'q-1')]: { owner: O1, gold: 5 }, [job(OP, 'q-3')]: { owner: OP, gold: 7 } },
          cool: { [job(O2, 'q-2')]: 100 }
        }
      },
      '8:Skyrim.esm': null
    };
  }
  const ledgerText = (entries, version) => JSON.stringify({ version: version, entries: entries, sha256: ledgerSum(version, entries) });
  const LIST = JSON.stringify({ profiles: [P1], actors: [2561, A2], done: { saves: 1 } });
  const EMBASSY = JSON.stringify({ embassy: [{ actor: A2, profileId: P2 }], remnant: [] });
  let serial = 0;
  function server(over) {
    const dir = path.join(scratch, 'server-' + (++serial));
    put(path.join(dir, 'server-settings.json'), { privDir: 'private' });
    const files = Object.assign({ 'merchant-ledger.json': ledgerText(entriesV1(), 1), 'deleted-characters.json': LIST, 'embassy.json': EMBASSY }, over || {});
    for (const k of Object.keys(files)) if (files[k] !== null) put(path.join(dir, 'private', k), files[k]);
    return { dir: dir, priv: path.join(dir, 'private') };
  }
  const look = (priv) => fs.readdirSync(priv).sort().map((n) => n + ' ' + sha(fs.readFileSync(path.join(priv, n)))).join('\n');

  const s = server();
  const before = V.count(s.dir);
  yes('V1 a server from before #2870: list actors 1 full and 1 local; the ledger version 1, its sha256 matching, 1 supply wait by formDesc, 1 by item, 2 local owners and 1 placed',
      before.list.actors.full === 1 && before.list.actors.local === 1 && before.embassy.actors.full === 1 &&
      before.merchants.version === 1 && before.merchants.sha256 === true && before.merchants.entries === 1 &&
      before.merchants.supply.desc === 1 && before.merchants.supply.itemOnly === 1 &&
      before.merchants.owners.local === 2 && before.merchants.owners.plugin === 1 && before.merchants.pending === 0);

  // The alpha reset's ledger, as the deploy puts it in place of a version 1 one.
  const fresh = ALPHA.createAlphaMerchantLedger(require(path.join(REPO, 'game', 'data', 'merchant-roster.json')),
    require(path.join(REPO, 'game', 'data', 'npc-population.json')));
  const t = server({ 'merchant-ledger.json': JSON.stringify(fresh), 'deleted-characters.json': JSON.stringify({ profiles: [P1], actors: [A1] }) });
  const after = V.count(t.dir);
  yes('V2 the fresh ledger New-AlphaMerchantLedger.js prints counts as version 2, its sha256 matching, with no old shape and nothing pending',
      after.merchants.version === 2 && after.merchants.sha256 === true && after.merchants.entries === 60 && after.merchants.pending === 0 &&
      after.merchants.supply.desc === 0 && after.merchants.owners.local === 0 && after.list.actors.local === 0 && after.list.actors.full === 1);

  // The command line: what it prints is the count, and it writes nothing.
  const run = (file, args) => cp.spawnSync(process.execPath, [file].concat(args), { encoding: 'utf8', cwd: REPO });
  const lookBefore = look(s.priv);
  const vb = run(VERIFY, ['--server', s.dir]);
  let printed = null;
  try { printed = JSON.parse(vb.stdout); } catch (e) { printed = null; }
  yes('V3 run on a server it exits 0 and prints the count, and changes nothing there',
      vb.status === 0 && JSON.stringify(printed) === JSON.stringify(before) && look(s.priv) === lookBefore);
  const vx = run(VERIFY, ['--server', s.dir, '--before', path.join(scratch, 'before.json')]);
  yes('V3 any other arguments exit 2 with its usage', vx.status === 2 && /Usage: .*Verify-FormIdShape\.js --server <folder>$/m.test(vx.stderr));
  put(path.join(s.priv, 'merchant-ledger.json'), '{');
  const vu = run(VERIFY, ['--server', s.dir]);
  yes('V4 a file it cannot read exits 1', vu.status === 1 && /cannot be parsed/.test(String(JSON.parse(vu.stdout).merchants.unreadable)));
} catch (e) {
  fail++;
  console.log('FAIL  the test itself threw: ' + ((e && e.stack) || e));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

