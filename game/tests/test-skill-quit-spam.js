// test-skill-quit-spam.js
//
// The unused skymp skills menu must not write /skill into chat when the
// browser loses focus, and initSkillMenu must not write /skill init.
//
// #612: "/skill showed in chat and I never typed it." Cause: skymp5-front
// SkillsMenu registers skymp5-client:browserUnfocused -> send('/skill quit')
// on mount, and every chat close drops focus. SweetTaffySkillMenuService can
// also dispatch initSkillMenu -> send('/skill init') at SweetPie altars.
//
// thornswood-bridge.js drops those listeners at registration and filters
// any leftover /skill line at the chat widget send.
//
//   node game/tests/test-skill-quit-spam.js
//   BRIDGE=<file> node game/tests/test-skill-quit-spam.js
//
// Read only.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BRIDGE = process.env.BRIDGE ||
  path.join(__dirname, '..', '..', 'game', 'ui', 'thornswood-bridge.js');

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}
function done() {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}

function loadBridge() {
  const listeners = [];
  const sent = [];
  const said = [];
  function el(tag) {
    return {
      tagName: String(tag).toUpperCase(), id: '', style: {},
      classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
      textContent: '', parentNode: null, childNodes: [],
      focus: function () {}, blur: function () {},
      appendChild: function (n) { this.childNodes.push(n); return n; }
    };
  }
  const chatInput = el('span');
  chatInput.id = 'chatInput';
  const doc = {
    readyState: 'complete',
    documentElement: el('html'),
    head: el('head'),
    body: el('body'),
    activeElement: null,
    createElement: el,
    getElementById: function (id) { return id === 'chatInput' ? chatInput : null; },
    addEventListener: function () {}
  };
  const realAdd = function (type, fn, opts) {
    listeners.push({ type: type, fn: fn, opts: opts });
  };
  const win = {
    document: doc,
    console: { log: function () {} },
    setTimeout: function (fn) { return 1; },
    clearTimeout: function () {},
    setInterval: function () { return 1; },
    clearInterval: function () {},
    Date: { now: function () { return 1000000; } },
    MutationObserver: function () { this.observe = function () {}; },
    addEventListener: realAdd,
    skyrimPlatform: {
      sendMessage: function () {},
      widgets: { set: function () {} }
    },
    JSON: JSON, Math: Math, Array: Array, String: String,
    Number: Number, Object: Object
  };
  win.window = win;
  // Capture the native addEventListener the bridge will bind before override.
  Object.defineProperty(win, 'addEventListener', {
    configurable: true,
    writable: true,
    value: realAdd
  });
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(BRIDGE, 'utf8'), win, { filename: 'thornswood-bridge.js' });

  // Pretend skymp front mounted SkillsMenu: register the bad listeners.
  var quitFired = 0;
  var initFired = 0;
  win.addEventListener('skymp5-client:browserUnfocused', function () {
    quitFired++;
    win._chatSend('/skill quit');
  });
  win.addEventListener('initSkillMenu', function () {
    initFired++;
    win._chatSend('/skill init');
  });
  win.addEventListener('updateSkillMenu', function () {});

  // Hook chat widget send the way the front does: call the widget send.
  var widgetSend = null;
  if (win.skyrimPlatform && win.skyrimPlatform.widgets && win.skyrimPlatform.widgets._last) {
    // not used
  }
  // Bridge stores WIDGET privately; drive through thornswoodChat if present,
  // else dig the send off widgets.set's last call by monkeypatching.
  // Simpler: expose by calling the send the bridge put on the chat widget.
  // Re-run widget discovery: after bridge load, widgets.set was called.
  // Patch: find send via a fresh widgets capture.
  return {
    win: win,
    listeners: listeners,
    quitFired: function () { return quitFired; },
    initFired: function () { return initFired; },
    dispatch: function (type) {
      listeners.filter(function (l) { return l.type === type; })
        .forEach(function (l) { l.fn({}); });
    },
    chatSend: function (text) {
      // The chat widget send is what SkillsMenu's send prop eventually hits
      // when the front routes through the chat. Drive it the same way the
      // page does: window path used by held drain / thornswoodNet.
      if (!win._widgetSend) {
        throw new Error('no widget send captured');
      }
      win._widgetSend(text);
    },
    said: said,
    sent: sent
  };
}

