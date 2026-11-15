// test-6221-lines-reach-screen.js
//
// #6221. notify() used to call Debug.Notification, which finds its actor
// through the Papyrus stack. A call that starts in the gamemode has an empty
// stack, so the line never reached a screen and the engine logged "Native
// Debug.Notification errored with Invalid stackId was passed to
// GetDefaultActor (0)" for each one. Seven lines went through notify() alone,
// so nobody ever saw them.
//
// This checks, in the built game\gamemode.js:
//   1. notify() makes no Papyrus call, and writes the log's copy;
//   2. every notify() call has a say() of the same line beside it, so what is
//      logged as said is also put in the person's chat.
//
//   node tests/test-6221-lines-reach-screen.js
//
// Read only. Prints PASS and FAIL lines, exit 1 when anything fails.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const REPO_DIR = path.join(__dirname, '..');
const CR = String.fromCharCode(13);
const GM = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const gm = require('./gamemode-tables.js').joined(fs.readFileSync(GM, 'utf8')).split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------- 1. notify() on its own
const head = 'function notify(actorId, text) {';
const a = gm.indexOf(head);
const b = a < 0 ? -1 : gm.indexOf('\n}\n', a);
const body = (a >= 0 && b >= 0) ? gm.slice(a, b + 3) : null;
yes('notify() is in the gamemode', !!body);
if (body) {
  yes('notify() makes no Papyrus call', !/callPapyrusFunction/.test(body));
  const logged = [];
  const papyrus = [];
  const box = {
    log: function () { logged.push(Array.prototype.slice.call(arguments).join(' ')); },
    mp: { callPapyrusFunction: function () { papyrus.push(Array.prototype.slice.call(arguments)); } }
  };
  vm.createContext(box);
  vm.runInContext(body + '\nthis.notify = notify;', box);
  box.notify(0xff00002e, 'Only a gatherer can pull that out of the ground. Ask one.');
  yes('notify() writes the log\'s copy of the line',
      logged.length === 1 && logged[0] === 'say ff00002e Only a gatherer can pull that out of the ground. Ask one.');
  yes('notify() asks the engine for nothing', papyrus.length === 0);
}

// ------------------------------------- 2. every notify() is said as well
// A call is the text from "notify(" to its matching ")". A say() of the same
// arguments must follow before the next statement block ends, within a few
// lines, the way every caller already pairs them.
function callAt(src, at) {
  let depth = 0;
  for (let i = at; i < src.length; i++) {
    const c = src[i];
    if (c === '(') { depth++; }
    else if (c === ')') { depth--; if (depth === 0) { return src.slice(at, i + 1); } }
  }
  return null;
}
const re = /\bnotify\(/g;
let m, calls = 0;
const alone = [];
while ((m = re.exec(gm)) !== null) {
  const at = m.index;
  const lineStart = gm.lastIndexOf('\n', at) + 1;
  const line = gm.slice(lineStart, gm.indexOf('\n', at));
  if (/^\s*(\*|\/\/)/.test(line) || /function notify\(/.test(line)) { continue; }
  const call = callAt(gm, at + 'notify'.length);
  if (!call) { continue; }
  const args = call.slice(1, -1).trim();
  // "notify()" with nothing in it is a mention in a comment, not a call.
  if (!args) { continue; }
  calls++;
  // The say() may be on the same line or within the next four.
  let end = at;
  for (let n = 0; n < 5; n++) { const nl = gm.indexOf('\n', end + 1); if (nl < 0) { break; } end = nl; }
  const after = gm.slice(at + call.length, end);
  const said = after.indexOf('say(' + args + ')') >= 0 ||
               after.indexOf('say(' + args.replace(/\s*,\s*/, ', ') + ')') >= 0 ||
               after.indexOf('say(' + args.replace(/\s*,\s*/, ',') + ')') >= 0;
  // cuffs.ts and strength-weapons.ts say the same words through their own
  // tell() or as one joined line, and an offer (hair dye, teleport,
  // apprenticeship) says its longer line just before: a say() or tell() in
  // the two lines before or the lines after counts.
  let start = lineStart;
  for (let n = 0; n < 2; n++) { const pl = gm.lastIndexOf('\n', start - 2); if (pl < 0) { break; } start = pl + 1; }
  const before = gm.slice(start, at);
  const sayLike = /\b(say|tell)\(/.test(after) || /\b(say|tell)\(/.test(before);
  if (!said && !sayLike) { alone.push(line.trim().slice(0, 140)); }
}
yes('the gamemode has notify() calls to check (' + calls + ')', calls > 20);
yes('every notify() line is also said in chat' + (alone.length ? ': ' + alone.join(' | ') : ''), alone.length === 0);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
