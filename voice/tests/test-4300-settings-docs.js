'use strict';
/* #4300. Hold the seven missing voice settings to their documented defaults.
   Read only. The default expressions come from the service, evaluated with
   an empty environment, not from this machine's settings. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'voice-server.js'), 'utf8');
const doc = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');
let passed = 0, failed = 0;
function yes(name, ok) {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + name);
  if (ok) passed++; else failed++;
}
const box = { process: { env: {} }, path, HERE: '/voice' };
function declared(name) {
  const m = new RegExp('^const ' + name + ' = (.+);$', 'm').exec(src);
  if (!m) throw new Error('missing declaration: ' + name);
  return vm.runInNewContext(m[1], box);
}
box.PING_EVERY = declared('PING_EVERY');
const rows = [
  ['THORNSWOOD_CHAT_DIR', 'chat beside the service'],
  ['THORNSWOOD_CHAT_DAYS', String(declared('CHAT_DAYS_MIN')) + ' days'],
  ['THORNSWOOD_TURN_USER', declared('TURN_USER') || 'empty'],
  ['THORNSWOOD_TURN_PASS', declared('TURN_PASS') || 'empty'],
  ['THORNSWOOD_TURN_TTL', String(declared('TURN_TTL')) + ' seconds'],
  ['THORNSWOOD_VOICE_PING_MS', String(box.PING_EVERY) + ' ms'],
  ['THORNSWOOD_VOICE_SILENT_MS', String(declared('SILENT_AFTER')) + ' ms']
];
yes('the default chat folder is beside the service', declared('CHAT_DIR') === path.join('/voice', 'chat'));
for (const [name, value] of rows) {
  const row = doc.split(/\r?\n/).find(l => l.startsWith('| `' + name + '` |')) || '';
  yes(name + ' has a row with its default (' + value + ')', row.includes('| ' + value + ' |'));
}
yes('chat retention describes deletion of old day files', /day files older than the keeping time are deleted/i.test(doc));
yes('chat retention describes the minimum and invalid values', /whole number of 365 or more/.test(doc) && /invalid values use 365/.test(doc));
yes('silence default follows three ping intervals', /three ping intervals/.test(doc));
yes('static relay credentials require both values and no shared key', /both are needed/.test(doc) && /shared key takes precedence/.test(doc));
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exitCode = failed ? 1 : 0;
