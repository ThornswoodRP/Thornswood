'use strict';
// test-2181-gamemode-source.js: the gamemode's TypeScript source and its build
// (#2181 option D, the plan's rev 64).
//
//   A. game/gamemode.js is exactly what the parts in game/gamemode build, and
//      every part is a TypeScript script whose types strip to the same lines.
//   B. On a scratch copy of the source: the joined source reads and writes
//      back with no change; an edit inside one part changes that part and the
//      built file and nothing else; a type annotation builds to the same line;
//      --where names the part and the line.
//   C. What is refused, with nothing written: a part listed twice, listed and
//      missing, present and unlisted; a joined source that renames, drops or
//      adds a part; a part that does not parse; a hand edit to the built file
//      (--check).
//   D. The Python builders' helper reads and writes the same joined source
//      through Build-Gamemode.js, and a plain file as it is.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const build = path.join(root, 'scripts', 'dev', 'Build-Gamemode.js');
const source = require(path.join(root, 'scripts', 'dev', 'gamemode-source.js'));
let pass = 0, fail = 0;
function yes(w, ok) { if (ok) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }
function run(args, opts) { return spawnSync(process.execPath, [build].concat(args), Object.assign({ cwd: root, encoding: 'utf8' }, opts)); }
function threw(f) { try { f(); return null; } catch (e) { return e.message; } }

// A. The committed source and its build.
const doc = fs.readFileSync(path.join(root, 'docs', 'GAMEMODE-SOURCE.md'), 'utf8');
yes('GAMEMODE-SOURCE records Patrick decision D', /Decision \(Patrick, 12 Oct 2026\): D/.test(doc));
const check = run(['--check']);
yes('Build-Gamemode --check passes on the checkout', check.status === 0);
yes('it says gamemode.js is what the parts build', /PASS  game\/gamemode\.js is what the \d+ parts in game\/gamemode build/.test(check.stdout));
const parts = source.order(source.SOURCE);
yes('order.json lists more than one part', parts.length > 1);
const committed = fs.readFileSync(path.join(root, 'game', 'gamemode.js'), 'utf8');
yes('the parts joined as they are, with nothing between them, are gamemode.js',
  parts.map((p) => fs.readFileSync(path.join(source.SOURCE, p), 'utf8')).join('') === committed);
yes('the built file says it is built and where its source is', /This file is built\. Its source is the TypeScript parts in game\/gamemode/.test(committed));

// B. A scratch copy of the source.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-2181-'));
const dir = path.join(tmp, 'gamemode');
function fresh(files) {
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), t);
  fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ parts: Object.keys(files).filter((n) => n.endsWith('.ts')) }));
  source.writeBuilt(dir);
}
const A = "'use strict';\nconst a = 1;\n";
const B = '// ==== T, generated ====\nconst T = [1, 2];\n// ==== end T ====\n\n';
const C = 'function c(x) { return a + x; }\n';
fresh({ 'a.ts': A, 'b.ts': B, 'c.ts': C });
const built = path.join(tmp, 'gamemode.js');
yes('a scratch source builds beside itself', fs.readFileSync(built, 'utf8') === A + B + C);
const joined = source.read(dir);
yes('the joined source puts one @part line before each part', joined === '// @part a.ts\n' + A + '// @part b.ts\n' + B + '// @part c.ts\n' + C);
const before = fs.statSync(path.join(dir, 'a.ts')).mtimeMs;
source.write(dir, joined);
yes('writing the joined source back unchanged changes no part', ['a.ts', 'b.ts', 'c.ts'].every((n, i) => fs.readFileSync(path.join(dir, n), 'utf8') === [A, B, C][i]));
yes('a part ending in a blank line keeps it', fs.readFileSync(path.join(dir, 'b.ts'), 'utf8').endsWith('\n\n'));
source.write(dir, joined.replace('const T = [1, 2];', 'const T = [3, 4, 5];'));
yes('an edit between markers lands in its part', fs.readFileSync(path.join(dir, 'b.ts'), 'utf8').includes('const T = [3, 4, 5];'));
yes('and the other parts are left as they were', fs.readFileSync(path.join(dir, 'a.ts'), 'utf8') === A && fs.statSync(path.join(dir, 'a.ts')).mtimeMs === before);
yes('and the built file is rebuilt', fs.readFileSync(built, 'utf8').includes('const T = [3, 4, 5];'));
fs.writeFileSync(path.join(dir, 'c.ts'), 'function c(x: number): number { return a + x; }\n');
source.writeBuilt(dir);
const typed = fs.readFileSync(built, 'utf8').split('\n');
yes('a type annotation strips to spaces on the same line', typed[typed.length - 2] === 'function c(x        )         { return a + x; }');
yes('--where names the part and the line in it', run(['--where', '6', '--source', dir]).stdout.trim() === path.relative(root, path.join(dir, 'b.ts')).split(path.sep).join('/') + ':4');
yes('--where past the end fails', run(['--where', '999', '--source', dir]).status === 1);

