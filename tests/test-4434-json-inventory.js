'use strict';
/*
  test-4434-json-inventory.js

      node tests\test-4434-json-inventory.js

  #4434. docs\JSON-STATE-INVENTORY.md lists the JSON the site, the bot and
  the release records keep, who writes each and who reads it. Nothing tied it
  to the code, so it drifted: stores the site writes were missing, the bot's
  own records were put down to the site or the game server, files only the
  site reads were put down as the site's writing, and the count of records
  the record checker holds was out of date.

  This reads the code and holds the page to it:

    S  the site's stores: every constant in site\lib that is a JSON file in
       the site's data folder, for-bot, from-bot, uploads or its own folder,
       and the session-logs folder. The site writes one when site\lib hands
       that constant to putJson or writeFileSync;
    B  the bot's stores: every constant in bot\*.py that is a JSON file in the
       bot's data folder, or a default path into the site's for-bot or
       from-bot folder. The bot writes one when it hands it to _state_write,
       opens it for writing, or moves a temp file onto it; it reads the ones
       it opens;
    P  every one of those is on the page; a row's "Written by" names the site
       exactly when the site writes the file and the bot exactly when the bot
       does; for-bot files name the bot among their readers and the site's
       own data files never do (the bot is granted nothing else there,
       Bot-Service.ps1);
    R  the page's count of the records RecordShape.ps1 holds is the number of
       committed records it names, each of their rows says **held**, and the
       sentence about records that must say their version names every one
       whose MustSay is true.

  Reads only.
*/
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PAGE = path.join(ROOT, 'docs', 'JSON-STATE-INVENTORY.md');
const SITE_LIB = path.join(ROOT, 'site', 'lib');
const BOT = path.join(ROOT, 'bot');
const SHAPE = path.join(ROOT, 'scripts', 'release', 'RecordShape.ps1');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const read = (p) => fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ------------------------------------------------------------------- S --
const siteSrc = fs.readdirSync(SITE_LIB).filter((f) => f.endsWith('.js'))
  .map((f) => read(path.join(SITE_LIB, f))).join('\n');
const site = {};   // file -> { folder, writes }
const FOLDERS = { DATA: 'data', FOR_BOT: 'for-bot', FROM_BOT: 'from-bot', UP: 'uploads', ROOT: 'site' };
// A function that writes the file it is handed as its first argument
// (noteRules(file, ...) puts rules-accepted.json): a call handing it a
// store's constant is a write of that store.
const writers = ['putJson', 'fs\\.writeFileSync'];
for (const m of siteSrc.matchAll(/^function ([A-Za-z_]+)\(([A-Za-z_]+)[,)]/gm)) {
  const open = siteSrc.indexOf('{', m.index);
  let d = 0, end = open;
  for (let i = open; i < siteSrc.length; i++) {
    if (siteSrc[i] === '{') d++;
    else if (siteSrc[i] === '}') { d--; if (d === 0) { end = i; break; } }
  }
  if (new RegExp('\\b(?:putJson|fs\\.writeFileSync)\\(' + m[2] + '\\b').test(siteSrc.slice(open, end))) writers.push(m[1]);
}
for (const m of siteSrc.matchAll(/^const ([A-Z_]+)\s*=\s*path\.join\((DATA|FOR_BOT|FROM_BOT|UP|ROOT), '([a-z0-9-]+\.json)'\);/gm)) {
  const name = m[1];
  const writes = new RegExp('\\b(?:' + writers.join('|') + ')\\(' + esc(name) + '\\b').test(siteSrc);
  site[m[3]] = { folder: FOLDERS[m[2]], writes, name };
}
const slogs = /^const SLOGS\s*=\s*path\.join\(DATA, 'session-logs'\);/m.test(siteSrc);

console.log('S. the site\'s stores:');
yes('site\\lib names its JSON stores (' + Object.keys(site).length + ')', Object.keys(site).length >= 15);
yes('and keeps launcher log sets in session-logs', slogs);

