'use strict';
/*
  test-4365-node-minimum.js

      node tests\test-4365-node-minimum.js

  Issue #4365. The site sets its trusted roots with tls.getCACertificates
  and tls.setDefaultCACertificates (site\lib\base.js, #3111), which Node 20
  does not have, so on Node 20 it stopped at start with a raw TypeError and
  a stack, and nothing said which Node it needs. This holds:

    A  site\lib\node-version.js says the lowest Node is 22.19 on the 22 line
       or 24.5 and later, and its verdict passes and refuses the right
       versions, a Node whose number passes but has no such calls included.
    B  server.js asks it before anything else in the site is loaded, the
       --strip-metadata start included, and stops with exit 1.
    C  a copy of the site started on a pretend Node 20 (process.versions.node
       says 20.11.1 and tls has neither call, as on Node 20) stops with
       exactly one line on stderr, naming the Node it needs and 20.11.1, and
       no stack.
    D  site\README.md and docs\guide\tools.md, the Developer Guide's Node
       section, name that same minimum.
    E  this Node, the one the gate runs on, passes, and has both calls.

  The copy runs in a scratch folder under the temp folder, removed at the
  end; nothing leaves the machine.
*/
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const siteFiles = require('./site-files');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (detail ? '\n      ' + String(detail).trim().split('\n').join('\n      ') : '')); }
}
const read = (rel) => { try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch (e) { return null; } };

// ---- A: the minimum and the verdict
let nv = null;
try { nv = require(path.join(ROOT, 'site', 'lib', 'node-version.js')); } catch (e) { nv = null; }
yes('A1 site\\lib\\node-version.js is there and says the lowest Node',
  !!nv && nv.NEEDS === 'Node 22.19 or later, or 24.5 or later' && typeof nv.nodeVerdict === 'function');
const both = { getCACertificates() {}, setDefaultCACertificates() {} };
const cases = [
  ['20.11.1', false], ['22.14.0', false], ['22.18.0', false], ['22.19.0', true], ['22.23.4', true],
  ['23.11.1', false], ['24.4.1', false], ['24.5.0', true], ['24.21.0', true], ['26.0.0', true]
];
const wrong = nv ? cases.filter(([v, ok]) => (nv.nodeVerdict(v, both) === null) !== ok).map(([v]) => v) : ['all'];
yes('A2 it passes 22.19 and later on 22, and 24.5 and later, and refuses 20, 22.18, 23 and 24.4' +
  (wrong.length ? ' (wrong on ' + wrong.join(', ') + ')' : ''), wrong.length === 0);
const lacking = nv ? nv.nodeVerdict('24.21.0', { getCACertificates() {} }) : null;
yes('A3 a Node whose number passes but has no setDefaultCACertificates is refused, and the line says so',
  typeof lacking === 'string' && lacking.indexOf('24.21.0') >= 0 && lacking.indexOf('setDefaultCACertificates') >= 0, lacking);

// ---- B: server.js asks first
const server = read('site/server.js') || '';
const asks = server.indexOf("require('./lib/node-version')");
const firstOther = (() => {
  const re = /require\('\.\/lib\/(?!node-version')/g;
  const m = re.exec(server);
  return m ? m.index : -1;
})();
yes('B1 server.js asks node-version.js before it loads any other part of the site, the --strip-metadata start included',
  asks >= 0 && firstOther > asks);
const stop = asks >= 0 ? server.slice(asks, asks + 300) : '';
yes('B2 and stops with exit 1 on its line', /console\.error\(/.test(stop) && /process\.exit\(1\)/.test(stop));

// ---- C: a copy on a pretend Node 20
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-4365-'));
try {
  siteFiles.copy(path.join(dir, 'site'));
  const old = path.join(dir, 'node-20.js');
  fs.writeFileSync(old,
    "const tls = require('tls');\n" +
    "Object.defineProperty(process.versions, 'node', { value: '20.11.1' });\n" +
    "delete tls.getCACertificates;\n" +
    "delete tls.setDefaultCACertificates;\n");
  const env = Object.assign({}, process.env, { THORNSWOOD_DOCS_PORT: '0', THORNSWOOD_DOCS_LOCAL: '1' });
  const probe = spawnSync(process.execPath, ['--require', old, '-p',
    "process.versions.node + ' ' + typeof require('tls').setDefaultCACertificates"], { encoding: 'utf8', env, timeout: 30000 });
  yes('C1 the pretend Node says 20.11.1 and has no setDefaultCACertificates', String(probe.stdout).trim() === '20.11.1 undefined',
    probe.stdout + probe.stderr);
  const run = spawnSync(process.execPath, ['--require', old, path.join(dir, 'site', 'server.js')],
    { cwd: path.join(dir, 'site'), encoding: 'utf8', env, timeout: 30000 });
  const errLines = String(run.stderr).split(/\r?\n/).filter((l) => l.trim());
  const want = 'The site needs Node 22.19 or later, or 24.5 or later; this is Node 20.11.1.';
  yes('C2 the site stops with exit 1 (got ' + run.status + (run.signal ? ', ' + run.signal : '') + ')', run.status === 1);
  yes('C3 with one line on stderr, naming the Node it needs and the one it found, and no stack',
    errLines.length === 1 && errLines[0] === want, run.stderr);
  yes('C4 and starts nothing first', !/listening on/.test(String(run.stdout)), run.stdout);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- D: the docs
const readme = read('site/README.md') || '';
yes('D1 site\\README.md names the lowest Node', readme.indexOf('Node 22.19 or later, or 24.5 or later') >= 0);
const guide = read('docs/guide/tools.md') || '';
const jAt = guide.indexOf('## J. Node');
const jEnd = jAt < 0 ? -1 : guide.indexOf('\n## ', jAt + 5);
const j = jAt < 0 ? '' : guide.slice(jAt, jEnd < 0 ? undefined : jEnd);
yes('D2 the Developer Guide\'s Node section names it', j.indexOf('Node 22.19 or later, or 24.5 or later') >= 0);
yes('D3 the site has no package.json to name it in engines', !fs.existsSync(path.join(ROOT, 'site', 'package.json')));

// ---- E: this Node
const tls = require('tls');
yes('E1 this Node (' + process.version + ') passes and has both calls',
  !!nv && nv.nodeVerdict(process.versions.node, tls) === null &&
  typeof tls.getCACertificates === 'function' && typeof tls.setDefaultCACertificates === 'function');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
