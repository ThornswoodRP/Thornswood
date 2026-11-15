// test-rulebook.js
//
// The panel offers exactly what the server will accept, and nothing else.
//
// From the To Do List: "Choosing Tailor silently turns you into a Warrior in
// Whiterun twenty seconds later, and takes the town you picked with it...
// silently becoming a different person in a different hold is the worst
// possible first ten minutes."
//
// THAT PARTICULAR ONE IS GONE, and this file is what stops it coming back. The
// mechanism was the starting kits: a trade with no kit was rejected outright
// and creation fell through to a default. There are no kits any more, kits
// were taken out on 20 September, pickProfession refuses with a reason rather
// than substituting anything, and Tailor is a real profession on the server
// with both of its halves.
//
// BUT THE SHAPE OF THE BUG IS STILL AVAILABLE, and it is a nasty one: the
// panel keeps its own copy of the rulebook, for a stated reason. Its comment
// says so:
//
//     "From the rulebook of 20 September. The names and the rules are the
//      server's; the sentences are this file's, because the server sends keys
//      and a person reads sentences."
//
// Two copies of one rulebook, in two languages, on two machines, and the ONLY
// thing keeping them in step is somebody remembering. A key that exists in one
// and not the other is a choice somebody can make and the server will not
// honour, which is exactly what that entry describes and exactly what nothing
// was checking.
//
// So: every key the panel offers must exist on the server, and every key the
// server has must be offered. Both directions. One is a choice that is
// refused; the other is a profession nobody can find.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-skills.js'), 'utf8')
  .split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

/* Lift an object literal out of a file by its name, braces balanced. */
function lift(text, head) {
  const a = text.indexOf(head);
  if (a < 0) { return null; }
  let depth = 0;
  const from = text.indexOf('{', a);
  if (from < 0) { return null; }
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') { depth++; }
    else if (text[i] === '}') {
      depth--;
      if (!depth) { return text.slice(from, i + 1); }
    }
  }
  return null;
}

function evalObject(literal) {
  return new Function('return (' + literal + ');')();
}

// ------------------------------------------------------------ the two copies
const pageLit = lift(page, '  var DATA = {');
yes('the panel carries a rulebook', !!pageLit);

const classesLit = lift(src, '  var CLASSES = {');
const profLit = lift(src, '  var PROFESSIONS = {');
const treeLit = lift(src, '  var TREE = {');
const schoolsM = /var SCHOOLS = (\[[^\]]*\]);/.exec(src);
yes('the server carries the classes', !!classesLit);
yes('the server carries the professions', !!profLit);
yes('the server carries the skill tree', !!treeLit);
yes('the server carries the schools of magic', !!schoolsM);

