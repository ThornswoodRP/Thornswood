// test-dice.js
//
// The dice are rolled by the server, and the page cannot produce a result.
//
// From the To Do List: "The dice everyone settles things with are rolled on
// the roller's own machine and sent as ordinary text. Roll on the server and
// return a result the client only displays... On a server where rules lean on
// rolls, a roll anybody can fake is worth less than no roll at all."
//
// The old arrangement turned "/roll 20" into the words "rolls 20: 17" INSIDE
// THE PAGE and posted them as an ordinary chat line, so anybody who could open
// a console could type the same sentence and nobody reading the room could
// tell. The comment in the page said so and called it the right trade.
//
// So the thing checked hardest here is the NEGATIVE: that the page has no way
// left to produce a result at all. A /roll that still works while the page can
// also fake one is not a fix.
//
// Read only.
const REPO_DIR = require('path').join(__dirname, '..', '..'); // this harness is in game\tests\, the repository is two folders up
const fs = require('fs');
const path = require('path');
const SRC = process.env.GM || path.join(REPO_DIR, 'game', 'gamemode.js');
const CR = String.fromCharCode(13);
const src = fs.readFileSync(SRC, 'utf8').split(CR).join('');
const page = fs.readFileSync(path.join(REPO_DIR, 'game', 'ui', 'thornswood-chat.js'), 'utf8');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// ------------------------------------------------------------- the page
{
  const rollOf = /function rollOf\(spec\) \{[\s\S]*?\n  \}/.exec(page);
  yes('the page still knows the syntax', !!rollOf);
  if (rollOf) {
    const f = new Function(
      'isFinite', 'parseInt', 'String',
      'var SPEC = /^(\\d+)(?:\\s*[x*]\\s*(\\d+))?$/;\n' +
      'var MAX_SIDES = 1000, MAX_DICE = 100, DEFAULT_SIDES = 20;\n' +
      rollOf[0] + '\nreturn rollOf;')(isFinite, parseInt, String);

    yes('and answers with a SPEC rather than a result', f('20') === '20');
    yes('several dice keep their shape', f('6x3') === '3x6');
    yes('a leading d is dropped, because people type it on reflex', f('d20') === '20');
    yes('nothing at all is twenty', f('') === '20');
    yes('nonsense is refused here so a typo is answered at once', f('fish') === null);
    yes('and so is a number nobody meant', f('99999') === null && f('20x9999') === null);

    /*
      THE ONE THAT MATTERS. Whatever this function does, it must not be able
      to produce a number: the page's answer is the server's or there is no
      point in any of this.
    */
    let random = false;
    for (let i = 0; i < 200; i++) { if (f('20') !== '20') { random = true; break; } }
    yes('it answers the same thing every time, so it is not rolling', !random);
    yes('and there is no die left in it at all',
        !/Math\.random/.test(rollOf[0]));
  }

  yes('the page sends the command and not a sentence',
      /text = '\/roll ' \+ spec;/.test(page));
  const code = page.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  yes('and nothing in the whole page rolls a die any more',
      !/Math\.random/.test(code));
}

