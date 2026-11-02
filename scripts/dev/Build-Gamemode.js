'use strict';
// Build-Gamemode.js: builds game/gamemode.js, the one file the server loads,
// from its TypeScript source in game/gamemode (#2181 option D, the plan's
// rev 64). scripts/dev/gamemode-source.js says how; docs/GAMEMODE-SOURCE.md
// is the design.
//
//   node scripts/dev/Build-Gamemode.js              write game/gamemode.js from the parts
//   node scripts/dev/Build-Gamemode.js --check      fail when game/gamemode.js is not what the
//                                                   parts build, or a bundle is not what its
//                                                   own sources make
//   node scripts/dev/Build-Gamemode.js --where 3120 which part line 3120 of gamemode.js is in
//   node scripts/dev/Build-Gamemode.js --read <file>   write the joined source to <file>
//   node scripts/dev/Build-Gamemode.js --write <file>  write the joined source in <file> back
//                                                   into the parts, then build
//
// --read and --write are how a Python builder edits the source
// (scripts/dev/gamemode_source.py).
// --source <folder> names another source folder, built beside it as
// <folder>.js, for a harness.
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const source = require('./gamemode-source.js');

const args = process.argv.slice(2);
function arg(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  if (i + 1 >= args.length) { console.error('FAIL  ' + name + ' needs a value'); process.exit(2); }
  return args[i + 1];
}
const dir = arg('--source') ? path.resolve(arg('--source')) : source.SOURCE;
const rel = (p) => path.relative(source.ROOT, p).split(path.sep).join('/');

function stop(e) { console.error('FAIL  ' + e.message); process.exit(1); }

function firstDifference(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

if (args.includes('--check')) {
  if (dir === source.SOURCE) {
    const r = spawnSync(process.execPath, [path.join(__dirname, 'Build-MerchantGamemode.js'), '--check'], { cwd: source.ROOT, encoding: 'utf8' });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) process.exit(r.status || 1);
  }
  let built;
  try { built = source.build(dir); } catch (e) { stop(e); }
  const out = source.builtPath(dir);
  const committed = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (built !== committed) {
    const n = firstDifference(built, committed);
    const w = source.where(dir, n);
    console.error('FAIL  ' + rel(out) + ' is not what ' + rel(dir) + ' builds; the first line that differs is ' + n
      + (w ? ' (' + w.part + ' line ' + w.line + ')' : '') + '.');
    console.error('      The parts are the source: make the change there, then run node scripts/dev/Build-Gamemode.js.');
    process.exit(1);
  }
  console.log('PASS  ' + rel(out) + ' is what the ' + source.order(dir).length + ' parts in ' + rel(dir) + ' build');
  process.exit(0);
}

const at = arg('--where');
if (at !== null) {
  const n = Number(at);
  if (!Number.isInteger(n) || n < 1) { console.error('FAIL  --where takes a line number'); process.exit(2); }
  let w;
  try { w = source.where(dir, n); } catch (e) { stop(e); }
  if (!w) { console.error('FAIL  ' + rel(source.builtPath(dir)) + ' has no line ' + n); process.exit(1); }
  console.log(rel(path.join(dir, w.part)) + ':' + w.line);
  process.exit(0);
}

const readTo = arg('--read');
if (readTo !== null) {
  try { fs.writeFileSync(readTo, source.joined(dir)); } catch (e) { stop(e); }
  process.exit(0);
}

const writeFrom = arg('--write');
if (writeFrom !== null) {
  try { source.write(dir, fs.readFileSync(writeFrom, 'utf8')); } catch (e) { stop(e); }
  process.exit(0);
}

if (args.length && !(args.length === 2 && arg('--source'))) {
  console.error('FAIL  unknown arguments: ' + args.join(' '));
  process.exit(2);
}
let changed;
try { changed = source.writeBuilt(dir); } catch (e) { stop(e); }
console.log((changed ? 'wrote ' : 'unchanged ') + rel(source.builtPath(dir)) + ' from ' + source.order(dir).length + ' parts');
