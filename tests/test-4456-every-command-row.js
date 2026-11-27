'use strict';
/*
  test-4456-every-command-row.js

      node tests/test-4456-every-command-row.js

  #4456. docs/systems/commands.md is meant to list every line starting with a
  slash that the game answers, and it had fallen behind: /world,
  /companyterms, /hairdye, /ship and others were answered by the server and
  on no row.

  The words the server answers are read from the parts in game/gamemode:
    - WORDS in chat-commands.ts, the words the chat block hands on;
    - every branch that tests word === '/x' or word !== '/x';
    - every word the command catalog registers (word: '/x').
  Each needs a row in one of the page's three tables (Commands for people,
  Staff and dev commands, Lines the game sends itself), named in the row's
  first cell, and each row says who may use it and what it does. A row for
  people also says the button that sends it. Read only.
*/
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PARTS = path.join(ROOT, 'game', 'gamemode');
const read = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ---- the words the server answers ----------------------------------------
const files = fs.readdirSync(PARTS).filter((n) => /\.ts$/.test(n)).sort();
const said = new Map();
function add(word, where) { if (!said.has(word)) { said.set(word, where); } }

const chat = read(path.join(PARTS, 'chat-commands.ts'));
const at = chat.indexOf('const WORDS = [');
const end = at < 0 ? -1 : chat.indexOf('];', at);
yes('chat-commands.ts has its WORDS list', at >= 0 && end > at);
const list = at >= 0 && end > at ? chat.slice(at, end).replace(/\/\/[^\n]*/g, '') : '';
let m;
const quoted = /'(\/[a-z0-9-]+)'/g;
let fromList = 0;
while ((m = quoted.exec(list))) { add(m[1], 'WORDS in chat-commands.ts'); fromList++; }
yes('and it has words in it (' + fromList + ')', fromList > 50);

let branches = 0, registered = 0;
for (const name of files) {
  const text = read(path.join(PARTS, name));
  const branch = /\bword\s*[!=]==\s*'(\/[a-z0-9-]+)'/g;
  while ((m = branch.exec(text))) { add(m[1], 'a branch in ' + name); branches++; }
  const help = /\bword:\s*'(\/[a-z0-9-]+)'/g;
  while ((m = help.exec(text))) { add(m[1], 'the command catalog, in ' + name); registered++; }
}
yes('the parts test words in their branches (' + branches + ')', branches > 50);
yes('and the command catalog registers words (' + registered + ')', registered > 5);

// ---- the page's rows -------------------------------------------------------
const page = read(path.join(ROOT, 'docs', 'systems', 'commands.md'));
function section(title) {
  const i = page.indexOf('\n## ' + title + '\n');
  if (i < 0) { return ''; }
  const j = page.indexOf('\n## ', i + 4);
  return page.slice(i, j < 0 ? page.length : j);
}
function rows(text) {
  return text.split('\n').filter((l) => /^\| `/.test(l))
    .map((l) => l.replace(/^\| /, '').replace(/ \|$/, '').split(/ (?<!\\)\| /));
}
const tables = {
  people: rows(section('Commands for people')),
  staff: rows(section('Staff and dev commands')),
  lines: rows(section('Lines the game sends itself'))
};
for (const k of Object.keys(tables)) {
  yes('the page has its ' + k + ' table (' + tables[k].length + ' rows)', tables[k].length > 5);
}

const onPage = new Set();
for (const k of Object.keys(tables)) {
  for (const r of tables[k]) {
    const named = /`(\/[a-z0-9-]+)/g;
    while ((m = named.exec(r[0] || ''))) { onPage.add(m[1]); }
  }
}

for (const [word, where] of Array.from(said.entries()).sort()) {
  yes(word + ' (' + where + ') has a row', onPage.has(word));
}

// ---- each row says who, what, and for people, the button --------------------
const filled = (cell) => typeof cell === 'string' && cell.trim().length > 0;
for (const r of tables.people) {
  yes('the people row ' + r[0].split(' ')[0] + ' says who, what, and the button',
      r.length >= 6 && filled(r[1]) && filled(r[2]) && filled(r[5]));
}
for (const r of tables.staff) {
  yes('the staff row ' + r[0].split(' ')[0] + ' says who and what', r.length >= 3 && filled(r[1]) && filled(r[2]));
}
for (const r of tables.lines) {
  yes('the line ' + r[0].split(' ')[0] + ' says who sends it and what it reports', r.length >= 3 && filled(r[1]) && filled(r[2]));
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
