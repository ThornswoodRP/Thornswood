'use strict';
/*
  test-5036-reused-form-id.js

      node game/tests/test-5036-reused-form-id.js

  #5036: a release list still waiting must not let go of a new character's
  holdings when the engine has handed that character a form id the list
  names. The list (private\deleted-characters.json) names a deleted
  character by runtime form id alone, and the engine gives a new form the
  lowest runtime id no loaded form holds (WorldState::GenerateFormId), so
  once the old change form is gone its id goes to the next one made.

  This runs the real release block of game\gamemode.js in a scratch server
  folder, with a stand-in mp.get that answers for the forms the world holds
  and throws "Form with id ... doesn't exist" for any other, as the engine
  does (WorldState::GetFormAt):

    A  saves done, a part still waiting, a new form at one of the list's ids:
       that id no longer matches, the other id on the list still does, and
       the list in the file stops naming it
    B  the start right after the deletion, nobody made yet: every id on the
       list matches, the file is not rewritten
    C  saves not done yet (the characters still in the world): the ids are
       left alone, they are still the characters the list was made for
    D  the log says a count, never an id
    E  the engine throws something else for a form it holds: that is no
       answer, so nothing is let go this start and the list stays as it was
    F  a form held as another kind ("is not ... (actually it is ...)") is
       held, and its id is dropped
    G  a doesn't-exist error naming another id is no answer for this one

  Nothing leaves this machine. The scratch folder goes at the end.
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const REPO = path.join(__dirname, '..', '..');
const gm = fs.readFileSync(path.join(REPO, 'game', 'gamemode.js'), 'utf8').split(String.fromCharCode(13)).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const START = '// ==== thornswood release of deleted characters ====';
const END = '// ==== end thornswood release of deleted characters ====';
const a = gm.indexOf(START), b = gm.indexOf(END);
yes('R0 the release block is in gamemode.js', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { console.log('\n' + pass + ' passed, ' + fail + ' failed'); process.exit(1); }
const block = gm.slice(a, b + END.length);

const A1 = 0xff000a01, A2 = 0xff000a02;
const NOW = Date.now();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-5036-'));
const home = process.cwd();

// One server start: the list as given, the world holding the forms in held,
// then the merchants' part asks, as the NPC startup does.
function start(name, list, held, odd) {
  const dir = path.join(scratch, name);
  fs.mkdirSync(path.join(dir, 'private'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'server-settings.json'), JSON.stringify({ privDir: 'private' }));
  const file = path.join(dir, 'private', 'deleted-characters.json');
  fs.writeFileSync(file, JSON.stringify(list));
  const before = fs.readFileSync(file, 'utf8');
  const lines = [];
  const mp = {
    get: function (id, key) {
      if (odd && odd[id]) { throw new Error(odd[id]); }
      if (held.indexOf(id) < 0) { throw new Error('Form with id 0x' + (id >>> 0).toString(16) + " doesn't exist"); }
      return key === 'profileId' ? 7001 : undefined;
    }
  };
  const box = { mp: mp, log: function (l) { lines.push(String(l)); }, require: require, console: console };
  box.globalThis = box;
  vm.createContext(box);
  let seen = null;
  process.chdir(dir);
  try {
    vm.runInContext(block, box);
    box.__thornswoodRelease('merchants', function (who) {
      seen = { a1: who.actor(A1), a2: who.actor(A2) };
      return { saved: true, counts: {} };
    });
  } finally { process.chdir(home); }
  // The server's own list after the start: deleted-characters.taken.json,
  // where it takes the requests and keeps its marks (#4920).
  const taken = path.join(dir, 'private', 'deleted-characters.taken.json');
  let after = null;
  try { after = JSON.parse(fs.readFileSync(taken, 'utf8')); } catch (e) { after = null; }
  return { seen: seen, log: lines.join('\n'), after: after, rewritten: fs.existsSync(taken) && fs.readFileSync(taken, 'utf8') !== before };
}

try {
  // A: deleted at an earlier start (saves done), merchants still waiting; a
  // new character was made since and the engine gave it A1.
  const waiting = { profiles: [5001], actors: [A1, A2], done: { saves: NOW - 1000, farms: NOW - 1000 } };
  const s1 = start('a', waiting, [A1]);
  yes('A1 a new form at an id on the list is not let go of', !!s1.seen && s1.seen.a1 === false);
  yes('A2 the other id on the list, still nobody\'s, is let go of', !!s1.seen && s1.seen.a2 === true);
  yes('A3 the list in the file no longer names the reused id',
      !!s1.after && Array.isArray(s1.after.actors) && s1.after.actors.indexOf(A1) < 0 && s1.after.actors.indexOf(A2) >= 0);
  yes('A4 and keeps its profiles and what was done', !!s1.after && JSON.stringify(s1.after.profiles) === '[5001]' &&
      !!s1.after.done && s1.after.done.saves > 0 && s1.after.done.farms > 0 && s1.after.done.merchants > 0);

  // B: the start right after the deletion: the forms are gone, nobody made yet.
  const s2 = start('b', { profiles: [5001], actors: [A1, A2], done: { saves: NOW } }, []);
  yes('B1 with no form at either id, both are let go of', !!s2.seen && s2.seen.a1 === true && s2.seen.a2 === true);
  yes('B2 and the list still names both', !!s2.after && JSON.stringify(s2.after.actors) === JSON.stringify([A1, A2]));

  // C: saves not done: the characters are still in the world, and they are
  // the ones the list was made for.
  const s3 = start('c', { profiles: [5001], actors: [A1, A2] }, [A1, A2]);
  yes('C1 before the saves go, the characters at those ids are still the ones named', !!s3.seen && s3.seen.a1 === true && s3.seen.a2 === true);
  yes('C2 and the list still names both', !!s3.after && JSON.stringify(s3.after.actors) === JSON.stringify([A1, A2]));

  yes('D1 the log says how many, never an id',
      /1 character id\(s\) on the list belong to somebody made since/.test(s1.log) &&
      !/ff000a0|4278192641|4278192642|5001/.test(s1.log + s2.log + s3.log));

  // E: the engine throws something other than its doesn't-exist answer for
  // a form it holds at A1. That is no answer, so the id is never taken for
  // nobody's: nothing is let go this start and the list stays as it was.
  const listE = { profiles: [5001], actors: [A1, A2], done: { saves: NOW - 1000, farms: NOW - 1000 } };
  const s4 = start('e', listE, [A1], { [A1]: 'the engine could not answer' });
  yes('E1 another error for a held form lets nothing go: the waiting part is not run', s4.seen === null);
  yes('E2 and the list is left as it was', !s4.rewritten && !!s4.after &&
      JSON.stringify(s4.after.actors) === JSON.stringify([A1, A2]) && !s4.after.done.merchants);
  yes('E3 and the log says so, without the error\'s words or an id',
      /could not say whether an id on the list is held now, so nothing was let go/.test(s4.log) &&
      !/engine could not answer|ff000a0|4278192641/.test(s4.log));

  // F: a form held at A1 that is not an object reference: the engine says
  // so ("is not ... (actually it is ...)"), which is an answer: it is held.
  const s5 = start('f', listE, [A1], { [A1]: 'Form with id 0xff000a01 is not ObjectReference (actually it is Form)' });
  yes('F1 a form held as another kind is held: its id is not let go of', !!s5.seen && s5.seen.a1 === false && s5.seen.a2 === true);
  yes('F2 and the list no longer names it', !!s5.after && s5.after.actors.indexOf(A1) < 0);

  // G: the doesn't-exist answer for another id is not this one's.
  const s6 = start('g', listE, [A1], { [A1]: "Form with id 0xff000a02 doesn't exist" });
  yes('G1 a doesn\'t-exist error naming another id is no answer for this one', s6.seen === null);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
