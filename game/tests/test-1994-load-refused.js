// test-1994-load-refused.js
//
//     node .\game\tests\test-1994-load-refused.js
//
// A save the game refuses to build stops the load and says why (#1994).
//
// A character picked at the menu is loaded from a save SkyrimPlatform builds
// on the spot. Upstream's catch in skymp5-client's LoadGameService loaded the
// character again with no appearance when building it failed, so they arrived
// with the menu template's face, race and gear and nothing said why. The fork
// now logs the refusal, hands its reason to the front in
// __thornswoodLoadRefused and loads nothing (fork test
// misc/tests/node/test_initial_load_inventory.js). This is the front's half:
// it closes the connection and brings the character choice back with a
// sentence over the slots, the path the server's own end takes (#1157,
// test-1157-session-ends.js, which also runs the page with LIST.ended).
//
// loadRefused and backToChoice are lifted out of thornswood-front.js and run
// in a vm with a stand-in game. Read only. Nothing connects to anything.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const front = fs.readFileSync(path.join(__dirname, '..', '..', 'game', 'plugins', 'thornswood-front.js'), 'utf8').split(CR).join('');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

const HEAD = '  /* The character choice again, after the world (afkOut, sessionEnded). again is menuAgain. */';
const TAIL = '    backToChoice({ id: me, name: \'\', ended: LOAD_REFUSED_WORDS });\n    return true;\n  }\n';
const a = front.indexOf(HEAD);
const b = a < 0 ? -1 : front.indexOf(TAIL, a);
yes('backToChoice and loadRefused are in thornswood-front.js where this expects them', a >= 0 && b > a);
if (!(a >= 0 && b > a)) { done(); }
const lifted = front.slice(a, b + TAIL.length);

function game(flag) {
  const g = { logs: [], js: [], net: { up: true, destroyed: 0, created: 0 } };
  const box = {
    Date: Date, String: String,
    PROFILE: 4242, menuChosenId: 4242, menuAgain: null,
    menuPhase: 9, menuAt: 0, menuAsked: 0, menuLoaded: true, menuBeatAt: 0, menuReloads: 0, menuGaveUp: false, relogAt: 5,
    globalThis: { __thornswoodLoadRefused: flag },
    log: function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); },
    T: { js: function (s) { g.js.push(s); return true; } },
    sp: { mpClientPlugin: {
      destroyClient: function () { g.net.up = false; g.net.destroyed++; },
      createClient: function () { g.net.up = true; g.net.created++; }
    } }
  };
  vm.createContext(box);
  vm.runInContext(lifted + '\n;globalThis.__api = { loadRefused: loadRefused, words: LOAD_REFUSED_WORDS };', box);
  g.box = box;
  g.api = box.globalThis.__api;
  return g;
}

const WHY = 'Form 0xFE029827 names light plugin 41 and the game listed 30';

{
  const G = game('');
  yes('nothing refused: nothing happens', G.api.loadRefused() === false && G.net.destroyed === 0 &&
      G.box.menuAgain === null && G.box.menuPhase === 9 && G.logs.length === 0);
}

{
  const G = game(WHY);
  yes('a refusal is taken on the next tick', G.api.loadRefused() === true);
  yes('the reason is taken once: the flag is cleared', G.box.globalThis.__thornswoodLoadRefused === '');
  yes('the connection closes, so the client has nothing to connect again', G.net.destroyed === 1 && G.net.up === false);
  yes('and nothing connects by itself', G.net.created === 0);
  yes('the character choice comes back: the old page is taken off and the menu starts again',
      G.box.menuPhase === 0 && G.box.menuChosenId === 0 && G.box.menuLoaded === false && G.box.relogAt === 0 &&
      G.js.some(function (s) { return /"ts-select","ts-select-css","ts-thornswood-select-js"/.test(s); }));
  yes('with the sentence for the page and the character that was picked',
      G.box.menuAgain && G.box.menuAgain.id === 4242 && G.box.menuAgain.ended === G.api.words);
  yes('the front log names the reason the game gave', G.logs.some(function (l) { return l.indexOf(WHY) >= 0 && /profile 4242/.test(l); }));
  yes('a second tick does nothing more', G.api.loadRefused() === false && G.net.destroyed === 1);
}

{
  const G = game(WHY);
  G.box.menuChosenId = 0;
  G.api.loadRefused();
  yes('after the choice gave up its repeat, the profile the front holds is used', G.box.menuAgain && G.box.menuAgain.id === 4242);
}

{
  const G = game(WHY);
  const w = G.api.words;
  yes('the sentence says nothing was loaded and where the reason is', /could not be loaded/.test(w) && /nothing was loaded/.test(w) && /logs/.test(w));
  yes('the sentence has no em dash and does not say player', w.indexOf(String.fromCharCode(0x2014)) < 0 && !/player/i.test(w));
}

const tick = front.indexOf("sp.on('tick', guard('menu', () => {");
const say = tick < 0 ? -1 : front.indexOf('if (menuChosenId) { keepSayingChoice(now); }', tick);
const asks = tick < 0 ? -1 : front.indexOf('if (loadRefused()) { return; }', tick);
yes('the menu tick asks loadRefused, and stops there when it took one', tick >= 0 && asks > tick);
yes('before the choice is said again, so a refused pick is not repeated to the client', asks > 0 && say > asks);
yes('and the page is given the sentence, and no place in line (the path #1157 uses)',
    /if \(menuAgain\.ended\) \{ list\.ended = String\(menuAgain\.ended\); \}\s*else if \(menuAgain\.switched\) \{[^]*?\}\);\s*\}\s*else \{ list\.away = menuAgain; \}/.test(front));

done();