if (pageLit && classesLit && profLit && treeLit && schoolsM) {
  const PAGE = evalObject(pageLit);
  const CLASSES = evalObject(classesLit);
  const PROFESSIONS = evalObject(profLit);
  const TREE = evalObject(treeLit);
  const SCHOOLS = evalObject(schoolsM[1]);

  const offeredClasses = (PAGE['class'].rows || []).map(r => r.key);
  const serverClasses = Object.keys(CLASSES);

  // ------------------------------------------------------------- classes
  {
    const extra = offeredClasses.filter(k => serverClasses.indexOf(k) === -1);
    const missing = serverClasses.filter(k => offeredClasses.indexOf(k) === -1);
    yes('every class the panel offers exists on the server' +
        (extra.length ? ' (offered and refused: ' + extra.join(', ') + ')' : ''),
        extra.length === 0);
    yes('and every class the server has is offered' +
        (missing.length ? ' (nobody can pick: ' + missing.join(', ') + ')' : ''),
        missing.length === 0);
    yes('there are five of them, which is what the rulebook says',
        serverClasses.length === 5);
  }

  // --------------------------------------------------------- professions
  const offeredProfs = (PAGE.profession.rows || []).map(r => r.key);
  const serverProfs = Object.keys(PROFESSIONS);
  {
    const extra = offeredProfs.filter(k => serverProfs.indexOf(k) === -1);
    const missing = serverProfs.filter(k => offeredProfs.indexOf(k) === -1);
    yes('every profession the panel offers exists on the server' +
        (extra.length ? ' (offered and refused: ' + extra.join(', ') + ')' : ''),
        extra.length === 0);
    yes('and every profession the server has is offered' +
        (missing.length ? ' (nobody can pick: ' + missing.join(', ') + ')' : ''),
        missing.length === 0);

    /*
      THE ONE THE ENTRY IS ABOUT, named rather than left to the loop above,
      because it is the one somebody will look for.
    */
    yes('Tailor is offered and the server takes it',
        offeredProfs.indexOf('tailor') !== -1 && !!PROFESSIONS.tailor);
    /*
      Guarded, because a harness that THROWS on the first problem reports one
      and hides the rest. Proved by cutting the tailor out of the server table
      and running this: it named the drift and then died on the next line,
      which on a runner is a red build with a stack trace instead of a list.
    */
    yes('with both of its halves',
        !!(PROFESSIONS.tailor && PROFESSIONS.tailor.halves &&
           PROFESSIONS.tailor.halves.liverywright && PROFESSIONS.tailor.halves.haberdasher));
  }

  // ------------------------------------------------------------ the halves
  {
    /*
      A HALF IS THE SECOND HALF OF THE SAME CHOICE. pickProfession takes the
      profession AND the half in one step and refuses an unknown one, so a
      half that only exists on the panel is a pick that cannot be completed.
    */
    const wrong = [];
    (PAGE.profession.rows || []).forEach(function (row) {
      const server = PROFESSIONS[row.key];
      if (!server) { return; }
      const subs = (row.subs || []).map(s => s.key);
      if (row.key === 'mage') { return; }        // schools, checked below
      const halves = Object.keys(server.halves || {});
      subs.forEach(function (k) { if (halves.indexOf(k) === -1) { wrong.push(row.key + '/' + k); } });
      halves.forEach(function (k) { if (subs.indexOf(k) === -1) { wrong.push(row.key + '/' + k + ' (not offered)'); } });
    });
    yes('every half matches, both ways' + (wrong.length ? ' (' + wrong.join(', ') + ')' : ''),
        wrong.length === 0);

    // Every profession that is not the mage has exactly two.
    const odd = serverProfs.filter(function (k) {
      if (k === 'mage') { return false; }
      return Object.keys(PROFESSIONS[k].halves || {}).length !== 2;
    });
    yes('and every profession but the mage has exactly two' +
        (odd.length ? ' (' + odd.join(', ') + ')' : ''), odd.length === 0);
  }

  // ------------------------------------------------------------ the mage
  {
    const mageRow = (PAGE.profession.rows || []).filter(r => r.key === 'mage')[0];
    yes('the mage is offered', !!mageRow);
    if (mageRow) {
      const offered = (mageRow.subs || []).map(s => s.key);
      const extra = offered.filter(k => SCHOOLS.indexOf(k) === -1);
      const missing = SCHOOLS.filter(k => offered.indexOf(k) === -1);
      yes('every school the panel offers is a school the server knows' +
          (extra.length ? ' (' + extra.join(', ') + ')' : ''), extra.length === 0);
      yes('and every school the server knows is offered' +
          (missing.length ? ' (' + missing.join(', ') + ')' : ''), missing.length === 0);
      /*
        pickProfession refuses a mage who did not send exactly p.schools of
        them, so the number the panel asks for has to be the number the server
        wants or every mage is refused.
      */
      yes('and the panel asks for exactly as many as the server requires',
          !!PROFESSIONS.mage && mageRow.pick === PROFESSIONS.mage.schools);
    }
  }

  // ------------------------------------------------------------- the tree
  {
    const offered = [];
    (PAGE.tree.rows || []).forEach(function (row) {
      (row.subs || []).forEach(function (s) { offered.push(row.key + '.' + s.key); });
    });
    const server = [];
    Object.keys(TREE).forEach(function (branch) {
      Object.keys(TREE[branch].skills || {}).forEach(function (s) { server.push(branch + '.' + s); });
    });

    const extra = offered.filter(k => server.indexOf(k) === -1);
    const missing = server.filter(k => offered.indexOf(k) === -1);
    yes('every skill the panel offers exists on the server' +
        (extra.length ? ' (' + extra.join(', ') + ')' : ''), extra.length === 0);
    yes('and every skill the server has is offered' +
        (missing.length ? ' (' + missing.join(', ') + ')' : ''), missing.length === 0);
    yes('fifteen skills across three branches, which is what the panel says',
        server.length === 15 && Object.keys(TREE).length === 3);
  }

  // ------------------------------------- and a refusal is a refusal, not a swap
  {
    /*
      THE OTHER HALF OF THE ENTRY. Even with the two lists in step, the thing
      that made it so bad was that a refused pick SUBSTITUTED something rather
      than saying no. pickProfession and pickClass answer no() with a reason
      and change nothing, and this pins that: a fallback creeping back in is
      what turns a visible error into a silent one.
    */
    const pick = src.slice(src.indexOf('  function pickProfession(state, prof, halfOrSchools) {'),
                           src.indexOf('  function teach(state, teacherState, half'));
    yes('an unknown profession is refused with a reason', /return no\('no such profession'\)/.test(pick));
    yes('an unknown half is refused with a reason', /return no\('no such half of ' \+ p\.name\)/.test(pick));
    yes('and nothing is substituted when it refuses',
        pick.indexOf('warrior') === -1 && pick.indexOf('whiterun') === -1);

    const cls = src.slice(src.indexOf('  function pickClass(state, cls) {'),
                          src.indexOf('  function pickProfession(state, prof, halfOrSchools) {'));
    yes('an unknown class is refused with a reason', /return no\('no such class'\)/.test(cls));
    yes('and nothing is substituted there either',
        cls.indexOf('hunter') === -1 && cls.indexOf('whiterun') === -1);
  }
}


