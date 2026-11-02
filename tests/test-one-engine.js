// test-one-engine.js
//
//     node tests\test-one-engine.js
//
// One engine (issue #1200). The commit engine\skymp is pinned to, the commit
// records\client-build.json says the client runtime was built from and the
// commit records\server-build.json says the server was built from must be the
// same fork commit, on the branch .gitmodules follows, in the fork .gitmodules
// names. Red when any of them differs.
//
// WHY THIS EXISTS. On 29 September the server record named a build of fork
// commit 5c54e8b9 (27 Sep) while the pin had moved on to 10841f40 and then
// b4543a86, and the client record with it, so the servers ran engine code two
// days and several fixes old and nothing said so: the client and the pin moved
// and the server record was simply never redone. Patrick: "What's the point in
// the changes if we aren't using them." A change to the fork now reaches main
// only as a pin, a client build and a server build of the same commit.
//
// And every server file (issue #1214): records\server-build.json lists every
// file the fork builds into the server, the binary, the JavaScript half it
// runs, its map and the rest scripts\deploy\ServerBuild.ps1 names, each with
// its hash and the commit it was built from, and that must be the server's one
// commit. Red when a file is left out or was built from another commit.
//
// And engine/README.md names no commit or hash in full (issue #1346). The page
// used to state the pin and the server's SHA256, and every engine change
// moved both: on 1 October it named 1a2e5995 with the records on e0135f5a,
// and on 5 October e6534129 with the records on a247ef27. It now says where
// to read them; red when a 40 or 64 character hex value is back on it.
//
// It runs in the build check on every pull request (.github/workflows/build.yml,
// "Check the engine is one commit") and in the nightly run. It reads only the
// checkout: the pin is the gitlink in HEAD's tree, so the fork itself does not
// have to be fetched. First it proves the check catches each way the three can
// disagree, on made up records; then it runs the same check on this tree.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const CR = String.fromCharCode(13);

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// The same fork, however it is written: with or without .git, any case.
function forkKey(url) {
  return String(url || '').trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
}
const HEX40 = /^[0-9a-f]{40}$/;
const HEX7 = /^[0-9a-f]{7,40}$/;

// Every way the pin, the two records and .gitmodules disagree, as sentences.
// Empty when they are one engine.
//   pin        the 40 character commit the index pins at engine/skymp
//   client     records/client-build.json, parsed
//   server     records/server-build.json, parsed
//   submodule  { url, branch } from .gitmodules for engine/skymp
function oneEngineProblems(pin, client, server, submodule) {
  const out = [];
  pin = String(pin || '').toLowerCase();
  if (!HEX40.test(pin)) { out.push('engine/skymp is not pinned to a commit in this tree'); }

  const cc = client ? String(client.forkCommit || '').toLowerCase() : '';
  if (!client) { out.push('records/client-build.json does not read'); }
  else if (!HEX7.test(cc)) { out.push('records/client-build.json names no fork commit (forkCommit)'); }
  else if (HEX40.test(pin) && pin.indexOf(cc) !== 0) {
    out.push('the client runtime was built from ' + cc + ', and engine/skymp is pinned to ' + pin.slice(0, 8));
  }

  const src = server && server.source ? server.source : null;
  const sc = src ? String(src.commit || '').toLowerCase() : '';
  if (!server) { out.push('records/server-build.json does not read'); }
  else if (!HEX40.test(sc)) { out.push('records/server-build.json names no full fork commit (source.commit)'); }
  else if (HEX40.test(pin) && sc !== pin) {
    out.push('the server was built from ' + sc.slice(0, 8) + ', and engine/skymp is pinned to ' + pin.slice(0, 8));
  }
  if (HEX7.test(cc) && HEX40.test(sc) && sc.indexOf(cc) !== 0) {
    out.push('the client runtime (' + cc + ') and the server (' + sc.slice(0, 8) + ') were built from different commits');
  }

  const branch = submodule ? String(submodule.branch || '') : '';
  const url = submodule ? forkKey(submodule.url) : '';
  if (!branch || !url) { out.push('.gitmodules names no url and branch for engine/skymp'); }
  if (client && branch && String(client.forkBranch || '') !== branch) {
    out.push('records/client-build.json says branch ' + (client.forkBranch || 'nothing') + ', and .gitmodules follows ' + branch);
  }
  if (src && branch && String(src.branch || '') !== branch) {
    out.push('records/server-build.json says branch ' + (src.branch || 'nothing') + ', and .gitmodules follows ' + branch);
  }
  if (client && url && forkKey(client.fork) !== url) {
    out.push('records/client-build.json names the fork ' + (client.fork || 'nothing') + ', and .gitmodules names ' + submodule.url);
  }
  if (src && url && forkKey(src.repo) !== url) {
    out.push('records/server-build.json names the fork ' + (src.repo || 'nothing') + ', and .gitmodules names ' + submodule.url);
  }
  return out.concat(serverFileProblems(server));
}