// C. Refusals.
fresh({ 'a.ts': A, 'b.ts': B });
const was = fs.readFileSync(built, 'utf8');
fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ parts: ['a.ts', 'b.ts', 'a.ts'] }));
yes('a part listed twice is refused', /listed twice: a\.ts/.test(threw(() => source.build(dir))));
fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ parts: ['a.ts', 'b.ts', 'z.ts'] }));
yes('a part listed and missing is refused', /listed but not there: z\.ts/.test(threw(() => source.build(dir))));
fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ parts: ['a.ts'] }));
yes('a part there and not listed is refused', /there but not listed: b\.ts/.test(threw(() => source.build(dir))));
fs.writeFileSync(path.join(dir, 'order.json'), JSON.stringify({ parts: ['a.ts', 'b.ts'] }));
const j2 = source.read(dir);
yes('a joined source that renames a part is refused', /names its parts differently/.test(threw(() => source.write(dir, j2.replace('// @part b.ts', '// @part x.ts')))));
yes('one that drops a part is refused', /names its parts differently/.test(threw(() => source.write(dir, j2.replace('// @part b.ts\n', '')))));
yes('one that adds a part is refused', /names its parts differently/.test(threw(() => source.write(dir, j2 + '// @part c.ts\nconst c = 1;\n'))));
yes('one with text before its first part is refused', /before its first/.test(threw(() => source.write(dir, 'x\n' + j2))));
yes('one that breaks a part is refused', /b\.ts/.test(threw(() => source.write(dir, j2.replace('const T = [1, 2];', 'const T = [1, 2;')))));
yes('and nothing was written by any of them', fs.readFileSync(path.join(dir, 'b.ts'), 'utf8') === B && fs.readFileSync(built, 'utf8') === was);
fs.writeFileSync(built, was.replace('const a = 1;', 'const a = 2;'));
const hand = run(['--check', '--source', dir]);
yes('a hand edit to the built file fails --check', hand.status === 1 && /is not what .* builds; the first line that differs is 2 \(a\.ts line 2\)/.test(hand.stderr));

// D. The Python helper.
fresh({ 'a.ts': A, 'b.ts': B });
const py = process.platform === 'win32' ? 'py' : 'python3';
const pyArgs = [];
const pyCode = [
  'import sys', 'sys.path.insert(0, sys.argv[1])', 'import gamemode_source as g',
  't = g.read(sys.argv[2])', "assert t.startswith('// @part a.ts\\n'), t[:40]",
  "g.write(sys.argv[2], t.replace('[1, 2]', '[7]'))",
  "import io", "io.open(sys.argv[3], 'w', newline='').write('plain\\n')", "assert g.read(sys.argv[3]) == 'plain\\n', repr(g.read(sys.argv[3]))",
  "g.write(sys.argv[3], 'plain two\\n')", 'print("ok")'
].join('\n');
const plain = path.join(tmp, 'plain.js');
const pr = spawnSync(py, pyArgs.concat(['-c', pyCode, path.join(root, 'scripts', 'dev'), dir, plain]), { encoding: 'utf8' });
if (pr.status !== 0) console.log(String(pr.stderr || pr.error || '').split('\n').map((l) => '      ' + l).join('\n'));
yes('the Python helper writes an edit into its part and builds', pr.status === 0 && fs.readFileSync(path.join(dir, 'b.ts'), 'utf8').includes('const T = [7];') && fs.readFileSync(built, 'utf8').includes('const T = [7];'));
yes('and reads and writes a plain file as it is', fs.existsSync(plain) && fs.readFileSync(plain, 'utf8') === 'plain two\n');
fs.rmSync(tmp, { recursive: true, force: true });
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
