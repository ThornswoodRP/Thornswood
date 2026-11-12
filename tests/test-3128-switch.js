// test-3128-switch.js
//
//     node .\tests\test-3128-switch.js
//
// Change character in the game (#3128). Patrick: switch to another character
// from inside the game, without closing Skyrim and going back through the
// launcher, at the same screen that picks a slot, makes a new character and
// deletes one; on the report page, 22 Oct, any time out of combat after a
// 10 second wait in place.
//
// THE WAY OUT. The idle block and the change character block of
// thornswood-front.js are lifted out and run in a vm with a stand-in game and
// a clock of its own: the button, the countdown, what stops it (moving, a
// fight, getting hurt, dying, the button again, leaving the world), and the
// way out at the end (the connection closed, the main menu, the choice back
// with the character just left).
//
// THE PICK AGAIN. passProfile reads whose a join pass is; pickedAgain moves
// the chat to the new character and drops another character's pass from
// storage; the joinpass block and the line only take this character's pass;
// the menu lights the one just left; voice follows the front's profile.
//
// THE BUTTON AND THE WORDS. The K panel's button, hidden while creating; the
// help panel says how it works.
//
// THE LAUNCHER. The menu's list is written again after each pick and each
// forget while the game runs, json only; a spare minted by a pick is checked
// in at once; the time played goes to each character; the rows file is
// written whole.
//
// Read only. Nothing connects to anything.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const CR = String.fromCharCode(13);
const ROOT = path.join(__dirname, '..');
function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8').split(CR).join(''); }
const front = read('game/plugins/thornswood-front.js');
const voice = read('game/plugins/thornswood-voice.js');
const skills = read('game/ui/thornswood-skills.js');
const help = read('game/ui/thornswood-help.js');
const charsCs = read('launcher/app/Chars.cs');
const shellChars = read('launcher/app/ShellChars.cs');
const shellCs = read('launcher/app/Shell.cs');
const creation = read('docs/systems/creation.md');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}
const EM = String.fromCharCode(0x2014);
const FORBIDDEN = new RegExp('pla' + 'yer', 'i');
function clean(s) { return String(s).indexOf(EM) < 0 && !FORBIDDEN.test(String(s)); }

// Text from a line that starts with head to the brace that closes it.
function lift(text, head) {
  const a = text.indexOf(head);
  if (a < 0) return null;
  const open = text.indexOf('{', a);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') { depth--; if (depth === 0) return text.slice(a, i + 1); }
  }
  return null;
}

// ================================================================ the way out
const HEAD = '  /*\n    ------------------------------------------------- are you still here (#1142)';
const TAIL = "      note('Changing character in ' + left + (left === SWITCH_WAIT_MS / 1000 ? '. Stay where you are.' : '.'));\n    }\n  }));\n";
const fa = front.indexOf(HEAD);
const fb = front.indexOf(TAIL, fa);
yes('the idle block and the change character block are in thornswood-front.js where this expects them', fa >= 0 && fb > fa);
if (!(fa >= 0 && fb > fa)) done();
const blocks = front.slice(fa, fb + TAIL.length);
yes('the numbers: a 10 second wait, and 32 units counts as moving',
    /const SWITCH_WAIT_MS = 10000;/.test(blocks) && /const SWITCH_MOVE_UNITS = 32;/.test(blocks));

