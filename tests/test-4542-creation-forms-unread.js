// test-4542-creation-forms-unread.js
//
//     node tests/test-4542-creation-forms-unread.js
//
// #4542. Check-CreationForms passed without reading the plugins it was asked
// about: an enabled plugin missing from Data was only counted, a game folder
// with no plugin list was a SKIP and exit 0 (its header promises SKIP only
// with no game folder), and a --write run that wrote nothing exited 0.
//
// This runs the script against made-up Data folders and plugin lists, each
// plugin a bare TES4 header, nothing of Bethesda's:
//   1. an enabled plugin missing from Data fails the check, named;
//   2. a game folder with no plugin list fails the check, and is no SKIP;
//   3. --write with no game folder writes nothing and exits non-zero;
//   4. no game folder at all, and no --write, is still a SKIP with exit 0;
//   5. every enabled plugin read, and nothing needing the Creation Club,
//      still passes, and --write then writes its file.
// Writes only under its own scratch folder, which it removes.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'mods', 'Check-CreationForms.js');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4542-'));
let pass = 0;
let fail = 0;
function yes(what, cond, out) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); if (out) { for (const l of out.split(/\r?\n/)) { if (l.trim()) { console.log('      ' + l); } } } }
}
// A plugin: a TES4 record with no fields and nothing after it.
function plugin(file) {
  const b = Buffer.alloc(24);
  b.write('TES4', 0, 'latin1');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, b);
}
function game(name, plugins, list) {
  const g = path.join(T, name);
  const data = path.join(g, 'Data');
  fs.mkdirSync(data, { recursive: true });
  for (const p of plugins) { plugin(path.join(data, p)); }
  const txt = path.join(g, 'plugins.txt');
  if (list !== null) { fs.writeFileSync(txt, list); }
  return { data: data, list: txt };
}
function run(args) {
  const r = cp.spawnSync(process.execPath, [SCRIPT].concat(args), { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

try {
  // 1. Two enabled plugins the Data folder does not have.
  let g = game('missing', ['Update.esm', 'Here.esp'], '*Here.esp\r\n*Gone.esp\r\n*Away.esm\r\n');
  let r = run(['--data', g.data, '--plugins', g.list]);
  yes('an enabled plugin missing from Data fails the check', r.code === 1 && !/Special Edition is enough/.test(r.out), r.out);
  yes('  and each one is named', /Gone\.esp/.test(r.out) && /Away\.esm/.test(r.out), r.out);

  // 2. The game is there, its plugin list is not.
  g = game('no-list', ['Update.esm'], null);
  r = run(['--data', g.data, '--plugins', g.list]);
  yes('a game folder with no plugin list fails the check, and is no SKIP', r.code === 1 && !/SKIP/.test(r.out), r.out);
  yes('  and says which list it looked for', r.out.indexOf(g.list) >= 0, r.out);

  // 3. --write with no game folder.
  const nowhere = path.join(T, 'no-game', 'Data');
  const out = path.join(T, 'written.json');
  r = run(['--data', nowhere, '--plugins', path.join(T, 'no-game', 'plugins.txt'), '--write', out]);
  yes('--write with no game folder writes nothing and exits non-zero', r.code !== 0 && !fs.existsSync(out), r.out);

  // 4. No game folder, no --write: the answer on a build runner.
  r = run(['--data', nowhere, '--plugins', path.join(T, 'no-game', 'plugins.txt')]);
  yes('no game folder and no --write is still a SKIP with exit 0', r.code === 0 && /SKIP/.test(r.out), r.out);

  // 5. Every enabled plugin read.
  g = game('all-read', ['Update.esm', 'Here.esp'], '*Here.esp\r\nOff.esp\r\n');
  r = run(['--data', g.data, '--plugins', g.list, '--write', out]);
  yes('every enabled plugin read and nothing needing the Creation Club passes', r.code === 0 && /Special Edition is enough/.test(r.out), r.out);
  yes('  and --write writes its file', fs.existsSync(out), r.out);
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
