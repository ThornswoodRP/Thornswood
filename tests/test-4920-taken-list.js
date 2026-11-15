'use strict';
/*
  test-4920-taken-list.js

      node tests/test-4920-taken-list.js

  #4920: a deletion request merged into private\deleted-characters.json while
  the game server starts was written over and lost. The gamemode read the
  list once as it loaded and, after each part, wrote that copy back, and
  deleted the file once every part of it was done; the guild traders' part
  runs last, at NPC startup. Delete-Person.ps1 stops nothing and merges a new
  request into the list while the server runs, so one merged in between was
  put back out by the next write, or deleted with the rest.

  The server now takes the list (thornswoodTakeReleaseList) and never writes
  it. This holds:
    S the take is the same text in the gamemode and in Server-Log.js;
    R the real release block out of game/gamemode.js, with a request merged
      in between its load and the merchants' part at NPC startup: the request
      is still in the file afterwards, and at the next start (server-log.js
      for real, then the block) every part runs for it;
    T the take with a merge landing just before its rename and just after:
      the new request is kept either way, in what was taken or in the list;
    H a .taking left by a stop goes in first and nothing is renamed onto it,
      and a request file that is not a list is left as it is while what was
      taken is still let go.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

const REPO = path.resolve(__dirname, '..');
const GM = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').replace(/\r\n/g, '\n');
const SL_FILE = path.join(REPO, 'scripts', 'vps', 'Server-Log.js');
const SL = fs.readFileSync(SL_FILE, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); } else { fail++; console.log('FAIL  ' + what); }
}
const rd = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } };
const J = (p) => { const t = rd(p); return t === null ? null : JSON.parse(t); };
function put(p, v) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); }

const P1 = 5001, P2 = 5002;
const A1 = 0xff000a01, A2 = 0xff000a02;
const PARTS = ['saves', 'farms', 'property', 'embassy', 'dungeon', 'cargo', 'stalls', 'carts', 'books', 'merchants'];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'thornswood-4920-'));
const home = process.cwd();

/*
  Delete-Person.ps1's mergeList, as it runs: the list there now (or none),
  every id of it and of the request, done cleared, written beside it and
  renamed over it.
*/
function deletePersonMerges(priv, profiles, actors) {
  const file = path.join(priv, 'deleted-characters.json');
  const was = J(file) || {};
  const ids = (a, b) => Array.from(new Set((a || []).concat(b))).sort((x, y) => x - y);
  const tmp = path.join(priv, '.deleted-characters.json.delete-person.tmp');
  fs.writeFileSync(tmp, JSON.stringify({ profiles: ids(was.profiles, profiles), actors: ids(was.actors, actors) }));
  fs.renameSync(tmp, file);
}

// Everything that names P2 on this server: the requests and the taken list.
function named(priv, pid) {
  return ['deleted-characters.json', 'deleted-characters.taken.json', 'deleted-characters.taking.json'].some(function (f) {
    const v = J(path.join(priv, f));
    return !!v && Array.isArray(v.profiles) && v.profiles.indexOf(pid) >= 0;
  });
}

// ------------------------------------------------- S one text, two copies
const MARK_A = '// -- the release list, taken (#4920), begin --';
const MARK_B = '// -- the release list, taken (#4920), end --';
function between(src) {
  const a = src.indexOf(MARK_A), b = src.indexOf(MARK_B);
  return a >= 0 && b > a ? src.slice(a, b + MARK_B.length) : null;
}
const takeGm = between(GM), takeSl = between(SL);
yes('S the take is in gamemode.js', !!takeGm);
yes('S and Server-Log.js carries the same text', !!takeGm && takeGm === takeSl);

// ----------------------------------------- the release block, as it loads
const RA = GM.indexOf('// ==== thornswood release of deleted characters ====');
const RB = GM.indexOf('// ==== end thornswood release of deleted characters ====');
const BLOCK = RA >= 0 && RB > RA ? GM.slice(RA, RB) : '';
yes('R the release block is in gamemode.js', BLOCK.length > 1000);

// One load of the block in `root`: a fresh context, as a server start is.
function load(root) {
  const lines = [];
  const ctx = { require: require, console: console, log: function (l) { lines.push(String(l)); },
    // Nobody made since: an id on the list is held by no form (#5036).
    mp: { get: function (id) { throw new Error('Form with id 0x' + id.toString(16) + " doesn't exist"); } } };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  process.chdir(root);
  try { vm.runInContext(BLOCK, ctx); } finally { process.chdir(home); }
  return { ctx: ctx, lines: lines };
}
// One part asked of the block, as its own block asks at start: who it let go of.
function ask(box, root, part) {
  const seen = [];
  process.chdir(root);
  try {
    box.ctx.__thornswoodRelease(part, function (who) {
      [P1, P2].forEach(function (p) { if (who.profile(p)) { seen.push(p); } });
      return { saved: true, counts: {} };
    });
  } finally { process.chdir(home); }
  return seen;
}

