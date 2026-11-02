// test-voice-mute.js
//
// A muted person is silent in the page that actually plays the audio.
//
// ENTRY 151 ON THE TO DO LIST, "Voice has no mute and no block". The mute was
// built in #133: L while looking at somebody, or /mute <name>, keeps a list on
// the character, and the server hands it to window.thornswoodVoice.setMuted in
// the game's own page, whose place() sets that person's gain to 0.
//
// A reviewer measured on 23 September that the list stopped there. Once the
// launcher reports in, the game's page goes into relay mode and drops every
// connection it had, and the audio plays in the launcher's voice, then the
// page launcher/voice-host.html in WebView2. That page's place() set the gain
// from levelFor(...) and never looked at a mute: profile 123 muted in the
// game, in the same cell at zero distance, was played at gain 1. A muted
// person was still heard.
//
// The list now goes the whole way: the game's page sends it to the voice
// plugin, the plugin writes voice-muted.txt where the launcher already reads
// push to talk, Voice.cs hands the line to the voice session (Muted), and the
// session's Placed() silences them before distance is considered. Since #4823
// that session is C#, launcher\app\VoiceSession.cs.
//
// This runs the REAL game page and the REAL plugin in a sandbox with a fake
// browser, a fake file system and a fake audio graph, and the REAL voice
// session (tests\voice-launcher.js) against the real voice service with
// another launcher talking, rather than reading their text, because the
// defect was a thing that read like working code. Voice.cs's file channel is
// checked by text here and by the launcher compile.
//
// Read only, but for the voice driver's build and the service's copy in the
// temp folder.
const REPO_DIR = require('path').join(__dirname, '..'); // the tests are in tests\, the repository is one folder up
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const VL = require('./voice-launcher');
const pluginPass = require('./fixtures/plugin-pass'); // front's whose-game check and the first tick, as the game does (#485)
// The box's address from the one place that holds it (#459), which is what the
// plugin's own list is kept equal to by Set-Vps.ps1.
const OUR_ADDRESS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'scripts', 'vps', 'vps.json'), 'utf8')).address;

let pass = 0, fail = 0;
function yes(what, cond) {
  if (cond) { pass++; console.log('PASS  ' + what); }
  else { fail++; console.log('FAIL  ' + what); }
}

const CR = String.fromCharCode(13);
function read(rel) {
  return fs.readFileSync(path.join(REPO_DIR, rel), 'utf8').split(CR).join('');
}

/* A gain node that records what it was set to, whether ramped or assigned. */
function gainNode() {
  return {
    gain: { value: 1, setTargetAtTime: function (v) { this.value = v; } },
    connect: function (x) { return x; }
  };
}
function pannerNode() {
  return {
    positionX: { value: 0 }, positionY: { value: 0 }, positionZ: { value: 0 },
    connect: function (x) { return x; }
  };
}

/* Me as profile 1, in cell c, at the origin, facing north. */
const ME = 1;
function here(extra) {
  const who = {};
  who[ME] = { pos: [0, 0, 0], angleZ: 0, cell: 'c' };
  for (const k in extra) { who[k] = extra[k]; }
  return who;
}
const BESIDE = { pos: [0, 0, 0], angleZ: 0, cell: 'c' };

// ------------------------------------------------- the launcher's voice
/*
  The launcher's VoiceSession itself (tests\voice-launcher.js), two or three
  of them in a room of the real voice service: each launcher's microphone is
  a tone of its own, and what one of them plays is its own mixer, read back.
  So "heard" here is the other person's tone in what played over the last
  half second, and "silent" is that tone gone from it, not a number on a
  node. Each check waits long enough after the change for the level's
  50 ms glide (setTargetAtTime's tau) to be over before that half second
  begins.
*/
const SERA = 660;
const HEARD = 0.1;    // a voice at full level in front reads about 0.25
const SILENT = 0.02;
const settle = () => new Promise((ok) => setTimeout(ok, 750));

