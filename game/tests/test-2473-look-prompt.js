// test-2473-look-prompt.js
//
// What the game itself offers when you look at a person, written down (#2473).
//
// Patrick, 12 Oct: looking at another person shows the game's own "Talk to"
// prompt, twice, over the look panel, the adventure menu and the name tags.
// Two layers in this build can draw it: the HUD's own activate line, and
// Better Third Person Selection's widget, which copies that line and draws it
// at the person in third person. Which one is on screen, and whether the two
// copies are those two, is not known yet, so nothing is changed until a
// session says. This proves the probe that says it: it reads the HUD's line,
// that mod's menu, the camera and the activation block, once per new person
// looked at, and writes nothing to any menu.
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
const CR = String.fromCharCode(13);
const front = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8')
  .split(CR).join('');

const m = /  function gamePromptSaid\(ref\) \{[\s\S]*?\n  \}\n/.exec(front);
yes('the probe is in the front plugin', !!m);

if (m) {
  const asked = [];
  const wrote = [];
  const sp = {
    Game: { getCameraState: function () { return 9; } },
    Ui: {
      getString: function (menu, target) {
        asked.push(menu + ' ' + target);
        return /RolloverText\.text$/.test(target) ? 'Talk' : 'Sera';
      },
      isMenuOpen: function (name) { asked.push('open ' + name); return name === 'BTPS Menu'; },
      setString: function () { wrote.push('setString'); },
      invokeString: function () { wrote.push('invokeString'); },
      setBool: function () { wrote.push('setBool'); }
    }
  };
  const said = new Function('sp', m[0] + '\nreturn gamePromptSaid;')(sp);
  const line = said({ isActivationBlocked: function () { return true; } });
  yes('it names the camera', /camera third person/.test(line));
  yes('it says what the HUD\'s own line holds', /the HUD line "Talk" \/ "Sera"/.test(line));
  yes('it reads the HUD\'s rollover, the line the game writes its prompt into',
      asked.indexOf('HUD Menu _root.HUDMovieBaseInstance.RolloverText.text') !== -1);
  yes('it says whether Better Third Person Selection\'s widget is up',
      /Better Third Person Selection's widget menu up/.test(line) && asked.indexOf('open BTPS Menu') !== -1);
  yes('it says whether the activation is blocked', /activation blocked yes/.test(line));
  yes('it writes nothing to any menu', wrote.length === 0);

  const quiet = new Function('sp', m[0] + '\nreturn gamePromptSaid;')({
    Game: { getCameraState: function () { throw new Error('no'); } },
    Ui: { getString: function () { throw new Error('no'); }, isMenuOpen: function () { throw new Error('no'); } }
  });
  let threw = false;
  let l2 = '';
  try { l2 = quiet({}); } catch (e) { threw = true; }
  yes('a game that answers none of it still gets its look line', !threw && /activation blocked unknown/.test(l2));
}

yes('it is written once per new person looked at, not every poll',
    /if \(hex !== lookingAt\) \{\n      lookingAt = hex;\n      say\('looking at ' \+ row\.n \+ ' \(' \+ hex \+ '\)' \+ gamePromptSaid\(ref\)\);/.test(front));

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
