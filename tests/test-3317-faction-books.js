'use strict';
/*
  test-3317-faction-books.js

      node tests/test-3317-faction-books.js

  #3317. Patrick, 22 Oct, page card q-3317-faction-books, A: one book per
  faction in the game, owned by whoever holds that faction's Leader role in
  Discord, and it moves with the role. The Faction Owner role is gone.
  tests/test-books.js runs the book itself; this runs the way there:

    S1 the site reads a faction's Leader role by its shape, "<faction> Leader",
       and no other role: not a council lead, not a Jarl
    S2 /api/allowed hands the door each Leader role and the profiles of the
       account that holds it, and no factionOwnerProfiles
    S3 a Leader role two accounts hold goes to neither and is named in
       factionLeaderClash, as a Jarl role two accounts hold is
    S4 a character killed for good is left out, and a broken ban list leaves
       nobody leading anything
    D1 the door writes the Leader roles to allowed.json as they came
    D2 a profile Discord could not be asked about keeps the Leader roles it
       had in the file, and no other; everybody else takes the fresh answer
    D3 the book roles answer gives a proved profile the Leader roles it
       holds, and a role name not of that shape is dropped

  Never connects to anything.
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const site = siteFiles.source().split(CR).join('');
const gm = fs.readFileSync(path.join(ROOT, 'game', 'gamemode.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function toClose(text, from) {
  const b = text.indexOf('{', from);
  let d = 0;
  for (let i = b; i < text.length; i++) {
    if (text[i] === '{') { d++; }
    else if (text[i] === '}') { d--; if (d === 0) { return i + 1; } }
  }
  return -1;
}
const same = function (a, b) { return JSON.stringify(a) === JSON.stringify(b); };

(async function () {
  // ------------------------------------------------------------------- S1
  const lrAt = site.indexOf('\nfunction leaderRoles(');
  const leaderRoles = lrAt < 0 ? null : new Function(site.slice(lrAt, toClose(site, lrAt)) + '\nreturn leaderRoles;')();
  yes('S1 the site has leaderRoles', typeof leaderRoles === 'function');
  if (leaderRoles) {
    yes('S1 it reads each faction\'s Leader role, Other ones too, and nothing else',
        same(leaderRoles(['Playtester', 'Companions Leader', 'Lead Dev', 'Jarl of Whiterun',
                          'Free Skyrim Trading Company Leader', 'Leader', 'The Dawn Hall Leader']),
             ['Companions Leader', 'Free Skyrim Trading Company Leader', 'The Dawn Hall Leader']) &&
        same(leaderRoles(undefined), []));
  }
  yes('S1 standing() gives leads in both of its paths, and Faction Owner is read nowhere',
      (site.match(/out\.leads = leaderRoles\(out\.roles\);/g) || []).length === 2 &&
      site.indexOf('Faction Owner') < 0 && site.indexOf('factionOwner') < 0);

  // ------------------------------------------------------------- S2 to S4
  const allowedAt = site.indexOf("if ((route === '/api/allowed' || devDoor) && req.method === 'GET') {");
  const allowed = allowedAt < 0 ? '' : site.slice(allowedAt, toClose(site, allowedAt));
  yes('S2 /api/allowed is in server.js', !!allowed);
  const run = async function (linked, standings, extra) {
    let sent = null;
    const f = new Function('route', 'devDoor', 'req', 'res', 'cfg', 'url', 'sameSecret', 'sendJson', 'jsonFile', 'LINKED',
      'standingCached', 'keyInAddress', 'standingsForDoor', 'activeBans', 'pkProfiles', 'officesForDoor',
      'return (async function () {\n' + allowed + '\n})();');
    await f('/api/allowed', false, { method: 'GET', headers: { 'x-thornswood-key': 'k' } }, {}, { botKey: 'k' }, null,
      function (a, b) { return a === b; }, function (r, c, b) { sent = JSON.parse(JSON.stringify(b)); },
      function () { return linked; }, 'linked.json', null, new Set(),
      async function (ids) { return new Map(ids.map(function (id) { return [id, standings[id]]; })); },
      function () { const b = (extra && extra.bans) || []; if (extra && extra.broken) { b.broken = true; } return b; },
      function () { return (extra && extra.pk) || []; }, async function () { return []; });
    return sent;
  };
  if (allowed) {
    const linked = { A: { profiles: [11, 12] }, B: { profiles: [21] }, C: { profiles: [31] }, D: { profiles: [41] } };
    const st = {
      A: { play: true, roles: ['Playtester', 'Companions Leader'], leads: ['Companions Leader'], name: 'Kodlak' },
      B: { play: true, roles: ['Playtester', 'Thalmor Leader'], leads: ['Thalmor Leader'], name: 'Elenwen' },
      C: { play: true, roles: ['Playtester', 'Thalmor Leader'], leads: ['Thalmor Leader'], name: 'Ondolemar' },
      D: { play: true, roles: ['Playtester'], leads: [], name: 'Nobody' }
    };
    let out = await run(linked, st);
    yes('S2 the door is handed each Leader role and the profiles of the account that holds it',
        !!out && same(out.factionLeaderProfiles['Companions Leader'], [11, 12]) && !('factionOwnerProfiles' in out));
    yes('S3 a Leader role two accounts hold goes to neither, and is named as a clash',
        !!out && !('Thalmor Leader' in out.factionLeaderProfiles) && same(out.factionLeaderClash, ['Thalmor Leader']));
    out = await run(linked, st, { pk: [12] });
    yes('S4 a character killed for good leads nothing, and the rest of the account still does',
        same(out.factionLeaderProfiles['Companions Leader'], [11]));
    out = await run(linked, st, { pk: [11, 12] });
    yes('S4 a role whose every character is gone is left out whole', !('Companions Leader' in out.factionLeaderProfiles));
    out = await run(linked, st, { broken: true });
    yes('S4 a broken ban list leaves nobody leading anything', same(out.factionLeaderProfiles, {}));
  }

  // -------------------------------------------------------------- D1, D2
  const kwAt = gm.indexOf('function keepWhatFailed(doc, had) {');
  const keepWhatFailed = kwAt < 0 ? null : new Function(gm.slice(kwAt, toClose(gm, kwAt)) + '\nreturn keepWhatFailed;')();
  yes('D2 the door has keepWhatFailed', typeof keepWhatFailed === 'function');
  if (keepWhatFailed) {
    const kept = keepWhatFailed({
      failedProfiles: [21],
      profiles: [11], factionLeaderProfiles: { 'Companions Leader': [11], 'Thalmor Leader': [21] }
    }, {
      factionLeaderProfiles: { 'Thalmor Leader': [31], 'Dawnguard Leader': [21], 'Companions Leader': [99] }
    });
    yes('D2 a profile that could not be checked keeps the Leader roles it had, and no other',
        same(kept.factionLeaderProfiles['Dawnguard Leader'], [21]) && !('Thalmor Leader' in kept.factionLeaderProfiles));
    yes('D2 everybody else takes the fresh answer', same(kept.factionLeaderProfiles['Companions Leader'], [11]));
  }
  const writeAt = gm.indexOf('mp.writeFileWhole(FILE, JSON.stringify({');
  const write = writeAt < 0 ? '' : gm.slice(writeAt, gm.indexOf('}, null, 2));', writeAt));
  yes('D1 the door writes factionLeaderProfiles to allowed.json, and no factionOwnerProfiles',
      /factionLeaderProfiles: \(doc\.factionLeaderProfiles/.test(write) && write.indexOf('factionOwnerProfiles') < 0 &&
      gm.indexOf('factionOwnerProfiles') < 0);

  // -------------------------------------------------------------------- D3
  const d0 = gm.indexOf('// ==== thornswood door ====');
  const d1 = gm.indexOf('// ==== end thornswood door ====');
  const files = {};
  files[path.join('private', 'allowed.json')] = JSON.stringify({ enforce: false, profiles: [500, 501],
    factionLeaderProfiles: { 'Companions Leader': [500], 'Thalmor Leader': [500], 'Jarl of Whiterun': [500], 'Leader': [500] } });
  const fakeFs = {
    readFileSync: function (p) { if (!Object.prototype.hasOwnProperty.call(files, p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files[p]; },
    writeFileSync: function (p, s) { files[p] = String(s); }, appendFileSync: function () { }, existsSync: function () { return true; },
    mkdirSync: function () { }, statSync: function () { return { mtimeMs: 0 }; }
  };
  const trusted = {};
  const box = {
    console: { log: function () { }, error: function () { } },
    require: function (m) { if (m === 'fs') return fakeFs; if (m === 'path') return path; return { get: function () { return { on: function () { }, setTimeout: function () { } }; }, request: function () { return { on: function () { }, end: function () { }, setTimeout: function () { } }; } }; },
    Buffer: Buffer, Date: Date, Math: Math, Number: Number, String: String, Array: Array, Object: Object, JSON: JSON,
    setTimeout: function () { return 1; }, setInterval: function () { return 1; }, clearInterval: function () { }, clearTimeout: function () { },
    mp: { getServerSettings: function () { return {}; }, get: function () { return []; }, kick: function () { } }
  };
  box.globalThis = box;
  box.__thornswoodPassTrusts = function (pid) { return !!trusted[pid]; };
  vm.createContext(box);
  let ran = true;
  try { vm.runInContext(gm.slice(d0, d1), box, { filename: 'gamemode.js (door)' }); } catch (e) { ran = false; console.log('      ' + e); }
  yes('D3 the door block runs over a stand-in server', ran && typeof box.__thornswoodBookRoles === 'function');
  if (ran && typeof box.__thornswoodBookRoles === 'function') {
    yes('D3 a profile the pass has not proved leads nothing', same(box.__thornswoodBookRoles(500).leads, []));
    trusted[500] = true;
    trusted[501] = true;
    yes('D3 once proved, it leads what it holds, and a name not of the shape is dropped',
        same(box.__thornswoodBookRoles(500).leads.sort(), ['Companions Leader', 'Thalmor Leader']));
    yes('D3 a proved profile that holds none leads nothing', same(box.__thornswoodBookRoles(501).leads, []));
  }

  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