// ------------------------------------------------------------------- B --
const botSrc = fs.readdirSync(BOT).filter((f) => f.endsWith('.py'))
  .map((f) => read(path.join(BOT, f))).join('\n');
const bot = {};    // file -> { folder, writes, reads }
for (const m of botSrc.matchAll(/^([A-Z_]+)\s*=\s*os\.path\.join\(DATA_DIR, '([a-z0-9-]+\.json)'\)/gm)) {
  bot[m[2]] = { folder: 'bot', name: m[1] };
}
// The heartbeat's place is a setting whose default is in the data folder.
for (const m of botSrc.matchAll(/^([A-Z_]+)\s*=\s*os\.environ\.get\(\s*'[A-Z_]+',\s*os\.path\.join\(DATA_DIR, '([a-z0-9-]+\.json)'\)\)/gm)) {
  bot[m[2]] = { folder: 'bot', name: m[1] };
}
// Its defaults into the site's folders.
for (const m of botSrc.matchAll(/^([A-Z_]+)\s*=\s*os\.environ\.get\(\s*'[A-Z_]+',\s*r'[^']*\\(for-bot|from-bot)\\([a-z0-9-]+\.json)'\)/gm)) {
  bot[m[3]] = { folder: m[2], name: m[1] };
}
for (const f of Object.keys(bot)) {
  const n = esc(bot[f].name);
  bot[f].writes = new RegExp('_state_write\\((?:path or )?' + n + '\\b|os\\.replace\\(tmp, ' + n + '\\)' +
    '|path = path or ' + n + '\\b|open\\(' + n + ', \'w\'').test(botSrc);
  bot[f].reads = new RegExp('open\\(' + n + '\\b|_state_read\\((?:path or )?' + n + '\\b').test(botSrc);
}
console.log('\nB. the bot\'s stores:');
yes('bot\\*.py names its JSON stores (' + Object.keys(bot).length + ')', Object.keys(bot).length >= 12);

// ------------------------------------------------------------------- P --
const page = read(PAGE);
// Every table row, with the section it is in, its files and its cells.
const rows = [];
let section = '';
for (const line of page.split(/\r?\n/)) {
  const h = /^##+\s+(.*)$/.exec(line);
  if (h) { section = h[1]; continue; }
  if (!/^\|/.test(line) || /^\|\s*-/.test(line)) continue;
  const cells = line.split('|').slice(1, -1).map((c) => c.trim());
  if (cells[0] === 'File' || cells.length < 3) continue;
  const files = Array.from(cells[0].matchAll(/`([^`]+)`/g)).map((m) => m[1]);
  rows.push({ section, cells, files, line });
}
const named = (r, f) => r.files.some((x) => x === f || x.split('/').pop() === f || x.split('\\').pop() === f);
const STATE = /Site, bot and voice state/;
// A site or bot store is looked for in the site, bot and voice table first:
// another table can name a different file of the same name (the launcher's
// own config.json is in the built and deployed table).
const rowOf = (f) => rows.find((r) => STATE.test(r.section) && named(r, f)) || rows.find((r) => named(r, f));
const says = (cell, who) => new RegExp('\\b' + who + '\\b').test(cell || '');

console.log('\nP. the page against them:');
const missing = [], wrongWriter = [], wrongReaders = [];
for (const f of Object.keys(site)) {
  const r = rowOf(f);
  if (!r) { missing.push(f); continue; }
  const botWrites = !!(bot[f] && bot[f].writes);
  if (says(r.cells[1], 'site') !== site[f].writes) wrongWriter.push(f + (site[f].writes ? ' (the site writes it)' : ' (the site only reads it)'));
  if (says(r.cells[1], 'bot') !== botWrites) wrongWriter.push(f + (botWrites ? ' (the bot writes it)' : ' (the bot does not write it)'));
  if (site[f].folder === 'for-bot' && !says(r.cells[2], 'bot')) wrongReaders.push(f + ' (in for-bot, the bot reads it)');
  if (site[f].folder === 'data' && says(r.cells[2], 'bot')) wrongReaders.push(f + ' (the bot is granted nothing in data but for-bot)');
  if (site[f].folder === 'from-bot' && !says(r.cells[2], 'site')) wrongReaders.push(f + ' (the site reads it)');
}
for (const f of Object.keys(bot)) {
  if (site[f]) continue;
  const r = rowOf(f);
  if (!r) { missing.push(f); continue; }
  if (says(r.cells[1], 'bot') !== bot[f].writes) wrongWriter.push(f + (bot[f].writes ? ' (the bot writes it)' : ' (the bot does not write it)'));
  if (says(r.cells[1], 'site')) wrongWriter.push(f + ' (the site does not write it)');
  if (bot[f].reads && !says(r.cells[2], 'bot')) wrongReaders.push(f + ' (the bot reads it)');
}
// A row in the site, bot and voice table that names the site or the bot as
// a writer of a file neither code writes.
for (const r of rows.filter((x) => STATE.test(x.section))) {
  for (const f of r.files.filter((x) => !/^session-logs\//.test(x)).map((x) => x.split('/').pop())) {
    if (!/\.json$/.test(f) || site[f] || bot[f]) continue;
    if (says(r.cells[1], 'site')) wrongWriter.push(f + ' (the site does not write it)');
    if (says(r.cells[1], 'bot')) wrongWriter.push(f + ' (the bot does not write it)');
  }
}
const slogRow = rows.find((r) => r.files.some((x) => /session-logs/.test(x)));
yes('every store the site and bot keep is on the page' + (missing.length ? ', not: ' + missing.join(', ') : ''), missing.length === 0);
yes('each row names the right writer' + (wrongWriter.length ? ', not: ' + wrongWriter.join('; ') : ''), wrongWriter.length === 0);
yes('and the right readers' + (wrongReaders.length ? ', not: ' + wrongReaders.join('; ') : ''), wrongReaders.length === 0);
yes('the launcher log sets in session-logs are on it, written by the site', !!slogRow && says(slogRow.cells[1], 'site'));

// ------------------------------------------------------------------- R --
console.log('\nR. the records the checker holds:');
const shape = read(SHAPE);
const kinds = Array.from(shape.matchAll(/^\s*'([a-z-]+)'\s*=\s*@\{\s*File = 'records\\([a-z0-9-]+\.json)';[^\n]*MustSay = \$(true|false)/gm))
  .map((m) => ({ kind: m[1], file: m[2], mustSay: m[3] === 'true' }));
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven',
  'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
const counted = /the (\w+) (?:committed records )?in `scripts\\release\\RecordShape\.ps1`/.exec(page);
const saidN = counted ? (/^\d+$/.test(counted[1]) ? Number(counted[1]) : WORDS.indexOf(counted[1].toLowerCase())) : -1;
yes('RecordShape.ps1 holds committed records (' + kinds.length + ')', kinds.length >= 11);
yes('the page counts them as the checker does (it says ' + (counted ? counted[1] : 'no count') + ', the checker holds ' + kinds.length + ')',
    saidN === kinds.length);
const notHeld = kinds.filter((k) => { const r = rowOf(k.file); return !r || !/\*\*held\*\*/.test(r.cells[4] || ''); });
yes('each of their rows says it is held' + (notHeld.length ? ', not: ' + notHeld.map((k) => k.file).join(', ') : ''), notHeld.length === 0);
const sayPara = (page.split(/\n\s*\n|\n- /).find((p) => /\(`MustSay`\)/.test(p)) || '');
const unsaid = kinds.filter((k) => k.mustSay && sayPara.indexOf('`' + k.file + '`') < 0);
yes('the records that must say their version are all named as such' + (unsaid.length ? ', not: ' + unsaid.map((k) => k.file).join(', ') : ''),
    !!sayPara && unsaid.length === 0);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