// Every commit or hash engine/README.md writes out in full (issue #1346): a
// 40 character hex value is a commit, a 64 character one a SHA256. Short ones
// in the page's history (`1a2e5995`, `ecb029cb...`) are not current values.
function namedInFull(text) {
  return String(text || '').match(/\b(?:[0-9a-f]{64}|[0-9a-f]{40})\b/gi) || [];
}

// Every server file the fork builds, as scripts/deploy/ServerBuild.ps1 names
// them ($ThornswoodServerForkFiles); held to that list below so the two cannot
// drift. data/scripts is by folder: the fork decides what it compiles.
const SERVER_FILES = ['scam_native.node', 'dist_back/skymp5-server.js', 'dist_back/skymp5-server.js.map', 'package.json', 'yarn.lock', 'launch_server.bat'];

// Issue #1214. The server is more than its binary: the fork's build also
// writes the JavaScript half the server runs, its map, and the rest. On
// 29 September the record named only the binary, so nobody could say which
// commit the JavaScript on dev was built from. Every one of them is listed,
// each with its hash and the commit it was built from, and that is the
// server's one commit: a file carried over from another build's record is
// a server file from another commit.
function serverFileProblems(server) {
  const out = [];
  if (!server) { return out; }
  const sc = server.source ? String(server.source.commit || '').toLowerCase() : '';
  const files = server.files && typeof server.files === 'object' ? server.files : null;
  if (!files || !Object.keys(files).length) {
    out.push('records/server-build.json lists no server files, only the binary, so nothing says which build the JavaScript half is (make it again with New-ServerBuildRecord.ps1)');
    return out;
  }
  SERVER_FILES.forEach(function (n) {
    if (!files[n]) { out.push('records/server-build.json does not list ' + n); }
  });
  Object.keys(files).forEach(function (n) {
    const e = files[n] || {};
    const sha = String(e.sha256 || '').toLowerCase();
    const from = String(e.commit || '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(sha)) { out.push('records/server-build.json names no sha256 for ' + n); }
    if (!HEX40.test(from)) { out.push('records/server-build.json names no full commit for ' + n); }
    else if (HEX40.test(sc) && from !== sc) {
      out.push(n + ' in records/server-build.json was built from ' + from.slice(0, 8) + ', and the server from ' + sc.slice(0, 8));
    }
  });
  const bin = files['scam_native.node'];
  if (bin && String(bin.sha256 || '').toLowerCase() !== String(server.sha256 || '').toLowerCase()) {
    out.push('records/server-build.json names one scam_native.node at the top and another under files');
  }
  return out;
}

// ------------------------------------------------------ planted disagreements
const P = 'abcdef0123456789abcdef0123456789abcdef01';
const Q = '0123456789abcdef0123456789abcdef01234567';
const SUB = { url: 'https://github.com/ThornswoodRP/skymp.git', branch: 'thornswood/engine-changes' };
function C(commit, extra) {
  return Object.assign({ fork: 'https://github.com/ThornswoodRP/skymp', forkBranch: 'thornswood/engine-changes', forkCommit: commit }, extra || {});
}
// A server record whose files were all built from its commit. fileCommits
// puts another commit on some of them, drop leaves some out.
const BIN = 'b'.repeat(64);
function S(commit, extra, fileCommits, drop) {
  const files = {};
  SERVER_FILES.concat(['data/scripts/ActiveMagicEffect.pex']).forEach(function (n, i) {
    if ((drop || []).indexOf(n) >= 0) { return; }
    const from = (fileCommits && Object.prototype.hasOwnProperty.call(fileCommits, n)) ? fileCommits[n] : commit;
    files[n] = { sha256: n === 'scam_native.node' ? BIN : String(i).repeat(64), bytes: 1, commit: from };
  });
  return { binary: 'scam_native.node', sha256: BIN, files: files,
           source: Object.assign({ repo: 'https://github.com/ThornswoodRP/skymp.git', branch: 'thornswood/engine-changes', commit: commit }, extra || {}) };
}
function caught(what, problems, word) {
  yes(what + ' is caught' + (problems.length ? ' ("' + problems[0] + '")' : ''),
      problems.length > 0 && (!word || problems.join(' | ').indexOf(word) >= 0));
}

yes('one commit everywhere is one engine', oneEngineProblems(P, C(P.slice(0, 8)), S(P), SUB).length === 0);
yes('a client record may name the commit in full', oneEngineProblems(P, C(P), S(P), SUB).length === 0);
yes('the fork may be written with or without .git', oneEngineProblems(P, C(P.slice(0, 8), { fork: 'https://github.com/ThornswoodRP/skymp.git' }), S(P, { repo: 'https://github.com/ThornswoodRP/skymp' }), SUB).length === 0);
caught('the shape of 29 September, a server record older than the pin and the client', oneEngineProblems(P, C(P.slice(0, 8)), S(Q), SUB), 'the server was built from');
caught('a client record older than the pin', oneEngineProblems(P, C(Q.slice(0, 8)), S(P), SUB), 'the client runtime was built from');
caught('a pin moved on with neither record', oneEngineProblems(P, C(Q.slice(0, 8)), S(Q), SUB), 'pinned to');
caught('two records that agree with each other and not with the pin', oneEngineProblems(Q, C(P.slice(0, 8)), S(P), SUB), 'pinned to');
caught('a server record with a short commit', oneEngineProblems(P, C(P.slice(0, 8)), S(P.slice(0, 8)), SUB), 'no full fork commit');
caught('a client record with no commit', oneEngineProblems(P, C(''), S(P), SUB), 'no fork commit');
caught('no pin at all', oneEngineProblems('', C(P.slice(0, 8)), S(P), SUB), 'not pinned');
caught('a missing server record', oneEngineProblems(P, C(P.slice(0, 8)), null, SUB), 'server-build.json does not read');
caught('a server built off another branch', oneEngineProblems(P, C(P.slice(0, 8)), S(P, { branch: 'thornswood/898-key-ups' }), SUB), 'follows');
caught('a client built from another fork', oneEngineProblems(P, C(P.slice(0, 8), { fork: 'https://github.com/skyrim-multiplayer/skymp' }), S(P), SUB), 'names the fork');

// Every server file, one commit (#1214).
caught('the JavaScript half of the server from another commit', oneEngineProblems(P, C(P.slice(0, 8)), S(P, null, { 'dist_back/skymp5-server.js': Q }), SUB), 'dist_back/skymp5-server.js in records/server-build.json was built from 01234567');
caught('its source map from another commit', oneEngineProblems(P, C(P.slice(0, 8)), S(P, null, { 'dist_back/skymp5-server.js.map': Q }), SUB), 'skymp5-server.js.map in records');
caught('compiled Papyrus from another commit', oneEngineProblems(P, C(P.slice(0, 8)), S(P, null, { 'data/scripts/ActiveMagicEffect.pex': Q }), SUB), 'ActiveMagicEffect.pex in records');
caught('a server file that names no commit', oneEngineProblems(P, C(P.slice(0, 8)), S(P, null, { 'package.json': '' }), SUB), 'no full commit for package.json');
caught('the shape of 29 September again: a record of the binary alone', oneEngineProblems(P, C(P.slice(0, 8)),
  { binary: 'scam_native.node', sha256: BIN, source: S(P).source }, SUB), 'lists no server files');
caught('a record that leaves out the JavaScript half', oneEngineProblems(P, C(P.slice(0, 8)), S(P, null, null, ['dist_back/skymp5-server.js']), SUB), 'does not list dist_back/skymp5-server.js');
(function () {
  const s = S(P);
  s.sha256 = 'c'.repeat(64);
  caught('a binary at the top that is not the one under files', oneEngineProblems(P, C(P.slice(0, 8)), s, SUB), 'another under files');
})();

// The list above is ServerBuild.ps1's, which every publish and deploy holds.
(function () {
  let text = '';
  try { text = fs.readFileSync(path.join(REPO, 'scripts', 'deploy', 'ServerBuild.ps1'), 'utf8'); } catch (e) { text = ''; }
  const m = /\$ThornswoodServerForkFiles = @\(([^)]*)\)/.exec(text);
  const theirs = m ? m[1].split(',').map(function (x) { return x.trim().replace(/^'|'$/g, ''); }) : [];
  yes('the server files held here are the ones scripts/deploy/ServerBuild.ps1 names (' + theirs.length + ')', theirs.join('|') === SERVER_FILES.join('|'));
})();

