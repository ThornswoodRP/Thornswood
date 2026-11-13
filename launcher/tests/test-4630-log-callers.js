'use strict';
// #4630: the runtime writer test cannot see a caller that bypasses it.
const fs = require('fs');
const path = require('path');
const app = path.resolve(__dirname, '../app');
let failed = 0;
function yes(name, ok) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name);
  if (!ok) failed++;
}
const expected = {
  'Discord.cs': 1,
  'LocalKeep.cs': 1,
  'OwnGame.cs': 4,
  'Shell.cs': 5,
  'ShellUninstall.cs': 1,
  'Stall.cs': 1,
  'Voice.cs': 1,
  'Swallow.cs': 2
};
for (const [name, count] of Object.entries(expected)) {
  const text = fs.readFileSync(path.join(app, name), 'utf8');
  yes(name + ' routes its diagnostic sites through the writer',
    (text.match(/LauncherLog\.(?:Line|Text)\(/g) || []).length === count);
}
for (const name of fs.readdirSync(app).filter(n => n.endsWith('.cs'))) {
  const text = fs.readFileSync(path.join(app, name), 'utf8');
  const raw = /File\.(?:AppendAllText|WriteAllText|WriteAllLines|WriteAllBytes)\(\s*Paths\.LogFile/.test(text) ||
    /File\.AppendAllText\(\s*Path\.Combine\(Folder, "launcher\.log"\)/.test(text);
  if (raw) yes(name + ' does not open launcher.log outside the writer', false);
}
const stall = fs.readFileSync(path.join(app, 'Stall.cs'), 'utf8');
const stamp = stall.slice(stall.indexOf('static void Stamp(string m)'));
yes('the stall log has no sleep or retry left', !/Thread\.Sleep|for\s*\(|catch/.test(stamp));
const keep = fs.readFileSync(path.join(app, 'LocalKeep.cs'), 'utf8');
yes('age pruning takes the same gate', keep.includes('LauncherLog.Holding(delegate { return PruneLogHeld(path, now); })'));
yes('age pruning covers the older file too', keep.includes('PruneLog(LauncherLog.Older(Paths.LogFile), now)'));
const diag = fs.readFileSync(path.join(app, 'Diag.cs'), 'utf8');
yes('the report snapshot takes the same gate', diag.includes('LauncherLog.Holding(delegate { Grab(work, "launcher.log", Paths.LogFile); return 0; })'));
console.log(failed + ' failed');
process.exitCode = failed ? 1 : 0;