// Rebuild with widget send capture: intercept widgets.set
function load() {
  const listeners = [];
  const said = [];
  function el(tag) {
    return {
      tagName: String(tag).toUpperCase(), id: '', style: {},
      classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
      textContent: '', parentNode: null, childNodes: [],
      focus: function () {}, blur: function () {},
      appendChild: function (n) { this.childNodes.push(n); return n; }
    };
  }
  const chatInput = el('span');
  chatInput.id = 'chatInput';
  const doc = {
    readyState: 'complete',
    documentElement: el('html'),
    head: el('head'),
    body: el('body'),
    activeElement: null,
    createElement: el,
    getElementById: function (id) { return id === 'chatInput' ? chatInput : null; },
    addEventListener: function () {}
  };
  let widgetSend = null;
  const realAdd = function (type, fn, opts) {
    listeners.push({ type: type, fn: fn, opts: opts });
  };
  const win = {
    document: doc,
    console: { log: function () {} },
    setTimeout: function () { return 1; },
    clearTimeout: function () {},
    setInterval: function () { return 1; },
    clearInterval: function () {},
    Date: { now: function () { return 1000000; } },
    MutationObserver: function () { this.observe = function () {}; },
    addEventListener: realAdd,
    skyrimPlatform: {
      sendMessage: function () {},
      widgets: {
        set: function (list) {
          if (Array.isArray(list)) {
            for (var i = 0; i < list.length; i++) {
              if (list[i] && list[i].type === 'chat' && typeof list[i].send === 'function') {
                widgetSend = list[i].send;
              }
            }
          }
        }
      }
    },
    thornswoodNet: {
      typed: function (text) { said.push(String(text)); }
    },
    JSON: JSON, Math: Math, Array: Array, String: String,
    Number: Number, Object: Object
  };
  win.window = win;
  vm.createContext(win);
  vm.runInContext(fs.readFileSync(BRIDGE, 'utf8'), win, { filename: 'thornswood-bridge.js' });

  // Chat widget send is registered only when show() draws into widgets.set.
  if (win.thornswoodChat && typeof win.thornswoodChat.show === 'function') {
    win.thornswoodChat.show();
  }

  var quitFired = 0;
  var initFired = 0;
  win.addEventListener('skymp5-client:browserUnfocused', function () {
    quitFired++;
    if (widgetSend) widgetSend('/skill quit');
  });
  win.addEventListener('initSkillMenu', function () {
    initFired++;
    if (widgetSend) widgetSend('/skill init');
  });
  win.addEventListener('harmless', function () {});

  return {
    listeners: listeners,
    quitFired: function () { return quitFired; },
    initFired: function () { return initFired; },
    dispatch: function (type) {
      listeners.filter(function (l) { return l.type === type; })
        .forEach(function (l) { l.fn({}); });
    },
    send: function (text) { if (!widgetSend) throw new Error('no send'); widgetSend(text); },
    said: said,
    hasSend: !!widgetSend
  };
}

const src = fs.readFileSync(BRIDGE, 'utf8');
yes('bridge names browserUnfocused in DEAF_TO', /DEAF_TO\s*=\s*\[[^\]]*browserUnfocused/.test(src));
yes('bridge names initSkillMenu in DEAF_TO', /DEAF_TO\s*=\s*\[[^\]]*initSkillMenu/.test(src));
yes('bridge filters /skill at chat send', /isSkillSpam/.test(src));

const p = load();
yes('bridge loaded a chat widget send', p.hasSend);
yes('browserUnfocused listener was not kept', !p.listeners.some(function (l) { return l.type === 'skymp5-client:browserUnfocused'; }));
yes('initSkillMenu listener was not kept', !p.listeners.some(function (l) { return l.type === 'initSkillMenu'; }));
yes('other listeners still register', p.listeners.some(function (l) { return l.type === 'harmless'; }));

p.dispatch('skymp5-client:browserUnfocused');
p.dispatch('initSkillMenu');
yes('unfocus did not run a quit handler', p.quitFired() === 0);
yes('initSkillMenu did not run its handler', p.initFired() === 0);

p.send('/skill quit');
p.send('/skill init');
p.send('/skill discard');
p.send('/skill saltmaker 0');
p.send('/Skill Quit');
yes('skill spam lines never reached the socket', p.said.length === 0);

p.send('hello there');
p.send('/pick blade');
p.send('/skills');
yes('ordinary chat still sends', p.said.indexOf('hello there') >= 0);
yes('/pick still sends', p.said.indexOf('/pick blade') >= 0);
yes('/skills (not /skill) still sends', p.said.indexOf('/skills') >= 0);

done();