async function launcherSide() {
  const svc = await VL.service();
  const all = [];
  const rooms = [];
  try {
    async function level(who) { await settle(); return (await who.hear([SERA]))[String(SERA)]; }

    // --------------------------------------- what the launcher plays
    {
      const me = await VL.join(svc, { profileId: ME, name: 'Me', tone: 440 });
      const sera = await VL.join(svc, { profileId: 123, name: 'Sera', tone: SERA });
      all.push(me, sera);
      await svc.feed([{ profileId: ME, pos: [0, 0, 0], angleZ: 0, cell: 'c', name: 'Me' },
                      { profileId: 123, pos: [0, 0, 0], angleZ: 0, cell: 'c', name: 'Sera' }]);
      await sera.send({ do: 'ptt', on: true });
      await me.until(() => me.says(/^receiving from Sera$/), 20000, 'Sera\'s audio');
      let v = await level(me);
      yes('before any mute, somebody in your cell at zero distance is heard (' + v.toFixed(3) + ')', v > HEARD);

      /*
        THE CHECK THE REVIEWER'S MEASUREMENT FAILED. Profile 123, muted, in
        the same cell at zero distance: the page used to leave them at gain 1.
      */
      await me.send({ do: 'muted', list: '123' });
      v = await level(me);
      yes('muted, the same person at zero distance is silent (' + v.toFixed(3) + ')', v < SILENT);
      await svc.feed([{ profileId: ME, pos: [0, 0, 0], angleZ: 0, cell: 'c', name: 'Me' },
                      { profileId: 123, pos: [1, 0, 0], angleZ: 0, cell: 'c', name: 'Sera' }]);
      v = await level(me);
      yes('and stays silent as positions keep arriving (' + v.toFixed(3) + ')', v < SILENT);

      await me.send({ do: 'muted', list: '' });
      v = await level(me);
      yes('an empty list unmutes them, and they are heard again (' + v.toFixed(3) + ')', v > HEARD);

      // Only the listed person. Somebody else muted is nothing to do with 123.
      await me.send({ do: 'muted', list: '456' });
      v = await level(me);
      yes('muting somebody else leaves them heard (' + v.toFixed(3) + ')', v > HEARD);

      // Anything that is not a profile id is dropped rather than trusted.
      await me.send({ do: 'muted', list: '123abc -123 1.5 "); x' });
      v = await level(me);
      yes('a line that names nobody properly mutes nobody (' + v.toFixed(3) + ')', v > HEARD);
      await me.send({ do: 'muted', list: '  456   123 ' });
      v = await level(me);
      yes('extra spaces around the ids do not matter (' + v.toFixed(3) + ')', v < SILENT);
      await me.quit();
      await sera.quit();
    }

    // ------------------------------ before anybody's position has arrived
    /*
      The real service gives somebody a voice place only once their position
      is in (#3570), and your own row comes with the first table, so this and
      the next are a room the harness answers in the service's place
      (VL.room), with the same messages the old harness served the page.
    */
    {
      const r = await VL.room([{ profileId: ME, name: 'Me', tone: 440 }, { profileId: 123, name: 'Sera', tone: SERA }]);
      rooms.push(r);
      const me = r.at(0), sera = r.at(1);
      await r.all({ t: 'peers', peers: r.rows() });
      await sera.send({ do: 'ptt', on: true });
      await me.until(() => me.says(/^receiving from Sera$/), 20000, 'Sera\'s audio');
      // Positions for them but not for me: the session has nowhere to measure from.
      await r.say(0, { t: 'pos', who: { 123: BESIDE } });
      let v = await level(me);
      yes('with no position of your own, somebody is played as they connected (' + v.toFixed(3) + ')', v > HEARD);
      await me.send({ do: 'muted', list: '123' });
      v = await level(me);
      yes('a mute does not wait for your own position to arrive (' + v.toFixed(3) + ')', v < SILENT);
      await r.quit();
    }

    // ----------------------------------- somebody already muted connects
    {
      const r = await VL.room([{ profileId: ME, name: 'Me', tone: 440 }, { profileId: 123, name: 'Sera', tone: SERA, mode: 'yell' }]);
      rooms.push(r);
      const me = r.at(0), sera = r.at(1);
      await me.send({ do: 'muted', list: '123' });
      await r.all({ t: 'peers', peers: r.rows() });
      await sera.send({ do: 'ptt', on: true });
      await me.until(() => me.says(/^receiving from Sera$/), 20000, 'Sera\'s audio');
      let v = await level(me);
      yes('a connection to somebody already muted starts silent, before any position (' + v.toFixed(3) + ')', v < SILENT);
      // Unmuted, they are placed again by the next table, as distance is.
      await me.send({ do: 'muted', list: '' });
      await r.say(0, { t: 'pos', who: here({ 123: BESIDE }) });
      v = await level(me);
      yes('and is heard once unmuted and placed, so it was the mute (' + v.toFixed(3) + ')', v > HEARD);
      for (const l of [me, sera]) { all.push(l); }
    }

    for (const l of all) {
      const sw = l.swallowed();
      if (sw) { yes(l.name + '\'s session swallowed nothing:\n' + sw, false); }
    }
  } finally {
    for (const l of all) { await l.quit(); }
    for (const r of rooms) { await r.quit(); }
    await svc.stop();
  }
}

