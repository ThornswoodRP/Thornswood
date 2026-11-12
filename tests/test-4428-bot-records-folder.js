'use strict';
/*
  test-4428-bot-records-folder.js

      node tests\test-4428-bot-records-folder.js

  #4428. Since #1104 the bot keeps its records in its data folder (DATA_DIR in
  bot\bot_base.py: data under the bot's folder, or the folder the service
  names), yet its comments still said heartbeat.json and the others sit
  beside the code, and the one list of them, in bot_base.py, named four where
  the code writes many more. Someone cleaning up, or handling a deletion
  request by the comments, looks in the wrong place or misses files.

  This reads the bot's code and holds its words to it:

    W  the records: every file the bot's modules put in DATA_DIR, by
       os.path.join(DATA_DIR, '<name>');
    L  bot_base.py's list of them, the comment block that starts
       "THE BOT'S RECORDS", names every one of those, and nothing else but
       bot.log, which the service writes in the same folder (Bot-Service.ps1);
    B  no sentence in the bot's code, its tests, its readme, .gitignore or
       the watchdog's heartbeat test puts one of those records (or "the one",
       "the record", "written by the bot") beside the code, beside this file,
       beside itself or beside bot.py, unless the sentence says it is about
       a box from before the data folder.

  Read only.
*/
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond, more) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what + (more ? '  (' + more + ')' : '')); }
}
const ROOT = path.join(__dirname, '..');
function read(...p) {
  const f = path.join(ROOT, ...p);
  const there = fs.existsSync(f);
  yes('reads ' + path.join(...p), there);
  return there ? fs.readFileSync(f, 'utf8').split('\r\n').join('\n') : '';
}
const BOT = path.join(ROOT, 'bot');
const modules = fs.readdirSync(BOT).filter((n) => /\.py$/.test(n)).sort();
const tests = fs.existsSync(path.join(BOT, 'tests'))
  ? fs.readdirSync(path.join(BOT, 'tests')).filter((n) => /\.py$/.test(n)).sort() : [];

/* ---- W: what the code writes in the data folder ------------------------- */
console.log('W, the records the code keeps in DATA_DIR:');
const written = new Map();
for (const n of modules) {
  const t = fs.readFileSync(path.join(BOT, n), 'utf8');
  const re = /os\.path\.join\(\s*DATA_DIR\s*,\s*'([^']+)'\s*\)/g;
  let m;
  while ((m = re.exec(t))) if (!written.has(m[1])) written.set(m[1], n);
}
yes('the bot\'s modules put records in DATA_DIR (' + [...written.keys()].sort().join(', ') + ')', written.size >= 10);

/* ---- L: the one list ---------------------------------------------------- */
console.log('\nL, the list in bot_base.py:');
const BASE = read('bot', 'bot_base.py');
const SERVICE = read('scripts', 'vps', 'Bot-Service.ps1');
const at = BASE.indexOf("# THE BOT'S RECORDS");
yes('bot_base.py has the list, a comment block starting "THE BOT\'S RECORDS"', at >= 0);
const block = at < 0 ? '' : BASE.slice(at).split('\n').filter((l, i, a) => a.slice(0, i + 1).every((x) => /^#/.test(x))).join('\n');
const listed = new Set((block.match(/\b[a-z][a-z0-9-]*\.(?:json|txt|pem|log)\b/g) || []));
const missing = [...written.keys()].filter((n) => !listed.has(n)).sort();
yes('the list names every record the code writes there', at >= 0 && missing.length === 0,
  missing.map((n) => n + ' (' + written.get(n) + ')').join(', '));
const extra = [...listed].filter((n) => !written.has(n) && n !== 'bot.log').sort();
yes('and nothing the code does not write there, but bot.log', at >= 0 && extra.length === 0, extra.join(', '));
yes('bot.log is in the list, and the service writes it in that folder',
  listed.has('bot.log') && SERVICE.indexOf("Join-Path (Join-Path $Root 'data') 'bot.log'") >= 0);
yes('the list says where the folder is: data under the bot\'s folder, or THORNSWOOD_BOT_DATA',
  /THORNSWOOD_BOT_DATA/.test(block) && /\bdata\b/.test(block));

/* ---- B: nothing puts a record beside the code --------------------------- */
console.log('\nB, where the comments put the records:');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const records = [...written.keys()].concat(['bot.log']);
const TOKEN = new RegExp('(?:' + records.map(esc).join('|') +
  '|\\bthe one beside\\b|\\bthe record\\b|\\bwritten by the bot\\b)', 'gi');
const BESIDE = /beside (?:this file|itself|the code|bot\.py)/gi;
// A sentence about the layout before the data folder, which is still true of
// an old box, says so.
const BEFORE = /before #1104|no data folder|older|used to be|rather than beside|not beside|instead of beside/i;
function flat(text) {
  return text.split('\n').map((l) => l.replace(/^\s*(?:#+|\/\/+|\*+|<#|#>)?\s*/, '')).join(' ').replace(/\s+/g, ' ');
}
const scanned = modules.map((n) => ['bot', n]).concat(tests.map((n) => ['bot', 'tests', n]),
  [['bot', 'README.md'], ['.gitignore'], ['tests', 'test-bot-heartbeat.ps1']]);
const wrong = [];
for (const p of scanned) {
  const f = path.join(ROOT, ...p);
  if (!fs.existsSync(f)) { yes('reads ' + path.join(...p), false); continue; }
  for (const s of flat(fs.readFileSync(f, 'utf8').split('\r\n').join('\n')).split(/(?<=[.!?])\s+/)) {
    BESIDE.lastIndex = 0;
    let b;
    while ((b = BESIDE.exec(s))) {
      TOKEN.lastIndex = 0;
      let t, near = null;
      while ((t = TOKEN.exec(s))) if (Math.abs(t.index - b.index) < 200) { near = t[0]; break; }
      if (near && !BEFORE.test(s)) {
        wrong.push(path.join(...p) + ': "' + s.slice(Math.max(0, Math.min(t.index, b.index) - 20), Math.max(t.index, b.index) + 40) + '"');
        break;
      }
    }
  }
}
yes('no comment puts a record beside the code (' + scanned.length + ' files read)', wrong.length === 0,
  '\n      ' + wrong.join('\n      '));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