// ------------------------------------------- R a request merged mid start
{
  const root = path.join(scratch, 'server');
  const priv = path.join(root, 'private');
  put(path.join(root, 'server-settings.json'), { privDir: 'private' });
  // server-log.js has done the saves before the engine started.
  put(path.join(priv, 'deleted-characters.json'), { profiles: [P1], actors: [A1], done: { saves: 1 } });

  const first = load(root);
  const early = {};
  PARTS.slice(1, -1).forEach(function (p) { early[p] = ask(first, root, p); });
  yes('R the first start lets go of the first request in every part as it loads',
      Object.keys(early).every(function (p) { return early[p].join() === String(P1); }));

  // Delete-Person runs while the server starts, before the NPC startup.
  deletePersonMerges(priv, [P2], [A2]);

  const late = ask(first, root, 'merchants');
  yes('R the merchants\' part at NPC startup lets go of the first request', late.join() === String(P1));
  yes('R the request merged in during the start is still on the server afterwards (' +
      fs.readdirSync(priv).filter(function (f) { return /^deleted-characters/.test(f); }).join(', ') + ')',
      named(priv, P2));

  // The next start: server-log.js for real, then the block.
  put(path.join(root, 'exit.js'), 'process.exit(0);');
  const r = cp.spawnSync(process.execPath, [SL_FILE, '--log', path.join(root, 'server.log'), 'exit.js'], { cwd: root, encoding: 'utf8' });
  yes('R the next start runs under server-log.js (' + r.status + ')', r.status === 0);
  const second = load(root);
  const next = {};
  PARTS.slice(1).forEach(function (p) { next[p] = ask(second, root, p); });
  yes('R and every part lets go of the merged request then (' + JSON.stringify(next) + ')',
      Object.keys(next).every(function (p) { return next[p].indexOf(P2) >= 0; }));
  yes('R once every part is done there is nothing left naming anybody',
      !fs.readdirSync(priv).some(function (f) { return /^deleted-characters/.test(f); }));
}

// -------------------------------------- T a merge on either side of the take
const box = {};
vm.createContext(box);
if (takeGm) { vm.runInContext(takeGm + '\nthis.take = thornswoodTakeReleaseList;', box); }
const isList = (v) => !!v && typeof v === 'object' && Array.isArray(v.profiles);
if (typeof box.take !== 'function') {
  yes('T and H need the take in gamemode.js', false);
  fs.rmSync(scratch, { recursive: true, force: true });
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(1);
}

[['just before', true], ['just after', false]].forEach(function (when) {
  const priv = path.join(scratch, 'take-' + (when[1] ? 'before' : 'after'));
  put(path.join(priv, 'deleted-characters.json'), { profiles: [P1], actors: [A1], done: { saves: 1 } });
  // The same fs, but Delete-Person writes as the take renames the list.
  const raced = Object.assign({}, fs, {
    renameSync: function (from, to) {
      if (/deleted-characters\.json$/.test(from) && when[1]) { deletePersonMerges(priv, [P2], [A2]); }
      fs.renameSync(from, to);
      if (/deleted-characters\.json$/.test(from) && !when[1]) { deletePersonMerges(priv, [P2], [A2]); }
    }
  });
  const got = box.take(raced, path, priv, isList);
  yes('T a request merged in ' + when[0] + ' the take is kept (' + JSON.stringify(got.list) + ')',
      !!got.list && got.list.profiles.indexOf(P1) >= 0 && named(priv, P2));
});

// --------------------------------------------- H halfway, and a bad list
{
  const priv = path.join(scratch, 'half');
  put(path.join(priv, 'deleted-characters.taking.json'), { profiles: [P1], actors: [A1], done: { saves: 1 } });
  put(path.join(priv, 'deleted-characters.json'), { profiles: [P2], actors: [A2] });
  const got = box.take(fs, path, priv, isList);
  yes('H a .taking a stop left goes in first, and the new list waits where it is',
      !!got.list && got.list.profiles.join() === String(P1) && !fs.existsSync(path.join(priv, 'deleted-characters.taking.json')) &&
      J(path.join(priv, 'deleted-characters.json')).profiles.join() === String(P2));
  const again = box.take(fs, path, priv, isList);
  yes('H and is taken the next time, with every id of both and done only where both had it',
      again.list.profiles.join() === [P1, P2].join() && Object.keys(again.list.done).length === 0 &&
      !fs.existsSync(path.join(priv, 'deleted-characters.json')));

  const priv2 = path.join(scratch, 'bad');
  put(path.join(priv2, 'deleted-characters.taken.json'), { profiles: [P1], actors: [A1], done: { saves: 1 } });
  put(path.join(priv2, 'deleted-characters.json'), '{"profiles":"nobody"}');
  const bad = box.take(fs, path, priv2, isList);
  yes('H a request file that is not a list is left as it is, and what was taken is still let go',
      !!bad.list && bad.list.profiles.join() === String(P1) && !!bad.left && bad.left.bad !== undefined &&
      rd(path.join(priv2, 'deleted-characters.json')) === '{"profiles":"nobody"}');
}

fs.rmSync(scratch, { recursive: true, force: true });
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
