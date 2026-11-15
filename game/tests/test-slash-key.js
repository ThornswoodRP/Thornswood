// test-slash-key.js
//
// / opens the chat with a slash already in it, and the game's skill tree,
// which is also on /, stays shut.
//
// Patrick, 27 September: "can we also make / pull up the text chat and enter
// slash and not the vanilla skyrims skill tree thingg and only the chat".
//
// WHAT THIS RUNS. The real / block out of thornswood-front.js (ourKeyMenu down
// to the key handler) and its busyMenuOpenNow, over a pretend game that says
// which menus are up and records what was shut. The game keeps the order
// Patrick's dev log of 28 September shows (issue 957): the tree is in the
// game's menu stack when / is heard and its menuOpen comes later, which the
// old block took for a tree that was up before / and refused the chat. The key handler itself is read for its two lines. The
// chat page's focusInput is run in a stand-in page, because the slash has to
// be typed the way React hears it.
//
// Read only.
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const CR = String.fromCharCode(13);
function read(...bits) { return fs.readFileSync(path.join(ROOT, ...bits), 'utf8').split(CR).join(''); }
const front = process.env.FRONT ? fs.readFileSync(process.env.FRONT, 'utf8').split(CR).join('') :
              read('game', 'plugins', 'thornswood-front.js');
