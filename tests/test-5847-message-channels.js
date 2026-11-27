'use strict';
/*
  test-5847-message-channels.js

      node tests/test-5847-message-channels.js

  Issue #5847. A message the game says to people ended with "Say so in
  #bugs.", and #bugs is gone from the Discord: the plan in
  bot/Apply-Discord.py names it only with make=False, so a prune leaves
  the name alone and nothing makes it. Problems are posted in #test-findings.

  This reads every string in the gamemode's sources (game/gamemode/*.ts,
  comments left out), finds each channel a message sends people to
  ("in #name", "#name in the Discord"), and holds each to the plan: a
  channel the plan makes. A channel named with make=False, or not named at
  all, fails here with its file and line.

  Read only. Never connects to anything.
*/
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(w, c) { if (c) { pass++; console.log('PASS  ' + w); } else { fail++; console.log('FAIL  ' + w); } }

const ROOT = path.join(__dirname, '..');
const CR = String.fromCharCode(13);

// The channels the plan makes: every dict(kind=..., name=...) entry in PLAN
// without make=False.
const plan = fs.readFileSync(path.join(ROOT, 'bot', 'Apply-Discord.py'), 'utf8').split(CR).join('');
const made = new Set();
const unmade = new Set();
const parts = plan.split(/(?=dict\(kind=')/);
for (const part of parts) {
  const m = /^dict\(kind='[^']+',\s*name='([^']+)'/.exec(part);
  if (!m) { continue; }
  const body = part.split(/\n\s*\]\),?\n|\n\]\n/)[0];
  (/\bmake=False\b/.test(body) ? unmade : made).add(m[1]);
}
yes('the Discord plan is read (' + made.size + ' channels it makes)', made.has('test-findings') && made.size > 20);
yes('and #bugs is one it does not make', unmade.has('bugs') && !made.has('bugs'));

// The strings in a TypeScript file, with the line each starts on. Comments
// are skipped; a template literal is taken whole.
function strings(src) {
  const out = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { i++; } continue; }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') { line++; } i++; }
      i += 2;
      continue;
    }
    if (c === '\'' || c === '"' || c === '`') {
      const at = line;
      let text = '';
      i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { text += src[i + 1] || ''; i += 2; continue; }
        if (src[i] === '\n') {
          line++;
          if (c !== '`') { break; }
        }
        text += src[i];
        i++;
      }
      i++;
      out.push({ text: text, line: at });
      continue;
    }
    i++;
  }
  return out;
}

const SENDS = /\bin #([a-z][a-z0-9-]*)|#([a-z][a-z0-9-]*) in the Discord/g;
const dir = path.join(ROOT, 'game', 'gamemode');
const found = [];
for (const f of fs.readdirSync(dir).filter((x) => /\.ts$/.test(x)).sort()) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8').split(CR).join('');
  for (const s of strings(src)) {
    let m;
    SENDS.lastIndex = 0;
    while ((m = SENDS.exec(s.text))) {
      found.push({ name: m[1] || m[2], where: 'game/gamemode/' + f + ':' + s.line });
    }
  }
}
yes('the gamemode\'s messages send people to channels (' + found.length + ' found)', found.length > 0);
const wrong = found.filter((x) => !made.has(x.name));
for (const w of wrong) { console.log('      #' + w.name + ' at ' + w.where + ' is not a channel the plan makes'); }
yes('every channel a message sends people to is one the Discord plan makes', wrong.length === 0);

// The reader itself: a comment naming a channel is not a message.
const probe = strings("// in #bugs\n/* in #bugs */\nconst a = 'Post it in #test-findings.';\n");
yes('a comment is not read as a message, a string is',
    probe.length === 1 && probe[0].text === 'Post it in #test-findings.' && probe[0].line === 3);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exitCode = fail ? 1 : 0;
