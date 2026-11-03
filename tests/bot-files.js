'use strict';
// The bot's code, for the harnesses that read it (#5357).
//
// bot\bot.py is the start, and the bot itself is in the modules it imports,
// bot\bot_*.py, one area each. source() is all of it as one text, bot.py
// first and then each module in the order bot.py imports them, so a harness
// that looks for a line of the bot finds it whichever module it is in.
// files() is the same files as paths, parts() the modules' names. The list
// is read from bot.py's own import lines, the one place it is kept, so a
// module added there is read here with nothing else to change.
// bot\harness_bot.py does the same for the Python harnesses.

const fs = require('fs');
const path = require('path');

const BOT = path.join(__dirname, '..', 'bot');

function parts(dir) {
  const text = fs.readFileSync(path.join(dir || BOT, 'bot.py'), 'utf8');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^import (bot_[a-z0-9_]+)\s*(#.*)?$/.exec(line);
    if (m && out.indexOf(m[1]) < 0) out.push(m[1]);
  }
  return out;
}

function files(dir) {
  const d = dir || BOT;
  return [path.join(d, 'bot.py')].concat(parts(d).map(function (n) { return path.join(d, n + '.py'); }));
}

function source(dir) {
  return files(dir).map(function (f) { return fs.readFileSync(f, 'utf8'); }).join('\n');
}

module.exports = { BOT, parts, files, source };