function game(opts) {
  opts = opts || {};
  const g = {
    now: 1000000, logs: [], notes: [], js: [], told: [], claims: {}, handlers: {},
    pos: { x: 0, y: 0, z: 0, az: 0, ax: 0 }, hp: 100, combat: false, dead: false,
    destroyed: 0, quit: 0, lineStarts: []
  };
  const box = {
    Date: { now: function () { return g.now; } }, Math: Math, Number: Number, String: String, JSON: JSON,
    PROFILE: 'profile' in opts ? opts.profile : 4242, chooseAtMenu: opts.chooseAtMenu !== false,
    HOST: 'h', client: { 'server-port': 7777 },
    menuPhase: 9, menuAt: 0, menuAsked: 0, menuLoaded: true, menuBeatAt: 0, menuReloads: 0, menuGaveUp: false,
    menuChosenId: 0, menuAgain: null, relogAt: 5,
    globalThis: { __thornswoodInWorld: true },
    log: function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); },
    note: function (t) { g.notes.push(t); },
    guard: function (name, fn) { return fn; },
    T: { js: function (s) { g.js.push(s); return true; }, claimFocus: function (who, on) { g.claims[who] = !!on; } },
    inject: function () { },
    tellServer: function (l) { g.told.push(l); },
    keysHeldNow: function () { return 0; },
    raceMenuOpen: function () { return false; },
    myName: function () { return 'Bjorn'; },
    lineStart: function (id, o) { g.lineStarts.push({ id: id, o: o }); },
    sp: {
      on: function (ev, fn) { (g.handlers[ev] = g.handlers[ev] || []).push(fn); },
      Game: {
        getPlayer: function () {
          if (g.nobody) return null;
          return { getPositionX: function () { return g.pos.x; }, getPositionY: function () { return g.pos.y; },
                   getPositionZ: function () { return g.pos.z; }, getAngleZ: function () { return g.pos.az; },
                   getAngleX: function () { return g.pos.ax; },
                   getActorValue: function (av) { return av === 'Health' ? g.hp : 0; },
                   isInCombat: function () { return g.combat; }, isDead: function () { return g.dead; } };
        },
        quitToMainMenu: function () { g.quit++; }
      },
      mpClientPlugin: { destroyClient: function () { g.destroyed++; } }
    }
  };
  vm.createContext(box);
  vm.runInContext(blocks + '\n;globalThis.__api = { press: function () { switchAsked = true; },' +
                  ' get at() { return switchAt; }, get gone() { return afkGone; } };', box);
  g.box = box;
  g.api = box.globalThis.__api;
  g.update = function () { (g.handlers.update || []).forEach(function (fn) { fn(); }); };
  g.pass = function (ms, each) {
    const end = g.now + ms;
    while (g.now < end) { g.now = Math.min(end, g.now + 250); if (each) { each(); } g.update(); }
  };
  g.press = function () { g.api.press(); g.update(); };
  g.lastNote = function () { return g.notes[g.notes.length - 1] || ''; };
  g.out = function () { return g.destroyed > 0 || g.quit > 0; };
  return g;
}

let G = game();
G.update();
G.press();
yes('the button starts the wait, and nothing leaves yet', G.api.at > 0 && !G.out());
G.update();
yes('the first line says how long and to stay put', G.notes.indexOf('Changing character in 10. Stay where you are.') >= 0);
G.pass(9000);
yes('a line a second, counting down', ['9', '5', '1'].every(function (n) { return G.notes.indexOf('Changing character in ' + n + '.') >= 0; }));
yes('9 seconds on, still in the world', !G.out() && G.api.at > 0);
G.pass(1250);
yes('at 10 seconds the connection to the game server closes, so the client does not join again as the same character', G.destroyed === 1);
yes('and the game goes to the main menu', G.quit === 1);
yes('it is no longer in the world, and the idle check stands down', G.box.globalThis.__thornswoodInWorld === false && G.api.gone);
yes('the character choice comes back, the old page taken off and the menu started again',
    G.box.menuPhase === 0 && G.box.menuChosenId === 0 && G.box.menuLoaded === false &&
    G.js.some(function (s) { return /"ts-select","ts-select-css","ts-thornswood-select-js"/.test(s); }));
yes('with the character just left, by id and name, marked as a change of character',
    G.box.menuAgain && G.box.menuAgain.id === 4242 && G.box.menuAgain.name === 'Bjorn' && G.box.menuAgain.switched === true);
yes('and no place in line and nothing said to the server: a change of character is a quit, not idling',
    G.lineStarts.length === 0 && G.told.length === 0);
G.pass(5000);
yes('it leaves once', G.destroyed === 1 && G.quit === 1);

function stoppedBy(what, setup, during) {
  const h = game();
  if (setup) setup(h);
  h.update();
  h.press();
  h.pass(4000);
  during(h);
  h.pass(8000);
  return { h: h, stopped: !h.out() && h.api.at === 0 };
}
let r = stoppedBy('moving', null, function (h) { h.pos.x += 40; });
yes('moving more than 32 units stops it, and says why',
    r.stopped && r.h.notes.indexOf('Change of character stopped: you moved.') >= 0);
r = stoppedBy('a small step', null, function (h) { h.pos.x += 20; });
yes('a shuffle under 32 units does not', !r.stopped && r.h.out());
r = stoppedBy('a fight', null, function (h) { h.combat = true; });
yes('getting into a fight stops it', r.stopped && r.h.notes.indexOf('Change of character stopped: you are in combat.') >= 0);
r = stoppedBy('a hit', null, function (h) { h.hp = 90; });
yes('losing health stops it', r.stopped && r.h.notes.indexOf('Change of character stopped: you were hurt.') >= 0);
r = stoppedBy('healing then a hit', null, function (h) { h.hp = 120; h.update(); h.hp = 110; });
yes('health coming back first does not hide a hit after it', r.stopped && r.h.notes.indexOf('Change of character stopped: you were hurt.') >= 0);
r = stoppedBy('healing', null, function (h) { h.hp = 120; });
yes('health coming back alone does not stop it', !r.stopped && r.h.out());
r = stoppedBy('dying', null, function (h) { h.dead = true; });
yes('dying stops it', r.stopped && r.h.notes.indexOf('Change of character stopped: your character is dead.') >= 0);
r = stoppedBy('leaving the world', null, function (h) { h.box.globalThis.__thornswoodInWorld = false; });
yes('leaving the world another way stops it', r.stopped && r.h.notes.indexOf('Change of character stopped: you left the world.') >= 0);
r = stoppedBy('the button again', null, function (h) { h.press(); });
yes('the button again stops it, as asked', r.stopped && r.h.notes.indexOf('Change of character stopped: as you asked.') >= 0);

