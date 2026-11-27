// test-4632-dead-members.js
//
//     node tests/test-4632-dead-members.js
//
// #4632. The build turns an unused private member into an error
// (launcher/app/Unused.globalconfig), but a public or internal one nothing
// calls passes it. These five had no caller anywhere in the repository: not
// in launcher/app, the tests, the scripts, the site or the deploy agent.
//
//   AutoJoin.SetProfileId    the client settings write before 20 September;
//                            SetChooseAtMenu has written the profile id since
//   CrashDump.SizeNote       a copy of the text Settings shows, which lives in
//                            MainWindow.axaml
//   LastPlugin.RecipeFile    the recipe's path; LastPlugin and MadeFromGame
//                            use RecipeName
//   SystemLook.LargestText   225%, which Scale already holds as its limit
//   StunMessage.IsV4         an address check VoiceIce makes for itself
//
// Each must be gone, nothing may still name it, and AutoJoin's silent catch
// count in scripts/dev/swallow-baseline.txt must have fallen with
// SetProfileId's. On main before #4632 every check fails.
//
// Left on purpose, and named so the next pass does not take them:
//   interop struct fields (their layout needs them), interface members,
//   JSON-bound properties, members the scripts and tests call, STUN's table
//   of attribute numbers (AttrSoftware), and Discord.SessionId, whose file
//   #4701's pull request edits.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let pass = 0, fail = 0;
function yes(name, ok) { if (ok) { pass++; console.log('PASS  ' + name); } else { fail++; console.log('FAIL  ' + name); } }
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git' || e.name === 'bin' || e.name === 'obj') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(cs|axaml|ps1|psm1|js|py|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

const gone = [
  ['AutoJoin.cs', 'SetProfileId'],
  ['CrashDump.cs', 'SizeNote'],
  ['LastPlugin.cs', 'RecipeFile'],
  ['SystemLook.cs', 'LargestText'],
  ['VoiceStun.cs', 'IsV4'],
];

const me = path.join(ROOT, 'tests', 'test-4632-dead-members.js');
const files = ['launcher', 'tests', 'scripts', 'site', 'tools', 'installer', 'docs']
  .map((d) => path.join(ROOT, d)).filter((d) => fs.existsSync(d))
  .reduce((all, d) => walk(d, all), []).filter((f) => f !== me);

for (const [file, name] of gone) {
  const rx = new RegExp('\\b' + name + '\\b');
  const src = read('launcher/app/' + file);
  yes(file + ' no longer declares ' + name, !rx.test(src));
  const still = files.filter((f) => rx.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f));
  yes('  and nothing in the repository names it (' + still.join(', ') + ')', still.length === 0);
}

// What they did is still done by what stays.
const auto = read('launcher/app/AutoJoin.cs');
yes('SetChooseAtMenu still puts the profile id inside gameData, and its reason is with it',
  /EnsureInGameData\(before, "profileId", lastProfileId\.ToString\(\)\)/.test(auto) &&
  /isOfflineMode = Number\.isInteger\(settingsGameData\?\.profileId\)/.test(auto));
yes('Settings still says how big a snapshot is', /One can be 9 GB or more/.test(read('launcher/app/MainWindow.axaml')));
yes('Scale still stops at 225%', /p > 225\) return 1\.0;/.test(read('launcher/app/SystemLook.cs')));
yes('VoiceStun.cs names nothing from System.Net.Sockets now, and no longer uses it',
  !/using System\.Net\.Sockets;/.test(read('launcher/app/VoiceStun.cs')) && !/AddressFamily|SocketException/.test(read('launcher/app/VoiceStun.cs')));

// AutoJoin's three silent catches were GetProfileId's, SetProfileId's and
// GetChooseAtMenu's: two are left, and Check-Swallow goes red on a count
// that fell without its line.
const catches = (auto.match(/catch\s*\{\s*return [^;]+;\s*\}/g) || []).length;
yes('AutoJoin.cs has two silent catches left (' + catches + ')', catches === 2);
yes('  and swallow-baseline.txt says 2', /^AutoJoin\.cs 2$/m.test(read('scripts/dev/swallow-baseline.txt')));

console.log(pass + ' passed, ' + fail + ' failed');
if (fail) process.exitCode = 1;