const bridge = read('game', 'ui', 'thornswood-bridge.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

// From the shared watcher (ourKeyMenu, which P uses too) to the end of the
// / press, commandKeyPressed. It used to run on to the key handler; since
// #1430 the message board, ride and merchant blocks sit between the two, with
// update handlers of their own that are not this file's business.
const a = front.indexOf("  // ------------------------------------ the game's menu on one of our keys --");
const c = a < 0 ? -1 : front.indexOf('  function commandKeyPressed(e) {', a);
const b = c < 0 ? -1 : front.indexOf('\n  }\n', c) + 4;
const block = a >= 0 && c > a && b > c ? front.slice(a, b) : null;
yes('the / block is in the plugin', block !== null);
yes('the plugin reads CommandKey, / by default',
    /(?:const|let) COMMAND_KEY = iniNumber\(ini, 'CommandKey', 53\);/.test(front));
const bm = front.indexOf('  function busyMenuOpenNow(except) {');
const busyFn = bm >= 0 ? front.slice(bm, front.indexOf('\n  }\n', bm) + 4) : null;
yes('the menu check takes the one menu a key of ours just opened', busyFn !== null);

// ------------------------------------------------------------ the handler
{
  const kh = front.indexOf("  sp.on('buttonEvent', guard('keys', (e) => {");
  const k = kh < 0 ? '' : front.slice(kh, front.indexOf('\n  }));\n', kh));
  yes('the key handler sends / to the block, before the chat key',
      /if \(e\.code === COMMAND_KEY\) \{ commandKeyPressed\(e\); return; \}\s*\n\s*if \(e\.code !== CHAT_KEY\) return;/.test(k));
  yes('and every key going down ends a / press\'s claim on the next tree',
      /journalKeyDown\(e\);[\s\S]{0,200}statsOnSlash\.keyDown\(\);/.test(k));
  const w = front.slice(front.indexOf('  function wantTyping(on, prefill) {'));
  yes('wantTyping hands what to type to the page\'s focusInput, both ways it asks',
      (w.slice(0, 3000).match(/focusInput\(' \+ fill \+ '\)/g) || []).length === 2);
}

/// ------------------------------------------------------------ the block
/*
  The pretend game keeps the order Patrick's dev log of 28 September shows:
  the game has its menu in the stack by the time the plugin hears the key
  ("key 25 seen, but MagicMenu is open"), and the menuOpen event comes later
  ("the game's journal opened 37ms after the press"). opt.eventFirst runs the
  other order, the menuOpen before the key. opt.late opens the tree a frame
  after the key instead of before it.
*/
function rig(opt) {
  opt = opt || {};
  const w = { now: 100000, menus: {}, shut: [], typed: [], said: [], handlers: {}, mapped: 53, events: [], opened: 0, kept: {}, keptCalls: [] };
  w.menus = Object.assign({}, opt.menus || {});
  const T = { ready: !opt.notReady };
  const commandKey = opt.commandKey || 53;
  const sp = {
    setMenuOpenKeyBlocked: opt.client ? function (event, code, on, except) {
      w.keptCalls.push({ event: event, code: code, on: on });
      if (on) { w.kept[event + ':' + code] = except.slice(); }
      else { delete w.kept[event + ':' + code]; }
    } : undefined,
    on: function (n, f) { (w.handlers[n] = w.handlers[n] || []).push(f); },
    Ui: { isMenuOpen: function (n) { return !!w.menus[n]; } },
    Utility: { isInMenuMode: function () { return Object.keys(w.menus).some(function (k) { return w.menus[k]; }); } },
    Input: { getMappedKey: function (name) { return name === 'Quick Stats' ? w.mapped : -1; } },
    TESModPlatform: {
      closeMenu: function (n) {
        w.shut.push(n);
        if (!opt.stuck && w.menus[n]) { w.menus[n] = false; w.events.push(['menuClose', n]); }
      }
    }
  };
  const clock = { now: function () { return w.now; } };
  const claims = { chat: !!opt.typing };
  const body =
    "const KEYBOARD_MENUS = ['InventoryMenu', 'MagicMenu', 'StatsMenu', 'TweenMenu'];\n" +
    'function gameMenuOpen() { return sp.Utility.isInMenuMode(); }\n' +
    busyFn + '\n' +
    'function wantTyping(on, prefill) { typed.push([on, prefill]); }\n' +
    block + '\nreturn { press: commandKeyPressed, keyDown: function () { statsOnSlash.keyDown(); magicOnP.keyDown(); } };';
  const api = new Function('sp', 'say', 'guard', 'claims', 'typed', 'Date', 'T', 'COMMAND_KEY', body)(
    sp, function (t) { w.said.push(t); }, function (n, f) { return f; }, claims, w.typed, clock, T, commandKey);
  function fire(ev, name) { (w.handlers[ev] || []).forEach(function (f) { f({ name: name }); }); }
  // The events the game has queued for the plugin, in order.
  w.deliver = function () { w.events.splice(0).forEach(function (e) { fire(e[0], e[1]); }); };
  // A menu goes into the game's stack; its menuOpen is queued, not fired.
  w.opens = function (n) {
    if (w.menus[n]) { return; }
    w.menus[n] = true;
    w.opened++;
    w.events.push(['menuOpen', n]);
  };
  // The person presses /. The game takes it first, as Quick Stats.
  w.press = function (name) {
    const control = name === undefined ? 'Quick Stats' : name;
    const took = control ? control === 'Quick Stats' : w.mapped === 53;
    const nativeControl = control || (w.mapped === commandKey ? 'Quick Stats' : '');
    const except = w.kept[nativeControl + ':' + commandKey];
    const blocked = !!except && !except.some(function (n) { return !!w.menus[n]; });
    if (took && !blocked && !opt.late && !opt.refuse) { w.opens('StatsMenu'); }
    if (opt.eventFirst) { w.now += 20; w.deliver(); }
    api.keyDown();
    api.press({ code: commandKey, userEventName: control });
    if (took && !blocked && opt.late && !opt.refuse) { w.opens('StatsMenu'); }
  };
  // One frame: the update, then what the game queued for the plugin.
  w.tick = function (ms) {
    w.now += ms || 16;
    (w.handlers.update || []).forEach(function (f) { f(); });
    w.deliver();
  };
  w.run = function (n, ms) { for (let i = 0; i < n; i++) { w.tick(ms); } };
  w.ready = function (ready) { T.ready = ready; w.tick(); };
  w.gamePress = function (code, control) {
    const except = w.kept[control + ':' + code];
    const blocked = !!except && !except.some(function (n) { return !!w.menus[n]; });
    if (control === 'Quick Stats' && !blocked) { w.opens('StatsMenu'); }
  };
  w.api = api;
  return w;
}

if (block && busyFn) {
  // S1: THE BUG. The tree is in the game's stack before / is heard, and its
  // menuOpen comes a frame or two later.
  {
    const w = rig();
    w.press();
    yes('S1 THE BUG: / opens the chat with a slash in it, though the tree is already up',
        w.typed.length === 1 && w.typed[0][0] === true && w.typed[0][1] === '/');
    yes('S1 and the log does not say the tree was in the way', !w.said.some(function (s) { return /but StatsMenu is open/.test(s); }));
    w.tick();
    yes('S1 the tree is shut in the next frame, before its menuOpen arrives', w.shut.join() === 'StatsMenu' && !w.menus.StatsMenu);
    w.run(60);
    yes('S1 and once it is gone nothing more is asked', w.shut.length === 1);
  }
  // S1b: the tree opens a frame after the key.
  {
    const w = rig({ late: true });
    w.press();
    yes('S1b / opens the chat before the tree is up', w.typed.length === 1 && w.typed[0][1] === '/');
    w.tick();
    yes('S1b and the tree that opens after it is shut at its menuOpen', w.shut.join() === 'StatsMenu');
    w.run(60);
    yes('S1b once', w.shut.length === 1);
  }
  // S2: the other order, the tree's menuOpen before the key.
  {
    const w = rig({ eventFirst: true });
    w.press();
    yes('S2 / heard a moment after its tree opened opens the chat', w.typed.length === 1 && w.typed[0][1] === '/');
    w.run(3);
    yes('S2 and shuts that tree', w.shut.join() === 'StatsMenu');
  }
  // S3: the tree was already up: this / is the game's, to close it.
  {
    const w = rig();
    w.opens('StatsMenu');
    w.run(300);
    w.press();
    w.run(60);
    yes('S3 / in a tree that was already open does not open the chat', w.typed.length === 0);
    yes('S3 and does not shut the tree either: the game closes it on /', w.shut.length === 0);
    yes('S3 the log says why', w.said.some(function (s) { return /but StatsMenu is open/.test(s); }));
  }
  // S4: Quick Stats moved to another key. / still opens the chat; the tree is theirs.
  {
    const w = rig();
    w.mapped = 48;
    w.press('');
    w.run(2);
    w.opens('StatsMenu');
    w.run(60);
    yes('S4 with Quick Stats moved off /, / still opens the chat', w.typed.length === 1);
    yes('S4 and the tree opened by their own key is left alone', w.shut.length === 0);
  }
  // S5 and S6: not while typing, not over another menu.
  {
    const w = rig({ typing: true });
    w.press();
    w.run(60);
    yes('S5 while the chat has the keyboard, / does nothing here', w.typed.length === 0 && w.shut.length === 0);
  }
  {
    const w = rig({ menus: { InventoryMenu: true } });
    w.press();
    w.run(60);
    yes('S6 over the inventory, / neither opens the chat nor shuts anything', w.typed.length === 0 && w.shut.length === 0);
  }
  // S7: a tree that will not go.
  {
    const w = rig({ stuck: true });
    w.press();
    w.tick();
    yes('S7 a stuck tree is asked once', w.shut.length === 1);
    w.run(1, 1200);
    yes('S7 a tree still up a second after the shut is asked once more', w.shut.length === 2);
    w.run(1, 1000);
    yes('S7 and after two seconds it is said in the log and left',
        w.shut.length === 2 && w.said.some(function (s) { return /still open/.test(s); }));
    w.run(1, 1000);
    yes('S7 and not asked again', w.shut.length === 2);
  }
  // S8: a press long before the tree does not count.
  {
    const w = rig({ refuse: true });
    w.press();
    w.run(1, 1500);
    w.opens('StatsMenu');
    w.run(60);
    yes('S8 a tree opening well after the press is not taken for it', w.shut.length === 0);
  }
  // S9: another key in the same frame as / ends its claim on the tree.
  {
    const w = rig();
    w.press();
    w.api.keyDown();
    w.run(60);
    yes('S9 a key pressed in the same frame after / keeps the tree open', w.shut.length === 0);
  }
}

// The native client consults the registered list BEFORE it queues a menu.
// Counting creations catches even a menu that is shut in the same frame.
if (block && busyFn) {
  for (const opt of [{ client: true }, { client: true, late: true },
                     { client: true, eventFirst: true }]) {
    const w = rig(opt);
    w.tick();
    w.press();
    w.run(3);
    yes('native / never creates StatsMenu in either event order', w.opened === 0);
    yes('native / opens chat prefilled with /', w.typed.length === 1 && w.typed[0][1] === '/');
    yes('native / needs no close-after-open fallback', w.shut.length === 0);
    const count = w.keptCalls.length;
    w.run(3);
    yes('native list changes only when readiness changes', w.keptCalls.length === count);
  }
  {
    const w = rig({ client: true });
    w.tick();
    w.gamePress(48, 'Quick Stats');
    yes('rebinding the game skill key preserves that separate key', w.opened === 1);
  }
  {
    const w = rig({ client: true, commandKey: 48 });
    w.tick();
    w.gamePress(53, 'Quick Stats');
    yes('moving CommandKey leaves the original skill key untouched', w.opened === 1);
  }
  {
    const w = rig({ client: true, menus: { InventoryMenu: true } });
    w.tick();
    w.press();
    yes('the native list preserves keys in an existing game menu', w.opened === 1 && w.typed.length === 0);
  }
  {
    const w = rig({ client: true, notReady: true });
    w.tick();
    w.ready(true);
    w.press();
    yes('ready overlays claim the key before the game can create its tree', w.opened === 0);
    w.ready(false);
    w.gamePress(53, 'Quick Stats');
    yes('page reload releases the native key while overlays are unavailable', w.opened === 1);
  }
}
// ------------------------------------------------------------ the page
{
  const s = bridge.indexOf('  function focusInput(prefill) {');
  const e = bridge.indexOf('\n  }\n', s);
  const fn = s >= 0 && e > s ? bridge.slice(s, e + 4) : null;
  yes('the page\'s focusInput takes what to type', fn !== null);
  if (fn) {
    function page(text) {
      const el = { innerText: text, focused: false, focus: function () { this.focused = true; } };
      const doc = {
        inserted: [],
        execCommand: function (cmd, ui, v) { if (cmd === 'insertText') { this.inserted.push(v); el.innerText += v; } return true; }
      };
      const win = {};
      const run = new Function('window', 'document', 'input', 'tell', 'unfade', 'startBeat',
        'var openedAt = 0, lastKey = 0;\n' + fn + '\nreturn focusInput;')(
        win, doc, function () { return el; }, function () { }, function () { }, function () { });
      return { el: el, doc: doc, win: win, run: run };
    }
    const p1 = page('');
    p1.run('/');
    yes('an empty box gets the slash, typed with insertText so React hears it',
        p1.el.focused && p1.doc.inserted.join() === '/' && p1.el.innerText === '/');
    const p2 = page('half a line');
    p2.run('/');
    yes('a box that already has words in it is left as it is', p2.doc.inserted.length === 0);
    const p3 = page('');
    p3.run();
    yes('Enter, which asks for nothing, types nothing', p3.doc.inserted.length === 0 && p3.el.focused);
  }
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
