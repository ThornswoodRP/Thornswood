// test-3941-chat-not-logged.js
//
//     node game/tests/test-3941-chat-not-logged.js
//
// Nobody's chat line reaches thornswood-front.log (#3941). That log goes up
// with the session's logs at the end of every session (Discord.SessionLogs),
// and the chat page hands the front plugin every line said near you that has
// an overhead line ('head:' with the words, the speaker's actor and profile),
// 'headclear:' when staff silence somebody, and voice hands it 'marks:' with
// who is speaking.
//
// THE CAUSE. The front's browserMessage handler ends with log(what), for any
// message no branch of it took. Those three were taken by a second listener
// of their own, so the main handler never knew and logged every one, and
// log() also prints to the console, which the fork copies into
// skyrim-platform.log. They are now one function, overheadMessage, that the
// main handler asks first and returns on.
//
// WHAT THIS RUNS. The overhead block (its state, overheadMessage) and the
// real main browserMessage handler, lifted out of thornswood-front.js and run
// against a pretend game: every name the plugin has that is not lifted here
// is a blank that does nothing. log, say and printConsole write down what
// they are given. A message nobody takes is sent too, to show the catch-all
// still logs it, so a pass is not a log that never writes.
//
// The client's own copy of every browser message (the fork's authService.ts)
// is the fork's half of #3941; this reads the plugin only.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const CR = String.fromCharCode(13);
const REPO_DIR = path.join(__dirname, '..', '..');
const FRONT = process.env.FRONT || path.join(REPO_DIR, 'game', 'plugins', 'thornswood-front.js');
const front = fs.readFileSync(FRONT, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
function between(src, start, end) {
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b);
}

const OVERHEAD = between(front, '  const HEAD_MS = 6000;', "  sp.on('update', guard('overhead'");
const MAIN_START = "  sp.on('browserMessage', guard('browserMessage', (event) => {";
const MAIN_BODY = between(front, MAIN_START, '\n  }));\n');
yes('the overhead block is in the plugin', !!OVERHEAD && OVERHEAD.indexOf('function overheadMessage(what)') >= 0);
yes('the main browserMessage handler is in the plugin', !!MAIN_BODY);
if (!OVERHEAD || !MAIN_BODY) { done(); }
const MAIN = MAIN_BODY + '\n  }));\n';

// No other browserMessage listener in the plugin takes the overhead messages:
// a second one is what kept the main handler from knowing they were taken.
{
  const listeners = front.split("sp.on('browserMessage'").slice(1)
    .map(function (rest) { return rest.slice(0, rest.indexOf('\n  }));\n')); });
  const others = listeners.filter(function (body) { return body.indexOf("guard('browserMessage'") !== 0 && body.indexOf(", guard('browserMessage'") !== 0; });
  yes('no listener but the main one reads head:, headclear: or marks:',
      others.every(function (body) { return !/['"](head|headclear|marks):['"]/.test(body); }));
}

function rig() {
  const w = { logs: [], handlers: [], touched: {} };
  function blank(name) {
    const f = function () { return undefined; };
    return new Proxy(f, {
      get: function (t, k) {
        if (k === Symbol.toPrimitive) { return function () { return NaN; }; }
        if (typeof k === 'symbol') { return undefined; }
        return blank(name + '.' + String(k));
      },
      apply: function () { return undefined; }
    });
  }
  const own = {
    sp: {
      on: function (ev, fn) { if (ev === 'browserMessage') { w.handlers.push(fn); } },
      printConsole: function () { w.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
      getTextString: function () { return ''; },
      destroyText: function () { }
    },
    guard: function (name, fn) { return fn; },
    log: function () { w.logs.push(Array.prototype.slice.call(arguments).join(' ')); },
    say: function () { w.logs.push(Array.prototype.slice.call(arguments).join(' ')); }
  };
  const scope = new Proxy(own, {
    has: function (t, k) {
      if (typeof k === 'symbol') { return false; }
      if (k in t) { return true; }
      return !(k in globalThis);
    },
    get: function (t, k) {
      if (typeof k === 'symbol') { return undefined; }
      if (k in t) { return t[k]; }
      w.touched[k] = true;
      return blank(k);
    },
    set: function (t, k, v) { t[k] = v; return true; }
  });
  // Sloppy on purpose: `with` is how every name the lifted code does not
  // declare reaches the pretend game.
  const run = new Function('scope',
    'with (scope) {\n' + OVERHEAD + MAIN + '\n return { heads: overheadHeads, marks: overheadMarks };\n}');
  const state = run(scope);
  w.heads = state.heads;
  w.marks = state.marks;
  w.send = function (what) {
    w.handlers.forEach(function (fn) { fn({ arguments: ['thornswood-front', what] }); });
  };
  return w;
}

const SAID = 'meet me by the Bannered Mare at dusk';
const HEAD = 'head:' + JSON.stringify({ who: 'ff000816', text: SAID, profile: 4321, actor: 'ff000816' });

{
  const w = rig();
  yes('one browserMessage handler is registered from what was lifted', w.handlers.length === 1);
  w.send(HEAD);
  yes('A1 a line said near you puts its words over the speaker\'s head',
      !!w.heads.ff000816 && w.heads.ff000816.text === SAID && w.heads.ff000816.profile === 4321);
  yes('A2 and nothing of it is logged (logged: ' + JSON.stringify(w.logs) + ')',
      w.logs.every(function (l) { return l.indexOf(SAID) < 0 && l.indexOf('ff000816') < 0 && l.indexOf('4321') < 0; }));
  yes('A3 nothing at all is logged for it', w.logs.length === 0);

  w.send('headclear:4321');
  yes('B1 staff silencing them takes their line down', !w.heads.ff000816);
  yes('B2 and is not logged', w.logs.length === 0);

  w.send('marks:' + JSON.stringify([{ a: 'ff000816', m: 'yell' }, { a: 'ff000901', m: 'whisper' }]));
  yes('C1 who is speaking puts a mark over each of them',
      !!w.marks.ff000816 && w.marks.ff000816.mode === 'yell' && !!w.marks.ff000901);
  yes('C2 and is not logged', w.logs.length === 0);

  w.send('head:not json at all ' + SAID);
  w.send('marks:{not a list');
  yes('D1 a head: or marks: that does not parse is still not logged', w.logs.length === 0);

  w.send('a line nothing in the plugin takes');
  yes('E1 a message nothing takes is still logged, so the log above was listening',
      w.logs.length === 1 && w.logs[0] === 'a line nothing in the plugin takes');
}

done();