// ------------------------------------------------ the game's own page
/*
  Loaded whole, with a line added before its last close so the harness can
  reach the connections and the positions it keeps inside its closure. The
  file on disk is not touched.
*/
function gamePage() {
  let src = read('game/ui/thornswood-voice.js');
  const end = src.lastIndexOf('})();');
  const hook = '  window.__t = { conns: conns, setWho: function (w) { lastWho = w; }, ' +
               'cfg: cfg, place: place, setCtx: function (c) { ctx = c; } };\n';
  src = src.slice(0, end) + hook + src.slice(end);
  const sent = [];
  const el = function () {
    return { style: {}, appendChild: function () { }, setAttribute: function () { } };
  };
  const win = { skyrimPlatform: { sendMessage: function () { sent.push([].slice.call(arguments)); } } };
  const sandbox = {
    window: win,
    document: { getElementById: function () { return null; }, createElement: el,
                body: { appendChild: function () { } }, head: { appendChild: function () { } },
                querySelector: function () { return null; } },
    navigator: {}, location: { href: 'file:///x' },
    setInterval: function () { return 0; }, clearInterval: function () { },
    setTimeout: function () { return 0; }, clearTimeout: function () { },
    console: { log: function () { } },
    fetch: function () { return Promise.reject(new Error('no')); },
    Promise: Promise, Map: Map, Math: Math, Number: Number, String: String, JSON: JSON,
    Date: Date, Object: Object, Array: Array, isFinite: isFinite
  };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return { V: win.thornswoodVoice, t: win.__t, sent: sent };
}

function mutedSent(sent) {
  const m = sent.filter(function (a) { return a[0] === 'thornswood-voice-muted'; });
  return m.length ? m[m.length - 1] : null;
}

{
  const g = gamePage();
  yes('the game\'s page loads', !!(g.V && g.t));

  // The shape the server sends: profile id -> the name, or true.
  g.V.setMuted({ 123: 'Sera', 456: true });
  const last = mutedSent(g.sent);
  yes('the server\'s list is handed on for the launcher',
      !!last && last[1].split(' ').sort().join(' ') === '123 456');

  g.V.setMuted({});
  yes('and so is an empty one, so an unmute reaches the launcher too',
      !!mutedSent(g.sent) && mutedSent(g.sent)[1] === '');

  /*
    THE ENTRY'S doneWhen, as written: setMuted(123, true), then the placement
    loop with profile 123 in the same cell at zero distance leaves the gain at
    0. The reviewer measured this call doing nothing, because setMuted took
    only a whole list and a number is not one.
  */
  g.t.cfg.profileId = ME;
  g.t.setCtx({ currentTime: 0 });
  const rec = { profileId: 123, gain: gainNode(), panner: pannerNode(), mode: 'local', dist: 0 };
  g.t.conns.set(9, rec);
  g.t.setWho(here({ 123: BESIDE }));
  g.V.setMuted(123, true);
  g.t.place();
  yes('setMuted(123, true) mutes profile 123', g.V.isMuted(123));
  yes('and the loop leaves their gain at 0 in your cell at zero distance',
      rec.gain.gain.value === 0);
  yes('and the launcher is told', !!mutedSent(g.sent) && mutedSent(g.sent)[1] === '123');

  g.V.setMuted(123, false);
  g.t.place();
  yes('setMuted(123, false) unmutes them', !g.V.isMuted(123) && rec.gain.gain.value > 0);
  yes('and the launcher is told that as well',
      !!mutedSent(g.sent) && mutedSent(g.sent)[1] === '');

  // The server's whole list replaces whatever was there.
  g.V.setMuted(123, true);
  g.V.setMuted({ 456: 'Thora' });
  yes('a list from the server replaces a single mute', !g.V.isMuted(123) && g.V.isMuted(456));
}

