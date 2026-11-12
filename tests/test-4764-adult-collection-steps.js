'use strict';
// test-4764-adult-collection-steps.js
//
//     node tests/test-4764-adult-collection-steps.js
//
// #4764. The install steps said Vortex takes it from there once the
// collection is opened. A new free Nexus Mods account meets two stops first:
// mods in the collection are marked adult, which Nexus hides until the
// account turns adult content on, and a free account presses Slow download
// once for every file. Each place that gives the install steps (join.md's
// step 3, help.md's first install, the Downloads page's collection step) has
// to name both, and help.md has to say what to do when the collection shows
// as hidden.
//
// A count on those steps is held to records/collection.json: files is its
// mods list, one entry a Nexus file, and mods is how many mod pages those
// files come from. A collection change that moves either turns this red
// until the pages say the new number. Which mods Nexus marks adult is not in
// the record, so the pages give no count of those.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function read(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n'); }
  catch (e) { return null; }
}
// From a heading to the next heading of its level, flattened to one line.
function section(text, heading) {
  const at = text.indexOf(heading);
  if (at < 0) return '';
  const rest = text.slice(at + heading.length);
  const end = rest.search(/\n## /);
  return (end < 0 ? rest : rest.slice(0, end)).replace(/\s+/g, ' ');
}

// ------------------------------------------------------------ the record --
const record = JSON.parse(read('records/collection.json') || '{}');
const mods = Array.isArray(record.mods) ? record.mods : [];
const FILES = mods.length;
const MODS = new Set(mods.map(function (m) { return m.modId; })).size;
yes('records/collection.json lists the files the collection installs (' + FILES + ' files from ' + MODS + ' mods)', FILES > 0 && MODS > 0 && MODS <= FILES);

// ------------------------------------------------------------- the steps --
const join = read('site/data/site/join.md') || '';
const help = read('site/data/help.md') || '';
const dl = read('site/lib/downloads.js') || '';
// The Downloads page's collection step is string literals in downloads.js:
// from its heading to the next step, the literals joined, comments left out.
function dlStep() {
  const at = dl.indexOf('<h3>Install the collection in Vortex</h3>');
  if (at < 0) return '';
  const rest = dl.slice(at);
  const end = rest.indexOf('<div class="step">', 10);
  const body = (end < 0 ? rest : rest.slice(0, end)).split('\n')
    .filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
  return (body.match(/'((?:[^'\\]|\\.)*)'/g) || [])
    .map(function (s) { return s.slice(1, -1); }).join('').replace(/<[^>]*>/g, ' ').replace(/&rsquo;/g, '\'').replace(/\s+/g, ' ');
}
const steps = [
  ['join.md, 3. Install the collection in Vortex', section(join, '## 3. Install the collection in Vortex')],
  ['help.md, Installing it the first time', section(help, '## Installing it the first time')],
  ['the Downloads page, Install the collection in Vortex', dlStep()]
];

steps.forEach(function (s) {
  const where = s[0], t = s[1];
  yes(where + ': the step is there', t.length > 0);
  yes(where + ': says to turn adult content on in the Nexus Mods settings',
      /turn on adult content/i.test(t) && /Nexus Mods settings/.test(t));
  yes(where + ': says what a free account presses for each file',
      /free account/i.test(t) && /Slow download/.test(t));
  const files = (t.match(/\b(\d[\d,]*) files\b/g) || []).map(function (m) { return parseInt(m.replace(/[^\d]/g, ''), 10); });
  const modsSaid = (t.match(/\b(\d[\d,]*) mods\b/g) || []).map(function (m) { return parseInt(m.replace(/[^\d]/g, ''), 10); });
  yes(where + ': says how many files, from the record (' + FILES + ')', files.length > 0 && files.every(function (n) { return n === FILES; }));
  yes(where + ': any count of mods is the record\'s (' + MODS + ')', modsSaid.every(function (n) { return n === MODS; }));
});

// ------------------------------------------------- when it shows hidden --
const hidden = (help.match(/^## [^\n]*hidden[^\n]*$/im) || [''])[0];
const hiddenBody = hidden ? section(help, hidden) : '';
yes('help.md has a section for a collection that shows as hidden', hidden.length > 0);
yes('  which says to turn on adult content in the Nexus Mods settings',
    /turn on adult content/i.test(hiddenBody) && /Nexus Mods settings/.test(hiddenBody));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
