// test-1640-jarl-word.js
//
// #1640. /jarl never reached the office. handle() in the chat block hands a
// word to the character block's command, and that hands the property words on
// to the property block from a fixed list. /jarl was answered by the property
// block (jarlCmd) and missing from that list, so it fell through to "No
// command called /jarl". site/tests/test-offices.js called jarlCmd directly and
// never saw the route.
//
// Since #2551 (Patrick, 15 Oct) the offices are Discord roles: nobody takes
// the Jarl office in the game, and the one word the Office page sends is
// /office, a Jarl giving or taking their hold's Court, Steward or Guard. The
// route is the same trap, so this drives it: the character block's command,
// sliced out of the gamemode, hands the word to the property block's command,
// also sliced, which calls the real officeCmd, which asks the site. And it
// holds the two lists together, so a word the property block answers can
// never again be left off the list that reaches it.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const gm = fs.readFileSync(SRC, 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function slice(src, start, end) {
  if (src === null) { return null; }
  const a = src.indexOf(start);
  if (a < 0) { return null; }
  const b = src.indexOf(end, a + start.length);
  return b < 0 ? null : src.slice(a, b + end.length);
}

const HEAD = '  function command(word, parts, actorId, profileId, toProfile, cmd) {';
const propBlock = slice(gm, '// ==== thornswood property ====', '// ==== end thornswood property ====');
const charBlock = slice(gm, '// ==== thornswood character ====', '// ==== end thornswood character ====');
const propCommand = slice(propBlock, HEAD, '\n  }\n');
const charCommand = slice(charBlock, HEAD, '\n  }\n');
const fn = function (name) { return slice(propBlock, '  function ' + name + '(', '\n  }\n'); };
const officeSrc = ['officeCmd', 'officeHoldHere', 'holdHere', 'officeRole', 'officeDoes', 'rolesOfProfile', 'officeAccountOf',
                   'officeHeldBy', 'officesOfProfile', 'holdsOffice', 'isJarlOf', 'jarlClashOf']
  .map(fn);
yes('the property block\'s command is in the gamemode', propCommand !== null);
yes('the character block\'s command is in the gamemode', charCommand !== null);
yes('officeCmd and what it reads are in the property block', officeSrc.every(function (s) { return !!s; }));
const tables = slice(propBlock, '  var OFFICE_KINDS = [', ';') + '\n' +
               slice(propBlock, '  var OFFICE_GIVEN = {', '};') + '\n' +
               slice(propBlock, '  var HOLD_TOWN = {', '};') + '\n' +
               'var JAIL_NAME = { whiterun: "Dragonsreach Dungeon" };\n' +
               // The Jarl's character holds the office for the account (#2551, Patrick, 16 Oct).
               'var law = { cells: {}, held: { "jarl:whiterun": { "p:1": { pid: 1, name: "Balgruuf", at: 1 } } } };\n' +
               'function saveLaw() { }\n';

const JARL = 1, NOBODY = 3, STEWARD = 4;
const ACTOR = 0xff000101;

/*
  One world: the property block (its command and the real officeCmd, every
  other word a stub that records itself), and the character block's command
  with g.__thornswoodProperty pointing at it. The site is a stand-in that
  records what it was asked and answers yes.
*/
function world() {
  const asked = [];
  const stubbed = [];
  const pbox = {
    plog: function () { },
    __thornswoodOffices: function (pid) {
      return { jarl: pid === JARL ? ['whiterun'] : [], court: [], steward: [], guard: [] };
    },
    __thornswoodOfficesOnRecord: function (pid) {
      return { jarl: pid === JARL ? ['whiterun'] : [], court: [], steward: [], guard: [] };
    },
    __thornswoodAskSite: function (route, body, done) {
      asked.push([route, body]);
      done('', { ok: true, said: 'Proventus holds Steward of Whiterun now. The role is set in Discord.' });
    },
    __thornswoodDoorReadNow: function (done) { done(true); },
    onlineActorOf: function (pid) { return pid === STEWARD ? 0xff000104 : 0; },
    personName: function (a) { return a === ACTOR ? 'Balgruuf' : 'Proventus'; },
    pushAll: function () { }, officeRedraw: function () { }
  };
  pbox.g = pbox;
  ['deeds', 'setLock', 'mold', 'moldHere', 'cutKey', 'claim', 'evict',
   'boxCmd', 'dropboxCmd', 'rentCmd', 'sleepHere', 'post', 'board', 'take', 'jobs', 'dropJob',
   'unpin', 'postLetter', 'deliver', 'haulCmd', 'jobDone', 'claimAway', 'here', 'doorLine', 'doorOfId'].forEach(function (n) {
    pbox[n] = function () { stubbed.push(n); return true; };
  });
  vm.runInNewContext(tables + '\n' + officeSrc.join('\n') + '\n' + propCommand + '\nthis.cmd = command;', pbox);

  const logs = [];
  const cbox = {
    clog: function () { logs.push(Array.prototype.join.call(arguments, ' ')); },
    g: { __thornswoodProperty: { command: pbox.cmd } }
  };
  vm.runInNewContext(charCommand + '\nthis.cmd = command;', cbox);

  return {
    asked: asked, stubbed: stubbed, logs: logs,
    send: function (word, actorId, profileId) {
      const told = [];
      const parts = word.split(' ');
      const r = cbox.cmd(parts[0], parts, actorId, profileId, function (pid, m) { told.push([pid, m]); });
      return { answered: r, told: told };
    }
  };
}