G = game();
G.combat = true;
G.update();
G.press();
G.pass(12000);
yes('in a fight it does not start, and says why', G.api.at === 0 && !G.out() &&
    G.notes.indexOf('You cannot change character now: you are in combat.') >= 0);
G = game({ chooseAtMenu: false });
G.update();
G.press();
G.pass(12000);
yes('a game that does not pick its character at the menu does not start it, and says to press Play',
    G.api.at === 0 && !G.out() && /Close Skyrim and press Play/.test(G.lastNote()));
G = game();
G.nobody = true;
G.update();
G.press();
yes('with no character it does not start', G.api.at === 0 && G.notes.indexOf('You cannot change character now: there is no character.') >= 0);
const said = [];
(blocks.match(/(?:note|switchStop)\('[^']*'/g) || []).forEach(function (m) { said.push(m); });
(blocks.match(/'Change of character stopped[^']*'|'Changing character in '|'You cannot change character now: '[^)]*/g) || []).forEach(function (m) { said.push(m); });
yes('every line it says has no em dash and never says the word nobody uses', said.length > 5 && said.every(clean));

// ============================================================= the pick again
const ppSrc = lift(front, 'function passProfile(raw)');
yes('passProfile is in the front', !!ppSrc);
const pp = vm.runInNewContext('(' + ppSrc + ')', { String: String, Number: Number, JSON: JSON });
function passFor(p) {
  const body = Buffer.from(JSON.stringify({ p: p, x: 1, s: 'main', d: '1', i: 1, v: 1 })).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'jp1.' + body + '.' + 'A'.repeat(43);
}
yes('passProfile reads whose a join pass is', pp(passFor(4242)) === 4242 && pp(passFor(7)) === 7 && pp(passFor(1893288986)) === 1893288986);
yes('and 0 for what is not a pass', pp('') === 0 && pp('jp1.x') === 0 && pp('jp2.' + passFor(1).slice(4)) === 0 &&
    pp('jp1.@@@.abc') === 0 && pp(null) === 0);

const pickedSrc = lift(front, 'function pickedAgain(id)');
yes('pickedAgain is in the front', !!pickedSrc);
function picked(id, stored) {
  const g = { js: [], logs: [], storage: { thornswoodJoinPass: stored } };
  const box = {
    T: { js: function (s) { g.js.push(s); } }, sp: { storage: g.storage },
    log: function () { g.logs.push(Array.prototype.join.call(arguments, ' ')); },
    String: String, Number: Number, JSON: JSON
  };
  vm.createContext(box);
  vm.runInContext(ppSrc + '\n' + pickedSrc + '\npickedAgain(' + id + ');', box);
  return g;
}
let p = picked(555, { pass: passFor(4242), key: 'k' });
yes('a pick as another character moves the chat (and voice on its socket) to it',
    p.js.some(function (s) { return /window\.thornswoodNet\.rejoinAs\(555,""\)/.test(s); }));
yes('and drops the one before\'s join pass from storage, so the login waits for this one\'s',
    p.storage.thornswoodJoinPass === null && /waits for profile 555/.test(p.logs.join('\n')));
p = picked(4242, { pass: passFor(4242), key: 'k' });
yes('picking the same character keeps its pass', p.storage.thornswoodJoinPass && p.storage.thornswoodJoinPass.key === 'k');
const menuChose = lift(front, 'function menuChose(');
yes('a pick at the choice in the game runs pickedAgain before it connects again',
    !!menuChose && /if \(menuAgain\) \{ pickedAgain\(id\); relogAs\(id\); \}/.test(menuChose));
yes('the joinpass block takes only this character\'s pass off the launcher',
    /if \(passProfile\(raw\) !== PROFILE\) \{ return; \}/.test(front));
yes('and the line sends only the pass of the character it waits as',
    /const passOk = \/\^jp1[^\n]*\.test\(pass\) && passProfile\(pass\) === lineId;/.test(front));
const where = lift(front, 'function menuWhere(href, has)');
yes('the choice after a change lights the character just left and fills in its name when the list has none',
    !!where && /else if \(menuAgain\.switched\) \{\s*list\.last = menuAgain\.id;/.test(where) &&
    /!c\.name && menuAgain\.name\) \{ c\.name = menuAgain\.name; \}/.test(where));
yes('with no sentence over the slots and no place in line', !!where && !/switched[\s\S]{0,200}list\.away/.test(where.slice(where.indexOf('menuAgain.switched'), where.indexOf('menuAgain.switched') + 260)));
yes('the front tells the other plugins who it is now (Thornswood.profile)', /T\.profile = function \(\) \{ return PROFILE; \};/.test(front));
yes('voice asks the front who it is, and the settings file only when the front cannot say',
    /T && typeof T\.profile === 'function'/.test(voice) && /return id \|\| profileId;/.test(voice) && /profileId: configuredAs,/.test(voice));
yes('and tells its page again once the front is somebody else', /if \(phase === 2 && currentProfile\(\) !== configuredAs\) \{/.test(voice));
yes('the K panel\'s message reaches the change character block', /if \(what === 'skills:switch'\) \{ switchAsked = true; return; \}/.test(front));

// ================================================== the button and the words
yes('the K panel has a Change character button at its foot', /data-act="switch">Change character<\/div>/.test(skills));
yes('hidden while making a character', /elSwitch\.style\.display = cr \? 'none' : '';/.test(skills));
yes('which says skills:switch and closes the panel',
    /elSwitch\.onclick = function \(\) \{[\s\S]{0,80}tell\('switch'\);\s*api\.close\(\);/.test(skills));
const helpLine = (help.match(/'Change character, at the foot of '[^\]]*?stops it too\.'/) || [''])[0];
yes('the help panel says where it is and what stops it', helpLine.length > 0 && /ten seconds/.test(helpLine) && clean(helpLine));
yes('docs/systems/creation.md says how changing character works', /## Changing character in the game/.test(creation) && /#3128/.test(creation));

// =============================================================== the launcher
const poll = lift(shellChars, 'static void PollChoice()') || '';
yes('a forget while the game runs tells the site and writes the menu\'s list again, off the window\'s thread',
    /ThreadPool\.QueueUserWorkItem\(delegate\s*\{[\s\S]*Chars\.Forget\(forget\);[\s\S]*Chars\.Relist\(cfg\);\s*\}\);/.test(poll));
yes('a pick checks in the spare it minted, since no Play comes before the next menu',
    /spareWas = Chars\.SpareId\(\);[\s\S]*Chars\.Chose\(id\);[\s\S]*spareNow = Chars\.SpareId\(\);/.test(poll) &&
    /if \(CheckIn\(id\) && spareNow > 0 && spareNow != spareWas\) CheckIn\(spareNow\);/.test(poll));
yes('and then writes the menu\'s list again', /CheckIn\(spareNow\);\s*Chars\.Relist\(cfg\);/.test(poll));
yes('the character left gets the time played since its pick, before the new one is written down',
    /TimeSpan beforeRan = DateTime\.Now - PlayCountedFrom\(\);/.test(poll) &&
    poll.indexOf('beforeRan = ') < poll.indexOf('chosenId = id;') &&
    /Chars\.AddPlaytime\(before, beforeRan\);/.test(poll) &&
    poll.indexOf('AddPlaytime(before') < poll.indexOf('Chars.Chose(id)'));
yes('and the last one played gets its own at close, not the whole session',
    /TimeSpan counted = DateTime\.Now - PlayCountedFrom\(\);/.test(shellCs) &&
    /Chars\.AddPlaytime\(playedAs, counted\);/.test(shellCs) &&
    /return choseAt > playStartedAt \? choseAt : playStartedAt;/.test(shellChars));
const relist = lift(charsCs, 'public static void Relist(Config cfg)') || '';
yes('Relist writes the json only, never the page\'s script the front deletes after a pick',
    /WriteList\(CharactersJson\(rows, LastPlayedId\(rows\), SpareId\(\), Slots\(\)\)\)/.test(relist) &&
    !/thornswood-characters\.js/.test(relist) && !/Save\(/.test(relist));
yes('and refreshes the roster first, off the window\'s thread', /Roster\.Refresh\(cfg\)/.test(relist));
const writeChars = lift(charsCs, 'static void WriteCharacters(Config cfg, List<Row> rows, int last, int spare, int slots)') || '';
yes('Play\'s list and Relist\'s are the same text', /string listed = CharactersJson\(rows, last, spare, slots\);/.test(writeChars) &&
    /WriteList\(listed\);/.test(writeChars));
const json = lift(charsCs, 'static string CharactersJson(List<Row> rows, int last, int spare, int slots)') || '';
yes('a character staff killed since the last Play is marked dead from the roster',
    /isDead = isDead \|\| Roster\.Dead\(r\.Id\);/.test(json));
// The list is the site's since #5938: Relist takes a copy of the last answer
// under its lock, so it never reads one half replaced.
yes('Relist reads a whole copy of the site\'s last answer, never a file of rows',
    /lock \(heldGate\) \{ return new List<Row>\(held\); \}/.test(charsCs) && !/static void Save\(/.test(charsCs));

done();
