'use strict';
// test-4154-lines-log-order.js
//
//     node site\tests\test-4154-lines-log-order.js
//
// #4154 (and #5254, #5300, #5394): site\tests\test-3147-lines.js checks
// "and the site says why in its log" right after the front page answers. The
// site writes that line to stderr before it answers, but the harness reads
// the answer on a socket and the line on a pipe, and nothing orders the two
// in its event loop, so on a busy machine the answer is read first and the
// check fails though the site did log the line.
//
// A busy machine cannot be summoned, so this stands in for it: test-3147-
// lines.js runs with every chunk of its site's stderr handed to it 1.5 s
// after the pipe gave it, in order, as a slow pipe on a loaded machine does.
// The socket is left alone, so the front page's answer is read first. Every
// byte the site wrote still arrives. The check must still pass, and the run
// with it.
//
// Nothing leaves this machine; the hold is a small file in a temp folder.
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');

let pass = 0, fail = 0;
function yes(what, condition, why) {
  console.log((condition ? 'PASS  ' : 'FAIL  ') + what + (!condition && why ? '\n      ' + why : ''));
  if (condition) pass++; else fail++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4154-'));
const hold = path.join(dir, 'slow-stderr.js');
// Loaded into test-3147-lines.js's own process only (its child, the site,
// inherits NODE_OPTIONS and is left alone by the argv test). Each 'data'
// listener on a spawned child's stderr gets its chunks 1.5 s late.
fs.writeFileSync(hold, [
  "'use strict';",
  "if (/test-3147-lines\\.js$/.test(process.argv[1] || '')) {",
  "  const cp = require('child_process');",
  "  const spawn = cp.spawn;",
  "  cp.spawn = function () {",
  "    const child = spawn.apply(this, arguments);",
  "    const err = child.stderr;",
  "    if (err) {",
  "      const on = err.on;",
  "      err.on = function (ev, fn) {",
  "        if (ev !== 'data') return on.apply(this, arguments);",
  "        return on.call(this, ev, function (d) { setTimeout(function () { fn(d); }, 1500).unref(); });",
  "      };",
  "    }",
  "    return child;",
  "  };",
  "}"
].join('\n'));

try {
  const lines = path.join(__dirname, 'test-3147-lines.js');
  const r = spawnSync(process.execPath, [lines], {
    encoding: 'utf8', timeout: 120000,
    env: Object.assign({}, process.env, { NODE_OPTIONS: ((process.env.NODE_OPTIONS || '') + ' --require ' + JSON.stringify(hold)).trim() })
  });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const tail = out.split('\n').filter((l) => /^(FAIL|\d+ passed)/.test(l)).join(' | ');
  yes('test-3147-lines.js ran to its end', /\d+ passed, \d+ failed/.test(out), out.slice(-600));
  yes('a copy of the site still comes up with its stderr slow', /^PASS  a copy of the site comes up$/m.test(out), tail);
  yes('"and the site says why in its log" passes when the log line is read after the answer',
      /^PASS  and the site says why in its log$/m.test(out), tail);
  yes('and the whole run passes', r.status === 0, 'exit ' + r.status + (tail ? ': ' + tail : ''));
} finally {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { console.log('left ' + dir + ': ' + e.message); }
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}