if (propCommand && charCommand && officeSrc.every(function (s) { return !!s; })) {
  {
    const w = world();
    const r = w.send('/office steward whiterun ' + STEWARD, ACTOR, JARL);
    yes('J1 /office sent to the character block is answered there, not left for the unknown command reply',
        r.answered === true);
    yes('J1 and the Jarl of Whiterun\'s line asks the site, once, to give the Steward of Whiterun role to that profile',
        w.asked.length === 1 && w.asked[0][0] === '/api/office' && w.asked[0][1].by === JARL &&
        w.asked[0][1].who === STEWARD && w.asked[0][1].office === 'steward' && w.asked[0][1].hold === 'whiterun' &&
        w.asked[0][1].give === true && w.asked[0][1].byName === 'Balgruuf' && w.asked[0][1].whoName === 'Proventus');
    yes('J1 and the Jarl is told what the site said, and the steward what the office lets them do',
        r.told.some(function (t) { return t[0] === JARL && /holds Steward of Whiterun now/.test(t[1]); }) &&
        r.told.some(function (t) { return t[0] === STEWARD && /names this character Steward of Whiterun./.test(t[1]); }));
    yes('J1 and no other property word ran', w.stubbed.length === 0);
  }
  {
    const w = world();
    const r = w.send('/office guard whiterun -' + STEWARD, ACTOR, JARL);
    yes('J2 a dash asks the site to take the role back',
        r.answered === true && w.asked.length === 1 && w.asked[0][1].give === false && w.asked[0][1].office === 'guard');
  }
  {
    const w = world();
    const r = w.send('/office guard whiterun ' + STEWARD, ACTOR, NOBODY);
    yes('J3 an account without the Jarl of Whiterun role is refused, and the site is not asked',
        r.answered === true && w.asked.length === 0 &&
        r.told[0][1] === 'Only the Jarl of Whiterun gives its offices.');
    const other = w.send('/office guard riften ' + STEWARD, ACTOR, JARL);
    yes('J3 nor is the Jarl of Whiterun for another hold', w.asked.length === 0 &&
        other.told[0][1] === 'Only the Jarl of Riften gives its offices.');
  }
  {
    const w = world();
    const r = w.send('/office', 0, JARL);
    yes('J5 with no character found it says so, the same as every property word',
        r.answered === true && w.asked.length === 0 &&
        r.told[0][1].indexOf('cannot find your character') !== -1);
  }
  {
    const w = world();
    const r = w.send('/evict', ACTOR, JARL);
    yes('J6 the words that already reached the property block still do',
        r.answered === true && w.stubbed.join() === 'evict');
  }
}

// The cause: two lists that must agree. Every word the property block's
// command answers is on the character block's list that hands words to it.
{
  const strip = function (s) {
    return s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  };
  const words = function (s) {
    const out = [];
    const re = /word === '(\/[a-z-]+)'/g;
    let m;
    while ((m = re.exec(s)) !== null) { if (out.indexOf(m[1]) === -1) { out.push(m[1]); } }
    return out;
  };
  const answered = propCommand ? words(strip(propCommand)) : [];
  const handOn = charCommand ? strip(charCommand) : '';
  const listEnd = handOn.indexOf('var prop = g.__thornswoodProperty');
  const handed = listEnd > 0 ? words(handOn.slice(0, listEnd)) : [];
  const missing = answered.filter(function (w) { return handed.indexOf(w) === -1; });
  yes('J7 the property block answers /office, and no longer /jarl, /steward or /guard',
      answered.indexOf('/office') !== -1 && ['/jarl', '/steward', '/guard'].every(function (w) {
        return answered.indexOf(w) === -1 && handed.indexOf(w) === -1;
      }));
  yes('J7 every word the property block answers is on the list that reaches it' +
      (missing.length ? ' (missing: ' + missing.join(', ') + ')' : ''),
      answered.length > 10 && missing.length === 0);

  // The trap: the fix is the route, not a second handler somewhere else.
  const code = strip(gm);
  const seen = code.match(/word === '\/office'/g) || [];
  yes('J8 /office is matched in exactly two places, the hand-on list and the property block',
      seen.length === 2);
  const handle = code.indexOf('charCmd.command(word, parts, actorId, profileId, toProfile, cmd)');
  const unknown = code.indexOf("'No command called ' + word");
  yes('J9 handle() asks the character block before it answers "No command called"',
      handle > 0 && unknown > handle);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
