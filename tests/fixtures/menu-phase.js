// The real setMenuPhase out of game/plugins/thornswood-front.js, as source.
//
// Every move of the front's menuPhase goes through it, so skymp5-client knows
// when the character choice is held (#4616). A harness that lifts a piece of
// the front that moves the phase (backToChoice, menuChose, cameBack and the
// rest) runs this beside it, in the same scope as its menuPhase and
// chooseAtMenu, and reads globalThis.__thornswoodChoiceHeld if it wants to.
'use strict';
const fs = require('fs');
const path = require('path');

const front = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8')
  .split('\r').join('');
const at = front.indexOf('  function setMenuPhase(p) {');
const end = at < 0 ? -1 : front.indexOf('\n  }\n', at);
if (at < 0 || end < 0) { throw new Error('setMenuPhase is not in game/plugins/thornswood-front.js'); }
module.exports = front.slice(at, end + 4) + '\n';