// ----------------------------------------------------------- the server
{
  const a = src.indexOf("    if (word === '/roll' || word === '/r') {");
  const b = a < 0 ? -1 : src.indexOf("    if (word === '/help' || word === '/commands') {", a);
  const branch = (a >= 0 && b >= 0) ? src.slice(a, b) : null;
  yes('the server answers /roll', branch !== null);
  // Read off PLAYER_WORDS rather than its last line, which moves as words
  // leave it for keys and panels (#1628 took /yes and /no off before it).
  const pw = /^const PLAYER_WORDS = (\[[\s\S]*?\]);$/m.exec(src);
  let told = [];
  try { told = pw ? new Function('return ' + pw[1].replace(/\/\/[^\n]*/g, ''))() : []; } catch (e) { told = []; }
  yes('and it is a command people are told about', told.indexOf('/roll') !== -1);

  if (branch) {
    yes('the server is the one rolling', /Math\.random/.test(branch));

    /*
      Run it. Two people in the same room and one across the hold, so the
      broadcast is checked as well as the arithmetic.
    */
    function roll(spec, opts) {
      opts = opts || {};
      const said = [];
      const store = {
        1: { pid: 11, name: 'Bjorn', cell: 'town:X.esm', pos: [0, 0, 0] },
        2: { pid: 12, name: 'Sera', cell: 'town:X.esm', pos: [100, 0, 0] },
        3: { pid: 13, name: 'Far', cell: 'town:X.esm', pos: [90000, 0, 0] },
        4: { pid: 14, name: 'Elsewhere', cell: 'inn:X.esm', pos: [0, 0, 0] }
      };
      const mp = {
        get: function (id, key) {
          if (id === 0 && key === 'onlinePlayers') { return [1, 2, 3, 4]; }
          const r = store[id];
          if (!r) { return undefined; }
          if (key === 'profileId') { return r.pid; }
          if (key === 'appearance') { return { name: r.name }; }
          if (key === 'worldOrCellDesc') { return r.cell; }
          if (key === 'pos') { return r.pos; }
          return undefined;
        }
      };
      const body = 'var word = "/roll";\n' +
                   'var parts = ["/roll"].concat(spec ? [spec] : []);\n' +
                   branch.replace(/\n\s*return;\s*\n\s*\}\s*$/, '\n    }\n');
      const fn = new Function(
        'spec', 'mp', 'toProfile', 'log', 'needCharacter', 'OOC_RANGE',
        'ROLL_MAX_SIDES', 'ROLL_MAX_DICE', 'ROLL_DEFAULT_SIDES',
        'actorId', 'profileId', 'Math', 'isFinite', 'parseInt', 'String',
        body);
      fn(spec, mp,
         function (pid, line) { said.push({ pid: pid, line: line }); },
         function () { }, function () { return !opts.noCharacter; },
         4000, 1000, 100, 20, 1, 11,
         { random: opts.random || Math.random, floor: Math.floor }, isFinite, parseInt, String);
      return said;
    }

    // A fixed die, so the arithmetic can be checked rather than guessed at.
    const half = function () { return 0.5; };

    {
      const out = roll('20', { random: half });
      const mine = out.filter(s => s.pid === 11).map(s => s.line);
      yes('a roll says who rolled it, so a line cannot be somebody else\'s',
          mine.length === 1 && /^Bjorn rolls 20: /.test(mine[0]));
      yes('and the number is the server\'s own', /: 11$/.test(mine[0]));
      yes('somebody in the same room hears it', out.some(s => s.pid === 12));
      yes('somebody across the hold does not', !out.some(s => s.pid === 13));
      yes('and somebody through a door does not', !out.some(s => s.pid === 14));
    }

    {
      const out = roll('6x3', { random: half });
      const mine = out.filter(s => s.pid === 11)[0].line;
      yes('several dice are added up and shown',
          mine === 'Bjorn rolls 3x6: 4 + 4 + 4 = 12');
    }

    {
      // Twenty, not ten: the breakdown is shown up to twelve dice, so ten of
      // them still lists every one and the first version of this check was
      // asking the wrong side of the line.
      const out = roll('30x20', { random: half });
      const mine = out.filter(s => s.pid === 11)[0].line;
      yes('and a handful too big to read is a total only',
          /^Bjorn rolls 20x30: \d+$/.test(mine) && mine.indexOf('+') === -1);
    }

    {
      const out = roll('', { random: half });
      yes('nothing after it is a twenty',
          /rolls 20: /.test(out.filter(s => s.pid === 11)[0].line));
    }

    {
      const bad = roll('fish', { random: half });
      yes('nonsense is refused, and only to the person who typed it',
          bad.length === 1 && bad[0].pid === 11 && /The number is the sides/.test(bad[0].line));
      const big = roll('99999', { random: half });
      yes('and so is a number nobody meant', /The number is the sides/.test(big[0].line));
      const many = roll('20x999', { random: half });
      yes('and a bucket of dice', /The number is the sides/.test(many[0].line));
    }

    // The range, run rather than reasoned about.
    {
      let low = 99, high = 0;
      for (let i = 0; i < 400; i++) {
        const line = roll('6')[0].line;
        const n = Number(/: (\d+)$/.exec(line)[1]);
        if (n < low) { low = n; }
        if (n > high) { high = n; }
      }
      yes('a six sided die lands between one and six and uses both ends',
          low === 1 && high === 6);
    }
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
