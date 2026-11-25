'use strict';
// Build-Gamemode.js: builds game/gamemode.js, the one file the server loads,
// from its TypeScript source in game/gamemode (#2181 option D, the plan's
// rev 64). scripts/dev/gamemode-source.js says how; docs/GAMEMODE-SOURCE.md
// is the design.
//
//   node scripts/dev/Build-Gamemode.js              write the code bundles into the parts, then
//                                                   game/gamemode.js from the parts
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
// A stop says what went wrong (when there is anything to say) and the code
// to end with. main returns or throws one instead of calling node's exit
// function, which can hang on Node 24 (#6036).
class Stop extends Error {
  constructor(message, code) { super(message); this.code = code; }
}
function arg(name) {
  const i = args.indexOf(name);
  if (i < 0) return null;
  if (i + 1 >= args.length) throw new Stop(name + ' needs a value', 2);
  return args[i + 1];
}
const rel = (p) => path.relative(source.ROOT, p).split(path.sep).join('/');

function firstDifference(a, b) {
  const x = a.split('\n'), y = b.split('\n');
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) return i + 1;
  return 0;
}

// The bundles of game code the parts carry, built with the gamemode (#6195):
// neither is a step of the content chain, so a content build never writes
// gamemode code, and a build laid over a newer checkout never puts older
// code back. Each splices its game/*.js sources into its part.
const BUNDLES = ['Build-MerchantGamemode.js', 'Build-MarketStallsGamemode.js'];
function bundles(words) {
  for (const bundle of BUNDLES) {
    const r = spawnSync(process.execPath, [path.join(__dirname, bundle)].concat(words), { cwd: source.ROOT, encoding: 'utf8' });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    if (r.status !== 0) throw new Stop('', r.status || 1);
  }
}

function main() {
  const dir = arg('--source') ? path.resolve(arg('--source')) : source.SOURCE;

  if (args.includes('--check')) {
    if (dir === source.SOURCE) bundles(['--check']);
    const built = source.build(dir);
    const out = source.builtPath(dir);
    const committed = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (built !== committed) {
      const n = firstDifference(built, committed);
      const w = source.where(dir, n);
      console.error('FAIL  ' + rel(out) + ' is not what ' + rel(dir) + ' builds; the first line that differs is ' + n
        + (w ? ' (' + w.part + ' line ' + w.line + ')' : '') + '.');
      console.error('      The parts are the source: make the change there, then run node scripts/dev/Build-Gamemode.js.');
      return 1;
    }
    console.log('PASS  ' + rel(out) + ' is what the ' + source.order(dir).length + ' parts in ' + rel(dir) + ' build');
    return 0;
  }

  const at = arg('--where');
  if (at !== null) {
    const n = Number(at);
    if (!Number.isInteger(n) || n < 1) throw new Stop('--where takes a line number', 2);
    const w = source.where(dir, n);
    if (!w) throw new Stop(rel(source.builtPath(dir)) + ' has no line ' + n, 1);
    console.log(rel(path.join(dir, w.part)) + ':' + w.line);
    return 0;
  }

  const readTo = arg('--read');
  if (readTo !== null) {
    fs.writeFileSync(readTo, source.joined(dir));
    return 0;
  }

  const writeFrom = arg('--write');
  if (writeFrom !== null) {
    source.write(dir, fs.readFileSync(writeFrom, 'utf8'));
    return 0;
  }

  if (args.length && !(args.length === 2 && arg('--source'))) throw new Stop('unknown arguments: ' + args.join(' '), 2);
  if (dir === source.SOURCE) bundles([]);
  const changed = source.writeBuilt(dir);
  console.log((changed ? 'wrote ' : 'unchanged ') + rel(source.builtPath(dir)) + ' from ' + source.order(dir).length + ' parts');
  return 0;
}

// What the source module throws (a part that will not join, a line out of
// range) is said on one FAIL line, as before.
try {
  process.exitCode = main();
} catch (e) {
  if (e.message) console.error('FAIL  ' + e.message);
  process.exitCode = e instanceof Stop ? e.code : 1;
}
