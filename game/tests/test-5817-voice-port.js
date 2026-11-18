/* #5817: the gamemode accepted fractional voice ports, making say() throw.
   Runs the production voicePort function with only its settings read stood
   in. No files are written, no sockets opened, and no live service reached.
   Dev fallback must remain Dev; valid custom integer ports and read-once
   caching retain their behavior. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'gamemode', 'small-helpers.ts'), 'utf8');
const start = source.indexOf('let voicePortCached = 0;');
const end = source.indexOf('\n/** Run fn,', start);
if (start < 0 || end < 0) throw new Error('production voice port block not found');
const code = source.slice(start, end);
let pass = 0, fail = 0;
function check(label, got, expected) {
  if (got === expected) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ': expected ' + expected + ', got ' + got); }
}
function load(settings) {
  let reads = 0;
  const box = { log() {}, require(name) {
    if (name !== 'fs') throw new Error('unexpected dependency: ' + name);
    return { readFileSync(file, encoding) {
      reads++;
      if (file !== 'server-settings.json' || encoding !== 'utf8') throw new Error('unexpected settings read');
      if (settings === null) throw new Error('unreadable settings');
      return settings;
    } };
  } };
  vm.createContext(box);
  vm.runInContext(code, box, { filename: 'small-helpers.ts (voicePort)' });
  return { port: () => box.voicePort(), reads: () => reads };
}
for (const channel of ['main', 'dev']) {
  const fallback = channel === 'dev' ? 7789 : 7778;
  for (const [label, value] of [['fractional', 7778.5], ['zero', 0], ['negative', -1],
    ['above maximum', 65536], ['non-numeric', 'oops'], ['absent', undefined]]) {
    const loaded = load(JSON.stringify({ thornswoodServer: channel, thornswoodVoicePort: value }));
    check(channel + ' ' + label + ' uses its own fallback', loaded.port(), fallback);
    check(channel + ' ' + label + ' keeps the cached fallback', loaded.port(), fallback);
    check(channel + ' ' + label + ' reads settings once', loaded.reads(), 1);
  }
  for (const port of [1, 65535, 7778, 7789, 7901, '7902']) {
    const loaded = load(JSON.stringify({ thornswoodServer: channel, thornswoodVoicePort: port }));
    check(channel + ' preserves configured integer ' + port, loaded.port(), Number(port));
    loaded.port();
    check(channel + ' configured port is cached', loaded.reads(), 1);
  }
}
for (const [label, settings] of [['unreadable', null], ['malformed', '{'], ['unknown channel', '{"thornswoodServer":"other"}'],
  ['no channel', '{"thornswoodVoicePort":7778.5}']]) {
  check(label + ' retains the existing default', load(settings).port(), 7778);
}
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