// The page check catches a pin or a hash written out, and passes history.
(function () {
  const P = 'e65341299bfdbdc0993678e93572930cae43d183';
  yes('engine/README.md check: a pin written out in full is caught', namedInFull('`git submodule status` prints `' + P + '`').length === 1);
  yes('engine/README.md check: a SHA256 written out in full is caught', namedInFull('its SHA256 is `' + 'e'.repeat(64) + '`').length === 1);
  yes('engine/README.md check: short commits and cut hashes in its history pass', namedInFull('records name `1a2e5995`; hashed `ecb029cb...`').length === 0);
})();

// ------------------------------------------------------------------ this tree
function git(args) {
  return execFileSync('git', ['-C', REPO].concat(args), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function readJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8').split(CR).join('')); } catch (e) { return null; }
}

// The pin in the index, which is what a commit takes: HEAD's on a clean
// checkout like the build check's, and the moved pin in
// scripts/release/Update-EnginePin.ps1, which moves it with git update-index
// and runs this before it commits. Read from HEAD, the engine pin robot's
// first pin stopped here on 1 Nov 2026 with the records already at the new
// commit (#5207), as Get-EngineRecords.ps1 reads the index for the same
// reason.
let pin = '';
try {
  // "160000 <sha> 0\tengine/skymp"
  const m = /^160000 ([0-9a-f]{40}) 0\tengine\/skymp$/.exec(git(['ls-files', '-s', 'engine/skymp']));
  pin = m ? m[1] : '';
} catch (e) { pin = ''; }
yes('the index pins engine/skymp to a commit' + (pin ? ' (' + pin.slice(0, 8) + ')' : ''), !!pin);

let submodule = null;
try {
  submodule = {
    url: git(['config', '-f', '.gitmodules', '--get', 'submodule.engine/skymp.url']),
    branch: git(['config', '-f', '.gitmodules', '--get', 'submodule.engine/skymp.branch'])
  };
} catch (e) { submodule = null; }
yes('.gitmodules names the fork and the branch engine/skymp follows', !!(submodule && submodule.url && submodule.branch));

const client = readJson('records/client-build.json');
const server = readJson('records/server-build.json');
const problems = oneEngineProblems(pin, client, server, submodule);
problems.forEach(function (p) { console.log('      ' + p); });
yes('the pin, records/client-build.json and records/server-build.json name one fork commit' +
    (problems.length ? '' : ' (' + pin.slice(0, 8) + ')'), problems.length === 0);
if (problems.length) {
  console.log('');
  console.log('  Build the client and the server from the pinned commit and record both');
  console.log('  (engine/README.md, "One engine"): Build-Engine.ps1, then New-ClientBuildRecord.ps1');
  console.log('  and Build-Server.ps1 (every server file, recorded) in the same pull request.');
}

// The front (#2754): skymp5-front built from the same commit, recorded by
// scripts/release/Build-Front.ps1 -Record when the pin moves.
const front = readJson('records/front-build.json');
const fc = front ? String(front.forkCommit || '').toLowerCase() : '';
if (front && fc !== String(pin || '').toLowerCase()) {
  console.log('      the front was built from ' + (fc ? fc.slice(0, 8) : 'nothing') + ', and engine/skymp is pinned to ' + String(pin || '').slice(0, 8));
  console.log('      Build it from the pin and record it: scripts/release/Build-Front.ps1 -Record, in the same pull request as the pin.');
}
yes('records/front-build.json names the pinned commit in full', !!front && HEX40.test(fc) && fc === String(pin || '').toLowerCase());

let readme = null;
try { readme = fs.readFileSync(path.join(REPO, 'engine', 'README.md'), 'utf8'); } catch (e) { readme = null; }
const inFull = namedInFull(readme);
inFull.forEach(function (h) { console.log('      engine/README.md names ' + h); });
yes('engine/README.md names no commit or hash in full; the pin and the records are where they are written',
    readme !== null && inFull.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