// ------------------------------------- RP-only: the five retired trades
/*
  Patrick, 26 September 2026: bard, merchant, priest, scholar and thief are
  RP-only. Not Class, not Profession, not offered on the panel, and migrate
  clears them so nobody keeps old privileges.
*/
{
  const rpLit = lift(src, '  var RP_ONLY = {');
  yes('the server names the RP-only trades', !!rpLit);
  if (rpLit) {
    const RP = evalObject(rpLit);
    const five = ['bard', 'merchant', 'priest', 'scholar', 'thief'];
    const keys = Object.keys(RP);
    yes('exactly those five are RP-only' +
        (keys.length !== 5 || five.some(k => keys.indexOf(k) === -1)
          ? ' (got: ' + keys.join(', ') + ')' : ''),
        keys.length === 5 && five.every(k => keys.indexOf(k) !== -1));

    const classesLit2 = lift(src, '  var CLASSES = {');
    const profLit2 = lift(src, '  var PROFESSIONS = {');
    const CLASSES2 = classesLit2 ? evalObject(classesLit2) : {};
    const PROFESSIONS2 = profLit2 ? evalObject(profLit2) : {};
    const pageLit2 = lift(page, '  var DATA = {');
    const PAGE2 = pageLit2 ? evalObject(pageLit2) : { class: { rows: [] }, profession: { rows: [] } };
    const offeredC = (PAGE2['class'].rows || []).map(r => r.key);
    const offeredP = (PAGE2.profession.rows || []).map(r => r.key);

    five.forEach(function (k) {
      yes(k + ' is RP-only, not Class or Profession',
          !!RP[k] && !CLASSES2[k] && !PROFESSIONS2[k]);
      yes(k + ' is not offered as a class on the panel', offeredC.indexOf(k) === -1);
      yes(k + ' is not offered as a profession on the panel', offeredP.indexOf(k) === -1);
    });

    yes('Gatherer stays a class', !!CLASSES2.gatherer);
    yes('Tailor stays a profession', !!PROFESSIONS2.tailor);
  }

  yes('TABLE exposes rpOnly', /rpOnly:\s*RP_ONLY/.test(src));
  yes('migrate clears an RP-only trade',
      /P\.has\(P\.TABLE\.rpOnly, trade\)/.test(src) &&
      /is RP-only; cleared, they must pick a class and profession/.test(src) &&
      /old\['class'\]\s*=\s*''/.test(src));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