// ----------------------------------------------------------- the plugin
/*
  The real plugin, with a fake Skyrim Platform and a fake file system. It
  runs only once front's whose-game check says ours (#485), which
  fixtures/plugin-pass.js runs for real, so the fake client settings point
  at our server and the launcher's session note is fresh.
*/
function plugin() {
  const files = {};
  files['Data/Platform/Plugins/skymp5-client-settings.txt'] =
    JSON.stringify({ 'server-ip': OUR_ADDRESS, gameData: { profileId: ME } });
  files['Data/Platform/thornswood-session.txt'] = String(Date.now());
  const fakeFs = {
    readFileSync: function (p) {
      if (!Object.prototype.hasOwnProperty.call(files, p)) { throw new Error('ENOENT ' + p); }
      return files[p];
    },
    writeFileSync: function (p, text) { files[p] = String(text); },
    appendFileSync: function (p, text) { files[p] = (files[p] || '') + String(text); }
  };
  const handlers = {};
  const sp = {
    on: function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); },
    printConsole: function () { },
    browser: { executeJavaScript: function () { } }
  };
  const sandbox = {
    skyrimPlatform: sp,
    require: function (name) { if (name === 'fs') { return fakeFs; } throw new Error(name); },
    console: console, Date: Date, JSON: JSON, Number: Number, String: String,
    Math: Math, Array: Array, Object: Object, RegExp: RegExp, isFinite: isFinite
  };
  vm.createContext(sandbox);
  pluginPass.load(sandbox, read('game/plugins/thornswood-voice.js'), { filename: 'thornswood-voice.js' });
  function page() {
    const args = [].slice.call(arguments);
    (handlers.browserMessage || []).forEach(function (fn) { fn({ arguments: args }); });
  }
  return { files: files, page: page };
}

{
  const pl = plugin();
  const GAME = 'Data/Platform/voice-muted.txt';
  const PROFILE = '../Profile/voice-muted.txt';

  pl.page('thornswood-voice-muted', '123 456');
  yes('the plugin writes the list where the launcher reads push to talk',
      pl.files[GAME] === '123 456' && pl.files[PROFILE] === '123 456');

  pl.page('thornswood-voice-muted', '');
  yes('and writes an empty list over it on an unmute', pl.files[GAME] === '');

  pl.page('thornswood-voice-muted', '12;del 3"\n');
  yes('only digits and single spaces reach the file', pl.files[GAME] === '12 3');

  pl.page('thornswood-voice', 'mode | yell');
  yes('its ordinary log lines are not taken for a mute list', pl.files[GAME] === '12 3');

  /*
    A list left behind by another character is replaced by this session's
    first one, even when that one is empty.
  */
  const fresh = plugin();
  fresh.files[GAME] = '999';
  fresh.page('thornswood-voice-muted', '');
  yes('the first list of a session is always written, even an empty one',
      fresh.files[GAME] === '');
}

// ------------------------------------------------------ the launcher side
function launcherText() {
  const cs = read('launcher/app/Voice.cs');
  yes('Voice.cs reads voice-muted.txt from the channel folders',
      /Path\.Combine\(d, "voice-muted\.txt"\)/.test(cs) && /foreach \(string d in dirs\)/.test(cs));
  yes('and hands the line to the voice session',
      /VoiceSession s = session;\s*if \(s != null\) s\.Muted\(now\);/.test(cs));
  yes('on every pass of the file channel, ahead of push to talk\'s continue',
      /PassMuted\(dirs\);[\s\S]*?string\[\] bits = now\.Split/.test(cs));
  yes('and again whenever voice is configured from the start, which starts it with nobody muted',
      /static void Configure\(Action<string> log\)\s*\{\s*\/\/[^\n]*\n\s*mutedSeen = null;/.test(cs));

  const rules = read('scripts/release/Ship-Rules.ps1');
  const machine = /\$ShipMachineFiles = @\(([\s\S]*?)\n\)/.exec(rules);
  yes('and one person\'s mute list never rides in a pack',
      !!machine && machine[1].indexOf("'Data\\Platform\\voice-muted.txt'") >= 0);
}

launcherText();
launcherSide().then(() => {
  console.log('');
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exitCode = fail ? 1 : 0;
}).catch((e) => {
  console.log('FAIL  the harness itself: ' + (e && e.stack || e));
  process.exitCode = 1;
});
